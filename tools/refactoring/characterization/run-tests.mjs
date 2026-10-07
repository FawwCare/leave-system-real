import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;
    
    let filePath;
    if (pathname === '/index.html' || pathname === '/') {
        filePath = path.join(__dirname, '../../../index.html');
    } else if (pathname === '/test.html') {
        filePath = path.join(__dirname, 'test.html');
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

// Bind exclusively to 127.0.0.1
server.listen(0, '127.0.0.1', async () => {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const url = `${baseUrl}/test.html`;
    console.log(`Server running at ${url}`);

    let browser;
    try {
        const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        browser = await chromium.launch({
            executablePath: chromePath,
            headless: true
        });

        // serviceWorkers: 'block'
        const context = await browser.newContext({
            serviceWorkers: 'block'
        });
        let blockedCount = 0;

        await context.route('**/*', (route) => {
            const requestUrl = route.request().url();
            const reqOrigin = new URL(requestUrl).origin;
            // Use exact origin match
            if (reqOrigin !== baseUrl) {
                console.log(`[Blocked] External request: ${requestUrl}`);
                blockedCount++;
                route.abort('failed');
            } else {
                route.continue();
            }
        });

        let page1ErrorCount = 0;
        const page = await context.newPage();
        page.on('pageerror', error => {
            console.error('Page1 Error:', error.message);
            page1ErrorCount++;
            process.exitCode = 1;
        });
        await page.goto(url);

        const initialText = await page.locator('#test-msg').innerText();
        assert.equal(initialText, 'Init', 'Initial text should be Init');
        
        await page.click('#test-btn');
        const afterText = await page.locator('#test-msg').innerText();
        assert.equal(afterText, 'Clicked!', 'Text should change after click');

        await page.evaluate(() => doFetch());
        await page.waitForTimeout(500); 
        const fetchMsg = await page.locator('#fetch-msg').innerText();
        
        assert.ok(blockedCount > 0, 'Should have blocked external requests');
        assert.equal(fetchMsg, 'Fetch failed', 'Fetch should fail when blocked');

        const utilsPath = path.join(__dirname, '../../../public/services/privateChatUtils.js');
        const utilsCode = fs.readFileSync(utilsPath, 'utf8');

        const sandbox = {};
        vm.runInNewContext(utilsCode, sandbox);
        const getPrivateChatIdNode = sandbox.getPrivateChatId;

        const uidA = 'apple';
        const uidB = 'banana';
        
        const idForward = getPrivateChatIdNode(uidA, uidB);
        const idBackward = getPrivateChatIdNode(uidB, uidA);
        
        assert.equal(idForward, idBackward, 'Forward and backward results should be identical');
        
        if (process.env.TEST_INTENTIONAL_FAIL) {
            assert.fail('Intentional failure injected');
        }
        assert.equal(idForward, 'apple_banana', 'Should match accurate result sorting and delimiter');

        const idSame = getPrivateChatIdNode(uidA, uidA);
        assert.equal(idSame, 'apple_apple', 'Same UID should return properly');

        const indexPath = path.join(__dirname, '../../../index.html');
        const indexHtml = fs.readFileSync(indexPath, 'utf8');
        const utilsIdx = indexHtml.indexOf('<script src="/services/privateChatUtils.js"></script>');
        const servicesIdx = indexHtml.indexOf('<script src="/services/services.js"></script>');
        
        assert.ok(utilsIdx !== -1, 'privateChatUtils.js must exist in index.html');
        assert.ok(servicesIdx !== -1, 'services.js must exist in index.html');
        assert.ok(utilsIdx < servicesIdx, 'privateChatUtils.js must load before services.js');

        const browserTypeOf = await page.evaluate(() => typeof window.getPrivateChatId);
        assert.equal(browserTypeOf, 'function', 'window.getPrivateChatId must be a function in browser');
        
        const browserResult = await page.evaluate(() => window.getPrivateChatId('apple', 'banana'));
        assert.equal(browserResult, 'apple_banana', 'window.getPrivateChatId in browser should return accurate result');

        // --- textUtils test ---
        console.log('\n--- Running textUtils characterization test ---');
        const textUtilsPath = path.join(__dirname, '../../../public/services/textUtils.js');
        const textUtilsCode = fs.readFileSync(textUtilsPath, 'utf8');

        // Node tests (without DOMParser)
        const textSandbox = { window: {} };
        vm.runInNewContext(textUtilsCode, textSandbox);
        
        const escapeNode = textSandbox.escapeHTML;
        assert.equal(escapeNode('hello'), 'hello');
        assert.equal(escapeNode(''), '');
        assert.equal(escapeNode(null), '');
        assert.equal(escapeNode('a & b < c > d \' e " f'), 'a &amp; b &lt; c &gt; d &#39; e &quot; f');

        const htmlNode = textSandbox.htmlToPlainText;
        assert.equal(htmlNode('hello'), 'hello');
        assert.equal(htmlNode(''), '');
        assert.equal(htmlNode('<a href="foo">bar</a>'), 'bar foo');
        assert.equal(htmlNode('a<br>b<p>c</p><div>d</div><li>e</li>'), 'a\nbc\nd\ne');
        assert.equal(htmlNode('&lt; &amp; &gt;'), '< & >');
        assert.equal(htmlNode('a\n\n\n\nb'), 'a\n\nb');

        // Check index.html script order for textUtils
        const textUtilsIdx = indexHtml.indexOf('<script src="/services/textUtils.js"></script>');
        assert.ok(textUtilsIdx !== -1, 'textUtils.js must exist in index.html');
        assert.ok(textUtilsIdx < servicesIdx, 'textUtils.js must load before services.js');

        // Browser tests (with DOMParser)
        const browserEscapeType = await page.evaluate(() => typeof window.escapeHTML);
        assert.equal(browserEscapeType, 'function', 'window.escapeHTML must be a function in browser');
        assert.equal(await page.evaluate(() => window.escapeHTML('a & b < c > d \' e " f')), 'a &amp; b &lt; c &gt; d &#39; e &quot; f');
        
        const browserHtmlType = await page.evaluate(() => typeof window.htmlToPlainText);
        assert.equal(browserHtmlType, 'function', 'window.htmlToPlainText must be a function in browser');
        assert.equal(await page.evaluate(() => window.htmlToPlainText('<a href="foo">bar</a>')), 'bar foo');
        assert.equal(await page.evaluate(() => window.htmlToPlainText('a<br>b<p>c</p><div>d</div><li>e</li>')), 'a\nbc\nd\ne');
        assert.equal(await page.evaluate(() => window.htmlToPlainText('&lt; &amp; &gt;')), '< & >');
        assert.equal(await page.evaluate(() => window.htmlToPlainText('a\n\n\n\nb')), 'a\n\nb');
        
        console.log('--- End of textUtils test ---\n');

        // --- leaveService test ---
        console.log('\n--- Running leaveService characterization test ---');
        const leavePath = path.join(__dirname, '../../../public/services/leaveService.js');
        const leaveCode = fs.readFileSync(leavePath, 'utf8');

        const leaveIdx = indexHtml.indexOf('<script src="/services/leaveService.js"></script>');
        assert.ok(leaveIdx !== -1, 'leaveService.js must exist in index.html');
        assert.ok(leaveIdx < servicesIdx, 'leaveService.js must load before services.js');

        let dbRequests = [];
        let toastMessages = [];
        
        const dummyElement = {
            checked: false, value: '', style: {}, textContent: '', innerHTML: '',
            appendChild: () => {}, onclick: null, display: ''
        };
        
        const sandboxLeave = {
            console,
            window: { parseTotalLeave: (u) => {
                if (!u) return 15;
                const isValid = v => v !== null && v !== undefined && typeof v !== 'boolean' && typeof v !== 'object' && !(typeof v === 'string' && v.trim() === '') && !isNaN(Number(v)) && isFinite(Number(v));
                if (isValid(u.leaveTotal)) return Number(u.leaveTotal);
                if (isValid(u.totalLeave)) return Number(u.totalLeave);
                return 15;
            } },
            document: {
                getElementById: (id) => dummyElement,
                querySelector: () => dummyElement,
                createElement: () => dummyElement
            },
            showToast: (msg) => toastMessages.push(msg),
            customConfirm: async () => true,
            customPrompt: async () => 'reason',
            customAlert: async (m) => { throw new Error('customAlert called: ' + m); },
            sendNotification: () => {},
            checkAuth: async () => true,
            ADMIN_UIDS: ['admin1'],
            auth: { currentUser: { uid: 'admin1', email: 'admin@admin.com' } },
            AppStore: {
                getCurrentUser: () => ({ uid: 'admin1', displayName: 'Admin', leaveTotal: 15 }),
                getLeaves: () => ({
                    'L1': { id: 'L1', status: 'pending', uid: 'user1', userName: 'User 1', date: '2023-10-01' },
                    'L2': { id: 'L2', status: 'approved', uid: 'user1', userName: 'User 1', date: '2023-10-02' },
                    'L3': { id: 'L3', status: 'cancel_requested', uid: 'user1', userName: 'User 1', date: '2023-10-03' },
                    'L4': { id: 'L4', status: 'cancel_requested', uid: 'user1', userName: 'User 1', date: '2023-10-04' }
                }),
                getUsers: () => ({
                    'user1': { approved: true, displayName: 'User 1', uid: 'user1', leaveTotal: 15 }
                }),
                setLeaves: (data) => dbRequests.push({ type: 'setLeaves', data }),
            },
            db: {
                ref: (path) => {
                    const r = {
                        remove: async () => dbRequests.push({ type: 'remove', path }),
                        update: async (data) => dbRequests.push({ type: 'update', path, data }),
                        push: () => ({ key: 'NEW_KEY', set: async (data) => dbRequests.push({ type: 'set', path, data }) }),
                        orderByKey: () => r,
                        limitToLast: (n) => { dbRequests.push({ type: 'limitToLast', count: n }); return r; },
                        on: (event, cb) => dbRequests.push({ type: 'on', event, cb })
                    };
                    return r;
                }
            }
        };

        vm.runInNewContext(leaveCode, sandboxLeave);

        const subReq = dbRequests.find(r => r.type === 'limitToLast');
        const onReq = dbRequests.find(r => r.type === 'on');
        assert.equal(subReq?.count, 300, 'Subscription should use limitToLast(300)');
        assert.equal(onReq?.event, 'value', 'Subscription should listen to "value"');
        
        dbRequests = []; 

        const elements = {
            'leaveIsRange': { checked: false, style: {} },
            'leaveStartDate': { value: '', style: {} },
            'leaveEndDate': { value: '', style: {} },
            'leaveType': { value: '', style: {} },
            'applyLeaveBtn': { disabled: false, textContent: '', style: {} },
            'leaveRangeTilde': { style: {} }
        };
        sandboxLeave.document.getElementById = (id) => elements[id] || dummyElement;
        sandboxLeave.customAlert = async (msg) => { throw new Error('customAlert: ' + msg); };

        elements['leaveIsRange'].checked = false;
        elements['leaveStartDate'].value = '2026-10-14';
        elements['leaveType'].value = '1';
        await sandboxLeave.applyLeave();
        
        assert.equal(dbRequests.length, 1);
        assert.equal(dbRequests[0].data.type, 1);
        assert.equal(dbRequests[0].data.subType, '1');
        
        dbRequests = [];
        elements['leaveIsRange'].checked = false;
        elements['leaveStartDate'].value = '2026-10-14';
        elements['leaveType'].value = '0.5am';
        await sandboxLeave.applyLeave();
        
        assert.equal(dbRequests[0].data.type, 0.5);
        assert.equal(dbRequests[0].data.subType, '0.5am');
        
        dbRequests = [];
        elements['leaveIsRange'].checked = false;
        elements['leaveStartDate'].value = '2026-10-14';
        elements['leaveType'].value = '0.5pm';
        await sandboxLeave.applyLeave();
        
        assert.equal(dbRequests[0].data.type, 0.5);
        assert.equal(dbRequests[0].data.subType, '0.5pm');
        
        dbRequests = [];
        elements['leaveIsRange'].checked = true;
        elements['leaveStartDate'].value = '2026-10-15';
        elements['leaveEndDate'].value = '2026-10-16';
        elements['leaveType'].value = '0.5am';
        await sandboxLeave.applyLeave();
        
        assert.equal(dbRequests.length, 2);
        assert.equal(dbRequests[0].data.type, 1);
        assert.equal(dbRequests[0].data.subType, '1');
        assert.equal(dbRequests[1].data.type, 1);
        assert.equal(dbRequests[1].data.subType, '1');

        dbRequests = [];
        elements['leaveIsRange'].checked = true;
        elements['leaveStartDate'].value = '2026-10-17'; // Saturday
        elements['leaveEndDate'].value = '2026-10-18'; // Sunday
        elements['leaveType'].value = '1';
        let alertThrown = false;
        try {
            await sandboxLeave.applyLeave();
        } catch(e) {
            alertThrown = true;
            assert.ok(e.message.includes('평일'), 'Should throw alert for weekend only');
        }
        assert.ok(alertThrown, 'Should block weekend only request');
        assert.equal(dbRequests.length, 0);

        dbRequests = [];
        elements['leaveIsRange'].checked = true;
        elements['leaveStartDate'].value = '2026-10-16'; // Friday
        elements['leaveEndDate'].value = '2026-10-15'; // Thursday
        elements['leaveType'].value = '1';
        let alertThrown2 = false;
        try {
            await sandboxLeave.applyLeave();
        } catch(e) {
            alertThrown2 = true;
            assert.ok(e.message.includes('늦을 수 없습니다'), 'Should throw alert for inverted dates');
        }
        assert.ok(alertThrown2, 'Should block inverted dates request');
        assert.equal(dbRequests.length, 0);

        dbRequests = [];

        await sandboxLeave.cancelLeave('L1');
        assert.equal(dbRequests[0].type, 'remove');
        assert.equal(dbRequests[0].path, 'leaves/L1');
        dbRequests = [];

        await sandboxLeave.cancelLeave('L2');
        assert.equal(dbRequests[0].type, 'update');
        assert.equal(dbRequests[0].path, 'leaves/L2');
        assert.equal(dbRequests[0].data.status, 'cancel_requested');
        dbRequests = [];

        await sandboxLeave.adminResolveLeave('L3', 'approved', 'cancel_requested');
        assert.equal(dbRequests[0].type, 'remove');
        assert.equal(dbRequests[0].path, 'leaves/L3');
        dbRequests = [];

        await sandboxLeave.adminResolveLeave('L4', 'rejected', 'cancel_requested');
        assert.equal(dbRequests[0].type, 'update');
        assert.equal(dbRequests[0].path, 'leaves/L4');
        assert.equal(dbRequests[0].data.status, 'approved');
        assert.equal(dbRequests[0].data.rejectReason, 'reason');
        
        console.log('--- End of leaveService test ---\n');

        // ==========================================
        // leaveService UI Tests in Browser
        // ==========================================
        console.log('\n--- Running leaveService Browser UI tests ---');
        const page2 = await browser.newPage({ serviceWorkers: 'block' });
        
        let page2ErrorCount = 0;
        page2.on('pageerror', error => {
            console.error('Page Error during UI Test:', error.message);
            page2ErrorCount++;
            process.exitCode = 1;
        });
        
        page2.on('console', msg => {
            if (msg.text().includes('Early callback') || msg.text().includes('Button not found')) {
                console.log('BROWSER CONSOLE:', msg.text());
            }
        });

        let earlyCallbackExecuted = false;

        await page2.route('**/*', async (route) => {
            const requestUrl = route.request().url();
            const reqOrigin = new URL(requestUrl).origin;
            if (reqOrigin === baseUrl) {
                if (requestUrl.includes('/services/services.js')) {
                    console.log('Intercepted services.js. Firing db callback to test early initialization...');
                    const fired = await page2.evaluate(async () => {
                        // Wait until leaveService.js executes and registers the callback
                        let attempts = 0;
                        while (!window._mockDbLeavesCallback && attempts < 50) {
                            await new Promise(r => setTimeout(r, 50));
                            attempts++;
                        }
                        console.log('Early callback check. Is callback defined?', !!window._mockDbLeavesCallback);
                        if (window._mockDbLeavesCallback) {
                            try {
                                window._mockDbLeavesCallback({
                                    val: () => ({
                                        'early1': { id: 'early1', status: 'pending', uid: 'user1', userName: 'Early Bird', date: '2023-12-01' }
                                    })
                                });
                                return true;
                            } catch (e) {
                                console.error('Early callback error:', e.message, e.stack);
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

        await page2.addInitScript(() => {
            window._mockDbLeavesCallback = null;
            
            const authObj = {
                currentUser: { uid: 'user1', email: 'user@test.com' },
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
                            once: async () => ({ val: () => null }),
                            push: () => ({ key: 'NEW_KEY', set: async () => {} }),
                            update: async () => {},
                            remove: async () => {},
                            set: async () => {},
                            on: (event, cb) => {
                                if (path === 'leaves' && event === 'value') {
                                    window._mockDbLeavesCallback = cb;
                                }
                            },
                            off: () => {}
                        };
                        return refObj;
                    }
                }),
                auth: () => authObj,
                storage: () => ({ 
                    ref: () => ({ 
                        child: () => ({ 
                            getDownloadURL: async () => 'url',
                            put: async () => ({ ref: { getDownloadURL: async () => 'url' } })
                        }) 
                    }) 
                })
            };
            window.firebase.auth.GoogleAuthProvider = function() {};
            window.firebase.auth.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } };
            window.db = window.firebase.database();
            window.auth = window.firebase.auth();
            window.Kakao = { init: () => {}, isInitialized: () => true };
        });

        await page2.goto(`http://127.0.0.1:${port}/index.html`);
        await page2.waitForFunction(() => typeof window.renderLeaveUI === 'function');
        
        assert.ok(earlyCallbackExecuted, 'The database callback should have been registered and executed before services.js load');

        // Setup initial user state
        await page2.evaluate(() => {
            AppStore.setCurrentUser({ uid: 'user1', displayName: 'Mock User', leaveTotal: 15, department: 'team1_member' });
            AppStore.setUsers({ 'user1': { uid: 'user1', displayName: 'Mock User', leaveTotal: 15, approved: true } });
        });

        // 1. Fire DB callback after all scripts loaded
        const todayStr = new Date().toISOString().slice(0, 10);
        await page2.evaluate((todayStr) => {
            window._mockDbLeavesCallback({
                val: () => ({
                    'L1': { id: 'L1', uid: 'user1', userName: 'Mock User', date: todayStr, type: 1, status: 'approved', timestamp: Date.now() },
                    'L2': { id: 'L2', uid: 'user1', userName: 'Mock User', date: todayStr, type: 0.5, status: 'pending', timestamp: Date.now() },
                    'L3': { id: 'L3', uid: 'user1', userName: 'Mock User', date: todayStr, type: 1, status: 'cancel_requested', timestamp: Date.now() }
                })
            });
        }, todayStr);

        // 2. Minimum validation: user sees remaining days
        let leaveUsed = await page2.evaluate(() => document.getElementById('leave-used').textContent);
        let leaveRemain = await page2.evaluate(() => document.getElementById('leave-remain').textContent);
        assert.equal(leaveUsed, '2.5', 'User should have 2.5 days used (approved 1 + pending 0.5 + cancel_requested 1)');
        assert.equal(leaveRemain, '12.5', 'User should have 12.5 days remaining');
        
        // Let's just verify list items
        let listItemsCount = await page2.evaluate(() => document.querySelectorAll('#leave-history-list li').length);
        assert.equal(listItemsCount, 3, 'List should contain 3 items');

        // 5. Admin validation checking cancel_requested state
        await page2.evaluate(() => {
            window.firebase.auth().currentUser.uid = "jaGugunGReXytCgbqYwQUybxyJL2";
            window.firebase.auth().currentUser.email = "contact@faww.co.kr";
            AppStore.setCurrentUser({ uid: 'jaGugunGReXytCgbqYwQUybxyJL2', displayName: 'Admin', leaveTotal: 15, department: 'ceo' });
            window.renderAdminLeaves();
        });
        
        let adminPendingText = await page2.evaluate(() => document.getElementById('admin-pending-leaves-list').textContent);
        assert.ok(adminPendingText.includes('취소 요청'), 'Admin pending list should contain cancel requested item');
        
        // Restore user state before next step
        await page2.evaluate(() => {
            window.firebase.auth().currentUser.uid = "user1";
            window.firebase.auth().currentUser.email = "user@test.com";
            AppStore.setCurrentUser({ uid: 'user1', displayName: 'Mock User', leaveTotal: 15, department: 'team1_member' });
            window.renderLeaveUI();
        });

        // 3. Second data reception should not duplicate and should update DOM
        await page2.evaluate((todayStr) => {
            window._mockDbLeavesCallback({
                val: () => ({
                    'L1': { id: 'L1', uid: 'user1', userName: 'Mock User', date: todayStr, type: 1, status: 'approved', timestamp: Date.now() },
                    'L2': { id: 'L2', uid: 'user1', userName: 'Mock User', date: todayStr, type: 1, status: 'pending', timestamp: Date.now() }
                })
            });
        }, todayStr);
        listItemsCount = await page2.evaluate(() => document.querySelectorAll('#leave-history-list li').length);
        assert.equal(listItemsCount, 2, 'List should update to 2 items without duplicating');

        
        // Test parseTotalLeave logic
        await page2.evaluate(() => {
            const pTL = window.parseTotalLeave;
            if (pTL({ leaveTotal: 0 }) !== 0) throw new Error('leaveTotal 0 should be 0');
            if (pTL({ leaveTotal: '0' }) !== 0) throw new Error("leaveTotal '0' should be 0");
            if (pTL({ leaveTotal: 0, totalLeave: 15 }) !== 0) throw new Error('leaveTotal 0 takes precedence over totalLeave 15');
            if (pTL({ totalLeave: 12 }) !== 12) throw new Error('totalLeave 12 should be 12');
            if (pTL({ totalLeave: '12' }) !== 12) throw new Error("totalLeave '12' should be 12");
            if (pTL({ leaveTotal: null, totalLeave: undefined }) !== 15) throw new Error('null/undefined should default to 15');
            if (pTL({ leaveTotal: '', totalLeave: '  ' }) !== 15) throw new Error('empty string should default to 15');
            if (pTL({ leaveTotal: NaN, totalLeave: Infinity }) !== 15) throw new Error('NaN/Infinity should default to 15');
            if (pTL({ leaveTotal: true, totalLeave: [10] }) !== 15) throw new Error('boolean/array should default to 15');
        });
        console.log("parseTotalLeave tests passed");

        // 6. Modal validation via direct function call (no DOM button rendered by leaveService)
        await page2.evaluate(() => {
            window.openLeaveDetailModal('L1');
        });
        const modalDisplay = await page2.evaluate(() => document.getElementById('leaveDetailModal').style.display);
        assert.equal(modalDisplay, 'flex', 'Leave detail modal should open');
        const modalBody = await page2.evaluate(() => document.getElementById('leaveDetailBody').textContent);
        assert.ok(modalBody.includes('Mock User') && modalBody.includes(todayStr), 'Modal should show correct leave info');

        // Close modal
        await page2.evaluate(() => closeLeaveDetailModal());
        
        // 7. Mobile size check (restore user first)
        await page2.evaluate(() => {
            window.firebase.auth().currentUser.uid = "user1";
            window.firebase.auth().currentUser.email = "user@test.com";
            AppStore.setCurrentUser({ uid: 'user1', displayName: 'Mock User', leaveTotal: 15, department: 'team1_member' });
        });
        await page2.setViewportSize({ width: 375, height: 812 });
        await page2.evaluate(() => window.renderLeaveUI());
        const mobileRemain = await page2.evaluate(() => document.getElementById('leave-remain').textContent);
        const mobileUsed = await page2.evaluate(() => document.getElementById('leave-used').textContent);
        const mobileListCount = await page2.evaluate(() => document.querySelectorAll('#leave-history-list li').length);
        
        assert.equal(mobileUsed, '2.0', 'Mobile UI should show 2.0 used');
        assert.equal(mobileRemain, '13.0', 'Mobile UI should show 13.0 remain');
        assert.equal(mobileListCount, 2, 'Mobile UI should show 2 list items');

        console.log(`\nPage1 Errors: ${page1ErrorCount}, Page2 Errors: ${page2ErrorCount}`);

        console.log('--- End of leaveService Browser test ---\n');

    } catch (e) {
        console.error('Test execution error:', e.message);
        process.exitCode = 1;
    } finally {
        try {
            if (browser) await browser.close();
        } catch (err) {
            console.error('Error closing browser:', err.message);
            process.exitCode = 1;
        }

        try {
            await new Promise((resolve, reject) => {
                server.close((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            console.log('Cleaned up resources.');
        } catch (err) {
            console.error('Error closing server:', err.message);
            process.exitCode = 1;
        }

        if (!process.exitCode || process.exitCode === 0) {
            console.log('All tests passed successfully!');
        }
    }
});
