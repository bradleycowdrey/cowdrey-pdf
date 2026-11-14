// Pictures: rotate, flip, crop, replace, save as PNG and delete, for pictures in the PDF (Edit PDF) and added ones.
// tests/fixtures/word.pdf has one 256 × 256 picture drawn at x 400–520, y 420–540.
export default async (h) => {
  const { test, eq, ok, open, openPdf, savedOf, reopen, at, WORD, root, path, fs } = h;
  const near = (a, b, m) => { if (a.length !== b.length || a.some((x, k) => Math.abs(x - b[k]) > .6)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
  const sel = (p) => p.evaluate(() => window.__cowdreyPdf.picSel());
  const all = (p) => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().filter((m) => m && m.type));
  const bar = async (p, id) => { await p.click(`.pic-bar [data-cmd="${id}"]`); await p.waitForTimeout(250); };
  const errs = (p) => p.errors.filter((e) => !/annotation-comment/.test(e));
  // A plain PNG made in the page: w × h, one colour.
  const png = async (p, w, hgt, color) => Buffer.from(await p.evaluate(([w, hh, c]) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = hh; const g = cv.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, w, hh); const u = cv.toDataURL('image/png'); return u.slice(u.indexOf(',') + 1); }, [w, hgt, color]), 'base64');
  // The colour drawn at a point of page 1 (PDF coordinates)
  const pixel = (p, x, y) => p.evaluate(([x, y]) => { const v = window.__cowdreyPdf.views()[0], c = v.el.querySelector('canvas.pdf'), k = c.width / v.viewport.width; const [vx, vy] = v.viewport.convertToViewportPoint(x, y); return [...c.getContext('2d').getImageData(Math.round(vx * k), Math.round(vy * k), 1, 1).data].slice(0, 3); }, [x, y]);
  const pickPicture = async (p) => { await p.evaluate(() => window.__cowdreyPdf.run('tool_edit')); const [cx, cy] = await at(p, 460, 480); await p.mouse.click(cx, cy); await p.waitForTimeout(400); };

  await test('Pictures: a picture in the PDF is turned, mirrored and cropped from its toolbar; the saved PDF draws it so, clipped', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await pickPicture(p);
    ok(await p.isVisible('.pic-bar'), 'toolbar shows next to the picture');
    eq((await sel(p)).kind, 'ie');
    // A quick click must not leave the picture following the pointer
    const [mx, my] = await at(p, 200, 300); await p.mouse.move(mx, my, { steps: 3 }); await p.waitForTimeout(200);
    near((await sel(p)).mat, [120, 0, 0, 120, 400, 420], 'still in place after a click');
    await bar(p, 'picRotR');
    near((await sel(p)).mat, [0, -120, 120, 0, 400, 540], 'turned right about its centre');
    await bar(p, 'picFlipH');
    near((await sel(p)).mat, [0, -120, -120, 0, 520, 540], 'mirrored left to right');
    // Crop: drag the frame's corner over the picture's top-left on the page (its unit square's 1,1 now) inwards
    await bar(p, 'picCrop');
    ok(await p.isVisible('.pic-crop'), 'crop frame');
    const [hx, hy] = await at(p, 400, 420), [tx, ty] = await at(p, 430, 450);
    await p.mouse.move(hx, hy); await p.mouse.down(); await p.mouse.move(tx, ty, { steps: 6 }); await p.mouse.up();
    await bar(p, 'picCropApply');
    const s = await sel(p);
    near(s.crop, [0, 0, .75, .75], 'crop in the picture’s unit square');
    ok(!(await p.$('.pic-crop')), 'frame closed');
    ok(await p.$('.marks image[clip-path]'), 'clipped on screen');
    // Undo takes the crop off, redo puts it back
    await p.evaluate(() => window.__cowdreyPdf.run('undo')); await p.waitForTimeout(200);
    eq((await all(p))[0].crop, undefined, 'undo');
    await p.evaluate(() => window.__cowdreyPdf.run('redo')); await p.waitForTimeout(200);
    near((await all(p))[0].crop, [0, 0, .75, .75], 'redo');
    const out = await savedOf(p);
    await reopen(p, out);
    const ops = await p.evaluate(() => window.__cowdreyPdf.picOps(0));
    eq(ops.length, 1, 'one picture drawn');
    near(ops[0].mat, [0, -120, -120, 0, 520, 540], 'saved placement');
    ok(ops[0].clip, 'clipped before it is painted'); near(ops[0].clip, [430, 450, 520, 540], 'clip');
    // Outside the crop, the old picture is gone (white page); inside, the picture shows
    ok((await pixel(p, 410, 430)).every((c) => c > 240), 'cropped-off part is blank');
    ok((await pixel(p, 515, 455)).some((c) => c < 200), 'kept part drawn');
    eq(errs(p), []); await p.ctx.close();
  });

  await test('Pictures: Save picture as PNG gives the picture’s own pixels; Replace fits a new one in the same box', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await pickPicture(p);
    const [dl] = await Promise.all([p.waitForEvent('download'), bar(p, 'picExtract')]);
    eq(dl.suggestedFilename(), 'Pelican report picture.png');
    const b = fs.readFileSync(await dl.path());
    eq([...b.subarray(1, 4)].map((c) => String.fromCharCode(c)).join(''), 'PNG', 'a PNG file');
    eq([b.readUInt32BE(16), b.readUInt32BE(20)], [256, 256], 'full size');
    eq(await all(p), [], 'saving the picture changes nothing');
    // Replace with a wide red picture: fitted inside the 120 × 120 box, centred
    await p.setInputFiles('#picReplaceInput', { name: 'red.png', mimeType: 'image/png', buffer: await png(p, 200, 100, '#ff0000') });
    await p.waitForFunction(() => Object.values(window.__cowdreyPdf.doc.marks).flat().some((m) => m.type === 'ie' && m.data && m.mat[3] < 100));
    const [m] = await all(p);
    near(m.mat, [120, 0, 0, 60, 400, 450], 'fits inside, keeps its proportions');
    await reopen(p, await savedOf(p));
    const imgs = await p.evaluate(async () => (await window.__cowdreyPdf.contentMap(0)).images.map((i) => i.quad.flat().map(Math.round)));
    eq(imgs, [[400, 450, 520, 450, 520, 510, 400, 510]], 'saved in the same box');
    const c = await pixel(p, 460, 480); ok(c[0] > 200 && c[1] < 60 && c[2] < 60, 'the new picture ' + c);
    ok((await pixel(p, 460, 530)).every((x) => x > 240), 'old picture gone above it');
    // Delete from the toolbar
    await pickPicture(p); await bar(p, 'picDelete');
    await reopen(p, await savedOf(p));
    eq(await p.evaluate(async () => (await window.__cowdreyPdf.contentMap(0)).images.length), 0, 'deleted');
    eq(errs(p), []); await p.ctx.close();
  });

  await test('Pictures: on a turned page, Flip horizontal mirrors across the screen, not the paper', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.evaluate(() => window.__cowdreyPdf.run('rotR')); await p.waitForTimeout(800);
    await pickPicture(p);
    await bar(p, 'picFlipH');
    near((await sel(p)).mat, [120, 0, 0, -120, 400, 540], 'mirrored top to bottom on the paper');
    const d = await h.PDFDocument.load(await savedOf(p));
    eq(d.getPage(0).getRotation().angle, 90);
    await reopen(p, await savedOf(p));
    near((await p.evaluate(() => window.__cowdreyPdf.picOps(0)))[0].mat, [120, 0, 0, -120, 400, 540], 'saved');
    eq(errs(p), []); await p.ctx.close();
  });

  await test('Pictures: an added picture is selected with Select, turned, moved, resized and replaced; undo and the saved PDF follow', async () => {
    const p = await open(); await openPdf(p);
    await p.setInputFiles('#imageInput', { name: 'blue.png', mimeType: 'image/png', buffer: await png(p, 100, 50, '#0000ff') });
    await p.waitForTimeout(300);
    const [ix, iy] = await at(p, 100, 700); await p.mouse.click(ix, iy); await p.waitForTimeout(300);
    eq((await all(p)).map((m) => m.type), ['img']);
    await p.evaluate(() => window.__cowdreyPdf.run('tool_select'));
    const [cx, cy] = await at(p, 137, 681); await p.mouse.click(cx, cy); await p.waitForTimeout(300);
    eq((await sel(p)).kind, 'mark');
    ok(await p.isVisible('.pic-bar'), 'toolbar');
    await bar(p, 'picRotL');
    let [m] = await all(p);
    eq(m.type, 'pic'); near(m.mat, [0, 75, -37.5, 0, 156.25, 643.75], 'turned left about its centre');
    await p.evaluate(() => window.__cowdreyPdf.run('undo')); await p.waitForTimeout(200);
    [m] = await all(p); eq([m.type, Math.round(m.w)], ['img', 75], 'undo');
    await p.evaluate(() => window.__cowdreyPdf.run('redo')); await p.waitForTimeout(200);
    // select again (undo clears the selection) and move it 50 points right
    await p.waitForTimeout(400);
    const [c2x, c2y] = await at(p, 137, 681), [tx, ty] = await at(p, 187, 681);
    await p.mouse.click(c2x, c2y); await p.waitForTimeout(200);
    await p.mouse.move(c2x, c2y); await p.mouse.down(); await p.mouse.move(tx, ty, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(200);
    [m] = await all(p); near(m.mat, [0, 75, -37.5, 0, 206.25, 643.75], 'moved');
    // the resize handle (bottom-right corner of what shows), dragged outwards
    const hb = await p.locator('.pic-resize').boundingBox();
    await p.mouse.move(hb.x + 6, hb.y + 6); await p.mouse.down(); await p.mouse.move(hb.x + 6 + 30, hb.y + 6 + 30, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(200);
    [m] = await all(p);
    ok(Math.abs(m.mat[1]) > 80 && Math.abs(Math.abs(m.mat[1] / m.mat[2]) - 2) < .01, 'bigger, same proportions ' + m.mat);
    await p.setInputFiles('#picReplaceInput', { name: 'green.png', mimeType: 'image/png', buffer: await png(p, 60, 60, '#00ff00') });
    await p.waitForFunction(() => Object.values(window.__cowdreyPdf.doc.marks).flat().some((x) => x.type === 'pic' && Math.abs(Math.abs(x.mat[1]) - Math.abs(x.mat[2])) < .01));
    [m] = await all(p);
    const side = Math.hypot(m.mat[0], m.mat[1]);
    await reopen(p, await savedOf(p));
    const ops = await p.evaluate(() => window.__cowdreyPdf.picOps(0));
    ok(ops.some((o) => o.mat.every((x, k) => Math.abs(x - m.mat[k]) < .6)), `saved where it shows: ${JSON.stringify(ops)} vs ${m.mat}`);
    ok(side > 30, 'square picture fitted in the box');
    const [gx, gy] = [m.mat[4] + (m.mat[0] + m.mat[2]) / 2, m.mat[5] + (m.mat[1] + m.mat[3]) / 2];
    const c = await pixel(p, gx, gy); ok(c[1] > 200 && c[0] < 60, 'green picture saved ' + c);
    eq(errs(p), []); await p.ctx.close();
  });

  await test('Pictures: an added picture is picked with Edit PDF, flipped and cropped; the saved PDF clips it', async () => {
    const p = await open(); await openPdf(p);
    await p.setInputFiles('#imageInput', { name: 'two.png', mimeType: 'image/png', buffer: await png(p, 100, 50, '#0000ff') });
    await p.waitForTimeout(300);
    const [ix, iy] = await at(p, 100, 700); await p.mouse.click(ix, iy); await p.waitForTimeout(300);
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    const [cx, cy] = await at(p, 137, 681); await p.mouse.click(cx, cy); await p.waitForTimeout(300);
    eq((await sel(p)).kind, 'mark', 'Edit PDF selects the added picture');
    ok(await p.isVisible('.pic-bar'), 'toolbar');
    await bar(p, 'picFlipV');
    near((await sel(p)).mat, [75, 0, 0, -37.5, 100, 700], 'mirrored top to bottom');
    await bar(p, 'picCrop');
    const [hx, hy] = await at(p, 175, 662.5), [tx, ty] = await at(p, 137.5, 681.25);
    await p.mouse.move(hx, hy); await p.mouse.down(); await p.mouse.move(tx, ty, { steps: 6 }); await p.mouse.up();
    await bar(p, 'picCropApply');
    const [m] = await all(p);
    eq(m.type, 'pic'); near(m.crop, [0, 0, .5, .5], 'crop');
    ok(await p.$('.marks image[clip-path]'), 'clipped on screen');
    await reopen(p, await savedOf(p));
    const ops = await p.evaluate(() => window.__cowdreyPdf.picOps(0));
    const o = ops.find((x) => Math.abs(x.mat[0] - 75) < .6 && Math.abs(x.mat[3] + 37.5) < .6);
    ok(o, 'saved placement ' + JSON.stringify(ops));
    near(o.clip, [100, 681.3, 137.5, 700], 'saved clip');
    const c = await pixel(p, 118, 690); ok(c[2] > 200 && c[0] < 60, 'kept part drawn ' + c);
    ok((await pixel(p, 160, 670)).every((x) => x > 240), 'cropped-off part is blank');
    eq(errs(p), []); await p.ctx.close();
  });

  await test('Pictures: the toolbar fits a phone screen and the crop can be cancelled with Escape', async () => {
    const p = await open({ width: 390, height: 844, touch: false }); await openPdf(p, WORD, 'Pelican report.pdf');
    await pickPicture(p);
    const b = await p.locator('.pic-bar').boundingBox(), g = await p.locator('.page[data-n="0"]').boundingBox();
    ok(b && b.x >= g.x - 1 && b.x + b.width <= g.x + g.width + 1 && b.x >= 0 && b.x + b.width <= 390, `inside the page ${JSON.stringify(b)} ${JSON.stringify(g)}`);
    await bar(p, 'picCrop');
    const [hx, hy] = await at(p, 520, 420), [tx, ty] = await at(p, 480, 470);
    await p.mouse.move(hx, hy); await p.mouse.down(); await p.mouse.move(tx, ty, { steps: 4 }); await p.mouse.up();
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok(!(await p.$('.pic-crop')), 'closed'); eq(await all(p), [], 'nothing changed');
    ok(await sel(p), 'picture still selected');
    eq(errs(p), []); await p.ctx.close();
  });
};
