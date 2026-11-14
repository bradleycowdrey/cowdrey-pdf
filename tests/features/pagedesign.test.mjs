// Page design: watermark, background, header & footer, Bates numbering (src/features/40-page-design.js).
export default async (h) => {
  const { test, eq, ok, open, openPdf, savedOf, reopen, pageText, path, fs, require, root } = h;
  const pdfjs = await import(path.join(root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  // The text of every page of a saved PDF, as pdf.js reads it (items in content order).
  const texts = async (bytes) => {
    const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise; const out = [];
    for (let i = 1; i <= d.numPages; i++) out.push((await (await d.getPage(i)).getTextContent()).items.map((x) => x.str).filter((s) => s.trim()));
    await d.loadingTask.destroy(); return out;
  };
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
  const items = (p) => p.evaluate(() => window.__cowdreyPdf.pdItems());
  const add = async (p, id, fill = {}, select = {}) => {
    await run(p, id); await p.waitForSelector('#dialog[open] .pd-form');
    for (const [k, v] of Object.entries(select)) await p.selectOption(`#dialog [data-k="${k}"]`, v);
    for (const [k, v] of Object.entries(fill)) await p.fill(`#dialog [data-k="${k}"]`, String(v));
    await p.click('#dialog .dlg-foot .btn.primary'); await p.waitForTimeout(300);
  };
  const overlay = (p, n, which = 'pd-over') => p.$$eval(`.page[data-n="${n}"] svg.${which} text`, (t) => t.map((x) => x.textContent));
  const showPage = async (p, n) => { await p.evaluate((k) => window.__cowdreyPdf.views()[k].el.scrollIntoView(), n); await p.waitForTimeout(600); };

  await h.test('page design: a text watermark on chosen pages, in front or tiled behind, on screen and in the saved PDF', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="edit"]'); await p.click('[data-cmd="pd_watermark"]'); await p.waitForSelector('#dialog[open] .pd-form');
    await p.fill('#dialog [data-k="text"]', 'DRAFT COPY'); await p.fill('#dialog [data-k="range"]', '1-2');
    await p.click('#dialog .dlg-foot button:has-text("Add watermark")'); await p.waitForTimeout(300);
    eq(await overlay(p, 0), ['DRAFT COPY'], 'shown on page 1');
    await add(p, 'pd_watermark', { text: 'BEHIND ME', size: 30 }, { layout: 'tile', front: 'behind', font: 'serif' });
    const tiles = await overlay(p, 0, 'pd-under');
    ok(tiles.length > 4 && tiles.every((t) => t === 'BEHIND ME'), 'tiled behind: ' + tiles.length);
    eq((await items(p)).map((m) => [m.type, m.text, m.front, m.layout]), [['pd_watermark', 'DRAFT COPY', 'front', 'center'], ['pd_watermark', 'BEHIND ME', 'behind', 'tile']]);
    const t = await texts(await savedOf(p));
    eq(t.map((x) => x.includes('DRAFT COPY')), [true, true, false], 'front watermark on pages 1-2 only');
    ok(t.every((x) => x.filter((s) => s === 'BEHIND ME').length > 4), 'tiled on every page: ' + JSON.stringify(t));
    const k0 = t[0].indexOf('Quarterly report, page 1');
    ok(k0 > 4 && t[0].slice(0, k0).every((s) => 'BEHIND ME'.includes(s)), 'behind: drawn before the page content');
    ok(t[0].indexOf('DRAFT COPY') > t[0].indexOf('Quarterly report, page 1'), 'in front: drawn after the page content');
    eq(p.errors, []); await p.ctx.close();
  });

  await h.test('page design: a background colour goes behind the page on chosen pages, on screen and when saved', async () => {
    const p = await open(); await openPdf(p);
    await add(p, 'pd_background', { color: '#ffe066', range: '2' });
    await showPage(p, 1);
    eq(await p.$$eval('.page[data-n="1"] svg.pd-under rect', (r) => r.map((x) => x.getAttribute('fill'))), ['#ffe066']);
    eq(await p.$$('.page[data-n="0"] svg.pd-under rect'), [], 'not on page 1');
    const out = await savedOf(p);
    const t = await texts(out);
    ok(t[1].includes('Quarterly report, page 2'), 'the page text is still there');
    await reopen(p, out); await showPage(p, 1);
    const px = (n, x, y) => p.evaluate(([n, x, y]) => { const v = window.__cowdreyPdf.views()[n]; const c = v.el.querySelector('canvas.pdf'); const [a, b] = v.viewport.convertToViewportPoint(x, y); const k = c.width / v.viewport.width; return [...c.getContext('2d').getImageData(Math.round(a * k), Math.round(b * k), 1, 1).data].slice(0, 3); }, [n, x, y]);
    const bg = await px(1, 20, 20);
    ok(Math.abs(bg[0] - 255) < 6 && Math.abs(bg[1] - 224) < 6 && Math.abs(bg[2] - 102) < 6, 'page 2 is yellow: ' + bg);
    ok((await px(0, 20, 20)).every((c) => c > 250), 'page 1 stays white');
    eq(p.errors, []); await p.ctx.close();
  });

  await h.test('page design: header & footer with page number, page count and date on every page; numbers follow the saved order', async () => {
    const p = await open(); await openPdf(p);
    await add(p, 'pd_headfoot', { tl: 'Cowdrey report', tr: 'Printed <<date>>' }, { dateFmt: 'yyyy-mm-dd' });
    const today = await p.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    eq((await overlay(p, 0)).sort(), ['Cowdrey report', 'Page 1 of 3', 'Printed ' + today].sort(), 'on screen');
    let out = await savedOf(p), t = await texts(out);
    for (let k = 0; k < 3; k++) ok(t[k].includes(`Page ${k + 1} of 3`) && t[k].includes('Cowdrey report') && t[k].includes('Printed ' + today), `page ${k + 1}: ${t[k]}`);
    await reopen(p, out);
    const tl = await pageText(p); ok(tl.includes('Page 1 of 3') && tl.includes('Cowdrey report'), 'text layer of the reopened PDF: ' + tl);
    // the order changed: numbers follow the pages as saved
    await openPdf(p); await add(p, 'pd_headfoot', {});
    await run(p, 'down'); await p.waitForTimeout(400);
    t = await texts(await savedOf(p));
    ok(t[0].includes('Quarterly report, page 2') && t[0].includes('Page 1 of 3'), 'moved page is page 1: ' + t[0]);
    ok(t[1].includes('Quarterly report, page 1') && t[1].includes('Page 2 of 3'), t[1]);
    // extracting one page numbers it 1 of 1
    const one = Buffer.from(await p.evaluate(async () => Array.from(await window.__cowdreyPdf.buildPdf([2]))));
    eq((await texts(one))[0].filter((s) => /^Page/.test(s)), ['Page 1 of 1']);
    // first page number and a range
    await p.evaluate(() => window.__cowdreyPdf.run('pd_manage')); await p.waitForSelector('#dialog[open] [data-edit]');
    await p.click('#dialog [data-edit]'); await p.waitForSelector('#dialog[open] .pd-form');
    await p.fill('#dialog [data-k="start"]', '5'); await p.fill('#dialog [data-k="range"]', '2-3');
    await p.click('#dialog .dlg-foot button:has-text("Save changes")'); await p.waitForTimeout(300);
    t = await texts(await savedOf(p));
    eq(t.map((x) => x.filter((s) => /^Page \d/.test(s))), [[], ['Page 5 of 6'], ['Page 6 of 6']]);
    eq(p.errors, []); await p.ctx.close();
  });

  await h.test('page design: Bates numbers with prefix, digits and suffix run across the saved pages in their place', async () => {
    const p = await open(); await openPdf(p);
    await add(p, 'pd_bates', { prefix: 'CASE-', start: 41, digits: 5, suffix: '-X', range: '2-3' }, { slot: 'tr' });
    const out = await savedOf(p);
    eq((await texts(out)).map((x) => x.filter((s) => s.startsWith('CASE-'))), [[], ['CASE-00041-X'], ['CASE-00042-X']]);
    const d = await pdfjs.getDocument({ data: new Uint8Array(out), verbosity: 0 }).promise, pg = await d.getPage(2), vp = pg.getViewport({ scale: 1 });
    const it = (await pg.getTextContent()).items.find((x) => x.str === 'CASE-00041-X');
    const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    ok(x > vp.width / 2 && y < 60, `top right: ${x}, ${y}`); await d.loadingTask.destroy();
    // shown on screen too
    await showPage(p, 2); eq(await overlay(p, 2), ['CASE-00042-X']);
    eq(p.errors, []); await p.ctx.close();
  });

  await h.test('page design: Manage lists what was added; edit, remove, undo and redo', async () => {
    const p = await open(); await openPdf(p);
    await add(p, 'pd_watermark', { text: 'FIRST' });
    await p.click('[data-rt="edit"]'); await p.click('[data-cmd="pd_manage"]'); await p.waitForSelector('#dialog[open] .pd-row');
    ok((await p.textContent('#dialog .pd-row')).includes('FIRST'), 'listed');
    await p.click('#dialog [data-edit]'); await p.waitForSelector('#dialog[open] .pd-form');
    eq(await p.inputValue('#dialog [data-k="text"]'), 'FIRST');
    await p.fill('#dialog [data-k="text"]', 'SECOND'); await p.click('#dialog .dlg-foot button:has-text("Save changes")'); await p.waitForTimeout(300);
    eq((await items(p)).map((m) => m.text), ['SECOND']); eq(await overlay(p, 0), ['SECOND'], 'updated on screen');
    await run(p, 'pd_manage'); await p.waitForSelector('#dialog[open] .pd-row');
    await p.click('#dialog [data-remove]'); await p.waitForTimeout(200);
    ok((await p.textContent('#dialog .dlg-body')).includes('Nothing added yet'), 'list is empty');
    await p.click('#dialog .dlg-foot .btn.primary'); await p.waitForTimeout(200);
    eq(await items(p), []); eq(await overlay(p, 0), [], 'gone from the page');
    ok(!(await texts(await savedOf(p)))[0].includes('SECOND'), 'not in the saved PDF');
    await p.keyboard.press('Control+z'); await p.waitForTimeout(300);
    eq(await overlay(p, 0), ['SECOND'], 'undo brings it back');
    await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(300);
    eq(await overlay(p, 0), [], 'redo removes it again');
    eq(p.errors, []); await p.ctx.close();
  });

  await h.test('page design: a picture watermark and a header on a rotated page keep their place; dialogs fit a phone', async () => {
    const p = await open(); await openPdf(p);
    const png = Buffer.from(await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 120; c.height = 60; const g = c.getContext('2d'); g.fillStyle = '#2448C9'; g.fillRect(0, 0, 120, 60); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
    const file = path.join(root, 'tests/fixtures/.pd-logo.png'); fs.writeFileSync(file, png);
    try {
      await run(p, 'pd_watermark'); await p.waitForSelector('#dialog[open] .pd-form');
      await p.click('#dialog .pd-seg label:has-text("Picture")');
      ok(await p.isVisible('#dialog [data-file]'), 'picture field shown');
      await p.setInputFiles('#dialog [data-file]', file); await p.waitForSelector('#dialog [data-pic]:not([hidden])');
      await p.fill('#dialog [data-k="scale"]', '40'); await p.click('#dialog .dlg-foot .btn.primary'); await p.waitForTimeout(300);
    } finally { fs.unlinkSync(file); }
    eq(await p.$$eval('.page[data-n="0"] svg.pd-over image', (e) => e.length), 1, 'picture on screen');
    await run(p, 'rotR'); await p.waitForTimeout(600);
    await add(p, 'pd_headfoot', { tl: 'Rotated header', bc: '' });
    const out = await savedOf(p);
    const d = await L.PDFDocument.load(out), pg = d.getPage(0);
    eq(pg.getRotation().angle, 90);
    const xo = pg.node.Resources().lookup(L.PDFName.of('XObject'), L.PDFDict);
    const imgs = xo.keys().map((k) => xo.lookup(k)).filter((s) => String(s.dict.get(L.PDFName.of('Subtype'))) === '/Image');
    eq(imgs.map((s) => s.dict.get(L.PDFName.of('Width')).asNumber()), [120], 'the picture is in the page');
    const pd = await pdfjs.getDocument({ data: new Uint8Array(out), verbosity: 0 }).promise, p1 = await pd.getPage(1), vp = p1.getViewport({ scale: 1 });
    const it = (await p1.getTextContent()).items.find((x) => x.str === 'Rotated header');
    const m = pdfjs.Util.transform(vp.transform, it.transform);
    ok(m[4] < 80 && m[5] < 70 && m[0] > 0 && Math.abs(m[1]) < .01, `top left of the turned page and upright: ${m.map((v) => v.toFixed(1))}`);
    await pd.loadingTask.destroy();
    eq(p.errors, []); await p.ctx.close();
    const ph = await open({ width: 390, height: 844, touch: true }); await openPdf(ph);
    for (const id of ['pd_watermark', 'pd_headfoot', 'pd_bates']) {
      await run(ph, id); await ph.waitForSelector('#dialog[open] .pd-form');
      const w = await ph.$eval('#dialog', (e) => e.getBoundingClientRect().right);
      ok(w <= 390, id + ' dialog fits: ' + w); eq(await ph.evaluate(() => document.querySelector('#dialog .dlg-body').scrollWidth <= document.querySelector('#dialog .dlg-body').clientWidth), true, id + ' no sideways scroll');
      await ph.click('#dialog [data-x]'); await ph.waitForTimeout(150);
    }
    eq(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await ph.ctx.close();
  });
};
