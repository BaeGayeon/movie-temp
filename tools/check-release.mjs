// 릴리스 전 점검. 태그 이름(v0.2.0)과 버전 파일들이 같은지, CHANGELOG 에 그 버전 항목이 있는지 확인하고
// 그 항목을 dist/release-notes.md 로 뽑는다(GitHub Release 본문으로 쓴다).
//   node tools/check-release.mjs v0.2.0
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.argv[2] ?? '';
const m = /^v(\d+\.\d+\.\d+)$/.exec(tag);
if (!m) {
  console.error('사용법: node tools/check-release.mjs v0.2.0  (태그는 v 와 숫자 세 개)');
  process.exit(1);
}
const version = m[1];
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const problems = [];

const versions = {
  'extension/manifest.json': JSON.parse(read('extension/manifest.json')).version,
  'server/package.json': JSON.parse(read('server/package.json')).version,
  'server/package-lock.json': JSON.parse(read('server/package-lock.json')).version,
};
for (const [file, v] of Object.entries(versions)) {
  if (v !== version) problems.push(`${file} 의 version 이 ${v} 예요(태그는 ${version}). node tools/bump-version.mjs ${version} 로 맞추세요.`);
}

// CHANGELOG.md 의 "## [버전]" 부터 다음 "## [" 직전까지
const log = read('CHANGELOG.md');
const start = log.search(new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\]`, 'm'));
let notes = '';
if (start < 0) problems.push(`CHANGELOG.md 에 "## [${version}]" 항목이 없어요.`);
else {
  const rest = log.slice(start);
  const next = rest.slice(3).search(/^## \[/m);
  notes = (next < 0 ? rest : rest.slice(0, next + 3)).replace(/^## .*\n/, '').trim();
  if (!notes) problems.push(`CHANGELOG.md 의 ${version} 항목이 비어 있어요.`);
}

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'release-notes.md'), `${notes}\n`);
console.log(`✓ ${tag}: 버전 파일 3개 일치, CHANGELOG 항목 확인. 릴리스 노트: dist/release-notes.md`);
