// Mac App Store screenshots: the real app UI at 1440x900 (2880x1800 at 2x), dark, as the Mac App Store build
// (no in-page menu bar: the menus are in the macOS menu bar). Documents are fictional, made here with pdf-lib, or the
// app's own sample. Run: (cd desktop && npm ci) && node tests/mac-screenshots.mjs  ->  docs/app-store/mac-*.png
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
import { open, close, root } from './harness.mjs';
const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb } = require('../desktop/node_modules/pdf-lib');
const OUT = path.join(root, 'docs/app-store');

// A fictional ferry company's yearly review, like the iPhone and iPad screenshots.
async function review() {
  const pdf = await PDFDocument.create();
  const f = await pdf.embedFont(StandardFonts.Helvetica), b = await pdf.embedFont(StandardFonts.HelveticaBold);
  const teal = rgb(.09, .42, .45), navy = rgb(.1, .17, .33), grey = rgb(.4, .4, .42), ink = rgb(.12, .12, .14), sand = rgb(.95, .93, .89);
  const W = 612, H = 792, M = 64;
  const head = (p, n) => {
    p.drawRectangle({ x: 0, y: H - 12, width: W, height: 12, color: teal });
    p.drawText('Harbour Line Ferries', { x: M, y: H - 48, size: 9, font: b, color: teal });
    const t = `Service review 2026  ·  ${n}`; p.drawText(t, { x: W - M - f.widthOfTextAtSize(t, 9), y: H - 48, size: 9, font: f, color: grey });
    p.drawLine({ start: { x: M, y: 50 }, end: { x: W - M, y: 50 }, thickness: .5, color: rgb(.85, .85, .85) });
    p.drawText(String(n), { x: W / 2 - 3, y: 34, size: 9, font: f, color: grey });
  };
  const lines = (p, arr, y, o = {}) => { for (const t of arr) { p.drawText(t, { x: o.x || M, y, size: o.size || 11.5, font: o.font || f, color: o.color || ink }); y -= (o.size || 11.5) * 1.55; } return y; };
  let p = pdf.addPage([W, H]); head(p, 1);
  p.drawText('2026 Service Review', { x: M, y: H - 110, size: 26, font: b, color: navy });
  let y = lines(p, ['A year of steady growth on the harbour: more crossings, fewer delays and', 'two new stops on the north shore.'], H - 140, { color: grey, size: 13 });
  p.drawRectangle({ x: M, y: y - 80, width: W - 2 * M, height: 82, color: sand });
  [['1.84M', 'passengers'], ['96.2%', 'on time'], ['41,300', 'crossings']].forEach(([v, l], i) => {
    const x = M + 22 + i * 165; p.drawText(v, { x, y: y - 40, size: 24, font: b, color: teal }); p.drawText(l, { x, y: y - 60, size: 10.5, font: f, color: grey });
  });
  y -= 120;
  p.drawText('Highlights', { x: M, y, size: 15, font: b, color: navy }); y -= 26;
  y = lines(p, ['•  Ridership up 12 percent on 2025', '•  Average delay down to 2.1 minutes', '•  Kestrel, our first electric ferry', '•  Two new stops on the north shore'], y);
  y -= 16; p.drawText('Next year', { x: M, y, size: 15, font: b, color: navy }); y -= 26;
  lines(p, ['We plan a second electric vessel, contactless boarding at every stop and a', 'quieter timetable on Sunday evenings.'], y);
  p = pdf.addPage([W, H]); head(p, 2);
  p.drawText('Passengers by month', { x: M, y: H - 110, size: 22, font: b, color: navy });
  y = lines(p, ['Thousands of passengers per month. Summer weekends remain the busiest', 'time on the water.'], H - 138, { color: grey });
  const vals = [98, 104, 121, 138, 160, 182, 205, 210, 176, 150, 122, 134];
  vals.forEach((v, i) => { const x = M + 8 + i * 40; p.drawRectangle({ x, y: 420, width: 26, height: v, color: i === 7 ? teal : rgb(.62, .78, .79) }); p.drawText('JFMAMJJASOND'[i], { x: x + 9, y: 404, size: 9, font: f, color: grey }); });
  lines(p, ['August was the busiest month on record, with 210,000 passengers.', 'Kestrel carried one in five of them.'], 370);
  p = pdf.addPage([W, H]); head(p, 3);
  p.drawText('Routes and stops', { x: M, y: H - 110, size: 22, font: b, color: navy });
  lines(p, ['Route        Stops    Crossings    On time', 'Harbour loop     6        18,900      97.1%', 'North shore      4        12,600      95.4%', 'Island run       3         9,800      95.8%'], H - 150, { font: b && f });
  p = pdf.addPage([W, H]); head(p, 4);
  p.drawText('Contact and staff', { x: M, y: H - 110, size: 22, font: b, color: navy });
  lines(p, ['Operations: Jamie Rivera, 555-0142, jamie.rivera@example.com', 'Fleet: Priya Nair, 555-0177, priya.nair@example.com', 'Customer service: 555-0100'], H - 150);
  pdf.setTitle('Service review 2026');
  return pdf.save();
}

// The pretend Mac app, as the App Store build: the native side only answers what the page asks at start.
const macStore = () => {
  window.__TAURI__ = {
    core: { invoke: async (c) => (c === 'take_opened_files' ? [] : null) },
    dialog: {}, event: { listen: async () => {} }, opener: { openUrl: async () => {} },
  };
  window.__COWDREY_APP_STORE__ = true;
};

async function page(bytes, name) {
  const p = await open({ width: 1440, height: 900, scale: 2, scheme: 'dark', init: macStore });
  await p.evaluate(() => window.__cowdreyPdf.setAuthor && window.__cowdreyPdf.setAuthor('Alex Morgan'));
  if (bytes) {
    await p.evaluate(async ([b, n]) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); await window.__cowdreyPdf.openBytes(u, n); }, [Buffer.from(bytes).toString('base64'), name]);
    await p.waitForFunction(() => document.querySelector('.page canvas.pdf') && document.querySelector('.textLayer span'), null, { timeout: 15000 });
    await p.waitForTimeout(600);
  }
  return p;
}
const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
const tab = async (p, name) => { const t = p.locator('.ribbon-tabs button', { hasText: name }).first(); if (await t.count()) await t.click(); await p.waitForTimeout(250); };
async function select(p, text) {
  const s = p.locator('.page[data-n="0"] .textLayer span', { hasText: text }).first();
  const b = await s.boundingBox();
  await p.mouse.move(b.x + 1, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 6 }); await p.mouse.up();
}
const shot = async (p, file) => {
  await p.mouse.move(1430, 890); await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(OUT, file) });
  console.log('wrote docs/app-store/' + file); await p.ctx.close();
};
const doc = await review();

// 1. Edit the words in place.
{
  const p = await page(doc, 'Service review 2026.pdf');
  await tab(p, 'Edit'); await run(p, 'txtEditLines'); await p.waitForTimeout(500);
  const line = p.locator('.page[data-n="0"] .textLayer span', { hasText: 'Average delay down' }).first();
  const b = await line.boundingBox(); await p.mouse.click(b.x + b.width - 3, b.y + b.height / 2); await p.waitForTimeout(500);
  await p.keyboard.press('End'); for (let i = 0; i < 11; i++) await p.keyboard.press('Backspace'); await p.keyboard.type('1.8 minutes'); await p.waitForTimeout(400);
  await shot(p, 'mac-01-edit-text.png');
}
// 2. Mark up and comment, with the comments list.
{
  const p = await page(doc, 'Service review 2026.pdf');
  await tab(p, 'Comment');
  for (const t of ['Ridership up 12 percent', 'Kestrel, our first electric']) { await select(p, t); await p.evaluate(() => window.__cowdreyPdf.highlightSelection()); await p.waitForTimeout(200); }
  await run(p, 'cm_list'); await p.waitForTimeout(500);
  await shot(p, 'mac-02-comments.png');
}
// 3. Organize pages.
{
  const p = await page(doc, 'Service review 2026.pdf');
  await tab(p, 'Pages'); await run(p, 'pg60_organize'); await p.waitForTimeout(1200);
  await shot(p, 'mac-03-organize-pages.png');
}
// 4. Fill in a form: the app's own sample PDF.
{
  const p = await page(null);
  await p.evaluate(() => window.__cowdreyPdf.run('sample'));
  await p.waitForFunction(() => document.querySelector('.page canvas.pdf') && document.querySelector('.annotationLayer input'), null, { timeout: 15000 });
  await p.waitForTimeout(600);
  await tab(p, 'Forms');
  await p.fill('.annotationLayer input[type=text]', 'Alex Morgan'); await p.click('.annotationLayer input[type=checkbox]');
  await shot(p, 'mac-04-fill-and-sign.png');
}
// 5. Redact: mark the contact details for redaction.
{
  const p = await page(doc, 'Service review 2026.pdf');
  await p.evaluate(() => window.__cowdreyPdf.run('zoomFit'));
  await tab(p, 'Protect'); await run(p, 'protRedSearch');
  await p.waitForSelector('#dialog[open] input[name=text]'); await p.fill('#dialog input[name=text]', '');
  // Every email address and phone number in the document.
  await p.check('#dialog input[name=email]'); await p.check('#dialog input[name=phone]');
  await p.click('#dialog .dlg-foot button:has-text("Find")');
  await p.waitForSelector('#dialog[open] .dlg-foot button:has-text("Mark")'); await p.click('#dialog .dlg-foot button:has-text("Mark")'); await p.waitForTimeout(600);
  await p.evaluate(() => { const v = document.querySelector('.page[data-n="3"]'); v && v.scrollIntoView({ block: 'start' }); });
  await p.waitForTimeout(600);
  await shot(p, 'mac-05-redact.png');
}
await close();
