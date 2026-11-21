// PDF/A export (src/features/84-pdfa.js) and the document properties it keeps in step (src/features/12-docinfo.js):
// XMP, custom keys, language and initial view; PDF/A-2b, 2u and 3b with the built-in check.
import { spawnSync } from 'node:child_process';
export default async (h) => {
  const { test, eq, ok, open, openPdf, savedOf, reopen, answer, fixture, waitPages, path, fs, require, root } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const pdfjs = await import(path.join(root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
  const { PDFName, PDFDict, PDFArray, PDFStream, PDFRawStream, PDFRef, PDFNumber, PDFString, PDFHexString } = L, N = PDFName.of;
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cowdrey-pdfa-'));
  const streamBytes = (s) => Buffer.from(s instanceof PDFRawStream ? L.decodePDFRawStream(s).decode() : s.getContents());
  const nameOf = (o) => (o instanceof PDFName ? o.decodeText() : null);
  const textOf = (d, o) => { const v = d.context.lookup(o); return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined; };
  const xmpOf = (d) => { const s = d.catalog.lookup(N('Metadata')); return s ? { text: streamBytes(s).toString('utf8'), filtered: !!s.dict.get(N('Filter')) } : null; };
  const check = (p, bytes, opts) => p.evaluate(async ([b, o]) => { const r = await window.__cowdreyPdf.pdfaCheck(new Uint8Array(b), o); return { list: [...r], passed: r.passed, summary: window.__cowdreyPdf.pdfaSummary(r) }; }, [Array.from(bytes), opts || null]);
  const docTexts = async (bytes) => {
    const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise; const out = [];
    for (let i = 1; i <= d.numPages; i++) out.push((await (await d.getPage(i)).getTextContent()).items.map((x) => x.str).join(' '));
    await d.loadingTask.destroy(); return out;
  };
  // Save as PDF/A…: choose the level, then the file comes as a download (the web app) when every check passes.
  async function savePdfa(p, level = '2b', { expectProblems = false, attachments } = {}) {
    await run(p, 'savePdfa'); await p.waitForSelector('#dialog[open] .pdfa-levels');
    await p.check(`#dialog [name="pdfaLevel"][value="${level}"]`);
    const dl = p.waitForEvent('download', { timeout: 30000 });
    await p.click('#dialog .dlg-foot .btn.primary');
    if (attachments) { await p.waitForSelector('#dialog[open] .dlg-foot button:has-text("Use PDF/A-3b")', { timeout: 30000 }); await p.click('#dialog .dlg-foot button:has-text("Use PDF/A-3b")'); }
    if (expectProblems) return null;
    const winner = await Promise.race([dl.then((d) => ['dl', d]), p.waitForSelector('#dialog[open] .pdfa-probs', { timeout: 30000 }).then(() => ['probs'])]);
    if (winner[0] === 'probs') throw new Error('PDF/A check found problems: ' + (await p.textContent('#dialog .pdfa-sum')) + ' ' + (await p.textContent('#dialog .pdfa-probs')));
    const file = path.join(tmp, `out-${Date.now()}.pdf`); await winner[1].saveAs(file);
    return { name: winner[1].suggestedFilename(), bytes: fs.readFileSync(file) };
  }
  // A strict reading of an ICC profile: header, tag table, the tags a matrix/TRC display profile needs.
  function parseIcc(b) {
    const u32 = (o) => b.readUInt32BE(o), s4 = (o) => b.toString('latin1', o, o + 4), s15 = (o) => b.readInt32BE(o) / 65536;
    const r = { size: u32(0), version: b[8], minor: b[9] >> 4, cls: s4(12), space: s4(16), pcs: s4(20), magic: s4(36), illuminant: [s15(68), s15(72), s15(76)], tags: {} };
    const n = u32(128);
    for (let i = 0; i < n; i++) {
      const sig = s4(132 + i * 12), off = u32(136 + i * 12), len = u32(140 + i * 12);
      if (off % 4 || off + len > b.length || off < 132 + n * 12) throw new Error(`tag ${sig} out of bounds`);
      r.tags[sig] = { type: s4(off), off, len };
    }
    const xyz = (t) => [s15(r.tags[t].off + 8), s15(r.tags[t].off + 12), s15(r.tags[t].off + 16)];
    r.wtpt = xyz('wtpt'); r.primaries = ['rXYZ', 'gXYZ', 'bXYZ'].map(xyz);
    const c = r.tags.rTRC, count = u32(c.off + 8); r.trcCount = count;
    r.trc = (x) => { const k = x * (count - 1), i = Math.floor(k), f = k - i; const at = (j) => b.readUInt16BE(c.off + 12 + Math.min(j, count - 1) * 2) / 65535; return at(i) * (1 - f) + at(i + 1) * f; };
    const dsc = r.tags.desc; r.desc = b.toString('latin1', dsc.off + 12, dsc.off + 12 + u32(dsc.off + 8) - 1);
    return r;
  }
  // Every font a page can draw with: its resources, form XObjects (nested), annotation appearances, the form's DR.
  function allFonts(d) {
    const fonts = [], seen = new Set(), look = (o) => d.context.lookup(o);
    const walkStream = (s, where) => { if (s instanceof PDFStream && !seen.has(s)) { seen.add(s); walkRes(s.dict.lookup(N('Resources')), where); } };
    const walkRes = (res, where) => {
      if (!(res instanceof PDFDict) || seen.has(res)) return; seen.add(res);
      const f = res.lookup(N('Font')); if (f instanceof PDFDict) for (const [k, v] of f.entries()) fonts.push({ key: k.decodeText(), font: look(v), where });
      const xo = res.lookup(N('XObject')); if (xo instanceof PDFDict) for (const [, v] of xo.entries()) walkStream(look(v), where);
    };
    d.getPages().forEach((p, i) => {
      walkRes(p.node.Resources(), `page ${i + 1}`);
      const an = p.node.lookup(N('Annots'));
      if (an instanceof PDFArray) for (const r of an.asArray()) { const a = look(r); const ap = a.lookup(N('AP')); if (!(ap instanceof PDFDict)) continue; for (const [, v] of ap.entries()) { const x = look(v); if (x instanceof PDFStream) walkStream(x, `annotation on page ${i + 1}`); else if (x instanceof PDFDict) for (const [, s] of x.entries()) walkStream(look(s), `annotation on page ${i + 1}`); } }
    });
    const af = d.catalog.lookup(N('AcroForm')); const dr = af instanceof PDFDict ? af.lookup(N('DR')) : null; if (dr instanceof PDFDict) walkRes(dr, 'form');
    return fonts;
  }
  const fontEmbedded = (d, f) => {
    let fd = f.lookup(N('FontDescriptor'));
    if (nameOf(f.get(N('Subtype'))) === 'Type0') { const ds = f.lookup(N('DescendantFonts')); fd = d.context.lookup(ds.get(0)).lookup(N('FontDescriptor')); }
    return fd instanceof PDFDict && !!(fd.lookup(N('FontFile2')) || fd.lookup(N('FontFile3')) || fd.lookup(N('FontFile')));
  };
  const anyName = (d, n) => d.context.enumerateIndirectObjects().some(([, o]) => { const t = o instanceof PDFStream ? o.dict.toString() : String(o); return t.includes('/' + n); });
  async function addDesign(p) {
    const add = async (id, fill) => {
      await run(p, id); await p.waitForSelector('#dialog[open] .pd-form');
      for (const [k, v] of Object.entries(fill)) await p.fill(`#dialog [data-k="${k}"]`, String(v));
      await p.click('#dialog .dlg-foot .btn.primary'); await p.waitForTimeout(300);
    };
    await add('pd_watermark', { text: 'DRAFT COPY' });
    await add('pd_headfoot', { tl: 'Heron survey' });
    await p.click('[data-rt="edit"]'); await p.click('[data-cmd="tool_text"]');
    const g = await p.locator('.page[data-n="0"]').boundingBox(); await p.mouse.click(g.x + 100, g.y + 640);
    await p.waitForSelector('.page .txt-editor'); await p.keyboard.type('Approved for the archive'); await p.keyboard.press('Escape');
    await p.waitForFunction(() => Object.values(window.__cowdreyPdf.doc.marks).flat().some((m) => m.type === 'text'), null, { timeout: 10000 });
    await p.click('[data-cmd="tool_select"]').catch(() => {});
  }

  await test('PDF/A-2b: a page-designed, annotated PDF is saved with XMP (pdfaid, title), an sRGB output intent, every font embedded, no scripts, printable appearances', async () => {
    const p = await open(); await openPdf(p);
    await addDesign(p);
    // a note (a PDF comment with no appearance of its own) too
    await p.click('[data-rt="markup"]'); await p.click('[data-cmd="tool_note"]');
    const g = await p.locator('.page[data-n="0"]').boundingBox(); await p.mouse.click(g.x + 420, g.y + 620);
    await p.fill('.page-ask textarea', 'Checked'); await p.click('.page-ask .btn.primary'); await p.waitForTimeout(200);
    const r = await savePdfa(p, '2b');
    eq(r.name, 'Quarterly report (PDF-A).pdf');
    const d = await L.PDFDocument.load(r.bytes, { updateMetadata: false });
    ok(/^%PDF-1\.7\r?\n%[\x80-\xff]{4}/.test(r.bytes.toString('latin1', 0, 20)), 'header and binary comment');
    // XMP
    const x = xmpOf(d); ok(x && !x.filtered, 'an uncompressed XMP stream');
    eq(nameOf(d.catalog.lookup(N('Metadata')).dict.get(N('Subtype'))), 'XML');
    ok(/<pdfaid:part>2<\/pdfaid:part>/.test(x.text) && /<pdfaid:conformance>B<\/pdfaid:conformance>/.test(x.text), 'pdfaid 2B: ' + x.text.slice(0, 400));
    const title = d.getTitle(); eq(title, 'Quarterly report');
    ok(x.text.includes(`<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>`), 'dc:title equals the Info title');
    ok(/<\?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"\?>/.test(x.text) && /<\?xpacket end="w"\?>$/.test(x.text) && / {99}\n/.test(x.text), 'packet header, padding and trailer');
    ok(/<pdf:Producer>Cowdrey\.PDF [^<]+<\/pdf:Producer>/.test(x.text) && /<xmpMM:DocumentID>uuid:[0-9a-f-]{36}<\/xmpMM:DocumentID>/.test(x.text) && /<xmpMM:InstanceID>uuid:/.test(x.text), 'producer and ids');
    const md = textOf(d, d.getInfoDict().get(N('ModDate'))), xm = /<xmp:ModifyDate>([^<]+)</.exec(x.text)[1];
    eq(new Date(xm).toISOString().replace(/\.000Z$/, 'Z').replace(/[-:T]/g, '').replace('Z', ''), md.replace(/^D:/, '').replace(/Z.*$/, ''), 'ModDate in step');
    // trailer ID
    ok(d.context.lookup(d.context.trailerInfo.ID) instanceof PDFArray, 'trailer /ID');
    // output intent with an sRGB ICC profile
    const oi = d.catalog.lookup(N('OutputIntents')); ok(oi instanceof PDFArray && oi.size() === 1, 'one output intent');
    const intent = d.context.lookup(oi.get(0));
    eq([nameOf(intent.get(N('S'))), textOf(d, intent.get(N('OutputConditionIdentifier')))], ['GTS_PDFA1', 'sRGB IEC61966-2.1']);
    const iccStream = intent.lookup(N('DestOutputProfile')); eq(iccStream.dict.lookup(N('N')).asNumber(), 3);
    const icc = parseIcc(streamBytes(iccStream));
    eq([icc.magic, icc.space, icc.cls, icc.pcs, icc.version, icc.size], ['acsp', 'RGB ', 'mntr', 'XYZ ', 2, streamBytes(iccStream).length]);
    // fonts: none left without a font program, the stand-ins keep Helvetica's widths
    const fonts = allFonts(d); ok(fonts.length >= 3, 'fonts found: ' + fonts.length);
    const missing = fonts.filter(({ font }) => nameOf(font.get(N('Subtype'))) !== 'Type3' && !fontEmbedded(d, font));
    eq(missing.map((f) => `${f.key} (${nameOf(f.font.get(N('BaseFont')))}) in ${f.where}`), [], 'every font embedded');
    const arimo = fonts.find(({ font }) => /\+Arimo-Regular$/.test(nameOf(font.get(N('BaseFont'))) || ''));
    ok(arimo, 'Helvetica became Arimo: ' + fonts.map((f) => nameOf(f.font.get(N('BaseFont')))).join(', '));
    const w = (f, c) => f.lookup(N('Widths')).lookup(c - f.lookup(N('FirstChar')).asNumber()).asNumber();
    eq([' ', 'a', 'W', 'i', '0'].map((c) => w(arimo.font, c.charCodeAt(0))), [278, 556, 944, 222, 556], 'Helvetica widths');
    eq(nameOf(arimo.font.get(N('Subtype'))), 'TrueType'); eq(nameOf(arimo.font.get(N('Encoding'))), 'WinAnsiEncoding');
    ok(arimo.font.lookup(N('ToUnicode')) instanceof PDFStream, 'ToUnicode');
    const ff = arimo.font.lookup(N('FontDescriptor')).lookup(N('FontFile2')); ok(streamBytes(ff).length < 120000, 'subset: ' + streamBytes(ff).length);
    // no encryption, no JavaScript
    ok(!d.context.trailerInfo.Encrypt, 'no /Encrypt'); ok(!anyName(d, 'JavaScript'), 'no JavaScript');
    // annotations: printed, with an appearance (only /N)
    let n = 0;
    for (const pg of d.getPages()) { const an = pg.node.lookup(N('Annots')); if (!(an instanceof PDFArray)) continue; for (const ref of an.asArray()) { const a = d.context.lookup(ref); n++; ok(a.lookup(N('F')).asNumber() & 4, 'print flag'); const ap = a.lookup(N('AP')); ok(ap instanceof PDFDict && ap.get(N('N')) && !ap.get(N('D')) && !ap.get(N('R')), 'appearance: ' + nameOf(a.get(N('Subtype')))); } }
    ok(n >= 3, 'annotations checked: ' + n);
    ok(!d.catalog.lookup(N('AcroForm')).get(N('NeedAppearances')), 'no NeedAppearances');
    // the page design is still drawn and the text still readable
    const t = await docTexts(r.bytes);
    ok(t[0].includes('Quarterly report, page 1') && t[0].includes('DRAFT COPY') && t[0].includes('Heron survey') && t[0].includes('Approved for the archive'), t[0]);
    // reopened in the app: it draws, its text can be selected
    await reopen(p, r.bytes);
    ok(await p.evaluate(() => { const c = document.querySelector('.page canvas.pdf'); const dd = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let ink = 0; for (let i = 0; i < dd.length; i += 4) if (dd[i] < 100 && dd[i + 3] > 0) ink++; return ink > 500; }), 'page drawn');
    eq(p.errors, []);
    fs.writeFileSync(path.join(tmp, 'pdfa-2b.pdf'), r.bytes);
    await p.ctx.close();
  });

  await test('PDF/A: the output intent profile is a valid ICC v2 sRGB profile, made in code', async () => {
    const p = await open();
    const b = Buffer.from(await p.evaluate(() => window.__cowdreyPdf.pdfaSrgbIcc()));
    const icc = parseIcc(b);
    eq([icc.size, icc.magic, icc.space, icc.cls, icc.pcs, icc.version, icc.minor], [b.length, 'acsp', 'RGB ', 'mntr', 'XYZ ', 2, 1]);
    for (const t of ['desc', 'cprt', 'wtpt', 'rXYZ', 'gXYZ', 'bXYZ', 'rTRC', 'gTRC', 'bTRC']) ok(icc.tags[t], 'tag ' + t);
    eq([icc.tags.desc.type, icc.tags.cprt.type, icc.tags.wtpt.type, icc.tags.rXYZ.type, icc.tags.rTRC.type], ['desc', 'text', 'XYZ ', 'XYZ ', 'curv']);
    eq(icc.desc, 'sRGB IEC61966-2.1');
    const near = (a, e, d = 0.002) => Math.abs(a - e) <= d;
    ok(icc.illuminant.every((v, i) => near(v, [0.9642, 1, 0.8249][i])), 'D50 illuminant ' + icc.illuminant);
    // the primaries add up to the white point (D50), and green is the brightest
    const sum = [0, 1, 2].map((k) => icc.primaries.reduce((t, x) => t + x[k], 0));
    ok(sum.every((v, i) => near(v, icc.wtpt[i], 0.003)), 'primaries sum to white: ' + sum);
    ok(icc.primaries[1][1] > 0.7 && icc.primaries[0][0] > 0.43, 'sRGB primaries');
    // the curve is sRGB's
    eq(icc.trcCount, 1024); ok(near(icc.trc(0.5), 0.2140, 0.001) && near(icc.trc(1), 1, 1e-6) && icc.trc(0) === 0 && near(icc.trc(0.02), 0.02 / 12.92, 0.0005), 'sRGB tone curve ' + icc.trc(0.5));
    eq(icc.tags.gTRC.off, icc.tags.rTRC.off, 'one curve, shared');
    ok(b.length < 3000, 'small: ' + b.length);
    await p.ctx.close();
  });

  await test('PDF/A check: the PDF/A file passes; the plain saved PDF lists fonts not embedded and no OutputIntent', async () => {
    const p = await open(); await openPdf(p);
    await addDesign(p);
    const plain = await savedOf(p);
    const pr = await check(p, plain, { part: 2, conformance: 'B' });
    const rules = new Set(pr.list.map((x) => x.rule));
    ok(rules.has('fonts-embedded') && rules.has('output-intent') && rules.has('pdfaid') && rules.has('trailer-id'), JSON.stringify(pr.list));
    ok(pr.list.some((x) => x.rule === 'fonts-embedded' && /^Font Helvetica is not embedded on page 1\.$/.test(x.text) && x.page === 1 && x.fix === 'auto'), 'font problem: ' + JSON.stringify(pr.list.filter((x) => x.rule === 'fonts-embedded')));
    ok(pr.list.some((x) => x.rule === 'output-intent' && /^No OutputIntent/.test(x.text)), 'no OutputIntent');
    ok(/^\d+ checks passed\. \d+ problems: /.test(pr.summary), pr.summary);
    const r = await savePdfa(p, '2b');
    const ck = await check(p, r.bytes);
    eq(ck.list.filter((x) => x.severity === 'error'), [], 'no errors');
    ok(ck.passed.length >= 18 && ck.passed.includes('fonts-embedded') && ck.passed.includes('xmp-sync') && ck.passed.includes('font-widths'), ck.summary);
    eq(ck.summary, `${ck.passed.length} checks passed.`);
    await p.ctx.close();
  });

  await test('PDF/A: a PDF with a password is refused', async () => {
    const p = await open();
    const opening = p.evaluate(async (b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return window.__cowdreyPdf.openBytes(u, 'Secret.pdf'); }, fixture('protected.pdf'));
    await p.waitForSelector('#dialog[open] #dlgInput'); await p.fill('#dlgInput', 'pelican'); await p.click('#dialog .btn.primary');
    eq(await opening, true); await waitPages(p); await p.waitForTimeout(300);
    await run(p, 'savePdfa'); await p.waitForSelector('#dialog[open] .pdfa-levels'); await p.click('#dialog .dlg-foot .btn.primary');
    await p.waitForSelector('#dialog[open] .dlg-foot button:has-text("Keep password")'); await answer(p, 'Keep password');
    await p.waitForFunction(() => /PDF\/A files can't have a password\. Remove it to continue\./.test(document.querySelector('#dialog[open] .dlg-body') ? document.querySelector('#dialog[open] .dlg-body').textContent : ''), null, { timeout: 10000 });
    await answer(p, 'OK');
    // pdfaConvert refuses encrypted bytes too
    const err = await p.evaluate(async (b) => { try { await window.__cowdreyPdf.pdfaConvert(new Uint8Array(b), { part: 2 }); return 'converted'; } catch (e) { return e.code + ': ' + e.message; } }, Array.from(Buffer.from(fixture('protected.pdf'), 'base64')));
    eq(err, "encrypted: PDF/A files can't have a password. Remove it to continue.");
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Document properties: title, author, a custom key, language, opening page and window title are saved (Info, XMP, catalog) and read back', async () => {
    const p = await open(); await openPdf(p);
    await run(p, 'docProps'); await p.waitForSelector('#dialog[open] .di');
    await p.fill('#dialog [data-di="title"]', 'Ελληνικά'); await p.fill('#dialog [data-di="author"]', 'Nikos Kazantzakis');
    await p.fill('#dialog [data-di="keywords"]', 'heron; coast, survey');
    eq(await p.$$eval('#dialog .di-chip > span', (s) => s.map((x) => x.textContent)), ['heron', 'coast', 'survey'], 'keywords as chips');
    await p.click('#dialog .di-chip button[aria-label="Remove coast"]');
    eq(await p.inputValue('#dialog [data-di="keywords"]'), 'heron; survey');
    await p.fill('#dialog [data-dx="lang"]', 'el');
    await p.fill('#dialog [data-dx="creator"]', 'Field notes 3');
    await p.click('#dialog [data-di-tab="custom"]'); ok(await p.isVisible('#dialog #di-p-custom'), 'custom tab shown');
    await p.click('#dialog [data-cadd]'); await p.fill('#dialog .di-crow:last-child [data-ck]', 'Project'); await p.fill('#dialog .di-crow:last-child [data-cv]', 'Heron');
    await p.click('#dialog [data-cadd]'); await p.fill('#dialog .di-crow:last-child [data-ck]', 'Drop me'); await p.fill('#dialog .di-crow:last-child [data-cv]', 'x');
    await p.click('#dialog .di-crow:last-child [data-cdel]');
    await p.click('#dialog [data-di-tab="view"]');
    await p.fill('#dialog [data-dx="page"]', '2'); await p.check('#dialog [data-dx="displayTitle"]');
    await p.selectOption('#dialog [data-dx="layout"]', 'OneColumn'); await p.selectOption('#dialog [data-dx="mode"]', 'UseThumbs');
    await answer(p, 'Done'); await p.waitForTimeout(200);
    const m = await p.evaluate(() => window.__cowdreyPdf.docMarks().find((x) => x.type === 'docinfo'));
    eq([m.title, m.author, m.keywords, m.lang, m.creator, m.custom, m.view], ['Ελληνικά', 'Nikos Kazantzakis', 'heron; survey', 'el', 'Field notes 3', { Project: 'Heron' }, { page: 2, layout: 'OneColumn', mode: 'UseThumbs', displayTitle: true }]);
    const bytes = await savedOf(p);
    const d = await L.PDFDocument.load(bytes, { updateMetadata: false });
    eq([d.getTitle(), d.getAuthor(), d.getKeywords(), d.getCreator(), textOf(d, d.getInfoDict().get(N('Project')))], ['Ελληνικά', 'Nikos Kazantzakis', 'heron; survey', 'Field notes 3', 'Heron'], 'Info');
    eq(textOf(d, d.catalog.get(N('Lang'))), 'el', 'catalog /Lang');
    const oa = d.catalog.lookup(N('OpenAction'));
    eq([oa.get(0) instanceof PDFRef && oa.get(0).tag === d.getPages()[1].ref.tag, nameOf(oa.get(1)), oa.size()], [true, 'XYZ', 5], 'open at page 2');
    eq([nameOf(d.catalog.get(N('PageLayout'))), nameOf(d.catalog.get(N('PageMode'))), String(d.catalog.lookup(N('ViewerPreferences')).get(N('DisplayDocTitle')))], ['OneColumn', 'UseThumbs', 'true']);
    const x = xmpOf(d); ok(x, 'XMP written');
    ok(x.text.includes('<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Ελληνικά</rdf:li></rdf:Alt></dc:title>'), 'dc:title');
    ok(x.text.includes('<dc:creator><rdf:Seq><rdf:li>Nikos Kazantzakis</rdf:li></rdf:Seq></dc:creator>') && x.text.includes('<pdf:Keywords>heron; survey</pdf:Keywords>') && x.text.includes('<xmp:CreatorTool>Field notes 3</xmp:CreatorTool>') && x.text.includes('<dc:language><rdf:Bag><rdf:li>el</rdf:li></rdf:Bag></dc:language>'), x.text.slice(0, 1200));
    ok(!/pdfaid/.test(x.text), 'no PDF/A claim in a plain save');
    // pdf.js reads the same
    const pd = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
    const meta = await pd.getMetadata(); eq([meta.info.Title, meta.metadata && meta.metadata.get('dc:title'), meta.info.Custom && meta.info.Custom.get('Project')], ['Ελληνικά', 'Ελληνικά', 'Heron'], 'pdf.js');
    eq([await pd.getPageLayout(), await pd.getPageMode(), (await pd.getViewerPreferences()).get('DisplayDocTitle')], ['OneColumn', 'UseThumbs', true]);
    await pd.loadingTask.destroy();
    // reopened: the dialog shows what was saved
    await reopen(p, bytes);
    await run(p, 'docProps'); await p.waitForSelector('#dialog[open] .di');
    eq(await p.$$eval('#dialog [data-di]', (i) => i.map((v) => v.value)), ['Ελληνικά', 'Nikos Kazantzakis', '', 'heron; survey']);
    eq([await p.inputValue('#dialog [data-dx="lang"]'), await p.inputValue('#dialog [data-dx="creator"]'), await p.inputValue('#dialog [data-dx="page"]'), await p.isChecked('#dialog [data-dx="displayTitle"]'), await p.inputValue('#dialog [data-dx="layout"]'), await p.inputValue('#dialog [data-dx="mode"]')], ['el', 'Field notes 3', '2', true, 'OneColumn', 'UseThumbs']);
    eq(await p.$$eval('#dialog .di-crow', (r) => r.map((x) => [x.querySelector('[data-ck]').value, x.querySelector('[data-cv]').value])), [['Project', 'Heron']]);
    // editing a PDF that has XMP updates it (same document id, new instance id) and keeps it
    await p.fill('#dialog [data-di="title"]', 'Second title');
    await p.click('#dialog [data-di-tab="custom"]'); await p.fill('#dialog .di-crow [data-ck]', 'Codename');
    await answer(p, 'Done'); await p.waitForTimeout(200);
    const b2 = await savedOf(p), d2 = await L.PDFDocument.load(b2, { updateMetadata: false }), x2 = xmpOf(d2);
    ok(x2 && x2.text.includes('<rdf:li xml:lang="x-default">Second title</rdf:li>'), 'XMP updated, not deleted');
    const id = (t, k) => (new RegExp(`<xmpMM:${k}>([^<]+)<`).exec(t) || [])[1];
    eq(id(x2.text, 'DocumentID'), id(x.text, 'DocumentID'), 'same document'); ok(id(x2.text, 'InstanceID') !== id(x.text, 'InstanceID'), 'new instance');
    eq([textOf(d2, d2.getInfoDict().get(N('Codename'))), d2.getInfoDict().get(N('Project'))], ['Heron', undefined], 'custom key renamed');
    ok(!d2.getInfoDict().get(N('CowdreyPdfPD')), 'no page design key');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Document properties: dates and creator are editable, the language is checked, the hidden page-design key is not listed; undo', async () => {
    const p = await open(); await openPdf(p);
    await run(p, 'pd_watermark'); await p.waitForSelector('#dialog[open] .pd-form'); await p.fill('#dialog [data-k="text"]', 'SECRET'); await p.click('#dialog .dlg-foot .btn.primary'); await p.waitForTimeout(300);
    let bytes = await savedOf(p); await reopen(p, bytes); await p.evaluate(() => window.__cowdreyPdf.pdOpening()); await p.waitForTimeout(200);
    await run(p, 'docProps'); await p.waitForSelector('#dialog[open] .di');
    eq(await p.$$('#dialog .di-crow'), [], 'page design key hidden');
    await p.fill('#dialog [data-dx="created"]', '2020-02-03T04:05:06'); await p.fill('#dialog [data-dx="modified"]', '2021-07-08T09:10:11');
    await p.fill('#dialog [data-dx="lang"]', 'not a language!');
    await answer(p, 'Done'); await p.waitForTimeout(200);
    const m = await p.evaluate(() => window.__cowdreyPdf.docMarks().find((x) => x.type === 'docinfo'));
    eq([m.created, m.modified, m.lang], [new Date(2020, 1, 3, 4, 5, 6).toISOString(), new Date(2021, 6, 8, 9, 10, 11).toISOString(), undefined]);
    bytes = await savedOf(p);
    const d = await L.PDFDocument.load(bytes, { updateMetadata: false });
    eq([+d.getCreationDate(), +d.getModificationDate()], [+new Date(2020, 1, 3, 4, 5, 6), +new Date(2021, 6, 8, 9, 10, 11)], 'Info dates');
    const x = xmpOf(d).text;
    eq([/<xmp:CreateDate>([^<]+)</.exec(x)[1], /<xmp:ModifyDate>([^<]+)</.exec(x)[1]], [new Date(2020, 1, 3, 4, 5, 6).toISOString().replace('.000', ''), new Date(2021, 6, 8, 9, 10, 11).toISOString().replace('.000', '')], 'XMP dates');
    ok(d.getInfoDict().get(N('CowdreyPdfPD')), 'page design kept');
    await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
    eq(await p.evaluate(() => window.__cowdreyPdf.docMarks().filter((x) => x.type === 'docinfo').length), 0, 'undone');
    // a PDF with no XMP and no changes is saved without one (as before)
    const p2 = await open(); await openPdf(p2);
    ok(!(await L.PDFDocument.load(await savedOf(p2))).catalog.get(N('Metadata')), 'no XMP added');
    await p2.ctx.close();
    eq(p.errors, []); await p.ctx.close();
  });

  // A PDF with what PDF/A forbids: JavaScript, a launch action, LZW data, a hidden comment, a comment with no
  // appearance, Arial (TrueType, not embedded) and Wingdings (no stand-in).
  const lzw = (data) => {
    const out = []; let acc = 0, bits = 0; const put = (code, w) => { acc = (acc << w) | code; bits += w; while (bits >= 8) { out.push((acc >> (bits - 8)) & 255); bits -= 8; } acc &= (1 << bits) - 1; };
    let dict = new Map(), next = 258, width = 9; const reset = () => { dict = new Map(); for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i); next = 258; width = 9; };
    reset(); put(256, width); let w = '';
    for (const ch of data) { const wc = w + ch; if (dict.has(wc)) { w = wc; continue; } put(dict.get(w), width); dict.set(wc, next++); if (next + 1 > (1 << width) && width < 12) width++; if (next >= 4094) { put(256, width); reset(); } w = ch; }
    if (w) put(dict.get(w), width); put(257, width); if (bits) put(0, 8 - bits); return Uint8Array.from(out);
  };
  async function messyPdf({ wingdings = true, attach = false } = {}) {
    const d = await L.PDFDocument.create(); const pg = d.addPage([400, 300]); const ctx = d.context;
    const arial = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'Arial,Bold', FirstChar: 32, LastChar: 126, Widths: Array(95).fill(600), Encoding: 'WinAnsiEncoding', FontDescriptor: ctx.register(ctx.obj({ Type: 'FontDescriptor', FontName: 'Arial,Bold', Flags: 32, FontBBox: [-600, -200, 1200, 900], ItalicAngle: 0, Ascent: 900, Descent: -200, CapHeight: 700, StemV: 120 })) }));
    const times = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Times-Italic' }));
    const fonts = { F1: arial, F2: times }; if (wingdings) fonts.F3 = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'Wingdings-Regular', FirstChar: 32, LastChar: 126, Widths: Array(95).fill(900), FontDescriptor: ctx.register(ctx.obj({ Type: 'FontDescriptor', FontName: 'Wingdings-Regular', Flags: 4, FontBBox: [0, -200, 1000, 900], ItalicAngle: 0, Ascent: 900, Descent: -200, CapHeight: 700, StemV: 80 })) }));
    pg.node.set(N('Resources'), ctx.obj({ Font: fonts }));
    const content = `BT /F1 18 Tf 40 240 Td (Heron count: 12) Tj ET BT /F2 14 Tf 40 200 Td (Quoted \\223soft\\224 text) Tj ET${wingdings ? ' BT /F3 14 Tf 40 160 Td (J) Tj ET' : ''}`;
    const cs = ctx.register(ctx.stream(lzw(content), { Filter: 'LZWDecode' })); pg.node.set(N('Contents'), cs);
    const js = ctx.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of('app.alert(1)') });
    d.catalog.set(N('OpenAction'), js);
    d.catalog.set(N('Names'), ctx.obj({ JavaScript: ctx.obj({ Names: [PDFString.of('a'), ctx.register(ctx.obj({ S: 'JavaScript', JS: PDFString.of('1') }))] }) }));
    pg.node.set(N('AA'), ctx.obj({ O: ctx.obj({ S: 'JavaScript', JS: PDFString.of('2') }) }));
    const note = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [300, 250, 320, 270], Contents: PDFString.of('note'), C: [1, 0.8, 0] }));
    const hidden = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 50, 50], F: 2 }));
    const sq = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [60, 10, 120, 50], C: [0, 0, 1], F: 0 }));
    const launch = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [40, 230, 200, 260], A: ctx.obj({ S: 'Launch', F: PDFString.of('calc.exe') }) }));
    pg.node.set(N('Annots'), ctx.obj([note, hidden, sq, launch]));
    d.setTitle('Messy'); d.setAuthor('Test');
    if (attach) await d.attach(Buffer.from('heron,12\n'), 'counts.csv', { mimeType: 'text/csv', description: 'Counts' });
    return Buffer.from(await d.save({ useObjectStreams: false }));
  }
  const openBytes = async (p, bytes, name) => { await p.evaluate(async ([b, n]) => { await window.__cowdreyPdf.openBytes(new Uint8Array(b), n); }, [Array.from(bytes), name]); await waitPages(p); await p.waitForTimeout(400); };

  await test('PDF/A: scripts, launch actions, LZW, hidden and appearance-less comments are fixed; Arial and Times get stand-ins; Wingdings is reported, "Save anyway" drops the claim', async () => {
    const src = await messyPdf();
    const p = await open(); await openBytes(p, src, 'Messy.pdf');
    const res = await p.evaluate(async (b) => { const r = await window.__cowdreyPdf.pdfaConvert(new Uint8Array(b), { part: 2, conformance: 'B' }); return { bytes: Array.from(r.bytes), fixes: r.fixes }; }, Array.from(src));
    const out = Buffer.from(res.bytes);
    for (const f of ['Removed JavaScript', 'Removed automatic actions', 'Removed Launch actions', 'Re-packed LZW data as Flate', 'Removed hidden comments', 'Drew comments that had no appearance', 'Set comments and fields to print']) ok(res.fixes.includes(f), `fix "${f}" in ${JSON.stringify(res.fixes)}`);
    ok(res.fixes.some((f) => /^Embedded Arimo-Bold in place of Arial,Bold$/.test(f)) && res.fixes.some((f) => /^Embedded Tinos-Italic in place of Times-Italic$/.test(f)), JSON.stringify(res.fixes));
    const d = await L.PDFDocument.load(out, { updateMetadata: false });
    eq(['JavaScript', 'Launch', 'LZWDecode', 'AA'].filter((n) => anyName(d, n)), [], 'nothing forbidden left');
    const an = d.getPages()[0].node.lookup(N('Annots')).asArray().map((r) => d.context.lookup(r));
    eq(an.map((a) => [nameOf(a.get(N('Subtype'))), a.lookup(N('F')).asNumber() & 4, !!a.lookup(N('AP'))]), [['Text', 4, true], ['Square', 4, true], ['Link', 4, true]], 'annotations');
    ok(!an[2].get(N('A')), 'launch action gone');
    const sqAp = streamBytes(an[1].lookup(N('AP')).lookup(N('N'))).toString('latin1'); ok(/0 0 1 RG/.test(sqAp) && / re S/.test(sqAp), 'square drawn: ' + sqAp);
    // Arial's widths now those of the embedded Arimo Bold, so text keeps its place in other readers
    const f1 = d.getPages()[0].node.Resources().lookup(N('Font')).lookup(N('F1'));
    ok(/^[A-Z]{6}\+Arimo-Bold$/.test(nameOf(f1.get(N('BaseFont')))) && f1.lookup(N('Widths')).lookup('H'.charCodeAt(0) - f1.lookup(N('FirstChar')).asNumber()).asNumber() === 722, 'Arimo Bold widths');
    const f2 = d.getPages()[0].node.Resources().lookup(N('Font')).lookup(N('F2'));
    ok(/\+Tinos-Italic$/.test(nameOf(f2.get(N('BaseFont')))) && f2.lookup(N('FontDescriptor')).lookup(N('Flags')).asNumber() & 64, 'Tinos Italic');
    // the text reads the same (Times had no encoding of its own: Standard, written as WinAnsi with differences)
    const t = await docTexts(out); ok(t[0].includes('Heron count: 12') && t[0].includes('Quoted “soft” text'), t[0]);
    // the check: Wingdings is the one problem
    const ck = await check(p, out);
    const errs = ck.list.filter((x) => x.severity === 'error');
    eq(errs.map((x) => [x.rule, x.text, x.page, x.fix]), [['fonts-embedded', 'Font Wingdings-Regular is not embedded on page 1.', 1, 'manual']]);
    ok(new RegExp(`^${ck.passed.length} checks passed\\. 1 problem: font Wingdings-Regular is not embedded on page 1\\.$`).test(ck.summary), ck.summary);
    // through the menu: the results dialog, then Save anyway (not PDF/A)
    await savePdfa(p, '2b', { expectProblems: true });
    await p.waitForSelector('#dialog[open] .pdfa-probs', { timeout: 30000 });
    eq(await p.textContent('#dialog h2'), 'Not PDF/A-2b yet');
    ok((await p.textContent('#dialog .pdfa-sum')).endsWith('1 problem: font Wingdings-Regular is not embedded on page 1.'), await p.textContent('#dialog .pdfa-sum'));
    ok(/built-in check, not a certified validator/.test(await p.textContent('#dialog .pdfa-note')), 'says it is not a certified validator');
    const dl = p.waitForEvent('download'); await answer(p, 'Save anyway (not PDF/A)');
    const file = path.join(tmp, 'anyway.pdf'); const got = await dl; await got.saveAs(file);
    eq(got.suggestedFilename(), 'Messy (archive).pdf');
    const x = xmpOf(await L.PDFDocument.load(fs.readFileSync(file), { updateMetadata: false }));
    ok(x && !/pdfaid/.test(x.text), 'no PDF/A claim');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('PDF/A-2u: every font has a Unicode mapping; PDF/A-3b keeps an attachment (described), PDF/A-2b offers 3b for it', async () => {
    const p = await open();
    await openBytes(p, await messyPdf({ wingdings: false }), 'Clean.pdf');
    const r = await savePdfa(p, '2u');
    const d = await L.PDFDocument.load(r.bytes, { updateMetadata: false });
    ok(/<pdfaid:conformance>U<\/pdfaid:conformance>/.test(xmpOf(d).text), '2u claimed');
    const ck = await check(p, r.bytes);
    ok(ck.passed.includes('tounicode'), ck.summary + JSON.stringify(ck.list));
    for (const { font } of allFonts(d)) ok(font.lookup(N('ToUnicode')) instanceof PDFStream, 'ToUnicode on ' + nameOf(font.get(N('BaseFont'))));
    // an attachment: PDF/A-2b can't keep a CSV file
    await openBytes(p, await messyPdf({ wingdings: false, attach: true }), 'With data.pdf');
    const blocked = await p.evaluate(async () => { const b = await window.__cowdreyPdf.buildPdf(); const r = await window.__cowdreyPdf.pdfaConvert(b, { part: 2 }); return [r.blocked, r.names]; });
    eq(blocked, ['attachments', ['counts.csv']]);
    const r3 = await savePdfa(p, '2b', { attachments: true });
    const d3 = await L.PDFDocument.load(r3.bytes, { updateMetadata: false });
    ok(/<pdfaid:part>3<\/pdfaid:part>/.test(xmpOf(d3).text), 'PDF/A-3');
    const af = d3.catalog.lookup(N('AF')); ok(af instanceof PDFArray && af.size() === 1, 'catalog /AF');
    const spec = d3.context.lookup(af.get(0));
    eq([nameOf(spec.get(N('AFRelationship'))), textOf(d3, spec.get(N('UF'))), nameOf(spec.lookup(N('EF')).lookup(N('F')).dict.get(N('Subtype')))], ['Unspecified', 'counts.csv', 'text/csv']);
    eq(streamBytes(spec.lookup(N('EF')).lookup(N('F'))).toString(), 'heron,12\n', 'attachment kept');
    const ck3 = await check(p, r3.bytes); eq(ck3.list.filter((x) => x.severity === 'error'), [], ck3.summary);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('PDF/A: a form the reader was asked to draw (NeedAppearances) gets drawn appearances in an embedded font', async () => {
    const d0 = await L.PDFDocument.create(); const pg = d0.addPage([300, 200]); const form = d0.getForm();
    const tf = form.createTextField('name'); tf.setText('Heron'); tf.addToPage(pg, { x: 40, y: 80, width: 200, height: 28 });
    form.acroForm.dict.set(N('NeedAppearances'), L.PDFBool.True);
    for (const w of tf.acroField.getWidgets()) w.dict.delete(N('AP'));
    const src = Buffer.from(await d0.save({ updateFieldAppearances: false }));
    const p = await open();
    const res = await p.evaluate(async (b) => { const r = await window.__cowdreyPdf.pdfaConvert(new Uint8Array(b), { part: 2, conformance: 'B' }); return { bytes: Array.from(r.bytes), fixes: r.fixes }; }, Array.from(src));
    ok(res.fixes.includes('Drew the form fields'), JSON.stringify(res.fixes));
    const d = await L.PDFDocument.load(Buffer.from(res.bytes), { updateMetadata: false });
    ok(!d.catalog.lookup(N('AcroForm')).get(N('NeedAppearances')), 'NeedAppearances gone');
    const w = d.context.lookup(d.getPages()[0].node.lookup(N('Annots')).get(0));
    ok(w.lookup(N('AP')) instanceof PDFDict && w.lookup(N('AP')).lookup(N('N')) instanceof PDFStream, 'widget appearance');
    const fonts = allFonts(d); ok(fonts.length >= 1, 'fonts: ' + fonts.length);
    eq(fonts.filter(({ font }) => !fontEmbedded(d, font)).map((f) => f.key), [], 'embedded');
    ok(/Heron|<4865726F6E>/i.test(streamBytes(w.lookup(N('AP')).lookup(N('N'))).toString('latin1')), 'the value is drawn: ' + streamBytes(w.lookup(N('AP')).lookup(N('N'))).toString('latin1'));
    const ck = await check(p, Buffer.from(res.bytes)); eq(ck.list.filter((x) => x.severity === 'error'), [], ck.summary);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('PDF/A: the command is in the File menu and on the Export tab (Archive)', async () => {
    const p = await open(); await openPdf(p);
    const file = await p.evaluate(() => window.__cowdreyPdf.menus().find(([t]) => t === 'File')[1]);
    eq(file[file.indexOf('saveCopy') + 1], 'savePdfa');
    const groups = await p.evaluate(() => window.__cowdreyPdf.ribbon().export[1].map(([g, ids]) => [g, ids]));
    ok(groups.some(([g, ids]) => g === 'Archive' && ids.includes('savePdfa')), JSON.stringify(groups));
    await p.click('[data-rt="export"]'); ok(await p.isVisible('[data-cmd="savePdfa"]'), 'on the ribbon');
    eq(await p.evaluate(() => window.__cowdreyPdf.cmdLabel('savePdfa')), 'Save as PDF/A…');
    await p.ctx.close();
  });

  await test('PDF/A: veraPDF (when installed: $VERAPDF names its jar or script) finds the output compliant', async () => {
    const jar = process.env.VERAPDF, file = path.join(tmp, 'pdfa-2b.pdf');
    if (!jar || !fs.existsSync(jar) || !fs.existsSync(file)) { console.log('      (veraPDF not installed: set VERAPDF to its jar to run it; skipped)'); return; }
    const args = jar.endsWith('.jar') ? ['java', ['-jar', jar, '--flavour', '2b', file]] : [jar, ['--flavour', '2b', file]];
    const r = spawnSync(args[0], args[1], { encoding: 'utf8', timeout: 180000 });
    ok(/isCompliant="true"/.test(r.stdout), 'veraPDF: ' + (r.stdout || r.stderr || '').slice(0, 2000));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
};
