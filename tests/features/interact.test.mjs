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
};
