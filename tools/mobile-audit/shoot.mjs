// 모바일 화면 캡처: dist 를 로컬에서 띄우고 외부 리소스는 로컬 사본/가짜로 교체한 뒤 탭별 스크린샷
import chromium from '@sparticuz/chromium'; import puppeteer from 'puppeteer-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const DIST = process.env.DIST || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../dist'); const NM = path.join(path.dirname(new URL(import.meta.url).pathname), 'node_modules'); const OUT = process.env.OUT || '/tmp/shots';
const W = +(process.env.W || 390), H = +(process.env.H || 844);
fs.mkdirSync(OUT, { recursive: true });
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
const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox'], headless: true });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 2, isMobile: W < 700, hasTouch: W < 700 });
await page.setRequestInterception(true);
const blocked = new Set();
const NET = process.env.NET === 'lte' ? { connect: 300, rtt: 90, bps: 1.2e6 } : null;
const seenHosts = new Set();
const netDelay = (u, bytes) => { if (!NET) return 0; let h; try { h = new URL(u).host; } catch (e) { return 0; } let d = NET.rtt + Math.round((bytes || 20000) / NET.bps * 1000); if (!seenHosts.has(h)) { seenHosts.add(h); d += NET.connect; } return d; };
const timed = (r, u, resp, bytes) => { const d = netDelay(u, bytes); if (!d) return r.respond(resp); setTimeout(() => r.respond(resp), d); };
page.on('request', (r) => { const u = r.url();
  if (u.startsWith('http://localhost:4173')) { if (NET) { const p = u.replace('http://localhost:4173','').split('?')[0]; const f = path.join(DIST, p === '/' ? '/index.html' : p); const sz = fs.existsSync(f) && fs.statSync(f).isFile() ? fs.statSync(f).size : 2000; const d = netDelay('https://fawwcare.github.io/x', sz); return setTimeout(() => r.continue(), d); } return r.continue(); }
  if (u.startsWith('https://local.font/sym') && process.env.SLOW_ICON_MS) { const f = `${NM}/material-symbols/material-symbols-rounded.woff2`; return setTimeout(() => r.respond({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(f) }), +process.env.SLOW_ICON_MS); }
  if (u.startsWith('https://local.font/')) { const f = u.includes('/pret/') ? `${NM}/pretendard/dist/web/variable/woff2/${u.split('/pret/')[1]}` : `${NM}/material-symbols/material-symbols-rounded.woff2`; const fb = fs.readFileSync(f); return timed(r, u.includes('/pret/') ? 'https://cdn.jsdelivr.net/x' : 'https://fonts.gstatic.com/x', { status: 200, contentType: 'font/woff2', body: fb }, fb.length); }
  for (const [re, kind, body] of local) if (re.test(u)) return timed(r, u, { status: 200, contentType: kind === 'js' ? 'application/javascript' : 'text/css', body }, body.length);
  if (r.resourceType() === 'image') return r.respond({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' });
  blocked.add(u.split('?')[0].slice(0, 80)); r.abort(); });
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 160)));
await page.evaluateOnNewDocument((th) => { try { localStorage.setItem('theme', th); } catch (e) {} }, process.env.THEME || 'light');
if (process.env.EARLY_SHOT) {
  page.goto('http://localhost:4173' + (BASE ? BASE + '/' : '/')).catch(() => {});
  for (const ms of process.env.EARLY_SHOT.split(',').map(Number)) { await new Promise(r => setTimeout(r, ms)); await page.screenshot({ path: `${OUT}/early-${(globalThis.__acc = (globalThis.__acc || 0) + ms)}.png` }); }
  await new Promise(r => setTimeout(r, +(process.env.SLOW_ICON_MS || 0) + 2000));
} else {
await page.goto('http://localhost:4173' + (BASE ? BASE + '/' : '/'), { waitUntil: 'networkidle0', timeout: 60000 });
}
await new Promise(r => setTimeout(r, 1500));
await page.waitForFunction(() => !document.getElementById('app-splash'), { timeout: 15000 }).catch(() => console.log('로딩 화면이 15초 안에 사라지지 않음'));
if (process.env.NOANIM) await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
const overflow = {}; const contrast = {};
const tabs = (process.env.TABS || 'tab-calendar,tab-tasks,tab-trips,tab-leaves,tab-notice,tab-docs,tab-members,tab-mypage,tab-meeting-feed,tab-admin').split(',');
for (const t of tabs) {
  await page.evaluate((t) => { window.__curTab = t; const btn = document.querySelector(`[onclick*="switchTab('${t}'"]`); if (typeof switchTab === 'function') switchTab(t, btn); window.scrollTo(0, 0); }, t);
  await new Promise(r => setTimeout(r, 900));
  const ov = await page.evaluate((W) => {
    const tab = document.getElementById(window.__curTab) || document.body;
    const out = []; const seen = new Set();
    document.querySelectorAll('body *').forEach(el => {
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') return;
      if (el.closest('[style*="display: none"]')) return;
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return;
      if (r.right > W + 1) {
        // 가장 바깥 넘침 요소만 (부모가 이미 넘친 경우 생략)
        let p = el.parentElement, parentOver = false; while (p) { const pr = p.getBoundingClientRect(); if (pr.right > W + 1 && getComputedStyle(p).overflowX === 'visible') { parentOver = true; break; } p = p.parentElement; }
        if (parentOver) return;
        let anc = el, scrolls = false; while (anc) { const ox = getComputedStyle(anc).overflowX; if (anc !== el && (ox === 'auto' || ox === 'scroll' || ox === 'hidden')) { scrolls = true; break; } anc = anc.parentElement; }
        if (scrolls) return;
        const id = (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
        const key = el.tagName + id; if (seen.has(key)) return; seen.add(key);
        out.push(`${el.tagName.toLowerCase()}${id} right=${Math.round(r.right)} w=${Math.round(r.width)}`);
      }
    });
    return { docW: document.documentElement.scrollWidth, list: out.slice(0, 12) };
  }, W);
  overflow[t] = ov;
  if (process.env.CONTRAST) {
    contrast[t] = await page.evaluate((t) => {
      const lum = (c) => { const m = c.match(/[\d.]+/g); if (!m) return null; const [r, g, b] = m.slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return { L: 0.2126 * r + 0.7152 * g + 0.0722 * b, a: m.length > 3 ? Number(m[3]) : 1 }; };
      const bgOf = (el) => { while (el) { const c = getComputedStyle(el).backgroundColor; const l = lum(c); if (l && l.a > 0.5) return { l, c }; if (getComputedStyle(el).backgroundImage !== 'none') return null; el = el.parentElement; } const pc = getComputedStyle(document.body).backgroundColor; const pl = lum(pc); return (pl && pl.a > 0.5) ? { l: pl, c: pc } : { l: lum('rgb(255,255,255)'), c: 'rgb(255,255,255)' }; };
      const root = document.getElementById(t); const out = []; const seen = new Set();
      const scope = [root, document.querySelector('.header'), document.querySelector('.nav-sidebar')].filter(Boolean);
      scope.forEach(sc => sc.querySelectorAll('*').forEach(el => {
        const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
        if (!txt || el.classList.contains('material-symbols-rounded')) return;
        const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return;
        const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0) return;
        const fg = lum(cs.color); const bg = bgOf(el); if (!fg || !bg) return;
        const ratio = (Math.max(fg.L, bg.l.L) + 0.05) / (Math.min(fg.L, bg.l.L) + 0.05);
        const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
        const need = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
        if (ratio < need) { const key = txt.slice(0, 20) + '|' + cs.color + '|' + bg.c; if (seen.has(key)) return; seen.add(key);
          out.push({ text: txt.slice(0, 24), ratio: +ratio.toFixed(2), need, color: cs.color, bg: bg.c, cls: (el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName.toLowerCase()) }); }
      }));
      return out.sort((a, b) => a.ratio - b.ratio).slice(0, 40);
    }, t);
  }
  await page.screenshot({ path: `${OUT}/${t}.png`, fullPage: false });
  await page.screenshot({ path: `${OUT}/${t}-full.png`, fullPage: true });
}
fs.writeFileSync(`${OUT}/overflow.json`, JSON.stringify(overflow, null, 1));
if (process.env.CONTRAST) fs.writeFileSync(`${OUT}/contrast.json`, JSON.stringify(contrast, null, 1));
console.log('errors:', JSON.stringify(errors.slice(0, 8)));
console.log('blocked:', JSON.stringify([...blocked].slice(0, 10)));
await browser.close(); server.close();
