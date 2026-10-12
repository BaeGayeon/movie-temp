// 확장 프로그램 내부(popup / content / background) 메시지. 서버 프로토콜과는 별개.
export const CMD = {
  // popup, content -> background
  GET_STATE: 'get_state',
  REGISTER: 'register', // content 가 로드될 때
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  SET_MODE: 'set_mode',
  VIDEO_EVENT: 'video_event',
  COUNTDOWN_START: 'countdown_start', // popup (방장)
  BUFFERING: 'buffering', // content
  SYNC_REPORT: 'sync_report', // content
  // background -> popup, content
  STATE: 'state',
  SYNC: 'sync', // 방 상태를 받았으니 영상을 맞춰라
  REMOTE_VIDEO: 'remote_video',
  TOAST: 'toast',
  COUNTDOWN: 'countdown',
  BUFFER: 'buffer',
};
