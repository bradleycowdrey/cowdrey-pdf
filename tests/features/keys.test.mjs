// Keyboard, focus and platform behaviour: focus after the Edit PDF editors close, Tab and Ctrl/Cmd+B/I/U in the
// line editor, the Mac menu's greyed-out commands, Close (Ctrl/Cmd+W), Android Back, iPhone form zoom, phone touch
// targets, and hints and edge fades on the phone.
const SHOTS = '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr5/fix-keys/';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
let H;
const shot = async (p, name) => { try { H.fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: SHOTS + name }); } catch {} };
const active = (p) => p.evaluate(() => { const a = document.activeElement; return a === document.body ? 'BODY' : a.id ? '#' + a.id : a.className || a.tagName; });
// Opens the line editor on "The second phase…" of word.pdf.
async function editLine(p) {
  await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
  const [x, y] = await H.at(p, 120, 584);
  await p.mouse.click(x, y); await p.waitForSelector('.line-editor'); await p.waitForTimeout(150);
}

export default async (h) => {
  H = h; const { test, eq, ok, open, openPdf, WORD } = h;

  await test('Edit PDF: closing the line editor with Escape or Enter puts the focus on the page, and Tab goes on from there', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await editLine(p);
    eq(await active(p), 'line-editor');
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    eq(await active(p), '#viewer', 'after Escape');
    await editLine(p); await p.keyboard.press('End'); await p.keyboard.type(' Now.'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
    eq(await active(p), '#viewer', 'after Enter');
    // Bold, then Escape from the format bar: the formatted line is kept and focus is still on the page.
    await editLine(p); await p.keyboard.press('Tab'); await p.keyboard.press('Escape'); eq(await active(p), 'line-editor', 'Escape in the bar goes back to the text');
    await p.keyboard.press('Control+b'); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    eq(await active(p), '#viewer', 'after a formatted edit');
    await p.keyboard.press('Tab'); ok(await p.evaluate(() => document.activeElement !== document.body), 'Tab goes on from the page');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Edit PDF: Tab and Shift+Tab go between the text and the format bar; Ctrl+B, I and U format the line', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await editLine(p);
    await p.keyboard.press('Tab'); eq(await p.evaluate(() => document.activeElement.dataset.tf), 'face', 'Tab into the bar: its first control, the Font list');
    await p.keyboard.press('Shift+Tab'); eq(await active(p), 'line-editor', 'Shift+Tab back to the text');
    ok(await p.$('.line-editor'), 'still editing');
    await p.keyboard.press('Shift+Tab'); ok(await p.evaluate(() => !!document.activeElement.closest('.txt-bar')), 'Shift+Tab from the text goes to the bar');
    await p.keyboard.press('Tab'); eq(await active(p), 'line-editor', 'Tab from the last button comes back');
    const pressed = () => p.$$eval('.txt-bar [data-tf="bold"], .txt-bar [data-tf="italic"], .txt-bar [data-tf="underline"]', (b) => b.map((x) => x.getAttribute('aria-pressed')));
    eq(await pressed(), ['false', 'false', 'false']);
    await p.keyboard.press('Control+b'); await p.keyboard.press('Control+i'); await p.keyboard.press('Control+u');
    eq(await pressed(), ['true', 'true', 'true']);
    const st = await p.$eval('.line-editor', (e) => [getComputedStyle(e).fontWeight, getComputedStyle(e).fontStyle, getComputedStyle(e).textDecorationLine]);
    ok(+st[0] >= 600 && st[1] === 'italic' && st[2] === 'underline', JSON.stringify(st));
    eq(await active(p), 'line-editor', 'focus stays in the text');
    // In the bar too, and Ctrl+B there formats instead of adding a bookmark.
    await p.keyboard.press('Tab'); await p.keyboard.press('Control+b'); eq((await pressed())[0], 'false');
    eq(await active(p), 'line-editor', 'back in the text, as after a click on the button (no bookmark added)');
    await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    const m = await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().find((x) => x.type === 'tpara'));
    ok(m && !m.bold && m.italic && m.underline, JSON.stringify(m && [m.bold, m.italic, m.underline]));
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Mac app: the menu bar greys out commands that do not apply, and sends only what changed', async () => {
    const p = await open({ init: h.macApp() }); await p.waitForTimeout(600);
    const full = await p.evaluate(() => window.__calls.filter(([c]) => c === 'set_menu').pop()[1].menus);
    const find = (id) => full.flatMap((m) => m.items).find((x) => x.id === id);
    eq([find('cmd:open').enabled, find('cmd:save').enabled, find('cmd:print').enabled], [true, false, false], 'no document');
    ok(full.flatMap((m) => m.items).filter((x) => x.kind === 'item').every((x) => typeof x.enabled === 'boolean'), 'every item says');
    const n = await p.evaluate(() => window.__calls.filter(([c]) => c === 'set_menu').length);
    await openPdf(p); await p.waitForTimeout(400);
    const upd = await p.evaluate(() => window.__calls.filter(([c]) => c === 'set_menu_enabled').map(([, a]) => a.items).flat());
    ok(upd.some(([id, on]) => id === 'cmd:save' && on === true), JSON.stringify(upd.slice(0, 6)));
    ok(upd.every(([id, on]) => typeof id === 'string' && typeof on === 'boolean'), 'pairs');
    // Only items that changed: nothing is sent again while nothing changes.
    const k = await p.evaluate(() => window.__calls.length); await p.evaluate(() => window.__cowdreyPdf.run('zoomIn')); await p.waitForTimeout(400);
    eq(await p.evaluate((k) => window.__calls.slice(k).filter(([c]) => c === 'set_menu_enabled').length, k), 0, 'no change, nothing sent');
    // The pure diff the menu uses.
    const d = await p.evaluate(() => {
      const H = window.__cowdreyPdf, m = [{ title: 'File', items: [{ kind: 'item', id: 'cmd:a', label: 'A', enabled: true }, { kind: 'sep' }, { kind: 'item', id: 'cmd:b', label: 'B', enabled: false }] }];
      const a = H.macMenuDelta(m, null), b = H.macMenuDelta(m, a.state);
      const m2 = JSON.parse(JSON.stringify(m)); m2[0].items[2].enabled = true; const c = H.macMenuDelta(m2, a.state);
      const m3 = JSON.parse(JSON.stringify(m)); m3[0].items[0].label = 'A2'; const e = H.macMenuDelta(m3, a.state);
      return [!!a.send.full, b.send, c.send, !!e.send.full];
    });
    eq(d, [true, null, { enabled: [['cmd:b', true]] }, true]);
    eq(n >= 1, true); eq(p.errors, []); await p.ctx.close();
  });

  await test('Close (Ctrl+W): asks about unsaved changes, then goes back to the start; Recent keeps the document', async () => {
    const p = await open(); await openPdf(p);
    await p.keyboard.press('Control+w'); await p.waitForTimeout(300);
    ok(await p.evaluate(() => !window.__cowdreyPdf.doc), 'an unchanged document closes at once');
    ok(await p.$eval('#drop', (e) => !e.hidden), 'start screen'); eq(await p.textContent('#docTitle'), 'Cowdrey.PDF');
    eq(await p.$$eval('.page', (e) => e.length), 0);
    await openPdf(p);
    await p.evaluate(() => window.__cowdreyPdf.run('rotR')); await p.waitForTimeout(200);
    await p.keyboard.press('Control+w'); await h.answer(p, 'Cancel'); await p.waitForTimeout(200);
    ok(await p.evaluate(() => !!window.__cowdreyPdf.doc), 'Cancel keeps it open');
    await p.evaluate(() => window.__cowdreyPdf.run('closeDoc')); await h.answer(p, "Don't save"); await p.waitForTimeout(400);
    ok(await p.evaluate(() => !window.__cowdreyPdf.doc), 'closed');
    ok(await p.evaluate(() => document.activeElement.matches('#drop [data-cmd="open"]')), 'focus on Open');
    await p.click('[data-side="docs"]').catch(() => {}); await p.waitForSelector('.doc-item'); eq(await p.$$eval('.doc-item', (e) => e.length), 2, 'both opens kept in Recent');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Mac app: File > Close has Cmd+W', async () => {
    const p = await open({ init: h.macApp() }); await p.waitForTimeout(600);
    const menus = await p.evaluate(() => window.__calls.filter(([c]) => c === 'set_menu').pop()[1].menus);
    const c = menus[0].items.find((x) => x.id === 'cmd:closeDoc');
    ok(c && c.accel === 'CmdOrCtrl+W' && c.label === 'Close', JSON.stringify(c));
    eq(menus[0].items[menus[0].items.length - 1].id, 'cmd:closeDoc', 'last in File');
    await p.ctx.close();
  });

  await test('phone: a tool hint toast goes once the page is tapped or the tool changes; ribbon rows fade at the edge with more', async () => {
    const p = await open({ width: 390, height: 844, touch: true, ua: ANDROID }); await openPdf(p);
    const shown = () => p.evaluate(() => document.querySelector('#toast').classList.contains('show') ? document.querySelector('#toast').textContent : '');
    await p.evaluate(() => window.__cowdreyPdf.run('tool_note')); await p.waitForTimeout(150);
    eq(await shown(), 'Tap where the note goes');
    const b = await p.locator('.page[data-n="0"]').boundingBox();
    await p.touchscreen.tap(b.x + 200, b.y + 400); await p.waitForTimeout(250);
    eq(await shown(), '', 'gone once placed');
    await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit')); await p.waitForTimeout(150);
    ok((await shown()).startsWith('Tap text'), 'Edit PDF hint');
    await p.evaluate(() => window.__cowdreyPdf.setTool('select')); await p.waitForTimeout(50);
    eq(await shown(), '', 'gone when the tool changes');
    // Edge fades: the tab row and the tool strip say there is more past the edge, on both sides once scrolled.
    const cls = () => p.$$eval('#ribbonTabs, #ribbonBody', (e) => e.map((x) => [x.classList.contains('more-l'), x.classList.contains('more-r'), getComputedStyle(x).maskImage !== 'none']));
    eq(await cls(), [[false, true, true], [false, true, true]]);
    await p.$eval('#ribbonTabs', (e) => { e.scrollLeft = 40; }); await p.waitForTimeout(100);
    eq((await cls())[0], [true, true, true], 'both sides');
    await p.$eval('#ribbonTabs', (e) => { e.scrollLeft = e.scrollWidth; }); await p.waitForTimeout(100);
    eq((await cls())[0], [true, false, true], 'at the end');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('phone: touch targets are at least 44px (Stop, the text format bar, title and status bar); desktop keeps its sizes', async () => {
    const sizes = (p) => p.$$eval('.mode-stop, .txt-b, .tb-actions .icon-btn, .tb-actions .btn, .sb-pages, .sb-zoom .icon-btn', (b) => b.filter((x) => x.getClientRects().length).map((x) => [x.className.split(' ').filter((c) => c !== 'icon-btn' && c !== 'btn')[0] || x.id, Math.round(x.getBoundingClientRect().width), Math.round(x.getBoundingClientRect().height)]));
    const p = await open({ width: 390, height: 844, touch: true, ua: ANDROID }); await openPdf(p, WORD, 'Pelican report.pdf');
    await editLine(p); await p.waitForSelector('.txt-bar .txt-b');
    const ph = await sizes(p);
    ok(ph.length > 8 && ph.every(([, w, hh]) => w >= 44 && hh >= 44), JSON.stringify(ph.filter(([, w, hh]) => w < 44 || hh < 44)));
    ok(await p.$eval('#modeChip', (e) => e.getBoundingClientRect().height <= 30), 'the chip keeps its size');
    await shot(p, 'phone-dark-line-editor.png');
    await p.ctx.close();
    const d = await open(); await openPdf(d, WORD, 'Pelican report.pdf');
    await editLine(d);
    const dk = Object.fromEntries((await sizes(d)).map(([k, w]) => [k, w]));
    eq([dk['mode-stop'], dk['txt-b']], [22, 30], 'desktop');
    await shot(d, 'desktop-dark-line-editor.png');
    await d.ctx.close();
  });

  await test('iPhone: a small form field zooms the page so its text is 16px or more, keeps the focus, and the zoom goes back after', async () => {
    const p = await open({ width: 390, height: 844, touch: true, ua: IPHONE }); await openPdf(p);
    ok((await p.$eval('meta[name="viewport"]', (m) => m.content)).includes('maximum-scale=1'), 'WebKit does not zoom the window');
    const z0 = await p.evaluate(() => window.__cowdreyPdf.views()[0].el.getBoundingClientRect().width);
    const f = p.locator('.annotationLayer input[name="name"]');
    ok(parseFloat(await f.evaluate((e) => getComputedStyle(e).fontSize)) < 16, 'small at fit');
    const b = await f.boundingBox(); await p.touchscreen.tap(b.x + 20, b.y + b.height / 2);
    await p.waitForFunction(() => { const a = document.activeElement; return a && a.name === 'name' && parseFloat(getComputedStyle(a).fontSize) >= 16; }, null, { timeout: 5000 });
    const r = await p.evaluate(() => { const a = document.activeElement, b = a.getBoundingClientRect(), v = document.querySelector('#viewer').getBoundingClientRect(); return [b.top >= v.top && b.bottom <= v.bottom, b.height]; });
    ok(r[0] && r[1] >= 16, 'in view and tall enough ' + JSON.stringify(r));
    await p.keyboard.type('Ada'); await shot(p, 'iphone-dark-form-zoom.png');
    await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(1200);
    const z1 = await p.evaluate(() => window.__cowdreyPdf.views()[0].el.getBoundingClientRect().width);
    ok(Math.abs(z1 - z0) < 2, `zoom back ${z0} ${z1}`);
    eq(await p.$eval('.annotationLayer input[name="name"]', (e) => e.value), 'Ada');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Android: Back closes the top thing first (dialog, sidebar, tool) and leaves only when nothing is open', async () => {
    const p = await open({ width: 390, height: 844, touch: true, ua: ANDROID }); await openPdf(p);
    const st = () => p.evaluate(() => ({ ours: !!(history.state && history.state.cowdreyBack), tool: document.querySelector('#app, .app').dataset.tool, side: document.querySelector('.app').dataset.sidebar, dlg: document.querySelector('#dialog').open }));
    const back = async () => { await p.evaluate(() => history.back()); await p.waitForTimeout(250); };
    eq((await st()).ours, false, 'nothing open: Back leaves');
    await p.evaluate(() => window.__cowdreyPdf.run('tool_rect')); await p.waitForTimeout(150);
    await p.evaluate(() => window.__cowdreyPdf.run('sidebar')); await p.waitForTimeout(250);
    let s = await st(); eq([s.ours, s.tool, s.side], [true, 'rect', 'open']);
    const len = await p.evaluate(() => history.length);
    await back(); s = await st(); eq([s.ours, s.tool, s.side], [true, 'rect', 'on'], 'sidebar first, then still armed for the tool');
    eq(await p.evaluate(() => history.length), len, 'one entry, reused');
    await back(); s = await st(); eq([s.ours, s.tool], [false, 'select'], 'then the tool');
    // A dialog.
    p.evaluate(() => window.__cowdreyPdf.run('extract')); await p.waitForSelector('#dialog[open]'); await p.waitForTimeout(150);
    eq((await st()).ours, true);
    await back(); s = await st(); eq([s.dlg, s.ours], [false, false], 'dialog closed');
    // Closed some other way: the entry goes, so the next Back leaves at once.
    await p.evaluate(() => window.__cowdreyPdf.run('tool_pen')); await p.waitForTimeout(150); eq((await st()).ours, true);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    s = await st(); eq([s.ours, s.tool], [false, 'select'], 'entry taken away');
    ok(await p.$('.page canvas.pdf'), 'still in the app'); eq(p.errors, []); await p.ctx.close();
  });
};
