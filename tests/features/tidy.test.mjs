// Small feedback: the first redaction mark says what comes next; thumbnails keep their size while drawn; bookmarks
// with no destination; a new bookmark's name; font names in the format bar.
export default async (h) => {
  const { test, eq, ok, open, openPdf, at, WORD } = h;
  const drag = async (p, [x1, y1], [x2, y2]) => { const [a, b] = await at(p, x1, y1), [c, d] = await at(p, x2, y2); await p.mouse.move(a, b); await p.mouse.down(); await p.mouse.move(c, d, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(150); };

  await test('tidy: the first redaction mark says it is not removed yet, with Apply at hand; later marks do not repeat it', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.click('[data-rt="protect"]'); await p.click('[data-cmd="protRedArea"]');
    await drag(p, [380, 560], [460, 400]);
    eq(await p.$eval('#toast', (t) => [t.classList.contains('show'), t.firstChild.textContent.trim()]), [true, '1 area marked. Apply redactions removes it for good.']);
    ok(await p.$('#toast button:has-text("Apply")'), 'Apply button');
    await p.evaluate(() => { const t = document.querySelector('#toast'); t.classList.remove('show'); t.textContent = ''; });
    await drag(p, [100, 300], [200, 280]);
    ok(!/area marked/.test(await p.textContent('#toast')), 'not again: ' + await p.textContent('#toast'));
    await p.evaluate(() => window.__cowdreyPdf.run('undo')); await p.evaluate(() => window.__cowdreyPdf.run('undo'));
    await p.evaluate(() => window.__cowdreyPdf.run('protRedArea')); await drag(p, [380, 560], [460, 400]);
    await p.click('#toast button:has-text("Apply")'); await p.waitForSelector('#dialog[open]');
    ok(/Apply redactions/.test(await p.textContent('#dialog h2')), 'Apply opens Apply redactions');
    await p.ctx.close();
  });

  const L = h.require(h.path.join(h.root, 'desktop/node_modules/pdf-lib')), N = (x) => L.PDFName.of(x);
  const save = async (d, name) => { const f = h.path.join(h.fs.mkdtempSync(h.path.join((await import('node:os')).tmpdir(), 'cpdf-tidy-')), name); h.fs.writeFileSync(f, await d.save()); return f; };

  await test('tidy: thumbnails have their page\'s shape before they are drawn (no jump from a short row)', async () => {
    const d = await L.PDFDocument.create(), f = await d.embedFont(L.StandardFonts.Helvetica);
    for (let n = 0; n < 14; n++) d.addPage(n === 5 ? [792, 612] : [612, 792]).drawText(`Page ${n + 1}`, { x: 72, y: 500, size: 30, font: f });
    const p = await open(); await openPdf(p, await save(d, 'long.pdf'), 'Long.pdf');
    const boxes = await p.$$eval('#sidePanel .thumb canvas', (c) => c.map((x) => [x.width === 1, Math.round(x.getBoundingClientRect().width), Math.round(x.getBoundingClientRect().height)]));
    ok(boxes.some(([undrawn]) => undrawn), 'some not drawn yet');
    for (const [k, [, w, hh]] of boxes.entries()) eq([w, hh], k === 5 ? [150, 116] : [141, 182], 'thumb ' + (k + 1));
    await p.$eval('#sidePanel', (s) => { s.scrollTop = s.scrollHeight; }); await p.waitForTimeout(1500);
    eq(await p.$$eval('#sidePanel .thumb canvas', (c) => c.slice(-3).map((x) => [x.width > 1, Math.round(x.getBoundingClientRect().height)])), [[true, 182], [true, 182], [true, 182]], 'same size once drawn');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('tidy: an imported bookmark with no destination is plain (not struck through), with the tooltip No destination', async () => {
    const d = await L.PDFDocument.create(), f = await d.embedFont(L.StandardFonts.Helvetica), pages = [1, 2].map((n) => { const pg = d.addPage([612, 792]); pg.drawText(`Page ${n}`, { x: 72, y: 700, size: 20, font: f }); return pg; });
    const c = d.context, root = c.nextRef(), a = c.nextRef(), b = c.nextRef();
    c.assign(a, c.obj({ Title: L.PDFHexString.fromText('Has a page'), Parent: root, Next: b, Dest: [pages[1].ref, 'Fit'] }));
    c.assign(b, c.obj({ Title: L.PDFHexString.fromText('Read Mode'), Parent: root, Prev: a }));
    c.assign(root, c.obj({ Type: 'Outlines', First: a, Last: b, Count: 2 }));
    d.catalog.set(N('Outlines'), root);
    const p = await open(); await openPdf(p, await save(d, 'outline.pdf'), 'Outline.pdf');
    await p.click('[data-side="outline"]'); await p.waitForTimeout(300);
    await p.click('#viewer'); await p.keyboard.press('Control+b'); await p.waitForTimeout(300); await p.keyboard.press('Escape'); await p.waitForTimeout(200); // now the tree is editable
    const r = p.locator('#sidePanel .bm-row', { has: p.locator('.bm-t', { hasText: 'Read Mode' }) }).first();
    eq(await r.evaluate((x) => [x.classList.contains('bm-gone'), getComputedStyle(x.querySelector('.bm-t')).textDecorationLine, x.querySelector('.bm-pg').title]), [false, 'none', 'No destination']);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('tidy: a new bookmark is named after the whole heading, wrapped over two lines', async () => {
    const d = await L.PDFDocument.create(), f = await d.embedFont(L.StandardFonts.HelveticaBold), r = await d.embedFont(L.StandardFonts.Helvetica);
    const pg = d.addPage([612, 792]);
    pg.drawText('Welcome to', { x: 72, y: 680, size: 40, font: f }); pg.drawText('PDFelement 11', { x: 72, y: 634, size: 40, font: f });
    pg.drawText('Hey there!', { x: 72, y: 560, size: 18, font: r });
    for (let k = 0; k < 8; k++) pg.drawText('Body text that is much smaller than the heading above it.', { x: 72, y: 500 - k * 16, size: 11, font: r });
    const p = await open(); await openPdf(p, await save(d, 'heading.pdf'), 'Heading.pdf');
    await p.evaluate(() => window.__cowdreyPdf.run('bmAdd')); await p.waitForSelector('#sidePanel .bm-in');
    eq(await p.inputValue('#sidePanel .bm-in'), 'Welcome to PDFelement 11');
    await p.ctx.close();
  });

  await test('tidy: the format bar names fonts as people know them (no subset tag, words apart)', async () => {
    const p = await open();
    eq(await p.evaluate(() => ['DMSans-SemiBold', 'ABCDEF+DMSans-Regular', 'ABCDEF+Carlito-Bold-8659', 'TimesNewRomanPSMT', 'Arial-BoldMT', 'NotoSansCJKjp-Regular'].map(window.__cowdreyPdf.fontLabel)),
      ['DM Sans SemiBold', 'DM Sans Regular', 'Carlito Bold', 'Times New Roman', 'Arial Bold', 'Noto Sans CJKjp Regular']);
    await p.ctx.close();
  });
};
