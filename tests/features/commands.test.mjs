// Where commands live: the File button lists file commands only, and every command in the menus has a ribbon home.
export default async (h) => {
  const { test, eq, ok, open, openPdf } = h;

  await test('commands: the web File button lists the File menu only; every menu command has a home on the ribbon', async () => {
    const p = await open(); await openPdf(p);
    await p.click('#fileBtn'); await p.waitForSelector('#popover:not([hidden])');
    const listed = await p.$$eval('#popover [data-cmd]', (b) => b.map((x) => x.dataset.cmd));
    eq(await p.$$eval('#popover .mh', (e) => e.length), 0, 'no other menus under File');
    const file = await p.evaluate(() => window.__cowdreyPdf.menus().find(([t]) => t === 'File')[1].filter((id) => id !== '-' && window.__cowdreyPdf.cmdShown(id)));
    eq(listed, file);
    for (const id of ['deleteMark', 'vw_attach', 'bmAdd', 'zoom100', 'vw_files', 'pg60_selAll']) ok(!listed.includes(id), id + ' not under File');
    await p.keyboard.press('Escape');
    // every shown command of every menu but File and Help is on a tab, or in the list of a ribbon button's arrow
    const missing = await p.evaluate(() => {
      const H = window.__cowdreyPdf, R = H.ribbon(), C = H.C || {};
      const on = new Set(Object.values(R).flatMap(([, gs]) => gs.flatMap(([, ids]) => Array.isArray(ids) ? ids : [])));
      for (const id of [...on]) for (const x of (H.cmdMenu ? H.cmdMenu(id) : [])) on.add(x);
      return H.menus().filter(([t]) => t !== 'File' && t !== 'Help').flatMap(([t, ids]) => ids.filter((id) => id !== '-' && !/^theme_/.test(id) && H.cmdShown(id) && !on.has(id)).map((id) => t + ':' + id));
    });
    eq(missing, [], 'menu commands with no ribbon home');
    // the new homes
    const at = async (tab, group) => { await p.click(`[data-rt="${tab}"]`); return p.$$eval(`#ribbonBody .r-group[aria-label="${group}"] [data-cmd]`, (b) => b.map((x) => x.dataset.cmd)); };
    ok((await at('edit', 'Edit the PDF')).includes('deleteMark'), 'Delete on Edit');
    ok((await at('home', 'Edit')).includes('bmAdd'), 'Add bookmark on Home');
    const view = await at('home', 'View'); ok(view.indexOf('zoom100') === view.indexOf('zoomPage') + 1, 'Actual size after Fit page: ' + view);
    eq(await at('edit', 'Add'), ['tool_text', 'image', 'vw_attach', 'md_insertMedia'], 'Attach file on Edit (its arrow: Attachments), then Insert video or audio');
    ok((await at('pages', 'View')).includes('pg60_selAll'), 'Select all on Pages');
    // the Mac menus keep them
    const menus = await p.evaluate(() => Object.fromEntries(window.__cowdreyPdf.menus()));
    for (const [t, id] of [['Edit', 'deleteMark'], ['Edit', 'vw_attach'], ['View', 'bmAdd'], ['View', 'zoom100'], ['View', 'vw_files'], ['Pages', 'pg60_selAll']]) ok(menus[t].includes(id), `${id} in ${t}`);
    // Home still fits a laptop screen
    await p.click('[data-rt="home"]');
    ok(await p.$eval('#ribbonBody', (b) => b.scrollWidth <= b.clientWidth + 1), 'Home fits at 1440');
    await p.click('[data-rt="markup"]');
    ok(await p.$eval('#ribbonBody', (b) => b.scrollWidth <= b.clientWidth + 1), 'Comment fits at 1440');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('commands: on a phone, Home keeps View and Read as their own groups', async () => {
    const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p);
    const groups = await p.$$eval('#ribbonBody .r-group', (g) => g.map((x) => x.getAttribute('aria-label')));
    ok(groups.includes('View') && groups.includes('Read'), groups.join());
    await p.ctx.close();
  });

  await test('commands: Comment tab has the four text mark-ups together; Area highlight is with the shapes; Signature in Add', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="markup"]');
    const g = await p.$$eval('#ribbonBody .r-group', (gs) => Object.fromEntries(gs.map((x) => [x.getAttribute('aria-label'), [...x.querySelectorAll('[data-cmd]')].map((b) => b.dataset.cmd)])));
    eq(g['Text mark-up'], ['tool_highlight', 'cm_underline', 'cm_strike', 'cm_squiggly']);
    ok(!g.Tools.includes('tool_highlight'), 'Highlight not in Tools');
    ok(g.Shapes.includes('cm_area'), 'Area highlight in Shapes');
    ok(g.Add.includes('cm_stamp') && g.Add.includes('sign'), 'Signature beside Stamp');
    await p.click('#ribbonBody [data-cmd="sign"]'); await p.waitForSelector('#dialog[open] .sig-modes'); // the same command
    await p.ctx.close();
  });

  await test('commands: Edit PDF chooses lines or paragraphs in its menu (a choice of one, kept); only Edit PDF is pressed', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="edit"]');
    ok(!(await p.$('#ribbonBody [data-cmd="txtParaMode"]')), 'no second paragraphs button');
    const menu = async () => { await p.click('#ribbonBody [data-rmenu="tool_edit"]'); await p.waitForSelector('#popover:not([hidden])'); const r = await p.$$eval('#popover [role="group"] [data-cmd]', (b) => b.map((x) => [x.dataset.cmd, x.getAttribute('role'), x.getAttribute('aria-checked')])); return r; };
    eq(await menu(), [['txtEditLines', 'menuitemradio', 'true'], ['txtEditParas', 'menuitemradio', 'false']]);
    await p.click('#popover [data-cmd="txtEditParas"]'); await p.waitForTimeout(200);
    eq(await p.evaluate(() => document.querySelector('#app').dataset.tool), 'edit', 'Edit PDF is on');
    eq(await p.$$eval('#ribbonBody [aria-pressed="true"]', (b) => b.map((x) => x.dataset.cmd)), ['tool_edit'], 'one tool pressed');
    ok(/paragraph/.test(await p.textContent('#modeChip')), 'the mode chip says paragraphs');
    eq((await menu()).map(([, , c]) => c), ['false', 'true']);
    await p.keyboard.press('Escape');
    // kept for next time
    await p.waitForTimeout(300); await p.reload(); await p.waitForFunction(() => window.__cowdreyPdf && window.__cowdreyPdf.S);
    eq(await p.evaluate(() => !!window.__cowdreyPdf.S.txtPara), true, 'remembered');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('commands: a single line can be aligned in its own box (right, centre), on screen and in the saved PDF', async () => {
    const { reopen, savedOf } = h;
    for (const [align, k] of [['right', 1], ['center', .5]]) {
      const p = await open(); await openPdf(p);
      const items = () => p.evaluate(async () => (await window.__cowdreyPdf.views()[0].page.getTextContent()).items.map((i) => [i.str, i.transform[4], i.width]));
      const [, x0, w0] = (await items()).find(([s]) => s.startsWith('Quarterly report'));
      await p.evaluate(() => window.__cowdreyPdf.run('txtEditLines'));
      const b = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'Quarterly report' }).first().boundingBox();
      await p.mouse.click(b.x + 5, b.y + b.height / 2); await p.waitForSelector('.line-editor'); await p.waitForSelector('.txt-bar');
      await p.click(`.txt-bar [data-tf="${align}"]`);
      eq(await p.$eval('.line-editor', (e) => e.style.textAlign), align, 'the editor shows it');
      await p.$eval('.line-editor', (e) => e.focus()); await p.keyboard.press('Control+a'); await p.keyboard.type('Short'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
      await reopen(p, await savedOf(p));
      const [, x1, w1] = (await items()).find(([s]) => s === 'Short');
      ok(Math.abs((x1 + w1 * k) - (x0 + w0 * k)) < 2, `${align}: ${x1}+${w1} in ${x0}+${w0}`);
      eq(p.errors, []); await p.ctx.close();
    }
  });
};
