// 넷플릭스 페이지 안(MAIN world)에서 도는 작은 다리.
// 넷플릭스는 <video>.currentTime 을 직접 바꾸면 재생 오류(M7375)를 내므로, 재생/정지/이동은 넷플릭스 자체 플레이어 API 로 해야 한다.
// 확장(content script)은 페이지의 `netflix` 전역에 접근할 수 없어서 window.postMessage 로 요청을 받는다.
(() => {
  if (window.__bmtNetflixBridge) return;
  window.__bmtNetflixBridge = true;

  function player() {
    const vp = window.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
    if (!vp) return null;
    const ids = vp.getAllPlayerSessionIds?.() ?? [];
    const sid = ids.find((s) => String(s).startsWith('watch')) ?? ids[ids.length - 1];
    return sid ? vp.getVideoPlayerBySessionId(sid) : null;
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.__bmt !== 'nf' || typeof d.id !== 'number') return;
    let ok = false;
    let ms;
    try {
      const p = player();
      if (p) {
        if (d.op === 'seek' && Number.isFinite(d.ms)) {
          p.seek(Math.max(0, Math.round(d.ms)));
          ok = true;
        } else if (d.op === 'play') {
          p.play();
          ok = true;
        } else if (d.op === 'pause') {
          p.pause();
          ok = true;
        }
      }
    } catch {}
    window.postMessage({ __bmt: 'nf-r', id: d.id, ok, ms }, '*');
  });
})();
