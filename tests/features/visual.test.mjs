// The look across screens: ribbon labels and reach (wheel, scroll arrows, selection groups last), menus with their
// icons, one segmented control and one colour picker, the folded phone Comment tab, phone fields big enough that iOS
// does not zoom, forced colours, the read-aloud bar, and touch-only menus and words.
export default async (h) => {
  const { test, eq, ok, open, openPdf, WORD } = h;
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id).then(() => p.waitForTimeout(200));
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  const phone = () => open({ width: 390, height: 844, touch: true, ua: IPHONE });
  // A ribbon button's label is cut off when its text is taller or wider than the box shows.
  const clipped = (p) => p.$$eval('#ribbonBody .r-group:not([hidden]) .rb > span', (s) => s.filter((x) => x.scrollHeight > x.clientHeight + 1 || x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent));
  const menuRows = (p) => p.$$eval('#popover .mi', (m) => m.map((x) => [x.dataset.cmd || x.textContent, !!x.querySelector(':scope > svg:not(.lucide-check)'), x.getAttribute('aria-checked')]));

  await test('visual: the Export tab has short labels that fit and no two neighbours with the same icon', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="export"]'); await p.waitForTimeout(100);
    eq(await clipped(p), []);
    const icons = await p.$$eval('#ribbonBody .r-group:not([hidden]) .rb', (b) => b.map((x) => x.querySelector('svg').getAttribute('class')));
    for (let i = 1; i < icons.length; i++) ok(icons[i] !== icons[i - 1], 'same icon side by side: ' + icons[i]);
    eq(await p.$$eval('#ribbonBody [data-cmd="exportImage"] span, #ribbonBody [data-cmd="crdExportPages"] span', (s) => s.map((x) => x.textContent)), ['Page as picture', 'All pages as pictures']);
    await p.ctx.close();
  });

  await test('visual: at 1024 px a mouse wheel and the edge arrows reach the end of the Comment tab; selection groups come last', async () => {
    const p = await open({ width: 1024, height: 768 }); await openPdf(p);
    await p.click('[data-rt="markup"]'); await p.waitForTimeout(100);
    const body = () => p.$eval('#ribbonBody', (b) => [Math.round(b.scrollLeft), b.scrollWidth - b.clientWidth]);
    ok((await body())[1] > 0, 'the tab is wider than the window here');
    const arrows = () => p.$$eval('.r-scroll', (a) => a.map((x) => getComputedStyle(x).display !== 'none'));
    eq(await arrows(), [false, true], 'an arrow at the right edge only');
    await p.mouse.move(500, 120); await p.mouse.wheel(0, 300); await p.waitForTimeout(150);
    ok((await body())[0] > 0, 'the wheel scrolled the ribbon sideways');
    eq(await p.evaluate(() => document.querySelector('#viewer').scrollTop), 0, 'and not the pages');
    await p.mouse.wheel(0, 3000); await p.waitForTimeout(150);
    const [l, max] = await body(); ok(l >= max - 1, `at the end: ${l} of ${max}`);
    eq(await arrows(), [true, false], 'the left arrow now');
    for (const id of ['cm_stamp', 'cm_list']) ok(await p.$eval(`#ribbonBody [data-cmd="${id}"]`, (b) => b.getBoundingClientRect().right <= innerWidth), id + ' in view');
    await p.click('.r-scroll-l'); await p.waitForTimeout(600);
    ok((await body())[0] < l, 'the left arrow scrolls back');
    // Picture tools (for a selected picture) are the last group of the Edit tab, so they never move the others
    await p.click('[data-rt="edit"]'); await p.waitForTimeout(100);
    const groups = await p.$$eval('#ribbonBody .r-group', (g) => g.map((x) => x.getAttribute('aria-label')));
    eq(groups[groups.length - 1], 'Picture', groups.join());
    eq(p.errors, []); await p.ctx.close();
  });

  await test('visual: every menu row keeps its icon; toggles show their check in a column of its own', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="markup"]'); await p.click('[data-cmd="tool_highlight"]');
    await p.evaluate(() => window.__cowdreyPdf.openMenu('Comment')); await p.waitForTimeout(100);
    const rows = await menuRows(p);
    eq(rows.filter(([, icon]) => !icon).map(([id]) => id), [], 'rows without an icon');
    eq(rows.filter(([, , c]) => c === 'true').map(([id]) => id), ['tool_highlight']);
    ok(await p.$eval('#popover', (x) => x.classList.contains('has-chk')), 'check column shown');
    const [chk, icon] = await p.$eval('#popover [data-cmd="tool_highlight"]', (b) => [b.querySelector('.mchk').getBoundingClientRect().left, b.querySelector(':scope > svg').getBoundingClientRect().left]);
    ok(chk < icon, 'the check comes before the icon');
    await p.keyboard.press('Escape');
    // a menu with no toggle has no empty check column
    await p.click('#fileBtn'); await p.waitForTimeout(100);
    ok(!(await p.$eval('#popover', (x) => x.classList.contains('has-chk'))), 'no check column in File');
    eq((await menuRows(p)).filter(([, icon]) => !icon).map(([id]) => id), []);
    // menu order: Pages groups its jobs, Bookmarks is in View
    await p.keyboard.press('Escape');
    eq(await p.evaluate(() => window.__cowdreyPdf.menus().map(([t]) => t)), ['File', 'Edit', 'View', 'Comment', 'Pages', 'Forms', 'Protect', 'Help']);
    const ids = (t) => p.evaluate((x) => window.__cowdreyPdf.menus().find(([m]) => m === x)[1], t);
    const pages = await ids('Pages');
    ok(pages.indexOf('rotAll') < pages.indexOf('pg60_rotate') && pages.indexOf('pg60_rotate') < pages.indexOf('up'), pages.join());
    ok(!pages.includes('bmAdd') && (await ids('View')).includes('bmAdd'), 'Add bookmark is in View');
    const cm = await ids('Comment');
    ok(cm.indexOf('tool_rect') + 1 === cm.indexOf('cm_oval'), 'Rectangle next to Oval');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('visual: one segmented control (sidebar, signature, watermark) and one colour picker (format bar, page design, Comment tab)', async () => {
    const p = await open(); await openPdf(p);
    const look = (sel) => p.$eval(sel, (e) => { const s = getComputedStyle(e); return [e.classList.contains('seg'), s.backgroundColor, s.borderRadius, s.padding]; });
    const side = await look('.side-tabs');
    await run(p, 'pd_watermark'); await p.waitForSelector('#dialog[open] .pd-seg');
    eq(await look('#dialog .pd-seg'), side, 'watermark Text/Picture');
    const chosen = (sel) => p.$eval(sel, (e) => getComputedStyle(e).backgroundColor);
    eq(await chosen('#dialog .pd-seg label:has(input:checked)'), await chosen('.side-tabs [aria-selected="true"]'), 'chosen segment');
    // the colour is a row of named swatches with a + for any other colour
    eq(await p.$$eval('#dialog .sw-row [data-pdc]', (b) => b.map((x) => x.getAttribute('aria-label'))), ['Black', 'Grey', 'Red', 'Blue', 'Green', 'Orange']);
    eq(await p.$eval('#dialog .sw-row [data-pdc][aria-pressed="true"]', (b) => b.getAttribute('aria-label')), 'Red');
    await p.click('#dialog [data-pdc][data-c="#2448C9"]');
    eq(await p.$eval('#dialog input[type="color"][data-k="color"]', (i) => i.value), '#2448c9');
    eq(await p.$eval('#dialog .sw-row [data-pdc][aria-pressed="true"]', (b) => b.getAttribute('aria-label')), 'Blue');
    ok(await p.$('#dialog .sw-row .sw-more input[type="color"]'), 'custom colour');
    await p.click('#dialog .btn.primary'); await p.waitForTimeout(300);
    eq(await p.evaluate(() => window.__cowdreyPdf.docMarks().find((m) => m.type === 'pd_watermark').color), '#2448c9', 'the watermark takes it');
    await run(p, 'sign'); await p.waitForSelector('#dialog[open] .sig-modes');
    eq(await look('#dialog .sig-modes'), side, 'signature Draw/Type/Picture');
    await p.keyboard.press('Escape');
    // the Comment tab: the same swatches, and + (8 in a 4 x 2 grid)
    await p.click('[data-rt="markup"]');
    eq(await p.$$eval('#ribbonBody .r-swatches .r-items > *', (e) => e.length), 8);
    await p.$eval('#ribbonBody [data-colorpick]', (i) => { i.value = '#123456'; i.dispatchEvent(new Event('change', { bubbles: true })); });
    eq(await p.evaluate(() => window.__cowdreyPdf.S.toolColor.highlight), '#123456', 'custom colour for the tool');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('visual: on a phone the Comment tab is about 1.5 screens wide: Style holds colour, width and fill; Shapes is a split button', async () => {
    const p = await phone(); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.click('[data-rt="markup"]'); await p.waitForTimeout(150);
    const [sw, cw] = await p.$eval('#ribbonBody', (b) => [b.scrollWidth, b.clientWidth]);
    ok(sw <= cw * 1.6, `${sw} wide in ${cw}`);
    eq(await p.$$eval('#ribbonBody .swatch', (e) => e.length), 0, 'no swatches on the ribbon itself');
    // Style: colours as 32 px menu items, then line width and fill
    await p.click('#ribbonBody [data-rmenu="fold:Style"]'); await p.waitForSelector('#popover:not([hidden]) .pop-sw');
    const sizes = await p.$$eval('#popover .pop-sw .swatch', (s) => s.map((x) => Math.round(x.getBoundingClientRect().width)));
    ok(sizes.length === 8 && sizes.every((w) => w >= 32), sizes.join());
    eq(await p.evaluate(() => document.activeElement.getAttribute('aria-checked')), 'true', 'focus on the chosen colour');
    await p.click('#popover [data-color="#E03131"]');
    eq(await p.$eval('#popover [data-color="#E03131"]', (b) => b.getAttribute('aria-checked')), 'true');
    ok(await p.$('#popover [data-cmd="cm_w4"]') && await p.$('#popover [data-cmd="cm_fill"]'), 'width and fill');
    await p.click('#popover [data-cmd="cm_w4"]'); await p.waitForTimeout(100);
    eq(await p.evaluate(() => window.__cowdreyPdf.S.width), 4);
    // Shapes: the face draws a rectangle; the arrow lists every shape; the face follows the shape chosen
    await p.click('#ribbonBody [data-cmd="fold:Shapes"]');
    eq(await p.$eval('#app', (a) => a.dataset.tool), 'rect');
    await p.click('#ribbonBody [data-rmenu="fold:Shapes"]'); await p.waitForSelector('#popover:not([hidden])');
    eq(await p.$$eval('#popover .mi', (m) => m.map((x) => x.dataset.cmd)), ['tool_rect', 'cm_line', 'cm_oval', 'cm_arrow', 'cm_cloud', 'cm_polyline', 'cm_polygon']);
    await p.click('#popover [data-cmd="cm_oval"]'); await p.waitForTimeout(150);
    eq(await p.$eval('#ribbonBody [data-cmd="fold:Shapes"]', (b) => [b.textContent, b.getAttribute('aria-pressed')]), ['Oval', 'true']);
    // the other small groups are one button each, which shows when one of its tools is on
    await run(p, 'cm_underline');
    ok(await p.$eval('#ribbonBody [data-rmenu="fold:Text mark-up"]', (b) => b.hasAttribute('data-on')), 'Text mark-up on');
    await p.click('#ribbonBody [data-rmenu="fold:Add"]'); await p.waitForSelector('#popover:not([hidden])');
    eq(await p.$$eval('#popover .mi', (m) => m.map((x) => x.dataset.cmd)), ['cm_callout', 'cm_typewriter', 'cm_stamp']);
    await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr3/fix-visual/ph-comment-add.png' });
    eq(p.errors, []); await p.ctx.close();
  });

  await test('visual: phone fields are 16 px or more, so iOS never zooms in (page box, find, dialogs, format bar, read-aloud)', async () => {
    const p = await phone(); await openPdf(p, WORD, 'Pelican report.pdf');
    const small = (sel) => p.$$eval(sel, (e) => e.filter((x) => x.offsetParent && parseFloat(getComputedStyle(x).fontSize) < 16).map((x) => x.outerHTML.slice(0, 60)));
    const fields = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]), select, textarea';
    eq(await small('#pageJump'), []);
    await p.evaluate(() => window.__cowdreyPdf.run('find')); await p.waitForTimeout(150); eq(await small('#findInput'), []);
    await p.keyboard.press('Escape');
    await run(p, 'pd_watermark'); await p.waitForSelector('#dialog[open]');
    eq(await small(`#dialog :is(${fields})`), []); await p.keyboard.press('Escape');
    await run(p, 'docProps'); await p.waitForSelector('#dialog[open]');
    eq(await small(`#dialog :is(${fields})`), []); await p.keyboard.press('Escape');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('visual: forced colours keep the swatch colours and outline what is pressed, chosen or current', async () => {
    const p = await open(); await p.emulateMedia({ forcedColors: 'active' }); await openPdf(p);
    await p.click('[data-rt="markup"]'); await p.click('[data-cmd="tool_highlight"]');
    eq(await p.$$eval('#ribbonBody [data-color]', (b) => b.map((x) => getComputedStyle(x).backgroundColor)),
      ['rgb(255, 212, 59)', 'rgb(105, 219, 124)', 'rgb(116, 192, 252)', 'rgb(247, 131, 172)', 'rgb(224, 49, 49)', 'rgb(36, 72, 201)', 'rgb(17, 17, 17)']);
    const outline = (sel) => p.$eval(sel, (e) => [getComputedStyle(e).outlineStyle, parseFloat(getComputedStyle(e).outlineWidth) >= 2]);
    eq(await outline('#ribbonBody [data-color][aria-pressed="true"]'), ['solid', true], 'chosen swatch');
    eq(await outline('#ribbonBody [data-cmd="tool_highlight"]'), ['solid', true], 'pressed tool');
    eq(await outline('#ribbonTabs [aria-selected="true"]'), ['solid', true], 'ribbon tab');
    eq(await outline('.side-tabs [aria-selected="true"]'), ['solid', true], 'sidebar tab');
    eq(await outline('.thumb[aria-current="page"]'), ['solid', true], 'current page');
    eq(await p.$eval('#ribbonBody [data-cmd="tool_pen"]', (e) => getComputedStyle(e).outlineStyle), 'none', 'a tool not pressed');
    await p.evaluate(() => window.__cowdreyPdf.openMenu('View')); await p.waitForTimeout(100);
    await p.hover('#popover [data-cmd="zoomIn"]'); eq(await outline('#popover [data-cmd="zoomIn"]'), ['solid', true], 'menu row under the pointer');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('visual: the read-aloud bar has a filled Stop square and a voice list that fits a phone', async () => {
    const init = () => {
      const voices = [{ name: 'Samantha', lang: 'en-US', voiceURI: 'sam', default: true }];
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => voices, speak() {}, cancel() {}, pause() {}, resume() {}, addEventListener() {} } });
    };
    const p = await open({ width: 390, height: 844, touch: true, ua: IPHONE, init }); await openPdf(p, WORD, 'Pelican report.pdf');
    await run(p, 'crdReadAloud'); await p.waitForSelector('#crdSayBar:not([hidden])');
    eq(await p.$eval('#crdSayBar [data-crd="stop"] svg', (s) => getComputedStyle(s).fill !== 'none'), true, 'filled');
    eq(await p.$eval('#crdSayVoice option', (o) => o.textContent), 'Voice');
    const v = await p.$eval('#crdSayVoice', (s) => { const r = s.getBoundingClientRect(), b = s.closest('.crd-bar').getBoundingClientRect(); return [r.right <= b.right, b.right <= innerWidth, b.left >= 0]; });
    eq(v, [true, true, true]);
    await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr3/fix-visual/ph-readaloud.png' });
    await run(p, 'crdReadAloud');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('visual: a touch-only phone says Open a PDF, its menus show no shortcuts, and the sidebar tab is Recent', async () => {
    const p = await phone();
    ok(/^Open a PDF from Files/.test(await p.textContent('#drop .card p')), await p.textContent('#drop .card p'));
    await openPdf(p, WORD, 'Pelican report.pdf');
    await p.click('#moreBtn'); await p.waitForSelector('#popover:not([hidden])');
    eq(await p.$$eval('#popover .mi .k', (k) => k.filter((x) => getComputedStyle(x).display !== 'none' && x.textContent).length), 0, 'no shortcuts');
    eq(await p.$$eval('#popover [data-cmd="shortcuts"]', (b) => b.length), 0, 'no Keyboard shortcuts');
    await p.keyboard.press('Escape');
    eq(await p.textContent('[data-side="docs"]'), 'Recent');
    await p.ctx.close();
    // a computer still has them
    const d = await open(); await openPdf(d);
    ok(/^Drop a PDF/.test(await d.textContent('#drop .card p')), 'desktop wording');
    await d.click('#helpBtn'); await d.waitForTimeout(100);
    ok(await d.$('#popover [data-cmd="shortcuts"]'), 'Keyboard shortcuts on a computer');
    await d.keyboard.press('Escape');
    await d.click('[data-side="docs"]'); await d.waitForSelector('.doc-item');
    eq(await d.$eval('.doc-item [data-del]', (b) => b.getAttribute('title')), 'Remove from Recent');
    await d.ctx.close();
  });
};
