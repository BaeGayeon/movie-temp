import { SHADOW_THEME_CSS } from '../shared/theme.js';

// 토스트, 초대 배너, "클릭하세요" 안내. 모든 텍스트는 textContent 로만 넣는다.

const CSS = `
  :host { all: initial; }
  ${SHADOW_THEME_CSS}
  .wrap { position: fixed; inset: 0; pointer-events: none; font: 14px/1.45 var(--font); color: var(--ink); }
  .toasts { position: absolute; top: 64px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; align-items: center; }
  .toast { background: var(--surface); color: var(--ink); border: 1px solid var(--border-3); padding: 8px 18px; border-radius: 999px;
    box-shadow: var(--shadow-lg); font-weight: 500; animation: pop .2s ease; }
  .banner { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); pointer-events: auto; background: var(--surface); color: var(--ink);
    border: 1px solid var(--border-3); padding: 8px 10px 8px 18px; border-radius: 999px; display: flex; gap: 10px; align-items: center;
    box-shadow: var(--shadow-lg); font-weight: 500; animation: pop-x .2s ease; }
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
export function createLayer(css, { passEvents = false, topLayer = false } = {}) {
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
    if (host.parentNode !== parent()) parent().append(host); // 부모를 옮기면 popover 는 닫히므로 아래에서 다시 연다
    if (topLayer && host.isConnected && typeof host.showPopover === 'function') {
      try {
        host.popover = 'manual';
        if (!host.matches(':popover-open')) host.showPopover();
      } catch {} // 미지원/이미 열림: 일반 fixed 레이어로 동작
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

  let banner = null;
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

    showInvite(roomCode, onJoin) {
      ensure();
      this.hideInvite();
      banner = document.createElement('div');
      banner.className = 'banner';
      const label = document.createElement('span');
      label.textContent = `같이 보기 초대가 왔어요 (방 ${roomCode})`;
      banner.append(
        label,
        button('참가', '', () => {
          this.hideInvite();
          onJoin();
        }),
        button('닫기', 'sub', () => this.hideInvite()),
      );
      layer.append(banner);
    },

    hideInvite() {
      banner?.remove();
      banner = null;
    },

    // 자동재생이 막혔을 때 영상 위에 클릭 안내를 띄운다
    showClickPrompt(video, onClick) {
      ensure();
      this.hideClickPrompt();
      const r = video.getBoundingClientRect();
      clickBtn = button('▶ 재생하려면 클릭하세요', 'click', () => {
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
          el.textContent = '재생!';
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
