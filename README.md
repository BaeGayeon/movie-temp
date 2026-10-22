# bae-movie-temp (임시 이름)

티빙/웨이브/쿠팡플레이/넷플릭스 같은 OTT에서 각자 계정으로 같이 영상을 볼 수 있는 크롬 확장 프로그램.
각자 자기 계정으로 재생하고, 재생/일시정지/시크/배속 **상태만** 동기화한다. 자세한 내용은 [SPEC.md](SPEC.md).

앱 이름은 `extension/config.js`의 `APP_NAME`과 `extension/manifest.json`의 `name` 두 곳에서만 관리한다.

## 서버 실행

```bash
cd server
npm install
npm start          # PORT 환경변수 사용, 기본 8080. GET /health 제공
npm test           # WebSocket 클라이언트로 방 생성/참가/중계 등을 검증
```

서버 주소는 `extension/config.js`의 `SERVER_URL`(개발용 `ws://localhost:8080`).
서버가 `GET /privacy` 로 개인정보처리방침 페이지(`server/public/privacy.html`)도 제공한다.

## 문서

- [SPEC.md](SPEC.md): 요구사항, 메시지 프로토콜, 단계별 완료 기준
- [docs/design-notes.md](docs/design-notes.md): 설계 메모(동작 방식, 광고 구간, 프로토콜 추가 사항)
- [docs/deploy.md](docs/deploy.md): 배포 방법(Render 서버, 스토어용 확장), [docs/deploy-checklist.md](docs/deploy-checklist.md): 배포 전/후 확인할 것
- [docs/release.md](docs/release.md): 릴리스 절차, [CHANGELOG.md](CHANGELOG.md): 변경 기록
- [docs/store-listing.md](docs/store-listing.md): 스토어 등록 문구

## 크롬에 확장 프로그램 로드

1. `chrome://extensions` → 우상단 **개발자 모드** 켜기
2. **압축해제된 확장 프로그램을 로드합니다** → `extension/` 폴더 선택
3. `file://` 로 로컬 mp4를 직접 열어 테스트하려면 확장 프로그램 상세에서 **파일 URL에 대한 액세스 허용**을 켠다.

## 크롬 프로필 두 개로 테스트

1. 서버 실행 후, 크롬 프로필 A·B 각각에서 위 방법으로 확장 프로그램을 로드한다.
2. 프로필 A: `<video>`가 있는 페이지(예: mp4 URL을 직접 열기)에서 확장 아이콘 → **방 만들기**.
3. **초대 링크 복사** → 프로필 B에서 그 링크를 열면 "같이 보기 초대" 배너가 뜬다 → **참가**.
   (또는 B에서 같은 영상 페이지를 열고 팝업에 방 코드 입력)
4. 한쪽에서 재생/일시정지/시크 → 다른 쪽에 반영되는지 확인.
5. 팝업의 **조작** 드롭다운(방장만 보임)으로 "방장만 조작"을 켜고 B에서 조작해 본다.
6. (2단계) 방장 팝업의 **카운트다운 시작**(3/5/10초) → 모든 참가자 화면에 "3, 2, 1, 재생!"이 뜨고 같은 순간에 재생된다.
7. (2단계) 한 명이 버퍼링하면 나머지가 멈추고 "OO님이 버퍼링 중…"이 뜬다. 해소되면 함께 재개, 최대 15초까지만 기다린다.

방은 확장 프로그램이 "방을 만들거나 참가한 탭"에 묶인다. 그 탭을 닫으면 방에서 나가고, 새로고침하면 같은 방으로 복귀한다.
