// Loads index.html in Chromium with the libraries served from desktop/node_modules (mapped from their jsDelivr URLs).
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NM = path.join(root, 'desktop/node_modules');
let browser;
export const missing = new Set();
export async function open({ width = 1440, height = 900, scheme = 'dark', fresh = true, ua, touch = false } = {}) {
  browser ||= await pw.chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: 1, acceptDownloads: true, hasTouch: touch, ...(ua ? { userAgent: ua } : {}) });
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  const html = fs.readFileSync(path.join(root, 'index.html'));
  await ctx.route('**/*', (r) => {
    const u = r.request().url();
    if (u === 'https://app.test/') return r.fulfill({ body: html, contentType: 'text/html' });
    const m = u.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.+)$/);
    if (m) { const f = path.join(NM, m[1], m[2]); if (fs.existsSync(f)) return r.fulfill({ body: fs.readFileSync(f), contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }); missing.add(u); }
    return r.abort();
  });
  await page.goto('https://app.test/');
  await page.waitForFunction(() => window.__cowdreyPdf, null, { timeout: 15000 });
  page.ctx = ctx;
  return page;
}
export async function openPdf(page, file = path.join(root, 'tests/fixtures/sample.pdf'), name = 'Quarterly report.pdf') {
  const b64 = fs.readFileSync(file).toString('base64');
  await page.evaluate(async ([b, n]) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); await window.__cowdreyPdf.openBytes(u, n); }, [b64, name]);
  await page.waitForFunction(() => document.querySelector('.page canvas.pdf') && document.querySelector('.textLayer span'), null, { timeout: 15000 });
  await page.waitForTimeout(500);
}
export async function close() { if (browser) await browser.close(); browser = null; }
