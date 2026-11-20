/**
 * FaWW 자동화 — 직원 추천 화면 (관리자 전용 · 읽기 전용, 1차)
 * 의존: trip-review-data.js(조회), staff-roster.js, schedule-parse.js, staff-recommend.js, trip-review-view.js(관리자 판정)
 *
 * - 자동화 관리 탭의 하위 화면 '직원 추천'과, 기존 캘린더 일정 상세(#tripModal, #taskModal)에 같은 추천 결과를 보여준다.
 * - 관리자 판정: 기존 ADMIN_UIDS / ADMIN_EMAILS (FawwTripReview.isAutomationAdmin 재사용).
 *   화면 노출만 막는다. 추천에 쓰는 데이터는 승인 직원이면 원래 읽을 수 있는 경로이며, 결과는 저장하지 않고 메모리에서만 계산한다.
 * - DB·Google Calendar 쓰기 없음. 배정 버튼은 다음 단계용으로 비활성.
 * - 캘린더·사용자 문자열은 textContent 로만 출력.
 */
(function () {
    'use strict';
    var state = { uid: null, loaded: null, model: null, loading: false, error: null, stale: false, view: 'review', filters: { q: '', cat: 'all', staff: 'all' } };
    var SRC_LABEL = { trip: '출장 DB', 'trip+calendar': '출장 DB + 구글 캘린더 (연동 ID로 연결)', calendar: '구글 캘린더 (수동 등록 일정)' };

    function el(id) { return document.getElementById(id); }
    function currentUser() { try { return (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser : null; } catch (e) { return null; } }
    function isAdmin(user) { return !!(window.FawwTripReview && window.FawwTripReview.isAutomationAdmin(user)); }
    window.isWorkspaceAutomationAdmin = isAdmin;
    function todayStr() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    function fmtPeriod(p) { return (typeof formatDateRange === 'function') ? formatDateRange(p.start, p.end) : (p.start === p.end ? p.start : p.start + ' ~ ' + p.end); }

    // DOM 생성 도우미: 문자열은 항상 textContent
    function h(tag, props) {
        var n = document.createElement(tag);
        props = props || {};
        if (props.className) n.className = props.className;
        if (props.text !== undefined) n.textContent = String(props.text);
        if (props.attrs) Object.keys(props.attrs).forEach(function (k) { n.setAttribute(k, props.attrs[k]); });
        for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c == null || c === false) continue; n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
        return n;
    }
    function ul(items, cls) { var u = h('ul', { className: cls || '' }); items.forEach(function (t) { u.appendChild(typeof t === 'string' ? h('li', { text: t }) : t); }); return u; }
    function badge(cat, label) { return h('span', { className: 'ar-badge rec-cat-' + cat, text: label }); }

    // ---------------------------------------------------------------- 데이터
    function reload() {
        var user = currentUser(); if (!isAdmin(user)) { render(); return Promise.resolve(); }
        var uid = user.uid; state.loading = true; state.error = null; render();
        return FawwTripReviewData.load(typeof db !== 'undefined' ? db : null).then(function (loaded) {
            if (state.uid !== uid) return;
            state.loaded = loaded; state.loading = false; state.stale = false; rebuild(); render(); refreshModalBox();
        }, function (e) { if (state.uid !== uid) return; state.loading = false; state.error = (e && e.message) || String(e); render(); });
    }
    function rebuild() {
        var L = state.loaded; if (!L) { state.model = null; return; }
        state.model = FawwStaffRecommend.build({ users: L.data.users, trips: L.data.trips, leaves: L.data.leaves, externalEvents: L.data.externalEvents, coverage: L.coverage, today: todayStr() });
        state.model.fetchedAt = L.fetchedAt;
    }
    function reset(uid) {
        state.uid = uid || null; state.loaded = null; state.model = null; state.loading = false; state.error = null; state.stale = false;
        var r = el('rec-root'); if (r) r.textContent = '';
        var box = document.querySelector('.rec-modal-box'); if (box) box.remove();
    }

    // ---------------------------------------------------------------- 하위 메뉴
    function setView(v) {
        if (v === 'recommend' && !isAdmin(currentUser())) v = 'review';
        state.view = v;
        var ar = el('ar-root'), rr = el('rec-root');
        if (ar) ar.hidden = v !== 'review'; if (rr) rr.hidden = v !== 'recommend';
        document.querySelectorAll('#auto-subnav [data-auto-view]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-auto-view') === v); });
        if (v === 'recommend') { if (!state.loaded && !state.loading) reload(); else render(); }
    }
    function syncAccess() {
        var user = currentUser(), uid = user ? user.uid : null;
        if (uid !== state.uid) reset(uid);
        var nav = el('auto-subnav'); if (nav) nav.hidden = !isAdmin(user);
        if (!isAdmin(user)) setView('review');
    }

    // ---------------------------------------------------------------- 화면 (간결안: 짧은 칩·한 줄 요약, 전체 문장은 툴팁·근거 보기에 보존)
    var SRC_SHORT = { trip: '출장 DB', 'trip+calendar': '출장 DB·캘린더 연동', calendar: '캘린더 수동 등록' };
    function shortDate(d) { var p = String(d || '').split('-'); return p.length === 3 ? (+p[1]) + '/' + (+p[2]) : String(d || ''); }
    function shortTitle(raw) { return String(raw || '').replace(/^(\s*\[[^\]]*\]\s*)+/, '').replace(/\s*\([^)]*\)\s*$/, '').trim() || String(raw || ''); }
    function plainWhy(why) { return String(why || '').replace(/\s*—\s*확정 배정 전 검토 필요$/, ''); }
    function shortWhy(why) {
        var w = plainWhy(why);
        if (/반차/.test(w)) return '반차';
        if (/승인 대기 휴가/.test(w)) return '휴가 대기';
        if (/취소 대기 휴가/.test(w)) return '휴가 취소 대기';
        if (/조율 중/.test(w)) return '조율 중 출장';
        if (/상태 표기 없는/.test(w)) return '일정 상태 확인';
        if (/회의/.test(w)) return '회의';
        if (/분류 확인/.test(w)) return '일정 확인';
        return w;
    }
    // 엔진의 route.status 를 그대로 옮긴 전체 문구 (요약 칩은 짧게, 이 문구는 툴팁·근거에)
    function routeText(r) {
        if (r.status === 'same') return '같은 지역(' + r.to + ') — 실제 이동 시간은 미확인';
        if (r.status === 'different') return r.from + ' → ' + r.to + ' (다른 지역) — 이동 경로 확인 필요';
        if (r.status === 'coarse') return '지역 범위가 넓어 확인 필요';
        return '지역 정보 부족';
    }
    function statusOf(t) {
        if (t.category === 'serious') return { key: 'conflict', text: '일정 겹침' };
        if (t.category === 'staffing') {
            if (t.problems.length) return { key: 'warn', text: '직원 확인' };
            if (!t.required.known) return { key: 'warn', text: '인원 미확인' };
            return { key: 'warn', text: '인원 부족' };
        }
        if (t.category === 'vehicle') return { key: 'muted', text: '차량 없음' };
        return { key: 'ok', text: '정상' };
    }
    function chip(text, cls, full) { var c = h('span', { className: 'rec-chip ' + cls, text: text }); if (full) c.setAttribute('title', full); return c; }
    /** 조합 요약: 짧은 근거 1줄 + 확인 칩(같은 출장은 한 번, 다른 출장은 각각) + 직원별 근거 */
    function summarize(members) {
        var trips = {}, order = [];
        members.forEach(function (m) {
            (m.adjacent || []).forEach(function (a) {
                if (!trips[a.tripId]) { trips[a.tripId] = { a: a, names: [] }; order.push(a.tripId); }
                trips[a.tripId].names.push(m.label);
            });
        });
        var locOf = function (a) { return a.route.from || shortTitle(a.title); };
        var reasons = order.map(function (id) {
            var g = trips[id], a = g.a, loc = locOf(a) + (a.route.status === 'same' ? ' · 같은 지역' : '');
            return (g.names.length === members.length && members.length > 1) ? a.dir + ' ' + loc + ' 출장 팀' : g.names.join('·') + ' ' + a.dir + ' ' + loc;
        });
        var checks = [], seen = {};
        var add = function (key, short, full) { if (!seen[key]) { seen[key] = true; checks.push({ short: short, full: full }); } };
        members.forEach(function (m) { (m.cautions || []).forEach(function (c) { add('c:' + m.key + c.why + c.date, m.label + ' ' + shortWhy(c.why), m.label + ' ' + plainWhy(c.why) + ' — ' + c.title + ' (' + c.date + ')'); }); });
        var routeIds = order.filter(function (id) { return trips[id].a.route.status !== 'same'; });
        var vehIds = order.filter(function (id) { return trips[id].a.vehicles.length; });
        order.forEach(function (id) {
            var a = trips[id].a, which = a.dir + ' ' + shortTitle(a.title), suffix = routeIds.length > 1 ? ' (' + shortTitle(a.title) + ')' : '';
            if (a.route.status === 'different') add('r:' + id, '경로 확인' + suffix, '이동 경로 확인 필요 (' + a.route.from + ' → ' + a.route.to + ', ' + which + ')');
            else if (a.route.status === 'coarse') add('r:' + id, '지역 범위 넓음' + suffix, '지역 범위가 넓어 확인 필요 (' + which + ')');
            else if (a.route.status !== 'same') add('r:' + id, '지역 정보 부족' + suffix, '지역 정보 부족 (' + which + ')');
            a.vehicles.forEach(function (v) { add('v:' + id + ':' + v, v + (vehIds.length > 1 ? ' (' + shortTitle(a.title) + ')' : ''), v + ' 연속 사용 가능 여부 확인 (' + which + ')'); });
        });
        return { reasons: reasons, checks: checks, trips: order.map(function (id) { return trips[id].a; }) };
    }
    function renderOption(rank, members, keepNames) {
        var sum = summarize(members);
        var opt = h('div', { className: 'rec-option' + (rank === 1 ? ' rec-option-top' : '') });
        var head = h('div', { className: 'rec-option-head' }, h('span', { className: 'rec-rank', text: rank }), h('span', { className: 'rec-names', text: members.map(function (x) { return x.label; }).join(' · ') }));
        var line = h('div', { className: 'rec-option-line' });
        line.appendChild(h('span', { className: 'rec-line-reason' + (sum.reasons.length ? '' : ' rec-muted'), text: sum.reasons.length ? sum.reasons[0] + (sum.reasons.length > 1 ? ' 외 ' + (sum.reasons.length - 1) : '') : '연속 근거 없음' }));
        sum.checks.slice(0, 3).forEach(function (c) { line.appendChild(chip(c.short, 'rec-line-check', c.full)); });
        if (sum.checks.length > 3) line.appendChild(chip('+' + (sum.checks.length - 3), 'rec-line-more', sum.checks.slice(3).map(function (c) { return c.full; }).join('\n')));
        head.appendChild(line);
        opt.appendChild(head);
        if (keepNames && keepNames.length) opt.appendChild(h('div', { className: 'rec-keep', text: '기존 배정 유지: ' + keepNames.join(' · ') }));
        // 근거 보기: 직원별 한 줄 + 확인 사항 전체 문장
        var det = h('details', { className: 'rec-detail' }, h('summary', { text: '근거 보기' }));
        var grid = h('div', { className: 'rec-detail-grid' });
        members.forEach(function (m) {
            var bits = (m.adjacent || []).map(function (a) { return a.dir + ' ' + (a.route.from || shortTitle(a.title)) + (a.vehicles.length ? ' · ' + a.vehicles.join('·') : ''); });
            (m.cautions || []).forEach(function (c) { bits.push(shortWhy(c.why) + ' ' + shortDate(String(c.date).split('~')[0])); });
            bits.push('앞뒤 2주 ' + m.load + '건');
            grid.appendChild(h('b', { text: m.label })); grid.appendChild(h('span', { text: bits.join(' · ') }));
        });
        sum.trips.forEach(function (a) { grid.appendChild(h('span', { className: 'rec-muted', text: '이동' })); grid.appendChild(h('span', { className: a.route.status === 'same' ? '' : 'rec-warn-text', text: shortTitle(a.title) + ': ' + routeText(a.route) })); });
        det.appendChild(grid);
        if (sum.checks.length) det.appendChild(ul(sum.checks.map(function (c) { return c.full; }), 'rec-detail-list'));
        opt.appendChild(det);
        return opt;
    }

    function render() {
        var root = el('rec-root'); if (!root) return;
        root.textContent = '';
        if (!isAdmin(currentUser())) { root.appendChild(h('div', { className: 'section ar-denied' }, h('p', { text: '관리자만 사용할 수 있는 화면입니다.' }))); return; }
        var head = h('div', { className: 'section ar-head rec-head' });
        head.appendChild(h('div', { className: 'rec-head-title' }, h('h2', { text: '직원 추천' }), chip('읽기 전용', 'rec-chip-plain')));
        var bar = h('div', { className: 'ar-filters' });
        var q = h('input', { attrs: { type: 'search', id: 'rec-q', placeholder: '출장명 검색', 'aria-label': '출장명 검색' } }); q.value = state.filters.q; bar.appendChild(q);
        var fd = h('details', { className: 'rec-filter' }); if (state.filters.cat !== 'all' || state.filters.staff !== 'all') fd.open = true;
        fd.appendChild(h('summary', { text: '필터' + ((state.filters.cat !== 'all' ? 1 : 0) + (state.filters.staff !== 'all' ? 1 : 0) ? ' ' + ((state.filters.cat !== 'all' ? 1 : 0) + (state.filters.staff !== 'all' ? 1 : 0)) : '') }));
        var cat = h('select', { attrs: { id: 'rec-cat', 'aria-label': '상태' } }, h('option', { text: '상태 전체', attrs: { value: 'all' } }));
        [['serious', '일정 겹침'], ['staffing', '인원·직원 확인'], ['vehicle', '차량 없음'], ['ok', '정상'], ['req-unknown', '인원 미확인'], ['match', '직원 확인']].forEach(function (o) { cat.appendChild(h('option', { text: o[1], attrs: { value: o[0] } })); });
        cat.value = state.filters.cat; fd.appendChild(cat);
        var staff = h('select', { attrs: { id: 'rec-staff', 'aria-label': '직원' } }, h('option', { text: '직원 전체', attrs: { value: 'all' } }));
        FawwStaffRoster.ROSTER.forEach(function (p) { staff.appendChild(h('option', { text: p.label, attrs: { value: p.key } })); });
        staff.value = state.filters.staff; fd.appendChild(staff);
        bar.appendChild(fd);
        var btn = h('button', { className: 'ar-btn', attrs: { type: 'button', id: 'rec-reload' } }, h('span', { className: 'material-symbols-rounded', text: 'refresh' }), '다시 추천');
        if (state.loading) btn.disabled = true; bar.appendChild(btn);
        head.appendChild(bar); root.appendChild(head);

        if (state.loading) { root.appendChild(h('div', { className: 'section ar-empty', text: '불러오는 중…' })); return; }
        if (state.error) { root.appendChild(h('div', { className: 'ar-banner ar-banner-failed', text: '데이터를 불러오지 못했습니다: ' + state.error })); return; }
        var m = state.model; if (!m) return;
        if (state.stale) root.appendChild(h('div', { className: 'ar-banner', text: '데이터가 갱신되었습니다. "다시 추천"을 눌러 주세요.' }));

        // 상단 한 줄: 범위 + 계정 확인 (상세는 펼쳐서, 위험 경고는 바로)
        var top = h('div', { className: 'rec-top rec-topbar' + (m.sourcesIncomplete.length ? ' ar-banner-partial' : '') });
        top.appendChild(h('strong', { text: '확정 출장 ' + m.targets.length + '건 · 조회 범위 기준' }));
        if (m.sourcesIncomplete.length) top.appendChild(h('span', { className: 'rec-top-alert', text: '조회 불완전: ' + m.sourcesIncomplete.join(', ') + ' — 전체 예정 출장을 모두 확인한 결과가 아님' }));
        var sd = h('details', { className: 'rec-top-more' }, h('summary', { text: '조회 범위 자세히' }));
        sd.appendChild(ul([
            '오늘(' + m.today + ') 이후 확정 출장 대상, 현재 조회된 데이터 기준 — 가용성을 보장하지 않음',
            '구글 캘린더 일정은 동기화 범위(' + m.calendarHorizonEnd + '까지)만 반영',
            '일정 분류(학교 시험·파견·휴가·회의 등)는 키워드 규칙 기반 — AI 분류는 다음 단계, 애매한 일정은 "일정 확인"',
            '마지막 조회: ' + (m.fetchedAt && typeof formatDateTime === 'function' ? formatDateTime(m.fetchedAt) : '-') + (m.excludedSpecial ? ' · 특수 강의 ' + m.excludedSpecial + '건 제외' : '')
        ]));
        top.appendChild(sd);
        if (m.accountIssues.length || m.unrostered.length) {
            var ad = h('details', { className: 'rec-top-more rec-account' });
            ad.appendChild(h('summary', { className: m.accountIssues.length ? 'rec-top-alert' : '', text: m.accountIssues.length ? '계정 확인 ' + m.accountIssues.length + '명 — 후보 제외' : '명부 밖 계정 ' + m.unrostered.length + '개' }));
            var rows = m.accountIssues.map(function (p) { return p.label + ': ' + (p.status === 'ambiguous' ? '승인 계정 ' + p.uids.length + '개 — 자동 식별 거부' : '승인된 계정 없음' + (p.unapprovedUids.length ? ' (미승인 계정 있음)' : '')) + ' → 추천 후보에서 제외'; });
            if (m.unrostered.length) rows.push('직원 명부 밖 승인 계정 ' + m.unrostered.length + '개 (외부인·중복 계정일 수 있음, 추천 후보 아님): ' + m.unrostered.map(function (u) { return u.displayName; }).join(', '));
            ad.appendChild(ul(rows)); top.appendChild(ad);
        }
        root.appendChild(top);

        var f = state.filters, query = f.q.trim().toLowerCase();
        var list = m.targets.filter(function (t) {
            if (query && t.raw.toLowerCase().indexOf(query) === -1) return false;
            if (f.cat === 'req-unknown' && t.required.known) return false;
            if (f.cat === 'match' && !t.problems.length) return false;
            if (['serious', 'staffing', 'vehicle', 'ok'].indexOf(f.cat) !== -1 && t.category !== f.cat) return false;
            if (f.staff !== 'all' && t.assignedKeys.indexOf(f.staff) === -1 && !t.recommendations.some(function (r) { return r.members.some(function (x) { return x.key === f.staff; }); })) return false;
            return true;
        });
        var box = h('div', { className: 'section rec-list' });
        if (list.length !== m.targets.length) box.appendChild(h('div', { className: 'rec-muted rec-count', text: '전체 ' + m.targets.length + '건 중 ' + list.length + '건' }));
        if (!list.length) box.appendChild(h('div', { className: 'ar-empty', text: '조건에 맞는 출장이 없습니다.' }));
        list.forEach(function (t) { box.appendChild(renderTarget(t, false)); });
        root.appendChild(box);
    }

    function renderTarget(t, compact) {
        var st = statusOf(t);
        var staffing = t.required.known ? t.assigned.length + '/' + t.required.n + '명' : (t.assigned.length ? t.assigned.length + '명 · 인원 미확인' : '인원 미확인');
        var d = h('details', { className: 'rec-item', attrs: { 'data-target-id': t.id } });
        if (compact) d.open = true;
        d.appendChild(h('summary', null, chip(st.text, 'rec-status rec-status-' + st.key), h('span', { className: 'rec-title', text: shortTitle(t.raw) }), h('span', { className: 'rec-meta', text: shortDate(t.period.start) + (t.period.end !== t.period.start ? '~' + shortDate(t.period.end) : '') + ' · ' + staffing })));
        var body = h('div', { className: 'rec-body' });
        body.appendChild(h('div', { className: 'rec-muted rec-meta-line', text: [t.place || '장소 기록 없음', t.vehicles.length ? t.vehicles.join('·') : '차량 없음', SRC_SHORT[t.src] || t.src].join(' · ') + (t.assigned.length ? ' · 배정 ' + t.assigned.join('·') : ' · 미배정') }));
        if (!t.required.known) body.appendChild(h('div', { className: 'rec-warn-text rec-small', text: '인원 미확인 — ' + t.required.note }));
        if (t.serious.length) body.appendChild(h('div', { className: 'rec-block rec-serious' }, ul(t.serious)));
        if (t.problems.length) body.appendChild(h('div', { className: 'rec-block rec-warn' }, ul(t.problems)));
        // 이 출장에만 해당하는 위험은 바로 보이게 (캘린더 범위 밖, 근무 불가 일정 식별 불가, 같은 일정 가능성).
        // 모든 출장에 공통인 한계(조회 불완전, 명부 계정)는 상단에 이미 있으므로 카드에서는 '참고'로
        var isGlobal = function (l) { return /^조회 불완전|^명부 중 계정/.test(l); };
        var risk = t.limits.filter(function (l) { return !isGlobal(l); }).concat(t.notes.filter(function (n) { return /같은 일정일 수/.test(n); }));
        if (risk.length) body.appendChild(h('div', { className: 'rec-warn-text rec-small' }, ul(risk)));
        var rec = h('div', { className: 'rec-options' });
        if (t.need === 0) rec.appendChild(h('p', { className: 'rec-muted', text: '필요 인원 배정 완료 — 추가 추천 없음' }));
        else if (t.need > 0) {
            if (!t.recommendations.length) rec.appendChild(h('p', { text: '조건을 충족하는 후보가 없습니다.' }));
            if (t.shortage) rec.appendChild(h('p', { className: 'rec-warn-text rec-small', text: '가능 후보가 부족 인원(' + t.need + '명)보다 적음 — 외부 인력 여부는 대표님 판단' }));
            t.recommendations.forEach(function (r, i) { rec.appendChild(renderOption(i + 1, r.members, t.assigned)); });
        } else {
            rec.appendChild(h('p', { className: 'rec-muted rec-small', text: '인원 미확인 — 조합 대신 후보 순서만 표시' }));
            t.candidates.slice(0, 5).forEach(function (x, i) { rec.appendChild(renderOption(i + 1, [x], null)); });
        }
        body.appendChild(rec);
        if (t.excluded.length) body.appendChild(h('div', { className: 'rec-muted rec-small', text: '제외: ' + t.excluded.map(function (x) { return x.label + ' (' + shortWhy(x.reasons[0].why).replace(/^근무 불가 일정\(|\)$/g, '') + ')'; }).join(', ') }));
        var other = t.notes.filter(function (n) { return !/같은 일정일 수/.test(n); }).concat(t.limits.filter(isGlobal));
        var more = h('details', { className: 'rec-more' }, h('summary', { text: '참고' + (other.length ? ' ' + other.length : '') }));
        more.appendChild(ul(other.concat(['원본 제목: ' + t.raw, '현재 조회 범위 기준 — 가용성을 보장하지 않음'])));
        body.appendChild(more);
        d.appendChild(body);
        return d;
    }

    // ---------------------------------------------------------------- 캘린더 일정 상세 연결
    var lastModal = null;
    function findTarget(kind, id) {
        if (!state.model) return null;
        return state.model.targets.find(function (t) { return kind === 'trip' ? t.tripId === id : (t.calendarId === id || t.id === 'cal:' + id); }) || null;
    }
    function refreshModalBox() { if (lastModal) showModalBox(lastModal.kind, lastModal.id, lastModal.modalId); }
    function showModalBox(kind, id, modalId) {
        var old = document.querySelector('.rec-modal-box'); if (old) old.remove();
        if (!isAdmin(currentUser())) return;
        lastModal = { kind: kind, id: id, modalId: modalId };
        var host = document.querySelector('#' + modalId + ' .modal-content'); if (!host) return;
        var box = h('div', { className: 'rec-modal-box', attrs: { role: 'region', 'aria-label': '직원 추천' } }, h('div', { className: 'rec-modal-head', text: '직원 추천 (관리자 전용 · 읽기 전용)' }));
        if (!state.model) {
            var b = h('button', { className: 'ar-btn', text: state.loading ? '계산 중…' : '직원 추천 계산', attrs: { type: 'button' } });
            b.disabled = state.loading; b.addEventListener('click', function () { reload(); });
            box.appendChild(b);
        } else {
            var t = findTarget(kind, id);
            if (!t) box.appendChild(h('p', { className: 'ar-muted', text: '추천 대상이 아닙니다 (확정 피지컬케어 출장이 아니거나 지난 일정, 또는 날짜를 해석할 수 없음).' }));
            else {
                box.appendChild(renderTarget(t, true));
                var go = h('button', { className: 'ar-btn', text: '자동화 관리에서 보기', attrs: { type: 'button' } });
                go.addEventListener('click', function () {
                    var btn = el('tab-btn-automation'); if (typeof switchTab === 'function') switchTab('tab-automation', btn);
                    document.querySelectorAll('.modal-overlay').forEach(function (m) { if (m.contains(box)) m.style.display = 'none'; });
                    setView('recommend');
                });
                box.appendChild(go);
            }
            if (state.stale) box.appendChild(h('p', { className: 'rec-warn-text', text: '데이터가 갱신되었습니다. 자동화 관리에서 "다시 추천"을 눌러 주세요.' }));
        }
        host.appendChild(box);
    }
    function wrapModals() {
        if (typeof window.openTripModal === 'function' && !window.openTripModal.__recWrapped) {
            var ot = window.openTripModal;
            window.openTripModal = function (id) { var r = ot.apply(this, arguments); try { if (id) showModalBox('trip', id, 'tripModal'); } catch (e) { /* 추천 표시는 원래 동작에 영향 주지 않음 */ } return r; };
            window.openTripModal.__recWrapped = true;
        }
        if (typeof window.openModal === 'function' && !window.openModal.__recWrapped) {
            var om = window.openModal;
            window.openModal = function (id, title, desc, due, start, type) {
                var r = om.apply(this, arguments);
                try { var old = document.querySelector('.rec-modal-box'); if (old) old.remove(); if (type === 'external' && id) showModalBox('external', id, 'taskModal'); } catch (e) { /* 무시 */ }
                return r;
            };
            window.openModal.__recWrapped = true;
        }
    }
    function watchStale() {
        if (typeof AppStore === 'undefined') return;
        ['setTrips', 'setLeaves', 'setExternalEvents', 'setUsers'].forEach(function (k) {
            var f = AppStore[k]; if (typeof f !== 'function' || f.__recWrapped) return;
            AppStore[k] = function () { var r = f.apply(this, arguments); if (state.loaded) { state.stale = true; if (state.view === 'recommend' && !state.loading) render(); } return r; };
            AppStore[k].__recWrapped = true;
        });
    }

    // ---------------------------------------------------------------- 이벤트
    function init() {
        document.addEventListener('click', function (e) {
            var v = e.target.closest && e.target.closest('#auto-subnav [data-auto-view]'); if (v) { setView(v.getAttribute('data-auto-view')); return; }
            if (e.target.closest && e.target.closest('#rec-reload')) reload();
        });
        document.addEventListener('change', function (e) {
            var id = e.target && e.target.id;
            if (id === 'rec-cat') { state.filters.cat = e.target.value; render(); } else if (id === 'rec-staff') { state.filters.staff = e.target.value; render(); }
        });
        var qt = null;
        document.addEventListener('input', function (e) {
            if (e.target && e.target.id === 'rec-q') { state.filters.q = e.target.value; clearTimeout(qt); qt = setTimeout(function () { render(); var q = el('rec-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 250); }
        });
        var tab = el('tab-automation');
        if (tab) new MutationObserver(function () {
            var visible = tab.style.display !== 'none';
            // 자동화 관리 탭이 열려 있는 동안만 오른쪽 팀 현황 패널을 숨겨 추천 영역을 넓힌다 (다른 탭에서는 그대로)
            document.body.classList.toggle('automation-active', visible);
            if (visible) { syncAccess(); setView(state.view); }
        }).observe(tab, { attributes: true, attributeFilter: ['style'] });
        try { if (typeof auth !== 'undefined' && auth.onAuthStateChanged) auth.onAuthStateChanged(function () { syncAccess(); }); } catch (e) { /* 인증 준비 전 */ }
        wrapModals(); watchStale(); syncAccess();
    }
    window.FawwRecommendView = { reload: reload, setView: setView, _state: state };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
