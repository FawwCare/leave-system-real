// 직원 추천 v2 최종 보완 테스트 — 연속 출장 유지와 이동 동선 분리 + 필수 6개 사례
// 실행: node tools/automation/test-recommend-v3.mjs   (대조: SRC_DIR=<수정 전 파일 폴더>)
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
const cand = (t, k) => t.candidates.find(c => c.key === k);
const keysOf = (combo) => combo.members.map(x => x.key).sort().join(',');
const text = (c) => c ? c.reasons.join(' | ') : '(후보 아님)';

// ---------------------------------------------------------------- 1. 월 대구 → 화 부산
sec = '1.대구→부산';
{ const m = run({ trips: { MON: { name: '[확정][3호차] 대구 교육 (동휘,성진)', date: '2026-10-19', status: '확정', requiredPersonnel: 2, address: '대구광역시 중구 동성로 1' },
                           TUE: { name: '[확정] 부산 교육 (직원 미배정)', date: '2026-10-20', status: '확정', requiredPersonnel: 2, address: '부산광역시 해운대구 1' } } });
  const t = tgt(m, 'trip:TUE');
  check('같은 직원의 연속 배정 가능성을 추천에 반영 (추천 1 = 동휘·성진)', t.recommendations[0] && keysOf(t.recommendations[0]) === '김동휘,장성진', t.recommendations.map(keysOf).join(' / '));
  check('연속 출장 유지 점수는 지역이 달라도 부여', cand(t, '김동휘').continuityScore > 0 && cand(t, '장성진').continuityScore > 0, `${cand(t, '김동휘').continuityScore}`);
  check('대구→부산 이동 동선은 검증 근거가 없어 점수 없음 + "확인 필요"', cand(t, '김동휘').routeScore === 0 && /이동 동선: 대구 → 부산 .*확인 필요/.test(text(cand(t, '김동휘'))), text(cand(t, '김동휘')));
  check('연속 출장 근거에 같은 차량(3호차) 표기', /3호차 사용/.test(text(cand(t, '장성진')))); }

// ---------------------------------------------------------------- 2. 무관한 원거리 출장
sec = '2.원거리';
{ const m = run({ trips: { PJ: { name: '[확정] 제주 연수원 교육 (강현)', date: '2026-10-19', status: '확정', requiredPersonnel: 2, address: '제주특별자치도 제주시 1' },
                           PS: { name: '[확정] 서울 본사 교육 (채이)', date: '2026-10-21', status: '확정', requiredPersonnel: 2, address: '서울특별시 중구 1' },
                           TUE: { name: '[확정] 부산 교육 (직원 미배정)', date: '2026-10-20', status: '확정', requiredPersonnel: 2, address: '부산광역시 해운대구 1' } } });
  const t = tgt(m, 'trip:TUE'), all = JSON.stringify(t.candidates.map(c => c.reasons));
  check('제주→부산·부산→서울을 "동선 유리"로 표시하지 않음', !/동선상 이점 가능/.test(all) && cand(t, '나강현').routeScore === 0 && cand(t, '문채이').routeScore === 0, all.slice(0, 200));
  check('… 다른 지역임을 밝히고 "확인 필요"로 표시, 거리·시간 수치 없음', /제주 .* → 부산 .*확인 필요|제주.*→ 부산.*확인 필요/.test(text(cand(t, '나강현'))) && !/\d+\s*(km|㎞|분|시간)\b/.test(all), text(cand(t, '나강현'))); }

// ---------------------------------------------------------------- 3. 지역 불명 연속 출장
sec = '3.지역불명';
{ const m = run({ trips: { P: { name: '[확정] 고객사 피지컬케어 (동현)', date: '2026-10-19', status: '확정', requiredPersonnel: 2 },
                           TUE: { name: '[확정] 광주 교육 (직원 미배정)', date: '2026-10-20', status: '확정', requiredPersonnel: 2 } } });
  const c = cand(tgt(m, 'trip:TUE'), '이동현');
  check('연속 출장 근거는 인정 (연속 점수 있음)', c.continuityScore > 0 && /연속 출장: 전날/.test(text(c)), text(c));
  check('이동 동선은 "확인 필요(지역 정보 부족)"로 구분, 동선 점수 없음', c.routeScore === 0 && /이동 동선 확인 필요 \(지역 정보 부족\)/.test(text(c)) && !/동선상 이점 가능/.test(text(c)), text(c)); }

// ---------------------------------------------------------------- 4. 경기도 광주시 ≠ 광주광역시
sec = '4.광주';
check('지역 키가 다름', S.regionOf('경기도 광주시 오포읍 1') === '경기 광주시' && S.regionOf('광주광역시 서구 1') === '광주광역시' && S.regionOf('광주 북구 1') === '광주광역시', `${S.regionOf('경기도 광주시 오포읍 1')} / ${S.regionOf('광주광역시 서구 1')}`);
{ const m = run({ trips: { P: { name: '[확정] 곤지암 리조트 (동휘)', date: '2026-10-19', status: '확정', requiredPersonnel: 2, address: '경기도 광주시 곤지암읍 1' },
                           X: { name: '[확정] 광주 교육 (직원 미배정)', date: '2026-10-20', status: '확정', requiredPersonnel: 2, address: '광주광역시 서구 1' } } });
  const c = cand(tgt(m, 'trip:X'), '김동휘');
  check('경기 광주시 → 광주광역시 연속 출장: 연속 근거는 인정, 같은 지역·동선 유리로 보지 않음', c.continuityScore > 0 && c.routeScore === 0 && !/같은 지역/.test(text(c)), text(c)); }

// ---------------------------------------------------------------- 5. 같은 날 다른 확정 출장 2건
sec = '5.중복배정';
{ const m = run({ trips: { A: { name: '[확정] 대구 교육 (성진)', date: '2026-10-21', status: '확정', requiredPersonnel: 2 }, B: { name: '[확정] 울산 교육 (성진)', date: '2026-10-21', status: '확정', requiredPersonnel: 2 },
                           X: { name: '[확정] 포항 교육 (직원 미배정)', date: '2026-10-21', status: '확정', requiredPersonnel: 2 } } });
  check('같은 직원 중복 배정 → 두 출장 모두 심각한 충돌', tgt(m, 'trip:A').category === 'serious' && tgt(m, 'trip:B').category === 'serious');
  check('같은 날 다른 출장의 후보에서도 제외', tgt(m, 'trip:X').excluded.some(e => e.key === '장성진')); }

// ---------------------------------------------------------------- 6. 학교 시험·휴가·쿠팡 파견
sec = '6.근무불가';
{ const m = run({ trips: { P: { name: '[확정] 대구 교육 (동휘,재진,강현)', date: '2026-10-19', status: '확정', requiredPersonnel: 3 },
                           X: { name: '[확정] 부산 교육 (직원 미배정)', date: '2026-10-20', status: '확정', requiredPersonnel: 2 } },
                  leaves: { l1: { uid: 'u-jj', userName: '류재진', date: '2026-10-20', type: 1, status: 'approved' } },
                  externalEvents: { e1: { title: '(사내공지) 김동휘 학교 시험', startDate: '2026-10-20', dueDate: '2026-10-20' }, e2: { title: '쿠팡 파견 (강현)', startDate: '2026-10-20', dueDate: '2026-10-20' } } });
  const t = tgt(m, 'trip:X'), ex = t.excluded.map(e => e.key);
  check('학교 시험·승인 휴가·쿠팡 파견 직원은 연속 출장이어도 후보 제외 (충돌 검사 우선)', ['김동휘', '류재진', '나강현'].every(k => ex.includes(k)) && !t.recommendations.some(r => r.members.some(x => ['김동휘', '류재진', '나강현'].includes(x.key))), ex.join(',')); }

// ---------------------------------------------------------------- 순서: 검증된 동선 > 연속 출장 > 주의 > 업무량
sec = '순서';
{ const m = run({ trips: {
      PA: { name: '[확정] 광산구청 (동현)', date: '2026-10-19', status: '확정', requiredPersonnel: 2, address: '광주광역시 광산구 1' },          // 같은 지역 검증 → 동선 + 연속
      PB: { name: '[확정] 제주 교육 (강현)', date: '2026-10-19', status: '확정', requiredPersonnel: 2, address: '제주특별자치도 제주시 1' },    // 다른 지역 → 연속만
      X: { name: '[확정] 광주 교육 (직원 미배정)', date: '2026-10-20', status: '확정', requiredPersonnel: 2, address: '광주광역시 서구 1' } } });
  const order = tgt(m, 'trip:X').candidates.map(c => c.key);
  check('검증된 동선(이동현) > 연속 출장만(나강현) > 근거 없음(나머지)', order[0] === '이동현' && order[1] === '나강현', order.join(',')); }
console.log(`\n결과: ${res.filter(Boolean).length}/${res.length} 통과`); process.exit(res.every(Boolean) ? 0 : 1);
