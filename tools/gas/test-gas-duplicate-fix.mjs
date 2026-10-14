// 중복 출장 재발 방지·정리 도구 테스트 (켄싱턴리조트 하동 사례 재현). 실행: node tools/gas/test-gas-duplicate-fix.mjs
import { world, Y } from './gas-test-world.mjs';
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c || !d ? '' : ' :: ' + d}`); };
const CH = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
const pushId = (ms, tail) => { let s = ''; for (let i = 0; i < 8; i++) { s = CH[ms % 64] + s; ms = Math.floor(ms / 64); } return s + (tail || 'abcdefghijkl'); };
const D = `${Y}-10-16`; const kst = (iso) => new Date(iso + 'T00:00:00+09:00');
const july = Date.UTC(Y, 6, 23, 1, 21); const cutover = Date.now() - 60 * 1000;
const manualKey = pushId(july, 'ManualTripB1');
const seedDb = () => ({
  gmailSyncState: { cutover, messages: {} },
  businessTrips: { [manualKey]: { name: '켄싱턴리조트 하동', date: D, startDate: D, endDate: D, assignee: '이재원', contact: '+82-10-4702-5858', address: '켄싱턴리조트 하동', status: '확정', author: '대장' } },
});
const addWebEvent = (w, key) => w.cal.createAllDayEvent('[출장] 켄싱턴리조트 하동', kst(D), new Date(kst(D).getTime() + 86400e3), { description: `담당자: 이재원\n연락처: +82-10-4702-5858\n주소: 켄싱턴리조트 하동\n[FaWW 출장연동 ID: ${key}]`, location: '켄싱턴리조트 하동' });
const mail = { is_trip: true, is_update: false, is_cancel: false, originalStartDate: null, status: '확정', thread_state_complete: true,
  trips: [{ name: '켄싱턴리조트 하동', startDate: D, endDate: D, assignee: '김민석', address: '켄싱턴리조트 하동', category: '텔러스헬스', status: '확정' }] };

// 1) 전환 이전(7월)의 별표 없는 메일은 다시 처리하지 않음
{
  let ai = 0; const w = world({ db: seedDb(), ai: () => { ai++; return mail; } }); addWebEvent(w, manualKey);
  w.addMessage('T-july', null, { starred: false, date: new Date(july) }); w.runOnly();
  check('[재처리 방지] 전환 이전의 별표 없는 옛 메일은 분석하지 않음', ai === 0, `AI ${ai}회`);
  check('[재처리 방지] 출장 1건 그대로, 캘린더 일정 1건 그대로', w.trips().length === 1 && w.calEvents().length === 1, `출장 ${w.trips().length} / 캘린더 ${w.calEvents().length}`);
}
// 2) 전환 이후 새 메일이 와도, 같은 날짜·같은 장소면 담당자가 달라도 새로 만들지 않음
{
  const w = world({ db: seedDb(), ai: () => mail }); addWebEvent(w, manualKey);
  w.addMessage('T-july', null); w.runOnly();
  const t = w.db.businessTrips[manualKey];
  check('[중복 방지] 담당자가 달라도(김민석 vs 이재원) 새 출장 만들지 않음', w.trips().length === 1, `출장 ${w.trips().length}건`);
  check('[기존 정보 우선] 담당자·연락처는 수동 입력값 유지', t.assignee === '이재원' && t.contact === '+82-10-4702-5858', JSON.stringify([t.assignee, t.contact]));
  check('[중복 방지] 캘린더 일정도 1건 (새 [확정] 일정 생성 안 함)', w.calEvents().length === 1, `${w.calEvents().length}건: ` + w.calEvents().map(e => e.title).join(' / '));
  const ev = w.calEvents()[0];
  check('[기존 정보 우선] 캘린더 일정의 담당자도 이재원 유지', ev && /담당자: 이재원/.test(ev.desc || ''), ev && ev.desc);
}
// 3) 정리 도구: 미리보기는 아무것도 지우지 않고, 정리는 전환 이후 자동 등록된 중복만 삭제
{
  const autoKey = pushId(Date.now(), 'AutoDupA1xyz');
  const oldA = pushId(Date.UTC(Y, 5, 1), 'OldPairA1xyz'), oldB = pushId(Date.UTC(Y, 5, 2), 'OldPairB1xyz');
  const db = seedDb();
  db.businessTrips[autoKey] = { name: '켄싱턴리조트 하동', date: D, startDate: D, endDate: D, assignee: '김민석', address: '켄싱턴리조트 하동', status: '확정', author: 'Gmail 자동 등록', sourceThreadId: '19f8c7e8630fcccd' };
  db.businessTrips[oldA] = { name: '부산지방법원 교육', date: `${Y}-11-02`, startDate: `${Y}-11-02`, assignee: '성진', status: '확정', author: 'Gmail 자동 등록' };
  db.businessTrips[oldB] = { name: '부산지방법원 교육', date: `${Y}-11-02`, startDate: `${Y}-11-02`, assignee: '민홍', status: '확정', author: 'Gmail 자동 등록' };
  const w = world({ db }); addWebEvent(w, manualKey);
  w.cal.createAllDayEvent('[확정] 켄싱턴리조트 하동', kst(D), new Date(kst(D).getTime() + 86400e3), { description: `카테고리: 텔러스헬스\n담당자: 김민석\n[FaWW 출장연동 ID: ${autoKey}]` });
  const logs = []; w.ctx.Logger.log = (m) => logs.push(String(m));
  w.ctx.previewDuplicateTrips();
  check('[미리보기] 아무것도 삭제하지 않음', Object.keys(w.db.businessTrips).length === 4 && w.calEvents().length === 2);
  check('[미리보기] 요약: 묶음 2개, 자동 삭제 1건, 확인 필요 1건', logs.some(l => /중복 묶음 2개 \/ 자동 삭제 대상 1건 \/ 직접 확인 필요 1건/.test(l)), logs.filter(l => l.startsWith('요약')).join(' '));
  w.ctx.cleanupDuplicateTrips();
  check('[정리] 전환 이후 자동 등록된 중복(김민석)만 삭제', !(autoKey in w.db.businessTrips) && (manualKey in w.db.businessTrips));
  check('[정리] 그 중복의 캘린더 일정도 삭제, 수동 일정은 유지', w.calEvents().length === 1 && /이재원/.test(w.calEvents()[0].desc), w.calEvents().map(e => e.title).join(' / '));
  check('[정리] 전환 이전의 중복 묶음은 지우지 않음 (직접 확인용)', (oldA in w.db.businessTrips) && (oldB in w.db.businessTrips));
}
const fail = results.filter(x => !x).length;
console.log(`\n결과: ${results.length - fail}/${results.length} 통과`); process.exit(fail ? 1 : 0);
