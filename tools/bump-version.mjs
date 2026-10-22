// 확장과 서버의 버전을 한 번에 올린다(둘은 같이 배포하므로 같은 번호를 쓴다).
//   node tools/bump-version.mjs 0.3.0
// - extension/manifest.json 의 version
// - server/package.json 과 server/package-lock.json 의 version
// 그다음 CHANGELOG.md 에 `## [0.3.0] - 날짜` 항목을 쓰고 커밋한다. 자세한 절차는 docs/release.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('사용법: node tools/bump-version.mjs 0.3.0  (숫자 세 개, v 없이)');
  process.exit(1);
}

// manifest 는 서식을 그대로 두려고 문자열에서 첫 version 만 바꾼다
const mPath = path.join(root, 'extension', 'manifest.json');
const manifest = fs.readFileSync(mPath, 'utf8');
if (!/"version": "[^"]*"/.test(manifest)) throw new Error('manifest.json 에서 version 을 찾지 못했어요');
fs.writeFileSync(mPath, manifest.replace(/"version": "[^"]*"/, `"version": "${version}"`));

const writeJson = (file, edit) => {
  const p = path.join(root, file);
  const json = JSON.parse(fs.readFileSync(p, 'utf8'));
  edit(json);
  fs.writeFileSync(p, `${JSON.stringify(json, null, 2)}\n`);
};
writeJson('server/package.json', (j) => (j.version = version));
writeJson('server/package-lock.json', (j) => {
  j.version = version;
  if (j.packages?.['']) j.packages[''].version = version;
});

console.log(`버전을 ${version} 으로 바꿨어요: extension/manifest.json, server/package.json, server/package-lock.json`);
console.log('다음: CHANGELOG.md 에 새 항목 쓰기 → 커밋 → 머지 → 태그 v' + version);
