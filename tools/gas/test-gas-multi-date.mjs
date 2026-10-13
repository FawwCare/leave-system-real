// 멀티 날짜 출장 메일 처리 흐름 테스트: 가짜 Gmail·ChatGPT·Firebase·구글 캘린더로 autoRegisterTripsWithChatGPT 전체를 실행한다.
// 실제 서비스에는 연결하지 않는다.  실행: node tools/gas/test-gas-multi-date.mjs   (대조: GAS_SRC=<이전 파일>)
import { world, D } from './gas-test-world.mjs';

const sixDates = ['10-14', '10-15', '10-16', '10-21', '10-22', '10-23'];
const mail = (status, dates, extra = {}) => ({ is_trip: true, is_update: false, is_cancel: false, originalStartDate: null, status,
    trips: dates.map(md => ({ name: '부산지방법원 피지컬케어 교육', startDate: D(md), endDate: D(md), assignee: '성진', address: '부산 연제구' })), ...extra });
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c || !d ? '' : ' :: ' + d}`); };
const datesOf = (arr) => arr.map(t => t.startDate).sort().join(',');
const calDates = (w) => w.calEvents().map(e => { const k = new Date(e.start.getTime() + 9 * 3600e3); return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`; }).sort().join(',');
const expected6 = sixDates.map(D).join(',');

// A) 조율중 6개 날짜 → 같은 스레드에서 확정 답장 (신고된 상황)
{
    const w = world();
    w.run('T1', mail('조율중', sixDates));
    check('[A] 조율중 메일: 6개 날짜가 DB에 각각 등록', w.trips().length === 6 && datesOf(w.trips()) === expected6, datesOf(w.trips()));
    check('[A] 조율중 메일: 캘린더에는 아직 안 올림', w.calEvents().length === 0);
    w.run('T1', mail('확정', sixDates));
    check('[A] 확정 답장 후 DB 6건 유지 (삭제 없음)', w.trips().length === 6, `DB ${w.trips().length}건: ${datesOf(w.trips())}`);
    check('[A] 6건의 날짜가 각각 원래 날짜 그대로 (덮어쓰기 없음)', datesOf(w.trips()) === expected6, datesOf(w.trips()));
    check('[A] 6건 모두 확정 상태', w.trips().every(t => t.status === '확정'), w.trips().map(t => t.status).join(','));
    check('[A] 캘린더에 6개 날짜 모두 존재', w.calEvents().length === 6 && calDates(w) === expected6, `${w.calEvents().length}건: ${calDates(w)}`);
    w.run('T1', mail('확정', sixDates));
    check('[A] 같은 확정 답장 한 번 더 와도 DB·캘린더 6건 그대로 (중복 생성 없음)', w.trips().length === 6 && w.calEvents().length === 6, `DB ${w.trips().length} / 캘린더 ${w.calEvents().length}`);
}
// B) 첫 메일부터 확정 6개 날짜 → 후속 답장(확정, 같은 날짜들)
{
    const w = world();
    w.run('T2', mail('확정', sixDates));
    check('[B] 확정 메일: DB 6건 + 캘린더 6건', w.trips().length === 6 && w.calEvents().length === 6, `DB ${w.trips().length} / 캘린더 ${w.calEvents().length}`);
    w.run('T2', mail('확정', ['10-14']));
    check('[B] 첫 날짜만 언급한 후속 확정 답장 → 나머지 5개 날짜 유지', w.trips().length === 6 && w.calEvents().length === 6 && calDates(w) === expected6, `DB ${w.trips().length} / 캘린더 ${calDates(w)}`);
}
// C) 단일 날짜 스레드의 날짜 변경 (기존 기능 유지 확인)
{
    const w = world();
    w.run('T3', mail('조율중', ['10-14']));
    w.run('T3', mail('확정', ['10-20'], { is_update: true, originalStartDate: D('10-14') }));
    check('[C] 단일 일정 날짜 변경: 1건 유지, 날짜 10-20 으로 이동', w.trips().length === 1 && w.trips()[0].startDate === D('10-20'), datesOf(w.trips()));
    check('[C] 확정되며 캘린더에 1건 생성', w.calEvents().length === 1 && calDates(w) === D('10-20'), calDates(w));
}
// D) 여러 날짜 중 하나만 취소
{
    const w = world();
    w.run('T4', mail('확정', sixDates));
    w.run('T4', mail('확정', ['10-16'], { is_cancel: true }));
    const left = sixDates.filter(x => x !== '10-16').map(D).join(',');
    check('[D] 16일만 취소: DB 5건, 16일만 빠짐', w.trips().length === 5 && datesOf(w.trips()) === left, datesOf(w.trips()));
    check('[D] 캘린더도 16일만 삭제', w.calEvents().length === 5 && calDates(w) === left, calDates(w));
}
const fail = results.filter(x => !x).length;
console.log(`\n결과: ${results.length - fail}/${results.length} 통과`); process.exit(fail ? 1 : 0);
