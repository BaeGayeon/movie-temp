// 서비스 워커: 서버 WebSocket 연결과 방 상태를 보관하고 탭(content)/popup 으로 중계한다.
import { SERVER_URL } from './config.js';
import { C2S, S2C, ERR, MODES, ROOM_CODE_RE } from './shared/protocol.js';
import { CMD } from './shared/cmd.js';

const PING_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_CLOCK_SAMPLES = 5;
const MAX_CHAT_HISTORY = 200; // 채팅 + 재생/정지/이동 알림

const freshRoom = () => ({
  roomCode: null,
  tabId: null, // 방에 묶인 탭: 이 탭의 영상만 동기화한다
  hostId: null,
  mode: 'everyone',
  participants: [],
  video: { playing: false, time: 0, updatedAt: 0 },
  waitingIds: [], // 버퍼링 중이라 모두가 기다리는 참가자
  chat: [], // 최근 채팅(새로고침 후 복구용). content 에는 REGISTER 응답으로만 전달
  serverOffset: 0, // 서버 시각 - 로컬 시각
});

let userId = null;
let profile = null; // { name, avatar, color } — chrome.storage.local 에 저장된 내 프로필
let room = freshRoom();
let connection = 'disconnected'; // disconnected | connecting | connected
let lastError = null;
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
  return { ...rest, userId, connection, error: lastError };
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
  const entry = { kind: 'event', userId: fromId, action, time, sentAt: Date.now() };
  room.chat.push(entry);
  room.chat = room.chat.slice(-MAX_CHAT_HISTORY);
  sendToTab({ cmd: CMD.CHAT, msg: entry });
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

function sendOrQueue(msg) {
  if (ws?.readyState === WebSocket.OPEN) rawSend(msg);
  else {
    pending = msg;
    retry = 0;
    connect();
  }
}

// ---------- 서버 메시지 ----------

function handleServer(m) {
  switch (m.type) {
    case S2C.ROOM_CREATED:
      justCreated = true;
      break;

    case S2C.ROOM_STATE:
      room = {
        ...room,
        roomCode: m.roomCode,
        hostId: m.hostId,
        mode: m.mode,
        participants: m.participants,
        video: m.video,
        waitingIds: m.waitingIds ?? [],
        serverOffset: m.serverNow - Date.now(),
      };
      clockSamples = [];
      syncProfile();
      lastError = null;
      persist();
      broadcast();
      // 입장/재접속: 서버 상태에 맞춘다. 방을 방금 만든 사람은 반대로 내 영상의 현재 상태로 방을 시작한다.
      sendToTab({ cmd: justCreated ? CMD.SEED : CMD.SYNC, state: publicState() });
      justCreated = false;
      break;

    case S2C.PARTICIPANT_JOINED:
      if (!room.participants.some((p) => p.id === m.user.id)) room.participants.push(m.user);
      persist();
      broadcast();
      toast(`${m.user.name}님이 입장했어요`);
      break;

    case S2C.PROFILE_UPDATED: {
      const i = room.participants.findIndex((p) => p.id === m.user.id);
      if (i >= 0) room.participants[i] = m.user;
      else room.participants.push(m.user);
      persist();
      broadcast();
      break;
    }

    case S2C.CHAT:
      {
        const entry = { userId: m.userId, text: m.text, sentAt: m.sentAt, videoTime: m.videoTime };
        room.chat.push(entry);
        room.chat = room.chat.slice(-MAX_CHAT_HISTORY);
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
      toast(`${nameOf(m.user.id)}님이 퇴장했어요`);
      room.participants = room.participants.filter((p) => p.id !== m.user.id);
      persist();
      broadcast();
      break;

    case S2C.HOST_CHANGED:
      room.hostId = m.hostId;
      persist();
      broadcast();
      toast(m.hostId === userId ? '내가 새 방장이 됐어요' : `${nameOf(m.hostId)}님이 새 방장이에요`);
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
      persist();
      broadcast();
      sendToTab({ cmd: CMD.COUNTDOWN, state: publicState() });
      break;

    case S2C.BUFFER_STATE:
      room.waitingIds = m.waitingIds;
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
    if (room.roomCode) {
      toast('방이 사라졌어요');
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

// ---------- 명령 ----------

function leaveRoom(notifyServer = true) {
  const tabId = room.tabId;
  if (notifyServer) rawSend({ type: C2S.LEAVE_ROOM });
  pending = null;
  justCreated = false;
  resetRoom();
  clearTimeout(reconnectTimer);
  if (ws) ws.close(); // 방이 없으면 연결도 유지하지 않는다
  broadcast();
  sendToTab({ cmd: CMD.STATE, state: publicState() }, tabId);
}

function enterRoom(msg, tabId) {
  if (room.roomCode) leaveRoom();
  lastError = null;
  room.tabId = tabId ?? null;
  persist();
  sendOrQueue(msg);
  broadcast();
}

async function onCommand(m, sender) {
  await ready;
  const fromTab = sender.tab?.id;
  switch (m.cmd) {
    case CMD.GET_STATE:
      return publicState();

    case CMD.REGISTER:
      return room.roomCode && fromTab === room.tabId
        ? { state: publicState(), chat: room.chat }
        : { state: null, chat: [] };

    case CMD.CREATE_ROOM:
      enterRoom({ type: C2S.CREATE_ROOM, userId }, m.tabId ?? fromTab);
      return { ok: true };

    case CMD.JOIN_ROOM: {
      const roomCode = String(m.roomCode ?? '').trim().toUpperCase();
      if (!ROOM_CODE_RE.test(roomCode)) {
        lastError = '방 코드는 6자리 영문/숫자예요.';
        broadcast();
        return { ok: false };
      }
      if (roomCode === room.roomCode) return { ok: true };
      enterRoom({ type: C2S.JOIN_ROOM, roomCode, userId }, m.tabId ?? fromTab);
      return { ok: true };
    }

    case CMD.LEAVE_ROOM:
      leaveRoom();
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
      if (room.roomCode && fromTab === room.tabId) rawSend({ type: C2S.BUFFERING, isBuffering: !!m.isBuffering, time: m.time });
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
