// Protect tab: redaction, passwords and permissions, flatten, compress, remove hidden information.
export default async (h) => {
  const { test, eq, ok, open, openPdf, root, path, fs, require, PDFDocument, savedOf, marks, reopen, pageText, at, fixture, answer, waitPages, WORD, selectText } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const C = require(path.join(root, 'desktop/node_modules/@cantoo/pdf-lib'));
  const pdfjs = await import(path.join(root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
  const CHROME = path.join(root, 'tests/fixtures/chrome.pdf');
  const tmp = (name, bytes) => { const f = path.join(root, 'tests/fixtures', '.prot-' + name); fs.writeFileSync(f, bytes); return f; };
  const drag = async (p, [x1, y1], [x2, y2]) => { const [a, b] = await at(p, x1, y1), [c, d] = await at(p, x2, y2); await p.mouse.move(a, b); await p.mouse.down(); await p.mouse.move(c, d, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(150); };
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
  const textOf = async (bytes, password) => { const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password, standardFontDataUrl: path.join(root, 'desktop/node_modules/pdfjs-dist/standard_fonts/') }); const d = await task.promise; let s = ''; for (let i = 1; i <= d.numPages; i++) s += (await (await d.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ') + '\n'; await task.destroy(); return s; };
  const streamsOf = (d) => d.context.enumerateIndirectObjects().filter(([, o]) => o instanceof L.PDFRawStream).map(([, o]) => { try { return Buffer.from(L.decodePDFRawStream(o).decode()).toString('latin1'); } catch { return ''; } });
  const pageContent = (d, n = 0) => { const c = d.getPage(n).node.Contents(); const arr = c instanceof L.PDFArray ? c.asArray().map((r) => d.context.lookup(r)) : [c]; return arr.map((s) => Buffer.from(L.decodePDFRawStream(s).decode()).toString('latin1')).join('\n'); };
  const noErrors = (p) => eq(p.errors.filter((e) => !/annotation-comment/.test(e)), []);

  await test('Protect: search and redact a figure, an area of a picture and a note; the saved PDF no longer has them', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.click('[data-rt="protect"]');
    await p.click('[data-cmd="protRedSearch"]'); await p.fill('#dialog input[name=text]', '42,000'); await answer(p, 'Find'); await answer(p, 'Mark'); await p.waitForTimeout(300);
    eq(await marks(p), ['redact'], 'one match marked');
    ok(await p.$('.page[data-n="0"] .prot-red:not(.applied)'), 'red outline on the page');
    await p.click('[data-cmd="protRedArea"]');
    await drag(p, [380, 560], [460, 400]); // the left half of the picture
    await drag(p, [550, 720], [595, 680]); // the sticky note
    eq(await marks(p), ['redact', 'redact', 'redact']);
    await p.click('[data-cmd="protRedApply"]'); await answer(p, 'Apply'); await p.waitForTimeout(500);
    eq((await marks(p)).sort(), ['ae', 'redact', 'redact', 'redact'], 'the note is deleted with it');
    eq(await p.$$eval('.page[data-n="0"] .prot-red.applied', (e) => e.length), 3, 'black boxes on screen');
    ok(!(await pageText(p)).includes('42,000'), 'not selectable on screen');
    await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/protect/redact-word-applied.png' });
    const out = await savedOf(p);
    const d = await PDFDocument.load(out), orig = await PDFDocument.load(fs.readFileSync(WORD));
    const subs = (d.getPage(0).node.Annots() ? d.getPage(0).node.Annots().asArray() : []).map((r) => String(d.context.lookup(r).get(L.PDFName.of('Subtype'))));
    eq(subs, ['/Square'], 'the note is gone, the square (not under a redaction) stays');
    // the original page content and picture are not left anywhere in the file
    const before = pageContent(orig);
    ok(!streamsOf(d).some((s) => s.includes(before)), 'original content stream removed');
    const origImg = orig.context.enumerateIndirectObjects().find(([, o]) => o instanceof L.PDFRawStream && String(o.dict.get(L.PDFName.of('Subtype'))) === '/Image' && !String(o.dict.get(L.PDFName.of('ColorSpace'))).includes('Gray'))[1];
    ok(out.indexOf(Buffer.from(origImg.getContents().slice(0, 200))) < 0, 'original picture removed');
    const txt = await textOf(out);
    ok(!txt.includes('42,000') && !txt.includes('42') && txt.includes('Budget:') && txt.includes('dollars, on track.'), txt);
    ok(txt.includes('Project Pelican') && txt.includes('second phase'), 'other lines untouched');
    await reopen(p, out);
    // The picture is still there, its covered half painted over in its own pixels
    const px = await p.evaluate(async () => {
      const v = window.__cowdreyPdf.views()[0], cm = await window.__cowdreyPdf.contentMap(0), im = cm.images[0];
      const obj = await new Promise((r) => (im.objId.startsWith('g_') ? v.page.commonObjs : v.page.objs).get(im.objId, r));
      const c = document.createElement('canvas'); c.width = obj.width; c.height = obj.height; const g = c.getContext('2d');
      if (obj.bitmap) g.drawImage(obj.bitmap, 0, 0); else { const id = g.createImageData(obj.width, obj.height); const bpp = obj.data.length / (obj.width * obj.height); for (let i = 0; i < obj.width * obj.height; i++) { for (let k = 0; k < 3; k++) id.data[i * 4 + k] = obj.data[i * bpp + (bpp >= 3 ? k : 0)]; id.data[i * 4 + 3] = bpp === 4 ? obj.data[i * 4 + 3] : 255; } g.putImageData(id, 0, 0); }
      const at = (ux, uy) => [...g.getImageData(Math.floor(ux * obj.width), Math.floor(uy * obj.height), 1, 1).data];
      const left = [[.1, .2], [.3, .5], [.45, .8]].map(([x, y]) => at(x, y)), right = []; for (let x = .6; x < 1; x += .05) for (let y = .05; y < 1; y += .05) right.push(at(x, y));
      return { n: cm.images.length, left, rightSome: right.some((q) => q[3] > 0 && q[0] + q[1] + q[2] > 60) };
    });
    eq(px.n, 1, 'one picture');
    ok(px.left.every((q) => q[0] < 16 && q[1] < 16 && q[2] < 16 && q[3] > 240), 'covered pixels are black: ' + JSON.stringify(px.left));
    ok(px.rightSome, 'uncovered half kept');
    await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/protect/redact-word-saved.png' });
    noErrors(p); await p.ctx.close();
  });

  await test('Protect: redact a word in a PDF from Chrome, with text on the box; neighbouring words stay in place', async () => {
    const p = await open(); await openPdf(p, CHROME, 'Summary.pdf');
    await run(p, 'protRedSearch'); await p.fill('#dialog input[name=text]', 'grew'); await answer(p, 'Find'); await answer(p, 'Mark'); await p.waitForTimeout(300);
    await run(p, 'protRedApply'); await p.waitForSelector('#dialog[open] input[name=label]');
    await p.fill('#dialog input[name=label]', 'Redacted'); await p.click('#dialog [data-sw="#E03131"]'); await answer(p, 'Apply'); await p.waitForTimeout(400);
    const m = await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().find((x) => x.type === 'redact'));
    eq([m.applied, m.fill, m.label], [true, '#e03131', 'Redacted']);
    const lineEnd = () => p.evaluate(async () => { const tc = await window.__cowdreyPdf.views()[0].page.getTextContent(); return tc.items.filter((i) => /quarter\.$/.test(i.str)).map((i) => [Math.round((i.transform[4] + i.width) * 2) / 2, Math.round(i.transform[5])]); });
    const orig = await lineEnd();
    const out = await savedOf(p);
    const txt = (await textOf(out)).replace(/\s+/g, ' ');
    ok(!/grew/.test(txt), txt);
    ok(txt.includes('Revenue') && /in every region this quarter/.test(txt) && txt.includes('Quarterly summary') && txt.includes('Next review'), txt);
    ok(txt.includes('Redacted'), 'overlay text');
    await reopen(p, out);
    const now = await lineEnd();
    eq(now, orig, 'the rest of the line has not moved');
    const [qx, qy] = [Math.min(m.quads[0][0][0], m.quads[0][2][0]) + 1, (m.quads[0][0][1] + m.quads[0][2][1]) / 2];
    const red = await p.evaluate(([x0, y0]) => { const v = window.__cowdreyPdf.views()[0], c = v.el.querySelector('canvas.pdf'), k = c.width / v.viewport.width; const [x, y] = v.viewport.convertToViewportPoint(x0, y0); return [...c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data]; }, [qx, qy]);
    ok(red[0] > 180 && red[1] < 90, 'red box drawn: ' + red);
    await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/protect/redact-chrome-saved.png' });
    noErrors(p); await p.ctx.close();
  });

  await test('Protect: mark selected text for redaction; undo and redo applying; patterns find emails and phone numbers', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await run(p, 'protRedText');
    await selectText(p, 0, 'Prepared by', .2); await p.waitForTimeout(300);
    eq(await marks(p), ['redact'], 'selection marked');
    await run(p, 'protRedApply'); await answer(p, 'Apply'); await p.waitForTimeout(300);
    await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
    eq(await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().map((m) => !!m.applied)), [false], 'undo');
    await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(200);
    eq(await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().map((m) => !!m.applied)), [true], 'redo');
    const txt = await textOf(await savedOf(p));
    ok(!/Prepared/.test(txt) && txt.includes('3 March.') && txt.includes('Budget'), txt);
    // patterns
    const d = await L.PDFDocument.create(), pg = d.addPage([612, 792]), f = await d.embedFont(L.StandardFonts.Helvetica);
    pg.drawText('Call 555-123-4567 or write to jo.smith@example.com today.', { x: 72, y: 700, size: 12, font: f });
    pg.drawText('Reference 2024-01-05 and invoice 42 stay.', { x: 72, y: 670, size: 12, font: f });
    const file = tmp('contact.pdf', await d.save());
    await openPdf(p, file, 'Contact.pdf');
    eq(await p.evaluate(() => window.__cowdreyPdf.protFind({ email: true, phone: true })), ['555-123-4567', 'jo.smith@example.com']);
    await run(p, 'protRedSearch'); await p.waitForSelector('#dialog[open] input[name=text]');
    await p.fill('#dialog input[name=text]', ''); await p.check('#dialog input[name=email]'); await p.check('#dialog input[name=phone]'); await answer(p, 'Find'); await answer(p, 'Mark'); await p.waitForTimeout(300);
    await run(p, 'protRedApply'); await answer(p, 'Apply'); await p.waitForTimeout(300);
    const t2 = await textOf(await savedOf(p));
    ok(!/555|4567|example|smith/.test(t2) && t2.includes('Call') && t2.includes('today.') && t2.includes('2024-01-05') && t2.includes('invoice 42 stay.'), t2);
    fs.unlinkSync(file); noErrors(p); await p.ctx.close();
  });

  await test('Protect: redact on a rotated page: the dragged area and the saved box cover the same words', async () => {
    const p = await open(); await openPdf(p, CHROME, 'Summary.pdf');
    await run(p, 'rotR'); await p.waitForTimeout(500);
    // Where "grew" is, in PDF coordinates (from Search and redact, then undone), and drag over it on the turned page.
    await run(p, 'protRedSearch'); await p.fill('#dialog input[name=text]', 'grew'); await answer(p, 'Find'); await answer(p, 'Mark'); await p.waitForTimeout(300);
    const b = await p.evaluate(() => { const q = Object.values(window.__cowdreyPdf.doc.marks).flat().find((x) => x.type === 'redact').quads[0]; const xs = q.map((t) => t[0]), ys = q.map((t) => t[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; });
    await run(p, 'undo'); await p.waitForTimeout(100); eq(await marks(p), []);
    const x0 = b[0], y0 = b[1] + 2, gw = b[2] - b[0];
    await p.click('[data-rt="protect"]'); await p.click('[data-cmd="protRedArea"]');
    await drag(p, [b[0], b[1]], [b[2], b[3]]);
    eq(await marks(p), ['redact']);
    await run(p, 'protRedApply'); await answer(p, 'Apply'); await p.waitForTimeout(400);
    await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/protect/redact-rotated-applied.png' });
    const out = await savedOf(p), d = await PDFDocument.load(out);
    eq(d.getPage(0).getRotation().angle % 360, 90, 'page still turned');
    const txt = (await textOf(out)).replace(/\s+/g, ' ');
    ok(!/gre|\bw in/.test(txt) && txt.includes('Revenue') && /in every region/.test(txt), txt);
    await reopen(p, out);
    const px = await p.evaluate(([x, y]) => { const v = window.__cowdreyPdf.views()[0], c = v.el.querySelector('canvas.pdf'), k = c.width / v.viewport.width; const [vx, vy] = v.viewport.convertToViewportPoint(x, y); return [...c.getContext('2d').getImageData(Math.round(vx * k), Math.round(vy * k), 1, 1).data]; }, [x0 + gw / 2, y0 + 3]);
    ok(px[0] < 30 && px[1] < 30 && px[2] < 30, 'black box over the word: ' + px);
    await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/protect/redact-rotated-saved.png' });
    noErrors(p); await p.ctx.close();
  });

  await test('Protect: set an open password and limits; the PDF opens only with it and keeps the limits', async () => {
    const p = await open(); await openPdf(p);
    await run(p, 'protPassword'); await p.waitForSelector('#dialog[open] input[name=open]');
    await p.fill('#dialog input[name=open]', 'heron'); await p.fill('#dialog input[name=open2]', 'herring');
    await p.check('#dialog input[name=limit]'); await p.fill('#dialog input[name=owner]', 'boss-only');
    await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/protect/password-dialog.png' });
    await answer(p, 'Set password');
    await p.waitForFunction(() => /different/.test((document.querySelector('#dialog[open] .prot-err') || {}).textContent || ''));
    await p.fill('#dialog input[name=open2]', 'heron'); await answer(p, 'Set password'); await p.waitForTimeout(200);
    eq(await p.evaluate(() => JSON.stringify(window.__cowdreyPdf.doc.marks).includes('heron')), false, 'the password is not kept with the document');
    const out = await savedOf(p);
    await PDFDocument.load(out).then(() => { throw new Error('opened without a password'); }, () => {});
    let e = null; try { await pdfjs.getDocument({ data: new Uint8Array(out) }).promise; } catch (x) { e = x; }
    eq(e && e.name, 'PasswordException');
    eq((await C.PDFDocument.load(out, { password: 'heron' })).getPageCount(), 3);
    const task = pdfjs.getDocument({ data: new Uint8Array(out), password: 'heron' }), pd = await task.promise, perms = [...((await pd.getPermissions()) || [])];
    ok(perms && perms.includes(pdfjs.PermissionFlag.PRINT) && !perms.includes(pdfjs.PermissionFlag.COPY) && !perms.includes(pdfjs.PermissionFlag.MODIFY_CONTENTS), 'limits: ' + perms);
    ok((await textOf(out, 'heron')).includes('Cowdrey.PDF'), 'readable with the password');
    await task.destroy();
    // undo: no password again
    await run(p, 'undo'); await p.waitForTimeout(100);
    eq((await PDFDocument.load(await savedOf(p))).getPageCount(), 3, 'undo removes it');
    noErrors(p); await p.ctx.close();
  });

  await test('Protect: remove security from a PDF opened with its password (saving doesn\'t ask to keep it)', async () => {
    const p = await open();
    const opening = p.evaluate(async (b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return window.__cowdreyPdf.openBytes(u, 'Secret.pdf'); }, fixture('protected.pdf'));
    await p.waitForSelector('#dialog[open] #dlgInput'); await p.fill('#dlgInput', 'pelican'); await p.click('#dialog .btn.primary');
    eq(await opening, true); await waitPages(p); await p.waitForTimeout(300);
    await run(p, 'protUnsecure'); await p.waitForTimeout(100);
    const asked = p.waitForSelector('#dialog[open]', { timeout: 4000 }).then(() => 'asked', () => 'not asked');
    const out = await savedOf(p);
    eq(await Promise.race([asked, new Promise((r) => setTimeout(() => r('not asked'), 300))]), 'not asked');
    const d = await PDFDocument.load(out); eq([d.isEncrypted, d.getPageCount()], [false, 3]);
    // a new password replaces the original one
    await run(p, 'protPassword'); await p.waitForSelector('#dialog[open] input[name=open]');
    await p.fill('#dialog input[name=open]', 'egret'); await p.fill('#dialog input[name=open2]', 'egret'); await answer(p, 'Set password'); await p.waitForTimeout(100);
    const out2 = await savedOf(p);
    await C.PDFDocument.load(out2, { password: 'pelican' }).then(() => { throw new Error('the old password still opens it'); }, () => {});
    eq((await C.PDFDocument.load(out2, { password: 'egret' })).getPageCount(), 3);
    noErrors(p); await p.ctx.close();
  });

  await test('Protect: flatten makes form fields and comments part of the page', async () => {
    const p = await open(); await openPdf(p);
    await p.fill('.annotationLayer input[name="name"]', 'Bradley Cowdrey'); await p.click('.annotationLayer .checkBox input');
    await p.click('[data-rt="markup"]'); await p.click('[data-cmd="tool_note"]');
    const g = await p.locator('.page[data-n="0"]').boundingBox(); await p.mouse.click(g.x + 400, g.y + 650);
    await p.fill('#dlgInput', 'Looks good'); await p.click('#dialog .btn.primary');
    await run(p, 'protFlatten'); await answer(p, 'Flatten'); await p.waitForTimeout(200);
    ok(await p.$eval('.annotationLayer input[name="name"]', (e) => e.disabled), 'fields locked on screen');
    const out = await savedOf(p), d = await PDFDocument.load(out);
    ok(!d.catalog.get(L.PDFName.of('AcroForm')), 'no form left');
    const an = d.getPage(0).node.Annots(); eq(an ? an.size() : 0, 0, 'no annotations left');
    ok(/Bradley Cowdrey/.test(await textOf(out)), 'typed value is page content');
    const cs = streamsOf(d).join('\n'); ok(/CPDFFlat-?\d+ Do/.test(cs), 'appearances drawn into the page');
    await reopen(p, out);
    eq(await p.$$eval('.page[data-n="0"] .annotationLayer input', (e) => e.length), 0, 'no fields when reopened');
    await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/protect/flatten-saved.png' });
    noErrors(p); await p.ctx.close();
  });

  await test('Protect: a redaction box from text stays off the line above on tight leading', async () => {
    const d0 = await L.PDFDocument.create(), pg = d0.addPage([612, 792]);
    const dir = '/usr/share/fonts/truetype/crosextra/';
    let font; // a font with a tall ascent and deep descent (about 1.22 em), as many designer fonts have
    if (fs.existsSync(dir + 'Carlito-Bold.ttf')) { d0.registerFontkit(require(path.join(root, 'desktop/node_modules/@pdf-lib/fontkit'))); font = await d0.embedFont(fs.readFileSync(dir + 'Carlito-Bold.ttf')); }
    else font = await d0.embedFont(L.StandardFonts.HelveticaBold);
    pg.drawText('Welcome to', { x: 72, y: 700, size: 40, font }); pg.drawText('PDFelement here', { x: 72, y: 660, size: 40, font }); // 40 pt on 40 pt
    const file = tmp('tight.pdf', await d0.save());
    try {
      const p = await open(); await openPdf(p, file, 'Tight.pdf');
      const [quads] = await p.evaluate(() => window.__cowdreyPdf.protFindQuads({ text: 'PDFelement', wholeWords: true }));
      const ys = quads[0].map((q) => q[1]), top = Math.max(...ys), bottom = Math.min(...ys);
      ok(top <= 700 - .22 * 40 + .01, 'stays below the letters of the line above: top ' + top);
      ok(top >= 660 + .72 * 40 - .01 && bottom <= 660 - .14 * 40 + .01, `still covers the word: ${bottom} – ${top}`);
      // applied: the line above keeps its words
      await p.click('[data-rt="protect"]');
      await p.click('[data-cmd="protRedSearch"]'); await p.fill('#dialog input[name=text]', 'PDFelement'); await answer(p, 'Find'); await answer(p, 'Mark'); await p.waitForTimeout(300);
      await p.click('[data-cmd="protRedApply"]'); await answer(p, 'Apply'); await p.waitForTimeout(500);
      await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr1/fix-features/redact-tight.png' });
      const t = await textOf(await savedOf(p));
      ok(t.includes('Welcome to') && !t.includes('PDFelement') && t.includes('here'), t);
      noErrors(p); await p.ctx.close();
    } finally { fs.unlinkSync(file); }
  });

  await test('Protect: compress says when a PDF is already compact, and Compress stays the main button', async () => {
    const d0 = await L.PDFDocument.create(), pg = d0.addPage([612, 792]);
    pg.drawText('Only a little text', { x: 72, y: 720, size: 18, font: await d0.embedFont(L.StandardFonts.Helvetica) });
    const file = tmp('small.pdf', await d0.save());
    try {
      const p = await open(); await openPdf(p, file, 'Small.pdf');
      await run(p, 'protCompress');
      await p.waitForFunction(() => /^Now /.test((document.querySelector('#protSize') || {}).textContent || ''), null, { timeout: 30000 });
      const t = await p.textContent('#protSize');
      ok(/already compact: compressing would save less than 2%/.test(t), t);
      eq(await p.$$eval('#dialog .dlg-foot .btn.primary', (b) => b.map((x) => x.textContent)), ['Compress']);
      await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr2/fix-pages/compress-compact.png' });
      await p.click('#dialog .dlg-foot .btn.primary'); await p.waitForTimeout(150);
      ok(await p.evaluate(() => (window.__cowdreyPdf.doc.marks.__doc || []).some((m) => m.type === 'protcompress')), 'Compress still sets compression');
      noErrors(p); await p.ctx.close();
    } finally { fs.unlinkSync(file); }
  });

  await test('Protect: compress makes a PDF with a large picture smaller, and shows the sizes', async () => {
    const W = 1200, raw = new Uint8Array(W * W * 3);
    let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; raw[i] = (x / W) * 255; raw[i + 1] = (y / W) * 200 + rnd() * 40; raw[i + 2] = 120 + rnd() * 60; }
    const d0 = await L.PDFDocument.create(), pg = d0.addPage([612, 792]);
    const ref = d0.context.register(d0.context.flateStream(raw, { Type: 'XObject', Subtype: 'Image', Width: W, Height: W, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }));
    const key = pg.node.newXObject('Im', ref);
    pg.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(300, 0, 0, 300, 150, 300), L.drawObject(key), L.popGraphicsState());
    pg.drawText('A big picture', { x: 72, y: 720, size: 18, font: await d0.embedFont(L.StandardFonts.Helvetica) });
    const file = tmp('big.pdf', await d0.save()), size0 = fs.statSync(file).size;
    const p = await open(); await openPdf(p, file, 'Big.pdf');
    await run(p, 'protCompress');
    await p.waitForFunction(() => /Compressed/.test((document.querySelector('#protSize') || {}).textContent || ''), null, { timeout: 30000 });
    const shown = await p.$eval('#protSize', (e) => [+e.dataset.before, +e.dataset.after, e.textContent]);
    ok(shown[1] < shown[0] * .3, 'sizes shown: ' + shown[2]);
    await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/protect/compress-dialog.png' });
    await answer(p, 'Compress'); await p.waitForTimeout(200);
    const out = await savedOf(p);
    ok(out.length < size0 * .3, `smaller: ${size0} → ${out.length}`);
    const d = await PDFDocument.load(out);
    const img = d.context.enumerateIndirectObjects().map(([, o]) => o).find((o) => o instanceof L.PDFRawStream && String(o.dict.get(L.PDFName.of('Subtype'))) === '/Image');
    eq([img.dict.get(L.PDFName.of('Width')).asNumber(), String(img.dict.get(L.PDFName.of('Filter')))], [625, '/DCTDecode'], '150 ppi at 300 pt');
    ok((await textOf(out)).includes('A big picture'));
    await reopen(p, out);
    const px = await p.evaluate(() => { const v = window.__cowdreyPdf.views()[0], c = v.el.querySelector('canvas.pdf'), k = c.width / v.viewport.width; const [x, y] = v.viewport.convertToViewportPoint(160, 590); return [...c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data]; });
    ok(px[2] > 90 && px[0] < 60, 'picture still drawn: ' + px);
    fs.unlinkSync(file); noErrors(p); await p.ctx.close();
  });

  await test('Protect: remove hidden information: metadata, attachments and scripts', async () => {
    const d0 = await L.PDFDocument.create(); const pg = d0.addPage([612, 792]);
    pg.drawText('Hello', { x: 72, y: 700, size: 18, font: await d0.embedFont(L.StandardFonts.Helvetica) });
    d0.setTitle('Secret plan'); d0.setAuthor('Agent Smith'); d0.setKeywords(['codename']);
    await d0.attach(Buffer.from('hidden notes'), 'notes.txt', { mimeType: 'text/plain' });
    d0.addJavaScript('hello', 'app.alert("hi")');
    const file = tmp('hidden.pdf', await d0.save());
    const p = await open(); await openPdf(p, file, 'Plan.pdf');
    await run(p, 'protClean'); await answer(p, 'Remove'); await p.waitForTimeout(100);
    const d = await PDFDocument.load(await savedOf(p), { updateMetadata: false });
    eq([d.getTitle(), d.getAuthor(), d.getKeywords(), d.getProducer()], [undefined, undefined, undefined, undefined], 'metadata');
    const names = d.catalog.lookup(L.PDFName.of('Names'));
    ok(!names || (!names.get(L.PDFName.of('EmbeddedFiles')) && !names.get(L.PDFName.of('JavaScript'))), 'name trees');
    ok(!d.context.enumerateIndirectObjects().some(([, o]) => (o instanceof L.PDFDict && /JavaScript|EmbeddedFile/.test(String(o.get(L.PDFName.of('S')) || o.get(L.PDFName.of('Type')) || ''))) || (o.dict && String(o.dict.get(L.PDFName.of('Type'))) === '/EmbeddedFile')), 'no scripts or attached files left in the file');
    eq(d.getPageCount(), 1);
    fs.unlinkSync(file); noErrors(p); await p.ctx.close();
  });

  await test('Protect: the tab and its dialogs fit a phone screen', async () => {
    const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p);
    await p.click('[data-rt="protect"]'); await p.waitForTimeout(100);
    eq(await p.$$eval('#ribbonBody [data-cmd^="prot"]', (e) => e.length), 9);
    await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/protect/phone-ribbon.png' });
    await run(p, 'protPassword'); await p.waitForSelector('#dialog[open] input[name=open]'); await p.check('#dialog input[name=limit]');
    eq(await p.evaluate(() => { const r = document.querySelector('#dialog').getBoundingClientRect(); return [r.left >= 0, r.right <= innerWidth, document.documentElement.scrollWidth <= innerWidth]; }), [true, true, true]);
    await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/protect/phone-password.png' });
    await answer(p, 'Cancel');
    await run(p, 'protRedApply'); // nothing marked yet: a toast, no dialog
    eq(await p.$('#dialog[open]'), null);
    noErrors(p); await p.ctx.close();
  });

  // A JPEG made in the browser (noisy, so a PNG of it would be several times larger).
  const makeJpeg = async (W, H, q = .85) => {
    const p0 = await open();
    const b = await p0.evaluate(([w, h, q]) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), id = g.createImageData(w, h);
      let seed = 3; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let i = 0; i < w * h; i++) { const x = i % w, y = (i / w) | 0; id.data.set([60 + x / w * 150 + rnd() * 40, 90 + y / h * 120 + rnd() * 40, 200 - rnd() * 60, 255], i * 4); }
      g.putImageData(id, 0, 0);
      return Array.from(atob(c.toDataURL('image/jpeg', q).split(',')[1]), (ch) => ch.charCodeAt(0));
    }, [W, H, q]);
    await p0.ctx.close(); return Uint8Array.from(b);
  };

  await test('Protect: redacting part of a see-through JPEG picture keeps it a JPEG with its soft mask; the file does not grow', async () => {
    const W = 600, H = 400, jpg = await makeJpeg(W, H);
    const alpha = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) alpha[y * W + x] = Math.max(0, Math.min(255, 255 - Math.hypot(x - W / 2, y - H / 2) / 1.5 | 0)); // fades out at the edges
    const d0 = await L.PDFDocument.create(), pg = d0.addPage([612, 792]), c = d0.context;
    const sm = c.register(c.flateStream(alpha, { Type: 'XObject', Subtype: 'Image', Width: W, Height: H, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }));
    const ref = c.register(c.stream(jpg, { Type: 'XObject', Subtype: 'Image', Width: W, Height: H, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode', SMask: sm }));
    const key = pg.node.newXObject('Im', ref);
    pg.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(450, 0, 0, 300, 80, 300), L.drawObject(key), L.popGraphicsState());
    pg.drawText('The secret code is here', { x: 150, y: 450, size: 20, font: await d0.embedFont(L.StandardFonts.Helvetica) });
    const file = tmp('jpeg-smask.pdf', await d0.save()), size0 = fs.statSync(file).size;
    try {
      const p = await open(); await openPdf(p, file, 'Picture.pdf');
      await p.click('[data-rt="protect"]');
      await p.click('[data-cmd="protRedSearch"]'); await p.fill('#dialog input[name=text]', 'secret code'); await answer(p, 'Find'); await answer(p, 'Mark'); await p.waitForTimeout(300);
      await p.click('[data-cmd="protRedApply"]'); await answer(p, 'Apply'); await p.waitForTimeout(500);
      const out = await savedOf(p), d = await PDFDocument.load(out);
      ok(out.length < size0 * 1.3, `about the same size: ${size0} → ${out.length}`);
      const xo = d.getPage(0).node.Resources().lookup(L.PDFName.of('XObject'));
      const used = /\/(CPDFRed\d+) Do/.exec(pageContent(d)); ok(used, 'the picture was redrawn');
      const img = xo.lookup(L.PDFName.of(used[1])), smask = img.dict.lookup(L.PDFName.of('SMask'));
      eq([String(img.dict.get(L.PDFName.of('Filter'))), img.dict.get(L.PDFName.of('Width')).asNumber()], ['/DCTDecode', W], 'still a JPEG');
      ok(smask instanceof L.PDFRawStream, 'with its soft mask');
      // the mask is solid where the box painted over the picture, and see-through at the corners as before
      const a = L.decodePDFRawStream(smask).decode(), at0 = (x, y) => a[Math.round((300 + 300 - y) / 300 * H - 1) * W + Math.round((x - 80) / 450 * W)];
      eq([at0(250, 457), at0(81, 301) < 100], [255, true], 'mask');
      ok(!(await textOf(out)).includes('secret'), 'text gone');
      noErrors(p); await p.ctx.close();
    } finally { fs.unlinkSync(file); }
  });

  await test('Protect: when Balanced gains next to nothing but Smallest does, Compress chooses Smallest and says so', async () => {
    const jpg = await makeJpeg(600, 600, .92);
    const d0 = await L.PDFDocument.create(), pg = d0.addPage([612, 792]);
    const im = await d0.embedJpg(jpg); pg.drawImage(im, { x: 100, y: 300, width: 288, height: 288 }); // 150 pixels per inch already
    pg.drawText('A picture', { x: 72, y: 720, size: 18, font: await d0.embedFont(L.StandardFonts.Helvetica) });
    const file = tmp('ppi150.pdf', await d0.save());
    try {
      const p = await open(); await openPdf(p, file, 'Picture.pdf');
      await run(p, 'protCompress');
      await p.waitForFunction(() => /selected|Compressed|compact/.test((document.querySelector('#protSize') || {}).textContent || ''), null, { timeout: 30000 });
      const t = await p.textContent('#protSize');
      ok(/Balanced would save less than 2%\. Smallest saves \d+% \(.+\), so it is selected\./.test(t), t);
      ok(await p.isChecked('#dialog input[name=level][value="96"]'), 'Smallest chosen');
      eq(await p.$$eval('#dialog .dlg-foot .btn.primary', (b) => b.map((x) => x.textContent)), ['Compress']);
      await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr2/fix-pages/compress-smallest.png' });
      await p.click('#dialog .dlg-foot .btn.primary'); await p.waitForTimeout(200);
      eq(await p.evaluate(() => (window.__cowdreyPdf.doc.marks.__doc || []).filter((m) => m.type === 'protcompress').map((m) => m.level)), ['96']);
      noErrors(p); await p.ctx.close();
    } finally { fs.unlinkSync(file); }
  });
};
