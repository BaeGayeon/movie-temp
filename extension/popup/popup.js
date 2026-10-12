import { APP_NAME } from '../config.js';
import { CMD } from '../shared/cmd.js';
import { COLOR_PALETTE, MAX_NAME_LENGTH } from '../shared/protocol.js';

const $ = (id) => document.getElementById(id);
$('title').textContent = APP_NAME;

let state = null;

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const CONN_LABEL = { connected: '연결됨', connecting: '연결 중…', disconnected: '끊김 (재연결 중)' };

function render() {
  const inRoom = !!state?.roomCode;
  $('lobby').hidden = inRoom;
  $('room').hidden = !inRoom;
  $('error').textContent = state?.error ?? '';
  if (!inRoom) return;

  $('roomCode').textContent = state.roomCode;
  $('conn').textContent = CONN_LABEL[state.connection] ?? '';
  $('count').textContent = `(${state.participants.length})`;

  const people = $('people');
  people.replaceChildren(
    ...state.participants.map((p) => {
      const li = document.createElement('li');
      const tags = [p.id === state.hostId ? '👑' : '', p.id === state.userId ? '(나)' : ''].filter(Boolean);
      li.textContent = [p.name, ...tags].join(' ');
      return li;
    }),
  );

  const isHost = state.hostId === state.userId;
  $('modeRow').hidden = !isHost;
  $('mode').value = state.mode;
  $('modeInfo').hidden = isHost;
  $('countdownRow').hidden = !isHost;
  const waiting = state.waitingIds.map((id) => state.participants.find((p) => p.id === id)?.name ?? '누군가');
  $('waitInfo').hidden = waiting.length === 0;
  $('waitInfo').textContent = `⏳ ${waiting.join(', ')} 님을 기다리는 중`;
  $('modeInfo').textContent = state.mode === 'host_only' ? '방장만 조작할 수 있어요' : '모두 조작할 수 있어요';
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
$('mode').addEventListener('change', (e) => chrome.runtime.sendMessage({ cmd: CMD.SET_MODE, mode: e.target.value }));

$('copy').addEventListener('click', async () => {
  const tab = await activeTab();
  try {
    const url = new URL(tab.url);
    url.searchParams.set('wp', state.roomCode);
    await navigator.clipboard.writeText(url.toString());
    $('copy').textContent = '복사됨!';
  } catch {
    $('error').textContent = '이 탭의 주소로는 초대 링크를 만들 수 없어요.';
    return;
  }
  setTimeout(() => ($('copy').textContent = '초대 링크 복사'), 1500);
});

// ---------- 프로필 (이름, 이모지 프사 + 배경색, 채팅 색) ----------
const AVATARS = ['🙂', '😎', '🤓', '🥳', '😺', '🐶', '🐻', '🐼', '🦊', '🐸', '🐧', '🦄'];
let profile = { name: '', avatar: { kind: 'emoji', value: AVATARS[0], bg: COLOR_PALETTE[5] }, color: COLOR_PALETTE[3] };
let saveTimer = null;

function swatches(container, colors, current, onPick) {
  container.replaceChildren(
    ...colors.map((c) => {
      const b = document.createElement('button');
      b.className = `sw${c === current ? ' sel' : ''}`;
      b.style.background = c;
      b.title = c;
      b.addEventListener('click', () => onPick(c));
      return b;
    }),
  );
}

function renderProfile() {
  $('pav').textContent = profile.avatar.value;
  $('pav').style.background = profile.avatar.bg;
  $('pnamePreview').textContent = profile.name || '(이름 없음: 임시 이름 사용)';
  $('pnamePreview').style.color = profile.color;
  $('emojiGrid').replaceChildren(
    ...AVATARS.map((e) => {
      const b = document.createElement('button');
      b.textContent = e;
      if (e === profile.avatar.value) b.className = 'sel';
      b.addEventListener('click', () => update({ avatar: { ...profile.avatar, value: e } }));
      return b;
    }),
  );
  swatches($('bgGrid'), COLOR_PALETTE, profile.avatar.bg, (c) => update({ avatar: { ...profile.avatar, bg: c } }));
  swatches($('colorGrid'), COLOR_PALETTE, profile.color, (c) => update({ color: c }));
}

// 저장: chrome.storage.local 에 보관하고(background 담당), 방에 있으면 방 전체에 전파된다
function update(patch) {
  profile = { ...profile, ...patch };
  renderProfile();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const name = profile.name.trim();
    if (name.length >= 1 && name.length <= MAX_NAME_LENGTH) {
      chrome.runtime.sendMessage({ cmd: CMD.SET_PROFILE, profile: { ...profile, name } });
    }
  }, 300);
}

$('pname').addEventListener('input', (e) => update({ name: e.target.value }));

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
