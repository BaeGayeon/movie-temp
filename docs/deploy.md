# 배포

> 까먹기 쉬운 것(서버·확장 같이 배포, `EXTENSION_ID`, 배포 후 IP 확인 등)은 [deploy-checklist.md](deploy-checklist.md) 에 적어 뒀다.

**1. 서버 (Render)**
1. Render 대시보드 → New → Blueprint → 이 저장소 선택. 저장소 루트의 `render.yaml` 이 `server/` 를 Node 웹 서비스로 만든다(`/health` 로 상태 확인, `PORT` 는 Render 가 넣어 준다).
2. 배포가 끝나면 주소(예: `https://내서버.onrender.com`)가 나온다. `https://주소/health` 와 `https://주소/privacy` 가 열리는지 확인.
3. 서버 환경변수(`render.yaml` 에 이미 있음): `TRUST_PROXY=1`(프록시가 붙인 `X-Forwarded-For` 로 IP 별 제한을 건다. 프록시 없이 직접 노출하면 켜지 말 것), `RESTORE_KEY`(방 복구 토큰 서명 키. `render.yaml` 의 `generateValue` 로 자동 생성되며 바꾸지 말 것), `EXTENSION_ID`(스토어에 올린 확장의 ID. 넣으면 그 확장의 접속만 받고, 비우면 아무 확장의 접속이나 받는다. 웹페이지의 접속은 어느 쪽이든 막는다). 확장 ID 는 스토어 등록 뒤에 알 수 있으니 그때 대시보드에서 넣는다.
   배포 뒤 Render 로그/응답으로 IP 가 접속자별로 구분되는지 확인할 것(전부 같은 IP 로 보이면 IP 별 제한이 한꺼번에 걸린다).
4. 무료 플랜은 한동안 접속이 없으면 잠들어 첫 접속이 30초 안팎 느리다. 같이 볼 때 쓰려면 `render.yaml` 의 `plan` 을 `starter` 로 바꾸는 걸 권한다.

**2. 확장 프로그램 (스토어용 묶음)**
```bash
node tools/build-store.mjs --server wss://내서버.onrender.com
```
`dist/store/`(폴더)와 `dist/movoni-<버전>.zip` 이 만들어진다. 이 묶음은 `SERVER_URL` 이 `--server` 값으로 바뀌고, 개발용 주소(`localhost`, `file://`)가 manifest 에서 빠진다.
허용 사이트는 `extension/manifest.json` 의 `content_scripts[0].matches`(와 `web_accessible_resources` 의 `matches`) 한 곳에서 관리한다. 사이트를 추가하면 두 곳에 같이 넣는다.
개발 중에는 `extension/` 폴더를 그대로 로드하면 된다(`localhost` 페이지와 `file://` 에서도 동작).

**3. 스토어 등록**: 문구와 권한 사유는 [store-listing.md](store-listing.md). 개인정보처리방침 URL 은 `https://서버주소/privacy`. 방침 맨 아래 문의 이메일은 `server/public/privacy.html` 에서 바꾼다.
