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
    async set(v) { setAt(this.path, v); propagate(this.path); }
    async update(o) { for (const k of Object.keys(o)) setAt(this.path + '/' + k, o[k]); propagate(this.path); }
    async remove() { setAt(this.path, null); propagate(this.path); }
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
process.on('uncaughtException', (e) => { appErrors.push('uncaught: ' + (e && e.stack || e)); });
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

const failed = results.filter(r => !r.ok);
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과, ${failed.length} 실패`);
process.exit(failed.length ? 1 : 0);
