// 아이콘 부분 글꼴 점검: 코드의 아이콘 자리에 쓰인 이름이 부분 글꼴에 모두 들어 있는지 확인 (없으면 아이콘이 글자로 보임)
// 실행: node tools/fonts/check-icons.mjs   (실패 시: python3 tools/fonts/build-icon-subset.py 로 글꼴 재생성)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '../..');
const included = new Set(JSON.parse(fs.readFileSync(path.join(HERE, 'icons-included.json'), 'utf8')));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = [path.join(ROOT, 'index.html'), path.join(ROOT, 'public/styles/style.css'), ...walk(path.join(ROOT, 'public')).filter(f => f.endsWith('.js'))];
const used = new Map();
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  // <span class="material-symbols-rounded" ...>icon_name</span>, CSS content:'icon', icon/Icon 변수에 넣는 문자열
  const pats = [/material-symbols-rounded[^>]*>\s*([a-z][a-z0-9_]*)\s*</g, /content:\s*'([a-z][a-z0-9_]*)'/g, /(?:icon|Icon)\s*[:=]\s*['"`]([a-z][a-z0-9_]+)['"`]/g];
  for (const re of pats) for (const m of s.matchAll(re)) { if (!used.has(m[1])) used.set(m[1], path.relative(ROOT, f)); }
}
const IGNORE = new Set(['none', 'auto', 'inherit', 'normal']);
const missing = [...used].filter(([n]) => !included.has(n) && !IGNORE.has(n));
console.log(`아이콘 자리에서 찾은 이름 ${used.size}개, 부분 글꼴 포함 ${included.size}개`);
if (missing.length) { console.log('FAIL 부분 글꼴에 없는 아이콘:'); missing.forEach(([n, f]) => console.log(`   ${n}  (${f})`)); process.exit(1); }
console.log('PASS 모든 아이콘이 부분 글꼴에 포함됨');
