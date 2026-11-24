// Text written in embedded fonts (src/features/05-fonts.js) is DRAWN right, not only read back right: each saved page
// is drawn by pdf.js and by poppler (pdftoppm, when it is installed) and compared, letter area by letter area, with
// the same words drawn from the whole font file. Each embedded font program is checked too: every glyph in it is
// read, and its outline is the one the whole font has for that letter (fontTools checks it too, when installed).
// Covers every caller: Add text (10-text.js), Edit PDF (app.js), headers (40-page-design.js), form fields
// (72-forms-design.js) and an edit of OCR text (90-ocr.js); Latin, Greek, Cyrillic, Chinese, Hindi and Thai.
import os from 'node:os';
import { execFileSync } from 'node:child_process';

export default async (h) => {
  const { test, eq, ok, open, openPdf, savedOf, at, path, fs, require, root } = h;
  const NM = path.join(root, 'desktop/node_modules');
  const L = require(path.join(NM, 'pdf-lib'));
  const fontkit = require(path.join(NM, '@pdf-lib/fontkit'));
  try { require(path.join(NM, 'regenerator-runtime')); } catch {} // fontkit's Indic shaper (Hindi) needs it in node
  const pdfjs = await import(path.join(NM, 'pdfjs-dist/legacy/build/pdf.mjs'));
  const N = (k) => L.PDFName.of(k);
  const tmp = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cpdf-fr-')), name);
  const has = (cmd, arg = '-v') => { try { execFileSync(cmd, [arg], { stdio: 'ignore' }); return true; } catch { return false; } };
  const hasPoppler = has('pdftoppm');
  const hasFontTools = (() => { try { execFileSync('python3', ['-c', 'import fontTools, pypdf'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
  const FX = (f) => path.join(root, 'tests/fixtures', f);
  const FACE = {
    sans: path.join(NM, '@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf'),
    'serif-bi': path.join(NM, '@expo-google-fonts/noto-serif/700Bold_Italic/NotoSerif_700Bold_Italic.ttf'),
    'sans-b': path.join(NM, '@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf'),
    sc: FX('fonts-cjk-sample.ttf'), deva: FX('fonts-deva-sample.ttf'), thai: FX('fonts-thai-sample.ttf'),
  };
  // The on-demand fonts, served from small copies in the fixtures (no download in tests).
  const stubMore = async (p) => {
    await p.route('https://fonts.test/**', (r) => { const k = /\/(\w+)\.ttf$/.exec(r.request().url())[1]; r.fulfill({ body: fs.readFileSync(FACE[k === 'jp' || k === 'kr' ? 'sc' : k]), contentType: 'font/ttf', headers: { 'access-control-allow-origin': '*' } }); });
    await p.evaluate(() => { for (const k of ['sc', 'jp', 'kr', 'deva', 'thai']) window.__cowdreyPdf.fontsUrl(k, 'https://fonts.test/' + k + '.ttf'); });
  };
  // Fetches an on-demand font the way a person does (Download in the question), before the text is written.
  const fetchFont = async (p, k) => {
    const done = p.evaluate((k) => window.__cowdreyPdf.fontsBytes(k), k);
    await p.waitForSelector('#dialog[open] .dlg-foot button:has-text("Download")'); await p.click('#dialog .dlg-foot button:has-text("Download")');
    ok(await done > 0, 'font fetched'); await p.waitForTimeout(200);
  };
  // A page empty but for a small line at its foot (so it has a text layer to wait for).
  const blank = async () => { const d = await L.PDFDocument.create(); d.addPage([612, 792]).drawText('Page 1', { x: 280, y: 30, size: 9, font: await d.embedFont(L.StandardFonts.Helvetica) }); const f = tmp('blank.pdf'); fs.writeFileSync(f, await d.save()); return f; };
  // Add text at (x, y) in PDF points, in a family, then closed.
  const addText = async (p, x, y, text, { family = 'sans', bold = false, italic = false } = {}) => {
    await p.click('[data-rt="edit"]'); await p.click('[data-cmd="tool_text"]');
    const [cx, cy] = await at(p, x, y); await p.mouse.click(cx, cy); await p.waitForSelector('.page .txt-editor');
    await p.selectOption('.txt-bar select[data-tf="fam"]', family);
    if (bold) await p.click('.txt-bar [data-tf="bold"]');
    if (italic) await p.click('.txt-bar [data-tf="italic"]');
    await p.keyboard.type(text); await p.keyboard.press('Control+Enter'); await p.waitForTimeout(500);
    ok((await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().map((m) => m.text))).includes(text), 'the text box is there');
  };

  /* ---- drawing a page ---- */
  const S = 3; // 216 dpi
  // A page drawn by pdf.js (in node): { w, h, ink(x, y) } in pixels at S times points.
  async function drawPdfjs(bytes, n = 0) {
    const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false }).promise;
    try {
      const pg = await d.getPage(n + 1), vp = pg.getViewport({ scale: S }), c = d.canvasFactory.create(Math.ceil(vp.width), Math.ceil(vp.height));
      c.context.fillStyle = '#fff'; c.context.fillRect(0, 0, c.canvas.width, c.canvas.height);
      await pg.render({ canvasContext: c.context, viewport: vp, canvas: c.canvas }).promise;
      const { width: w, height: hh } = c.canvas, px = c.context.getImageData(0, 0, w, hh).data, g = new Uint8Array(w * hh);
      for (let i = 0; i < g.length; i++) g[i] = px[i * 4];
      return { w, h: hh, g };
    } finally { await d.loadingTask.destroy(); }
  }
  // The same by poppler: pdftoppm, grey, as PGM.
  function drawPoppler(bytes, n = 0) {
    const f = tmp('p.pdf'); fs.writeFileSync(f, bytes);
    execFileSync('pdftoppm', ['-r', String(72 * S), '-gray', '-f', String(n + 1), '-l', String(n + 1), f, f.replace(/\.pdf$/, '')]);
    const out = fs.readdirSync(path.dirname(f)).find((x) => x.endsWith('.pgm')), b = fs.readFileSync(path.join(path.dirname(f), out));
    const hdr = /^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(b.toString('latin1', 0, 50)); const w = +hdr[1], hh = +hdr[2];
    return { w, h: hh, g: new Uint8Array(b.buffer, b.byteOffset + hdr[0].length, w * hh) };
  }
  // Ink in a box (points, y up, on a page of height ph): the set of dark pixels.
  const inkIn = (img, ph, [x0, y0, x1, y1]) => {
    const set = new Set(), X0 = Math.max(0, Math.floor(x0 * S)), X1 = Math.min(img.w, Math.ceil(x1 * S)), Y0 = Math.max(0, Math.floor((ph - y1) * S)), Y1 = Math.min(img.h, Math.ceil((ph - y0) * S));
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) if (img.g[y * img.w + x] < 140) set.add(y * img.w + x);
    return set;
  };
  // The words drawn again from the whole font file (pdf-lib, no subset), at the same place and size, on an empty page
  // of the same size: what they must look like. A list of { text, x, y, size, face, rotate? }.
  async function reference(pageSize, items) {
    const d = await L.PDFDocument.create(); d.registerFontkit(fontkit);
    const pg = d.addPage(pageSize), fonts = {};
    for (const it of items) {
      // (pdf-lib shapes text only in a subset: Hindi is drawn from fontkit's own subset, right for this font, whose
      // glyphs are all of even length)
      fonts[it.face] ||= await (FACE[it.face] ? d.embedFont(fs.readFileSync(FACE[it.face]), { subset: it.face === 'deva' }) : d.embedFont(it.face)); // a standard font by name
      pg.drawText(it.text, { x: it.x, y: it.y, size: it.size, font: fonts[it.face], rotate: L.degrees(it.rotate || 0), color: it.color || L.rgb(0, 0, 0) });
    }
    return Buffer.from(await d.save());
  }
  // Where pdf.js finds the words on the saved page: each piece of the line (its text, place, size, and the standard
  // font it is in, if it is in one: what an embedded font can't add is written in it), and a box around them all.
  async function placeOf(bytes, text, n = 0) {
    const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false }).promise;
    try {
      const pg = await d.getPage(n + 1), [, , pw, ph] = pg.view, items = (await pg.getTextContent()).items.filter((i) => i.str);
      await pg.getOperatorList(); // (loads the fonts)
      // read back with the same letters (Hindi vowel signs drawn before their consonant are read where they are drawn)
      const letters = (t) => [...t.replace(/\s+/g, '')].sort().join('');
      const lineOf = (i) => items.filter((j) => Math.abs(j.transform[5] - i.transform[5]) < 2).sort((a, b) => a.transform[4] - b.transform[4]);
      const bare = (t) => t.replace(/\s+/g, ''), cands = items.filter((i) => i.str.trim() && (text.startsWith(i.str.trim()) || bare(i.str).startsWith(bare(text).slice(0, 3))));
      const first = cands.find((i) => letters(lineOf(i).map((j) => j.str).join('')) === letters(text)) || cands[0];
      ok(first, `"${text}" not found on the page: ` + JSON.stringify(items.map((i) => i.str)));
      const y = first.transform[5], line = lineOf(first);
      ok(letters(line.map((i) => i.str).join('')) === letters(text), `reads back "${line.map((i) => i.str).join('')}"`);
      const size = Math.hypot(first.transform[2], first.transform[3]), x = line[0].transform[4], x1 = Math.max(...line.map((i) => i.transform[4] + i.width));
      const std = (i) => { const f = pg.commonObjs.has(i.fontName) ? pg.commonObjs.get(i.fontName) : null, nm = f && f.loadedName; return nm && /^(Helvetica|Times|Courier)/.test(nm) ? nm : null; };
      const pieces = line.filter((i) => i.str.trim()).map((i) => ({ text: i.str, x: i.transform[4], y: i.transform[5], size: Math.hypot(i.transform[2], i.transform[3]), std: std(i) }));
      return { x, y, size, pieces, box: [x - size * .3, y - size * .45, x1 + size * .3, y + size * 1.15], page: [pw, ph] };
    } finally { await d.loadingTask.destroy(); }
  }
  // The reference for words found by placeOf: the embedded pieces drawn from the whole `face` (all of `text` at once
  // when it is all in it, so letters shaped together, as in Hindi, are shaped the same), in `color`.
  const referenceOf = (w, face, text, color) => reference(w.page, (text && w.pieces.every((i) => !i.std) ? [{ text, x: w.x, y: w.y, size: w.size }] : w.pieces).map((i) => ({ ...i, face: i.std || face, color })));
  // The saved words against the reference, by each renderer: the share of their ink in the same places (intersection
  // over union) and the ink against the reference's. A letter drawn wrong or missing pulls both well down.
  async function compare(saved, ref, box, ph, n = 0) {
    const res = {};
    const one = (a, b) => { const A = inkIn(a, ph, box), B = inkIn(b, ph, box); let i = 0; for (const k of A) if (B.has(k)) i++; return { iou: +(i / (A.size + B.size - i || 1)).toFixed(3), ink: +(A.size / (B.size || 1)).toFixed(3), px: B.size }; };
    res.pdfjs = one(await drawPdfjs(saved, n), await drawPdfjs(ref, 0));
    if (hasPoppler) res.poppler = one(drawPoppler(saved, n), drawPoppler(ref, 0));
    return res;
  }
  const looksRight = (res, what, min = .85) => {
    for (const [r, v] of Object.entries(res)) {
      ok(v.px > 200, `${what}: the reference has ink (${r}) ` + JSON.stringify(res));
      ok(v.iou >= min && v.ink > .9 && v.ink < 1.1, `${what}: drawn like the whole font by ${r}: ` + JSON.stringify(res));
    }
  };

  /* ---- the font programs ---- */
  // Each embedded TrueType font on a page, with its ToUnicode map: [{ base, file, uni: Map(cid -> text) }].
  async function embedded(bytes, n = 0) {
    const d = await L.PDFDocument.load(bytes, { ignoreEncryption: true }), out = [], seen = new Set();
    const walk = (res) => {
      const fd = res && res.lookup(N('Font'));
      if (fd instanceof L.PDFDict) for (const [, r] of fd.entries()) {
        const f = d.context.lookup(r); if (!(f instanceof L.PDFDict) || seen.has(f)) continue; seen.add(f);
        const desc = f.lookup(N('DescendantFonts')), cid = desc instanceof L.PDFArray ? desc.lookup(0) : null; if (!cid) continue;
        const ff = cid.lookup(N('FontDescriptor')).lookup(N('FontFile2')); if (!ff) continue;
        const tu = f.lookup(N('ToUnicode')), cmap = tu ? Buffer.from(L.decodePDFRawStream(tu).decode()).toString('latin1') : '', uni = new Map();
        const hex = (s) => String.fromCodePoint(...(s.match(/.{4}/g) || []).map((x) => parseInt(x, 16)).reduce((a, c, i, arr) => { if (c >= 0xD800 && c < 0xDC00) return a; if (c >= 0xDC00 && c < 0xE000) a.push(0x10000 + ((arr[i - 1] - 0xD800) << 10) + (c - 0xDC00)); else a.push(c); return a; }, []));
        for (const [, body] of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) uni.set(parseInt(m[1], 16), hex(m[2]));
        for (const [, body] of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) for (const m of body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) for (let c = parseInt(m[1], 16), u = parseInt(m[3], 16); c <= parseInt(m[2], 16); c++, u++) uni.set(c, String.fromCodePoint(u));
        out.push({ base: String(f.get(N('BaseFont'))).slice(1), file: Buffer.from(L.decodePDFRawStream(ff).decode()), uni });
      }
      const xo = res && res.lookup(N('XObject'));
      if (xo instanceof L.PDFDict) for (const [, r] of xo.entries()) { const x = d.context.lookup(r); if (x && x.dict) walk(x.dict.lookup(N('Resources'))); }
    };
    walk(d.getPage(n).node.Resources());
    // form fields' looks (a stream, or one per state)
    for (const a of d.getPage(n).node.Annots()?.asArray() || []) {
      const w = d.context.lookup(a), ap = w.lookup(N('AP')), nn = ap && ap.lookup(N('N'));
      for (const st of nn instanceof L.PDFDict ? nn.values().map((v) => d.context.lookup(v)) : [nn]) if (st && st.dict) walk(st.dict.lookup(N('Resources')));
    }
    return out;
  }
  // Every glyph of each embedded font is read, and each has an outline the whole font has (its points, box and
  // width): a glyph cut short or taken from the wrong place has none. (Not by letter: shaped scripts such as Hindi
  // use other forms of a letter than the one its code maps to.)
  const sig = (gl) => [gl.path.commands.map((c) => c.command + c.args.map((a) => Math.round(a)).join(',')).join(' '), gl.advanceWidth].join(' | ');
  const sigsOf = new Map(); // face -> Set of outlines
  const wholeSigs = (k) => { if (!sigsOf.has(k)) { const f = fontkit.create(fs.readFileSync(FACE[k])), set = new Set(); for (let g = 0; g < f.numGlyphs; g++) set.add(sig(f.getGlyph(g))); sigsOf.set(k, set); } return sigsOf.get(k); };
  async function fontsSound(bytes, faces, n = 0) {
    const list = await embedded(bytes, n);
    ok(list.length, 'an embedded TrueType font');
    let letters = 0;
    for (const e of list) {
      const sub = fontkit.create(e.file), re = Object.keys(faces).find((x) => new RegExp(x).test(e.base));
      ok(e.file.length < 200000, `${e.base} is a subset: ${e.file.length} bytes`);
      for (let g = 0; g < sub.numGlyphs; g++) { try { const gl = sub.getGlyph(g); gl.path; gl.bbox; } catch (err) { throw new Error(`${e.base}: glyph ${g} can't be read (${err.message})`); } } // reads every glyph
      if (!re) continue;
      const set = wholeSigs(faces[re]), byCid = new Map([...e.uni]);
      for (let g = 1; g < sub.numGlyphs; g++) {
        const gl = sub.getGlyph(g); if (!gl.path.commands.length) continue;
        ok(set.has(sig(gl)), `${e.base}: glyph ${g} (${JSON.stringify(byCid.get(g) || '')}) is not a glyph of the whole font`); letters++;
      }
    }
    ok(letters > 0, 'letters checked');
    if (hasFontTools) {
      const f = tmp('f.pdf'); fs.writeFileSync(f, bytes);
      const py = 'import sys\nfrom io import BytesIO\nfrom fontTools.ttLib import TTFont\nfrom pypdf import PdfReader\nbad=0;n=0\nfor pg in PdfReader(sys.argv[1]).pages:\n  def walk(res):\n    global bad,n\n    if not res: return\n    for f in (res.get("/Font") or {}).values():\n      f=f.get_object()\n      if "/DescendantFonts" not in f: continue\n      fd=f["/DescendantFonts"][0].get_object()["/FontDescriptor"].get_object()\n      if "/FontFile2" not in fd: continue\n      t=TTFont(BytesIO(fd["/FontFile2"].get_object().get_data())); g=t["glyf"]\n      for nm in t.getGlyphOrder():\n        n+=1\n        try: x=g[nm]; x.expand(g); x.recalcBounds(g)\n        except Exception: bad+=1\n    for x in (res.get("/XObject") or {}).values(): walk(x.get_object().get("/Resources"))\n  walk(pg.get("/Resources"))\n  for a in pg.get("/Annots") or []:\n    ap=a.get_object().get("/AP")\n    nn=ap["/N"].get_object() if ap else None\n    if nn is None: continue\n    for st in ([nn] if hasattr(nn, "get_data") else [v.get_object() for v in nn.values()]): walk(st.get("/Resources"))\nprint(n,bad)\n';
      const [count, bad] = execFileSync('python3', ['-I', '-c', py, f], { encoding: 'utf8' }).trim().split(' ').map(Number);
      ok(count > 0 && bad === 0, `fontTools reads every glyph: ${bad} of ${count} broken`);
    }
    if (hasPoppler) {
      const f = tmp('f.pdf'); fs.writeFileSync(f, bytes);
      const rows = execFileSync('pdffonts', [f], { encoding: 'utf8' }).split('\n').slice(2).filter((r) => /CID TrueType/.test(r));
      ok(rows.length && rows.every((r) => /Identity-H\s+yes\s+(yes|no)\s+yes/.test(r)), 'pdffonts: embedded, with ToUnicode: ' + rows.join(' | '));
    }
    return list;
  }

  // Add text in each script on an empty page: drawn like the whole font by pdf.js and poppler; sound font programs.
  const CASES = [
    ['Latin extended', 'Łódź Zoë Ørsted ŞŢĂ őű ĳ Ŋŧ', {}, 'sans', null],
    ['Greek', 'Ωmega Γειά σου κόσμε 8&B', {}, 'sans', null],
    ['Cyrillic', 'Съешь же ещё этих мягких булок', {}, 'sans', null],
    ['Greek and Cyrillic, serif bold italic', 'Ωmega Привет κόσμε', { family: 'serif', bold: true, italic: true }, 'serif-bi', null],
    ['Chinese (on-demand font)', '中文测试你好世界', {}, 'sc', 'sc'],
    ['Hindi (on-demand font)', 'नमस्ते दुनिया', {}, 'deva', 'deva'],
    ['Thai (on-demand font)', 'สวัสดีชาวโลก', {}, 'thai', 'thai'],
  ];
  for (const [name, text, style, face, more] of CASES) {
    await test(`fonts drawn: Add text in ${name} is drawn with every letter, by pdf.js and poppler`, async () => {
      const p = await open(); await stubMore(p); await openPdf(p, await blank(), 'Blank.pdf');
      if (more) await fetchFont(p, more);
      await addText(p, 72, 600, text, style);
      const out = await savedOf(p), at0 = await placeOf(out, text), ref = await referenceOf(at0, face, text);
      looksRight(await compare(out, ref, at0.box, at0.page[1]), name);
      await fontsSound(out, { 'NotoSans-Regular|NotoSansSC|NotoSansDevanagari|NotoSansThai|NotoSerif-BoldItalic': face });
      eq(p.errors, []); await p.ctx.close();
    });
  }

  // The reported case: Ωmega… added on the sample PDF and saved (pdftoppm drew "eg ι σο σ 8&B").
  await test('fonts drawn: Edit PDF and Add text on the sample PDF: Greek drawn whole; the edited line too', async () => {
    const p = await open({ width: 1000, height: 1300 }); await openPdf(p);
    const text = 'Ωmega Γειά σου κόσμε 8&B';
    // a line of the PDF typed over in Edit PDF (app.js), in Greek
    await run(p, 'tool_edit');
    const b = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'pelican count' }).first().boundingBox();
    await p.mouse.click(b.x + Math.min(20, b.width / 3), b.y + b.height / 2); await p.waitForSelector('.line-editor'); await p.waitForTimeout(250);
    await p.keyboard.press('Control+a'); const line = 'Γειά σου κόσμε Ωmega'; await p.keyboard.type(line); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
    await addText(p, 72, 450, text);
    const out = await savedOf(p);
    for (const t of [text, line]) {
      const w = await placeOf(out, t), ref = await referenceOf(w, (await embedded(out)).some((e) => /NotoSans-Bold/.test(e.base)) && t === line ? 'sans-b' : 'sans');
      const res = await compare(out, ref, w.box, w.page[1]);
      for (const [r, v] of Object.entries(res)) ok(v.ink > .85 && v.ink < 1.2, `${t}: all its ink is there (${r}): ` + JSON.stringify(res));
      if (t === text) looksRight(res, t);
    }
    await fontsSound(out, { 'NotoSans-Regular': 'sans', 'NotoSans-Bold': 'sans-b' });
    eq(p.errors, []); await p.ctx.close();
  });

  await test('fonts drawn: a header in Greek and Cyrillic (page design) is drawn with every letter', async () => {
    const p = await open(); await openPdf(p, await blank(), 'Blank.pdf');
    await run(p, 'pd_headfoot'); await p.waitForSelector('#dialog[open] .pd-form');
    await p.fill('#dialog [data-k="bc"]', ''); await p.fill('#dialog [data-k="tc"]', 'Ελληνικά Привет');
    await p.click('#dialog .dlg-foot button:has-text("Add header & footer")'); await p.waitForTimeout(400);
    const out = await savedOf(p), w = await placeOf(out, 'Ελληνικά Привет');
    looksRight(await compare(out, await referenceOf(w, 'sans', 'Ελληνικά Привет', L.rgb(.2, .2, .2)), w.box, w.page[1]), 'header'); // (#333333, its colour)
    await fontsSound(out, { 'NotoSans-Regular': 'sans' });
    eq(p.errors, []); await p.ctx.close();
  });

  // A form field's text: its look (appearance stream) in Noto Sans for Greek, and in the Chinese font for Chinese.
  const drag = async (p, a, b) => { const [x1, y1] = await at(p, ...a), [x2, y2] = await at(p, ...b); await p.mouse.move(x1, y1); await p.mouse.down(); await p.mouse.move(x2, y2, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(150); };
  for (const [name, val, face, more, re] of [['Greek', 'Γειά σου κόσμε', 'sans', null, 'NotoSans-Regular'], ['Chinese', '中文测试', 'sc', 'sc', 'NotoSansSC']]) {
    await test(`fonts drawn: a new form field with a ${name} value is drawn in a font that has its letters`, async () => {
      const p = await open({ width: 1000, height: 1300 }); await stubMore(p); await openPdf(p, await blank(), 'Blank.pdf');
      await p.click('[data-rt="forms"]'); await p.click('[data-cmd="ff_text"]'); await drag(p, [72, 620], [320, 590]);
      const [x, y] = await at(p, 150, 605); await p.mouse.dblclick(x, y); await p.waitForSelector('#dialog[open] #ffName');
      await p.fill('#ffVal', val); await p.click('#dialog .btn.primary'); await p.waitForTimeout(200);
      // the Chinese font is asked for when the field is saved
      const building = savedOf(p);
      if (more) { await p.waitForSelector('#dialog[open] .dlg-foot button:has-text("Download")'); await p.click('#dialog .dlg-foot button:has-text("Download")'); }
      const out = await building, list = await fontsSound(out, { [re]: face });
      ok(list.some((e) => new RegExp(re).test(e.base)), `the field is drawn in ${re}: ` + JSON.stringify(list.map((e) => e.base)));
      eq((await L.PDFDocument.load(out)).getForm().getTextField('Text1').getText(), val);
      // drawn: its ink in the field's box is the ink of the same words from the whole font (placed as pdf.js finds them)
      const box = [72, 590, 320, 620], d = await drawPdfjs(out), ink = inkIn(d, 792, box).size;
      const ref = await reference([612, 792], [{ text: val, x: 76, y: 600, size: 12, face }]), rink = inkIn(await drawPdfjs(ref), 792, [60, 590, 330, 620]).size;
      ok(ink > rink * .5, `${name} drawn in the field: ${ink} dark pixels, ${rink} for the reference`);
      eq(p.errors, []); await p.ctx.close();
    });
  }

  await test('fonts drawn: a Chinese form field value, the font download declined: no empty boxes, other apps draw it', async () => {
    const p = await open({ width: 1000, height: 1300 }); await stubMore(p); await openPdf(p, await blank(), 'Blank.pdf');
    await p.click('[data-rt="forms"]'); await p.click('[data-cmd="ff_text"]'); await drag(p, [72, 620], [320, 590]);
    const [x, y] = await at(p, 150, 605); await p.mouse.dblclick(x, y); await p.waitForSelector('#dialog[open] #ffName');
    await p.fill('#ffVal', '中文测试'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(200);
    const building = savedOf(p);
    await p.waitForSelector('#dialog[open] .dlg-foot button:has-text("Not now")'); await p.click('#dialog .dlg-foot button:has-text("Not now")');
    const out = await building, d = await L.PDFDocument.load(out);
    eq(d.getForm().getTextField('Text1').getText(), '中文测试', 'the value is kept');
    ok(!(await embedded(out)).some((e) => /NotoSans-Regular/.test(e.base)), 'not drawn in Noto Sans, which has no Chinese letters');
    ok(d.catalog.lookup(N('AcroForm')).get(N('NeedAppearances')), 'other apps draw the field (NeedAppearances)');
    const w = d.getForm().getTextField('Text1').acroField.getWidgets()[0], apd = w.dict.lookup(N('AP')), ap = apd && d.context.lookup(apd.get(N('N')));
    ok(!ap || !/<3F3F|\(\?\?/.test(Buffer.from(L.decodePDFRawStream(ap).decode()).toString('latin1')), 'no question marks in its look');
    eq(p.errors, []); await p.ctx.close();
  });

  // OCR a scan (a stand-in recognizer), then Edit PDF a recognised line: the new words are drawn whole.
  await test('fonts drawn: OCR, then Edit PDF on a recognised line: the new words are drawn with every letter', async () => {
    const p = await open();
    const scan = await p.evaluate(() => {
      const W = 1700, H = 2200, c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.fillStyle = '#111'; x.font = 'bold 54px Arial, Helvetica, sans-serif';
      const lines = [];
      ['Payment is due within thirty days.', 'Thank you for your order.'].forEach((line, k) => {
        const by = 300 + k * 120, words = []; let cx = 160;
        for (const w of line.split(' ')) { const m = x.measureText(w); x.fillText(w, cx, by); words.push({ text: w, bbox: { x0: cx, y0: by - m.actualBoundingBoxAscent, x1: cx + m.width, y1: by + m.actualBoundingBoxDescent }, confidence: 92 }); cx += m.width + x.measureText(' ').width; }
        lines.push({ baseline: { x0: 160, y0: by, x1: cx, y1: by }, words });
      });
      return { png: c.toDataURL('image/png').split(',')[1], lines, W };
    });
    const d = await L.PDFDocument.create(), img = await d.embedPng(Buffer.from(scan.png, 'base64'));
    d.addPage([612, 792]).drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
    const f = tmp('scan.pdf'); fs.writeFileSync(f, await d.save()); await openPdf(p, f, 'Scan.pdf').catch(() => {});
    await p.waitForSelector('.page canvas.pdf');
    await p.evaluate((s) => {
      window.__cowdreyPdf.ocrUseEngine({
        async start() {}, async stop() {},
        async recognize(canvas) { const k = canvas.width / s.W, box = (b) => ({ x0: b.x0 * k, y0: b.y0 * k, x1: b.x1 * k, y1: b.y1 * k }); return { lines: s.lines.map((l) => ({ baseline: box(l.baseline), words: l.words.map((w) => ({ ...w, bbox: box(w.bbox) })) })) }; },
      });
    }, { lines: scan.lines, W: scan.W });
    await p.evaluate(() => window.__cowdreyPdf.ocrRun({ pages: [0] }));
    await p.waitForSelector('.page[data-n="0"] .textLayer span');
    await run(p, 'tool_edit');
    const b = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'thirty' }).first().boundingBox();
    await p.mouse.click(b.x + 8, b.y + b.height / 2); await p.waitForSelector('.line-editor');
    const text = 'Payment is required within sixty days.';
    await p.keyboard.press('Control+a'); await p.keyboard.type(text); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
    const out = await savedOf(p), list = await fontsSound(out, { 'NotoSans-Bold': 'sans-b', 'NotoSans-Regular': 'sans' });
    const w = await placeOf(out, text), face = list.some((e) => /NotoSans-Bold/.test(e.base)) ? 'sans-b' : 'sans';
    const res = await compare(out, await referenceOf(w, face), w.box, w.page[1]);
    for (const [r, v] of Object.entries(res)) ok(v.ink > .85 && v.ink < 1.2, `all its ink is there (${r}): ` + JSON.stringify(res));
    eq(p.errors, []); await p.ctx.close();
  });
};
