// Phase 1B 화면 테스트 (가짜 Firebase, 운영 DB 연결 없음)
// 준비: cd tools/mobile-audit && npm install → 루트에서 npx vite build
// 실행: node tools/automation/test-phase1b-ui.mjs   (캡처: OUT 폴더, 기본 /tmp/ui1b)
import { openPage, closeAll } from '../mobile-audit/harness.mjs';
const OUT = process.env.OUT || '/tmp/ui1b'; import fs from 'node:fs'; fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (n, c, d = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c || !d ? '' : ' :: ' + d}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function seed(page) {   // 테스트 데이터 (가짜 DB 에만 기록)
  await page.evaluate(() => {
    const db = firebase.database(); const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    db.ref('businessTrips/x1').set({ name: '<img src=x onerror="window.__xss=1">테스트 출장', date: d(5), status: '확정', assignee: '민홍<script>window.__xss2=1</script>', address: '"><b>주소</b>' });
    db.ref('businessTrips/x2').set({ name: '여의도 사학', date: d(6), status: '확정', assignee: '정호이사' });
    db.ref('businessTrips/x3').set({ name: '날짜 미정 출장', date: '미정', status: '조율중', assignee: '민홍' });
    db.ref('leaves/xl1').set({ id: 'xl1', uid: 'uJY', userName: '박지영', date: d(9), type: 1, subType: '1', status: 'approved', timestamp: 1 });
  });
  await sleep(500);
}
const openTab = (page) => page.evaluate(() => document.getElementById('tab-btn-automation').click());
const waitLoaded = (page) => page.waitForFunction(() => document.querySelector('#tab-automation .ar-cards'), { timeout: 15000 });
const selectTrip = async (page, id) => { await page.evaluate((id) => document.querySelector(`#tab-automation .ar-trip[data-trip-id="${id}"]`).click(), id); await sleep(300); };
const text = (page, sel) => page.evaluate((sel) => (document.querySelector(sel) || {}).textContent || '', sel);

// 1·3·4·6·7·8·10·11 — 관리자
{
  const page = await openPage({ userKey: 'admin' }); await seed(page);
  check('1. 관리자: 자동화 관리 메뉴 표시', await page.evaluate(() => getComputedStyle(document.getElementById('tab-btn-automation')).display !== 'none'));
  const w0 = await page.evaluate(() => window.__dbWrites || 0);
  await openTab(page); await waitLoaded(page);
  const cards = await page.evaluate(() => [...document.querySelectorAll('#tab-automation .ar-card')].map(c => c.textContent.replace(/\s+/g, ' ').trim()));
  check('4-1. 요약 카드 5개 (출장 수·검토 필요·충돌·담당자 확인·조회 상태)', cards.length === 5 && /데이터 조회 상태/.test(cards[4]), cards.join(' | '));
  check('4-1. 조회 기간·마지막 조회 시각 표시', /조회 기간 .+ · 마지막 조회 .+/.test(await text(page, '#tab-automation .ar-meta')));
  await selectTrip(page, 'b6');
  const b6 = await page.evaluate(() => [...document.querySelectorAll('#ar-detail tbody tr')].map(tr => tr.textContent.replace(/\s+/g, ' ').trim()));
  check('7. 확정 출장 + 승인 휴가 → 박지영 "충돌 발견" (휴가 근거 표시)', b6.some(r => /박지영/.test(r) && /충돌 발견/.test(r) && /승인된 종일 휴가/.test(r)), b6.join(' / '));
  check('4. 출장 선택 → 직원별 결과 렌더링 (직원·판정·사유)', b6.length >= 5 && await page.evaluate(() => document.querySelectorAll('#ar-detail thead th').length === 3));
  await selectTrip(page, 'x2');
  check('6. 이름 매칭 실패 → "담당자 확인 필요" + 연결 안 됨 표시', /담당자 확인 필요/.test(await text(page, '#ar-detail .ar-detail-head')) && /정호이사 \(직원과 연결 안 됨\)/.test(await text(page, '#ar-detail .ar-assignees')));
  await selectTrip(page, 'b1');
  check('8. 같은 일정의 캘린더 사본 제외 안내', /복제된 캘린더 일정 1건은 중복으로 보고 제외/.test(await text(page, '#ar-detail')));
  await selectTrip(page, 'x1');
  const xss = await page.evaluate(() => ({ x1: window.__xss, x2: window.__xss2, img: document.querySelectorAll('#tab-automation img').length, b: document.querySelectorAll('#tab-automation b').length, shown: document.getElementById('tab-automation').textContent.includes('<img src=x') }));
  check('11. 사용자 입력 문자열 안전 처리 (스크립트 실행·태그 생성 없음, 글자로 표시)', !xss.x1 && !xss.x2 && xss.img === 0 && xss.b === 0 && xss.shown, JSON.stringify(xss));
  check('날짜 해석 불가 출장 별도 표시', /날짜를 해석할 수 없는 출장/.test(await text(page, '#tab-automation .ar-undated')));
  // 필터·검색·기간·새로고침
  await page.select('#ar-review', 'conflict'); await sleep(200);
  const onlyConflict = await page.evaluate(() => [...document.querySelectorAll('#tab-automation .ar-trip .ar-badge')].every(b => b.textContent === '충돌 발견'));
  await page.select('#ar-review', 'all'); await page.type('#ar-q', '사학'); await sleep(500);
  const searched = await page.evaluate(() => [...document.querySelectorAll('#tab-automation .ar-trip-name')].map(x => x.textContent));
  check('4-4. 충돌 상태 필터·출장명 검색', onlyConflict && searched.length === 1 && searched[0] === '여의도 사학', JSON.stringify(searched));
  await page.evaluate(() => { const q = document.getElementById('ar-q'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(400);
  const reads0 = await page.evaluate(() => (window.__dbReads || []).length);
  await page.evaluate(() => document.getElementById('ar-refresh').click()); await waitLoaded(page); await sleep(300);
  check('4-4. 새로고침 → 다시 조회', await page.evaluate((r) => (window.__dbReads || []).length > r, reads0));
  const w1 = await page.evaluate(() => window.__dbWrites || 0);
  check('10. 화면 진입·선택·필터·검색·새로고침 중 DB 쓰기 0건', w1 === w0, `${w0} → ${w1}`);
  await selectTrip(page, 'b6'); await page.screenshot({ path: `${OUT}/pc.png` });
  check('페이지 오류 없음', page.__errors.length === 0, page.__errors.join(' | '));
  // 3. 로그아웃·계정 전환
  await page.evaluate(() => firebase.auth().__switch('staff')); await sleep(300);
  const afterSwitch = await page.evaluate(() => ({ html: document.getElementById('tab-automation').innerHTML.length, menu: getComputedStyle(document.getElementById('tab-btn-automation')).display, loaded: !!FawwTripReview._state.loaded }));
  check('3. 계정 전환(관리자→직원) → 조회 결과·화면 초기화, 메뉴 숨김', afterSwitch.html === 0 && afterSwitch.menu === 'none' && !afterSwitch.loaded, JSON.stringify(afterSwitch));
  await page.evaluate(() => firebase.auth().__switch('admin')); await sleep(300);
  await page.evaluate(() => firebase.auth().signOut()); await sleep(300);
  const afterLogout = await page.evaluate(() => ({ html: document.getElementById('tab-automation').innerHTML.length, menu: getComputedStyle(document.getElementById('tab-btn-automation')).display, loaded: !!FawwTripReview._state.loaded }));
  check('3. 로그아웃 → 초기화, 메뉴 숨김', afterLogout.html === 0 && afterLogout.menu === 'none' && !afterLogout.loaded, JSON.stringify(afterLogout));
  await page.close();
}
// 2 — 일반 직원
{
  const page = await openPage({ userKey: 'staff' });
  check('2. 일반 직원: 메뉴 미표시', await page.evaluate(() => getComputedStyle(document.getElementById('tab-btn-automation')).display === 'none'));
  const r0 = await page.evaluate(() => (window.__dbReads || []).filter(p => p === 'businessTrips' || p === 'external_events').length);
  await page.evaluate(() => switchTab('tab-automation', null)); await sleep(500);
  const denied = await text(page, '#tab-automation');
  const r1 = await page.evaluate(() => (window.__dbReads || []).filter(p => p === 'businessTrips' || p === 'external_events').length);
  check('2. 직원이 화면 진입 함수를 직접 호출 → 접근 안내만, 데이터 조회 없음', /관리자만 사용할 수 있는 화면/.test(denied) && r1 === r0, `${denied.slice(0, 40)} / reads ${r0}→${r1}`);
  await page.evaluate(() => FawwTripReview.reload()); await sleep(400);
  check('2. 직원이 reload() 직접 호출해도 조회 안 함', await page.evaluate((r) => (window.__dbReads || []).filter(p => p === 'businessTrips').length === r, r1) && /관리자만/.test(await text(page, '#tab-automation')));
  await page.close();
}
// 5 — 조회 실패
{
  const page = await openPage({ userKey: 'admin', fail: ['leaves'] });
  await openTab(page); await waitLoaded(page);
  const banner = await text(page, '#tab-automation .ar-banner'); const card = await page.evaluate(() => [...document.querySelectorAll('#tab-automation .ar-card')].pop().textContent);
  check('5. 조회 실패 안내 (휴가 조회 실패, 상태 카드)', /일부 데이터를 불러오지 못했습니다/.test(banner) && /휴가: 조회 실패/.test(banner) && /조회 실패/.test(card), banner.slice(0, 120));
  await selectTrip(page, 'b6');
  const verdicts = await page.evaluate(() => [...document.querySelectorAll('#ar-detail tbody .ar-badge')].map(b => b.textContent));
  check('5. 데이터 불완전 → "확인된 충돌 없음" 표시 안 함 ("검토 불완전")', !verdicts.includes('확인된 충돌 없음') && verdicts.includes('검토 불완전'), verdicts.join(','));
  await page.close();
}
// 9 — PC·모바일 화면 + 모바일 내비게이션
{
  const page = await openPage({ userKey: 'admin', W: 390, H: 844, scale: 2 }); await seed(page);
  await page.evaluate(() => document.querySelector('.mnav-more-btn').click()); await sleep(300);
  const sheet = await page.evaluate(() => [...document.querySelectorAll('#mnav-sheet .mnav-item')].map(b => b.textContent.trim()));
  check('9. 모바일: 더보기 메뉴에 "자동화 관리" 포함, 기본 메뉴 4개 유지', sheet.some(t => /자동화 관리/.test(t)) && await page.evaluate(() => [...document.querySelectorAll('.vertical-menu .tab-btn')].filter(b => getComputedStyle(b).display !== 'none').length === 5), sheet.join(','));
  await page.evaluate(() => [...document.querySelectorAll('#mnav-sheet .mnav-item')].find(b => /자동화 관리/.test(b.textContent)).click());
  await waitLoaded(page); await page.screenshot({ path: `${OUT}/mobile-list.png` });
  await selectTrip(page, 'b6'); await sleep(600);
  await page.screenshot({ path: `${OUT}/mobile-detail.png` });
  const layout = await page.evaluate(() => { const l = document.querySelector('.ar-list').getBoundingClientRect(), d = document.getElementById('ar-detail').getBoundingClientRect(); return { stacked: d.top >= l.bottom - 1, overflow: document.documentElement.scrollWidth > innerWidth + 1 }; });
  check('9. 모바일: 목록 아래에 검토 결과, 가로 넘침 없음', layout.stacked && !layout.overflow, JSON.stringify(layout));
  await page.close();
}
await closeAll();
console.log(`\n결과: ${results.filter(Boolean).length}/${results.length} 통과`); process.exit(results.every(Boolean) ? 0 : 1);
