/* ---------------- OCR: recognize text on scanned pages ----------------
   Tools → "Recognize text (OCR)…" reads the words on scanned pages, on this device, with tesseract.js (Apache-2.0)
   loaded on first use, and lays them over the page as invisible text (render mode 3), the way scanners and
   PDFelement do. The page then has real text: it can be selected, searched with Find, copied and rewritten with
   the Edit PDF tool, on screen and in the saved PDF alike.

   How it is kept: the source PDF the pages come from is copied with the text layer added (a new entry in
   doc.sources, like a merged PDF), and the pages and their mark-up are pointed at the copy inside
   snapshot()/changed(). Undo points them back; Save writes the copy, so bookmarks, forms and links are kept.

   Before reading, each page image is cleaned up (91-ocr-clean.js: levels, which way the lines run, deskew,
   binarisation, despeckle), and the words found on the clean image are put back on the page through the same turn,
   so the invisible text lies on the words of the original scan. Words the reader is unsure of (under 60%) are listed
   in the sidebar's "Check words" tab to be put right; words under 20% are dropped. Options: several languages at once
   ('eng+fra'), pages that are sideways or upside down turned upright, the page image replaced by the clean,
   straightened one, and reading a scanned PDF as it opens. Pages that already have text can be read too: their text
   is covered over on the image first, so it is not doubled by invisible copies.

   The engine is replaceable: ocrEngine (TEST_HOOKS.ocrUseEngine) is any object with
     recognize(canvas, { lang, rotation, onProgress }) -> { lines: [{ words: [{ text, bbox: {x0,y0,x1,y1},
       confidence? }], baseline?: {x0,y0,x1,y1} }] }   (or { words: [...] }, grouped into lines here)
   and optional start(lang, onStatus), stop() and detect(canvas) -> { turn: 0 | 180 } (is the clean image upside
   down?). Boxes are in pixels of the canvas it is given. lang is one code or up to three joined with '+'. */

// Where the engine comes from. Exact versions, so the apps can carry the same files (set these to local paths).
const OCR_PATHS = {
  script: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
  corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
  langPath: (lang) => `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}@1.0.0/4.0.0_best_int`,
  noCache: false, // (true: languages are not kept between runs, as when IndexedDB can't be used; for the tests)
};
// Languages with trained data on npm as @tesseract.js-data/<code>@1.0.0.
const OCR_LANGS = [['eng', 'English'], ['fra', 'French'], ['deu', 'German'], ['spa', 'Spanish'], ['ita', 'Italian'], ['por', 'Portuguese'], ['nld', 'Dutch'],
  ['swe', 'Swedish'], ['dan', 'Danish'], ['nor', 'Norwegian'], ['fin', 'Finnish'], ['pol', 'Polish'], ['ces', 'Czech'], ['tur', 'Turkish'], ['ind', 'Indonesian'],
  ['vie', 'Vietnamese'], ['ell', 'Greek'], ['rus', 'Russian'], ['ukr', 'Ukrainian'], ['heb', 'Hebrew'], ['ara', 'Arabic'], ['hin', 'Hindi'], ['tha', 'Thai'],
  ['chi_sim', 'Chinese (simplified)'], ['chi_tra', 'Chinese (traditional)'], ['jpn', 'Japanese'], ['kor', 'Korean']];
// The size of each language's data (4.0.0_best_int, gzipped), in KB, to say what a first use downloads.
const OCR_SIZES = { fra: 691, deu: 1302, spa: 2051, ita: 1622, por: 1360, nld: 2935, swe: 2444, dan: 1802, nor: 2432, fin: 3706, pol: 2580, ces: 2173, tur: 2091, ind: 1166,
  vie: 1390, ell: 1294, rus: 2617, ukr: 2065, heb: 567, ara: 1623, hin: 1357, tha: 876, chi_sim: 1678, chi_tra: 1617, jpn: 1983, kor: 1535 };
const OCR_MAX_LANGS = 3;
const OCR_DPI = 300;
const OCR_SUSPECT = 60, OCR_DROP = 20; // confidence (%): under 60 the word is listed in Check words; under 20 it is left out
let ocrEngine = null;   // an engine given by the tests; otherwise tesseract.js
let ocrBusy = false;
const ocrPrefs = Object.assign({ lang: 'eng', orient: true, clean: false, onOpen: false }, store.get('ocr', {}));
const ocrLangName = (c) => (OCR_LANGS.find(([k]) => k === c) || [c, c])[1];
const ocrLangList = (lang) => [...new Set(String(lang || 'eng').split('+').filter((c) => OCR_LANGS.some(([k]) => k === c)))].slice(0, OCR_MAX_LANGS);
// Languages tesseract.js keeps once downloaded (in this origin's IndexedDB, as its worker does).
function ocrCached(code) {
  return new Promise((res) => {
    try {
      const r = indexedDB.open('keyval-store');
      r.onupgradeneeded = () => { try { r.result.createObjectStore('keyval'); } catch {} };
      r.onerror = () => res(false);
      r.onsuccess = () => {
        const d = r.result;
        try { const q = d.transaction('keyval', 'readonly').objectStore('keyval').count(`./${code}.traineddata`); q.onsuccess = () => { res(q.result > 0); d.close(); }; q.onerror = () => { res(false); d.close(); }; }
        catch { res(false); d.close(); }
      };
    } catch { res(false); }
  });
}

// A language downloaded here is put where tesseract.js looks first, so its worker is given the plain code. (Given as
// { code, data }, tesseract.js 5.1.1 loads the data but then starts with the bytes as the language's name, and fails.)
// It reads the gzipped data as it is. False when it can't be kept (no IndexedDB, as in some private windows).
// (with no bytes, the language is taken out again: data that would not start is not kept)
function ocrCacheWrite(code, bytes) {
  return new Promise((res) => {
    try {
      const r = indexedDB.open('keyval-store');
      r.onupgradeneeded = () => { try { r.result.createObjectStore('keyval'); } catch {} };
      r.onerror = () => res(false);
      r.onsuccess = () => {
        const d = r.result;
        try {
          const t = d.transaction('keyval', 'readwrite'), st = t.objectStore('keyval'), key = `./${code}.traineddata`;
          if (bytes) st.put(bytes, key); else st.delete(key);
          t.oncomplete = () => { d.close(); res(true); }; t.onerror = t.onabort = () => { d.close(); res(false); };
        } catch { d.close(); res(false); }
      };
    } catch { res(false); }
  });
}
async function ocrGunzip(bytes) {
  if (!(bytes[0] === 0x1f && bytes[1] === 0x8b)) return bytes;
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}

/* --- the engine --- */
function ocrLoadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => res(); s.onerror = () => { s.remove(); rej(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  });
}
// tesseract.js v5: one worker, for the languages of one run. English comes with the apps; another language is
// fetched once (each from its own package) and then kept by tesseract.js.
async function ocrLangData(code, onStatus) {
  const url = `${OCR_PATHS.langPath(code)}/${code}.traineddata.gz`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not get ${url}`);
  const total = +r.headers.get('content-length') || (OCR_SIZES[code] || 2000) * 1024;
  if (!r.body || !r.body.getReader) return new Uint8Array(await r.arrayBuffer());
  const rd = r.body.getReader(), parts = []; let got = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; if (onStatus) onStatus('loading traineddata', Math.min(1, got / total)); }
  const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
// Mean confidence of the words read on a canvas, the longer words counting for more.
function ocrMeanConfidence(data) {
  let sum = 0, n = 0, words = 0;
  for (const b of data.blocks || []) for (const para of b.paragraphs || []) for (const l of para.lines || []) for (const w of l.words || []) {
    const t = String(w.text || '').trim(); if (t.length < 2) continue;
    sum += (w.confidence || 0) * t.length; n += t.length; words++;
  }
  return { score: n ? sum / n : 0, words };
}
// The Android app: its web view may not let a worker fetch the app's own files (they come from the app itself, not a
// server). Then the page fetches the engine instead and hands the worker blob addresses, and English is put where
// tesseract.js looks first (as a downloaded language is). Null when the worker can fetch them itself.
let ocrBlobPaths = null;
async function ocrWorkerFetches(url) {
  try {
    const src = 'onmessage=async(e)=>{try{const r=await fetch(e.data);postMessage(r.ok)}catch(_){postMessage(false)}}';
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    return await new Promise((res) => {
      const t = setTimeout(() => { w.terminate(); res(false); }, 8000);
      w.onmessage = (e) => { clearTimeout(t); w.terminate(); res(!!e.data); };
      w.onerror = () => { clearTimeout(t); w.terminate(); res(false); };
      w.postMessage(url);
    });
  } catch { return false; }
}
async function ocrAndroidPaths() {
  if (!ANDROID_APP || !/^http/.test(OCR_PATHS.workerPath)) return null;
  if (ocrBlobPaths) return ocrBlobPaths;
  if (await ocrWorkerFetches(OCR_PATHS.workerPath)) { console.info('OCR: the worker loads the engine itself'); return null; }
  console.info('OCR: the engine is handed to the worker as blob addresses');
  const simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  const blob = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`Could not get ${u}`); return URL.createObjectURL(new Blob([await r.arrayBuffer()], { type: 'text/javascript' })); };
  if (!(await ocrCached('eng'))) {
    const r = await fetch(`${OCR_PATHS.langPath('eng')}/eng.traineddata.gz`);
    if (r.ok) await ocrCacheWrite('eng', new Uint8Array(await r.arrayBuffer()));
  }
  // (tesseract.js takes a corePath ending in "js" as the file itself)
  ocrBlobPaths = { workerPath: await blob(OCR_PATHS.workerPath), corePath: (await blob(`${OCR_PATHS.corePath}/tesseract-core-${simd ? 'simd-' : ''}lstm.wasm.js`)) + '#core.js' };
  return ocrBlobPaths;
}
TEST_HOOKS.ocrAndroidPaths = async () => { ocrBlobPaths = null; return !!(await ocrAndroidPaths()); };
function ocrTesseract() {
  let worker = null, listen = null, ended = false;
  // The worker, started with the languages in `langs` (plain codes), and those in `held` (data) written into it.
  async function openWorker(want, langs, held, onStatus) {
    if (!langs.length) langs.push('eng');
    const logger = (m) => { if (listen) listen(m); else if (onStatus) onStatus(m.status, m.progress); };
    // (tesseract.js 5.1.1 never settles createWorker when its language data fails to start, but tells errorHandler)
    let fail; const failed = new Promise((_, rej) => { fail = rej; });
    failed.catch(() => {});
    const errorHandler = (e) => fail(new Error(String(e)));
    const own = await ocrAndroidPaths();
    worker = await Promise.race([failed, window.Tesseract.createWorker(langs, 1, { workerPath: own ? own.workerPath : OCR_PATHS.workerPath, corePath: own ? own.corePath : OCR_PATHS.corePath, langPath: OCR_PATHS.langPath('eng'), workerBlobURL: true, logger, errorHandler })]);
    if (ended) { try { await worker.terminate(); } catch {} worker = null; throw new Error('stopped'); } // (cancelled while starting)
    if (held.length) {
      // Data that could not be kept is written straight into the worker's files; the worker keeps `langs` as its list
      // of the languages it has, so with these added it starts with them and fetches nothing.
      for (const { code, data } of held) await worker.FS('writeFile', [`./${code}.traineddata`, await ocrGunzip(data)]);
      langs.push(...held.map((x) => x.code));
      await Promise.race([failed, worker.reinitialize(want.join('+'))]);
    }
  }
  return {
    async start(lang, onStatus) {
      if (!window.Tesseract) await ocrLoadScript(OCR_PATHS.script);
      if (!window.Tesseract || !window.Tesseract.createWorker) throw new Error('The OCR engine did not load');
      const want = ocrLangList(lang), langs = [], held = [], fresh = [];
      for (const code of want) {
        if (code === 'eng' || (!OCR_PATHS.noCache && await ocrCached(code))) { langs.push(code); continue; }
        const data = await ocrLangData(code, onStatus);
        if (!OCR_PATHS.noCache && await ocrCacheWrite(code, data)) { langs.push(code); fresh.push(code); } else held.push({ code, data });
      }
      try { await openWorker(want, langs, held, onStatus); }
      catch (e) { for (const code of fresh) await ocrCacheWrite(code, null); throw e; }
    },
    async recognize(canvas, { onProgress }) {
      listen = (m) => { if (m.status === 'recognizing text' && onProgress) onProgress(m.progress || 0); };
      const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true, hocr: false, tsv: false });
      listen = null;
      const lines = [];
      for (const b of data.blocks || []) for (const para of b.paragraphs || []) for (const l of para.lines || []) {
        lines.push({ baseline: l.baseline && l.baseline.has_baseline !== false ? l.baseline : null, words: (l.words || []).map((w) => ({ text: w.text, bbox: w.bbox, confidence: w.confidence })) });
      }
      return { lines };
    },
    // Upside down? tesseract.js's own detect() needs the legacy engine and its orientation data, which the apps don't
    // carry, so a smaller copy is read both ways up and the way with the surer words wins.
    async detect(canvas) {
      const k = Math.min(1, 1400 / Math.max(canvas.width, canvas.height));
      const small = document.createElement('canvas'); small.width = Math.max(1, Math.round(canvas.width * k)); small.height = Math.max(1, Math.round(canvas.height * k));
      const sx = small.getContext('2d'); sx.drawImage(canvas, 0, 0, small.width, small.height);
      const read = async (c) => { listen = () => {}; try { const { data } = await worker.recognize(c, {}, { text: false, blocks: true, hocr: false, tsv: false }); return ocrMeanConfidence(data); } finally { listen = null; } };
      const up = await read(small);
      if (up.score >= 80 && up.words >= 5) { small.width = 0; return { turn: 0, confidence: up.score }; }
      const flip = document.createElement('canvas'); flip.width = small.width; flip.height = small.height;
      const fx = flip.getContext('2d'); fx.translate(flip.width, flip.height); fx.rotate(Math.PI); fx.drawImage(small, 0, 0);
      const down = await read(flip);
      small.width = flip.width = 0;
      return down.score > up.score + 5 ? { turn: 180, confidence: down.score } : { turn: 0, confidence: up.score };
    },
    async stop() { ended = true; const w = worker; worker = null; if (w) try { await w.terminate(); } catch {} },
  };
}

/* --- reading a page --- */
async function ocrHasText(entry) {
  try { const tc = await (await pageOf(entry)).getTextContent(); return tc.items.map((i) => i.str || '').join('').replace(/\s+/g, '').length > 3; }
  catch { return false; }
}
// The page drawn upright (as it shows, with its rotation) at 300 dpi, smaller only for very large pages.
async function ocrRender(entry, { annots = true } = {}) {
  const page = await pageOf(entry), rotation = (page.rotate + entry.rot) % 360;
  const base = page.getViewport({ scale: 1, rotation });
  let s = OCR_DPI / 72;
  const most = Math.min(8000 / Math.max(base.width, base.height), Math.sqrt(36e6 / (base.width * base.height)));
  if (s > most) s = most;
  const vp = page.getViewport({ scale: s, rotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const cx = canvas.getContext('2d', { willReadFrequently: true });
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: cx, viewport: vp, annotationMode: annots ? pdfjs.AnnotationMode.ENABLE_FORMS : pdfjs.AnnotationMode.DISABLE }).promise;
  return { canvas, vp, rotation };
}
// The text a page already shows (not invisible text, such as an earlier OCR layer), and its pictures.
async function ocrShownText(entry) {
  const page = await pageOf(entry);
  let cm; try { cm = await contentMap(page); } catch { return { lines: [], images: [], view: page.view }; }
  const lines = cm.lines.filter((L) => (L.st ? L.st.tr % 4 !== 3 : !cm.invisible.has(L.fontName)));
  return { lines, images: cm.images, view: page.view };
}
// That text is painted over (its box and 2 pt) before the page is read, so it is not read again as invisible text.
function ocrMask(canvas, vp, lines) {
  const x = canvas.getContext('2d'); x.fillStyle = '#fff';
  for (const L of lines) {
    const q = lineQuad(L, 2).map(([a, b]) => vp.convertToViewportPoint(a, b));
    x.beginPath(); x.moveTo(q[0][0], q[0][1]); for (let k = 1; k < 4; k++) x.lineTo(q[k][0], q[k][1]); x.closePath(); x.fill();
  }
}
// A page that is one scan: no text of its own, and a picture over at least half of it. Only such a page has its image
// replaced by the clean one (anything else on the page would be lost in a picture).
function ocrIsScan(shown) {
  const [x0, y0, x1, y1] = shown.view, area = Math.abs((x1 - x0) * (y1 - y0)) || 1;
  return !shown.lines.length && shown.images.some((im) => { const b = quadBox(im.quad); return (b[2] - b[0]) * (b[3] - b[1]) >= area * .5; });
}
// The clean, straightened page image, in the page's own orientation (a page turned upright is turned by its rotation,
// not in the picture): black and white as 1-bit Flate, gray or colour as JPEG; with the matrix that puts it on the page.
async function ocrPageImage(canvas, vp, cl) {
  const W = canvas.width, H = canvas.height;
  let im;
  if (cl.mode === 'bw') {
    const bw = cl.turn === 0 ? cl.imageData : (await ocrCleanAsync(canvas.getContext('2d').getImageData(0, 0, W, H), { angle: cl.angle })).imageData;
    im = { kind: 'bw', bytes: ocrcPack1(bw), w: W, h: H };
  } else {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    if (cl.mode === 'gray' && cl.gray && cl.turn === 0) {
      const d = new ImageData(W, H), px = new Uint32Array(d.data.buffer);
      for (let i = 0; i < W * H; i++) px[i] = 0xff000000 | (cl.gray[i] * 0x010101);
      x.putImageData(d, 0, 0);
    } else {
      if (cl.mode === 'gray') x.filter = 'grayscale(1)';
      const m = ocrcInvert(ocrcDeskew(cl.angle, W, H));
      x.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]); x.drawImage(canvas, 0, 0);
    }
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', .85));
    im = { kind: 'jpeg', bytes: new Uint8Array(await blob.arrayBuffer()), w: W, h: H };
    c.width = c.height = 0;
  }
  const o = vp.convertToPdfPoint(0, H), a = vp.convertToPdfPoint(W, H), b = vp.convertToPdfPoint(0, 0);
  im.cm = [a[0] - o[0], a[1] - o[1], b[0] - o[0], b[1] - o[1], o[0], o[1]];
  return im;
}
// The viewport the words are placed with: pixels of the clean image, through its turn, onto the page.
function ocrViewOf(vp, map) {
  return { scale: vp.scale, convertToPdfPoint: (x, y) => { const p = ocrcApply(map, x, y); return vp.convertToPdfPoint(p[0], p[1]); } };
}
// A close-up of a word for Check words: a little room around it, 40 px high at most.
function ocrCrop(canvas, b) {
  const pad = Math.max(4, (b.y1 - b.y0) * .3), x0 = Math.max(0, b.x0 - pad), y0 = Math.max(0, b.y0 - pad), x1 = Math.min(canvas.width, b.x1 + pad), y1 = Math.min(canvas.height, b.y1 + pad);
  const w = x1 - x0, h = y1 - y0; if (w < 1 || h < 1) return '';
  const k = Math.min(1, 40 / h, 240 / w), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d').drawImage(canvas, x0, y0, w, h, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/png'); c.width = 0; return url;
}
// Words without lines (a simple engine): grouped into lines by where they sit.
function ocrLinesOf(res) {
  if (res && Array.isArray(res.lines)) return res.lines;
  const words = (res && res.words || []).slice().sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0), lines = [];
  for (const w of words) {
    const mid = (w.bbox.y0 + w.bbox.y1) / 2;
    const L = lines.find((l) => mid > l.y0 && mid < l.y1);
    if (L) { L.words.push(w); L.y0 = Math.min(L.y0, w.bbox.y0); L.y1 = Math.max(L.y1, w.bbox.y1); } else lines.push({ y0: w.bbox.y0, y1: w.bbox.y1, words: [w] });
  }
  for (const L of lines) L.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  return lines;
}
// A word worth writing: some text, not under 20% sure, and not a mark the reader was unsure of with no letter or
// digit in it (dust and specks read as "|" or "°").
const ocrKeep = (w) => !!(w && w.bbox && String(w.text || '').trim() && !(w.confidence != null && (w.confidence < OCR_DROP || (w.confidence < OCR_SUSPECT && !/[\p{L}\p{N}]/u.test(w.text)))));
// Where each word goes in the PDF: a text matrix (in points, along the baseline, any rotation) and the horizontal
// scaling that makes the word as wide as it is on the scan. Each word but the last runs to the next one, with a space,
// so lines read and search as sentences.
function ocrPlace(lines, vp, widthOf) {
  const out = [];
  for (const line of lines) {
    const words = (line.words || []).filter(ocrKeep)
      .map((w) => ({ ...w, text: String(w.text).trim().replace(/\s+/g, ' ') }));
    if (!words.length) continue;
    const bl = line.baseline;
    const bottoms = words.map((w) => w.bbox.y1).sort((a, b) => a - b), mid = bottoms[bottoms.length >> 1];
    const by = bl && bl.x1 !== bl.x0 ? (x) => bl.y0 + (bl.y1 - bl.y0) * (x - bl.x0) / (bl.x1 - bl.x0) : bl ? () => bl.y0 : () => mid;
    const tall = words.map((w) => by((w.bbox.x0 + w.bbox.x1) / 2) - w.bbox.y0).filter((h) => h > 0).sort((a, b) => a - b);
    const hpx = tall.length ? tall[Math.min(tall.length - 1, Math.floor(tall.length * .8))] : (words[0].bbox.y1 - words[0].bbox.y0) * .8;
    const size = Math.max(1, hpx / .72 / vp.scale); // Helvetica's capitals and tall letters are about .72 of its size
    words.forEach((w, j) => {
      const last = j === words.length - 1, x0 = w.bbox.x0, x1 = last ? w.bbox.x1 : Math.max(w.bbox.x1, words[j + 1].bbox.x0);
      const p0 = vp.convertToPdfPoint(x0, by(x0)), p1 = vp.convertToPdfPoint(x1, by(x1));
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy) || 1, u = [dx / len, dy / len];
      const text = w.text + (last ? '' : ' '), n = [...text].length;
      const natural = widthOf(text); // in units of the font size
      // Stretched (Tz), not spaced out (Tc): a reader takes a gap between letters of more than a tenth of the size for
      // a space, so a word whose scan is wider than the font's letters would be found and copied as "w o r d".
      out.push({ text, tm: [u[0] * size, u[1] * size, -u[1] * size, u[0] * size, p0[0], p0[1]], tz: natural > 0 ? 100 * len / size / natural : 100, tc: natural > 0 ? 0 : len / size / n });
    });
  }
  return out;
}

/* --- writing the text layer --- */
const OCR_T3W = 500; // the glyph-less fallback font: every letter half an em wide
// Letters Helvetica can't write (Cyrillic, Greek, Chinese…) are written in an invisible Type3 font of empty glyphs,
// with a ToUnicode map, so they are still found and copied as the right letters.
function ocrT3(L, out, ctx) {
  if (ctx.t3) return ctx.t3;
  const fonts = [];
  const get = (ch) => {
    for (const f of fonts) if (f.codes.has(ch)) return { f, code: f.codes.get(ch) };
    let f = fonts[fonts.length - 1];
    if (!f || f.codes.size >= 255) { f = { ref: out.context.nextRef(), codes: new Map() }; fonts.push(f); }
    f.codes.set(ch, f.codes.size + 1);
    return { f, code: f.codes.size };
  };
  const finish = () => {
    const proc = out.context.register(out.context.flateStream(`${OCR_T3W} 0 d0`));
    for (const f of fonts) {
      const n = f.codes.size, u16 = (s) => [...s].map((c) => { const cp = c.codePointAt(0); return cp > 0xFFFF ? [0xD800 + ((cp - 0x10000) >> 10), 0xDC00 + ((cp - 0x10000) & 0x3FF)] : [cp]; }).flat().map((x) => x.toString(16).padStart(4, '0')).join('');
      const entries = [...f.codes].map(([ch, code]) => `<${code.toString(16).padStart(2, '0')}> <${u16(ch)}>`);
      let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<01> <FF>\nendcodespacerange\n';
      for (let k = 0; k < entries.length; k += 100) { const part = entries.slice(k, k + 100); cmap += `${part.length} beginbfchar\n${part.join('\n')}\nendbfchar\n`; }
      cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
      out.context.assign(f.ref, out.context.obj({
        Type: 'Font', Subtype: 'Type3', Name: 'GlyphLessFont', FontBBox: [0, -200, OCR_T3W, 800], FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
        CharProcs: { g: proc }, Encoding: { Type: 'Encoding', Differences: [1, ...Array(n).fill('g')] }, FirstChar: 1, LastChar: n,
        Widths: Array(n).fill(OCR_T3W), Resources: {}, ToUnicode: out.context.register(out.context.flateStream(cmap)),
      }));
    }
  };
  return (ctx.t3 = { get, finish, fonts });
}
async function ocrWritePage(L, out, p, lines, vp, ctx) {
  const { PDFOperator, PDFNumber, PDFHexString, StandardFonts } = L;
  if (!ctx.helv) ctx.helv = await out.embedFont(StandardFonts.Helvetica);
  const helv = ctx.helv, ok = ctx.helvChars || (ctx.helvChars = new Set(helv.getCharacterSet()));
  const canHelv = (s) => [...s].every((c) => ok.has(c.codePointAt(0)));
  const widthOf = (s) => canHelv(s) ? helv.widthOfTextAtSize(s, 1) : [...s].length * OCR_T3W / 1000;
  const placed = ocrPlace(lines, vp, widthOf);
  if (!placed.length) return 0;
  const O = (name, args = []) => PDFOperator.of(name, args), N = (x) => PDFNumber.of(+(+x).toFixed(4));
  const keys = new Map(), keyOf = (ref) => { if (!keys.has(ref)) keys.set(ref, p.node.newFontDictionary('OCR', ref)); return keys.get(ref); };
  const ops = [O('q'), O('BT'), O('Tr', [N(3)]), O('Tw', [N(0)]), O('Ts', [N(0)])];
  for (const w of placed) {
    ops.push(O('Tc', [N(w.tc)]), O('Tz', [N(w.tz)]), O('Tm', w.tm.map(N)));
    if (canHelv(w.text)) ops.push(O('Tf', [keyOf(helv.ref), N(1)]), O('Tj', [helv.encodeText(w.text)]));
    else {
      // one run per Type3 font (a page with more than 255 different letters needs several)
      const t3 = ocrT3(L, out, ctx); let run = null;
      const flush = () => { if (run) ops.push(O('Tf', [keyOf(run.f.ref), N(1)]), O('Tj', [PDFHexString.of(run.hex)])); };
      for (const ch of w.text) { const { f, code } = t3.get(ch); if (!run || run.f !== f) { flush(); run = { f, hex: '' }; } run.hex += code.toString(16).padStart(2, '0'); }
      flush();
    }
  }
  ops.push(O('ET'), O('Q'));
  p.pushOperators(...ops);
  return placed.length;
}
// Recognizing again: the invisible text laid over the page before is taken out, so the words aren't there twice.
function ocrStripInvisible(L, out, p) {
  const { PDFName, PDFArray } = L, node = p.node;
  const raw = node.get(PDFName.of('Contents')), r = raw && out.context.lookup(raw);
  const parts = r instanceof PDFArray ? r.asArray() : raw ? [raw] : [];
  const { fontWidth, text } = pageFonts(L, out, node);
  let src = parts.map((x) => { const st = out.context.lookup(x); return st ? text(st) : ''; }).join('\n');
  const cut = [];
  try { walkContent(src, fontWidth, (op) => { if (op.invisible) cut.push([op.start, op.end, op.keep]); }, () => {}); } catch { return; }
  if (!cut.length) return;
  cut.sort((a, b) => b[0] - a[0]);
  for (const [a, b, keep] of cut) src = src.slice(0, a) + (keep || ' ') + src.slice(b);
  const bytes = new Uint8Array(src.length); for (let i = 0; i < src.length; i++) bytes[i] = src.charCodeAt(i) & 255;
  node.set(PDFName.of('Contents'), out.context.register(out.context.flateStream(bytes)));
}
// The copy of a protected source keeps its password and restrictions.
async function ocrProtectLike(out, k, ownerOnly) {
  const s = doc.sources[k]; if ((!s.password && !ownerOnly) || !out.encrypt) return;
  let flags = null; try { const f = await pdfDocs.get(k).getPermissions(); flags = f ? [...f] : null; } catch {}
  const F = pdfjs.PermissionFlag || {}, can = (f) => !flags || flags.includes(f);
  const permissions = { printing: can(F.PRINT) ? (can(F.PRINT_HIGH_QUALITY) ? 'highResolution' : 'lowResolution') : false, modifying: can(F.MODIFY_CONTENTS), copying: can(F.COPY), annotating: can(F.MODIFY_ANNOTATIONS), fillingForms: can(F.FILL_INTERACTIVE_FORMS), contentAccessibility: can(F.COPY_FOR_ACCESSIBILITY), documentAssembly: can(F.ASSEMBLE) };
  if (s.password) out.encrypt({ userPassword: s.password, ownerPassword: flags ? uid() + uid() : s.password, permissions });
  else if (flags) out.encrypt({ userPassword: '', ownerPassword: uid() + uid(), permissions });
}
// The page's scan replaced by the clean image: the page is drawn from it alone (the text layer goes on top).
async function ocrReplaceImage(L, out, p, im) {
  const { PDFName, PDFOperator, PDFNumber } = L;
  const ref = im.kind === 'jpeg' ? (await out.embedJpg(im.bytes)).ref
    : out.context.register(out.context.flateStream(im.bytes, { Type: 'XObject', Subtype: 'Image', Width: im.w, Height: im.h, ColorSpace: 'DeviceGray', BitsPerComponent: 1 }));
  const node = p.node, old = node.Resources(), res = out.context.obj({});
  if (old) for (const [k, v] of old.entries()) if (k.asString() !== '/XObject') res.set(k, v);
  node.set(PDFName.of('Resources'), res);
  node.set(PDFName.of('Contents'), out.context.obj([]));
  const name = node.newXObject('OCRScan', ref), N = (x) => PDFNumber.of(+(+x).toFixed(5));
  p.pushOperators(PDFOperator.of('q'), PDFOperator.of('cm', im.cm.map(N)), PDFOperator.of('Do', [name]), PDFOperator.of('Q'));
}
// A copy of source k with the words written into the pages that were read. Returns its bytes.
async function ocrCopySource(L, k, results, redo) {
  const pd = pdfDocs.get(k), s = doc.sources[k];
  let b = s; try { if (pd.annotationStorage.size) b = await pd.saveDocument(); } catch {}
  let out, ownerOnly = false;
  if (s.password) out = await L.PDFDocument.load(b, { password: s.password, updateMetadata: false });
  else {
    out = await L.PDFDocument.load(b, { ignoreEncryption: true, updateMetadata: false });
    if (out.isEncrypted) { out = await L.PDFDocument.load(b, { password: '', updateMetadata: false }); ownerOnly = true; }
  }
  const ctx = {}; let words = 0;
  for (const [i, r] of results) {
    const p = out.getPage(i);
    if (r.image) await ocrReplaceImage(L, out, p, r.image);
    else if (redo || r.strip) ocrStripInvisible(L, out, p);
    words += await ocrWritePage(L, out, p, r.lines, r.vp, ctx);
  }
  if (ctx.t3) ctx.t3.finish();
  await ocrProtectLike(out, k, ownerOnly);
  const bytes = await out.save();
  if (s.password) bytes.password = s.password;
  return { bytes, words };
}
// The pages of source k now come from a new source (a copy): points them and their mark-up at it; with `turns`
// (page index -> quarter turns found), the pages are also turned to read upright. Call inside snapshot()/changed().
function ocrPointAt(k, nk, turns) {
  for (const e of doc.pages) if (e.src === k) {
    const t = turns && turns.get(e.i); if (t) e.rot = ((e.rot || 0) + t) % 360;
    e.src = nk;
  }
  for (const key of Object.keys(doc.marks)) { const m = /^(\d+):(\d+)$/.exec(key); if (m && +m[1] === k) { doc.marks[`${nk}:${m[2]}`] = doc.marks[key]; delete doc.marks[key]; } }
}

/* --- a run --- */
// Reads one page: drawn at 300 dpi, its own text covered, cleaned up and turned upright, read; then the words, the
// words to check (with a close-up of each) and, with `clean`, the clean page image. Returns null when cancelled.
async function ocrReadPage(e, { engine, lang, orient, clean, label, k, count, set, stopped, progress }) {
  const shown = await ocrShownText(e), scan = clean && ocrIsScan(shown);
  const { canvas, vp, rotation } = await ocrRender(e, { annots: !scan });
  if (stopped()) return null;
  if (shown.lines.length) ocrMask(canvas, vp, shown.lines);
  const src = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  const cl = await ocrCleanAsync(src, { orient, keepGray: scan });
  const fc = document.createElement('canvas'); fc.width = cl.width; fc.height = cl.height;
  const fx = fc.getContext('2d', { willReadFrequently: true });
  fx.putImageData(cl.imageData, 0, 0);
  if (stopped()) return null;
  const waitOrStop = (p) => Promise.race([p, progress ? progress.cancelling : new Promise(() => {})]);
  if (orient && engine.detect) {
    const d = await waitOrStop(engine.detect(fc, { lang }));
    if (stopped()) return null;
    if (d && d.turn === 180) { ocrCleanFlip(cl); fx.putImageData(cl.imageData, 0, 0); }
  }
  const res = await waitOrStop(engine.recognize(fc, { lang, rotation, onProgress: (f) => set(label, (k + Math.min(1, f)) / count) }));
  if (stopped()) return null;
  // The words go on the original scan (through the clean image's turn), or, when the scan is replaced by the clean
  // image, on that image (straightened, in the page's own orientation).
  const lines = ocrLinesOf(res), check = [];
  const view = ocrViewOf(vp, scan ? ocrcMul(cl.map, ocrcInvert(ocrcDeskew(cl.angle, canvas.width, canvas.height))) : cl.map);
  lines.forEach((l, li) => (l.words || []).forEach((w, wi) => {
    if (!ocrKeep(w) || w.confidence == null || w.confidence >= OCR_SUSPECT || check.length >= 200) return;
    const b = w.bbox, quad = [[b.x0, b.y1], [b.x1, b.y1], [b.x1, b.y0], [b.x0, b.y0]].map(([x, y]) => view.convertToPdfPoint(x, y));
    check.push({ id: uid(), li, wi, text: String(w.text).trim(), conf: Math.round(w.confidence), crop: ocrCrop(fc, b), quad });
  }));
  const r = { lines, vp: view, turn: orient ? cl.turn : 0, angle: cl.angle, check };
  if (scan) r.image = await ocrPageImage(canvas, vp, cl);
  canvas.width = canvas.height = fc.width = fc.height = 0;
  return r;
}
// pages: indexes into doc.pages. Returns { pages, words, skipped, turned, check, replaced, cancelled?, failed? }.
async function ocrRun({ pages, lang = 'eng', redo = false, orient = false, clean = false, progress = null }) {
  const set = (t, f) => progress && progress.set(t, f), stopped = () => progress && progress.cancelled;
  lang = ocrLangList(lang).join('+') || 'eng';
  const targets = [...new Set(pages)].filter((n) => n >= 0 && n < doc.pages.length).sort((a, b) => a - b);
  const todo = [], skipped = [], seen = new Set();
  for (const n of targets) {
    const e = doc.pages[n];
    if (seen.has(pageKey(e))) continue; // the same page shown twice is read once
    seen.add(pageKey(e));
    if (!redo && await ocrHasText(e)) skipped.push(n); else todo.push(n);
  }
  if (!todo.length) return { pages: 0, words: 0, skipped };
  const engine = ocrEngine || ocrTesseract();
  const results = new Map(); // src -> Map(i -> { lines, vp, turn, image?, check })
  try {
    set('Getting the text reader ready…', 0);
    if (engine.start) {
      // (Cancel also stops a start that takes long, or never ends)
      const started = Promise.resolve(engine.start(lang, (status, f) => { const data = /traineddata/.test(status); set(data ? 'Getting the language data…' : 'Getting the text reader ready…', data ? f || 0 : 0); }));
      started.catch(() => {});
      await (progress ? Promise.race([started, progress.cancelling]) : started);
      if (stopped()) { if (engine.stop) await engine.stop(); return { pages: 0, words: 0, skipped, cancelled: true }; }
    }
  } catch (e) {
    console.warn('OCR could not start', e);
    if (engine.stop) await engine.stop();
    return { pages: 0, words: 0, skipped, failed: true };
  }
  try {
    for (let k = 0; k < todo.length; k++) {
      if (stopped()) break;
      const e = doc.pages[todo[k]], label = todo.length > 1 ? `Reading page ${todo[k] + 1} (${k + 1} of ${todo.length})…` : `Reading page ${todo[k] + 1}…`;
      set(label, k / todo.length);
      const r = await ocrReadPage(e, { engine, lang, orient, clean, label, k, count: todo.length, set, stopped, progress });
      if (!r || stopped()) break;
      if (!results.has(e.src)) results.set(e.src, new Map());
      results.get(e.src).set(e.i, r);
    }
  } finally { if (engine.stop) engine.stop(); }
  if (stopped()) return { pages: 0, words: 0, skipped, cancelled: true };
  set('Adding the text to the pages…', 1);
  const L = await loadPdfLib();
  const copies = [];
  let words = 0, turned = 0, check = 0, replaced = 0;
  for (const [k, r] of results) {
    const { bytes, words: w } = await ocrCopySource(L, k, r, redo);
    const pd = await loadProtected(bytes, doc.name);
    if (!pd) return { pages: 0, words: 0, skipped, cancelled: true };
    const turns = new Map();
    for (const [i, x] of r) { if (x.turn) { turns.set(i, x.turn); turned++; } check += x.check.length; if (x.image) replaced++; }
    copies.push([k, bytes, pd, r, turns]); words += w;
  }
  // One change: the pages (and their mark-up) now come from the copies.
  const before = snapshot();
  for (const [k, bytes, pd, r, turns] of copies) {
    const nk = doc.sources.length;
    doc.sources.push(bytes); pdfDocs.set(nk, pd);
    ocrPointAt(k, nk, turns);
    ocrReview.set(nk, { base: k, redo, results: ocrCarryReview(k, r) });
  }
  changed(before, 'Recognize text');
  syncHiddenComments();
  await layoutPages(true); renderSide();
  if (findState.q) runFind(findState.q);
  ocrWordsTab();
  return { pages: todo.length, words, skipped, turned, check, replaced };
}

/* --- Check words: the words the reader was unsure of, put right by hand --- */
// Each copy made by a run (by source index) keeps what was read, so a word put right is written again from the
// source the run started from, into a new copy (undo goes back to the copy before, and its list).
const ocrReview = new Map(); // copy src -> { base, redo, results: Map(i -> page result) }
// A run on pages of an earlier run's copy: that run's pages with words still to check are kept on the list. They are
// written again (their layer taken out first, as they are already in the copy) whenever a word is put right.
function ocrCarryReview(k, results) {
  const prev = ocrReview.get(k), out = new Map(results);
  if (prev) for (const [i, x] of prev.results) if (!out.has(i) && x.check.length) out.set(i, { ...x, strip: true });
  return out;
}
const OCRW = { at: -1 };
function ocrWordItems() {
  const out = [];
  if (!doc) return out;
  for (const [src, st] of ocrReview) {
    for (const [i, r] of st.results) {
      const n = doc.pages.findIndex((e) => e.src === src && e.i === i);
      if (n < 0) continue;
      r.check.forEach((it, j) => out.push({ ...it, src, i, n, j }));
    }
  }
  return out.sort((a, b) => a.n - b.n || a.j - b.j);
}
// A word put right (or taken out, when cleared): the copy is made again with it.
async function ocrFixWord(src, i, id, text) {
  const st = ocrReview.get(src), r = st && st.results.get(i), it = r && r.check.find((x) => x.id === id);
  if (!it || ocrBusy) return false;
  ocrBusy = true;
  try {
    // the copy's results, with this word changed and off the list
    const results = new Map();
    for (const [j, x] of st.results) results.set(j, { ...x, lines: x.lines.map((l) => ({ ...l, words: (l.words || []).map((w) => ({ ...w })) })), check: x.check.filter((c) => c.id !== id) });
    const w = results.get(i).lines[it.li].words[it.wi];
    const t = String(text || '').trim().replace(/\s+/g, ' ');
    if (t) { w.text = t; w.confidence = 100; } else w.confidence = 0;
    const L = await loadPdfLib();
    const { bytes } = await ocrCopySource(L, st.base, results, st.redo);
    const pd = await loadProtected(bytes, doc.name);
    if (!pd) return false;
    const before = snapshot(), nk = doc.sources.length;
    doc.sources.push(bytes); pdfDocs.set(nk, pd);
    ocrPointAt(src, nk, null);
    ocrReview.set(nk, { base: st.base, redo: st.redo, results });
    changed(before, 'Check words');
    syncHiddenComments();
    await layoutPages(true);
    if (findState.q) runFind(findState.q);
    return true;
  } finally { ocrBusy = false; ocrWordsTab(); }
}
// Accepting a guess takes it off the list (the word stays as it was read).
function ocrAcceptWords(ids) {
  for (const st of ocrReview.values()) for (const r of st.results.values()) r.check = r.check.filter((c) => !ids.has(c.id));
  ocrWordsTab();
}
// The sidebar's Check words tab is there only while there are words to check.
function ocrWordsTab() {
  const n = ocrWordItems().length, tabs = $('.side-tabs');
  let b = $('[data-side="ocrwords"]', tabs);
  if (n && !b) {
    b = document.createElement('button');
    Object.assign(b, { type: 'button', innerHTML: `${ic('spell-check')}<span>Check words</span>` });
    b.setAttribute('role', 'tab'); b.dataset.side = 'ocrwords'; b.setAttribute('aria-selected', 'false'); b.setAttribute('aria-controls', 'sidePanel'); b.tabIndex = -1;
    b.addEventListener('click', () => setSide('ocrwords'));
    tabs.insertBefore(b, $('[data-side="docs"]', tabs)); icons(); syncSideTabs();
  } else if (!n && b) { b.remove(); b = null; }
  if (b) b.title = `Check words (${n})`;
  if (S.side === 'ocrwords') { if (!n) { setSide('thumbs'); return; } ocrWordsPanel(); }
  refreshRibbon();
}
// Where the word is, shown on the page for a moment.
function ocrFlashWord(it) {
  goPage(it.n, true);
  const v = views[it.n]; if (!v || !v.el || !v.viewport) return;
  $$('.ocrw-flash').forEach((x) => x.remove());
  const q = it.quad.map(([x, y]) => toView(v, x, y)), xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const el = document.createElement('div'); el.className = 'ocrw-flash';
  Object.assign(el.style, { left: Math.min(...xs) - 3 + 'px', top: Math.min(...ys) - 3 + 'px', width: Math.max(...xs) - Math.min(...xs) + 6 + 'px', height: Math.max(...ys) - Math.min(...ys) + 6 + 'px' });
  v.el.appendChild(el);
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  setTimeout(() => el.remove(), 2400);
}
function ocrWordsPanel() {
  const panel = $('#sidePanel'), items = ocrWordItems();
  if (OCRW.at >= items.length) OCRW.at = items.length - 1;
  panel.innerHTML = `<div class="ocrw">
    <div class="ocrw-head"><p class="ocrw-count" aria-live="polite">${items.length === 1 ? '1 word to check' : `${items.length} words to check`}</p>
      <div class="ocrw-nav"><button type="button" class="icon-btn" data-ocrw-prev aria-label="Previous word" title="Previous word">${ic('chevron-up')}</button><button type="button" class="icon-btn" data-ocrw-next aria-label="Next word" title="Next word">${ic('chevron-down')}</button><button type="button" class="btn" data-ocrw-all>Accept all</button></div></div>
    <p class="ocr-note">The text reader wasn't sure of these words. Put a word right and press Enter, or keep it as it is.</p>
    <ul class="ocrw-list">${items.map((it, k) => `<li class="ocrw-item${k === OCRW.at ? ' on' : ''}" data-k="${k}">
      <button type="button" class="ocrw-pic" data-ocrw-go="${k}" aria-label="Show this word on page ${it.n + 1}">${it.crop ? `<img src="${it.crop}" alt="">` : ''}</button>
      <div class="ocrw-row"><input type="text" value="${esc(it.text)}" data-ocrw-in="${k}" aria-label="Word on page ${it.n + 1}, read as ${esc(it.text)}" autocomplete="off" spellcheck="true">
      <button type="button" class="icon-btn" data-ocrw-ok="${k}" aria-label="Keep or change this word" title="Keep or change">${ic('check')}</button></div>
      <span class="ocrw-meta">Page ${it.n + 1} · ${it.conf}% sure</span></li>`).join('')}</ul></div>`;
  icons();
  const mark = () => $$('.ocrw-item', panel).forEach((li) => li.classList.toggle('on', +li.dataset.k === OCRW.at));
  const go = (k, focus = true) => {
    if (!items.length) return;
    OCRW.at = (k + items.length) % items.length; mark();
    const inp = $(`[data-ocrw-in="${OCRW.at}"]`, panel); if (focus && inp) { inp.focus(); inp.select(); }
    ocrFlashWord(items[OCRW.at]);
  };
  const done = async (k) => {
    const it = items[k], inp = $(`[data-ocrw-in="${k}"]`, panel); if (!it || !inp) return;
    const t = inp.value.trim().replace(/\s+/g, ' ');
    OCRW.at = k;
    if (t === it.text) { ocrAcceptWords(new Set([it.id])); toast('Word kept'); }
    else if (await ocrFixWord(it.src, it.i, it.id, t)) toast(t ? `Changed to “${t}”` : 'Word taken out');
    const p = $('#sidePanel'), next = p && $(`[data-ocrw-in="${Math.min(k, ocrWordItems().length - 1)}"]`, p);
    if (next) { next.focus(); next.select(); }
  };
  $('[data-ocrw-prev]', panel).onclick = () => go(OCRW.at - 1);
  $('[data-ocrw-next]', panel).onclick = () => go(OCRW.at + 1);
  $('[data-ocrw-all]', panel).onclick = () => { const n = items.length; ocrAcceptWords(new Set(items.map((x) => x.id))); toast(n === 1 ? '1 word accepted' : `${n} words accepted`); };
  $$('[data-ocrw-go]', panel).forEach((b) => { b.onclick = () => go(+b.dataset.ocrwGo, false); });
  $$('[data-ocrw-ok]', panel).forEach((b) => { b.onclick = () => done(+b.dataset.ocrwOk); });
  $$('[data-ocrw-in]', panel).forEach((inp) => {
    inp.addEventListener('focus', () => { const k = +inp.dataset.ocrwIn; if (k !== OCRW.at) { OCRW.at = k; mark(); } });
    inp.addEventListener('keydown', (e) => {
      const k = +inp.dataset.ocrwIn;
      if (e.key === 'Enter') { e.preventDefault(); done(k); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); go(k + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); go(k - 1); }
    });
  });
}
const ocrRenderSide0 = renderSide;
renderSide = function () {
  if (S.side !== 'ocrwords') return ocrRenderSide0();
  if (doc && ocrWordItems().length) return ocrWordsPanel();
  S.side = 'thumbs'; syncSideTabs(); return ocrRenderSide0();
};
const ocrRestore0 = restore;
restore = function (s, layout) { ocrRestore0(s, layout); ocrWordsTab(); };
FEATURE.onDocClosed.push(() => { ocrReview.clear(); ocrWordsTab(); });
cmd('ocr_words', { label: 'Check recognized words', icon: 'spell-check', enabled: () => has() && ocrWordItems().length > 0, run: () => { setSide('ocrwords'); if (isPhone() || !S.sidebar) toggleSidebar(true); } });

/* --- the dialogs --- */
function ocrProgressDialog() {
  let dlg, finished = false, ready, stop;
  const shown = new Promise((r) => { ready = r; });
  const pr = { cancelled: false, cancelling: new Promise((r) => { stop = r; }) };
  const answer = dialog('Recognizing text', `<div class="ocr-prog"><p class="ocr-status" aria-live="polite">Getting ready…</p><div class="ocr-bar" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div><p class="ocr-note">Everything stays on this device.</p></div>`,
    [{ label: 'Cancel', value: 'cancel' }], (d) => { dlg = d; ready(); });
  answer.then(() => { if (!finished) { pr.cancelled = true; stop({ lines: [] }); } });
  pr.shown = shown;
  pr.set = (text, f) => {
    if (!dlg) return;
    const st = $('.ocr-status', dlg), bar = $('.ocr-bar', dlg); if (!st || !bar) return;
    st.textContent = text; const pct = Math.round(Math.max(0, Math.min(1, f || 0)) * 100);
    bar.firstChild.style.width = pct + '%'; bar.setAttribute('aria-valuenow', pct);
  };
  pr.close = async () => { finished = true; await shown; const b = $('.dlg-foot [data-a="0"]', dlg); if (b && dlg.open) b.click(); await answer; };
  return pr;
}
const ocrPlural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const ocrPageList = (ns) => ns.length === 1 ? `Page ${ns[0] + 1}` : `Pages ${ns.map((n) => n + 1).join(', ')}`;
const ocrMB = (kb) => (kb >= 1024 ? `${(kb / 1024).toFixed(1).replace(/\.0$/, '')} MB` : `${Math.max(1, Math.round(kb))} KB`);
// What a first use of these languages downloads ("French: 0.7 MB, downloaded once"); English comes with the app.
async function ocrDownloadNote(codes) {
  const need = [];
  for (const c of codes) if (c !== 'eng' && !(await ocrCached(c))) need.push(`${ocrLangName(c)}: ${ocrMB(OCR_SIZES[c] || 2000)}`);
  return need.length ? `${need.join(', ')}, downloaded once.` : '';
}
async function ocrDialog() {
  if (!has() || ocrBusy) return;
  const first = ocrLangList(ocrPrefs.lang);
  const st = { which: 'current', range: `1-${doc.pages.length}`, langs: [first[0] || 'eng', first[1] || '', first[2] || ''], redo: false, orient: ocrPrefs.orient !== false, clean: !!ocrPrefs.clean, onOpen: !!ocrPrefs.onOpen };
  const opts = (sel, none) => (none ? `<option value=""${sel ? '' : ' selected'}>None</option>` : '') + OCR_LANGS.map(([c, n]) => `<option value="${c}"${c === sel ? ' selected' : ''}>${esc(n)}</option>`).join('');
  const body = `<div class="ocr-dlg">
    <p>Finds the words on scanned pages so you can search, select, copy and edit them. It runs on this device.</p>
    <fieldset class="ocr-pages"><legend>Pages</legend>
      <label><input type="radio" name="ocrWhich" value="current" checked> This page (${current + 1})</label>
      <label><input type="radio" name="ocrWhich" value="all"> All pages (${doc.pages.length})</label>
      <label class="ocr-range"><input type="radio" name="ocrWhich" value="range"> Pages <input type="text" id="ocrRange" value="${esc(st.range)}" aria-label="Page range, for example 1-3, 5" autocomplete="off"></label>
    </fieldset>
    <div class="field ocr-langs"><span id="ocrLangLabel">Languages of the text (up to ${OCR_MAX_LANGS})</span>
      <div class="ocr-lang-row"><select id="ocrLang" aria-labelledby="ocrLangLabel">${opts(st.langs[0])}</select>
      <select id="ocrLang2" aria-label="Second language">${opts(st.langs[1], true)}</select>
      <select id="ocrLang3" aria-label="Third language">${opts(st.langs[2], true)}</select></div></div>
    <p class="ocr-note" id="ocrSize" aria-live="polite" hidden></p>
    <label class="ocr-check"><input type="checkbox" id="ocrRedo"> Also pages that already have text</label>
    <label class="ocr-check"><input type="checkbox" id="ocrOrient"${st.orient ? ' checked' : ''}> Turn sideways and upside-down pages upright</label>
    <label class="ocr-check"><input type="checkbox" id="ocrClean"${st.clean ? ' checked' : ''}> Also straighten and clean the page image</label>
    <label class="ocr-check"><input type="checkbox" id="ocrOnOpen"${st.onOpen ? ' checked' : ''}> Recognize text when a scanned PDF opens</label>
    <p class="ocr-note">The first time, the text reader is downloaded (a few MB). English comes with the app.</p>
  </div>`;
  const a = await dialog('Recognize text (OCR)', body, [{ label: 'Cancel' }, { label: 'Recognize text', value: 'go', primary: true }], (dlg) => {
    $$('[name="ocrWhich"]', dlg).forEach((r) => r.addEventListener('change', () => { st.which = r.value; }));
    const rg = $('#ocrRange', dlg);
    rg.addEventListener('input', () => { st.range = rg.value; st.which = 'range'; $('[name="ocrWhich"][value="range"]', dlg).checked = true; });
    rg.addEventListener('focus', () => { st.which = 'range'; $('[name="ocrWhich"][value="range"]', dlg).checked = true; });
    let noteSeq = 0;
    const note = async () => {
      const seq = ++noteSeq, t = await ocrDownloadNote(ocrLangList(st.langs.filter(Boolean).join('+')));
      if (seq !== noteSeq) return; const el = $('#ocrSize', dlg); if (!el) return;
      el.textContent = t; el.hidden = !t;
    };
    ['#ocrLang', '#ocrLang2', '#ocrLang3'].forEach((id, k) => $(id, dlg).addEventListener('change', (e) => { st.langs[k] = e.target.value; note(); }));
    note();
    $('#ocrRedo', dlg).addEventListener('change', (e) => { st.redo = e.target.checked; });
    $('#ocrOrient', dlg).addEventListener('change', (e) => { st.orient = e.target.checked; });
    $('#ocrClean', dlg).addEventListener('change', (e) => { st.clean = e.target.checked; });
    $('#ocrOnOpen', dlg).addEventListener('change', (e) => { st.onOpen = e.target.checked; });
  });
  if (a !== 'go') return;
  const pages = st.which === 'all' ? doc.pages.map((_, n) => n) : st.which === 'range' ? parseRange(st.range, doc.pages.length) : [current];
  if (!pages.length) { toast('No pages in that range'); return; }
  const lang = ocrLangList(st.langs.filter(Boolean).join('+')).join('+') || 'eng';
  Object.assign(ocrPrefs, { lang, orient: st.orient, clean: st.clean, onOpen: st.onOpen }); store.set('ocr', ocrPrefs);
  return ocrStart({ pages, lang, redo: st.redo, orient: st.orient, clean: st.clean });
}
async function ocrStart(opts) {
  if (ocrBusy || !has()) return null;
  ocrBusy = true; closeLineEditor(true);
  const progress = ocrProgressDialog();
  await progress.shown;
  let r;
  try { r = await ocrRun({ ...opts, progress }); }
  catch (e) { console.error(e); r = { error: e }; }
  finally { ocrBusy = false; }
  await progress.close();
  ocrWordsTab();
  if (r.error) toast(`Could not recognize the text: ${r.error.message || r.error}`);
  else if (r.failed) await dialog('The text reader could not start', '<p>Recognizing text needs a one-time download of the text reader and the language. Check the internet connection and try again.</p>', [{ label: 'OK', primary: true }]);
  else if (r.cancelled) toast('Text recognition stopped');
  else if (!r.pages) toast(`${ocrPageList(r.skipped)} already ${r.skipped.length === 1 ? 'has' : 'have'} text. Tick “Also pages that already have text” to read ${r.skipped.length === 1 ? 'it' : 'them'} again.`);
  else {
    ocrHint(false);
    const more = [r.skipped.length ? `${ocrPlural(r.skipped.length, 'page')} already had text` : '', r.turned ? `${ocrPlural(r.turned, 'page')} turned upright` : ''].filter(Boolean).join(', ');
    const msg = !r.words ? 'No text found' : `Text recognized on ${ocrPlural(r.pages, 'page')}${more ? ` (${more})` : ''}`;
    if (r.check) toast(`${msg}. ${ocrPlural(r.check, 'word')} to check.`, { label: 'Check words', run: () => run('ocr_words') });
    else toast(msg);
  }
  return r;
}
// For other features (batch processing): reads the open document's pages with no dialogs. Returns { words, pages }
// (counts), and skipped (page indexes that already had text), check (words to check), turned, replaced, and failed or
// error when it could not run. pages: page indexes (all pages when left out); lang: 'eng' or up to three joined with
// '+'; clean: also replace each scan with its clean, straightened image; orient: turn pages upright (on unless false).
async function ocrRunHeadless({ pages, lang = ocrPrefs.lang, clean = false, orient = true, redo = false } = {}) {
  if (!has()) return { words: 0, pages: 0, skipped: [], failed: true };
  if (ocrBusy) return { words: 0, pages: 0, skipped: [], busy: true };
  ocrBusy = true;
  try {
    const r = await ocrRun({ pages: pages || doc.pages.map((_, n) => n), lang, clean, orient, redo });
    if (r.pages) ocrHint(false);
    return { words: r.words || 0, pages: r.pages || 0, skipped: r.skipped || [], check: r.check || 0, turned: r.turned || 0, replaced: r.replaced || 0, ...(r.failed ? { failed: true } : {}) };
  } catch (e) { console.error(e); return { words: 0, pages: 0, skipped: [], error: String(e && e.message || e) }; }
  finally { ocrBusy = false; ocrWordsTab(); }
}

/* --- a hint on scanned documents --- */
function ocrHint(show) {
  let el = $('#ocrHint');
  if (!show) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement('div'); el.id = 'ocrHint'; el.className = 'ocr-hint'; el.setAttribute('role', 'status');
    el.innerHTML = `${ic('scan-text')}<span>This looks like a scanned PDF. Recognize the text to search, select and edit it.</span><button type="button" class="btn primary" data-ocr-go>Recognize text</button><button type="button" class="icon-btn" data-ocr-x aria-label="Hide">${ic('x')}</button>`;
    $('#viewer').insertBefore(el, $('#pages'));
    $('[data-ocr-go]', el).onclick = () => run('ocr');
    $('[data-ocr-x]', el).onclick = () => ocrHint(false);
    icons();
  }
  el.hidden = false;
}
FEATURE.onDocShown.push(async (d) => {
  ocrHint(false);
  ocrWordsTab();
  // Scanned: the first page has no text, nor do most of the first three.
  const first = d.pages.slice(0, 3);
  let bare = 0;
  for (const e of first) { if (doc !== d) return; if (!(await ocrHasText(e))) bare++; else if (e === first[0]) return; }
  if (!(doc === d && first.length && bare * 2 >= first.length)) return;
  // With "Recognize text when a scanned PDF opens", it is read at once (the pages that have no text).
  if (ocrPrefs.onOpen && !ocrBusy) { await ocrStart({ pages: d.pages.map((_, n) => n), lang: ocrPrefs.lang, orient: ocrPrefs.orient !== false, clean: !!ocrPrefs.clean }); return; }
  ocrHint(true);
});

cmd('ocr', { label: 'Recognize text (OCR)…', icon: 'scan-text', enabled: () => has() && !ocrBusy, run: ocrDialog });
ribbonAdd('edit', 'Scanned pages', ['ocr', 'ocr_words']);
menuAdd('Edit', ['ocr', 'ocr_words']); // the web menu bar is drawn before feature modules run, so a new menu would not show there
addStyle(`
/* pdf.js lays the text layer out unrotated and marks it with data-main-rotation; its viewer CSS turns it to match
   the page. build.py only takes the .textLayer block, so on a turned page (the file's /Rotate or Pages > Rotate)
   the text layer lay sideways and Find, selection and the OCR text missed the words. (Generic; could move to the template.) */
.page .textLayer[data-main-rotation="90"] { transform: rotate(90deg) translateY(-100%); }
.page .textLayer[data-main-rotation="180"] { transform: rotate(180deg) translate(-100%, -100%); }
.page .textLayer[data-main-rotation="270"] { transform: rotate(270deg) translateX(-100%); }
.ocr-dlg fieldset { border: 0; margin: 10px 0 4px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ocr-dlg legend { color: var(--ink); font-weight: 600; padding: 0; margin-bottom: 4px; }
.ocr-dlg label:not(.field) { display: flex; align-items: center; gap: 8px; color: var(--ink); cursor: pointer; min-height: 28px; }
.ocr-dlg input[type="radio"], .ocr-dlg input[type="checkbox"] { accent-color: var(--brand); width: 16px; height: 16px; margin: 0; flex: none; }
.ocr-dlg .ocr-range input[type="text"] { font: inherit; color: var(--ink); background: var(--chrome); border: 1px solid var(--line); border-radius: 8px; padding: 5px 8px; width: 120px; min-width: 0; }
.ocr-dlg .field span { color: var(--ink); font-weight: 600; }
.ocr-dlg select { font: inherit; color: var(--ink); background: var(--chrome); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
.ocr-note { font-size: 12px; color: var(--ink-3); }
.ocr-prog .ocr-status { color: var(--ink); margin: 4px 0 10px; }
.ocr-bar { height: 8px; border-radius: 4px; background: var(--press); overflow: hidden; }
.ocr-bar i { display: block; height: 100%; width: 0; background: var(--accent); border-radius: 4px; transition: width .2s; }
.ocr-hint { position: sticky; top: 10px; z-index: 15; margin: 10px auto -4px; width: max-content; max-width: calc(100% - 32px); box-sizing: border-box; display: flex; align-items: center; gap: 10px; background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; padding: 8px 8px 8px 14px; box-shadow: 0 8px 24px rgba(0,0,0,.15); font-size: 13px; }
.ocr-hint[hidden] { display: none; }
.ocr-hint > svg { color: var(--accent); flex: none; }
@media (max-width: 760px), (max-height: 500px) and (pointer: coarse) { .ocr-hint { flex-wrap: wrap; width: auto; } .ocr-hint span { flex: 1 1 60%; } }
.ocr-dlg .ocr-langs { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.ocr-lang-row { display: flex; gap: 6px; flex-wrap: wrap; }
.ocr-lang-row select { flex: 1 1 120px; min-width: 0; }
.ocr-dlg .ocr-note[hidden] { display: none; }
.ocrw { padding: 10px 10px 16px; display: flex; flex-direction: column; gap: 8px; }
.ocrw-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap; }
.ocrw-count { margin: 0; font-weight: 600; color: var(--ink); }
.ocrw-nav { display: flex; align-items: center; gap: 4px; }
.ocrw .ocr-note { margin: 0; }
.ocrw-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ocrw-item { border: 1px solid var(--line); border-radius: 10px; padding: 8px; display: flex; flex-direction: column; gap: 6px; background: var(--surface); }
.ocrw-item.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.ocrw-pic { display: block; border: 0; padding: 4px; border-radius: 6px; background: #fff; cursor: pointer; min-height: 28px; }
.ocrw-pic img { display: block; max-width: 100%; height: auto; margin: 0 auto; }
.ocrw-row { display: flex; gap: 4px; align-items: center; }
.ocrw-row input { flex: 1; min-width: 0; font: inherit; color: var(--ink); background: var(--chrome); border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; }
.ocrw-meta { font-size: 12px; color: var(--ink-3); }
.ocrw-flash { position: absolute; z-index: 6; pointer-events: none; border: 2px solid var(--accent); border-radius: 4px; background: color-mix(in srgb, var(--accent) 18%, transparent); animation: ocrwFlash 2.4s ease-out forwards; }
@keyframes ocrwFlash { 0%, 70% { opacity: 1; } 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .ocrw-flash { animation: none; } }
`);

TEST_HOOKS.ocrUseEngine = (e) => { ocrEngine = e; };
TEST_HOOKS.ocrRun = (opts) => ocrStart(opts);
TEST_HOOKS.ocrPaths = OCR_PATHS;
TEST_HOOKS.ocrRunHeadless = (opts) => ocrRunHeadless(opts);
TEST_HOOKS.ocrWords = () => ocrWordItems().map(({ text, conf, n, crop }) => ({ text, conf, page: n, crop: !!crop }));
TEST_HOOKS.ocrPrefs = (o) => { if (o) { Object.assign(ocrPrefs, o); store.set('ocr', ocrPrefs); } return { ...ocrPrefs }; };
