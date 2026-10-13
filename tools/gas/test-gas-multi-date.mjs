// 멀티 날짜 출장 메일 처리 흐름 테스트: 가짜 Gmail·ChatGPT·Firebase·구글 캘린더로 autoRegisterTripsWithChatGPT 전체를 실행한다.
// 실제 서비스에는 연결하지 않는다.  실행: node tools/gas/test-gas-multi-date.mjs   (대조: GAS_SRC=<이전 파일>)
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = fs.readFileSync(process.env.GAS_SRC || path.join(ROOT, 'gmail_sync_apps_script.js'), 'utf8');
const Y = new Date().getFullYear();
const D = (md) => `${Y}-${md}`;

function world() {
    const db = { businessTrips: {}, external_events: {}, leaves: {}, businessCommunications: {} };
    let seq = 0;
    const events = [];
    const mkEvent = (o) => { const e = { ...o, deleted: false,
        getId: () => e.id, getTitle: () => e.title, setTitle: (t) => { e.title = t; }, getDescription: () => e.desc || '', setDescription: (d) => { e.desc = d; },
        getLocation: () => e.loc || '', setLocation: (l) => { e.loc = l; }, setAllDayDates: (s, en) => { e.start = s; e.end = en; }, deleteEvent: () => { e.deleted = true; },
        getStartTime: () => e.start, getEndTime: () => e.end, isAllDayEvent: () => true, getColor: () => '' }; events.push(e); return e; };
    const cal = { getEvents: () => events.filter(e => !e.deleted),
        createAllDayEvent: (t, s, en, opt) => mkEvent({ id: 'ev' + (++seq) + '@google.com', title: t, start: s, end: en, desc: opt && opt.description, loc: opt && opt.location }) };
    const res = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    const UrlFetchApp = { fetch: (url, opt = {}) => {
        const m = /firebaseio\.com\/(.+?)\.json/.exec(url); if (!m) return res(200, '{}');
        const parts = m[1].split('/'); const top = parts[0]; const key = parts[1]; const method = (opt.method || 'get').toLowerCase();
        db[top] = db[top] || {};
        if (method === 'get') return res(200, key ? (db[top][key] ?? null) : db[top]);
        if (method === 'post') { const k = '-K' + String(++seq).padStart(4, '0'); db[top][k] = JSON.parse(opt.payload); return res(200, { name: k }); }
        if (method === 'delete') { delete db[top][key]; return res(200, 'null'); }
        if (method === 'patch') { const p = JSON.parse(opt.payload);
            if (key) { db[top][key] = Object.assign(db[top][key] || {}, p); }
            else { for (const [pk, v] of Object.entries(p)) { const [a, f] = pk.split('/'); if (f) { db[top][a] = db[top][a] || {}; db[top][a][f] = v; } else if (v === null) delete db[top][a]; else db[top][a] = v; } }
            return res(200, p); }
        if (method === 'put') { if (key) db[top][key] = JSON.parse(opt.payload); else db[top] = JSON.parse(opt.payload); return res(200, '{}'); }
        return res(400, 'bad');
    } };
    // Gmail
    const threads = [];
    const label = { getName: () => '법원/성진' };
    const addMessage = (threadId, parsed) => {
        let th = threads.find(t => t.id === threadId);
        if (!th) { th = { id: threadId, msgs: [], getId: () => th.id, getLabels: () => [label], getMessages: () => th.msgs }; threads.push(th); }
        const msg = { starred: false, parsed, isStarred: () => msg.starred, star: () => { msg.starred = true; }, getSubject: () => '교육 일정 협의', getPlainBody: () => 'body' };
        th.msgs.push(msg); return msg;
    };
    let currentParsed = null;
    const ctx = {
        console: { log() {} }, Logger: { log() {} }, JSON, Date, Math, Object, String, Array, Number, parseInt,
        PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'TEST' }) },
        LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
        GmailApp: { getUserLabels: () => [label], search: () => threads },
        CalendarApp: { getCalendarsByName: () => [cal], getDefaultCalendar: () => cal },
        Session: { getScriptTimeZone: () => 'Asia/Seoul' },
        Utilities: { formatDate: (d, tz, fmt) => { const k = new Date(d.getTime() + 9 * 3600e3); const p = (n) => String(n).padStart(2, '0');
            return fmt === 'HH:mm' ? `${p(k.getUTCHours())}:${p(k.getUTCMinutes())}` : `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`; } },
        UrlFetchApp, ScriptApp: {},
    };
    vm.createContext(ctx); vm.runInContext(SRC, ctx);
    // ChatGPT 대체: 처리 중인 메일에 미리 지정한 분석 결과를 돌려준다
    let pending = [];
    vm.runInContext('parseEmailWithChatGPT = function(){ return __nextParsed(); };', Object.assign(ctx, { __nextParsed: () => pending.shift() }));
    const run = (threadId, parsed) => { addMessage(threadId, parsed); pending.push(parsed); ctx.autoRegisterTripsWithChatGPT(); };
    const trips = () => Object.values(db.businessTrips);
    const calEvents = () => events.filter(e => !e.deleted);
    return { run, trips, calEvents, db };
}
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
