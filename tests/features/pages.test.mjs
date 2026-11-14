// Page tools (src/features/60-pages.js): split, insert and replace from another PDF, crop, reverse, rotate a range,
// and several pages chosen in the sidebar.
import os from 'node:os';
export default async (h) => {
  const { test, eq, ok, open, openPdf, path, fs, PDFDocument, require, root, savedOf, reopen } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  // A PDF whose pages say their names, so the order can be read back.
  async function named(names, size = [400, 500]) {
    const d = await L.PDFDocument.create(); const f = await d.embedFont(L.StandardFonts.Helvetica);
    for (const n of names) { const pg = d.addPage(size); pg.drawText(n, { x: 50, y: size[1] - 100, size: 24, font: f }); }
    const file = path.join(os.tmpdir(), `pg60-${names.join('-')}.pdf`); fs.writeFileSync(file, await d.save()); return file;
  }
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
  const texts = (p) => p.evaluate(() => Promise.all(window.__cowdreyPdf.views().map(async (v) => (await v.page.getTextContent()).items.map((i) => i.str).join('').trim())));
  const settle = (p) => p.waitForTimeout(400);
  const dlg = (p) => p.waitForSelector('#dialog[open]');
  const primary = (p) => p.click('#dialog .btn.primary');
  const ABC = await named(['Alpha', 'Bravo', 'Charlie']);
  const XYZ = await named(['Xray', 'Yankee', 'Zulu'], [300, 300]);

  await test('pages: split into files by ranges, every N pages, and one per page; each part has the right pages', async () => {
    const p = await open(); await openPdf(p, ABC, 'Letters.pdf');
    const split = async (how, fill) => {
      const got = []; const onDl = (d) => got.push(d); p.on('download', onDl);
      await run(p, 'pg60_split'); await dlg(p);
      await p.check(`#dialog input[name="how"][value="${how}"]`);
      if (fill) await p.fill(`#dialog input[name="${fill[0]}"]`, fill[1]);
      await primary(p);
      await p.waitForFunction(() => /Split into|Saved 1/.test(document.querySelector('#toast').textContent), null, { timeout: 15000 });
      await settle(p); p.off('download', onDl);
      const out = [];
      for (const d of got) { const b = fs.readFileSync(await d.path()); await PDFDocument.load(b); out.push([d.suggestedFilename(), (await PDFDocument.load(b)).getPageCount()]); }
      return out;
    };
    eq(await split('ranges', ['ranges', '1, 2-3']), [['Letters (part 1).pdf', 1], ['Letters (part 2).pdf', 2]]);
    eq(await split('every', ['every', '2']), [['Letters (part 1).pdf', 2], ['Letters (part 2).pdf', 1]]);
    eq((await split('each')).map((x) => x[1]), [1, 1, 1]);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('pages: insert chosen pages from another PDF after this page; saved PDF has them in place', async () => {
    const p = await open(); await openPdf(p, ABC, 'Letters.pdf');
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), run(p, 'pg60_insert')]);
    await fc.setFiles(XYZ); await dlg(p);
    await p.fill('#dialog input[name="pages"]', '1, 3'); // after this page (1) is chosen already
    await primary(p); await settle(p);
    eq(await p.$$eval('.thumb', (e) => e.length), 5);
    await reopen(p, await savedOf(p));
    eq(await texts(p), ['Alpha', 'Xray', 'Zulu', 'Bravo', 'Charlie']);
    // And "before page N"
    const [fc2] = await Promise.all([p.waitForEvent('filechooser'), run(p, 'pg60_insert')]);
    await fc2.setFiles(XYZ); await dlg(p);
    await p.fill('#dialog input[name="pages"]', '2'); await p.fill('#dialog input[name="at"]', '5'); await primary(p); await settle(p);
    await reopen(p, await savedOf(p));
    eq(await texts(p), ['Alpha', 'Xray', 'Zulu', 'Bravo', 'Yankee', 'Charlie']);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('pages: replace a range with pages from another PDF; undo brings the old pages back', async () => {
    const p = await open(); await openPdf(p, ABC, 'Letters.pdf');
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), run(p, 'pg60_replace')]);
    await fc.setFiles(XYZ); await dlg(p);
    await p.fill('#dialog input[name="mine"]', '2-3'); await p.fill('#dialog input[name="theirs"]', '3'); await primary(p); await settle(p);
    const d = await PDFDocument.load(await savedOf(p));
    eq(d.getPages().map((x) => Math.round(x.getWidth())), [400, 300]);
    await reopen(p, await savedOf(p)); eq(await texts(p), ['Alpha', 'Zulu']);
    await openPdf(p, ABC, 'Letters.pdf');
    const [fc2] = await Promise.all([p.waitForEvent('filechooser'), run(p, 'pg60_replace')]);
    await fc2.setFiles(XYZ); await dlg(p); await p.fill('#dialog input[name="mine"]', '1'); await primary(p); await settle(p);
    eq(await texts(p), ['Xray', 'Bravo', 'Charlie']);
    await run(p, 'undo'); await settle(p); eq(await texts(p), ['Alpha', 'Bravo', 'Charlie']);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('pages: crop by dragging a box; page shows cropped; CropBox and TrimBox saved; respects rotation; undo', async () => {
    const p = await open(); await openPdf(p, ABC, 'Letters.pdf');
    await run(p, 'tool_crop');
    // Drag from PDF point (40, 460) to (360, 300) on page 1 (400 x 500 pt).
    const pt = (x, y) => p.evaluate(([x, y]) => { const v = window.__cowdreyPdf.views()[0]; const [a, b] = v.viewport.convertToViewportPoint(x, y); const r = v.el.getBoundingClientRect(); return [r.left + a, r.top + b]; }, [x, y]);
    const [ax, ay] = await pt(40, 460), [bx, by] = await pt(360, 300);
    await p.mouse.move(ax, ay); await p.mouse.down(); await p.mouse.move(bx, by, { steps: 6 }); await p.mouse.up();
    await dlg(p); await primary(p); await settle(p);
    const shown = await p.$eval('.page[data-n="0"]', (e) => [e.style.clipPath !== '', Math.round(e.getBoundingClientRect().width)]);
    ok(shown[0], 'clipped on screen');
    let d = await PDFDocument.load(await savedOf(p));
    const box = (b) => [b.x, b.y, b.x + b.width, b.y + b.height].map((n) => Math.round(n));
    const c0 = box(d.getPage(0).getCropBox());
    ok(Math.abs(c0[0] - 40) <= 2 && Math.abs(c0[1] - 300) <= 2 && Math.abs(c0[2] - 360) <= 2 && Math.abs(c0[3] - 460) <= 2, 'crop box ' + c0);
    eq(box(d.getPage(0).getTrimBox()), c0, 'trim box');
    eq(box(d.getPage(1).getCropBox()), [0, 0, 400, 500], 'other pages untouched');
    // Crop margins typed in, on a page turned right: "top" is the top as shown, which is the page's left edge.
    await run(p, 'pg60_rotate'); await dlg(p); await p.fill('#dialog input[name="pages"]', '2'); await primary(p); await settle(p);
    await p.evaluate(() => window.__cowdreyPdf.pg60.setSel([])); await p.evaluate(() => document.querySelector('.thumb[data-n="1"]').click()); await settle(p);
    await run(p, 'pg60_crop'); await dlg(p);
    await p.fill('#dialog input[name="t"]', '25.4'); await p.fill('#dialog input[name="b"]', '0'); await p.fill('#dialog input[name="l"]', '0'); await p.fill('#dialog input[name="r"]', '0');
    await primary(p); await settle(p);
    d = await PDFDocument.load(await savedOf(p));
    eq(d.getPage(1).getRotation().angle, 90);
    eq(box(d.getPage(1).getCropBox()), [72, 0, 400, 500], 'one inch off the shown top');
    await reopen(p, await savedOf(p));
    const view = await p.evaluate(() => window.__cowdreyPdf.views().map((v) => [Math.round(v.viewport.width / v.viewport.scale), Math.round(v.viewport.height / v.viewport.scale)]));
    eq(view, [[320, 160], [500, 328], [400, 500]], 'a reader shows the cropped sizes');
    // Undo takes a crop away again.
    await openPdf(p, ABC, 'Letters.pdf');
    await p.evaluate(() => window.__cowdreyPdf.pg60.crop([0, 1, 2], [10, 10, 10, 10])); await settle(p);
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.filter((e) => e.crop).length), 3);
    await run(p, 'undo'); await settle(p);
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.filter((e) => e.crop).length), 0);
    eq(await p.$eval('.page[data-n="0"]', (e) => e.style.clipPath), '');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('pages: reverse page order (all, or just the chosen pages); saved PDF follows', async () => {
    const p = await open(); await openPdf(p, ABC, 'Letters.pdf');
    await run(p, 'pg60_reverse'); await settle(p);
    await reopen(p, await savedOf(p)); eq(await texts(p), ['Charlie', 'Bravo', 'Alpha']);
    await openPdf(p, await named(['A1', 'B2', 'C3', 'D4']), 'Four.pdf');
    await p.click('.thumb[data-n="0"]'); await p.click('.thumb[data-n="2"]', { modifiers: ['Shift'] });
    await run(p, 'pg60_reverse'); await settle(p);
    await reopen(p, await savedOf(p)); eq(await texts(p), ['C3', 'B2', 'A1', 'D4']);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('pages: Delete pages… takes a range and asks first; Delete on a page in the sidebar asks too', async () => {
    const p = await open(); await openPdf(p, await named(['Q1', 'Q2', 'Q3', 'Q4', 'Q5']), 'Five.pdf');
    await p.click('[data-rt="pages"]'); await p.click('#ribbonBody [data-cmd="pg60_delete"]'); await dlg(p);
    eq(await p.inputValue('#dialog input[name="pages"]'), '1', 'starts with the page in view');
    eq(await p.evaluate(() => document.activeElement.name), 'pages', 'the range field has the focus');
    await p.fill('#dialog input[name="pages"]', '2-3, 5');
    eq(await p.textContent('#dialog .btn.primary'), 'Delete 3 pages');
    await p.fill('#dialog input[name="pages"]', '9');
    eq(await p.$eval('#dialog .btn.primary', (b) => [b.textContent, b.disabled]), ['Delete', true], 'nothing to delete');
    await p.fill('#dialog input[name="pages"]', '2-3, 5'); await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr1/fix-features/delete-pages.png' });
    await p.keyboard.press('Enter'); await settle(p);
    eq(await texts(p), ['Q1', 'Q4']);
    // Delete key on a thumbnail: asks about that page; Cancel keeps it
    await p.focus('.thumb[data-n="1"]'); await p.keyboard.press('Delete'); await dlg(p);
    eq(await p.inputValue('#dialog input[name="pages"]'), '2', 'the page in the sidebar, not the one in view');
    await p.click('#dialog .dlg-foot .btn:not(.primary)'); await settle(p);
    eq(await texts(p), ['Q1', 'Q4'], 'cancelled');
    await p.focus('.thumb[data-n="1"]'); await p.keyboard.press('Delete'); await dlg(p); await primary(p); await settle(p);
    eq(await texts(p), ['Q1']);
    await p.keyboard.press('Control+z'); await settle(p); eq(await texts(p), ['Q1', 'Q4'], 'undo');
    // One page from the ribbon's Delete page: at once, as before
    await run(p, 'delPage'); await settle(p); eq(await p.$('#dialog[open]'), null); eq((await texts(p)).length, 1);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('pages: several pages chosen in the sidebar are rotated, moved and deleted together', async () => {
    const p = await open(); await openPdf(p, await named(['P1', 'P2', 'P3', 'P4', 'P5']), 'Five.pdf');
    await p.click('.thumb[data-n="0"]'); await p.click('.thumb[data-n="2"]', { modifiers: ['Control'] });
    eq(await p.evaluate(() => window.__cowdreyPdf.pg60.sel()), [0, 2]);
    ok(await p.$('.pg60-selbar'), 'shows how many are chosen');
    eq(await p.$$eval('.thumb.pg60-sel', (e) => e.map((t) => +t.dataset.n)), [0, 2]);
    await run(p, 'rotR'); await settle(p);
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.map((e) => e.rot)), [90, 0, 90, 0, 0]);
    await run(p, 'down'); await settle(p); // P1 and P3 move one place down together
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.map((e) => e.i + 1)), [2, 1, 4, 3, 5]);
    eq(await p.evaluate(() => window.__cowdreyPdf.pg60.sel()), [1, 3], 'still chosen after moving');
    await run(p, 'delPage'); await dlg(p); // several pages: asked first
    eq(await p.inputValue('#dialog input[name="pages"]'), '2, 4'); eq(await p.textContent('#dialog .btn.primary'), 'Delete 2 pages');
    await primary(p); await settle(p);
    eq(await p.$$eval('.thumb', (e) => e.length), 3);
    const d = await PDFDocument.load(await savedOf(p));
    eq(d.getPageCount(), 3); eq(d.getPages().map((x) => x.getRotation().angle), [0, 0, 0]);
    await reopen(p, await savedOf(p)); eq(await texts(p), ['P2', 'P4', 'P5']);
    // Extract several chosen pages into one file
    await openPdf(p, await named(['P1', 'P2', 'P3', 'P4', 'P5']), 'Five.pdf');
    await p.click('.thumb[data-n="1"]'); await p.click('.thumb[data-n="3"]', { modifiers: ['Shift'] });
    const [dl] = await Promise.all([p.waitForEvent('download'), run(p, 'extract')]);
    eq(dl.suggestedFilename(), 'Five (pages 2-4).pdf'); eq((await PDFDocument.load(fs.readFileSync(await dl.path()))).getPageCount(), 3);
    // A plain click chooses one page again, and the page commands go back to the page in view
    await p.click('.thumb[data-n="0"]'); eq(await p.$('.pg60-selbar'), null);
    eq(p.errors, []); await p.ctx.close();
  });
};
