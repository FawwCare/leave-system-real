/**
 * FaWW 자동화 Phase 1B — 출장 배정 검토 화면용 모델 (순수 함수, DB 접근 없음)
 * 의존: FawwStaffIdentity, FawwTripDates, FawwConflictEngine
 *
 * 조회 결과(trip-review-data.js) + 조회 기간 → 화면이 그릴 목록·요약·출처 상태
 * 출장별 검토 상태 (출장에 '현재 배정된 담당자' 기준)
 *   conflict        충돌 발견          배정된 담당자 중 충돌 발견이 있음
 *   assignee_check  담당자 확인 필요    담당자 이름을 직원과 연결하지 못했거나 여러 명에 해당
 *   unassigned      담당자 미지정
 *   caution         주의·확인 필요     배정된 담당자 중 주의가 있음
 *   incomplete      검토 불완전        위 사항은 없지만 데이터가 불완전함
 *   clear           확인된 충돌 없음
 *
 * 브라우저: window.FawwTripReviewModel.build(loaded, options)
 */
(function (root) {
    'use strict';

    var REVIEW_LABELS = {
        conflict: '충돌 발견', assignee_check: '담당자 확인 필요', unassigned: '담당자 미지정',
        caution: '주의·확인 필요', incomplete: '검토 불완전', clear: '확인된 충돌 없음'
    };
    var SOURCE_LABELS = { users: '직원', trips: '출장', leaves: '휴가', tasks: '업무', externalEvents: '캘린더 일정' };

    function addDays(ymd, n) {
        var p = ymd.split('-').map(Number);
        var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
        return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    }

    /** 기본 조회 기간: 오늘부터 30일 (오늘 포함, 현지 날짜 기준) */
    function defaultRange(now) {
        var d = now ? new Date(now) : new Date();
        var today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        return { start: today, end: addDays(today, 29) };
    }

    function overallStatus(coverage) {
        var states = Object.keys(SOURCE_LABELS).map(function (k) { return coverage && coverage[k] ? coverage[k].status : 'failed'; });
        if (states.indexOf('failed') !== -1) return 'failed';
        if (states.indexOf('partial') !== -1) return 'partial';
        return 'complete';
    }

    /**
     * @param loaded  { data: {users, trips, leaves, tasks, externalEvents}, coverage, fetchedAt }
     * @param options { range: {start, end}, aliases }
     */
    function build(loaded, options) {
        var SI = root.FawwStaffIdentity, TD = root.FawwTripDates, CE = root.FawwConflictEngine;
        options = options || {};
        var range = options.range || defaultRange();
        var data = (loaded && loaded.data) || {};
        var coverage = (loaded && loaded.coverage) || {};
        var model = {
            range: range, fetchedAt: loaded ? loaded.fetchedAt : null,
            coverage: coverage, dataStatus: overallStatus(coverage), sourceLabels: SOURCE_LABELS, reviewLabels: REVIEW_LABELS,
            trips: [], undatedTrips: [],
            summary: { total: 0, needsReview: 0, conflicts: 0, assigneeCheck: 0 }
        };
        var rangePeriod = { start: range.start, end: range.end };
        var engineCoverage = { trips: coverage.trips, leaves: coverage.leaves, tasks: coverage.tasks, externalEvents: coverage.externalEvents };
        var usersOk = coverage.users && coverage.users.status === 'complete';

        Object.keys(data.trips || {}).forEach(function (id) {
            var t = Object.assign({ id: id }, data.trips[id]);
            var p = TD.normalizeTripPeriod(t);
            if (p.status !== 'ok') {
                model.undatedTrips.push({ id: id, name: t.name || '(이름 없음)', rawDate: t.date || '', status: p.status, detail: p.detail || '', assignee: t.assignee || '' });
                return;
            }
            if (!TD.overlaps(rangePeriod, p)) return;
            var res = CE.evaluateTripConflicts({
                users: data.users || {}, aliases: options.aliases || {}, coverage: engineCoverage, targetTrip: t,
                trips: data.trips || {}, leaves: data.leaves || {}, tasks: data.tasks || {}, externalEvents: data.externalEvents || {}
            });
            var assigned = (res.target && res.target.assignees) || { uids: [], entries: [], complete: false };
            var assignedResults = res.staff.filter(function (s) { return assigned.uids.indexOf(s.uid) !== -1; });
            var unresolved = assigned.entries.filter(function (e) { return e.status !== 'matched'; });
            var review;
            if (!usersOk) review = 'incomplete';
            else if (assignedResults.some(function (s) { return s.verdict === 'conflict'; })) review = 'conflict';
            else if (unresolved.length) review = 'assignee_check';
            else if (!assigned.entries.length) review = 'unassigned';
            else if (assignedResults.some(function (s) { return s.verdict === 'caution'; })) review = 'caution';
            else if (!res.reviewComplete) review = 'incomplete';
            else review = 'clear';
            model.trips.push({
                id: id, name: t.name || '(이름 없음)', place: t.address || '', status: t.status || '', assigneeText: t.assignee || '',
                requiredPersonnel: t.requiredPersonnel || null, start: p.start, end: p.end,
                assigned: assigned, unresolved: unresolved, review: review, reviewLabel: REVIEW_LABELS[review],
                result: res,
                externalUnattributed: res.unattributed.filter(function (u) { return u.source === 'externalEvent'; })
            });
        });
        model.trips.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : String(a.name).localeCompare(String(b.name)); });
        model.summary.total = model.trips.length;
        model.trips.forEach(function (t) {
            if (t.review !== 'clear') model.summary.needsReview++;
            if (t.review === 'conflict') model.summary.conflicts++;
            if (t.unresolved.length || t.review === 'unassigned') model.summary.assigneeCheck++;
        });
        return model;
    }

    /** 검색·필터 (화면에서 사용, 순수 함수) */
    function filterTrips(trips, f) {
        f = f || {};
        var q = String(f.query || '').trim().toLowerCase();
        return trips.filter(function (t) {
            if (q && String(t.name).toLowerCase().indexOf(q) === -1 && String(t.place).toLowerCase().indexOf(q) === -1) return false;
            if (f.tripStatus && f.tripStatus !== 'all' && t.status !== f.tripStatus) return false;
            if (f.review && f.review !== 'all' && t.review !== f.review) return false;
            return true;
        });
    }

    root.FawwTripReviewModel = { build: build, filterTrips: filterTrips, defaultRange: defaultRange, addDays: addDays, REVIEW_LABELS: REVIEW_LABELS, SOURCE_LABELS: SOURCE_LABELS };
})(typeof window !== 'undefined' ? window : this);
