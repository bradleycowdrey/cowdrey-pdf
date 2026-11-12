// Opens a PDF in desktop/dist, the copy the Mac, iPhone and Android apps ship, with the network cut off.
// Catches library paths that only break once they are vendored.
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'desktop/dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]); const p = path.join(dist, rel === '/' ? 'index.html' : rel);
  if (!p.startsWith(dist) || !fs.existsSync(p)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p));
}).listen(0);
const browser = await pw.chromium.launch(); const page = await browser.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
let ok = false;
try {
  if (process.env.DARK) await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`http://127.0.0.1:${srv.address().port}/`);
  if (fs.readdirSync(path.join(dist, 'vendor'), { recursive: true }).some((f) => f.endsWith('.mjs'))) throw new Error('a vendored file still ends in .mjs');
  await page.setInputFiles('#fileInput', { name: 'sample.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(path.join(root, 'tests/fixtures/sample.pdf')) });
  await page.waitForFunction(() => document.querySelectorAll('.page canvas').length === 3, null, { timeout: 15000 });
  const head = await page.evaluate(async () => String.fromCharCode(...(await window.__cowdreyPdf.buildPdf()).slice(0, 5)));
  if (head !== '%PDF-') throw new Error('Save did not produce a PDF');
  if (errors.length) throw new Error(errors.join('\n'));
  await page.screenshot({ path: process.env.SHOT || '/dev/null' }).catch(() => {});
  ok = true; console.log('✓ the app bundle opens a PDF and saves it, offline');
} catch (e) { console.log('✗ the app bundle could not open a PDF:', e.message, errors); }
await browser.close(); srv.close(); process.exit(ok ? 0 : 1);
