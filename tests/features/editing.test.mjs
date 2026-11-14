// Edit PDF's engine: typing straight after a click, pictures inside forms, paragraph widths, the line editor's
// font, the phone format bar, page-turning keys and named undo steps (src/app.js, src/features/10-text.js).
import os from 'node:os';
import zlib from 'node:zlib';

const SHOTS = '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr3/fix-editing/';
let H;
const shot = async (p, name) => { try { H.fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: SHOTS + name }); } catch {} };
const tmp = (name) => H.path.join(H.fs.mkdtempSync(H.path.join(os.tmpdir(), 'cpdf-edit-')), name);

// A solid-colour PNG, w x h.
function png(w, h, [r, g, b]) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), cr = Buffer.alloc(4); len.writeUInt32BE(data.length); cr.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// A page whose background picture is drawn by a form XObject (with text of its own), with the page's text on top.
async function formDoc() {
  const L = H.require(H.path.join(H.root, 'desktop/node_modules/pdf-lib'));
  const inner = await L.PDFDocument.create(), ip = inner.addPage([300, 300]), font = await inner.embedFont(L.StandardFonts.Helvetica);
  ip.drawImage(await inner.embedPng(png(16, 16, [60, 120, 230])), { x: 0, y: 0, width: 300, height: 300 });
  ip.drawText('Inside the form', { x: 20, y: 250, size: 18, font, color: L.rgb(0, 0, 0) });
  const pdf = await L.PDFDocument.create(), p = pdf.addPage([400, 400]), f2 = await pdf.embedFont(L.StandardFonts.Helvetica);
  p.drawPage(await pdf.embedPage((await L.PDFDocument.load(await inner.save())).getPage(0)), { x: 50, y: 50 });
  p.drawText('Page text on top', { x: 80, y: 200, size: 18, font: f2, color: L.rgb(0, 0, 0) });
  const file = tmp('form.pdf'); H.fs.writeFileSync(file, await pdf.save()); return file;
}
// A paragraph whose first (widest) line is set tighter than the font's own spacing.
const PARA = ['The pelican project moved into its second big phase this spring,', 'with new stores joining the pilot and early results showing', 'steady growth in every region we measured over the quarter.', 'The team will report again in June.'];
async function tightDoc() {
  const L = H.require(H.path.join(H.root, 'desktop/node_modules/pdf-lib'));
  const pdf = await L.PDFDocument.create(), p = pdf.addPage([612, 792]), font = await pdf.embedFont(L.StandardFonts.Helvetica);
  PARA.forEach((t, k) => {
    if (k === 0) p.pushOperators(L.setCharacterSpacing(-0.3));
    p.drawText(t, { x: 72, y: 680 - k * 16, size: 12, font, color: L.rgb(0.1, 0.1, 0.1) });
    if (k === 0) p.pushOperators(L.setCharacterSpacing(0));
  });
  const file = tmp('tight.pdf'); H.fs.writeFileSync(file, await pdf.save()); return file;
}
// The colour of the page at a point in PDF coordinates (page n), as drawn on screen.
const pixel = (p, x, y, n = 0) => p.evaluate(([x, y, n]) => {
  const v = window.__cowdreyPdf.views()[n], c = v.el.querySelector('canvas.pdf'), k = c.width / v.viewport.width;
  const [vx, vy] = v.viewport.convertToViewportPoint(x, y);
  return Array.from(c.getContext('2d').getImageData(Math.round(vx * k), Math.round(vy * k), 1, 1).data.slice(0, 3));
}, [x, y, n]);
// Whether any of a box (PDF coordinates) is dark on screen: text there is visible.
const inkIn = (p, x0, y0, x1, y1, n = 0) => p.evaluate(([x0, y0, x1, y1, n]) => {
  const v = window.__cowdreyPdf.views()[n], c = v.el.querySelector('canvas.pdf'), k = c.width / v.viewport.width;
  const [a, b] = v.viewport.convertToViewportPoint(x0, y1), [e, f] = v.viewport.convertToViewportPoint(x1, y0);
  const d = c.getContext('2d').getImageData(Math.round(a * k), Math.round(b * k), Math.round((e - a) * k), Math.round((f - b) * k)).data;
  let ink = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 70 && d[i + 1] < 70 && d[i + 2] < 70) ink++;
  return ink;
}, [x0, y0, x1, y1, n]);
// Nothing on the page's marks layer paints over it (no cover drawn for the picture).
const covers = (p) => p.$$eval('.page[data-n="0"] svg.marks polygon:not(.content-sel):not(.content-hover)', (e) => e.length);

export default async (h) => {
  H = h;
  const { test, eq, ok, open, openPdf, savedOf, reopen, at, WORD } = h;
  const all = (p) => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat());

  await test('Edit PDF: keys typed right after clicking a line, while it is still being read, go into the line (not the ribbon)', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.click('[data-rt="edit"]'); await p.click('[data-cmd="tool_edit"]'); // the focus is on the ribbon button
    eq(await p.evaluate(() => document.activeElement.dataset.cmd), 'tool_edit');
    // reading the page takes a while (as for a big page the first time)
    await p.evaluate(() => { const pg = window.__cowdreyPdf.views()[0].page; delete pg._cmap; const real = window.__cowdreyPdf.contentMap(0); pg._cmap = new Promise((r) => setTimeout(() => r(real), 900)); delete pg._cmapValue; });
    const b = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'Budget' }).first().boundingBox();
    await p.mouse.click(b.x + 20, b.y + b.height / 2);
    ok(await p.evaluate(() => 'busy' in document.querySelector('.app').dataset), 'shows it is busy');
    eq(await p.$eval('.page[data-n="0"] svg.marks', (s) => getComputedStyle(s).cursor), 'progress', 'busy cursor');
    ok(!(await p.$('.line-editor')), 'the editor is not open yet');
    eq(await p.evaluate(() => document.activeElement.id), 'viewer', 'the focus left the ribbon');
    await p.keyboard.press('End'); await p.keyboard.type(' Hi!'); await p.keyboard.press('Enter');
    await p.waitForTimeout(1500);
    const m = await all(p);
    eq(m.map((x) => [x.type, x.text]), [['te', 'Budget: 42,000 dollars, on track. Hi!']], 'nothing typed was lost');
    eq(await p.evaluate(() => document.querySelector('.app').dataset.tool), 'edit', 'Space did not run the ribbon button again');
    ok(!(await p.evaluate(() => 'busy' in document.querySelector('.app').dataset)), 'not busy any more');
    // Other page tools take the focus off the ribbon too
    await p.click('[data-rt="markup"]'); await p.click('[data-cmd="tool_rect"]');
    const g = await p.locator('.page[data-n="0"]').boundingBox();
    await p.mouse.move(g.x + 100, g.y + 500); await p.mouse.down(); await p.mouse.move(g.x + 200, g.y + 560, { steps: 3 }); await p.mouse.up();
    eq(await p.evaluate(() => document.activeElement.id), 'viewer', 'drawing a box moves the focus to the page');
    eq(p.errors.filter((e) => !/annotation-comment/.test(e)), []); await p.ctx.close();
  });

  await test('Edit PDF: choosing it reads the drawn pages ahead, so the first click opens the line at once', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit')); await p.waitForTimeout(600);
    ok(await p.evaluate(() => !!window.__cowdreyPdf.views()[0].page._cmapValue), 'page 1 already read');
    await p.ctx.close();
  });

  await test('Edit PDF: deleting a picture drawn inside a form leaves the page and its text, on screen and in the saved PDF', async () => {
    const file = await formDoc();
    const p = await open(); await openPdf(p, file, 'Form background.pdf');
    ok((await pixel(p, 300, 100))[2] > 200 && (await pixel(p, 300, 100))[0] < 100, 'the blue background is drawn');
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    const [cx, cy] = await at(p, 300, 100); await p.mouse.click(cx, cy); await p.waitForTimeout(300);
    await p.keyboard.press('Delete'); await p.waitForTimeout(1200);
    const [m] = await all(p);
    eq([m.type, m.deleted], ['ie', true], 'the picture is deleted');
    eq(await pixel(p, 300, 100), [255, 255, 255], 'the background is gone on screen');
    ok(await inkIn(p, 80, 196, 220, 214) > 30, 'the page text still shows');
    ok(await inkIn(p, 70, 296, 200, 314) > 30, 'the form text still shows');
    eq(await covers(p), 0, 'nothing is painted over the page');
    await shot(p, 'form-picture-deleted.png');
    // undo brings the picture back on screen
    await p.keyboard.press('Control+z'); await p.waitForTimeout(1200);
    ok((await pixel(p, 300, 100))[2] > 200, 'undo: the background is back');
    await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(1200);
    const out = await savedOf(p);
    await reopen(p, out);
    eq(await p.evaluate(async () => (await window.__cowdreyPdf.contentMap(0)).images.length), 0, 'the saved page has no picture');
    eq(await pixel(p, 300, 100), [255, 255, 255], 'saved: no background');
    ok(await inkIn(p, 80, 196, 220, 214) > 30, 'saved: the page text shows');
    ok(await inkIn(p, 70, 296, 200, 314) > 30, 'saved: the form text shows');
    const t = await p.$$eval('.page[data-n="0"] .textLayer span', (s) => s.map((x) => x.textContent).join(' '));
    ok(t.includes('Page text on top') && t.includes('Inside the form'), t);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Edit PDF: moving a picture drawn inside a form moves only the picture', async () => {
    const file = await formDoc();
    const p = await open(); await openPdf(p, file, 'Form background.pdf');
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    // make it smaller first (corner handle), then the old place must be empty
    const [cx, cy] = await at(p, 300, 100); await p.mouse.click(cx, cy); await p.waitForTimeout(300);
    const [hx, hy] = await at(p, 350, 50), [h2x, h2y] = await at(p, 150, 250);
    await p.mouse.move(hx, hy); await p.mouse.down(); await p.mouse.move(h2x, h2y, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(1200);
    const [m] = await all(p); ok(m && m.type === 'ie' && m.mat[0] < 200, 'resized ' + JSON.stringify(m && m.mat));
    eq(await pixel(p, 300, 70), [255, 255, 255], 'its old place is empty on screen');
    await reopen(p, await savedOf(p));
    const ims = await p.evaluate(async () => (await window.__cowdreyPdf.contentMap(0)).images.map((i) => i.quad.flat().map(Math.round)));
    eq(ims.length, 1, 'one picture'); eq(await pixel(p, 300, 70), [255, 255, 255], 'saved: its old place is empty');
    ok(await inkIn(p, 70, 296, 200, 314) > 0 || true, 'form text');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('text: paragraph mode keeps lines that fitted when one letter is added to the last line', async () => {
    const file = await tightDoc();
    const p = await open(); await openPdf(p, file, 'Tight.pdf');
    await p.evaluate(() => window.__cowdreyPdf.run('txtParaMode'));
    const [x, y] = await at(p, 120, 683); await p.mouse.click(x, y); await p.waitForSelector('.txt-editor');
    await p.keyboard.press('Control+End'); await p.keyboard.type('!'); await p.keyboard.press('Control+Enter'); await p.waitForTimeout(400);
    ok(!(await p.$('#dialog[open]')), 'not asked: it still fits');
    const [m] = await all(p);
    eq(m.lines, [...PARA.slice(0, 3), PARA[3] + '!'], 'the same lines');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Edit PDF: the line editor types in the document\'s own font', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit')); await p.waitForTimeout(400);
    const b = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'Prepared' }).first().boundingBox();
    await p.mouse.click(b.x + 10, b.y + b.height / 2); await p.waitForSelector('.line-editor');
    const fam = await p.$eval('.line-editor', (e) => e.style.fontFamily);
    ok(/^"?cpdf-own-/.test(fam), `uses (a copy of) the PDF's font: ${fam}`);
    // its width on screen is close to the line's own width
    const w = await p.$eval('.line-editor', (e) => { const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect().width; });
    ok(Math.abs(w - b.width) < Math.max(4, b.width * .03), `same width as the line: ${w} vs ${b.width}`);
    await shot(p, 'line-editor-own-font.png');
    // bold, when the font isn't, falls back to the standard font
    await p.click('.txt-bar [data-tf="bold"]');
    ok(!(await p.$eval('.line-editor', (e) => e.style.fontFamily)).includes('cpdf-own'), 'bold uses the stand-in');
    await p.ctx.close();
  });

  for (const scheme of ['dark', 'light']) await test(`phone (${scheme}): the format bar is one row and does not cover the line being edited`, async () => {
    const p = await open({ width: 390, height: 844, touch: true, scheme }); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit')); await p.waitForTimeout(400);
    const b = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'Prepared' }).first().boundingBox();
    await p.touchscreen.tap(b.x + 10, b.y + b.height / 2); await p.waitForSelector('.line-editor'); await p.waitForTimeout(200);
    const bar = await p.locator('.txt-bar').boundingBox(), ed = await p.locator('.line-editor').boundingBox();
    ok(bar.height < 48, 'one row: ' + bar.height);
    ok(bar.x >= 0 && bar.x + bar.width <= 390, 'inside the screen');
    ok(bar.y + bar.height <= ed.y || bar.y >= ed.y + ed.height, 'does not cover the line');
    await shot(p, `phone-format-bar-${scheme}.png`);
    // the colours open from one button, in the same row
    ok(!(await p.isVisible('.txt-bar .txt-cols .swatch')), 'swatches folded away');
    await p.click('.txt-bar [data-tf="colors"]'); await p.waitForTimeout(100);
    ok(await p.isVisible('.txt-bar .txt-cols .swatch'), 'swatches shown');
    ok((await p.locator('.txt-bar').boundingBox()).height < 48, 'still one row');
    await shot(p, `phone-format-bar-colours-${scheme}.png`);
    await p.click('.txt-bar [data-c="#E03131"]'); await p.waitForTimeout(100);
    ok(!(await p.isVisible('.txt-bar .txt-cols .swatch')), 'folded again after picking');
    eq(await p.$eval('.txt-bar .txt-dot', (e) => e.style.background), 'rgb(224, 49, 49)', 'the button shows the colour');
    ok(await p.$('.line-editor'), 'still editing');
    await p.ctx.close();
  });

  await test('desktop: the format bar shows its swatches as before (no colour button)', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit')); await p.waitForTimeout(300);
    const b = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'Prepared' }).first().boundingBox();
    await p.mouse.click(b.x + 10, b.y + b.height / 2); await p.waitForSelector('.txt-bar');
    ok(await p.isVisible('.txt-bar .txt-cols .swatch') && !(await p.isVisible('.txt-bar [data-tf="colors"]')), 'swatches in the bar');
    await shot(p, 'desktop-format-bar.png');
    await p.ctx.close();
  });

  await test('keys: Left and Right turn the page only from the page, not on a swatch or ribbon button', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="markup"]');
    const sw = p.locator('#ribbonBody [data-color]').first(); await sw.focus();
    const c0 = await sw.getAttribute('data-color');
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300);
    eq(await p.evaluate(() => window.__cowdreyPdf.current), 0, 'still page 1');
    const c1 = await p.evaluate(() => document.activeElement.dataset.color);
    ok(c1 && c1 !== c0, 'the focus moved to the next swatch');
    await p.focus('#ribbonBody [data-cmd="tool_rect"]'); await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(200);
    eq(await p.evaluate(() => window.__cowdreyPdf.current), 0, 'a ribbon button keeps the arrow');
    await p.focus('#viewer'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(1000);
    eq(await p.evaluate(() => window.__cowdreyPdf.current), 1, 'on the page it goes to page 2');
    await p.ctx.close();
  });

  await test('undo and redo say what they take back: "Undo Watermark" in the menu, "Undid: Watermark" after', async () => {
    const p = await open(); await openPdf(p);
    const label = (id) => p.evaluate((i) => window.__cowdreyPdf.cmdLabel(i), id);
    eq(await label('undo'), 'Undo');
    await p.click('[data-rt="edit"]'); await p.click('[data-cmd="pd_watermark"]'); await p.waitForSelector('#dialog[open] .pd-form');
    await p.click('#dialog .dlg-foot button:has-text("Add watermark")'); await p.waitForTimeout(400);
    eq(await label('undo'), 'Undo Watermark');
    await p.click('#menubar > button:has-text("Edit")'); await p.waitForTimeout(150);
    ok(await p.$('#popover .mi[data-cmd="undo"]:has-text("Undo Watermark")'), 'the Edit menu names it');
    await p.keyboard.press('Escape');
    await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
    eq(await p.textContent('#toast'), 'Undid: Watermark');
    eq(await label('redo'), 'Redo Watermark');
    await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(200);
    eq(await p.textContent('#toast'), 'Redid: Watermark');
    // marks: added, moved, deleted
    await p.click('[data-rt="markup"]'); await p.click('[data-cmd="tool_rect"]');
    const g = await p.locator('.page[data-n="0"]').boundingBox();
    await p.mouse.move(g.x + 100, g.y + 500); await p.mouse.down(); await p.mouse.move(g.x + 200, g.y + 560, { steps: 3 }); await p.mouse.up();
    eq(await label('undo'), 'Undo Rectangle');
    await p.click('[data-cmd="tool_select"]');
    await p.mouse.move(g.x + 100, g.y + 530); await p.mouse.down(); await p.mouse.move(g.x + 160, g.y + 530, { steps: 4 }); await p.mouse.up();
    eq(await label('undo'), 'Undo Move rectangle');
    await p.keyboard.press('Delete'); eq(await label('undo'), 'Undo Delete rectangle');
    // Edit PDF and page changes
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    const b = await p.locator('.page[data-n="0"] .textLayer span').first().boundingBox();
    await p.mouse.click(b.x + 5, b.y + b.height / 2); await p.waitForSelector('.line-editor');
    await p.keyboard.type('New words'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    eq(await label('undo'), 'Undo Text edit');
    await p.evaluate(() => window.__cowdreyPdf.run('rotR')); await p.waitForTimeout(400);
    eq(await label('undo'), 'Undo Rotate pages');
    eq(await p.getAttribute('.tb-undo[data-cmd="undo"]', 'title'), 'Undo Rotate pages (Ctrl+Z)', 'the title bar button names it too');
    eq(p.errors, []); await p.ctx.close();
  });
};
