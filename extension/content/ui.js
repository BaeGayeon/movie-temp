import { SHADOW_THEME_CSS } from '../shared/theme.js';
import { t } from '../shared/i18n.js';

// 토스트, 초대 배너, "클릭하세요" 안내. 모든 텍스트는 textContent 로만 넣는다.

const CSS = `
  :host { all: initial; }
  ${SHADOW_THEME_CSS}
  .wrap { position: fixed; inset: 0; pointer-events: none; font: 14px/1.45 var(--font); color: var(--ink); }
  .toasts { position: absolute; top: 64px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; align-items: center; }
  .toast { background: var(--surface); color: var(--ink); border: 1px solid var(--border-3); padding: 8px 18px; border-radius: 999px;
    box-shadow: var(--shadow-lg); font-weight: 500; animation: pop .2s ease; }
  .banner { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); pointer-events: auto; background: var(--surface); color: var(--ink);
    border: 1px solid var(--border-3); padding: 8px 10px 8px 18px; border-radius: 26px; display: flex; flex-direction: column; gap: 6px; align-items: center;
    box-shadow: var(--shadow-lg); font-weight: 500; animation: pop-x .2s ease; width: max-content; max-width: calc(100vw - 32px); }
  .brow { display: flex; gap: 10px; align-items: center; justify-content: center; flex-wrap: wrap; }
  .brow button { white-space: nowrap; }
  .bmsg { font-size: 12px; font-weight: 600; color: var(--danger); text-align: center; padding-right: 8px; }
  .bmsg:empty { display: none; }
  .pw { position: relative; display: flex; }
  .pw[hidden] { display: none; }
  .pw input { font: inherit; font-weight: 600; width: 150px; box-sizing: border-box; color: var(--ink); background: var(--surface-2); border: 2px solid var(--border-3);
    border-radius: 999px; padding: 5px 34px 5px 12px; outline: none; }
  .pw input:focus { border-color: var(--accent); }
  button.eye { position: absolute; right: 3px; top: 50%; transform: translateY(-50%); display: flex; padding: 4px; background: none; color: var(--ink-soft); box-shadow: none; }
  button { font: inherit; font-weight: 600; cursor: pointer; border: 0; border-radius: 999px; padding: 6px 14px; color: var(--on-accent); background: var(--accent); }
  button:active { transform: translateY(1px); }
  button.sub { background: var(--surface-2); color: var(--accent-ink); box-shadow: none; }
  .count { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 160px; font-weight: 900; color: #fff;
    -webkit-text-stroke: 10px var(--accent); paint-order: stroke fill; text-shadow: 0 10px 30px var(--btn-shadow); animation: pop .3s ease; }
  .count.go { font-size: 90px; }
  .ad { position: absolute; bottom: 140px; left: 50%; transform: translateX(-50%); background: var(--warn-bg); color: var(--warn-ink); border: 1px solid var(--warn-border);
    padding: 8px 18px; border-radius: 999px; box-shadow: var(--shadow); font-weight: 500; white-space: nowrap; }
  .waiting { position: absolute; bottom: 90px; left: 50%; transform: translateX(-50%); background: var(--surface); color: var(--accent-ink); border: 1px solid var(--border-3);
    padding: 8px 18px; border-radius: 999px; box-shadow: var(--shadow); font-weight: 500; white-space: nowrap; }
  .click { position: absolute; pointer-events: auto; transform: translate(-50%, -50%); font-size: 16px; padding: 12px 22px; box-shadow: var(--shadow-lg); }
  @keyframes pop-x { from { transform: translate(-50%, -6px) scale(.94); opacity: 0; } to { transform: translateX(-50%); opacity: 1; } }
  @keyframes pop { from { transform: translateY(-6px) scale(.94); opacity: 0; } to { transform: none; opacity: 1; } }
`;

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

  // 보기/숨기기(눈) 아이콘. 사이트의 Trusted Types 정책에 걸리지 않도록 innerHTML 대신 요소를 만들어 쓴다
  function eyeIcon(off) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(k, v);
    const add = (tag, attrs) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      svg.append(e);
    };
    if (off) {
      add('path', { d: 'M17.94 17.94A10.9 10.9 0 0 1 12 19C5 19 1 12 1 12a19.8 19.8 0 0 1 5.06-5.94M9.9 4.24A10.9 10.9 0 0 1 12 5c7 0 11 7 11 7a19.9 19.9 0 0 1-3.16 4.19M14.12 14.12A3 3 0 1 1 9.88 9.88' });
      add('path', { d: 'M1 1l22 22' });
    } else {
      add('path', { d: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z' });
      add('circle', { cx: '12', cy: '12', r: '3' });
    }
    return svg;
  }

  function button(label, cls, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', onClick);
    return b;
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

  return {
    toast(text, ms = 3000) {
      ensure();
      const el = document.createElement('div');
      el.className = 'toast';
      el.textContent = text;
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
      const label = document.createElement('span');
      label.textContent = t('ui.invite', { code: roomCode });
      const pwBox = document.createElement('span');
      pwBox.className = 'pw';
      pwBox.hidden = !passwordRequired;
      const input = document.createElement('input');
      input.type = 'password';
      input.placeholder = t('ui.password');
      input.autocomplete = 'off';
      input.addEventListener('input', () => {
        const clean = input.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 32); // 비밀번호는 영문·숫자만
        if (clean !== input.value) input.value = clean;
      });
      const eye = button('', 'eye', () => {
        input.type = input.type === 'password' ? 'text' : 'password';
        eye.replaceChildren(eyeIcon(input.type === 'text'));
        eye.setAttribute('aria-label', t(input.type === 'text' ? 'ui.pwHide' : 'ui.pwShow'));
        input.focus();
      });
      eye.type = 'button';
      eye.setAttribute('aria-label', t('ui.pwShow'));
      eye.replaceChildren(eyeIcon(false));
      pwBox.append(input, eye);
      const msg = document.createElement('div');
      msg.className = 'bmsg';
      const close = () => {
        if (banner !== el) return;
        this.hideInvite();
        onDismiss();
      };
      const joinBtn = button(t('ui.join'), '', () => {
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
      const closeBtn = button(t('ui.close'), 'sub', close);
      const arm = () => {
        clearTimeout(inviteTimer);
        inviteTimer = setTimeout(close, INVITE_TTL_MS); // 한참 누르지 않으면 사라진다
      };
      row.append(label, pwBox, joinBtn, closeBtn);
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
      const label = document.createElement('span');
      label.textContent = t('ui.expired', { code: roomCode });
      const close = () => {
        if (banner !== el) return;
        this.hideInvite();
        onDismiss();
      };
      row.append(label, button(t('ui.close'), 'sub', close));
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
      clickBtn = button(t('ui.clickToPlay'), 'click', () => {
        this.hideClickPrompt();
        onClick();
      });
      clickBtn.style.left = `${r.left + r.width / 2}px`;
      clickBtn.style.top = `${r.top + r.height / 2}px`;
      layer.append(clickBtn);
    },

    hideClickPrompt() {
      clickBtn?.remove();
      clickBtn = null;
    },

    // 카운트다운: startAt(서버 시각)까지 남은 초를 크게 표시하고, 시작 순간 "재생!" 을 잠깐 보여준다
    showCountdown(startAt, serverNow) {
      ensure();
      this.hideCountdown();
      countEl = document.createElement('div');
      countEl.className = 'count';
      layer.append(countEl);
      const el = countEl;
      const tick = () => {
        const remain = startAt - serverNow();
        if (remain > 0) {
          el.textContent = String(Math.ceil(remain / 1000));
        } else if (remain > -700) {
          el.textContent = t('ui.go');
          el.className = 'count go';
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
        adEl = document.createElement('div');
        adEl.className = 'ad';
        layer.append(adEl);
      }
      adEl.textContent = text;
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
        waitEl = document.createElement('div');
        waitEl.className = 'waiting';
        layer.append(waitEl);
      }
      waitEl.textContent = text;
    },
  };
}
