# 크롬 웹스토어 등록 문구

스토어 대시보드에 붙여 넣는 문구 모음. 앱 이름은 `extension/config.js` 와 `manifest.json` 의 `name` 으로만 관리한다.

## 기본 정보

- 이름: bae-movie-temp (배무템)
- 카테고리: 소셜 및 커뮤니케이션 (또는 엔터테인먼트)
- 언어: 한국어(기본) + 영어 (아래 "English listing" 섹션을 스토어 대시보드의 영어 항목에 붙여 넣는다. 확장 프로그램의 설명은 `_locales/` 로 브라우저 언어에 따라 나뉜다)
- 개인정보처리방침 URL: `https://<서버주소>/privacy` (서버가 제공한다. 문의 이메일은 `server/public/privacy.html` 맨 아래)

## 요약 (132자 이내)

각자 계정으로 같이 보기. 재생·정지·이동만 맞춰 주는 영상 동기화와 채팅, 이모지 리액션.

## 상세 설명

```
각자 계정으로 영상을 틀어 두고, 재생 상태만 맞춰서 같이 보는 확장 프로그램이에요.
영상 자체나 계정 정보는 주고받지 않아요. 같은 작품을 각자 재생하기만 하면 돼요.

주요 기능
• 방 만들기 → 초대 링크 공유 → 같은 위치에서 같이 재생
• 재생·일시정지·이동을 모두에게 맞춰 줘요 (방장만 조작하기 / 모두 조작하기 선택)
• 재생 속도(배속)도 모두에게 맞춰 줘요 (0.5~3배, 채팅 창에서 바로 조절)
• 누군가 버퍼링하거나 광고를 보면 다 같이 기다렸다가 함께 이어서 재생해요
• 영상 위에 뜨는 채팅 (말풍선 / 줄글 / 간단 모드, 떠 있는 창 / 오른쪽에 띄우기 / 오른쪽에 붙이기)
• 이모지 리액션, 입퇴장·재생 알림, 카운트다운으로 같이 시작
• 닉네임, 이모지 또는 사진 프로필, 글자 색 설정

지원 사이트
쿠팡플레이, 넷플릭스, 웨이브, 티빙의 영상 페이지

사용 방법
1. 영상 페이지를 열고 확장 아이콘 → 방 만들기
2. 초대 링크를 같이 볼 사람에게 보내기
3. 상대도 같은 작품 페이지에서 링크로 참가하면 끝

각자 해당 서비스의 이용권이 있어야 하고, 이 확장 프로그램은 각 서비스와 관련이 없는 비공식 도구예요.
```

## 단일 목적 (Single purpose)

각자 재생하는 영상(OTT)의 재생 상태를 같은 방 사람들과 동기화하고, 같이 보는 사람들과 채팅할 수 있게 한다.

## 권한 사유

| 권한 | 사유 |
|---|---|
| `storage` | 내 프로필(닉네임, 이모지/사진, 색), 채팅창과 팝업 설정, 방 다시 들어올 때의 최근 채팅을 기기에만 저장한다. |
| `alarms` | 서비스 워커가 잠들어도 방 연결을 유지하고 다시 접속하기 위한 주기적인 확인에 쓴다. |
| `activeTab` | 팝업을 연 탭에서 영상이 있는지 확인하고, 그 탭을 방에 연결한다. |
| 사이트 접근 (`coupangplay.com`, `netflix.com`, `wavve.com`, `tving.com`) | 해당 사이트의 `<video>` 재생 상태를 읽고 재생·정지·이동을 적용하며, 영상 위에 채팅 창을 표시한다. |
| 원격 코드 | 사용하지 않는다. 모든 코드는 확장 프로그램 안에 포함되어 있다. |

## 데이터 사용 공개 (Privacy practices)

- 수집하는 데이터: 사용자가 직접 입력한 닉네임/프로필 사진/채팅 메시지, 방 코드, 방 비밀번호(방장이 정한 경우. 서버는 해시로만 메모리에 보관), 영상 재생 상태와 위치. 모두 같은 방 사람들에게 전달하는 용도로만 서버를 거치며, 서버는 디스크에 저장하지 않는다(메모리에서 방이 사라질 때까지만).
- 수집하지 않는 데이터: 로그인 정보, 결제 정보, 시청 기록, 영상 내용, 위치 정보, 웹 기록.
- 데이터를 판매하지 않는다. 승인된 용도 외 사용이나 신용 평가 목적 사용을 하지 않는다.

## 이미지

- 아이콘 128×128: `extension/icons/icon128.png` (등록해 둔 아이콘)
- 스크린샷 1280×800 (또는 640×400) 1~5장: 채팅 3가지 모드, 영상 위 채팅(오른쪽에 띄우기), 팝업, 리액션 — 실제 사이트 화면으로 직접 찍어서 준비한다(저작권이 있는 영상 장면이 크게 나오지 않게 주의).

---

# English listing

Copy for the English entry in the store dashboard.

## Basic info

- Name: bae-movie-temp (배무템)
- Category: Social & Communication (or Entertainment)
- Language: English
- Privacy policy URL: `https://<server address>/privacy?lang=en` (served by the server; the page also follows the browser language when `lang` is omitted)

## Summary (132 characters or fewer)

Watch together, each on your own account. Syncs play, pause and seek, plus chat and emoji reactions.

## Detailed description

```
An extension that lets everyone play a video with their own account and keeps only the playback state in sync.
It never exchanges the video itself or any account information. Everyone just plays the same title.

Features
• Create a room → share the invite link → play together from the same position
• Play, pause and seek stay in sync for everyone (choose "host only" or "everyone" can control)
• Playback speed stays in sync too (0.5x to 3x, adjustable right from the chat window)
• If someone is buffering or watching an ad, everyone waits and resumes together
• Chat over the video (bubbles / plain lines / compact, floating window / float on the right / dock on the right)
• Emoji reactions, join/leave and playback notices, and a countdown to start together
• Nickname, emoji or photo profile, and text color
• Korean and English, following your browser language (or pick one in the popup)

Supported sites
Video pages on Coupang Play, Netflix, Wavve and TVING

How to use
1. Open a video page and click the extension icon → Create room
2. Send the invite link to the people you'll watch with
3. They open the same title and join with the link. That's it

Everyone needs their own subscription to the service, and this extension is an unofficial tool that is not affiliated with any of these services.
```

## Single purpose

Sync the playback state of videos (streaming services) that each person plays on their own, and let the people watching together chat.

## Permission justifications

| Permission | Reason |
|---|---|
| `storage` | Stores your profile (nickname, emoji/photo, color), chat window and popup settings, your language setting, and recent chat for when you rejoin a room, only on your device. |
| `alarms` | Periodic checks used to keep the room connection alive and reconnect even when the service worker sleeps. |
| `activeTab` | Checks whether the tab where you opened the popup has a video, and ties that tab to the room. |
| Site access (`coupangplay.com`, `netflix.com`, `wavve.com`, `tving.com`) | Reads the `<video>` playback state on those sites, applies play, pause and seek, and shows the chat window over the video. |
| Remote code | Not used. All code is included in the extension. |

## Privacy practices

- Data collected: the nickname, profile photo and chat messages you enter yourself, room code, room password (if the host set one; the server keeps it only as a hash in memory), and video playback state and position. All of it passes through the server only to be delivered to the others in the same room, and the server does not write it to disk (it stays in memory only until the room disappears).
- Data not collected: login information, payment information, viewing history, video content, location, web history.
- We do not sell data. We do not use it for anything other than the approved purpose, nor for creditworthiness or lending.

## Images

- Icon 128×128: `extension/icons/icon128.png`
- Screenshots 1280×800 (or 640×400), 1–5: prepare English-language screenshots of the same screens (chat modes, chat over video, popup, reactions) from the real sites, avoiding large frames of copyrighted video. Use the English UI (set the language to English in the popup).
