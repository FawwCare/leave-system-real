/**
 * FaWW 자동화 Phase 1A — 일정 충돌 판정 엔진 (순수 함수, DB 읽기·쓰기 없음)
 * 의존: FawwStaffIdentity (staff-identity.js), FawwTripDates (trip-dates.js)
 *
 * 검사 대상 출장 하나에 대해, 승인된 직원마다 충돌 등급과 근거를 돌려준다.
 * 등급 (높은 것이 우선)
 *   conflict  충돌 발견        승인된 종일 휴가, 다른 확정 출장과 날짜 겹침
 *   caution   주의·확인 필요   반차, 대기·취소대기 휴가, 조율중 출장, 외부 일정, 이름 해석 문제, 날짜 불명, 조회 범위 불완전
 *   info      참고             겹치는 기간의 업무, 업무 마감일
 *   clear     확인된 충돌 없음  필요한 데이터가 모두 확인됐고 근거가 하나도 없을 때만
 * '배정 가능'이라는 판정은 없다. 실제 배정은 관리자가 결정한다.
 *
 * 브라우저: window.FawwConflictEngine.evaluateTripConflicts(input)
 */
(function (root) {
    'use strict';

    var LEVELS = ['clear', 'info', 'caution', 'conflict'];
    var LABELS = { conflict: '충돌 발견', caution: '주의·확인 필요', info: '참고', clear: '확인된 충돌 없음' };
    var SOURCES = ['trips', 'leaves', 'tasks', 'externalEvents'];
    var TRIP_ID_TAG = /\[FaWW 출장연동 ID:\s*([^\]\s]+)\]/;
    var LEAVE_ID_TAG = /\[FaWW 휴가연동 ID:\s*([^\]\s]+)\]/;

    function toList(x) {
        if (!x) return [];
        if (Array.isArray(x)) return x.filter(Boolean).map(function (v, i) { return v.id ? v : Object.assign({ id: String(i) }, v); });
        return Object.keys(x).filter(function (k) { return x[k] && typeof x[k] === 'object'; })
            .map(function (k) { return Object.assign({ id: k }, x[k], { id: x[k].id || k }); });
    }

    function evaluateTripConflicts(input) {
        var SI = root.FawwStaffIdentity, TD = root.FawwTripDates;
        if (!SI || !TD) throw new Error('FawwStaffIdentity / FawwTripDates 가 먼저 로드되어야 합니다');
        input = input || {};
        var idx = SI.buildStaffIndex(input.users || {}, input.aliases || {});
        var trips = toList(input.trips), leaves = toList(input.leaves), tasks = toList(input.tasks), externals = toList(input.externalEvents);
        var target = input.targetTrip || null;
        var coverage = input.coverage || {};

        var result = { target: null, staff: [], unattributed: [], skippedDuplicates: [], coverage: {}, levels: LABELS };
        var byUid = {};
        idx.staff.forEach(function (s) {
            var r = { uid: s.uid, displayName: s.displayName, level: 'clear', label: LABELS.clear, reasons: [] };
            byUid[s.uid] = r; result.staff.push(r);
        });
        var add = function (uid, level, code, message, ref) {
            var r = byUid[uid]; if (!r) return;
            r.reasons.push({ level: level, code: code, message: message, source: ref || null });
            if (LEVELS.indexOf(level) > LEVELS.indexOf(r.level)) { r.level = level; r.label = LABELS[level]; }
        };
        var addAll = function (level, code, message) { result.staff.forEach(function (r) { add(r.uid, level, code, message); }); };
        var unattributed = function (type, id, code, detail) { result.unattributed.push({ source: type, id: id, code: code, detail: detail || '' }); };
        // 겹치는 출장·휴가인데 사람을 특정하지 못하면 누구든 해당될 수 있으므로 전원 '주의'
        // (사람을 특정할 수 없는 외부 일정은 흔하고 대개 직원 일정과 무관해 목록으로만 제공)
        var warnedUnknown = {};
        var unknownPerson = function (type, id, name) {
            var key = type + ':' + id; if (warnedUnknown[key]) return; warnedUnknown[key] = true;
            addAll('caution', 'unattributed_' + type, '같은 기간 ' + (type === 'trip' ? '출장' : '휴가') + '의 담당자를 특정할 수 없음: ' + (name || id));
        };

        // 0) 같은 표시 이름의 승인 직원이 여럿 → 이름으로 연결된 데이터를 나눌 수 없음
        Object.keys(idx.byName).forEach(function (name) {
            if (idx.byName[name].length > 1) idx.byName[name].forEach(function (uid) {
                add(uid, 'caution', 'duplicate_name', '같은 이름의 승인 직원이 ' + idx.byName[name].length + '명 있어 이름으로 연결된 일정을 구분할 수 없음');
            });
        });

        // 1) 조회 범위: 호출하는 쪽이 출처별로 '전체를 확인했다'고 명시해야 함
        var incomplete = SOURCES.filter(function (k) { return coverage[k] !== true; });
        result.coverage = { complete: incomplete.length === 0, incomplete: incomplete };
        if (incomplete.length) addAll('caution', 'coverage_incomplete', '조회 범위가 불완전함: ' + incomplete.join(', '));

        // 2) 검사 대상 출장
        if (!target) {
            addAll('caution', 'target_missing', '검사 대상 출장이 없음');
            return finalize(result);
        }
        var tp = TD.normalizeTripPeriod(target);
        result.target = { id: target.id || null, name: target.name || '', period: tp, assignees: SI.resolveAssignees(target.assignee, idx) };
        if (tp.status !== 'ok') addAll('caution', 'target_period_unknown', '검사 대상 출장의 날짜를 확정할 수 없음 (' + tp.status + ')');
        var tPeriod = tp.start ? { start: tp.start, end: tp.end } : null;
        if (!tPeriod) return finalize(result);

        var tripIds = {}; trips.forEach(function (t) { tripIds[t.id] = true; }); if (target.id) tripIds[target.id] = true;
        var leaveIds = {}; leaves.forEach(function (l) { leaveIds[l.id] = true; });

        var attribute = function (assigneeText, type, id, onMatch) {
            var res = SI.resolveAssignees(assigneeText, idx);
            res.uids.forEach(onMatch);
            res.entries.forEach(function (e) {
                if (e.status === 'ambiguous') e.candidates.forEach(function (uid) {
                    add(uid, 'caution', 'assignee_ambiguous', '담당자 "' + e.token + '"가 여러 직원에 해당 (' + type + ')', { type: type, id: id });
                });
                if (e.status === 'unmatched') unattributed(type, id, e.note === 'unapproved' ? 'assignee_unapproved' : 'assignee_unmatched', e.token);
            });
            return res;
        };

        // 3) 다른 출장
        trips.forEach(function (t) {
            if (target.id && t.id === target.id) return;
            var p = TD.normalizeTripPeriod(t);
            var ref = { type: 'trip', id: t.id, name: t.name || '', period: p };
            if (p.status !== 'ok') {
                // 날짜를 모르면 겹치는지도 모름 → 담당자에게 주의
                var r0 = attribute(t.assignee, 'trip', t.id, function (uid) { add(uid, 'caution', 'trip_period_unknown', '날짜를 확정할 수 없는 출장: ' + (t.name || t.id), ref); });
                if (!r0.entries.length) unattributed('trip', t.id, 'trip_period_and_assignee_unknown', t.name || '');
                return;
            }
            if (!TD.overlaps(tPeriod, p)) return;
            var res = attribute(t.assignee, 'trip', t.id, function (uid) {
                if (t.status === '확정') add(uid, 'conflict', 'trip_confirmed', '같은 기간 확정 출장: ' + (t.name || t.id), ref);
                else if (t.status === '조율중') add(uid, 'caution', 'trip_tentative', '같은 기간 조율 중 출장: ' + (t.name || t.id), ref);
                else add(uid, 'caution', 'trip_status_unknown', '같은 기간 출장(상태 불명: ' + (t.status || '없음') + '): ' + (t.name || t.id), ref);
            });
            if (!res.entries.length) unattributed('trip', t.id, 'trip_no_assignee', t.name || '');
            if (!res.complete) unknownPerson('trip', t.id, t.name);
        });

        // 4) 휴가 (uid 우선, 없으면 이름 해석)
        leaves.forEach(function (l) {
            if (l.status === 'rejected') return;
            var uids = [], personKnown = true;
            if (l.uid && byUid[l.uid]) uids = [l.uid];
            else {
                var res = attribute(l.userName, 'leave', l.id, function (uid) { uids.push(uid); });
                personKnown = res.complete;
                if (!res.entries.length) { unattributed('leave', l.id, 'leave_no_person', ''); personKnown = false; }
            }
            var d = TD.normalizeDay(l.date);
            var ref = { type: 'leave', id: l.id, date: l.date, status: l.status };
            if (!personKnown && (d.status !== 'ok' || TD.overlaps(tPeriod, d))) unknownPerson('leave', l.id, l.userName);
            if (d.status !== 'ok') { uids.forEach(function (uid) { add(uid, 'caution', 'leave_date_unknown', '날짜를 해석할 수 없는 휴가', ref); }); return; }
            if (!TD.overlaps(tPeriod, d)) return;
            var half = Number(l.type) === 0.5 || /0\.5/.test(String(l.subType || ''));
            uids.forEach(function (uid) {
                if (l.status === 'approved') {
                    if (half) add(uid, 'caution', 'leave_half', '승인된 ' + (/pm/.test(String(l.subType)) ? '오후' : /am/.test(String(l.subType)) ? '오전' : '') + ' 반차 (' + d.start + ')', ref);
                    else add(uid, 'conflict', 'leave_full', '승인된 종일 휴가 (' + d.start + ')', ref);
                } else if (l.status === 'pending') add(uid, 'caution', 'leave_pending', '승인 대기 중인 휴가 (' + d.start + ')', ref);
                else if (l.status === 'cancel_requested') add(uid, 'caution', 'leave_cancel_pending', '취소 승인 대기 중인 휴가 (' + d.start + ')', ref);
                else add(uid, 'caution', 'leave_status_unknown', '상태 불명 휴가 (' + (l.status || '없음') + ')', ref);
            });
        });

        // 5) 업무 (진행 전·진행 중만, 참고 등급)
        tasks.forEach(function (k) {
            if (k.status !== 'todo' && k.status !== 'doing') return;
            var p = TD.normalizePair(k.startDate, k.dueDate);
            if (p.status !== 'ok' || !TD.overlaps(tPeriod, p)) return;
            var ref = { type: 'task', id: k.id, title: k.title || '' };
            var dueInside = k.dueDate && TD.parseDay(k.dueDate) && TD.overlaps(tPeriod, TD.normalizeDay(k.dueDate));
            var res = SI.resolveAssignees(k.assignee, idx);
            res.uids.forEach(function (uid) {
                if (dueInside) add(uid, 'info', 'task_due', '출장 기간에 마감되는 업무: ' + (k.title || k.id), ref);
                else add(uid, 'info', 'task_overlap', '출장 기간과 겹치는 업무: ' + (k.title || k.id), ref);
            });
        });

        // 6) 외부 캘린더 일정 (출장·휴가에서 복제된 것은 고유 ID 로 제외)
        externals.forEach(function (e) {
            var desc = String(e.description || '');
            var tm = TRIP_ID_TAG.exec(desc), lm = LEAVE_ID_TAG.exec(desc);
            if (tm && tripIds[tm[1]]) { result.skippedDuplicates.push({ id: e.id, of: 'trip', ref: tm[1] }); return; }
            if (lm && leaveIds[lm[1]]) { result.skippedDuplicates.push({ id: e.id, of: 'leave', ref: lm[1] }); return; }
            var p = TD.normalizePair(e.startDate, e.dueDate || e.endDate);
            if (p.status !== 'ok') { unattributed('externalEvent', e.id, 'external_date_unknown', e.title || ''); return; }
            if (!TD.overlaps(tPeriod, p)) return;
            var who = String(e.title || '') + ' ' + (e.assignee && e.assignee !== 'FAWW 자동 연동' ? e.assignee : '');
            var m = SI.findMentionedStaff(who, idx);
            var ref = { type: 'externalEvent', id: e.id, title: e.title || '' };
            m.matched.forEach(function (uid) { add(uid, 'caution', 'external_event', '같은 기간 캘린더 일정(시간·참석 여부 확인 필요): ' + (e.title || e.id), ref); });
            m.ambiguous.forEach(function (uid) { add(uid, 'caution', 'external_ambiguous', '캘린더 일정의 이름이 여러 직원에 해당: ' + (e.title || e.id), ref); });
            if (!m.matched.length && !m.ambiguous.length) unattributed('externalEvent', e.id, 'external_unattributed', e.title || '');
        });

        return finalize(result);
    }

    function finalize(result) {
        result.staff.sort(function (a, b) { return LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) || String(a.displayName).localeCompare(String(b.displayName)); });
        result.summary = { conflict: 0, caution: 0, info: 0, clear: 0 };
        result.staff.forEach(function (r) { result.summary[r.level]++; });
        return result;
    }

    root.FawwConflictEngine = { evaluateTripConflicts: evaluateTripConflicts, LEVELS: LEVELS, LABELS: LABELS };
})(typeof window !== 'undefined' ? window : this);
