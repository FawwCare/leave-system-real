function toggleLeaveRange() {
    const isRange = document.getElementById('leaveIsRange').checked;
    document.getElementById('leaveEndDate').style.display = isRange ? 'block' : 'none';
    document.getElementById('leaveRangeTilde').style.display = isRange ? 'block' : 'none';
    document.getElementById('leaveType').disabled = isRange;
}

async function applyLeave() {
    if (!(await checkAuth('승인된 사용자만 신청할 수 있습니다.'))) return;
    const isRange = document.getElementById('leaveIsRange').checked;
    const start = document.getElementById('leaveStartDate').value, end = document.getElementById('leaveEndDate').value, typeVal = document.getElementById('leaveType').value;
    let dates = [], deduction = (!isRange && typeVal.startsWith('0.5')) ? 0.5 : 1;

    if (!isRange) {
        if (!start) return await customAlert('휴가 날짜를 선택해주세요.');
        dates.push(start);
    } else {
        if (!start || !end) return await customAlert('시작일과 종료일을 모두 선택해주세요.');
        let curr = new Date(start), endD = new Date(end);
        if (curr > endD) return await customAlert('시작일이 종료일보다 늦을 수 없습니다.');
        while (curr <= endD) {
            if (curr.getDay() !== 0 && curr.getDay() !== 6) dates.push(`${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}-${String(curr.getDate()).padStart(2, '0')}`);
            curr.setDate(curr.getDate() + 1);
        }
    }

    if (dates.length === 0) return await customAlert('신청할 수 있는 유효한 날짜(평일)가 없습니다.');

    const btn = document.getElementById('applyLeaveBtn');
    const originalText = btn.textContent;
    btn.disabled = true; btn.textContent = '신청 중...';

    try {
        await Promise.all(dates.map(d => {
            const ref = db.ref('leaves').push();
            const currentUserProfile = AppStore.getCurrentUser();
            return ref.set({ id: ref.key, uid: auth.currentUser.uid, userName: currentUserProfile.displayName, date: d, type: deduction, subType: isRange ? '1' : typeVal, status: 'pending', timestamp: Date.now() });
        }));

        // 신청 즉시 입력창 초기화 및 토스트 알림 (체감 속도 대폭 향상)
        document.getElementById('leaveStartDate').value = '';
        document.getElementById('leaveEndDate').value = '';
        showToast('휴가가 성공적으로 신청되었습니다.', 'info');
    } catch (error) {
        await customAlert('신청 중 오류가 발생했습니다: ' + error.message);
    } finally {
        btn.disabled = false; btn.textContent = originalText;
    }
}

function renderLeaveUI() {
    const currentUserProfile = AppStore.getCurrentUser();
    if (!auth.currentUser || !currentUserProfile) return;
    let used = 0; const myLeaves = Object.values(AppStore.getLeaves()).filter(l => l.uid === auth.currentUser.uid);
    myLeaves.forEach(l => { if (l.status === 'approved' || l.status === 'pending' || l.status === 'cancel_requested') used += l.type; });
    document.getElementById('leave-remain').textContent = (window.parseTotalLeave(currentUserProfile) - used).toFixed(1);
    document.getElementById('leave-used').textContent = used.toFixed(1);
    const listEl = document.getElementById('leave-history-list'); listEl.innerHTML = '';

    const now = Date.now();
    const todayTime = new Date().setHours(0, 0, 0, 0);
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000; // 3일을 밀리초로 변환

    myLeaves.sort((a, b) => b.timestamp - a.timestamp).forEach(l => {
        // 3일이 지난 기록은 내역에서 자동으로 숨김 처리
        if (l.status === 'approved') {
            const leaveTime = new Date(l.date).setHours(0, 0, 0, 0);
            if ((todayTime - leaveTime) >= threeDaysMs) return; // 휴가일 기준 3일 경과 시 숨김
        } else if (l.status === 'rejected' || l.status === 'canceled') {
            if ((now - l.timestamp) >= threeDaysMs) return; // 반려/취소는 신청일 기준 3일 경과 시 숨김
        }

        const li = document.createElement('li');
        let statusText = l.status === 'approved' ? '승인됨' : (l.status === 'pending' ? '승인 대기중' : (l.status === 'cancel_requested' ? '취소 대기중' : (l.status === 'rejected' ? '반려됨' : '취소됨')));
        let color = l.status === 'approved' ? '#10B981' : (l.status === 'rejected' || l.status === 'cancel_requested' ? 'var(--danger)' : '#F59E0B');
        let btnHtml = (l.status === 'pending' || l.status === 'approved') ? `<button class="cancel-btn" onclick="cancelLeave('${l.id}')">취소</button>` : '';
        li.innerHTML = `<div><div style="font-weight:600;">${l.date}</div><div style="font-size:0.8rem; color:${color}">${statusText}</div></div>${btnHtml}`;
        listEl.appendChild(li);
    });
}

async function cancelLeave(id) {
    if (await customConfirm('휴가를 취소하시겠습니까?\n\n※ 휴가 취소는 담당자에게 보고 후 등록해주세요.')) {
        const leave = AppStore.getLeaves()[id];
        if (!leave) return;

        // 1. 즉각적인 시각적 상호작용 (버튼 비활성화 및 텍스트 변경)
        const btn = document.querySelector(`button[onclick="cancelLeave('${id}')"]`);
        if (btn) {
            btn.disabled = true;
            btn.textContent = '처리중...';
        }

        // 2. 비동기 처리 및 에러 핸들링
        try {
            if (leave.status === 'pending') {
                await db.ref('leaves/' + id).remove(); // 아직 승인 전이면 즉시 삭제
                showToast('휴가 신청이 취소되었습니다.', 'info');
            } else {
                await db.ref('leaves/' + id).update({ status: 'cancel_requested' }); // 승인되었으면 취소 결재 요청
                showToast('관리자에게 휴가 취소를 요청했습니다.', 'info');
            }
        } catch (error) {
            if (btn) { btn.disabled = false; btn.textContent = '취소'; }
            await customAlert('취소 처리 중 오류가 발생했습니다: ' + error.message);
        }
    }
}
async function deleteLeaveRecord(id) { if (await customConfirm('삭제하시겠습니까?')) db.ref('leaves/' + id).remove(); }

// 휴가 상세 정보 모달
let currentLeaveDetailId = null;
function openLeaveDetailModal(leaveId) {
    const leave = AppStore.getLeaves()[leaveId];
    if (!leave) return;

    currentLeaveDetailId = leaveId;

    const modal = document.getElementById('leaveDetailModal');
    const body = document.getElementById('leaveDetailBody');
    const cancelButton = document.getElementById('leaveDetailCancelBtn');

    let statusText = leave.status === 'approved' ? '승인됨' : (leave.status === 'pending' ? '승인 대기중' : (leave.status === 'cancel_requested' ? '취소 대기중' : (leave.status === 'rejected' ? '반려됨' : '취소됨')));
    let color = leave.status === 'approved' ? '#10B981' : (leave.status === 'rejected' || leave.status === 'cancel_requested' ? 'var(--danger)' : '#F59E0B');

    body.innerHTML = `
        <div>
            <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted);">신청자</label>
            <p style="margin: 0.3rem 0 0 0; font-weight: 600;">${leave.userName}</p>
        </div>
        <div>
            <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted);">휴가일</label>
            <p style="margin: 0.3rem 0 0 0; font-weight: 600;">${leave.date}</p>
        </div>
        <div>
            <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted);">상태</label>
            <p style="margin: 0.3rem 0 0 0; font-weight: 600; color: ${color};">${statusText}</p>
        </div>
    `;

    const isAdmin = auth.currentUser && (ADMIN_UIDS.includes(auth.currentUser.uid) || (typeof ADMIN_EMAILS !== 'undefined' && auth.currentUser.email && ADMIN_EMAILS.includes(auth.currentUser.email)));
    const isAuthor = auth.currentUser && auth.currentUser.uid === leave.uid;

    if (isAdmin) {
        cancelButton.style.display = 'block';
        cancelButton.textContent = '관리자 강제 삭제';
        cancelButton.onclick = () => {
            customConfirm(`[관리자 권한] "${leave.userName}"님의 ${leave.date} 휴가를 완전히 삭제하시겠습니까?`).then(res => {
                if (res) {
                    db.ref('leaves/' + leaveId).remove();
                    showToast('휴가가 완전히 삭제되었습니다.', 'info');
                    closeLeaveDetailModal();
                    if (typeof renderAdminLeaves === 'function') renderAdminLeaves();
                    if (typeof renderLeaveUI === 'function') renderLeaveUI();
                }
            });
        };
    } else if (isAuthor && (leave.status === 'pending' || leave.status === 'approved')) {
        cancelButton.style.display = 'block';
        cancelButton.textContent = '휴가 취소';
        cancelButton.onclick = () => {
            cancelLeave(leaveId);
            closeLeaveDetailModal();
        };
    } else cancelButton.style.display = 'none';
    modal.style.display = 'flex';
}

function closeLeaveDetailModal() {
    document.getElementById('leaveDetailModal').style.display = 'none';
    currentLeaveDetailId = null;
}

function renderAdminLeaves() {
    const listEl = document.getElementById('admin-leave-list');
    if (listEl) {
        listEl.innerHTML = '';
        Object.keys(AppStore.getUsers()).forEach(uid => {
            const u = AppStore.getUsers()[uid];
            if (!u.approved) return;
            let used = 0;
            Object.values(AppStore.getLeaves()).forEach(l => {
                if (l.uid === uid && (l.status === 'approved' || l.status === 'pending' || l.status === 'cancel_requested')) used += l.type;
            });
            const total = window.parseTotalLeave(u);
            const card = document.createElement('div');
            card.style.cssText = 'background-color: var(--card-bg); border: 1px solid var(--border-color); padding: 1rem; border-radius: 8px; box-shadow: var(--shadow-sm);';
            card.innerHTML = `<div style="font-weight: bold; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;"><span>${u.displayName}</span><button onclick="adminEditTotalLeave('${uid}', ${total})" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; background-color: var(--col-bg); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer;">수정</button></div><div style="font-size: 0.85rem; color: var(--text-muted); display: flex; justify-content: space-between;"><span>총 연차:</span> <span>${total}일</span></div><div style="font-size: 0.85rem; color: var(--text-muted); display: flex; justify-content: space-between;"><span>사용함:</span> <span style="color: var(--danger);">${used.toFixed(1)}일</span></div><div style="font-size: 0.85rem; color: var(--text-muted); display: flex; justify-content: space-between; margin-top: 0.3rem; padding-top: 0.3rem; border-top: 1px dashed var(--border-color); font-weight: bold;"><span>잔여:</span> <span style="color: var(--primary);">${(total - used).toFixed(1)}일</span></div>`;
            listEl.appendChild(card);
        });
    }

    // 1. 휴가 결재 대기 목록 렌더링
    const pendingLeaves = Object.values(AppStore.getLeaves()).filter(l => l.status === 'pending' || l.status === 'cancel_requested');
    let pendingHTML = '';
    if (pendingLeaves.length === 0) {
        pendingHTML = '<li style="justify-content: center; color: var(--text-muted); font-size: 0.9rem; background-color: transparent; border: 1px dashed var(--border-color);">대기 중인 결재 건이 없습니다.</li>';
    } else {
        pendingHTML = pendingLeaves.sort((a, b) => b.timestamp - a.timestamp).map(l => {
            const typeText = l.type === 1 ? '연차(1일)' : (l.subType === '0.5am' ? '오전 반차' : '오후 반차');
            const isCancel = l.status === 'cancel_requested';
            return `<li style="background-color: var(--card-bg); box-shadow: var(--shadow-sm); border: 1px solid var(--border-color);">
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <div style="font-weight:600; display:flex; align-items:center; gap:6px;">
                        ${l.userName} <span style="font-size:0.8rem; padding:2px 6px; border-radius:4px; background-color:var(--bg-color); color:${isCancel ? 'var(--danger)' : 'var(--text-muted)'};">${isCancel ? '취소 요청' : typeText}</span>
                    </div>
                    <div style="font-size:0.85rem; color:var(--primary); font-weight:bold;">${l.date}</div>
                </div>
                <div style="display:flex; gap:6px;">
                    <button onclick="adminResolveLeave('${l.id}', 'approved', '${l.status}')" style="background-color: #10B981; padding: 0.4rem 0.8rem; font-size: 0.8rem;">승인</button>
                    <button onclick="adminResolveLeave('${l.id}', 'rejected', '${l.status}')" style="background-color: #F59E0B; padding: 0.4rem 0.8rem; font-size: 0.8rem;">반려</button>
                    <button onclick="adminDeleteLeave('${l.id}')" style="background-color: var(--danger); padding: 0.4rem 0.8rem; font-size: 0.8rem;">삭제</button>
                </div>
            </li>`;
        }).join('');
    }

    const pendingListEl = document.getElementById('admin-pending-leaves-list');
    if (pendingListEl) pendingListEl.innerHTML = pendingHTML;

    // 2. 전체 휴가 신청 및 결재 내역 관리 렌더링
    const allLeavesListEl = document.getElementById('admin-all-leaves-list');
    if (allLeavesListEl) {
        const filterStatus = document.getElementById('admin-leave-filter-status') ? document.getElementById('admin-leave-filter-status').value : 'all';
        const allLeaves = Object.values(AppStore.getLeaves());
        
        let filteredLeaves = allLeaves;
        if (filterStatus !== 'all') {
            filteredLeaves = allLeaves.filter(l => l.status === filterStatus);
        }

        if (filteredLeaves.length === 0) {
            allLeavesListEl.innerHTML = '<li style="justify-content: center; color: var(--text-muted); font-size: 0.9rem; background-color: transparent; border: 1px dashed var(--border-color);">조회된 휴가 신청 내역이 없습니다.</li>';
        } else {
            allLeavesListEl.innerHTML = filteredLeaves.sort((a, b) => b.timestamp - a.timestamp).map(l => {
                const typeText = l.type === 1 ? '연차(1일)' : (l.subType === '0.5am' ? '오전 반차' : '오후 반차');
                let statusBadge = '';
                let statusColor = '#F59E0B';
                if (l.status === 'approved') { statusBadge = '승인 완료'; statusColor = '#10B981'; }
                else if (l.status === 'pending') { statusBadge = '승인 대기중'; statusColor = '#F59E0B'; }
                else if (l.status === 'cancel_requested') { statusBadge = '취소 요청건'; statusColor = 'var(--danger)'; }
                else if (l.status === 'rejected') { statusBadge = '반려됨'; statusColor = 'var(--text-muted)'; }
                else { statusBadge = '취소됨'; statusColor = 'var(--text-muted)'; }

                return `<li style="background-color: var(--card-bg); box-shadow: var(--shadow-sm); border: 1px solid var(--border-color);">
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <div style="font-weight:600; display:flex; align-items:center; gap:6px;">
                            ${l.userName} 
                            <span style="font-size:0.75rem; padding:2px 6px; border-radius:4px; background-color:var(--bg-color); color:var(--text-main);">${typeText}</span>
                            <span style="font-size:0.75rem; padding:2px 6px; border-radius:4px; background-color:var(--bg-color); color:${statusColor}; font-weight:bold;">${statusBadge}</span>
                        </div>
                        <div style="font-size:0.85rem; color:var(--primary); font-weight:bold;">${l.date} ${l.rejectReason ? `<span style="font-size:0.75rem; color:var(--danger); font-weight:normal;">(사유: ${l.rejectReason})</span>` : ''}</div>
                    </div>
                    <div style="display:flex; gap:4px; align-items:center;">
                        ${l.status !== 'approved' ? `<button onclick="adminResolveLeave('${l.id}', 'approved', '${l.status}')" style="background-color: #10B981; padding: 0.3rem 0.6rem; font-size: 0.75rem;">승인</button>` : ''}
                        ${l.status !== 'rejected' ? `<button onclick="adminResolveLeave('${l.id}', 'rejected', '${l.status}')" style="background-color: #F59E0B; padding: 0.3rem 0.6rem; font-size: 0.75rem;">반려</button>` : ''}
                        <button onclick="adminDeleteLeave('${l.id}')" style="background-color: var(--danger); padding: 0.3rem 0.6rem; font-size: 0.75rem;">강제삭제</button>
                    </div>
                </li>`;
            }).join('');
        }
    }
}

async function adminResolveLeave(id, newStatus, currentStatus) {
    try {
        const leave = AppStore.getLeaves()[id];
        if (newStatus === 'rejected') {
            const reason = await customPrompt('반려 사유를 입력하세요:');
            if (reason === null) return;
            await db.ref('leaves/' + id).update({ status: currentStatus === 'cancel_requested' ? 'approved' : 'rejected', rejectReason: reason });
            showToast('반려 처리되었습니다.', 'info');
            if (leave) {
                sendNotification(leave.uid, {
                    title: currentStatus === 'cancel_requested' ? "🚨 휴가 취소 신청 반려" : "🚨 휴가 신청 반려",
                    message: `"${leave.date}" 휴가 신청이 반려되었습니다. (사유: ${reason})`,
                    type: 'leaves',
                    link: 'leaves',
                    targetId: id
                });
            }
        } else {
            if (currentStatus === 'cancel_requested') {
                await db.ref('leaves/' + id).remove();
                showToast('취소 요청이 승인(삭제)되었습니다.', 'info');
                if (leave) {
                    sendNotification(leave.uid, {
                        title: "🌴 휴가 취소 승인",
                        message: `"${leave.date}" 휴가 취소 신청이 승인되었습니다.`,
                        type: 'leaves',
                        link: 'leaves',
                        targetId: id
                    });
                }
            } else {
                await db.ref('leaves/' + id).update({ status: 'approved', rejectReason: null });
                showToast('휴가가 승인되었습니다.', 'info');
                if (leave) {
                    sendNotification(leave.uid, {
                        title: "🌴 휴가 신청 승인",
                        message: `"${leave.date}" 휴가 신청이 최종 승인되었습니다.`,
                        type: 'leaves',
                        link: 'leaves',
                        targetId: id
                    });
                }
            }
        }
        if (typeof renderAdminLeaves === 'function') renderAdminLeaves();
        if (typeof renderLeaveUI === 'function') renderLeaveUI();
    } catch (e) {
        await customAlert("처리 실패: " + e.message);
    }
}

async function adminDeleteLeave(id) {
    const leave = AppStore.getLeaves()[id];
    if (!leave) return;
    if (await customConfirm(`관리자 권한으로 "${leave.userName}"님의 ${leave.date} 휴가를 완전히 강제 삭제하시겠습니까?`)) {
        try {
            await db.ref('leaves/' + id).remove();
            showToast('휴가가 강제 삭제되었습니다.', 'info');
            if (typeof renderAdminLeaves === 'function') renderAdminLeaves();
            if (typeof renderLeaveUI === 'function') renderLeaveUI();
        } catch (e) {
            await customAlert("삭제 실패: " + e.message);
        }
    }
}

function openAdminAddLeaveModal() {
    const modal = document.getElementById('adminAddLeaveModal');
    const select = document.getElementById('adminAddLeaveUserSelect');
    if (!modal || !select) return;

    select.innerHTML = '';
    const users = AppStore.getUsers() || {};
    Object.keys(users).forEach(uid => {
        const u = users[uid];
        if (u.approved) {
            const opt = document.createElement('option');
            opt.value = uid;
            opt.textContent = `${u.displayName} (${u.email || ''})`;
            select.appendChild(opt);
        }
    });

    const todayStr = new Date().toISOString().slice(0, 10);
    document.getElementById('adminAddLeaveStartDate').value = todayStr;
    document.getElementById('adminAddLeaveEndDate').value = '';
    modal.style.display = 'flex';
}

function closeAdminAddLeaveModal() {
    const modal = document.getElementById('adminAddLeaveModal');
    if (modal) modal.style.display = 'none';
}

async function submitAdminAddLeave() {
    const userUid = document.getElementById('adminAddLeaveUserSelect').value;
    const typeVal = document.getElementById('adminAddLeaveTypeSelect').value;
    const start = document.getElementById('adminAddLeaveStartDate').value;
    const end = document.getElementById('adminAddLeaveEndDate').value;
    const statusVal = document.getElementById('adminAddLeaveStatusSelect').value;

    if (!userUid) return await customAlert('대상 팀원을 선택해주세요.');
    if (!start) return await customAlert('시작일을 입력해주세요.');

    const userObj = AppStore.getUsers()[userUid];
    const userName = userObj ? userObj.displayName : '팀원';

    let dates = [];
    let deduction = (typeVal === '0.5am' || typeVal === '0.5pm') ? 0.5 : 1;

    if (!end) {
        dates.push(start);
    } else {
        let curr = new Date(start), endD = new Date(end);
        if (curr > endD) return await customAlert('시작일이 종료일보다 늦을 수 없습니다.');
        while (curr <= endD) {
            if (curr.getDay() !== 0 && curr.getDay() !== 6) {
                dates.push(`${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}-${String(curr.getDate()).padStart(2, '0')}`);
            }
            curr.setDate(curr.getDate() + 1);
        }
    }

    if (dates.length === 0) return await customAlert('신청할 수 있는 유효한 날짜(평일)가 없습니다.');

    try {
        await Promise.all(dates.map(d => {
            const ref = db.ref('leaves').push();
            return ref.set({
                id: ref.key,
                uid: userUid,
                userName: userName,
                date: d,
                type: deduction,
                subType: typeVal,
                status: statusVal,
                timestamp: Date.now()
            });
        }));

        showToast(`관리자 직권으로 "${userName}" 팀원의 휴가(${dates.length}건)가 등록되었습니다.`, 'info');
        closeAdminAddLeaveModal();
        if (typeof renderAdminLeaves === 'function') renderAdminLeaves();
        if (typeof renderLeaveUI === 'function') renderLeaveUI();
    } catch (e) {
        await customAlert('등록 실패: ' + e.message);
    }
}

async function adminEditTotalLeave(uid, currentTotal) {
    const newTotal = await customPrompt('연차 개수 설정:', currentTotal);
    if (newTotal !== null && newTotal.trim() !== '') {
        const val = parseFloat(newTotal);
        if (!isNaN(val)) {
            try {
                await db.ref('users/' + uid).update({ leaveTotal: val, totalLeave: val });
                // AppStore 메모리 즉시 동기화
                const users = AppStore.getUsers() || {};
                if (users[uid]) {
                    users[uid].leaveTotal = val;
                    users[uid].totalLeave = val;
                    AppStore.setUsers(users);
                }
                const currentUser = AppStore.getCurrentUser();
                if (currentUser && (currentUser.uid === uid || currentUser.id === uid)) {
                    currentUser.leaveTotal = val;
                    currentUser.totalLeave = val;
                    AppStore.setCurrentUser(currentUser);
                }
                showToast('연차 수가 성공적으로 변경되었습니다.', 'info');
                if (typeof renderAdminLeaves === 'function') renderAdminLeaves();
                if (typeof renderLeaveUI === 'function') renderLeaveUI();
                if (typeof renderMyPage === 'function') renderMyPage();
            } catch (e) {
                await customAlert('연차 수정 실패: ' + e.message);
            }
        }
    }
}

function downloadLeaveCSV() {
    const leavesData = AppStore.getLeaves();
    if (!leavesData || Object.keys(leavesData).length === 0) {
        showToast('다운로드할 휴가 내역이 없습니다.', 'warning');
        return;
    }

    const usersData = AppStore.getUsers();
    const userStats = {};

    // 사용자별 기본 연차 세팅
    Object.keys(usersData).forEach(uid => {
        userStats[uid] = { total: window.parseTotalLeave(usersData[uid]), used: 0 };
    });

    // 사용자별 사용 연차 일괄 계산
    Object.values(leavesData).forEach(l => {
        if (l.uid && userStats[l.uid]) {
            if (l.status === 'approved' || l.status === 'pending' || l.status === 'cancel_requested') {
                userStats[l.uid].used += l.type;
            }
        }
    });

    // 한글 깨짐 방지를 위한 BOM(\uFEFF) 추가
    let csvContent = "\uFEFF결재 상태,이름,날짜,휴가 구분,차감 일수,현재 잔여 연차,비고\n";

    // 카테고리(상태)별로 먼저 그룹핑하고, 그 안에서 최신순 정렬
    const leavesArray = Object.values(leavesData).sort((a, b) => {
        const statusOrder = { 'approved': 1, 'rejected': 2, 'pending': 3, 'cancel_requested': 4, 'canceled': 5 };
        const orderA = statusOrder[a.status] || 99;
        const orderB = statusOrder[b.status] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return b.timestamp - a.timestamp;
    });

    leavesArray.forEach(l => {
        const name = l.userName || '알 수 없음';
        const date = l.date || '';
        const typeText = l.type === 1 ? '연차(1일)' : (l.subType === '0.5am' ? '오전 반차' : '오후 반차');
        const typeNum = l.type || 0;

        // 개별 팀원의 잔여 연차 매핑
        let remainDays = '-';
        if (l.uid && userStats[l.uid]) {
            remainDays = (userStats[l.uid].total - userStats[l.uid].used).toFixed(1) + '일';
        }

        let statusText = l.status === 'approved' ? '승인됨' : (l.status === 'pending' ? '대기중' : (l.status === 'cancel_requested' ? '취소 대기중' : (l.status === 'rejected' ? '반려됨' : '취소됨')));
        const note = l.rejectReason ? `반려사유: ${l.rejectReason}` : '';

        // CSV 형식에 맞게 문자열 내 쉼표, 따옴표 이스케이프 처리
        const safeName = `"${name.replace(/"/g, '""')}"`;
        const safeNote = `"${note.replace(/"/g, '""')}"`;

        csvContent += `${statusText},${safeName},${date},${typeText},${typeNum},${remainDays},${safeNote}\n`;
    });

    const todayStr = new Date().toISOString().slice(0, 10);
    const fileName = `leave_records_${todayStr}.csv`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    
    if (navigator.msSaveBlob) {
        navigator.msSaveBlob(blob, fileName);
    } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.visibility = 'hidden';
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            if (a.parentNode) a.parentNode.removeChild(a);
            URL.revokeObjectURL(url);
        }, 500);
    }

    showToast('휴가 내역 엑셀(CSV) 파일이 정상 다운로드되었습니다.', 'info');
}

let previousPendingLeaves = new Set(), isFirstLeavesLoad = true;
// 휴가 데이터 최적화: 최신 300개만 로드
window.startLeaveSubscriptions = function() {
window.AppSubscriptionManager.subscribe('leaves', db.ref('leaves').orderByKey().limitToLast(300), (s) => {
    const data = s.val() || {};
    for (let key in data) data[key].id = key;
    AppStore.setLeaves(data);
    if (auth.currentUser && (ADMIN_UIDS.includes(auth.currentUser.uid) || (typeof ADMIN_EMAILS !== 'undefined' && auth.currentUser.email && ADMIN_EMAILS.includes(auth.currentUser.email)))) {
        Object.values(data).forEach(l => { if (l.status === 'pending' && !isFirstLeavesLoad && !previousPendingLeaves.has(l.id)) showToast(`🚨 휴가 신청: ${l.userName}`, 'warning'); previousPendingLeaves.add(l.id); });
    }
    isFirstLeavesLoad = false;

    // 데이터 변경 시 화면 즉시 새로고침
    if (typeof renderLeaveUI === 'function') renderLeaveUI();
    if (typeof renderAdminLeaves === 'function') renderAdminLeaves();
});};
