// Document properties: read-only facts about the file, its security and fonts; Title, Author, Subject and Keywords
// changed here are saved into the PDF's Info and kept after reopening.
export default async (h) => {
  const { test, open, openPdf, eq, ok, savedOf, reopen, path, root, fs, PDFDocument, answer, waitPages, fixture } = h;
  const rows = (p) => p.$$eval('#dialog .di-dl', (dls) => dls.map((dl) => { const o = {}; const dt = [...dl.querySelectorAll('dt')]; dt.forEach((d) => { o[d.textContent] = d.nextElementSibling.textContent; }); return o; }));

  await test('Document properties: shows the file, page size, fonts; edits saved into the Info dictionary and kept after reopening; undo', async () => {
    const p = await open(); await openPdf(p);
    await p.keyboard.press('Control+d'); await p.waitForSelector('#dialog[open] .di');
    eq(await p.textContent('#dialog h2'), 'Document properties');
    const [file, sec] = await rows(p);
    eq(file['File name'], 'Quarterly report.pdf'); eq(file.Pages, '3'); eq(file['PDF version'], 'PDF 1.7');
    eq(file['Page size (page 1)'], '8.5 × 11 in (216 × 279 mm)');
    ok(/KB|bytes/.test(file['File size']), file['File size']);
    eq(sec['Password to open'], 'No'); eq(sec.Printing, 'Allowed'); eq(sec['Copying text and images'], 'Allowed');
    const fonts = await p.$$eval('#dialog .di-fonts li', (l) => l.map((x) => [...x.children].map((c) => c.textContent).join(' ')));
    ok(fonts.includes('Helvetica Type 1 · Not embedded') && fonts.includes('Helvetica-Bold Type 1 · Not embedded'), JSON.stringify(fonts));
    eq(await p.inputValue('#dialog [data-di="title"]'), 'Quarterly report');
    await p.fill('#dialog [data-di="title"]', 'Pelican count 2026'); await p.fill('#dialog [data-di="author"]', 'Jane Doe');
    await p.fill('#dialog [data-di="subject"]', 'Birds'); await p.fill('#dialog [data-di="keywords"]', 'pelican, coast');
    await answer(p, 'Done'); await p.waitForTimeout(200);
    let d = await PDFDocument.load(await savedOf(p));
    eq([d.getTitle(), d.getAuthor(), d.getSubject(), d.getKeywords()], ['Pelican count 2026', 'Jane Doe', 'Birds', 'pelican, coast']);
    // undo puts the file's own title back
    await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
    d = await PDFDocument.load(await savedOf(p));
    eq([d.getTitle(), d.getAuthor()], ['Quarterly report', undefined], 'undone');
    await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(100);
    // deleting a page (pages copied into a new PDF) keeps the properties too
    await p.evaluate(() => window.__cowdreyPdf.run('delPage')); await p.waitForTimeout(300);
    const bytes = await savedOf(p); d = await PDFDocument.load(bytes);
    eq([d.getPageCount(), d.getTitle(), d.getAuthor(), d.getSubject(), d.getKeywords()], [2, 'Pelican count 2026', 'Jane Doe', 'Birds', 'pelican, coast']);
    // reopened: the dialog shows what was saved
    await reopen(p, bytes);
    await p.evaluate(() => window.__cowdreyPdf.run('docProps')); await p.waitForSelector('#dialog[open] .di');
    eq(await p.$$eval('#dialog [data-di]', (i) => i.map((x) => x.value)), ['Pelican count 2026', 'Jane Doe', 'Birds', 'pelican, coast']);
    await answer(p, 'Cancel');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Document properties: saving no longer replaces the PDF title with the file name; a PDF with no title gets the file name', async () => {
    const p = await open(); await openPdf(p, path.join(root, 'tests/fixtures/word.pdf'), 'Some other name.pdf');
    eq((await PDFDocument.load(await savedOf(p))).getTitle(), 'Project Pelican');
    await openPdf(p, path.join(root, 'tests/fixtures/chrome.pdf'), 'Web page.pdf');
    eq((await PDFDocument.load(await savedOf(p))).getTitle(), 'Web page');
    await p.ctx.close();
  });

  await test('Document properties: the security summary of a protected PDF', async () => {
    const p = await open();
    const opening = p.evaluate(async (b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return window.__cowdreyPdf.openBytes(u, 'Secret.pdf'); }, fixture('protected.pdf'));
    await p.waitForSelector('#dialog[open] #dlgInput'); await p.fill('#dlgInput', 'pelican'); await p.click('#dialog .btn.primary');
    eq(await opening, true); await waitPages(p); await p.waitForTimeout(300);
    await p.keyboard.press('Control+d'); await p.waitForSelector('#dialog[open] .di');
    const [, sec] = await rows(p);
    eq(sec, { 'Password to open': 'Yes', Printing: 'Allowed', 'Copying text and images': 'Not allowed', 'Changing the document': 'Not allowed', Commenting: 'Allowed', 'Filling in forms': 'Allowed', 'Page extraction': 'Not allowed' });
    ok(await p.$('#dialog .di-dl dd.di-no'), 'marked');
    ok((await p.$$('#dialog .di-fonts li')).length >= 2, 'fonts listed for an encrypted file');
    await answer(p, 'Cancel');
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.marks.__doc || []), [], 'no change when nothing was edited');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Document properties: on a phone the dialog fits the screen', async () => {
    const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p);
    await p.evaluate(() => window.__cowdreyPdf.run('docProps')); await p.waitForSelector('#dialog[open] .di');
    const b = await p.$eval('#dialog', (d) => { const r = d.getBoundingClientRect(); return [r.left, r.right, d.scrollWidth <= d.clientWidth + 1]; });
    ok(b[0] >= 0 && b[1] <= 390 && b[2], JSON.stringify(b));
    await answer(p, 'Cancel'); await p.ctx.close();
  });
};
