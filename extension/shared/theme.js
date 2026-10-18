// 디자인 토큰(다크). 색은 "역할" 이름이다(예: --surface = 카드/말풍선 바탕).
//  - 팝업(:root): 지금의 다크 테마
//  - 페이지 안 UI(채팅, 토스트 등 shadow DOM :host): 영상에서 시선을 뺏지 않도록 같은 다크를 더 차분하게(채도·대비·장식을 줄임)

const POPUP = {
  // 차콜 바탕 + 하늘색 포인트(채팅의 무채색과 같이 켜 둬도 튀지 않게)
  bg: '#15171a', surface: '#1e2124', 'surface-2': '#272b30', 'surface-3': '#32373d',
  border: '#2a2e33', 'border-2': '#363b42', 'border-3': '#474e57',
  accent: '#4f9dff', 'accent-light': '#78b4ff', 'accent-dark': '#2a6fcc', 'accent-ink': '#8ec1ff', 'on-accent': '#ffffff',
  ink: '#e6e9ed', 'ink-soft': '#9199a3', placeholder: '#6e7782',
  'head-1': '#2d3844', 'head-2': '#1f252b', 'head-ink': '#eaf2ff', 'head-shadow': 'none', 'head-chip': 'rgba(255,255,255,.12)',
  'warn-bg': '#363018', 'warn-ink': '#ffd97a', 'warn-border': '#6b5a1f', yellow: '#ffd36a',
  pink: '#ff7d9d', danger: '#ff6b81',
  shadow: '0 6px 18px rgba(0,0,0,.4)', 'shadow-lg': '0 10px 30px rgba(0,0,0,.55)', 'btn-shadow': 'rgba(79,157,255,.2)',
};

// 채팅/영상 위 안내: 장식 없이 차분하게. 테두리는 배경에 가깝게, 강조색은 채도를 낮춰서 쓴다.
const CALM = {
  // 채팅/영상 위 안내는 무채색(회색조). 포인트 색은 닉네임(사용자가 고른 색)만.
  bg: '#17181a', surface: '#1f2022', 'surface-2': '#292a2d', 'surface-3': '#333437',
  border: '#27282a', 'border-2': '#303134', 'border-3': '#424347',
  accent: '#5a5a5a', 'accent-light': '#6e6e6e', 'accent-dark': '#444444', 'accent-ink': '#c4c4c4', 'on-accent': '#f2f2f2',
  ink: '#e4e5e7', 'ink-soft': '#919296', placeholder: '#6c6d71',
  'head-1': '#1f2022', 'head-2': '#1f2022', 'head-ink': '#e4e5e7', 'head-shadow': 'none', 'head-chip': 'rgba(255,255,255,.08)',
  'warn-bg': '#2a2b2d', 'warn-ink': '#d2d3d5', 'warn-border': '#444548', yellow: '#d2d3d5',
  pink: '#b85c68', danger: '#d46a76',
  shadow: '0 4px 14px rgba(0,0,0,.35)', 'shadow-lg': '0 10px 28px rgba(0,0,0,.5)', 'btn-shadow': 'rgba(0,0,0,.25)',
  'bubble-me': '#3a3b3e', // 내 말풍선
};

const decls = (t) => Object.entries(t).map(([k, v]) => `--${k}:${v};`).join('');

// 글꼴: 팝업은 @font-face 로 직접 불러온 SUIT, 페이지 안 UI 는 FontFace API 로 넣은 'BMT SUIT'(shared/font.js)
const FONT_FALLBACK = "system-ui, -apple-system, 'Malgun Gothic', sans-serif";

export const ROOT_THEME_CSS = `:root{${decls(POPUP)}--font:'SUIT',${FONT_FALLBACK};}`;
export const SHADOW_THEME_CSS = `:host{${decls(CALM)}--font:'BMT SUIT',${FONT_FALLBACK};}`;

// ---------- 닉네임 색 ----------
// 어떤 색을 골랐더라도(예전에 저장된 진한 색 포함) 어두운 배경에서 잘 보이는 파스텔톤으로 보정해서 보여준다.
export function pastelize(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return '#c9d6e6';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  if (s < 0.1) l = Math.max(l, 0.8); // 흰색/회색: 밝게만(흰색은 흰색 그대로)
  else l = Math.min(0.88, Math.max(l, 0.76));
  s = Math.min(s, 0.85);
  const f = (p, q, t) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const to = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(f(p, q, h + 1 / 3))}${to(f(p, q, h))}${to(f(p, q, h - 1 / 3))}`;
}
