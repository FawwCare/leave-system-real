// 자동화 화면 관리자 판정 테스트 — contact@ 이메일 경로에만 이메일 인증 조건 (UID 경로는 그대로). 가짜 Firebase.
// 준비: cd tools/mobile-audit && npm install → 루트에서 npx vite build / 실행: node tools/automation/test-admin-access-ui.mjs
import { openPage, closeAll } from '../mobile-audit/harness.mjs';
const res = []; const check = (n, c, d = '') => { res.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c || !d ? '' : ' :: ' + d}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function probe(key) {
  const page = await openPage({ userKey: key });
  const r = await page.evaluate(async () => {
    const u = firebase.auth().currentUser;
    const menu = getComputedStyle(document.getElementById('tab-btn-automation')).display !== 'none';
    const fn = FawwTripReview.isAutomationAdmin(u), alias = window.isWorkspaceAutomationAdmin(u);
    switchTab('tab-automation', null); await new Promise(r => setTimeout(r, 400));
    FawwRecommendView.setView('recommend'); await new Promise(r => setTimeout(r, 1500));
    const recItems = document.querySelectorAll('#rec-root .rec-item').length, denied = /관리자만 사용할 수 있는 화면/.test(document.getElementById('ar-root').textContent);
    const reads = (window.__dbReads || []).filter(p => p === 'businessTrips' || p === 'external_events').length;
    return { uid: u && u.uid, verified: u && u.emailVerified, menu, fn, alias, recItems, denied, reads };
  });
  await page.close(); return r;
}
const cases = [
  ['admin', '관리자 UID 1 (이메일 인증됨)', true],
  ['admin1u', '관리자 UID 1 + 이메일 미인증 → UID 판정은 그대로 관리자', true],
  ['admin2', '관리자 UID 2', true],
  ['admin3', 'contact@ + 이메일 인증됨 (관리자 UID 아님)', true],
  ['admin3u', 'contact@ + 이메일 미인증 → 관리자 아님 (Rules 와 일치)', false],
  ['staff', '승인된 일반 직원', false],
  ['pending', '미승인 직원', false],
];
for (const [key, label, expectAdmin] of cases) {
  const r = await probe(key);
  const ok = expectAdmin ? (r.fn && r.alias && r.menu && r.recItems > 0 && !r.denied) : (!r.fn && !r.alias && !r.menu && r.recItems === 0 && r.denied && r.reads === 0);
  check(`${label} → ${expectAdmin ? '접근 허용' : '접근 차단·조회 없음'}`, ok, JSON.stringify(r));
}
await closeAll();
console.log(`\n결과: ${res.filter(Boolean).length}/${res.length} 통과`); process.exit(res.every(Boolean) ? 0 : 1);
