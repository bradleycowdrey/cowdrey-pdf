// Forms tab: new fields of every kind, their properties, fields already in the PDF, Recognize form, Clear and Flatten.
export default async (h) => {
  const { test, open, openPdf, eq, ok, savedOf, reopen, at, pageText, marks, PDFDocument, require, path, root } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const { PDFName } = L;
  const drag = async (p, a, b) => { const [x1, y1] = await at(p, ...a), [x2, y2] = await at(p, ...b); await p.mouse.move(x1, y1); await p.mouse.down(); await p.mouse.move(x2, y2, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(120); };
  const ffMarks = (p) => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().filter((m) => m.type === 'ff'));
  // Double-click a new field (by its middle, in PDF coordinates) and fill in its properties.
  const props = async (p, pt, fill) => {
    const [x, y] = await at(p, ...pt); await p.mouse.dblclick(x, y); await p.waitForSelector('#dialog[open] #ffName', { timeout: 5000 }).catch(() => { throw new Error('no properties at ' + pt); });
    for (const [sel, v] of Object.entries(fill)) {
      if (typeof v === 'boolean') { if (await p.isChecked(sel) !== v) await p.click(sel); }
      else if (await p.$eval(sel, (e) => e.tagName) === 'SELECT') await p.selectOption(sel, String(v));
      else await p.fill(sel, String(v));
    }
    await p.click('#dialog .btn.primary'); await p.waitForTimeout(150);
  };
  const widgetsOf = (d, f) => f.acroField.getWidgets();

  await test('forms: every kind of field drawn, its properties set, saved as real fields, and fillable when reopened', async () => {
    const p = await open({ width: 1000, height: 1300 }); await openPdf(p);
    await p.click('[data-rt="forms"]');
    const add = async (kind, a, b) => { await p.click(`[data-cmd="ff_${kind}"]`); await drag(p, a, b); };
    await add('text', [100, 420], [300, 400]);
    await add('check', [100, 380], [114, 366]);
    await add('radio', [100, 350], [114, 336]);
    await add('radio', [140, 350], [154, 336]);
    await add('combo', [100, 320], [250, 300]);
    await add('list', [100, 290], [250, 240]);
    await add('button', [100, 220], [200, 198]);
    await add('date', [100, 180], [220, 160]);
    await add('sig', [100, 140], [300, 100]);
    eq((await ffMarks(p)).map((m) => [m.kind, m.name]), [['text', 'Text1'], ['check', 'CheckBox1'], ['radio', 'Group1'], ['radio', 'Group1'], ['combo', 'Dropdown1'], ['list', 'ListBox1'], ['button', 'Button1'], ['date', 'Date1'], ['sig', 'Signature1']]);
    // Properties, with the form tool and with Select
    await props(p, [200, 410], { '#ffName': 'fullName', '#ffTip': 'Your full name', '#ffVal': 'Jane', '#ffMax': 20, '#ffReq': true, '#ffSize': 12 });
    await p.evaluate(() => window.__cowdreyPdf.run('tool_select'));
    await props(p, [107, 373], { '#ffExp': 'Agreed', '#ffOn': true });
    await props(p, [147, 343], { '#ffExp': 'Pears', '#ffOn': true });
    await props(p, [175, 310], { '#ffOpts': 'Red\nGreen\nBlue', '#ffVal': 'Green', '#ffRo': true });
    await props(p, [175, 265], { '#ffOpts': 'Small\nLarge', '#ffVal': 'Large' });
    await props(p, [150, 209], { '#ffLabel': 'Start again', '#ffAct': 'reset' });
    await props(p, [160, 170], { '#ffFmt': 'dd/mm/yyyy' });
    await props(p, [200, 120], { '#ffName': 'Sign', '#ffTip': 'Sign here' });
    ok(await p.$('.marks .ff-mk text'), 'drawn on the page');
    const out = await savedOf(p), d = await PDFDocument.load(out), form = d.getForm();
    eq(form.getFields().map((f) => [f.getName(), f.constructor.name]), [['name', 'PDFTextField'], ['agree', 'PDFCheckBox'], ['fullName', 'PDFTextField'], ['CheckBox1', 'PDFCheckBox'], ['Dropdown1', 'PDFDropdown'], ['ListBox1', 'PDFOptionList'], ['Button1', 'PDFButton'], ['Date1', 'PDFTextField'], ['Sign', 'PDFSignature'], ['Group1', 'PDFRadioGroup']]);
    const t = form.getTextField('fullName');
    eq([t.getText(), t.getMaxLength(), t.isRequired(), t.acroField.dict.lookup(PDFName.of('TU')).decodeText()], ['Jane', 20, true, 'Your full name']);
    ok(/12 Tf/.test(t.acroField.getDefaultAppearance()), 'font size ' + t.acroField.getDefaultAppearance());
    const r = widgetsOf(d, t)[0].getRectangle();
    ok(Math.abs(r.x - 100) < 1.5 && Math.abs(r.y - 400) < 1.5 && Math.abs(r.width - 200) < 1.5 && Math.abs(r.height - 20) < 1.5, 'placed where drawn ' + JSON.stringify(r));
    ok(widgetsOf(d, t)[0].P() === d.getPage(0).ref, 'on page 1');
    const cb = form.getCheckBox('CheckBox1'); ok(cb.isChecked(), 'ticked'); eq(String(cb.acroField.getOnValue()), '/Agreed');
    const rg = form.getRadioGroup('Group1'); eq(rg.getOptions(), ['Choice1', 'Pears']); eq(rg.getSelected(), 'Pears');
    const dd = form.getDropdown('Dropdown1'); eq([dd.getOptions(), dd.getSelected(), dd.isReadOnly()], [['Red', 'Green', 'Blue'], ['Green'], true]);
    eq(form.getOptionList('ListBox1').getSelected(), ['Large']);
    eq(String(widgetsOf(d, form.getButton('Button1'))[0].dict.lookup(PDFName.of('A')).get(PDFName.of('S'))), '/ResetForm');
    ok(/AFDate_FormatEx\("dd\/mm\/yyyy"\)/.test(form.getTextField('Date1').acroField.dict.lookup(PDFName.of('AA')).lookup(PDFName.of('F')).lookup(PDFName.of('JS')).decodeText()), 'date format');
    eq(String(form.getSignature('Sign').acroField.dict.get(PDFName.of('FT'))), '/Sig');
    // Fill it in after opening the saved PDF
    await reopen(p, out);
    eq(await p.inputValue('.annotationLayer input[name="fullName"]'), 'Jane');
    ok(await p.$('.annotationLayer select[name="Dropdown1"]'), 'drop-down shown');
    await p.fill('.annotationLayer input[name="fullName"]', 'Bradley Cowdrey');
    await p.click('.annotationLayer input[name="CheckBox1"]');
    const d2 = await PDFDocument.load(await savedOf(p));
    eq(d2.getForm().getTextField('fullName').getText(), 'Bradley Cowdrey');
    eq(d2.getForm().getCheckBox('CheckBox1').isChecked(), false);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('forms: a new field moves, resizes, is deleted with the Delete key, and comes back with undo', async () => {
    const p = await open({ width: 1000, height: 1300 }); await openPdf(p);
    await p.click('[data-rt="forms"]'); await p.click('[data-cmd="ff_text"]');
    await drag(p, [100, 420], [250, 400]);
    await p.evaluate(() => window.__cowdreyPdf.run('tool_select'));
    const [cx, cy] = await at(p, 175, 410); await p.mouse.click(cx, cy);
    await drag(p, [175, 410], [215, 380]);
    let m = (await ffMarks(p))[0];
    ok(Math.abs(m.x1 - 140) < 2 && Math.abs(m.y1 - 370) < 2, 'moved ' + JSON.stringify([m.x1, m.y1]));
    await drag(p, [290, 370], [340, 360]); // the bottom-right corner
    m = (await ffMarks(p))[0];
    ok(Math.abs(m.x2 - 340) < 2 && Math.abs(m.y1 - 360) < 2 && Math.abs(m.y2 - 390) < 2, 'resized ' + JSON.stringify(m));
    await p.keyboard.press('Delete'); eq(await marks(p), []);
    await p.keyboard.press('Control+z'); eq(await marks(p), ['ff']);
    const r = (await PDFDocument.load(await savedOf(p))).getForm().getTextField('Text1').acroField.getWidgets()[0].getRectangle();
    ok(Math.abs(r.x - 140) < 2 && Math.abs(r.width - 200) < 2 && Math.abs(r.height - 30) < 2, JSON.stringify(r));
    eq(p.errors, []); await p.ctx.close();
  });

  await test('forms: fields already in the PDF are renamed and deleted; a deleted one leaves the page and the saved form', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="forms"]'); await p.click('[data-cmd="ff_edit"]');
    await p.waitForSelector('.ff-layer .ffx[data-name="agree"]', { state: 'visible' });
    await p.click('.ff-layer .ffx[data-name="agree"]'); await p.keyboard.press('Delete');
    await p.waitForFunction(() => !document.querySelector('.page[data-n="0"] .annotationLayer .checkBox'));
    await p.keyboard.press('Control+z');
    await p.waitForSelector('.page[data-n="0"] .annotationLayer .checkBox');
    await p.keyboard.press('Control+Shift+z');
    await p.waitForFunction(() => !document.querySelector('.page[data-n="0"] .annotationLayer .checkBox'));
    await p.dblclick('.ff-layer .ffx[data-name="name"]'); await p.waitForSelector('#dialog[open] #ffName');
    await p.fill('#ffName', 'fullName'); await p.fill('#ffTip', 'Your name'); await p.click('#ffReq'); await p.click('#dialog .btn.primary');
    await p.waitForTimeout(200);
    ok((await p.textContent('.page[data-n="0"] .ff-layer')).includes('fullName'), 'new name shown');
    const out = await savedOf(p), d = await PDFDocument.load(out), form = d.getForm();
    eq(form.getFields().map((f) => f.getName()), ['fullName']);
    const f = form.getTextField('fullName'); eq([f.isRequired(), f.acroField.dict.lookup(PDFName.of('TU')).decodeText()], [true, 'Your name']);
    eq(d.getPage(0).node.Annots().asArray().length, 1, 'the check box widget is gone');
    await reopen(p, out);
    ok(!(await p.$('.annotationLayer .checkBox')), 'no check box when reopened');
    await p.fill('.annotationLayer input[name="fullName"]', 'Pelican');
    eq((await PDFDocument.load(await savedOf(p))).getForm().getTextField('fullName').getText(), 'Pelican');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('forms: Recognize form proposes fields on blank lines and empty boxes; one click, or Add all, adds them', async () => {
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(L.StandardFonts.Helvetica), pg = pdf.addPage([612, 792]);
    pg.drawText('Name: ____________________', { x: 72, y: 700, size: 12, font });
    pg.drawText('Date', { x: 72, y: 652, size: 12, font }); pg.drawLine({ start: { x: 110, y: 650 }, end: { x: 300, y: 650 }, thickness: .8 });
    pg.drawRectangle({ x: 72, y: 600, width: 12, height: 12, borderWidth: 1, borderColor: L.rgb(0, 0, 0) }); pg.drawText('Yes, send me news', { x: 92, y: 602, size: 12, font });
    pg.drawRectangle({ x: 72, y: 520, width: 220, height: 24, borderWidth: 1, borderColor: L.rgb(0, 0, 0) });
    pg.drawRectangle({ x: 72, y: 460, width: 220, height: 24, borderWidth: 1, borderColor: L.rgb(0, 0, 0) }); pg.drawText('Total: 42', { x: 80, y: 468, size: 12, font }); // filled in: no field
    const file = path.join(root, 'tests/fixtures/.forms-blank.pdf');
    require('node:fs').writeFileSync(file, await pdf.save());
    const p = await open({ width: 1000, height: 1300 }); await openPdf(p, file, 'Blank form.pdf'); require('node:fs').unlinkSync(file);
    await p.click('[data-rt="forms"]'); await p.click('[data-cmd="ffRecognize"]');
    await p.waitForSelector('#ffBar');
    const found = (await p.evaluate(() => window.__cowdreyPdf.ffProposals())).sort((a, b) => b.y1 - a.y1);
    eq(found.map((f) => f.kind), ['text', 'text', 'check', 'text'], JSON.stringify(found));
    ok(found[0].x1 > 100 && found[0].x1 < 125 && found[0].y1 > 695 && found[0].y1 < 702, 'after "Name:" ' + JSON.stringify(found[0]));
    ok(Math.abs(found[1].x1 - 110) < 2 && Math.abs(found[1].x2 - 300) < 2 && found[1].y1 >= 650, 'on the line ' + JSON.stringify(found[1]));
    ok(Math.abs(found[2].x1 - 73) < 2 && Math.abs(found[2].x2 - 83) < 2, 'in the box ' + JSON.stringify(found[2]));
    // One by clicking it, the rest with Add all
    const [x, y] = await at(p, 200, 532); await p.mouse.click(x, y); await p.waitForTimeout(150);
    eq((await ffMarks(p)).map((m) => m.kind), ['text']);
    await p.click('#ffBar [data-ff="all"]'); await p.waitForTimeout(150);
    ok(!(await p.$('#ffBar')), 'bar gone');
    eq((await ffMarks(p)).map((m) => m.kind).sort(), ['check', 'text', 'text', 'text']);
    await p.keyboard.press('Control+z'); eq((await ffMarks(p)).length, 1, 'Add all is one undo step');
    await p.keyboard.press('Control+Shift+z');
    const d = await PDFDocument.load(await savedOf(p));
    eq(d.getForm().getFields().map((f) => f.constructor.name).sort(), ['PDFCheckBox', 'PDFTextField', 'PDFTextField', 'PDFTextField']);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('forms: Clear form empties every field; Flatten form makes what is filled in part of the page', async () => {
    const p = await open(); await openPdf(p);
    await p.fill('.annotationLayer input[name="name"]', 'Bradley Cowdrey'); await p.click('.annotationLayer .checkBox input');
    await p.click('[data-rt="forms"]'); await p.click('[data-cmd="ffClear"]'); await p.click('#dialog .btn.primary');
    await p.waitForTimeout(600);
    eq(await p.inputValue('.annotationLayer input[name="name"]'), '');
    let f = (await PDFDocument.load(await savedOf(p))).getForm();
    eq([f.getTextField('name').getText() || '', f.getCheckBox('agree').isChecked()], ['', false]);
    await p.fill('.annotationLayer input[name="name"]', 'Pelican Jones');
    await p.click('[data-cmd="ffFlatten"]'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(200);
    eq(await p.getAttribute('[data-cmd="ffFlatten"]', 'aria-pressed'), 'true');
    const out = await savedOf(p), d = await PDFDocument.load(out);
    eq(d.getForm().getFields().length, 0); ok(!d.getPage(0).node.Annots() || !d.getPage(0).node.Annots().size(), 'no widgets left');
    await reopen(p, out);
    ok((await pageText(p)).includes('Pelican Jones'), 'the typed name is part of the page: ' + await pageText(p));
    ok(!(await p.$('.annotationLayer input')), 'nothing to fill in');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('forms: a new field can be filled in as soon as you leave form design (another tab, Select, Esc or Fill in); a form tool or Edit fields designs it again', async () => {
    const p = await open({ width: 1000, height: 1300 }); await openPdf(p);
    await p.click('[data-rt="forms"]');
    await p.click('[data-cmd="ff_text"]'); await drag(p, [100, 420], [300, 400]);
    await p.click('[data-cmd="ff_check"]'); await drag(p, [100, 380], [114, 366]);
    await p.click('[data-cmd="ff_radio"]'); await drag(p, [100, 350], [114, 336]);
    await p.click('[data-cmd="ff_radio"]'); await drag(p, [140, 350], [154, 336]);
    await p.click('[data-cmd="ff_combo"]'); await drag(p, [100, 320], [250, 300]);
    ok(!(await p.$('.ff-fill-layer .ff-ctl')), 'no fill-in controls while designing');
    // Another tab: fill them in, without saving and opening again
    await p.click('[data-rt="home"]'); await p.waitForTimeout(200);
    eq(await p.$$eval('.ff-fill-layer .ff-ctl', (c) => c.map((x) => x.className.replace('ff-ctl ff-ctl-', ''))), ['text', 'check', 'radio', 'radio', 'combo']);
    await p.click('.ff-fill-layer .ff-ctl-text'); await p.keyboard.type('Jane Q'); await p.keyboard.press('Tab');
    await p.click('.ff-fill-layer .ff-ctl-check'); await p.click('.ff-fill-layer .ff-ctl-radio >> nth=1');
    await p.selectOption('.ff-fill-layer .ff-ctl-combo', 'Option 2');
    eq((await ffMarks(p)).map((m) => m.val), ['Jane Q', true, false, true, 'Option 2']);
    eq(await p.inputValue('.ff-fill-layer .ff-ctl-text'), 'Jane Q', 'the typed text stays shown');
    await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr2/fix-pages/forms-fill-dark.png' });
    // Undo takes back the last change; redo puts it back
    await p.click('#viewer', { position: { x: 5, y: 5 } }); await p.keyboard.press('Control+z'); await p.waitForTimeout(150);
    eq((await ffMarks(p)).map((m) => m.val)[4], '', 'undo'); await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(150);
    const f = (await PDFDocument.load(await savedOf(p))).getForm();
    eq([f.getTextField('Text1').getText(), f.getCheckBox('CheckBox1').isChecked(), f.getRadioGroup('Group1').getSelected(), f.getDropdown('Dropdown1').getSelected()], ['Jane Q', true, 'Choice2', ['Option 2']]);
    // Back on Forms with Select: still filled in. Edit fields designs them (selectable, properties on double-click),
    // showing what was filled in
    await p.click('[data-rt="forms"]'); await p.waitForTimeout(200);
    eq(await p.$$eval('.ff-fill-layer .ff-ctl', (c) => c.length), 5, 'Select on the Forms tab fills in');
    eq(await p.getAttribute('[data-cmd="ffPreview"]', 'aria-pressed'), 'true');
    await p.click('[data-cmd="ff_edit"]'); await p.waitForTimeout(200);
    ok(!(await p.$('.ff-fill-layer .ff-ctl')), 'designing again');
    eq(await p.$$eval('.marks .ff-mk.mk', (m) => m.length), 5);
    ok(/Jane Q/.test(await p.$eval('.marks .ff-mk', (g) => g.textContent)), 'shows the value');
    const [x, y] = await at(p, 200, 410); await p.mouse.dblclick(x, y); await p.waitForSelector('#dialog[open] #ffName'); await p.click('#dialog [data-x]');
    // Fill in on the Forms tab
    eq(await p.textContent('[data-cmd="ffPreview"]'), 'Fill in');
    await p.click('[data-cmd="ffPreview"]'); await p.waitForTimeout(150);
    eq(await p.getAttribute('[data-cmd="ffPreview"]', 'aria-pressed'), 'true');
    eq(await p.$$eval('.ff-fill-layer .ff-ctl', (c) => c.length), 5);
    await p.fill('.ff-fill-layer .ff-ctl-text', 'Pelican'); await p.keyboard.press('Tab');
    eq((await ffMarks(p))[0].val, 'Pelican');
    await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr2/fix-pages/forms-preview-dark.png' });
    // pressed again: back to Edit fields
    await p.click('[data-cmd="ffPreview"]'); await p.waitForTimeout(150);
    eq(await p.getAttribute('[data-cmd="ffPreview"]', 'aria-pressed'), 'false');
    eq(await p.evaluate(() => document.querySelector('#app').dataset.tool), 'ff_edit');
    ok(!(await p.$('.ff-fill-layer .ff-ctl')), 'designing after Fill in is turned off');
    // Esc leaves design: the fields can be filled in
    await p.click('#viewer', { position: { x: 5, y: 5 } }); await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    eq(await p.$$eval('.ff-fill-layer .ff-ctl', (c) => c.length), 5, 'Esc fills in');
    await p.click('[data-cmd="ff_check"]'); await p.waitForTimeout(150); // a form tool designs again
    eq(await p.getAttribute('[data-cmd="ffPreview"]', 'aria-pressed'), 'false');
    ok(!(await p.$('.ff-fill-layer .ff-ctl')), 'designing with a form tool');
    eq(p.errors, []); await p.ctx.close();
  });
};
