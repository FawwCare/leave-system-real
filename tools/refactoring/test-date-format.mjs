// 날짜 표시 공용 규칙 단위 테스트 (textUtils.js). 기준 '올해'를 고정하기 위해 Date 를 2026-10-08 로 고정한다.
// 실행: node tools/refactoring/test-date-format.mjs
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RealDate = Date;
class FixedDate extends RealDate { constructor(...a) { if (a.length === 0) super(2026, 9, 8, 12, 0); else super(...a); } static now() { return new RealDate(2026, 9, 8, 12, 0).getTime(); } }
const c = { window: {}, Date: FixedDate }; vm.createContext(c);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/services/textUtils.js'), 'utf8'), c);
const cases = [
    ['formatDateShort', ['2026-10-06'], '10/6 (화)'],
    ['formatDateShort', ['2026-10-08'], '10/8 (목)'],
    ['formatDateLong', ['2026-10-08'], '10월 8일 (목)'],
    ['formatDateShort', ['2027-01-05'], '2027/1/5 (화)'],
    ['formatDateLong', ['2025-12-31'], '2025년 12월 31일 (수)'],
    ['formatDateLong', ['2028-02-29'], '2028년 2월 29일 (화)'],
    ['formatDateShort', ['2026-02-30'], '2026-02-30'],
    ['formatDateShort', [''], ''],
    ['formatDateShort', [null], ''],
    ['formatDateShort', ['미정'], '미정'],
    ['formatDateShort', ['2026.10.6'], '10/6 (화)'],
    ['formatDateShort', ['2026-10-06T23:30'], '10/6 (화)'],
    ['formatDateText', ['2026-10-06 to 2026-10-08'], '10/6 (화) ~ 10/8 (목)'],
    ['formatDateText', ['2026-10-06 ~ 2026-10-08', 'long'], '10월 6일 (화) ~ 8일 (목)'],
    ['formatDateText', ['2026-10-30 ~ 2026-11-02', 'long'], '10월 30일 (금) ~ 11월 2일 (월)'],
    ['formatDateText', ['2026-12-30 - 2027-01-02'], '12/30 (수) ~ 2027/1/2 (토)'],
    ['formatDateText', ['2026-10-06 to 2026-10-06'], '10/6 (화)'],
    ['formatDateText', ['다음주 중'], '다음주 중'],
    ['formatDateText', ['2026-10-06 to 언젠가'], '2026-10-06 to 언젠가'],
    ['formatDateTime', [new RealDate(2026, 9, 8, 9, 5).getTime()], '10/8 (목) 09:05'],
    ['formatDateTime', [new RealDate(2026, 9, 8, 14, 30).getTime(), 'long'], '10월 8일 (목) 14:30'],
];
let fail = 0;
for (const [fn, args, want] of cases) {
    const got = c[fn](...args);
    const ok = got === want; if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${fn}(${args.map(a => JSON.stringify(a)).join(', ')}) → ${JSON.stringify(got)}${ok ? '' : '  기대: ' + JSON.stringify(want)}`);
}
// 요일 전수 검증: 2026년 365일 각각을 실제 Date 요일과 대조
let wd = 0; for (let t = new RealDate(2026, 0, 1); t.getFullYear() === 2026; t.setDate(t.getDate() + 1)) {
    const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    if (!c.formatDateShort(iso).endsWith(`(${'일월화수목금토'[t.getDay()]})`)) wd++;
}
console.log(`${wd === 0 ? 'PASS' : 'FAIL'} 2026년 365일 요일 전수 대조 (불일치 ${wd})`); if (wd) fail++;
console.log(`\n결과: ${cases.length + 1 - fail}/${cases.length + 1} 통과`); process.exit(fail ? 1 : 0);
