// Links: the Link tool adds web and page links, changes or deletes links already in the PDF; all saved as /Link annotations.
export default async (h) => {
  const { test, open, openPdf, eq, ok, savedOf, reopen, at, require, path, root, fs, PDFDocument } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const N = (s) => L.PDFName.of(s);
  const tmp = path.join(require('node:os').tmpdir(), `cowdrey-links-${process.pid}.pdf`);
  // A three-page PDF whose first page has a web link ("Visit the site") and a link to page 3 ("See page three").
  async function linked() {
    const d = await L.PDFDocument.create(), f = await d.embedFont(L.StandardFonts.Helvetica);
    const pages = [1, 2, 3].map((n) => { const pg = d.addPage([612, 792]); pg.drawText(`Page ${n} heading`, { x: 72, y: 720, size: 20, font: f }); return pg; });
    pages[0].drawText('Visit the site', { x: 72, y: 600, size: 14, font: f });
    pages[0].drawText('See page three', { x: 72, y: 500, size: 14, font: f });
    const web = d.context.register(d.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [70, 595, 170, 615], Border: [0, 0, 0], A: { S: 'URI', URI: L.PDFString.of('https://old.example.com/') } }));
    const go = d.context.register(d.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [70, 495, 180, 515], Border: [0, 0, 0], Dest: [pages[2].ref, 'XYZ', 0, 792, null] }));
    pages[0].node.set(N('Annots'), d.context.obj([web, go]));
    fs.writeFileSync(tmp, await d.save()); return tmp;
  }
  // The links on a saved page: [rect, uri or saved page index]
  const linksOf = (d, n) => {
    const a = d.getPage(n).node.lookup(N('Annots'));
    const refs = d.getPages().map((pg) => pg.ref.toString());
    return (a ? a.asArray() : []).map((r) => d.context.lookup(r)).filter((x) => String(x.get(N('Subtype'))) === '/Link').map((x) => {
      const act = x.lookup(N('A')), dest = x.lookup(N('Dest'));
      const uri = act && act.lookup(N('URI')); const to = uri ? (uri.decodeText ? uri.decodeText() : String(uri)) : dest ? refs.indexOf(String(dest.get(0))) : null;
      return [x.lookup(N('Rect')).asArray().map((v) => Math.round(v.asNumber())), to];
    });
  };
  const drag = async (p, [x1, y1], [x2, y2]) => { const a = await at(p, x1, y1), b = await at(p, x2, y2); await p.mouse.move(...a); await p.mouse.down(); await p.mouse.move(...b, { steps: 6 }); await p.mouse.up(); await p.waitForSelector('#dialog[open]'); };
  const jump = async (p, n) => {
    await p.$eval('#pageJump', (e, v) => { e.value = v; e.dispatchEvent(new Event('change')); }, String(n));
    await p.waitForFunction((k) => window.__cowdreyPdf.current === k, n - 1, { timeout: 5000 }); await p.waitForTimeout(900);
    eq(await p.evaluate(() => window.__cowdreyPdf.current), n - 1, 'on page ' + n);
  };
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id).then(() => p.waitForTimeout(300));
  const stubOpen = (p) => p.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  const linkMarks = (p) => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().filter((m) => /link|lnkx|ae/.test(m.type)).map((m) => ({ type: m.type, uri: m.uri, page: m.page, deleted: m.deleted })));

  await test('Links: add a web link (on a rotated page) and a link to a page; saved as real links that follow page moves', async () => {
    const p = await open(); await openPdf(p);
    await run(p, 'rotR');
    await p.click('[data-rt="edit"]'); await p.click('[data-cmd="tool_link"]');
    ok(await p.$eval('[data-cmd="tool_link"]', (b) => b.getAttribute('aria-pressed') === 'true'), 'tool on');
    await drag(p, [100, 700], [250, 680]);
    ok(await p.$('#dialog[open] #lnkUrl'), 'asks for the address');
    await p.fill('#lnkUrl', 'example.com/pelicans'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(300);
    await drag(p, [100, 300], [200, 260]);
    await p.click('#dialog .lnk-kind input[value="page"]'); await p.fill('#lnkPage', '3'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(300);
    eq(await linkMarks(p), [{ type: 'link', uri: 'https://example.com/pelicans' }, { type: 'link', page: '0:2' }]);
    eq(await p.$$eval('.page[data-n="0"] .marks .lnk-box', (e) => e.filter((x) => getComputedStyle(x).display !== 'none').length), 2, 'dashed boxes with the Link tool');
    // a page number that isn't there is refused
    await drag(p, [300, 300], [400, 260]);
    await p.click('#dialog .lnk-kind input[value="page"]'); await p.fill('#lnkPage', '9'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(200);
    ok(await p.$('#dialog[open]'), 'asked again'); await p.click('#dialog [data-x]'); await p.waitForTimeout(200);
    eq((await linkMarks(p)).length, 2, 'nothing added');
    let d = await PDFDocument.load(await savedOf(p));
    eq(linksOf(d, 0), [[[100, 680, 250, 700], 'https://example.com/pelicans'], [[100, 260, 200, 300], 2]]);
    // normal view: the boxes are hidden, the links are followed
    await run(p, 'tool_select');
    eq(await p.$$eval('.page[data-n="0"] .marks .lnk-box', (e) => e.filter((x) => getComputedStyle(x).display !== 'none').length), 0, 'hidden in normal view');
    await stubOpen(p);
    await p.mouse.click(...await at(p, 170, 690)); await p.waitForTimeout(200);
    eq(await p.evaluate(() => window.__opened), ['https://example.com/pelicans']);
    await p.mouse.click(...await at(p, 150, 280)); await p.waitForTimeout(700);
    eq(await p.evaluate(() => window.__cowdreyPdf.current), 2, 'went to page 3');
    // page 3 moved to second place: the link follows it; deleted: the link is not saved
    await jump(p, 3); await run(p, 'up');
    d = await PDFDocument.load(await savedOf(p));
    eq(linksOf(d, 0).map((x) => x[1]), ['https://example.com/pelicans', 1]);
    await jump(p, 2); await run(p, 'delPage');
    d = await PDFDocument.load(await savedOf(p));
    eq(linksOf(d, 0).map((x) => x[1]), ['https://example.com/pelicans']);
    // undo brings the page and the link back; the reopened PDF has the links pdf.js can follow
    await p.keyboard.press('Control+z'); await p.waitForTimeout(500);
    const out = await savedOf(p);
    await reopen(p, out);
    const got = await p.evaluate(async () => (await window.__cowdreyPdf.views()[0].page.getAnnotations()).filter((a) => a.annotationType === 2).map((a) => a.url || (Array.isArray(a.dest) ? 'dest' : null)));
    eq(got, ['https://example.com/pelicans', 'dest']);
    eq(await p.$$eval('.page[data-n="0"] .annotationLayer .linkAnnotation', (e) => e.length), 2, 'clickable after reopening');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Links: a link already in the PDF is changed, another deleted; undo; saved PDF and the view follow', async () => {
    const p = await open(); await openPdf(p, await linked(), 'Linked.pdf');
    eq(await p.$$eval('.page[data-n="0"] .annotationLayer .linkAnnotation', (e) => e.length), 2);
    await run(p, 'tool_link');
    eq(await p.$$eval('.page[data-n="0"] .lnk-out', (e) => e.filter((x) => getComputedStyle(x).display !== 'none').length), 2, 'outlined with the Link tool');
    await p.mouse.move(...await at(p, 120, 605)); await p.waitForTimeout(300);
    eq(await p.$$eval('.page[data-n="0"] .lnk-out.lnk-hover', (e) => e.length), 1, 'hover shows the link');
    await p.mouse.click(...await at(p, 120, 605)); await p.waitForSelector('#dialog[open]');
    eq(await p.inputValue('#lnkUrl'), 'https://old.example.com/');
    await p.fill('#lnkUrl', 'https://new.example.com/here'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(300);
    await p.mouse.click(...await at(p, 120, 505)); await p.waitForSelector('#dialog[open]');
    eq(await p.$eval('#dialog .lnk-kind input[value="page"]', (r) => r.checked), true, 'a page link');
    eq(await p.inputValue('#lnkPage'), '3');
    await p.click('#dialog .btn.danger'); await p.waitForTimeout(800);
    eq((await linkMarks(p)).map((m) => m.type), ['lnkx', 'ae']);
    eq(await p.$$eval('.page[data-n="0"] .annotationLayer .linkAnnotation', (e) => e.length), 1, 'deleted link gone from the page');
    // in normal view the changed link goes to its new address
    await run(p, 'tool_select'); await stubOpen(p);
    await p.mouse.click(...await at(p, 120, 605)); await p.waitForTimeout(200);
    eq(await p.evaluate(() => window.__opened), ['https://new.example.com/here']);
    let d = await PDFDocument.load(await savedOf(p));
    eq(linksOf(d, 0), [[[70, 595, 170, 615], 'https://new.example.com/here']]);
    ok(!d.context.enumerateIndirectObjects().some(([, o]) => o instanceof L.PDFDict && o.lookup(N('Dest'))), 'the deleted link is not left in the file');
    // undo the delete: it is back on screen and in the saved PDF
    await p.keyboard.press('Control+z'); await p.waitForTimeout(800);
    eq(await p.$$eval('.page[data-n="0"] .annotationLayer .linkAnnotation', (e) => e.length), 2, 'back after undo');
    d = await PDFDocument.load(await savedOf(p));
    eq(linksOf(d, 0), [[[70, 595, 170, 615], 'https://new.example.com/here'], [[70, 495, 180, 515], 2]]);
    // change the page link to point at page 2 (copied pages: the first page moved last)
    await run(p, 'tool_link');
    await p.mouse.click(...await at(p, 120, 505)); await p.waitForSelector('#dialog[open]');
    await p.fill('#lnkPage', '2'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(300);
    await jump(p, 1); await run(p, 'down'); await run(p, 'down');
    d = await PDFDocument.load(await savedOf(p));
    eq(linksOf(d, 2), [[[70, 595, 170, 615], 'https://new.example.com/here'], [[70, 495, 180, 515], 0]], 'page 2 is now first');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Links: the PDF\'s own page links follow their page when pages are reordered, and go when it is deleted', async () => {
    const p = await open(); await openPdf(p, await linked(), 'Linked.pdf');
    let d = await PDFDocument.load(await savedOf(p));
    eq(linksOf(d, 0), [[[70, 595, 170, 615], 'https://old.example.com/'], [[70, 495, 180, 515], 2]], 'unchanged file');
    await jump(p, 3); await run(p, 'up'); // page 3 now second
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.map((e) => e.i)), [0, 2, 1], 'order');
    d = await PDFDocument.load(await savedOf(p));
    eq(d.getPageCount(), 3);
    eq(d.context.enumerateIndirectObjects().filter(([, o]) => o instanceof L.PDFDict && String(o.get(N('Type'))) === '/Page').length, 3, 'no stray copy of the linked page');
    eq(linksOf(d, 0), [[[70, 595, 170, 615], 'https://old.example.com/'], [[70, 495, 180, 515], 1]]);
    await reopen(p, await savedOf(p));
    await p.waitForSelector('.page[data-n="0"] .annotationLayer .linkAnnotation');
    await p.click('.page[data-n="0"] .annotationLayer .linkAnnotation:nth-child(2) a'); await p.waitForTimeout(700);
    eq(await p.evaluate(() => window.__cowdreyPdf.current), 1, 'the link goes to the moved page');
    await openPdf(p, await linked(), 'Linked.pdf');
    await jump(p, 3); await run(p, 'delPage');
    d = await PDFDocument.load(await savedOf(p));
    eq(linksOf(d, 0), [[[70, 595, 170, 615], 'https://old.example.com/']], 'link to the deleted page removed');
    fs.rmSync(tmp, { force: true });
    eq(p.errors, []); await p.ctx.close();
  });
};
