// 프사 표시/생성 공용 모듈 (content, popup 에서 사용)
import { MAX_AVATAR_IMAGE_BYTES } from './protocol.js';
import { t } from './i18n.js';

const AVATAR_PX = 64;
const SOURCE_PX = 512;
const decoded = new Map(); // dataURL -> Promise<ImageBitmap|null>

// 데이터 URL -> ImageBitmap. 페이지의 CSP(img-src)에 걸리지 않도록 <img>/fetch 를 쓰지 않고 직접 디코딩한다.
export function decode(dataUrl) {
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
    canvas.width = canvas.height = (px ?? 32) * 2; // 고해상도 화면 대비
    const side = px ? `${px}px` : '100%'; // px 가 없으면 el 크기(CSS)를 따른다
    canvas.style.cssText = `width:${side};height:${side};border-radius:50%;display:block`;
    el.append(canvas);
    decode(avatar.value).then((bmp) => bmp && canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height));
  } else {
    el.textContent = avatar?.value ?? '❔';
  }
}

const dataUrlBytes = (url) => Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4);

// 이미지의 crop({x, y, size}: 원본 픽셀 기준 정사각형)를 64x64 로 잘라 WebP(안 되면 JPEG) 데이터 URL 로 만든다.
// crop 이 없으면 중앙 정사각형. 20KB 이하가 될 때까지 품질을 낮춘다.
export function bitmapToAvatarDataUrl(bmp, crop) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = AVATAR_PX;
  const ctx = canvas.getContext('2d');
  const s = Math.min(bmp.width, bmp.height);
  const c = crop ?? { x: (bmp.width - s) / 2, y: (bmp.height - s) / 2, size: s };
  ctx.drawImage(bmp, c.x, c.y, c.size, c.size, 0, 0, AVATAR_PX, AVATAR_PX);
  for (const [type, qualities] of [['image/webp', [0.85, 0.7, 0.5, 0.3]], ['image/jpeg', [0.8, 0.5, 0.3]]]) {
    for (const q of qualities) {
      const url = canvas.toDataURL(type, q);
      if (url.startsWith(`data:${type};`) && dataUrlBytes(url) <= MAX_AVATAR_IMAGE_BYTES) return url;
    }
  }
  throw Object.assign(new Error(t('avatar.tooBig')), { code: 'AVATAR_TOO_BIG' });
}

// 위치 다시 맞추기용 원본: 긴 변 512px 이하로 줄인 WebP(안 되면 JPEG). 내 기기(chrome.storage.local)에만 보관하고 서버로는 보내지 않는다.
export function bitmapToSourceDataUrl(bmp) {
  const k = Math.min(1, SOURCE_PX / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * k));
  canvas.height = Math.max(1, Math.round(bmp.height * k));
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const webp = canvas.toDataURL('image/webp', 0.85);
  return webp.startsWith('data:image/webp;') ? webp : canvas.toDataURL('image/jpeg', 0.85);
}

export async function fileToAvatarDataUrl(file) {
  return bitmapToAvatarDataUrl(await createImageBitmap(file));
}
