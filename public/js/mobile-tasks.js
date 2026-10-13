// 모바일 업무 현황 화면 길이 줄이기 (768px 이하에서만 동작, PC 화면은 그대로)
//  1) 칸반(상태별 보기)을 '해야 할 일 / 진행 중 / 완료' 탭으로: 한 번에 한 칸만 표시, 탭에 개수 표시
//  2) AI 비서 브리핑은 접힌 상태로 시작 (사용자가 펼치면 기억)
(function () {
    var MQ = window.matchMedia('(max-width: 768px)');
    var COLS = [
        { id: 'col-todo', count: 'count-todo', label: '해야 할 일' },
        { id: 'col-doing', count: 'count-doing', label: '진행 중' },
        { id: 'col-done', count: 'count-done', label: '완료' }
    ];
    var current = 'col-todo';
    try { current = sessionStorage.getItem('mt-kanban-col') || 'col-todo'; } catch (e) {}

    function buildTabs() {
        var board = document.getElementById('board-status');
        if (!board || document.getElementById('mt-kanban-tabs')) return;
        var bar = document.createElement('div');
        bar.id = 'mt-kanban-tabs';
        bar.setAttribute('role', 'tablist');
        bar.setAttribute('aria-label', '업무 상태');
        COLS.forEach(function (c) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'mt-tab';
            b.dataset.col = c.id;
            b.setAttribute('role', 'tab');
            b.innerHTML = '<span class="mt-tab-label"></span> <span class="mt-tab-count">0</span>';
            b.firstChild.textContent = c.label;
            b.onclick = function () { select(c.id); };
            bar.appendChild(b);
        });
        board.parentNode.insertBefore(bar, board);
        // 개수 동기화
        COLS.forEach(function (c) {
            var el = document.getElementById(c.count);
            if (el) new MutationObserver(syncCounts).observe(el, { childList: true, characterData: true, subtree: true });
        });
        syncCounts();
        apply();
    }
    function syncCounts() {
        COLS.forEach(function (c) {
            var src = document.getElementById(c.count);
            var dst = document.querySelector('#mt-kanban-tabs .mt-tab[data-col="' + c.id + '"] .mt-tab-count');
            if (src && dst) dst.textContent = src.textContent;
        });
    }
    function select(id) {
        current = id;
        try { sessionStorage.setItem('mt-kanban-col', id); } catch (e) {}
        apply();
    }
    function apply() {
        var mobile = MQ.matches;
        COLS.forEach(function (c) {
            var col = document.getElementById(c.id);
            if (col) col.classList.toggle('mt-hidden', mobile && c.id !== current);
            var tab = document.querySelector('#mt-kanban-tabs .mt-tab[data-col="' + c.id + '"]');
            if (tab) { tab.classList.toggle('active', c.id === current); tab.setAttribute('aria-selected', c.id === current ? 'true' : 'false'); }
        });
    }

    function collapseBriefingOnMobile() {
        if (!MQ.matches) return;
        var card = document.querySelector('.briefing-card');
        if (!card) return;
        var expanded = false;
        try { expanded = localStorage.getItem('mt-briefing-expanded') === '1'; } catch (e) {}
        if (!expanded) card.classList.add('collapsed');
        var header = card.querySelector('.briefing-header');
        if (header && !header.__mtWatch) {
            header.__mtWatch = true;
            header.addEventListener('click', function () {
                setTimeout(function () {
                    try { localStorage.setItem('mt-briefing-expanded', card.classList.contains('collapsed') ? '0' : '1'); } catch (e) {}
                }, 0);
            });
        }
    }

    function init() { buildTabs(); collapseBriefingOnMobile(); }
    if (MQ.addEventListener) MQ.addEventListener('change', apply); else if (MQ.addListener) MQ.addListener(apply);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
