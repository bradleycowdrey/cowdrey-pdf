// Look and feel: the format bar's swatches on dark, split buttons as one shape, the header and footer fields, the
// phone title, the phone's tool hint, the text format bar's place, its Font, alignment and line spacing, and the
// Comment tab's groups.
export default async (h) => {
  const { test, eq, ok, open, openPdf, savedOf, WORD } = h;
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id).then(() => p.waitForTimeout(200));
  const clickLine = async (p, text, dx = 20) => {
    const s = p.locator('.page[data-n="0"] .textLayer span', { hasText: text }).first(); await s.scrollIntoViewIfNeeded();
    const b = await s.boundingBox(); await p.mouse.click(b.x + dx, b.y + b.height / 2); await p.waitForSelector('.txt-bar'); await p.waitForTimeout(300);
  };

  await test('look: the format bar\'s "colour now" swatch has a visible edge on dark and on light', async () => {
    for (const scheme of ['dark', 'light']) {
      const p = await open({ scheme }); await openPdf(p, WORD, 'Pelican report.pdf');
      await run(p, 'tool_edit'); await clickLine(p, 'Budget');
      const sh = await p.$eval('.txt-bar .swatch[aria-pressed="true"]', (b) => getComputedStyle(b).boxShadow);
      ok(/inset/.test(sh), scheme + ': an inside edge ' + sh);
      ok(scheme === 'dark' ? /rgba\(255, 255, 255/.test(sh) : /rgba\(0, 0, 0/.test(sh), scheme + ': the edge stands out from the bar ' + sh);
      eq(p.errors, []); await p.ctx.close();
    }
  });

  await test('look: a split button\'s arrow is inside its hover and pressed tint (one shape)', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="pages"]');
    const split = p.locator('.rb-split:has([data-cmd="rotR"])');
    await p.locator('[data-cmd="rotR"]').hover(); await p.waitForTimeout(150);
    const bg = (s) => s.evaluate((e) => getComputedStyle(e).backgroundColor);
    const clear = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
    ok(!clear(await bg(split)), 'the whole split button is tinted on hover');
    const box = await split.boundingBox(), more = await split.locator('.rb-more').boundingBox();
    ok(more.x + more.width <= box.x + box.width + .5 && more.x >= box.x, 'the arrow is inside the tinted shape');
    // pressed: a command with a list that is on tints both halves
    await p.evaluate(() => { const b = document.querySelector('[data-cmd="rotR"]'); b.setAttribute('aria-pressed', 'true'); });
    await p.mouse.move(5, 500); await p.waitForTimeout(150);
    const soft = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim());
    const want = await p.evaluate((c) => { const d = document.createElement('div'); d.style.background = c; document.body.appendChild(d); const v = getComputedStyle(d).backgroundColor; d.remove(); return v; }, soft);
    eq(await bg(split), want, 'pressed tint on the whole shape');
    eq(await bg(split.locator('.rb-more')), 'rgba(0, 0, 0, 0)', 'the arrow has no tint of its own');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('look: Header & footer shows each place\'s text in full', async () => {
    const p = await open(); await openPdf(p);
    p.evaluate(() => window.__cowdreyPdf.run('pd_headfoot')); await p.waitForSelector('#dialog[open] [data-k="bc"]'); await p.waitForTimeout(300);
    const f = await p.$eval('#dialog [data-k="bc"]', (i) => [i.value, i.scrollWidth <= i.clientWidth, i.title]);
    eq(f, ['Page <<page>> of <<pages>>', true, 'Page <<page>> of <<pages>>']);
    // the preview is still beside the settings
    const [pv, main] = await Promise.all(['#dialog .pd-prev', '#dialog .pd-main'].map((s) => p.$eval(s, (e) => e.getBoundingClientRect().toJSON())));
    ok(pv.left >= main.right, 'preview beside the settings');
    await p.fill('#dialog [data-k="tl"]', 'Project Pelican: status report, draft two');
    eq(await p.$eval('#dialog [data-k="tl"]', (i) => i.title), 'Project Pelican: status report, draft two', 'a long one says it all on hover');
    await p.ctx.close();
  });

  await test('look: a phone title cut in the middle has no gap before the kept end', async () => {
    const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p, WORD, 'pdfelement-guide-for-everyone.pdf');
    const r = await p.evaluate(() => { const a = document.querySelector('#docTitle .dt-a'), b = document.querySelector('#docTitle .dt-b'); return { cut: a.classList.contains('dt-cut') && getComputedStyle(a, '::after').content, gap: b.getBoundingClientRect().left - a.getBoundingClientRect().right, fits: a.scrollWidth <= a.clientWidth, title: document.querySelector('#docTitle').title, text: document.querySelector('#docTitle').textContent }; });
    eq(r.cut, '"…"', 'cut in the middle'); ok(Math.abs(r.gap) < 1, 'no gap: ' + r.gap); ok(r.fits, 'no second ellipsis');
    eq([r.title, r.text], ['pdfelement-guide-for-everyone', 'pdfelement-guide-for-everyone'], 'the whole name is read out');
    // a wider screen shows it all again
    await p.setViewportSize({ width: 1200, height: 844 }); await p.waitForTimeout(300);
    eq(await p.$eval('#docTitle', (t) => t.textContent), 'pdfelement-guide-for-everyone');
    await p.ctx.close();
  });

  await test('look: on a phone, the Edit PDF hint toast goes when you leave the tool', async () => {
    const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p, WORD, 'Pelican report.pdf');
    await run(p, 'tool_edit');
    ok(await p.$eval('#toast', (t) => t.classList.contains('show') && /Tap text/.test(t.textContent)), 'hint shown');
    await run(p, 'tool_select');
    eq(await p.$eval('#toast', (t) => t.classList.contains('show')), false, 'gone with the tool');
    await p.ctx.close();
  });
  await test('look: the text format bar never covers the line above the one being edited, and stays in view on a phone', async () => {
    const rect = (p, sel, text) => p.evaluate(([s, t]) => { const e = [...document.querySelectorAll(s)].find((x) => !t || x.textContent.includes(t)); const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }, [sel, text]);
    const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    for (const phone of [false, true]) {
      const p = await open(phone ? { width: 390, height: 844, touch: true } : {}); await openPdf(p, WORD, 'Pelican report.pdf');
      if (!phone) { await run(p, 'zoomIn'); await run(p, 'zoomIn'); await p.waitForTimeout(600); }
      await run(p, 'tool_edit'); await clickLine(p, 'Budget'); await p.waitForTimeout(400);
      const bar = await rect(p, '.txt-bar'), above = await rect(p, '.page[data-n="0"] .textLayer span', 'Prepared'), ed = await rect(p, '.line-editor');
      ok(!hit(bar, above), `${phone ? 'phone' : 'desktop'}: the bar ${JSON.stringify(bar)} is clear of the line above ${JSON.stringify(above)}`);
      ok(!hit(bar, ed), 'nor over the line being edited');
      const vr = await rect(p, '#viewer');
      ok(bar.t >= vr.t && bar.b <= vr.b && bar.l >= vr.l - .5 && bar.r <= vr.r + .5, 'in view: ' + JSON.stringify([bar, vr]));
      eq(p.errors, []); await p.ctx.close();
    }
  });
  // Saved text, as pdf.js reads it: [text, x, y, width, font family, font id] for each piece on page 1.
  const savedItems = async (h, bytes) => {
    const pdfjs = await import(h.path.join(h.root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
    const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: h.path.join(h.root, 'desktop/node_modules/pdfjs-dist/standard_fonts/') }).promise;
    const tc = await (await d.getPage(1)).getTextContent();
    return tc.items.filter((i) => i.str.trim()).map((i) => [i.str, +i.transform[4].toFixed(1), +i.transform[5].toFixed(1), +i.width.toFixed(1), tc.styles[i.fontName].fontFamily, i.fontName]);
  };
  const baseFonts = (h, bytes) => h.PDFDocument.load(bytes).then((d) => { const L = h.require(h.path.join(h.root, 'desktop/node_modules/pdf-lib')); const fd = d.getPage(0).node.Resources().lookup(L.PDFName.of('Font')); return fd.entries().map(([, r]) => String(d.context.lookup(r).get(L.PDFName.of('BaseFont')))); });

  await test('look: the text format bar\'s Font sets a line in a standard font or in another font the page has; the saved PDF uses it', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await run(p, 'tool_edit'); await clickLine(p, 'Prepared'); await p.waitForTimeout(400);
    const list = await p.$$eval('.txt-bar [data-tf="face"] option', (o) => o.map((x) => x.textContent));
    eq(list, ['Carlito Regular', 'Carlito Bold', 'Helvetica', 'Times', 'Courier'], 'its own font, the page\'s other font, the standard ones');
    eq(await p.$eval('.txt-bar [data-tf="face"]', (s) => s.getAttribute('aria-label')), 'Font');
    await p.selectOption('.txt-bar [data-tf="face"]', 'serif'); await p.waitForTimeout(200);
    ok(/Times/.test(await p.$eval('.line-editor', (e) => getComputedStyle(e).fontFamily)), 'the editor shows it');
    await p.keyboard.press('End'); await p.keyboard.type(' Today.'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
    // another font of the page: it comes bold, as it is
    await clickLine(p, 'second phase'); await p.waitForTimeout(400);
    await p.selectOption('.txt-bar [data-tf="face"]', { label: 'Carlito Bold' }); await p.waitForTimeout(200);
    eq(await p.$eval('.txt-bar [data-tf="bold"]', (b) => b.getAttribute('aria-pressed')), 'true', 'Bold follows the font');
    await p.keyboard.press('Enter'); await p.waitForTimeout(400);
    const out = await savedOf(p), it = await savedItems(h, out), by = (t) => it.find((i) => i[0].includes(t));
    eq(by('Prepared')[0], 'Prepared by the delivery team on 3 March. Today.');
    eq(by('Prepared')[4], 'serif', 'set in Times');
    eq(by('second phase')[5], by('Project Pelican')[5], 'set in the page\'s own Carlito Bold (the heading\'s font)');
    const names = await baseFonts(h, out);
    ok(names.includes('/Times-Roman') && !names.some((n) => /Helvetica/.test(n)), 'Times added, no other substitute: ' + names);
    // undo takes the font back
    await p.evaluate(() => window.__cowdreyPdf.run('undo')); await p.waitForTimeout(200);
    eq((await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().map((m) => m.face))), ['serif']);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('look: a paragraph\'s Font, alignment and Line spacing are kept in the saved PDF', async () => {
    const { PDFDocument, rgb } = h.require(h.path.join(h.root, 'desktop/node_modules/pdf-lib'));
    const pdf = await PDFDocument.create(), dir = '/usr/share/fonts/truetype/crosextra/';
    let reg = await pdf.embedFont('Helvetica');
    if (h.fs.existsSync(dir + 'Carlito-Regular.ttf')) { pdf.registerFontkit(h.require(h.path.join(h.root, 'desktop/node_modules/@pdf-lib/fontkit'))); reg = await pdf.embedFont(h.fs.readFileSync(dir + 'Carlito-Regular.ttf'), { subset: false }); }
    const PARA = ['The pelican project moved into its second phase this spring,', 'with new stores joining the pilot and early results showing', 'steady growth in every region we measured over the quarter.', 'The team will report again in June.'];
    const pg = pdf.addPage([612, 792]); PARA.forEach((t, k) => pg.drawText(t, { x: 72, y: 680 - k * 16, size: 12, font: reg, color: rgb(0.1, 0.1, 0.1) }));
    const file = h.path.join(h.fs.mkdtempSync(h.path.join((await import('node:os')).tmpdir(), 'cpdf-look-')), 'para.pdf'); h.fs.writeFileSync(file, await pdf.save());
    const p = await open(); await openPdf(p, file, 'Notes.pdf');
    await run(p, 'txtParaMode');
    const [x, y] = await h.at(p, 120, 667); await p.mouse.click(x, y); await p.waitForSelector('.txt-editor'); await p.waitForTimeout(400);
    eq(await p.$$eval('.txt-bar [data-tf="spacing"] option', (o) => o.map((x) => x.textContent)), ['As is', '1.0', '1.15', '1.5', '2.0'], 'line spacing');
    await p.selectOption('.txt-bar [data-tf="face"]', 'serif'); await p.click('.txt-bar [data-tf="center"]'); await p.selectOption('.txt-bar [data-tf="spacing"]', '1.5'); await p.waitForTimeout(200);
    eq(await p.$eval('.txt-editor', (t) => [t.style.textAlign, Math.round(parseFloat(t.style.lineHeight) / parseFloat(getComputedStyle(t).fontSize) * 100) / 100]), ['center', 1.8], 'the editor shows it');
    await p.keyboard.press('Control+Enter');
    await p.waitForSelector('#dialog[open] h2:has-text("longer than the space it had")'); await p.click('#dialog .dlg-foot button:has-text("Let it run")'); await p.waitForTimeout(400);
    const it = (await savedItems(h, await savedOf(p))).filter((i) => i[2] > 500);
    eq(it.map((i) => i[2]), [680, 658.4, 636.8, 615.2], 'baselines 1.5 lines (21.6 pt) apart');
    const mids = it.map((i) => i[1] + i[3] / 2); ok(Math.max(...mids) - Math.min(...mids) < 1.5, 'centred: ' + mids);
    ok(it.every((i) => i[4] === 'serif'), 'in Times');
    eq(p.errors, []); await p.ctx.close();
  });
  await test('look: the Comment tab\'s groups match the other tabs: 12px names, two rows as tall as a big button, shapes named when there is room', async () => {
    const p = await open({ width: 1440 }); await openPdf(p);
    await p.click('[data-rt="markup"]'); await p.waitForTimeout(200);
    const r = await p.evaluate(() => {
      const big = document.querySelector('#ribbonBody [data-cmd="tool_select"]'), small = [...document.querySelectorAll('#ribbonBody .r-rows .rb, #ribbonBody .r-icons .rb')];
      const items = document.querySelector('#ribbonBody .r-rows .r-items');
      return { size: [...new Set([big, ...small].map((b) => getComputedStyle(b).fontSize))], bigH: big.getBoundingClientRect().height, rowsH: items.scrollHeight,
        named: [...document.querySelectorAll('#ribbonBody .r-icons .rb')].map((b) => [b.textContent.trim(), b.querySelector('span').getBoundingClientRect().width > 20]) };
    });
    eq(r.size, ['12px'], 'one text size');
    ok(Math.abs(r.rowsH - r.bigH) <= 2, `two rows ${r.rowsH} as tall as a big button ${r.bigH}`);
    ok(r.named.length >= 7 && r.named.every(([t, v]) => t && v), 'every shape shows its name: ' + JSON.stringify(r.named));
    const [sw, cw] = await p.$eval('#ribbonBody', (e) => [e.scrollWidth, e.clientWidth]); ok(sw <= cw, `the tab fits (${sw}/${cw})`);
    await p.ctx.close();
  });
};
