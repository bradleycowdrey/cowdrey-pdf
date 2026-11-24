// Copies made outside the save path keep a PDF's password (OCR in 90-ocr.js, the page design read back in
// 40-page-design.js): a password-protected file that (wrongly) claims PDF/A loses the claim first, as saving does,
// since pdf-lib refuses to encrypt a file that claims PDF/A.
export default async (h) => {
  const { test, eq, ok, open, savedOf, path, fs, require, root } = h;
  const NM = path.join(root, 'desktop/node_modules');
  const C = require(path.join(NM, '@cantoo/pdf-lib'));
  const pdfjs = await import(path.join(NM, 'pdfjs-dist/legacy/build/pdf.mjs'));
  const N = (k) => C.PDFName.of(k);
  const XMP = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>2</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  // A document protected with the password "pelican" that claims PDF/A-2b (the claim added after encrypt(), which
  // refuses a document that claims it).
  // info: { key: text } for the Info dictionary.
  const protectWithClaim = async (d, info = {}) => {
    d.encrypt({ userPassword: 'pelican', ownerPassword: 'pelican' });
    for (const [k, v] of Object.entries(info)) d.getInfoDict().set(N(k), C.PDFHexString.fromText(v));
    d.catalog.set(N('Metadata'), d.context.register(d.context.stream(XMP, { Type: 'Metadata', Subtype: 'XML' })));
    return Buffer.from(await d.save());
  };
  const claims = async (bytes) => {
    const d = await C.PDFDocument.load(bytes, { password: 'pelican', updateMetadata: false }), m = d.catalog.lookup(N('Metadata'));
    return !!m && /pdfaid:part/.test(Buffer.from(C.decodePDFRawStream(m).decode()).toString('utf8'));
  };
  const openProtected = async (p, bytes, name = 'Secret.pdf') => {
    const opening = p.evaluate(async ([b, n]) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return window.__cowdreyPdf.openBytes(u, n); }, [bytes.toString('base64'), name]);
    await p.waitForSelector('#dialog[open] #dlgInput'); await p.fill('#dlgInput', 'pelican'); await p.click('#dialog .btn.primary');
    await opening; await p.waitForSelector('.page canvas.pdf'); await p.waitForTimeout(500);
  };
  const textOf = async (bytes) => { const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), password: 'pelican', verbosity: 0, isEvalSupported: false }).promise; try { return (await (await d.getPage(1)).getTextContent()).items.map((i) => i.str).join(' '); } finally { await d.loadingTask.destroy(); } };

  await test('fonts/protect: OCR of a protected file that claims PDF/A keeps the password and drops the claim', async () => {
    const p = await open();
    // a scan: one line drawn on a picture, with the recognizer a stand-in that returns its words
    const scan = await p.evaluate(() => {
      const W = 1700, H = 2200, c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.fillStyle = '#111'; x.font = 'bold 54px Arial, sans-serif';
      const words = []; let cx = 160;
      for (const w of 'Archive copy forty two'.split(' ')) { const m = x.measureText(w); x.fillText(w, cx, 300); words.push({ text: w, bbox: { x0: cx, y0: 300 - m.actualBoundingBoxAscent, x1: cx + m.width, y1: 300 + m.actualBoundingBoxDescent }, confidence: 92 }); cx += m.width + 20; }
      return { png: c.toDataURL('image/png').split(',')[1], lines: [{ baseline: { x0: 160, y0: 300, x1: cx, y1: 300 }, words }], W };
    });
    const d = await C.PDFDocument.create({ updateMetadata: false }), img = await d.embedPng(Buffer.from(scan.png, 'base64'));
    d.addPage([612, 792]).drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
    const src = await protectWithClaim(d);
    ok(await claims(src), 'the test file claims PDF/A');
    await openProtected(p, src);
    await p.evaluate((s) => window.__cowdreyPdf.ocrUseEngine({ async start() {}, async stop() {}, async recognize(canvas) { const k = canvas.width / s.W, box = (b) => ({ x0: b.x0 * k, y0: b.y0 * k, x1: b.x1 * k, y1: b.y1 * k }); return { lines: s.lines.map((l) => ({ baseline: box(l.baseline), words: l.words.map((w) => ({ ...w, bbox: box(w.bbox) })) })) }; } }), { lines: scan.lines, W: scan.W });
    const r = await p.evaluate(() => window.__cowdreyPdf.ocrRun({ pages: [0] }));
    eq(r && r.pages, 1, 'recognized');
    // the copy OCR made (the new source) has the password and no PDF/A claim
    const copy = Buffer.from(await p.evaluate(() => { const s = window.__cowdreyPdf.doc.sources; return Array.from(s[s.length - 1]); }));
    await C.PDFDocument.load(copy).then(() => { throw new Error('the copy opened without the password'); }, () => {});
    ok(!(await claims(copy)), 'the copy does not claim PDF/A');
    ok((await textOf(copy)).includes('Archive copy forty two'), 'the words are in the copy');
    const building = savedOf(p); await h.answer(p, 'Keep password'); const out = await building;
    ok((await textOf(out)).includes('Archive copy forty two') && !(await claims(out)), 'saved with the words, protected, no claim');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('fonts/protect: a watermark is read back from a protected file that claims PDF/A; the copy keeps the password', async () => {
    const p = await open();
    await openProtected(p, fs.readFileSync(path.join(root, 'tests/fixtures/protected.pdf')));
    await p.evaluate(() => window.__cowdreyPdf.run('pd_watermark')); await p.waitForSelector('#dialog[open] .pd-form');
    await p.fill('#dialog [data-k="text"]', 'SECRET'); await p.click('#dialog .dlg-foot .btn.primary'); await p.waitForTimeout(400);
    const items = await p.evaluate(() => window.__cowdreyPdf.pdItems());
    eq(items.map((m) => m.text), ['SECRET'], 'added');
    const building = savedOf(p); await h.answer(p, 'Keep password'); const kept = await building;
    // the same file, made to claim PDF/A (as another app might have written it); its watermark settings put back in
    // its Info (pdf-lib leaves Info out when it opens a file with its password)
    const src = await protectWithClaim(await C.PDFDocument.load(kept, { password: 'pelican', updateMetadata: false }), { CowdreyPdfPD: JSON.stringify(items) });
    ok(await claims(src), 'the test file claims PDF/A');
    await openProtected(p, src); await p.evaluate(() => window.__cowdreyPdf.pdOpening()); await p.waitForTimeout(300);
    eq((await p.evaluate(() => window.__cowdreyPdf.pdItems())).map((m) => m.text), ['SECRET'], 'read back');
    const copy = Buffer.from(await p.evaluate(() => Array.from(window.__cowdreyPdf.doc.sources[0])));
    await C.PDFDocument.load(copy).then(() => { throw new Error('the copy opened without the password'); }, () => {});
    ok(!(await claims(copy)), 'the copy does not claim PDF/A');
    ok(!(await textOf(copy)).includes('SECRET'), 'the drawing is taken out of the copy');
    eq(p.errors, []); await p.ctx.close();
  });
};
