// 브라우저 하네스: 빌드된 dist 를 로컬 서버로 띄우고 외부 리소스는 로컬 사본, Firebase 는 가짜(메모리)로 대체.
// 테스트마다 사용자(admin/staff)·실패 경로를 바꿔 새 페이지를 연다. 실제 서비스·DB 에 연결하지 않는다.
import chromium from '@sparticuz/chromium'; import puppeteer from 'puppeteer-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const DIST = process.env.DIST || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../dist'); const NM = path.join(path.dirname(new URL(import.meta.url).pathname), 'node_modules'); const OUT = process.env.OUT || '/tmp/shots';
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const BASE = process.env.BASE || '';
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (BASE && p.startsWith(BASE)) p = p.slice(BASE.length) || '/'; if (p === '/') p = '/index.html';
  const f = path.join(DIST, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }).listen(4173);
const pretCss = fs.readFileSync(`${NM}/pretendard/dist/web/variable/pretendardvariable.css`, 'utf8').replace(/url\(['"]?\.\/woff2\/([^'")]+)['"]?\)/g, 'url(https://local.font/pret/$1)').replace(/,?\s*url\(['"]?\.\/woff\/[^)]*\)\s*format\([^)]*\)/g, '');
const symCss = fs.readFileSync(`${NM}/material-symbols/rounded.css`, 'utf8').replace(/url\(["']?\.\/material-symbols-rounded\.woff2["']?\)/g, 'url(https://local.font/sym.woff2)');
const local = [
  [/firebase-app\.js/, 'js', fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'fake-firebase.js'), 'utf8')],
  [/gstatic\.com\/firebasejs/, 'js', '/* stub */'],
  [/pretendardvariable\.min\.css/, 'css', pretCss],
  [/fonts\.googleapis\.com\/css2\?family=Material\+Symbols/, 'css', symCss],
  [/flatpickr\.min\.css/, 'css', fs.readFileSync(`${NM}/flatpickr/dist/flatpickr.min.css`, 'utf8')],
  [/cdn\.jsdelivr\.net\/npm\/flatpickr$/, 'js', fs.readFileSync(`${NM}/flatpickr/dist/flatpickr.min.js`, 'utf8')],
  [/l10n\/ko\.js/, 'js', fs.readFileSync(`${NM}/flatpickr/dist/l10n/ko.js`, 'utf8')],
  [/Sortable\.min\.js/, 'js', fs.readFileSync(`${NM}/sortablejs/Sortable.min.js`, 'utf8')],
  [/@popperjs\/core/, 'js', fs.readFileSync(`${NM}/@popperjs/core/dist/umd/popper.min.js`, 'utf8')],
  [/unpkg\.com\/tippy\.js@6$/, 'js', fs.readFileSync(`${NM}/tippy.js/dist/tippy-bundle.umd.min.js`, 'utf8')],
  [/animations\/scale\.css/, 'css', fs.readFileSync(`${NM}/tippy.js/animations/scale.css`, 'utf8')],
  [/themes\/translucent\.css/, 'css', fs.readFileSync(`${NM}/tippy.js/themes/translucent.css`, 'utf8')],
  [/kakao.*\.js/, 'js', 'window.Kakao={init(){},isInitialized(){return true},Navi:{start(){}},Share:{sendDefault(){}}};'],
];
export const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox'], headless: true });
export async function openPage({ W = 1440, H = 900, userKey = 'admin', fail = [], theme = 'light', scale = 1 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: scale, isMobile: W < 700, hasTouch: W < 700 });
  await page.setRequestInterception(true);
  page.on('request', (r) => { const u = r.url();
    if (u.startsWith('http://localhost:4173')) return r.continue();
    if (u.startsWith('https://local.font/')) { const f = u.includes('/pret/') ? `${NM}/pretendard/dist/web/variable/woff2/${u.split('/pret/')[1]}` : `${NM}/material-symbols/material-symbols-rounded.woff2`; return r.respond({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(f) }); }
    for (const [re, kind, body] of local) if (re.test(u)) return r.respond({ status: 200, contentType: kind === 'js' ? 'application/javascript' : 'text/css', body });
    if (r.resourceType() === 'image') return r.respond({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' });
    r.abort(); });
  const errors = []; page.on('pageerror', e => errors.push(String(e.message)));
  await page.evaluateOnNewDocument((k, f, th) => { window.__fakeUserKey = k; window.__fakeFail = f; try { localStorage.setItem('theme', th); } catch (e) {} }, userKey, fail, theme);
  await page.goto('http://localhost:4173' + (BASE ? BASE + '/' : '/'), { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('app-splash'), { timeout: 15000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 800));
  page.__errors = errors;
  return page;
}
export async function closeAll() { await browser.close(); server.close(); }
