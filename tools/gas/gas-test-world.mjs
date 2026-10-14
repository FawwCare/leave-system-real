// Apps Script 테스트용 가짜 세계: Gmail·ChatGPT·Firebase(메모리)·구글 캘린더. 실제 서비스에 연결하지 않는다.
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SRC = fs.readFileSync(process.env.GAS_SRC || path.join(ROOT, 'gmail_sync_apps_script.js'), 'utf8');
export const Y = new Date().getFullYear();
export const D = (md) => `${Y}-${md}`;
export function world(opts = {}) {
    // 기본값: 메일 처리 기록 방식으로 이미 전환된 상태(오래전 cutover). 첫 실행 자체를 시험할 때만 opts.freshState 사용
    const db = { businessTrips: {}, external_events: {}, leaves: {}, businessCommunications: {}, ...(opts.freshState ? {} : { gmailSyncState: { cutover: Date.UTC(2000, 0, 1), messages: {} } }), ...(opts.db || {}) };
    let seq = 0;
    const events = [];
    const mkEvent = (o) => { const e = { ...o, deleted: false,
        getId: () => e.id, getTitle: () => e.title, setTitle: (t) => { e.title = t; }, getDescription: () => e.desc || '', setDescription: (d) => { e.desc = d; },
        getLocation: () => e.loc || '', setLocation: (l) => { e.loc = l; }, setAllDayDates: (s, en) => { e.start = s; e.end = en; }, deleteEvent: () => { e.deleted = true; },
        getStartTime: () => e.start, getEndTime: () => e.end, isAllDayEvent: () => true, getColor: () => '' }; events.push(e); return e; };
    const cal = { getEvents: () => events.filter(e => !e.deleted),
        createAllDayEvent: (t, s, en, opt) => mkEvent({ id: 'ev' + (++seq) + '@google.com', title: t, start: s, end: en, desc: opt && opt.description, loc: opt && opt.location }) };
    const res = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    const getP = (parts) => parts.reduce((n, k) => (n == null ? undefined : n[k]), db);
    const setP = (parts, v) => { let n = db; for (let i = 0; i < parts.length - 1; i++) { if (typeof n[parts[i]] !== 'object' || n[parts[i]] === null) n[parts[i]] = {}; n = n[parts[i]]; } if (v === null || v === undefined) delete n[parts[parts.length - 1]]; else n[parts[parts.length - 1]] = v; };
    const fetchLog = [];
    const UrlFetchApp = { fetch: (url, opt = {}) => {
        const m = /firebaseio\.com\/(.+?)\.json/.exec(url); if (!m) return res(200, '{}');
        const parts = m[1].split('/'); const method = (opt.method || 'get').toLowerCase();
        fetchLog.push({ path: m[1], method });
        if (opts.failGet && opts.failGet.test(m[1]) && method === 'get') return res(500, 'err');
        if (method === 'get') { const v = getP(parts); return res(200, v === undefined ? null : v); }
        if (method === 'post') { const k = '-K' + String(++seq).padStart(4, '0'); setP([...parts, k], JSON.parse(opt.payload)); return res(200, { name: k }); }
        if (method === 'delete') { setP(parts, null); return res(200, 'null'); }
        if (method === 'put') { setP(parts, JSON.parse(opt.payload)); return res(200, opt.payload); }
        if (method === 'patch') { const p = JSON.parse(opt.payload);
            for (const [pk, v] of Object.entries(p)) setP([...parts, ...pk.split('/')], v);
            return res(200, p); }
        return res(400, 'bad');
    } };
    // Gmail
    const threads = [];
    const label = { getName: () => '법원/성진' };
    const userLabels = [label];
    const searchCalls = [];
    let msgSeq = 0;
    const addMessage = (threadId, parsed, mopts = {}) => {
        let th = threads.find(t => t.id === threadId);
        if (!th) { th = { id: threadId, msgs: [], labels: [label], getId: () => th.id, getLabels: () => th.labels, getMessages: () => th.msgs, addLabel: (l) => { if (!th.labels.includes(l)) th.labels.push(l); } }; threads.push(th); }
        const id = 'm' + String(++msgSeq).padStart(6, '0');
        const date = mopts.date || new Date();
        const msg = { id, starred: !!mopts.starred, parsed, getId: () => id, getDate: () => date, isStarred: () => msg.starred, star: () => { msg.starred = true; }, getSubject: () => mopts.subject || '교육 일정 협의', getPlainBody: () => 'body' };
        th.msgs.push(msg); return msg;
    };
    let currentParsed = null;
    const ctx = {
        console: { log() {} }, Logger: { log() {} }, JSON, Date, Math, Object, String, Array, Number, parseInt,
        PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'TEST' }) },
        LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
        GmailApp: { getUserLabels: () => userLabels, search: (q, start = 0, max = 500) => { searchCalls.push({ q, start, max }); return threads.slice(start, start + max); },
            getUserLabelByName: (n) => userLabels.find(l => l.getName() === n) || null, createLabel: (n) => { const l = { getName: () => n }; userLabels.push(l); return l; } },
        CalendarApp: { getCalendarsByName: () => (opts.noFawwCalendar ? [] : [cal]), getDefaultCalendar: () => cal },
        Session: { getScriptTimeZone: () => 'Asia/Seoul' },
        Utilities: { formatDate: (d, tz, fmt) => { const k = new Date(d.getTime() + 9 * 3600e3); const p = (n) => String(n).padStart(2, '0');
            return fmt === 'HH:mm' ? `${p(k.getUTCHours())}:${p(k.getUTCMinutes())}` : `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`; } },
        UrlFetchApp, ScriptApp: {},
    };
    vm.createContext(ctx); vm.runInContext(SRC, ctx);
    // ChatGPT 대체: 처리 중인 메일에 미리 지정한 분석 결과를 돌려준다
    let pending = []; let aiCalls = 0;
    const aiFn = typeof opts.ai === 'function' ? opts.ai : null;
    vm.runInContext('parseEmailWithChatGPT = function(t){ return __nextParsed(t); };', Object.assign(ctx, { __nextParsed: (t) => { aiCalls++; return aiFn ? aiFn(t) : pending.shift(); } }));
    const run = (threadId, parsed) => { addMessage(threadId, parsed); pending.push(parsed); ctx.autoRegisterTripsWithChatGPT(); };
    const runOnly = () => ctx.autoRegisterTripsWithChatGPT();
    const trips = () => Object.values(db.businessTrips);
    const calEvents = () => events.filter(e => !e.deleted);
    return { run, runOnly, addMessage, trips, calEvents, db, ctx, events, cal, threads, userLabels, searchCalls, fetchLog, get aiCalls() { return aiCalls; }, queueAi: (p) => pending.push(p) };
}
