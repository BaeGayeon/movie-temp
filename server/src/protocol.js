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
  // 4단계: 방 옵션(비밀번호/인원 제한)은 방을 만들 때 create_room 에 실어 보낸다. set_room_options 는 쓰지 않는다.
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
  PASSWORD_REQUIRED: 'password_required', // 비밀번호가 있는 방에 비밀번호 없이 들어오려 함
  WRONG_PASSWORD: 'wrong_password',
  ROOM_FULL: 'room_full',
  TOO_MANY_ATTEMPTS: 'too_many_attempts', // 참가 실패가 잦아 잠시 차단
};

export const VIDEO_ACTIONS = ['play', 'pause', 'seek'];
// 서버 -> 클라이언트 video 메시지에만 쓰는 action: 방장의 실제 위치로 기준점을 갱신(부드러운 보정용)
export const VIDEO_ACTION_SYNC = 'sync';
export const MAX_COUNTDOWN_SECONDS = 10;

// 3단계: 프로필/채팅/리액션 제한
export const MAX_NAME_LENGTH = 16;
export const MAX_CHAT_LENGTH = 2000;
// 리액션 빠른 선택 목록(기본). 감정이 비슷한 것끼리 묶어 두었다(묶음 사이는 화면에서 간격을 둔다).
//   호감·기쁨 | 응원·축하 | 놀람·의문 | 슬픔 | 화남·무덤덤
// 서버는 이모지 1개면 무엇이든 허용하고 빈도만 제한한다.
export const REACTION_GROUPS = [
  ['❤️', '😍', '😂', '😎'],
  ['👍', '👏', '🎉', '🔥'],
  ['😱', '🤯', '❓'],
  ['😢', '😭'],
  ['😡', '😑'],
];
export const REACTION_EMOJIS = REACTION_GROUPS.flat();
export const DEFAULT_AVATAR_EMOJI = '🙂';
// 닉네임 색/프사 배경 팔레트: 어두운 배경에서 잘 읽히는 파스텔톤
export const COLOR_PALETTE = ['#ff9aa8', '#ffb98a', '#ffe08f', '#9be3a8', '#8fe0cf', '#8cc8ff', '#b7a8ff', '#ffa8d1', '#ffffff'];
// 새 참가자에게 서버가 나눠 주는 기본 색(흰색은 직접 고르는 색으로만)
export const DEFAULT_COLORS = COLOR_PALETTE.filter((c) => c !== '#ffffff');
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CONTROL_RE = /[\p{C}\u2028\u2029]/u; // 제어/서식 문자(줄바꿈, 제로폭 문자 등)

// 이모지 1개(국기, 키캡, ZWJ 조합 포함) 여부. 이모지는 모두 허용하되 텍스트는 막는다.
const SINGLE_EMOJI_RE = /^\p{RGI_Emoji}$/v;
export const isSingleEmoji = (v) => typeof v === 'string' && v.length <= 32 && SINGLE_EMOJI_RE.test(v);

// 이미지 프사: 클라이언트가 64x64 로 줄여 WebP/JPEG 데이터 URL 로 보낸다. 서버는 형식/크기/파일 헤더를 검증한다.
export const MAX_AVATAR_IMAGE_BYTES = 20 * 1024;
const IMAGE_DATA_URL_RE = /^data:image\/(webp|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;
export function isValidAvatarImage(value) {
  if (typeof value !== 'string' || value.length > Math.ceil((MAX_AVATAR_IMAGE_BYTES * 4) / 3) + 64) return false;
  const m = IMAGE_DATA_URL_RE.exec(value);
  if (!m) return false;
  let bin;
  try {
    bin = atob(m[2]);
  } catch {
    return false;
  }
  if (bin.length < 12 || bin.length > MAX_AVATAR_IMAGE_BYTES) return false;
  const jpeg = bin.charCodeAt(0) === 0xff && bin.charCodeAt(1) === 0xd8 && bin.charCodeAt(2) === 0xff;
  const webp = bin.startsWith('RIFF') && bin.slice(8, 12) === 'WEBP';
  return m[1] === 'jpeg' ? jpeg : webp; // 선언한 형식과 실제 파일 헤더가 일치해야 한다
}

// 프로필 검증: 올바르면 정규화된 profile, 아니면 null.
export function validateProfile(p) {
  if (!p || typeof p !== 'object') return null;
  if (typeof p.name !== 'string') return null;
  const name = p.name.trim();
  if (name.length < 1 || name.length > MAX_NAME_LENGTH || CONTROL_RE.test(name)) return null;
  const a = p.avatar;
  if (!a || typeof a !== 'object') return null;
  if (a.kind === 'emoji') {
    if (!isSingleEmoji(a.value)) return null;
  } else if (a.kind === 'image') {
    if (!isValidAvatarImage(a.value)) return null;
  } else return null;
  if (typeof a.bg !== 'string' || !HEX_COLOR_RE.test(a.bg)) return null; // 이미지일 때는 로딩 전 대체 색
  if (typeof p.color !== 'string' || !HEX_COLOR_RE.test(p.color)) return null;
  return { name, avatar: { kind: a.kind, value: a.value, bg: a.bg.toLowerCase() }, color: p.color.toLowerCase() };
}
export const MODES = ['host_only', 'everyone'];

// 방 옵션: 비밀번호(선택, 4~32자)와 최대 인원(선택, 2~20명)
export const MIN_PASSWORD_LENGTH = 4;
export const MAX_PASSWORD_LENGTH = 32;
export const MIN_ROOM_MEMBERS = 2;
export const MAX_ROOM_MEMBERS = 20;
export const isValidNewPassword = (v) =>
  typeof v === 'string' && v.length >= MIN_PASSWORD_LENGTH && v.length <= MAX_PASSWORD_LENGTH && !/[\p{C}\u2028\u2029]/u.test(v);
export const isValidMaxMembers = (v) => Number.isInteger(v) && v >= MIN_ROOM_MEMBERS && v <= MAX_ROOM_MEMBERS;

export const ROOM_CODE_RE = /^[A-Z0-9]{6}$/;
const USER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_TIME = 24 * 60 * 60; // 초

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isTime = (v) => isNum(v) && v >= 0 && v <= MAX_TIME;

// 타입별 검증기: 올바르면 정규화된 메시지를, 아니면 null 을 반환한다.
// 여기에 없는 타입(이후 단계 메시지 포함)은 무시된다.
const validators = {
  [C2S.CREATE_ROOM]: (m) => {
    if (typeof m.userId !== 'string' || !USER_ID_RE.test(m.userId)) return null;
    const out = { type: m.type, userId: m.userId };
    if (m.password !== undefined) {
      if (!isValidNewPassword(m.password)) return null;
      out.password = m.password;
    }
    if (m.maxMembers !== undefined) {
      if (!isValidMaxMembers(m.maxMembers)) return null;
      out.maxMembers = m.maxMembers;
    }
    return out;
  },

  [C2S.JOIN_ROOM]: (m) => {
    if (typeof m.userId !== 'string' || !USER_ID_RE.test(m.userId)) return null;
    if (typeof m.roomCode !== 'string') return null;
    const roomCode = m.roomCode.toUpperCase();
    if (!ROOM_CODE_RE.test(roomCode)) return null;
    const out = { type: m.type, userId: m.userId, roomCode };
    if (m.password !== undefined) {
      if (typeof m.password !== 'string' || m.password.length > MAX_PASSWORD_LENGTH) return null;
      out.password = m.password;
    }
    return out;
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
    if (m.reason !== undefined) {
      if (m.reason !== 'ad') return null; // 광고 중이라 모두 기다리는 경우(기본은 버퍼링)
      out.reason = 'ad';
    }
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
    // 줄바꿈은 살리되(연속 빈 줄은 한 줄로) 탭은 공백으로, 줄 끝 공백은 지운다
    const text = m.text.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/ +\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < 1 || text.length > MAX_CHAT_LENGTH || /[\p{Cc}\u2028\u2029]/u.test(text.replace(/\n/g, ''))) return null;
    // videoTime: 보낸 시점의 영상 재생 위치(초). 선택 사항
    if (m.videoTime !== undefined && !isTime(m.videoTime)) return null;
    const out = { type: m.type, text };
    if (m.videoTime !== undefined) out.videoTime = m.videoTime;
    // replyTo: 답장 대상 메시지의 id(서버가 붙여 준 8자리 16진수). 형식이 틀리면 답장 표시만 버리고 메시지는 보낸다
    if (typeof m.replyTo === 'string' && /^[0-9a-f]{8}$/.test(m.replyTo)) out.replyTo = m.replyTo;
    return out;
  },

  [C2S.TYPING]: (m) => (typeof m.isTyping === 'boolean' ? { type: m.type, isTyping: m.isTyping } : null),

  [C2S.REACTION]: (m) => (isSingleEmoji(m.emoji) ? { type: m.type, emoji: m.emoji } : null),

  [C2S.SYNC_REPORT]: (m) =>
    isTime(m.time) && typeof m.playing === 'boolean' && isNum(m.sentAt)
      ? { type: m.type, time: m.time, playing: m.playing, sentAt: m.sentAt }
      : null,
};

export const MAX_MESSAGE_BYTES = 8192; // 일반 메시지 상한(채팅 2000자가 전부 이스케이프돼도 4000자 안팎)
export const MAX_PROFILE_MESSAGE_BYTES = 40 * 1024; // profile_update 만 이미지 프사(20KB, base64 ~27KB) 때문에 크다

export function parseMessage(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_PROFILE_MESSAGE_BYTES) return null;
  let m;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  if (raw.length > MAX_MESSAGE_BYTES && m.type !== C2S.PROFILE_UPDATE) return null;
  const validate = validators[m.type];
  return validate ? validate(m) : null;
}
