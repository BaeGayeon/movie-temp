import { SHADOW_THEME_CSS } from '../shared/theme.js';
import { t } from '../shared/i18n.js';
import { icon } from '../shared/icons.js';

// 토스트, 초대 배너, 카운트다운, 대기/연결 안내, "클릭하세요" 안내. 모든 텍스트는 textContent 로만, 아이콘은 createElementNS 로만 넣는다.
// 영상 위에서 시선을 뺏지 않도록 무채색(CALM)을 그대로 쓰고, 하늘색은 카운트다운 링에만 쓴다.

const CSS = `
  :host { all: initial; }
  ${SHADOW_THEME_CSS}
  .wrap { position: fixed; inset: 0; pointer-events: none; font: 14px/1.45 var(--font); color: var(--ink); }
  .ico { display: block; flex: none; }
  button { font: inherit; cursor: pointer; border: 0; color: inherit; background: none; padding: 0; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }

  /* 알약 모양 안내(토스트, 대기, 광고): 앞에 아이콘 */
  .pill { display: flex; align-items: center; gap: 8px; background: var(--surface); color: var(--ink); border: 1px solid var(--float-border);
    padding: 8px 16px 8px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; white-space: nowrap; }
  .pill.noicon { padding-left: 16px; }
  .pill .ok { color: var(--ok-ink); }
  .toasts { position: absolute; top: 64px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; align-items: center; }
  .toast { box-shadow: 0 10px 28px rgba(0,0,0,.5); animation: pop .2s ease; }
  .waiting { position: absolute; bottom: 84px; left: 50%; transform: translateX(-50%); color: #D2D3D5; box-shadow: 0 4px 14px rgba(0,0,0,.35); }
  .ad { position: absolute; bottom: 140px; left: 50%; transform: translateX(-50%); color: #D2D3D5; box-shadow: 0 4px 14px rgba(0,0,0,.35); }

  /* 초대 배너 */
  .banner { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); pointer-events: auto; background: var(--surface); color: var(--ink);
    border: 1px solid var(--float-border); padding: 8px 8px 8px 10px; border-radius: 18px; display: flex; flex-direction: column; gap: 6px; align-items: center;
    box-shadow: 0 10px 28px rgba(0,0,0,.5); animation: pop-x .2s ease; width: max-content; max-width: calc(100vw - 32px); }
  .brow { display: flex; gap: 10px; align-items: center; justify-content: center; flex-wrap: wrap; }
  .brow .label { font-size: 13px; font-weight: 600; }
  .brow .code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 500; color: var(--ink-soft); margin-left: 4px; }
  .bmsg { font-size: 12px; font-weight: 600; color: var(--danger); text-align: center; padding-right: 8px; }
  .bmsg:empty { display: none; }
  .pw { position: relative; display: flex; }
  .pw[hidden] { display: none; }
  .pw input { font: inherit; font-size: 13px; width: 130px; height: 32px; box-sizing: border-box; color: var(--ink); background: var(--surface-2); border: 1px solid var(--border-3);
    border-radius: 10px; padding: 0 30px 0 10px; outline: none; }
  .pw input::placeholder { color: var(--placeholder); }
  .pw input:focus { border-color: #5A5B60; }
  button.eye { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); display: grid; place-items: center; width: 24px; height: 24px; border-radius: 8px; color: var(--ink-soft); }
  button.eye:hover { color: var(--ink); }
  button.btn { height: 32px; padding: 0 14px; border-radius: 10px; background: #E4E5E7; color: #17181A; font-size: 13px; font-weight: 700; white-space: nowrap; }
  button.btn:hover { background: #F2F2F3; }
  button.btn:active { transform: translateY(1px); }
  button.btn:disabled { opacity: .6; cursor: default; }
  button.iconbtn { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; color: var(--ink-soft); }
  button.iconbtn:hover { background: var(--head-chip); color: var(--ink); }

  /* 카운트다운: 160px 원 안에 숫자, 둘레의 링이 남은 시간만큼 줄어든다(하늘색은 여기에만 쓴다) */
  .count { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 160px; height: 160px; display: grid; place-items: center; border-radius: 50%;
    background: rgba(23,24,26,.72); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); animation: pop-c .3s ease; }
  .count svg { position: absolute; inset: 0; transform: rotate(-90deg); }
  .count .track { fill: none; stroke: rgba(255,255,255,.12); stroke-width: 6; }
  .count .bar { fill: none; stroke: #B9DEFA; stroke-width: 6; stroke-linecap: round; stroke-dasharray: 452.4; stroke-dashoffset: 0; }
  .count .inner { position: relative; display: flex; flex-direction: column; align-items: center; }
  .count .num { font-weight: 700; font-size: 72px; line-height: 1; color: #fff; font-variant-numeric: tabular-nums; }
  .count .sub { font-size: 12px; font-weight: 700; color: #C9D6E2; }
  .count.go .num { font-size: 44px; }
  .count.go .sub { display: none; }

  /* 연결 끊김 안내: 제목 + 설명 두 줄. 진짜 오류는 아이콘만 붉게, 재배포(info)는 아이콘 없이 스피너 + 차분하게 */
  .conn { position: absolute; top: 18px; left: 18px; display: flex; align-items: flex-start; gap: 10px; max-width: min(300px, calc(100% - 36px)); background: var(--surface); color: var(--ink);
    border: 1px solid var(--float-border); padding: 10px 14px; border-radius: 14px; box-shadow: 0 4px 14px rgba(0,0,0,.35); line-height: 1.4; text-align: left; }
  .conn .ico { margin-top: 1px; }
  .conn .err { color: var(--err-ink); }
  .conn .ok { color: var(--ok-ink); }
  .conn .txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .conn .title { font-size: 13px; font-weight: 700; }
  .conn .desc { font-size: 12px; color: #A9AAAE; text-wrap: pretty; }
  .conn .spin { flex: none; margin-top: 2px; width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--border-3); border-top-color: var(--ink-soft); animation: conn-spin .8s linear infinite; }
  .conn.done { align-items: center; }
  .conn.done .ico { margin-top: 0; }
  .conn.done .title { font-weight: 600; }
  .click { position: absolute; pointer-events: auto; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 8px; height: auto; padding: 12px 22px; border-radius: 14px; font-size: 16px; box-shadow: 0 10px 28px rgba(0,0,0,.5); }

  @keyframes conn-spin { to { transform: rotate(360deg); } }
  @keyframes pop-x { from { transform: translate(-50%, -6px) scale(.94); opacity: 0; } to { transform: translateX(-50%); opacity: 1; } }
  @keyframes pop { from { transform: translateY(-6px) scale(.94); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes pop-c { from { transform: translate(-50%, -50%) scale(.92); opacity: 0; } to { transform: translate(-50%, -50%); opacity: 1; } }
  /* 움직임을 줄이는 설정: 나타나는 효과를 빼고, 스피너는 천천히. 카운트다운 링은 줄어들지 않고 숫자만 바뀐다 */
  @media (prefers-reduced-motion: reduce) {
    .toast, .banner, .count { animation: none; }
    .conn .spin { animation-duration: 3s; }
  }
`;

const SVG_NS = 'http://www.w3.org/2000/svg';
// movoni 심볼(브랜드 로고): 배너에서 어디서 온 초대인지 알려 준다
function logoSymbol(px = 26) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ width: px, height: px, viewBox: '0 0 40 40', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  svg.style.flex = 'none';
  const add = (tag, attrs) => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    svg.append(e);
  };
  add('rect', { width: 40, height: 40, rx: 12, fill: '#B9DEFA' });
  add('rect', { x: 8, y: 9, width: 24, height: 18, rx: 8, fill: '#12304A' });
  add('path', { d: 'M13.5 25 L12.5 31.5 L19.5 26.5 Z', fill: '#12304A' });
  add('path', { d: 'M17.5 14.2 L17.5 21.8 L23.8 18 Z', fill: '#B9DEFA', stroke: '#B9DEFA', 'stroke-width': 1.6, 'stroke-linejoin': 'round' });
  return svg;
}

const node = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// 전체화면에서는 전체화면 요소 안에 붙여야 보이므로, 전체화면이 바뀔 때마다 부모를 옮긴다.
// (전체화면 요소가 <video>/<iframe>/<img> 자체이면 자식을 그릴 수 없어 문서 루트에 둔다)
// 여러 UI(토스트, 채팅)가 각자 shadow DOM 호스트를 만들 수 있도록 공용 헬퍼로 분리했다.
//
// topLayer: true 이면 Popover API 로 브라우저 최상위 레이어(top layer)에 올린다. 최상위 레이어 요소는 조상(<html>)에
// transform(화면 축소)이 걸려 있어도 영향을 받지 않아, "오른쪽에 붙이기"에서 페이지만 줄고 채팅은 그대로 유지된다.
// beforeMove/afterMove: 전체화면을 켜고 끌 때 레이어를 다른 부모로 옮기면 안쪽 요소의 스크롤 위치가 0 으로 돌아가므로,
// 옮기기 전에 상태를 저장하고 옮긴 뒤에 되돌릴 수 있게 부르는 함수.
export function createLayer(css, { passEvents = false, topLayer = false, beforeMove = null, afterMove = null } = {}) {
  let host = null;
  let root = null;
  let shown = false; // remove() 뒤에는 전체화면 전환 등으로 다시 붙이지 않는다(방을 나가면 채팅 아이콘이 남던 문제)
  const api = {
    ensure: null,
    remove: () => {
      shown = false;
      host?.remove();
    },
    get host() { return host; },
  };

  const parent = () => {
    const fs = document.fullscreenElement;
    return fs && !['VIDEO', 'IFRAME', 'IMG'].includes(fs.tagName) ? fs : document.documentElement;
  };

  api.ensure = () => {
    shown = true;
    if (!host) {
      host = document.createElement('div');
      host.setAttribute('data-bmt-layer', ''); // 사이트 단축키로 키 입력이 새지 않게 content/keyguard.js 가 구분하는 표시
      host.style.cssText = `all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: ${passEvents ? 'auto' : 'none'};`;
      root = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = css;
      root.append(style);
    }
    const moving = !!host.parentNode && host.parentNode !== parent();
    if (moving) beforeMove?.();
    if (host.parentNode !== parent()) parent().append(host); // 부모를 옮기면 popover 는 닫히므로 아래에서 다시 연다
    if (topLayer && host.isConnected && typeof host.showPopover === 'function') {
      try {
        host.popover = 'manual';
        if (!host.matches(':popover-open')) host.showPopover();
      } catch {} // 미지원/이미 열림: 일반 fixed 레이어로 동작
    }
    if (moving) {
      afterMove?.();
      requestAnimationFrame(() => afterMove?.()); // 옮긴 뒤 크기가 바뀌어 한 번 더 맞춘다
    }
    return root;
  };

  document.addEventListener('fullscreenchange', () => shown && api.ensure());
  return api;
}

export function createUI() {
  let toasts = null;
  let layer = null;
  const mount = createLayer(CSS);

  function ensure() {
    const root = mount.ensure();
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'wrap';
      toasts = document.createElement('div');
      toasts.className = 'toasts';
      layer.append(toasts);
      root.append(layer);
    }
  }

  function button(label, cls, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', onClick);
    return b;
  }

  // 아이콘만 있는 버튼(스크린리더/툴팁용 이름은 label)
  function iconButton(iconName, size, cls, label, onClick) {
    const b = button('', cls, onClick);
    b.type = 'button';
    b.append(icon(iconName, size));
    b.setAttribute('aria-label', label);
    b.title = label;
    return b;
  }

  // 알약 안내: [아이콘] 글자. 글자는 label 칸에만 넣어 갱신한다
  function pill(cls, iconName, text, iconCls) {
    const el = node('div', `pill ${cls}${iconName ? '' : ' noicon'}`);
    if (iconName) {
      const ic = icon(iconName, 15);
      if (iconCls) ic.classList.add(iconCls);
      el.append(ic);
    }
    el.append(node('span', 'label', text));
    return el;
  }

  let banner = null;
  let invite = null; // 열려 있는 초대 배너의 조작 함수들
  let inviteTimer = null;
  const INVITE_TTL_MS = 30_000;
  const EXPIRED_TTL_MS = 6000;
  let clickBtn = null;
  let countEl = null;
  let countTimer = null;
  let waitEl = null;
  let adEl = null;
  let connEl = null;
  let connShownAt = 0;
  let connHideTimer = null;
  const CONN_MIN_MS = 3000;

  // 연결 안내 상자의 안쪽을 채운다. content: { title, desc } = 끊김 안내(두 줄), 문자열 = 복구됨(한 줄, 체크 아이콘)
  function fillConn(el, content, kind) {
    el.classList.remove('done');
    if (typeof content === 'string') {
      const ic = icon('check', 16);
      ic.classList.add('ok');
      el.classList.add('done');
      const txt = node('div', 'txt');
      txt.append(node('span', 'title', content));
      el.replaceChildren(ic, txt);
      return;
    }
    const txt = node('div', 'txt');
    txt.append(node('span', 'title', content.title), node('span', 'desc', content.desc));
    if (kind === 'restart') el.replaceChildren(node('span', 'spin'), txt); // 재배포: 아이콘 없이 스피너, 차분하게
    else {
      const ic = icon('wifi-off', 16);
      ic.classList.add('err'); // 진짜 오류: 아이콘만 붉게
      el.replaceChildren(ic, txt);
    }
  }

  return {
    // iconName: 앞에 붙일 아이콘('check' 는 연한 초록). 없으면 글자만
    toast(text, ms = 3000, iconName = null) {
      ensure();
      const el = pill('toast', iconName, text, iconName === 'check' ? 'ok' : null);
      toasts.append(el);
      setTimeout(() => el.remove(), ms);
    },

    // 초대 배너. onJoin(password | undefined): 참가 버튼. onDismiss: 닫기/자동으로 사라질 때(주소의 ?wp= 를 지우는 데 쓴다).
    // passwordRequired: 방에 비밀번호가 있는 걸 알면 처음부터 입력칸을 보여 준다(모르면 참가가 거절될 때 inviteNeedsPassword 로 보여 준다).
    // 참가 결과(비밀번호 필요/틀림, 가득 참 등)는 배너 안에서 보여 주고, 성공하면 inviteJoined() 로 닫는다.
    showInvite(roomCode, onJoin, onDismiss = () => {}, { passwordRequired = false } = {}) {
      ensure();
      this.hideInvite();
      const el = (banner = document.createElement('div'));
      banner.className = 'banner';
      const row = document.createElement('div');
      row.className = 'brow';
      const label = node('span', 'label', t('ui.invite'));
      label.append(node('span', 'code', roomCode));
      const pwBox = document.createElement('span');
      pwBox.className = 'pw';
      pwBox.hidden = !passwordRequired;
      const input = document.createElement('input');
      input.type = 'password';
      input.placeholder = t('ui.password');
      input.setAttribute('aria-label', t('ui.password'));
      input.autocomplete = 'off';
      input.addEventListener('input', () => {
        const clean = input.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 32); // 비밀번호는 영문·숫자만
        if (clean !== input.value) input.value = clean;
      });
      const eye = button('', 'eye', () => {
        input.type = input.type === 'password' ? 'text' : 'password';
        eye.replaceChildren(icon(input.type === 'text' ? 'eye-off' : 'eye', 15));
        eye.setAttribute('aria-label', t(input.type === 'text' ? 'ui.pwHide' : 'ui.pwShow'));
        input.focus();
      });
      eye.type = 'button';
      eye.setAttribute('aria-label', t('ui.pwShow'));
      eye.replaceChildren(icon('eye', 15));
      pwBox.append(input, eye);
      const msg = document.createElement('div');
      msg.className = 'bmsg';
      const close = () => {
        if (banner !== el) return;
        this.hideInvite();
        onDismiss();
      };
      const joinBtn = button(t('ui.join'), 'btn', () => {
        const pw = input.value;
        if (!pwBox.hidden && !pw) {
          msg.textContent = t('ui.pwEnter');
          input.focus();
          return;
        }
        msg.textContent = '';
        joinBtn.disabled = true;
        joinBtn.textContent = t('ui.joining');
        arm();
        onJoin(pw || undefined);
      });
      const closeBtn = iconButton('x', 16, 'iconbtn', t('ui.close'), close);
      const arm = () => {
        clearTimeout(inviteTimer);
        inviteTimer = setTimeout(close, INVITE_TTL_MS); // 한참 누르지 않으면 사라진다
      };
      row.append(logoSymbol(), label, pwBox, joinBtn, closeBtn);
      banner.append(row, msg);
      layer.append(banner);
      invite = {
        el,
        arm,
        close,
        needsPassword(text) {
          pwBox.hidden = false;
          input.value = '';
          joinBtn.disabled = false;
          joinBtn.textContent = t('ui.join');
          msg.textContent = text;
          input.focus();
          arm();
        },
        failed(text) {
          pwBox.hidden = true;
          joinBtn.hidden = true;
          msg.textContent = text;
          clearTimeout(inviteTimer);
          inviteTimer = setTimeout(close, EXPIRED_TTL_MS);
        },
        enter: () => {
          if (!pwBox.hidden && layer.getRootNode().activeElement === input) joinBtn.click();
        },
      };
      window.__bmtInviteKeyHook = (e) => {
        if (e.type === 'keydown' && e.key === 'Enter' && invite?.el === el) invite.enter();
      }; // keyguard 가 사이트로 키가 새지 않게 전파를 끊으므로, 엔터로 참가하려면 끊기 전에 불러 준다
      arm();
      if (passwordRequired) input.focus();
    },

    inviteNeedsPassword(text) {
      invite?.needsPassword(text);
    },

    inviteFailed(text) {
      invite?.failed(text);
    },

    // 참가 성공: 배너를 닫는다
    inviteJoined() {
      invite?.close();
    },

    get inviteOpen() {
      return !!invite;
    },

    // 이미 닫힌 방의 초대: 참가 버튼 없이 안내만 잠깐 보여 준다
    showExpiredInvite(roomCode, onDismiss = () => {}) {
      ensure();
      this.hideInvite();
      const el = (banner = document.createElement('div'));
      banner.className = 'banner';
      const row = document.createElement('div');
      row.className = 'brow';
      const label = node('span', 'label', t('ui.expired', { code: roomCode }));
      const close = () => {
        if (banner !== el) return;
        this.hideInvite();
        onDismiss();
      };
      row.append(logoSymbol(), label, iconButton('x', 16, 'iconbtn', t('ui.close'), close));
      banner.append(row);
      layer.append(banner);
      inviteTimer = setTimeout(close, EXPIRED_TTL_MS);
    },

    hideInvite() {
      clearTimeout(inviteTimer);
      banner?.remove();
      banner = null;
      invite = null;
      window.__bmtInviteKeyHook = null;
    },

    // 자동재생이 막혔을 때 영상 위에 클릭 안내를 띄운다
    showClickPrompt(video, onClick) {
      ensure();
      this.hideClickPrompt();
      const r = video.getBoundingClientRect();
      clickBtn = button('', 'btn click', () => {
        this.hideClickPrompt();
        onClick();
      });
      clickBtn.append(icon('play', 18), node('span', null, t('ui.clickToPlay')));
      clickBtn.style.left = `${r.left + r.width / 2}px`;
      clickBtn.style.top = `${r.top + r.height / 2}px`;
      layer.append(clickBtn);
    },

    hideClickPrompt() {
      clickBtn?.remove();
      clickBtn = null;
    },

    // 카운트다운: startAt(서버 시각)까지 남은 초를 원 안에 크게 표시하고, 둘레의 링이 남은 시간만큼 줄어든다. 시작 순간 "재생!" 을 잠깐 보여준다.
    // 움직임을 줄이는 설정이면 링은 줄어들지 않고(가득 찬 채로) 숫자만 바뀐다.
    showCountdown(startAt, serverNow) {
      ensure();
      this.hideCountdown();
      countEl = node('div', 'count');
      const svg = document.createElementNS(SVG_NS, 'svg');
      for (const [k, v] of Object.entries({ width: 160, height: 160, viewBox: '0 0 160 160', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
      const circle = (cls) => {
        const c = document.createElementNS(SVG_NS, 'circle');
        for (const [k, v] of Object.entries({ cx: 80, cy: 80, r: 72 })) c.setAttribute(k, v);
        c.setAttribute('class', cls);
        return c;
      };
      const bar = circle('bar');
      svg.append(circle('track'), bar);
      const num = node('span', 'num');
      const inner = node('div', 'inner');
      inner.append(num, node('span', 'sub', t('ui.countSub')));
      countEl.append(svg, inner);
      layer.append(countEl);
      const el = countEl;
      const still = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const total = Math.max(1000, Math.ceil((startAt - serverNow()) / 1000) * 1000); // 처음 보였을 때의 남은 시간(올림한 초)
      const CIRC = 2 * Math.PI * 72;
      const tick = () => {
        const remain = startAt - serverNow();
        if (remain > 0) {
          num.textContent = String(Math.ceil(remain / 1000));
          if (!still) bar.style.strokeDashoffset = String((1 - Math.min(1, remain / total)) * CIRC);
        } else if (remain > -700) {
          num.textContent = t('ui.go');
          el.className = 'count go';
          bar.style.strokeDashoffset = '0';
        } else {
          this.hideCountdown();
        }
      };
      tick();
      countTimer = setInterval(tick, 80);
    },

    hideCountdown() {
      clearInterval(countTimer);
      countTimer = null;
      countEl?.remove();
      countEl = null;
    },

    // 광고 구간 표시(동기화가 멈춰 있음). text 가 없으면 숨김
    showAd(text) {
      if (!text) {
        adEl?.remove();
        adEl = null;
        return;
      }
      ensure();
      if (!adEl) {
        adEl = pill('ad', 'hourglass', text);
        layer.append(adEl);
      }
      adEl.querySelector('.label').textContent = text;
    },

    // 서버와 연결이 끊겨 다시 연결하는 중(영상 위 맨 위). text 가 없으면 숨김
    // text: { title, desc } (제목 + 설명 두 줄)
    // 끊김은 1~2초 만에 끝나는 일이 많아서, 한 번 뜬 안내는 읽을 수 있게 최소 CONN_MIN_MS 동안은 보여 준다
    // doneText: 다시 연결됐을 때 최소 시간 동안 대신 보여 줄 글자(스피너 없이, 체크 아이콘과 한 줄)
    // kind: 'restart'(재배포/서버 재시작: 차분하게) | 그 밖(진짜 오류: 아이콘만 붉게)
    showConnection(text, doneText, immediate = false, kind = 'error') {
      clearTimeout(connHideTimer);
      if (!text) {
        if (!connEl) return;
        const rest = immediate ? 0 : CONN_MIN_MS - (Date.now() - connShownAt); // 방을 나간 경우는 바로 지운다
        if (rest > 0) {
          const el = connEl;
          if (doneText) fillConn(el, doneText);
          connHideTimer = setTimeout(() => {
            el.remove();
            if (connEl === el) connEl = null;
          }, rest);
          return;
        }
        connEl.remove();
        connEl = null;
        return;
      }
      ensure();
      if (!connEl) {
        connEl = document.createElement('div');
        connEl.className = 'conn';
        connEl.setAttribute('role', 'status');
        layer.append(connEl);
        connShownAt = Date.now();
      }
      fillConn(connEl, text, kind);
    },

    // 버퍼링 대기 표시. text 가 없으면 숨김
    showWaiting(text) {
      if (!text) {
        waitEl?.remove();
        waitEl = null;
        return;
      }
      ensure();
      if (!waitEl) {
        waitEl = pill('waiting', 'hourglass', text);
        layer.append(waitEl);
      }
      waitEl.querySelector('.label').textContent = text;
    },
  };
}
