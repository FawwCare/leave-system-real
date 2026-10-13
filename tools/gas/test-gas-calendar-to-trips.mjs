// 캘린더(기준) → 출장 DB 반영 테스트 (syncCalendarChangesToTrips). 실행: node tools/gas/test-gas-calendar-to-trips.mjs
import { world, D, Y } from './gas-test-world.mjs';
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c || !d ? '' : ' :: ' + d}`); };
const kst = (iso) => new Date(iso + 'T00:00:00+09:00');
const mail = (status, dates, name = '부산지방법원 피지컬케어 교육') => ({ is_trip: true, is_update: false, is_cancel: false, originalStartDate: null, status,
    trips: dates.map(md => ({ name, startDate: D(md), endDate: D(md), assignee: '성진', address: '부산 연제구' })) });
const tripByName = (w, n) => Object.entries(w.db.businessTrips).find(([, t]) => t.name === n);
const evOf = (w, key) => w.events.find(e => !e.deleted && (e.desc || '').includes(`[FaWW 출장연동 ID: ${key}]`));
const sync = (w) => w.ctx.syncGoogleCalendarDirectlyToFirebase();

// 1) 등록 직후 연결 표시
{
    const w = world();
    w.run('T1', mail('확정', ['10-14']));
    const [k, t] = Object.entries(w.db.businessTrips)[0];
    check('[연결] 확정 출장이 캘린더에 생성되면 같은 실행에서 calendarLinked 표시', t.calendarLinked === true);
    // 2) 캘린더에서 날짜 이동
    const ev = evOf(w, k); ev.start = kst(D('10-20')); ev.end = kst(D('10-22')); // 종일 일정 종료는 다음날(배타) → 20~21일
    w.db.businessTrips[k].bookedHotel = '해운대 호텔'; w.db.businessTrips[k].requiredPersonnel = 3;
    sync(w);
    const t2 = w.db.businessTrips[k];
    check('[이동] 캘린더에서 옮긴 날짜가 출장 DB에 반영 (20~21일)', t2.startDate === D('10-20') && t2.endDate === D('10-21') && t2.date === `${D('10-20')} to ${D('10-21')}`, JSON.stringify([t2.startDate, t2.endDate, t2.date]));
    check('[이동] 앱 전용 정보(숙소·인원)는 보존', t2.bookedHotel === '해운대 호텔' && t2.requiredPersonnel === 3);
    // 3) 캘린더에서 제목·장소 변경
    ev.title = '[확정] 부산지방법원 동부지원 교육'; ev.loc = '부산 해운대구';
    sync(w);
    check('[변경] 캘린더 제목(상태 머리말 제외)·장소가 출장명·주소에 반영', w.db.businessTrips[k].name === '부산지방법원 동부지원 교육' && w.db.businessTrips[k].address === '부산 해운대구', JSON.stringify([w.db.businessTrips[k].name, w.db.businessTrips[k].address]));
    // 4) 캘린더에서 삭제 (실제 캘린더처럼 다른 수동 일정도 하나 있는 상태)
    w.cal.createAllDayEvent('대표님 개인 일정', kst(D('10-25')), kst(D('10-26')), { description: '' });
    ev.deleted = true; sync(w);
    check('[삭제] 캘린더에서 지운 확정 출장은 출장 DB에서도 삭제', !(k in w.db.businessTrips));
}
// 5) 여러 날짜 중 하나만 캘린더에서 삭제
{
    const w = world();
    w.run('T2', mail('확정', ['10-14', '10-15', '10-16']));
    const k15 = Object.entries(w.db.businessTrips).find(([, t]) => t.startDate === D('10-15'))[0];
    evOf(w, k15).deleted = true; sync(w);
    check('[삭제] 3개 날짜 중 15일만 캘린더에서 지우면 15일만 삭제', w.trips().length === 2 && !(k15 in w.db.businessTrips), w.trips().map(t => t.startDate).join(','));
}
// 6) 안전장치들
{
    const w = world();
    w.run('T3', mail('조율중', ['10-14']));
    w.db.businessTrips['-APP1'] = { name: '앱에서 직접 만든 확정 출장', status: '확정', startDate: D('10-15'), endDate: D('10-15'), date: D('10-15') };
    sync(w);
    check('[보호] 조율중 출장은 캘린더에 없어도 유지', w.trips().some(t => t.status === '조율중'));
    check('[보호] 앱에서 만든 확정 출장(캘린더 연결 이력 없음)은 유지', '-APP1' in w.db.businessTrips);
}
{
    const w = world({ noFawwCalendar: true });
    w.run('T4', mail('확정', ['10-14']));
    const [k] = Object.entries(w.db.businessTrips)[0];
    w.db.businessTrips[k].calendarLinked = true; evOf(w, k).deleted = true; sync(w);
    check('[보호] FAWW 캘린더를 못 찾으면(기본 캘린더 대체) 출장 DB를 건드리지 않음', k in w.db.businessTrips);
}
{
    const w = world();
    w.run('T5', mail('확정', ['10-01', '10-02', '10-05', '10-06', '10-07', '10-08']));
    w.events.forEach(e => { e.deleted = true; }); sync(w);
    check('[보호] 캘린더가 통째로 비어 보이면(일시 오류 의심) 삭제하지 않음', w.trips().length === 6, `${w.trips().length}건`);
}
{
    const w = world();
    w.run('T6', mail('확정', ['10-01', '10-02', '10-05', '10-06', '10-07', '10-08']));
    const keys = Object.keys(w.db.businessTrips);
    keys.slice(0, 5).forEach(k => { evOf(w, k).deleted = true; }); sync(w);
    check('[보호] 연결된 6건 중 5건이 한꺼번에 사라지면 삭제 보류', w.trips().length === 6, `${w.trips().length}건`);
    const w2 = world();
    w2.run('T7', mail('확정', ['10-01', '10-02', '10-05', '10-06', '10-07', '10-08']));
    Object.keys(w2.db.businessTrips).slice(0, 2).forEach(k => { evOf(w2, k).deleted = true; }); sync(w2);
    check('[정상] 6건 중 2건 삭제는 그대로 반영', w2.trips().length === 4, `${w2.trips().length}건`);
}
{
    const w = world();
    w.run('T8', mail('확정', ['10-14']));
    const [k] = Object.entries(w.db.businessTrips)[0];
    const ev = evOf(w, k); ev.start = kst(`${Y + 1}-03-10`); ev.end = kst(`${Y + 1}-03-11`); sync(w);
    check('[보호] 동기화 기간 밖(내년 3월)으로 멀리 옮긴 일정은 삭제가 아니라 날짜 이동으로 처리', (k in w.db.businessTrips) && w.db.businessTrips[k].startDate === `${Y + 1}-03-10`, JSON.stringify(w.db.businessTrips[k]));
}
{
    const w = world();
    w.run('T9', mail('확정', ['10-14']));
    const [k] = Object.entries(w.db.businessTrips)[0];
    evOf(w, k).deleted = true;
    const realFetch = w.ctx.UrlFetchApp.fetch;
    w.ctx.UrlFetchApp.fetch = (url, opt = {}) => (/businessTrips\.json/.test(url) && (opt.method || 'get') === 'get') ? { getResponseCode: () => 500, getContentText: () => 'err' } : realFetch(url, opt);
    sync(w);
    check('[보호] 출장 DB 조회 실패 시 아무것도 바꾸지 않음', k in w.db.businessTrips);
}
const fail = results.filter(x => !x).length;
console.log(`\n결과: ${results.length - fail}/${results.length} 통과`); process.exit(fail ? 1 : 0);
