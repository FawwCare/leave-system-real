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
    // 탭 안의 '출장 배정 검토' 영역 (#ar-root). 없으면 탭 전체 (이전 구조 호환)
    function contentRoot() { return el('ar-root') || el(TAB_ID); }
    function currentUser() { try { return (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser : null; } catch (e) { return null; } }

    // 관리자 판정: Firebase Rules 와 같게 — UID 2개는 그대로, 관리자 이메일(contact@)은 이메일 인증된 경우에만 (rules: email_verified === true)
    function isAutomationAdmin(user) {
        if (!user) return false;
        return (typeof ADMIN_UIDS !== 'undefined' && ADMIN_UIDS.includes(user.uid)) ||
               (typeof ADMIN_EMAILS !== 'undefined' && !!user.email && user.emailVerified === true && ADMIN_EMAILS.includes(user.email));
    }

    function resetState(uid) {
        state.uid = uid || null; state.loaded = null; state.model = null; state.selectedId = null; state.loading = false; state.error = null;
        state.filters = { query: '', tripStatus: 'all', review: 'all' }; state.range = null;
        var root = contentRoot(); if (root) root.innerHTML = '';
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
        var root = contentRoot(); if (!root) return;
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

    // ---------------------------------------------------------------- 간결한 표시 (판정은 그대로, 전체 문구는 title 툴팁)
    var REVIEW_SHORT = { conflict: '일정 겹침', assignee_check: '담당자 확인', unassigned: '미배정', caution: '확인', incomplete: '불완전', clear: '겹침 없음' };
    var VERDICT_SHORT = { conflict: '일정 겹침', caution: '확인', incomplete: '불완전', clear: '겹침 없음' };
    // 툴팁용 전체 설명 ('겹침 없음'도 가용성 보장이 아님을 명시)
    var REVIEW_FULL = { conflict: '일정 겹침 — 배정된 직원에게 같은 기간 확정 출장·휴가·근무 불가 일정이 있음', assignee_check: '담당자 확인 — 제목의 이름이 내부 직원으로 확인되지 않거나 계정 문제가 있음',
        unassigned: '미배정 — 제목에 직원 표기가 없음', caution: '확인 — 조율 중 출장·반차·대기 휴가 등 확인할 일정이 있음', incomplete: '불완전 — 조회 범위나 직원 식별이 불완전해 판단을 보장할 수 없음',
        clear: '겹침 없음 — 현재 조회된 범위에서 겹치는 일정이 없음 (가용성 보장 아님)' };
    var VERDICT_FULL = { conflict: '일정 겹침 — 같은 기간에 확정 출장·휴가·근무 불가 일정이 있음', caution: '확인 — 조율 중 출장·반차·대기 휴가 등 확인할 일정이 있음',
        incomplete: '불완전 — 조회 범위가 불완전해 판단을 보장할 수 없음', clear: '겹침 없음 — 현재 조회된 범위에서 겹치는 일정이 없음 (가용성 보장 아님)' };
    var TONE = { conflict: 'conflict', assignee_check: 'warn', unassigned: 'warn', caution: 'warn', incomplete: 'muted', clear: 'ok' };
    function chipHtml(text, tone, full) { return '<span class="rec-chip rec-status rec-status-' + esc(tone) + '"' + (full ? ' title="' + esc(full) + '"' : '') + '>' + esc(text) + '</span>'; }
    function shortTitle(raw) { return String(raw || '').replace(/^(\s*\[[^\]]*\]\s*)+/, '').replace(/\s*\([^)]*\)\s*$/, '').trim() || String(raw || ''); }
    function shortDate(d) { return String(d || '').split('~').map(function (x) { var p = x.split('-'); return p.length === 3 ? (+p[1]) + '/' + (+p[2]) : x; }).join('~'); }
    function shortPlace(p) { return String(p || '').split(/\s+/).slice(0, 2).join(' '); }
    function shortKind(why) {
        var w = String(why || '');
        var m = /^근무 불가 일정\(([^)]*)\)/.exec(w); if (m) return m[1];
        if (/반차/.test(w)) return '반차';
        if (/승인 대기 휴가/.test(w)) return '휴가 대기';
        if (/취소 대기 휴가/.test(w)) return '휴가 취소 대기';
        if (/휴가/.test(w)) return '휴가';
        if (/조율 중/.test(w)) return '조율 중';
        if (/특수 강의/.test(w)) return '특강';
        if (/출장/.test(w) && !/상태 표기 없는/.test(w)) return '출장';
        if (/회의/.test(w)) return '회의';
        return '일정 확인';
    }
    function reasonHtml(x) {
        if (!x.why) return '<li class="ar-r-' + esc(x.level) + '">' + esc(x.message) + '</li>';   // 이전 방식(구조 정보 없음)
        return '<li class="ar-r-' + esc(x.level) + '" title="' + esc(x.message) + '"><b>' + esc(shortKind(x.why)) + '</b> ' + esc(shortTitle(x.title)) + ' · ' + esc(shortDate(x.date)) + (x.dup ? ' · 같은 일정일 수 있음' : '') + '</li>';
    }
    function noteShort(n) {
        return String(n).replace(/^메일 기록 담당자: (.*) \(고객사 담당자일 수 있어 배정으로 보지 않음\)$/, '메일 담당자 $1 (참고)')
            .replace(/^연결 ID 없이 같은 날 같은 이름의 일정이 있음.*$/, '같은 날 같은 이름의 일정 있음 — 같은 일정인지 확인');
    }
    function limitShort(l) {
        return String(l).replace(/^명부 중 계정 확인 필요 (.*)$/, '계정 확인 필요: $1').replace(/^캘린더 동기화 범위\((.*) 까지\) 밖 — 캘린더 일정 미반영$/, '캘린더 반영 범위($1) 밖').replace(/^같은 기간 근무 불가 일정 (\d+)건의 직원을 식별하지 못함$/, '직원 모를 근무 불가 일정 $1건');
    }

    function render() {
        var root = contentRoot(); if (!root) return;
        var m = state.model, r = state.range || FawwTripReviewModel.defaultRange();
        var html = '<div class="ar-wrap">';
        html += '<div class="section ar-head"><div class="rec-head-title" style="margin-bottom:10px"><h2>출장 배정 검토</h2><span class="rec-chip rec-chip-plain">읽기 전용</span></div>' +
            '<div class="ar-filters">' +
            '<input type="search" id="ar-q" placeholder="출장명·장소 검색" aria-label="출장명·장소 검색" value="' + esc(state.filters.query) + '">' +
            '<input type="date" id="ar-start" value="' + esc(r.start) + '" aria-label="조회 시작일"><span class="ar-tilde">~</span><input type="date" id="ar-end" value="' + esc(r.end) + '" aria-label="조회 종료일">' +
            '<select id="ar-trip-status" aria-label="출장 상태"><option value="all">상태 전체</option><option value="조율중">조율중</option><option value="확정">확정</option></select>' +
            '<select id="ar-review" aria-label="판정"><option value="all">판정 전체</option>' +
            Object.keys(FawwTripReviewModel.REVIEW_LABELS).map(function (k) { return '<option value="' + k + '">' + esc(REVIEW_SHORT[k] || FawwTripReviewModel.REVIEW_LABELS[k]) + '</option>'; }).join('') + '</select>' +
            '<button type="button" id="ar-refresh" class="ar-btn"' + (state.loading ? ' disabled' : '') + '><span class="material-symbols-rounded">refresh</span>새로고침</button>' +
            '</div></div>';

        if (state.loading) { html += '<div class="section ar-empty">불러오는 중…</div></div>'; root.innerHTML = html; restoreFilters(); return; }
        if (state.error) { html += '<div class="section ar-banner ar-banner-failed">불러오기 실패: ' + esc(state.error) + '</div></div>'; root.innerHTML = html; restoreFilters(); return; }
        if (!m) { html += '</div>'; root.innerHTML = html; restoreFilters(); return; }

        var s = m.summary;
        html += '<div class="ar-cards">' +
            card('출장', s.total + '건') + card('검토', s.needsReview + '건') +
            card('일정 겹침', s.conflicts + '건', s.conflicts ? 'conflict' : '') + card('담당자 확인', s.assigneeCheck + '건', s.assigneeCheck ? 'caution' : '') +
            card('조회', STATUS_TEXT[m.dataStatus] || m.dataStatus, m.dataStatus === 'complete' ? 'clear' : (m.dataStatus === 'failed' ? 'conflict' : 'caution')) +
            '</div>';
        html += '<div class="ar-meta">' + esc(fmtRange(m.range.start, m.range.end)) + ' · ' + esc(m.fetchedAt && typeof formatDateTime === 'function' ? formatDateTime(m.fetchedAt) : '-') + ' 조회 · 조회 범위 기준</div>';
        if (m.dataStatus !== 'complete') {
            var bad = Object.keys(m.sourceLabels).filter(function (k) { return !m.coverage[k] || m.coverage[k].status !== 'complete'; });
            html += '<div class="ar-banner ar-banner-' + esc(m.dataStatus) + '"><strong>' + (m.dataStatus === 'failed' ? '조회 실패' : '일부만 조회') + '</strong> — ' +
                bad.map(function (k) { var c = m.coverage[k] || {}; return '<span title="' + esc(c.message || '') + '">' + esc(m.sourceLabels[k]) + ': ' + esc(STATUS_TEXT[c.status] || '조회 실패') + '</span>'; }).join(' · ') +
                ' <span class="ar-muted">(근거 없는 직원은 "불완전"으로 표시)</span></div>';
        }

        var trips = FawwTripReviewModel.filterTrips(m.trips, state.filters);
        html += '<div class="ar-split"><div class="section ar-list"><div class="ar-list-head">출장 ' + trips.length + '건' + (trips.length !== m.trips.length ? ' / ' + m.trips.length : '') + '</div>';
        if (!trips.length) html += '<div class="ar-empty">조건에 맞는 출장이 없습니다.</div>';
        trips.forEach(function (t) {
            var who = t.assigned.entries.length ? t.assigned.entries.map(function (e) { return e.token; }).join('·') : '미배정';
            var bits = [shortDate(t.start === t.end ? t.start : t.start + '~' + t.end)];
            if (t.place) bits.push(shortPlace(t.place));
            bits.push(who);
            if (t.requiredPersonnel) bits.push(t.requiredPersonnel + '명');
            if (t.status && t.status !== '확정') bits.push(t.status);
            html += '<button type="button" class="ar-trip' + (t.id === state.selectedId ? ' selected' : '') + '" data-trip-id="' + esc(t.id) + '" title="' + esc(t.name) + '">' +
                '<div class="ar-trip-top"><span class="ar-trip-name">' + esc(shortTitle(t.name)) + '</span>' + chipHtml(REVIEW_SHORT[t.review] || t.reviewLabel, TONE[t.review] || 'muted', REVIEW_FULL[t.review] || t.reviewLabel) + '</div>' +
                '<div class="ar-trip-meta">' + esc(bits.join(' · ')) + '</div></button>';
        });
        if (m.undatedTrips.length) {
            html += '<details class="ar-undated"><summary>날짜 확인 필요 ' + m.undatedTrips.length + '건</summary><ul>' +
                m.undatedTrips.map(function (u) { return '<li title="' + esc(u.detail || u.status) + '">' + esc(u.name) + (u.assignee ? ' · ' + esc(u.assignee) : '') + '</li>'; }).join('') + '</ul></details>';
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
        if (!t) return '<div class="ar-empty">출장을 선택하면 직원별 결과가 표시됩니다.</div>';
        var res = t.result, assignedUids = t.assigned.uids;
        var meta = [shortDate(t.start === t.end ? t.start : t.start + '~' + t.end)];
        if (t.place) meta.push(shortPlace(t.place));
        if (t.status) meta.push(t.status);
        if (t.requiredPersonnel) meta.push(t.requiredPersonnel + '명');
        var html = '<div class="ar-detail-head"><h3 title="' + esc(t.name) + '">' + esc(shortTitle(t.name)) + '</h3>' + chipHtml(REVIEW_SHORT[t.review] || t.reviewLabel, TONE[t.review] || 'muted', REVIEW_FULL[t.review] || t.reviewLabel) +
            '<div class="ar-trip-meta">' + esc(meta.join(' · ')) + '</div>' +
            '<div class="ar-assignees">담당 ' + (t.assigned.entries.length ? t.assigned.entries.map(function (e) {
                if (e.status === 'matched') { var st = res.staff.find(function (x) { return x.uid === e.uid; }); return '<span class="ar-chip">' + esc(st ? st.displayName : e.token) + '</span>'; }
                var why = e.status === 'ambiguous' ? '여러 명' : e.noteText === '내부 직원으로 확인되지 않음' ? '직원 아님' : (e.noteText || (e.note === 'unapproved' ? '미승인' : '직원 아님'));
                return '<span class="ar-chip ar-chip-warn" title="' + esc(e.noteText || why) + '">' + esc(e.token) + ' (' + esc(why) + ')</span>';
            }).join(' ') : '<span class="ar-chip ar-chip-warn">미배정</span>') + '</div></div>';

        if (!res.reviewComplete) {
            var why = res.limits ? res.limits.filter(function (l) { return !/^명부 중 계정/.test(l); }).map(limitShort) : [];
            if (!res.limits) {
                if (!res.coverage.complete) why.push('조회 불완전: ' + res.coverage.incomplete.map(function (k) { return m.sourceLabels[k] || k; }).join(', '));
                if (res.reviewGaps.length) why.push('담당자 모를 같은 기간 일정 ' + res.reviewGaps.length + '건');
            }
            html += '<div class="ar-banner ar-banner-partial">불완전 — ' + esc(why.join(' · ')) + '</div>';
        }
        if (res.reviewGaps.length) html += '<details class="ar-gaps"><summary>직원 모를 일정 ' + res.reviewGaps.length + '건</summary><ul>' + res.reviewGaps.map(function (g) { return '<li>' + esc(g.name || g.id) + '</li>'; }).join('') + '</ul></details>';
        if (t.externalUnattributed.length) html += '<details class="ar-gaps"><summary>담당자 모를 캘린더 일정 ' + t.externalUnattributed.length + '건</summary><ul>' + t.externalUnattributed.map(function (u) { return '<li>' + esc(u.detail || u.id) + '</li>'; }).join('') + '</ul></details>';

        var rows = res.staff.slice().sort(function (a, b) { return (assignedUids.indexOf(b.uid) !== -1) - (assignedUids.indexOf(a.uid) !== -1); });
        html += '<div class="ar-table-wrap"><table class="ar-table"><thead><tr><th>직원</th><th>판정</th><th>사유</th></tr></thead><tbody>';
        rows.forEach(function (st) {
            var reasons = st.reasons.length ? '<ul>' + st.reasons.map(reasonHtml).join('') + '</ul>' : '<span class="ar-muted">—</span>';
            html += '<tr><td><strong>' + esc(st.displayName) + '</strong>' + (assignedUids.indexOf(st.uid) !== -1 ? ' <span class="ar-chip">배정됨</span>' : '') + '</td><td>' +
                chipHtml(VERDICT_SHORT[st.verdict] || st.label, TONE[st.verdict] || 'muted', VERDICT_FULL[st.verdict] || st.label) + '</td><td>' + reasons + '</td></tr>';
        });
        html += '</tbody></table></div>';
        var notes = (t.notes || []).map(noteShort);
        if (res.skippedDuplicates.length) notes.push(res.limits ? '캘린더 연동 출장 (캘린더 제목의 직원 표기 사용)' : '복제된 캘린더 일정 ' + res.skippedDuplicates.length + '건 제외');
        if (notes.length) html += '<div class="ar-muted ar-note">' + notes.map(esc).join('<br>') + '</div>';
        // 계정 문제는 판정을 낮추지 않지만 위험 정보라 경고 색으로 유지
        if (res.limits) res.limits.filter(function (l) { return /^명부 중 계정/.test(l); }).forEach(function (l) { html += '<div class="ar-note rec-warn-text" title="' + esc(l) + '">' + esc(limitShort(l)) + ' (판정 제외)</div>'; });
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
