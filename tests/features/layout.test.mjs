// Layout, organize and labels: the sidebar tabs, the phone title bar and mode chip, Organize, the contextual
// Picture group, Fill in, Combine, menus, announcements and landmarks.
export default async (h) => {
  const { test, eq, ok, open, openPdf } = h;
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id).then(() => p.waitForTimeout(200));
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

  await test('layout: the four sidebar tabs sit in one row, named by tooltip and for screen readers; a phone shows the names too', async () => {
    const p = await open(); await openPdf(p);
    const tabs = await p.$$eval('.side-tabs [data-side]', (b) => b.map((x) => { const r = x.getBoundingClientRect(); return { side: x.dataset.side, top: Math.round(r.top), h: r.height, title: x.title, name: x.textContent.trim(), icon: !!x.querySelector('svg') }; }));
    eq(tabs.map((t) => t.side), ['thumbs', 'outline', 'docs', 'comments']);
    eq(new Set(tabs.map((t) => t.top)).size, 1, 'one row: ' + JSON.stringify(tabs));
    eq(tabs.map((t) => [t.title, t.name, t.icon]), [['Pages', 'Pages', true], ['Outline', 'Outline', true], ['Recent', 'Recent', true], ['Comments', 'Comments', true]]);
    ok(tabs.every((t) => t.h <= 44), 'short tabs');
    eq(await p.$eval('.side-tabs [data-side="comments"]', (b) => b.getAttribute('aria-controls')), 'sidePanel');
    await p.ctx.close();
    const q = await open({ width: 390, height: 844, touch: true }); await openPdf(q);
    await q.tap('.statusbar .sb-pages'); await q.waitForTimeout(400);
    const ph = await q.$$eval('.side-tabs [data-side]', (b) => b.map((x) => { const s = x.querySelector('span'), r = x.getBoundingClientRect(); return [Math.round(r.top), s.getBoundingClientRect().width > 20, s.scrollWidth <= s.clientWidth + 1]; }));
    eq(new Set(ph.map((x) => x[0])).size, 1, 'one row on a phone'); ok(ph.every((x) => x[1] && x[2]), 'names shown in full: ' + JSON.stringify(ph));
    await q.ctx.close();
  });

  await test('layout: a phone title bar gives the name its room, cutting the middle (the whole name is the tooltip); the mode chip names the tool', async () => {
    const p = await open({ width: 390, height: 844, touch: true, ua: IPHONE }); await openPdf(p, undefined, 'pdfelement-guide.pdf');
    eq(await p.textContent('#docTitle'), 'pdfelement-guide'); eq(await p.getAttribute('#docTitle', 'title'), 'pdfelement-guide');
    eq(await p.$eval('#docTitle', (e) => e.tagName), 'H1');
    const t = await p.$eval('#docTitle', (e) => [e.getBoundingClientRect().width, e.querySelector('.dt-b').textContent, e.querySelector('.dt-b').getBoundingClientRect().width > 20]);
    ok(t[0] >= 110, 'the name has room: ' + t[0]); eq(t.slice(1), ['-guide', true], 'the end of the name stays');
    await run(p, 'tool_edit'); await p.waitForTimeout(100);
    const chip = await p.$eval('#modeChip', (c) => { const n = c.querySelector('.mode-name'), m = c.querySelector('.mode-text'); return [n.textContent, n.scrollWidth <= m.clientWidth + 1, c.querySelector('.mode-hint').getBoundingClientRect().width <= 1]; });
    eq(chip, ['Edit PDF', true, true], 'the chip shows the name in full');
    ok(/^Edit PDF: tap text/.test(await p.textContent('#modeChip .mode-text')), 'the hint is still read out');
    ok(/^Tap text/.test(await p.textContent('#toast')), 'and shown once as a toast: ' + await p.textContent('#toast'));
    await p.ctx.close();
    const d = await open(); await openPdf(d, undefined, 'A rather long quarterly report name.pdf');
    eq(await d.$eval('#docTitle', (e) => e.scrollWidth <= e.clientWidth + 1), true, 'a wide window shows it whole');
    await run(d, 'tool_edit');
    ok(await d.$eval('#modeChip .mode-hint', (e) => e.getBoundingClientRect().width > 100), 'the hint shows on a wide window');
    await d.ctx.close();
  });

  const PAGE_MENU = ['Rotate left', 'Rotate right', '-', 'Insert blank page before', 'Insert blank page after', 'Insert from PDF…', 'Replace pages…', '-', 'Duplicate page', 'Extract pages…', 'Crop margins…', '-', 'Move page up', 'Move page down', 'Move to start', 'Move to end', '-', 'Delete page'];
  const menuItems = (p) => p.$$eval('#popover > *', (e) => e.map((x) => x.classList.contains('msep') ? '-' : x.querySelector('span').textContent));
  await test('layout: Organize hides the sidebar, its bar has Select all and a plain Done (the ribbon has the rest); Done goes back', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="pages"]'); await p.click('#ribbonBody [data-cmd="pg60_organize"]'); await p.waitForTimeout(500);
    eq(await p.$eval('#sidebar', (e) => [getComputedStyle(e).visibility, e.getBoundingClientRect().width <= 1]), ['hidden', true], 'sidebar out of the way');
    ok(await p.$eval('#pg60Org', (e) => e.getBoundingClientRect().left < 10), 'the grid starts at the left edge');
    eq(await p.$$eval('.pg60-org-bar button', (b) => b.map((x) => [x.textContent.trim(), x.classList.contains('primary')])), [['Select all', false], ['Done', false]]);
    await p.click('.pg60-org-bar [data-org-done]'); await p.waitForTimeout(300);
    ok(await p.$eval('#pg60Org', (e) => e.hidden), 'Done goes back');
    eq(await p.$eval('#sidebar', (e) => getComputedStyle(e).visibility), 'visible', 'the sidebar is back');
    eq(await p.evaluate(() => window.__cowdreyPdf.S.sidebar), true, 'the setting is untouched');
    await p.ctx.close();
  });

  await test('layout: a page\'s right-click menu (sidebar and Organize, mouse or Shift+F10) has the page commands, and they work on that page', async () => {
    const p = await open(); await openPdf(p);
    const texts = () => p.evaluate(async () => { const c = window.__cowdreyPdf.doc; return c.pages.map((e) => `${e.src}:${e.i}`); });
    await p.click('#sidePanel .thumb[data-n="1"]', { button: 'right' }); await p.waitForSelector('#popover:not([hidden])');
    eq(await menuItems(p), PAGE_MENU, 'sidebar');
    await p.click('#popover .mi:has-text("Move to end")'); await p.waitForTimeout(500);
    eq(await texts(p), ['0:0', '0:2', '0:1'], 'moved to the end');
    await p.click('#sidePanel .thumb[data-n="2"]', { button: 'right' }); await p.click('#popover .mi:has-text("Move to start")'); await p.waitForTimeout(500);
    eq(await texts(p), ['0:1', '0:0', '0:2'], 'moved to the start');
    await p.click('[data-rt="pages"]'); await p.click('#ribbonBody [data-cmd="pg60_organize"]'); await p.waitForTimeout(500);
    await p.focus('.pg60-cell[data-n="2"]'); await p.keyboard.press('Shift+F10'); await p.waitForSelector('#popover:not([hidden])');
    eq(await menuItems(p), PAGE_MENU, 'Organize, from the keyboard');
    await p.click('#popover .mi:has-text("Insert blank page before")');
    await p.waitForFunction(() => window.__cowdreyPdf.doc.pages.length === 4, null, { timeout: 10000 }); await p.waitForTimeout(300);
    const pages = await p.evaluate(() => window.__cowdreyPdf.doc.pages.map((e) => e.src));
    eq(pages, [0, 0, 1, 0], 'a blank page before page 3'); await p.waitForTimeout(600); // the grid is drawn again
    await p.click('.pg60-cell[data-n="0"]', { button: 'right' }); await p.click('#popover .mi:has-text("Insert blank page after")');
    await p.waitForFunction(() => window.__cowdreyPdf.doc.pages.length === 5, null, { timeout: 10000 });
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.map((e) => e.src > 0)), [false, true, false, true, false], 'and one after page 1');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('layout: the Picture group is tinted as a context group and scrolls into view, whole, when a picture is chosen', async () => {
    for (const o of [{}, { width: 1100, height: 900 }]) {
      const p = await open(o); await openPdf(p, h.WORD, 'Pelican report.pdf');
      await p.click('[data-rt="edit"]'); await run(p, 'tool_edit');
      const [cx, cy] = await p.evaluate(([x, y]) => { const v = window.__cowdreyPdf.views()[0]; const [vx, vy] = v.viewport.convertToViewportPoint(x, y); const r = v.el.getBoundingClientRect(); return [r.left + vx, r.top + vy]; }, [460, 480]);
      await p.mouse.click(cx, cy); await p.waitForTimeout(900);
      const g = await p.$eval('#ribbonBody [data-cmd="picRotL"]', (b) => { const g = b.closest('.r-group'), r = g.getBoundingClientRect(), row = document.querySelector('#ribbonBody').getBoundingClientRect(); return [g.hidden, g.classList.contains('r-ctx'), r.left >= row.left - 1 && r.right <= row.right + 1]; });
      eq(g, [false, true, true], `shown, tinted and in view at ${o.width || 1440}px`);
      await p.ctx.close();
    }
  });

  await test('layout: Fill in has its own icon and is pressed only once chosen; pressed, it goes back to Edit fields', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="forms"]');
    const icon = (id) => p.$eval(`#ribbonBody [data-cmd="${id}"] svg`, (s) => s.getAttribute('class'));
    const fill = await icon('ffPreview'); await p.click('[data-rt="edit"]'); const edit = await icon('tool_edit'); await p.click('[data-rt="forms"]');
    ok(fill !== edit && /pencil-line/.test(fill), `not the Edit PDF icon: ${fill} / ${edit}`);
    eq(await p.getAttribute('#ribbonBody [data-cmd="ffPreview"]', 'aria-pressed'), 'false', 'not pressed when the tab opens');
    await p.click('#ribbonBody [data-cmd="ffPreview"]'); await p.waitForTimeout(150);
    eq([await p.getAttribute('#ribbonBody [data-cmd="ffPreview"]', 'aria-pressed'), await p.evaluate(() => document.querySelector('#app').dataset.tool)], ['true', 'select'], 'chosen: fill in');
    await p.click('#ribbonBody [data-cmd="ffPreview"]'); await p.waitForTimeout(150);
    eq([await p.getAttribute('#ribbonBody [data-cmd="ffPreview"]', 'aria-pressed'), await p.evaluate(() => document.querySelector('#app').dataset.tool)], ['false', 'ff_edit'], 'pressed again: Edit fields');
    await p.click('[data-rt="home"]'); await p.click('[data-rt="forms"]');
    eq(await p.getAttribute('#ribbonBody [data-cmd="ffPreview"]', 'aria-pressed'), 'false', 'not pressed on coming back');
    await p.ctx.close();
  });

  await test('layout: Combine is on Home (File, next to Open) and on the Pages tab next to Insert, and both fit at 1440', async () => {
    const p = await open(); await openPdf(p);
    for (const [tab, before] of [['home', 'open'], ['pages', null]]) {
      await p.click(`[data-rt="${tab}"]`);
      const r = await p.$eval('#ribbonBody [data-cmd="merge"]', (b) => [b.querySelector('span').textContent, b.closest('.r-group').getAttribute('aria-label'), b.getBoundingClientRect().right <= document.querySelector('#ribbonBody').getBoundingClientRect().right]);
      eq(r, ['Combine', tab === 'home' ? 'File' : 'Insert', true], tab);
      if (before) eq(await p.$eval('#ribbonBody [data-cmd="merge"]', (b) => b.previousElementSibling.dataset.cmd), before);
    }
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#ribbonBody [data-cmd="merge"]')]);
    ok(fc.isMultiple(), 'asks for several PDFs');
    await p.ctx.close();
  });
};
