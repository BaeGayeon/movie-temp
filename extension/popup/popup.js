import { APP_NAME, APP_NAME_KO } from '../config.js';
import { CMD } from '../shared/cmd.js';
import { COLOR_PALETTE, MAX_NAME_LENGTH, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, MIN_ROOM_MEMBERS, MAX_ROOM_MEMBERS, isValidNewPassword, isValidMaxMembers } from '../shared/protocol.js';
import { renderAvatar, bitmapToAvatarDataUrl } from '../shared/avatar.js';
import { createEmojiPicker, EMOJI_PICKER_CSS } from '../shared/emoji-picker.js';
import { ROOT_THEME_CSS, pastelize } from '../shared/theme.js';
import { createColorPicker, isHex } from '../shared/color-picker.js';
import { cleanFont } from '../shared/fontname.js';

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

// 글자 앞 이모지를 따로 감싸서 글자와 세로 가운데를 맞추고 간격을 둔다(동적으로 바뀌는 문구도 포함)
const LEAD_EMOJI = /^(\p{Extended_Pictographic}\uFE0F?(?:\u200d\p{Extended_Pictographic}\uFE0F?)*)(\s+)(?=\S)/u;
function decorate(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement.closest('option,style,script,.pav,.av,#pnamePreview') || n.parentElement.classList.contains('ic')) continue;
    if (LEAD_EMOJI.test(n.data)) hits.push(n);
  }
  for (const n of hits) {
    const m = LEAD_EMOJI.exec(n.data);
    const ic = document.createElement('span');
    ic.className = 'ic';
    ic.textContent = m[1];
    n.data = n.data.slice(m[0].length);
    n.before(ic);
  }
}
new MutationObserver(() => decorate(document.body)).observe(document.body, { childList: true, subtree: true, characterData: true });
decorate(document.body);

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

let curTabId = null; // 지금 보고 있는 탭
function render() {
  const inRoom = !!state?.roomCode;
  // 방은 한 탭에만 묶인다: 다른 탭에서 연 팝업에서는 방 UI 대신 "어디서 하는 중인지"만 보여준다
  const here = inRoom && state.tabId === curTabId;
  const elsewhere = inRoom && !here;
  $('lobby').hidden = inRoom;
  $('room').hidden = !here;
  $('elsewhere').hidden = !elsewhere;
  $('elsewhereSite').textContent = state?.site || '다른 탭';
  $('error').textContent = state?.error ?? (state?.waking ? '서버를 깨우는 중이에요 (최대 1분)…' : '');
  $('error').classList.toggle('info', !state?.error && !!state?.waking);
  // 비밀번호가 필요한 방에 참가하려다 거절됨: 코드를 채워 두고 비밀번호 칸으로 안내
  if (state?.needPassword && !inRoom && document.activeElement !== $('joinPw') && $('joinPw').dataset.askedFor !== state.needPassword.roomCode) {
    $('joinPw').dataset.askedFor = state.needPassword.roomCode;
    $('code').value = state.needPassword.roomCode;
    $('joinPw').focus();
  }
  if (!here) return;

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
  $('count').textContent = `${state.hasPassword ? '🔒 ' : ''}${state.participants.length}${state.maxMembers ? `/${state.maxMembers}` : ''}명`;

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
  $('optBox').hidden = !isHost;
  if (isHost) renderOptions();
  const waiting = state.waitingIds.map((id) => state.participants.find((p) => p.id === id)?.name ?? '누군가');
  $('waitInfo').hidden = waiting.length === 0;
  $('waitInfo').textContent = `⏳ ${waiting.join(', ')} 님을 기다리는 중이에요`;
}

// ---------- 방장용 방 옵션(비밀번호 확인/변경/삭제, 최대 인원) ----------
let knownPw = null; // 이 브라우저가 기억하는 방 비밀번호(모르면 null)
let pwShown = false;
let pwKey = '';

async function refreshPw() {
  const r = await chrome.runtime.sendMessage({ cmd: CMD.GET_ROOM_PW }).catch(() => null);
  knownPw = r?.password ?? null;
  paintPw();
}

function paintPw() {
  const has = !!state?.hasPassword;
  const value = $('pwValue');
  const known = has && !!knownPw;
  value.classList.toggle('mono', known);
  value.textContent = !has ? '설정 안 함' : known ? (pwShown ? knownPw : '•'.repeat(knownPw.length)) : '설정돼 있어요 (이 기기에서는 볼 수 없어요)';
  $('pwEye').hidden = !known;
  $('pwCopy').hidden = !known;
  $('pwEye').innerHTML = pwShown ? EYE_OFF : EYE; // 정적 SVG 문자열만 넣는다
  $('pwEye').setAttribute('aria-label', pwShown ? '비밀번호 숨기기' : '비밀번호 보기');
  $('pwEdit').textContent = has ? '변경' : '설정';
  $('pwRemove').hidden = !has;
}

function renderOptions() {
  const key = `${state.roomCode}:${state.hasPassword}`;
  if (key !== pwKey) {
    pwKey = key;
    pwShown = false;
    refreshPw();
  }
  paintPw();
  if (document.activeElement !== $('maxEdit')) $('maxEdit').value = state.maxMembers ?? '';
}

async function setOptions(opts) {
  const r = await chrome.runtime.sendMessage({ cmd: CMD.SET_ROOM_OPTIONS, ...opts }).catch(() => null);
  if (r?.ok) $('error').textContent = '';
  await refreshPw();
  return !!r?.ok;
}

$('pwEdit').addEventListener('click', () => {
  $('pwForm').hidden = false;
  $('pwNew').focus();
});
$('pwCancel').addEventListener('click', () => {
  $('pwNew').value = '';
  $('pwNew').parentElement.hidePassword();
  $('pwForm').hidden = true;
});
$('pwSave').addEventListener('click', async () => {
  const pw = $('pwNew').value;
  if (!isValidNewPassword(pw)) return ($('error').textContent = `비밀번호는 영문과 숫자 ${MIN_PASSWORD_LENGTH}~${MAX_PASSWORD_LENGTH}자로 정해 주세요.`);
  if (await setOptions({ password: pw })) $('pwCancel').click();
});
$('pwRemove').addEventListener('click', async () => {
  if (confirm('비밀번호를 없앨까요? 누구나 방 코드만 알면 들어올 수 있게 돼요.')) await setOptions({ password: null });
});
$('pwEye').addEventListener('click', () => {
  pwShown = !pwShown;
  paintPw();
});
$('pwCopy').addEventListener('click', async () => {
  if (!knownPw) return;
  await navigator.clipboard.writeText(knownPw).catch(() => {});
  $('pwCopy').textContent = '복사됨';
  setTimeout(() => ($('pwCopy').textContent = '복사'), 1200);
});
$('maxSave').addEventListener('click', async () => {
  const n = $('maxEdit').value ? Number($('maxEdit').value) : null;
  if (n !== null && !isValidMaxMembers(n)) return ($('error').textContent = `최대 인원은 ${MIN_ROOM_MEMBERS}~${MAX_ROOM_MEMBERS}명으로 정해 주세요.`);
  await setOptions({ maxMembers: n });
});

function badge(text, cls) {
  const b = document.createElement('span');
  b.className = `badge ${cls}`;
  b.textContent = text;
  return b;
}

// 영상이 있는 탭에서만 방 만들기/참가 가능(영상은 나중에 뜰 수 있으니 열려 있는 동안 계속 확인)
async function checkVideo() {
  if (state?.roomCode) return;
  const tab = await activeTab();
  const reply = await chrome.runtime.sendMessage({ cmd: CMD.HAS_VIDEO, tabId: tab?.id }).catch(() => null);
  const ok = !!reply?.ok;
  for (const id of ['create', 'join', 'code', 'joinPw', 'createPw', 'createMax']) $(id).disabled = !ok;
  $('noVideo').hidden = ok;
}
setInterval(checkVideo, 1500);

// 방 코드와 비밀번호는 영문과 숫자만 입력할 수 있다(한글 등은 입력되자마자 지운다. 붙여넣기, 한글 조합 입력 포함)
// 길이 제한도 여기서 한다(maxlength 는 걸러내기 전에 자르므로 "ABC-DEF" 를 붙여넣으면 마지막 글자가 빠진다)
for (const [id, max] of [['code', 6], ['createPw', MAX_PASSWORD_LENGTH], ['joinPw', MAX_PASSWORD_LENGTH], ['pwNew', MAX_PASSWORD_LENGTH]]) {
  const el = $(id);
  const keepAlnum = () => {
    const clean = el.value.replace(/[^A-Za-z0-9]/g, '').slice(0, max);
    if (clean !== el.value) el.value = clean;
  };
  el.addEventListener('input', keepAlnum);
  el.addEventListener('compositionend', keepAlnum);
}

// 비밀번호 칸의 보기/숨기기(눈) 버튼
const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.9 10.9 0 0 1 12 19C5 19 1 12 1 12a19.8 19.8 0 0 1 5.06-5.94M9.9 4.24A10.9 10.9 0 0 1 12 5c7 0 11 7 11 7a19.9 19.9 0 0 1-3.16 4.19M14.12 14.12A3 3 0 1 1 9.88 9.88"/><path d="M1 1l22 22"/></svg>';
for (const wrap of document.querySelectorAll('.pwwrap')) {
  const input = wrap.querySelector('input');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pweye';
  const sync = () => {
    const shown = input.type === 'text';
    btn.innerHTML = shown ? EYE_OFF : EYE; // 정적 SVG 문자열만 넣는다
    btn.setAttribute('aria-label', shown ? '비밀번호 숨기기' : '비밀번호 보기');
  };
  btn.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password';
    sync();
    input.focus();
  });
  sync();
  wrap.append(btn);
  wrap.hidePassword = () => {
    input.type = 'password';
    sync();
  };
}

$('create').addEventListener('click', async () => {
  const tab = await activeTab();
  const password = $('createPw').value;
  const maxMembers = $('createMax').value ? Number($('createMax').value) : undefined;
  if (password && !isValidNewPassword(password)) return ($('error').textContent = `비밀번호는 영문과 숫자 ${MIN_PASSWORD_LENGTH}~${MAX_PASSWORD_LENGTH}자로 정해 주세요.`);
  if (maxMembers !== undefined && !isValidMaxMembers(maxMembers)) return ($('error').textContent = `최대 인원은 ${MIN_ROOM_MEMBERS}~${MAX_ROOM_MEMBERS}명으로 정해 주세요.`);
  chrome.runtime.sendMessage({ cmd: CMD.CREATE_ROOM, tabId: tab?.id, site: tab?.url, password: password || undefined, maxMembers });
  $('createPw').value = ''; // 비밀번호를 입력칸에 남기지 않는다
  $('createPw').parentElement.hidePassword();
});

$('join').addEventListener('click', async () => {
  const tab = await activeTab();
  chrome.runtime.sendMessage({ cmd: CMD.JOIN_ROOM, roomCode: $('code').value, tabId: tab?.id, site: tab?.url, password: $('joinPw').value || undefined });
  $('joinPw').value = '';
  $('joinPw').parentElement.hidePassword();
});

$('countdown').addEventListener('click', () =>
  chrome.runtime.sendMessage({ cmd: CMD.COUNTDOWN_START, seconds: Number($('seconds').value) }),
);
// 채팅 숨기기/보이기: 채팅 설정(chatPrefs.hidden)을 바꾸면 방 화면의 채팅이 따라간다
const paintChatToggle = (hidden) => ($('chatToggle').textContent = hidden ? '💬 채팅 보이기' : '💬 채팅 숨기기');
chrome.storage.local.get('chatPrefs').then((r) => paintChatToggle(!!r.chatPrefs?.hidden));
$('chatToggle').addEventListener('click', async () => {
  const { chatPrefs } = await chrome.storage.local.get('chatPrefs');
  await chrome.storage.local.set({ chatPrefs: { ...chatPrefs, hidden: !chatPrefs?.hidden } });
});
chrome.storage.onChanged.addListener((ch) => ch.chatPrefs && paintChatToggle(!!ch.chatPrefs.newValue?.hidden));
// 나가기는 한 번 더 묻는다: 버튼 줄을 "정말 나갈까요? [나가기] [취소]"로 잠깐 바꾼다
function confirmLeave(row) {
  const keep = [...row.children];
  const q = document.createElement('span');
  q.className = 'confirm-q';
  q.textContent = '정말 나갈까요?';
  const yes = document.createElement('button');
  yes.className = 'btn danger small';
  yes.textContent = '나가기';
  const no = document.createElement('button');
  no.className = 'btn small';
  no.textContent = '취소';
  const restore = () => row.replaceChildren(...keep);
  yes.addEventListener('click', () => {
    restore();
    chrome.runtime.sendMessage({ cmd: CMD.LEAVE_ROOM });
  });
  no.addEventListener('click', restore);
  row.replaceChildren(q, yes, no);
  no.focus();
}
$('leaveElsewhere').addEventListener('click', (e) => confirmLeave(e.currentTarget.parentElement));
$('goRoom').addEventListener('click', async () => {
  try {
    const tab = await chrome.tabs.update(state.tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch {}
});
$('leave').addEventListener('click', (e) => confirmLeave(e.currentTarget.parentElement));
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

// ---------- 진단 정보: 현재 탭의 최근 동작 기록을 클립보드로 ----------
$('copyDiag').addEventListener('click', async () => {
  const label = $('copyDiag').textContent;
  try {
    const tab = await activeTab();
    const reply = await chrome.tabs.sendMessage(tab.id, { cmd: CMD.DIAG });
    await navigator.clipboard.writeText(reply.text);
    $('copyDiag').textContent = '✅ 복사됨!';
  } catch {
    $('copyDiag').textContent = '이 탭에는 기록이 없어요';
  }
  setTimeout(() => ($('copyDiag').textContent = label), 1800);
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

// 기본 색 + 직접 고르기. 직접 고른 색은 기억해 두고, 다른 색으로 바꿨다가 다시 눌러도 그 색이 나온다.
let customColors = {};
const pickers = []; // 열린 선택기는 하나만
function swatches(container, pickerBox, key, colors, current, onPick) {
  const isCustom = isHex(current) && !colors.includes(current.toLowerCase());
  if (isCustom && customColors[key] !== current.toLowerCase()) {
    customColors[key] = current.toLowerCase();
    chrome.storage.local.set({ customColors });
  }
  const last = customColors[key];
  const list = colors.map((c) => {
    const b = document.createElement('button');
    b.className = `sw${c === current ? ' sel' : ''}`;
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => {
      pickerBox.hidden = true; // 기본 색을 고르면 직접 고르기는 닫는다
      onPick(c);
    });
    return b;
  });
  const more = document.createElement('button');
  more.className = `sw rainbow${last ? ' has' : ''}${isCustom ? ' sel' : ''}`;
  if (last) more.style.setProperty('--custom', last);
  more.title = '직접 고르기';
  more.addEventListener('click', () => {
    if (!pickerBox.hidden && isCustom) {
      pickerBox.hidden = true; // 선택된 상태에서 다시 누르면 닫기
      return;
    }
    for (const box of pickers) if (box !== pickerBox) box.hidden = true;
    pickerBox.hidden = false;
    const start = last ?? (isHex(current) ? current : '#8cc8ff');
    if (!pickerBox.picker) {
      pickerBox.picker = createColorPicker({ value: start, onChange: onPick });
      pickerBox.append(pickerBox.picker.el);
    } else pickerBox.picker.set(start);
    if (last && !isCustom) onPick(last); // 전에 고른 색을 바로 적용
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
  swatches($('bgGrid'), $('bgPicker'), 'bg', COLOR_PALETTE, profile.avatar.bg, (c) => update({ avatar: { ...profile.avatar, bg: c } }));
  swatches($('colorGrid'), $('colorPicker'), 'color', COLOR_PALETTE, profile.color, (c) => update({ color: c }));
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

// 채팅 글꼴: 내 컴퓨터에 설치된 글꼴 이름만 chatPrefs.fontFamily 에 저장한다(글꼴 파일은 읽지 않는다). 내 화면의 채팅에만 적용된다.
// 드롭다운은 "기본 글꼴" + 내 컴퓨터에서 불러온 글꼴(localFonts). 불러오기는 아래 autoLoadFonts 가 카드를 열 때 자동으로 한다.
let localFonts = [];
function fontOptions(current) {
  const names = current && !localFonts.includes(current) ? [current, ...localFonts] : localFonts;
  return [['', '기본 글꼴 (SUIT)'], ...names.map((f) => [f, f])];
}
// 목록을 훑는 동안(마우스 올리기, ↑↓) 샘플 글과 채팅에 미리 적용하고(저장 안 함), 클릭/Enter 로 확정, 닫기/Esc 로 취소한다.
let committedFont = '';
let previewBeat = null;
const sampleFont = (name) => ($('fontSample').style.fontFamily = name ? `"${name}", sans-serif` : '');
function sendPreview(name) {
  sampleFont(name);
  chrome.storage.local.set({ chatFontPreview: name == null ? null : { name, at: Date.now() } });
}
function listOpen() {
  return !$('fontList').hidden;
}
function closeFontList(commit) {
  clearInterval(previewBeat);
  $('fontList').hidden = true;
  $('fontCur').setAttribute('aria-expanded', 'false');
  chrome.storage.local.set({ chatFontPreview: null }); // 미리보기 해제(확정이면 chatPrefs 가 이미 같은 글꼴)
  if (!commit) sampleFont(committedFont);
}
function activeOption() {
  return $('fontList').querySelector('[role=option].on');
}
function setActive(opt, scroll = true) {
  $('fontList').querySelector('.on')?.classList.remove('on');
  if (!opt) return;
  opt.classList.add('on');
  if (scroll) opt.scrollIntoView({ block: 'nearest' });
  sendPreview(opt.dataset.font);
}
function renderFontList(current) {
  const list = $('fontList');
  list.replaceChildren(
    ...fontOptions(current).map(([value, label]) => {
      const o = document.createElement('div');
      o.setAttribute('role', 'option');
      o.dataset.font = value;
      o.textContent = label;
      if (value) o.style.fontFamily = `"${value}", sans-serif`; // 글꼴 이름을 그 글꼴로 보여 준다
      o.setAttribute('aria-selected', String(value === (current ?? '')));
      return o;
    }),
  );
  $('fontCur').textContent = current || '기본 글꼴 (SUIT)';
}
function openFontList() {
  $('fontList').hidden = false;
  $('fontCur').setAttribute('aria-expanded', 'true');
  const sel = $('fontList').querySelector('[aria-selected=true]');
  sel?.scrollIntoView({ block: 'center' });
  $('fontList').focus();
  previewBeat = setInterval(() => sendPreview(activeOption()?.dataset.font ?? committedFont), 2000); // 채팅 쪽 4초 만료를 늦춘다
}
$('fontCur').addEventListener('click', () => (listOpen() ? closeFontList(false) : openFontList()));
$('fontList').addEventListener('mouseover', (e) => {
  const o = e.target.closest('[role=option]');
  if (o && o !== activeOption()) setActive(o, false);
});
$('fontList').addEventListener('click', (e) => {
  const o = e.target.closest('[role=option]');
  if (!o) return;
  setChatFont(o.dataset.font);
  closeFontList(true);
});
$('fontList').addEventListener('keydown', (e) => {
  const opts = [...$('fontList').querySelectorAll('[role=option]')];
  const i = opts.indexOf(activeOption());
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const base = i < 0 ? opts.findIndex((o) => o.getAttribute('aria-selected') === 'true') : i;
    setActive(opts[Math.min(opts.length - 1, Math.max(0, base + (e.key === 'ArrowDown' ? 1 : -1)))]);
  } else if (e.key === 'Enter' && activeOption()) {
    e.preventDefault();
    setChatFont(activeOption().dataset.font);
    closeFontList(true);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeFontList(false);
    $('fontCur').focus();
  }
});
$('fontList').addEventListener('mouseleave', () => {
  if (!listOpen()) return; // 목록이 닫히며 생긴 mouseleave 는 무시
  $('fontList').querySelector('.on')?.classList.remove('on');
  sendPreview(committedFont); // 목록 밖으로 나가면 확정된 글꼴로
});
addEventListener('pagehide', () => chrome.storage.local.set({ chatFontPreview: null })); // 팝업이 닫히면 미리보기 해제
const paintFont = (name) => {
  $('fontName').value = name;
  committedFont = name;
  sampleFont(name);
  renderFontList(name);
};
async function setChatFont(raw) {
  const name = cleanFont(raw);
  $('ferror').textContent = '';
  paintFont(name);
  const { chatPrefs } = await chrome.storage.local.get('chatPrefs');
  await chrome.storage.local.set({ chatPrefs: { ...chatPrefs, fontFamily: name } });
}
chrome.storage.local.get(['chatPrefs', 'localFonts']).then((r) => {
  localFonts = Array.isArray(r.localFonts) ? r.localFonts.filter((f) => typeof f === 'string').slice(0, 5000) : [];
  paintFont(cleanFont(r.chatPrefs?.fontFamily));
});
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch.localFonts) localFonts = Array.isArray(ch.localFonts.newValue) ? ch.localFonts.newValue : [];
  if (ch.localFonts || ch.chatPrefs) chrome.storage.local.get('chatPrefs').then((r) => paintFont(cleanFont(r.chatPrefs?.fontFamily)));
});
$('fontApply').addEventListener('click', () => setChatFont($('fontName').value));
$('fontName').addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && setChatFont($('fontName').value));
$('fontReset').addEventListener('click', () => setChatFont(''));
// 내 컴퓨터 글꼴 목록(queryLocalFonts): 글꼴 카드를 열면 자동으로 불러온다.
//  - 이미 허용했으면 조용히 불러옴
//  - 처음이면 카드를 연 클릭이 사용자 동작이므로 그 자리에서 호출 -> 크롬이 허용 창을 띄움
//  - 사용자 동작이 없는 상태(카드가 열린 채로 팝업이 열림)에서 아직 허용 전이면 "허용하고 불러오기" 버튼을 보여 줌
let fontsTried = false;
async function loadLocalFonts() {
  $('ferror').textContent = '';
  try {
    const fonts = await window.queryLocalFonts();
    const families = [...new Set(fonts.map((f) => f.family))].sort((x, y) => x.localeCompare(y, 'ko'));
    if (families.length) await chrome.storage.local.set({ localFonts: families });
    $('fontLoad').hidden = true;
    $('fontManual').hidden = true;
  } catch (err) {
    $('fontLoad').hidden = false;
    $('fontManual').hidden = false; // 목록을 못 불러올 때만 이름 직접 입력을 보여 준다
    $('ferror').textContent =
      err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
        ? '글꼴 목록을 볼 수 있는 권한이 필요해요. 허용하지 않으면 아래에 글꼴 이름을 직접 입력해 주세요.'
        : `글꼴 목록을 불러오지 못했어요(${err?.name ?? '오류'}). 아래에 글꼴 이름을 직접 입력해 주세요.`;
  }
}
async function autoLoadFonts() {
  if (typeof window.queryLocalFonts !== 'function') return $('fontManual').hidden = false; // 미지원: 이름 직접 입력만
  let state = 'prompt';
  try {
    state = (await navigator.permissions.query({ name: 'local-fonts' })).state;
  } catch {}
  if (state === 'denied') {
    $('fontManual').hidden = false;
    $('ferror').textContent = '글꼴 접근이 차단돼 있어요. 크롬 설정에서 허용하거나, 아래에 글꼴 이름을 직접 입력해 주세요.';
    return;
  }
  if (state === 'granted' || navigator.userActivation?.isActive) await loadLocalFonts();
  else $('fontLoad').hidden = false;
}
$('fontLoad').addEventListener('click', loadLocalFonts);
$('fontBox').addEventListener('toggle', () => {
  if (!$('fontBox').open || fontsTried) return;
  fontsTried = true;
  autoLoadFonts();
});

// 글자/프사 크기: 슬라이더를 움직이면 chatPrefs 에 저장하고 채팅이 바로 반영한다(기본값은 채팅과 같다: 글자 1.1배, 프사 34px)
const SIZE_DEFAULTS = { fontScale: 1.1, avatarSize: 34 };
let sizeSaveTimer = null;
function saveSizes() {
  clearTimeout(sizeSaveTimer);
  sizeSaveTimer = setTimeout(async () => {
    const { chatPrefs } = await chrome.storage.local.get('chatPrefs');
    await chrome.storage.local.set({ chatPrefs: { ...chatPrefs, fontScale: Number($('fontScale').value), avatarSize: Number($('avatarSize').value) } });
  }, 60);
}
function paintSizes(prefs) {
  $('fontScale').value = String(prefs?.fontScale ?? SIZE_DEFAULTS.fontScale);
  $('avatarSize').value = String(prefs?.avatarSize ?? SIZE_DEFAULTS.avatarSize);
  $('fontSample').style.fontSize = `${15 * Number($('fontScale').value) / 1.1}px`;
}
chrome.storage.local.get('chatPrefs').then((r) => paintSizes(r.chatPrefs));
$('fontScale').addEventListener('input', () => { paintSizes({ fontScale: $('fontScale').value, avatarSize: $('avatarSize').value }); saveSizes(); });
$('avatarSize').addEventListener('input', saveSizes);
$('sizeReset').addEventListener('click', () => { paintSizes(SIZE_DEFAULTS); saveSizes(); });

$('upload').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  $('perror').textContent = '';
  if (!file) return;
  try {
    openCropper(await createImageBitmap(file));
  } catch {
    $('perror').textContent = '이미지를 불러올 수 없어요. 다른 사진을 골라 주세요.';
  }
});

// 크롭: 원형 미리보기 안에서 사진을 끌어 위치를 정하고 확대/축소한다. 적용하면 보이는 영역(원에 내접한 정사각형)을 64x64 로 쓴다.
const VIEW = 160; // 미리보기 한 변(css px). 캔버스는 2배 해상도
let crop = null; // { bmp, base, zoom, ox, oy }: base=원을 꽉 채우는 배율, ox/oy=사진 왼쪽 위 모서리의 위치
const cropCanvas = $('cropCanvas');
const cropCtx = cropCanvas.getContext('2d');

function clampCrop() {
  const s = crop.base * crop.zoom;
  crop.ox = Math.min(0, Math.max(VIEW - crop.bmp.width * s, crop.ox));
  crop.oy = Math.min(0, Math.max(VIEW - crop.bmp.height * s, crop.oy));
}

function drawCrop() {
  const s = crop.base * crop.zoom;
  cropCtx.setTransform(2, 0, 0, 2, 0, 0);
  cropCtx.clearRect(0, 0, VIEW, VIEW);
  cropCtx.drawImage(crop.bmp, crop.ox, crop.oy, crop.bmp.width * s, crop.bmp.height * s);
  // 원 바깥은 어둡게, 원 테두리
  cropCtx.save();
  cropCtx.fillStyle = 'rgba(0,0,0,.55)';
  cropCtx.beginPath();
  cropCtx.rect(0, 0, VIEW, VIEW);
  cropCtx.arc(VIEW / 2, VIEW / 2, VIEW / 2 - 2, 0, Math.PI * 2, true);
  cropCtx.fill('evenodd');
  cropCtx.strokeStyle = 'rgba(255,255,255,.9)';
  cropCtx.lineWidth = 2;
  cropCtx.beginPath();
  cropCtx.arc(VIEW / 2, VIEW / 2, VIEW / 2 - 2, 0, Math.PI * 2);
  cropCtx.stroke();
  cropCtx.restore();
}

function setZoom(z) {
  // 미리보기 한가운데를 기준으로 확대/축소
  const old = crop.base * crop.zoom;
  const cx = (VIEW / 2 - crop.ox) / old;
  const cy = (VIEW / 2 - crop.oy) / old;
  crop.zoom = Math.min(4, Math.max(1, z));
  const s = crop.base * crop.zoom;
  crop.ox = VIEW / 2 - cx * s;
  crop.oy = VIEW / 2 - cy * s;
  clampCrop();
  $('cropZoom').value = Math.round(crop.zoom * 100);
  drawCrop();
}

function openCropper(bmp) {
  const base = VIEW / Math.min(bmp.width, bmp.height); // 짧은 변이 원을 꽉 채우는 크기(이보다 작아지지 않는다)
  crop = { bmp, base, zoom: 1, ox: (VIEW - bmp.width * base) / 2, oy: (VIEW - bmp.height * base) / 2 };
  $('cropZoom').value = 100;
  $('cropBox').hidden = false;
  drawCrop();
}

function closeCropper() {
  crop = null;
  $('cropBox').hidden = true;
}

let dragFrom = null;
cropCanvas.addEventListener('pointerdown', (e) => {
  if (!crop) return;
  dragFrom = { x: e.clientX, y: e.clientY, ox: crop.ox, oy: crop.oy };
  cropCanvas.setPointerCapture(e.pointerId);
  cropCanvas.classList.add('drag');
});
cropCanvas.addEventListener('pointermove', (e) => {
  if (!crop || !dragFrom) return;
  crop.ox = dragFrom.ox + (e.clientX - dragFrom.x);
  crop.oy = dragFrom.oy + (e.clientY - dragFrom.y);
  clampCrop();
  drawCrop();
});
const endDrag = () => {
  dragFrom = null;
  cropCanvas.classList.remove('drag');
};
cropCanvas.addEventListener('pointerup', endDrag);
cropCanvas.addEventListener('pointercancel', endDrag);
cropCanvas.addEventListener(
  'wheel',
  (e) => {
    if (!crop) return;
    e.preventDefault();
    setZoom(crop.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
  },
  { passive: false },
);
$('cropZoom').addEventListener('input', (e) => crop && setZoom(e.target.value / 100));
$('cropCancel').addEventListener('click', closeCropper);
$('cropApply').addEventListener('click', () => {
  if (!crop) return;
  const s = crop.base * crop.zoom;
  try {
    const url = bitmapToAvatarDataUrl(crop.bmp, { x: -crop.ox / s, y: -crop.oy / s, size: VIEW / s });
    closeCropper();
    update({ avatar: { kind: 'image', value: url, bg: profile.avatar.bg } });
  } catch (err) {
    $('perror').textContent = err.message?.includes('20KB') ? err.message : '이미지를 불러올 수 없어요. 다른 사진을 골라 주세요.';
  }
});
$('clearPhoto').addEventListener('click', () => update({ avatar: { kind: 'emoji', value: AVATARS[0], bg: profile.avatar.bg } }));

pickers.push($('bgPicker'), $('colorPicker'));

async function loadProfile() {
  customColors = (await chrome.storage.local.get('customColors')).customColors ?? {};
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

curTabId = (await activeTab())?.id ?? null;
state = await chrome.runtime.sendMessage({ cmd: CMD.GET_STATE });
render();
checkVideo();
await loadProfile();
