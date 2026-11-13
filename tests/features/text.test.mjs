// Text editing: paragraphs, the format bar, text boxes, and find and replace.
import os from 'node:os';

const PARA = [
  'The pelican project moved into its second phase this spring,',
  'with new stores joining the pilot and early results showing',
  'steady growth in every region we measured over the quarter.',
  'The team will report again in June.',
];
const NEW = 'The pelican project is now in its third phase. Twelve stores have joined the pilot, and the early results show steady growth in every region we measured. The team will report again in September, with the full numbers for the year.';

// A two-page PDF: a heading, a four-line paragraph (12 pt, 16 pt apart), a line on its own, and one on page 2.
// Set in Carlito (a TrueType font, embedded as Word would) when the machine has it, otherwise in Helvetica.
async function makeDoc(h) {
  const { PDFDocument, rgb, StandardFonts } = h.require(h.path.join(h.root, 'desktop/node_modules/pdf-lib'));
  const pdf = await PDFDocument.create();
  const dir = '/usr/share/fonts/truetype/crosextra/';
  let reg, bold;
  if (h.fs.existsSync(dir + 'Carlito-Regular.ttf')) {
    pdf.registerFontkit(h.require(h.path.join(h.root, 'desktop/node_modules/@pdf-lib/fontkit')));
    reg = await pdf.embedFont(h.fs.readFileSync(dir + 'Carlito-Regular.ttf'), { subset: false });
    bold = await pdf.embedFont(h.fs.readFileSync(dir + 'Carlito-Bold.ttf'), { subset: false });
  } else { reg = await pdf.embedFont(StandardFonts.Helvetica); bold = await pdf.embedFont(StandardFonts.HelveticaBold); }
  const p = pdf.addPage([612, 792]);
  p.drawText('Quarterly notes', { x: 72, y: 720, size: 22, font: bold, color: rgb(0.1, 0.1, 0.1) });
  PARA.forEach((t, k) => p.drawText(t, { x: 72, y: 680 - k * 16, size: 12, font: reg, color: rgb(0.1, 0.1, 0.1) }));
  p.drawText('Budget: 42,000 dollars, on track.', { x: 72, y: 560, size: 12, font: reg, color: rgb(0.1, 0.1, 0.1) });
  const p2 = pdf.addPage([612, 792]);
  p2.drawText('Budget review: 42,000 dollars in total.', { x: 72, y: 700, size: 12, font: reg, color: rgb(0.1, 0.1, 0.1) });
  const file = h.path.join(h.fs.mkdtempSync(h.path.join(os.tmpdir(), 'cpdf-text-')), 'notes.pdf');
  h.fs.writeFileSync(file, await pdf.save());
  return file;
}
const allMarks = (p) => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat());
const items = (p, n) => p.evaluate(async (n) => { const tc = await window.__cowdreyPdf.views()[n].page.getTextContent(); return tc.items.filter((i) => i.str.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], h: Math.hypot(i.transform[2], i.transform[3]), w: i.width })); }, n);
const fontNames = (h, d, n = 0) => { const L = h.require(h.path.join(h.root, 'desktop/node_modules/pdf-lib')); const fd = d.getPage(n).node.Resources().lookup(L.PDFName.of('Font')); return fd.entries().map(([, r]) => String(d.context.lookup(r).get(L.PDFName.of('BaseFont')))); };
const SHOTS = '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/text/';
const shot = async (p, name) => { try { h0.fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: SHOTS + name }); } catch {} };
let h0;

export default async (h) => {
  h0 = h;
  const { test, eq, ok, open, openPdf, savedOf, reopen, at, PDFDocument } = h;
  const file = await makeDoc(h);

  await test('text: paragraph mode edits a whole paragraph, re-wraps it to the block\'s width, and saves it in its own font', async () => {
    const p = await open(); await openPdf(p, file, 'Notes.pdf');
    await p.evaluate(() => window.__cowdreyPdf.run('txtParaMode'));
    eq(await p.evaluate(() => document.querySelector('.app').dataset.tool), 'edit', 'Edit PDF is on');
    const [x, y] = await at(p, 120, 667);
    await p.mouse.click(x, y); await p.waitForSelector('.txt-editor');
    eq(await p.inputValue('.txt-editor'), PARA.join(' '), 'the whole paragraph');
    ok(await p.$('.txt-bar [data-tf="center"]'), 'paragraphs can be aligned');
    await p.keyboard.press('Control+a'); await p.keyboard.type(NEW);
    await shot(p, 'paragraph-editing.png');
    await p.keyboard.press('Control+Enter'); await p.waitForTimeout(300);
    const [m] = await allMarks(p);
    eq([m.type, m.src.length, m.text], ['tpara', 4, NEW]);
    ok(m.lines.length >= 4 && m.lines.join(' ') === NEW, 'wrapped: ' + JSON.stringify(m.lines));
    ok(Math.abs(m.wrap - 300) < 60, 'wraps at the block width ' + m.wrap);
    await shot(p, 'paragraph-done.png');
    // Undo is one step; redo brings it back
    await p.evaluate(() => window.__cowdreyPdf.run('undo')); eq((await allMarks(p)).length, 0, 'undo');
    await p.evaluate(() => window.__cowdreyPdf.run('redo')); eq((await allMarks(p)).length, 1, 'redo');
    const out = await savedOf(p);
    const d = await PDFDocument.load(out);
    ok(!fontNames(h, d).some((f) => /Helvetica|Times/.test(f)) || !/Carlito/.test(fontNames(h, d).join()), 'no substitute font when the page font has every letter: ' + fontNames(h, d));
    await reopen(p, out);
    const it = await items(p, 0), text = it.map((i) => i.s).join(' ');
    ok(!/second phase|June/.test(text), 'old paragraph gone: ' + text);
    ok(text.replace(/\s+/g, ' ').includes('third phase') && text.includes('September'), 'new paragraph there');
    const ys = [...new Set(it.filter((i) => i.y < 690 && i.y > 560).map((i) => Math.round(i.y)))].sort((a, b) => b - a);
    eq(ys.slice(0, 4), [680, 664, 648, 632], 'lines 16 pt apart from the first baseline');
    ok(it.filter((i) => i.y < 690 && i.y > 570).every((i) => i.x + i.w <= 72 + m.wrap + 2 && Math.abs(i.x - 72) < 1), 'every line inside the block');
    ok(text.includes('Budget: 42,000') && text.includes('Quarterly notes'), 'the rest of the page is untouched');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('text: the format bar makes a line bigger, bold, red and underlined, on screen and in the saved PDF', async () => {
    const p = await open(); await openPdf(p, file, 'Notes.pdf');
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    const [x, y] = await at(p, 100, 563);
    await p.mouse.click(x, y); await p.waitForSelector('.line-editor'); await p.waitForSelector('.txt-bar');
    ok(!(await p.$('.txt-bar [data-tf="center"]')), 'a line has no alignment');
    await p.click('.txt-bar [data-tf="bigger"]'); await p.click('.txt-bar [data-tf="bigger"]');
    await p.click('.txt-bar [data-tf="bold"]'); await p.click('.txt-bar [data-tf="underline"]');
    await p.click('.txt-bar [data-tf="color"][data-c="#E03131"]');
    eq(await p.textContent('.txt-bar .txt-size'), '14');
    ok(await p.evaluate(() => document.activeElement.classList.contains('line-editor')), 'still typing in the line');
    await shot(p, 'line-format-bar.png');
    await p.keyboard.press('End'); await p.keyboard.type(' Approved.'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    const [m] = await allMarks(p);
    eq([m.type, m.text, m.size, m.color, m.bold, m.underline, m.std, m.wrap], ['tpara', 'Budget: 42,000 dollars, on track. Approved.', 14, '#E03131', true, true, true, 0]);
    // On screen: red letters where the line is
    const red = await p.evaluate(() => { const v = window.__cowdreyPdf.views()[0], svg = v.el.querySelector('svg.marks'); return !!svg.querySelector('image') && !!svg.querySelector('line[stroke="#E03131"]'); });
    ok(red, 'drawn in red, underlined');
    const out = await savedOf(p), d = await PDFDocument.load(out);
    ok(fontNames(h, d).includes('/Helvetica-Bold'), 'bold standard font: ' + fontNames(h, d));
    await reopen(p, out);
    const it = await items(p, 0), line = it.find((i) => /Approved/.test(i.s));
    ok(line && Math.abs(line.h - 14) < .2 && Math.round(line.y) === 560, 'set at 14 pt on the same baseline: ' + JSON.stringify(line));
    ok(!it.some((i) => i.s.includes('on track.') && !i.s.includes('Approved')), 'old line gone');
    const px = await p.evaluate(() => { const v = window.__cowdreyPdf.views()[0], c = v.el.querySelector('canvas.pdf'), k = c.width / v.viewport.width; const [x0, y0] = v.viewport.convertToViewportPoint(72, 572), [x1, y1] = v.viewport.convertToViewportPoint(300, 556); const g = c.getContext('2d').getImageData(Math.round(x0 * k), Math.round(y0 * k), Math.round((x1 - x0) * k), Math.round((y1 - y0) * k)); let r = 0; for (let i = 0; i < g.data.length; i += 4) if (g.data[i] > 170 && g.data[i + 1] < 110 && g.data[i + 2] < 110) r++; return r; });
    ok(px > 300, 'red in the saved PDF: ' + px);
    await shot(p, 'line-format-saved.png');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('text: Add text with font, bold, centring and a box it wraps in; edited later in place; old text marks still save', async () => {
    const p = await open(); await openPdf(p, file, 'Notes.pdf');
    await p.click('[data-rt="edit"]'); await p.click('[data-cmd="tool_text"]');
    const [x1, y1] = await at(p, 72, 500), [x2] = await at(p, 252, 500);
    await p.mouse.move(x1, y1); await p.mouse.down(); await p.mouse.move(x2, y1, { steps: 6 }); await p.mouse.up();
    await p.waitForSelector('#dialog[open] #dlgInput');
    eq(await p.inputValue('#txtBoxW'), '180', 'box width from the drag');
    await p.selectOption('#dialog select[data-tf="fam"]', 'serif');
    await p.click('#dialog [data-tf="bold"]'); await p.click('#dialog [data-tf="center"]'); await p.click('#dialog [data-tf="color"][data-c="#2448C9"]');
    await p.fill('#dlgInput', 'Signed off by the board on Tuesday, with thanks to every store in the pilot.');
    await shot(p, 'add-text-dialog.png');
    await p.click('#dialog .btn.primary'); await p.waitForTimeout(400);
    let [m] = await allMarks(p);
    eq([m.type, m.fam, m.bold, m.align, m.w, m.color], ['text', 'serif', true, 'center', 180, '#2448C9']);
    ok(m.lines.length >= 2 && m.lw.every((w) => w <= 180), 'wrapped: ' + JSON.stringify(m.lines));
    let out = await savedOf(p), d = await PDFDocument.load(out);
    ok(fontNames(h, d).includes('/Times-Bold'), 'Times bold: ' + fontNames(h, d));
    await reopen(p, out);
    const lines = (await items(p, 0)).filter((i) => i.y < 500 && i.y > 400);
    ok(lines.length >= 2, 'lines ' + JSON.stringify(lines));
    ok(lines.every((i) => Math.abs(i.x + i.w / 2 - (72 + 90)) < 1.5), 'centred in the box: ' + JSON.stringify(lines));
    // Edited later: double-click with Select, make it bigger, click away
    await openPdf(p, file, 'Notes.pdf');
    await p.click('[data-rt="edit"]'); await p.click('[data-cmd="tool_text"]');
    const [ax, ay] = await at(p, 100, 450); await p.mouse.click(ax, ay);
    await p.waitForSelector('#dialog[open] #dlgInput'); await p.fill('#dlgInput', 'Draft'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(400);
    [m] = await allMarks(p);
    eq([m.text, m.fam, m.bold, m.align], ['Draft', 'serif', true, 'center'], 'the last format is kept for the next text');
    const [bx, by] = await at(p, m.x + 5, m.y - 8);
    await p.mouse.dblclick(bx, by); await p.waitForSelector('.txt-editor'); await p.waitForSelector('.txt-bar [data-tf="fam"]');
    eq(await p.inputValue('.txt-editor'), 'Draft');
    await p.click('.txt-bar [data-tf="bigger"]'); await p.click('.txt-bar [data-tf="italic"]');
    await p.keyboard.press('End'); await p.keyboard.type(' copy');
    await shot(p, 'text-box-editing.png');
    const [cx, cy] = await at(p, 400, 200); await p.mouse.click(cx, cy); await p.waitForTimeout(400);
    [m] = await allMarks(p);
    eq([m.text, m.size, m.italic], ['Draft copy', 15, true], 'edited in place');
    await p.evaluate(() => window.__cowdreyPdf.run('undo')); await p.waitForTimeout(100);
    [m] = await allMarks(p); eq([m.text, m.size], ['Draft', 14], 'one undo step');
    // A text mark from an earlier version (no font, no box) draws and saves as before
    await p.evaluate(() => { const d = window.__cowdreyPdf.doc; d.marks['0:0'] = [{ id: 'old1', type: 'text', x: 72, y: 300, text: 'Old note\nsecond line', size: 14, color: '#111111', rot: 0 }]; });
    out = await savedOf(p); d = await PDFDocument.load(out);
    ok(fontNames(h, d).includes('/Helvetica'), 'Helvetica');
    await reopen(p, out);
    const old = (await items(p, 0)).filter((i) => /Old note|second line/.test(i.s)).map((i) => [i.s, Math.round(i.x), Math.round(i.y)]);
    eq(old, [['Old note', 72, 288], ['second line', 72, 271]]);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('text: Replace text… replaces a phrase on every page as edited lines, in one undo step; Replace does one at a time', async () => {
    const p = await open(); await openPdf(p, file, 'Notes.pdf');
    await p.keyboard.press('Control+h'); await p.waitForSelector('#dialog[open] #txtFind');
    await p.fill('#txtFind', '42,000'); await p.fill('#txtWith', '45,500');
    await shot(p, 'replace-dialog.png');
    await p.click('#dialog .dlg-foot button:has-text("Replace all")');
    await p.waitForFunction(() => /replaced|Nothing/.test(document.querySelector('#txtStatus').textContent));
    eq(await p.textContent('#txtStatus'), '2 replaced');
    ok(await p.evaluate(() => document.querySelector('#dialog').open), 'the dialog stays open');
    // Replace, one at a time, in the paragraph's first line
    await p.fill('#txtFind', 'PELICAN'); await p.fill('#txtWith', 'heron');
    await p.click('#dialog .dlg-foot button:has-text("Replace")'); await p.waitForTimeout(400);
    eq(await p.textContent('#txtStatus'), '1 replaced');
    await p.click('#dialog .dlg-foot button:has-text("Replace")'); await p.waitForTimeout(400);
    eq(await p.textContent('#txtStatus'), 'No more found');
    await p.click('#dialog .dlg-foot button:has-text("Close")');
    const ms = await allMarks(p);
    eq(ms.map((m) => [m.type, m.text]).sort(), [['te', 'Budget review: 45,500 dollars in total.'], ['te', 'Budget: 45,500 dollars, on track.'], ['te', 'The heron project moved into its second phase this spring,']]);
    await p.evaluate(() => window.__cowdreyPdf.run('undo')); eq((await allMarks(p)).length, 2, 'undo takes back the last Replace');
    await p.evaluate(() => window.__cowdreyPdf.run('undo')); eq((await allMarks(p)).length, 0, 'undo takes back Replace all in one step');
    await p.evaluate(() => window.__cowdreyPdf.run('redo')); await p.evaluate(() => window.__cowdreyPdf.run('redo'));
    const out = await savedOf(p);
    await reopen(p, out);
    await p.evaluate(() => window.__cowdreyPdf.views()[1].el.scrollIntoView()); await p.waitForTimeout(300);
    const t1 = (await items(p, 0)).map((i) => i.s).join(' '), t2 = (await items(p, 1)).map((i) => i.s).join(' ');
    ok(t1.includes('45,500') && !t1.includes('42,000') && t1.includes('heron') && !/pelican/i.test(t1), t1);
    ok(t2.includes('Budget review: 45,500') && !t2.includes('42,000'), t2);
    // In a paragraph made with paragraph mode, the paragraph's text is replaced and wrapped again
    await p.evaluate(() => { window.__cowdreyPdf.views()[0].el.scrollIntoView(); window.__cowdreyPdf.run('txtParaMode'); }); await p.waitForTimeout(300);
    const [x, y] = await at(p, 120, 651); await p.mouse.click(x, y); await p.waitForSelector('.txt-editor');
    await p.keyboard.press('End'); await p.keyboard.type(' More soon.'); await p.keyboard.press('Control+Enter'); await p.waitForTimeout(300);
    await p.keyboard.press('Control+h'); await p.waitForSelector('#dialog[open] #txtFind');
    await p.fill('#txtFind', 'soon'); await p.fill('#txtWith', 'in the spring');
    await p.click('#dialog .dlg-foot button:has-text("Replace all")'); await p.waitForTimeout(500);
    eq(await p.textContent('#txtStatus'), '1 replaced'); await p.click('#dialog .dlg-foot button:has-text("Close")');
    const para = (await allMarks(p)).find((m) => m.type === 'tpara');
    ok(para && para.text.endsWith('More in the spring.') && para.lines.join(' ') === para.text, JSON.stringify(para && para.lines));
    eq(p.errors, []); await p.ctx.close();
  });

  await test('text: the format bar fits a phone screen', async () => {
    const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p, file, 'Notes.pdf');
    await p.evaluate(() => window.__cowdreyPdf.run('txtParaMode'));
    const [x, y] = await at(p, 120, 667); await p.mouse.click(x, y); await p.waitForSelector('.txt-bar');
    const r = await p.$eval('.txt-bar', (b) => { const r = b.getBoundingClientRect(); return [r.left, r.right]; });
    ok(r[0] >= 0 && r[1] <= 390, 'bar inside the screen ' + r);
    eq(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await shot(p, 'phone-bar.png');
    await p.ctx.close();
  });
};
