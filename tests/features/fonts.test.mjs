// Text in any language, written into the PDF in embedded Unicode fonts (src/features/05-fonts.js, the text parts of
// saveContentEdits in src/app.js, src/features/10-text.js, src/features/40-page-design.js).
import os from 'node:os';
import http from 'node:http';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

export default async (h) => {
  const { test, eq, ok, open, openPdf, savedOf, path, fs, require, root } = h;
  const pdfjs = await import(path.join(root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const CHROME = path.join(root, 'tests/fixtures/chrome.pdf'), SAMPLE = path.join(root, 'tests/fixtures/sample.pdf');
  const CJK = path.join(root, 'tests/fixtures/fonts-cjk-sample.ttf');
  const tmp = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cpdf-fonts-')), name);
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
  const all = (p) => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat());

  // What pdf.js reads on each page of a saved PDF: [{ s, x, y, font }] in content order.
  const read = async (bytes, password) => {
    const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), password, verbosity: 0, isEvalSupported: false }).promise, out = [];
    for (let i = 1; i <= d.numPages; i++) out.push((await (await d.getPage(i)).getTextContent()).items.filter((x) => x.str !== undefined).map((x) => ({ s: x.str, x: x.transform[4], y: x.transform[5], font: x.fontName })));
    await d.loadingTask.destroy(); return out;
  };
  // The text of a line on page n: the pieces on its baseline, in order along it.
  const lineAt = (pages, n, y, tol = 2) => pages[n].filter((i) => Math.abs(i.y - y) < tol && i.s).sort((a, b) => a.x - b.x).map((i) => i.s).join('');
  // Every stream in a PDF, inflated (content, forms, object streams), as latin1 text.
  const streams = async (bytes) => {
    const d = await L.PDFDocument.load(bytes, { ignoreEncryption: true }), out = [];
    for (const [, o] of d.context.enumerateIndirectObjects()) {
      if (!(o instanceof L.PDFRawStream)) continue;
      try { out.push(Buffer.from(L.decodePDFRawStream(o).decode()).toString('latin1')); } catch { out.push(Buffer.from(o.contents).toString('latin1')); }
    }
    return out;
  };
  // The page's fonts: { name, sub, base, uni (has ToUnicode), file (FontFile2 / FontFile3 embedded) }.
  const fontsOf = async (bytes, n = 0) => {
    const d = await L.PDFDocument.load(bytes, { ignoreEncryption: true }), N = (k) => L.PDFName.of(k);
    const out = [], seen = new Set();
    const walk = (res) => {
      const fd = res && res.lookup(N('Font'));
      if (fd instanceof L.PDFDict) for (const [k, r] of fd.entries()) {
        const f = d.context.lookup(r); if (!(f instanceof L.PDFDict) || seen.has(f)) continue; seen.add(f);
        const desc = f.lookup(N('DescendantFonts')), cid = desc instanceof L.PDFArray ? desc.lookup(0) : null, fdesc = (cid || f).lookup(N('FontDescriptor'));
        out.push({ name: k.asString(), sub: String(f.get(N('Subtype'))), base: String(f.get(N('BaseFont'))), uni: !!f.get(N('ToUnicode')), file: fdesc instanceof L.PDFDict ? ['FontFile2', 'FontFile3', 'FontFile'].filter((x) => fdesc.get(N(x))) : [] });
      }
      const xo = res && res.lookup(N('XObject'));
      if (xo instanceof L.PDFDict) for (const [, r] of xo.entries()) { const x = d.context.lookup(r); if (x && x.dict) walk(x.dict.lookup(N('Resources'))); }
    };
    walk(d.getPage(n).node.Resources());
    return out;
  };
  const pageContent = async (bytes, n = 0) => {
    const d = await L.PDFDocument.load(bytes, { ignoreEncryption: true }), c = d.getPage(n).node.Contents();
    return (c instanceof L.PDFArray ? c.asArray() : [c]).map((r) => { const st = d.context.lookup(r); return Buffer.from(st instanceof L.PDFRawStream ? L.decodePDFRawStream(st).decode() : st.getContents()).toString('latin1'); }).join('\n');
  };
  // Opens a line with Edit PDF (a click on its text) and types over all of it, or at its end.
  const editLine = async (p, has, text, { end = false, n = 0 } = {}) => {
    if (await p.evaluate(() => document.querySelector('.app').dataset.tool) !== 'edit') await run(p, 'tool_edit');
    const b = await p.locator(`.page[data-n="${n}"] .textLayer span`, { hasText: has }).first().boundingBox();
    await p.mouse.click(b.x + Math.min(20, b.width / 3), b.y + b.height / 2); await p.waitForSelector('.line-editor'); await p.waitForTimeout(250);
    if (end) await p.keyboard.press('End'); else await p.keyboard.press('Control+a');
    await p.keyboard.type(text); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  };
  const fileOf = async (make) => { const pdf = await L.PDFDocument.create(); await make(pdf); const f = tmp('doc.pdf'); fs.writeFileSync(f, await pdf.save()); return f; };
  const hasPdftotext = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  const pdftotext = (bytes) => { const f = tmp('t.pdf'); fs.writeFileSync(f, bytes); return execFileSync('pdftotext', [f, '-'], { encoding: 'utf8' }); };
  // The on-demand CJK font, served from a small copy of Noto Sans SC in the fixtures (no download in tests).
  const stubCjk = async (p) => {
    let hits = 0;
    await p.route('https://fonts.test/**', (r) => { hits++; r.fulfill({ body: fs.readFileSync(CJK), contentType: 'font/ttf', headers: { 'access-control-allow-origin': '*' } }); });
    await p.evaluate(() => { for (const k of ['sc', 'jp', 'kr']) window.__cowdreyPdf.fontsUrl(k, 'https://fonts.test/' + k + '.ttf'); });
    return () => hits;
  };

  const UNI = 'Выручка Ελλάδα Zoë ✓';
  await test('fonts: a line typed in Cyrillic, Greek, accents and a symbol is saved as typed, in embedded Unicode fonts', async () => {
    const p = await open(); await openPdf(p, CHROME, 'Chrome.pdf');
    const before = await savedOf(p);
    await editLine(p, 'Revenue grew', UNI);
    eq((await all(p)).map((m) => [m.type, m.text]), [['te', UNI]]);
    const out = await savedOf(p), pages = await read(out);
    const y = pages[0].find((i) => i.s.includes('Выручка')).y;
    eq(lineAt(pages, 0, y), UNI, 'read back exactly');
    ok(!pages[0].some((i) => i.s.includes('?')), 'no question marks');
    ok(!pages[0].some((i) => /Revenue grew/.test(i.s)), 'the old line is gone');
    if (hasPdftotext) ok(pdftotext(out).replace(/\s+/g, ' ').includes(UNI), 'pdftotext reads it too: ' + pdftotext(out));
    // Type0 fonts with a ToUnicode map, embedded as TrueType (FontFile2) subsets
    const f = await fontsOf(out), added = f.filter((x) => /Noto/.test(x.base));
    ok(added.length >= 2 && added.every((x) => x.sub === '/Type0' && x.uni && x.file.includes('FontFile2')), 'Noto Sans and Symbols 2, Type0 with ToUnicode, embedded: ' + JSON.stringify(f));
    ok(added.some((x) => /NotoSans-Regular/.test(x.base)) && added.some((x) => /NotoSansSymbols2/.test(x.base)), JSON.stringify(added.map((x) => x.base)));
    ok(!f.some((x) => /Helvetica|Times|Courier/.test(x.base)), 'no standard font stands in');
    // subsets: the file grows by far less than the fonts (Noto Sans alone is 600 KB)
    ok(out.length - before.length < 60000, `grew ${out.length - before.length} bytes`);
    // the page's own font is kept: the other lines are untouched
    ok(pages[0].some((i) => i.s.includes('Quarterly summary')) && pages[0].some((i) => i.s.includes('Our thanks')), 'other lines kept');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('fonts: a one-line Latin edit with letters the page font lacks adds less than 60 KB', async () => {
    const p = await open(); await openPdf(p, CHROME, 'Chrome.pdf');
    const before = await savedOf(p);
    await editLine(p, 'Next review', ' Łódź, Zoë & Ørsted.', { end: true });
    const out = await savedOf(p), pages = await read(out);
    const y = pages[0].find((i) => i.s.includes('Next review') || i.s.includes('Łódź')).y;
    eq(lineAt(pages, 0, y), 'Next review: 14 June. Łódź, Zoë & Ørsted.');
    ok(out.length - before.length < 60000, `grew ${out.length - before.length} bytes`);
    // the bold green of the line is kept, and the stand-in is bold too
    ok((await fontsOf(out)).some((x) => /NotoSans-Bold/.test(x.base)), 'Noto Sans Bold: ' + JSON.stringify((await fontsOf(out)).map((x) => x.base)));
    ok(/\.1216 \.4353 \.2627 rg|0\.1216 0\.4353 0\.2627 rg/.test(await pageContent(out)), 'green kept');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('fonts: a partial edit of a TJ line keeps the kerning numbers of what did not change', async () => {
    const file = await fileOf(async (pdf) => {
      const pg = pdf.addPage([400, 300]), f = await pdf.embedFont(L.StandardFonts.Helvetica), key = pg.node.newFontDictionary('F1', f.ref);
      const src = `BT ${key} 18 Tf 40 200 Td [(Wa) -35 (ter V) 20 (alley T) -15 (oday)] TJ ET\nBT ${key} 18 Tf 40 150 Td [(Ki) 25 (nd W) -30 (ords)] TJ ET`;
      pg.node.set(L.PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(src)));
    });
    const p = await open(); await openPdf(p, file, 'Kerned.pdf');
    await editLine(p, 'Water', 'Water Valley Tonight');
    await editLine(p, 'Kind', 'Kind Слова');
    const marks = await all(p);
    eq(marks.map((m) => m.text), ['Water Valley Tonight', 'Kind Слова']);
    const out = await savedOf(p), src = await pageContent(out), pages = await read(out);
    eq(lineAt(pages, 0, 200), 'Water Valley Tonight', 'read back');
    eq(lineAt(pages, 0, 150), 'Kind Слова', 'read back');
    // the first line: one TJ in Helvetica still, with its numbers
    const tj = src.match(/\[[^\]]*\]\s*TJ/g) || [];
    const first = tj.find((t) => /-35/.test(t));
    ok(first && /-35[\s\S]*20[\s\S]*-15/.test(first), 'kerning kept: ' + JSON.stringify(tj));
    ok(!/oday/.test(src) && !/6F646179/i.test(src), 'the old word is gone from the stream');
    // the second: "Ki 25 nd" kept, the changed word in an embedded font after it, in the same text object
    const second = tj.find((t) => /\b25\b/.test(t));
    ok(second && !/-30/.test(second), 'kept piece with 25, not the number inside the changed word: ' + JSON.stringify(tj));
    ok(/25[^\]]*\]\s*TJ\s*\/CPDFU[^\s]* 18 Tf <[0-9A-Fa-f]+> Tj \/F1[^\s]* 18 Tf/.test(src.replace(/\s+/g, ' ')), 'Unicode run in the same BT: ' + src);
    ok(!/ords/.test(src), 'old word gone');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('fonts: a line inside a form XObject is edited: the old words are in no stream of the saved file', async () => {
    const file = await fileOf(async (pdf) => {
      const inner = await L.PDFDocument.create(), ip = inner.addPage([300, 300]), font = await inner.embedFont(L.StandardFonts.Helvetica);
      ip.drawText('Inside the form', { x: 20, y: 250, size: 18, font, color: L.rgb(0, 0, 0) });
      ip.drawText('Second line here', { x: 20, y: 200, size: 18, font, color: L.rgb(0, 0, 0) });
      const p0 = pdf.addPage([400, 400]), f2 = await pdf.embedFont(L.StandardFonts.Helvetica);
      p0.drawPage(await pdf.embedPage((await L.PDFDocument.load(await inner.save())).getPage(0)), { x: 50, y: 50 });
      p0.drawText('Page text on top', { x: 80, y: 120, size: 18, font: f2, color: L.rgb(0, 0, 0) });
    });
    const p = await open(); await openPdf(p, file, 'Form.pdf');
    await editLine(p, 'Inside the form', 'Снаружи the form');
    const out = await savedOf(p), pages = await read(out);
    eq(lineAt(pages, 0, 300), 'Снаружи the form', 'new text where the old was');
    ok(!pages[0].some((i) => /Inside/.test(i.s)), 'not in the text: ' + JSON.stringify(pages[0].map((i) => i.s)));
    ok(pages[0].some((i) => i.s === 'Second line here') && pages[0].some((i) => i.s === 'Page text on top'), 'the rest stays');
    const all2 = await streams(out), hex = Buffer.from('Inside').toString('hex');
    ok(!all2.some((s) => s.includes('Inside') || s.toLowerCase().includes(hex)), 'no stream has the old word');
    ok(all2.some((s) => /Second line here|5365636F6E64206C696E652068657265/i.test(s)), 'the form copy keeps its other text');
    // not painted over: nothing is clipped or covered for it
    ok(!/W\* n/.test(await pageContent(out)), 'no clip');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('fonts: a line in a password-protected PDF is saved with the password, its new font encrypted with it', async () => {
    const p = await open();
    const b64 = h.fixture('protected.pdf');
    const opening = p.evaluate(async (b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return window.__cowdreyPdf.openBytes(u, 'Secret.pdf'); }, b64);
    await p.waitForSelector('#dialog[open] #dlgInput'); await p.fill('#dlgInput', 'pelican'); await p.click('#dialog .btn.primary');
    await opening; await h.waitPages(p); await p.waitForSelector('.textLayer span'); await p.waitForTimeout(400);
    const first = await p.$eval('.page[data-n="0"] .textLayer span', (s) => s.textContent);
    await editLine(p, first.slice(0, 6), 'Тайна Ελλάδα');
    const building = savedOf(p);
    await h.answer(p, 'Keep password');
    const out = await building;
    let refused = false; try { await read(out); } catch { refused = true; }
    ok(refused, 'needs the password');
    const pages = await read(out, 'pelican');
    ok(pages[0].map((i) => i.s).join('').includes('Тайна Ελλάδα'), JSON.stringify(pages[0]));
    ok(!(await streams(out)).some((s) => s.includes('NotoSans')), 'the font is encrypted with the rest');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('fonts: Add text and Replace text write any language; the Font list has Same as the PDF', async () => {
    const p = await open(); await openPdf(p, CHROME, 'Chrome.pdf');
    // Replace text: a phrase in the PDF becomes Greek
    await run(p, 'txtReplace'); await p.waitForSelector('#dialog[open] #txtFind');
    await p.fill('#txtFind', 'whole team'); await p.fill('#txtWith', 'ομάδα όλη');
    await p.click('#dialog .dlg-foot button:has-text("Replace all")'); await p.waitForTimeout(600);
    await p.click('#dialog .dlg-foot button:has-text("Close")');
    // Add text: Cyrillic and a check mark, in serif
    await p.click('[data-rt="edit"]'); await p.click('[data-cmd="tool_text"]');
    const [x, y] = await h.at(p, 72, 500); await p.mouse.click(x, y); await p.waitForSelector('.page .txt-editor');
    eq(await p.$$eval('.txt-bar select[data-tf="fam"] option', (o) => o.map((x) => x.textContent)), ['Sans', 'Serif', 'Mono', 'Same as the PDF']);
    await p.selectOption('.txt-bar select[data-tf="fam"]', 'serif');
    await p.keyboard.type('Подпись ✓ done'); await p.keyboard.press('Control+Enter'); await p.waitForTimeout(500);
    const out = await savedOf(p), pages = await read(out), text = pages[0].map((i) => i.s).join('');
    ok(text.includes('Our thanks to the ομάδα όλη for a strong finish.'), 'replaced: ' + text);
    const box = pages[0].filter((i) => i.y < 500 && i.y > 470).sort((a, b) => a.x - b.x).map((i) => i.s).join('');
    eq(box, 'Подпись ✓ done', 'text box');
    const f = await fontsOf(out);
    ok(f.some((x) => /NotoSerif-Regular/.test(x.base)) && f.some((x) => /Times-Roman/.test(x.base)), 'Serif: Noto Serif for Cyrillic, Times for the rest: ' + JSON.stringify(f.map((x) => x.base)));
    eq(p.errors, []); await p.ctx.close();
  });

  await test('fonts: watermark and header in any language, odd pages only, file name field, read back from the saved PDF', async () => {
    const p = await open(); const hits = await stubCjk(p); await openPdf(p, SAMPLE, 'Quarterly report.pdf');
    await run(p, 'pd_watermark'); await p.waitForSelector('#dialog[open] .pd-form');
    await p.fill('#dialog [data-k="text"]', 'Конфиденциально 機密');
    await p.click('#dialog .dlg-foot button:has-text("Add watermark")');
    // the CJK font is asked for once, then fetched (here from the fixture)
    await p.waitForSelector('#dialog[open] h2:has-text("Chinese letters need a font")');
    ok((await p.textContent('#dialog .dlg-body')).includes('Chinese letters need a font download (11 MB). Download once?'), await p.textContent('#dialog .dlg-body'));
    await p.click('#dialog .dlg-foot button:has-text("Download")');
    await p.waitForFunction(() => window.__cowdreyPdf.pdItems().length === 1, null, { timeout: 10000 });
    eq(hits(), 1, 'fetched once');
    eq(await p.evaluate(() => window.__cowdreyPdf.fontsHave()), ['sc']);
    await run(p, 'pd_headfoot'); await p.waitForSelector('#dialog[open] .pd-form');
    await p.fill('#dialog [data-k="bc"]', '');
    await p.fill('#dialog [data-k="tc"]', 'Ελληνικά café <<file>>');
    await p.selectOption('#dialog [data-k="parity"]', 'odd');
    await p.click('#dialog .dlg-foot button:has-text("Add header & footer")'); await p.waitForTimeout(400);
    eq((await p.evaluate(() => window.__cowdreyPdf.pdItems())).map((m) => m.type), ['pd_watermark', 'pd_headfoot']);
    const out = await savedOf(p), pages = await read(out);
    for (const n of [0, 1, 2]) {
      const t = pages[n].map((i) => i.s).join('');
      ok(t.includes('Конфиденциально 機密'), `watermark on page ${n + 1}: ` + JSON.stringify(pages[n].map((i) => i.s)));
    }
    const head = pages.map((pg) => pg.filter((i) => i.y > 700).sort((a, b) => a.x - b.x).map((i) => i.s).join(''));
    eq(head, ['Ελληνικά café Quarterly report.pdf', '', 'Ελληνικά café Quarterly report.pdf'], 'header on pages 1 and 3 only');
    // (pdftotext reads a 45° watermark in pieces: its letters are there)
    if (hasPdftotext) { const t = pdftotext(out); ok(t.includes('Ελληνικά café Quarterly report.pdf') && ['機', '密', 'Ко', 'нф'].every((s) => t.includes(s)), t); }
    const f = await fontsOf(out);
    ok(f.some((x) => /NotoSansSC/.test(x.base) && x.sub === '/Type0' && x.uni) && f.some((x) => /NotoSans-Bold/.test(x.base)), JSON.stringify(f.map((x) => x.base)));
    // still marked as page artifacts, so other editors know them
    ok(/\/Artifact\s*<<[^>]*\/Pagination/.test((await pageContent(out)).replace(/\s+/g, ' ')), 'artifact');
    // kept on this device: a new window (the same browser) has the font without asking
    const p2 = await p.ctx.newPage(); p2.errors = [];
    await p2.goto('https://app.test/'); await p2.waitForFunction(() => window.__cowdreyPdf);
    await p2.evaluate(() => window.__cowdreyPdf.fontsUrl('sc', 'https://fonts.test/sc.ttf'));
    await p2.waitForFunction(() => window.__cowdreyPdf.fontsHave().includes('sc'), null, { timeout: 5000 });
    eq(await p2.evaluate(() => window.__cowdreyPdf.fontsFor('機密')), 'sc');
    eq(hits(), 1, 'not fetched again');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('fonts: page design: different first page, even pages, title and author fields, presets', async () => {
    const file = await fileOf(async (pdf) => {
      const f = await pdf.embedFont(L.StandardFonts.Helvetica);
      for (let k = 0; k < 4; k++) pdf.addPage([612, 792]).drawText('Body of page ' + (k + 1), { x: 72, y: 400, size: 14, font: f });
      pdf.setTitle('Ежегодный отчёт'); pdf.setAuthor('Zoë Ørsted');
    });
    const p = await open(); await openPdf(p, file, 'Annual.pdf');
    await run(p, 'pd_headfoot'); await p.waitForSelector('#dialog[open] .pd-form');
    await p.fill('#dialog [data-k="bc"]', '<<title>> · <<author>> · <<page>>');
    await p.check('#dialog [data-k="firstDiff"]');
    ok(await p.isVisible('#dialog [data-k="ftc"]'), 'first-page fields shown');
    await p.fill('#dialog [data-k="ftc"]', 'Титульная страница');
    // kept as a preset, and used again
    await p.fill('#dialog [data-preset-name]', 'Report footer'); await p.click('#dialog [data-preset-save]');
    await p.click('#dialog .dlg-foot button:has-text("Add header & footer")'); await p.waitForTimeout(300);
    eq(await p.evaluate(() => JSON.parse(localStorage.getItem('cowdrey.pdf:pdPresets')).pd_headfoot.map((x) => [x.name, x.m.bc, x.m.firstDiff])), [['Report footer', '<<title>> · <<author>> · <<page>>', true]]);
    let out = await savedOf(p), pages = await read(out);
    const foot = (n) => pages[n].filter((i) => i.y < 60).map((i) => i.s).join('');
    const top = (n) => pages[n].filter((i) => i.y > 700).map((i) => i.s).join('');
    eq([0, 1, 2, 3].map(top), ['Титульная страница', '', '', ''], 'first page has its own header');
    eq([0, 1, 2, 3].map(foot), ['', 'Ежегодный отчёт · Zoë Ørsted · 2', 'Ежегодный отчёт · Zoë Ørsted · 3', 'Ежегодный отчёт · Zoë Ørsted · 4']);
    // Bates on even pages only
    await run(p, 'pd_bates'); await p.waitForSelector('#dialog[open] .pd-form');
    await p.fill('#dialog [data-k="prefix"]', 'ДЕЛО-'); await p.selectOption('#dialog [data-k="parity"]', 'even');
    await p.click('#dialog .dlg-foot .btn.primary'); await p.waitForTimeout(300);
    out = await savedOf(p); pages = await read(out);
    eq([0, 1, 2, 3].map((n) => pages[n].filter((i) => i.s.startsWith('ДЕЛО-')).map((i) => i.s)), [[], ['ДЕЛО-000001'], [], ['ДЕЛО-000002']]);
    // a preset fills a new dialog
    await openPdf(p, SAMPLE, 'Other.pdf');
    await run(p, 'pd_headfoot'); await p.waitForSelector('#dialog[open] [data-preset]');
    await p.selectOption('#dialog [data-preset]', { label: 'Report footer' });
    eq(await p.inputValue('#dialog [data-k="bc"]'), '<<title>> · <<author>> · <<page>>');
    ok(await p.isChecked('#dialog [data-k="firstDiff"]') && await p.inputValue('#dialog [data-k="ftc"]') === 'Титульная страница', 'first page too');
    await p.click('#dialog .dlg-foot button:has-text("Cancel")');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('fonts: right-to-left text is refused with a plain message, not saved broken', async () => {
    const p = await open(); await openPdf(p, CHROME, 'Chrome.pdf');
    await editLine(p, 'Revenue grew', 'שלום world');
    await p.waitForSelector('.toast:has-text("Right-to-left")', { timeout: 3000 }).catch(() => {});
    const err = await p.evaluate(async () => { try { await window.__cowdreyPdf.buildPdf(); return null; } catch (e) { return e.message; } });
    ok(/Right-to-left text \(Arabic, Hebrew\) can.t be saved/.test(err || ''), 'refused: ' + err);
    p.errors.length = 0; await p.ctx.close();
  });

  await test('fonts: the font service picks a face that has the letters', async () => {
    const p = await open();
    const pick = (t, s) => p.evaluate(([t, s]) => window.__cowdreyPdf.fontsFor(t, s), [t, s]);
    eq(await pick('Привет', { family: 'serif', bold: true }), 'serif-b');
    eq(await pick('Ελλάδα', { family: 'mono', italic: true }), 'mono');
    eq(await pick('✓', {}), 'symbols2');
    eq(await pick('Zoë', { family: 'sans', italic: true }), 'sans-i');
    ok(await p.evaluate(() => window.__cowdreyPdf.fontsBytes('sans')) > 300000, 'Noto Sans is a whole font');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('fonts: the app bundle has Noto Sans and fontkit offline (./vendor), with the network cut off', async () => {
    const dist = path.join(root, 'desktop/dist');
    const stale = !fs.existsSync(path.join(dist, 'index.html')) || fs.statSync(path.join(dist, 'index.html')).mtimeMs < fs.statSync(path.join(root, 'index.html')).mtimeMs;
    if (stale) execFileSync('node', [path.join(root, 'desktop/build.mjs')], { stdio: 'ignore' });
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    ok(html.includes('./vendor/@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf') && html.includes('./vendor/@pdf-lib/fontkit/dist/fontkit.umd.min.js'), 'rewritten to ./vendor');
    ok(!/cdn\.jsdelivr\.net\/npm\/@expo-google-fonts\/noto-sans-sc/.test(html), 'the on-demand fonts are not vendored');
    ok(fs.existsSync(path.join(dist, 'vendor/@expo-google-fonts/noto-sans/LICENSE_FONT.txt')), 'licence');
    const srv = http.createServer((q, r) => {
      const rel = decodeURIComponent(q.url.split('?')[0]), f = path.join(dist, rel === '/' ? 'index.html' : rel);
      if (!f.startsWith(dist) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); r.end(fs.readFileSync(f));
    }).listen(0);
    const p = await open(); const pg = await p.ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
    const outside = [];
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { outside.push(r.request().url()); r.abort(); });
    await pg.route(/^http:\/\/127\.0\.0\.1/, (r) => r.continue());
    try {
      await pg.goto(`http://127.0.0.1:${srv.address().port}/`); await pg.waitForFunction(() => window.__cowdreyPdf, null, { timeout: 15000 });
      ok(await pg.evaluate(() => window.__cowdreyPdf.fontsBytes('sans')) > 300000, 'Noto Sans from ./vendor');
      eq(await pg.evaluate(() => window.__cowdreyPdf.fontsFor('Ζ✓', {})), 'sans', 'fontkit from ./vendor');
      eq(outside.filter((u) => /font|jsdelivr/.test(u)), [], 'nothing fetched from outside');
      eq(errs, []);
    } finally { srv.close(); await p.ctx.close(); }
    void zlib;
  });
};
