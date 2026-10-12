// 테마(하늘색 / 밝게 / 어둡게)와 디자인 토큰. 팝업(:root)과 페이지 안 UI(shadow DOM :host)가 같은 토큰을 쓴다.
// 토큰은 "역할" 이름이다(예: --surface = 카드/말풍선 바탕). 테마마다 값만 바뀐다.

export const THEME_NAMES = ['sky', 'light', 'dark'];
export const THEME_LABELS = { sky: '하늘색', light: '밝게', dark: '어둡게' };
export const THEME_DOTS = { sky: '#74c6ff', light: '#ffffff', dark: '#1c222b' }; // 선택 버튼의 미리보기 색

const THEMES = {
  sky: {
    bg: '#f4fbff', surface: '#ffffff', 'surface-2': '#e6f5ff', 'surface-3': '#cdeaff',
    border: '#e6f5ff', 'border-2': '#cdeaff', 'border-3': '#a6dbff',
    accent: '#3fa9f5', 'accent-light': '#74c6ff', 'accent-dark': '#2389dc', 'accent-ink': '#2389dc', 'on-accent': '#ffffff',
    ink: '#27415c', 'ink-soft': '#6b86a0', placeholder: '#9bb3c8',
    'head-1': '#a6dbff', 'head-2': '#3fa9f5', 'head-ink': '#ffffff', 'head-shadow': '0 1px 2px rgba(35,137,220,.4)', 'head-chip': 'rgba(255,255,255,.3)',
    'warn-bg': '#fff8dc', 'warn-ink': '#8a6200', 'warn-border': '#ffe08a', yellow: '#ffe08a',
    pink: '#ff8fab', danger: '#ff6b81',
    shadow: '0 6px 18px rgba(63,169,245,.22)', 'shadow-lg': '0 10px 30px rgba(35,137,220,.30)', 'btn-shadow': 'rgba(63,169,245,.3)',
  },
  light: {
    bg: '#f6f7fb', surface: '#ffffff', 'surface-2': '#eef0f6', 'surface-3': '#e1e4ed',
    border: '#e8eaf1', 'border-2': '#dcdfe8', 'border-3': '#c8ccd8',
    accent: '#4c8dff', 'accent-light': '#7aa9ff', 'accent-dark': '#2f6fe0', 'accent-ink': '#2f6fe0', 'on-accent': '#ffffff',
    ink: '#22262e', 'ink-soft': '#6a7280', placeholder: '#a3a9b6',
    'head-1': '#ffffff', 'head-2': '#eceff7', 'head-ink': '#22262e', 'head-shadow': 'none', 'head-chip': 'rgba(34,38,46,.08)',
    'warn-bg': '#fff6d6', 'warn-ink': '#7a5a00', 'warn-border': '#f3d97a', yellow: '#ffe08a',
    pink: '#ff7d9d', danger: '#e5484d',
    shadow: '0 6px 18px rgba(30,40,70,.12)', 'shadow-lg': '0 10px 30px rgba(30,40,70,.2)', 'btn-shadow': 'rgba(76,141,255,.3)',
  },
  dark: {
    bg: '#12161c', surface: '#1c222b', 'surface-2': '#252d39', 'surface-3': '#303a49',
    border: '#2a3340', 'border-2': '#354052', 'border-3': '#46546a',
    accent: '#4f9dff', 'accent-light': '#78b4ff', 'accent-dark': '#2a6fcc', 'accent-ink': '#8ec1ff', 'on-accent': '#ffffff',
    ink: '#e7ecf3', 'ink-soft': '#93a0b3', placeholder: '#6c7a8e',
    'head-1': '#2b3b54', 'head-2': '#1d2838', 'head-ink': '#eaf2ff', 'head-shadow': 'none', 'head-chip': 'rgba(255,255,255,.12)',
    'warn-bg': '#3a3115', 'warn-ink': '#ffd97a', 'warn-border': '#6b5a1f', yellow: '#ffd36a',
    pink: '#ff7d9d', danger: '#ff6b81',
    shadow: '0 6px 18px rgba(0,0,0,.4)', 'shadow-lg': '0 10px 30px rgba(0,0,0,.55)', 'btn-shadow': 'rgba(79,157,255,.25)',
  },
};

const decls = (name) => Object.entries(THEMES[name]).map(([k, v]) => `--${k}:${v};`).join('');

// 글꼴: 팝업은 @font-face 로 직접 불러온 SUIT, 페이지 안 UI 는 FontFace API 로 넣은 'BMT SUIT'(shared/font.js)
const FONT_FALLBACK = "system-ui, -apple-system, 'Malgun Gothic', sans-serif";

// 팝업용: <html data-theme="..."> 로 전환
export const ROOT_THEME_CSS =
  `:root{${decls('sky')}--font:'SUIT',${FONT_FALLBACK};}` + THEME_NAMES.filter((n) => n !== 'sky').map((n) => `:root[data-theme="${n}"]{${decls(n)}}`).join('');

// 페이지 안 UI(shadow DOM)용: 호스트 요소의 data-theme 로 전환
export const SHADOW_THEME_CSS =
  `:host{${decls('sky')}--font:'BMT SUIT',${FONT_FALLBACK};}` + THEME_NAMES.filter((n) => n !== 'sky').map((n) => `:host([data-theme="${n}"]){${decls(n)}}`).join('');

// ---------- 저장: chrome.storage.local 'themePrefs' = { ui: 팝업, chat: 채팅 + 화면 안내 } ----------
export const DEFAULT_THEME_PREFS = { ui: 'sky', chat: 'sky' };
const clean = (p) => ({
  ui: THEME_NAMES.includes(p?.ui) ? p.ui : DEFAULT_THEME_PREFS.ui,
  chat: THEME_NAMES.includes(p?.chat) ? p.chat : DEFAULT_THEME_PREFS.chat,
});

export async function loadThemePrefs() {
  try {
    return clean((await chrome.storage.local.get('themePrefs')).themePrefs);
  } catch {
    return { ...DEFAULT_THEME_PREFS };
  }
}

export async function saveThemePrefs(patch) {
  try {
    await chrome.storage.local.set({ themePrefs: clean({ ...(await loadThemePrefs()), ...patch }) });
  } catch {}
}

export function onThemePrefs(cb) {
  try {
    chrome.storage.onChanged.addListener((changes) => changes.themePrefs && cb(clean(changes.themePrefs.newValue)));
  } catch {}
}

// 사용자가 고른 색 위에 올릴 글자색(밝은 색이면 진한 글자, 어두운 색이면 흰 글자)
export function readableTextOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return '#27415c';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#27415c' : '#ffffff';
}
