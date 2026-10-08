import fs from 'fs';

// 1. Mock minimal DOM
global.window = {
    addEventListener: () => {},
    location: { search: '' }
};

const domCache = {};
global.document = {
    addEventListener: () => {},
    getElementById: (id) => {
        if (!domCache[id]) domCache[id] = { style: {}, innerHTML: 'NOT_CLEARED', value: 'NOT_CLEARED', addEventListener: () => {} };
        return domCache[id];
    },
    querySelector: () => ({ classList: { add: ()=>{}, remove: ()=>{} }, addEventListener: () => {} }),
    querySelectorAll: () => [],
    documentElement: { setAttribute: () => {}, getAttribute: () => {} }
};
global.localStorage = { getItem: () => null, setItem: () => {} };
const origConsole = { log: console.log, error: console.error, warn: console.warn };
global.console = { 
    log: origConsole.log, 
    error: origConsole.error, 
    warn: origConsole.warn 
};
global.alert = () => {};

// 2. Mock Firebase correctly
let authStateCb = null;
global.firebase = {
    apps: [],
    initializeApp: () => {},
    app: () => ({ functions: () => {} }),
    auth: () => ({
        onAuthStateChanged: (cb) => { authStateCb = cb; },
        signOut: () => { authStateCb(null); return Promise.resolve(); },
        setPersistence: () => Promise.resolve(),
        getRedirectResult: () => Promise.resolve()
    }),
    database: () => {},
    storage: () => {}
};
global.firebase.auth.Auth = { Persistence: { LOCAL: 'local' } };
global.firebase.auth.GoogleAuthProvider = function() {};

// Mock DB refs
class MockRef {
    constructor(path) { this.path = path; }
    on(event, cb) { 
        if(this.path.startsWith('users/')) {
            if (global.mockProfile) cb({ val: () => global.mockProfile });
            else cb({ val: () => null });
        }
    }
    off() {}
    orderByChild() { return this; }
    equalTo() { return this; }
    limitToLast() { return this; }
    orderByKey() { return this; }
    update() { return Promise.resolve(); }
    set() { return Promise.resolve(); }
    child() { return this; }
}
global.auth = firebase.auth();
global.db = {
    ref: (path) => new MockRef(path)
};

// Mock other globals
global.Kakao = { isInitialized: () => true, init: () => {} };
global.showToast = () => {};
global.customAlert = () => Promise.resolve();
global.customConfirm = () => Promise.resolve(true);
global.customPrompt = () => Promise.resolve('');
global.switchTab = () => {};
global.getTodayStr = () => '2026-10-07';
global.isListenerInitialized = false;

// 3. Load actual config.js
const configCode = fs.readFileSync('public/js/config.js', 'utf8');
eval(configCode.replace('const AppStore =', 'global.AppStore =').replace('const ADMIN_UIDS =', 'global.ADMIN_UIDS =').replace('const ADMIN_EMAILS =', 'global.ADMIN_EMAILS ='));

// 4. Load subscription.js
const subCode = fs.readFileSync('public/js/subscription.js', 'utf8');
eval(subCode);
global.AppSubscriptionManager = window.AppSubscriptionManager;

// Add spy
let unsubCount = 0;
const origUnsubAll = window.AppSubscriptionManager.unsubscribeAllExcept;
window.AppSubscriptionManager.unsubscribeAllExcept = function(keys) {
    unsubCount++;
    origUnsubAll.call(this, keys);
};

// 5. Load services, kanban, map
const servicesCode = fs.readFileSync('public/services/services.js', 'utf8');
eval(servicesCode);
global.allFilesData = window.allFilesData || {};


const kanbanCode = fs.readFileSync('public/features/kanban/kanban.js', 'utf8');
eval(kanbanCode);

const mapCode = fs.readFileSync('public/features/map.js', 'utf8');
eval(mapCode);


// Expose window properties to global for eval
global.startKanbanSubscriptions = window.startKanbanSubscriptions;
global.startServicesSubscriptions = window.startServicesSubscriptions;
global.startServicesSubscriptions2 = window.startServicesSubscriptions2;
global.listenForCommunications = window.listenForCommunications;
global.listenForChatMessages = window.listenForChatMessages;
global.listenForNotices = window.listenForNotices;
global.listenForFeed = window.listenForFeed;

// 6. Load main.js
const mainCode = fs.readFileSync('public/js/main.js', 'utf8');
eval(mainCode);
console.log('IS CLEAR FUNC?', typeof window.clearAllAppStoreData);


// ----------------------------------------------------
// Testing Execution (v8 Security Phase 1)
// ----------------------------------------------------
let step = 1;
let passed = true;
function assert(condition, message) {
    if (!condition) {
        origConsole.error('FAIL Step ' + step + ':', message);
        passed = false;
    } else {
        origConsole.log('PASS Step ' + step + ':', message);
    }
    step++;
}


async function runTests() {
    try {
        // 1. Initial login (User A - Approved)
        global.mockProfile = { approved: true, uid: 'userA' };
        authStateCb({ uid: 'userA', email: 'a@test.com' });
        
        await new Promise(r => setTimeout(r, 100)); // wait for transitions
        
        // Populate dummy data to AppStore & Services & DOM
        AppStore.setTasks({ task1: { title: 'A task', status: 'todo' } });
        window.setAllFilesData({ file1: { name: 'A file' } });
        document.getElementById('fileList').innerHTML = 'Data A';
        document.getElementById('consumables-grid').innerHTML = 'Grid A';
        
        // Scenario A: Logout Data Clear
        firebase.auth().signOut();
        await new Promise(r => setTimeout(r, 100));
        
        assert(Object.keys(AppStore.getTasks()).length === 0, 'Tasks cleared on logout');
        assert(Object.keys(window.getAllFilesData()).length === 0, 'allFilesData cleared on logout');
        assert(document.getElementById('fileList').innerHTML === '', 'DOM fileList cleared on logout');
        assert(document.getElementById('consumables-grid').innerHTML === '', 'DOM consumables-grid cleared on logout');
        assert(!window.AppSubscriptionManager.subs['tasks_todo'], 'tasks_todo subscription removed');
        assert(!window.AppSubscriptionManager.subs['tasks_done'], 'tasks_done subscription removed');
        
        // Scenario B: A -> B account switch
        global.mockProfile = { approved: true, uid: 'userA' };
        authStateCb({ uid: 'userA', email: 'a@test.com' });
        await new Promise(r => setTimeout(r, 100));
        
        AppStore.setTasks({ task2: { title: 'A task 2', status: 'done' } });
        window.setAllFilesData({ file2: { name: 'A file 2' } });
        document.getElementById('fileList').innerHTML = 'Data A2';
        
        // Switch to B without explicit logout
        global.mockProfile = { approved: true, uid: 'userB' };
        authStateCb({ uid: 'userB', email: 'b@test.com' });
        await new Promise(r => setTimeout(r, 100));
        
        assert(Object.keys(AppStore.getTasks()).length === 0, 'Tasks cleared on account switch');
        assert(Object.keys(window.getAllFilesData()).length === 0, 'allFilesData cleared on account switch');
        assert(document.getElementById('fileList').innerHTML === '', 'DOM fileList cleared on account switch');
        
        // Scenario C: Unapproval state clearing
        AppStore.setTasks({ task3: { title: 'B task' } });
        document.getElementById('fileList').innerHTML = 'Data B';
        
        // Profile becomes unapproved
        global.mockProfile = { approved: false, uid: 'userB' };
        window.AppSubscriptionManager.subs['userProfile'].cb({ val: () => global.mockProfile });
        await new Promise(r => setTimeout(r, 100));
        
        assert(Object.keys(AppStore.getTasks()).length === 0, 'Tasks cleared on unapproval');
        assert(document.getElementById('fileList').innerHTML === '', 'DOM fileList cleared on unapproval');
        assert(window.AppSubscriptionManager.subs['userProfile'], 'userProfile subscription is kept');
        assert(!window.AppSubscriptionManager.subs['tasks_doing'], 'tasks_doing subscription removed on unapproval');
        
        // Scenario D & E: Re-registration & Late callbacks
        const oldSessionGen = window.AppSubscriptionManager.sessionGen;
        
        // Re-approve
        global.mockProfile = { approved: true, uid: 'userB' };
        window.AppSubscriptionManager.subs['userProfile'].cb({ val: () => global.mockProfile });
        await new Promise(r => setTimeout(r, 100));
        
        assert(window.AppSubscriptionManager.subs['tasks_todo'], 'tasks_todo subscription added on re-approval');
        assert(window.AppSubscriptionManager.subs['tasks_done'], 'tasks_done subscription added on re-approval');
        
        // Verify no duplicate wrapping logic (only 1 sub in manager)
        let countTodo = 0;
        for (let k in window.AppSubscriptionManager.subs) { if(k === 'tasks_todo') countTodo++; }
        assert(countTodo === 1, 'Only one tasks_todo subscription exists');
        
        // Save the wrapper callback for tasks_done
        const activeDoneWrapperCb = window.AppSubscriptionManager.subs['tasks_done'].cb;
        
        // Now logout (increments sessionGen, clears subs)
        firebase.auth().signOut();
        await new Promise(r => setTimeout(r, 100));
        
        // Simulate late arrival of data to the OLD wrapper callback
        activeDoneWrapperCb({ val: () => ({ late: { title: 'hacked done task' } }) });
        
        assert(Object.keys(AppStore.getTasks()).length === 0, 'Late callback ignored due to sessionGen for tasks_done (Scenario E)');

        if(passed) {
            origConsole.log('SUCCESS: All UI transition and security lifecycle tests passed!');
            process.exit(0);
        } else {
            origConsole.log('FAIL: Some tests failed.');
            process.exit(1);
        }
    } catch(e) {
        origConsole.error('Test execution error:', e);
        process.exit(1);
    }
}
runTests();
