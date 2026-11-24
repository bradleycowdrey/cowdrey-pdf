// Document properties (src/features/12-docinfo.js): the producer and modification date typed in are used by the
// next save only; page numbers (/PageLabels) in ranges; the XMP packet edited as text; an untouched packet is kept.
export default async (h) => {
  const { test, open, openPdf, eq, ok, savedOf, reopen, answer, PDFDocument, require, root, path } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib')), N = L.PDFName.of;
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
  const props = async (p) => { await run(p, 'docProps'); await p.waitForSelector('#dialog[open] .di'); };
  const xmpOf = (d) => { const s = d.catalog.lookup(N('Metadata')); return s ? Buffer.from(s instanceof L.PDFRawStream ? L.decodePDFRawStream(s).decode() : s.getContents()).toString('utf8') : ''; };
  // a real save (Save a copy): the producer and date typed in are let go after it
  const reopenAny = async (p, b) => { await p.evaluate(async (a) => { await window.__cowdreyPdf.openBytes(new Uint8Array(a), 'Saved.pdf'); }, Array.from(b)); await p.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 15000 }); await p.waitForTimeout(400); };
  const saveCopy = async (p) => { const [d] = await Promise.all([p.waitForEvent('download'), run(p, 'saveCopy')]); const fs = require('node:fs'); const f = await d.path(); await p.waitForTimeout(150); return fs.readFileSync(f); };

  await test('Document properties: a producer and modification date typed in are used by the next save; later saves stamp the app and the time', async () => {
    const p = await open(); await openPdf(p);
    await props(p);
    await p.fill('#dialog [data-dx="producer"]', 'Press 3.0'); await p.fill('#dialog [data-dx="modified"]', '2021-05-06T07:08:09');
    await answer(p, 'Done'); await p.waitForTimeout(200);
    // a size estimate or preview (no save) doesn't use them up
    let d = await PDFDocument.load(await savedOf(p), { updateMetadata: false });
    eq(d.getProducer(), 'Press 3.0');
    d = await PDFDocument.load(await saveCopy(p), { updateMetadata: false });
    eq([d.getProducer(), d.getModificationDate().toISOString()], ['Press 3.0', await p.evaluate(() => new Date('2021-05-06T07:08:09').toISOString())]);
    const d2 = await PDFDocument.load(await saveCopy(p), { updateMetadata: false });
    ok(/^Cowdrey\.PDF /.test(d2.getProducer()) && Date.now() - d2.getModificationDate() < 60000, `${d2.getProducer()} ${d2.getModificationDate()}`);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Document properties: page numbers i, ii, iii then 1, 2, 3 are saved as /PageLabels and read back', async () => {
    const d0 = await L.PDFDocument.create(); for (let i = 0; i < 6; i++) d0.addPage([300, 300]);
    const p = await open(); await reopenAny(p, Buffer.from(await d0.save()));
    await props(p); await p.click('#dialog [data-di-tab="view"]');
    await p.click('#dialog [data-ladd]'); await p.selectOption('#dialog .di-lrow:nth-child(1) [data-ls]', 'r');
    await p.click('#dialog [data-ladd]'); await p.fill('#dialog .di-lrow:nth-child(2) [data-lf]', '4');
    eq(await p.textContent('#dialog [data-lpreview]'), 'Pages: i, ii, iii, 1, 2, 3');
    await answer(p, 'Done'); await p.waitForTimeout(200);
    const bytes = await savedOf(p), d = await PDFDocument.load(bytes);
    const nums = d.catalog.lookup(N('PageLabels')).lookup(N('Nums')).asArray().map((x) => String(d.context.lookup(x)));
    eq(nums.map((s) => s.replace(/\s+/g, ' ')), ['0', '<< /Type /PageLabel /S /r >>', '3', '<< /Type /PageLabel /S /D >>']);
    await reopenAny(p, bytes);
    eq(await p.evaluate(async () => { const l = (await window.__cowdreyPdf.diMeta(0)).labels; return [1, 2, 3, 4, 5, 6].map((n) => window.__cowdreyPdf.diLabelOf(l, n)); }), ['i', 'ii', 'iii', '1', '2', '3']);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Document properties: the XMP packet is edited as text; its title change reaches the fields; other properties are kept as typed', async () => {
    const d0 = await L.PDFDocument.create({ updateMetadata: false }); d0.addPage([300, 300]); d0.setTitle('Old title');
    const xmp = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:acme="http://example.org/acme/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Old title</rdf:li><rdf:li xml:lang="de">Alter Titel</rdf:li></rdf:Alt></dc:title><acme:Code>A1</acme:Code></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
    d0.catalog.set(N('Metadata'), d0.context.register(d0.context.stream(Buffer.from(xmp), { Type: 'Metadata', Subtype: 'XML' })));
    const p = await open(); await reopenAny(p, Buffer.from(await d0.save()));
    // untouched: the packet keeps its form (the German title, the unknown property)
    let x = xmpOf(await PDFDocument.load(await savedOf(p), { updateMetadata: false }));
    ok(x.includes('<rdf:li xml:lang="de">Alter Titel</rdf:li>') && x.includes('<acme:Code>A1</acme:Code>') && /<pdf:Producer>Cowdrey\.PDF/.test(x), x);
    await props(p); await p.click('#dialog [data-di-tab="xmp"]');
    const t = await p.inputValue('#dialog [data-dx="xmp"]'); ok(t.includes('acme:Code'), 'the packet is shown');
    await p.fill('#dialog [data-dx="xmp"]', t.replace('>Old title<', '>New title<').replace('>A1<', '>B2<'));
    await answer(p, 'Done'); await p.waitForTimeout(200);
    const d = await PDFDocument.load(await savedOf(p), { updateMetadata: false }); x = xmpOf(d);
    eq(d.getTitle(), 'New title');
    ok(x.includes('<acme:Code>B2</acme:Code>') && x.includes('Alter Titel') && x.includes('>New title<'), x);
    // not XML: refused, nothing else lost
    await props(p); await p.click('#dialog [data-di-tab="xmp"]'); await p.fill('#dialog [data-dx="xmp"]', '<x:xmpmeta><broken'); await answer(p, 'Done');
    await p.waitForFunction(() => /not valid XML/.test(document.querySelector('#toast, .toast')?.textContent || document.body.textContent));
    // the dialog stays open on the XMP tab with the text as typed
    ok(await p.$('#dialog[open]'), 'the dialog stays open'); eq(await p.inputValue('#dialog [data-dx="xmp"]'), '<x:xmpmeta><broken');
    await answer(p, 'Cancel'); await p.waitForTimeout(150);
    eq((await PDFDocument.load(await savedOf(p), { updateMetadata: false })).getTitle(), 'New title');
    eq(p.errors, []); await p.ctx.close();
  });
};
