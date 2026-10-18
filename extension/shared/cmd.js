// 확장 프로그램 내부(popup / content / background) 메시지. 서버 프로토콜과는 별개.
export const CMD = {
  // popup, content -> background
  GET_STATE: 'get_state',
  REGISTER: 'register', // content 가 로드될 때
  GET_FONT: 'get_font', // content -> background: 내장 SUIT 글꼴(base64)
  CHECK_ROOM: 'check_room', // content -> background: 초대 링크의 방이 아직 있는지 서버에 물음 -> { exists: true | false | null(모름) }
  HAS_VIDEO: 'has_video', // popup -> background(탭에 영상이 있는지 물음) / background -> content(영상이 있는 프레임만 true 로 응답)
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  ROOM_PAGE: 'room_page', // content -> background: 방에 묶인 탭이 처음 보여준 페이지(주소). 벗어나면 방에서 나간다
  SET_MODE: 'set_mode',
  SET_ROOM_OPTIONS: 'set_room_options', // popup (방장): { password?: string | null, maxMembers?: number | null }
  GET_ROOM_PW: 'get_room_pw', // popup (방장): 이 브라우저가 기억하는 방 비밀번호(모르면 null)
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
