// 직원 추천 v3 최종 결정 반영 테스트 — 검증되지 않은 이동을 검증된 것처럼 표현하지 않기, 주의 조건의 '확정 전 검토' 표시
// 실행: node tools/automation/test-recommend-final.mjs   (대조: SRC_DIR=<수정 전 파일 폴더>)
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'public/features/automation'); const ALT = process.env.SRC_DIR;
const ctx = { window: {} }; ctx.window.window = ctx.window; vm.createContext(ctx);
for (const f of ['trip-dates.js', 'staff-roster.js', 'schedule-parse.js', 'staff-recommend.js']) {
  const p = ALT && fs.existsSync(path.join(ALT, f)) ? path.join(ALT, f) : path.join(DIR, f);
  vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
}
const S = ctx.window.FawwStaffRecommend;
const res = []; const check = (n, c, d = '') => { res.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c || !d ? '' : ' :: ' + d}`); };
const users = { a: { displayName: '이동현', approved: true }, b: { displayName: '나강현', approved: true }, c: { displayName: '문채이', approved: true }, d: { displayName: '장성진', approved: true }, e: { displayName: '김동휘', approved: true } };
const FULL = { users: { status: 'complete' }, trips: { status: 'complete' }, leaves: { status: 'complete' }, tasks: { status: 'complete' }, externalEvents: { status: 'complete' } };
const m = S.build({ users, coverage: FULL, today: '2026-10-19', externalEvents: {},
  trips: {
    X: { name: '[확정] 부산 교육 (직원 미배정)', date: '2026-10-21', status: '확정', requiredPersonnel: 2, address: '부산광역시 해운대구 1' },
    SAME: { name: '[확정] 부산 북구 교육 (채이)', date: '2026-10-20', status: '확정', requiredPersonnel: 2, address: '부산광역시 북구 1' },
    JEJU: { name: '[확정] 제주 교육 (강현)', date: '2026-10-20', status: '확정', requiredPersonnel: 2, address: '제주특별자치도 제주시 1' } },
  leaves: { p: { uid: 'a', date: '2026-10-21', type: 1, status: 'pending' }, h: { uid: 'd', date: '2026-10-21', type: 0.5, subType: '0.5pm', status: 'approved' }, k: { uid: 'e', date: '2026-10-21', type: 1, status: 'cancel_requested' } } });
const t = m.targets.find(x => x.id === 'trip:X'), c = (k) => t.candidates.find(x => x.key === k), txt = (k) => c(k).reasons.join(' | ');
const all = JSON.stringify(t);
check('같은 지역 식별: "같은 지역"이지만 실제 이동 시간은 미확인이라고 표시 (짧다고 단정하지 않음)', /같은 지역\(부산.*실제 이동 시간은 미확인/.test(txt('문채이')) && !/동선 유리|가깝|짧|빠르/.test(txt('문채이')), txt('문채이'));
check('제주→부산: 연속 배정 후보로 인정하되 실제 이동 가능 여부는 별도 확인으로 표시', /연속 배정 후보.*실제 이동 가능 여부는 별도 확인/.test(txt('나강현')) && /동선 확인 필요.*미검증/.test(txt('나강현')), txt('나강현'));
check('제주→부산 직원은 자동 제외하지 않음 (후보에 있음)', !!c('나강현') && !t.excluded.some(e => e.key === '나강현'));
check('어디에도 "운영 가능"·"이동 가능합니다" 같은 검증된 표현 없음', !/운영 가능|이동 가능합니다|이동이 가능/.test(all));
check('승인 대기 휴가 → 주의 + "확정 배정 전 검토 필요", 후보 유지', c('이동현') && c('이동현').cautions.some(z => /승인 대기 휴가.*확정 배정 전 검토 필요/.test(z.why)));
check('반차 → 주의 + "확정 배정 전 검토 필요", 후보 유지', c('장성진') && c('장성진').cautions.some(z => /반차.*확정 배정 전 검토 필요/.test(z.why)));
check('취소 대기 휴가 → 주의 + "확정 배정 전 검토 필요"', c('김동휘') && c('김동휘').cautions.some(z => /취소 대기 휴가.*확정 배정 전 검토 필요/.test(z.why)));
const order = t.candidates.map(x => x.key);
check('승인된 순서 유지: 검증된 동선(문채이) > 연속 출장(나강현) > 주의 적음 > 업무량', order[0] === '문채이' && order[1] === '나강현', order.join(','));
console.log(`\n결과: ${res.filter(Boolean).length}/${res.length} 통과`); process.exit(res.every(Boolean) ? 0 : 1);
