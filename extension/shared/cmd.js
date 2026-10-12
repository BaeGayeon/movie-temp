// 확장 프로그램 내부(popup / content / background) 메시지. 서버 프로토콜과는 별개.
export const CMD = {
  // popup, content -> background
  GET_STATE: 'get_state',
  REGISTER: 'register', // content 가 로드될 때
  GET_FONT: 'get_font', // content -> background: 내장 SUIT 글꼴(base64)
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  SET_MODE: 'set_mode',
  VIDEO_EVENT: 'video_event',
  COUNTDOWN_START: 'countdown_start', // popup (방장)
  BUFFERING: 'buffering', // content
  SYNC_REPORT: 'sync_report', // content
  SET_PROFILE: 'set_profile', // popup
  CHAT_SEND: 'chat_send', // content
  TYPING_SEND: 'typing_send', // content
  REACTION_SEND: 'reaction_send', // content
  // background -> popup, content
  STATE: 'state',
  SYNC: 'sync', // 방 상태를 받았으니 영상을 맞춰라
  SEED: 'seed', // 방을 만든 직후: 서버 초기 상태로 맞추지 말고 내 영상의 현재 상태로 방을 시작하라
  REMOTE_VIDEO: 'remote_video',
  TOAST: 'toast',
  COUNTDOWN: 'countdown',
  BUFFER: 'buffer',
  CHAT: 'chat',
  HISTORY: 'history', // 같은 방으로 다시 들어왔을 때 지난 채팅/알림 복원
  TYPING_EVENT: 'typing_event',
  REACTION_EVENT: 'reaction_event',
};
