// Comment tab: text mark-up, shapes, callouts, typewriter, stamps, and the Comments panel.
export default async (h) => {
  const { test, eq, ok, open, openPdf, savedOf, reopen, at, marks, selectText, PDFDocument, require, path, root, WORD } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const N = (s) => L.PDFName.of(s);
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
  const drag = async (p, [x1, y1], [x2, y2]) => { const a = await at(p, x1, y1), b = await at(p, x2, y2); await p.mouse.move(...a); await p.mouse.down(); await p.mouse.move(...b, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(80); };
  const click = async (p, x, y) => { await p.mouse.click(...(await at(p, x, y))); await p.waitForTimeout(80); };
  const typeIn = async (p, text) => { await p.waitForSelector('#dialog[open] #dlgInput'); await p.fill('#dlgInput', text); await p.click('#dialog .btn.primary'); await p.waitForTimeout(150); };
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
    await p.click('[data-cmd="cm_fill"]');
    await p.click('[data-cmd="cm_cloud"]'); await drag(p, [220, 470], [360, 400]);
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
    eq(all.slice(12).map((m) => [m.label, m.color]), [['Approved', '#2B8A3E'], ['Paid', '#1C7ED6']]);
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

  await h.test('comments: your name is asked once and written as the author; the panel filters by type and author and sorts by date', async () => {
    const p = await open({ height: 1500, askName: true }); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.click('[data-rt="markup"]');
    await p.click('[data-cmd="cm_oval"]'); await drag(p, [60, 470], [180, 400]);
    await p.waitForSelector('#dialog[open] #dlgInput');
    eq(await p.textContent('#dialog h2'), 'Your name');
    await p.fill('#dlgInput', 'Ada Lovelace'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(150);
    await p.click('[data-cmd="cm_cloud"]'); await drag(p, [220, 470], [360, 400]); await p.waitForTimeout(150);
    ok(!(await p.$('#dialog[open]')), 'asked only once');
    await p.click('[data-cmd="cm_list"]'); await p.waitForSelector('#sidePanel .cm-item');
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
    // Skipping the question: comments have no author, and it is not asked again
    const q = await open({ height: 1500, askName: true }); await openPdf(q);
    await q.click('[data-rt="markup"]'); await q.click('[data-cmd="cm_oval"]'); await drag(q, [60, 470], [180, 400]);
    await q.waitForSelector('#dialog[open] #dlgInput'); await q.click('#dialog .dlg-foot .btn:not(.primary)'); await q.waitForTimeout(150);
    await q.click('[data-cmd="cm_cloud"]'); await drag(q, [220, 470], [360, 400]); await q.waitForTimeout(150);
    ok(!(await q.$('#dialog[open]')), 'not asked again');
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
};
