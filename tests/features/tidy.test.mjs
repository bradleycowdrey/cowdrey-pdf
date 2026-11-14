// Small feedback: the first redaction mark says what comes next; thumbnails keep their size while drawn; bookmarks
// with no destination; a new bookmark's name; font names in the format bar.
export default async (h) => {
  const { test, eq, ok, open, openPdf, at, WORD } = h;
  const drag = async (p, [x1, y1], [x2, y2]) => { const [a, b] = await at(p, x1, y1), [c, d] = await at(p, x2, y2); await p.mouse.move(a, b); await p.mouse.down(); await p.mouse.move(c, d, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(150); };

  await test('tidy: the first redaction mark says it is not removed yet, with Apply at hand; later marks do not repeat it', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.click('[data-rt="protect"]'); await p.click('[data-cmd="protRedArea"]');
    await drag(p, [380, 560], [460, 400]);
    eq(await p.$eval('#toast', (t) => [t.classList.contains('show'), t.firstChild.textContent.trim()]), [true, '1 area marked. Apply redactions removes it for good.']);
    ok(await p.$('#toast button:has-text("Apply")'), 'Apply button');
    await p.evaluate(() => { const t = document.querySelector('#toast'); t.classList.remove('show'); t.textContent = ''; });
    await drag(p, [100, 300], [200, 280]);
    ok(!/area marked/.test(await p.textContent('#toast')), 'not again: ' + await p.textContent('#toast'));
    await p.evaluate(() => window.__cowdreyPdf.run('undo')); await p.evaluate(() => window.__cowdreyPdf.run('undo'));
    await p.evaluate(() => window.__cowdreyPdf.run('protRedArea')); await drag(p, [380, 560], [460, 400]);
    await p.click('#toast button:has-text("Apply")'); await p.waitForSelector('#dialog[open]');
    ok(/Apply redactions/.test(await p.textContent('#dialog h2')), 'Apply opens Apply redactions');
    await p.ctx.close();
  });
};
