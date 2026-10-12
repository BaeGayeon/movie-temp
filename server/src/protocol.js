// 메시지 타입 상수와 검증. extension/shared/protocol.js 와 동일한 파일을 유지한다(테스트가 비교).

export const C2S = {
  // 1단계
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  VIDEO: 'video',
  SET_PERMISSION: 'set_permission',
  PING: 'ping',
  // 2단계
  COUNTDOWN_START: 'countdown_start',
  BUFFERING: 'buffering',
  SYNC_REPORT: 'sync_report',
  // 3단계
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
  // 2단계
  COUNTDOWN: 'countdown',
  BUFFER_STATE: 'buffer_state',
  SERVER_TIME: 'server_time',
  // 3단계
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
// 서버 -> 클라이언트 video 메시지에만 쓰는 action: 방장의 실제 위치로 기준점을 갱신(부드러운 보정용)
export const VIDEO_ACTION_SYNC = 'sync';
export const MAX_COUNTDOWN_SECONDS = 10;

// 3단계: 프로필/채팅/리액션 제한
export const MAX_NAME_LENGTH = 16;
export const MAX_CHAT_LENGTH = 300;
export const REACTION_EMOJIS = ['❤️', '😂', '😱', '👍', '👏', '🔥', '😢', '🎉'];
export const DEFAULT_AVATAR_EMOJI = '🙂';
export const COLOR_PALETTE = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#9775fa', '#f783ac'];
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const CONTROL_RE = /[\p{C}\u2028\u2029]/u; // 제어/서식 문자(줄바꿈, 제로폭 문자 등)

const segmenter = new Intl.Segmenter();
const graphemeCount = (str) => [...segmenter.segment(str)].length;

// 프로필 검증: 올바르면 정규화된 profile, 아니면 null. (4단계에서 avatar.kind "image" 추가 예정)
export function validateProfile(p) {
  if (!p || typeof p !== 'object') return null;
  if (typeof p.name !== 'string') return null;
  const name = p.name.trim();
  if (name.length < 1 || name.length > MAX_NAME_LENGTH || CONTROL_RE.test(name)) return null;
  const a = p.avatar;
  if (!a || typeof a !== 'object' || a.kind !== 'emoji') return null;
  if (typeof a.value !== 'string' || a.value.length > 16 || graphemeCount(a.value) !== 1 || !EMOJI_RE.test(a.value)) return null;
  if (typeof a.bg !== 'string' || !HEX_COLOR_RE.test(a.bg)) return null;
  if (typeof p.color !== 'string' || !HEX_COLOR_RE.test(p.color)) return null;
  return { name, avatar: { kind: 'emoji', value: a.value, bg: a.bg.toLowerCase() }, color: p.color.toLowerCase() };
}
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

  [C2S.PING]: (m) => (isNum(m.clientTime) ? { type: m.type, clientTime: m.clientTime } : { type: m.type }),

  [C2S.COUNTDOWN_START]: (m) =>
    Number.isInteger(m.seconds) && m.seconds >= 1 && m.seconds <= MAX_COUNTDOWN_SECONDS
      ? { type: m.type, seconds: m.seconds }
      : null,

  [C2S.BUFFERING]: (m) => {
    if (typeof m.isBuffering !== 'boolean') return null;
    const out = { type: m.type, isBuffering: m.isBuffering };
    if (m.time !== undefined) {
      if (!isTime(m.time)) return null;
      out.time = m.time;
    }
    return out;
  },

  [C2S.PROFILE_UPDATE]: (m) => {
    const profile = validateProfile(m.profile);
    return profile ? { type: m.type, profile } : null;
  },

  [C2S.CHAT]: (m) => {
    if (typeof m.text !== 'string') return null;
    const text = m.text.replace(/[\r\n\t]+/g, ' ').trim();
    if (text.length < 1 || text.length > MAX_CHAT_LENGTH || /[\p{Cc}\u2028\u2029]/u.test(text)) return null;
    return { type: m.type, text };
  },

  [C2S.TYPING]: (m) => (typeof m.isTyping === 'boolean' ? { type: m.type, isTyping: m.isTyping } : null),

  [C2S.REACTION]: (m) => (REACTION_EMOJIS.includes(m.emoji) ? { type: m.type, emoji: m.emoji } : null),

  [C2S.SYNC_REPORT]: (m) =>
    isTime(m.time) && typeof m.playing === 'boolean' && isNum(m.sentAt)
      ? { type: m.type, time: m.time, playing: m.playing, sentAt: m.sentAt }
      : null,
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
