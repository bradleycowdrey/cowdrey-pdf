// Edit PDF's feedback: the cursor for each tool, a hover outline that always matches what a click would do, and the
// faint outline of everything editable while Edit PDF is on (src/app.js onEditHover / editHints, src/template.html).
import os from 'node:os';
import zlib from 'node:zlib';

// A solid-colour PNG, w x h.
function png(w, h, [r, g, b]) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), cr = Buffer.alloc(4); len.writeUInt32BE(data.length); cr.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export default async (h) => {
  const { test, eq, ok, open, openPdf, WORD } = h;
  // A brochure page: a full-page picture with a line of text over it (as on the PDFelement guide's cover).
  async function brochure() {
    const L = h.require(h.path.join(h.root, 'desktop/node_modules/pdf-lib'));
    const pdf = await L.PDFDocument.create(), pg = pdf.addPage([612, 792]), font = await pdf.embedFont(L.StandardFonts.Helvetica);
    pg.drawImage(await pdf.embedPng(png(16, 16, [210, 225, 245])), { x: 0, y: 0, width: 612, height: 792 });
    pg.drawText('Hey there!', { x: 250, y: 400, size: 24, font, color: L.rgb(0.1, 0.3, 0.9) });
    const file = h.path.join(h.fs.mkdtempSync(h.path.join(os.tmpdir(), 'cpdf-fb-')), 'brochure.pdf'); h.fs.writeFileSync(file, await pdf.save());
    return file;
  }

  await test('edit feedback: each tool has its cursor (I-beam for Add text and Note, crosshair for shapes); the hover cursor goes with Edit PDF', async () => {
    const p = await open(); await openPdf(p);
    const cur = () => p.$eval('.page[data-n="0"] .marks', (m) => getComputedStyle(m).cursor);
    const got = {};
    for (const t of ['tool_text', 'tool_note', 'tool_rect', 'cm_oval', 'tool_erase', 'tool_edit']) { await p.evaluate((t) => window.__cowdreyPdf.run(t), t); got[t] = await cur(); }
    eq(got, { tool_text: 'text', tool_note: 'text', tool_rect: 'crosshair', cm_oval: 'crosshair', tool_erase: 'crosshair', tool_edit: 'default' });
    // over a line, Edit PDF shows an I-beam; another tool then shows its own cursor, not the one left by the hover
    const b = await p.locator('.page[data-n="0"] .textLayer span').first().boundingBox();
    await p.mouse.move(b.x + 10, b.y + b.height / 2, { steps: 3 }); await p.waitForTimeout(300);
    eq(await cur(), 'text', 'I-beam over text');
    await p.evaluate(() => window.__cowdreyPdf.run('tool_rect'));
    eq(await cur(), 'crosshair', 'Rectangle after Edit PDF');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('edit feedback: the hover outline and cursor follow the pointer to where it stops (text over a full-page picture)', async () => {
    const p = await open(); await openPdf(p, await brochure(), 'Brochure.pdf');
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit')); await p.waitForTimeout(800);
    const b = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'Hey there' }).first().boundingBox();
    const state = () => p.evaluate(() => { const m = document.querySelector('.page[data-n="0"] .marks'), hv = m.querySelectorAll('.content-hover'); return [m.style.cursor, hv.length, hv.length ? Math.round(hv[0].getBoundingClientRect().height) : 0]; });
    for (let i = 0; i < 4; i++) {
      await p.mouse.move(b.x - 120, b.y - 60 - i * 15); await p.waitForTimeout(250);
      eq((await state())[0], 'move', 'on the picture');
      await p.mouse.move(b.x + 10, b.y + b.height / 2, { steps: 8 }); await p.waitForTimeout(350);
      const [c, n, hh] = await state();
      eq([c, n], ['text', 1], 'on the text, try ' + i); ok(hh < b.height * 2, 'the outline is the line, not the picture: ' + hh);
    }
    await p.mouse.click(b.x + 10, b.y + b.height / 2); await p.waitForSelector('.line-editor');
    eq(await p.textContent('.line-editor'), 'Hey there!', 'a click edits what the outline showed');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('edit feedback: paragraph mode hover is up to date too', async () => {
    const p = await open(); await openPdf(p, await brochure(), 'Brochure.pdf');
    await p.evaluate(() => window.__cowdreyPdf.run('txtEditParas')); await p.waitForTimeout(800);
    const b = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'Hey there' }).first().boundingBox();
    await p.mouse.move(b.x - 120, b.y - 60); await p.waitForTimeout(250);
    await p.mouse.move(b.x + 10, b.y + b.height / 2, { steps: 8 }); await p.waitForTimeout(350);
    eq(await p.$eval('.page[data-n="0"] .marks', (m) => m.style.cursor), 'text');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('edit feedback: Edit PDF faintly outlines every line and picture it can edit; they go when another tool is chosen', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit')); await p.waitForTimeout(800);
    const cm = await p.evaluate(async () => { const c = await window.__cowdreyPdf.contentMap(0); return c.lines.length + c.images.length; });
    eq((await p.evaluate(() => window.__cowdreyPdf.editHints()))[0], cm, 'one outline each');
    ok(await p.$eval('.page[data-n="0"] .marks .content-hints', (g) => getComputedStyle(g).pointerEvents === 'none' && g.parentNode.firstChild === g), 'under the marks, not clickable');
    // the hover outline is stronger than the hints
    const [hw, hintW] = await p.evaluate(() => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'polygon'); s.setAttribute('class', 'content-hover'); const m = document.querySelector('.page[data-n="0"] .marks'); m.appendChild(s); const r = [parseFloat(getComputedStyle(s).strokeWidth), parseFloat(getComputedStyle(m.querySelector('.content-hints')).strokeWidth)]; s.remove(); return r; });
    ok(hw > hintW, `hover ${hw} > hints ${hintW}`);
    await p.evaluate(() => window.__cowdreyPdf.run('tool_select'));
    eq((await p.evaluate(() => window.__cowdreyPdf.editHints()))[0], 0, 'gone with Select');
    eq(p.errors.filter((e) => !/annotation-comment/.test(e)), []); await p.ctx.close();
  });
};
