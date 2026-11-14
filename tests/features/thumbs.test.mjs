// Thumbnails, going to a page, find, Organize and inserting blank pages (src/app.js sidebar and find code,
// src/features/60-pages.js).
import os from 'node:os';
export default async (h) => {
  const { test, eq, ok, open, openPdf, path, fs, PDFDocument, require, root, savedOf, reopen } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
  const settle = (p, ms = 400) => p.waitForTimeout(ms);
  // A PDF whose pages say their names (big, so a thumbnail shows them).
  async function named(names, size = [400, 500]) {
    const d = await L.PDFDocument.create(); const f = await d.embedFont(L.StandardFonts.Helvetica);
    for (const n of names) { const pg = d.addPage(size); pg.drawText(n, { x: 50, y: size[1] - 100, size: 24, font: f }); }
    const file = path.join(os.tmpdir(), `thumbs-${names.length}-${names[0]}.pdf`); fs.writeFileSync(file, await d.save()); return file;
  }
  const texts = (p) => p.evaluate(() => Promise.all(window.__cowdreyPdf.views().map(async (v) => (await v.page.getTextContent()).items.map((i) => i.str).join('').trim())));
  // How much ink a thumbnail shows: [dark pixels, red pixels].
  const ink = (p, n = 0, sel = '#sidePanel .thumb') => p.evaluate(([n, sel]) => {
    const c = document.querySelector(`${sel}[data-n="${n}"] canvas`); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0, red = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] + d[i + 1] + d[i + 2] < 720) dark++; if (d[i] - d[i + 1] > 50 && d[i] - d[i + 2] > 50) red++; }
    return [dark, red];
  }, [n, sel]);

  await test('thumbnails: show mark-up, page design and redactions; follow undo and redo; still shown after save and reopen', async () => {
    const p = await open(); await openPdf(p);
    const [dark0, red0] = await ink(p);
    // A box drawn on page 1
    await p.click('[data-rt="markup"]'); await p.click('[data-cmd="tool_rect"]');
    const g = await p.locator('.page[data-n="0"]').boundingBox();
    await p.mouse.move(g.x + 60, g.y + 60); await p.mouse.down(); await p.mouse.move(g.x + g.width - 60, g.y + g.height - 60, { steps: 4 }); await p.mouse.up();
    await settle(p, 800);
    const [, red1] = await ink(p);
    ok(red1 > red0 + 100, `box in the thumbnail: red ${red0} → ${red1}`);
    await run(p, 'undo'); await settle(p, 800);
    ok((await ink(p))[1] < red0 + 20, 'undo takes it out of the thumbnail');
    await run(p, 'redo'); await settle(p, 800);
    ok((await ink(p))[1] > red0 + 100, 'redo puts it back');
    await run(p, 'undo'); await settle(p, 800);
    // A watermark
    await p.click('[data-rt="edit"]'); await p.click('[data-cmd="pd_watermark"]'); await p.waitForSelector('#dialog[open] .pd-form');
    await p.fill('#dialog [data-k="text"]', 'WATERMARK'); await p.fill('#dialog [data-k="size"]', '90');
    await p.click('#dialog .dlg-foot .btn.primary'); await settle(p, 900);
    const [dark2] = await ink(p);
    ok(dark2 > dark0 + 300, `watermark in the thumbnail: ${dark0} → ${dark2}`);
    // Saved and opened again: the watermark is still in the thumbnail
    await reopen(p, await savedOf(p)); await p.evaluate(() => window.__cowdreyPdf.pdOpening()); await settle(p, 1200);
    ok((await ink(p))[0] > dark0 + 300, 'after reopening');
    // An applied redaction: the thumbnail is blacked out where the page is
    await openPdf(p);
    await p.click('[data-rt="protect"]'); await p.click('[data-cmd="protRedArea"]');
    await p.mouse.move(g.x + 40, g.y + 40); await p.mouse.down(); await p.mouse.move(g.x + g.width - 40, g.y + 200, { steps: 4 }); await p.mouse.up();
    await p.click('[data-cmd="protRedApply"]'); await p.waitForSelector('#dialog[open]'); await p.click('#dialog .dlg-foot button:has-text("Apply")'); await settle(p, 900);
    const [dark3] = await ink(p);
    ok(dark3 > dark0 + 2000, `redaction in the thumbnail: ${dark0} → ${dark3}`);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('pages: after clicking a thumbnail, page commands act on that page, even the last page at a small zoom', async () => {
    const names = Array.from({ length: 13 }, (_, k) => `P${k + 1}`);
    const p = await open(); await openPdf(p, await named(names), 'Thirteen.pdf');
    for (let k = 0; k < 6; k++) await run(p, 'zoomOut');
    await settle(p, 600);
    await p.click('#sidePanel .thumb[data-n="12"]');
    for (let k = 0; k < 8; k++) { await settle(p, 80); eq(await p.evaluate(() => window.__cowdreyPdf.current), 12, 'still page 13 while it scrolls'); }
    await run(p, 'delPage'); await settle(p, 600);
    eq((await texts(p)).slice(-2), ['P11', 'P12'], 'page 13 was deleted');
    // Straight after a click, with no wait
    await p.click('#sidePanel .thumb[data-n="2"]'); await run(p, 'rotR'); await settle(p, 600);
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.map((e) => e.rot).indexOf(90)), 2, 'page 3 turned');
    // Scrolling by hand lets the page in view decide again
    await p.mouse.move(800, 500); await p.mouse.wheel(0, 3000); await settle(p, 700);
    ok(await p.evaluate(() => window.__cowdreyPdf.current) > 2, 'the wheel moves on');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('thumbnails: one Tab stop, a list box; arrows, Home and End move; Shift+arrows choose; Enter goes to the page', async () => {
    const p = await open(); await openPdf(p, await named(['A', 'B', 'C', 'D', 'E']), 'Five.pdf');
    eq(await p.$eval('#sidePanel .thumbs', (e) => [e.getAttribute('role'), e.getAttribute('aria-multiselectable')]), ['listbox', 'true']);
    eq(await p.$$eval('#sidePanel .thumb', (t) => t.filter((x) => x.tabIndex >= 0).map((x) => x.dataset.n)), ['0'], 'one Tab stop');
    eq(await p.$$eval('#sidePanel .thumb', (t) => t.map((x) => x.getAttribute('aria-label'))), ['Page 1', 'Page 2', 'Page 3', 'Page 4', 'Page 5']);
    await p.focus('#sidePanel .thumb[data-n="0"]');
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown');
    eq(await p.evaluate(() => [document.activeElement.dataset.n, window.__cowdreyPdf.current]), ['2', 2], 'focus and page follow');
    eq(await p.$eval('#sidePanel .thumb[data-n="2"]', (t) => [t.getAttribute('aria-selected'), t.getAttribute('aria-current'), t.tabIndex]), ['true', 'page', 0]);
    await p.keyboard.press('End'); eq(await p.evaluate(() => document.activeElement.dataset.n), '4');
    await p.keyboard.press('Home'); eq(await p.evaluate(() => document.activeElement.dataset.n), '0');
    await p.keyboard.press('ArrowRight');
    await p.keyboard.press('Shift+ArrowDown'); await p.keyboard.press('Shift+ArrowDown');
    eq(await p.evaluate(() => window.__cowdreyPdf.pg60.sel()), [1, 2, 3], 'Shift+arrows choose a run');
    eq(await p.$$eval('#sidePanel .thumb[aria-selected="true"]', (t) => t.map((x) => x.dataset.n)), ['1', '2', '3']);
    await run(p, 'rotR'); await settle(p, 600);
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.map((e) => e.rot)), [0, 90, 90, 90, 0], 'commands work on them');
    ok(await p.evaluate(() => !!document.activeElement.closest('#sidePanel .thumb')), 'focus stays in the list after the change');
    await p.keyboard.press('ArrowDown'); // one page again
    eq(await p.evaluate(() => window.__cowdreyPdf.pg60.sel().length), 1);
    await p.keyboard.press('Enter');
    eq(await p.evaluate(() => [document.activeElement.id, window.__cowdreyPdf.current]), ['viewer', 4], 'Enter goes to the page');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('find: a phrase split across pieces of text is found and shown in the middle of the view; all results list jumps', async () => {
    const d = await L.PDFDocument.create(); const f = await d.embedFont(L.StandardFonts.Helvetica), b = await d.embedFont(L.StandardFonts.HelveticaBold);
    for (let k = 0; k < 3; k++) {
      const pg = d.addPage([600, 800]); pg.drawText(`Page ${k + 1} intro text`, { x: 50, y: 740, size: 14, font: f });
      if (k > 0) { pg.drawText('U', { x: 50, y: 60, size: 14, font: b }); pg.drawText('ser Guide here', { x: 50 + b.widthOfTextAtSize('U', 14), y: 60, size: 14, font: f }); }
    }
    const file = path.join(os.tmpdir(), 'thumbs-find.pdf'); fs.writeFileSync(file, await d.save());
    const p = await open(); await openPdf(p, file, 'Guide.pdf');
    await p.keyboard.press('Control+f'); await p.fill('#findInput', 'user guide'); await settle(p, 700);
    eq(await p.textContent('#findCount'), '1 of 2');
    const inView = () => p.evaluate(() => { const hit = document.querySelector('.find-hit.now'), v = document.querySelector('#viewer').getBoundingClientRect(); if (!hit) return false; const r = hit.getBoundingClientRect(); return r.top >= v.top && r.bottom <= v.bottom; });
    ok(await inView(), 'the match is in view');
    eq(await p.evaluate(() => window.__cowdreyPdf.current), 1);
    // Whole words and match case
    await p.fill('#findInput', 'ser guide'); await settle(p, 700); eq(await p.textContent('#findCount'), '1 of 2');
    await p.click('#findWord'); await settle(p, 500); eq(await p.textContent('#findCount'), 'No matches', 'whole words');
    await p.click('#findWord'); await p.fill('#findInput', 'User Guide'); await p.click('#findCase'); await settle(p, 500); eq(await p.textContent('#findCount'), '1 of 2');
    await p.fill('#findInput', 'user guide'); await settle(p, 600); eq(await p.textContent('#findCount'), 'No matches', 'match case');
    await p.click('#findCase'); await p.fill('#findInput', 'intro'); await settle(p, 600);
    // From the page in view onwards
    eq(await p.textContent('#findCount'), '2 of 3', 'starts on the page in view (page 2)');
    // All results
    await p.click('#findAll');
    eq(await p.$$eval('#findList [data-hit]', (b) => b.map((x) => [x.querySelector('b').textContent, x.querySelector('mark').textContent, /^Page \d intro/.test(x.querySelector('span').textContent)])), [['Page 1', 'intro', true], ['Page 2', 'intro', true], ['Page 3', 'intro', true]]);
    await p.click('#findList [data-hit="0"]'); await settle(p, 300);
    eq(await p.evaluate(() => window.__cowdreyPdf.current), 0); eq(await p.textContent('#findCount'), '1 of 3');
    ok(await inView(), 'the chosen match is in view');
    await p.keyboard.press('Escape'); ok(await p.$eval('#findList', (e) => e.hidden), 'Escape closes the list');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('organize: pages in a grid; choose, drag to reorder, rotate and delete the chosen pages; Escape goes back', async () => {
    const p = await open(); await openPdf(p, await named(['A', 'B', 'C', 'D', 'E']), 'Five.pdf');
    await p.click('[data-rt="pages"]'); await p.click('#ribbonBody [data-cmd="pg60_organize"]'); await settle(p, 600);
    ok(await p.$eval('#pg60Org', (e) => !e.hidden && e.getBoundingClientRect().width > 800), 'the grid fills the view');
    eq(await p.$$eval('.pg60-cell', (c) => c.length), 5);
    eq(await p.$eval('.pg60-org-grid', (e) => getComputedStyle(e).gridTemplateColumns.split(' ').length > 2), true, 'several columns');
    ok(await p.$eval('.pg60-cell[data-n="0"] canvas', (c) => c.width > 150 && c.offsetHeight > 150), 'pages drawn large');
    await p.click('.pg60-cell[data-n="1"]'); await p.click('.pg60-cell[data-n="3"]', { modifiers: ['Shift'] });
    eq(await p.$$eval('.pg60-cell[aria-selected="true"]', (c) => c.map((x) => x.dataset.n)), ['1', '2', '3']);
    await p.click('#ribbonBody [data-cmd="rotR"]'); await settle(p, 600); // the Pages ribbon works on the chosen pages
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.map((e) => e.rot)), [0, 90, 90, 90, 0]);
    // Drag page 5 in front of page 1
    const a = await p.locator('.pg60-cell[data-n="4"]').boundingBox(), b = await p.locator('.pg60-cell[data-n="0"]').boundingBox();
    await p.click('.pg60-cell[data-n="4"]');
    await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p.mouse.down();
    await p.mouse.move(b.x + 10, b.y + b.height / 2, { steps: 8 }); await p.mouse.up(); await settle(p, 600);
    eq(await texts(p), ['E', 'A', 'B', 'C', 'D'], 'dragged to the front');
    // Keys: arrows move, Delete deletes (asks for several), Escape goes back
    await p.focus('.pg60-cell[data-n="0"]'); await p.keyboard.press('ArrowRight');
    eq(await p.evaluate(() => [document.activeElement.dataset.n, window.__cowdreyPdf.current]), ['1', 1]);
    await p.keyboard.press('Delete'); await p.waitForSelector('#dialog[open]'); await p.click('#dialog .btn.primary'); await settle(p, 600);
    eq(await texts(p), ['E', 'B', 'C', 'D'], 'Delete deletes the page');
    await p.keyboard.press('Escape'); await settle(p, 300);
    ok(await p.$eval('#pg60Org', (e) => e.hidden), 'back to the pages');
    ok(await p.$eval('#viewer', (e) => !e.inert && getComputedStyle(e).visibility === 'visible'));
    eq(p.errors, []); await p.ctx.close();
  });

  await test('insert blank pages: size, orientation, how many and where; one step to undo', async () => {
    const p = await open(); await openPdf(p, await named(['A', 'B', 'C']), 'Three.pdf');
    await run(p, 'blank'); await p.waitForSelector('#dialog[open]');
    await p.selectOption('#dialog select[name="size"]', 'a4'); await p.check('#dialog input[name="orient"][value="landscape"]');
    await p.fill('#dialog input[name="count"]', '2'); await p.check('#dialog input[name="where"][value="before"]');
    await p.click('#dialog .btn.primary');
    await p.waitForFunction(() => window.__cowdreyPdf.doc.pages.length === 5, null, { timeout: 10000 }); await settle(p, 500);
    const d = await PDFDocument.load(await savedOf(p));
    eq(d.getPages().map((x) => [Math.round(x.getWidth()), Math.round(x.getHeight())]), [[842, 595], [842, 595], [400, 500], [400, 500], [400, 500]]);
    await run(p, 'blank'); await p.waitForSelector('#dialog[open]');
    await p.check('#dialog input[name="where"][value="end"]'); await p.click('#dialog .btn.primary');
    await p.waitForFunction(() => window.__cowdreyPdf.doc.pages.length === 6, null, { timeout: 10000 }); await settle(p, 500);
    const d2 = await PDFDocument.load(await savedOf(p));
    eq([Math.round(d2.getPage(5).getWidth()), Math.round(d2.getPage(5).getHeight())], [400, 500], 'same as this page (still the page in view, A)');
    await run(p, 'undo'); await settle(p, 500); await run(p, 'undo'); await settle(p, 500);
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.length), 3);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('phone: a Pages button in the status bar opens the sidebar; choosing a page closes it', async () => {
    const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p);
    const b = await p.locator('.statusbar .sb-pages').boundingBox();
    ok(b && b.x >= 0 && b.x + b.width <= 390 && b.width >= 40, 'visible in the status bar');
    await p.tap('.statusbar .sb-pages'); await settle(p, 400);
    eq(await p.$eval('#app', (e) => e.dataset.sidebar), 'open');
    await p.tap('#sidePanel .thumb[data-n="2"]'); await settle(p, 500);
    eq(await p.$eval('#app', (e) => e.dataset.sidebar), 'on'); eq(await p.evaluate(() => window.__cowdreyPdf.current), 2);
    ok(await p.$eval('.sb-pages', (e) => e.getClientRects().length > 0));
    const desk = await open(); await openPdf(desk);
    eq(await desk.$eval('.statusbar .sb-pages', (e) => getComputedStyle(e).display), 'none', 'not on wide screens');
    eq(p.errors, []); await p.ctx.close(); await desk.ctx.close();
  });
};
