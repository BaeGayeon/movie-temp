// extension/icons/ui/*.svg(Lucide)를 읽어 extension/shared/icons.js 를 만든다.
//   node tools/gen-icons.mjs
// 아이콘을 추가하려면 SVG 를 icons/ui/ 에 넣고 이 스크립트를 다시 돌린다.
// 페이지 안(content script)과 팝업은 innerHTML 을 못 쓰므로(Trusted Types) 이 모듈의 도형 데이터로 createElementNS 를 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'extension', 'icons', 'ui');

const icons = {};
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.svg')).sort()) {
  const svg = fs.readFileSync(path.join(dir, f), 'utf8');
  const body = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>'));
  const shapes = [];
  for (const m of body.matchAll(/<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*?)\/?>/g)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    shapes.push([m[1], attrs]);
  }
  if (!shapes.length) throw new Error(`${f}: 도형을 찾지 못했어요`);
  icons[f.replace(/\.svg$/, '')] = shapes;
}

const lines = Object.entries(icons).map(([name, shapes]) => `  '${name}': ${JSON.stringify(shapes)},`);
const out = `// 자동 생성: node tools/gen-icons.mjs (icons/ui/*.svg → 여기). 직접 고치지 말 것. Lucide(ISC), 라이선스는 icons/ui/LICENSE.txt.
const SVG_NS = 'http://www.w3.org/2000/svg';

const SHAPES = {
${lines.join('\n')}
};

// 아이콘 이름 → <svg>. currentColor 로 그리고 크기는 size(px). 이름이 없으면 null.
export function icon(name, size = 16) {
  const shapes = SHAPES[name];
  if (!shapes) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
  })) svg.setAttribute(k, v);
  svg.classList.add('ico');
  for (const [tag, attrs] of shapes) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

export const ICON_NAMES = Object.keys(SHAPES);
`;
fs.writeFileSync(path.join(root, 'extension', 'shared', 'icons.js'), out);
console.log(`${Object.keys(icons).length}개 아이콘 -> extension/shared/icons.js`);
