// 직원 추천 1차 테스트 — 명부·제목 해석·추천 규칙 (가짜 데이터, DB 접근 없음)
// 실행: node tools/automation/test-recommend.mjs
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const DIR = path.join(ROOT, 'public/features/automation');
const ctx = { window: {} }; ctx.window.window = ctx.window; vm.createContext(ctx);
for (const f of ['trip-dates.js', 'staff-roster.js', 'schedule-parse.js', 'staff-recommend.js']) vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f });
const { FawwStaffRoster: R, FawwScheduleParse: P, FawwStaffRecommend: S } = ctx.window;
const res = []; let sec = ''; const check = (n, c, d = '') => { res.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} [${sec}] ${n}${c || !d ? '' : ' :: ' + d}`); };
// 테스트 계정 (UID·이메일은 가짜. 이름은 지시서의 내부 직원 명부)
const users = { 'u-ceo': { displayName: 'min suk kim', approved: true }, 'u-mh1': { displayName: '민홍', approved: true }, 'u-jh': { displayName: '이지희', approved: true },
  'u-dh': { displayName: '이동현', approved: true }, 'u-jj': { displayName: '류재진', approved: true }, 'u-kh': { displayName: '나강현', approved: true },
  'u-dw': { displayName: '김동휘', approved: true }, 'u-ci': { displayName: '문채이', approved: true }, 'u-sj': { displayName: '장성진', approved: true },
  'u-ext': { displayName: '김성진', approved: true }, 'u-new': { displayName: '신입', approved: false } };
const FULL = { users: { status: 'complete' }, trips: { status: 'complete' }, leaves: { status: 'complete' }, tasks: { status: 'complete' }, externalEvents: { status: 'complete' } };
const T = '2026-10-19';
const run = (x) => S.build({ users, coverage: FULL, today: T, trips: {}, leaves: {}, externalEvents: {}, ...x });
const tgt = (m, id) => m.targets.find(t => t.id === id);
const keys = (arr) => arr.map(c => c.key).join(',');

sec = '별칭';
const acc = R.matchAccounts(users);
check('재진님 → 류재진 (존칭 제거)', R.resolveToken('재진님').key === '류재진');
check('재진=류재진, 동휘=김동휘, 성진=장성진 (별칭 정확 일치)', R.resolveToken('재진').key === '류재진' && R.resolveToken('동휘').key === '김동휘' && R.resolveToken('성진').key === '장성진');
check('대장=대표 계정 UID (표시 이름 min suk kim)', acc.byKey['대장'].uid === 'u-ceo' && R.resolveToken('대표님').key === '대장');
check('"민 홍" 띄어쓰기 표기도 민홍', R.resolveToken('민 홍').key === '민홍');
check('외부인 "김성진"은 내부 직원 아님 (부분 일치 없음)', R.resolveToken('김성진').status === 'unknown');
check('명부 밖 승인 계정(김성진)은 후보가 아닌 별도 목록', acc.unrostered.some(u => u.uid === 'u-ext'));
const dupAcc = R.matchAccounts({ ...users, 'u-mh2': { displayName: '민 홍', approved: true } });
check('같은 직원 계정 2개(민홍) → 자동 식별 거부(ambiguous)', dupAcc.byKey['민홍'].status === 'ambiguous' && dupAcc.byKey['민홍'].uid === null);
const noJh = R.matchAccounts({ ...users, 'u-jh': { displayName: '이지희', approved: false } });
check('승인 안 된 계정 → 연결 안 함(missing), 미승인 UID 기록', noJh.byKey['이지희'].status === 'missing' && noJh.byKey['이지희'].unapprovedUids.includes('u-jh'));
check('본문 이름 찾기: "김성진 강사"·"성진기업"은 장성진 아님, "김동휘 학교 시험"은 김동휘', R.findNamesInText('김성진 강사 특강').length === 0 && R.findNamesInText('성진기업 방문').length === 0 && R.findNamesInText('김동휘 학교 시험').join() === '김동휘');

sec = '제목';
const p1 = P.parseTitle('[확정][3호차] 광주광역시도시공사 (동휘,성진)');
check('[확정][3호차] … (동휘,성진)', p1.status === '확정' && p1.vehicles.join() === '3호차' && p1.groups[0].tokens.join() === '동휘,성진');
const p2 = P.parseTitle('[확정][1호차][3호차] 고객사 피지컬케어 (재진,동현,강현,동휘,성진)');
check('여러 차량 토큰 + 5명', p2.vehicles.join() === '1호차,3호차' && p2.groups[0].tokens.length === 5);
check('직원 미배정 표기', P.parseTitle('[확정] 고객사 피지컬케어 (직원 미배정)').explicitUnassigned === true);
const p4 = P.parseTitle('[출장] 쿠팡 강현/성진/채이');
check('괄호 없는 슬래시 표기', p4.status === '출장' && p4.groups[0].kind === 'slash' && p4.groups[0].tokens.join() === '강현,성진,채이');
check('괄호 안 슬래시 표기', P.parseTitle('[확정] 쿠팡 (성진/동휘/강현)').groups[0].tokens.join() === '성진,동휘,강현');
check('학교 시험 → 근무 불가 분류', P.classify(P.parseTitle('김동휘 학교 시험')).kind === 'unavailable');
check('쿠팡 상주·파견 → 근무 불가', P.classify(P.parseTitle('[확정] 쿠팡 매니저 파견 (강현)')).kind === 'unavailable' && P.classify(P.parseTitle('쿠팡 상주 근무 (채이)')).kind === 'unavailable');
check('요가·필라테스·명상 → 특수 강의', P.classify(P.parseTitle('[확정] 고객사 요가 클래스')).kind === 'special_lecture');
check('불명확한 자유 형식 → 분류 확인 필요(unknown), 원본 보존', P.classify(P.parseTitle('김사장님 저녁')).kind === 'unknown' && P.parseTitle('  김사장님 저녁').raw === '  김사장님 저녁');
check('"(주)휴노" 같은 괄호는 이름 묶음으로 보지 않음', P.parseTitle('(주)휴노 상담 (재진)').groups.length === 1);

sec = '추천';
{ const m = run({ trips: { A: { name: '[확정] 부산 교육 (성진)', date: '2026-10-20', status: '확정', requiredPersonnel: 2, address: '부산' }, B: { name: '[확정] 수원 교육 (성진)', date: '2026-10-20', status: '확정', requiredPersonnel: 1 } } });
  check('같은 직원 같은 날 확정 출장 2건(시간 무관) → 심각한 충돌', tgt(m, 'trip:A').category === 'serious' && /장성진: 확정 출장/.test(tgt(m, 'trip:A').serious[0])); }
{ const m = run({ trips: { A: { name: '[확정] 대구 교육 (성진)', date: '2026-10-20', status: '확정', requiredPersonnel: 2, address: '대구' }, B: { name: '[확정] 부산 교육 (성진)', date: '2026-10-21', status: '확정', requiredPersonnel: 2, address: '부산' } } });
  check('연속된 다른 날짜 출장은 충돌 아님', tgt(m, 'trip:A').category !== 'serious' && tgt(m, 'trip:B').category !== 'serious'); }
{ const m = run({ trips: { L: { name: '[확정] 장기 (동휘)', startDate: '2026-10-20', endDate: '2026-10-23', status: '확정', requiredPersonnel: 2 }, X: { name: '[확정] 광주 (동현)', date: '2026-10-22', status: '확정', requiredPersonnel: 2 } } });
  check('여러 날 출장은 모든 날짜 점유 → 중간 날짜 후보에서 제외', tgt(m, 'trip:X').excluded.some(e => e.key === '김동휘')); }
{ const m = run({ trips: { X: { name: '[확정] 광주 (동현)', date: '2026-10-22', status: '확정', requiredPersonnel: 3 } },
    leaves: { l1: { uid: 'u-jj', userName: '류재진', date: '2026-10-22', type: 1, status: 'approved' }, l2: { uid: 'u-kh', date: '2026-10-22', type: 0.5, subType: '0.5am', status: 'approved' }, l3: { uid: 'u-ci', date: '2026-10-22', type: 1, status: 'pending' } },
    externalEvents: { e1: { title: '김동휘 학교 시험', startDate: '2026-10-22', dueDate: '2026-10-22' }, e2: { title: '쿠팡 상주 (성진)', startDate: '2026-10-20', dueDate: '2026-10-24' }, e3: { title: '[조율중] 대전 상담 (지희)', startDate: '2026-10-22', dueDate: '2026-10-22' }, e4: { title: '주간 회의 (민홍)', startDate: '2026-10-22', dueDate: '2026-10-22' } } });
  const t = tgt(m, 'trip:X'), ex = keys(t.excluded), cand = (k) => t.candidates.find(c => c.key === k);
  check('승인 종일 휴가·학교 시험·쿠팡 상주 → 후보 제외', /류재진/.test(ex) && /김동휘/.test(ex) && /장성진/.test(ex), ex);
  check('반차·승인 대기 휴가 → 후보 유지 + 주의', cand('나강현') && cand('나강현').cautions.length && cand('문채이') && cand('문채이').cautions.length);
  check('조율 중 일정 → 후보 유지 + 경고', cand('이지희') && /조율 중/.test(cand('이지희').cautions[0].why));
  check('짧은 사내 회의 → 차단하지 않고 근거 부족 주의', cand('민홍') && /회의/.test(cand('민홍').cautions[0].why)); }
{ const m = run({ trips: { X: { name: '[확정][1호차] 광주 (동현,강현)', date: '2026-10-22', status: '확정', requiredPersonnel: 3 } } });
  const t = tgt(m, 'trip:X');
  check('필요 3명 중 2명 배정 → 1명만 추천, 기존 2명 유지·중복 추천 없음', t.need === 1 && t.recommendations.length === 3 && t.recommendations.every(r => r.members.length === 1 && !['이동현', '나강현'].includes(r.members[0].key)) && t.assigned.join() === '이동현,나강현'); }
{ const m = run({ trips: { X: { name: '[확정] 광주 (동현)', date: '2026-10-22', status: '확정', requiredPersonnel: 1, author: 'Gmail 자동 등록' }, Y: { name: '[확정] 대전 (강현)', date: '2026-10-23', status: '확정' } },
                 externalEvents: { c1: { title: '[확정] 고객사 피지컬케어 (재진)', startDate: '2026-10-24', dueDate: '2026-10-24' } } });
  check('필요 인원 1 기록 → 미확인(기본값 가능성), 자동 1명 가정 안 함', tgt(m, 'trip:X').required.known === false && tgt(m, 'trip:X').need === null && tgt(m, 'trip:X').recommendations.length === 0 && /기본값/.test(tgt(m, 'trip:X').required.note));
  check('필요 인원 기록 없음 / 캘린더 수동 일정 → 미확인, 후보 순위만', tgt(m, 'trip:Y').required.known === false && tgt(m, 'cal:c1').required.known === false && tgt(m, 'cal:c1').candidates.length > 0); }
{ const m = run({ trips: { MON: { name: '[확정] 대구 교육 (성진,동휘)', date: '2026-10-19', status: '확정', requiredPersonnel: 2, address: '대구 중구' }, TUE: { name: '[확정] 부산 교육 (직원 미배정)', date: '2026-10-20', status: '확정', requiredPersonnel: 2, address: '부산 해운대구' } },
                 leaves: {} });
  const t = tgt(m, 'trip:TUE'), cd = (k) => t.candidates.find(x => x.key === k);
  // v2 최종 보완(v3): 연속 출장 유지는 지역이 달라도 인정, 대구→부산 동선은 거리 근거가 없어 '확인 필요'(동선 점수 없음)
  check('연속 출장(대구→부산) 직원 조합 우선 추천 + 근거 (연속 인정, 동선 확인 필요)', t.recommendations[0] && t.recommendations[0].members.map(x => x.key).sort().join() === '김동휘,장성진' && ['김동휘', '장성진'].every(k => /연속 출장: 전날 확정 출장/.test(cd(k).reasons.join(' ')) && /동선 확인 필요/.test(cd(k).reasons.join(' ')) && cd(k).routeScore === 0 && cd(k).continuityScore > 0), JSON.stringify(cd('김동휘').reasons));
  check('지역이 다르면 거리를 만들지 않음 ("거리·시간 미확인", 동선 확인 필요)', cd('김동휘').reasons.some(r => /거리·시간 미확인/.test(r) && /동선 확인 필요/.test(r)) && !/km|분 소요/.test(JSON.stringify(t)));
  const m2 = run({ trips: { A: { name: '[확정] 부산 교육 (직원 미배정)', date: '2026-10-20', status: '확정', requiredPersonnel: 1 + 1 } }, });
  const order = m2.targets[0].recommendations.map(r => keys(r.members));
  check('출장 횟수 균형만으로 최상위 정하지 않음 (연속 근거 없으면 동점 → 보조 기준)', order.length === 3); }
{ const m = run({ trips: { A: { name: '부산 교육', date: '2026-10-20', status: '확정', requiredPersonnel: 2 } },
                 externalEvents: { e1: { title: '[확정] 부산 교육 (성진,동휘)', startDate: '2026-10-20', dueDate: '2026-10-20', description: '[FaWW 출장연동 ID: A]' }, e2: { title: '[확정] 수원 교육', startDate: '2026-10-21', dueDate: '2026-10-21' } },
                 trips2: null });
  check('출장과 연결 ID 있는 캘린더 일정 → 하나로 합침 (캘린더 제목의 배정 사용)', m.targets.filter(t => /부산/.test(t.raw)).length === 1 && tgt(m, 'trip:A').src === 'trip+calendar' && tgt(m, 'trip:A').assigned.slice().sort().join() === '김동휘,장성진'); }
{ const m = run({ trips: { A: { name: '[확정] 수원 교육 (성진)', date: '2026-10-21', status: '확정', requiredPersonnel: 2 } }, externalEvents: { e2: { title: '[확정] 수원 교육 (성진)', startDate: '2026-10-21', dueDate: '2026-10-21' } } });
  const a = tgt(m, 'trip:A'), c = tgt(m, 'cal:e2');
  check('연결 ID 없는 같은 날 같은 이름 → 중복 확정하지 않고 둘 다 표시 + 확인 필요', a && c && a.notes.some(n => /같은 일정일 수/.test(n)) && c.notes.some(n => /같은 일정일 수/.test(n)));
  // v2 검수: 연결 ID 가 없으면 같은 일정이라고 확정하지 않으므로, 같은 직원 같은 날짜는 충돌로 감지하고 확인 필요를 함께 표시
  check('연결 ID 없는 두 일정의 같은 직원 → 충돌 감지 + "연결 ID 없음, 확인 필요"', a.category === 'serious' && c.category === 'serious' && a.serious.some(x => /연결 ID 없음/.test(x))); }
{ const m = S.build({ users, coverage: { ...FULL, trips: { status: 'partial' } }, today: T, trips: { A: { name: '[확정] 부산 (직원 미배정)', date: '2026-10-20', status: '확정', requiredPersonnel: 2 } }, leaves: {}, externalEvents: {} });
  check('출장 300건 등 조회 불완전 → 검토 미완료로 표시', !m.targets[0].reviewComplete && /조회 불완전: trips/.test(m.targets[0].limits.join()));
  const far = run({ trips: { F: { name: '[확정] 먼 미래 (성진)', date: '2027-08-01', status: '확정', requiredPersonnel: 2 } } });
  check('캘린더 동기화 범위(약 6개월) 밖 → 캘린더 미반영 표시', far.targets[0].limits.some(l => /동기화 범위/.test(l))); }
{ const m = run({ trips: { A: { name: '[확정] 광주 (동현)', date: '2026-10-22', status: '확정', requiredPersonnel: 2 } }, externalEvents: { e: { title: '[휴가] 연차', startDate: '2026-10-22', dueDate: '2026-10-22' } } });
  check('근무 불가 일정의 직원 식별 불가 → 전체 검증 완료라고 하지 않음', !m.targets[0].reviewComplete && m.targets[0].limits.some(l => /식별하지 못함/.test(l))); }
{ const m = run({ trips: { A: { name: '[확정] 광주 (동현,김성진)', date: '2026-10-22', status: '확정', requiredPersonnel: 2 }, Y: { name: '[확정] 요가 클래스 (채이)', date: '2026-10-22', status: '확정' }, Z: { name: '[조율중] 대전 (강현)', date: '2026-10-23', status: '조율중', requiredPersonnel: 2 }, OLD: { name: '[확정] 지난 출장 (성진)', date: '2026-10-01', status: '확정', requiredPersonnel: 2 } } });
  check('외부인 이름은 배정 인원에 넣지 않고 확인 필요', tgt(m, 'trip:A').assigned.join() === '이동현' && tgt(m, 'trip:A').problems.some(p => /김성진/.test(p)));
  check('특수 강의·조율중·지난 출장은 추천 대상 아님, 특수 강의 배정 직원은 그날 제외', !tgt(m, 'trip:Y') && !tgt(m, 'trip:Z') && !tgt(m, 'trip:OLD') && tgt(m, 'trip:A').excluded.some(e => e.key === '문채이'));
  check('정렬: 심각한 충돌 → 미배정·부분 → 차량 미배정 → 정상', JSON.stringify(run({ trips: {
      a: { name: '[확정][1호차] 정상 (성진,동휘)', date: '2026-10-25', status: '확정', requiredPersonnel: 2 }, b: { name: '[확정] 차량없음 (재진,동현)', date: '2026-10-25', status: '확정', requiredPersonnel: 2 },
      c: { name: '[확정][2호차] 부족 (강현)', date: '2026-10-24', status: '확정', requiredPersonnel: 2 }, d: { name: '[확정][3호차] 충돌 (채이)', date: '2026-10-26', status: '확정', requiredPersonnel: 1 + 1 }, e: { name: '[확정][4호차] 충돌2 (채이,지희)', date: '2026-10-26', status: '확정', requiredPersonnel: 2 } } }).targets.map(t => t.category))
      === JSON.stringify(['serious', 'serious', 'staffing', 'vehicle', 'ok'])); }
{ const m = run({ trips: { A: { name: '[확정] 고객사 피지컬케어', date: '2026-10-22', status: '확정', requiredPersonnel: 2, assignee: '김민석, 류재진' } } });
  const t = tgt(m, 'trip:A');
  check('괄호 없는 표준 제목 → 직원 미배정 (오류 아님), 메일 담당자는 배정으로 보지 않음', t.assigned.length === 0 && t.need === 2 && t.problems.length === 0 && t.notes.some(n => /미배정으로 봄/.test(n)) && t.notes.some(n => /메일 기록 담당자: 김민석, 류재진/.test(n))); }
{ const m = run({ trips: { MON: { name: '[확정][3호차] 대구 교육 (성진,동휘)', date: '2026-10-19', status: '확정', requiredPersonnel: 2, address: '대구' }, TUE: { name: '[확정] 부산 교육', date: '2026-10-20', status: '확정', requiredPersonnel: 2, address: '부산' } } });
  check('연속 출장 근거에 전날 차량 표기 (같은 차량 연속 사용 검토)', /3호차 사용/.test(tgt(m, 'trip:TUE').candidates.find(x => x.key === '장성진').reasons.join(' '))); }
sec = '안전';
{ const src = ['staff-roster.js', 'schedule-parse.js', 'staff-recommend.js'].map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
  check('추천 모듈에 DB·네트워크·저장 코드 없음', ![/\bdb\.ref/, /firebase\./, /fetch\(/, /XMLHttpRequest/, /localStorage/, /\.set\(/, /\.update\(/, /\.remove\(/, /\.transaction\(/].some(re => re.test(src))); }
console.log(`\n결과: ${res.filter(Boolean).length}/${res.length} 통과`); process.exit(res.every(Boolean) ? 0 : 1);
