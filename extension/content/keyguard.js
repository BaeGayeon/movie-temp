// 채팅 입력 중에 누르는 키(스페이스, f, 방향키 등)가 사이트의 단축키로 새지 않게 막는다.
// 사이트가 window/document 의 capture 단계에서 키를 받으면(넷플릭스 등) 채팅창 쪽 stopPropagation 은 너무 늦다.
// 그래서 페이지 스크립트보다 먼저(document_start) window capture 리스너를 걸어 두고,
// 키 입력이 우리 레이어(채팅)에서 온 경우 사이트에 전달되기 전에 전파를 끊는다. 입력 자체(글자 입력, 엔터 전송)는 그대로 동작한다.
(() => {
  if (window.__bmtKeyGuard) return;
  window.__bmtKeyGuard = true;
  const block = (e) => {
    const t = e.target;
    if (!t || t.nodeType !== 1 || !t.hasAttribute('data-bmt-layer')) return;
    // 전파를 끊으면 채팅 입력칸 자신의 리스너(엔터로 전송)도 못 받으므로, 끊기 전에 채팅 쪽 처리기를 먼저 부른다
    window.__bmtKeyHook?.(e);
    e.stopImmediatePropagation();
  };
  for (const type of ['keydown', 'keyup', 'keypress']) window.addEventListener(type, block, true);
})();
