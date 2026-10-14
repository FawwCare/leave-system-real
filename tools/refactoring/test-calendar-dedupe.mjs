// 캘린더 중복 제거(isSameEvent) 테스트. 실행: node tools/refactoring/test-calendar-dedupe.mjs  (대조: KANBAN_SRC=<이전 kanban.js>)
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = fs.readFileSync(process.env.KANBAN_SRC || path.join(ROOT, 'public/features/kanban/kanban.js'), 'utf8').replace(/\r/g, '');
const a = src.indexOf('const cleanStrForDup'); const b = src.indexOf('\n};', src.indexOf('const isSameEvent')) + 3;
const c = {}; vm.createContext(c); vm.runInContext(src.slice(a, b) + '\nthis.isSameEvent = isSameEvent;', c);
const D = '2026-10-28';
const ext = (id, title, extra = {}) => ({ id, title, startDate: D, dueDate: D, isExternal: true, ...extra });
const cases = [
  // 신고된 사례: 같은 날 다른 장소의 구글 캘린더 일정 (시간 09:30 과 '사학'만 같음)
  ['[버그] 나주 사학 vs 여의도 사학 (둘 다 캘린더 일정)', ext('e1', '나주 사학(동현, 동휘, 성진) 09:30~'), ext('e2', '여의도 사학(정호이사, 강현) 09:30~'), false],
  ['같은 장소 다른 시간 캘린더 일정 두 건은 따로', ext('e1', '울산 바른자세 교육 09:30~'), ext('e2', '울산 바른자세 교육 14:00~'), false],
  ['시간만 같은 다른 일정', ext('e1', '수원지방법원 교육 10:00~'), ext('e2', '대구지방법원 상담 10:00~'), false],
  // 진짜 중복: 같은 구글 일정이 두 경로(웹앱·Apps Script)로 다른 키로 저장된 경우
  ['같은 캘린더 일정이 두 번 저장됨 (제목 동일, 키 다름)', ext('abc', '나주 사학(동현, 동휘, 성진) 09:30~'), ext('abc_google_com', '나주 사학(동현, 동휘, 성진) 09:30~'), true],
  // 출장 DB ↔ 캘린더 사본 (이게 원래 퍼지 매칭이 필요한 경우)
  ['출장과 그 캘린더 사본 (ID 태그)', { id: '-Ntrip1', name: '부산지방법원 피지컬케어 교육', startDate: D }, ext('x1', '[확정] 부산지방법원 피지컬케어 교육', { description: '담당자: 성진\n[FaWW 출장연동 ID: -Ntrip1]' }), true],
  ['출장과 캘린더 사본 (ID 없음, [확정] 머리말만 다름)', { id: '-Ntrip2', name: '한국석유공사 본사 울산 바른자세', startDate: D }, ext('x2', '[확정] 한국석유공사 본사 울산 바른자세'), true],
  ['날짜가 다르면 다른 일정', { id: '-Ntrip4', name: '나주 사학', startDate: '2026-10-29' }, ext('x4', '나주 사학'), false],
  ['출장 ↔ 다른 출장의 캘린더 사본(ID 불일치)은 합치지 않음', { id: '-NA', name: '부산 교육', startDate: D }, ext('x5', '[확정] 부산 교육', { description: '[FaWW 출장연동 ID: -NB]' }), false],
];
let fail = 0;
for (const [name, x, y, want] of cases) {
  const got = c.isSameEvent(x, y) || c.isSameEvent(y, x);
  console.log(`${got === want ? 'PASS' : 'FAIL'} ${name} → ${got ? '같은 일정' : '다른 일정'}`); if (got !== want) fail++;
}
console.log(`\n결과: ${cases.length - fail}/${cases.length} 통과`); process.exit(fail ? 1 : 0);
