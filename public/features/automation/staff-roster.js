/**
 * FaWW 자동화 — 내부 직원 명부와 별칭 해석 (순수 함수, DB 접근 없음)
 * 직원 9명과 별칭은 2026-10 업무 지시서 기준. 별칭은 '식별 단서'일 뿐 권한 근거가 아니다.
 * 실제 사람 ↔ 계정 연결은 승인된(users/{uid}.approved === true) 계정의 표시 이름으로만 한다.
 *   - 계정 0개: missing (계정 누락 또는 미승인) / 2개 이상: ambiguous (예: 같은 이름 계정 중복) → 자동 식별 거부
 * 브라우저: window.FawwStaffRoster
 */
(function (root) {
    'use strict';
    // accountNames: 계정 표시 이름 후보 / aliases: 캘린더·메일 제목에서 쓰이는 표기
    var ROSTER = [
        { key: '대장', label: '대장(대표님)', accountNames: ['대장', '대표님', 'min suk kim'], aliases: ['대장', '대표님'] }, // 'min suk kim' 은 기존 화면(팀 현황)에서 추정
        { key: '민홍', label: '민홍', accountNames: ['민홍', '민 홍'], aliases: ['민홍', '민 홍'] },
        { key: '이지희', label: '이지희', accountNames: ['이지희'], aliases: ['지희', '이지희'] },
        { key: '이동현', label: '이동현', accountNames: ['이동현'], aliases: ['동현', '이동현'] },
        { key: '류재진', label: '류재진', accountNames: ['류재진'], aliases: ['재진', '류재진'] },
        { key: '나강현', label: '나강현', accountNames: ['나강현'], aliases: ['강현', '나강현'] },
        { key: '김동휘', label: '김동휘', accountNames: ['김동휘'], aliases: ['동휘', '김동휘'] },
        { key: '문채이', label: '문채이', accountNames: ['문채이'], aliases: ['채이', '문채이'] },
        { key: '장성진', label: '장성진', accountNames: ['장성진'], aliases: ['성진', '장성진'] }
    ];
    function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }

    /** 명부 각 사람을 승인 계정과 연결 */
    function matchAccounts(users, roster) {
        roster = roster || ROSTER;
        var approvedByName = {}, unapprovedByName = {}, rosterNames = {};
        Object.keys(users || {}).forEach(function (uid) {
            var u = users[uid]; if (!u || typeof u !== 'object') return;
            var n = norm(u.displayName); if (!n) return;
            var map = u.approved === true ? approvedByName : unapprovedByName;
            (map[n] = map[n] || []).push(uid);
        });
        var people = roster.map(function (p) {
            var uids = [], unapproved = [];
            p.accountNames.forEach(function (n) {
                rosterNames[norm(n)] = true;
                (approvedByName[norm(n)] || []).forEach(function (u) { if (uids.indexOf(u) === -1) uids.push(u); });
                (unapprovedByName[norm(n)] || []).forEach(function (u) { if (unapproved.indexOf(u) === -1) unapproved.push(u); });
            });
            var status = uids.length === 1 ? 'ok' : (uids.length > 1 ? 'ambiguous' : 'missing');
            return { key: p.key, label: p.label, aliases: p.aliases, uid: uids.length === 1 ? uids[0] : null, uids: uids, unapprovedUids: unapproved, status: status };
        });
        // 명부에 없는 승인 계정 (외부인·중복·미등록 가능성) — 추천 후보가 아님
        var unrostered = [];
        Object.keys(approvedByName).forEach(function (n) { if (!rosterNames[n]) approvedByName[n].forEach(function (uid) { unrostered.push({ uid: uid, displayName: users[uid].displayName }); }); });
        var byKey = {}; people.forEach(function (p) { byKey[p.key] = p; });
        return { people: people, byKey: byKey, unrostered: unrostered };
    }

    /** 제목 속 이름 토큰 하나 → 명부의 사람 (별칭 정확 일치만, 부분 일치 없음) */
    function resolveToken(token, roster) {
        roster = roster || ROSTER;
        var full = norm(token), t = norm(String(token || '').replace(/님$/, ''));   // '대표님'은 그대로, '재진님'은 '재진'으로도 비교
        if (!t) return { status: 'empty', token: token };
        var hits = roster.filter(function (p) { return p.aliases.concat(p.accountNames).some(function (a) { return norm(a) === t || norm(a) === full; }); });
        if (hits.length === 1) return { status: 'matched', key: hits[0].key, token: token };
        if (hits.length > 1) return { status: 'ambiguous', keys: hits.map(function (h) { return h.key; }), token: token };
        return { status: 'unknown', token: token };
    }

    /** 자유 문장에서 명부 이름(2글자 이상 별칭·전체 이름)이 단어로 등장하는지 (앞뒤가 한글이 아닐 때만) */
    function findNamesInText(text, roster) {
        roster = roster || ROSTER;
        var s = String(text || ''), found = [];
        roster.forEach(function (p) {
            p.aliases.concat(p.accountNames).forEach(function (a) {
                if (a.length < 2 || found.indexOf(p.key) !== -1) return;
                var esc = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                if (new RegExp('(^|[^가-힣])' + esc + '(?=님|[^가-힣]|$)').test(s)) found.push(p.key);
            });
        });
        return found;
    }

    root.FawwStaffRoster = { ROSTER: ROSTER, matchAccounts: matchAccounts, resolveToken: resolveToken, findNamesInText: findNamesInText, norm: norm };
})(typeof window !== 'undefined' ? window : this);
