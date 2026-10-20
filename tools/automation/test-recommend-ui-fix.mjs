// 추천 UI 최종 보완 재현 테스트 — 경고 합침, 지역 상태 문구, 모바일 상단 안내 (가짜 Firebase)
// 준비: cd tools/mobile-audit && npm install → 루트에서 npx vite build / 실행: node tools/automation/test-recommend-ui-fix.mjs
import { openPage, closeAll } from '../mobile-audit/harness.mjs';
const res = []; const check = (n, c, d = '') => { res.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c || !d ? '' : ' :: ' + d}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function seed(page) {
  await page.evaluate(() => {
    const db = firebase.database(); const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    ['류재진:u-jj', '이동현:u-dh', '나강현:u-kh'].forEach(p => { const [n, u] = p.split(':'); db.ref('users/' + u).set({ displayName: n, approved: true }); });
    // 1. 서로 다른 출장(지역 불명)에서 온 두 직원
    db.ref('businessTrips/fa').set({ name: '[확정] 고객사A 상담 (재진)', date: d(8), status: '확정', requiredPersonnel: 2 });
    db.ref('businessTrips/fb').set({ name: '[확정] 고객사B 상담 (동현)', date: d(8), status: '확정', requiredPersonnel: 2 });
    db.ref('businessTrips/fx').set({ name: '[확정] 고객사C 피지컬케어 (직원 미배정)', date: d(9), status: '확정', requiredPersonnel: 2 });
    // 2. 도 단위 주소 (범위가 넓음)
    db.ref('businessTrips/fc').set({ name: '[확정] 수원 사업장 교육 (강현)', date: d(12), status: '확정', requiredPersonnel: 2, address: '경기도 수원시 1' });
    db.ref('businessTrips/fy').set({ name: '[확정] 경기 사업장 교육 (직원 미배정)', date: d(13), status: '확정', requiredPersonnel: 2, address: '경기도' });
  });
  await sleep(600);
}
const openRec = async (page) => { await page.evaluate(() => document.getElementById('tab-btn-automation').click()); await sleep(300); await page.evaluate(() => document.querySelector('#auto-subnav [data-auto-view="recommend"]').click()); await page.waitForFunction(() => document.querySelector('#rec-root .rec-list'), { timeout: 15000 }); await sleep(200); };
const optionChecks = (page, tid) => page.evaluate((tid) => {
  const c = document.querySelector(`#rec-root .rec-item[data-target-id="${tid}"]`); c.open = true;
  return [...c.querySelectorAll('.rec-option')].map(o => {
    const det = o.querySelector('.rec-detail'); det.open = true;
    return { names: o.querySelector('.rec-names').textContent, checks: [...o.querySelectorAll('.rec-line-check')].map(x => x.textContent),
      more: (o.querySelector('.rec-line-more') || {}).textContent || '', detail: det.textContent, fullCount: det.querySelectorAll('.rec-detail-list li').length };
  });
}, tid);

{ const page = await openPage({ userKey: 'admin' }); await seed(page); await openRec(page);
  const o = (await optionChecks(page, 'trip:fx')).find(x => /류재진/.test(x.names) && /이동현/.test(x.names));
  const routeChecks = o ? o.checks.concat(o.more ? [o.more] : []) : [];
  const n = o ? o.checks.length + (o.more ? +((o.more.match(/\d+/) || [0])[0]) : 0) : -1;
  check('1. 서로 다른 출장(고객사A·B)의 이동 경로 경고는 따로 → 확인 칩 2개 이상, 각 출장명 표시', o && n >= 2 && /고객사A/.test(o.checks.join(' ') + o.more + o.detail) && /고객사B/.test(o.checks.join(' ') + o.more + o.detail) && o.checks.filter(c => /고객사A|고객사B/.test(c)).length === 2, JSON.stringify(o));
  check('1-2. 확인 칩 수(표시 + "+n") = 근거 보기의 전체 확인 항목 수', o && n === o.fullCount, JSON.stringify(o && { checks: o.checks, more: o.more, fullCount: o.fullCount }));
  check('1-3. 상세 근거에 두 출장 정보가 각각 남아 있음', o && /고객사A/.test(o.detail) && /고객사B/.test(o.detail));
  const y = (await optionChecks(page, 'trip:fy')).find(x => /나강현/.test(x.names));
  const yAll = y ? y.checks.join(' ') + ' ' + y.detail : '';
  check('2. 도 단위 주소 → "지역 범위가 넓어 확인 필요" (지역 정보 부족 아님)', y && /지역 범위가 넓어 확인 필요/.test(yAll) && !/지역 정보 부족/.test(yAll), yAll.slice(0, 200));
  const x2 = (await optionChecks(page, 'trip:fx'))[0];
  check('2-2. 지역 정보가 없는 출장 → "지역 정보 부족"', /지역 정보 부족/.test(x2.checks.join(' ') + x2.detail), x2.checks.join(' | '));
  const glob = await page.evaluate(() => { const c = document.querySelector('#rec-root .rec-item[data-target-id="trip:fx"]'); c.open = true;
    const visible = [...c.querySelectorAll('.rec-body > .rec-warn-text li')].map(x => x.textContent).join(' | '); const more = (c.querySelector('.rec-more') || {}).textContent || '';
    return { visible, inMore: /명부 중 계정/.test(more) }; });
  check('4. 모든 출장 공통 한계(명부 계정)는 카드마다 반복하지 않고 카드의 "참고"에 보존', !/명부 중 계정/.test(glob.visible) && glob.inMore, JSON.stringify(glob));
  await page.close(); }
{ const page = await openPage({ userKey: 'admin', W: 390, H: 844, scale: 2 }); await seed(page); await openRec(page);
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(200);
  const top = await page.evaluate(() => { const first = document.querySelector('#rec-root .rec-item'); const r = first.getBoundingClientRect(); return { firstTop: Math.round(r.top + window.scrollY), viewport: innerHeight, navH: document.querySelector('.nav-sidebar').getBoundingClientRect().height }; });
  check('3. 모바일: 첫 출장 카드가 첫 화면 안에서 시작 (아래 메뉴 위)', top.firstTop < top.viewport - top.navH, JSON.stringify(top));
  const acc = await page.evaluate(() => { const t = document.getElementById('rec-root').textContent; const d = [...document.querySelectorAll('#rec-root details')].find(x => /계정 확인/.test(x.querySelector('summary') ? x.querySelector('summary').textContent : '')); return { summary: d ? d.querySelector('summary').textContent : null, open: d ? d.open : null }; });
  check('3-2. 직원 계정 문제 → "계정 확인 n명 — 후보 제외" 요약 + 명단은 펼쳐서', acc.summary && /^계정 확인 \d+명 — 후보 제외/.test(acc.summary.trim()) && acc.open === false, JSON.stringify(acc));
  const scope = await page.evaluate(() => { const d = [...document.querySelectorAll('#rec-root details')].find(x => /조회 범위/.test((x.querySelector('summary') || {}).textContent || '')); return { exists: !!d, open: d ? d.open : null, hasHorizon: d ? /동기화 범위/.test(d.textContent) : false }; });
  check('3-3. 조회 범위 기술 설명은 펼쳐서 보기 (내용은 보존)', scope.exists && scope.open === false && scope.hasHorizon, JSON.stringify(scope));
  await page.close(); }
{ const page = await openPage({ userKey: 'admin', W: 390, H: 844, scale: 2, fail: ['leaves'] }); await seed(page); await openRec(page);
  const vis = await page.evaluate(() => { const els = [...document.querySelectorAll('#rec-root *')].filter(e => /조회 불완전/.test(e.textContent) && e.children.length === 0); return els.map(e => { let p = e, hidden = false; while (p && p.id !== 'rec-root') { if (p.tagName === 'DETAILS' && !p.open && p.querySelector('summary') && !p.querySelector('summary').contains(e)) hidden = true; p = p.parentElement; } return { text: e.textContent.slice(0, 60), hidden }; }); });
  check('3-4. 조회 불완전 같은 중요한 경고는 펼치지 않아도 바로 보임', vis.length && vis.some(v => !v.hidden), JSON.stringify(vis));
  await page.close(); }
await closeAll();
console.log(`\n결과: ${res.filter(Boolean).length}/${res.length} 통과`); process.exit(res.every(Boolean) ? 0 : 1);
