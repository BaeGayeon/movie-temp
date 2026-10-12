// 디자인 토큰(다크). 색은 "역할" 이름이다(예: --surface = 카드/말풍선 바탕).
//  - 팝업(:root): 지금의 다크 테마
//  - 페이지 안 UI(채팅, 토스트 등 shadow DOM :host): 영상에서 시선을 뺏지 않도록 같은 다크를 더 차분하게(채도·대비·장식을 줄임)

const POPUP = {
  bg: '#12161c', surface: '#1c222b', 'surface-2': '#252d39', 'surface-3': '#303a49',
  border: '#2a3340', 'border-2': '#354052', 'border-3': '#46546a',
  accent: '#4f9dff', 'accent-light': '#78b4ff', 'accent-dark': '#2a6fcc', 'accent-ink': '#8ec1ff', 'on-accent': '#ffffff',
  ink: '#e7ecf3', 'ink-soft': '#93a0b3', placeholder: '#6c7a8e',
  'head-1': '#2b3b54', 'head-2': '#1d2838', 'head-ink': '#eaf2ff', 'head-shadow': 'none', 'head-chip': 'rgba(255,255,255,.12)',
  'warn-bg': '#3a3115', 'warn-ink': '#ffd97a', 'warn-border': '#6b5a1f', yellow: '#ffd36a',
  pink: '#ff7d9d', danger: '#ff6b81',
  shadow: '0 6px 18px rgba(0,0,0,.4)', 'shadow-lg': '0 10px 30px rgba(0,0,0,.55)', 'btn-shadow': 'rgba(79,157,255,.25)',
};

// 채팅/영상 위 안내: 장식 없이 차분하게. 테두리는 배경에 가깝게, 강조색은 채도를 낮춰서 쓴다.
const CALM = {
  bg: '#15191f', surface: '#1b2027', 'surface-2': '#232932', 'surface-3': '#2c333e',
  border: '#222831', 'border-2': '#2a313c', 'border-3': '#38414f',
  accent: '#4b78b0', 'accent-light': '#5a86be', 'accent-dark': '#355a8a', 'accent-ink': '#9db8d9', 'on-accent': '#f2f6fb',
  ink: '#dfe5ec', 'ink-soft': '#8c98a8', placeholder: '#667386',
  'head-1': '#1b2027', 'head-2': '#1b2027', 'head-ink': '#dfe5ec', 'head-shadow': 'none', 'head-chip': 'rgba(255,255,255,.08)',
  'warn-bg': '#2e2a1c', 'warn-ink': '#e6cf8a', 'warn-border': '#4d4526', yellow: '#e6cf8a',
  pink: '#d9778f', danger: '#e0707f',
  shadow: '0 4px 14px rgba(0,0,0,.35)', 'shadow-lg': '0 10px 28px rgba(0,0,0,.5)', 'btn-shadow': 'rgba(0,0,0,.25)',
  'bubble-me': '#2a4363', // 내 말풍선(튀지 않는 짙은 청회색)
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
  s = Math.min(s, 0.85);
  l = Math.min(0.88, Math.max(l, 0.76));
  const f = (p, q, t) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const to = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(f(p, q, h + 1 / 3))}${to(f(p, q, h))}${to(f(p, q, h - 1 / 3))}`;
}
