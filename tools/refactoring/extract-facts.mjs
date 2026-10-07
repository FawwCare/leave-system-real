// 읽기 전용 정적 분석 도구: 애플리케이션 소스를 수정하지 않고 사실(DB 경로, 전역 함수, 리스너 등)을 추출한다.
// 사용: node tools/refactoring/extract-facts.mjs [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILES = [
  'public/js/config.js',
  'public/features/kanban/kanban.js',
  'public/features/map.js',
  'public/services/services.js',
  'public/js/main.js',
  'public/features/kanban/mobile-calendar.js',
  'public/services/surveyService.js',
  'index.html',
];

const patterns = {
  dbRef: /(?:db|database|firebase\.database\(\))\.ref\(\s*([^)]*?)\s*\)(?:\s*\.\s*(?:child\([^)]*\)\s*\.\s*)*(set|update|remove|push|on|once|off|transaction|orderByChild|orderByKey|limitToLast|limitToFirst|equalTo)\b)?/g,
  dbWrite: /\.(set|update|remove|push|transaction)\(/g,
  listenerOn: /\.on\(\s*['"](value|child_added|child_changed|child_removed)['"]/g,
  listenerOff: /\.off\(/g,
  setInterval: /setInterval\(/g,
  setTimeout: /setTimeout\(/g,
  mutationObserver: /new MutationObserver/g,
  sortable: /new Sortable\(|Sortable\.create\(/g,
  localStorage: /(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*([^,)]+)/g,
  callable: /httpsCallable\(\s*['"]([^'"]+)['"]/g,
  fetchUrl: /fetch\(\s*([^,)]+)/g,
  addEventListener: /addEventListener\(\s*['"]([\w-]+)['"]/g,
  windowAssign: /window\.([A-Za-z_$][\w$]*)\s*=(?!=)/g,
  storageRef: /storage\.ref\(\s*([^)]*)\)/g,
};

const result = {};
for (const rel of FILES) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) { result[rel] = { missing: true }; continue; }
  const text = fs.readFileSync(abs, 'utf8');
  const entry = { bytes: Buffer.byteLength(text), lines: text.split('\n').length };
  for (const [name, re] of Object.entries(patterns)) {
    const found = new Map();
    for (const m of text.matchAll(re)) {
      const key = (m[1] ?? m[0]).replace(/\s+/g, ' ').slice(0, 120) + (name === 'dbRef' && m[2] ? ` .${m[2]}` : '');
      const line = text.slice(0, m.index).split('\n').length;
      const v = found.get(key) ?? { count: 0, lines: [] };
      v.count++; if (v.lines.length < 8) v.lines.push(line);
      found.set(key, v);
    }
    entry[name] = Object.fromEntries(found);
  }
  // 최상위 함수 선언 (전역 노출 후보)
  entry.topLevelFunctions = [...text.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  entry.topLevelVars = [...text.matchAll(/^(?:let|var|const)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  result[rel] = entry;
}

// HTML 인라인 핸들러에서 호출하는 함수
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const inline = new Map();
for (const m of html.matchAll(/\son(click|change|input|keydown|keyup|keypress|submit|focus|blur|dblclick|mouseover|mouseout)\s*=\s*"([^"]*)"/g)) {
  for (const f of m[2].matchAll(/([A-Za-z_$][\w$.]*)\s*\(/g)) {
    inline.set(f[1], (inline.get(f[1]) ?? 0) + 1);
  }
}
result.__inlineHandlerCalls = Object.fromEntries([...inline].sort());
result.__htmlIds = [...html.matchAll(/\sid\s*=\s*"([^"]+)"/g)].length;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  for (const [file, e] of Object.entries(result)) {
    if (file.startsWith('__')) continue;
    console.log(`\n## ${file} (${e.lines} lines)`);
    for (const k of ['dbRef', 'listenerOn', 'listenerOff', 'setInterval', 'mutationObserver', 'sortable', 'localStorage', 'callable', 'storageRef', 'windowAssign']) {
      const entries = Object.entries(e[k] ?? {});
      if (!entries.length) continue;
      console.log(`  [${k}]`);
      for (const [key, v] of entries) console.log(`    ${key}  x${v.count}  L${v.lines.join(',')}`);
    }
  }
}
