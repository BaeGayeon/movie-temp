// 서비스 워커: 서버 WebSocket 연결과 방 상태를 보관하고 탭(content)/popup 으로 중계한다.
import { SERVER_URL } from './config.js';
import { C2S, S2C, ERR, MODES, ROOM_CODE_RE } from './shared/protocol.js';
import { CMD } from './shared/cmd.js';

const PING_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_CLOCK_SAMPLES = 5;
const MAX_CHAT_HISTORY = 3000; // 채팅 + 재생/정지/이동/입퇴장 알림
// 상한을 넘으면 알림(kind: 'event')부터 오래된 순으로 지워서, 오래 이어진 대화가 알림에 밀려 사라지지 않게 한다
// 긴 글(최대 2000자)이 쌓여도 chrome.storage.local 한도(약 10MB)를 넘지 않도록 글자 수 합계도 제한한다
const MAX_CHAT_HISTORY_CHARS = 1_000_000;
function trimChat(list) {
  let over = list.length - MAX_CHAT_HISTORY;
  let out = list;
  if (over > 0) {
    out = [];
    for (const e of list) {
      if (over > 0 && e.kind === 'event') over--;
      else out.push(e);
    }
    if (over > 0) out = out.slice(over);
  }
  let chars = 0;
  for (const e of out) chars += e.text?.length ?? 0;
  let drop = 0;
  while (chars > MAX_CHAT_HISTORY_CHARS && drop < out.length - 1) chars -= out[drop++].text?.length ?? 0;
  return drop ? out.slice(drop) : out;
}

const freshRoom = () => ({
  roomCode: null,
  tabId: null, // 방에 묶인 탭: 이 탭의 영상만 동기화한다
  site: null, // 방이 열린 사이트(도메인). 다른 창에서 같은 확장을 열었을 때 "어디서 하는 중인지" 보여주는 용도
  roomPage: null, // 그 탭이 방에서 보여준 페이지(origin+path). 이 페이지를 벗어나면 방에서 나간다
  hostId: null,
  mode: 'everyone',
  participants: [],
  video: { playing: false, time: 0, updatedAt: 0 },
  waitingIds: [], // 버퍼링/광고 중이라 모두가 기다리는 참가자
  adIds: [], // 그중 광고를 보고 있는 참가자
  chat: [], // 최근 채팅(새로고침 후 복구용). content 에는 REGISTER 응답으로만 전달
  known: {}, // 방에 있었던 사람들의 프로필(userId -> { name, avatar, color }). 나간 뒤에도 지난 메시지에 닉네임/프사를 보여주기 위함
  serverOffset: 0, // 서버 시각 - 로컬 시각
});

let userId = null;
let profile = null; // { name, avatar, color } — chrome.storage.local 에 저장된 내 프로필
let room = freshRoom();
let connection = 'disconnected'; // disconnected | connecting | connected
let lastError = null;
const WAKING_MSG = '서버를 깨우는 중이에요 (최대 1분)…';
let justCreated = false; // 내가 방금 방을 만들었음(첫 room_state 에서 서버 상태 대신 내 영상 상태로 방을 시작)

let ws = null;
let pingTimer = null;
let reconnectTimer = null;
let retry = 0;
let pending = null; // 연결이 열리면 보낼 메시지(방 만들기/참가)
let clockSamples = []; // { offset, rtt } — RTT 가 가장 작은 표본을 채택

const ready = init();

async function init() {
  const saved = await chrome.storage.local.get(['userId', 'room', 'profile']);
  userId = saved.userId;
  profile = saved.profile ?? null;
  if (!userId) {
    userId = crypto.randomUUID();
    await chrome.storage.local.set({ userId });
  }
  if (saved.room?.roomCode) {
    room = { ...freshRoom(), ...saved.room };
    // 묶인 탭이 사라졌다면 복귀하지 않는다
    try {
      await chrome.tabs.get(room.tabId);
      connect();
    } catch {
      resetRoom();
    }
  }
}

// ---------- 상태 ----------

function publicState() {
  const { chat, ...rest } = room;
  return { ...rest, userId, connection, error: lastError, waking };
}

function persist() {
  chrome.storage.local.set({ room });
}

function resetRoom() {
  room = freshRoom();
  persist();
}

function broadcast() {
  const state = publicState();
  chrome.runtime.sendMessage({ cmd: CMD.STATE, state }).catch(() => {});
  sendToTab({ cmd: CMD.STATE, state });
}

function sendToTab(msg, tabId = room.tabId) {
  if (tabId == null) return;
  chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

function toast(text) {
  sendToTab({ cmd: CMD.TOAST, text });
}

// 저장된 내 프로필이 서버에 등록된 것과 다르면 (입장/재접속 직후) 등록한다
function syncProfile() {
  const me = room.participants.find((p) => p.id === userId);
  if (!profile || !me) return;
  const same =
    me.name === profile.name &&
    me.color === profile.color &&
    me.avatar?.kind === profile.avatar.kind &&
    me.avatar?.value === profile.avatar.value &&
    me.avatar?.bg === profile.avatar.bg;
  if (!same) rawSend({ type: C2S.PROFILE_UPDATE, profile });
}

// 누가 재생/일시정지/시간 이동을 했는지 채팅창에 알린다(채팅 기록에도 남겨 새로고침 후에도 보이게 한다)
function pushVideoNotice(fromId, action, time) {
  pushEvent({ kind: 'event', userId: fromId, action, time, sentAt: Date.now() });
}

// 입장/퇴장도 채팅 알림으로 남긴다. 나간 사람은 곧 참가자 목록에서 빠지므로 그때의 닉네임을 같이 저장한다.
function pushMembershipNotice(user, action) {
  pushEvent({ kind: 'event', userId: user.id, action, name: user.name, sentAt: Date.now() });
}

function pushEvent(entry) {
  room.chat.push(entry);
  room.chat = trimChat(room.chat);
  persist(); // 입장 알림처럼 다른 저장 직후에 만들어지는 것도 새로고침/서비스 워커 재시작 뒤에 남도록 바로 저장
  sendToTab({ cmd: CMD.CHAT, msg: entry });
}

const MAX_KNOWN = 50;
function remember(user) {
  if (!user?.id) return;
  const { id, name, avatar, color } = user;
  delete room.known[id]; // 최근에 본 순서로 유지
  room.known[id] = { name, avatar, color };
  for (const k of Object.keys(room.known).slice(0, Math.max(0, Object.keys(room.known).length - MAX_KNOWN))) delete room.known[k];
}

function nameOf(id) {
  return room.participants.find((p) => p.id === id)?.name ?? '누군가';
}

// 서버가 하는 것과 같은 방식으로 영상 상태를 미러링한다 (늦게 로드되는 content 가 맞출 수 있도록)
function mirrorVideo(action, time, at) {
  room.video = {
    // seek 은 재생 여부 유지, sync(서버가 방장 위치로 기준점 갱신)는 재생 중일 때만 온다
    playing: action === 'seek' ? room.video.playing : action === 'play' || action === 'sync',
    time,
    updatedAt: at,
  };
}

// ---------- WebSocket ----------

function setConnection(c) {
  connection = c;
  broadcast();
}

function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  clearTimeout(reconnectTimer);
  const sock = new WebSocket(SERVER_URL);
  ws = sock;
  setConnection('connecting');

  sock.onopen = () => {
    if (ws !== sock) return;
    retry = 0;
    setConnection('connected');
    const ping = () => rawSend({ type: C2S.PING, clientTime: Date.now() });
    pingTimer = setInterval(ping, PING_MS);
    ping();
    if (pending) {
      rawSend(pending);
      pending = null;
    } else if (room.roomCode) {
      rawSend({ type: C2S.JOIN_ROOM, roomCode: room.roomCode, userId }); // 이전 방으로 복귀
    }
  };
  sock.onmessage = (e) => {
    if (ws !== sock) return;
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    handleServer(m);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    clearInterval(pingTimer);
    connection = 'disconnected';
    if (room.roomCode || pending) scheduleReconnect();
    else broadcast();
  };
  sock.onerror = () => {};
}

function scheduleReconnect() {
  if (!room.roomCode && pending && retry >= 2) {
    // 방 만들기/참가 요청이 서버에 닿지 않음
    pending = null;
    lastError = '서버에 연결할 수 없어요.';
    broadcast();
    return;
  }
  const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** retry) * (0.8 + Math.random() * 0.4);
  retry++;
  broadcast();
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, delay);
}

function rawSend(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// 무료 호스팅 서버는 한동안 접속이 없으면 잠들어서 깨우는 데 30초~1분쯤 걸린다.
// 방 만들기/참가 때는 접속 전에 /health 로 서버를 먼저 깨우고, 오래 걸리면 안내를 띄운다. 깨어나면 이어서 접속한다.
const WAKE_TOTAL_MS = 60_000;
const WAKE_TRY_MS = 8000;
const WAKE_RETRY_MS = 2000;
const WAKE_SHOW_AFTER_MS = 2500; // 이보다 빨리 깨어나면(이미 켜져 있으면) 안내를 띄우지 않는다
const WAKE_FAST_FAILS = 3; // 요청이 바로바로 실패하면(오프라인 등) 1분을 기다리지 않고 포기
let waking = false;
let wakeRun = 0; // 깨우기 시도 번호. 바뀌면 이전 시도는 취소된 것

function cancelWake() {
  wakeRun++;
  waking = false;
}

async function wakeServer() {
  const run = ++wakeRun;
  const start = Date.now();
  const showTimer = setTimeout(() => {
    if (run !== wakeRun) return;
    waking = true;
    toast(WAKING_MSG);
    broadcast();
  }, WAKE_SHOW_AFTER_MS);
  let ok = false;
  let fastFails = 0;
  while (run === wakeRun && Date.now() - start < WAKE_TOTAL_MS) {
    const tried = Date.now();
    try {
      const res = await fetch(`${SERVER_URL.replace(/^ws/, 'http')}/health`, { signal: AbortSignal.timeout(WAKE_TRY_MS), cache: 'no-store' });
      if (res.ok) {
        ok = true;
        break;
      }
    } catch {}
    fastFails = Date.now() - tried < 1000 ? fastFails + 1 : 0;
    if (fastFails >= WAKE_FAST_FAILS) break;
    await new Promise((r) => setTimeout(r, WAKE_RETRY_MS));
  }
  clearTimeout(showTimer);
  if (run !== wakeRun) return false; // 그 사이 방을 나가는 등으로 취소됨
  waking = false;
  return ok;
}

function sendOrQueue(msg) {
  if (ws?.readyState === WebSocket.OPEN) rawSend(msg);
  else {
    pending = msg;
    retry = 0;
    wakeServer().then((ok) => {
      if (pending !== msg) return; // 취소되었거나 다른 요청으로 바뀜
      if (ok) connect();
      else {
        pending = null;
        lastError = '서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
        broadcast();
      }
    });
    broadcast();
  }
}

// ---------- 서버 메시지 ----------

function handleServer(m) {
  switch (m.type) {
    case S2C.ROOM_CREATED:
      justCreated = true;
      break;

    case S2C.ROOM_STATE: {
      const entering = !room.roomCode; // 재접속(같은 방 복귀)이 아니라 처음 들어온 것
      room = {
        ...room,
        roomCode: m.roomCode,
        hostId: m.hostId,
        mode: m.mode,
        participants: m.participants,
        video: m.video,
        waitingIds: m.waitingIds ?? [],
        adIds: m.adIds ?? [],
        serverOffset: m.serverNow - Date.now(),
      };
      for (const p of room.participants) remember(p);
      if (entering && pendingRestore?.roomCode === m.roomCode) {
        room.chat = pendingRestore.chat.slice();
        room.known = { ...pendingRestore.known, ...room.known };
        for (const p of room.participants) remember(p);
      }
      const restored = entering && pendingRestore?.roomCode === m.roomCode;
      if (entering) pendingRestore = null;
      clockSamples = [];
      syncProfile();
      lastError = null;
      persist();
      broadcast();
      // 입장/재접속: 서버 상태에 맞춘다. 방을 방금 만든 사람은 반대로 내 영상의 현재 상태로 방을 시작한다.
      sendToTab({ cmd: justCreated ? CMD.SEED : CMD.SYNC, state: publicState() });
      justCreated = false;
      if (restored) sendToTab({ cmd: CMD.HISTORY, chat: room.chat }); // 지난 채팅/알림을 채팅창에 다시 채운다
      if (entering) {
        const me = room.participants.find((p) => p.id === userId);
        if (me) pushMembershipNotice(me, 'join');
      }
      break;
    }

    case S2C.PARTICIPANT_JOINED:
      if (!room.participants.some((p) => p.id === m.user.id)) room.participants.push(m.user);
      remember(m.user);
      persist();
      broadcast();
      pushMembershipNotice(m.user, 'join'); // 채팅창에 표시(채팅이 접혀 있으면 토스트)
      break;

    case S2C.PROFILE_UPDATED: {
      const i = room.participants.findIndex((p) => p.id === m.user.id);
      if (i >= 0) room.participants[i] = m.user;
      else room.participants.push(m.user);
      remember(m.user);
      persist();
      broadcast();
      break;
    }

    case S2C.CHAT:
      {
        const entry = { id: m.id, userId: m.userId, text: m.text, sentAt: m.sentAt, videoTime: m.videoTime, replyTo: m.replyTo };
        room.chat.push(entry);
        room.chat = trimChat(room.chat);
        persist();
        sendToTab({ cmd: CMD.CHAT, msg: entry });
      }
      break;

    case S2C.TYPING:
      sendToTab({ cmd: CMD.TYPING_EVENT, userId: m.userId, isTyping: m.isTyping });
      break;

    case S2C.REACTION:
      sendToTab({ cmd: CMD.REACTION_EVENT, userId: m.userId, emoji: m.emoji });
      break;

    case S2C.PARTICIPANT_LEFT:
      pushMembershipNotice({ id: m.user.id, name: nameOf(m.user.id) }, 'leave');
      room.participants = room.participants.filter((p) => p.id !== m.user.id);
      persist();
      broadcast();
      break;

    case S2C.HOST_CHANGED:
      room.hostId = m.hostId;
      persist();
      broadcast();
      toast(`${nameOf(m.hostId)}님이 새 방장이에요`); // 나일 때도 닉네임으로
      break;

    case S2C.MODE_CHANGED:
      room.mode = m.mode;
      persist();
      broadcast();
      toast(m.mode === 'host_only' ? '방장만 조작할 수 있어요' : '모두 조작할 수 있어요');
      break;

    case S2C.VIDEO:
      if (m.action !== 'sync') pushVideoNotice(m.fromId, m.action, m.time);
      mirrorVideo(m.action, m.time, m.serverAt);
      persist();
      sendToTab({ cmd: CMD.REMOTE_VIDEO, msg: m, state: publicState() });
      break;

    case S2C.SERVER_TIME: {
      // 시계 오차 보정: 왕복 시간(RTT)의 절반을 편도 지연으로 보고, RTT 가 가장 작은 표본을 쓴다
      const rtt = Date.now() - m.clientTime;
      if (rtt < 0 || rtt > 5000) break;
      clockSamples.push({ rtt, offset: m.serverNow + rtt / 2 - Date.now() });
      clockSamples = clockSamples.slice(-MAX_CLOCK_SAMPLES);
      room.serverOffset = clockSamples.reduce((best, s) => (s.rtt < best.rtt ? s : best)).offset;
      break;
    }

    case S2C.COUNTDOWN:
      room.video = { playing: true, time: m.time, updatedAt: m.startAt };
      room.waitingIds = [];
      room.adIds = [];
      persist();
      broadcast();
      sendToTab({ cmd: CMD.COUNTDOWN, state: publicState() });
      break;

    case S2C.BUFFER_STATE:
      room.waitingIds = m.waitingIds;
      room.adIds = m.adIds ?? [];
      room.video = m.video;
      persist();
      broadcast();
      sendToTab({ cmd: CMD.BUFFER, state: publicState() });
      break;

    case S2C.ERROR:
      handleServerError(m);
      break;
  }
}

function handleServerError(m) {
  if (m.code === ERR.ROOM_NOT_FOUND) {
    if (!room.roomCode) toast(m.message || '방이 닫혔어요'); // 참가가 실패한 경우: 입장 전이라 팝업이 아니라 그 탭에 알린다
    if (room.roomCode) {
      toast(m.message || '방이 사라졌어요');
      const tabId = room.tabId;
      resetRoom();
      sendToTab({ cmd: CMD.STATE, state: publicState() }, tabId);
    }
    lastError = m.message;
    broadcast();
  } else if (m.code === ERR.NOT_ALLOWED) {
    toast(m.message);
    sendToTab({ cmd: CMD.SYNC, state: publicState() }); // 로컬 조작을 방 상태로 되돌림
  } else if (m.code === ERR.REPLACED) {
    leaveRoom(false);
    lastError = m.message;
    broadcast();
  }
}

// 초대 링크의 방이 아직 있는지 서버에 묻는다. 서버가 깨어나는 중이거나 네트워크 오류면 null(모름)
const ROOM_CHECK_TIMEOUT_MS = 6000;
async function roomExists(code) {
  try {
    const url = `${SERVER_URL.replace(/^ws/, 'http')}/rooms/${code}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(ROOM_CHECK_TIMEOUT_MS), cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body.exists === 'boolean' ? body.exists : null;
  } catch {
    return null;
  }
}

// ---------- 명령 ----------

// 방을 나가도 같은 방으로 다시 들어오면 지난 채팅과 입퇴장 기록이 이어지도록 잠시 기억해 둔다(6시간).
// 내가 나간 것도 알림으로 남긴다("곰님이 퇴장했어요" -> 다시 들어오면 "곰님이 입장했어요").
const ROOM_MEMORY_MS = 6 * 60 * 60 * 1000;
let pendingRestore = null; // 다시 들어갈 방의 기억(입장 요청 때 불러옴)

function rememberRoom() {
  if (!room.roomCode) return;
  const me = room.participants.find((p) => p.id === userId) ?? room.known[userId];
  if (me) room.chat.push({ kind: 'event', userId, action: 'leave', name: me.name, sentAt: Date.now() });
  try {
    chrome.storage.local.set({
      roomMemory: { roomCode: room.roomCode, chat: trimChat(room.chat), known: room.known, at: Date.now() },
    });
  } catch {}
}

function leaveRoom(notifyServer = true) {
  const tabId = room.tabId;
  if (notifyServer) {
    rememberRoom();
    rawSend({ type: C2S.LEAVE_ROOM });
  }
  pending = null;
  cancelWake();
  justCreated = false;
  resetRoom();
  clearTimeout(reconnectTimer);
  if (ws) ws.close(); // 방이 없으면 연결도 유지하지 않는다
  broadcast();
  sendToTab({ cmd: CMD.STATE, state: publicState() }, tabId);
}

function enterRoom(msg, tabId, site = null) {
  if (room.roomCode) leaveRoom();
  lastError = null;
  room.tabId = tabId ?? null;
  room.site = site;
  persist();
  sendOrQueue(msg);
  broadcast();
}

// 내장 SUIT 글꼴(페이지 안 UI 용). 서비스 워커는 페이지 CSP 의 영향을 받지 않는다.
let fontBase64 = null;
async function getFontBase64() {
  if (fontBase64) return fontBase64;
  const bytes = new Uint8Array(await (await fetch(chrome.runtime.getURL('fonts/SUIT-Variable.woff2'))).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return (fontBase64 = btoa(bin));
}

// 탭(모든 프레임)에 방과 동기화할 영상이 있는지. 영상이 있는 프레임의 content 만 true 로 응답한다(없으면 응답 없음 -> 거절됨).
async function tabHasVideo(tabId) {
  if (tabId == null) return false;
  try {
    return (await chrome.tabs.sendMessage(tabId, { cmd: CMD.HAS_VIDEO })) === true;
  } catch {
    return false;
  }
}
// 이미 다른 탭에서 방에 있으면 새 방을 만들거나 참가할 수 없다(조용히 기존 방을 떠나지 않는다)
function busyElsewhere(tabId) {
  if (!room.roomCode || tabId === room.tabId) return false;
  lastError = `이미 ${room.site || '다른 탭'}에서 같이보기 중이에요. 먼저 그 방에서 나가 주세요.`;
  broadcast();
  return true;
}
const siteOf = (v) => {
  try {
    return typeof v === 'string' && v ? new URL(v.includes('://') ? v : `https://${v}`).hostname.slice(0, 100) : null;
  } catch {
    return null;
  }
};
const NO_VIDEO_MSG = '이 페이지에서 영상을 찾지 못했어요. 쿠팡플레이·넷플릭스·웨이브·티빙의 영상 페이지에서 시도해 주세요.';

async function onCommand(m, sender) {
  await ready;
  const fromTab = sender.tab?.id;
  switch (m.cmd) {
    case CMD.GET_STATE:
      return publicState();

    case CMD.GET_FONT:
      return { data: await getFontBase64() };

    case CMD.REGISTER:
      return room.roomCode && fromTab === room.tabId
        ? { state: publicState(), chat: room.chat }
        : { state: null, chat: [] };

    case CMD.CHECK_ROOM: {
      const code = String(m.roomCode ?? '').trim().toUpperCase();
      return { exists: ROOM_CODE_RE.test(code) ? await roomExists(code) : null };
    }

    case CMD.HAS_VIDEO:
      return { ok: await tabHasVideo(m.tabId ?? fromTab) };

    case CMD.CREATE_ROOM:
      if (busyElsewhere(m.tabId ?? fromTab)) return { ok: false };
      if (!(await tabHasVideo(m.tabId ?? fromTab))) {
        lastError = NO_VIDEO_MSG;
        broadcast();
        return { ok: false };
      }
      enterRoom({ type: C2S.CREATE_ROOM, userId }, m.tabId ?? fromTab, siteOf(m.site));
      return { ok: true };

    case CMD.JOIN_ROOM: {
      const roomCode = String(m.roomCode ?? '').trim().toUpperCase();
      if (!ROOM_CODE_RE.test(roomCode)) {
        lastError = '방 코드는 6자리 영문/숫자예요.';
        broadcast();
        return { ok: false };
      }
      if (roomCode === room.roomCode) return { ok: true };
      if (busyElsewhere(m.tabId ?? fromTab)) return { ok: false };
      if (!(await tabHasVideo(m.tabId ?? fromTab))) {
        lastError = NO_VIDEO_MSG;
        broadcast();
        return { ok: false };
      }
      {
        const mem = (await chrome.storage.local.get('roomMemory')).roomMemory;
        pendingRestore = mem?.roomCode === roomCode && Date.now() - mem.at < ROOM_MEMORY_MS ? mem : null;
      }
      enterRoom({ type: C2S.JOIN_ROOM, roomCode, userId }, m.tabId ?? fromTab, siteOf(m.site));
      return { ok: true };
    }

    case CMD.LEAVE_ROOM:
      leaveRoom();
      return { ok: true };

    case CMD.ROOM_PAGE:
      if (room.roomCode && fromTab === room.tabId && typeof m.page === 'string' && m.page.length < 500) {
        room.roomPage = m.page;
        room.site = siteOf(m.page) ?? room.site;
        persist();
        broadcast();
      }
      return { ok: true };

    case CMD.SET_MODE:
      if (MODES.includes(m.mode) && room.hostId === userId) rawSend({ type: C2S.SET_PERMISSION, mode: m.mode });
      return { ok: true };

    case CMD.SET_PROFILE:
      if (m.profile?.name && m.profile.avatar && m.profile.color) {
        profile = { name: m.profile.name, avatar: m.profile.avatar, color: m.profile.color };
        await chrome.storage.local.set({ profile });
        if (room.roomCode) rawSend({ type: C2S.PROFILE_UPDATE, profile });
      }
      return { ok: true };

    case CMD.CHAT_SEND:
      if (room.roomCode && fromTab === room.tabId) {
        const msg = { type: C2S.CHAT, text: String(m.text ?? '') };
        if (Number.isFinite(m.videoTime)) msg.videoTime = Math.max(0, m.videoTime);
        if (typeof m.replyTo === 'string') msg.replyTo = m.replyTo;
        rawSend(msg);
      }
      return;

    case CMD.TYPING_SEND:
      if (room.roomCode && fromTab === room.tabId) rawSend({ type: C2S.TYPING, isTyping: !!m.isTyping });
      return;

    case CMD.REACTION_SEND:
      if (room.roomCode && fromTab === room.tabId) rawSend({ type: C2S.REACTION, emoji: m.emoji });
      return;

    case CMD.COUNTDOWN_START:
      if (room.roomCode && room.hostId === userId) {
        rawSend({ type: C2S.COUNTDOWN_START, seconds: Math.min(10, Math.max(1, Math.round(m.seconds) || 3)) });
      }
      return { ok: true };

    case CMD.BUFFERING:
      if (room.roomCode && fromTab === room.tabId) rawSend({ type: C2S.BUFFERING, isBuffering: !!m.isBuffering, time: m.time, reason: m.reason });
      return;

    case CMD.SYNC_REPORT:
      if (room.roomCode && fromTab === room.tabId) {
        rawSend({ type: C2S.SYNC_REPORT, time: m.time, playing: !!m.playing, sentAt: m.sentAt });
      }
      return;

    case CMD.VIDEO_EVENT: {
      if (!room.roomCode || fromTab !== room.tabId) return;
      if (room.mode === 'host_only' && room.hostId !== userId) return;
      rawSend({ type: C2S.VIDEO, action: m.action, time: m.time, sentAt: m.sentAt });
      mirrorVideo(m.action, m.time, Date.now() + room.serverOffset);
      if (!m.silent) pushVideoNotice(userId, m.action, m.time);
      persist();
      return;
    }
  }
}

chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
  onCommand(m, sender).then(sendResponse);
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  if (room.roomCode && tabId === room.tabId) leaveRoom();
});

// 서비스 워커가 종료돼도 주기적으로 깨워 연결을 복구한다
chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async () => {
  await ready;
  if (room.roomCode && !ws) connect();
});
