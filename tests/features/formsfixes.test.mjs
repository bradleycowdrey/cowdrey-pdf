// Form designer, regressions: a signed signature field is left alone, a moved field keeps its own font, a nested
// name stays as it is, a total in focus is shown up to date, check box styles are read, and a sum of a field list
// given as one string is worked out.
export default async (h) => {
  const { test, open, openPdf, eq, ok, savedOf, at, PDFDocument, require, path, root, fs } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const fontkit = require(path.join(root, 'desktop/node_modules/@pdf-lib/fontkit'));
  const { PDFName, PDFDict, PDFArray, PDFRef, PDFHexString, PDFString, StandardFonts } = L;
  const N = (k) => PDFName.of(k);
  const drag = async (p, a, b) => { const [x1, y1] = await at(p, ...a), [x2, y2] = await at(p, ...b); await p.mouse.move(x1, y1); await p.mouse.down(); await p.mouse.move(x2, y2, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(150); };
  const tmp = (name) => path.join(root, 'tests/fixtures/.fx-' + name + '.pdf');
  async function fixture(p, name, make) {
    const d = await PDFDocument.create(), font = await d.embedFont(StandardFonts.Helvetica);
    d.addPage([612, 792]).drawText('A form', { x: 72, y: 740, size: 14, font });
    await make(d, d.getForm());
    const file = tmp(name); fs.writeFileSync(file, await d.save());
    try { await openPdf(p, file, name + '.pdf'); } finally { fs.unlinkSync(file); }
    await p.waitForTimeout(400);
  }
  const streamText = (d, ref) => { const s = d.context.lookup(ref); return Buffer.from(s instanceof L.PDFRawStream ? L.decodePDFRawStream(s).decode() : s.getContents()).toString('latin1'); };
  const jsAct = (d, s) => d.context.obj({ S: 'JavaScript', JS: PDFString.of(s) });
  const fieldMarks = (p) => p.evaluate(() => Object.entries(window.__cowdreyPdf.doc.marks).filter(([k]) => k !== '__doc').flatMap(([, l]) => l).filter((m) => m.type === 'ff' || m.type === 'ffx'));

  await test('forms designer: a signed signature field is not offered a picture, and keeps its signature when saved', async () => {
    const p = await open({ width: 1000, height: 1300 });
    await fixture(p, 'signed', async (d) => {
      const pg = d.getPage(0), c = d.context;
      const look = c.register(c.stream('0 0 1 rg 10 10 100 10 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 180, 40] }));
      const sig = c.register(c.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', ByteRange: [0, 100, 200, 300], Contents: PDFHexString.of('00'.repeat(64)), Name: PDFString.of('Tester') }));
      const w1 = c.register(c.obj({ FT: 'Sig', T: PDFHexString.fromText('Signed'), V: sig, Type: 'Annot', Subtype: 'Widget', Rect: [72, 500, 252, 540], F: 4, P: pg.ref, AP: { N: look } }));
      const empty = c.register(c.stream('0.5 G 0.5 0.5 179 39 re S', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 180, 40] }));
      const w2 = c.register(c.obj({ FT: 'Sig', T: PDFHexString.fromText('Empty'), Type: 'Annot', Subtype: 'Widget', Rect: [72, 300, 252, 340], F: 4, P: pg.ref, AP: { N: empty } }));
      for (const r of [w1, w2]) { pg.node.addAnnot(r); d.catalog.getOrCreateAcroForm().addField(r); }
      d.catalog.getOrCreateAcroForm().dict.set(N('SigFlags'), c.obj(3));
    });
    await p.click('[data-rt="forms"]'); await p.click('[data-cmd="ffPreview"]');
    await p.waitForFunction(() => document.querySelectorAll('.ffd-layer .ffd-sighit').length === 1, null, { timeout: 5000 });
    const [x, y] = await at(p, 160, 520);
    const hit = await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest('.ffd-sighit')); }, [x, y]);
    ok(!hit, 'nothing to click over the signed field');
    // the empty one still takes a picture
    await p.click('.ffd-layer .ffd-sighit'); await p.waitForSelector('#dialog[open]');
    { const pick = p.locator('#dialog[open] button', { hasText: 'Place signature picture only' }); if (await pick.count()) await pick.click(); }
    await p.waitForSelector('#dialog[open] #sigPad');
    const b = await p.$eval('#sigPad', (c) => { const r = c.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
    await p.mouse.move(b[0] + 40, b[1] + b[3] / 2); await p.mouse.down(); await p.mouse.move(b[0] + b[2] - 40, b[1] + 20, { steps: 6 }); await p.mouse.up();
    await p.click('#dialog .btn.primary'); await p.waitForTimeout(250);
    const d = await PDFDocument.load(await savedOf(p)), f = d.getForm();
    const signed = f.getField('Signed').acroField.dict, v = signed.lookup(N('V'));
    ok(v instanceof PDFDict && String(v.get(N('Filter'))) === '/Adobe.PPKLite', 'its signature kept');
    const ap = signed.lookup(N('AP')).get(N('N'));
    eq(streamText(d, ap).trim(), '0 0 1 rg 10 10 100 10 re f', 'its look kept');
    ok(/\/Im0 Do/.test(streamText(d, f.getField('Empty').acroField.dict.lookup(N('AP')).get(N('N')))), 'the empty field has the picture');
    // moved while designing: still signed
    await p.click('[data-cmd="ff_edit"]'); await p.waitForSelector('.ff-layer .ffx[data-name="Signed"]', { state: 'visible' });
    const drag2 = async (a, b) => { const [x1, y1] = await at(p, ...a), [x2, y2] = await at(p, ...b); await p.mouse.move(x1, y1); await p.mouse.down(); await p.mouse.move(x2, y2, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(150); };
    await drag2([160, 520], [200, 520]);
    ok((await fieldMarks(p)).some((m) => m.type === 'ffx' && m.name === 'Signed'), 'moved');
    const d2 = await PDFDocument.load(await savedOf(p)), s2 = d2.getForm().getField('Signed').acroField.dict;
    ok(s2.lookup(N('V')) instanceof PDFDict, 'still signed once moved');
    eq(streamText(d2, s2.lookup(N('AP')).get(N('N'))).trim(), '0 0 1 rg 10 10 100 10 re f', 'its look kept once moved');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('forms designer: a field from the PDF that is moved keeps its own font and the text in it', async () => {
    const ttf = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'].find((x) => fs.existsSync(x));
    const p = await open({ width: 1000, height: 1300 });
    await fixture(p, 'ownfont', async (d, form) => {
      const pg = d.getPage(0), c = d.context, af = d.catalog.getOrCreateAcroForm().dict;
      const fonts = c.obj({}); af.set(N('DR'), c.obj({ Font: fonts }));
      const cour = await d.embedFont(StandardFonts.Courier);
      const t2 = form.createTextField('Cour'); t2.addToPage(pg, { x: 72, y: 540, width: 200, height: 22, font: cour }); t2.setText('Hello'); t2.updateAppearances(cour);
      fonts.set(N('F9'), cour.ref); t2.acroField.setDefaultAppearance('/F9 12 Tf 0 g');
      if (ttf) {
        d.registerFontkit(fontkit); const dj = await d.embedFont(fs.readFileSync(ttf));
        const t = form.createTextField('Cyr'); t.addToPage(pg, { x: 72, y: 600, width: 200, height: 22, font: dj }); t.setText('Привет мир'); t.updateAppearances(dj);
        fonts.set(N('DJ'), dj.ref); t.acroField.setDefaultAppearance('/DJ 12 Tf 0 g');
      }
    });
    await p.click('[data-rt="forms"]'); await p.click('[data-cmd="ff_edit"]');
    await p.waitForSelector('.ff-layer .ffx[data-name="Cour"]', { state: 'visible' });
    await drag(p, [172, 551], [212, 551]);
    if (ttf) await drag(p, [172, 611], [212, 611]);
    eq((await fieldMarks(p)).length, ttf ? 2 : 1, 'proxies made');
    const d = await PDFDocument.load(await savedOf(p)), f = d.getForm();
    const cour = f.getTextField('Cour'), cw = cour.acroField.getWidgets()[0];
    eq(cour.acroField.getDefaultAppearance(), '/F9 12 Tf 0 g', 'Courier DA kept');
    ok(Math.abs(cw.getRectangle().x - 112) < 2, 'moved ' + cw.getRectangle().x);
    const cap = cw.dict.lookup(N('AP')).get(N('N')), cres = d.context.lookup(cap).dict.lookup(N('Resources')).lookup(N('Font'));
    ok(cres.keys().some((k) => /Courier/.test(String(cres.lookup(k).get(N('BaseFont'))))), 'drawn in Courier');
    ok(/Hello|48656C6C6F/i.test(streamText(d, cap)), 'with its text: ' + streamText(d, cap));
    if (ttf) {
      const cyr = f.getTextField('Cyr'), w = cyr.acroField.getWidgets()[0];
      eq(cyr.acroField.getDefaultAppearance(), '/DJ 12 Tf 0 g', 'its own font named');
      eq(cyr.getText(), 'Привет мир');
      ok(Math.abs(w.getRectangle().x - 112) < 2, 'moved ' + w.getRectangle().x);
      const s = streamText(d, w.dict.lookup(N('AP')).get(N('N')));
      ok(!/3F3F3F/.test(s) && !/\?\?\?/.test(s), 'no question marks in its look: ' + s.slice(0, 200));
      const na = d.catalog.lookup(N('AcroForm')).lookup(N('NeedAppearances'));
      ok(na && na.asBoolean && na.asBoolean(), 'other apps draw it again');
      // a new size: still its own font
      await p.dblclick('.marks .ffx-mk[data-id="' + (await fieldMarks(p)).find((m) => m.name === 'Cyr').id + '"]'); await p.waitForSelector('#dialog[open] #ffSize');
      ok((await p.textContent('#dialog [data-ffd-panel="look"]')).includes('It uses a font of this PDF (DejaVuSans'), 'says it has a font of its own');
      await p.selectOption('#ffSize', '14'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(250);
      const d2 = await PDFDocument.load(await savedOf(p)), c2 = d2.getForm().getTextField('Cyr');
      eq(c2.acroField.getDefaultAppearance(), '/DJ 14 Tf 0 g', 'its own font, at the new size');
      ok(!/3F3F3F/.test(streamText(d2, c2.acroField.getWidgets()[0].dict.lookup(N('AP')).get(N('N')))), 'no question marks');
    }
    eq(p.errors, []); await p.ctx.close();
  });

  await test('forms designer: a field with a dotted name keeps its name when its settings change, and a rename keeps its parent', async () => {
    const p = await open({ width: 1000, height: 1300 });
    await fixture(p, 'nested', async (d, form) => { const t = form.createTextField('Addr.City'); t.setText('Paris'); t.addToPage(d.getPage(0), { x: 72, y: 600, width: 200, height: 22 }); });
    await p.click('[data-rt="forms"]'); await p.click('[data-cmd="ff_edit"]');
    await p.dblclick('.ff-layer .ffx[data-name="Addr.City"]'); await p.waitForSelector('#dialog[open] #ffName');
    eq(await p.inputValue('#ffName'), 'Addr.City');
    await p.selectOption('#ffSize', '14'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(250);
    let d = await PDFDocument.load(await savedOf(p));
    eq(d.getForm().getFields().map((x) => x.getName()), ['Addr.City'], 'the same name');
    eq(d.getForm().getTextField('Addr.City').getText(), 'Paris');
    ok(/ 14 Tf/.test(d.getForm().getTextField('Addr.City').acroField.getDefaultAppearance()), 'the new size');
    // renamed: the part after the last dot is its own name
    await p.dblclick('.marks .ffx-mk'); await p.waitForSelector('#dialog[open] #ffName');
    await p.fill('#ffName', 'Addr.Town'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(250);
    d = await PDFDocument.load(await savedOf(p));
    eq(d.getForm().getFields().map((x) => x.getName()), ['Addr.Town'], 'renamed in its parent');
    eq(d.getForm().getTextField('Addr.Town').getText(), 'Paris');
    eq(p.errors, []); await p.ctx.close();
  });

  const calcForm = (calc) => async (d, form) => {
    const pg = d.getPage(0), fmt = 'AFNumber_Format(2, 0, 0, 0, "", true);', ks = 'AFNumber_Keystroke(2, 0, 0, 0, "", true);';
    const mk = (n, y, extra = {}) => { const t = form.createTextField(n); t.addToPage(pg, { x: 72, y, width: 160, height: 22 }); t.acroField.dict.set(N('AA'), d.context.obj({ F: jsAct(d, fmt), K: jsAct(d, ks), ...extra })); return t; };
    mk('A', 600); mk('B', 560); const tot = mk('Total', 520, { C: jsAct(d, calc) });
    d.catalog.getOrCreateAcroForm().dict.set(N('CO'), d.context.obj([tot.ref]));
  };
  await test('forms designer: a total from the PDF shows its new value when it has the focus, and once it loses it', async () => {
    const p = await open({ width: 1000, height: 1300 });
    await fixture(p, 'focus', calcForm('AFSimple_Calculate("SUM", new Array ("A", "B"));'));
    await p.fill('.annotationLayer input[name="A"]', '1.5'); await p.keyboard.press('Tab'); await p.waitForTimeout(200);
    await p.keyboard.type('2.5'); await p.keyboard.press('Tab'); await p.waitForTimeout(300);
    eq(await p.evaluate(() => document.activeElement && document.activeElement.name), 'Total', 'focus in the total');
    eq(await p.inputValue('.annotationLayer input[name="Total"]'), '4', 'the value, as typed, while it has the focus');
    const [x, y] = await at(p, 400, 300); await p.mouse.click(x, y); await p.waitForTimeout(250);
    eq(await p.inputValue('.annotationLayer input[name="Total"]'), '4.00', 'formatted once it loses the focus');
    // and through it again with Tab: still the new value
    await p.focus('.annotationLayer input[name="B"]'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.waitForTimeout(200);
    eq(await p.inputValue('.annotationLayer input[name="Total"]'), '4.00', 'not the old look again');
    const d = await PDFDocument.load(await savedOf(p));
    eq(d.getForm().getTextField('Total').getText(), '4');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('forms designer: an average of fields listed in one string ("A, B") is worked out', async () => {
    const p = await open({ width: 1000, height: 1300 });
    await fixture(p, 'avg', calcForm('AFSimple_Calculate("AVG", "A, B");'));
    await p.fill('.annotationLayer input[name="A"]', '2'); await p.keyboard.press('Tab'); await p.waitForTimeout(200);
    await p.keyboard.type('4'); await p.keyboard.press('Tab'); await p.waitForTimeout(300);
    const [x, y] = await at(p, 400, 300); await p.mouse.click(x, y); await p.waitForTimeout(250);
    eq(await p.inputValue('.annotationLayer input[name="Total"]'), '3.00');
    const d = await PDFDocument.load(await savedOf(p));
    eq(d.getForm().getTextField('Total').getText(), '3');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('forms designer: a check box from the PDF shows its own style (cross) in Properties', async () => {
    const p = await open({ width: 1000, height: 1300 });
    await fixture(p, 'cross', async (d, form) => {
      const c = d.context, cb = form.createCheckBox('X'); cb.addToPage(d.getPage(0), { x: 72, y: 600, width: 16, height: 16 });
      const zadb = await d.embedFont(StandardFonts.ZapfDingbats), w = cb.acroField.getWidgets()[0];
      const on = c.register(c.stream('q BT /ZaDb 12 Tf 2 3 Td (8) Tj ET Q', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 16, 16], Resources: { Font: { ZaDb: zadb.ref } } }));
      const off = c.register(c.stream(' ', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 16, 16] }));
      w.dict.set(N('AP'), c.obj({ N: { Yes: on, Off: off } })); w.dict.set(N('MK'), c.obj({ CA: PDFString.of('8') }));
    });
    await p.click('[data-rt="forms"]'); await p.click('[data-cmd="ff_edit"]');
    await p.dblclick('.ff-layer .ffx[data-name="X"]'); await p.waitForSelector('#dialog[open] #ffName');
    await p.click('#dialog [data-ffd-tab="look"]');
    eq(await p.inputValue('#ffdStyle'), 'cross');
    eq(p.errors, []); await p.ctx.close();
  });
};
