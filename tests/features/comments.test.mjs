// Comment tab: text mark-up, shapes, callouts, typewriter, stamps, and the Comments panel.
export default async (h) => {
  const { test, eq, ok, open, openPdf, savedOf, reopen, at, marks, selectText, PDFDocument, require, path, root, WORD } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const N = (s) => L.PDFName.of(s);
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
  const drag = async (p, [x1, y1], [x2, y2]) => { const a = await at(p, x1, y1), b = await at(p, x2, y2); await p.mouse.move(...a); await p.mouse.down(); await p.mouse.move(...b, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(80); };
  const click = async (p, x, y) => { await p.mouse.click(...(await at(p, x, y))); await p.waitForTimeout(80); };
  const typeIn = async (p, text) => { await p.waitForSelector('.page-ask textarea'); await p.fill('.page-ask textarea', text); await p.click('.page-ask .btn.primary'); await p.waitForTimeout(150); }; // typed on the page
  const annotsOf = (d, n = 0) => { const a = d.getPage(n).node.Annots(); return a ? a.asArray().map((r) => d.context.lookup(r)).filter((x) => String(x.get(N('Subtype'))) !== '/Widget') : []; }; // comments, not form fields
  const sub = (a) => String(a.get(N('Subtype'))).slice(1);
  // dark pixels in a box given in screen pixels relative to page 1's corner
  const ink = (p, x0, y0, x1, y1) => p.evaluate(([x0, y0, x1, y1]) => {
    const v = window.__cowdreyPdf.views()[0], c = v.el.querySelector('canvas.pdf'), k = c.width / v.viewport.width;
    const d = c.getContext('2d').getImageData(Math.round(x0 * k), Math.round(y0 * k), Math.max(1, Math.round((x1 - x0) * k)), Math.max(1, Math.round((y1 - y0) * k))).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 300) n++; return n;
  }, [x0, y0, x1, y1]);

  await h.test('comments: every Comment-tab tool makes a real PDF annotation with its own look, shown again on reopening', async () => {
    const p = await open({ height: 1500 }); await openPdf(p);
    await p.click('[data-rt="markup"]');
    for (const id of ['cm_underline', 'cm_strike', 'cm_squiggly', 'cm_area', 'cm_oval', 'cm_line', 'cm_arrow', 'cm_polygon', 'cm_polyline', 'cm_cloud', 'cm_callout', 'cm_typewriter', 'cm_stamp', 'cm_width', 'cm_fill', 'cm_list']) ok(await p.$(`#ribbonBody [data-cmd="${id}"]`), 'on the Comment tab: ' + id);
    // text mark-up from a selection
    await p.click('[data-cmd="cm_underline"]'); await selectText(p, 0, 'Cowdrey.PDF opens', .4); await p.waitForTimeout(150);
    await p.click('[data-cmd="cm_strike"]'); await selectText(p, 0, 'The pelican count', .6); await p.waitForTimeout(150);
    await p.click('[data-cmd="cm_squiggly"]'); await selectText(p, 0, 'Quarterly report', .9); await p.waitForTimeout(150);
    // shapes
    await p.click('[data-cmd="cm_area"]'); await drag(p, [60, 520], [200, 490]);
    await p.click('[data-cmd="cm_fill"]');
    await p.click('[data-cmd="cm_oval"]'); await drag(p, [60, 470], [180, 400]);
    await p.click('[data-cmd="cm_cloud"]'); await p.click('[data-cmd="cm_fill"]'); // (the oval just drawn is no longer selected)
    await drag(p, [220, 470], [360, 400]);
    await p.click('[data-cmd="cm_line"]'); await drag(p, [400, 470], [540, 470]);
    await p.click('[data-cmd="cm_arrow"]'); await drag(p, [400, 440], [540, 400]);
    await p.click('[data-cmd="cm_polygon"]'); await click(p, 60, 360); await click(p, 160, 360); await p.mouse.dblclick(...(await at(p, 110, 300))); await p.waitForTimeout(100);
    await p.click('[data-cmd="cm_polyline"]'); await click(p, 220, 360); await click(p, 280, 300); await p.mouse.dblclick(...(await at(p, 340, 360))); await p.waitForTimeout(100);
    // callout: press at the point, drag to where the text goes
    await p.click('[data-cmd="cm_callout"]'); await drag(p, [420, 330], [470, 260]); await typeIn(p, 'Check this figure');
    await p.click('[data-cmd="cm_typewriter"]'); await click(p, 60, 250); await typeIn(p, 'Typed note');
    // stamps: a ready-made one and a custom one
    await p.click('[data-cmd="cm_stamp"]'); await p.waitForSelector('#dialog[open] [data-stamp="approved"]');
    eq(await p.$$eval('#dialog [data-stamp]', (b) => b.length), 8, 'eight stamps');
    await p.click('#dialog [data-stamp="approved"]'); await p.waitForTimeout(100); await click(p, 150, 150);
    await p.click('[data-cmd="cm_stamp"]'); await p.waitForSelector('#dialog[open] #cmStampText'); await p.fill('#cmStampText', 'Paid'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(100); await click(p, 400, 150);
    const ms = await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().map((m) => m.type + (m.kind ? ':' + m.kind : '') + (m.fill ? '+fill' : '')));
    eq(ms, ['cmMarkup:underline', 'cmMarkup:strike', 'cmMarkup:squiggly', 'hl', 'cmShape:oval+fill', 'cmShape:cloud', 'cmShape:line', 'cmShape:arrow', 'cmShape:polygon', 'cmShape:polyline', 'cmCallout', 'cmType', 'cmStamp', 'cmStamp']);
    const all = await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat());
    eq(all[0].text.startsWith('Cowdrey'), true, 'underline keeps its words: ' + all[0].text);
    eq(all[8].pts.length, 3, 'polygon corners'); eq(all[9].pts.length, 3, 'polyline points');
    eq(all.slice(12).map((m) => [m.label, m.color]), [['Approved', '#2B8A3E'], ['Paid', '#2448C9']]);
    eq(await p.$$eval('.page[data-n="0"] svg.marks .mk', (g) => g.length), 14, 'all drawn on the page');
    // undo and redo
    await p.keyboard.press('Control+z'); eq((await marks(p)).length, 13, 'undo');
    await p.keyboard.press('Control+Shift+z'); eq((await marks(p)).length, 14, 'redo');
    // saved as annotations, each with its own appearance
    const out = await savedOf(p), d = await PDFDocument.load(out), an = annotsOf(d);
    eq(an.map(sub), ['Underline', 'StrikeOut', 'Squiggly', 'Highlight', 'Circle', 'Square', 'Line', 'Line', 'Polygon', 'PolyLine', 'FreeText', 'FreeText', 'Stamp', 'Stamp']);
    ok(an.every((a) => a.lookup(N('AP')) && a.lookup(N('AP')).get(N('N'))), 'every comment has an appearance');
    eq(an[0].lookup(N('QuadPoints')).size() % 8, 0, 'quad points');
    ok(an[0].lookup(N('Contents')).decodeText().startsWith('Cowdrey'), 'underlined words are the comment');
    ok(an[4].lookup(N('IC')), 'oval filled'); ok(!an[5].lookup(N('IC')), 'cloud not filled');
    eq(String(an[5].lookup(N('BE')).get(N('S'))), '/C', 'cloudy border');
    eq(an[7].lookup(N('LE')).asArray().map(String), ['/None', '/OpenArrow'], 'arrow end');
    eq(an[8].lookup(N('Vertices')).size(), 6, 'polygon vertices');
    eq([String(an[10].get(N('IT'))), String(an[11].get(N('IT')))], ['/FreeTextCallout', '/FreeTextTypeWriter']);
    eq(an[10].lookup(N('CL')).size(), 4, 'callout leader line'); eq(an[10].lookup(N('Contents')).decodeText(), 'Check this figure');
    eq([String(an[12].get(N('Name'))), an[13].lookup(N('Contents')).decodeText()], ['/Approved', 'Paid']);
    // reopened: pdf.js finds and draws them
    await reopen(p, out);
    const got = await p.evaluate(async () => (await window.__cowdreyPdf.views()[0].page.getAnnotations()).filter((a) => a.subtype !== 'Widget').map((a) => [a.subtype, a.hasAppearance !== false]));
    eq(got.map((g) => g[0]), ['Underline', 'StrikeOut', 'Squiggly', 'Highlight', 'Circle', 'Square', 'Line', 'Line', 'Polygon', 'PolyLine', 'FreeText', 'FreeText', 'Stamp', 'Stamp']);
    const stamp = await p.evaluate(() => { const v = window.__cowdreyPdf.views()[0], c = v.el.querySelector('canvas.pdf'), k = c.width / v.viewport.width; const [x, y] = v.viewport.convertToViewportPoint(150 - 40, 150); let g = 0; for (let dx = 0; dx < 80; dx += 2) { const d = c.getContext('2d').getImageData(Math.round((x + dx) * k), Math.round(y * k) - 3, 1, 6).data; for (let i = 0; i < d.length; i += 4) if (d[i + 1] > d[i] + 40 && d[i + 1] > d[i + 2] + 20) g++; } return g; });
    ok(stamp > 3, 'the green Approved stamp is drawn on the reopened page: ' + stamp);
    eq(p.errors, []); await p.ctx.close();
  });

  await h.test('comments: the Comments panel lists every comment, goes to it, and deletes it (the PDF\'s own too)', async () => {
    const p = await open({ height: 1500 }); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.click('[data-rt="markup"]');
    await p.click('[data-cmd="cm_stamp"]'); await p.waitForSelector('#dialog[open] [data-stamp="received"]'); await p.click('#dialog [data-stamp="received"]'); await p.waitForTimeout(100);
    await click(p, 300, 120);
    await p.click('[data-cmd="cm_list"]'); await p.waitForSelector('#sidePanel .cm-item');
    eq(await p.$eval('.side-tabs [data-side="comments"]', (b) => b.getAttribute('aria-selected')), 'true');
    const items = await p.evaluate(() => window.__cowdreyPdf.cmItems());
    eq(items.map((i) => [i[0], i[1], i[3]]).sort(), [['Note', 1, false], ['Rectangle', 1, false], ['Stamp', 1, true]].sort(), JSON.stringify(items));
    ok(items.find((i) => i[0] === 'Stamp')[2].startsWith('Received · '), 'received stamp has the date');
    ok(items.find((i) => i[0] === 'Note')[2].includes('budget'), 'the PDF\'s own note text');
    eq(await p.$$eval('#sidePanel .cm-item', (l) => l.length), 3);
    // click the stamp: it is selected
    const k = items.findIndex((i) => i[0] === 'Stamp');
    await p.click(`#sidePanel [data-cm-go="${k}"]`); await p.waitForTimeout(150);
    eq(await p.$$eval('.page[data-n="0"] svg.marks .mk.sel', (g) => g.length), 1, 'selected on the page');
    // delete the PDF's own note from the panel
    const kn = items.findIndex((i) => i[0] === 'Note');
    await p.click(`#sidePanel [data-cm-del="${kn}"]`); await p.waitForTimeout(500);
    eq(await p.$$eval('#sidePanel .cm-item', (l) => l.length), 2, 'note gone from the list');
    await p.keyboard.press('Control+z'); await p.waitForTimeout(500);
    eq(await p.$$eval('#sidePanel .cm-item', (l) => l.length), 3, 'undo brings it back');
    await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(500);
    const d = await PDFDocument.load(await savedOf(p));
    eq(annotsOf(d).map(sub).sort(), ['Square', 'Stamp'], 'saved without the note, with the stamp');
    // deleting our own comment from the panel
    const it2 = await p.evaluate(() => window.__cowdreyPdf.cmItems()); const ks = it2.findIndex((i) => i[0] === 'Stamp');
    await p.click(`#sidePanel [data-cm-del="${ks}"]`); await p.waitForTimeout(400);
    eq(await marks(p), ['ae'], 'stamp mark removed');
    eq(p.errors, []); await p.ctx.close();
  });

  await h.test('comments: no name question; one toast says where to set it; the panel sets the author, filters by type and author and sorts by date', async () => {
    const p = await open({ height: 1500, askName: true }); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.click('[data-rt="markup"]');
    await p.click('[data-cmd="cm_oval"]'); await drag(p, [60, 470], [180, 400]);
    ok(!(await p.$('#dialog[open]')), 'no dialog while drawing');
    eq(await p.textContent('#toast'), 'Your comments show as "No name". Set your name in the Comments panel.');
    await p.evaluate(() => { document.querySelector('#toast').textContent = ''; });
    await p.click('[data-cmd="cm_cloud"]'); await drag(p, [220, 470], [360, 400]); await p.waitForTimeout(150);
    eq(await p.textContent('#toast'), '', 'told only once');
    await p.click('[data-cmd="cm_list"]'); await p.waitForSelector('#sidePanel .cm-item');
    ok((await p.textContent('#sidePanel .cm-you')).includes('Your name: No name'), 'no name yet');
    await p.click('#sidePanel [data-cm-name]'); await p.waitForSelector('#dialog[open] #dlgInput');
    eq(await p.textContent('#dialog h2'), 'Your name');
    await p.fill('#dlgInput', 'Ada Lovelace'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(300);
    ok((await p.textContent('#sidePanel .cm-you')).includes('Ada Lovelace'), 'your name shown in the panel');
    const bys = await p.$$eval('#sidePanel .cm-by', (e) => e.map((x) => x.textContent));
    ok(bys.filter((b) => b.startsWith('Ada Lovelace · ')).length === 2 && bys.filter((b) => b === 'Reviewer').length === 2, 'author and date: ' + JSON.stringify(bys));
    // filter by author, then by type
    await p.selectOption('#sidePanel [data-cm-f="by"]', 'Reviewer'); await p.waitForTimeout(200);
    eq(await p.$$eval('#sidePanel .cm-top b', (e) => e.map((x) => x.textContent).sort()), ['Note', 'Rectangle']);
    eq(await p.textContent('#sidePanel .cm-head'), '2 of 4 comments');
    await p.selectOption('#sidePanel [data-cm-f="by"]', '*everyone*'); await p.selectOption('#sidePanel [data-cm-f="type"]', 'Cloud'); await p.waitForTimeout(200);
    eq(await p.$$eval('#sidePanel .cm-top b', (e) => e.map((x) => x.textContent)), ['Cloud']);
    await p.selectOption('#sidePanel [data-cm-f="type"]', ''); await p.waitForTimeout(200);
    // newest first: the cloud, then the oval, then the PDF's own (no date)
    await p.selectOption('#sidePanel [data-cm-f="sort"]', 'new'); await p.waitForTimeout(200);
    eq((await p.$$eval('#sidePanel .cm-top b', (e) => e.map((x) => x.textContent))).slice(0, 2), ['Cloud', 'Oval']);
    // change the name: new comments use it, the earlier ones keep theirs
    await p.click('#sidePanel [data-cm-name]'); await p.waitForSelector('#dialog[open] #dlgInput');
    await p.fill('#dlgInput', 'A. Lovelace'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(150);
    await p.click('[data-cmd="cm_line"]'); await drag(p, [400, 470], [540, 470]);
    await run(p, 'tool_note'); await click(p, 500, 300); await typeIn(p, 'A note');
    const d = await PDFDocument.load(await savedOf(p));
    const who = annotsOf(d).map((a) => [sub(a), a.lookup(N('T')) ? a.lookup(N('T')).decodeText() : null]).sort();
    eq(who, [['Circle', 'Ada Lovelace'], ['Line', 'A. Lovelace'], ['Square', 'Ada Lovelace'], ['Square', 'Reviewer'], ['Text', 'A. Lovelace'], ['Text', 'Reviewer']].sort(), JSON.stringify(who));
    ok(!JSON.stringify(who).includes('Cowdrey.PDF'), 'never the app name');
    eq(p.errors, []); await p.ctx.close();
    // Never set: comments have no author written
    const q = await open({ height: 1500, askName: true }); await openPdf(q);
    await q.click('[data-rt="markup"]'); await q.click('[data-cmd="cm_oval"]'); await drag(q, [60, 470], [180, 400]);
    await q.click('[data-cmd="cm_cloud"]'); await drag(q, [220, 470], [360, 400]); await q.waitForTimeout(150);
    ok(!(await q.$('#dialog[open]')), 'never asked');
    const d2 = await PDFDocument.load(await savedOf(q));
    eq(annotsOf(d2).map((a) => a.has(N('T'))), [false, false], 'no author written');
    await q.ctx.close();
  });

  await h.test('comments: on a turned page, typewriter text and stamps stay upright, on screen and in the saved PDF', async () => {
    const p = await open({ height: 1500 }); await openPdf(p);
    await run(p, 'rotR'); await p.waitForTimeout(600);
    await p.click('[data-rt="markup"]');
    await p.click('[data-cmd="cm_typewriter"]'); await click(p, 300, 300); await typeIn(p, 'WWWWWWWW');
    const m = await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat()[0]);
    eq(m.rot, 90, 'turned with the page');
    const out = await savedOf(p), d = await PDFDocument.load(out), a = annotsOf(d)[0];
    const ap = d.context.lookup(a.lookup(N('AP')).get(N('N')));
    const raw = Buffer.from(ap.getContents()), text = (String(ap.dict.get(N('Filter'))) === '/FlateDecode' ? require('node:zlib').inflateSync(raw) : raw).toString('latin1');
    ok(/\n0 1 -1 0 [\d.]+ [\d.]+ Tm/.test(text), 'the appearance turns its text with the page: ' + text);
    await reopen(p, out);
    const [sx, sy] = await p.evaluate(() => { const v = window.__cowdreyPdf.views()[0]; return v.viewport.convertToViewportPoint(300, 300); });
    const s = await p.evaluate(() => window.__cowdreyPdf.views()[0].viewport.scale);
    const right = await ink(p, sx + 2, sy, sx + 70 * s, sy + 12 * s), below = await ink(p, sx, sy + 20 * s, sx + 12 * s, sy + 80 * s);
    ok(right > 30 && below === 0, `reads left to right on the turned page (right ${right}, below ${below})`);
    eq(p.errors, []); await p.ctx.close();
  });

  await h.test('comments: phone width: the Comment tab scrolls, the Comments panel opens, nothing scrolls sideways', async () => {
    const p = await open({ width: 390, height: 800, touch: true }); await openPdf(p);
    await p.click('[data-rt="markup"]');
    await run(p, 'cm_list'); await p.waitForTimeout(400);
    ok(await p.$eval('#app', (a) => a.dataset.sidebar === 'open'), 'sidebar open');
    ok(await p.$('#sidePanel .empty-note'), 'empty list note');
    eq(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll');
    const tabs = await p.$$eval('.side-tabs button', (b) => b.map((x) => x.scrollWidth <= x.clientWidth + 1));
    ok(tabs.every(Boolean), 'sidebar tab names fit: ' + tabs);
    await p.ctx.close();
  });

  await h.test('comments: the pressed swatch is the colour each tool draws; a swatch recolours the selected mark in one undo step; swatches are named', async () => {
    const p = await open({ height: 1500 }); await openPdf(p);
    await p.click('[data-rt="markup"]');
    const pressed = () => p.$$eval('#ribbonBody [data-color][aria-pressed="true"]', (b) => b.map((x) => x.getAttribute('aria-label')));
    const all = () => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().map((m) => [m.type, m.color]));
    eq(await p.$$eval('#ribbonBody [data-color]', (b) => b.map((x) => x.getAttribute('aria-label'))), ['Yellow', 'Green', 'Light blue', 'Pink', 'Red', 'Blue', 'Black']);
    await p.click('[data-cmd="tool_pen"]'); eq(await pressed(), ['Blue'], 'Draw shows its blue');
    await drag(p, [100, 500], [200, 540]);
    eq(await all(), [['ink', '#2448C9']], 'drawn in the pressed colour');
    eq(await p.$$eval('.page[data-n="0"] svg.marks .mk.sel', (g) => g.length), 1, 'the new stroke is selected');
    eq(await p.evaluate(() => document.querySelector('#app').dataset.tool), 'pen', 'Draw stays on');
    await p.click('#ribbonBody [data-color="#69DB7C"]'); await p.waitForTimeout(100);
    eq(await all(), [['ink', '#69DB7C']], 'the selected stroke turns green'); eq(await pressed(), ['Green']);
    await p.keyboard.press('Control+z'); eq(await all(), [['ink', '#2448C9']], 'one undo step');
    await p.click('[data-cmd="tool_pen"]'); eq(await pressed(), ['Green'], 'Draw keeps green for the next stroke');
    await drag(p, [100, 400], [200, 440]);
    await p.click('[data-cmd="cm_oval"]'); eq(await pressed(), ['Red'], 'shapes keep their own colour');
    await drag(p, [300, 400], [400, 460]);
    eq((await all()).map((m) => m[1]), ['#2448C9', '#69DB7C', '#E03131']);
    // with Select: the swatch shows and sets the selected mark's colour only
    await p.click('[data-cmd="tool_select"]'); await click(p, 100, 400);
    eq(await pressed(), ['Green'], 'the selected stroke is green');
    await p.click('#ribbonBody [data-color="#111111"]'); await p.waitForTimeout(100);
    eq((await all()).map((m) => m[1]), ['#2448C9', '#111111', '#E03131']);
    await p.click('[data-cmd="tool_pen"]'); eq(await pressed(), ['Green'], 'Draw is still green');
    eq(p.errors, []); await p.ctx.close();
  });

  await h.test('comments: a new shape, stroke, callout, typewriter text or stamp is selected after drawing, ready to restyle', async () => {
    const p = await open({ height: 1500 }); await openPdf(p);
    await p.click('[data-rt="markup"]');
    const sel = () => p.evaluate(() => { const ms = Object.values(window.__cowdreyPdf.doc.marks).flat(); const id = document.querySelector('.page[data-n="0"] svg.marks .mk.sel')?.dataset.id; const m = ms.find((x) => x.id === id); return m ? m.type + (m.kind ? ':' + m.kind : '') : null; });
    await p.click('[data-cmd="tool_rect"]'); await drag(p, [60, 470], [180, 400]); eq(await sel(), 'rect');
    await p.click('[data-cmd="cm_fill"]'); ok(await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat()[0].fill === true), 'Fill restyles the new rectangle');
    await p.click('[data-cmd="cm_arrow"]'); await drag(p, [220, 470], [360, 400]); eq(await sel(), 'cmShape:arrow');
    await p.click('[data-cmd="cm_polygon"]'); await click(p, 60, 360); await click(p, 160, 360); await p.mouse.dblclick(...(await at(p, 110, 300))); await p.waitForTimeout(100); eq(await sel(), 'cmShape:polygon');
    await p.click('[data-cmd="cm_callout"]'); await drag(p, [420, 330], [470, 260]); await typeIn(p, 'Look'); eq(await sel(), 'cmCallout');
    await p.click('[data-cmd="cm_typewriter"]'); await click(p, 60, 250); await typeIn(p, 'Typed'); eq(await sel(), 'cmType');
    await p.click('[data-cmd="cm_stamp"]'); await p.waitForSelector('#dialog[open] [data-stamp="draft"]'); await p.click('#dialog [data-stamp="draft"]'); await p.waitForTimeout(100); await click(p, 300, 150); eq(await sel(), 'cmStamp');
    await run(p, 'cm_w4'); eq(await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().pop().w), undefined, 'stamps have no line width');
    await p.click('[data-cmd="cm_line"]'); await drag(p, [400, 200], [540, 200]); await run(p, 'cm_w6');
    eq(await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().pop().w), 6, 'Width restyles the new line');
    eq(p.errors, []); await p.ctx.close();
  });

  await h.test('comments: the Comment tab fits 1440 and 1280 wide windows: Signature, Stamp and the Comments list in view', async () => {
    for (const width of [1440, 1280]) {
      const p = await open({ width }); await openPdf(p);
      await p.click('[data-rt="markup"]'); await p.waitForTimeout(150);
      const [sw, cw, right] = await p.$eval('#ribbonBody', (e) => [e.scrollWidth, e.clientWidth, e.getBoundingClientRect().right]);
      ok(sw <= cw, `${width}: no hidden groups (${sw}/${cw})`);
      for (const id of ['sign', 'cm_stamp', 'cm_list', 'tool_rect', 'cm_cloud', 'cm_area', 'cm_typewriter']) ok(await p.$eval(`#ribbonBody [data-cmd="${id}"]`, (b, r) => b.getBoundingClientRect().right <= r && b.getBoundingClientRect().width > 20, right), `${width}: ${id} in view`);
      eq(await p.$eval('#ribbonBody [data-cmd="cm_cloud"]', (b) => [b.title, b.textContent.trim()]), ['Cloud', 'Cloud'], 'icon buttons keep their names');
      await p.ctx.close();
    }
  });

  await h.test('comments: replies and a review status in the Comments panel are saved as replies (/IRT) and read back on reopening', async () => {
    const p = await open({ height: 1500 }); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.evaluate(() => window.__cowdreyPdf.setAuthor('Ada'));
    await p.click('[data-rt="markup"]');
    await p.click('[data-cmd="cm_oval"]'); await drag(p, [300, 500], [400, 560]);
    await p.click('[data-cmd="cm_list"]'); await p.waitForSelector('#sidePanel [data-cm-reply]');
    eq(await p.$$eval('#sidePanel [data-cm-reply]', (e) => e.length), 1, 'the new oval is open for a reply');
    await p.fill('#sidePanel [data-cm-reply]', 'Looks right'); await p.click('#sidePanel [data-cm-send]'); await p.waitForTimeout(400);
    await p.selectOption('#sidePanel [data-cm-status]', 'Rejected'); await p.waitForTimeout(300);
    await p.selectOption('#sidePanel [data-cm-status]', 'Accepted'); await p.waitForTimeout(300);
    eq(await p.$$eval('#sidePanel .cm-status', (e) => e.map((x) => x.textContent)), ['Accepted'], 'status shown in the list');
    // the PDF's own note: open it from the list and reply with Ctrl+Enter
    const kn = (await p.evaluate(() => window.__cowdreyPdf.cmItems())).findIndex((i) => i[0] === 'Note');
    await p.click(`#sidePanel [data-cm-go="${kn}"]`); await p.waitForTimeout(400);
    await p.fill('#sidePanel [data-cm-reply]', 'Budget checked'); await p.keyboard.press('Control+Enter'); await p.waitForTimeout(400);
    const want = [['Note', '', [['Ada', 'Budget checked']]], ['Rectangle', '', []], ['Oval', 'Accepted', [['Ada', 'Looks right']]]];
    eq(await p.evaluate(() => window.__cowdreyPdf.cmThreads()), want);
    await p.evaluate(() => document.activeElement.blur());
    await p.keyboard.press('Control+z'); await p.waitForTimeout(300);
    eq((await p.evaluate(() => window.__cowdreyPdf.cmThreads()))[0][2], [], 'undo takes the reply back');
    await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(300);
    const out = await savedOf(p), d = await PDFDocument.load(out), an = annotsOf(d);
    const reps = an.filter((a) => a.has(N('IRT')));
    eq(reps.length, 3, 'two replies and one status');
    const parentOf = (a) => d.context.lookup(a.get(N('IRT')));
    const text = (a, k) => a.lookup(N(k)) && a.lookup(N(k)).decodeText();
    eq(reps.map((a) => [sub(a), sub(parentOf(a)), text(a, 'T'), a.has(N('State')) ? [text(a, 'State'), text(a, 'StateModel')] : text(a, 'Contents')]).sort(),
      [['Text', 'Circle', 'Ada', 'Looks right'], ['Text', 'Circle', 'Ada', ['Accepted', 'Review']], ['Text', 'Text', 'Ada', 'Budget checked']].sort());
    await reopen(p, out); await p.waitForTimeout(400);
    eq(await p.evaluate(() => window.__cowdreyPdf.cmThreads()), want, 'read back from the file');
    eq(await p.$$eval('.page[data-n="0"] .annotationLayer section.textAnnotation', (s) => s.filter((x) => getComputedStyle(x).display !== 'none').length), 1, 'replies have no note icon of their own');
    await run(p, 'cm_list'); await p.waitForSelector('#sidePanel .cm-replies');
    eq(await p.$$eval('#sidePanel .cm-replies .cm-snip', (e) => e.map((x) => x.textContent)), ['Budget checked', 'Looks right']);
    eq(p.errors, []); await p.ctx.close();
  });

  await h.test('signature: Type and Picture besides Draw; the last three are kept; also on the Protect tab', async () => {
    const p = await open({ height: 1200 }); await openPdf(p);
    await p.click('[data-rt="protect"]'); ok(await p.$('#ribbonBody [data-cmd="sign"]'), 'Signature on the Protect tab');
    const sign = async () => { await p.click('#ribbonBody [data-cmd="sign"]'); await p.waitForSelector('#dialog[open] #sigPad'); };
    const kept = () => p.evaluate(() => JSON.parse(localStorage.getItem('cowdrey.pdf:signatures') || '[]').length);
    // typed
    await sign(); await p.click('#dialog [data-sig-mode="type"]');
    eq(await p.$eval('#dialog [data-sig-mode="type"]', (b) => b.getAttribute('aria-selected')), 'true');
    await p.click('#dialog .btn.primary'); eq(await p.textContent('#toast'), 'Type your name first');
    await p.fill('#sigName', 'Ada Lovelace'); await p.click('#dialog [data-sig-font="1"]'); await p.focus('#sigName'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
    ok(!(await p.$('#dialog[open]')), 'Enter places it');
    await click(p, 300, 300);
    const typed = await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().pop());
    eq(typed.type, 'img'); ok(typed.w === 160 && typed.h > 10 && typed.h < 80, `a wide typed name ${typed.w}x${typed.h}`);
    eq(await p.$$eval('.page[data-n="0"] svg.marks .mk.sel', (g) => g.length), 1, 'placed and selected');
    // a picture on white paper: the white goes, the ink stays
    await sign(); await p.click('#dialog [data-sig-mode="upload"]');
    const png = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 150; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 150); g.strokeStyle = '#000'; g.lineWidth = 8; g.beginPath(); g.moveTo(40, 100); g.lineTo(360, 40); g.stroke(); return c.toDataURL('image/png').split(',')[1]; });
    await p.setInputFiles('#sigFile', { name: 'sig.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }); await p.waitForTimeout(400);
    await p.click('#dialog .btn.primary'); await click(p, 300, 200);
    const pic = await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().pop().data);
    const [corner, ink] = await p.evaluate((src) => new Promise((res) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let opaque = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) opaque++; res([d[3], opaque]); }; im.src = src; }), pic);
    ok(corner === 0 && ink > 200, `transparent paper, opaque ink (${corner}, ${ink})`);
    eq(await kept(), 2);
    // drawn, then a fourth: only three are kept, newest first; a saved one is placed with one click and can be removed
    for (const y of [60, 90]) {
      await sign(); const pad = await p.locator('#sigPad').boundingBox();
      await p.mouse.move(pad.x + 20, pad.y + y); await p.mouse.down(); await p.mouse.move(pad.x + 300, pad.y + y + 30, { steps: 8 }); await p.mouse.up();
      await p.click('#dialog .btn.primary'); await click(p, 300, 100 + y);
    }
    eq(await kept(), 3, 'three kept');
    await sign(); eq(await p.$$eval('#dialog [data-sig-use]', (b) => b.length), 3);
    await p.click('#dialog [data-sig-del="2"]'); eq(await kept(), 2, 'removed');
    await p.click('#dialog [data-sig-use="0"]'); await p.waitForTimeout(100);
    ok(!(await p.$('#dialog[open]')), 'a saved one is picked at once');
    eq(await p.evaluate(() => document.querySelector('#app').dataset.tool), 'sign');
    eq(p.errors, []); await p.ctx.close();
  });
};
