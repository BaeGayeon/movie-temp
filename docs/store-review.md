# 스토어 제출 준비물

`docs/store-listing.md` 의 문구 말고, 제출 화면에서 따로 필요한 것들을 모았다.

## 1. 심사 담당자용 안내 (대시보드의 테스트 안내/Test instructions 칸에 붙여 넣기)

심사 담당자는 영어로 읽는 경우가 많아 영어로 쓴다. 시연 영상 링크(아래 2번)를 올린 뒤 `<VIDEO URL>` 을 바꾼다.

```
movoni syncs the playback state (play, pause, seek, speed) of a video that each person plays on their own account, and lets the people in the same room chat. It does not touch the video stream or any account/login information.

Why it is hard to test directly:
The extension only works on the video pages of Coupang Play, Netflix and Wavve, and each of them needs a paid subscription. We cannot share accounts, so we recorded a short demo that shows the whole flow with two browser windows: <VIDEO URL>

How it works (what the demo shows):
1. Open a video page on a supported site and click the extension icon → "Create room".
2. Copy the invite link and open it in a second browser profile on the same title → "Join".
3. Play, pause or seek in one window and the other follows. Chat and emoji reactions appear over the video.

Data: only the room code, nickname/profile you typed, chat messages and the playback state go through our relay server (wss://bae-movie-temp.onrender.com). Rooms live in server memory only and are deleted when the room ends. Privacy policy: https://bae-movie-temp.onrender.com/privacy
Remote code: none. All code is inside the package.
```

## 2. 시연 영상 대본 (1~2분, 화면 두 개를 나란히)

준비: 크롬 프로필 두 개(또는 창 두 개), 각각 서비스에 로그인. 영상은 본편 화면이 크게 나오지 않게 작은 창이나 예고편이 좋다.

1. (0:00) 왼쪽 창에서 영상 페이지를 열고 확장 아이콘 → 방 만들기. 닉네임/프사 보여 주기.
2. (0:15) 초대 링크 복사 → 오른쪽 창에서 같은 작품 페이지로 링크를 열어 참가.
3. (0:30) 왼쪽에서 일시정지/재생/시크 → 오른쪽이 따라가는 것 보여 주기.
4. (0:50) 채팅 한 줄과 이모지 리액션 보내기. 영상 위에 뜨는 모습.
5. (1:10) 팝업의 방 설정(방장만 조작 / 모두 조작)과 비밀번호 방 설명 한 줄.
6. (1:30) 끝. 사용자 이름·이메일·결제 정보가 화면에 나오지 않는지 확인하고 올린다.

영상은 유튜브 "일부 공개(링크 있는 사람만)"로 올리면 된다.

## 3. 스크린샷 (1280×800, 최대 5장)

| # | 내용 | 메모 |
|---|---|---|
| 1 | 영상 위 말풍선 채팅 + 팝업 | 대표 이미지 |
| 2 | 줄글/간단 모드 비교 | 채팅 모드 3가지 |
| 3 | 오른쪽에 띄우기/붙이기 | 배치 |
| 4 | 이모지 리액션과 입퇴장 알림 | |
| 5 | 팝업(방/내 설정, 프로필 꾸미기) | |

- 저작권이 있는 영상 장면이 크게 나오지 않게 한다(작은 창, 로딩 화면, 검은 화면).
- 닉네임은 `Guest1234` 같은 가짜 이름으로 하고, 개인 정보(이메일, 프로필 사진)는 가린다.
- 앱 이름이 `movoni (모보니)` 로 보이는 스토어용 빌드(`node tools/build-store.mjs`) 또는 이름 뒤 `[개발용]` 표시를 가린 화면으로 찍는다.

## 4. 프로모션 이미지

- 작은 타일(440×280, 필수): `docs/store-assets/promo-tile-440x280.png`. 이 환경에는 한글 글꼴이 없어 영어 문구로 만들었다. 한글 문구를 쓰고 싶으면 디자인 도구에서 다시 만든다.
- 큰 타일(920×680)과 마키(1400×560)는 선택 사항이다.

## 5. 제출 직전 체크

- [ ] `https://bae-movie-temp.onrender.com/privacy` 에 새 문의 이메일이 보인다(한국어/영어)
- [ ] `node tools/build-store.mjs --server wss://bae-movie-temp.onrender.com` 으로 만든 zip(Release 의 `movoni-<버전>.zip`)을 올린다
- [ ] 이름 `movoni (모보니)`, 한국어/영어 요약·설명, 단일 목적, 권한 사유는 `docs/store-listing.md`
- [ ] 개인정보 공개 항목과 비판매자 표시
- [ ] 첫 제출은 비공개(링크로만) 또는 신뢰할 수 있는 테스터로 올려 확장 ID 를 확인한다
- [ ] 확장 ID(32자)를 Render 의 `EXTENSION_ID` 에 넣고, 스토어 설치본으로 두 기기에서 동기화를 확인한다
