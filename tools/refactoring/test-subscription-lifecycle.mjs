// 보안 1차: 구독 생명주기 모의 테스트
// - index.html 에 선언된 로컬 classic script 를 "실제 순서대로" 하나의 VM 컨텍스트에서 실행한다.
//   (window === globalThis, 스크립트 간 top-level const/let 공유 → 브라우저 classic script 와 같은 전역 의미)
// - Firebase RTDB 는 상태를 가진 모의 객체로 대체한다: on/off 등록·해제를 실제로 추적하고,
//   단순화한 규칙(업무 경로 = 로그인 + users/{uid}/approved===true, users = 로그인)을 위반하면
//   실제 SDK 처럼 에러 콜백을 호출하고 리스너를 취소한다.
// - 브라우저·Emulator 검증을 대체하지 않는다. DOM 은 최소 스텁이다.
// 실행: node tools/refactoring/test-subscription-lifecycle.mjs   (대조 실험: OVERRIDE="/features/map.js=<경로>")
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUSINESS_TOP = new Set(['tasks', 'leaves', 'businessTrips', 'files', 'consumables', 'consumablesLog', 'external_events',
    'tripVehicles', 'businessCommunications', 'chatMessages', 'notices', 'privateChats', 'sharedNote', 'typingStatus',
    'notifications', 'dailyTasks', 'dailyLogs']);
const ADMIN = 'jaGugunGReXytCgbqYwQUybxyJL2';
const ADMIN_UIDS_RULE = [ADMIN, 'hiPMcfj1OvWuq6PjedfPFvOLxlp2'];

// ---------------------------------------------------------------- DOM stub
const allEls = [];
function makeEl(id) {
    const el = {
        id, _children: [], style: {}, dataset: {}, value: '', checked: false, disabled: false, textContent: '',
        _innerHTML: '', className: '', scrollTop: 0, scrollHeight: 0, files: [], options: [],
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        get innerHTML() { return this._innerHTML; },
        set innerHTML(v) { this._innerHTML = String(v); if (v === '') this._children = []; },
        appendChild(c) { this._children.push(c); return c; }, prepend(c) { this._children.unshift(c); },
        insertBefore(c) { this._children.push(c); return c; }, removeChild() {}, remove() {}, replaceChildren() { this._children = []; },
        addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
        querySelector() { return makeEl(); }, querySelectorAll() { return []; }, closest() { return null; },
        focus() {}, blur() {}, click() {}, scrollIntoView() {}, getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
        getContext() { return null; }, insertAdjacentHTML(_, h) { this._innerHTML += h; }, cloneNode() { return makeEl(); },
    };
    allEls.push(el);
    return el;
}
const elements = new Map();
const document = {
    readyState: 'complete',
    getElementById(id) { if (!elements.has(id)) elements.set(id, makeEl(id)); return elements.get(id); },
    querySelector() { return makeEl(); }, querySelectorAll() { return []; }, getElementsByClassName() { return []; },
    createElement() { return makeEl(); }, createTextNode() { return makeEl(); }, addEventListener() {}, removeEventListener() {},
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'), visibilityState: 'visible',
};
const htmlOf = (id) => document.getElementById(id).innerHTML + document.getElementById(id)._children.length;
const isEmptyDom = (id) => { const e = document.getElementById(id); return e.innerHTML === '' && e._children.length === 0; };

// ---------------------------------------------------------------- RTDB mock
const store = {};
const regs = new Set();          // 활성 등록 {query, cb, errCb}
const counters = { on: 0, off: 0, denied: 0, deniedPaths: [], revoked: 0, onPaths: [] };
const auth = { currentUser: null, _cbs: [] };

const seg = (p) => p.split('/').filter(Boolean);
function getAt(p) { let n = store; for (const s of seg(p)) { if (n == null || typeof n !== 'object') return null; n = n[s]; } return n === undefined ? null : n; }
function setAt(p, v) {
    const s = seg(p); if (!s.length) throw new Error('root set not supported');
    let n = store; for (let i = 0; i < s.length - 1; i++) { if (typeof n[s[i]] !== 'object' || n[s[i]] === null) n[s[i]] = {}; n = n[s[i]]; }
    if (v === null || v === undefined) delete n[s[s.length - 1]]; else n[s[s.length - 1]] = JSON.parse(JSON.stringify(v));
}
function canRead(p) {
    const top = seg(p)[0];
    if (!auth.currentUser) return false;
    if (top === 'users') {   // 보안 2차-1: 명단 전체는 승인자·관리자, 하위 본인 경로는 본인
        const approvedOrAdmin = getAt(`users/${auth.currentUser.uid}/approved`) === true || ADMIN_UIDS_RULE.includes(auth.currentUser.uid)
            || (auth.currentUser.email === 'contact@faww.co.kr' && auth.currentUser.emailVerified === true);
        if (approvedOrAdmin) return true;
        return seg(p)[1] === auth.currentUser.uid;
    }
    if (top === 'privateChats') {   // 보안 2차-2: 승인 + 당사자만 (방 ID = 작은UID_큰UID)
        const id = seg(p)[1]; const me = auth.currentUser.uid;
        return getAt(`users/${me}/approved`) === true && !!id && (id.startsWith(me + '_') || id.endsWith('_' + me));
    }
    if (BUSINESS_TOP.has(top)) return getAt(`users/${auth.currentUser.uid}/approved`) === true;
    return false;
}
function snapshotOf(q) {
    let v = getAt(q.path);
    if (v && typeof v === 'object' && (q._eq !== undefined || q._lim)) {
        let keys = Object.keys(v).sort();
        if (q._oc !== undefined && q._eq !== undefined) keys = keys.filter(k => v[k] && v[k][q._oc] === q._eq);
        if (q._lim) keys = keys.slice(-q._lim);
        const o = {}; keys.forEach(k => o[k] = v[k]); v = keys.length ? o : null;
    }
    const clone = v === null ? null : JSON.parse(JSON.stringify(v));
    return {
        key: seg(q.path).pop() || null, val: () => (clone === null ? null : JSON.parse(JSON.stringify(clone))), exists: () => clone !== null,
        forEach(fn) { if (clone && typeof clone === 'object') for (const k of Object.keys(clone)) { if (fn({ key: k, val: () => clone[k] }) === true) break; } },
        numChildren: () => (clone && typeof clone === 'object' ? Object.keys(clone).length : 0),
    };
}
function deliver(r) { if (regs.has(r)) r.cb(snapshotOf(r.query)); }
function deny(r, revocation = false) {
    regs.delete(r);
    if (revocation) counters.revoked++; else { counters.denied++; counters.deniedPaths.push(r.query.path); }
    if (r.errCb) r.errCb(Object.assign(new Error('permission_denied'), { code: 'PERMISSION_DENIED' }));
}
// 서버가 권한을 재평가해 취소하는 동작 + 변경 경로와 겹치는 리스너에 값 전달
function propagate(changed) {
    for (const r of [...regs]) if (!canRead(r.query.path)) deny(r, true); // 서버 측 권한 재평가에 의한 취소
    for (const r of [...regs]) {
        const a = r.query.path, b = changed;
        if (b === null || a === b || a.startsWith(b + '/') || b.startsWith(a + '/')) deliver(r);
    }
}
const writeLog = [];   // {path, ok}
function isAdminUser(u) { return !!u && (ADMIN_UIDS_RULE.includes(u.uid) || (u.email === 'contact@faww.co.kr' && u.emailVerified === true)); }
function leaveWriteAllowed(leaveId, before, after) {
    const u = auth.currentUser; if (!u) return false;
    if (isAdminUser(u)) return true;
    if (getAt(`users/${u.uid}/approved`) !== true) return false;
    const d = before, n = after;
    if (!d) return !!n && n.uid === u.uid && n.status === 'pending';
    if (!n) return d.uid === u.uid && d.status === 'pending';
    const same = ['uid', 'userName', 'date', 'type', 'subType', 'timestamp', 'id', 'rejectReason'].every(k => (n[k] ?? null) === (d[k] ?? null));
    return d.uid === u.uid && d.status === 'approved' && n.status === 'cancel_requested' && same;
}
function guardWrite(path, apply) {
    const sg = seg(path);
    if (sg[0] === 'leaves' && sg[1]) {
        const snapshotStore = JSON.stringify(store); const before = JSON.parse(JSON.stringify(getAt(`leaves/${sg[1]}`)));   // 깊은 복사 (쓰기 전 상태)
        apply(); const after = getAt(`leaves/${sg[1]}`);
        const ok = leaveWriteAllowed(sg[1], before, after === null ? null : JSON.parse(JSON.stringify(after)));
        writeLog.push({ path, ok, who: auth.currentUser && auth.currentUser.uid, before, after });
        if (!ok) { const restored = JSON.parse(snapshotStore); for (const k of Object.keys(store)) delete store[k]; Object.assign(store, restored);
            return Promise.reject(Object.assign(new Error('permission_denied'), { code: 'PERMISSION_DENIED' })); }
        return null;
    }
    apply(); return null;
}
class Query {
    constructor(p, spec = {}) { this.path = seg(p).join('/'); Object.assign(this, spec); }
    _with(extra) { return new Query(this.path, { _oc: this._oc, _eq: this._eq, _lim: this._lim, ...extra }); }
    get key() { return seg(this.path).pop() || null; }
    get ref() { return new Query(this.path); }
    sameSpec(o) { return o.path === this.path && o._oc === this._oc && o._eq === this._eq && o._lim === this._lim; }
    child(c) { return new Query(this.path + '/' + c); }
    orderByChild(c) { return this._with({ _oc: c }); } orderByKey() { return this._with({ _oc: '$key' }); }
    equalTo(v) { return this._with({ _eq: v }); } limitToLast(n) { return this._with({ _lim: n }); } limitToFirst(n) { return this._with({ _lim: n }); }
    startAt() { return this; } endAt() { return this; }
    on(ev, cb, errCb) {
        counters.on++; counters.onPaths.push(this.path);
        const r = { query: this, cb, errCb: typeof errCb === 'function' ? errCb : null, ev };
        regs.add(r);
        queueMicrotask(() => { if (!regs.has(r)) return; if (!canRead(this.path)) deny(r); else deliver(r); });
        return cb;
    }
    off(ev, cb) {
        for (const r of [...regs]) if (r.query.sameSpec(this) && (!cb || r.cb === cb)) { regs.delete(r); counters.off++; }
    }
    once() { return Promise.resolve(canRead(this.path) ? snapshotOf(this) : (() => { throw new Error('permission_denied'); })()); }
    async set(v) { const e = guardWrite(this.path, () => setAt(this.path, v)); if (e) return e; propagate(this.path); }
    async update(o) { const e = guardWrite(this.path, () => { for (const k of Object.keys(o)) setAt(this.path + '/' + k, o[k]); }); if (e) return e; propagate(this.path); }
    async remove() { const e = guardWrite(this.path, () => setAt(this.path, null)); if (e) return e; propagate(this.path); }
    push(v) { const k = 'k' + Math.random().toString(36).slice(2); const q = this.child(k); if (v !== undefined) q.set(v); return Object.assign(q, { then: (f) => Promise.resolve().then(f) }); }
    transaction(fn) { const cur = getAt(this.path); const nv = fn(cur); if (nv !== undefined) setAt(this.path, nv); propagate(this.path); return Promise.resolve({ committed: true, snapshot: snapshotOf(this) }); }
}
const db = { ref: (p = '') => new Query(p) };
const authApi = {
    get currentUser() { return auth.currentUser; },
    onAuthStateChanged(cb) { auth._cbs.push(cb); return () => {}; },
    signOut() { auth.currentUser = null; propagate(null); auth._cbs.forEach(cb => cb(null)); return Promise.resolve(); },
    setPersistence: () => Promise.resolve(), getRedirectResult: () => Promise.resolve({}), signInWithPopup: () => Promise.resolve(),
    signInWithRedirect: () => Promise.resolve(),
};
async function signIn(uid, email) {
    if (auth.currentUser) await authApi.signOut();
    auth.currentUser = { uid, email: email || uid + '@example.com', emailVerified: true, displayName: uid, photoURL: '' };
    propagate(null);
    auth._cbs.forEach(cb => cb(auth.currentUser));
    await settle();
}
const settle = () => new Promise(r => setTimeout(r, 120));
const active = () => [...regs];
const activePaths = () => active().map(r => r.query.path).sort();
const activeBusiness = () => active().filter(r => BUSINESS_TOP.has(seg(r.query.path)[0]));

// ---------------------------------------------------------------- context
const noop = () => {};
const appErrors = [];
process.on('uncaughtException', (e) => { console.log('FAIL 처리되지 않은 예외: ' + (e && e.stack || e)); process.exit(1); });
process.on('unhandledRejection', (e) => { console.log('FAIL 처리되지 않은 거부: ' + (e && e.stack || e)); process.exit(1); });
let __finished = false;
process.on('exit', () => { if (!__finished) { console.log('\nFAIL 테스트가 끝까지 실행되지 않음 (중간 중단)\n' + appErrors.slice(-3).join('\n')); process.exitCode = 1; } });
const anyFn = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : anyFn), apply: () => anyFn, construct: () => anyFn });
const firebaseStub = {
    apps: [{}], initializeApp: () => ({}), app: () => ({ functions: () => anyFn }),
    auth: Object.assign(() => authApi, { Auth: { Persistence: { LOCAL: 'local' } }, GoogleAuthProvider: function () { this.addScope = noop; this.setCustomParameters = noop; } }),
    database: Object.assign(() => db, { ServerValue: { TIMESTAMP: 0 } }), storage: () => anyFn, functions: () => anyFn,
};
const ctx = {
    console: { log: noop, info: noop, debug: noop, warn: noop, error: (...a) => { appErrors.push(a.map(String).join(' ')); } },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: noop, queueMicrotask, Promise, Date, Math, JSON, Object, Array,
    document, navigator: { userAgent: 'node', clipboard: { writeText: () => Promise.resolve() }, onLine: true },
    location: { search: '', hash: '', href: 'http://localhost/', pathname: '/', reload: noop },
    history: { replaceState: noop, pushState: noop }, localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    alert: noop, confirm: () => true, prompt: () => '', fetch: () => Promise.reject(new Error('offline')),
    firebase: firebaseStub, Notification: { permission: 'denied', requestPermission: () => Promise.resolve('denied') },
    Kakao: anyFn, kakao: anyFn, Sortable: anyFn, flatpickr: anyFn, tippy: anyFn, Chart: anyFn, pdfjsLib: anyFn, XLSX: anyFn,
    MutationObserver: function () { this.observe = noop; this.disconnect = noop; },
    IntersectionObserver: function () { this.observe = noop; this.disconnect = noop; },
    ResizeObserver: function () { this.observe = noop; this.disconnect = noop; },
    requestAnimationFrame: (f) => setTimeout(f, 0), matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    HTMLElement: Object.assign(function () {}, { prototype: { appendChild(c) { this._children.push(c); return c; } } }), Element: function () {}, Node: function () {}, Event: function () {},
    getComputedStyle: () => ({}), innerWidth: 1280, innerHeight: 800, addEventListener: noop, removeEventListener: noop,
    URL, URLSearchParams, Blob: function () {}, FileReader: function () {}, Image: function () {}, CustomEvent: function () {},
    TextEncoder, TextDecoder, atob, btoa, structuredClone, Intl, Set, Map, WeakMap, Symbol, Error, RegExp, Number, String, Boolean, encodeURIComponent, decodeURIComponent,
};
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const order = [...html.matchAll(/<script\s+src="(\/[^"]+\.js)"/g)].map(m => m[1]);
const loadErrors = [];
for (const src of order) {
    let file = path.join(ROOT, 'public', src);
    // 대조 실험용: OVERRIDE="/features/map.js=/tmp/a.js,/js/main.js=/tmp/b.js"
    for (const pair of (process.env.OVERRIDE || '').split(',').filter(Boolean)) { const [k, v] = pair.split('='); if (k === src) file = path.resolve(v); }
    try { vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: src }); }
    catch (e) { loadErrors.push(`${src}: ${e.message}`); }
}
const run = (code) => vm.runInContext(code, ctx);

// ---------------------------------------------------------------- fixtures
function seedData() {
    for (const k of Object.keys(store)) delete store[k];
    Object.assign(store, JSON.parse(JSON.stringify({
        users: {
            [ADMIN]: { displayName: 'Admin', email: 'admin@example.com', approved: true, leaveTotal: 15 },
            uA: { displayName: 'A', email: 'a@example.com', approved: true, leaveTotal: 15, department: 'team1_member' },
            uB: { displayName: 'B', email: 'b@example.com', approved: true, leaveTotal: 15, department: 'team2_member' },
            uP: { displayName: 'P', email: 'p@example.com', approved: false, leaveTotal: 15, department: 'unassigned' },
        },
        tasks: { t1: { title: 'A업무', status: 'todo', assignee: 'A' }, t2: { title: '완료', status: 'done' }, notifications: { uA: { n1: { text: 'A 알림', timestamp: 1 } } } },
        businessTrips: { b1: { title: '출장1', assignee: 'A', date: '2026-10-08' } },
        leaves: { l1: { userName: 'A', status: 'pending', uid: 'uA' } },
        files: { f1: { name: 'a.pdf', uploader: 'A', timestamp: 1 } },
        consumables: { c1: { name: '복사용지', stock: 3 } },
        notices: { n1: { title: '공지', content: 'x', timestamp: 1 } },
        external_events: { e1: { title: '외부' } }, tripVehicles: { v1: { car: '1호차' } },
    })));
}

// ---------------------------------------------------------------- tests
const results = [];
const check = (name, cond, detail = '') => { results.push({ name, ok: !!cond, detail }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail && !cond ? ' :: ' + detail : '')); };

console.log('스크립트 로드 순서:', order.join(' → '));
check('index.html 의 모든 로컬 스크립트가 예외 없이 로드됨', loadErrors.length === 0, loadErrors.join(' | '));
check('subscription.js 가 config.js 직후, 다른 기능 스크립트보다 먼저 로드됨',
    order.indexOf('/js/subscription.js') === order.indexOf('/js/config.js') + 1);

seedData();
await settle();
check('[로드 직후·비로그인] 업무 경로 리스너 등록 0건', activeBusiness().length === 0, activePaths().join(','));
check('[로드 직후·비로그인] 권한 거부로 취소된 리스너 0건 (로그인 전 구독 시도 없음)', counters.denied === 0, counters.deniedPaths.join(','));

// 미승인 사용자 로그인: 본인 프로필만 구독, 명단·업무 구독 시도 없음
await signIn('uP');
check('[미승인 로그인] 권한 거부 0건 (명단·업무 구독 시도 없음)', counters.denied === 0, counters.deniedPaths.join(','));
check('[미승인 로그인] 활성 리스너 = 본인 프로필 1건', activePaths().join(',') === 'users/uP', activePaths().join(','));
check('[미승인 로그인] 저장소에 타 직원 명단 없음', Object.keys(run('AppStore').getUsers() || {}).length === 0);
await authApi.signOut(); await settle();

// 로그인 A (승인)
await signIn('uA');
const AppStore = run('AppStore');
check('[A 로그인] 권한 거부 0건', counters.denied === 0, counters.deniedPaths.join(','));
check('[A 로그인] 업무 데이터 수신: 업무', Object.keys(AppStore.getTasks()).includes('t1'));
check('[A 로그인] 업무 데이터 수신: 출장 (map.js)', Object.keys(AppStore.getTrips()).includes('b1'));
check('[A 로그인] 업무 데이터 수신: 연차', Object.keys(AppStore.getLeaves()).includes('l1'));
check('[A 로그인] 업무 데이터 수신: 파일', Object.keys(run('allFilesData')).includes('f1'));
check('[A 로그인] 업무 데이터 수신: 소모품', Object.keys(run('allConsumablesData')).includes('c1'));
check('[A 로그인] 본인 알림만 구독 (tasks/notifications/uA)', activePaths().includes('tasks/notifications/uA'));
const baselineApproved = active().length;
const baselinePaths = activePaths().join('|');

// 프로필 일반 수정 → 업무 구독이 재등록되지 않아야 함
const onBefore = counters.on;
await db.ref('users/uA').update({ displayName: 'A2' }); await settle();
const reOn = counters.onPaths.slice(onBefore);
check('[A 프로필 수정] 구독 재등록 없음 (on 증가 0, 개인채팅 알림 포함)', reOn.length === 0, reOn.join(','));
check('[A 프로필 수정] 활성 리스너 수 불변', active().length === baselineApproved, `${baselineApproved} → ${active().length}`);

// 늦은 콜백 시뮬레이션: 로그아웃 전 tasks_todo 의 실제 등록 콜백 확보
const staleTodo = active().find(r => r.query.path === 'tasks' && r.query._eq === 'todo');
const staleTrips = active().find(r => r.query.path === 'businessTrips');

// 로그아웃
await authApi.signOut(); await settle();
check('[로그아웃] 활성 리스너 0건', active().length === 0, activePaths().join(','));
check('[로그아웃] 업무·출장·연차 저장소 비움', !Object.keys(AppStore.getTasks()).length && !Object.keys(AppStore.getTrips()).length && !Object.keys(AppStore.getLeaves()).length);
check('[로그아웃] 파일·소모품 캐시 비움', !Object.keys(run('allFilesData')).length && !Object.keys(run('allConsumablesData')).length);
check('[로그아웃] 파일 목록·소모품 DOM 비움', isEmptyDom('fileList') && isEmptyDom('consumables-grid'), htmlOf('fileList') + '/' + htmlOf('consumables-grid'));
check('[로그아웃] 관리자 사용자 목록 DOM 비움', isEmptyDom('user-approval-list') && isEmptyDom('user-member-list'));
staleTodo && staleTodo.cb(snapshotOf(staleTodo.query));
staleTrips && staleTrips.cb(snapshotOf(staleTrips.query));
await settle();
check('[늦은 콜백] 해제된 업무·출장 콜백 호출이 데이터를 복구하지 않음', !Object.keys(AppStore.getTasks()).length && !Object.keys(AppStore.getTrips()).length);

// A → B 전환 (signOut 없이 onAuthStateChanged 가 바로 B 로 오는 경우도 확인)
await signIn('uA');
auth.currentUser = { uid: 'uB', email: 'b@example.com', displayName: 'B' }; propagate(null);
auth._cbs.forEach(cb => cb(auth.currentUser)); await settle();
check('[A→B 직접 전환] A 알림 구독 없음', !activePaths().includes('tasks/notifications/uA'), activePaths().join(','));
check('[A→B 직접 전환] B 알림 구독 있음', activePaths().includes('tasks/notifications/uB'));
check('[A→B 직접 전환] A 프로필 구독 없음', !activePaths().includes('users/uA'));
check('[A→B 직접 전환] A 알림 데이터 없음', !Object.keys(AppStore.getNotifications() || {}).includes('n1'));
check('[A→B 직접 전환] 활성 리스너 수가 A 기준선과 동일 (누적 없음)', active().length === baselineApproved, `${baselineApproved} vs ${active().length}`);

// 승인 해제 (관리자가 B 를 해제)
await db.ref('users/uB').update({ approved: false }); await settle();
check('[B 승인 해제] 업무 리스너 0건', activeBusiness().length === 0, activePaths().join(','));
check('[B 승인 해제] 본인 프로필 감시 1건 유지', active().filter(r => r.query.path === 'users/uB').length === 1, activePaths().join(','));
check('[B 승인 해제] 업무 데이터 비움', !Object.keys(AppStore.getTasks()).length && !Object.keys(AppStore.getTrips()).length && !Object.keys(run('allFilesData')).length);

// 재승인
await db.ref('users/uB').update({ approved: true }); await settle();
check('[B 재승인] 새로고침 없이 업무·출장·연차·파일·소모품 복구',
    Object.keys(AppStore.getTasks()).includes('t1') && Object.keys(AppStore.getTrips()).includes('b1') && Object.keys(AppStore.getLeaves()).includes('l1')
    && Object.keys(run('allFilesData')).includes('f1') && Object.keys(run('allConsumablesData')).includes('c1'));
check('[B 재승인] 활성 리스너 수가 기준선과 동일', active().length === baselineApproved, `${baselineApproved} vs ${active().length}`);

// 반복 전환
for (let i = 0; i < 5; i++) {
    await signIn(i % 2 ? 'uA' : 'uB');
    await db.ref(`users/${i % 2 ? 'uA' : 'uB'}`).update({ approved: false }); await settle();
    await db.ref(`users/${i % 2 ? 'uA' : 'uB'}`).update({ approved: true }); await settle();
    await db.ref(`users/${i % 2 ? 'uA' : 'uB'}`).update({ displayName: 'x' + i }); await settle();
}
await signIn('uA');
const p2 = activePaths().join('|');
check('[반복 5회 후] 활성 리스너 수 = 기준선', active().length === baselineApproved, `${baselineApproved} vs ${active().length}`);
check('[반복 5회 후] 활성 리스너 경로 구성 = 기준선', p2 === baselinePaths.replace(/users\/uA/g, 'users/uA'));
// users 전체 경로는 의도적으로 2개 키로 구독한다: 'users'(조직도·AppStore) + 'adminUsers'(관리자 승인 목록, listenForUsers)
const KNOWN_PAIR = JSON.stringify(['users', null, null, null]);
const dupe = Object.entries(active().reduce((m, r) => { const k = JSON.stringify([r.query.path, r.query._oc ?? null, r.query._eq ?? null, r.query._lim ?? null]); m[k] = (m[k] || 0) + 1; return m; }, {}))
    .filter(([k, n]) => n > (k === KNOWN_PAIR ? 2 : 1));
check('[반복 5회 후] 동일 쿼리 중복 등록 없음 (실제 등록 기준, users 2키 구성 제외)', dupe.length === 0, JSON.stringify(dupe));
check('[반복 5회 후] 권한 거부로 취소된 리스너 0건', counters.denied === 0, counters.deniedPaths.join(','));
const pcRegs = active().filter(r => r.query.path.startsWith('privateChats/'));
check(`[채팅 구독] 개인채팅 리스너 ${pcRegs.length}건 모두 본인 참여 방만 대상`, pcRegs.length > 0 && pcRegs.every(r => { const id = seg(r.query.path)[1]; return id.startsWith(auth.currentUser.uid + '_') || id.endsWith('_' + auth.currentUser.uid); }));
// 관찰: 1:1 채팅 창 닫기(query.off() 무인자)가 같은 쿼리의 알림 리스너까지 제거하는지
run("openPrivateChat('uB', 'B')"); await settle();
run('closePrivateChat()'); await settle();
const chatId = run("getPrivateChatId('uA','uB')");
const notiAlive = active().some(r => r.query.path === 'privateChats/' + chatId);
check('[1:1 채팅 닫기] 같은 채팅의 알림 리스너 유지 (모의 off() 는 동일 쿼리 전체 제거로 모델링)', notiAlive);
check('[1:1 채팅 닫기] 채팅창 리스너는 해제', active().filter(r => r.query.path === 'privateChats/' + chatId).length === 1);
// 공지 상세: 다른 공지로 전환·닫기 시 이전 공지의 댓글·좋아요 리스너 해제
await db.ref('notices/n2').set({ title: '공지2', content: 'y', timestamp: 2 }); await settle();
run("viewNotice('n1')"); await settle();
run("viewNotice('n2')"); await settle();
check('[공지 전환] 이전 공지(n1) 댓글·좋아요 리스너 해제', !active().some(r => r.query.path.startsWith('notices/n1/')), activePaths().filter(p => p.startsWith('notices/')).join(','));
check('[공지 전환] 현재 공지(n2) 댓글·좋아요 리스너 각 1건', active().filter(r => r.query.path.startsWith('notices/n2/')).length === 2);
run('closeNoticeModal()'); await settle();
check('[공지 닫기] 공지 상세 리스너 0건', !active().some(r => /^notices\/[^/]+\//.test(r.query.path)), activePaths().filter(p => p.startsWith('notices/')).join(','));
// 소모품 이력: 열기 2회·닫기 후 리스너 0건
await run('openConsumablesLogModal()'); await settle(); await run('openConsumablesLogModal()'); await settle();
check('[소모품 이력 2회 열기] consumablesLog 리스너 1건', active().filter(r => r.query.path === 'consumablesLog').length === 1);
run('closeConsumablesLogModal()'); await settle();
check('[소모품 이력 닫기] consumablesLog 리스너 0건', !active().some(r => r.query.path === 'consumablesLog'));
await authApi.signOut(); await settle();
check('[최종 로그아웃] on 누적 = off 누적 + 서버취소 + 최초거부 (등록 추적 일관성), 활성 0', counters.on === counters.off + counters.revoked + counters.denied && active().length === 0, `on=${counters.on} off=${counters.off} revoked=${counters.revoked} denied=${counters.denied} active=${active().length}`);

// 관리자: 사용자 목록 리스너 중복 여부
await signIn(ADMIN);
await db.ref(`users/${ADMIN}`).update({ displayName: 'Admin2' }); await settle();
await db.ref(`users/${ADMIN}`).update({ displayName: 'Admin3' }); await settle();
check('[관리자 프로필 2회 수정] users 전체 리스너 2건(관리자목록+조직도) 초과 없음', active().filter(r => r.query.path === 'users').length <= 2,
    String(active().filter(r => r.query.path === 'users').length));

// 연차: 실제 앱 함수가 만드는 쓰기가 규칙 모델을 통과하는지 (보안 2차-4)
// config.js 의 customConfirm/customPrompt 는 const 라 교체하지 않고, 실제 모달의 확인 버튼을 누르는 방식으로 응답한다
const dialogLog = [];
const autoClicker = setInterval(() => {
    const modal = document.getElementById('alertModal'); const btn = document.getElementById('alertConfirmBtn');
    if (modal.style.display === 'flex' && typeof btn.onclick === 'function') {
        dialogLog.push(document.getElementById('alertMessage').textContent);
        if (document.getElementById('alertInput').style.display === 'block') document.getElementById('alertInput').value = '사유';
        btn.onclick();
    }
}, 5);
await signIn('uA');
document.getElementById('leaveIsRange').checked = false;
document.getElementById('leaveStartDate').value = '2026-12-01'; document.getElementById('leaveType').value = '1';
writeLog.length = 0;
await run('applyLeave()'); await settle();
const myNew = Object.values(getAt('leaves') || {}).find(l => l.uid === 'uA' && l.date === '2026-12-01');
check('[연차·앱] 직원 신청(applyLeave) → 규칙 통과, 승인대기로 저장', !!myNew && myNew.status === 'pending' && writeLog.every(w => w.ok), JSON.stringify(writeLog));
writeLog.length = 0;
await run(`cancelLeave('${myNew.id}')`); await settle();
check('[연차·앱] 승인대기 취소(cancelLeave) → 규칙 통과, 삭제됨', getAt(`leaves/${myNew.id}`) === null && writeLog.length > 0 && writeLog.every(w => w.ok), JSON.stringify(writeLog));
const sneaky = await db.ref('leaves/l1').update({ status: 'approved' }).then(() => 'ok', () => 'denied');
check('[연차·직접시도] 직원이 본인 대기 건을 승인으로 변경 → 거부', sneaky === 'denied' && getAt('leaves/l1/status') === 'pending');
await signIn(ADMIN);
await db.ref('leaves/l1').update({ status: 'pending' });
writeLog.length = 0;
await run("adminResolveLeave('l1', 'approved', 'pending')"); await settle();
check('[연차·앱] 관리자 승인(adminResolveLeave) → 규칙 통과', getAt('leaves/l1/status') === 'approved' && writeLog.every(w => w.ok), JSON.stringify(writeLog));
await signIn('uA');
writeLog.length = 0;
await run("cancelLeave('l1')"); await settle();
check('[연차·앱] 승인 건 취소 요청(cancelLeave) → 규칙 통과, cancel_requested', getAt('leaves/l1/status') === 'cancel_requested' && writeLog.every(w => w.ok), JSON.stringify(writeLog));
await signIn(ADMIN);
writeLog.length = 0;
await run("adminResolveLeave('l1', 'approved', 'cancel_requested')"); await settle();
check('[연차·앱] 관리자 취소 승인(삭제) → 규칙 통과', getAt('leaves/l1') === null && writeLog.every(w => w.ok), JSON.stringify(writeLog));
clearInterval(autoClicker);
await signIn(ADMIN);

// 관리자 3명: 관리자 탭 표시 (config.js ADMIN_UIDS 2개 + ADMIN_EMAILS 1개)
const adminTab = () => document.getElementById('tab-btn-admin').style.display;
await db.ref('users/hiPMcfj1OvWuq6PjedfPFvOLxlp2').set({ displayName: 'Admin2', approved: true, leaveTotal: 15 });
await db.ref('users/uCompany').set({ displayName: 'Company', approved: true, leaveTotal: 15 });
for (const [uid, email, want] of [[ADMIN, null, 'flex'], ['hiPMcfj1OvWuq6PjedfPFvOLxlp2', null, 'flex'], ['uCompany', 'contact@faww.co.kr', 'flex'], ['uA', null, 'none']]) {
    await signIn(uid, email);
    check(`[관리자 탭] ${email || uid} → ${want}`, adminTab() === want, adminTab());
}
await signIn(ADMIN);
// 배차 리스너: 쿠팡 모드 유지
let briefingMode = null;
run('window.showBriefingTrips = function(m){ globalThis.__bm = m; }; showBriefingTrips = window.showBriefingTrips;');
document.getElementById('briefingTripsModal').style.display = 'flex';
document.getElementById('btnCoupangTrips').style.background = 'var(--primary)';
await db.ref('tripVehicles/v2').set({ car: '2호차' }); await settle();
briefingMode = run('globalThis.__bm');
check('[배차 갱신] 쿠팡 모드 화면이면 쿠팡 모드로 다시 그림', briefingMode === 'coupang', String(briefingMode));
await authApi.signOut(); await settle();

// ---------------------------------------------------------------- 2글자 이름(민홍) 인식: 팀 현황 사이드바
{
    await signIn(ADMIN);
    const d = new Date(); const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await db.ref('users/uHong').set({ displayName: '민홍', email: 'h@x.com', approved: true, leaveTotal: 15 });
    const statusOf = (name) => {
        run('renderTeamStatusSidebar()');
        const card = document.getElementById('team-status-list')._children.slice().reverse()
            .find(c => (c._children[0] && c._children[0]._children || []).some(x => x.textContent === name));
        return card ? card._children[1].innerHTML : '(카드 없음)';
    };
    await db.ref('businessTrips/tH').set({ name: '텔러스 강의', assignee: '홍', date: today }); await settle();
    check("[이름] 출장 담당자가 '홍' → 민홍 '출장'", statusOf('민홍').includes('출장'), statusOf('민홍'));
    await db.ref('businessTrips/tH').set({ name: '텔러스 강의', assignee: '성진, 홍', date: today }); await settle();
    check("[이름] 담당자가 '성진, 홍' → 민홍 '출장'", statusOf('민홍').includes('출장'), statusOf('민홍'));
    await db.ref('businessTrips/tH').set(null);
    await db.ref('businessTrips/tP').set({ name: '홍보 행사', assignee: '홍보팀', date: today }); await settle();
    check("[이름] 담당자가 '홍보팀' → 민홍 오인 안 함(사무실)", statusOf('민홍').includes('사무실'), statusOf('민홍'));
    await db.ref('businessTrips/tP').set(null);
    await db.ref('external_events/eH').set({ title: '[출장] 홍 부산', startDate: today, dueDate: today }); await settle();
    check("[이름] 캘린더 일정 제목 '[출장] 홍 부산' → 민홍 '출장'", statusOf('민홍').includes('출장'), statusOf('민홍'));
    await db.ref('external_events/eH').set(null); await db.ref('users/uHong').set(null); await settle();
}

// ---------------------------------------------------------------- 날짜 표기 (실제 렌더 경로)
{
    await signIn(ADMIN);
    const y = new Date().getFullYear();
    await db.ref('tasks/kDateT').set({ title: '날짜확인업무', status: 'todo', dueDate: `${y}-10-06`, assignee: 'A' });
    await db.ref('leaves/kDateL').set({ id: 'kDateL', uid: 'uA', userName: 'A', date: `${y}-10-06`, type: 1, subType: '1', status: 'pending', timestamp: 1 });
    await settle(); run('renderTasks()'); run('renderAdminLeaves()'); await settle();
    const wd = '일월화수목금토'[new Date(y, 9, 6).getDay()];
    const html = allEls.map(e => e._innerHTML || '').join('\n');
    check(`[날짜] 업무 카드 마감일이 짧은형(10/6 (${wd}))으로 표시`, html.includes(`마감일 10/6 (${wd})`) || html.includes(`마감지연 10/6 (${wd})`));
    check(`[날짜] 관리자 연차 목록이 짧은형으로 표시`, (document.getElementById('admin-pending-leaves-list')._innerHTML || '').includes(`10/6 (${wd})`));
    check('[날짜] 원래 형식(YYYY-MM-DD)이 업무 카드에 남지 않음', !html.includes(`마감일 ${y}-10-06`) && !html.includes(`마감지연 ${y}-10-06`));
    await db.ref('tasks/kDateT').set(null); await db.ref('leaves/kDateL').set(null); await settle();
}

// ---------------------------------------------------------------- XSS 회귀 테스트
// 사용자가 쓸 수 있는 모든 필드에 공격 문자열을 넣고 실제 렌더 함수를 돌린 뒤, 앱이 만든 모든 요소의 innerHTML 에
// 날것의 공격 문자열이 남아 있는지 검사한다. (태그 / 속성 탈출 / JS 문자열 탈출 3종)
const P_TAG = '<img src=x onerror=PWN1>';
const P_ATTR = 'q" onmouseover="PWN2';
const P_JS = "q');PWN3();//";
const P = `${P_TAG}${P_ATTR}${P_JS}`;
const RAW_MARKERS = ['<img src=x onerror=PWN1', 'onmouseover="PWN2', "');PWN3"];
await signIn(ADMIN);
await db.ref('users/uX').set({ displayName: P, email: P, department: 'unassigned', approved: false, leaveTotal: 15, photoURL: 'javascript:PWN4' });
await db.ref('users/uY').set({ displayName: P, email: 'y@x.com', approved: true, leaveTotal: 15, photoURL: '" onerror="PWN5' });
const tid = P_JS;  // 레코드 키에도 공격 문자열
await db.ref('tasks/' + 'kTask').set({ title: P, description: P, assignee: `${P}, A`, status: 'todo', dueDate: P, startDate: P, priority: 'high', badgesHtml: P_TAG });
await db.ref('tasks/' + 'kDone').set({ title: P, assignee: P, status: 'done', dueDate: '2026-10-01' });
await db.ref('tasks/kArch').set({ title: P, assignee: P, description: P, status: 'archived', dueDate: P, startDate: P });
await db.ref('tasks/kFeed').set({ status: 'feed', description: P, author: P, timestamp: Date.now(), acknowledgments: { a: { name: P } } });
await db.ref('businessTrips/kTrip').set({ name: P, address: P, assignee: P, date: '2026-10-09', bookedHotel: P, category: P });
await db.ref('leaves/kLeave').set({ id: 'kLeave', uid: 'uY', userName: P, date: P, type: 1, subType: '1', status: 'pending', timestamp: 1, rejectReason: P });
await db.ref('leaves/kLeave2').set({ id: 'kLeave2', uid: ADMIN, userName: P, date: P, type: 1, subType: '1', status: 'rejected', timestamp: 2, rejectReason: P });
await db.ref('files/kFile').set({ name: P, uploader: P, url: 'javascript:PWN6', path: '', timestamp: 1, type: 'file' });
await db.ref('files/kFile2').set({ name: P, uploader: P, url: 'https://example.com/a', path: P, timestamp: 3, type: 'file' });
await db.ref('files/kFolder').set({ name: P, isFolder: true, timestamp: 2 });
await db.ref('notices/kNotice').set({ title: P, content: P, author: P, timestamp: 1, views: P, comments: { c1: { author: P, content: P, timestamp: 1, uid: 'uY' } } });
await db.ref('businessCommunications/kComm').set({ title: P, summary: P, sender: P, category: P, categoryLabel: P, timestamp: Date.now() });
await db.ref('consumables/kCon').set({ name: P, unit: P, currentStock: P, threshold: 1 });
await db.ref('consumablesLog/kLog').set({ itemName: P, operator: P, change: P, newStock: P, timestamp: 1 });
await db.ref('external_events/kExt').set({ title: P, assignee: P, date: '2026-10-09', startDate: '2026-10-09' });
await db.ref(`tasks/notifications/${ADMIN}/kN`).set({ title: P, message: P, timestamp: Date.now() });
// 날짜 표시 변환은 해석 못 한 값을 원문 그대로 돌려주므로, 날짜·타임스탬프 칸에도 공격 문자열을 넣어 본다
await db.ref(`tasks/notifications/${ADMIN}/kN2`).set({ title: 't', message: 'm', timestamp: P });
await db.ref('consumablesLog/kLog2').set({ itemName: 'x', operator: 'y', change: 1, newStock: 1, timestamp: P });
await db.ref('businessCommunications/kComm2').set({ title: 't', summary: 's', sender: 'x', timestamp: P });
await db.ref('notices/kNotice2').set({ title: 't', content: 'c', author: 'a', timestamp: P, comments: { c2: { author: 'a', content: 'c', timestamp: P, uid: 'uY' } } });
await db.ref('businessTrips/kTrip2').set({ name: 't', address: 'a', assignee: 'A', date: P });
await db.ref('businessTrips/kTrip3').set({ name: 't', address: 'a', assignee: 'A', date: `2026-10-09 ~ ${P}` });
await db.ref('chatMessages/kChat').set({ uid: 'uY', sender: P, text: P, timestamp: Date.now() });
await settle();
const renderCalls = ['renderTasks()', 'renderTripList()', 'renderLeaveUI()', 'renderAdminLeaves()', 'renderMyPage()', 'renderFiles()',
    'renderMembersDirectory()', 'renderChatList()', 'renderNotices()', "viewNotice('kNotice')", "viewNotice('kNotice2')", 'renderNotifications()',
    'renderMeetingFeedUI()', 'renderConsumables()', 'openConsumablesLogModal()', 'openArchiveModal()', 'generateAiBriefing()'];
const renderErrors = [];
for (const c of renderCalls) { try { await run(c); } catch (e) { renderErrors.push(`${c}: ${e.message}`); } }
await settle();
const leaks = [];
for (const el of allEls) {
    const h = el._innerHTML || '';
    for (const m of RAW_MARKERS) if (h.includes(m)) leaks.push(`${el.id || '(무명요소)'} ← ${m} :: ${h.slice(Math.max(0, h.indexOf(m) - 60), h.indexOf(m) + 40).replace(/\s+/g, ' ')}`);
    if (/(src|href)="javascript:/i.test(h)) leaks.push(`${el.id || '(무명요소)'} ← javascript: URL`);
    if (h.includes('src="" onerror="PWN5')) leaks.push(`${el.id || '(무명요소)'} ← photoURL 속성 탈출`);
}
const sampleHas = (id, needle) => (document.getElementById(id)._innerHTML + document.getElementById(id)._children.map(c => c._innerHTML || '').join('')).includes(needle);
check('[XSS] 렌더 함수 실행 중 예외 없음', renderErrors.length === 0, renderErrors.join(' | '));
check(`[XSS] 앱이 만든 요소 ${allEls.length}개 중 날것의 공격 문자열 0건`, leaks.length === 0, leaks.slice(0, 6).join('\n      '));
check('[XSS] 관리자 승인 목록에 이름이 글자로 표시됨 (이스케이프 확인)', sampleHas('user-approval-list', '&lt;img src=x onerror=PWN1&gt;'));
check('[XSS] 업무 소통(메일 제목)이 글자로 표시됨', sampleHas('communication-list', '&lt;img src=x onerror=PWN1&gt;'));
check('[XSS] 일반 업무의 DB badgesHtml 은 그리지 않음', !allEls.some(el => (el._innerHTML || '').includes(P_TAG)));
const opened = []; ctx.open = (u) => opened.push(u); run('window.open = globalThis.open');
await run("openDriveFile('kFile')"); await settle();
check('[XSS] DB의 javascript: 파일 주소는 열지 않음', opened.length === 0, opened.join(','));

__finished = true;
const failed = results.filter(r => !r.ok);
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과, ${failed.length} 실패`);
process.exit(failed.length ? 1 : 0);
