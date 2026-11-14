// View: the Hand tool and Space to pan, Fit page and Actual size (Ctrl+0, 1, 2), page layouts (two pages, with a
// cover, single page), the Attachments panel, and page labels.
export default async (h) => {
  const { test, eq, ok, open, openPdf, reopen, savedOf, PDFDocument, require, fs, path } = h;
  const L = require('../desktop/node_modules/pdf-lib');
  const GUIDE = '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/guide/';
  // A PDF of n pages, each saying "Page k"; `fix(d)` changes it before it is saved.
  const longPdf = async (n, fix) => {
    const d = await PDFDocument.create(), f = await d.embedFont(L.StandardFonts.Helvetica);
    for (let k = 1; k <= n; k++) { const pg = d.addPage([612, 792]); pg.drawText(`Page ${k} of the test`, { x: 72, y: 700, size: 24, font: f }); }
    if (fix) await fix(d);
    return Buffer.from(await d.save());
  };
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id).then(() => p.waitForTimeout(400));
  const tops = (p) => p.$$eval('#pages .page', (els) => els.map((e) => [Math.round(e.getBoundingClientRect().top), Math.round(e.getBoundingClientRect().left), getComputedStyle(e).display !== 'none']));
  const scrollOf = (p) => p.$eval('#viewer', (v) => [v.scrollLeft, v.scrollTop]);

  await test('view: the Hand tool (H) drags the pages around without selecting text or drawing', async () => {
    const p = await open({ init: () => localStorage.setItem('cowdrey.pdf:settings', JSON.stringify({ zoom: 250 })) });
    await reopen(p, await longPdf(4));
    await p.focus('#viewer'); await p.keyboard.press('h');
    eq(await p.evaluate(() => document.querySelector('#app').dataset.tool), 'hand');
    ok(/grab/.test(await p.$eval('.page[data-n="0"] .textLayer span', (s) => getComputedStyle(s).cursor)), 'grab cursor over text');
    await p.evaluate(() => { const v = document.querySelector('#viewer'); v.scrollTop = 300; v.scrollLeft = 200; });
    // from the middle of the window, over the page
    const [l0, t0] = await scrollOf(p), v = await p.locator('#viewer').boundingBox(), cx = v.x + v.width / 2, cy = v.y + v.height / 2;
    eq(await p.evaluate(([x, y]) => !!document.elementFromPoint(x, y).closest('.page'), [cx, cy]), true, 'over the page');
    await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx - 100, cy - 150, { steps: 6 }); await p.mouse.up();
    const [l1, t1] = await scrollOf(p);
    ok(Math.abs(l1 - l0 - 100) < 3 && Math.abs(t1 - t0 - 150) < 3, `panned ${l0},${t0} -> ${l1},${t1}`);
    eq(await p.evaluate(() => String(getSelection())), '', 'nothing selected');
    eq(await h.marks(p), [], 'nothing drawn');
    await p.keyboard.press('Escape');
    eq(await p.evaluate(() => document.querySelector('#app').dataset.tool), 'select');
    // On the ribbon (Home > View) and in the View menu
    ok(await p.$('#ribbonBody [data-cmd="tool_hand"]'), 'Hand on Home'); eq(p.errors, []); await p.ctx.close();
  });

  await test('view: Space held down pans with any tool (Pen draws nothing); a tap of Space still scrolls a screen', async () => {
    const p = await open({ init: () => localStorage.setItem('cowdrey.pdf:settings', JSON.stringify({ zoom: 200 })) });
    await reopen(p, await longPdf(4));
    await run(p, 'tool_pen');
    await p.focus('#viewer');
    const t0 = (await scrollOf(p))[1];
    const g = await p.locator('.page[data-n="0"]').boundingBox();
    await p.keyboard.down(' ');
    ok(await p.evaluate(() => document.querySelector('#app').classList.contains('vw-space')), 'grab while Space is down');
    await p.mouse.move(g.x + 200, g.y + 500); await p.mouse.down(); await p.mouse.move(g.x + 200, g.y + 300, { steps: 6 }); await p.mouse.up();
    await p.keyboard.up(' ');
    const t1 = (await scrollOf(p))[1];
    ok(Math.abs(t1 - t0 - 200) < 3, `panned ${t0} -> ${t1}`);
    eq(await h.marks(p), [], 'the pen drew nothing');
    eq(await p.evaluate(() => document.querySelector('#app').dataset.tool), 'pen', 'the tool stays');
    await p.keyboard.press(' '); await p.waitForTimeout(700);
    const t2 = (await scrollOf(p))[1], vh = await p.$eval('#viewer', (v) => v.clientHeight);
    ok(t2 - t1 > vh * .7, `a tap scrolls a screen: ${t1} -> ${t2}`);
    // Space on a ribbon button presses it, as before
    await run(p, 'tool_select');
    await p.focus('#ribbonBody [data-cmd="darkPage"]'); await p.keyboard.press(' '); await p.waitForTimeout(200);
    eq(await p.evaluate(() => document.querySelector('#app').dataset.darkpage), 'on');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('view: Fit page (Ctrl+0), Actual size (Ctrl+1) and Fit width (Ctrl+2); each in the View menu', async () => {
    const p = await open(); await openPdf(p);
    await p.focus('#viewer');
    await p.keyboard.press('Control+0'); await p.waitForTimeout(500);
    ok(/^Fit page · \d+%$/.test(await p.textContent('#zoomLabel')), await p.textContent('#zoomLabel'));
    const [ph, vh] = await p.evaluate(() => [document.querySelector('.page').offsetHeight, document.querySelector('#viewer').clientHeight]);
    ok(ph <= vh && ph > vh - 60, `whole page in view: ${ph} of ${vh}`);
    await p.keyboard.press('Control+1'); await p.waitForTimeout(500);
    eq(await p.textContent('#zoomLabel'), '100%');
    eq(await p.$eval('.page', (e) => e.offsetWidth), 612, 'actual size');
    await p.keyboard.press('Control+2'); await p.waitForTimeout(500);
    ok(/^Fit · \d+%$/.test(await p.textContent('#zoomLabel')), 'fit width');
    // a window of another height: Fit page follows it
    await p.keyboard.press('Control+0'); await p.waitForTimeout(400);
    await p.setViewportSize({ width: 1440, height: 700 }); await p.waitForTimeout(800);
    const [ph2, vh2] = await p.evaluate(() => [document.querySelector('.page').offsetHeight, document.querySelector('#viewer').clientHeight]);
    ok(ph2 <= vh2 && ph2 > vh2 - 60, `follows the window: ${ph2} of ${vh2}`);
    // one shortcut each
    await run(p, 'shortcuts');
    const rows = await p.$eval('#dialog', (d) => d.textContent);
    ok(/Fit pageCtrl\+0/.test(rows) && /Actual sizeCtrl\+1/.test(rows) && /Fit widthCtrl\+2/.test(rows) && /HandH/.test(rows), rows);
    await p.keyboard.press('Escape');
    await p.click('#menubar button:has-text("View")');
    const items = await p.$$eval('#popover .mi', (b) => b.map((x) => x.children[1].textContent));
    for (const l of ['Fit width', 'Fit page', 'Actual size', 'Hand', 'Continuous', 'Single page', 'Two pages', 'Two pages with cover', 'Attachments']) ok(items.includes(l), l + ' in ' + items);
    eq(await p.$$eval('#popover [role="group"][aria-label="Page layout"] [role="menuitemradio"]', (b) => b.map((x) => x.getAttribute('aria-checked'))), ['true', 'false', 'false', 'false']);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('view: Two pages side by side; thumbnails, find, marks and the page box still work', async () => {
    const p = await open(); await reopen(p, await longPdf(5));
    await run(p, 'vw_lay_two');
    let t = await tops(p);
    ok(t[0][0] === t[1][0] && t[1][1] > t[0][1] && t[2][0] > t[0][0] && t[2][0] === t[3][0], 'pairs: ' + JSON.stringify(t));
    const [w0, vw] = await p.evaluate(() => [document.querySelector('.page').offsetWidth, document.querySelector('#viewer').clientWidth]);
    ok(2 * w0 < vw, 'fit width fits both pages');
    eq(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    // a thumbnail goes to its page (the right one of a pair)
    await p.click('.thumb[data-n="3"]'); await p.waitForTimeout(700);
    eq(await p.inputValue('#pageJump'), '4'); eq(await p.evaluate(() => window.__cowdreyPdf.current), 3);
    // the page box
    await p.fill('#pageJump', '5'); await p.press('#pageJump', 'Enter'); await p.waitForTimeout(700);
    eq(await p.evaluate(() => window.__cowdreyPdf.current), 4);
    // find
    await p.keyboard.press('Control+f'); await p.fill('#findInput', 'Page 2 of'); await p.waitForTimeout(700);
    eq(await p.textContent('#findCount'), '1 of 1');
    ok(await p.$('.page[data-n="1"] .find-hit.now'), 'the match is marked on page 2');
    await p.keyboard.press('Escape');
    // a mark on the right-hand page belongs to it
    await p.click('[data-rt="markup"]'); await p.click('[data-cmd="tool_rect"]');
    const g = await p.locator('.page[data-n="1"]').boundingBox();
    await p.mouse.move(g.x + 60, g.y + 100); await p.mouse.down(); await p.mouse.move(g.x + 160, g.y + 180, { steps: 3 }); await p.mouse.up();
    eq(await p.evaluate(() => Object.entries(window.__cowdreyPdf.doc.marks).filter(([, l]) => l.length).map(([k, l]) => [k, l.map((m) => m.type)])), [['0:1', ['rect']]]);
    // with a cover, the first page is on its own (on the right), then pairs 2-3, 4-5
    await run(p, 'vw_lay_cover');
    t = await tops(p);
    ok(t[1][0] > t[0][0] && t[1][0] === t[2][0] && t[0][1] > t[1][1] && t[3][0] === t[4][0], 'cover: ' + JSON.stringify(t));
    // the layout is kept for next time
    eq(await p.evaluate(() => JSON.parse(localStorage.getItem('cowdrey.pdf:settings')).layout), 'two');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('view: Single page shows one page at a time; Page Down, the page box and a wheel at the end turn it', async () => {
    const p = await open(); await reopen(p, await longPdf(4));
    await run(p, 'vw_lay_single');
    const shown = async () => (await tops(p)).map(([, , s], n) => (s ? n : -1)).filter((n) => n >= 0);
    eq(await shown(), [0]);
    await p.focus('#viewer'); await p.keyboard.press('PageDown'); await p.waitForTimeout(400);
    eq(await shown(), [1]); eq(await p.inputValue('#pageJump'), '2');
    await p.fill('#pageJump', '4'); await p.press('#pageJump', 'Enter'); await p.waitForTimeout(400);
    eq(await shown(), [3]);
    await p.click('.thumb[data-n="0"]'); await p.waitForTimeout(400);
    eq(await shown(), [0]);
    // the wheel: down to the end of the page, then once more to turn it
    const g = await p.locator('.page[data-n="0"]').boundingBox();
    await p.mouse.move(g.x + 100, g.y + 100);
    for (let k = 0; k < 8; k++) { await p.mouse.wheel(0, 400); await p.waitForTimeout(120); }
    await p.waitForTimeout(500); await p.mouse.wheel(0, 200); await p.waitForTimeout(500);
    eq(await shown(), [1], 'turned to page 2');
    ok(await p.$('.page[data-n="1"] canvas.pdf'), 'page 2 drawn');
    // back to continuous: every page is there again
    await run(p, 'vw_lay_scroll');
    eq(await shown(), [0, 1, 2, 3]);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('view: Two pages on the 285-page guide: Fit page shows a whole pair; going to page 100 keeps working', async () => {
    const file = GUIDE + 'pe10-win.pdf'; if (!fs.existsSync(file)) return;
    const p = await open(); await openPdf(p, file, 'pe10-win.pdf');
    await run(p, 'vw_lay_two'); await run(p, 'zoomPage'); await p.waitForTimeout(600);
    const [a, b, vh] = await p.evaluate(() => { const e = document.querySelectorAll('#pages .page'); return [e[0].getBoundingClientRect(), e[1].getBoundingClientRect(), document.querySelector('#viewer').getBoundingClientRect()].map((r) => [r.top, r.bottom, r.left, r.right].map(Math.round)); });
    ok(a[0] === b[0] && b[2] > a[3] && a[1] - a[0] <= vh[1] - vh[0], 'pair in view: ' + JSON.stringify([a, b, vh]));
    await p.fill('#pageJump', '100'); await p.press('#pageJump', 'Enter'); await p.waitForTimeout(1500);
    eq(await p.evaluate(() => window.__cowdreyPdf.current), 99);
    ok(await p.waitForSelector('.page[data-n="99"] canvas.pdf', { timeout: 8000 }), 'page 100 drawn');
    eq(p.errors, []); await p.ctx.close();
  });

  // A PDF with an attached file and a file attachment comment on page 2.
  const attachedPdf = () => longPdf(3, async (d) => {
    await d.attach(Buffer.from('Hello from inside the PDF'), 'hello.txt', { mimeType: 'text/plain', description: 'A greeting' });
    const ctx = d.context, N = L.PDFName.of;
    const ef = ctx.register(ctx.flateStream(Buffer.from('a,b\n1,2\n'), { Type: 'EmbeddedFile', Subtype: N('text/csv') }));
    const fs2 = ctx.obj({ Type: 'Filespec', F: L.PDFString.of('numbers.csv'), UF: L.PDFHexString.fromText('numbers.csv'), EF: { F: ef } });
    const annot = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FileAttachment', Rect: [72, 600, 92, 620], FS: fs2, Contents: L.PDFString.of('The numbers'), Name: 'PushPin' }));
    d.getPage(1).node.set(N('Annots'), ctx.obj([annot]));
  });
  const fileRows = (p) => p.$$eval('#sidePanel .vw-file .vw-fname', (s) => s.map((x) => x.childNodes[0].textContent + ' | ' + x.querySelector('.m').textContent));

  await test('view: Attachments lists the files in a PDF (attached and on a page); Save gives each one back', async () => {
    const p = await open(); await reopen(p, await attachedPdf());
    await p.click('[data-side="files"]'); await p.waitForSelector('#sidePanel .vw-file');
    eq(await fileRows(p), ['hello.txt | 25 bytes · A greeting', 'numbers.csv | 8 bytes · On page 2 · The numbers']);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#sidePanel [aria-label="Save hello.txt"]')]);
    eq(dl.suggestedFilename(), 'hello.txt'); eq(fs.readFileSync(await dl.path(), 'utf8'), 'Hello from inside the PDF');
    const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('#sidePanel [aria-label="Save numbers.csv"]')]);
    eq(fs.readFileSync(await dl2.path(), 'utf8'), 'a,b\n1,2\n');
    // a PDF without any: says so, and offers to attach one
    await openPdf(p); await p.waitForTimeout(300);
    eq(await p.textContent('#sidePanel .empty-note'), 'This PDF has no attached files.');
    ok(await p.$('#sidePanel [data-cmd="vw_attach"]'), 'Attach file in the empty panel');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('view: Attach file adds a file that is kept in the saved PDF; undo takes it back', async () => {
    const p = await open(); await reopen(p, await attachedPdf());
    await p.click('[data-rt="markup"]'); ok(await p.$('#ribbonBody [data-cmd="vw_attach"]'), 'Comment > Add > Attach file');
    const chooser = p.waitForEvent('filechooser');
    await p.click('#ribbonBody [data-cmd="vw_attach"]');
    await (await chooser).setFiles([{ name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('Another hello') }, { name: 'plan.md', mimeType: 'text/markdown', buffer: Buffer.from('# Plan') }]);
    await p.waitForTimeout(800);
    eq(await p.evaluate(() => document.querySelector('[data-side="files"]').getAttribute('aria-selected')), 'true', 'the panel opens');
    eq((await fileRows(p)).slice(2), ['hello (2).txt | 13 bytes · Added, kept when you save', 'plan.md | 6 bytes · Added, kept when you save']);
    const out = await savedOf(p);
    const pdfjs = await import(path.join(h.root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
    const pd = await pdfjs.getDocument({ data: new Uint8Array(out) }).promise, att = await pd.getAttachments();
    const got = []; for (const [k, a] of att instanceof Map ? att : Object.entries(att)) got.push([a.filename, Buffer.from(a.content || await pd.getAttachmentContent(k)).toString()]);
    eq(got.sort(), [['hello (2).txt', 'Another hello'], ['hello.txt', 'Hello from inside the PDF'], ['plan.md', '# Plan']]);
    await p.focus('#viewer'); await p.keyboard.press('Control+z'); await p.waitForTimeout(400);
    eq((await fileRows(p)).length, 2, 'undo');
    await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(400);
    eq((await fileRows(p)).length, 4, 'redo');
    // kept after a reload, from this device
    await p.waitForTimeout(600); await p.reload(); await p.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 15000 }); await p.waitForTimeout(800);
    await p.click('[data-side="files"]'); await p.waitForSelector('#sidePanel [aria-label="Save plan.md"]');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#sidePanel [aria-label="Save plan.md"]')]);
    eq(fs.readFileSync(await dl.path(), 'utf8'), '# Plan');
    eq(p.errors, []); await p.ctx.close();
  });

  // Pages i, ii, iii, then 1, 2, 3.
  const labelledPdf = () => longPdf(6, (d) => {
    const ctx = d.context;
    d.catalog.set(L.PDFName.of('PageLabels'), ctx.obj({ Nums: [0, { S: 'r' }, 3, { S: 'D' }] }));
  });
  await test('view: page labels show in the page box and thumbnails, and the page box takes a label', async () => {
    const p = await open(); await reopen(p, await labelledPdf());
    const box = async () => [await p.inputValue('#pageJump'), await p.textContent('#pageOf'), await p.textContent('#pageCount'), await p.textContent('#pageEnd')].join('');
    eq(await box(), 'i(1 of 6)');
    eq(await p.$$eval('.thumb > span', (s) => s.map((x) => x.textContent)), ['i (1)', 'ii (2)', 'iii (3)', '1 (4)', '2 (5)', '3 (6)']);
    eq(await p.getAttribute('.thumb[data-n="2"]', 'aria-label'), 'Page iii (3 of 6)');
    await p.fill('#pageJump', 'III'); await p.press('#pageJump', 'Enter'); await p.waitForTimeout(700);
    eq(await box(), 'iii(3 of 6)');
    await p.fill('#pageJump', '2'); await p.press('#pageJump', 'Enter'); await p.waitForTimeout(700);
    eq(await box(), '2(5 of 6)', 'a label first');
    await p.fill('#pageJump', '6'); await p.press('#pageJump', 'Enter'); await p.waitForTimeout(700);
    eq(await box(), '3(6 of 6)', 'else a page number');
    // a PDF without labels: as before
    await openPdf(p);
    eq(await box(), '1of 3'); eq(await p.$$eval('.thumb > span', (s) => s.map((x) => x.textContent)), ['1', '2', '3']);
    eq(p.errors, []); await p.ctx.close();
  });
};
