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
    ok(t[0] >= 110, 'the name has room: ' + t[0]); eq(t.slice(1), ['guide', true], 'the end of the name stays');
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
};
