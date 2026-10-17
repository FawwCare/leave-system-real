/**
 * FaWW 자동화 Phase 1B — 출장 배정 검토용 데이터 조회 (읽기 전용)
 *
 * 화면·판정 엔진과 분리된 조회 계층. once() 로 한 번만 읽고, 쓰기 함수(set·update·remove·push·transaction)는 호출하지 않는다.
 * 출처별로 complete / partial / failed 를 기록한다.
 *
 * 조회 방식과 완전성 판단
 *  - users            전체 1회 조회. 성공하면 complete
 *  - businessTrips    startDate 색인이 없고, 옛 수동 등록 기록은 date 필드만 있어 날짜 범위 조회를 쓸 수 없다.
 *                     → 생성 순서(키) 기준 최신 limit+1 건을 읽는다. limit 건 이하로 오면 전체를 읽은 것 → complete,
 *                       limit 를 넘게 오면 더 오래된 기록이 남아 있다는 뜻 → partial (최신 limit 건만 사용).
 *                       기간 필터는 읽은 뒤 계산(trip-dates.js)으로 한다. 장기 출장·날짜 형식과 무관하게 누락이 없다.
 *  - leaves           위와 같은 방식 (limit+1)
 *  - tasks            기존 칸반과 같은 status 조회 (todo, doing) 두 번. 둘 다 성공하면 complete
 *  - external_events  위와 같은 방식 (limit+1)
 *  - 시간 초과·권한 오류 등 실패는 failed (데이터 없음)
 *
 * 브라우저: window.FawwTripReviewData.load(db, options)
 */
(function (root) {
    'use strict';

    var DEFAULT_LIMITS = { trips: 3000, leaves: 5000, externalEvents: 3000 };
    var DEFAULT_TIMEOUT_MS = 20000;

    function withTimeout(promise, ms, label) {
        return new Promise(function (resolve, reject) {
            var done = false;
            var t = setTimeout(function () { if (!done) { done = true; reject(new Error(label + ' 조회 시간 초과 (' + Math.round(ms / 1000) + '초)')); } }, ms);
            promise.then(function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } },
                         function (e) { if (!done) { done = true; clearTimeout(t); reject(e); } });
        });
    }

    function snapToObject(snap) {
        var out = {};
        if (snap && typeof snap.forEach === 'function') {
            snap.forEach(function (child) { var v = child.val(); if (v && typeof v === 'object') out[child.key] = v; });
        }
        return out;
    }

    // 최신 limit+1 건을 읽어 limit 초과 여부로 완전성을 판단
    function loadNewest(db, path, limit, timeoutMs) {
        return withTimeout(db.ref(path).orderByKey().limitToLast(limit + 1).once('value'), timeoutMs, path).then(function (snap) {
            var all = snapToObject(snap);
            var keys = Object.keys(all).sort();
            if (keys.length > limit) {
                var dropped = keys.slice(0, keys.length - limit);
                dropped.forEach(function (k) { delete all[k]; });
                return { data: all, coverage: { status: 'partial', count: limit, limit: limit, message: '최신 ' + limit + '건만 읽음 (더 오래된 기록이 남아 있음)' } };
            }
            return { data: all, coverage: { status: 'complete', count: keys.length, limit: limit, message: '' } };
        });
    }

    function failed(e) {
        return { data: {}, coverage: { status: 'failed', count: 0, message: (e && e.message) ? e.message : String(e) } };
    }

    /**
     * @param db  firebase.database() 인스턴스 (읽기만 사용)
     * @param options { limits?: {trips, leaves, externalEvents}, timeoutMs? }
     * @returns Promise<{ data: {users, trips, leaves, tasks, externalEvents}, coverage: {...출처별}, users: {status}, fetchedAt }>
     */
    function load(db, options) {
        options = options || {};
        var limits = Object.assign({}, DEFAULT_LIMITS, options.limits || {});
        var timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
        if (!db || typeof db.ref !== 'function') return Promise.reject(new Error('데이터베이스가 준비되지 않았습니다'));

        var users = withTimeout(db.ref('users').once('value'), timeoutMs, 'users')
            .then(function (s) { return { data: snapToObject(s), coverage: { status: 'complete', count: s && s.numChildren ? s.numChildren() : 0 } }; }, failed);
        var trips = loadNewest(db, 'businessTrips', limits.trips, timeoutMs).catch(failed);
        var leaves = loadNewest(db, 'leaves', limits.leaves, timeoutMs).catch(failed);
        var ext = loadNewest(db, 'external_events', limits.externalEvents, timeoutMs).catch(failed);
        var tasks = Promise.all(['todo', 'doing'].map(function (st) {
            return withTimeout(db.ref('tasks').orderByChild('status').equalTo(st).once('value'), timeoutMs, 'tasks(' + st + ')').then(snapToObject);
        })).then(function (parts) {
            var all = Object.assign({}, parts[0], parts[1]);
            return { data: all, coverage: { status: 'complete', count: Object.keys(all).length } };
        }, failed);

        return Promise.all([users, trips, leaves, tasks, ext]).then(function (r) {
            return {
                data: { users: r[0].data, trips: r[1].data, leaves: r[2].data, tasks: r[3].data, externalEvents: r[4].data },
                coverage: { users: r[0].coverage, trips: r[1].coverage, leaves: r[2].coverage, tasks: r[3].coverage, externalEvents: r[4].coverage },
                fetchedAt: Date.now()
            };
        });
    }

    root.FawwTripReviewData = { load: load, DEFAULT_LIMITS: DEFAULT_LIMITS };
})(typeof window !== 'undefined' ? window : this);
