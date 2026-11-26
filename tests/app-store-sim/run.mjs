// App Store captures from the iOS Simulator: the real Cowdrey.PDF app (the capture build, see inject.mjs) on a 6.9"
// iPhone and a 13" iPad, in dark mode, with the Simulator's own status bar set to 9:41, full battery and full signal.
// For each frame in scripts/store-frames/apps/cowdrey-pdf.json it launches the app, the app plays the frame's story
// (tests/app-store-stories.mjs, the same steps as the browser capture) and reports back here, and this takes the
// screenshot with `simctl io screenshot`. Mac only (Xcode and its Simulator).
//
// Usage: node tests/app-store-sim/run.mjs --app <Cowdrey.PDF.app> --docs <dir from app-store-screens.mjs --docs>
//          [--dist desktop/dist] [--raw tests/.app-store-raw] [--only iphone,ipad]
//        node tests/app-store-sim/run.mjs --browser=webkit --docs <dir> [--raw <dir>]
//          plays the same stories through the same player in Playwright's WebKit or Chromium at the devices' sizes
//          (the capture build of desktop/dist served from here), to check the player on any machine before the Mac
//          run. Those pictures have no status bar and are not for the App Store.
// Writes <raw>/<capture> for each frame (the names in the config), and <raw>/simulator-log.txt.
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const ARG = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2).split('=')[0], a.includes('=') ? a.split('=').slice(1).join('=') : all[i + 1]] : null).filter(Boolean));
const BROWSER = ARG.browser;
const APP = BROWSER ? null : path.resolve(ARG.app);
const DOCS = path.resolve(ARG.docs);
const DIST = path.resolve(ARG.dist || path.join(root, 'desktop/dist'));
const RAW = path.resolve(ARG.raw || path.join(root, 'tests/.app-store-raw'));
const ONLY = (ARG.only || 'iphone,ipad').split(',');
const CONFIG = JSON.parse(fs.readFileSync(path.join(root, 'scripts/store-frames/apps/cowdrey-pdf.json'), 'utf8'));
const PORT = 8737;
fs.mkdirSync(RAW, { recursive: true });
const LOG = path.join(RAW, 'simulator-log.txt');
fs.writeFileSync(LOG, '');
const log = (...a) => { const t = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; console.log(t); fs.appendFileSync(LOG, t + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const simctl = (...a) => execFileSync('xcrun', ['simctl', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// The screens: 6.9" iPhone (440 x 956 points at 3x) and 13" iPad (1032 x 1376 points at 2x), App Store sizes.
const DEVICES = {
  iphone: { names: ['iPhone 17 Pro Max', 'iPhone 16 Pro Max'], match: /^iPhone \d+ Pro Max$/, size: [1320, 2868] },
  ipad: { names: ['iPad Pro 13-inch (M5)', 'iPad Pro 13-inch (M4)'], match: /^iPad Pro 13-inch/, size: [2064, 2752] },
};

// ---- what the app fetches: the story player, the documents, and the frame to play now
const STORIES_SRC = fs.readFileSync(path.join(root, 'tests/app-store-stories.mjs'), 'utf8').replace(/^export \{[^}]*\};?\s*$/m, '');
const PLAYER = `(() => {\nconst SERVER = 'http://127.0.0.1:${PORT}';\n${STORIES_SRC}\n${fs.readFileSync(path.join(here, 'in-app.js'), 'utf8')}\n})();\n`;
let job = null, waiting = null;
const modes = new Set();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gz': 'application/gzip', '.pdf': 'application/pdf', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, body, type = 'text/plain') => { res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(body); };
  const file = (f) => fs.existsSync(f) && fs.statSync(f).isFile() ? send(200, fs.readFileSync(f), TYPES[path.extname(f)] || 'application/octet-stream') : send(404, 'not found');
  if (req.method === 'OPTIONS') return send(204, '');
  if (req.method === 'POST') {
    let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
      if (u.pathname === '/log') log('app:', body.slice(0, 2000));
      else if (u.pathname === '/ready' || u.pathname === '/fail') { log('app', u.pathname.slice(1) + ':', body.slice(0, 4000)); if (waiting) waiting({ ok: u.pathname === '/ready', body }); }
      send(200, 'ok');
    });
    return;
  }
  if (u.pathname === '/driver.js') { const m = u.searchParams.get('mode') || '?'; if (!modes.has(m)) log('the app loaded the story player from', m === 'app' ? "its own address (tauri://localhost)" : 'run.mjs (fallback)'); modes.add(m); return send(200, PLAYER, 'text/javascript'); }
  if (u.pathname === '/job') return send(200, JSON.stringify(job), 'application/json');
  if (u.pathname.startsWith('/docs/')) return file(path.join(DOCS, path.basename(u.pathname)));
  if (u.pathname.startsWith('/app/')) { const f = path.normalize(path.join(DIST, decodeURIComponent(u.pathname.slice(5)) || 'index.html')); return f.startsWith(DIST) ? file(f) : send(403, 'no'); }
  send(404, 'not found');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
log('listening on', PORT);

// ---- the Simulator, or a browser standing in for it
let list, runtime, bundle;
if (!BROWSER) {
  list = JSON.parse(simctl('list', '-j', 'devicetypes', 'runtimes'));
  runtime = list.runtimes.filter((r) => r.isAvailable && /iOS/.test(r.name)).sort((a, b) => b.version.localeCompare(a.version, 'en', { numeric: true }))[0];
  if (!runtime) throw new Error('no iOS Simulator runtime');
  log('runtime', runtime.name, runtime.identifier);
  bundle = execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', path.join(APP, 'Info.plist')], { encoding: 'utf8' }).trim();
  log('app', APP, bundle);
}
function device(kind) {
  const D = DEVICES[kind];
  const types = list.devicetypes.filter((t) => !runtime.supportedDeviceTypes || runtime.supportedDeviceTypes.some((s) => s.identifier === t.identifier));
  const type = D.names.map((n) => types.find((t) => t.name === n)).find(Boolean) || types.filter((t) => D.match.test(t.name)).pop();
  if (!type) throw new Error(`no ${kind} device type like ${D.names[0]}`);
  const udid = simctl('create', `Store ${kind}`, type.identifier, runtime.identifier).trim();
  log(kind, type.name, udid);
  simctl('boot', udid);
  simctl('bootstatus', udid, '-b');
  try { simctl('ui', udid, 'appearance', 'dark'); } catch (e) { log('appearance:', e.message); }
  simctl('status_bar', udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi', '--wifiMode', 'active', '--wifiBars', '3',
    '--cellularMode', 'active', '--cellularBars', '4', '--operatorName', '', '--batteryState', 'charged', '--batteryLevel', '100');
  simctl('install', udid, APP);
  return { udid, name: type.name };
}
// The browser stand-in: the device's points and scale, touch, dark, and the capture build from /app/.
const VIEW = { iphone: { width: 440, height: 956, scale: 3 }, ipad: { width: 1032, height: 1376, scale: 2 } };
let browser;
async function browserDevice(kind) {
  const { createRequire } = await import('node:module'); const require = createRequire(import.meta.url);
  let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
  browser ||= await pw[BROWSER].launch();
  const v = VIEW[kind];
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.scale, hasTouch: true, isMobile: BROWSER === 'chromium' ? kind === 'iphone' : undefined, colorScheme: 'dark' });
  let page = null;
  return {
    name: BROWSER + ' ' + kind,
    async launch() { if (page) await page.close(); page = await ctx.newPage(); page.on('pageerror', (e) => log('page error', e.message)); page.on('console', (m) => log('console', m.text())); await page.goto(`http://127.0.0.1:${PORT}/app/index.html`); },
    async shot(out) { fs.writeFileSync(out, await page.screenshot()); },
    async close() { await ctx.close(); },
  };
}
function simDevice(kind) {
  const dev = device(kind);
  return {
    name: dev.name,
    async launch() { try { simctl('terminate', dev.udid, bundle); } catch {} await sleep(1000); simctl('launch', dev.udid, bundle); },
    async shot(out) { simctl('io', dev.udid, 'screenshot', '--type=png', out); },
    async close() { try { simctl('terminate', dev.udid, bundle); } catch {} try { simctl('shutdown', dev.udid); } catch {} },
  };
}
const pngSize = (f) => { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

const failures = [];
for (const kind of ONLY) {
  const frames = CONFIG[kind] || [];
  if (!frames.length) continue;
  const dev = BROWSER ? await browserDevice(kind) : simDevice(kind);
  // A first launch, so the web view's caches and the app's first start are not part of the first story.
  job = null; await dev.launch(); await sleep(BROWSER ? 3000 : 15000);
  for (const f of frames) {
    const story = f.capture.replace(`${kind}-`, '').replace(/\.png$/, '');
    let done = false;
    for (let attempt = 1; attempt <= 2 && !done; attempt++) {
      job = { kind, story, id: f.id };
      log(`${kind} ${f.id}: launching (${story}, attempt ${attempt})`);
      const result = new Promise((r) => { waiting = r; });
      await dev.launch();
      const r = await Promise.race([result, sleep(300000).then(() => ({ ok: false, body: 'timed out after 5 minutes' }))]);
      waiting = null;
      if (r.ok) {
        await sleep(1500); // the last paint, and the status bar settled
        const out = path.join(RAW, f.capture);
        await dev.shot(out);
        const [w, h] = pngSize(out);
        log(`${kind} ${f.id}: ${out} ${w} x ${h}`);
        if (w !== DEVICES[kind].size[0] || h !== DEVICES[kind].size[1]) failures.push(`${f.capture}: ${w} x ${h}, not ${DEVICES[kind].size.join(' x ')} (${dev.name})`);
        done = true;
      } else {
        const dbg = path.join(RAW, 'debug-' + f.capture.replace(/\.png$/, `-${attempt}.png`));
        try { await dev.shot(dbg); } catch {}
        log(`${kind} ${f.id}: failed (${r.body.slice(0, 600)}); screen in ${dbg}`);
        if (attempt === 2) failures.push(`${f.capture}: ${r.body.slice(0, 300)}`);
      }
    }
  }
  job = null;
  await dev.close();
}
if (browser) await browser.close();
server.close();
if (failures.length) { log('FAILED:\n' + failures.join('\n')); process.exit(1); }
log('all captures made');
