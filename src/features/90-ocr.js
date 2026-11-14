/* ---------------- OCR: recognize text on scanned pages ----------------
   Tools → "Recognize text (OCR)…" reads the words on scanned pages, on this device, with tesseract.js (Apache-2.0)
   loaded on first use, and lays them over the page as invisible text (render mode 3), the way scanners and
   PDFelement do. The page then has real text: it can be selected, searched with Find, copied and rewritten with
   the Edit PDF tool, on screen and in the saved PDF alike.

   How it is kept: the source PDF the pages come from is copied with the text layer added (a new entry in
   doc.sources, like a merged PDF), and the pages and their mark-up are pointed at the copy inside
   snapshot()/changed(). Undo points them back; Save writes the copy, so bookmarks, forms and links are kept.

   The engine is replaceable: ocrEngine (TEST_HOOKS.ocrUseEngine) is any object with
     recognize(canvas, { lang, rotation, onProgress }) -> { lines: [{ words: [{ text, bbox: {x0,y0,x1,y1},
       confidence? }], baseline?: {x0,y0,x1,y1} }] }   (or { words: [...] }, grouped into lines here)
   and optional start(lang, onStatus) and stop(). Boxes are in pixels of the canvas it is given. */

// Where the engine comes from. Exact versions, so the apps can carry the same files (set these to local paths).
const OCR_PATHS = {
  script: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
  corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
  langPath: (lang) => `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}@1.0.0/4.0.0_best_int`,
};
// Languages with trained data on npm as @tesseract.js-data/<code>@1.0.0.
const OCR_LANGS = [['eng', 'English'], ['fra', 'French'], ['deu', 'German'], ['spa', 'Spanish'], ['ita', 'Italian'], ['por', 'Portuguese'], ['nld', 'Dutch'],
  ['swe', 'Swedish'], ['dan', 'Danish'], ['nor', 'Norwegian'], ['fin', 'Finnish'], ['pol', 'Polish'], ['ces', 'Czech'], ['tur', 'Turkish'], ['ind', 'Indonesian'],
  ['vie', 'Vietnamese'], ['ell', 'Greek'], ['rus', 'Russian'], ['ukr', 'Ukrainian'], ['heb', 'Hebrew'], ['ara', 'Arabic'], ['hin', 'Hindi'], ['tha', 'Thai'],
  ['chi_sim', 'Chinese (simplified)'], ['chi_tra', 'Chinese (traditional)'], ['jpn', 'Japanese'], ['kor', 'Korean']];
const OCR_DPI = 300;
let ocrEngine = null;   // an engine given by the tests; otherwise tesseract.js
let ocrBusy = false;
const ocrPrefs = Object.assign({ lang: 'eng' }, store.get('ocr', {}));

/* --- the engine --- */
function ocrLoadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => res(); s.onerror = () => { s.remove(); rej(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  });
}
// tesseract.js v5: one worker, for one language, for one run.
function ocrTesseract() {
  let worker = null, listen = null;
  return {
    async start(lang, onStatus) {
      if (!window.Tesseract) await ocrLoadScript(OCR_PATHS.script);
      if (!window.Tesseract || !window.Tesseract.createWorker) throw new Error('The OCR engine did not load');
      const logger = (m) => { if (listen) listen(m); else if (onStatus) onStatus(m.status, m.progress); };
      worker = await window.Tesseract.createWorker(lang, 1, { workerPath: OCR_PATHS.workerPath, corePath: OCR_PATHS.corePath, langPath: OCR_PATHS.langPath(lang), workerBlobURL: true, logger });
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
    async stop() { const w = worker; worker = null; if (w) try { await w.terminate(); } catch {} },
  };
}

/* --- reading a page --- */
async function ocrHasText(entry) {
  try { const tc = await (await pageOf(entry)).getTextContent(); return tc.items.map((i) => i.str || '').join('').replace(/\s+/g, '').length > 3; }
  catch { return false; }
}
// The page drawn upright (as it shows, with its rotation) at 300 dpi, smaller only for very large pages.
async function ocrRender(entry) {
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
  await page.render({ canvas, canvasContext: cx, viewport: vp, annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS }).promise;
  return { canvas, vp, rotation };
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
// Where each word goes in the PDF: a text matrix (in points, along the baseline, any rotation) and the spacing that
// makes the word as wide as it is on the scan. Each word but the last runs to the next one, with a space, so lines
// read and search as sentences.
function ocrPlace(lines, vp, widthOf) {
  const out = [];
  for (const line of lines) {
    const words = (line.words || []).filter((w) => w && w.bbox && String(w.text || '').trim() && !(w.confidence != null && w.confidence < 20))
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
      out.push({ text, tm: [u[0] * size, u[1] * size, -u[1] * size, u[0] * size, p0[0], p0[1]], tc: (len / size - natural) / n });
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
  const ops = [O('q'), O('BT'), O('Tr', [N(3)]), O('Tw', [N(0)]), O('Tz', [N(100)]), O('Ts', [N(0)])];
  for (const w of placed) {
    ops.push(O('Tc', [N(w.tc)]), O('Tm', w.tm.map(N)));
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
    if (redo) ocrStripInvisible(L, out, p);
    words += await ocrWritePage(L, out, p, r.lines, r.vp, ctx);
  }
  if (ctx.t3) ctx.t3.finish();
  await ocrProtectLike(out, k, ownerOnly);
  const bytes = await out.save();
  if (s.password) bytes.password = s.password;
  return { bytes, words };
}

/* --- a run --- */
// pages: indexes into doc.pages. Returns { pages, words, skipped, cancelled?, failed? }.
async function ocrRun({ pages, lang = 'eng', redo = false, progress = null }) {
  const set = (t, f) => progress && progress.set(t, f), stopped = () => progress && progress.cancelled;
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
  const results = new Map(); // src -> Map(i -> { lines, vp })
  try {
    set('Getting the text reader ready…', 0);
    if (engine.start) await engine.start(lang, (status, f) => set(/traineddata/.test(status) ? 'Getting the language data…' : 'Getting the text reader ready…', 0));
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
      const { canvas, vp, rotation } = await ocrRender(e);
      if (stopped()) break;
      const res = await Promise.race([engine.recognize(canvas, { lang, rotation, onProgress: (f) => set(label, (k + Math.min(1, f)) / todo.length) }), progress ? progress.cancelling : new Promise(() => {})]);
      canvas.width = canvas.height = 0;
      if (stopped()) break;
      if (!results.has(e.src)) results.set(e.src, new Map());
      results.get(e.src).set(e.i, { lines: ocrLinesOf(res), vp });
    }
  } finally { if (engine.stop) engine.stop(); }
  if (stopped()) return { pages: 0, words: 0, skipped, cancelled: true };
  set('Adding the text to the pages…', 1);
  const L = await loadPdfLib();
  const copies = [];
  let words = 0;
  for (const [k, r] of results) {
    const { bytes, words: w } = await ocrCopySource(L, k, r, redo);
    const pd = await loadProtected(bytes, doc.name);
    if (!pd) return { pages: 0, words: 0, skipped, cancelled: true };
    copies.push([k, bytes, pd]); words += w;
  }
  // One change: the pages (and their mark-up) now come from the copies.
  const before = snapshot();
  for (const [k, bytes, pd] of copies) {
    const nk = doc.sources.length;
    doc.sources.push(bytes); pdfDocs.set(nk, pd);
    for (const e of doc.pages) if (e.src === k) e.src = nk;
    for (const key of Object.keys(doc.marks)) { const m = /^(\d+):(\d+)$/.exec(key); if (m && +m[1] === k) { doc.marks[`${nk}:${m[2]}`] = doc.marks[key]; delete doc.marks[key]; } }
  }
  changed(before);
  syncHiddenComments();
  await layoutPages(true); renderSide();
  if (findState.q) runFind(findState.q);
  return { pages: todo.length, words, skipped };
}

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
async function ocrDialog() {
  if (!has() || ocrBusy) return;
  const st = { which: 'current', range: `1-${doc.pages.length}`, lang: ocrPrefs.lang, redo: false };
  const langs = OCR_LANGS.map(([c, n]) => `<option value="${c}"${c === st.lang ? ' selected' : ''}>${esc(n)}</option>`).join('');
  const body = `<div class="ocr-dlg">
    <p>Finds the words on scanned pages so you can search, select, copy and edit them. It runs on this device.</p>
    <fieldset class="ocr-pages"><legend>Pages</legend>
      <label><input type="radio" name="ocrWhich" value="current" checked> This page (${current + 1})</label>
      <label><input type="radio" name="ocrWhich" value="all"> All pages (${doc.pages.length})</label>
      <label class="ocr-range"><input type="radio" name="ocrWhich" value="range"> Pages <input type="text" id="ocrRange" value="${esc(st.range)}" aria-label="Page range, for example 1-3, 5" autocomplete="off"></label>
    </fieldset>
    <label class="field"><span>Language of the text</span><select id="ocrLang">${langs}</select></label>
    <label class="ocr-check"><input type="checkbox" id="ocrRedo"> Also pages that already have text</label>
    <p class="ocr-note">The first time, the text reader and each language are downloaded (a few MB).</p>
  </div>`;
  const a = await dialog('Recognize text (OCR)', body, [{ label: 'Cancel' }, { label: 'Recognize text', value: 'go', primary: true }], (dlg) => {
    $$('[name="ocrWhich"]', dlg).forEach((r) => r.addEventListener('change', () => { st.which = r.value; }));
    const rg = $('#ocrRange', dlg);
    rg.addEventListener('input', () => { st.range = rg.value; st.which = 'range'; $('[name="ocrWhich"][value="range"]', dlg).checked = true; });
    rg.addEventListener('focus', () => { st.which = 'range'; $('[name="ocrWhich"][value="range"]', dlg).checked = true; });
    $('#ocrLang', dlg).addEventListener('change', (e) => { st.lang = e.target.value; });
    $('#ocrRedo', dlg).addEventListener('change', (e) => { st.redo = e.target.checked; });
  });
  if (a !== 'go') return;
  const pages = st.which === 'all' ? doc.pages.map((_, n) => n) : st.which === 'range' ? parseRange(st.range, doc.pages.length) : [current];
  if (!pages.length) { toast('No pages in that range'); return; }
  ocrPrefs.lang = st.lang; store.set('ocr', ocrPrefs);
  return ocrStart({ pages, lang: st.lang, redo: st.redo });
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
  if (r.error) toast(`Could not recognize the text: ${r.error.message || r.error}`);
  else if (r.failed) await dialog('The text reader could not start', '<p>Recognizing text needs a one-time download of the text reader and the language. Check the internet connection and try again.</p>', [{ label: 'OK', primary: true }]);
  else if (r.cancelled) toast('Text recognition stopped');
  else if (!r.pages) toast(`${ocrPageList(r.skipped)} already ${r.skipped.length === 1 ? 'has' : 'have'} text. Tick “Also pages that already have text” to read ${r.skipped.length === 1 ? 'it' : 'them'} again.`);
  else {
    ocrHint(false);
    toast(!r.words ? 'No text found' : `Text recognized on ${ocrPlural(r.pages, 'page')}${r.skipped.length ? ` (${ocrPlural(r.skipped.length, 'page')} already had text)` : ''}`);
  }
  return r;
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
  // Scanned: the first page has no text, nor do most of the first three.
  const first = d.pages.slice(0, 3);
  let bare = 0;
  for (const e of first) { if (doc !== d) return; if (!(await ocrHasText(e))) bare++; else if (e === first[0]) return; }
  if (doc === d && first.length && bare * 2 >= first.length) ocrHint(true);
});

cmd('ocr', { label: 'Recognize text (OCR)…', icon: 'scan-text', enabled: () => has() && !ocrBusy, run: ocrDialog });
ribbonAdd('edit', 'Scanned pages', ['ocr']);
menuAdd('Edit', ['ocr']); // the web menu bar is drawn before feature modules run, so a new menu would not show there

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
`);

TEST_HOOKS.ocrUseEngine = (e) => { ocrEngine = e; };
TEST_HOOKS.ocrRun = (opts) => ocrStart(opts);
TEST_HOOKS.ocrPaths = OCR_PATHS;
