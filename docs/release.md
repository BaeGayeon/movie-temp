# 릴리스 절차

확장과 서버는 같이 배포하므로 **한 버전 번호**를 쓴다(`0.2.0` 형식, 태그는 `v0.2.0`).
크롬 웹스토어는 올릴 때마다 `manifest.json` 의 version 이 이전보다 커야 한다.

## 버전 올리는 기준
- 기능이 추가되면 가운데 숫자(0.2.0 → 0.3.0), 버그만 고치면 끝 숫자(0.2.0 → 0.2.1).
- 스토어에 처음 정식 제출할 때 1.0.0 으로 올려도 된다.

## 절차
1. 최신 `main` 에서 새 브랜치를 만들고 버전을 올린다.
   ```
   node tools/bump-version.mjs 0.3.0
   ```
   `extension/manifest.json`, `server/package.json`, `server/package-lock.json` 이 같이 바뀐다.
2. `CHANGELOG.md` 맨 위에 `## [0.3.0] - 날짜` 항목을 쓴다(추가/수정/배포할 때 주의). 이 항목이 GitHub Release 본문이 된다.
3. 점검한다. 태그와 버전 파일, CHANGELOG 항목이 맞는지 확인해 준다.
   ```
   node tools/check-release.mjs v0.3.0
   (cd server && npm test)
   ```
4. PR 로 `main` 에 머지한다.
5. **머지된 `main`** 에서 태그를 만들어 푸시한다.
   ```
   git checkout main && git pull
   git tag v0.3.0
   git push origin v0.3.0
   ```
6. `.github/workflows/release.yml` 이 돌아서 점검 → 서버 테스트 → 스토어 zip 빌드 → GitHub Release 생성(zip 첨부)까지 한다. Actions 탭에서 확인한다.
7. 배포한다(`docs/deploy-checklist.md`). 서버(Render)와 확장(스토어에 zip 업로드)을 **같이** 배포한다.

## 처음 한 번만
- 저장소 변수 `STORE_SERVER_URL` 을 만든다: Settings → Secrets and variables → Actions → Variables 에 `wss://내서버.onrender.com`(끝에 `/` 없이). 없으면 Release 는 만들어지지만 zip 이 붙지 않는다.
- Actions 가 Release 를 만들 수 있어야 한다: Settings → Actions → General → Workflow permissions 가 읽기 전용이어도 워크플로가 `contents: write` 를 직접 요청하므로 보통 그대로 된다. 막히면 "Read and write permissions" 로 바꾼다.

## 태그를 잘못 만들었을 때
Release 를 쓰기 전이라면 태그를 지우고 다시 만든다.
```
git push origin :refs/tags/v0.3.0
git tag -d v0.3.0
```
이미 Release 가 만들어졌으면 GitHub 에서 그 Release 를 지운 뒤 위처럼 한다.
