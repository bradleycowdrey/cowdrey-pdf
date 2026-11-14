// Saved-output correctness of editing on real PDFs: page content is never written still compressed, editing the
// first run of a mixed-style line keeps the runs after it, centred lines stay centred, the caret goes where the
// click was, Combine keeps form field names unique, Shrink to fit keeps line spacing, and redaction removes the
// comments it covers at once.
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const SHOTS = '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr5/fix-saveacc/';
const GUIDE = '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/guide/';
let H;
// The saved file, passed back as base64 (a big PDF as a JSON array of numbers would not fit in memory).
const savedBig = async (p) => Buffer.from(await p.evaluate(async () => { const b = await window.__cowdreyPdf.buildPdf(); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }), 'base64');
const shot = async (p, name) => { try { H.fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: SHOTS + name }); } catch {} };
const tmp = (name) => H.path.join(H.fs.mkdtempSync(H.path.join(os.tmpdir(), 'cpdf-sacc-')), name);
const pdfLib = () => H.require(H.path.join(H.root, 'desktop/node_modules/pdf-lib'));
let pdfjsMod = null;
const pdfjs = async () => pdfjsMod || (pdfjsMod = await import(H.path.join(H.root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs')));
const atN = (p, n, x, y) => p.evaluate(([n, x, y]) => { const v = window.__cowdreyPdf.views()[n]; const [vx, vy] = v.viewport.convertToViewportPoint(x, y); const r = v.el.getBoundingClientRect(); return [r.left + vx, r.top + vy]; }, [n, x, y]);
const lineOf = (p, text, n = 0) => p.evaluate(async ([t, n]) => { const cm = await window.__cowdreyPdf.contentMap(n); const L = cm.lines.find((l) => l.str.includes(t)); return L && { str: L.str, tm: L.tm, width: L.width, quad: L.quad }; }, [text, n]);
const all = (p) => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat());
const showPage = async (p, n) => { await p.evaluate((k) => window.__cowdreyPdf.views()[k].el.scrollIntoView(), n); await p.waitForTimeout(1000); };
const caret = (p) => p.evaluate(() => { const el = document.activeElement; if (el.tagName === 'TEXTAREA') return [el.selectionStart, el.selectionEnd, el.value]; const s = getSelection(), r = s.rangeCount && s.getRangeAt(0); return r ? [r.startOffset, r.endOffset, el.textContent] : null; });
// Text items of a saved page (1-based), in content order.
async function itemsOf(bytes, n = 1) {
  const L = await pdfjs(), d = await L.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const pg = await d.getPage(n), tc = await pg.getTextContent(), [, , pw] = pg.view; await d.loadingTask.destroy();
  return Object.assign(tc.items.filter((i) => i.str.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, font: i.fontName })), { pw });
}
// Every page's decoded content: nothing still compressed in it (a zlib header, 78 9C), and poppler reads it
// without errors (when pdftotext is installed) on the pages asked.
async function cleanContent(bytes, pages, original) {
  const L = pdfLib(), d = await L.PDFDocument.load(bytes), bad = [];
  d.getPages().forEach((pg, k) => {
    const c = pg.node.Contents(); if (!c) return;
    const arr = c instanceof L.PDFArray ? c.asArray().map((r) => d.context.lookup(r)) : [c];
    const s = arr.map((st) => Buffer.from(st instanceof L.PDFRawStream ? L.decodePDFRawStream(st).decode() : st.getUnencodedContents()).toString('latin1')).join('\n');
    if (/\x78\x9c/.test(s.replace(/\bBI\b[\s\S]*?\bEI\b/g, ''))) bad.push(k + 1);
  });
  H.ok(!bad.length, 'compressed bytes in the content of pages ' + bad);
  let has = true; try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch { has = false; }
  if (!has) return;
  const errors = (file, n) => (spawnSync('pdftotext', ['-f', String(n), '-l', String(n), file, '/dev/null'], { encoding: 'latin1' }).stderr || '').split('\n').filter((l) => /Syntax Error|Unknown operator/.test(l)).length;
  const f = tmp('saved.pdf'); H.fs.writeFileSync(f, bytes);
  for (const n of pages) { const now = errors(f, n), was = original ? errors(original, n) : 0; H.ok(now <= was, `pdftotext reports ${now} errors on page ${n} (the original had ${was})`); }
}

export default async (h) => {
  H = h;
  const { test, eq, ok, open, openPdf, savedOf, reopen } = h;
  const GFILE = GUIDE + 'pdfelement-guide.pdf', MFILE = GUIDE + 'pe10-win.pdf';

  await test('saving edits never writes compressed bytes into page content (brochure: line edit, picture delete, watermark; manual: line and paragraph edit)', async () => {
    if (!h.fs.existsSync(GFILE)) return;
    const p = await open(); await openPdf(p, GFILE, 'Guide.pdf');
    await showPage(p, 1);
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    const b = await p.locator('.page[data-n="1"] .textLayer span', { hasText: 'Edit Your PDF' }).first().boundingBox();
    await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await p.waitForSelector('.line-editor');
    await p.keyboard.type('X'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    let out = await savedOf(p);
    await cleanContent(out, [2], GFILE);
    // and with a picture deleted on page 1 and a watermark on every page
    await showPage(p, 0);
    const [cx, cy] = await atN(p, 0, 500, 350); await p.mouse.click(cx, cy); await p.waitForTimeout(500);
    await p.keyboard.press('Delete'); await p.waitForTimeout(1500);
    await p.evaluate(() => window.__cowdreyPdf.run('pd_watermark')); await p.waitForSelector('#dialog[open] .pd-form');
    await p.click('#dialog .dlg-foot .btn.primary'); await p.waitForTimeout(400);
    out = await savedOf(p);
    await cleanContent(out, [1, 2], GFILE);
    // Text recognition over page 1, twice (the second time takes the first layer out), then saved again
    await p.evaluate(async () => {
      window.__cowdreyPdf.ocrUseEngine({ async start() {}, async stop() {}, async recognize(c) { const w = c.width, k = w / 1000; return { lines: [{ baseline: { x0: 100 * k, y0: 200 * k, x1: 400 * k, y1: 200 * k }, words: [{ text: 'Recognized', bbox: { x0: 100 * k, y0: 170 * k, x1: 400 * k, y1: 200 * k }, confidence: 90 }] }] }; } });
      await window.__cowdreyPdf.ocrRun({ pages: [0], redo: true }); await window.__cowdreyPdf.ocrRun({ pages: [0], redo: true });
    });
    await p.waitForTimeout(800);
    out = await savedOf(p);
    await cleanContent(out, [1, 2], GFILE);
    // Saved again after reopening, with one more edit
    await reopen(p, out); await showPage(p, 1);
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    const E = await lineOf(p, 'Edit Y', 1); ok(E, 'the edited line is there');
    const [ex, ey] = await atN(p, 1, E.tm[4] + 4, E.tm[5] + 4); await p.mouse.click(ex, ey); await p.waitForSelector('.line-editor');
    await p.keyboard.type('Y'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    await cleanContent(await savedOf(p), [2], GFILE);
    eq(p.errors, []); await p.ctx.close();
    if (!h.fs.existsSync(MFILE)) return;
    const q = await open(); await openPdf(q, MFILE, 'Manual.pdf');
    await showPage(q, 5);
    await q.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    const M = await lineOf(q, 'with PDF files easier', 5); ok(M, 'manual line');
    const [mx, my] = await atN(q, 5, M.tm[4] + 20, M.tm[5] + 4); await q.mouse.click(mx, my); await q.waitForSelector('.line-editor');
    await q.keyboard.type('X'); await q.keyboard.press('Escape'); await q.waitForTimeout(300);
    const mout = await savedBig(q);
    await cleanContent(mout, [6], MFILE);
    await q.ctx.close();
  });
  await test('editing the first run of a mixed-style line moves the runs after it as they are (colour, slant, size), on screen and saved', async () => {
    if (!h.fs.existsSync(GFILE)) return;
    const p = await open(); await openPdf(p, GFILE, 'Guide.pdf');
    await showPage(p, 1);
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    const row = await p.evaluate(async () => (await window.__cowdreyPdf.contentMap(1)).lines.filter((l) => Math.abs(l.tm[5] - 815.58) < 1).map((l) => ({ s: l.str, x: l.tm[4], w: l.width })));
    eq(row.map((r) => r.s), ['Change the', 'size', ', color and', 'font styles', 'of any'], 'the line, in runs');
    // A double click on "Change" selects the word; typing replaces it
    const [cx, cy] = await atN(p, 1, row[0].x + 25, 823); await p.mouse.dblclick(cx, cy); await p.waitForSelector('.line-editor'); await p.waitForTimeout(300);
    eq((await caret(p)).slice(0, 2), [0, 6], 'the word selected');
    await p.keyboard.type('THE NEW'); await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
    const ms = await all(p), te = ms.find((m) => m.orig === 'Change the');
    eq(te.text, 'THE NEW the');
    const fol = ms.filter((m) => m !== te);
    eq(fol.map((m) => [m.orig, m.text === m.orig, !!m.shiftOnly]), [['size', true, true], [', color and', true, true], ['font styles', true, true], ['of any', true, true]], 'every run after it moves, unchanged');
    const dx = fol[0].dx; ok(Math.abs(dx) > 5 && fol.every((m) => Math.abs(m.dx - dx) < .01), 'all by the same amount: ' + fol.map((m) => m.dx));
    // On screen the moved runs are the page's own drawing: "color" stays blue
    await p.mouse.move(5, 5); await p.waitForTimeout(500);
    await shot(p, 'mixed-run-screen.png');
    const blueIn = (q, x0, x1) => q.evaluate(async ([x0, x1]) => {
      // the page as shown: its canvas, then each picture of the marks layer over it
      const v = window.__cowdreyPdf.views()[1], c = v.el.querySelector('canvas.pdf'), k = c.width / v.viewport.width;
      const o = document.createElement('canvas'); o.width = c.width; o.height = c.height; const g = o.getContext('2d'); g.drawImage(c, 0, 0);
      for (const im of v.el.querySelectorAll('svg.marks image')) { const i = new Image(); i.src = im.getAttribute('href'); await i.decode(); g.drawImage(i, +im.getAttribute('x') * k, +im.getAttribute('y') * k, +im.getAttribute('width') * k, +im.getAttribute('height') * k); }
      for (const pg of v.el.querySelectorAll('svg.marks polygon')) { void pg; }
      const [ax, ay] = v.viewport.convertToViewportPoint(x0, 835), [bx, by] = v.viewport.convertToViewportPoint(x1, 808);
      const d = g.getImageData(ax * k, ay * k, (bx - ax) * k, (by - ay) * k).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 180 && d[i] < 120) n++;
      return n;
    }, [x0, x1]);
    const cx0 = row[2].x + dx + 10, cx1 = row[2].x + dx + 80;
    ok(await blueIn(p, cx0, cx1) > 30, 'blue on screen where "color" now is');
    const out = await savedOf(p), it = (await itemsOf(out, 2)).filter((i) => Math.abs(i.y - 815.58) < 2);
    const txt = it.map((i) => i.s).join('|');
    eq((txt.match(/styles/g) || []).length, 1, 'no second copy of a moved word: ' + txt);
    const find = (re) => it.find((i) => re.test(i.s));
    for (const [re, k] of [[/^size/, 1], [/color/, 2], [/font/, 3], [/of any/, 4]]) { const i = find(re); ok(i && Math.abs(i.x - (row[k].x + dx)) < .6, `${re} saved where the screen put it: ${i && i.x} vs ${row[k].x + dx}`); }
    ok(/THE\|?\s?NEW/.test(txt), 'new text saved: ' + txt);
    await reopen(p, out); await showPage(p, 1);
    ok(await blueIn(p, cx0, cx1) > 30, 'and blue in the saved file');
    eq(p.errors, []); await p.ctx.close();
  });
  await test('a centred title stays centred when edited or replaced; right-aligned text grows left; nothing runs off the page', async () => {
    if (h.fs.existsSync(GFILE)) {
      const p = await open(); await openPdf(p, GFILE, 'Guide.pdf');
      await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
      const W = await lineOf(p, 'Welcome to');
      const [ex, ey] = await atN(p, 0, W.tm[4] + W.width - 3, W.tm[5] + 20); await p.mouse.click(ex, ey); await p.waitForSelector('.line-editor');
      await p.keyboard.press('End'); await p.keyboard.type(' you'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
      await shot(p, 'centred-edit-screen.png');
      // Replace all on the brochure: the cover's second title line grows too
      await p.keyboard.press('Control+h'); await p.waitForSelector('#dialog[open] #txtFind');
      await p.fill('#txtFind', 'PDFelement'); await p.fill('#txtWith', 'PDFElemental');
      await p.click('#dialog .dlg-foot button:has-text("Replace all")');
      await p.waitForFunction(() => /replaced|Nothing/.test(document.querySelector('#txtStatus').textContent), null, { timeout: 60000 });
      await p.click('#dialog .dlg-foot button:has-text("Close")'); await p.waitForTimeout(600);
      const out = await savedOf(p), it = await itemsOf(out, 1), pw = it.pw;
      const line = (re) => { const row = it.filter((i) => re.test(i.s)); return row.length && { x0: Math.min(...row.map((i) => i.x)), x1: Math.max(...row.map((i) => i.x + i.w)) }; };
      const wl = line(/Welcome/), pl = line(/PDFElemental 11/);
      ok(wl && Math.abs((wl.x0 + wl.x1) / 2 - 496.5) < 4, 'the edited title is centred: ' + JSON.stringify(wl));
      ok(pl && Math.abs((pl.x0 + pl.x1) / 2 - 496.3) < 4 && pl.x1 < pw, 'the replaced title is centred: ' + JSON.stringify(pl));
      ok(it.every((i) => i.x >= 0 && i.x + i.w <= pw + .5), 'nothing past the page edge');
      eq(p.errors, []); await p.ctx.close();
    }
    // A small page: two right-aligned lines, two centred ones and a long left line near the right edge
    const L = pdfLib(), pdf = await L.PDFDocument.create(), pg = pdf.addPage([400, 300]), font = await pdf.embedFont(L.StandardFonts.Helvetica);
    const right = (t, y) => pg.drawText(t, { x: 370 - font.widthOfTextAtSize(t, 12), y, size: 12, font });
    const centre = (t, y) => pg.drawText(t, { x: 200 - font.widthOfTextAtSize(t, 12) / 2, y, size: 12, font });
    right('Total due', 260); right('Paid in full', 245); centre('A short title', 200); centre('A longer subtitle line', 185);
    pg.drawText('Body text that ends near the edge', { x: 150, y: 100, size: 12, font });
    const file = tmp('align.pdf'); H.fs.writeFileSync(file, await pdf.save());
    const q = await open(); await openPdf(q, file, 'Align.pdf');
    await q.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    const was = {}, edit = async (find, typed) => {
      const T = was[find] = await lineOf(q, find), [x, y] = await atN(q, 0, T.tm[4] + 4, T.tm[5] + 4);
      await q.mouse.click(x, y); await q.waitForSelector('.line-editor'); await q.keyboard.press('End'); await q.keyboard.type(typed); await q.keyboard.press('Enter'); await q.waitForTimeout(400);
    };
    await edit('Total due', ' this month'); await edit('A short title', ' made longer'); await edit('Body text', ' and then a lot more words, far too many for this page');
    eq(await q.textContent('#toast'), 'This line is longer than the page has room for. Undo takes it back.');
    const its = await itemsOf(await savedOf(q)), at = (re) => its.find((i) => re.test(i.s));
    const t = at(/this month/), c = at(/made longer/), b = at(/lot more/);
    const T0 = was['Total due'], C0 = was['A short title'];
    ok(Math.abs(t.x + t.w - (T0.tm[4] + T0.width)) < 1, 'right-aligned: same right edge ' + (t.x + t.w));
    ok(Math.abs(c.x + c.w / 2 - (C0.tm[4] + C0.width / 2)) < 1, 'centred: same centre ' + (c.x + c.w / 2));
    ok(b.x >= 17.5 && b.x <= 18.5, 'the long line moved back, 18 pt from the left edge: ' + b.x);
    await shot(q, 'aligned-screen.png');
    // Undo brings the long line back where it was
    await q.keyboard.press('Control+z'); await q.waitForTimeout(300);
    eq((await all(q)).map((m) => m.orig).sort(), ['A short title', 'Total due'], 'undone');
    eq(q.errors, []); await q.ctx.close();
  });
  await test('a click at the end of a line on the manual puts the caret at the end (the PDF\'s own letter widths), and inside it between the right letters', async () => {
    if (!h.fs.existsSync(MFILE)) return;
    const p = await open(); await openPdf(p, MFILE, 'Manual.pdf');
    await showPage(p, 5);
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    const lines = await p.evaluate(async () => (await window.__cowdreyPdf.contentMap(5)).lines.filter((l) => l.str.length > 40).slice(0, 3).map((l) => ({ str: l.str, tm: l.tm, width: l.width })));
    ok(lines.length === 3, 'three long lines');
    const tryAt = async (L, x) => {
      const [cx, cy] = await atN(p, 5, x, L.tm[5] + 3); await p.mouse.click(cx, cy); await p.waitForSelector('.line-editor'); await p.waitForTimeout(200);
      const c = await caret(p); await p.keyboard.press('Escape'); await p.waitForTimeout(200); return c;
    };
    for (const L of lines) {
      const end = await tryAt(L, L.tm[4] + L.width - 1.5);
      eq(end.slice(0, 2), [L.str.length, L.str.length], 'at the end of "' + L.str + '"');
      const start = await tryAt(L, L.tm[4] + 1);
      eq(start.slice(0, 2), [0, 0], 'at the start');
      // in the middle of the last word: between its letters, not at its end
      const w = L.str.trimEnd().match(/(\S+)$/), k = w.index;
      const mid = await tryAt(L, L.tm[4] + L.width - (L.width / L.str.length) * w[1].length / 2);
      ok(mid[0] > k && mid[0] < L.str.length, `inside "${w[1]}": ${mid[0]} (${k}..${L.str.length})`);
    }
    // typing after a click at the end adds to the end
    const L = lines[0], [cx, cy] = await atN(p, 5, L.tm[4] + L.width - 1.5, L.tm[5] + 3);
    await p.mouse.click(cx, cy); await p.waitForSelector('.line-editor'); await p.keyboard.type('X'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    eq((await all(p)).find((m) => m.orig === L.str).text, L.str + 'X');
    eq(p.errors, []); await p.ctx.close();
  });
  await test('Combine: a form field from the added PDF whose name is taken gets its own name, and still works', async () => {
    const SAMPLE = H.path.join(H.root, 'tests/fixtures/sample.pdf');
    const p = await open(); await openPdf(p, SAMPLE, 'Form.pdf');
    await p.fill('.annotationLayer input[name="name"]', 'Jane Filled');
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.evaluate(() => window.__cowdreyPdf.run('merge'))]);
    await fc.setFiles([SAMPLE]); await p.waitForSelector('#dialog[open]');
    await p.click('#dialog .btn.primary'); await p.waitForTimeout(800);
    const out = await savedOf(p), form = (await pdfLib().PDFDocument.load(out)).getForm();
    const names = form.getFields().map((f) => f.getName());
    eq(names.slice().sort(), ['agree', 'agree_2', 'name', 'name_2'], 'unique names');
    eq(form.getTextField('name').getText(), 'Jane Filled', 'the first keeps its value');
    eq(form.getTextField('name_2').getText(), undefined, 'the added one is its own field');
    eq(form.getTextField('name_2').acroField.getWidgets().length, 1, 'with its widget');
    // reopened, the second one can be filled on its own
    await reopen(p, out); await p.waitForTimeout(600);
    await p.evaluate(() => window.__cowdreyPdf.views()[3] && window.__cowdreyPdf.views()[3].el.scrollIntoView()); await p.waitForTimeout(1200);
    await p.fill('.annotationLayer input[name="name_2"]', 'Second');
    eq(await p.inputValue('.annotationLayer input[name="name"]'), 'Jane Filled', 'the first is not linked to it');
    const f2 = (await pdfLib().PDFDocument.load(await savedOf(p))).getForm();
    eq([f2.getTextField('name').getText(), f2.getTextField('name_2').getText()], ['Jane Filled', 'Second']);
    eq(p.errors, []); await p.ctx.close();
  });
};
