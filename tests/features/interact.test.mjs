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

};
