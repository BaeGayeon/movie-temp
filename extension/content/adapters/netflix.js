// 넷플릭스 어댑터. 재생/정지/이동은 페이지 안의 다리(content/netflix-main.js)를 거쳐 넷플릭스 플레이어 API 로 한다.
// (<video>.currentTime 을 직접 바꾸면 넷플릭스가 오류 M7375 를 낸다.) 다리가 응답하지 않으면 <video> 를 직접 조작한다(정지/재생만).
//
// 넷플릭스의 시간 두 가지(진단 기록과 화면으로 확인):
//  - 본편 위치: 화면 재생바가 보여 주는 위치. 플레이어 API 의 seek(ms) 도 이 값으로 받는다.
//  - 영상 시간: <video>.currentTime. 광고가 지나가면 광고 때 시간에 이어져 본편 위치와 달라지고(예: 화면 39:39, 영상 시간 0:27),
//    가까운 위치로 이동해도 그 차이가 그대로 남는다(멀리 이동하면 다시 같아지기도 한다).
// 그래서 main.js 는 "본편 위치 - 영상 시간" 차이(timeOffset)를 재서 쓴다. 재는 방법은 두 가지:
//  1) 우리가 API 로 이동시킨 경우: 이동한 위치(본편)와 이동 직후의 영상 시간의 차이
//  2) 화면 재생바의 남은 시간이 보이는 경우: 영상 길이 - 남은 시간 = 본편 위치(uiContentTime)
import { createDefaultAdapter } from './default.js';

const REPLY_MS = 400;

// 넷플릭스 광고(광고 포함 요금제)는 영상 길이(본편 길이 그대로)로는 알 수 없어서 화면의 광고 표시를 본다.
// 광고 정보 영역(data-uia 에 ads 가 들어간 요소)이나 "광고 1/2", "Ad · 0:15" 같은 짧은 글자를 찾는다.
const AD_SELECTOR = '[data-uia="ads-info-container"], [data-uia*="ads-info"], [data-uia*="ad-break"], [data-uia="ad-countdown"]';
const AD_TEXT = /^(광고|ad|ads)\s*[·•:|-]?\s*(\d+\s*(\/|of|중)\s*\d+|\d+:\d{2}|\d+)$/i;
let lastScan = { at: 0, ad: false };
function adOnScreen() {
  const now = Date.now();
  if (now - lastScan.at < 500) return lastScan.ad;
  let ad = !!document.querySelector(AD_SELECTOR);
  if (!ad) {
    for (const e of document.querySelectorAll('.watch-video *')) {
      if (e.childElementCount === 0 && e.textContent.length <= 20 && AD_TEXT.test(e.textContent.trim())) {
        ad = true;
        break;
      }
    }
  }
  lastScan = { at: now, ad };
  return ad;
}

// 재생바의 시간 글자("1:12:16" 같은 남은 시간). 재생바(컨트롤)가 보일 때만 있다.
const TIME_TEXT = /^-?(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const parseTime = (s) => {
  const m = TIME_TEXT.exec(s);
  if (!m) return null;
  return m[3] != null ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
};
function timeLabels() {
  const out = [];
  for (const e of document.querySelectorAll('.watch-video *')) {
    if (e.childElementCount !== 0) continue;
    const text = e.textContent.trim();
    if (!TIME_TEXT.test(text) || e.closest(AD_SELECTOR)) continue;
    out.push({ text, uia: e.getAttribute('data-uia') || e.closest('[data-uia]')?.getAttribute('data-uia') || e.tagName.toLowerCase() });
    if (out.length >= 4) break;
  }
  return out;
}
// 재생바 위에 마우스를 올리면 미리보기 시간(trick-play)이 뜨고, 그동안은 남은 시간 글자도 "마우스 위치부터 남은 시간"으로 바뀐다
// (진단 기록: 미리보기 40:35 + 남은 시간 1:11:19 = 전체 1:51:55). 그래서 미리보기가 떠 있으면 남은 시간을 읽지 않는다.
const TRICK_PLAY = '[data-uia*="trick-play"]';
const leafTime = (root) => {
  if (!root) return null;
  if (root.childElementCount === 0) return parseTime(root.textContent.trim());
  for (const e of root.querySelectorAll('*')) if (e.childElementCount === 0 && TIME_TEXT.test(e.textContent.trim())) return parseTime(e.textContent.trim());
  return null;
};
function remainingSeconds() {
  if (document.querySelector(TRICK_PLAY)) return null;
  return leafTime(document.querySelector('[data-uia="controls-time-remaining"]'));
}

export function createNetflixAdapter() {
  const base = createDefaultAdapter();
  let seq = 0;
  // 넷플릭스 API 는 비동기라서 play()/pause() 직후에도 video.paused 가 바로 바뀌지 않는다.
  // 시크할 때 사이트가 pause -> seek -> play 를 연달아 보내므로, 방금 내린 명령을 "의도한 상태"로 잠깐 기억해 둔다.
  let intent = null; // { paused, until }
  const remember = (paused) => (intent = { paused, until: Date.now() + 1500 });

  // 다리에 요청하고 { ok } 를 받는다. 응답이 없으면 { ok: false }.
  function ask(op, ms) {
    return new Promise((resolve) => {
      const id = ++seq;
      const done = (reply) => {
        window.removeEventListener('message', on);
        clearTimeout(timer);
        resolve(reply);
      };
      const on = (e) => {
        if (e.source === window && e.data?.__bmt === 'nf-r' && e.data.id === id) done({ ok: !!e.data.ok });
      };
      const timer = setTimeout(() => done({ ok: false }), REPLY_MS);
      window.addEventListener('message', on);
      window.postMessage({ __bmt: 'nf', id, op, ms }, '*');
    });
  }

  return {
    ...base,
    name: 'netflix',

    // 광고가 끝나면 main.js 가 방의 위치로 한 번 이동시켜 본편 위치와 영상 시간의 차이를 다시 잰다
    reseekAfterAd: true,
    // seek(t) 의 t 는 본편 위치(화면 재생바 기준). 이동 직후 영상 시간과 비교해 차이를 잴 수 있다
    contentSeek: true,
    // 이동하면서 로딩하는 동안 영상을 스스로 멈췄다가 다시 재생한다. 이 정지/재생은 사용자 조작이 아니다
    seekPauses: true,

    // 화면 재생바로 본 본편 위치(초) = 영상 길이 - 남은 시간. 재생바가 안 보이거나, 광고 중이거나, 재생바 미리보기가 떠 있으면 null.
    uiContentTime(video) {
      if (adOnScreen()) return null;
      const v = remainingSeconds();
      const dur = video.duration;
      if (v == null || !Number.isFinite(dur) || v > dur) return null;
      return dur - v;
    },

    // 재생바 미리보기 시간(마우스가 가리키는 본편 위치, 초). 재생바를 눌러 이동하는 순간에는 이 값이 이동할 위치다.
    previewTime() {
      return leafTime(document.querySelector(TRICK_PLAY));
    },

    // 진단 기록용
    debug() {
      return { adOnScreen: lastScan.ad, ui: timeLabels().map((l) => `${l.text}@${l.uia}`) };
    },

    isAd(_video) {
      return adOnScreen(); // 짧은 영상(미리보기/예고편)은 광고가 아니다. 넷플릭스는 영상 길이가 광고에서도 본편 길이 그대로라 화면 표시만 본다
    },

    // 이동/재생 명령이 반영될 때까지 걸리는 시간(ms) 뒤에 방 상태(재생/정지)를 다시 확인한다
    settleMs: 900,

    isPaused(video) {
      return intent && Date.now() < intent.until ? intent.paused : video.paused;
    },

    async play(video) {
      remember(false);
      if (!(await ask('play')).ok) await video.play();
    },

    pause(video) {
      remember(true);
      ask('pause').then((r) => r.ok || video.pause());
    },

    // 이동은 반드시 넷플릭스 API 로(t = 본편 위치). 다리가 없으면 아무것도 하지 않는다(직접 currentTime 을 바꾸면 오류 화면이 뜬다).
    seek(_video, t) {
      ask('seek', t * 1000);
    },
  };
}
