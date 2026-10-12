// 서비스 워커: 서버 WebSocket 연결과 방 상태를 보관하고 탭(content)/popup 으로 중계한다.
import { SERVER_URL } from './config.js';
import { C2S, S2C, ERR, MODES, ROOM_CODE_RE } from './shared/protocol.js';
import { CMD } from './shared/cmd.js';

const PING_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;

const freshRoom = () => ({
  roomCode: null,
  tabId: null, // 방에 묶인 탭: 이 탭의 영상만 동기화한다
  hostId: null,
  mode: 'everyone',
  participants: [],
  video: { playing: false, time: 0, updatedAt: 0 },
  serverOffset: 0, // 서버 시각 - 로컬 시각
});

let userId = null;
let room = freshRoom();
let connection = 'disconnected'; // disconnected | connecting | connected
let lastError = null;

let ws = null;
let pingTimer = null;
let reconnectTimer = null;
let retry = 0;
let pending = null; // 연결이 열리면 보낼 메시지(방 만들기/참가)

const ready = init();

async function init() {
  const saved = await chrome.storage.local.get(['userId', 'room']);
  userId = saved.userId;
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
  return { ...room, userId, connection, error: lastError };
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

function nameOf(id) {
  return room.participants.find((p) => p.id === id)?.name ?? '누군가';
}

// 서버가 하는 것과 같은 방식으로 영상 상태를 미러링한다 (늦게 로드되는 content 가 맞출 수 있도록)
function mirrorVideo(action, time, at) {
  room.video = {
    playing: action === 'seek' ? room.video.playing : action === 'play',
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
    pingTimer = setInterval(() => rawSend({ type: C2S.PING }), PING_MS);
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
    case S2C.ROOM_STATE:
      room = {
        ...room,
        roomCode: m.roomCode,
        hostId: m.hostId,
        mode: m.mode,
        participants: m.participants,
        video: m.video,
        serverOffset: m.serverNow - Date.now(),
      };
      lastError = null;
      persist();
      broadcast();
      sendToTab({ cmd: CMD.SYNC, state: publicState() }); // 입장/재접속 시 위치 맞추기
      break;

    case S2C.PARTICIPANT_JOINED:
      if (!room.participants.some((p) => p.id === m.user.id)) room.participants.push(m.user);
      persist();
      broadcast();
      toast(`${m.user.name}님이 입장했어요`);
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
      mirrorVideo(m.action, m.time, m.serverAt);
      persist();
      sendToTab({ cmd: CMD.REMOTE_VIDEO, msg: m, state: publicState() });
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
      return { state: room.roomCode && fromTab === room.tabId ? publicState() : null };

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

    case CMD.VIDEO_EVENT: {
      if (!room.roomCode || fromTab !== room.tabId) return;
      if (room.mode === 'host_only' && room.hostId !== userId) return;
      rawSend({ type: C2S.VIDEO, action: m.action, time: m.time, sentAt: m.sentAt });
      mirrorVideo(m.action, m.time, Date.now() + room.serverOffset);
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
