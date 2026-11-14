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
  // Adds one; when there is one of that kind already, the button opens it, and "Add another" starts a new one.
  const add = async (p, id, fill = {}, select = {}) => {
    await run(p, id); await p.waitForSelector('#dialog[open] .pd-form');
    if (/^Edit/.test(await p.textContent('#dialog h2'))) { await p.click('#dialog .dlg-foot button:has-text("Add another")'); await p.waitForFunction(() => !/^Edit/.test(document.querySelector('#dialog[open] h2').textContent)); await p.waitForSelector('#dialog[open] .pd-form'); }
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
    // drawn into page 2 only, as tagged content
    const d = await L.PDFDocument.load(out);
    const content = (n) => { const c = d.getPage(n).node.Contents(); return (c instanceof L.PDFArray ? c.asArray() : [c]).map((r) => { const st = d.context.lookup(r); return Buffer.from(st instanceof L.PDFRawStream ? L.decodePDFRawStream(st).decode() : st.getContents()).toString('latin1'); }).join('\n'); };
    ok(/CowdreyPdfPD[\s\S]*1 0\.87\d* 0\.4 rg[\s\S]*EMC/.test(content(1)), 'yellow fill tagged on page 2');
    ok(!/CowdreyPdfPD/.test(content(0)), 'nothing on page 1');
    // reopened, it is a setting again (drawn on screen, taken out of the page itself)
    await reopen(p, out); await p.evaluate(() => window.__cowdreyPdf.pdOpening()); await showPage(p, 1);
    eq((await items(p)).map((m) => [m.type, m.color, m.range]), [['pd_background', '#ffe066', '2']]);
    eq(await p.$$eval('.page[data-n="1"] svg.pd-under rect', (r) => r.map((x) => x.getAttribute('fill'))), ['#ffe066']);
    const px = (n, x, y) => p.evaluate(([n, x, y]) => { const v = window.__cowdreyPdf.views()[n]; const c = v.el.querySelector('canvas.pdf'); const [a, b] = v.viewport.convertToViewportPoint(x, y); const k = c.width / v.viewport.width; return [...c.getContext('2d').getImageData(Math.round(a * k), Math.round(b * k), 1, 1).data].slice(0, 3); }, [n, x, y]);
    ok((await px(1, 20, 20)).every((c) => c > 250), 'the page itself no longer has it');
    eq(p.errors, []); await p.ctx.close();
  });

  await h.test('page design: header & footer with page number, page count and date on every page; numbers follow the saved order', async () => {
    const p = await open(); await openPdf(p);
    await add(p, 'pd_headfoot', { tl: 'Cowdrey report', tr: 'Printed <<date>>' }, { dateFmt: 'yyyy-mm-dd' });
    const today = await p.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    eq((await overlay(p, 0)).sort(), ['Cowdrey report', 'Page 1 of 3', 'Printed ' + today].sort(), 'on screen');
    let out = await savedOf(p), t = await texts(out);
    for (let k = 0; k < 3; k++) ok(t[k].includes(`Page ${k + 1} of 3`) && t[k].includes('Cowdrey report') && t[k].includes('Printed ' + today), `page ${k + 1}: ${t[k]}`);
    await reopen(p, out); await p.evaluate(() => window.__cowdreyPdf.pdOpening()); await p.waitForTimeout(300);
    const tl = await pageText(p); ok(!tl.includes('Page 1 of 3'), 'taken out of the reopened page: ' + tl);
    eq((await overlay(p, 0)).sort(), ['Cowdrey report', 'Page 1 of 3', 'Printed ' + today].sort(), 'shown again from its settings');
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

  await h.test('page design: after saving and reopening, the watermark and header can be updated or removed', async () => {
    const p = await open(); await openPdf(p);
    await add(p, 'pd_watermark', { text: 'DRAFT (é)' });
    await add(p, 'pd_headfoot', { tl: 'Acme report' });
    const out = await savedOf(p);
    let t = await texts(out);
    ok(t.every((x) => x.includes('DRAFT (é)') && x.includes('Acme report')), 'drawn on every page');
    const d = await L.PDFDocument.load(out);
    const kept = JSON.parse(d.getInfoDict().lookup(L.PDFName.of('CowdreyPdfPD')).decodeText());
    eq(kept.map((m) => m.type), ['pd_watermark', 'pd_headfoot'], 'settings kept in the file');
    // reopen: listed in Manage, drawn once (from the settings, not twice)
    await reopen(p, out); await p.evaluate(() => window.__cowdreyPdf.pdOpening()); await p.waitForTimeout(300);
    eq((await items(p)).map((m) => m.text || m.tl), ['DRAFT (é)', 'Acme report']);
    eq((await overlay(p, 0)).sort(), ['Acme report', 'DRAFT (é)', 'Page 1 of 3'].sort());
    ok(!(await pageText(p)).includes('DRAFT'), 'not left in the page');
    await run(p, 'pd_manage'); await p.waitForSelector('#dialog[open] .pd-row');
    eq(await p.$$eval('#dialog .pd-row strong', (e) => e.map((x) => x.textContent)), ['Watermark', 'Header & footer']);
    // update the watermark, remove the header
    await p.click('#dialog .pd-row:first-child [data-edit]'); await p.waitForSelector('#dialog[open] .pd-form');
    await p.fill('#dialog [data-k="text"]', 'FINAL'); await p.click('#dialog .dlg-foot button:has-text("Save changes")'); await p.waitForTimeout(300);
    await run(p, 'pd_manage'); await p.waitForSelector('#dialog[open] .pd-row');
    await p.click('#dialog .pd-row:last-child [data-remove]'); await p.waitForTimeout(200);
    await p.click('#dialog .dlg-foot .btn.primary'); await p.waitForTimeout(200);
    const out2 = await savedOf(p);
    t = await texts(out2);
    ok(t.every((x) => x.filter((s) => s === 'FINAL').length === 1 && !x.some((s) => /DRAFT|Acme|Page \d of/.test(s))), 'updated and removed: ' + JSON.stringify(t));
    ok(t[0].includes('Quarterly report, page 1'), 'page content kept');
    // remove everything: no settings left in the file either
    await reopen(p, out2); await p.evaluate(() => window.__cowdreyPdf.pdOpening()); await p.waitForTimeout(300);
    await run(p, 'pd_manage'); await p.waitForSelector('#dialog[open] .pd-row');
    await p.click('#dialog [data-remove]'); await p.waitForTimeout(200); await p.click('#dialog .dlg-foot .btn.primary');
    const out3 = await savedOf(p);
    ok((await texts(out3)).every((x) => !x.includes('FINAL')), 'watermark removed');
    ok(!(await L.PDFDocument.load(out3)).getInfoDict().has(L.PDFName.of('CowdreyPdfPD')), 'no settings left');
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

  const title = (p) => p.textContent('#dialog[open] h2');
  const foot = (p) => p.$$eval('#dialog[open] .dlg-foot button', (b) => b.map((x) => x.textContent));
  const openProtected = async (p, bytes) => {
    const opening = p.evaluate(async (b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return window.__cowdreyPdf.openBytes(u, 'Secret.pdf'); }, Buffer.from(bytes).toString('base64'));
    await p.waitForSelector('#dialog[open] #dlgInput'); await p.fill('#dlgInput', 'pelican'); await p.click('#dialog .btn.primary');
    await opening; await h.waitPages(p); await p.waitForTimeout(400);
  };

  await h.test('page design: the Watermark, Background, Header & footer and Bates buttons open the one already there; Add another and Remove', async () => {
    const p = await open(); await openPdf(p);
    await add(p, 'pd_watermark', { text: 'ONE' });
    // a second press opens it for changing, not a blank one that stacks a copy
    await run(p, 'pd_watermark'); await p.waitForSelector('#dialog[open] .pd-form');
    eq(await title(p), 'Edit watermark'); eq(await p.inputValue('#dialog [data-k="text"]'), 'ONE');
    eq(await foot(p), ['Remove', 'Add another', 'Cancel', 'Save changes']);
    await p.fill('#dialog [data-k="text"]', 'TWO'); await p.click('#dialog .dlg-foot button:has-text("Save changes")'); await p.waitForTimeout(300);
    eq((await items(p)).map((m) => m.text), ['TWO'], 'changed, not added');
    // Add another starts a new one next to it
    await run(p, 'pd_watermark'); await p.waitForSelector('#dialog[open] .pd-form');
    await p.click('#dialog .dlg-foot button:has-text("Add another")');
    await p.waitForFunction(() => document.querySelector('#dialog[open] h2') && document.querySelector('#dialog[open] h2').textContent === 'Watermark');
    eq(await foot(p), ['Cancel', 'Add watermark']);
    await p.fill('#dialog [data-k="text"]', 'THREE'); await p.click('#dialog .dlg-foot .btn.primary'); await p.waitForTimeout(300);
    eq((await items(p)).map((m) => m.text), ['TWO', 'THREE']);
    // with two, the button lists them, with Add another
    await run(p, 'pd_watermark'); await p.waitForSelector('#dialog[open] .pd-row');
    eq(await title(p), 'Watermark'); eq(await p.$$eval('#dialog .pd-row', (r) => r.length), 2);
    eq(await foot(p), ['Add another', 'Close']);
    await p.click('#dialog .pd-row:last-child [data-edit]'); await p.waitForSelector('#dialog[open] .pd-form');
    eq(await p.inputValue('#dialog [data-k="text"]'), 'THREE');
    await p.click('#dialog .dlg-foot button:has-text("Remove")'); await p.waitForTimeout(300);
    eq((await items(p)).map((m) => m.text), ['TWO'], 'removed from its own dialog');
    // the same for the other three
    await add(p, 'pd_background', { color: '#ffe066' }); await add(p, 'pd_headfoot', { tl: 'Acme' }); await add(p, 'pd_bates', { prefix: 'X-' });
    for (const [id, t, k, v] of [['pd_background', 'Edit background', 'color', '#ffe066'], ['pd_headfoot', 'Edit header & footer', 'tl', 'Acme'], ['pd_bates', 'Edit Bates numbering', 'prefix', 'X-']]) {
      await run(p, id); await p.waitForSelector('#dialog[open] .pd-form');
      eq([await title(p), await p.inputValue(`#dialog [data-k="${k}"]`)], [t, v]);
      await p.click('#dialog .dlg-foot button:has-text("Remove")'); await p.waitForTimeout(250);
    }
    eq((await items(p)).map((m) => m.type), ['pd_watermark']);
    await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
    eq((await items(p)).map((m) => m.type), ['pd_watermark', 'pd_bates'], 'undo brings a removed one back');
    // after saving and reopening, the button opens the saved one
    await reopen(p, await savedOf(p)); await p.evaluate(() => window.__cowdreyPdf.pdOpening()); await p.waitForTimeout(300);
    await run(p, 'pd_watermark'); await p.waitForSelector('#dialog[open] .pd-form');
    eq([await title(p), await p.inputValue('#dialog [data-k="text"]')], ['Edit watermark', 'TWO']);
    await p.click('#dialog .dlg-foot button:has-text("Save changes")'); await p.waitForTimeout(300);
    eq((await items(p)).filter((m) => m.type === 'pd_watermark').length, 1, 'still one watermark');
    eq(p.errors, []); await p.ctx.close();
  });

  await h.test('page design: the dialogs show a live preview of the page, and the page stays visible behind them', async () => {
    const p = await open(); await openPdf(p);
    await run(p, 'pd_watermark'); await p.waitForSelector('#dialog[open] .pd-form');
    await p.waitForFunction(() => { const c = document.querySelector('#dialog .pd-prev canvas'); return c && c.width > 100; });
    const prev = (cls) => p.$$eval(`#dialog .pd-prev svg.${cls} text`, (t) => t.map((x) => [x.textContent, x.getAttribute('transform') || '', x.getAttribute('fill-opacity'), x.getAttribute('font-size')]));
    const ink = await p.evaluate(() => { const c = document.querySelector('#dialog .pd-prev canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 100) n++; return n; });
    ok(ink > 200, 'the page is drawn in the preview: ' + ink);
    eq(await p.textContent('#dialog .pd-prev figcaption'), 'Page 1 of 3');
    let o = await prev('pd-pv-over');
    eq(o.map((x) => x[0]), ['CONFIDENTIAL']); ok(/rotate\(-45 /.test(o[0][1]), o[0][1]); eq(o[0][2], '0.3');
    await p.fill('#dialog [data-k="text"]', 'DRAFT'); await p.fill('#dialog [data-k="rotation"]', '0'); await p.fill('#dialog [data-k="size"]', '20');
    await p.$eval('#dialog [data-k="opacity"]', (e) => { e.value = 80; e.dispatchEvent(new Event('input', { bubbles: true })); });
    o = await prev('pd-pv-over');
    eq(o.map((x) => [x[0], x[1], x[2], x[3]]), [['DRAFT', '', '0.8', '20']], 'follows text, rotation, opacity and size');
    await p.selectOption('#dialog [data-k="layout"]', 'tile'); await p.selectOption('#dialog [data-k="front"]', 'behind');
    ok((await prev('pd-pv-under')).length > 4 && !(await prev('pd-pv-over')).length, 'tiled behind');
    await p.fill('#dialog [data-k="range"]', '3');
    await p.waitForFunction(() => document.querySelector('#dialog .pd-prev figcaption').textContent === 'Page 3 of 3');
    const bd = await p.$eval('#dialog', (d) => { const s = getComputedStyle(d, '::backdrop'); return [s.backdropFilter, s.backgroundColor]; });
    eq(bd[0], 'none', 'no blur'); ok(+bd[1].match(/[\d.]+\)$/)[0].slice(0, -1) <= .2, 'a light dim: ' + bd[1]);
    await p.click('#dialog .dlg-foot button:has-text("Cancel")'); await p.waitForTimeout(200);
    eq(await items(p), [], 'the preview adds nothing');
    ok(!(await p.$eval('#dialog', (d) => d.classList.contains('pd-dialog'))), 'other dialogs keep their own look');
    // header & footer: tokens filled in; background: a fill behind
    await run(p, 'pd_headfoot'); await p.waitForSelector('#dialog[open] .pd-form');
    await p.fill('#dialog [data-k="tl"]', 'Acme <<pages>>');
    await p.waitForFunction(() => [...document.querySelectorAll('#dialog .pd-prev svg.pd-pv-over text')].some((t) => t.textContent === 'Page 1 of 3'));
    eq((await prev('pd-pv-over')).map((x) => x[0]).sort(), ['Acme 3', 'Page 1 of 3']);
    await p.click('#dialog [data-x]'); await p.waitForTimeout(150);
    await run(p, 'pd_background'); await p.waitForSelector('#dialog[open] .pd-form');
    await p.waitForFunction(() => document.querySelector('#dialog .pd-prev svg.pd-pv-under rect'));
    eq(await p.$eval('#dialog .pd-prev svg.pd-pv-under rect', (r) => r.getAttribute('fill').toLowerCase()), '#fff3bf');
    await p.click('#dialog [data-x]'); await p.waitForTimeout(150);
    eq(p.errors, []); await p.ctx.close();
  });

  await h.test('page design: on a phone the dialogs are one column, with the preview on top, and no choice is cut off', async () => {
    for (const theme of ['dark', 'light']) {
      const ph = await open({ width: 390, height: 844, touch: true }); await openPdf(ph);
      await ph.evaluate((t) => window.__cowdreyPdf.run('theme_' + t), theme);
      for (const id of ['pd_watermark', 'pd_background', 'pd_headfoot', 'pd_bates']) {
        await run(ph, id); await ph.waitForSelector('#dialog[open] .pd-form');
        await ph.waitForFunction(() => { const c = document.querySelector('#dialog .pd-prev canvas'); return c && c.width > 100; });
        const r = await ph.evaluate(() => {
          const g = document.createElement('canvas').getContext('2d'), bad = [];
          for (const el of document.querySelectorAll('#dialog .pd-form select, #dialog .pd-form input[type="text"], #dialog .pd-form input[type="number"]')) {
            if (!el.offsetParent) continue;
            const cs = getComputedStyle(el); g.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
            const text = el.tagName === 'SELECT' ? el.options[el.selectedIndex].text : el.value || el.placeholder;
            const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - (el.tagName === 'SELECT' ? 20 : 0);
            if (g.measureText(text).width > room) bad.push(text);
          }
          const cols = [...document.querySelectorAll('#dialog .pd-form')].filter((f) => f.offsetParent).map((f) => getComputedStyle(f).gridTemplateColumns.split(' ').length);
          const pv = document.querySelector('#dialog .pd-prev').getBoundingClientRect(), form = document.querySelector('#dialog .pd-main').getBoundingClientRect();
          return { bad, cols: [...new Set(cols)], above: pv.bottom <= form.top + 1, fits: document.querySelector('#dialog').getBoundingClientRect().right <= innerWidth, sideways: document.querySelector('#dialog .dlg-body').scrollWidth > document.querySelector('#dialog .dlg-body').clientWidth };
        });
        eq(r, { bad: [], cols: [1], above: true, fits: true, sideways: false }, id);
        await ph.screenshot({ path: `/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr2/fix-pagedesign/phone-${theme}-${id}.png` });
        await ph.click('#dialog [data-x]'); await ph.waitForTimeout(150);
      }
      eq(ph.errors, []); await ph.ctx.close();
    }
  });

  await h.test('page design: applying redactions never cuts letters out of a watermark, header or Bates number added here', async () => {
    // A page with a word right under the middle of the watermark, which is turned 45°.
    const src = await L.PDFDocument.create(), f = await src.embedFont(L.StandardFonts.Helvetica);
    for (let k = 0; k < 3; k++) { const pg = src.addPage([612, 792]); pg.drawText(`Quarterly report, page ${k + 1}`, { x: 72, y: 700, size: 20, font: f }); pg.drawText('Account pelican 4471 is closed.', { x: 230, y: 400, size: 12, font: f }); }
    const file = path.join(root, 'tests/fixtures/.pd-redact.pdf'); fs.writeFileSync(file, await src.save());
    const p = await open(); await openPdf(p, file, 'Redact.pdf'); fs.unlinkSync(file);
    await add(p, 'pd_watermark', {});
    await add(p, 'pd_watermark', { text: 'CONFIDENTIAL', size: 40 }, { layout: 'tile' });
    await add(p, 'pd_headfoot', { tl: 'Pelican header' });
    await add(p, 'pd_bates', { prefix: 'CASE-' });
    // the watermark's pieces of text, as pdf.js reads them (tiles at the page edges can come in parts)
    const count = (t) => t.map((x) => x.filter((s) => /^[CONFIDETAL]+$/.test(s)).sort());
    const before = count(await texts(await savedOf(p)));
    ok(before.every((x) => x.filter((s) => s === 'CONFIDENTIAL').length > 4), 'tiled: ' + before);
    await p.click('[data-rt="protect"]');
    await p.click('[data-cmd="protRedSearch"]'); await p.fill('#dialog input[name=text]', 'pelican'); await p.click('#dialog .dlg-foot button:has-text("Find")'); await p.click('#dialog[open] .dlg-foot button:has-text("Mark")'); await p.waitForTimeout(300);
    // and a box over the middle of page 1, where the watermark crosses it
    await p.click('[data-cmd="protRedArea"]');
    const [a, b] = await h.at(p, 250, 450), [c, d] = await h.at(p, 360, 350);
    await p.mouse.move(a, b); await p.mouse.down(); await p.mouse.move(c, d, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(150);
    await p.click('[data-cmd="protRedApply"]'); await p.click('#dialog .dlg-foot button:has-text("Apply")'); await p.waitForTimeout(500);
    eq(await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().filter((m) => m.type === 'redact' && m.applied).length), 4, 'three matches and the box');
    const out = await savedOf(p), t = await texts(out);
    ok(t.every((x) => !/pelican/i.test(x.filter((s) => s !== 'Pelican header').join(' ')) && x.join(' ').includes('closed')), 'redacted: ' + JSON.stringify(t));
    eq(count(t), before, 'every letter of the watermark kept');
    for (let k = 0; k < 3; k++) ok(t[k].includes('Pelican header') && t[k].includes(`Page ${k + 1} of 3`) && t[k].includes(`CASE-${String(k + 1).padStart(6, '0')}`), `page ${k + 1}: ${JSON.stringify(t[k])}`);
    eq(p.errors.filter((e) => !/annotation-comment/.test(e)), []); await p.ctx.close();
  });

  await h.test('page design: on a PDF with a password, a watermark added earlier can be changed or removed after reopening', async () => {
    const C = require(path.join(root, 'desktop/node_modules/@cantoo/pdf-lib'));
    const p = await open(); await openProtected(p, fs.readFileSync(path.join(root, 'tests/fixtures/protected.pdf')));
    await add(p, 'pd_watermark', { text: 'SECRET' });
    const build = () => p.evaluate(async () => { const b = await window.__cowdreyPdf.buildPdf(); return b && Array.from(b); });
    let out = build(); await p.waitForSelector('#dialog[open]'); await p.click('#dialog .dlg-foot button:has-text("Keep password")');
    const kept = Buffer.from(await out);
    await openProtected(p, kept); await p.evaluate(() => window.__cowdreyPdf.pdOpening()); await p.waitForTimeout(300);
    eq((await items(p)).map((m) => m.text), ['SECRET'], 'read back with the password');
    ok(!(await pageText(p)).includes('SECRET'), 'taken out of the page');
    eq(await overlay(p, 0), ['SECRET'], 'drawn once, from its settings');
    await run(p, 'pd_watermark'); await p.waitForSelector('#dialog[open] .pd-form');
    eq(await title(p), 'Edit watermark');
    await p.click('#dialog .dlg-foot button:has-text("Remove")'); await p.waitForTimeout(300);
    out = build(); await p.waitForSelector('#dialog[open]'); await p.click('#dialog .dlg-foot button:has-text("Keep password")');
    const again = Buffer.from(await out);
    await L.PDFDocument.load(again).then(() => { throw new Error('opened without the password'); }, () => {});
    eq((await C.PDFDocument.load(again, { password: 'pelican' })).getPageCount(), 3, 'still protected');
    const d = await pdfjs.getDocument({ data: new Uint8Array(again), password: 'pelican', verbosity: 0 }).promise;
    const t = (await (await d.getPage(1)).getTextContent()).items.map((x) => x.str).join(' '); await d.loadingTask.destroy();
    ok(!t.includes('SECRET') && t.includes('Quarterly report, page 1'), t);
    eq(p.errors, []); await p.ctx.close();
  });

  await h.test('icons: each command on the ribbon has its own icon where the meaning differs', async () => {
    const p = await open();
    const ids = ['pd_watermark', 'pd_background', 'pd_headfoot', 'pd_bates', 'pd_manage', 'cm_stamp', 'cm_fill', 'cm_area', 'ffFlatten', 'ffRecognize', 'protFlatten', 'protRedApply', 'tool_erase', 'ocr', 'docProps', 'exportText', 'pg60_crop', 'zoom100', 'about'];
    const icons = await p.evaluate((l) => l.map((id) => window.__cowdreyPdf.cmdIcon(id)), ids);
    ok(icons.every(Boolean), JSON.stringify(Object.fromEntries(ids.map((id, k) => [id, icons[k]]))));
    eq(new Set(icons).size, icons.length, 'distinct: ' + JSON.stringify(Object.fromEntries(ids.map((id, k) => [id, icons[k]]))));
    const known = await p.evaluate((l) => l.filter((n) => !window.lucide.icons[n.replace(/(^|-)([a-z0-9])/g, (_, a, b) => b.toUpperCase())]), icons);
    eq(known, [], 'every icon is in Lucide');
    await p.ctx.close();
  });
};
