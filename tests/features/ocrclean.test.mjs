// OCR quality: the page image is cleaned up before reading (levels, which way the lines run, deskew, binarisation,
// despeckle), words map back onto the original scan, several languages per run, Check words, pages that mix typed
// text and scanned text, reading a scanned PDF as it opens, and the clean page image saved in place of the scan.
// Most tests use a stand-in recognizer; two run the real one (tesseract.js from desktop/node_modules) on the
// fixtures tests/fixtures/ocr-skew.pdf (scanned 3 degrees askew, with dust) and ocr-sideways.pdf (fed in sideways,
// no /Rotate). ocr-scans.json says where each word is on those images (in their pixels, 200 dpi).
import os from 'node:os'; import { execFileSync } from 'node:child_process';
export default async (h) => {
  const { test, eq, ok, open, require, path, root, fs, PDFDocument, savedOf, reopen } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const NM = path.join(root, 'desktop/node_modules');
  const realEngine = ['tesseract.js/dist/tesseract.min.js', 'tesseract.js/dist/worker.min.js', 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js', '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'].every((f) => fs.existsSync(path.join(NM, f)));
  const FIX = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/ocr-scans.json'), 'utf8'));
  const hasPdftotext = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

  async function openBytes(p, bytes, name = 'Scan.pdf') {
    await p.evaluate(async ([b, n]) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); await window.__cowdreyPdf.openBytes(u, n); }, [Buffer.from(bytes).toString('base64'), name]);
    await p.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 15000 }); await p.waitForTimeout(500);
  }
  // A scan made in the page: lines of text on a 200 dpi Letter image (PNG), with each word's box.
  async function makeScan(p, lines, { color = '#111', font = 'bold 54px Arial, Helvetica, sans-serif', W = 1700, H = 2200, top = 300 } = {}) {
    return p.evaluate(([lines, color, font, W, H, top]) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.fillStyle = color; x.font = font; x.textBaseline = 'alphabetic';
      const out = [];
      lines.forEach((line, k) => {
        const by = top + k * 120, words = []; let cx = 160;
        for (const w of line.split(' ')) {
          const m = x.measureText(w); x.fillText(w, cx, by);
          words.push({ text: w, bbox: { x0: cx, y0: by - m.actualBoundingBoxAscent, x1: cx + m.width, y1: by + m.actualBoundingBoxDescent }, confidence: 92 });
          cx += m.width + x.measureText(' ').width;
        }
        out.push({ baseline: { x0: 160, y0: by, x1: cx, y1: by }, words });
      });
      return { png: c.toDataURL('image/png').split(',')[1], lines: out, W, H };
    }, [lines, color, font, W, H, top]);
  }
  async function scanPdf(scans) {
    const d = await PDFDocument.create();
    for (const s of scans) { const img = await d.embedPng(Buffer.from(s.png, 'base64')); d.addPage([612, 792]).drawImage(img, { x: 0, y: 0, width: 612, height: 792 }); }
    return Buffer.from(await d.save());
  }
  // The stand-in recognizer: returns the scan's words (in the pixels of the canvas it is given) and notes its calls.
  // `edit(lines)` may change what it "reads"; with `inkOnly`, only words with ink under them are read.
  async function useFake(p, scans, { edit = null, inkOnly = false } = {}) {
    await p.evaluate(([scans, edit, inkOnly]) => {
      window.__ocr = { calls: [], started: [], stopped: 0 };
      let k = 0;
      const change = edit ? new Function('lines', edit) : null;
      window.__cowdreyPdf.ocrUseEngine({
        async start(lang) { window.__ocr.started.push(lang); },
        async recognize(canvas, { lang }) {
          const s = scans[Math.min(k++, scans.length - 1)], f = canvas.width / s.W, cx = canvas.getContext('2d');
          const box = (b) => ({ x0: b.x0 * f, y0: b.y0 * f, x1: b.x1 * f, y1: b.y1 * f });
          const inked = (b) => { const d = cx.getImageData(b.x0, b.y0, Math.max(1, b.x1 - b.x0), Math.max(1, b.y1 - b.y0)).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++; return n / (d.length / 4) > .04; };
          window.__ocr.calls.push({ w: canvas.width, h: canvas.height, lang });
          let lines = s.lines.map((l) => ({ baseline: l.baseline && { x0: l.baseline.x0 * f, y0: l.baseline.y0 * f, x1: l.baseline.x1 * f, y1: l.baseline.y1 * f }, words: l.words.map((w) => ({ ...w, bbox: box(w.bbox) })) }));
          if (inkOnly) lines = lines.map((l) => ({ ...l, words: l.words.filter((w) => inked(w.bbox)) })).filter((l) => l.words.length);
          if (change) lines = change(lines) || lines;
          return { lines };
        },
        async stop() { window.__ocr.stopped++; },
      });
    }, [scans.map((s) => ({ lines: s.lines, W: s.W })), edit, inkOnly]);
  }
  const textOfPage = (p, n = 0) => p.evaluate(async (n) => { const v = window.__cowdreyPdf.views()[n]; const tc = await v.page.getTextContent(); return tc.items.map((i) => i.str).join(' ').replace(/\s+/g, ' '); }, n);
  const itemsOfPage = (p, n = 0) => p.evaluate(async (n) => { const v = window.__cowdreyPdf.views()[n]; const tc = await v.page.getTextContent(); return tc.items.map((i) => i.str); }, n);
  const ocrDialog = async (p) => { await p.click('[data-rt="edit"]'); await p.click('[data-cmd="ocr"]'); await p.waitForSelector('#dialog[open] .ocr-dlg'); };
  const waitDone = (p) => p.waitForFunction(() => !document.querySelector('#dialog[open] .ocr-prog') && document.querySelector('#toast.show'), null, { timeout: 30000 });
  const pdfText = async (bytes) => {
    const pdfjs = await import(path.join(root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
    const pd = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
    return norm((await (await pd.getPage(1)).getTextContent()).items.map((i) => i.str).join(' '));
  };
  const pdftotext = (bytes) => { const f = path.join(os.tmpdir(), `cowdrey-ocr-${process.pid}-${Date.now()}.pdf`); fs.writeFileSync(f, bytes); try { return norm(execFileSync('pdftotext', [f, '-'], { encoding: 'utf8' })); } finally { fs.unlinkSync(f); } };
  // The page's content, decoded, and the words of the invisible layer: text, where it starts, which way it runs and
  // where the word's own letters end (Helvetica widths, the size and stretch it was set with).
  const contentOf = (d, pg) => { const c = pg.node.Contents(); return (c instanceof L.PDFArray ? c.asArray() : [c]).map((r) => { const st = d.context.lookup(r) || r; return Buffer.from(L.decodePDFRawStream(st).decode()).toString('latin1'); }).join('\n'); };
  async function layerWords(bytes) {
    const d = await PDFDocument.load(bytes), pg = d.getPage(0), raw = contentOf(d, pg);
    const helv = await (await PDFDocument.create()).embedFont(L.StandardFonts.Helvetica);
    const out = [];
    for (const m of raw.matchAll(/(-?[\d.]+) Tz\s+(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm\s+\/\S+ [\d.]+ Tf\s+<([0-9A-Fa-f]*)> Tj/g)) {
      const [tz, a, b, , , e, f] = m.slice(1, 8).map(Number), text = Buffer.from(m[8], 'hex').toString('latin1');
      const word = text.trim(), size = Math.hypot(a, b), u = [a / size, b / size], len = helv.widthOfTextAtSize(word, 1) * size * tz / 100;
      out.push({ text: word, start: [e, f], end: [e + u[0] * len, f + u[1] * len], u });
    }
    return { out, rotation: pg.getRotation().angle, raw, d, pg };
  }
  // How far a point (PDF points) is outside a quad (0 inside).
  const outside = (q, [x, y]) => {
    let inside = true;
    for (let i = 0; i < 4; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4]; if ((x2 - x1) * (y - y1) - (y2 - y1) * (x - x1) < 0) inside = false; }
    const sign = (() => { let s = 0; for (let i = 0; i < 4; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4]; s += (x2 - x1) * (y2 + y1); } return s; })();
    if (sign > 0) { inside = true; for (let i = 0; i < 4; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4]; if ((x2 - x1) * (y - y1) - (y2 - y1) * (x - x1) > 0) inside = false; } }
    if (inside) return 0;
    let best = Infinity;
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4], dx = x2 - x1, dy = y2 - y1, t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
    }
    return best;
  };
  // A fixture word's box, in PDF points (its image fills the page, y up).
  const quadPt = (fx, q, turnBack = null) => q.map(([x, y]) => { let P = [x * 72 / fx.dpi, fx.page[1] - y * 72 / fx.dpi]; if (turnBack) P = turnBack(P); return P; });
  function wordsOnBoxes(fx, words, turnBack = null) {
    const want = fx.lines.flatMap((l) => l.words), bad = [];
    let j = 0;
    for (const w of want) {
      const k = words.findIndex((x, i) => i >= j && x.text === w.text);
      if (k < 0) { bad.push(`${w.text}: not in the layer`); continue; }
      j = k + 1;
      const q = quadPt(fx, w.quad, turnBack), d0 = outside(q, words[k].start), d1 = outside(q, words[k].end);
      if (d0 > 3 || d1 > 3) bad.push(`${w.text}: ${d0.toFixed(1)} / ${d1.toFixed(1)} pt off`);
    }
    return bad;
  }
  const runReal = (p, opts) => p.evaluate((o) => { window.__cowdreyPdf.ocrUseEngine(null); return window.__cowdreyPdf.ocrRunHeadless(o); }, opts);

  /* ---- (a) the clean-up itself ---- */
  await test('OCR clean-up: a page turned 4 degrees is found to be 4 degrees off and straightened; 1-2 px specks go, letters and dots stay', async () => {
    const p = await open();
    const r = await p.evaluate(() => {
      const W = 2480, H = 3508, c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); x.fillStyle = '#efece6'; x.fillRect(0, 0, W, H);
      const words = 'invoice paper delta river morning garden quiet number seven bright window letter order yellow'.split(' ');
      x.save(); x.translate(W / 2, H / 2); x.rotate(4 * Math.PI / 180); x.translate(-W / 2, -H / 2);
      x.fillStyle = '#262626'; x.font = '44px Arial, Helvetica, sans-serif';
      for (let k = 0; k < 30; k++) { let s = ''; for (let j = 0; j < 9; j++) s += words[(k * 5 + j * j + j) % words.length] + ' '; x.fillText(s, 300 + (k % 4) * 15, 500 + k * 72); }
      x.restore();
      // specks of 1 and 2 px in the empty margin at the bottom, and a big dot (8 px) that must stay
      const specks = [];
      x.fillStyle = '#000';
      for (let k = 0; k < 400; k++) { const s = 1 + (k % 2), sx = 120 + (k * 53) % 2200, sy = 3000 + ((k * 97) % 380); x.fillRect(sx, sy, s, s); specks.push([sx, sy, s]); }
      x.fillRect(1240, 3300, 8, 8);
      const id = x.getImageData(0, 0, W, H);
      const res = window.__cowdreyPdf.ocrClean(id, {});
      // where a source point is on the result: the inverse of res.map
      const [a, b, cc, d, e, f] = res.map, det = a * d - b * cc;
      const toOut = (sx, sy) => [((sx - e) * d - (sy - f) * cc) / det, ((sy - f) * a - (sx - e) * b) / det];
      const px = res.imageData.data, ink = (X, Y) => { X = Math.round(X); Y = Math.round(Y); return X >= 0 && Y >= 0 && X < res.width && Y < res.height && px[(Y * res.width + X) * 4] < 128; };
      let speckLeft = 0;
      for (const [sx, sy, s] of specks) { const [ox, oy] = toOut(sx + s / 2, sy + s / 2); for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (ink(ox + dx, oy + dy)) { speckLeft++; dy = dx = 9; } }
      const [dx0, dy0] = toOut(1244, 3304); let dot = 0; for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) if (ink(dx0 + xx, dy0 + yy)) dot++;
      // the text is straight now: the ink of the lines falls into rows
      let inkAll = 0; for (let i = 0; i < px.length; i += 4) if (px[i] < 128) inkAll++;
      // the source corner of a known line start, through the map, lands on ink after cleaning
      // (timed warm, as on the second and later pages of a run: the best of six, since the first few runs also compile
      // the code)
      let again, ms = Infinity; for (let k = 0; k < 6; k++) { const t0 = performance.now(); again = window.__cowdreyPdf.ocrClean(id, {}); ms = Math.min(ms, performance.now() - t0); }
      const otsu = window.__cowdreyPdf.ocrClean(id, { binarize: 'otsu' });
      return { angle: res.angle, turn: res.turn, w: res.width, h: res.height, speckLeft, specks: specks.length, dot, inkAll, ms, again: again.angle, otsu: otsu.angle, mode: res.mode };
    });
    ok(Math.abs(r.angle - 4) <= .3, 'angle found: ' + r.angle);
    eq([r.turn, r.w, r.h, r.mode], [0, 2480, 3508, 'bw'], 'same size, no quarter turn');
    eq(r.speckLeft, 0, `specks left of ${r.specks}`);
    ok(r.dot >= 30, 'the 8 px dot stays: ' + r.dot);
    ok(r.inkAll > 100000, 'the letters stay: ' + r.inkAll);
    eq([r.again, r.otsu], [r.angle, r.angle], 'the same answer each time, and with Otsu');
    console.log(`      (clean-up of an A4 page at 300 dpi: ${Math.round(r.ms)} ms here)`);
    ok(r.ms < 300, 'under 300 ms a page: ' + Math.round(r.ms) + ' ms');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('OCR clean-up: lines running up the page are turned a quarter turn; the map takes clean pixels back to the scan; it runs in a worker too', async () => {
    const p = await open();
    const r = await p.evaluate(async () => {
      const W = 1700, H = 2200, c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
      const words = 'north south harbour lantern copper silver meadow pencil ladder button marble castle'.split(' ');
      x.save(); x.translate(0, H); x.rotate(-Math.PI / 2); // text running up the page
      x.fillStyle = '#111'; x.font = '40px Arial, Helvetica, sans-serif';
      for (let k = 0; k < 14; k++) { let s = ''; for (let j = 0; j < 7; j++) s += words[(k * 3 + j * j + 2 * j) % words.length] + ' '; x.fillText(s, 200, 200 + k * 90); }
      x.restore();
      x.fillStyle = '#000'; x.fillRect(100, 300, 30, 30); // a marked square, to follow through the map
      const id = x.getImageData(0, 0, W, H);
      const res = window.__cowdreyPdf.ocrClean(id, { orient: true });
      const viaWorker = await window.__cowdreyPdf.ocrCleanAsync(id, { orient: true });
      // the clean pixel the map sends to the middle of the square is ink
      const [a, b, cc, d, e, f] = res.map, det = a * d - b * cc, sx = 115, sy = 315;
      const ox = Math.round(((sx - e) * d - (sy - f) * cc) / det), oy = Math.round(((sy - f) * a - (sx - e) * b) / det);
      const on = res.imageData.data[(oy * res.width + ox) * 4] < 128;
      return { turn: res.turn, w: res.width, h: res.height, on, worker: [viaWorker.turn, viaWorker.width, viaWorker.height, viaWorker.angle === res.angle] };
    });
    eq([r.turn, r.w, r.h], [90, 2200, 1700], 'turned a quarter turn');
    ok(r.on, 'the map lands on the marked square');
    eq(r.worker, [90, 2200, 1700, true], 'the same in the worker');
    eq(p.errors, []); await p.ctx.close();
  });

  /* ---- (b) and (c): the real text reader on the fixtures ---- */
  await test('OCR (real engine): a page scanned 3 degrees askew, image kept, reads as the sentences, each word on its slanted box in the scan', async () => {
    if (!realEngine) { console.log('      SKIP: tesseract.js is not in desktop/node_modules (run: cd desktop && npm ci)'); return; }
    const p = await open();
    const fx = FIX['ocr-skew'];
    await openBytes(p, fs.readFileSync(path.join(root, 'tests/fixtures/ocr-skew.pdf')), 'Askew.pdf');
    const r = await runReal(p, { pages: [0], lang: 'eng' });
    ok(r.pages === 1 && r.words >= 20, 'read: ' + JSON.stringify(r));
    const out = await savedOf(p);
    const t = await pdfText(out);
    for (const l of fx.lines) ok(t.includes(l.text), `pdf.js finds "${l.text}" in: ${t}`);
    // (pdftotext puts lines of slanted text together by height, so it mixes them up: the test with the straightened
    // page image below checks it)
    const { out: words, rotation } = await layerWords(out);
    eq(rotation, 0, 'not turned');
    const bad = wordsOnBoxes(fx, words);
    eq(bad, [], 'each word lies on its box (within 3 pt)');
    // the words slope with the scan (3 degrees clockwise as seen: down to the right, so y falls in PDF terms)
    const slope = Math.atan2(-words[0].u[1], words[0].u[0]) * 180 / Math.PI;
    ok(Math.abs(slope - 3) < .6, 'the text runs along the slanted lines: ' + slope.toFixed(2));
    await reopen(p, out);
    await p.keyboard.press('Control+f'); await p.fill('#findInput', 'lazy pelican'); await p.waitForTimeout(700);
    eq(await p.textContent('#findCount'), '1 of 1', 'found');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('OCR (real engine): a page scanned sideways (no /Rotate) is found, turned to read upright, and its text reads correctly', async () => {
    if (!realEngine) { console.log('      SKIP: tesseract.js is not in desktop/node_modules (run: cd desktop && npm ci)'); return; }
    const p = await open();
    const fx = FIX['ocr-sideways'];
    await openBytes(p, fs.readFileSync(path.join(root, 'tests/fixtures/ocr-sideways.pdf')), 'Sideways.pdf');
    const r = await runReal(p, { pages: [0], lang: 'eng' });
    ok(r.pages === 1 && r.turned === 1 && r.words >= 20, 'read and turned: ' + JSON.stringify(r));
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages[0].rot), 90, 'the page is turned a quarter turn clockwise to read');
    const out = await savedOf(p);
    const t = await pdfText(out);
    for (const l of fx.lines) ok(t.includes(l.text), `pdf.js finds "${l.text}" in: ${t}`);
    if (hasPdftotext) { const pt = pdftotext(out); for (const l of fx.lines) ok(pt.includes(l.text), `pdftotext finds "${l.text}" in: ${pt}`); }
    const { out: words, rotation } = await layerWords(out);
    eq(rotation, 90, 'saved with /Rotate 90');
    eq(wordsOnBoxes(fx, words), [], 'each word lies on its box (within 3 pt)');
    ok(words.every((w) => Math.abs(w.u[0]) < .05 && w.u[1] > .99), 'the text runs up the unturned page, as the scan does');
    // undo puts the page back as it was
    await p.evaluate(() => window.__cowdreyPdf.run('undo')); await p.waitForTimeout(600);
    eq(await p.evaluate(() => [window.__cowdreyPdf.doc.pages[0].rot, window.__cowdreyPdf.doc.pages[0].src]), [0, 0], 'undo');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('OCR (real engine): a page scanned 3 degrees askew, read with its image straightened and cleaned, reads as the sentences (pdf.js, pdftotext); each word on its box; saved as 1-bit', async () => {
    if (!realEngine) { console.log('      SKIP: tesseract.js is not in desktop/node_modules (run: cd desktop && npm ci)'); return; }
    const p = await open();
    const fx = FIX['ocr-skew'];
    await openBytes(p, fs.readFileSync(path.join(root, 'tests/fixtures/ocr-skew.pdf')), 'Askew.pdf');
    const r = await runReal(p, { pages: [0], lang: 'eng', clean: true });
    eq([r.pages, r.replaced], [1, 1], 'the image replaced');
    const out = await savedOf(p);
    const { out: words, d, pg } = await layerWords(out);
    const xo = pg.node.Resources().lookup(L.PDFName.of('XObject')), imgs = xo.entries().map(([, ref]) => d.context.lookup(ref));
    eq(imgs.length, 1, 'one image on the page');
    const im = imgs[0].dict, get = (k) => String(im.get(L.PDFName.of(k)));
    eq([get('Subtype'), get('BitsPerComponent'), get('ColorSpace'), get('Filter'), get('Width'), get('Height')], ['/Image', '1', '/DeviceGray', '/FlateDecode', '2550', '3300'], '1-bit Flate at 300 dpi');
    ok(out.length < 400000, 'small: ' + out.length);
    const t = await pdfText(out);
    for (const l of fx.lines) ok(t.includes(l.text), `pdf.js finds "${l.text}" in: ${t}`);
    if (hasPdftotext) { const pt = pdftotext(out); for (const l of fx.lines) ok(pt.includes(l.text), `pdftotext finds "${l.text}" in: ${pt}`); }
    else console.log('      (pdftotext is not installed: checked with pdf.js only)');
    // the words now run straight across, on the straightened image: the fixture's boxes turned back by 3 degrees
    ok(words.every((w) => Math.abs(w.u[1]) < .02), 'straight lines of text');
    // (clockwise as seen is a negative angle with y up: turning it back is a positive one)
    const a = fx.skew * Math.PI / 180, [cx, cy] = [fx.page[0] / 2, fx.page[1] / 2];
    const back = ([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)];
    eq(wordsOnBoxes(fx, words, back), [], 'each word lies on its straightened box (within 3 pt)');
    // the straight image really is straight: render the saved page and find no slant left
    await reopen(p, out);
    const left = await p.evaluate(async () => {
      const v = window.__cowdreyPdf.views()[0], c = v.el.querySelector('canvas.pdf'), id = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      return window.__cowdreyPdf.ocrClean(id, {}).angle;
    });
    ok(Math.abs(left) < .3, 'no slant left in the saved image: ' + left);
    eq(p.errors, []); await p.ctx.close();
  });

  /* ---- (d) several languages ---- */
  await test('OCR: up to three languages are read together ("eng+fra"); the dialog says what a first use downloads', async () => {
    const p = await open();
    const scan = await makeScan(p, ['Bonjour le monde', 'Hello world']);
    await openBytes(p, await scanPdf([scan]));
    await useFake(p, [scan]);
    await ocrDialog(p);
    ok(await p.isHidden('#ocrSize'), 'English alone: nothing to download');
    await p.selectOption('#ocrLang2', 'fra');
    await p.waitForFunction(() => !document.querySelector('#ocrSize').hidden);
    eq(await p.textContent('#ocrSize'), 'French: 691 KB, downloaded once.');
    await p.selectOption('#ocrLang3', 'deu');
    await p.waitForFunction(() => /German/.test(document.querySelector('#ocrSize').textContent));
    eq(await p.textContent('#ocrSize'), 'French: 691 KB, German: 1.3 MB, downloaded once.');
    await p.selectOption('#ocrLang3', '');
    await p.click('#dialog .btn.primary'); await waitDone(p);
    eq(await p.evaluate(() => [window.__ocr.started, window.__ocr.calls.map((c) => c.lang)]), [['eng+fra'], ['eng+fra']], 'eng+fra given to the engine');
    // remembered
    await ocrDialog(p);
    eq([await p.inputValue('#ocrLang'), await p.inputValue('#ocrLang2'), await p.inputValue('#ocrLang3')], ['eng', 'fra', '']);
    await p.click('#dialog .dlg-foot button:has-text("Cancel")');
    // no more than three, and no unknown codes, without the dialog too
    await useFake(p, [scan]);
    await p.evaluate(() => window.__cowdreyPdf.ocrRunHeadless({ pages: [0], lang: 'deu+xyz+spa+ita+fra', redo: true }));
    eq(await p.evaluate(() => window.__ocr.started), ['deu+spa+ita']);
    eq(p.errors, []); await p.ctx.close();
  });

  // A language used for the first time, with the real engine. Its data is served at its jsDelivr address from the
  // English data under the new name (only English is in desktop/node_modules): it reads English, but is loaded as
  // "fra". `bad` serves it cut short, as a download that went wrong.
  async function serveFra(p, state) {
    const gz = fs.readFileSync(path.join(NM, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'));
    await p.ctx.route(/\/npm\/@tesseract\.js-data\/fra@1\.0\.0\/4\.0\.0_best_int\/fra\.traineddata\.gz$/, (r) => {
      state.hits++;
      return r.fulfill({ body: state.bad ? gz.subarray(0, 4000) : gz, contentType: 'application/gzip', headers: { 'access-control-allow-origin': '*' } });
    });
  }
  // (a run that has not ended after 90 s is reported as hung, rather than holding up the tests)
  const runRealOrHang = (p, opts) => p.evaluate((o) => { window.__cowdreyPdf.ocrUseEngine(null); return Promise.race([window.__cowdreyPdf.ocrRunHeadless(o), new Promise((r) => setTimeout(() => r({ hung: true }), 90000))]); }, opts);
  const kept = (p, code) => p.evaluate((code) => new Promise((res) => { const r = indexedDB.open('keyval-store'); r.onerror = () => res(null); r.onupgradeneeded = () => { try { r.result.createObjectStore('keyval'); } catch {} }; r.onsuccess = () => { const d = r.result; try { const q = d.transaction('keyval').objectStore('keyval').count(`./${code}.traineddata`); q.onsuccess = () => { res(q.result > 0); d.close(); }; } catch { res(false); d.close(); } }; }), code);
  await test('OCR (real engine): a language used for the first time is downloaded once and read with, alone and with English; a bad download fails clearly and is not kept', async () => {
    if (!realEngine) { console.log('      SKIP: tesseract.js is not in desktop/node_modules (run: cd desktop && npm ci)'); return; }
    const p = await open(), logs = [], st = { hits: 0, bad: true };
    p.on('console', (m) => logs.push(m.text()));
    await serveFra(p, st);
    const fx = FIX['ocr-skew'];
    await openBytes(p, fs.readFileSync(path.join(root, 'tests/fixtures/ocr-skew.pdf')), 'Askew.pdf');
    // a download that went wrong: the run ends, says it could not start, and the data is not kept
    let r = await runRealOrHang(p, { pages: [0], lang: 'eng+fra' });
    eq([r.hung, r.failed, r.pages], [undefined, true, 0], 'a bad download fails: ' + JSON.stringify(r));
    eq(await kept(p, 'fra'), false, 'the bad data is not kept');
    // French alone, the first time (it used to wait for ever on "Getting the text reader ready…")
    st.bad = false; st.hits = 0;
    r = await runRealOrHang(p, { pages: [0], lang: 'fra' });
    ok(!r.hung && r.pages === 1 && r.words >= 20, 'read with French alone: ' + JSON.stringify(r));
    eq(st.hits, 1, 'downloaded once');
    eq(await kept(p, 'fra'), true, 'kept for next time');
    const t = await pdfText(await savedOf(p));
    ok(t.includes(fx.lines[0].text), 'read: ' + t);
    // English and French together: nothing downloaded again, and the French data is loaded (no failure to load it)
    r = await runRealOrHang(p, { pages: [0], lang: 'eng+fra', redo: true });
    ok(!r.hung && r.pages === 1 && r.words >= 20, 'read with English and French: ' + JSON.stringify(r));
    eq(st.hits, 1, 'not downloaded again');
    eq(logs.filter((l) => /Failed loading language|couldn't load any languages|initialization failed/i.test(l)), [], 'every language loaded');
    eq(p.errors.filter((e) => !/Failed to load resource/.test(e)), []); await p.ctx.close();
  });
  await test('OCR (real engine): a new language is read with even where it cannot be kept on the device', async () => {
    if (!realEngine) { console.log('      SKIP: tesseract.js is not in desktop/node_modules (run: cd desktop && npm ci)'); return; }
    const p = await open(), logs = [], st = { hits: 0, bad: false };
    p.on('console', (m) => logs.push(m.text()));
    await serveFra(p, st);
    await openBytes(p, fs.readFileSync(path.join(root, 'tests/fixtures/ocr-skew.pdf')), 'Askew.pdf');
    await p.evaluate(() => { window.__cowdreyPdf.ocrPaths.noCache = true; });
    let r = await runRealOrHang(p, { pages: [0], lang: 'fra' });
    ok(!r.hung && r.pages === 1 && r.words >= 20, 'French alone: ' + JSON.stringify(r));
    r = await runRealOrHang(p, { pages: [0], lang: 'eng+fra', redo: true });
    ok(!r.hung && r.pages === 1 && r.words >= 20, 'English and French: ' + JSON.stringify(r));
    eq([st.hits, await kept(p, 'fra')], [2, false], 'fetched each run, not kept');
    eq(logs.filter((l) => /Failed loading language|couldn't load any languages|initialization failed/i.test(l)), [], 'every language loaded');
    eq(p.errors.filter((e) => !/Failed to load resource/.test(e)), []); await p.ctx.close();
  });
  await test('OCR: Cancel while the text reader is getting ready ends the run at once; text can be recognized again', async () => {
    const p = await open();
    const scan = await makeScan(p, ['Hello world']);
    await openBytes(p, await scanPdf([scan]));
    // a reader that never gets ready (as a language that never loads)
    await p.evaluate(() => { window.__stops = 0; window.__cowdreyPdf.ocrUseEngine({ start: () => new Promise(() => {}), async recognize() { return { lines: [] }; }, async stop() { window.__stops++; } }); });
    const run = p.evaluate(() => window.__cowdreyPdf.ocrRun({ pages: [0] }));
    await p.waitForFunction(() => /Getting the text reader ready/.test((document.querySelector('#dialog[open] .ocr-status') || {}).textContent || ''));
    await p.click('#dialog .dlg-foot button:has-text("Cancel")');
    const r = await Promise.race([run, new Promise((res) => setTimeout(() => res('still running'), 5000))]);
    ok(r && r.cancelled, 'the run ended as cancelled: ' + JSON.stringify(r));
    ok(await p.evaluate(() => window.__stops) >= 1, 'the reader was stopped');
    ok(/Text recognition stopped/.test(await p.textContent('#toast')), await p.textContent('#toast'));
    await useFake(p, [scan]);
    const again = await p.evaluate(() => window.__cowdreyPdf.ocrRunHeadless({ pages: [0] }));
    ok(!again.busy && again.pages === 1 && again.words === 2, 'runs again: ' + JSON.stringify(again));
    eq(p.errors, []); await p.ctx.close();
  });

  /* ---- (e) Check words ---- */
  await test('OCR: words the reader was unsure of are listed in Check words with a close-up; one put right is saved; next, previous, accept all; undo', async () => {
    const p = await open();
    const scan = await makeScan(p, ['The quick brown fox jumps', 'over the lazy Pelican today']);
    await openBytes(p, await scanPdf([scan]));
    // the reader is unsure of "Pelican" (read as "Pe1ican"), of "lazy" (read as "lazv"), and lost on "today"
    await useFake(p, [scan], { edit: `const l = lines[1].words; l[2] = { ...l[2], text: 'lazv', confidence: 52 }; l[3] = { ...l[3], text: 'Pe1ican', confidence: 41 }; l[4] = { ...l[4], text: 't0d@y', confidence: 9 }; return lines;` });
    const r = await p.evaluate(() => window.__cowdreyPdf.ocrRun({ pages: [0] }));
    eq(r.check, 2, 'two words to check');
    ok(/2 words to check/.test(await p.textContent('#toast')), await p.textContent('#toast'));
    ok(await p.isVisible('.side-tabs [data-side="ocrwords"]'), 'the Check words tab shows');
    eq(new Set(await p.$$eval('.side-tabs [data-side]', (l) => l.map((b) => Math.round(b.getBoundingClientRect().top)))).size, 1, 'the tabs still sit in one row');
    await p.click('#toast .toast-act'); // "Check words"
    await p.waitForSelector('#sidePanel .ocrw-item');
    eq(await p.$$eval('#sidePanel .ocrw-item input', (l) => l.map((i) => i.value)), ['lazv', 'Pe1ican']);
    eq(await p.textContent('#sidePanel .ocrw-count'), '2 words to check');
    const crops = await p.$$eval('#sidePanel .ocrw-pic img', (l) => l.map((i) => [i.src.slice(0, 22), i.naturalWidth > 20, i.naturalHeight > 10]));
    eq(crops, [['data:image/png;base64,', true, true], ['data:image/png;base64,', true, true]], 'a close-up of each word');
    ok(!(await textOfPage(p)).includes('t0d@y'), 'the word under 20% is left out');
    // next and previous
    await p.click('[data-ocrw-next]'); eq(await p.evaluate(() => document.activeElement.value), 'lazv');
    await p.click('[data-ocrw-next]'); eq(await p.evaluate(() => document.activeElement.value), 'Pe1ican');
    ok(await p.$('.page .ocrw-flash'), 'the word is shown on the page');
    await p.click('[data-ocrw-prev]'); eq(await p.evaluate(() => document.activeElement.value), 'lazv');
    await p.click('[data-ocrw-next]');
    // put right
    await p.fill('[data-ocrw-in="1"]', 'Pelican'); await p.press('[data-ocrw-in="1"]', 'Enter');
    await p.waitForFunction(() => document.querySelectorAll('#sidePanel .ocrw-item').length === 1);
    ok(/Changed to “Pelican”/.test(await p.textContent('#toast')), await p.textContent('#toast'));
    await p.waitForSelector('.page[data-n="0"] .textLayer span');
    ok((await textOfPage(p)).includes('lazv Pelican'), 'rewritten in the layer: ' + await textOfPage(p));
    let saved = await savedOf(p);
    let t = await pdfText(saved);
    ok(t.includes('Pelican') && !t.includes('Pe1ican'), 'the saved PDF has "Pelican": ' + t);
    // undo brings back the guess and its entry; redo the fix
    await p.evaluate(() => window.__cowdreyPdf.run('undo')); await p.waitForTimeout(700);
    eq(await p.evaluate(() => window.__cowdreyPdf.ocrWords().map((w) => w.text)), ['lazv', 'Pe1ican'], 'undo');
    ok((await textOfPage(p)).includes('Pe1ican'));
    await p.evaluate(() => window.__cowdreyPdf.run('redo')); await p.waitForTimeout(700);
    eq(await p.evaluate(() => window.__cowdreyPdf.ocrWords().map((w) => w.text)), ['lazv'], 'redo');
    // accept all: the list is done, the tab goes, the word stays as read
    await p.waitForSelector('#sidePanel [data-ocrw-all]');
    await p.click('#sidePanel [data-ocrw-all]');
    ok(/1 word accepted/.test(await p.textContent('#toast')), await p.textContent('#toast'));
    await p.waitForFunction(() => !document.querySelector('.side-tabs [data-side="ocrwords"]'));
    saved = await savedOf(p); t = await pdfText(saved);
    ok(t.includes('lazv Pelican today') === false && t.includes('lazv Pelican'), t);
    eq((await PDFDocument.load(saved)).getPageCount(), 1);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('OCR: a second run keeps the first run\'s words in Check words; one put right later keeps the other page as it was', async () => {
    const p = await open();
    const a = await makeScan(p, ['Hello Pelican']), b = await makeScan(p, ['Hello World']);
    await openBytes(p, await scanPdf([a, b]));
    const unsure = `const l = lines[0].words; l[1] = { ...l[1], text: l[1].text.replace('l', '1'), confidence: 40 }; return lines;`;
    await useFake(p, [a], { edit: unsure });
    await p.evaluate(() => window.__cowdreyPdf.ocrRunHeadless({ pages: [0] }));
    eq(await p.evaluate(() => window.__cowdreyPdf.ocrWords().map((w) => [w.text, w.page])), [['Pe1ican', 0]]);
    await useFake(p, [b], { edit: unsure });
    await p.evaluate(() => window.__cowdreyPdf.ocrRunHeadless({ pages: [1] }));
    eq(await p.evaluate(() => window.__cowdreyPdf.ocrWords().map((w) => [w.text, w.page])), [['Pe1ican', 0], ['Wor1d', 1]], 'both runs\' words are listed');
    // the first run's word put right: page 1 has it once, page 2 keeps its own words
    await p.evaluate(() => window.__cowdreyPdf.run('ocr_words'));
    await p.waitForSelector('#sidePanel .ocrw-item');
    await p.fill('[data-ocrw-in="0"]', 'Pelican'); await p.press('[data-ocrw-in="0"]', 'Enter');
    await p.waitForFunction(() => document.querySelectorAll('#sidePanel .ocrw-item').length === 1);
    eq(await p.evaluate(() => window.__cowdreyPdf.ocrWords().map((w) => w.text)), ['Wor1d']);
    eq([await itemsOfPage(p, 0), await itemsOfPage(p, 1)].map((l) => norm(l.join(' '))), ['Hello Pelican', 'Hello Wor1d'], 'each page\'s words once');
    // and undo brings the first run's guess back to the list
    await p.evaluate(() => window.__cowdreyPdf.run('undo')); await p.waitForTimeout(700);
    eq(await p.evaluate(() => window.__cowdreyPdf.ocrWords().map((w) => w.text)), ['Pe1ican', 'Wor1d'], 'undo');
    eq(p.errors, []); await p.ctx.close();
  });

  /* ---- (f) a page with typed text and scanned text ---- */
  await test('OCR: a page with typed text and a scanned line, read with "Also pages that already have text", has each typed word once', async () => {
    const p = await open();
    // the scanned line is a picture on the page; the typed line is real text above it
    const pic = await makeScan(p, ['Scanned words appear here'], { W: 1400, H: 160, top: 110 });
    const d = await PDFDocument.create(), pg = d.addPage([612, 792]), helv = await d.embedFont(L.StandardFonts.Helvetica);
    pg.drawText('Typed letters stay single', { x: 72, y: 700, size: 22, font: helv });
    const img = await d.embedPng(Buffer.from(pic.png, 'base64'));
    pg.drawImage(img, { x: 54, y: 560, width: 1400 * 72 / 200, height: 160 * 72 / 200 });
    const bytes = Buffer.from(await d.save());
    await openBytes(p, bytes, 'Mixed.pdf');
    // the stand-in "reads" both lines wherever there is ink: the typed words' boxes and the picture's, in a page image
    // of 1700 x 2200 (200 dpi Letter), so it would read the typed words again unless they are covered first
    const k = 200 / 72, typed = [], words = 'Typed letters stay single'.split(' ');
    let x = 72;
    for (const w of words) { const wd = helv.widthOfTextAtSize(w, 22); typed.push({ text: w, confidence: 95, bbox: { x0: x * k, y0: (792 - 700 - 16) * k, x1: (x + wd) * k, y1: (792 - 700 + 4) * k } }); x += wd + helv.widthOfTextAtSize(' ', 22); }
    const f = 72 / 200, ox = 54, oy = 792 - 560 - 160 * f; // the picture's top left on the page, in points
    const scanned = pic.lines.map((l) => ({ baseline: { x0: (ox + l.baseline.x0 * f) * k, y0: (oy + l.baseline.y0 * f) * k, x1: (ox + l.baseline.x1 * f) * k, y1: (oy + l.baseline.y1 * f) * k }, words: l.words.map((w) => ({ ...w, bbox: { x0: (ox + w.bbox.x0 * f) * k, y0: (oy + w.bbox.y0 * f) * k, x1: (ox + w.bbox.x1 * f) * k, y1: (oy + w.bbox.y1 * f) * k } })) }));
    const all = { W: 1700, lines: [{ words: typed }, ...scanned] };
    await useFake(p, [all], { inkOnly: true });
    await p.click('[data-rt="edit"]'); await p.click('[data-cmd="ocr"]'); await p.waitForSelector('#dialog[open] .ocr-dlg');
    await p.click('#dialog .btn.primary'); await p.waitForTimeout(600);
    ok(/already has text/.test(await p.textContent('#toast')), 'skipped without the tick');
    await ocrDialog(p); await p.check('#ocrRedo'); await p.click('#dialog .btn.primary'); await waitDone(p);
    const items = await itemsOfPage(p), t = norm(items.join(' '));
    for (const w of words) eq(items.filter((s) => s.split(/\s+/).includes(w)).length, 1, `"${w}" once in ${JSON.stringify(items)}`);
    ok(t.includes('Scanned words appear here'), 'the scanned line is read: ' + t);
    await p.keyboard.press('Control+f'); await p.fill('#findInput', 'stay single'); await p.waitForTimeout(700);
    eq(await p.textContent('#findCount'), '1 of 1', 'Find shows one hit');
    await p.keyboard.press('Escape');
    const saved = await savedOf(p), st = await pdfText(saved);
    eq(st.split('Typed letters stay single').length - 1, 1, 'once in the saved PDF: ' + st);
    ok(st.includes('Scanned words appear here'), st);
    // recognizing again does not double the scanned words either
    await useFake(p, [all], { inkOnly: true });
    await p.evaluate(() => window.__cowdreyPdf.ocrRun({ pages: [0], redo: true }));
    const again = norm((await itemsOfPage(p)).join(' '));
    eq([again.split('Scanned').length - 1, again.split('Typed').length - 1], [1, 1], 'still once each: ' + again);
    eq(p.errors, []); await p.ctx.close();
  });

  /* ---- (g) reading a scanned PDF as it opens ---- */
  await test('OCR: "Recognize text when a scanned PDF opens" reads a scan as it opens; off, it only offers to', async () => {
    const p = await open();
    const scan = await makeScan(p, ['Opened and read at once', 'with no button pressed']);
    const bytes = await scanPdf([scan]);
    await useFake(p, [scan]);
    await openBytes(p, bytes);
    ok(await p.isVisible('#ocrHint'), 'off: the hint shows');
    eq(await p.evaluate(() => window.__ocr.calls.length), 0, 'nothing read');
    // turned on in the dialog (and kept)
    await ocrDialog(p); await p.check('#ocrOnOpen'); await p.click('#dialog .dlg-foot button:has-text("Cancel")');
    eq(await p.evaluate(() => window.__cowdreyPdf.ocrPrefs().onOpen), false, 'Cancel keeps nothing');
    await ocrDialog(p); await p.check('#ocrOnOpen'); await p.click('#dialog .btn.primary'); await waitDone(p);
    eq(await p.evaluate(() => [window.__cowdreyPdf.ocrPrefs().onOpen, JSON.parse(localStorage.getItem('cowdrey.pdf:ocr')).onOpen]), [true, true], 'kept');
    await useFake(p, [scan]);
    await openBytes(p, bytes, 'Second scan.pdf');
    await p.waitForFunction(() => window.__ocr.calls.length === 1 && !document.querySelector('#dialog[open] .ocr-prog'), null, { timeout: 20000 });
    await p.waitForSelector('.page[data-n="0"] .textLayer span');
    ok((await textOfPage(p)).includes('Opened and read at once'), 'read as it opened');
    ok(!(await p.isVisible('#ocrHint')), 'no hint');
    // a PDF with text is left alone
    await useFake(p, [scan]);
    await reopen(p, await savedOf(p)); await p.waitForTimeout(500);
    eq(await p.evaluate(() => window.__ocr.calls.length), 0, 'a PDF with text is not read again');
    eq(p.errors, []); await p.ctx.close();
  });

  /* ---- more ---- */
  await test('OCR: a colour scan is kept in colour (JPEG) when its image is cleaned; undo brings the original image back', async () => {
    const p = await open();
    const scan = await makeScan(p, ['Red letters on white paper', 'second line of colour'], { color: '#c0392b' });
    await openBytes(p, await scanPdf([scan]));
    await useFake(p, [scan]);
    const r = await p.evaluate(() => window.__cowdreyPdf.ocrRunHeadless({ pages: [0], clean: true }));
    eq([r.pages, r.replaced, r.words > 5], [1, 1, true], JSON.stringify(r));
    eq(await p.evaluate(() => document.querySelector('#dialog[open]')), null, 'no dialog');
    const imageOf = async (bytes) => { const d = await PDFDocument.load(bytes), xo = d.getPage(0).node.Resources().lookup(L.PDFName.of('XObject')); return xo.entries().map(([, ref]) => { const im = d.context.lookup(ref).dict; return [String(im.get(L.PDFName.of('Filter'))), String(im.get(L.PDFName.of('ColorSpace')))]; }); };
    eq(await imageOf(await savedOf(p)), [['/DCTDecode', '/DeviceRGB']], 'a colour JPEG');
    ok((await pdfText(await savedOf(p))).includes('Red letters on white paper'));
    await p.evaluate(() => window.__cowdreyPdf.run('undo')); await p.waitForTimeout(600);
    eq(await imageOf(await savedOf(p)), [['/FlateDecode', '/DeviceRGB']], 'the original PNG again');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('OCR: the dialog has the new choices; "Turn pages upright" is on and "Also straighten and clean the page image" off at first', async () => {
    const p = await open();
    const scan = await makeScan(p, ['Just a line']);
    await openBytes(p, await scanPdf([scan]));
    await ocrDialog(p);
    eq([await p.isChecked('#ocrOrient'), await p.isChecked('#ocrClean'), await p.isChecked('#ocrOnOpen'), await p.isChecked('#ocrRedo')], [true, false, false, false]);
    for (const id of ['#ocrOrient', '#ocrClean', '#ocrOnOpen']) ok(await p.isVisible(id), id);
    await p.click('#dialog .dlg-foot button:has-text("Cancel")');
    eq(p.errors, []); await p.ctx.close();
  });
};
