import { APP_NAME, APP_NAME_KO } from '../config.js';
import { CMD } from '../shared/cmd.js';
import { COLOR_PALETTE, MAX_NAME_LENGTH } from '../shared/protocol.js';
import { renderAvatar, fileToAvatarDataUrl } from '../shared/avatar.js';
import { createEmojiPicker, EMOJI_PICKER_CSS } from '../shared/emoji-picker.js';
import { ROOT_THEME_CSS, pastelize } from '../shared/theme.js';
import { createColorPicker, isHex } from '../shared/color-picker.js';

// 디자인 토큰(다크)과 이모지 선택기 스타일 주입
const themeStyle = document.createElement('style');
themeStyle.textContent = `${ROOT_THEME_CSS} ${EMOJI_PICKER_CSS}`;
document.head.append(themeStyle);

const $ = (id) => document.getElementById(id);
$('title').textContent = APP_NAME;
$('titleKo').textContent = `(${APP_NAME_KO})`;

// 접이식 카드: 펼침 상태를 기억한다
const folds = (await chrome.storage.local.get('popupFold')).popupFold ?? {};
for (const d of document.querySelectorAll('details[data-fold]')) {
  const k = d.dataset.fold;
  if (k in folds) d.open = folds[k];
  d.addEventListener('toggle', async () => {
    const cur = (await chrome.storage.local.get('popupFold')).popupFold ?? {};
    await chrome.storage.local.set({ popupFold: { ...cur, [k]: d.open } });
  });
}

let state = null;

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const CONN = {
  connected: ['🟢 연결됨', ''],
  connecting: ['🟡 연결 중…', 'warn'],
  disconnected: ['🔴 끊김 · 재연결 중', 'bad'],
};

function render() {
  const inRoom = !!state?.roomCode;
  $('lobby').hidden = inRoom;
  $('room').hidden = !inRoom;
  $('error').textContent = state?.error ?? '';
  if (!inRoom) return;

  // 방 코드: 글자마다 칩으로
  $('roomCode').replaceChildren(
    ...[...state.roomCode].map((ch) => {
      const c = document.createElement('span');
      c.textContent = ch;
      return c;
    }),
  );
  const [connText, connCls] = CONN[state.connection] ?? CONN.disconnected;
  $('conn').textContent = connText;
  $('conn').className = `status ${connCls}`;
  $('count').textContent = `${state.participants.length}명`;

  // 참가자: 프사 + 닉네임 + 방장/나 표시
  $('people').replaceChildren(
    ...state.participants.map((p) => {
      const li = document.createElement('li');
      const av = document.createElement('span');
      av.className = 'pav';
      renderAvatar(av, p.avatar, 26);
      const name = document.createElement('span');
      name.className = 'pname';
      name.textContent = p.name; // textContent
      li.append(av, name);
      if (p.id === state.hostId) li.append(badge('👑 방장', ''));
      if (p.id === state.userId) li.append(badge('나', 'me'));
      return li;
    }),
  );

  // 조작 권한 카드는 모두에게 같은 모양: 방장은 바꿀 수 있고, 나머지는 현재 값만 보인다(눌러도 바뀌지 않음)
  const isHost = state.hostId === state.userId;
  for (const b of $('modeSeg').querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.mode === state.mode);
    b.disabled = !isHost;
  }
  $('countdownRow').hidden = !isHost;
  const waiting = state.waitingIds.map((id) => state.participants.find((p) => p.id === id)?.name ?? '누군가');
  $('waitInfo').hidden = waiting.length === 0;
  $('waitInfo').textContent = `⏳ ${waiting.join(', ')} 님을 기다리는 중이에요`;
}

function badge(text, cls) {
  const b = document.createElement('span');
  b.className = `badge ${cls}`;
  b.textContent = text;
  return b;
}

$('create').addEventListener('click', async () => {
  const tab = await activeTab();
  chrome.runtime.sendMessage({ cmd: CMD.CREATE_ROOM, tabId: tab?.id });
});

$('join').addEventListener('click', async () => {
  const tab = await activeTab();
  chrome.runtime.sendMessage({ cmd: CMD.JOIN_ROOM, roomCode: $('code').value, tabId: tab?.id });
});

$('countdown').addEventListener('click', () =>
  chrome.runtime.sendMessage({ cmd: CMD.COUNTDOWN_START, seconds: Number($('seconds').value) }),
);
$('leave').addEventListener('click', () => chrome.runtime.sendMessage({ cmd: CMD.LEAVE_ROOM }));
$('modeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (b) chrome.runtime.sendMessage({ cmd: CMD.SET_MODE, mode: b.dataset.mode });
});

$('copyCode').addEventListener('click', async () => {
  await navigator.clipboard.writeText(state.roomCode);
  $('copyCode').textContent = '✅ 복사됨!';
  setTimeout(() => ($('copyCode').textContent = '📋 코드 복사'), 1500);
});

$('copy').addEventListener('click', async () => {
  const tab = await activeTab();
  try {
    const url = new URL(tab.url);
    url.searchParams.set('wp', state.roomCode);
    await navigator.clipboard.writeText(url.toString());
    $('copy').textContent = '✅ 복사됨!';
  } catch {
    $('error').textContent = '이 탭의 주소로는 초대 링크를 만들 수 없어요.';
    return;
  }
  setTimeout(() => ($('copy').textContent = '🔗 링크 복사'), 1500);
});

// ---------- 동기화 설정: 광고 구간 제외 ----------
chrome.storage.local.get('syncPrefs').then((r) => ($('adDetect').checked = r.syncPrefs?.adDetect !== false));
$('adDetect').addEventListener('change', async (e) => {
  const { syncPrefs } = await chrome.storage.local.get('syncPrefs');
  await chrome.storage.local.set({ syncPrefs: { ...syncPrefs, adDetect: e.target.checked } });
});

// ---------- 프로필 (이름, 이모지 프사 + 배경색, 채팅 색) ----------
const AVATARS = ['🙂', '😎', '🤓', '🥳', '😺', '🐶', '🐻', '🐼', '🦊', '🐸', '🐧', '🦄'];
let profile = { name: '', avatar: { kind: 'emoji', value: AVATARS[0], bg: COLOR_PALETTE[5] }, color: COLOR_PALETTE[3] };
let saveTimer = null;

// 기본 색 + 직접 고르기(무지개 버튼). 팔레트에 없는 색이면 직접 고른 색으로 보여준다
function swatches(container, pickerBox, colors, current, onPick) {
  const custom = isHex(current) && !colors.includes(current.toLowerCase());
  const list = colors.map((c) => {
    const b = document.createElement('button');
    b.className = `sw${c === current ? ' sel' : ''}`;
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => onPick(c));
    return b;
  });
  const more = document.createElement('button');
  more.className = `sw rainbow${custom ? ' sel' : ''}`;
  if (custom) more.style.background = current;
  more.title = '직접 고르기';
  more.addEventListener('click', () => {
    pickerBox.hidden = !pickerBox.hidden;
    if (!pickerBox.hidden) {
      if (!pickerBox.firstChild) pickerBox.picker = createColorPicker({ value: current, onChange: onPick }), pickerBox.append(pickerBox.picker.el);
      else pickerBox.picker.set(current);
    }
  });
  container.replaceChildren(...list, more);
}

function renderProfile() {
  renderAvatar($('pav'), profile.avatar, 38);
  $('clearPhoto').hidden = profile.avatar.kind !== 'image';
  $('pnamePreview').textContent = profile.name || '닉네임';
  $('pnamePreview').style.color = pastelize(profile.color); // 채팅에서 보이는 대로(닉네임은 글자색)
  $('emojiGrid').replaceChildren(
    ...AVATARS.map((e) => {
      const b = document.createElement('button');
      b.textContent = e;
      if (profile.avatar.kind === 'emoji' && e === profile.avatar.value) b.className = 'sel';
      b.addEventListener('click', () => update({ avatar: { ...profile.avatar, kind: 'emoji', value: e } }));
      return b;
    }),
  );
  swatches($('bgGrid'), $('bgPicker'), COLOR_PALETTE, profile.avatar.bg, (c) => update({ avatar: { ...profile.avatar, bg: c } }));
  swatches($('colorGrid'), $('colorPicker'), COLOR_PALETTE, profile.color, (c) => update({ color: c }));
}

// 저장: chrome.storage.local 에 보관하고(background 담당), 방에 있으면 방 전체에 전파된다
function update(patch) {
  profile = { ...profile, ...patch };
  renderProfile();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // 닉네임을 비워 둬도 색/프사는 저장되도록, 비었으면 지금 쓰는 이름을 쓴다
    const name = profile.name.trim() || state?.participants?.find((p) => p.id === state.userId)?.name || '';
    if (name.length >= 1 && name.length <= MAX_NAME_LENGTH) {
      chrome.runtime.sendMessage({ cmd: CMD.SET_PROFILE, profile: { ...profile, name } });
    }
  }, 300);
}

$('pname').addEventListener('input', (e) => update({ name: e.target.value }));

// 모든 이모지 선택기
let picker = null;
$('moreEmoji').addEventListener('click', () => {
  const box = $('pickerBox');
  if (!picker) {
    picker = createEmojiPicker({ onPick: (e) => update({ avatar: { ...profile.avatar, kind: 'emoji', value: e } }) });
    box.append(picker.el);
  }
  box.hidden = !box.hidden;
  if (!box.hidden) picker.reset();
});

// 사진 업로드: 내 컴퓨터에서 64x64 로 줄여 프로필에 포함한다
$('upload').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  $('perror').textContent = '';
  if (!file) return;
  try {
    const url = await fileToAvatarDataUrl(file);
    update({ avatar: { kind: 'image', value: url, bg: profile.avatar.bg } });
  } catch (err) {
    $('perror').textContent = err.message?.includes('20KB') ? err.message : '이미지를 불러올 수 없어요. 다른 사진을 골라 주세요.';
  }
});
$('clearPhoto').addEventListener('click', () => update({ avatar: { kind: 'emoji', value: AVATARS[0], bg: profile.avatar.bg } }));

async function loadProfile() {
  const saved = (await chrome.storage.local.get('profile')).profile;
  if (saved) profile = saved;
  else {
    // 저장된 프로필이 없으면 서버가 준 임시 프로필을 시작점으로 보여준다
    const me = state?.participants?.find((p) => p.id === state.userId);
    if (me) profile = { name: me.name, avatar: me.avatar, color: me.color };
  }
  $('pname').value = profile.name;
  renderProfile();
}

chrome.runtime.onMessage.addListener((m) => {
  if (m.cmd === CMD.STATE) {
    state = m.state;
    render();
  }
});

state = await chrome.runtime.sendMessage({ cmd: CMD.GET_STATE });
render();
await loadProfile();
