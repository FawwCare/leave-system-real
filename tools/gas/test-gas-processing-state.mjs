// 메일 처리 기록·재시도 한도·검색 페이지 테스트. 실행: node tools/gas/test-gas-processing-state.mjs
import { world, D } from './gas-test-world.mjs';
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c || !d ? '' : ' :: ' + d}`); };
const trip = (md, status = '확정') => ({ is_trip: true, is_update: false, is_cancel: false, originalStartDate: null, status,
    trips: [{ name: '수원지방법원 교육', startDate: D(md), endDate: D(md), assignee: '성진', address: '수원' }] });
const comm = { is_trip: false, category: '업무보고', summary: '보고서 송부', assignee: '성진' };
const state = (w) => (w.db.gmailSyncState || {}).messages || {};

// 1) 전환 이전 별표 메일은 처리된 것으로 인정, 전환 이후엔 별표와 무관
{
    const w = world({ db: { gmailSyncState: { cutover: Date.now() - 1000, messages: {} } } });
    w.addMessage('T1', null, { starred: true, date: new Date(Date.now() - 86400e3) });   // 전환 이전 + 별표
    w.runOnly();
    check('[호환] 전환 이전 별표 메일은 다시 분석하지 않음', w.aiCalls === 0, `AI ${w.aiCalls}회`);
    const m = w.addMessage('T1', null, { starred: true });                                 // 전환 이후, 직원이 별표
    w.queueAi(trip('10-14')); w.runOnly();
    check('[별표 무관] 전환 이후 메일은 직원이 별표를 달아도 처리됨', w.aiCalls === 1 && w.trips().length === 1, `AI ${w.aiCalls} / 출장 ${w.trips().length}`);
    check('[기록] 처리 완료가 메일 ID 로 기록됨', state(w)[m.id] && state(w)[m.id].s === 'done');
    w.runOnly();
    check('[기록] 다시 실행해도 같은 메일을 재분석하지 않음', w.aiCalls === 1, `AI ${w.aiCalls}회`);
}
// 2) 처음 실행: cutover 자동 기록, 이전 메일(별표 여부 무관) 건너뜀
{
    const w = world({ freshState: true });
    w.addMessage('T2', null, { starred: true, date: new Date(Date.now() - 3600e3) });
    w.runOnly();
    check('[첫 실행] cutover 시각이 기록됨', !!(w.db.gmailSyncState && w.db.gmailSyncState.cutover));
    check('[첫 실행] 기존 별표 메일은 다시 처리하지 않음 (예전 메일 재처리 폭주 방지)', w.aiCalls === 0, `AI ${w.aiCalls}회`);
    w.addMessage('T2b', null, { starred: false, date: new Date(Date.now() - 86400e3) }); w.runOnly();
    check('[첫 실행] 전환 이전의 별표 없는 메일도 다시 처리하지 않음 (켄싱턴 중복 재발 방지)', w.aiCalls === 0, `AI ${w.aiCalls}회`);
}
// 3) AI 실패 3회 → 검토 필요 라벨, 이후 재시도 안 함
{
    const w = world({ ai: () => null });
    const m = w.addMessage('T3', null);
    w.runOnly(); w.runOnly();
    check('[재시도] 2회 실패까지는 다음 실행에서 재시도', w.aiCalls === 2 && state(w)[m.id].s === 'failed' && state(w)[m.id].n === 2, JSON.stringify(state(w)[m.id]));
    w.runOnly();
    check('[한도] 3회 실패 시 검토 필요로 전환', state(w)[m.id].s === 'review', JSON.stringify(state(w)[m.id]));
    check('[한도] 스레드에 FaWW-검토필요 라벨 부착', w.threads[0].labels.some(l => l.getName() === 'FaWW-검토필요'));
    w.runOnly(); w.runOnly();
    check('[한도] 이후 실행에서는 더 이상 AI 를 호출하지 않음 (비용 낭비 방지)', w.aiCalls === 3, `AI ${w.aiCalls}회`);
    check('[라벨] 검토필요 라벨은 출장 라벨로 오인되지 않음 (/ 없음)', !'FaWW-검토필요'.includes('/'));
}
// 4) 같은 스레드에 새 답장이 오면 검토필요와 별개로 새 메일은 처리
{
    let n = 0; const w = world({ ai: () => (n++ < 3 ? null : trip('10-20')) });
    w.addMessage('T4', null); w.runOnly(); w.runOnly(); w.runOnly();
    w.addMessage('T4', null); w.runOnly();
    check('[스레드] 검토필요 메일이 있는 스레드라도 새 답장은 정상 처리', w.trips().length === 1 && w.trips()[0].startDate === D('10-20'), `출장 ${w.trips().length}건`);
}
// 5) 일반 소통 메일도 처리 기록
{
    const w = world({ ai: () => comm });
    const m = w.addMessage('T5', null); w.runOnly(); w.runOnly();
    check('[소통] 일반 소통 메일 1회만 등록', Object.keys(w.db.businessCommunications).length === 1 && w.aiCalls === 1 && state(w)[m.id].s === 'done');
}
// 6) 검색: 기간 조건 + 여러 페이지, AI 호출 한도
{
    const w = world({ ai: () => comm });
    for (let i = 0; i < 120; i++) w.addMessage('TH' + i, null);
    w.runOnly();
    check('[검색] 최근 기간 조건(newer_than) 포함', w.searchCalls.every(c => /newer_than:90d/.test(c.q)), w.searchCalls[0] && w.searchCalls[0].q);
    check('[검색] 50개씩 여러 페이지 조회 (0, 50, 100)', w.searchCalls.map(c => c.start).join(',') === '0,50,100', w.searchCalls.map(c => c.start).join(','));
    check('[한도] 한 번 실행에 AI 분석 최대 30건', w.aiCalls === 30, `AI ${w.aiCalls}회`);
    w.runOnly(); w.runOnly(); w.runOnly();
    check('[한도] 남은 메일은 다음 실행들에서 이어서 처리 (총 120건)', w.aiCalls === 120 && Object.keys(w.db.businessCommunications).length === 120, `AI ${w.aiCalls}회`);
}
// 7) 처리 기록을 못 읽으면 실행 중단
{
    const w = world({ failGet: /^gmailSyncState$/, ai: () => comm });
    w.addMessage('T7', null); w.runOnly();
    check('[보호] 처리 기록 조회 실패 시 아무 메일도 처리하지 않음', w.aiCalls === 0 && Object.keys(w.db.businessCommunications).length === 0);
}
const fail = results.filter(x => !x).length;
console.log(`\n결과: ${results.length - fail}/${results.length} 통과`); process.exit(fail ? 1 : 0);
