// 채팅 사이드바 + 이모지 리액션. 모든 사용자 텍스트는 textContent 로만 렌더링한다(XSS 방지).
//  - 두 가지 배치: "떠 있는 창"(헤더를 끌어 이동, 가장자리로 크기 조절) / "화면 오른쪽에 붙이기"(화면 분할처럼 페이지를 줄임)
//  - 메시지 옆에 작성 시각 / 재생 시각 표시(설정에서 각각 켜고 끔)
//  - 방 코드·초대 링크 복사, 이모지 전체 선택(채팅 입력, 리액션)
import { createLayer } from './ui.js';
import { REACTION_EMOJIS } from '../shared/protocol.js';
import { renderAvatar } from '../shared/avatar.js';
import { createEmojiPicker, EMOJI_PICKER_CSS } from '../shared/emoji-picker.js';

const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .root { position: fixed; inset: 0; pointer-events: none; font: 14px/1.45 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #fff; }
  button { font: inherit; cursor: pointer; border: 0; color: inherit; }

  .panel { position: absolute; pointer-events: auto; display: flex; flex-direction: column;
    background: rgba(18,18,24,.94); border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.55); overflow: hidden; }
  .panel.dock { border-radius: 0; box-shadow: -4px 0 16px rgba(0,0,0,.4); }
  .panel[hidden], .dock-bubble[hidden] { display: none; }
  .head { position: relative; display: flex; align-items: center; gap: 4px; padding: 6px 8px; background: rgba(255,255,255,.07); user-select: none; }
  .panel.free .head { cursor: move; }
  .head .title { font-weight: 700; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chip { background: rgba(255,255,255,.12); border-radius: 10px; padding: 1px 8px; font-size: 12px; letter-spacing: 1px; }
  .chip:hover { background: rgba(255,255,255,.25); }
  .iconbtn { background: transparent; font-size: 15px; padding: 2px 6px; border-radius: 6px; }
  .iconbtn:hover { background: rgba(255,255,255,.15); }

  .menu { position: absolute; top: 100%; right: 6px; z-index: 5; width: 220px; background: #262b38; border-radius: 10px; padding: 10px;
    box-shadow: 0 6px 20px rgba(0,0,0,.6); display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
  .menu[hidden] { display: none; }
  .menu label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .menu input[type=range] { flex: 1; accent-color: #4f7cff; }
  .menu select { flex: 1; font: inherit; color: #fff; background: rgba(255,255,255,.12); border: 0; border-radius: 6px; padding: 3px 4px; }
  .menu select option { color: #000; }
  .menu .act { background: rgba(255,255,255,.12); border-radius: 8px; padding: 5px 8px; text-align: left; }
  .menu .act:hover { background: rgba(255,255,255,.22); }

  .list { flex: 1; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
  .msg { display: flex; gap: 8px; align-items: flex-start; }
  .av { flex: none; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; overflow: hidden; }
  .body { min-width: 0; }
  .name { font-weight: 700; font-size: 12px; }
  .meta { font-weight: 400; color: #8a90a0; margin-left: 6px; }
  .text { word-break: break-word; white-space: pre-wrap; }
  .msg.me .text { color: #cfe0ff; }
  .sys { text-align: center; color: #8a90a0; font-size: 12px; padding: 1px 6px; }
  .no-events .sys { display: none; }
  .empty { color: #8a90a0; text-align: center; padding: 16px 0; font-size: 13px; }

  .typing { min-height: 18px; padding: 0 10px 2px; font-size: 12px; color: #aab; }
  .reacts { display: flex; gap: 0; padding: 2px 6px; flex-wrap: wrap; align-items: center; }
  .reacts button { background: transparent; font-size: 17px; border-radius: 8px; padding: 2px 4px; }
  .reacts button:hover { background: rgba(255,255,255,.15); }
  .form { display: flex; gap: 6px; padding: 6px 8px 8px; align-items: center; }
  .form .emo { background: transparent; font-size: 20px; padding: 2px 4px; border-radius: 8px; }
  .form .emo:hover { background: rgba(255,255,255,.15); }
  .form input { flex: 1; min-width: 0; font: inherit; color: #fff; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.18);
    border-radius: 8px; padding: 6px 8px; outline: none; }
  .form input:focus { border-color: #4f7cff; }
  .form .send { background: #4f7cff; border-radius: 8px; padding: 6px 12px; }

  .rz { position: absolute; }
  .rz-l { left: 0; top: 0; bottom: 0; width: 6px; cursor: ew-resize; }
  .rz-r { right: 0; top: 0; bottom: 0; width: 6px; cursor: ew-resize; }
  .rz-b { left: 0; right: 0; bottom: 0; height: 6px; cursor: ns-resize; }
  .rz-bl { left: 0; bottom: 0; width: 14px; height: 14px; cursor: nesw-resize; }
  .rz-br { right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize; }
  .panel.dock .rz-r, .panel.dock .rz-b, .panel.dock .rz-bl, .panel.dock .rz-br { display: none; }

  .dock-bubble { position: absolute; right: 16px; bottom: 90px; pointer-events: auto; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
  .bubble { position: relative; width: 46px; height: 46px; border-radius: 50%; background: rgba(18,18,24,.92); font-size: 22px; box-shadow: 0 4px 14px rgba(0,0,0,.5); }
  .badge { position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px; background: #ff4d4f;
    font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  .badge[hidden] { display: none; }
  .dock-bubble .reacts { display: none; background: rgba(18,18,24,.92); border-radius: 12px; }
  .dock-bubble:hover .reacts { display: flex; }

  .pop { position: absolute; pointer-events: auto; }
  .pop[hidden] { display: none; }

  .floats { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .float { position: absolute; bottom: 14%; display: flex; flex-direction: column; align-items: center; animation: rise 2.8s ease-out forwards; }
  .float .e { font-size: 44px; filter: drop-shadow(0 2px 6px rgba(0,0,0,.5)); }
  .float .n { font-size: 11px; background: rgba(0,0,0,.55); border-radius: 8px; padding: 0 6px; }
  @keyframes rise { 0% { transform: translateY(0) scale(.6); opacity: 0; } 12% { transform: translateY(-20px) scale(1.1); opacity: 1; }
    100% { transform: translateY(-38vh) scale(1); opacity: 0; } }
` + EMOJI_PICKER_CSS;

const DEFAULT_PREFS = {
  collapsed: false,
  opacity: 1,
  mode: 'float', // 'float' = 떠 있는 창, 'dock' = 화면 오른쪽에 붙이기
  width: 300,
  height: 420,
  dockWidth: 340,
  dockFit: 'scale', // 붙이기 방식: 'scale' = 화면 전체 축소, 'width' = 폭만 줄이기
  x: null, // 떠 있는 창 위치(null 이면 오른쪽 위)
  y: null,
  showClock: true, // 작성 시각
  showVideoTime: true, // 재생 시각
  showEvents: true, // 재생/일시정지/시간 이동 알림
};
const MIN_W = 220;
const MIN_H = 200;
const MAX_MESSAGES = 200;
const EVENT_MERGE_MS = 1500; // 같은 사람의 연속 이벤트(사이트가 시크할 때 pause→seek→play 를 내보냄)를 합치는 시간
const MAX_FLOATS = 30;
const TYPING_IDLE_MS = 3000;
const TYPING_RESEND_MS = 2000;
const EDGE = 16;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const fmtClock = (ms) => new Date(ms).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
function fmtVideo(sec) {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

// getState(): 최신 background 상태. getInviteLink(): 현재 페이지 + ?wp=코드
// onSend(text) / onTyping(bool) / onReaction(emoji) / onNotify(text)
export function createChat({ getState, getInviteLink, onSend, onTyping, onReaction, onNotify }) {
  const mount = createLayer(CSS, { topLayer: true }); // 페이지 축소(transform)의 영향을 받지 않도록 최상위 레이어에
  let built = false;
  let prefs = { ...DEFAULT_PREFS };
  const messages = []; // { userId, text, sentAt, videoTime, el }
  let unread = 0;

  // DOM 참조
  let wrap, panel, head, list, typingLine, input, bubbleBox, badge, floats, menu, codeChip, opacity, clockCb, videoCb, eventsCb, modeBtn, pop, picker, dockFitSel;

  try {
    chrome.storage.local.get('chatPrefs').then((r) => {
      prefs = { ...DEFAULT_PREFS, ...(r.chatPrefs ?? {}) };
      if (built) applyPrefs();
    });
  } catch {}
  const savePrefs = () => {
    try {
      chrome.storage.local.set({ chatPrefs: prefs });
    } catch {}
  };

  const profileOf = (userId) => {
    const p = getState()?.participants?.find((x) => x.id === userId);
    return p ?? { name: '알 수 없음', color: '#aab', avatar: { kind: 'emoji', value: '❔', bg: '#555' } };
  };

  // ---------- 페이지 분할(오른쪽에 붙이기) ----------
  // 사이트 화면을 채팅 왼쪽 영역에 맞춘다. 방식은 두 가지(설정 "붙일 때 화면"):
  //  - 'scale'(기본) "전체 축소": 영상이 vw/fixed 로 화면 전체에 깔린 OTT 사이트에서도 영상이 함께 줄어든다.
  //      · 스크롤이 없는 페이지(시청 화면): <html> 에 transform 을 걸어 비율대로 줄이고 세로 가운데에 놓는다.
  //      · 스크롤되는 페이지: transform 은 fixed 요소를 문서에 묶어 스크롤에 딸려 나가게 하므로(영상이 사라짐) CSS zoom 을 쓴다.
  //        zoom 은 fixed 가 화면에 고정된 채 함께 줄어든다(세로 가운데 정렬은 안 됨: 위쪽 정렬).
  //  - 'width' "폭만 줄이기": <html> 폭만 줄임. 반응형 사이트에서는 자연스럽지만 vw/fixed 요소는 줄지 않고 채팅 아래에 깔린다.
  const FIT_PROPS = ['width', 'transform', 'transform-origin', 'min-height', 'zoom'];
  let savedStyles = null; // 원래 <html> 인라인 스타일(복구용)
  let fitMode = null; // 'transform' | 'zoom' | 'width' — 붙인 동안 유지(스크롤이 생기면 transform -> zoom 으로만 바뀜)

  const clearFit = (html) => {
    for (const p of FIT_PROPS) html.style.removeProperty(p);
  };
  // 우리가 건 스타일이 없는 상태에서 문서가 스크롤되는지 잰다
  const isScrollable = (html) => {
    clearFit(html);
    return window.scrollY > 0 || html.scrollHeight > window.innerHeight + 2;
  };
  function onScrollWhileScaled() {
    // 스크롤이 생기면(페이지가 늘어나거나 사용자가 스크롤) transform 은 fixed 영상을 깨뜨리므로 zoom 으로 바꾼다
    if (fitMode === 'transform' && window.scrollY > 0) {
      fitMode = 'zoom';
      applyPrefs();
    }
  }

  function setPageInset(px, fit) {
    const html = document.documentElement;
    if (px <= 0) {
      window.removeEventListener('scroll', onScrollWhileScaled);
      fitMode = null;
      if (!savedStyles) return;
      clearFit(html);
      for (const p of FIT_PROPS) {
        const [v, prio] = savedStyles[p];
        if (v) html.style.setProperty(p, v, prio);
      }
      savedStyles = null;
      return;
    }
    if (!savedStyles) {
      savedStyles = {};
      for (const p of FIT_PROPS) savedStyles[p] = [html.style.getPropertyValue(p), html.style.getPropertyPriority(p)];
    }
    if (fit === 'width') fitMode = 'width';
    else if (!fitMode || fitMode === 'width') fitMode = isScrollable(html) ? 'zoom' : 'transform';
    clearFit(html);

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.max(0.3, (vw - px) / vw);
    const set = (name, value) => html.style.setProperty(name, value, 'important');
    if (fitMode === 'width') {
      set('width', `calc(100% - ${px}px)`);
    } else if (fitMode === 'zoom') {
      set('zoom', String(scale));
      set('width', `${vw}px`); // zoom 이 곱해져 화면 폭이 (vw - px) 가 된다
    } else {
      set('transform', `translate(0, ${(vh - vh * scale) / 2}px) scale(${scale})`); // 세로 가운데
      set('transform-origin', '0 0');
      set('min-height', '100vh'); // fixed 요소 기준 높이를 화면 높이로
    }
    window.removeEventListener('scroll', onScrollWhileScaled);
    if (fitMode === 'transform') window.addEventListener('scroll', onScrollWhileScaled, { passive: true });
  }

  const isDock = () => prefs.mode === 'dock';

  function applyPrefs() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    prefs.opacity = clamp(prefs.opacity, 0.3, 1);
    panel.style.opacity = String(prefs.opacity);
    opacity.value = String(prefs.opacity);
    clockCb.checked = prefs.showClock;
    videoCb.checked = prefs.showVideoTime;
    eventsCb.checked = prefs.showEvents;
    list.classList.toggle('no-events', !prefs.showEvents);
    panel.hidden = prefs.collapsed;
    bubbleBox.hidden = !prefs.collapsed;
    panel.classList.toggle('dock', isDock());
    panel.classList.toggle('free', !isDock()); // (리액션 애니메이션 클래스 .float 와 이름이 겹치면 안 된다)
    modeBtn.textContent = isDock() ? '❐' : '◨';
    modeBtn.title = isDock() ? '떠 있는 창으로 바꾸기' : '화면 오른쪽에 붙이기';

    let inset = 0;
    if (isDock()) {
      prefs.dockWidth = clamp(prefs.dockWidth, MIN_W, Math.min(600, vw - 200));
      Object.assign(panel.style, { left: 'auto', right: '0', top: '0', width: `${prefs.dockWidth}px`, height: '100%' });
      // 전체화면에서는 페이지를 줄일 수 없으니 영상 위에 겹쳐서 보여준다
      if (!prefs.collapsed && !document.fullscreenElement) inset = prefs.dockWidth;
    } else {
      prefs.width = clamp(prefs.width, MIN_W, Math.max(MIN_W, vw - 2 * EDGE));
      prefs.height = clamp(prefs.height, MIN_H, Math.max(MIN_H, vh - 2 * EDGE));
      if (prefs.x == null) prefs.x = vw - prefs.width - EDGE;
      if (prefs.y == null) prefs.y = EDGE;
      prefs.x = clamp(prefs.x, 0, Math.max(0, vw - prefs.width));
      prefs.y = clamp(prefs.y, 0, Math.max(0, vh - 60)); // 헤더는 항상 화면 안에 남긴다
      Object.assign(panel.style, {
        left: `${prefs.x}px`,
        top: `${prefs.y}px`,
        right: 'auto',
        width: `${prefs.width}px`,
        height: `${prefs.height}px`,
      });
    }
    dockFitSel.value = prefs.dockFit;
    setPageInset(built && mount.host?.isConnected ? inset : 0, prefs.dockFit);
    if (!prefs.collapsed) {
      unread = 0;
      renderBadge();
    }
  }

  const renderBadge = () => {
    badge.hidden = unread === 0;
    badge.textContent = unread > 99 ? '99+' : String(unread);
  };

  function scrollToBottom(force) {
    const near = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    if (force || near) list.scrollTop = list.scrollHeight;
  }

  // ---------- 이모지 선택기 (채팅 입력 / 리액션) ----------
  let popAnchor = null;
  function closePicker() {
    pop.hidden = true;
    popAnchor = null;
  }
  function openPicker(anchor, onPick, keepOpen) {
    if (!pop.hidden && popAnchor === anchor) return closePicker();
    popAnchor = anchor;
    picker.reset();
    picker.onPick = (emoji) => {
      onPick(emoji);
      if (!keepOpen) closePicker();
    };
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = 288;
    const h = 270;
    pop.style.left = `${clamp(r.right - w, 8, window.innerWidth - w - 8)}px`;
    const above = r.top - h - 8;
    pop.style.top = `${above >= 8 ? above : Math.min(r.bottom + 8, window.innerHeight - h - 8)}px`;
  }

  function reactionRow() {
    const row = el('div', 'reacts');
    for (const emoji of REACTION_EMOJIS) {
      const b = el('button', '', emoji);
      b.title = '리액션';
      b.addEventListener('click', () => onReaction(emoji));
      row.append(b);
    }
    const more = el('button', '', '＋');
    more.title = '모든 이모지';
    more.addEventListener('click', () => openPicker(more, (emoji) => onReaction(emoji), false));
    row.append(more);
    return row;
  }

  // ---------- 입력 중 표시(내가 보내는 쪽): 디바운스 + 3초 후 자동 해제 ----------
  let typingSent = false;
  let lastTypingSentAt = 0;
  let typingIdle = null;
  function stopTyping() {
    clearTimeout(typingIdle);
    if (typingSent) onTyping(false);
    typingSent = false;
  }
  function noteTyping() {
    if (!input.value.trim()) return stopTyping();
    const now = Date.now();
    if (!typingSent || now - lastTypingSentAt > TYPING_RESEND_MS) {
      onTyping(true);
      typingSent = true;
      lastTypingSentAt = now;
    }
    clearTimeout(typingIdle);
    typingIdle = setTimeout(stopTyping, TYPING_IDLE_MS);
  }

  function submit() {
    const text = input.value.trim();
    if (!text) return;
    stopTyping();
    onSend(text);
    input.value = '';
  }

  // ---------- 입력 중 표시(받는 쪽) ----------
  const typingTimers = new Map(); // userId -> timeout (3초 지나면 자동 해제)
  function renderTyping() {
    const names = [...typingTimers.keys()].map((id) => profileOf(id).name);
    typingLine.textContent =
      names.length === 0 ? '' : names.length <= 2 ? `${names.join(', ')}님이 입력 중...` : '여러 명이 입력 중...';
  }

  // ---------- 이동(떠 있는 창) / 크기 조절 ----------
  function dragMove(handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (isDock() || e.target.closest('button, input, .menu')) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const sx = e.clientX;
      const sy = e.clientY;
      const x0 = prefs.x;
      const y0 = prefs.y;
      const move = (ev) => {
        prefs.x = x0 + ev.clientX - sx;
        prefs.y = y0 + ev.clientY - sy;
        applyPrefs();
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        savePrefs();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  // dx: -1(왼쪽 가장자리, 오른쪽 끝 고정) / 1(오른쪽) / 0, dy: 1(아래) / 0
  function dragResize(handle, dx, dy) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const sx = e.clientX;
      const sy = e.clientY;
      const start = { w: prefs.width, h: prefs.height, x: prefs.x, dw: prefs.dockWidth };
      const move = (ev) => {
        const ddx = ev.clientX - sx;
        const ddy = ev.clientY - sy;
        if (isDock()) {
          prefs.dockWidth = start.dw - ddx; // 왼쪽 가장자리를 끌어 폭 조절
        } else {
          if (dx < 0) {
            const w = clamp(start.w - ddx, MIN_W, 900);
            prefs.width = w;
            prefs.x = start.x + start.w - w;
          } else if (dx > 0) prefs.width = clamp(start.w + ddx, MIN_W, 900);
          if (dy > 0) prefs.height = start.h + ddy;
        }
        applyPrefs();
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        savePrefs();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  // ---------- 메시지 렌더링 ----------
  function renderMeta(m) {
    const parts = [];
    if (prefs.showClock) parts.push(fmtClock(m.sentAt));
    if (prefs.showVideoTime && typeof m.videoTime === 'number') parts.push(`▶ ${fmtVideo(m.videoTime)}`);
    const meta = m.el.querySelector('.meta');
    meta.textContent = parts.join(' · ');
    meta.hidden = parts.length === 0;
    m.el.title = `${new Date(m.sentAt).toLocaleTimeString()}${typeof m.videoTime === 'number' ? ` · 재생 ${fmtVideo(m.videoTime)}` : ''}`;
  }

  function applyProfile(row, userId) {
    const p = profileOf(userId);
    renderAvatar(row.querySelector('.av'), p.avatar, 28);
    const name = row.querySelector('.name-text');
    name.textContent = p.name;
    name.style.color = p.color ?? '#fff';
  }

  // ---------- 재생/일시정지/시간 이동 알림 ----------
  const lastEvent = new Map(); // userId -> { entry, at } — 연속 이벤트 합치기용
  function eventText(m) {
    const who = m.userId === getState()?.userId ? '내가' : `${profileOf(m.userId).name}님이`;
    const t = fmtVideo(m.time);
    if (m.action === 'play') return `▶ ${who} 재생했어요 · ${t}`;
    if (m.action === 'pause') return `⏸ ${who} 일시정지했어요 · ${t}`;
    if (m.action === 'seekplay') return `⏩ ${who} ${t} 위치로 이동해서 재생했어요`;
    return `⏩ ${who} ${t} 위치로 이동했어요`;
  }

  function renderEvent(m) {
    list.querySelector('.empty')?.remove();
    const prev = lastEvent.get(m.userId);
    const fresh = prev && m.sentAt - prev.at < EVENT_MERGE_MS;
    // 사이트마다 시크할 때 pause → seek → play 또는 play → seek 를 내보낸다. 같은 사람의 연속 이벤트를 한 줄로 합친다:
    //  - 정지 + 이동 = 이동 / 이동 + 재생(또는 재생 + 이동) = "이동해서 재생" / 같은 종류가 연달아 오면 마지막 값으로 갱신
    if (fresh) {
      const a = prev.entry.action;
      const n = m.action;
      let merged = null;
      if (n === 'seek') merged = a === 'pause' || a === 'seek' ? 'seek' : a === 'play' || a === 'seekplay' ? 'seekplay' : null;
      else if (n === 'play') merged = a === 'seek' || a === 'seekplay' ? 'seekplay' : a === 'play' ? 'play' : null;
      else if (n === 'pause' && a === 'pause') merged = 'pause';
      if (merged) {
        Object.assign(prev.entry, { action: merged, time: m.time, sentAt: m.sentAt });
        prev.entry.el.textContent = eventText(prev.entry);
        prev.at = m.sentAt;
        return prev.entry.el;
      }
    }
    const row = el('div', 'sys');
    const entry = { ...m, el: row };
    row.textContent = eventText(entry);
    list.append(row);
    messages.push(entry);
    lastEvent.set(m.userId, { entry, at: m.sentAt });
    while (messages.length > MAX_MESSAGES) messages.shift().el.remove();
    return row;
  }

  function renderMessage(m) {
    if (m.kind === 'event') return renderEvent(m);
    list.querySelector('.empty')?.remove();
    const row = el('div', m.userId === getState()?.userId ? 'msg me' : 'msg');
    const body = el('div', 'body');
    const nameLine = el('div', 'name');
    nameLine.append(el('span', 'name-text'), el('span', 'meta'));
    body.append(nameLine, el('div', 'text', m.text)); // text 는 textContent
    row.append(el('span', 'av'), body);
    const entry = { ...m, el: row };
    applyProfile(row, m.userId);
    renderMeta(entry);
    list.append(row);
    messages.push(entry);
    while (messages.length > MAX_MESSAGES) messages.shift().el.remove();
  }

  function renderEmpty() {
    if (messages.length === 0 && !list.querySelector('.empty')) {
      list.append(el('div', 'empty', '아직 메시지가 없어요. 인사를 건네 보세요!'));
    }
  }

  // ---------- DOM 구성 ----------
  function flash(btn, text) {
    const old = btn.textContent;
    btn.textContent = text;
    setTimeout(() => (btn.textContent = old), 1200);
  }

  function build() {
    const root = mount.ensure();
    if (built) return;
    built = true;
    wrap = el('div', 'root');

    // 헤더: 제목, 방 코드(클릭하면 복사), 설정, 배치 전환, 접기
    panel = el('div', 'panel');
    head = el('div', 'head');
    codeChip = el('button', 'chip');
    codeChip.addEventListener('click', async () => {
      const code = getState()?.roomCode;
      if (code && (await copyText(code))) flash(codeChip, '복사됨!');
    });
    const settingsBtn = el('button', 'iconbtn', '⚙');
    settingsBtn.title = '설정';
    modeBtn = el('button', 'iconbtn');
    modeBtn.addEventListener('click', () => {
      prefs.mode = isDock() ? 'float' : 'dock';
      applyPrefs();
      savePrefs();
    });
    const collapseBtn = el('button', 'iconbtn', '—');
    collapseBtn.title = '접기';
    collapseBtn.addEventListener('click', () => {
      prefs.collapsed = true;
      closePicker();
      menu.hidden = true;
      applyPrefs();
      savePrefs();
    });
    head.append(el('span', 'title', '💬 채팅'), codeChip, settingsBtn, modeBtn, collapseBtn);

    // 설정 메뉴: 투명도, 시간 표시, 링크/코드 복사
    menu = el('div', 'menu');
    menu.hidden = true;
    opacity = el('input');
    opacity.type = 'range';
    opacity.min = '0.3';
    opacity.max = '1';
    opacity.step = '0.05';
    opacity.addEventListener('input', () => {
      prefs.opacity = Number(opacity.value);
      panel.style.opacity = String(prefs.opacity);
    });
    opacity.addEventListener('change', savePrefs);
    const opLabel = el('label');
    opLabel.append(el('span', '', '투명도'), opacity);
    const checkbox = (text, key) => {
      const label = el('label');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', () => {
        prefs[key] = cb.checked;
        messages.forEach((m) => m.kind !== 'event' && renderMeta(m));
        list.classList.toggle('no-events', !prefs.showEvents);
        savePrefs();
      });
      label.append(cb, el('span', '', text));
      return [label, cb];
    };
    let clockLabel, videoLabel, eventsLabel;
    [clockLabel, clockCb] = checkbox('작성 시각 표시', 'showClock');
    [videoLabel, videoCb] = checkbox('재생 시각 표시 (▶ 영상 위치)', 'showVideoTime');
    [eventsLabel, eventsCb] = checkbox('재생·정지·이동 알림 표시', 'showEvents');
    const copyLink = el('button', 'act', '🔗 초대 링크 복사');
    copyLink.addEventListener('click', async () => (await copyText(getInviteLink())) && flash(copyLink, '✔ 복사됨!'));
    const copyCode = el('button', 'act', '📋 방 코드 복사');
    copyCode.addEventListener('click', async () => (await copyText(getState()?.roomCode ?? '')) && flash(copyCode, '✔ 복사됨!'));
    const fitLabel = el('label');
    dockFitSel = el('select');
    for (const [v, t] of [['scale', '전체 축소'], ['width', '폭만 줄이기']]) {
      const o = el('option', '', t);
      o.value = v;
      dockFitSel.append(o);
    }
    dockFitSel.addEventListener('change', () => {
      prefs.dockFit = dockFitSel.value;
      applyPrefs();
      savePrefs();
    });
    fitLabel.append(el('span', '', '붙일 때 화면'), dockFitSel);
    menu.append(opLabel, clockLabel, videoLabel, eventsLabel, copyLink, copyCode, fitLabel);
    settingsBtn.addEventListener('click', () => (menu.hidden = !menu.hidden));

    list = el('div', 'list');
    typingLine = el('div', 'typing');

    // 입력줄: 이모지 선택기 버튼 + 입력 + 전송
    input = el('input');
    input.placeholder = '메시지 입력';
    input.maxLength = 300;
    input.autocomplete = 'off';
    // 사이트의 단축키(스페이스=재생 등)가 입력 중에 동작하지 않도록 키 이벤트를 여기서 끊는다
    for (const t of ['keydown', 'keyup', 'keypress']) input.addEventListener(t, (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        submit();
      }
    });
    input.addEventListener('input', noteTyping);
    const emo = el('button', 'emo', '😊');
    emo.title = '이모지';
    emo.addEventListener('click', () =>
      openPicker(
        emo,
        (emoji) => {
          const s = input.selectionStart ?? input.value.length;
          const e = input.selectionEnd ?? s;
          input.value = input.value.slice(0, s) + emoji + input.value.slice(e);
          input.focus();
          input.setSelectionRange(s + emoji.length, s + emoji.length);
          noteTyping();
        },
        true, // 여러 개 연속 입력 가능
      ),
    );
    const send = el('button', 'send', '전송');
    send.addEventListener('click', submit);
    const form = el('div', 'form');
    form.append(emo, input, send);

    // 크기 조절 핸들
    const handles = [
      ['rz rz-l', -1, 0],
      ['rz rz-r', 1, 0],
      ['rz rz-b', 0, 1],
      ['rz rz-bl', -1, 1],
      ['rz rz-br', 1, 1],
    ].map(([cls, dx, dy]) => {
      const h = el('div', cls);
      dragResize(h, dx, dy);
      return h;
    });
    dragMove(head);
    head.append(menu); // 메뉴는 헤더 기준으로 배치
    panel.append(head, list, typingLine, reactionRow(), form, ...handles);

    // 접힌 상태: 말풍선 + 배지, 마우스를 올리면 리액션 버튼
    bubbleBox = el('div', 'dock-bubble');
    const bubble = el('button', 'bubble', '💬');
    bubble.title = '채팅 열기';
    badge = el('span', 'badge');
    bubble.append(badge);
    bubble.addEventListener('click', () => {
      prefs.collapsed = false;
      applyPrefs();
      scrollToBottom(true);
      savePrefs();
      input.focus();
    });
    bubbleBox.append(reactionRow(), bubble);

    floats = el('div', 'floats');

    // 이모지 선택기 팝오버(하나를 공유)
    pop = el('div', 'pop');
    pop.hidden = true;
    picker = createEmojiPicker({ onPick: (emoji) => picker.onPick?.(emoji) });
    pop.append(picker.el);
    wrap.addEventListener('pointerdown', (e) => {
      if (!pop.hidden && !e.composedPath().includes(pop) && e.target !== popAnchor) closePicker();
      if (!menu.hidden && !e.composedPath().includes(menu) && !e.composedPath().some((n) => n === settingsBtn)) menu.hidden = true;
    });
    window.addEventListener('pointerdown', (e) => {
      if (!e.composedPath().includes(mount.host)) {
        closePicker();
        menu.hidden = true;
      }
    });
    window.addEventListener('resize', () => built && applyPrefs());
    document.addEventListener('fullscreenchange', () => built && applyPrefs());

    wrap.append(panel, bubbleBox, floats, pop); // 리액션/선택기가 패널 위에 그려지도록 뒤에
    root.append(wrap);
    applyPrefs();
    renderEmpty();
    updateRoomCode();
  }

  function updateRoomCode() {
    if (!built) return;
    const code = getState()?.roomCode ?? '';
    codeChip.textContent = code;
    codeChip.title = '방 코드 복사';
    codeChip.hidden = !code;
  }

  return {
    show() {
      build();
      mount.ensure();
      updateRoomCode();
      applyPrefs();
    },

    // 방을 나가거나 방이 사라졌을 때
    hide() {
      if (!built) return;
      setPageInset(0, prefs.dockFit);
      closePicker();
      menu.hidden = true;
      mount.remove();
      stopTyping();
      for (const t of typingTimers.values()) clearTimeout(t);
      typingTimers.clear();
      list.replaceChildren();
      messages.length = 0;
      lastEvent.clear();
      unread = 0;
      renderBadge();
      renderTyping();
      renderEmpty();
    },

    // 새로고침 후 복구: background 가 보관한 최근 메시지
    loadHistory(history) {
      build();
      if (messages.length) return;
      for (const m of history) renderMessage(m);
      scrollToBottom(true);
    },

    addMessage(m) {
      build();
      if (m.kind === 'event') {
        // 재생/일시정지/이동 알림: 안 읽은 수나 토스트에는 포함하지 않는다
        renderEvent(m);
        scrollToBottom(false);
        return;
      }
      const mine = m.userId === getState()?.userId;
      renderMessage(m);
      scrollToBottom(mine);
      // 발신자의 입력 중 표시 해제
      clearTimeout(typingTimers.get(m.userId));
      typingTimers.delete(m.userId);
      renderTyping();
      if (prefs.collapsed && !mine) {
        unread++;
        renderBadge();
        const t = m.text.length > 40 ? `${m.text.slice(0, 40)}…` : m.text;
        onNotify(`${profileOf(m.userId).name}: ${t}`);
      }
    },

    // 프로필이 바뀌면 기존 메시지의 이름/프사/색도 갱신
    refreshProfiles() {
      if (!built) return;
      for (const m of messages) {
        if (m.kind === 'event') m.el.textContent = eventText(m); // 이름이 바뀌었을 수 있음
        else applyProfile(m.el, m.userId);
      }
      renderTyping();
      updateRoomCode();
    },

    setTyping(userId, isTyping) {
      build();
      clearTimeout(typingTimers.get(userId));
      if (isTyping) typingTimers.set(userId, setTimeout(() => (typingTimers.delete(userId), renderTyping()), TYPING_IDLE_MS));
      else typingTimers.delete(userId);
      renderTyping();
    },

    showReaction(userId, emoji) {
      build();
      mount.ensure();
      while (floats.childElementCount >= MAX_FLOATS) floats.firstChild.remove();
      const f = el('div', 'float');
      f.style.left = `${22 + Math.random() * 40}%`; // 영상이 있을 법한 가운데 영역
      f.append(el('span', 'e', emoji), el('span', 'n', profileOf(userId).name));
      floats.append(f);
      setTimeout(() => f.remove(), 2900);
    },
  };
}
