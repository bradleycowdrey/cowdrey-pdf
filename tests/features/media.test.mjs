// Files on a page (Attach file), the Attachments panel (rename, describe, remove, AFRelationship, kept on merge),
// portfolios, video and sound (insert, save, play), picture and dynamic stamps and Your stamps.
import crypto from 'node:crypto';
export default async (h) => {
  const { test, eq, ok, open, openPdf, savedOf, reopen, at, require, path, root, PDFDocument } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const { PDFName, PDFDict, PDFArray, PDFRef, PDFHexString, PDFString } = L, N = (s) => PDFName.of(s);
  const sha = (b) => crypto.createHash('sha256').update(Buffer.from(b)).digest('hex');
  const errs = (p) => p.errors.filter((e) => !/annotation-comment|Failed to load resource|MEDIA_ERR|no supported source|NotSupportedError/i.test(e));
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
  const all = (p) => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().filter((m) => m && m.type));
  const look = (d, o) => (o instanceof PDFRef ? d.context.lookup(o) : o);
  const annotsOf = (d, n) => { const a = d.getPage(n).node.Annots(); return a ? a.asArray().map((r) => d.context.lookup(r)) : []; };
  const textOf = (o) => (o && o.decodeText ? o.decodeText() : String(o));
  // The attached files a PDF lists (its EmbeddedFiles name tree): [[key, name, desc, rel, bytes]]
  const treeOf = (d) => {
    const names = look(d, d.catalog.get(N('Names'))), tree = names instanceof PDFDict ? look(d, names.get(N('EmbeddedFiles'))) : null, out = [];
    const arr = tree && look(d, tree.get(N('Names')));
    if (arr instanceof PDFArray) for (let k = 0; k + 1 < arr.size(); k += 2) {
      const spec = look(d, arr.get(k + 1)), st = look(d, look(d, spec.get(N('EF'))).get(N('F')));
      const rel = spec.get(N('AFRelationship'));
      out.push([textOf(look(d, arr.get(k))), textOf(spec.get(N('UF')) || spec.get(N('F'))), spec.get(N('Desc')) ? textOf(spec.get(N('Desc'))) : '', rel ? String(rel).slice(1) : '', Buffer.from(L.decodePDFRawStream(st).decode()).toString()]);
    }
    return out;
  };
  const pdfWith = async (files, text = 'A page') => {
    const d = await PDFDocument.create(), font = await d.embedFont('Helvetica');
    d.addPage([612, 792]).drawText(text, { x: 72, y: 720, size: 14, font });
    for (const [name, body, desc] of files) await d.attach(Buffer.from(body), name, { mimeType: 'text/plain', description: desc });
    return Buffer.from(await d.save());
  };
  const b64 = (b) => Buffer.from(b).toString('base64');

  await test('media: Attach file puts a file on a page as a file attachment comment; pdf.js reads its bytes back', async () => {
    const p = await open(); await openPdf(p);
    // with the tool: click the page, pick the file
    await p.click('[data-rt="markup"]'); await p.click('[data-cmd="md_attachFile"]');
    const [cx, cy] = await at(p, 500, 700);
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.mouse.click(cx, cy)]);
    await fc.setFiles({ name: 'figures.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') });
    await p.waitForFunction(() => Object.values(window.__cowdreyPdf.doc.marks).flat().some((m) => m.type === 'mdFile'));
    // and one on page 2
    await p.evaluate(() => window.__cowdreyPdf.mdAttachAt(1, 100, 700, 'notes.txt', 'text/plain', Array.from(new TextEncoder().encode('Notes for page two'))));
    let ms = await all(p);
    eq(ms.map((m) => [m.type, m.name]), [['mdFile', 'figures.csv'], ['mdFile', 'notes.txt']]);
    await p.evaluate(() => window.__cowdreyPdf.run('undo')); eq((await all(p)).length, 1, 'undo');
    await p.evaluate(() => window.__cowdreyPdf.run('redo')); eq((await all(p)).length, 2, 'redo');
    const out = await savedOf(p), d = await PDFDocument.load(out);
    const a = annotsOf(d, 1).find((x) => String(x.get(N('Subtype'))) === '/FileAttachment');
    ok(a, 'a FileAttachment annotation on page 2');
    const fs = look(d, a.get(N('FS'))), ef = look(d, fs.get(N('EF'))), st = look(d, ef.get(N('F')));
    eq([String(fs.get(N('Type'))), textOf(fs.get(N('UF'))), Buffer.from(L.decodePDFRawStream(st).decode()).toString(), String(a.get(N('Name')))], ['/Filespec', 'notes.txt', 'Notes for page two', '/PushPin']);
    ok(look(d, a.get(N('AP'))), 'with its own look');
    await reopen(p, out);
    const got = await p.evaluate(() => window.__cowdreyPdf.annotFiles(1));
    eq(got.map((f) => [f.name, new TextDecoder().decode(new Uint8Array(f.bytes))]), [['notes.txt', 'Notes for page two']], 'pdf.js reads the file');
    // the Attachments panel lists both page files
    await run(p, 'vw_files'); await p.waitForSelector('#sidePanel .vw-file');
    const rows = await p.$$eval('#sidePanel .vw-file .vw-fname', (s) => s.map((x) => x.childNodes[0].textContent));
    eq(rows.sort(), ['figures.csv', 'notes.txt']);
    eq(errs(p), []); await p.ctx.close();
  });

  await test('media: the Attachments panel renames, describes and removes files the PDF came with; Source goes in /AF', async () => {
    const p = await open();
    await reopen(p, await pdfWith([['a.txt', 'alpha', 'first'], ['b.csv', 'beta', '']]));
    await run(p, 'vw_files'); await p.waitForSelector('#sidePanel .vw-file');
    const rows = () => p.$$eval('#sidePanel .vw-file .vw-fname', (s) => s.map((x) => x.childNodes[0].textContent + ' | ' + x.querySelector('.m').textContent));
    eq((await rows()).length, 2);
    await p.click('#sidePanel [aria-label="Edit a.txt"]'); await p.waitForSelector('#dialog[open] #vwAttName');
    await p.fill('#vwAttName', 'renamed.txt'); await p.fill('#vwAttDesc', 'The source data');
    await p.selectOption('#vwAttRel', 'Source');
    await p.click('#dialog .btn.primary'); await p.waitForTimeout(300);
    await p.click('#sidePanel [aria-label="Remove b.csv"]'); await p.waitForTimeout(300);
    const r = await rows();
    eq(r.length, 1); ok(/^renamed\.txt \| .*The source data · Relationship: Source/.test(r[0]), r[0]);
    const d = await PDFDocument.load(await savedOf(p));
    eq(treeOf(d), [['renamed.txt', 'renamed.txt', 'The source data', 'Source', 'alpha']], 'read back from the saved file');
    const af = look(d, d.catalog.get(N('AF')));
    ok(af instanceof PDFArray && af.size() === 1, 'one associated file');
    eq(textOf(look(d, af.get(0)).get(N('UF'))), 'renamed.txt', 'the Source file is in /AF');
    ok(![...d.context.enumerateIndirectObjects()].some(([, o]) => o.dict && String(o.dict.get(N('Type'))) === '/EmbeddedFile' && Buffer.from(L.decodePDFRawStream(o).decode()).toString() === 'beta'), 'the removed file is not in the file');
    // undo brings the file back
    await run(p, 'undo'); await p.waitForTimeout(300);
    eq((await rows()).length, 2, 'undo');
    eq(errs(p), []); await p.ctx.close();
  });

  await test('media: combining two PDFs that each have an attached file keeps both (the second name gets " (2)")', async () => {
    const p = await open();
    await reopen(p, await pdfWith([['data.txt', 'from the first', '']], 'First'));
    ok(await p.evaluate(async (b) => { const bin = atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return window.__cowdreyPdf.addSource(u, 'second.pdf'); }, b64(await pdfWith([['data.txt', 'from the second', ''], ['more.txt', 'more', '']], 'Second'))), 'added');
    await p.waitForFunction(() => window.__cowdreyPdf.doc.pages.length === 2);
    const d = await PDFDocument.load(await savedOf(p));
    eq(d.getPageCount(), 2);
    eq(treeOf(d).map((x) => [x[0], x[4]]), [['data (2).txt', 'from the second'], ['data.txt', 'from the first'], ['more.txt', 'more']]);
    eq(errs(p), []); await p.ctx.close();
  });

  await test('media: a portfolio shows a Portfolio bar and its files (columns and folders); Open opens an embedded PDF', async () => {
    const inner = await PDFDocument.create(), f = await inner.embedFont('Helvetica');
    inner.addPage([400, 300]).drawText('Inside the portfolio', { x: 40, y: 200, size: 16, font: f });
    const innerBytes = Buffer.from(await inner.save());
    const cover = await PDFDocument.create(), cf = await cover.embedFont('Helvetica');
    cover.addPage([612, 792]).drawText('This portfolio holds files', { x: 72, y: 720, size: 14, font: cf });
    await cover.attach(innerBytes, 'inner.pdf', { mimeType: 'application/pdf', description: 'The report' });
    await cover.attach(Buffer.from('hello'), 'readme.txt', { mimeType: 'text/plain', description: 'Read me' });
    const c = cover.context;
    const folders = c.obj({ Type: 'Folder', ID: 0, Name: PDFHexString.fromText('Root') });
    const sub = c.obj({ Type: 'Folder', ID: 1, Name: PDFHexString.fromText('Reports'), Parent: folders });
    folders.set(N('Child'), c.register(sub));
    cover.catalog.set(N('Collection'), c.obj({ Type: 'Collection', View: 'D', Folders: c.register(folders),
      Schema: c.obj({ Type: 'CollectionSchema', FileName: { Subtype: 'F', N: PDFHexString.fromText('Name'), O: 0 }, Description: { Subtype: 'Desc', N: PDFHexString.fromText('Description'), O: 1 }, Dept: { Subtype: 'S', N: PDFHexString.fromText('Department'), O: 2 } }) }));
    let bytes = Buffer.from(await cover.save());
    // put inner.pdf in the Reports folder (its name in the tree starts with the folder's id), with a Department
    const d2 = await PDFDocument.load(bytes), names = look(d2, look(d2, look(d2, d2.catalog.get(N('Names'))).get(N('EmbeddedFiles'))).get(N('Names')));
    for (let k = 0; k < names.size(); k += 2) if (textOf(look(d2, names.get(k))) === 'inner.pdf') { names.set(k, PDFHexString.fromText('<1>inner.pdf')); look(d2, names.get(k + 1)).set(N('CI'), d2.context.obj({ Dept: PDFHexString.fromText('Finance') })); }
    bytes = Buffer.from(await d2.save());
    const p = await open(); await reopen(p, bytes);
    await p.waitForSelector('#mdPfBar');
    ok((await p.textContent('#mdPfBar')).includes('2 files'), await p.textContent('#mdPfBar'));
    const pf = await p.evaluate(() => window.__cowdreyPdf.portfolio());
    eq(pf.schema.map((s) => s.name), ['Name', 'Description', 'Department']);
    eq(pf.files.map((x) => [x.name, x.folder, x.desc, x.fields.Dept || '']), [['readme.txt', '', 'Read me', ''], ['inner.pdf', 'Reports', 'The report', 'Finance']]);
    await p.click('#mdPfBar [data-cmd="md_portfolio"]'); await p.waitForSelector('#dialog[open] .md-pf');
    eq(await p.$$eval('#dialog .md-pf-file', (r) => r.length), 2, 'two files listed');
    eq(await p.$$eval('#dialog .md-pf th', (r) => r.map((x) => x.textContent)), ['Name', 'Description', 'Department', '']);
    ok((await p.textContent('#dialog .md-pf')).includes('Reports'), 'the folder');
    await p.click('#dialog [data-pf-open]');
    await p.waitForFunction(() => window.__cowdreyPdf.doc && window.__cowdreyPdf.doc.name === 'inner' && document.querySelector('.textLayer span'), null, { timeout: 15000 });
    ok((await h.pageText(p)).includes('Inside the portfolio'), 'the embedded PDF is open');
    ok(!(await p.$('#mdPfBar')), 'no bar for a plain PDF');
    eq(errs(p), []); await p.ctx.close();
  });

  await test('media: Insert video saves a Screen annotation with a Rendition and the file; reopened, Play makes a video from a blob', async () => {
    const p = await open(); await openPdf(p);
    // a small MP4 (its header boxes: enough to be kept and handed back byte for byte)
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2'), Buffer.from([0, 0, 0, 8]), Buffer.from('free'), crypto.randomBytes(256)]);
    await p.click('[data-rt="edit"]');
    ok(await p.$('#ribbonBody [data-cmd="md_insertMedia"]'), 'on the Edit tab');
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#ribbonBody [data-cmd="md_insertMedia"]')]);
    await fc.setFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: mp4 });
    await p.waitForFunction(() => document.querySelector('#app').dataset.tool === 'mdplace', null, { timeout: 10000 });
    const a = await at(p, 100, 600), b = await at(p, 340, 465);
    await p.mouse.move(...a); await p.mouse.down(); await p.mouse.move(...b, { steps: 5 }); await p.mouse.up();
    await p.waitForFunction(() => Object.values(window.__cowdreyPdf.doc.marks).flat().some((m) => m.type === 'mdMedia'));
    const [m] = await all(p);
    eq([m.name, m.mime, m.rect.map(Math.round)], ['clip.mp4', 'video/mp4', [100, 465, 340, 600]]);
    ok(/^data:image\/png/.test(m.poster), 'a poster picture');
    const out = await savedOf(p), d = await PDFDocument.load(out);
    const s = annotsOf(d, 0).find((x) => String(x.get(N('Subtype'))) === '/Screen');
    ok(s, 'a Screen annotation');
    const act = look(d, s.get(N('A'))), rend = look(d, act.get(N('R'))), clip = look(d, rend.get(N('C')));
    eq([String(act.get(N('S'))), String(rend.get(N('S'))), String(clip.get(N('S'))), textOf(clip.get(N('CT'))), textOf(look(d, clip.get(N('P'))).get(N('TF')))], ['/Rendition', '/MR', '/MCD', 'video/mp4', 'TEMPACCESS']);
    eq(look(d, act.get(N('AN'))), s, 'the action plays this annotation');
    const spec = look(d, clip.get(N('D'))), st = look(d, look(d, spec.get(N('EF'))).get(N('F')));
    eq(sha(L.decodePDFRawStream(st).decode()), sha(mp4), 'the embedded file is the video');
    const ap = look(d, look(d, s.get(N('AP'))).get(N('N')));
    ok(ap && look(d, look(d, ap.dict.get(N('Resources'))).get(N('XObject'))), 'its poster as its look');
    await reopen(p, out);
    await p.waitForSelector('.page[data-n="0"] .md-play');
    await p.click('.page[data-n="0"] .md-play');
    await p.waitForSelector('.page[data-n="0"] video.md-player');
    ok(/^blob:/.test(await p.$eval('.page[data-n="0"] video.md-player', (v) => v.src)), 'played from a blob');
    ok(!(await p.$('.page[data-n="0"] .md-play')), 'the button gives way to the player');
    eq(errs(p), []); await p.ctx.close();
  });

  await test('media: a Sound comment plays as a WAV made from its samples; mu-law samples are decoded', async () => {
    const d = await PDFDocument.create(), font = await d.embedFont('Helvetica'), pg = d.addPage([612, 792]);
    pg.drawText('A page with a sound', { x: 72, y: 720, size: 14, font });
    const samples = Buffer.alloc(800); for (let i = 0; i < samples.length; i++) samples[i] = 128 + Math.round(100 * Math.sin(i / 3));
    const snd = d.context.register(d.context.flateStream(samples, { Type: 'Sound', R: 8000, C: 1, B: 8, E: 'Raw' }));
    const an = d.context.register(d.context.obj({ Type: 'Annot', Subtype: 'Sound', Rect: [100, 500, 124, 524], Sound: snd, F: 4 }));
    pg.node.set(N('Annots'), d.context.obj([an]));
    const p = await open(); await reopen(p, Buffer.from(await d.save()));
    await p.waitForSelector('.page[data-n="0"] .md-play');
    await p.click('.page[data-n="0"] .md-play');
    await p.waitForSelector('.page[data-n="0"] audio.md-player');
    ok(/^blob:/.test(await p.$eval('.page[data-n="0"] audio.md-player', (v) => v.src)), 'played from a blob');
    // the WAV builder: mu-law 0xFF is silence, 16-bit big-endian is turned round
    const w = await p.evaluate(() => window.__cowdreyPdf.mdWav([0xFF, 0x00], 8000, 1, 8, 'muLaw'));
    eq(String.fromCharCode(...w.slice(0, 4)), 'RIFF'); eq(w.length, 44 + 4);
    eq([w[44] | (w[45] << 8)], [0], 'silence');
    ok(((w[46] | (w[47] << 8)) << 16 >> 16) < -30000, 'loudest negative');
    const w16 = await p.evaluate(() => window.__cowdreyPdf.mdWav([0x12, 0x34], 8000, 1, 16, 'Signed'));
    eq([w16[44], w16[45]], [0x34, 0x12], 'little-endian');
    eq(errs(p), []); await p.ctx.close();
  });

  await test('media: a RichMedia annotation with an embedded MP4 plays from its file', async () => {
    const d = await PDFDocument.create(), font = await d.embedFont('Helvetica'), pg = d.addPage([612, 792]), c = d.context;
    pg.drawText('A page with rich media', { x: 72, y: 720, size: 14, font });
    const clip = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from('ftypmp42'), crypto.randomBytes(64)]);
    const ef = c.register(c.flateStream(clip, { Type: 'EmbeddedFile', Subtype: 'video/mp4' }));
    const spec = c.register(c.obj({ Type: 'Filespec', F: PDFString.of('movie.mp4'), UF: PDFHexString.fromText('movie.mp4'), EF: { F: ef } }));
    const an = c.register(c.obj({ Type: 'Annot', Subtype: 'RichMedia', Rect: [100, 400, 340, 535], F: 4,
      RichMediaContent: { Type: 'RichMediaContent', Assets: { Names: [PDFString.of('movie.mp4'), spec] }, Configurations: [{ Type: 'RichMediaConfiguration', Subtype: 'Video', Instances: [{ Type: 'RichMediaInstance', Subtype: 'Video', Asset: spec }] }] } }));
    pg.node.set(N('Annots'), c.obj([an]));
    const p = await open(); await reopen(p, Buffer.from(await d.save()));
    await p.waitForSelector('.page[data-n="0"] .md-play');
    eq(await p.$eval('.page[data-n="0"] .md-play', (b) => b.getAttribute('aria-label')), 'Play movie.mp4');
    await p.click('.page[data-n="0"] .md-play');
    await p.waitForSelector('.page[data-n="0"] video.md-player');
    ok(/^blob:/.test(await p.$eval('.page[data-n="0"] video.md-player', (v) => v.src)), 'from a blob');
    const bytes = await p.evaluate(async () => { const v = document.querySelector('video.md-player'); return Array.from(new Uint8Array(await (await fetch(v.src)).arrayBuffer())); });
    eq(sha(bytes), sha(clip), 'the embedded bytes');
    eq(errs(p), []); await p.ctx.close();
  });

  await test('stamps: a picture stamp is a Stamp with the picture as its look; Your stamps keeps, renames and deletes it', async () => {
    const p = await open(); await openPdf(p);
    const png = Buffer.from(await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 120; c.height = 60; const g = c.getContext('2d'); g.fillStyle = '#0a7d3b'; g.fillRect(0, 0, 120, 60); const u = c.toDataURL('image/png'); return u.slice(u.indexOf(',') + 1); }), 'base64');
    await run(p, 'cm_stamp'); await p.waitForSelector('#dialog[open] #cmStampPicBtn');
    await p.setInputFiles('#cmStampPic', { name: 'Seal.png', mimeType: 'image/png', buffer: png });
    await p.waitForFunction(() => document.querySelector('#app').dataset.tool === 'cmstamp');
    await p.mouse.click(...(await at(p, 300, 600))); await p.waitForTimeout(300);
    const [m] = await all(p);
    eq([m.type, m.name, Math.round(m.w), Math.round(m.h)], ['cmPicStamp', 'Seal', 150, 75]);
    const d = await PDFDocument.load(await savedOf(p));
    const s = annotsOf(d, 0).find((x) => String(x.get(N('Subtype'))) === '/Stamp');
    ok(s, 'a Stamp annotation');
    const ap = look(d, look(d, s.get(N('AP'))).get(N('N'))), xo = look(d, look(d, ap.dict.get(N('Resources'))).get(N('XObject')));
    const im = look(d, xo.get(N('Im')));
    eq([String(im.dict.get(N('Subtype'))), im.dict.get(N('Width')).asNumber()], ['/Image', 120], 'the picture in its look');
    const rect = look(d, s.get(N('Rect'))).asArray().map((n) => Math.round(n.asNumber()));
    eq(rect, [225, 563, 375, 638], 'where it was put');
    // kept in Your stamps: rename and delete it
    eq(await p.evaluate(() => JSON.parse(localStorage.getItem('cowdrey.pdf:stamps')).map((x) => [x.kind, x.name])), [['picture', 'Seal']]);
    await run(p, 'cm_stamp'); await p.waitForSelector('#dialog[open] .cm-lib-name');
    await p.fill('.cm-lib-name', 'Company seal'); await p.press('.cm-lib-name', 'Tab');
    eq(await p.evaluate(() => JSON.parse(localStorage.getItem('cowdrey.pdf:stamps')).map((x) => x.name)), ['Company seal'], 'renamed');
    await p.click('#dialog [data-lib-del]');
    eq(await p.evaluate(() => JSON.parse(localStorage.getItem('cowdrey.pdf:stamps')).length), 0, 'deleted');
    ok(!(await p.$('#dialog .cm-lib-item')), 'gone from the list');
    await p.click('#dialog [data-x]');
    eq(errs(p), []); await p.ctx.close();
  });

  await test('stamps: the dynamic stamp says Approved by your name on the date and time', async () => {
    const p = await open(); await openPdf(p);
    await run(p, 'cm_stamp'); await p.waitForSelector('#dialog[open] #cmStampDyn');
    ok((await p.textContent('#cmStampDyn')).includes('by Tester on'), await p.textContent('#cmStampDyn'));
    await p.click('#cmStampDyn'); await p.waitForTimeout(150);
    await p.mouse.click(...(await at(p, 300, 600))); await p.waitForTimeout(300);
    const [m] = await all(p);
    eq([m.type, m.label], ['cmStamp', 'Approved']); ok(/^by Tester on .*\d/.test(m.sub), m.sub);
    const d = await PDFDocument.load(await savedOf(p));
    const s = annotsOf(d, 0).find((x) => String(x.get(N('Subtype'))) === '/Stamp');
    ok(/^Approved by Tester on /.test(textOf(s.get(N('Contents')))), textOf(s.get(N('Contents'))));
    // with no name set: the PDF's author
    await p.evaluate(() => window.__cowdreyPdf.setAuthor(''));
    const withAuthor = await PDFDocument.create(); withAuthor.setAuthor('Dana Author'); const ff = await withAuthor.embedFont('Helvetica');
    withAuthor.addPage([612, 792]).drawText('Hello', { x: 72, y: 720, size: 14, font: ff });
    await reopen(p, Buffer.from(await withAuthor.save()));
    await run(p, 'cm_stamp'); await p.waitForSelector('#dialog[open] #cmStampDyn');
    ok((await p.textContent('#cmStampDyn')).includes('by Dana Author on'), await p.textContent('#cmStampDyn'));
    await p.click('#dialog [data-x]');
    eq(errs(p), []); await p.ctx.close();
  });
};
