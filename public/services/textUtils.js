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
