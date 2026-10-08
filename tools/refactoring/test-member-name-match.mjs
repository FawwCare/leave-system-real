// 직원 이름 인식 규칙 단위 테스트 (textUtils.js memberMentionIndex / textMentionsMember)
// 실행: node tools/refactoring/test-member-name-match.mjs
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const c = { window: {} }; vm.createContext(c);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/services/textUtils.js'), 'utf8'), c);
const cases = [
    ['민홍', '홍 부산 출장', true], ['민홍', '[출장] 홍', true], ['민홍', '성진, 홍', true], ['민홍', '성진/홍', true],
    ['민홍', '홍님 미팅', true], ['민홍', '홍', true], ['민홍', '민홍 교육', true], ['민홍', '(홍) 텔러스 강의', true],
    ['민홍', '홍보 자료 준비', false], ['민홍', '홍길동 미팅', false], ['민홍', '마케팅홍 회의', false], ['민홍', '성진 출장', false], ['민홍', '', false],
    ['장성진', '성진 출장', true], ['장성진', '장성진', true], ['장성진', '성진님 휴가', true], ['장성진', '민홍 출장', false],
    ['Hong Min', 'meeting with hong min', true], ['Hong Min', 'hong', false],
];
let fail = 0;
for (const [name, text, want] of cases) {
    const got = c.textMentionsMember(text, name);
    console.log(`${got === want ? 'PASS' : 'FAIL'} [${name}] ${JSON.stringify(text)} → ${got}`); if (got !== want) fail++;
}
const idx = c.memberMentionIndex('[출장] 성진, 홍 부산', '민홍');
console.log(`${idx === 9 ? 'PASS' : 'FAIL'} 위치 반환 (보고표 담당자 순서용): ${idx}`); if (idx !== 9) fail++;
console.log(`\n결과: ${cases.length + 1 - fail}/${cases.length + 1} 통과`); process.exit(fail ? 1 : 0);
