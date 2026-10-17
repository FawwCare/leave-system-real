/**
 * FaWW 자동화 Phase 1A — 출장 기간 정규화 (순수 함수, DB 값은 바꾸지 않음)
 *
 * 저장 경로마다 다른 날짜 형식을 계산용 { start, end } ('YYYY-MM-DD' 문자열, 양 끝 포함)으로 맞춘다.
 *  - 지원 형식: 'YYYY-MM-DD', 'YYYY.MM.DD', 'YYYY/MM/DD', 한 자리 월·일, 뒤에 시간이 붙은 값(날짜만 사용)
 *  - 기간 구분자: ' to ', '~', ' - ' (기존 parseTripDateRange 와 같은 구분자). 쉼표는 '여러 날짜 목록'일 수 있어 해석하지 않음
 *  - 실제로 없는 날짜(2026-02-30), 끝이 시작보다 앞선 기간은 invalid
 *  - 해석할 수 없으면 정상 일정으로 취급하지 않고 status 로 알려준다
 * 날짜는 Date 객체로 바꾸지 않고 문자열로 비교한다 (시간대에 따라 하루가 밀리는 문제 방지).
 *
 * 브라우저: window.FawwTripDates
 */
(function (root) {
    'use strict';

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    /** 날짜 하나 해석 → 'YYYY-MM-DD' 또는 null */
    function parseDay(value) {
        if (value === null || value === undefined) return null;
        var s = String(value).trim();
        var m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:$|[T\s])/.exec(s);
        if (!m) return null;
        var y = +m[1], mo = +m[2], d = +m[3];
        if (mo < 1 || mo > 12 || d < 1) return null;
        var dim = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
        if (d > dim) return null;
        return y + '-' + pad2(mo) + '-' + pad2(d);
    }

    /** 기간 문자열 해석 → { start, end } | { error } */
    function parseRangeText(text) {
        var s = String(text === null || text === undefined ? '' : text).trim();
        if (!s) return { error: 'missing' };
        if (s.indexOf(',') !== -1) return { error: 'ambiguous_list' };
        var parts = s.split(/\s+to\s+|\s*~\s*|\s+-\s+/i).filter(function (x) { return x.trim() !== ''; });
        if (parts.length === 1) {
            var one = parseDay(parts[0]);
            return one ? { start: one, end: one } : { error: 'unparseable' };
        }
        if (parts.length === 2) {
            var a = parseDay(parts[0]), b = parseDay(parts[1]);
            if (!a || !b) return { error: 'unparseable' };
            if (b < a) return { error: 'end_before_start' };
            return { start: a, end: b };
        }
        return { error: 'unparseable' };
    }

    /**
     * 출장 하나의 기간
     * 우선순위: startDate(+endDate) 가 유효하면 사용, 없으면 date 필드 해석.
     * 둘 다 있고 서로 다르면 status 'inconsistent' (확인 필요) — 어느 쪽이 맞는지 추측하지 않는다.
     * @returns {{ status: 'ok'|'missing'|'invalid'|'inconsistent', start?, end?, source?, detail? }}
     */
    function normalizeTripPeriod(trip) {
        if (!trip || typeof trip !== 'object') return { status: 'missing' };
        var hasStart = trip.startDate !== undefined && trip.startDate !== null && String(trip.startDate).trim() !== '';
        var hasDate = trip.date !== undefined && trip.date !== null && String(trip.date).trim() !== '';
        var fromFields = null, fromDate = null;
        if (hasStart) {
            var s = parseDay(trip.startDate);
            var e = (trip.endDate !== undefined && trip.endDate !== null && String(trip.endDate).trim() !== '') ? parseDay(trip.endDate) : s;
            if (!s || !e) return { status: 'invalid', detail: 'startDate/endDate 형식 오류' };
            if (e < s) return { status: 'invalid', detail: '종료일이 시작일보다 앞섬' };
            fromFields = { start: s, end: e };
        }
        if (hasDate) {
            var r = parseRangeText(trip.date);
            if (!r.error) fromDate = r;
            else if (!fromFields) return { status: r.error === 'missing' ? 'missing' : 'invalid', detail: 'date: ' + r.error };
        }
        if (fromFields && fromDate && (fromFields.start !== fromDate.start || fromFields.end !== fromDate.end)) {
            return { status: 'inconsistent', start: fromFields.start, end: fromFields.end, detail: 'startDate/endDate 와 date 가 다름' };
        }
        if (fromFields) return { status: 'ok', start: fromFields.start, end: fromFields.end, source: 'fields' };
        if (fromDate) return { status: 'ok', start: fromDate.start, end: fromDate.end, source: 'date' };
        return { status: 'missing' };
    }

    /** 단일 날짜 기록(휴가 등) → { status, start, end } */
    function normalizeDay(value) {
        if (value === undefined || value === null || String(value).trim() === '') return { status: 'missing' };
        var d = parseDay(value);
        return d ? { status: 'ok', start: d, end: d } : { status: 'invalid' };
    }

    /** 시작~끝 필드 쌍(업무, 외부 일정) → { status, start, end }. 한쪽만 있으면 그 하루 */
    function normalizePair(startValue, endValue) {
        var hasS = startValue !== undefined && startValue !== null && String(startValue).trim() !== '';
        var hasE = endValue !== undefined && endValue !== null && String(endValue).trim() !== '';
        if (!hasS && !hasE) return { status: 'missing' };
        var s = hasS ? parseDay(startValue) : null, e = hasE ? parseDay(endValue) : null;
        if ((hasS && !s) || (hasE && !e)) return { status: 'invalid' };
        s = s || e; e = e || s;
        if (e < s) return { status: 'invalid', detail: '종료일이 시작일보다 앞섬' };
        return { status: 'ok', start: s, end: e };
    }

    /** 두 기간이 하루라도 겹치는가 (양 끝 포함) */
    function overlaps(a, b) {
        return !!(a && b && a.start && b.start && a.start <= b.end && b.start <= a.end);
    }

    root.FawwTripDates = {
        parseDay: parseDay,
        parseRangeText: parseRangeText,
        normalizeTripPeriod: normalizeTripPeriod,
        normalizeDay: normalizeDay,
        normalizePair: normalizePair,
        overlaps: overlaps
    };
})(typeof window !== 'undefined' ? window : this);
