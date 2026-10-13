// 모바일 아래 메뉴: 자주 쓰는 4개(업무 현황·캘린더·출장·휴가)만 바로 보이고, 나머지는 '더보기' 시트에서 고른다.
// 메뉴 HTML 순서는 바꾸지 않으므로 PC 사이드바에는 영향이 없다 (표시 여부는 style.css 의 768px 이하 규칙으로만 제어).
(function () {
    var PRIMARY = ['tab-tasks', 'tab-calendar', 'tab-trips', 'tab-leaves'];
    function tabOf(btn) { var m = /switchTab\('([^']+)'/.exec(btn.getAttribute('onclick') || ''); return m ? m[1] : null; }

    function init() {
        var menu = document.querySelector('.tab-menu.vertical-menu');
        if (!menu || menu.querySelector('.mnav-more-btn')) return;
        var buttons = Array.prototype.slice.call(menu.querySelectorAll('.tab-btn'));
        buttons.forEach(function (b) { if (PRIMARY.indexOf(tabOf(b)) === -1) b.classList.add('mnav-secondary'); });

        var more = document.createElement('button');
        more.type = 'button';
        more.className = 'tab-btn mnav-more-btn';
        more.setAttribute('aria-label', '메뉴 더보기');
        more.innerHTML = '<span class="material-symbols-rounded">more_horiz</span> 더보기';
        more.onclick = openSheet;
        menu.appendChild(more);

        var backdrop = document.createElement('div');
        backdrop.id = 'mnav-sheet-backdrop';
        backdrop.onclick = closeSheet;
        var sheet = document.createElement('div');
        sheet.id = 'mnav-sheet';
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-label', '전체 메뉴');
        sheet.innerHTML = '<div class="mnav-sheet-title">전체 메뉴</div><div class="mnav-grid"></div>';
        document.body.appendChild(backdrop);
        document.body.appendChild(sheet);

        // 현재 탭이 '더보기' 안의 메뉴면 더보기 버튼을 활성 표시
        var mo = new MutationObserver(syncActive);
        buttons.forEach(function (b) { mo.observe(b, { attributes: true, attributeFilter: ['class'] }); });
        syncActive();
    }

    function syncActive() {
        var menu = document.querySelector('.tab-menu.vertical-menu');
        var more = menu && menu.querySelector('.mnav-more-btn');
        if (!more) return;
        var activeSecondary = menu.querySelector('.tab-btn.mnav-secondary.active');
        more.classList.toggle('active', !!activeSecondary);
    }

    function openSheet() {
        var menu = document.querySelector('.tab-menu.vertical-menu');
        var grid = document.querySelector('#mnav-sheet .mnav-grid');
        grid.innerHTML = '';
        Array.prototype.slice.call(menu.querySelectorAll('.tab-btn.mnav-secondary')).forEach(function (orig) {
            if (orig.style.display === 'none') return; // 권한이 없어 숨겨진 메뉴(예: 관리자)는 제외
            var icon = orig.querySelector('.material-symbols-rounded');
            var label = orig.textContent.replace(icon ? icon.textContent : '', '').replace(/\s+/g, ' ').trim();
            var item = document.createElement('button');
            item.type = 'button';
            item.className = 'mnav-item' + (orig.classList.contains('active') ? ' active' : '');
            item.innerHTML = '<span class="material-symbols-rounded"></span><span></span>';
            item.firstChild.textContent = icon ? icon.textContent : '';
            item.lastChild.textContent = label;
            item.onclick = function () { closeSheet(); orig.click(); };
            grid.appendChild(item);
        });
        document.body.classList.add('mnav-open');
    }
    function closeSheet() { document.body.classList.remove('mnav-open'); }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
