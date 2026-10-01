// config.js
// ----------------------------------------------------
// 전역 변수 (Global Variables)
// ----------------------------------------------------
const APP_VERSION = 'v114';
const ADMIN_UIDS = ["jaGugunGReXytCgbqYwQUybxyJL2", "hiPMcfj1OvWuq6PjedfPFvOLxlp2"]; 
const ADMIN_EMAILS = ["contact@faww.co.kr"];
const ALLOWED_GOOGLE_SYNC_EMAIL = 'contact@faww.co.kr';


/**
 * 앱 강제 업데이트 & PWA 서비스 워커 캐시 초기화 및 강력 새로고침
 */
async function forceAppUpdate() {
    if (typeof showToast === 'function') {
        showToast('업데이트를 완료했습니다', 'info');
    }
    
    try {
        // 1. 브라우저의 Cache Storage 전체 삭제
        if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
            console.log('✅ Service Worker caches cleared.');
        }

        // 2. 서비스 워커 업데이트 시도
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (let registration of registrations) {
                await registration.update();
            }
        }
    } catch (e) {
        console.warn('Cache clear error:', e);
    }

    // 3. 페이지 새로고침
    setTimeout(() => {
        window.location.reload();
    }, 400);
} 

const AppStore = {
    state: {
        currentUserProfile: null,
        tasks: {},
        trips: {},
        leaves: {},
        users: {},
        notices: {},
        dailyTasks: {},
        dailyLogs: {},
        notifications: {},
        externalEvents: {},
        meetingFeeds: {},
        tripVehicles: {},
        viewMode: 'status'
    },
    getCurrentUser: function() { return this.state.currentUserProfile; },
    setCurrentUser: function(profile) { this.state.currentUserProfile = profile; },
    getTasks: function() { return this.state.tasks; },
    getTripVehicles: function() { return this.state.tripVehicles; },
    setTripVehicles: function(vehicles) { this.state.tripVehicles = vehicles; },
    setTasks: function(newData) {
        this.state.tasks = newData;
        setTimeout(() => {
            try { if(typeof renderTasks === 'function') renderTasks(); } catch(e){}
            try { if(typeof renderMyPage === 'function') renderMyPage(); } catch(e){}
            try {
                const calTab = document.getElementById('tab-calendar');
                if (calTab && calTab.style.display !== 'none' && typeof renderTabCalendar === 'function') renderTabCalendar();
            } catch(e){}
        }, 0);
    },
    mergeTasks: function(newData, status) {
        Object.keys(this.state.tasks).forEach(key => {
            if (this.state.tasks[key].status === status) {
                delete this.state.tasks[key];
            }
        });
        Object.assign(this.state.tasks, newData);
        setTimeout(() => {
            try { if(typeof renderTasks === 'function') renderTasks(); } catch(e){}
            try { if(typeof renderMyPage === 'function') renderMyPage(); } catch(e){}
            try {
                const calTab = document.getElementById('tab-calendar');
                if (calTab && calTab.style.display !== 'none' && typeof renderTabCalendar === 'function') renderTabCalendar();
            } catch(e){}
        }, 0);
    },
    getTrips: function() { return this.state.trips; },
    setTrips: function(newData) {
        if (newData) {
            Object.values(newData).forEach(trip => {
                if (trip.assignee && trip.assignee.toLowerCase() === 'sungjin j') {
                    trip.assignee = '장성진';
                }
            });
        }
        this.state.trips = newData;
        setTimeout(() => {
            try { if(typeof renderTasks === 'function') renderTasks(); } catch(e){}
            try { if(typeof renderMyPage === 'function') renderMyPage(); } catch(e){}
            try { if(typeof renderTripList === 'function') renderTripList(); } catch(e){}
            try {
                const calTab = document.getElementById('tab-calendar');
                if (calTab && calTab.style.display !== 'none' && typeof renderTabCalendar === 'function') renderTabCalendar();
            } catch(e){}
        }, 0);
    },
    getLeaves: function() { return this.state.leaves; },
    setLeaves: function(newData) {
        this.state.leaves = newData;
        setTimeout(() => {
            try { if(typeof renderTasks === 'function') renderTasks(); } catch(e){}
            try { if(typeof renderLeaveUI === 'function') renderLeaveUI(); } catch(e){}
            try { if(typeof renderMyPage === 'function') renderMyPage(); } catch(e){}
            const user = firebase.auth().currentUser;
            try { if(user && (ADMIN_UIDS.includes(user.uid) || (user.email && ADMIN_EMAILS.includes(user.email))) && typeof renderAdminLeaves === 'function') renderAdminLeaves(); } catch(e){}
            try {
                const calTab = document.getElementById('tab-calendar');
                if (calTab && calTab.style.display !== 'none' && typeof renderTabCalendar === 'function') renderTabCalendar();
            } catch(e){}
        }, 0);
    },
    getUsers: function() { return this.state.users; },
    setUsers: function(newData) {
        if (newData) {
            Object.values(newData).forEach(u => {
                if (u && u.displayName && u.displayName.toLowerCase() === 'sungjin j') {
                    u.displayName = '장성진';
                }
                if (u && u.displayName && u.displayName.toLowerCase() === 'hong min') {
                    u.displayName = '민홍';
                }
            });
        }
        this.state.users = newData;
        if(typeof renderMembersDirectory === 'function') renderMembersDirectory();
        if(typeof renderChatList === 'function') renderChatList();
        if(typeof setupPrivateChatNotificationListeners === 'function') setupPrivateChatNotificationListeners();
        const user = firebase.auth().currentUser;
        if(user && (ADMIN_UIDS.includes(user.uid) || (user.email && ADMIN_EMAILS.includes(user.email))) && typeof renderAdminLeaves === 'function') renderAdminLeaves();
    },
    getNotices: function() { return this.state.notices; },
    setNotices: function(newData) {
        this.state.notices = newData;
        if(typeof renderNotices === 'function') renderNotices();
    },
    getMeetingFeeds: function() { return this.state.meetingFeeds || {}; },
    setMeetingFeeds: function(newData) {
        this.state.meetingFeeds = newData;
        setTimeout(() => {
            try { if (typeof renderMeetingFeedUI === 'function') renderMeetingFeedUI(); } catch(e){}
        }, 0);
    },
    getViewMode: function() { return this.state.viewMode; },
    setViewMode: function(mode) {
        this.state.viewMode = mode;
        if(typeof renderTasks === 'function') renderTasks();
    },
    getDailyTasks: function() { return this.state.dailyTasks; },
    setDailyTasks: function(newData) {
        this.state.dailyTasks = newData;
        if(typeof renderDailyTasks === 'function') renderDailyTasks();
    },
    getDailyLogs: function() { return this.state.dailyLogs; },
    setDailyLogs: function(newData) {
        this.state.dailyLogs = newData;
        if(typeof renderDailyTasks === 'function') renderDailyTasks();
    },
    getNotifications: function() { return this.state.notifications; },
    setNotifications: function(newData) {
        this.state.notifications = newData;
        if(typeof renderNotifications === 'function') renderNotifications();
    },
    getExternalEvents: function() { return this.state.externalEvents; },
    setExternalEvents: function(newData) {
        if (newData) {
            Object.values(newData).forEach(event => {
                if (event.assignee && event.assignee.toLowerCase() === 'min suk kim') {
                    event.assignee = '대장 👑';
                } else if (event.assignee && event.assignee.toLowerCase() === 'sungjin j') {
                    event.assignee = '장성진';
                }
                if (event.creator && event.creator.toLowerCase() === 'min suk kim') {
                    event.creator = '대장 👑';
                } else if (event.creator && event.creator.toLowerCase() === 'sungjin j') {
                    event.creator = '장성진';
                }
            });
        }
        this.state.externalEvents = newData;
        setTimeout(() => {
            try { if(typeof renderTasks === 'function') renderTasks(); } catch(e){}
            try { if(typeof renderMyPage === 'function') renderMyPage(); } catch(e){}
            try {
                const calTab = document.getElementById('tab-calendar');
                if(calTab && calTab.style.display !== 'none' && typeof renderTabCalendar === 'function') renderTabCalendar();
            } catch(e){}
        }, 0);
    }
};

let currentDateForCalendar = new Date();
let currentDateForGantt = new Date();
let currentDateForModalCalendar = new Date();
let currentDateForMyPageCalendar = new Date();

// ----------------------------------------------------
// 유틸리티 (Utilities)
// ----------------------------------------------------
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);
const checkAuth = async (msg = '승인된 사용자만 이용할 수 있습니다.') => {
    const profile = AppStore.getCurrentUser();
    if (!profile || !profile.approved) { await customAlert(msg); return false; }
    return true;
};
const getTodayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 범용 출장 날짜 범위 파싱 유틸리티 (다양한 구분자 및 형식 지원)
const parseTripDateRange = (dateStr) => {
    if (!dateStr) return { startDate: '', endDate: '', isRange: false, displayDate: '미정' };
    const str = String(dateStr).trim();
    // ' to ', '~', ' ~ ', ' - ', ',' 등 다양한 구분자 지원 (예: "2026-07-20 to 2026-07-25", "2026-07-20 ~ 2026-07-25")
    const parts = str.split(/\s*(?:to|~|,|\s-\s)\s*/i).map(s => {
        return s.replace(/\./g, '-').replace(/\//g, '-').replace(/\s+/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').replace(/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (_, y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }).filter(Boolean);

    let startDate = parts[0] || '';
    let endDate = (parts.length > 1 && parts[1]) ? parts[1] : startDate;
    let isRange = parts.length > 1 && startDate !== endDate;
    let displayDate = isRange ? `${startDate} ~ ${endDate}` : startDate;

    return { startDate, endDate, isRange, displayDate };
};

// ----------------------------------------------------
// Firebase 설정
// ----------------------------------------------------
// 주의: GitHub Pages(ryu303.github.io) 호스팅 환경은 /__/auth/* 경로를 처리할 수 없으므로,
// authDomain은 반드시 원래의 firebaseapp.com 도메인으로 고정해야 합니다.
const firebaseConfig = {
    apiKey: window.ENV ? window.ENV.FIREBASE_API_KEY : "",
    authDomain: "coworking-tool.firebaseapp.com",
    projectId: "coworking-tool",
    storageBucket: "coworking-tool.firebasestorage.app",
    messagingSenderId: "614190014572",
    appId: "1:614190014572:web:ef61d476457cdc1ef27849",
    measurementId: "G-B4RSYQ38P8"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();
const db = firebase.database();
const storage = firebase.storage();
const functions = firebase.app().functions('asia-northeast3');

// ----------------------------------------------------
// 다크 모드 & 테마 & 달력 설정
// ----------------------------------------------------
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.getElementById('theme-toggle').innerHTML = savedTheme === 'dark' ? '<span class="material-symbols-rounded">light_mode</span>' : '<span class="material-symbols-rounded">dark_mode</span>';
    const flatpickrTheme = document.getElementById('flatpickr-theme');
    if (savedTheme === 'dark' && flatpickrTheme) {
        flatpickrTheme.href = "https://cdn.jsdelivr.net/npm/flatpickr/dist/themes/dark.css";
    }
}

function applyTheme(newTheme) {
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    const toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) toggleBtn.innerHTML = newTheme === 'dark' ? '<span class="material-symbols-rounded">light_mode</span>' : '<span class="material-symbols-rounded">dark_mode</span>';
    const flatpickrTheme = document.getElementById('flatpickr-theme');
    if (flatpickrTheme) {
        flatpickrTheme.href = newTheme === 'dark' ? "https://cdn.jsdelivr.net/npm/flatpickr/dist/themes/dark.css" : "https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css";
    }
}

function toggleTheme(event) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    
    // View Transitions API 지원 여부 확인
    if (!document.startViewTransition) {
        applyTheme(newTheme);
        return;
    }

    // 클릭한 마우스 좌표 (이펙트 시작점)
    const x = event?.clientX ?? window.innerWidth / 2;
    const y = event?.clientY ?? window.innerHeight / 2;
    // 가장 먼 모서리까지의 거리 계산
    const endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
    );

    const transition = document.startViewTransition(() => {
        applyTheme(newTheme);
    });

    transition.ready.then(() => {
        const clipPath = [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`
        ];
        
        // 다크모드로 갈 때는 커지는 원, 라이트모드로 갈 때는 작아지는 원(새 배경이 드러남)
        document.documentElement.animate(
            {
                clipPath: isDark ? [...clipPath].reverse() : clipPath,
            },
            {
                duration: 500,
                easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
                pseudoElement: isDark ? '::view-transition-old(root)' : '::view-transition-new(root)'
            }
        );
    });
}

initTheme();

const fpConfig = {
    locale: "ko",
    dateFormat: "Y-m-d",
    disableMobile: true,
    monthSelectorType: "static"
};
function initFlatpickr() {
    if (typeof flatpickr !== 'function') return;
    flatpickr("#modalStartDate", fpConfig);
    flatpickr("#modalDueDate", fpConfig);
    flatpickr("#tripDate", Object.assign({}, fpConfig, { mode: "range" }));
    flatpickr("#leaveStartDate", fpConfig);
    flatpickr("#leaveEndDate", fpConfig);
    flatpickr("#mapStartDate", fpConfig);
    flatpickr("#mapEndDate", fpConfig);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFlatpickr);
} else {
    initFlatpickr();
}


// ----------------------------------------------------
// 공통 알림 모달 & 토스트 알림
// ----------------------------------------------------
function customModalAction(type, message, defaultValue = '') {
    return new Promise((resolve) => {
        const modal = document.getElementById('alertModal');
        const msgEl = document.getElementById('alertMessage');
        const inputEl = document.getElementById('alertInput');
        const confirmBtn = document.getElementById('alertConfirmBtn');
        const cancelBtn = document.getElementById('alertCancelBtn');

        msgEl.textContent = message;
        modal.style.display = 'flex';

        if (type === 'prompt') {
            inputEl.style.display = 'block';
            inputEl.value = defaultValue;
            setTimeout(() => {
                inputEl.focus();
                try { inputEl.select(); } catch(e){}
            }, 10);
            inputEl.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    confirmBtn.click();
                }
            };
        } else {
            inputEl.style.display = 'none';
            inputEl.onkeydown = null;
        }

        cancelBtn.style.display = type === 'alert' ? 'none' : 'block';
        cancelBtn.style.flex = '1';

        confirmBtn.onclick = () => {
            modal.style.display = 'none';
            resolve(type === 'prompt' ? inputEl.value : true);
        };

        cancelBtn.onclick = () => {
            modal.style.display = 'none';
            resolve(type === 'prompt' ? null : false);
        };
    });
}
const customAlert = (msg) => customModalAction('alert', msg);
const customConfirm = (msg) => customModalAction('confirm', msg);
const customPrompt = (msg, def) => customModalAction('prompt', msg, def);

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'info';
    let iconColor = 'var(--primary)';
    if (type === 'warning') {
        icon = 'notifications_active';
        iconColor = '#F59E0B';
    }
    
    toast.innerHTML = `
        <span class="material-symbols-rounded" style="color: ${iconColor}; font-size: 1.8rem;">${icon}</span>
        <span style="font-size: 0.95rem; font-weight: 600; line-height: 1.5; white-space: pre-wrap;">${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        toast.addEventListener('animationend', () => toast.remove());
    }, 5000);
}

function switchTab(tabId, element, pushState = true) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.style.display = 'none');
    
    if (element) {
        element.classList.add('active');
    } else {
        // If element is not provided (e.g., from popstate), try to find it
        const btn = document.querySelector(`.tab-btn[onclick*="'${tabId}'"]`);
        if (btn) btn.classList.add('active');
    }
    
    document.getElementById(tabId).style.display = 'block';
    
    // 모바일 뒤로가기 지원을 위한 브라우저 히스토리 스택 추가
    if (pushState) {
        history.pushState({ tab: tabId }, "", "#" + tabId);
    }
    
    // 탭 전환 시 화면을 강제로 최신화하여 즉각 반영 (F5 방지)
    if (tabId === 'tab-admin' && auth.currentUser && (ADMIN_UIDS.includes(auth.currentUser.uid) || (auth.currentUser.email && ADMIN_EMAILS.includes(auth.currentUser.email)))) {
        if (typeof renderAdminLeaves === 'function') renderAdminLeaves();
    } else if (tabId === 'tab-leaves') {
        if (typeof renderLeaveUI === 'function') renderLeaveUI();
    } else if (tabId === 'tab-calendar') {
        // [개선] 탭 전환 후 DOM이 안정화될 때까지 아주 잠시 기다린 후 렌더링 (순차 노출 문제 해결)
        setTimeout(() => {
            if (typeof renderTabCalendar === 'function') {
                renderTabCalendar();
            }
        }, 50);
    } else if (tabId === 'tab-tasks') {
        if (typeof renderTasks === 'function') renderTasks();
    } else if (tabId === 'tab-meeting-feed') {
        if (typeof renderMeetingFeedUI === 'function') renderMeetingFeedUI();
    } else if (tabId === 'tab-mypage') {
        if (typeof renderMyPage === 'function') renderMyPage();
    } else if (tabId === 'tab-docs') {
        if (typeof initPdfToolSettings === 'function') initPdfToolSettings();
        if (typeof loadProposalSettings === 'function') loadProposalSettings();
    }
}

// 모바일 뒤로가기(안드로이드/제스처) 이벤트 감지
window.addEventListener('popstate', function(event) {
    // 1. 열려있는 모달창이나 오버레이가 있다면 탭 전환 대신 그것들을 먼저 닫음
    const openModals = document.querySelectorAll('.modal-overlay[style*="display: flex"], .modal-overlay[style*="display: block"], .chat-window[style*="display: flex"], .chat-window[style*="display: block"]');
    if (openModals.length > 0) {
        openModals.forEach(modal => {
            modal.style.display = 'none';
        });
        // 탭 상태는 현재 상태 유지
        const activeTab = document.querySelector('.tab-content[style*="display: block"]');
        if (activeTab) {
            history.pushState({ tab: activeTab.id }, "", "#" + activeTab.id);
        }
        return;
    }

    // 2. 모달이 없으면 이전 탭으로 이동
    if (event.state && event.state.tab) {
        switchTab(event.state.tab, null, false);
    } else {
        // 히스토리가 없으면 기본 탭(업무 현황)으로
        const hashTab = window.location.hash ? window.location.hash.substring(1) : 'tab-tasks';
        switchTab(hashTab, null, false);
    }
});

// 카카오내비 전송을 위한 SDK 초기화
if (typeof Kakao !== 'undefined' && !Kakao.isInitialized()) {
    Kakao.init('49567b3deb7ec9afb54384571d730980'); // 카카오 앱 키
}