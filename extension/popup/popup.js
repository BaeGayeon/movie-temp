import { APP_NAME } from '../config.js';
import { CMD } from '../shared/cmd.js';

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

chrome.runtime.onMessage.addListener((m) => {
  if (m.cmd === CMD.STATE) {
    state = m.state;
    render();
  }
});

state = await chrome.runtime.sendMessage({ cmd: CMD.GET_STATE });
render();
