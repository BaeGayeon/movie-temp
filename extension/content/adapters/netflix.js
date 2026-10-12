// 넷플릭스 어댑터. 재생/정지/이동은 페이지 안의 다리(content/netflix-main.js)를 거쳐 넷플릭스 플레이어 API 로 한다.
// (<video>.currentTime 을 직접 바꾸면 넷플릭스가 오류 M7375 를 낸다.) 다리가 응답하지 않으면 <video> 를 직접 조작한다(정지/재생만).
import { createDefaultAdapter } from './default.js';

const REPLY_MS = 400;

// 넷플릭스 광고(광고 포함 요금제)는 영상 길이만으로는 알 수 없는 경우가 있어 화면의 광고 표시도 같이 본다.
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

export function createNetflixAdapter() {
  const base = createDefaultAdapter();
  let seq = 0;
  // 넷플릭스 API 는 비동기라서 play()/pause() 직후에도 video.paused 가 바로 바뀌지 않는다.
  // 시크할 때 사이트가 pause -> seek -> play 를 연달아 보내므로, 방금 내린 명령을 "의도한 상태"로 잠깐 기억해 둔다.
  let intent = null; // { paused, until }
  const remember = (paused) => (intent = { paused, until: Date.now() + 1500 });

  // 다리에 요청하고 { ok, ms } 를 받는다. 응답이 없으면 { ok: false }.
  function ask(op, ms) {
    return new Promise((resolve) => {
      const id = ++seq;
      const done = (reply) => {
        window.removeEventListener('message', on);
        clearTimeout(timer);
        resolve(reply);
      };
      const on = (e) => {
        if (e.source === window && e.data?.__bmt === 'nf-r' && e.data.id === id) done({ ok: !!e.data.ok, ms: e.data.ms });
      };
      const timer = setTimeout(() => done({ ok: false }), REPLY_MS);
      window.addEventListener('message', on);
      window.postMessage({ __bmt: 'nf', id, op, ms }, '*');
    });
  }

  return {
    ...base,
    name: 'netflix',

    // 진단 기록용: 어댑터가 아는 값
    debug() {
      return { adOnScreen: lastScan.ad };
    },

    isAd(video) {
      return base.isAd(video) || adOnScreen();
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

    // 광고가 지나가면 넷플릭스는 <video> 시간축(과 플레이어 API 의 위치)을 광고 때 시간에 이어서 쓴다.
    // 실제로는 43:30 인데 0:33 으로 나오는 식이라, main.js 가 광고가 끝날 때 본편 위치(광고 직전 위치)에 맞춰 보정값을 다시 잡는다.
    shiftsAfterAd: true,

    // 진단 기록용: 어댑터가 아는 값
    debug() {
      return { adOnScreen: lastScan.ad };
    },

    isAd(video) {
      return base.isAd(video) || adOnScreen();
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

    // 실제 재생 위치(초). <video>.currentTime 은 광고가 지나간 뒤 등에 넷플릭스의 실제 위치와 어긋나는 일이 있어(예: 43:30 인데 0:33),
    // 넷플릭스 플레이어 API 의 위치를 0.25초마다 받아 두고 재생 중이면 경과 시간을 더해서 쓴다. 값이 없으면 <video> 값을 쓴다.
    position(video) {
      if (apiPos && Date.now() - apiPos.at < 2000) return apiPos.sec + (video.paused ? 0 : (Date.now() - apiPos.at) / 1000);
      return video.currentTime;
    },

    // 이동은 반드시 넷플릭스 API 로. 다리가 없으면 아무것도 하지 않는다(직접 currentTime 을 바꾸면 오류 화면이 뜬다).
    seek(_video, t) {
      ask('seek', t * 1000);
    },
  };
}
