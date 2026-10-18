// 웨이브 어댑터. 재생/정지/이동은 기본 어댑터(<video> 직접 조작)를 그대로 쓰고, "지금 광고인가" 판단만 보강한다.
//
// 배경: 웨이브에서는 광고 때 방이 멈췄다 다시 시작은 되지만 "광고 시청 중" 안내가 뜨지 않고 "정지/재생했어요" 알림만 떴다.
// 기본 어댑터의 광고 판단(영상 길이 90초 미만)이 맞지 않아, 광고 때 플레이어가 메인 영상을 멈췄다 다시 재생하는 것이
// 사용자의 정지/재생으로 방에 전달된 것으로 보인다. 웨이브 광고가 실제로 어떤 모양인지는 확인하지 못해서(이용권 필요),
// 광고에서 흔한 세 가지 신호로 판단하고, 진단 정보(debug)에 후보를 남겨 맞지 않으면 기록을 보고 기준을 고친다.
//  1) 메인 영상 위를 덮는 외부 출처 <iframe> (광고 SDK 는 보통 다른 출처의 iframe 에서 재생)
//  2) 메인이 아닌 다른 <video> 가 보이는 상태로 재생 중
//  3) 화면의 "광고 0:15", "광고 1/2" 같은 짧은 표시
import { createDefaultAdapter } from './default.js';

const MIN_W = 200;
const MIN_H = 100;
const AD_TEXT = /^(광고|ad|ads)\s*[·•:|-]?\s*(\d+\s*(\/|of|중)\s*\d+|\d+:\d{2}|\d+)$/i;
const SCAN_MS = 500;

let cache = { at: 0, video: null, out: { ad: false, why: null, info: {} } };

const rectOf = (el) => el.getBoundingClientRect();
function visible(el) {
  const r = rectOf(el);
  if (r.width < MIN_W || r.height < MIN_H) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
}
function overlapRatio(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(1, b.width * b.height);
}
const hostOf = (src) => {
  try {
    return new URL(src, location.href).hostname;
  } catch {
    return '';
  }
};

function scan(video) {
  const vr = rectOf(video);
  const info = { otherVideos: [], iframes: [], texts: [] };
  let why = null;

  // 1) 메인 영상을 덮는 외부 출처 iframe
  for (const f of document.querySelectorAll('iframe')) {
    if (!visible(f)) continue;
    const host = hostOf(f.src);
    const external = host && host !== location.hostname && !host.endsWith('.wavve.com') && host !== 'wavve.com';
    const cover = overlapRatio(rectOf(f), vr);
    info.iframes.push({ host: host || '(없음)', cover: +cover.toFixed(2), external });
    if (external && cover >= 0.5) why ??= `외부 iframe(${host}) 이 영상을 덮음`;
  }
  // 2) 다른 <video> 가 보이는 상태로 재생 중
  for (const v of document.querySelectorAll('video')) {
    if (v === video) continue;
    const vis = visible(v);
    info.otherVideos.push({ w: Math.round(rectOf(v).width), h: Math.round(rectOf(v).height), paused: v.paused, ready: v.readyState, dur: Number.isFinite(v.duration) ? Math.round(v.duration) : null, vis });
    if (vis && !v.paused && v.readyState >= 2) why ??= '다른 <video> 가 재생 중';
  }
  // 3) "광고 0:15" 같은 짧은 표시(메인 영상 주변 몇 단계 위의 요소 안에서만 찾는다)
  let root = video;
  for (let i = 0; i < 4 && root.parentElement; i++) root = root.parentElement;
  let n = 0;
  for (const e of root.querySelectorAll('*')) {
    if (++n > 600) break;
    if (e.childElementCount !== 0 || e.textContent.length > 20) continue;
    const t = e.textContent.trim();
    if (t && /광고|^ads?\b/i.test(t) && info.texts.length < 4) info.texts.push(t);
    if (AD_TEXT.test(t)) why ??= `광고 표시("${t}")`;
  }
  return { ad: !!why, why, info };
}

function detect(video, fresh = false) {
  const now = Date.now();
  if (!fresh && cache.video === video && now - cache.at < SCAN_MS) return cache.out;
  let out;
  try {
    out = scan(video);
  } catch {
    out = { ad: false, why: null, info: {} };
  }
  cache = { at: now, video, out };
  return out;
}

export function createWavveAdapter() {
  const base = createDefaultAdapter();
  return {
    ...base,
    name: 'wavve',

    // 광고 시작 때 플레이어가 메인 영상을 먼저 멈추므로, 정지 알림을 보내기 전에 광고 표시가 뜰 시간을 준다(ms)
    holdPauseMs: 800,

    // 광고 신호가 보이거나, 기본 판단(영상 길이 90초 미만)에 걸리면 광고. fresh = 캐시 없이 지금 바로 확인
    isAd(video, fresh = false) {
      return base.isAd(video) || detect(video, fresh).ad;
    },

    // 진단 기록용: 광고 후보(다른 video, iframe, 광고 글자)와 판단 이유
    debug() {
      const { why, info } = cache.out;
      return { adWhy: why, ...info };
    },
  };
}
