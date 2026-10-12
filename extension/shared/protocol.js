// 메시지 타입 상수와 검증. extension/shared/protocol.js 와 동일한 파일을 유지한다(테스트가 비교).

export const C2S = {
  // 1단계
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  VIDEO: 'video',
  SET_PERMISSION: 'set_permission',
  PING: 'ping',
  // 2단계 (미구현)
  COUNTDOWN_START: 'countdown_start',
  BUFFERING: 'buffering',
  SYNC_REPORT: 'sync_report',
  // 3단계 (미구현)
  PROFILE_UPDATE: 'profile_update',
  CHAT: 'chat',
  TYPING: 'typing',
  REACTION: 'reaction',
  // 4단계 (미구현)
  SET_ROOM_OPTIONS: 'set_room_options',
};

export const S2C = {
  // 1단계
  ROOM_CREATED: 'room_created',
  ROOM_STATE: 'room_state',
  PARTICIPANT_JOINED: 'participant_joined',
  PARTICIPANT_LEFT: 'participant_left',
  VIDEO: 'video',
  HOST_CHANGED: 'host_changed',
  MODE_CHANGED: 'mode_changed', // SPEC 추가: 권한 모드 변경 알림
  ERROR: 'error',
  PONG: 'pong',
  // 2단계 (미구현)
  COUNTDOWN: 'countdown',
  BUFFER_STATE: 'buffer_state',
  SERVER_TIME: 'server_time',
  // 3단계 (미구현)
  PROFILE_UPDATED: 'profile_updated',
  CHAT: 'chat',
  TYPING: 'typing',
  REACTION: 'reaction',
};

export const ERR = {
  ROOM_NOT_FOUND: 'room_not_found',
  NOT_ALLOWED: 'not_allowed',
  REPLACED: 'replaced',
};

export const VIDEO_ACTIONS = ['play', 'pause', 'seek'];
export const MODES = ['host_only', 'everyone'];

export const ROOM_CODE_RE = /^[A-Z0-9]{6}$/;
const USER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_TIME = 24 * 60 * 60; // 초

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isTime = (v) => isNum(v) && v >= 0 && v <= MAX_TIME;

// 타입별 검증기: 올바르면 정규화된 메시지를, 아니면 null 을 반환한다.
// 여기에 없는 타입(이후 단계 메시지 포함)은 무시된다.
const validators = {
  [C2S.CREATE_ROOM]: (m) =>
    typeof m.userId === 'string' && USER_ID_RE.test(m.userId)
      ? { type: m.type, userId: m.userId }
      : null,

  [C2S.JOIN_ROOM]: (m) => {
    if (typeof m.userId !== 'string' || !USER_ID_RE.test(m.userId)) return null;
    if (typeof m.roomCode !== 'string') return null;
    const roomCode = m.roomCode.toUpperCase();
    if (!ROOM_CODE_RE.test(roomCode)) return null;
    return { type: m.type, userId: m.userId, roomCode };
  },

  [C2S.LEAVE_ROOM]: (m) => ({ type: m.type }),

  [C2S.VIDEO]: (m) =>
    VIDEO_ACTIONS.includes(m.action) && isTime(m.time) && isNum(m.sentAt)
      ? { type: m.type, action: m.action, time: m.time, sentAt: m.sentAt }
      : null,

  [C2S.SET_PERMISSION]: (m) => (MODES.includes(m.mode) ? { type: m.type, mode: m.mode } : null),

  [C2S.PING]: (m) => ({ type: m.type }),
};

export const MAX_MESSAGE_BYTES = 4096; // 1단계 메시지 상한. 4단계(이미지 프사)에서 타입별로 조정한다.

export function parseMessage(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return null;
  let m;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const validate = validators[m.type];
  return validate ? validate(m) : null;
}
