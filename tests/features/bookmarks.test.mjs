// Bookmarks: the Outline tab adds, renames, nests, moves and deletes bookmarks; they are saved as the PDF's /Outlines
// with each /Dest on the right page of the saved file, even after pages move or are deleted.
export default async (h) => {
  const { test, open, openPdf, eq, ok, savedOf, reopen, require, path, root, fs, PDFDocument } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const N = (s) => L.PDFName.of(s);
  const tmp = path.join(require('node:os').tmpdir(), `cowdrey-bm-${process.pid}.pdf`);
  // The saved outline: [title, saved page index (or null), [children]], plus the Count of each level.
  const outlineOf = (d) => {
    const refs = d.getPages().map((pg) => pg.ref.toString());
    const root = d.catalog.lookup(N('Outlines')); if (!root) return null;
    const level = (first) => {
      const out = []; let r = first;
      while (r) {
        const it = d.context.lookup(r); const dest = it.lookup(N('Dest'));
        const t = it.lookup(N('Title'));
        const kids = it.get(N('First')) ? level(it.get(N('First'))) : [];
        const row = [t.decodeText(), dest ? refs.indexOf(String(dest.get(0))) : null];
        if (kids.length) row.push(kids, it.lookup(N('Count')).asNumber());
        out.push(row); r = it.get(N('Next'));
      }
      return out;
    };
    return level(root.get(N('First')));
  };
  // Four pages, each with a heading; an outline: "Intro" (page 1) with child "Scope" (page 2), then "Results" (page 4).
  async function withOutline() {
    const d = await L.PDFDocument.create(), f = await d.embedFont(L.StandardFonts.HelveticaBold), r = await d.embedFont(L.StandardFonts.Helvetica);
    const pages = [1, 2, 3, 4].map((n) => { const pg = d.addPage([612, 792]); pg.drawText(`Chapter ${n}`, { x: 72, y: 700, size: 22, font: f }); pg.drawText(`Body text on page ${n}, in a smaller size.`, { x: 72, y: 660, size: 11, font: r }); return pg; });
    const c = d.context, rootRef = c.nextRef(), intro = c.nextRef(), scope = c.nextRef(), results = c.nextRef();
    c.assign(scope, c.obj({ Title: L.PDFHexString.fromText('Scope'), Parent: intro, Dest: [pages[1].ref, 'XYZ', null, 792, null] }));
    c.assign(intro, c.obj({ Title: L.PDFHexString.fromText('Intro'), Parent: rootRef, Next: results, First: scope, Last: scope, Count: 1, Dest: [pages[0].ref, 'Fit'] }));
    c.assign(results, c.obj({ Title: L.PDFHexString.fromText('Results'), Parent: rootRef, Prev: intro, Dest: [pages[3].ref, 'XYZ', 0, 500, null] }));
    c.assign(rootRef, c.obj({ Type: 'Outlines', First: intro, Last: results, Count: 3 }));
    d.catalog.set(N('Outlines'), rootRef); d.setTitle('Report');
    fs.writeFileSync(tmp, await d.save()); return tmp;
  }
  const jump = async (p, n) => {
    await p.$eval('#pageJump', (e, v) => { e.value = v; e.dispatchEvent(new Event('change')); }, String(n));
    await p.waitForFunction((k) => window.__cowdreyPdf.current === k, n - 1, { timeout: 5000 }); await p.waitForTimeout(700);
  };
  const titles = (p) => p.$$eval('#sidePanel .bm-row', (r) => r.map((x) => { const d = x.parentElement.parentElement.closest('[data-bm]') ? '  ' : ''; return d + (x.querySelector('.bm-t') || {}).textContent + ' ' + x.querySelector('.bm-pg').textContent; }));
  const row = (p, title) => p.locator('#sidePanel .bm-row', { has: p.locator('.bm-t', { hasText: title }) }).first();
  const tool = (p, a) => p.click(`#sidePanel [data-bma="${a}"]`).then(() => p.waitForTimeout(250));
  const typeName = async (p, name) => { await p.waitForSelector('#sidePanel .bm-in'); await p.fill('#sidePanel .bm-in', name); await p.keyboard.press('Enter'); await p.waitForTimeout(250); };

  await test('Bookmarks: add (Ctrl+B, named after the heading), rename, add child, set page, drag to nest, delete; saved with the right pages after a page moves', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-side="outline"]'); await p.waitForTimeout(200);
    ok(/No bookmarks yet/.test(await p.textContent('#sidePanel')), 'empty');
    await jump(p, 2);
    await p.click('#viewer'); await p.keyboard.press('Control+b');
    await p.waitForSelector('#sidePanel .bm-in');
    eq(await p.inputValue('#sidePanel .bm-in'), 'Quarterly report, page 2', 'named after the heading');
    await typeName(p, 'Second');
    await jump(p, 3); await tool(p, 'add'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
    eq(await titles(p), ['Second 2', 'Quarterly report, page 3 3']);
    // child of "Second", then point it at page 1 (the arrow keys choose without leaving the page)
    await row(p, 'Second').click(); await p.waitForTimeout(500);
    await tool(p, 'child'); await typeName(p, 'Detail');
    eq(await titles(p), ['Second 2', '  Detail 2', 'Quarterly report, page 3 3']);
    await jump(p, 1);
    await row(p, 'Detail').focus(); await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowDown');
    eq(await p.evaluate(() => window.__cowdreyPdf.current), 0, 'still on page 1');
    await tool(p, 'dest');
    eq(await titles(p), ['Second 2', '  Detail 1', 'Quarterly report, page 3 3']);
    // rename with a double-click and with F2
    await row(p, 'Quarterly report, page 3').dblclick(); await typeName(p, 'Third');
    await row(p, 'Detail').focus(); await p.keyboard.press('F2'); await typeName(p, 'Details');
    // drag "Third" onto the middle of "Second": it goes inside, after "Details"
    await row(p, 'Third').dragTo(row(p, 'Second'), { targetPosition: { x: 40, y: 16 } }); await p.waitForTimeout(300);
    eq(await titles(p), ['Second 2', '  Details 1', '  Third 3']);
    // drag "Details" onto the top edge of "Second": before it, at the top level
    await row(p, 'Details').dragTo(row(p, 'Second'), { targetPosition: { x: 40, y: 2 } }); await p.waitForTimeout(300);
    eq(await titles(p), ['Details 1', 'Second 2', '  Third 3']);
    // a throwaway bookmark, deleted with the Delete key
    await jump(p, 3); await p.click('#viewer'); await p.keyboard.press('Control+b'); await typeName(p, 'Gone soon');
    await row(p, 'Gone soon').focus(); await p.keyboard.press('Delete'); await p.waitForTimeout(250);
    eq(await titles(p), ['Details 1', 'Second 2', '  Third 3']);
    // undo brings it back; redo deletes it again
    await p.click('#viewer'); await p.keyboard.press('Control+z'); await p.waitForTimeout(300);
    ok((await titles(p)).some((t) => t.startsWith('Gone soon')), 'undone');
    await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(300);
    // move page 1 to the end: "Details" follows it
    await jump(p, 1); await p.evaluate(() => { window.__cowdreyPdf.run('down'); window.__cowdreyPdf.run('down'); }); await p.waitForTimeout(600);
    eq(await titles(p), ['Details 3', 'Second 1', '  Third 2']);
    const bytes = await savedOf(p), d = await PDFDocument.load(bytes);
    eq(outlineOf(d), [['Details', 2], ['Second', 0, [['Third', 1]], 1]]);
    eq(d.getPage(2).getHeight(), 792);
    // reopened: the Outline tab shows them
    await reopen(p, bytes); await p.waitForTimeout(300);
    eq(await titles(p), ['Details 3', 'Second 1', '  Third 2']);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Bookmarks: the PDF’s own outline becomes editable on the first change and replaces the old one on save; a deleted page’s bookmark keeps no destination', async () => {
    const p = await open(); await openPdf(p, await withOutline(), 'Report.pdf');
    await p.click('[data-side="outline"]'); await p.waitForTimeout(300);
    eq(await titles(p), ['Intro 1', '  Scope 2', 'Results 4']);
    // nothing changed: the outline is saved as it was
    let d = await PDFDocument.load(await savedOf(p));
    eq(outlineOf(d), [['Intro', 0, [['Scope', 1]], 1], ['Results', 3]]);
    eq(await p.evaluate(() => (window.__cowdreyPdf.doc.marks.__doc || []).length), 0, 'not imported yet');
    await row(p, 'Results').dblclick(); await typeName(p, 'Findings');
    // collapse all, then delete page 2 ("Scope"'s page) and add a bookmark on the new page 2 (old page 3)
    await tool(p, 'toggle');
    eq(await titles(p), ['Intro 1', 'Findings 4']);
    await tool(p, 'toggle');
    await jump(p, 2); await p.evaluate(() => window.__cowdreyPdf.run('delPage')); await p.waitForTimeout(600);
    eq(await titles(p), ['Intro 1', '  Scope –', 'Findings 3']);
    ok(await p.$('#sidePanel .bm-gone'), 'shown as gone');
    await row(p, 'Intro').click(); await p.waitForTimeout(400);
    await jump(p, 2); await p.click('#viewer'); await p.keyboard.press('Control+b'); await p.waitForSelector('#sidePanel .bm-in');
    eq(await p.inputValue('#sidePanel .bm-in'), 'Chapter 3', 'named after the heading'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
    const bytes = await savedOf(p); d = await PDFDocument.load(bytes);
    eq(outlineOf(d), [['Intro', 0, [['Scope', null]], 1], ['Chapter 3', 1], ['Findings', 2]]);
    // the old outline's items are not left in the file
    const titled = [...d.context.enumerateIndirectObjects()].filter(([, o]) => o instanceof L.PDFDict && o.get(N('Title')) && o.get(N('Parent')));
    eq(titled.length, 4, 'only the new outline items');
    // the saved destination keeps the place on the page it had
    const res = d.context.lookup(d.catalog.lookup(N('Outlines')).get(N('Last')));
    eq(res.lookup(N('Dest')).get(3).asNumber(), 500);
    // all deleted: the saved PDF has no outline
    for (const t of ['Findings', 'Chapter 3', 'Intro']) { await row(p, t).focus(); await p.keyboard.press('Delete'); await p.waitForTimeout(200); }
    ok(/No bookmarks yet/.test(await p.textContent('#sidePanel')), 'empty');
    d = await PDFDocument.load(await savedOf(p)); eq(outlineOf(d), null);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Bookmarks: on a phone the toolbar fits the sidebar and Ctrl+B adds without opening it', async () => {
    const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p);
    await p.evaluate(() => window.__cowdreyPdf.run('bmAdd')); await p.waitForTimeout(400);
    eq((await p.evaluate(() => window.__cowdreyPdf.bmTree())).map((b) => b.title), ['Quarterly report, page 1']);
    eq(await p.$eval('#app', (a) => a.dataset.sidebar !== 'open'), true, 'sidebar stays shut');
    await p.evaluate(() => window.__cowdreyPdf.run('sidebar')); await p.click('[data-side="outline"]'); await p.waitForTimeout(300);
    const r = await p.$eval('#sidePanel .bm-bar', (b) => { const x = b.getBoundingClientRect(), s = b.closest('.sidebar').getBoundingClientRect(); return x.right <= s.right && b.scrollWidth <= b.clientWidth + 1; });
    ok(r, 'toolbar fits');
    await p.ctx.close();
  });
};
