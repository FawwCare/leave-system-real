function changeMyPageMonth(offset) { currentDateForMyPageCalendar.setDate(1); currentDateForMyPageCalendar.setMonth(currentDateForMyPageCalendar.getMonth() + offset); renderMyPage(); }

function renderMyPage() {
    const currentUserProfile = AppStore.getCurrentUser();
    const tasksList = document.getElementById('mypage-tasks'), tripsList = document.getElementById('mypage-trips'), leavesList = document.getElementById('mypage-leaves-list');
    const calGrid = document.getElementById('mypage-calendar-grid');
    if (!tasksList) return; tasksList.innerHTML = ''; tripsList.innerHTML = ''; if (leavesList) leavesList.innerHTML = ''; if (calGrid) calGrid.innerHTML = '';

    if (!auth.currentUser || !currentUserProfile) {
        const loginMsg = '<li style="justify-content: center; color: var(--text-muted); font-size: 0.9rem;">로그인 후 확인 가능합니다.</li>';
        tasksList.innerHTML = loginMsg; tripsList.innerHTML = loginMsg; if (leavesList) leavesList.innerHTML = loginMsg;
        if (document.getElementById('mypage-profile-card')) document.getElementById('mypage-profile-card').style.display = 'none';
        return;
    }

    if (document.getElementById('mypage-profile-card')) {
        document.getElementById('mypage-profile-card').style.display = 'flex';
        document.getElementById('mypage-avatar').src = currentUserProfile.photoURL || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%23E5E7EB'/%3E%3C/svg%3E";
        document.getElementById('mypage-name').textContent = currentUserProfile.displayName;
        document.getElementById('mypage-email').textContent = currentUserProfile.email;
        const deptMap = { 'ceo': '대표', 'executive_director': '책임실장', 'director': '실장', 'team1_leader': '1팀 (팀장)', 'team1_member': '1팀 (팀원)', 'team2_leader': '2팀 (팀장)', 'team2_member': '2팀 (팀원)', 'unassigned': '부서 미지정' };
        document.getElementById('mypage-dept').textContent = deptMap[currentUserProfile.department] || deptMap['unassigned'];
    }

    const myName = currentUserProfile.displayName.replace(/\s+/g, '').toLowerCase();
    const isMatched = (str) => str && str.split(/[,/]+/).map(s => s.replace(/\s+/g, '').toLowerCase()).some(n => n.includes(myName) || myName.includes(n));

    Object.values(AppStore.getTasks()).filter(t => isMatched(t.assignee)).forEach(t => {
        const li = document.createElement('li');
        li.style.display = 'flex'; li.style.justifyContent = 'space-between'; li.style.alignItems = 'center';

        const statusText = t.status === 'todo' ? '해야 할 일' : (t.status === 'doing' ? '진행 중' : '완료');
        const statusColor = t.status === 'todo' ? 'var(--text-muted)' : (t.status === 'doing' ? '#F59E0B' : '#10B981');

        li.innerHTML = `<div style="flex:1; cursor:pointer;" class="mypage-task-info"><div style="font-weight:600;">${escapeHTML(t.title)}</div><div style="font-size:0.8rem;">마감: ${escapeHTML(t.dueDate ? formatDateShort(t.dueDate) : '미정')}</div></div><button class="status-cycle-btn" style="background-color: ${statusColor}15; color: ${statusColor}; border: 1px solid ${statusColor}; padding: 0.3rem 0.6rem; font-size: 0.75rem; border-radius: 4px; box-shadow: none; flex-shrink: 0; margin-left: 0.5rem;" title="클릭하여 상태 변경">${statusText}</button>`;

        li.querySelector('.mypage-task-info').onclick = () => openModal(t.id, t.title, t.description, t.dueDate, t.startDate);
        li.querySelector('.status-cycle-btn').onclick = (e) => {
            e.stopPropagation();
            const nextStatus = t.status === 'todo' ? 'doing' : (t.status === 'doing' ? 'done' : 'todo');
            db.ref('tasks/' + t.id).update({ status: nextStatus });
        };
        tasksList.appendChild(li);
    });
    Object.values(AppStore.getTrips()).filter(t => isMatched(t.assignee)).forEach(t => {
        let categoryBadge = '';
        const checkStr = t.category ? t.category : t.name;
        if (checkStr) {
            if (checkStr.includes('텔러스헬스')) categoryBadge = `<span style="font-size:0.75rem; background-color:#EFF6FF; color:#2563EB; padding:2px 4px; border-radius:4px; margin-left:4px; font-weight:bold; vertical-align:middle; border:1px solid #BFDBFE;">🏥 텔러스헬스</span>`;
            else if (checkStr.includes('휴노')) categoryBadge = `<span style="font-size:0.75rem; background-color:#F0FDF4; color:#16A34A; padding:2px 4px; border-radius:4px; margin-left:4px; font-weight:bold; vertical-align:middle; border:1px solid #BBF7D0;">🌿 휴노</span>`;
            else if (t.category && t.category.toUpperCase().startsWith('VIP')) categoryBadge = `<span style="font-size:0.75rem; background-color:#FFFBEB; color:#F59E0B; padding:2px 4px; border-radius:4px; margin-left:4px; font-weight:bold; vertical-align:middle; border:1px solid #FEF3C7;">⭐ VIP</span>`;
        }

        const li = document.createElement('li'); li.innerHTML = `<div style="font-weight:600;">${escapeHTML(t.name)}${categoryBadge}</div><div style="font-size:0.8rem;">날짜: ${escapeHTML(t.date ? formatDateText(t.date) : '미정')}</div>`; li.onclick = () => openTripModal(t.id, t.name, t.date, t.assignee, t.contact, t.address, t.scheduleUrl, t.schedulePath, t.qrUrl || '', t.qrPath || '', t.roomType, t.bookedHotel); tripsList.appendChild(li);
    });

    // 마이페이지의 내 휴가 결재 섹션에는 '승인된(approved)' 휴가만 노출되도록 필터링
    const myLeaves = Object.values(AppStore.getLeaves()).filter(l => l.uid === auth.currentUser.uid && l.status === 'approved');

    if (leavesList) {
        myLeaves.sort((a, b) => b.timestamp - a.timestamp).forEach(l => {
            const li = document.createElement('li');
            let statusText = '승인됨';
            let color = '#10B981';
            let reasonHtml = l.rejectReason ? `<div style="font-size:0.75rem; color:var(--danger); margin-top:2px;">사유: ${escapeHTML(l.rejectReason)}</div>` : '';
            li.innerHTML = `<div><div style="font-weight:600; font-size:0.9rem;">${escapeHTML(formatDateShort(l.date))}</div><div style="font-size:0.75rem; color:${color}">${statusText} (${escapeHTML(l.type)}일)</div>${reasonHtml}</div>`;
            leavesList.appendChild(li);
        });
    }

    if (calGrid) {
        buildCalendarGrid('mypage-calendar-grid', 'mypage-calendar-month-year', currentDateForMyPageCalendar, true, (cell, dateString, isCurrentMonth) => {
            if (isCurrentMonth) {
                const dayLeaves = myLeaves.filter(l => l.date === dateString);
                dayLeaves.forEach(l => {
                    const el = document.createElement('div'); el.className = 'calendar-task'; el.style.padding = '2px'; el.style.fontSize = '0.7rem'; el.title = l.status;
                    if (l.status === 'approved') el.classList.add('task-leave');
                    else if (l.status === 'rejected') el.classList.add('task-high');
                    else el.classList.add('task-medium');
                    el.innerHTML = `<span class="material-symbols-rounded" style="font-size:1em; margin-right:2px;">${l.status === 'approved' ? 'check_circle' : 'pending'}</span>휴가`;
                    el.onclick = (e) => {
                        e.stopPropagation();
                        openLeaveDetailModal(l.id);
                    };
                    cell.appendChild(el);
                });

                const dateHeader = cell.querySelector('.calendar-date');
                if (dateHeader) {
                    dateHeader.classList.add('clickable-date');
                    dateHeader.title = '클릭하여 전체 일정 보기';
                    dateHeader.onclick = (e) => {
                        e.stopPropagation();
                        if (dayLeaves.length > 0) {
                            const mapItems = dayLeaves.map(l => ({ id: l.id, uid: l.uid, isLeave: true, title: `[휴가] ${l.userName}`, name: `[휴가] ${l.userName}`, assignee: l.userName, startDate: l.date, dueDate: l.date, status: l.status, priority: 'medium' }));
                            openTripGroupModal(`🗓 ${dateString} 내 휴가`, mapItems);
                        }
                        else showToast('이 날짜에는 등록된 휴가가 없습니다.', 'info');
                    };
                }
            }
        });
    }
}