// gmail_sync_apps_script.js (Apps Script) 의 구글 캘린더 연동 로직을 가짜 CalendarApp/UrlFetchApp 로 검증한다.
// 실제 Apps Script·Firebase 에는 연결하지 않는다.  실행: node tools/gas/test-gas-calendar-sync.mjs
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = fs.readFileSync(process.env.GAS_SRC || path.join(ROOT, 'gmail_sync_apps_script.js'), 'utf8');  // 대조 실험: GAS_SRC=<이전 파일>

function makeEvent(o) {
    const e = { ...o, deleted: false,
        getId: () => e.id, getTitle: () => e.title, setTitle: (t) => { e.title = t; }, getDescription: () => e.desc || '',
        setDescription: (d) => { e.desc = d; }, getLocation: () => e.loc || '', setLocation: (l) => { e.loc = l; },
        setAllDayDates: (s, en) => { e.start = s; e.end = en; }, deleteEvent: () => { e.deleted = true; },
        getStartTime: () => e.start, getEndTime: () => e.end, isAllDayEvent: () => true, getColor: () => '' };
    return e;
}
function setup({ events = [], dbGet = { code: 200, body: '{}' } } = {}) {
    const created = [], fetches = [];
    const cal = { getEvents: () => events.filter(e => !e.deleted),
        createAllDayEvent: (t, s, en, opt) => { const ev = makeEvent({ id: 'new' + created.length, title: t, start: s, end: en, desc: opt.description, loc: opt.location }); created.push(ev); events.push(ev); return ev; } };
    const ctx = {
        console: { log() {} }, Logger: { log() {} }, JSON, Date, Math, Object, String, Array, Number,
        PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'TEST_SECRET' }) },
        CalendarApp: { getCalendarsByName: () => [cal], getDefaultCalendar: () => cal },
        Session: { getScriptTimeZone: () => 'Asia/Seoul' },
        Utilities: { formatDate: (d, tz, fmt) => { const k = new Date(d.getTime() + 9 * 3600e3); const p = (n) => String(n).padStart(2, '0');
            return fmt === 'HH:mm' ? `${p(k.getUTCHours())}:${p(k.getUTCMinutes())}` : `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`; } },
        UrlFetchApp: { fetch: (url, opt) => { fetches.push({ url, ...opt }); return (opt.method === 'get') ? { getResponseCode: () => dbGet.code, getContentText: () => dbGet.body } : { getResponseCode: () => 200, getContentText: () => '{}' }; } },
        GmailApp: {}, ScriptApp: {},
    };
    vm.createContext(ctx); vm.runInContext(SRC, ctx);
    return { ctx, cal, created, fetches, events };
}
const results = []; const check = (n, c, d = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c || !d ? '' : ' :: ' + d}`); };
const d = (s) => new Date(s + 'T00:00:00+09:00');
const tag = (id) => `카테고리: 출장\n담당자: 성진\n[FaWW 출장연동 ID: ${id}]`;

// 1) 고유 ID 탐색
{
    const evA = makeEvent({ id: 'a', title: '[확정] 부산지방법원 교육', start: d('2026-10-20'), end: d('2026-10-21'), desc: tag('-NkeyAB') });
    const evB = makeEvent({ id: 'b', title: '[확정] 부산지방법원 교육', start: d('2026-10-20'), end: d('2026-10-21'), desc: tag('-Nkey') });
    const { ctx } = setup({ events: [evA, evB] });
    if (typeof ctx.findCalendarEventByFawwId !== 'function') { check('고유 ID 탐색 함수 존재', false, 'findCalendarEventByFawwId 없음'); } else {
    check('정확히 같은 ID 만 찾음', ctx.findCalendarEventByFawwId(ctx.CalendarApp.getDefaultCalendar(), '-Nkey') === evB);
    check('접두어만 같은 ID(-Nkey vs -NkeyAB)는 매칭 안 됨', ctx.findCalendarEventByFawwId(ctx.CalendarApp.getDefaultCalendar(), '-NkeyA') === null);
    check('ID 없는 일정은 제목이 같아도 매칭 안 됨', ctx.findCalendarEventByFawwId(ctx.CalendarApp.getDefaultCalendar(), '-Nother') === null);
}
}
// 2) findAndModifyGoogleCalendarEvent: ID 일치만 수정/삭제
{
    const manual = makeEvent({ id: 'm', title: '[확정] 부산지방법원 교육', start: d('2026-10-20'), end: d('2026-10-21'), desc: '대표님 수동 일정\n담당자: 성진' });
    const { ctx } = setup({ events: [manual] });
    const r = ctx.findAndModifyGoogleCalendarEvent('-Nnotfound', 'update', { name: '부산지방법원 교육', assignee: '성진', startDate: '2026-11-03' });
    check('[수정] 제목·담당자가 같아도 ID 없는 일정은 건드리지 않음', r === false && manual.title === '[확정] 부산지방법원 교육' && manual.start.getTime() === d('2026-10-20').getTime());
    const r2 = ctx.findAndModifyGoogleCalendarEvent('-Nnotfound', 'delete', null);
    check('[삭제] ID 없는 일정은 삭제하지 않음', r2 === false && !manual.deleted);
    check('[수정] matchKey 없으면 아무것도 안 함', ctx.findAndModifyGoogleCalendarEvent('', 'delete', null) === false && !manual.deleted);
}
{
    const mine = makeEvent({ id: 't', title: '[조율중] 수원지방법원 강의', start: d('2026-10-20'), end: d('2026-10-21'), desc: tag('-Ntrip1') });
    const other = makeEvent({ id: 'o', title: '[확정] 수원지방법원 강의', start: d('2026-10-20'), end: d('2026-10-21'), desc: tag('-Ntrip2') });
    const { ctx } = setup({ events: [mine, other] });
    ctx.findAndModifyGoogleCalendarEvent('-Ntrip1', 'update', { name: '수원지방법원 강의', status: '확정', startDate: '2026-10-22', endDate: '2026-10-23' });
    check('[수정] ID 일치 일정만 날짜·상태 변경', mine.title.startsWith('[확정]') && Utilities_fmt(mine.start) === '2026-10-22' && Utilities_fmt(other.start) === '2026-10-20');
    ctx.findAndModifyGoogleCalendarEvent('-Ntrip2', 'delete', null);
    check('[삭제] ID 일치 일정만 삭제', other.deleted && !mine.deleted);
}
function Utilities_fmt(dt) { const k = new Date(dt.getTime() + 9 * 3600e3); return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`; }

// 3) 신규 등록 블록: 단어 매칭 제거 + ID 기반 판정 (정적 확인)
{
    const fn = SRC.slice(SRC.indexOf('function autoRegisterTripsWithChatGPT'), SRC.indexOf('function parseEmailWithChatGPT'));
    const block = fn.slice(fn.indexOf('완전 새 일정 등록'));
    check('신규 등록 블록에 제목 단어 매칭(commonWordsCount) 없음', !/commonWordsCount|extractWords/.test(block));
    check('신규 등록 블록이 고유 ID 로만 기존 일정 판정', /findCalendarEventByFawwId\(targetCal, resObj\.name\)/.test(block));
    check('ID 일정이 없으면 createAllDayEvent 로 생성', /else \{\s*targetCal\.createAllDayEvent\(/.test(block));
    check('생성 시 설명에 고유 ID 태그 기록', /\[FaWW 출장연동 ID: \$\{resObj\.name\}\]/.test(block));
}

// 4) syncGoogleCalendarDirectlyToFirebase: PUT 금지, 안전한 PATCH
{
    const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
    const iso = (yy, mm, dd) => `${new Date(yy, mm, dd).getFullYear()}-${String(new Date(yy, mm, dd).getMonth() + 1).padStart(2, '0')}-${String(new Date(yy, mm, dd).getDate()).padStart(2, '0')}`;
    const inWin = iso(y, m, 10), farPast = iso(y - 2, m, 10);
    const calEvt = makeEvent({ id: 'cal1@google.com', title: '[확정] 텔러스 강의', start: d(inWin), end: new Date(d(inWin).getTime() + 86400e3), desc: '카테고리: 강의' });
    const newEvt = makeEvent({ id: 'cal2@google.com', title: '[확정] 신규 일정', start: d(inWin), end: new Date(d(inWin).getTime() + 86400e3), desc: '' });
    const db = {
        'cal1_google_com': { id: 'cal1_google_com', title: '옛 제목', startDate: inWin, dueDate: inWin, assignee: '성진', status: 'doing', priority: 'high', isExternal: true },
        'gone_google_com': { id: 'gone_google_com', title: '캘린더에서 삭제됨', startDate: inWin, dueDate: inWin, isExternal: true },
        'old_google_com': { id: 'old_google_com', title: '2년 전 기록', startDate: farPast, dueDate: farPast, isExternal: true },
        'nodate': { id: 'nodate', title: '날짜 없음' },
    };
    const { ctx, fetches } = setup({ events: [calEvt, newEvt], dbGet: { code: 200, body: JSON.stringify(db) } });
    ctx.syncGoogleCalendarDirectlyToFirebase();
    const writes = fetches.filter(f => f.method !== 'get');
    check('PUT 요청 없음', !fetches.some(f => f.method === 'put'));
    check('쓰기는 PATCH 1회', writes.length === 1 && writes[0].method === 'patch', JSON.stringify(writes.map(w => w.method)));
    const up = JSON.parse(writes[0].payload);
    check('기존 일정: 구글 필드만 갱신 (제목 반영)', up['cal1_google_com/title'] === '[확정] 텔러스 강의');
    check('기존 일정: 앱에서 바꾼 담당자·상태·우선순위는 PATCH 에 없음(보존)', !('cal1_google_com/assignee' in up) && !('cal1_google_com/status' in up) && !('cal1_google_com/priority' in up) && !('cal1_google_com' in up));
    check('새 일정: 기본값과 함께 통째로 추가', up['cal2_google_com'] && up['cal2_google_com'].status === 'todo' && up['cal2_google_com'].assignee === 'FAWW 자동 연동');
    check('기간 안인데 캘린더에서 사라진 일정: 삭제(null)', up['gone_google_com'] === null);
    check('기간 밖(2년 전) 기록은 건드리지 않음', !('old_google_com' in up));
    check('날짜 없는 기록은 건드리지 않음', !('nodate' in up));
}
{
    const { ctx, fetches } = setup({ events: [], dbGet: { code: 500, body: 'err' } });
    ctx.syncGoogleCalendarDirectlyToFirebase();
    check('DB 조회 실패 시 아무것도 쓰지 않음', fetches.filter(f => f.method !== 'get').length === 0);
}
const fail = results.filter(x => !x).length;
console.log(`\n결과: ${results.length - fail}/${results.length} 통과`); process.exit(fail ? 1 : 0);
