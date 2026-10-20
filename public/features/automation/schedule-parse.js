/**
 * FaWW 자동화 — 일정 제목 해석과 보수적 규칙 분류 (순수 함수, AI 아님)
 *
 * 제목은 자유 형식이라 방어적으로 해석하고, 원본은 그대로 보존한다.
 *   [확정][1호차][3호차] 고객사 피지컬케어 (재진,동현,강현)  → status 확정, vehicles 1·3호차, 이름 토큰 3개
 *   [출장] 쿠팡 강현/성진/채이                               → 슬래시 묶음을 이름 토큰으로
 *   [확정] 고객사 피지컬케어 (직원 미배정)                     → 명시적 미배정
 *   김동휘 학교 시험                                         → 근무 불가(학교 시험), 이름은 본문에서 찾음
 * 분류는 키워드 규칙이다. 애매하면 'unknown'(분류 확인 필요)으로 둔다.
 * 브라우저: window.FawwScheduleParse
 */
(function (root) {
    'use strict';

    var STATUS_WORDS = { '확정': '확정', '조율중': '조율중', '조율 중': '조율중', '출장': '출장', '취소': '취소', '휴가': '휴가', '반차': '반차' };
    var NAME_TOKEN = /^[가-힣]{2,4}$|^[A-Za-z][A-Za-z .]{1,20}$/;

    function parseTitle(title) {
        var raw = String(title == null ? '' : title);
        var out = { raw: raw, status: null, vehicles: [], tags: [], groups: [], explicitUnassigned: false, body: '' };
        var rest = raw.replace(/^\s+/, '');
        var m;
        while ((m = /^\[([^\]]*)\]\s*/.exec(rest))) {
            var tag = m[1].trim();
            if (/^\d+\s*호차$/.test(tag)) out.vehicles.push(tag.replace(/\s+/g, ''));
            else if (STATUS_WORDS[tag] && !out.status) out.status = STATUS_WORDS[tag];
            else out.tags.push(tag);
            rest = rest.slice(m[0].length);
        }
        out.body = rest.trim();
        // 괄호 묶음: 이름 목록 후보
        var re = /\(([^()]*)\)/g, g;
        while ((g = re.exec(out.body))) {
            var content = g[1].trim();
            if (/미배정|미정|배정\s*전/.test(content)) { out.explicitUnassigned = true; continue; }
            var tokens = content.split(/[,，/·、\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
            if (tokens.length && tokens.every(function (t) { return NAME_TOKEN.test(t.replace(/님$/, '')); })) out.groups.push({ kind: 'paren', text: g[0], tokens: tokens });
        }
        // 슬래시 묶음 (괄호 밖): 강현/성진/채이
        var outside = out.body.replace(/\([^()]*\)/g, ' ');
        var sl = /([가-힣]{2,4}(?:\s*\/\s*[가-힣]{2,4})+)/g, s;
        while ((s = sl.exec(outside))) out.groups.push({ kind: 'slash', text: s[1], tokens: s[1].split('/').map(function (x) { return x.trim(); }) });
        return out;
    }

    /**
     * 일정 분류 (보수적 규칙)
     *  trip / special_lecture / leave / unavailable(학교 시험·파견·상주) / meeting / unknown
     */
    function classify(parsed, description) {
        var t = parsed.body + ' ' + (parsed.tags || []).join(' ');
        var d = String(description || '');
        if (parsed.status === '휴가' || parsed.status === '반차' || /연차|반차|휴가|병가/.test(t)) return { kind: 'leave', half: parsed.status === '반차' || /반차/.test(t) };
        var UNAVAIL = /학교\s*시험|시험\s*기간|중간\s*고사|기말\s*고사|파견|상주/;
        if (UNAVAIL.test(t)) return { kind: 'unavailable', reason: (t.match(UNAVAIL) || [''])[0] };
        if (/요가|필라테스|명상/.test(t)) return { kind: 'special_lecture' };
        if (parsed.status === '확정' || parsed.status === '조율중' || parsed.status === '출장' || /\[FaWW 출장연동 ID:/.test(d) || /피지컬\s*케어|출장|교육|상담실?|특강|강의/.test(t)) return { kind: 'trip' };
        if (/회의|미팅|meeting|워크숍|면담/i.test(t)) return { kind: 'meeting' };
        return { kind: 'unknown' };
    }

    root.FawwScheduleParse = { parseTitle: parseTitle, classify: classify };
})(typeof window !== 'undefined' ? window : this);
