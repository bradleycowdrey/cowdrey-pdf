// Interaction flow (loop 5): one row of menus on the web (the ribbon, with File and ?), text mark-up that stays on its
// text, page changes with Undo on a toast, the comment-author toast, the Highlight button, the first-run sidebar,
// Signature and Save PDF in one place each, thumbnails that follow the page, and Organize with the Pages tab.
import os from 'node:os';
export default async (h) => {
  const { test, eq, ok, open, openPdf, path, fs, require, root, selectText, macApp, waitPages, fixture } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
  const marks = (p) => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().filter((m) => m && m.type));
  async function named(n) {
    const d = await L.PDFDocument.create(); const f = await d.embedFont(L.StandardFonts.Helvetica);
    for (let k = 1; k <= n; k++) d.addPage([400, 500]).drawText('P' + k, { x: 50, y: 400, size: 24, font: f });
    const file = path.join(os.tmpdir(), `flow-${n}.pdf`); fs.writeFileSync(file, await d.save()); return file;
  }

  await test('flow: the web shows the ribbon as its only menu row; File and ? reach every menu command; Alt goes to the tabs', async () => {
    const p = await open(); await openPdf(p);
    eq(await p.$eval('#menubar', (e) => getComputedStyle(e).display), 'none', 'no menu bar over the ribbon');
    for (const s of ['#fileBtn', '#helpBtn']) ok(await p.$eval(s, (e) => e.getBoundingClientRect().width > 0), s + ' shown');
    // the ? sits next to the theme button
    eq(await p.$eval('#helpBtn', (b) => b.nextElementSibling.id), 'themeBtn');
    const reach = new Set();
    for (const t of await p.$$eval('#ribbonTabs [data-rt]', (b) => b.map((x) => x.dataset.rt))) {
      await p.click(`[data-rt="${t}"]`);
      for (const id of await p.$$eval('#ribbonBody [data-cmd], #ribbonBody [data-rmenu]', (e) => e.map((x) => x.dataset.cmd || x.dataset.rmenu))) reach.add(id);
      for (const id of await p.$$eval('#ribbonBody [data-rmenu]', (e) => e.map((x) => x.dataset.rmenu))) {
        await p.click(`#ribbonBody [data-rmenu="${id}"]`); await p.waitForTimeout(50);
        (await p.$$eval('#popover [data-cmd]', (e) => e.map((x) => x.dataset.cmd))).forEach((x) => reach.add(x));
        await p.keyboard.press('Escape');
      }
    }
    for (const b of ['#fileBtn', '#helpBtn']) {
      await p.click(b); await p.waitForSelector('#popover:not([hidden])');
      (await p.$$eval('#popover [data-cmd]', (e) => e.map((x) => x.dataset.cmd))).forEach((x) => reach.add(x));
      await p.keyboard.press('Escape');
    }
    const help = await (async () => { await p.click('#helpBtn'); const l = await p.$$eval('#popover [data-cmd]', (e) => e.map((x) => x.dataset.cmd)); await p.keyboard.press('Escape'); return l; })();
    eq(help, ['sample', 'shortcuts', 'legal', 'about'], 'Help items under ?');
    const all = await p.evaluate(() => window.__cowdreyPdf.menus().flatMap(([, ids]) => ids).filter((id) => id !== '-' && !/^theme_/.test(id)));
    const hidden = await p.evaluate((ids) => ids.filter((id) => !window.__cowdreyPdf.cmdShown(id)), all);
    eq(all.filter((id) => !reach.has(id) && !hidden.includes(id)), [], 'menu commands the ribbon cannot reach');
    for (const id of ['openRecent', 'closeDoc', 'print', 'docProps']) ok(reach.has(id), id);
    // Alt (alone) and F10 move to the tab row
    await p.focus('#viewer'); await p.keyboard.press('F10');
    eq(await p.evaluate(() => document.activeElement.getAttribute('role')), 'tab');
    eq(p.errors, []); await p.ctx.close();
    // the Mac app: the macOS menu bar has the menus, so no File or ? in the window
    const m = await open({ init: macApp({ files: [{ name: 'Report.pdf', path: '/Users/me/Report.pdf', content: fixture('sample.pdf') }] }) });
    await waitPages(m); await m.waitForTimeout(400);
    eq(await m.$eval('#fileBtn', (e) => getComputedStyle(e).display), 'none', 'Mac: no File button');
    eq(await m.$eval('#helpBtn', (e) => getComputedStyle(e).display), 'none', 'Mac: no ? button');
    await m.ctx.close();
  });

  await test('flow: File > Close leaves Open a PDF with the file in Recent; Open recent shows the list', async () => {
    const p = await open(); await openPdf(p);
    await p.click('#fileBtn'); await p.click('#popover [data-cmd="closeDoc"]'); await p.waitForTimeout(500);
    eq(await p.evaluate(() => window.__cowdreyPdf.doc), null, 'closed');
    ok(await p.$eval('#drop', (e) => !e.hidden), 'Open a PDF shown');
    eq(await p.$eval('[data-side="docs"]', (e) => e.getAttribute('aria-selected')), 'true', 'sidebar: Recent');
    await p.waitForSelector('#sidePanel .doc-item'); ok((await p.textContent('#sidePanel')).includes('Quarterly report'), 'kept in Recent');
    eq(await p.evaluate(() => window.__cowdreyPdf.cmdEnabled('closeDoc')), false, 'nothing to close');
    await p.click('#sidePanel .doc-open'); await p.waitForSelector('.page canvas.pdf'); await p.waitForTimeout(300);
    eq(await p.$eval('[data-side="thumbs"]', (e) => e.getAttribute('aria-selected')), 'true', 'Pages again');
    await p.click('[data-side="outline"]'); await run(p, 'openRecent'); await p.waitForTimeout(200);
    eq(await p.$eval('[data-side="docs"]', (e) => e.getAttribute('aria-selected')), 'true', 'Open recent');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('flow: text mark-up stays on its text: a drag over it selects text; a click selects it; arrows and dragging never move it', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="markup"]'); await p.click('[data-cmd="tool_highlight"]');
    await selectText(p, 0, 'Cowdrey.PDF opens', 1); await p.waitForTimeout(200);
    await p.click('[data-cmd="tool_select"]');
    const hl0 = JSON.stringify((await marks(p))[0].rects);
    // a drag across the highlight: the page's text is selected, the highlight stays
    const s = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'Cowdrey.PDF opens' }).first().boundingBox();
    await p.mouse.move(s.x + 4, s.y + s.height / 2); await p.mouse.down(); await p.mouse.move(s.x + s.width * .6, s.y + s.height / 2, { steps: 6 }); await p.mouse.up();
    await p.waitForTimeout(200);
    eq(JSON.stringify((await marks(p))[0].rects), hl0, 'not moved');
    ok((await p.evaluate(() => String(getSelection()).length)) > 5, 'text selected');
    eq(await p.evaluate(() => window.__cowdreyPdf.cmdLabel('undo')), 'Undo Highlight', 'no Move in the undo list');
    // a click on it selects it; the arrows don't move it; the colour and Delete work on it
    await p.evaluate(() => getSelection().removeAllRanges());
    await p.mouse.click(s.x + s.width * .3, s.y + s.height / 2); await p.waitForTimeout(150);
    ok(await p.$('.page[data-n="0"] .mk-ontext.sel'), 'selected');
    await p.keyboard.press('ArrowRight'); await p.keyboard.press('Shift+ArrowDown'); await p.waitForTimeout(100);
    eq(JSON.stringify((await marks(p))[0].rects), hl0, 'arrows leave it');
    await p.click('#ribbonBody [data-color="#69DB7C"]'); eq((await marks(p))[0].color, '#69DB7C', 'recoloured');
    // a click on plain text lets it go; right-click on it gives its menu
    await p.mouse.click(s.x + 4, s.y + 60); await p.waitForTimeout(100);
    ok(!(await p.$('.mk-ontext.sel')), 'let go');
    await p.mouse.click(s.x + s.width * .3, s.y + s.height / 2, { button: 'right' }); await p.waitForSelector('#popover:not([hidden])');
    ok((await p.textContent('#popover')).includes('Delete'), 'its menu');
    await p.keyboard.press('Escape');
    await p.keyboard.press('Delete'); eq((await marks(p)).length, 0, 'deleted');
    // an underline made on text stays too
    await selectText(p, 0, 'Cowdrey.PDF opens', 1); await run(p, 'cm_underline'); await p.waitForTimeout(150);
    const q0 = JSON.stringify((await marks(p))[0].quads);
    await p.evaluate(() => getSelection().removeAllRanges());
    await p.mouse.move(s.x + 10, s.y + s.height - 2); await p.mouse.down(); await p.mouse.move(s.x + 120, s.y + s.height - 2, { steps: 5 }); await p.mouse.up();
    eq(JSON.stringify((await marks(p))[0].quads), q0, 'underline not moved');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('flow: deleting, moving and duplicating a page shows a toast with Undo', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="pages"]'); await p.click('#ribbonBody [data-cmd="delPage"]'); await p.waitForTimeout(300);
    eq(await p.textContent('#toast'), 'Page 1 deleted Undo');
    ok(await p.$eval('#toast', (t) => t.classList.contains('show') && getComputedStyle(t).opacity !== '0'), 'shown');
    eq(await p.$$eval('.page', (e) => e.length), 2);
    await p.click('#toast .toast-act'); await p.waitForTimeout(400);
    eq(await p.$$eval('.page', (e) => e.length), 3, 'Undo on the toast');
    await p.click('#ribbonBody [data-cmd="down"]'); await p.waitForTimeout(300);
    eq(await p.textContent('#toast'), 'Page 1 moved to 2 Undo');
    await p.click('#ribbonBody [data-cmd="dup"]'); await p.waitForTimeout(300);
    eq(await p.textContent('#toast'), 'Page 2 duplicated Undo');
    // Undo on an old toast doesn't undo a later change
    const old = await p.$('#toast .toast-act');
    await p.evaluate(() => window.__cowdreyPdf.run('rotR')); await p.waitForTimeout(300);
    await old.evaluate((b) => b.click()); await p.waitForTimeout(300);
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.map((e) => e.rot).filter(Boolean)), [90], 'the later rotation is not taken back by the old Undo');
    eq(await p.$$eval('.page', (e) => e.length), 4);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('flow: the comment-author toast is for comments only, once, and waits for a dialog to close', async () => {
    const p = await open({ askName: true }); await openPdf(p);
    const said = () => p.evaluate(() => { const t = document.querySelector('#toast'); return t.classList.contains('show') ? t.textContent : ''; });
    // a text box is not a comment
    await p.click('[data-rt="edit"]'); await p.click('[data-cmd="tool_text"]');
    const g = await p.locator('.page[data-n="0"]').boundingBox();
    await p.mouse.click(g.x + 100, g.y + 620); await p.waitForSelector('.page .txt-editor'); await p.keyboard.type('Hi'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok(!(await said()).includes('No name'), 'no toast for a text box: ' + await said());
    // a highlight made while a dialog is open: the toast waits
    await p.evaluate(() => { window.__cowdreyPdf.run('about'); });
    await p.waitForSelector('#dialog[open]');
    await p.evaluate(() => { const s = document.querySelector('.page[data-n="0"] .textLayer span'); const r = document.createRange(); r.selectNodeContents(s); getSelection().removeAllRanges(); getSelection().addRange(r); window.__cowdreyPdf.highlightSelection(); });
    await p.waitForTimeout(200);
    ok(!(await said()).includes('No name'), 'not over the dialog');
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    eq(await said(), 'Your comments show as "No name". Set your name in the Comments panel.');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('flow: Highlight highlights the selection and keeps the tool in use, else turns on; its tooltip says so', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="markup"]');
    ok(/selected text/.test(await p.$eval('#ribbonBody [data-cmd="tool_highlight"]', (b) => b.title)), 'tooltip');
    ok(/selected text/.test(await p.$eval('#ribbonBody [data-cmd="cm_underline"]', (b) => b.title)), 'Underline tooltip too');
    await selectText(p, 0, 'Cowdrey.PDF opens', 1);
    await p.click('#ribbonBody [data-cmd="tool_highlight"]'); await p.waitForTimeout(150);
    eq((await marks(p)).map((m) => m.type), ['hl'], 'highlighted');
    eq(await p.evaluate(() => document.querySelector('#app').dataset.tool), 'select', 'tool kept');
    await p.click('#ribbonBody [data-cmd="tool_highlight"]'); await p.waitForTimeout(100);
    eq(await p.evaluate(() => document.querySelector('#app').dataset.tool), 'highlight', 'no selection: the tool turns on');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('flow: before any file, the sidebar shows Recent; the last tab comes back with a document', async () => {
    const p = await open(); await p.waitForTimeout(500);
    eq(await p.$eval('[data-side="docs"]', (e) => e.getAttribute('aria-selected')), 'true');
    ok((await p.textContent('#sidePanel')).includes('No recent PDFs yet'), await p.textContent('#sidePanel'));
    await openPdf(p);
    eq(await p.$eval('[data-side="thumbs"]', (e) => e.getAttribute('aria-selected')), 'true', 'Pages with the document');
    eq(await p.$$eval('#sidePanel .thumb', (e) => e.length), 3);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('flow: Signature is on Protect only; Save PDF is in the title bar, not again on Home or Export', async () => {
    const p = await open(); await openPdf(p);
    const tab = async (t) => { await p.click(`[data-rt="${t}"]`); return p.$$eval('#ribbonBody [data-cmd]', (e) => e.map((x) => x.dataset.cmd)); };
    ok(!(await tab('markup')).includes('sign'), 'not on Comment');
    ok((await tab('protect')).includes('sign'), 'on Protect');
    ok(!(await tab('home')).includes('save'), 'not on Home');
    ok(!(await tab('export')).includes('save'), 'not on Export');
    eq(await p.evaluate(() => window.__cowdreyPdf.menus().filter(([, ids]) => ids.includes('sign')).map(([t]) => t)), ['Protect']);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('flow: the sidebar keeps the page in view in view; Organize opens with the Pages tab and Done goes back', async () => {
    const p = await open(); await openPdf(p, await named(30), 'Thirty.pdf');
    const inView = (n) => p.evaluate((n) => { const t = document.querySelector(`#sidePanel .thumb[data-n="${n}"]`), s = document.querySelector('#sidePanel').getBoundingClientRect(), r = t.getBoundingClientRect(); return r.top >= s.top - 1 && r.bottom <= s.bottom + 1; }, n);
    await p.mouse.move(800, 500);
    await p.fill('#pageJump', '25'); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
    ok(await inView(24), 'thumbnail 25 in view');
    await p.focus('#viewer'); await p.keyboard.press('Home'); await p.waitForTimeout(1200);
    ok(await inView(0), 'back at the top');
    // Organize: the Pages tab; Done: Home again
    eq(await p.evaluate(() => window.__cowdreyPdf.S.ribbon), 'home');
    await run(p, 'pg60_organize'); await p.waitForTimeout(300);
    eq(await p.$eval('#ribbonTabs [aria-selected="true"]', (b) => b.dataset.rt), 'pages', 'Pages tab');
    await p.click('[data-org-done]'); await p.waitForTimeout(300);
    eq(await p.$eval('#ribbonTabs [aria-selected="true"]', (b) => b.dataset.rt), 'home', 'back to Home');
    eq(p.errors, []); await p.ctx.close();
  });
};
