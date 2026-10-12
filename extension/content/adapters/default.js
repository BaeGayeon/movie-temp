// 표준 <video> 어댑터. 사이트별로 동작이 다르면 같은 인터페이스의 전용 어댑터를 추가한다.
//   findVideo(): 동기화 대상 <video> 를 찾는다(없으면 null)
//   play(video): Promise 를 반환(자동재생 정책으로 거부될 수 있음)
//   pause(video), seek(video, t)

const MIN_WIDTH = 200;
const MIN_HEIGHT = 100;

export function createDefaultAdapter() {
  return {
    name: 'default',

    findVideo(root = document) {
      let best = null;
      let bestArea = 0;
      for (const v of root.querySelectorAll('video')) {
        const r = v.getBoundingClientRect();
        const area = r.width * r.height;
        if (r.width < MIN_WIDTH || r.height < MIN_HEIGHT) continue; // 광고/썸네일 등 작은 영상 제외
        if (area > bestArea) {
          best = v;
          bestArea = area;
        }
      }
      return best;
    },

    play(video) {
      return Promise.resolve(video.play());
    },

    pause(video) {
      video.pause();
    },

    seek(video, t) {
      video.currentTime = t;
    },
  };
}
