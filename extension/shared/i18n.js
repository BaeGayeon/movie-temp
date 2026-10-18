// 다국어(ko/en). 설정 chrome.storage.local.lang: 'auto'(브라우저 언어를 따름, 기본) | 'ko' | 'en'.
// 문구는 msg-*.js 에 { ko: {...}, en: {...} } 로 두고 키로 꺼낸다. 영어 문구가 없으면 한국어로 대체한다.
import { MSG as common } from './msg-common.js';
import { MSG as popup } from './msg-popup.js';
import { MSG as content } from './msg-content.js';
import { MSG as background } from './msg-background.js';

export const LANG_KEY = 'lang';
export const LANGS = ['ko', 'en'];
const DICT = { ko: {}, en: {} };
for (const m of [common, popup, content, background]) for (const l of LANGS) Object.assign(DICT[l], m[l]);

let pref = 'auto';
let lang = detectLang(); // 설정을 읽기 전(서비스 워커가 막 뜬 직후 등)에는 브라우저 언어
const listeners = new Set();

// 브라우저 표시 언어가 한국어면 ko, 아니면 en
export function detectLang() {
  const ui = (globalThis.chrome?.i18n?.getUILanguage?.() || globalThis.navigator?.language || 'en').toLowerCase();
  return ui.startsWith('ko') ? 'ko' : 'en';
}

function resolve(p) {
  pref = LANGS.includes(p) ? p : 'auto';
  const next = pref === 'auto' ? detectLang() : pref;
  const changed = next !== lang;
  lang = next;
  return changed;
}

// 저장된 설정을 읽고, 이후 다른 곳(팝업)에서 바꾸면 따라간다. 모든 진입점(팝업/content/background)에서 한 번 부른다.
export async function initI18n() {
  resolve((await chrome.storage.local.get(LANG_KEY))[LANG_KEY]);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[LANG_KEY] && resolve(changes[LANG_KEY].newValue)) for (const fn of listeners) fn(lang);
  });
  return lang;
}

export const getLang = () => lang; // 지금 쓰는 언어: 'ko' | 'en'
export const getLangPref = () => pref; // 설정값: 'auto' | 'ko' | 'en'
export const setLangPref = (p) => chrome.storage.local.set({ [LANG_KEY]: p });
export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// t('popup.joined', { name }) -> 문구의 {name} 을 채운다
export function t(key, params) {
  const s = DICT[lang][key] ?? DICT.ko[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? params[k] : m)) : s;
}

// 서버 오류 메시지({ code, reason?, message, max? })를 현재 언어로. 번역이 없는 코드는 서버가 보낸 message 를 쓴다.
export function serverErrorText(m) {
  for (const key of [m.reason && `err.${m.code}.${m.reason}`, `err.${m.code}`]) {
    if (key && key in DICT.ko) return t(key, m);
  }
  return m.message;
}

// HTML 의 data-i18n(글자), data-i18n-placeholder, data-i18n-title, data-i18n-aria-label 을 채운다
export function applyI18n(root = document) {
  document.documentElement.lang = lang;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const attr of ['placeholder', 'title', 'aria-label']) {
    for (const el of root.querySelectorAll(`[data-i18n-${attr}]`)) el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`)));
  }
}

// 테스트용: 두 언어의 키 목록
export const _dict = DICT;
