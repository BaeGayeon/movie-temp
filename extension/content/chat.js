// 채팅 사이드바 + 이모지 리액션. 모든 사용자 텍스트는 textContent 로만 렌더링한다(XSS 방지).
//  - 두 가지 배치: "떠 있는 창"(헤더를 끌어 이동, 가장자리로 크기 조절) / "화면 오른쪽에 붙이기"(화면 분할처럼 페이지를 줄임)
//  - 메시지 옆에 작성 시각 / 재생 시각 표시(설정에서 각각 켜고 끔)
//  - 방 코드·초대 링크 복사, 이모지 전체 선택(채팅 입력, 리액션)
import { createLayer } from './ui.js';
import { REACTION_GROUPS, REACTION_EMOJIS } from '../shared/protocol.js';
import { renderAvatar } from '../shared/avatar.js';
import { SHADOW_THEME_CSS, pastelize } from '../shared/theme.js';
import { createEmojiPicker, EMOJI_PICKER_CSS } from '../shared/emoji-picker.js';

const CSS = `
  :host { all: initial; }
  ${SHADOW_THEME_CSS}
  * { box-sizing: border-box; }
  .root { position: fixed; inset: 0; pointer-events: none; font: 14px/1.45 var(--font); color: var(--ink); }
  button { font: inherit; cursor: pointer; border: 0; color: inherit; }

  /* ---- 패널: 장식 없이 차분하게 ---- */
  .panel { position: absolute; pointer-events: auto; display: flex; flex-direction: column;
    background: var(--bg); border: 1px solid var(--border-2); border-radius: 16px; box-shadow: var(--shadow-lg); overflow: hidden; }
  .panel.dock { border-radius: 0; border-width: 0; box-shadow: none; }
  .panel.side { border-width: 0 0 0 1px; }
  .panel[hidden], .dock-bubble[hidden] { display: none; }
  .head { position: relative; display: flex; align-items: center; gap: 4px; padding: 6px 8px 6px 12px; user-select: none; color: var(--head-ink);
    background: var(--surface); border-bottom: 1px solid var(--border); }
  .panel.free .head { cursor: move; }
  .head .title { font-weight: 700; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .iconbtn { background: transparent; font-size: 15px; padding: 2px 6px; border-radius: 8px; color: var(--ink-soft); }
  .iconbtn:hover { background: var(--head-chip); color: var(--ink); }

  .menu { position: absolute; top: calc(100% + 6px); left: 8px; right: 8px; margin-left: auto; max-width: 240px; max-height: calc(100vh - 80px); overflow-y: auto; z-index: 5; background: var(--surface); color: var(--ink); border: 1px solid var(--border-3);
    border-radius: 14px; padding: 10px; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
  .menu[hidden] { display: none; }
  .menu label { display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 500; }
  .menu input[type=range], .menu input[type=checkbox] { accent-color: var(--accent); }
  .menu input[type=range] { flex: 1; }
  .seg { display: flex; gap: 2px; padding: 2px; background: var(--bg); border-radius: 10px; }
  .seg button { flex: 1; background: transparent; color: var(--ink-soft); border-radius: 8px; padding: 4px 0; font-size: 12px; }
  .seg button.on { background: var(--surface-3); color: var(--ink); }
  .menu .act { background: var(--surface-2); color: var(--ink); font-weight: 500; border-radius: 10px; padding: 6px 12px; text-align: left; }
  .menu .act:hover { background: var(--surface-3); }

  /* ---- 메시지: 말풍선은 무난하게, 닉네임은 글자색으로 ---- */
  .list, .ep-grid { scrollbar-width: thin; scrollbar-color: var(--surface-3) transparent; } /* 스크롤바가 하얗게 튀지 않게 */
  .list { flex: 1; overflow-y: auto; padding: 10px 10px 6px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
  .msg { display: flex; gap: 8px; align-items: flex-start; }
  .msg.me { flex-direction: row-reverse; }
  .av { flex: none; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; overflow: hidden; }
  .body { min-width: 0; max-width: calc(100% - 40px); display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
  .msg.me .body { align-items: flex-end; }
  .name { display: flex; align-items: baseline; gap: 6px; font-size: 12px; }
  .msg.me .name { flex-direction: row-reverse; }
  .name-text { font-weight: 700; } /* 색은 사용자가 고른 색(파스텔로 보정) */
  .meta { font-weight: 400; color: var(--ink-soft); font-size: 11px; }
  .text { word-break: break-word; white-space: pre-wrap; background: var(--surface-2); border-radius: 4px 12px 12px 12px; padding: 6px 11px; }
  .msg.me .text { background: var(--bubble-me); border-radius: 12px 4px 12px 12px; }
  /* 줄글/간단 모드: 말풍선 없이 왼쪽 정렬. 줄글 = 프사 | 이름·시각 / 내용, 간단 = 이름·시각 / 내용(프사 없음) */
  .list.plain .msg { margin-bottom: 6px; } /* 안내 문구와의 간격은 말풍선 모드와 같게(.list 의 gap) */
  .list.compact .msg { margin-bottom: 2px; }
  .list.plain .msg, .list.plain .msg.me, .list.compact .msg, .list.compact .msg.me { flex-direction: row; gap: 10px; }
  .list.compact .av { display: none; }
  .list.plain .body, .list.plain .msg.me .body, .list.compact .body, .list.compact .msg.me .body { flex: 1; max-width: none; align-items: flex-start; gap: 3px; }
  .list.plain .name, .list.plain .msg.me .name, .list.compact .name, .list.compact .msg.me .name { flex-direction: row; }
  .list.plain .text, .list.plain .msg.me .text, .list.compact .text, .list.compact .msg.me .text { background: none; padding: 0; border-radius: 0; }
  .sys { align-self: center; text-align: center; color: var(--ink-soft); font-size: 12px; padding: 0 8px; max-width: 100%; } /* 안내 문구: 어느 모드에서나 가운데, 말풍선 없이 글만 */
  .no-events .sys { display: none; }
  .empty { color: var(--ink-soft); text-align: center; padding: 18px 0; font-size: 13px; }

  .typing { min-height: 18px; padding: 0 14px 2px; font-size: 12px; color: var(--ink-soft); }
  .reacts { display: flex; gap: 0; padding: 2px 8px; flex-wrap: wrap; align-items: center; }
  .reacts .grp { display: flex; margin-right: 8px; } /* 감정이 비슷한 것끼리 묶고 묶음 사이에 간격 */
  .reacts .brk { flex-basis: 100%; height: 0; } /* 최근 이모지가 있으면 그 줄을 따로 쓴다(＋ 가 혼자 떨어지지 않도록) */
  .reacts .brk[hidden] { display: none; }
  .reacts .rlabel { font-size: 11px; color: var(--ink-soft); padding: 0 6px 0 4px; }
  .reacts .rlabel[hidden] { display: none; }
  .reacts .grp[hidden] { display: none; }
  .reacts .grp.recent { margin-right: 4px; } /* 최근에 직접 고른 이모지(기본 목록에 없는 것) */
  .reacts button { background: transparent; font-size: 17px; border-radius: 8px; padding: 2px 4px; transition: transform .08s; }
  .reacts button:hover { background: var(--surface-2); transform: scale(1.15); }
  .form { display: flex; gap: 6px; padding: 6px 8px 10px; align-items: center; }
  .form .emo { background: transparent; font-size: 20px; padding: 2px 4px; border-radius: 8px; }
  .form .emo:hover { background: var(--surface-2); }
  .form input { flex: 1; min-width: 0; font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--border-2); border-radius: 999px; padding: 6px 12px; outline: none; }
  .form input::placeholder { color: var(--placeholder); }
  .form input:focus { border-color: var(--border-3); }
  .form .send { color: var(--on-accent); font-weight: 600; background: var(--accent); border-radius: 999px; padding: 6px 14px; }
  .form .send:hover { background: var(--accent-light); }

  .rz { position: absolute; }
  .rz-l { left: 0; top: 0; bottom: 0; width: 6px; cursor: ew-resize; }
  .rz-r { right: 0; top: 0; bottom: 0; width: 6px; cursor: ew-resize; }
  .rz-b { left: 0; right: 0; bottom: 0; height: 6px; cursor: ns-resize; }
  .rz-bl { left: 0; bottom: 0; width: 14px; height: 14px; cursor: nesw-resize; }
  .rz-br { right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize; }
  .panel.dock .rz-r, .panel.dock .rz-b, .panel.dock .rz-bl, .panel.dock .rz-br { display: none; }

  /* ---- 접힌 상태 ---- */
  .dock-bubble { position: absolute; right: 16px; bottom: 90px; pointer-events: auto; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
  .bubble { position: relative; width: 46px; height: 46px; border-radius: 50%; background: var(--surface); border: 1px solid var(--border-3);
    font-size: 22px; box-shadow: var(--shadow-lg); transition: transform .1s; }
  .bubble:hover { transform: scale(1.06); }
  .badge { position: absolute; top: -5px; right: -5px; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--pink); color: #fff;
    font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  .badge[hidden] { display: none; }
  .dock-bubble .reacts { display: none; background: var(--surface); border: 1px solid var(--border-2); border-radius: 14px; padding: 4px 8px; box-shadow: var(--shadow); max-width: 260px; justify-content: center; }
  .dock-bubble:hover .reacts { display: flex; }

  .pop { position: absolute; pointer-events: auto; }
  .pop[hidden] { display: none; }

  /* ---- 리액션: --size 이모지 크기(영상 폭에 비례), --rise 떠오르는 높이, --dx 좌우 흔들림 ----
     떠오르는 도중에 크기가 출렁이면 버벅이는 것처럼 보여서, 나타날 때만 아주 짧게(약 0.1초) 커지고 곧바로 떠오른다. */
  .floats { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .float { position: absolute; display: flex; flex-direction: column; align-items: center; animation: rise 2.4s cubic-bezier(.2,.6,.3,1) forwards; }
  .float .e { font-size: var(--size, 44px); line-height: 1.1; filter: drop-shadow(0 2px 4px rgba(0,0,0,.4)); }
  .float .n { font-size: var(--nsize, 11px); font-weight: 600; color: var(--ink); background: var(--surface); border-radius: 999px; padding: 0 8px; white-space: nowrap; opacity: .85; }
  @keyframes rise { 0% { transform: translate(0, 0) scale(.88); opacity: 0; }
    4% { transform: translate(0, 0) scale(1); opacity: .8; }
    75% { opacity: .8; }
    100% { transform: translate(var(--dx, 0px), calc(var(--rise, 300px) * -1)) scale(1); opacity: 0; } }
` + EMOJI_PICKER_CSS;

const DEFAULT_PREFS = {
  collapsed: false,
  opacities: { float: 0.85, side: 0.85, dock: 1 }, // 창 모드마다 따로 기억하는 불투명도(투명도 = 1 - 값)
  mode: 'float', // 'float' = 떠 있는 창, 'side' = 오른쪽에 띄우기(영상은 그대로), 'dock' = 오른쪽에 붙이기(영상 축소)
  width: 300,
  height: 420,
  dockWidth: 340,
  x: null, // 떠 있는 창 위치(null 이면 오른쪽 위)
  y: null,
  showClock: true, // 작성 시각
  showVideoTime: true, // 재생 시각
  showEvents: true, // 재생/일시정지/시간 이동 알림
  style: 'bubble', // 대화 표시 방식: 'bubble' = 말풍선, 'plain' = 줄글(프사 + 이름/내용), 'compact' = 간단(이름/내용)
  hidden: false, // 채팅을 완전히 숨김(팝업에서 다시 켠다)
  v: 2,
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
// getReactionArea(): 리액션이 퍼질 영역(영상의 화면상 사각형, 없으면 null). onSend(text) / onTyping(bool) / onReaction(emoji) / onNotify(text)
export function createChat({ getState, getInviteLink, getReactionArea, onSend, onTyping, onReaction, onNotify }) {
  const mount = createLayer(CSS, { topLayer: true }); // 페이지 축소(transform)의 영향을 받지 않도록 최상위 레이어에
  let built = false;
  let prefs = { ...DEFAULT_PREFS };
  const messages = []; // { userId, text, sentAt, videoTime, el }
  let unread = 0;

  // DOM 참조
  let wrap, panel, head, list, typingLine, input, bubbleBox, badge, floats, menu, opacity, clockCb, videoCb, eventsCb, modeBtn, pop, picker, styleSeg;

  try {
    chrome.storage.local.get('chatPrefs').then((r) => {
      prefs = { ...DEFAULT_PREFS, ...(r.chatPrefs ?? {}) };
      prefs.opacities = { ...DEFAULT_PREFS.opacities, ...(r.chatPrefs?.opacities ?? {}) };
      prefs.v = 2;
      if (built) applyPrefs();
    });
    // 팝업에서 채팅을 숨기거나 다시 보이게 한 경우
    chrome.storage.onChanged.addListener((ch, area) => {
      const next = ch.chatPrefs?.newValue;
      if (area !== 'local' || !next || next.hidden === prefs.hidden) return;
      prefs.hidden = !!next.hidden;
      if (built) applyPrefs();
    });
  } catch {}
  const savePrefs = () => {
    try {
      chrome.storage.local.set({ chatPrefs: prefs });
    } catch {}
  };

  const profileOf = (userId) => {
    // 지금 방에 있는 사람 -> 아니면 방에 있었던 사람의 기억된 프로필(나간 뒤에도 지난 메시지의 닉네임/프사 유지)
    const st = getState();
    const p = st?.participants?.find((x) => x.id === userId) ?? st?.known?.[userId];
    return p ?? { name: '알 수 없음', color: '#aab', avatar: { kind: 'emoji', value: '❔', bg: '#555' } };
  };

  // ---------- 페이지 분할(오른쪽에 붙이기) ----------
  // 사이트 화면을 채팅 왼쪽 영역에 맞춘다: <html> 폭을 줄인다.
  //  - 스크롤이 없는 페이지(시청 화면): html 에 항등 transform 을 걸어 position:fixed 요소(플레이어)의 기준을 html 로 만들어
  //    함께 줄어들게 한다. 화면을 비율로 줄이지 않으므로 사이트가 영상 위치로 계산하는 자막도 어긋나지 않는다.
  //    html 높이가 내용 높이(fixed 만 있으면 0)가 되어 영상이 사라지지 않도록 min-height:100vh, 가짜 스크롤바는 overflow:hidden 으로 막는다.
  //  - 스크롤되는 페이지: fixed 요소가 문서에 묶여 스크롤에 딸려 나가므로 transform 은 쓰지 않고 폭만 줄인다.
  const FIT_PROPS = ['width', 'transform', 'min-height', 'overflow'];
  let savedStyles = null; // 원래 <html> 인라인 스타일(복구용)

  const clearFit = (html) => {
    for (const p of FIT_PROPS) html.style.removeProperty(p);
  };
  // 우리가 건 스타일이 없는 상태에서 문서가 스크롤되는지 잰다
  const isScrollable = (html) => {
    clearFit(html);
    return window.scrollY > 0 || html.scrollHeight > window.innerHeight + 2;
  };

  function setPageInset(px) {
    const html = document.documentElement;
    if (px <= 0) {
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
    const trick = !isScrollable(html);
    clearFit(html);
    const set = (name, value) => html.style.setProperty(name, value, 'important');
    set('width', `calc(100% - ${px}px)`);
    if (trick) {
      set('transform', 'translate(0, 0)');
      set('min-height', '100vh');
      set('overflow', 'hidden');
    }
  }

  // ---------- 전체화면에서 붙이기 ----------
  // 전체화면에서는 그 요소만 최상위 레이어에 그려지고 UA 스타일이 폭/위치를 !important 로 고정해서 html 폭을 줄여도 소용없다.
  // padding-right 는 막지 않으므로 전체화면 요소에 padding-right 를 줘서(안쪽 영상이 줄어든다) 채팅 폭을 비우고,
  // 화면 오른쪽 끝에 붙어 있는 absolute/fixed 요소(컨트롤 막대 등)는 같은 만큼 안쪽으로 밀어서 채팅에 가려지지 않게 한다.
  let fsFit = null; // { el, px, pad: [값, 우선순위], touched: Map(요소 -> { kind, prev: [[속성, 값, 우선순위]] }) }
  let fsTimer = null;
  const FS_PROPS = { w: ['max-width'], m: ['margin-right'] };
  function applyFsProps(e, kind, px) {
    e.style.setProperty(FS_PROPS[kind][0], kind === 'w' ? `calc(100% - ${px}px)` : `${px}px`, 'important');
  }
  function fsSweep() {
    if (!fsFit) return;
    const vw = window.innerWidth;
    for (const e of fsFit.el.querySelectorAll('*')) {
      if (fsFit.touched.has(e)) continue;
      const cs = getComputedStyle(e);
      if ((cs.position !== 'absolute' && cs.position !== 'fixed') || parseFloat(cs.right) !== 0) continue;
      const r = e.getBoundingClientRect();
      if (r.width <= 0 || r.right < vw - 1) continue; // 이미 줄어든 부모 안쪽이거나 오른쪽 끝이 아님
      const kind = r.width >= vw * 0.9 ? 'w' : 'm'; // 가로로 꽉 찬 것은 폭을 줄이고, 오른쪽 끝에 붙은 작은 것은 안쪽으로 민다
      const prop = FS_PROPS[kind][0];
      fsFit.touched.set(e, { kind, prev: [e.style.getPropertyValue(prop), e.style.getPropertyPriority(prop)] });
      applyFsProps(e, kind, fsFit.px);
    }
  }
  function clearFsFit() {
    clearInterval(fsTimer);
    fsTimer = null;
    if (!fsFit) return;
    const { el, pad, touched } = fsFit;
    fsFit = null;
    if (pad[0]) el.style.setProperty('padding-right', pad[0], pad[1]);
    else el.style.removeProperty('padding-right');
    for (const [e, { kind, prev }] of touched) {
      const prop = FS_PROPS[kind][0];
      if (prev[0]) e.style.setProperty(prop, prev[0], prev[1]);
      else e.style.removeProperty(prop);
    }
  }
  function fitFullscreen(px) {
    const el = document.fullscreenElement;
    if (px <= 0 || !el || el === document.documentElement) return clearFsFit();
    if (fsFit && fsFit.el !== el) clearFsFit();
    if (!fsFit) fsFit = { el, px, pad: [el.style.getPropertyValue('padding-right'), el.style.getPropertyPriority('padding-right')], touched: new Map() };
    fsFit.px = px;
    el.style.setProperty('padding-right', `${px}px`, 'important');
    for (const [e, { kind }] of fsFit.touched) applyFsProps(e, kind, px); // 채팅 폭을 바꾼 경우
    fsSweep();
    clearInterval(fsTimer);
    fsTimer = setInterval(fsSweep, 1000); // 나중에 생기는 요소(메뉴 등)도
  }

  const isDock = () => prefs.mode === 'dock' || prefs.mode === 'side'; // 오른쪽 가장자리에 세로로 꽉 차는 배치
  const isShrink = () => prefs.mode === 'dock'; // 영상(페이지)을 줄이는 배치
  // 창 모드는 버튼 하나로 전환: 떠 있는 창 <-> 오른쪽에 붙이기
  const modeState = () => (prefs.mode === 'dock' || prefs.mode === 'side' ? prefs.mode : 'float');
  const MODE_UI = {
    float: ['❐', '떠 있는 창 · 클릭하면 오른쪽에 띄워요(영상은 그대로)'],
    side: ['◧', '오른쪽에 띄움(영상은 그대로) · 클릭하면 영상을 줄여서 붙여요'],
    dock: ['◨', '오른쪽에 붙임(영상 축소) · 클릭하면 떠 있는 창으로'],
  };
  const NEXT_MODE = { float: 'side', side: 'dock', dock: 'float' };

  function applyPrefs() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const op = clamp(prefs.opacities[modeState()], 0.3, 1);
    panel.style.opacity = String(op);
    opacity.value = String(+(1 - op).toFixed(2)); // 슬라이더는 투명도(오른쪽일수록 투명)
    clockCb.checked = prefs.showClock;
    videoCb.checked = prefs.showVideoTime;
    eventsCb.checked = prefs.showEvents;
    list.classList.toggle('no-events', !prefs.showEvents);
    list.classList.toggle('plain', prefs.style === 'plain');
    list.classList.toggle('compact', prefs.style === 'compact');
    for (const b of styleSeg.children) b.classList.toggle('on', b.dataset.style === prefs.style);
    panel.hidden = prefs.collapsed || prefs.hidden;
    bubbleBox.hidden = !prefs.collapsed || prefs.hidden;
    panel.classList.toggle('dock', isDock());
    panel.classList.toggle('side', prefs.mode === 'side');
    panel.classList.toggle('free', !isDock()); // (리액션 애니메이션 클래스 .float 와 이름이 겹치면 안 된다)
    const [icon, tip] = MODE_UI[modeState()];
    modeBtn.textContent = icon;
    modeBtn.title = tip;

    let inset = 0;
    if (isDock()) {
      prefs.dockWidth = clamp(prefs.dockWidth, MIN_W, Math.min(600, vw - 200));
      Object.assign(panel.style, { left: 'auto', right: '0', top: '0', width: `${prefs.dockWidth}px`, height: '100%' });
      // 전체화면에서는 페이지를 줄일 수 없으니 영상 위에 겹쳐서 보여준다
      if (isShrink() && !prefs.collapsed && !prefs.hidden && !document.fullscreenElement) inset = prefs.dockWidth;
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
    setPageInset(built && mount.host?.isConnected ? inset : 0);
    fitFullscreen(isShrink() && !prefs.collapsed && !prefs.hidden && built && mount.host?.isConnected ? prefs.dockWidth : 0);
    if (!prefs.collapsed && !prefs.hidden) {
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
    picker.focusSearch(); // 열자마자 바로 검색어를 입력할 수 있게
    const r = anchor.getBoundingClientRect();
    const w = 288;
    const h = 300;
    pop.style.left = `${clamp(r.right - w, 8, window.innerWidth - w - 8)}px`;
    const above = r.top - h - 8;
    pop.style.top = `${above >= 8 ? above : Math.min(r.bottom + 8, window.innerHeight - h - 8)}px`;
  }

  // 최근에 직접 고른(기본 목록에 없는) 리액션 이모지를 최대 3개, 최신순으로 기본 목록 옆에 같이 보여준다
  const MAX_RECENT_REACTIONS = 3;
  let recentReactions = [];
  const reactionRows = []; // 패널의 줄 + 접힌 말풍선의 줄: 최근 목록이 바뀌면 모두 갱신
  try {
    chrome.storage.local.get('recentReactions').then((r) => {
      recentReactions = (r.recentReactions ?? []).slice(0, MAX_RECENT_REACTIONS);
      reactionRows.forEach((fn) => fn());
    });
  } catch {}

  function sendReaction(emoji) {
    if (!REACTION_EMOJIS.includes(emoji)) {
      recentReactions = [emoji, ...recentReactions.filter((e) => e !== emoji)].slice(0, MAX_RECENT_REACTIONS);
      try {
        chrome.storage.local.set({ recentReactions });
      } catch {}
      reactionRows.forEach((fn) => fn());
    }
    onReaction(emoji);
  }

  function reactionRow() {
    const row = el('div', 'reacts');
    for (const group of REACTION_GROUPS) {
      const grp = el('div', 'grp');
      for (const emoji of group) {
        const b = el('button', '', emoji);
        b.title = '리액션';
        b.addEventListener('click', () => sendReaction(emoji));
        grp.append(b);
      }
      row.append(grp);
    }
    const brk = el('div', 'brk');
    const rlabel = el('span', 'rlabel', '최근');
    const recent = el('div', 'grp recent');
    recent.title = '최근에 쓴 리액션';
    const renderRecent = () => {
      brk.hidden = rlabel.hidden = recent.hidden = recentReactions.length === 0;
      recent.replaceChildren(
        ...recentReactions.map((emoji) => {
          const b = el('button', '', emoji);
          b.title = '최근에 쓴 리액션';
          b.addEventListener('click', () => sendReaction(emoji));
          return b;
        }),
      );
    };
    reactionRows.push(renderRecent);
    renderRecent();
    row.append(brk, rlabel, recent);
    const more = el('button', '', '＋');
    more.title = '모든 이모지 (검색도 돼요)';
    more.addEventListener('click', () => openPicker(more, (emoji) => sendReaction(emoji), false));
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
    name.style.color = pastelize(p.color); // 닉네임은 고른 색의 글자색으로. 어두운 배경에서 잘 보이게 파스텔톤으로 보정
  }

  // ---------- 재생/일시정지/시간 이동 알림 ----------
  const lastEvent = new Map(); // userId -> { entry, at } — 연속 이벤트 합치기용
  function eventText(m) {
    // 입장/퇴장: 알고 있는(방에 있거나 있었던) 사람의 현재 닉네임을 우선 쓰고, 모르면 알림이 만들어질 때 저장한 닉네임(m.name)을 쓴다
    const st = getState();
    const known = st?.participants?.find((x) => x.id === m.userId) ?? st?.known?.[m.userId];
    const name = m.action === 'join' || m.action === 'leave' ? (known?.name ?? m.name ?? '알 수 없음') : profileOf(m.userId).name;
    const who = `${name}님이`; // 내 동작도 "내가" 가 아니라 닉네임으로
    if (m.action === 'join') return `🎈 ${who} 입장했어요`;
    if (m.action === 'leave') return `👋 ${who} 퇴장했어요`;
    const t = fmtVideo(m.time);
    if (m.action === 'play') return `▶ ${who} 재생했어요 · ${t}`;
    if (m.action === 'pause') return `⏸ ${who} 일시정지했어요 · ${t}`;
    return `⏩ ${who} ${t} 위치로 이동했어요`; // 이동(+재생)은 한 가지 문구로
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
    const settingsBtn = el('button', 'iconbtn', '⚙');
    settingsBtn.title = '설정';
    modeBtn = el('button', 'iconbtn');
    modeBtn.addEventListener('click', () => {
      prefs.mode = NEXT_MODE[modeState()];
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
    head.append(el('span', 'title', '💬 채팅'), settingsBtn, modeBtn, collapseBtn);

    // 설정 메뉴: 투명도, 시간 표시, 링크/코드 복사
    menu = el('div', 'menu');
    menu.hidden = true;
    opacity = el('input');
    opacity.type = 'range';
    opacity.min = '0';
    opacity.max = '0.7';
    opacity.step = '0.05';
    opacity.addEventListener('input', () => {
      prefs.opacities[modeState()] = +(1 - Number(opacity.value)).toFixed(2); // 지금 창 모드에만 적용
      panel.style.opacity = String(prefs.opacities[modeState()]);
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
    [eventsLabel, eventsCb] = checkbox('재생·이동·입퇴장 알림 표시', 'showEvents');
    styleSeg = el('div', 'seg');
    for (const [k, t] of [['bubble', '말풍선'], ['plain', '줄글'], ['compact', '간단']]) {
      const b = el('button', '', t);
      b.dataset.style = k;
      b.addEventListener('click', () => {
        prefs.style = k;
        applyPrefs();
        scrollToBottom(true);
        savePrefs();
      });
      styleSeg.append(b);
    }
    const copyLink = el('button', 'act', '🔗 초대 링크 복사');
    copyLink.addEventListener('click', async () => (await copyText(getInviteLink())) && flash(copyLink, '✔ 복사됨!'));
    const copyCode = el('button', 'act', '📋 방 코드 복사');
    copyCode.addEventListener('click', async () => (await copyText(getState()?.roomCode ?? '')) && flash(copyCode, '✔ 복사됨!'));
    const hideBtn = el('button', 'act', '🙈 채팅 숨기기');
    hideBtn.addEventListener('click', () => {
      prefs.hidden = true;
      menu.hidden = true;
      applyPrefs();
      savePrefs();
    });
    menu.append(opLabel, styleSeg, clockLabel, videoLabel, eventsLabel, copyLink, copyCode, hideBtn);
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
    picker.onEscape = closePicker;
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
  }

  return {
    show() {
      build();
      mount.ensure();
      applyPrefs();
    },

    // 방을 나가거나 방이 사라졌을 때
    hide() {
      if (!built) return;
      setPageInset(0);
      clearFsFit();
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
        // 알림 줄: 안 읽은 수에는 포함하지 않는다. 입퇴장만 채팅이 접혀 있을 때 토스트로 알려 준다.
        renderEvent(m);
        scrollToBottom(false);
        if ((prefs.collapsed || prefs.hidden) && prefs.showEvents && (m.action === 'join' || m.action === 'leave')) onNotify(eventText(m));
        return;
      }
      const mine = m.userId === getState()?.userId;
      renderMessage(m);
      scrollToBottom(mine);
      // 발신자의 입력 중 표시 해제
      clearTimeout(typingTimers.get(m.userId));
      typingTimers.delete(m.userId);
      renderTyping();
      if ((prefs.collapsed || prefs.hidden) && !mine) {
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
    },

    setTyping(userId, isTyping) {
      build();
      clearTimeout(typingTimers.get(userId));
      if (isTyping) typingTimers.set(userId, setTimeout(() => (typingTimers.delete(userId), renderTyping()), TYPING_IDLE_MS));
      else typingTimers.delete(userId);
      renderTyping();
    },

    // 리액션을 영상 전체에 걸쳐 흩뿌려 띄운다. 크기와 떠오르는 높이는 영상(화면 축소/창 크기 포함)에 비례한다.
    showReaction(userId, emoji) {
      build();
      mount.ensure();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let a = getReactionArea?.();
      if (!a || a.width < 80 || a.height < 60) {
        // 영상 위치를 모를 때(iframe 안 영상 등): 채팅에 가려지지 않는 화면 영역 전체
        const docked = isShrink() && !prefs.collapsed && !prefs.hidden && !document.fullscreenElement;
        a = { left: 0, top: 0, width: docked ? vw - prefs.dockWidth : vw, height: vh };
      }
      const left = Math.max(0, a.left);
      const top = Math.max(0, a.top);
      const w = Math.max(40, Math.min(vw, a.left + a.width) - left);
      const h = Math.max(40, Math.min(vh, a.top + a.height) - top);
      const size = clamp(w * 0.035, 16, 42) * (0.85 + Math.random() * 0.3);

      while (floats.childElementCount >= MAX_FLOATS) floats.firstChild.remove();
      const f = el('div', 'float');
      f.style.setProperty('--size', `${size.toFixed(1)}px`);
      f.style.setProperty('--nsize', `${clamp(size * 0.28, 9, 14).toFixed(1)}px`);
      f.style.setProperty('--rise', `${(h * 0.62).toFixed(0)}px`);
      f.style.setProperty('--dx', `${((Math.random() - 0.5) * size * 2.5).toFixed(0)}px`);
      f.style.left = `${(left + size * 0.4 + Math.random() * Math.max(0, w - size * 2.4)).toFixed(0)}px`;
      f.style.top = `${(top + h * 0.78 - size).toFixed(0)}px`;
      f.append(el('span', 'e', emoji), el('span', 'n', profileOf(userId).name));
      floats.append(f);
      setTimeout(() => f.remove(), 2500); // 애니메이션(2.4초)이 끝난 뒤 정리
    },
  };
}
