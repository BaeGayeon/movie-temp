// content script (모든 프레임). 클래식 스크립트라서 ES module 은 동적 import 로 불러온다.
(async () => {
  if (window.__bmtLoaded) return;
  window.__bmtLoaded = true;

  const load = (path) => import(chrome.runtime.getURL(path));
  const [{ CMD }, { MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE }, { initI18n, t: tr }, { ensureSuitFont }, { createDefaultAdapter }, { createNetflixAdapter }, { createUI }, { createChat }] = await Promise.all([
    load('shared/cmd.js'),
    load('shared/protocol.js'),
    load('shared/i18n.js'),
    load('shared/font.js'),
    load('content/adapters/default.js'),
    load('content/adapters/netflix.js'),
    load('content/ui.js'),
    load('content/chat.js'),
  ]);

  await initI18n(); // 저장된 언어 설정(auto/ko/en)을 읽는다. chat.js/ui.js 는 같은 모듈 인스턴스를 쓴다.

  const SEEK_THRESHOLD = 0.5; // 초. 이보다 차이가 작으면 시크하지 않는다
  const TOKEN_TTL = 1500; // 원격 동작이 일으킨 이벤트를 무시하는 유효 시간(ms)
  const SEEK_TOKEN_TTL = 5000; // 이동은 로딩 때문에 seeked 가 한참 늦게 올 수 있어 더 길게
  const MISMATCH_MS = 2500; // 재생/정지가 방과 이만큼 계속 다르면 방 상태로 되돌린다
  const REPORT_MS = 5000; // 재생 중 위치 보고/보정 주기
  const BUFFER_DEBOUNCE_MS = 500; // 이 시간 넘게 멈춰 있어야 버퍼링으로 보고
  const AD_EVENTS = ['durationchange', 'loadedmetadata', 'emptied']; // 같은 <video> 에서 광고 <-> 본편이 바뀌는 신호

  const isTop = window === window.top;
  let onInviteState = null; // 초대 배너가 열려 있을 때 방 상태 변화를 받는 처리기
  // 재생 위치(초) = 본편 위치. 보통은 <video>.currentTime 과 같지만, 넷플릭스는 광고가 지나가면 영상 시간이 광고 때 시간에 이어져
  // 본편 위치와 달라지고(예: 화면 39:39, 영상 시간 0:27) 가까운 곳으로 이동해도 그 차이가 남는다. 그 차이(timeOffset)를 재서 더한다.
  //  - 우리가 이동시킨 경우: 이동한 위치(본편) - 이동 직후 영상 시간 (adapter.contentSeek)
  //  - 화면 재생바의 남은 시간이 보이면: 영상 길이 - 남은 시간 = 본편 위치 (adapter.uiContentTime)
  // 다른 사이트는 항상 0.
  let timeOffset = 0;
  let pendingSeek = null; // { target, at } — 우리가 요청한 이동(본편 위치). seeked 가 오면 이 값으로 차이를 잰다
  const pos = () => video.currentTime + timeOffset;
  function setOffset(off, why) {
    if (Math.abs(off) < 2) off = 0; // 이동 직후 재생이 조금 진행된 정도의 차이는 버린다
    if (Math.abs(off - timeOffset) >= 1) log('본편 위치 보정', { offset: +off.toFixed(1), was: +timeOffset.toFixed(1), why, vct: video ? +video.currentTime.toFixed(1) : null });
    timeOffset = off;
  }
  const log = (...a) => {
    console.log('[bmt]', isTop ? 'top' : 'iframe', ...a); // 진단용 로그
  };
  // 호스트별 어댑터: 넷플릭스는 <video> 를 직접 조작하면 오류(M7375)가 나서 전용 어댑터를 쓴다
  const adapter =
    /(^|\.)netflix\.com$/.test(location.hostname) || document.documentElement.getAttribute('data-bmt-adapter') === 'netflix' // 두 번째는 테스트 페이지용
      ? createNetflixAdapter()
      : createDefaultAdapter();
  const ui = createUI();
  // 채팅/리액션 UI 는 최상위 프레임에만 둔다
  const chat = isTop
    ? createChat({
        getState: () => state,
        onSend: (text, replyTo) => (noteDropped(), send({ cmd: CMD.CHAT_SEND, text, videoTime: currentVideoTime(), replyTo, ad: inAdNow() })),
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

  // ---------- 서버 연결이 끊겼을 때의 안내 ----------
  // 몰입을 깨지 않게, 평소의 짧은 끊김(1~2초)에는 아무것도 띄우지 않는다. 아래 경우에만 영상 위 상자를 띄운다:
  //  - 끊긴 채로 CONN_SHOW_DELAY_MS 가 지났을 때
  //  - 끊긴 동안 내가 재생/정지/이동/채팅을 시도했을 때(그 동작은 전달되지 않으므로 바로 알린다)
  // 상자가 떴던 경우에만 복구될 때 "다시 연결됐어요"를 보여 준다.
  const CONN_SHOW_DELAY_MS = 3000;
  let connTimer = null;
  let connShown = false;
  let droppedAction = false;
  const connLost = () => active() && state.connection !== 'connected';
  function showConnNotice() {
    if (!isTop || !connLost()) return;
    connShown = true;
    const restart = !!state.restarting; // 재배포/서버 재시작(예정된 일)인지, 진짜 오류인지
    ui.showConnection(
      tr(droppedAction ? (restart ? 'content.droppedActionRestart' : 'content.droppedAction') : restart ? 'content.serverRestarting' : 'content.reconnecting'),
      undefined,
      false,
      restart ? 'restart' : 'error',
    );
  }
  function updateConnNotice() {
    if (!isTop) return;
    if (connLost()) {
      if (connShown) showConnNotice(); // 문구만 갱신(재시작 알림이 뒤늦게 온 경우 등)
      else if (droppedAction) showConnNotice();
      else if (!connTimer) connTimer = setTimeout(() => ((connTimer = null), showConnNotice()), CONN_SHOW_DELAY_MS);
    } else {
      clearTimeout(connTimer);
      connTimer = null;
      droppedAction = false;
      if (connShown) ui.showConnection(null, tr(state.restarting ? 'content.reconnectedRestart' : 'content.reconnected'));
      connShown = false;
    }
  }
  // 끊긴 동안 한 동작은 서버로 가지 않는다: 바로 알린다
  function noteDropped() {
    if (!isTop || !connLost()) return;
    droppedAction = true;
    showConnNotice();
  }

  function setAdNotice(on) {
    if (isTop) ui.showAd(on && active() ? tr('content.adSelf') : null);
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
    log(inAd ? '광고 구간 시작: 방에 대기 요청' : '광고 구간 끝: 방과 함께 재개', { pos: video ? +pos().toFixed(1) : null, vct: video ? +video.currentTime.toFixed(1) : null, dur: video?.duration, ...(adapter.debug?.() ?? {}) });
    clearTimeout(startTimer);
    clearTimeout(bufferTimer);
    setAdNotice(inAd);
    if (inAd) {
      if (video && video.playbackRate !== 1) {
        ourRate = 1; // 광고는 방의 배속과 상관없이 보통 속도로 본다
        video.playbackRate = 1;
      }
      if (bufferingReported) {
        bufferingReported = false;
        send({ cmd: CMD.BUFFERING, isBuffering: false }); // 버퍼링 보고는 광고 보고로 대체
      }
      // 방이 재생 중일 때만이 아니라, 다른 사람의 광고/버퍼링 때문에 방이 멈춰 있을 때도 보고한다.
      // 그러지 않으면 먼저 광고를 본 사람이 끝나는 순간 대기 목록이 비어 방이 재개되고, 아직 광고 중인 내 화면은 방과 어긋난다.
      if (active() && (state.video.playing || state.waitingIds?.length) && !adReported) {
        adReported = true;
        send({ cmd: CMD.BUFFERING, isBuffering: true, reason: 'ad' }); // 위치는 보내지 않는다(광고 위치는 의미 없음)
      }
    } else if (adapter.reseekAfterAd && video && active()) {
      normalizeAfterAd();
    } else {
      resumeAfterAd();
    }
  }

  // 넷플릭스: 광고가 끝나면 화면은 원래 장면을 이어서 보여 주지만 영상 시간(video.currentTime)은 광고 때 시간에 이어져서
  // 본편 위치와 다르다(예: 화면 55:13, 영상 시간 0:17). 이 값을 그대로 방에 보내면 기다리던 사람이 처음으로 가고, 그 뒤 동기화로
  // 광고 본 사람까지 처음으로 끌려간다. 그래서 광고가 끝나면 이 값을 쓰지 않고, 방의 위치로 한 번 이동시켜
  // (넷플릭스는 이동하면 영상 시간이 다시 본편 위치와 같아진다) 맞춘 다음에 방과 함께 재개한다.
  let normalizing = false;
  function normalizeAfterAd() {
    normalizing = true;
    setTimeout(() => {
      if (!video || !active() || inAd) {
        normalizing = false;
        return;
      }
      const target = roomTimeNow();
      log('광고 뒤 방 위치로 다시 이동', { target, vct: +video.currentTime.toFixed(1) });
      let timer = null;
      const done = () => {
        video?.removeEventListener('seeked', done);
        clearTimeout(timer);
        if (!normalizing) return;
        normalizing = false;
        if (pendingSeek && video) {
          // seeked 가 오지 않았다: 재생바가 보이면 그걸로, 아니면 화면이 방 위치에 있다고 보고 잰다
          const c = adapter.uiContentTime?.(video);
          setOffset((c ?? pendingSeek.target) - video.currentTime, c != null ? '광고 뒤 재생바' : '광고 뒤 이동(응답 없음)');
          pendingSeek = null;
        }
        log('광고 뒤 이동 완료', { pos: video ? +pos().toFixed(1) : null, vct: video ? +video.currentTime.toFixed(1) : null });
        adGraceUntil = Date.now() + 500; // 이동이 일으킨 이벤트가 방에 나가지 않도록 잠깐 더
        lastRaw = video ? video.currentTime : lastRaw;
        resumeAfterAd();
      };
      video.addEventListener('seeked', done);
      timer = setTimeout(done, 3000);
      expect('seeked');
      if (adapter.contentSeek) pendingSeek = { target, at: Date.now() };
      adapter.seek(video, target);
    }, 700); // 광고 표시가 사라진 직후는 아직 광고 끝부분일 수 있어 잠깐 기다린다
  }
  function resumeAfterAd() {
    if (adReported) {
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
    if (inAd || normalizing) return undefined; // 광고 중의 위치는 장면 정보로 의미가 없다
    if (video) return Math.round(pos() * 10) / 10;
    if (framePos && Date.now() - framePos.at < 5000) {
      if (framePos.ad) return undefined;
      return Math.round((framePos.t + (framePos.playing ? (Date.now() - framePos.at) / 1000 : 0)) * 10) / 10;
    }
    return roomTimeNow();
  };
  let framePos = null; // { t, playing, at } — iframe 안 영상이 알려준 위치
  // 지금 광고를 보는 중인가(영상이 이 프레임에 있으면 내 판정, iframe 안에 있으면 그쪽이 알려준 값)
  const inAdNow = () => inAd || (!video && !!framePos && Date.now() - framePos.at < 5000 && !!framePos.ad);
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
      if (video && active()) window.top.postMessage({ __bmt: 'pos', t: pos(), playing: !video.paused, ad: inAd }, '*');
    }, 1000);
  }

  // 방의 현재 재생 위치(초) — 서버 기준 타임라인
  const roomTimeNow = () => {
    if (!active()) return undefined;
    const v = state.video;
    const now = serverNow();
    const t = v.playing && v.updatedAt <= now ? v.time + ((now - v.updatedAt) / 1000) * (v.rate || 1) : v.time;
    return Math.round(Math.max(0, t) * 10) / 10;
  };
  const canControl = () => state.mode === 'everyone' || state.hostId === state.userId;
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

  // ---------- 무한 루프 방지 ----------
  // 원격 동작을 적용하면 play/pause/seeked 이벤트가 비동기로 뒤따라 발생한다.
  // 적용 직전에 "이 이벤트는 내가 일으킨 것"이라는 표식(토큰)을 남기고, 이벤트가 오면 소비하며 무시한다.
  const tokens = { play: [], pause: [], seeked: [] };
  const expect = (type) => tokens[type].push(Date.now() + (type === 'seeked' ? SEEK_TOKEN_TTL : TOKEN_TTL));
  const unexpect = (type) => tokens[type].pop();
  const consume = (type) => {
    const now = Date.now();
    tokens[type] = tokens[type].filter((t) => t > now);
    return tokens[type].shift() !== undefined;
  };

  // ---------- 원격 상태 적용 ----------
  let settleTimer = null;
  // 우리가 요청한 이동이 끝날 때까지(+잠깐) 영상이 스스로 내는 정지/재생 이벤트는 방에 보내지 않는다(어댑터의 seekPauses).
  // 넷플릭스는 이동하며 로딩하는 동안 영상을 멈췄다가 다시 재생하는데, 이걸 내 조작으로 보내면 방 전체가 멈춘다.
  // 그 사이 재생/정지가 방과 어긋나면 아래 감시가 방 상태로 되돌린다.
  let ourSeekUntil = 0;
  // 방에 막 들어왔을 때 방 위치로 크게 이동하면 "방 위치로 맞췄어요"를 한 번 알린다(갑자기 영상이 이동해 놀라지 않도록)
  let alignNoticeUntil = 0;
  const clock = (sec) => {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  };
  function seekTo(t) {
    if (!video || Math.abs(pos() - t) < SEEK_THRESHOLD) return;
    expect('seeked');
    if (Date.now() < alignNoticeUntil && Math.abs(pos() - t) >= 3) ui.toast(tr('content.aligned', { t: clock(t) }));
    alignNoticeUntil = 0;
    if (adapter.contentSeek) pendingSeek = { target: t, at: Date.now() };
    if (adapter.seekPauses) ourSeekUntil = Date.now() + SEEK_TOKEN_TTL;
    adapter.seek(video, t); // 본편 위치로 요청(넷플릭스 API 는 본편 위치를 받는다). 이동 직후 차이를 다시 잰다(onSeeked)
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
        () => {
          autoplayBlocked = false;
          ui.hideClickPrompt();
        },
        (err) => {
          unexpect('play');
          if (err?.name === 'NotAllowedError') {
            autoplayBlocked = true;
            ui.showClickPrompt(video, () => {
              autoplayBlocked = false;
              applyRoomVideo();
            });
          }
        },
      );
    } else if (!playing && !isPaused()) {
      expect('pause');
      adapter.pause(video);
    }
  }

  let startTimer = null;
  let autoplayBlocked = false; // 브라우저가 자동 재생을 막아 "클릭하세요" 버튼을 띄운 상태

  // 방의 재생 속도(배속). 드리프트 보정은 이 속도에 비율(0.92~1.08)을 곱해서 한다.
  const roomRate = () => state?.video?.rate || 1;
  let ourRate = null; // 우리가 마지막으로 설정한 playbackRate: 이 값으로 바뀐 ratechange 는 사용자가 한 것이 아니다
  function setRate(factor = 1) {
    if (!video) return;
    const r = Math.round(roomRate() * factor * 1000) / 1000;
    if (video.playbackRate !== r) {
      ourRate = r;
      video.playbackRate = r;
    }
  }

  // 서버가 저장한 마지막 영상 상태에 맞춘다 (재생 중이면 경과 시간 보정).
  // updatedAt 이 미래면 "그 시각에 재생 시작" 예약(카운트다운/버퍼링 후 재개) 이므로 그때까지 멈춰 둔다.
  function applyRoomVideo() {
    clearTimeout(startTimer);
    if (!video || !active() || inAd || normalizing) return; // 광고 직후 위치를 맞추는 중이면 끝난 뒤 다시 맞춘다
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
    const elapsed = v.playing ? Math.max(0, ((now - v.updatedAt) / 1000) * (v.rate || 1)) : 0;
    seekTo(v.time + elapsed);
    setPlaying(v.playing);
    setRate(1); // 정지 중에도 방의 배속에 맞춰 둔다(재생을 시작할 때 이미 맞아 있도록)
  }

  function applyRemote(msg) {
    clearTimeout(startTimer);
    if (!video || inAd || normalizing) return;
    if (msg.action === 'sync') {
      correctDrift(); // 방장 위치로 기준점이 갱신됨: 시크 없이 부드럽게 맞춘다
      return;
    }
    if (msg.action === 'rate') {
      setRate(1); // 방의 새 속도로 바꾼다. 기준점도 새로 잡혔으니 위치 차이는 싱크 보정이 맞춘다
      const who = state.participants.find((p) => p.id === msg.fromId)?.name ?? tr('content.someone');
      if (isTop) ui.toast(tr('content.rate', { name: who, r: +msg.rate.toFixed(2) }));
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
    if (!video || !active()) return; // 방에 없으면 사용자의 배속을 건드리지 않는다
    if (inAd || normalizing || remeasuring || video.paused || state.hostId === state.userId) return setRate(1);
    const v = state.video;
    const now = serverNow();
    if (!v.playing || v.updatedAt > now) return setRate(1);
    const expected = v.time + ((now - v.updatedAt) / 1000) * (v.rate || 1);
    const diff = pos() - expected; // 양수: 내가 앞서 있음
    const abs = Math.abs(diff);
    if (abs < (video.playbackRate !== roomRate() ? 0.05 : 0.12)) setRate(1);
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
    if (!video || !active() || inAd || normalizing || remeasuring) return;
    if (!video.paused && !suspiciousJump()) {
      send({ cmd: CMD.SYNC_REPORT, time: pos(), playing: true, sentAt: Date.now() });
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
        send({ cmd: CMD.BUFFERING, isBuffering: true, time: pos() });
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
  // (보정값과 상관없이 영상 시간 그대로 본다: 광고가 시작되면 영상 시간이 0 근처로 떨어진다)
  let lastRaw = 0;
  setInterval(() => {
    if (!video || inAd || Number.isNaN(video.duration)) return;
    const t = video.currentTime;
    if (!(t < 5 && lastRaw - t > 30)) lastRaw = t; // 갑자기 크게 되감긴 값은 기준으로 삼지 않는다
  }, 500);
  const suspiciousJump = () => !!video && video.currentTime < 5 && lastRaw - video.currentTime > 30;
  let holdUntil = 0;
  const HOLD_MS = 3000;

  function onLocal(action, silent = false, held = false) {
    if (inAd || normalizing || remeasuring || Date.now() < adGraceUntil) return; // 광고 중(과 광고 직후 위치를 맞추는 동안)의 조작은 방에 보내지도, 방 상태로 되돌리지도 않는다
    if (!held && suspiciousJump()) {
      if (Date.now() < holdUntil) return; // 보류 중에 이어 오는 이벤트는 보류가 끝날 때 현재 상태로 한 번에 보낸다
      holdUntil = Date.now() + HOLD_MS;
      // 광고 표시가 늦게 뜰 수 있으니 보류하는 동안 계속 확인한다. 광고로 판명되면 즉시 폐기.
      const poll = setInterval(() => {
        evalAd();
        if (inAd || !video) {
          clearInterval(poll);
          holdUntil = 0;
          return log('광고 전환 중의 이벤트 폐기');
        }
        if (Date.now() < holdUntil) return;
        clearInterval(poll);
        lastRaw = video.currentTime; // 끝까지 광고가 아니면 진짜로 처음으로 돌아간 것이니 그대로 방에 알린다
        onLocal('seek', silent, true);
        onLocal(video.paused ? 'pause' : 'play', silent, true);
      }, 300);
      return;
    }
    // 소스가 바뀌는 중(메타데이터 전, duration NaN): 광고로 바뀌는 순간의 play(0초) 같은 이벤트가 방 전체를 되감지 않도록 무시
    if (video && Number.isNaN(video.duration)) return;
    if (!active()) return log('local', action, '무시: 방에 묶인 탭이 아님/방 없음');
    if (!canControl()) {
      // 방장 전용 모드: 보내지 않고 방 상태로 되돌린다
      if (Date.now() - lastBlockedToast > 2000 && isTop) {
        ui.toast(tr('content.hostOnly'));
        lastBlockedToast = Date.now();
      }
      applyRoomVideo();
      return;
    }
    if (!silent) noteDropped(); // 끊겨 있으면 이 동작은 전달되지 않는다
    log('local', action, '전송', pos().toFixed(1), 'vct', video.currentTime.toFixed(1), 'dur', video.duration, 'inAd', inAd);
    // background 는 자기 쪽 미러만 갱신하므로, 내 조작도 여기 상태에 반영해 둔다(채팅의 재생 시각, 싱크 보정 기준)
    state.video = {
      playing: action === 'seek' ? state.video.playing : action === 'play',
      time: pos(),
      updatedAt: serverNow(),
      rate: roomRate(),
    };
    send({ cmd: CMD.VIDEO_EVENT, action, time: pos(), sentAt: Date.now(), silent });
  }

  // 사용자가 영상의 배속을 바꿨다: 방 전체의 배속으로 보낸다(우리가 설정한 값이면 무시). 광고 중에는 보내지 않는다.
  let lastRateBlockedToast = 0;
  const onRateChange = () => {
    if (!video || video.playbackRate === ourRate || inAd || normalizing || !active()) return;
    const r = video.playbackRate;
    if (!(r >= MIN_PLAYBACK_RATE && r <= MAX_PLAYBACK_RATE) || r === roomRate()) return;
    if (!canControl()) {
      if (Date.now() - lastRateBlockedToast > 2000 && isTop) {
        ui.toast(tr('content.hostOnly'));
        lastRateBlockedToast = Date.now();
      }
      setRate(1); // 방장 전용 방: 방의 배속으로 되돌린다
      return;
    }
    if (!state.video.playing || state.video.updatedAt > serverNow()) {
      // 정지 중/예약 중에는 기준 시각을 건드리지 않고 속도만 바꾼다(서버도 같이 처리)
      state.video = { ...state.video, rate: r };
    } else {
      state.video = { ...state.video, time: pos(), updatedAt: serverNow(), rate: r };
    }
    send({ cmd: CMD.RATE_EVENT, rate: r, time: pos(), sentAt: Date.now() });
  };

  const fromOurSeek = (type) => {
    if (Date.now() >= ourSeekUntil) return false;
    return true;
  };
  const onPlay = () => !consume('play') && !fromOurSeek('play') && onLocal('play');
  const onPause = () => !consume('pause') && !fromOurSeek('pause') && onLocal('pause');
  // 우리가 요청한 이동이 끝나면 본편 위치와 영상 시간의 차이를 다시 잰다(넷플릭스는 이동하면 차이가 바뀌거나 사라진다)
  function measureAfterSeek() {
    const mine = !!pendingSeek && Date.now() - pendingSeek.at < 5000;
    if (mine && adapter.contentSeek && video) setOffset(pendingSeek.target - video.currentTime, '이동한 위치');
    pendingSeek = null;
    return mine;
  }

  // 차이가 있는 상태에서 사용자가 직접 이동한 경우: 본편 위치를 모르는 채로 보내면 안 되므로 재생바(남은 시간)를 두 번 읽어
  // 같은 값이 나오면 그걸로 잰 뒤에 보낸다(재생바 글자는 이동 직후 잠깐 늦게 바뀐다). 끝내 못 읽으면 넷플릭스 동작대로 추정한다:
  // 멀리(30초 넘게) 이동하면 차이가 사라지고, 가까이 이동하면 그대로 남는다.
  let remeasuring = false;
  // 이동 직전의 영상 시간(얼마나 멀리 이동했는지 보려고). seeking 이 시작되면 그 직전 값을 고정한다
  let rawSample = 0;
  let seekFrom = 0;
  setInterval(() => {
    if (video && !video.seeking) rawSample = video.currentTime;
  }, 250);
  let seekPreview = null; // 이동이 시작될 때 떠 있던 재생바 미리보기 시간(재생바를 눌러 이동한 경우)
  const onSeeking = () => {
    seekFrom = rawSample;
    seekPreview = adapter.previewTime?.() ?? null;
  };
  function remeasureThenSend(jump, preview) {
    remeasuring = true;
    if (preview != null && video) {
      // 재생바를 눌러 이동: 누른 곳(미리보기 시간)이 이동한 본편 위치다
      setOffset(preview - video.currentTime, '재생바 누른 위치');
      remeasuring = false;
      onLocal('seek', false, true);
      onLocal(isPaused() ? 'pause' : 'play', false, true);
      return;
    }
    let prev = null;
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      const c = video ? adapter.uiContentTime(video) : null;
      const step = video && !video.paused ? 0.4 : 0;
      const stable = c != null && prev != null && Math.abs(c - prev - step) <= 1.2;
      if (c != null) prev = c;
      if (!stable && tries < 6) return;
      clearInterval(timer);
      if (video) {
        if (stable) setOffset(c - video.currentTime, '이동 뒤 재생바');
        else setOffset(jump > 30 ? 0 : timeOffset, jump > 30 ? '멀리 이동(추정)' : '가까이 이동(추정)');
      }
      remeasuring = false;
      if (!video) return;
      onLocal('seek', false, true);
      onLocal(isPaused() ? 'pause' : 'play', false, true);
    }, 400);
  }

  const onSeeked = () => {
    const mine = measureAfterSeek();
    const ours = consume('seeked') || mine;
    if (ours && Date.now() < ourSeekUntil) ourSeekUntil = Date.now() + 1000; // 이동 직후 이어지는 재생 재개 이벤트까지
    if (ours) return; // 우리가 요청한 이동(로딩이 길어 늦게 끝나도 방에 다시 보내지 않는다)
    if (!mine && timeOffset !== 0 && adapter.uiContentTime && video && !inAd && !normalizing) {
      if (!remeasuring) remeasureThenSend(Math.abs(video.currentTime - seekFrom), seekPreview);
      return;
    }
    onLocal('seek');
  };

  // 재생바(남은 시간)가 보일 때마다 차이가 맞는지 확인한다. 두 번 연속 같은 값일 때만 고친다(다른 시간 글자를 잘못 읽는 경우 대비).
  // 재생 중일 때만 본다(정지 중에 재생바를 가리키면 값이 그대로라 잘못 읽어도 일정하게 보인다). 세 번 연속 같은 차이일 때만 고친다.
  let healSeen = [];
  setInterval(() => {
    if (!adapter.uiContentTime || !video || inAd || normalizing || remeasuring || video.seeking || video.paused) return (healSeen = []);
    const c = adapter.uiContentTime(video);
    if (c == null) return (healSeen = []);
    const off = c - video.currentTime;
    if (Math.abs(off - timeOffset) <= 3) return (healSeen = []);
    healSeen = [...healSeen, off].slice(-3);
    if (healSeen.length === 3 && Math.max(...healSeen) - Math.min(...healSeen) <= 1.5) {
      setOffset(off, '재생바와 다름');
      healSeen = [];
    }
  }, 1000);

  // 재생/정지가 방과 계속 다르면 방 상태로 되돌린다.
  // 이동이 오래 걸리면(로딩) 그동안 보낸 재생 명령이 무시되어, 방은 재생 중인데 한쪽 영상만 멈춰 남는 경우가 있다.
  // 이동/광고/버퍼링 대기/예약 재생 중에는 보지 않는다.
  let mismatchSince = 0;
  setInterval(() => {
    const v = state?.video;
    const skip =
      !video || !v || !active() || inAd || Date.now() < ourSeekUntil || normalizing || remeasuring || video.seeking || video.ended || autoplayBlocked ||
      bufferingReported || adReported || state.waitingIds?.length || v.updatedAt > serverNow() ||
      Date.now() < holdUntil || Date.now() < adGraceUntil;
    if (skip || video.paused === !v.playing) return (mismatchSince = 0);
    if (!mismatchSince) return (mismatchSince = Date.now());
    if (Date.now() - mismatchSince < MISMATCH_MS) return;
    mismatchSince = 0;
    log('재생 상태가 방과 달라 맞춤', { room: v.playing ? '재생' : '정지', mine: video.paused ? '정지' : '재생', pos: +pos().toFixed(1) });
    setPlaying(v.playing); // 위치는 건드리지 않는다(다시 이동하면 또 로딩이 걸린다). 위치 차이는 싱크 보정이 맞춘다
    if (!v.playing) seekTo(v.time);
  }, 1000);

  // ---------- <video> 탐지 ----------
  function attach(v) {
    if (video === v) return;
    detach();
    video = v;
    log('video 연결', v.clientWidth + 'x' + v.clientHeight, 'room:', state?.roomCode ?? '없음');
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('seeking', onSeeking);
    v.addEventListener('ratechange', onRateChange);
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
    video.removeEventListener('seeking', onSeeking);
    video.removeEventListener('ratechange', onRateChange);
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
    normalizing = false;
    timeOffset = 0;
    pendingSeek = null;
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
      case CMD.STATE: {
        const wasActive = active();
        state = m.state;
        onInviteState?.(state);
        if (!wasActive && active()) alignNoticeUntil = Date.now() + 10000;
        setAdNotice(inAd); // 광고 안내는 방에 있을 때만(방에 들어오면 켜고, 나가면 끈다)
        // 서버와 연결이 끊긴 동안은 이유와 함께 알린다(그동안 재생/채팅은 전달되지 않는다)
        updateConnNotice();
        chat?.onConnection(state); // 끊겼으면 보내는 중이던 채팅을 "못 보냄"으로
        log('state', state.roomCode ?? '방 없음', state.connection);
        if (!active()) {
          ui.hideClickPrompt();
          ui.hideCountdown();
          ui.showWaiting(null);
          clearTimeout(connTimer);
          connTimer = null;
          connShown = false;
          droppedAction = false;
          ui.showConnection(null, null, true);
          chat?.hide();
        } else if (chat) {
          ensureSuitFont(); // 채팅/안내 글꼴(처음 한 번만 불러온다)
          chat.show();
          chat.refreshProfiles();
        }
        break;
      }
      case CMD.SYNC:
        state = m.state;
        applyRoomVideo();
        break;
      case CMD.SEED:
        state = m.state;
        alignNoticeUntil = 0; // 방을 만든 사람은 맞출 위치가 없다
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
          const nameOf = (id) => state.participants.find((p) => p.id === id)?.name ?? tr('content.someone'); // 내 이름도 "나" 대신 닉네임으로
          const ads = (state.adIds ?? []).filter((id) => id !== state.userId).map(nameOf);
          const bufs = state.waitingIds.filter((id) => !(state.adIds ?? []).includes(id)).map(nameOf);
          const names = [...ads, ...bufs];
          ui.showWaiting(
            ads.length ? tr('content.adOthers', { names: ads.join(', ') }) : bufs.length ? tr('content.bufOthers', { names: bufs.join(', ') }) : null,
          );
          if (!names.length && state.video.playing && state.video.updatedAt > serverNow()) {
            ui.toast(tr('content.allReady'));
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
        if (isTop) ui.toast(m.text, m.ms);
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
      // 배너가 사라지면(참가/닫기/자동) 주소의 ?wp= 를 지워, 새로고침해도 다시 뜨지 않게 한다
      const clearWp = () => {
        try {
          const u = new URL(location.href);
          if (!u.searchParams.has('wp')) return;
          u.searchParams.delete('wp');
          history.replaceState(history.state, '', u.href);
        } catch {}
      };
      const wait = setInterval(async () => {
        if (!hasVideo()) return;
        clearInterval(wait);
        const roomCode = code.toUpperCase();
        if (state?.roomCode === roomCode) return;
        // 방이 아직 있는지 먼저 확인한다. 확인할 수 없으면(null) 일단 초대를 보여 주고, 참가가 실패하면 그때 안내한다
        const reply = await chrome.runtime.sendMessage({ cmd: CMD.CHECK_ROOM, roomCode }).catch(() => null);
        if (state?.roomCode === roomCode) return; // 확인하는 사이 이미 들어간 경우
        if (reply?.exists === false) {
          ui.showExpiredInvite(roomCode, clearWp);
          return;
        }
        // 참가 결과(비밀번호 필요/틀림, 가득 참 등)는 상태로 오므로 배너 안에서 보여 준다
        let joining = false;
        onInviteState = (st) => {
          if (!ui.inviteOpen) return (onInviteState = null);
          if (st.roomCode === roomCode) return ui.inviteJoined(); // 참가 성공
          if (!joining || st.roomCode) return;
          if (st.needPassword?.roomCode === roomCode) {
            joining = false;
            ui.inviteNeedsPassword(tr(st.needPassword.wrong ? 'content.pwWrong' : 'content.pwNeeded'));
          } else if (st.error) {
            joining = false;
            ui.inviteFailed(st.error);
          }
        };
        ui.showInvite(
          roomCode,
          (password) => {
            joining = true;
            send({ cmd: CMD.JOIN_ROOM, roomCode: code, site: location.hostname, password });
          },
          clearWp,
          { passwordRequired: reply?.hasPassword === true },
        );
      }, 700);
    }
  }
})();
