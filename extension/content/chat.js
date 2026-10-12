// 채팅 사이드바 + 이모지 리액션. 모든 사용자 텍스트는 textContent 로만 렌더링한다(XSS 방지).
import { createLayer } from './ui.js';
import { REACTION_EMOJIS } from '../shared/protocol.js';

const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .root { position: fixed; inset: 0; pointer-events: none; font: 14px/1.45 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #fff; }
  button { font: inherit; cursor: pointer; border: 0; color: inherit; }

  .panel { position: absolute; top: 16px; right: 16px; pointer-events: auto; display: flex; flex-direction: column;
    background: rgba(18,18,24,.94); border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.55); overflow: hidden; }
  .panel[hidden], .dock[hidden] { display: none; }
  .head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: rgba(255,255,255,.07); user-select: none; }
  .head .title { font-weight: 700; flex: 1; }
  .head input[type=range] { width: 70px; accent-color: #4f7cff; }
  .iconbtn { background: transparent; font-size: 16px; padding: 2px 6px; border-radius: 6px; }
  .iconbtn:hover { background: rgba(255,255,255,.15); }

  .list { flex: 1; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
  .msg { display: flex; gap: 8px; align-items: flex-start; }
  .av { flex: none; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; }
  .body { min-width: 0; }
  .name { font-weight: 700; font-size: 12px; }
  .text { word-break: break-word; white-space: pre-wrap; }
  .msg.me .text { color: #cfe0ff; }
  .empty { color: #8a90a0; text-align: center; padding: 16px 0; font-size: 13px; }

  .typing { min-height: 18px; padding: 0 10px 2px; font-size: 12px; color: #aab; }
  .reacts { display: flex; gap: 2px; padding: 2px 8px; flex-wrap: wrap; }
  .reacts button { background: transparent; font-size: 18px; border-radius: 8px; padding: 2px 5px; }
  .reacts button:hover { background: rgba(255,255,255,.15); }
  .form { display: flex; gap: 6px; padding: 6px 8px 8px; }
  .form input { flex: 1; min-width: 0; font: inherit; color: #fff; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.18);
    border-radius: 8px; padding: 6px 8px; outline: none; }
  .form input:focus { border-color: #4f7cff; }
  .form button { background: #4f7cff; border-radius: 8px; padding: 6px 12px; }

  .rz-left { position: absolute; left: 0; top: 0; bottom: 0; width: 6px; cursor: ew-resize; }
  .rz-bottom { position: absolute; left: 0; right: 0; bottom: 0; height: 6px; cursor: ns-resize; }
  .rz-corner { position: absolute; left: 0; bottom: 0; width: 14px; height: 14px; cursor: nesw-resize; }

  .dock { position: absolute; right: 16px; bottom: 90px; pointer-events: auto; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
  .bubble { position: relative; width: 46px; height: 46px; border-radius: 50%; background: rgba(18,18,24,.92); font-size: 22px;
    box-shadow: 0 4px 14px rgba(0,0,0,.5); }
  .badge { position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px; background: #ff4d4f;
    font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  .badge[hidden] { display: none; }
  .dock .reacts { display: none; background: rgba(18,18,24,.92); border-radius: 12px; }
  .dock:hover .reacts { display: flex; }

  .floats { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .float { position: absolute; bottom: 14%; display: flex; flex-direction: column; align-items: center; animation: rise 2.8s ease-out forwards; }
  .float .e { font-size: 44px; filter: drop-shadow(0 2px 6px rgba(0,0,0,.5)); }
  .float .n { font-size: 11px; background: rgba(0,0,0,.55); border-radius: 8px; padding: 0 6px; }
  @keyframes rise { 0% { transform: translateY(0) scale(.6); opacity: 0; } 12% { transform: translateY(-20px) scale(1.1); opacity: 1; }
    100% { transform: translateY(-38vh) scale(1); opacity: 0; } }
`;

const DEFAULT_PREFS = { collapsed: false, opacity: 1, width: 300, height: 420 };
const MAX_MESSAGES = 200;
const MAX_FLOATS = 30;
const TYPING_IDLE_MS = 3000;
const TYPING_RESEND_MS = 2000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// getState(): 최신 background 상태. onSend(text) / onTyping(bool) / onReaction(emoji) / onNotify(text)
export function createChat({ getState, onSend, onTyping, onReaction, onNotify }) {
  const mount = createLayer(CSS);
  let built = false;
  let prefs = { ...DEFAULT_PREFS };
  const messages = []; // { userId, text, sentAt, el }
  let unread = 0;

  // DOM 참조
  let root, panel, list, typingLine, input, dock, badge, floats, opacity;

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
    return p ?? { name: '알 수 없음', color: '#aab', avatar: { value: '❔', bg: '#555' } };
  };

  function applyProfile(row, userId) {
    const p = profileOf(userId);
    const av = row.querySelector('.av');
    av.textContent = p.avatar?.value ?? '❔';
    av.style.background = p.avatar?.bg ?? '#555';
    const name = row.querySelector('.name');
    name.textContent = p.name;
    name.style.color = p.color ?? '#fff';
  }

  function applyPrefs() {
    const maxW = Math.max(220, window.innerWidth - 32);
    const maxH = Math.max(200, window.innerHeight - 32);
    prefs.width = clamp(prefs.width, 220, Math.min(600, maxW));
    prefs.height = clamp(prefs.height, 200, maxH);
    panel.style.width = `${prefs.width}px`;
    panel.style.height = `${prefs.height}px`;
    panel.style.opacity = String(clamp(prefs.opacity, 0.3, 1));
    opacity.value = String(prefs.opacity);
    panel.hidden = prefs.collapsed;
    dock.hidden = !prefs.collapsed;
    if (!prefs.collapsed) {
      unread = 0;
      renderBadge();
      scrollToBottom(true);
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

  function reactionRow() {
    const row = el('div', 'reacts');
    for (const emoji of REACTION_EMOJIS) {
      const b = el('button', '', emoji);
      b.title = '리액션';
      b.addEventListener('click', () => onReaction(emoji));
      row.append(b);
    }
    return row;
  }

  // ---- 입력 중 표시(내가 보내는 쪽): 디바운스 + 3초 후 자동 해제 ----
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

  // ---- 입력 중 표시(받는 쪽) ----
  const typingTimers = new Map(); // userId -> timeout (3초 지나면 자동 해제)
  function renderTyping() {
    const names = [...typingTimers.keys()].map((id) => profileOf(id).name);
    typingLine.textContent =
      names.length === 0 ? '' : names.length <= 2 ? `${names.join(', ')}님이 입력 중...` : '여러 명이 입력 중...';
  }

  // ---- 크기 조절 ----
  function dragResize(handle, axis) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const sx = e.clientX;
      const sy = e.clientY;
      const sw = prefs.width;
      const sh = prefs.height;
      const move = (ev) => {
        if (axis.includes('x')) prefs.width = sw + (sx - ev.clientX); // 오른쪽에 붙어 있어서 왼쪽으로 끌면 넓어짐
        if (axis.includes('y')) prefs.height = sh + (ev.clientY - sy);
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

  function build() {
    root = mount.ensure();
    if (built) return;
    built = true;
    const wrap = el('div', 'root');

    // 사이드바
    panel = el('div', 'panel');
    const head = el('div', 'head');
    opacity = el('input');
    opacity.type = 'range';
    opacity.min = '0.3';
    opacity.max = '1';
    opacity.step = '0.05';
    opacity.title = '투명도';
    opacity.addEventListener('input', () => {
      prefs.opacity = Number(opacity.value);
      panel.style.opacity = String(prefs.opacity);
    });
    opacity.addEventListener('change', savePrefs);
    const collapseBtn = el('button', 'iconbtn', '—');
    collapseBtn.title = '접기';
    collapseBtn.addEventListener('click', () => {
      prefs.collapsed = true;
      applyPrefs();
      savePrefs();
    });
    head.append(el('span', 'title', '💬 채팅'), opacity, collapseBtn);

    list = el('div', 'list');
    typingLine = el('div', 'typing');
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
    const send = el('button', '', '전송');
    send.addEventListener('click', submit);
    const form = el('div', 'form');
    form.append(input, send);

    const rzL = el('div', 'rz-left');
    const rzB = el('div', 'rz-bottom');
    const rzC = el('div', 'rz-corner');
    dragResize(rzL, 'x');
    dragResize(rzB, 'y');
    dragResize(rzC, 'xy');
    panel.append(head, list, typingLine, reactionRow(), form, rzL, rzB, rzC);

    // 접힌 상태: 말풍선 + 배지, 마우스를 올리면 리액션 버튼
    dock = el('div', 'dock');
    const bubble = el('button', 'bubble', '💬');
    bubble.title = '채팅 열기';
    badge = el('span', 'badge');
    bubble.append(badge);
    bubble.addEventListener('click', () => {
      prefs.collapsed = false;
      applyPrefs();
      savePrefs();
      input.focus();
    });
    dock.append(reactionRow(), bubble);

    floats = el('div', 'floats');
    wrap.append(panel, dock, floats); // 리액션이 패널 위에 그려지도록 마지막에
    root.append(wrap);
    applyPrefs();
    renderEmpty();
  }

  function renderEmpty() {
    if (messages.length === 0 && !list.querySelector('.empty')) {
      list.append(el('div', 'empty', '아직 메시지가 없어요. 인사를 건네 보세요!'));
    }
  }

  function renderMessage(m) {
    list.querySelector('.empty')?.remove();
    const row = el('div', m.userId === getState()?.userId ? 'msg me' : 'msg');
    const av = el('span', 'av');
    const body = el('div', 'body');
    body.append(el('div', 'name'), el('div', 'text', m.text)); // text 는 textContent
    row.append(av, body);
    row.title = new Date(m.sentAt).toLocaleTimeString();
    applyProfile(row, m.userId);
    list.append(row);
    messages.push({ ...m, el: row });
    while (messages.length > MAX_MESSAGES) messages.shift().el.remove();
    return row;
  }

  return {
    show() {
      build();
      mount.ensure();
    },

    // 방을 나가거나 방이 사라졌을 때
    hide() {
      if (!built) return;
      mount.remove();
      stopTyping();
      for (const t of typingTimers.values()) clearTimeout(t);
      typingTimers.clear();
      list.replaceChildren();
      messages.length = 0;
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
      for (const m of messages) applyProfile(m.el, m.userId);
      renderTyping();
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
