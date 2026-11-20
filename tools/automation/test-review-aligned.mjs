// 출장 배정 검토 — 직원 추천과 같은 규칙 적용 테스트 (운영 화면에서 확인된 상황 재현, 가짜 데이터)
// 실행: node tools/automation/test-review-aligned.mjs   (대조: SRC_DIR=<수정 전 파일 폴더>)
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'public/features/automation'); const ALT = process.env.SRC_DIR;
const ctx = { window: {} }; ctx.window.window = ctx.window; vm.createContext(ctx);
for (const f of ['staff-identity.js', 'trip-dates.js', 'conflict-engine.js', 'trip-review-model.js', 'staff-roster.js', 'schedule-parse.js', 'staff-recommend.js']) {
  const p = ALT && fs.existsSync(path.join(ALT, f)) ? path.join(ALT, f) : path.join(DIR, f);
  vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
}
const RM = ctx.window.FawwTripReviewModel;
const res = []; const check = (n, c, d = '') => { res.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c || !d ? '' : ' :: ' + d}`); };
// 운영 화면에서 보인 계정 표시 이름 그대로 (UID 는 가짜)
const users = { 'u-ceo': { displayName: 'min suk kim', approved: true }, 'u-mh1': { displayName: 'Hong Min', approved: true }, 'u-mh2': { displayName: 'Hong Min', approved: true },
  'u-sj': { displayName: 'sungjin J', approved: true }, 'u-dw': { displayName: '김동휘', approved: true }, 'u-kh': { displayName: '나강현', approved: true },
  'u-jj': { displayName: '류재진', approved: true }, 'u-ci': { displayName: '문채이', approved: true }, 'u-dh': { displayName: '이동현', approved: true }, 'u-jh': { displayName: '이지희', approved: true } };
const C = { status: 'complete' };
const loaded = { fetchedAt: 1, coverage: { users: C, trips: C, leaves: C, tasks: C, externalEvents: C }, data: { users, tasks: {}, leaves: {},
  trips: {
    g1: { name: '광주광역시도시공사(동휘,성진)', date: '2026-10-21', status: '확정', requiredPersonnel: 2, assignee: '김유진', address: '전남광주통합특별시 서구 시청로 26' },
    k1: { name: '한국에너지공단 (지희)', date: '2026-10-21', status: '확정', requiredPersonnel: 8, assignee: '정유림', address: '울산 중구 종가로 323' },
    y1: { name: '영등포종합지원센터', date: '2026-10-22', status: '확정', requiredPersonnel: 10, assignee: '송다혜', address: '서울 영등포구 경인로 775' } },
  externalEvents: {
    c1: { title: '[출장] 쿠팡 (채이/홍/동현,지희/강현)', startDate: '2026-10-20', dueDate: '2026-10-24' },
    c2: { title: '[확정] 전주지방법원 정읍지원 피지컬 케어 (재진)', startDate: '2026-10-21', dueDate: '2026-10-21' } } } };
const m = RM.build(loaded, { range: { start: '2026-10-20', end: '2026-11-18' }, today: '2026-10-20' });
const trip = (n) => m.trips.find(t => t.name.includes(n));
const g = trip('광주광역시도시공사'), k = trip('한국에너지공단'), y = trip('영등포종합지원센터');
const st = (t, key) => t && t.result.staff.find(s => s.uid === key);   // 명부 키로 찾음 (표시 이름과 무관)
check('담당자는 제목 괄호에서 (동휘,성진 → 김동휘·장성진), 메일의 고객사 담당자(김유진)는 배정 아님', g && g.assigned.entries.map(e => e.token).join() === '동휘,성진' && !/김유진/.test(g.assigneeText), g && g.assigneeText);
check('… 메일 기록 담당자는 참고로만 표시', g && (g.notes || []).some(n => /메일 기록 담당자: 김유진/.test(n)));
check('제목에 직원 표기 없는 출장 → "담당자 확인 필요"가 아니라 미배정', y && y.review === 'unassigned', y && y.review);
check('직원 표는 명부의 내부 직원만 (영문 계정 이름 대신 명부 이름)', g && !g.result.staff.some(s => /Hong Min|sungjin J|min suk kim/.test(s.displayName)) && !!st(g, '장성진') && !!st(g, '대장'), g && g.result.staff.map(s => s.displayName).join(','));
check('실제 계정 이름 "sungjin J" → 장성진으로 연결', g && g.result.staff.some(s => s.uid === '장성진' && s.displayName === '성진'));
check('"Hong Min" 계정 2개 → 민홍은 자동 식별 거부(계정 확인 필요), 표에서 제외', m.accountIssues && m.accountIssues.some(p => p.key === '민홍' && p.status === 'ambiguous') && !st(g, '민홍'));
check('캘린더 [출장] 쿠팡(채이·동현·지희·강현) 겹침 → 해당 직원 "충돌 발견" (주의가 아님)', ['문채이', '이동현', '이지희', '나강현'].every(n => st(g, n) && st(g, n).verdict === 'conflict'), g && ['문채이', '이동현', '이지희', '나강현'].map(n => n + '=' + (st(g, n) || {}).verdict).join(','));
check('캘린더 [확정] 전주지방법원(재진) 겹침 → 류재진 "충돌 발견"', st(g, '류재진') && st(g, '류재진').verdict === 'conflict');
check('이지희가 배정된 한국에너지공단 = 같은 날 쿠팡 [출장] → 출장 자체가 "충돌 발견"', k && k.review === 'conflict', k && k.review);
check('겹치는 일정 없는 배정 직원(김동휘·장성진)은 충돌 아님', ['김동휘', '장성진'].every(n => st(g, n) && st(g, n).verdict !== 'conflict'), g && ['김동휘', '장성진'].map(n => n + '=' + (st(g, n) || {}).verdict).join(','));
check('캘린더 수동 등록 출장(전주지방법원)도 검토 목록에 포함', !!trip('전주지방법원'));
check('계정 문제는 검토 한계로 표시(가용성 보장 안 함)', g && (g.result.limits || []).some(l => /명부 중 계정 확인 필요 홍/.test(l)));
check('계정 문제(민홍)는 다른 직원의 판정을 낮추지 않음 → 겹치는 일정 없는 김동휘·장성진은 "확인된 충돌 없음"', ['김동휘', '장성진'].every(n => st(g, n) && st(g, n).verdict === 'clear') && g.review === 'clear', g && ['김동휘', '장성진'].map(n => n + '=' + (st(g, n) || {}).verdict).join(',') + ' review=' + g.review);
{ const m2 = RM.build({ ...loaded, coverage: { ...loaded.coverage, leaves: { status: 'partial' } } }, { range: { start: '2026-10-20', end: '2026-11-18' }, today: '2026-10-20' });
  const g2 = m2.trips.find(t => t.name.includes('광주광역시도시공사'));
  check('… 조회 불완전 같은 진짜 한계는 그대로 "검토 불완전"', g2 && g2.result.staff.find(s => s.uid === '김동휘').verdict === 'incomplete' && g2.review === 'incomplete', g2 && g2.review); }
check('직원은 이름(성 제외)으로 표시: 대장·홍·지희·동현·재진·강현·동휘·채이·성진', (() => { const R = ctx.window.FawwStaffRoster; return R.ROSTER.map(p => p.label).join() === '대장,홍,지희,동현,재진,강현,동휘,채이,성진'; })());
check('"홍" = 민홍 별칭 (이름 묶음 안에서만, "홍보" 같은 본문은 아님)', ctx.window.FawwStaffRoster.resolveToken('홍').key === '민홍' && ctx.window.FawwStaffRoster.findNamesInText('홍보 자료 회의').length === 0);
console.log(`\n결과: ${res.filter(Boolean).length}/${res.length} 통과`); process.exit(res.every(Boolean) ? 0 : 1);
