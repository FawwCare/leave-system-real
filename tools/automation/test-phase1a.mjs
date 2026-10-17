// FaWW 자동화 Phase 1A 테스트 — 직원 식별 · 출장 기간 정규화 · 충돌 판정 (가짜 데이터, DB 접근 없음)
// 실행: node tools/automation/test-phase1a.mjs
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'public/features/automation');
const FILES = ['staff-identity.js', 'trip-dates.js', 'conflict-engine.js'];

// DB·Firebase 가 없는 컨텍스트에서 실행 → 접근하면 ReferenceError 로 드러남
const ctx = { window: {} }; ctx.window.window = ctx.window; vm.createContext(ctx);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f });
const { FawwStaffIdentity: SI, FawwTripDates: TD, FawwConflictEngine: CE } = ctx.window;

const results = []; let section = '';
const check = (name, cond, detail = '') => { results.push({ section, name, ok: !!cond }); console.log(`${cond ? 'PASS' : 'FAIL'} [${section}] ${name}${cond || !detail ? '' : ' :: ' + detail}`); };
const S = (name) => { section = name; };

// ---------------------------------------------------------------- 가짜 데이터
const users = {
  uSJ: { displayName: '장성진', approved: true }, uKSJ: { displayName: '김성진', approved: true },
  uMH: { displayName: '민홍', approved: true }, uHR: { displayName: '김하람', approved: true }, uJY: { displayName: '박지영', approved: true },
  uLee1: { displayName: '이민수', approved: true }, uLee2: { displayName: '이민수', approved: true },
  uNEW: { displayName: '신입사원', approved: false },
};
const aliases = { uSJ: ['Sungjin', '장팀장'], uNEW: ['신입'] };
const FULL = { trips: true, leaves: true, tasks: true, externalEvents: true };
const target = { id: 'T0', name: '부산지방법원 교육', startDate: '2026-10-16', endDate: '2026-10-18', date: '2026-10-16 to 2026-10-18', status: '조율중', assignee: '' };
const run = (extra) => CE.evaluateTripConflicts({ users, aliases, coverage: FULL, targetTrip: target, trips: {}, leaves: {}, tasks: {}, externalEvents: {}, ...extra });
const of = (res, uid) => res.staff.find(s => s.uid === uid);
const codes = (r) => r ? r.reasons.map(x => x.code) : [];

// ---------------------------------------------------------------- 직원 식별
S('식별'); const idx = SI.buildStaffIndex(users, aliases);
const one = (t) => SI.resolveAssignees(t, idx).entries[0];
check('정확한 이름 → UID', one('장성진').status === 'matched' && one('장성진').uid === 'uSJ' && one('장성진').matchType === 'exact');
check('별칭 일치 (주입된 별칭)', one('Sungjin').uid === 'uSJ' && one('Sungjin').matchType === 'alias');
check('2글자 이름의 한 글자 (홍 → 민홍)', one('홍').uid === 'uMH' && one('홍').matchType === 'givenName');
check('성을 뺀 이름이 두 명에 해당 (성진 → 장성진·김성진) → 확정하지 않음', one('성진').status === 'ambiguous' && one('성진').candidates.length === 2);
check('동명이인 (이민수 2명) → 확정하지 않음', one('이민수').status === 'ambiguous');
check('없는 이름 → 매칭 실패', one('홍길동').status === 'unmatched');
check('미승인 직원 이름 → 매칭 실패(미승인 표시)', one('신입사원').status === 'unmatched' && one('신입사원').note === 'unapproved');
check('미승인 직원의 별칭은 무시', one('신입').status === 'unmatched');
const multi = SI.resolveAssignees('장성진, 민홍 / 김하람님', idx);
check('쉼표·슬래시 복수 담당자 + 존칭 제거', multi.uids.join() === 'uSJ,uMH,uHR' && multi.complete);
check('같은 사람 중복 → UID 하나', SI.resolveAssignees('장성진, 장성진, Sungjin', idx).uids.join() === 'uSJ');
check('괄호 설명 제거 (김하람(팀장))', SI.resolveAssignees('김하람(팀장)', idx).uids.join() === 'uHR');
check('빈 담당자 → 해석 결과 없음, complete=false', SI.resolveAssignees('', idx).entries.length === 0 && !SI.resolveAssignees('', idx).complete);
check('본문 언급: 전체 이름이 잡히면 같은 이름 조각으로 다른 사람을 찾지 않음', JSON.stringify(SI.findMentionedStaff('장성진 외부 미팅', idx)) === JSON.stringify({ matched: ['uSJ'], ambiguous: [] }));
check('본문 언급: "홍보" 는 민홍이 아님', SI.findMentionedStaff('홍보 자료 회의', idx).matched.length === 0);

// ---------------------------------------------------------------- 날짜 정규화
S('날짜');
const P = (t) => TD.normalizeTripPeriod(t);
check('단일 날짜 (date)', JSON.stringify(P({ date: '2026-10-16' })) === JSON.stringify({ status: 'ok', start: '2026-10-16', end: '2026-10-16', source: 'date' }));
check('기간 "A to B"', P({ date: '2026-10-16 to 2026-10-18' }).end === '2026-10-18');
check('기간 "A ~ B"', P({ date: '2026-10-16 ~ 2026-10-18' }).end === '2026-10-18');
check('startDate/endDate 우선 (date 와 같을 때)', P({ startDate: '2026-10-16', endDate: '2026-10-18', date: '2026-10-16 to 2026-10-18' }).source === 'fields');
check('startDate 만 있으면 하루짜리', P({ startDate: '2026-10-16' }).end === '2026-10-16');
check('필드와 date 가 다르면 확인 필요(inconsistent)', P({ startDate: '2026-10-16', endDate: '2026-10-16', date: '2026-10-20' }).status === 'inconsistent');
check('없는 날짜(2026-02-30) → invalid', P({ date: '2026-02-30' }).status === 'invalid');
check('종료일이 시작일보다 앞섬 → invalid', P({ startDate: '2026-10-18', endDate: '2026-10-16' }).status === 'invalid');
check('쉼표 목록은 기간으로 추측하지 않음 → invalid', P({ date: '2026-10-14, 2026-10-21' }).status === 'invalid');
check('날짜 없음 → missing', P({ name: 'x' }).status === 'missing' && P({ date: '' }).status === 'missing');
check('점·한 자리 형식 정규화 (2026.1.5 → 2026-01-05)', TD.parseDay('2026.1.5') === '2026-01-05');
check('시간이 붙은 값은 날짜만 (시간대 영향 없음)', TD.parseDay('2026-10-16T23:30:00+09:00') === '2026-10-16' && TD.parseDay('2026-10-16T00:30:00Z') === '2026-10-16');
check('윤년 2028-02-29 유효 / 2026-02-29 무효', TD.parseDay('2028-02-29') === '2028-02-29' && TD.parseDay('2026-02-29') === null);
check('겹침: 경계일 포함', TD.overlaps({ start: '2026-10-16', end: '2026-10-18' }, { start: '2026-10-18', end: '2026-10-20' }) && !TD.overlaps({ start: '2026-10-16', end: '2026-10-18' }, { start: '2026-10-19', end: '2026-10-20' }));

// ---------------------------------------------------------------- 충돌 판정 시나리오 (지시서 7번 목록)
S('판정');
{ const r = run({ trips: { A: { name: '수원 교육', date: '2026-10-16', status: '확정', assignee: '장성진' } } });
  check('1. 동일 날짜 확정 출장 → 충돌', of(r, 'uSJ').level === 'conflict' && codes(of(r, 'uSJ')).includes('trip_confirmed')); }
{ const r = run({ trips: { A: { name: '광주 교육', startDate: '2026-10-17', endDate: '2026-10-20', status: '확정', assignee: '김하람' } } });
  check('2. 여러 날 출장이 일부 겹침 → 충돌', of(r, 'uHR').level === 'conflict'); }
{ const r = run({ trips: { A: { name: '앞날', date: '2026-10-15', status: '확정', assignee: '박지영' }, B: { name: '끝날', date: '2026-10-18 to 2026-10-19', status: '확정', assignee: '민홍' } } });
  check('3. 기간 경계: 하루 전 끝나는 출장은 무관, 종료일 당일 시작은 충돌', of(r, 'uJY').level === 'clear' && of(r, 'uMH').level === 'conflict'); }
{ const r = run({ leaves: { L1: { uid: 'uJY', userName: '박지영', date: '2026-10-17', type: 1, subType: '1', status: 'approved' } } });
  check('4. 승인된 종일 휴가 → 충돌', of(r, 'uJY').level === 'conflict' && codes(of(r, 'uJY')).includes('leave_full')); }
{ const r = run({ leaves: { L1: { uid: 'uJY', date: '2026-10-16', type: 0.5, subType: '0.5am', status: 'approved' }, L2: { uid: 'uHR', date: '2026-10-18', type: 0.5, subType: '0.5pm', status: 'approved' } } });
  check('5. 오전·오후 반차 → 주의 (오전/오후 표기)', of(r, 'uJY').level === 'caution' && /오전/.test(of(r, 'uJY').reasons[0].message) && /오후/.test(of(r, 'uHR').reasons[0].message)); }
{ const r = run({ leaves: { L1: { uid: 'uJY', date: '2026-10-16', type: 1, status: 'pending' }, L2: { uid: 'uHR', date: '2026-10-16', type: 1, status: 'cancel_requested' }, L3: { uid: 'uMH', date: '2026-10-16', type: 1, status: 'rejected' } } });
  check('6. 승인 대기·취소 대기 휴가 → 주의, 반려 휴가 → 무시', of(r, 'uJY').level === 'caution' && codes(of(r, 'uHR')).includes('leave_cancel_pending') && of(r, 'uMH').level === 'clear'); }
{ const r = run({ trips: { A: { name: '대전 상담', date: '2026-10-16', status: '조율중', assignee: '민홍' } } });
  check('7. 조율 중 출장 → 주의', of(r, 'uMH').level === 'caution' && codes(of(r, 'uMH')).includes('trip_tentative')); }
{ const r = run({ trips: { A: { name: '울산 교육', date: '2026-10-16', status: '확정', assignee: '이민수' } } });
  check('8. 동명이인 담당자 → 두 사람 모두 주의, 충돌로 확정하지 않음', of(r, 'uLee1').level === 'caution' && of(r, 'uLee2').level === 'caution' && codes(of(r, 'uLee1')).includes('assignee_ambiguous') && codes(of(r, 'uLee1')).includes('duplicate_name')); }
{ const r = run({ trips: { A: { name: '세종 특강', date: '2026-10-17', status: '확정', assignee: 'Sungjin' } } });
  check('9. 별칭으로 적힌 담당자 → 해당 직원 충돌', of(r, 'uSJ').level === 'conflict'); }
{ const r = run({ trips: { A: { name: '여의도 사학', date: '2026-10-16', status: '확정', assignee: '정호이사' } } });
  check('10. 담당자 매칭 실패 → 전원 주의 + 미해석 목록', r.staff.every(s => s.level !== 'clear') && r.unattributed.some(u => u.code === 'assignee_unmatched' && u.detail === '정호이사')); }
{ const r = run({ trips: { A: { name: '나주 사학', date: '2026-10-16', status: '확정', assignee: '장성진, 민홍' } } });
  check('11. 복수 담당자 → 각각 충돌', of(r, 'uSJ').level === 'conflict' && of(r, 'uMH').level === 'conflict' && of(r, 'uHR').level === 'clear'); }
{ const r = run({ trips: { A: { name: '날짜 없는 출장', status: '확정', assignee: '김하람' } } });
  const r2 = CE.evaluateTripConflicts({ users, aliases, coverage: FULL, targetTrip: { id: 'T9', name: '날짜 없음' }, trips: {}, leaves: {}, tasks: {}, externalEvents: {} });
  check('12. 날짜 누락: 다른 출장 → 담당자 주의 / 검사 대상 → 전원 주의, 누구도 "충돌 없음" 아님', codes(of(r, 'uHR')).includes('trip_period_unknown') && r2.staff.every(s => s.level === 'caution')); }
{ const r = run({ trips: { A: { name: '켄싱턴리조트 하동', date: '2026-10-16', status: '확정', assignee: '장성진' } },
                  externalEvents: { E1: { title: '[확정] 켄싱턴리조트 하동', startDate: '2026-10-16', dueDate: '2026-10-16', description: '담당자: 장성진\n[FaWW 출장연동 ID: A]' },
                                    E2: { title: '박지영 외부 강의', startDate: '2026-10-17', dueDate: '2026-10-17' },
                                    E3: { title: '대표님 IR 미팅', startDate: '2026-10-17', dueDate: '2026-10-17' } } });
  check('13. 외부 캘린더 중복: 출장의 캘린더 사본은 고유 ID 로 제외 (근거 1건만)', of(r, 'uSJ').reasons.length === 1 && r.skippedDuplicates.some(d => d.id === 'E1'));
  check('13-2. 이름이 보이는 외부 일정 → 그 직원만 주의', of(r, 'uJY').level === 'caution' && codes(of(r, 'uJY')).includes('external_event'));
  check('13-3. 사람을 특정할 수 없는 외부 일정 → 목록에만, 다른 직원 판정에 영향 없음', r.unattributed.some(u => u.id === 'E3') && of(r, 'uHR').level === 'clear'); }
{ const r = run({ tasks: { K1: { title: '결과보고서', status: 'todo', assignee: '김하람', dueDate: '2026-10-17' },
                           K2: { title: '강의안 준비', status: 'doing', assignee: '민홍', startDate: '2026-10-10', dueDate: '2026-10-30' },
                           K3: { title: '완료 업무', status: 'done', assignee: '박지영', dueDate: '2026-10-16' } } });
  check('14. 업무 마감일 겹침 → 참고(task_due), 기간 겹침 → 참고(task_overlap), 완료 업무 무시', of(r, 'uHR').level === 'info' && codes(of(r, 'uHR')).includes('task_due') && codes(of(r, 'uMH')).includes('task_overlap') && of(r, 'uJY').level === 'clear'); }
{ const r = run({ coverage: { trips: true, leaves: false, tasks: true, externalEvents: true } });
  const r2 = run({ coverage: undefined });
  check('15. 조회 범위 불완전 → 전원 주의, "충돌 없음" 없음', r.staff.every(s => s.level === 'caution' && codes(s).includes('coverage_incomplete')) && !r.coverage.complete);
  check('15-2. 조회 범위를 명시하지 않으면 불완전으로 간주', r2.staff.every(s => codes(s).includes('coverage_incomplete'))); }

// ---------------------------------------------------------------- 정책·안전성
S('정책');
{ const r = run({});
  const out = JSON.stringify(r);
  check('아무 근거 없는 직원 → "확인된 충돌 없음" (가능·배정 가능 표현 없음)', of(r, 'uJY').label === '확인된 충돌 없음' && !/배정 가능|"available"|가능합니다/.test(out));
  check('미승인 직원은 판정 대상에서 제외', !r.staff.some(s => s.uid === 'uNEW'));
  check('결과 정렬: 높은 등급이 먼저', ['conflict', 'caution', 'info', 'clear'].indexOf(r.staff[0].level) <= ['conflict', 'caution', 'info', 'clear'].indexOf(r.staff[r.staff.length - 1].level)); }
{ const input = { users, aliases, coverage: FULL, targetTrip: target, trips: { A: { name: 'x', date: '2026-10-16', status: '확정', assignee: '장성진' } }, leaves: { L: { uid: 'uJY', date: '2026-10-16', type: 1, status: 'approved' } }, tasks: {}, externalEvents: {} };
  const before = JSON.stringify(input); CE.evaluateTripConflicts(input);
  check('입력 데이터를 바꾸지 않음 (읽기 전용)', JSON.stringify(input) === before); }
{ const src = FILES.map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
  check('모듈에 DB·Firebase·네트워크 접근 코드 없음', !/\bdb\.ref|firebase\.|fetch\(|XMLHttpRequest|localStorage/.test(src)); }

const fail = results.filter(r => !r.ok);
const bySec = {}; results.forEach(r => { bySec[r.section] = bySec[r.section] || [0, 0]; bySec[r.section][r.ok ? 0 : 1]++; });
console.log('\n' + Object.entries(bySec).map(([k, [p, f]]) => `${k} ${p}/${p + f}`).join(' · '));
console.log(`결과: ${results.length - fail.length}/${results.length} 통과`); process.exit(fail.length ? 1 : 0);
