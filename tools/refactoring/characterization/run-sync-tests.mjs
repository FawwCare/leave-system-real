/**
 * Google 캘린더 → external_events 동기화 검증 (fetchGoogleCalendarEvents 외)
 *
 * - 실제 public/services/services.js를 vm 컨텍스트에 로드해 실제 함수를 실행한다. (구현 복사본 사용 안 함)
 * - 테스트마다 새 컨텍스트 · 새 mock DB를 만들어 이전 테스트 상태를 참조하지 않는다.
 * - mock DB의 snapshot/transaction은 조회 당시의 독립 복사본을 사용한다.
 * - transaction mock은 Firebase처럼 "읽은 값과 커밋 시점 값이 다르면 콜백을 재실행"한다.
 * - 운영 Google/Firebase에는 접근하지 않는다. (fetch · db 모두 mock)
 *
 * 실행: node tools/refactoring/characterization/run-sync-tests.mjs
 * 실패 강제(종료 코드 검증용): SYNC_TEST_FORCE_FAIL=1 node .../run-sync-tests.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// SYNC_TEST_SERVICES_PATH: 이전 구현(v2 등)에 대해 테스트가 실패를 검출하는지 확인할 때만 사용
const SERVICES_PATH = process.env.SYNC_TEST_SERVICES_PATH
    ? path.resolve(process.env.SYNC_TEST_SERVICES_PATH)
    : path.join(__dirname, '../../../public/services/services.js');
const servicesCode = fs.readFileSync(SERVICES_PATH, 'utf-8');
const VERBOSE = process.env.SYNC_TEST_VERBOSE === '1';

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const tick = () => new Promise((r) => setImmediate(r));
function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}
async function waitFor(cond, label) {
    for (let i = 0; i < 500; i++) {
        if (cond()) return;
        await tick();
    }
    throw new Error(`waitFor timeout: ${label}`);
}

const CAL_LIST_PATH = '/calendar/v3/users/me/calendarList';
const CAL_CREATE_PATH = '/calendar/v3/calendars';

function gEvent(id, summary, date, extra = {}) {
    return { id, summary, start: { date }, ...extra };
}

/**
 * 테스트 하네스: 실제 services.js + mock fetch/DB/auth/localStorage
 */
function createHarness(opts = {}) {
    const h = {
        db: { external_events: clone(opts.initialDb || {}) },
        toasts: [],
        logs: [],
        fetchCalls: [],
        txCalls: [],      // transaction() 호출 (경로, applyLocally)
        txAttempts: [],   // 콜백 실행 (재시도 포함)
        txWrites: [],     // 커밋된 transaction 쓰기
        directWrites: [], // update/set/remove 호출 (external_events에는 0건이어야 함)
        storage: { google_access_token: opts.token ?? 'token-A' },
        removedKeys: [],
        hooks: {
            onFetch: null,       // async (call, h) => void : 응답 반환 전 실행 (계정 전환·로그아웃 등)
            afterTxRead: null,   // (id, attempt, readValue, h) => void : transaction 읽기 후 커밋 전 (다른 클라이언트 쓰기)
            afterOnceRead: null, // (path, h) => void : once() 읽기 직후 (일괄 조회 방식 구현 검출용)
            afterTxCommit: null, // (id, commitIndex, h) => void
            txFail: null         // (id, h) => boolean : true면 transaction reject
        },
        google: {
            calendarPages: opts.calendarPages || [{ items: [{ id: 'faww-cal', summary: 'FAWW' }] }],
            calendarStatusByToken: opts.calendarStatusByToken || {},
            eventPages: opts.eventPages || [{ items: [gEvent('evt-1', 'Event 1', '2026-10-01')] }],
            eventStatusByToken: opts.eventStatusByToken || {},
            unauthorizedTokens: new Set(opts.unauthorizedTokens || []),
            createdCalendar: { id: 'created-faww', summary: 'FAWW' }
        }
    };

    const pageIndex = (pages) => {
        const map = { '': 0 };
        pages.forEach((p, i) => { if (p.nextPageToken) map[p.nextPageToken] = i + 1; });
        return map;
    };
    const json = (status, body) => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => clone(body),
        text: async () => JSON.stringify(body)
    });

    h.route = (call) => {
        const g = h.google;
        if (g.unauthorizedTokens.has((call.auth || '').replace('Bearer ', ''))) return json(401, { error: 'unauthorized' });

        if (call.path === CAL_LIST_PATH) {
            const token = call.params.pageToken || '';
            if (g.calendarStatusByToken[token]) return json(g.calendarStatusByToken[token], { error: 'fail' });
            const idx = pageIndex(g.calendarPages)[token];
            if (idx === undefined) return json(400, { error: 'unknown pageToken' });
            return json(200, g.calendarPages[idx]);
        }
        if (call.method === 'POST' && call.path === CAL_CREATE_PATH) {
            return json(200, g.createdCalendar);
        }
        const m = call.path.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events$/);
        if (m) {
            const token = call.params.pageToken || '';
            if (g.eventStatusByToken[token]) return json(g.eventStatusByToken[token], { error: 'fail' });
            const idx = pageIndex(g.eventPages)[token];
            if (idx === undefined) return json(400, { error: 'unknown pageToken' });
            return json(200, g.eventPages[idx]);
        }
        return json(404, { error: 'not found' });
    };

    const node = (id) => (h.db.external_events[id] === undefined ? null : h.db.external_events[id]);
    // update/set/remove를 mock DB에 실제 적용 (external_events 하위만 추적)
    const setPath = (fullPath, value) => {
        const parts = String(fullPath).split('/').filter(Boolean);
        if (parts[0] !== 'external_events') return;
        if (parts.length === 1) { h.db.external_events = clone(value || {}); return; }
        if (parts.length === 2) {
            if (value === null || value === undefined) delete h.db.external_events[parts[1]];
            else h.db.external_events[parts[1]] = clone(value);
            return;
        }
        const obj = h.db.external_events[parts[1]] || (h.db.external_events[parts[1]] = {});
        if (value === null || value === undefined) delete obj[parts[2]];
        else obj[parts[2]] = clone(value);
    };
    let commitCount = 0;

    const makeRef = (rawPath) => {
        const refPath = rawPath ? String(rawPath).replace(/^\/+/, '') : '';
        const parts = String(refPath).split('/');
        const isItem = parts.length === 2 && parts[0] === 'external_events';
        const id = isItem ? parts[1] : null;
        const ref = {
            transaction: async (updateFn, onComplete, applyLocally) => {
                h.txCalls.push({ path: refPath, applyLocally });
                await tick();
                if (h.hooks.txFail && h.hooks.txFail(id, h)) {
                    throw new Error('PERMISSION_DENIED (simulated)');
                }
                for (let attempt = 0; attempt < 25; attempt++) {
                    const readValue = clone(node(id)); // 조회 당시의 독립 복사본
                    const proposed = updateFn(clone(readValue));
                    h.txAttempts.push({ id, attempt, read: clone(readValue), proposed: clone(proposed) });
                    if (h.hooks.afterTxRead) h.hooks.afterTxRead(id, attempt, readValue, h);
                    if (proposed === undefined) {
                        return { committed: false, snapshot: { val: () => clone(node(id)) } };
                    }
                    // Firebase: 서버 값이 읽은 값과 다르면 최신 값으로 콜백 재실행
                    if (JSON.stringify(node(id)) !== JSON.stringify(readValue)) continue;
                    h.db.external_events[id] = clone(proposed);
                    h.txWrites.push({ id, value: clone(proposed) });
                    commitCount++;
                    if (h.hooks.afterTxCommit) h.hooks.afterTxCommit(id, commitCount, h);
                    const committedValue = clone(proposed);
                    return { committed: true, snapshot: { val: () => clone(committedValue) } };
                }
                throw new Error('maxretry');
            },
            once: async () => {
                const v = refPath === 'external_events' ? clone(h.db.external_events) : (isItem ? clone(node(id)) : null);
                await tick();
                if (h.hooks.afterOnceRead) h.hooks.afterOnceRead(refPath, h);
                return { val: () => clone(v), exists: () => v !== null };
            },
            update: async (v) => {
                h.directWrites.push({ op: 'update', path: refPath, v: clone(v) });
                await tick();
                for (const [k, val] of Object.entries(v || {})) setPath(`${refPath}/${k}`, val);
            },
            set: async (v) => { h.directWrites.push({ op: 'set', path: refPath, v: clone(v) }); await tick(); setPath(refPath, v); },
            remove: async () => { h.directWrites.push({ op: 'remove', path: refPath }); await tick(); setPath(refPath, null); },
            push: () => ({ key: 'k', set: async () => {} }),
            on: () => {},
            off: () => {},
            orderByKey: () => ref,
            orderByChild: () => ref,
            limitToLast: () => ref,
            equalTo: () => ref
        };
        return ref;
    };

    const sandbox = {
        URL,
        URLSearchParams,
        setTimeout,
        clearTimeout,
        setInterval: () => 0,
        clearInterval: () => {},
        showToast: (msg, type) => h.toasts.push({ msg: String(msg), type }),
        console: {
            log: (...a) => { h.logs.push(a.join(' ')); if (VERBOSE) console.log('  [app]', ...a); },
            warn: (...a) => { h.logs.push(a.join(' ')); if (VERBOSE) console.warn('  [app]', ...a); },
            error: (...a) => { h.logs.push(a.map(String).join(' ')); if (VERBOSE) console.error('  [app]', ...a); }
        },
        updateGoogleSyncUI: () => {},
        htmlToPlainText: (html) => String(html).replace(/<[^>]*>?/gm, ''),
        db: { ref: makeRef },
        fetch: async (url, options = {}) => {
            const u = new URL(url);
            const call = {
                url,
                method: options.method || 'GET',
                path: u.pathname,
                params: Object.fromEntries(u.searchParams),
                auth: options.headers && options.headers.Authorization
            };
            h.fetchCalls.push(call);
            await tick();
            if (h.hooks.onFetch) await h.hooks.onFetch(call, h);
            return h.route(call);
        },
        auth: { currentUser: opts.uid === null ? null : { uid: opts.uid || 'user-A' } },
        document: { getElementById: () => null, addEventListener: () => {}, querySelectorAll: () => [] },
        window: { addEventListener: () => {} },
        localStorage: {
            getItem: (k) => (h.storage[k] === undefined ? null : h.storage[k]),
            setItem: (k, v) => { h.storage[k] = String(v); },
            removeItem: (k) => { h.removedKeys.push({ k, value: h.storage[k] }); delete h.storage[k]; }
        },
        AppStore: { setExternalEvents: () => {} }
    };

    vm.createContext(sandbox);
    vm.runInContext(servicesCode, sandbox, { filename: 'services.js' });

    h.sandbox = sandbox;
    // services.js의 `let googleAccessToken`은 전역 렉시컬 바인딩이므로 sandbox 속성이 아닌 컨텍스트 코드로 읽고 쓴다.
    h.run = (code) => vm.runInContext(code, sandbox);
    h.getToken = () => h.run('googleAccessToken');
    h.setToken = (t) => {
        h.run(`googleAccessToken = ${JSON.stringify(t)};`);
        if (t) h.storage.google_access_token = t; else delete h.storage.google_access_token;
    };
    h.isSyncing = () => h.run('isSyncingGoogleCalendar');
    h.switchAccount = (uid, token) => {
        sandbox.auth.currentUser = uid ? { uid } : null;
        if (token !== undefined) h.setToken(token);
    };
    // main.js logout()과 동일한 순서: 토큰 삭제 → 세션 무효화 → auth.signOut()
    h.logout = () => {
        sandbox.localStorage.removeItem('google_access_token');
        h.run('googleAccessToken = null; invalidateGoogleSyncSession();');
        sandbox.auth.currentUser = null;
    };
    h.sync = () => sandbox.fetchGoogleCalendarEvents();
    h.successToasts = () => h.toasts.filter((t) => t.type === 'success');
    h.errorToasts = () => h.toasts.filter((t) => t.type === 'error');
    h.calls = (pred) => h.fetchCalls.filter(pred);
    h.calListCalls = () => h.calls((c) => c.path === CAL_LIST_PATH);
    h.createCalls = () => h.calls((c) => c.method === 'POST' && c.path === CAL_CREATE_PATH);
    h.eventCalls = () => h.calls((c) => /\/events$/.test(c.path));
    h.externalDirectWrites = () => h.directWrites.filter((w) => String(w.path).startsWith('external_events'));
    return h;
}

// ---------------------------------------------------------------------------
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ===== 기존 테스트 (v2의 4개를 transaction 구조에 맞게 유지) =====

test('[기존1] 기존 일정은 Google 관리 필드만 갱신하고 담당자·상태 등 앱 관리 필드를 보존', async () => {
    const h = createHarness({
        initialDb: {
            'evt-1': { id: 'evt-1', title: 'Old Title', location: '', assignee: 'Alice', status: 'done', priority: 'high', type: 'task', memo: 'keep' }
        },
        eventPages: [{ items: [gEvent('evt-1', 'Event 1', '2026-10-01', { location: 'Seoul', description: '<b>desc</b>' })] }]
    });
    await h.sync();
    const e = h.db.external_events['evt-1'];
    assert.ok(e.title.includes('Event 1'), 'title 갱신');
    assert.strictEqual(e.location, 'Seoul', 'location 갱신');
    assert.strictEqual(e.description, 'desc', 'description 갱신');
    assert.strictEqual(e.startDate, '2026-10-01');
    assert.strictEqual(e.dueDate, '2026-10-01');
    assert.strictEqual(e.assignee, 'Alice', 'assignee 보존');
    assert.strictEqual(e.status, 'done', 'status 보존');
    assert.strictEqual(e.priority, 'high', 'priority 보존');
    assert.strictEqual(e.memo, 'keep', '기타 앱 필드 보존');
    assert.strictEqual(h.externalDirectWrites().length, 0, 'external_events에 update/set 직접 쓰기 없음');
    assert.strictEqual(h.successToasts().length, 1, '성공 알림 1회');
});

test('[기존2→변경] DB 저장 실패 시 중단: 성공 알림 없음 (v2의 "DB 조회 실패 중단"은 일괄 조회 제거로 transaction 실패로 대체)', async () => {
    const h = createHarness({
        initialDb: { 'evt-1': { id: 'evt-1', title: 'Old', assignee: 'Alice', status: 'done' } }
    });
    h.hooks.txFail = () => true;
    await h.sync();
    assert.strictEqual(h.txWrites.length, 0, '커밋 0건');
    assert.strictEqual(h.db.external_events['evt-1'].assignee, 'Alice', '기존 값 유지');
    assert.strictEqual(h.successToasts().length, 0, '성공 알림 없음');
    assert.strictEqual(h.errorToasts().length, 1, '오류 알림 1회');
});

test('[기존3] 일정 목록 페이지 처리: 현재 실행에서 1페이지·2페이지 일정을 각각 반영 + pageToken 인코딩', async () => {
    const rawToken = 'evt p2/+&=?';
    const h = createHarness({
        eventPages: [
            { items: [gEvent('evt-1', 'Event 1', '2026-10-01')], nextPageToken: rawToken },
            { items: [gEvent('evt-2', 'Page 2 Event', '2026-10-10')] }
        ]
    });
    await h.sync();
    const written = h.txWrites.map((w) => w.id);
    assert.ok(written.includes('evt-1'), '1페이지 일정 evt-1 커밋');
    assert.ok(written.includes('evt-2'), '2페이지 일정 evt-2 커밋');
    assert.ok(h.db.external_events['evt-1'].title.includes('Event 1'), 'evt-1 DB 반영');
    assert.ok(h.db.external_events['evt-2'].title.includes('Page 2 Event'), 'evt-2 DB 반영');
    const evCalls = h.eventCalls();
    assert.strictEqual(evCalls.length, 2, 'events 요청 2회');
    assert.strictEqual(evCalls[1].params.pageToken, rawToken, 'pageToken 원문 그대로 전달');
    assert.ok(evCalls[1].url.includes('%26') && evCalls[1].url.includes('%2F'), '특수문자 인코딩');
    assert.ok(evCalls[0].params.timeMin && evCalls[0].params.timeMax, 'timeMin/timeMax 유지');
});

test('[기존4] 일정 목록 2페이지 실패 시 DB 쓰기 0건 (부분 저장 없음)', async () => {
    const h = createHarness({
        eventPages: [
            { items: [gEvent('evt-1', 'Event 1', '2026-10-01')], nextPageToken: 'p2' },
            { items: [gEvent('evt-2', 'Page 2 Event', '2026-10-10')] }
        ],
        eventStatusByToken: { p2: 500 }
    });
    await h.sync();
    assert.strictEqual(h.txCalls.length, 0, 'transaction 호출 0건');
    assert.strictEqual(Object.keys(h.db.external_events).length, 0, 'DB 변화 없음');
    assert.strictEqual(h.successToasts().length, 0);
    assert.strictEqual(h.errorToasts().length, 1);
});

// ===== 1. 신규 일정 동시 생성 =====

test('[1-a] 신규 일정: 현재 DB 값이 없을 때만 기본값 생성 (applyLocally=false)', async () => {
    const h = createHarness({ eventPages: [{ items: [gEvent('evt-new', 'New Event', '2026-10-02')] }] });
    await h.sync();
    const e = h.db.external_events['evt-new'];
    assert.strictEqual(e.assignee, 'FAWW 연동');
    assert.strictEqual(e.status, 'todo');
    assert.strictEqual(e.priority, 'low');
    assert.strictEqual(e.type, 'task');
    assert.strictEqual(e.isExternal, true);
    assert.strictEqual(h.txCalls[0].applyLocally, false);
});

test('[1-b 필수] DB 조회 후 다른 클라이언트가 같은 신규 일정을 생성·수정 → 담당자·상태 보존', async () => {
    const h = createHarness({ eventPages: [{ items: [gEvent('evt-new', 'New Event', '2026-10-02')] }] });
    let injected = false;
    const inject = (hh) => {
        if (injected) return;
        injected = true;
        hh.db.external_events['evt-new'] = { id: 'evt-new', title: '다른 직원 생성', assignee: '재진', status: 'done', priority: 'high' };
    };
    // 구현이 어떤 방식으로 읽든(일괄 once 또는 일정별 transaction) "읽은 직후"에 다른 클라이언트 쓰기를 끼워 넣는다.
    h.hooks.afterOnceRead = (p, hh) => { if (p === 'external_events') inject(hh); };
    h.hooks.afterTxRead = (id, attempt, readValue, hh) => { if (id === 'evt-new' && readValue === null) inject(hh); };
    await h.sync();
    assert.ok(injected, '동시 쓰기 주입됨');
    const e = h.db.external_events['evt-new'];
    assert.strictEqual(e.assignee, '재진', 'assignee 보존');
    assert.strictEqual(e.status, 'done', 'status 보존');
    assert.strictEqual(e.priority, 'high', 'priority 보존');
    assert.ok(e.title.includes('New Event'), 'Google 관리 필드는 갱신');
    const attempts = h.txAttempts.filter((a) => a.id === 'evt-new');
    assert.ok(attempts.length >= 2, '콜백이 최신 값으로 재실행됨');
    assert.strictEqual(attempts[attempts.length - 1].read.assignee, '재진', '재실행 시 최신 값 사용');
    assert.strictEqual(h.successToasts().length, 1);
});

test('[1-c 필수] 동기화 시작 후(Google 조회 중) 다른 클라이언트가 신규 일정 생성·수정 → 보존 (오래된 조회 결과 미사용)', async () => {
    const h = createHarness({ eventPages: [{ items: [gEvent('evt-new', 'New Event', '2026-10-02')] }] });
    h.hooks.onFetch = (call, hh) => {
        if (/\/events$/.test(call.path)) {
            hh.db.external_events['evt-new'] = { id: 'evt-new', title: 'x', assignee: '재진', status: 'done' };
        }
    };
    await h.sync();
    const e = h.db.external_events['evt-new'];
    assert.strictEqual(e.assignee, '재진');
    assert.strictEqual(e.status, 'done');
    assert.ok(e.title.includes('New Event'));
    assert.strictEqual(h.externalDirectWrites().length, 0);
});

test('[1-d] transaction 콜백에 부수 효과 없음: 콜백 실행 중 알림·fetch 호출 0건', async () => {
    const h = createHarness({ eventPages: [{ items: [gEvent('evt-new', 'New Event', '2026-10-02')] }] });
    const realRef = h.sandbox.db.ref;
    let inCallback = false;
    let sideEffects = 0;
    const realFetch = h.sandbox.fetch;
    const realToast = h.sandbox.showToast;
    h.sandbox.fetch = (...a) => { if (inCallback) sideEffects++; return realFetch(...a); };
    h.sandbox.showToast = (...a) => { if (inCallback) sideEffects++; return realToast(...a); };
    h.sandbox.db.ref = (p) => {
        const r = realRef(p);
        const tx = r.transaction;
        r.transaction = (fn, ...rest) => tx((cur) => { inCallback = true; try { return fn(cur); } finally { inCallback = false; } }, ...rest);
        return r;
    };
    await h.sync();
    assert.strictEqual(sideEffects, 0);
    assert.strictEqual(h.txWrites.length, 1);
});

// ===== 2. 계정·세션 변경 =====

test('[2-a 필수] Google 일정 응답 대기 중 A→B 계정 전환 → 이전 요청의 DB 쓰기·알림 0건, B 토큰 유지', async () => {
    const h = createHarness();
    h.hooks.onFetch = (call, hh) => {
        if (/\/events$/.test(call.path) && call.auth === 'Bearer token-A') hh.switchAccount('user-B', 'token-B');
    };
    await h.sync();
    assert.strictEqual(h.txCalls.length, 0, 'transaction 0건');
    assert.strictEqual(h.txWrites.length, 0);
    assert.strictEqual(h.toasts.length, 0, '성공·오류 알림 없음');
    assert.strictEqual(h.getToken(), 'token-B');
    assert.strictEqual(h.storage.google_access_token, 'token-B');
    assert.strictEqual(h.isSyncing(), false, '이전 요청 종료 후 잠금 해제');

    // 새 세션(B)은 정상 동기화 가능
    h.hooks.onFetch = null;
    await h.sync();
    assert.strictEqual(h.txWrites.length, 1, 'B 세션 동기화 반영');
    assert.ok(h.eventCalls().slice(-1)[0].auth === 'Bearer token-B');
    assert.strictEqual(h.successToasts().length, 1);
});

test('[2-b 필수] calendarList 응답 대기 중 로그아웃 → 캘린더 생성·일정 조회·DB 쓰기·알림 0건', async () => {
    const h = createHarness({ calendarPages: [{ items: [{ id: 'other', summary: 'Personal' }] }] });
    h.hooks.onFetch = (call, hh) => { if (call.path === CAL_LIST_PATH) hh.logout(); };
    await h.sync();
    assert.strictEqual(h.createCalls().length, 0, '캘린더 생성 0건');
    assert.strictEqual(h.eventCalls().length, 0, '일정 조회 0건');
    assert.strictEqual(h.txCalls.length, 0, 'DB 쓰기 0건');
    assert.strictEqual(h.toasts.length, 0, '알림 0건');
    assert.strictEqual(h.isSyncing(), false);
});

test('[2-c 필수] 로그아웃 없이 Firebase 계정만 전환(토큰 동일) → DB 쓰기 0건', async () => {
    const h = createHarness();
    h.hooks.onFetch = (call, hh) => { if (/\/events$/.test(call.path)) hh.switchAccount('user-B'); };
    await h.sync();
    assert.strictEqual(h.txCalls.length, 0);
    assert.strictEqual(h.toasts.length, 0);
});

test('[2-d 필수] DB 반영 도중 계정 전환 → 이후 배치 쓰기 중단, 이미 커밋된 쓰기는 남음(취소 주장 안 함), 성공 알림 없음', async () => {
    const items = Array.from({ length: 25 }, (_, i) => gEvent(`evt-${i}`, `E${i}`, '2026-10-03'));
    const h = createHarness({ eventPages: [{ items }] });
    h.hooks.afterTxCommit = (id, n, hh) => { if (n === 3) hh.switchAccount('user-B', 'token-B'); };
    await h.sync();
    assert.strictEqual(h.txWrites.length, 3, '전환 전 커밋 3건만 존재');
    assert.strictEqual(h.txCalls.length, 10, '첫 배치(10건) 이후 transaction 시작 안 함');
    const aborted = h.txAttempts.filter((a) => a.proposed === undefined).length;
    assert.strictEqual(aborted, 7, '첫 배치의 나머지 7건은 콜백에서 중단(undefined 반환)');
    assert.strictEqual(h.successToasts().length, 0);
    assert.strictEqual(h.errorToasts().length, 0);
    assert.strictEqual(h.getToken(), 'token-B');
});

test('[2-e 필수] 이전 요청의 401 → 새로 연동한 토큰 보존', async () => {
    const h = createHarness({ unauthorizedTokens: ['token-A'] });
    h.hooks.onFetch = (call, hh) => {
        if (call.path === CAL_LIST_PATH && call.auth === 'Bearer token-A') hh.setToken('token-B'); // 재연동
    };
    await h.sync();
    assert.strictEqual(h.getToken(), 'token-B', '메모리 토큰 유지');
    assert.strictEqual(h.storage.google_access_token, 'token-B', 'localStorage 토큰 유지');
    assert.strictEqual(h.removedKeys.length, 0, 'removeItem 호출 없음');
    assert.strictEqual(h.txCalls.length, 0);
    assert.strictEqual(h.toasts.length, 0);
});

test('[2-f 대조군] 현재 세션의 401 → 해당 토큰만 삭제 (기존 동작 유지)', async () => {
    const h = createHarness({ unauthorizedTokens: ['token-A'] });
    await h.sync();
    assert.strictEqual(h.getToken(), null);
    assert.strictEqual(h.storage.google_access_token, undefined);
    assert.deepStrictEqual(h.removedKeys, [{ k: 'google_access_token', value: 'token-A' }]);
    assert.strictEqual(h.txCalls.length, 0);
    assert.strictEqual(h.isSyncing(), false);
});

test('[2-g] 출장 동기화(syncTripToGoogleCalendar)도 이전 토큰의 401이 새 토큰을 지우지 않음', async () => {
    const h = createHarness({ unauthorizedTokens: ['token-A'] });
    h.hooks.onFetch = (call, hh) => {
        if (call.path === CAL_LIST_PATH && call.auth === 'Bearer token-A') hh.setToken('token-B');
    };
    await h.sandbox.syncTripToGoogleCalendar({ id: 'trip-1', name: '출장', date: '2026-10-05' });
    assert.strictEqual(h.getToken(), 'token-B');
    assert.strictEqual(h.removedKeys.length, 0);
    assert.strictEqual(h.toasts.filter((t) => t.type === 'warning').length, 0, '만료 경고 없음');
});

test('[2-h 필수] finally 잠금 해제가 다른 세션의 실행 상태를 변경하지 않음', async () => {
    const gateA = deferred();
    const gateB = deferred();
    const h = createHarness();
    h.hooks.onFetch = async (call) => {
        if (/\/events$/.test(call.path)) {
            if (call.auth === 'Bearer token-A') await gateA.promise;
            if (call.auth === 'Bearer token-B') await gateB.promise;
        }
    };
    const pA = h.sync();
    await waitFor(() => h.eventCalls().some((c) => c.auth === 'Bearer token-A'), 'A events 요청');
    h.switchAccount('user-B', 'token-B');
    const pB = h.sync(); // A가 무효화되었으므로 B는 잠금을 넘겨받아 실행
    await waitFor(() => h.eventCalls().some((c) => c.auth === 'Bearer token-B'), 'B events 요청');

    gateA.resolve();
    await pA; // A 종료 (finally 실행)
    assert.strictEqual(h.isSyncing(), true, 'A의 finally가 B의 실행 상태를 해제하지 않음');

    const before = h.fetchCalls.length;
    await h.sync(); // B 진행 중 → 중복 실행 차단
    assert.strictEqual(h.fetchCalls.length, before, 'B 진행 중 추가 동기화 차단');

    gateB.resolve();
    await pB;
    assert.strictEqual(h.isSyncing(), false, 'B 종료 후 잠금 해제');
    assert.strictEqual(h.txCalls.length, 1, 'B 세션만 DB 반영 (A는 0건)');
    assert.strictEqual(h.successToasts().length, 1);
});

// ===== 3. calendarList 페이지 처리 =====

test('[3-a 필수] FAWW가 calendarList 두 번째 페이지 → 캘린더 생성 요청 0건, 해당 캘린더 사용, pageToken 인코딩', async () => {
    const rawToken = 'cal p2/+&=';
    const h = createHarness({
        calendarPages: [
            { items: [{ id: 'personal', summary: 'Personal' }], nextPageToken: rawToken },
            { items: [{ id: 'faww-page2', summary: 'FAWW' }] }
        ]
    });
    await h.sync();
    assert.strictEqual(h.createCalls().length, 0, '캘린더 생성 0건');
    assert.strictEqual(h.calListCalls().length, 2, 'calendarList 2페이지 조회');
    assert.strictEqual(h.calListCalls()[1].params.pageToken, rawToken, 'pageToken 원문 그대로 전달');
    assert.ok(h.calListCalls()[1].url.includes('%26'), '특수문자 인코딩');
    assert.ok(h.eventCalls()[0].path.includes('/calendars/faww-page2/events'), '2페이지의 FAWW 사용');
    assert.strictEqual(h.txWrites.length, 1);
});

test('[3-b 필수] calendarList 중간 페이지 실패 → 생성·일정 조회·DB 쓰기 0건', async () => {
    const h = createHarness({
        calendarPages: [
            { items: [{ id: 'a', summary: 'A' }], nextPageToken: 'c2' },
            { items: [{ id: 'b', summary: 'B' }], nextPageToken: 'c3' },
            { items: [{ id: 'faww', summary: 'FAWW' }] }
        ],
        calendarStatusByToken: { c2: 500 }
    });
    await h.sync();
    assert.strictEqual(h.calListCalls().length, 2, '실패 이후 페이지 미조회');
    assert.strictEqual(h.createCalls().length, 0, '캘린더 생성 0건');
    assert.strictEqual(h.eventCalls().length, 0, '일정 조회 0건');
    assert.strictEqual(h.txCalls.length, 0, 'DB 쓰기 0건');
    assert.strictEqual(h.successToasts().length, 0);
    assert.strictEqual(h.errorToasts().length, 1);
});

test('[3-c] 모든 페이지에 FAWW가 없을 때만, 마지막 페이지 확인 후 1회 생성', async () => {
    const h = createHarness({
        calendarPages: [
            { items: [{ id: 'a', summary: 'A' }], nextPageToken: 'c2' },
            { items: [{ id: 'b', summary: 'B' }] }
        ]
    });
    await h.sync();
    assert.strictEqual(h.createCalls().length, 1);
    const idxCreate = h.fetchCalls.findIndex((c) => c.method === 'POST' && c.path === CAL_CREATE_PATH);
    const idxLastList = h.fetchCalls.map((c) => c.path).lastIndexOf(CAL_LIST_PATH);
    assert.ok(idxCreate > idxLastList, '모든 calendarList 페이지 확인 후 생성');
    assert.ok(h.eventCalls()[0].path.includes('/calendars/created-faww/events'));
});

// ===== DB 저장 실패 · 재시도 =====

test('[4-a 필수] 일부 DB 저장 실패 → 성공 알림 없음, 저장 건수 안내, 재시도 시 나머지 반영·앱 필드 보존', async () => {
    const h = createHarness({
        eventPages: [{ items: [gEvent('evt-1', 'Event 1', '2026-10-01'), gEvent('evt-2', 'Event 2', '2026-10-02')] }]
    });
    h.hooks.txFail = (id) => id === 'evt-2';
    await h.sync();
    assert.strictEqual(h.successToasts().length, 0, '1차: 성공 알림 없음');
    assert.strictEqual(h.errorToasts().length, 1, '1차: 오류 알림');
    assert.ok(/2건 중 1건 실패/.test(h.errorToasts()[0].msg) && /1건은 저장됨/.test(h.errorToasts()[0].msg), '부분 저장 사실 안내');
    assert.ok(h.db.external_events['evt-1'], 'evt-1은 이미 저장됨');
    assert.strictEqual(h.db.external_events['evt-2'], undefined, 'evt-2 미저장');
    assert.strictEqual(h.isSyncing(), false, '잠금 해제 → 재시도 가능');

    // 재시도 전 다른 직원이 evt-1 담당자·상태 수정
    h.db.external_events['evt-1'].assignee = '재진';
    h.db.external_events['evt-1'].status = 'doing';
    h.hooks.txFail = null;
    await h.sync();
    assert.strictEqual(h.successToasts().length, 1, '2차: 성공 알림');
    assert.strictEqual(h.db.external_events['evt-2'].assignee, 'FAWW 연동', 'evt-2 신규 생성');
    assert.strictEqual(h.db.external_events['evt-1'].assignee, '재진', '재시도해도 evt-1 담당자 보존');
    assert.strictEqual(h.db.external_events['evt-1'].status, 'doing', '재시도해도 evt-1 상태 보존');
});

test('[4-b 필수] 전체 DB 저장 실패 → 성공 알림 없음, 재시도 성공', async () => {
    const h = createHarness();
    h.hooks.txFail = () => true;
    await h.sync();
    assert.strictEqual(h.successToasts().length, 0);
    assert.strictEqual(Object.keys(h.db.external_events).length, 0);
    h.hooks.txFail = null;
    await h.sync();
    assert.strictEqual(h.successToasts().length, 1);
    assert.ok(h.db.external_events['evt-1']);
});

test('[4-c] Firebase 키로 쓸 수 없는 일정 ID가 있으면 DB 반영 시작 전 중단', async () => {
    const h = createHarness({
        eventPages: [{ items: [gEvent('evt-1', 'ok', '2026-10-01'), gEvent('bad.id', 'bad', '2026-10-01')] }]
    });
    await h.sync();
    assert.strictEqual(h.txCalls.length, 0);
    assert.strictEqual(h.successToasts().length, 0);
});

// ===== mock 자체 검증 =====

test('[mock] DB snapshot은 조회 당시의 독립 복사본', async () => {
    const h = createHarness({ initialDb: { 'evt-1': { id: 'evt-1', assignee: 'A' } } });
    const snap = await h.sandbox.db.ref('external_events').once('value');
    const v1 = snap.val();
    v1['evt-1'].assignee = 'mutated';
    assert.strictEqual(h.db.external_events['evt-1'].assignee, 'A', '반환값 수정이 DB에 영향 없음');
    h.db.external_events['evt-1'].assignee = 'B';
    assert.strictEqual(snap.val()['evt-1'].assignee, 'A', '조회 이후 DB 변경이 snapshot에 반영되지 않음');
});

if (process.env.SYNC_TEST_FORCE_FAIL === '1') {
    test('[의도적 실패] 종료 코드 검증용', async () => {
        assert.strictEqual(1, 2, 'Intentional failure (SYNC_TEST_FORCE_FAIL=1)');
    });
}

// ---------------------------------------------------------------------------
async function runTests() {
    console.log(`--- Google 캘린더 동기화 테스트 (대상: ${path.relative(process.cwd(), SERVICES_PATH)}) ---`);
    let passed = 0;
    const failed = [];
    for (const t of tests) {
        try {
            await t.fn();
            passed++;
            console.log(`PASS ${t.name}`);
        } catch (e) {
            failed.push(t.name);
            console.error(`FAIL ${t.name}\n     ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n     ') : e}`);
        }
    }
    console.log(`\n결과: ${passed}/${tests.length} 통과, ${failed.length} 실패`);
    if (failed.length > 0) process.exitCode = 1;
}

runTests().catch((e) => {
    console.error('테스트 실행 오류:', e);
    process.exitCode = 1;
});
