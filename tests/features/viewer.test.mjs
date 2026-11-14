// The viewer: zooming (wheel, trackpad and touch pinch), memory on long PDFs, the page box, the find bar, toasts,
// opening another document, and the right-click menus.
export default async (h) => {
  const { test, eq, ok, open, openPdf, reopen, PDFDocument, require } = h;
  const L = require('../desktop/node_modules/pdf-lib');
  // A PDF of n pages, each saying "Page k", with `extra(k)` added to page k's text.
  const longPdf = async (n, extra = () => '') => {
    const d = await PDFDocument.create(), f = await d.embedFont(L.StandardFonts.Helvetica);
    for (let k = 1; k <= n; k++) { const pg = d.addPage([612, 792]); pg.drawText(`Page ${k} ${extra(k)}`, { x: 72, y: 700, size: 24, font: f }); }
    return Buffer.from(await d.save());
  };
  const zoomText = (p) => p.textContent('#zoomLabel');
  const pct = (s) => +String(s).match(/(\d+)%/)[1];
  const spotUnder = (p, x, y) => p.evaluate(([x, y]) => {
    const el = [...document.querySelectorAll('#pages .page')].find((e) => { const b = e.getBoundingClientRect(); return y >= b.top && y <= b.bottom; });
    const b = el.getBoundingClientRect(); return [+el.dataset.n, (x - b.left) / b.width, (y - b.top) / b.height];
  }, [x, y]);
  const menu = (p) => p.$$eval('#popover:not([hidden]) .mi', (b) => b.map((x) => (x.disabled ? '(' : '') + x.children[1].textContent));
  const pick = async (p, label) => { await p.locator('#popover .mi', { hasText: label }).first().click(); await p.waitForTimeout(300); };
  const touch = async (p, type, pts) => {
    const s = p.__cdp || (p.__cdp = await p.ctx.newCDPSession(p));
    await s.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  };

  await test('viewer: Ctrl+wheel zooms around the pointer, not the whole window', async () => {
    const p = await open(); await reopen(p, await longPdf(6));
    const before = pct(await zoomText(p));
    const g = await p.locator('.page[data-n="0"]').boundingBox();
    const x = g.x + g.width * .7, y = g.y + 500;
    await p.mouse.move(x, y);
    const spot = await spotUnder(p, x, y);
    await p.keyboard.down('Control');
    for (let k = 0; k < 3; k++) { await p.mouse.wheel(0, -100); await p.waitForTimeout(30); }
    await p.keyboard.up('Control');
    await p.waitForTimeout(900);
    const after = await zoomText(p);
    ok(pct(after) > before + 20 && !/Fit/.test(after), `zoomed in: ${before} -> ${after}`);
    const now = await spotUnder(p, x, y);
    eq(now[0], spot[0], 'same page under the pointer');
    ok(Math.abs(now[1] - spot[1]) < .03 && Math.abs(now[2] - spot[2]) < .03, `same spot under the pointer: ${spot} / ${now}`);
    eq(await p.evaluate(() => [visualViewport.scale, document.querySelector('#pages').style.transform]), [1, '']);
    // and out again
    await p.keyboard.down('Control'); await p.mouse.wheel(0, 300); await p.keyboard.up('Control'); await p.waitForTimeout(900);
    ok(pct(await zoomText(p)) < pct(after), 'zoomed out');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('viewer: a two-finger pinch zooms the pages (touch-action keeps the window still); phones open at fit width', async () => {
    // a zoom chosen earlier does not carry over on a phone
    const p = await open({ width: 390, height: 844, touch: true, init: () => localStorage.setItem('cowdrey.pdf:settings', JSON.stringify({ zoom: 200 })) });
    await openPdf(p);
    const start = await zoomText(p);
    ok(/^Fit/.test(start), 'opens at fit width: ' + start);
    eq(await p.$eval('#viewer', (e) => getComputedStyle(e).touchAction), 'pan-x pan-y');
    const g = await p.locator('.page[data-n="0"]').boundingBox();
    const cx = g.x + g.width / 2, cy = g.y + 200;
    await touch(p, 'touchStart', [[cx - 40, cy], [cx + 40, cy]]);
    for (let k = 1; k <= 6; k++) { await touch(p, 'touchMove', [[cx - 40 - k * 12, cy], [cx + 40 + k * 12, cy]]); await p.waitForTimeout(20); }
    ok(/scale\(/.test(await p.$eval('#pages', (e) => e.style.transform)), 'pages scale while pinching');
    await touch(p, 'touchEnd', []);
    await p.waitForTimeout(800);
    const end = await zoomText(p);
    ok(pct(end) > pct(start) * 1.5, `pinched in: ${start} -> ${end}`);
    eq(await p.$eval('#pages', (e) => e.style.transform), '');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('viewer: pages far from view give their canvases back, and are drawn again on return', async () => {
    const p = await open({ width: 390, height: 844 }); await reopen(p, await longPdf(80));
    const live = () => p.evaluate(() => { const cs = [...document.querySelectorAll('#pages canvas')]; return { n: cs.length, px: cs.reduce((a, c) => a + c.width * c.height, 0) }; });
    let most = 0;
    for (let k = 0; k < 80; k += 3) {
      await p.evaluate((k) => window.__cowdreyPdf.views()[k].el.scrollIntoView(), k); await p.waitForTimeout(40);
      most = Math.max(most, (await live()).n);
    }
    await p.waitForTimeout(800);
    const end = await live();
    ok(end.n <= 14, `canvases kept at the end: ${end.n} (most at once ${most})`);
    ok(await p.evaluate(() => !!window.__cowdreyPdf.views()[79].el.querySelector('canvas.pdf')), 'the last page is drawn');
    await p.evaluate(() => { document.querySelector('#viewer').scrollTop = 0; }); await p.waitForTimeout(1200);
    ok(await p.evaluate(() => { const el = window.__cowdreyPdf.views()[0].el; return !!el.querySelector('canvas.pdf') && el.querySelector('.textLayer').textContent.includes('Page 1'); }), 'page 1 drawn again');
    ok(await p.evaluate(() => !window.__cowdreyPdf.views()[79].el.querySelector('canvas.pdf')), 'the last page let go');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('viewer: the page box follows scrolling after you type a page into it', async () => {
    const p = await open(); await reopen(p, await longPdf(20));
    await p.fill('#pageJump', '5'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
    eq(await p.evaluate(() => window.__cowdreyPdf.current), 4);
    ok(await p.evaluate(() => document.activeElement !== document.querySelector('#pageJump')), 'the box lets go of the keys');
    for (let k = 0; k < 6; k++) { await p.mouse.move(700, 500); await p.mouse.wheel(0, 800); await p.waitForTimeout(80); }
    await p.waitForTimeout(400);
    const [cur, box] = await p.evaluate(() => [window.__cowdreyPdf.current, document.querySelector('#pageJump').value]);
    ok(cur > 4, 'scrolled on'); eq(box, String(cur + 1));
    // Escape leaves the page as it is
    await p.fill('#pageJump', '2'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    eq(await p.inputValue('#pageJump'), String(cur + 1));
    await p.ctx.close();
  });

  await test('viewer: the find bar stays at the top of the viewer when a match scrolls the pages (desktop and phone)', async () => {
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const p = await open({ width, height }); await reopen(p, await longPdf(30, (k) => (k === 25 ? 'needle' : '')));
      await p.keyboard.press('Control+f'); await p.fill('#findInput', 'needle'); await p.waitForTimeout(900);
      eq(await p.textContent('#findCount'), '1 of 1');
      ok(await p.$eval('#viewer', (e) => e.scrollTop > 1000), 'scrolled to the match');
      const [bar, view] = await p.evaluate(() => [document.querySelector('#findbar').getBoundingClientRect().toJSON(), document.querySelector('#viewer').getBoundingClientRect().toJSON()]);
      ok(bar.top >= view.top && bar.top < view.top + 30, `bar at the top: ${bar.top} vs ${view.top}`);
      ok(bar.left >= 0 && bar.right <= width, `bar within the screen: ${bar.left}-${bar.right}`);
      await p.ctx.close();
    }
  });

  await test('viewer: toasts sit above bars along the bottom (status bar, read aloud)', async () => {
    const p = await open({ width: 390, height: 844 }); await openPdf(p);
    const overlap = (a, b) => a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;
    const toastAgainst = async (sel) => {
      await p.evaluate(() => window.__cowdreyPdf.run('tool_select'));
      await p.evaluate(() => window.__cowdreyPdf.run('cm_fill')); await p.waitForTimeout(250); // a result toast (tool hints are in the status bar)
      return p.evaluate((s) => [document.querySelector('#toast').getBoundingClientRect().toJSON(), document.querySelector(s).getBoundingClientRect().toJSON()], sel);
    };
    let [t, b] = await toastAgainst('.statusbar');
    ok(!overlap(t, b), `toast clear of the status bar: ${t.bottom} / ${b.top}`);
    await p.evaluate(() => { const d = document.createElement('div'); d.className = 'crd-bar'; d.id = 'fakeBar'; d.style.cssText = 'position:fixed;left:20px;right:20px;bottom:72px;height:46px'; document.body.appendChild(d); });
    [t, b] = await toastAgainst('#fakeBar');
    ok(!overlap(t, b) && t.bottom <= b.top, `toast above the read aloud bar: ${t.bottom} / ${b.top}`);
    await p.ctx.close();
  });

  await test('viewer: opening another document goes back to Select and leaves Edit PDF, Edit fields and Find', async () => {
    const p = await open(); await openPdf(p);
    for (const t of ['tool_edit', 'ff_edit']) {
      await p.evaluate((t) => window.__cowdreyPdf.run(t), t); await p.waitForTimeout(150);
      await p.keyboard.press('Control+f'); await p.fill('#findInput', 'pelican'); await p.waitForTimeout(500);
      await reopen(p, await longPdf(2));
      eq(await p.evaluate(() => document.querySelector('#app').dataset.tool), 'select', t);
      ok(await p.$eval('#findbar', (e) => e.hidden), 'find closed');
      eq(await p.$$eval('.find-hit', (e) => e.length), 0);
      await openPdf(p);
    }
    eq(p.errors, []); await p.ctx.close();
  });

  await test('viewer: right-click menus on a page in the sidebar, on a page and on a mark', async () => {
    const p = await open(); await reopen(p, await longPdf(4));
    // a page in the sidebar
    await p.click('.thumb[data-n="2"]', { button: 'right' }); await p.waitForTimeout(150);
    eq(await menu(p), ['Rotate left', 'Rotate right', 'Duplicate page', 'Insert blank page after', 'Extract pages…', 'Move page up', 'Move page down', 'Delete page']);
    await pick(p, 'Rotate right');
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.map((e) => e.rot)), [0, 0, 90, 0]);
    await p.click('.thumb[data-n="0"]', { button: 'right' }); await pick(p, 'Insert blank page after'); await p.waitForTimeout(400);
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.length), 5);
    await p.click('.thumb[data-n="1"]', { button: 'right' }); await pick(p, 'Delete page');
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.length), 4);
    // a page: right-click doesn't draw with the tool in use
    await p.evaluate(() => window.__cowdreyPdf.run('tool_pen'));
    let g = await p.locator('.page[data-n="1"]').boundingBox();
    await p.mouse.click(g.x + 200, g.y + 300, { button: 'right' }); await p.waitForTimeout(150);
    eq(await menu(p), ['(Paste', 'Add comment here', 'Select tool', 'Rotate page']);
    eq(await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().length), 0, 'nothing drawn');
    await pick(p, 'Rotate page');
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.map((e) => e.rot)), [0, 90, 90, 0]);
    await p.mouse.click(5, 5); await p.waitForTimeout(800);
    await p.evaluate(() => { document.querySelector('#viewer').scrollTop = 0; }); await p.waitForTimeout(300);
    g = await p.locator('.page[data-n="0"]').boundingBox();
    await p.mouse.click(g.x + 200, g.y + 300, { button: 'right' }); await pick(p, 'Add comment here');
    await p.fill('#dlgInput', 'Look here'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(200);
    const note = await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().find((m) => m.type === 'note'));
    ok(note && note.text === 'Look here', 'note added');
    const [nx, ny] = await h.at(p, note.x, note.y);
    ok(Math.abs(nx - (g.x + 200)) < 2 && Math.abs(ny - (g.y + 300)) < 2, 'at the spot');
    // a mark: copy, then paste it where the page is right-clicked; duplicate; delete
    await p.evaluate(() => window.__cowdreyPdf.run('tool_select'));
    const mk = await p.locator('.page[data-n="0"] svg.marks .mk').first().boundingBox();
    await p.mouse.click(mk.x + mk.width / 2, mk.y + mk.height / 2, { button: 'right' }); await p.waitForTimeout(150);
    eq((await menu(p)).slice(0, 4), ['Copy', 'Duplicate', 'Delete', 'Edit note…']);
    await pick(p, 'Copy');
    await p.mouse.click(g.x + 400, g.y + 600, { button: 'right' }); await pick(p, 'Paste');
    const notes = await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().filter((m) => m.type === 'note').map((m) => [m.x, m.y]));
    eq(notes.length, 2, 'pasted');
    const [px, py] = await h.at(p, notes[1][0], notes[1][1]);
    ok(Math.abs(px - (g.x + 400)) < 2 && Math.abs(py - (g.y + 600)) < 2, 'pasted at the spot');
    const mk2 = await p.locator('.page[data-n="0"] svg.marks .mk').nth(1).boundingBox();
    await p.mouse.click(mk2.x + mk2.width / 2, mk2.y + mk2.height / 2, { button: 'right' }); await pick(p, 'Delete');
    eq(await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().filter((m) => m.type === 'note').length), 1, 'deleted');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('viewer: right-click menus open from the keyboard (Shift+F10, menu key) and with a long press', async () => {
    const p = await open(); await reopen(p, await longPdf(3));
    await p.focus('.thumb[data-n="1"]'); await p.keyboard.press('Shift+F10'); await p.waitForTimeout(150);
    eq((await menu(p))[0], 'Rotate left');
    eq(await p.evaluate(() => document.activeElement.children[1].textContent), 'Rotate left');
    await p.keyboard.press('ArrowDown'); eq(await p.evaluate(() => document.activeElement.children[1].textContent), 'Rotate right');
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    ok(await p.$eval('#popover', (e) => e.hidden), 'closed');
    eq(await p.evaluate(() => document.activeElement.dataset.n), '1', 'focus back on the page');
    await p.keyboard.press('Shift+F10'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.map((e) => e.rot)), [0, 90, 0], 'chosen with the keys');
    // the menu key on the pages
    await p.click('#viewer', { position: { x: 20, y: 20 } }); await p.keyboard.press('ContextMenu'); await p.waitForTimeout(150);
    eq(await menu(p), ['(Paste', 'Add comment here', 'Select tool', 'Rotate page']);
    await p.keyboard.press('Escape'); await p.ctx.close();
    // a long press on a touch screen
    const q = await open({ width: 390, height: 844, touch: true }); await reopen(q, await longPdf(3));
    const g = await q.locator('.page[data-n="0"]').boundingBox();
    await touch(q, 'touchStart', [[g.x + 150, g.y + 300]]); await q.waitForTimeout(800); await touch(q, 'touchEnd', []);
    await q.waitForTimeout(200);
    eq(await menu(q), ['(Paste', 'Add comment here', 'Select tool', 'Rotate page']);
    await q.ctx.close();
  });
};
