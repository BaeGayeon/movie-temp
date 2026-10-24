# CLAUDE.md

먼저 `SPEC.md`를 읽을 것. 모든 요구사항, 프로토콜, 단계별 완료 기준이 거기 있다.

작업 규칙(요약, 자세한 건 SPEC 7절):
- 단계별로 구현하고 완료 기준을 확인한 뒤 멈추고 보고한다. 사용자가 "다음 단계 진행"이라고 하기 전에는 다음 단계를 구현하지 않는다.
- 앱 이름은 `extension/config.js`의 `APP_NAME`과 `manifest.json`의 `name`으로만 관리한다.
- `server/src/protocol.js`와 `extension/shared/protocol.js`는 동일해야 한다(서버 테스트가 비교). 수정 시 같이 수정.
- 단계가 끝나면 아래 "현재 진행 단계"를 갱신한다.
- 문서 구성: `README.md`(소개, 로컬 개발 방법), `SPEC.md`(요구사항·프로토콜), `docs/design-notes.md`(설계 메모), `docs/deploy.md`·`docs/deploy-checklist.md`(배포), `docs/release.md`·`CHANGELOG.md`(릴리스), `docs/store-listing.md`(스토어 문구). 지원 사이트 표기는 **확인한 곳(쿠팡플레이·넷플릭스·웨이브)** 만 쓴다(티빙은 지원 예정이라 확인 전까지 표기하지 않는다).

## 로컬 개발 (개발할 때만)

- 서버: `cd server && npm install && npm start`(기본 포트 8080, `GET /health`), 테스트는 `npm test`. 서버를 직접 돌리는 건 로컬 개발용이고 실제 배포는 Render(`docs/deploy.md`).
- 확장: `chrome://extensions` 에서 개발자 모드를 켜고 `extension/` 폴더를 압축해제로 로드. 개발용은 `SERVER_URL` 이 `ws://localhost:8080`(`extension/config.js`).
- 두 크롬 프로필(또는 두 창)에 로드해서 방을 만들고 참가해 본다. 자세한 방법은 `README.md`.

## 현재 진행 단계

- 1단계: 완료 (사용자 확인함)
- 2단계: 완료 (사용자 확인함)
- 3단계: 완료 (사용자 확인함)
- 4단계: 완료 (사용자 확인함) — 이미지 프사 + 추가 기능(SPEC 9절). 보류: 티빙 지원(나중에 지원 예정. 테스트 불가라 지금은 제외. 쿠팡플레이·넷플릭스·웨이브는 확인함)
- 5단계: 완료 (사용자 확인함) (render.yaml, tools/build-store.mjs, matches 최소화, /privacy, docs/store-listing.md). 추가 작업: 이슈 #16(만료된 초대 처리), #11(잠든 서버 깨우기 안내), #8(방 비밀번호/인원 제한/참가 시도 제한) 구현. Render 배포는 끝남(https://bae-movie-temp.onrender.com). 남은 것: 스크린샷 준비, 스토어 제출, 등록 후 `EXTENSION_ID` 설정
  - 추가(5단계 이후, 모두 머지됨): 프사 위치 재조절/프로필 저장 버튼/사진·이모지 전환(#33), 영어 지원(#34), 글꼴 허용 전 안내 문구(#35), 답장 버튼을 말풍선 아래쪽 모서리로(#36), 글꼴 검색/즐겨찾기(#38), 스토어 빌드에서 서버를 못 깨우던 `/health` CORS 수정(#41), 서버 연결/깨우는 중 안내를 팝업 맨 위로(#45)와 실패 이유별 안내(#46), 서버 남용 방지(IP 당 연결/방 수 상한, #39 — SPEC 4단계 범위 조정 참고), 서버 재시작(배포) 때 방 복구(SPEC 4단계 범위 조정 참고)
  - UI 개편(#59, 사용자 확인함): 팝업은 `방 / 내 설정` 탭(마지막 탭 기억, 언어 선택은 탭 줄 오른쪽), 로비는 `만들기 / 참가`(참가 비밀번호 칸은 방이 요구할 때만), 프로필의 색·프사는 `꾸미기`로 접음, 글꼴 직접 입력과 진단 정보 복사(`CMD.DIAG`)는 제거. 채팅은 전송 버튼 없음(Enter), 헤더는 `⚙`·`—` 만(배치 전환은 설정 메뉴 `창`), 설정 메뉴 소제목 그룹, 채팅 창의 `채팅 숨기기` 제거(팝업 `채팅 켜기/끄기`로만), 위로 스크롤 중 새 메시지 오면 `새 메시지 N개 ↓`, 입력칸 한 줄 시작, 리액션 줄 접기(😊 버튼). 접힌 채팅의 새 메시지 미리보기는 기존 토스트(`onNotify`)가 이미 한다
  - 보안 보강(배포 전 점검): 방 안에 공개되는 `userId` 대신 기기에 둔 비공개 `secret` 으로 본인 확인(방장 가로채기 방지, `identity_mismatch`), 비밀번호 해시는 HMAC-SHA256, 방 만들기/연결 수/방당 인원 상한, WebSocket·CORS 는 `chrome-extension://` Origin 만, `TRUST_PROXY`/`EXTENSION_ID` 환경변수. create_room/join_room 에 `secret` 이 없으면 서버가 무시하므로 서버와 확장은 반드시 같이 배포
  - 배포 전/후 확인할 것은 `docs/deploy-checklist.md` 에 정리돼 있다(배포나 서버 환경 설정을 건드릴 때 먼저 볼 것)
  - 배속 동기화: 방 상태 `video.rate`(서버/배경/콘텐츠가 같이 들고 있음)와 `rate` 메시지(C2S)·`video{action:'rate'}`(S2C). 경과 시간 계산(`v.time + 경과 × rate`)과 싱크 보정은 모두 방 배속 기준이므로, 영상 상태를 새로 만들 때(`room.video = {...}`) `rate` 를 빠뜨리지 말 것. 광고 중에는 1배속. 방 밖에서는 사용자의 배속을 건드리지 않는다(`correctDrift` 는 방이 없으면 바로 반환). UI: 헤더 `⚡ N×` 칩(1배속이 아닐 때만)과 ⚙ 메뉴의 슬라이더/빠른 선택. 웨이브·넷플릭스·쿠팡플레이에서 동작 확인함(사이트 자체 배속 메뉴의 체크 표시는 따라오지 않음 — 한계)
  - 릴리스: 확장과 서버는 **한 버전 번호**(현재 1.0.0)로 관리한다. 버전은 `node tools/bump-version.mjs X.Y.Z` 로만 올리고(manifest/서버 package.json/lock 을 같이), `CHANGELOG.md` 에 `## [X.Y.Z] - 날짜` 항목을 쓴 뒤 머지된 main 에서 `vX.Y.Z` 태그를 푸시하면 `.github/workflows/release.yml` 이 GitHub Release(+스토어 zip)를 만든다. 사용자가 바꾼 점은 CHANGELOG 에 남길 것. 절차 전체는 `docs/release.md`
  - 영어 지원(i18n): `extension/shared/i18n.js` + `msg-*.js`, 언어 설정 `자동(브라우저)/한국어/English`. 문구를 추가할 땐 ko/en 키를 같이 넣을 것(server/test/i18n.test.js 가 확인). 서버 에러는 코드(`err.<code>`)로 번역하고, 기본 닉네임은 방 만들기/참가 메시지의 `lang` 으로 서버가 정한다
  - 프로필: 편집은 `저장`을 눌러야 반영(미리보기만 즉시). 사진 원본(`photoSource`)과 반대쪽 프사(`avatarAlt`)는 내 기기(chrome.storage.local)에만 보관하고 서버로 보내지 않는다 — `/privacy` 에 반영돼 있으니 보관 항목을 바꾸면 개인정보 페이지(ko/en)도 같이 고칠 것
  - 연결 끊김 안내는 **재배포(예정된 서버 재시작)와 진짜 오류를 구분해서** 다르게 보여 준다(재배포=차분한 "서버를 업데이트하는 중이에요", 오류=경고색 "연결에 문제가 생겼어요"). 구분 신호: 서버의 `server_restarting` 알림, 연결 종료 코드 1012/1001, 끊긴 직후 `/health` 의 `serverId` 가 바뀌었는지. 끊김 안내 문구/표시를 바꿀 때 이 구분을 없애지 말 것. 짧은 끊김(3초 미만)에는 영상 위에 아무것도 띄우지 않고, 끊긴 동안 동작을 시도했을 때나 3초 넘게 끊겼을 때만 띄운다
  - UI 리디자인(진행 중, 디자인 자료 `design_handoff_movoni_dark/README.md`): 기능/로직/프로토콜/저장 항목은 그대로, 디자인·마크업·문구만 바꾼다. 하늘색 `#B9DEFA` 는 주요 버튼·선택 탭/세그먼트·방 코드 글자·카운트다운 링에만. 아이콘은 `extension/icons/ui/` 의 Lucide SVG(ISC)이고 `node tools/gen-icons.mjs` 가 `shared/icons.js`(createElementNS 용 도형 데이터)를 만든다 — 아이콘을 추가할 땐 SVG를 넣고 다시 돌릴 것.
    - 1단계 완료(토큰·에셋: `theme.js` POPUP 교체 + 예전 이름 별칭, Lucide 아이콘, 새 로고/PNG) — 사용자 확인 대기
    - 결정(사용자 확인): `icons-dev/` 는 새 심볼 + 주황 DEV 띠 유지. 방 안에서의 언어 선택은 방 밖과 같은 위치·모양의 헤더 `globe` 버튼(연결 상태 칩 옆, 누르면 `자동 / 한국어 / English` 목록)
    - 2단계 완료(팝업: 헤더 워드마크+언어/연결 칩, 탭, 로비 만들기/참가(6칸 코드 입력, 오류는 칸 아래), 방 안 방장/참가자, 내 설정(이모지|사진 세그먼트, 위치 조절)) — 사용자 확인 대기. 팝업 아이콘은 HTML 의 `<span class="i" data-icon="이름" data-size="16">` 자리를 popup.js 가 `shared/icons.js` 로 채운다(버튼 글자는 별도 `<span data-i18n>` 에 둘 것: applyI18n 이 textContent 를 덮어쓴다). 방 안에서의 언어 선택은 헤더 globe 버튼(방 안에서는 아이콘만). 참가자에게는 방 설정 카드 대신 현재 조작 방식 한 줄
    - 3단계 채팅 패널 → 4단계 채팅 패널 → 4단계 영상 위 안내 순서. 사용자가 "다음"이라고 하기 전에는 넘어가지 않는다. 별칭(`accent`, `warn-*` 등)은 2단계에서 popup.css 를 새 토큰으로 바꾸면서 지운다
  - 알아둘 점: 개발용(압축 해제) 확장은 스토어 설치본과 확장 ID가 달라 글꼴 목록 허용(`queryLocalFonts`)을 따로 받아야 한다. 서버와 확장은 같이 배포(`room_idle_closed` 코드는 구버전 확장이 처리하지 못함)
