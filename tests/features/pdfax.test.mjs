// PDF/X-1a, X-3, X-4 (src/features/85-pdfx.js) and PDF/A-1b and print colours (src/features/84-pdfa.js), through the
// app's own dialogs. tests/conformance/pkg3.mjs checks the outputs with veraPDF and the PDF/X rule script.
import crypto from 'node:crypto';
export default async (h) => {
  const { test, eq, ok, open, openPdf, answer, path, fs, require, root } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib')), N = L.PDFName.of;
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
  const bytesOf = (s) => Buffer.from(s instanceof L.PDFRawStream ? L.decodePDFRawStream(s).decode() : s.getContents());
  async function pdfx(p, kind) {
    await run(p, 'savePdfx'); await p.waitForSelector('#dialog[open] [name="pdfxKind"]');
    eq(await p.$$eval('#dialog [name="pdfxKind"]', (l) => l.map((x) => x.value)), ['1a', '3', '4']);
    await p.check(`#dialog [name="pdfxKind"][value="${kind}"]`);
    const dl = p.waitForEvent('download', { timeout: 30000 }); dl.catch(() => {});
    await p.click('#dialog .dlg-foot .btn.primary');
    return { dl };
  }

  await test('PDF/X-4: the sample is saved with a FOGRA39 output intent, the version, a TrimBox, trapping stated, RGB defined as sRGB; the built-in check passes', async () => {
    const p = await open(); await openPdf(p);
    const { dl } = await pdfx(p, '4'); const got = await dl;
    eq(got.suggestedFilename(), 'Quarterly report (PDF-X).pdf');
    const b = fs.readFileSync(await got.path()), d = await L.PDFDocument.load(b, { updateMetadata: false });
    ok(/^%PDF-1\.6/.test(b.toString('latin1', 0, 8)), 'PDF 1.6');
    const oi = d.context.lookup(d.catalog.lookup(N('OutputIntents')).get(0));
    eq([String(oi.get(N('S'))), oi.lookup(N('OutputConditionIdentifier')).decodeText()], ['/GTS_PDFX', 'FOGRA39']);
    const icc = bytesOf(oi.lookup(N('DestOutputProfile')));
    eq(crypto.createHash('sha256').update(icc).digest('hex'), '3ff7ca2a650ad47a8d2a929eb23ef162ccf979d013ade56e441c1f55156a261f', 'the shipped FOGRA39 profile');
    const info = d.getInfoDict();
    eq([info.lookup(N('GTS_PDFXVersion')).decodeText(), String(info.get(N('Trapped')))], ['PDF/X-4', '/False']);
    ok(d.getPages().every((pg) => pg.node.lookup(N('TrimBox'))), 'TrimBox on every page');
    const x = bytesOf(d.catalog.lookup(N('Metadata'))).toString();
    ok(x.includes('<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>'), 'XMP pdfxid');
    ok(d.getPages()[0].node.Resources().lookup(N('ColorSpace')).get(N('DefaultRGB')), 'DefaultRGB');
    const ck = await p.evaluate(async (a) => { const r = await window.__cowdreyPdf.pdfxCheck(new Uint8Array(a)); return { errs: r.filter((x) => x.severity === 'error').map((x) => x.text), passed: r.passed.length }; }, Array.from(b));
    eq(ck.errs, []); ok(ck.passed > 15, 'rules ' + ck.passed);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('PDF/X-1a: RGB content is refused with the reason, and no file is saved', async () => {
    const p = await open(); await openPdf(p);
    let saved = false; p.on('download', () => { saved = true; });
    await pdfx(p, '1a');
    await p.waitForSelector('#dialog[open] .pdfa-probs', { timeout: 30000 });
    eq(await p.textContent('#dialog h2'), "Can't save as PDF/X-1a");
    ok(/Page 1 uses RGB or calibrated colours\. PDF\/X-1a takes CMYK and grey only: use PDF\/X-3 or PDF\/X-4\./.test(await p.textContent('#dialog .pdfa-probs')), await p.textContent('#dialog .pdfa-probs'));
    await answer(p, 'OK'); await p.waitForTimeout(800);
    ok(!saved, 'no file');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('PDF/A: the dialog offers 1b, 2b, 2u, 3b, 3u and screen or print colours; PDF/A-1b has no object streams and passes the built-in check', async () => {
    const p = await open(); await openPdf(p);
    await run(p, 'savePdfa'); await p.waitForSelector('#dialog[open] .pdfa-levels');
    eq(await p.$$eval('#dialog [name="pdfaLevel"]', (l) => l.map((x) => x.value)), ['1b', '2b', '2u', '3b', '3u']);
    eq(await p.$$eval('#dialog [name="pdfaIntent"] option', (l) => l.map((x) => x.value)), ['srgb', 'cmyk']);
    eq(await p.inputValue('#dialog [name="pdfaIntent"]'), 'srgb', 'an RGB document starts on screen colours');
    await p.check('#dialog [name="pdfaLevel"][value="1b"]');
    const dl = p.waitForEvent('download', { timeout: 30000 }); await p.click('#dialog .dlg-foot .btn.primary');
    const b = fs.readFileSync(await (await dl).path());
    ok(/^%PDF-1\.4/.test(b.toString('latin1', 0, 8)) && !b.includes('/ObjStm'), 'PDF 1.4 layout');
    const ck = await p.evaluate(async (a) => { const r = await window.__cowdreyPdf.pdfaCheck(new Uint8Array(a)); return r.filter((x) => x.severity === 'error').map((x) => x.text); }, Array.from(b));
    eq(ck, []);
    // print colours for this RGB document: refused, with the way out
    await run(p, 'savePdfa'); await p.waitForSelector('#dialog[open] .pdfa-levels');
    await p.selectOption('#dialog [name="pdfaIntent"]', 'cmyk'); await p.click('#dialog .dlg-foot .btn.primary');
    await p.waitForSelector('#dialog[open] .pdfa-probs', { timeout: 30000 });
    ok(/uses RGB colours, which print \(CMYK\) colours don't cover/.test(await p.textContent('#dialog .pdfa-probs')), await p.textContent('#dialog .pdfa-probs'));
    await answer(p, 'OK');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('PDF/X: the command is in the File menu after Save as PDF/A, and on the Export tab', async () => {
    const p = await open(); await openPdf(p);
    const file = await p.evaluate(() => window.__cowdreyPdf.menus().find(([t]) => t === 'File')[1]);
    const i = file.indexOf('savePdfa'); ok(i > 0 && file.slice(i, i + 3).includes('savePdfx'), JSON.stringify(file));
    await p.click('[data-rt="export"]'); ok(await p.isVisible('[data-cmd="savePdfx"]'), 'on the ribbon');
    eq(await p.evaluate(() => window.__cowdreyPdf.cmdLabel('savePdfx')), 'Save as PDF/X…');
    eq(p.errors, []); await p.ctx.close();
  });
};
