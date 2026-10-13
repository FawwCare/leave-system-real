// Apps Script 테스트용 가짜 세계: Gmail·ChatGPT·Firebase(메모리)·구글 캘린더. 실제 서비스에 연결하지 않는다.
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SRC = fs.readFileSync(process.env.GAS_SRC || path.join(ROOT, 'gmail_sync_apps_script.js'), 'utf8');
export const Y = new Date().getFullYear();
export const D = (md) => `${Y}-${md}`;
export function world(opts = {}) {
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
        CalendarApp: { getCalendarsByName: () => (opts.noFawwCalendar ? [] : [cal]), getDefaultCalendar: () => cal },
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
    return { run, trips, calEvents, db, ctx, events, cal };
}
