// Data clear helper
window.clearAllAppStoreData = function() {
    AppStore.setTasks({});
    AppStore.setTrips({});
    AppStore.setLeaves({});
    AppStore.setUsers({});
    AppStore.setNotices({});
    AppStore.setDailyTasks({});
    AppStore.setDailyLogs({});
    AppStore.setNotifications({});
    AppStore.setExternalEvents({});
    AppStore.setMeetingFeeds({});
    AppStore.setTripVehicles({});

    if (document.getElementById('chat-messages')) document.getElementById('chat-messages').innerHTML = '';
    if (document.getElementById('communication-list')) document.getElementById('communication-list').innerHTML = '';
    if (document.getElementById('feed-container')) document.getElementById('feed-container').innerHTML = '';
    if (document.getElementById('todo-list')) document.getElementById('todo-list').innerHTML = '';
    if (document.getElementById('doing-list')) document.getElementById('doing-list').innerHTML = '';
    if (document.getElementById('done-list')) document.getElementById('done-list').innerHTML = '';
    if (document.getElementById('notification-list')) document.getElementById('notification-list').innerHTML = '';
    if (document.getElementById('user-approval-list')) document.getElementById('user-approval-list').innerHTML = '';
    if (document.getElementById('user-member-list')) document.getElementById('user-member-list').innerHTML = '';
    if (typeof window.clearServicesData === 'function') window.clearServicesData();
};

// 모바일/PWA 환경 디버깅을 위한 전역 에러 핸들러 (외부 CDN/크로스오리진 단순 Script error 제외)
window.addEventListener('error', function(event) {
    if (event.message === 'Script error.' || (!event.filename && event.lineno === 0)) {
        console.warn('[Cross-Origin Warning]', event);
        return;
    }
    alert('[Global Error]\n' + event.message + '\nFile: ' + event.filename + '\nLine: ' + event.lineno);
});
window.addEventListener('unhandledrejection', function(event) {
    const reason = event.reason;
    console.warn('[Promise Rejection]', reason);
});

// Firebase Auth 세션 유지 설정 (LOCAL) 및 리다이렉트 결과 안전 처리
if (typeof auth !== 'undefined') {
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
        .then(() => {
            console.log("[Auth] Session persistence set to LOCAL successfully.");
        })
        .catch((error) => {
            console.error("[Auth] Error setting persistence:", error);
        });

    auth.getRedirectResult().then((result) => {
        if (result && result.user) {
            console.log("리다이렉트 로그인 성공:", result.user.displayName);
            showToast(`반갑습니다, ${result.user.displayName}님!`, 'info');
        }
    }).catch(async (error) => {
        console.error("리다이렉트 결과 처리 에러:", error);
        if (error.code === 'auth/unauthorized-domain') {
            await customAlert('승인되지 않은 도메인입니다. Firebase 콘솔 설정을 확인하세요.');
        } else if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
            showToast('로그인 처리 중 오류가 발생했습니다: ' + error.message, 'warning');
        }
    });
}

/**
 * 구글 로그인 실행 (PWA 모드/모바일/PC 환경 맞춤형 인증 흐름)
 */
function loginWithGoogle() {
    const ua = navigator.userAgent.toLowerCase();
    const isKakao = /kakaotalk/i.test(ua);
    const isLine = /line/i.test(ua);
    const isOtherInApp = /instagram|fb_iab|fban|fbav|twitter|snapchat/i.test(ua);
    const isInApp = isKakao || isLine || isOtherInApp;

    // 1. 카카오톡/라인 등 앱 내장 브라우저(WebView) 예외 처리
    if (isInApp) {
        if (isKakao) {
            window.location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(window.location.href);
        } else if (isLine) {
            const currentUrl = new URL(window.location.href);
            currentUrl.searchParams.set('openExternalBrowser', '1');
            window.location.href = currentUrl.toString();
        }
        
        customAlert(
            '보안 정책에 따라 앱 내장 브라우저(카카오톡, 라인, 인스타그램 등)에서는 구글 로그인이 제한됩니다.\n\n' +
            '화면 우측 상단의 메뉴 버튼(점 3개 또는 더보기)을 눌러 [다른 브라우저로 열기] 또는 [Safari/Chrome에서 열기]를 선택한 후 다시 시도해 주세요!'
        );
        return;
    }

    // 2. 모바일 및 PWA Standalone 모드 포함 전체 환경에서 signInWithPopup 우선 사용
    // (Cross-Domain 환경의 PWA 리다이렉트는 3자 쿠키/ITP 차단으로 세션 손실 문제가 발생하므로 Popup 방식이 가장 안전합니다.)
    auth.signInWithPopup(provider).then((result) => {
        console.log("구글 팝업 로그인 성공:", result.user.displayName);
        showToast(`${result.user.displayName}님 반갑습니다!`, 'info');
    }).catch(async (error) => {
        console.error("구글 팝업 로그인 실패:", error);
        
        // 팝업이 차단되었거나 취소된 경우 안내 메시지 제공
        if (error.code === 'auth/popup-blocked' || error.code === 'auth/operation-not-supported-in-this-environment') {
            await customAlert(
                '🔐 로그인 팝업창이 차단되어 있습니다.\n\n' +
                '안전한 로그인을 위해 브라우저 설정에서 [팝업 차단]을 해제해 주세요!\n\n' +
                '■ 아이폰 (Safari): [설정] > [Safari] > [팝업 차단] 비활성화(OFF)\n' +
                '■ 안드로이드 (Chrome): Chrome [설정] > [사이트 설정] > [팝업 및 리다이렉트] 허용'
            );
        } else if (error.code === 'auth/unauthorized-domain' || error.message.includes('disallowed_useragent')) {
            await customAlert('보안 정책에 따라 앱 내장 브라우저에서는 로그인이 제한됩니다.\n\n우측 상단 메뉴를 눌러 Safari 또는 Chrome에서 연 후 시도해 주세요.');
        } else if (error.code !== 'auth/popup-closed-by-user') {
            await customAlert('로그인에 실패했습니다. (' + error.message + ')');
        }
    });
}

/**
 * 로그아웃 실행
 */
async function logout() {
    if(await customConfirm('로그아웃 하시겠습니까?')) { 
        // 로그아웃 시에만 명시적으로 구글 연동 데이터 파기 (로컬 토큰만)
        localStorage.removeItem('google_access_token');
        if (typeof googleAccessToken !== 'undefined') googleAccessToken = null;
        if (typeof invalidateGoogleSyncSession === 'function') invalidateGoogleSyncSession(); // 진행 중인 이전 동기화 중단
        if (typeof updateGoogleSyncUI === 'function') updateGoogleSyncUI();
        
        // 주의: 공용 DB의 일정은 삭제하지 않음 (팀 전체 공유 유지)
        auth.signOut(); 
    }
}

async function requestNotificationPermission() {
    if (!("Notification" in window)) {
        console.log("이 브라우저는 데스크톱 시스템 알림을 지원하지 않습니다.");
        return;
    }
    if (Notification.permission === "default") {
        await Notification.requestPermission();
    }
}

// 서비스 워커 등록 및 메인 페이지와의 알림 클릭 연동 설정
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => {
                console.log('Service Worker registered successfully with scope: ', reg.scope);
            })
            .catch(err => {
                console.error('Service Worker registration failed: ', err);
            });
    });

    // 서비스 워커로부터 전달된 알림 클릭 메시지 수신 처리
    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
            const noti = event.data.noti;
            if (noti && typeof handleNotificationDeepLink === 'function') {
                markNotificationAsRead(noti.id);
                handleNotificationDeepLink(noti);
            }
        }
    });
}

// URL 쿼리 파라미터의 PWA 알림 딥링크 파싱 및 실행 처리
function checkNotificationUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const notiId = params.get('notiId');
    const notiLink = params.get('notiLink');
    const notiTargetId = params.get('notiTargetId');
    
    if (notiId && notiLink) {
        // 주소창에서 쿼리 매개변수를 제거하여 새로고침 시 중복 리다이렉션 방지
        window.history.replaceState({}, document.title, window.location.pathname);
        
        const noti = {
            id: notiId,
            link: notiLink,
            targetId: notiTargetId
        };
        
        // 로그인 인증 상태 완료 및 딥링크 처리 함수 준비 상태 대기
        const checkReady = setInterval(() => {
            if (typeof handleNotificationDeepLink === 'function' && auth.currentUser) {
                clearInterval(checkReady);
                markNotificationAsRead(noti.id);
                handleNotificationDeepLink(noti);
            }
        }, 300);
        
        // 최대 10초 대기 후 해제
        setTimeout(() => clearInterval(checkReady), 10000);
    }
}

// 앱 실행 시 즉시 권한 요청 및 쿼리 파라미터 확인 실행
if (document.readyState === 'loading') {
    

document.addEventListener('DOMContentLoaded', () => {
        requestNotificationPermission();
        checkNotificationUrlParams();
    });
} else {
    requestNotificationPermission();
    checkNotificationUrlParams();
}


initDashboardSortable();
    auth.onAuthStateChanged(async (user) => {
    if (user) {
        requestNotificationPermission(); // 로그인 시 시스템 알림 권한 승인 유도
        
        // 계정 전환 시 이전 계정의 데이터와 구독 완전 초기화
        window.isListenerInitialized = false;
        window.AppSubscriptionManager.unsubscribeAllExcept([]);
        if (typeof window.clearAllAppStoreData === 'function') window.clearAllAppStoreData();
        AppStore.setCurrentUser(null);
        if (typeof window.cleanupPrivateChatState === 'function') window.cleanupPrivateChatState();
        if (typeof window.stopConsumablesListener === 'function') window.stopConsumablesListener();

        window.AppSubscriptionManager.subscribe('userProfile', db.ref('users/' + user.uid), (snapshot) => {
            const profile = snapshot.val();
            
            // 신규 사용자 정보 자동 등록 (DB에 프로필이 없는 경우)
            if (!profile) {
                const isSystemAdmin = (user.uid === 'jaGugunGReXytCgbqYwQUybxyJL2');
                db.ref('users/' + user.uid).set({
                    displayName: user.displayName || '익명',
                    email: user.email,
                    approved: isSystemAdmin, // 최고관리자 UID인 경우 자동 승인
                    leaveTotal: 15,
                    department: 'unassigned'
                }).catch((error) => {
                    alert("[DB 프로필 등록 에러] " + error.message);
                });
                return;
            }

            // 로그인 시 AppStore 초기화 및 동기화
            AppStore.setCurrentUser({ ...user, ...profile });
            updateUIPermissions(user, profile);
            
            if (profile && profile.approved) {
                if (document.getElementById('tab-btn-admin')) {
                    document.getElementById('tab-btn-admin').style.display = (user.uid === 'jaGugunGReXytCgbqYwQUybxyJL2') ? 'flex' : 'none';
                }
                if(typeof renderMyPage === 'function') renderMyPage();
                if(typeof renderAdminLeaves === 'function') renderAdminLeaves();
                if(typeof initPdfToolSettings === 'function') initPdfToolSettings();
                if(typeof loadProposalSettings === 'function') loadProposalSettings();

                // 업무 구독은 '미승인 → 승인' 전환 시 한 번만 시작한다.
                // (프로필 값이 바뀔 때마다 전체 구독을 재등록·재다운로드하지 않도록 함)
                if (!window.isListenerInitialized) {
                window.isListenerInitialized = true;
                listenForUsers();
                if (typeof startNotificationListener === 'function') startNotificationListener();
                if (typeof startKanbanSubscriptions === 'function') startKanbanSubscriptions();
                if (typeof startLeaveSubscriptions === 'function') startLeaveSubscriptions();
                if (typeof startMapSubscriptions === 'function') startMapSubscriptions();
                if (typeof startServicesSubscriptions === 'function') startServicesSubscriptions();
                if (typeof startServicesSubscriptions2 === 'function') startServicesSubscriptions2();
                if (typeof startConsumablesListener === 'function') startConsumablesListener();
                
                window.AppSubscriptionManager.subscribe('external_events', db.ref('external_events'), (snapshot) => {
                    const externalEvents = snapshot.val() || {};
                    AppStore.setExternalEvents(externalEvents);
                    if (typeof renderTabCalendar === 'function') renderTabCalendar();
                    if (typeof renderTasks === 'function') renderTasks();
                    if (typeof renderTripList === 'function') renderTripList();
                });
                window.AppSubscriptionManager.subscribe('tripVehicles', db.ref('tripVehicles'), (snapshot) => {
                    AppStore.setTripVehicles(snapshot.val() || {});
                    if (typeof showBriefingTrips === 'function' && document.getElementById('briefingTripsModal') && document.getElementById('briefingTripsModal').style.display !== 'none') {
                        let currentMode = 'my';
                        const teamBtn = document.getElementById('btnTeamTrips');
                        const coupangBtn = document.getElementById('btnCoupangTrips');
                        if (teamBtn && teamBtn.style.background === 'var(--primary)') currentMode = 'team';
                        else if (coupangBtn && coupangBtn.style.background === 'var(--primary)') currentMode = 'coupang';
                        showBriefingTrips(currentMode);
                    }
                });
                }
            } else {
                if (document.getElementById('tab-btn-admin')) document.getElementById('tab-btn-admin').style.display = 'none';
                window.AppSubscriptionManager.unsubscribeAllExcept(['userProfile']);
                window.isListenerInitialized = false;
                if (typeof window.clearAllAppStoreData === 'function') window.clearAllAppStoreData();
                if (typeof window.stopConsumablesListener === 'function') window.stopConsumablesListener();
                if (typeof window.cleanupPrivateChatState === 'function') window.cleanupPrivateChatState();
                
            }
        }, (dbError) => {
            alert("[DB 프로필 읽기 에러] " + dbError.message);
        });

    } else {
        // 로그아웃 시 로컬 상태만 초기화 (자동 파기는 logout 함수에서 명시적으로 처리)
        AppStore.setCurrentUser(null);
        window.isListenerInitialized = false;
        window.AppSubscriptionManager.unsubscribeAllExcept([]);
        if (typeof window.clearAllAppStoreData === 'function') window.clearAllAppStoreData();
        
        if (typeof window.stopConsumablesListener === 'function') window.stopConsumablesListener();
        if (typeof window.cleanupPrivateChatState === 'function') window.cleanupPrivateChatState();
        
        
        updateUIPermissions(null, null);
        if (document.getElementById('tab-btn-admin')) document.getElementById('tab-btn-admin').style.display = 'none';
        if(typeof renderMyPage === 'function') renderMyPage();
        switchTab('tab-tasks', document.querySelector('.tab-btn'));
    }
});

function updateUIPermissions(user, profile) {
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const userInfo = document.getElementById('user-info');
    const userAvatar = document.getElementById('user-avatar');
    const controls = [
        document.getElementById('taskInput'), 
        document.querySelector('.task-input-area button'), 
        document.getElementById('assigneeInput'), 
        document.getElementById('priorityInput'), 
        document.getElementById('fileInput'), 
        document.querySelector('.upload-area button'), 
        document.getElementById('addTripBtn'), 
        document.getElementById('addNoticeBtn'),
        document.getElementById('addConsumableBtn'),
        document.getElementById('consumablesLogBtn')
    ];

    const isLoggedIn = !!user;
    const isApproved = isLoggedIn && profile && profile.approved;

    if (loginBtn) loginBtn.style.display = isLoggedIn ? 'none' : 'inline-block';
    if (logoutBtn) logoutBtn.style.display = isLoggedIn ? 'inline-block' : 'none';

    if (isLoggedIn) {
        if (userAvatar) {
            userAvatar.src = user.photoURL || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%23E5E7EB'/%3E%3C/svg%3E";
            userAvatar.style.display = 'block';
        }
        
        if (isApproved) {
            if (userInfo) userInfo.textContent = `${user.displayName}님 반갑습니다.`;
            controls.forEach(el => { if (el) el.disabled = false; });
        } else {
            if (userInfo) userInfo.textContent = `관리자 승인 대기 중입니다.`;
            controls.forEach(el => { if (el) el.disabled = true; });
        }
    } else {
        if (userInfo) userInfo.textContent = '';
        if (userAvatar) userAvatar.style.display = 'none';
        controls.forEach(el => { if (el) el.disabled = true; });
    }
    
    // 소모품 권한 업데이트 및 리렌더링
    if (typeof renderConsumables === 'function') renderConsumables();
}

function updateFileName(inputId, displayId) {
    const input = document.getElementById(inputId);
    const display = document.getElementById(displayId);
    if (!input || !display) return;

    if (input.files.length > 0) {
        display.textContent = input.files[0].name;
    } else {
        if (inputId === 'fileInput') {
            display.textContent = '선택된 파일 없음';
        } else {
            const existingUrl = input.dataset.existingUrl;
            const existingPath = input.dataset.existingPath;
            display.textContent = (existingUrl && existingPath) ? `기존 첨부파일: ${existingPath.split('_').pop()}` : '';
        }
    }
}

function listenForUsers() {
    window.AppSubscriptionManager.subscribe('adminUsers', db.ref('users'), (snapshot) => {
        const approvalListEl = document.getElementById('user-approval-list');
        const memberListEl = document.getElementById('user-member-list');
        if (!approvalListEl || !memberListEl) return;

        approvalListEl.innerHTML = '';
        memberListEl.innerHTML = '';
        
        const users = snapshot.val();
        if (!users) {
            approvalListEl.innerHTML = '<li>승인 대기 중인 사용자가 없습니다.</li>';
            memberListEl.innerHTML = '<li>등록된 멤버가 없습니다.</li>';
            return;
        }

        let pendingCount = 0, memberCount = 0;
        Object.keys(users).forEach(uid => {
            const user = users[uid];
            const li = document.createElement('li');
            const safeName = user.displayName ? user.displayName.replace(/'/g, "\\'") : '사용자';
            
            if (!user.approved) {
                li.innerHTML = `<span>${user.displayName} <small style="color: var(--text-muted); font-weight: normal;">(${user.email})</small></span>
                                <div style="display:flex; gap:0.5rem;">
                                    <button onclick="approveUser('${uid}', '${safeName}')">승인</button>
                                    <button class="revoke-btn" onclick="deleteUser('${uid}', '${safeName}')">거절</button>
                                </div>`;
                approvalListEl.appendChild(li); pendingCount++;
            } else {
                const actionBtn = (uid === 'jaGugunGReXytCgbqYwQUybxyJL2') ? `<span style="font-size: 0.8rem; color: var(--primary); font-weight: bold;">최고관리자</span>` : `<button class="revoke-btn" onclick="revokeUser('${uid}', '${safeName}')">해제</button>`;
                li.innerHTML = `<span>${user.displayName} <small style="color: var(--text-muted); font-weight: normal;">(${user.email})</small></span>${actionBtn}`;
                memberListEl.appendChild(li); memberCount++;
            }
        });
        if (pendingCount === 0) approvalListEl.innerHTML = '<li>승인 대기 중인 사용자가 없습니다.</li>';
        if (memberCount === 0) memberListEl.innerHTML = '<li>등록된 멤버가 없습니다.</li>';
    });
}

async function approveUser(uid, name) {
    if (await customConfirm(`'${name}'님을 승인하시겠습니까?`)) {
        db.ref('users/' + uid).update({ approved: true }).catch(async (error) => await customAlert("승인 오류: " + error.message));
    }
}

async function revokeUser(uid, name) {
    if (await customConfirm(`'${name}'님의 승인 권한을 해제하시겠습니까?`)) {
        db.ref('users/' + uid).update({ approved: false }).catch(async (error) => await customAlert("해제 오류: " + error.message));
    }
}

async function deleteUser(uid, name) {
    if (await customConfirm(`'${name}'님의 승인 요청을 거절하고 삭제하시겠습니까?`)) {
        db.ref('users/' + uid).remove().catch(async (error) => await customAlert("삭제 오류: " + error.message));
    }
}

function openProfileModal() {
    const currentUserProfile = AppStore.getCurrentUser();
    if (!currentUserProfile) return;
    document.getElementById('profileNameInput').value = currentUserProfile.displayName || '';
    document.getElementById('profileDeptInput').value = currentUserProfile.department || 'unassigned';
    document.getElementById('profileModal').style.display = 'flex';
}

function closeProfileModal() {
    document.getElementById('profileModal').style.display = 'none';
}

async function saveProfile() {
    if (!auth.currentUser) return;
    const newName = document.getElementById('profileNameInput').value.trim();
    const newDept = document.getElementById('profileDeptInput').value;
    
    if (!newName) return await customAlert('이름을 입력해 주세요.');
    
    try {
        await db.ref('users/' + auth.currentUser.uid).update({ displayName: newName, department: newDept });
        await auth.currentUser.updateProfile({ displayName: newName });
        closeProfileModal();
        showToast('프로필 정보가 업데이트되었습니다.', 'info');
    } catch (error) {
        console.error(error);
        await customAlert('저장 오류: ' + error.message);
    }
}

// 브라우저 탭 활성화 시 데이터 리프레시
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        setTimeout(() => {
            try { if (typeof renderTripList === 'function') renderTripList(); } catch(e){}
            try { if (typeof renderTasks === 'function') renderTasks(); } catch(e){}
            try { if (typeof renderMyPage === 'function') renderMyPage(); } catch(e){}
            try { if (typeof renderLeaveUI === 'function') renderLeaveUI(); } catch(e){}
            try { if (typeof renderNotices === 'function') renderNotices(); } catch(e){}
            try { if (typeof renderMeetingFeedUI === 'function') renderMeetingFeedUI(); } catch(e){}
            try { if (typeof renderConsumables === 'function') renderConsumables(); } catch(e){}
        }, 100);
    }
});

// ----------------------------------------------------
// 미니게임 (이스터에그: 로고 5번 클릭)
// ----------------------------------------------------
let logoClickCount = 0;
let logoClickTimer = null;
let gameScore = 0;
let gameTimeLeft = 30;
let gameInterval = null;
let moleInterval = null;
let isGameRunning = false;

setTimeout(() => {
    const logo = document.getElementById('header-logo');
    if (logo) {
        logo.addEventListener('click', () => {
            logoClickCount++;
            clearTimeout(logoClickTimer);
            
            if (logoClickCount >= 5) {
                logoClickCount = 0;
                startMiniGame();
            } else {
                logoClickTimer = setTimeout(() => { logoClickCount = 0; }, 800);
            }
        });
    }
}, 500);

function startMiniGame() {
    if (isGameRunning) return;
    isGameRunning = true; gameScore = 0; gameTimeLeft = 30;
    const scoreEl = document.getElementById('gameScore');
    const timeEl = document.getElementById('gameTime');
    if(scoreEl) scoreEl.textContent = gameScore;
    if(timeEl) timeEl.textContent = gameTimeLeft;
    
    document.getElementById('miniGameModal').style.display = 'flex';
    
    const icons = ['work', 'flight_takeoff', 'mail', 'assignment', 'event_available'];
    const moles = document.querySelectorAll('.game-mole');
    
    gameInterval = setInterval(() => {
        gameTimeLeft--; 
        if(timeEl) timeEl.textContent = gameTimeLeft;
        if (gameTimeLeft <= 0) endMiniGame();
    }, 1000);

    moleInterval = setInterval(() => {
        const idx = Math.floor(Math.random() * moles.length); const mole = moles[idx];
        if (!mole.classList.contains('up')) {
            const iconEl = mole.querySelector('.material-symbols-rounded');
            const isBomb = Math.random() < 0.15;
            
            if (isBomb) { 
                if(iconEl) iconEl.textContent = 'bomb'; 
                mole.style.backgroundColor = '#1F2937'; 
                if(iconEl) iconEl.style.color = '#F87171'; 
                mole.dataset.type = 'bomb'; 
            } 
            else { 
                if(iconEl) iconEl.textContent = icons[Math.floor(Math.random() * icons.length)]; 
                mole.style.backgroundColor = '#FCD34D'; 
                if(iconEl) iconEl.style.color = '#B45309'; 
                mole.dataset.type = 'normal'; 
            }
            
            mole.classList.add('up'); mole.classList.remove('whacked');
            setTimeout(() => { mole.classList.remove('up'); }, Math.random() * 600 + 600);
        }
    }, 600);
}

function whackMole(mole) {
    if (!isGameRunning || !mole.classList.contains('up')) return;
    mole.classList.remove('up'); mole.classList.add('whacked');
    
    const scoreEl = document.getElementById('gameScore');
    if (mole.dataset.type === 'bomb') { 
        gameScore = Math.max(0, gameScore - 5); 
        if(scoreEl) scoreEl.style.color = 'var(--danger)'; 
    } 
    else { 
        gameScore += 10; 
        if(scoreEl) scoreEl.style.color = 'var(--primary)'; 
    }
    if(scoreEl) {
        scoreEl.textContent = gameScore; 
        setTimeout(() => { scoreEl.style.color = ''; }, 300);
    }
}

function endMiniGame() { 
    clearInterval(gameInterval); clearInterval(moleInterval); 
    isGameRunning = false; 
    document.querySelectorAll('.game-mole').forEach(m => m.classList.remove('up')); 
    customAlert(`게임 종료!\n\n최종 점수는 ${gameScore}점입니다.\n오늘 하루도 즐거운 업무 되세요!`); 
}

function closeGame() { if (isGameRunning) endMiniGame(); document.getElementById('miniGameModal').style.display = 'none'; }

// ----------------------------------------------------
// 문서 자동화 엔진 (Premium PDF Watermark Tool)
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-process-pdf');
    const fileInput = document.getElementById('pdf-file-input');
    const uploadZone = document.getElementById('pdf-upload-zone');
    const fileInfo = document.getElementById('selected-file-info');
    let selectedFile = null;

    if (!btn || !fileInput || !uploadZone) return;
    
    // 파일 탐색기 연동
    uploadZone.onclick = () => fileInput.click();
    
    // 드래그 앤 드롭 핸들러
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.style.borderColor = '#6366f1';
        uploadZone.style.background = '#f1f5ff';
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.style.borderColor = '#cbd5e1';
        uploadZone.style.background = '#f8fafc';
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.style.borderColor = '#cbd5e1';
        uploadZone.style.background = '#f8fafc';
        
        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type === 'application/pdf') {
            handleFileSelect(files[0]);
        } else {
            showToast("PDF 파일만 업로드 가능합니다.", "error");
        }
    });

    fileInput.onchange = (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    };

    function handleFileSelect(file) {
        selectedFile = file;
        if(fileInfo) {
            fileInfo.textContent = `준비됨: ${file.name}`;
            fileInfo.style.display = 'block';
            fileInfo.style.animation = 'fadeInUp 0.3s ease';
        }
        btn.disabled = false;
        showToast("파일이 드롭 스테이션에 장착되었습니다.", "success");
    }

    // 메인 프로세스 (워터마크 적용 및 다운로드)
    btn.onclick = async () => {
        if (!selectedFile) return;

        const watermarkText = document.getElementById('pdf-watermark-text').value;
        // 입력된 텍스트에서 첫 번째 단어(성함) 추출
        const namePart = watermarkText.split(' ')[0] || "사용자";
        
        const fd = new FormData();
        fd.append('file', selectedFile);
        fd.append('text', watermarkText);
        fd.append('font_size', document.getElementById('pdf-font-size').value);
        fd.append('opacity', document.getElementById('pdf-opacity').value);
        fd.append('tile_mode', document.getElementById('pdf-tile-mode').checked);
        fd.append('spacing_x', document.getElementById('pdf-spacing-x').value);
        fd.append('spacing_y', document.getElementById('pdf-spacing-y').value);
        fd.append('rotation', document.getElementById('pdf-rotation').value);
        fd.append('position', 'center');
        
        try {
            btn.disabled = true;
            btn.innerHTML = '<div class="spinner-small"></div> 처리 중...';
            
            let r;
            try {
                // 1차 시도: 로컬 초고속 워터마크 서버 (지연시간 0ms)
                r = await fetch('http://127.0.0.1:8000/watermark', { method: 'POST', body: fd });
            } catch (localErr) {
                console.log("로컬 PDF 서버 오프라인, 클라우드 워터마크 엔진으로 전환합니다.", localErr);
                showToast("클라우드 서버로 전환하여 처리를 진행합니다.\n(첫 실행 시 서버 구동으로 인해 약 1분 정도 소요될 수 있습니다)", "warning");
                // 2차 시도: 클라우드 예비 서버 (onrender.com)
                r = await fetch('https://pdf-watermark-server-sfxx.onrender.com/watermark', { method: 'POST', body: fd });
            }
            
            if (!r.ok) throw new Error(await r.text());
            
            // 파일명 처리: OriginalName (성함).pdf
            const baseName = selectedFile.name.replace('.pdf', '');
            const downloadName = `${baseName} (${namePart}).pdf`;
            
            const b = await r.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(b);
            a.download = downloadName;
            a.click();
            
            showToast("문서 처리가 완료되었습니다!", "success");
        } catch (e) { 
            console.error('PDF 처리 에러:', e);
            showToast("서버 연결 실패 또는 처리 오류", "error");
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<span class="material-symbols-rounded">download_for_offline</span> 적용 및 다운로드';
        }
    };
});

// 바둑판 배열 모드 토글 함수
function toggleTileMode(isTile) {
    const tileSettings = document.getElementById('tile-settings');
    if (tileSettings) {
        tileSettings.style.display = isTile ? 'block' : 'none';
        tileSettings.style.animation = isTile ? 'fadeInUp 0.3s ease' : '';
    }
}

// 사용자 이름 자동 세팅 기능
function initPdfToolSettings() {
    const user = AppStore.getCurrentUser();
    const nameInput = document.getElementById('pdf-watermark-text');
    if (user && user.displayName && nameInput) {
        nameInput.value = `${user.displayName} 010-xxxx-xxxx`;
    }
}



function initDashboardSortable() {
    const el = document.querySelector('.vertical-menu');
    if (!el || typeof Sortable === 'undefined') return;

    // Load saved order
    const savedOrder = localStorage.getItem('dashboardOrder');
    if (savedOrder) {
        try {
            const orderArr = JSON.parse(savedOrder);
            const btnMap = {};
            Array.from(el.children).forEach(child => {
                const match = child.getAttribute('onclick')?.match(/switchTab\('([^']+)'/);
                if (match) {
                    btnMap[match[1]] = child;
                }
            });
            
            // Re-append in saved order
            orderArr.forEach(tabId => {
                if (btnMap[tabId]) {
                    el.appendChild(btnMap[tabId]);
                }
            });
        } catch(e) {
            console.error('Failed to parse dashboard order', e);
        }
    }

    Sortable.create(el, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        delay: 100, // 모바일에서 스크롤과 충돌 방지를 위해 약간의 딜레이
        delayOnTouchOnly: true,
        onEnd: function () {
            // Save new order
            const newOrder = [];
            Array.from(el.children).forEach(child => {
                const match = child.getAttribute('onclick')?.match(/switchTab\('([^']+)'/);
                if (match) newOrder.push(match[1]);
            });
            localStorage.setItem('dashboardOrder', JSON.stringify(newOrder));
        }
    });
}
