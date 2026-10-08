// services.js
// ----------------------------------------------------
// 휴가 결재, 마이페이지, 공지사항 및 실시간 통신(채팅, 문서, 드라이브)
// ----------------------------------------------------


// ----------------------------------------------------
// 지메일 업무 소통 요약 Feed 연동
// ----------------------------------------------------
// 지메일 업무 소통 요약 Feed 연동
// ----------------------------------------------------
function listenForCommunications() {
    const listEl = document.getElementById('communication-list');
    if (!listEl) return;

    window.AppSubscriptionManager.subscribe('businessCommunications', db.ref('businessCommunications'), (snapshot) => {
        listEl.innerHTML = '';
        const data = snapshot.val();
        if (!data) {
            listEl.innerHTML = `<li class="comm-empty"><span class="material-symbols-rounded">mail_lock</span>수신된 일반 메일 소통 내역이 아직 없습니다.</li>`;
            return;
        }

        const items = Object.keys(data).map(key => ({ id: key, ...data[key] }));
        // 최신순 (timestamp 내림차순) 정렬
        items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        items.forEach(item => {
            const li = document.createElement('li');
            li.className = 'comm-card';

            // 카테고리별 클래스 및 이모지 설정
            let categoryClass = 'inquiry';
            let categoryEmoji = '❓';
            if (item.category === '업무보고') { categoryClass = 'reporting'; categoryEmoji = '📊'; }
            else if (item.category === '공지사항') { categoryClass = 'announcement'; categoryEmoji = '📢'; }
            else if (item.category === '일정공유') { categoryClass = 'schedule'; categoryEmoji = '📅'; }

            // 날짜 표시
            const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleString('ko-KR', { hour12: false }) : '';

            // Gmail 바로가기 링크 생성 (제목 검색을 통한 지메일 유기적 접근)
            const searchQuery = encodeURIComponent(`subject:("${item.title}")`);
            const gmailUrl = `https://mail.google.com/mail/u/0/#search/${searchQuery}`;

            li.innerHTML = `
                <div class="comm-header">
                    <div class="comm-meta-left">
                        <span class="comm-badge ${categoryClass}">${categoryEmoji} ${item.category || '일반문의'}</span>
                        <span class="comm-category-label">${item.categoryLabel || '업무소통'}</span>
                        <div class="comm-sender-chip">
                            <span class="material-symbols-rounded">person</span>
                            ${item.sender || '미상'}
                        </div>
                    </div>
                    <span class="comm-meta-right">${dateStr}</span>
                </div>
                <div class="comm-body">
                    ${item.summary}
                </div>
                <div class="comm-footer">
                    <span class="comm-subject-title" title="${item.title}">원본: ${item.title}</span>
                    <a href="${gmailUrl}" target="_blank" class="comm-gmail-link" title="지메일 앱에서 원본 메일 열기">
                        <span class="material-symbols-rounded">mail</span> Gmail로 이동
                    </a>
                </div>
            `;
            listEl.appendChild(li);
        });
    });
}

// 탭 전환 시 또는 로딩 시 리스너 등록
document.addEventListener('DOMContentLoaded', () => {
    // // listenForCommunications();
});

// ----------------------------------------------------
// 파일 업로드 기능
// ----------------------------------------------------
let currentFolderId = 'root';
let folderPath = [{ id: 'root', name: '공유 드라이브' }];
window.draggedItemId = null; // 전역 드래그 상태 초기화

function renderDriveBreadcrumb() {
    const breadcrumb = document.getElementById('drive-breadcrumb');
    const btnUp = document.getElementById('btn-go-up');
    if (btnUp) btnUp.disabled = folderPath.length <= 1;

    if (breadcrumb) {
        breadcrumb.innerHTML = '';
        folderPath.forEach((folder, idx) => {
            if (idx > 0) {
                const separator = document.createElement('span');
                separator.textContent = ' > ';
                separator.style.color = 'var(--text-muted)';
                separator.style.margin = '0 2px';
                breadcrumb.appendChild(separator);
            }

            const span = document.createElement('span');
            span.textContent = folder.name;
            span.className = 'breadcrumb-item';

            // 현재 폴더가 아닐 때만 클릭/드롭 지원
            if (folder.id !== currentFolderId) {
                span.style.cursor = 'pointer';
                span.onclick = () => {
                    const searchInput = document.getElementById('fileSearchInput');
                    if (searchInput) searchInput.value = '';

                    folderPath = folderPath.slice(0, idx + 1);
                    currentFolderId = folder.id;
                    renderDriveBreadcrumb();
                    renderFiles();
                };

                span.addEventListener('dragover', (e) => {
                    if (window.draggedItemId) {
                        e.preventDefault();
                        span.classList.add('drag-hover');
                    }
                });
                span.addEventListener('dragleave', () => {
                    span.classList.remove('drag-hover');
                });
                span.addEventListener('drop', (e) => {
                    e.preventDefault();
                    span.classList.remove('drag-hover');
                    if (window.draggedItemId) {
                        dropFileIntoFolder(e, folder.id);
                    }
                });
            } else {
                span.style.fontWeight = 'bold';
            }

            breadcrumb.appendChild(span);
        });
    }
}

function goUpFolder() {
    if (folderPath.length > 1) {
        // 상위 이동 시 검색어 초기화
        const searchInput = document.getElementById('fileSearchInput');
        if (searchInput) searchInput.value = '';

        folderPath.pop();
        currentFolderId = folderPath[folderPath.length - 1].id;
        renderDriveBreadcrumb();
        renderFiles();
    }
}

function openFolder(folderId, folderName) {
    // 폴더 진입 시 검색어 초기화
    const searchInput = document.getElementById('fileSearchInput');
    if (searchInput) searchInput.value = '';

    currentFolderId = folderId;
    folderPath.push({ id: folderId, name: folderName });
    renderDriveBreadcrumb();
    renderFiles();
}

async function createNewFolder() {
    if (!(await checkAuth('승인된 사용자만 생성 가능합니다.'))) return;
    const folderName = await customPrompt('새 폴더 이름을 입력하세요:');
    if (!folderName) return;
    const uploaderName = AppStore.getCurrentUser() ? AppStore.getCurrentUser().displayName : '익명';

    const newRef = db.ref('files').push();
    newRef.set({
        id: newRef.key,
        name: folderName,
        isFolder: true,
        parentId: currentFolderId,
        timestamp: Date.now(),
        uploader: uploaderName
    }).then(() => showToast('폴더가 생성되었습니다.', 'info'))
        .catch(e => showToast('생성 실패: ' + e.message, 'error'));
}

async function uploadFile() {
    if (!(await checkAuth('승인된 사용자만 업로드 가능합니다.'))) return;
    const fileInput = document.getElementById('fileInput'), file = fileInput.files[0];
    if (!file) return await customAlert('파일을 선택해주세요.');
    if (file.size > 30 * 1024 * 1024) return await customAlert('파일 용량은 30MB를 초과할 수 없습니다.');

    document.getElementById('uploadStatus').innerText = '업로드 중...';
    const filePath = 'uploads/' + Date.now() + '_' + file.name;
    const uploaderName = AppStore.getCurrentUser() ? AppStore.getCurrentUser().displayName : '익명';
    storage.ref(filePath).put(file).then(snapshot => snapshot.ref.getDownloadURL().then(url => {
        db.ref('files').push().set({
            id: Date.now().toString(),
            name: file.name,
            url: url,
            path: filePath,
            parentId: currentFolderId,
            timestamp: Date.now(),
            uploader: uploaderName
        }).then(() => {
            document.getElementById('uploadStatus').innerText = '업로드 완료!'; 
            fileInput.value = ''; 
            updateFileName('fileInput', 'fileNameDisplay');
        }).catch(err => {
            console.error('[Drive] Database save failed:', err);
            document.getElementById('uploadStatus').innerText = '업로드 실패 (DB 기록 실패)';
            showToast('데이터베이스 기록 실패: ' + err.message, 'error');
        });
    })).catch(e => {
        console.error('[Drive] Storage upload failed:', e);
        document.getElementById('uploadStatus').innerText = '업로드 실패';
        showToast('파일 업로드 실패: ' + e.message, 'error');
    });
}

async function deleteFile(fileId, filePath, isFolder = false) {
    if (!await customConfirm(isFolder ? '이 폴더를 삭제하시겠습니까?\n(폴더 안의 파일들은 삭제되지 않고 남을 수 있습니다)' : '삭제하시겠습니까?')) return;
    if (isFolder) {
        db.ref('files/' + fileId).remove().then(() => showToast('폴더가 삭제되었습니다.', 'info'));
    } else {
        if (filePath) {
            storage.ref(filePath).delete()
                .then(() => db.ref('files/' + fileId).remove())
                .catch(e => db.ref('files/' + fileId).remove()); // 스토리지 삭제 실패해도 DB 삭제 진행
        } else {
            db.ref('files/' + fileId).remove();
        }
    }
}

// 하위 폴더 여부 확인 함수 (폴더 순환 참조 이동 방지용)
function isDescendant(folderId, potentialDescendantId) {
    let currentId = potentialDescendantId;
    const visited = new Set();
    while (currentId && currentId !== 'root') {
        if (visited.has(currentId)) break; // 순환 참조 무한 루프 방지
        visited.add(currentId);
        
        const parent = allFilesData[currentId];
        if (!parent) break;
        if (parent.parentId === folderId) {
            return true;
        }
        currentId = parent.parentId;
    }
    return false;
}

// 파일 강제 다운로드 로직 추가
async function dropFileIntoFolder(ev, targetFolderId) {
    ev.preventDefault();
    if (ev.stopPropagation) ev.stopPropagation();

    const fileId = window.draggedItemId;
    console.log('[Drive] Drop event triggered. draggedItemId:', fileId, 'targetFolderId:', targetFolderId);

    if (!fileId) {
        showToast('드래그된 항목을 찾을 수 없습니다.', 'error');
        return;
    }

    if (fileId === targetFolderId) {
        showToast('자기 자신으로는 이동할 수 없습니다.', 'warning');
        window.draggedItemId = null;
        return;
    }

    const item = allFilesData[fileId];
    const target = allFilesData[targetFolderId];

    if (!item) {
        console.error('[Drive] Item not found in allFilesData:', fileId);
        showToast('항목 정보를 가져오는데 실패했습니다.', 'error');
        window.draggedItemId = null;
        return;
    }

    // 폴더 순환 참조 방지 예외 처리
    if (item.isFolder && (targetFolderId === fileId || isDescendant(fileId, targetFolderId))) {
        showToast('폴더를 자기 자신 또는 자신의 하위 폴더로 이동할 수 없습니다.', 'warning');
        window.draggedItemId = null;
        renderFiles();
        return;
    }

    // 이미 해당 폴더에 속해 있는 경우 처리
    if ((item.parentId || 'root') === (targetFolderId || 'root')) {
        showToast('이미 해당 폴더에 존재합니다.', 'warning');
        window.draggedItemId = null;
        return;
    }

    const msg = `'${item.name}'을(를) '${target ? target.name : '공유 드라이브'}' 폴더로 이동하시겠습니까?`;
    if (await customConfirm(msg)) {
        db.ref('files/' + fileId).update({ parentId: targetFolderId })
            .then(() => {
                showToast('이동이 완료되었습니다.', 'info');
            })
            .catch(async (error) => {
                console.error('[Drive] Update failed:', error);
                await customAlert("이동 권한이 없거나 오류가 발생했습니다: " + error.message);
            })
            .finally(() => {
                window.draggedItemId = null;
                renderFiles(); // 성공/실패 여부와 상관없이 UI 리셋
            });
    } else {
        window.draggedItemId = null;
        renderFiles(); // 취소 시에도 UI 리셋
    }
}

async function forceDownload(url, fileName) {
    showToast('파일 다운로드를 시작합니다...', 'info');
    try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error('네트워크 응답 오류: ' + response.status);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = blobUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
        console.error('CORS 에러 혹은 파일 다운로드 불가 상황', e);
        window.open(url, '_blank');
    }
}

// 파일 이동 및 업로드 관련 전역 핸들러
window.addEventListener('dragend', () => {
    // 드래그가 어떤 식으로든 종료되면 모든 하이라이트와 상태 초기화
    document.querySelectorAll('.dragover, .column.drag-over').forEach(el => el.classList.remove('dragover', 'drag-over'));
    window.draggedItemId = null;
});

function initDriveDragEvents() {
    const driveZone = document.getElementById('drive-drop-zone');
    if (!driveZone) return;

    driveZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        // 파일을 폴더 안이 아닌 드라이브 빈 공간에 올렸을 때만 하이라이트
        if (!e.target.closest('li')) {
            driveZone.classList.add('dragover');
        } else {
            driveZone.classList.remove('dragover');
        }
    });

    driveZone.addEventListener('dragleave', (e) => {
        // 실제 영역을 완전히 벗어났을 때만 클래스 제거
        if (!driveZone.contains(e.relatedTarget)) {
            driveZone.classList.remove('dragover');
        }
    });

    driveZone.addEventListener('drop', (e) => {
        e.preventDefault();
        driveZone.classList.remove('dragover');

        // 외부 파일 드롭 시 자동 업로드 지원
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const fileInput = document.getElementById('fileInput');
            if (fileInput) {
                fileInput.files = e.dataTransfer.files;
                if (typeof updateFileName === 'function') updateFileName('fileInput', 'fileNameDisplay');
                uploadFile();
            }
        }
    });

    // [개선] 상위 폴더로 이동 버튼 드롭 지원
    const btnUp = document.getElementById('btn-go-up');
    if (btnUp) {
        btnUp.addEventListener('dragover', (e) => {
            if (window.draggedItemId && folderPath.length > 1) {
                e.preventDefault();
                btnUp.classList.add('drag-hover');
            }
        });
        btnUp.addEventListener('dragleave', () => {
            btnUp.classList.remove('drag-hover');
        });
        btnUp.addEventListener('drop', (e) => {
            e.preventDefault();
            btnUp.classList.remove('drag-hover');
            if (window.draggedItemId && folderPath.length > 1) {
                const parentFolder = folderPath[folderPath.length - 2];
                dropFileIntoFolder(e, parentFolder.id);
            }
        });
    }
}

// DOM 로드 후 실행
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDriveDragEvents);
} else {
    initDriveDragEvents();
}

let allFilesData = {};

async function openDriveFile(fileId) {
    const file = allFilesData[fileId];
    if (!file) return;

    if (file.path && typeof storage !== 'undefined') {
        try {
            showToast('최신 보안 토큰으로 파일 여는 중...', 'info');
            const freshUrl = await storage.ref(file.path).getDownloadURL();
            window.open(freshUrl, '_blank');
            return;
        } catch (err) {
            console.warn('[Drive] Fresh URL fetch failed:', err);
            if (err.code === 'storage/unauthorized' || (err.message && err.message.toLowerCase().includes('permission'))) {
                await customAlert('📁 파이어베이스 스토리지 접근 권한 오류 (403 Permission Denied)\n\nFirebase Console -> Storage -> Rules(규칙) 탭에서\nallow read, write: if request.auth != null;\n(또는 allow read;)로 보안 규칙을 수정해 주세요.');
                return;
            } else if (err.code === 'storage/object-not-found' || (err.message && (err.message.includes('404') || err.message.toLowerCase().includes('not found')))) {
                await customAlert('📁 파일을 찾을 수 없습니다 (404 Not Found)\n\n파이어베이스 스토리지에서 실제 파일이 삭제되었거나 업로드되지 않은 항목입니다.\n목록에서 해당 항목을 [삭제] 하신 후 새 파일로 다시 업로드해 주세요.');
                return;
            }
        }
    }

    if (file.url) {
        window.open(file.url, '_blank');
    } else {
        await customAlert('파일 URL 정보를 찾을 수 없습니다.');
    }
}

function renderFiles() {
    const list = document.getElementById('fileList');
    if (!list) return;
    list.innerHTML = '';

    const searchInput = document.getElementById('fileSearchInput');
    const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : '';

    let itemsToRender = [];
    if (searchQuery) {
        itemsToRender = Object.values(allFilesData).filter(f =>
            (f.name && f.name.toLowerCase().includes(searchQuery))
        );
    } else {
        itemsToRender = Object.values(allFilesData).filter(f => (f.parentId || 'root') === currentFolderId);
    }

    const folders = itemsToRender.filter(f => f.isFolder).sort((a, b) => b.timestamp - a.timestamp);
    const files = itemsToRender.filter(f => !f.isFolder).sort((a, b) => b.timestamp - a.timestamp);

    if (itemsToRender.length === 0) {
        list.innerHTML = `<li style="justify-content:center; color:var(--text-muted); background:transparent; border:1px dashed var(--border-color);">${searchQuery ? '검색 결과가 없습니다.' : '이 폴더는 비어 있습니다.'}</li>`;
        return;
    }

    folders.forEach(f => {
        const safeName = f.name ? f.name.replace(/'/g, "\\'").replace(/"/g, "&quot;") : '새 폴더';
        const li = document.createElement('li');
        li.draggable = true;
        li.style.cursor = 'grab';
        li.addEventListener('dragstart', (e) => {
            window.draggedItemId = f.id;
            e.dataTransfer.setData('text', f.id);
            e.dataTransfer.effectAllowed = 'move';
            li.style.opacity = '0.5';
        });
        li.addEventListener('dragend', () => {
            li.style.opacity = '';
        });
        li.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            li.style.backgroundColor = 'rgba(79, 70, 229, 0.1)';
            li.style.border = '2px solid var(--primary)';
        });
        li.addEventListener('dragenter', (e) => {
            e.preventDefault();
        });
        li.addEventListener('dragleave', (e) => {
            e.preventDefault();
            li.style.backgroundColor = '';
            li.style.border = '';
        });
        li.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            li.style.backgroundColor = '';
            li.style.border = '';
            dropFileIntoFolder(e, f.id);
        });
        li.innerHTML = `
            <div draggable="false" style="display:flex; align-items:center; gap:8px; flex:1; cursor:pointer;" onclick="event.stopPropagation(); openFolder('${f.id}', '${safeName}')" title="클릭하여 진입">
                <span draggable="false" class="material-symbols-rounded" style="color:#F59E0B; font-size:1.5em;">folder</span>
                <span draggable="false" style="font-weight:600; color:var(--text-main); font-size:0.95rem;">${f.name}</span>
            </div>
            <button draggable="false" class="delete-btn" onclick="event.stopPropagation(); deleteFile('${f.id}', null, true)">삭제</button>
        `;
        list.appendChild(li);
    });

    files.forEach(f => {
        const safeName = f.name ? f.name.replace(/'/g, "\\'").replace(/"/g, "&quot;") : 'download';
        const li = document.createElement('li');
        li.draggable = true;
        li.style.cursor = 'grab';
        li.addEventListener('dragstart', (e) => {
            window.draggedItemId = f.id;
            e.dataTransfer.setData('text', f.id);
            e.dataTransfer.effectAllowed = 'move';
            li.style.opacity = '0.5';
        });
        li.addEventListener('dragend', () => {
            li.style.opacity = '';
        });
        li.innerHTML = `
            <div draggable="false" style="display:flex; align-items:center; gap:8px; flex:1; text-decoration:none; color:var(--text-main); font-size:0.95rem; font-weight:600; word-break:break-all; cursor:pointer;" onclick="event.stopPropagation(); openDriveFile('${f.id}');" title="업로드: ${f.uploader || '알 수 없음'}">
                <span draggable="false" class="material-symbols-rounded" style="color:var(--text-muted); font-size:1.5em;">description</span>
                <span style="flex:1;">${f.name}</span>
            </div>
            <button draggable="false" class="delete-btn" onclick="event.stopPropagation(); deleteFile('${f.id}', '${f.path || ''}', false)">삭제</button>
        `;
        list.appendChild(li);
    });
}

// 로컬 렌더링 누락 문제를 최소화하기 위해 limitToLast(500)으로 증가
window.startServicesSubscriptions = function() {
    if (typeof listenForCommunications === 'function') listenForCommunications();
    if (typeof window.listenForChatMessages === 'function') window.listenForChatMessages();
    if (typeof window.listenForNotices === 'function') window.listenForNotices();
    if (typeof window.listenForFeed === 'function') window.listenForFeed();
window.AppSubscriptionManager.subscribe('files', db.ref('files').orderByKey().limitToLast(500), (s) => {
    const data = s.val() || {};
    for (let key in data) {
        if (data[key] && typeof data[key] === 'object') {
            data[key].id = key;
        }
    }
    allFilesData = data;
    renderFiles();
});};



// ----------------------------------------------------
// 조직도(팀원 목록) 및 채팅 기능
// ----------------------------------------------------
window.startServicesSubscriptions2 = function() {
window.AppSubscriptionManager.subscribe('users', db.ref('users'), (snapshot) => {
    AppStore.setUsers(snapshot.val() || {});
    if (typeof renderAdminLeaves === 'function') renderAdminLeaves();
    if (typeof renderLeaveUI === 'function') renderLeaveUI();
    if (typeof renderMyPage === 'function') renderMyPage();
    if (typeof renderTasks === 'function') renderTasks();
    if (typeof generateAiBriefing === 'function') generateAiBriefing();
});};


function renderMembersDirectory() {
    ['ceo', 'executive_director', 'director', 'team1_leader', 'team1_member', 'team2_leader', 'team2_member', 'unassigned'].forEach(id => { const el = document.getElementById('list-' + id); if (el) el.innerHTML = ''; });

    // 담당자 선택 드롭다운 목록을 승인된 워크스페이스 멤버로 동기화
    const assigneeSelects = [document.getElementById('assigneeInput'), document.getElementById('modalAssigneeInput'), document.getElementById('tripAssignee')];
    const usersList = Object.values(AppStore.getUsers()).filter(u => u.approved);
    assigneeSelects.forEach(selectEl => {
        if (selectEl && selectEl.tagName === 'SELECT') {
            const currentVal = selectEl.value;
            const defaultText = selectEl.id === 'tripAssignee' ? '출장자 이름 (선택)' : '+ 추가';
            selectEl.innerHTML = `<option value="">${defaultText}</option>`;
            usersList.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.displayName;
                opt.textContent = u.displayName;
                selectEl.appendChild(opt);
            });

            // tripAssignee 전용 추가 옵션 유지 및 생성
            if (selectEl.id === 'tripAssignee') {
                // 현재 설정된 값이 회원 목록에 없는 외부/이메일 이름인 경우 옵션으로 보존 및 동적 추가
                if (currentVal && !usersList.some(u => u.displayName === currentVal) && currentVal !== '__custom__') {
                    const opt = document.createElement('option');
                    opt.value = currentVal;
                    opt.textContent = `${currentVal} (이메일/외부)`;
                    selectEl.appendChild(opt);
                }

                // '+ 직접 입력' 옵션 추가
                const optCustom = document.createElement('option');
                optCustom.value = '__custom__';
                optCustom.textContent = '✍️ 직접 입력 (외부 인원)';
                selectEl.appendChild(optCustom);
            }

            if (currentVal) selectEl.value = currentVal;
        }
    });

    if (!auth.currentUser) return;
    const isAdmin = (ADMIN_UIDS.includes(auth.currentUser.uid) || (typeof ADMIN_EMAILS !== 'undefined' && auth.currentUser.email && ADMIN_EMAILS.includes(auth.currentUser.email)));
    if (document.getElementById('org-admin-guide')) document.getElementById('org-admin-guide').style.display = isAdmin ? 'block' : 'none';

    Object.keys(AppStore.getUsers()).forEach(uid => {
        const u = AppStore.getUsers()[uid]; if (!u.approved) return;
        const card = document.createElement('div'); card.className = 'org-card' + (isAdmin ? ' draggable' : '');
        if (isAdmin) { card.draggable = true; card.ondragstart = (e) => e.dataTransfer.setData("uid", uid); }

        const unreadBadge = uid !== auth.currentUser.uid ? `<div id="org-badge-${uid}" class="unread-badge" style="display:none; position:absolute; top:-5px; right:-5px; z-index:10; border:2px solid var(--card-bg);">0</div>` : '';
        card.innerHTML = `<div style="position:relative; display:inline-block; width:54px; height:54px;"><img src="${u.photoURL || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%23E5E7EB'/%3E%3C/svg%3E"}" style="width: 54px; height: 54px; border-radius: 50%; object-fit: cover;">${unreadBadge}</div><div style="flex:1;font-weight:800;font-size:1.1rem; margin-left:1rem;">${u.displayName}</div>${uid !== auth.currentUser.uid ? `<button onclick="openPrivateChat('${uid}', '${u.displayName}')" class="delete-btn" style="background:var(--col-bg);color:var(--text-muted);"><span class="material-symbols-rounded">chat</span></button>` : ''}`;
        const validDepts = ['ceo', 'executive_director', 'director', 'team1_leader', 'team1_member', 'team2_leader', 'team2_member', 'unassigned'];
        const uDept = validDepts.includes(u.department) ? u.department : 'unassigned';
        const target = document.getElementById('list-' + uDept); if (target) target.appendChild(card);
    });
    updateChatBadges(); // 렌더링 후 배지 상태 업데이트 적용
}
async function dropMember(ev, newDept) {
    ev.preventDefault(); const uid = ev.dataTransfer.getData("uid");
    if (uid) {
        if (!(ADMIN_UIDS.includes(auth.currentUser.uid) || (typeof ADMIN_EMAILS !== 'undefined' && auth.currentUser.email && ADMIN_EMAILS.includes(auth.currentUser.email)))) return await customAlert('최고 관리자만 수정 가능합니다.');
        db.ref('users/' + uid).update({ department: newDept });
    }
}
function allowDrop(ev) { ev.preventDefault(); }

// --- 새 메시지 배지 및 알림 추적 로직 ---
const ChatReadTracker = {
    get: (id) => parseInt(localStorage.getItem('chat_read_' + id) || '0'),
    set: (id) => { localStorage.setItem('chat_read_' + id, Date.now().toString()); }
};
const ChatLatestTracker = { group: 0, private: {} };
const ChatNotifiedTracker = { group: Date.now(), private: {} };

let safePrivateUnread = {};
try { safePrivateUnread = JSON.parse(localStorage.getItem('unread_private') || '{}'); } catch (e) { }
const ChatUnreadCount = {
    group: parseInt(localStorage.getItem('unread_group') || '0') || 0,
    private: safePrivateUnread
};
function saveUnreadCounts() {
    localStorage.setItem('unread_group', ChatUnreadCount.group);
    localStorage.setItem('unread_private', JSON.stringify(ChatUnreadCount.private));
    updateChatBadges();
}

function updateChatBadges() {
    let totalUnread = ChatUnreadCount.group;
    const groupBadgeEl = document.getElementById('badge-group');
    if (groupBadgeEl) { groupBadgeEl.style.display = ChatUnreadCount.group > 0 ? 'block' : 'none'; groupBadgeEl.textContent = ChatUnreadCount.group; }

    Object.keys(AppStore.getUsers()).forEach(uid => {
        const count = ChatUnreadCount.private[uid] || 0;
        totalUnread += count;
        const badgeEl = document.getElementById('badge-' + uid);
        if (badgeEl) { badgeEl.style.display = count > 0 ? 'block' : 'none'; badgeEl.textContent = count; }

        // 조직도 탭의 인물 프로필 우측 상단에도 배지 연동
        const orgBadgeEl = document.getElementById('org-badge-' + uid);
        if (orgBadgeEl) { orgBadgeEl.style.display = count > 0 ? 'block' : 'none'; orgBadgeEl.textContent = count; }
    });
    const globalBadge = document.getElementById('chat-global-badge');
    if (globalBadge) globalBadge.style.display = totalUnread > 0 ? 'block' : 'none';
}



let currentPrivateChatTargetUid = null, currentPrivateChatRef = null;


function openPrivateChat(targetUid, targetName) {
    currentPrivateChatTargetUid = targetUid;
    document.getElementById('chat-list-window').style.display = 'none'; document.getElementById('chat-window').style.display = 'none';
    document.getElementById('private-chat-title').textContent = `${targetName}님과 채팅`; document.getElementById('private-chat-window').style.display = 'flex';

    ChatReadTracker.set(targetUid); // 열면 즉시 읽음 처리
    ChatUnreadCount.private[targetUid] = 0; saveUnreadCounts();

    // 무인자 query.off() 는 같은 쿼리로 등록된 알림 리스너(privateChats_list_*)까지 제거하므로 관리자 키로만 해제한다.
    window.AppSubscriptionManager.unsubscribe('privateChat');

    currentPrivateChatRef = db.ref(`privateChats/${getPrivateChatId(auth.currentUser.uid, targetUid)}`).orderByChild('timestamp').limitToLast(50);
    window.AppSubscriptionManager.subscribe('privateChat', currentPrivateChatRef, (s) => {
        const chatBody = document.getElementById('private-chat-messages'); chatBody.innerHTML = '';
        const now = Date.now();
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000; // 3일을 밀리초로 계산

        s.forEach(child => {
            const msg = child.val();
            if (now - msg.timestamp > threeDaysMs) return; // 3일 지난 메시지는 화면에 표시하지 않음(초기화)

            const isMine = msg.uid === auth.currentUser.uid;

            // 상대방 메시지를 읽었을 때 DB에 읽음(read: true) 업데이트 (카카오톡 숫자 1 사라지는 기능)
            if (!isMine && !msg.read && document.getElementById('private-chat-window').style.display === 'flex') {
                child.ref.update({ read: true });
            }

            const msgEl = document.createElement('div'); msgEl.className = `chat-message ${isMine ? 'mine' : 'others'}`;
            const readMark = (isMine && !msg.read) ? `<span style="font-size:0.75rem; color:#F59E0B; font-weight:bold; margin:0 4px 2px 4px;">1</span>` : '';

            const escapedText = escapeHTML(msg.text);
            const escapedSender = escapeHTML(msg.sender);
            if (isMine) msgEl.innerHTML = `<div style="display:flex; align-items:flex-end;">${readMark}<div class="chat-bubble">${escapedText}</div></div>`;
            else msgEl.innerHTML = `<div class="chat-sender">${escapedSender}</div><div class="chat-bubble">${escapedText}</div>`;
            chatBody.appendChild(msgEl);
        });
        setTimeout(() => chatBody.scrollTop = chatBody.scrollHeight, 10);
    });
}
function closePrivateChat() { document.getElementById('private-chat-window').style.display = 'none'; window.AppSubscriptionManager.unsubscribe('privateChat'); currentPrivateChatRef = null; currentPrivateChatTargetUid = null; }

window.cleanupPrivateChatState = function() {
    closePrivateChat();
    privateChatListeners = {};
    const input = document.getElementById('private-chat-input');
    if (input) input.value = '';
    const body = document.getElementById('private-chat-messages');
    if (body) body.innerHTML = '';
};

function handlePrivateChatEnter(event) { if (event.key === 'Enter') { event.preventDefault(); if (event.isComposing) return; sendPrivateMessage(); } }
async function sendPrivateMessage() {
    const currentUserProfile = AppStore.getCurrentUser();
    const text = document.getElementById('private-chat-input').value.trim(); if (!text || !currentPrivateChatTargetUid) return;

    const messageData = {
        uid: auth.currentUser.uid,
        sender: currentUserProfile.displayName,
        text: text,
        timestamp: Date.now(),
        read: false
    };

    db.ref(`privateChats/${getPrivateChatId(auth.currentUser.uid, currentPrivateChatTargetUid)}`).push(messageData);

    // 알림 발송
    sendNotification(currentPrivateChatTargetUid, {
        title: `${currentUserProfile.displayName}님의 메시지`,
        message: text.length > 30 ? text.substring(0, 30) + '...' : text,
        type: 'chat',
        link: 'chat'
    });

    document.getElementById('private-chat-input').value = '';
}

function toggleChatListWindow() {
    const listWindow = document.getElementById('chat-list-window'), groupWindow = document.getElementById('chat-window'), privateWindow = document.getElementById('private-chat-window');
    if (groupWindow.style.display === 'flex' || privateWindow.style.display === 'flex') { groupWindow.style.display = 'none'; privateWindow.style.display = 'none'; listWindow.style.display = 'flex'; return; }
    if (listWindow.style.display === 'none' || listWindow.style.display === '') { listWindow.style.display = 'flex'; renderChatList(); } else listWindow.style.display = 'none';
}
function backToChatList() { document.getElementById('chat-window').style.display = 'none'; closePrivateChat(); document.getElementById('chat-list-window').style.display = 'flex'; }
function openGroupChat() { document.getElementById('chat-list-window').style.display = 'none'; document.getElementById('chat-window').style.display = 'flex'; setTimeout(() => document.getElementById('chat-input').focus(), 100); ChatReadTracker.set('group'); ChatUnreadCount.group = 0; saveUnreadCounts(); }

function renderChatList() {
    const currentUserProfile = AppStore.getCurrentUser();
    const listBody = document.getElementById('chat-list-body'); if (!listBody) return; listBody.innerHTML = '';
    if (!auth.currentUser || !currentUserProfile || !currentUserProfile.approved) return;

    const groupItem = document.createElement('div'); groupItem.className = 'chat-list-item'; groupItem.onclick = openGroupChat;
    groupItem.innerHTML = `<div style="width:48px;height:48px;border-radius:18px;background:var(--primary);color:white;display:flex;justify-content:center;align-items:center;margin-right:12px;"><span class="material-symbols-rounded">groups</span></div><div style="flex:1;font-weight:700;">사내 단체 채팅방</div><div id="badge-group" class="unread-badge" style="display:none;">0</div>`; listBody.appendChild(groupItem);

    Object.keys(AppStore.getUsers()).forEach(uid => {
        if (uid === auth.currentUser.uid) return;
        const u = AppStore.getUsers()[uid]; if (!u.approved) return;
        const item = document.createElement('div'); item.className = 'chat-list-item'; item.onclick = () => openPrivateChat(uid, u.displayName);
        item.innerHTML = `<img src="${u.photoURL || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%23E5E7EB'/%3E%3C/svg%3E"}" style="width:48px;height:48px;border-radius:18px;margin-right:12px; object-fit: cover;"><div style="flex:1;font-weight:600;">${u.displayName}</div><div id="badge-${uid}" class="unread-badge" style="display:none;">0</div>`; listBody.appendChild(item);
    });
    updateChatBadges(); // 렌더링 즉시 배지 상태 점검
}
function handleChatEnter(event) { if (event.key === 'Enter') { event.preventDefault(); if (event.isComposing) return; sendChatMessage(); } }
async function sendChatMessage() {
    const currentUserProfile = AppStore.getCurrentUser();
    const text = document.getElementById('chat-input').value.trim(); if (!text) return;
    db.ref('chatMessages').push({ uid: auth.currentUser.uid, sender: currentUserProfile.displayName, text: text, timestamp: Date.now() });
    document.getElementById('chat-input').value = '';
}

// 단체 채팅 알림 및 리스너
window.listenForChatMessages = function() {
window.AppSubscriptionManager.subscribe('chatMessages', db.ref('chatMessages').orderByChild('timestamp').limitToLast(50), (s) => {
    const chatBody = document.getElementById('chat-messages'); if (!chatBody) return; chatBody.innerHTML = '';
    let latestMsg = null;
    const now = Date.now();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000; // 3일을 밀리초로 계산

    s.forEach(child => {
        const msg = child.val();
        if (now - msg.timestamp > threeDaysMs) return; // 3일 지난 메시지는 화면에 표시하지 않음(초기화)

        const isMine = auth.currentUser && auth.currentUser.uid === msg.uid;
        latestMsg = msg;
        const msgEl = document.createElement('div'); msgEl.className = `chat-message ${isMine ? 'mine' : 'others'}`;
        const escapedText = escapeHTML(msg.text);
        const escapedSender = escapeHTML(msg.sender);
        msgEl.innerHTML = `${!isMine ? `<div class="chat-sender">${escapedSender}</div>` : ''}<div class="chat-bubble">${escapedText}</div>`; chatBody.appendChild(msgEl);
    });
    setTimeout(() => chatBody.scrollTop = chatBody.scrollHeight, 10);

    if (latestMsg) {
        ChatLatestTracker.group = latestMsg.timestamp;
        const isOpen = document.getElementById('chat-window').style.display === 'flex';
        if (isOpen) {
            ChatReadTracker.set('group');
            ChatNotifiedTracker.group = latestMsg.timestamp;
            ChatUnreadCount.group = 0; saveUnreadCounts();
        } else if (latestMsg.timestamp > ChatNotifiedTracker.group && auth.currentUser && latestMsg.uid !== auth.currentUser.uid) {
            ChatUnreadCount.group++; saveUnreadCounts();
            ChatNotifiedTracker.group = latestMsg.timestamp;
        }
    }
});
};

// 1:1 개인 채팅 알림 및 리스너
let privateChatListeners = {};
function setupPrivateChatNotificationListeners() {
    const currentUid = auth.currentUser ? auth.currentUser.uid : null; if (!currentUid) return;
    Object.keys(AppStore.getUsers()).forEach(targetUid => {
        if (targetUid === currentUid) return;
        const chatId = getPrivateChatId(currentUid, targetUid);
        if (!window.AppSubscriptionManager.subs['privateChats_list_' + chatId]) {
            // 🔥 로컬 저장이 아닌, DB에서 실제로 내가 안 읽은 메시지만 정확히 카운트합니다.
            window.AppSubscriptionManager.subscribe('privateChats_list_' + chatId, db.ref(`privateChats/${chatId}`).orderByChild('timestamp').limitToLast(50), (s) => {
                let unreadCount = 0;
                let latestMsg = null;
                const now = Date.now();
                const threeDaysMs = 3 * 24 * 60 * 60 * 1000;

                s.forEach(c => {
                    const msg = c.val();
                    if (now - msg.timestamp > threeDaysMs) return; // 3일 지난 메시지는 무시
                    latestMsg = msg;
                    // 상대방이 보낸 메시지 중 아직 읽지 않은(read: false) 메시지의 개수를 셈
                    if (msg.uid !== currentUid && !msg.read) unreadCount++;
                });

                ChatUnreadCount.private[targetUid] = unreadCount;
                saveUnreadCounts();

                if (latestMsg) {
                    const isOpen = currentPrivateChatTargetUid === targetUid && document.getElementById('private-chat-window').style.display === 'flex';
                    if (!ChatNotifiedTracker.private[targetUid]) ChatNotifiedTracker.private[targetUid] = Date.now();

                    if (isOpen) {
                        ChatReadTracker.set(targetUid);
                        ChatNotifiedTracker.private[targetUid] = latestMsg.timestamp;
                    } else if (latestMsg.timestamp > ChatNotifiedTracker.private[targetUid] && latestMsg.uid !== currentUid) {
                        ChatNotifiedTracker.private[targetUid] = latestMsg.timestamp;
                    }
                }
            });
            privateChatListeners[chatId] = true;
        }
    });
}

// ----------------------------------------------------
// 전사 공지사항
// ----------------------------------------------------
let currentNoticeId = null;
let currentReplyToId = null;
let currentReplyToName = '';
function renderNotices() {
    const listEl = document.getElementById('notice-list'); if (!listEl) return; listEl.innerHTML = '';

    // 중요 공지를 최상단으로 (isImportant 기준 내림차순, 그다음 시간 내림차순)
    Object.values(AppStore.getNotices()).sort((a, b) => {
        const aImp = !!a.isImportant;
        const bImp = !!b.isImportant;
        if (aImp !== bImp) return bImp ? 1 : -1;
        return b.timestamp - a.timestamp;
    }).forEach(notice => {
        const li = document.createElement('li');
        li.className = `notice-item ${notice.isImportant ? 'notice-important' : ''}`;

        // 중요 공지인 경우 아이콘 또는 배지 추가
        const importantBadge = notice.isImportant ? `<span class="notice-badge-important">필독</span>` : '';

        li.innerHTML = `
            <div class="notice-item-title">${importantBadge}${notice.title}</div>
            <div class="notice-item-author">${notice.author}</div>
            <div class="notice-item-date">${new Date(notice.timestamp).toLocaleDateString()}</div>
            <div class="notice-item-views">${notice.views || 0}</div>
        `;
        li.onclick = () => viewNotice(notice.id);
        listEl.appendChild(li);
    });
}
function viewNotice(id) {
    const notice = AppStore.getNotices()[id];
    if (!notice) return;
    if (currentNoticeId && currentNoticeId !== id) {
        window.AppSubscriptionManager.unsubscribe('noticeComments_' + currentNoticeId);
        window.AppSubscriptionManager.unsubscribe('noticeLikes_' + currentNoticeId);
    }
    currentNoticeId = id;
    document.getElementById('noticeTitleInput').value = notice.title;
    document.getElementById('noticeContentInput').value = notice.content;

    // 중요 공지 체크박스 및 라벨 설정
    const importantInput = document.getElementById('noticeImportantInput');
    const isImportantLabel = document.getElementById('noticeImportantLabel');
    if (importantInput) {
        importantInput.checked = !!notice.isImportant;
        importantInput.disabled = true; // 읽기 모드에서는 비활성화
    }
    if (isImportantLabel) {
        if (notice.isImportant) {
            isImportantLabel.style.display = 'flex';
            isImportantLabel.style.cursor = 'default';
            isImportantLabel.style.opacity = '0.85';
        } else {
            isImportantLabel.style.display = 'none';
        }
    }

    // 초기에는 항상 읽기 전용
    document.getElementById('noticeTitleInput').readOnly = true;
    document.getElementById('noticeContentInput').readOnly = true;

    // 권한 확인 (작성자 본인 또는 최고 관리자만 가능하게 허용)
    const isAuthor = notice.uid === (auth.currentUser ? auth.currentUser.uid : '');
    const isAdmin = auth.currentUser && (ADMIN_UIDS.includes(auth.currentUser.uid) || (typeof ADMIN_EMAILS !== 'undefined' && auth.currentUser.email && ADMIN_EMAILS.includes(auth.currentUser.email)));
    const canEdit = isAuthor || isAdmin;

    // 버튼 노출 제어
    document.getElementById('noticeEditBtn').style.display = canEdit ? 'flex' : 'none';
    document.getElementById('noticeSaveBtn').style.display = 'none';
    document.getElementById('noticeDeleteBtn').style.display = canEdit ? 'inline-block' : 'none';

    // 정보 표시
    const info = document.getElementById('noticeInfo');
    info.style.display = 'flex';
    document.getElementById('noticeAuthorDate').textContent = `${notice.author || '익명'} | ${new Date(notice.timestamp).toLocaleDateString()}`;
    document.getElementById('noticeViews').textContent = `조회수 ${notice.views || 0}`;

    // 댓글 로드
    document.getElementById('noticeCommentSection').style.display = 'block';
    document.getElementById('noticeLikeSection').style.display = 'flex';
    document.getElementById('noticeCommentInput').value = '';
    cancelReply();
    loadComments(id);

    // 실시간 공감(좋아요) 리스너
    window.AppSubscriptionManager.subscribe('noticeLikes_' + id, db.ref(`notices/${id}/likes`), s => {
        if (currentNoticeId !== id) return;
        const likesObj = s.val() || {};
        const uid = auth.currentUser ? auth.currentUser.uid : null;
        const hasLiked = uid && likesObj[uid];
        const count = Object.keys(likesObj).length;
        document.getElementById('noticeLikeCount').textContent = count;
        document.getElementById('noticeLikeIcon').style.fontVariationSettings = hasLiked ? "'FILL' 1" : "'FILL' 0";
        document.getElementById('noticeLikeIcon').style.color = hasLiked ? 'var(--danger)' : 'inherit';
        document.getElementById('noticeLikeBtn').style.color = hasLiked ? 'var(--danger)' : 'var(--text-main)';
        document.getElementById('noticeLikeBtn').style.borderColor = hasLiked ? 'var(--danger)' : 'var(--border-color)';
    });

    document.getElementById('noticeModal').style.display = 'flex';
    db.ref('notices/' + id + '/views').set((notice.views || 0) + 1);
}

// 수정 모드 활성화 함수
function enableNoticeEdit() {
    document.getElementById('noticeTitleInput').readOnly = false;
    document.getElementById('noticeContentInput').readOnly = false;

    // 중요 공지 편집 제어 (최고 관리자만 수정 및 상단 고정 제어 가능)
    const isAdmin = auth.currentUser && (ADMIN_UIDS.includes(auth.currentUser.uid) || (typeof ADMIN_EMAILS !== 'undefined' && auth.currentUser.email && ADMIN_EMAILS.includes(auth.currentUser.email)));
    const importantInput = document.getElementById('noticeImportantInput');
    const isImportantLabel = document.getElementById('noticeImportantLabel');
    if (isImportantLabel) {
        isImportantLabel.style.display = isAdmin ? 'flex' : 'none';
        isImportantLabel.style.cursor = isAdmin ? 'pointer' : 'default';
        isImportantLabel.style.opacity = '1';
    }
    if (importantInput) {
        importantInput.disabled = !isAdmin;
    }

    document.getElementById('noticeEditBtn').style.display = 'none';
    document.getElementById('noticeSaveBtn').style.display = 'inline-block';
    document.getElementById('noticeTitleInput').focus();
    showToast('편집 모드로 전환되었습니다.', 'info');
}

function loadComments(noticeId) {
    window.AppSubscriptionManager.subscribe('noticeComments_' + noticeId, db.ref('notices/' + noticeId + '/comments'), (s) => {
        if (currentNoticeId !== noticeId) return;
        renderComments(s.val() || {});
    });
}

function renderComments(comments) {
    const listEl = document.getElementById('noticeCommentList');
    const countEl = document.getElementById('noticeCommentCount');
    if (!listEl) return;
    listEl.innerHTML = '';

    const commentArray = Object.values(comments);

    // 루트 댓글 및 부모가 존재하는 유효한 대댓글만 선별하여 고아 대댓글로 인한 카운트 오류 방지
    const rootComments = commentArray.filter(c => !c.parentId).sort((a, b) => a.timestamp - b.timestamp);
    const rootIds = new Set(rootComments.map(c => c.id));
    const validReplies = commentArray.filter(c => c.parentId && rootIds.has(c.parentId)).sort((a, b) => a.timestamp - b.timestamp);

    const totalCount = rootComments.length + validReplies.length;
    countEl.textContent = totalCount;

    if (totalCount === 0) {
        listEl.innerHTML = '<div style="text-align:center; color:var(--text-muted); font-size:0.85rem; padding: 1.5rem 0;">첫 번째 댓글을 남겨보세요! 😊</div>';
        return;
    }

    const currentUid = auth.currentUser ? auth.currentUser.uid : null;

    const renderSingleComment = (c, isReply) => {
        const div = document.createElement('div');
        div.style.cssText = `display:flex; flex-direction:column; gap:4px; padding: 10px 14px; background:var(--card-bg); border-radius:12px; border:1px solid var(--border-color); position:relative; animation: fadeIn 0.3s ease; ${isReply ? 'margin-left: 24px; background:#F9FAFB;' : ''}`;

        const isMyComment = currentUid && c.uid === currentUid;
        const deleteBtn = isMyComment ? `<button onclick="deleteComment('${c.id}')" style="position:absolute; right:8px; top:8px; background:transparent; color:var(--text-muted); border:none; padding:4px; cursor:pointer;" title="댓글 삭제"><span class="material-symbols-rounded" style="font-size:1.1rem;">close</span></button>` : '';

        const likesObj = c.likes || {};
        const likesCount = Object.keys(likesObj).length;
        const hasLiked = currentUid && likesObj[currentUid];

        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:700; font-size:0.85rem; color:var(--primary);">
                    ${isReply ? '<span class="material-symbols-rounded" style="font-size:1.1rem; color:var(--text-muted); vertical-align:middle; margin-right:4px;">subdirectory_arrow_right</span>' : ''}
                    ${c.author}
                </span>
                <span style="font-size:0.7rem; color:var(--text-muted); margin-right: 25px;">${new Date(c.timestamp).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div style="font-size:0.9rem; color:var(--text-main); word-break:break-all; line-height:1.5; ${isReply ? 'margin-left:22px;' : ''}">${c.content}</div>
            <div style="display:flex; gap: 12px; margin-top: 4px; align-items:center; ${isReply ? 'margin-left:22px;' : ''}">
                <button onclick="toggleCommentLike('${c.id}')" style="background:transparent; border:none; padding:0; cursor:pointer; display:flex; align-items:center; gap:4px; font-size:0.8rem; font-weight:600; color:${hasLiked ? 'var(--danger)' : 'var(--text-muted)'}; transition:color 0.2s;">
                    <span class="material-symbols-rounded" style="font-size:1.05rem; ${hasLiked ? "font-variation-settings: 'FILL' 1;" : ''}">favorite</span>
                    ${likesCount}
                </button>
                ${!isReply ? `<button onclick="setReplyTo('${c.id}', '${c.author}')" style="background:transparent; border:none; padding:0; cursor:pointer; display:flex; align-items:center; gap:2px; font-size:0.8rem; font-weight:600; color:var(--text-muted); transition:color 0.2s;"><span class="material-symbols-rounded" style="font-size:1.1rem;">reply</span> 답글 달기</button>` : ''}
            </div>
            ${deleteBtn}
        `;
        listEl.appendChild(div);
    };

    rootComments.forEach(root => {
        renderSingleComment(root, false);
        validReplies.filter(r => r.parentId === root.id).forEach(reply => {
            renderSingleComment(reply, true);
        });
    });

    listEl.scrollTop = listEl.scrollHeight;
}

async function saveComment() {
    if (!currentNoticeId) return;
    const input = document.getElementById('noticeCommentInput');
    const content = input.value.trim();
    if (!content) return;

    if (!(await checkAuth('승인된 사용자만 댓글을 작성할 수 있습니다.'))) return;
    const user = AppStore.getCurrentUser();

    const ref = db.ref('notices/' + currentNoticeId + '/comments').push();
    const data = {
        id: ref.key,
        noticeId: currentNoticeId,
        content: content,
        author: user.displayName,
        uid: auth.currentUser.uid,
        timestamp: Date.now()
    };
    if (currentReplyToId) {
        data.parentId = currentReplyToId;
    }

    ref.set(data).then(() => {
        input.value = '';
        cancelReply();
    }).catch(e => {
        console.error('[Comment] Save failed:', e);
        showToast('댓글 등록 실패: ' + e.message, 'error');
    });
}

async function deleteComment(commentId) {
    if (!currentNoticeId) return;
    if (await customConfirm('댓글을 삭제하시겠습니까?')) {
        try {
            // 1. Firebase에서 전체 댓글 데이터를 한 번 읽어옵니다.
            const snapshot = await db.ref('notices/' + currentNoticeId + '/comments').once('value');
            const commentsObj = snapshot.val() || {};

            // 2. 삭제할 댓글과 그 대댓글(parentId가 삭제할 commentId인 것) 목록을 구하여 동시 삭제
            const deletePromises = [];
            deletePromises.push(db.ref('notices/' + currentNoticeId + '/comments/' + commentId).remove());

            Object.values(commentsObj).forEach(c => {
                if (c.parentId === commentId) {
                    deletePromises.push(db.ref('notices/' + currentNoticeId + '/comments/' + c.id).remove());
                }
            });

            await Promise.all(deletePromises);
            showToast('댓글이 삭제되었습니다.', 'info');
        } catch (e) {
            console.error('[Comment] Delete failed:', e);
            showToast('삭제 실패: ' + e.message, 'error');
        }
    }
}

function setReplyTo(commentId, authorName) {
    currentReplyToId = commentId;
    currentReplyToName = authorName;
    document.getElementById('replyIndicator').style.display = 'flex';
    document.getElementById('replyToName').textContent = authorName;
    document.getElementById('noticeCommentInput').focus();
}

function cancelReply() {
    currentReplyToId = null;
    currentReplyToName = '';
    document.getElementById('replyIndicator').style.display = 'none';
}

function toggleNoticeLike() {
    if (!currentNoticeId || !auth.currentUser) return showToast('로그인이 필요합니다.', 'error');
    const uid = auth.currentUser.uid;
    const ref = db.ref(`notices/${currentNoticeId}/likes/${uid}`);
    ref.once('value').then(s => {
        if (s.exists()) ref.remove();
        else ref.set(true);
    });
}

function toggleCommentLike(commentId) {
    if (!currentNoticeId || !auth.currentUser) return showToast('로그인이 필요합니다.', 'error');
    const uid = auth.currentUser.uid;
    const ref = db.ref(`notices/${currentNoticeId}/comments/${commentId}/likes/${uid}`);
    ref.once('value').then(s => {
        if (s.exists()) ref.remove();
        else ref.set(true);
    });
}

function openNoticeModal() {
    currentNoticeId = null;
    document.getElementById('noticeTitleInput').value = '';
    document.getElementById('noticeContentInput').value = '';

    // 중요 공지 체크박스 초기화 및 활성화 (최고 관리자 전용)
    const isAdmin = auth.currentUser && (ADMIN_UIDS.includes(auth.currentUser.uid) || (typeof ADMIN_EMAILS !== 'undefined' && auth.currentUser.email && ADMIN_EMAILS.includes(auth.currentUser.email)));
    const importantInput = document.getElementById('noticeImportantInput');
    const isImportantLabel = document.getElementById('noticeImportantLabel');

    if (isImportantLabel) {
        isImportantLabel.style.display = isAdmin ? 'flex' : 'none';
        isImportantLabel.style.cursor = isAdmin ? 'pointer' : 'default';
        isImportantLabel.style.opacity = '1';
    }
    if (importantInput) {
        importantInput.checked = false;
        importantInput.disabled = !isAdmin;
    }

    document.getElementById('noticeTitleInput').readOnly = false;
    document.getElementById('noticeContentInput').readOnly = false;
    document.getElementById('noticeInfo').style.display = 'none';
    document.getElementById('noticeCommentSection').style.display = 'none';
    document.getElementById('noticeEditBtn').style.display = 'none';
    document.getElementById('noticeSaveBtn').style.display = 'inline-block';
    document.getElementById('noticeDeleteBtn').style.display = 'none';
    document.getElementById('noticeModal').style.display = 'flex';
}
function closeNoticeModal() {
    document.getElementById('noticeModal').style.display = 'none';
    if (currentNoticeId) { // 리스너 해제 (실제 구독 경로: notices/{id}/comments, notices/{id}/likes)
        window.AppSubscriptionManager.unsubscribe('noticeComments_' + currentNoticeId);
        window.AppSubscriptionManager.unsubscribe('noticeLikes_' + currentNoticeId);
    }
    currentNoticeId = null;
}
async function saveNotice() {
    const currentUserProfile = AppStore.getCurrentUser();
    const title = document.getElementById('noticeTitleInput').value.trim(), content = document.getElementById('noticeContentInput').value.trim(); if (!title || !content) return;

    // 중요 공지 여부 가져오기
    const isImportant = document.getElementById('noticeImportantInput')?.checked || false;

    // 기존 글 수정 시 원본 권한(UID) 및 작성자명 유지
    const notice = currentNoticeId ? AppStore.getNotices()[currentNoticeId] : null;
    const authorUid = notice ? notice.uid : auth.currentUser.uid;
    const authorName = notice ? notice.author : currentUserProfile.displayName;

    const data = {
        title: title,
        content: content,
        author: authorName,
        uid: authorUid,
        timestamp: currentNoticeId ? notice.timestamp : Date.now(),
        views: currentNoticeId ? notice.views : 0,
        isImportant: isImportant
    };
    if (currentNoticeId) {
        db.ref('notices/' + currentNoticeId).update(data);
    } else {
        const ref = db.ref('notices').push();
        data.id = ref.key;
        ref.set(data).then(() => {
            // 전사 알림 발송
            sendNotificationToAll({
                title: isImportant ? "🚨 [필독] 새로운 공지사항" : "새로운 공지사항",
                message: title,
                type: 'notice',
                link: 'notice'
            });
        });
    }
    closeNoticeModal();
}
async function deleteNotice() {
    if (await customConfirm('이 공지사항을 삭제하시겠습니까?')) {
        db.ref('notices/' + currentNoticeId).remove();
        closeNoticeModal();
    }
}

// 공지사항 데이터 실시간 동기화
// 공지사항 최적화: 최신 50개만 로드
window.listenForNotices = function() {
window.AppSubscriptionManager.subscribe('notices', db.ref('notices').orderByKey().limitToLast(50), (s) => {
    const data = s.val() || {};
    for (let key in data) data[key].id = key;
    AppStore.setNotices(data);

    if (typeof renderNotices === 'function') renderNotices();
});
};

// ----------------------------------------------------
// Google 캘린더 연동
// ----------------------------------------------------
/**
 * Google 캘린더 연동 및 동기화를 위한 함수
 */
let googleAccessToken = localStorage.getItem('google_access_token'); // 영구 유지를 위해 localStorage 사용

async function linkGoogleCalendar() {
    const user = auth.currentUser;
    const syncBtn = document.getElementById('btn-google-sync');

    if (!user) {
        return await customAlert('먼저 로그인해주세요.');
    }

    // [권한 제한] 지정된 대표 계정(contact@faww.co.kr) 또는 최고 관리자만 구글 캘린더 연동 수행 가능
    const targetEmail = typeof ALLOWED_GOOGLE_SYNC_EMAIL !== 'undefined' ? ALLOWED_GOOGLE_SYNC_EMAIL : 'contact@faww.co.kr';
    const isAllowedEmail = user.email === targetEmail;
    const isAdmin = typeof ADMIN_UIDS !== 'undefined' && (ADMIN_UIDS.includes(user.uid) || (typeof ADMIN_EMAILS !== 'undefined' && user.email && ADMIN_EMAILS.includes(user.email)));

    if (!isAllowedEmail && !isAdmin) {
        return await customAlert(`🔒 Google 캘린더 연동은 지정된 대표 계정(${targetEmail})만 가능합니다.\n\n현재 계정: ${user.email}`);
    }

    // [신규] 버튼을 누를 때마다 무조건 기존 연결을 초기화하고 강제 재인증 (자동 로그인 버그 100% 원천 차단)
    googleAccessToken = null;
    localStorage.removeItem('google_access_token');
    invalidateGoogleSyncSession(); // 진행 중인 이전 동기화 요청의 추가 쓰기·알림 중단

    // 1. Google Calendar API 접근을 위한 'scope' 추가 (출장 데이터 자동 쓰기 동기화를 위해 calendar 권한 획득)
    const calendarProvider = new firebase.auth.GoogleAuthProvider();
    calendarProvider.addScope('https://www.googleapis.com/auth/calendar');
    
    // [신규] 무조건 contact@faww.co.kr 계정으로만 로그인하도록 팝업에 강제 지시 (login_hint) 및 자동 로그인 방지 (prompt: select_account)
    const forcedTargetEmail = 'contact@faww.co.kr';
    calendarProvider.setCustomParameters({
        login_hint: forcedTargetEmail,
        prompt: 'select_account'
    });

    try {
        if (syncBtn) {
            syncBtn.disabled = true;
            syncBtn.innerHTML = '<div class="spinner-small"></div> 연동 중...';
        }

        // 2. 권한 획득 팝업
        const result = await firebase.auth().signInWithPopup(calendarProvider);
        
        // [신규] 실제로 연동된 구글 계정이 contact@faww.co.kr 인지 2차 검증 (아니면 튕겨냄)
        const linkedGoogleEmail = (result.additionalUserInfo && result.additionalUserInfo.profile && result.additionalUserInfo.profile.email) ? result.additionalUserInfo.profile.email : null;
        if (linkedGoogleEmail && linkedGoogleEmail.toLowerCase() !== forcedTargetEmail.toLowerCase()) {
            if (syncBtn) {
                syncBtn.disabled = false;
                syncBtn.innerHTML = '🔄 캘린더 동기화';
            }
            return await customAlert(`🚫 구글 캘린더 연동 실패!\n\n반드시 공용 캘린더 계정인 [${forcedTargetEmail}] 계정으로만 연동해야 합니다.\n\n현재 선택하신 계정: [${linkedGoogleEmail}]\n다시 시도해주세요.`);
        }

        googleAccessToken = result.credential.accessToken;

        // 토큰 영구 저장 (새로고침/재방문 시 유지용)
        if (googleAccessToken) {
            localStorage.setItem('google_access_token', googleAccessToken);
            updateGoogleSyncUI();
            // 즉시 첫 동기화 실행
            fetchGoogleCalendarEvents();
            // 10분마다 자동 동기화 타이머 시작
            startGoogleSyncTimer();
        }

        if (googleAccessToken) {
            showToast('Google 캘린더 연동에 성공했습니다!', 'success');

            // 3. 즉시 일정 데이터 가져오기 시도
            if (typeof fetchGoogleCalendarEvents === 'function') {
                await fetchGoogleCalendarEvents();
            }
        }

    } catch (error) {
        console.error('🔥 Google 캘린더 연동 오류:', error);
        if (syncBtn) {
            syncBtn.disabled = false;
        }
        updateGoogleSyncUI();
        await customAlert(`캘린더 연동 중 오류가 발생했습니다.\n\n상세: ${error.message}`);
    }
}



let isSyncingGoogleCalendar = false; // 현재 유효한 세션의 동기화 진행 여부 (호환용 표시값)

// [동기화 세션 관리]
// - googleSyncEpoch: 로그아웃·연동 해제·재연동 시 증가시켜 이전 요청을 무효화한다.
// - activeGoogleSync: 현재 잠금을 보유한 동기화 세션. finally에서는 자신이 보유한 잠금만 해제한다.
// - 세션 무효화는 "이후" 쓰기·알림만 막는다. 이미 서버로 전송된 쓰기는 취소하지 못한다.
let googleSyncEpoch = 0;
let googleSyncSeq = 0;
let activeGoogleSync = null;
const GOOGLE_SYNC_ABORTED = Object.freeze({ name: 'GoogleSyncAborted', message: '동기화 세션이 변경되어 중단되었습니다.' });
const GOOGLE_SYNC_WRITE_BATCH_SIZE = 10;

function getCurrentFirebaseUid() {
    return (typeof auth !== 'undefined' && auth && auth.currentUser) ? auth.currentUser.uid : null;
}

/**
 * 로그아웃·계정 전환·연동 해제·재연동 시 호출하여
 * 진행 중인 이전 동기화 요청의 추가 DB 쓰기와 알림을 중단시킨다.
 */
function invalidateGoogleSyncSession() {
    googleSyncEpoch++;
    activeGoogleSync = null;
    isSyncingGoogleCalendar = false;
}

function isGoogleSyncSessionValid(session) {
    return !!session
        && !!googleAccessToken
        && session.epoch === googleSyncEpoch
        && session.token === googleAccessToken
        && session.uid === getCurrentFirebaseUid();
}

function assertGoogleSyncSession(session) {
    if (!isGoogleSyncSessionValid(session)) throw GOOGLE_SYNC_ABORTED;
}

function isValidFirebaseKey(key) {
    return typeof key === 'string' && key.length > 0 && key.length <= 768 && !/[.#$\[\]\/\u0000-\u001F\u007F]/.test(key);
}

/**
 * calendarList의 모든 페이지를 순서대로 확인하여 'FAWW' 캘린더를 찾는다.
 * - 찾으면 즉시 반환하고, 모든 페이지에 없을 때만 null을 반환한다.
 * - 중간 페이지 조회 실패 시 예외를 던진다. (호출 측에서 캘린더 생성·DB 저장을 하지 않음)
 * - checkpoint: 각 비동기 응답 직후 호출되는 세션 확인 콜백 (선택)
 */
async function findFawwCalendarInList(token, checkpoint) {
    const seenTokens = new Set();
    let pageToken = null;
    do {
        const params = new URLSearchParams();
        if (pageToken) params.set('pageToken', pageToken);
        const qs = params.toString();
        const url = `https://www.googleapis.com/calendar/v3/users/me/calendarList${qs ? `?${qs}` : ''}`;

        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (checkpoint) checkpoint();
        if (res.status === 401) {
            throw { status: 401, message: 'Google 인증 세션이 만료되었습니다. 다시 연동해주세요.' };
        }
        if (!res.ok) {
            throw new Error(`캘린더 목록을 가져오지 못했습니다. (HTTP ${res.status}, 페이지 토큰: ${pageToken || '없음'})`);
        }
        const data = await res.json();
        if (checkpoint) checkpoint();

        const items = (data && Array.isArray(data.items)) ? data.items : [];
        const found = items.find(cal => cal && typeof cal.summary === 'string' && cal.summary.toUpperCase() === 'FAWW');
        if (found) return found;

        const next = (data && data.nextPageToken) ? String(data.nextPageToken) : null;
        if (next && seenTokens.has(next)) {
            throw new Error('캘린더 목록 페이지 토큰이 반복되어 조회를 중단합니다.');
        }
        if (next) seenTokens.add(next);
        pageToken = next;
    } while (pageToken);
    return null;
}

/**
 * Google 일정 1건을 external_events의 Google 관리 필드로 변환한다. (순수 함수)
 */
function mapGoogleEventToExternalFields(item) {
    if (!item || !item.start) return null;
    let start = null;
    let end = null;
    let timeStr = "";

    if (item.start.dateTime) {
        const dt = new Date(item.start.dateTime);
        start = item.start.dateTime.split('T')[0];
        timeStr = ` [${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}]`;
        if (item.end && item.end.dateTime) {
            end = item.end.dateTime.split('T')[0];
        }
    } else if (item.start.date) {
        start = item.start.date;
        if (item.end && item.end.date) {
            const dtEnd = new Date(item.end.date);
            dtEnd.setDate(dtEnd.getDate() - 1);
            const endYear = dtEnd.getFullYear();
            const endMonth = String(dtEnd.getMonth() + 1).padStart(2, '0');
            const endDateVal = String(dtEnd.getDate()).padStart(2, '0');
            end = `${endYear}-${endMonth}-${endDateVal}`;
        }
    }

    if (!start) return null;
    if (!end) end = start;
    if (new Date(end).getTime() < new Date(start).getTime()) {
        end = start;
    }

    return {
        id: item.id,
        title: `${timeStr} ${item.summary || '(제목 없음)'}`,
        description: htmlToPlainText(item.description || ''),
        location: item.location || '',
        startDate: start,
        dueDate: end
    };
}

/**
 * external_events/{id} 트랜잭션 콜백에서 사용하는 순수 함수.
 * - 알림·외부 API 호출 등 부수 효과 없음 (Firebase가 재시도 시 여러 번 호출할 수 있음)
 * - 현재 DB 값이 없을 때만 앱 관리 기본값(담당자·상태 등)을 생성한다.
 * - 이미 존재하면 Google 관리 필드만 갱신하고 앱 관리 필드는 보존한다.
 * - 세션이 무효화되었으면 undefined를 반환하여 트랜잭션을 중단한다.
 */
function buildExternalEventTransactionValue(currentData, data, session) {
    if (session && !isGoogleSyncSessionValid(session)) return undefined;

    const googleFields = {
        title: data.title,
        description: data.description,
        location: data.location,
        dueDate: data.dueDate,
        startDate: data.startDate
    };

    if (currentData === null || currentData === undefined || typeof currentData !== 'object') {
        return {
            id: data.id,
            title: googleFields.title,
            description: googleFields.description,
            location: googleFields.location,
            dueDate: googleFields.dueDate,
            startDate: googleFields.startDate,
            isExternal: true,
            status: 'todo',
            priority: 'low',
            assignee: 'FAWW 연동',
            type: 'task'
        };
    }
    return Object.assign({}, currentData, googleFields);
}

/**
 * Google Calendar API로부터 이름이 'FAWW'인 캘린더의 일정만 가져오는 함수
 *
 * 처리 순서
 * 1) 시작 시 Firebase UID · Google 토큰 · 세션 epoch를 캡처한다.
 * 2) calendarList 전 페이지 확인 → (없을 때만) 캘린더 생성 → 일정 전 페이지 수집 · 검증
 * 3) 모든 수집 · 검증이 끝난 뒤에만 일정별 transaction으로 DB에 반영한다.
 * 4) 비동기 응답 직후 · 캘린더 생성 전 · DB 쓰기 직전마다 세션 유효성을 확인한다.
 */
async function fetchGoogleCalendarEvents() {
    const session = {
        id: ++googleSyncSeq,
        token: googleAccessToken,
        uid: getCurrentFirebaseUid(),
        epoch: googleSyncEpoch
    };
    if (!session.token) return;

    // 현재 유효한 세션의 동기화가 진행 중일 때만 중복 실행을 막는다.
    // 무효화된 이전 세션의 잠금은 새 세션이 넘겨받는다.
    if (activeGoogleSync && isGoogleSyncSessionValid(activeGoogleSync)) {
        console.log('이미 동기화가 진행 중입니다.');
        return;
    }
    activeGoogleSync = session;
    isSyncingGoogleCalendar = true;
    const checkpoint = () => assertGoogleSyncSession(session);

    try {
        const now = new Date();
        const timeMin = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString();
        const timeMax = new Date(now.getFullYear(), now.getMonth() + 7, 0).toISOString();

        // 1. FAWW 캘린더 찾기 (calendarList 전 페이지 확인)
        let targetCalendar = await findFawwCalendarInList(session.token, checkpoint);

        // 모든 페이지에 FAWW 캘린더가 없을 때만 생성
        if (!targetCalendar) {
            checkpoint(); // 캘린더 생성 직전 세션 확인

            console.log('구글 계정에 "FAWW" 캘린더가 존재하지 않아 생성을 시도합니다.');
            showToast('"FAWW" 캘린더 생성 중...', 'info');

            const createResponse = await fetch(`https://www.googleapis.com/calendar/v3/calendars`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ summary: 'FAWW' })
            });
            checkpoint();

            if (createResponse.status === 401) {
                throw { status: 401, message: 'Google 인증 세션이 만료되었습니다. 다시 연동해주세요.' };
            }
            if (!createResponse.ok) {
                const errText = await createResponse.text();
                throw new Error(`FAWW 캘린더 자동 생성 실패: ${errText}`);
            }

            targetCalendar = await createResponse.json();
            checkpoint();
            showToast('"FAWW" 캘린더가 자동으로 생성되었습니다!', 'success');
        }

        if (!targetCalendar || !targetCalendar.id) {
            throw new Error('FAWW 캘린더 ID를 확인하지 못했습니다.');
        }

        // 2. 'FAWW' 캘린더 일정 전 페이지 수집 (이 단계에서는 DB에 쓰지 않음)
        const items = [];
        const seenEventTokens = new Set();
        let evtPageToken = null;
        do {
            const params = new URLSearchParams({
                timeMin,
                timeMax,
                singleEvents: 'true',
                orderBy: 'startTime'
            });
            if (evtPageToken) params.set('pageToken', evtPageToken);
            const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendar.id)}/events?${params.toString()}`;

            const response = await fetch(url, { headers: { 'Authorization': `Bearer ${session.token}` } });
            checkpoint();

            if (response.status === 401) {
                throw { status: 401, message: 'Google 인증 세션이 만료되었습니다. 다시 연동해주세요.' };
            }
            if (!response.ok) throw new Error(`일정 목록 가져오기 실패 (HTTP ${response.status}, 페이지 토큰: ${evtPageToken || '없음'})`);

            const data = await response.json();
            checkpoint();

            if (data && Array.isArray(data.items)) items.push(...data.items);
            const next = (data && data.nextPageToken) ? String(data.nextPageToken) : null;
            if (next && seenEventTokens.has(next)) {
                throw new Error('일정 목록 페이지 토큰이 반복되어 조회를 중단합니다.');
            }
            if (next) seenEventTokens.add(next);
            evtPageToken = next;
        } while (evtPageToken);

        // 3. 변환 · 검증 (순수 데이터 처리, DB 쓰기 없음)
        const byId = new Map();
        const invalidIds = [];
        items
            .filter(item => item && item.status !== 'cancelled')
            .forEach(item => {
                const mapped = mapGoogleEventToExternalFields(item);
                if (!mapped) return;
                if (!isValidFirebaseKey(mapped.id)) {
                    invalidIds.push(String(mapped.id));
                    return;
                }
                byId.set(mapped.id, mapped); // 중복 ID는 마지막 값 사용
            });
        if (invalidIds.length > 0) {
            throw new Error(`저장할 수 없는 일정 ID ${invalidIds.length}건이 있어 DB 반영을 시작하지 않았습니다.`);
        }
        const processedItems = Array.from(byId.values());

        if (processedItems.length === 0) {
            console.log('--- FAWW Google Events Mapped but no updates needed ---');
            return;
        }

        // 4. 일정별 transaction으로 DB 반영 (모든 수집 · 검증 완료 후 시작)
        checkpoint(); // DB 쓰기 직전 세션 확인

        let committedCount = 0;
        let abortedDuringWrite = false;
        const failures = [];

        for (let i = 0; i < processedItems.length; i += GOOGLE_SYNC_WRITE_BATCH_SIZE) {
            if (!isGoogleSyncSessionValid(session)) { // 각 배치 쓰기 직전 세션 확인
                abortedDuringWrite = true;
                break;
            }
            const batch = processedItems.slice(i, i + GOOGLE_SYNC_WRITE_BATCH_SIZE);
            const results = await Promise.allSettled(batch.map(data =>
                db.ref(`external_events/${data.id}`).transaction(
                    currentData => buildExternalEventTransactionValue(currentData, data, session),
                    undefined,
                    false // 서버 확정 전 기본값이 로컬 화면에 잠시 보이지 않도록 함
                )
            ));

            results.forEach((r, idx) => {
                if (r.status === 'rejected') {
                    failures.push({ id: batch[idx].id, reason: (r.reason && r.reason.message) || String(r.reason) });
                } else if (r.value && r.value.committed) {
                    committedCount++;
                } else if (!isGoogleSyncSessionValid(session)) {
                    abortedDuringWrite = true;
                } else {
                    failures.push({ id: batch[idx].id, reason: 'transaction not committed' });
                }
            });
        }

        if (abortedDuringWrite || !isGoogleSyncSessionValid(session)) {
            console.log(`세션이 변경되어 DB 반영을 중단했습니다. (이미 서버에 반영된 ${committedCount}건은 취소되지 않음)`);
            return;
        }

        if (failures.length > 0) {
            console.error('external_events 저장 실패 목록:', failures);
            throw new Error(`일정 DB 저장 실패: 전체 ${processedItems.length}건 중 ${failures.length}건 실패 (${committedCount}건은 저장됨). 다음 동기화 때 다시 시도합니다.`);
        }

        showToast(`✅ 구글 일정 ${processedItems.length}건이 성공적으로 연동되었습니다.`, 'success');

    } catch (error) {
        // 세션이 바뀐 이전 요청: 토큰 삭제 · 알림 · 추가 쓰기 없이 종료
        if (error === GOOGLE_SYNC_ABORTED || !isGoogleSyncSessionValid(session)) {
            console.log('세션이 변경되어 이전 Google 동기화 요청을 중단했습니다.');
            return;
        }

        console.error('🔥 Google Events Fetch Error:', error);
        const errorMsg = (error && (error.message || error.toString())) || '';
        const is401 = (error && error.status === 401) || errorMsg.includes('401') || errorMsg.includes('unauthorized') || errorMsg.includes('credentials');

        if (is401) {
            // 이 시점의 세션은 유효하므로 googleAccessToken === session.token (현재 세션의 토큰만 삭제)
            localStorage.removeItem('google_access_token');
            googleAccessToken = null;
            invalidateGoogleSyncSession();
            updateGoogleSyncUI();
            console.log('Google token expired, but previously synchronized external_events remain preserved in DB.');
        } else {
            showToast(`구글 동기화 오류: ${errorMsg}`, 'error');
        }
    } finally {
        // 자신이 보유한 잠금만 해제 (다른 세션의 실행 상태는 변경하지 않음)
        if (activeGoogleSync === session) {
            activeGoogleSync = null;
            isSyncingGoogleCalendar = false;
        }
    }
}

/**
 * 구글 연동 버튼의 UI 상태를 동기화 상태에 맞춰 복구하는 함수
 */
function updateGoogleSyncUI() {
    // 모든 연동 버튼들을 찾아 업데이트 (메인, 달력 탭, 통합 캘린더 모달 버튼)
    const syncButtons = [
        { id: 'btn-google-sync', text: '구글 캘린더 연동' },
        { id: 'btn-google-sync-tab', text: '구글 연동' },
        { id: 'btn-google-sync-modal', text: 'Google 캘린더 연동' }
    ];

    syncButtons.forEach(btnInfo => {
        const syncBtn = document.getElementById(btnInfo.id);
        if (!syncBtn) return;

        if (googleAccessToken) {
            syncBtn.style.background = '#e8f0fe';
            syncBtn.style.color = '#4285f4';
            syncBtn.style.borderColor = '#4285f4';
            syncBtn.disabled = false;
            syncBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px; margin-right:8px; vertical-align:middle; color:#4285f4; font-weight:bold;">check_circle</span> 연동 완료 (동기화됨)';
        } else {
            syncBtn.style.background = '';
            syncBtn.style.color = '';
            syncBtn.style.borderColor = '';
            syncBtn.disabled = false;
            if (btnInfo.id === 'btn-google-sync-modal') {
                syncBtn.style.backgroundColor = '#4285F4';
                syncBtn.style.color = '#ffffff';
                syncBtn.innerHTML = '<img src="https://www.google.com/images/icons/product/calendar-32.png" style="width:16px; height:16px; margin-right:4px; vertical-align:middle;"> Google 캘린더 연동';
            } else {
                syncBtn.innerHTML = '<img src="https://www.gstatic.com/images/branding/product/1x/gsa_512dp.png" style="width:16px; margin-right:8px; vertical-align:middle;"> ' + btnInfo.text;
            }
        }
    });
}

/**
 * 주기적 동기화 타이머
 */
let syncTimer = null;
function startGoogleSyncTimer() {
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(fetchGoogleCalendarEvents, 600000);
}

// 페이지 로드 시 초기화 로직
window.addEventListener('DOMContentLoaded', () => {
    if (googleAccessToken) {
        setTimeout(() => {
            updateGoogleSyncUI();
            fetchGoogleCalendarEvents();
            startGoogleSyncTimer();
        }, 1500);
    }
});

// ----------------------------------------------------
// 알림 시스템 (Notification System)
// ----------------------------------------------------
function toggleNotificationPanel() {
    const panel = document.getElementById('noti-panel');
    if (!panel) return;
    const isOpen = panel.classList.toggle('open');
    if (isOpen) renderNotifications();
}

function sendNotification(targetUid, data) {
    if (!targetUid) return;
    const ref = db.ref(`tasks/notifications/${targetUid}`).push();
    ref.set({
        id: ref.key,
        ...data,
        timestamp: Date.now(),
        read: false
    });
}

function sendNotificationToAll(data) {
    const users = AppStore.getUsers();
    Object.keys(users).forEach(uid => {
        if (users[uid].approved) {
            sendNotification(uid, data);
        }
    });
}

function renderNotifications() {
    const listEl = document.getElementById('noti-list');
    const badgeEl = document.getElementById('noti-badge');
    if (!listEl) return;

    const notis = Object.values(AppStore.getNotifications()).sort((a, b) => b.timestamp - a.timestamp);
    const unreadCount = notis.filter(n => !n.read).length;

    if (badgeEl) {
        badgeEl.style.display = unreadCount > 0 ? 'block' : 'none';
        badgeEl.textContent = unreadCount > 99 ? '99+' : unreadCount;
    }

    if (notis.length === 0) {
        listEl.innerHTML = `
            <div class="drawer-empty">
                <span class="material-symbols-rounded">notifications_off</span>
                알림이 없습니다.
            </div>
        `;
        return;
    }

    listEl.innerHTML = '';
    notis.forEach(n => {
        const item = document.createElement('div');
        item.className = `notification-item ${n.read ? '' : 'unread'}`;
        item.onclick = () => {
            markNotificationAsRead(n.id);
            handleNotificationDeepLink(n);
            toggleNotificationPanel();
        };

        const timeStr = new Date(n.timestamp).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

        item.innerHTML = `
            <div class="notif-title-row">
                <span>${n.title}</span>
                <span class="notif-date">${timeStr}</span>
            </div>
            <div class="notif-message">${n.message}</div>
        `;
        listEl.appendChild(item);
    });
}

function handleNotificationDeepLink(n) {
    if (!n) return;

    const switchTabWithButton = (tabId) => {
        const tabBtn = document.querySelector(`.tab-btn[onclick*="${tabId}"]`);
        if (typeof switchTab === 'function') {
            switchTab(tabId, tabBtn);
        }
    };

    if (n.link === 'notice') {
        switchTabWithButton('tab-notice');
        if (n.targetId && typeof viewNotice === 'function') {
            setTimeout(() => viewNotice(n.targetId), 150);
        } else {
            showToast('공지사항으로 이동합니다.', 'info');
        }
    } else if (n.link === 'trip') {
        switchTabWithButton('tab-trips');
        if (n.targetId && typeof openTripModal === 'function') {
            const trip = AppStore.getTrips()[n.targetId];
            if (trip) {
                setTimeout(() => openTripModal(
                    trip.id, trip.name, trip.date, trip.assignee,
                    trip.contact, trip.address, trip.scheduleUrl,
                    trip.schedulePath, trip.qrUrl, trip.qrPath
                ), 150);
            }
        } else {
            showToast('출장 관리로 이동합니다.', 'info');
        }
    } else if (n.link === 'task') {
        switchTabWithButton('tab-tasks');
        if (n.targetId && typeof openModal === 'function') {
            const task = AppStore.getTasks()[n.targetId];
            if (task) {
                setTimeout(() => openModal(
                    task.id, task.title, task.description,
                    task.dueDate, task.startDate
                ), 150);
            }
        } else {
            showToast('업무 목록으로 이동합니다.', 'info');
        }
    } else if (n.link === 'leaves') {
        switchTabWithButton('tab-leaves');
        if (n.targetId && typeof openLeaveDetailModal === 'function') {
            setTimeout(() => openLeaveDetailModal(n.targetId), 150);
        } else {
            showToast('휴가 결재로 이동합니다.', 'info');
        }
    } else if (n.link === 'chat') {
        if (typeof toggleChatListWindow === 'function') {
            toggleChatListWindow();
        }
    } else if (n.link === 'meeting-feed' || n.link === 'feed') {
        switchTabWithButton('tab-meeting-feed');
    }
}

function markNotificationAsRead(id) {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    if (uid && id) {
        db.ref(`tasks/notifications/${uid}/${id}`).update({ read: true });
    }
}

function markAllNotificationsRead() {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    const notis = AppStore.getNotifications();
    if (uid) {
        const updates = {};
        Object.keys(notis).forEach(id => {
            if (!notis[id].read) updates[`${id}/read`] = true;
        });
        if (Object.keys(updates).length > 0) {
            db.ref(`tasks/notifications/${uid}`).update(updates);
        }
    }
}

// 실시간 알림 리스너 시작
let isFirstNotiLoad = true;
let previousNotiIds = new Set();

function startNotificationListener() {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    if (!uid) return;

    window.AppSubscriptionManager.subscribe('tasks_notifications', db.ref(`tasks/notifications/${uid}`).orderByChild('timestamp').limitToLast(50), (s) => {
        const notisObj = s.val() || {};
        AppStore.setNotifications(notisObj);
        renderNotifications();
        
        // 실시간 추가된 읽지 않은 새 알림에 대해 시스템 OS 팝업 알림 실행
        Object.keys(notisObj).forEach(id => {
            const noti = notisObj[id];
            if (!isFirstNotiLoad && !noti.read && !previousNotiIds.has(id)) {
                triggerSystemNotification(noti);
            }
            previousNotiIds.add(id);
        });
        isFirstNotiLoad = false;
    });
}

function triggerSystemNotification(noti) {
    if (!("Notification" in window) || Notification.permission !== "granted") {
        // 권한이 없거나 지원하지 않는 구형 브라우저 등에서는 토스트로 대체
        showToast(`🚨 ${noti.title}\n👉 ${noti.message}`, 'warning');
        return;
    }
    
    const title = `[FaWW] ${noti.title}`;
    const options = {
        body: noti.message,
        icon: "logo.png", // 앱 대표 아이콘 지정
        badge: "logo.png",
        tag: noti.id,
        data: noti // 서비스 워커에서 알림 클릭 핸들링을 위해 전달
    };

    // 서비스 워커가 등록되어 있고 제어 상태인 경우 서비스 워커 알림 사용
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(registration => {
            registration.showNotification(title, options)
                .catch(err => {
                    console.warn("Service Worker notification failed, falling back to standard notification:", err);
                    fallbackNotification();
                });
        });
    } else {
        fallbackNotification();
    }

    function fallbackNotification() {
        const notification = new Notification(title, options);
        notification.onclick = function() {
            window.focus(); // 브라우저 창 활성화 시도
            
            // 즉시 해당 일정의 딥링크 상세 모달을 띄우고 읽음 처리
            if (typeof handleNotificationDeepLink === 'function') {
                markNotificationAsRead(noti.id);
                handleNotificationDeepLink(noti);
            }
            notification.close();
        };
    }
}

// ----------------------------------------------------
// 지메일-구글 캘린더 연동 및 출장-업무 일정 충돌 감지 (아이디어 1 & 4)
// ----------------------------------------------------

async function getGoogleFawwCalendarId(token) {
    const requestToken = token || googleAccessToken;
    if (!requestToken) return null;
    try {
        // calendarList 전 페이지 확인 (nextPageToken 처리)
        const cal = await findFawwCalendarInList(requestToken);
        return cal ? cal.id : null;
    } catch (e) {
        if (e && e.status === 401) throw e;
        console.warn('[Sync] calendarList 조회 실패:', e);
        return null;
    }
}

async function syncTripToGoogleCalendar(trip) {
    if (!googleAccessToken) {
        console.log('[Sync] No Google Access Token stored.');
        return;
    }
    if (!trip || !trip.id || !trip.name || !trip.date) return;

    // 요청 시작 시점의 토큰을 고정해 사용 (도중에 재연동되어도 이전 요청의 401이 새 토큰을 지우지 않도록)
    const requestToken = googleAccessToken;

    try {
        const calendarId = await getGoogleFawwCalendarId(requestToken);
        if (!calendarId) {
            console.warn('[Sync] "FAWW" calendar not found in user\'s account.');
            return;
        }

        // Parse dates
        const parsed = typeof parseTripDateRange === 'function' ? parseTripDateRange(trip.date) : { startDate: trip.date, endDate: trip.date };
        let startDate = parsed.startDate || trip.date;
        let endDate = parsed.endDate || trip.date;

        if (!startDate || isNaN(new Date(startDate).getTime())) return;

        // Exclude end date for Google all-day event
        const nextDay = new Date(endDate);
        nextDay.setDate(nextDay.getDate() + 1);
        const endDateExclusive = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;

        const descriptionStr = `담당자: ${trip.assignee || '미지정'}\n연락처: ${trip.contact || '없음'}\n주소: ${trip.address || '없음'}\n[FaWW 출장연동 ID: ${trip.id}]`;

        const eventBody = {
            summary: `[출장] ${trip.name}`,
            location: trip.address || '',
            description: descriptionStr,
            start: { date: startDate },
            end: { date: endDateExclusive }
        };

        // Check if event already exists using q search
        const queryUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?q=${encodeURIComponent(`[FaWW 출장연동 ID: ${trip.id}]`)}`;
        const searchResponse = await fetch(queryUrl, {
            headers: { 'Authorization': `Bearer ${requestToken}` }
        });

        if (searchResponse.status === 401) {
            throw { status: 401, message: 'Google 인증 세션이 만료되었습니다.' };
        }
        if (!searchResponse.ok) {
            throw new Error(`Failed to query calendar: ${searchResponse.status}`);
        }

        const searchData = await searchResponse.json();
        const existingEvent = searchData.items && searchData.items.find(item => item.description && item.description.includes(`[FaWW 출장연동 ID: ${trip.id}]`));

        let response;
        if (existingEvent) {
            // Update
            console.log(`[Sync] Updating existing Google Calendar event: ${existingEvent.id}`);
            response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${existingEvent.id}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${requestToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(eventBody)
            });
        } else {
            // Create
            console.log('[Sync] Creating new Google Calendar event');
            response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${requestToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(eventBody)
            });
        }

        if (response.status === 401) {
            throw { status: 401, message: 'Google 인증 세션이 만료되었습니다.' };
        }

        if (response.ok) {
            console.log('[Sync] Trip successfully synced with Google Calendar');
            showToast(`구글 캘린더에 "${trip.name}" 일정이 동기화되었습니다.`, 'success');
            if (typeof fetchGoogleCalendarEvents === 'function') {
                fetchGoogleCalendarEvents();
            }
        } else {
            const errText = await response.text();
            console.error('[Sync] Google Calendar sync response error:', errText);
            throw new Error(`구글 캘린더 동기화 에러: ${errText}`);
        }
    } catch (e) {
        console.error('[Sync] Error syncing trip to Google Calendar:', e);
        const errorMsg = e.message || e.toString() || '';
        const is401 = e.status === 401 || errorMsg.includes('401') || errorMsg.includes('unauthorized') || errorMsg.includes('credentials');
        
        if (is401 && googleAccessToken !== requestToken) {
            // 이전 토큰으로 보낸 요청의 401: 현재(새) 토큰은 유지
            console.log('[Sync] 이전 Google 토큰의 401 응답이므로 현재 연동 상태를 유지합니다.');
        } else if (is401) {
            localStorage.removeItem('google_access_token');
            googleAccessToken = null;
            invalidateGoogleSyncSession();
            updateGoogleSyncUI();
            showToast('Google 연동 세션이 만료되었습니다. 다시 연동해 주세요.', 'warning');
        } else {
            showToast(`출장 일정 구글 동기화 실패: ${errorMsg}`, 'error');
        }
    }
}

function checkTripTaskConflicts(assignee, dateString) {
    if (!assignee || !dateString) return false;

    // Normalize assignee names
    const searchName = assignee.toLowerCase().trim();
    if (!searchName) return false;

    // 1. Find all trips for this assignee overlapping dateString
    const trips = Object.values(AppStore.getTrips() || {}).filter(t => {
        if (!t.assignee) return false;
        const assigneesList = t.assignee.toLowerCase().split(',').map(name => name.trim());
        const hasUser = assigneesList.some(name => searchName.includes(name) || name.includes(searchName));
        if (!hasUser) return false;

        const parsed = typeof parseTripDateRange === 'function' ? parseTripDateRange(t.date) : { startDate: t.date, endDate: t.date };
        let s = parsed.startDate || t.date; let e = parsed.endDate || t.date;
        return dateString >= s && dateString <= e;
    });

    if (trips.length === 0) return false;

    // 2. Find all tasks for this assignee with dueDate or startDate overlapping dateString
    const tasks = Object.values(AppStore.getTasks() || {}).filter(t => {
        if (!t.assignee || t.status === 'done') return false;
        const assigneesList = t.assignee.toLowerCase().split(',').map(name => name.trim());
        const hasUser = assigneesList.some(name => searchName.includes(name) || name.includes(searchName));
        if (!hasUser) return false;

        let s = t.startDate || t.dueDate;
        let e = t.dueDate || t.startDate;
        if (!s) return false;

        return dateString >= s && dateString <= e;
    });

    return tasks.length > 0;
}

function getConflictingItems(assignee, dateString) {
    if (!assignee || !dateString) return { trips: [], tasks: [] };
    const searchName = assignee.toLowerCase().trim();

    const trips = Object.values(AppStore.getTrips() || {}).filter(t => {
        if (!t.assignee) return false;
        const assigneesList = t.assignee.toLowerCase().split(',').map(name => name.trim());
        const hasUser = assigneesList.some(name => searchName.includes(name) || name.includes(searchName));
        if (!hasUser) return false;

        const parsed = typeof parseTripDateRange === 'function' ? parseTripDateRange(t.date) : { startDate: t.date, endDate: t.date };
        let s = parsed.startDate || t.date; let e = parsed.endDate || t.date;
        return dateString >= s && dateString <= e;
    });

    const tasks = Object.values(AppStore.getTasks() || {}).filter(t => {
        if (!t.assignee || t.status === 'done') return false;
        const assigneesList = t.assignee.toLowerCase().split(',').map(name => name.trim());
        const hasUser = assigneesList.some(name => searchName.includes(name) || name.includes(searchName));
        if (!hasUser) return false;

        let s = t.startDate || t.dueDate;
        let e = t.dueDate || t.startDate;
        if (!s) return false;

        return dateString >= s && dateString <= e;
    });

    return { trips, tasks };
}

// ----------------------------------------------------
// 스마트 AI 회의록 기획 비서 (AI Meeting-to-Proposal Assistant)
// ----------------------------------------------------
function saveProposalApiKey(key) {
    if (key) {
        localStorage.setItem('faww_openai_key', key.trim());
        showToast('OpenAI API Key가 브라우저에 저장되었습니다.', 'success');
    } else {
        localStorage.removeItem('faww_openai_key');
        showToast('저장된 API Key가 제거되었습니다.', 'info');
    }
}

function loadProposalSettings() {
    const key = localStorage.getItem('faww_openai_key') || '';
    const keyInput = document.getElementById('proposalApiKeyInput');
    if (keyInput) keyInput.value = key;

    renderProposalHistory();

    // 모바일 환경 초기화 시 입력 폼으로 자동 정렬
    if (typeof switchProposalMobileTab === 'function') {
        switchProposalMobileTab('input');
    }
}

function renderProposalHistory() {
    const listEl = document.getElementById('proposalHistoryList');
    if (!listEl) return;

    const user = auth.currentUser;
    if (!user) {
        listEl.innerHTML = '<span style="color: var(--text-muted); font-size: 0.82rem; font-style: italic;">저장 내역 조회를 위해 로그인이 필요합니다.</span>';
        return;
    }

    migrateLegacyProposals(user.uid).then(() => db.ref(`savedProposals/${user.uid}`).once('value')).then((snapshot) => {
        const data = snapshot.val();
        if (!data) {
            listEl.innerHTML = '<span style="color: var(--text-muted); font-size: 0.82rem; font-style: italic;">저장된 기획서가 없습니다. 기획서 생성 후 \'저장\'을 누르면 이곳에 보관됩니다.</span>';
            return;
        }

        listEl.innerHTML = '';
        Object.keys(data).sort((a, b) => data[b].timestamp - data[a].timestamp).forEach(id => {
            const prop = data[id];
            const chip = document.createElement('div');
            chip.style.cssText = 'display: inline-flex; align-items: center; gap: 6px; background: var(--card-bg); border: 1px solid var(--border-color); padding: 6px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.2s; box-shadow: var(--shadow-sm);';

            let emoji = '📈';
            if (prop.template === 'marketing') emoji = '📣';
            else if (prop.template === 'event') emoji = '🎈';
            else if (prop.template === 'problem') emoji = '🔧';

            const timeStr = new Date(prop.timestamp).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });

            chip.innerHTML = `
                <span onclick="loadSavedProposal('${id}')" style="display:flex; align-items:center; gap:4px;">
                    <span>${emoji}</span>
                    <span style="color: var(--text-main); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${prop.title}</span>
                    <small style="color: var(--text-muted); font-weight: normal;">(${timeStr})</small>
                </span>
                <span class="material-symbols-rounded" onclick="deleteSavedProposal(event, '${id}')" style="font-size: 1rem; color: var(--text-muted); cursor: pointer; transition: color 0.2s;" onmouseover="this.style.color='var(--danger)'" onmouseout="this.style.color='var(--text-muted)'">close</span>
            `;

            chip.onmouseenter = () => { chip.style.borderColor = 'var(--primary)'; chip.style.transform = 'translateY(-1px)'; };
            chip.onmouseleave = () => { chip.style.borderColor = 'var(--border-color)'; chip.style.transform = 'translateY(0)'; };

            listEl.appendChild(chip);
        });
    }).catch(err => {
        console.error('[기획서 보관함] 조회 실패:', err);
        listEl.innerHTML = '<span style="color: var(--text-muted); font-size: 0.82rem; font-style: italic;">저장 내역을 불러오지 못했습니다.</span>';
    });
}

// [보안 2차-3] 기획서는 본인만 읽을 수 있는 savedProposals/{uid} 에 보관한다.
// 예전 위치(users/{uid}/savedProposals)는 승인된 직원 전체가 읽을 수 있으므로,
// 남아 있으면 새 위치로 옮기고 예전 위치를 지운다. 한 번의 다중 경로 업데이트라 중간 실패 시 아무것도 바뀌지 않는다.
function migrateLegacyProposals(uid) {
    return db.ref(`users/${uid}/savedProposals`).once('value').then((snap) => {
        const legacy = snap.val();
        if (!legacy || typeof legacy !== 'object') return;
        const updates = {};
        Object.keys(legacy).forEach(id => { updates[`savedProposals/${uid}/${id}`] = legacy[id]; });
        updates[`users/${uid}/savedProposals`] = null;
        return db.ref().update(updates);
    }).catch(err => {
        // 이전 실패는 다음 로그인 때 다시 시도한다. 새 위치 조회는 계속 진행.
        console.error('[기획서 보관함] 예전 위치 이전 실패:', err);
    });
}

function loadSavedProposal(proposalId) {
    const user = auth.currentUser;
    if (!user) return;

    db.ref(`savedProposals/${user.uid}/${proposalId}`).once('value', (snapshot) => {
        const prop = snapshot.val();
        if (prop) {
            const outEl = document.getElementById('proposalOutputContainer');
            if (outEl) {
                outEl.innerHTML = prop.text;
                outEl.dataset.savedTitle = prop.title;
                outEl.dataset.savedTemplate = prop.template;
                showToast(`"${prop.title}" 기획서를 불러왔습니다.`, 'success');
            }
        }
    });
}

async function deleteSavedProposal(event, proposalId) {
    event.stopPropagation();
    const user = auth.currentUser;
    if (!user) return;

    if (await customConfirm('이 기획서 저장 내역을 완전히 삭제하시겠습니까?')) {
        db.ref(`savedProposals/${user.uid}/${proposalId}`).remove()
            .then(() => {
                showToast('기획서가 삭제되었습니다.', 'info');
                renderProposalHistory();
            })
            .catch(err => {
                console.error(err);
                showToast('삭제 중 오류 발생', 'error');
            });
    }
}

async function generateAiProposal() {
    const rawInput = document.getElementById('proposalRawInput').value.trim();
    const template = document.getElementById('proposalTemplate').value;
    const tone = document.getElementById('proposalTone').value;
    const apiKey = (localStorage.getItem('faww_openai_key') || '').trim();

    if (!rawInput) {
        await customAlert('회의록 또는 아이디어 내용을 입력해 주세요!');
        return;
    }

    if (!apiKey) {
        await customAlert('AI 기능 가동을 위해 좌측 OpenAI API Key 입력창에 사용자의 API Key(sk-...)를 입력 및 저장해 주세요!');
        return;
    }

    const btn = document.getElementById('btn-generate-proposal');
    const outputContainer = document.getElementById('proposalOutputContainer');
    if (!btn || !outputContainer) return;

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner-small"></div> 생성하는 중...';
    outputContainer.innerHTML = '<span style="color:var(--text-muted); font-style:italic;">OpenAI 초거대 AI가 기획서를 집필하고 있습니다. 잠시만 기다려 주세요... ⏳</span>';

    // 모바일 환경인 경우 기획서 결과 탭으로 즉시 화면 전환
    if (typeof switchProposalMobileTab === 'function') {
        switchProposalMobileTab('result');
    }

    let systemPrompt = '';
    if (template === 'business') {
        systemPrompt = `당신은 전문 경영 컨설턴트이자 비즈니스 전략가입니다.
다음 입력된 회의 내용이나 아이디어 파편을 구조적인 신규 사업 기획서 초안으로 작성해 주세요.

[목차 구조]
1. 사업 개요 및 배경
2. 시장 현황 및 타겟 분석
3. 핵심 비즈니스 모델 및 가치 제안
4. 실행 로드맵 및 마케팅 전략
5. 기대 효과 및 재무 예측

정중하고 전문적인 한글 어조를 유지하고, 입력된 데이터를 창의적이고 현실성 있게 풍부히 확장해 서술해 주세요.
Markdown 포맷을 활용하여 깔끔하고 읽기 쉽게 문서를 구조화하세요.`;
    } else if (template === 'marketing') {
        systemPrompt = `당신은 최고의 글로벌 브랜드 마케팅 디렉터입니다.
다음 입력된 내용을 기반으로 시장의 이목을 끌 수 있는 마케팅/캠페인 전략 기획서 초안을 수립해 주세요.

[목차 구조]
1. 캠페인 배경 및 목적
2. 핵심 타겟(Persona) 정의
3. 캠페인 슬로건 및 메인 컨셉
4. 온/오프라인 미디어 채널별 실행안
5. 핵심 성과 지표 (KPI) 및 기대 효과

논리적이고 설득력 있는 문체로 논지를 구성하고, 구체적이고 바로 실행 가능한 창의적인 마케팅 전술을 포함하여 작성해 주세요.
Markdown 포맷을 활용하여 깔끔하게 문서를 구조화하세요.`;
    } else if (template === 'event') {
        systemPrompt = `당신은 베테랑 글로벌 이벤트 프로듀서입니다.
다음 입력된 내용을 바탕으로 매끄러운 진행과 몰입도를 극대화할 수 있는 이벤트/행사 기획안 초안을 작성해 주세요.

[목차 구조]
1. 행사 목적 및 개요
2. 타겟 참석자 및 모집 홍보 계획
3. 행사 세부 프로그램 일정표
4. 역할 분담 및 운영 준비 사항 (체크리스트)
5. 소요 예산 예측 및 비상 대응 대책

친근하고 매끄러운 한글 어조로 문서를 작성하고, 현실감 있고 상세하게 내용을 불려 작성해 주세요.
Markdown 포맷을 활용하여 가독성 높게 문서를 구조화하세요.`;
    } else if (template === 'problem') {
        systemPrompt = `당신은 맥킨지 출신의 수석 전략 컨설턴트입니다.
다음 분석 대상을 위해 현재 문제를 직시하고 명쾌한 돌파구를 제시하는 문제해결 제안서 초안을 도출해 주세요.

[목차 구조]
1. 현재 상황 및 주요 이슈 정의
2. 근본 원인 분석 (5-Whys 등 적용)
3. 핵심 해결 과제 및 솔루션 제시
4. 단계별 실행 방안 및 제약 조건 극복 전략
5. 해결 후 기대 상태 및 ROI

굉장히 날카롭고 분석적이며 논리적인 문체를 사용해 기획을 서술해 주세요.
Markdown 포맷을 활용하여 논리 구조가 눈에 띄게 문서를 작성해 주세요.`;
    }

    let toneSuffix = '';
    if (tone === 'professional') toneSuffix = '\n반드시 격식 있고 전문적인 단어(명사형 어미 종결, 분석적 관점)를 사용하십시오.';
    else if (tone === 'persuasive') toneSuffix = '\n논리적으로 설득력을 확보하고 강점 및 차별점이 확실히 부각되도록 호소력 있게 기술하십시오.';
    else if (tone === 'creative') toneSuffix = '\n격식을 조금 낮추더라도 친근하고 이해하기 쉬우며, 아이디어가 통통 튀고 신선하게 읽히도록 유연하게 기술하십시오.';

    systemPrompt += toneSuffix;

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `아래는 우리가 진행한 회의 내용 및 아이디어 메모입니다:\n\n${rawInput}` }
                ],
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error ? errData.error.message : response.statusText);
        }

        const data = await response.json();
        if (data.choices && data.choices.length > 0) {
            const proposalText = data.choices[0].message.content;

            outputContainer.innerHTML = '';
            outputContainer.dataset.savedTitle = rawInput.substring(0, 15) || '기획안 초안';
            outputContainer.dataset.savedTemplate = template;

            let formattedHtml = proposalText
                .replace(/### (.*)/g, '<h4 style="color:var(--primary); margin-top:1.2rem; margin-bottom:0.5rem; font-weight:bold; font-size:0.95rem;">### $1</h4>')
                .replace(/## (.*)/g, '<h3 style="color:#1e1b4b; margin-top:1.5rem; margin-bottom:0.6rem; font-weight:bold; font-size:1.05rem; border-bottom:1px dashed #cbd5e1; padding-bottom:0.3rem;">## $1</h3>')
                .replace(/# (.*)/g, '<h2 style="color:var(--primary); margin-top:1.8rem; margin-bottom:0.8rem; font-weight:bold; font-size:1.15rem;"># $1</h2>')
                .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--primary);">$1</strong>');

            outputContainer.innerHTML = formattedHtml;
            showToast('AI 기획서 초안이 완벽히 컴파일되었습니다.', 'success');
        } else {
            throw new Error('응답 데이터를 수신하지 못했습니다.');
        }
    } catch (e) {
        console.error(e);
        await customAlert('기획서 생성 중 오류 발생: ' + e.message);
        outputContainer.innerHTML = `<span style="color:var(--danger); font-weight:bold;">오류 발생: ${e.message}</span>`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

function copyProposalText() {
    const outEl = document.getElementById('proposalOutputContainer');
    if (!outEl) return;

    const text = outEl.innerText || outEl.textContent;
    if (text.includes('좌측에 회의 내용을 입력') || text.includes('오류 발생') || !text.trim()) {
        showToast('복사할 기획서 내용이 없습니다.', 'warning');
        return;
    }

    navigator.clipboard.writeText(text)
        .then(() => showToast('기획서 초안이 클립보드에 복사되었습니다.', 'success'))
        .catch(err => console.error('클립보드 복사 실패:', err));
}

function downloadProposalAsFile() {
    const outEl = document.getElementById('proposalOutputContainer');
    if (!outEl) return;

    const text = outEl.innerText || outEl.textContent;
    if (text.includes('좌측에 회의 내용을 입력') || text.includes('오류 발생') || !text.trim()) {
        showToast('다운로드할 기획서 내용이 없습니다.', 'warning');
        return;
    }

    const title = (outEl.dataset.savedTitle || 'AI_기획서_초안').replace(/\s+/g, '_');
    const template = outEl.dataset.savedTemplate || 'proposal';

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title}_[${template}].txt`;
    a.click();
    showToast('기획서 텍스트 파일 다운로드가 시작되었습니다.', 'success');
}

async function saveProposalToDatabase() {
    const outEl = document.getElementById('proposalOutputContainer');
    if (!outEl) return;

    const text = outEl.innerHTML;
    const plainText = outEl.innerText || outEl.textContent;
    if (plainText.includes('좌측에 회의 내용을 입력') || plainText.includes('오류 발생') || !plainText.trim()) {
        showToast('저장할 기획서 내용이 없습니다.', 'warning');
        return;
    }

    const user = auth.currentUser;
    if (!user) {
        await customAlert('로그인한 승인된 사용자만 기획서를 보관함에 저장할 수 있습니다.');
        return;
    }

    const titleInput = await customPrompt('기획서 보관함에 저장할 제목을 지정해주세요:', outEl.dataset.savedTitle || '신규 기획서');
    if (titleInput === null) return;

    const finalTitle = titleInput.trim() || '무제 기획서';

    const ref = db.ref(`savedProposals/${user.uid}`).push();
    ref.set({
        id: ref.key,
        title: finalTitle,
        text: text,
        template: outEl.dataset.savedTemplate || 'business',
        timestamp: Date.now()
    }).then(() => {
        showToast('기획서가 개인 보관함에 안전하게 저장되었습니다.', 'success');
        renderProposalHistory();
    }).catch(err => {
        console.error(err);
        showToast('저장 중 오류 발생', 'error');
    });
}

/**
 * AI 기획서 비서 듀얼 패널의 모바일 서브 탭 전환 함수
 */
function switchProposalMobileTab(tab) {
    if (window.innerWidth >= 768) return;

    const inputPanel = document.getElementById('proposal-input-panel');
    const resultPanel = document.getElementById('proposal-result-panel');
    const btnInput = document.getElementById('p-tab-btn-input');
    const btnResult = document.getElementById('p-tab-btn-result');

    if (!inputPanel || !resultPanel) return;

    if (tab === 'input') {
        inputPanel.style.setProperty('display', 'flex', 'important');
        resultPanel.style.setProperty('display', 'none', 'important');
        if (btnInput) btnInput.classList.add('active');
        if (btnResult) btnResult.classList.remove('active');
    } else {
        inputPanel.style.setProperty('display', 'none', 'important');
        resultPanel.style.setProperty('display', 'flex', 'important');
        if (btnInput) btnInput.classList.remove('active');
        if (btnResult) btnResult.classList.add('active');
    }
}

// ----------------------------------------------------
// 지시 & 회의 피드 (Directions & Meeting Feed) 기능
// ----------------------------------------------------
let currentFeedFilter = 'all';

// 1. Firebase 데이터베이스 리스너 등록
window.listenForFeed = function() {
window.AppSubscriptionManager.subscribe('tasks_feed', db.ref('tasks').orderByChild('status').equalTo('feed'), (snapshot) => {
    const data = snapshot.val() || {};
    for (let key in data) data[key].id = key;
    AppStore.setMeetingFeeds(data);
});
};

// 2. 피드 등록 함수
async function addMeetingFeed() {
    if (!(await checkAuth('승인된 사용자만 피드를 등록할 수 있습니다.'))) return;

    const textarea = document.getElementById('feedInput');
    if (!textarea) return;
    const content = textarea.value.trim();
    if (!content) return await customAlert('기록할 내용을 입력해주세요!');

    const currentUser = auth.currentUser;
    const authorName = currentUser ? currentUser.displayName : '익명';
    const authorUid = currentUser ? currentUser.uid : '';

    const newFeedRef = db.ref('tasks').push();
    const feedItem = {
        id: newFeedRef.key,
        title: `[피드] ${content.split('\n')[0].substring(0, 30)}${content.length > 30 ? '...' : ''}`,
        description: content,
        status: 'feed',
        author: authorName,
        authorUid: authorUid,
        timestamp: Date.now(),
        acknowledgments: {},
        linkedTaskId: ''
    };

    try {
        await newFeedRef.set(feedItem);
        textarea.value = '';
        showToast('피드가 성공적으로 등록되었습니다.', 'success');

        // 모든 사용자에게 지시/회의록 등록 전체 알림 발송
        const notificationData = {
            title: "📢 새로운 지시/회의 피드",
            message: `"${authorName}"님이 새로운 피드를 등록했습니다: ${content.substring(0, 30)}${content.length > 30 ? '...' : ''}`,
            type: 'feed',
            link: 'meeting-feed', // tab switching ID
            targetId: newFeedRef.key
        };

        sendNotificationToAll(notificationData);
    } catch (error) {
        console.error("피드 등록 에러:", error);
        await customAlert('피드 등록에 실패했습니다: ' + error.message);
    }
}

// 3. 읽음 확인 함수
async function acknowledgeFeed(feedId) {
    if (!auth.currentUser) return;
    const currentUser = auth.currentUser;
    const profile = AppStore.getCurrentUser();
    const userName = profile ? profile.displayName : currentUser.displayName;

    try {
        await db.ref(`tasks/${feedId}/acknowledgments/${currentUser.uid}`).set({
            name: userName,
            timestamp: Date.now()
        });
        showToast('피드 확인이 완료되었습니다.', 'success');
    } catch (error) {
        console.error("확인 에러:", error);
        showToast('확인 처리에 실패했습니다.', 'error');
    }
}

// 3.5 피드 삭제 함수
async function deleteMeetingFeed(feedId) {
    if (!auth.currentUser) return;
    const feeds = AppStore.getMeetingFeeds();
    const feed = feeds[feedId];
    if (!feed) return;

    const currentUser = auth.currentUser;
    const isAdmin = typeof ADMIN_UIDS !== 'undefined' && (ADMIN_UIDS.includes(currentUser.uid) || (typeof ADMIN_EMAILS !== 'undefined' && currentUser.email && ADMIN_EMAILS.includes(currentUser.email)));
    const isAuthor = feed.authorUid === currentUser.uid;

    if (!isAdmin && !isAuthor) {
        return await customAlert('삭제 권한이 없습니다. 작성자 본인 또는 관리자만 삭제할 수 있습니다.');
    }

    if (await customConfirm('이 지시사항 피드를 완전히 삭제하시겠습니까?')) {
        try {
            await db.ref(`tasks/${feedId}`).remove();
            showToast('지시사항이 성공적으로 삭제되었습니다.', 'success');
        } catch (error) {
            console.error("피드 삭제 에러:", error);
            showToast('지시사항 삭제에 실패했습니다.', 'error');
        }
    }
}

// 4. 칸반 업무 자동 등록 함수
async function convertFeedToKanbanTask(feedId) {
    if (!(await checkAuth('승인된 사용자만 업무를 등록할 수 있습니다.'))) return;

    const feeds = AppStore.getMeetingFeeds();
    const feed = feeds[feedId];
    if (!feed) return;

    if (feed.linkedTaskId) {
        showToast('이미 칸반 업무로 등록된 피드입니다.', 'warning');
        return;
    }

    if (!await customConfirm('이 피드를 칸반 업무(해야 할 일)로 등록하시겠습니까?')) return;

    try {
        const newTaskRef = db.ref('tasks').push();
        const today = new Date();
        const startDateString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        // 피드의 앞 20글자를 제목으로, 전체 내용을 설명으로 사용
        const titleText = `[피드 연동] ${feed.description.split('\n')[0].substring(0, 30)}${feed.description.length > 30 ? '...' : ''}`;

        await newTaskRef.set({
            id: newTaskRef.key,
            title: titleText,
            description: `[원본 피드 내용]\n${feed.description}\n\n(작성자: ${feed.author})`,
            status: 'todo',
            author: feed.author,
            assignee: '', // 미지정으로 시작하여 필요시 칸반 모달에서 지정
            priority: 'medium',
            startDate: startDateString
        });

        // 피드 아이템에 linkedTaskId 저장
        await db.ref(`tasks/${feedId}`).update({
            linkedTaskId: newTaskRef.key
        });

        showToast('칸반 보드에 업무가 성공적으로 등록되었습니다!', 'success');

        // 칸반 탭으로 자동 유도
        if (await customConfirm('칸반 보드로 이동하여 업무를 확인하시겠습니까?')) {
            const tabBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick') && b.getAttribute('onclick').includes('tab-tasks'));
            if (tabBtn) tabBtn.click();
        }
    } catch (error) {
        console.error("칸반 등록 에러:", error);
        await customAlert('칸반 업무 등록에 실패했습니다: ' + error.message);
    }
}

// 5. 필터 설정 함수
function setFeedFilter(filter, btn) {
    currentFeedFilter = filter;

    // 필터 버튼 active 클래스 제어
    const filterButtons = document.querySelectorAll('#feedFilterButtons .cal-filter-btn');
    filterButtons.forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    renderMeetingFeedUI();
}

// 6. UI 렌더링 함수
function renderMeetingFeedUI() {
    const container = document.getElementById('feed-list-container');
    if (!container) return;

    const feeds = AppStore.getMeetingFeeds();
    const currentUser = auth.currentUser;
    const searchTerm = document.getElementById('feedSearchInput') ? document.getElementById('feedSearchInput').value.toLowerCase().trim() : '';

    container.innerHTML = '';

    // 최신 등록일 내림차순 정렬
    const sortedFeeds = Object.values(feeds).sort((a, b) => b.timestamp - a.timestamp);

    // 필터링 적용
    const filteredFeeds = sortedFeeds.filter(feed => {
        // 검색어 매칭
        const matchesSearch = feed.description.toLowerCase().includes(searchTerm) || feed.author.toLowerCase().includes(searchTerm);
        if (!matchesSearch) return false;

        // 미확인/확인 필터 매칭
        if (currentFeedFilter === 'unread' && currentUser) {
            const hasRead = feed.acknowledgments && feed.acknowledgments[currentUser.uid];
            return !hasRead;
        } else if (currentFeedFilter === 'read' && currentUser) {
            const hasRead = feed.acknowledgments && feed.acknowledgments[currentUser.uid];
            return !!hasRead;
        }

        return true;
    });

    if (filteredFeeds.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: var(--text-muted); font-style: italic; background-color: var(--col-bg); border-radius: 12px; border: 1px dashed var(--border-color); width: 100%; box-sizing: border-box;">
                ${searchTerm || currentFeedFilter !== 'all' ? '필터링 조건에 부합하는 피드가 없습니다.' : '등록된 지시사항이 없습니다. 첫 글을 등록해 보세요!'}
            </div>
        `;
        return;
    }

    // 날짜별 그룹화
    const groupedFeeds = {};
    const dateKeys = [];

    filteredFeeds.forEach(feed => {
        const dateKey = new Date(feed.timestamp).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
        });
        if (!groupedFeeds[dateKey]) {
            groupedFeeds[dateKey] = [];
            dateKeys.push(dateKey);
        }
        groupedFeeds[dateKey].push(feed);
    });

    const isAdmin = currentUser && typeof ADMIN_UIDS !== 'undefined' && (ADMIN_UIDS.includes(currentUser.uid) || (typeof ADMIN_EMAILS !== 'undefined' && currentUser.email && ADMIN_EMAILS.includes(currentUser.email)));

    dateKeys.forEach(dateKey => {
        // 날짜 그룹 헤더 생성
        const groupHeader = document.createElement('div');
        groupHeader.className = 'feed-date-header';
        groupHeader.innerHTML = `
            <span class="material-symbols-rounded" style="font-size: 1.15rem; vertical-align: middle;">calendar_today</span>
            <span style="vertical-align: middle;">${dateKey}</span>
        `;
        container.appendChild(groupHeader);

        // 해당 날짜의 피드 카드들 생성 및 렌더링
        groupedFeeds[dateKey].forEach(feed => {
            const card = document.createElement('div');
            card.className = 'feed-card';

            // 확인 완료 여부 체크
            const hasAcknowledged = currentUser && feed.acknowledgments && feed.acknowledgments[currentUser.uid];

            // 확인한 팀원들 목록 구성
            const acks = feed.acknowledgments ? Object.values(feed.acknowledgments) : [];
            let ackListHtml = '';
            if (acks.length > 0) {
                ackListHtml = acks.map(ack => `<span class="feed-ack-badge confirmed">${ack.name}</span>`).join('');
            } else {
                ackListHtml = `<span style="font-size: 0.8rem; color: var(--text-muted); font-style: italic;">아직 확인한 팀원이 없습니다.</span>`;
            }

            // 등록 시간 포맷팅 (날짜 그룹이 있으므로 시간만 표시)
            const timeStr = new Date(feed.timestamp).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' });

            // 칸반 연동 상태에 따른 버튼/배지 구성
            let kanbanActionHtml = '';
            if (feed.linkedTaskId) {
                kanbanActionHtml = `
                    <div class="feed-kanban-linked" onclick="const t = AppStore.getTasks()['${feed.linkedTaskId}']; if(t) openModal(t.id, t.title, t.description || '', t.dueDate || '', t.startDate || ''); else showToast('업무 정보를 불러올 수 없습니다.', 'warning');">
                        <span class="material-symbols-rounded" style="font-size: 1.15rem;">link</span>
                        업무 등록 완료
                    </div>
                `;
            } else {
                kanbanActionHtml = `
                    <button class="feed-kanban-btn" onclick="convertFeedToKanbanTask('${feed.id}')">
                        <span class="material-symbols-rounded" style="font-size: 1.15rem;">add_task</span>
                        칸반 등록
                    </button>
                `;
            }

            // 확인 버튼 구성
            let ackButtonHtml = '';
            if (currentUser) {
                if (hasAcknowledged) {
                    ackButtonHtml = `
                        <button class="feed-ack-btn done" disabled>
                            <span class="material-symbols-rounded" style="font-size: 1.1rem;">check_circle</span>
                            확인 완료
                        </button>
                    `;
                } else {
                    ackButtonHtml = `
                        <button class="feed-ack-btn" onclick="acknowledgeFeed('${feed.id}')">
                            <span class="material-symbols-rounded" style="font-size: 1.1rem;">check</span>
                            읽음 확인
                        </button>
                    `;
                }
            }

            // 삭제 버튼 구성 (본인 글이거나 최고 관리자일 때만 노출)
            const isAuthor = currentUser && feed.authorUid === currentUser.uid;
            const showDelete = isAdmin || isAuthor;
            const deleteButtonHtml = showDelete ? `
                <button class="feed-delete-btn" onclick="deleteMeetingFeed('${feed.id}')" title="지시사항 삭제" style="background: none; border: none; color: var(--danger); cursor: pointer; padding: 4px; display: flex; align-items: center; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'">
                    <span class="material-symbols-rounded" style="font-size: 1.25rem;">delete</span>
                </button>
            ` : '';

            // 카드 내용 마크업
            card.innerHTML = `
                <div class="feed-card-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem; border-bottom: 1px dashed var(--border-color); padding-bottom: 0.6rem;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="feed-author-info" style="display: flex; align-items: center; gap: 4px; font-weight: bold; color: var(--primary);">
                            <span class="material-symbols-rounded" style="font-size: 1.2rem;">person</span>
                            ${feed.author}
                        </span>
                        <span style="font-size: 0.8rem; color: var(--text-muted);">${timeStr}</span>
                    </div>
                    ${deleteButtonHtml}
                </div>
                <div class="feed-card-body" style="font-size: 0.95rem; line-height: 1.6; word-break: break-all; white-space: pre-wrap; margin-bottom: 1rem; color: var(--text-main);">${feed.description}</div>
                <div class="feed-card-footer" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; border-top: 1px solid var(--border-color); padding-top: 0.8rem; font-size: 0.85rem;">
                    <div class="feed-ack-section" style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 200px;">
                        <span class="feed-ack-label" style="font-weight: 600; color: var(--text-muted);">👀 확인인:</span>
                        <div class="feed-ack-list" style="display: flex; flex-wrap: wrap; gap: 4px;">${ackListHtml}</div>
                    </div>
                    <div class="feed-btn-group" style="display: flex; gap: 6px;">
                        ${ackButtonHtml}
                        ${kanbanActionHtml}
                    </div>
                </div>
            `;

            container.appendChild(card);
        });
    });
}

// ----------------------------------------------------
// 구글 연동 일정 싱크 백엔드 연동
// ----------------------------------------------------
async function syncExternalEventToGoogleCalendar(event) {
    if (!googleAccessToken) {
        console.log('[Sync] No Google Access Token stored.');
        return;
    }
    if (!event || !event.id || !event.title) return;

    try {
        const calendarId = await getGoogleFawwCalendarId();
        if (!calendarId) {
            console.warn('[Sync] "FAWW" calendar not found in user\'s account.');
            return;
        }

        let startDate = event.startDate || event.dueDate;
        let endDate = event.dueDate || event.startDate;

        if (!startDate || isNaN(new Date(startDate).getTime())) return;

        const nextDay = new Date(endDate);
        nextDay.setDate(nextDay.getDate() + 1);
        const endDateExclusive = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;

        const eventBody = {
            summary: event.title,
            description: event.description || '',
            location: event.location || '',
            start: { date: startDate },
            end: { date: endDateExclusive }
        };

        console.log(`[Sync] Updating Google Calendar external event: ${event.id}`);
        const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${event.id}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${googleAccessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(eventBody)
        });

        if (response.status === 401) {
            throw { status: 401, message: 'Google 인증 세션이 만료되었습니다.' };
        }

        if (response.ok) {
            console.log('[Sync] External event successfully synced with Google Calendar');
            showToast('Google 캘린더에 일정이 동기화되었습니다.', 'success');
        } else {
            const errText = await response.text();
            console.error('[Sync] Google Calendar sync response error:', errText);
        }
    } catch (e) {
        console.error('[Sync] Error syncing external event to Google Calendar:', e);
    }
}

async function deleteGoogleCalendarEvent(eventId) {
    if (!googleAccessToken) return;
    try {
        const calendarId = await getGoogleFawwCalendarId();
        if (!calendarId) return;

        console.log(`[Sync] Deleting Google Calendar external event: ${eventId}`);
        const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${googleAccessToken}`
            }
        });

        if (response.status === 401) {
            throw { status: 401, message: 'Google 인증 세션이 만료되었습니다.' };
        }

        if (response.ok) {
            console.log('[Sync] External event successfully deleted from Google Calendar');
            showToast('Google 캘린더에서 일정이 삭제되었습니다.', 'success');
        } else {
            const errText = await response.text();
            console.error('[Sync] Google Calendar delete response error:', errText);
        }
    } catch (e) {
        console.error('[Sync] Error deleting event from Google Calendar:', e);
    }
}

// ----------------------------------------------------
// 소모품 재고관리 기능
// ----------------------------------------------------
let allConsumablesData = {};
let selectedConsumableId = null;

// 소모품 실시간 데이터 리스너 등록 함수
let consumablesListenerRef = null;
function startConsumablesListener() {
    if (consumablesListenerRef) return;
    
    console.log('[Consumables] Starting database listener...');
    consumablesListenerRef = db.ref('consumables');
    window.AppSubscriptionManager.subscribe('consumables', consumablesListenerRef, (snapshot) => {
        const data = snapshot.val() || {};
        
        // 키 이름(id) 설정
        for (let key in data) {
            if (data[key] && typeof data[key] === 'object') {
                data[key].id = key;
            }
        }
        
        allConsumablesData = data;
        
        // 데이터가 아예 없으면 기본 소모품 항목들 추가
        if (Object.keys(data).length === 0) {
            initializeDefaultConsumables();
            return;
        }
        
        renderConsumables();
    }, (error) => {
        console.warn('[Consumables] Firebase database read permission denied or error:', error);
    });
}

window.stopConsumablesListener = function() {
    if (consumablesListenerRef) {
        console.log('[Consumables] Stopping database listener...');
        consumablesListenerRef.off();
        consumablesListenerRef = null;
    }
    allConsumablesData = {};
    if (document.getElementById('consumables-grid')) document.getElementById('consumables-grid').innerHTML = '';
}

// 기본 소모품 품목 초기화 함수
function initializeDefaultConsumables() {
    const defaults = {
        'face_cover': { name: '페이스커버', currentStock: 100, alertThreshold: 20 },
        'mask': { name: '마스크', currentStock: 100, alertThreshold: 20 },
        'box_tape': { name: '박스테이프', currentStock: 10, alertThreshold: 3 },
        'tissue': { name: '휴지', currentStock: 50, alertThreshold: 10 }
    };
    
    db.ref('consumables').set(defaults)
        .then(() => console.log('[Consumables] Default consumables initialized.'))
        .catch(e => console.error('[Consumables] Failed to initialize default consumables:', e));
}

// 소모품 카드 그리드 렌더링
function renderConsumables() {
    const grid = document.getElementById('consumables-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    const user = AppStore.getCurrentUser();
    const isApproved = user && user.approved;
    
    Object.values(allConsumablesData).forEach(item => {
        if (!item || typeof item !== 'object') return;
        const current = item.currentStock || 0;
        const threshold = item.alertThreshold || 10;
        
        // 상태 설정: 부족(alertThreshold 이하), 보통(alertThreshold * 2 미만), 여유(그 이상)
        let statusClass = 'stock-high';
        let statusText = '여유';
        if (current <= threshold) {
            statusClass = 'stock-low';
            statusText = '부족';
        } else if (current < threshold * 2) {
            statusClass = 'stock-medium';
            statusText = '보통';
        }
        
        // 프로그레스 바 비율 계산 (기본 100% 한도는 threshold * 3으로 설정하여 스케일링)
        const maxScale = threshold * 3;
        const progressPercent = maxScale > 0 ? Math.min(100, Math.round((current / maxScale) * 100)) : 0;
        
        const card = document.createElement('div');
        card.className = 'consumable-card';
        card.innerHTML = `
            <div class="consumable-header">
                <span class="consumable-name">${item.name}</span>
                <span class="consumable-badge ${statusClass}">${statusText}</span>
            </div>
            <div class="consumable-stock-section">
                <span class="consumable-stock-num">${current}</span>
                <span class="consumable-stock-unit">${item.unit || '개'}</span>
            </div>
            <div class="consumable-progress-bar">
                <div class="consumable-progress-fill ${statusClass}" style="width: ${progressPercent}%"></div>
            </div>
            <div class="consumable-actions">
                <button onclick="adjustStock('${item.id}', -5)" class="stock-btn" ${!isApproved ? 'disabled' : ''}>-5</button>
                <button onclick="adjustStock('${item.id}', -1)" class="stock-btn" ${!isApproved ? 'disabled' : ''}>-1</button>
                <span style="width: 1px; height: 16px; background-color: var(--border-color); margin: 0 2px;"></span>
                <button onclick="adjustStock('${item.id}', 1)" class="stock-btn" ${!isApproved ? 'disabled' : ''}>+1</button>
                <button onclick="adjustStock('${item.id}', 5)" class="stock-btn" ${!isApproved ? 'disabled' : ''}>+5</button>
                <button onclick="openEditConsumableModal('${item.id}')" class="stock-settings-btn" title="품목 수정" ${!isApproved ? 'disabled' : ''}>
                    <span class="material-symbols-rounded" style="font-size:1.1rem;">settings</span>
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
}

// 재고 조정 함수
async function adjustStock(itemId, amount) {
    if (!await checkAuth('승인된 사용자만 재고 관리가 가능합니다.')) return;
    
    const item = allConsumablesData[itemId];
    if (!item) return;
    
    const newStock = Math.max(0, (item.currentStock || 0) + amount);
    if (newStock === item.currentStock) return;
    
    const currentUser = AppStore.getCurrentUser();
    const operatorName = currentUser ? currentUser.displayName : '익명';
    
    // DB 업데이트
    db.ref('consumables/' + itemId).update({ currentStock: newStock })
        .then(() => {
            // 변경 이력 저장
            const logEntry = {
                itemId: itemId,
                itemName: item.name,
                change: amount > 0 ? `+${amount}` : `${amount}`,
                newStock: newStock,
                unit: item.unit || '개',
                operator: operatorName,
                timestamp: Date.now()
            };
            db.ref('consumablesLog').push(logEntry);
            
            // 임계치 이하로 떨어졌을 때 토스트 경고 알림
            if (newStock <= (item.alertThreshold || 10)) {
                showToast(`🚨 ${item.name} 재고가 부족합니다! (현재: ${newStock}${item.unit || '개'})`, 'warning');
            } else {
                showToast(`${item.name} 재고가 업데이트되었습니다.`, 'info');
            }
        })
        .catch(e => showToast('재고 수정 실패: ' + e.message, 'error'));
}

// 모달 제어 함수들
async function openAddConsumableModal() {
    if (!await checkAuth('승인된 사용자만 품목을 추가할 수 있습니다.')) return;
    selectedConsumableId = null;
    document.getElementById('consumableModalTitle').textContent = '소모품 품목 추가';
    document.getElementById('consumableNameInput').value = '';
    document.getElementById('consumableNameInput').disabled = false;
    document.getElementById('consumableStockInput').value = 0;
    document.getElementById('consumableUnitInput').value = '개';
    document.getElementById('consumableThresholdInput').value = 10;
    document.getElementById('consumableDeleteBtn').style.display = 'none';
    document.getElementById('consumableModal').style.display = 'flex';
}

async function openEditConsumableModal(itemId) {
    if (!await checkAuth('승인된 사용자만 품목을 수정할 수 있습니다.')) return;
    const item = allConsumablesData[itemId];
    if (!item) return;
    
    selectedConsumableId = itemId;
    document.getElementById('consumableModalTitle').textContent = '소모품 품목 수정';
    document.getElementById('consumableNameInput').value = item.name;
    document.getElementById('consumableNameInput').disabled = true; // 이름 수정 불가
    document.getElementById('consumableStockInput').value = item.currentStock || 0;
    document.getElementById('consumableUnitInput').value = item.unit || '개';
    document.getElementById('consumableThresholdInput').value = item.alertThreshold || 10;
    document.getElementById('consumableDeleteBtn').style.display = 'inline-block';
    document.getElementById('consumableModal').style.display = 'flex';
}

function closeConsumableModal() {
    document.getElementById('consumableModal').style.display = 'none';
}

async function saveConsumable() {
    if (!await checkAuth('승인된 사용자만 설정할 수 있습니다.')) return;
    
    const name = document.getElementById('consumableNameInput').value.trim();
    const currentStock = parseInt(document.getElementById('consumableStockInput').value) || 0;
    const unit = document.getElementById('consumableUnitInput').value.trim() || '개';
    const alertThreshold = parseInt(document.getElementById('consumableThresholdInput').value) || 0;
    
    if (!name) {
        await customAlert('품목 이름을 입력해 주세요.');
        return;
    }
    
    const currentUser = AppStore.getCurrentUser();
    const operatorName = currentUser ? currentUser.displayName : '익명';
    
    if (selectedConsumableId) {
        // 기존 품목 정보 수정
        const item = allConsumablesData[selectedConsumableId];
        if (!item) {
            showToast('존재하지 않는 품목입니다.', 'error');
            closeConsumableModal();
            return;
        }
        db.ref('consumables/' + selectedConsumableId).update({
            currentStock: currentStock,
            alertThreshold: alertThreshold,
            unit: unit
        }).then(() => {
            const stockDiff = currentStock - (item.currentStock || 0);
            if (stockDiff !== 0) {
                db.ref('consumablesLog').push({
                    itemId: selectedConsumableId,
                    itemName: item.name,
                    change: stockDiff > 0 ? `+${stockDiff} (수정)` : `${stockDiff} (수정)`,
                    newStock: currentStock,
                    unit: unit,
                    operator: operatorName,
                    timestamp: Date.now()
                });
            }
            showToast('품목 정보가 수정되었습니다.', 'info');
            closeConsumableModal();
        }).catch(e => showToast('수정 실패: ' + e.message, 'error'));
    } else {
        // 새 품목 추가
        const itemId = 'item_' + Date.now();
        db.ref('consumables/' + itemId).set({
            name: name,
            currentStock: currentStock,
            alertThreshold: alertThreshold,
            unit: unit
        }).then(() => {
            db.ref('consumablesLog').push({
                itemId: itemId,
                itemName: name,
                change: `신규 등록 (+${currentStock})`,
                newStock: currentStock,
                unit: unit,
                operator: operatorName,
                timestamp: Date.now()
            });
            showToast('새 품목이 등록되었습니다.', 'info');
            closeConsumableModal();
        }).catch(e => showToast('등록 실패: ' + e.message, 'error'));
    }
}

async function deleteConsumable() {
    if (!selectedConsumableId) return;
    if (!await checkAuth('승인된 사용자만 삭제할 수 있습니다.')) return;
    
    const item = allConsumablesData[selectedConsumableId];
    if (!item) return;
    
    if (await customConfirm(`'${item.name}' 품목을 정말로 삭제하시겠습니까?`)) {
        const currentUser = AppStore.getCurrentUser();
        const operatorName = currentUser ? currentUser.displayName : '익명';
        
        db.ref('consumables/' + selectedConsumableId).remove()
            .then(() => {
                db.ref('consumablesLog').push({
                    itemId: selectedConsumableId,
                    itemName: item.name,
                    change: `품목 삭제`,
                    newStock: 0,
                    operator: operatorName,
                    timestamp: Date.now()
                });
                showToast('품목이 삭제되었습니다.', 'info');
                closeConsumableModal();
            })
            .catch(e => showToast('삭제 실패: ' + e.message, 'error'));
    }
}

// 이력 모달 제어
let consumablesLogListenerRef = null;
async function openConsumablesLogModal() {
    if (!await checkAuth('승인된 사용자만 이력을 확인할 수 있습니다.')) return;
    const listEl = document.getElementById('consumables-log-list');
    if (!listEl) return;
    listEl.innerHTML = '<li style="justify-content:center; color:var(--text-muted);">불러오는 중...</li>';
    
    document.getElementById('consumablesLogModal').style.display = 'flex';
    
    window.AppSubscriptionManager.unsubscribe('consumablesLog');
    
    consumablesLogListenerRef = db.ref('consumablesLog').orderByChild('timestamp').limitToLast(50);
    window.AppSubscriptionManager.subscribe('consumablesLog', consumablesLogListenerRef, (snapshot) => {
        listEl.innerHTML = '';
        const logs = [];
        
        snapshot.forEach(child => {
            logs.push(child.val());
        });
        
        logs.reverse();
        
        if (logs.length === 0) {
            listEl.innerHTML = '<li style="justify-content:center; color:var(--text-muted); background:transparent; border:1px dashed var(--border-color);">변경 이력이 없습니다.</li>';
            return;
        }
        
        logs.forEach(log => {
            const timeStr = new Date(log.timestamp).toLocaleString('ko-KR', { hour12: false });
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';
            li.style.padding = '0.8rem 1rem';
            li.style.borderBottom = '1px solid var(--border-color)';
            
            const changeText = log.change || '';
            const isPlus = changeText.startsWith('+') || changeText.includes('신규');
            const isDelete = changeText.includes('삭제');
            let badgeColor = '#F59E0B'; 
            let badgeBg = '#FEF3C7';
            if (isDelete) {
                badgeColor = 'var(--danger)';
                badgeBg = '#FDE8E8';
            } else if (isPlus) {
                badgeColor = '#10B981'; 
                badgeBg = '#DEF7EC';
            }
            
            li.innerHTML = `
                <div>
                    <div style="font-weight:700; color:var(--text-main); font-size:0.95rem;">${log.itemName || '알 수 없는 품목'}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">작업자: ${log.operator || '익명'} | ${timeStr}</div>
                </div>
                <div style="text-align:right;">
                    <span style="font-size:0.8rem; font-weight:800; color:${badgeColor}; background-color:${badgeBg}; padding:2px 8px; border-radius:6px; display:inline-block;">${changeText}</span>
                    <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">현재고: ${log.newStock || 0}개</div>
                </div>
            `;
            listEl.appendChild(li);
        });
    });
}

function closeConsumablesLogModal() {
    document.getElementById('consumablesLogModal').style.display = 'none';
    window.AppSubscriptionManager.unsubscribe('consumablesLog');
    consumablesLogListenerRef = null;
}

// ====================================================
// 카카오톡 데일리 브리핑 연동 (Kakao SDK)
// ====================================================
window.loginAndSendKakaoBriefing = function() {
    if (!window.Kakao || !Kakao.isInitialized()) {
        alert("카카오 SDK가 초기화되지 않았습니다. 인터넷 연결이나 키 설정을 확인해주세요.");
        return;
    }

    Kakao.Auth.login({
        scope: 'talk_message',
        success: function(authObj) {
            console.log("Kakao Auth Success:", authObj);
            sendKakaoDailyBriefing();
        },
        fail: function(err) {
            console.error("Kakao Auth Error:", err);
            alert("카카오 로그인에 실패했습니다: " + JSON.stringify(err));
        }
    });
};

window.sendKakaoDailyBriefing = function() {
    const todayStr = new Date().toISOString().split('T')[0];
    const myName = (typeof firebase !== 'undefined' && firebase.auth().currentUser) ? firebase.auth().currentUser.displayName : '나';
    
    // 오늘의 출장자 파악
    const trips = Object.values(AppStore.getTrips()).filter(t => {
        const parsed = typeof parseTripDateRange === 'function' ? parseTripDateRange(t.date) : { startDate: t.date, endDate: t.date };
        return todayStr >= (parsed.startDate || t.date) && todayStr <= (parsed.endDate || t.date);
    });
    const myTrips = trips.filter(t => t.assignee && t.assignee.includes(myName));
    const tripNames = myTrips.length > 0 ? myTrips.map(t => {
        let title = t.name || t.destination || '출장';
        if (typeof parseTripDisplayInfo === 'function') {
            title = parseTripDisplayInfo(t).cleanTitle || title;
        }
        return title;
    }).join('\\n- ') : '없음';
    
    // 오늘의 휴가자 파악
    const leaves = Object.values(AppStore.getLeaves()).filter(l => l.date === todayStr && l.status === 'approved' && l.userName === myName);
    const leaveNames = leaves.length > 0 ? '연차휴가' : '없음';
    
    // 내 칸반 업무 파악
    const myTasks = Object.values(AppStore.getTasks() || {}).filter(t => t.assignee && t.assignee.includes(myName) && t.status !== 'done');
    const taskNames = myTasks.length > 0 ? myTasks.map(t => {
        let title = t.title || t.name;
        if (typeof parseTaskDisplayInfo === 'function') {
            title = parseTaskDisplayInfo(t).cleanTitle || title;
        }
        return title;
    }).join('\\n- ') : '없음';

    const textMessage = `[FaWW 브리핑] 📅 ${todayStr}

${myName}님의 오늘 일정입니다.

` +
        `🚗 출장
- ${tripNames}

` +
        `📋 업무
- ${taskNames}

` +
        `🌴 휴가
- ${leaveNames}

` +
        `오늘도 활기찬 하루 되세요! 🚀`;

    Kakao.API.request({
        url: '/v2/api/talk/memo/default/send',
        data: {
            template_object: {
                object_type: 'text',
                text: textMessage,
                link: {
                    web_url: window.location.href,
                    mobile_web_url: window.location.href
                },
                button_title: 'FaWW 열기'
            }
        },
        success: function(res) {
            alert("✅ 오늘의 브리핑이 내 카카오톡으로 전송되었습니다!");
        },
        fail: function(err) {
            console.error("Kakao Send Error:", err);
            alert("메시지 전송 실패: " + JSON.stringify(err) + "\n(디벨로퍼스 설정에서 도메인 및 권한을 다시 한번 확인해 주세요!)");
        }
    });
};

window.getAllFilesData = () => allFilesData;
window.setAllFilesData = (v) => { allFilesData = v; };
window.clearServicesData = function() {
    allFilesData = {};
    if (document.getElementById('fileList')) document.getElementById('fileList').innerHTML = '';
};
