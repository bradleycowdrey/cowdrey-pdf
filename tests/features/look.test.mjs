// Look and feel: the format bar's swatches on dark, split buttons as one shape, the header and footer fields, the
// phone title, the phone's tool hint, the text format bar's place, its Font, alignment and line spacing, and the
// Comment tab's groups.
export default async (h) => {
  const { test, eq, ok, open, openPdf, WORD } = h;
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id).then(() => p.waitForTimeout(200));
  const clickLine = async (p, text, dx = 20) => {
    const s = p.locator('.page[data-n="0"] .textLayer span', { hasText: text }).first(); await s.scrollIntoViewIfNeeded();
    const b = await s.boundingBox(); await p.mouse.click(b.x + dx, b.y + b.height / 2); await p.waitForSelector('.txt-bar'); await p.waitForTimeout(300);
  };

  await test('look: the format bar\'s "colour now" swatch has a visible edge on dark and on light', async () => {
    for (const scheme of ['dark', 'light']) {
      const p = await open({ scheme }); await openPdf(p, WORD, 'Pelican report.pdf');
      await run(p, 'tool_edit'); await clickLine(p, 'Budget');
      const sh = await p.$eval('.txt-bar .swatch[aria-pressed="true"]', (b) => getComputedStyle(b).boxShadow);
      ok(/inset/.test(sh), scheme + ': an inside edge ' + sh);
      ok(scheme === 'dark' ? /rgba\(255, 255, 255/.test(sh) : /rgba\(0, 0, 0/.test(sh), scheme + ': the edge stands out from the bar ' + sh);
      eq(p.errors, []); await p.ctx.close();
    }
  });

  await test('look: a split button\'s arrow is inside its hover and pressed tint (one shape)', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="pages"]');
    const split = p.locator('.rb-split:has([data-cmd="rotR"])');
    await p.locator('[data-cmd="rotR"]').hover(); await p.waitForTimeout(150);
    const bg = (s) => s.evaluate((e) => getComputedStyle(e).backgroundColor);
    const clear = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
    ok(!clear(await bg(split)), 'the whole split button is tinted on hover');
    const box = await split.boundingBox(), more = await split.locator('.rb-more').boundingBox();
    ok(more.x + more.width <= box.x + box.width + .5 && more.x >= box.x, 'the arrow is inside the tinted shape');
    // pressed: a command with a list that is on tints both halves
    await p.evaluate(() => { const b = document.querySelector('[data-cmd="rotR"]'); b.setAttribute('aria-pressed', 'true'); });
    await p.mouse.move(5, 500); await p.waitForTimeout(150);
    const soft = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim());
    const want = await p.evaluate((c) => { const d = document.createElement('div'); d.style.background = c; document.body.appendChild(d); const v = getComputedStyle(d).backgroundColor; d.remove(); return v; }, soft);
    eq(await bg(split), want, 'pressed tint on the whole shape');
    eq(await bg(split.locator('.rb-more')), 'rgba(0, 0, 0, 0)', 'the arrow has no tint of its own');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('look: Header & footer shows each place\'s text in full', async () => {
    const p = await open(); await openPdf(p);
    p.evaluate(() => window.__cowdreyPdf.run('pd_headfoot')); await p.waitForSelector('#dialog[open] [data-k="bc"]'); await p.waitForTimeout(300);
    const f = await p.$eval('#dialog [data-k="bc"]', (i) => [i.value, i.scrollWidth <= i.clientWidth, i.title]);
    eq(f, ['Page <<page>> of <<pages>>', true, 'Page <<page>> of <<pages>>']);
    // the preview is still beside the settings
    const [pv, main] = await Promise.all(['#dialog .pd-prev', '#dialog .pd-main'].map((s) => p.$eval(s, (e) => e.getBoundingClientRect().toJSON())));
    ok(pv.left >= main.right, 'preview beside the settings');
    await p.fill('#dialog [data-k="tl"]', 'Project Pelican: status report, draft two');
    eq(await p.$eval('#dialog [data-k="tl"]', (i) => i.title), 'Project Pelican: status report, draft two', 'a long one says it all on hover');
    await p.ctx.close();
  });

  await test('look: a phone title cut in the middle has no gap before the kept end', async () => {
    const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p, WORD, 'pdfelement-guide-for-everyone.pdf');
    const r = await p.evaluate(() => { const a = document.querySelector('#docTitle .dt-a'), b = document.querySelector('#docTitle .dt-b'); return { a: a.textContent, b: b.textContent, gap: b.getBoundingClientRect().left - a.getBoundingClientRect().right, fits: a.scrollWidth <= a.clientWidth, title: document.querySelector('#docTitle').title }; });
    ok(r.a.endsWith('…'), 'cut: ' + r.a); ok(Math.abs(r.gap) < 1, 'no gap: ' + r.gap); ok(r.fits, 'no second ellipsis');
    eq(r.title, 'pdfelement-guide-for-everyone');
    // a wider screen shows it all again
    await p.setViewportSize({ width: 1200, height: 844 }); await p.waitForTimeout(300);
    eq(await p.$eval('#docTitle', (t) => t.textContent), 'pdfelement-guide-for-everyone');
    await p.ctx.close();
  });

  await test('look: on a phone, the Edit PDF hint toast goes when you leave the tool', async () => {
    const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p, WORD, 'Pelican report.pdf');
    await run(p, 'tool_edit');
    ok(await p.$eval('#toast', (t) => t.classList.contains('show') && /Tap text/.test(t.textContent)), 'hint shown');
    await run(p, 'tool_select');
    eq(await p.$eval('#toast', (t) => t.classList.contains('show')), false, 'gone with the tool');
    await p.ctx.close();
  });
};
