// 내 컴퓨터 글꼴 불러오기 화면(확장 프로그램 탭). 팝업은 크롬의 권한 창이 뜨면 닫혀 버리므로 일반 탭에서 권한을 받는다.
// 목록(글꼴 이름만)은 chrome.storage.local.localFonts 에 저장해 팝업의 드롭다운이 쓴다. 여기서 바로 골라도 된다.
import { ROOT_THEME_CSS } from '../shared/theme.js';
import { cleanFont } from '../shared/fontname.js';

const style = document.createElement('style');
style.textContent = ROOT_THEME_CSS;
document.head.append(style);
const $ = (id) => document.getElementById(id);

async function setChatFont(raw) {
  const name = cleanFont(raw);
  $('sample').style.fontFamily = name ? `"${name}", sans-serif` : '';
  const { chatPrefs } = await chrome.storage.local.get('chatPrefs');
  await chrome.storage.local.set({ chatPrefs: { ...chatPrefs, fontFamily: name } });
}

async function fill(families, current) {
  const names = current && !families.includes(current) ? [current, ...families] : families;
  $('select').replaceChildren(new Option('기본 글꼴 (SUIT)', ''), ...names.map((f) => new Option(f, f)));
  $('select').value = current ?? '';
  $('select').hidden = false;
  $('sample').hidden = false;
  $('sample').style.fontFamily = current ? `"${current}", sans-serif` : '';
}

$('select').addEventListener('change', (e) => setChatFont(e.target.value));

$('load').addEventListener('click', async () => {
  $('error').textContent = '';
  if (typeof window.queryLocalFonts !== 'function') {
    $('error').textContent = '이 브라우저에서는 글꼴 목록을 불러올 수 없어요. 팝업에서 글꼴 이름을 직접 입력해 주세요.';
    return;
  }
  try {
    const fonts = await window.queryLocalFonts(); // 크롬이 권한을 한 번 물어본다
    const families = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b, 'ko'));
    await chrome.storage.local.set({ localFonts: families });
    const cur = cleanFont((await chrome.storage.local.get('chatPrefs')).chatPrefs?.fontFamily);
    await fill(families, cur);
    $('status').textContent = `글꼴 ${families.length}개를 불러왔어요. 여기서 고르거나 팝업의 "채팅 글꼴"에서 고르세요.`;
  } catch (err) {
    $('error').textContent =
      err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
        ? '글꼴 목록을 볼 수 있는 권한이 필요해요. 주소창 왼쪽의 권한 설정에서 "글꼴"을 허용하거나, 팝업에서 글꼴 이름을 직접 입력해 주세요.'
        : `글꼴 목록을 불러오지 못했어요 (${err?.name ?? '오류'}). 팝업에서 글꼴 이름을 직접 입력해 주세요.`;
  }
});

// 이미 불러온 목록이 있으면 바로 보여 준다
(async () => {
  const { localFonts, chatPrefs } = await chrome.storage.local.get(['localFonts', 'chatPrefs']);
  if (Array.isArray(localFonts) && localFonts.length) {
    await fill(localFonts, cleanFont(chatPrefs?.fontFamily));
    $('status').textContent = `불러온 글꼴 ${localFonts.length}개`;
  }
})();
