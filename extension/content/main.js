// content script (모든 프레임). 클래식 스크립트라서 ES module 은 동적 import 로 불러온다.
(async () => {
  if (window.__bmtLoaded) return;
  window.__bmtLoaded = true;

  const load = (path) => import(chrome.runtime.getURL(path));
  const [{ CMD }, { ensureSuitFont }, { createDefaultAdapter }, { createNetflixAdapter }, { createUI }, { createChat }] = await Promise.all([
    load('shared/cmd.js'),
    load('shared/font.js'),
    load('content/adapters/default.js'),
    load('content/adapters/netflix.js'),
    load('content/ui.js'),
    load('content/chat.js'),
  ]);

  const SEEK_THRESHOLD = 0.5; // 초. 이보다 차이가 작으면 시크하지 않는다
  const TOKEN_TTL = 1500; // 원격 동작이 일으킨 이벤트를 무시하는 유효 시간(ms)
  const REPORT_MS = 5000; // 재생 중 위치 보고/보정 주기
  const BUFFER_DEBOUNCE_MS = 500; // 이 시간 넘게 멈춰 있어야 버퍼링으로 보고
  const AD_EVENTS = ['durationchange', 'loadedmetadata', 'emptied']; // 같은 <video> 에서 광고 <-> 본편이 바뀌는 신호

  const isTop = window === window.top;
  const log = (...a) => console.log('[bmt]', isTop ? 'top' : 'iframe', ...a); // 진단용 로그
  // 호스트별 어댑터: 넷플릭스는 <video> 를 직접 조작하면 오류(M7375)가 나서 전용 어댑터를 쓴다
  const adapter = /(^|\.)netflix\.com$/.test(location.hostname) ? createNetflixAdapter() : createDefaultAdapter();
  const ui = createUI();
  // 채팅/리액션 UI 는 최상위 프레임에만 둔다
  const chat = isTop
    ? createChat({
        getState: () => state,
        onSend: (text) => send({ cmd: CMD.CHAT_SEND, text, videoTime: currentVideoTime() }),
        getInviteLink: () => {
          const u = new URL(location.href);
          u.searchParams.set('wp', state?.roomCode ?? '');
          return u.toString();
        },
        // 리액션이 퍼질 영역: 영상의 화면상 사각형(화면 축소/창 크기가 반영됨). 최상위 프레임에 영상이 없으면 null
        getReactionArea: () => {
          const r = video?.getBoundingClientRect();
          return r && r.width > 80 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
        },
        onTyping: (isTyping) => send({ cmd: CMD.TYPING_SEND, isTyping }),
        onReaction: (emoji) => send({ cmd: CMD.REACTION_SEND, emoji }),
        onNotify: (text) => ui.toast(text, 4000),
      })
    : null;

  let state = null; // background 의 공개 상태 (방에 묶인 탭에서만 채워짐)
  let video = null;

  // ---------- 광고 구간 ----------
  // 광고는 사용자마다 다른 영상이다. 광고 중에 서로의 재생/일시정지/시크를 주고받으면 한쪽 광고가 멈추거나 되감겨서,
  // 광고 구간에서는 동기화를 완전히 끄고(보내지도, 받지도 않음) 광고가 끝나면 방 상태에 다시 맞춘다.
  const AD_GRACE_MS = 1500; // 광고가 끝난 직후, 사이트가 본편을 스스로 시작/시크하는 이벤트를 방에 보내지 않는 시간
  let adGraceUntil = 0;
  let adDetect = true; // 팝업 "동기화 설정"에서 끌 수 있음(짧은 영상으로 테스트할 때)
  let inAd = false;
  try {
    chrome.storage.local.get('syncPrefs').then((r) => {
      adDetect = r.syncPrefs?.adDetect !== false;
      evalAd();
    });
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.syncPrefs) {
        adDetect = changes.syncPrefs.newValue?.adDetect !== false;
        evalAd();
      }
    });
  } catch {}

  function setAdNotice(on) {
    if (isTop) ui.showAd(on ? '광고 시청 중이에요. 끝나면 다 같이 이어서 재생해요' : null);
  }

  // 광고: 내 영상은 방과 따로 두고, 방에는 "광고 중이니 기다려 달라"고 알린다(다른 사람 영상도 멈추고, 광고가 끝나면 함께 다시 재생)
  let adReported = false;
  function evalAd() {
    // 페이지를 새로고침하거나 영상이 바뀌어 보고가 끊겼는데 서버는 아직 나를 기다리고 있다면 풀어 준다
    if (video && active() && !inAd && !adReported && !bufferingReported && state.waitingIds?.includes(state.userId)) {
      send({ cmd: CMD.BUFFERING, isBuffering: false });
    }
    const next = adDetect && !!video && !!adapter.isAd?.(video);
    if (next === inAd) return;
    inAd = next;
    if (!inAd) adGraceUntil = Date.now() + AD_GRACE_MS;
    log(inAd ? '광고 구간 시작: 방에 대기 요청' : '광고 구간 끝: 방과 함께 재개');
    clearTimeout(startTimer);
    clearTimeout(bufferTimer);
    setAdNotice(inAd);
    if (inAd) {
      setRate(1);
      if (bufferingReported) {
        bufferingReported = false;
        send({ cmd: CMD.BUFFERING, isBuffering: false }); // 버퍼링 보고는 광고 보고로 대체
      }
      if (active() && state.video.playing && !adReported) {
        adReported = true;
        send({ cmd: CMD.BUFFERING, isBuffering: true, reason: 'ad' }); // 위치는 보내지 않는다(광고 위치는 의미 없음)
      }
    } else if (adReported) {
      adReported = false;
      send({ cmd: CMD.BUFFERING, isBuffering: false }); // 모두 준비되면 서버가 같은 시각에 함께 재생시킨다
      applyRoomVideo(); // 재개 신호가 올 때까지 방 상태(정지)에 맞춰 둔다
    } else if (active() && video && !video.paused && !state.video.playing && canControl()) {
      adGraceUntil = 0; // 정지 상태의 방에서 재생을 눌렀더니 광고가 먼저 나온 경우: 광고 뒤 본편 재생을 방에 알린다
      onLocal('play');
    } else {
      applyRoomVideo(); // 본편으로 돌아왔으니 방 상태(다른 사람의 위치)에 맞춘다
    }
  }
  setInterval(evalAd, 1000);

  const active = () => !!state?.roomCode;

  // 방에 묶인 탭이 처음 보여준 페이지를 벗어나면(다른 영상/페이지로 이동) 방에서 나간다. 새로고침(같은 주소)은 유지.
  // 사이트가 주소를 곧바로 바꿔 쓰는 경우(리다이렉트)를 위해 기록 직후 5초 안의 변경은 새 주소로 다시 기록한다.
  const pageKey = () => location.origin + location.pathname;
  let pageSetAt = 0;
  function checkPage() {
    if (!isTop || !active()) return;
    if (!state.roomPage || (Date.now() - pageSetAt < 5000 && state.roomPage !== pageKey())) {
      pageSetAt = Date.now();
      state = { ...state, roomPage: pageKey() };
      send({ cmd: CMD.ROOM_PAGE, page: pageKey() });
      return;
    }
    if (state.roomPage !== pageKey()) {
      log('방 페이지를 벗어남: 나가기');
      send({ cmd: CMD.LEAVE_ROOM });
    }
  }
  if (isTop) setInterval(checkPage, 1000);
  const serverNow = () => Date.now() + (state?.serverOffset ?? 0);
  // 채팅에 "어느 장면에서 쓴 말인지" 붙이는 재생 위치(초).
  //  1) 이 프레임에 영상이 있으면 실제 재생 위치
  //  2) 영상이 iframe 안에 있으면 그 프레임이 알려준 위치(1초 간격 postMessage)
  //  3) 둘 다 없으면 방 타임라인(마지막 재생/정지/시크 이벤트 + 경과 시간)
  // 방 타임라인만 쓰면, 영상을 이미 재생 중인 상태에서 방에 들어왔을 때 이벤트가 없어 0:00 으로 나온다.
  const currentVideoTime = () => {
    if (inAd) return undefined; // 광고 중의 위치는 장면 정보로 의미가 없다
    if (video) return Math.round(video.currentTime * 10) / 10;
    if (framePos && Date.now() - framePos.at < 5000) {
      if (framePos.ad) return undefined;
      return Math.round((framePos.t + (framePos.playing ? (Date.now() - framePos.at) / 1000 : 0)) * 10) / 10;
    }
    return roomTimeNow();
  };
  let framePos = null; // { t, playing, at } — iframe 안 영상이 알려준 위치
  let frameVid = 0; // iframe 안에 영상이 있다고 마지막으로 알려온 시각
  if (isTop) {
    window.addEventListener('message', (e) => {
      const d = e.data;
      if (e.source !== window && d && d.__bmt === 'vid') frameVid = Date.now();
      if (e.source !== window && d && d.__bmt === 'pos' && Number.isFinite(d.t) && d.t >= 0) {
        framePos = { t: d.t, playing: !!d.playing, ad: !!d.ad, at: Date.now() };
        setAdNotice(!!d.ad); // 영상이 iframe 안에 있어도 최상위 프레임에서 안내를 보여준다
      }
    });
  } else {
    setInterval(() => {
      if (video) window.top.postMessage({ __bmt: 'vid' }, '*');
    }, 1500);
    setInterval(() => {
      if (video && active()) window.top.postMessage({ __bmt: 'pos', t: video.currentTime, playing: !video.paused, ad: inAd }, '*');
    }, 1000);
  }

  // 방의 현재 재생 위치(초) — 서버 기준 타임라인
  const roomTimeNow = () => {
    if (!active()) return undefined;
    const v = state.video;
    const now = serverNow();
    const t = v.playing && v.updatedAt <= now ? v.time + (now - v.updatedAt) / 1000 : v.time;
    return Math.round(Math.max(0, t) * 10) / 10;
  };
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
  let settleTimer = null;
  function seekTo(t) {
    if (!video || Math.abs(video.currentTime - t) < SEEK_THRESHOLD) return;
    expect('seeked');
    adapter.seek(video, t);
    if (adapter.settleMs) {
      // 이동 뒤 재생/정지가 어긋나 있으면(어댑터의 명령이 비동기라 상태 확인이 엇갈린 경우) 방 상태로 다시 맞춘다. 위치는 건드리지 않는다.
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (!video || !active() || inAd) return;
        const v = state.video;
        if (v.updatedAt > serverNow()) return; // 예약된 시작(카운트다운/버퍼링 재개)은 타이머가 맡는다
        setPlaying(v.playing);
      }, adapter.settleMs);
    }
  }

  const isPaused = () => (adapter.isPaused ? adapter.isPaused(video) : video.paused);

  function setPlaying(playing) {
    if (!video) return;
    if (playing && isPaused()) {
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
    } else if (!playing && !isPaused()) {
      expect('pause');
      adapter.pause(video);
    }
  }

  let startTimer = null;

  function setRate(r) {
    if (video && video.playbackRate !== r) video.playbackRate = r;
  }

  // 서버가 저장한 마지막 영상 상태에 맞춘다 (재생 중이면 경과 시간 보정).
  // updatedAt 이 미래면 "그 시각에 재생 시작" 예약(카운트다운/버퍼링 후 재개) 이므로 그때까지 멈춰 둔다.
  function applyRoomVideo() {
    clearTimeout(startTimer);
    if (!video || !active() || inAd) return;
    const v = state.video;
    const now = serverNow();
    if (v.playing && v.updatedAt > now) {
      seekTo(v.time);
      setPlaying(false);
      setRate(1);
      startTimer = setTimeout(() => {
        if (!inAd) setPlaying(true);
      }, v.updatedAt - now);
      return;
    }
    const elapsed = v.playing ? Math.max(0, (now - v.updatedAt) / 1000) : 0;
    seekTo(v.time + elapsed);
    setPlaying(v.playing);
    if (!v.playing) setRate(1);
  }

  function applyRemote(msg) {
    clearTimeout(startTimer);
    if (!video || inAd) return;
    if (msg.action === 'sync') {
      correctDrift(); // 방장 위치로 기준점이 갱신됨: 시크 없이 부드럽게 맞춘다
      return;
    }
    setRate(1);
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

  // ---------- 싱크 자동 보정 ----------
  // 기준 위치(서버의 마지막 상태 + 경과 시간)와 내 위치의 차이로 보정한다.
  // 시크 직후에는 따라가는 쪽이 로딩 때문에 조금(0.2~1초) 늦게 시작하므로 작은 차이도 빨리 줄인다.
  //  - 차이 작음(0.12초 미만; 보정 중에는 0.05초 미만이 될 때까지): 그대로
  //  - ~1.5초: playbackRate 를 최대 ±8% 범위에서 미세 조정(차이가 클수록 세게)
  //  - 1.5초 초과: 시크
  // 방장은 기준점 자체이므로 보정하지 않는다.
  function correctDrift() {
    if (!video || !active() || inAd || video.paused || state.hostId === state.userId) return setRate(1);
    const v = state.video;
    const now = serverNow();
    if (!v.playing || v.updatedAt > now) return setRate(1);
    const expected = v.time + (now - v.updatedAt) / 1000;
    const diff = video.currentTime - expected; // 양수: 내가 앞서 있음
    const abs = Math.abs(diff);
    if (abs < (video.playbackRate !== 1 ? 0.05 : 0.12)) setRate(1);
    else if (abs <= 1.5) {
      const d = Math.min(0.08, Math.max(0.03, abs / 6));
      setRate(diff > 0 ? 1 - d : 1 + d);
    } else {
      setRate(1);
      seekTo(expected);
    }
  }
  setInterval(correctDrift, 1000); // 네트워크 없이 로컬 계산만이라 자주 돌려도 된다(위치 보고는 아래 5초 주기)

  function reportAndCorrect() {
    if (!video || !active() || inAd) return;
    if (!video.paused && !suspiciousJump()) {
      send({ cmd: CMD.SYNC_REPORT, time: video.currentTime, playing: true, sentAt: Date.now() });
    }
    correctDrift();
    if (bufferingReported && video.readyState >= 3) onReady(); // 버퍼링 해소 이벤트를 놓친 경우 대비
  }
  setInterval(reportAndCorrect, REPORT_MS);

  // ---------- 버퍼링 보고 ----------
  let bufferingReported = false;
  let bufferTimer = null;

  function onWaiting() {
    if (!active() || inAd || bufferingReported || !state.video.playing) return;
    clearTimeout(bufferTimer);
    bufferTimer = setTimeout(() => {
      if (video && active() && !video.paused && video.readyState < 3) {
        bufferingReported = true;
        log('버퍼링 시작 보고');
        send({ cmd: CMD.BUFFERING, isBuffering: true, time: video.currentTime });
      }
    }, BUFFER_DEBOUNCE_MS);
  }

  function onReady() {
    clearTimeout(bufferTimer);
    if (!bufferingReported) return;
    bufferingReported = false;
    log('버퍼링 해소 보고');
    send({ cmd: CMD.BUFFERING, isBuffering: false });
  }

  // ---------- 로컬 이벤트 → 서버 ----------
  let lastBlockedToast = 0;

  // 광고가 시작되는 순간에는 화면의 광고 표시가 뜨기 전에 영상이 0초로 바뀌며 seek/play 이벤트가 먼저 나올 수 있다.
  // "방금까지 한참 뒤였는데 갑자기 0~5초"인 이벤트는 광고 감지가 따라올 때까지 잠깐 보류한다.
  let lastStableTime = 0;
  setInterval(() => {
    if (!video || inAd || Number.isNaN(video.duration)) return;
    const t = video.currentTime;
    if (!(t < 5 && lastStableTime - t > 30)) lastStableTime = t; // 갑자기 크게 되감긴 값은 기준으로 삼지 않는다
  }, 500);
  const suspiciousJump = () => !!video && video.currentTime < 5 && lastStableTime - video.currentTime > 30;
  let holdUntil = 0;

  function onLocal(action, silent = false, held = false) {
    if (inAd || Date.now() < adGraceUntil) return; // 광고 중의 조작은 방에 보내지도, 방 상태로 되돌리지도 않는다
    if (!held && suspiciousJump()) {
      if (Date.now() < holdUntil) return; // 보류 중에 이어 오는 이벤트는 보류가 끝날 때 현재 상태로 한 번에 보낸다
      holdUntil = Date.now() + 1500;
      evalAd();
      setTimeout(() => {
        evalAd();
        if (inAd || !video) return log('광고 전환 중의 이벤트 폐기');
        lastStableTime = video.currentTime; // 진짜로 처음으로 돌아간 것이면 그대로 방에 알린다
        onLocal('seek', silent, true);
        onLocal(video.paused ? 'pause' : 'play', silent, true);
      }, 1500);
      return;
    }
    // 소스가 바뀌는 중(메타데이터 전, duration NaN): 광고로 바뀌는 순간의 play(0초) 같은 이벤트가 방 전체를 되감지 않도록 무시
    if (video && Number.isNaN(video.duration)) return;
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
    // background 는 자기 쪽 미러만 갱신하므로, 내 조작도 여기 상태에 반영해 둔다(채팅의 재생 시각, 싱크 보정 기준)
    state.video = {
      playing: action === 'seek' ? state.video.playing : action === 'play',
      time: video.currentTime,
      updatedAt: serverNow(),
    };
    send({ cmd: CMD.VIDEO_EVENT, action, time: video.currentTime, sentAt: Date.now(), silent });
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
    v.addEventListener('waiting', onWaiting);
    for (const t of ['playing', 'canplay']) v.addEventListener(t, onReady);
    for (const t of AD_EVENTS) v.addEventListener(t, evalAd);
    evalAd();
    applyRoomVideo(); // 영상이 교체/뒤늦게 나타나도 방 상태에 맞춘다
  }

  function detach() {
    if (!video) return;
    video.removeEventListener('play', onPlay);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('seeked', onSeeked);
    video.removeEventListener('waiting', onWaiting);
    for (const t of ['playing', 'canplay']) video.removeEventListener(t, onReady);
    for (const t of AD_EVENTS) video.removeEventListener(t, evalAd);
    video = null;
    if (inAd) {
      inAd = false;
      setAdNotice(false);
    }
    if (adReported) {
      adReported = false;
      send({ cmd: CMD.BUFFERING, isBuffering: false }); // 영상이 사라지면(페이지 이동 등) 기다리지 않도록
    }
    bufferingReported = false;
    clearTimeout(startTimer);
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
  chrome.runtime.onMessage.addListener((m, _sender, sendResponse) => {
    switch (m.cmd) {
      case CMD.HAS_VIDEO:
        if (video) sendResponse(true); // 영상이 없는 프레임은 응답하지 않는다(응답한 프레임이 있으면 그걸 쓴다)
        break;
      case CMD.STATE:
        state = m.state;
        log('state', state.roomCode ?? '방 없음', state.connection);
        if (!active()) {
          ui.hideClickPrompt();
          ui.hideCountdown();
          ui.showWaiting(null);
          chat?.hide();
        } else if (chat) {
          ensureSuitFont(); // 채팅/안내 글꼴(처음 한 번만 불러온다)
          chat.show();
          chat.refreshProfiles();
        }
        break;
      case CMD.SYNC:
        state = m.state;
        applyRoomVideo();
        break;
      case CMD.SEED:
        state = m.state;
        // 방을 만든 사람: 내 영상이 이미 재생 중이어도 서버의 초기 상태(정지, 0초)로 되돌리지 않고, 내 상태를 방에 알린다
        if (video) onLocal(video.paused ? 'pause' : 'play', true); // 방 시작 상태는 채팅 알림으로 띄우지 않는다
        break;
      case CMD.REMOTE_VIDEO:
        state = m.state;
        if (isTop && m.msg.action !== 'sync') ui.hideCountdown();
        applyRemote(m.msg);
        break;
      case CMD.COUNTDOWN:
        state = m.state;
        applyRoomVideo(); // 시작 시각까지 멈춰 두고 예약 재생
        if (isTop) {
          ui.showWaiting(null);
          ui.showCountdown(state.video.updatedAt, serverNow);
        }
        break;
      case CMD.BUFFER:
        state = m.state;
        applyRoomVideo(); // 대기 중이면 멈추고, 모두 준비되면 예약된 시각에 함께 재개
        if (isTop) {
          const nameOf = (id) => state.participants.find((p) => p.id === id)?.name ?? '누군가'; // 내 이름도 "나" 대신 닉네임으로
          const ads = (state.adIds ?? []).filter((id) => id !== state.userId).map(nameOf);
          const bufs = state.waitingIds.filter((id) => !(state.adIds ?? []).includes(id)).map(nameOf);
          const names = [...ads, ...bufs];
          ui.showWaiting(
            ads.length ? `${ads.join(', ')} 님이 광고 시청 중이에요. 끝나면 같이 재생해요` : bufs.length ? `${bufs.join(', ')} 님이 버퍼링 중이에요. 기다리는 중…` : null,
          );
          if (!names.length && state.video.playing && state.video.updatedAt > serverNow()) {
            ui.toast('모두 준비됐어요. 곧 함께 재생해요');
          }
        }
        break;
      case CMD.HISTORY:
        chat?.show();
        chat?.loadHistory(m.chat ?? []);
        break;
      case CMD.CHAT:
        chat?.addMessage(m.msg);
        break;
      case CMD.TYPING_EVENT:
        chat?.setTyping(m.userId, m.isTyping);
        break;
      case CMD.REACTION_EVENT:
        chat?.showReaction(m.userId, m.emoji);
        break;
      case CMD.TOAST:
        if (isTop) ui.toast(m.text);
        break;
    }
  });

  // ---------- 시작: 상태 복구 + 초대 링크 ----------
  const reply = await chrome.runtime.sendMessage({ cmd: CMD.REGISTER }).catch(() => null);
  state = reply?.state ?? null;
  if (chat && active()) {
    ensureSuitFont();
    chat.show();
    chat.loadHistory(reply.chat ?? []);
  }
  log('로드됨', location.href.slice(0, 60), 'room:', state?.roomCode ?? '없음(이 탭은 방에 묶이지 않음)');
  applyRoomVideo();

  if (isTop) {
    const code = new URL(location.href).searchParams.get('wp');
    if (code && /^[A-Za-z0-9]{6}$/.test(code) && state?.roomCode !== code.toUpperCase()) {
      // 영상이 있는 페이지에서만 초대 안내를 띄운다(영상은 나중에 뜰 수 있으니 찾을 때까지 기다린다. iframe 안 영상은 프레임이 알려준다)
      const hasVideo = () => !!video || (frameVid && Date.now() - frameVid < 5000);
      const wait = setInterval(() => {
        if (!hasVideo()) return;
        clearInterval(wait);
        if (state?.roomCode !== code.toUpperCase()) ui.showInvite(code.toUpperCase(), () => send({ cmd: CMD.JOIN_ROOM, roomCode: code, site: location.hostname }));
      }, 700);
    }
  }
})();
