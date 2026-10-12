// 이모지 선택기: 검색 + 그룹 탭 + 최근 사용. content(shadow DOM)와 popup 에서 같이 쓴다.
// 검색은 한국어/영어 이름과 태그(예: 웃음, 하트, ㅋㅋ, cry)로 한다. 키워드 데이터(약 170KB)는 처음 검색할 때만 불러온다.
import { EMOJI_GROUPS } from './emoji-data.js';

const RECENT_KEY = 'recentEmojis';
const MAX_RECENT = 24;

export const EMOJI_PICKER_CSS = `
  .ep { width: 288px; height: 300px; display: flex; flex-direction: column; background: #1f2430; color: #fff;
    border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.55); overflow: hidden; font-family: system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif; }
  .ep-search { margin: 6px 6px 4px; font: inherit; font-size: 13px; color: #fff; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.18);
    border-radius: 8px; padding: 5px 8px; outline: none; }
  .ep-search:focus { border-color: #4f7cff; }
  .ep-search::placeholder { color: #8a90a0; }
  .ep-tabs { display: flex; background: rgba(255,255,255,.07); }
  .ep-tabs button { flex: 1; background: transparent; border: 0; padding: 5px 0; font-size: 16px; cursor: pointer; opacity: .6; color: inherit; }
  .ep-tabs button.on { opacity: 1; background: rgba(255,255,255,.14); }
  .ep-title { font-size: 11px; color: #9aa; padding: 4px 8px 0; }
  .ep-grid { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(8, 1fr); align-content: start; padding: 4px 6px 6px; gap: 1px; }
  .ep-grid button { background: transparent; border: 0; border-radius: 6px; font-size: 20px; padding: 3px 0; cursor: pointer; color: inherit; line-height: 1.2; }
  .ep-grid button:hover { background: rgba(255,255,255,.18); }
  .ep-empty { grid-column: 1 / -1; color: #9aa; font-size: 12px; padding: 14px 4px; text-align: center; }
`;

async function loadRecent() {
  try {
    return (await chrome.storage.local.get(RECENT_KEY))[RECENT_KEY] ?? [];
  } catch {
    return [];
  }
}

async function pushRecent(emoji) {
  try {
    const list = [emoji, ...(await loadRecent()).filter((e) => e !== emoji)].slice(0, MAX_RECENT);
    await chrome.storage.local.set({ [RECENT_KEY]: list });
  } catch {}
}

// onPick(emoji) 가 선택할 때마다 호출된다.
export function createEmojiPicker({ onPick }) {
  const api = { el: null, reset: null, focusSearch: null, onEscape: null };
  const root = document.createElement('div');
  root.className = 'ep';
  const search = document.createElement('input');
  search.className = 'ep-search';
  search.placeholder = '이모지 검색 (예: 웃음, 하트, ㅋㅋ, cry)';
  search.autocomplete = 'off';
  search.spellcheck = false;
  // 사이트의 단축키(스페이스=재생 등)가 검색 입력 중에 동작하지 않도록 키 이벤트를 여기서 끊는다
  for (const t of ['keydown', 'keyup', 'keypress']) search.addEventListener(t, (e) => e.stopPropagation());
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') api.onEscape?.();
  });
  const tabs = document.createElement('div');
  tabs.className = 'ep-tabs';
  const title = document.createElement('div');
  title.className = 'ep-title';
  const grid = document.createElement('div');
  grid.className = 'ep-grid';
  root.append(search, tabs, title, grid);

  const groups = [{ icon: '🕘', name: '최근 사용', recent: true }, ...EMOJI_GROUPS];
  let current = 1; // 기본은 첫 그룹(표정). 최근 사용이 있으면 열 때 최근 탭으로
  const buttons = groups.map((g, i) => {
    const b = document.createElement('button');
    b.textContent = g.icon;
    b.title = g.name;
    b.addEventListener('click', () => {
      search.value = ''; // 탭을 누르면 검색을 해제하고 해당 그룹을 보여준다
      show(i);
    });
    tabs.append(b);
    return b;
  });

  // ---- 검색 ----
  const allEmojis = EMOJI_GROUPS.flatMap((g) => g.emojis);
  let keywords = null;
  let searchSeq = 0;

  function renderList(list, heading) {
    title.textContent = heading;
    grid.replaceChildren();
    grid.scrollTop = 0;
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'ep-empty';
      empty.textContent = heading.startsWith('검색') ? '검색 결과가 없어요' : '아직 사용한 이모지가 없어요';
      grid.append(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const emoji of list) {
      const b = document.createElement('button');
      b.textContent = emoji;
      b.addEventListener('click', () => {
        pushRecent(emoji);
        onPick(emoji);
      });
      frag.append(b);
    }
    grid.append(frag);
  }

  async function runSearch() {
    const q = search.value.trim().toLowerCase();
    if (!q) return show(current);
    const seq = ++searchSeq;
    keywords ??= (await import('./emoji-keywords.js')).EMOJI_KEYWORDS;
    if (seq !== searchSeq) return; // 더 최근 입력이 있음
    const terms = q.split(/\s+/);
    // 모든 검색어가 포함된 이모지만. 단어가 검색어로 "시작"하면 위로(예: '웃' -> '웃는 얼굴' 이 '비웃는' 보다 먼저)
    const scored = [];
    for (const emoji of allEmojis) {
      const words = keywords[emoji];
      if (!words) continue;
      let score = 0;
      const tokens = words.split(' ');
      for (const t of terms) {
        if (!words.includes(t)) {
          score = -1;
          break;
        }
        score += tokens.some((w) => w === t) ? 3 : tokens.some((w) => w.startsWith(t)) ? 2 : 1;
      }
      if (score >= 0) scored.push([score, emoji]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    buttons.forEach((b) => b.classList.remove('on'));
    renderList(scored.slice(0, 240).map((x) => x[1]), `검색 결과 ${scored.length}개`);
  }
  search.addEventListener('input', runSearch);

  async function show(i) {
    current = i;
    buttons.forEach((b, k) => b.classList.toggle('on', k === i));
    const g = groups[i];
    renderList(g.recent ? await loadRecent() : g.emojis, g.name);
  }

  // 열 때마다 호출: 최근 사용이 있으면 그 탭부터 보여준다
  async function reset() {
    search.value = '';
    show((await loadRecent()).length ? 0 : 1);
  }
  reset();
  // focusSearch: 열자마자 바로 검색어를 입력할 수 있게. onEscape: 검색창에서 Esc 를 누르면 호출
  Object.assign(api, { el: root, reset, focusSearch: () => search.focus() });
  return api;
}
