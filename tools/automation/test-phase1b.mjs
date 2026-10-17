// FaWW 자동화 Phase 1B 테스트 — 조회 계층(완전성·실패·쓰기 0건) + 화면 모델 (가짜 DB)
// 실행: node tools/automation/test-phase1b.mjs
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'public/features/automation');
const ctx = { window: {}, setTimeout, clearTimeout, Promise, Date }; ctx.window.window = ctx.window; vm.createContext(ctx);
for (const f of ['staff-identity.js', 'trip-dates.js', 'conflict-engine.js', 'trip-review-data.js', 'trip-review-model.js']) vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f });
const { FawwTripReviewData: RD, FawwTripReviewModel: RM } = ctx.window;

const results = []; let section = '';
const check = (name, cond, detail = '') => { results.push({ section, ok: !!cond }); console.log(`${cond ? 'PASS' : 'FAIL'} [${section}] ${name}${cond || !detail ? '' : ' :: ' + detail}`); };

// ---------------------------------------------------------------- 가짜 DB (읽기 질의 + 쓰기 호출 계수)
function fakeDb(tree, opts = {}) {
  const writes = []; const reads = [];
  const snap = (key, v) => ({ key, val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))), numChildren: () => (v && typeof v === 'object' ? Object.keys(v).length : 0),
    forEach(fn) { if (v && typeof v === 'object') for (const k of Object.keys(v).sort()) if (fn(snap(k, v[k])) === true) return true; return false; } });
  class Q {
    constructor(p, q = {}) { this.p = p; this.q = q; }
    orderByKey() { return new Q(this.p, { ...this.q, ok: true }); } orderByChild(c) { return new Q(this.p, { ...this.q, oc: c }); }
    equalTo(v) { return new Q(this.p, { ...this.q, eq: v }); } limitToLast(n) { return new Q(this.p, { ...this.q, lim: n }); }
    once() {
      reads.push(this.p);
      if ((opts.fail || []).includes(this.p)) return Promise.reject(new Error('permission_denied'));
      if ((opts.hang || []).includes(this.p)) return new Promise(() => {});
      let v = tree[this.p] || {};
      let keys = Object.keys(v).sort();
      if (this.q.oc && this.q.eq !== undefined) keys = keys.filter(k => v[k] && v[k][this.q.oc] === this.q.eq);
      if (this.q.lim) keys = keys.slice(-this.q.lim);
      const o = {}; keys.forEach(k => { o[k] = v[k]; });
      return Promise.resolve(snap(this.p, o));
    }
    set() { writes.push(['set', this.p]); return Promise.resolve(); } update() { writes.push(['update', this.p]); return Promise.resolve(); }
    remove() { writes.push(['remove', this.p]); return Promise.resolve(); } push() { writes.push(['push', this.p]); return this; }
    transaction() { writes.push(['transaction', this.p]); return Promise.resolve(); }
  }
  return { ref: (p) => new Q(p), writes, reads };
}
const RANGE = { start: '2026-10-14', end: '2026-11-12' };
const users = { uSJ: { displayName: '장성진', approved: true }, uMH: { displayName: '민홍', approved: true }, uHR: { displayName: '김하람', approved: true }, uJY: { displayName: '박지영', approved: true }, uX: { displayName: '대기자', approved: false } };
const tree = () => ({
  users,
  businessTrips: {
    t01: { name: '부산 교육', startDate: '2026-10-16', endDate: '2026-10-16', date: '2026-10-16', status: '확정', assignee: '장성진', address: '부산', requiredPersonnel: 1 },
    t02: { name: '수원 교육', date: '2026-10-16', status: '확정', assignee: '장성진' },                      // date 만 있는 옛 형식, 장성진 이중 배정
    t03: { name: '장기 파견', startDate: '2026-09-01', endDate: '2026-11-30', status: '확정', assignee: '김하람' }, // 조회 시작 훨씬 전에 시작한 장기 출장
    t04: { name: '여의도 사학', date: '2026-10-20', status: '확정', assignee: '정호이사' },
    t05: { name: '담당 미정', date: '2026-10-21', status: '조율중', assignee: '' },
    t06: { name: '광주 상담', date: '2026-10-22', status: '확정', assignee: '박지영' },
    t07: { name: '대전 특강', date: '2026-10-24', status: '조율중', assignee: '민홍' },
    t08: { name: '날짜 미정 건', date: '미정', status: '조율중', assignee: '민홍' },
    t09: { name: '지난 출장', date: '2026-09-01', status: '확정', assignee: '민홍' },
  },
  leaves: { l1: { uid: 'uJY', userName: '박지영', date: '2026-10-22', type: 1, subType: '1', status: 'approved' } },
  tasks: { k1: { title: '보고서', status: 'todo', assignee: '민홍', dueDate: '2026-10-24' }, k2: { title: '완료', status: 'done', assignee: '민홍', dueDate: '2026-10-24' } },
  external_events: { e1: { title: '[확정] 부산 교육', startDate: '2026-10-16', dueDate: '2026-10-16', description: '[FaWW 출장연동 ID: t01]' }, e2: { title: '대표님 IR', startDate: '2026-10-20', dueDate: '2026-10-20' } },
});

section = '조회';
{ const db = fakeDb(tree()); const loaded = await RD.load(db);
  check('전체 조회 성공 → 출처 5개 모두 complete', ['users', 'trips', 'leaves', 'tasks', 'externalEvents'].every(k => loaded.coverage[k].status === 'complete'), JSON.stringify(loaded.coverage));
  check('업무는 todo·doing 만 (완료 업무 제외)', Object.keys(loaded.data.tasks).join() === 'k1');
  check('쓰기 호출 0건', db.writes.length === 0, JSON.stringify(db.writes)); }
{ const db = fakeDb(tree()); const loaded = await RD.load(db, { limits: { trips: 5 } });
  check('조회 한도 도달 → partial (최신 한도만 사용)', loaded.coverage.trips.status === 'partial' && Object.keys(loaded.data.trips).length === 5 && Object.keys(loaded.data.trips)[0] === 't05');
  check('한도와 정확히 같은 건수는 complete (한도+1 로 확인)', (await RD.load(fakeDb(tree()), { limits: { trips: 9 } })).coverage.trips.status === 'complete'); }
{ const db = fakeDb(tree(), { fail: ['leaves'] }); const loaded = await RD.load(db);
  check('조회 실패 → failed, 다른 출처는 정상', loaded.coverage.leaves.status === 'failed' && /permission_denied/.test(loaded.coverage.leaves.message) && loaded.coverage.trips.status === 'complete'); }
{ const db = fakeDb(tree(), { hang: ['external_events'] }); const t0 = Date.now(); const loaded = await RD.load(db, { timeoutMs: 60 });
  check('응답 없음 → 시간 초과로 failed (멈추지 않음)', loaded.coverage.externalEvents.status === 'failed' && /시간 초과/.test(loaded.coverage.externalEvents.message) && Date.now() - t0 < 2000); }

section = '모델';
const build = async (opts = {}) => RM.build(await RD.load(fakeDb(tree(), opts.db || {}), opts.load || {}), { range: RANGE });
{ const m = await build(); const t = (id) => m.trips.find(x => x.id === id);
  check('기간 안 출장만 목록에 (지난 출장 제외)', !t('t09') && !!t('t01'));
  check('조회 시작 전에 시작한 장기 출장(9/1~11/30)도 포함', !!t('t03'));
  check('date 만 있는 옛 형식 출장도 포함', !!t('t02'));
  check('날짜를 해석할 수 없는 출장은 별도 목록', m.undatedTrips.some(u => u.id === 't08') && !t('t08'));
  check('장성진 같은 날 확정 출장 2건 → 두 출장 모두 "충돌 발견"', t('t01').review === 'conflict' && t('t02').review === 'conflict');
  check('확정 출장 + 승인 종일 휴가 → 충돌 발견 (박지영)', t('t06').review === 'conflict' && t('t06').result.staff.find(s => s.uid === 'uJY').reasons.some(r => r.code === 'leave_full'));
  check('담당자 이름이 직원과 연결 안 됨 → 담당자 확인 필요', t('t04').review === 'assignee_check' && t('t04').unresolved[0].token === '정호이사');
  check('담당자 없음 → 담당자 미지정', t('t05').review === 'unassigned');
  check('출장 자신의 캘린더 사본은 제외 (t01 사본 e1)', t('t01').result.skippedDuplicates.some(d => d.id === 'e1'));
  check('담당자 모르는 외부 일정 → 별도 목록, 충돌로 만들지 않음', t('t04').externalUnattributed.some(u => u.id === 'e2') && t('t04').review !== 'conflict');
  check('요약: 전체·검토 필요·충돌·담당자 확인', m.summary.total === 7 && m.summary.conflicts === 3 && m.summary.assigneeCheck === 2 && m.summary.needsReview >= 6, JSON.stringify(m.summary));
  check('데이터 완전 → 조회 상태 complete', m.dataStatus === 'complete');
  check('검색·필터', RM.filterTrips(m.trips, { query: '교육' }).length === 2 && RM.filterTrips(m.trips, { tripStatus: '조율중' }).every(x => x.status === '조율중') && RM.filterTrips(m.trips, { review: 'conflict' }).length === 3); }
{ const m = await build({ db: { fail: ['tasks'] } }); const t = (id) => m.trips.find(x => x.id === id);
  check('일부 실패해도 확인된 충돌은 유지 (t06 충돌 발견)', m.dataStatus === 'failed' && t('t06').review === 'conflict');
  check('일부 실패 시 근거 없는 출장은 "검토 불완전" (확인된 충돌 없음 아님)', !m.trips.some(x => x.review === 'clear')); }
{ const m = await build({ db: { fail: ['users'] } });
  check('직원 목록 실패 → 모든 출장 검토 불완전', m.dataStatus === 'failed' && m.trips.every(x => x.review === 'incomplete')); }
{ const r = RM.defaultRange(new Date(2026, 9, 14, 23, 50));
  check('기본 조회 기간: 오늘부터 30일 (현지 날짜, 자정 직전에도 같은 날)', r.start === '2026-10-14' && r.end === '2026-11-12', JSON.stringify(r)); }

const fail = results.filter(r => !r.ok).length;
console.log(`\n결과: ${results.length - fail}/${results.length} 통과`); process.exit(fail ? 1 : 0);
