// 토스트, 초대 배너, "클릭하세요" 안내. 모든 텍스트는 textContent 로만 넣는다.

const CSS = `
  :host { all: initial; }
  .wrap { position: fixed; inset: 0; pointer-events: none; font: 14px/1.4 system-ui, -apple-system, "Malgun Gothic", sans-serif; }
  .toasts { position: absolute; top: 16px; right: 16px; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
  .toast { background: rgba(20,20,24,.92); color: #fff; padding: 8px 14px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.4); }
  .banner { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); pointer-events: auto;
    background: #1f2430; color: #fff; padding: 10px 14px; border-radius: 10px; display: flex; gap: 10px; align-items: center;
    box-shadow: 0 4px 16px rgba(0,0,0,.5); }
  button { font: inherit; cursor: pointer; border: 0; border-radius: 6px; padding: 6px 12px; background: #4f7cff; color: #fff; }
  button.sub { background: #3a4050; }
  .click { position: absolute; pointer-events: auto; transform: translate(-50%, -50%); font-size: 16px; padding: 12px 20px; }
`;

export function createUI() {
  let host = null;
  let toasts = null;
  let layer = null;

  // 전체화면일 때는 전체화면 요소 안에 붙여야 보인다 (<video> 자체가 전체화면이면 불가)
  function parent() {
    const fs = document.fullscreenElement;
    if (fs && !['VIDEO', 'IFRAME', 'IMG'].includes(fs.tagName)) return fs;
    return document.documentElement;
  }

  function ensure() {
    if (!host) {
      host = document.createElement('div');
      host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
      const root = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = CSS;
      layer = document.createElement('div');
      layer.className = 'wrap';
      toasts = document.createElement('div');
      toasts.className = 'toasts';
      layer.append(toasts);
      root.append(style, layer);
    }
    if (host.parentNode !== parent()) parent().append(host);
  }

  document.addEventListener('fullscreenchange', () => host && ensure());

  function button(label, cls, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', onClick);
    return b;
  }

  let banner = null;
  let clickBtn = null;

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
  };
}
