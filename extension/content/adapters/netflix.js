// 넷플릭스 어댑터. 재생/정지/이동은 페이지 안의 다리(content/netflix-main.js)를 거쳐 넷플릭스 플레이어 API 로 한다.
// (<video>.currentTime 을 직접 바꾸면 넷플릭스가 오류 M7375 를 낸다.) 다리가 응답하지 않으면 <video> 를 직접 조작한다(정지/재생만).
import { createDefaultAdapter } from './default.js';

const REPLY_MS = 400;

export function createNetflixAdapter() {
  const base = createDefaultAdapter();
  let seq = 0;
  // 넷플릭스 API 는 비동기라서 play()/pause() 직후에도 video.paused 가 바로 바뀌지 않는다.
  // 시크할 때 사이트가 pause -> seek -> play 를 연달아 보내므로, 방금 내린 명령을 "의도한 상태"로 잠깐 기억해 둔다.
  let intent = null; // { paused, until }
  const remember = (paused) => (intent = { paused, until: Date.now() + 1500 });

  // 다리에 요청하고 성공 여부(true/false)를 받는다. 응답이 없으면 false.
  function ask(op, ms) {
    return new Promise((resolve) => {
      const id = ++seq;
      const done = (ok) => {
        window.removeEventListener('message', on);
        clearTimeout(timer);
        resolve(ok);
      };
      const on = (e) => {
        if (e.source === window && e.data?.__bmt === 'nf-r' && e.data.id === id) done(!!e.data.ok);
      };
      const timer = setTimeout(() => done(false), REPLY_MS);
      window.addEventListener('message', on);
      window.postMessage({ __bmt: 'nf', id, op, ms }, '*');
    });
  }

  return {
    ...base,
    name: 'netflix',

    // 이동/재생 명령이 반영될 때까지 걸리는 시간(ms) 뒤에 방 상태(재생/정지)를 다시 확인한다
    settleMs: 900,

    isPaused(video) {
      return intent && Date.now() < intent.until ? intent.paused : video.paused;
    },

    async play(video) {
      remember(false);
      if (!(await ask('play'))) await video.play();
    },

    pause(video) {
      remember(true);
      ask('pause').then((ok) => ok || video.pause());
    },

    // 이동은 반드시 넷플릭스 API 로. 다리가 없으면 아무것도 하지 않는다(직접 currentTime 을 바꾸면 오류 화면이 뜬다).
    seek(_video, t) {
      ask('seek', t * 1000);
    },
  };
}
