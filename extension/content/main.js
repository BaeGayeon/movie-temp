// content script (모든 프레임). 클래식 스크립트라서 ES module 은 동적 import 로 불러온다.
(async () => {
  if (window.__bmtLoaded) return;
  window.__bmtLoaded = true;

  const load = (path) => import(chrome.runtime.getURL(path));
  const [{ CMD }, { createDefaultAdapter }, { createUI }] = await Promise.all([
    load('shared/cmd.js'),
    load('content/adapters/default.js'),
    load('content/ui.js'),
  ]);

  const SEEK_THRESHOLD = 0.5; // 초. 이보다 차이가 작으면 시크하지 않는다
  const TOKEN_TTL = 1500; // 원격 동작이 일으킨 이벤트를 무시하는 유효 시간(ms)

  const isTop = window === window.top;
  const log = (...a) => console.log('[bmt]', isTop ? 'top' : 'iframe', ...a); // 진단용 로그
  const adapter = createDefaultAdapter(); // 4단계에서 호스트별 어댑터 선택
  const ui = createUI();

  let state = null; // background 의 공개 상태 (방에 묶인 탭에서만 채워짐)
  let video = null;

  const active = () => !!state?.roomCode;
  const canControl = () => state.mode === 'everyone' || state.hostId === state.userId;
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

  // ---------- 무한 루프 방지 ----------
  // 원격 동작을 적용하면 play/pause/seeked 이벤트가 비동기로 뒤따라 발생한다.
  // 적용 직전에 "이 이벤트는 내가 일으킨 것"이라는 표식(토큰)을 남기고, 이벤트가 오면 소비하며 무시한다.
  const tokens = { play: [], pause: [], seeked: [] };
  const expect = (type) => tokens[type].push(Date.now() + TOKEN_TTL);
  const unexpect = (type) => tokens[type].pop();
  const consume = (type) => {
    const now = Date.now();
    tokens[type] = tokens[type].filter((t) => t > now);
    return tokens[type].shift() !== undefined;
  };

  // ---------- 원격 상태 적용 ----------
  function seekTo(t) {
    if (!video || Math.abs(video.currentTime - t) < SEEK_THRESHOLD) return;
    expect('seeked');
    adapter.seek(video, t);
  }

  function setPlaying(playing) {
    if (!video) return;
    if (playing && video.paused) {
      expect('play');
      adapter.play(video).then(
        () => ui.hideClickPrompt(),
        (err) => {
          unexpect('play');
          if (err?.name === 'NotAllowedError') {
            ui.showClickPrompt(video, () => applyRoomVideo());
          }
        },
      );
    } else if (!playing && !video.paused) {
      expect('pause');
      adapter.pause(video);
    }
  }

  // 서버가 저장한 마지막 영상 상태에 맞춘다 (재생 중이면 경과 시간 보정)
  function applyRoomVideo() {
    if (!video || !active()) return;
    const v = state.video;
    const elapsed = v.playing ? Math.max(0, (Date.now() + state.serverOffset - v.updatedAt) / 1000) : 0;
    seekTo(v.time + elapsed);
    setPlaying(v.playing);
  }

  function applyRemote(msg) {
    log('remote', msg.action, msg.time.toFixed(1), video ? '적용' : '무시: video 없음');
    if (!video) return;
    if (msg.action === 'play') {
      seekTo(msg.time);
      setPlaying(true);
    } else if (msg.action === 'pause') {
      setPlaying(false);
      seekTo(msg.time);
    } else {
      seekTo(msg.time);
    }
  }

  // ---------- 로컬 이벤트 → 서버 ----------
  let lastBlockedToast = 0;

  function onLocal(action) {
    if (!active()) return log('local', action, '무시: 방에 묶인 탭이 아님/방 없음');
    if (!canControl()) {
      // 방장 전용 모드: 보내지 않고 방 상태로 되돌린다
      if (Date.now() - lastBlockedToast > 2000 && isTop) {
        ui.toast('방장만 조작할 수 있어요');
        lastBlockedToast = Date.now();
      }
      applyRoomVideo();
      return;
    }
    log('local', action, '전송', video.currentTime.toFixed(1));
    send({ cmd: CMD.VIDEO_EVENT, action, time: video.currentTime, sentAt: Date.now() });
  }

  const onPlay = () => !consume('play') && onLocal('play');
  const onPause = () => !consume('pause') && onLocal('pause');
  const onSeeked = () => !consume('seeked') && onLocal('seek');

  // ---------- <video> 탐지 ----------
  function attach(v) {
    if (video === v) return;
    detach();
    video = v;
    log('video 연결', v.clientWidth + 'x' + v.clientHeight, 'room:', state?.roomCode ?? '없음');
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeeked);
    applyRoomVideo(); // 영상이 교체/뒤늦게 나타나도 방 상태에 맞춘다
  }

  function detach() {
    if (!video) return;
    video.removeEventListener('play', onPlay);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('seeked', onSeeked);
    video = null;
    ui.hideClickPrompt();
  }

  function scan() {
    const v = adapter.findVideo();
    if (v) attach(v);
    else if (video && !video.isConnected) detach();
  }

  let scanTimer = null;
  new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scan, 3000); // 레이아웃 변화 등 DOM 변경 없이 영상이 나타나는 경우 대비
  scan();

  // ---------- background 메시지 ----------
  chrome.runtime.onMessage.addListener((m) => {
    switch (m.cmd) {
      case CMD.STATE:
        state = m.state;
        log('state', state.roomCode ?? '방 없음', state.connection);
        if (!active()) ui.hideClickPrompt();
        break;
      case CMD.SYNC:
        state = m.state;
        applyRoomVideo();
        break;
      case CMD.REMOTE_VIDEO:
        state = m.state;
        applyRemote(m.msg);
        break;
      case CMD.TOAST:
        if (isTop) ui.toast(m.text);
        break;
    }
  });

  // ---------- 시작: 상태 복구 + 초대 링크 ----------
  const reply = await chrome.runtime.sendMessage({ cmd: CMD.REGISTER }).catch(() => null);
  state = reply?.state ?? null;
  log('로드됨', location.href.slice(0, 60), 'room:', state?.roomCode ?? '없음(이 탭은 방에 묶이지 않음)');
  applyRoomVideo();

  if (isTop) {
    const code = new URL(location.href).searchParams.get('wp');
    if (code && /^[A-Za-z0-9]{6}$/.test(code) && state?.roomCode !== code.toUpperCase()) {
      ui.showInvite(code.toUpperCase(), () => send({ cmd: CMD.JOIN_ROOM, roomCode: code }));
    }
  }
})();
