/* ---------------- optimize (src/features/82-optimize.js) ----------------
   Protect > Optimize… makes a PDF smaller, on this device:
   - pictures: decoded here (Flate with PNG or TIFF predictors, 1 to 16 bits, Decode arrays, Indexed palettes, CMYK
     when it may be turned into RGB; JPEG through the browser; JPEG 2000, CCITT, JBIG2 and the rest through pdf.js),
     made smaller when they are drawn at more pixels per inch than asked, and written as JPEG or as lossless Flate,
     whichever is smaller. Black-and-white scans stay 1-bit (CCITT G4 or 1-bit Flate, never JPEG). Image masks and
     pictures with a colour-key mask stay as they are.
   - streams: Flate streams compressed again at level 9 (fflate, or the browser's CompressionStream), keeping the
     smaller; streams stored plain (or in ASCII, LZW or RunLength) are packed with Flate. Object streams are on.
   - duplicates: identical pictures, embedded font files, ICC profiles and form XObjects become one object.
   - clean-up: editing data (PieceInfo), page thumbnails, resources no content uses; and if asked, XMP metadata,
     JavaScript and the tags (structure tree).
   Font subsetting is later work: only identical font files are merged here.
   The file is never made bigger: when nothing gains, the PDF is kept as it was (and you're told). The privacy
   clean-up (XMP metadata, JavaScript, tags) is done whatever the size gain.
   docMarks(): { id, type: 'optimize', opts } — applied when the PDF is saved (see the saveDoc hook below).
   optimizeBytes(bytes, opts) does the same to the bytes of a PDF (the batch step uses it). */
const OPT_FFLATE = 'https://cdn.jsdelivr.net/npm/fflate@0.8.3/esm/browser.js';
// pdf.js's decoders for JPEG 2000, JBIG2 and CCITT pictures (WebAssembly, with a JavaScript fallback). The apps carry
// a copy (desktop/build.mjs makes this an address in the app's own folder).
const OPT_PDFJS_WASM = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/wasm/';
const OPT_PRESETS = {
  smaller: { label: 'Smaller (150 dpi)', note: 'Pictures at 150 pixels per inch: good on screen and in print.', color: { dpi: 150, above: 225 }, mono: { dpi: 300, above: 450, mode: 'shrink' }, quality: 75 },
  smallest: { label: 'Smallest (96 dpi)', note: 'Pictures at 96 pixels per inch: good on screen.', color: { dpi: 96, above: 144 }, mono: { dpi: 200, above: 300, mode: 'shrink' }, quality: 60 },
  lossless: { label: 'Lossless only', note: 'Pictures stay exactly as they are. Only the file is packed and cleaned.', lossless: true },
};
const OPT_CLEAN = [
  ['editData', 'Remove page thumbnails and editing data', true],
  ['unused', 'Remove unused resources', true],
  ['dedupe', 'Merge identical pictures, fonts and profiles', true],
  ['metadata', 'Remove XMP metadata', false],
  ['javascript', 'Remove JavaScript', false],
  ['tags', 'Remove tags (makes the file less accessible)', false],
];
// The options of a preset, with every field filled in.
function optOptions(preset = 'smaller', over = {}) {
  const p = OPT_PRESETS[preset] || OPT_PRESETS.smaller;
  const o = {
    preset, lossless: !!p.lossless,
    color: { dpi: 150, above: 225, ...(p.color || {}) },
    mono: { dpi: 300, above: 450, mode: 'shrink', ...(p.mono || {}) },
    quality: p.quality || 75, gray: false, cmyk: false, photos: !p.lossless,
    clean: Object.fromEntries(OPT_CLEAN.map(([k, , on]) => [k, on])),
  };
  for (const [k, v] of Object.entries(over || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) && o[k] && typeof o[k] === 'object' ? { ...o[k], ...v } : v;
  return o;
}

/* ----- compression ----- */
let optFflate = null, optFflateLoading = null;
async function optLoadFflate() {
  if (optFflate) return optFflate;
  try { optFflate = await (optFflateLoading ||= import(OPT_FFLATE)); return optFflate; }
  catch (e) { optFflateLoading = null; console.warn('optimize: fflate did not load, using the browser’s own compression', e); return null; }
}
async function optStreamAll(stream, bytes) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
// zlib (RFC 1950) at the strongest level: what a PDF's FlateDecode reads.
async function optDeflate(bytes) {
  const f = await optLoadFflate();
  if (f) return f.zlibSync(bytes, { level: 9, mem: 12 });
  return optStreamAll(new CompressionStream('deflate'), bytes);
}
// Inflates a Flate stream; null when it is damaged (such a stream is left as it is).
async function optInflate(bytes) {
  const f = await optLoadFflate();
  try { if (f) return f.unzlibSync(bytes); return await optStreamAll(new DecompressionStream('deflate'), bytes); } catch { return null; }
}
const optHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function optSha1(parts) {
  const enc = new TextEncoder(), list = parts.map((x) => (typeof x === 'string' ? enc.encode(x) : x));
  const all = new Uint8Array(list.reduce((t, x) => t + x.length, 0)); let k = 0; for (const x of list) { all.set(x, k); k += x.length; }
  return optHex(await crypto.subtle.digest('SHA-1', all));
}

/* ----- an undo log, so a save that gains nothing can put everything back ----- */
function optJournal(L, ctx) {
  const log = [];
  return {
    assign(ref, obj) { log.push(['a', ref, ctx.lookup(ref)]); ctx.assign(ref, obj); },
    set(d, k, v) { log.push(['s', d, k, d.get(k)]); d.set(k, v); },
    del(d, k) { if (!d.has(k)) return; log.push(['s', d, k, d.get(k)]); d.delete(k); },
    aset(a, i, v) { log.push(['i', a, i, a.get(i)]); a.set(i, v); },
    drop(ref) { log.push(['a', ref, ctx.lookup(ref)]); ctx.delete(ref); },
    undo() {
      for (const e of log.reverse()) {
        if (e[0] === 'a') { if (e[2]) ctx.assign(e[1], e[2]); else ctx.delete(e[1]); }
        else if (e[0] === 's') { if (e[3] === undefined) e[1].delete(e[2]); else e[1].set(e[2], e[3]); }
        else e[1].set(e[2], e[3]);
      }
      log.length = 0;
    },
    get size() { return log.length; },
  };
}

/* ----- reading the PDF ----- */
const optStr = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return s; };
// A stream's decoded bytes (any filter pdf-lib reads), or null.
function optDecoded(L, st) {
  try {
    if (st instanceof L.PDFRawStream) return L.decodePDFRawStream(st).decode();
    if (st.getUnencodedContents) return st.getUnencodedContents();
    return st.getContents();
  } catch { return null; }
}
function optFilters(L, d) {
  const f = d.lookup(L.PDFName.of('Filter'));
  return f instanceof L.PDFArray ? f.asArray().map((x) => String(x)) : f ? [String(f)] : [];
}
function optParms(L, ctx, d, k = 0) {
  let p = d.lookup(L.PDFName.of('DecodeParms')) || d.lookup(L.PDFName.of('DP'));
  if (p instanceof L.PDFArray) p = ctx.lookup(p.get(k));
  if (!(p instanceof L.PDFDict)) return null;
  const o = {};
  for (const [key, v] of p.entries()) { const x = ctx.lookup(v); o[key.asString().slice(1)] = x instanceof L.PDFNumber ? x.asNumber() : x instanceof L.PDFBool ? String(x) === 'true' : x; }
  return o;
}
const optNum = (L, ctx, x) => { const v = ctx.lookup(x); return v instanceof L.PDFNumber ? v.asNumber() : null; };
function optNums(L, ctx, a) { const v = ctx.lookup(a); if (!(v instanceof L.PDFArray)) return null; const r = v.asArray().map((x) => optNum(L, ctx, x)); return r.some((x) => x == null) ? null : r; }
function optBytesOf(L, ctx, o) {
  o = ctx.lookup(o);
  if (o instanceof L.PDFString || o instanceof L.PDFHexString) return o.asBytes();
  if (o instanceof L.PDFStream) return optDecoded(L, o);
  return null;
}
// What a colour space is: { kind: gray | rgb | cmyk | indexed | other, comps, base?, hival?, lut?, icc? }.
function optColorSpace(L, ctx, cs) {
  const N = L.PDFName.of;
  cs = ctx.lookup(cs);
  if (cs instanceof L.PDFName) {
    const n = String(cs);
    return { '/DeviceGray': { kind: 'gray', comps: 1 }, '/G': { kind: 'gray', comps: 1 }, '/DeviceRGB': { kind: 'rgb', comps: 3 }, '/RGB': { kind: 'rgb', comps: 3 }, '/DeviceCMYK': { kind: 'cmyk', comps: 4 }, '/CMYK': { kind: 'cmyk', comps: 4 } }[n] || { kind: 'other', comps: 0 };
  }
  if (cs instanceof L.PDFArray && cs.size()) {
    const fam = String(ctx.lookup(cs.get(0)));
    if (fam === '/ICCBased') {
      const st = ctx.lookup(cs.get(1)), n = st instanceof L.PDFStream ? optNum(L, ctx, st.dict.get(N('N'))) : null;
      const kind = { 1: 'gray', 3: 'rgb', 4: 'cmyk' }[n];
      return kind ? { kind, comps: n, icc: true } : { kind: 'other', comps: 0 };
    }
    if (fam === '/CalGray') return { kind: 'gray', comps: 1 };
    if (fam === '/CalRGB') return { kind: 'rgb', comps: 3 };
    if (fam === '/Indexed' || fam === '/I') {
      const base = optColorSpace(L, ctx, cs.get(1)), hival = optNum(L, ctx, cs.get(2)), lut = optBytesOf(L, ctx, cs.get(3));
      if (!['gray', 'rgb', 'cmyk'].includes(base.kind) || hival == null || !lut) return { kind: 'other', comps: 0 };
      return { kind: 'indexed', comps: 1, base, hival, lut };
    }
  }
  return { kind: 'other', comps: 0 };
}
// An image XObject's facts. null for an image mask (it stays as it is).
function optImageInfo(L, ctx, st) {
  const d = st.dict, N = L.PDFName.of;
  const im = d.lookup(N('ImageMask'));
  if (im && String(im) === 'true') return null;
  const W = optNum(L, ctx, d.get(N('Width'))), H = optNum(L, ctx, d.get(N('Height')));
  if (!W || !H) return null;
  const filters = optFilters(L, d);
  const jpx = filters.includes('/JPXDecode');
  const cs = d.has(N('ColorSpace')) ? optColorSpace(L, ctx, d.get(N('ColorSpace'))) : jpx ? { kind: 'jpx', comps: 0 } : { kind: 'other', comps: 0 };
  const bpc = optNum(L, ctx, d.get(N('BitsPerComponent'))) || (jpx ? 8 : filters.includes('/CCITTFaxDecode') || filters.includes('/JBIG2Decode') ? 1 : 8);
  const decode = optNums(L, ctx, d.get(N('Decode')));
  const mask = d.lookup(N('Mask'));
  const bilevel = bpc === 1 && cs.kind === 'gray';
  return { W, H, bpc, cs, filters, decode, colorKey: mask instanceof L.PDFArray, smaskInData: !!optNum(L, ctx, d.get(N('SMaskInData'))), bilevel };
}

/* ----- decoding pictures ----- */
// Undoes a PNG (10-15) or TIFF (2) predictor on rows of `bytes`.
function optUnpredict(raw, parms, W, comps, bpc) {
  const pred = (parms && parms.Predictor) || 1;
  if (pred < 2) return raw;
  const colors = (parms && parms.Colors) || comps, bits = (parms && parms.BitsPerComponent) || bpc, cols = (parms && parms.Columns) || W;
  const rowBytes = Math.ceil(colors * bits * cols / 8), bpp = Math.max(1, Math.ceil(colors * bits / 8));
  if (pred === 2) {
    if (bits !== 8) return null;
    const out = new Uint8Array(raw);
    for (let r = 0; r * rowBytes < out.length; r++) for (let i = bpp; i < rowBytes; i++) { const k = r * rowBytes + i; if (k < out.length) out[k] = (out[k] + out[k - bpp]) & 255; }
    return out;
  }
  const rows = Math.floor(raw.length / (rowBytes + 1)), out = new Uint8Array(rows * rowBytes);
  for (let r = 0; r < rows; r++) {
    const f = raw[r * (rowBytes + 1)], src = r * (rowBytes + 1) + 1, dst = r * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const x = raw[src + i], a = i >= bpp ? out[dst + i - bpp] : 0, b = r ? out[dst - rowBytes + i] : 0, c = r && i >= bpp ? out[dst - rowBytes + i - bpp] : 0;
      let v;
      if (f === 0) v = x; else if (f === 1) v = x + a; else if (f === 2) v = x + b; else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      else return null;
      out[dst + i] = v & 255;
    }
  }
  return out;
}
// Samples of a decoded image as numbers, row by row (rows start on a byte).
function optSamples(raw, W, H, comps, bpc) {
  const n = W * comps, out = new Uint16Array(W * H * comps), rowBytes = Math.ceil(n * bpc / 8);
  if (raw.length < rowBytes * H) return null;
  for (let y = 0; y < H; y++) {
    const r0 = y * rowBytes, o0 = y * n;
    if (bpc === 8) for (let i = 0; i < n; i++) out[o0 + i] = raw[r0 + i];
    else if (bpc === 16) for (let i = 0; i < n; i++) out[o0 + i] = (raw[r0 + 2 * i] << 8) | raw[r0 + 2 * i + 1];
    else { const per = 8 / bpc, mask = (1 << bpc) - 1; for (let i = 0; i < n; i++) out[o0 + i] = (raw[r0 + ((i / per) | 0)] >> (8 - bpc * (1 + (i % per)))) & mask; }
  }
  return out;
}
// The picture as 8-bit samples, 1 (gray) or 3 (RGB) per pixel: { data, comps }. null when it can't be read here.
function optToPixels(info, raw, opts) {
  const { W, H, bpc, cs, decode } = info, max = (1 << bpc) - 1;
  const comps = cs.kind === 'indexed' ? 1 : cs.comps;
  if (![1, 2, 4, 8, 16].includes(bpc) || !comps) return null;
  const s = optSamples(raw, W, H, comps, bpc); if (!s) return null;
  const n = W * H;
  if (cs.kind === 'indexed') {
    const bc = cs.base.comps, outC = cs.base.kind === 'gray' ? 1 : 3, out = new Uint8Array(n * outC);
    const d0 = decode ? decode[0] : 0, d1 = decode ? decode[1] : max;
    for (let i = 0; i < n; i++) {
      const idx = Math.max(0, Math.min(cs.hival, Math.round(d0 + s[i] * (d1 - d0) / max))), p = idx * bc;
      if (bc === 1) out[i] = cs.lut[p] || 0;
      else if (bc === 3) { out[i * 3] = cs.lut[p] || 0; out[i * 3 + 1] = cs.lut[p + 1] || 0; out[i * 3 + 2] = cs.lut[p + 2] || 0; }
      else { const c = (cs.lut[p] || 0) / 255, m = (cs.lut[p + 1] || 0) / 255, y = (cs.lut[p + 2] || 0) / 255, k = (cs.lut[p + 3] || 0) / 255; out[i * 3] = 255 * (1 - c) * (1 - k); out[i * 3 + 1] = 255 * (1 - m) * (1 - k); out[i * 3 + 2] = 255 * (1 - y) * (1 - k); }
    }
    return { data: out, comps: outC, wasCmyk: bc === 4 };
  }
  const v = new Float32Array(comps), dec = (i, c) => { const x = s[i * comps + c] / max; return decode ? decode[2 * c] + x * (decode[2 * c + 1] - decode[2 * c]) : x; };
  if (cs.kind === 'cmyk') {
    if (!opts.cmyk) return null;
    const out = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) { for (let c = 0; c < 4; c++) v[c] = dec(i, c); const k = 1 - v[3]; out[i * 3] = 255 * (1 - v[0]) * k; out[i * 3 + 1] = 255 * (1 - v[1]) * k; out[i * 3 + 2] = 255 * (1 - v[2]) * k; }
    return { data: out, comps: 3, wasCmyk: true };
  }
  const out = new Uint8Array(n * comps);
  if (!decode && bpc === 8) { for (let i = 0; i < out.length; i++) out[i] = s[i]; return { data: out, comps }; }
  for (let i = 0; i < n; i++) for (let c = 0; c < comps; c++) out[i * comps + c] = Math.max(0, Math.min(255, Math.round(dec(i, c) * 255)));
  return { data: out, comps };
}
async function optFromImageBitmap(bytes, W, H, comps) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.drawImage(bmp, 0, 0, W, H); bmp.close && bmp.close();
  const px = g.getImageData(0, 0, W, H).data, out = new Uint8Array(W * H * comps);
  for (let i = 0, n = W * H; i < n; i++) { if (comps === 1) out[i] = px[i * 4]; else { out[i * 3] = px[i * 4]; out[i * 3 + 1] = px[i * 4 + 1]; out[i * 3 + 2] = px[i * 4 + 2]; } }
  c.width = c.height = 0;
  return out;
}
// Any image pdf.js can read (JPEG 2000, CCITT, JBIG2, LZW…): drawn alone at its own size, without its mask.
// `viewer`: read it as the app's own pages are read (to know whether a picture written here will show in the app).
async function optRenderWithPdfjs(L, ctx, st, W, H, viewer = false) {
  await loadPdfjs();
  const d = await L.PDFDocument.create(), N = L.PDFName.of;
  const copy = L.PDFObjectCopier.for(ctx, d.context).copy(st);
  for (const k of ['SMask', 'Mask', 'SMaskInData', 'OC', 'Metadata', 'StructParent']) copy.dict.delete(N(k));
  const ref = d.context.register(copy), p = d.addPage([W, H]);
  const name = p.node.newXObject('Im', ref);
  p.node.set(N('Contents'), d.context.register(d.context.stream(`q ${W} 0 0 ${H} 0 0 cm ${name.asString()} Do Q`)));
  const bytes = await d.save({ useObjectStreams: false });
  const pd = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, ...(viewer ? {} : { wasmUrl: OPT_PDFJS_WASM }) }).promise;
  try {
    const page = await pd.getPage(1), vp = page.getViewport({ scale: 1 });
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    await page.render({ canvas: c, canvasContext: g, viewport: vp, background: '#ffffff' }).promise;
    const px = g.getImageData(0, 0, W, H).data; c.width = c.height = 0;
    return px;
  } finally { try { pd.destroy(); } catch {} }
}
// Reads an image XObject into pixels: { data, comps, how } or null.
async function optDecodeImage(L, ctx, st, info, opts) {
  const { W, H, filters } = info, cs = info.cs;
  const parms = optParms(L, ctx, st.dict);
  const native = filters.length === 0 || (filters.length === 1 && filters[0] === '/FlateDecode');
  if (native && cs.kind !== 'other' && cs.kind !== 'jpx') {
    let raw = filters.length ? await optInflate(st.getContents()) : st.getContents();
    if (raw && parms) raw = optUnpredict(raw, parms, W, cs.kind === 'indexed' ? 1 : cs.comps, info.bpc);
    if (raw) { const px = optToPixels(info, raw, opts); if (px) return { ...px, how: 'native' }; }
    if (cs.kind === 'cmyk' && !opts.cmyk) return null;
  }
  if (filters.length === 1 && filters[0] === '/DCTDecode' && (cs.kind === 'gray' || cs.kind === 'rgb') && !info.decode) {
    try { return { data: await optFromImageBitmap(st.getContents(), W, H, cs.comps), comps: cs.comps, how: 'jpeg' }; } catch {}
  }
  // CMYK through pdf.js is turned into RGB: only when that is allowed. Spot colours (Separation, DeviceN, Lab…) stay.
  if (cs.kind === 'cmyk' && !opts.cmyk) return null;
  if (cs.kind === 'other' || (cs.kind === 'indexed' && cs.base.kind === 'cmyk' && !opts.cmyk) || info.smaskInData) return null;
  try {
    const px = await optRenderWithPdfjs(L, ctx, st, W, H), gray = cs.kind === 'gray' || (cs.kind === 'indexed' && cs.base.kind === 'gray');
    const comps = gray ? 1 : 3, out = new Uint8Array(W * H * comps);
    for (let i = 0, n = W * H; i < n; i++) { if (gray) out[i] = px[i * 4]; else { out[i * 3] = px[i * 4]; out[i * 3 + 1] = px[i * 4 + 1]; out[i * 3 + 2] = px[i * 4 + 2]; } }
    return { data: out, comps, how: 'pdfjs', wasCmyk: cs.kind === 'cmyk' };
  } catch (e) { console.warn('optimize: pdf.js could not read a picture', e); return null; }
}

/* ----- changing pictures ----- */
// Area-averaging resize of 8-bit samples (comps per pixel).
function optResize(src, W, H, comps, tw, th) {
  const pass = (data, w, h, nw, horiz) => {
    const outW = horiz ? nw : w, outH = horiz ? h : nw, out = new Float32Array(outW * outH * comps);
    const len = horiz ? w : h, k = len / nw;
    for (let j = 0; j < nw; j++) {
      const a = j * k, b = a + k;
      for (let s = Math.floor(a); s < Math.min(len, Math.ceil(b)); s++) {
        const wgt = (Math.min(b, s + 1) - Math.max(a, s)) / k; if (wgt <= 0) continue;
        if (horiz) for (let y = 0; y < h; y++) { const si = (y * w + s) * comps, di = (y * nw + j) * comps; for (let c = 0; c < comps; c++) out[di + c] += data[si + c] * wgt; }
        else for (let x = 0; x < w; x++) { const si = (s * w + x) * comps, di = (j * w + x) * comps; for (let c = 0; c < comps; c++) out[di + c] += data[si + c] * wgt; }
      }
    }
    return out;
  };
  const h1 = tw === W ? src : pass(src, W, H, tw, true);
  const v1 = th === H ? h1 : pass(h1, tw, H, th, false);
  const out = new Uint8Array(tw * th * comps); for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(v1[i])));
  return out;
}
const optGrayOf = (data, n) => { const g = new Uint8Array(n); for (let i = 0; i < n; i++) g[i] = Math.round(.299 * data[i * 3] + .587 * data[i * 3 + 1] + .114 * data[i * 3 + 2]); return g; };
// PNG-predicted rows (the filter with the smallest sum per row), for Flate with /Predictor 15.
function optPredict(data, W, H, comps) {
  const row = W * comps, out = new Uint8Array(H * (row + 1)), cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(row));
  for (let y = 0; y < H; y++) {
    const r0 = y * row; let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const t = cand[f]; let sum = 0;
      for (let i = 0; i < row; i++) {
        const x = data[r0 + i], a = i >= comps ? data[r0 + i - comps] : 0, b = y ? data[r0 - row + i] : 0, c = y && i >= comps ? data[r0 - row + i - comps] : 0;
        let p;
        if (f === 0) p = 0; else if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
        else { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        const v = (x - p) & 255; t[i] = v; sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    out[y * (row + 1)] = best; out.set(cand[best], y * (row + 1) + 1);
  }
  return out;
}
async function optJpeg(data, W, H, comps, q) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), id = g.createImageData(W, H), px = id.data;
  for (let i = 0, n = W * H; i < n; i++) { if (comps === 1) px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = data[i]; else { px[i * 4] = data[i * 3]; px[i * 4 + 1] = data[i * 3 + 1]; px[i * 4 + 2] = data[i * 3 + 2]; } px[i * 4 + 3] = 255; }
  g.putImageData(id, 0, 0);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', q));
  c.width = c.height = 0;
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
// 1-bit: black is 1 in `bits` (one byte per pixel); packed rows with 0 = black, as DeviceGray reads them.
function optPack1(bits, W, H) {
  const rb = Math.ceil(W / 8), out = new Uint8Array(rb * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!bits[y * W + x]) out[y * rb + (x >> 3)] |= 0x80 >> (x & 7);
  return out;
}

/* CCITT Group 4 (T.6) encoder: black is 1 in `bits`. Written for this app; checked against pdf.js before use. */
const OPT_G4 = (() => {
  const WT = '00110101 000111 0111 1000 1011 1100 1110 1111 10011 10100 00111 01000 001000 000011 110100 110101 101010 101011 0100111 0001100 0001000 0010111 0000011 0000100 0101000 0101011 0010011 0100100 0011000 00000010 00000011 00011010 00011011 00010010 00010011 00010100 00010101 00010110 00010111 00101000 00101001 00101010 00101011 00101100 00101101 00000100 00000101 00001010 00001011 01010010 01010011 01010100 01010101 00100100 00100101 01011000 01011001 01011010 01011011 01001010 01001011 00110010 00110011 00110100'.split(' ');
  const WM = '11011 10010 010111 0110111 00110110 00110111 01100100 01100101 01101000 01100111 011001100 011001101 011010010 011010011 011010100 011010101 011010110 011010111 011011000 011011001 011011010 011011011 010011000 010011001 010011010 011000 010011011'.split(' ');
  const BT = '0000110111 010 11 10 011 0011 0010 00011 000101 000100 0000100 0000101 0000111 00000100 00000111 000011000 0000010111 0000011000 0000001000 00001100111 00001101000 00001101100 00000110111 00000101000 00000010111 00000011000 000011001010 000011001011 000011001100 000011001101 000001101000 000001101001 000001101010 000001101011 000011010010 000011010011 000011010100 000011010101 000011010110 000011010111 000001101100 000001101101 000011011010 000011011011 000001010100 000001010101 000001010110 000001010111 000001100100 000001100101 000001010010 000001010011 000000100100 000000110111 000000111000 000000100111 000000101000 000001011000 000001011001 000000101011 000000101100 000001011010 000001100110 000001100111'.split(' ');
  const BM = '0000001111 000011001000 000011001001 000001011011 000000110011 000000110100 000000110101 0000001101100 0000001101101 0000001001010 0000001001011 0000001001100 0000001001101 0000001110010 0000001110011 0000001110100 0000001110101 0000001110110 0000001110111 0000001010010 0000001010011 0000001010100 0000001010101 0000001011010 0000001011011 0000001100100 0000001100101'.split(' ');
  const XM = '00000001000 00000001100 00000001101 000000010010 000000010011 000000010100 000000010101 000000010110 000000010111 000000011100 000000011101 000000011110 000000011111'.split(' ');
  return { WT, WM, BT, BM, XM, V: { 0: '1', 1: '011', 2: '000011', 3: '0000011', '-1': '010', '-2': '000010', '-3': '0000010' } };
})();
function optG4(bits, W, H) {
  const out = []; let acc = 0, nbits = 0;
  const put = (code) => { for (let i = 0; i < code.length; i++) { acc = (acc << 1) | (code.charCodeAt(i) - 48); if (++nbits === 8) { out.push(acc); acc = 0; nbits = 0; } } };
  const run = (len, black) => {
    const T = black ? OPT_G4.BT : OPT_G4.WT, M = black ? OPT_G4.BM : OPT_G4.WM;
    while (len >= 2624) { put(OPT_G4.XM[12]); len -= 2560; }
    if (len >= 64) { const m = len >> 6; put(m <= 27 ? M[m - 1] : OPT_G4.XM[m - 28]); len -= m << 6; }
    put(T[len]);
  };
  let ref = new Uint8Array(W); const cur = new Uint8Array(W);
  // The next changing element after x (pixel x+1… differs from the one before it; -1 and the left edge are white).
  const next = (line, x) => { for (let i = Math.max(0, x + 1); i < W; i++) if (line[i] !== (i ? line[i - 1] : 0)) return i; return W; };
  const colorAt = (line, i) => (i < 0 || i >= W ? 0 : line[i]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) cur[x] = bits[y * W + x] ? 1 : 0;
    let a0 = -1, color = 0;
    while (a0 < W) {
      const a1 = (() => { for (let i = a0 + 1; i < W; i++) if (cur[i] !== color) return i; return W; })();
      let b1 = next(ref, a0);
      while (b1 < W && colorAt(ref, b1) === color) b1 = next(ref, b1);
      const b2 = next(ref, b1);
      if (b2 < a1) { put('0001'); a0 = b2; continue; }
      const d = a1 - b1;
      if (d >= -3 && d <= 3) { put(OPT_G4.V[d]); a0 = a1; color ^= 1; continue; }
      const a2 = (() => { for (let i = a1 + 1; i < W; i++) if (cur[i] === color) return i; return W; })();
      put('001'); run(a1 - Math.max(0, a0), color === 1); run(a2 - a1, color !== 1);
      a0 = a2;
    }
    ref = Uint8Array.from(cur);
  }
  put('000000000001'); put('000000000001');
  if (nbits) out.push(acc << (8 - nbits));
  return new Uint8Array(out);
}

/* ----- where pictures are drawn ----- */
// The largest size (points) each image XObject is drawn at, by ref tag.
function optPlacements(L, out) {
  const N = L.PDFName.of, ctx = out.context, placed = new Map(), noWidths = () => [];
  const walk = (src, res, ctm0, depth) => {
    const xo = res && res.lookup(N('XObject')); if (!(xo instanceof L.PDFDict)) return;
    try {
      walkContent(src, noWidths, null, (im) => {
        if (im.inline || !im.name) return;
        const ref = xo.get(N(im.name)), obj = ctx.lookup(ref); if (!(ref instanceof L.PDFRef) || !(obj instanceof L.PDFStream)) return;
        const ctm = mul(im.ctm, ctm0), sub = String(obj.dict.lookup(N('Subtype')));
        if (sub === '/Image') { const w = Math.hypot(ctm[0], ctm[1]), h = Math.hypot(ctm[2], ctm[3]), was = placed.get(ref.tag); placed.set(ref.tag, { w: Math.max(w, was ? was.w : 0), h: Math.max(h, was ? was.h : 0) }); }
        else if (sub === '/Form' && depth < 8) {
          const mt = optNums(L, ctx, obj.dict.get(N('Matrix'))) || [1, 0, 0, 1, 0, 0], fr = obj.dict.lookup(N('Resources'));
          const b = optDecoded(L, obj); if (b) walk(optStr(b), fr instanceof L.PDFDict ? fr : res, mul(mt, ctm), depth + 1);
        }
      });
    } catch (e) { console.warn('optimize: reading a page failed', e); }
  };
  for (const p of out.getPages()) {
    const raw = p.node.get(N('Contents')), rc = raw && ctx.lookup(raw);
    const parts = rc instanceof L.PDFArray ? rc.asArray() : raw ? [raw] : [];
    const src = parts.map((r) => { const s0 = ctx.lookup(r); const b = s0 && optDecoded(L, s0); return b ? optStr(b) : ''; }).join('\n');
    walk(src, p.node.Resources(), [1, 0, 0, 1, 0, 0], 0);
  }
  return placed;
}

/* ----- the pictures step ----- */
const OPT_KEEP_KEYS = ['Intent', 'Interpolate', 'OC', 'Metadata', 'StructParent', 'ID', 'Name', 'Alternates', 'OPI'];
async function optImages(L, out, J, opts, stats) {
  if (opts.lossless) return;
  const N = L.PDFName.of, ctx = out.context, placed = optPlacements(L, out), smasks = new Set();
  for (const [, o] of ctx.enumerateIndirectObjects()) if (o instanceof L.PDFStream) { const s = o.dict.get(N('SMask')); if (s instanceof L.PDFRef) smasks.add(s.tag); }
  const q = Math.max(.1, Math.min(1, (+opts.quality || 75) / 100));
  for (const [ref, st] of [...ctx.enumerateIndirectObjects()]) {
    if (!(st instanceof L.PDFRawStream) || String(st.dict.lookup(N('Subtype'))) !== '/Image' || smasks.has(ref.tag)) continue;
    const info = optImageInfo(L, ctx, st); if (!info || info.colorKey) continue;
    const at = placed.get(ref.tag), oldLen = st.getContents().length;
    const ppi = at && at.w > .5 && at.h > .5 ? Math.min(info.W / (at.w / 72), info.H / (at.h / 72)) : 0;
    const cls = info.bilevel ? opts.mono : opts.color;
    const shrink = !!ppi && cls.dpi > 0 && ppi > Math.max(cls.dpi, +cls.above || 0) && (!info.bilevel || cls.mode !== 'keep');
    const tw = shrink ? Math.max(1, Math.round(info.W * cls.dpi / ppi)) : info.W, th = shrink ? Math.max(1, Math.round(info.H * cls.dpi / ppi)) : info.H;
    try {
      if (info.bilevel) { await optBilevel(L, out, J, ref, st, info, { shrink, tw, th, mode: cls.mode }, stats); continue; }
      const isCmyk = info.cs.kind === 'cmyk' || (info.cs.kind === 'indexed' && info.cs.base.kind === 'cmyk');
      const convert = (isCmyk && opts.cmyk) || (opts.gray && info.cs.kind !== 'gray' && !(info.cs.kind === 'indexed' && info.cs.base.kind === 'gray'));
      const lossy16 = info.bpc === 16;
      const isJpeg = info.filters.length === 1 && info.filters[0] === '/DCTDecode';
      const photo = opts.photos && !isJpeg && info.W * info.H >= 4096 && info.cs.kind !== 'indexed' && info.bpc === 8;
      if (!shrink && !convert && !lossy16 && !photo) continue;
      if (isCmyk && !opts.cmyk) continue;
      const px = await optDecodeImage(L, ctx, st, info, opts); if (!px) continue;
      let data = px.data, comps = px.comps;
      if (opts.gray && comps === 3) { data = optGrayOf(data, info.W * info.H); comps = 1; }
      if (shrink) data = optResize(data, info.W, info.H, comps, tw, th);
      // the soft mask follows the picture's size
      let smaskRef = st.dict.get(N('SMask')), newMask = null, oldMaskLen = 0;
      const sm = smaskRef instanceof L.PDFRef ? ctx.lookup(smaskRef) : null;
      if (shrink && sm instanceof L.PDFRawStream) {
        const mi = optImageInfo(L, ctx, sm); oldMaskLen = sm.getContents().length;
        const mp = mi && (mi.W !== tw || mi.H !== th) ? await optDecodeImage(L, ctx, sm, { ...mi, cs: { kind: 'gray', comps: 1 } }, opts) : null;
        if (mi && (mi.W !== tw || mi.H !== th)) {
          if (!mp) continue; // a mask that can't be read: the picture stays as it is
          const g = optResize(mp.data, mi.W, mi.H, 1, tw, th);
          newMask = { bytes: await optDeflate(optPredict(g, tw, th, 1)), w: tw, h: th, matte: sm.dict.get(N('Matte')) };
        }
      }
      const flate = await optDeflate(optPredict(data, tw, th, comps));
      const cands = [{ kind: 'flate', bytes: flate }];
      if (!opts.lossless) { const jpg = await optJpeg(data, tw, th, comps, q); if (jpg) cands.push({ kind: 'jpeg', bytes: jpg }); }
      cands.sort((a, b) => a.bytes.length - b.bytes.length);
      const best = cands[0];
      const was = oldLen + (newMask ? oldMaskLen : 0), now = best.bytes.length + (newMask ? newMask.bytes.length : 0);
      // a lossless photo is only turned into JPEG when that gains a lot; any other change must gain something
      if (now >= was * (!shrink && !convert && !lossy16 ? .5 : .97)) continue;
      const outComps = best.kind === 'jpeg' ? 3 : comps;
      let csObj = outComps === 1 ? N('DeviceGray') : N('DeviceRGB');
      // a picture in an ICC colour space keeps its profile when its colours were not changed
      if (!convert && info.cs.icc && info.cs.comps === outComps) csObj = st.dict.get(N('ColorSpace'));
      else if (!convert && info.cs.kind === 'indexed' && info.cs.base.comps === outComps) { const a = ctx.lookup(st.dict.get(N('ColorSpace'))); if (a instanceof L.PDFArray) csObj = a.get(1); }
      const dict = { Type: 'XObject', Subtype: 'Image', Width: tw, Height: th, BitsPerComponent: 8 };
      const ns = best.kind === 'jpeg' ? ctx.stream(best.bytes, { ...dict, Filter: 'DCTDecode' }) : ctx.stream(best.bytes, { ...dict, Filter: 'FlateDecode', DecodeParms: { Predictor: 15, Colors: outComps, BitsPerComponent: 8, Columns: tw } });
      ns.dict.set(N('ColorSpace'), csObj);
      for (const k of OPT_KEEP_KEYS) { const v = st.dict.get(N(k)); if (v) ns.dict.set(N(k), v); }
      const mk = st.dict.get(N('Mask')); if (mk instanceof L.PDFRef) ns.dict.set(N('Mask'), mk);
      if (smaskRef) ns.dict.set(N('SMask'), smaskRef);
      if (newMask) {
        const ms = ctx.stream(newMask.bytes, { Type: 'XObject', Subtype: 'Image', Width: tw, Height: th, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode', DecodeParms: { Predictor: 15, Colors: 1, BitsPerComponent: 8, Columns: tw } });
        if (newMask.matte) ms.dict.set(N('Matte'), newMask.matte);
        J.assign(smaskRef, ms);
      }
      J.assign(ref, ns);
      stats.images++; stats.imageBytes += was - now;
    } catch (e) { console.warn('optimize: a picture was left as it was', e); }
  }
}
async function optBilevel(L, out, J, ref, st, info, { shrink, tw, th, mode }, stats) {
  if (mode === 'keep') return;
  const N = L.PDFName.of, ctx = out.context, { W, H } = info, old = st.getContents().length;
  const isCcitt = info.filters.length === 1 && /^\/(CCITTFaxDecode|JBIG2Decode)$/.test(info.filters[0]);
  if (!shrink && isCcitt) return; // already a fax or JBIG2 picture at a fine size
  let black = null;
  const parms = optParms(L, ctx, st.dict);
  if (info.filters.length === 0 || (info.filters.length === 1 && info.filters[0] === '/FlateDecode')) {
    let raw = info.filters.length ? await optInflate(st.getContents()) : st.getContents();
    if (raw && parms) raw = optUnpredict(raw, parms, W, 1, 1);
    const s = raw && optSamples(raw, W, H, 1, 1);
    if (s) { const inv = info.decode && info.decode[0] > info.decode[1]; black = new Uint8Array(W * H); for (let i = 0; i < black.length; i++) black[i] = (s[i] === 0) !== !!inv ? 1 : 0; }
  }
  if (!black) {
    try { const px = await optRenderWithPdfjs(L, ctx, st, W, H); black = new Uint8Array(W * H); for (let i = 0; i < black.length; i++) black[i] = px[i * 4] < 128 ? 1 : 0; }
    catch (e) { console.warn('optimize: a black-and-white picture could not be read', e); return; }
  }
  let bits = black, w = W, h = H;
  if (shrink) { const g = optResize(black, W, H, 1, tw, th); bits = new Uint8Array(tw * th); for (let i = 0; i < bits.length; i++) bits[i] = g[i] >= .5 ? 1 : 0; w = tw; h = th; }
  const cands = [{ kind: 'flate', bytes: await optDeflate(optPack1(bits, w, h)) }];
  if (await optG4Shown(L)) {
    const g4 = optG4(bits, w, h);
    if (g4.length < cands[0].bytes.length && await optCheckG4(L, g4, bits, w, h, true)) cands.push({ kind: 'g4', bytes: g4 });
  }
  cands.sort((a, b) => a.bytes.length - b.bytes.length);
  const best = cands[0];
  if (best.bytes.length >= old * .97 && !shrink) return;
  if (best.bytes.length >= old) return;
  const base = { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceGray', BitsPerComponent: 1 };
  const ns = best.kind === 'g4' ? ctx.stream(best.bytes, { ...base, Filter: 'CCITTFaxDecode', DecodeParms: { K: -1, Columns: w, Rows: h, BlackIs1: false } }) : ctx.stream(best.bytes, { ...base, Filter: 'FlateDecode' });
  for (const k of OPT_KEEP_KEYS) { const v = st.dict.get(N(k)); if (v) ns.dict.set(N(k), v); }
  for (const k of ['SMask', 'Mask']) { const v = st.dict.get(N(k)); if (v instanceof L.PDFRef) ns.dict.set(N(k), v); }
  J.assign(ref, ns);
  stats.images++; stats.imageBytes += old - best.bytes.length;
}
// G4 is written only when this app's own pages show it (pdf.js reads CCITT with its WebAssembly decoder, which the
// viewer must be given), and each G4 picture must read back the same, pixel for pixel; otherwise 1-bit Flate is used.
let optG4Probe = null;
function optG4Shown(L) {
  return optG4Probe || (optG4Probe = (async () => {
    const w = 24, h = 8, bits = new Uint8Array(w * h); for (let i = 0; i < bits.length; i++) bits[i] = (i % w) > 5 && (i % w) < 15 ? 1 : 0;
    return optCheckG4(L, optG4(bits, w, h), bits, w, h, true);
  })());
}
async function optCheckG4(L, g4, bits, w, h, viewer = false) {
  try {
    const d = await L.PDFDocument.create();
    const st = d.context.stream(g4, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceGray', BitsPerComponent: 1, Filter: 'CCITTFaxDecode', DecodeParms: { K: -1, Columns: w, Rows: h, BlackIs1: false } });
    const px = await optRenderWithPdfjs(L, d.context, st, w, h, viewer);
    for (let i = 0; i < bits.length; i++) if ((px[i * 4] < 128 ? 1 : 0) !== bits[i]) return false;
    return true;
  } catch (e) { console.warn('optimize: G4 check failed', e); return false; }
}

/* ----- duplicates ----- */
async function optDedupe(L, out, J, stats) {
  const N = L.PDFName.of, ctx = out.context;
  for (let pass = 0; pass < 4; pass++) {
    // what may be merged: pictures, form XObjects, embedded font files and ICC profiles
    const want = new Set();
    const visit = (o, depth = 0) => {
      if (!o || depth > 40) return;
      if (o instanceof L.PDFArray) {
        if (o.size() === 2 && String(o.get(0)) === '/ICCBased' && o.get(1) instanceof L.PDFRef) want.add(o.get(1).tag);
        for (const v of o.asArray()) if (!(v instanceof L.PDFRef)) visit(v, depth + 1);
      } else if (o instanceof L.PDFDict) {
        for (const k of ['FontFile', 'FontFile2', 'FontFile3']) { const v = o.get(N(k)); if (v instanceof L.PDFRef) want.add(v.tag); }
        for (const [, v] of o.entries()) if (!(v instanceof L.PDFRef)) visit(v, depth + 1);
      }
    };
    const all = [...ctx.enumerateIndirectObjects()];
    for (const [ref, o] of all) {
      visit(o instanceof L.PDFStream ? o.dict : o);
      if (o instanceof L.PDFStream && /^\/(Image|Form)$/.test(String(o.dict.lookup(N('Subtype'))))) want.add(ref.tag);
    }
    const first = new Map(), dup = new Map();
    for (const [ref, o] of all) {
      if (!want.has(ref.tag) || !(o instanceof L.PDFRawStream)) continue;
      const head = o.dict.entries().filter(([k]) => k.asString() !== '/Length').map(([k, v]) => k.asString() + ' ' + v.toString()).join('\n');
      const h = await optSha1([head, '\n', o.getContents()]);
      if (first.has(h)) dup.set(ref.tag, first.get(h)); else first.set(h, ref);
    }
    if (!dup.size) return;
    stats.merged += dup.size;
    const swap = (container, get, set, keys) => { for (const k of keys) { const v = get(k); if (v instanceof L.PDFRef && dup.has(v.tag)) set(k, dup.get(v.tag)); } };
    const seen = new Set();
    const fix = (o, depth = 0) => {
      if (!o || depth > 60 || seen.has(o)) return; seen.add(o);
      if (o instanceof L.PDFDict) {
        const keys = o.keys(); swap(o, (k) => o.get(k), (k, v) => J.set(o, k, v), keys);
        for (const k of keys) { const v = o.get(k); if (!(v instanceof L.PDFRef)) fix(v, depth + 1); }
      } else if (o instanceof L.PDFArray) {
        for (let i = 0; i < o.size(); i++) { const v = o.get(i); if (v instanceof L.PDFRef) { if (dup.has(v.tag)) J.aset(o, i, dup.get(v.tag)); } else fix(v, depth + 1); }
      } else if (o instanceof L.PDFStream) fix(o.dict, depth + 1);
    };
    for (const [, o] of ctx.enumerateIndirectObjects()) fix(o);
    const t = ctx.trailerInfo; for (const k of ['Root', 'Info']) if (t[k] instanceof L.PDFRef && dup.has(t[k].tag)) t[k] = dup.get(t[k].tag);
    optCollect(L, out, J);
  }
}
// Objects nothing refers to are dropped (duplicates, replaced masks…).
function optCollect(L, out, J) {
  const ctx = out.context, seen = new Set(), stack = [];
  const visit = (o) => {
    if (!o) return;
    if (o instanceof L.PDFRef) { if (seen.has(o.tag)) return; seen.add(o.tag); const t = ctx.lookup(o); if (t) stack.push(t); return; }
    if (o instanceof L.PDFDict) { for (const [, v] of o.entries()) visit(v); return; }
    if (o instanceof L.PDFArray) { for (const v of o.asArray()) visit(v); return; }
    if (o.dict instanceof L.PDFDict) visit(o.dict);
  };
  const t = ctx.trailerInfo; visit(t.Root); visit(t.Info); visit(t.Encrypt);
  while (stack.length) visit(stack.pop());
  let n = 0;
  for (const [ref] of [...ctx.enumerateIndirectObjects()]) if (!seen.has(ref.tag)) { J.drop(ref); n++; }
  return n;
}

/* ----- clean-up ----- */
const OPT_RES_KINDS = ['XObject', 'Font', 'ExtGState', 'Pattern', 'Shading', 'ColorSpace', 'Properties'];
const optName = (s) => s.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
function optUnused(L, out, J, stats) {
  const N = L.PDFName.of, ctx = out.context;
  const usage = new Map(), unsafe = new Set(), orphan = new Set();
  const namesIn = (st) => { const b = st && optDecoded(L, st); if (!b) return null; const set = new Set(); for (const m of optStr(b).matchAll(/\/([^\s\/\[\]<>(){}%]+)/g)) set.add(optName(m[1])); return set; };
  const use = (res, names) => {
    res = ctx.lookup(res);
    if (!names) { if (res instanceof L.PDFDict) unsafe.add(res); else orphan.add('*'); return; }
    if (!(res instanceof L.PDFDict)) { for (const n of names) orphan.add(n); return; }
    let s = usage.get(res); if (!s) usage.set(res, s = new Set()); for (const n of names) s.add(n);
  };
  for (const p of out.getPages()) {
    const raw = p.node.get(N('Contents')), rc = raw && ctx.lookup(raw);
    const parts = rc instanceof L.PDFArray ? rc.asArray().map((r) => ctx.lookup(r)) : rc ? [rc] : [];
    const names = new Set(); let bad = false;
    for (const s of parts) { const n = namesIn(s); if (!n) bad = true; else for (const x of n) names.add(x); }
    use(p.node.Resources(), bad ? null : names);
  }
  // every other content: form XObjects (appearances among them), tiling patterns, Type 3 glyphs
  const apStreams = new Set();
  for (const [, o] of ctx.enumerateIndirectObjects()) {
    if (!(o instanceof L.PDFDict)) continue;
    const ap = o.lookup(N('AP')); if (!(ap instanceof L.PDFDict)) continue;
    for (const [, v] of ap.entries()) { const x = ctx.lookup(v); if (x instanceof L.PDFStream) apStreams.add(x); else if (x instanceof L.PDFDict) for (const [, w] of x.entries()) { const y = ctx.lookup(w); if (y instanceof L.PDFStream) apStreams.add(y); } }
  }
  for (const [, o] of ctx.enumerateIndirectObjects()) {
    if (o instanceof L.PDFStream) {
      const sub = String(o.dict.lookup(N('Subtype'))), pat = optNum(L, ctx, o.dict.get(N('PatternType')));
      if (sub === '/Form' || pat === 1 || apStreams.has(o)) use(o.dict.get(N('Resources')), namesIn(o));
    } else if (o instanceof L.PDFDict && String(o.lookup(N('Subtype'))) === '/Type3') {
      const cp = o.lookup(N('CharProcs')), names = new Set(); let bad = false;
      if (cp instanceof L.PDFDict) for (const [, v] of cp.entries()) { const n = namesIn(ctx.lookup(v)); if (!n) bad = true; else for (const x of n) names.add(x); }
      use(o.get(N('Resources')), bad ? null : names);
    }
  }
  if (orphan.has('*')) return;
  // a kind dict shared by several resource dicts keeps what any of them uses
  const kindUse = new Map(), kindBad = new Set();
  for (const [res, names] of usage) for (const k of OPT_RES_KINDS) {
    const sub = res.lookup(N(k)); if (!(sub instanceof L.PDFDict)) continue;
    if (unsafe.has(res)) { kindBad.add(sub); continue; }
    let s = kindUse.get(sub); if (!s) kindUse.set(sub, s = new Set()); for (const n of names) s.add(n);
  }
  for (const res of unsafe) for (const k of OPT_RES_KINDS) { const sub = ctx.lookup(res.get(N(k))); if (sub instanceof L.PDFDict) kindBad.add(sub); }
  // The form's default resources (AcroForm /DR) stay whole: a field's /DA names its font there, and viewers that
  // draw a field again when it is filled look the font up in it (and in dicts that share it).
  const acro = out.catalog.lookup(N('AcroForm')), dr = acro instanceof L.PDFDict ? acro.lookup(N('DR')) : null;
  if (dr instanceof L.PDFDict) for (const k of OPT_RES_KINDS) { const sub = dr.lookup(N(k)); if (sub instanceof L.PDFDict) kindBad.add(sub); }
  // and a font a /DA names is kept wherever it is
  for (const [, o] of [[null, acro], ...ctx.enumerateIndirectObjects()]) {
    const d = o instanceof L.PDFDict ? o : null, da = d && d.lookup(N('DA'));
    if (da && da.decodeText) { try { for (const m of da.decodeText().matchAll(/\/([^\s\/\[\]<>(){}%]+)\s+[-+.\d]+\s+Tf/g)) orphan.add(optName(m[1])); } catch {} }
  }
  for (const [sub, names] of kindUse) {
    if (kindBad.has(sub)) continue;
    for (const key of sub.keys()) {
      const n = optName(key.asString().slice(1));
      if (names.has(n) || orphan.has(n) || /^Default(RGB|Gray|CMYK)$/.test(n)) continue;
      J.del(sub, key); stats.unused++;
    }
  }
}
// The clean-up asked for for privacy or safety (XMP metadata, JavaScript, tags): always done, whatever the size gain.
function optPrivacy(L, out, J, opts) {
  const N = L.PDFName.of, ctx = out.context, cat = out.catalog, c = (opts && opts.clean) || {};
  if (c.metadata) {
    J.del(cat, N('Metadata'));
    for (const [, o] of ctx.enumerateIndirectObjects()) { const d = o instanceof L.PDFDict ? o : o instanceof L.PDFStream ? o.dict : null; if (d && d !== cat) J.del(d, N('Metadata')); }
  }
  if (c.javascript) {
    const names = cat.lookup(N('Names')); if (names instanceof L.PDFDict) J.del(names, N('JavaScript'));
    const isJs = (v) => { const d = ctx.lookup(v); return d instanceof L.PDFDict && /^\/(JavaScript|Rendition|Launch|ImportData)$/.test(String(d.lookup(N('S')))); };
    for (const [, o] of [[null, cat], ...ctx.enumerateIndirectObjects()]) {
      const d = o instanceof L.PDFDict ? o : null; if (!d) continue;
      J.del(d, N('AA'));
      for (const k of ['A', 'OpenAction', 'Next']) { const v = d.get(N(k)); if (v && isJs(v)) J.del(d, N(k)); }
    }
  }
  if (c.tags) {
    J.del(cat, N('StructTreeRoot')); J.del(cat, N('MarkInfo'));
    for (const [, o] of ctx.enumerateIndirectObjects()) { const d = o instanceof L.PDFDict ? o : o instanceof L.PDFStream ? o.dict : null; if (d) { J.del(d, N('StructParents')); J.del(d, N('StructParent')); } }
  }
}
// Does that clean-up now, outside any journal (so it is never undone), and drops the objects it left unused (the
// removed scripts must not stay in the file). The number of changes it made.
function optRequired(L, out, opts) {
  const J = optJournal(L, out.context);
  optPrivacy(L, out, J, opts);
  if (J.size) optCollect(L, out, J);
  return J.size;
}
function optCleanUp(L, out, J, opts, stats) {
  const N = L.PDFName.of, ctx = out.context, cat = out.catalog, c = opts.clean || {};
  if (c.editData !== false) {
    J.del(cat, N('PieceInfo'));
    for (const p of out.getPages()) { J.del(p.node, N('PieceInfo')); if (p.node.has(N('Thumb'))) { J.del(p.node, N('Thumb')); stats.thumbs++; } }
    for (const [, o] of ctx.enumerateIndirectObjects()) if (o instanceof L.PDFStream && String(o.dict.lookup(N('Subtype'))) === '/Form') J.del(o.dict, N('PieceInfo'));
  }
  optPrivacy(L, out, J, opts);
  if (c.unused !== false) optUnused(L, out, J, stats);
}

/* ----- packing streams ----- */
const OPT_PLAIN_FILTERS = new Set(['/ASCIIHexDecode', '/ASCII85Decode', '/LZWDecode', '/FlateDecode', '/RunLengthDecode', '/AHx', '/A85', '/LZW', '/Fl', '/RL']);
async function optRedeflate(L, out, J, opts, stats) {
  const N = L.PDFName.of, ctx = out.context;
  for (const [ref, o] of [...ctx.enumerateIndirectObjects()]) {
    if (!(o instanceof L.PDFStream)) continue;
    const d = o.dict, type = String(d.lookup(N('Type')) || ''), sub = String(d.lookup(N('Subtype')) || '');
    if (/^\/(XRef|ObjStm)$/.test(type)) continue;
    if (opts.lossless && sub === '/Image') continue; // Lossless only: pictures stay byte for byte
    let plain = null, keepParms = false, old;
    if (o instanceof L.PDFRawStream) {
      old = o.getContents().length;
      const f = optFilters(L, d);
      if (!f.length) { if (type === '/Metadata' || old < 64) continue; plain = o.getContents(); }
      else if (f.length === 1 && (f[0] === '/FlateDecode' || f[0] === '/Fl')) { plain = await optInflate(o.getContents()); keepParms = true; }
      else if (f.every((x) => OPT_PLAIN_FILTERS.has(x)) && !d.has(N('DecodeParms')) && !d.has(N('DP'))) plain = optDecoded(L, o);
      else continue;
    } else if (L.PDFFlateStream && o instanceof L.PDFFlateStream) {
      try { plain = o.getUnencodedContents(); old = o.getContentsSize(); } catch { continue; }
      if (type === '/Metadata') continue;
    } else continue;
    if (!plain) continue;
    const packed = await optDeflate(plain);
    if (packed.length >= old) continue;
    const nd = d.clone(ctx);
    nd.delete(N('Length'));
    if (!keepParms) { nd.delete(N('DecodeParms')); nd.delete(N('DP')); }
    nd.set(N('Filter'), N('FlateDecode'));
    J.assign(ref, L.PDFRawStream.of(nd, packed));
    stats.streams++; stats.streamBytes += old - packed.length;
  }
}

/* ----- the whole job ----- */
// Changes `out` in place (every change is in the returned journal, which can undo them). Never saves.
async function optimizeDoc(L, out, opts) {
  opts = opts && opts.color ? opts : optOptions(opts && opts.preset, opts);
  const J = optJournal(L, out.context), stats = { images: 0, imageBytes: 0, streams: 0, streamBytes: 0, merged: 0, unused: 0, thumbs: 0 };
  optCleanUp(L, out, J, opts, stats);
  optCollect(L, out, J);
  await optImages(L, out, J, opts, stats);
  if ((opts.clean || {}).dedupe !== false) await optDedupe(L, out, J, stats);
  await optRedeflate(L, out, J, opts, stats);
  optCollect(L, out, J);
  J.stats = stats;
  return J;
}
// A signed PDF loses its signatures when it is written again.
function optSigned(L, out) {
  const acro = out.catalog.lookup(L.PDFName.of('AcroForm'));
  const sf = acro instanceof L.PDFDict ? optNum(L, out.context, acro.get(L.PDFName.of('SigFlags'))) : 0;
  return !!(sf & 1);
}
// Optimizes the bytes of a PDF. { bytes, before, after, same, reason?, stats } — `same` when the PDF was kept as it
// was (nothing gained, or it can't be optimized: protected or signed).
async function optimizeBytes(bytes, opts = {}) {
  const L = await loadPdfLib(), before = bytes.length;
  const keep = (reason, stats) => ({ bytes, before, after: before, same: true, reason, stats: stats || null });
  let out;
  try { out = await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); } catch (e) { return keep('unreadable'); }
  if (out.isEncrypted) return keep('protected');
  if (optSigned(L, out) && !opts.allowSigned) return keep('signed');
  opts = opts && opts.color ? opts : optOptions(opts && opts.preset, opts);
  // Clean-up asked for for privacy is kept even when the file gains nothing in size.
  const cleaned = optRequired(L, out, opts) ? await out.save({ useObjectStreams: true }) : null;
  const J = await optimizeDoc(L, out, opts);
  const res = await out.save({ useObjectStreams: true });
  if (cleaned) {
    const best = optGains(cleaned.length, res.length) ? res : cleaned;
    return { bytes: best, before, after: best.length, same: false, cleaned: true, stats: J.stats };
  }
  if (!optGains(before, res.length)) return keep('compact', J.stats);
  return { bytes: res, before, after: res.length, same: false, stats: J.stats };
}

/* ----- where the space goes ----- */
async function optAudit(bytes) {
  const L = await loadPdfLib(), N = L.PDFName.of;
  const out = await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }), ctx = out.context;
  const kind = new Map(), mark = (ref, k) => { if (ref instanceof L.PDFRef && !kind.has(ref.tag)) kind.set(ref.tag, k); };
  for (const p of out.getPages()) { const c = p.node.get(N('Contents')), a = ctx.lookup(c); if (a instanceof L.PDFArray) a.asArray().forEach((r) => mark(r, 'content')); else mark(c, 'content'); }
  for (const [ref, o] of ctx.enumerateIndirectObjects()) {
    const d = o instanceof L.PDFDict ? o : o instanceof L.PDFStream ? o.dict : null; if (!d) continue;
    const type = String(d.lookup(N('Type')) || ''), sub = String(d.lookup(N('Subtype')) || '');
    if (sub === '/Image') mark(ref, 'images');
    else if (sub === '/Form') mark(ref, 'content');
    if (type === '/Font' || type === '/FontDescriptor' || /^\/(Type0|Type1|TrueType|Type3|CIDFontType[02]|MMType1)$/.test(sub)) {
      mark(ref, 'fonts');
      for (const k of ['FontFile', 'FontFile2', 'FontFile3', 'ToUnicode', 'FontDescriptor', 'Widths', 'CIDToGIDMap', 'Encoding']) mark(d.get(N(k)), 'fonts');
      const df = d.lookup(N('DescendantFonts')); if (df instanceof L.PDFArray) df.asArray().forEach((r) => mark(r, 'fonts'));
    }
  }
  const sums = { images: 0, fonts: 0, content: 0, other: 0 };
  for (const [ref, o] of ctx.enumerateIndirectObjects()) { let n = 0; try { n = o.sizeInBytes(); } catch {} sums[kind.get(ref.tag) || 'other'] += n; }
  const total = Object.values(sums).reduce((a, b) => a + b, 0) || 1, scale = bytes.length / total;
  return Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, Math.round(v * scale)]));
}

/* ----- in the app: a setting applied when the PDF is saved ----- */
let optOverride = undefined, optMeasuring = false, optLast = null, optQuiet = false; // optQuiet: no toast (an action is running)
const optMark = () => (doc ? docMarks().find((m) => m.type === 'optimize') : null);
// A change is worth it when it saves more than a few bytes (re-writing a file alone can move its size a little).
const optGains = (before, after) => after < before - Math.max(64, before * .002);
const optSize = (n) => n < 1024 ? `${n} bytes` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
// Optimize is the only change to a PDF opened on its own: when it gains nothing, the file as it was opened is kept.
function optOnlyOptimize() {
  if (!doc || doc.sources.length !== 1 || doc.sources[0].password || doc.sources[0].ownerOnly) return false;
  if (Object.entries(doc.marks).some(([k, l]) => (l || []).some((m) => k !== '__doc' || m.type !== 'optimize'))) return false;
  const pd = pdfDocs.get(0);
  if (!pd || (pd.annotationStorage && pd.annotationStorage.size)) return false;
  return doc.pages.length === pd.numPages && doc.pages.every((e, n) => e.src === 0 && e.i === n && !e.rot && !e.crop);
}
FEATURE.saveDoc.push(async ({ L, out }) => {
  const m = optOverride !== undefined ? optOverride : optMark();
  if (!m || m.off) return;
  const opts = optOptions(m.opts && m.opts.preset, m.opts);
  const save = out.save.bind(out), only = optOnlyOptimize() ? doc.sources[0] : null;
  out.save = async (o = {}) => {
    const so = { useObjectStreams: true, ...o };
    // Sized unencrypted (saving encrypts the streams in place); the smaller is then saved, encrypted if it should be.
    const sec = out.context.security; let plain, packed, J = null, cleaned = 0, before;
    out.context.security = undefined;
    try {
      plain = await save(so); before = plain.length;
      // Clean-up asked for for privacy (JavaScript, XMP metadata, tags) is never undone, whatever the size.
      cleaned = optRequired(L, out, opts);
      if (cleaned) plain = await save(so);
      J = await optimizeDoc(L, out, opts);
      packed = await save(so);
      if (!optGains(plain.length, packed.length)) { J.undo(); packed = null; }
    } catch (e) { console.warn('optimize: kept the PDF as it was', e); if (J) J.undo(); packed = null; if (!plain) throw e; }
    finally { out.context.security = sec; }
    let res = sec ? await save(so) : packed || plain;
    const keepOrig = only && !cleaned && res.length >= only.length;
    if (keepOrig) res = new Uint8Array(only);
    const same = !cleaned && (!packed || keepOrig);
    optLast = { before: only ? only.length : before, after: res.length, same, cleaned: !!cleaned, stats: J && J.stats };
    if (!optMeasuring && !optQuiet) {
      if (same) toast('This PDF is already compact, so it was saved as it was');
      else if (cleaned && !packed) toast('This PDF is already compact. The clean-up you chose was done');
    }
    return res;
  };
});
// The PDF as it would be saved without optimizing (for the sizes in the dialog).
async function optBaseBytes() {
  const had = typeof protMeasuring !== 'undefined' ? protMeasuring : undefined;
  optOverride = { off: true }; optMeasuring = true;
  try { if (had !== undefined) protMeasuring = true; return await buildPdf(); }
  finally { optOverride = undefined; optMeasuring = false; if (had !== undefined) protMeasuring = had; }
}
function optSetMark(opts) {
  const before = snapshot(), list = docMarks();
  for (let k = list.length - 1; k >= 0; k--) if (list[k].type === 'optimize' || list[k].type === 'protcompress') list.splice(k, 1);
  if (opts) list.push({ id: uid(), type: 'optimize', opts });
  changed(before, 'Optimize');
}
// The dialog's form, from options; and options from the form.
function optFormHtml(o) {
  const radio = (k, p) => `<label class="prot-check"><input type="radio" name="optPreset" value="${k}"${o.preset === k ? ' checked' : ''}><span>${esc(p.label)}<small>${esc(p.note)}</small></span></label>`;
  const num = (name, v, label) => `<label class="field"><span>${label}</span><input type="number" name="${name}" min="10" max="2400" step="1" value="${esc(v)}" inputmode="numeric"></label>`;
  const ck = (name, on, label) => `<label class="prot-check"><input type="checkbox" name="${name}"${on ? ' checked' : ''}><span>${esc(label)}</span></label>`;
  return `<div class="opt-form">
    <div class="prot-checks">${Object.entries(OPT_PRESETS).map(([k, p]) => radio(k, p)).join('')}</div>
    <details class="opt-adv"><summary>Advanced</summary>
      <h3 class="opt-h">Colour and grey pictures</h3>
      <div class="opt-row">${num('cDpi', o.color.dpi, 'Make them (pixels per inch)')}${num('cAbove', o.color.above, 'Only when above')}</div>
      <label class="field opt-q"><span>JPEG quality <output name="qOut">${o.quality}</output></span><input type="range" name="quality" min="10" max="100" step="1" value="${o.quality}"></label>
      <div class="prot-checks">${ck('gray', o.gray, 'Make all pictures grey')}${ck('cmyk', o.cmyk, 'Convert CMYK pictures to RGB')}${ck('photos', o.photos, 'Store lossless photos as JPEG when much smaller')}</div>
      <h3 class="opt-h">Black-and-white pictures</h3>
      <label class="field"><span>Scans</span><select name="mMode"><option value="shrink"${o.mono.mode !== 'keep' ? ' selected' : ''}>Make smaller (stays black and white)</option><option value="keep"${o.mono.mode === 'keep' ? ' selected' : ''}>Keep as they are</option></select></label>
      <div class="opt-row">${num('mDpi', o.mono.dpi, 'Make them (pixels per inch)')}${num('mAbove', o.mono.above, 'Only when above')}</div>
      <h3 class="opt-h">Clean up</h3>
      <div class="prot-checks">${OPT_CLEAN.map(([k, label]) => ck('cl_' + k, o.clean[k], label)).join('')}</div>
    </details>
    <div class="prot-size opt-size" id="optSize" aria-live="polite">Working out the size…</div>
    <button type="button" class="btn opt-audit-btn" id="optAuditBtn">Audit space usage</button>
    <div id="optAudit" hidden></div>
  </div>`;
}
function optReadForm(root) {
  const v = (n) => { const el = root.querySelector(`[name="${n}"]`); return el ? (el.type === 'checkbox' ? el.checked : el.value) : null; };
  const preset = (root.querySelector('[name="optPreset"]:checked') || {}).value || 'smaller';
  const int = (n, d) => { const x = Math.round(+v(n)); return x > 0 ? x : d; };
  return optOptions(preset, {
    color: { dpi: int('cDpi', 150), above: int('cAbove', 225) }, mono: { dpi: int('mDpi', 300), above: int('mAbove', 450), mode: v('mMode') || 'shrink' },
    quality: int('quality', 75), gray: !!v('gray'), cmyk: !!v('cmyk'), photos: !!v('photos'),
    clean: Object.fromEntries(OPT_CLEAN.map(([k]) => [k, !!v('cl_' + k)])),
  });
}
// The advanced fields follow the preset chosen.
function optFillForm(root, o) {
  const set = (n, x) => { const el = root.querySelector(`[name="${n}"]`); if (!el) return; if (el.type === 'checkbox') el.checked = !!x; else el.value = x; };
  set('cDpi', o.color.dpi); set('cAbove', o.color.above); set('quality', o.quality); set('mDpi', o.mono.dpi); set('mAbove', o.mono.above); set('mMode', o.mono.mode); set('photos', o.photos);
  const q = root.querySelector('[name="qOut"]'); if (q) q.textContent = o.quality;
}
function optAuditHtml(a) {
  const total = Object.values(a).reduce((x, y) => x + y, 0) || 1;
  const rows = [['images', 'Pictures'], ['fonts', 'Fonts'], ['content', 'Page content'], ['other', 'Everything else']];
  return `<table class="opt-audit"><thead><tr><th>Kind</th><th>Size</th><th>Share</th></tr></thead><tbody>${rows.map(([k, label]) => `<tr data-kind="${k}"><td>${label}</td><td>${optSize(a[k] || 0)}</td><td>${Math.round((a[k] || 0) / total * 100)}%</td></tr>`).join('')}</tbody></table>`;
}
async function optDialog() {
  if (!has()) return;
  const cur = optMark();
  let opts = cur ? optOptions(cur.opts.preset, cur.opts) : optOptions('smaller');
  let base = null, ask = 0;
  const r = await dialog('Optimize', `<p>Makes the PDF smaller when you save. Everything happens on this device, and the file is never made bigger.</p>${optFormHtml(opts)}`,
    [...(cur ? [{ label: 'Don’t optimize', value: 'off' }] : []), { label: 'Cancel' }, { label: 'Optimize', value: 'on', primary: true }], (dlg) => {
      dlg.classList.add('opt-dlg');
      dlg.addEventListener('close', () => dlg.classList.remove('opt-dlg'), { once: true });
      const body = $('.dlg-body', dlg), out = $('#optSize', dlg);
      let timer;
      const show = async () => {
        const n = ++ask; opts = optReadForm(body);
        out.textContent = 'Working out the size…';
        try {
          if (!base) base = await optBaseBytes();
          if (!base) { out.textContent = 'The size can’t be worked out.'; return; }
          const res = await optimizeBytes(base, opts);
          if (n !== ask) return;
          const pc = Math.round((1 - res.after / res.before) * 100);
          out.dataset.before = res.before; out.dataset.after = res.after;
          out.classList.toggle('none', res.same || pc < 2);
          out.textContent = res.reason === 'protected' ? `Now ${optSize(res.before)}. Protected PDFs are optimized when they are saved.`
            : res.reason === 'signed' ? 'This PDF is signed: optimizing it would break the signature, so it is kept as it is.'
            : res.cleaned && !optGains(res.before, res.after) ? `Now ${optSize(res.before)}. This PDF is already compact, but the clean-up you chose will be done.`
            : res.same ? `Now ${optSize(res.before)}. This PDF is already compact: optimizing would not make it smaller, and it is never made bigger.`
            : `Now ${optSize(res.before)}. Optimized: ${optSize(res.after)} (${pc}% smaller).`;
        } catch (e) { console.warn(e); if (n === ask) out.textContent = 'The size can’t be worked out.'; }
      };
      const later = () => { clearTimeout(timer); timer = setTimeout(show, 250); };
      body.addEventListener('change', (e) => {
        if (e.target.name === 'optPreset') optFillForm(body, optOptions(e.target.value));
        later();
      });
      body.addEventListener('input', (e) => { if (e.target.name === 'quality') { const q = $('[name="qOut"]', body); if (q) q.textContent = e.target.value; } });
      $('#optAuditBtn', dlg).addEventListener('click', async () => {
        const box = $('#optAudit', dlg); box.hidden = false; box.textContent = 'Working it out…';
        try { if (!base) base = await optBaseBytes(); box.innerHTML = optAuditHtml(await optAudit(base)); } catch (e) { console.warn(e); box.textContent = 'The space can’t be worked out.'; }
      });
      show();
    });
  if (!r) return;
  if (r === 'off') { optSetMark(null); toast('The PDF won’t be optimized'); return; }
  optSetMark(opts);
  toast('The PDF will be optimized when you save');
}

cmd('optimize', { label: 'Optimize…', icon: 'shrink', enabled: has, pressed: () => !!optMark(), run: optDialog });
// Optimize takes Compress's place on the Protect tab and in its menu (Compress stays a command, for now).
{
  const g = (RIBBON.protect[1] || []).find(([label]) => label === 'Document');
  if (g) { const i = g[1].indexOf('protCompress'); if (i >= 0) g[1].splice(i, 1, 'optimize'); else g[1].push('optimize'); } else ribbonAdd('protect', 'Document', ['optimize']);
  const m = MENUS.find(([t]) => t === 'Protect');
  if (m) { const i = m[1].indexOf('protCompress'); if (i >= 0) m[1].splice(i, 1, 'optimize'); else menuAdd('Protect', ['optimize']); } else menuAdd('Protect', ['optimize']);
}
CHANGE_NAMES.optimize = 'Optimize';
// Patterns that test the G4 encoder's edges: each must read back the same in pdf.js.
async function optG4Check() {
  const L = await loadPdfLib(), res = [];
  let seed = 3; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const cases = {
    random: [61, 40, () => (rnd() > .5 ? 1 : 0)],
    edges: [33, 20, (x, y) => (x === 0 || x === 32 || y % 7 === 0 ? 1 : 0)],
    'long runs': [3000, 6, (x, y) => (y % 2 ? 1 : x > 2700 ? 1 : 0)],
    stripes: [128, 64, (x, y) => ((x >> 2) + (y >> 3)) % 2],
    'all black': [70, 9, () => 1],
    'all white': [70, 9, () => 0],
    text: [400, 120, (x, y) => (y > 20 && y < 60 && x % 37 < 20 && rnd() > .2 ? 1 : 0)],
  };
  for (const [name, [w, h, f]] of Object.entries(cases)) {
    const bits = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bits[y * w + x] = f(x, y);
    res.push({ name, ok: await optCheckG4(L, optG4(bits, w, h), bits, w, h) });
  }
  return res;
}
Object.assign(TEST_HOOKS, {
  optimizeBytes, optimizeOptions: optOptions, optAudit, optG4, optG4Check,
  optLast: () => optLast, optBaseBytes, optPdfjs: async () => { await loadPdfjs(); },
});
addStyle(`
.opt-dlg { width: min(600px, calc(100vw - 32px)); }
.opt-dlg .dlg-body { max-height: min(74vh, 720px); overflow: auto; }
.opt-adv { margin: 10px 0 4px; border: 1px solid var(--line); border-radius: 10px; padding: 6px 12px; }
.opt-adv summary { cursor: pointer; font-weight: 600; color: var(--ink); padding: 4px 0; }
.opt-h { margin: 12px 0 4px; font-size: 13px; font-weight: 600; color: var(--ink); }
.opt-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.opt-form .field { margin: 4px 0; min-width: 0; }
.opt-form .field > span { font-size: 12px; color: var(--ink-3); }
.opt-form .field input, .opt-form .field select { font: inherit; color: var(--ink); background: var(--chrome); border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; width: 100%; box-sizing: border-box; min-width: 0; }
.opt-form .field input[type="range"] { padding: 0; border: 0; background: none; accent-color: var(--accent); height: 32px; }
.opt-audit-btn { margin: 8px 0 4px; }
.opt-audit { width: 100%; border-collapse: collapse; font-size: 13px; margin: 4px 0; }
.opt-audit th, .opt-audit td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--line); color: var(--ink); }
.opt-audit th { color: var(--ink-3); font-weight: 500; }
.opt-audit td:not(:first-child), .opt-audit th:not(:first-child) { text-align: right; }
@media (max-width: 520px) { .opt-row { grid-template-columns: 1fr; } }
`);
