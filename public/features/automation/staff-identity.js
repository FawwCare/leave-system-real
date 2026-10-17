/**
 * FaWW 자동화 Phase 1A — 직원 식별 모듈 (순수 함수, DB 읽기·쓰기 없음)
 *
 * 담당자 문자열("장성진, 민홍", "성진/홍")을 승인된 직원의 UID 로 해석한다.
 *  - 기준 목록: users 중 approved === true 인 직원만
 *  - 별칭은 호출하는 쪽에서 주입한다 ({ uid: ['별칭', ...] }). users/{uid} 에 별칭을 저장하지 않는다
 *    (본인이 수정할 수 있는 프로필 값은 배정 판단의 근거로 쓰지 않음).
 *  - 애매하면 확정하지 않는다: 후보가 0명이면 unmatched, 2명 이상이면 ambiguous.
 *
 * 매칭 우선순위 (먼저 하나로 정해지는 단계에서 멈춤)
 *  1. 표시 이름 정확히 일치 (공백·대소문자 무시)
 *  2. 주입된 별칭 정확히 일치
 *  3. 기존 화면 규칙과 호환되는 '성을 뺀 이름' 일치
 *     - 한글 3글자 이상 이름: 뒤 2글자 이상 (장성진 → 성진)
 *     - 한글 2글자 이름: 뒤 1글자 (민홍 → 홍). 토큰 전체가 그 한 글자일 때만
 *  단계 1·2 에서 같은 토큰이 두 명 이상에 해당하면(동명이인) 다음 단계로 넘어가지 않고 ambiguous.
 *
 * 브라우저: window.FawwStaffIdentity / 테스트: 같은 객체를 VM 컨텍스트에서 사용
 */
(function (root) {
    'use strict';

    var SEPARATORS = /[,/，、]+/;

    function norm(s) {
        return String(s === null || s === undefined ? '' : s).replace(/\s+/g, '').toLowerCase();
    }

    // 토큰 정리: 괄호 속 설명("김하람(팀장)") 제거, 끝의 존칭 '님' 제거, 앞뒤 공백 제거
    function cleanToken(t) {
        return String(t)
            .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
            .replace(/님\s*$/, '')
            .trim();
    }

    function givenNameOf(displayName) {
        var n = norm(displayName);
        if (/^[가-힣]{3,}$/.test(n)) return n.substring(1);
        if (/^[가-힣]{2}$/.test(n)) return n.substring(1);
        return null;
    }

    /**
     * 직원 색인 만들기
     * @param {Object} users  { uid: { displayName, approved, ... } }
     * @param {Object} [aliases] { uid: ['별칭', ...] } — 관리자가 관리하는 값만 주입할 것
     * @returns {{ staff: Array, byName: Object, byAlias: Object, byGiven: Object, excluded: Object }}
     */
    function buildStaffIndex(users, aliases) {
        var idx = { staff: [], byName: {}, byAlias: {}, byGiven: {}, excluded: {} };
        var add = function (map, key, uid) {
            if (!key) return;
            if (!map[key]) map[key] = [];
            if (map[key].indexOf(uid) === -1) map[key].push(uid);
        };
        Object.keys(users || {}).forEach(function (uid) {
            var u = users[uid];
            if (!u || typeof u !== 'object') return;
            var name = norm(u.displayName);
            if (u.approved !== true) {
                if (name) add(idx.excluded, name, uid); // 미승인: 해석 대상에서 제외하되 사유 안내용으로 기록
                return;
            }
            idx.staff.push({ uid: uid, displayName: u.displayName || '' });
            add(idx.byName, name, uid);
            var g = givenNameOf(u.displayName);
            if (g) add(idx.byGiven, g, uid);
        });
        Object.keys(aliases || {}).forEach(function (uid) {
            if (!idx.staff.some(function (s) { return s.uid === uid; })) return; // 승인된 직원의 별칭만
            (aliases[uid] || []).forEach(function (a) { add(idx.byAlias, norm(a), uid); });
        });
        return idx;
    }

    /**
     * 토큰 하나 해석
     * @returns {{ token, status: 'matched'|'ambiguous'|'unmatched', uid?, candidates?, matchType?, note? }}
     */
    function resolveToken(token, idx) {
        var t = norm(token);
        var out = { token: token };
        if (!t) { out.status = 'unmatched'; out.note = 'empty'; return out; }
        var stages = [['exact', idx.byName], ['alias', idx.byAlias], ['givenName', idx.byGiven]];
        for (var i = 0; i < stages.length; i++) {
            var hits = stages[i][1][t] || [];
            if (hits.length === 1) { out.status = 'matched'; out.uid = hits[0]; out.matchType = stages[i][0]; return out; }
            if (hits.length > 1) { out.status = 'ambiguous'; out.candidates = hits.slice(); out.matchType = stages[i][0]; return out; }
        }
        out.status = 'unmatched';
        if (idx.excluded[t]) out.note = 'unapproved'; // 미승인 직원 이름과만 일치
        return out;
    }

    /**
     * 담당자 문자열 해석
     * @returns {{ uids: string[], entries: Array, complete: boolean }}
     *   complete = 모든 토큰이 한 명으로 확정됨 (ambiguous·unmatched 가 하나라도 있으면 false)
     */
    function resolveAssignees(text, idx) {
        var raw = String(text === null || text === undefined ? '' : text);
        var tokens = raw.split(SEPARATORS).map(cleanToken).filter(function (x) { return x.length > 0; });
        var entries = tokens.map(function (tk) { return resolveToken(tk, idx); });
        var uids = [];
        entries.forEach(function (e) { if (e.status === 'matched' && uids.indexOf(e.uid) === -1) uids.push(e.uid); });
        return { uids: uids, entries: entries, complete: entries.length > 0 && entries.every(function (e) { return e.status === 'matched'; }) };
    }

    /**
     * 자유 텍스트(일정 제목 등)에서 언급된 직원 찾기. 토큰 분리 없이 본문에 이름이 들어 있는지 본다.
     *  - 전체 이름·별칭(2글자 이상): 부분 문자열
     *  - 성을 뺀 이름: 3글자 이상 이름의 뒤 2글자는 부분 문자열, 2글자 이름의 뒤 1글자는 앞뒤가 한글이 아닐 때만
     * 한 표현이 여러 직원에 해당하면 그 직원들을 ambiguous 로 돌려준다.
     * @returns {{ matched: string[], ambiguous: string[] }}
     */
    function findMentionedStaff(text, idx) {
        var src = String(text || '');
        var compact = norm(src);
        var matched = [], ambiguous = [];
        var push = function (arr, uid) { if (arr.indexOf(uid) === -1) arr.push(uid); };
        var foundKeys = [];
        var check = function (map, keyTest) {
            Object.keys(map).forEach(function (key) {
                if (!keyTest(key)) return;
                foundKeys.push(key);
                var uids = map[key];
                if (uids.length === 1) push(matched, uids[0]); else uids.forEach(function (u) { push(ambiguous, u); });
            });
        };
        check(idx.byName, function (k) { return k.length >= 2 && compact.indexOf(k) !== -1; });
        check(idx.byAlias, function (k) { return k.length >= 2 && compact.indexOf(k) !== -1; });
        check(idx.byGiven, function (k) {
            // '장성진'이 이미 전체 이름으로 잡혔으면 그 안의 '성진'으로 다른 직원을 다시 찾지 않음
            if (foundKeys.some(function (fk) { return fk.indexOf(k) !== -1; })) return false;
            if (k.length >= 2) return compact.indexOf(k) !== -1;
            return new RegExp('(^|[^가-힣])' + k + '(?=님|[^가-힣]|$)').test(src);
        });
        // 한 직원이 확실히 언급되면 같은 직원의 ambiguous 표시는 제거
        ambiguous = ambiguous.filter(function (u) { return matched.indexOf(u) === -1; });
        return { matched: matched, ambiguous: ambiguous };
    }

    root.FawwStaffIdentity = {
        buildStaffIndex: buildStaffIndex,
        resolveAssignees: resolveAssignees,
        resolveToken: resolveToken,
        findMentionedStaff: findMentionedStaff,
        _norm: norm
    };
})(typeof window !== 'undefined' ? window : this);
