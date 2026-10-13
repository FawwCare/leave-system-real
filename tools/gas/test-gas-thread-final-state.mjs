// 스레드 최종 상태 정리 테스트 (reconcileThreadCandidates). 실행: node tools/gas/test-gas-thread-final-state.mjs
import { world, D } from './gas-test-world.mjs';
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c || !d ? '' : ' :: ' + d}`); };
const T = (md, status) => ({ name: '동대문구청 피지컬 상담실', startDate: D(md), endDate: D(md), assignee: '성진', address: '동대문구청', status });
const state = (trips, extra = {}) => ({ is_trip: true, is_update: false, is_cancel: false, originalStartDate: null, status: trips.some(t => t.status === '확정') ? '확정' : '조율중', thread_state_complete: true, trips, ...extra });
const summary = (w) => w.trips().map(t => `${t.startDate.slice(5)}:${t.status}`).sort().join(' ');
const calDays = (w) => w.calEvents().length;

// 1) 후보 3개 → 그중 하나 확정: 나머지 후보 정리
{
    const w = world();
    w.run('A', state([T('10-21', '조율중'), T('10-22', '조율중'), T('10-23', '조율중')]));
    check('[조율] 후보 3개가 모두 등록되어 보임', summary(w) === '10-21:조율중 10-22:조율중 10-23:조율중', summary(w));
    w.run('A', state([T('10-22', '확정')]));
    check('[확정] 22일 확정 → 탈락한 21·23일 후보 정리', summary(w) === '10-22:확정', summary(w));
    check('[확정] 캘린더에는 확정된 22일 1건', calDays(w) === 1);
}
// 2) 조율 진행 중(확정 없음)에는 후보가 빠져도 지우지 않음
{
    const w = world();
    w.run('B', state([T('10-21', '조율중'), T('10-22', '조율중'), T('10-23', '조율중')]));
    w.run('B', state([T('10-21', '조율중'), T('10-23', '조율중')]));
    check('[조율 중] 확정 전에는 결과에서 빠진 후보도 유지 (대표님이 계속 볼 수 있음)', summary(w) === '10-21:조율중 10-22:조율중 10-23:조율중', summary(w));
}
// 3) 일부 확정 + 새 후보 추가
{
    const w = world();
    w.run('C', state([T('10-21', '조율중'), T('10-22', '조율중'), T('10-23', '조율중')]));
    w.run('C', state([T('10-22', '확정'), T('11-04', '조율중')]));
    check('[혼합] 22일 확정 + 11/4 새 후보 → 21·23 정리, 11/4 추가', summary(w) === '10-22:확정 11-04:조율중', summary(w));
}
// 4) 6개 날짜 모두 확정 → 후속 답장에 AI 가 하나만 돌려줘도 확정 일정은 지우지 않음 (지난번 사고 재발 방지)
{
    const w = world();
    const six = ['10-14', '10-15', '10-16', '10-21', '10-22', '10-23'];
    w.run('D', state(six.map(md => T(md, '확정'))));
    w.run('D', state([T('10-14', '확정')]));
    check('[보호] 확정 6건은 AI 가 일부만 돌려줘도 유지', w.trips().length === 6 && w.trips().every(t => t.status === '확정'), summary(w));
    check('[보호] 캘린더 6건 유지', calDays(w) === 6);
}
// 5) AI 가 전체 상태 표시를 안 하면 정리하지 않음
{
    const w = world();
    w.run('E', state([T('10-21', '조율중'), T('10-22', '조율중')]));
    w.run('E', state([T('10-22', '확정')], { thread_state_complete: false }));
    check('[보호] thread_state_complete 가 없으면 후보 정리 안 함', summary(w) === '10-21:조율중 10-22:확정', summary(w));
}
// 6) 다른 스레드의 후보는 건드리지 않음
{
    const w = world();
    w.run('F1', state([T('10-21', '조율중')]));
    w.run('F2', state([T('10-21', '조율중'), T('10-22', '조율중')]));
    w.run('F2', state([T('10-22', '확정')]));
    check('[보호] 다른 스레드(F1)의 21일 후보는 유지', w.trips().filter(t => t.sourceThreadId === 'F1').length === 1, summary(w));
}
// 7) 취소 메일은 정리 로직을 타지 않고 해당 날짜만 삭제
{
    const w = world();
    w.run('G', state([T('10-21', '확정'), T('10-22', '조율중'), T('10-23', '조율중')]));
    w.run('G', state([T('10-23', '조율중')], { is_cancel: true }));
    check('[취소] 23일 취소 메일 → 23일만 삭제, 22일 후보 유지', summary(w) === '10-21:확정 10-22:조율중', summary(w));
}
// 8) 한 번에 10건 넘게 지우게 되면 건너뜀
{
    const w = world();
    const many = Array.from({ length: 12 }, (_, i) => `11-${String(i + 1).padStart(2, '0')}`);
    w.run('H', state(many.map(md => T(md, '조율중'))));
    w.run('H', state([T('12-01', '확정')]));
    check('[보호] 후보 12건이 한꺼번에 정리 대상이면 건너뜀', w.trips().length === 13, `${w.trips().length}건`);
}
// 9) 날짜마다 다른 상태가 그대로 저장
{
    const w = world();
    w.run('I', state([T('10-21', '확정'), T('10-22', '조율중')]));
    check('[상태] 같은 메일 안에서도 날짜별 상태가 따로 저장', summary(w) === '10-21:확정 10-22:조율중' && calDays(w) === 1, summary(w));
}
const fail = results.filter(x => !x).length;
console.log(`\n결과: ${results.length - fail}/${results.length} 통과`); process.exit(fail ? 1 : 0);
