// HTML 이스케이프 유틸리티 (XSS 방어용)
function escapeHTML(str) {
    // null/undefined 만 빈 문자열. 숫자(0 포함) 등은 문자열로 바꿔 표시한다.
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"`]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;',
            '`': '&#96;'
        }[tag] || tag)
    );
}

// onclick="fn(...)" 같은 이벤트 속성 안에 넣을 값: JS 문자열로 인코딩한 뒤 HTML 속성용으로 이스케이프한다.
// 사용법: onclick="openTask(${jsAttrArg(task.id)})"  ← 따옴표는 이 함수가 붙이므로 직접 쓰지 않는다.
// (escapeHTML 만 쓰면 브라우저가 &#39; 를 ' 로 되돌린 뒤 JS 를 실행하므로 안전하지 않다)
function jsAttrArg(value) {
    const s = (value === null || value === undefined) ? '' : String(value);
    return escapeHTML(JSON.stringify(s).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'));
}

// href/src 에 넣을 주소: http(s), mailto, tel, blob, 이미지 data URL, 상대경로만 허용. 그 외(javascript: 등)는 '#'.
function safeUrl(url) {
    if (url === null || url === undefined) return '#';
    const u = String(url).trim();
    if (/^(https?:|mailto:|tel:|blob:)/i.test(u) || /^data:image\//i.test(u) || /^(\/|\.\/|\.\.\/|#)/.test(u)) return escapeHTML(u);
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) return escapeHTML(u); // 스킴 없는 상대 경로
    return '#';
}

// 직원 이름이 자유 텍스트(일정 제목·담당자 칸 등)에서 처음 언급된 위치를 찾는다. 없으면 -1.
// - 전체 이름(민홍, 장성진)은 어디에 있든 인정
// - 한글 3글자 이상 이름: 성을 뺀 이름(성진)도 어디에 있든 인정
// - 한글 2글자 이름: 성을 뺀 한 글자(홍)는 '홍보'·'홍길동' 오인을 막기 위해
//   앞뒤가 한글이 아닐 때(독립된 단어)만 인정한다. 바로 뒤의 '님'은 허용.
function memberMentionIndex(text, displayName) {
    if (!text || !displayName) return -1;
    const src = String(text), full = String(displayName).trim();
    if (!full) return -1;
    const lower = src.toLowerCase();
    let idx = lower.indexOf(full.toLowerCase());
    if (idx !== -1) return idx;
    if (/^[가-힣]{3,}$/.test(full)) return src.indexOf(full.substring(1));
    if (/^[가-힣]{2}$/.test(full)) {
        const given = full.substring(1);
        const m = new RegExp('(^|[^가-힣])' + given + '(?=님|[^가-힣]|$)').exec(src);
        return m ? m.index + m[1].length : -1;
    }
    return -1;
}
function textMentionsMember(text, displayName) {
    return memberMentionIndex(text, displayName) !== -1;
}

// ---------------------------------------------------------------------------
// 날짜 표시 공용 규칙 (DB 저장값은 그대로 두고, 화면에 보여줄 때만 변환)
//  - 짧은형(카드·목록): 10/6 (월)        올해가 아니면 2027/1/5 (화)
//  - 한글형(팝업·상세): 10월 6일 (월)    올해가 아니면 2027년 1월 5일 (화)
//  - 해석할 수 없는 값은 원래 글자를 그대로 돌려준다 (추측하지 않음)
// 반환값은 일반 문자열이므로 innerHTML 에 넣을 때는 기존처럼 escapeHTML 로 감싼다.
// ---------------------------------------------------------------------------
const DATE_WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

// 'YYYY-MM-DD'(시간 포함 가능)는 브라우저가 UTC 로 해석하지 않도록 현지 날짜로 직접 만든다.
function parseDisplayDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') { const d = new Date(value); return isNaN(d.getTime()) ? null : d; }
    const s = String(value).trim();
    if (/^\d{12,13}$/.test(s)) return parseDisplayDate(Number(s));
    const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2}))?/.exec(s);
    if (!m) return null;
    const y = +m[1], mo = +m[2], da = +m[3];
    const d = new Date(y, mo - 1, da, m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
    // 2026-02-30 같은 없는 날짜는 해석하지 않음
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
    return d;
}

function formatDateShort(value) {
    const d = parseDisplayDate(value);
    if (!d) return (value === null || value === undefined) ? '' : String(value);
    const base = `${d.getMonth() + 1}/${d.getDate()} (${DATE_WEEKDAYS_KO[d.getDay()]})`;
    return d.getFullYear() === new Date().getFullYear() ? base : `${d.getFullYear()}/${base}`;
}

function formatDateLong(value) {
    const d = parseDisplayDate(value);
    if (!d) return (value === null || value === undefined) ? '' : String(value);
    const base = `${d.getMonth() + 1}월 ${d.getDate()}일 (${DATE_WEEKDAYS_KO[d.getDay()]})`;
    return d.getFullYear() === new Date().getFullYear() ? base : `${d.getFullYear()}년 ${base}`;
}

function formatDateRange(start, end, style) {
    const a = parseDisplayDate(start), b = parseDisplayDate(end);
    const one = style === 'long' ? formatDateLong : formatDateShort;
    if (!a) return [start, end].filter(x => x !== null && x !== undefined && x !== '').map(String).join(' ~ ');
    if (!b || (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate())) return one(a);
    if (style === 'long' && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
        return `${one(a)} ~ ${b.getDate()}일 (${DATE_WEEKDAYS_KO[b.getDay()]})`;
    }
    return `${one(a)} ~ ${one(b)}`;
}

// 저장된 날짜 글자(단일 또는 '시작 to 끝', '시작 ~ 끝', '시작 - 끝')를 보기 좋게. 해석 실패 시 원문 그대로.
function formatDateText(raw, style) {
    if (raw === null || raw === undefined) return '';
    const str = String(raw).trim();
    if (!str) return '';
    const parts = str.split(/\s*(?:\bto\b|~|\s-\s)\s*/i).filter(Boolean);
    if (parts.length === 1) return parseDisplayDate(parts[0]) ? (style === 'long' ? formatDateLong(parts[0]) : formatDateShort(parts[0])) : str;
    if (parts.length === 2 && parseDisplayDate(parts[0]) && parseDisplayDate(parts[1])) return formatDateRange(parts[0], parts[1], style);
    return str;
}

// 타임스탬프 등 날짜+시간: 10/8 (수) 14:30
function formatDateTime(value, style) {
    const d = parseDisplayDate(value);
    if (!d) return (value === null || value === undefined) ? '' : String(value);
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${style === 'long' ? formatDateLong(d) : formatDateShort(d)} ${hm}`;
}

/**
 * HTML 태그를 제거하고 개행 문자를 살려 일반 텍스트로 변환하는 함수
 */
function htmlToPlainText(html) {
    if (!html) return '';
    let text = html
        .replace(/<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, '$2 $1')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<p[^>]*>/gi, '')
        .replace(/<div[^>]*>/gi, '')
        .replace(/<li[^>]*>/gi, '');
        
    text = text.replace(/<[^>]+>/g, '');
    
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');
        text = doc.body.textContent || doc.body.innerText || text;
    } catch (e) {
        text = text
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
    }
    
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
}

window.parseTotalLeave = function(userProfile) {
    if (!userProfile) return 15;
    const isValidNumber = (val) => {
        if (val === null || val === undefined || typeof val === 'boolean' || typeof val === 'object') return false;
        if (typeof val === 'string' && val.trim() === '') return false;
        const num = Number(val);
        return !isNaN(num) && isFinite(num);
    };
    if (isValidNumber(userProfile.leaveTotal)) return Number(userProfile.leaveTotal);
    if (isValidNumber(userProfile.totalLeave)) return Number(userProfile.totalLeave);
    return 15;
};
