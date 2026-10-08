// kanban.js
// ----------------------------------------------------
// 업무 현황 (칸반, 달력, 간트)
// ----------------------------------------------------
let selectedAssignees = [];
let modalSelectedAssignees = [];
let selectedDateForCreation = '';

function getCategoryClass(task) {
    const title = task.title || task.name || '';
    const category = task.category || '';
    const categoryLabel = task.categoryLabel || '';
    const description = task.description || task.summary || '';
    const combined = (title + ' ' + category + ' ' + categoryLabel + ' ' + description).toLowerCase();
    
    if (combined.includes('쿠팡')) return 'task-coupang';
    if (combined.includes('강의') || combined.includes('교육')) return 'task-lecture';
    if (combined.includes('이지앤')) return 'task-easyen';
    if (combined.includes('휴노')) return 'task-huno';
    if (combined.includes('텔러스') || combined.includes('telus')) return 'task-telus';
    if (combined.includes('자체') || combined.includes('내부')) return 'task-self';
    return '';
}

function parseTaskDisplayInfo(task) {
    const rawTitle = task.title || task.name || '';
    const category = task.category || '';
    const categoryLabel = task.categoryLabel || '';
    const description = task.description || task.summary || '';
    const combined = (rawTitle + ' ' + category + ' ' + categoryLabel + ' ' + description).toLowerCase();

    // 1. 중복 이중 아이콘/접두사 및 뒤쪽 중복 덧붙임 정제
    let clean = rawTitle;
    clean = clean.replace(/🌐\s*🌐/g, '🌐');
    clean = clean.replace(/📦\s*📦/g, '📦');
    clean = clean.replace(/🎓\s*🎓/g, '🎓');
    clean = clean.replace(/🩺\s*🩺/g, '🩺');
    clean = clean.replace(/🔷\s*🔷/g, '🔷');
    clean = clean.replace(/🌿\s*🌿/g, '🌿');
    clean = clean.replace(/\[출장\]\s*\[출장\]/g, '[출장]');
    clean = clean.replace(/\[휴가\]\s*\[휴가\]/g, '[휴가]');
    clean = clean.replace(/^외부\s+/g, '');
    clean = clean.replace(/\s*[📦🎓🩺🔷🌿🌴⚑🌐🏠]\s*(쿠팡|강의|이지앤|휴노|텔러스|자체|외부|출장|휴가)\s*$/g, '');

    // 2. 시간 분리 ([10:00] 등)
    let timeStr = '';
    const timeMatch = clean.match(/\[(\d{2}:\d{2})\]/);
    if (timeMatch) {
        timeStr = timeMatch[1];
        clean = clean.replace(/\[\d{2}:\d{2}\]/g, '').trim();
    }

    // 3. 소속별 대표 아이콘 및 약칭 라벨 추출
    let icon = '📌';
    let shortLabel = '일정';

    if (combined.includes('쿠팡')) { icon = '📦'; shortLabel = '쿠팡'; }
    else if (combined.includes('강의') || combined.includes('교육')) { icon = '🎓'; shortLabel = '강의'; }
    else if (combined.includes('이지앤')) { icon = '🔷'; shortLabel = '이지앤'; }
    else if (combined.includes('휴노')) { icon = '🌿'; shortLabel = '휴노'; }
    else if (combined.includes('텔러스') || combined.includes('telus')) { icon = '🩺'; shortLabel = '텔러스'; }
    else if (combined.includes('카카오') || combined.includes('kakao')) { icon = '🟡'; shortLabel = '카카오'; }
    else if (combined.includes('smilegate') || combined.includes('스마일게이트')) { icon = '🎮'; shortLabel = '스마일게이트'; }
    else if (combined.includes('sk') || combined.includes('sk스토아')) { icon = '🔴'; shortLabel = 'SK스토아'; }
    else if (combined.includes('중부발전') || combined.includes('해양수산') || combined.includes('화성시')) { icon = '🏛️'; shortLabel = '공기관'; }
    else if (combined.includes('자체') || combined.includes('내부')) { icon = '🏠'; shortLabel = '자체'; }
    else if (task.isLeave) { icon = '🌴'; shortLabel = '휴가'; }
    else if (task.isTrip) { icon = '⚑'; shortLabel = '출장'; }
    else if (task.isExternal) { icon = '🌐'; shortLabel = '외부'; }
    else if (task.type === 'schedule') { icon = '📅'; shortLabel = '일정'; }

    return {
        time: timeStr,
        icon: icon,
        shortLabel: shortLabel,
        cleanTitle: clean.trim() || rawTitle
    };
}





async function addTask() {
    const input = document.getElementById('taskInput');
    const title = input.value.trim();
    const assignee = selectedAssignees.join(', ');
    const priorityInput = document.getElementById('priorityInput');
    const priority = priorityInput.value;

    if (!(await checkAuth('관리자의 승인 후 업무를 추가할 수 있습니다.'))) return;
    if (!title) return await customAlert('업무 내용을 입력해주세요!');

    const currentUser = auth.currentUser;
    const authorName = currentUser ? currentUser.displayName : '익명';
    const today = new Date();
    const startDateString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const newTaskRef = db.ref('tasks').push();
    await newTaskRef.set({ id: newTaskRef.key, title: title, status: 'todo', author: authorName, assignee: assignee, priority: priority, startDate: startDateString });

    // 담당자에게 알림 발송
    selectedAssignees.forEach(name => {
        const targetUser = Object.values(AppStore.getUsers()).find(u => u.displayName === name);
        if (targetUser) {
            sendNotification(targetUser.uid, {
                title: "새로운 업무 할당",
                message: `"${title}" 업무의 담당자로 지정되었습니다.`,
                type: 'task',
                link: 'task',
                targetId: newTaskRef.key
            });
        }
    });

    input.value = '';
    selectedAssignees = [];
    renderAssigneeTags();
    priorityInput.value = 'medium';
    document.getElementById('searchAssignee').value = '';
    document.getElementById('dateFilter').value = 'all';

    if (AppStore.getViewMode() === 'calendar') {
        document.getElementById('viewMode').value = 'status';
        toggleViewMode();
        customAlert("달력에는 마감일이 있는 업무만 표시됩니다. \n방금 추가한 업무 확인을 위해 '상태별 보기'로 전환했습니다!");
    } else {
        filterTasks();
    }
}

function initKanbanInputListeners() {
    const taskInput = document.getElementById('taskInput');
    const assigneeInput = document.getElementById('assigneeInput');

    if (taskInput) {
        taskInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); if (e.isComposing) return; addTask(); }
        });
    }
    if (assigneeInput) {
        assigneeInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); if (e.isComposing) return; addTask(); }
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initKanbanInputListeners);
} else {
    initKanbanInputListeners();
}


async function deleteTask(id) {
    if (!(await checkAuth('승인된 사용자만 삭제할 수 있습니다.'))) return;
    if (await customConfirm('이 업무를 삭제할까요?')) { db.ref('tasks/' + id).remove(); }
}

function allowDrop(ev) {
    ev.preventDefault();
    // 마우스가 위치한 가장 가까운 컬럼을 찾아 하이라이트 효과 적용
    const col = ev.target.closest('.column');
    document.querySelectorAll('.column').forEach(c => {
        if (c !== col) c.classList.remove('drag-over');
    });
    if (col && !col.classList.contains('drag-over')) col.classList.add('drag-over');
}

function drag(ev, id) {
    ev.dataTransfer.setData("text", id);
    // 애니메이션이 부드럽게 먹히도록 setTimeout 사용 (드래그 시작 즉시 투명도 적용)
    setTimeout(() => { if (ev.target && ev.target.classList) ev.target.classList.add('is-dragging'); }, 0);
}

async function drop(ev, newStatus) {
    ev.preventDefault();
    document.querySelectorAll('.column').forEach(c => c.classList.remove('drag-over'));
    const taskId = ev.dataTransfer.getData("text");
    if (taskId) {
        if (!(await checkAuth('승인된 사용자만 상태를 변경할 수 있습니다.'))) return;
        db.ref('tasks/' + taskId).update({ status: newStatus }).catch(async (error) => await customAlert("상태 변경 실패: " + error.message));
    }
}

function filterTasks() {
    const searchInput = document.getElementById('searchAssignee');
    const dateFilterInput = document.getElementById('dateFilter');
    if (!searchInput || !dateFilterInput) return;

    const searchTerm = searchInput.value.toLowerCase().trim();
    const dateFilter = dateFilterInput.value;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfWeek = new Date(today); endOfWeek.setDate(today.getDate() + (6 - today.getDay()));
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const counts = { todo: 0, doing: 0, done: 0, week: 0, month: 0, later: 0 };

    document.querySelectorAll('.task-card').forEach(card => {
        const assignee = (card.dataset.assignee || '').toLowerCase();
        const dueDateStr = card.dataset.dueDate;
        let nameMatch = assignee.includes(searchTerm);
        let dateMatch = true;

        if (dateFilter !== 'all') {
            if (!dueDateStr) dateMatch = false;
            else {
                const taskDate = new Date(dueDateStr); taskDate.setHours(0, 0, 0, 0);
                if (dateFilter === 'today') dateMatch = taskDate <= today;
                else if (dateFilter === 'week') dateMatch = taskDate <= endOfWeek;
                else if (dateFilter === 'month') dateMatch = taskDate <= endOfMonth;
            }
        }
        if (nameMatch && dateMatch) {
            card.style.display = 'flex';
            if (card.parentElement) {
                const colId = card.parentElement.id.replace('-list', '');
                if (counts[colId] !== undefined) counts[colId]++;
            }
        } else { card.style.display = 'none'; }
    });

    Object.keys(counts).forEach(col => {
        const badge = document.getElementById(`count-${col}`);
        if (badge) badge.textContent = counts[col];
    });

    document.querySelectorAll('.calendar-task').forEach(taskEl => {
        const assignee = (taskEl.dataset.assignee || '').toLowerCase();
        if (assignee.includes(searchTerm)) taskEl.style.display = 'block';
        else taskEl.style.display = 'none';
    });

    document.querySelectorAll('.gantt-row').forEach(row => {
        const tripGroups = row.querySelectorAll('.gantt-trip-group');
        if (tripGroups.length > 0) {
            let rowHasVisibleTrip = false;
            tripGroups.forEach(bar => {
                if ((bar.dataset.assignee || '').toLowerCase().includes(searchTerm)) {
                    bar.style.display = 'flex'; rowHasVisibleTrip = true;
                } else bar.style.display = 'none';
            });
            row.style.display = rowHasVisibleTrip ? 'flex' : 'none';
        } else {
            if ((row.dataset.assignee || '').toLowerCase().includes(searchTerm)) row.style.display = 'flex';
            else row.style.display = 'none';
        }
    });

    document.querySelectorAll('.trip-card').forEach(card => {
        const assignee = (card.dataset.assignee || '').toLowerCase();
        const dateStr = card.dataset.date;
        let nameMatch = assignee.includes(searchTerm);
        let dateMatch = true;

        if (dateFilter !== 'all') {
            if (!dateStr) dateMatch = false;
            else {
                const tripDate = new Date(dateStr); tripDate.setHours(0, 0, 0, 0);
                if (dateFilter === 'today') dateMatch = tripDate <= today;
                else if (dateFilter === 'week') dateMatch = tripDate <= endOfWeek;
                else if (dateFilter === 'month') dateMatch = tripDate <= endOfMonth;
            }
        }
        if (nameMatch && dateMatch) card.style.display = 'flex';
        else card.style.display = 'none';
    });
}

let currentModalTaskId = null;
let currentModalTaskStatus = 'todo';

function setModalTaskStatus(status) {
    currentModalTaskStatus = status;
    document.querySelectorAll('.status-chip').forEach(btn => {
        btn.style.borderColor = 'var(--border-color)';
        btn.style.background = 'var(--col-bg)';
        btn.style.color = 'var(--text-main)';
    });
    const activeChip = document.getElementById('status-chip-' + status);
    if (activeChip) {
        activeChip.style.borderColor = 'var(--primary)';
        activeChip.style.background = 'var(--primary)';
        activeChip.style.color = '#FFFFFF';
    }
}

function openModal(taskId, title, description, dueDate, startDate, type = 'task') {
    currentModalTaskId = taskId;
    document.getElementById('modalTitleInput').value = title;
    
    let cleanDescription = description || '';
    if (typeof cleanDescription === 'string' && cleanDescription.match(/<[^>]+>/)) {
        cleanDescription = cleanDescription
            .replace(/<br\s*[\/]?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/\n\s*\n/g, '\n')
            .trim();
    }
    document.getElementById('modalDescription').value = cleanDescription;
    document.getElementById('modalStartDate').value = startDate || '';
    document.getElementById('modalDueDate').value = dueDate || '';

    const task = AppStore.getTasks()[taskId] || (AppStore.getExternalEvents() ? AppStore.getExternalEvents()[taskId] : null);

    const locContainer = document.getElementById('modalLocationContainer');
    const locText = document.getElementById('modalLocationText');
    if (locContainer && locText) {
        if (task && task.isExternal && task.location) {
            locContainer.style.display = 'block';
            locText.textContent = task.location;
        } else {
            locContainer.style.display = 'none';
            locText.textContent = '';
        }
    }

    const resolvedType = task && task.type ? task.type : type;
    const taskTypeSelect = document.getElementById('modalTaskType');
    if (taskTypeSelect) {
        taskTypeSelect.value = resolvedType;
    }

    currentModalTaskStatus = task && task.status ? task.status : 'todo';
    setModalTaskStatus(currentModalTaskStatus);

    document.getElementById('taskAuthorDisplay').textContent = task && task.author ? `등록: ${task.author}` : '';

    // 담당자 로드
    modalSelectedAssignees = task && task.assignee ? task.assignee.split(',').map(a => a.trim()).filter(a => a) : [];
    renderModalAssigneeTags();

    // 관리자이거나 본인이 작성한 업무, 혹은 외부 연동 일정이면 삭제 버튼 표시
    const delBtn = document.getElementById('modalDeleteBtn');
    if (delBtn) {
        const isAdmin = auth.currentUser && (ADMIN_UIDS.includes(auth.currentUser.uid) || (typeof ADMIN_EMAILS !== 'undefined' && auth.currentUser.email && ADMIN_EMAILS.includes(auth.currentUser.email)));
        const isAuthor = task && task.author === (AppStore.getCurrentUser() ? AppStore.getCurrentUser().displayName : '');
        const isExternal = !!(AppStore.getExternalEvents() && AppStore.getExternalEvents()[taskId]);
        delBtn.style.display = (isAdmin || isAuthor || isExternal) ? 'inline-block' : 'none';
    }

    // [신규] 설명에서 URL을 추출하여 클릭 가능한 링크 버튼 생성
    let linksContainer = document.getElementById('modalLinksContainer');
    if (!linksContainer) {
        linksContainer = document.createElement('div');
        linksContainer.id = 'modalLinksContainer';
        linksContainer.style = 'display:none; margin-top:8px; gap:8px; flex-wrap:wrap;';
        const descEl = document.getElementById('modalDescription');
        descEl.parentNode.insertBefore(linksContainer, descEl.nextSibling);
    }
    
    linksContainer.innerHTML = '';
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = cleanDescription.match(urlRegex) || [];
    if (urls.length > 0) {
        linksContainer.style.display = 'flex';
        urls.forEach((url, idx) => {
            const btn = document.createElement('a');
            btn.href = url;
            btn.target = '_blank';
            btn.rel = 'noopener noreferrer';
            btn.className = 'primary-btn';
            btn.style = 'padding: 4px 8px; font-size: 0.8rem; text-decoration: none; border-radius: 4px;';
            btn.innerHTML = `🔗 링크 ${idx + 1}`;
            linksContainer.appendChild(btn);
        });
    } else {
        linksContainer.style.display = 'none';
    }

    document.getElementById('taskModal').style.display = 'flex';
}

function closeModal() { document.getElementById('taskModal').style.display = 'none'; currentModalTaskId = null; }

async function saveDescription() {
    if (!(await checkAuth('승인된 사용자만 저장할 수 있습니다.'))) return;
    if (!currentModalTaskId) return;

    const newTitle = document.getElementById('modalTitleInput').value.trim();
    if (!newTitle) return await customAlert('업무 제목을 입력해주세요.');

    const taskTypeSelect = document.getElementById('modalTaskType');
    const typeValue = taskTypeSelect ? taskTypeSelect.value : 'task';

    const isExternal = !!(AppStore.getExternalEvents() && AppStore.getExternalEvents()[currentModalTaskId]);
    const isNewTask = !isExternal && (!AppStore.getTasks() || !AppStore.getTasks()[currentModalTaskId]);
    const existingExternal = isExternal && AppStore.getExternalEvents() ? AppStore.getExternalEvents()[currentModalTaskId] : null;
    const updateData = {
        title: newTitle,
        description: document.getElementById('modalDescription').value.trim(),
        startDate: document.getElementById('modalStartDate').value,
        dueDate: document.getElementById('modalDueDate').value,
        assignee: modalSelectedAssignees.join(', '),
        status: currentModalTaskStatus,
        type: typeValue
    };
    if (isExternal && existingExternal && existingExternal.location) {
        updateData.location = existingExternal.location;
    }

    if (isNewTask) {
        const currentUser = auth.currentUser;
        updateData.id = currentModalTaskId;
        updateData.author = currentUser ? currentUser.displayName : '익명';
        updateData.priority = 'medium'; // 기본값: 보통
    }

    const refPath = isExternal ? 'external_events/' : 'tasks/';

    db.ref(refPath + currentModalTaskId).update(updateData).then(async () => {
        if (isExternal) {
            // Google Calendar 연동 정보가 있고 외부 일정인 경우 구글에도 업데이트 반영 시도
            if (typeof syncExternalEventToGoogleCalendar === 'function') {
                await syncExternalEventToGoogleCalendar({
                    id: currentModalTaskId,
                    title: newTitle,
                    description: updateData.description,
                    startDate: updateData.startDate,
                    dueDate: updateData.dueDate,
                    location: updateData.location || ''
                });
            }
        } else {
            // 담당자 지정 알림 발송
            modalSelectedAssignees.forEach(name => {
                const targetUser = Object.values(AppStore.getUsers()).find(u => u.displayName === name);
                if (targetUser) {
                    sendNotification(targetUser.uid, {
                        title: isNewTask ? "새로운 업무 할당" : "업무 담당자 지정/변경",
                        message: isNewTask ? `"${newTitle}" 업무의 담당자로 지정되었습니다.` : `"${newTitle}" 업무의 담당자 정보를 확인하세요.`,
                        type: 'task',
                        link: 'task',
                        targetId: currentModalTaskId
                    });
                }
            });
        }
        closeModal();
    }).catch(async error => await customAlert("저장 실패: " + error.message));
}

document.getElementById('taskModal').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        if (e.isComposing) return;
        saveDescription();
    }
});

async function deleteCurrentTask() {
    if (!currentModalTaskId) return;
    const isExternal = !!(AppStore.getExternalEvents() && AppStore.getExternalEvents()[currentModalTaskId]);
    if (await customConfirm(isExternal ? '이 연동 일정을 완전히 삭제하시겠습니까?' : '이 업무를 완전히 삭제하시겠습니까?')) {
        const refPath = isExternal ? 'external_events/' : 'tasks/';
        db.ref(refPath + currentModalTaskId).remove().then(async () => {
            if (isExternal && typeof deleteGoogleCalendarEvent === 'function') {
                await deleteGoogleCalendarEvent(currentModalTaskId);
            }
            closeModal();
        }).catch(async error => await customAlert("삭제 실패: " + error.message));
    }
}

function openCommonCalendarModal() { document.getElementById('commonCalendarModal').style.display = 'flex'; renderModalCalendar(); }
function closeCommonCalendarModal() { document.getElementById('commonCalendarModal').style.display = 'none'; }
function changeModalMonth(offset) { currentDateForModalCalendar.setDate(1); currentDateForModalCalendar.setMonth(currentDateForModalCalendar.getMonth() + offset); renderModalCalendar(); }

/**
 * [신규] 대한민국 법정 공휴일 및 대체공휴일 검증 유틸리티
 */
function isKoreanHoliday(dateString) {
    if (!dateString) return false;
    const parts = dateString.split('-');
    if (parts.length !== 3) return false;
    const monthDay = `${parts[1]}-${parts[2]}`;

    // 1. 매년 고정 공휴일 (양력)
    const fixedHolidays = [
        '01-01', // 신정
        '03-01', // 삼일절
        '05-05', // 어린이날
        '06-06', // 현충일
        '08-15', // 광복절
        '10-03', // 개천절
        '10-09', // 한글날
        '12-25'  // 성탄절
    ];
    if (fixedHolidays.includes(monthDay)) return true;

    // 2. 주요 음력 명절 및 대체 공휴일 (2025 ~ 2027 매핑)
    const dynamicHolidays = [
        // 2025년
        '2025-01-28', '2025-01-29', '2025-01-30',
        '2025-03-03', '2025-05-06',
        '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-08',
        
        // 2026년
        '2026-02-16', '2026-02-17', '2026-02-18', // 설날 연휴
        '2026-03-02', // 삼일절 대체공휴일
        '2026-05-24', '2026-05-25', // 석가탄신일 및 대체공휴일
        '2026-08-17', // 광복절 대체공휴일
        '2026-09-24', '2026-09-25', '2026-09-26', // 추석 연휴
        '2026-10-05', // 개천절 대체공휴일

        // 2027년
        '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09',
        '2027-05-13',
        '2027-09-14', '2027-09-15', '2027-09-16'
    ];

    return dynamicHolidays.includes(dateString);
}

// [공통 유틸리티] 100% 안심 이중 연동 중복 소탕 및 동명 일정 매칭 방지 유틸리티
const cleanStrForDup = str => (str || '').replace(/\[.*?\]/g, '').toLowerCase().replace(/[^a-z0-9가-힣()]/g, '');

const isSameEvent = (itemA, itemB) => {
    const dateA = itemA.startDate || itemA.dueDate || itemA.date || '';
    const dateB = itemB.startDate || itemB.dueDate || itemB.date || '';
    if (dateA && dateB && dateA !== dateB) return false;

    const descA = itemA.description || itemA.summary || '';
    const descB = itemB.description || itemB.summary || '';

    // 1. [FaWW 출장연동 ID] 연동 표식 포함 대조
    const idA = itemA.id || ''; const idB = itemB.id || '';
    if (idA && descB.includes(idA)) return true;
    if (idB && descA.includes(idB)) return true;

    // [신규] FaWW가 생성한 구글 캘린더 일정인데 ID가 일치하지 않는다면, 이름이 비슷해도 완벽히 다른 일정이므로 즉시 병합 차단!
    if ((descA.includes('[FaWW 출장연동 ID:') && idB && !descA.includes(idB)) ||
        (descB.includes('[FaWW 출장연동 ID:') && idA && !descB.includes(idA))) {
        return false;
    }

    // 2. 제목 완전/부분 대조
    const titleA = cleanStrForDup(itemA.title || itemA.name);
    const titleB = cleanStrForDup(itemB.title || itemB.name);
    if (titleA && titleB && (titleA.includes(titleB) || titleB.includes(titleA))) return true;

    // 3. 세부 주소 / 장소 / 제목 텍스트 정밀 대조 (본문 무분별 매칭 원천 차단)
    const rawA = cleanStrForDup((itemA.address || '') + ' ' + (itemA.location || '') + ' ' + (itemA.title || '') + ' ' + (itemA.name || ''));
    const rawB = cleanStrForDup((itemB.address || '') + ' ' + (itemB.location || '') + ' ' + (itemB.title || '') + ' ' + (itemB.name || ''));

    // 공통 상호/브랜드, 광역 지명 및 시스템 자동 문구 범용 단어 키워드 예외 등록
    const ignoredKeywords = ['텔러스', '텔러스헬스', '휴노', '이지앤', '중부발전', '스마일게이트', '쿠팡', '카카오', '피지컬', '케어', '출장', '연동', '상담실', '프로그램', '사업소', '본부', '지사', '지점', '센터', '시스템', '등록건', '등록', 'faww', 'workspace', '안내', '상세', '내용', '확인', '일정', '업무', '관리', '서울', '경기', '인천', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주', '부산', '대구', '광주', '대전', '울산', '세종'];

    // 주소나 장소가 일치하는지 확인
    const keywordsA = rawA.match(/[가-힣0-9]{4,}/g) || [];
    let locationMatches = false;
    for (let kw of keywordsA) {
        if (kw.length >= 4 && !ignoredKeywords.some(ig => kw.includes(ig)) && rawB.includes(kw)) {
            locationMatches = true;
            break;
        }
    }

    // 주소/장소가 매칭된 경우, 제목의 공통 단어가 있는지 추가 검증하여 엉뚱한 일정끼리 매칭되는 것 방지
    if (locationMatches) {
        const getTitleKeywords = (str) => {
            let cleaned = (str || '').replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '');
            cleaned = cleaned.toLowerCase().replace(/[^a-z0-9가-힣\s]/g, ' ');
            return cleaned.split(/\s+/).filter(w => w.length >= 2);
        };

        const keywordsTitleA = getTitleKeywords(itemA.title || itemA.name);
        const keywordsTitleB = getTitleKeywords(itemB.title || itemB.name);

        const hasCommonTitleKeyword = keywordsTitleA.some(w => {
            if (ignoredKeywords.includes(w)) return false;
            return keywordsTitleB.includes(w);
        });

        if (hasCommonTitleKeyword) {
            return true;
        }
    }

    return false;
};

function buildCalendarGrid(gridId, titleId, dateObj, isMyPage, renderCallback) {
    const grid = document.getElementById(gridId); if (!grid) return; grid.innerHTML = '';

    // 마이페이지인 경우 미니 스타일 클래스 추가
    if (isMyPage) {
        grid.classList.add('mypage-calendar-grid');
        grid.classList.remove('weekly-layout-grid');
    } else {
        grid.classList.remove('mypage-calendar-grid');
        grid.classList.add('weekly-layout-grid');
    }

    const year = dateObj.getFullYear(), month = dateObj.getMonth();

    // [안전 장치] 제목 엘리먼트가 있을 때만 텍스트 설정
    const titleEl = document.getElementById(titleId);
    if (titleEl) titleEl.textContent = `${year}년 ${month + 1}월`;

    const firstDay = new Date(year, month, 1).getDay(), daysInMonth = new Date(year, month + 1, 0).getDate();
    
    // 42일 정보 계산
    let currentDay = 1, nextMonthDay = 1, today = new Date();
    const cellsData = [];
    for (let i = 0; i < 42; i++) {
        let cellDate;
        let isCurrentMonth = true;
        if (i < firstDay) {
            const d = new Date(year, month, 0).getDate() - firstDay + i + 1;
            cellDate = new Date(year, month - 1, d);
            isCurrentMonth = false;
        }
        else if (currentDay <= daysInMonth) {
            cellDate = new Date(year, month, currentDay);
            currentDay++;
        }
        else {
            cellDate = new Date(year, month + 1, nextMonthDay);
            nextMonthDay++;
            isCurrentMonth = false;
        }
        const dateString = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}`;
        cellsData.push({ cellDate, dateString, isCurrentMonth });
    }

    if (isMyPage) {
        // 마이페이지 미니 달력
        ['일', '월', '화', '수', '목', '금', '토'].forEach((day, index) => {
            const h = document.createElement('div'); h.className = `calendar-day-header ${index === 0 ? 'sun' : index === 6 ? 'sat' : ''}`;
            h.style.padding = '0.4rem'; h.style.fontSize = '0.8rem';
            h.textContent = day; grid.appendChild(h);
        });

        cellsData.forEach(({ cellDate, dateString, isCurrentMonth }) => {
            const cell = document.createElement('div');
            cell.className = 'calendar-day mypage-calendar-day' + (!isCurrentMonth ? ' other-month' : '');
            const isToday = isCurrentMonth && year === today.getFullYear() && month === today.getMonth() && cellDate.getDate() === today.getDate();
            if (isToday) {
                cell.classList.add('today');
            }
            
            const dayOfWeek = cellDate.getDay();
            const isHoliday = isKoreanHoliday(dateString);
            let dateColorStyle = '';
            if (!isToday) {
                if (dayOfWeek === 0 || isHoliday) {
                    dateColorStyle = 'color: #EF4444 !important; font-weight: 800;'; // 일요일 및 공휴일 빨간색
                } else if (dayOfWeek === 6) {
                    dateColorStyle = 'color: #3B82F6 !important; font-weight: 800;'; // 토요일 파란색
                }
            }

            cell.innerHTML = `<div class="calendar-date" style="font-size:0.75rem; ${dateColorStyle}">${cellDate.getDate()}</div>`;
            cell.onclick = (e) => {
                if (e.target.classList.contains('calendar-task')) return;
                showDayDetail(dateString);
            };
            renderCallback(cell, dateString, isCurrentMonth);
            grid.appendChild(cell);
        });
    } else {
        // 주차별 행 기반 오버랩 렌더링
        
        // 1. 요일 헤더 행 추가
        const headerRow = document.createElement('div');
        headerRow.className = 'calendar-header-row';
        ['일', '월', '화', '수', '목', '금', '토'].forEach((day, index) => {
            const h = document.createElement('div'); h.className = `calendar-day-header ${index === 0 ? 'sun' : index === 6 ? 'sat' : ''}`;
            h.textContent = day; headerRow.appendChild(h);
        });
        grid.appendChild(headerRow);

        const formatDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        // 2. 6주 루프
        for (let w = 0; w < 6; w++) {
            const weekRow = document.createElement('div');
            weekRow.className = 'calendar-week-row';

            const weekDates = [];
            const weekCells = [];
            const weekTasksMap = {};

            // 해당 주간의 7개 일자 배치 및 콜백 실행
            for (let d = 0; d < 7; d++) {
                const cellInfo = cellsData[w * 7 + d];
                const cellDate = cellInfo.cellDate;
                const dateString = cellInfo.dateString;
                const isCurrentMonth = cellInfo.isCurrentMonth;

                weekDates.push(cellDate);

                const cell = document.createElement('div');
                cell.className = 'calendar-day' + (!isCurrentMonth ? ' other-month' : '');
                const isToday = isCurrentMonth && year === today.getFullYear() && month === today.getMonth() && cellDate.getDate() === today.getDate();
                if (isToday) {
                    cell.classList.add('today');
                }
                cell.style.gridColumn = `${d + 1}`;
                cell.style.gridRow = `1 / span 4`;

                const dayOfWeek = cellDate.getDay();
                const isHoliday = isKoreanHoliday(dateString);
                let dateColorStyle = '';
                if (!isToday) {
                    if (dayOfWeek === 0 || isHoliday) {
                        dateColorStyle = 'color: #EF4444 !important; font-weight: 800;'; // 일요일 및 공휴일 빨간색
                    } else if (dayOfWeek === 6) {
                        dateColorStyle = 'color: #3B82F6 !important; font-weight: 800;'; // 토요일 파란색
                    }
                }

                cell.innerHTML = `<div class="calendar-date" style="${dateColorStyle}">${cellDate.getDate()}</div>`;
                cell.onclick = (e) => {
                    if (e.target.classList.contains('calendar-task')) return;
                    showDayDetail(dateString);
                };

                weekRow.appendChild(cell);
                weekCells.push(cell);

                // renderCallback 호출을 위한 appendChild 가로채기
                const dayTasks = [];
                cell.appendChild = (el) => {
                    if (el && el.classList && el.classList.contains('calendar-task')) {
                        dayTasks.push(el);
                    } else {
                        HTMLElement.prototype.appendChild.call(cell, el);
                    }
                };

                renderCallback(cell, dateString, isCurrentMonth);

                // 수집된 일정을 주간 맵에 누적
                dayTasks.forEach(el => {
                    const taskId = el.dataset.taskId || '';
                    const titleVal = el.title || el.textContent || '';
                    const classVal = el.className || '';
                    // taskId가 있으면 taskId를 유니크 키로 사용하고 없으면 제목과 클래스명 사용
                    const key = taskId ? taskId : (titleVal.trim() + '|' + classVal);

                    if (!weekTasksMap[key]) {
                        weekTasksMap[key] = {
                            el: el,
                            startCol: d,
                            endCol: d
                        };
                    } else {
                        if (weekTasksMap[key].endCol === d) {
                            // [치명적 버그 수정] 같은 날짜(열)에 동일한 key가 또 등장했다면,
                            // 다중일정 병합이 아니라 단순히 우연히 겹친 완전히 별개의 일정입니다!
                            // 이 경우 덮어쓰지 않고 새로운 독립된 key를 부여해 삭제를 방지합니다.
                            const newKey = key + '_' + Math.random();
                            weekTasksMap[newKey] = {
                                el: el,
                                startCol: d,
                                endCol: d
                            };
                        } else {
                            weekTasksMap[key].endCol = d;
                        }
                    }
                });
            }

            // 슬롯 정렬 및 오버플로우 고정 알고리즘 (최대 4행 유니폼 고정, 겹침 0% 차단)
            const slots = [];
            const sortedKeys = Object.keys(weekTasksMap).sort((a, b) => {
                const lenA = weekTasksMap[a].endCol - weekTasksMap[a].startCol;
                const lenB = weekTasksMap[b].endCol - weekTasksMap[b].startCol;
                return lenB - lenA; // 장기 일정 우선 배치
            });

            // 각 요일별 총 일정 수 사전 카운트
            const colTaskCounts = [0, 0, 0, 0, 0, 0, 0];
            sortedKeys.forEach(key => {
                const info = weekTasksMap[key];
                for (let c = info.startCol; c <= info.endCol; c++) {
                    colTaskCounts[c]++;
                }
            });

            const maxTaskInThisWeek = Math.max(0, ...colTaskCounts);
            const weekOverflowCounts = [0, 0, 0, 0, 0, 0, 0];
            let actualMaxRow = 2;

            sortedKeys.forEach(key => {
                const info = weekTasksMap[key];
                const start = info.startCol;
                const end = info.endCol;

                let r = 2; // 행 번호 (1번은 날짜 헤더)
                while (true) {
                    if (!slots[r]) slots[r] = new Array(7).fill(false);
                    let conflict = false;
                    for (let c = start; c <= end; c++) {
                        if (slots[r][c]) { conflict = true; break; }
                    }
                    if (!conflict) break;
                    r++;
                }

                if (r > actualMaxRow) actualMaxRow = r;

                // 해당 요일에 일정이 4개 이상 몰린 경우, 4번 슬롯(r=4)은 더보기 뱃지 전용으로 비워두고 숨김
                let hasColOverflow = false;
                if (typeof isCalendarExpanded !== 'undefined' && !isCalendarExpanded) {
                    for (let c = start; c <= end; c++) {
                        if (colTaskCounts[c] >= 4) {
                            hasColOverflow = true;
                            break;
                        }
                    }
                }

                if ((typeof isCalendarExpanded !== 'undefined' && !isCalendarExpanded) && (r > 4 || (hasColOverflow && r >= 4))) {
                    for (let c = start; c <= end; c++) {
                        weekOverflowCounts[c]++;
                    }
                    info.el.style.display = 'none';
                    return;
                }

                // 슬롯 차지 표시
                for (let c = start; c <= end; c++) {
                    slots[r][c] = true;
                }

                const el = info.el;
                el.style.gridColumn = `${start + 1} / ${end + 2}`;
                el.style.gridRow = `${r}`;
                el.style.zIndex = '2';
                el.style.alignSelf = 'center';
                el.style.margin = '2px 0';

                // 주간 범위 초과하는 연장 상태에 따른 바 마진 보정
                const startDateStr = el.dataset.startDate;
                const dueDateStr = el.dataset.dueDate;
                if (startDateStr && dueDateStr) {
                    const firstOfWeekStr = formatDate(weekDates[0]);
                    const lastOfWeekStr = formatDate(weekDates[6]);

                    if (startDateStr < firstOfWeekStr && start === 0) {
                        el.classList.add('task-span-prev');
                    }
                    if (dueDateStr > lastOfWeekStr && end === 6) {
                        el.classList.add('task-span-next');
                    }
                }

                if (end > start || el.classList.contains('task-span-prev') || el.classList.contains('task-span-next')) {
                    el.classList.add('task-span-multi');
                }

                weekRow.appendChild(el);
            });

            // 펼치기 모드가 아닐 때(요약 모드)만 초과 일정이 있으면 "+N개 더보기" 뱃지 추가
            for (let c = 0; c < 7; c++) {
                if (!isCalendarExpanded && weekOverflowCounts[c] > 0) {
                    const count = weekOverflowCounts[c];
                    const moreBadge = document.createElement('div');
                    moreBadge.className = 'calendar-task task-more-badge';
                    moreBadge.style.gridColumn = `${c + 1}`;
                    moreBadge.style.gridRow = `4`;
                    moreBadge.style.zIndex = '3';
                    moreBadge.style.alignSelf = 'center';
                    moreBadge.style.cursor = 'pointer';

                    // [무적 인라인 스타일] 브라우저 CSS 캐시/명시도 무력화 100% 보장
                    moreBadge.style.setProperty('background-color', '#FFFFFF', 'important');
                    moreBadge.style.setProperty('background', '#FFFFFF', 'important');
                    moreBadge.style.setProperty('border', '1px solid #CBD5E1', 'important');
                    moreBadge.style.setProperty('border-radius', '6px', 'important');
                    moreBadge.style.setProperty('box-shadow', '0 2px 6px rgba(15, 23, 42, 0.16)', 'important');
                    moreBadge.style.setProperty('padding', '2px 4px', 'important');
                    moreBadge.style.setProperty('text-align', 'center', 'important');
                    moreBadge.style.setProperty('justify-content', 'center', 'important');
                    moreBadge.style.setProperty('align-items', 'center', 'important');
                    const isMobileScreen = window.innerWidth <= 768;
                    if (isMobileScreen) {
                        moreBadge.innerHTML = `<span class="task-mobile-capsule" style="color: #1E293B !important; font-weight: 800 !important; font-size: 0.75rem !important; display: inline-block !important;">+${count}</span>`;
                    } else {
                        moreBadge.innerHTML = `<span class="task-desktop-title" style="color: #1E293B !important; font-weight: 800 !important; font-size: 0.75rem !important; display: inline-block !important;">+${count}개 더보기</span>`;
                    }
                    
                    const cellDate = weekDates[c];
                    const dateString = formatDate(cellDate);
                    moreBadge.onclick = (e) => {
                        e.stopPropagation();
                        showDayDetail(dateString);
                    };
                    weekRow.appendChild(moreBadge);
                }
            }

            // 모든 배경 셀들의 gridRow 스팬을 균일 고정
            const finalSpan = (typeof isCalendarExpanded !== 'undefined' && isCalendarExpanded) ? Math.max(4, actualMaxRow) : 4;
            weekCells.forEach(cell => {
                cell.style.gridRow = `1 / span ${finalSpan}`;
            });

            grid.appendChild(weekRow);
        }
    }
}

/**
 * [신규] 독립 메뉴용 캘린더 상태 및 로직
 */
let currentDateForTabCalendar = new Date();
let currentCalendarFilter = 'external';
let isCalendarExpanded = false;

function toggleCalendarExpand() {
    const grid = document.getElementById('calendar-grid-main');
    const oldHeight = grid ? grid.offsetHeight : 0;

    isCalendarExpanded = !isCalendarExpanded;
    const icon = document.getElementById('calendar-expand-icon');
    const text = document.getElementById('calendar-expand-text');
    const btn = document.getElementById('btn-toggle-calendar-expand');

    if (isCalendarExpanded) {
        if (icon) icon.textContent = 'expand_less';
        if (text) text.textContent = '캘린더 접기 (요약 뷰로 전환)';
        if (btn) btn.classList.add('expanded');
        if (grid) grid.classList.add('expanded');
    } else {
        if (icon) icon.textContent = 'expand_more';
        if (text) text.textContent = '캘린더 전체 일정 한눈에 모두 펼쳐보기';
        if (btn) btn.classList.remove('expanded');
        if (grid) grid.classList.remove('expanded');
    }

    renderTabCalendar();

    if (grid && oldHeight > 0) {
        const newHeight = grid.offsetHeight;
        
        // 1. Set to old height instantly
        grid.style.transition = 'none';
        grid.style.height = oldHeight + 'px';
        grid.style.overflow = 'hidden';
        
        // 2. Force reflow to register the instant change
        void grid.offsetHeight;
        
        // 3. Enable transition and set to new height
        grid.style.transition = 'height 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
        grid.style.height = newHeight + 'px';
        
        // 4. Clean up after animation finishes
        setTimeout(() => {
            grid.style.height = '';
            grid.style.transition = '';
            grid.style.overflow = '';
        }, 400);
    }
}

function setCalendarFilter(filter, btn) {
    currentCalendarFilter = filter;
    document.querySelectorAll('.calendar-sub-menu .cal-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderTabCalendar();
}

async function refreshCalendarEvents(btn) {
    const icon = btn ? btn.querySelector('.material-symbols-rounded') : null;
    if (icon) icon.classList.add('spin-animation');
    
    showToast('최신 일정 데이터를 불러오는 중입니다...', 'info');
    
    if (typeof fetchGoogleCalendarEvents === 'function' && typeof googleAccessToken !== 'undefined' && googleAccessToken) {
        try {
            await fetchGoogleCalendarEvents();
        } catch (e) {
            console.log('Google events fetch skip:', e);
        }
    }
    
    setTimeout(() => {
        renderTabCalendar();
        if (icon) icon.classList.remove('spin-animation');
        showToast('일정 데이터가 최신 상태로 업데이트되었습니다! ✨', 'success');
    }, 600);
}

let currentCalendarSearchQuery = '';

function highlightSearchText(text, query) {
    // 결과는 innerHTML 로 들어가므로 먼저 글자를 이스케이프한 뒤, 이스케이프된 검색어 기준으로 강조한다
    const safeText = escapeHTML(text);
    if (!query || !safeText) return safeText;
    const escapedQuery = escapeHTML(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return safeText.replace(regex, '<span class="search-highlight">$1</span>');
}

function updateSearchDropdown(items, query) {
    const dropdown = document.getElementById('calendar-search-dropdown');
    if (!dropdown) return;
    
    if (!query || items.length === 0) {
        dropdown.style.display = 'none';
        return;
    }
    
    dropdown.innerHTML = '';
    
    const uniqueDisplay = [];
    const displayItems = [];
    for (const item of items) {
        const titleStr = item.title || item.name || '제목 없음';
        const dateStr = item.startDate === item.dueDate ? (item.date || item.dueDate) : `${item.startDate || item.date} ~ ${item.dueDate || item.date}`;
        const key = `${titleStr}-${dateStr}`;
        if (!uniqueDisplay.includes(key)) {
            uniqueDisplay.push(key);
            displayItems.push(item);
            if (displayItems.length >= 10) break;
        }
    }
    
    displayItems.forEach(item => {
        const titleStr = item.title || item.name || '제목 없음';
        const dateStr = item.startDate === item.dueDate ? (item.date || item.dueDate) : `${item.startDate || item.date} ~ ${item.dueDate || item.date}`;
        const assigneeStr = item.assignee || item.userName || '';
        const detailStr = [dateStr, assigneeStr].filter(Boolean).join(' | ');
        
        const el = document.createElement('div');
        el.className = 'search-dropdown-item';
        
        const titleEl = document.createElement('div');
        titleEl.className = 'search-dropdown-title';
        titleEl.innerHTML = highlightSearchText(titleStr, query);
        
        const detailEl = document.createElement('div');
        detailEl.className = 'search-dropdown-detail';
        detailEl.innerHTML = highlightSearchText(detailStr, query);
        
        el.appendChild(titleEl);
        el.appendChild(detailEl);
        
        el.onclick = () => {
            const targetDateStr = item.startDate || item.date;
            if (targetDateStr) {
                const itemDate = new Date(targetDateStr);
                currentDateForTabCalendar.setFullYear(itemDate.getFullYear());
                currentDateForTabCalendar.setMonth(itemDate.getMonth());
                
                const searchInput = document.getElementById('calendar-search-input');
                if (searchInput) searchInput.value = '';
                currentCalendarSearchQuery = '';
                dropdown.style.display = 'none';
                
                renderTabCalendar();
                
                const dateString = targetDateStr.split('T')[0];
                if (typeof showDayDetail === 'function') {
                    showDayDetail(dateString);
                }
            }
        };
        
        dropdown.appendChild(el);
    });
    
    dropdown.style.display = 'flex';
}

window.handleCalendarSearch = function(query) {
    currentCalendarSearchQuery = query.toLowerCase().trim();
    if (typeof renderTabCalendar === 'function') {
        renderTabCalendar();
    }
};

function renderTabCalendar() {
    const gridId = 'calendar-grid-main';
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.classList.toggle('expanded', isCalendarExpanded);

    // 상단 필터 버튼 active UI 상태 실시간 동기화
    document.querySelectorAll('.calendar-sub-menu .cal-filter-btn').forEach(b => {
        if (b.getAttribute('onclick') && b.getAttribute('onclick').includes(`'${currentCalendarFilter}'`)) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });

    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px;">일정을 불러오고 있습니다...</div>';
    populateYearMonthSelectors();

    // 1. 최신 데이터 정렬 (AppStore에서 직접 참조)
    const tasksArray = Object.values(AppStore.getTasks() || {});
    const tripsObj = AppStore.getTrips() || {};
    const tripsArray = Object.keys(tripsObj).map(key => {
        const t = tripsObj[key];
        const parsed = typeof parseTripDateRange === 'function' ? parseTripDateRange(t.date) : { startDate: t.date, endDate: t.date };
        let s = parsed.startDate || t.date; let e = parsed.endDate || t.date;
        const prefix = t.status === '조율중' ? '[조율중]' : '[출장]';
        return {
            id: key,
            type: 'schedule', isTrip: true,
            title: `${prefix} ${t.name || t.destination}`, startDate: s, dueDate: e, ...t
        };
    });
    const leavesArray = Object.values(AppStore.getLeaves() || {}).filter(l => l.status === 'approved').map(l => ({ id: l.id, isLeave: true, title: `[휴가] ${l.userName}`, assignee: l.userName, startDate: l.date, dueDate: l.date }));
    const rawExternalArray = Object.values(AppStore.getExternalEvents() || {}).map(e => ({ ...e, title: e.title ? e.title.replace(/🌐\s*/g, '') : e.title }));
    
    // (중복 제거 검사는 공통 유틸리티인 isSameEvent를 호출하여 처리합니다.)

    // 1차: tripsArray 및 tasksArray와 중복되는 externalArray 제거
    let externalArray = rawExternalArray.filter(ext => {
        // [버그 수정] '연동 일정'(external) 탭에서는 trips/tasks가 렌더링되지 않으므로 중복 제거하면 아예 안 보이게 됨
        if (typeof currentCalendarFilter !== 'undefined' && currentCalendarFilter === 'external') {
            return true;
        }
        const isDuplicateWithTrip = tripsArray.some(t => isSameEvent(ext, t));
        if (isDuplicateWithTrip) return false;
        const isDuplicateWithTask = tasksArray.some(t => isSameEvent(ext, t));
        return !isDuplicateWithTask;
    });

    // 2차: externalArray 상호 간에도 세부 주소/제목 100% 일치하는 중복 항목만 1개로 정리
    const uniqueExternalArray = [];
    externalArray.forEach(ext => {
        const exists = uniqueExternalArray.some(u => isSameEvent(ext, u));
        if (!exists) uniqueExternalArray.push(ext);
    });
    externalArray = uniqueExternalArray;

    // 2. 필터 적용
    let filtered = [];
    if (currentCalendarFilter === 'all') {
        filtered = [...externalArray, ...tripsArray, ...leavesArray, ...tasksArray];
    } else if (currentCalendarFilter === 'task') {
        filtered = tasksArray.filter(t => t.type !== 'schedule');
    } else if (currentCalendarFilter === 'schedule') {
        filtered = tasksArray.filter(t => t.type === 'schedule');
    } else if (currentCalendarFilter === 'trip') {
        filtered = tripsArray;
    } else if (currentCalendarFilter === 'leave') {
        filtered = leavesArray;
    } else if (currentCalendarFilter === 'external') {
        filtered = externalArray;
    }

    // 2.5 검색어 필터링 적용
    if (typeof currentCalendarSearchQuery !== 'undefined' && currentCalendarSearchQuery) {
        filtered = filtered.filter(item => {
            const title = (item.title || item.name || '').toLowerCase();
            const desc = (item.description || item.reason || item.destination || '').toLowerCase();
            const assignee = (item.assignee || item.userName || '').toLowerCase();
            return title.includes(currentCalendarSearchQuery) || 
                   desc.includes(currentCalendarSearchQuery) || 
                   assignee.includes(currentCalendarSearchQuery);
        });
    }
    // 드롭다운 UI 렌더링
    if (typeof updateSearchDropdown === 'function') {
        updateSearchDropdown(filtered, currentCalendarSearchQuery);
    }

    // 3. 그리드 생성
    buildCalendarGrid(gridId, null, currentDateForTabCalendar, false, (cell, dateString) => {
        // 해당 날짜에 포함되는 모든 일정 필터링 (정확 일치 + 범위 포함)
        const dayTasks = filtered.filter(item => {
            // 정확 일치 (원본 로직 - 안정적)
            if (item.dueDate === dateString || item.date === dateString || item.startDate === dateString) return true;
            // 범위 체크 (시작일~종료일 사이의 날짜도 포함)
            if (item.startDate && item.dueDate && item.startDate !== item.dueDate) {
                const t = new Date(dateString).setHours(0, 0, 0, 0);
                const s = new Date(item.startDate).setHours(0, 0, 0, 0);
                const e = new Date(item.dueDate).setHours(0, 0, 0, 0);
                return t >= s && t <= e;
            }
            return false;
        });

        // [신규] 동일 날짜 동일 기관/장소/주소 일정 그리드 중복 노출 방지 (Deduplication)
        const uniqueDayTasks = [];
        dayTasks.forEach(task => {
            const exists = uniqueDayTasks.some(u => isSameEvent(task, u));
            if (!exists) uniqueDayTasks.push(task);
        });

        uniqueDayTasks.forEach(task => {
            const el = document.createElement('div');
            el.className = 'calendar-task';
            el.dataset.tippyContent = task.title;
            el.dataset.startDate = task.startDate || task.date || '';
            el.dataset.dueDate = task.dueDate || task.date || '';
            el.dataset.taskId = task.id || '';

            let statusIcon = task.isLeave ? '🌴 ' : (task.isTrip ? '⚑ ' : (task.isExternal ? '🌐 ' : (task.type === 'schedule' ? '📅 ' : (task.status === 'done' ? '✓ ' : ''))));

            // [신규] 일정 충돌 검사 및 배지 표시
            const assignee = task.assignee || '미지정';
            const hasConflict = (task.isTrip || (!task.isLeave && !task.isExternal && task.type !== 'schedule')) &&
                typeof checkTripTaskConflicts === 'function' &&
                checkTripTaskConflicts(assignee, dateString);

            if (hasConflict) {
                statusIcon = '🚨 ' + statusIcon;
                el.dataset.tippyContent = `[🚨 일정 충돌 경고: 출장과 업무 기한 중복] ${task.title}`;
                el.style.border = '2px solid var(--danger)';
                el.style.boxShadow = '0 0 8px rgba(239, 68, 68, 0.6)';
            }

            const info = parseTaskDisplayInfo(task);
            const conflictHtml = hasConflict ? '<span class="task-conflict-badge">🚨</span>' : '';
            const timeBadgeHtml = info.time ? `<span class="task-time-badge">${escapeHTML(info.time)}</span>` : '';
            el.innerHTML = `${conflictHtml}${timeBadgeHtml}<span class="task-desktop-title"><span class="task-icon">${info.icon}</span> ${escapeHTML(info.cleanTitle)}</span><span class="task-tablet-title"><span class="task-icon">${info.icon}</span> ${info.shortLabel}</span><span class="task-mobile-capsule">${info.icon}${info.shortLabel}</span>`;

            // 타입 및 우선순위별 스타일 클래스 바인딩 (인라인 백그라운드 제거)
            const catClass = getCategoryClass(task);
            if (catClass) {
                el.classList.add(catClass);
            } else if (task.isLeave) el.classList.add('task-leave');
            else if (task.isTrip) el.classList.add('task-trip');
            else if (task.isExternal) { if (task.colorId === '11') { el.classList.add('task-red'); } else { el.classList.add('task-external'); } }
            else if (task.type === 'schedule') el.classList.add('task-schedule');
            else {
                const priorityClass = task.priority === 'high' ? 'task-high' : (task.priority === 'low' ? 'task-low' : 'task-medium');
                el.classList.add(priorityClass);
            }
            if (task.status === 'done' && !task.isTrip) el.classList.add('task-done-style');
            if (task.title && task.title.includes('조율중')) el.classList.add('task-tentative');

            el.onclick = (e) => {
                e.stopPropagation();
                if (task.isLeave) openLeaveDetailModal(task.id);
                else if (task.isTrip) openTripModal(task.id, task.name, task.date, task.assignee, task.contact, task.address, task.scheduleUrl, task.schedulePath, task.qrUrl || '', task.qrPath || '', task.roomType, task.bookedHotel);
                else if (task.isExternal) {
                    openModal(task.id, task.title, task.description || '', task.dueDate, task.startDate, 'external');
                }
                else openModal(task.id, task.title, task.description, task.dueDate, task.startDate);
            };
            cell.appendChild(el);
        });
    });
}

function setCalendarFilter(filter, btn) {
    currentCalendarFilter = filter;

    // 버튼 UI 업데이트
    document.querySelectorAll('.calendar-sub-menu .cal-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    renderTabCalendar();
}

function changeCalendarMonth(delta) {
    currentDateForTabCalendar.setDate(1);
    currentDateForTabCalendar.setMonth(currentDateForTabCalendar.getMonth() + delta);
    renderTabCalendar();
}

/**
 * 연도/월 선택기(Picker) 생성 및 업데이트 (안정성 강화)
 */
function populateYearMonthSelectors() {
    const yearSelect = document.getElementById('calendar-year-select');
    const monthSelect = document.getElementById('calendar-month-select');
    if (!yearSelect || !monthSelect) return;

    const currentYear = currentDateForTabCalendar.getFullYear();
    const currentMonth = currentDateForTabCalendar.getMonth();

    // [버그 수정] 매번 연도 목록을 현재 날짜 기준 +/- 5년으로 동적 갱신
    yearSelect.innerHTML = '';
    for (let y = currentYear - 5; y <= currentYear + 5; y++) {
        const opt = document.createElement('option');
        opt.value = y; opt.textContent = `${y}년`;
        yearSelect.appendChild(opt);
    }
    yearSelect.value = currentYear;

    // 월 목록 생성 (최초 1회만 생성으로 유지)
    if (monthSelect.options.length === 0) {
        for (let m = 0; m < 12; m++) {
            const opt = document.createElement('option');
            opt.value = m; opt.textContent = `${m + 1}월`;
            monthSelect.appendChild(opt);
        }
    }
    monthSelect.value = currentMonth;
}

/**
 * 선택한 연도/월로 즉시 이동
 */
function jumpToSelectedDate() {
    const yearEl = document.getElementById('calendar-year-select');
    const monthEl = document.getElementById('calendar-month-select');
    if (!yearEl || !monthEl) return;

    const year = parseInt(yearEl.value);
    const month = parseInt(monthEl.value);

    currentDateForTabCalendar = new Date(year, month, 1);
    renderTabCalendar();
}

/**
 * 오늘 날짜로 즉시 이동 (Today 버튼 기능)
 */
function jumpToToday() {
    currentDateForTabCalendar = new Date();
    if (typeof currentDateForModalCalendar !== 'undefined') {
        currentDateForModalCalendar = new Date();
    }
    if (typeof renderTabCalendar === 'function') {
        renderTabCalendar();
    }
    const modalEl = document.getElementById('commonCalendarModal');
    if (modalEl && modalEl.style.display && modalEl.style.display !== 'none' && typeof renderModalCalendar === 'function') {
        renderModalCalendar();
    }
}

/**
 * 특정 날짜의 모든 일정을 모아 보여주는 상세 창 제어
 */
function showDayDetail(dateString) {
    const overlay = document.getElementById('day-detail-overlay');
    const listEl = document.getElementById('day-detail-list');
    const dateText = document.getElementById('selected-date-text');
    const dayLabel = document.getElementById('selected-day-label');

    if (!overlay || !listEl) return;

    selectedDateForCreation = dateString;

    // 1. 날짜 텍스트 설정
    const dateObj = new Date(dateString);
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

    dateText.textContent = dateObj.toLocaleDateString('ko-KR', options);
    dayLabel.textContent = dayNames[dateObj.getDay()];

    // 2. 해당 날짜 일정 필터링 (업무, 출장, 휴가, 외부 연동)
    const tasks = Object.values(AppStore.getTasks() || {}).filter(t => t.dueDate === dateString || t.startDate === dateString);
    const tripsObj = AppStore.getTrips() || {};
    const trips = Object.keys(tripsObj).map(key => {
        const t = tripsObj[key];
        const parsed = typeof parseTripDateRange === 'function' ? parseTripDateRange(t.date) : { startDate: t.date, endDate: t.date };
        let s = parsed.startDate || t.date; let e = parsed.endDate || t.date;
        const prefix = t.status === '조율중' ? '[조율중]' : '[출장]';
        return {
            id: key,
            type: 'schedule', isTrip: true,
            title: `${prefix} ${t.name || t.destination}`, startDate: s, dueDate: e, ...t
        };
    }).filter(t => {
        const s = t.startDate || t.date; let e = t.dueDate || t.date;
        return dateString >= s && dateString <= e;
    });
    const leaves = Object.values(AppStore.getLeaves() || {}).filter(l => l.date === dateString && l.status === 'approved');
    const externals = Object.values(AppStore.getExternalEvents() || {}).map(e => ({ ...e, title: e.title ? e.title.replace(/🌐\s*/g, '') : e.title })).filter(e => {
        if (e.startDate && e.dueDate && e.startDate !== e.dueDate) {
            return dateString >= e.startDate && dateString <= e.dueDate;
        }
        return e.dueDate === dateString || e.startDate === dateString;
    });

    listEl.innerHTML = '';

    let combined = [
        ...tasks.map(t => ({ ...t, type: t.type || 'task' })),
        ...trips.map(t => ({ ...t, type: 'trip', title: `[출장] ${t.name || t.destination}` })),
        ...leaves.map(l => ({ ...l, type: 'leave', title: `[휴가] ${l.userName}` })),
        ...externals.map(e => ({ ...e, type: 'external' }))
    ];

    // [신규] 현재 활성화된 캘린더 필터(currentCalendarFilter)에 맞게 일정 상세 팝업 목록도 필터링
    if (typeof currentCalendarFilter !== 'undefined' && currentCalendarFilter !== 'all') {
        if (currentCalendarFilter === 'task') {
            combined = combined.filter(item => item.type !== 'schedule' && item.type !== 'trip' && item.type !== 'leave' && item.type !== 'external');
        } else if (currentCalendarFilter === 'schedule') {
            combined = combined.filter(item => item.type === 'schedule');
        } else if (currentCalendarFilter === 'trip') {
            combined = combined.filter(item => item.type === 'trip');
        } else if (currentCalendarFilter === 'leave') {
            combined = combined.filter(item => item.type === 'leave');
        } else if (currentCalendarFilter === 'external') {
            combined = combined.filter(item => item.type === 'external');
        }
    }

    // [신규] 동일 날짜 내 중복 일정(동일 제목) 자동 제거 (Deduplication)
    const seenKeys = new Set();
    combined = combined.filter(item => {
        const titleKey = (item.title || '').trim().replace(/\s+/g, ' ');
        const key = `${item.type}_${titleKey}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
    });

    if (combined.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">이 날은 등록된 일정이 없습니다.</div>';
    } else {
        combined.forEach(item => {
            const div = document.createElement('div');
            div.className = 'day-item';

            // 캘린더와 동일한 아이콘(이모지) 적용 및 카테고리 추출
            const info = typeof parseTaskDisplayInfo === 'function' ? parseTaskDisplayInfo(item) : null;
            const displayIcon = info ? info.icon : '📌';
            
            let category = info ? info.shortLabel : '업무';
            if (!info && item.type === 'trip') category = '출장';
            if (!info && item.type === 'leave') category = '휴가';
            if (!info && item.type === 'external') category = '외부 연동';
            if (!info && item.type === 'schedule') category = '일정';

            // 카테고리별 색상 매핑 (style.css 캘린더 색상 테마와 통일)
            let color = '#4F46E5'; // 기본 (업무/자체)
            if (category === '쿠팡') color = '#10B981';
            else if (category === '강의' || category === '교육') color = '#EAB308';
            else if (category === '이지앤') color = '#3B82F6';
            else if (category === '휴노') color = '#A855F7';
            else if (category === '텔러스') color = '#14B8A6';
            else if (category === '자체' || category === '내부') color = '#EF4444';
            else if (category === '카카오') color = '#FACC15';
            else if (category === '스마일게이트') color = '#F97316';
            else if (category === 'SK스토아' || category === 'sk스토아') color = '#EF4444';
            else if (category === '공기관') color = '#64748B';
            else if (category === '출장' || item.type === 'trip') { color = '#8B5CF6'; category = '출장'; }
            else if (category === '휴가' || item.type === 'leave') { color = '#10B981'; category = '휴가'; }
            else if (category === '외부' || item.type === 'external') { color = '#2DB400'; category = '외부 연동'; }
            else if (category === '일정' || item.type === 'schedule') { color = '#F43F5E'; category = '일정'; }

            // 일정 시간 파싱 및 제목 클렌징
            let timeText1 = "종일";
            let timeText2 = "";
            let displayTitle = info ? info.cleanTitle : (item.title || "");

            const timeRegex = /\[(\d{2}):(\d{2})\]/;
            const match = (item.title || "").match(timeRegex);
            if (match) {
                const hour = parseInt(match[1]);
                const minute = match[2];
                const ampm = hour >= 12 ? "오후" : "오전";
                const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);

                timeText1 = ampm;
                timeText2 = `${displayHour}:${minute}`;
                
                if (!info) {
                    displayTitle = displayTitle.replace(timeRegex, "").trim();
                }
            }

            // 일정 충돌 검증 및 상세 정보 바인딩
            const assignee = item.assignee || item.userName || '';
            const hasConflict = (item.type === 'task' || item.type === 'trip') &&
                typeof checkTripTaskConflicts === 'function' &&
                checkTripTaskConflicts(assignee, dateString);

            let conflictMsgHtml = '';
            if (hasConflict) {
                const conflictDetails = getConflictingItems(assignee, dateString);
                const taskTitles = conflictDetails.tasks.map(t => `"${escapeHTML(t.title)}"`).join(', ');
                const tripTitles = conflictDetails.trips.map(t => `"${escapeHTML(t.name)}"`).join(', ');
                conflictMsgHtml = `<div style="color:var(--danger); font-size:0.75rem; font-weight:bold; margin-top:6px; display:flex; align-items:center; gap:4px; line-height:1.4;"><span class="material-symbols-rounded" style="font-size:1.15rem; vertical-align:middle; color:var(--danger);">warning</span> 일정 충돌 경고: [업무] ${taskTitles} 와(과) [출장] ${tripTitles} 가 겹칩니다!</div>`;

                div.style.border = '1px solid #FCA5A5';
                div.style.backgroundColor = '#FEF2F2';
            }

            div.innerHTML = `
                <div class="day-item-time-col">
                    <div class="time-primary">${timeText1}</div>
                    ${timeText2 ? `<div class="time-secondary">${timeText2}</div>` : ''}
                </div>
                <div class="day-item-bar" style="background-color: ${color};"></div>
                <div class="day-item-icon" style="background-color: ${color}20; color: ${color}; font-size: 1.2rem; display: flex; align-items: center; justify-content: center; font-family: 'Tossface', 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif;">
                    ${displayIcon}
                </div>
                <div class="day-item-info" style="flex:1;">
                    <div class="day-item-title">${escapeHTML(displayTitle)}</div>
                    <div class="day-item-meta">${category} • ${escapeHTML(item.assignee || item.userName || '전체')}</div>
                    ${conflictMsgHtml}
                </div>
                <span class="material-symbols-rounded" style="color:var(--border-color);">chevron_right</span>
            `;

            div.onclick = () => {
                closeDayDetail();
                if (item.type === 'leave') openLeaveDetailModal(item.id);
                else if (item.type === 'trip') openTripModal(item.id, item.name, item.date, item.assignee, item.contact, item.address, item.scheduleUrl, item.schedulePath, item.qrUrl || '', item.qrPath || '', item.roomType, item.bookedHotel);
                else if (item.type === 'task' || item.type === 'schedule') openModal(item.id, item.title, item.description, item.dueDate, item.startDate);
                else if (item.type === 'external') {
                    openModal(item.id, item.title, item.description || '', item.dueDate, item.startDate, 'external');
                }
            };

            listEl.appendChild(div);
        });
    }

    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeDayDetail() {
    const overlay = document.getElementById('day-detail-overlay');
    const panel = document.querySelector('.day-detail-panel');
    if (panel) {
        panel.style.transform = '';
    }
    document.body.style.overflow = '';
    if (overlay) overlay.style.display = 'none';
}

function initDayDetailTouchEvents() {
    const panel = document.querySelector('.day-detail-panel');
    const handleContainer = document.querySelector('.bottom-sheet-handle-container');
    const handle = document.querySelector('.bottom-sheet-handle');
    const header = document.querySelector('.day-detail-header');

    if (!panel) return;

    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    const onTouchStart = (e) => {
        const listEl = document.getElementById('day-detail-list');
        const isListAtTop = !listEl || listEl.scrollTop <= 0;
        const isHandleArea = (handleContainer && handleContainer.contains(e.target)) ||
                            (handle && handle.contains(e.target)) ||
                            (header && header.contains(e.target));

        if (isHandleArea || isListAtTop) {
            startY = e.touches[0].clientY;
            currentY = startY;
            isDragging = true;
            panel.style.transition = 'none';
        }
    };

    const onTouchMove = (e) => {
        if (!isDragging) return;
        currentY = e.touches[0].clientY;
        const diffY = currentY - startY;

        if (diffY > 0) {
            if (e.cancelable) e.preventDefault();
            panel.style.transform = `translateY(${diffY}px)`;
        } else {
            panel.style.transform = 'translateY(0px)';
        }
    };

    const onTouchEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        panel.style.transition = 'transform 0.22s cubic-bezier(0, 0, 0.2, 1)';
        const diffY = currentY - startY;

        if (diffY > 60) {
            panel.style.transform = 'translateY(100%)';
            setTimeout(() => {
                closeDayDetail();
                panel.style.transform = '';
            }, 180);
        } else {
            panel.style.transform = 'translateY(0)';
        }
    };

    panel.addEventListener('touchstart', onTouchStart, { passive: true });
    panel.addEventListener('touchmove', onTouchMove, { passive: false });
    panel.addEventListener('touchend', onTouchEnd, { passive: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDayDetailTouchEvents);
} else {
    initDayDetailTouchEvents();
}

function addScheduleFromCalendar(type) {
    if (!selectedDateForCreation) return;
    closeDayDetail();

    if (type === 'task') {
        const newKey = db.ref('tasks').push().key;
        openModal(newKey, '', '', selectedDateForCreation, selectedDateForCreation, 'schedule');

        // flatpickr의 날짜 선택 값을 명시적으로 갱신
        setTimeout(() => {
            const startInput = document.getElementById('modalStartDate');
            const dueInput = document.getElementById('modalDueDate');
            if (startInput && startInput._flatpickr) {
                startInput._flatpickr.setDate(selectedDateForCreation);
            }
            if (dueInput && dueInput._flatpickr) {
                dueInput._flatpickr.setDate(selectedDateForCreation);
            }
        }, 150);
    } else if (type === 'trip') {
        if (typeof openTripModal === 'function') {
            openTripModal(null, '', selectedDateForCreation);
        }

        // flatpickr의 날짜 선택 값을 명시적으로 갱신
        setTimeout(() => {
            const tripDateInput = document.getElementById('tripDate');
            if (tripDateInput && tripDateInput._flatpickr) {
                tripDateInput._flatpickr.setDate(selectedDateForCreation);
            }
        }, 150);
    }
}

function renderModalCalendar() {
    const priorityWeight = { 'high': 3, 'medium': 2, 'low': 1 };
    const tasksArray = Object.values(AppStore.getTasks()).sort((a, b) => (priorityWeight[b.priority] || 2) - (priorityWeight[a.priority] || 2));
    const tripsObj = AppStore.getTrips() || {};
    const tripsArray = Object.keys(tripsObj).map(key => {
        const t = tripsObj[key];
        const parsed = typeof parseTripDateRange === 'function' ? parseTripDateRange(t.date) : { startDate: t.date, endDate: t.date };
        let s = parsed.startDate || t.date; let e = parsed.endDate || t.date;
        const prefix = t.status === '조율중' ? '[조율중]' : '[출장]';
        return {
            id: key,
            type: 'schedule', isTrip: true,
            title: `${prefix} ${t.name || t.destination}`, startDate: s, dueDate: e, ...t, status: 'todo'
        };
    });
    const leavesArray = Object.values(AppStore.getLeaves()).filter(l => l.status === 'approved').map(l => ({ id: l.id, uid: l.uid, isLeave: true, title: `[휴가] ${l.userName}`, name: `[휴가] ${l.userName}`, assignee: l.userName, startDate: l.date, dueDate: l.date, status: 'todo', priority: 'medium' }));

    // 외부 일정 가져오기 및 주소/기관명 정밀 중복 제거
    const rawExternalArray = Object.values(AppStore.getExternalEvents()).map(e => ({ ...e, title: e.title ? e.title.replace(/🌐\s*/g, '') : e.title }));
    
    // (중복 제거 검사는 공통 유틸리티인 isSameEvent를 호출하여 처리합니다.)

    let externalArray = rawExternalArray.filter(ext => {
        const isDuplicateWithTrip = tripsArray.some(t => isSameEvent(ext, t));
        if (isDuplicateWithTrip) return false;
        const isDuplicateWithTask = tasksArray.some(t => isSameEvent(ext, t));
        return !isDuplicateWithTask;
    });

    const uniqueExternalArray = [];
    externalArray.forEach(ext => {
        const exists = uniqueExternalArray.some(u => isSameEvent(ext, u));
        if (!exists) uniqueExternalArray.push(ext);
    });
    externalArray = uniqueExternalArray;

    const combinedArray = [...tasksArray, ...tripsArray, ...leavesArray, ...externalArray];

    buildCalendarGrid('modal-calendar-grid', 'modal-calendar-month-year', currentDateForModalCalendar, false, (cell, dateString) => {
        const dayItems = [];
        combinedArray.forEach(task => {
            let isIncluded = false;
            if (task.startDate && task.dueDate && task.startDate !== task.dueDate) {
                if (dateString >= task.startDate && dateString <= task.dueDate) isIncluded = true;
            } else {
                if (task.dueDate === dateString || task.date === dateString || task.startDate === dateString) isIncluded = true;
            }
            if (isIncluded) {
                dayItems.push(task);
                const el = document.createElement('div'); el.className = 'calendar-task'; el.dataset.tippyContent = task.title;
                el.dataset.startDate = task.startDate || task.date || '';
                el.dataset.dueDate = task.dueDate || task.date || '';
                el.dataset.taskId = task.id || '';
                let statusIcon = task.isLeave ? '🌴 ' : (task.isTrip ? '⚑ ' : (task.isExternal ? '🌐 ' : (task.type === 'schedule' ? '📅 ' : (!task.isTrip && task.status === 'done' ? '✓ ' : ''))));

                // [신규] 일정 충돌 감지 및 UI 표시
                const assignee = task.assignee || '미지정';
                const hasConflict = (task.isTrip || (!task.isLeave && !task.isExternal && task.type !== 'schedule')) &&
                    typeof checkTripTaskConflicts === 'function' &&
                    checkTripTaskConflicts(assignee, dateString);

                if (hasConflict) {
                    statusIcon = '🚨 ' + statusIcon;
                    el.dataset.tippyContent = `[🚨 일정 충돌 경고: 출장과 업무 기한 중복] ${task.title}`;
                    el.style.border = '2px solid var(--danger)';
                    el.style.boxShadow = '0 0 8px rgba(239, 68, 68, 0.6)';
                }

            const info = parseTaskDisplayInfo(task);
            const conflictHtml = hasConflict ? '<span class="task-conflict-badge">🚨</span>' : '';
            const timeBadgeHtml = info.time ? `<span class="task-time-badge">${escapeHTML(info.time)}</span>` : '';
            el.innerHTML = `${conflictHtml}${timeBadgeHtml}<span class="task-desktop-title"><span class="task-icon">${info.icon}</span> ${escapeHTML(info.cleanTitle)}</span><span class="task-tablet-title"><span class="task-icon">${info.icon}</span> ${info.shortLabel}</span><span class="task-mobile-capsule">${info.icon}${info.shortLabel}</span>`;

                // 타입 및 우선순위별 스타일 클래스 바인딩 (인라인 백그라운드 제거)
                const catClass = getCategoryClass(task);
                if (catClass) {
                    el.classList.add(catClass);
                } else if (task.isLeave) el.classList.add('task-leave');
                else if (task.isTrip) el.classList.add('task-trip');
                else if (task.isExternal) { if (task.colorId === '11') { el.classList.add('task-red'); } else { el.classList.add('task-external'); } }
                else if (task.type === 'schedule') el.classList.add('task-schedule');
                else {
                    const priorityClass = task.priority === 'high' ? 'task-high' : (task.priority === 'low' ? 'task-low' : 'task-medium');
                    el.classList.add(priorityClass);
                }
                if (task.status === 'done' && !task.isTrip) el.classList.add('task-done-style');
                if (task.title && task.title.includes('조율중')) el.classList.add('task-tentative');

                el.onclick = () => {
                    if (task.isLeave) openLeaveDetailModal(task.id);
                    else if (task.isTrip) { closeCommonCalendarModal(); openTripModal(task.id, task.name, task.date, task.assignee, task.contact, task.address, task.scheduleUrl, task.schedulePath, task.qrUrl || '', task.qrPath || '', task.roomType, task.bookedHotel); }
                    else if (task.isExternal) {
                        closeCommonCalendarModal();
                        openModal(task.id, task.title, task.description || '', task.dueDate, task.startDate, 'external');
                    }
                    else { closeCommonCalendarModal(); openModal(task.id, task.title, task.description, task.dueDate, task.startDate); }
                };
                cell.appendChild(el);
            }
        });
        const dateHeader = cell.querySelector('.calendar-date');
        if (dateHeader) {
            dateHeader.classList.add('clickable-date');
            dateHeader.title = '클릭하여 전체 일정 보기';
            dateHeader.onclick = (e) => {
                e.stopPropagation();
                if (dayItems.length > 0) openTripGroupModal(`🗓 ${dateString} 전체 일정`, dayItems);
                else showToast('이 날짜에는 등록된 일정이 없습니다.', 'info');
            };
        }
    });
}

function toggleViewMode() {
    AppStore.setViewMode(document.getElementById('viewMode').value);
    ['board-status', 'board-timeline', 'board-calendar', 'board-gantt'].forEach(id => document.getElementById(id).style.display = 'none');
    document.getElementById(`board-${AppStore.getViewMode()}`).style.display = AppStore.getViewMode() === 'gantt' ? 'block' : 'flex';
}
function changeMonth(offset) { currentDateForCalendar.setDate(1); currentDateForCalendar.setMonth(currentDateForCalendar.getMonth() + offset); renderTasks(); }
function changeGanttMonth(offset) { currentDateForGantt.setDate(1); currentDateForGantt.setMonth(currentDateForGantt.getMonth() + offset); renderTasks(); }

function renderCalendar(tasksArray) {
    buildCalendarGrid('calendar-grid', 'calendar-month-year', currentDateForCalendar, false, (cell, dateString) => {
        const dayItems = [];
        tasksArray.forEach(task => {
            let isIncluded = false;
            if (task.startDate && task.dueDate && task.startDate !== task.dueDate) {
                if (dateString >= task.startDate && dateString <= task.dueDate) isIncluded = true;
            } else {
                if (task.dueDate === dateString || task.date === dateString || task.startDate === dateString) isIncluded = true;
            }
            if (isIncluded) {
                dayItems.push(task);
                const el = document.createElement('div'); el.className = 'calendar-task'; el.dataset.tippyContent = task.title; el.dataset.assignee = task.assignee || '미지정';
                el.dataset.startDate = task.startDate || task.date || '';
                el.dataset.dueDate = task.dueDate || task.date || '';
                el.dataset.taskId = task.id || '';

                // [신규] 일정 충돌 검증 및 배지 표시
                const assignee = task.assignee || '미지정';
                const hasConflict = (task.isTrip || (!task.isLeave && !task.isExternal && task.type !== 'schedule')) &&
                    typeof checkTripTaskConflicts === 'function' &&
                    checkTripTaskConflicts(assignee, dateString);

                let warningIconHtml = '';
                if (hasConflict) {
                    warningIconHtml = '<span class="material-symbols-rounded" style="font-size:1.1em; margin-right:4px; color:#EF4444; font-weight:bold; vertical-align:middle;">warning</span>';
                    el.dataset.tippyContent = `[🚨 일정 충돌 경고: 출장과 업무 기한 중복] ${task.title}`;
                    el.style.border = '2px solid var(--danger)';
                    el.style.boxShadow = '0 0 8px rgba(239, 68, 68, 0.6)';
                }

                const info = parseTaskDisplayInfo(task);
                const conflictHtml = hasConflict ? '<span class="task-conflict-badge">🚨</span>' : '';
                const timeBadgeHtml = info.time ? `<span class="task-time-badge">${escapeHTML(info.time)}</span>` : '';
                el.innerHTML = `${conflictHtml}${timeBadgeHtml}<span class="task-desktop-title"><span class="task-icon">${info.icon}</span> ${escapeHTML(info.cleanTitle)}</span><span class="task-tablet-title"><span class="task-icon">${info.icon}</span> ${info.shortLabel}</span><span class="task-mobile-capsule">${info.icon}${info.shortLabel}</span>`;

                // 타입 및 우선순위별 스타일 클래스 바인딩 (인라인 백그라운드 제거)
                const catClass = getCategoryClass(task);
                if (catClass) {
                    el.classList.add(catClass);
                } else if (task.isLeave) el.classList.add('task-leave');
                else if (task.isTrip) el.classList.add('task-trip');
                else if (task.isExternal) { if (task.colorId === '11') { el.classList.add('task-red'); } else { el.classList.add('task-external'); } }
                else if (task.type === 'schedule') el.classList.add('task-schedule');
                else {
                    const priorityClass = task.priority === 'high' ? 'task-high' : (task.priority === 'low' ? 'task-low' : 'task-medium');
                    el.classList.add(priorityClass);
                }
                if (task.status === 'done' && !task.isTrip) el.classList.add('task-done-style');
                if (task.title && task.title.includes('조율중')) el.classList.add('task-tentative');

                el.onclick = () => {
                    if (task.isLeave) openLeaveDetailModal(task.id);
                    else if (task.isTrip) openTripModal(task.id, task.name, task.date, task.assignee, task.contact, task.address, task.scheduleUrl, task.schedulePath, task.qrUrl || '', task.qrPath || '', task.roomType, task.bookedHotel);
                    else if (task.isExternal) {
                        openModal(task.id, task.title, task.description || '', task.dueDate, task.startDate, 'external');
                    }
                    else openModal(task.id, task.title, task.description, task.dueDate, task.startDate);
                };
                cell.appendChild(el);
            }
        });
        const dateHeader = cell.querySelector('.calendar-date');
        if (dateHeader) {
            dateHeader.classList.add('clickable-date');
            dateHeader.title = '클릭하여 전체 일정 보기';
            dateHeader.onclick = (e) => {
                e.stopPropagation();
                if (dayItems.length > 0) openTripGroupModal(`🗓 ${dateString} 전체 일정`, dayItems);
                else showToast('이 날짜에는 등록된 일정이 없습니다.', 'info');
            };
        }
    });
}

function openTripGroupModal(titleText, items) {
    document.getElementById('tripGroupTitle').textContent = titleText;
    const listEl = document.getElementById('tripGroupList'); listEl.innerHTML = '';

    // [모달 팝업 내 2차 정밀 중복 제거] 동일 기관/장소/주소건 1개만 노출
    const uniqueItems = [];
    (items || []).forEach(item => {
        const exists = typeof isSameEvent === 'function' ? uniqueItems.some(u => isSameEvent(item, u)) : false;
        if (!exists) uniqueItems.push(item);
    });

    uniqueItems.forEach(item => {
        const li = document.createElement('li'); li.style.cursor = 'pointer';
        let icon = item.isLeave ? 'beach_access' : (item.isTrip ? 'flight_takeoff' : (item.isExternal ? 'sync' : 'radio_button_unchecked'));
        if (!item.isTrip && !item.isLeave && !item.isExternal) { if (item.status === 'doing') icon = 'pending'; if (item.status === 'done') icon = 'check_circle'; }
        const color = item.isLeave ? '#10B981' : (item.isTrip ? '#8B5CF6' : (item.isExternal ? '#2DB400' : 'var(--text-main)'));
        const titleToDisplay = item.isLeave || item.isTrip ? item.name : item.title;
        
        let subtitle = '';
        if (item.isLeave || item.isTrip) {
            subtitle = `<span class="material-symbols-rounded" style="font-size:1.1em;">person</span> ${escapeHTML(item.assignee || '미지정')} | <span class="material-symbols-rounded" style="font-size:1.1em;">location_on</span> ${escapeHTML(item.address || '주소 미입력')}`;
        } else if (item.isExternal) {
            subtitle = `<span class="material-symbols-rounded" style="font-size:1.1em;">person</span> ${escapeHTML(item.assignee || '미지정')} | <span class="material-symbols-rounded" style="font-size:1.1em;">location_on</span> ${escapeHTML(item.location || '장소 미입력')}`;
        } else {
            subtitle = `<span class="material-symbols-rounded" style="font-size:1.1em;">person</span> ${escapeHTML(item.assignee || '미정')} | 중요도: ${item.priority === 'high' ? '높음' : (item.priority === 'low' ? '낮음' : '보통')}`;
        }

        li.innerHTML = `<div style="display: flex; flex-direction: column; gap: 0.3rem;"><span style="color: ${color}; font-size: 0.95rem; font-weight: 600; display:flex; align-items:center;"><span class="material-symbols-rounded" style="font-size:1.2em; margin-right:4px;">${icon}</span> ${escapeHTML(titleToDisplay)}</span><span style="font-size: 0.8rem; color: var(--text-muted); font-weight: normal;">${subtitle}</span></div>`;
        li.onclick = () => {
            if (item.isLeave) openLeaveDetailModal(item.id);
            else if (item.isTrip) { closeTripGroupModal(); openTripModal(item.id, item.name, item.date, item.assignee, item.contact, item.address, item.scheduleUrl, item.schedulePath, item.qrUrl || '', item.qrPath || '', item.roomType, item.bookedHotel); }
            else if (item.isExternal) { closeTripGroupModal(); openModal(item.id, item.title, item.description || '', item.dueDate, item.startDate, 'external'); }
            else { closeTripGroupModal(); openModal(item.id, item.title, item.description, item.dueDate, item.startDate); }
        };
        listEl.appendChild(li);
    });
    document.getElementById('tripGroupModal').style.display = 'flex';
}
function closeTripGroupModal() { document.getElementById('tripGroupModal').style.display = 'none'; }

function renderGantt(tasksArray) {
    const header = document.getElementById('gantt-header'), body = document.getElementById('gantt-body');
    const todayTime = new Date().setHours(0, 0, 0, 0);
    header.innerHTML = '<div class="gantt-row-label" style="border-right: 2px solid var(--border-color); border-bottom: none; background-color: var(--card-bg); z-index: 20;">업무명</div>';
    body.innerHTML = '';

    const year = currentDateForGantt.getFullYear(), month = currentDateForGantt.getMonth();
    document.getElementById('gantt-month-year').textContent = `${year}년 ${month + 1}월`;
    const startDay = new Date(year, month, 1), endDay = new Date(year, month + 1, 0);
    const timelineWidth = endDay.getDate() * 40;

    for (let i = 1; i <= endDay.getDate(); i++) {
        const d = new Date(year, month, i), dayEl = document.createElement('div');
        dayEl.className = 'gantt-day'; if (d.setHours(0, 0, 0, 0) === todayTime) dayEl.classList.add('today');
        dayEl.textContent = i; header.appendChild(dayEl);
    }

    const undatedItems = tasksArray.filter(t => t.isTrip ? !t.startDate : (t.isLeave ? false : (!t.startDate && !t.dueDate)));
    const datedTrips = tasksArray.filter(t => t.isTrip && t.startDate);
    const datedLeaves = tasksArray.filter(t => t.isLeave && t.startDate);
    const datedExternal = tasksArray.filter(t => t.isExternal && (t.startDate || t.dueDate));
    const datedTasks = tasksArray.filter(t => !t.isTrip && !t.isLeave && !t.isExternal && (t.startDate || t.dueDate));

    if (undatedItems.length > 0) {
        const row = document.createElement('div'); row.className = 'gantt-row';
        const label = document.createElement('div'); label.className = 'gantt-row-label'; label.style.color = 'var(--text-muted)'; label.innerHTML = '<span class="material-symbols-rounded" style="font-size:1.2em; margin-right:6px;">calendar_today</span> 날짜 미지정 (통합)'; row.appendChild(label);
        const barArea = document.createElement('div'); barArea.className = 'gantt-bar-area'; barArea.style.width = `${timelineWidth}px`;
        const bar = document.createElement('div'); bar.className = 'gantt-bar gantt-trip-group'; bar.dataset.assignee = undatedItems.map(t => t.assignee || '').join(' ').toLowerCase();
        bar.style.left = `${Math.round((todayTime - startDay.getTime()) / 86400000) * 40}px`; bar.style.width = `40px`; bar.style.backgroundColor = 'var(--text-muted)';
        bar.dataset.tippyContent = undatedItems.map(t => `${t.isTrip || t.isLeave ? t.name : t.title} (${t.assignee || '미지정'})`).join('\n');
        if (undatedItems.length > 1) { bar.textContent = `${undatedItems.length}건`; bar.onclick = () => openTripGroupModal(`🗓 날짜 미지정 목록`, undatedItems); }
        else { bar.textContent = undatedItems[0].assignee || '미지정'; bar.onclick = () => undatedItems[0].isTrip ? openTripModal(undatedItems[0].id, undatedItems[0].name, undatedItems[0].date, undatedItems[0].assignee, undatedItems[0].contact, undatedItems[0].address, undatedItems[0].scheduleUrl, undatedItems[0].schedulePath, undatedItems[0].qrUrl || '', undatedItems[0].qrPath || '', undatedItems[0].roomType, undatedItems[0].bookedHotel) : openModal(undatedItems[0].id, undatedItems[0].title, undatedItems[0].description, undatedItems[0].dueDate, undatedItems[0].startDate); }
        barArea.appendChild(bar); row.appendChild(barArea); body.appendChild(row);
    }

    datedTasks.forEach(task => {
        let startT = todayTime; if (task.startDate) { const p = new Date(task.startDate).setHours(0, 0, 0, 0); if (!isNaN(p)) startT = p; }
        let dueT = startT; if (task.dueDate) { const p = new Date(task.dueDate).setHours(0, 0, 0, 0); if (!isNaN(p)) dueT = p; }
        if (dueT < startT) dueT = startT;
        const startIndex = Math.round((startT - startDay.getTime()) / 86400000);
        const duration = Math.round((dueT - startT) / 86400000) + 1;

        const row = document.createElement('div'); row.className = 'gantt-row'; row.dataset.assignee = task.assignee || '미지정';
        const label = document.createElement('div'); label.className = 'gantt-row-label';
        let statusIcon = task.status === 'todo' ? 'radio_button_unchecked' : (task.status === 'doing' ? 'pending' : 'check_circle');
        label.innerHTML = `<span class="material-symbols-rounded" style="font-size:1.1em; margin-right:4px;">${statusIcon}</span>`; label.appendChild(document.createTextNode(task.title)); label.dataset.tippyContent = task.title;

        const barArea = document.createElement('div'); barArea.className = 'gantt-bar-area'; barArea.style.width = `${timelineWidth}px`;
        const bar = document.createElement('div'); bar.className = 'gantt-bar'; bar.style.left = `${startIndex * 40}px`; bar.style.width = `${duration * 40}px`;
        bar.style.backgroundColor = task.priority === 'high' ? 'var(--danger)' : (task.priority === 'low' ? '#10B981' : '#F59E0B');
        if (task.status === 'done') bar.classList.add('task-done-style');
        bar.textContent = task.assignee || '미지정';

        // 마우스 오버 시 표시될 상세 툴팁(title) 추가
        let priorityLabel = task.priority === 'high' ? '높음' : (task.priority === 'low' ? '낮음' : '보통');
        let statusLabel = task.status === 'todo' ? '해야 할 일' : (task.status === 'doing' ? '진행 중' : '완료');
        let tooltipText = `[${statusLabel}] ${task.title}\n담당자: ${task.assignee || '미지정'}\n중요도: ${priorityLabel}\n일정: ${task.startDate || '미정'} ~ ${task.dueDate || '미정'}`;
        if (task.description) tooltipText += `\n상세: ${task.description}`;
        bar.dataset.tippyContent = tooltipText;

        bar.onclick = () => openModal(task.id, task.title, task.description, task.dueDate, task.startDate);
        barArea.appendChild(bar); row.appendChild(label); row.appendChild(barArea); body.appendChild(row);
    });

    // 외부 일정 렌더링
    datedExternal.forEach(task => {
        let startT = todayTime; if (task.startDate) { const p = new Date(task.startDate).setHours(0, 0, 0, 0); if (!isNaN(p)) startT = p; }
        let dueT = startT; if (task.dueDate) { const p = new Date(task.dueDate).setHours(0, 0, 0, 0); if (!isNaN(p)) dueT = p; }
        const startIndex = Math.round((startT - startDay.getTime()) / 86400000);
        const duration = Math.round((dueT - startT) / 86400000) + 1;

        const row = document.createElement('div'); row.className = 'gantt-row'; row.dataset.assignee = '외부 일정';
        const label = document.createElement('div'); label.className = 'gantt-row-label';
        label.innerHTML = `<span class="material-symbols-rounded" style="font-size:1.1em; margin-right:4px; color:#2DB400;">sync</span> ${escapeHTML(task.title)}`;
        label.dataset.tippyContent = task.title;

        const barArea = document.createElement('div'); barArea.className = 'gantt-bar-area'; barArea.style.width = `${timelineWidth}px`;
        const bar = document.createElement('div'); bar.className = 'gantt-bar';
        bar.style.left = `${startIndex * 40}px`; bar.style.width = `${duration * 40}px`;
        bar.style.backgroundColor = '#2DB400';
        bar.textContent = '외부 연동';
        bar.dataset.tippyContent = `${task.title}\n일정: ${task.startDate || '미정'} ~ ${task.dueDate || '미정'}\n상세: 구글/네이버 동기화 일정입니다.`;
        bar.onclick = () => showToast('외부 일정은 원본 앱에서 수정 가능합니다.', 'info');

        barArea.appendChild(bar); row.appendChild(label); row.appendChild(barArea); body.appendChild(row);
    });
}

function renderTasks() {
    ['todo-list', 'doing-list', 'done-list', 'week-list', 'month-list', 'later-list'].forEach(id => { if (document.getElementById(id)) document.getElementById(id).innerHTML = ''; });
    const tasksData = AppStore.getTasks();
    if (!tasksData) return;

    const priorityWeight = { 'high': 3, 'medium': 2, 'low': 1 };
    const tasksArray = Object.values(tasksData).sort((a, b) => {
        if (a.order !== undefined && b.order !== undefined) {
            if (a.order !== b.order) return a.order - b.order;
        } else if (a.order !== undefined) {
            return -1;
        } else if (b.order !== undefined) {
            return 1;
        }
        return (priorityWeight[b.priority] || 2) - (priorityWeight[a.priority] || 2);
    });
    const activeTasks = tasksArray.filter(t => t.type !== 'schedule');

    const progressFill = document.getElementById('progress-fill'), progressText = document.getElementById('progress-text');
    if (progressFill && progressText) {
        const p = activeTasks.length === 0 ? 0 : Math.round((activeTasks.filter(t => t.status === 'done').length / activeTasks.length) * 100);
        progressFill.style.width = p + '%'; progressText.textContent = p + '%';
    }

    const tripsObj = AppStore.getTrips() || {};
    const tripsArray = Object.keys(tripsObj).map(key => {
        const t = tripsObj[key];
        let htmlBadges = '';

        // 카테고리 배지 (칸반 보드용)
        const checkStr = t.category ? t.category : t.name;
        if (checkStr) {
            if (checkStr.includes('텔러스헬스')) htmlBadges += `<span style="font-size:0.75rem; background-color:#EFF6FF; color:#2563EB; padding:2px 4px; border-radius:4px; margin-left:4px; font-weight:bold; vertical-align:middle; border:1px solid #BFDBFE;">🏥 텔러스헬스</span>`;
            else if (checkStr.includes('휴노')) htmlBadges += `<span style="font-size:0.75rem; background-color:#F0FDF4; color:#16A34A; padding:2px 4px; border-radius:4px; margin-left:4px; font-weight:bold; vertical-align:middle; border:1px solid #BBF7D0;">🌿 휴노</span>`;
            else if (t.category && t.category.toUpperCase().startsWith('VIP')) htmlBadges += `<span style="font-size:0.75rem; background-color:#FFFBEB; color:#F59E0B; padding:2px 4px; border-radius:4px; margin-left:4px; font-weight:bold; vertical-align:middle; border:1px solid #FEF3C7;">⭐ VIP</span>`;
        }

        const parsed = typeof parseTripDateRange === 'function' ? parseTripDateRange(t.date) : { startDate: t.date, endDate: t.date };
        let s = parsed.startDate || t.date; let e = parsed.endDate || t.date;
        const prefix = t.status === '조율중' ? '[조율중]' : '[출장]';
        return { ...t, id: key, isTrip: true, title: `${prefix} ${t.name || t.destination}`, badgesHtml: htmlBadges, startDate: s, dueDate: e, status: 'todo' };
    });
    const leavesArray = Object.values(AppStore.getLeaves()).filter(l => l.status === 'approved').map(l => ({ id: l.id, uid: l.uid, isLeave: true, title: `[휴가] ${l.userName}`, assignee: l.userName, startDate: l.date, dueDate: l.date, status: 'todo', priority: 'medium' }));

    // 외부 일정 가져오기
    const externalArray = Object.values(AppStore.getExternalEvents()).map(e => ({ ...e, title: e.title ? e.title.replace(/🌐\s*/g, '') : e.title }));

    const combinedArray = [...tasksArray, ...tripsArray, ...leavesArray, ...externalArray];

    if (AppStore.getViewMode() === 'calendar') { renderCalendar(combinedArray); filterTasks(); return; }
    if (AppStore.getViewMode() === 'gantt') { renderGantt(combinedArray); filterTasks(); return; }

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(today); endOfWeek.setDate(today.getDate() + (6 - today.getDay()));
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    activeTasks.forEach(task => {
        const div = document.createElement('div'); div.className = 'task-card';
        if (task.title && task.title.includes('조율중')) div.className += ' task-tentative';
        // 마감 임박 (2일 이하 & 완료 안 된 업무) 경고 애니메이션 효과 추가
        if (task.dueDate && task.status !== 'done') {
            const taskDate = new Date(task.dueDate); taskDate.setHours(0, 0, 0, 0);
            const diffDays = Math.ceil((taskDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays <= 2) {
                div.className += ' deadline-warning';
            }
        }
        div.title = task.author ? `등록자: ${task.author}` : '';
        if (AppStore.getViewMode() === 'status') {
            // SortableJS가 드래그를 처리하므로 네이티브 HTML5 draggable 속성은 비활성화
        }
        div.onclick = (e) => { if (!e.target.closest('.delete-btn') && !e.target.closest('.archive-btn')) openModal(task.id, task.title, task.description, task.dueDate, task.startDate); };
        div.dataset.assignee = task.assignee || '미지정'; div.dataset.dueDate = task.dueDate || ''; div.dataset.taskId = task.id;

        let priorityLabel = task.priority === 'high' ? '높음' : (task.priority === 'low' ? '낮음' : '보통');
        let priorityColor = task.priority === 'high' ? '#EF4444' : (task.priority === 'low' ? '#10B981' : '#F59E0B');
        const descIcon = task.description ? '<span style="font-size: 0.75rem; margin-right: 6px; padding: 2px 4px; background-color: var(--col-bg); border-radius: 4px; color: var(--text-muted);">상세</span>' : '';
        let dueBadge = '';
        if (task.dueDate) {
            const taskDate = new Date(task.dueDate); taskDate.setHours(0, 0, 0, 0);
            const isOverdue = taskDate < today && task.status !== 'done';
            dueBadge = `<span style="font-size: 0.75rem; color: ${isOverdue ? 'var(--danger)' : 'var(--text-main)'}; font-weight: 600;">${isOverdue ? '마감지연' : '마감일'} ${escapeHTML(formatDateShort(task.dueDate))}</span>`;
        }

        const archiveBtnHtml = (task.status === 'done' && !task.isTrip && !task.isLeave) ? `<button class="archive-btn" onclick="archiveSingleTask(event, ${jsAttrArg(task.id)})" title="보관함으로 이동" style="padding:0.2rem; background:transparent; border:none; cursor:pointer; color:var(--text-muted);"><span class="material-symbols-rounded" style="font-size:1.1em;">inventory_2</span></button>` : '';
        const assigneeList = task.assignee ? task.assignee.split(',').map(a => a.trim()).filter(a => a) : ['미지정'];
        const assigneeHtml = assigneeList.map(a => `
            <div class="assignee-chip">
                <span class="material-symbols-rounded">person</span>
                ${escapeHTML(a)}
            </div>
        `).join('');

        div.innerHTML = `<div style="display: flex; flex-direction: column; gap: 0.5rem; width: 100%;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <span style="font-weight: 500; font-size: 0.95rem; word-break: break-all;">${escapeHTML(task.title)}${task.isTrip ? (task.badgesHtml || '') : ''}</span>
                <div style="display: flex; gap: 2px; flex-shrink: 0; margin-left: 0.5rem;">
                    ${archiveBtnHtml}
                    <button class="delete-btn" onclick="deleteTask(${jsAttrArg(task.id)})" title="삭제" style="padding:0.2rem;"><span class="material-symbols-rounded" style="font-size:1.1em;">close</span></button>
                </div>
            </div>
            ${(descIcon || dueBadge) ? `<div style="display: flex; align-items: center; margin-top: -0.2rem;">${descIcon}${dueBadge}</div>` : ''}
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem;">
                <div style="display: flex; flex-wrap: wrap; gap: 2px;">${assigneeHtml}</div>
                <span style="background-color: ${priorityColor}15; color: ${priorityColor}; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 600;">${priorityLabel}</span>
            </div>
        </div>`;

        if (AppStore.getViewMode() === 'status') { const el = document.getElementById(`${task.status}-list`); if (el) el.appendChild(div); }
        else {
            let targetList = 'later-list';
            if (task.dueDate) {
                const d = new Date(task.dueDate); d.setHours(0, 0, 0, 0);
                if (d <= endOfWeek) targetList = 'week-list'; else if (d <= endOfMonth) targetList = 'month-list';
            }
            const el = document.getElementById(targetList); if (el) el.appendChild(div);
        }
    });
    filterTasks();
    if (typeof generateAiBriefing === 'function') generateAiBriefing();

    // SortableJS 초기화 (칸반보드 순서 변경용)
    if (!window.kanbanSortables && AppStore.getViewMode() === 'status') {
        window.kanbanSortables = {};
        ['todo', 'doing', 'done'].forEach(status => {
            const el = document.getElementById(status + '-list');
            if (el) {
                window.kanbanSortables[status] = new Sortable(el, {
                    group: 'kanban',
                    animation: 150,
                    ghostClass: 'sortable-ghost',
                    delay: 150,
                    delayOnTouchOnly: true,
                    onEnd: async function (evt) {
                        const taskId = evt.item.dataset.taskId;
                        const newStatus = evt.to.id.replace('-list', '');
                        
                        const updates = {};
                        if (taskId) {
                            updates[`${taskId}/status`] = newStatus;
                        }
                        
                        // 새로운 위치의 컬럼 내 모든 카드의 order를 인덱스 기반으로 갱신
                        Array.from(evt.to.children).forEach((child, index) => {
                            const id = child.dataset.taskId;
                            if (id) {
                                updates[`${id}/order`] = index;
                            }
                        });
                        
                        try {
                            if (!(await checkAuth('수정 권한이 없습니다.'))) {
                                renderTasks(); // 권한 없으면 UI 원상복구
                                return;
                            }
                            await db.ref('tasks').update(updates);
                        } catch (e) {
                            console.error(e);
                            renderTasks();
                        }
                    }
                });
            }
        });
    }
}

window.startTasksTodoListener = function() { console.log('STARTING TASKS TODO LISTENER');
    window.AppSubscriptionManager.subscribe('tasks_todo', db.ref('tasks').orderByChild('status').equalTo('todo'), (s) => {
        const data = s.val() || {};
        AppStore.mergeTasks(data, 'todo');
    });
};


window.startTasksDoingListener = function() {
    window.AppSubscriptionManager.subscribe('tasks_doing', db.ref('tasks').orderByChild('status').equalTo('doing'), (s) => {
        const data = s.val() || {};
        AppStore.mergeTasks(data, 'doing');
    });
};


window.startTasksDoneListener = function() {
    window.AppSubscriptionManager.subscribe('tasks_done', db.ref('tasks').orderByChild('status').equalTo('done').limitToLast(50), (s) => {
        const data = s.val() || {};
        AppStore.mergeTasks(data, 'done');
    });
};


// ----------------------------------------------------
// 보관함 (Archive) 기능
// ----------------------------------------------------

async function archiveSingleTask(e, id) {
    e.stopPropagation();
    if (await customConfirm('이 작업을 보관함으로 이동할까요?')) {
        db.ref('tasks/' + id).update({ status: 'archived' })
            .then(() => showToast('작업이 보관함으로 이동되었습니다.', 'info'))
            .catch(async (error) => await customAlert("보관 실패: " + error.message));
    }
}

async function archiveAllDoneTasks() {
    if (!(await checkAuth('승인된 사용자만 상태를 변경할 수 있습니다.'))) return;
    const doneList = document.getElementById('done-list');
    if (!doneList || doneList.children.length === 0) return showToast('보관할 완료된 작업이 없습니다.', 'info');

    if (await customConfirm('현재 완료된 모든 작업을 보관함으로 이동할까요?')) {
        const tasks = AppStore.getTasks();
        const updates = {};
        let count = 0;
        Object.values(tasks).forEach(t => {
            if (t.status === 'done') {
                updates[t.id + '/status'] = 'archived';
                count++;
            }
        });
        if (count > 0) {
            db.ref('tasks').update(updates)
                .then(() => showToast(`${count}개의 작업이 보관함으로 이동되었습니다.`, 'info'))
                .catch(async (error) => await customAlert("보관 실패: " + error.message));
        }
    }
}

function openArchiveModal() {
    document.getElementById('archiveModal').style.display = 'flex';
    const listEl = document.getElementById('archived-task-list');
    listEl.innerHTML = '<li style="justify-content:center; color:var(--text-muted);">불러오는 중...</li>';

    // archived 상태인 작업들을 가져옵니다. (최신 100개 제한)
    db.ref('tasks').orderByChild('status').equalTo('archived').limitToLast(100).once('value', (s) => {
        listEl.innerHTML = '';
        const data = s.val() || {};
        const archivedArray = Object.values(data).sort((a, b) => {
            // 마감일이 있으면 마감일 순, 없으면 키(id) 순으로 대략 정렬
            if (a.dueDate && b.dueDate) return new Date(b.dueDate) - new Date(a.dueDate);
            return 0;
        });

        if (archivedArray.length === 0) {
            listEl.innerHTML = '<li style="justify-content:center; color:var(--text-muted);">보관된 작업이 없습니다.</li>';
            return;
        }

        archivedArray.forEach(task => {
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';
            li.style.padding = '0.8rem';
            li.style.borderBottom = '1px dashed var(--border-color)';

            li.innerHTML = `
                <div style="flex:1; cursor:pointer;" onclick="openModal(${jsAttrArg(task.id)}, ${jsAttrArg(task.title)}, ${jsAttrArg(task.description || '')}, ${jsAttrArg(task.dueDate || '')}, ${jsAttrArg(task.startDate || '')})">
                    <div style="font-weight:600; color:var(--text-main);">${escapeHTML(task.title)}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.2rem;">담당: ${escapeHTML(task.assignee || '미지정')} | 마감: ${escapeHTML(task.dueDate ? formatDateShort(task.dueDate) : '미정')}</div>
                </div>
                <div style="display:flex; gap:0.5rem; flex-shrink:0;">
                    <button onclick="restoreArchivedTask(${jsAttrArg(task.id)})" title="칸반보드 완료 컬럼으로 복구" style="background:var(--col-bg); color:var(--primary); border:1px solid var(--border-color); padding:0.3rem 0.6rem; font-size:0.8rem;"><span class="material-symbols-rounded" style="font-size:1.1em; vertical-align:middle;">restore</span> 복구</button>
                    <button onclick="deleteArchivedTask(${jsAttrArg(task.id)})" title="영구 삭제" style="background:var(--danger); padding:0.3rem 0.6rem; font-size:0.8rem;"><span class="material-symbols-rounded" style="font-size:1.1em; vertical-align:middle;">delete</span> 삭제</button>
                </div>
            `;
            listEl.appendChild(li);
        });
    });
}

function closeArchiveModal() {
    document.getElementById('archiveModal').style.display = 'none';
}

async function restoreArchivedTask(id) {
    if (!(await checkAuth('승인된 사용자만 복구할 수 있습니다.'))) return;
    db.ref('tasks/' + id).update({ status: 'done' }).then(() => {
        showToast('작업이 복구되었습니다.', 'info');
        openArchiveModal(); // 목록 새로고침
    }).catch(async (error) => await customAlert("복구 실패: " + error.message));
}

async function deleteArchivedTask(id) {
    if (!(await checkAuth('승인된 사용자만 삭제할 수 있습니다.'))) return;
    if (await customConfirm('이 작업을 영구적으로 삭제하시겠습니까? (이 작업은 되돌릴 수 없습니다)')) {
        db.ref('tasks/' + id).remove().then(() => {
            showToast('작업이 영구 삭제되었습니다.', 'info');
            openArchiveModal(); // 목록 새로고침
        }).catch(async (error) => await customAlert("삭제 실패: " + error.message));
    }
}

// ----------------------------------------------------
// 데일리 루틴 (Daily Tasks) 기능
// ----------------------------------------------------

async function addDailyTask() {
    const input = document.getElementById('dailyTaskInput');
    const title = input.value.trim();
    if (!(await checkAuth())) return;
    if (!title) return await customAlert('데일리 업무 내용을 입력해주세요.');

    const newRef = db.ref('tasks/dailyRoutine/settings').push();
    newRef.set({ id: newRef.key, title: title, createdAt: Date.now() })
        .then(() => { input.value = ''; })
        .catch(async error => await customAlert("추가 실패: " + error.message));
}

async function deleteDailyTask(id) {
    if (!(await checkAuth())) return;
    if (await customConfirm('이 데일리 업무 설정을 삭제하시겠습니까?')) {
        db.ref('tasks/dailyRoutine/settings/' + id).remove();
    }
}

async function toggleDailyTask(taskId) {
    if (!(await checkAuth())) return;
    const today = getTodayStr();
    const isCompleted = AppStore.getDailyLogs()[taskId] === true;

    db.ref(`tasks/dailyRoutine/logs/${today}/${taskId}`).set(isCompleted ? null : true)
        .catch(async error => await customAlert("상태 변경 실패: " + error.message));
}

function renderDailyTasks() {
    const listEl = document.getElementById('daily-task-list');
    const progressEl = document.getElementById('daily-progress-text');
    if (!listEl) return;

    const tasks = AppStore.getDailyTasks();
    const logs = AppStore.getDailyLogs();
    const tasksArray = Object.values(tasks).sort((a, b) => a.createdAt - b.createdAt);

    listEl.innerHTML = '';
    let completedCount = 0;

    tasksArray.forEach(task => {
        const isDone = logs[task.id] === true;
        if (isDone) completedCount++;

        const div = document.createElement('div');
        div.className = `daily-item ${isDone ? 'completed' : ''}`;
        div.innerHTML = `
            <div class="daily-checkbox" onclick="toggleDailyTask(${jsAttrArg(task.id)})">
                ${isDone ? '<span class="material-symbols-rounded" style="font-size:1.2rem;">check</span>' : ''}
            </div>
            <div class="daily-title" onclick="toggleDailyTask(${jsAttrArg(task.id)})">${escapeHTML(task.title)}</div>
            <button class="daily-delete-btn" onclick="deleteDailyTask(${jsAttrArg(task.id)})">
                <span class="material-symbols-rounded" style="font-size:1.1rem;">delete</span>
            </button>
        `;
        listEl.appendChild(div);
    });

    const total = tasksArray.length;
    const percent = total === 0 ? 0 : Math.round((completedCount / total) * 100);
    if (progressEl) {
        progressEl.textContent = `오늘 완료: ${completedCount}/${total} (${percent}%)`;
    }
}

// 리스너 설정
window.startDailyRoutineSettingsListener = function() {
    window.AppSubscriptionManager.subscribe('dailyTasks', db.ref('tasks/dailyRoutine/settings'), (s) => {
        AppStore.setDailyTasks(s.val() || {});
    });

};

const todayStr = getTodayStr();
window.startDailyRoutineLogsListener = function() {
    window.AppSubscriptionManager.subscribe('dailyLogs', db.ref(`tasks/dailyRoutine/logs/${todayStr}`), (s) => {
        AppStore.setDailyLogs(s.val() || {});
    });
};

// 엔터키 처리
document.getElementById('dailyTaskInput')?.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        if (e.isComposing) return;
        addDailyTask();
    }
});

// ----------------------------------------------------
// 담당자 태그 관리
// ----------------------------------------------------
function addAssigneeTag(selectEl) {
    const val = selectEl.value;
    if (val && !selectedAssignees.includes(val)) {
        selectedAssignees.push(val);
        renderAssigneeTags();
    }
    selectEl.value = '';
}

function removeAssigneeTag(name) {
    selectedAssignees = selectedAssignees.filter(a => a !== name);
    renderAssigneeTags();
}

function renderAssigneeTags() {
    const container = document.getElementById('assignee-tags-container');
    if (!container) return;

    // 기존 태그 제거 (select 엘리먼트와 라벨은 제외)
    container.querySelectorAll('.assignee-tag').forEach(t => t.remove());

    const selectEl = document.getElementById('assigneeInput');

    selectedAssignees.forEach(name => {
        const tag = document.createElement('div');
        tag.className = 'assignee-tag';
        tag.style = 'display:flex; align-items:center; gap:4px; background:var(--primary); color:white; padding:2px 8px; border-radius:var(--radius); font-size:0.8rem; font-weight:600; margin: 2px 0;';
        tag.innerHTML = `${escapeHTML(name)} <span class="material-symbols-rounded" style="font-size:1rem; cursor:pointer;" onclick="removeAssigneeTag(${jsAttrArg(name)})">close</span>`;
        container.insertBefore(tag, selectEl);
    });
}

// 모달용 담당자 태그 관리
function addModalAssigneeTag(selectEl) {
    const val = selectEl.value;
    if (val && !modalSelectedAssignees.includes(val)) {
        modalSelectedAssignees.push(val);
        renderModalAssigneeTags();
    }
    selectEl.value = '';
}

function removeModalAssigneeTag(name) {
    modalSelectedAssignees = modalSelectedAssignees.filter(a => a !== name);
    renderModalAssigneeTags();
}

function renderModalAssigneeTags() {
    const container = document.getElementById('modal-assignee-tags-container');
    if (!container) return;

    container.querySelectorAll('.assignee-tag').forEach(t => t.remove());
    const selectEl = document.getElementById('modalAssigneeInput');

    modalSelectedAssignees.forEach(name => {
        const tag = document.createElement('div');
        tag.className = 'assignee-tag';
        tag.style = 'display:flex; align-items:center; gap:4px; background:var(--primary); color:white; padding:2px 8px; border-radius:var(--radius); font-size:0.8rem; font-weight:600; margin: 2px 0;';
        tag.innerHTML = `${escapeHTML(name)} <span class="material-symbols-rounded" style="font-size:1rem; cursor:pointer;" onclick="removeModalAssigneeTag(${jsAttrArg(name)})">close</span>`;
        container.insertBefore(tag, selectEl);
    });
}

let isGeneratingBriefing = false;
let pendingBriefing = false;
async function generateAiBriefing() {
    const userProfile = AppStore.getCurrentUser();
    const container = document.getElementById('ai-briefing-container');
    const textEl = document.getElementById('briefing-text');
    // 미승인 사용자는 업무 데이터 접근 권한이 없으므로 브리핑을 만들지 않는다 (규칙에 막히는 조회 방지)
    if (!userProfile || !userProfile.approved || !container || !textEl) {
        if (container) container.style.display = 'none';
        return;
    }

    if (isGeneratingBriefing) {
        pendingBriefing = true;
        return;
    }
    isGeneratingBriefing = true;

    try {
        container.style.display = 'block';

        const userNameLower = userProfile.displayName.toLowerCase();
        // 한국어 3글자 이름인 경우 성을 제외한 이름만 추출 (예: 이동현 -> 동현)
        let userNameShort = userNameLower;
        if (/^[가-힣]{3}$/.test(userProfile.displayName)) {
            userNameShort = userProfile.displayName.substring(1).toLowerCase();
        }

        const checkMatch = (str) => {
            if (!str) return false;
            const lowerStr = str.toLowerCase();
            let isMatch = lowerStr.includes(userNameLower) || lowerStr.includes(userNameShort) || textMentionsMember(str, userProfile.displayName);
            if (userNameLower === 'min suk kim' && (lowerStr.includes('대장') || lowerStr.includes('min suk kim'))) {
                isMatch = true;
            }
            if ((userNameLower === 'sungjin j' || userNameLower === '장성진') && (lowerStr.includes('성진') || lowerStr.includes('장성진') || lowerStr.includes('sungjin j'))) {
                isMatch = true;
            }
            if ((userNameLower === 'hong min' || userNameLower === '민홍') && (textMentionsMember(str, '민홍') || lowerStr.includes('hong min'))) {
                isMatch = true;
            }
            return isMatch;
        };

        const tasks = Object.values(AppStore.getTasks());
        // 제목이나 설명이 아닌 실제 담당자(assignee)에 포함되어 있을 때만 내 업무로 산정
        const myTasks = tasks.filter(t => checkMatch(t.assignee));
        const activeTasks = myTasks.filter(t => t.status === 'todo' || t.status === 'doing');

        const todayStr = getTodayStr();
        const todayTasks = activeTasks.filter(t => t.dueDate === todayStr);
        const overdueTasks = activeTasks.filter(t => t.dueDate && t.dueDate < todayStr);

        const trips = Object.values(AppStore.getTrips() || {});
        const myTrips = trips.filter(t => checkMatch(t.assignee) || checkMatch(t.name) || checkMatch(t.destination) || checkMatch(t.reason));
        
        const externalEvents = Object.values(AppStore.getExternalEvents() || {});
        const myExternalEvents = externalEvents.filter(e => checkMatch(e.title) || checkMatch(e.description)).map(e => ({
            ...e,
            date: (e.startDate && e.dueDate && e.startDate !== e.dueDate) ? `${e.startDate} ~ ${e.dueDate}` : (e.startDate || e.dueDate),
            name: e.title ? e.title.replace(/🌐\s*/g, '') : '일정'
        }));
        
        // 내 일정 포함
        const allMyTrips = [...myTrips, ...myExternalEvents];
        const upcomingTrips = allMyTrips.filter(t => {
            const targetDate = t.date || t.dueDate || t.startDate;
            if (!targetDate) return false;
            const parsed = typeof parseTripDateRange === 'function' ? parseTripDateRange(targetDate) : { endDate: targetDate };
            return parsed.endDate >= todayStr;
        }).sort((a, b) => {
            const dateA = typeof parseTripDateRange === 'function' ? parseTripDateRange(a.date || a.dueDate || a.startDate).startDate : (a.date || a.dueDate || a.startDate);
            const dateB = typeof parseTripDateRange === 'function' ? parseTripDateRange(b.date || b.dueDate || b.startDate).startDate : (b.date || b.dueDate || b.startDate);
            return dateA.localeCompare(dateB); // 다가오는 일정이 위로 오도록 오름차순 정렬
        });
        
        window.currentBriefingTrips = upcomingTrips;

        let used = 0;
        const myLeaves = Object.values(AppStore.getLeaves()).filter(l => l.uid === auth.currentUser.uid);
        myLeaves.forEach(l => { if (l.status === 'approved' || l.status === 'pending' || l.status === 'cancel_requested') used += l.type; });
        const remainLeaves = (window.parseTotalLeave(userProfile) - used).toFixed(1);

        let comms = [];
        try {
            const commSnap = await db.ref('businessCommunications').orderByChild('timestamp').limitToLast(5).once('value');
            if (commSnap.exists()) {
                comms = Object.values(commSnap.val()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            }
        } catch (commErr) {
            console.error('업무 소통 요약 로드 중 에러:', commErr);
        }

        let htmlContent = `
            <div style="font-size: 0.92rem; line-height: 1.7; color: var(--text-main);">
                <p style="margin-bottom: 0.8rem; font-size: 1.02rem;">
                    안녕하세요, <strong style="color: var(--primary); font-weight: 700;">${escapeHTML(userProfile.displayName)}</strong>님! 오늘 하루도 스마트한 업무 협업을 위한 핵심 요약을 전해드립니다.
                </p>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 0.8rem;">
                    <div style="background: rgba(79, 70, 229, 0.05); padding: 12px 16px; border-radius: var(--radius); border: 1px solid rgba(79, 70, 229, 0.1); cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='rgba(79, 70, 229, 0.1)'" onmouseout="this.style.background='rgba(79, 70, 229, 0.05)'" onclick="document.getElementById('searchAssignee').value = ${jsAttrArg(userNameShort)}; if(typeof filterTasks === 'function') { filterTasks(); if(typeof closeCommonCalendarModal === 'function') closeCommonCalendarModal(); }">
                        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-weight: 700; font-size: 0.85rem; color: var(--primary);">
                            <span class="material-symbols-rounded" style="font-size: 1.15rem;">task_alt</span> 내 할당 업무
                        </div>
                        <div style="font-size: 0.88rem; font-weight: 600;">
                            진행 중인 업무 <span style="color: var(--primary);">${activeTasks.length}</span>건 
                            ${todayTasks.length > 0 ? `<br><span style="color: var(--danger); font-size: 0.8rem; display: inline-flex; align-items: center; gap: 2px;">⏰ 오늘 마감 ${todayTasks.length}건</span>` : ''}
                            ${overdueTasks.length > 0 ? `<br><span style="color: var(--danger); font-size: 0.8rem; display: inline-flex; align-items: center; gap: 2px;">⚠️ 마감 지연 ${overdueTasks.length}건</span>` : ''}
                        </div>
                    </div>
                    <div style="background: rgba(139, 92, 246, 0.05); padding: 12px 16px; border-radius: var(--radius); border: 1px solid rgba(139, 92, 246, 0.1); cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='rgba(139, 92, 246, 0.1)'" onmouseout="this.style.background='rgba(139, 92, 246, 0.05)'" onclick="if(typeof showBriefingTrips === 'function') showBriefingTrips();">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                            <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 0.85rem; color: #8B5CF6;">
                                <span class="material-symbols-rounded" style="font-size: 1.15rem;">flight_takeoff</span> 다가오는 연동 일정
                            </div>
                            <span class="material-symbols-rounded" style="font-size: 1.1rem; color: #8B5CF6; opacity: 0.7;">open_in_new</span>
                        </div>
                        <div style="font-size: 0.88rem; font-weight: 600;">
                            ${upcomingTrips.length > 0 ? `앞으로 <span style="color: #8B5CF6;">${upcomingTrips.length}</span>건의 일정이 있습니다.<br><span style="font-size: 0.8rem; color: var(--text-muted); font-weight: normal;">• 다음 일정: ${escapeHTML(formatDateText(upcomingTrips[0].date))} ${escapeHTML(upcomingTrips[0].name)}</span>` : '예정된 연동 일정이 없습니다.'}
                        </div>
                    </div>
                    <div style="background: rgba(16, 185, 129, 0.05); padding: 12px 16px; border-radius: var(--radius); border: 1px solid rgba(16, 185, 129, 0.1);">
                        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-weight: 700; font-size: 0.85rem; color: #10B981;">
                            <span class="material-symbols-rounded" style="font-size: 1.15rem;">beach_access</span> 연차 사용 현황
                        </div>
                        <div style="font-size: 0.88rem; font-weight: 600;">
                            올해 잔여 연차: <span style="color: #10B981;">${remainLeaves}</span>일<br>
                            <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: normal;">• 총 ${window.parseTotalLeave(userProfile)}일 중 ${used.toFixed(1)}일 사용</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        textEl.innerHTML = htmlContent;
    } catch (e) {
        console.error('브리핑 생성 중 에러:', e);
        textEl.textContent = '브리핑 정보 로드 중 에러가 발생했습니다.';
    } finally {
        isGeneratingBriefing = false;
        if (pendingBriefing) {
            pendingBriefing = false;
            generateAiBriefing();
        }
        if(typeof renderTeamStatusSidebar === 'function') renderTeamStatusSidebar();
    }
}

function toggleBriefingContent() {
    const card = document.querySelector('.briefing-card');
    if (card) {
        card.classList.toggle('collapsed');
    }
}

// 윈도우 창 크기 변경 시 PC일반형 vs 모바일반응형 뱃지 자동 전환
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (typeof renderTabCalendar === 'function') renderTabCalendar();
    }, 150);
});

window.handleTripVehicleToggle = async function(idx, val, event) {
    if (event) event.stopPropagation();
    
    if (typeof db === 'undefined' || !db) {
        if (typeof showToast === 'function') showToast('데이터베이스에 연결할 수 없습니다.', 'error');
        return;
    }
    
    const trip = window.currentDisplayTrips ? window.currentDisplayTrips[idx] : null;
    
    if (!trip || !trip.id) {
        if (typeof showToast === 'function') showToast('일정의 고유 ID를 찾을 수 없습니다.', 'error');
        return;
    }
    
    // UI 즉각 반영 (Snappy UX)
    const globalVehicles = AppStore.getTripVehicles ? AppStore.getTripVehicles() : {};
    globalVehicles[trip.id] = val;
    if (AppStore.setTripVehicles) AppStore.setTripVehicles(globalVehicles);
    
    let currentMode = 'my';
    const teamBtn = document.getElementById('btnTeamTrips');
    const coupangBtn = document.getElementById('btnCoupangTrips');
    if (teamBtn && teamBtn.style.background === 'var(--primary)') currentMode = 'team';
    else if (coupangBtn && coupangBtn.style.background === 'var(--primary)') currentMode = 'coupang';
    if (typeof showBriefingTrips === 'function') showBriefingTrips(currentMode);
    
    try {
        await db.ref('tripVehicles/' + trip.id).set(val);
        if (typeof showToast === 'function') showToast('해당 일정의 호차가 변경되어 전체 팀원에게 공유되었습니다.', 'success');
    } catch(e) {
        console.error(e);
        if (typeof showToast === 'function') showToast('호차 변경 중 오류 발생: ' + e.message, 'error');
    }
};

window.showBriefingTrips = function(mode = 'my') {
    const modal = document.getElementById('briefingTripsModal');
    const listEl = document.getElementById('briefingTripsList');
    if (!modal || !listEl) return;
    
    // 탭 스타일 업데이트
    const btnMy = document.getElementById('btnMyTrips');
    const btnTeam = document.getElementById('btnTeamTrips');
    const btnCoupang = document.getElementById('btnCoupangTrips');
    
    const setTabStyle = (btn, isActive) => {
        if (!btn) return;
        if (isActive) {
            btn.style.background = 'var(--primary)';
            btn.style.color = 'white';
            btn.style.borderColor = 'var(--primary)';
        } else {
            btn.style.background = 'transparent';
            btn.style.color = 'var(--text-main)';
            btn.style.borderColor = 'var(--border-color)';
        }
    };
    
    setTabStyle(btnMy, mode === 'my');
    setTabStyle(btnTeam, mode === 'team');
    setTabStyle(btnCoupang, mode === 'coupang');
    
    listEl.innerHTML = '';
    const todayStr = getTodayStr();
    let displayTrips = [];
    
    const externalEvents = AppStore.getExternalEvents ? Object.values(AppStore.getExternalEvents() || {}) : [];
    const businessTrips = AppStore.getTrips ? Object.values(AppStore.getTrips() || {}) : [];
    const uniqueTripsMap = new Map();
    
    externalEvents.forEach(e => {
        const rawTitle = e.title ? e.title.replace(/^\[출장\]\s*/, '').replace(/🌐\s*/g, '').trim() : '(제목 없음)';
        const targetDate = e.startDate || e.dueDate || '';
        if (!targetDate) return;
        
        let matchedCategory = null;
        let matchedAssignee = null;
        businessTrips.forEach(bt => {
            const btDateStr = String(bt.date || bt.startDate || '');
            if (btDateStr === targetDate || btDateStr.includes(targetDate) || targetDate.includes(btDateStr.split(' to ')[0])) {
                const cleanBtName = (bt.name || '').replace(/◆\s*휴노/g, '').replace(/\[텔러스헬스\]/g, '').replace(/\[텔러스\]/g, '').replace(/^\[출장\]\s*/, '').trim();
                const cleanRawTitle = rawTitle.replace(/◆\s*휴노/g, '').replace(/\[텔러스헬스\]/g, '').replace(/\[텔러스\]/g, '').trim();
                if (cleanBtName && cleanRawTitle && (cleanBtName === cleanRawTitle || cleanBtName.includes(cleanRawTitle) || cleanRawTitle.includes(cleanBtName))) {
                    if (bt.category) matchedCategory = bt.category;
                    if (bt.assignee) matchedAssignee = bt.assignee;
                }
            }
        });
        
        const uniqueKey = targetDate + '_' + rawTitle;
        if (!uniqueTripsMap.has(uniqueKey)) {
            uniqueTripsMap.set(uniqueKey, {
                ...e,
                name: rawTitle,
                category: matchedCategory,
                assignee: matchedAssignee || e.assignee || e.creator || '',
                date: (e.startDate && e.dueDate && e.startDate !== e.dueDate) ? `${e.startDate} to ${e.dueDate}` : targetDate
            });
        }
    });
    
    const allTrips = Array.from(uniqueTripsMap.values());
    displayTrips = allTrips.filter(t => {
        const targetDate = t.date || t.dueDate || t.startDate;
        if (!targetDate) return false;
        
        const rawTitle = t.name || t.title || '';
        const rawDesc = t.description || '';
        if (rawTitle.includes('휴가')) return false;
        
        if (mode === 'coupang') {
            if (!rawTitle.includes('쿠팡')) return false;
        } else if (mode === 'my') {
            const currentUser = AppStore.getCurrentUser();
            if (!currentUser) return false;
            const userNameLower = currentUser.displayName.toLowerCase();
            let userNameShort = userNameLower;
            if (/^[가-힣]{3}$/.test(currentUser.displayName)) {
                userNameShort = currentUser.displayName.substring(1).toLowerCase();
            }
            
            const checkMatch = (str) => {
                if (!str) return false;
                const lowerStr = str.toLowerCase();
                let isMatch = lowerStr.includes(userNameLower) || lowerStr.includes(userNameShort) || textMentionsMember(str, currentUser.displayName);
                if (userNameLower === 'min suk kim' && (lowerStr.includes('대장') || lowerStr.includes('min suk kim'))) {
                    isMatch = true;
                }
                if ((userNameLower === 'sungjin j' || userNameLower === '장성진') && (lowerStr.includes('성진') || lowerStr.includes('장성진') || lowerStr.includes('sungjin j'))) {
                    isMatch = true;
                }
                if ((userNameLower === 'hong min' || userNameLower === '민홍') && (textMentionsMember(str, '민홍') || lowerStr.includes('hong min'))) {
                    isMatch = true;
                }
                return isMatch;
            };
            
            // 이름이 제목, 설명, 담당자 중 하나에라도 있으면 포함!
            if (!checkMatch(rawTitle) && !checkMatch(rawDesc) && !checkMatch(t.assignee)) {
                return false;
            }
        } else {
            // team 모드
            if (rawTitle.includes('쿠팡')) return false;
        }
        
        const parsed = typeof parseTripDateRange === 'function' ? parseTripDateRange(targetDate) : { endDate: targetDate };
        return parsed.endDate >= todayStr;
    }).sort((a, b) => {
        const dateA = typeof parseTripDateRange === 'function' ? parseTripDateRange(a.date || a.dueDate || a.startDate).startDate : String(a.date || a.dueDate || a.startDate || '');
        const dateB = typeof parseTripDateRange === 'function' ? parseTripDateRange(b.date || b.dueDate || b.startDate).startDate : String(b.date || b.dueDate || b.startDate || '');
        return dateA.localeCompare(dateB);
    });
    
    if (displayTrips.length === 0) {
        listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">다가오는 일정이 없습니다.</div>';
        } else {
            const parseTripData = (t) => {
                const rawTitle = t.name || t.title || '';
                const rawDesc = t.description || '';
                
                let company = '기타';
                let bgColor = '#ffffff';
                let rawLocation = rawTitle;
                let assignees = t.assignee || t.creator || '';
                let vehicle = '';
                if (t.description) {
                    const assigneeMatch = t.description.match(/담당자:\s*([^\n]+)/);
                    if (assigneeMatch) assignees += ' ' + assigneeMatch[1].trim();
                }
                const fullCheckStr = ((t.category || '') + ' ' + rawTitle + ' ' + rawDesc).toLowerCase();
                
                if (fullCheckStr.includes('휴노')) {
                    company = '휴노';
                    bgColor = '#FCE4EC';
                } else if (fullCheckStr.includes('텔러스헬스') || fullCheckStr.includes('텔러스')) {
                    company = '텔러스';
                    bgColor = '#E8F5E9';
                } else if (fullCheckStr.includes('강의') || fullCheckStr.includes('교육')) {
                    company = '강의';
                    bgColor = '#FFF3E0';
                } else if (fullCheckStr.includes('쿠팡')) {
                    company = '쿠팡';
                    bgColor = '#E3F2FD';
                } else if (t.category && t.category !== '기타' && !t.category.startsWith('VIP')) {
                    company = t.category;
                    bgColor = '#F3F4F6';
                }
                let allMembers = Object.values(AppStore.getUsers() || {}).map(u => u.displayName).filter(Boolean);
                // DB에 저장된 이름이 영문이거나 달라서 매칭이 안되는 경우를 방지하기 위해 필수 한글 이름들을 무조건 포함
                const fallbackMembers = ['박지희', '김동현', '이채이', '류재진', '김강현', '이동휘', '장성진', 'min suk kim'];
                allMembers = [...new Set([...allMembers, ...fallbackMembers])];
                
                // 외부 인물(예: 민재, 재연)이 사내 직원으로 등록되어 오작동하는 것을 원천 차단
                allMembers = allMembers.filter(name => !name.includes('민재') && !name.includes('재연'));
                const searchStr = rawTitle.toLowerCase();
                const originalSearchStr = rawTitle;
                let foundAssigneesMap = [];
                
                allMembers.forEach(fullName => {
                    const shortName = fullName.length >= 3 ? fullName.substring(1) : fullName;
                    let idx = memberMentionIndex(originalSearchStr, fullName); // 2글자 이름의 한 글자는 독립 단어일 때만
                    if (idx === -1 && !/^[가-힣]+$/.test(fullName)) idx = originalSearchStr.indexOf(shortName); // 한글 이외 이름은 기존 방식 유지
                    
                    if (idx !== -1) {
                        if (!foundAssigneesMap.find(x => x.name === shortName)) {
                            foundAssigneesMap.push({ name: shortName, index: idx, fullName: fullName });
                        }
                    }
                });
                
                let idxM = searchStr.indexOf('min suk kim');
                if (idxM === -1) idxM = searchStr.indexOf('대장');
                if (idxM !== -1 && !foundAssigneesMap.find(x => x.name === '대장')) foundAssigneesMap.push({ name: '대장', index: idxM, fullName: 'min suk kim' });
                
                let idxS = searchStr.indexOf('sungjin j');
                if (idxS === -1) idxS = searchStr.indexOf('장성진');
                if (idxS === -1) idxS = searchStr.indexOf('성진');
                if (idxS !== -1 && !foundAssigneesMap.find(x => x.name === '성진')) foundAssigneesMap.push({ name: '성진', index: idxS, fullName: '장성진' });
                
                let idxH = searchStr.indexOf('hong min');
                if (idxH === -1) idxH = searchStr.indexOf('민홍');
                if (idxH === -1) idxH = memberMentionIndex(rawTitle, '민홍');
                if (idxH !== -1 && !foundAssigneesMap.find(x => x.name === '민홍')) foundAssigneesMap.push({ name: '민홍', index: idxH, fullName: '민홍' });
                
                foundAssigneesMap.sort((a, b) => a.index - b.index);
                let foundAssignees = foundAssigneesMap.map(x => x.name);
                
                if (foundAssignees.length > 0) {
                    assignees = (mode === 'team') ? foundAssignees.join(', ') : foundAssignees.join(' / ');
                } else if (mode === 'my') {
                    const currentUser = AppStore.getCurrentUser() || window.userProfile;
                    if (currentUser && currentUser.displayName) {
                        const myName = currentUser.displayName;
                        assignees = myName.length >= 3 ? myName.substring(1) : myName;
                    } else {
                        assignees = '-';
                    }
                } else {
                    assignees = '-';
                }
                
                // Clean up location (only remove exact matches of names to prevent corrupting locations)
                rawLocation = rawTitle;
                rawLocation = rawLocation.replace(/◆\s*휴노/g, '')
                                         .replace(/\[텔러스헬스\]/g, '')
                                         .replace(/\[텔러스\]/g, '')
                                         .replace(/\[강의\]/g, '')
                                         .replace(/\[교육\]/g, '')
                                         .replace(/\[쿠팡\]/g, '')
                                         .replace(/^\[.*?\]\s*/, '')
                                         .replace(/^출장\s*/, '');
                                         
                foundAssigneesMap.forEach(item => {
                    if (item.fullName) {
                        rawLocation = rawLocation.replace(new RegExp(item.fullName, 'g'), '');
                    }
                    rawLocation = rawLocation.replace(new RegExp('\\\\(' + item.name + '\\\\)', 'g'), '')
                                             .replace(new RegExp(item.name + '\\\\s*2명', 'g'), '')
                                             .replace(new RegExp(item.name + '\\\\s*3명', 'g'), '')
                                             .replace(new RegExp(item.name + '\\\\(여\\\\)', 'g'), '')
                                             .replace(new RegExp(item.name, 'g'), '');
                });
                
                // 1. Clean up punctuation inside parentheses
                rawLocation = rawLocation.replace(/\(\s*[,/]+\s*/g, '(') 
                                         .replace(/\s*[,/]+\s*\)/g, ')') 
                                         .replace(/\(\s*\)/g, '');
                                         
                // 2. Remove unclosed trailing parentheses containing only Korean, English, slashes, commas, spaces
                rawLocation = rawLocation.replace(/\([\s가-힣a-zA-Z,/]*$/, '');
                
                // 3. Remove trailing punctuation
                rawLocation = rawLocation.replace(/[(),\/\\.?\-\s]+$/, '').trim();
                
                rawLocation = rawLocation.replace(/◆\s*휴노/g, '')
                                         .replace(/\[텔러스헬스\]/g, '')
                                         .replace(/\[텔러스\]/g, '')
                                         .replace(/\[출장\]/g, '')
                                         .replace(/\[\d{1,2}:\d{2}\]/g, '')
                                         .replace(/텔러스헬스/g, '')
                                         .replace(/텔러스/g, '')
                                         .replace(/휴노/g, '')
                                         .trim();
                                         
                // One final trailing punctuation check after word removals
                rawLocation = rawLocation.replace(/[(),\/\\.?\-\s]+$/, '').trim();
                                         
                const combinedStr = rawTitle + ' ' + rawDesc;
                const matchVehicle = combinedStr.match(/([0-9]+호차)/);
                if (matchVehicle) {
                    vehicle = matchVehicle[1];
                }
                
                const rawDate = String(t.date || t.dueDate || t.startDate || '');
                let displayDate = '';
                if (rawDate) {
                    const parts = rawDate.includes(' to ') ? rawDate.split(' to ') : rawDate.split(' ~ '); // displayDate 는 조각별로 이스케이프한 HTML (줄바꿈 <br> 포함)
                    displayDate = parts.map(d => {
                        const dateObj = parseDisplayDate(d.trim());
                        if (dateObj) {
                            return escapeHTML(formatDateShort(dateObj));
                        }
                        return escapeHTML(d);
                    }).join('<br>~ ');
                }
                
                // 전역 DB에 저장된 호차 정보가 있다면 우선 적용
                const globalVehicles = (typeof AppStore !== 'undefined' && AppStore.getTripVehicles) ? AppStore.getTripVehicles() : {};
                if (t.id && globalVehicles[t.id]) {
                    vehicle = globalVehicles[t.id];
                }
                
                return { id: t.id, company, bgColor, displayDate, location: rawLocation, assignees, vehicle, rawDate: t.date || t.startDate };
            };

            window.currentDisplayTrips = displayTrips;
            
            const parsedTrips = displayTrips.map(t => parseTripData(t));
            for (let i = 0; i < parsedTrips.length; i++) {
                if (parsedTrips[i].rowspan === undefined) {
                    let rowspan = 1;
                    for (let j = i + 1; j < parsedTrips.length; j++) {
                        if (parsedTrips[j].displayDate === parsedTrips[i].displayDate) {
                            rowspan++;
                            parsedTrips[j].rowspan = 0;
                        } else {
                            break;
                        }
                    }
                    parsedTrips[i].rowspan = rowspan;
                    parsedTrips[i + rowspan - 1].isLastInGroup = true;
                }
            }
            
            const isTeam = mode === 'team';
            
            const tableHTML = `
                <div style="width: 100%; border-radius: 4px;">
                <table class="briefing-table" style="width: 100%; border-collapse: collapse; font-size: 0.9rem; text-align: left; color: #000; border: 3px solid #000; font-family: 'Malgun Gothic', sans-serif;">
                    <thead>
                        <tr style="background-color: #E2E8F0; text-align: center; font-weight: 700;">
                            <th style="border: 1px solid #000; border-bottom: 3px solid #000; padding: 6px 4px; width: ${isTeam ? '13' : '15'}%; text-align: center;">구분</th>
                            <th style="border: 1px solid #000; border-bottom: 3px solid #000; padding: 6px 4px; width: ${isTeam ? '21' : '25'}%; text-align: center;">일시</th>
                            <th style="border: 1px solid #000; border-bottom: 3px solid #000; padding: 6px 4px; width: ${isTeam ? '36' : '40'}%; text-align: center;">출장지 / 내용</th>
                            <th style="border: 1px solid #000; border-bottom: 3px solid #000; padding: 6px 4px; width: ${isTeam ? '18' : '20'}%; text-align: center;">담당자</th>
                            ${isTeam ? '<th style="border: 1px solid #000; border-bottom: 3px solid #000; padding: 6px 2px; width: 12%; text-align: center;">호차</th>' : ''}
                        </tr>
                    </thead>
                    <tbody>
                        ${parsedTrips.map((parsed, idx) => {
                            let safeDateStr = String(parsed.rawDate || '').split(' ~ ')[0].split('T')[0];
                            const borderBottom = parsed.isLastInGroup ? '3px solid #000' : '1px solid #000';
                            
                            let dateTd = '';
                            if (parsed.rowspan > 0) {
                                dateTd = `<td rowspan="${parsed.rowspan}" style="border: 1px solid #000; border-bottom: 3px solid #000; padding: 4px; font-weight: 500; background-color: #FFF9C4; text-align: center;">${parsed.displayDate}</td>`;
                            }
                            
                            return `
                                <tr style="cursor: pointer;" onclick="window.handleBriefingTripClick(${jsAttrArg(safeDateStr)})">
                                    <td style="border: 1px solid #000; border-bottom: ${borderBottom}; padding: 4px; font-weight: 700; text-align: center; background-color: ${escapeHTML(parsed.bgColor)};">${escapeHTML(parsed.company)}</td>
                                    ${dateTd}
                                    <td style="border: 1px solid #000; border-bottom: ${borderBottom}; padding: 4px; font-weight: 600;">${escapeHTML(parsed.location)}</td>
                                    <td style="border: 1px solid #000; border-bottom: ${borderBottom}; padding: 4px; font-weight: 500; text-align: center; background-color: #FFF9C4;">${escapeHTML(parsed.assignees)}</td>
                                    ${isTeam ? `<td style="border: 1px solid #000; border-bottom: ${borderBottom}; padding: 2px; text-align: center;" onclick="event.stopPropagation();">
                                        <div class="vehicle-desktop-view">
                                            <select onchange="window.handleTripVehicleToggle(${idx}, this.value, event)"
                                                onclick="event.stopPropagation();"
                                                style="width: 100%; padding: 2px; font-size: 0.8rem; font-weight: 700; border: 1.5px solid ${parsed.vehicle !== '-' ? 'var(--primary)' : '#94a3b8'}; border-radius: 4px; background-color: ${parsed.vehicle !== '-' ? '#EEF2FF' : '#ffffff'}; color: ${parsed.vehicle !== '-' ? 'var(--primary)' : '#334155'}; cursor: pointer; text-align: center;">
                                                <option value="-" ${parsed.vehicle === '-' ? 'selected' : ''}>-</option>
                                                <option value="1호차" ${parsed.vehicle === '1호차' ? 'selected' : ''}>1호차</option>
                                                <option value="2호차" ${parsed.vehicle === '2호차' ? 'selected' : ''}>2호차</option>
                                                <option value="3호차" ${parsed.vehicle === '3호차' ? 'selected' : ''}>3호차</option>
                                            </select>
                                        </div>
                                        <div class="vehicle-mobile-view">
                                            <div class="vehicle-reaction-container">
                                                <div class="vehicle-reaction-btn ${parsed.vehicle === '1호차' ? 'active' : ''}" onclick="window.handleTripVehicleToggle(${idx}, '${parsed.vehicle === '1호차' ? '-' : '1호차'}', event)">1</div>
                                                <div class="vehicle-reaction-btn ${parsed.vehicle === '2호차' ? 'active' : ''}" onclick="window.handleTripVehicleToggle(${idx}, '${parsed.vehicle === '2호차' ? '-' : '2호차'}', event)">2</div>
                                                <div class="vehicle-reaction-btn ${parsed.vehicle === '3호차' ? 'active' : ''}" onclick="window.handleTripVehicleToggle(${idx}, '${parsed.vehicle === '3호차' ? '-' : '3호차'}', event)">3</div>
                                            </div>
                                        </div>
                                    </td>` : ''}
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
                </div>
            `;
            
            listEl.innerHTML = tableHTML;
        }
    
    modal.style.display = 'flex';
};

window.handleBriefingTripClick = function(targetDate) {
    document.getElementById('briefingTripsModal').style.display = 'none';
    if (targetDate && typeof showDayDetail === 'function') {
        const tabBtn = document.querySelector("button[onclick*='tab-calendar']");
        if (tabBtn && typeof switchTab === 'function') switchTab('tab-calendar', tabBtn);
        
        const safeDate = targetDate.split(' ~ ')[0];
        const dateObj = new Date(safeDate);
        currentDateForTabCalendar.setFullYear(dateObj.getFullYear());
        currentDateForTabCalendar.setMonth(dateObj.getMonth());
        if (typeof renderTabCalendar === 'function') renderTabCalendar();
        showDayDetail(targetDate);
    }
};

window.currentBriefingCalendarDate = new Date();

window.toggleBriefingMiniCalendar = function() {
    const wrapper = document.getElementById('briefingMiniCalendarWrapper');
    if (!wrapper) return;
    if (wrapper.style.display === 'none') {
        wrapper.style.display = 'block';
        window.currentBriefingCalendarDate = new Date();
        renderBriefingMiniCalendar();
    } else {
        wrapper.style.display = 'none';
    }
};

window.changeBriefingCalendarMonth = function(dir) {
    window.currentBriefingCalendarDate.setMonth(window.currentBriefingCalendarDate.getMonth() + dir);
    renderBriefingMiniCalendar();
};

function renderBriefingMiniCalendar() {
    buildCalendarGrid('briefingMiniCalendarGrid', 'briefingMiniCalendarTitle', window.currentBriefingCalendarDate, true, (cell, dateString, isCurrentMonth) => {
        const trips = window.currentBriefingTrips || [];
        const tripsOnDate = trips.filter(t => (t.date || t.startDate) === dateString || ((t.startDate || t.date) <= dateString && (t.dueDate || t.date) >= dateString));
        
        cell.onclick = (e) => {
            e.stopPropagation();
            document.getElementById('briefingTripsModal').style.display = 'none';
            const tabBtn = document.querySelector("button[onclick*='tab-calendar']");
            if (tabBtn && typeof switchTab === 'function') switchTab('tab-calendar', tabBtn);
            
            const dateObj = new Date(dateString);
            if (typeof currentDateForTabCalendar !== 'undefined') {
                currentDateForTabCalendar.setFullYear(dateObj.getFullYear());
                currentDateForTabCalendar.setMonth(dateObj.getMonth());
            }
            if (typeof renderTabCalendar === 'function') renderTabCalendar();
            if (typeof showDayDetail === 'function') showDayDetail(dateString);
        };
        
        if (tripsOnDate.length > 0) {
            cell.style.background = 'rgba(139, 92, 246, 0.1)';
            cell.style.border = '1px solid #8B5CF6';
            cell.style.cursor = 'pointer';
            
            const dot = document.createElement('div');
            dot.style = 'width: 6px; height: 6px; background-color: #8B5CF6; border-radius: 50%; margin: 2px auto 0;';
            cell.appendChild(dot);
        } else {
            cell.style.cursor = 'pointer';
        }
    });
}

window.renderTeamStatusSidebar = function() {
    const listEl = document.getElementById('team-status-list');
    const mobileListEl = document.getElementById('team-status-list-mobile');
    
    if (!listEl && !mobileListEl) return;
    
    let membersObj = {};
    if (typeof AppStore !== 'undefined' && AppStore.getUsers) {
        membersObj = AppStore.getUsers();
    }
    const members = Object.values(membersObj || {});
    if (members.length === 0) {
        if (listEl) listEl.innerHTML = '<div style="font-size: 0.85rem; color: var(--text-muted); text-align: center;">멤버 데이터를 불러오는 중...</div>';
        if (mobileListEl) mobileListEl.innerHTML = '<div style="font-size: 0.85rem; color: var(--text-muted); text-align: center;">멤버 데이터를 불러오는 중...</div>';
        return;
    }
    
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    
    let trips = [], leaves = [], externalEvents = [];
    if (typeof AppStore !== 'undefined') {
        if (AppStore.getTrips) trips = Object.values(AppStore.getTrips() || {});
        if (AppStore.getLeaves) leaves = Object.values(AppStore.getLeaves() || {});
        if (AppStore.getExternalEvents) externalEvents = Object.values(AppStore.getExternalEvents() || {});
    }
    
    // 이름순 정렬
    members.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
    
    if (listEl) listEl.innerHTML = '';
    if (mobileListEl) mobileListEl.innerHTML = '';
    
    members.forEach(member => {
        if (!member.displayName) return;
        
        let status = '사무실';
        let statusColor = '#10B981'; // Green
        let statusIcon = 'domain'; // Building icon for office
        
        // 휴가 체크
        const isLeave = leaves.some(l => l.uid === member.uid && l.status === 'approved' && (l.date === todayStr || (l.startDate <= todayStr && l.endDate >= todayStr)));
        if (isLeave) {
            status = '휴가 중';
            statusColor = '#3B82F6'; // Blue
            statusIcon = 'beach_access';
        } else {
            // 이름 매칭: 전체 이름 + 성을 뺀 이름 (2글자 이름의 한 글자는 독립된 단어일 때만) — textUtils.js 공통 규칙
            const isMatch = (text) => textMentionsMember(text, member.displayName);

            // 출장 및 연동 일정 체크 (당일 일정 기준) - 쿠팡 외 일정 우선 표시
            const myTrips = trips.filter(t => isMatch(t.assignee) && (t.date || t.startDate) <= todayStr && (t.date || t.endDate || t.startDate) >= todayStr);
            const myExtEvents = externalEvents.filter(e => isMatch(e.title) && (e.startDate || e.dueDate) <= todayStr && (e.dueDate || e.startDate) >= todayStr);
            
            const allTodayEvents = [...myTrips, ...myExtEvents];
            
            if (allTodayEvents.length > 0) {
                const hasLeave = allTodayEvents.some(e => {
                    const t = e.title || e.name || e.project || '';
                    return t.includes('휴가') || t.includes('반차') || t.includes('조퇴') || t.includes('연차') || t.includes('병가');
                });
                const hasNonCoupang = allTodayEvents.some(e => {
                    const t = e.title || e.name || e.project || '';
                    return !t.includes('쿠팡') && !t.includes('휴가') && !t.includes('반차') && !t.includes('조퇴') && !t.includes('연차') && !t.includes('병가');
                });
                const hasCoupang = allTodayEvents.some(e => (e.title || e.name || e.project || '').includes('쿠팡'));
                
                if (hasLeave) {
                    status = '휴가 중';
                    statusColor = '#3B82F6'; // Blue
                    statusIcon = 'beach_access';
                }
                else if (hasNonCoupang) {
                    status = '출장';
                    statusColor = '#6366F1'; // Indigo
                    statusIcon = 'directions_car'; // Car icon for trips
                }
                else if (hasCoupang) {
                    status = '쿠팡';
                    statusColor = '#8B5CF6'; // Purple
                    statusIcon = 'location_on';
                }
            }
        }

        // 대표님 특별 예외 처리 (항상 '대장'으로 표시)
        if (member.displayName === 'min suk kim') {
            status = '대장 👑';
            statusColor = '#F59E0B'; // Gold / Amber
            statusIcon = 'workspace_premium';
        }
        
        const avatarUrl = member.photoURL || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
        
        const card = document.createElement('div');
        card.style = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-radius: var(--radius); background: var(--col-bg); border: 1px solid var(--border-color);';
        
        const profileDiv = document.createElement('div');
        profileDiv.style = 'display: flex; align-items: center; gap: 8px;';
        
        const img = document.createElement('img');
        img.src = avatarUrl;
        img.style = 'width: 28px; height: 28px; border-radius: 50%; object-fit: cover; border: 2px solid white; box-shadow: none;';
        img.setAttribute('referrerpolicy', 'no-referrer');
        
        const nameSpan = document.createElement('span');
        nameSpan.style = 'font-size: 0.85rem; font-weight: 700; color: var(--text-main);';
        nameSpan.textContent = member.displayName;
        
        profileDiv.appendChild(img);
        profileDiv.appendChild(nameSpan);
        
        const statusDiv = document.createElement('div');
        statusDiv.style = `display: flex; align-items: center; gap: 3px; padding: 3px 6px; border-radius: var(--radius); background: ${statusColor}15; color: ${statusColor}; font-size: 0.75rem; font-weight: 700; white-space: nowrap;`;
        statusDiv.innerHTML = `<span class="material-symbols-rounded" style="font-size: 0.95rem;">${statusIcon}</span> ${status}`;
        
        card.appendChild(profileDiv);
        card.appendChild(statusDiv);
        
        if (listEl) {
            listEl.appendChild(card);
        }
        
        if (mobileListEl) {
            mobileListEl.appendChild(card.cloneNode(true));
        }
    });
};

setInterval(window.renderTeamStatusSidebar, 5000);

window.toggleTeamStatusPanel = function() {
    const panel = document.getElementById('team-status-panel');
    if (!panel) return;
    
    // 알림 패널이 열려있으면 닫기
    const notiPanel = document.getElementById('noti-panel');
    if (notiPanel && notiPanel.classList.contains('open')) {
        notiPanel.classList.remove('open');
    }
    
    // 클래스 토글 방식 사용 (CSS 서랍 애니메이션 호환)
    panel.classList.toggle('open');
};
window.renderSkeletons = function() {
    const skeletonHTML = `
        <div class="task-card skeleton-card">
            <div class="skeleton-title"></div>
            <div class="skeleton-meta"></div>
            <div class="skeleton-avatars">
                <div class="skeleton-avatar"></div>
            </div>
        </div>
    `;
    const lists = ['todo-list', 'doing-list', 'done-list'];
    lists.forEach(id => {
        const listEl = document.getElementById(id);
        if (listEl) {
            listEl.innerHTML = skeletonHTML.repeat(2);
        }
    });
};
// 초기 로딩 시 스켈레톤 렌더링
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.renderSkeletons);
} else {
    window.renderSkeletons();
}

// ==========================================
// Tippy.js Tooltip Initialization
// ==========================================
function initTippy() {
    if (typeof tippy !== 'undefined') {
        tippy.delegate('body', {
            target: '[data-tippy-content]',
            theme: 'translucent',
            animation: 'scale',
            touch: ['hold', 400],
            maxWidth: 250,
            allowHTML: true,
            onShow(instance) {
                const content = instance.reference.getAttribute('data-tippy-content');
                if (content) {
                    instance.setContent(content.replace(/\n/g, '<br>'));
                }
            }
        });
    }
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTippy);
} else {
    initTippy();
}


window.startKanbanSubscriptions = function() {
    if (typeof window.startTasksTodoListener === 'function') window.startTasksTodoListener();
    if (typeof window.startTasksDoingListener === 'function') window.startTasksDoingListener();
    if (typeof window.startTasksDoneListener === 'function') window.startTasksDoneListener();
    if (typeof window.startDailyRoutineSettingsListener === 'function') window.startDailyRoutineSettingsListener();
    if (typeof window.startDailyRoutineLogsListener === 'function') window.startDailyRoutineLogsListener();
};
