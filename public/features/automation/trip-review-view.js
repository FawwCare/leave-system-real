/**
 * FaWW 자동화 Phase 1B — 관리자 전용 '출장 배정 검토' 화면 (읽기 전용)
 * 의존: trip-review-data.js, trip-review-model.js (+ 엔진 3개), 전역 escapeHTML·formatDateShort·formatDateRange·formatDateTime (textUtils.js)
 *
 * - 메뉴(#tab-btn-automation)는 관리자에게만 표시. 판정식은 기존 코드와 같은 ADMIN_UIDS / ADMIN_EMAILS 비교.
 * - 탭(#tab-automation)이 보일 때마다 관리자 여부를 다시 확인 → 비관리자는 접근 안내만 표시, 데이터 조회 안 함.
 *   (화면 차단일 뿐 DB 읽기 권한을 바꾸지 않는다. 이 화면이 읽는 데이터는 승인된 직원이면 원래 읽을 수 있는 범위)
 * - 로그아웃·계정 전환 시 읽어 둔 데이터와 화면을 비운다.
 * - DB 쓰기 없음: 조회는 FawwTripReviewData.load(once 만 사용)
 */
(function () {
    'use strict';

    var TAB_ID = 'tab-automation';
    var state = { uid: null, loaded: null, model: null, selectedId: null, loading: false, error: null,
                  filters: { query: '', tripStatus: 'all', review: 'all' }, range: null, aliases: {} };

    function esc(s) { return (typeof escapeHTML === 'function') ? escapeHTML(s) : String(s == null ? '' : s).replace(/[&<>"'`]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
    function el(id) { return document.getElementById(id); }
    function currentUser() { try { return (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser : null; } catch (e) { return null; } }

    // 기존 코드와 같은 관리자 판정식 (config.js·main.js·services.js 에 같은 식이 반복되어 있음)
    function isAutomationAdmin(user) {
        if (!user) return false;
        return (typeof ADMIN_UIDS !== 'undefined' && ADMIN_UIDS.includes(user.uid)) ||
               (typeof ADMIN_EMAILS !== 'undefined' && !!user.email && ADMIN_EMAILS.includes(user.email));
    }

    function resetState(uid) {
        state.uid = uid || null; state.loaded = null; state.model = null; state.selectedId = null; state.loading = false; state.error = null;
        state.filters = { query: '', tripStatus: 'all', review: 'all' }; state.range = null;
        var root = el(TAB_ID); if (root) root.innerHTML = '';
    }

    function syncMenu() {
        var user = currentUser();
        var btn = el('tab-btn-automation');
        if (btn) btn.style.display = isAutomationAdmin(user) ? '' : 'none';
        var uid = user ? user.uid : null;
        if (uid !== state.uid) resetState(uid); // 로그아웃·계정 전환: 이전 사용자의 조회 결과 제거
    }

    // ---------------------------------------------------------------- 진입
    function open() {
        var root = el(TAB_ID); if (!root) return;
        var user = currentUser();
        if (!isAutomationAdmin(user)) {
            root.innerHTML = '<div class="section ar-denied"><h2>자동화 관리</h2><p>관리자만 사용할 수 있는 화면입니다.</p></div>';
            return;
        }
        if (state.uid !== user.uid) resetState(user.uid);
        if (!state.range) state.range = FawwTripReviewModel.defaultRange();
        if (!state.loaded && !state.loading) reload(); else render();
    }

    function reload() {
        var user = currentUser();
        if (!isAutomationAdmin(user)) { open(); return; }
        var uid = user.uid;
        state.loading = true; state.error = null; render();
        var database = (typeof db !== 'undefined') ? db : null;
        FawwTripReviewData.load(database).then(function (loaded) {
            if (state.uid !== uid) return; // 조회 중 계정이 바뀌면 결과 버림
            state.loaded = loaded; state.loading = false; rebuild(); render();
        }, function (e) {
            if (state.uid !== uid) return;
            state.loading = false; state.error = (e && e.message) ? e.message : String(e); render();
        });
    }

    function rebuild() {
        if (!state.loaded) { state.model = null; return; }
        state.model = FawwTripReviewModel.build(state.loaded, { range: state.range, aliases: state.aliases });
        if (state.selectedId && !state.model.trips.some(function (t) { return t.id === state.selectedId; })) state.selectedId = null;
    }

    // ---------------------------------------------------------------- 렌더링
    var STATUS_TEXT = { complete: '완전', partial: '일부만 조회', failed: '조회 실패' };

    function badge(kind, text) { return '<span class="ar-badge ar-' + esc(kind) + '">' + esc(text) + '</span>'; }

    function render() {
        var root = el(TAB_ID); if (!root) return;
        var m = state.model, r = state.range || FawwTripReviewModel.defaultRange();
        var html = '<div class="ar-wrap">';
        html += '<div class="section ar-head"><div class="ar-title"><span class="material-symbols-rounded">auto_awesome</span><div><h2>자동화 관리</h2><div class="ar-sub">출장 배정 검토 · 읽기 전용 (데이터를 변경하지 않습니다)</div></div></div>' +
            '<div class="ar-filters">' +
            '<input type="search" id="ar-q" placeholder="출장명·장소 검색" value="' + esc(state.filters.query) + '">' +
            '<input type="date" id="ar-start" value="' + esc(r.start) + '" aria-label="조회 시작일"><span class="ar-tilde">~</span><input type="date" id="ar-end" value="' + esc(r.end) + '" aria-label="조회 종료일">' +
            '<select id="ar-trip-status" aria-label="출장 상태"><option value="all">출장 상태 전체</option><option value="조율중">조율중</option><option value="확정">확정</option></select>' +
            '<select id="ar-review" aria-label="충돌 상태"><option value="all">충돌 상태 전체</option>' +
            Object.keys(FawwTripReviewModel.REVIEW_LABELS).map(function (k) { return '<option value="' + k + '">' + esc(FawwTripReviewModel.REVIEW_LABELS[k]) + '</option>'; }).join('') + '</select>' +
            '<button type="button" id="ar-refresh" class="ar-btn"' + (state.loading ? ' disabled' : '') + '><span class="material-symbols-rounded">refresh</span>새로고침</button>' +
            '</div></div>';

        if (state.loading) { html += '<div class="section ar-empty">불러오는 중…</div></div>'; root.innerHTML = html; restoreFilters(); return; }
        if (state.error) { html += '<div class="section ar-banner ar-banner-failed">데이터를 불러오지 못했습니다: ' + esc(state.error) + '</div></div>'; root.innerHTML = html; restoreFilters(); return; }
        if (!m) { html += '</div>'; root.innerHTML = html; restoreFilters(); return; }

        // 요약 카드
        var s = m.summary;
        html += '<div class="ar-cards">' +
            card('조회 기간 출장', s.total + '건') + card('검토 필요', s.needsReview + '건') +
            card('충돌 발견', s.conflicts + '건', s.conflicts ? 'conflict' : '') + card('담당자 확인 필요', s.assigneeCheck + '건', s.assigneeCheck ? 'caution' : '') +
            card('데이터 조회 상태', STATUS_TEXT[m.dataStatus] || m.dataStatus, m.dataStatus === 'complete' ? 'clear' : (m.dataStatus === 'failed' ? 'conflict' : 'caution')) +
            '</div>';
        html += '<div class="ar-meta">조회 기간 ' + esc(fmtRange(m.range.start, m.range.end)) + ' · 마지막 조회 ' + esc(m.fetchedAt && typeof formatDateTime === 'function' ? formatDateTime(m.fetchedAt) : '-') + '</div>';

        // 조회 완전성 (판정과 별개로 표시)
        if (m.dataStatus !== 'complete') {
            html += '<div class="ar-banner ar-banner-' + esc(m.dataStatus) + '"><strong>' + (m.dataStatus === 'failed' ? '일부 데이터를 불러오지 못했습니다.' : '일부 데이터만 조회되었습니다.') +
                '</strong> 아래 판정은 확인된 내용만 반영하며, 근거가 없는 직원도 "확인된 충돌 없음"이 아니라 "검토 불완전"으로 표시됩니다.<ul>' +
                Object.keys(m.sourceLabels).map(function (k) {
                    var c = m.coverage[k] || { status: 'failed' };
                    return '<li>' + esc(m.sourceLabels[k]) + ': ' + badge(c.status === 'complete' ? 'clear' : (c.status === 'failed' ? 'conflict' : 'caution'), STATUS_TEXT[c.status] || c.status) +
                        (c.count !== undefined ? ' ' + esc(c.count) + '건' : '') + (c.message ? ' — ' + esc(c.message) : '') + '</li>';
                }).join('') + '</ul></div>';
        }

        var trips = FawwTripReviewModel.filterTrips(m.trips, state.filters);
        html += '<div class="ar-split"><div class="section ar-list"><div class="ar-list-head">출장 ' + trips.length + '건' + (trips.length !== m.trips.length ? ' (전체 ' + m.trips.length + '건 중)' : '') + '</div>';
        if (!trips.length) html += '<div class="ar-empty">조건에 맞는 출장이 없습니다.</div>';
        trips.forEach(function (t) {
            html += '<button type="button" class="ar-trip' + (t.id === state.selectedId ? ' selected' : '') + '" data-trip-id="' + esc(t.id) + '">' +
                '<div class="ar-trip-top"><span class="ar-trip-name">' + esc(t.name) + '</span>' + badge(t.review, t.reviewLabel) + '</div>' +
                '<div class="ar-trip-meta">' + esc(fmtRange(t.start, t.end)) + (t.place ? ' · ' + esc(t.place) : '') + '</div>' +
                '<div class="ar-trip-meta">담당 ' + esc(t.assigneeText || '미지정') + ' · 필요 ' + esc(t.requiredPersonnel || '-') + '명 · ' + esc(t.status || '상태 없음') + '</div>' +
                '</button>';
        });
        if (m.undatedTrips.length) {
            html += '<details class="ar-undated"><summary>날짜를 해석할 수 없는 출장 ' + m.undatedTrips.length + '건 (조회 기간 포함 여부 확인 불가)</summary><ul>' +
                m.undatedTrips.map(function (u) { return '<li><strong>' + esc(u.name) + '</strong> — 날짜 "' + esc(u.rawDate || '없음') + '" (' + esc(u.status) + (u.detail ? ': ' + esc(u.detail) : '') + ') · 담당 ' + esc(u.assignee || '-') + '</li>'; }).join('') + '</ul></details>';
        }
        html += '</div><div class="section ar-detail" id="ar-detail">' + renderDetail(m) + '</div></div></div>';
        root.innerHTML = html;
        restoreFilters();
    }

    function card(label, value, tone) {
        return '<div class="ar-card' + (tone ? ' ar-tone-' + tone : '') + '"><div class="ar-card-label">' + esc(label) + '</div><div class="ar-card-value">' + esc(value) + '</div></div>';
    }
    function fmtRange(a, b) {
        if (typeof formatDateRange === 'function') return formatDateRange(a, b);
        return a === b ? a : a + ' ~ ' + b;
    }

    function renderDetail(m) {
        var t = m.trips.find(function (x) { return x.id === state.selectedId; });
        if (!t) return '<div class="ar-empty">왼쪽 목록에서 출장을 선택하면 직원별 검토 결과가 표시됩니다.</div>';
        var res = t.result;
        var assignedUids = t.assigned.uids;
        var html = '<div class="ar-detail-head"><h3>' + esc(t.name) + '</h3>' + badge(t.review, t.reviewLabel) +
            '<div class="ar-trip-meta">' + esc(fmtRange(t.start, t.end)) + (t.place ? ' · ' + esc(t.place) : '') + ' · ' + esc(t.status || '상태 없음') + ' · 필요 ' + esc(t.requiredPersonnel || '-') + '명</div>' +
            '<div class="ar-assignees">현재 담당: ' + (t.assigned.entries.length ? t.assigned.entries.map(function (e) {
                if (e.status === 'matched') { var st = res.staff.find(function (x) { return x.uid === e.uid; }); return '<span class="ar-chip">' + esc(st ? st.displayName : e.token) + '</span>'; }
                if (e.status === 'ambiguous') return '<span class="ar-chip ar-chip-warn">' + esc(e.token) + ' (여러 직원에 해당)</span>';
                return '<span class="ar-chip ar-chip-warn">' + esc(e.token) + (e.note === 'unapproved' ? ' (미승인 계정)' : ' (직원과 연결 안 됨)') + '</span>';
            }).join(' ') : '<span class="ar-chip ar-chip-warn">미지정</span>') + '</div></div>';

        if (!res.reviewComplete) {
            var why = [];
            if (!res.coverage.complete) why.push('조회 불완전: ' + res.coverage.incomplete.map(function (k) { return m.sourceLabels[k] || k; }).join(', '));
            if (res.reviewGaps.length) why.push('담당자를 특정할 수 없는 같은 기간 출장·휴가 ' + res.reviewGaps.length + '건');
            html += '<div class="ar-banner ar-banner-partial">검토 불완전 — ' + esc(why.join(' · ')) + '. 확인된 충돌·주의는 그대로 표시합니다.</div>';
        }
        if (res.reviewGaps.length) {
            html += '<details class="ar-gaps" open><summary>담당자 확인이 필요한 같은 기간 일정 ' + res.reviewGaps.length + '건</summary><ul>' +
                res.reviewGaps.map(function (g) { return '<li>' + esc(g.source === 'trip' ? '출장' : '휴가') + ': ' + esc(g.name || g.id) + '</li>'; }).join('') + '</ul></details>';
        }
        if (t.externalUnattributed.length) {
            html += '<details class="ar-gaps"><summary>담당자를 알 수 없는 같은 기간 캘린더 일정 ' + t.externalUnattributed.length + '건 — 외부 일정 검토 미완료</summary><ul>' +
                t.externalUnattributed.map(function (u) { return '<li>' + esc(u.detail || u.id) + '</li>'; }).join('') + '</ul></details>';
        }

        var rows = res.staff.slice().sort(function (a, b) { return (assignedUids.indexOf(b.uid) !== -1) - (assignedUids.indexOf(a.uid) !== -1); });
        html += '<div class="ar-table-wrap"><table class="ar-table"><thead><tr><th>직원</th><th>판정</th><th>사유·연관 일정</th></tr></thead><tbody>';
        rows.forEach(function (st) {
            var reasons = st.reasons.length ? '<ul>' + st.reasons.map(function (x) {
                return '<li class="ar-r-' + esc(x.level) + '">' + (x.level === 'info' ? '<span class="ar-ref">참고</span> ' : '') + esc(x.message) + '</li>';
            }).join('') + '</ul>' : '<span class="ar-muted">' + (st.verdict === 'clear' ? '확인된 근거 없음' : '확인된 근거 없음 (데이터 불완전)') + '</span>';
            html += '<tr><td><strong>' + esc(st.displayName) + '</strong>' + (assignedUids.indexOf(st.uid) !== -1 ? ' <span class="ar-chip">배정됨</span>' : '') + '</td><td>' + badge(st.verdict, st.label) + '</td><td>' + reasons + '</td></tr>';
        });
        html += '</tbody></table></div>';
        if (res.skippedDuplicates.length) html += '<div class="ar-muted ar-note">출장·휴가에서 복제된 캘린더 일정 ' + res.skippedDuplicates.length + '건은 중복으로 보고 제외했습니다.</div>';
        return html;
    }

    function restoreFilters() {
        var a = el('ar-trip-status'); if (a) a.value = state.filters.tripStatus;
        var b = el('ar-review'); if (b) b.value = state.filters.review;
    }

    // ---------------------------------------------------------------- 이벤트 (위임, 인라인 핸들러에 데이터 넣지 않음)
    function onClick(e) {
        var root = el(TAB_ID); if (!root || !root.contains(e.target)) return;
        if (e.target.closest('#ar-refresh')) { reload(); return; }
        var item = e.target.closest('.ar-trip');
        if (item) {
            state.selectedId = item.getAttribute('data-trip-id');
            render();
            if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
                var d = el('ar-detail'); if (d && d.scrollIntoView) d.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    }
    function onChange(e) {
        var id = e.target && e.target.id;
        if (id === 'ar-trip-status') { state.filters.tripStatus = e.target.value; render(); }
        else if (id === 'ar-review') { state.filters.review = e.target.value; render(); }
        else if (id === 'ar-start' || id === 'ar-end') {
            var s = el('ar-start').value, en = el('ar-end').value;
            if (FawwTripDates.parseDay(s) && FawwTripDates.parseDay(en) && s <= en) { state.range = { start: s, end: en }; rebuild(); render(); }
        }
    }
    var qTimer = null;
    function onInput(e) {
        if (e.target && e.target.id === 'ar-q') {
            state.filters.query = e.target.value;
            clearTimeout(qTimer);
            qTimer = setTimeout(function () { var pos = e.target.selectionStart; render(); var q = el('ar-q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} } }, 200);
        }
    }

    function init() {
        document.addEventListener('click', onClick);
        document.addEventListener('change', onChange);
        document.addEventListener('input', onInput);
        var tab = el(TAB_ID);
        if (tab) {
            // 탭이 보일 때마다(메뉴·직접 switchTab·뒤로가기) 관리자 확인 후 진입
            new MutationObserver(function () { if (tab.style.display !== 'none') open(); }).observe(tab, { attributes: true, attributeFilter: ['style'] });
        }
        try { if (typeof auth !== 'undefined' && auth.onAuthStateChanged) auth.onAuthStateChanged(function () { syncMenu(); }); } catch (e) { /* 인증 준비 전 */ }
        syncMenu();
    }

    window.FawwTripReview = { open: open, reload: reload, isAutomationAdmin: isAutomationAdmin, _state: state };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
