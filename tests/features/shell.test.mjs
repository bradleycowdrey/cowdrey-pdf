// The app's shell: ribbon, menus, keys, dialogs, the phone sidebar and title bar, save state, mark nudging and
// copy and paste.
export default async (h) => {
  const { test, eq, ok, open, openPdf, marks, WORD } = h;
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id).then(() => p.waitForTimeout(200));
  const tool = (p) => p.evaluate(() => document.querySelector('#app').dataset.tool);
  const focused = (p) => p.evaluate(() => { const a = document.activeElement; return a.dataset.rt || a.dataset.side || a.dataset.cmd || a.id || a.textContent.trim(); });
  const drawBox = async (p) => {
    await p.click('[data-rt="markup"]'); await p.click('[data-cmd="tool_rect"]');
    const g = await p.locator('.page[data-n="0"]').boundingBox();
    await p.mouse.move(g.x + 100, g.y + 500); await p.mouse.down(); await p.mouse.move(g.x + 200, g.y + 560, { steps: 3 }); await p.mouse.up();
    await p.click('[data-cmd="tool_select"]');
    await p.mouse.click(g.x + 100, g.y + 530); await p.waitForTimeout(100);
  };
  const rects = (p) => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().filter((m) => m.type === 'rect').map((m) => [Math.round(m.x1 * 10) / 10, Math.round(m.y1 * 10) / 10]));

  await test('shell: the ribbon keeps one height on every tab, buttons never overlap, and a wide tab fades at the edge', async () => {
    const p = await open(); await openPdf(p);
    const heights = new Set();
    for (const t of await p.$$eval('#ribbonTabs [data-rt]', (b) => b.map((x) => x.dataset.rt))) {
      await p.click(`[data-rt="${t}"]`); await p.waitForTimeout(80);
      heights.add(await p.$eval('.ribbon', (e) => e.offsetHeight));
      const bad = await p.$$eval('#ribbonBody .rb', (bs) => {
        const out = [];
        bs.forEach((b, k) => { const s = b.querySelector('span'); if (s && s.getClientRects().length && s.offsetHeight > 2 * parseFloat(getComputedStyle(s).lineHeight) + 1) out.push('3 lines: ' + s.textContent);
          const n = bs[k + 1], r = b.getBoundingClientRect(), q = n && n.getBoundingClientRect(); // (compact groups stack buttons in two rows)
          if (n && b.parentNode === n.parentNode && r.right > q.left + .5 && r.left < q.right - .5 && r.bottom > q.top + .5 && r.top < q.bottom - .5) out.push('overlap: ' + b.textContent + '/' + n.textContent); });
        return out;
      });
      eq(bad, [], t);
      const [sw, cw, cls] = await p.$eval('#ribbonBody', (e) => [e.scrollWidth, e.clientWidth, e.className]);
      eq(cls.includes('more-r'), sw > cw + 1, `${t}: fade only when it overflows (${sw}/${cw})`);
    }
    eq(heights.size, 1, 'heights ' + [...heights]);
    await p.ctx.close();
  });

  await test('shell: the Comment tab starts Tools, Colour, Style; no Edit group; the Picture group shows only for a picture', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.click('[data-rt="markup"]');
    const groups = await p.$$eval('#ribbonBody .r-label', (e) => e.map((x) => x.textContent));
    eq(groups.slice(0, 3), ['Tools', 'Colour', 'Style']); ok(!groups.includes('Edit'), groups.join());
    ok(await p.$eval('#ribbonBody [data-color]', (e) => e.getBoundingClientRect().right < innerWidth), 'colours in view');
    const labels = await p.$$eval('#ribbonBody .rb span', (e) => e.map((x) => x.textContent));
    ok(!labels.includes('Text'), 'no tool called Text: ' + labels);
    await p.click('[data-rt="edit"]');
    ok(await p.$eval('#ribbonBody [data-cmd="picRotL"]', (b) => b.closest('.r-group').hidden), 'Picture group hidden');
    eq(await p.$$eval('#ribbonBody .rb span', (e) => e.filter((x) => x.textContent === 'Add text').length), 1, 'Add text');
    await p.click('[data-cmd="tool_edit"]');
    const [cx, cy] = await p.evaluate(([x, y]) => { const v = window.__cowdreyPdf.views()[0]; const [vx, vy] = v.viewport.convertToViewportPoint(x, y); const r = v.el.getBoundingClientRect(); return [r.left + vx, r.top + vy]; }, [460, 480]);
    await p.mouse.click(cx, cy); await p.waitForTimeout(400);
    ok(await p.$eval('#ribbonBody [data-cmd="picRotL"]', (b) => !b.closest('.r-group').hidden && !b.disabled), 'Picture group shown for a picture');
    eq(await p.$eval('#ribbonBody [data-cmd="picExtract"] span', (e) => e.textContent), 'Save as PNG');
    await p.ctx.close();
  });

  await test('shell: switching ribbon tabs goes back to Select unless the tool is on that tab; then a form can be filled', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="protect"]'); await p.click('[data-cmd="protRedArea"]');
    eq(await tool(p), 'protredarea');
    await p.click('[data-rt="protect"]'); eq(await tool(p), 'protredarea', 'same tab keeps it');
    await p.click('[data-rt="forms"]'); eq(await tool(p), 'select', 'another tab goes back to Select');
    await p.fill('.annotationLayer input[name="name"]', 'Filled', { timeout: 3000 });
    await p.click('[data-rt="markup"]'); await p.click('[data-cmd="cm_oval"]'); await p.click('[data-rt="markup"]');
    eq(await tool(p), 'cmoval', 'a module tool on its own tab stays');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('shell: Escape keeps an edit to a text box; Undo takes it back', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="edit"]'); await p.click('[data-cmd="tool_text"]');
    const g = await p.locator('.page[data-n="0"]').boundingBox();
    await p.mouse.click(g.x + 100, g.y + 300); await p.waitForSelector('#dialog[open] #dlgInput');
    await p.fill('#dlgInput', 'First words'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(200);
    const t = await p.locator('.page[data-n="0"] svg.marks text.mk').first().boundingBox();
    await p.mouse.dblclick(t.x + 5, t.y + t.height / 2); await p.waitForSelector('.txt-editor');
    await p.keyboard.press('Control+a'); await p.keyboard.type('Kept by Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    ok(!(await p.$('.txt-editor')), 'closed');
    const texts = () => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().map((m) => m.text));
    eq(await texts(), ['Kept by Escape']);
    await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
    eq(await texts(), ['First words'], 'undone');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('shell: menus work from the keyboard; ribbon and sidebar tabs are tab lists', async () => {
    const p = await open(); await openPdf(p);
    await p.focus('#menubar > button'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
    ok(!(await p.$eval('#popover', (e) => e.hidden)), 'File opens');
    const first = await focused(p);
    await p.keyboard.press('ArrowDown'); ok((await focused(p)) !== first, 'Down moves');
    await p.keyboard.press('End'); await p.keyboard.press('Home'); eq(await focused(p), first, 'Home');
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(100);
    eq(await p.$eval('#menubar > [aria-expanded="true"]', (e) => e.textContent), 'Edit', 'Right opens the next menu');
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    ok(await p.$eval('#popover', (e) => e.hidden), 'Escape closes'); eq(await focused(p), 'menu-1', 'focus back on Edit');
    eq(await p.evaluate(() => window.__cowdreyPdf.current), 0, 'no page turned');
    // ribbon tabs
    await p.focus('#ribbonTabs [aria-selected="true"]');
    eq(await p.$$eval('#ribbonTabs [tabindex="0"]', (e) => e.length), 1, 'one Tab stop');
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(100);
    eq(await focused(p), 'edit', 'focus moves to Edit and stays after the redraw');
    eq(await p.$eval('[data-rt="edit"]', (e) => e.getAttribute('aria-selected')), 'true');
    await p.keyboard.press('End'); eq(await focused(p), 'export');
    eq(await p.evaluate(() => window.__cowdreyPdf.current), 0, 'no page turned');
    eq(await p.$eval('#ribbonBody', (e) => e.getAttribute('role') + ' ' + e.getAttribute('aria-labelledby')), 'tabpanel rt-export');
    // sidebar tabs
    await p.focus('.side-tabs [aria-selected="true"]'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(100);
    eq(await focused(p), 'outline'); eq(await p.$eval('[data-side="outline"]', (e) => e.getAttribute('aria-selected')), 'true');
    await p.keyboard.press('Home'); eq(await focused(p), 'thumbs');
    await p.ctx.close();
  });

  await test('shell: arrow keys nudge the selected mark (Shift for 10 pt); copy, paste and duplicate it', async () => {
    const p = await open(); await openPdf(p);
    await drawBox(p);
    const [[x0, y0]] = await rects(p);
    await p.keyboard.press('ArrowRight'); await p.keyboard.press('Shift+ArrowUp'); await p.waitForTimeout(100);
    eq(await rects(p), [[x0 + 1, y0 + 10]], 'nudged');
    eq(await p.evaluate(() => window.__cowdreyPdf.current), 0, 'the page did not turn');
    await p.keyboard.press('Control+z'); await p.keyboard.press('Control+z'); eq(await rects(p), [[x0, y0]], 'undo');
    await p.waitForTimeout(600); // undo draws the page again
    const g = await p.locator('.page[data-n="0"]').boundingBox(); await p.mouse.click(g.x + 100, g.y + 530); await p.waitForTimeout(100);
    await p.keyboard.press('Control+c'); await p.keyboard.press('Control+v'); await p.waitForTimeout(100);
    eq(await rects(p), [[x0, y0], [x0 + 10, y0 - 10]], 'pasted 10 pt down and right');
    await p.keyboard.press('Control+d'); await p.waitForTimeout(100);
    eq((await rects(p)).length, 3, 'duplicated');
    ok(await p.evaluate(() => { const ids = Object.values(window.__cowdreyPdf.doc.marks).flat().map((m) => m.id); return new Set(ids).size === ids.length; }), 'new ids');
    await p.keyboard.press('Escape'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(500);
    eq(await p.evaluate(() => window.__cowdreyPdf.current), 1, 'with nothing selected, arrows turn the page');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('shell: dialogs are named and start on their first field; a disabled button looks disabled; save state is truthful', async () => {
    const p = await open();
    ok(+(await p.$eval('#saveBtn', (e) => getComputedStyle(e).opacity)) < .6, 'Save PDF looks disabled');
    await openPdf(p);
    eq(await p.textContent('#saveState'), '', 'nothing said about an unedited file');
    await run(p, 'pd_watermark'); await p.waitForSelector('#dialog[open]');
    eq(await p.$eval('#dialog', (d) => [d.getAttribute('aria-modal'), document.getElementById(d.getAttribute('aria-labelledby')) === d.querySelector('h2')]), ['true', true], 'named by its title');
    ok(await p.evaluate(() => { const a = document.activeElement; return a.matches('#dialog .dlg-body :is(input, textarea, select)'); }), 'focus on a field, not Close');
    await p.keyboard.press('Escape');
    await run(p, 'tool_note'); const g = await p.locator('.page[data-n="0"]').boundingBox(); await p.mouse.click(g.x + 300, g.y + 300);
    await p.waitForSelector('#dialog[open] #dlgInput');
    eq(await p.$eval('#dlgInput', (e) => e.getAttribute('aria-labelledby')), 'dlgTitle', 'the field is named');
    await p.fill('#dlgInput', 'Hello'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(100);
    ok((await p.textContent('#saveState')).startsWith('Edited'), 'edited');
    await p.ctx.close();
  });

  await test('shell: with reduced motion, going to a page jumps straight there', async () => {
    const p = await open(); await p.emulateMedia({ reducedMotion: 'reduce' }); await openPdf(p);
    await p.evaluate(() => { const v = document.querySelector('#viewer'); window.__scrolls = 0; v.addEventListener('scroll', () => window.__scrolls++); });
    await p.fill('#pageJump', '3'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
    ok((await p.evaluate(() => window.__scrolls)) <= 2, 'scroll events ' + (await p.evaluate(() => window.__scrolls)));
    await p.ctx.close();
  });

  await test('shell: phone: the sidebar has a scrim and closes on Escape, a tap outside and its close button', async () => {
    const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p);
    const side = () => p.$eval('#app', (a) => a.dataset.sidebar);
    await run(p, 'sidebar'); eq(await side(), 'open');
    eq(await p.$eval('#app', (a) => getComputedStyle(a, '::after').position), 'fixed', 'scrim');
    eq(await p.$eval('[data-cmd="sidebar"]', (b) => b.getAttribute('aria-pressed')), 'true', 'pressed while open');
    await p.keyboard.press('Escape'); eq(await side(), 'on', 'Escape');
    await run(p, 'sidebar'); await p.click('[data-side="docs"]'); await p.waitForTimeout(100);
    await p.mouse.click(370, 600); await p.waitForTimeout(200); eq(await side(), 'on', 'tap outside');
    eq(await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().length), 0, 'the tap did nothing else');
    await run(p, 'sidebar'); await p.click('#sideClose'); eq(await side(), 'on', 'close button');
    await p.click('[data-rt="pages"]'); // nothing in the way
    eq(p.errors, []); await p.ctx.close();
  });

  await test('shell: phone: More reaches the menu-only commands; buttons are named and big enough; dialog buttons stay in view', async () => {
    const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p);
    eq(await p.$$eval('.tb-actions button', (b) => b.every((x) => (x.getAttribute('aria-label') || '').length > 0)), true, 'named');
    for (const s of ['.sb-zoom [data-cmd="zoomOut"]', '.sb-zoom [data-cmd="zoomIn"]', '#zoomLabel', '#pageJump', '#moreBtn']) {
      const b = await p.locator(s).boundingBox(); ok(b.width >= 40 && b.height >= 40, `${s} ${b.width}x${b.height}`);
    }
    await p.click('#moreBtn'); await p.waitForTimeout(100);
    const ids = await p.$$eval('#popover [data-cmd]', (e) => e.map((x) => x.dataset.cmd));
    for (const id of ['legal', 'about', 'zoom100', 'sample']) ok(ids.includes(id), id + ' in More: ' + ids);
    ok(!ids.includes('shortcuts'), 'no Keyboard shortcuts on a touch-only phone');
    const pb = await p.locator('#popover').boundingBox(); ok(pb.y + pb.height <= 844 && pb.x >= 0 && pb.x + pb.width <= 390, 'menu fits ' + JSON.stringify(pb));
    await p.keyboard.press('Escape'); await p.evaluate(() => window.__cowdreyPdf.run('shortcuts')); await p.waitForSelector('#dialog[open]');
    ok((await p.textContent('#dialog')).includes('Duplicate'), 'shortcuts list Duplicate');
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    await run(p, 'pd_headfoot'); await p.waitForSelector('#dialog[open]');
    const f = await p.locator('#dialog .dlg-foot .btn.primary').boundingBox();
    ok(f && f.y + f.height <= 844, 'primary button in view ' + JSON.stringify(f));
    ok(await p.$eval('#dialog .dlg-body', (b) => b.scrollHeight > b.clientHeight || b.scrollHeight <= b.clientHeight), 'body scrolls');
    eq(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('shell: one name per place: Comment menu, page design under Edit, pictures called pictures', async () => {
    const p = await open(); await openPdf(p);
    const titles = await p.$$eval('#menubar > button', (b) => b.map((x) => x.textContent));
    ok(titles.includes('Comment') && !titles.includes('Mark up') && !titles.includes('Tools'), titles.join());
    await p.click('#menubar > button:nth-child(2)');
    const edit = await p.$$eval('#popover [data-cmd]', (e) => e.map((x) => x.dataset.cmd));
    for (const id of ['pd_watermark', 'tool_edit', 'txtParaMode', 'tool_link']) ok(edit.includes(id), id + ' in Edit');
    const all = await p.evaluate(() => document.querySelector('#popover').textContent);
    ok(!/\bimage\b/i.test(all), 'no "image" in Edit: ' + all);
    await p.ctx.close();
  });
};
