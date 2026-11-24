// Device test for the Android app: runs on an emulator in CI (.github/workflows/android-app.yml), on the test build
// (a debug build whose web view the test drives through the Chrome DevTools protocol). Android's own windows (the save
// dialog, the file picker, print, the share sheet) are driven with adb and uiautomator, and what the app saved is
// pulled off the device and checked here with pdf-lib, asn1js and Node's crypto.
// Usage: node tests/android/run.mjs <test apk> <output dir>
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { createRequire } from 'node:module';
import * as A from './lib.mjs';
const { adb, adbBytes, sh, log, shot, sleep, PKG, root } = A;
const require = createRequire(import.meta.url);
const NM = path.join(root, 'desktop/node_modules');
const L = require(path.join(NM, 'pdf-lib'));
const forge = require(path.join(NM, 'node-forge'));
const asn1js = require(path.join(NM, 'asn1js'));
const fflate = require(path.join(NM, 'fflate'));

// pdf.js (read here to check attachments) needs Promise.withResolvers, which Node 20 (the runner's) doesn't have.
if (!Promise.withResolvers) Promise.withResolvers = function () { let resolve, reject; const promise = new this((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const [APK, OUTDIR] = process.argv.slice(2);
A.setOut(OUTDIR || '/tmp/android-e2e');
const results = [];
let page = null;
const only = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;
// The results so far are written after every scenario, so a run that is stopped still says how far it got.
function writeResults(done) {
  const passed = results.filter((r) => r[0]).length;
  const summary = results.map(([p, n, e]) => `${p ? 'PASS' : 'FAIL'}  ${n}${e ? '\n      ' + e : ''}`).join('\n');
  const head = !done ? 'NOT FINISHED' : passed === results.length ? 'ALL PASSED' : 'SOME FAILED';
  const errors = page && !page.isClosed() ? page.errors : [];
  fs.writeFileSync(path.join(A.OUT, 'result.txt'), `${head}: ${passed}/${results.length}\n${summary}\n${errors.length ? '\npage errors:\n' + errors.slice(0, 30).join('\n') + '\n' : ''}`);
  return { passed, summary, head };
}
// Back to the app in front, with none of Android's windows over it (a test that failed can leave one open).
async function frontApp() {
  for (let i = 0; i < 4 && !/cowdreypdf\/.*Activity/.test(A.focused()); i++) { A.back(); await sleep(1000); }
  if (!/cowdreypdf\/.*Activity/.test(A.focused()) && A.pid()) { sh(`am start -n ${comp}`); await sleep(2000); }
}
async function test(name, fn, limit = /OCR|batch|compare|sign/i.test(name) ? 420000 : 240000) {
  if (only && !only.test(name)) return;
  const t0 = Date.now(); log(`\n== ${name}`);
  let timer;
  try {
    await frontApp();
    if ((!page || page.isClosed()) && A.pid()) page = await A.connect();
    // A scenario never runs on for ever: one that takes too long fails, and the next one starts.
    await Promise.race([fn(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`took longer than ${limit / 1000} s`)), limit); })]);
    results.push([true, name]); log(`PASS ${name} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  } catch (e) {
    results.push([false, name, (e && e.message || String(e)).split('\n')[0]]); log(`FAIL ${name}: ${e && e.stack || e}`);
    shot('fail-' + name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40));
    // leave Android's own windows and the app's dialogs for the next scenario
    await frontApp();
    await withLimit(closeDialogs(), 20000).catch(() => {});
  } finally { clearTimeout(timer); writeResults(false); }
}
const withLimit = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]);
// Closes the app's dialogs the way Escape or Back does (cancel), so the app's own dialog code finishes them. It keeps
// watching for a moment: a dialog can open again just after (Signing IDs comes back after an import).
async function closeDialogs(watch = 2500) {
  const end = Date.now() + watch;
  for (let i = 0; i < 12; i++) {
    let open = false;
    try { open = await withLimit(page.evaluate(() => { const d = document.querySelector('#dialog'); if (!d || !d.open) return false; d.dispatchEvent(new Event('cancel', { cancelable: true })); return true; }), 5000); } catch { return; }
    if (!open && Date.now() > end) return;
    await sleep(500);
  }
}
// What took and lost the focus (and the window's size), for scenarios that type: logged when they fail.
const watchFocus = () => page.evaluate(() => {
  window.__fx = [];
  const d = (e) => e && e !== window && e !== document ? `${e.tagName || e.nodeName}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : ''}${e.name ? '[' + e.name + ']' : ''}` : String(e);
  const t0 = performance.now(), rec = (s) => window.__fx.push(`${Math.round(performance.now() - t0)} ${s}`);
  if (window.__fxOn) return; window.__fxOn = true;
  for (const t of ['focusin', 'focusout', 'pointerdown', 'touchstart', 'touchcancel', 'click', 'contextmenu', 'dragstart', 'drop']) document.addEventListener(t, (e) => rec(`${t} ${d(e.target)}${e.relatedTarget ? ' → ' + d(e.relatedTarget) : ''}`), true);
  addEventListener('resize', () => rec(`resize ${innerWidth}x${innerHeight}`));
  if (window.visualViewport) visualViewport.addEventListener('resize', () => rec(`viewport ${Math.round(visualViewport.height)}`));
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.removedNodes) if (n.nodeType === 1 && (n.matches('.line-editor, .annotationLayer, .page') || n.querySelector && n.querySelector('.line-editor'))) rec(`removed ${d(n)}`); }).observe(document.body, { childList: true, subtree: true });
});
const focusLog = async () => { try { log('  focus log:', (await page.evaluate(() => (window.__fx || []).slice(-40).join(' | '))) || '(none)'); log('  active:', await page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName}.${a.className} ${a.name || ''}` : ''; })); } catch {} };
const ok = (v, m) => { if (!v) throw new Error(m || 'not ok'); };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const fixture = (n) => path.join(root, 'tests/fixtures', n);
const run = (id) => page.evaluate((i) => { window.__cowdreyPdf.run(i); }, id).then(() => sleep(300));
const marks = () => page.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().map((m) => m.type));
const title = () => page.evaluate(() => document.querySelector('#docTitle').textContent);
const saveState = () => page.evaluate(() => document.querySelector('#saveState').textContent.trim());
const toastText = () => page.evaluate(() => document.querySelector('#toast').textContent);
const answer = async (label) => { await page.waitForSelector('#dialog[open]'); await page.click(`#dialog .dlg-foot button:has-text("${label}")`); };
async function openBytes(bytes, name) {
  await page.evaluate(async ([b, n]) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); await window.__cowdreyPdf.openBytes(u, n); }, [Buffer.from(bytes).toString('base64'), name]);
  await page.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 30000 }); await sleep(800);
}
const built = async () => Buffer.from(await page.evaluate(async () => Array.from(await window.__cowdreyPdf.buildPdf())));
// A point on a page (PDF units) in the page's CSS pixels
// (scrolled into the viewer first when it is off screen, as on a page zoomed in)
const at = (n, x, y) => page.evaluate(([n, x, y]) => {
  const v = window.__cowdreyPdf.views()[n]; v.el.scrollIntoView({ block: 'nearest' });
  const [vx, vy] = v.viewport.convertToViewportPoint(x, y), vw = document.querySelector('#viewer'), w = vw.getBoundingClientRect();
  let r = v.el.getBoundingClientRect();
  if (r.top + vy < w.top + 40 || r.top + vy > w.bottom - 40) vw.scrollTop += r.top + vy - (w.top + w.height / 2);
  if (r.left + vx < w.left + 20 || r.left + vx > w.right - 20) vw.scrollLeft += r.left + vx - (w.left + w.width / 2);
  r = v.el.getBoundingClientRect(); return [r.left + vx, r.top + vy];
}, [n, x, y]);
const pageText = (n = 0) => page.evaluate(async (n) => { const tc = await window.__cowdreyPdf.views()[n].page.getTextContent(); return tc.items.map((i) => i.str).join(' '); }, n);
// (with the time now, so Android's picker, newest first, shows it at the top)
async function pushDownload(local, name) {
  adb('push', local, `${A.DL}/${name}`); sh(`touch '${A.DL}/${name}'`);
  // (so the picker's Recent and Downloads list it: they come from the media store)
  sh(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d 'file://${A.DL}/${encodeURIComponent(name).replace(/'/g, '%27')}' > /dev/null`);
  await sleep(1500);
}
// A content:// address for a file in Downloads, as a file manager would hand it over: MediaStore's, or else the app's
// own FileProvider (filled with run-as; the test build is debuggable).
async function contentUri(local, name) {
  await pushDownload(local, name);
  const enc = encodeURIComponent(name).replace(/'/g, '%27');
  sh(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d 'file:///sdcard/Download/${enc}' > /dev/null`); await sleep(2000);
  for (const table of ['content://media/external/downloads', 'content://media/external/file']) {
    const q = sh(`content query --uri ${table} --projection _id:_display_name --where "_display_name='${name.replace(/'/g, '')}'"`);
    const id = (q.match(/_id=(\d+)/) || [])[1];
    if (id) return { uri: `${table}/${id}`, grant: true };
  }
  adb('push', local, '/data/local/tmp/in.pdf');
  sh(`run-as ${PKG} sh -c 'mkdir -p cache/in && cp /data/local/tmp/in.pdf "cache/in/${name}"'`);
  return { uri: `content://${PKG}.fileprovider/share/in/${encodeURIComponent(name)}`, grant: false };
}
const startView = (c, action = 'VIEW') => sh(`am start -W -a android.intent.action.${action} -t application/pdf ${action === 'VIEW' ? `-d '${c.uri}'` : `--eu android.intent.extra.STREAM '${c.uri}'`} ${c.grant ? '--grant-read-uri-permission' : ''} -n ${comp}`).trim().replace(/\s+/g, ' ');
async function pushBytes(bytes, name) { const f = path.join(A.OUT, '.push-' + name.replace(/[^\w.]+/g, '_')); fs.writeFileSync(f, bytes); await pushDownload(f, name); fs.unlinkSync(f); }

/* ---- Android's own windows ---- */
const isDocs = () => /documentsui|DocumentsUI|com\.google\.android\.documentsui/.test(A.focused());
// Into Downloads in the system file window, when it opened somewhere else (Recent can't take a new file).
async function toDownloads() {
  const roots = await A.waitUi(/Show roots|Navigate up|Open navigation/i, 3000);
  if (roots) { sh(`input tap ${roots.x} ${roots.y}`); await sleep(1200); }
  const d = await A.waitUi(/^Downloads?$/, 5000);
  if (d) { sh(`input tap ${d.x} ${d.y}`); await sleep(1500); }
}
// The save dialog opens in the folder used last (Split's folder, say): the test saves in Downloads itself.
async function inDownloads() {
  const nodes = A.uiNodes();
  if (A.findUi(/^Files in Downloads$/, nodes)) return;
  const crumb = nodes.find((n) => /^Download$/.test(n.text || '') && n.w > 0);
  if (crumb) { sh(`input tap ${crumb.x} ${crumb.y}`); await sleep(1500); if (A.findUi(/^Files in Download/)) return; }
  await toDownloads();
}
// Starts something that opens Android's save dialog, saves into Downloads, and returns the file there.
async function saveThroughDialog(trigger, label) {
  const before = A.listDownloads();
  await trigger();
  const end = Date.now() + 60000;
  while (Date.now() < end && !isDocs()) await sleep(700);
  ok(isDocs(), 'the save dialog is open: ' + A.focused());
  await sleep(1500);
  await inDownloads();
  shot((label || 'save') + '-dialog');
  let save = await A.waitUi(/^save$/i, 10000);
  if (!save || save.enabled === 'false') { await toDownloads(); save = await A.waitUi(/^save$/i, 10000); }
  ok(save, 'a Save button');
  sh(`input tap ${save.x} ${save.y}`);
  const got = await A.waitNewDownload(before, 30000);
  ok(got.length, 'a new file in Downloads');
  const name = got[got.length - 1];
  await sleep(1500);
  const bytes = A.pullDownload(name);
  fs.writeFileSync(path.join(A.OUT, 'saved-' + name.replace(/[^\w.() -]+/g, '_')), bytes);
  log(`  saved ${name} (${bytes.length} bytes)`);
  return { name, bytes };
}
// Picks a file in Android's file picker (opened by trigger), by its name in Downloads.
async function pickThroughPicker(trigger, names) {
  await trigger();
  const end = Date.now() + 30000;
  while (Date.now() < end && !isDocs()) await sleep(700);
  ok(isDocs(), 'the file picker is open: ' + A.focused());
  await sleep(1500);
  const list = [].concat(names);
  const re = (n) => new RegExp('^' + n.replace(/[.()]/g, '\\$&') + '$');
  let n = await A.waitUi(re(list[0]), 5000);
  if (!n) { await toDownloads(); n = await A.waitUi(re(list[0]), 8000); }
  if (!n && list.length === 1) n = await searchPicker(list[0], re(list[0]));
  if (!n) log('  on screen:', A.uiNodes().map((x) => x.text || x['content-desc']).filter(Boolean).join(' | ').slice(0, 600));
  ok(n, `${list[0]} is listed (and not greyed out)`);
  shot('picker-' + list[0].replace(/[^a-z0-9]+/gi, '-'));
  if (list.length === 1) { sh(`input tap ${n.x} ${n.y}`); await sleep(1500); return; }
  sh(`input swipe ${n.x} ${n.y} ${n.x} ${n.y} 900`); await sleep(1000); // long press: choose several
  for (const other of list.slice(1)) { const m = await A.waitUi(re(other), 5000); ok(m, other + ' listed'); sh(`input tap ${m.x} ${m.y}`); await sleep(700); }
  await A.tapUi(/^(select|open|done)$/i, 5000);
  await sleep(1500);
}
// The picker's own search, for a file it doesn't list where it opened
async function searchPicker(name, re) {
  const s = await A.waitUi(/^Search$/i, 3000); if (!s) return null;
  sh(`input tap ${s.x} ${s.y}`); await sleep(1200);
  sh(`input text '${name.replace(/\.[^.]+$/, '').replace(/ /g, '%s').replace(/'/g, '')}'`); sh('input keyevent KEYCODE_ENTER'); await sleep(2500);
  const all = A.uiNodes().filter((x) => re.test(x.text || '') && x.w > 0 && x.y > 300);
  return all[0] || null;
}
async function backToApp() {
  for (let i = 0; i < 4 && !/cowdreypdf/.test(A.focused()); i++) { A.back(); await sleep(1000); }
}

/* ---- checks on saved files ---- */
// The text of a saved PDF, read by opening it in the app (its own pdf.js)
async function pdfText(bytes) {
  await openBytes(bytes, 'Check.pdf');
  return page.evaluate(async () => { const out = []; for (const v of window.__cowdreyPdf.views()) { const tc = await v.page.getTextContent(); out.push(tc.items.map((x) => x.str).join(' ')); } return out.join('\n'); });
}
const ranges = (buf) => [...buf.toString('latin1').matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)].map((m) => m.slice(1, 5).map(Number));
// A signature checked with Node's crypto and asn1js only (as tests/features/sign.test.mjs does)
function nodeVerify(buf, [, b, c, d]) {
  const der = Buffer.from(buf.subarray(b + 1, c - 1).toString('latin1'), 'hex');
  const ci = asn1js.fromBER(new Uint8Array(der).buffer).result;
  const sd = ci.valueBlock.value[1].valueBlock.value[0], parts = sd.valueBlock.value;
  const certsEl = parts.find((x) => x.idBlock.tagClass === 3 && x.idBlock.tagNumber === 0);
  const certs = certsEl.valueBlock.value.map((x) => new crypto.X509Certificate(Buffer.from(x.toBER(false))));
  const si = parts[parts.length - 1].valueBlock.value[0], sp = si.valueBlock.value;
  const serial = Buffer.from(sp[1].valueBlock.value[1].valueBlock.valueHexView).toString('hex').toUpperCase().replace(/^0+/, '');
  const signer = certs.find((x) => x.serialNumber.replace(/^0+/, '') === serial);
  const sa = sp.find((x) => x.idBlock.tagClass === 3 && x.idBlock.tagNumber === 0);
  const saDer = Buffer.from(sa.valueBeforeDecodeView); saDer[0] = 0x31;
  const attr = (oid) => sa.valueBlock.value.find((x) => x.valueBlock.value[0].valueBlock.toString() === oid);
  const md = Buffer.from(attr('1.2.840.113549.1.9.4').valueBlock.value[1].valueBlock.value[0].valueBlock.valueHexView);
  const digestAlg = sp[2].valueBlock.value[0].valueBlock.toString();
  const sig = Buffer.from(sp.find((x, k) => k > 3 && x.idBlock.tagClass === 1 && x.idBlock.tagNumber === 4).valueBlock.valueHexView);
  const hash = { '2.16.840.1.101.3.4.2.1': 'sha256', '2.16.840.1.101.3.4.2.2': 'sha384' }[digestAlg];
  const content = Buffer.concat([buf.subarray(0, b), buf.subarray(c, c + d)]);
  return { digestOk: crypto.createHash(hash).update(content).digest().equals(md), sigOk: !!signer && crypto.verify(hash, saDer, signer.publicKey, sig), signer: signer && signer.subject };
}
// A signing ID made here for the test: RSA, self-signed, in a PKCS#12 file
function makeP12(cn, password) {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }));
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e); cert.serialNumber = '01' + crypto.randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 86400000); cert.validity.notAfter = new Date(Date.now() + 3 * 365 * 86400000);
  const attrs = [{ name: 'commonName', value: cn }, { name: 'organizationName', value: 'Cowdrey Tests' }];
  cert.setSubject(attrs); cert.setIssuer(attrs);
  cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, nonRepudiation: true }]);
  cert.sign(key, forge.md.sha256.create());
  return Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(key, [cert], password, { algorithm: '3des' })).getBytes(), 'binary');
}
async function twoVersions() {
  const make = async (lines) => { const d = await L.PDFDocument.create(), f = await d.embedFont(L.StandardFonts.Helvetica); const pg = d.addPage([612, 792]); lines.forEach((t, k) => pg.drawText(t, { x: 72, y: 700 - k * 24, size: 14, font: f })); return Buffer.from(await d.save()); };
  return { oldPdf: await make(['Invoice 4471 for March', 'Payment is urgent', 'Thank you']), newPdf: await make(['Invoice 4471 for April', 'Payment is due net 30', 'Thank you']) };
}
const RULED = [['Name', 'City', 'Amount'], ['Smith', 'Leeds', '1,250.50'], ['Patel', 'York', '980'], ['Okafor', 'Bath', '12']];
async function tablesPdf() {
  const d = await L.PDFDocument.create(), f = await d.embedFont(L.StandardFonts.Helvetica), b = await d.embedFont(L.StandardFonts.HelveticaBold);
  const p1 = d.addPage([612, 792]);
  p1.drawText('Payments received', { x: 72, y: 720, size: 16, font: b });
  const xs = [72, 252, 402, 522], ys = [680, 655, 630, 605, 580];
  for (const y of ys) p1.drawLine({ start: { x: xs[0], y }, end: { x: xs[3], y }, thickness: 1, color: L.rgb(0, 0, 0) });
  for (const x of xs) p1.drawLine({ start: { x, y: ys[0] }, end: { x, y: ys[4] }, thickness: 1, color: L.rgb(0, 0, 0) });
  RULED.forEach((row, r) => row.forEach((t, c) => p1.drawText(t, { x: xs[c] + 6, y: ys[r] - 17, size: 11, font: r ? f : b })));
  return Buffer.from(await d.save());
}

/* ================= the scenarios ================= */
log('device:', sh('getprop ro.product.model').trim(), '· Android', sh('getprop ro.build.version.release').trim(), '· API', sh('getprop ro.build.version.sdk').trim());
log('web view:', (sh('dumpsys webviewupdate | grep -iE "Current WebView package"') || '').trim().replace(/\s+/g, ' '));
// The emulator's Google setup app can stop responding while the emulator is busy, and its "isn't responding" window
// then covers everything: it is turned off for the test (A.focused() closes any such window that still shows).
for (const p of ['com.google.android.googlesdksetup', 'com.google.android.setupwizard']) log(`turn off ${p}:`, sh(`pm disable-user --user 0 ${p} 2>&1`).trim().split('\n').pop());
A.focused();
adb('uninstall', PKG);
log(adb('install', '-r', '-g', APK).trim());
log('test build:', sh(`dumpsys package ${PKG} | grep -m1 versionName`).trim());
sh(`rm -rf ${A.DL}/*`);
sh('cmd uimode night yes');
sh('settings put secure show_ime_with_hard_keyboard 1'); // the on-screen keyboard, as on a phone
adb('logcat', '-c');
const SAMPLE = fs.readFileSync(fixture('sample.pdf'));
const comp = A.component(); log('launcher activity:', comp);

let intentC = null;
await test('open with: a VIEW intent with a content:// address opens the PDF (cold start)', async () => {
  intentC = await contentUri(fixture('sample.pdf'), 'Intent test.pdf');
  log('  address:', intentC.uri);
  const r = startView(intentC); log('  am start:', r.slice(0, 240));
  ok(!/Error|Exception/.test(r), r);
  page = await A.connect(90000);
  await page.waitForFunction(() => document.querySelectorAll('.page canvas.pdf').length > 0, null, { timeout: 45000 });
  await sleep(1500);
  const info = await page.evaluate(() => ({ pages: window.__cowdreyPdf.doc && window.__cowdreyPdf.doc.pages.length, ua: navigator.userAgent, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, fakeWorker: !!(globalThis.pdfjsWorker) }));
  log('  ', JSON.stringify(info));
  shot('open-with-intent-dark');
  eq([await title(), info.pages], ['Intent test', 3]);
});

await test('the pages draw with pdf.js\'s own worker (not a fake one in the page), and pdf.js loads offline', async () => {
  const r = await page.evaluate(() => { const c = document.querySelector('.page canvas.pdf'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let ink = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 3] > 0) ink++; return { ink, worker: !globalThis.pdfjsWorker, scripts: [...document.scripts].map((s) => s.src).filter(Boolean).slice(0, 5) }; });
  log('  ', JSON.stringify(r));
  ok(r.ink > 500, 'page drawn'); ok(r.worker, 'a real worker');
});

await test('open with: a second PDF while the app is open (onNewIntent), and Share to the app (SEND)', async () => {
  const c = await contentUri(fixture('word.pdf'), 'Running test.pdf');
  log('  am start:', startView(c).slice(0, 200));
  await page.waitForFunction(() => document.querySelector('#docTitle').textContent === 'Running test', null, { timeout: 30000 });
  shot('open-with-running');
  log('  am start SEND:', startView(intentC, 'SEND').slice(0, 200));
  await page.waitForFunction(() => document.querySelector('#docTitle').textContent === 'Intent test', null, { timeout: 30000 });
});

await test('open with: a file:// address the app may not read says so (instead of nothing happening)', async () => {
  await pushBytes((await twoVersions()).oldPdf, 'Old file manager.pdf');
  sh(`am start -W -a android.intent.action.VIEW -t application/pdf -d 'file:///sdcard/Download/Old%20file%20manager.pdf' -n ${comp}`);
  await page.waitForFunction(() => /Could not open|can only open/.test(document.querySelector('#toast').textContent), null, { timeout: 20000 });
  log('  toast:', await toastText());
});

await test('the file picker: Open shows Android\'s picker; the chosen PDF opens', async () => {
  await pushDownload(fixture('word.pdf'), 'Picked.pdf');
  await pickThroughPicker(() => A.tapEl(page, '.tb-actions [data-cmd="open"]'), 'Picked.pdf');
  await page.waitForFunction(() => document.querySelector('#docTitle').textContent === 'Picked', null, { timeout: 30000 });
  shot('picked-open');
});

await test('pages: a swipe scrolls to the next pages; the page number follows', async () => {
  await openBytes(SAMPLE, 'Quarterly report.pdf');
  const before = await page.evaluate(() => window.__cowdreyPdf.current);
  for (let i = 0; i < 3; i++) await A.swipeCss(page, 200, 650, 200, 250, 300);
  await sleep(800);
  const after = await page.evaluate(() => window.__cowdreyPdf.current);
  log('  page', before + 1, '→', after + 1);
  ok(after > before, 'moved on');
  await run('zoomFit'); await page.evaluate(() => window.__cowdreyPdf.views()[0].el.scrollIntoView());
});

await test('mark up with a finger: highlight text, draw, a note; undo and redo', async () => {
  await openBytes(SAMPLE, 'Quarterly report.pdf');
  await run('tool_highlight');
  const s = await page.locator('.page[data-n="0"] .textLayer span', { hasText: 'Cowdrey.PDF opens' }).first().boundingBox();
  await A.swipeCss(page, s.x + 2, s.y + s.height / 2, s.x + s.width * .6, s.y + s.height / 2, 500);
  await sleep(600);
  await run('tool_pen');
  const [x1, y1] = await at(0, 100, 300), [x2, y2] = await at(0, 300, 260);
  await A.swipeCss(page, x1, y1, x2, y2, 500);
  await run('tool_note');
  const [nx, ny] = await at(0, 420, 200); await A.tapCss(page, nx, ny);
  // (on a phone the note is placed at once; where it asks for its text, it gets some)
  if (await page.waitForSelector('.page-ask textarea', { timeout: 4000 }).catch(() => null)) { await page.fill('.page-ask textarea', 'Check the numbers'); await page.click('.page-ask .btn.primary'); }
  await sleep(800);
  const m = await marks(); log('  marks:', m.join(', '));
  ok(m.includes('hl') && m.includes('ink') && m.includes('note'), 'highlight, ink and note: ' + m);
  shot('markup-dark');
  await run('undo'); eq((await marks()).length, m.length - 1, 'undo');
  await run('redo'); eq((await marks()).length, m.length, 'redo');
  await run('tool_select');
});

let savedName = '';
await test('Save PDF: Android\'s save dialog; the file in Downloads is the PDF with its comments; "Saved" only then', async () => {
  ok(/Edited/.test(await saveState()), 'edited before: ' + await saveState());
  const { name, bytes } = await saveThroughDialog(() => A.tapEl(page, '#saveBtn'), 'save-pdf');
  savedName = name;
  const d = await L.PDFDocument.load(bytes, { updateMetadata: false });
  eq(d.getPageCount(), 3);
  ok(/^Cowdrey\.PDF 1\.1\.0/.test(d.getProducer() || ''), 'producer: ' + d.getProducer());
  const annots = d.getPage(0).node.Annots(); const subs = annots ? annots.asArray().map((r) => String(d.context.lookup(r).get(L.PDFName.of('Subtype')))) : [];
  log('  annotations:', subs.join(' '));
  ok(subs.includes('/Highlight') && subs.includes('/Ink') && subs.includes('/Text'), 'the comments are in the file');
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#saveState').textContent), null, { timeout: 15000 });
  shot('saved-dark');
});

await test('Save again: goes straight to the same file; Save as copy and a cancelled save leave "Edited"', async () => {
  await run('tool_rect');
  const [x1, y1] = await at(0, 100, 150), [x2, y2] = await at(0, 250, 100);
  await A.swipeCss(page, x1, y1, x2, y2, 400); await run('tool_select');
  ok(/Edited · Save to update the file/.test(await saveState()), await saveState());
  const before = A.listDownloads();
  await A.tapEl(page, '#saveBtn');
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#saveState').textContent), null, { timeout: 20000 });
  ok(!isDocs(), 'no dialog the second time');
  eq(A.listDownloads(), before, 'no new file');
  const d = await L.PDFDocument.load(A.pullDownload(savedName), { updateMetadata: false });
  const subs = d.getPage(0).node.Annots().asArray().map((r) => String(d.context.lookup(r).get(L.PDFName.of('Subtype'))));
  ok(subs.includes('/Square'), 'the box is in the same file now: ' + subs);
  // a change, then a save that is cancelled
  await run('tool_rect'); const [a1, b1] = await at(0, 300, 150), [a2, b2] = await at(0, 400, 100); await A.swipeCss(page, a1, b1, a2, b2, 400); await run('tool_select');
  await page.evaluate(() => { window.__cowdreyPdf.run('saveCopy'); });
  const end = Date.now() + 30000; while (Date.now() < end && !isDocs()) await sleep(700);
  ok(isDocs(), 'Save a copy asks where');
  A.back(); await sleep(2000); await backToApp();
  ok(/Edited/.test(await saveState()), 'still edited after cancelling: ' + await saveState());
});

await test('Edit PDF: a line retyped in Latin and in Greek; the saved PDF has the new words (offline fonts)', async () => {
  await openBytes(fs.readFileSync(fixture('word.pdf')), 'Pelican report.pdf');
  await watchFocus();
  await run('tool_edit');
  for (const [find, typed] of [['Budget', 'Budget approved for the whole year'], ['second phase', 'Ο πελεκάνος πετά ψηλά']]) {
    const b = await page.locator('.page[data-n="0"] .textLayer span', { hasText: find }).first().boundingBox();
    await A.tapCss(page, b.x + 10, b.y + b.height / 2);
    await page.waitForSelector('.line-editor', { timeout: 15000 });
    await page.waitForFunction(() => document.activeElement && document.activeElement.closest('.line-editor'), null, { timeout: 10000 }).catch(async (e) => { await focusLog(); throw e; });
    await sleep(1500); // the keyboard comes up
    const inEditor = await page.evaluate(() => { const ed = document.activeElement && document.activeElement.closest('.line-editor'); if (!ed) return false; const r = document.createRange(); r.selectNodeContents(ed); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return true; });
    if (!inEditor) { await focusLog(); throw new Error('the line editor lost the focus'); }
    await page.keyboard.insertText(typed); await sleep(300); await page.keyboard.press('Enter'); await sleep(800);
  }
  shot('edit-pdf-greek');
  await run('tool_select');
  const t = (await pdfText(await built())).replace(/\s+/g, ' ');
  log('  text:', t.slice(0, 300));
  ok(t.includes('Budget approved for the whole year'), 'Latin line');
  ok(t.includes('Ο πελεκάνος πετά ψηλά'), 'Greek line');
});

await test('forms: tap a field, the keyboard comes up and the field stays in view; typed value and tick saved', async () => {
  await openBytes(SAMPLE, 'Quarterly report.pdf');
  await page.evaluate(() => getSelection().removeAllRanges());
  await run('tool_select'); await watchFocus();
  for (let i = 0; i < 3; i++) {
    await A.tapEl(page, '.annotationLayer input[name="name"]');
    if (await page.waitForFunction(() => document.activeElement && document.activeElement.name === 'name', null, { timeout: 6000 }).catch(() => null)) break;
  }
  await sleep(2500);
  const ime = sh('dumpsys input_method | grep -m1 mInputShown').trim();
  const fit = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return { name: document.activeElement.name, bottom: Math.round(r.bottom), top: Math.round(r.top), vh: Math.round(visualViewport.height), ih: innerHeight, kb: document.documentElement.dataset.keyboard }; });
  log('  keyboard:', ime, JSON.stringify(fit));
  if (fit.name !== 'name') {
    await focusLog();
    log('  layout:', JSON.stringify(await page.evaluate(() => { const box = (q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }; const n = document.querySelector('.annotationLayer input[name="name"]'), r = n && n.getBoundingClientRect(), hit = r && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { layer: box('.page[data-n="0"] .annotationLayer'), style: (document.querySelector('.page[data-n="0"] .annotationLayer') || { style: {} }).style.width, name: box('.annotationLayer input[name="name"]'), agree: box('.annotationLayer input[name="agree"]'), hit: hit && (hit.tagName + (hit.name ? '[' + hit.name + ']' : '')), round: CSS.supports('width', 'round(down, 1.5px, 1px)') }; })));
  }
  shot('form-keyboard');
  eq(fit.name, 'name', 'the field has the focus');
  ok(fit.bottom <= fit.vh && fit.top >= 0, 'the field is above the keyboard');
  await page.keyboard.insertText('Bradley Cowdrey');
  A.back(); await sleep(800); // hides the keyboard
  await A.tapEl(page, '.annotationLayer .checkBox input');
  await sleep(500);
  const f = (await L.PDFDocument.load(await built())).getForm();
  eq([f.getTextField('name').getText(), f.getCheckBox('agree').isChecked()], ['Bradley Cowdrey', true]);
});

await test('forms designer: a new text field drawn with a finger is saved as a real field', async () => {
  await run('zoomFit'); await sleep(800);
  await run('ff_text');
  const [x1, y1] = await at(0, 80, 160), [x2, y2] = await at(0, 280, 130);
  await A.swipeCss(page, x1, y1, x2, y2, 500); await sleep(800);
  if (await page.$('#dialog[open]')) await page.click('#dialog .dlg-foot .btn.primary');
  await run('tool_select');
  const names = (await L.PDFDocument.load(await built())).getForm().getFields().map((x) => x.getName());
  log('  fields:', names.join(', '));
  ok(names.length >= 3, 'a new field: ' + names);
  shot('form-designer');
});

await test('redact: search, mark and apply; the word is gone from the saved PDF', async () => {
  await openBytes(SAMPLE, 'Quarterly report.pdf');
  await run('protRedSearch'); await page.waitForSelector('#dialog[open] input[name=text]');
  await page.fill('#dialog input[name=text]', 'pelican');
  await answer('Find'); await page.waitForSelector('#dialog[open] .prot-hits'); await answer('Mark'); await sleep(500);
  await run('protRedApply'); await answer('Apply'); await sleep(800);
  shot('redacted');
  const t = await pdfText(await built());
  ok(!/pelican/i.test(t) && /Cowdrey/.test(t), 'the word is gone, the rest stays');
});

await test('OCR with no network: a scanned page is read with the engine and English carried in the app', async () => {
  const LINES = ['The quick brown fox jumps', 'over the lazy pelican.', 'Invoice 4471 due 12 March'];
  const png = await page.evaluate((lines) => {
    const c = document.createElement('canvas'); c.width = 1700; c.height = 2200; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#111'; x.font = 'bold 54px sans-serif';
    lines.forEach((l, k) => x.fillText(l, 160, 300 + k * 120));
    return c.toDataURL('image/png').split(',')[1];
  }, LINES);
  const d = await L.PDFDocument.create(); const img = await d.embedPng(Buffer.from(png, 'base64'));
  d.addPage([612, 792]).drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
  await openBytes(Buffer.from(await d.save()), 'Scan.pdf');
  sh('svc wifi disable'); sh('svc data disable'); await sleep(3000);
  try {
    const direct = await page.evaluate(() => window.__cowdreyPdf.ocrAndroidPaths ? window.__cowdreyPdf.ocrAndroidPaths() : 'n/a');
    log('  the worker needed blob addresses:', direct);
    await run('ocr'); await page.waitForSelector('#dialog[open] .ocr-dlg');
    shot('ocr-dialog');
    await page.click('#dialog .dlg-foot .btn.primary');
    await page.waitForFunction(() => !document.querySelector('#dialog[open] .ocr-prog') && /Text recognized|recognized/i.test(document.querySelector('#toast').textContent), null, { timeout: 300000 });
    log('  toast:', await toastText());
    await page.waitForSelector('.page[data-n="0"] .textLayer span', { timeout: 20000 }).catch(() => {});
    const t = (await page.$$eval('.page[data-n="0"] .textLayer span', (s) => s.map((x) => x.textContent).join(' '))).replace(/\s+/g, ' ');
    log('  text layer:', t);
    ok(/pelican/i.test(t) && /quick brown fox/i.test(t), 'the words were read');
    shot('ocr-done');
  } finally {
    sh('svc wifi enable'); sh('svc data enable');
    for (let i = 0; i < 20 && !/1 received|1 packets received/.test(sh('ping -c 1 -W 2 8.8.8.8')); i++) await sleep(1500);
  }
});

await test('certificate signing: import a .p12 through the picker, sign, save; the signature verifies', async () => {
  await openBytes(SAMPLE, 'Quarterly report.pdf');
  await pushBytes(makeP12('Android Signer', 'pw1234'), 'Test signer.p12');
  await run('sgIds'); await page.waitForSelector('#dialog[open] #sgImport');
  await pickThroughPicker(() => A.tapEl(page, '#sgImport'), 'Test signer.p12');
  await page.waitForSelector('#dialog[open] #dlgInput', { timeout: 20000 });
  await page.fill('#dlgInput', 'pw1234'); await page.click('#dialog .dlg-foot .btn.primary');
  await page.waitForFunction(() => /Signing ID for Android Signer added/.test(document.querySelector('#toast').textContent), null, { timeout: 30000 });
  // Signing IDs opens again with the new ID in it
  await page.waitForSelector('#dialog[open] #sgImport', { timeout: 20000 });
  ok(/Android Signer/.test(await page.textContent('#dialog #sgIdList')), 'the ID is listed');
  shot('signing-ids');
  await answer('Close'); await page.waitForFunction(() => !document.querySelector('#dialog').open, null, { timeout: 10000 });
  await sleep(500);
  const { bytes } = await saveThroughDialog(async () => {
    await run('sgSign'); await page.waitForSelector('#dialog[open] #sgPlace');
    if (await page.$('#sgPw:visible')) await page.fill('#sgPw', 'pw1234');
    await page.selectOption('#sgPlace', 'draw'); await page.selectOption('#sgLook', 'text');
    await page.click('#dialog .dlg-foot .btn.primary');
    await page.waitForFunction(() => document.querySelector('#app').dataset.tool === 'sgbox');
    const [x1, y1] = await at(0, 320, 200), [x2, y2] = await at(0, 540, 140);
    await A.swipeCss(page, x1, y1, x2, y2, 500);
  }, 'sign');
  const r = ranges(bytes); ok(r.length === 1, 'one signature');
  const v = nodeVerify(bytes, r[0]); log('  ', JSON.stringify(v));
  ok(v.digestOk && v.sigOk && /Android Signer/.test(v.signer), 'verifies');
  await page.waitForSelector('.sg-bar', { timeout: 20000 });
  shot('signed');
});

await test('timestamps: the app posts a timestamp request over https (Android\'s own network and certificate authorities)', async () => {
  const hash = crypto.createHash('sha256').update('Cowdrey.PDF on Android').digest();
  const req = Buffer.concat([Buffer.from('3039020101303130 0d06096086480165030402010500 0420'.replace(/\s/g, ''), 'hex'), hash, Buffer.from('0101ff', 'hex')]);
  // The network first (the OCR scenario turned it off and on again): with none, this fails as "no network", not as
  // a timestamp failure.
  let net = null;
  for (let i = 0; i < 12 && !(net && net.ok); i++) {
    if (i) await sleep(5000);
    net = await page.evaluate(async () => { try { await fetch('https://www.gstatic.com/generate_204', { mode: 'no-cors', cache: 'no-store' }); return { ok: true }; } catch (e) { return { err: String(e) }; } });
  }
  log('  network:', net.ok ? 'up' : net.err);
  ok(net.ok, 'no network on the emulator: ' + net.err);
  // A public timestamp server can be slow or down: any one of three answering is enough.
  let res = {};
  for (const url of ['https://freetsa.org/tsr', 'https://timestamp.sectigo.com', 'https://timestamp.digicert.com']) {
    for (let i = 0; i < 2 && !res.ok; i++) {
      if (i) await sleep(5000);
      res = await page.evaluate(async ([u, b]) => { try { return { ok: await window.__TAURI__.core.invoke('tsa_post', { url: u, body: b }) }; } catch (e) { return { err: String(e) }; } }, [url, req.toString('base64')]);
      log('  ', url, '→', res.err || `answer of ${Buffer.from(res.ok, 'base64').length} bytes`);
    }
    if (res.ok) break;
  }
  ok(res.ok && Buffer.from(res.ok, 'base64')[0] === 0x30, 'a timestamp answer: ' + (res.err || ''));
});

await test('PDF/A: saved through the save dialog, with its PDF/A-2b identification', async () => {
  await openBytes(SAMPLE, 'Quarterly report.pdf');
  const { name, bytes } = await saveThroughDialog(async () => {
    await run('savePdfa'); await page.waitForSelector('#dialog[open] .pdfa-levels');
    await page.check('#dialog [name="pdfaLevel"][value="2b"]'); await page.click('#dialog .dlg-foot .btn.primary');
  }, 'pdfa');
  ok(/PDF-A/.test(name), name);
  const s = bytes.toString('latin1');
  ok(/<pdfaid:part>2<\/pdfaid:part>/.test(s) && /OutputIntent/.test(s), 'pdfaid and an output intent');
});

await test('compare: the other PDF from the picker; the changes are found', async () => {
  const { oldPdf, newPdf } = await twoVersions();
  await openBytes(newPdf, 'Invoice v2.pdf');
  await pushBytes(oldPdf, 'Invoice v1.pdf');
  await pickThroughPicker(() => run('compare'), 'Invoice v1.pdf');
  await page.waitForSelector('#dialog[open] .cmp-dlg', { timeout: 30000 });
  await answer('Compare');
  await page.waitForFunction(() => window.__cowdreyPdf.cmpState() && document.querySelector('#cmpView .cmp-busy').hidden && /\d+ changes?/.test((document.querySelector('#cmpView .cmp-sum') || {}).textContent || ''), null, { timeout: 120000 });
  const s = await page.evaluate(() => window.__cowdreyPdf.cmpState());
  log('  changes:', s.changes.map((c) => `${c.kind}:${c.was || ''}>${c.now || ''}`).join(' | '), '·', await page.textContent('#cmpView .cmp-sum'));
  ok(s.changes.some((c) => c.kind === 'replace' && /March/.test(c.was || '') && /April/.test(c.now || '')), 'March → April found');
  shot('compare-phone');
  await page.keyboard.press('Escape'); await sleep(500);
  if (await page.evaluate(() => document.querySelector('#app').classList.contains('cmp-on'))) await page.evaluate(() => document.querySelector('#cmpView [data-close], #cmpView .cmp-close') && document.querySelector('#cmpView [data-close], #cmpView .cmp-close').click());
});

await test('insight: a table dragged out with a finger is saved as CSV through the save dialog', async () => {
  await openBytes(await tablesPdf(), 'Tables.pdf');
  await run('insTable');
  const [ax, ay] = await at(0, 60, 690), [bx, by] = await at(0, 560, 566);
  await A.dragCss(page, ax, ay, bx, by);
  await page.waitForSelector('#dialog[open] .ins-tbl', { timeout: 20000 });
  shot('insight-table');
  const { name, bytes } = await saveThroughDialog(() => page.click('#dialog .dlg-foot button:has-text("Save CSV")'), 'csv');
  ok(/\.csv$/.test(name), name);
  const csv = bytes.toString('utf8').replace(/^﻿/, '');
  log('  csv:', JSON.stringify(csv.slice(0, 120)));
  ok(csv.includes('Smith') && csv.includes('"1,250.50"'), 'the cells');
});

await test('batch: an action run on a PDF from the picker; the zip comes out through the save dialog', async () => {
  await openBytes(SAMPLE, 'Quarterly report.pdf');
  await pushDownload(fixture('word.pdf'), 'Batch one.pdf');
  await run('batch'); await page.waitForSelector('#dialog[open] .batch-acts');
  await page.click('#dialog .batch-act:has(strong:text-is("Make smaller")) [data-do="run"]');
  await page.waitForSelector('#dialog[open] #batchFileList');
  await pickThroughPicker(() => A.tapEl(page, '#batchFiles'), 'Batch one.pdf');
  await page.waitForFunction(() => document.querySelectorAll('#batchFileList li:not(.batch-empty)').length >= 1, null, { timeout: 20000 });
  const { name, bytes } = await saveThroughDialog(() => page.click('#dialog .dlg-foot .btn.primary'), 'batch');
  ok(/\.zip$/.test(name), name);
  const z = fflate.unzipSync(new Uint8Array(bytes));
  log('  in the zip:', Object.keys(z).join(', '));
  const first = Object.values(z)[0]; ok(first && (await L.PDFDocument.load(first)).getPageCount() >= 1, 'a PDF in the zip');
  await closeDialogs();
});

await test('split into files: one folder picked once, every part saved in it', async () => {
  await openBytes(SAMPLE, 'Quarterly report.pdf');
  sh(`mkdir -p '${A.DL}/Split parts'`); await sleep(1000);
  const listParts = () => sh(`ls -1 '${A.DL}/Split parts'`).split('\n').map((x) => x.trim()).filter((x) => x && !/No such file/.test(x));
  await run('pg60_split'); await page.waitForSelector('#dialog[open]');
  await page.check('#dialog input[name="how"][value="each"]').catch(() => {});
  await page.click('#dialog .dlg-foot .btn.primary');
  const end = Date.now() + 30000; while (Date.now() < end && !isDocs()) await sleep(700);
  ok(isDocs(), 'the folder picker is open');
  await sleep(1500); shot('split-folder');
  // (Android lets an app have a folder in Downloads, not Downloads itself)
  let dir = await A.waitUi(/^Split parts$/, 4000);
  if (!dir) { await toDownloads(); dir = await A.waitUi(/^Split parts$/, 8000); }
  ok(dir, 'the Split parts folder is listed'); sh(`input tap ${dir.x} ${dir.y}`); await sleep(2000);
  const use = await A.waitUi(/use this folder/i, 8000);
  ok(use, 'Use this folder'); sh(`input tap ${use.x} ${use.y}`); await sleep(1500);
  shot('split-allow');
  await A.tapUi(/^allow$/i, 8000);
  let all = []; const end2 = Date.now() + 30000;
  while (Date.now() < end2 && (all = listParts()).length < 3) await sleep(1000);
  log('  files in Split parts:', all.join(', '));
  eq(all.filter((n) => /part \d\)\.pdf$/.test(n)).length, 3, 'three parts');
  const part = adbBytes('exec-out', 'cat', `${A.DL}/Split parts/${all.sort()[0]}`);
  eq((await L.PDFDocument.load(part)).getPageCount(), 1, 'one page in a part');
  await page.waitForFunction(() => /Saved 3 files/.test(document.querySelector('#toast').textContent), null, { timeout: 10000 }).catch(() => {});
  log('  toast:', await toastText());
});

await test('print: the PDF goes to Android\'s print service (its preview opens)', async () => {
  await openBytes(SAMPLE, 'Quarterly report.pdf');
  await page.evaluate(() => { window.__cowdreyPdf.run('print'); });
  const end = Date.now() + 30000; while (Date.now() < end && !/printspooler|PrintActivity/i.test(A.focused())) await sleep(700);
  log('  focus:', A.focused());
  await sleep(4000); shot('print-preview');
  ok(/printspooler|PrintActivity/i.test(A.focused()), 'the print window');
  await backToApp();
});

await test('Share…: Android\'s share sheet opens; the document stays "Edited" (sharing is not saving)', async () => {
  await run('tool_rect'); const [x1, y1] = await at(0, 100, 150), [x2, y2] = await at(0, 200, 100); await A.swipeCss(page, x1, y1, x2, y2, 400); await run('tool_select');
  await page.evaluate(() => { window.__cowdreyPdf.run('share'); });
  const end = Date.now() + 20000; while (Date.now() < end && !/Chooser|ResolverActivity|intentresolver/i.test(A.focused())) await sleep(700);
  log('  focus:', A.focused());
  await sleep(1500); shot('share-sheet');
  ok(/Chooser|Resolver|intentresolver/i.test(A.focused()), 'the share sheet');
  await backToApp();
  ok(/Edited/.test(await saveState()), await saveState());
});

await test('read aloud: Android\'s text-to-speech reads the page, or the command is hidden when the phone has none', async () => {
  const tts = await page.evaluate(() => window.__TAURI__.core.invoke('plugin:sharekit|native', { method: 'ttsAvailable', args: {} }));
  log('  ', JSON.stringify(tts));
  await sleep(4500);
  const hidden = await page.evaluate(() => !window.__cowdreyPdf.ribbon || true);
  void hidden;
  if (!tts.available) {
    const shown = await page.evaluate(() => { const b = document.querySelector('[data-cmd="crdReadAloud"]'); return !!b; });
    ok(!shown, 'no speech engine: Read aloud is not offered');
    return;
  }
  await run('crdReadAloud'); await sleep(4000);
  const st = await page.evaluate(() => window.__cowdreyPdf.crdSayState());
  log('  ', JSON.stringify({ on: st.on, k: st.k, n: st.sents.length }));
  shot('read-aloud');
  ok(st.on, 'reading');
  await run('crdReadAloud');
});

await test('back: Back closes an open dialog and keeps the app; with nothing open it leaves the app', async () => {
  const p0 = A.pid();
  await run('about'); await page.waitForSelector('#dialog[open]');
  A.back(); await sleep(1200);
  ok(!(await page.$('#dialog[open]')), 'the dialog closed');
  eq(A.pid(), p0, 'the app is still running');
  ok(/cowdreypdf/.test(A.focused()), 'still in front');
});

await test('phone layout in dark mode: the ribbon scrolls sideways, nothing wider than the screen, bars clear of the system bars', async () => {
  const r = await page.evaluate(() => {
    const st = getComputedStyle(document.querySelector('.statusbar'));
    return { over: document.documentElement.scrollWidth - innerWidth, tabs: getComputedStyle(document.querySelector('#ribbonTabs')).overflowX, dark: document.documentElement.dataset.theme === 'dark' || (matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light'), media: matchMedia('(prefers-color-scheme: dark)').matches, bg: getComputedStyle(document.body).backgroundColor, sab: getComputedStyle(document.documentElement).getPropertyValue('--sab'), pad: st.paddingBottom, top: getComputedStyle(document.querySelector('.titlebar')).paddingTop };
  });
  const ins = await page.evaluate(() => window.__TAURI__.core.invoke('plugin:sharekit|native', { method: 'insets', args: {} }));
  log('  ', JSON.stringify(r), 'insets', JSON.stringify(ins));
  ok(r.over <= 1, 'no sideways scroll'); ok(r.dark, 'dark'); ok(/auto|scroll/.test(r.tabs), 'tabs scroll');
  ok(parseFloat(r.pad) >= (ins.bottom || 0), 'the bottom bar is above the navigation bar');
  for (const t of ['home', 'edit', 'forms', 'protect', 'export']) { await page.evaluate((t) => { const b = document.querySelector(`[data-rt="${t}"]`); if (b) b.click(); }, t); await sleep(400); }
  shot('phone-ribbon-dark');
  await page.evaluate(() => { const b = document.querySelector('[data-rt="home"]'); if (b) b.click(); });
});

await test('touch: long-press and drag a page thumbnail to move the page', async () => {
  await openBytes(SAMPLE, 'Quarterly report.pdf');
  await page.evaluate(() => { if (document.querySelector('#app').dataset.sidebar !== 'open') window.__cowdreyPdf.run('sidebar'); }); await sleep(800);
  await page.evaluate(() => { const b = document.querySelector('[data-side="thumbs"]'); if (b) b.click(); });
  await page.waitForSelector('.thumb[data-n="2"]', { timeout: 10000 }); await sleep(800); await watchFocus();
  const a = await page.locator('.thumb[data-n="0"]').boundingBox(), b = await page.locator('.thumb[data-n="2"]').boundingBox();
  const s = await A.screenOf(page);
  const [x1, y1] = s.at(a.x + a.width / 2, a.y + a.height / 2), [x2, y2] = s.at(b.x + b.width / 2, b.y + b.height * .7);
  sh(`input motionevent DOWN ${x1} ${y1}`); await sleep(900);
  for (let k = 1; k <= 8; k++) { sh(`input motionevent MOVE ${Math.round(x1 + (x2 - x1) * k / 8)} ${Math.round(y1 + (y2 - y1) * k / 8)}`); await sleep(80); }
  sh(`input motionevent UP ${x2} ${y2}`); await sleep(1200);
  const order = await page.evaluate(() => window.__cowdreyPdf.doc.pages.map((e) => e.i));
  log('  page order:', order.join(','));
  if (order[0] === 0) await focusLog();
  shot('thumb-moved');
  ok(order[0] !== 0, 'the first page moved');
  await page.evaluate(() => { if (document.querySelector('#app').dataset.sidebar === 'open') window.__cowdreyPdf.run('sidebar'); });
});

await test('comments: exported as XFDF through the save dialog, then imported into another copy through the picker', async () => {
  await openBytes(SAMPLE, 'Comments out.pdf');
  await run('tool_rect');
  const [x1, y1] = await at(0, 120, 400), [x2, y2] = await at(0, 300, 330);
  await A.swipeCss(page, x1, y1, x2, y2, 400); await run('tool_select');
  ok((await marks()).includes('rect'), 'a box to export');
  const { name, bytes } = await saveThroughDialog(() => run('cm_export'), 'xfdf');
  const xml = bytes.toString('utf8');
  log('  ', name, xml.length, 'bytes');
  ok(/\.xfdf$/i.test(name) && /<xfdf[\s>]/.test(xml) && /<square[\s>]/.test(xml), 'an XFDF file with the box');
  await openBytes(SAMPLE, 'Comments in.pdf');
  ok(!(await marks()).includes('rect'), 'the other copy has no box yet');
  await pickThroughPicker(() => run('cm_import'), name);
  await page.waitForFunction(() => /imported/.test(document.querySelector('#toast').textContent), null, { timeout: 20000 });
  log('  toast:', await toastText());
  ok((await marks()).includes('rect'), 'the box came in');
  shot('xfdf-imported');
});

await test('attachments: a file attached through the picker is kept in the saved PDF and saved back out through the save dialog', async () => {
  await openBytes(SAMPLE, 'Attach test.pdf');
  const NOTE = 'Notes from the phone: 3 pelicans, 2 herons.';
  const f = path.join(A.OUT, '.push-notes.txt'); fs.writeFileSync(f, NOTE); await pushDownload(f, 'Phone notes.txt'); fs.unlinkSync(f);
  await pickThroughPicker(() => run('vw_attach'), 'Phone notes.txt');
  await page.waitForFunction(() => /Attached/.test(document.querySelector('#toast').textContent), null, { timeout: 20000 });
  log('  toast:', await toastText());
  const pdfjs = await import(path.join(NM, 'pdfjs-dist/legacy/build/pdf.mjs'));
  const pd = await pdfjs.getDocument({ data: new Uint8Array(await built()), useSystemFonts: false }).promise, att = (await pd.getAttachments()) || {};
  const got = []; for (const [, a] of att instanceof Map ? att : Object.entries(att)) got.push([a.filename, Buffer.from(a.content).toString('utf8')]);
  log('  in the PDF:', JSON.stringify(got));
  ok(got.some(([n, t]) => n === 'Phone notes.txt' && t === NOTE), 'the file is in the PDF');
  await page.evaluate(() => { if (document.querySelector('#app').dataset.sidebar !== 'open') window.__cowdreyPdf.run('vw_files'); }); await sleep(800);
  shot('attachments-panel');
  const out = await saveThroughDialog(() => A.tapEl(page, '#sidePanel [aria-label="Save Phone notes.txt"]'), 'attachment');
  eq(out.bytes.toString('utf8'), NOTE, 'the file saved back out');
  await page.evaluate(() => { if (document.querySelector('#app').dataset.sidebar === 'open') window.__cowdreyPdf.run('sidebar'); });
});

await test('crop: a box dragged with a finger crops the page; the saved PDF has the smaller page', async () => {
  await openBytes(SAMPLE, 'Crop test.pdf');
  await run('tool_crop');
  const [x1, y1] = await at(0, 60, 740), [x2, y2] = await at(0, 552, 380);
  await A.swipeCss(page, x1, y1, x2, y2, 600);
  await page.waitForSelector('#dialog[open]', { timeout: 10000 });
  shot('crop-dialog');
  await answer('Crop'); await sleep(1200);
  const box = (await L.PDFDocument.load(await built())).getPage(0).getCropBox();
  log('  crop box:', JSON.stringify(box));
  ok(box.width < 560 && box.width > 400 && box.height < 420 && box.height > 300, 'the page is cropped to the box');
  await run('tool_select');
});

await test('signature: drawn with a finger and placed on the page; it is in the saved PDF', async () => {
  await openBytes(SAMPLE, 'Signature test.pdf');
  const before = (await marks()).length;
  await run('sign'); await page.waitForSelector('#dialog[open] #sigPad');
  const pad = await page.locator('#sigPad').boundingBox();
  await A.swipeCss(page, pad.x + pad.width * .1, pad.y + pad.height * .7, pad.x + pad.width * .5, pad.y + pad.height * .3, 400);
  await A.swipeCss(page, pad.x + pad.width * .5, pad.y + pad.height * .3, pad.x + pad.width * .9, pad.y + pad.height * .7, 400);
  shot('signature-drawn');
  await answer('Place'); await sleep(800);
  const [sx, sy] = await at(0, 360, 160); await A.tapCss(page, sx, sy); await sleep(1200);
  const after = await marks();
  log('  marks:', after.join(', '));
  ok(after.length > before, 'the signature is on the page');
  ok(after.includes('img'), 'placed as a picture');
  const pics = async (b) => { const d = await L.PDFDocument.load(b); const r = d.getPage(0).node.Resources(); const x = r && r.lookup(L.PDFName.of('XObject')); return x ? x.keys().length : 0; };
  const [was, now] = [await pics(SAMPLE), await pics(await built())];
  log('  pictures on page 1:', was, '→', now);
  ok(now > was, 'the signature is a picture on the page in the saved PDF');
  shot('signature-placed');
  await run('tool_select');
});

await test('memory: the app\'s memory after all of the above', async () => {
  const m = sh(`dumpsys meminfo ${PKG} | grep -E "TOTAL PSS|TOTAL:" | head -2`).trim();
  log('  ', m.replace(/\s+/g, ' '));
  const kb = +((m.match(/TOTAL(?: PSS)?:?\s+(\d+)/) || [])[1] || 0);
  ok(A.pid(), 'still running');
  ok(!kb || kb < 1500000, `under 1.5 GB (${kb} KB)`);
});

await test('an edit made just before the app goes to the background and is closed by Android is kept', async () => {
  await openBytes(SAMPLE, 'Kept edit.pdf');
  await run('tool_rect');
  const [x1, y1] = await at(0, 330, 520), [x2, y2] = await at(0, 500, 450);
  await A.swipeCss(page, x1, y1, x2, y2, 300);
  const n = (await marks()).filter((m) => m === 'rect').length;
  // Home at once (inside the app's short wait before it keeps a change), then Android closes the app
  sh('input keyevent KEYCODE_HOME'); await sleep(1500);
  sh(`am kill ${PKG}`); await sleep(500); sh(`am force-stop ${PKG}`); await sleep(1500);
  ok(!A.pid(), 'the app was closed');
  sh(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  page = await A.connect(90000);
  await page.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 45000 });
  eq(await title(), 'Kept edit', 'the document');
  const m = (await marks()).filter((x) => x === 'rect').length;
  log('  boxes before:', n, 'after:', m);
  eq(m, n, 'the box drawn just before is still there');
  shot('kept-after-kill');
});

await test('relaunch: the library (IndexedDB) and the last document come back after the app is closed', async () => {
  const before = await page.evaluate(() => document.querySelector('#docTitle').textContent);
  sh(`am force-stop ${PKG}`); await sleep(1500);
  sh(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  page = await A.connect(90000);
  await page.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 45000 });
  eq(await title(), before, 'the last document');
  await page.evaluate(() => { const b = document.querySelector('[data-side="docs"]'); if (b) b.click(); });
  await run('sidebar');
  const n = await page.evaluate(() => document.querySelectorAll('.doc-item').length);
  log('  documents in Recent:', n);
  ok(n >= 3, 'Recent kept');
  shot('relaunch-library');
});

await test('light mode: the app follows the system theme', async () => {
  const dark = () => page.evaluate(() => ({ theme: document.documentElement.dataset.theme || '', media: matchMedia('(prefers-color-scheme: dark)').matches, bg: getComputedStyle(document.body).backgroundColor }));
  sh('cmd uimode night no'); await sleep(2500);
  const l = await dark(); log('  light:', JSON.stringify(l));
  shot('light-mode');
  sh('cmd uimode night yes'); await sleep(2500);
  const d = await dark(); log('  dark again:', JSON.stringify(d));
  ok(l.theme !== 'dark' && !(l.media && l.theme !== 'light'), 'light');
  ok(d.theme === 'dark' || (d.media && d.theme !== 'light'), 'dark again');
});

const { summary, head } = writeResults(true);
log(`\n${summary}\n\n${head}: ${results.filter((r) => r[0]).length}/${results.length}`);
process.exit(0);
