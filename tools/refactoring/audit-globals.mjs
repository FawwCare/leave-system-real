// 읽기 전용: 전역 함수 중복 정의, HTML 인라인 핸들러 → 정의 매핑, 정의 없는 호출 후보, 스크립트 로드 순서를 점검한다.
// 사용: node tools/refactoring/audit-globals.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('index.html');

// index.html 의 로컬 스크립트 로드 순서
const loadOrder = [...html.matchAll(/<script[^>]*\ssrc="(\/(?!\/)[^"]+)"/g)].map((m) => m[1]);
console.log('## 로컬 스크립트 로드 순서 (index.html)');
loadOrder.forEach((s, i) => console.log(`${i + 1}. ${s}`));
const loadedFiles = loadOrder.map((s) => 'public' + s);

// 정의 수집 (전체 파일 대상: 중첩 함수는 제외하고 컬럼0 선언 + window.x = )
const defs = new Map(); // name -> [{file,line,kind}]
const add = (name, file, line, kind) => {
  const a = defs.get(name) ?? [];
  a.push({ file, line, kind });
  defs.set(name, a);
};
for (const f of loadedFiles) {
  const t = read(f);
  const lines = t.split('\n');
  lines.forEach((ln, i) => {
    let m = ln.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (m) add(m[1], f, i + 1, 'function');
    m = ln.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
    if (m) add(m[1], f, i + 1, 'variable');
    m = ln.match(/^window\.([A-Za-z_$][\w$]*)\s*=/);
    if (m) add(m[1], f, i + 1, 'window-assign');
  });
}
// 인라인 스크립트(index.html)의 window 재할당
html.split('\n').forEach((ln, i) => {
  const m = ln.match(/window\.([A-Za-z_$][\w$]*)\s*=(?!=)/);
  if (m) add(m[1], 'index.html', i + 1, 'window-assign(inline)');
});

console.log('\n## 같은 이름이 2회 이상 정의된 전역 (마지막 로드된 정의가 유효)');
for (const [n, a] of [...defs].sort()) {
  if (a.length > 1) console.log(`- ${n}: ` + a.map((d) => `${d.file}:${d.line}(${d.kind})`).join(' , '));
}

// 인라인 핸들러 호출
const called = new Map();
for (const m of html.matchAll(/\son(?:click|change|input|keydown|keyup|keypress|submit|focus|blur|dblclick|mouseover|mouseout|dragstart|dragover|drop|dragleave|dragenter)\s*=\s*"([^"]*)"/g)) {
  for (const f of m[1].matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
    called.set(f[1], (called.get(f[1]) ?? 0) + 1);
  }
}
const builtin = new Set(['if', 'function', 'event', 'alert', 'confirm', 'this', 'return', 'typeof', 'parseInt', 'parseFloat', 'setTimeout', 'stopPropagation', 'preventDefault']);
const unresolved = [];
console.log('\n## HTML 인라인 핸들러가 호출하는 함수 → 정의 위치');
for (const [n, c] of [...called].sort()) {
  if (builtin.has(n)) continue;
  const d = defs.get(n);
  if (!d) unresolved.push(n);
  console.log(`- ${n} (x${c}) -> ${d ? d.map((x) => `${x.file}:${x.line}`).join(' , ') : '❌ 로드되는 파일에서 정의를 찾지 못함(동적 정의/HTML 내부 정의 여부 수동 확인 필요)'}`);
}

// 동적 생성 HTML(JS 템플릿 문자열) 내의 inline handler
console.log('\n## JS 템플릿 문자열 안의 onclick 등 호출 함수 (정의 없음 후보만)');
const dyn = new Set();
for (const f of loadedFiles) {
  const t = read(f);
  for (const m of t.matchAll(/\bon(?:click|change|input|keydown|keyup|keypress|submit|dblclick|dragstart|dragover|drop)\s*=\s*\\?["']([^"'`]*)/g)) {
    for (const g of m[1].matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (!builtin.has(g[1]) && !defs.has(g[1])) dyn.add(`${g[1]} (${f})`);
    }
  }
}
[...dyn].sort().forEach((x) => console.log('- ' + x));

// 로드되지 않는 후보 파일
console.log('\n## 로드 경로에 없는 JS 후보');
const all = [];
(function walk(dir) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'tools', 'docs'].includes(e.name)) continue;
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) walk(rel);
    else if (e.name.endsWith('.js')) all.push(rel);
  }
})('.');
for (const f of all.map((x) => x.replace(/^\.\//, ''))) {
  const served = loadedFiles.includes(f);
  const referenced = read('index.html').includes(path.posix.basename(f)) || fs.readFileSync(path.join(root, 'public/js/main.js'), 'utf8').includes(path.posix.basename(f));
  console.log(`- ${f}: ${served ? 'index.html 에서 로드됨' : '로드 안 됨'}${!served && referenced ? ' (이름이 다른 파일에서 언급됨)' : ''}`);
}
if (unresolved.length) console.log('\n미해결 인라인 핸들러 함수:', unresolved.join(', '));
