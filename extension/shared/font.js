// 페이지 안 UI(채팅 등)용 SUIT 글꼴.
// shadow DOM 안의 @font-face 는 적용되지 않고 사이트의 CSP(font-src)에 막힐 수도 있어서, background 가 내장 폰트 파일을
// 읽어 보내주면 FontFace API 로 문서에 직접 등록한다(바이트로 만든 FontFace 는 font-src 의 영향을 받지 않는다).
import { CMD } from './cmd.js';

let loading = null;

export function ensureSuitFont() {
  loading ??= (async () => {
    try {
      const reply = await chrome.runtime.sendMessage({ cmd: CMD.GET_FONT });
      if (!reply?.data) return false;
      const bin = atob(reply.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const face = new FontFace('BMT SUIT', bytes.buffer, { weight: '100 900', display: 'swap' });
      await face.load();
      document.fonts.add(face);
      return true;
    } catch {
      return false; // 실패하면 시스템 글꼴로 보인다
    }
  })();
  return loading;
}
