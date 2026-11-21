// Device test for the Android app: runs on an emulator in CI (.github/workflows/android-app.yml), on the test build
// (a debug build whose web view the test drives through the Chrome DevTools protocol). Android's own windows (the save
// dialog, the file picker, print, the share sheet) are driven with adb and uiautomator.
// Usage: node tests/android/run.mjs <test apk> <output dir>
import fs from 'node:fs'; import path from 'node:path';
import * as A from './lib.mjs';
const { adb, sh, log, shot, sleep, PKG, root } = A;

const [APK, OUTDIR] = process.argv.slice(2);
A.setOut(OUTDIR || '/tmp/android-e2e');
const results = [];
let page = null;
async function test(name, fn) {
  const t0 = Date.now(); log(`\n== ${name}`);
  try { await fn(); results.push([true, name]); log(`PASS ${name} (${((Date.now() - t0) / 1000).toFixed(0)} s)`); }
  catch (e) { results.push([false, name, (e && e.message || String(e)).split('\n')[0]]); log(`FAIL ${name}: ${e && e.stack || e}`); shot('fail-' + name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)); }
}
const ok = (v, m) => { if (!v) throw new Error(m || 'not ok'); };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const fixture = (n) => path.join(root, 'tests/fixtures', n);

log('device:', sh('getprop ro.product.model').trim(), '· Android', sh('getprop ro.build.version.release').trim(), '· API', sh('getprop ro.build.version.sdk').trim());
log('web view:', (sh('dumpsys webviewupdate | grep -iE "Current WebView package|versionName"') || '').trim().replace(/\s+/g, ' '));
adb('uninstall', PKG);
log(adb('install', '-r', '-g', APK).trim());
sh(`rm -rf ${A.DL}/*`);
adb('logcat', '-c');

await test('open from another app: a VIEW intent with a content:// address (MediaStore Downloads)', async () => {
  adb('push', fixture('sample.pdf'), `${A.DL}/Intent test.pdf`);
  await sleep(2000);
  const q = sh(`content query --uri content://media/external/downloads --projection _id:_display_name`);
  log('  MediaStore:', q.trim().slice(0, 300));
  const id = (q.match(/_id=(\d+), _display_name=Intent test\.pdf/) || [])[1];
  const comp = A.component(); log('  launcher activity:', comp);
  let uri = id && `content://media/external/downloads/${id}`;
  let r = uri ? sh(`am start -W -a android.intent.action.VIEW -t application/pdf -d '${uri}' --grant-read-uri-permission -n ${comp}`) : 'no id';
  log('  am start:', r.trim().replace(/\s+/g, ' ').slice(0, 300));
  if (!uri || /Error|Exception/.test(r)) {
    // the app's own FileProvider (cache-path "/"): put the file in its cache with run-as (the test build is debuggable)
    adb('push', fixture('sample.pdf'), '/data/local/tmp/intent.pdf');
    sh(`run-as ${PKG} sh -c 'mkdir -p cache/in && cp "/data/local/tmp/intent.pdf" "cache/in/Intent test.pdf"'`);
    uri = `content://${PKG}.fileprovider/share/in/Intent%20test.pdf`;
    r = sh(`am start -W -a android.intent.action.VIEW -t application/pdf -d '${uri}' -n ${comp}`);
    log('  am start (FileProvider):', r.trim().replace(/\s+/g, ' ').slice(0, 300));
  }
  page = await A.connect(90000);
  await page.waitForFunction(() => document.querySelectorAll('.page canvas.pdf').length > 0, null, { timeout: 45000 });
  await sleep(1500);
  const info = await page.evaluate(() => ({ title: document.querySelector('#docTitle').textContent, pages: window.__cowdreyPdf.doc && window.__cowdreyPdf.doc.pages.length, ua: navigator.userAgent, w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
  log('  ', JSON.stringify(info));
  shot('intent-open-dark');
  eq([info.title, info.pages], ['Intent test', 3]);
});

await test('the file picker: Open shows Android\'s picker and opens the chosen PDF', async () => {
  adb('push', fixture('word.pdf'), `${A.DL}/Picked.pdf`);
  await sleep(1500);
  await A.tapEl(page, '.tb-actions [data-cmd="open"]');
  await sleep(2500);
  log('  focus:', A.focused());
  shot('picker');
  let n = await A.waitUi(/^Picked\.pdf$/, 8000);
  if (!n) { await A.tapUi(/Show roots/i, 5000).catch(() => {}); await A.tapUi(/^Downloads?$/, 5000).catch(() => {}); n = await A.waitUi(/^Picked\.pdf$/, 8000); }
  ok(n, 'Picked.pdf is listed');
  A.sh(`input tap ${n.x} ${n.y}`);
  await page.waitForFunction(() => document.querySelector('#docTitle').textContent === 'Picked', null, { timeout: 30000 });
  shot('picked-open');
});

await test('Save PDF (as it was): what opens', async () => {
  await page.evaluate(() => { window.__cowdreyPdf.run('save'); });
  await sleep(4000);
  log('  focus:', A.focused());
  shot('save-before');
  A.back(); await sleep(1500);
});

const passed = results.filter((r) => r[0]).length;
const summary = results.map(([p, n, e]) => `${p ? 'PASS' : 'FAIL'}  ${n}${e ? '\n      ' + e : ''}`).join('\n');
const head = passed === results.length ? 'ALL PASSED' : 'SOME FAILED';
fs.writeFileSync(path.join(A.OUT, 'result.txt'), `${head}: ${passed}/${results.length}\n${summary}\n`);
log(`\n${summary}\n\n${head}: ${passed}/${results.length}`);
process.exit(0);
