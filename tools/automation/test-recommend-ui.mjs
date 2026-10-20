// 직원 추천 1차 화면 테스트 (가짜 Firebase, 운영 DB·Google Calendar 연결 없음)
// 준비: cd tools/mobile-audit && npm install → 루트에서 npx vite build / 실행: node tools/automation/test-recommend-ui.mjs
import { openPage, closeAll } from '../mobile-audit/harness.mjs';
import fs from 'node:fs'; const OUT = process.env.OUT || '/tmp/uirec'; fs.mkdirSync(OUT, { recursive: true });
let document_text = ''; const res = []; const check = (n, c, d = '') => { res.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c || !d ? '' : ' :: ' + d}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function seed(page) {
  await page.evaluate(() => {
    const db = firebase.database(); const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    const U = { 'u-t-jj': '류재진', 'u-t-jh': '이지희', 'u-t-dh': '이동현', 'u-t-kh': '나강현', 'u-t-dw': '김동휘', 'u-t-ci': '문채이' };
    Object.keys(U).forEach(uid => db.ref('users/' + uid).set({ displayName: U[uid], approved: true, email: uid + '@test.invalid' }));
    db.ref('businessTrips/r1').set({ name: '[확정][3호차] 광주광역시도시공사 (동휘,성진)', date: d(3), status: '확정', requiredPersonnel: 3, address: '광주 서구' });
    db.ref('businessTrips/r2').set({ name: '[확정] 고객사 피지컬케어', date: d(4), status: '확정', requiredPersonnel: 1, author: 'Gmail 자동 등록', assignee: '김민석' });
    db.ref('businessTrips/r3').set({ name: '[확정] <img src=x onerror="window.__xss=1">기관 (재진)', date: d(5), status: '확정', requiredPersonnel: 2, address: '"><b>주소</b>' });
    db.ref('external_events/x1').set({ id: 'x1', title: '김동휘 학교 시험', startDate: d(3), dueDate: d(3), isExternal: true });
    db.ref('businessTrips/r5').set({ name: '[확정][2호차] 대구 교육 (재진,동현)', date: d(8), status: '확정', requiredPersonnel: 2, address: '대구광역시 중구 1' });
    db.ref('businessTrips/r6').set({ name: '[확정] 부산 교육 (직원 미배정)', date: d(9), status: '확정', requiredPersonnel: 2, address: '부산광역시 해운대구 1' });
    db.ref('external_events/x2').set({ id: 'x2', title: '[확정] 수동 등록 출장 (강현)', startDate: d(6), dueDate: d(6), isExternal: true });
  });
  await sleep(600);
}
const openRec = async (page) => { await page.evaluate(() => document.getElementById('tab-btn-automation').click()); await sleep(400); await page.evaluate(() => document.querySelector('#auto-subnav [data-auto-view="recommend"]').click()); await page.waitForFunction(() => document.querySelector('#rec-root .rec-list'), { timeout: 15000 }); };
const txt = (page, sel) => page.evaluate((s) => (document.querySelector(s) || {}).textContent || '', sel);

{ const page = await openPage({ userKey: 'admin' }); await seed(page);
  check('관리자(대장 UID): 하위 메뉴 표시', await page.evaluate(() => { document.getElementById('tab-btn-automation').click(); return true; }) && await sleep(300).then(() => page.evaluate(() => !document.getElementById('auto-subnav').hidden)));
  const w0 = await page.evaluate(() => window.__dbWrites || 0);
  await openRec(page);
  const items = await page.evaluate(() => [...document.querySelectorAll('#rec-root .rec-item > summary')].map(s => s.textContent.replace(/\s+/g, ' ').trim()));
  check('오늘 이후 확정 출장 목록 + 정렬 (심각한 충돌 먼저)', items.length >= 4 && /^충돌/.test(items[0]) && /광주광역시도시공사/.test(items[0]), items.join(' | '));
  check('범위 안내는 문제가 없어도 항상 표시 ("조회 범위 기준", 펼치지 않아도 보임)', /조회 범위 기준/.test(await page.evaluate(() => document.querySelector('#rec-root .rec-top > strong').textContent)));
  await page.evaluate(() => document.querySelector('#rec-root .rec-item[data-target-id="trip:r1"]').open = true); await sleep(100);
  const r1 = await txt(page, '#rec-root .rec-item[data-target-id="trip:r1"]');
  const r1opt = await page.evaluate(() => [...document.querySelectorAll('#rec-root .rec-item[data-target-id="trip:r1"] .rec-option')].map(o => ({ names: o.querySelector('.rec-names').textContent, keep: (o.querySelector('.rec-keep') || {}).textContent || '' })));
  check('부분 배정 2/3명 + 1명만 추천 + 기존 2명 유지 표기', /2\/3명/.test(r1) && r1opt.length && r1opt.every(o => !o.names.includes('·') && o.keep === '기존 배정 유지: 김동휘 · 장성진'), JSON.stringify(r1opt.slice(0, 2)));
  check('배정된 김동휘 학교 시험 → 심각한 충돌 사유 표시', /김동휘: 근무 불가 일정\(학교 시험\)/.test(r1));
  check('배정 버튼은 비활성 (다음 단계)', await page.evaluate(() => [...document.querySelectorAll('#rec-root button')].filter(b => /배정/.test(b.textContent)).every(b => b.disabled)));
  await page.evaluate(() => document.querySelector('#rec-root .rec-item[data-target-id="trip:r2"]').open = true);
  const r2 = await txt(page, '#rec-root .rec-item[data-target-id="trip:r2"]');
  check('요청 인원 1 기록 → 미확인, 후보 순서만 (자동 1명 아님), 메일 담당자는 배정 아님', /인원 미확인/.test(r2) && /후보 순서만/.test(r2) && /메일 기록 담당자: 김민석/.test(r2) && /미배정/.test(r2), r2.slice(0, 260));
  const xss = await page.evaluate(() => ({ x: window.__xss, img: document.querySelectorAll('#rec-root img').length, b: document.querySelectorAll('#rec-root b').length, shown: document.getElementById('rec-root').textContent.includes('<img src=x') }));
  check('캘린더·사용자 문자열 안전 렌더링 (태그 생성·스크립트 실행 없음)', !xss.x && xss.img === 0 && xss.shown && await page.evaluate(() => ![...document.querySelectorAll('#rec-root b')].some(b => b.textContent === '주소')), JSON.stringify(xss));
  await page.select('#rec-staff', '나강현'); await sleep(300);
  const byStaff = await page.evaluate(() => [...document.querySelectorAll('#rec-root .rec-item')].map(d => d.getAttribute('data-target-id')));
  check('직원 필터 (배정 또는 추천에 포함된 출장)', byStaff.includes('cal:x2'), byStaff.join(','));
  await page.select('#rec-staff', 'all'); await page.select('#rec-cat', 'req-unknown'); await sleep(300);
  check('사유 필터 (필요 인원 미확인)', await page.evaluate(() => [...document.querySelectorAll('#rec-root .rec-item')].every(d => /미확인/.test(d.querySelector('summary').textContent))));
  await page.select('#rec-cat', 'all');
  // UI 개선 확인
  await page.evaluate(() => document.querySelector('#rec-root .rec-item[data-target-id="trip:r6"]').open = true); await sleep(100);
  const ux = await page.evaluate(() => {
    const card = document.querySelector('#rec-root .rec-item[data-target-id="trip:r6"]');
    const opts = [...card.querySelectorAll('.rec-option')];
    const o1 = opts[0];
    const reasons = [...o1.querySelectorAll('.rec-line-reason')].map(x => x.textContent), checks = [...o1.querySelectorAll('.rec-line-check')].map(x => x.textContent);
    return { n: opts.length, top: o1.classList.contains('rec-option-top'), names: o1.querySelector('.rec-names').textContent, badge: (o1.querySelector('.rec-check-badge') || {}).textContent || '',
      reasons, checks, maxLines: opts.every(o => o.querySelectorAll('.rec-line-reason').length === 1 && o.querySelectorAll('.rec-line-check').length <= 3),
      detailsClosed: opts.every(o => !o.querySelector('.rec-detail').open), detailText: o1.querySelector('.rec-detail').textContent };
  });
  check('추천 1 = 연속 출장 직원(류재진·이동현), 1순위 강조 표시', ux.top && /류재진/.test(ux.names) && /이동현/.test(ux.names), JSON.stringify(ux).slice(0, 200));
  check('두 직원 공통 출장 근거는 한 줄로 (반복 없음, "전날 … 출장 팀")', ux.reasons.length === 1 && /^전날 .+ 출장 팀$/.test(ux.reasons[0]), JSON.stringify(ux.reasons));
  check('공통 차량·이동 경로 확인 칩도 한 번만', ux.checks.filter(c => /2호차/.test(c)).length === 1 && ux.checks.filter(c => /경로 확인/.test(c)).length === 1, JSON.stringify(ux.checks));
  check('기본 화면은 근거 한 줄 + 확인 칩 최대 3개, 상세 근거는 접힘', ux.maxLines && ux.detailsClosed);
  check('상세 근거에 직원별 출장·이동 경로·차량·앞뒤 2주 출장', /앞뒤 2주 \d+건/.test(ux.detailText) && /이동 경로/.test(ux.detailText) && /2호차 연속 사용 가능 여부 확인/.test(ux.detailText));
  check('개발자식 표현 제거 (±14일·균형 참고용·연속 운영 가능·동선 유리·주의 n건 —)', !/±14일|균형 참고용|연속 운영 가능|동선 유리|주의 \d+건 —/.test(document_text = await page.evaluate(() => document.getElementById('rec-root').textContent)));
  check('검증되지 않은 이동을 보장하는 표현 없음', !/이동 가능합니다|이동 시간이 짧|가깝습니다/.test(document_text));
  const side = await page.evaluate(() => ({ inTab: getComputedStyle(document.querySelector('.team-status-sidebar')).display }));
  await page.evaluate(() => { const b = document.querySelector(`[onclick*="switchTab('tab-tasks'"]`); switchTab('tab-tasks', b); }); await sleep(300);
  const sideOut = await page.evaluate(() => getComputedStyle(document.querySelector('.team-status-sidebar')).display);
  await page.evaluate(() => document.getElementById('tab-btn-automation').click()); await sleep(300);
  check('오른쪽 팀 현황 패널: 자동화 관리 탭에서만 숨김, 다른 탭에서는 그대로', side.inTab === 'none' && sideOut !== 'none', JSON.stringify(side) + ' / 다른 탭: ' + sideOut);
  // 캘린더 상세 연결
  await page.evaluate(() => openTripModal('r1', 'x', '', '', '', '')); await sleep(400);
  const tripBox = await page.evaluate(() => { const b = document.querySelector('#tripModal .rec-modal-box'); return b ? b.textContent.slice(0, 200) : null; });
  check('캘린더 출장 상세(#tripModal)에 같은 추천 표시', tripBox && /직원 추천 \(관리자 전용/.test(tripBox) && /광주광역시도시공사/.test(tripBox), tripBox);
  await page.screenshot({ path: `${OUT}/pc-modal.png` });
  await page.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none'); openModal('x2', '[확정] 수동 등록 출장 (강현)', '', '', '', 'external'); }); await sleep(400);
  check('캘린더 외부 일정 상세(#taskModal)에도 표시', /수동 등록 출장/.test(await page.evaluate(() => (document.querySelector('#taskModal .rec-modal-box') || {}).textContent || '')));
  await page.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none'); document.getElementById('tab-btn-automation').click(); }); await sleep(300);
  // 다시 추천 + 갱신 알림
  await page.evaluate(() => firebase.database().ref('businessTrips/r9').set({ name: '[확정] 새 출장 (채이)', date: '2026-12-01', status: '확정', requiredPersonnel: 2 })); await sleep(500);
  const stale = await txt(page, '#rec-root');
  const wMid = await page.evaluate(() => window.__dbWrites || 0);
  await page.evaluate(() => document.getElementById('rec-reload').click()); await page.waitForFunction(() => document.querySelector('#rec-root .rec-list'), { timeout: 15000 }); await sleep(300);
  check('데이터 갱신 시 "다시 추천" 안내 → 다시 추천으로 재계산', /갱신되었습니다/.test(stale) && /새 출장/.test(await txt(page, '#rec-root')) && !/갱신되었습니다/.test(await txt(page, '#rec-root')));
  const w1 = await page.evaluate(() => window.__dbWrites || 0);
  check('화면·필터·모달·다시 추천 중 DB 쓰기 0건 (테스트 데이터 준비용 1건 제외)', w1 - w0 === 1 && w1 === wMid, `${w0} → ${wMid} → ${w1}`);
  await page.screenshot({ path: `${OUT}/pc-list.png` });
  check('페이지 오류 없음', page.__errors.length === 0, page.__errors.join(' | '));
  // 로그아웃·계정 전환
  await page.evaluate(() => firebase.auth().__switch('staff')); await sleep(300);
  const sw = await page.evaluate(() => ({ nav: document.getElementById('auto-subnav').hidden, rec: document.getElementById('rec-root').textContent.length, hiddenRec: document.getElementById('rec-root').hidden, loaded: !!FawwRecommendView._state.loaded }));
  check('관리자→직원 전환: 하위 메뉴 숨김, 추천 결과 제거', sw.nav && sw.rec === 0 && sw.hiddenRec && !sw.loaded, JSON.stringify(sw));
  await page.evaluate(() => firebase.auth().__switch('admin')); await sleep(200); await page.evaluate(() => firebase.auth().signOut()); await sleep(300);
  check('로그아웃: 추천 결과 제거', await page.evaluate(() => !FawwRecommendView._state.loaded && document.getElementById('rec-root').textContent.length === 0 && !document.querySelector('.rec-modal-box')));
  await page.close(); }
for (const [key, label] of [['admin2', '두 번째 관리자 UID'], ['admin3', '관리자 이메일(contact@)로만 일치하는 계정']]) {
  const page = await openPage({ userKey: key }); await seed(page); await openRec(page);
  check(`${label}: 직원 추천 접근 가능`, (await page.evaluate(() => document.querySelectorAll('#rec-root .rec-item').length)) >= 4); await page.close(); }
for (const [key, label] of [['staff', '승인된 일반 직원'], ['pending', '미승인 계정']]) {
  const page = await openPage({ userKey: key }); await seed(page);
  const st = await page.evaluate(async () => {
    const menu = getComputedStyle(document.getElementById('tab-btn-automation')).display;
    switchTab('tab-automation', null); await new Promise(r => setTimeout(r, 300));
    FawwRecommendView.setView('recommend'); await new Promise(r => setTimeout(r, 300));
    try { openTripModal('r1', 'x', '', '', '', ''); } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
    return { menu, nav: document.getElementById('auto-subnav').hidden, recHidden: document.getElementById('rec-root').hidden, recText: document.getElementById('rec-root').textContent.length, box: !!document.querySelector('.rec-modal-box'), loaded: !!FawwRecommendView._state.loaded };
  });
  check(`${label}: 메뉴·하위 메뉴 숨김, 직접 호출해도 추천 화면·캘린더 추천 없음, 조회 안 함`, st.menu === 'none' && st.nav && st.recHidden && st.recText === 0 && !st.box && !st.loaded, JSON.stringify(st));
  await page.close(); }
{ const page = await openPage({ userKey: 'admin', W: 390, H: 844, scale: 2 }); await seed(page);
  await page.evaluate(() => document.querySelector('.mnav-more-btn').click()); await sleep(300);
  await page.evaluate(() => [...document.querySelectorAll('#mnav-sheet .mnav-item')].find(b => /자동화 관리/.test(b.textContent)).click()); await sleep(400);
  await page.evaluate(() => document.querySelector('#auto-subnav [data-auto-view="recommend"]').click()); await page.waitForFunction(() => document.querySelector('#rec-root .rec-list'), { timeout: 15000 });
  await page.evaluate(() => document.querySelector('#rec-root .rec-item').open = true); await sleep(300);
  await page.screenshot({ path: `${OUT}/mobile.png` }); await page.screenshot({ path: `${OUT}/mobile-full.png`, fullPage: true });
  check('모바일: 가로 넘침 없음, 아래 메뉴 유지', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll('.vertical-menu .tab-btn')].filter(b => getComputedStyle(b).display !== 'none').length === 5));
  await page.close(); }
await closeAll();
console.log(`\n결과: ${res.filter(Boolean).length}/${res.length} 통과`); process.exit(res.every(Boolean) ? 0 : 1);
