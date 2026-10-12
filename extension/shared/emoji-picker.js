// 이모지 선택기: 그룹 탭 + 최근 사용. content(shadow DOM)와 popup 에서 같이 쓴다.
import { EMOJI_GROUPS } from './emoji-data.js';

const RECENT_KEY = 'recentEmojis';
const MAX_RECENT = 24;

export const EMOJI_PICKER_CSS = `
  .ep { width: 288px; height: 270px; display: flex; flex-direction: column; background: #1f2430; color: #fff;
    border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.55); overflow: hidden; font-family: system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif; }
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
  const root = document.createElement('div');
  root.className = 'ep';
  const tabs = document.createElement('div');
  tabs.className = 'ep-tabs';
  const title = document.createElement('div');
  title.className = 'ep-title';
  const grid = document.createElement('div');
  grid.className = 'ep-grid';
  root.append(tabs, title, grid);

  const groups = [{ icon: '🕘', name: '최근 사용', recent: true }, ...EMOJI_GROUPS];
  let current = 1; // 기본은 첫 그룹(표정). 최근 사용이 있으면 열 때 최근 탭으로
  const buttons = groups.map((g, i) => {
    const b = document.createElement('button');
    b.textContent = g.icon;
    b.title = g.name;
    b.addEventListener('click', () => show(i));
    tabs.append(b);
    return b;
  });

  async function show(i) {
    current = i;
    buttons.forEach((b, k) => b.classList.toggle('on', k === i));
    const g = groups[i];
    title.textContent = g.name;
    const list = g.recent ? await loadRecent() : g.emojis;
    grid.replaceChildren();
    grid.scrollTop = 0;
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'ep-empty';
      empty.textContent = '아직 사용한 이모지가 없어요';
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

  // 열 때마다 호출: 최근 사용이 있으면 그 탭부터 보여준다
  async function reset() {
    show((await loadRecent()).length ? 0 : 1);
  }
  reset();
  return { el: root, reset };
}
