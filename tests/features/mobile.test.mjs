// Phones, touch, the Mac app and keyboard-only use: finger drawing, the landscape layout, Undo in the title bar,
// hints without keys, the phone sidebar's focus, menu check states, focus rings, the native Mac menu bar, and
// placing items with Enter.
export default async (h) => {
  const { test, eq, ok, open, openPdf, marks, macApp, fixture, waitPages, WORD } = h;
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id).then(() => p.waitForTimeout(200));
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  // A one-finger drag, as the phone sends it (CDP touch events, so the browser decides between scrolling and drawing).
  async function swipe(p, x0, y0, dx, dy, n = 8) {
    const s = await p.context().newCDPSession(p);
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= n; i++) { await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + i * dx / n, y: y0 + i * dy / n }] }); await p.waitForTimeout(30); }
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(300);
  }
  const allMarks = (p) => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat());

  await test('mobile: a finger draws with Draw, Box and Area highlight, and selects text with Highlight and Underline (no scroll takes over)', async () => {
    for (const t of ['tool_pen', 'tool_rect', 'cm_area', 'tool_highlight', 'cm_underline']) {
      const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p, WORD, 'Pelican report.pdf');
      await p.evaluate((id) => { window.__ev = []; ['pointercancel', 'pointerup'].forEach((k) => window.addEventListener(k, () => window.__ev.push(k), true)); window.__cowdreyPdf.run(id); }, t);
      const top = await p.$eval('#viewer', (v) => v.scrollTop);
      if (/highlight|underline/.test(t)) {
        const b = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'Budget' }).first().boundingBox();
        await swipe(p, b.x + 2, b.y + b.height / 2, Math.min(150, b.width - 4), 0);
      } else await swipe(p, 100, 400, 160, 200);
      eq(await p.evaluate(() => window.__ev), ['pointerup'], t + ': not cancelled');
      eq(await p.$eval('#viewer', (v) => v.scrollTop), top, t + ': the page did not scroll');
      const m = (await allMarks(p))[0];
      ok(m, t + ': a mark was made');
      if (t === 'tool_pen') ok(m.pts.length >= 9, 'the whole stroke: ' + m.pts.length);
      if (t === 'tool_rect') ok(Math.abs(m.x2 - m.x1) > 100, 'the whole box: ' + (m.x2 - m.x1));
      if (t === 'tool_highlight' || t === 'cm_underline') eq(m.type, t === 'tool_highlight' ? 'hl' : 'cmMarkup');
      eq(p.errors, []); await p.ctx.close();
    }
    // with Select, a finger on the page still scrolls it
    const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p, WORD, 'Pelican report.pdf');
    eq(await p.$eval('.page[data-n="0"] svg.marks', (s) => getComputedStyle(s).touchAction), 'auto');
    await p.ctx.close();
  });

  await test('mobile: a phone on its side gets the phone layout, so the document gets most of the height', async () => {
    const p = await open({ width: 844, height: 390, touch: true }); await openPdf(p);
    for (const s of ['#menubar', '.r-label', '.sb-brand']) eq(await p.$eval(s, (e) => getComputedStyle(e).display), 'none', s);
    eq(await p.$eval('#sidebar', (e) => [getComputedStyle(e).position, getComputedStyle(e).visibility]), ['fixed', 'hidden'], 'sidebar is an overlay');
    const vh = await p.$eval('#viewer', (e) => e.getBoundingClientRect().height);
    ok(vh > 390 * .5, 'viewer height ' + vh);
    eq(await p.$eval('#ribbonBody .rb', (b) => [b.offsetHeight >= 44, b.querySelector('span').getBoundingClientRect().width <= 1, b.textContent.length > 0]), [true, true, true], 'icon buttons that keep their names');
    await run(p, 'sidebar'); eq(await p.$eval('#app', (a) => a.dataset.sidebar), 'open', 'opens as the overlay');
    eq(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll');
    await p.ctx.close();
    // a short desktop window with a mouse keeps the desktop layout
    const d = await open({ width: 1000, height: 480 }); await openPdf(d);
    eq(await d.$eval('#menubar', (e) => getComputedStyle(e).display), 'flex'); await d.ctx.close();
  });

  await test('mobile: Undo and Redo sit in the title bar on phones on every tab, disabled when there is nothing to undo', async () => {
    const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p);
    await p.click('[data-rt="pages"]');
    const tb = (c) => p.$eval(`.tb-actions [data-cmd="${c}"]`, (b) => [getComputedStyle(b).display !== 'none', b.disabled]);
    eq([await tb('undo'), await tb('redo')], [[true, true], [true, true]], 'shown, nothing to undo');
    eq(await p.$eval('#themeBtn', (b) => getComputedStyle(b).display), 'none', 'Appearance moves into More');
    await p.click('#ribbonBody [data-cmd="rotR"]'); await p.waitForTimeout(300);
    eq(await tb('undo'), [true, false], 'can undo');
    await p.click('.tb-actions [data-cmd="undo"]'); await p.waitForTimeout(400);
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages[0].rot), 0, 'undone');
    eq([await tb('undo'), await tb('redo')], [[true, true], [true, false]]);
    await p.click('.tb-actions [data-cmd="redo"]'); await p.waitForTimeout(400);
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages[0].rot), 90, 'redone');
    for (const s of ['.tb-actions [data-cmd="undo"]', '.tb-actions [data-cmd="redo"]']) { const b = await p.locator(s).boundingBox(); ok(b.width >= 40 && b.height >= 40, s + ' size'); }
    const t = await p.locator('#docTitle').boundingBox(); ok(t.width >= 60, 'the title still shows: ' + t.width);
    await p.click('#moreBtn'); ok(await p.$('#popover [data-cmd="theme_dark"]'), 'Appearance in More');
    eq(p.errors, []); await p.ctx.close();
    const d = await open(); await openPdf(d);
    eq(await d.$eval('.tb-actions [data-cmd="undo"]', (b) => getComputedStyle(b).display), 'none', 'desktop: on the ribbon and in Edit only');
    await d.ctx.close();
  });

  await test('mobile: hints on a touch screen never name Esc or Ctrl; Keyboard shortcuts lists Ctrl+D once', async () => {
    const p = await open({ width: 390, height: 844, touch: true, ua: IPHONE }); await openPdf(p, WORD, 'Pelican report.pdf');
    ok(await p.evaluate(() => matchMedia('(pointer: coarse)').matches), 'coarse pointer');
    const toast = () => p.textContent('#toast'), chip = () => p.textContent('#modeChip .mode-text'); // tool hints are in the status bar's mode chip
    await run(p, 'tool_edit'); let t = await chip();
    ok(/^Edit PDF: tap text/.test(t) && !/Esc|Ctrl|⌘/.test(t), t);
    await run(p, 'tool_select'); await run(p, 'cm_polygon'); t = await chip(); ok(/^Polygon: tap each/.test(t) && /double-tap/.test(t) && !/Esc/.test(t), t);
    await run(p, 'tool_select'); await run(p, 'cm_typewriter'); t = await chip(); ok(/^Typewriter: tap where/.test(t), t);
    // the line editor's "Change kept" (an iPad with a keyboard can press Esc)
    await run(p, 'tool_edit');
    const b = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'Budget' }).first().boundingBox();
    await p.mouse.click(b.x + 8, b.y + b.height / 2); await p.waitForSelector('.line-editor');
    await p.keyboard.type('x'); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    t = await toast(); ok(/^Change kept/.test(t) && !/Ctrl|⌘/.test(t), t);
    await run(p, 'tool_text'); await p.waitForTimeout(100);
    await p.mouse.click(b.x + 8, b.y + 200); await p.waitForSelector('#dialog[open]');
    ok(!/Ctrl|⌘/.test(await p.textContent('#dialog')), 'Add text dialog: ' + await p.textContent('#dialog .txt-hint'));
    eq(p.errors.filter((e) => !/annotation-comment/.test(e)), []); await p.ctx.close();
    // with a mouse and keyboard the keys are named, and Keyboard shortcuts has one row for Ctrl+D
    const d = await open(); await openPdf(d);
    await run(d, 'tool_edit'); ok(/^Edit PDF: click text.* · Esc to stop$/.test(await d.textContent('#modeChip .mode-text')), await d.textContent('#modeChip .mode-text'));
    await run(d, 'shortcuts');
    const rows = await d.$$eval('#dialog .dlg-body span', (s) => { const o = []; for (let i = 0; i < s.length; i += 2) o.push([s[i].textContent, s[i + 1].textContent]); return o; });
    eq(rows.filter(([, k]) => k === 'Ctrl+D'), [['Duplicate selection, or document properties when nothing is selected', 'Ctrl+D']]);
    eq(rows.filter(([, k]) => /^Ctrl\+\w$/.test(k)).length, new Set(rows.filter(([, k]) => /^Ctrl\+\w$/.test(k)).map(([, k]) => k)).size, 'each key once');
    for (const k of ['Delete', 'Esc', 'Enter']) ok(rows.some(([, x]) => x === k), k + ' listed');
    ok(rows.some(([l, k]) => l === 'Redo' && /Ctrl\+Y/.test(k)), 'Ctrl+Y for Redo');
    await d.ctx.close();
  });

  await test('mobile: the phone sidebar takes focus when it opens, keeps it while open (Tab goes round), and gives it back', async () => {
    const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p);
    await p.focus('#ribbonBody [data-cmd="sidebar"]'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
    eq(await p.$eval('#app', (a) => a.dataset.sidebar), 'open');
    eq(await p.evaluate(() => document.activeElement.dataset.side), 'thumbs', 'focus is in the sidebar');
    const inSide = () => p.evaluate(() => !!document.activeElement.closest('#sidebar'));
    for (let i = 0; i < 8; i++) { await p.keyboard.press('Tab'); ok(await inSide(), 'Tab ' + i + ' stays in'); }
    for (let i = 0; i < 4; i++) { await p.keyboard.press('Shift+Tab'); ok(await inSide(), 'Shift+Tab ' + i + ' stays in'); }
    eq(await p.$eval('#viewer', (v) => v.inert), true, 'what is behind the scrim is inert');
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    eq(await p.$eval('#app', (a) => a.dataset.sidebar), 'on');
    eq(await p.evaluate(() => document.activeElement.dataset.cmd), 'sidebar', 'focus goes back');
    eq(await p.$eval('#viewer', (v) => v.inert), false);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('mobile: menu toggles are checkbox items and Appearance is a radio group, with their checked state', async () => {
    const p = await open(); await openPdf(p);
    await p.click('#menubar > button:has-text("View")'); await p.waitForTimeout(100);
    const item = (id) => p.$eval(`#popover [data-cmd="${id}"]`, (b) => [b.getAttribute('role'), b.getAttribute('aria-checked')]);
    eq(await item('sidebar'), ['menuitemcheckbox', 'true']); eq(await item('darkPage'), ['menuitemcheckbox', 'false']);
    eq(await item('zoomIn'), ['menuitem', null]);
    eq(await p.$$eval('#popover [role="group"][aria-label="Appearance"] [role="menuitemradio"]', (b) => b.map((x) => [x.dataset.cmd, x.getAttribute('aria-checked')])),
      [['theme_system', 'true'], ['theme_light', 'false'], ['theme_dark', 'false']]);
    eq(await p.$eval('#popover [data-cmd="sidebar"]', (b) => [b.getAttribute('aria-keyshortcuts'), b.querySelector('.k').getAttribute('aria-hidden')]), ['Control+Alt+S', 'true']);
    const snap = await p.locator('#popover').ariaSnapshot();
    ok(/menuitemcheckbox "Sidebar" \[checked\]/.test(snap), snap);
    // arrow keys still walk every item, across the group
    await p.focus('#popover [data-cmd="theme_light"]'); await p.keyboard.press('ArrowDown'); eq(await p.evaluate(() => document.activeElement.dataset.cmd), 'theme_dark');
    await p.keyboard.press('Enter'); await p.waitForTimeout(100);
    eq(await p.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('mobile: keyboard focus rings are the accent colour on fields, buttons, the menu bar and swatches, in both themes', async () => {
    for (const scheme of ['light', 'dark']) {
      const p = await open({ scheme }); await openPdf(p);
      const accent = await p.evaluate(() => { const d = document.createElement('i'); d.style.color = 'var(--accent)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; });
      const ring = () => p.evaluate(() => { const s = getComputedStyle(document.activeElement); return [s.outlineStyle, s.outlineColor, parseFloat(s.outlineWidth)]; });
      // the menu bar, after Escape closes a menu
      await p.click('#menubar > button:has-text("File")'); await p.keyboard.press('Escape');
      eq(await ring(), ['solid', accent, 2], scheme + ' menu bar');
      // a title bar button and a swatch, reached with Tab
      await p.focus('#saveBtn'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
      eq(await ring(), ['solid', accent, 2], scheme + ' Save');
      await p.click('[data-rt="markup"]'); await p.focus('#ribbonBody [data-color]'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
      eq(await p.evaluate(() => document.activeElement.className), 'swatch');
      eq(await ring(), ['solid', accent, 2], scheme + ' swatch');
      // a dialog field
      await run(p, 'docProps'); await p.waitForSelector('#dialog[open] [data-di="title"]'); await p.focus('#dialog [data-di="title"]');
      eq(await ring(), ['solid', accent, 2], scheme + ' field');
      // the ring stands out from what is around it (3:1 or more)
      const ratio = await p.evaluate(() => {
        const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
        const lum = (c) => { const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
        const col = (v) => { const d = document.createElement('i'); d.style.color = `var(${v})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; };
        const a = lum(col('--accent')); return Math.min(...['--chrome', '--surface'].map((v) => { const b = lum(col(v)); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }));
      });
      ok(ratio >= 3, scheme + ' contrast ' + ratio);
      await p.ctx.close();
    }
  });

  await test('mobile: the Mac app hides the window menu bar once the macOS menu bar has the menus; the web app keeps it', async () => {
    const p = await open({ init: macApp({ files: [{ name: 'Report.pdf', path: '/Users/me/Report.pdf', content: fixture('sample.pdf') }] }) });
    await waitPages(p); await p.waitForTimeout(400);
    ok(await p.evaluate(() => window.__calls.some(([c]) => c === 'set_menu')), 'native menu set');
    eq(await p.$eval('#menubar', (e) => getComputedStyle(e).display), 'none', 'no second menu bar');
    const view = await p.evaluate(() => window.__calls.filter(([c]) => c === 'set_menu').pop()[1].menus.find((m) => m.title === 'View').items);
    eq((view.find((x) => x.id === 'cmd:crdReadMode') || {}).accel, 'CmdOrCtrl+Shift+R', 'Read mode has its shortcut');
    eq(p.errors, []); await p.ctx.close();
    // if macOS refuses the menu, the window keeps its own
    const [fn, arg] = macApp({});
    const q = await open({ init: [(o) => { (0, eval)(o.fn)(o.arg); const inv = window.__TAURI__.core.invoke; window.__TAURI__.core.invoke = (c, a) => c === 'set_menu' ? Promise.reject(new Error('no')) : inv(c, a); }, { fn: fn.toString(), arg }] });
    await q.waitForTimeout(400);
    eq(await q.$eval('#menubar', (e) => getComputedStyle(e).display), 'flex', 'refused: menu bar kept');
    await q.ctx.close();
    const w = await open(); eq(await w.$eval('#menubar', (e) => getComputedStyle(e).display), 'flex', 'web'); await w.ctx.close();
  });

  await test('mobile: with Note or Stamp chosen, Enter places it in the middle of the page in view, selected, and the arrows move it; pages are named regions', async () => {
    const p = await open(); await openPdf(p);
    eq(await p.$eval('#viewer', (v) => [v.tagName, v.getAttribute('aria-label'), v.tabIndex]), ['MAIN', 'Document', 0]);
    eq(await p.$$eval('.page', (ps) => ps.map((x) => [x.getAttribute('role'), x.getAttribute('aria-label')])), [['region', 'Page 1 of 3'], ['region', 'Page 2 of 3'], ['region', 'Page 3 of 3']]);
    // Note, with the keyboard only: choose it on the ribbon, press Enter again to place it
    await p.click('[data-rt="markup"]'); await p.focus('#ribbonBody [data-cmd="tool_note"]'); await p.keyboard.press('Enter');
    eq(await p.$eval('#app', (a) => a.dataset.tool), 'note');
    await p.keyboard.press('Enter'); await p.waitForSelector('#dialog[open] #dlgInput');
    await p.keyboard.type('Placed with the keyboard'); await p.keyboard.press('Control+Enter'); await p.waitForTimeout(300);
    let ms = await allMarks(p); eq(ms.map((m) => [m.type, m.text]), [['note', 'Placed with the keyboard']]);
    eq(await p.$eval('#app', (a) => a.dataset.tool), 'select');
    const centre = async (id) => p.evaluate((i) => { const g = document.querySelector(`svg.marks [data-id="${i}"]`), b = g.getBoundingClientRect(), page = g.closest('.page').getBoundingClientRect(), w = document.querySelector('#viewer').getBoundingClientRect();
      const t = Math.max(page.top, w.top), bo = Math.min(page.bottom, w.bottom); return [g.classList.contains('sel'), Math.round(b.left + b.width / 2 - (page.left + page.right) / 2), Math.round(b.top + b.height / 2 - (t + bo) / 2)]; }, id);
    const [sel, dx, dy] = await centre(ms[0].id);
    ok(sel && Math.abs(dx) <= 2 && Math.abs(dy) <= 2, `selected and centred: ${sel} ${dx} ${dy}`);
    const x0 = ms[0].x; await p.keyboard.press('ArrowRight'); await p.keyboard.press('Shift+ArrowRight'); await p.waitForTimeout(100);
    ms = await allMarks(p); ok(Math.abs(ms[0].x - x0 - 11) < .01, 'nudged 11 pt: ' + (ms[0].x - x0));
    // Stamp: pick it, then Enter on the page
    await run(p, 'cm_stamp'); await p.click('#dialog [data-stamp="approved"]'); await p.waitForTimeout(200);
    eq(await p.$eval('#app', (a) => a.dataset.tool), 'cmstamp');
    await p.focus('#viewer'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    ms = await allMarks(p); eq(ms.map((m) => m.type), ['note', 'cmStamp']);
    const [s2, ex, ey] = await centre(ms[1].id); ok(s2 && Math.abs(ex) <= 2 && Math.abs(ey) <= 2, `stamp selected and centred: ${s2} ${ex} ${ey}`);
    await p.keyboard.press('Delete'); eq(await marks(p), ['note'], 'Delete removes it');
    // Enter with nothing to place does nothing; a cancelled note leaves nothing behind
    await run(p, 'tool_note'); await p.focus('#viewer'); await p.keyboard.press('Enter'); await p.waitForSelector('#dialog[open]');
    await p.keyboard.press('Escape'); await p.waitForTimeout(300); eq(await marks(p), ['note']);
    eq(p.errors, []); await p.ctx.close();
  });
};
