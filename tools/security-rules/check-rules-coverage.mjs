// 정적 검사 (Emulator 불필요): 실제 database.rules.json 구조 확인
// - 루트에 .read/.write 가 없는지 (전역 허용 금지)
// - 클라이언트 코드가 사용하는 모든 최상위 경로에 규칙이 있는지 (없으면 기본 거부 → 기능 장애)
// - users 를 제외한 업무 경로가 모두 "로그인 + 본인 approved===true" 조건인지
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8')).rules;
const APPROVED = "auth != null && root.child('users/' + auth.uid + '/approved').val() === true";
const files = []; (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(path.join(ROOT, 'public'));
const used = new Set();
const offOnly = new Set();
for (const f of files) for (const line of fs.readFileSync(f, 'utf8').split('\n')) for (const m of line.matchAll(/db\.ref\(\s*[`'"]([A-Za-z_]+)[^)]*\)(\.\w+)?/g)) {
    if (m[2] === '.off') offOnly.add(m[1]); else used.add(m[1]);   // .off() 만 하는 참조는 DB 접근이 아님
}
for (const p of used) offOnly.delete(p);
if (offOnly.size) console.log('INFO .off() 에서만 참조되는 경로 (DB 읽기/쓰기 없음):', [...offOnly].join(', '));
const res = []; const ck = (n, ok, d = '') => { res.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !d ? '' : ' :: ' + d)); };
ck('루트 .read/.write 없음', !('.read' in rules) && !('.write' in rules));
const missing = [...used].filter(p => !(p in rules));
ck(`클라이언트 사용 최상위 경로 ${used.size}개 모두 규칙 존재 (${[...used].sort().join(', ')})`, missing.length === 0, missing.join(','));
const weak = Object.keys(rules).filter(k => k !== 'users' && (rules[k]['.read'] !== APPROVED || rules[k]['.write'] !== APPROVED));
ck('users 외 모든 경로가 로그인+승인 조건 (.read/.write)', weak.length === 0, weak.join(','));
const nested = Object.keys(rules).filter(k => k !== 'users' && Object.keys(rules[k]).some(c => !c.startsWith('.')));
ck('users 외 경로에 하위 규칙으로 권한을 넓히는 항목 없음', nested.length === 0, nested.join(','));
ck('users 전체 .read 가 승인 조건 포함 (2차-1: 미승인 명단 열람 차단)', rules.users['.read'].includes("root.child('users/' + auth.uid + '/approved').val() === true") && rules.users['.read'] !== 'auth != null');
ck('users/$uid .read 는 본인만 (auth.uid === $uid)', rules.users['$uid']['.read'] === 'auth != null && auth.uid === $uid');
ck('users 노드 자체에 .write 없음 (부모 덮어쓰기 차단)', !('.write' in rules.users));
// config.js 의 관리자 명단과 규칙의 관리자 조건이 어긋나지 않는지 (명단 불일치 재발 방지)
const cfg = fs.readFileSync(path.join(ROOT, 'public/js/config.js'), 'utf8');
const uids = JSON.parse(cfg.match(/const ADMIN_UIDS\s*=\s*(\[[^\]]*\])/)[1]);
const emails = JSON.parse(cfg.match(/const ADMIN_EMAILS\s*=\s*(\[[^\]]*\])/)[1]);
const rawRules = fs.readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8');
const missingAdmins = [...uids.map(u => `auth.uid === '${u}'`), ...emails.map(e => `auth.token.email === '${e}' && auth.token.email_verified === true`)].filter(x => !rawRules.includes(x));
ck(`config.js 관리자 ${uids.length + emails.length}명(UID ${uids.length}, 이메일 ${emails.length})이 규칙 관리자 조건에 모두 포함`, missingAdmins.length === 0, missingAdmins.join(' | '));
const adminExprCount = rawRules.split(uids[0]).length - 1;
const fullExpr = rawRules.match(/\(auth\.uid === '[^)]*email_verified === true\)\)/g) || [];
ck(`관리자 판정 ${adminExprCount}곳이 모두 동일한 식 사용`, fullExpr.length === adminExprCount && new Set(fullExpr).size === 1, `${fullExpr.length}/${adminExprCount}, 종류 ${new Set(fullExpr).size}`);
console.log(`\n결과: ${res.filter(Boolean).length}/${res.length} 통과`); process.exit(res.every(Boolean) ? 0 : 1);
