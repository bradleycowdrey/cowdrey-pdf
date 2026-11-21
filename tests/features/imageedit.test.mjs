// Image editing done right: moving, turning and flipping a picture keeps its original picture object (no new copy, a
// JPEG keeps its bytes); deleted and replaced pictures leave the file; a real crop cuts the pixels; the Enhance panel;
// Export all pictures. tests/fixtures/word.pdf has one 256 × 256 Flate picture (8 0 R) drawn at x 400–520, y 420–540.
import crypto from 'node:crypto';
export default async (h) => {
  const { test, eq, ok, open, openPdf, savedOf, reopen, at, WORD, fs, require, PDFDocument } = h;
  const { PDFName, PDFDict, PDFRawStream, PDFRef } = require('../desktop/node_modules/pdf-lib');
  const near = (a, b, m, d = .6) => { if (a.length !== b.length || a.some((x, k) => Math.abs(x - b[k]) > d)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const errs = (p) => p.errors.filter((e) => !/annotation-comment/.test(e));
  const all = (p) => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().filter((m) => m && m.type));
  const bar = async (p, id) => { await p.click(`.pic-bar [data-cmd="${id}"]`); await p.waitForTimeout(300); };
  const pick = async (p, x = 460, y = 480) => { await p.evaluate(() => window.__cowdreyPdf.run('tool_edit')); const [cx, cy] = await at(p, x, y); await p.mouse.click(cx, cy); await p.waitForTimeout(400); };
  const drag = async (p, from, to) => { const [ax, ay] = await at(p, ...from), [bx, by] = await at(p, ...to); await p.mouse.move(ax, ay); await p.mouse.down(); await p.mouse.move(bx, by, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(400); };
  // The colour drawn at a point of page 1 (PDF coordinates)
  const pixel = (p, x, y) => p.evaluate(([x, y]) => { const v = window.__cowdreyPdf.views()[0], c = v.el.querySelector('canvas.pdf'), k = c.width / v.viewport.width; const [vx, vy] = v.viewport.convertToViewportPoint(x, y); return [...c.getContext('2d').getImageData(Math.round(vx * k), Math.round(vy * k), 1, 1).data].slice(0, 3); }, [x, y]);
  // Every picture object in a PDF: { ref, w, h, filter, cs, bytes (as stored), hash }
  const images = (d) => {
    const out = [];
    for (const [ref, o] of d.context.enumerateIndirectObjects()) {
      if (!(o instanceof PDFRawStream) || String(o.dict.lookup(PDFName.of('Subtype'))) !== '/Image') continue;
      const n = (k) => { const x = o.dict.lookup(PDFName.of(k)); return x && x.asNumber ? x.asNumber() : String(x); };
      if (d.context.lookup(ref) && [...d.context.enumerateIndirectObjects()].some(([, x]) => x instanceof PDFRawStream && x.dict.get(PDFName.of('SMask')) === ref)) continue; // soft masks are not pictures of their own
      out.push({ ref: ref.toString(), w: n('Width'), h: n('Height'), filter: String(o.dict.lookup(PDFName.of('Filter'))), cs: String(o.dict.lookup(PDFName.of('ColorSpace'))), smask: !!o.dict.get(PDFName.of('SMask')), bytes: Buffer.from(o.getContents()), hash: sha(o.getContents()) });
    }
    return out;
  };
  const pageXObjects = (d, k = 0) => { const R = d.getPage(k).node.Resources(), xo = R && R.lookup(PDFName.of('XObject')); return xo instanceof PDFDict ? xo.entries().map(([n, v]) => [n.asString(), String(d.context.lookup(v).dict.lookup(PDFName.of('Subtype')))]) : []; };
  const original = images(await PDFDocument.load(fs.readFileSync(WORD)));

  // A PDF with one JPEG picture (made in the page, so it is a real browser JPEG) drawn at x 400–520, y 420–540.
  const jpegPdf = async (p, opts = {}) => {
    const b64 = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 100; const g = c.getContext('2d'); g.fillStyle = '#d02020'; g.fillRect(0, 0, 100, 100); g.fillStyle = '#2040d0'; g.fillRect(100, 0, 100, 100); g.fillStyle = '#ffffff'; g.fillRect(90, 40, 20, 20); const u = c.toDataURL('image/jpeg', .9); return u.slice(u.indexOf(',') + 1); });
    const jpg = Buffer.from(b64, 'base64');
    const d = await PDFDocument.create(), pg = d.addPage([612, 792]), font = await d.embedFont('Helvetica');
    pg.drawText(opts.text || 'A page with a photo', { x: 72, y: 720, size: 14, font });
    const im = await d.embedJpg(Uint8Array.from(jpg)); // a copy: pdf-lib reads the whole buffer under a Buffer
    pg.drawImage(im, { x: 400, y: 420, width: 240, height: 120 });
    return { jpg, pdf: Buffer.from(await d.save()) };
  };

  await test('Image editing: a deleted picture leaves the file, and the page no longer lists it', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    eq(original.map((x) => [x.w, x.h, x.filter]), [[256, 256, '/FlateDecode']], 'the fixture');
    await pick(p); await bar(p, 'picDelete');
    const d = await PDFDocument.load(await savedOf(p));
    eq(images(d).filter((x) => x.w === 256 && x.h === 256).length, 0, 'no 256 × 256 picture object left');
    eq(pageXObjects(d).filter(([, t]) => t === '/Image'), [], 'no XObject entry for it');
    eq(errs(p), []); await p.ctx.close();
  });

  await test('Image editing: moving and turning a picture keeps its own picture object, byte for byte', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await pick(p);
    await drag(p, [460, 480], [360, 380]); // 100 left, 100 down
    near((await p.evaluate(() => window.__cowdreyPdf.picSel())).mat, [120, 0, 0, 120, 300, 320], 'moved');
    await bar(p, 'picRotR'); await bar(p, 'picFlipH');
    const m = (await all(p))[0];
    eq([m.type, m.orig], ['ie', true]);
    near(m.mat, [0, -120, -120, 0, 420, 440], 'turned and mirrored about its centre');
    const out = await savedOf(p), d = await PDFDocument.load(out), list = images(d);
    eq(list.length, 1, 'exactly one picture object');
    eq(list[0].hash, original[0].hash, 'the same bytes as the original');
    eq(pageXObjects(d).filter(([, t]) => t === '/Image').length, 1, 'one entry on the page');
    await reopen(p, out);
    const ops = await p.evaluate(() => window.__cowdreyPdf.picOps(0));
    eq(ops.length, 1); near(ops[0].mat, m.mat, 'drawn where it was put');
    ok((await pixel(p, 460, 480)).every((c) => c > 240), 'the old place is blank');
    ok((await pixel(p, 360, 380)).some((c) => c < 230), 'drawn at the new place');
    eq(errs(p), []); await p.ctx.close();
  });

  await test('Image editing: a replaced picture leaves the file; a JPEG put in its place keeps its own bytes', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    const { jpg } = await jpegPdf(p);
    await pick(p);
    await p.setInputFiles('#picReplaceInput', { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: jpg });
    await p.waitForFunction(() => Object.values(window.__cowdreyPdf.doc.marks).flat().some((m) => m.type === 'ie' && /^data:image\/jpeg/.test(m.data || '')));
    const d = await PDFDocument.load(await savedOf(p)), list = images(d);
    eq(list.map((x) => [x.w, x.h, x.filter]), [[200, 100, '/DCTDecode']], 'only the new picture, as a JPEG');
    eq(list[0].hash, sha(jpg), 'its own bytes');
    eq(errs(p), []); await p.ctx.close();
  });

  await test('Image editing: a JPEG that is moved stays the same JPEG; a real crop gives a smaller JPEG and the original goes', async () => {
    const p = await open();
    const { jpg, pdf } = await jpegPdf(p);
    await reopen(p, pdf);
    const info = await p.evaluate(() => window.__cowdreyPdf.picInfo(0));
    eq(info.map((x) => [x.jpeg, x.w, x.h, x.cmyk]), [[true, 200, 100, false]], 'read as a JPEG');
    await pick(p, 520, 480);
    await drag(p, [520, 480], [470, 450]);
    let d = await PDFDocument.load(await savedOf(p)), list = images(d);
    eq(list.map((x) => [x.filter, x.w, x.h]), [['/DCTDecode', 200, 100]], 'still one JPEG');
    eq(list[0].hash, sha(jpg), 'byte for byte');
    // Crop with "Keep the full picture" off: the left half is kept (the picture now runs x 350–590)
    await bar(p, 'picCrop');
    ok(await p.isVisible('#picCropKeep'), 'the choice shows');
    if (await p.isChecked('#picCropKeep')) await p.click('#picCropKeep');
    await drag(p, [590, 510], [470, 510]); // the top-right corner to the middle
    await bar(p, 'picCropApply');
    const m = (await all(p))[0];
    eq([m.orig, m.crop, /^data:image\/jpeg/.test(m.data)], [false, undefined, true], 'cut, not hidden');
    near(m.mat, [120, 0, 0, 120, 350, 390], 'placed where the kept part was', 1.3);
    const out = await savedOf(p); d = await PDFDocument.load(out); list = images(d);
    eq(list.length, 1, 'one picture object');
    eq(list[0].filter, '/DCTDecode', 'still a JPEG');
    ok(Math.abs(list[0].w - 100) <= 1 && list[0].h === 100, `the cropped size ${list[0].w} × ${list[0].h}`);
    ok(list[0].hash !== sha(jpg), 'the original is gone');
    await reopen(p, out);
    const c = await pixel(p, 410, 450); ok(c[0] > 150 && c[2] < 110, 'the kept part (red) shows ' + c);
    ok((await pixel(p, 530, 450)).every((x) => x > 240), 'the cut-off part is gone');
    // the setting is remembered
    eq(await p.evaluate(() => JSON.parse(localStorage.getItem('cowdrey.pdf:settings')).picCropKeep), false);
    eq(errs(p), []); await p.ctx.close();
  });

  await test('Image editing: Export all pictures gives a zip with the original JPEG bytes', async () => {
    const p = await open();
    const { jpg, pdf } = await jpegPdf(p);
    await reopen(p, pdf);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => window.__cowdreyPdf.run('picExportAll'))]);
    eq(dl.suggestedFilename(), 'Saved pictures.zip');
    const z = fs.readFileSync(await dl.path());
    eq(z.readUInt32LE(0), 0x04034b50, 'a zip');
    const nameLen = z.readUInt16LE(26), size = z.readUInt32LE(18), name = z.subarray(30, 30 + nameLen).toString();
    eq(name, 'Picture 1 (page 1).jpg');
    eq(sha(z.subarray(30 + nameLen, 30 + nameLen + size)), sha(jpg), 'the JPEG’s own bytes');
    // the Word picture comes out as a PNG
    await reopen(p, fs.readFileSync(WORD));
    const [dl2] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => window.__cowdreyPdf.run('picExportAll'))]);
    const z2 = fs.readFileSync(await dl2.path()), n2 = z2.readUInt16LE(26);
    eq(z2.subarray(30, 30 + n2).toString(), 'Picture 1 (page 1).png');
    eq(z2.subarray(30 + n2 + 1, 30 + n2 + 4).toString(), 'PNG');
    eq(errs(p), []); await p.ctx.close();
  });

  // Every pixel of a saved picture object, as RGB: [w, h, [r, g, b] …] (Flate, 8 bits, grey or RGB)
  const greyPixels = (d, im) => {
    const o = [...d.context.enumerateIndirectObjects()].find(([r]) => r.toString() === im.ref)[1], b = L.decodePDFRawStream(o).decode();
    return im.cs === '/DeviceGray' || [...Array(b.length / 3).keys()].every((k) => b[k * 3] === b[k * 3 + 1] && b[k * 3] === b[k * 3 + 2]);
  };
  const L = require('../desktop/node_modules/pdf-lib');

  await test('Image editing: Enhance shows a live preview; greyscale makes a grey picture, the original leaves the file, undo brings it back', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await pick(p);
    ok(await p.isVisible('.pic-bar [data-cmd="imgEnhance"]'), 'Enhance on the picture’s toolbar');
    await bar(p, 'imgEnhance');
    await p.waitForSelector('.ie-panel');
    await p.waitForSelector('.page[data-n="0"] canvas.ie-view');
    // Threshold only shows with Black and white on
    const thr = () => p.$eval('#ie_threshold_row', (r) => getComputedStyle(r).display !== 'none' && r.getBoundingClientRect().height > 0);
    eq(await thr(), false, 'no Threshold while Black and white is off');
    await p.check('#ie_bw'); eq(await thr(), true, 'Threshold with Black and white on');
    await p.uncheck('#ie_bw'); eq(await thr(), false, 'and gone again');
    const before = await p.evaluate(() => { const c = document.querySelector('canvas.ie-view'); return [...c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data]; });
    await p.fill('#ie_brightness', '60'); await p.dispatchEvent('#ie_brightness', 'input'); await p.waitForTimeout(250);
    const after = await p.evaluate(() => { const c = document.querySelector('canvas.ie-view'); return [...c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data]; });
    ok(after[0] + after[1] + after[2] > before[0] + before[1] + before[2] + 60, `the preview is brighter ${before} → ${after}`);
    eq(await all(p), [], 'nothing changes until Apply');
    await p.fill('#ie_brightness', '0'); await p.dispatchEvent('#ie_brightness', 'input');
    await p.check('#ie_gray');
    await p.click('#ieApply'); await p.waitForTimeout(500);
    ok(!(await p.$('.ie-panel')) && !(await p.$('canvas.ie-view')), 'the panel closes');
    const [m] = await all(p);
    eq([m.type, m.orig], ['ie', false]);
    let d = await PDFDocument.load(await savedOf(p)), list = images(d);
    eq(list.length, 1, 'one picture object');
    ok(list[0].hash !== original[0].hash, 'the original is gone');
    eq([list[0].w, list[0].h], [256, 256]);
    ok(greyPixels(d, list[0]), 'grey: ' + list[0].cs);
    eq(list[0].cs, '/DeviceGray', 'saved with one grey channel');
    await p.evaluate(() => window.__cowdreyPdf.run('undo')); await p.waitForTimeout(300);
    eq(await all(p), [], 'undo');
    d = await PDFDocument.load(await savedOf(p)); list = images(d);
    eq(list.map((x) => x.hash), [original[0].hash], 'the original is back, byte for byte');
    eq(errs(p), []); await p.ctx.close();
  });

  await test('Image editing: Enhance resamples to a resolution, and is on the right-click menu and the Edit tab', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await pick(p);
    await p.click('[data-rt="edit"]'); await pick(p);
    ok(await p.$('#ribbonBody [data-cmd="imgEnhance"]'), 'on the Edit tab');
    const [cx, cy] = await at(p, 460, 480);
    await p.mouse.click(cx, cy, { button: 'right' }); await p.waitForTimeout(300);
    const items = await p.$$eval('#popover .mi span:first-of-type', (s) => s.map((x) => x.textContent));
    ok(items.includes('Enhance picture…') && items.includes('Crop') && items.includes('Delete picture'), 'the picture’s menu: ' + items);
    await p.click('#popover .mi:has-text("Enhance picture…")');
    await p.waitForSelector('.ie-panel');
    ok((await p.textContent('.ie-panel')).includes('256 × 256 pixels, about 154 dpi'), await p.textContent('.ie-panel .ie-note'));
    await p.evaluate(() => window.__cowdreyPdf.ieSet({ resample: true, dpi: 72, contrast: 20 }));
    await p.click('#ieApply'); await p.waitForTimeout(500);
    const d = await PDFDocument.load(await savedOf(p)), list = images(d);
    eq(list.map((x) => [x.w, x.h]), [[120, 120]], '120 points at 72 dpi');
    eq(errs(p), []); await p.ctx.close();
  });

  await test('Image editing: a CMYK picture is moved without being touched; Enhance says it becomes RGB', async () => {
    const d0 = await PDFDocument.create(), pg = d0.addPage([612, 792]), font = await d0.embedFont('Helvetica');
    pg.drawText('A page with a CMYK picture', { x: 72, y: 720, size: 14, font });
    const px = Buffer.alloc(16 * 16 * 4); for (let i = 0; i < 256; i++) px.set([0, 200, 200, 20], i * 4);
    const ref = d0.context.register(d0.context.flateStream(px, { Type: 'XObject', Subtype: 'Image', Width: 16, Height: 16, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8 }));
    const key = pg.node.newXObject('Im', ref);
    pg.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(120, 0, 0, 120, 400, 420), L.drawObject(key), L.popGraphicsState());
    const cmyk = Buffer.from(await d0.save());
    const was = images(await PDFDocument.load(cmyk));
    const p = await open(); await reopen(p, cmyk);
    eq((await p.evaluate(() => window.__cowdreyPdf.picInfo(0))).map((x) => [x.cmyk, x.cs]), [[true, 'DeviceCMYK']]);
    await pick(p);
    await drag(p, [460, 480], [430, 470]);
    const d = await PDFDocument.load(await savedOf(p)), list = images(d);
    eq(list.map((x) => [x.cs, x.hash]), [['/DeviceCMYK', was[0].hash]], 'still the same CMYK picture');
    await bar(p, 'imgEnhance'); await p.waitForSelector('.ie-panel');
    ok((await p.textContent('.ie-panel .ie-note')).includes('This picture is CMYK: once changed it is saved as RGB.'), 'the warning');
    await p.click('#ieCancel');
    ok(!(await p.$('.ie-panel')), 'cancelled');
    eq(errs(p), []); await p.ctx.close();
  });

  await test('Image editing: a real crop of an added picture with transparency cuts its soft mask the same way', async () => {
    const p = await open(); await openPdf(p);
    const png = Buffer.from(await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 100; const g = c.getContext('2d'); g.fillStyle = 'rgba(0,0,255,0.5)'; g.fillRect(0, 0, 100, 100); g.fillStyle = '#00aa00'; g.fillRect(100, 0, 100, 100); const u = c.toDataURL('image/png'); return u.slice(u.indexOf(',') + 1); }), 'base64');
    await p.setInputFiles('#imageInput', { name: 'half.png', mimeType: 'image/png', buffer: png });
    await p.waitForTimeout(300);
    const [ix, iy] = await at(p, 100, 700); await p.mouse.click(ix, iy); await p.waitForTimeout(300);
    await p.evaluate(() => window.__cowdreyPdf.run('tool_select'));
    let [m] = await all(p);
    const [cx, cy] = await at(p, m.x + m.w / 2, m.y - m.h / 2); await p.mouse.click(cx, cy); await p.waitForTimeout(300);
    eq((await p.evaluate(() => window.__cowdreyPdf.picSel())).kind, 'mark');
    await bar(p, 'picCrop');
    if (await p.isChecked('#picCropKeep')) await p.click('#picCropKeep');
    // keep the left (see-through) half: the bottom-right corner to the middle of the bottom edge
    await drag(p, [m.x + m.w, m.y - m.h], [m.x + m.w / 2, m.y - m.h]);
    await bar(p, 'picCropApply');
    [m] = await all(p);
    eq([m.type, m.crop], ['pic', undefined]);
    const d = await PDFDocument.load(await savedOf(p)), list = images(d);
    const pic = list.find((x) => x.smask);
    ok(pic, 'the picture keeps a soft mask ' + JSON.stringify(list.map((x) => [x.w, x.h, x.smask])));
    eq([pic.w, pic.h], [100, 100], 'cut to the half kept');
    const sm = [...d.context.enumerateIndirectObjects()].find(([, o]) => o instanceof PDFRawStream && [...d.context.enumerateIndirectObjects()].some(([r2, o2]) => r2.toString() === pic.ref && o2.dict.get(PDFName.of('SMask')) && d.context.lookup(o2.dict.get(PDFName.of('SMask'))) === o))[1];
    eq([sm.dict.lookup(PDFName.of('Width')).asNumber(), sm.dict.lookup(PDFName.of('Height')).asNumber()], [100, 100], 'the mask cut the same way');
    const a = L.decodePDFRawStream(sm).decode(); ok(a.every((x) => Math.abs(x - 128) < 3), 'half see-through');
    eq(errs(p), []); await p.ctx.close();
  });

  await test('Image editing: Straighten automatically finds how far lines lean', async () => {
    const p = await open();
    const url = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 400); g.translate(300, 200); g.rotate(4 * Math.PI / 180); g.fillStyle = '#000'; for (let y = -160; y <= 160; y += 24) g.fillRect(-250, y, 500, 5); return c.toDataURL('image/png'); });
    const a = await p.evaluate((u) => window.__cowdreyPdf.ieAutoAngle(u), url);
    ok(Math.abs(a + 4) <= .5, 'turns back by 4 degrees: ' + a);
    await p.ctx.close();
  });
};
