/**
 * mobile-calendar.js v3
 * 
 * 전략: 원본 showDayDetail이 #day-detail-overlay를 열면,
 * 모바일에서 즉시 닫고 오버레이 안의 이미 렌더링된 콘텐츠를
 * 하단 패널로 복사합니다.
 * 
 * kanban.js 수정 0줄.
 */
(function () {
    'use strict';

    var MOBILE_BP = 768;
    function isMobile() { return window.innerWidth <= MOBILE_BP; }

    // ── 1. 하단 디테일 패널 DOM 생성 ──
    function createMobileDetailPanel() {
        if (document.getElementById('mobile-detail-panel')) return;
        var panel = document.createElement('div');
        panel.id = 'mobile-detail-panel';
        panel.innerHTML =
            '<div id="mobile-detail-header">' +
            '  <span id="mobile-detail-date">날짜를 선택하세요</span>' +
            '  <span id="mobile-detail-count"></span>' +
            '</div>' +
            '<div id="mobile-detail-list">' +
            '  <div class="mobile-detail-empty">날짜를 터치하면 일정이 표시됩니다.</div>' +
            '</div>';
        var tab = document.getElementById('tab-calendar');
        if (tab) tab.appendChild(panel);
    }

    // ── 2. 오버레이 가로채기 ──
    function installOverlayInterceptor() {
        var overlay = document.getElementById('day-detail-overlay');
        if (!overlay) {
            setTimeout(installOverlayInterceptor, 500);
            return;
        }

        // MutationObserver로 overlay의 style 변경 감지
        var intercepting = false;
        var mo = new MutationObserver(function () {
            if (intercepting) return; // 재진입 방지
            if (!isMobile()) return;

            var disp = overlay.style.display;
            if (disp && disp !== 'none') {
                intercepting = true;

                // 원본이 오버레이를 열었다! 즉시 닫기
                overlay.style.display = 'none';
                document.body.style.overflow = '';

                // 오버레이 안에 이미 렌더링된 데이터 읽기
                var dateText = document.getElementById('selected-date-text');
                var dayLabel = document.getElementById('selected-day-label');
                var sourceList = document.getElementById('day-detail-list');

                // 모바일 패널에 복사
                var mDateEl = document.getElementById('mobile-detail-date');
                var mListEl = document.getElementById('mobile-detail-list');
                var mCountEl = document.getElementById('mobile-detail-count');

                if (mDateEl && dateText) {
                    var txt = dateText.textContent || '';
                    if (dayLabel && dayLabel.textContent) {
                        txt += ' ' + dayLabel.textContent;
                    }
                    mDateEl.textContent = txt;
                }

                if (mListEl && sourceList) {
                    // day-detail-list의 자식(.day-item)들을 모바일 형식으로 변환
                    var items = sourceList.querySelectorAll('.day-item');
                    mListEl.innerHTML = '';

                    if (items.length === 0) {
                        // 일정 없음 메시지 확인
                        mListEl.innerHTML = '<div class="mobile-detail-empty">등록된 일정이 없습니다.</div>';
                        if (mCountEl) mCountEl.textContent = '';
                    } else {
                        if (mCountEl) mCountEl.textContent = '(' + items.length + ')';

                        for (var i = 0; i < items.length; i++) {
                            var srcItem = items[i];
                            var div = document.createElement('div');
                            div.className = 'mobile-detail-item';

                            // 색상바에서 색상 추출
                            var barEl = srcItem.querySelector('.day-item-bar');
                            var color = '#4F46E5';
                            if (barEl) {
                                color = barEl.style.backgroundColor || color;
                                var rgbMatch2 = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                                if (rgbMatch2) {
                                    color = 'rgb(' + rgbMatch2[1] + ', ' + rgbMatch2[2] + ', ' + rgbMatch2[3] + ')';
                                }
                            }

                            // 제목과 메타 추출
                            var titleEl = srcItem.querySelector('.day-item-title');
                            var metaEl = srcItem.querySelector('.day-item-meta');
                            var title = titleEl ? titleEl.textContent : '';
                            var meta = metaEl ? metaEl.textContent : '';

                            div.innerHTML =
                                '<div class="mobile-detail-dot" style="background:' + color + '"></div>' +
                                '<div class="mobile-detail-info">' +
                                '  <div class="mobile-detail-title">' + title + '</div>' +
                                '  <div class="mobile-detail-meta">' + meta + '</div>' +
                                '</div>';

                            // 원본 아이템의 클릭 핸들러 연결
                            (function (src) {
                                div.onclick = function () {
                                    if (src && typeof src.onclick === 'function') {
                                        src.onclick();
                                    }
                                };
                            })(srcItem);

                            mListEl.appendChild(div);
                        }
                    }

                    mListEl.scrollTop = 0;
                }

                // 선택 시각 효과 - 날짜 텍스트에서 일(day) 추출
                updateSelectedCell(dateText ? dateText.textContent : '');

                intercepting = false;
            }
        });

        mo.observe(overlay, { attributes: true, attributeFilter: ['style'] });
    }

    function updateSelectedCell(dateTextContent) {
        // "2026년 10월 15일" 에서 15 추출
        document.querySelectorAll('#calendar-grid-main .calendar-day.mobile-selected').forEach(function (el) {
            el.classList.remove('mobile-selected');
        });

        var match = dateTextContent.match(/(\d+)일/);
        if (!match) return;
        var dayNum = parseInt(match[1]);

        var allCells = document.querySelectorAll('#calendar-grid-main .calendar-day:not(.other-month)');
        for (var i = 0; i < allCells.length; i++) {
            var dateSpan = allCells[i].querySelector('.calendar-date');
            if (dateSpan && parseInt(dateSpan.textContent) === dayNum) {
                allCells[i].classList.add('mobile-selected');
                break;
            }
        }
    }

    // ── 3. 모바일 점(dot) 렌더링 ──
    var dotTimer = null;
    function scheduleDotRender() {
        if (dotTimer) clearTimeout(dotTimer);
        dotTimer = setTimeout(renderMobileDots, 200);
    }

    function renderMobileDots() {
        if (!isMobile()) return;

        document.querySelectorAll('.mobile-dot-wrap').forEach(function (el) { el.remove(); });

        var weekRows = document.querySelectorAll('#calendar-grid-main .calendar-week-row');
        weekRows.forEach(function (row) {
            var cells = row.querySelectorAll('.calendar-day');
            var bars = row.querySelectorAll('.calendar-task');

            cells.forEach(function (cell) {
                var wrap = document.createElement('div');
                wrap.className = 'mobile-dot-wrap';
                // 직접 DOM appendChild 호출 (kanban.js의 오버라이드 우회)
                HTMLElement.prototype.appendChild.call(cell, wrap);
            });

            bars.forEach(function (bar) {
                if (bar.style.display === 'none') return;
                var gc = bar.style.gridColumn || '';
                if (!gc) return;

                var parts = gc.split('/');
                var startCol = parseInt(parts[0].trim()) - 1;
                var endCol = startCol;
                if (parts.length > 1) {
                    var second = parts[1].trim();
                    if (second.indexOf('span') >= 0) {
                        endCol = startCol + parseInt(second.replace('span', '').trim()) - 1;
                    } else {
                        endCol = parseInt(second) - 2;
                    }
                }

                var bgColor = bar.style.backgroundColor || '';
                if (!bgColor) {
                    try { bgColor = window.getComputedStyle(bar).backgroundColor; } catch (e) { }
                }
                if (!bgColor) bgColor = '#4F46E5';
                
                // 모바일 점(dot)은 연한 배경색(rgba) 대신 진한 단색(rgb)으로 표시하도록 변환
                var rgbMatch = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                if (rgbMatch) {
                    bgColor = 'rgb(' + rgbMatch[1] + ', ' + rgbMatch[2] + ', ' + rgbMatch[3] + ')';
                }

                for (var c = startCol; c <= endCol && c < cells.length; c++) {
                    if (c < 0) continue;
                    var wrap = cells[c].querySelector('.mobile-dot-wrap');
                    if (wrap && wrap.children.length < 4) {
                        var dot = document.createElement('div');
                        dot.className = 'mobile-cal-dot';
                        dot.style.backgroundColor = bgColor;
                        wrap.appendChild(dot);
                    }
                }
            });
        });
    }

    function installDotObserver() {
        var grid = document.getElementById('calendar-grid-main');
        if (!grid) {
            setTimeout(installDotObserver, 500);
            return;
        }
        var mo = new MutationObserver(scheduleDotRender);
        mo.observe(grid, { childList: true, subtree: true });
        scheduleDotRender();
    }

    // ── 4. 커스텀 컴팩트 헤더 생성 ──
    function createMobileCalHeader() {
        if (document.getElementById('mobile-cal-header')) return;

        var header = document.createElement('div');
        header.id = 'mobile-cal-header';

        // 월 네비게이션
        var nav = document.createElement('div');
        nav.className = 'mcal-nav';

        var prevBtn = document.createElement('button');
        prevBtn.className = 'mcal-nav-btn';
        prevBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:1.3rem">chevron_left</span>';
        prevBtn.onclick = function () {
            if (typeof changeCalendarMonth === 'function') changeCalendarMonth(-1);
            setTimeout(syncHeaderTitle, 100);
        };

        var titleSpan = document.createElement('span');
        titleSpan.className = 'mcal-title';
        titleSpan.id = 'mcal-title-text';
        titleSpan.textContent = '';

        var nextBtn = document.createElement('button');
        nextBtn.className = 'mcal-nav-btn';
        nextBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:1.3rem">chevron_right</span>';
        nextBtn.onclick = function () {
            if (typeof changeCalendarMonth === 'function') changeCalendarMonth(1);
            setTimeout(syncHeaderTitle, 100);
        };

        var todayBtn = document.createElement('button');
        todayBtn.className = 'mcal-nav-btn';
        todayBtn.style.cssText = 'font-size:0.7rem !important; font-weight:700 !important; padding:3px 8px !important; border-radius:10px !important; background:var(--primary,#4F46E5) !important; color:#fff !important;';
        todayBtn.textContent = '오늘';
        todayBtn.onclick = function () {
            if (typeof jumpToToday === 'function') jumpToToday();
            setTimeout(syncHeaderTitle, 100);
        };

        nav.appendChild(prevBtn);
        nav.appendChild(titleSpan);
        nav.appendChild(nextBtn);
        nav.appendChild(todayBtn);

        // 필터 버튼
        var filters = document.createElement('div');
        filters.className = 'mcal-filters';
        var filterData = [
            { key: 'external', label: '연동' },
            { key: 'all', label: '전체' },
            { key: 'task', label: '업무' },
            { key: 'trip', label: '출장' },
            { key: 'leave', label: '휴가' }
        ];
        filterData.forEach(function (f) {
            var btn = document.createElement('button');
            btn.className = 'mcal-filter-btn' + (f.key === 'external' ? ' active' : '');
            btn.textContent = f.label;
            btn.dataset.filter = f.key;
            btn.onclick = function () {
                // 기존 setCalendarFilter 호출
                if (typeof setCalendarFilter === 'function') {
                    // 기존 함수는 두번째 인자로 원본 버튼을 받지만, 필터 키만으로도 동작
                    setCalendarFilter(f.key);
                }
                // 액티브 토글
                filters.querySelectorAll('.mcal-filter-btn').forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
            };
            filters.appendChild(btn);
        });

        header.appendChild(nav);
        header.appendChild(filters);

        // tab-calendar의 첫번째 자식으로 삽입
        var tab = document.getElementById('tab-calendar');
        if (tab) {
            tab.insertBefore(header, tab.firstChild);
        }

        syncHeaderTitle();
    }

    function syncHeaderTitle() {
        var titleEl = document.getElementById('mcal-title-text');
        var ySelect = document.getElementById('calendar-year-select');
        var mSelect = document.getElementById('calendar-month-select');
        if (titleEl && ySelect && mSelect) {
            titleEl.textContent = ySelect.value + '년 ' + mSelect.value + '월';
        }
    }

    // ── 5. 초기화 ──
    function init() {
        createMobileCalHeader();
        createMobileDetailPanel();
        installOverlayInterceptor();
        installDotObserver();

        // 제목 동기화를 위해 select-box 감시
        var mo = new MutationObserver(syncHeaderTitle);
        ['calendar-year-select', 'calendar-month-select'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) mo.observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
        });
        
        // 캘린더 렌더링 호출(renderTabCalendar) 시에도 동기화되도록 오버라이드
        var origRender = window.renderTabCalendar;
        if (origRender) {
            window.renderTabCalendar = function() {
                origRender.apply(this, arguments);
                syncHeaderTitle();
            };
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 800); });
    } else {
        setTimeout(init, 800);
    }
})();
