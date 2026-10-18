// 채팅 사이드바 + 이모지 리액션. 모든 사용자 텍스트는 textContent 로만 렌더링한다(XSS 방지).
//  - 두 가지 배치: "떠 있는 창"(헤더를 끌어 이동, 가장자리로 크기 조절) / "화면 오른쪽에 붙이기"(화면 분할처럼 페이지를 줄임)
//  - 메시지 옆에 작성 시각 / 재생 시각 표시(설정에서 각각 켜고 끔)
//  - 방 코드·초대 링크 복사, 이모지 전체 선택(채팅 입력, 리액션)
import { createLayer } from './ui.js';
import { REACTION_GROUPS, REACTION_EMOJIS, MAX_CHAT_LENGTH } from '../shared/protocol.js';
import { renderAvatar } from '../shared/avatar.js';
import { SHADOW_THEME_CSS, BLACK_THEME_CSS, pastelize } from '../shared/theme.js';
import { createEmojiPicker, EMOJI_PICKER_CSS } from '../shared/emoji-picker.js';
import { t, getLang, onLangChange } from '../shared/i18n.js';

const CSS = `
  :host { all: initial; }
  ${SHADOW_THEME_CSS}
  ${BLACK_THEME_CSS}
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
  .iconbtn { display: inline-flex; align-items: center; background: transparent; font-size: 15px; padding: 2px 6px; border-radius: 8px; color: var(--ink-soft); }
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
  .menu .sec { font-size: 11px; font-weight: 700; color: var(--ink-soft); margin-top: 4px; }
  .menu .sec:first-child { margin-top: 0; }
  .menu .act { background: var(--surface-2); color: var(--ink); font-weight: 500; border-radius: 10px; padding: 6px 12px; text-align: left; }
  .menu .act:hover { background: var(--surface-3); }

  /* ---- 메시지: 말풍선은 무난하게, 닉네임은 글자색으로 ---- */
  .list, .ep-grid { scrollbar-width: thin; scrollbar-color: var(--surface-3) transparent; } /* 스크롤바가 하얗게 튀지 않게 */
  .list { font-size: calc(14px * var(--fs, 1.1)); flex: 1; overflow-y: auto; padding: 10px 10px 6px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
  .msg { display: flex; gap: 8px; align-items: flex-start; }
  .msg.me { flex-direction: row-reverse; }
  .av { flex: none; width: var(--av, 34px); height: var(--av, 34px); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: calc(var(--av, 34px) * .57); overflow: hidden; }
  .body { min-width: 0; max-width: calc(100% - var(--av, 34px) - 12px); display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
  .msg.me .body { align-items: flex-end; }
  .name { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 6px; font-size: .857em; }
  .msg.me .name { flex-direction: row-reverse; }
  .name-text { font-weight: 700; white-space: nowrap; } /* 색은 사용자가 고른 색(파스텔로 보정) */
  .meta { font-weight: 400; color: var(--ink-soft); font-size: .92em; white-space: nowrap; }
  .text { word-break: break-word; overflow-wrap: anywhere; white-space: pre-wrap; background: var(--surface-2); border-radius: 4px 12px 12px 12px; padding: 6px 11px; }
  .msg.me .text { background: var(--bubble-me); border-radius: 12px 4px 12px 12px; }
  /* 줄글/간단 모드: 말풍선 없이 왼쪽 정렬. 줄글 = 프사 | 이름·시각 / 내용, 간단 = 이름·시각 / 내용(프사 없음) */
  .list.plain .msg { margin-bottom: 6px; } /* 안내 문구와의 간격은 말풍선 모드와 같게(.list 의 gap) */
  .list.compact .msg { margin-bottom: 2px; }
  .list.plain .msg, .list.plain .msg.me, .list.compact .msg, .list.compact .msg.me { flex-direction: row; gap: 10px; }
  .list.compact .av { display: none; }
  .list.plain .body, .list.plain .msg.me .body, .list.compact .body, .list.compact .msg.me .body { flex: 1; max-width: none; align-items: flex-start; gap: 3px; }
  .list.plain .name, .list.plain .msg.me .name, .list.compact .name, .list.compact .msg.me .name { flex-direction: row; }
  .list.plain .text, .list.plain .msg.me .text, .list.compact .text, .list.compact .msg.me .text { background: none; padding: 0; border-radius: 0; }
  .sys { align-self: center; text-align: center; color: var(--ink-soft); font-size: .857em; padding: 0 8px; max-width: 100%; } /* 안내 문구: 어느 모드에서나 가운데, 말풍선 없이 글만 */
  .sys .ev-name { font-weight: 600; }
  .sys .evi { display: inline-block; width: 1em; height: 1em; vertical-align: -.12em; margin-right: .3em; fill: currentColor; }
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
  ::selection { background: var(--accent); color: var(--on-accent); } /* 사이트 기본 선택색이 안 보이는 경우가 있어 직접 지정 */
  .form { display: flex; gap: 6px; padding: 6px 8px 10px; align-items: stretch; }
  .compose { flex: 1; min-width: 0; position: relative; display: flex; }
  .form textarea { flex: 1; min-width: 0; display: block; resize: none; overflow-y: auto; font: inherit; line-height: 1.4; height: calc(2.8em + 14px); color: var(--ink); background: var(--surface); border: 1px solid var(--border-2); border-radius: 14px; padding: 6px 12px; outline: none;
    scrollbar-width: thin; scrollbar-color: var(--surface-3) transparent; }
  .form textarea::placeholder { color: var(--placeholder); }
  .form textarea:focus { border-color: var(--border-3); }
  .counter { position: absolute; right: 10px; bottom: 3px; font-size: 11px; color: var(--ink-soft); background: var(--surface); padding: 0 4px; border-radius: 6px; pointer-events: none; }
  .counter[hidden] { display: none; }
  .counter.warn { color: #e5484d; }
  .fold { background: none; padding: 0; margin-left: 6px; color: var(--ink-soft); text-decoration: underline; font-size: .9em; }
  .fold:hover { color: var(--ink); }
  .text a { color: inherit; text-decoration: underline; }
  /* 답장 버튼: 레이아웃에서 빼서(absolute) 말풍선 아래쪽 모서리에 띄운다. 창이 좁아도 줄바꿈/여백이 생기지 않는다. 마우스를 올렸을 때만 보인다 */
  .bwrap { position: relative; max-width: 100%; min-width: 0; }
  .rbtn { position: absolute; bottom: -9px; right: 4px; z-index: 1; width: 22px; height: 22px; padding: 0; display: flex; align-items: center; justify-content: center;
    border-radius: 50%; background: var(--surface-3); color: var(--ink); font-size: 12px; line-height: 1; box-shadow: 0 1px 4px rgba(0,0,0,.35); opacity: 0; pointer-events: none; transition: opacity .1s; }
  .msg:hover .rbtn, .rbtn:focus-visible { opacity: 1; pointer-events: auto; }
  .rbtn:hover { background: var(--accent); color: var(--on-accent); }
  .msg.me .rbtn { right: auto; left: 4px; transform: scaleX(-1); } /* 오른쪽 정렬(내 말풍선)에서는 반대쪽 모서리, 화살표도 반대로 */
  .list.plain .msg.me .rbtn, .list.compact .msg.me .rbtn { right: 4px; left: auto; transform: none; }
  .list.plain .bwrap, .list.compact .bwrap { align-self: stretch; } /* 말풍선이 없는 모드는 글자 끝이 아니라 줄(칸) 오른쪽 끝에 띄운다 */
  .quote { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; font-size: .857em; color: var(--ink-soft);
    background: transparent; border-left: 2px solid var(--border-3); padding: 0 0 0 6px; cursor: pointer; }
  .quote::before { content: '↩ '; }
  .quote:hover { color: var(--ink); }
  .msg.me .quote { text-align: right; border-left: 0; border-right: 2px solid var(--border-3); padding: 0 6px 0 0; } /* 오른쪽 정렬(내 말풍선)에서는 선과 화살표도 오른쪽 기준 */
  .msg.me .quote::before { content: ''; }
  .msg.me .quote::after { content: ' ↪'; }
  .list.plain .msg.me .quote, .list.compact .msg.me .quote { text-align: left; border-right: 0; border-left: 2px solid var(--border-3); padding: 0 0 0 6px; } /* 줄글/간단은 모두 왼쪽 정렬 */
  .list.plain .msg.me .quote::before, .list.compact .msg.me .quote::before { content: '↩ '; }
  .list.plain .msg.me .quote::after, .list.compact .msg.me .quote::after { content: ''; }
  .quote.gone { cursor: default; font-style: italic; }
  .replying { display: flex; align-items: center; gap: 6px; margin: 0 8px; padding: 4px 8px; font-size: 12px; color: var(--ink-soft); background: var(--surface-2); border-radius: 10px; }
  .replying[hidden] { display: none; }
  .replying .rtext { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .replying button { background: transparent; color: var(--ink-soft); padding: 0 4px; border-radius: 6px; }
  .replying button:hover { color: var(--ink); background: var(--surface-3); }
  @keyframes hl { 0%, 60% { box-shadow: 0 0 0 2px var(--accent); } 100% { box-shadow: 0 0 0 2px transparent; } }
  .msg.hl .text { animation: hl 1.4s ease-out; }
  /* 줄글/간단: 말풍선이 없으니 각진 테두리 대신 줄 전체에 은은한 색이 깔렸다 사라지게 */
  @keyframes hlrow { 0%, 50% { background: color-mix(in srgb, var(--accent) 28%, transparent); box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 28%, transparent); }
    100% { background: transparent; box-shadow: 0 0 0 5px transparent; } }
  .list.plain .msg.hl, .list.compact .msg.hl { border-radius: 8px; animation: hlrow 1.4s ease-out; }
  .list.plain .msg.hl .text, .list.compact .msg.hl .text { animation: none; }

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
  .float { position: absolute; display: flex; flex-direction: column; align-items: center; animation: rise 4.6s cubic-bezier(.25,.4,.4,1) forwards; }
  .float .e { font-size: var(--size, 44px); line-height: 1.1; filter: drop-shadow(0 2px 4px rgba(0,0,0,.4)); }
  .float .n { font-size: var(--nsize, 11px); font-weight: 600; color: var(--ink); background: var(--surface); border-radius: 999px; padding: 0 8px; white-space: nowrap; opacity: .85; }
  @keyframes rise { 0% { transform: translate(0, 0) scale(.88); opacity: 0; }
    4% { transform: translate(0, 0) scale(1); opacity: .8; }
    70% { opacity: .8; }
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
  fontFamily: '', // 채팅 글꼴(내 컴퓨터에 설치된 글꼴 이름). 비우면 기본(내장 SUIT)
  fontScale: 1.1, // 채팅 글자 크기 배율(기본 14px 의 1.1배)
  avatarSize: 34, // 채팅 프사 크기(px)
  style: 'bubble', // 대화 표시 방식: 'bubble' = 말풍선, 'plain' = 줄글(프사 + 이름/내용), 'compact' = 간단(이름/내용)
  theme: 'charcoal', // 채팅 바탕색: 'charcoal' = 차콜, 'black' = 검정
  hidden: false, // 채팅을 완전히 숨김(팝업에서 다시 켠다)
  v: 3,
};
const MIN_W = 220;
const MIN_H = 200;
const FOLD_CHARS = 250; // 이보다 길거나
const FOLD_LINES = 6; // 줄이 이보다 많으면 접어서 보여 준다
const snippet = (text) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 40 ? `${flat.slice(0, 40)}…` : flat;
};
const URL_RE = /https?:\/\/[^\s<>"'`]+/g;

// 접을 위치(문자열 인덱스). 접을 필요가 없으면 -1. 이모지(서로게이트 쌍)와 URL 한가운데서는 자르지 않는다.
function foldCut(text) {
  let cut = text.length;
  if (Array.from(text).length > FOLD_CHARS) cut = Array.from(text).slice(0, FOLD_CHARS).join('').length;
  let nl = -1;
  for (let i = 0; i < FOLD_LINES; i++) if ((nl = text.indexOf('\n', nl + 1)) < 0) break;
  if (nl >= 0 && nl < cut) cut = nl; // 줄 수 초과: 여섯 번째 줄 끝에서
  if (cut >= text.length) return -1;
  for (const m of text.matchAll(URL_RE)) {
    const [a, b] = [m.index, m.index + m[0].length];
    if (a < cut && cut < b) cut = a > 0 ? a : b; // 맨 앞 URL 이면 통째로 보여 준다
  }
  return cut >= text.length ? -1 : cut;
}

// URL 만 안전한 링크(a)로, 나머지는 글자 그대로 넣는다
function fillLinked(box, text) {
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0].replace(/[.,;:!?)\]}]+$/, '');
    let href = null;
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') href = u.href;
    } catch {}
    if (!href) continue;
    if (m.index > last) box.append(text.slice(last, m.index));
    const a = el('a', null, url);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    box.append(a);
    last = m.index + url.length;
  }
  if (last < text.length) box.append(text.slice(last));
}

const MAX_MESSAGES = 3000; // 알림 줄부터 지우므로 오래 이어진 대화가 사라지지 않는다
const PAUSE_SEEK_MERGE_MS = 4000; // 정지 직후의 이동(시크바 드래그)을 합치는 시간
const EVENT_MERGE_MS = 1500; // 같은 사람의 연속 이벤트(사이트가 시크할 때 pause→seek→play 를 내보냄)를 합치는 시간
const MAX_FLOATS = 30;
const TYPING_IDLE_MS = 3000;
const TYPING_RESEND_MS = 2000;
const EDGE = 16;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// 글꼴 이름만 저장한다(CSS 를 깨뜨릴 수 있는 글자는 뺀다). 없는 글꼴이면 뒤의 기본 글꼴로 보인다.
const cleanFont = (s) => String(s ?? '').replace(/["'\\;{}<>()]|[\u0000-\u001f]/g, '').trim().slice(0, 80);
const fontStack = (name) => (cleanFont(name) ? `"${cleanFont(name)}", var(--font)` : '');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const fmtClock = (ms) => new Date(ms).toLocaleTimeString(getLang() === 'ko' ? 'ko-KR' : 'en-US', { hour: 'numeric', minute: '2-digit' });
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
  // 전체화면을 켜고 끌 때 레이어를 다른 부모로 옮기면 목록 스크롤이 맨 위로 돌아가므로, 옮기기 전에 위치를 기억했다가 되돌린다
  let moveScroll = null;
  const mount = createLayer(CSS, {
    topLayer: true, // 페이지 축소(transform)의 영향을 받지 않도록 최상위 레이어에
    beforeMove: () => {
      if (list) moveScroll = { top: list.scrollTop, pinned: pinned };
    },
    afterMove: () => {
      if (!list || !moveScroll) return;
      list.scrollTop = moveScroll.pinned ? list.scrollHeight : moveScroll.top;
      pinned = moveScroll.pinned; // 옮기며 생긴 scroll 이벤트(0)가 위치를 "위로 올림"으로 오해하지 않게
    },
  });
  let built = false;
  let prefs = { ...DEFAULT_PREFS };
  let previewFont = null; // 글꼴 미리보기 중이면 그 이름('' = 기본 글꼴), 아니면 null
  let previewTimer = null;
  const messages = []; // { userId, text, sentAt, videoTime, el }
  let unread = 0;

  // DOM 참조
  let wrap, panel, head, list, typingLine, input, counter, replyBar, replyText, bubbleBox, badge, floats, menu, opacity, clockCb, videoCb, eventsCb, modeSeg, pop, picker, styleSeg, themeSeg;

  try {
    chrome.storage.local.get('chatPrefs').then((r) => {
      prefs = { ...DEFAULT_PREFS, ...(r.chatPrefs ?? {}) };
      prefs.opacities = { ...DEFAULT_PREFS.opacities, ...(r.chatPrefs?.opacities ?? {}) };
      if ((r.chatPrefs?.v ?? 0) < 3) {
        // 기본 크기를 키웠다(v3). 이전에 저장된 값은 기본값이었으므로 새 기본값으로 바꾼다
        prefs.fontScale = DEFAULT_PREFS.fontScale;
        prefs.avatarSize = DEFAULT_PREFS.avatarSize;
      }
      prefs.v = 3;
      if (built) applyPrefs();
    });
    // 팝업에서 채팅을 숨기거나 다시 보이게 한 경우
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && ch.chatFontPreview) {
        // 팝업에서 글꼴 목록을 훑는 동안의 미리보기(저장하지 않음). 팝업이 갱신을 멈추면(닫힘 등) 4초 뒤 원래 글꼴로 돌아온다.
        clearTimeout(previewTimer);
        const v = ch.chatFontPreview.newValue;
        previewFont = v && typeof v.name === 'string' ? cleanFont(v.name) : null;
        if (previewFont !== null) previewTimer = setTimeout(() => { previewFont = null; if (built) applyPrefs(); }, 4000);
        if (built) applyPrefs();
      }
      const next = ch.chatPrefs?.newValue;
      if (area !== 'local' || !next) return;
      // 팝업에서 바꾼 값(숨김, 글꼴, 글자/프사 크기)을 바로 반영한다
      const hiddenChanged = !!next.hidden !== prefs.hidden;
      const fontChanged = cleanFont(next.fontFamily) !== cleanFont(prefs.fontFamily);
      const sizeChanged = (next.fontScale != null && next.fontScale !== prefs.fontScale) || (next.avatarSize != null && next.avatarSize !== prefs.avatarSize);
      if (!hiddenChanged && !fontChanged && !sizeChanged) return;
      prefs.hidden = !!next.hidden;
      prefs.fontFamily = cleanFont(next.fontFamily);
      if (next.fontScale != null) prefs.fontScale = next.fontScale;
      if (next.avatarSize != null) prefs.avatarSize = next.avatarSize;
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
    return p ?? { name: t('chat.unknown'), color: '#aab', avatar: { kind: 'emoji', value: '❔', bg: '#555' } };
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
  function applyPrefs() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const op = clamp(prefs.opacities[modeState()], 0.3, 1);
    panel.style.opacity = String(op);
    prefs.fontScale = clamp(Number(prefs.fontScale) || DEFAULT_PREFS.fontScale, 0.8, 1.6);
    prefs.avatarSize = clamp(Math.round(Number(prefs.avatarSize) || DEFAULT_PREFS.avatarSize), 20, 56);
    panel.style.fontFamily = fontStack(previewFont ?? prefs.fontFamily);
    list.style.setProperty('--fs', String(prefs.fontScale));
    list.style.setProperty('--av', `${prefs.avatarSize}px`);
    opacity.value = String(+(1 - op).toFixed(2)); // 슬라이더는 투명도(오른쪽일수록 투명)
    clockCb.checked = prefs.showClock;
    videoCb.checked = prefs.showVideoTime;
    eventsCb.checked = prefs.showEvents;
    list.classList.toggle('no-events', !prefs.showEvents);
    wrap.dataset.theme = prefs.theme === 'black' ? 'black' : 'charcoal';
    themeSeg?.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.theme === wrap.dataset.theme));
    list.classList.toggle('plain', prefs.style === 'plain');
    list.classList.toggle('compact', prefs.style === 'compact');
    for (const b of styleSeg.children) b.classList.toggle('on', b.dataset.style === prefs.style);
    panel.hidden = prefs.collapsed || prefs.hidden;
    bubbleBox.hidden = !prefs.collapsed || prefs.hidden;
    panel.classList.toggle('dock', isDock());
    panel.classList.toggle('side', prefs.mode === 'side');
    panel.classList.toggle('free', !isDock()); // (리액션 애니메이션 클래스 .float 와 이름이 겹치면 안 된다)
    for (const b of modeSeg.children) b.classList.toggle('on', b.dataset.mode === modeState());

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

  // 맨 아래에 붙어 있는지는 "새 메시지가 붙기 전"의 위치로 기억한다. 메시지를 붙인 뒤에 재면 새 메시지 높이만으로 기준(글자/프사를 키우면 더 커짐)을
  // 넘어 위로 스크롤한 것으로 오해해 자동 스크롤이 멈춘다. 사용자가 직접 위로 올리면(scroll 이벤트) 붙어 있지 않은 것으로 본다.
  let pinned = true;
  const updatePinned = () => (pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 40);
  function scrollToBottom(force) {
    if (!force && !pinned) return;
    list.scrollTop = list.scrollHeight;
    pinned = true;
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
        b.title = t('chat.react');
        b.addEventListener('click', () => sendReaction(emoji));
        grp.append(b);
      }
      row.append(grp);
    }
    const brk = el('div', 'brk');
    const rlabel = el('span', 'rlabel', t('chat.recent'));
    const recent = el('div', 'grp recent');
    recent.title = t('chat.recentTitle');
    const renderRecent = () => {
      brk.hidden = rlabel.hidden = recent.hidden = recentReactions.length === 0;
      recent.replaceChildren(
        ...recentReactions.map((emoji) => {
          const b = el('button', '', emoji);
          b.title = t('chat.recentTitle');
          b.addEventListener('click', () => sendReaction(emoji));
          return b;
        }),
      );
    };
    reactionRows.push(renderRecent);
    renderRecent();
    row.append(brk, rlabel, recent);
    const more = el('button', '', '＋');
    more.title = t('chat.allEmoji');
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
  let updateInputCounter = () => {};
  let replyTo = null; // 지금 답장하려는 메시지 id
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
    // 연결이 끊긴 상태에서 보내면 글이 사라지지 않게 입력칸에 남겨 둔다
    if (getState()?.connection !== 'connected') return onNotify(t('chat.notConnected'));
    stopTyping();
    onSend(text, replyTo ?? undefined);
    cancelReply();
    input.value = '';
    updateInputCounter();
  }

  // ---------- 입력 중 표시(받는 쪽) ----------
  const typingTimers = new Map(); // userId -> timeout (3초 지나면 자동 해제)
  function renderTyping() {
    const names = [...typingTimers.keys()].map((id) => profileOf(id).name);
    typingLine.textContent =
      names.length === 0 ? '' : names.length <= 2 ? t('chat.typing.some', { names: names.join(', ') }) : t('chat.typing.many');
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
    m.el.title = `${new Date(m.sentAt).toLocaleTimeString()}${typeof m.videoTime === 'number' ? ` · ${t('chat.playAt', { t: fmtVideo(m.videoTime) })}` : ''}`;
  }

  function applyProfile(row, userId) {
    const p = profileOf(userId);
    renderAvatar(row.querySelector('.av'), p.avatar); // 크기는 CSS(--av)가 정한다
    const name = row.querySelector('.name-text');
    name.textContent = p.name;
    name.style.color = pastelize(p.color); // 닉네임은 고른 색의 글자색으로. 어두운 배경에서 잘 보이게 파스텔톤으로 보정
  }

  // ---------- 재생/일시정지/시간 이동 알림 ----------
  const lastEvent = new Map(); // userId -> { entry, at } — 연속 이벤트 합치기용
  function eventParts(m) {
    // 입장/퇴장: 알고 있는(방에 있거나 있었던) 사람의 현재 닉네임을 우선 쓰고, 모르면 알림이 만들어질 때 저장한 닉네임(m.name)을 쓴다
    const st = getState();
    const known = st?.participants?.find((x) => x.id === m.userId) ?? st?.known?.[m.userId];
    if (m.action === 'down') return { icon: '🔌', name: '', color: null, rest: t('chat.ev.down', { time: fmtClock(m.at ?? m.sentAt) }) };
    if (m.action === 'allback') return { icon: '🙌', name: '', color: null, rest: t('chat.ev.allback') };
    if (m.action === 'missing') return { icon: '⏳', name: '', color: null, rest: t('chat.ev.missing', { names: (m.names ?? []).join(', ') }) };
    const isMembership = m.action === 'join' || m.action === 'leave';
    const name = isMembership ? (known?.name ?? m.name ?? t('chat.unknown')) : profileOf(m.userId).name; // 내 동작도 "내가" 가 아니라 닉네임으로
    const color = isMembership ? known?.color : profileOf(m.userId).color;
    if (m.action === 'join') return { icon: '🎈', name, color, rest: t('chat.ev.join') };
    if (m.action === 'leave') return { icon: '👋', name, color, rest: t('chat.ev.leave') };
    const tm = fmtVideo(m.time);
    if (m.action === 'play') return { icon: '▶', svg: 'play', name, color, rest: t('chat.ev.play', { t: tm }) };
    if (m.action === 'pause') return { icon: '⏸', svg: 'pause', name, color, rest: t('chat.ev.pause', { t: tm }) };
    return { icon: '⏩', svg: 'seek', name, color, rest: t('chat.ev.seek', { t: tm }) }; // 이동(+재생)은 한 가지 문구로
  }
  // 재생/일시정지/이동 아이콘: 이모지는 하나만 색이 입혀져 튀므로 셋 다 글자색을 따르는 단색 도형으로 그린다
  const EV_ICON_PATHS = { play: 'M4 2.5v11l9-5.5z', pause: 'M4 2.5h3v11H4zM9 2.5h3v11H9z', seek: 'M1.5 2.5v11l6-5.5zM8.5 2.5v11l6-5.5z' };
  function evIcon(kind) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('class', 'evi');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', EV_ICON_PATHS[kind]);
    svg.append(path);
    return svg;
  }
  // 토스트 등 글자만 필요한 곳
  const eventText = (m) => {
    const e = eventParts(m);
    return `${e.icon} ${e.name}${e.rest}`;
  };
  // 안내 줄: 닉네임 부분만 그 사람의 글자색(채팅과 같은 파스텔 보정)
  function fillEvent(row, m) {
    const e = eventParts(m);
    const nm = el('span', 'ev-name', e.name);
    if (e.color) nm.style.color = pastelize(e.color);
    row.replaceChildren(e.svg ? evIcon(e.svg) : `${e.icon} `, nm, e.rest);
  }

  function renderEvent(m) {
    list.querySelector('.empty')?.remove();
    const prev = lastEvent.get(m.userId);
    // 시크바를 끌면 pause 가 먼저 오고 놓는 순간 seek 가 오므로, 정지 → 이동은 끄는 시간까지 넉넉히 합친다
    const limit = prev?.entry.action === 'pause' && m.action === 'seek' ? PAUSE_SEEK_MERGE_MS : EVENT_MERGE_MS;
    const fresh = prev && m.sentAt - prev.at < limit;
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
        fillEvent(prev.entry.el, prev.entry);
        prev.at = m.sentAt;
        return prev.entry.el;
      }
    }
    const row = el('div', 'sys');
    const entry = { ...m, el: row };
    fillEvent(row, entry);
    list.append(row);
    messages.push(entry);
    lastEvent.set(m.userId, { entry, at: m.sentAt });
    trimMessages();
    return row;
  }

  function renderMessage(m) {
    if (m.kind === 'event') return renderEvent(m);
    list.querySelector('.empty')?.remove();
    const row = el('div', m.userId === getState()?.userId ? 'msg me' : 'msg');
    const body = el('div', 'body');
    const nameLine = el('div', 'name');
    nameLine.append(el('span', 'name-text'), el('span', 'meta'));
    const entry = { ...m, el: row };
    body.append(nameLine);
    if (m.replyTo) {
      entry.quoteEl = el('button', 'quote');
      entry.quoteEl.addEventListener('click', () => jumpTo(entry.replyTo));
      body.append(entry.quoteEl);
      fillQuote(entry);
    }
    const bwrap = el('div', 'bwrap');
    bwrap.append(messageText(m.text));
    if (m.id) {
      const rbtn = el('button', 'rbtn', '↩');
      rbtn.title = t('chat.reply');
      rbtn.setAttribute('aria-label', t('chat.reply'));
      rbtn.addEventListener('click', () => startReply(m.id));
      bwrap.append(rbtn);
    }
    body.append(bwrap);
    row.append(el('span', 'av'), body);
    applyProfile(row, m.userId);
    renderMeta(entry);
    list.append(row);
    messages.push(entry);
    trimMessages();
  }

  // 본문: 줄글은 textContent/링크 노드로만 만든다. 길면 접어 두고 "전체보기"로 펼친다.
  function messageText(text) {
    const box = el('div', 'text');
    const cut = foldCut(text);
    if (cut < 0) {
      fillLinked(box, text);
      return box;
    }
    const body = el('span');
    const toggle = el('button', 'fold');
    let open = false;
    const paint = () => {
      body.replaceChildren();
      fillLinked(body, open ? text : `${text.slice(0, cut).trimEnd()}…`);
      toggle.dataset.open = open ? '1' : '';
      toggle.textContent = t(open ? 'chat.fold.collapse' : 'chat.fold.expand');
    };
    toggle.addEventListener('click', () => {
      open = !open;
      paint();
    });
    paint();
    box.append(body, toggle);
    return box;
  }

  // ---------- 답장 ----------
  const findById = (id) => (id ? messages.find((x) => x.id === id && x.kind !== 'event') : null);
  function fillQuote(m) {
    const orig = findById(m.replyTo);
    m.quoteEl.classList.toggle('gone', !orig);
    m.quoteEl.textContent = orig ? `${profileOf(orig.userId).name}: ${snippet(orig.text)}` : t('chat.replyGone'); // 화살표는 CSS(::before/::after)
  }
  function jumpTo(id) {
    const orig = findById(id);
    if (!orig) return;
    const [r, lr] = [orig.el.getBoundingClientRect(), list.getBoundingClientRect()];
    list.scrollTop += r.top - lr.top - (lr.height - r.height) / 2;
    orig.el.classList.remove('hl');
    void orig.el.offsetWidth; // 애니메이션 다시 시작
    orig.el.classList.add('hl');
    setTimeout(() => orig.el.classList.remove('hl'), 1500);
  }
  function startReply(id) {
    const orig = findById(id);
    if (!orig) return;
    replyTo = id;
    startReplyLabel();
    replyBar.hidden = false;
    input.focus();
  }
  function startReplyLabel() {
    const orig = findById(replyTo);
    if (!orig) return cancelReply();
    replyText.textContent = t('chat.replyTo', { name: profileOf(orig.userId).name, text: snippet(orig.text) });
  }
  function cancelReply() {
    replyTo = null;
    if (replyBar) replyBar.hidden = true;
  }

  function trimMessages() {
    while (messages.length > MAX_MESSAGES) {
      const i = messages.findIndex((m) => m.kind === 'event');
      messages.splice(i < 0 ? 0 : i, 1)[0].el.remove();
    }
  }

  function renderEmpty() {
    if (messages.length === 0 && !list.querySelector('.empty')) {
      list.append(el('div', 'empty', t('chat.empty')));
    }
  }

  // ---------- DOM 구성 ----------
  // 고정 문구: 언어가 바뀌면 다시 채운다(L 로 만든 것만)
  const relabels = [];
  const L = (node, prop, key) => {
    const f = () => (node[prop] = t(key));
    f();
    relabels.push(f);
    return node;
  };
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
    L(settingsBtn, 'title', 'chat.settings');
    const collapseBtn = el('button', 'iconbtn', '—');
    L(collapseBtn, 'title', 'chat.collapse');
    collapseBtn.addEventListener('click', () => {
      prefs.collapsed = true;
      closePicker();
      menu.hidden = true;
      applyPrefs();
      savePrefs();
    });
    head.append(L(el('span', 'title'), 'textContent', 'chat.title'), settingsBtn, collapseBtn);

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
    opLabel.append(L(el('span'), 'textContent', 'chat.opacity'), opacity);
    const checkbox = (textKey, key) => {
      const label = el('label');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', () => {
        prefs[key] = cb.checked;
        messages.forEach((m) => m.kind !== 'event' && renderMeta(m));
        list.classList.toggle('no-events', !prefs.showEvents);
        savePrefs();
      });
      label.append(cb, L(el('span'), 'textContent', textKey));
      return [label, cb];
    };
    let clockLabel, videoLabel, eventsLabel;
    [clockLabel, clockCb] = checkbox('chat.showClock', 'showClock');
    [videoLabel, videoCb] = checkbox('chat.showVideoTime', 'showVideoTime');
    [eventsLabel, eventsCb] = checkbox('chat.showEvents', 'showEvents');
    styleSeg = el('div', 'seg');
    for (const k of ['bubble', 'plain', 'compact']) {
      const b = L(el('button'), 'textContent', `chat.style.${k}`);
      b.dataset.style = k;
      b.addEventListener('click', () => {
        prefs.style = k;
        applyPrefs();
        scrollToBottom(true);
        savePrefs();
      });
      styleSeg.append(b);
    }
    themeSeg = el('div', 'seg');
    for (const k of ['charcoal', 'black']) {
      const b = L(el('button'), 'textContent', `chat.theme.${k}`);
      b.dataset.theme = k;
      b.addEventListener('click', () => {
        prefs.theme = k;
        applyPrefs();
        savePrefs();
      });
      themeSeg.append(b);
    }
    const copyLink = L(el('button', 'act'), 'textContent', 'chat.copyLink');
    copyLink.addEventListener('click', async () => (await copyText(getInviteLink())) && flash(copyLink, t('chat.copied')));
    const copyCode = L(el('button', 'act'), 'textContent', 'chat.copyCode');
    copyCode.addEventListener('click', async () => (await copyText(getState()?.roomCode ?? '')) && flash(copyCode, t('chat.copied')));
    modeSeg = el('div', 'seg');
    for (const k of ['float', 'side', 'dock']) {
      const b = L(el('button'), 'textContent', `chat.modeShort.${k}`);
      b.dataset.mode = k;
      L(b, 'title', `chat.mode.${k}`);
      b.addEventListener('click', () => {
        prefs.mode = k;
        applyPrefs();
        savePrefs();
      });
      modeSeg.append(b);
    }
    const sec = (key) => L(el('div', 'sec'), 'textContent', key);
    menu.append(sec('chat.menu.window'), modeSeg, opLabel, sec('chat.menu.view'), styleSeg, sec('chat.menu.color'), themeSeg, sec('chat.menu.show'), clockLabel, videoLabel, eventsLabel, sec('chat.menu.invite'), copyLink, copyCode);
    settingsBtn.addEventListener('click', () => (menu.hidden = !menu.hidden));

    list = el('div', 'list');
    list.addEventListener('scroll', updatePinned);
    typingLine = el('div', 'typing');

    // 입력줄: 이모지 선택기 버튼 + 입력 + 전송
    input = el('textarea');
    input.rows = 2;
    L(input, 'placeholder', 'chat.placeholder');
    L(input, 'title', 'chat.inputTip');
    input.maxLength = MAX_CHAT_LENGTH;
    input.spellcheck = false;
    counter = el('span', 'counter');
    counter.hidden = true;
    let pasteCut = false; // 붙여넣기가 글자수 제한에 잘렸는지
    const updateCounter = () => {
      const n = input.value.length;
      if (n < MAX_CHAT_LENGTH) pasteCut = false;
      counter.hidden = n < MAX_CHAT_LENGTH * 0.8;
      counter.classList.toggle('warn', n >= MAX_CHAT_LENGTH);
      counter.textContent = pasteCut ? t('chat.limit', { max: MAX_CHAT_LENGTH }) : `${n}/${MAX_CHAT_LENGTH}`;
    };
    updateInputCounter = updateCounter;
    input.addEventListener('input', updateCounter);
    input.addEventListener('paste', (e) => {
      const pasted = e.clipboardData?.getData('text') ?? '';
      const kept = input.value.length - (input.selectionEnd - input.selectionStart);
      if (kept + pasted.length > MAX_CHAT_LENGTH) pasteCut = true;
    });
    // 사이트의 단축키(스페이스=재생 등)가 입력 중에 동작하지 않도록 키 이벤트를 여기서 끊는다
    // (content/keyguard.js 가 페이지보다 먼저 capture 단계에서 끊는다. 그 경우 입력칸 리스너까지 못 오므로 같은 처리를 keyguard 가 부른다)
    for (const t of ['keydown', 'keyup', 'keypress']) input.addEventListener(t, (e) => e.stopPropagation());
    let lastSubmitEvent = null;
    const onInputKey = (e) => {
      if (e.type === 'keydown' && e.key === 'Escape' && replyTo) cancelReply();
      if (e.type === 'keydown' && (e.key === 'Tab' || e.key === 'Escape')) userMovedFocusAt = Date.now(); // 사용자가 직접 입력칸을 벗어나려는 키
      if (e.type !== 'keydown' || e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229 || lastSubmitEvent === e) return; // Shift+Enter 는 줄바꿈
      lastSubmitEvent = e; // 같은 키 이벤트로 두 번 전송되지 않게
      e.preventDefault();
      submit();
    };
    input.addEventListener('keydown', onInputKey);
    // 입력 중에 사이트(플레이어)가 스스로 다른 요소로 포커스를 가져가 커서가 사라지는 경우가 있다(재생/정지, 컨트롤 표시 등).
    // 사용자가 마우스로 다른 곳을 누르거나 Tab/Esc 로 나간 게 아니면(최근 0.5초 안에 없으면) 입력칸으로 포커스를 되돌린다.
    let userMovedFocusAt = 0;
    for (const t of ['pointerdown', 'mousedown', 'touchstart']) window.addEventListener(t, () => (userMovedFocusAt = Date.now()), true);
    let refocusAt = [];
    input.addEventListener('blur', () => {
      const now = Date.now();
      if (now - userMovedFocusAt < 500 || !document.hasFocus() || !input.isConnected || input.hidden) return;
      refocusAt = refocusAt.filter((t) => now - t < 1000);
      if (refocusAt.length >= 5) return; // 사이트와 포커스를 다투는 경우를 대비한 상한
      refocusAt.push(now);
      const [s, en] = [input.selectionStart, input.selectionEnd];
      setTimeout(() => {
        if (!input.isConnected || Date.now() - userMovedFocusAt < 500) return;
        input.focus({ preventScroll: true });
        try { input.setSelectionRange(s, en); } catch {}
      }, 0);
    });
    window.__bmtKeyHook = (e) => {
      if (e.composedPath?.()[0] === input || input.getRootNode().activeElement === input) onInputKey(e);
    };
    input.addEventListener('input', noteTyping);
    const form = el('div', 'form');
    const compose = el('div', 'compose');
    compose.append(input, counter);
    form.append(compose);

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
    replyBar = el('div', 'replying');
    replyBar.hidden = true;
    replyText = el('span', 'rtext');
    const replyX = el('button', null, '✕');
    L(replyX, 'title', 'chat.replyCancel');
    replyX.addEventListener('click', cancelReply);
    replyBar.append(replyText, replyX);
    panel.append(head, list, typingLine, reactionRow(), replyBar, form, ...handles);

    // 접힌 상태: 말풍선 + 배지, 마우스를 올리면 리액션 버튼
    bubbleBox = el('div', 'dock-bubble');
    const bubble = el('button', 'bubble', '💬');
    L(bubble, 'title', 'chat.open');
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


  // 언어가 바뀌면 이미 그려진 문구를 다시 채운다
  onLangChange(() => {
    if (!built) return;
    for (const f of relabels) f();
    applyPrefs();
    for (const m of messages) {
      if (m.kind === 'event') fillEvent(m.el, m);
      else {
        renderMeta(m);
        if (m.quoteEl) fillQuote(m);
      }
    }
    for (const b of list.querySelectorAll('.fold')) b.textContent = t(b.dataset.open ? 'chat.fold.collapse' : 'chat.fold.expand');
    const empty = list.querySelector('.empty');
    if (empty) empty.textContent = t('chat.empty');
    renderTyping();
    if (replyTo) startReplyLabel();
    updateInputCounter();
    reactionRows.forEach((f) => f());
    for (const b of wrap.querySelectorAll('.reacts .grp:not(.recent) button')) b.title = t('chat.react');
    for (const b of wrap.querySelectorAll('.reacts .rlabel')) b.textContent = t('chat.recent');
    for (const b of wrap.querySelectorAll('.reacts .grp.recent')) b.title = t('chat.recentTitle');
    for (const b of wrap.querySelectorAll('.reacts > button')) b.title = t('chat.allEmoji');
  });

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
      cancelReply();
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
        if ((prefs.collapsed || prefs.hidden) && prefs.showEvents && (m.action === 'join' || m.action === 'leave' || m.action === 'down' || m.action === 'allback' || m.action === 'missing')) onNotify(eventText(m));
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
        onNotify(`${profileOf(m.userId).name}: ${snippet(m.text)}`);
      }
    },

    // 프로필이 바뀌면 기존 메시지의 이름/프사/색도 갱신
    refreshProfiles() {
      if (!built) return;
      for (const m of messages) {
        if (m.kind === 'event') fillEvent(m.el, m); // 이름/색이 바뀌었을 수 있음(글자만 덮어쓰면 닉네임 색이 사라진다)
        else {
          applyProfile(m.el, m.userId);
          if (m.quoteEl) fillQuote(m);
        }
      }
      if (replyTo) startReplyLabel();
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
      f.style.setProperty('--dx', `${((Math.random() - 0.5) * size * 1.2).toFixed(0)}px`); // 옆으로는 살짝만(너무 흔들리면 촐싹거려 보인다)
      f.style.left = `${(left + size * 0.4 + Math.random() * Math.max(0, w - size * 2.4)).toFixed(0)}px`;
      f.style.top = `${(top + h * 0.78 - size).toFixed(0)}px`;
      f.append(el('span', 'e', emoji), el('span', 'n', profileOf(userId).name));
      floats.append(f);
      setTimeout(() => f.remove(), 4700); // 애니메이션(4.6초)이 끝난 뒤 정리
    },
  };
}
