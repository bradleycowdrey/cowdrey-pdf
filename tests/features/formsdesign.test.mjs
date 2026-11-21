// Form designer: fields already in the PDF edited in place, formats and calculations (and their live preview), tab
// order, layout tools, signature fields, and form data and comments as XFDF / FDF.
export default async (h) => {
  const { test, open, openPdf, eq, ok, savedOf, reopen, at, PDFDocument, require, path, root, fs } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const { PDFName, PDFDict, PDFArray, PDFRef, StandardFonts, rgb } = L;
  const N = (k) => PDFName.of(k);
  const drag = async (p, a, b) => { const [x1, y1] = await at(p, ...a), [x2, y2] = await at(p, ...b); await p.mouse.move(x1, y1); await p.mouse.down(); await p.mouse.move(x2, y2, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(150); };
  const near = (a, b, d = 1.5) => Math.abs(a - b) <= d;
  const fieldMarks = (p) => p.evaluate(() => Object.entries(window.__cowdreyPdf.doc.marks).filter(([k]) => k !== '__doc').flatMap(([, l]) => l).filter((m) => m.type === 'ff' || m.type === 'ffx'));
  const tmp = (name) => path.join(root, 'tests/fixtures/.fd-' + name + '.pdf');
  // A PDF made with pdf-lib, opened and its file removed
  async function fixture(p, name, make, pages = 1) {
    const d = await PDFDocument.create(), font = await d.embedFont(StandardFonts.Helvetica);
    for (let k = 0; k < pages; k++) { const pg = d.addPage([612, 792]); pg.drawText(`Page ${k + 1} of the form`, { x: 72, y: 740, size: 14, font }); }
    if (make) await make(d, d.getForm());
    const file = tmp(name); fs.writeFileSync(file, await d.save());
    try { await openPdf(p, file, name + '.pdf'); } finally { fs.unlinkSync(file); }
    await p.waitForTimeout(300);
  }
  const widgetOf = (d, name, k = 0) => d.getForm().getField(name).acroField.getWidgets()[k];
  const rectOf = (w) => { const r = w.getRectangle(); return [r.x, r.y, r.x + r.width, r.y + r.height]; };
  const js = (dict, key) => { const aa = dict.lookup(N('AA')); const a = aa instanceof PDFDict ? aa.lookup(N(key)) : null; return a ? a.lookup(N('JS')).decodeText() : null; };
  const streamText = (d, ref) => { const s = d.context.lookup(ref); return Buffer.from(s instanceof L.PDFRawStream ? L.decodePDFRawStream(s).decode() : s.getContents()).toString('latin1'); };
  const wname = (d, r) => { const w = d.context.lookup(r); return (w.lookup(N('T')) || w.lookup(N('Parent')).lookup(N('T'))).decodeText(); };
  const props = async (p, pt) => { const [x, y] = await at(p, ...pt); await p.mouse.dblclick(x, y); await p.waitForSelector('#dialog[open] #ffName', { timeout: 5000 }); };
  const tab = (p, id) => p.click(`#dialog [data-ffd-tab="${id}"]`);
  const save = (p) => p.click('#dialog .btn.primary').then(() => p.waitForTimeout(200));
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id).then(() => p.waitForTimeout(150));

  // The form most tests start from: a text field (Name, with a value), a drop-down and a check box
  const form1 = async (d, form) => {
    const pg = d.getPage(0);
    const t = form.createTextField('Name'); t.setText('Jane'); t.addToPage(pg, { x: 72, y: 600, width: 200, height: 22, borderColor: rgb(.5, .5, .5) });
    const dd = form.createDropdown('Colour'); dd.setOptions(['Red', 'Green', 'Blue']); dd.select('Green'); dd.addToPage(pg, { x: 72, y: 540, width: 140, height: 22 });
    const cb = form.createCheckBox('Agree'); cb.addToPage(pg, { x: 72, y: 500, width: 14, height: 14 });
  };

  await test('forms designer: a field from the PDF moves, resizes and takes new settings; saved in place with its value', async () => {
    const p = await open({ width: 1000, height: 1300 }); await fixture(p, 'existing', form1);
    await p.click('[data-rt="forms"]'); await p.click('[data-cmd="ff_edit"]');
    await p.waitForSelector('.ff-layer .ffx[data-name="Name"]', { state: 'visible' });
    // A drag on its outline moves it: it becomes a field the designer changes (a proxy), pdf.js's control is hidden
    await drag(p, [172, 611], [212, 581]);
    let m = (await fieldMarks(p)).find((x) => x.name === 'Name');
    ok(m && m.type === 'ffx', 'a proxy: ' + JSON.stringify(m));
    ok(near(m.x1, 112, 2) && near(m.y1, 570, 2), 'moved ' + JSON.stringify([m.x1, m.y1]));
    ok(await p.$eval('.annotationLayer [data-annotation-id] input[name="Name"]', (i) => !i.getClientRects().length), "pdf.js's own control hidden");
    // its bottom-right corner
    await drag(p, [312, 570], [352, 560]);
    m = (await fieldMarks(p)).find((x) => x.name === 'Name');
    ok(near(m.x2, 352, 2) && near(m.y1, 560, 2) && near(m.y2, 592, 2), 'resized ' + JSON.stringify(m));
    // Properties: font size, text colour, fill and border, 5 characters as a comb
    await props(p, [200, 576]);
    eq(await p.$$eval('#dialog [data-ffd-tab]', (b) => b.map((x) => x.textContent)), ['General', 'Appearance', 'Options', 'Actions', 'Format', 'Validate', 'Calculate']);
    eq(await p.inputValue('#ffVal'), 'Jane', 'its value');
    await p.selectOption('#ffSize', '12'); await p.fill('#ffMax', '5');
    await tab(p, 'look'); await p.fill('#ffdColor', '#2448c9'); await p.fill('#ffdBg', '#fff3bf'); await p.fill('#ffdBc', '#e03131'); await p.selectOption('#ffdQ', '1');
    await tab(p, 'options'); await p.click('#ffdComb');
    await save(p);
    m = (await fieldMarks(p)).find((x) => x.name === 'Name');
    eq([m.size, m.max, m.comb, m.color, m.bg, m.bc, m.q], [12, 5, true, '#2448C9', '#FFF3BF', '#E03131', 1]);
    // The drop-down: new options, the choice kept
    await p.dblclick('.ff-layer .ffx[data-name="Colour"]'); await p.waitForSelector('#dialog[open] #ffOpts');
    await p.fill('#ffOpts', 'Red\nGreen\nBlue\nYellow'); await save(p);
    eq(await p.evaluate(() => document.querySelectorAll('.marks .ffx-mk').length), 2, 'two proxies drawn');
    const out = await savedOf(p), d = await PDFDocument.load(out), f = d.getForm();
    eq(f.getFields().map((x) => x.getName()).sort(), ['Agree', 'Colour', 'Name'], 'the same fields, in place');
    const t = f.getTextField('Name'), w = widgetOf(d, 'Name'), r = rectOf(w);
    ok(near(r[0], 112, 2) && near(r[1], 560, 2) && near(r[2], 352, 2) && near(r[3], 592, 2), 'Rect ' + JSON.stringify(r));
    eq([t.getText(), t.getMaxLength(), t.isCombed()], ['Jane', 5, true], 'value, MaxLen and comb');
    ok(t.acroField.dict.lookup(N('Ff')).asNumber() & (1 << 24), 'the comb flag');
    const da = t.acroField.getDefaultAppearance();
    ok(/\/Helv 12 Tf/.test(da) && /0\.141 0\.282 0\.788 rg/.test(da), 'DA ' + da);
    eq(t.acroField.dict.lookup(N('Q')).asNumber(), 1, 'centred');
    const mk = w.dict.lookup(N('MK'));
    eq(mk.lookup(N('BG')).asArray().map((n) => +n.asNumber().toFixed(3)), [1, .953, .749], 'fill');
    eq(mk.lookup(N('BC')).asArray().map((n) => +n.asNumber().toFixed(3)), [.878, .192, .192], 'border');
    const ap = w.dict.lookup(N('AP')).get(N('N'));
    ok(ap instanceof PDFRef && /<4A> Tj/.test(streamText(d, ap)) && /0\.141 0\.282 0\.788 rg/.test(streamText(d, ap)), 'a new look, with the value in its boxes: ' + streamText(d, ap).replace(/\s+/g, ' ').slice(0, 300));
    const flags = w.dict.lookup(N('F')).asNumber(); eq(flags & 2, 0, 'not left hidden');
    const dd = f.getDropdown('Colour');
    eq([dd.getOptions(), dd.getSelected()], [['Red', 'Green', 'Blue', 'Yellow'], ['Green']], 'options and choice');
    eq(f.getCheckBox('Agree').isChecked(), false, 'the untouched field as it was');
    // one widget each still
    eq(d.getPage(0).node.Annots().asArray().length, 3);
    // Other apps (pdf.js here) show it at its new place
    await reopen(p, out);
    const box = await p.$eval('.annotationLayer input[name="Name"]', (i) => { const b = i.closest('section').getBoundingClientRect(); return [b.width, b.height]; });
    ok(box[0] > 200, 'wider when reopened ' + box);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('forms designer: an untouched field is left alone; its type can change (made again with its name and value); Delete removes a moved field', async () => {
    const p = await open({ width: 1000, height: 1300 }); await fixture(p, 'retype', form1);
    await p.click('[data-rt="forms"]'); await p.click('[data-cmd="ff_edit"]');
    await p.waitForSelector('.ff-layer .ffx[data-name="Name"]', { state: 'visible' });
    // Opening the properties and saving with nothing changed makes no proxy
    await p.dblclick('.ff-layer .ffx[data-name="Colour"]'); await p.waitForSelector('#dialog[open] #ffName'); await save(p);
    eq((await fieldMarks(p)).length, 0, 'no proxy');
    // Type: the text field becomes a drop-down, named and valued as before
    await p.dblclick('.ff-layer .ffx[data-name="Name"]'); await p.waitForSelector('#dialog[open] #ffdKind');
    await p.selectOption('#ffdKind', 'combo'); await save(p);
    const ms = await fieldMarks(p);
    eq(ms.map((m) => [m.type, m.kind, m.name, m.val]), [['ff', 'combo', 'Name', 'Jane']]);
    // Move the check box, then Delete: the whole field goes; undo brings it back
    await drag(p, [79, 507], [99, 487]);
    eq((await fieldMarks(p)).filter((m) => m.type === 'ffx').length, 1);
    await p.keyboard.press('Delete'); await p.waitForTimeout(300);
    eq((await fieldMarks(p)).filter((m) => m.type === 'ffx').length, 0, 'deleted');
    const d = await PDFDocument.load(await savedOf(p)), f = d.getForm();
    eq(f.getFields().map((x) => [x.getName(), x.constructor.name]).sort(), [['Colour', 'PDFDropdown'], ['Name', 'PDFDropdown']]);
    eq(f.getDropdown('Name').getSelected(), ['Jane']);
    const r = rectOf(widgetOf(d, 'Name')); ok(near(r[0], 72, 1.5) && near(r[2], 272, 1.5), 'in the same place ' + r);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('forms designer: number format and a total (sum of A and B) are saved with the standard scripts, and work as the form is filled in', async () => {
    const p = await open({ width: 1000, height: 1300 }); await fixture(p, 'calc');
    await p.click('[data-rt="forms"]');
    const add = async (a, b) => { await p.click('[data-cmd="ff_text"]'); await drag(p, a, b); };
    await add([100, 600], [220, 580]); await add([100, 560], [220, 540]); await add([100, 520], [220, 500]);
    await run(p, 'ff_edit');
    const name = async (pt, n) => { await props(p, pt); await p.fill('#ffName', n); return p; };
    await name([160, 590], 'A'); await tab(p, 'format'); await p.selectOption('#ffdFmtT', 'number'); await p.selectOption('#ffdDec', '2'); await save(p);
    await name([160, 550], 'B'); await save(p);
    await name([160, 510], 'Total');
    await tab(p, 'format'); await p.selectOption('#ffdFmtT', 'number'); await p.selectOption('#ffdDec', '2'); await p.fill('#ffdCur', '$');
    await tab(p, 'calc');
    ok(await p.isHidden('#ffdOp'), 'the sum only for a total');
    await p.selectOption('#ffdCT', 'simple'); await p.selectOption('#ffdOp', 'SUM');
    await p.check('.ffd-pick[value="A"]'); await p.check('.ffd-pick[value="B"]');
    await p.selectOption('#ffdCT', 'custom'); ok((await p.textContent('#dialog [data-ffd-panel="calc"]')).includes('Runs in apps that support form scripts'), 'says custom scripts are not run here');
    await p.selectOption('#ffdCT', 'simple');
    await save(p);
    // Fill in: typing 2 and 3 shows the total, formatted
    await p.click('[data-cmd="ffPreview"]'); await p.waitForTimeout(200);
    const ctl = (n) => `.ff-fill-layer .ff-ctl[data-field="${n}"]`;
    await p.fill(ctl('A'), '2'); await p.keyboard.press('Tab'); await p.waitForTimeout(150);
    await p.click(ctl('B')); await p.keyboard.type('3'); await p.keyboard.press('Tab'); await p.waitForTimeout(200);
    eq(await p.inputValue(ctl('Total')), '$5.00', 'the total, formatted');
    eq(await p.inputValue(ctl('A')), '2.00', 'A formatted when not being typed in');
    // A value the format does not allow is not kept
    await p.click(ctl('A')); await p.keyboard.press('Control+a'); await p.keyboard.type('abc'); await p.keyboard.press('Tab'); await p.waitForTimeout(150);
    eq((await fieldMarks(p)).find((m) => m.name === 'A').val, '2', 'kept 2');
    const out = await savedOf(p), d = await PDFDocument.load(out), f = d.getForm(), tot = f.getTextField('Total');
    ok(/^AFNumber_Format\(2, 0, 0, 0, "\$", true\);$/.test(js(tot.acroField.dict, 'F')), 'format ' + js(tot.acroField.dict, 'F'));
    ok(/^AFNumber_Keystroke\(2, 0, 0, 0, "\$", true\);$/.test(js(tot.acroField.dict, 'K')), 'keystroke ' + js(tot.acroField.dict, 'K'));
    eq(js(tot.acroField.dict, 'C'), 'AFSimple_Calculate("SUM", new Array ("A", "B"));');
    ok(/AFNumber_Format\(2,/.test(js(f.getTextField('A').acroField.dict, 'F')), 'A has its format');
    const co = d.catalog.lookup(N('AcroForm')).lookup(N('CO'));
    ok(co instanceof PDFArray && co.asArray().some((r) => r === tot.ref), 'Total in the calculation order');
    eq([f.getTextField('A').getText(), f.getTextField('B').getText(), f.getTextField('Total').getText()], ['2', '3', '5']);
    // Opened again (pdf.js's own fields): the total still updates as the form is filled in
    await reopen(p, out);
    await p.fill('.annotationLayer input[name="A"]', '10'); await p.keyboard.press('Tab'); await p.waitForTimeout(300);
    eq(await p.inputValue('.annotationLayer input[name="Total"]'), '$13.00', 'calculated in the reopened PDF');
    const d2 = await PDFDocument.load(await savedOf(p));
    eq(d2.getForm().getTextField('Total').getText(), '13');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('forms designer: formats, validation and calculation scripts are read and written the standard way', async () => {
    const p = await open(); await fixture(p, 'af');
    const r = await p.evaluate(() => {
      const H = window.__cowdreyPdf;
      return H.ffdAF();
    });
    eq(r.num, '-1.234,50 €', 'number with comma decimals');
    eq(r.paren, '($1,234.50)'); eq(r.pct, '12.5%'); eq(r.zip4, '12345-6789'); eq(r.phone, '(555) 123-4567'); eq(r.time, '2:05 pm');
    eq(r.parsed, [{ t: 'number', dec: 2, sep: 2, neg: 0, cur: '€', pre: false }, { t: 'percent', dec: 1, sep: 0 }, { t: 'special', sp: 3 }, { t: 'time', tm: 1 }, { t: 'date', df: 'dd/mm/yyyy' }]);
    eq(r.range, ['AFRange_Validate(true, 0, true, 100);', { t: 'range', min: 0, max: 100 }]);
    eq(r.sfn, ['/** BVCALC Price * Qty - Discount EVCALC **/ event.value = ((AFMakeNumber(getField("Price").value) * AFMakeNumber(getField("Qty").value)) - AFMakeNumber(getField("Discount").value));', { t: 'sfn', sfn: 'Price * Qty - Discount' }, 17]);
    eq(r.simple, { t: 'simple', op: 'AVG', fields: ['a.b', 'c'] });
    await p.ctx.close();
  });

  await test('forms designer: tab order is set in the Fields panel; the page gets /Tabs /S and its widgets in that order', async () => {
    const p = await open({ width: 1200, height: 1300 });
    await fixture(p, 'tabs', async (d, form) => { const pg = d.getPage(0); ['T1', 'T2', 'T3'].forEach((n, k) => form.createTextField(n).addToPage(pg, { x: 72, y: 600 - k * 40, width: 150, height: 20 })); });
    await p.click('[data-rt="forms"]'); await p.click('[data-cmd="ffd_panel"]'); await p.waitForSelector('#ffdPanel li[data-k]');
    eq(await p.$$eval('#ffdPanel li .ffd-nm', (l) => l.map((x) => x.firstChild.textContent)), ['T1', 'T2', 'T3']);
    await p.focus('#ffdPanel li:nth-child(3)'); await p.keyboard.press('Alt+ArrowUp'); await p.waitForTimeout(150);
    await p.keyboard.press('Alt+ArrowUp'); await p.waitForTimeout(150);
    eq(await p.$$eval('#ffdPanel li .ffd-nm', (l) => l.map((x) => x.firstChild.textContent)), ['T3', 'T1', 'T2']);
    eq(await p.$eval('#ffdPanel select[data-tabs]', (s) => s.value), 'S', 'as listed');
    // the tab numbers on the page
    await p.check('#ffdNums'); await p.waitForTimeout(150);
    eq(await p.$$eval('.page[data-n="0"] .ffd-layer .ffd-num text', (t) => t.map((x) => x.textContent)), ['1', '2', '3']);
    await p.focus('#ffdPanel li'); await p.keyboard.press('Control+z'); await p.waitForTimeout(150);
    eq(await p.$$eval('#ffdPanel li .ffd-nm', (l) => l.map((x) => x.firstChild.textContent)), ['T1', 'T3', 'T2'], 'undo, one step');
    await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(150);
    const d = await PDFDocument.load(await savedOf(p)), pg = d.getPage(0);
    eq(String(pg.node.get(N('Tabs'))), '/S');
    const names = pg.node.Annots().asArray().map((r) => wname(d, r));
    eq(names, ['T3', 'T1', 'T2'], 'widgets in tab order');
    // By rows: top to bottom
    await p.selectOption('#ffdPanel select[data-tabs]', 'R'); await p.waitForTimeout(150);
    const d2 = await PDFDocument.load(await savedOf(p)), pg2 = d2.getPage(0);
    eq([String(pg2.node.get(N('Tabs'))), pg2.node.Annots().asArray().map((r) => wname(d2, r))], ['/R', ['T1', 'T2', 'T3']]);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('forms designer: several fields selected (Shift-click, a box) align, match and duplicate; Copy to pages makes one field with a widget on each page', async () => {
    const p = await open({ width: 1000, height: 1300 }); await fixture(p, 'layout', null, 3);
    await p.click('[data-rt="forms"]');
    const add = async (a, b) => { await p.click('[data-cmd="ff_text"]'); await drag(p, a, b); };
    await add([100, 600], [200, 580]); await add([130, 560], [260, 540]); await add([90, 520], [170, 500]);
    await run(p, 'ff_edit');
    const click = async (pt, mod) => { const [x, y] = await at(p, ...pt); if (mod) await p.keyboard.down(mod); await p.mouse.click(x, y); if (mod) await p.keyboard.up(mod); await p.waitForTimeout(120); };
    await click([150, 590]); await click([190, 550], 'Shift'); await click([130, 510], 'Shift');
    eq((await p.evaluate(() => window.__cowdreyPdf.ffdSelected())).length, 3, 'three selected');
    ok(await p.isVisible('[data-cmd="ffd_align"]'), 'the Layout tools show');
    await run(p, 'ffd_left');
    let ms = await fieldMarks(p);
    eq(ms.map((m) => Math.round(m.x1)), [90, 90, 90], 'aligned left');
    await run(p, 'ffd_matchW'); // to the one picked last (Text3, 80 wide)
    ms = await fieldMarks(p); eq(ms.map((m) => Math.round(m.x2 - m.x1)), [80, 80, 80]);
    // a drag moves them together
    await drag(p, [130, 590], [150, 580]);
    ms = await fieldMarks(p); eq(ms.map((m) => Math.round(m.x1)), [110, 110, 110], 'moved together');
    // a box round two of them
    await drag(p, [60, 565], [300, 525]);
    eq((await p.evaluate(() => window.__cowdreyPdf.ffdSelected())).length, 1, 'the box selects what it touches: one field');
    await drag(p, [60, 610], [300, 530]);
    eq((await p.evaluate(() => window.__cowdreyPdf.ffdSelected())).length, 2);
    await p.keyboard.press('Control+d'); await p.waitForTimeout(150);
    ms = await fieldMarks(p); eq(ms.length, 5, 'duplicated'); ok(new Set(ms.map((m) => m.name)).size === 5, 'each with a name of its own ' + ms.map((m) => m.name));
    // Copy to pages: one field
    await click([130, 500]);
    await run(p, 'ffd_copyPages'); await p.waitForSelector('#dialog[open] #dlgInput'); await p.fill('#dlgInput', '1-3'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(200);
    const d = await PDFDocument.load(await savedOf(p)), f = d.getForm();
    const t3 = f.getTextField('Text3'), ws = t3.acroField.getWidgets();
    eq(ws.length, 3, 'three widgets'); ok(t3.acroField.dict.lookup(N('Kids')) instanceof PDFArray, 'as /Kids');
    eq(ws.map((w) => d.getPages().findIndex((pg) => pg.ref === w.P())), [0, 1, 2], 'one on each page');
    eq(f.getFields().length, 5, 'five fields');
    // typed into one, shown in all
    await run(p, 'ffPreview');
    await p.evaluate(() => window.__cowdreyPdf.run('ffPreview'));
    eq(p.errors, []); await p.ctx.close();
  });

  await test('forms designer: a signature field takes a picture as its look (not a digital signature); a signing feature can take over', async () => {
    const p = await open({ width: 1000, height: 1300 });
    await fixture(p, 'sig', async (d) => {
      const pg = d.getPage(0), c = d.context;
      const ap = c.register(c.stream('0.5 G 0.5 0.5 179 39 re S', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 180, 40] }));
      const ref = c.register(c.obj({ FT: 'Sig', T: L.PDFHexString.fromText('Approver'), Type: 'Annot', Subtype: 'Widget', Rect: [72, 300, 252, 340], F: 4, P: pg.ref, AP: { N: ap } }));
      pg.node.addAnnot(ref); d.catalog.getOrCreateAcroForm().addField(ref);
    });
    await p.click('[data-rt="forms"]'); await p.click('[data-cmd="ff_sig"]'); await drag(p, [72, 450], [252, 410]);
    await p.click('[data-cmd="ffPreview"]'); await p.waitForTimeout(200);
    const drawSig = async () => {
      // with certificate signing in the app, it first asks which kind: the picture alone here
      await p.waitForSelector('#dialog[open]');
      const pick = p.locator('#dialog[open] button', { hasText: 'Place signature picture only' });
      if (await pick.count()) await pick.click();
      await p.waitForSelector('#dialog[open] #sigPad');
      ok((await p.textContent('#dialog .ffd-signote')).includes('It is not a digital signature'), 'says what it is');
      const b = await p.$eval('#sigPad', (c) => { const r = c.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
      await p.mouse.move(b[0] + 40, b[1] + b[3] / 2); await p.mouse.down(); await p.mouse.move(b[0] + b[2] / 2, b[1] + 20, { steps: 5 }); await p.mouse.move(b[0] + b[2] - 40, b[1] + b[3] - 20, { steps: 5 }); await p.mouse.up();
      await p.click('#dialog .btn.primary'); await p.waitForTimeout(250);
    };
    // the new field
    await p.click('.ff-fill-layer .ff-ctl-sig'); await drawSig();
    ok(await p.$('.ff-fill-layer .ff-ctl-sig img'), 'the picture shows');
    eq(await p.evaluate(() => document.querySelector('#app').dataset.tool), 'select', 'not placed by hand');
    // the PDF's own (unsigned) signature field
    await p.click('.ffd-layer .ffd-sighit'); await drawSig();
    const ms = await fieldMarks(p);
    eq(ms.map((m) => [m.type, m.kind, !!m.pic]), [['ff', 'sig', true], ['ffx', 'sig', true]]);
    const d = await PDFDocument.load(await savedOf(p)), f = d.getForm();
    for (const n of ['Signature1', 'Approver']) {
      const w = widgetOf(d, n), ap = w.dict.lookup(N('AP')).get(N('N')), s = streamText(d, ap);
      ok(/\/Im0 Do/.test(s), `${n}: the picture is its look: ${s}`);
      ok(d.context.lookup(ap).dict.lookup(N('Resources')).lookup(N('XObject')).lookup(N('Im0')), 'with the picture in it');
      eq(String(f.getField(n).acroField.dict.get(N('FT'))), '/Sig'); ok(!f.getField(n).acroField.dict.get(N('V')), 'unsigned');
    }
    eq(d.getPage(0).node.Annots().asArray().length, 2);
    eq(widgetOf(d, 'Approver').dict.lookup(N('F')).asNumber(), 4, 'its flags as they were');
    // A signing feature: called with the field, for the PDF's field and new ones alike
    await p.evaluate(() => window.__cowdreyPdf.ffdOnSig((a) => { window.__signed = [a.field.name, a.field.page, a.field.rect.map(Math.round)]; return null; }));
    await p.click('.ff-fill-layer .ff-ctl-sig'); await p.waitForTimeout(200);
    eq(await p.evaluate(() => window.__signed), ['Signature1', 0, [72, 410, 252, 450]]);
    ok(!(await p.$('#dialog[open]')), 'no picture dialog');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('forms designer: Prepare for signing adds signature, initials and date fields for each person', async () => {
    const p = await open({ width: 1000, height: 1300 }); await fixture(p, 'prep');
    await p.click('[data-rt="forms"]'); await run(p, 'ffd_prepSign'); await p.waitForSelector('#dialog[open] #ffdSigners');
    await p.selectOption('#ffdSigners', '2'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(200);
    const ms = await fieldMarks(p);
    eq(ms.map((m) => [m.kind, m.name, m.tip]).sort(), [['date', 'Signer1_Date', 'Signer 1: date signed'], ['date', 'Signer2_Date', 'Signer 2: date signed'], ['sig', 'Signer1_Initials', 'Signer 1: initials'], ['sig', 'Signer1_Signature', 'Signer 1: signature'], ['sig', 'Signer2_Initials', 'Signer 2: initials'], ['sig', 'Signer2_Signature', 'Signer 2: signature']]);
    const f = (await PDFDocument.load(await savedOf(p))).getForm();
    eq(f.getField('Signer2_Signature').acroField.dict.lookup(N('TU')).decodeText(), 'Signer 2: signature');
    eq(String(f.getField('Signer1_Initials').acroField.dict.get(N('FT'))), '/Sig');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('forms designer: appearance, styles and actions are saved: check box style, dashed border, Times, Go to page, Show/hide, mail submit', async () => {
    const p = await open({ width: 1000, height: 1300 }); await fixture(p, 'look', null, 2);
    await p.click('[data-rt="forms"]');
    await p.click('[data-cmd="ff_check"]'); await drag(p, [100, 600], [116, 584]);
    await p.click('[data-cmd="ff_text"]'); await drag(p, [140, 600], [300, 580]);
    await p.click('[data-cmd="ff_button"]'); await drag(p, [100, 540], [200, 516]);
    await p.click('[data-cmd="ff_button"]'); await drag(p, [220, 540], [320, 516]);
    await run(p, 'ff_edit');
    await props(p, [108, 592]); await p.click('#ffOn'); await tab(p, 'look'); await p.selectOption('#ffdStyle', 'star'); await p.fill('#ffdColor', '#e03131'); await save(p);
    await props(p, [220, 590]); await tab(p, 'look'); await p.selectOption('#ffdFont', 'TiRo'); await p.selectOption('#ffdBs', 'D'); await p.selectOption('#ffdBw', '2');
    await tab(p, 'actions'); await p.selectOption('#ffAct', 'show'); await p.selectOption('#ffdField', 'Button1'); await p.selectOption('#ffdHide', '1'); await save(p);
    await props(p, [150, 528]); await p.selectOption('#ffAct', 'page'); await p.fill('#ffdPage', '2'); await save(p);
    await props(p, [270, 528]); await p.selectOption('#ffAct', 'submit'); await p.fill('#ffdTo', 'forms@example.com'); await p.selectOption('#ffdAs', 'PDF');
    ok((await p.textContent('#dialog')).includes('opens the mail app'), 'says it opens the mail app'); await save(p);
    const d = await PDFDocument.load(await savedOf(p)), f = d.getForm();
    const cw = widgetOf(d, 'CheckBox1'), ap = cw.dict.lookup(N('AP')).lookup(N('N'));
    eq(cw.dict.lookup(N('MK')).lookup(N('CA')).decodeText(), 'H', 'star');
    ok(/\/ZaDb [\d.]+ Tf 0\.878 0\.192 0\.192 rg .*\(H\) Tj/.test(streamText(d, ap.get(N('Yes')))), 'drawn with ZapfDingbats: ' + streamText(d, ap.get(N('Yes'))));
    ok(f.getCheckBox('CheckBox1').isChecked(), 'ticked');
    const tw = widgetOf(d, 'Text1'), bs = tw.dict.lookup(N('BS'));
    eq([String(bs.get(N('S'))), bs.lookup(N('W')).asNumber()], ['/D', 2], 'dashed, 2 pt');
    ok(/^\/TiRo 0 Tf/.test(f.getTextField('Text1').acroField.getDefaultAppearance()), 'Times: ' + f.getTextField('Text1').acroField.getDefaultAppearance());
    ok(d.catalog.lookup(N('AcroForm')).lookup(N('DR')).lookup(N('Font')).lookup(N('TiRo')), 'the font in the form resources');
    const a = tw.dict.lookup(N('A')); eq([String(a.get(N('S'))), a.lookup(N('T')).decodeText(), String(a.get(N('H')))], ['/Hide', 'Button1', 'true']);
    const go = widgetOf(d, 'Button1').dict.lookup(N('A')); eq(String(go.get(N('S'))), '/GoTo'); ok(go.lookup(N('D')).get(0) === d.getPage(1).ref, 'to page 2');
    const sub = widgetOf(d, 'Button2').dict.lookup(N('A'));
    eq([String(sub.get(N('S'))), sub.lookup(N('F')).lookup(N('F')).decodeText(), sub.lookup(N('Flags')).asNumber()], ['/SubmitForm', 'mailto:forms@example.com', 256]);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('forms designer: form data and comments go to XFDF and come back into a fresh copy of the PDF; FDF imports too', async () => {
    const make = async (d, form) => { await form1(d, form); form.createTextField('Address.City').addToPage(d.getPage(0), { x: 300, y: 600, width: 150, height: 22 }); };
    const p = await open({ width: 1000, height: 1300 }); await fixture(p, 'xfdf', make, 2);
    await p.fill('.annotationLayer input[name="Name"]', 'Bradley & Co'); await p.click('.annotationLayer input[name="Agree"]');
    await p.selectOption('.annotationLayer select[name="Colour"]', 'Blue'); await p.fill('.annotationLayer input[name="Address.City"]', 'Wellington');
    await p.keyboard.press('Tab'); await p.waitForTimeout(150);
    // comments: a box and a note on page 2, an oval on page 1
    await p.evaluate(() => { const H = window.__cowdreyPdf, m = H.doc.marks, k = Object.keys(m).filter((x) => x !== '__doc'); const e0 = H.doc.pages[0], e1 = H.doc.pages[1], key = (e) => `${e.src}:${e.i}`;
      (m[key(e0)] ||= []).push({ id: 'oval1', type: 'cmShape', kind: 'oval', x1: 100, y1: 300, x2: 200, y2: 360, color: '#E03131', w: 2 });
      (m[key(e1)] ||= []).push({ id: 'box1', type: 'rect', x1: 72, y1: 500, x2: 272, y2: 600, color: '#2448C9', w: 1 }, { id: 'note1', type: 'note', x: 300, y: 700, text: 'Check this figure' }); void k; });
    const xmlF = await p.evaluate(() => window.__cowdreyPdf.ffdExportFields());
    ok(/<field name="Address"><field name="City">|<field name="Address">\s*<field name="City"><value>Wellington<\/value><\/field>/.test(xmlF), 'nested names: ' + xmlF);
    ok(xmlF.includes('<field name="Agree"><value>Yes</value></field>') && xmlF.includes('<value>Bradley &amp; Co</value>'), xmlF);
    const xmlC = await p.evaluate(() => window.__cowdreyPdf.cmExportXfdf());
    ok(/<square[^>]+page="1"/.test(xmlC) && /<circle[^>]+page="0"/.test(xmlC), 'comments with their pages: ' + xmlC.slice(0, 300));
    const marksOf = (q) => q.evaluate(() => Object.entries(window.__cowdreyPdf.doc.marks).filter(([k]) => k !== '__doc').flatMap(([k, l]) => l.map((x) => [k.split(':')[1], x.type, x.kind || '', Math.round(x.x1 ?? x.x), Math.round(x.y1 != null ? Math.min(x.y1, x.y2) : x.y), x.text || ''])).sort());
    const want = await marksOf(p);
    // a fresh copy of the same PDF
    const q = await open({ width: 1000, height: 1300 }); await fixture(q, 'xfdf', make, 2);
    await q.setInputFiles('#ffdDataFile', { name: 'data.xfdf', mimeType: 'application/vnd.adobe.xfdf', buffer: Buffer.from(xmlF) }); await q.waitForTimeout(500);
    await q.setInputFiles('#ffdCommentsFile', { name: 'comments.xfdf', mimeType: 'application/vnd.adobe.xfdf', buffer: Buffer.from(xmlC) }); await q.waitForTimeout(500);
    eq(await q.inputValue('.annotationLayer input[name="Name"]'), 'Bradley & Co', 'shown at once');
    eq(await marksOf(q), want, 'the same comments, on the same pages');
    const d = await PDFDocument.load(await savedOf(q)), f = d.getForm();
    eq([f.getTextField('Name').getText(), f.getCheckBox('Agree').isChecked(), f.getDropdown('Colour').getSelected(), f.getTextField('Address.City').getText()], ['Bradley & Co', true, ['Blue'], 'Wellington']);
    const subs = (n) => (d.getPage(n).node.Annots() ? d.getPage(n).node.Annots().asArray() : []).map((r) => String(d.context.lookup(r).get(N('Subtype'))));
    ok(subs(0).includes('/Circle') && subs(1).includes('/Square') && subs(1).includes('/Text'), 'saved as comments: ' + subs(0) + ' / ' + subs(1));
    // FDF (from other apps)
    const fdf = '%FDF-1.2\n1 0 obj\n<< /FDF << /Fields [ << /T (Name) /V (Pelican \\(Ltd\\)) >> << /T (Agree) /V /Off >> << /T (Address) /Kids [ << /T (City) /V <FEFF00C5006C0061006E0064> >> ] >> ] >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n';
    eq(await q.evaluate((s) => window.__cowdreyPdf.ffdImportFields(s), fdf), 3);
    const v = await q.evaluate(() => window.__cowdreyPdf.ffdValues());
    eq([v.Name, v.Agree, v['Address.City']], ['Pelican (Ltd)', 'Off', 'Åland']);
    // a comments file for a PDF with more pages asks first
    const more = xmlC.replace(/page="1"/g, 'page="5"');
    const asking = q.evaluate((s) => window.__cowdreyPdf.ffdImportComments(s), more);
    await q.waitForSelector('#dialog[open]'); ok((await q.textContent('#dialog')).includes('6 pages'), 'names the page count'); await q.click('#dialog .dlg-foot .btn:not(.primary)');
    eq(await asking, 0);
    eq(p.errors, []); eq(q.errors, []); await p.ctx.close(); await q.ctx.close();
  });
};
