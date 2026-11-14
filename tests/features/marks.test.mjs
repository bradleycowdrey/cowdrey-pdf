// Marks: selection box and handles, text mark-up over line ends and under comments, marked text in the list,
// announcements, the tool chip, XFDF export and import, and the Forms tab's design and fill modes.
export default async (h) => {
  const { test, eq, ok, open, openPdf, savedOf, reopen, at, WORD } = h;
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
  const all = (p) => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().filter((m) => m && m.type));
  const drag = async (p, [x1, y1], [x2, y2]) => { const a = await at(p, x1, y1), b = await at(p, x2, y2); await p.mouse.move(...a); await p.mouse.down(); await p.mouse.move(...b, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(150); };
  const spanBox = (p, text) => p.locator('.page[data-n="0"] .textLayer span', { hasText: text }).first().boundingBox();

  await h.test('text mark-up: a drag past the end of a line marks that line only, once', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    for (const tool of ['tool_highlight', 'cm_underline']) {
      await run(p, tool);
      const b = await spanBox(p, 'Prepared by the delivery team');
      await p.mouse.move(b.x + 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width + 60, b.y + b.height / 2, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(200);
    }
    const ms = await all(p);
    eq(ms.map((m) => m.type), ['hl', 'cmMarkup']);
    eq(ms[0].rects.length, 1, 'one highlight rectangle: ' + JSON.stringify(ms[0].rects));
    eq(ms[1].quads.length, 1, 'one underline quad: ' + JSON.stringify(ms[1].quads));
    ok(/^Prepared by the delivery team on 3 March\.?$/.test(ms[0].text), 'highlight keeps its words: ' + ms[0].text);
    eq(p.errors, []); await p.ctx.close();
  });
  await h.test('text mark-up: text under a comment from the file, or under your own shape, can be selected and marked', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    // word.pdf has a square comment around this sentence
    await run(p, 'cm_strike');
    let b = await spanBox(p, 'The second phase');
    ok(await p.evaluate(([x, y]) => !!document.elementFromPoint(x, y).closest('.textLayer'), [b.x + 4, b.y + b.height / 2]), 'the text is on top for a text tool');
    await p.mouse.move(b.x + 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width * .6, b.y + b.height / 2, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(200);
    // an oval of your own over a line, then Highlight inside it
    await run(p, 'cm_oval');
    b = await spanBox(p, 'Prepared by the delivery team');
    await p.mouse.move(b.x - 10, b.y - 10); await p.mouse.down(); await p.mouse.move(b.x + b.width + 10, b.y + b.height + 10, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(150);
    await run(p, 'tool_highlight');
    await p.mouse.move(b.x + 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width * .5, b.y + b.height / 2, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(200);
    const ms = await all(p);
    eq(ms.map((m) => m.type + (m.kind ? ':' + m.kind : '')), ['cmMarkup:strike', 'cmShape:oval', 'hl']);
    ok(ms[0].text.startsWith('The second phase'), ms[0].text);
    // with Select, the oval is picked up again
    await run(p, 'tool_select');
    ok(await p.evaluate(([x, y]) => !!document.elementFromPoint(x, y).closest('.mk'), [b.x - 10, b.y + b.height / 2]), 'Select picks the oval');
    await p.ctx.close();
  });

  await h.test('selected marks: a dashed box with handles; dragging one resizes the mark in one undo step (both themes, touch)', async () => {
    const shot = '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr3/fix-marks/';
    for (const scheme of ['dark', 'light']) {
      const p = await open({ scheme }); await openPdf(p);
      await p.click('[data-rt="markup"]'); await p.click('[data-cmd="tool_rect"]');
      await drag(p, [100, 700], [200, 650]);
      await run(p, 'tool_select');
      const [x0, y0] = await at(p, 150, 700); await p.mouse.click(x0, y0); await p.waitForTimeout(100);
      ok(await p.$('.marks .mk-selbox'), 'selection box');
      eq(await p.$$eval('.marks .mk-handle', (h) => h.map((x) => x.dataset.h)), ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
      eq(await p.$eval('.marks .mk-selbox', (r) => getComputedStyle(r).stroke !== 'none'), true);
      await p.screenshot({ path: shot + `rect-selected-${scheme}.png`, clip: { x: x0 - 140, y: y0 - 90, width: 280, height: 180 } });
      // the bottom-right handle, dragged 50 pt right and 30 pt down
      const hb = await p.locator('.marks .mk-handle[data-h="se"]').boundingBox();
      const [dx] = await at(p, 50, 0), [ox] = await at(p, 0, 0);
      await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await p.mouse.down(); await p.mouse.move(hb.x + hb.width / 2 + (dx - ox), hb.y + hb.height / 2 + (dx - ox) * .6, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(150);
      let [m] = await all(p);
      const bx = [Math.min(m.x1, m.x2), Math.min(m.y1, m.y2), Math.max(m.x1, m.x2), Math.max(m.y1, m.y2)].map(Math.round);
      ok(Math.abs(bx[0] - 100) < 2 && Math.abs(bx[3] - 700) < 2, 'top left stays: ' + bx);
      ok(Math.abs(bx[2] - 250) < 3 && Math.abs(bx[1] - 620) < 3, 'bottom right follows: ' + bx);
      // the left side only
      const hw = await p.locator('.marks .mk-handle[data-h="w"]').boundingBox();
      await p.mouse.move(hw.x + hw.width / 2, hw.y + hw.height / 2); await p.mouse.down(); await p.mouse.move(hw.x + hw.width / 2 - 20, hw.y + hw.height / 2 + 30, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(150);
      [m] = await all(p);
      ok(Math.min(m.x1, m.x2) < 95 && Math.abs(Math.max(m.y1, m.y2) - 700) < 2 && Math.abs(Math.min(m.y1, m.y2) - 620) < 3, 'only the left side moved');
      await p.keyboard.press('Control+z'); [m] = await all(p);
      ok(Math.abs(Math.min(m.x1, m.x2) - 100) < 2, 'one undo step per resize');
      // a stamp keeps its proportions: corner handles only
      await p.click('[data-cmd="cm_stamp"]'); await p.waitForSelector('#dialog[open] [data-stamp="approved"]'); await p.click('#dialog [data-stamp="approved"]'); await p.waitForTimeout(100);
      await p.mouse.click(...(await at(p, 300, 500))); await p.waitForTimeout(150);
      eq(await p.$$eval('.marks .mk-handle', (h) => h.map((x) => x.dataset.h)), ['nw', 'ne', 'se', 'sw']);
      const sb = await p.locator('.marks .mk-handle[data-h="se"]').boundingBox(), s0 = (await all(p)).pop();
      await p.mouse.move(sb.x + 4, sb.y + 4); await p.mouse.down(); await p.mouse.move(sb.x + 60, sb.y + 30, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(150);
      const s1 = (await all(p)).pop();
      ok(s1.size > s0.size * 1.2 && Math.abs(s1.bw / s1.bh - s0.bw / s0.bh) < .01, `stamp grows evenly ${s0.size} → ${s1.size}`);
      await p.screenshot({ path: shot + `stamp-selected-${scheme}.png` });
      eq(p.errors, []); await p.ctx.close();
    }
    // touch: bigger handles
    const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p);
    await run(p, 'cm_oval'); await p.evaluate(() => 0);
    const a = await at(p, 100, 600), b = await at(p, 250, 500);
    await p.touchscreen.tap(a[0], a[1]); // nothing drawn by a tap
    await p.evaluate(([a, b]) => { const svg = document.querySelector('.page[data-n="0"] svg.marks'); const o = { bubbles: true, pointerId: 5, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 }; svg.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: a[0], clientY: a[1] })); window.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: b[0], clientY: b[1] })); window.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0, clientX: b[0], clientY: b[1] })); }, [a, b]);
    await p.waitForTimeout(150);
    const sizes = await p.$$eval('.marks .mk-handle', (h) => h.map((x) => +x.getAttribute('width')));
    ok(sizes.length >= 8 && Math.max(...sizes) >= 30, 'big targets for a finger: ' + sizes);
    await p.screenshot({ path: shot + 'oval-selected-phone.png' });
    await p.ctx.close();
  });

  await h.test('selected marks: named for screen readers, and selecting one is announced', async () => {
    const p = await open(); await openPdf(p);
    await run(p, 'cm_oval'); await drag(p, [100, 700], [200, 650]);
    eq(await p.$eval('.page[data-n="0"] svg.marks .mk', (g) => [g.getAttribute('role'), g.getAttribute('aria-label')]), ['img', 'Oval']);
    await p.waitForTimeout(100);
    eq(await p.textContent('#announce'), 'Oval selected. Arrow keys move it, Delete removes it.');
    await run(p, 'tool_note'); await p.mouse.click(...(await at(p, 400, 600))); await p.fill('.page-ask textarea', 'Check the numbers'); await p.click('.page-ask .btn.primary'); await p.waitForTimeout(100);
    eq(await p.$eval('.page[data-n="0"] svg.marks [data-type="note"]', (g) => g.getAttribute('aria-label')), 'Note: Check the numbers');
    await p.ctx.close();
  });

  await h.test('mode chip: the status bar says which tool is on and how to use it, until Esc; hints are not toasts', async () => {
    const p = await open(); await openPdf(p);
    ok(await p.$eval('#modeChip', (c) => c.hidden), 'hidden with Select');
    await p.click('[data-rt="forms"]'); await p.click('[data-cmd="ff_text"]'); await p.waitForTimeout(100);
    eq(await p.textContent('#modeChip .mode-text'), 'Text field: drag on the page · Esc to stop');
    ok(!(await p.$eval('#toast', (t) => t.classList.contains('show'))), 'no instruction toast');
    await p.click('[data-rt="markup"]'); await p.click('[data-cmd="cm_polygon"]'); await p.waitForTimeout(100);
    eq(await p.textContent('#modeChip .mode-text'), 'Polygon: click each corner, then double-click to finish · Esc to stop');
    await p.click('[data-cmd="cm_typewriter"]'); await p.waitForTimeout(100);
    eq(await p.textContent('#modeChip .mode-text'), 'Typewriter: click where the text goes · Esc to stop');
    await p.click('#viewer', { position: { x: 5, y: 5 } }); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    ok(await p.$eval('#modeChip', (c) => c.hidden), 'gone after Esc');
    await p.click('[data-cmd="cm_oval"]'); await p.click('#modeChip .mode-stop'); await p.waitForTimeout(100);
    eq(await p.evaluate(() => document.querySelector('#app').dataset.tool), 'select', 'the chip stops the tool');
    // results still come as toasts
    await p.click('[data-cmd="cm_fill"]'); ok(await p.$eval('#toast', (t) => t.classList.contains('show')), 'result toast');
    await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr3/fix-marks/chip-dark.png' });
    await p.ctx.close();
    const q = await open({ width: 390, height: 844, touch: true, scheme: 'light' }); await openPdf(q);
    await q.evaluate(() => window.__cowdreyPdf.run('cm_typewriter')); await q.waitForTimeout(100);
    eq(await q.textContent('#modeChip .mode-text'), 'Typewriter: tap where the text goes');
    ok(await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
    await q.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr3/fix-marks/chip-phone-light.png' });
    await q.ctx.close();
  });

  await h.test('comments list: highlight rows show the marked words, also after saving and opening again', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await run(p, 'tool_highlight');
    const b = await spanBox(p, 'Prepared by the delivery team');
    await p.mouse.move(b.x + 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width * .45, b.y + b.height / 2, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(200);
    let items = (await p.evaluate(() => window.__cowdreyPdf.cmItems())).filter((i) => i[0] === 'Highlight');
    ok(items.length === 1 && /^Prepared by/.test(items[0][2]), JSON.stringify(items));
    await run(p, 'cm_list'); await p.waitForSelector('#sidePanel .cm-item');
    ok((await p.textContent('#sidePanel')).includes('Prepared by'), 'shown in the panel');
    await reopen(p, await savedOf(p));
    items = (await p.evaluate(() => window.__cowdreyPdf.cmItems())).filter((i) => i[0] === 'Highlight');
    ok(items.length === 1 && /^Prepared by/.test(items[0][2]) && !items[0][3], 'read back from the file: ' + JSON.stringify(items));
    await p.ctx.close();
  });

  await h.test('comments: Hide all hides every comment on screen only; Export and Import carry them as XFDF', async () => {
    const p = await open({ height: 1500 }); await openPdf(p, WORD, 'Pelican report.pdf');
    // one of each kind of comment
    await run(p, 'tool_highlight'); let b = await spanBox(p, 'Prepared by the delivery team');
    await p.mouse.move(b.x + 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width * .5, b.y + b.height / 2, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(150);
    await run(p, 'cm_underline'); b = await spanBox(p, 'Budget');
    await p.mouse.move(b.x + 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width * .5, b.y + b.height / 2, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(150);
    await run(p, 'tool_rect'); await drag(p, [60, 200], [160, 150]);
    await run(p, 'cm_cloud'); await drag(p, [200, 200], [300, 150]);
    await run(p, 'cm_arrow'); await drag(p, [320, 200], [420, 150]);
    await run(p, 'cm_polygon'); for (const [x, y] of [[60, 120], [120, 120]]) { await p.mouse.click(...(await at(p, x, y))); await p.waitForTimeout(60); } await p.mouse.dblclick(...(await at(p, 90, 80))); await p.waitForTimeout(100);
    await run(p, 'tool_pen'); await drag(p, [200, 120], [260, 80]);
    await run(p, 'tool_note'); await p.mouse.click(...(await at(p, 450, 120))); await p.fill('.page-ask textarea', 'See the budget'); await p.click('.page-ask .btn.primary'); await p.waitForTimeout(100);
    await run(p, 'cm_typewriter'); await p.mouse.click(...(await at(p, 300, 120))); await p.fill('.page-ask textarea', 'Typed'); await p.click('.page-ask .btn.primary'); await p.waitForTimeout(100);
    await run(p, 'cm_stamp'); await p.waitForSelector('#dialog[open] [data-stamp="received"]'); await p.click('#dialog [data-stamp="received"]'); await p.waitForTimeout(100); await p.mouse.click(...(await at(p, 450, 300))); await p.waitForTimeout(100);
    await run(p, 'cm_callout'); await drag(p, [100, 60], [160, 40]); await p.fill('.page-ask textarea', 'Look here'); await p.click('.page-ask .btn.primary'); await p.waitForTimeout(150);
    const mine = (await all(p)).filter((m) => m.type !== 'cmReply');
    eq(mine.map((m) => m.type + (m.kind ? ':' + m.kind : '')), ['hl', 'cmMarkup:underline', 'rect', 'cmShape:cloud', 'cmShape:arrow', 'cmShape:polygon', 'ink', 'note', 'cmType', 'cmStamp', 'cmCallout']);
    // Hide all: nothing on the page; the file's own square too; saving is not changed
    await run(p, 'cm_list'); await p.waitForSelector('#sidePanel [data-cmd="cm_hide"]');
    await p.click('#sidePanel [data-cmd="cm_hide"]'); await p.waitForTimeout(600);
    eq(await p.$$eval('.page[data-n="0"] svg.marks .mk', (g) => g.filter((x) => getComputedStyle(x).display !== 'none').length), 0, 'your comments hidden');
    eq(await p.evaluate(() => document.querySelector('#app').dataset.hideMarks), '1');
    ok(await p.evaluate(() => window.__cowdreyPdf.cmHiddenCount()) >= 2, 'the file\'s comments are hidden too');
    eq((await p.textContent('#sidePanel [data-cmd="cm_hide"]')).trim(), 'Show', 'the button says Show');
    await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr3/fix-marks/comments-hidden-dark.png' });
    const out = await savedOf(p);
    await p.click('#sidePanel [data-cmd="cm_hide"]'); await p.waitForTimeout(400);
    eq(await p.$$eval('.page[data-n="0"] svg.marks .mk', (g) => g.filter((x) => getComputedStyle(x).display !== 'none').length), 11, 'shown again');
    // Export: an XFDF file with every comment, the file's own included
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#sidePanel [data-cmd="cm_export"]')]);
    eq(dl.suggestedFilename(), 'Pelican report comments.xfdf');
    const xml = h.fs.readFileSync(await dl.path(), 'utf8');
    for (const tag of ['highlight', 'underline', 'square', 'line', 'polygon', 'ink', 'text', 'freetext', 'stamp']) ok(xml.includes('<' + tag + ' '), 'exported: ' + tag);
    ok(xml.includes('<contents>Prepared by'), 'highlighted words');
    // Import into the same PDF, opened fresh: the same comments come back
    await reopen(p, h.fs.readFileSync(WORD));
    await p.setInputFiles('#cmXfdfFile', { name: 'c.xfdf', mimeType: 'application/vnd.adobe.xfdf', buffer: Buffer.from(xml) }); await p.waitForTimeout(400);
    const back = (await all(p)).filter((m) => m.type !== 'cmReply');
    eq(back.length, mine.length, 'yours; the file\'s own square and note are not doubled');
    const near = (a, b, d = 1.5) => Math.abs(a - b) <= d;
    for (const m of mine) {
      const n = back.find((x) => x.id === m.id); ok(n, 'back: ' + m.type);
      eq(n.type + (n.kind || ''), m.type + (m.kind || ''));
      const same = m.rects ? n.rects.every((r, j) => r.every((x, i) => near(x, m.rects[j][i])))
        : m.quads ? n.quads[0].every((x, i) => near(x, m.quads[0][i]))
        : m.pts ? n.pts.every((q, j) => near(q[0], m.pts[j][0]) && near(q[1], m.pts[j][1]))
        : 'x1' in m ? near(Math.min(m.x1, m.x2), Math.min(n.x1, n.x2)) && near(Math.max(m.y1, m.y2), Math.max(n.y1, n.y2))
        : near(m.x, n.x) && near(m.y, n.y) && (m.text || '') === (n.text || '') && (m.size || 0) === (n.size || 0);
      ok(same, 'same place and words: ' + JSON.stringify([m, n]).slice(0, 400));
      ok((m.text || '') === (n.text || '') && (m.color || '').toUpperCase() === (n.color || '').toUpperCase(), 'text and colour: ' + m.type);
      if (m.type === 'cmCallout') ok(near(m.tx, n.tx) && near(m.ty, n.ty) && near(m.bw, n.bw, 3), 'callout points to the same place');
      if (m.type === 'cmStamp') eq([n.label, n.sub, n.stamp], [m.label, m.sub, m.stamp]);
      eq(n.author, 'Tester');
    }
    // importing the same file again adds nothing
    await p.setInputFiles('#cmXfdfFile', { name: 'c.xfdf', mimeType: 'application/vnd.adobe.xfdf', buffer: Buffer.from(xml) }); await p.waitForTimeout(300);
    eq((await all(p)).length, back.length, 'no duplicates');
    eq(await p.evaluate(() => window.__cowdreyPdf.cmImportXfdf('<html/>')), -1, 'not XFDF');
    // into another PDF: the other file's comments come as comments too
    await reopen(p, h.fs.readFileSync(h.path.join(h.root, 'tests/fixtures/sample.pdf')));
    eq(await p.evaluate((x) => window.__cowdreyPdf.cmImportXfdf(x), xml), 13, 'all thirteen');
    // the saved PDF while hidden still has every comment
    const d = await h.PDFDocument.load(out);
    ok(d.getPage(0).node.Annots().size() >= 13, 'saved with every comment');
    eq(p.errors.filter((e) => !/annotation-comment/.test(e)), []); await p.ctx.close();
  });

  await h.test('Protect: Flatten pages says what it flattens, apart from Flatten form', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="protect"]');
    eq(await p.textContent('#ribbonBody [data-cmd="protFlatten"]'), 'Flatten pages');
    ok(/comments and form fields part of the page content/.test(await p.getAttribute('#ribbonBody [data-cmd="protFlatten"]', 'title')), 'tooltip');
    await p.click('[data-rt="forms"]');
    ok(/Comments stay comments/.test(await p.getAttribute('#ribbonBody [data-cmd="ffFlatten"]', 'title')), 'Flatten form tooltip');
    await p.ctx.close();
  });
  await h.test('comments: Hide, Export and Import are on the Comments list button and in the Comment menu', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="markup"]'); await p.click('#ribbonBody [data-rmenu="cm_list"]'); await p.waitForTimeout(100);
    const items = await p.$$eval('#popover [data-cmd]', (b) => b.map((x) => x.dataset.cmd));
    ok(['cm_hide', 'cm_export', 'cm_import'].every((id) => items.includes(id)), JSON.stringify(items));
    await p.keyboard.press('Escape');
    await p.click('.menubar button:has-text("Comment")'); await p.waitForTimeout(100);
    ok((await p.textContent('#popover')).includes('Export comments'), 'Comment menu');
    await p.ctx.close();
  });
};
