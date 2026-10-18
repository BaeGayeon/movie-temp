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
  - 추가: 프사 위치 재조절/저장 버튼/사진·이모지 전환(PR #33), 영어 지원(i18n: `extension/shared/i18n.js` + `msg-*.js`, 언어 설정 `자동/한국어/English`). 문구를 추가할 땐 ko/en 키를 같이 넣을 것(server/test/i18n.test.js 가 확인)
