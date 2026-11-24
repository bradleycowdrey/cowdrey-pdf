// The release APK on the emulator, as a user gets it (web view debugging off, so no test driver inside it): opened
// from Android with a PDF, a form field tapped and typed into, Save PDF, Android's save dialog, then the saved file
// pulled off the device and checked here with pdf-lib. Everything is done with real taps through adb and uiautomator,
// which reads the web view's accessibility tree. Runs before tests/android/run.mjs (the test build has the same
// package, so the release APK is uninstalled at the end).
// Usage: node tests/android/release.mjs <release apk> <output dir> [test apk]   (writes release-result.txt in the output dir;
// the test apk, a debug build, is the control for the web view debugging check: it must name the call)
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
import * as A from './lib.mjs';
import { startPki } from './pki.mjs';
const { adb, sh, log, shot, sleep, PKG, root } = A;
const require = createRequire(import.meta.url);
const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
const fflate = require(path.join(root, 'desktop/node_modules/fflate'));
const [APK, OUTDIR, TEST_APK] = process.argv.slice(2);
A.setOut(OUTDIR || '/tmp/android-e2e');
const VERSION = JSON.parse(fs.readFileSync(path.join(root, 'desktop/src-tauri/tauri.conf.json'), 'utf8')).version;
const NAME = 'Release test', TYPED = 'Release Tester';
const results = [];
const ok = (v, m) => { if (!v) throw new Error(m || 'not ok'); };
const eq2 = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const write = (done) => {
  const passed = results.filter((r) => r[0]).length;
  const head = !done ? 'RELEASE NOT FINISHED' : passed === results.length ? 'RELEASE PASSED' : 'RELEASE FAILED';
  fs.writeFileSync(path.join(A.OUT, 'release-result.txt'), `${head}: ${passed}/${results.length}\n${results.map(([p, n, e]) => `${p ? 'PASS' : 'FAIL'}  ${n}${e ? '\n      ' + e : ''}`).join('\n')}\n`);
};
// Each step needs the one before it: after a failure the rest are not run (and the run fails).
async function step(name, fn) {
  if (results.some((r) => !r[0])) return;
  log(`\n== release: ${name}`);
  try { await fn(); results.push([true, name]); log(`PASS release: ${name}`); }
  catch (e) {
    results.push([false, name, (e && e.message || String(e)).split('\n')[0]]); log(`FAIL release: ${name}: ${e && e.stack || e}`);
    log('  on screen:', A.uiNodes().map((x) => `${x.class && x.class.split('.').pop()}:${x.text || x['content-desc'] || ''}`).filter((s) => !/:$/.test(s)).join(' | ').slice(0, 1500));
    shot('release-fail');
  }
  write(false);
}
const appNodes = () => A.uiNodes().filter((n) => n.package === PKG);
async function waitApp(test, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const n = appNodes().find(test); if (n) return n; await sleep(1000); }
  return null;
}

let comp = '';
adb('logcat', '-c');
await step('installs; a release build (not debuggable, no web view debugging compiled in)', async () => {
  adb('uninstall', PKG);
  log(adb('install', '-r', APK).trim());
  const info = sh(`dumpsys package ${PKG}`);
  log('  ', (info.match(/versionName=\S+/) || [''])[0], (info.match(/pkgFlags=\[[^\]]*\]/) || [''])[0]);
  ok(new RegExp(`versionName=${VERSION.replace(/\./g, '\\.')}\\b`).test(info), 'version ' + VERSION);
  ok(!/DEBUGGABLE/.test((info.match(/pkgFlags=\[[^\]]*\]/) || [''])[0]), 'not debuggable');
  // Web view debugging: the app's native library only names setWebContentsDebuggingEnabled when built with debug
  // assertions or the devtools feature. (The web view's own debugging socket can't tell: on a debuggable system image,
  // as the emulator's is, Android opens one for every app's web view.)
  const libs = fflate.unzipSync(new Uint8Array(fs.readFileSync(APK)), { filter: (f) => /^lib\/[^/]+\/libcowdrey_pdf_lib\.so$/.test(f.name) });
  log('  native libraries:', Object.keys(libs).join(', '), '· system image debuggable:', sh('getprop ro.debuggable').trim());
  ok(Object.keys(libs).length >= 3, 'the native library for each ABI');
  for (const [n, b] of Object.entries(libs)) ok(!Buffer.from(b).includes('setWebContentsDebuggingEnabled'), 'no web view debugging in ' + n);
  if (TEST_APK) {
    const dbg = fflate.unzipSync(new Uint8Array(fs.readFileSync(TEST_APK)), { filter: (f) => /^lib\/[^/]+\/libcowdrey_pdf_lib\.so$/.test(f.name) });
    ok(Object.values(dbg).some((b) => Buffer.from(b).includes('setWebContentsDebuggingEnabled')), 'the check finds web view debugging in the test build');
    log('  control: the test build (debug) has web view debugging; the release build has none');
  }
  comp = A.component(); log('  launcher activity:', comp);
  ok(/cowdreypdf\//.test(comp), 'a launcher activity');
});

await step('opens a PDF handed over by Android (VIEW, content:// from Downloads, cold start)', async () => {
  sh(`rm -f '${A.DL}/${NAME}.pdf' '${A.DL}/${NAME} (1).pdf'`);
  adb('push', path.join(root, 'tests/fixtures/sample.pdf'), `${A.DL}/${NAME}.pdf`);
  sh(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d 'file://${A.DL}/${encodeURIComponent(NAME)}.pdf' > /dev/null`);
  let id = '';
  for (let i = 0; i < 10 && !id; i++) {
    await sleep(1500);
    id = (sh(`content query --uri content://media/external/downloads --projection _id --where "_display_name='${NAME}.pdf'"`).match(/_id=(\d+)/) || [])[1] || '';
  }
  ok(id, 'the PDF is in the media store');
  const r = sh(`am start -W -a android.intent.action.VIEW -t application/pdf -d content://media/external/downloads/${id} --grant-read-uri-permission -n ${comp}`).trim().replace(/\s+/g, ' ');
  log('  am start:', r.slice(0, 240));
  ok(!/Error|Exception/.test(r), r);
  // the document's name is the title once the PDF is open
  // (the title can be split over two pieces of text, for a middle ellipsis on a narrow screen)
  let shown = false;
  for (const end = Date.now() + 90000; Date.now() < end && !shown; await sleep(1000)) {
    const nodes = appNodes();
    shown = nodes.some((n) => /WebView/.test(n.class || '')) && (nodes.some((n) => (n.text || n['content-desc'] || '').includes(NAME)) || nodes.map((n) => n.text || '').join('').includes(NAME));
  }
  ok(shown, `the title "${NAME}" shows`);
  await sleep(3000);
  ok(A.pid(), 'the app is running');
  shot('release-open-dark');
});

await step('a form field: tapped, typed into with the keyboard', async () => {
  // the sample's Name field is the only text box on the page (an EditText in the web view's accessibility tree). The
  // page number box at the bottom is an EditText too, holding the page number: it is not the field (run 3f2b77c typed
  // into it when it was listed before the page's form fields had come up)
  const field = await waitApp((n) => /EditText/.test(n.class || '') && n.w > 20 && n.h > 10 && n.y > 300 && !/^\d+$/.test((n.text || '').trim()), 20000);
  ok(field, 'the Name field is on screen');
  sh(`input tap ${field.x} ${field.y}`); await sleep(1500);
  sh(`input text '${TYPED.replace(/ /g, '%s')}'`); await sleep(1500);
  const typed = await waitApp((n) => /EditText/.test(n.class || '') && (n.text || '') === TYPED, 10000);
  ok(typed, `the field reads "${TYPED}"`);
  shot('release-typed');
  if (/mInputShown=true/.test(sh('dumpsys input_method | grep -m1 mInputShown'))) { A.back(); await sleep(1000); }
});

let saved = null;
await step('Save PDF: Android\'s save dialog; the file in Downloads has the typed value', async () => {
  saved = await A.saveThroughDialog(async () => {
    // tapped once the screen has settled (the page zooms back when the keyboard goes down)
    let b = null, last = '';
    for (const end = Date.now() + 20000; Date.now() < end; await sleep(1500)) {
      const nodes = appNodes(), n = nodes.find((x) => /^Save PDF$/.test(x.text || '') || /^Save PDF$/.test(x['content-desc'] || ''));
      const now = nodes.map((x) => `${x.text || ''}${x.bounds}`).join('|');
      if (n && now === last) { b = n; break; }
      last = now;
    }
    ok(b, 'a Save PDF button, on a settled screen');
    sh(`input tap ${b.x} ${b.y}`);
    // what the app says if no save dialog comes (a toast lasts a few seconds)
    const seen = new Set();
    for (const end = Date.now() + 20000; Date.now() < end && !A.isDocs(); await sleep(1000)) {
      for (const n of appNodes()) { const t = n.text || n['content-desc'] || ''; if (/sav|could not|error|fail/i.test(t) && t !== 'Save PDF') seen.add(t.slice(0, 200)); }
    }
    if (!A.isDocs()) {
      shot('release-after-save');
      fs.writeFileSync(path.join(A.OUT, 'release-logcat.txt'), adb('logcat', '-d').split('\n').filter((l) => /chromium|Console|Tauri|cowdrey|AndroidRuntime|FATAL|RustStdoutStderr|sharekit|SharePlugin|AndroidPdf/i.test(l)).slice(-400).join('\n'));
      throw new Error(`no save dialog after tapping Save PDF; the app showed: ${[...seen].join(' / ') || 'nothing'}`);
    }
  }, 'release-save');
  const d = await L.PDFDocument.load(saved.bytes, { updateMetadata: false });
  log('  pages', d.getPageCount(), '· producer', d.getProducer(), '· name', d.getForm().getTextField('name').getText());
  ok(d.getPageCount() === 3, '3 pages');
  ok(new RegExp(`^Cowdrey\\.PDF ${VERSION.replace(/\./g, '\\.')}`).test(d.getProducer() || ''), 'producer ' + d.getProducer());
  ok(d.getForm().getTextField('name').getText() === TYPED, 'the typed value is saved');
  // the tap on Save PDF ended the typing: back in the app, the keyboard is down
  let kb = '';
  for (const end = Date.now() + 10000; Date.now() < end; await sleep(500)) { kb = sh('dumpsys input_method | grep -m1 mInputShown').trim(); if (/cowdreypdf/.test(A.focused()) && /mInputShown=false/.test(kb)) break; }
  log('  keyboard after saving:', kb);
  shot('release-saved-dark');
  ok(/mInputShown=false/.test(kb), 'the keyboard is down after saving');
});

await step('still running after all of that', async () => {
  await sleep(3000);
  ok(A.pid(), 'the app is running');
  ok(/cowdreypdf/.test(A.focused()), 'the app is in front: ' + A.focused());
});

// Revocation in the release build, where cleartext traffic is off (usesCleartextTraffic false): a PDF signed here with
// a certificate whose OCSP responder and revocation list are plain http on this machine (tests/android/pki.mjs, reached
// from the emulator at 10.0.2.2), opened from Android, and checked from the Signatures panel with taps. The app's
// pkiFetch speaks http on a socket of its own, so the release app reaches them all the same (docs/android.md).
await step('revocation over plain http in the release build: not revoked (OCSP), revoked (OCSP), revoked (CRL)', async () => {
  const pki = await startPki(path.join(A.OUT, '.pki-release-' + Date.now()), '10.0.2.2');
  try {
    const RNAME = 'Release revocation';
    log('  the release app\'s flags:', (sh(`dumpsys package ${PKG}`).match(/^\s*flags=\[[^\]]*\]/m) || [''])[0].trim(), '(the workflow\'s build log shows usesCleartextTraffic false for it)');
    log('  OCSP responder', pki.ocsp, '· revocation list', pki.crl);
    const f = path.join(A.OUT, '.push-release-revocation.pdf');
    fs.writeFileSync(f, await pki.signPdf(fs.readFileSync(path.join(root, 'tests/fixtures/sample.pdf'))));
    sh(`rm -f '${A.DL}/${RNAME}.pdf'`); adb('push', f, `${A.DL}/${RNAME}.pdf`); fs.unlinkSync(f);
    sh(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d 'file://${A.DL}/${encodeURIComponent(RNAME)}.pdf' > /dev/null`);
    let id = '';
    for (let i = 0; i < 10 && !id; i++) { await sleep(1500); id = (sh(`content query --uri content://media/external/downloads --projection _id --where "_display_name='${RNAME}.pdf'"`).match(/_id=(\d+)/) || [])[1] || ''; }
    ok(id, 'the signed PDF is in the media store');
    log('  am start:', sh(`am start -W -a android.intent.action.VIEW -t application/pdf -d content://media/external/downloads/${id} --grant-read-uri-permission -n ${comp}`).trim().replace(/\s+/g, ' ').slice(0, 200));
    const label = (n) => (n.text || n['content-desc'] || '').trim();
    const tapLabel = async (re, what, timeout = 60000) => { const n = await waitApp((x) => re.test(label(x)) && x.w > 0, timeout); ok(n, what); sh(`input tap ${n.x} ${n.y}`); await sleep(1500); };
    await tapLabel(/^View signatures$/, 'the signature bar\'s View signatures', 90000);
    eq2([pki.ocspHits(), pki.crlHits()], [0, 0], 'nothing asked before the person asks');
    const check = async (re, shotName) => {
      await tapLabel(/^Check revocation (online|again)$/, 'a Check revocation button in the Signatures panel');
      let all = '';
      for (const end = Date.now() + 60000; Date.now() < end; await sleep(1000)) { all = appNodes().map(label).filter(Boolean).join(' ').replace(/\s+/g, ' '); if (re.test(all) && !/Checking…/.test(all)) break; }
      const m = all.match(/(Not revoked|Revoked|Not checked)[^()]*\([^)]*\)/);
      log(`  ${shotName}:`, m ? m[0] : all.slice(0, 600));
      ok(re.test(all), 'the panel says ' + re);
      shot('release-' + shotName);
    };
    await check(/Not revoked: “Device Test Signer” \(OCSP from 10\.0\.2\.2:\d+\)/, 'not-revoked');
    eq2(pki.ocspHits(), 1, 'one OCSP request');
    await pki.revoke();
    await check(/Revoked: “Device Test Signer” was revoked .*key compromise.*\(OCSP from 10\.0\.2\.2:\d+\)/, 'revoked-ocsp');
    eq2(pki.ocspHits(), 2, 'asked again');
    await pki.stopOcsp();
    await check(/Revoked: “Device Test Signer” was revoked .*\(CRL from 10\.0\.2\.2:\d+\)/, 'revoked-crl');
    eq2(pki.crlHits(), 1, 'the revocation list was fetched');
    log('  the release app made these plain http requests itself, with cleartext traffic off');
  } finally { await pki.close(); }
});

if (!fs.existsSync(path.join(A.OUT, 'release-logcat.txt'))) fs.writeFileSync(path.join(A.OUT, 'release-logcat.txt'), adb('logcat', '-d').split('\n').filter((l) => /chromium|Console|Tauri|cowdrey|AndroidRuntime|FATAL|RustStdoutStderr/i.test(l)).slice(-400).join('\n'));
adb('uninstall', PKG); log('release APK uninstalled (the test build uses the same package)');
write(true);
log(fs.readFileSync(path.join(A.OUT, 'release-result.txt'), 'utf8'));
process.exit(0);
