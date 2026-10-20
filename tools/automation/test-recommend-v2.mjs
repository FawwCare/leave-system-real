// 직원 추천 v1 검수 지적 사항 재현 테스트 (수정 전 실패 → 수정 후 통과 확인용)
// 실행: node tools/automation/test-recommend-v2.mjs   (대조: SRC_DIR=<수정 전 파일 폴더>)
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'public/features/automation'); const ALT = process.env.SRC_DIR;
const ctx = { window: {} }; ctx.window.window = ctx.window; vm.createContext(ctx);
for (const f of ['trip-dates.js', 'staff-roster.js', 'schedule-parse.js', 'staff-recommend.js']) {
  const p = ALT && fs.existsSync(path.join(ALT, f)) ? path.join(ALT, f) : path.join(DIR, f);
  vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
}
const { FawwStaffRecommend: S } = ctx.window;
const res = []; let sec = ''; const check = (n, c, d = '') => { res.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} [${sec}] ${n}${c || !d ? '' : ' :: ' + d}`); };
const users = { 'u-ceo': { displayName: 'min suk kim', approved: true }, 'u-mh': { displayName: '민홍', approved: true }, 'u-jh': { displayName: '이지희', approved: true },
  'u-dh': { displayName: '이동현', approved: true }, 'u-jj': { displayName: '류재진', approved: true }, 'u-kh': { displayName: '나강현', approved: true },
  'u-dw': { displayName: '김동휘', approved: true }, 'u-ci': { displayName: '문채이', approved: true }, 'u-sj': { displayName: '장성진', approved: true } };
const FULL = { users: { status: 'complete' }, trips: { status: 'complete' }, leaves: { status: 'complete' }, tasks: { status: 'complete' }, externalEvents: { status: 'complete' } };
const run = (x) => S.build({ users, coverage: FULL, today: '2026-10-19', trips: {}, leaves: {}, externalEvents: {}, ...x });
const tgt = (m, id) => m.targets.find(t => t.id === id);
const excludedKeys = (t) => t.excluded.map(e => e.key);
const candKeys = (t) => t.candidates.map(c => c.key);

// ---------------------------------------------------------------- 2. 연결 ID 없는 비슷한 일정 사이의 직원 충돌
sec = '중복';
{ // 출장 DB 1건 + 연결 ID 없는 캘린더 일정 1건, 같은 제목·날짜·직원
  const m = run({ trips: { A: { name: '[확정] 수원 교육 (성진)', date: '2026-10-21', status: '확정', requiredPersonnel: 2 } },
                  externalEvents: { e2: { title: '[확정] 수원 교육 (성진)', startDate: '2026-10-21', dueDate: '2026-10-21' } } });
  const a = tgt(m, 'trip:A'), c = tgt(m, 'cal:e2');
  check('연결 ID 없이 제목·날짜만 같은 두 일정 → 같은 직원 충돌을 감지 (심각한 충돌)', a.category === 'serious' && c.category === 'serious', `${a.category} / ${c.category}`);
  check('… 동시에 "같은 일정일 수 있음(연결 ID 없음)" 확인 필요 경고', a.serious.some(s => /연결 ID 없음/.test(s)) && a.notes.some(n => /같은 일정일 수/.test(n)), JSON.stringify(a.serious)); }
{ // 출장 DB 2건, 이름이 포함 관계 (쿠팡 / 쿠팡 이천) — 서로 다른 출장
  const m = run({ trips: { A: { name: '[확정] 쿠팡 (성진)', date: '2026-10-22', status: '확정', requiredPersonnel: 2 }, B: { name: '[확정] 쿠팡 이천 (성진)', date: '2026-10-22', status: '확정', requiredPersonnel: 2 } } });
  check('이름이 비슷한 서로 다른 두 출장에 같은 직원 → 충돌 감지', tgt(m, 'trip:A').category === 'serious' && tgt(m, 'trip:B').category === 'serious'); }
{ // 비슷한 일정이 있는 날, 그 직원은 다른 출장 후보에서도 제외되어야 함
  const m = run({ trips: { A: { name: '[확정] 수원 교육 (성진)', date: '2026-10-21', status: '확정', requiredPersonnel: 2 }, X: { name: '[확정] 대전 교육 (직원 미배정)', date: '2026-10-21', status: '확정', requiredPersonnel: 1 + 1 } },
                  externalEvents: { e2: { title: '[확정] 수원 교육 (성진)', startDate: '2026-10-21', dueDate: '2026-10-21' } } });
  check('같은 날 다른 출장의 후보에서 그 직원 제외', excludedKeys(tgt(m, 'trip:X')).includes('장성진')); }
{ // 연동 ID 로 증명된 경우만 하나로
  const m = run({ trips: { A: { name: '수원 교육', date: '2026-10-21', status: '확정', requiredPersonnel: 2 } },
                  externalEvents: { e1: { title: '[확정] 수원 교육 (성진)', startDate: '2026-10-21', dueDate: '2026-10-21', description: '[FaWW 출장연동 ID: A]' } } });
  check('연동 ID 로 연결된 경우만 하나의 일정 (충돌 아님)', m.targets.length === 1 && tgt(m, 'trip:A').category !== 'serious'); }

// ---------------------------------------------------------------- 3. 안내 괄호가 있는 근무 불가 일정의 직원 식별
sec = '근무불가';
const X = { name: '[확정] 광주 교육 (직원 미배정)', date: '2026-10-22', status: '확정', requiredPersonnel: 2, address: '광주 서구 상무대로 1' };
{ const m = run({ trips: { X }, externalEvents: { e1: { title: '(사내공지) 김동휘 학교 시험', startDate: '2026-10-22', dueDate: '2026-10-22' } } });
  check('"(사내공지) 김동휘 학교 시험" → 김동휘 후보 제외', excludedKeys(tgt(m, 'trip:X')).includes('김동휘'), candKeys(tgt(m, 'trip:X')).join(','));
  check('… "사내공지"를 직원 이름 문제로 보고하지 않음', !JSON.stringify(m).includes('"사내공지"')); }
{ const m = run({ trips: { X }, externalEvents: { e1: { title: '(안내) 쿠팡 상주 근무 (채이)', startDate: '2026-10-20', dueDate: '2026-10-24' }, e2: { title: '[공지] 류재진 연차', startDate: '2026-10-22', dueDate: '2026-10-22' },
    e3: { title: '(사내공지) 강현 쿠팡 파견', startDate: '2026-10-22', dueDate: '2026-10-22' } } });
  const ex = excludedKeys(tgt(m, 'trip:X'));
  check('안내 문구가 붙은 상주·휴가·파견 → 문채이·류재진·나강현 제외', ex.includes('문채이') && ex.includes('류재진') && ex.includes('나강현'), ex.join(',')); }
{ const m = run({ trips: { X }, externalEvents: { e1: { title: '(사내공지) 학교 시험 기간 안내', startDate: '2026-10-22', dueDate: '2026-10-22' } } });
  check('직원이 없는 안내 일정 → 아무도 제외하지 않고 "식별하지 못함" 표시', excludedKeys(tgt(m, 'trip:X')).length === 0 && tgt(m, 'trip:X').limits.some(l => /식별하지 못함/.test(l))); }
{ const m = run({ trips: { X, Y: { name: '[확정] (주)성진기업 방문 (재진)', date: '2026-10-23', status: '확정', requiredPersonnel: 2 }, Z: { name: '[확정] 특강 (김성진 강사)', date: '2026-10-24', status: '확정', requiredPersonnel: 2 } },
                 externalEvents: { e1: { title: '(고객사) 성진기업 시험 운영', startDate: '2026-10-22', dueDate: '2026-10-22' } } });
  check('고객사명 "성진기업"·외부인 "김성진 강사"를 장성진으로 인식하지 않음', !excludedKeys(tgt(m, 'trip:X')).includes('장성진') && tgt(m, 'trip:Y').assigned.join() === '류재진' && !tgt(m, 'trip:Z').assigned.includes('장성진') && tgt(m, 'trip:Z').problems.some(p => /김성진/.test(p))); }

// ---------------------------------------------------------------- 4. 지역·동선
sec = '동선';
check('경기도 광주시 ≠ 광주광역시', S.regionOf('경기도 광주시 오포읍 1') !== S.regionOf('광주광역시 서구 상무대로 1') && S.regionOf('경기 광주시 곤지암읍') !== S.regionOf('광주 북구 용봉동'), `${S.regionOf('경기도 광주시 오포읍 1')} / ${S.regionOf('광주광역시 서구 상무대로 1')}`);
check('구분할 수 없는 "광주"만 있으면 지역 미확정', !S.regionOf('광주 교육') || /확인/.test(String(S.regionOf('광주 교육'))));
{ // 주소 우선: 제목은 부산, 주소는 대구
  const m = run({ trips: { X: { name: '[확정] 부산 지사 교육 (직원 미배정)', date: '2026-10-22', status: '확정', requiredPersonnel: 2, address: '대구 중구 동성로 1' } } });
  check('주소를 제목보다 우선해 지역 판단', /대구/.test(String(tgt(m, 'trip:X').region))); }
{ // 전날 출장: A(같은 광역시, 주소 확인) / B(지역 불명) / C(경기 광주시 — 다른 지역)
  const m = run({ trips: {
      PA: { name: '[확정] 광산구청 교육 (동현)', date: '2026-10-21', status: '확정', requiredPersonnel: 1 + 1, address: '광주광역시 광산구 1' },
      PB: { name: '[확정] 고객사 피지컬케어 (강현)', date: '2026-10-21', status: '확정', requiredPersonnel: 2 },
      PC: { name: '[확정] 곤지암 리조트 (동휘)', date: '2026-10-21', status: '확정', requiredPersonnel: 2, address: '경기도 광주시 곤지암읍 1' },
      X: { name: '[확정] 광주 교육 (직원 미배정)', date: '2026-10-22', status: '확정', requiredPersonnel: 1 + 1, address: '광주광역시 서구 상무대로 1' } } });
  const t = tgt(m, 'trip:X'), c = (k) => t.candidates.find(x => x.key === k);
  const order = t.candidates.map(x => x.key);
  check('같은 지역(주소 확인) 연속 출장 직원이 지역 불명·다른 지역보다 앞섬', order.indexOf('이동현') < order.indexOf('나강현') && order.indexOf('이동현') < order.indexOf('김동휘'), order.join(','));
  check('경기도 광주시 전날 출장을 "같은 지역"으로 보지 않음', !/같은 지역/.test(c('김동휘').reasons.join(' ')), c('김동휘').reasons.join(' | '));
  check('지역 불명 → "동선 확인 필요" 표시, 동선 유리로 확정하지 않음', /동선 확인 필요/.test(c('나강현').reasons.join(' ')) && !/같은 지역/.test(c('나강현').reasons.join(' ')), c('나강현').reasons.join(' | '));
  check('연속 출장 유지와 이동 동선을 구분해 표시', c('이동현').reasons.some(r => /연속 출장/.test(r)) && c('이동현').reasons.some(r => /동선/.test(r)), c('이동현').reasons.join(' | '));
  check('지역이 불명확한 전날 출장만으로 동선 점수를 받지 않음 (지역 확인 직원보다 뒤)', (c('나강현').routeScore || 0) === 0 && (c('이동현').routeScore || 0) > 0, `route 나강현=${c('나강현').routeScore} 이동현=${c('이동현').routeScore}`);
  // v2 최종 보완(v3)으로 정책 변경: 연속 출장 점수는 지역과 무관하게 인정, 동선 점수만 검증된 같은 지역에 한정
  check('다른 지역(경기 광주시)·지역 불명 전날 출장: 동선 점수 없음, 연속 점수만 → 검증된 동선 직원(이동현) 뒤', (c('김동휘').routeScore || 0) === 0 && c('김동휘').continuityScore > 0 && (c('나강현').routeScore || 0) === 0 && c('나강현').continuityScore > 0 && order[0] === '이동현', order.join(',') + ` 김동휘 cont=${c('김동휘').continuityScore}`);
  check('… 연속 출장 사실은 근거로 계속 표시 (점수 없이)', /연속 출장/.test(c('김동휘').reasons.join(' ')) && /동선 확인 필요/.test(c('김동휘').reasons.join(' ')));
  check('거리·시간 수치를 만들지 않음', !/\d+\s*(km|㎞|분|시간)\b/.test(JSON.stringify(t.candidates.map(x => x.reasons)))); }
console.log(`\n결과: ${res.filter(Boolean).length}/${res.length} 통과`); process.exit(res.every(Boolean) ? 0 : 1);
