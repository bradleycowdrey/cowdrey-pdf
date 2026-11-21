// Security: granular limits (printing, changes, copying), AES-128 or AES-256, saved settings, and the permissions
// password for a PDF whose author set limits.
export default async (h) => {
  const { test, eq, ok, open, openPdf, root, path, fs, require, savedOf, answer } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const C = require(path.join(root, 'desktop/node_modules/@cantoo/pdf-lib'));
  const pdfjs = await import(path.join(root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
  const F = pdfjs.PermissionFlag;
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
  const tmp = (name, bytes) => { const f = path.join(root, 'tests/fixtures', '.sec-' + name); fs.writeFileSync(f, bytes); return f; };
  const flagsOf = async (bytes, password) => { const t = pdfjs.getDocument({ data: new Uint8Array(bytes), password, verbosity: 0 }); const d = await t.promise; const f = await d.getPermissions(); await t.destroy(); return f ? [...f].sort((a, b) => a - b) : null; };
  const encryptOf = async (bytes) => { const d = await C.PDFDocument.load(bytes, { ignoreEncryption: true }); const e = d.context.lookup(d.context.trailerInfo.Encrypt); if (!e) return null; const cf = e.lookup(C.PDFName.of('CF')), std = cf && cf.lookup(C.PDFName.of('StdCF')); return { V: e.lookup(C.PDFName.of('V')).asNumber(), CFM: std ? String(std.lookup(C.PDFName.of('CFM'))) : null }; };
  const noErrors = (p) => eq(p.errors.filter((e) => !/annotation-comment/.test(e)), []);
  const sorted = (a) => [...a].sort((x, y) => x - y);
  // Set limits (no open password) with the dialog.
  async function limits(p, { printing, changes, copy = false, algo, owner = 'boss-only' }) {
    await run(p, 'protPassword'); await p.waitForSelector('#dialog[open] input[name=useOpen]');
    await p.uncheck('#dialog input[name=useOpen]'); await p.check('#dialog input[name=limit]');
    await p.fill('#dialog input[name=owner]', owner);
    await p.selectOption('#dialog select[name=printing]', printing); await p.selectOption('#dialog select[name=changes]', changes);
    if (copy) await p.check('#dialog input[name=copy]'); else await p.uncheck('#dialog input[name=copy]');
    if (algo) await p.selectOption('#dialog select[name=algo]', algo);
    await answer(p, 'Set password'); await p.waitForTimeout(100);
  }

  await test('Security: the limits map to pdf-lib permissions as this table says', async () => {
    const p = await open();
    // changes -> [modifying, documentAssembly, annotating, fillingForms]
    const table = {
      none: [false, false, false, false], pages: [false, true, false, false], forms: [false, false, false, true],
      comment: [false, false, true, true], any: [true, true, true, true],
    };
    for (const [changes, want] of Object.entries(table)) for (const [printing, pr] of [['none', false], ['low', 'lowResolution'], ['high', 'highResolution']]) for (const copy of [false, true]) {
      const got = await p.evaluate((pm) => window.__cowdreyPdf.protPermissions(pm), { printing, changes, copy });
      eq(got, { printing: pr, modifying: want[0], documentAssembly: want[1], annotating: want[2], fillingForms: want[3], copying: copy, contentAccessibility: true }, `${changes}/${printing}/${copy}`);
    }
    await p.ctx.close();
  });

  await test('Security: each choice of changes and printing is exactly what the saved PDF allows (pdf.js getPermissions)', async () => {
    const p = await open(); await openPdf(p);
    const changesFlags = { none: [], pages: [F.ASSEMBLE], forms: [F.FILL_INTERACTIVE_FORMS], comment: [F.MODIFY_ANNOTATIONS, F.FILL_INTERACTIVE_FORMS], any: [F.MODIFY_CONTENTS, F.MODIFY_ANNOTATIONS, F.FILL_INTERACTIVE_FORMS, F.ASSEMBLE] };
    const printFlags = { none: [], low: [F.PRINT], high: [F.PRINT, F.PRINT_HIGH_QUALITY] };
    const rows = [];
    for (const changes of Object.keys(changesFlags)) for (const printing of Object.keys(printFlags)) rows.push({ changes, printing, copy: (rows.length % 4) === 1 });
    for (const row of rows) {
      await limits(p, row);
      const out = await savedOf(p);
      const want = sorted([F.COPY_FOR_ACCESSIBILITY, ...changesFlags[row.changes], ...printFlags[row.printing], ...(row.copy ? [F.COPY] : [])]);
      eq(await flagsOf(out), want, JSON.stringify(row));
    }
    noErrors(p); await p.ctx.close();
  });

  await test('Security: AES-256 by default, AES-128 for older apps; both open with the password', async () => {
    const p = await open(); await openPdf(p);
    await run(p, 'protPassword'); await p.waitForSelector('#dialog[open] input[name=open]');
    eq(await p.inputValue('#dialog select[name=algo]'), 'AES-256', 'the default');
    await p.fill('#dialog input[name=open]', 'heron'); await p.fill('#dialog input[name=open2]', 'heron'); await answer(p, 'Set password'); await p.waitForTimeout(100);
    let out = await savedOf(p);
    eq(await encryptOf(out), { V: 5, CFM: '/AESV3' }, 'AES-256');
    await run(p, 'protPassword'); await p.waitForSelector('#dialog[open] input[name=open]');
    await p.selectOption('#dialog select[name=algo]', 'AES-128'); await answer(p, 'Set password'); await p.waitForTimeout(100);
    out = await savedOf(p);
    eq(await encryptOf(out), { V: 4, CFM: '/AESV2' }, 'AES-128');
    eq((await C.PDFDocument.load(out, { password: 'heron' })).getPageCount(), 3);
    const t = pdfjs.getDocument({ data: new Uint8Array(out), password: 'heron', verbosity: 0 }); eq((await t.promise).numPages, 3, 'pdf.js opens it'); await t.destroy();
    noErrors(p); await p.ctx.close();
  });

  await test('Security: settings saved as a preset (never the passwords) and picked again', async () => {
    const p = await open(); await openPdf(p);
    await run(p, 'protPassword'); await p.waitForSelector('#dialog[open] input[name=open]');
    await p.uncheck('#dialog input[name=useOpen]'); await p.check('#dialog input[name=limit]'); await p.fill('#dialog input[name=owner]', 'boss-only');
    await p.selectOption('#dialog select[name=printing]', 'low'); await p.selectOption('#dialog select[name=changes]', 'pages'); await p.check('#dialog input[name=copy]');
    await p.selectOption('#dialog select[name=algo]', 'AES-128');
    await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/sec-dialog.png' });
    await p.click('#dialog .dlg-body button:has-text("Save these settings as")');
    await p.waitForSelector('#dialog[open] #dlgInput'); await p.fill('#dlgInput', 'Review copy'); await p.click('#dialog .btn.primary');
    await p.waitForSelector('#dialog[open] select[name=preset]');
    const stored = await p.evaluate(() => JSON.stringify(window.__cowdreyPdf.S.protPresets));
    ok(/Review copy/.test(stored) && !/boss-only/.test(stored) && !/owner|open2/.test(stored), stored);
    eq(await p.inputValue('#dialog input[name=owner]'), 'boss-only', 'what was typed is kept while the dialog is open');
    await answer(p, 'Cancel');
    // A new dialog: pick it
    await run(p, 'protPassword'); await p.waitForSelector('#dialog[open] select[name=preset]');
    await p.selectOption('#dialog select[name=preset]', '0');
    eq([await p.isChecked('#dialog input[name=limit]'), await p.isChecked('#dialog input[name=useOpen]'), await p.inputValue('#dialog select[name=printing]'), await p.inputValue('#dialog select[name=changes]'), await p.isChecked('#dialog input[name=copy]'), await p.inputValue('#dialog select[name=algo]')], [true, false, 'low', 'pages', true, 'AES-128'], 'the preset fills the dialog');
    ok(await p.isVisible('#dialog input[name=owner]'), 'the limits part is shown');
    eq(await p.inputValue('#dialog input[name=owner]'), '', 'no password comes with it');
    await p.fill('#dialog input[name=owner]', 'boss-only'); await answer(p, 'Set password'); await p.waitForTimeout(100);
    const out = await savedOf(p);
    eq(await flagsOf(out), sorted([F.PRINT, F.COPY, F.COPY_FOR_ACCESSIBILITY, F.ASSEMBLE]));
    eq((await encryptOf(out)).V, 4);
    noErrors(p); await p.ctx.close();
  });

  await test('Security: a PDF its author limited: editing is off until the permissions password is entered; then security can be removed', async () => {
    const d0 = await C.PDFDocument.create(), pg = d0.addPage([612, 792]);
    pg.drawText('Limited by its author', { x: 72, y: 700, size: 18, font: await d0.embedFont(C.StandardFonts.Helvetica) });
    d0.encrypt({ userPassword: '', ownerPassword: 'author-secret', permissions: { printing: 'highResolution', modifying: false, copying: false, annotating: false, fillingForms: false, contentAccessibility: true, documentAssembly: false } });
    const orig = await d0.save(), file = tmp('limited.pdf', orig);
    try {
      const p = await open(); await openPdf(p, file, 'Limited.pdf');
      await p.waitForFunction(() => /doesn’t allow changes/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 5000 });
      const en = (id) => p.evaluate((i) => window.__cowdreyPdf.cmdEnabled(i), id);
      eq([await en('tool_edit'), await en('tool_text'), await en('protRedArea'), await en('tool_note'), await en('rotR'), await en('protOwnerPw')], [false, false, false, false, false, true], 'editing, comments and pages are off');
      await p.click('[data-rt="edit"]');
      eq(await p.$eval('#ribbonBody [data-cmd="tool_edit"]', (b) => [b.disabled, b.title]), [true, 'The author of this PDF doesn’t allow changes. Enter the permissions password to edit.']);
      await p.click('[data-rt="protect"]');
      ok(await p.$('#ribbonBody [data-cmd="protOwnerPw"]'), 'Enter permissions password on the Protect tab');
      eq(await en('protUnsecure'), false, 'Remove security needs the permissions password');
      // and in Document properties, under Security
      await run(p, 'docProps'); await p.waitForSelector('#dialog[open] .prot-unlock', { state: 'attached' });
      if (await p.$('#dialog [data-di-tab="file"]')) await p.click('#dialog [data-di-tab="file"]'); // the File tab holds Security
      await p.waitForSelector('#dialog[open] .prot-unlock');
      await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/sec-docinfo.png' });
      await p.click('#dialog .prot-unlock');
      await p.waitForSelector('#dialog[open] #dlgInput'); eq(await p.textContent('#dialog h2'), 'Enter permissions password');
      await p.fill('#dlgInput', 'guess'); await p.click('#dialog .btn.primary');
      await p.waitForFunction(() => document.querySelector('#dialog[open] h2')?.textContent === 'That is not the permissions password');
      eq(await p.evaluate(() => window.__cowdreyPdf.protUnlocked()), false);
      await p.fill('#dlgInput', 'author-secret'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(300);
      eq(await p.evaluate(() => window.__cowdreyPdf.protUnlocked()), true, 'unlocked');
      eq([await en('tool_edit'), await en('rotR'), await en('protUnsecure')], [true, true, true], 'editing is on again');
      eq(await p.$('#ribbonBody [data-cmd="protOwnerPw"]'), null, 'nothing more to unlock');
      // without a change to the security, saving keeps the author's limits
      eq(await flagsOf(await savedOf(p)), await flagsOf(orig), 'limits kept when nothing was changed');
      // new limits can now allow more than the author's
      await limits(p, { printing: 'high', changes: 'any', copy: true, owner: 'mine' });
      eq(await flagsOf(await savedOf(p)), sorted(Object.values(F)), 'the new limits allow everything');
      await run(p, 'protUnsecure'); await p.waitForTimeout(100);
      const out = await savedOf(p);
      ok(!Buffer.from(out).toString('latin1').includes('/Encrypt'), 'no /Encrypt');
      const d = await L.PDFDocument.load(out); eq([d.isEncrypted, d.getPageCount()], [false, 1]);
      eq(await flagsOf(out), null, 'no limits');
      noErrors(p); await p.ctx.close();
    } finally { fs.unlinkSync(file); }
  });

  await test('Security: following the author\'s limits can be turned off; forms follow their own flag', async () => {
    const d0 = await C.PDFDocument.create(), pg = d0.addPage([612, 792]), form = d0.getForm();
    form.createTextField('name').addToPage(pg, { x: 72, y: 600, width: 200, height: 24 });
    pg.drawText('A form', { x: 72, y: 700, size: 18, font: await d0.embedFont(C.StandardFonts.Helvetica) });
    d0.encrypt({ userPassword: '', ownerPassword: 'author-secret', permissions: { printing: 'highResolution', modifying: false, copying: true, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: false } });
    const file = tmp('forms.pdf', await d0.save());
    try {
      const p = await open(); await openPdf(p, file, 'Form.pdf');
      await p.waitForTimeout(300);
      const en = (id) => p.evaluate((i) => window.__cowdreyPdf.cmdEnabled(i), id);
      eq([await en('tool_edit'), await en('tool_note'), await p.$eval('.annotationLayer input', (e) => e.disabled)], [false, true, false], 'comments and forms allowed, changes not');
      await run(p, 'protRespect'); await p.waitForTimeout(100);
      eq(await en('tool_edit'), true, 'not followed: editing allowed');
      eq(await p.evaluate(() => window.__cowdreyPdf.S.protRespect), false);
      await run(p, 'protRespect'); await p.waitForTimeout(100);
      eq(await en('tool_edit'), false, 'followed again');
      noErrors(p); await p.ctx.close();
    } finally { fs.unlinkSync(file); }
  });

  await test('Security: the permissions password of a PDF opened with its open password (tests/fixtures/protected.pdf)', async () => {
    const p = await open();
    const opening = p.evaluate(async (b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return window.__cowdreyPdf.openBytes(u, 'Secret.pdf'); }, h.fixture('protected.pdf'));
    await p.waitForSelector('#dialog[open] #dlgInput'); await p.fill('#dlgInput', 'pelican'); await p.click('#dialog .btn.primary');
    eq(await opening, true); await h.waitPages(p); await p.waitForTimeout(300);
    // Its open password already lets Remove security work; editing tools are not turned off for it
    eq(await p.evaluate(() => [window.__cowdreyPdf.cmdEnabled('protUnsecure'), window.__cowdreyPdf.cmdEnabled('tool_edit'), window.__cowdreyPdf.cmdShown('protOwnerPw')]), [true, true, false]);
    noErrors(p); await p.ctx.close();
  });

  await test('Security: a PDF whose author forbids page changes: the sidebar\'s drag and drop and Delete key don\'t change its pages either', async () => {
    const d0 = await C.PDFDocument.create(), font = await d0.embedFont(C.StandardFonts.Helvetica);
    for (let i = 0; i < 3; i++) d0.addPage([612, 792]).drawText('Page ' + (i + 1), { x: 72, y: 700, size: 18, font });
    d0.encrypt({ userPassword: '', ownerPassword: 'author-secret', permissions: { printing: 'highResolution', modifying: false, copying: true, annotating: false, fillingForms: false, contentAccessibility: true, documentAssembly: false } });
    const file = tmp('pages.pdf', await d0.save());
    try {
      const p = await open(); await openPdf(p, file, 'Pages.pdf'); await p.waitForTimeout(300);
      const order = () => p.evaluate(() => window.__cowdreyPdf.doc.pages.map((e) => e.i));
      eq([await p.evaluate(() => window.__cowdreyPdf.cmdEnabled('rotR')), await p.evaluate(() => window.__cowdreyPdf.cmdEnabled('delPage'))], [false, false]);
      await p.dragAndDrop('.thumb[data-n="0"]', '.thumb[data-n="2"]'); await p.waitForTimeout(200);
      eq(await order(), [0, 1, 2], 'dragging a page does not move it');
      ok(/doesn’t allow changes to its pages/.test(await p.textContent('#toast')), await p.textContent('#toast'));
      await p.focus('.thumb[data-n="1"]'); await p.keyboard.press('Delete'); await p.waitForTimeout(200);
      eq(await p.$('#dialog[open]'), null, 'no Delete pages dialog');
      eq(await order(), [0, 1, 2], 'the Delete key does not delete it');
      // Any other way to the pages stops too (the Organize grid's move)
      await p.evaluate(() => window.__cowdreyPdf.pg60Org.move(0, 3));
      eq(await order(), [0, 1, 2], 'nor a move from elsewhere');
      // With the permissions password the pages can be changed again
      await run(p, 'protOwnerPw'); await p.waitForSelector('#dialog[open] #dlgInput'); await p.fill('#dlgInput', 'author-secret'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(300);
      await p.dragAndDrop('.thumb[data-n="0"]', '.thumb[data-n="2"]'); await p.waitForTimeout(200);
      eq(await order(), [1, 2, 0], 'unlocked: dragging moves the page');
      noErrors(p); await p.ctx.close();
    } finally { fs.unlinkSync(file); }
  });
};
