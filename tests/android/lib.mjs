// Helpers for the device test (tests/android/run.mjs): adb, the screen (uiautomator), and the app's web view through
// the Chrome DevTools protocol (the test build is debuggable, so its web view has a devtools socket).
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PKG = 'com.bradcowdrey.cowdreypdf';
export const pw = require(process.env.PW_CORE || 'playwright-core');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export let OUT = '/tmp/android-e2e';
export function setOut(dir) { OUT = dir; fs.mkdirSync(OUT, { recursive: true }); }

export function log(...m) { const s = m.join(' '); console.log(s); try { fs.appendFileSync(path.join(OUT, 'e2e-log.txt'), s + '\n'); } catch {} }
export function adb(...args) {
  const r = spawnSync('adb', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20 });
  return (r.stdout || '') + (r.status ? (r.stderr || '') : '');
}
export const sh = (cmd) => adb('shell', cmd);
export function adbBytes(...args) { return spawnSync('adb', args, { timeout: 120000, maxBuffer: 512 << 20 }).stdout; }

let shotN = 0;
export function shot(name) {
  const f = `${String(++shotN).padStart(2, '0')}-${name}.png`;
  try { fs.writeFileSync(path.join(OUT, f), adbBytes('exec-out', 'screencap', '-p')); log('  screenshot', f); } catch (e) { log('  screenshot failed', e.message); }
  return f;
}
// What has the focus on screen. A system "isn't responding" window (the emulator's own setup apps can stop responding
// while it is busy) is closed first, so it never sits over the app or Android's windows during a scenario.
export function focused() {
  let f = (sh('dumpsys window | grep -E "mCurrentFocus|mFocusedApp"') || '').trim();
  for (let i = 0; i < 3 && /Application Not Responding|Application Error|isn't responding/i.test(f); i++) { closeSystemDialog(f); f = (sh('dumpsys window | grep -E "mCurrentFocus|mFocusedApp"') || '').trim(); }
  return f;
}
export function closeSystemDialog(why = '') {
  const n = uiNodes().find((x) => /aerr_close|aerr_wait/.test(x['resource-id'] || '') || /^(Close app|Wait|OK)$/i.test(x.text || ''));
  log('  [system dialog closed]', why.split('\n')[0].replace(/\s+/g, ' ').slice(0, 160));
  if (n) sh(`input tap ${n.x} ${n.y}`); else sh('input keyevent KEYCODE_BACK');
  spawnSync('sleep', ['1']);
}

/* ---- the screen, through uiautomator (for Android's own windows: the save dialog, file picker, print, share) ---- */
export function uiNodes() {
  sh('uiautomator dump /sdcard/ui.xml > /dev/null 2>&1');
  const xml = sh('cat /sdcard/ui.xml');
  const out = [];
  for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
    const a = {}; for (const kv of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) a[kv[1]] = kv[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
    const b = (a.bounds || '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (b) { a.x = (+b[1] + +b[3]) >> 1; a.y = (+b[2] + +b[4]) >> 1; a.w = b[3] - b[1]; a.h = b[4] - b[2]; }
    out.push(a);
  }
  return out;
}
export function findUi(re, nodes = uiNodes()) { return nodes.find((n) => (re.test(n.text || '') || re.test(n['content-desc'] || '') || re.test(n['resource-id'] || '')) && n.w > 0); }
export async function waitUi(re, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const n = findUi(re); if (n) return n; await sleep(700); }
  return null;
}
export async function tapUi(re, timeout = 20000) {
  const n = await waitUi(re, timeout);
  if (!n) throw new Error(`nothing on screen matches ${re}`);
  sh(`input tap ${n.x} ${n.y}`); await sleep(1200);
  return n;
}
export const back = () => sh('input keyevent KEYCODE_BACK');

/* ---- the app ---- */
export const pid = () => sh(`pidof ${PKG}`).trim();
export function component() { return (sh(`cmd package resolve-activity --brief ${PKG}`).trim().split('\n').pop() || '').trim(); }

// Playwright's Android support finds the app's web view by its devtools socket (webview_devtools_remote_<pid>) and
// connects to it as Chrome on Android; no driver app is installed (only the web view is driven this way).
let device = null;
export async function connect(timeout = 60000) {
  const end = Date.now() + timeout; let p = '';
  while (Date.now() < end && !(p = pid())) await sleep(1000);
  if (!p) throw new Error('the app is not running');
  if (!device) [device] = await pw._android.devices({ omitDriverInstall: true });
  if (!device) throw new Error('no device');
  const wv = await device.webView({ pkg: PKG, socketName: `webview_devtools_remote_${p}` }, { timeout: Math.max(5000, end - Date.now()) });
  const page = await wv.page();
  page.errors = [];
  page.on('pageerror', (e) => { page.errors.push(e.message); log('  [page error]', e.message); });
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning' || /fake worker|OCR:/i.test(t)) log(`  [console.${m.type()}]`, t.slice(0, 400)); if (m.type() === 'error') page.errors.push(t); });
  await page.waitForFunction(() => window.__cowdreyPdf, null, { timeout: 30000 });
  page.setDefaultTimeout(30000);
  log('  connected to the web view of', PKG, 'pid', p, page.url());
  return page;
}

// Converts page (CSS) coordinates to screen pixels, for real taps and swipes with adb.
export async function screenOf(page) {
  const wv = uiNodes().find((n) => n.class === 'android.webkit.WebView') || { bounds: '[0,0][0,0]' };
  const b = wv.bounds.match(/\[(\d+),(\d+)\]/);
  const dpr = await page.evaluate(() => devicePixelRatio);
  return { dpr, ox: +b[1], oy: +b[2], at: (x, y) => [Math.round(+b[1] + x * dpr), Math.round(+b[2] + y * dpr)] };
}
export async function tapCss(page, x, y) { const s = await screenOf(page); const [a, b] = s.at(x, y); sh(`input tap ${a} ${b}`); await sleep(500); }
export async function swipeCss(page, x1, y1, x2, y2, ms = 600) { const s = await screenOf(page); const [a, b] = s.at(x1, y1), [c, d] = s.at(x2, y2); sh(`input swipe ${a} ${b} ${c} ${d} ${ms}`); await sleep(600); }
// Taps an element where it is now: the screen is measured first (that takes a moment), then the element, so a page
// that was still settling after scrolling can't move it from under the finger.
export async function tapEl(page, selector) {
  const el = page.locator(selector).first(); await el.scrollIntoViewIfNeeded(); await sleep(400);
  const s = await screenOf(page);
  const r = await el.boundingBox(); if (!r) throw new Error('not on screen: ' + selector);
  const [a, b] = s.at(r.x + r.width / 2, r.y + r.height / 2); sh(`input tap ${a} ${b}`); await sleep(500);
}
// A finger drag that ends exactly where it should: down, moves, a last move onto the end point, a pause, up.
export async function dragCss(page, x1, y1, x2, y2, steps = 12) {
  const s = await screenOf(page); const [a, b] = s.at(x1, y1), [c, d] = s.at(x2, y2);
  sh(`input motionevent DOWN ${a} ${b}`); await sleep(120);
  for (let k = 1; k <= steps; k++) { sh(`input motionevent MOVE ${Math.round(a + (c - a) * k / steps)} ${Math.round(b + (d - b) * k / steps)}`); await sleep(40); }
  sh(`input motionevent MOVE ${c} ${d}`); await sleep(250);
  sh(`input motionevent UP ${c} ${d}`); await sleep(600);
}

/* ---- files on the device ---- */
export const DL = '/sdcard/Download';
export function listDownloads() { return sh(`ls -1 ${DL}`).split('\n').map((s) => s.trim()).filter((s) => s && !/No such file/.test(s)); }
export function pullDownload(name) { return adbBytes('exec-out', 'cat', `${DL}/${name}`); }
export async function waitNewDownload(before, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const now = listDownloads().filter((n) => !before.includes(n));
    if (now.length) { await sleep(1500); return now; }
    await sleep(700);
  }
  return [];
}
