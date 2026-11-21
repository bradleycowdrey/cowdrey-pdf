// Features from different modules working together: Actions running PDF/A, and the PDF/A and PDF/UA save commands
// side by side in the File menu.
export default async (h) => {
  const { test, eq, ok, open, openPdf, root, path, require } = h;
  const C = require(path.join(root, 'desktop/node_modules/@cantoo/pdf-lib'));
  async function make(label) {
    const d = await C.PDFDocument.create(), f = await d.embedFont(C.StandardFonts.Helvetica);
    const p = d.addPage([612, 792]); p.drawText(`${label} page 1`, { x: 72, y: 700, size: 18, font: f });
    return Buffer.from(await d.save()).toString('base64');
  }

  await test('integration: Actions can run Save as PDF/A (2b and 2u); each file passes the built-in check', async () => {
    const p = await open(); await openPdf(p);
    ok((await p.evaluate(() => window.__cowdreyPdf.batchSteps())).includes('pdfa'), 'the PDF/A step is available');
    for (const level of ['2b', '2u']) {
      const r = await p.evaluate(([a, l]) => window.__cowdreyPdf.batchRun(a, l), [{ name: 'Archive', steps: [{ id: 'pdfa', opts: { level } }] }, [{ name: 'One.pdf', b64: await make('One') }]]);
      eq(r.results.map((x) => x.status), ['done'], level);
      const zip = Buffer.from(r.zip, 'base64'), size = zip.readUInt32LE(18), nl = zip.readUInt16LE(26), xl = zip.readUInt16LE(28);
      const pdf = zip.slice(30 + nl + xl, 30 + nl + xl + size), s = pdf.toString('latin1');
      ok(s.includes('<pdfaid:part>2</pdfaid:part>') && s.includes(`<pdfaid:conformance>${level[1].toUpperCase()}</pdfaid:conformance>`), level + ': claims PDF/A-' + level);
      const check = await p.evaluate(async ([b, cf]) => { const u = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)); const r = await window.__cowdreyPdf.pdfaCheck(u, { part: 2, conformance: cf }); return { passed: r.passed.length, checks: r.checks, list: r.filter((x) => x.severity === 'error').map((x) => x.text) }; }, [pdf.toString('base64'), level[1].toUpperCase()]);
      eq(check.list, [], level + ': no problems'); ok(check.passed === check.checks && check.checks >= 20, level + ': every check passed ' + JSON.stringify(check));
    }
    eq(p.errors, []); await p.ctx.close();
  });

  await test('integration: File menu has Save as PDF/A then Save as PDF/UA after Save a copy; Actions after the exports; Close last', async () => {
    const p = await open(); await p.waitForTimeout(300);
    const f = await p.evaluate(() => window.__cowdreyPdf.menus().find(([t]) => t === 'File')[1]);
    const i = f.indexOf('saveCopy');
    eq(f.slice(i, i + 3), ['saveCopy', 'savePdfa', 'acSaveUA']);
    eq(f[f.indexOf('picExportAll') + 1], 'batch');
    eq(f[f.length - 1], 'closeDoc');
    await p.ctx.close();
  });
};
