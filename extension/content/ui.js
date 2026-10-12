// 토스트, 초대 배너, "클릭하세요" 안내. 모든 텍스트는 textContent 로만 넣는다.

const CSS = `
  :host { all: initial; }
  .wrap { position: fixed; inset: 0; pointer-events: none; font: 14px/1.4 system-ui, -apple-system, "Malgun Gothic", sans-serif; }
  .toasts { position: absolute; top: 64px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; align-items: center; }
  .toast { background: rgba(20,20,24,.92); color: #fff; padding: 8px 14px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.4); }
  .banner { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); pointer-events: auto;
    background: #1f2430; color: #fff; padding: 10px 14px; border-radius: 10px; display: flex; gap: 10px; align-items: center;
    box-shadow: 0 4px 16px rgba(0,0,0,.5); }
  button { font: inherit; cursor: pointer; border: 0; border-radius: 6px; padding: 6px 12px; background: #4f7cff; color: #fff; }
  button.sub { background: #3a4050; }
  .count { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-size: 160px; font-weight: 800; color: #fff; text-shadow: 0 4px 24px rgba(0,0,0,.7); }
  .count.go { font-size: 90px; }
  .waiting { position: absolute; bottom: 90px; left: 50%; transform: translateX(-50%); background: rgba(20,20,24,.92);
    color: #fff; padding: 8px 16px; border-radius: 20px; box-shadow: 0 2px 8px rgba(0,0,0,.4); }
  .click { position: absolute; pointer-events: auto; transform: translate(-50%, -50%); font-size: 16px; padding: 12px 20px; }
`;

// 전체화면에서는 전체화면 요소 안에 붙여야 보이므로, 전체화면이 바뀔 때마다 부모를 옮긴다.
// (전체화면 요소가 <video>/<iframe>/<img> 자체이면 자식을 그릴 수 없어 문서 루트에 둔다)
// 여러 UI(토스트, 채팅)가 각자 shadow DOM 호스트를 만들 수 있도록 공용 헬퍼로 분리했다.
export function createLayer(css, { passEvents = false } = {}) {
  let host = null;
  let root = null;

  const parent = () => {
    const fs = document.fullscreenElement;
    return fs && !['VIDEO', 'IFRAME', 'IMG'].includes(fs.tagName) ? fs : document.documentElement;
  };

  const ensure = () => {
    if (!host) {
      host = document.createElement('div');
      host.style.cssText = `all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: ${passEvents ? 'auto' : 'none'};`;
      root = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = css;
      root.append(style);
    }
    if (host.parentNode !== parent()) parent().append(host);
    return root;
  };

  document.addEventListener('fullscreenchange', () => host && ensure());
  return { ensure, remove: () => host?.remove(), get host() { return host; } };
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
