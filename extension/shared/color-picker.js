// 색 직접 고르기: 채도/밝기 사각형 + 색상 막대 + #rrggbb 입력.
// 크롬 확장 팝업에서는 네이티브 <input type=color> 창을 열면 팝업이 닫히는 경우가 있어서 직접 만들었다.
import { t } from './i18n.js';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v ?? '');

function hsvToHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${[f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}

function hexToHsv(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return [(h + 360) % 360, max ? d / max : 0, max];
}

const div = (cls) => Object.assign(document.createElement('div'), { className: cls });

// onChange(hex) 는 사용자가 조작할 때마다 호출된다. set(hex) 는 값만 맞추고 onChange 는 부르지 않는다.
export function createColorPicker({ value = '#8cc8ff', onChange }) {
  let [h, s, v] = hexToHsv(isHex(value) ? value : '#8cc8ff');

  const root = div('cp');
  const sv = div('cp-sv');
  const thumb = div('cp-thumb');
  sv.append(thumb);
  const hue = document.createElement('input');
  hue.type = 'range';
  hue.min = '0';
  hue.max = '360';
  hue.className = 'cp-hue';
  hue.setAttribute('aria-label', t('picker.hue'));
  const row = div('cp-row');
  const preview = div('cp-preview');
  const hex = document.createElement('input');
  hex.className = 'cp-hex';
  hex.maxLength = 7;
  hex.spellcheck = false;
  hex.setAttribute('aria-label', t('picker.hex'));
  row.append(preview, hex);
  root.append(sv, hue, row);
  // 사이트/팝업의 단축키가 입력 중에 끼어들지 않도록
  hex.addEventListener('keydown', (e) => e.stopPropagation());

  const current = () => hsvToHex(h, s, v);
  function paint(skipHex = false) {
    sv.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h}, 100%, 50%))`;
    thumb.style.left = `${s * 100}%`;
    thumb.style.top = `${(1 - v) * 100}%`;
    hue.value = String(Math.round(h));
    const c = current();
    preview.style.background = c;
    if (!skipHex) hex.value = c;
  }
  const emit = () => {
    paint();
    onChange?.(current());
  };

  const pick = (e) => {
    const r = sv.getBoundingClientRect();
    s = clamp((e.clientX - r.left) / r.width, 0, 1);
    v = 1 - clamp((e.clientY - r.top) / r.height, 0, 1);
    emit();
  };
  sv.addEventListener('pointerdown', (e) => {
    sv.setPointerCapture(e.pointerId);
    pick(e);
    const move = (ev) => pick(ev);
    const up = () => {
      sv.removeEventListener('pointermove', move);
      sv.removeEventListener('pointerup', up);
    };
    sv.addEventListener('pointermove', move);
    sv.addEventListener('pointerup', up);
  });
  hue.addEventListener('input', () => {
    h = Number(hue.value);
    emit();
  });
  hex.addEventListener('input', () => {
    const t = hex.value.trim().replace(/^#?/, '#');
    if (!isHex(t)) return; // 입력 중에는 올바른 값이 될 때까지 기다린다
    const [nh, ns, nv] = hexToHsv(t);
    if (ns > 0) h = nh; // 흰색/회색이면 색상 막대는 그대로 둔다
    s = ns;
    v = nv;
    paint(true);
    onChange?.(t.toLowerCase());
  });
  hex.addEventListener('blur', () => (hex.value = current()));

  paint();
  return {
    el: root,
    set(c) {
      if (!isHex(c)) return;
      const [nh, ns, nv] = hexToHsv(c);
      if (ns > 0) h = nh;
      s = ns;
      v = nv;
      paint();
    },
  };
}
