// 프사 표시/생성 공용 모듈 (content, popup 에서 사용)
import { MAX_AVATAR_IMAGE_BYTES } from './protocol.js';

const AVATAR_PX = 64;
const decoded = new Map(); // dataURL -> Promise<ImageBitmap|null>

// 데이터 URL -> ImageBitmap. 페이지의 CSP(img-src)에 걸리지 않도록 <img>/fetch 를 쓰지 않고 직접 디코딩한다.
function decode(dataUrl) {
  if (!decoded.has(dataUrl)) {
    const m = /^data:(image\/(?:webp|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    let p = Promise.resolve(null);
    if (m) {
      try {
        const bin = atob(m[2]);
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        p = createImageBitmap(new Blob([bytes], { type: m[1] })).catch(() => null);
      } catch {}
    }
    decoded.set(dataUrl, p);
  }
  return decoded.get(dataUrl);
}

// el 안에 프사를 그린다. 크기/모양(원형 등)은 el 의 CSS 가 정하고, 여기서는 내용과 배경색만 채운다.
export function renderAvatar(el, avatar, px) {
  el.replaceChildren();
  el.style.background = avatar?.bg ?? '#555';
  if (avatar?.kind === 'image') {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = px * 2; // 고해상도 화면 대비
    canvas.style.cssText = `width:${px}px;height:${px}px;border-radius:50%;display:block`;
    el.append(canvas);
    decode(avatar.value).then((bmp) => bmp && canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height));
  } else {
    el.textContent = avatar?.value ?? '❔';
  }
}

const dataUrlBytes = (url) => Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4);

// 업로드한 이미지를 64x64 로 중앙 크롭해서 WebP(안 되면 JPEG) 데이터 URL 로 만든다. 20KB 이하가 될 때까지 품질을 낮춘다.
export async function fileToAvatarDataUrl(file) {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = AVATAR_PX;
  const ctx = canvas.getContext('2d');
  const s = Math.min(bmp.width, bmp.height);
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, AVATAR_PX, AVATAR_PX);
  for (const [type, qualities] of [['image/webp', [0.85, 0.7, 0.5, 0.3]], ['image/jpeg', [0.8, 0.5, 0.3]]]) {
    for (const q of qualities) {
      const url = canvas.toDataURL(type, q);
      if (url.startsWith(`data:${type};`) && dataUrlBytes(url) <= MAX_AVATAR_IMAGE_BYTES) return url;
    }
  }
  throw new Error('이미지를 20KB 이하로 줄일 수 없어요.');
}
