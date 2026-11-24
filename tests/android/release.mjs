// The release APK on the emulator, as a user gets it (web view debugging off, so no test driver inside it): opened
// from Android with a PDF, a form field tapped and typed into, Save PDF, Android's save dialog, then the saved file
// pulled off the device and checked here with pdf-lib. Everything is done with real taps through adb and uiautomator,
// which reads the web view's accessibility tree. Runs before tests/android/run.mjs (the test build has the same
// package, so the release APK is uninstalled at the end).
// Usage: node tests/android/release.mjs <release apk> <output dir> [test apk]   (writes release-result.txt in the output dir;
// the test apk, a debug build, is the control for the web view debugging check: it must name the call)
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
import * as A from './lib.mjs';
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
  // the sample's Name field is the only text box on the page (an EditText in the web view's accessibility tree)
  const field = await waitApp((n) => /EditText/.test(n.class || '') && n.w > 20 && n.h > 10 && n.y > 300, 20000);
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
    const b = await waitApp((n) => /^Save PDF$/.test(n.text || '') || /^Save PDF$/.test(n['content-desc'] || ''), 15000);
    ok(b, 'a Save PDF button');
    sh(`input tap ${b.x} ${b.y}`);
  }, 'release-save');
  const d = await L.PDFDocument.load(saved.bytes, { updateMetadata: false });
  log('  pages', d.getPageCount(), '· producer', d.getProducer(), '· name', d.getForm().getTextField('name').getText());
  ok(d.getPageCount() === 3, '3 pages');
  ok(new RegExp(`^Cowdrey\\.PDF ${VERSION.replace(/\./g, '\\.')}`).test(d.getProducer() || ''), 'producer ' + d.getProducer());
  ok(d.getForm().getTextField('name').getText() === TYPED, 'the typed value is saved');
  shot('release-saved-dark');
});

await step('still running after all of that', async () => {
  await sleep(3000);
  ok(A.pid(), 'the app is running');
  ok(/cowdreypdf/.test(A.focused()), 'the app is in front: ' + A.focused());
});

adb('uninstall', PKG); log('release APK uninstalled (the test build uses the same package)');
write(true);
log(fs.readFileSync(path.join(A.OUT, 'release-result.txt'), 'utf8'));
process.exit(0);
