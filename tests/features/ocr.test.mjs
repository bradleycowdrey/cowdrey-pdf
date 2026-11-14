// OCR: scanned pages get an invisible text layer that is searchable, selectable, editable and saved.
// The recognizer is a stand-in (tesseract.js is not downloaded in tests): it returns the words that were drawn into
// the scan, with their boxes, in the pixels of the 300 dpi page image it is given.
export default async (h) => {
  const { test, eq, ok, open, require, path, root, PDFDocument, savedOf, reopen, marks } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const LINES = ['The quick brown fox jumps', 'over the lazy pelican.', 'Invoice 4471 due 12 March'];

  // A scan: lines of text drawn on a 200 dpi image (Letter), as PNG, with each word's box. `sideways` turns the
  // picture a quarter turn left (as a page fed in the wrong way), for a page that is then rotated to read upright.
  async function makeScan(p, lines, sideways = false, font = 'bold 54px Arial, Helvetica, sans-serif') {
    return p.evaluate(([lines, sideways, font]) => {
      const W = 1700, H = 2200, c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.fillStyle = '#111'; x.font = font; x.textBaseline = 'alphabetic';
      const out = [];
      lines.forEach((line, k) => {
        const by = 300 + k * 120, words = []; let cx = 160;
        for (const w of line.split(' ')) {
          const m = x.measureText(w); x.fillText(w, cx, by);
          words.push({ text: w, bbox: { x0: cx, y0: by - m.actualBoundingBoxAscent, x1: cx + m.width, y1: by + m.actualBoundingBoxDescent }, confidence: 92 });
          cx += m.width + x.measureText(' ').width;
        }
        out.push({ baseline: { x0: 160, y0: by, x1: cx, y1: by }, words });
      });
      let img = c;
      if (sideways) { img = document.createElement('canvas'); img.width = H; img.height = W; const y = img.getContext('2d'); y.translate(0, W); y.rotate(-Math.PI / 2); y.drawImage(c, 0, 0); }
      return { png: img.toDataURL('image/png').split(',')[1], lines: out, W, H };
    }, [lines, sideways, font]);
  }
  async function scanPdf(scans, typedPage) {
    const d = await PDFDocument.create();
    for (const s of scans) {
      const img = await d.embedPng(Buffer.from(s.png, 'base64'));
      const [w, hh] = s.sideways ? [792, 612] : [612, 792];
      d.addPage([w, hh]).drawImage(img, { x: 0, y: 0, width: w, height: hh });
    }
    if (typedPage) { const pg = d.addPage([612, 792]); pg.drawText(typedPage, { x: 72, y: 700, size: 14, font: await d.embedFont(L.StandardFonts.Helvetica) }); }
    return Buffer.from(await d.save());
  }
  async function openBytes(p, bytes, name = 'Scan.pdf') {
    await p.evaluate(async ([b, n]) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); await window.__cowdreyPdf.openBytes(u, n); }, [bytes.toString('base64'), name]);
    await p.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 15000 }); await p.waitForTimeout(500);
  }
  // The stand-in recognizer. It also notes what it was given: the image size, the rotation, the language, and
  // whether the image really has ink where the first word is.
  async function useFake(p, scans, opts = {}) {
    await p.evaluate(([scans, opts]) => {
      window.__ocr = { calls: [], started: [], stopped: 0 };
      let k = 0;
      window.__cowdreyPdf.ocrUseEngine({
        async start(lang) { window.__ocr.started.push(lang); },
        async recognize(canvas, { lang, rotation, onProgress }) {
          const s = scans[Math.min(k++, scans.length - 1)], f = canvas.width / s.W;
          const box = (b) => ({ x0: b.x0 * f, y0: b.y0 * f, x1: b.x1 * f, y1: b.y1 * f });
          const b = box(s.lines[0].words[0].bbox), d = canvas.getContext('2d').getImageData(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0).data;
          let ink = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 100) ink++;
          window.__ocr.calls.push({ w: canvas.width, h: canvas.height, rotation, lang, ink: ink / (d.length / 4) });
          onProgress(.5);
          if (opts.hang) await new Promise(() => {});
          return { lines: s.lines.map((l) => ({ baseline: { x0: l.baseline.x0 * f, y0: l.baseline.y0 * f, x1: l.baseline.x1 * f, y1: l.baseline.y1 * f }, words: l.words.map((w) => ({ ...w, bbox: box(w.bbox) })) })) };
        },
        async stop() { window.__ocr.stopped++; },
      });
    }, [scans.map((s) => ({ lines: s.lines, W: s.W })), opts]);
  }
  const ocrDialog = async (p) => { await p.click('[data-rt="edit"]'); await p.click('[data-cmd="ocr"]'); await p.waitForSelector('#dialog[open] .ocr-dlg'); };
  const waitDone = (p) => p.waitForFunction(() => !document.querySelector('#dialog[open] .ocr-prog') && document.querySelector('#toast.show'), null, { timeout: 20000 });
  const textOfPage = (p, n) => p.evaluate(async (n) => { const v = window.__cowdreyPdf.views()[n]; const tc = await v.page.getTextContent(); return tc.items.map((i) => i.str).join(' ').replace(/\s+/g, ' '); }, n);
  const layerText = (p, n) => p.$$eval(`.page[data-n="${n}"] .textLayer span`, (s) => s.map((x) => x.textContent).join(' '));
  // Where a line's text sits on screen, against where its words are on the scan.
  const lineFit = (p, n, scan, li) => p.evaluate(([n, line, W]) => {
    const el = document.querySelector(`.page[data-n="${n}"]`), r = el.getBoundingClientRect(), k = r.width / W;
    const first = line.words[0].text, span = [...el.querySelectorAll('.textLayer span')].find((s) => s.textContent.startsWith(first));
    if (!span) return null;
    const s = span.getBoundingClientRect(), b0 = line.words[0].bbox, b1 = line.words[line.words.length - 1].bbox;
    return { left: s.left - (r.left + b0.x0 * k), right: s.right - (r.left + b1.x1 * k), base: s.bottom - (r.top + line.baseline.y0 * k), h: s.height, px: (line.baseline.y0 - b0.y0) * k };
  }, [n, scan.lines[li], scan.W]);

  await test('OCR: a scanned page is read at 300 dpi; its words become invisible text you can select and find; saved and reopened', async () => {
    const p = await open();
    const scan = await makeScan(p, LINES);
    await openBytes(p, await scanPdf([scan], 'Already typed text on this page.'));
    ok(await p.isVisible('#ocrHint'), 'a scanned PDF offers to recognize its text');
    eq(await layerText(p, 0), '', 'no text before');
    await useFake(p, [scan]);
    await ocrDialog(p);
    await p.check('#dialog [name="ocrWhich"][value="all"]');
    await p.click('#dialog .btn.primary'); await waitDone(p);
    const calls = await p.evaluate(() => window.__ocr.calls);
    eq(calls.length, 1, 'the typed page is skipped');
    eq([calls[0].w, calls[0].h, calls[0].rotation, calls[0].lang], [2550, 3300, 0, 'eng'], '300 dpi');
    ok(calls[0].ink > .15, 'the page image has the scan on it: ' + calls[0].ink);
    eq(await p.evaluate(() => window.__ocr.stopped), 1, 'the engine is stopped after the run');
    ok(/Text recognized on 1 page \(1 page already had text\)/.test(await p.textContent('#toast')), await p.textContent('#toast'));
    ok(!(await p.isVisible('#ocrHint')), 'hint hidden');
    await p.waitForSelector('.page[data-n="0"] .textLayer span');
    const t = await layerText(p, 0);
    for (const l of LINES) ok(t.replace(/\s+/g, ' ').includes(l), `"${l}" in the text layer: ${t}`);
    // on top of the words on the scan
    for (let li = 0; li < LINES.length; li++) {
      const f = await lineFit(p, 0, scan, li);
      ok(f && Math.abs(f.left) < 4 && Math.abs(f.right) < 6 && Math.abs(f.base) < f.px * .45, `line ${li + 1} sits on its words: ${JSON.stringify(f)}`);
    }
    // Find, across the words of a line
    await p.keyboard.press('Control+f'); await p.fill('#findInput', 'lazy pelican'); await p.waitForTimeout(700);
    eq(await p.textContent('#findCount'), '1 of 1', 'found on screen');
    await p.keyboard.press('Escape');
    // Saved: the same file (one source, every page), with invisible Helvetica text over the picture
    const out = await savedOf(p);
    const d = await PDFDocument.load(out), pg = d.getPage(0);
    const content = pg.node.Contents(), raw = (content instanceof L.PDFArray ? content.asArray() : [content]).map((r) => { const st = d.context.lookup(r) || r; return Buffer.from(L.decodePDFRawStream ? L.decodePDFRawStream(st).decode() : st.getContents()).toString('latin1'); }).join('\n');
    ok(/\b3 Tr\b/.test(raw), 'text drawn in render mode 3 (invisible)');
    const fonts = pg.node.Resources().lookup(L.PDFName.of('Font'));
    ok(fonts.entries().some(([, r]) => /Helvetica/.test(String(d.context.lookup(r).get(L.PDFName.of('BaseFont'))))), 'Helvetica');
    eq(d.getPageCount(), 2);
    await reopen(p, out);
    const again = await textOfPage(p, 0);
    for (const l of LINES) ok(again.includes(l), `"${l}" in the saved PDF: ${again}`);
    ok(!(await p.isVisible('#ocrHint')), 'the saved PDF is not taken for a scan any more');
    await p.keyboard.press('Control+f'); await p.fill('#findInput', 'Invoice 4471'); await p.waitForTimeout(700);
    eq(await p.textContent('#findCount'), '1 of 1', 'found in the saved PDF');
    // selecting with the mouse copies the words
    const b = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'quick' }).first().boundingBox();
    await p.mouse.move(b.x + 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width - 2, b.y + b.height / 2, { steps: 6 }); await p.mouse.up();
    ok(/quick brown/.test(await p.evaluate(() => String(getSelection()))), 'selectable');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('OCR: undo takes the text away again and redo brings it back; the mark-up stays on the page', async () => {
    const p = await open();
    const scan = await makeScan(p, LINES);
    await openBytes(p, await scanPdf([scan]));
    await p.evaluate(() => window.__cowdreyPdf.run('tool_rect'));
    const g = await p.locator('.page[data-n="0"]').boundingBox();
    await p.mouse.move(g.x + 60, g.y + 400); await p.mouse.down(); await p.mouse.move(g.x + 200, g.y + 460, { steps: 3 }); await p.mouse.up();
    await useFake(p, [scan]);
    const r = await p.evaluate(() => window.__cowdreyPdf.ocrRun({ pages: [0] }));
    eq([r.pages, r.words > 10], [1, true]);
    eq(await marks(p), ['rect'], 'the box moved with the page');
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.map((e) => e.src)), [1], 'the page now comes from the copy with text');
    await p.waitForSelector('.page[data-n="0"] .textLayer span');
    await p.evaluate(() => window.__cowdreyPdf.run('undo')); await p.waitForTimeout(800);
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.map((e) => e.src)), [0], 'undo');
    eq(await layerText(p, 0), '', 'no text after undo'); eq(await marks(p), ['rect']);
    await p.evaluate(() => window.__cowdreyPdf.run('redo')); await p.waitForTimeout(800);
    ok((await layerText(p, 0)).includes('quick'), 'redo');
    const d = await PDFDocument.load(await savedOf(p));
    eq(d.getPageCount(), 1); ok(d.getPage(0).node.Contents(), 'saved');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('OCR: Edit PDF rewrites a recognized line; the saved PDF shows the new words and finds only them', async () => {
    const p = await open();
    const scan = await makeScan(p, LINES);
    await openBytes(p, await scanPdf([scan]));
    await useFake(p, [scan]);
    await p.evaluate(() => window.__cowdreyPdf.ocrRun({ pages: [0] }));
    await p.waitForSelector('.page[data-n="0"] .textLayer span');
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    const b = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'Invoice' }).first().boundingBox();
    await p.mouse.click(b.x + 10, b.y + b.height / 2);
    await p.waitForSelector('.line-editor'); eq(await p.textContent('.line-editor'), 'Invoice 4471 due 12 March');
    await p.keyboard.type('Invoice 4471 paid 9 March'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    const [m] = await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat());
    eq([m.type, m.ocr, m.text], ['te', true, 'Invoice 4471 paid 9 March'], 'an edit of OCR text');
    await reopen(p, await savedOf(p));
    const t = await textOfPage(p, 0);
    ok(t.includes('Invoice 4471 paid 9 March') && !t.includes('due 12 March') && t.includes('lazy pelican'), t);
    // the new words are drawn (visible), over a cleared area of the scan
    const ink = await p.evaluate(() => { const v = window.__cowdreyPdf.views()[0], c = v.el.querySelector('canvas.pdf'), k = c.width / v.viewport.width; const [x, y] = v.viewport.convertToViewportPoint(160 * 72 / 200, 792 - 540 * 72 / 200); const d = c.getContext('2d').getImageData(Math.round(x * k), Math.round((y - 14) * k), Math.round(200 * k), Math.round(14 * k)).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 120) n++; return n; });
    ok(ink > 30, 'new line drawn: ' + ink);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('OCR: a sideways scan turned to read upright is read upright; the text lies on its words', async () => {
    const p = await open();
    const scan = await makeScan(p, LINES, true); scan.sideways = true;
    await openBytes(p, await scanPdf([scan]));
    await p.evaluate(() => window.__cowdreyPdf.run('rotR')); await p.waitForTimeout(600);
    await useFake(p, [scan]);
    await p.evaluate(() => window.__cowdreyPdf.ocrRun({ pages: [0] }));
    const c = (await p.evaluate(() => window.__ocr.calls))[0];
    eq([c.w, c.h, c.rotation], [2550, 3300, 90], 'upright image'); ok(c.ink > .15, 'ink where the word is: ' + c.ink);
    await p.waitForSelector('.page[data-n="0"] .textLayer span');
    for (let li = 0; li < LINES.length; li++) {
      const f = await lineFit(p, 0, scan, li);
      ok(f && Math.abs(f.left) < 4 && Math.abs(f.right) < 6 && Math.abs(f.base) < f.px * .45, `line ${li + 1}: ${JSON.stringify(f)}`);
    }
    const out = await savedOf(p);
    eq((await PDFDocument.load(out)).getPage(0).getRotation().angle, 90, 'saved turned');
    await reopen(p, out);
    for (let li = 0; li < LINES.length; li++) {
      const f = await lineFit(p, 0, scan, li);
      ok(f && Math.abs(f.left) < 4 && Math.abs(f.right) < 6, `saved, line ${li + 1}: ${JSON.stringify(f)}`);
    }
    eq(p.errors, []); await p.ctx.close();
  });

  await test('OCR: language choice; letters Helvetica lacks (Cyrillic, Greek) are found and copied in the saved PDF', async () => {
    const p = await open();
    const lines = ['Привет мир документ', 'Καλημέρα κόσμε'];
    const scan = await makeScan(p, lines);
    await openBytes(p, await scanPdf([scan]));
    await useFake(p, [scan]);
    await ocrDialog(p);
    await p.selectOption('#ocrLang', 'rus');
    await p.click('#dialog .btn.primary'); await waitDone(p);
    eq(await p.evaluate(() => [window.__ocr.started, window.__ocr.calls.map((c) => c.lang)]), [['rus'], ['rus']]);
    await reopen(p, await savedOf(p));
    const t = await textOfPage(p, 0);
    for (const l of lines) ok(t.includes(l), `"${l}": ${t}`);
    await p.keyboard.press('Control+f'); await p.fill('#findInput', 'мир'); await p.waitForTimeout(700);
    eq(await p.textContent('#findCount'), '1 of 1');
    // the choice is remembered
    await p.keyboard.press('Escape'); await ocrDialog(p);
    eq(await p.inputValue('#ocrLang'), 'rus'); await p.click('#dialog .dlg-foot button:has-text("Cancel")');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('OCR: pages with text are skipped unless asked; recognizing again replaces the old layer', async () => {
    const p = await open();
    const scan = await makeScan(p, LINES);
    await openBytes(p, await scanPdf([scan, scan]));
    await useFake(p, [scan]);
    await p.evaluate(() => window.__cowdreyPdf.ocrRun({ pages: [0] }));
    await p.waitForSelector('.page[data-n="0"] .textLayer span');
    // a range: page 1 has text now, page 2 doesn't
    await ocrDialog(p); await p.fill('#ocrRange', '1-2'); await p.click('#dialog .btn.primary'); await waitDone(p);
    eq(await p.evaluate(() => window.__ocr.calls.length), 2, 'only page 2 read');
    await ocrDialog(p); await p.click('#dialog .btn.primary'); await p.waitForTimeout(500);
    ok(/Page 1 already has text/.test(await p.textContent('#toast')), await p.textContent('#toast'));
    eq(await p.evaluate(() => window.__ocr.calls.length), 2, 'nothing read');
    await ocrDialog(p); await p.check('#ocrRedo'); await p.click('#dialog .btn.primary'); await waitDone(p);
    eq(await p.evaluate(() => window.__ocr.calls.length), 3, 'read again when asked');
    await reopen(p, await savedOf(p));
    const t = await textOfPage(p, 0);
    eq(t.split('quick').length - 1, 1, 'the words once, not twice: ' + t);
    ok((await textOfPage(p, 1)).includes('lazy pelican'), 'page 2');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('OCR: Cancel stops a run and changes nothing; an engine that cannot load says so', async () => {
    const p = await open();
    const scan = await makeScan(p, LINES);
    await openBytes(p, await scanPdf([scan]));
    await useFake(p, [scan], { hang: true });
    await ocrDialog(p); await p.click('#dialog .btn.primary');
    await p.waitForFunction(() => window.__ocr && window.__ocr.calls.length === 1);
    ok(/Reading page 1/.test(await p.textContent('#dialog .ocr-status')), 'progress shown');
    ok(+(await p.getAttribute('#dialog .ocr-bar', 'aria-valuenow')) >= 40, 'progress moves');
    await p.click('#dialog .dlg-foot button:has-text("Cancel")'); await p.waitForTimeout(400);
    eq(await p.textContent('#toast'), 'Text recognition stopped');
    eq(await p.evaluate(() => [window.__cowdreyPdf.doc.sources.length, window.__cowdreyPdf.doc.pages[0].src, window.__ocr.stopped]), [1, 0, 1]);
    eq(await layerText(p, 0), '');
    // the real engine, from somewhere it can't be loaded
    await p.evaluate(() => { window.__cowdreyPdf.ocrUseEngine(null); window.__cowdreyPdf.ocrPaths.script = 'https://ocr.invalid/tesseract.min.js'; });
    await ocrDialog(p); await p.click('#dialog .btn.primary');
    await p.waitForFunction(() => /could not start/.test((document.querySelector('#dialog[open] h2') || {}).textContent || ''), null, { timeout: 15000 });
    await p.click('#dialog .dlg-foot button:has-text("OK")');
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.sources.length), 1, 'nothing changed');
    eq(p.errors.filter((e) => !/ocr\.invalid|Failed to load resource/.test(e)), []); await p.ctx.close();
  });

  await test('OCR: a protected PDF keeps its password and restrictions after recognizing text', async () => {
    const p = await open();
    const scan = await makeScan(p, LINES);
    const b64 = h.fs.readFileSync(path.join(root, 'tests/fixtures/protected.pdf')).toString('base64');
    const opening = p.evaluate(async (b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return window.__cowdreyPdf.openBytes(u, 'Secret.pdf'); }, b64);
    await p.waitForSelector('#dialog[open] #dlgInput'); await p.fill('#dlgInput', 'pelican'); await p.click('#dialog .btn.primary');
    await opening; await p.waitForTimeout(500);
    await useFake(p, [scan]);
    const r = await p.evaluate(() => window.__cowdreyPdf.ocrRun({ pages: [0], redo: true }));
    eq(r.pages, 1);
    eq(await p.isVisible('#dialog[open]'), false, 'no second password question');
    const C = require(path.join(root, 'desktop/node_modules/@cantoo/pdf-lib'));
    const build = p.evaluate(async () => Array.from(await window.__cowdreyPdf.buildPdf()));
    await h.answer(p, 'Keep password');
    const kept = Buffer.from(await build);
    await PDFDocument.load(kept).then(() => { throw new Error('opened without a password'); }, () => {});
    const d = await C.PDFDocument.load(kept, { password: 'pelican' });
    eq([d.getPageCount(), d.getForm().getFields().length], [3, 2], 'pages and form kept');
    const pdfjs = await import(path.join(root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
    const pd = await pdfjs.getDocument({ data: new Uint8Array(kept), password: 'pelican' }).promise;
    const perms = [...((await pd.getPermissions()) || [])];
    ok(perms.length && !perms.includes(pdfjs.PermissionFlag.COPY), 'copying still not allowed: ' + perms);
    ok((await (await pd.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ').includes('lazy pelican'), 'text added');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('OCR: the dialog fits a phone screen', async () => {
    const p = await open({ width: 390, height: 844, touch: true });
    const scan = await makeScan(p, LINES);
    await openBytes(p, await scanPdf([scan]));
    ok(await p.isVisible('#ocrHint'), 'hint on a phone');
    const hint = await p.locator('#ocrHint').boundingBox();
    ok(hint.x >= 0 && hint.x + hint.width <= 390, 'hint fits: ' + JSON.stringify(hint));
    await p.click('#ocrHint [data-ocr-go]'); await p.waitForSelector('#dialog[open] .ocr-dlg');
    const box = await p.locator('#dialog').boundingBox();
    ok(box.x >= 0 && box.x + box.width <= 390, 'dialog fits: ' + JSON.stringify(box));
    eq(await p.evaluate(() => document.documentElement.scrollWidth <= 390), true, 'no sideways scrolling');
    await p.click('#dialog .dlg-foot button:has-text("Cancel")');
    eq(p.errors, []); await p.ctx.close();
  });
};
