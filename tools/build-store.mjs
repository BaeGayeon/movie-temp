// 크롬 웹스토어에 올릴 확장 프로그램 묶음을 만든다.
//   node tools/build-store.mjs --server wss://내서버.onrender.com
// - extension/ 을 dist/store/ 로 복사
// - config.js 의 SERVER_URL 을 --server 값으로 교체(wss:// 필수)
// - 이름의 " [개발용]" 표시를 뺀다(config.js APP_NAME, manifest name)
// - 개발용 아이콘(icons-dev/)을 원래 아이콘(icons/)으로 되돌리고 icons-dev/ 는 지운다
// - manifest 에서 개발용 주소(localhost, file://)를 뺀다 -> 지원 사이트만 남는다
// - dist/ 에 zip 파일도 만든다(zip 명령이 있을 때)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const server = arg('server');
if (!server || !/^wss:\/\/[^/\s]+$/.test(server)) {
  console.error('사용법: node tools/build-store.mjs --server wss://내서버주소  (끝에 / 없이, wss:// 필수)');
  process.exit(1);
}

const src = path.join(root, 'extension');
const out = path.join(root, 'dist', 'store');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });

const cfgPath = path.join(out, 'config.js');
const cfg = fs.readFileSync(cfgPath, 'utf8');
if (!/export const SERVER_URL = '[^']*';/.test(cfg)) throw new Error('config.js 에서 SERVER_URL 을 찾지 못했어요');
const DEV_TAG = ' [개발용]';
fs.writeFileSync(cfgPath, cfg.replace(/export const SERVER_URL = '[^']*';/, `export const SERVER_URL = '${server}';`).replace(DEV_TAG, ''));

const mPath = path.join(out, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(mPath, 'utf8'));
manifest.name = manifest.name.replace(DEV_TAG, '');
const useStoreIcons = (icons) => Object.fromEntries(Object.entries(icons).map(([k, v]) => [k, v.replace('icons-dev/', 'icons/')]));
manifest.icons = useStoreIcons(manifest.icons);
manifest.action.default_icon = useStoreIcons(manifest.action.default_icon);
fs.rmSync(path.join(out, 'icons-dev'), { recursive: true, force: true });
const isDev = (pattern) => /^(file:|https?:\/\/(localhost|127\.0\.0\.1))/.test(pattern);
for (const cs of manifest.content_scripts) cs.matches = cs.matches.filter((p) => !isDev(p));
for (const war of manifest.web_accessible_resources ?? []) war.matches = war.matches.filter((p) => !isDev(p));
manifest.content_scripts = manifest.content_scripts.filter((cs) => cs.matches.length > 0);
fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2) + '\n');

const zipName = `bae-movie-temp-${manifest.version}.zip`;
const zipPath = path.join(root, 'dist', zipName);
fs.rmSync(zipPath, { force: true });
try {
  execFileSync('zip', ['-qr', zipPath, '.'], { cwd: out });
  console.log(`만들었어요: dist/${zipName}`);
} catch {
  console.log('zip 명령이 없어 폴더만 만들었어요. dist/store 를 직접 압축해서 올리세요.');
}
console.log(`서버 주소: ${server}`);
console.log('허용 사이트:', [...new Set(manifest.content_scripts.flatMap((cs) => cs.matches))].join(', '));
