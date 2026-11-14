// The interaction model: editing in place, one Escape rule, the selection bar, dialog focus, Find and list focus,
// the ribbon's keys, commands that don't apply, and drag tools placed from the keyboard.
export default async ({ test, eq, ok, open, openPdf, marks, at, selectText, WORD }) => {
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id).then(() => p.waitForTimeout(120));
  const tool = (p) => p.evaluate(() => document.querySelector('#app, .app').dataset.tool);
  const all = (p) => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat());
  const undoLabel = (p) => p.evaluate(() => window.__cowdreyPdf.cmdLabel('undo'));

  await test('Add text types on the page: no dialog; Escape keeps it and the Text tool stays; an empty box adds nothing', async () => {
    const p = await open(); await openPdf(p);
    await run(p, 'tool_text');
    await p.mouse.click(...(await at(p, 100, 600)));
    await p.waitForSelector('.page .txt-editor'); ok(!(await p.$('#dialog[open]')), 'no dialog');
    eq(await p.evaluate(() => document.activeElement.className), 'txt-editor', 'typing goes to the page');
    await p.keyboard.type('Hello note'); await p.keyboard.press('Escape'); await p.waitForTimeout(250);
    let ms = await all(p);
    eq(ms.map((m) => [m.type, m.text]), [['text', 'Hello note']], 'kept by Escape');
    eq(await tool(p), 'text', 'still the Text tool');
    eq(await undoLabel(p), 'Undo Text box');
    // a click on the page starts another box; a click away from an empty one adds nothing
    await p.mouse.click(...(await at(p, 100, 480))); await p.waitForSelector('.page .txt-editor');
    await p.mouse.click(...(await at(p, 300, 420))); await p.waitForTimeout(250);
    ok(!(await p.$('.page .txt-editor')), 'the click away only closed the empty box');
    eq((await all(p)).length, 1, 'the empty box added nothing');
    // a click away keeps typed text
    await p.mouse.click(...(await at(p, 100, 450))); await p.waitForSelector('.page .txt-editor');
    await p.keyboard.type('Second'); await p.mouse.click(...(await at(p, 400, 500))); await p.waitForTimeout(300);
    eq((await all(p)).map((m) => m.text), ['Hello note', 'Second'], 'click away keeps it');
    await p.keyboard.press('Control+z'); await p.waitForTimeout(150); eq((await all(p)).length, 1, 'one undo step');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Note opens a small editor on the page, not a dialog; Escape keeps the note and the Note tool; empty adds nothing', async () => {
    const p = await open(); await openPdf(p);
    await run(p, 'tool_note');
    await p.mouse.click(...(await at(p, 300, 500)));
    await p.waitForSelector('.page .page-ask textarea'); ok(!(await p.$('#dialog[open]')), 'no dialog');
    eq(await p.evaluate(() => document.activeElement.closest('.page-ask') !== null), true, 'focus in the note');
    await p.keyboard.type('Check the numbers'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    eq((await all(p)).map((m) => [m.type, m.text]), [['note', 'Check the numbers']]);
    eq(await tool(p), 'note', 'still the Note tool');
    // empty: nothing
    await p.mouse.click(...(await at(p, 200, 420))); await p.waitForSelector('.page .page-ask');
    await p.click('.page-ask .btn.primary'); await p.waitForTimeout(150);
    eq((await all(p)).length, 1, 'an empty note is not added');
    // a click away keeps it, and doesn't start another note
    await p.mouse.click(...(await at(p, 200, 450))); await p.waitForSelector('.page .page-ask');
    await p.keyboard.type('Second'); await p.mouse.click(...(await at(p, 450, 480))); await p.waitForTimeout(200);
    ok(!(await p.$('.page-ask')), 'closed'); eq((await all(p)).map((m) => m.text), ['Check the numbers', 'Second']);
    // double-click with Select changes its words in the same editor
    await run(p, 'tool_select');
    const [nx, ny] = await at(p, 300, 500); await p.mouse.dblclick(nx + 6, ny + 6); await p.waitForSelector('.page .page-ask textarea');
    eq(await p.inputValue('.page-ask textarea'), 'Check the numbers');
    await p.fill('.page-ask textarea', 'Numbers checked'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    eq((await all(p)).map((m) => m.text), ['Numbers checked', 'Second']);
    eq(p.errors, []); await p.ctx.close();
  });


  await test('Selecting text with Select shows a bar (Highlight, Underline, Strikethrough, Redact, Copy); the right-click menu has the same', async () => {
    const p = await open(); await openPdf(p);
    eq(await tool(p), 'select');
    await selectText(p, 0, 'Cowdrey.PDF opens'); await p.waitForTimeout(250);
    eq(await p.evaluate(() => window.__cowdreyPdf.selBar()), ['Highlight', 'Underline', 'Strikethrough', 'Mark for redaction', 'Copy']);
    const bar = await p.$eval('.sel-bar', (b) => { const r = b.getBoundingClientRect(); return [r.width > 100, r.height < 60]; }); eq(bar, [true, true], 'small');
    await p.click('.sel-bar [aria-label="Underline"]'); await p.waitForTimeout(200);
    eq((await all(p)).map((m) => [m.type, m.kind]), [['cmMarkup', 'underline']]);
    ok(!(await p.$('.sel-bar')), 'gone once used');
    eq(await undoLabel(p), 'Undo Text mark-up');
    // right-click over a selection
    await selectText(p, 0, 'The pelican count'); await p.waitForTimeout(200);
    const s = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'The pelican count' }).first().boundingBox();
    await p.mouse.click(s.x + 4, s.y + s.height / 2, { button: 'right' }); await p.waitForSelector('#popover:not([hidden])');
    await p.waitForTimeout(400); ok(!(await p.$('.sel-bar')), 'the bar makes way for the menu');
    const items = await p.$$eval('#popover .mi span:nth-child(2)', (e) => e.map((x) => x.textContent));
    eq(items.slice(0, 5), ['Highlight', 'Underline', 'Strikethrough', 'Mark for redaction', 'Copy']);
    await p.click('#popover .mi:has-text("Highlight")'); await p.waitForTimeout(200);
    eq((await all(p)).map((m) => m.type), ['cmMarkup', 'hl']);
    // not with another tool: the Highlight tool marks the selection itself
    await run(p, 'tool_pen'); await p.evaluate(() => getSelection().removeAllRanges());
    eq(await p.evaluate(() => window.__cowdreyPdf.selBar()), null);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Phone: a selection made by touch shows the bar once it rests; Redact marks the text', async () => {
    const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p);
    // as a long press does: the selection changes with no pointer events
    await p.evaluate(() => { const s = [...document.querySelectorAll('.page[data-n="0"] .textLayer span')].find((x) => /Cowdrey.PDF opens/.test(x.textContent)); const r = document.createRange(); r.setStart(s.firstChild, 0); r.setEnd(s.firstChild, 11); getSelection().removeAllRanges(); getSelection().addRange(r); });
    await p.waitForTimeout(600);
    eq((await p.evaluate(() => window.__cowdreyPdf.selBar())).length, 5, 'bar shown');
    const fits = await p.$eval('.sel-bar', (b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }); ok(fits, 'inside the screen');
    await p.tap('.sel-bar [aria-label="Mark for redaction"]'); await p.waitForTimeout(200);
    eq((await all(p)).map((m) => m.type), ['redact']);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Dialogs open on their first text field, so typing straight away lands there, and Enter presses the main button', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="edit"]'); await p.focus('#ribbonBody [data-cmd="pd_watermark"]'); await p.keyboard.press('Enter');
    await p.waitForSelector('#dialog[open] .pd-form');
    eq(await p.evaluate(() => [document.activeElement.type, document.activeElement.dataset.k]), ['text', 'text'], 'on the Text field, not the Text/Picture choice');
    await p.keyboard.press('Control+a'); await p.keyboard.type('DRAFT KB'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    ok(!(await p.$('#dialog[open]')), 'Enter added it');
    eq((await p.evaluate(() => window.__cowdreyPdf.pdItems())).map((m) => m.text), ['DRAFT KB']);
    // a question with one field: Enter there answers it, as before
    await run(p, 'extract'); await p.waitForSelector('#dialog[open] #dlgInput');
    eq(await p.evaluate(() => document.activeElement.id), 'dlgInput');
    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Closing Find (Esc or X) gives the focus back to what opened it; a Comments-list item keeps the focus in the list', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="home"]').catch(() => {});
    const opener = await p.$('#ribbonBody [data-cmd="find"]');
    if (opener) { await opener.focus(); await p.keyboard.press('Enter'); } else await p.keyboard.press('Control+f');
    await p.fill('#findInput', 'pelican'); await p.keyboard.press('Enter'); await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    eq(await p.evaluate(() => document.activeElement.dataset.cmd || document.activeElement.id), opener ? 'find' : 'viewer', 'Esc');
    await p.focus('#viewer'); await p.keyboard.press('Control+f'); await p.click('#findClose'); await p.waitForTimeout(150);
    eq(await p.evaluate(() => document.activeElement.id), 'viewer', 'X');
    // two notes, then the list
    await run(p, 'tool_note');
    for (const [x, y, t] of [[300, 500, 'First'], [350, 450, 'Second']]) { await p.mouse.click(...(await at(p, x, y))); await p.waitForSelector('.page-ask textarea'); await p.keyboard.type(t); await p.keyboard.press('Escape'); await p.waitForTimeout(150); }
    await run(p, 'cm_list'); await p.waitForSelector('#sidePanel .cm-go');
    await p.focus('#sidePanel [data-cm-go="1"]'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
    eq(await p.evaluate(() => [document.activeElement.matches('#sidePanel [data-cm-go]'), document.activeElement.textContent.includes('Second')]), [true, true], 'focus stays on the item');
    eq(await p.$$eval('.page[data-n="0"] svg.marks .mk.sel', (g) => g.length), 1, 'its mark is selected');
    await p.keyboard.press('Tab'); ok(await p.evaluate(() => document.activeElement.closest('#sidePanel') !== null), 'Tab carries on in the list');
    await p.focus('#sidePanel [data-cm-go="1"]'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    eq(await p.evaluate(() => document.activeElement.id), 'viewer', 'Enter on the open one goes to the mark');
    const x0 = (await all(p))[1].x; await p.keyboard.press('ArrowRight'); await p.waitForTimeout(100);
    ok(Math.abs((await all(p))[1].x - x0 - 1) < .01, 'and the arrows move it');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Ribbon: each group is a toolbar with one Tab stop; arrows move within it, Tab to the next group; Down opens a list', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="markup"]'); await p.waitForTimeout(150);
    const groups = await p.$$eval('#ribbonBody .r-group:not([hidden])', (g) => g.map((x) => [x.getAttribute('role'), x.getAttribute('aria-label'), [...x.querySelectorAll('button, input')].filter((b) => b.tabIndex === 0).length]));
    ok(groups.length >= 4, 'groups ' + groups.length);
    ok(groups.every(([r, l, n]) => r === 'toolbar' && l && n === 1), JSON.stringify(groups));
    eq(await p.$$eval('#ribbonBody button, #ribbonBody input', (b) => b.filter((x) => x.tabIndex === 0 && !x.closest('[hidden]')).length), groups.length, 'one Tab stop a group');
    // from the tab, Tab enters the first group on its pressed tool (Select); Right moves along; Tab goes to the next group
    await p.focus('#rt-markup'); await p.keyboard.press('Tab');
    const name = () => p.evaluate(() => [document.activeElement.closest('.r-group')?.getAttribute('aria-label'), document.activeElement.dataset.cmd || document.activeElement.dataset.color || document.activeElement.dataset.rmenu]);
    const [g0, c0] = await name(); eq(c0, 'tool_select');
    await p.keyboard.press('ArrowRight'); const [g1, c1] = await name(); eq(g1, g0, 'stays in the group'); ok(c1 !== c0, 'moved');
    await p.keyboard.press('ArrowLeft'); eq((await name())[1], c0);
    await p.keyboard.press('ArrowLeft'); const [gw, last] = await name(); eq(gw, g0, 'wraps within the group'); ok(last !== c0, 'to its last item');
    await p.keyboard.press('Tab'); const [g2] = await name(); ok(g2 && g2 !== g0, 'Tab: next group ' + g2);
    await p.keyboard.press('Shift+Tab'); eq(await name(), [g0, last], 'Shift+Tab back, to where it was');
    // Down on a button with a list opens it
    await p.click('[data-rt="pages"]'); await p.waitForTimeout(100);
    const more = await p.$('#ribbonBody [data-rmenu]'); ok(more, 'a list button');
    await more.focus(); await p.keyboard.press('ArrowDown'); await p.waitForSelector('#popover:not([hidden])');
    ok(await p.evaluate(() => document.activeElement.closest('#popover') !== null), 'focus in the list');
    await p.keyboard.press('Escape'); ok(await p.evaluate(() => document.activeElement.matches('#ribbonBody [data-rmenu]')), 'Escape back to it');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Commands that do not apply are disabled: Remove security, Delete page, Split, Manage page design, Flatten and Clear form', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    const en = (ids) => p.evaluate((l) => l.map((id) => window.__cowdreyPdf.cmdEnabled(id)), ids);
    await p.waitForTimeout(400);
    eq(await en(['protUnsecure', 'pd_manage', 'ffFlatten', 'ffClear', 'delPage', 'pg60_split', 'pg60_delete']), [false, false, false, false, false, false, false], 'one page, no password, no form, no page design');
    await p.click('[data-rt="protect"]'); eq(await p.$eval('#ribbonBody [data-cmd="protUnsecure"]', (b) => b.disabled), true, 'shown disabled on the ribbon');
    // they come on once they apply
    await run(p, 'blank'); await p.waitForSelector('#dialog[open]'); await p.click('#dialog .btn.primary'); await p.waitForFunction(() => window.__cowdreyPdf.doc.pages.length === 2, null, { timeout: 10000 });
    await run(p, 'pd_watermark'); await p.waitForSelector('#dialog[open] .pd-form'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    await run(p, 'protPassword'); await p.waitForSelector('#dialog[open] input[name=open]');
    await p.fill('#dialog input[name=open]', 'heron'); await p.fill('#dialog input[name=open2]', 'heron'); await p.click('#dialog .dlg-foot button:has-text("Set password")'); await p.waitForTimeout(200);
    eq(await en(['protUnsecure', 'pd_manage', 'delPage', 'pg60_split', 'pg60_delete']), [true, true, true, true, true]);
    eq(await p.$eval('#ribbonBody [data-cmd="protUnsecure"]', (b) => b.disabled), false);
    // a PDF with a form
    await openPdf(p); await p.waitForTimeout(500);
    eq(await en(['ffFlatten', 'ffClear', 'protUnsecure']), [true, true, false]);
    eq(p.errors.filter((e) => !/annotation-comment/.test(e)), []); await p.ctx.close();
  });

  await test('Drag-only tools are placed with Enter: a usual-size one in the middle of the page in view, selected; arrows move it, Alt+Shift+arrows resize it', async () => {
    const p = await open(); await openPdf(p);
    const box = (m) => { const xs = [], ys = []; const add = ([x, y]) => { xs.push(x); ys.push(y); };
      if ('x1' in m) { add([m.x1, m.y1]); add([m.x2, m.y2]); } if (m.pts) m.pts.forEach(add); if (m.rects) m.rects.forEach((r) => { add([r[0], r[1]]); add([r[2], r[3]]); }); if (m.quads) m.quads.forEach((q) => q.forEach(add));
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((n) => Math.round(n)); };
    const cases = [['tool_rect', 'rect', 160], ['cm_oval', 'cmShape', 160], ['cm_line', 'cmShape', 160], ['cm_arrow', 'cmShape', 160], ['cm_area', 'hl', 160], ['protRedArea', 'redact', 160], ['ff_text', 'ff', 160], ['ff_check', 'ff', 14]];
    let n = 0;
    for (const [id, type, w] of cases) {
      await run(p, id);
      if (n === 0) ok(/or press Enter to add one · Esc to stop$/.test(await p.textContent('#modeChip .mode-text')), 'the chip says so: ' + await p.textContent('#modeChip .mode-text'));
      await p.focus('#viewer'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
      if (await p.$('#dialog[open]')) await p.click('#dialog .btn.primary');
      const ms = await all(p); eq(ms.length, ++n, id + ' placed');
      const m = ms[ms.length - 1], b = box(m);
      eq([m.type, b[2] - b[0]], [type, w], id + ' size');
      eq(await tool(p), 'select', id + ': Select tool');
      eq(await p.evaluate(() => window.__cowdreyPdf.selId()), m.id, id + ' selected');
      await p.keyboard.press('ArrowRight'); await p.waitForTimeout(60);
      const b2 = box((await all(p))[n - 1]); eq([b2[0] - b[0], b2[2] - b2[0]], [1, w], id + ' moved 1 pt');
      if (type !== 'ff' || w > 20) {
        await p.keyboard.press('Alt+Shift+ArrowRight'); await p.waitForTimeout(60);
        const b3 = box((await all(p))[n - 1]); eq([b3[0], b3[2] - b3[0]], [b2[0], w + 2], id + ' 2 pt wider');
      }
    }
    // the middle of the part of the page in view
    const r = await p.evaluate(() => { const g = document.querySelector('svg.marks [data-id]'), b = g.getBoundingClientRect(), pg = g.closest('.page').getBoundingClientRect(), w = document.querySelector('#viewer').getBoundingClientRect();
      return [Math.round(b.left + b.width / 2 - (pg.left + pg.right) / 2), Math.round(b.top + b.height / 2 - (Math.max(pg.top, w.top) + Math.min(pg.bottom, w.bottom)) / 2)]; });
    ok(Math.abs(r[0]) <= 4 && Math.abs(r[1]) <= 4, 'centred ' + r);
    await p.keyboard.press('Control+z'); await p.waitForTimeout(100); eq((await all(p)).length, n, 'resizing is one undo step');
    eq(p.errors, []); await p.ctx.close();
  });
};
