// Optimize (Protect > Optimize…): pictures made smaller at the dpi asked, black-and-white scans kept 1-bit, identical
// pictures merged, Flate streams packed tighter, Lossless only leaves pictures alone, never a bigger file, CMYK kept.
import zlib from 'node:zlib';
export default async (h) => {
  const { test, eq, ok, open, openPdf, root, path, fs, require, answer } = h;
  const C = require(path.join(root, 'desktop/node_modules/@cantoo/pdf-lib'));
  const N = C.PDFName.of;
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  // PNG "Up" predicted rows, deflated at `level`.
  const predicted = (data, W, H, comps, level = 6) => {
    const row = W * comps, out = Buffer.alloc(H * (row + 1));
    for (let y = 0; y < H; y++) { out[y * (row + 1)] = 2; for (let i = 0; i < row; i++) out[y * (row + 1) + 1 + i] = (data[y * row + i] - (y ? data[(y - 1) * row + i] : 0)) & 255; }
    return zlib.deflateSync(out, { level });
  };
  const unpredict = (raw, W, comps) => {
    const row = W * comps, H = raw.length / (row + 1), out = Buffer.alloc(H * row);
    for (let y = 0; y < H; y++) {
      const f = raw[y * (row + 1)];
      for (let i = 0; i < row; i++) {
        const x = raw[y * (row + 1) + 1 + i], a = i >= comps ? out[y * row + i - comps] : 0, b = y ? out[(y - 1) * row + i] : 0, c = y && i >= comps ? out[(y - 1) * row + i - comps] : 0;
        const p = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (() => { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })();
        out[y * row + i] = (x + p) & 255;
      }
    }
    return out;
  };
  const addImage = (d, page, { W, H, cs, bpc = 8, bytes, filter = 'FlateDecode', parms, x, y, w, h: hh }) => {
    const dict = { Type: 'XObject', Subtype: 'Image', Width: W, Height: H, BitsPerComponent: bpc };
    if (filter) dict.Filter = filter;
    if (parms) dict.DecodeParms = parms;
    const st = d.context.stream(bytes, dict);
    st.dict.set(N('ColorSpace'), typeof cs === 'string' ? N(cs) : cs);
    const ref = d.context.register(st), name = page.node.newXObject('Im', ref);
    return { ref, op: `q ${w} 0 0 ${hh} ${x} ${y} cm ${name.asString()} Do Q\n` };
  };
  const setContent = (d, page, text, level) => {
    const raw = Buffer.from(text, 'latin1');
    const st = level ? d.context.stream(zlib.deflateSync(raw, { level }), { Filter: 'FlateDecode' }) : d.context.stream(raw);
    page.node.set(N('Contents'), d.context.register(st));
  };
  // a photo-like picture: smooth colours and a little noise
  const photo = (W, H, comps) => { const a = new Uint8Array(W * H * comps); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < comps; c++) a[(y * W + x) * comps + c] = Math.max(0, Math.min(255, 128 + 100 * Math.sin((x * (c + 1)) / 97 + y / 61) + (rnd() - .5) * 40)); return a; };
  // a scanned page: black text-like blocks on white, 1 bit per pixel, black = 0
  const scan = (W, H) => {
    const rb = Math.ceil(W / 8), a = new Uint8Array(rb * H).fill(255);
    for (let line = 40; line < H - 60; line += 70) for (let x = 60; x < W - 120;) { const w = 20 + Math.floor(rnd() * 90); for (let yy = line; yy < line + 34; yy++) for (let xx = x; xx < Math.min(W - 60, x + w); xx++) if (rnd() > .25) a[yy * rb + (xx >> 3)] &= ~(0x80 >> (xx & 7)); x += w + 18 + Math.floor(rnd() * 20); }
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < 6; xx++) a[yy * rb + (xx >> 3)] &= ~(0x80 >> (xx & 7)); // a black edge on the left
    return a;
  };
  async function photoPdf() {
    const d = await C.PDFDocument.create(), p = d.addPage([612, 792]);
    // RGB at 600 ppi: 1200 x 1200 drawn 2 x 2 inches; PNG predictor 12 (Up)
    const rgb = addImage(d, p, { W: 1200, H: 1200, cs: 'DeviceRGB', bytes: predicted(photo(1200, 1200, 3), 1200, 1200, 3), parms: { Predictor: 12, Colors: 3, BitsPerComponent: 8, Columns: 1200 }, x: 72, y: 500, w: 144, h: 144 });
    // Indexed (16 colours, 4 bits a pixel) at 600 ppi: 600 x 600 drawn 1 x 1 inch
    const pal = Buffer.alloc(48); for (let i = 0; i < 48; i++) pal[i] = Math.floor(rnd() * 256);
    const idx = Buffer.alloc(300 * 600); for (let i = 0; i < idx.length; i++) idx[i] = Math.floor(rnd() * 256);
    const ind = addImage(d, p, { W: 600, H: 600, bpc: 4, cs: d.context.obj([N('Indexed'), N('DeviceRGB'), 15, C.PDFHexString.of(pal.toString('hex'))]), bytes: zlib.deflateSync(idx), x: 300, y: 500, w: 72, h: 72 });
    setContent(d, p, rgb.op + ind.op + 'BT /F1 12 Tf 72 400 Td (Pictures) Tj ET\n');
    p.node.Resources().set(N('Font'), d.context.obj({ F1: d.context.register(d.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' })) }));
    return Buffer.from(await d.save({ useObjectStreams: false }));
  }
  const images = (d) => d.context.enumerateIndirectObjects().filter(([, o]) => o instanceof C.PDFRawStream && String(o.dict.lookup(N('Subtype'))) === '/Image').map(([ref, o]) => ({
    ref: ref.tag, W: o.dict.lookup(N('Width')).asNumber(), H: o.dict.lookup(N('Height')).asNumber(), bpc: o.dict.lookup(N('BitsPerComponent')) ? o.dict.lookup(N('BitsPerComponent')).asNumber() : null,
    filter: String(o.dict.lookup(N('Filter')) || ''), cs: String(o.dict.lookup(N('ColorSpace')) || ''), bytes: Buffer.from(o.getContents()), dict: o.dict,
  }));
  const run = (p, bytes, opts) => p.evaluate(async ([b64, o]) => {
    const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const r = await window.__cowdreyPdf.optimizeBytes(u, o);
    let s = ''; for (let i = 0; i < r.bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, r.bytes.subarray(i, i + 0x8000));
    return { b64: btoa(s), before: r.before, after: r.after, same: r.same, reason: r.reason || null, stats: r.stats };
  }, [bytes.toString('base64'), opts]).then((r) => ({ ...r, bytes: Buffer.from(r.b64, 'base64') }));
  const pdfjs = await import(path.join(root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
  const readable = async (bytes) => { const t = pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: path.join(root, 'desktop/node_modules/pdfjs-dist/standard_fonts/') }); const d = await t.promise; const n = d.numPages; for (let i = 1; i <= n; i++) await (await d.getPage(i)).getOperatorList(); await t.destroy(); return n; };

  let optimizedA = null;
  await test('optimize: a 600 ppi predictor-Flate RGB picture and an Indexed picture get smaller at 150 dpi, at about 150 ppi', async () => {
    const p = await open();
    const src = await photoPdf();
    const r = await run(p, src, { preset: 'smaller' });
    ok(!r.same && r.after < r.before * .5, `${r.before} → ${r.after}`);
    eq(r.bytes.length, r.after);
    const d = await C.PDFDocument.load(r.bytes), im = images(d).sort((a, b) => b.W - a.W);
    eq(im.length, 2, 'two pictures');
    ok(Math.abs(im[0].W - 300) <= 2 && Math.abs(im[0].H - 300) <= 2, `RGB at ~150 ppi: ${im[0].W}x${im[0].H}`);
    ok(Math.abs(im[1].W - 150) <= 2 && Math.abs(im[1].H - 150) <= 2, `Indexed at ~150 ppi: ${im[1].W}x${im[1].H}`);
    ok(im.every((x) => x.bpc === 8), 'expanded to 8 bits');
    ok(!im.some((x) => /Indexed/.test(x.cs)), 'the palette is expanded');
    eq(await readable(r.bytes), 1, 'pdf.js reads it');
    ok(r.stats.images === 2, JSON.stringify(r.stats));
    optimizedA = r.bytes;
    eq(p.errors, []); await p.ctx.close();
  });

  await test('optimize: a black-and-white scan stays 1-bit (CCITT G4 or Flate, never JPEG) and is made 300 ppi', async () => {
    const p = await open();
    const d0 = await C.PDFDocument.create(), pg = d0.addPage([288, 288]);
    const W = 2400, H = 2400, bits = scan(W, H);
    const s = addImage(d0, pg, { W, H, bpc: 1, cs: 'DeviceGray', bytes: zlib.deflateSync(bits), x: 0, y: 0, w: 288, h: 288 });
    setContent(d0, pg, s.op);
    const src = Buffer.from(await d0.save());
    const r = await run(p, src, { preset: 'smaller' });
    ok(!r.same, 'smaller: ' + r.before + ' → ' + r.after);
    const im = images(await C.PDFDocument.load(r.bytes));
    eq(im.length, 1);
    eq(im[0].bpc, 1, 'BitsPerComponent 1');
    ok(!/DCT/.test(im[0].filter), 'never JPEG: ' + im[0].filter);
    ok(/CCITTFax|Flate/.test(im[0].filter), im[0].filter);
    eq([im[0].W, im[0].H], [1200, 1200], 'at 300 ppi');
    eq(await readable(r.bytes), 1, 'pdf.js reads it');
    // the same page drawn by pdf.js in the app: about as much black as before
    const ink = await p.evaluate(async ([a, b]) => {
      await window.__cowdreyPdf.optPdfjs();
      const lib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/pdf.min.mjs');
      const black = async (b64) => {
        const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const pd = await lib.getDocument({ data: u }).promise, page = await pd.getPage(1), vp = page.getViewport({ scale: 2 });
        const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; await page.render({ canvas: c, canvasContext: c.getContext('2d'), viewport: vp }).promise;
        const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] < 128) n++; return n / (px.length / 4);
      };
      return [await black(a), await black(b)];
    }, [src.toString('base64'), r.bytes.toString('base64')]);
    ok(Math.abs(ink[0] - ink[1]) < .03, 'ink ' + ink.map((x) => x.toFixed(3)));
    // kept as they are when asked
    const k = await run(p, src, { preset: 'smaller', mono: { mode: 'keep' } });
    const ki = images(await C.PDFDocument.load(k.bytes));
    eq([ki[0].W, ki[0].bpc], [2400, 1], 'kept');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('optimize: the G4 encoder reads back pixel for pixel in pdf.js (edges, long runs, odd widths)', async () => {
    const p = await open();
    const res = await p.evaluate(() => window.__cowdreyPdf.optG4Check());
    eq(res.filter((x) => !x.ok), [], JSON.stringify(res));
    ok(res.length >= 5);
    await p.ctx.close();
  });

  await test('optimize: two identical pictures on two pages end as one picture object', async () => {
    const p = await open();
    const d0 = await C.PDFDocument.create();
    const px = photo(100, 100, 3), bytes = predicted(px, 100, 100, 3);
    for (let k = 0; k < 2; k++) { const pg = d0.addPage([300, 300]); const s = addImage(d0, pg, { W: 100, H: 100, cs: 'DeviceRGB', bytes, parms: { Predictor: 12, Colors: 3, BitsPerComponent: 8, Columns: 100 }, x: 50, y: 50, w: 72, h: 72 }); setContent(d0, pg, s.op); }
    const src = Buffer.from(await d0.save({ useObjectStreams: false }));
    eq(images(await C.PDFDocument.load(src)).length, 2, 'two to start with');
    for (const preset of ['smaller', 'lossless']) {
      const r = await run(p, src, { preset });
      ok(!r.same, preset + ' gains');
      const d = await C.PDFDocument.load(r.bytes), im = images(d);
      eq(im.length, 1, preset + ': one picture');
      const refs = d.getPages().map((pg) => { const xo = pg.node.Resources().lookup(N('XObject')); return xo.entries().map(([, v]) => v.tag)[0]; });
      eq(refs[0], refs[1], preset + ': both pages draw it');
      eq(refs[0], im[0].ref);
      ok(r.stats.merged >= 1, JSON.stringify(r.stats));
    }
    eq(p.errors, []); await p.ctx.close();
  });

  await test('optimize: a Flate stream deflated at level 1 becomes smaller, and its decoded bytes are the same', async () => {
    const p = await open();
    const d0 = await C.PDFDocument.create(), pg = d0.addPage([612, 792]);
    let text = ''; for (let i = 0; i < 4000; i++) text += `${(i * 7) % 500} ${(i * 13) % 700} m ${(i * 11) % 500} ${(i * 3) % 700} l S\n`;
    setContent(d0, pg, text, 1);
    const src = Buffer.from(await d0.save({ useObjectStreams: false }));
    const before = zlib.deflateSync(Buffer.from(text, 'latin1'), { level: 1 }).length;
    const r = await run(p, src, { preset: 'lossless' });
    ok(!r.same, 'gains');
    const d = await C.PDFDocument.load(r.bytes), c = d.getPage(0).node.Contents();
    const st = c instanceof C.PDFArray ? d.context.lookup(c.get(0)) : c;
    ok(st.getContents().length < before, `stream ${before} → ${st.getContents().length}`);
    eq(String(st.dict.lookup(N('Filter'))), '/FlateDecode');
    ok(zlib.inflateSync(Buffer.from(st.getContents())).equals(Buffer.from(text, 'latin1')), 'the same content');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('optimize: Lossless only changes no picture bytes', async () => {
    const p = await open();
    const src = await photoPdf();
    const r = await run(p, src, { preset: 'lossless' });
    const a = images(await C.PDFDocument.load(src)), b = images(await C.PDFDocument.load(r.bytes));
    eq(b.length, a.length);
    const key = (x) => [x.W, x.H, x.bpc, x.filter, x.cs.slice(0, 12), x.bytes.toString('base64')];
    eq(b.map(key).sort(), a.map(key).sort(), 'pictures byte for byte');
    ok(r.after <= r.before, 'never bigger');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('optimize: never larger: an already optimized PDF comes back as the same bytes, and says so', async () => {
    const p = await open();
    ok(optimizedA, 'from the first test');
    for (const preset of ['smaller', 'lossless']) {
      const r = await run(p, optimizedA, { preset });
      ok(r.same, preset + ' says it kept it'); eq(r.reason, 'compact');
      ok(r.bytes.equals(optimizedA), preset + ': the same bytes');
    }
    // a file that is not a PDF is returned as it was
    const bad = await run(p, Buffer.from('not a pdf at all'), { preset: 'smaller' });
    ok(bad.same && bad.reason === 'unreadable', JSON.stringify(bad.reason));
    eq(p.errors, []); await p.ctx.close();
  });

  await test('optimize: CMYK pictures are untouched unless converting them to RGB is chosen', async () => {
    const p = await open();
    const d0 = await C.PDFDocument.create(), pg = d0.addPage([612, 792]);
    const px = photo(1200, 1200, 4);
    const s = addImage(d0, pg, { W: 1200, H: 1200, cs: 'DeviceCMYK', bytes: predicted(px, 1200, 1200, 4), parms: { Predictor: 12, Colors: 4, BitsPerComponent: 8, Columns: 1200 }, x: 72, y: 72, w: 144, h: 144 });
    setContent(d0, pg, s.op);
    const src = Buffer.from(await d0.save());
    const kept = images(await C.PDFDocument.load((await run(p, src, { preset: 'smallest' })).bytes));
    eq([kept[0].W, kept[0].H, kept[0].cs], [1200, 1200, '/DeviceCMYK'], 'kept');
    ok(unpredict(zlib.inflateSync(kept[0].bytes), 1200, 4).equals(Buffer.from(px)), 'the same CMYK samples');
    const conv = await run(p, src, { preset: 'smaller', cmyk: true });
    const ci = images(await C.PDFDocument.load(conv.bytes));
    eq([ci[0].W, ci[0].cs], [300, '/DeviceRGB'], 'converted when asked');
    ok(conv.after < conv.before * .3, `${conv.before} → ${conv.after}`);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('optimize: clean-up drops unused resources and thumbnails, keeps what is drawn; tags only when asked', async () => {
    const p = await open();
    const d0 = await C.PDFDocument.create(), pg = d0.addPage([300, 300]);
    const used = addImage(d0, pg, { W: 50, H: 50, cs: 'DeviceGray', bytes: zlib.deflateSync(Buffer.alloc(2500, 90)), x: 0, y: 0, w: 72, h: 72 });
    addImage(d0, pg, { W: 400, H: 400, cs: 'DeviceGray', bytes: zlib.deflateSync(Buffer.from(photo(400, 400, 1))), x: 0, y: 0, w: 72, h: 72 }); // in the resources, never drawn
    setContent(d0, pg, used.op);
    pg.node.set(N('Thumb'), d0.context.register(d0.context.stream(zlib.deflateSync(Buffer.from(photo(40, 40, 3))), { Width: 40, Height: 40, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode' })));
    pg.node.set(N('PieceInfo'), d0.context.obj({ Illustrator: { Private: 'x' } }));
    d0.catalog.set(N('StructTreeRoot'), d0.context.register(d0.context.obj({ Type: 'StructTreeRoot' })));
    d0.catalog.set(N('MarkInfo'), d0.context.obj({ Marked: true }));
    const src = Buffer.from(await d0.save());
    const r = await run(p, src, { preset: 'lossless' });
    const d = await C.PDFDocument.load(r.bytes), page = d.getPage(0);
    eq(page.node.Resources().lookup(N('XObject')).keys().length, 1, 'the unused picture is gone');
    eq(images(d).length, 1);
    ok(!page.node.has(N('Thumb')) && !page.node.has(N('PieceInfo')), 'thumbnail and editing data gone');
    ok(d.catalog.has(N('StructTreeRoot')), 'tags kept by default');
    const t = await run(p, src, { preset: 'lossless', clean: { tags: true } });
    ok(!(await C.PDFDocument.load(t.bytes)).catalog.has(N('StructTreeRoot')), 'tags removed when asked');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('optimize: the dialog shows the sizes, sets Optimize for saving; the saved PDF is smaller and has pictures at about 150 ppi', async () => {
    const p = await open();
    const f = path.join(root, 'tests/fixtures', '.opt-photo.pdf'); fs.writeFileSync(f, await photoPdf());
    await p.evaluate(async (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); await window.__cowdreyPdf.openBytes(u, 'Photos.pdf'); }, fs.readFileSync(f).toString('base64'));
    await p.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 15000 });
    fs.unlinkSync(f);
    // Optimize is on the Protect tab where Compress was, and in the Protect menu
    await p.click('[data-rt="protect"]');
    const doc = await p.$$eval('#ribbonBody .r-group[aria-label="Document"] [data-cmd]', (b) => b.map((x) => x.dataset.cmd));
    ok(doc.includes('optimize') && !doc.includes('protCompress'), doc.join());
    ok((await p.evaluate(() => window.__cowdreyPdf.menus().find(([t]) => t === 'Protect')[1])).includes('optimize'), 'in the menu');
    await p.click('#ribbonBody [data-cmd="optimize"]');
    await p.waitForFunction(() => /Optimized: /.test((document.querySelector('#optSize') || {}).textContent || ''), null, { timeout: 30000 });
    const t = await p.textContent('#optSize'); ok(/\d+% smaller/.test(t), t);
    eq(await p.$$eval('#dialog .dlg-foot .btn.primary', (b) => b.map((x) => x.textContent)), ['Optimize']);
    // the advanced options follow the preset
    await p.click('#dialog .opt-adv summary');
    await p.click('#dialog input[name="optPreset"][value="smallest"]');
    eq(await p.inputValue('#dialog input[name="cDpi"]'), '96');
    await p.click('#dialog input[name="optPreset"][value="smaller"]');
    await p.click('#optAuditBtn'); await p.waitForSelector('#optAudit table');
    ok(await p.$eval('#optAudit tr[data-kind="images"] td:nth-child(3)', (td) => parseInt(td.textContent) > 80), 'pictures are most of the file');
    await p.screenshot({ path: path.join(root, 'tests/fixtures', '.opt-dialog.png') }).catch(() => {});
    fs.rmSync(path.join(root, 'tests/fixtures', '.opt-dialog.png'), { force: true });
    await p.waitForFunction(() => /Optimized: /.test((document.querySelector('#optSize') || {}).textContent || ''), null, { timeout: 30000 });
    await answer(p, 'Optimize'); await p.waitForTimeout(200);
    eq(await p.evaluate(() => window.__cowdreyPdf.docMarks().filter((m) => m.type === 'optimize').map((m) => m.opts.preset)), ['smaller']);
    ok(await p.$eval('#ribbonBody [data-cmd="optimize"]', (b) => b.getAttribute('aria-pressed') === 'true'), 'pressed while set');
    const out = Buffer.from(await p.evaluate(async () => Array.from(await window.__cowdreyPdf.buildPdf())));
    const im = images(await C.PDFDocument.load(out)).sort((a, b) => b.W - a.W);
    ok(Math.abs(im[0].W - 300) <= 2, 'RGB ' + im[0].W);
    ok(out.length < fs.statSync(path.join(root, 'tests/fixtures/sample.pdf')).size * 50 && out.length < 400000, 'small: ' + out.length);
    eq(await readable(out), 1);
    // undo takes it back; Don't optimize clears it
    await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
    eq(await p.evaluate(() => window.__cowdreyPdf.docMarks().filter((m) => m.type === 'optimize').length), 0, 'undone');
    await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(100);
    await p.evaluate(() => window.__cowdreyPdf.run('optimize')); await p.waitForSelector('#dialog[open]');
    await answer(p, 'Don’t optimize'); await p.waitForTimeout(100);
    eq(await p.evaluate(() => window.__cowdreyPdf.docMarks().filter((m) => m.type === 'optimize').length), 0, 'cleared');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('optimize: saving an already compact PDF with Optimize set keeps the file as it was, and says so', async () => {
    const p = await open(); await openPdf(p);
    const orig = fs.readFileSync(path.join(root, 'tests/fixtures/sample.pdf'));
    await p.evaluate(() => window.__cowdreyPdf.run('optimize'));
    await p.waitForFunction(() => /Now /.test((document.querySelector('#optSize') || {}).textContent || ''), null, { timeout: 30000 });
    await answer(p, 'Optimize'); await p.waitForTimeout(200);
    const out = Buffer.from(await p.evaluate(async () => Array.from(await window.__cowdreyPdf.buildPdf())));
    ok(out.length <= orig.length, `never bigger: ${orig.length} → ${out.length}`);
    const last = await p.evaluate(() => window.__cowdreyPdf.optLast());
    ok(last && last.after === out.length, JSON.stringify(last));
    if (last.same) ok(out.equals(orig), 'the file as it was opened');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('optimize: pictures pdf.js has to read (ASCIIHex here) are made smaller too', async () => {
    const p = await open();
    const d0 = await C.PDFDocument.create(), pg = d0.addPage([612, 792]);
    const px = Buffer.from(photo(400, 400, 3));
    const s = addImage(d0, pg, { W: 400, H: 400, cs: 'DeviceRGB', bytes: Buffer.from(px.toString('hex') + '>'), filter: 'ASCIIHexDecode', x: 72, y: 72, w: 72, h: 72 });
    setContent(d0, pg, s.op);
    const src = Buffer.from(await d0.save());
    const r = await run(p, src, { preset: 'smaller' });
    const im = images(await C.PDFDocument.load(r.bytes));
    eq([im[0].W, im[0].H], [150, 150], 'at 150 ppi');
    ok(r.after < r.before / 10, `${r.before} → ${r.after}`);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('optimize with a password (an action): pictures shrink and the saved PDF still needs its password', async () => {
    const p = await open();
    const action = { name: 'Small and locked', steps: [{ id: 'password', opts: { useOpen: true, limit: false } }, { id: 'optimize', opts: { preset: 'smaller' } }] };
    const r = await p.evaluate(([a, l]) => window.__cowdreyPdf.batchRun(a, l, { secrets: { password: { open: 'heron', owner: '' } } }), [action, [{ name: 'Photos.pdf', b64: (await photoPdf()).toString('base64') }]]);
    eq(r.results.map((x) => x.status), ['done'], JSON.stringify(r.results));
    const buf = Buffer.from(r.zip, 'base64'), size = buf.readUInt32LE(18), nl = buf.readUInt16LE(26), xl = buf.readUInt16LE(28), out = buf.slice(30 + nl + xl, 30 + nl + xl + size);
    ok(out.length < 250000, 'smaller: ' + out.length);
    ok(r.results[0].notes.some((n) => /^Optimized: /.test(n)), r.results[0].notes.join());
    let needs = false; try { await pdfjs.getDocument({ data: new Uint8Array(out) }).promise; } catch (e) { needs = e.name === 'PasswordException'; }
    ok(needs, 'needs its password');
    const d = await C.PDFDocument.load(out, { password: 'heron' });
    const im = images(d).sort((a, b) => b.W - a.W);
    ok(Math.abs(im[0].W - 300) <= 2, 'RGB at ~150 ppi: ' + im[0].W);
    eq(p.errors, []); await p.ctx.close();
  });

  // A PDF that runs JavaScript when it opens (and is already compact: nothing else to gain).
  async function jsPdf() {
    const d = await C.PDFDocument.create(), pg = d.addPage([300, 300]), f = await d.embedFont(C.StandardFonts.Helvetica);
    pg.drawText('Script', { x: 40, y: 200, size: 18, font: f });
    d.catalog.set(N('OpenAction'), d.context.obj({ S: 'JavaScript', JS: C.PDFString.of('app.alert("hi")') }));
    return Buffer.from(await d.save({ useObjectStreams: false }));
  }
  const hasJs = (d) => d.catalog.has(N('OpenAction')) || d.context.enumerateIndirectObjects().some(([, o]) => o instanceof C.PDFDict && String(o.lookup(N('S'))) === '/JavaScript');

  await test('optimize: Remove JavaScript is done even when the PDF is already compact (optimizeBytes and the dialog)', async () => {
    const p = await open(), src = await jsPdf();
    ok(hasJs(await C.PDFDocument.load(src)), 'the test PDF has a script');
    const r = await run(p, src, { preset: 'lossless', clean: { javascript: true } });
    eq(r.same, false, 'not kept as it was');
    ok(!hasJs(await C.PDFDocument.load(r.bytes)), 'no script left');
    const plain = await run(p, src, { preset: 'lossless' });
    ok(hasJs(await C.PDFDocument.load(plain.bytes)), 'without the tick the script stays');
    // the dialog: Lossless only, Remove JavaScript ticked, then save
    await p.evaluate((b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return window.__cowdreyPdf.openBytes(u, 'Script.pdf'); }, src.toString('base64'));
    await p.waitForFunction(() => window.__cowdreyPdf.doc && document.querySelector('.page canvas.pdf'), null, { timeout: 15000 });
    await p.evaluate(() => window.__cowdreyPdf.run('optimize'));
    await p.waitForFunction(() => /Now /.test((document.querySelector('#optSize') || {}).textContent || ''), null, { timeout: 30000 });
    await p.check('#dialog [name="optPreset"][value="lossless"]');
    await p.click('#dialog .opt-adv summary'); await p.check('#dialog [name="cl_javascript"]');
    await p.waitForFunction(() => /clean-up you chose|Optimized:/.test(document.querySelector('#optSize').textContent), null, { timeout: 30000 });
    await answer(p, 'Optimize'); await p.waitForTimeout(200);
    const out = Buffer.from(await p.evaluate(async () => Array.from(await window.__cowdreyPdf.buildPdf())));
    ok(!hasJs(await C.PDFDocument.load(out)), 'the saved PDF has no script');
    const last = await p.evaluate(() => window.__cowdreyPdf.optLast());
    ok(last && !last.same, JSON.stringify(last));
    eq(p.errors, []); await p.ctx.close();
  });

  await test('optimize: Remove unused resources keeps the form’s default font (AcroForm /DR) that a field’s /DA names', async () => {
    const p = await open();
    const d = await C.PDFDocument.create(), pg = d.addPage([300, 300]), ctx = d.context;
    const fonts = ctx.register(ctx.obj({ Helv: ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' })) }));
    const ap = ctx.register(ctx.stream('/Tx BMC EMC', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 20], Resources: { Font: fonts } }));
    const w = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: C.PDFString.of('Name'), Rect: [40, 200, 240, 220], DA: C.PDFString.of('/Helv 12 Tf 0 g'), F: 4, P: pg.ref, AP: { N: ap } }));
    pg.node.set(N('Annots'), ctx.obj([w]));
    d.catalog.set(N('AcroForm'), ctx.obj({ Fields: [w], DR: { Font: fonts }, DA: C.PDFString.of('/Helv 0 Tf 0 g') }));
    const r = await run(p, Buffer.from(await d.save({ useObjectStreams: false })), { preset: 'lossless' });
    eq(r.stats && r.stats.unused, 0, 'nothing removed');
    const o = await C.PDFDocument.load(r.bytes), dr = o.catalog.lookup(N('AcroForm')).lookup(N('DR')).lookup(N('Font'));
    ok(dr.has(N('Helv')), 'Helv is still in DR');
    eq(p.errors, []); await p.ctx.close();
  });
};
