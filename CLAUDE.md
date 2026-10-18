# CLAUDE.md

먼저 `SPEC.md`를 읽을 것. 모든 요구사항, 프로토콜, 단계별 완료 기준이 거기 있다.

작업 규칙(요약, 자세한 건 SPEC 7절):
- 단계별로 구현하고 완료 기준을 확인한 뒤 멈추고 보고한다. 사용자가 "다음 단계 진행"이라고 하기 전에는 다음 단계를 구현하지 않는다.
- 앱 이름은 `extension/config.js`의 `APP_NAME`과 `manifest.json`의 `name`으로만 관리한다.
- `server/src/protocol.js`와 `extension/shared/protocol.js`는 동일해야 한다(서버 테스트가 비교). 수정 시 같이 수정.
- 단계가 끝나면 아래 "현재 진행 단계"를 갱신한다.

## 현재 진행 단계

- 1단계: 완료 (사용자 확인함)
- 2단계: 완료 (사용자 확인함)
- 3단계: 완료 (사용자 확인함)
- 4단계: 완료 (사용자 확인함) — 이미지 프사 + 추가 기능(SPEC 9절). 보류: 티빙/웨이브 어댑터(웨이브는 이용권 구매 후 확인)
- **5단계: 배포 준비 구현 완료, 사용자 확인 대기** (render.yaml, tools/build-store.mjs, matches 최소화, /privacy, docs/store-listing.md). 추가 작업: 이슈 #16(만료된 초대 처리), #11(잠든 서버 깨우기 안내), #8(방 비밀번호/인원 제한/참가 시도 제한) 구현. 남은 것: 실제 Render 배포, 스크린샷 준비, 스토어 제출
  - 추가(5단계 이후, 모두 머지됨): 프사 위치 재조절/프로필 저장 버튼/사진·이모지 전환(#33), 영어 지원(#34), 글꼴 허용 전 안내 문구(#35), 답장 버튼을 말풍선 아래쪽 모서리로(#36)
  - 보안 보강(배포 전 점검): 방 안에 공개되는 `userId` 대신 기기에 둔 비공개 `secret` 으로 본인 확인(방장 가로채기 방지, `identity_mismatch`), 비밀번호 해시는 HMAC-SHA256, 방 만들기/연결 수/방당 인원 상한, WebSocket·CORS 는 `chrome-extension://` Origin 만, `TRUST_PROXY`/`EXTENSION_ID` 환경변수. create_room/join_room 에 `secret` 이 없으면 서버가 무시하므로 서버와 확장은 반드시 같이 배포
  - 영어 지원(i18n): `extension/shared/i18n.js` + `msg-*.js`, 언어 설정 `자동(브라우저)/한국어/English`. 문구를 추가할 땐 ko/en 키를 같이 넣을 것(server/test/i18n.test.js 가 확인). 서버 에러는 코드(`err.<code>`)로 번역하고, 기본 닉네임은 방 만들기/참가 메시지의 `lang` 으로 서버가 정한다
  - 프로필: 편집은 `저장`을 눌러야 반영(미리보기만 즉시). 사진 원본(`photoSource`)과 반대쪽 프사(`avatarAlt`)는 내 기기(chrome.storage.local)에만 보관하고 서버로 보내지 않는다 — `/privacy` 에 반영돼 있으니 보관 항목을 바꾸면 개인정보 페이지(ko/en)도 같이 고칠 것
  - 알아둘 점: 개발용(압축 해제) 확장은 스토어 설치본과 확장 ID가 달라 글꼴 목록 허용(`queryLocalFonts`)을 따로 받아야 한다. 서버와 확장은 같이 배포(`room_idle_closed` 코드는 구버전 확장이 처리하지 못함)
