import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;
    let filePath;
    if (pathname === '/index.html' || pathname === '/') {
        filePath = path.join(__dirname, '../../../index.html');
    } else {
        filePath = path.join(__dirname, '../../../public', pathname);
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        const mimes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
        res.writeHead(200, { 'Content-Type': mimes[ext] || 'text/plain' });
        res.end(fs.readFileSync(filePath));
    } else {
        res.writeHead(404);
        res.end('Not Found: ' + pathname);
    }
});

server.listen(0, '127.0.0.1', async () => {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`Server running at ${baseUrl}/index.html`);

    let browser;
    try {
        const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        browser = await chromium.launch({ executablePath: chromePath, headless: true });
        const context = await browser.newContext({ serviceWorkers: 'block' });

        const page2 = await context.newPage();
        let page2ErrorCount = 0;
        page2.on('pageerror', error => {
            console.error('Page Error during UI Test:', error.message);
            page2ErrorCount++;
            process.exitCode = 1;
        });
        
        page2.on('console', msg => {
            console.log('BROWSER CONSOLE:', msg.text());
        });

        let earlyCallbackExecuted = false;
        let updateRequests = [];

        await page2.route('**/*', async (route) => {
            const requestUrl = route.request().url();
            const reqOrigin = new URL(requestUrl).origin;
            if (reqOrigin === baseUrl) {
                if (requestUrl.includes('/services/services.js')) {
                    const fired = await page2.evaluate(async () => {
                        let attempts = 0;
                        while (!window._mockDbTasksCallback && attempts < 50) {
                            await new Promise(r => setTimeout(r, 50));
                            attempts++;
                        }
                        if (window._mockDbTasksCallback) {
                            try {
                                window._mockDbTasksCallback({
                                    val: () => ({
                                        'early1': { id: 'early1', type: 'task', title: 'Early Task' }
                                    })
                                });
                                return true;
                            } catch (e) {
                                return false;
                            }
                        }
                        return false;
                    });
                    if (fired) earlyCallbackExecuted = true;
                    route.continue();
                } else {
                    route.continue();
                }
            } else {
                route.abort(); // Block external
            }
        });

        await page2.exposeFunction('mockUpdateRecord', (path, data) => {
            updateRequests.push({ path, data });
        });

        await page2.addInitScript(() => {
            window._mockDbLeavesCallback = null;
            window._mockDbTasksCallback = null;
            
            const authObj = {
                currentUser: null,
                onAuthStateChanged: () => {},
                signInWithPopup: async () => {},
                signOut: async () => {},
                setPersistence: async () => {},
                getRedirectResult: async () => ({})
            };
            
            window.firebase = {
                apps: [],
                app: () => ({ functions: () => ({ httpsCallable: () => async () => ({}) }) }),
                initializeApp: () => {},
                database: () => ({
                    ref: (path) => {
                        const refObj = {
                            orderByKey: function() { return this; },
                            limitToLast: function() { return this; },
                            equalTo: function() { return this; },
                            orderByChild: function() { return this; },
                            once: async () => ({ val: () => null, exists: () => false }),
                            push: () => ({ key: 'NEW_KEY', set: async () => {} }),
                            update: async (data) => {
                                window.mockUpdateRecord(path, data);
                            },
                            remove: async () => {},
                            set: async () => {},
                            on: (event, cb) => {
                                if (path === 'leaves' && event === 'value') {
                                    window._mockDbLeavesCallback = cb;
                                }
                                if (path === 'tasks' && event === 'value') {
                                    window._mockDbTasksCallback = cb;
                                }
                            },
                            off: () => {}
                        };
                        return refObj;
                    }
                }),
                auth: () => authObj,
                storage: () => ({ ref: () => ({ child: () => ({ getDownloadURL: async () => 'url', put: async () => ({ ref: { getDownloadURL: async () => 'url' } }) }) }) })
            };
            window.firebase.auth.GoogleAuthProvider = function() {};
            window.firebase.auth.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } };
            window.db = window.firebase.database();
            window.auth = window.firebase.auth();
            window.Kakao = { init: () => {}, isInitialized: () => true };
        });

        await page2.goto(`${baseUrl}/index.html`);
        await page2.waitForFunction(() => typeof window.renderMyPage === 'function');
        
        console.log('--- 1. Testing Unauthenticated State ---');
        await page2.evaluate(() => {
            window.firebase.auth().currentUser = null;
            switchTab('tab-mypage', document.querySelector('button[onclick*=\"tab-mypage\"]') || document.createElement('button'));
        });
        await page2.waitForSelector('#tab-mypage', { state: 'visible' });
        
        let loginMsgTasks = await page2.evaluate(() => document.getElementById('mypage-tasks').textContent);
        assert.ok(loginMsgTasks.includes('로그인 후 확인 가능합니다.'), 'Should show login message for tasks');

        console.log('--- 2. Testing Authenticated State ---');
        await page2.evaluate(() => {
            window.firebase.auth().currentUser = { uid: 'u1', email: 'test@faww.co.kr' };
            AppStore.setCurrentUser({ uid: 'u1', displayName: 'Mock User', leaveTotal: 15, department: 'ceo' });
            AppStore.setUsers({ 'u1': { uid: 'u1', displayName: 'Mock User', leaveTotal: 15, approved: true } });
        });
            
        // Set fixed date for testing
        const fixedDateStr = await page2.evaluate(() => {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`;
        });
        await page2.evaluate((todayStr) => {
            switchTab('tab-mypage', document.querySelector('button[onclick*=\"tab-mypage\"]') || document.createElement('button'));
            AppStore.setLeaves({
                'L1': { id: 'L1', uid: 'u1', userName: 'Mock User', date: todayStr, type: 1, status: 'approved' },
                'L2': { id: 'L2', uid: 'u1', userName: 'Mock User', date: todayStr, type: 1, status: 'pending' },
                'L3': { id: 'L3', uid: 'u2', userName: 'Other User', date: todayStr, type: 1, status: 'approved' }
            });
            AppStore.setTasks({
                'T1': { id: 'T1', type: 'task', title: 'Test Task', status: 'todo', assignee: 'Mock User', date: todayStr },
                'T3': { id: 'T3', type: 'task', title: 'Other Task', status: 'todo', assignee: 'Other User', date: todayStr }
            });
            AppStore.setTrips({
                'T2': { id: 'T2', type: 'trip', name: 'Test Trip', status: 'pending', assignee: 'Mock User', date: todayStr }
            });
            window.renderMyPage();
        }, fixedDateStr);

        let myTasks = await page2.evaluate(() => document.getElementById('mypage-tasks').innerHTML);
        let myTrips = await page2.evaluate(() => document.getElementById('mypage-trips').innerHTML);
        assert.ok(myTasks.includes('Test Task'), 'Should show my task');
        assert.ok(!myTasks.includes('Other Task'), 'Should not show other user task');
        assert.ok(myTrips.includes('Test Trip'), 'Should show my trip');

        let myLeaves = await page2.evaluate(() => document.getElementById('mypage-leaves-list').innerHTML);
        let leaveCount = await page2.evaluate(() => document.querySelectorAll('#mypage-leaves-list li').length);
        assert.ok(myLeaves.includes('1일'), 'Should show approved leave');
        assert.equal(leaveCount, 1, 'Should only show 1 approved leave for this user');

        console.log('--- 3. Testing Task Status Update ---');
        await page2.evaluate(() => {
            const btn = document.querySelector('#mypage-tasks button');
            if (btn) btn.click();
        });
        
        // Wait for updateRequests to populate
        await page2.waitForTimeout(100);
        assert.equal(updateRequests.length, 1, 'Should send exactly 1 update request');
        assert.equal(updateRequests[0].path, 'tasks/T1', 'Path should be tasks/T1');
        assert.equal(updateRequests[0].data.status, 'doing', 'Status should change to doing');

        console.log('--- 4. Testing Calendar Rendering and Modal ---');
        await page2.evaluate(() => {
            const originalBuild = window.buildCalendarGrid;
            window.buildCalendarGrid = function(gridId, titleId, dateObj, isMyPage, renderCallback) {
                console.log('Intercepted buildCalendarGrid:', gridId, 'dateObj:', dateObj);
                originalBuild(gridId, titleId, dateObj, isMyPage, function(cell, dateString, isCurrentMonth) {
                    if (isCurrentMonth) console.log('Callback date:', dateString);
                    renderCallback(cell, dateString, isCurrentMonth);
                });
            };
        });
        let leavesFilteredCount = await page2.evaluate(() => {
            return Object.values(AppStore.getLeaves()).filter(l => l.uid === auth.currentUser.uid && l.status === 'approved').length;
        });
        console.log('Filtered leaves count:', leavesFilteredCount);
        let calContent = await page2.evaluate(() => {
            window.renderMyPage();
            return document.getElementById('mypage-calendar-grid').innerHTML;
        });
        console.log("Task count after explicit render:", calContent.split('calendar-task').length - 1);
        assert.ok(calContent.length > 0, 'Calendar should render something');
        
        // Click leave item in calendar using Playwright locator
        const calendarTaskLocator = page2.locator('.calendar-task');
        await calendarTaskLocator.first().click();
        
        const modalDisplay = await page2.evaluate(() => document.getElementById('leaveDetailModal').style.display);
        assert.equal(modalDisplay, 'flex', 'Leave detail modal should open from calendar click');
        
        await page2.evaluate(() => closeLeaveDetailModal());

        console.log('--- 5. Testing Month Navigation ---');
        let initialMonthYear = await page2.evaluate(() => document.getElementById('mypage-calendar-month-year').textContent);
        const d = new Date();
        const expectedInitial = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
        assert.equal(initialMonthYear, expectedInitial, 'Should show initial month');
        
        await page2.locator('button[onclick="changeMyPageMonth(1)"]').click();
        let nextMonthYear = await page2.evaluate(() => document.getElementById('mypage-calendar-month-year').textContent);
        d.setMonth(d.getMonth() + 1);
        const expectedNext = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
        assert.equal(nextMonthYear, expectedNext, 'Should show next month');

        console.log('--- 6. Testing No Duplicates After Re-render ---');
        await page2.evaluate(() => window.renderMyPage());
        let leaveCount2 = await page2.evaluate(() => document.querySelectorAll('#mypage-leaves-list li').length);
        assert.equal(leaveCount2, 1, 'Should still show 1 approved leave after re-render');
        
        let taskCount2 = await page2.evaluate(() => document.querySelectorAll('#mypage-tasks li').length);
        assert.equal(taskCount2, 1, 'Should still show 1 task after re-render');

        console.log('--- Test Summary ---');
        console.log(`Page2 Errors: ${page2ErrorCount}`);
        
    } catch (e) {
        console.error('Test execution error:', e.message);
        process.exitCode = 1;
    } finally {
        if (browser) await browser.close();
        server.close();
    }
});
