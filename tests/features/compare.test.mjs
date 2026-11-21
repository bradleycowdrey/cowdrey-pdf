// Compare: two versions of a PDF, made here with pdf-lib. New has a page put in after page 1, "March" changed to
// "April", "urgent" taken out, "net 30" put in, and a filled box moved on the last page.
export default async (h) => {
  const { test, eq, ok, open, openPdf, require, path, root, fs, PDFDocument, answer } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const pdfjs = await import(path.join(root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));

  const PAGE1_OLD = ['Invoice 4471 for design work', 'Please pay the urgent invoice below.', 'The work was done in March 2026.', 'Payment terms apply to this invoice.', 'Thank you for your business.'];
  const PAGE1_NEW = ['Invoice 4471 for design work', 'Please pay the invoice below.', 'The work was done in April 2026.', 'Payment terms net 30 apply to this invoice.', 'Thank you for your business.'];
  const PAGE2 = ['Project summary', 'The new brand guide covers colours, type and layout.', 'Three rounds of changes were made with the team.', 'Every file was delivered in print and web formats.'];
  const INSERTED = ['Extra services', 'Photography for the launch was added late.', 'It is billed separately at the agreed day rate.'];
  const LAST = ['Appendix', 'The chart below shows the hours spent each week.'];
  async function makePdf(pages) {
    const d = await PDFDocument.create(), f = await d.embedFont(L.StandardFonts.Helvetica);
    for (const pg of pages) {
      const p = d.addPage([612, 792]);
      pg.lines.forEach((t, k) => p.drawText(t, { x: 72, y: 700 - k * 24, size: 13, font: f }));
      if (pg.box) p.drawRectangle({ x: pg.box[0], y: pg.box[1], width: 150, height: 80, color: L.rgb(0.15, 0.35, 0.8) });
    }
    return Buffer.from(await d.save());
  }
  const OLD = await makePdf([{ lines: PAGE1_OLD }, { lines: PAGE2 }, { lines: LAST, box: [100, 300] }]);
  const NEW = await makePdf([{ lines: PAGE1_NEW }, { lines: INSERTED }, { lines: PAGE2 }, { lines: LAST, box: [130, 320] }]);
  const tmp = path.join(root, 'tests/.cmp-new.pdf'); fs.writeFileSync(tmp, NEW);
  const start = (p, bytes, o = {}) => p.evaluate(async ([b, o]) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const r = await window.__cowdreyPdf.cmpStart({ bytes: u, name: 'Invoice v1.pdf', ...o }); return !!r; }, [bytes.toString('base64'), o]);
  const state = (p) => p.evaluate(() => window.__cowdreyPdf.cmpState());
  const kinds = (s) => s.changes.map((c) => [c.kind, c.n, c.was, c.now]);
  const annotsOf = (d) => d.getPages().map((pg) => { const a = pg.node.Annots(); return a ? a.asArray().map((r) => { const x = d.context.lookup(r); const s = (k) => { const v = x.get(L.PDFName.of(k)); return v ? (v.decodeText ? v.decodeText() : String(v)) : null; }; return { sub: s('Subtype'), contents: s('Contents'), quads: !!x.get(L.PDFName.of('QuadPoints')), ap: !!x.get(L.PDFName.of('AP')) }; }) : []; });
  const textOf = async (bytes, n) => { const pd = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise; const tc = await (await pd.getPage(n)).getTextContent(); return tc.items.map((i) => i.str).join(' '); };

  await test('compare: the menu and ribbon open the picker; the chosen PDF is Old, the open one New; the changes are exactly what changed', async () => {
    const p = await open(); await openPdf(p, tmp, 'Invoice v2.pdf');
    ok(await p.evaluate(() => window.__cowdreyPdf.menus().find(([t]) => t === 'File')[1].includes('compare')), 'in the File menu');
    ok(await p.evaluate(() => window.__cowdreyPdf.ribbon().export[1].some(([g, ids]) => g === 'Compare' && ids.includes('compare'))), 'on the Export tab, next to Insight');
    const requests = []; p.on('request', (r) => { if (!/^(data|blob):/.test(r.url())) requests.push(r.url()); });
    await p.click('[data-rt="export"]'); await p.click('#ribbonBody [data-cmd="compare"]');
    await p.setInputFiles('#cmpInput', { name: 'Invoice v1.pdf', mimeType: 'application/pdf', buffer: OLD });
    await p.waitForSelector('#dialog[open] .cmp-dlg');
    eq(await p.$eval('[data-role="new"]', (e) => e.textContent), 'Invoice v2'); eq(await p.$eval('[data-role="old"]', (e) => e.textContent), 'Invoice v1');
    await p.click('#dialog [data-swap]'); eq(await p.$eval('[data-role="new"]', (e) => e.textContent), 'Invoice v1', 'swapped');
    await p.click('#dialog [data-swap]');
    await answer(p, 'Compare');
    await p.waitForFunction(() => window.__cowdreyPdf.cmpState() && document.querySelector('#cmpView .cmp-busy').hidden, null, { timeout: 20000 });
    const s = await state(p);
    eq([s.old, s.new], ['Invoice v1', 'Invoice v2']);
    eq(s.pairs, [[0, 0], [null, 1], [1, 2], [2, 3]], 'pages lined up');
    eq(kinds(s), [['delete', 0, 'urgent', ''], ['replace', 0, 'March', 'April'], ['insert', 0, '', 'net 30'], ['pageInsert', 1, '', 'Page 2'], ['visual', 3, '', '']]);
    eq(s.changes.filter((c) => c.n === 2).length, 0, 'no false changes after the inserted page');
    // the view: two panes, the list grouped by page with counts, the filters
    ok(await p.$eval('#cmpView', (e) => !e.hidden && document.querySelector('#app').classList.contains('cmp-on')), 'compare mode');
    eq(await p.$$eval('#cmpView .cmp-pane', (e) => e.filter((x) => x.offsetParent).length), 2, 'side by side');
    eq(await p.$$eval('#cmpView .cmp-grp h3', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim())), ['Page 1 3', 'Page 2 1', 'Page 4 (Old page 3) 1']);
    eq(await p.$eval('#cmpView .cmp-sum', (e) => e.textContent), '5 changes');
    eq(await p.$$eval('#cmpView .cmp-missing', (e) => e.map((x) => x.closest('.cmp-pane').dataset.side)), ['old'], 'a gap for the inserted page on Old');
    // coloured overlays on both sides
    await p.waitForFunction(() => document.querySelectorAll('#cmpView .cmp-pane[data-side="new"] .cmp-hl').length >= 3);
    const hl = await p.$$eval('#cmpView .cmp-pane[data-side="new"] .cmp-row[data-r="0"] .cmp-hl', (e) => e.map((x) => x.className.split(' ')[1]));
    eq([...new Set(hl)].sort(), ['k-delete', 'k-insert', 'k-replace']);
    ok(await p.$eval('#cmpView .cmp-pane[data-side="old"] .cmp-row[data-r="0"] .cmp-hl.k-delete:not(.gap)', (e) => e.offsetWidth > 20), 'the removed word is marked on Old');
    // stepping with ] and [; clicking in the list
    eq(await p.textContent('#cmpView .cmp-count'), '1 of 5');
    await p.keyboard.press(']'); await p.keyboard.press(']'); eq((await state(p)).now, 2); eq(await p.textContent('#cmpView .cmp-count'), '3 of 5');
    await p.keyboard.press('['); eq((await state(p)).now, 1);
    await p.click('#cmpView .cmp-item.k-visual'); eq((await state(p)).now, 4);
    ok(await p.waitForSelector('#cmpView .cmp-pane[data-side="new"] .cmp-hl.k-visual.now', { timeout: 5000 }), 'the picture change is marked');
    // filters: hiding Added leaves 4 to step through
    await p.click('#cmpView .cmp-chip[data-f="insert"]');
    eq(await p.textContent('#cmpView .cmp-count'), '5 of 5'.replace('5 of 5', '4 of 4'));
    ok(await p.$eval('#cmpView .cmp-item.k-insert', (e) => !e.offsetParent), 'hidden in the list');
    await p.click('#cmpView .cmp-chip[data-f="insert"]');
    eq(requests, [], 'nothing sent anywhere');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('compare: scrolling one side scrolls the other to the page lined up with it; zoom is shared; Overlay shows Old behind New', async () => {
    const p = await open(); await openPdf(p, tmp, 'Invoice v2.pdf');
    ok(await start(p, OLD), 'started');
    const topPage = (side) => p.$eval(`#cmpView .cmp-pane[data-side="${side}"] .cmp-scroll`, (sc) => {
      const at = sc.scrollTop + 20; const row = [...sc.querySelectorAll('.cmp-row')].find((r) => r.offsetTop <= at && at < r.offsetTop + r.offsetHeight);
      const slot = row && row.querySelector('.cmp-slot'); return slot ? +slot.dataset.k : row ? 'gap' : null;
    });
    await p.$eval('#cmpView .cmp-pane[data-side="new"] .cmp-scroll', (sc) => { sc.scrollTop = sc.querySelector('.cmp-row[data-r="2"]').offsetTop; });
    await p.waitForTimeout(300);
    eq([await topPage('new'), await topPage('old')], [2, 1], 'New page 3 is next to Old page 2');
    await p.$eval('#cmpView .cmp-pane[data-side="old"] .cmp-scroll', (sc) => { sc.scrollTop = sc.querySelector('.cmp-row[data-r="3"]').offsetTop; });
    await p.waitForTimeout(300);
    eq([await topPage('old'), await topPage('new')], [2, 3], 'and back the other way');
    await p.waitForTimeout(300);
    ok(await p.$eval('#cmpView .cmp-pane[data-side="new"] .cmp-row[data-r="3"] canvas.cmp-pdf', (c) => c.width > 100), 'pages drawn');
    const w0 = await p.$eval('#cmpView .cmp-pane[data-side="old"] .cmp-slot', (e) => e.offsetWidth);
    await p.click('#cmpView [data-c="zoomIn"]');
    const [wo, wn] = await Promise.all(['old', 'new'].map((s) => p.$eval(`#cmpView .cmp-pane[data-side="${s}"] .cmp-slot`, (e) => e.offsetWidth)));
    ok(wo > w0 * 1.2 && Math.abs(wo - wn) < 1, `both zoomed ${w0} → ${wo}, ${wn}`);
    await p.click('#cmpView [data-mode="overlay"]');
    eq(await p.$$eval('#cmpView .cmp-pane', (e) => e.filter((x) => x.offsetParent).map((x) => x.dataset.side)), ['new'], 'one view');
    await p.waitForFunction(() => document.querySelector('#cmpView .cmp-pane[data-side="new"] canvas.cmp-under'));
    eq(await p.$eval('#cmpView canvas.cmp-under', (c) => getComputedStyle(c).opacity), '0.35', 'Old faint behind');
    await p.click('#cmpView [data-mode="side"]');
    // Close compare: back to the document as it was
    await p.keyboard.press('Escape');
    ok(await p.$eval('#cmpView', (e) => e.hidden) && !(await p.evaluate(() => document.querySelector('#app').classList.contains('cmp-on'))), 'closed');
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.sources.length), 1, 'the other PDF was never added');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('compare: the report is a copy of New with Highlight, StrikeOut, Square and page comments that say what changed, after a cover page with the counts; the document gets no marks', async () => {
    const p = await open(); await openPdf(p, tmp, 'Invoice v2.pdf');
    ok(await start(p, OLD));
    const before = await p.evaluate(() => JSON.stringify(window.__cowdreyPdf.doc.marks));
    const [dl] = await Promise.all([p.waitForEvent('download'), (async () => { await p.click('#cmpView [data-c="report"]'); await answer(p, 'Save report'); })()]);
    eq(dl.suggestedFilename(), 'Invoice v2 compared.pdf');
    const bytes = fs.readFileSync(await dl.path()), d = await PDFDocument.load(bytes);
    eq(d.getPageCount(), 5, 'a cover page and the 4 pages of New');
    const an = annotsOf(d);
    eq(an[0], [], 'no comments on the cover');
    const p1 = an[1].map((a) => [a.sub, a.contents]).sort();
    eq(p1, [['Highlight', 'Added\nNow: net 30'], ['Highlight', 'Changed\nWas: March\nNow: April'], ['StrikeOut', 'Removed\nWas: urgent']]);
    ok(an[1].every((a) => a.quads && a.ap), 'QuadPoints and an appearance');
    eq(an[2].map((a) => [a.sub, a.contents]), [['FreeText', 'Page inserted']]);
    eq(an[3], [], 'nothing on the unchanged page');
    eq(an[4].map((a) => [a.sub, a.contents]), [['Square', 'Picture or drawing changed']]);
    const cover = await textOf(bytes, 1);
    for (const t of ['Compare report', 'New: Invoice v2', 'Old: Invoice v1', 'Changes: 5', 'Text added: 1', 'Text removed: 1', 'Text changed: 1', 'Pictures or drawings changed: 1', 'Pages inserted: 1', 'Pages removed: 0', 'Page 2 (New page 1): 1 added, 1 removed, 1 changed', 'Page 3 (New page 2): page inserted', 'Page 5 (New page 4): 1 picture or drawing'])
      ok(cover.includes(t), `cover has "${t}": ${cover}`);
    ok((await textOf(bytes, 2)).includes('Payment terms net 30 apply'), 'the pages are New');
    eq(await p.evaluate(() => JSON.stringify(window.__cowdreyPdf.doc.marks)), before, 'no new marks');
    // marked on Old: StrikeOut on the words taken out or changed, a Caret where words were put in
    const old = Buffer.from(await p.evaluate(async () => Array.from(await window.__cowdreyPdf.cmpReport('old'))));
    const od = await PDFDocument.load(old), oa = annotsOf(od);
    eq(od.getPageCount(), 4);
    eq(oa[1].map((a) => [a.sub, a.contents]).sort(), [['Caret', 'Added\nNow: net 30'], ['StrikeOut', 'Changed\nWas: March\nNow: April'], ['StrikeOut', 'Removed\nWas: urgent']]);
    eq(oa[2].map((a) => [a.sub, a.contents]), [['FreeText', 'New page 2 inserted before this page']]);
    eq(oa[3].map((a) => a.sub), ['Square']);
    // the change list as text
    eq(await p.evaluate(() => window.__cowdreyPdf.cmpListText()), ['Compared “Invoice v1” (Old) with “Invoice v2” (New): 5 changes.', 'Page 1: Removed “urgent”', 'Page 1: Changed “March” to “April”', 'Page 1: Added “net 30”', 'Page 2: Page inserted', 'Page 4: Picture or drawing changed'].join('\n'));
    // and in other readers: pdf.js reads the comments
    const pd = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    const a2 = await (await pd.getPage(2)).getAnnotations();
    eq(a2.map((a) => a.subtype).sort(), ['Highlight', 'Highlight', 'StrikeOut']);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('compare: swap, options (case, punctuation, headers and footers, formatting), a removed page, scans compared as pictures', async () => {
    const p = await open(); await openPdf(p, tmp, 'Invoice v2.pdf');
    // swapped: the open document is Old; the page is then removed and the words go the other way
    ok(await start(p, OLD, { swap: true }));
    let s = await state(p);
    eq([s.old, s.new], ['Invoice v2', 'Invoice v1']);
    eq(kinds(s).map(([k, n, w, x]) => [k, n, w, x]), [['insert', 0, '', 'urgent'], ['replace', 0, 'April', 'March'], ['delete', 0, 'net 30', ''], ['pageRemove', null, 'Page 2', ''], ['visual', 2, '', '']]);
    await p.click('#cmpView [data-c="swap"]'); await p.waitForFunction(() => window.__cowdreyPdf.cmpState().new === 'Invoice v2');
    eq((await state(p)).changes.length, 5, 'swapped back');
    // case and punctuation; a header that differs; a word made bold and bigger
    const mk = async (lines, header, bold) => {
      const d = await PDFDocument.create(), f = await d.embedFont(L.StandardFonts.Helvetica), b = await d.embedFont(L.StandardFonts.HelveticaBold);
      const pg = d.addPage([612, 792]); pg.drawText(header, { x: 72, y: 770, size: 9, font: f });
      lines.forEach((t, k) => pg.drawText(t, { x: 72, y: 600 - k * 24, size: 13, font: f }));
      if (bold) pg.drawText('Total due now', { x: 72, y: 400, size: 15, font: b }); else pg.drawText('Total due now', { x: 72, y: 400, size: 13, font: f });
      return Buffer.from(await d.save());
    };
    const A = await mk(['The Report is ready.', 'Send it today, please.'], 'Draft 1 of the report', false);
    const B = await mk(['the report is ready', 'Send it today please.'], 'Draft 2 of the report', true);
    fs.writeFileSync(tmp, B); await openPdf(p, tmp, 'B.pdf');
    const opts = { ignoreCase: false, ignorePunct: false, ignoreSpace: true, ignoreHeadFoot: false, format: false, visual: false };
    ok(await start(p, A, { opts })); s = await state(p);
    eq(kinds(s).map(([k, , w, x]) => [k, w, x]), [['replace', '1', '2'], ['replace', 'The Report', 'the report'], ['replace', 'ready.', 'ready'], ['replace', 'today,', 'today']]);
    ok(await start(p, A, { opts: { ...opts, ignoreCase: true, ignorePunct: true, ignoreHeadFoot: true } })); s = await state(p);
    eq(s.changes, [], 'nothing left with case, punctuation and the header ignored');
    ok(await start(p, A, { opts: { ...opts, ignoreCase: true, ignorePunct: true, ignoreHeadFoot: true, format: true } })); s = await state(p);
    eq(kinds(s).map(([k, , w, x]) => [k, w, x]), [['format', 'Total due now (Helvetica 13 pt)', 'Total due now (Helvetica-Bold 15 pt)']]);
    // scans: pages with no text are compared as pictures, whatever the option
    const scan = async (extra) => { const d = await PDFDocument.create(); const pg = d.addPage([612, 792]); pg.drawRectangle({ x: 200, y: 400, width: 120, height: 120, color: L.rgb(0, 0, 0) }); if (extra) pg.drawRectangle({ x: 420, y: 600, width: 40, height: 30, color: L.rgb(0.8, 0.1, 0.1) }); pg.drawEllipse({ x: 300, y: 200, xScale: 40, yScale: 40, color: L.rgb(0.5, 0.5, 0.5) }); return Buffer.from(await d.save()); };
    await p.evaluate(async (b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); await window.__cowdreyPdf.openBytes(u, 'Scan B.pdf'); }, (await scan(true)).toString('base64'));
    await p.waitForFunction(() => document.querySelector('.page canvas.pdf'));
    ok(await start(p, await scan(false), { opts })); s = await state(p);
    eq(kinds(s).map(([k, n]) => [k, n]), [['visual', 0]]);
    ok(await start(p, await scan(true), { opts })); eq((await state(p)).changes, [], 'the same scan: no changes');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('compare: Myers diff gives a shortest edit script that rebuilds the new text; pages align around insertions and removals', async () => {
    const p = await open();
    const r = await p.evaluate(() => {
      const H = window.__cowdreyPdf, out = [];
      let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let t = 0; t < 60; t++) {
        const a = Array.from({ length: Math.floor(rnd() * 40) }, () => Math.floor(rnd() * 5)), b = Array.from({ length: Math.floor(rnd() * 40) }, () => Math.floor(rnd() * 5));
        const ops = H.cmpMyers(a, b), rebuilt = [], kept = [];
        let i = 0;
        for (const op of ops) { if (op[0] === 0) { rebuilt.push(a[op[1]]); kept.push(a[op[1]]); } else if (op[0] === 1) rebuilt.push(b[op[1]]); }
        // shortest: as many kept as the longest common subsequence
        const D = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
        for (let x = a.length - 1; x >= 0; x--) for (let y = b.length - 1; y >= 0; y--) D[x][y] = a[x] === b[y] ? D[x + 1][y + 1] + 1 : Math.max(D[x + 1][y], D[x][y + 1]);
        const dels = ops.filter((o) => o[0] === -1).map((o) => o[1]), oldKept = ops.filter((o) => o[0] !== 1).map((o) => o[1]);
        out.push(JSON.stringify(rebuilt) === JSON.stringify(b) && kept.length === D[0][0] && JSON.stringify(oldKept) === JSON.stringify(a.map((_, k) => k)) && dels.length === a.length - kept.length);
        void i;
      }
      const sim = (A, B) => (i, j) => (A[i] === B[j] ? 1 : 0);
      return { ok: out.every(Boolean), al: H.cmpAlign(4, 5, sim(['a', 'b', 'c', 'd'], ['a', 'x', 'b', 'd', 'y'])) };
    });
    ok(r.ok, 'edit scripts');
    eq(r.al, [[0, 0], [null, 1], [1, 2], [2, null], [3, 3], [null, 4]]);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('compare: on a phone, one side at a time with an Old/New switch, and the list of changes in a sheet', async () => {
    fs.writeFileSync(tmp, NEW);
    const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p, tmp, 'Invoice v2.pdf');
    ok(await start(p, OLD));
    eq(await p.$$eval('#cmpView .cmp-pane', (e) => e.filter((x) => x.offsetParent).map((x) => x.dataset.side)), ['new']);
    await p.click('#cmpView [data-show="old"]');
    eq(await p.$$eval('#cmpView .cmp-pane', (e) => e.filter((x) => x.offsetParent).map((x) => x.dataset.side)), ['old']);
    ok(await p.$eval('#cmpView .cmp-side', (e) => !e.offsetParent), 'list closed');
    await p.click('#cmpView [data-c="list"]');
    ok(await p.$eval('#cmpView .cmp-side', (e) => !!e.offsetParent), 'list open');
    await p.click('#cmpView .cmp-item.k-replace');
    ok(await p.$eval('#cmpView .cmp-side', (e) => !e.offsetParent), 'closed after choosing');
    eq(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'nothing scrolls sideways');
    eq(p.errors, []); await p.ctx.close();
    fs.rmSync(tmp, { force: true });
  });
};
