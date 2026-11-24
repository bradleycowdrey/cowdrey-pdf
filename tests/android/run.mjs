// Device test for the Android app: runs on an emulator in CI (.github/workflows/android-app.yml), on the test build
// (a debug build whose web view the test drives through the Chrome DevTools protocol). Android's own windows (the save
// dialog, the file picker, print, the share sheet) are driven with adb and uiautomator, and what the app saved is
// pulled off the device and checked here with pdf-lib, asn1js and Node's crypto.
// Usage: node tests/android/run.mjs <test apk> <output dir>
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { createRequire } from 'node:module'; import { spawn } from 'node:child_process';
import * as A from './lib.mjs';
import { startPki } from './pki.mjs';
const { adb, adbBytes, sh, log, shot, sleep, PKG, root, isDocs, toDownloads, saveThroughDialog } = A;
const inDownloadsHere = A.inDownloads;
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
// A phone with little memory (the second emulator: 2 GB): the long OCR scenario runs there.
const LOWRAM = process.env.LOWRAM === '1';
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

/* ---- the network ---- */
// Off (Wi-Fi and mobile data), for the scenarios that check what the app does with no network
async function netOff() { sh('svc wifi disable'); sh('svc data disable'); await sleep(3000); }
async function netOn() {
  sh('svc wifi enable'); sh('svc data enable');
  for (let i = 0; i < 20 && !/1 received|1 packets received/.test(sh('ping -c 1 -W 2 8.8.8.8')); i++) await sleep(1500);
}
// The web view can reach the internet (a scenario that needs it fails as "no network", not as something else)
async function ensureNetwork() {
  let net = null;
  for (let i = 0; i < 24 && !(net && net.ok); i++) {
    if (i) await sleep(5000);
    if (i === 8 || i === 16) { // the emulator's radio, started again (it can stay down after a scenario turned it off)
      log('  network:', (sh('dumpsys connectivity | grep -m1 "Active default network"') || '').trim(), '- airplane mode on and off');
      adb('emu', 'gsm', 'voice', 'home'); adb('emu', 'gsm', 'data', 'home');
      sh('cmd connectivity airplane-mode enable'); await sleep(3000); sh('cmd connectivity airplane-mode disable'); sh('svc wifi enable'); sh('svc data enable'); await sleep(2000);
      sh('cmd wifi connect-network AndroidWifi open'); await sleep(5000);
    }
    net = await page.evaluate(async () => { try { await fetch('https://www.gstatic.com/generate_204', { mode: 'no-cors', cache: 'no-store' }); return { ok: true }; } catch (e) { return { err: String(e) }; } });
  }
  log('  network:', net.ok ? 'up' : net.err);
  ok(net.ok, 'no network on the emulator: ' + net.err);
}
// The keyboard is down (it can take a moment after the app comes back to the front)
async function keyboardDown(timeout = 8000) {
  let st = '';
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(500)) { st = sh('dumpsys input_method | grep -m1 mInputShown').trim(); if (/mInputShown=false/.test(st)) return true; }
  log('  keyboard:', st); return false;
}

/* ---- Android's own windows ---- */
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
// The files embedded in a PDF (its EmbeddedFiles name tree), read with pdf-lib: [[name, text]]
async function embeddedFiles(bytes) {
  const d = await L.PDFDocument.load(bytes), out = [];
  const names = d.catalog.lookupMaybe(L.PDFName.of('Names'), L.PDFDict), tree = names && names.lookupMaybe(L.PDFName.of('EmbeddedFiles'), L.PDFDict);
  const walk = (node) => {
    const kids = node.lookupMaybe(L.PDFName.of('Kids'), L.PDFArray); if (kids) for (let i = 0; i < kids.size(); i++) walk(kids.lookup(i, L.PDFDict));
    const arr = node.lookupMaybe(L.PDFName.of('Names'), L.PDFArray); if (!arr) return;
    for (let i = 0; i + 1 < arr.size(); i += 2) {
      const spec = arr.lookup(i + 1, L.PDFDict), ef = spec.lookupMaybe(L.PDFName.of('EF'), L.PDFDict), st = ef && ef.lookup(L.PDFName.of('F'));
      const fname = spec.lookup(L.PDFName.of('UF')) || spec.lookup(L.PDFName.of('F')) || arr.lookup(i);
      out.push([fname.decodeText(), st ? Buffer.from(L.decodePDFRawStream(st).decode()).toString('utf8') : null]);
    }
  };
  if (tree) walk(tree);
  return out;
}
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
// The RFC 3161 timestamp token in a signature (its unsigned attribute id-aa-timeStampToken), read with asn1js: the
// time it gives and whether its message imprint is the hash of this signature's value (as RFC 3161 and PAdES ask).
function nodeTimestamp(buf, [, b, c]) {
  const der = Buffer.from(buf.subarray(b + 1, c - 1).toString('latin1'), 'hex');
  const ci = asn1js.fromBER(new Uint8Array(der).buffer).result;
  const parts = ci.valueBlock.value[1].valueBlock.value[0].valueBlock.value;
  const sp = parts[parts.length - 1].valueBlock.value[0].valueBlock.value;
  const sig = Buffer.from(sp.find((x, k) => k > 3 && x.idBlock.tagClass === 1 && x.idBlock.tagNumber === 4).valueBlock.valueHexView);
  const ua = sp.find((x) => x.idBlock.tagClass === 3 && x.idBlock.tagNumber === 1);
  const attr = ua && ua.valueBlock.value.find((x) => x.valueBlock.value[0].valueBlock.toString() === '1.2.840.113549.1.9.16.2.14');
  if (!attr) return { token: false };
  const token = attr.valueBlock.value[1].valueBlock.value[0];
  const sd = token.valueBlock.value[1].valueBlock.value[0].valueBlock.value;
  const eci = sd.find((x) => x.idBlock.tagClass === 1 && x.idBlock.tagNumber === 16 && x.valueBlock.value[0] && x.valueBlock.value[0].idBlock.tagNumber === 6);
  const os = eci.valueBlock.value[1].valueBlock.value[0];
  const tstDer = os.idBlock.isConstructed ? Buffer.concat(os.valueBlock.value.map((x) => Buffer.from(x.valueBlock.valueHexView))) : Buffer.from(os.valueBlock.valueHexView);
  const tst = asn1js.fromBER(new Uint8Array(tstDer).buffer).result.valueBlock.value;
  const mi = tst[2].valueBlock.value, alg = mi[0].valueBlock.value[0].valueBlock.toString();
  const hash = { '2.16.840.1.101.3.4.2.1': 'sha256', '2.16.840.1.101.3.4.2.2': 'sha384', '2.16.840.1.101.3.4.2.3': 'sha512', '1.3.14.3.2.26': 'sha1' }[alg];
  const imprint = Buffer.from(mi[1].valueBlock.valueHexView);
  return { token: true, eContentType: eci.valueBlock.value[0].valueBlock.toString(), hash: hash || alg, imprintOk: !!hash && crypto.createHash(hash).update(sig).digest().equals(imprint), genTime: tst[4].toDate().toISOString() };
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

// A large PDF: page 1 has a picture of random pixels (it can't be compressed), so the file is about `mb` MB.
async function bigPdf(mb) {
  const d = await L.PDFDocument.create(), f = await d.embedFont(L.StandardFonts.Helvetica);
  const W = 2000, H = Math.ceil(mb * 1048576 / (W * 3)), px = crypto.randomBytes(W * H * 3);
  const img = d.context.register(d.context.stream(px, { Type: 'XObject', Subtype: 'Image', Width: W, Height: H, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }));
  const p1 = d.addPage([612, 792]);
  p1.drawText('Big scan, page 1', { x: 72, y: 740, size: 18, font: f });
  const nm = p1.node.newXObject('BigPic', img);
  p1.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(500, 0, 0, Math.round(500 * H / W), 56, 80), L.drawObject(nm), L.popGraphicsState());
  d.addPage([612, 792]).drawText('Big scan, page 2', { x: 72, y: 740, size: 18, font: f });
  return { bytes: Buffer.from(await d.save({ useObjectStreams: false })), sha: crypto.createHash('sha256').update(px).digest('hex') };
}
// The sha256 of the pixels of the large picture on page 1 of a saved PDF
function imageSha(d) {
  const xo = d.getPage(0).node.Resources().lookup(L.PDFName.of('XObject'));
  for (const k of xo ? xo.keys() : []) {
    const st = xo.lookup(k);
    if (!(st instanceof L.PDFRawStream) || String(st.dict.get(L.PDFName.of('Subtype'))) !== '/Image') continue;
    const raw = st.dict.get(L.PDFName.of('Filter')) ? L.decodePDFRawStream(st).decode() : st.contents;
    return crypto.createHash('sha256').update(Buffer.from(raw)).digest('hex');
  }
  return null;
}
// A scanned PDF: each page a picture of its lines of text (drawn by the web view, 150 dpi)
async function scanPdf(pages) {
  const pngs = await page.evaluate((pages) => pages.map((lines) => {
    const c = document.createElement('canvas'); c.width = 1275; c.height = 1650; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#111'; x.font = 'bold 44px sans-serif';
    lines.forEach((l, k) => x.fillText(l, 120, 240 + k * 100));
    return c.toDataURL('image/png').split(',')[1];
  }), pages);
  const d = await L.PDFDocument.create();
  for (const b of pngs) { const img = await d.embedPng(Buffer.from(b, 'base64')); d.addPage([612, 792]).drawImage(img, { x: 0, y: 0, width: 612, height: 792 }); }
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

await test('forms: Save PDF tapped while typing in a field (keyboard up), on a PDF opened from Android: the save dialog, the value saved', async () => {
  // as tests/android/release.mjs does it on the release APK: opened with a VIEW intent, typed with the keyboard, then
  // Save PDF tapped with the keyboard still up
  const c = await contentUri(fixture('sample.pdf'), 'Typing save.pdf');
  log('  am start:', startView(c).slice(0, 160));
  await page.waitForFunction(() => document.querySelector('#docTitle').textContent === 'Typing save', null, { timeout: 30000 });
  await page.waitForSelector('.annotationLayer input[name="name"]', { timeout: 20000 }); await sleep(1500);
  await run('tool_select');
  // every call to the native side, and what the save does, for when no dialog comes
  await page.evaluate(() => {
    window.__inv = []; const core = window.__TAURI__.core, inv = core.invoke.bind(core);
    if (!core.__wrapped) { core.__wrapped = true; core.invoke = (c, a) => { window.__inv.push(c + (a && a.method ? ':' + a.method : '')); return inv(c, a); }; }
    window.__clicks = []; const t0 = performance.now();
    for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'focusout']) document.addEventListener(t, (e) => window.__clicks.push(`${Math.round(performance.now() - t0)} ${t} ${(e.target.closest && e.target.closest('button') || e.target).id || e.target.tagName}`), true);
  });
  for (let i = 0; i < 3; i++) {
    await A.tapEl(page, '.annotationLayer input[name="name"]');
    if (await page.waitForFunction(() => document.activeElement && document.activeElement.name === 'name', null, { timeout: 6000 }).catch(() => null)) break;
  }
  await sleep(1500);
  sh(`input text 'Typed%sthen%ssaved'`); await sleep(1500);
  eq(await page.inputValue('.annotationLayer input[name="name"]'), 'Typed then saved', 'typed');
  log('  keyboard before Save:', sh('dumpsys input_method | grep -m1 mInputShown').trim());
  const before = A.listDownloads();
  const s0 = await A.screenOf(page), r = await page.locator('#saveBtn').boundingBox(), [x, y] = s0.at(r.x + r.width / 2, r.y + r.height / 2);
  sh(`input tap ${x} ${y}`);
  for (let end = Date.now() + 20000; Date.now() < end && !isDocs(); ) await sleep(700);
  if (!isDocs()) {
    const st = await page.evaluate(() => ({ calls: window.__inv, clicks: window.__clicks, toast: document.querySelector('#toast').textContent, state: document.querySelector('#saveState').textContent, active: document.activeElement && (document.activeElement.id || document.activeElement.tagName) }));
    log('  no save dialog:', JSON.stringify(st));
    const sig = await withLimit(page.evaluate(() => window.__cowdreyPdf.sgSignatures().then((x) => 'checked ' + x.length)), 5000).catch((e) => 'signature check: ' + e.message);
    const b = await withLimit(page.evaluate(() => window.__cowdreyPdf.buildPdf().then((x) => 'built ' + (x && x.length))), 15000).catch((e) => 'build: ' + e.message);
    log('  ', sig, '·', b);
    shot('typing-save-none');
    throw new Error('no save dialog after tapping Save PDF while typing: ' + JSON.stringify(st));
  }
  await sleep(1500); await inDownloadsHere();
  shot('typing-save-dialog');
  const save = await A.waitUi(/^save$/i, 10000); ok(save, 'a Save button'); sh(`input tap ${save.x} ${save.y}`);
  const got = await A.waitNewDownload(before, 30000); ok(got.length, 'a new file in Downloads');
  const bytes = A.pullDownload(got[got.length - 1]);
  eq((await L.PDFDocument.load(bytes)).getForm().getTextField('name').getText(), 'Typed then saved', 'the typed value is in the saved file');
  // back in the app after saving: the typing is over, so the keyboard is down
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#saveState').textContent), null, { timeout: 20000 });
  await sleep(1500);
  const down = await keyboardDown();
  const active = await page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName}${a.name ? '[' + a.name + ']' : ''}` : ''; });
  log('  after saving: keyboard', down ? 'down' : 'still up', '· focus', active);
  shot('typing-saved-keyboard-down');
  ok(down, 'the keyboard went down after Save PDF');
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
  await netOff();
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
  } finally { await netOn(); }
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

await test('timestamps: a timestamp server typed in Signing IDs; the signature saved with its timestamp from it (Android\'s network and certificate authorities)', async () => {
  // The network first (the OCR scenario turned it off and on again): with none, this fails as "no network", not as
  // a timestamp failure.
  await ensureNetwork();
  await openBytes(SAMPLE, 'Timestamped.pdf');
  // A public timestamp server can be slow or down: any one of three answering is enough.
  let done = null;
  for (const url of ['https://freetsa.org/tsr', 'https://timestamp.sectigo.com', 'https://timestamp.digicert.com']) {
    // typed with the on-screen keyboard into Signing IDs' Timestamp server field, kept when the dialog closes
    await run('sgIds'); await page.waitForSelector('#dialog[open] #sgTsa');
    await A.tapEl(page, '#sgTsa'); await page.evaluate(() => document.querySelector('#sgTsa').select());
    sh(`input text '${url}'`); await sleep(800);
    eq(await page.inputValue('#sgTsa'), url, 'typed');
    if (/mInputShown=true/.test(sh('dumpsys input_method | grep -m1 mInputShown'))) { A.back(); await sleep(800); }
    shot('timestamp-server');
    await A.tapEl(page, '#dialog .dlg-foot .btn.primary');
    await page.waitForFunction(() => !document.querySelector('#dialog').open, null, { timeout: 10000 });
    try {
      const host = new URL(url).host;
      done = await saveThroughDialog(async () => {
        await run('sgSign'); await page.waitForSelector('#dialog[open] #sgPlace');
        const ts = await page.evaluate(() => { const c = document.querySelector('#sgTs'); return c ? [c.checked, c.parentElement.textContent.trim()] : null; });
        log('  sign dialog:', JSON.stringify(ts));
        ok(ts && ts[0] && ts[1].includes(host), 'Add a timestamp from ' + host + ', ticked');
        if (await page.$('#sgPw:visible')) await page.fill('#sgPw', 'pw1234');
        await page.selectOption('#sgPlace', 'draw'); await page.selectOption('#sgLook', 'text');
        shot('sign-with-timestamp');
        await page.click('#dialog .dlg-foot .btn.primary');
        await page.waitForFunction(() => document.querySelector('#app').dataset.tool === 'sgbox');
        const [x1, y1] = await at(0, 320, 200), [x2, y2] = await at(0, 540, 140);
        await A.swipeCss(page, x1, y1, x2, y2, 500);
      }, 'timestamp');
      log('  signed with a timestamp from', url);
      break;
    } catch (e) {
      const why = await page.evaluate(() => { const d = document.querySelector('#dialog'); return d && d.open ? d.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) : document.querySelector('#toast').textContent; }).catch(() => '');
      log('  ', url, 'did not give a signed PDF:', e.message, '|', why);
      await backToApp(); await closeDialogs();
    }
  }
  ok(done, 'a PDF signed with a timestamp from one of the servers');
  const r = ranges(done.bytes); ok(r.length === 1, 'one signature');
  const v = nodeVerify(done.bytes, r[0]), t = nodeTimestamp(done.bytes, r[0]);
  log('  signature:', JSON.stringify(v), 'timestamp:', JSON.stringify(t));
  ok(v.digestOk && v.sigOk, 'the signature verifies');
  ok(t.token && t.eContentType === '1.2.840.113549.1.9.16.1.4' && t.imprintOk, 'the timestamp token is in the signature and is for its value');
  ok(Math.abs(Date.parse(t.genTime) - Date.now()) < 3600000, 'the timestamp is from now: ' + t.genTime);
  // and the app itself, opening the saved file, shows the timestamp as good
  await openBytes(done.bytes, 'Timestamped check.pdf');
  const sigs = await page.evaluate(() => window.__cowdreyPdf.sgSignatures());
  log('  the app reads:', JSON.stringify(sigs.map((x) => ({ status: x.status, ts: x.ts }))));
  ok(sigs.length === 1 && sigs[0].ts && sigs[0].ts.ok, 'the app checks the timestamp');
  shot('timestamped');
});

await test('revocation: OCSP and CRL servers on plain http (on the machine running the emulator); not revoked, then revoked, asked again each time (Android\'s own network, not the web view)', async () => {
  // A certificate authority of the test's own: its OCSP responder (openssl ocsp) and its revocation list (a tiny http
  // server), reached from the emulator at 10.0.2.2. The release app allows no cleartext traffic: these requests are
  // plain http all the same, made by the app's pkiFetch on Android's side (docs/android.md).
  const pki = await startPki(path.join(A.OUT, '.pki-' + Date.now()), '10.0.2.2');
  try {
    log('  OCSP responder', pki.ocsp, '· revocation list', pki.crl);
    log('  10.0.2.2 from the emulator:', (sh('ping -c 1 -W 3 10.0.2.2') || '').split('\n')[1] || '(no answer to ping)');
    await openBytes(SAMPLE, 'Revocation.pdf');
    const id = await page.evaluate(async ([b, pw]) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return window.__cowdreyPdf.sgImportId(u, pw); }, [pki.p12.toString('base64'), pki.password]);
    log('  signing ID:', JSON.stringify(id));
    eq(id.chain, 3, 'the signing ID has its chain');
    const { bytes } = await saveThroughDialog(async () => {
      await run('sgSign'); await page.waitForSelector('#dialog[open] #sgPlace');
      await page.selectOption('#sgId', id.id);
      if (await page.$('#sgPw:visible')) await page.fill('#sgPw', pki.password);
      // (no timestamp: this scenario asks only the servers made here)
      if (await page.$('#sgTs:checked')) await page.click('#sgTs');
      await page.selectOption('#sgPlace', 'draw'); await page.selectOption('#sgLook', 'text');
      await page.click('#dialog .dlg-foot .btn.primary');
      await page.waitForFunction(() => document.querySelector('#app').dataset.tool === 'sgbox');
      const [x1, y1] = await at(0, 320, 200), [x2, y2] = await at(0, 540, 140);
      await A.swipeCss(page, x1, y1, x2, y2, 500);
    }, 'revocation');
    const r = ranges(bytes); ok(r.length === 1, 'one signature');
    const v = nodeVerify(bytes, r[0]); log('  ', JSON.stringify(v));
    ok(v.digestOk && v.sigOk && /Device Test Signer/.test(v.signer), 'the signature verifies');
    eq([pki.ocspHits(), pki.crlHits()], [0, 0], 'nothing asked before the person asks');
    await openBytes(bytes, 'Revocation check.pdf');
    await run('sgPanel'); await page.waitForSelector('#dialog[open] [data-sg-rev]');
    const listText = () => page.evaluate(() => (document.querySelector('#dialog .sg-list') || document.querySelector('#dialog')).textContent.replace(/\s+/g, ' '));
    // the panel's own button, tapped, then its answer
    const check = async (re, label) => {
      await A.tapEl(page, '#dialog [data-sg-rev]');
      try { await page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#dialog .sg-list').textContent), re.source, { timeout: 60000 }); }
      catch (e) { log('  the panel says:', (await listText()).slice(0, 600)); throw e; }
      const m = (await listText()).match(/(Not revoked|Revoked|Not checked): [^\n]*?\(\w+ from [^)]*\)/); log(`  ${label}:`, m ? m[0] : '');
      // (the screen a moment later: the panel has drawn its answer, not "Checking…")
      await page.waitForFunction(() => !/Checking…/.test(document.querySelector('#dialog').textContent), null, { timeout: 10000 }).catch(() => {});
      await sleep(1000); shot('revocation-' + label);
    };
    await check(/Not revoked: “Device Test Signer” \(OCSP from 10\.0\.2\.2:\d+\)/, 'not-revoked');
    eq(pki.ocspHits(), 1, 'one OCSP request');
    await pki.revoke();
    log('  the signer\'s certificate is revoked now');
    await check(/Revoked: “Device Test Signer” was revoked .*key compromise.*\(OCSP from 10\.0\.2\.2:\d+\)/, 'revoked-ocsp');
    eq(pki.ocspHits(), 2, 'asked again, not an answer kept from before');
    // with the OCSP responder gone, the revocation list (a GET) is asked instead
    await pki.stopOcsp();
    await check(/Revoked: “Device Test Signer” was revoked .*\(CRL from 10\.0\.2\.2:\d+\)/, 'revoked-crl');
    eq(pki.crlHits(), 1, 'the revocation list was fetched');
    const sigs = await page.evaluate(() => window.__cowdreyPdf.sgSignatures());
    log('  the app reads:', JSON.stringify(sigs.map((x) => ({ status: x.status, rev: x.rev && x.rev.verdict }))));
    eq(sigs.map((x) => x.status), ['revoked']);
    await answer('Close').catch(() => {});
  } finally { await pki.close(); }
}, 420000);

await test('signing IDs: a .pfx imported through the picker; an ID saved as .p12 through the save dialog opens with its password', async () => {
  await pushBytes(makeP12('PFX Signer', 'pw5678'), 'Second signer.pfx');
  await run('sgIds'); await page.waitForSelector('#dialog[open] #sgImport');
  await pickThroughPicker(() => A.tapEl(page, '#sgImport'), 'Second signer.pfx');
  await page.waitForSelector('#dialog[open] #dlgInput', { timeout: 20000 });
  await page.fill('#dlgInput', 'pw5678'); await page.click('#dialog .dlg-foot .btn.primary');
  await page.waitForFunction(() => /Signing ID for PFX Signer added/.test(document.querySelector('#toast').textContent), null, { timeout: 30000 });
  await page.waitForSelector('#dialog[open] #sgImport', { timeout: 20000 });
  ok(/PFX Signer/.test(await page.textContent('#dialog #sgIdList')), 'the .pfx ID is listed');
  const id = (name) => page.evaluate((n) => { const r = [...document.querySelectorAll('#dialog .sg-id')].find((x) => x.querySelector('strong') && x.querySelector('strong').textContent === n); return r && r.dataset.sgId; }, name);
  const androidId = await id('Android Signer'); ok(androidId, 'the Android Signer ID is listed');
  const { name, bytes } = await saveThroughDialog(() => A.tapEl(page, `#dialog [data-sg-export="${androidId}"]`), 'p12-export');
  ok(/\.p12$/.test(name), name);
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(bytes.toString('binary')), 'pw1234');
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []).map((b) => b.cert.subject.getField('CN').value);
  const keys = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []).length;
  log('  saved', name, bytes.length, 'bytes · certificates', certs.join(', '), '· keys', keys);
  ok(certs.includes('Android Signer') && keys === 1, 'the saved .p12 has the certificate and its key');
  // the .pfx ID goes again, so the other scenarios sign with the one they expect
  await backToApp(); await page.waitForSelector('#dialog[open] #sgImport', { timeout: 10000 });
  const pfxId = await id('PFX Signer'); if (pfxId) await A.tapEl(page, `#dialog [data-sg-del="${pfxId}"]`);
  await sleep(800); shot('signing-ids-p12');
  await answer('Close');
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

await test('compare: the other PDF from the picker; the changes are found; the compare report saved through the save dialog', async () => {
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
  // the compare report: a PDF with a cover page and the changes as comments, through the save dialog
  const rep = await saveThroughDialog(async () => { await A.tapEl(page, '#cmpView [data-c="report"]'); await answer('Save report'); }, 'compare-report');
  ok(/compared\.pdf$/.test(rep.name), rep.name);
  const rd = await L.PDFDocument.load(rep.bytes, { updateMetadata: false });
  const notes = rd.getPages().slice(1).flatMap((pg) => (pg.node.Annots() ? pg.node.Annots().asArray() : []));
  log('  report:', rd.getPageCount(), 'pages,', notes.length, 'comments');
  ok(rd.getPageCount() >= 2 && notes.length >= 2, 'a cover page and the changes as comments');
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
  const got = await embeddedFiles(await built());
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

await test('large file: a 12 MB PDF opened from Android and saved back through the save dialog in parts of 4 MB; Save again updates the same file', async () => {
  const big = await bigPdf(12);
  log('  the PDF:', big.bytes.length, 'bytes');
  const f = path.join(A.OUT, '.push-big.pdf'); fs.writeFileSync(f, big.bytes);
  const c = await contentUri(f, 'Big scan.pdf'); fs.unlinkSync(f);
  const t0 = Date.now();
  log('  am start:', startView(c).slice(0, 160));
  await page.waitForFunction(() => document.querySelector('#docTitle').textContent === 'Big scan', null, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('.page[data-n="0"] canvas.pdf'), null, { timeout: 60000 });
  log('  opened in', ((Date.now() - t0) / 1000).toFixed(1), 's ·', await page.evaluate(() => window.__cowdreyPdf.doc.pages.length), 'pages');
  shot('large-file-open');
  await run('tool_rect'); const [x1, y1] = await at(0, 100, 760), [x2, y2] = await at(0, 250, 720); await A.swipeCss(page, x1, y1, x2, y2, 400); await run('tool_select');
  const t1 = Date.now();
  // The copy the app writes in its cache for Android's save dialog, watched as it grows (run-as: the test build is
  // debuggable): it arrives in parts of 4 MB, so its size steps through 4 and 8 MB before the whole file.
  // (a loop on the device itself, every 50 ms: from here, one adb call can take longer than a part)
  const sizes = new Set();
  const watcher = spawn('adb', ['shell', `run-as ${PKG} sh -c 'for i in $(seq 1 1200); do stat -c %s "cache/outgoing/Big scan.pdf" 2>/dev/null; sleep 0.05; done'`]);
  watcher.stdout.on('data', (d) => { for (const x of String(d).split(/\s+/)) if (/^\d+$/.test(x)) sizes.add(+x); });
  let saved;
  try {
    saved = await saveThroughDialog(async () => {
      await A.tapEl(page, '#saveBtn');
      for (const end = Date.now() + 60000; Date.now() < end && !isDocs(); ) await sleep(300);
    }, 'large-file');
  } finally { watcher.kill(); }
  const { name, bytes } = saved;
  const seen = [...sizes].sort((a, b) => a - b);
  log('  saved', name, bytes.length, 'bytes in', ((Date.now() - t1) / 1000).toFixed(1), 's · sizes of the copy in the cache as it was written:', seen.join(', '));
  ok(seen.includes(4 << 20) && seen.includes(8 << 20) && seen.every((x) => x % (4 << 20) === 0 || x === bytes.length), 'handed to Android in parts of 4 MB');
  const check = async (b) => { const d = await L.PDFDocument.load(b, { updateMetadata: false }); const sha = imageSha(d); const subs = (d.getPage(0).node.Annots() ? d.getPage(0).node.Annots().asArray() : []).map((r) => String(d.context.lookup(r).get(L.PDFName.of('Subtype')))); return { pages: d.getPageCount(), sha, subs }; };
  let r = await check(bytes);
  log('  ', JSON.stringify({ pages: r.pages, imageIntact: r.sha === big.sha, comments: r.subs }));
  ok(r.pages === 2 && r.sha === big.sha && r.subs.includes('/Square'), 'the whole picture and the box are in the saved file');
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#saveState').textContent), null, { timeout: 20000 });
  // Save again: no dialog, the same file
  await run('tool_rect'); const [a1, b1] = await at(0, 300, 760), [a2, b2] = await at(0, 450, 720); await A.swipeCss(page, a1, b1, a2, b2, 400); await run('tool_select');
  const before = A.listDownloads();
  await A.tapEl(page, '#saveBtn');
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#saveState').textContent), null, { timeout: 60000 });
  ok(!isDocs(), 'no dialog the second time'); eq(A.listDownloads(), before, 'no new file');
  r = await check(A.pullDownload(name));
  log('  saved again:', JSON.stringify({ pages: r.pages, imageIntact: r.sha === big.sha, comments: r.subs }));
  ok(r.sha === big.sha && r.subs.filter((x) => x === '/Square').length === 2, 'the same file, with both boxes and the whole picture');
  log('  memory:', sh(`dumpsys meminfo ${PKG} | grep -E "TOTAL PSS|TOTAL:" | head -1`).trim().replace(/\s+/g, ' '));
}, 600000);

await test('export: the text (.txt) and the page as a picture (.png) through the save dialog', async () => {
  await openBytes(SAMPLE, 'Quarterly report.pdf');
  const t = await saveThroughDialog(() => run('exportText'), 'export-text');
  const txt = t.bytes.toString('utf8');
  log('  ', t.name, JSON.stringify(txt.slice(0, 100)));
  ok(/\.txt$/.test(t.name) && /Cowdrey\.PDF/.test(txt) && /pelican/i.test(txt), 'the text of the PDF');
  const p = await saveThroughDialog(() => run('exportImage'), 'export-png');
  const sig = p.bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), w = p.bytes.readUInt32BE(16), h = p.bytes.readUInt32BE(20);
  log('  ', p.name, p.bytes.length, 'bytes', w + 'x' + h);
  ok(/\.png$/.test(p.name) && sig && w >= 1000 && h >= 1000, 'a PNG of the page');
});

await test('form data: an FDF file picked in Android\'s picker fills the form', async () => {
  await openBytes(SAMPLE, 'Quarterly report.pdf');
  await pushBytes(Buffer.from('%FDF-1.2\n1 0 obj\n<< /FDF << /Fields [ << /T (name) /V (Filled from FDF) >> ] >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'), 'Form data.fdf');
  await pickThroughPicker(() => run('ffd_importData'), 'Form data.fdf');
  await page.waitForFunction(() => /filled in|not a form data|No fields/.test(document.querySelector('#toast').textContent), null, { timeout: 20000 });
  log('  toast:', await toastText());
  eq((await L.PDFDocument.load(await built())).getForm().getTextField('name').getText(), 'Filled from FDF', 'the field');
});

await test('pictures: a HEIC photo picked in Android\'s photo picker becomes a PDF (Android decodes it)', async () => {
  // the photo picker shows every picture on the phone, newest first: the other pictures go, so the photo is the one
  log('  pictures removed:', sh(`content delete --uri content://media/external/images/media --where "mime_type!='image/heic'" 2>&1; rm -f ${A.DL}/*.png ${A.DL}/*.jpg`).trim() || 'ok');
  await pushDownload(fixture('photo.heic'), 'Photo.heic');
  const before = await title();
  await run('crdNewPictures');
  const isPhotos = () => /photopicker|PhotoPicker/.test(A.focused());
  for (const end = Date.now() + 30000; Date.now() < end && !isDocs() && !isPhotos(); ) await sleep(700);
  log('  picker:', A.focused().split('\n')[0].trim());
  await sleep(2000);
  if (isDocs()) {
    let n = await A.waitUi(/^Photo\.heic$/, 5000); if (!n) { await toDownloads(); n = await A.waitUi(/^Photo\.heic$/, 8000); }
    ok(n, 'Photo.heic is listed'); shot('picker-heic'); sh(`input tap ${n.x} ${n.y}`); await sleep(1500);
    const sel = await A.waitUi(/^(select|open|done)$/i, 3000); if (sel) { sh(`input tap ${sel.x} ${sel.y}`); await sleep(1500); }
  } else {
    ok(isPhotos(), 'Android\'s photo picker or file picker opens: ' + A.focused());
    const nodes = A.uiNodes();
    // (the grid's pictures: "Photo taken on …", or their thumbnail; not the Photos and Albums tabs)
    const pics = nodes.filter((x) => x.w > 80 && x.h > 80 && x.w < 700 && x.y > 520 && (/icon_thumbnail|item_grid|thumbnail/i.test(x['resource-id'] || '') || /taken on|^(photo|image|picture) /i.test(x['content-desc'] || '')));
    log('  pictures listed:', pics.length, pics.slice(0, 4).map((x) => `${x['resource-id'] || ''} "${x['content-desc'] || ''}" ${x.bounds}`).join(' | '));
    if (!pics.length) log('  on screen:', nodes.map((x) => `${x['resource-id'] || ''}:${x.text || x['content-desc'] || ''}`).filter((t) => t.length > 1).join(' | ').slice(0, 900));
    ok(pics.length, 'the photo is in the photo picker');
    shot('photo-picker-heic');
    const first = pics.sort((a, b) => a.y - b.y || a.x - b.x)[0];
    sh(`input tap ${first.x} ${first.y}`); await sleep(1500);
    const add = await A.waitUi(/^(add|done)( \(\d+\))?$/i, 5000);
    if (add) { sh(`input tap ${add.x} ${add.y}`); await sleep(1500); }
  }
  await page.waitForSelector('#dialog[open] #crdPicSize', { timeout: 30000 }).catch(async (e) => { log('  toast:', await toastText(), '· focus:', A.focused().split('\n')[0]); throw e; });
  shot('heic-dialog');
  await page.selectOption('#crdPicSize', 'fit'); await page.click('#dialog .dlg-foot .btn.primary');
  await page.waitForFunction((b) => window.__cowdreyPdf.doc && document.querySelector('#docTitle').textContent !== b && window.__cowdreyPdf.doc.pages.length === 1 && document.querySelector('.page canvas.pdf'), before, { timeout: 30000 }).catch(async (e) => { log('  toast:', await toastText()); throw e; });
  log('  opened as', await title());
  await sleep(1500);
  const d = await L.PDFDocument.load(await built());
  const sz = d.getPage(0).getSize();
  // the photo's colours, where they are in it: yellow outside the circle, red in the middle
  const px = await page.evaluate(() => { const c = document.querySelector('.page[data-n="0"] canvas.pdf'), g = c.getContext('2d'); const at = (fx, fy) => Array.from(g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data.slice(0, 3)); return { mid: at(.5, .5), corner: at(.125, .1875), edge: at(.03, .03) }; });
  log('  page', Math.round(sz.width) + 'x' + Math.round(sz.height), 'colours', JSON.stringify(px));
  shot('heic-pdf');
  ok(Math.abs(sz.width / sz.height - 1.5) < .01, 'the photo\'s shape (1200 x 800)');
  ok(px.mid[0] > 150 && px.mid[1] < 90 && px.corner[0] > 200 && px.corner[1] > 150 && px.edge[2] > 130, 'the photo\'s colours');
});

// (tags added automatically, and polled until they are there)
async function autoTag(min) {
  await run('acAutoTag');
  let tags = 0;
  for (const end = Date.now() + 30000; Date.now() < end && tags < min; await sleep(500)) tags = await page.evaluate(async () => (await window.__cowdreyPdf.acOrderModel(0)).items.length);
  ok(tags >= min, 'tags added: ' + tags);
}
await test('PDF/UA: tags added, saved as PDF/UA through the save dialog', async () => {
  // (a PDF with its fonts embedded: PDF/UA refuses sample.pdf, whose Helvetica is not)
  await openBytes(fs.readFileSync(fixture('chrome.pdf')), 'Access test.pdf');
  await autoTag(1);
  await page.evaluate(() => { window.__cowdreyPdf.acFixSet('lang', 'en-US'); window.__cowdreyPdf.acFixSet('dtitle', true); });
  const { name, bytes } = await saveThroughDialog(async () => {
    await run('acSaveUA');
    await sleep(2500);
    const d = await page.evaluate(() => { const x = document.querySelector('#dialog'); return x && x.open ? x.textContent.replace(/\s+/g, ' ').trim() : ''; });
    if (d) throw new Error('the app said: ' + d.slice(0, 200));
  }, 'pdfua');
  const d = await L.PDFDocument.load(bytes, { updateMetadata: false });
  const md = d.catalog.lookup(L.PDFName.of('Metadata'));
  const xmp = md ? Buffer.from(md instanceof L.PDFRawStream ? L.decodePDFRawStream(md).decode() : md.getContents()).toString('utf8') : '';
  log('  ', name, bytes.length, 'bytes · StructTreeRoot', !!d.catalog.get(L.PDFName.of('StructTreeRoot')));
  ok(/PDF-UA/.test(name) && /<pdfuaid:part>1<\/pdfuaid:part>/.test(xmp) && d.catalog.get(L.PDFName.of('StructTreeRoot')), 'PDF/UA identification and tags');
});

await test('reading order: a tag dragged with a finger (long press) moves to the top; the saved PDF reads in the new order', async () => {
  await openBytes(SAMPLE, 'Reading order.pdf');
  await autoTag(3);
  await run('acOrder'); await page.waitForSelector('#acOrder .ac-item', { timeout: 20000 }); await sleep(1000);
  const texts = () => page.evaluate(async () => (await window.__cowdreyPdf.acOrderModel(0)).items.map((x) => x.text.slice(0, 30)));
  const before = await texts();
  log('  before:', JSON.stringify(before));
  const from = page.locator('#acOrder .ac-item').nth(2).locator('.ac-txt'), to = page.locator('#acOrder .ac-item').nth(0).locator('.ac-txt');
  await from.scrollIntoViewIfNeeded(); await sleep(500);
  const s = await A.screenOf(page), ra = await from.boundingBox(), rb = await to.boundingBox();
  const [x1, y1] = s.at(ra.x + Math.min(40, ra.width / 2), ra.y + ra.height / 2), [x2, y2] = s.at(rb.x + Math.min(40, rb.width / 2), rb.y + rb.height * .3);
  sh(`input motionevent DOWN ${x1} ${y1}`); await sleep(900);
  for (let k = 1; k <= 10; k++) { sh(`input motionevent MOVE ${x1} ${Math.round(y1 + (y2 - y1) * k / 10)}`); await sleep(80); }
  sh(`input motionevent MOVE ${x2} ${y2}`); await sleep(300); sh(`input motionevent UP ${x2} ${y2}`); await sleep(1500);
  const after = await texts();
  log('  after:', JSON.stringify(after));
  shot('reading-order-dragged');
  eq(after[0], before[2], 'the third tag is first now');
  await run('acOrder');
  await openBytes(await built(), 'Reading order check.pdf');
  const saved = await texts();
  log('  in the saved PDF:', JSON.stringify(saved));
  eq(saved.slice(0, 3), after.slice(0, 3), 'the saved PDF reads in the new order');
});

await test('fonts: Japanese typed in Edit PDF says it needs a download when there is no network; online the fonts download and the saved PDF has the words', async () => {
  await openBytes(fs.readFileSync(fixture('word.pdf')), 'Fonts test.pdf');
  const editLine = async (find, typed) => {
    const b = await page.locator('.page[data-n="0"] .textLayer span', { hasText: find }).first().boundingBox();
    await A.tapCss(page, b.x + 10, b.y + b.height / 2);
    await page.waitForSelector('.line-editor', { timeout: 15000 });
    await page.waitForFunction(() => document.activeElement && document.activeElement.closest('.line-editor'), null, { timeout: 10000 });
    await sleep(1200);
    await page.evaluate(() => { const ed = document.activeElement.closest('.line-editor'); const r = document.createRange(); r.selectNodeContents(ed); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); });
    await page.keyboard.insertText(typed); await sleep(300); await page.keyboard.press('Enter'); await sleep(800);
  };
  await netOff();
  let editTool = '';
  try {
    await run('tool_edit'); editTool = await page.evaluate(() => document.querySelector('#app').dataset.tool);
    await editLine('Budget', '予算は承認されました');
    await page.waitForSelector('#dialog[open]', { timeout: 15000 });
    const ask = await page.textContent('#dialog h2'); log('  asked:', ask);
    ok(/Japanese letters need a font/.test(ask), ask);
    shot('font-ask');
    await answer('Download');
    await page.waitForFunction(() => /could not be downloaded/.test(document.querySelector('#toast').textContent), null, { timeout: 60000 });
    log('  with no network:', await toastText());
    shot('font-offline');
  } finally { await netOn(); }
  await ensureNetwork();
  if (await page.evaluate(() => document.querySelector('#app').dataset.tool) !== editTool) await run('tool_edit');
  await editLine('second phase', 'ประเทศไทย');
  await page.waitForSelector('#dialog[open]', { timeout: 15000 }); log('  asked:', await page.textContent('#dialog h2'));
  await answer('Download');
  await page.waitForFunction(() => /Thai font ready/.test(document.querySelector('#toast').textContent), null, { timeout: 120000 });
  await run('tool_select');
  const { bytes } = await saveThroughDialog(async () => {
    await A.tapEl(page, '#saveBtn');
    // Save asks for the Japanese font again (it could not be downloaded before), then downloads it
    for (const end = Date.now() + 120000; Date.now() < end && !isDocs(); await sleep(700)) {
      const q = await page.evaluate(() => { const d = document.querySelector('#dialog'); return d && d.open ? d.querySelector('h2').textContent : ''; }).catch(() => '');
      if (/letters need a font/.test(q)) { log('  asked on save:', q); await answer('Download'); }
    }
  }, 'font-save');
  const t = (await pdfText(bytes)).replace(/\s+/g, ' ');
  log('  text:', t.slice(0, 200));
  ok(t.includes('予算は承認されました'), 'the Japanese line'); ok(t.includes('ประเทศไทย'), 'the Thai line');
}, 600000);

await test('OCR in French: the language is downloaded once; with no network, a language not downloaded yet says why', async () => {
  await ensureNetwork();
  await openBytes(await scanPdf([['Le château de la reine', 'Facture numéro 4471', 'Merci beaucoup']]), 'Scan FR.pdf');
  await run('ocr'); await page.waitForSelector('#dialog[open] .ocr-dlg');
  await page.selectOption('#ocrLang', 'fra'); await sleep(1500);
  log('  download note:', await page.textContent('#ocrSize'));
  shot('ocr-french-dialog');
  await page.click('#dialog .dlg-foot .btn.primary');
  await page.waitForFunction(() => !document.querySelector('#dialog[open] .ocr-prog') && /recognized|could not|Could not/i.test(document.querySelector('#toast').textContent + (document.querySelector('#dialog[open] h2') || {}).textContent), null, { timeout: 300000 });
  log('  toast:', await toastText());
  await page.waitForSelector('.page[data-n="0"] .textLayer span', { timeout: 20000 }).catch(() => {});
  const t = (await page.$$eval('.page[data-n="0"] .textLayer span', (s) => s.map((x) => x.textContent).join(' '))).replace(/\s+/g, ' ');
  log('  text layer:', t);
  ok(/château/i.test(t) && /Facture/.test(t) && /numéro/.test(t), 'French words with their accents');
  // German, never downloaded, with no network
  await openBytes(await scanPdf([['Die Rechnung ist bezahlt']]), 'Scan DE.pdf');
  await netOff();
  try {
    await run('ocr'); await page.waitForSelector('#dialog[open] .ocr-dlg');
    await page.selectOption('#ocrLang', 'deu'); await sleep(800);
    await page.click('#dialog .dlg-foot .btn.primary');
    await page.waitForFunction(() => { const d = document.querySelector('#dialog'); return d.open && /could not start/.test(d.querySelector('h2').textContent); }, null, { timeout: 180000 });
    log('  with no network:', (await page.textContent('#dialog')).replace(/\s+/g, ' ').trim());
    shot('ocr-offline-message');
    await answer('OK');
  } finally { await netOn(); await page.evaluate(() => window.__cowdreyPdf.ocrPrefs({ lang: 'eng' })); }
}, 600000);

await test('update check (an APK not installed from Google Play): Check for updates asks GitHub; a newer release offers its APK, which Android opens', async () => {
  const info = await page.evaluate(() => window.__TAURI__.core.invoke('plugin:sharekit|native', { method: 'appInfo', args: {} }));
  log('  installed by:', JSON.stringify(info.installer));
  ok(info.installer !== 'com.android.vending', 'not from Google Play');
  ok(!(await page.evaluate(() => window.__cowdreyPdf.cmdHidden('checkUpdates'))), 'Check for updates is offered');
  await ensureNetwork();
  // GitHub's real answer (1.0.0 is the latest release, with no APK on it)
  await page.evaluate(() => {
    window.__gh = []; if (!window.__ghFetch) { const f = window.fetch.bind(window); window.__ghFetch = f; window.fetch = (u, o) => { const p = (window.__fakeRelease && /api\.github\.com\/repos\/[^/]+\/[^/]+\/releases\/latest/.test(String(u))) ? Promise.resolve(new Response(JSON.stringify(window.__fakeRelease), { status: 200, headers: { 'Content-Type': 'application/json' } })) : f(u, o); p.then((r) => window.__gh.push([String(u), r.status]), (e) => window.__gh.push([String(u), String(e)])); return p; }; }
    document.querySelector('#toast').textContent = '';
  });
  await run('checkUpdates');
  await page.waitForFunction(() => /latest version|Could not check/.test(document.querySelector('#toast').textContent), null, { timeout: 30000 });
  log('  GitHub:', JSON.stringify(await page.evaluate(() => window.__gh)), '· toast:', await toastText());
  ok(/You have the latest version \(1\.1\.0\)/.test(await toastText()) || /api\.github\.com.*",403\]/.test(JSON.stringify(await page.evaluate(() => window.__gh))), 'GitHub answered, and 1.1.0 is not older than its latest release');
  // a newer release with an APK (GitHub's answer replaced): the app offers it, and Download hands the link to Android
  await page.evaluate(() => { window.__fakeRelease = { tag_name: 'v99.0.0', html_url: 'https://github.com/bradleycowdrey/cowdrey-pdf/releases', assets: [{ name: 'Cowdrey.PDF.dmg', browser_download_url: 'https://github.com/bradleycowdrey/cowdrey-pdf/releases/latest/download/Cowdrey.PDF.dmg' }, { name: 'Cowdrey.PDF.apk', browser_download_url: 'https://github.com/bradleycowdrey/cowdrey-pdf/releases/latest/download/Cowdrey.PDF.apk' }] }; });
  try {
    await run('checkUpdates');
    await page.waitForFunction(() => { const d = document.querySelector('#dialog'); return d.open && /99\.0\.0 is available/.test(d.querySelector('h2').textContent); }, null, { timeout: 30000 });
    log('  dialog:', (await page.textContent('#dialog')).replace(/\s+/g, ' ').trim().slice(0, 200));
    shot('update-available');
    adb('logcat', '-c');
    await A.tapEl(page, '#dialog .dlg-foot .btn.primary');
    let left = false, started = '';
    for (const end = Date.now() + 20000; Date.now() < end && !left && !started; await sleep(1000)) {
      left = !/cowdreypdf/.test(A.focused());
      started = (adb('logcat', '-d', '-s', 'ActivityTaskManager:I').split('\n').find((l) => /START .*act=android\.intent\.action\.VIEW.*dat=https:\/\/github\.com/.test(l)) || '').trim();
    }
    log('  after Download:', left ? 'left the app: ' + A.focused().split('\n')[0] : 'still in the app', '·', started.slice(0, 240) || 'no VIEW intent logged');
    await sleep(2000); shot('update-download');
    ok(left || started, 'Android was asked to open the APK\'s address');
  } finally {
    await page.evaluate(() => { window.__fakeRelease = null; }).catch(() => {});
    for (const pkg of ['com.android.chrome', 'org.chromium.webview_shell', 'com.android.browser']) sh(`am force-stop ${pkg}`);
    await frontApp();
  }
});

if (LOWRAM) await test('OCR of a 50-page scan on a phone with 2 GB of memory: every page read, the app still running', async () => {
  const total = +(sh('cat /proc/meminfo').match(/MemTotal:\s+(\d+)/) || [])[1];
  log('  device memory:', Math.round(total / 1024), 'MB · low-RAM device:', sh('getprop ro.config.low_ram').trim() || 'false');
  const pages = []; for (let k = 1; k <= 50; k++) pages.push([`Page ${k} of the long scan`, `Invoice ${4400 + k} for the pelican survey`, 'The quick brown fox jumps over the lazy dog']);
  const bytes = await scanPdf(pages);
  log('  the scan:', bytes.length, 'bytes, 50 pages');
  await openBytes(bytes, 'Long scan.pdf');
  const p0 = A.pid();
  // the web view draws and runs the OCR in its own processes (sandboxed_process): their memory counts too
  const renderers = () => sh('ps -A -o PID,NAME').split('\n').filter((l) => /sandboxed_process|privileged_process/.test(l)).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  const pss = (who) => +((sh(`dumpsys meminfo ${who} | grep -E "TOTAL PSS|TOTAL:" | head -1`).match(/TOTAL(?: PSS)?:?\s+(\d+)/) || [])[1] || 0);
  const r0 = renderers(); log('  web view processes:', r0.join(', ') || 'none found');
  let peak = 0, peakApp = 0, stop = false;
  const watch = (async () => { while (!stop) { const app = pss(PKG), all = app + renderers().reduce((t, x) => t + pss(x), 0); if (all > peak) peak = all; if (app > peakApp) peakApp = app; await sleep(15000); } })();
  const t0 = Date.now();
  let r;
  try { r = await page.evaluate(() => window.__cowdreyPdf.ocrRunHeadless({ pages: window.__cowdreyPdf.doc.pages.map((_, n) => n), lang: 'eng', orient: false })); }
  finally { stop = true; await watch; }
  const r1 = renderers();
  log('  ', JSON.stringify(r), 'in', Math.round((Date.now() - t0) / 1000), 's · peak memory: app', Math.round(peakApp / 1024), 'MB, app and web view', Math.round(peak / 1024), 'MB · web view processes after:', r1.join(', '));
  eq(A.pid(), p0, 'the app is still the same process');
  ok(r0.every((x) => r1.includes(x)), 'the web view\'s processes are the same ones (none died)');
  ok(!page.isClosed(), 'the web view is still there');
  eq(r.pages, 50, 'every page read');
  const missing = await page.evaluate(async () => { const out = []; for (const [n, e] of window.__cowdreyPdf.doc.pages.entries()) { const v = window.__cowdreyPdf.views()[n]; const tc = await v.page.getTextContent(); const t = tc.items.map((x) => x.str).join(' '); if (!new RegExp(`Invoice\\s*${4401 + n}`).test(t)) out.push(n + 1); } return out; });
  log('  pages without their invoice number:', JSON.stringify(missing));
  ok(missing.length <= 2, 'the words of (nearly) every page: ' + missing.join(', '));
  shot('ocr-50-pages');
}, 2400000);

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
