// Cowdrey.PDF by Bradley Cowdrey (bradcowdrey.com). A PDF viewer and editor in the spirit of Cowdrey.MD.
// Pages are shown with pdf.js (Apache 2.0; its legacy build, which also runs on older iPhones, iPads and Android web views) and saved with pdf-lib (MIT). Nothing leaves the device.
'use strict';
const VERSION = '0.2.0';
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/pdf.worker.min.mjs';
// @cantoo/pdf-lib: pdf-lib (MIT) with password-protected PDFs added, so they can be saved with or without their password.
const PDFLIB = 'https://cdn.jsdelivr.net/npm/@cantoo/pdf-lib@2.11.1/dist/pdf-lib.esm.min.js';
// pdf.js's icons for comments that have no look of their own (a sticky note from some apps)
const PDFJS_ICONS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/web/images/';
const KEY = 'cowdrey.pdf';
const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
// In the apps (Tauri): the Mac app, or the iPhone, iPad and Android app.
const NATIVE = window.__TAURI__ || null;
const MOBILE_APP = !!NATIVE && (/iPhone|iPad|iPod|Android/.test(navigator.userAgent) || navigator.maxTouchPoints > 1);
const ANDROID_APP = MOBILE_APP && /Android/.test(navigator.userAgent);
const MAC_APP = NATIVE && !MOBILE_APP ? NATIVE : null;
const b64ToBytes = (b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const bytesToB64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (name) => `<i data-lucide="${name}"></i>`;
const icons = () => window.lucide && window.lucide.createIcons();
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const app = $('#app');
const store = {
  get(k, d) { try { const v = localStorage.getItem(KEY + ':' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(KEY + ':' + k, JSON.stringify(v)); } catch {} },
};
const S = Object.assign({ theme: 'system', sidebar: true, side: 'thumbs', zoom: 'fit', darkPage: false, color: '#FFD43B', width: 2, ribbon: 'home' }, store.get('settings', {}));
// ?theme=dark or ?theme=light (the live demo on the product page) sets the look for this visit only.
const URL_THEME = (location.search.match(/[?&]theme=(dark|light)\b/) || [])[1];
if (URL_THEME) S.theme = URL_THEME;
const saveSettings = () => store.set('settings', URL_THEME ? { ...S, theme: store.get('settings', {}).theme || 'system' } : S);
// Phones, and phones turned on their side (keep in step with the phone @media rule in template.html).
const PHONE_MQ = '(max-width: 760px), (max-height: 500px) and (pointer: coarse)';
const isPhone = () => matchMedia(PHONE_MQ).matches;
const coarse = () => matchMedia('(pointer: coarse)').matches; // a finger, not a mouse: no Esc or Ctrl keys to mention
let toastTimer;
// Bars along the bottom of the window (the status bar, read aloud, form fields…): a toast goes above them.
const TOAST_AVOID = '.statusbar, .crd-bar, .ff-bar, [data-toast-avoid]';
let toolHint = '', toolJustSet = null; // the mode chip's hint, and the tool chosen in this task (see setTool)
const touchWords = (msg) => coarse() ? String(msg).replace(/\bdouble-click/g, 'double-tap').replace(/\bClick\b/g, 'Tap').replace(/\bclick\b/g, 'tap') : msg;
function toast(msg) {
  msg = touchWords(msg);
  // How to use a tool just chosen goes in the mode chip in the status bar, which stays while the tool is on, instead
  // of a toast that goes after a moment and covers the page (toasts are for what happened).
  // (A phone's chip has room for the tool's name only: there the hint is also shown once, as a toast.)
  if (toolJustSet && toolJustSet === app.dataset.tool && toolJustSet !== 'select') { toolHint = msg; modeChip(); if (!isPhone()) return; }
  const t = $('#toast'); t.textContent = msg;
  const tw = t.offsetWidth, left = (innerWidth - tw) / 2, right = left + tw;
  let top = innerHeight;
  for (const b of document.querySelectorAll(TOAST_AVOID)) {
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < innerHeight - 200 || r.right < left || r.left > right || getComputedStyle(b).visibility === 'hidden') continue;
    top = Math.min(top, r.top);
  }
  t.style.setProperty('--toast-bottom', Math.max(48, innerHeight - top + 12) + 'px');
  t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------------- features ----------------
   Feature modules in src/features/*.js are joined into this file by build.py (where /*FEATURES*\/ stands, before
   the apps and start sections) and plug in through this registry. See src/features/README.md. */
const FEATURE = {
  thumbLayers: [], // (v) => draw a feature's own layer (an svg in v.el) for a thumbnail; v.thumb is true
  markTypes: {},   // type -> { draw(v, m, svg) -> SVG element, save: async ({ L, out, p, m, entry, ctx }), under?: true (drawn and saved before other marks), move?(m, orig, dx, dy) }
  tools: {},       // tool id -> { down(e, v), move?(e, v) } — pointer handling on the page while the tool is chosen
  savePage: [],    // async ({ L, out, p, entry, n, entries, marks, ctx }) — after a page's marks are saved
  savePageLate: [], // the same, after every savePage hook (redaction among them): drawing that must not be cut
  saveDoc: [],     // async ({ L, out, pages, entries, ctx }) — after every page, before the file is written
  afterRender: [], // (v) — after a page is drawn on screen
  onDocShown: [],  // (doc) — when a document is shown
  outlinePanel: null, // (panel) — draws the sidebar's Outline tab in place of the read-only list
  markLabels: [],  // (m) -> { label, text? } | null — what a mark is called (for screen readers and lists)
  selActions: [],  // { label, icon, order, run() } — what can be done with text selected on the page (its bar and menu)
};
function addStyle(css) { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }
const TEST_HOOKS = {}; // features add functions for the tests here; they appear on window.__cowdreyPdf

/* ---------------- libraries (loaded on first use) ---------------- */
let pdfjs, pdfjsLoading, pdfLib;
// One load, shared by every caller: pdfjs is only set once its worker is ready.
function loadPdfjs() {
  return pdfjsLoading || (pdfjsLoading = (async () => {
    let mod;
    try { mod = await import(PDFJS); }
    catch (e) { pdfjsLoading = null; toast('The PDF reader could not start. Restart Cowdrey.PDF and try again.'); throw e; }
    // A worker from another origin can't be started directly: start it from a copy of its code.
    try {
      const code = await (await fetch(PDFJS_WORKER)).text();
      mod.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    } catch { mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; }
    return (pdfjs = mod);
  })());
}
async function loadPdfLib() { return pdfLib || (pdfLib = await import(PDFLIB)); }
// Opening, reopening and adding PDFs run one at a time, in the order they were asked for, so a file opened from
// Finder at launch can't be replaced by (or mixed up with) the document restored from last time.
let openChain = Promise.resolve();
function serial(fn) { const p = openChain.then(fn, fn); openChain = p.catch(() => {}); return p; }
// Opens a pdf.js document, asking for the password when it has one. The password is kept with the bytes in memory
// only, for saving; it is never written to this device. Returns null when the person cancels.
async function loadProtected(bytes, name) {
  await loadPdfjs();
  try { return await pdfjs.getDocument({ data: bytes.slice(), password: bytes.password, isEvalSupported: false, enableXfa: false, fontExtraProperties: true }).promise; }
  catch (e) {
    if (!e || e.name !== 'PasswordException') throw e;
    for (let tries = 0; ; tries++) {
      const pw = await askText(tries ? 'That password did not open it' : 'This PDF is protected', `Enter the password for ${name}. It is not stored.`, '', 'Open', true);
      if (pw == null) return null;
      try { const pd = await pdfjs.getDocument({ data: bytes.slice(), password: pw, isEvalSupported: false, enableXfa: false, fontExtraProperties: true }).promise; bytes.password = pw; return pd; }
      catch (e2) { if (!e2 || e2.name !== 'PasswordException') throw e2; }
    }
  }
}

/* ---------------- the open document ----------------
   doc.sources: the original PDF bytes (the opened file, plus any merged in); never changed.
   doc.pages:   what the PDF is now, in order: { src, i (page index in that source), rot (added rotation) }.
   doc.marks:   mark-up per original page ("src:i"), in PDF coordinates, so reordering and rotating keep it.
   Saving writes a new PDF from all three; the original file is only replaced when you save over it. */
let doc = null;
const pdfDocs = new Map(); // source index -> pdf.js document
let views = []; // per displayed page: { el, entry, viewport, rendered }
let current = 0; // index of the page in view
let scale = 1;
let selMark = null; // { key, id }
const undoStack = [], redoStack = [];
const pageKey = (e) => `${e.src}:${e.i}`;

// Returns true when the PDF is open, false when it could not be (or the person cancelled).
async function openBytes(bytes, name, handle, mtime) {
  let pd;
  try { pd = await loadProtected(bytes, name); }
  catch (e) { console.error(e); toast(`Could not open ${name}: it may not be a PDF.`); return false; }
  if (!pd) return false;
  const d = { id: uid(), name: name.replace(/\.pdf$/i, ''), sources: [bytes], pages: [], marks: {}, updated: Date.now(), handle: typeof handle === 'object' ? handle : null, path: typeof handle === 'string' ? handle : null, mtime: mtime || 0 };
  for (let i = 0; i < pd.numPages; i++) d.pages.push({ src: 0, i, rot: 0 });
  if (!(await showDoc(d, [pd]))) return false;
  await persistNow(); // at once, so opening several files in a row keeps every one in Documents
  return true;
}
// Shows a document. Every source is loaded before anything on screen changes, so a cancelled password leaves the
// document you had open as it was. Returns false if it was not shown.
async function showDoc(d, loaded) {
  const pds = [];
  for (let k = 0; k < d.sources.length; k++) {
    let pd = loaded && loaded[k];
    if (!pd) {
      try { pd = await loadProtected(d.sources[k], d.name); } catch (e) { console.error(e); pd = null; if (!loaded) toast(`Could not open ${d.name}.`); }
    }
    if (!pd) { for (const p of pds) try { p.destroy(); } catch {} return false; }
    pds.push(pd);
  }
  // Keep the document being left in Documents before switching.
  if (doc && persistTimer) { clearTimeout(persistTimer); persistTimer = null; await persistNow(); }
  for (const p of pdfDocs.values()) try { p.destroy(); } catch {}
  pdfDocs.clear();
  // A new document starts with the Select tool: no tool or mode (Edit PDF, Edit fields…) is kept from the last one.
  if (app.dataset.tool !== 'select') setTool('select');
  pendingImage = null; selContent = null; closePopover();
  if (!$('#findbar').hidden) closeFind();
  findState.texts.clear();
  if (isPhone() && S.zoom !== 'fit') S.zoom = 'fit'; // phones open every document at its width
  doc = d; selMark = null; undoStack.length = redoStack.length = 0;
  pds.forEach((pd, k) => pdfDocs.set(k, pd));
  syncHiddenComments(); // before any page is drawn
  $('#drop').hidden = true;
  setTitle(); setSaved(true, true);
  await layoutPages();
  renderSide();
  store.set('current', d.id);
  for (const f of FEATURE.onDocShown) { try { f(d); } catch (e) { console.warn(e); } }
  return true;
}
// The name in the title bar: when it is too long, its middle gives way (the start and its last few letters stay),
// and the whole name is its tooltip.
function setTitle() {
  const name = doc ? doc.name : 'Cowdrey.PDF', t = $('#docTitle'), cut = name.slice(-11).search(/[ _-][^ _-]{2,}$/);
  const k = name.length <= 14 ? 0 : cut >= 0 ? 11 - cut : Math.min(8, Math.floor(name.length / 3)); // from the last word, when it is short
  t.innerHTML = `<span class="dt-a">${esc(name.slice(0, name.length - k))}</span>${k ? `<span class="dt-b">${esc(name.slice(-k))}</span>` : ''}`;
  t.title = name; document.title = doc ? `${doc.name} · Cowdrey.PDF` : 'Cowdrey.PDF';
}
// `opened`: the document was just opened, not saved. An unedited file says nothing; one that comes back from
// Documents with changes says they are kept there.
function setSaved(saved, opened) {
  if (doc) doc.dirty = !saved;
  const kept = opened && doc && Object.values(doc.marks).some((l) => l && l.length);
  $('#saveState').innerHTML = !doc || (opened && !kept) ? '' : opened ? 'Changes kept in Recent' : saved ? `${ic('check')} Saved` : (doc.path ? 'Edited · Save to update the file' : 'Edited · Save PDF to keep a copy');
  icons();
}

/* ---------------- rendering ---------------- */
const viewer = $('#viewer'), pagesEl = $('#pages');
async function pageOf(entry) { return pdfDocs.get(entry.src).getPage(entry.i + 1); }
// The zoom follows the window: 'fit' (Fit width) or 'page' (Fit page: the whole page in view).
const zoomFits = () => S.zoom === 'fit' || S.zoom === 'page';
// Page layout: 'scroll' (one page after another), 'two' (two pages side by side; S.cover puts the first page on
// its own, as a book's cover) or 'single' (one page at a time).
const twoUp = () => S.layout === 'two' && !!doc && doc.pages.length > 1;
const singleUp = () => S.layout === 'single';
function fitScale(page, entry) {
  const v = page.getViewport({ scale: 1, rotation: (page.rotate + entry.rot) % 360 });
  const across = twoUp() ? 2 : 1, w = (viewer.clientWidth - (isPhone() ? 32 : 48) - (across - 1) * 10) / across / v.width;
  // Fit page: the whole page (or two pages) in the window, with a little room above and below.
  if (S.zoom === 'page') return Math.max(0.1, Math.min(4, w, (viewer.clientHeight - 40) / v.height));
  // Fit the width, but no larger than 150%: a page wider than that reads worse, not better.
  return Math.max(0.25, Math.min(1.5, w));
}
let io, layoutGen = 0;
async function layoutPages(keep) {
  if (!doc) return;
  const gen = ++layoutGen; // a later layout (zooming quickly) replaces this one
  closeLineEditor(true); selContent = null;
  const anchor = keep ? current : 0;
  pagesEl.innerHTML = '';
  views = [];
  if (!doc.pages.length) { pagesEl.innerHTML = '<p class="empty-note">This PDF has no pages left. Insert a page or undo.</p>'; updateStatus(); return; }
  const first = await pageOf(doc.pages[0]);
  if (gen !== layoutGen) return false;
  scale = zoomFits() ? fitScale(first, doc.pages[0]) : S.zoom / 100;
  // Two pages side by side (the first on its own with a cover), or one page at a time.
  const two = twoUp(), cover = two && !!S.cover;
  pagesEl.classList.toggle('two', two); pagesEl.classList.toggle('single', singleUp());
  io && io.disconnect();
  io = new IntersectionObserver((ents) => { for (const e of ents) if (e.isIntersecting) renderView(views[+e.target.dataset.n]); }, { root: viewer, rootMargin: '600px 0px' });
  for (let n = 0; n < doc.pages.length; n++) {
    const entry = doc.pages[n];
    const page = await pageOf(entry);
    if (gen !== layoutGen) return false;
    const viewport = page.getViewport({ scale, rotation: (page.rotate + entry.rot) % 360 });
    const el = document.createElement('div');
    el.className = 'page'; el.dataset.n = n;
    if (two) { const right = cover ? n % 2 === 0 : n % 2 === 1; el.classList.add(right ? 'side-r' : 'side-l'); el.style.gridColumn = right ? 2 : 1; }
    el.style.width = viewport.width + 'px'; el.style.height = viewport.height + 'px';
    el.style.setProperty('--scale-factor', scale); el.style.setProperty('--total-scale-factor', scale); el.style.setProperty('--user-unit', 1);
    el.setAttribute('role', 'region'); el.setAttribute('aria-label', `Page ${n + 1} of ${doc.pages.length}`);
    pagesEl.appendChild(el);
    views.push({ el, entry, viewport, page, rendered: false });
    io.observe(el);
  }
  updateZoomLabel();
  if (keep) goPage(anchor, true); else if (singleUp()) showOnly(0);
  updateStatus();
  releaseFar();
  return true;
}
const linkService = {
  externalLinkEnabled: true, externalLinkTarget: 2, externalLinkRel: 'noopener noreferrer',
  pagesCount: 0, page: 1, rotation: 0, isInPresentationMode: false,
  addLinkAttributes(link, url) { link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; },
  getDestinationHash() { return '#'; }, getAnchorUrl() { return '#'; },
  async goToDestination(dest) { await goToDest(dest); }, goToPage(p) { goPage(p - 1); },
  navigateTo(dest) { goToDest(dest); }, executeNamedAction() {}, executeSetOCGState() {}, cachePageRef() {},
  isPageVisible() { return true; }, isPageCached() { return true; }, setHash() {},
};
async function renderView(v) {
  if (!v || v.rendered) return;
  v.rendered = true;
  const token = v.token = (v.token || 0) + 1, stale = () => v.token !== token;
  const { el, viewport, page } = v;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.className = 'pdf';
  canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
  el.appendChild(canvas);
  const pd = pdfDocs.get(v.entry.src);
  const canvasMap = new Map(); // pdf.js draws form widgets' looks (a checkbox ticked or not) here, for the form layer
  try {
    const skip = await imageSkip(v); if (stale()) return;
    v.task = page.render({ annotationCanvasMap: canvasMap, canvas, canvasContext: canvas.getContext('2d'), viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null, annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS, annotationStorage: pd.annotationStorage, operationsFilter: skip.filter });
    await v.task.promise;
    v.imgSig = skip.sig; v.imgHidden = skip.hidden;
  } catch (e) { if (!/cancel/i.test(String(e))) console.warn(e); }
  v.task = null;
  if (stale()) return;
  // Text you can select and search
  try {
    const tl = document.createElement('div'); tl.className = 'textLayer'; el.appendChild(tl);
    await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport }).render();
    // As pdf.js's own viewer does: while selecting, an unselectable layer under the text fills the gaps, so a drag
    // that ends past a line's last word stops there instead of reaching the next line.
    const eoc = document.createElement('div'); eoc.className = 'endOfContent'; tl.append(eoc); tl.__eoc = eoc;
    tl.addEventListener('pointerdown', () => tl.classList.add('selecting'));
  } catch (e) { console.warn('text layer', e); }
  if (stale()) return;
  // Form fields and links
  try {
    let annots = await page.getAnnotations({ intent: 'display' });
    if (stale()) return;
    // Comments deleted or changed with the Edit tool
    const ae = marksOf(v.entry).filter((m) => m.type === 'ae');
    if (ae.length) {
      const gone = new Set(ae.filter((m) => m.deleted).map((m) => m.ref));
      annots = annots.filter((a) => !gone.has(a.id) && !(a.parentId && gone.has(a.parentId)));
      for (const m of ae) if (m.contents != null) { const a = annots.find((x) => x.id === m.ref); if (a) a.contentsObj = { str: m.contents, dir: 'ltr' }; }
    }
    if (annots.length) {
      const al = document.createElement('div'); al.className = 'annotationLayer'; el.appendChild(al);
      linkService.pagesCount = doc.pages.length;
      const layer = new pdfjs.AnnotationLayer({ div: al, page, viewport: viewport.clone({ dontFlip: true }), accessibilityManager: null, annotationCanvasMap: canvasMap, annotationEditorUIManager: null, structTreeLayer: null, commentManager: null, linkService, annotationStorage: pd.annotationStorage });
      await layer.render({ annotations: annots, viewport: viewport.clone({ dontFlip: true }), page, linkService, renderForms: true, annotationStorage: pd.annotationStorage, enableScripting: false, hasJSActions: false, fieldObjects: null, imageResourcesPath: PDFJS_ICONS, downloadManager: null });
      al.addEventListener('input', () => setSaved(false));
      al.addEventListener('change', () => setSaved(false));
      // A field with no tooltip (/TU) is named after the field itself (/T), so a screen reader can say what it is for.
      for (const f of al.querySelectorAll('input, select, textarea')) {
        if (f.getAttribute('aria-label') || f.title || !f.name) continue;
        f.setAttribute('aria-label', f.name.split('.').pop().replace(/[_]+/g, ' ').trim() || 'Form field');
      }
    }
  } catch (e) { console.warn('annotation layer', e); }
  if (app.dataset.tool === 'edit') contentMap(page).then((cm) => { page._cmapValue = cm; }).catch(() => {}); // read ahead for Edit PDF
  if (marksOf(v.entry).some((m) => m.type === 'te')) { try { v.page._cmapValue = await contentMap(page); } catch {} }
  if (stale()) return;
  drawMarks(v);
  for (const f of FEATURE.afterRender) { try { f(v); } catch (e) { console.warn(e); } }
  if (findState.q) paintFind(v);
}
// Pictures moved or deleted with Edit PDF are left out when the page is drawn (so nothing has to be painted over
// them, which would also hide what is drawn on top of them, such as text over a background picture).
// A picture is known by its identity (raw: its place among the page's picture draws, the count saving uses too);
// marks from before that have only n (its place among the pictures that can be picked).
const imageSig = (v) => marksOf(v.entry).filter((m) => m.type === 'ie').map((m) => (m.raw != null ? 'r' + m.raw : 'n' + m.n)).sort().join(',');
const imageOf = (cm, m) => (m.raw != null ? cm.images.find((i) => i.raw === m.raw) || { n: m.n, raw: m.raw, quad: m.quad, mat: quadMat(m.quad) } : cm.images[m.n]);
async function imageSkip(v) {
  const sig = imageSig(v), hidden = new Set();
  if (!sig) return { sig, hidden, filter: null };
  let cm; try { cm = await contentMap(v.page); } catch { return { sig, hidden, filter: null }; }
  const raws = new Set();
  for (const m of marksOf(v.entry)) if (m.type === 'ie') { const im = imageOf(cm, m); if (im && im.raw != null) { raws.add(im.raw); hidden.add(m.id); } }
  const O = pdfjs.OPS, skipAt = new Set(); let seen = 0, k = -1;
  const filter = (i, ol) => {
    for (; seen <= i && seen < ol.fnArray.length; seen++) { const fn = ol.fnArray[seen]; if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject) { k++; if (raws.has(k)) skipAt.add(seen); } }
    return !skipAt.has(i);
  };
  return { sig, hidden, filter };
}
// The page drawn again, off screen, once the pictures to leave out change; then swapped in.
async function repaintCanvas(v) {
  const old = v.el.querySelector(':scope > canvas.pdf'); if (!old || v.repainting) return;
  v.repainting = true;
  const token = v.token, ratio = Math.min(window.devicePixelRatio || 1, 2), pd = pdfDocs.get(v.entry.src);
  try {
    const skip = await imageSkip(v);
    const c = document.createElement('canvas'); c.className = 'pdf'; c.width = old.width; c.height = old.height;
    await v.page.render({ annotationCanvasMap: new Map(), canvas: c, canvasContext: c.getContext('2d'), viewport: v.viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null, annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS, annotationStorage: pd.annotationStorage, operationsFilter: skip.filter }).promise;
    if (v.token !== token || !old.isConnected) return;
    old.replaceWith(c); old.width = old.height = 0;
    v.imgSig = skip.sig; v.imgHidden = skip.hidden;
  } catch (e) { if (!/cancel/i.test(String(e))) console.warn(e); } finally { v.repainting = false; }
  if (v.token === token) { if (imageSig(v) !== v.imgSig) repaintCanvas(v); else drawMarks(v); }
}
// Pages far from view give their drawing back, so a long PDF does not use more memory the further you scroll:
// pages within KEEP_NEAR pages of those in view (and within a screen or two of it) stay drawn; the rest keep only
// their size, mark-up and overlays, and are drawn again when they come back into view (typed form values are kept
// in the document's annotation storage).
const KEEP_NEAR = 3;
let keepPages = false;
function releaseView(v) {
  v.token = (v.token || 0) + 1; v.rendered = false;
  if (v.task) { try { v.task.cancel(); } catch {} v.task = null; }
  for (const n of [...v.el.querySelectorAll(':scope > canvas.pdf, :scope > .textLayer, :scope > .annotationLayer, :scope > .find-hit')]) {
    if (n.tagName === 'CANVAS') { n.width = 0; n.height = 0; }
    n.remove();
  }
  try { v.page.cleanup(); } catch {}
}
function releaseFar() {
  if (!views.length || keepPages) return;
  const vr = viewer.getBoundingClientRect(), margin = Math.max(1200, vr.height * 2);
  let lo = -1, hi = -1;
  views.forEach((v, n) => { const b = v.el.getBoundingClientRect(); if (b.bottom > vr.top && b.top < vr.bottom) { if (lo < 0) lo = n; hi = n; } });
  if (lo < 0) lo = hi = current;
  views.forEach((v, n) => {
    if (!v.rendered || (n >= lo - KEEP_NEAR && n <= hi + KEEP_NEAR)) return;
    if (v.el.contains(document.activeElement) || v.el.querySelector('.line-editor')) return;
    const b = v.el.getBoundingClientRect();
    if (b.bottom > vr.top - margin && b.top < vr.bottom + margin) return; // near enough to come back at once
    releaseView(v);
  });
}
let releaseTimer;
viewer.addEventListener('scroll', () => { clearTimeout(releaseTimer); releaseTimer = setTimeout(releaseFar, 250); }, { passive: true });
async function goToDest(dest) {
  try {
    const pd = pdfDocs.get(0);
    const explicit = typeof dest === 'string' ? await pd.getDestination(dest) : dest;
    if (!explicit) return;
    const idx = await pd.getPageIndex(explicit[0]);
    const n = doc.pages.findIndex((e) => e.src === 0 && e.i === idx);
    if (n >= 0) goPage(n);
  } catch {}
}
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
// Going to a page (a thumbnail, the page box, a link) holds `current` on that page while the view scrolls there, so
// a page command straight after acts on the page asked for, even when it can't reach the top (the last pages).
// Scrolling by hand (wheel, touch, keys, the scroll bar) lets the page in view decide again.
let navLock = 0, navTimer;
function navUnlock() { navLock = 0; clearTimeout(navTimer); }
function goPage(n, instant) {
  if (!views.length) return;
  n = Math.max(0, Math.min(views.length - 1, n));
  current = n; showOnly(n);
  const lock = ++navLock; clearTimeout(navTimer);
  navTimer = setTimeout(() => { if (navLock === lock) navLock = 0; }, 1500);
  viewer.scrollTo({ top: views[n].el.offsetTop - 16, behavior: instant || reduceMotion.matches ? 'instant' : 'smooth' });
  updateStatus(); markThumb();
}
// One page at a time: only the page asked for is shown.
function showOnly(n) {
  if (!singleUp()) return;
  views.forEach((v, k) => v.el.classList.toggle('shown', k === n));
}
viewer.addEventListener('scrollend', () => { const lock = navLock; if (lock) setTimeout(() => { if (navLock === lock) navLock = 0; }, 50); });
for (const ev of ['wheel', 'touchstart', 'pointerdown']) viewer.addEventListener(ev, navUnlock, { passive: true });
viewer.addEventListener('keydown', (e) => { if (/^(Arrow|Page|Home|End| )/.test(e.key)) navUnlock(); });
viewer.addEventListener('scroll', () => {
  if (!views.length || navLock || singleUp()) return;
  const mid = viewer.scrollTop + viewer.clientHeight / 3;
  let n = 0;
  // Two pages side by side: the left one of the pair in view (pages on one row share their top).
  for (let k = 0; k < views.length; k++) if (views[k].el.offsetTop <= mid && (!k || views[k].el.offsetTop !== views[k - 1].el.offsetTop)) n = k;
  if (n !== current) { current = n; updateStatus(); markThumb(); }
}, { passive: true });
function updateStatus() {
  $('#pageCount').textContent = doc ? doc.pages.length : 0;
  if (document.activeElement !== $('#pageJump')) $('#pageJump').value = doc && doc.pages.length ? current + 1 : '';
  refreshRibbon();
}
// The page box: Enter goes to the page and gives the keys back to the pages, so the box follows scrolling again.
const pageJump = $('#pageJump');
pageJump.addEventListener('change', (e) => { const n = parseInt(e.target.value, 10); if (n) goPage(n - 1); });
pageJump.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== 'Escape') return;
  e.preventDefault(); e.stopPropagation();
  if (e.key === 'Escape') pageJump.value = current + 1; // no change
  viewer.focus({ preventScroll: true });
});
pageJump.addEventListener('blur', () => setTimeout(updateStatus, 0));
// `at`: { x, y } on screen; that spot of the page stays where it is (zooming with the wheel or a pinch).
async function setZoom(z, at) {
  const a = at && pageAnchor(at.x, at.y);
  S.zoom = z; saveSettings();
  if (!(await layoutPages(!a)) || !a || !views[a.n]) return;
  const el = views[a.n].el;
  viewer.scrollTop = el.offsetTop + a.fy * el.offsetHeight - a.vy;
  viewer.scrollLeft = el.offsetLeft + a.fx * el.offsetWidth - a.vx;
}
// The page under a spot on screen, and where on it (fractions of its size).
function pageAnchor(cx, cy) {
  const vr = viewer.getBoundingClientRect();
  let best = null, bd = Infinity;
  for (const v of views) {
    const b = v.el.getBoundingClientRect(), d = cy < b.top ? b.top - cy : cy > b.bottom ? cy - b.bottom : 0;
    if (d < bd) { bd = d; best = { n: +v.el.dataset.n, fx: (cx - b.left) / b.width, fy: (cy - b.top) / b.height, vx: cx - vr.left, vy: cy - vr.top }; }
    if (!d) break;
  }
  return best;
}
// Zooming around the pointer: Ctrl or Cmd with the wheel, a trackpad pinch (sent as Ctrl with the wheel, or as
// gesture events in Safari and the Mac app) and two fingers on a touch screen. The pages are scaled while the gesture
// lasts, then drawn again at the new size with the same spot under the pointer.
let pinch = null; // { base, k, at, timer, kind }
function pinchStart(x, y, kind) {
  if (!has() || !views.length) return null;
  if (pinch) return pinch;
  const pr = pagesEl.getBoundingClientRect();
  pagesEl.style.transformOrigin = `${x - pr.left}px ${y - pr.top}px`;
  return (pinch = { base: scale * 100, k: 1, at: { x, y }, kind });
}
function pinchTo(k) {
  if (!pinch) return;
  pinch.k = Math.max(25 / pinch.base, Math.min(400 / pinch.base, k));
  pagesEl.style.transform = `scale(${pinch.k})`;
}
function pinchEnd() {
  const p = pinch; if (!p) return;
  pinch = null; clearTimeout(p.timer);
  const z = Math.round(p.base * p.k);
  pagesEl.style.transform = pagesEl.style.transformOrigin = '';
  if (Math.abs(z - p.base) >= 1) setZoom(z, p.at);
}
viewer.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey) || !has()) return;
  e.preventDefault(); // not the browser's own zoom of the whole window
  if (pinch && pinch.kind !== 'wheel') return;
  const p = pinchStart(e.clientX, e.clientY, 'wheel'); if (!p) return;
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  pinchTo(p.k * Math.exp(-Math.max(-60, Math.min(60, dy)) / 200));
  clearTimeout(p.timer); p.timer = setTimeout(pinchEnd, 200);
}, { passive: false });
viewer.addEventListener('gesturestart', (e) => { e.preventDefault(); if (!pinch) pinchStart(e.clientX, e.clientY, 'gesture'); });
viewer.addEventListener('gesturechange', (e) => { e.preventDefault(); if (pinch && pinch.kind === 'gesture') pinchTo(e.scale); });
viewer.addEventListener('gestureend', (e) => { e.preventDefault(); if (pinch && pinch.kind === 'gesture') pinchEnd(); });
const touchGap = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
viewer.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 2) return;
  if (pinch && pinch.kind !== 'touch') return;
  const t = e.touches, p = pinchStart((t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2, 'touch');
  if (p) p.gap = touchGap(t) / p.k;
}, { passive: true });
viewer.addEventListener('touchmove', (e) => {
  if (!pinch || pinch.kind !== 'touch' || e.touches.length < 2) return;
  if (e.cancelable) e.preventDefault();
  pinchTo(touchGap(e.touches) / pinch.gap);
}, { passive: false });
const touchDone = (e) => { if (pinch && pinch.kind === 'touch' && e.touches.length < 2) pinchEnd(); };
viewer.addEventListener('touchend', touchDone); viewer.addEventListener('touchcancel', touchDone);
function updateZoomLabel() {
  $('#zoomLabel').textContent = S.zoom === 'fit' ? `Fit · ${Math.round(scale * 100)}%` : S.zoom === 'page' ? `Fit page · ${Math.round(scale * 100)}%` : `${S.zoom}%`;
  $('#zoomRange').value = Math.round(scale * 100);
}
$('#zoomRange').addEventListener('change', (e) => setZoom(+e.target.value));
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (doc && zoomFits()) layoutPages(true); }, 200); });

/* ---------------- mark-up ----------------
   Every mark lives in PDF coordinates (points, y up), converted to the screen with the page's viewport.
   hl: highlight rects · ink: pen strokes · rect: box · text: a text box · note: a sticky note · img: signature or picture */
const NS = 'http://www.w3.org/2000/svg';
const toView = (v, x, y) => v.viewport.convertToViewportPoint(x, y);
const toPdf = (v, x, y) => v.viewport.convertToPdfPoint(x, y);
const totalRot = (v) => (v.page.rotate + v.entry.rot) % 360;
function marksOf(entry) { return doc.marks[pageKey(entry)] || (doc.marks[pageKey(entry)] = []); }
// Document-wide settings (a watermark, headers and footers…): a list of { type, … } objects kept with the marks,
// so they are stored, undone and restored the same way.
function docMarks() { return doc.marks.__doc || (doc.marks.__doc = []); }
function svgEl(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
function drawMarks(v) {
  let svg = v.el.querySelector('svg.marks');
  if (!svg) {
    svg = svgEl('svg', { class: 'marks' });
    v.el.appendChild(svg);
    svg.addEventListener('pointerdown', (e) => onMarksDown(e, v));
    svg.addEventListener('pointermove', (e) => { onEditHover(e, v); const ft = FEATURE.tools[app.dataset.tool]; if (ft && ft.move) ft.move(e, v); });
    svg.addEventListener('dblclick', (e) => onMarksDblClick(e, v));
  }
  svg.setAttribute('viewBox', `0 0 ${v.viewport.width} ${v.viewport.height}`);
  svg.innerHTML = '';
  if (v.rendered && v.imgSig != null && imageSig(v) !== v.imgSig) repaintCanvas(v);
  const rotNow = totalRot(v);
  const all = marksOf(v.entry);
  const under = (x) => CONTENT_TYPES.has(x.type) || !!(FEATURE.markTypes[x.type] && FEATURE.markTypes[x.type].under);
  for (const m of all.filter(under).concat(all.filter((x) => !under(x)))) {
    let g;
    if (FEATURE.markTypes[m.type]) g = FEATURE.markTypes[m.type].draw(v, m, svg);
    else if (CONTENT_TYPES.has(m.type)) g = drawContentMark(v, m, svg);
    else if (m.type === 'hl') {
      g = svgEl('g', { class: 'mk' });
      for (const r of m.rects) {
        const [x1, y1] = toView(v, r[0], r[1]), [x2, y2] = toView(v, r[2], r[3]);
        g.appendChild(svgEl('rect', { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), fill: m.color, 'fill-opacity': .4, style: 'mix-blend-mode:multiply' }));
      }
    } else if (m.type === 'ink') {
      const d = m.pts.map((p, k) => { const [x, y] = toView(v, p[0], p[1]); return (k ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }).join('');
      g = svgEl('path', { class: 'mk', d, fill: 'none', stroke: m.color, 'stroke-width': m.w * scale, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    } else if (m.type === 'rect') {
      const [x1, y1] = toView(v, m.x1, m.y1), [x2, y2] = toView(v, m.x2, m.y2);
      g = svgEl('rect', { class: 'mk', x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), fill: 'none', stroke: m.color, 'stroke-width': m.w * scale });
    } else if (m.type === 'text') {
      const [x, y] = toView(v, m.x, m.y);
      g = svgEl('text', { class: 'mk', x, y, fill: m.color, 'font-size': m.size * scale, 'font-family': 'Helvetica, Arial, sans-serif', transform: `rotate(${(rotNow - m.rot + 360) % 360} ${x} ${y})` });
      m.text.split('\n').forEach((line, k) => { const t = svgEl('tspan', { x, dy: k ? m.size * scale * 1.2 : m.size * scale * .85 }); t.textContent = line || ' '; g.appendChild(t); });
    } else if (m.type === 'note') {
      const [x, y] = toView(v, m.x, m.y);
      g = svgEl('g', { class: 'mk', transform: `translate(${x} ${y})` });
      g.appendChild(svgEl('rect', { x: 0, y: 0, width: 22, height: 22, rx: 4, fill: '#FFD43B', stroke: '#B88A00' }));
      g.appendChild(svgEl('path', { d: 'M6 8h10M6 12h10M6 16h6', stroke: '#6B4F00', 'stroke-width': 1.6, 'stroke-linecap': 'round' }));
      const t = svgEl('title', {}); t.textContent = m.text; g.appendChild(t);
    } else if (m.type === 'img') {
      const [x, y] = toView(v, m.x, m.y);
      g = svgEl('image', { class: 'mk', x, y, width: m.w * scale, height: m.h * scale, href: m.data, transform: `rotate(${(rotNow - m.rot + 360) % 360} ${x} ${y})` });
    }
    if (!g) continue;
    g.dataset.id = m.id; g.dataset.type = m.type;
    if (g.classList.contains('mk')) { g.setAttribute('role', 'img'); g.setAttribute('aria-label', markLabel(m, true)); }
    if (selMark && selMark.id === m.id) g.classList.add('sel');
    svg.appendChild(g);
  }
  // A thumbnail is a picture of the layer, without the page's styles: no selection box or handles in it.
  if (v.thumb) return;
  drawSelection(v, svg);
  drawMarkBox(v, svg);
}
/* The selected mark: a dashed box around it, with handles that resize it.
   Shapes, lines, drawings and area highlights stretch either way; stamps, text, callouts and pictures keep their
   proportions (corner handles only). Notes and text mark-up only show the box. */
const MARK_STRETCH = (m) => ['rect', 'ink', 'cmShape'].includes(m.type) || (m.type === 'hl' && m.area);
const MARK_SCALE = { text: ['size', 'bw', 'w'], cmType: ['size'], cmCallout: ['size', 'bw', 'bh'], cmStamp: ['size', 'bw', 'bh'] };
const MARK_HANDLES = { nw: [0, 0], n: [.5, 0], ne: [1, 0], e: [1, .5], se: [1, 1], s: [.5, 1], sw: [0, 1], w: [0, .5] };
// The mark's box on screen (page pixels), from its geometry (strokes left out).
function markViewBox(svg, el) {
  let b; try { b = el.getBBox(); } catch { return null; }
  const m = svg.getScreenCTM && svg.getScreenCTM() && el.getScreenCTM ? svg.getScreenCTM().inverse().multiply(el.getScreenCTM()) : null;
  const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => m ? [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f] : [x, y]);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
function drawMarkBox(v, svg) {
  if (!selMark || pageKey(v.entry) !== selMark.key) return;
  const m = selectedMark(), el = m && svg.querySelector(`[data-id="${CSS.escape(m.id)}"]`);
  if (!el || m.type === 'ff' || !el.classList.contains('mk')) return;
  const b = markViewBox(svg, el); if (!b) return;
  const pad = 4, [x0, y0, x1, y1] = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
  const g = svgEl('g', { class: 'mk-selbox-g' });
  g.appendChild(svgEl('rect', { class: 'mk-selbox', x: x0, y: y0, width: x1 - x0, height: y1 - y0 }));
  const stretch = MARK_STRETCH(m), keep = !!MARK_SCALE[m.type];
  if (stretch || keep) {
    const big = coarse(), s = big ? 14 : 9;
    for (const [h, [fx, fy]] of Object.entries(MARK_HANDLES)) {
      if (keep && h.length < 2) continue;
      const hx = x0 + (x1 - x0) * fx, hy = y0 + (y1 - y0) * fy;
      if (big) g.appendChild(svgEl('rect', { class: 'mk-handle mk-handle-hit', 'data-h': h, x: hx - 16, y: hy - 16, width: 32, height: 32 }));
      g.appendChild(svgEl('rect', { class: 'mk-handle', 'data-h': h, x: hx - s / 2, y: hy - s / 2, width: s, height: s, rx: 2 }));
    }
  }
  svg.appendChild(g);
}
// Moves the points of mark m (from its original o) by P, a map of PDF points; k scales its sizes (kept proportions).
function resizeMark(m, o, P, k) {
  const own = FEATURE.markTypes[m.type] && FEATURE.markTypes[m.type].resize;
  if (own) return own(m, o, P, k);
  if (o.rects) m.rects = o.rects.map((r) => [...P([r[0], r[1]]), ...P([r[2], r[3]])]);
  if (o.pts) m.pts = o.pts.map(P);
  if ('x1' in o) { [m.x1, m.y1] = P([o.x1, o.y1]); [m.x2, m.y2] = P([o.x2, o.y2]); }
  if ('x' in o) [m.x, m.y] = P([o.x, o.y]);
  if ('tx' in o) [m.tx, m.ty] = P([o.tx, o.ty]);
  for (const f of MARK_SCALE[m.type] || []) if (typeof o[f] === 'number' && o[f] > 0) m[f] = o[f] * k;
  if (m.type === 'text' && Array.isArray(o.lw)) m.lw = o.lw.map((n) => n * k);
}
// Dragging a handle: the opposite side stays where it is. One undo step.
function startResize(e, v, h) {
  const m = selectedMark(), svg = v.el.querySelector('svg.marks'), el = m && svg.querySelector(`[data-id="${CSS.escape(m.id)}"]`);
  const b = el && markViewBox(svg, el); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const before = snapshot(), orig = JSON.parse(JSON.stringify(m)), keep = !MARK_STRETCH(m), [fx, fy] = MARK_HANDLES[h];
  const ax = b[0] + (b[2] - b[0]) * (1 - fx), ay = b[1] + (b[3] - b[1]) * (1 - fy), w0 = Math.max(1, b[2] - b[0]), h0 = Math.max(1, b[3] - b[1]);
  const [sx0, sy0] = localPoint(e, v);
  let moved = false;
  const move = (ev) => {
    const [px, py] = localPoint(ev, v);
    if (!moved && Math.hypot(px - sx0, py - sy0) < 2) return;
    moved = true;
    // the handle's side follows the pointer; a box can't be turned inside out
    let sx = fx === .5 ? 1 : Math.max(4 / w0, (w0 + (fx ? px - sx0 : sx0 - px)) / w0);
    let sy = fy === .5 ? 1 : Math.max(4 / h0, (h0 + (fy ? py - sy0 : sy0 - py)) / h0);
    if (keep) sx = sy = Math.max(sx, sy, 8 / Math.max(w0, h0));
    const P = ([x, y]) => { const [vx, vy] = toView(v, x, y); return toPdf(v, ax + (vx - ax) * sx, ay + (vy - ay) * sy); };
    resizeMark(m, orig, P, sx);
    drawMarks(v);
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); if (moved) changed(before); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}
function redrawPage(entry) { for (const v of views) if (v.entry === entry && v.rendered) drawMarks(v); }
function snapshot() { return JSON.stringify({ pages: doc.pages, marks: doc.marks }); }
// Each step of undo has a name ("Undo Watermark"): the one given, or worked out from what changed.
function changed(before, what) {
  if (kbPlace) kbPlaced();
  let name = what; if (!name) { try { name = changeName(before); } catch { name = ''; } }
  undoStack.push({ s: before, what: name || 'Change' }); if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  setSaved(false); persist(); refreshRibbon(); thumbsLater();
}
const CHANGE_NAMES = { te: 'Text edit', tpara: 'Text edit', ie: 'Picture', erase: 'Erase', ae: 'Comment', hl: 'Highlight', ink: 'Drawing', rect: 'Rectangle', text: 'Text box', note: 'Note', img: 'Picture', pic: 'Picture', link: 'Link', lnkx: 'Link', redact: 'Redaction', cmMarkup: 'Text mark-up', cmShape: 'Shape', cmCallout: 'Callout', cmType: 'Typewriter text', cmStamp: 'Stamp', cmReply: 'Reply', ff: 'Form field', ffmod: 'Form field', ffflat: 'Flatten form', file: 'Attachment', docinfo: 'Document properties', bookmarks: 'Bookmarks', protsec: 'Security', pd_watermark: 'Watermark', pd_background: 'Background', pd_headfoot: 'Header & footer', pd_bates: 'Bates numbering' };
const MOVE_KEYS = new Set(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'pts', 'rects', 'quads', 'mat', 'tx', 'ty', 'dx', 'dy', 'rect']);
function changeName(before) {
  const o = JSON.parse(before), a = o.pages, b = doc.pages;
  if (a.length !== b.length) return a.length < b.length ? 'Insert pages' : 'Delete pages';
  const key = (e) => e.src + ':' + e.i;
  if (a.some((e, k) => key(e) !== key(b[k]))) return 'Move pages';
  for (let k = 0; k < a.length; k++) { const x = a[k], y = b[k]; if ((x.rot || 0) !== (y.rot || 0)) return 'Rotate pages'; if (JSON.stringify(x.crop || null) !== JSON.stringify(y.crop || null)) return 'Crop'; }
  const flat = (marks) => { const m = new Map(); for (const list of Object.values(marks || {})) for (const x of list || []) if (x && x.id) m.set(x.id, x); return m; };
  const was = flat(o.marks), now = flat(doc.marks);
  const nameOf = (m) => (m.type === 'cmShape' && m.kind ? m.kind[0].toUpperCase() + m.kind.slice(1) : CHANGE_NAMES[m.type] || (FEATURE.markTypes[m.type] && FEATURE.markTypes[m.type].label) || 'Change');
  const low = (n) => n.replace(/^[A-Z](?![A-Z])/, (c) => c.toLowerCase());
  for (const [id, m] of now) {
    const p = was.get(id);
    if (!p) return m.type === 'ie' && m.deleted ? 'Delete picture' : m.type === 'ae' && m.deleted ? 'Delete comment' : nameOf(m);
    if (JSON.stringify(p) === JSON.stringify(m)) continue;
    if (m.deleted && !p.deleted) return 'Delete ' + low(nameOf(m));
    const diff = Object.keys({ ...p, ...m }).filter((k) => JSON.stringify(p[k]) !== JSON.stringify(m[k]));
    return diff.length && diff.every((k) => MOVE_KEYS.has(k)) ? 'Move ' + low(nameOf(m)) : nameOf(m);
  }
  for (const [id, m] of was) if (!now.has(id)) return (m.type === 'te' || m.type === 'tpara') ? 'Text edit' : 'Delete ' + low(nameOf(m));
  return 'Change';
}
const undoName = () => (undoStack.length ? undoStack[undoStack.length - 1].what : '');
const redoName = () => (redoStack.length ? redoStack[redoStack.length - 1].what : '');
function restore(s, layout) {
  const o = JSON.parse(s); doc.pages = o.pages; doc.marks = o.marks; selMark = null; selContent = null;
  syncHiddenComments();
  layout ? layoutPages(true).then(renderSide) : views.forEach((v) => v.rendered && drawMarks(v));
  if (!layout && S.side === 'outline') renderSide(); // bookmarks are kept with the marks
  setSaved(false); persist(); refreshRibbon(); thumbsLater();
}
function undo() { if (!undoStack.length) return; const now = snapshot(); const { s: prev, what } = undoStack.pop(); redoStack.push({ s: now, what }); restore(prev, JSON.parse(prev).pages.length !== doc.pages.length || prev.includes('"rot"') && prev !== now); toast('Undid: ' + what); }
function redo() { if (!redoStack.length) return; const now = snapshot(); const { s: next, what } = redoStack.pop(); undoStack.push({ s: now, what }); restore(next, true); toast('Redid: ' + what); }
function localPoint(e, v) { const r = v.el.getBoundingClientRect(); return [(e.clientX - r.left), (e.clientY - r.top)]; }
let markDown = null; // { id, t }: the last press on a note or text box
function onMarksDown(e, v) {
  const tool = app.dataset.tool;
  if (e.button === 2) return; // a right-click opens the menu; it doesn't draw
  // A click on the page takes the focus off the ribbon, so Space or typing never runs the tool's button again.
  { const a = document.activeElement; if (!a || !(a === viewer || viewer.contains(a))) viewer.focus({ preventScroll: true }); }
  if (tool === 'edit') return editDownBusy(e, v);
  if (tool === 'erase') return startErase(e, v);
  const handle = e.target.closest('.mk-handle');
  if (handle) return startResize(e, v, handle.dataset.h);
  if (FEATURE.tools[tool]) return FEATURE.tools[tool].down(e, v);
  const hit = e.target.closest('.mk');
  if (tool === 'select') {
    if (!hit) { selectMark(null); return; }
    selectMark({ key: pageKey(v.entry), id: hit.dataset.id, entry: v.entry });
    const m = marksOf(v.entry).find((x) => x.id === hit.dataset.id);
    // A second press on a note or text box within half a second changes its words (pointer events carry no
    // click count, and the redraw after the first press means no dblclick arrives).
    if (m && (m.type === 'note' || m.type === 'text')) {
      const now = Date.now(), again = markDown && markDown.id === m.id && now - markDown.t < 500;
      markDown = again ? null : { id: m.id, t: now };
      if (again) { e.preventDefault(); setTimeout(() => (m.type === 'note' ? editNote : editText)(v, m), 0); return; }
    }
    startMove(e, v, m);
    return;
  }
  const [px, py] = localPoint(e, v);
  const [x, y] = toPdf(v, px, py);
  if (tool === 'pen') return startInk(e, v);
  if (tool === 'rect') return startRect(e, v);
  if (tool === 'text') { e.preventDefault(); return addText(v, x, y); }
  if (tool === 'note') { e.preventDefault(); if (pageAskTook(e)) return; return addNote(v, x, y); }
  if (tool === 'sign' || tool === 'image') { e.preventDefault(); return placeImage(v, px, py); }
}
// Double-click: change a note's or a text box's words (Select), or a comment's (Edit PDF).
async function onMarksDblClick(e, v) {
  const tool = app.dataset.tool, hit = e.target.closest && e.target.closest('.mk');
  if (tool === 'select' && hit) {
    const m = marksOf(v.entry).find((x) => x.id === hit.dataset.id);
    if (m && m.type === 'note') editNote(v, m); else if (m && m.type === 'text') editText(v, m);
    return;
  }
  if (tool === 'edit') {
    const [x, y] = toPdf(v, ...localPoint(e, v)), hit = await contentAt(v, x, y);
    if (hit && hit.kind === 'annot') { selectContent({ v, ...hit }); editComment(v, hit.a, hit.mark); }
  }
}
function selectMark(s) {
  const was = selMark; selMark = s; views.forEach((v) => v.rendered && drawMarks(v)); refreshRibbon();
  if (s && (!was || was.id !== s.id)) { const m = selectedMark(); if (m) announce(`${markLabel(m)} selected. ${coarse() ? 'Drag it to move it.' : 'Arrow keys move it, Delete removes it.'}`); }
}
// What a mark is, in words ('Oval'; with its text too when `full`). Features add names for their marks.
const MARK_NAMES = { hl: 'Highlight', ink: 'Drawing', rect: 'Rectangle', text: 'Text', note: 'Note', img: 'Picture', pic: 'Picture', tpara: 'Edited text', ff: 'Form field', redact: 'Redaction', link: 'Link' };
function markLabel(m, full) {
  let name = '', text = '';
  for (const f of FEATURE.markLabels || []) { const d = f(m); if (d && d.label) { name = d.label; text = d.text || ''; break; } }
  name ||= MARK_NAMES[m.type] || 'Item';
  if (!text && typeof m.text === 'string') text = m.text;
  text = String(text).replace(/\s+/g, ' ').trim();
  return full && text ? `${name}: ${text.length > 80 ? text.slice(0, 79) + '…' : text}` : name;
}
// Said by screen readers, not shown.
function announce(msg) { const a = $('#announce'); if (!a) return; a.textContent = ''; setTimeout(() => { a.textContent = msg; }, 30); }
// A mark just drawn is selected, so it can be restyled at once (the tool stays on for the next one).
const selectNew = (v, m) => { if (marksOf(v.entry).includes(m)) selectMark({ key: pageKey(v.entry), id: m.id, entry: v.entry }); };
function deleteSelected() {
  if (selContent) return deleteContent();
  if (!selMark) return;
  const before = snapshot();
  const list = doc.marks[selMark.key] || [];
  const k = list.findIndex((m) => m.id === selMark.id);
  if (k < 0) return;
  list.splice(k, 1); const entry = selMark.entry; selMark = null; redrawPage(entry); changed(before);
}
// Moves mark m to its original o moved by dx, dy points (dragging, arrow keys, pasting).
function offsetMark(m, o, dx, dy) {
  if (o.rects) m.rects = o.rects.map((r) => [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy]);
  if (o.pts) m.pts = o.pts.map((p) => [p[0] + dx, p[1] + dy]);
  if ('x1' in o) { m.x1 = o.x1 + dx; m.x2 = o.x2 + dx; m.y1 = o.y1 + dy; m.y2 = o.y2 + dy; }
  if ('x' in o) { m.x = o.x + dx; m.y = o.y + dy; }
  if (FEATURE.markTypes[m.type] && FEATURE.markTypes[m.type].move) FEATURE.markTypes[m.type].move(m, o, dx, dy);
}
const selectedMark = () => selMark && (doc.marks[selMark.key] || []).find((m) => m.id === selMark.id);
// Arrow keys: 1 pt a press (10 with Shift), along the page as it is shown.
function nudgeMark(key, big) {
  const m = selectedMark(); if (!m) return false;
  const d = big ? 10 : 1, v = views.find((x) => x.entry === selMark.entry);
  let [dx, dy] = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[key];
  if (v) { const [x0, y0] = toPdf(v, 0, 0), [x1, y1] = toPdf(v, dx * scale, dy * scale); [dx, dy] = [x1 - x0, y1 - y0]; }
  const before = snapshot();
  offsetMark(m, JSON.parse(JSON.stringify(m)), dx, dy);
  redrawPage(selMark.entry); changed(before);
  return true;
}
// Alt+Shift+arrows: the selected mark's right edge (Left, Right) or bottom edge (Up, Down) moves 2 pt, as dragging its
// handle would; a mark that keeps its proportions grows or shrinks from its top-left corner.
function sizeMark(key) {
  const m = selectedMark(), v = m && views.find((x) => x.entry === selMark.entry && x.rendered); if (!v) return false;
  const svg = v.el.querySelector('svg.marks'), el = svg && svg.querySelector(`[data-id="${CSS.escape(m.id)}"]`), b = el && markViewBox(svg, el);
  const stretch = MARK_STRETCH(m) || ((('x1' in m) || (Array.isArray(m.quads) && m.type !== 'cmMarkup')) && !MARK_SCALE[m.type]); // form fields, redaction areas too
  if (!b || !(stretch || MARK_SCALE[m.type])) return false;
  const d = 2 * scale, w0 = Math.max(1, b[2] - b[0]), h0 = Math.max(1, b[3] - b[1]);
  let sx = 1 + ({ ArrowRight: d, ArrowLeft: -d }[key] || 0) / w0, sy = 1 + ({ ArrowDown: d, ArrowUp: -d }[key] || 0) / h0;
  sx = Math.max(sx, 4 / w0); sy = Math.max(sy, 4 / h0);
  if (!stretch) sx = sy = key === 'ArrowRight' || key === 'ArrowDown' ? Math.max(sx, sy) : Math.min(sx, sy);
  const before = snapshot(), orig = JSON.parse(JSON.stringify(m)), [ax, ay] = [b[0], b[1]];
  const P = ([x, y]) => { const [vx, vy] = toView(v, x, y); return toPdf(v, ax + (vx - ax) * sx, ay + (vy - ay) * sy); };
  resizeMark(m, orig, P, sx);
  if (Array.isArray(orig.quads) && m.type !== 'cmMarkup') m.quads = orig.quads.map((q) => Array.isArray(q[0]) ? q.map(P) : q);
  redrawPage(selMark.entry); changed(before);
  return true;
}
// Copy, paste and duplicate the selected mark. A paste lands on the page in view, 10 pt down and right of the
// original (or of the last paste), and is selected.
let markClip = null;
function copyMark() { const m = selectedMark(); if (!m) return false; markClip = { m: JSON.stringify(m), n: 0 }; toast('Copied'); return true; }
// From a right-click menu: on page `v`, its top left corner at x, y (PDF points).
function pasteMark(src, v, x, y) {
  const clip = src || markClip; if (!clip || !has()) return false;
  const entry = v ? v.entry : src ? selMark.entry : doc.pages[current];
  const m = JSON.parse(clip.m), k = ++clip.n * 10;
  m.id = uid(); delete m.pending;
  const before = snapshot();
  const c = v && markCorner(m);
  if (c) { clip.n--; offsetMark(m, JSON.parse(clip.m), x - c[0], y - c[1]); } else offsetMark(m, JSON.parse(clip.m), k, -k);
  marksOf(entry).push(m); changed(before);
  selectMark({ key: pageKey(entry), id: m.id, entry });
  return true;
}
// A mark's top left corner (PDF points, y up), for the kinds of mark that have one.
function markCorner(m) {
  const pts = m.rects ? m.rects.flatMap((r) => [[r[0], r[1]], [r[2], r[3]]]) : m.pts ? m.pts : 'x1' in m ? [[m.x1, m.y1], [m.x2, m.y2]] : 'x' in m ? [[m.x, m.y]] : null;
  return pts && pts.length ? [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] : null;
}
const duplicateMark = () => { const m = selectedMark(); return !!m && pasteMark({ m: JSON.stringify(m), n: 0 }); };
function startMove(e, v, m) {
  if (!m) return;
  e.preventDefault();
  const before = snapshot();
  const [sx, sy] = toPdf(v, ...localPoint(e, v));
  const orig = JSON.stringify(m);
  let moved = false;
  const move = (ev) => {
    const [cx, cy] = toPdf(v, ...localPoint(ev, v));
    offsetMark(m, JSON.parse(orig), cx - sx, cy - sy);
    moved = true; drawMarks(v);
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (moved) changed(before); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
function startInk(e, v) {
  e.preventDefault();
  const before = snapshot();
  const m = { id: uid(), type: 'ink', pts: [toPdf(v, ...localPoint(e, v))], color: toolColor('pen'), w: S.width };
  marksOf(v.entry).push(m);
  const move = (ev) => { m.pts.push(toPdf(v, ...localPoint(ev, v))); drawMarks(v); };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (m.pts.length < 2) m.pts.push(m.pts[0]); drawMarks(v); changed(before); selectNew(v, m); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
function startRect(e, v) {
  e.preventDefault();
  const before = snapshot();
  const [x, y] = toPdf(v, ...localPoint(e, v));
  const m = { id: uid(), type: 'rect', x1: x, y1: y, x2: x, y2: y, color: toolColor('rect'), w: S.width };
  marksOf(v.entry).push(m);
  const move = (ev) => { [m.x2, m.y2] = toPdf(v, ...localPoint(ev, v)); drawMarks(v); };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    if (Math.abs(m.x2 - m.x1) < 3 && Math.abs(m.y2 - m.y1) < 3) { marksOf(v.entry).splice(marksOf(v.entry).indexOf(m), 1); drawMarks(v); return; }
    changed(before); selectNew(v, m);
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
async function addText(v, x, y) {
  const text = await askText('Add text', 'Type the text to place on the page.', '', 'Add', false, true);
  if (!text) return;
  const before = snapshot();
  const m = { id: uid(), type: 'text', x, y, text, size: 14, color: toolColor('text'), rot: totalRot(v) };
  marksOf(v.entry).push(m);
  drawMarks(v); changed(before); setTool('select'); selectNew(v, m);
}
async function editText(v, m) {
  const text = await askText('Edit text', '', m.text, 'Save', false, true);
  if (text == null) return;
  const before = snapshot(); m.text = text; drawMarks(v); changed(before);
}
/* A small editor that opens on the page, by what it is for (a note's words…). Like the text editors, Escape, Done,
   Ctrl+Enter (⌘Return) and a click away all keep what was typed; Undo takes it back. Resolves with the text. */
let pageAskOpen = null, pageAskAway = 0;
function pageAsk(v, px, py, { label, text = '', done = 'Done', placeholder = '' }) {
  if (pageAskOpen) pageAskOpen.finish();
  return new Promise((res) => {
    const box = document.createElement('div');
    box.className = 'page-ask'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', label);
    box.innerHTML = `<div class="page-ask-h">${esc(label)}</div><textarea rows="3" spellcheck="true" aria-label="${esc(label)}" placeholder="${esc(placeholder)}"></textarea><div class="page-ask-f"><button type="button" class="btn primary">${esc(done)}</button></div>`;
    const ta = $('textarea', box); ta.value = text;
    v.el.appendChild(box);
    const W = v.el.clientWidth, H = v.el.clientHeight, w = box.offsetWidth, h = box.offsetHeight;
    box.style.left = Math.max(4, Math.min(px + 14, W - w - 4)) + 'px';
    box.style.top = (py + 14 + h > H - 4 && py - h - 14 > 4 ? py - h - 14 : Math.max(4, Math.min(py + 14, H - h - 4))) + 'px';
    const P = pageAskOpen = { box, finish: () => {
      if (pageAskOpen !== P) return;
      pageAskOpen = null; document.removeEventListener('pointerdown', away, true);
      const had = box.contains(document.activeElement); box.remove();
      if (had) viewer.focus({ preventScroll: true });
      res(ta.value.replace(/\r/g, ''));
    } };
    // A press anywhere else keeps the text; on the page it does only that (it doesn't also add another note).
    const away = (e) => { if (box.contains(e.target)) return; if (e.target.closest && e.target.closest('.page')) pageAskAway = e.timeStamp; P.finish(); };
    document.addEventListener('pointerdown', away, true);
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); e.stopPropagation(); P.finish(); keptHint(!!ta.value.trim() && ta.value !== text); return; }
      if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
    });
    $('button', box).onclick = () => P.finish();
    ta.focus({ preventScroll: true }); ta.select();
    if (!coarse()) box.scrollIntoView({ block: 'nearest' });
  });
}
const pageAskTook = (e) => e && pageAskAway && e.timeStamp === pageAskAway;
TEST_HOOKS.pageAskOpen = () => !!pageAskOpen;
// Note: the note is placed where clicked and its words typed beside it. Left empty, no note is added.
async function addNote(v, x, y) {
  const before = snapshot(), m = { id: uid(), type: 'note', x, y, text: '' }, list = marksOf(v.entry);
  list.push(m); drawMarks(v);
  const text = await pageAsk(v, ...toView(v, x, y), { label: 'Note', placeholder: 'Type a note' });
  if (!text.trim()) { const k = list.indexOf(m); if (k >= 0) list.splice(k, 1); drawMarks(v); kbPlace = null; return; }
  m.text = text; drawMarks(v); changed(before);
}
async function editNote(v, m) {
  const text = await pageAsk(v, ...toView(v, m.x, m.y), { label: 'Note', text: m.text });
  if (text === m.text) return;
  const before = snapshot(), list = marksOf(v.entry);
  if (!text.trim()) { const k = list.indexOf(m); if (k >= 0) list.splice(k, 1); selectMark(null); drawMarks(v); changed(before); toast('Note removed'); return; }
  m.text = text; drawMarks(v); changed(before);
}
let pendingImage = null; // { data, w, h } waiting to be placed
const placeHint = (what) => coarse() ? `Tap where ${what} goes` : `Click where ${what} goes, or press Enter to put it in the middle`;
function placeImage(v, px, py) {
  if (!pendingImage) return;
  const before = snapshot();
  const [x, y] = toPdf(v, px, py);
  marksOf(v.entry).push({ id: uid(), type: 'img', x, y, w: pendingImage.w, h: pendingImage.h, data: pendingImage.data, rot: totalRot(v) });
  const m = marksOf(v.entry)[marksOf(v.entry).length - 1];
  pendingImage = null; drawMarks(v); changed(before); setTool('select'); selectNew(v, m);
}
/* Selecting text, as pdf.js's viewer does it (TextLayerBuilder): while a selection is made, each text layer's
   endOfContent covers the layer, and (in browsers that need it: Safari, Chromium before 148) it is moved right after
   the span the selection ends in, so the gap past a line's last word selects nothing more. */
const TL = { down: false, prev: null, modern: undefined };
function tlReset(tl) { const end = tl.__eoc; if (!end) return; if (tl.lastChild !== end) tl.append(end); end.style.width = end.style.height = end.style.userSelect = ''; tl.classList.remove('selecting'); }
const tlResetAll = () => $$('.page .textLayer').forEach(tlReset);
document.addEventListener('pointerdown', () => { TL.down = true; }, true);
// after the text tools have read the selection (they do so as the button is let go)
document.addEventListener('pointerup', () => { TL.down = false; setTimeout(tlResetAll, 30); });
window.addEventListener('blur', () => { TL.down = false; tlResetAll(); });
document.addEventListener('keyup', () => { if (!TL.down) tlResetAll(); });
document.addEventListener('selectionchange', () => {
  const sel = document.getSelection(), layers = $$('.page .textLayer').filter((t) => t.__eoc);
  if (!sel || !sel.rangeCount) { layers.forEach(tlReset); TL.prev = null; return; }
  const range = sel.getRangeAt(0);
  for (const t of layers) { if (range.intersectsNode(t)) t.classList.add('selecting'); else tlReset(t); }
  if (TL.modern === undefined && layers.length) {
    const ff = getComputedStyle(layers[0]).getPropertyValue('-moz-user-select') === 'none';
    const v = navigator.userAgentData && navigator.userAgentData.brands ? (navigator.userAgentData.brands.find((b) => b.brand === 'Chromium') || {}).version : (/\bChrome\/(\d+)\b/.exec(navigator.userAgent) || [])[1];
    TL.modern = ff || (!!v && parseInt(v, 10) >= 148);
  }
  if (TL.modern || !layers.length) return;
  const prev = TL.prev, modifyStart = !!prev && (range.compareBoundaryPoints(Range.END_TO_END, prev) === 0 || range.compareBoundaryPoints(Range.START_TO_END, prev) === 0);
  let anchor = modifyStart ? range.startContainer : range.endContainer;
  if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
  if (anchor.classList && anchor.classList.contains('highlight')) anchor = anchor.parentNode;
  if (!modifyStart && range.endOffset === 0) {
    try { do { while (!anchor.previousSibling) anchor = anchor.parentNode; anchor = anchor.previousSibling; } while (!anchor.childNodes.length); } catch { anchor = null; }
  }
  const tl = anchor && anchor.parentElement && anchor.parentElement.closest('.textLayer'), end = tl && tl.__eoc;
  if (end && anchor !== end) {
    end.style.width = tl.style.width; end.style.height = tl.style.height; end.style.userSelect = 'text';
    anchor.parentElement.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
  }
  TL.prev = range.cloneRange();
});
// A selection's rectangles on screen, without the ones that repeat another (a browser can give a line twice: once
// for its text and once for the element around it), and without empty ones.
function selectionRects(sel) {
  const out = [];
  const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  for (let r = 0; r < sel.rangeCount; r++) {
    for (const rect of sel.getRangeAt(r).getClientRects()) {
      if (rect.width < 1 || rect.height < 1) continue;
      const area = rect.width * rect.height;
      const k = out.findIndex((o) => inter(o, rect) > .8 * Math.min(area, o.width * o.height));
      if (k < 0) out.push(rect); else if (area > out[k].width * out[k].height) out[k] = rect;
    }
  }
  return out;
}
const selectionText = (sel) => String(sel).replace(/\s+/g, ' ').trim().slice(0, 500);
// Highlight: select text with the Highlight tool (or select it, then press Highlight).
function highlightSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return false;
  const before = snapshot(), text = selectionText(sel);
  let any = false;
  {
    for (const rect of selectionRects(sel)) {
      const v = views.find((vv) => { const b = vv.el.getBoundingClientRect(); return rect.top >= b.top - 2 && rect.bottom <= b.bottom + 2 && rect.left >= b.left - 2 && rect.right <= b.right + 2; });
      if (!v) continue;
      const b = v.el.getBoundingClientRect();
      const [x1, y1] = toPdf(v, rect.left - b.left, rect.top - b.top), [x2, y2] = toPdf(v, rect.right - b.left, rect.bottom - b.top);
      let list = marksOf(v.entry), m = list.find((mm) => mm.pending);
      if (!m) { m = { id: uid(), type: 'hl', rects: [], color: toolColor('highlight'), text, pending: true }; list.push(m); }
      m.rects.push([x1, y1, x2, y2]); any = true;
    }
  }
  for (const v of views) for (const m of (doc.marks[pageKey(v.entry)] || [])) delete m.pending;
  sel.removeAllRanges();
  if (any) { views.forEach((v) => v.rendered && drawMarks(v)); changed(before); }
  return any;
}
document.addEventListener('pointerup', () => { if (app.dataset.tool === 'highlight') setTimeout(highlightSelection, 0); });
/* ---- text selected with the Select tool: a small bar over it (Highlight, Underline, Strikethrough, Redact, Copy),
   the same actions as in its right-click menu. It shows once the selection is made (the button or finger let go). */
FEATURE.selActions.push(
  { label: 'Highlight', icon: 'highlighter', order: 10, run: () => highlightSelection() },
  { label: 'Copy', icon: 'copy', key: 'Mod-c', order: 90, run: () => { document.execCommand('copy'); getSelection().removeAllRanges(); toast('Copied'); } },
);
const selActionList = () => [...FEATURE.selActions].sort((a, b) => a.order - b.order);
let selBar = null;
function pageSelection() {
  const sel = getSelection(); if (!sel || sel.isCollapsed || !String(sel).trim() || !doc) return null;
  const n = sel.anchorNode, el = n && (n.nodeType === 1 ? n : n.parentElement);
  return el && el.closest('.page .textLayer') ? sel : null;
}
function hideSelBar() { if (selBar) { selBar.remove(); selBar = null; } }
function showSelBar() {
  hideSelBar();
  const sel = app.dataset.tool === 'select' && !TL.down && !$('#dialog').open && $('#popover').hidden && pageSelection(); if (!sel) return; // not with a menu open
  const r = sel.getRangeAt(0).getBoundingClientRect(), w = $('#viewer').getBoundingClientRect();
  if (!r.width || r.bottom < w.top || r.top > w.bottom) return;
  const acts = selActionList(), bar = selBar = document.createElement('div');
  bar.className = 'sel-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Selected text');
  bar.innerHTML = acts.map((a, k) => `<button type="button" data-sa="${k}" title="${esc(a.label)}" aria-label="${esc(a.label)}">${ic(a.icon)}</button>`).join('');
  document.body.appendChild(bar); icons();
  bar.addEventListener('mousedown', (e) => e.preventDefault()); // the text stays selected
  bar.addEventListener('pointerdown', (e) => e.stopPropagation());
  bar.addEventListener('click', (e) => { const b = e.target.closest('[data-sa]'); if (!b) return; hideSelBar(); acts[+b.dataset.sa].run(); });
  // Above the selection (below it on touch screens, where the system's own menu sits above), inside the viewer.
  const bw = bar.offsetWidth, bh = bar.offsetHeight, below = coarse() || r.top - bh - 8 < w.top;
  bar.style.left = Math.max(w.left + 4, Math.min(r.left + r.width / 2 - bw / 2, w.right - bw - 4)) + 'px';
  bar.style.top = Math.max(w.top + 4, Math.min(below ? r.bottom + 8 : r.top - bh - 8, w.bottom - bh - 4)) + 'px';
}
let selBarT = 0;
const selBarSoon = (ms) => { clearTimeout(selBarT); selBarT = setTimeout(showSelBar, ms); };
document.addEventListener('pointerup', (e) => { if (e.button !== 2 && (!e.target.closest || !e.target.closest('.sel-bar'))) selBarSoon(60); });
// A finger's selection handles move with no pointer events: the bar follows the selection once it rests.
document.addEventListener('selectionchange', () => { if (!pageSelection()) { clearTimeout(selBarT); hideSelBar(); } else if (!TL.down) selBarSoon(350); });
document.addEventListener('pointerdown', (e) => { if (selBar && !selBar.contains(e.target)) hideSelBar(); }, true);
$('#viewer').addEventListener('scroll', hideSelBar, { passive: true });
document.addEventListener('keydown', (e) => { if (selBar && e.key === 'Escape') hideSelBar(); }, true);
TEST_HOOKS.selBar = () => selBar && $$('button', selBar).map((b) => b.getAttribute('aria-label'));
TEST_HOOKS.selId = () => selMark && selMark.id;
// Touch: a finger dragged over text with a text tool (Highlight, Underline…) selects that text, as a mouse would (the
// page does not scroll then: see touch-action in template.html). Letting go marks it up.
const TEXT_TOOLS = new Set(['highlight', 'cmunderline', 'cmstrike', 'cmsquiggly', 'protredtext']);
function caretAt(x, y) {
  let n = null, o = 0;
  if (document.caretPositionFromPoint) { const c = document.caretPositionFromPoint(x, y); if (c) [n, o] = [c.offsetNode, c.offset]; }
  else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); if (r) [n, o] = [r.startContainer, r.startOffset]; }
  const el = n && (n.nodeType === 1 ? n : n.parentElement);
  return el && el.closest('.textLayer') ? [n, o] : null;
}
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch' || !TEXT_TOOLS.has(app.dataset.tool) || !e.target.closest || !e.target.closest('.page .textLayer')) return;
  const a = caretAt(e.clientX, e.clientY); if (!a) return;
  e.preventDefault();
  const move = (ev) => { if (ev.pointerId !== e.pointerId) return; const b = caretAt(ev.clientX, ev.clientY); if (b) getSelection().setBaseAndExtent(a[0], a[1], b[0], b[1]); };
  const up = (ev) => { if (ev.pointerId !== e.pointerId) return; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}, true);
// Keyboard: with a placing tool chosen (Note, Add text, Stamp, Typewriter, Callout, Signature, Picture), Enter puts
// the item in the middle of the part of the page in view, as a click there would; it is then selected, so the arrow
// keys move it and Delete removes it.
const PLACE_TOOLS = new Set(['text', 'note', 'sign', 'image', 'cmstamp', 'cmtype', 'cmcallout']);
// Tools that are dragged out (shapes, area highlight, redaction area, form fields): Enter drags one of the usual size
// (160 by 100 pt; a line 160 pt long; a field its own size) in the middle of the page in view, then selects it, so the
// arrow keys move it and Alt+Shift+arrows resize it.
const DRAG_TOOLS = new Set(['rect', 'cmoval', 'cmcloud', 'cmline', 'cmarrow', 'cmarea', 'protredarea']);
const dragTool = (t) => DRAG_TOOLS.has(t) || (/^ff_/.test(t) && t !== 'ff_edit' && !!FEATURE.tools[t]);
const keyPlaces = (t) => PLACE_TOOLS.has(t) || dragTool(t);
let kbPlace = null; // { v, ids, x, y } while a placement made with Enter is under way
function placeByKey() {
  const v = views[current], svg = v && v.rendered && v.el.querySelector('svg.marks'); if (!svg) return false;
  const r = v.el.getBoundingClientRect(), w = $('#viewer').getBoundingClientRect();
  const left = Math.max(r.left, w.left), right = Math.min(r.right, w.right), top = Math.max(r.top, w.top), bottom = Math.min(r.bottom, w.bottom);
  if (right <= left || bottom <= top) return false;
  const x = (left + right) / 2, y = (top + bottom) / 2;
  const k = kbPlace = { v, ids: new Set(marksOf(v.entry).map((m) => m.id)), x, y };
  // a form field is clicked (it then takes its own size); the other drag tools are dragged corner to corner
  const t = app.dataset.tool, drag = dragTool(t) && !/^ff_/.test(t), hw = drag ? 80 * scale : 0, hh = drag && t !== 'cmline' && t !== 'cmarrow' ? 50 * scale : 0;
  const o = { clientX: x - hw, clientY: y - hh, bubbles: true, cancelable: true, pointerId: 77, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 };
  svg.dispatchEvent(new PointerEvent('pointerdown', o));
  if (drag) for (const f of [.5, 1]) window.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: x - hw + 2 * hw * f, clientY: y - hh + 2 * hh * f }));
  window.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: x + hw, clientY: y + hh, buttons: 0 }));
  setTimeout(() => { if (kbPlace === k && !$('#dialog').open && !pageAskOpen) kbPlace = null; }, 0); // nothing asked, nothing placed
  return true;
}
$('#dialog').addEventListener('close', () => { const k = kbPlace; if (k) setTimeout(() => { if (kbPlace === k) kbPlace = null; }, 1500); });
// Called by changed(): the new mark is centred on the point and selected.
function kbPlaced() {
  const { v, ids, x, y } = kbPlace; kbPlace = null;
  const m = marksOf(v.entry).find((mm) => !ids.has(mm.id)); if (!m) return;
  const g = v.el.querySelector(`svg.marks [data-id="${m.id}"]`);
  if (g) {
    const b = g.getBoundingClientRect(), [x0, y0] = toPdf(v, 0, 0), [x1, y1] = toPdf(v, x - (b.left + b.width / 2), y - (b.top + b.height / 2));
    offsetMark(m, JSON.parse(JSON.stringify(m)), x1 - x0, y1 - y0); drawMarks(v);
  }
  setTimeout(() => { setTool('select'); selectMark({ key: pageKey(v.entry), id: m.id, entry: v.entry }); $('#viewer').focus({ preventScroll: true }); }, 0);
}
function setTool(t) {
  closeLineEditor(true);
  const was = app.dataset.tool;
  app.dataset.tool = t;
  if (t in COLOR_TOOLS) S.colorTool = t;
  if (t !== 'select') selectMark(null);
  if (t !== 'edit' && selContent) selectContent(null);
  // Edit PDF reads each drawn page's text ahead, so the first click opens its editor at once.
  if (t === 'edit' && was !== 'edit') setTimeout(() => views.forEach((v) => { if (v.rendered) contentMap(v.page).then((cm) => { v.page._cmapValue = cm; }).catch(() => {}); }), 0);
  if (t !== was) toolHint = TOOL_HINTS[t] || '';
  toolJustSet = t; queueMicrotask(() => { toolJustSet = null; });
  modeChip();
  // A phone's mode chip names the tool only: how to use it shows once, as a toast (unless the tool gave one).
  if (t !== was && t !== 'select' && isPhone()) setTimeout(() => { const m = $('#toast'); if (app.dataset.tool === t && toolHint && !(m.classList.contains('show') && m.textContent === touchWords(toolHint))) toast(toolHint); }, 0);
  refreshRibbon();
}
/* ---- the mode chip: while a tool other than Select is on, the status bar says which, and how to use it ---- */
// How to use a tool, for tools that don't say when chosen (features can add theirs).
const TOOL_HINTS = {
  highlight: 'Select text to highlight it', pen: 'Drag to draw', rect: 'Drag on the page', text: 'Click where the text goes', note: 'Click where the note goes',
  edit: 'Click text to change it, or a picture or comment to move it', erase: 'Drag over anything to erase it',
};
function toolName(t) {
  const ids = ['tool_' + t, t, 'cm_' + t.replace(/^cm/, ''), { cmtype: 'cm_typewriter', protredtext: 'protRedText', protredarea: 'protRedArea', crop: 'tool_crop' }[t]].filter((id) => id && C[id]);
  const id = ids.find((x) => C[x].pressed && C[x].pressed()) || ids[0];
  return id ? C[id].label.replace(/…$/, '') : '';
}
function modeChip() {
  const chip = $('#modeChip'); if (!chip) return;
  const t = app.dataset.tool, on = !!doc && t && t !== 'select';
  chip.hidden = !on; app.classList.toggle('tool-on', on);
  if (!on) return;
  const name = toolName(t);
  let hint = toolHint ? touchWords(toolHint).replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase()).replace(/\.$/, '') : '';
  if (dragTool(t) && !coarse()) hint = (hint || 'drag on the page') + ', or press Enter to add one';
  const rest = [name && hint ? `: ${hint}` : name ? '' : hint, coarse() ? '' : ' · Esc to stop'].join('');
  chip.title = (name || '') + rest;
  // The name and the rest apart, so a phone can show the name alone (the rest is still read out).
  $('.mode-text', chip).innerHTML = `<span class="mode-name">${esc(name || '')}</span><span class="mode-hint">${esc(name ? rest : rest.replace(/^ · /, ''))}</span>`;
}
$('#modeChip .mode-stop').addEventListener('click', () => { setTool('select'); pendingImage = null; });

/* ---------------- editing what is already in the PDF ----------------
   The Edit tool changes the PDF's own content; Erase area clears anything in a rectangle. Each change is a mark like
   any other, so undo, Documents and Save treat it the same way:
     te     a line of text rewritten, in the line's own font, size and colour
     ie     a picture moved, resized or deleted
     erase  an area cleared
     ae     a comment from another app deleted, or its text changed
   On screen the original is covered with the colour that was behind it. On saving, the original text and pictures
   are taken out of the page's content (so search and copy find only the new text); anything that can't be found
   there, and erased areas, are clipped out instead. New text uses the PDF's own font object, so it looks the same;
   letters the embedded font doesn't have use the closest standard font. */
const CONTENT_TYPES = new Set(['te', 'ie', 'erase', 'ae']);
const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
// A line's corners, from its text matrix: local x runs along the baseline, local y up from it.
function lineFrame(m) {
  const [a, b, c, d, e, f] = m.tm, size = Math.hypot(c, d) || Math.hypot(a, b) || 1, hs = Math.hypot(a, b) || size;
  return { u: [a / hs, b / hs], v: [c / size, d / size], o: [e, f], size };
}
function lineQuad(m, pad = 0) {
  const { u, v, o, size } = lineFrame(m);
  const P = (x, y) => [o[0] + u[0] * x + v[0] * y, o[1] + u[1] * x + v[1] * y];
  const y0 = m.descent * size - pad, y1 = m.ascent * size + pad, x0 = -pad, x1 = m.width + pad;
  return [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
}
function inQuad(q, x, y) {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4];
    const c = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
    if (c !== 0) { if (s && Math.sign(c) !== s) return false; s = Math.sign(c); }
  }
  return true;
}
const quadBox = (q) => { const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
// Where an edited line is drawn: its own place, moved along its baseline by dx when the text before it changed width.
const teAt = (m) => { if (!m.dx) return m.tm; const { u } = lineFrame(m); return [m.tm[0], m.tm[1], m.tm[2], m.tm[3], m.tm[4] + u[0] * m.dx, m.tm[5] + u[1] * m.dx]; };
const sameOrigin = (a, b) => Math.abs(a[4] - b[4]) < .5 && Math.abs(a[5] - b[5]) < .5;
const stdFamily = (name) => /times|georgia|garamond|cambria|caladea|serif|antiqua|palatino|minion|baskerville|bookman|century/i.test(name) && !/sans/i.test(name) ? 'serif' : /courier|mono|consolas|menlo/i.test(name) ? 'mono' : 'sans';
const cssFamily = (fam) => ({ serif: '"Times New Roman", Times, serif', mono: '"Courier New", Courier, monospace', sans: 'Helvetica, Arial, sans-serif' }[fam]);

// What a page holds, for editing: its lines of text, pictures and comments, and how each font draws each letter.
function contentMap(page) {
  return page._cmap || (page._cmap = (async () => {
    const [tc, ops, annots] = await Promise.all([
      page.getTextContent(),
      page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE }),
      page.getAnnotations({ intent: 'display' }).catch(() => []),
    ]);
    // The page's drawing, step by step: the graphics and text state at each piece of text (its colours, render mode,
    // spacing), and each picture with the clip around it (a picture clipped to nothing is not one you can click).
    const O = pdfjs.OPS, glyphs = new Map(), images = [], stack = [], invisible = new Set(), shows = [];
    const I = [1, 0, 0, 1, 0, 0];
    let g = { ctm: I, font: null, fs: 1, tr: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, lw: 1, fill: '#000000', stroke: '#000000', clip: null };
    let tm = I, tlm = I, raw = -1, pendingClip = false;
    const clipTo = (b) => { const c = g.clip; g.clip = c ? [Math.max(c[0], b[0]), Math.max(c[1], b[1]), Math.min(c[2], b[2]), Math.min(c[3], b[3])] : b; };
    const boxQuad = (b, m) => [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map(([x, y]) => apply(m, x, y));
    const moveTo = (x, y) => { tlm = mul([1, 0, 0, 1, x, y], tlm); tm = tlm; };
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], a = ops.argsArray[i];
      if (fn === O.save) stack.push({ ...g });
      else if (fn === O.restore) g = stack.pop() || g;
      else if (fn === O.transform) g.ctm = mul(a, g.ctm);
      else if (fn === O.paintFormXObjectBegin) { stack.push({ ...g }); if (a && a[0]) g.ctm = mul(a[0], g.ctm); if (a && a[1] && a[1].length === 4) clipTo(quadBox(boxQuad(a[1], g.ctm))); }
      else if (fn === O.paintFormXObjectEnd) g = stack.pop() || g;
      else if (fn === O.clip || fn === O.eoClip) pendingClip = true;
      else if (fn === O.constructPath) { const mm = a && a[2]; if (pendingClip && mm && mm.length === 4 && mm.every(Number.isFinite) && mm[2] >= mm[0]) clipTo(quadBox(boxQuad(mm, g.ctm))); pendingClip = false; }
      else if (fn === O.setFont) { g.font = a[0]; g.fs = a[1]; }
      else if (fn === O.setTextRenderingMode) g.tr = a[0];
      else if (fn === O.setCharSpacing) g.tc = a[0];
      else if (fn === O.setWordSpacing) g.tw = a[0];
      else if (fn === O.setHScale) g.th = a[0] / 100;
      else if (fn === O.setLeading) g.tl = a[0];
      else if (fn === O.setTextRise) g.rise = a[0];
      else if (fn === O.setLineWidth) g.lw = a[0];
      else if (fn === O.setGState) { for (const [k, val] of a[0] || []) if (k === 'LW') g.lw = val; }
      else if (fn === O.setFillRGBColor) g.fill = a[0];
      else if (fn === O.setStrokeRGBColor) g.stroke = a[0];
      else if (fn === O.beginText) tm = tlm = I;
      else if (fn === O.setTextMatrix) tm = tlm = Array.from(a[0]);
      else if (fn === O.moveText) moveTo(a[0], a[1]);
      else if (fn === O.setLeadingMoveText) { g.tl = -a[1]; moveTo(a[0], a[1]); }
      else if (fn === O.nextLine) moveTo(0, -g.tl);
      else if (fn === O.showText && g.font) {
        const font = g.font;
        // Text drawn invisibly (the words a scanner's OCR lays over a scanned page)
        if (g.tr === 3 || g.tr === 7) invisible.add(font);
        let gm = glyphs.get(font); if (!gm) glyphs.set(font, gm = new Map());
        let adv = 0;
        for (const gl of a[0] || []) {
          if (typeof gl === 'number') { adv -= gl / 1000 * g.fs; continue; }
          if (!gl) continue;
          if (gl.unicode && gl.fontChar != null && !gm.has(gl.unicode)) gm.set(gl.unicode, { fc: gl.fontChar, w: gl.width, code: gl.originalCharCode, inFont: gl.isInFont !== false });
          adv += (gl.width || 0) / 1000 * g.fs + g.tc + (gl.isSpace ? g.tw : 0);
        }
        const trm = mul(tm, g.ctm), det = Math.sqrt(Math.abs(g.ctm[0] * g.ctm[3] - g.ctm[1] * g.ctm[2]));
        shows.push({ o: apply(trm, 0, g.rise), font, fs: Math.abs(g.fs) || 1, tr: g.tr, tc: g.tc, tw: g.tw, lw: g.lw * det, fill: g.fill, stroke: g.stroke });
        tm = mul([1, 0, 0, 1, adv * g.th, 0], tm);
      } else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject) {
        raw++; // the picture's identity: its place among the page's picture draws, the same count saving uses
        const quad = boxQuad([0, 0, 1, 1], g.ctm), b = quadBox(quad);
        const c = g.clip ? [Math.max(b[0], g.clip[0]), Math.max(b[1], g.clip[1]), Math.min(b[2], g.clip[2]), Math.min(b[3], g.clip[3])] : b;
        if (b[2] - b[0] > 2 && b[3] - b[1] > 2 && c[2] - c[0] > 2 && c[3] - c[1] > 2) images.push({ n: images.length, raw, objId: fn === O.paintImageXObject ? a[0] : null, inline: fn === O.paintInlineImageXObject ? a[0] : null, quad, mat: g.ctm.slice() });
      }
    }
    // Lines: neighbouring pieces of text on one baseline, in one font and size, joined.
    const lines = [];
    for (const it of tc.items) {
      if (!it.str || !it.transform) continue;
      const tm = it.transform.slice(), st = tc.styles[it.fontName] || {};
      const L = lines[lines.length - 1];
      if (L && L.fontName === it.fontName) {
        const f = lineFrame(L), sz = lineFrame({ tm }).size;
        const dx = tm[4] - f.o[0], dy = tm[5] - f.o[1];
        const along = dx * f.u[0] + dy * f.u[1], perp = dx * f.v[0] + dy * f.v[1], gap = along - L.width;
        if (Math.abs(sz - f.size) < .05 && Math.abs(perp) < f.size * .2 && gap > -f.size * .5 && gap < f.size * 1.2) {
          if (gap > f.size * .15 && !/\s$/.test(L.str) && !/^\s/.test(it.str)) L.str += ' ';
          L.str += it.str; L.width = Math.max(L.width, along + it.width); continue;
        }
      }
      lines.push({ str: it.str, fontName: it.fontName, tm, width: it.width, ascent: st.ascent ?? .8, descent: st.descent ?? -.2, family: st.fontFamily || 'sans-serif' });
    }
    for (const L of lines) { L.str = L.str.replace(/\s+$/, ''); L.quad = lineQuad(L, .3); L.st = lineState(L, shows); }
    const A = pdfjs.AnnotationType;
    const comments = annots.filter((a) => a.rect && a.id && ![A.WIDGET, A.LINK, A.POPUP].includes(a.annotationType));
    return { lines: lines.filter((L) => L.str && L.width > 0), images, comments, glyphs, invisible };
  })());
}
// The text state a line was drawn with: the piece of text that starts it (or, when pdf.js split a piece, the one
// before it on its baseline). Spacing is kept relative to the font size (the new text is set at size 1, scaled by the
// line's matrix), line width in page units.
function lineState(L, shows) {
  const f = lineFrame(L); let best = null, bestA = -Infinity;
  for (const r of shows) {
    if (r.font !== L.fontName) continue;
    const dx = r.o[0] - f.o[0], dy = r.o[1] - f.o[1], along = dx * f.u[0] + dy * f.u[1], perp = dx * f.v[0] + dy * f.v[1];
    if (Math.abs(perp) > Math.max(.5, f.size * .2) || along > .5) continue;
    if (along > bestA) { best = r; bestA = along; }
    if (Math.abs(along) < .5) break;
  }
  if (!best) return null;
  return { tr: best.tr, tc: best.tc / best.fs, tw: best.tw / best.fs, lw: best.lw, fill: best.fill, stroke: best.stroke };
}
// What an edited line carries over from the original (only what differs from plain filled text).
function teState(L, ocr) {
  const st = L.st, out = {}; if (!st || ocr) return out;
  const tr = st.tr % 4; // the clipping modes (4 to 7) draw as 0 to 3
  if (tr === 1 || tr === 2) { out.tr = tr; out.lw = +(+st.lw).toFixed(3); if (/^#[0-9a-f]{6}$/i.test(st.stroke)) out.stroke = st.stroke; }
  if (Math.abs(st.tc) > 1e-4) out.tc = +st.tc.toFixed(4);
  if (Math.abs(st.tw) > 1e-4) out.tw = +st.tw.toFixed(4);
  return out;
}
// The line's own colour, as the PDF sets it (the fill, or the stroke for outlined text); else as sampled on screen.
const lineColor = (L, sampled) => { const st = L.st, c = st && (st.tr % 4 === 1 ? st.stroke : st.fill); return /^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : sampled; };
const fontObj = (page, name) => new Promise((res) => { try { page.commonObjs.get(name, res); } catch { res(null); } setTimeout(() => res(null), 3000); });

// The colours behind and of a piece of the page, read from what was drawn.
function sampleColors(v, quad) {
  const c = v.el.querySelector('canvas.pdf'); if (!c) return { bg: '#ffffff', fg: '#111111' };
  const k = c.width / v.viewport.width, pts = quad.map(([x, y]) => toView(v, x, y));
  const xs = pts.map((p) => p[0] * k), ys = pts.map((p) => p[1] * k);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 3), y0 = Math.max(0, Math.floor(Math.min(...ys)) - 3);
  const x1 = Math.min(c.width, Math.ceil(Math.max(...xs)) + 3), y1 = Math.min(c.height, Math.ceil(Math.max(...ys)) + 3);
  const w = x1 - x0, h = y1 - y0; if (w < 3 || h < 3) return { bg: '#ffffff', fg: '#111111' };
  let d; try { d = c.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, w, h).data; } catch { return { bg: '#ffffff', fg: '#111111' }; }
  const px = (x, y) => { const i = (y * w + x) * 4; return d[i + 3] < 8 ? [255, 255, 255] : [d[i], d[i + 1], d[i + 2]]; };
  const buckets = new Map();
  for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) { const p = px(x, y), key = (p[0] >> 4) << 8 | (p[1] >> 4) << 4 | (p[2] >> 4); const b = buckets.get(key) || buckets.set(key, { n: 0, s: [0, 0, 0] }).get(key); b.n++; b.s[0] += p[0]; b.s[1] += p[1]; b.s[2] += p[2]; }
  for (let y = 0; y < h; y++) for (const x of [0, 1, w - 2, w - 1]) { const p = px(x, y), key = (p[0] >> 4) << 8 | (p[1] >> 4) << 4 | (p[2] >> 4); const b = buckets.get(key) || buckets.set(key, { n: 0, s: [0, 0, 0] }).get(key); b.n++; b.s[0] += p[0]; b.s[1] += p[1]; b.s[2] += p[2]; }
  const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  const bg = top.s.map((s) => Math.round(s / top.n));
  const dist = (p) => Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]);
  let best = 0; for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) best = Math.max(best, dist(px(x, y)));
  let fg = [17, 17, 17];
  if (best > 30) {
    const s = [0, 0, 0]; let n = 0;
    for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) { const p = px(x, y); if (dist(p) >= best * .9) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; n++; } }
    fg = s.map((t) => Math.round(t / n));
  }
  const hex = (p) => '#' + p.map((t) => t.toString(16).padStart(2, '0')).join('');
  return { bg: hex(bg), fg: hex(fg) };
}

// What's under a point, for the Edit tool: a line, a picture or a comment (in that order).
async function contentAt(v, x, y) {
  const cm = await contentMap(v.page);
  const own = marksOf(v.entry);
  // A comment drawn as an icon or a box of text wins; a shape drawn around something wins only near its edge.
  const hiddenC = new Set(own.filter((m) => m.type === 'ae' && m.deleted).map((m) => m.ref));
  const A = pdfjs.AnnotationType;
  for (const a of cm.comments) {
    if (hiddenC.has(a.id)) continue;
    const [x0, y0, x1, y1] = a.rect; if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const icon = [A.TEXT, A.FREETEXT, A.STAMP, A.FILEATTACHMENT, A.SOUND].includes(a.annotationType);
    const edge = Math.min(x - x0, x1 - x, y - y0, y1 - y) < 5;
    if (icon || edge) return { kind: 'annot', a, mark: own.find((m) => m.type === 'ae' && m.ref === a.id) };
  }
  const L = cm.lines.find((l) => inQuad(l.quad, x, y));
  if (L) return { kind: 'text', L, mark: own.find((m) => m.type === 'te' && sameOrigin(m.tm, L.tm)) };
  for (let k = cm.images.length - 1; k >= 0; k--) {
    const im = cm.images[k], mark = own.find((m) => m.type === 'ie' && (m.raw != null ? m.raw === im.raw : m.n === im.n));
    if (mark && mark.deleted) continue;
    if (inQuad(mark ? matQuad(mark.mat) : im.quad, x, y)) return { kind: 'image', im, mark };
  }
  const hidden = new Set(own.filter((m) => m.type === 'ae' && m.deleted).map((m) => m.ref));
  for (const a of cm.comments) { const [x0, y0, x1, y1] = a.rect; if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && !hidden.has(a.id)) return { kind: 'annot', a, mark: own.find((m) => m.type === 'ae' && m.ref === a.id) }; }
  return null;
}

// Drawing a rewritten line on screen, with the font pdf.js loaded for it (the same letters the page itself uses).
const teCache = new Map();
function teImage(v, m) {
  const cm = v.page._cmapValue, ratio = Math.min(window.devicePixelRatio || 1, 2);
  const L = cm && cm.lines.find((l) => sameOrigin(l.tm, m.tm));
  const loaded = L ? L.fontName : null, map = !m.ocr && !m.type3 && loaded && cm.glyphs.get(loaded);
  const key = [m.id, m.text, m.color, scale, ratio, loaded, m.tr, m.lw, m.stroke, m.tc, m.tw].join('|');
  if (teCache.has(key)) return teCache.get(key);
  const { size, u } = lineFrame(m), hsc = Math.hypot(m.tm[0], m.tm[1]) / (Math.hypot(m.tm[2], m.tm[3]) || 1);
  const px = size * scale * ratio, fb = `${m.bold ? 'bold ' : ''}${m.italic ? 'italic ' : ''}${px}px ${cssFamily(m.fam)}`, own = `${px}px "${loaded}", ${cssFamily(m.fam)}`;
  // The line's own spacing (Tc, Tw, relative to its size) and outline (render modes 1 and 2), as the saved line has them.
  const tc = (m.tc || 0) * px, tw = (m.tw || 0) * px, stroke = m.tr === 1 || m.tr === 2;
  const setSpacing = () => { g.letterSpacing = tc + 'px'; g.wordSpacing = tw + 'px'; };
  // Runs of letters drawn with the PDF's font, and runs the font doesn't have (drawn in the closest standard font).
  // A letter pdf.js maps to a control code (a space, usually) is not drawn, only advanced by its width.
  const runs = [];
  for (const ch of m.text) {
    const g0 = map && map.get(ch), gl = g0 && g0.inFont ? g0 : null, blank = !!gl && /^[\x00-\x1f\x7f-\x9f]$/.test(gl.fc);
    const kind = blank ? 'gap' : gl ? 'own' : 'fb', last = runs[runs.length - 1];
    if (kind === 'gap') runs.push({ kind, s: '', adv: ((gl.w || 250) / 1000 * px + tc + (ch === ' ' ? tw : 0)) * hsc });
    else if (last && last.kind === kind) last.s += kind === 'own' ? gl.fc : ch;
    else runs.push({ kind, s: kind === 'own' ? gl.fc : ch });
  }
  const c = document.createElement('canvas'), g = c.getContext('2d');
  let w = 0; setSpacing(); for (const r of runs) { if (r.kind === 'gap') { r.w = r.adv; w += r.w; continue; } g.font = r.kind === 'own' ? own : fb; r.w = g.measureText(r.s).width * hsc; w += r.w; }
  const asc = Math.max(m.ascent, .9) * px, desc = Math.max(-m.descent, .3) * px, lw = stroke ? (m.lw || 0) * scale * ratio : 0;
  c.width = Math.ceil(w + 4 + lw); c.height = Math.ceil(asc + desc + 2 + lw);
  setSpacing(); g.fillStyle = m.color; g.strokeStyle = m.stroke || m.color; g.lineWidth = lw; g.lineJoin = 'round'; let x = lw / 2;
  for (const r of runs) { if (r.s) { g.save(); g.font = r.kind === 'own' ? own : fb; g.translate(x, asc + lw / 2); g.scale(hsc, 1); if (m.tr !== 1) g.fillText(r.s, 0, 0); if (stroke && lw > 0) g.strokeText(r.s, 0, 0); g.restore(); } x += r.w; }
  // adv: the new text's width in page units (how far the text after it moves)
  const out = { url: c.toDataURL('image/png'), w: c.width / ratio, h: c.height / ratio, asc: (asc + lw / 2) / ratio, ox: lw / 2 / ratio, adv: w / ratio / scale };
  void u; if (teCache.size > 200) teCache.clear(); teCache.set(key, out);
  return out;
}
// Marks that clear part of the page are drawn first, under everything else.
function drawContentMark(v, m, svg) {
  const poly = (q, fill) => svgEl('polygon', { points: q.map(([x, y]) => toView(v, x, y).map((n) => n.toFixed(1)).join(',')).join(' '), fill });
  if (m.type === 'erase') { const g = poly(m.quad, m.bg); g.setAttribute('class', 'mk'); if (m.drafting) { g.setAttribute('fill', 'none'); g.setAttribute('stroke', 'var(--accent)'); g.setAttribute('stroke-dasharray', '4 3'); } return g; }
  if (m.type === 'te') {
    const g = svgEl('g', { class: 'mk' });
    // What the line covers goes under every edited line's new text (the text before it may now run over it).
    const cover = poly(m.quad, m.bg);
    if (svg) { let under = svg.querySelector(':scope > g.te-under'); if (!under) under = svg.insertBefore(svgEl('g', { class: 'te-under' }), svg.firstChild); under.appendChild(cover); }
    else g.appendChild(cover);
    if (!editingIds.has(m.id)) {
      const t = teAt(m), im = teImage(v, m), [ox, oy] = toView(v, t[4], t[5]), { u } = lineFrame(m);
      const [ax, ay] = toView(v, t[4] + u[0], t[5] + u[1]), ang = Math.atan2(ay - oy, ax - ox) * 180 / Math.PI;
      g.appendChild(svgEl('image', { x: ox - (im.ox || 0), y: oy - im.asc, width: im.w, height: im.h, href: im.url, transform: `rotate(${ang.toFixed(2)} ${ox} ${oy})` }));
    }
    return g;
  }
  if (m.type === 'ie') {
    const g = svgEl('g', { class: 'mk' });
    if (!(v.imgHidden && v.imgHidden.has(m.id))) g.appendChild(poly(m.quad, m.bg));
    if (!m.deleted && m.data) {
      // The picture's top-left, top-right and bottom-left corners on screen give the SVG matrix.
      const o = toView(v, ...apply(m.mat, 0, 1)), x = toView(v, ...apply(m.mat, 1, 1)), y = toView(v, ...apply(m.mat, 0, 0));
      g.appendChild(svgEl('image', { x: 0, y: 0, width: 1, height: 1, href: m.data, preserveAspectRatio: 'none', transform: `matrix(${x[0] - o[0]} ${x[1] - o[1]} ${y[0] - o[0]} ${y[1] - o[1]} ${o[0]} ${o[1]})` }));
    }
    return g;
  }
  return null;
}
const editingIds = new Set();

// Comments deleted with the Edit tool disappear from the page: pdf.js skips annotations it is told were changed.
const hiddenNow = new Map();
function syncHiddenComments() {
  if (!doc) return;
  for (const [k, pd] of pdfDocs) {
    const ids = [];
    for (const [key, list] of Object.entries(doc.marks)) if (key.startsWith(k + ':')) for (const m of list) if (m.type === 'ae' && m.deleted) ids.push(m.ref);
    if (FEATURE.hiddenAnnots) ids.push(...FEATURE.hiddenAnnots(k)); // all of them while comments are hidden
    const sig = ids.sort().join(',');
    if (hiddenNow.get(pd) === sig) continue;
    const first = !hiddenNow.has(pd); hiddenNow.set(pd, sig);
    try { Object.defineProperty(pd.annotationStorage, 'modifiedIds', { configurable: true, get: () => ({ ids: new Set(ids), hash: sig ? 'cpdf-' + sig : '' }) }); } catch {}
    if (!first || sig) for (const v of views) if (v.entry.src === k && v.rendered) rerenderView(v);
  }
}
function rerenderView(v) { v.rendered = false; v.token = (v.token || 0) + 1; v.el.innerHTML = ''; renderView(v); }

// The Edit tool.
let selContent = null; // { v, kind: 'image' | 'annot', im?, a?, mark? }
// The first click on a page can take a moment while its text is read. Meanwhile the cursor shows it is busy, and
// keys typed are kept and given to the editor once it opens (nothing typed goes to the ribbon or is lost).
let editKeys = null;
async function editDownBusy(e, v) {
  if (editKeys) editReady();
  const keys = editKeys = [];
  const kh = (ev) => {
    if (editKeys !== keys || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) return;
    if (typingIn(ev.target) || (ev.target.closest && ev.target.closest('dialog'))) return;
    if (ev.key.length === 1 || /^(Backspace|Delete|Enter|Escape|Home|End|ArrowLeft|ArrowRight)$/.test(ev.key)) { keys.push(ev.key); ev.preventDefault(); ev.stopPropagation(); }
  };
  keys.off = () => window.removeEventListener('keydown', kh, true);
  window.addEventListener('keydown', kh, true);
  app.dataset.busy = '';
  editAt = { x: e.clientX, y: e.clientY, detail: e.detail || 1 };
  try { await onEditDown(e, v); } finally { editAt = null; if (editKeys === keys) editReady(); }
}
// The editor is open (or nothing will open): hand it the keys typed while waiting.
function editReady() {
  const keys = editKeys; if (!keys) return;
  editKeys = null; keys.off(); delete app.dataset.busy;
  const el = document.activeElement;
  if (!keys.length || !el || !el.matches('.line-editor, .txt-editor')) return;
  const field = el.tagName === 'TEXTAREA', sel = getSelection();
  for (const k of keys) {
    if (!el.isConnected || document.activeElement !== el) break;
    if (k.length === 1) document.execCommand('insertText', false, k);
    else if (k === 'Backspace') document.execCommand('delete');
    else if (k === 'Delete') document.execCommand('forwardDelete');
    else if (k === 'Enter' || k === 'Escape') el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    else if (field) {
      const n = el.value.length, a = el.selectionStart, b = el.selectionEnd;
      const to = k === 'End' ? n : k === 'Home' ? 0 : k === 'ArrowRight' ? (a !== b ? b : Math.min(n, b + 1)) : (a !== b ? a : Math.max(0, a - 1));
      el.setSelectionRange(to, to);
    } else if (k === 'End' || k === 'Home') { sel.selectAllChildren(el); k === 'End' ? sel.collapseToEnd() : sel.collapseToStart(); }
    else if (!sel.isCollapsed) k === 'ArrowRight' ? sel.collapseToEnd() : sel.collapseToStart();
    else sel.modify('move', k === 'ArrowRight' ? 'forward' : 'backward', 'character');
  }
}
async function onEditDown(e, v) {
  e.preventDefault();
  closeLineEditor(true);
  const [x, y] = toPdf(v, ...localPoint(e, v));
  // An edit made earlier: change it again.
  const own = e.target.closest && e.target.closest('.mk');
  const om = own && marksOf(v.entry).find((m) => m.id === own.dataset.id);
  if (om && om.type === 'te') { selectContent(null); return openLineEditor(await phoneZoomTo(v, om), om, false); }
  if (om && om.type === 'ie' && !om.deleted) { const cm = await contentMap(v.page); selectContent({ v, kind: 'image', im: imageOf(cm, om) || { n: om.n, quad: om.quad, mat: quadMat(om.quad) }, mark: om }); return startImageDrag(e, v, selContent, 'move'); }
  if (om && !CONTENT_TYPES.has(om.type)) { selectContent(null); selectMark({ key: pageKey(v.entry), id: om.id, entry: v.entry }); return startMove(e, v, om); }
  // A picture already selected: its corner handle resizes it, anywhere on it moves it.
  if (selContent && selContent.v === v && selContent.kind === 'image') {
    const r = imageRect(selContent);
    const [hx, hy] = toView(v, r[2], r[1]), [lx, ly] = localPoint(e, v);
    if (Math.hypot(hx - lx, hy - ly) < 14) return startImageDrag(e, v, selContent, 'resize');
    if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) return startImageDrag(e, v, selContent, 'move');
  }
  const hit = await contentAt(v, x, y);
  if (!hit) { selectContent(null); return; }
  if (hit.kind === 'text') { selectContent(null); return editLine(v, hit.L, hit.mark); }
  selectContent({ v, ...hit });
  if (hit.kind === 'image') return startImageDrag(e, v, selContent, 'move');
  if (hit.kind === 'annot' && e.detail === 2) { editReady(); return editComment(v, hit.a, hit.mark); }
}
function selectContent(s) {
  selContent = s;
  if (s) selectMark(null);
  views.forEach((vv) => vv.rendered && drawMarks(vv));
  refreshRibbon();
}
// A picture is placed by a matrix that maps its unit square onto the page (it may be rotated or flipped).
const matQuad = (mat) => [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => apply(mat, x, y));
function imageMat(s) { return s.preview || (s.mark ? s.mark.mat : s.im.mat || quadMat(s.im.quad)); }
const quadMat = (q) => [q[1][0] - q[0][0], q[1][1] - q[0][1], q[3][0] - q[0][0], q[3][1] - q[0][1], q[0][0], q[0][1]];
function imageRect(s) { return quadBox(matQuad(imageMat(s))); }
function drawSelection(v, svg) {
  if (!selContent || selContent.v !== v) return;
  let q;
  if (selContent.kind === 'image') q = matQuad(imageMat(selContent));
  else { const [x0, y0, x1, y1] = selContent.a.rect; q = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }
  const pts = q.map(([x, y]) => toView(v, x, y));
  svg.appendChild(svgEl('polygon', { class: 'content-sel', points: pts.map((p) => p.join(',')).join(' ') }));
  if (selContent.kind === 'image') { const [hx, hy] = toView(v, ...apply(imageMat(selContent), 1, 0)); svg.appendChild(svgEl('rect', { class: 'content-handle', x: hx - 6, y: hy - 6, width: 12, height: 12, rx: 3 })); }
}
// Pixels of a picture in the PDF, as a PNG.
async function imagePng(v, im) {
  const obj = im.inline || await new Promise((res) => { try { v.page.objs.get(im.objId, res); } catch { res(null); } setTimeout(() => res(null), 4000); });
  if (!obj) return null;
  const c = document.createElement('canvas'); c.width = obj.width; c.height = obj.height; const g = c.getContext('2d');
  if (obj.bitmap) g.drawImage(obj.bitmap, 0, 0);
  else if (obj.data) {
    const id = g.createImageData(obj.width, obj.height), src = obj.data, n = obj.width * obj.height;
    const bpp = src.length / n;
    for (let i = 0; i < n; i++) {
      if (bpp >= 4) { id.data[i * 4] = src[i * 4]; id.data[i * 4 + 1] = src[i * 4 + 1]; id.data[i * 4 + 2] = src[i * 4 + 2]; id.data[i * 4 + 3] = src[i * 4 + 3]; }
      else if (bpp >= 3) { id.data[i * 4] = src[i * 3]; id.data[i * 4 + 1] = src[i * 3 + 1]; id.data[i * 4 + 2] = src[i * 3 + 2]; id.data[i * 4 + 3] = 255; }
      else { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = src[i]; id.data[i * 4 + 3] = 255; }
    }
    g.putImageData(id, 0, 0);
  } else return null;
  return c.toDataURL('image/png');
}
// The first change to a picture turns it into an ie mark: the original is cleared, and the picture drawn where it now goes.
async function imageMark(v, s) {
  if (s.mark) return s.mark;
  const data = await imagePng(v, s.im);
  if (!data) { toast('This picture can’t be moved, but it can be deleted or erased.'); return null; }
  const m = { id: uid(), type: 'ie', n: s.im.n, raw: s.im.raw, quad: s.im.quad, bg: sampleColors(v, s.im.quad).bg, data, mat: (s.im.mat || quadMat(s.im.quad)).slice() };
  marksOf(v.entry).push(m); s.mark = m;
  return m;
}
function startImageDrag(e, v, s, mode) {
  const [sx, sy] = toPdf(v, ...localPoint(e, v));
  const start = imageMat(s).slice();
  // Resizing keeps the picture's top-left corner (the unit square's 0,1) where it is and scales both axes alike.
  const tl = apply(start, 0, 1), br = apply(start, 1, 0), d0 = Math.hypot(br[0] - tl[0], br[1] - tl[1]) || 1;
  let moved = false, mat = start;
  const move = (ev) => {
    const [cx, cy] = toPdf(v, ...localPoint(ev, v)), dx = cx - sx, dy = cy - sy;
    if (!moved && Math.hypot(dx, dy) < 2) return;
    moved = true;
    if (mode === 'move') mat = [start[0], start[1], start[2], start[3], start[4] + dx, start[5] + dy];
    else {
      const k = Math.max(8 / d0, Math.hypot(br[0] + dx - tl[0], br[1] + dy - tl[1]) / d0);
      const a = start[0] * k, b = start[1] * k, c = start[2] * k, d = start[3] * k;
      mat = [a, b, c, d, tl[0] - c, tl[1] - d];
    }
    s.preview = mat; drawMarks(v);
  };
  const up = async () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    delete s.preview;
    if (!moved) { drawMarks(v); return; }
    const before = snapshot();
    const m = await imageMark(v, s);
    if (!m) { drawMarks(v); return; }
    m.mat = mat; m.deleted = false;
    drawMarks(v); changed(before);
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
function deleteContent() {
  const s = selContent; if (!s) return;
  const before = snapshot(), list = marksOf(s.v.entry);
  if (s.kind === 'image') {
    if (s.mark) s.mark.deleted = true;
    else list.push({ id: uid(), type: 'ie', n: s.im.n, raw: s.im.raw, quad: s.im.quad, bg: sampleColors(s.v, s.im.quad).bg, data: '', mat: (s.im.mat || quadMat(s.im.quad)).slice(), deleted: true });
  } else {
    if (s.mark) s.mark.deleted = true;
    else list.push({ id: uid(), type: 'ae', ref: s.a.id, rect: s.a.rect, subtype: s.a.subtype || '', deleted: true });
  }
  selContent = null; changed(before); syncHiddenComments(); redrawPage(s.v.entry);
}
async function editComment(v, a, mark) {
  if (a.annotationType === pdfjs.AnnotationType.FREETEXT) { toast('This comment\u2019s words are part of how it looks. Delete it and add a Text box instead.'); return; }
  const now = mark && mark.contents != null ? mark.contents : (a.contentsObj && a.contentsObj.str) || '';
  const text = await askText('Comment', a.titleObj && a.titleObj.str ? `By ${a.titleObj.str}` : '', now, 'Save', false, true);
  if (text == null || text === now) return;
  const before = snapshot();
  if (mark) mark.contents = text;
  else marksOf(v.entry).push({ id: uid(), type: 'ae', ref: a.id, rect: a.rect, subtype: a.subtype || '', contents: text });
  changed(before); rerenderView(v);
}

// Editing a line in place: a box with the line's text, over the line, in its colours.
let lineEditor = null;
async function editLine(v, L, mark) {
  const cm = await contentMap(v.page); v.page._cmapValue = cm;
  const m = mark || await teMarkFor(v, L, cm);
  await Promise.race([lineFace(v, m), new Promise((r) => setTimeout(r, 400))]);
  v = await phoneZoomTo(v, m);
  openLineEditor(v, m, !mark);
}
// A te mark for a line of the page, not yet in the page's list: its text, font, colours and the original's text state.
async function teMarkFor(v, L, cm) {
  const fo = await fontObj(v.page, L.fontName) || {};
  const name = String(fo.name || ''), { bg, fg } = sampleColors(v, L.quad);
  // The character code of each letter this font has (for fonts without a Unicode table, the only reliable source)
  const codes = {}; for (const [u, gl] of cm.glyphs.get(L.fontName) || []) if (gl.inFont && gl.code != null) codes[u] = gl.code;
  const ocr = cm.invisible.has(L.fontName) || /glyphless/i.test(name);
  return { id: uid(), type: 'te', tm: L.tm, width: L.width, ascent: L.ascent, descent: L.descent, quad: L.quad, orig: L.str, text: L.str, font: name, fam: stdFamily(name + ' ' + L.family), bold: !!fo.bold || /bold|black|heavy|semibold|demi/i.test(name), italic: !!fo.italic || /italic|oblique/i.test(name), bg, color: ocr ? '#111111' : lineColor(L, fg), codes, ocr, type3: !!fo.isType3Font, ...teState(L, ocr) };
}
// On a phone, a line too small to read or tap into (under 14 px) is zoomed to about 18 px first, around the tap;
// the zoom and scroll come back when the editor closes. Returns the page's view at the new zoom.
let phoneZoom = null; // { zoom, top, left, timer }
async function phoneZoomTo(v, m) {
  if (!isPhone() || !views.includes(v)) return v;
  if (phoneZoom && phoneZoom.timer) { clearTimeout(phoneZoom.timer); phoneZoom.timer = 0; }
  const px = lineFrame(m).size * scale; if (px >= 14) return v;
  const n = views.indexOf(v), [x, y] = toView(v, ...teAt(m).slice(4)), r = v.el.getBoundingClientRect();
  const at = editAt ? { x: editAt.x, y: editAt.y } : { x: r.left + x, y: r.top + y };
  if (!phoneZoom) phoneZoom = { zoom: S.zoom, top: viewer.scrollTop, left: viewer.scrollLeft, timer: 0 };
  const z = Math.min(400, Math.ceil(scale * 100 * 18 / px));
  const fx = (at.x - r.left) / r.width, fy = (at.y - r.top) / r.height;
  await setZoom(z, at);
  const nv = views[n]; if (!nv) return v;
  // The tap's spot stays under the finger (as far as the page can scroll), so the caret goes where it was tapped.
  let b = nv.el.getBoundingClientRect();
  viewer.scrollLeft += b.left + fx * b.width - at.x; viewer.scrollTop += b.top + fy * b.height - at.y;
  b = nv.el.getBoundingClientRect();
  if (editAt) editAt = { ...editAt, x: b.left + fx * b.width, y: b.top + fy * b.height };
  renderView(nv);
  return nv;
}
function phoneZoomBack() {
  if (!phoneZoom || phoneZoom.timer) return;
  // A moment later, unless another line is opened in the meantime (it keeps this zoom).
  phoneZoom.timer = setTimeout(async () => {
    const pz = phoneZoom; phoneZoom = null; if (!pz || lineEditor) { if (pz && lineEditor) phoneZoom = { ...pz, timer: 0 }; return; }
    await setZoom(pz.zoom); viewer.scrollTop = pz.top; viewer.scrollLeft = pz.left;
  }, 350);
}
// The line editor types in the PDF's own font. pdf.js loads each font with its letters moved to other code points,
// so a copy of the font is made whose character map gives each letter (as typed) the glyph pdf.js drew it with.
// Until that copy is ready, or for bold or italic the font isn't, the editor uses the closest standard font.
const ownFaces = new Map(); // page font name + page -> Promise<family | null>
function ownFace(page, name, map) {
  const key = name + '@' + (page._pageIndex ?? page.pageNumber);
  if (!ownFaces.has(key)) ownFaces.set(key, (async () => {
    const fo = await fontObj(page, name);
    const data = fo && fo.data; if (!data || !data.length || fo.isType3Font) return null;
    const out = remapCmap(data instanceof Uint8Array ? data : new Uint8Array(data), [...map].filter(([, g]) => g.inFont && g.fc).map(([u, g]) => [u.codePointAt(0), g.fc.codePointAt(0)]));
    if (!out) return null;
    const family = 'cpdf-own-' + ownFaces.size;
    const face = new FontFace(family, out); await face.load(); document.fonts.add(face);
    return family;
  })().catch(() => null));
  return ownFaces.get(key);
}
// A font file (TrueType or OpenType) with its character map replaced: each [code point, old code point] pair takes
// the glyph the old code point had. Returns null when the file can't be read.
function remapCmap(buf, pairs) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), n = dv.getUint16(4);
  let rec = -1;
  for (let i = 0; i < n; i++) if (String.fromCharCode(buf[12 + 16 * i], buf[13 + 16 * i], buf[14 + 16 * i], buf[15 + 16 * i]) === 'cmap') rec = 12 + 16 * i;
  if (rec < 0) return null;
  const off = dv.getUint32(rec + 8), old = new Map(), put = (c, g) => { if (g && !old.has(c)) old.set(c, g); };
  for (let k = 0, subs = dv.getUint16(off + 2); k < subs; k++) {
    const so = off + dv.getUint32(off + 8 + 8 * k), fmt = dv.getUint16(so);
    if (fmt === 4) {
      const sx2 = dv.getUint16(so + 6), ends = so + 14, starts = ends + sx2 + 2, deltas = starts + sx2, ranges = deltas + sx2;
      for (let i = 0; i < sx2 / 2; i++) {
        const e = dv.getUint16(ends + 2 * i), st = dv.getUint16(starts + 2 * i), d = dv.getUint16(deltas + 2 * i), ro = dv.getUint16(ranges + 2 * i);
        for (let c = st; c <= e && c !== 0xFFFF; c++) { if (!ro) put(c, (c + d) & 0xFFFF); else { const g = dv.getUint16(ranges + 2 * i + ro + 2 * (c - st)); put(c, g ? (g + d) & 0xFFFF : 0); } }
      }
    } else if (fmt === 12) {
      for (let i = 0, ng = dv.getUint32(so + 12); i < ng; i++) { const a = dv.getUint32(so + 16 + 12 * i), b = dv.getUint32(so + 20 + 12 * i), g = dv.getUint32(so + 24 + 12 * i); for (let c = a; c <= b && c - a < 65536; c++) put(c, g + c - a); }
    } else if (fmt === 0) { for (let c = 0; c < 256; c++) put(c, buf[so + 6 + c]); }
    else if (fmt === 6) { const first = dv.getUint16(so + 6); for (let i = 0, cnt = dv.getUint16(so + 8); i < cnt; i++) put(first + i, dv.getUint16(so + 10 + 2 * i)); }
  }
  const nm = new Map(); for (const [u, fc] of pairs) if (u < 0xFFFF && old.has(fc) && !nm.has(u)) nm.set(u, old.get(fc));
  if (!nm.size) return null;
  // A format 4 map: one segment per letter, then the closing segment.
  const codes = [...nm.keys()].sort((a, b) => a - b), seg = codes.length + 1, len = 16 + 8 * seg;
  const t = new DataView(new ArrayBuffer(12 + len));
  t.setUint16(2, 1); t.setUint16(4, 3); t.setUint16(6, 1); t.setUint32(8, 12);
  const es = Math.floor(Math.log2(seg)), sr = 2 * 2 ** es;
  t.setUint16(12, 4); t.setUint16(14, len); t.setUint16(18, seg * 2); t.setUint16(20, sr); t.setUint16(22, es); t.setUint16(24, seg * 2 - sr);
  const E = 26, S = E + 2 * seg + 2, D = S + 2 * seg;
  codes.forEach((c, i) => { t.setUint16(E + 2 * i, c); t.setUint16(S + 2 * i, c); t.setUint16(D + 2 * i, (nm.get(c) - c) & 0xFFFF); });
  t.setUint16(E + 2 * codes.length, 0xFFFF); t.setUint16(S + 2 * codes.length, 0xFFFF); t.setUint16(D + 2 * codes.length, 1);
  // The new table goes at the end of the file; the table directory points to it.
  const at = (buf.length + 3) & ~3, outB = new Uint8Array(at + ((t.byteLength + 3) & ~3));
  outB.set(buf); outB.set(new Uint8Array(t.buffer), at);
  const ov = new DataView(outB.buffer); let sum = 0;
  for (let i = 0; i < outB.length - at; i += 4) sum = (sum + ov.getUint32(at + i)) >>> 0;
  ov.setUint32(rec + 4, sum); ov.setUint32(rec + 8, at); ov.setUint32(rec + 12, t.byteLength);
  return outB;
}
function lineFont(v, m, px, bold = !!m.bold, italic = !!m.italic) {
  const std = `${bold ? 'bold ' : ''}${italic ? 'italic ' : ''}${px}px ${cssFamily(m.fam)}`;
  if (m.ocr || m.type3 || bold !== !!m.bold || italic !== !!m.italic) return std;
  const fam = v.page._ownFace && v.page._ownFace[m.id];
  return fam ? `${px}px "${fam}", ${cssFamily(m.fam)}` : std;
}
// Gets the page's font ready for the line editor; calls back once it is (if it wasn't already).
function lineFace(v, m, ready) {
  const cm = v.page._cmapValue, L = cm && cm.lines.find((l) => sameOrigin(l.tm, m.tm)), map = L && cm.glyphs.get(L.fontName);
  if (!map || m.ocr || m.type3) return Promise.resolve(null);
  return ownFace(v.page, L.fontName, map).then((fam) => { if (fam) { (v.page._ownFace ||= {})[m.id] = fam; ready && ready(); } return fam; });
}
function openLineEditor(v, m, isNew) {
  const { size, u } = lineFrame(m), px = size * scale, t = teAt(m), hsc = Math.hypot(m.tm[0], m.tm[1]) / (Math.hypot(m.tm[2], m.tm[3]) || 1);
  const [ox, oy] = toView(v, t[4], t[5]), [ax, ay] = toView(v, t[4] + u[0], t[5] + u[1]);
  const ang = Math.atan2(ay - oy, ax - ox) * 180 / Math.PI, asc = Math.max(m.ascent, .9) * px, desc = Math.max(-m.descent, .3) * px;
  const ed = document.createElement('div');
  ed.className = 'line-editor'; ed.spellcheck = false; ed.setAttribute('role', 'textbox'); ed.setAttribute('aria-label', 'Edit this line');
  try { ed.contentEditable = 'plaintext-only'; } catch { ed.contentEditable = 'true'; }
  if (ed.contentEditable !== 'plaintext-only') ed.contentEditable = 'true';
  ed.textContent = m.text;
  // The line's spacing, width scale and outline, so the text keeps its length and weight while it is typed.
  const outline = (m.tr === 1 || m.tr === 2) && m.lw ? `${Math.max(.5, m.lw * scale)}px ${m.stroke || m.color}` : '';
  Object.assign(ed.style, { left: ox + 'px', top: (oy - asc) + 'px', height: (asc + desc) + 'px', lineHeight: (asc + desc) + 'px', minWidth: (m.width * scale / hsc + 4) + 'px', font: lineFont(v, m, px), color: m.tr === 1 ? 'transparent' : m.color, background: m.bg, letterSpacing: (m.tc || 0) * px + 'px', wordSpacing: (m.tw || 0) * px + 'px', webkitTextStroke: outline, transformOrigin: `0 ${asc}px`, transform: `rotate(${ang}deg)` + (Math.abs(hsc - 1) > .01 ? ` scaleX(${hsc})` : '') });
  v.el.appendChild(ed);
  editingIds.add(m.id); drawMarks(v);
  lineEditor = { ed, v, m, isNew, follow: teFollowers(v, m) };
  if (!(v.page._ownFace && v.page._ownFace[m.id])) { const was = ed.style.font; lineFace(v, m, () => { if (lineEditor && lineEditor.ed === ed && ed.style.font === was) ed.style.font = lineFont(v, m, px); }); }
  ed.focus();
  placeCaret(ed, editAt);
  ed.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); closeLineEditor(true); }
    if (e.key === 'Escape') { e.preventDefault(); keptHint(closeLineEditor(true)); }
    if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
  });
  ed.addEventListener('blur', () => setTimeout(() => { if (lineEditor && lineEditor.ed === ed) closeLineEditor(true); }, 0));
}
// Where a click (or tap) on the page put the caret: { x, y, detail } on screen, set while the Edit tool handles it.
// Opened from the keyboard (no click), the editor selects all of the line.
let editAt = null;
// The offset in an editor's text under a point on screen, or -1.
function offsetAt(el, x, y) {
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    const p = document.caretPositionFromPoint ? document.caretPositionFromPoint(x, y) : null;
    return p && p.offsetNode === el ? p.offset : -1;
  }
  let node = null, off = 0;
  const p = document.caretPositionFromPoint ? document.caretPositionFromPoint(x, y) : null;
  if (p) { node = p.offsetNode; off = p.offset; }
  else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); if (r) { node = r.startContainer; off = r.startOffset; } }
  if (!node || !el.contains(node)) {
    // Outside the text (before or after it on its line): the nearest end.
    const b = el.getBoundingClientRect(); if (y < b.top - 4 || y > b.bottom + 4) return -1;
    return x <= b.left ? 0 : (el.textContent || '').length;
  }
  if (node === el) return off ? (el.textContent || '').length : 0;
  return off;
}
// The word (letters and digits) around an offset.
function wordAt(text, k) {
  const w = /[\p{L}\p{N}_'’-]/u; let a = k, b = k;
  if (!w.test(text[a] || '') && w.test(text[a - 1] || '')) a = b = k - 1;
  while (a > 0 && w.test(text[a - 1])) a--;
  while (b < text.length && w.test(text[b])) b++;
  return b > a ? [a, b] : [k, Math.min(text.length, k + 1)];
}
// Puts the caret where the click was: one click places it, a double click selects the word, a triple click the line.
function placeCaret(el, at) {
  const field = el.tagName === 'TEXTAREA', text = field ? el.value : el.textContent || '';
  let a = 0, b = text.length;
  if (at && at.detail !== 3) {
    const k = offsetAt(el, at.x, at.y);
    if (k >= 0) { a = b = Math.min(k, text.length); if (at.detail === 2) [a, b] = wordAt(text, a); }
    else a = b = text.length;
  }
  if (field) { el.setSelectionRange(a, b); return; }
  const tn = el.firstChild, sel = getSelection(), r = document.createRange();
  if (tn && tn.nodeType === 3) { r.setStart(tn, Math.min(a, tn.length)); r.setEnd(tn, Math.min(b, tn.length)); } else r.selectNodeContents(el);
  sel.removeAllRanges(); sel.addRange(r);
}
// Text that follows a line on its baseline in another font (a bold word after a regular one): when the line's text
// changes width, what follows moves along with its end, as in a word processor. Read while the line is being edited.
function teFollowers(v, m) {
  const out = { list: null };
  out.ready = (async () => {
    const cm = v.page._cmapValue || await contentMap(v.page), own = marksOf(v.entry), list = [];
    let cur = m;
    for (let k = 0; k < 12; k++) {
      const f = lineFrame(cur);
      const next = cm.lines.find((l) => {
        if (sameOrigin(l.tm, cur.tm)) return false;
        const g = lineFrame(l); if (Math.abs(g.size - f.size) > f.size * .6 || g.u[0] * f.u[0] + g.u[1] * f.u[1] < .999) return false;
        const dx = l.tm[4] - f.o[0], dy = l.tm[5] - f.o[1], along = dx * f.u[0] + dy * f.u[1], perp = dx * f.v[0] + dy * f.v[1];
        return Math.abs(perp) < f.size * .35 && along > cur.width - Math.max(1, f.size * .3) && along < cur.width + f.size * .8;
      });
      if (!next || (FEATURE.lineTaken && FEATURE.lineTaken(v.entry, next))) break;
      const mk = own.find((x) => x.type === 'te' && sameOrigin(x.tm, next.tm)) || await teMarkFor(v, next, cm);
      list.push(mk); cur = mk;
    }
    out.list = list;
  })().catch(() => { out.list = []; });
  return out;
}
// Moves the text after an edited line by how much wider or narrower the line now is. Returns true if anything moved.
function teReflow(v, m, follow) {
  if (!follow || !follow.list || !follow.list.length) return false;
  // How much wider the text is now, both measured the same way (so the gap after the original is kept).
  const list = marksOf(v.entry), grow = (x) => (x.text === x.orig ? 0 : teImage(v, x).adv - teImage(v, { ...x, text: x.orig }).adv);
  let shift = (m.dx || 0) + grow(m), moved = false;
  for (const f of follow.list) {
    const dx = Math.abs(shift) < .05 ? 0 : +shift.toFixed(3), inList = list.includes(f);
    if ((f.dx || 0) !== dx) moved = true;
    if (dx) f.dx = dx; else delete f.dx;
    if (!inList && dx) list.push(f);
    else if (inList && !dx && f.text === f.orig) list.splice(list.indexOf(f), 1);
    shift = (f.dx || 0) + grow(f);
  }
  return moved;
}
// Escape, like clicking away, keeps what was typed; Undo takes it back. Says so once a session.
let keptHinted = false;
function keptHint(changedSomething) { if (changedSomething && !keptHinted) { keptHinted = true; toast(coarse() ? 'Change kept. Undo takes it back.' : `Change kept. ${fmtKey('Mod-z')} undoes it.`); } }
// Returns true if the edit changed the page.
function closeLineEditor(commit) {
  if (!lineEditor) return false;
  const { ed, v, m, isNew, follow } = lineEditor; lineEditor = null;
  editingIds.delete(m.id);
  const text = ed.textContent.replace(/[\r\n]+/g, ' ');
  ed.remove();
  phoneZoomBack();
  if (commit && text !== m.text) {
    const before = snapshot(), list = marksOf(v.entry);
    m.text = text;
    if (text === m.orig && !isNew && !m.dx) list.splice(list.indexOf(m), 1); // back to the original: no edit left
    else if (isNew) list.push(m);
    // What follows on the line moves with its new end (once read; that takes a moment only the first time).
    if (follow.list) teReflow(v, m, follow);
    else follow.ready.then(() => { const b2 = snapshot(); if (teReflow(v, m, follow)) { changed(b2); drawMarks(v); } });
    changed(before);
    drawMarks(v); return true;
  }
  drawMarks(v); return false;
}

// Erase area: drag a rectangle; everything in it is cleared to the colour around it.
function startErase(e, v) {
  e.preventDefault();
  const before = snapshot();
  const [x, y] = toPdf(v, ...localPoint(e, v));
  const m = { id: uid(), type: 'erase', quad: [[x, y], [x, y], [x, y], [x, y]], bg: '#ffffff', drafting: true };
  marksOf(v.entry).push(m);
  const set = (x2, y2) => { m.quad = [[x, y], [x2, y], [x2, y2], [x, y2]]; };
  const move = (ev) => { set(...toPdf(v, ...localPoint(ev, v))); drawMarks(v); };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    const [x0, y0, x1, y1] = quadBox(m.quad);
    if (x1 - x0 < 3 || y1 - y0 < 3) { marksOf(v.entry).splice(marksOf(v.entry).indexOf(m), 1); drawMarks(v); return; }
    delete m.drafting; m.bg = sampleColors(v, m.quad).bg;
    drawMarks(v); changed(before);
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
// Hover feedback for the Edit tool: what a click would edit is outlined.
let hoverTimer = 0;
function onEditHover(e, v) {
  if (app.dataset.tool !== 'edit' || lineEditor) return;
  const t = Date.now(); if (t - hoverTimer < 40) return; hoverTimer = t;
  const [x, y] = toPdf(v, ...localPoint(e, v));
  contentAt(v, x, y).then((hit) => {
    const svg = v.el.querySelector('svg.marks'); if (!svg) return;
    svg.querySelectorAll('.content-hover').forEach((n) => n.remove());
    svg.style.cursor = !hit ? 'default' : hit.kind === 'text' ? 'text' : hit.kind === 'image' ? 'move' : 'pointer';
    if (!hit) return;
    const q = hit.kind === 'text' ? hit.L.quad : hit.kind === 'image' ? (hit.mark ? matQuad(hit.mark.mat) : hit.im.quad) : [[hit.a.rect[0], hit.a.rect[1]], [hit.a.rect[2], hit.a.rect[1]], [hit.a.rect[2], hit.a.rect[3]], [hit.a.rect[0], hit.a.rect[3]]];
    svg.appendChild(svgEl('polygon', { class: 'content-hover', points: q.map(([qx, qy]) => toView(v, qx, qy).join(',')).join(' ') }));
  });
}

/* Saving content edits. A small reader for page content streams: it finds where each piece of text and each picture
   is drawn, so edited lines and moved or deleted pictures can be taken out. */
function tokenizeContent(s) {
  const out = []; let i = 0; const n = s.length;
  const ws = (c) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
  const delim = (c) => '()<>[]{}/%'.includes(String.fromCharCode(c));
  while (i < n) {
    const c = s.charCodeAt(i);
    if (ws(c)) { i++; continue; }
    if (c === 37) { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    const start = i;
    if (c === 40) { // (literal string)
      let depth = 0, str = '';
      for (; i < n; i++) {
        const ch = s[i];
        if (ch === '\\') { const nx = s[++i]; const esc = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[nx]; if (esc) str += esc; else if (/[0-7]/.test(nx)) { let o = nx; while (o.length < 3 && /[0-7]/.test(s[i + 1])) o += s[++i]; str += String.fromCharCode(parseInt(o, 8) & 255); } else if (nx === '\r') { if (s[i + 1] === '\n') i++; } else if (nx !== '\n') str += nx; continue; }
        if (ch === '(') { if (depth++ > 0) str += ch; continue; }
        if (ch === ')') { if (--depth === 0) { i++; break; } str += ch; continue; }
        str += ch;
      }
      out.push({ t: 'str', v: str, start, end: i }); continue;
    }
    if (c === 60 && s[i + 1] === '<') { out.push({ t: 'dict<', start, end: i + 2 }); i += 2; continue; }
    if (c === 62 && s[i + 1] === '>') { out.push({ t: 'dict>', start, end: i + 2 }); i += 2; continue; }
    if (c === 60) { let j = s.indexOf('>', i); if (j < 0) j = n; const h = s.slice(i + 1, j).replace(/\s+/g, ''); let str = ''; for (let k = 0; k < h.length; k += 2) str += String.fromCharCode(parseInt((h.slice(k, k + 2) + '0').slice(0, 2), 16)); out.push({ t: 'str', v: str, start, end: j + 1 }); i = j + 1; continue; }
    if (c === 91 || c === 93) { out.push({ t: c === 91 ? '[' : ']', start, end: i + 1 }); i++; continue; }
    if (c === 47) { i++; while (i < n && !ws(s.charCodeAt(i)) && !delim(s.charCodeAt(i))) i++; out.push({ t: 'name', v: s.slice(start + 1, i), start, end: i }); continue; }
    while (i < n && !ws(s.charCodeAt(i)) && !delim(s.charCodeAt(i))) i++;
    if (i === start) { i++; continue; } // a stray > or { } : skip it
    const w = s.slice(start, i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) out.push({ t: 'num', v: parseFloat(w), start, end: i });
    else {
      out.push({ t: 'op', v: w, start, end: i });
      if (w === 'ID') { // inline image data runs to EI
        let j = i + 1; while (j < n && !(/\sEI(\s|$)/.test(s.slice(j - 1, j + 3)))) j++;
        out.push({ t: 'data', start: i, end: j }); i = j;
      }
    }
  }
  return out;
}
// Walks a content stream with a text and graphics state, and calls back with each text-showing and image operator.
function walkContent(s, fontWidth, onShow, onImage, ctm0, onGs) {
  const toks = tokenizeContent(s);
  let ctm = ctm0 || [1, 0, 0, 1, 0, 0], tm = [1, 0, 0, 1, 0, 0], tlm = tm, font = null, fs = 1, tc = 0, tw = 0, th = 1, tl = 0, tr = 0;
  const gstack = [], ops = []; let operands = [], opStart = null, arrStack = [], bi = null, bt = 0;
  ops.etEnd = []; // where each text object (BT … ET) ends, by its number
  for (const t of toks) {
    if (t.t === 'op') {
      const o = t.v, a = operands, start = opStart ?? t.start, end = t.end;
      operands = []; opStart = null;
      const num = (k) => (a[k] && a[k].t === 'num' ? a[k].v : 0);
      if (o === 'BI') { bi = { start }; continue; }
      if (o === 'ID') continue;
      if (o === 'EI') { if (bi) { onImage({ start: bi.start, end, ctm, inline: true, mask: /\/(IM|ImageMask)\s+true/.test(s.slice(bi.start, end).split(/\sID\s/)[0]) }); bi = null; } continue; }
      if (bi) continue;
      if (o === 'q') gstack.push([ctm, font, fs, tc, tw, th, tl, tr]);
      else if (o === 'Q') { const g = gstack.pop(); if (g) [ctm, font, fs, tc, tw, th, tl, tr] = g; }
      else if (o === 'Tr') tr = num(0);
      else if (o === 'cm') ctm = mul([0, 1, 2, 3, 4, 5].map(num), ctm);
      else if (o === 'BT') { tm = tlm = [1, 0, 0, 1, 0, 0]; bt++; }
      else if (o === 'ET') ops.etEnd[bt] = end;
      else if (o === 'Tf') { font = a[0] && a[0].v; fs = num(1); }
      else if (o === 'Tc') tc = num(0);
      else if (o === 'Tw') tw = num(0);
      else if (o === 'Tz') th = num(0) / 100;
      else if (o === 'TL') tl = num(0);
      else if (o === 'Td' || o === 'TD') { if (o === 'TD') tl = -num(1); tlm = mul([1, 0, 0, 1, num(0), num(1)], tlm); tm = tlm; }
      else if (o === 'Tm') { tm = tlm = [0, 1, 2, 3, 4, 5].map(num); }
      else if (o === 'T*') { tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; }
      else if (o === 'Tj' || o === 'TJ' || o === "'" || o === '"') {
        if (o === "'" || o === '"') { if (o === '"') { tw = num(0); tc = num(1); } tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; }
        const origin = apply(mul(tm, ctm), 0, 0);
        const parts = o === 'TJ' ? a.filter((x) => x.t === 'str' || x.t === 'num') : a.filter((x) => x.t === 'str').slice(-1);
        let adv = 0;
        for (const p of parts) {
          if (p.t === 'num') { adv -= p.v / 1000 * fs * th; continue; }
          for (const { code, w, space } of fontWidth(font, p.v)) adv += (w / 1000 * fs + tc + (space ? tw : 0)) * th;
        }
        // Cutting ' or " must keep their move to the next line (and " its spacing), or later lines shift up.
        const keep = o === "'" ? ' T* ' : o === '"' ? ` ${num(0)} Tw ${num(1)} Tc T* ` : ' ';
        ops.push({ start, end, origin, font, fs, keep, bt, ctm, invisible: tr === 3 || tr === 7, strings: parts.filter((p) => p.t === 'str').map((p) => p.v) });
        onShow && onShow(ops[ops.length - 1]);
        tm = mul([1, 0, 0, 1, adv, 0], tm);
      } else if (o === 'Do') onImage({ start, end, ctm, name: a[0] && a[0].v });
      else if (o === 'gs' && onGs) onGs(a[0] && a[0].v, ctm);
      continue;
    }
    if (opStart == null) opStart = t.start;
    if (t.t === '[') { arrStack.push(operands); operands = []; continue; }
    if (t.t === ']') { const arr = operands; operands = arrStack.pop() || []; operands.push(...arr); continue; }
    operands.push(t);
  }
  return ops;
}
// A page's fonts, by resource name: codes and widths, and the code for each character (from the font's ToUnicode).
function parseCMap(txt) {
  const map = new Map(); let bytes = 1;
  const cs = txt.match(/begincodespacerange\s*<([0-9a-fA-F]+)>/); if (cs) bytes = Math.max(1, cs[1].length / 2);
  const hexToStr = (h) => { let s = ''; for (let i = 0; i + 4 <= h.length; i += 4) s += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); if (h.length === 2) s = String.fromCharCode(parseInt(h, 16)); return s; };
  for (const b of txt.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), hexToStr(m[2]));
  for (const b of txt.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) for (const m of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
    const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16); if (hi - lo > 65535) continue;
    if (m[3][0] === '[') { const arr = [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]); for (let c = lo; c <= hi; c++) map.set(c, hexToStr(arr[c - lo] || '')); }
    else { const base = m[3].slice(1, -1), tail = base.slice(-4), last = parseInt(tail, 16); for (let c = lo; c <= hi; c++) map.set(c, hexToStr(base.slice(0, -4) + (last + c - lo).toString(16).padStart(4, '0'))); }
  }
  return { map, bytes };
}
function pageFonts(L, out, pageNode) {
  const { PDFName, PDFDict, PDFArray, PDFRawStream, PDFNumber, decodePDFRawStream } = L;
  const text = (st) => { try { const b = st instanceof PDFRawStream ? decodePDFRawStream(st).decode() : st.getContents(); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return s; } catch { return ''; } };
  const fonts = new Map();
  const res = pageNode.Resources && pageNode.Resources();
  const fd = res && res.lookup(PDFName.of('Font'));
  if (fd instanceof PDFDict) for (const [key, ref] of fd.entries()) {
    const d = out.context.lookup(ref); if (!(d instanceof PDFDict)) continue;
    const type0 = String(d.lookup(PDFName.of('Subtype'))) === '/Type0';
    const tu = d.lookup(PDFName.of('ToUnicode'));
    const cm = tu ? parseCMap(text(tu)) : { map: new Map(), bytes: type0 ? 2 : 1 };
    const rev = new Map(); for (const [code, u] of cm.map) if (u && !rev.has(u)) rev.set(u, code);
    // widths, for working out where each piece of text starts
    const widths = new Map(); let dw = type0 ? 1000 : 0;
    if (type0) {
      const df = d.lookup(PDFName.of('DescendantFonts')); const cid = df instanceof PDFArray ? df.lookup(0) : null;
      if (cid instanceof PDFDict) {
        const DW = cid.lookup(PDFName.of('DW')); if (DW instanceof PDFNumber) dw = DW.asNumber();
        const W = cid.lookup(PDFName.of('W'));
        if (W instanceof PDFArray) { const arr = W.asArray().map((x) => out.context.lookup(x)); for (let k = 0; k < arr.length;) { const c0 = arr[k].asNumber(); const nx = arr[k + 1]; if (nx instanceof PDFArray) { nx.asArray().forEach((w, j) => widths.set(c0 + j, out.context.lookup(w).asNumber())); k += 2; } else { const c1 = nx.asNumber(), w = arr[k + 2].asNumber(); for (let c = c0; c <= c1; c++) widths.set(c, w); k += 3; } } }
      }
    } else {
      const fc = d.lookup(PDFName.of('FirstChar')), W = d.lookup(PDFName.of('Widths'));
      if (fc instanceof PDFNumber && W instanceof PDFArray) W.asArray().forEach((w, j) => widths.set(fc.asNumber() + j, out.context.lookup(w).asNumber()));
      if (!W) dw = 500;
    }
    fonts.set(key.asString().slice(1), { key, ref, base: String(d.lookup(PDFName.of('BaseFont')) || ''), type0, bytes: cm.bytes, map: cm.map, rev, widths, dw, hasToUnicode: !!tu });
  }
  const fontWidth = (name, str) => {
    const f = fonts.get(name), out2 = [], b = f ? f.bytes : 1;
    for (let i = 0; i + b <= str.length; i += b) { let code = 0; for (let k = 0; k < b; k++) code = code * 256 + str.charCodeAt(i + k); out2.push({ code, w: f ? (f.widths.get(code) ?? f.dw) : 500, space: b === 1 && code === 32 }); }
    return out2;
  };
  return { fonts, fontWidth, text };
}
const baseName = (n) => String(n || '').replace(/^\//, '').replace(/^[A-Z]{6}\+/, '');
// Applies a page's content edits while saving: takes out what was replaced, then paints the new content.
// A line's new text goes where its old text was in the content (after the old text's BT … ET), so the page's reading
// order (text extraction, copy, screen readers) stays the same. `m.emit` (operators) replaces a line's own drawing,
// once for the lines that share `m.grp` (a paragraph drawn again as a block).
async function saveContentEdits(L, out, p, marks, ctx) {
  const edits = marks.filter((m) => CONTENT_TYPES.has(m.type) && !m.drafting);
  if (!edits.length) return;
  const { PDFName, PDFArray, PDFDict, PDFRef, PDFOperator, PDFNumber, PDFHexString, PDFRawStream, StandardFonts } = L;
  const node = p.node;
  const { fonts, fontWidth, text } = pageFonts(L, out, node);
  const lines = edits.filter((m) => m.type === 'te'), pics = edits.filter((m) => m.type === 'ie');
  const rgbOf = (hex) => { const n = parseInt(String(hex || '#ffffff').slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255].map((x) => PDFNumber.of(+x.toFixed(4))); };
  const O = (name, args = []) => PDFOperator.of(name, args);
  // 0. Each edited line's new text, made first so it can go in the old text's place.
  const newOps = new Map();
  for (const m of lines) {
    const ops = m.emit || (m.text.trim() ? await teOps(L, out, node, m, fonts, ctx) : null);
    if (ops && ops.length) newOps.set(m.id, ops);
  }
  // 1. Take edited lines and changed pictures out of the page's own content.
  // Contents may be one stream, an array of them, or a reference to such an array.
  const streamsOf = () => { const raw = node.get(PDFName.of('Contents')); const r = raw && out.context.lookup(raw); return r instanceof PDFArray ? r.asArray() : raw ? [raw] : []; };
  const parts = streamsOf();
  let src = parts.map((r) => { const st = out.context.lookup(r); return st ? text(st) : ''; }).join('\n');
  const cut = [], removed = new Set(), hidden = new Set(), anchor = new Map();
  const resOf = (R) => { const x = R instanceof PDFDict ? R : null; return { xo: x && x.lookup(PDFName.of('XObject')) instanceof PDFDict ? x.lookup(PDFName.of('XObject')) : null, eg: x && x.lookup(PDFName.of('ExtGState')) instanceof PDFDict ? x.lookup(PDFName.of('ExtGState')) : null }; };
  const pageRes = resOf(node.Resources && node.Resources()), xo = pageRes.xo;
  const subOf = (o) => (o && o.dict ? String(o.dict.lookup(PDFName.of('Subtype'))) : '');
  const isMask = (o) => String(o && o.dict && o.dict.lookup(PDFName.of('ImageMask'))) === 'true';
  // Pictures are found by identity, as the screen hides them: their place among the page's picture draws (forms and
  // soft masks included, image masks not), counted the way pdf.js counts them. Marks from before that identity (no
  // raw) are found by where they are drawn.
  let rawK = -1;
  const picAt = (q) => {
    const k = ++rawK, b = quadBox(q), near = (m) => quadBox(m.quad).every((n, j) => Math.abs(n - b[j]) < .75);
    return pics.find((m) => !removed.has(m.id) && (m.raw != null ? m.raw === k && near(m) : near(m)));
  };
  // Pictures a soft mask draws only count (they are never what was clicked).
  const countForm = (st, depth) => {
    if (!st || !st.dict || depth > 5) return;
    const R = resOf(st.dict.lookup(PDFName.of('Resources')));
    walkContent(text(st), fontWidth, null, (im) => {
      if (im.inline) { if (!im.mask) rawK++; return; }
      const o = R.xo && R.xo.lookup(PDFName.of(im.name)), sub = subOf(o);
      if (sub === '/Image') { if (!isMask(o)) rawK++; } else if (sub === '/Form') countForm(o, depth + 1);
    }, null, (g) => softMask(R.eg, g, depth + 1));
  };
  const softMask = (eg, name, depth) => {
    const gs = eg && name && eg.lookup(PDFName.of(name)), sm = gs instanceof PDFDict ? gs.lookup(PDFName.of('SMask')) : null;
    if (sm instanceof PDFDict) countForm(sm.lookup(PDFName.of('G')), depth);
  };
  // A picture inside a form (a page background often is): the form is copied without it, and the page draws the copy.
  let formN = 0;
  const formCut = (dict, name, ctm, depth) => {
    const st = dict && dict.lookup(PDFName.of(name));
    if (!st || !st.dict || depth > 5 || subOf(st) !== '/Form') return null;
    const M = st.dict.lookup(PDFName.of('Matrix')), fm = M instanceof PDFArray && M.size() === 6 ? M.asArray().map((x) => { const n = out.context.lookup(x); return n instanceof PDFNumber ? n.asNumber() : 0; }) : [1, 0, 0, 1, 0, 0];
    const R = st.dict.lookup(PDFName.of('Resources')), own = resOf(R), fx = own.xo || dict;
    const fxo = fx instanceof PDFDict ? fx : null;
    let fsrc = text(st); const fcut = [], ids = [];
    walkContent(fsrc, fontWidth, null, (im) => {
      const o = !im.inline && fxo && fxo.lookup(PDFName.of(im.name)), sub = im.inline ? '/Image' : subOf(o);
      if (sub === '/Image') {
        if (im.inline ? im.mask : isMask(o)) return;
        const m = picAt([[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => apply(im.ctm, x, y)));
        if (m) { fcut.push([im.start, im.end, ' ']); ids.push(m.id); removed.add(m.id); }
      } else if (sub === '/Form') { const h = formCut(fxo, im.name, im.ctm, depth + 1); if (h) { fcut.push([im.start, im.end, ` ${h.key} Do `]); ids.push(...h.ids); } }
    }, mul(fm, ctm), (g) => softMask(own.eg, g, depth + 1));
    if (!ids.length) return null;
    fcut.sort((a, b) => b[0] - a[0]);
    for (const [a, b, keep] of fcut) fsrc = fsrc.slice(0, a) + keep + fsrc.slice(b);
    const entries = {}; for (const [k, val] of st.dict.entries()) { const n = k.asString().slice(1); if (!['Length', 'Filter', 'DecodeParms'].includes(n)) entries[n] = val; }
    const bytes = new Uint8Array(fsrc.length); for (let i = 0; i < fsrc.length; i++) bytes[i] = fsrc.charCodeAt(i) & 255;
    const ref = out.context.register(out.context.flateStream(bytes, entries));
    let key;
    if (depth === 0) key = node.newXObject('CPDFFm', ref).toString();
    else { key = `/CPDFFm${++formN}x${Date.now() % 100000}`; fxo.set(PDFName.of(key.slice(1)), ref); }
    return { key, ids };
  };
  let ops = null;
  try {
    ops = walkContent(src, fontWidth, (op) => {
      // A piece of text belongs to an edited line when it is in the line's font and starts on the line's baseline,
      // within the line (not at its end, where a word in another font or a link may follow).
      const f = fonts.get(op.font);
      for (const m of lines) {
        const fr = lineFrame(m), dx = op.origin[0] - fr.o[0], dy = op.origin[1] - fr.o[1];
        const along = dx * fr.u[0] + dy * fr.u[1], perp = dx * fr.v[0] + dy * fr.v[1];
        if (perp < -fr.size * .35 || perp > fr.size * .35 || along < -Math.max(1, fr.size * .3) || along > m.width - Math.min(1, fr.size * .1)) continue;
        if (m.font && f && f.base && baseName(f.base) !== baseName(m.font)) continue;
        cut.push([op.start, op.end, op.keep]); removed.add(m.id); if (op.invisible) hidden.add(m.id);
        if (!anchor.has(m.id)) anchor.set(m.id, op);
        break;
      }
    }, (im) => {
      if (!pics.length) return;
      if (im.inline) { if (!im.mask) { const m = picAt([[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => apply(im.ctm, x, y))); if (m) { cut.push([im.start, im.end, ' ']); removed.add(m.id); } } return; }
      const o = xo && xo.lookup(PDFName.of(im.name)), sub = subOf(o);
      if (sub === '/Form') { const h = formCut(xo, im.name, im.ctm, 0); if (h) cut.push([im.start, im.end, ` ${h.key} Do `]); return; }
      if (sub !== '/Image' || isMask(o)) return;
      const m = picAt([[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => apply(im.ctm, x, y)));
      if (m) { cut.push([im.start, im.end, ' ']); removed.add(m.id); }
    }, undefined, (g) => pics.length && softMask(pageRes.eg, g, 1));
  } catch (e) { console.warn('content edit: reading the page failed, clipping instead', e); cut.length = 0; removed.clear(); anchor.clear(); ops = null; }
  // The new text of each line found, right after the text object it was in (back in page space there).
  const placed = new Set(), fmt = (n) => +(+n).toFixed(6);
  const ser = (list) => list.map((o) => o.toString()).join('\n');
  [...newOps.keys()].forEach((id, seq) => {
    const m = lines.find((x) => x.id === id);
    const group = m.grp ? lines.filter((x) => x.grp === m.grp) : [m];
    // Text whose original is clipped and covered instead (OCR text over a scan, text in a form) goes on top.
    if (group.some((x) => !removed.has(x.id) || hidden.has(x.id) || x.ocr)) return;
    const op = group.map((x) => anchor.get(x.id)).filter(Boolean).sort((a, b) => a.start - b.start)[0];
    if (!op || !ops) return;
    const at = ops.etEnd[op.bt] ?? op.end, c = op.ctm, det = c[0] * c[3] - c[1] * c[2];
    if (Math.abs(det) < 1e-9) return;
    const id6 = c.every((n, k) => Math.abs(n - [1, 0, 0, 1, 0, 0][k]) < 1e-9);
    const inv = [c[3] / det, -c[1] / det, -c[2] / det, c[0] / det, (c[2] * c[5] - c[3] * c[4]) / det, (c[1] * c[4] - c[0] * c[5]) / det].map(fmt);
    cut.push([at, at, `\nq\n${id6 ? '' : inv.join(' ') + ' cm\n'}${ser(newOps.get(id))}\nQ\n`, seq]);
    placed.add(id);
  });
  if (cut.length) {
    // From the end back; text put at the same place keeps its order.
    cut.sort((a, b) => b[0] - a[0] || (b[3] ?? -1) - (a[3] ?? -1));
    for (const [a, b, keep] of cut) src = src.slice(0, a) + (keep || ' ') + src.slice(b);
    const bytes = new Uint8Array(src.length); for (let i = 0; i < src.length; i++) bytes[i] = src.charCodeAt(i) & 255;
    node.set(PDFName.of('Contents'), out.context.obj([out.context.register(out.context.flateStream(bytes))])); // an array, as pdf-lib expects once the page has new resources
  }
  // 2. Anything not found there (text inside a form, an erased area) is clipped out.
  // Invisible OCR text was removed, but what shows is the scan under it: that is clipped and covered too.
  const visible = (m) => removed.has(m.id) && !hidden.has(m.id) && !m.ocr;
  const clips = edits.filter((m) => (m.type === 'erase') || ((m.type === 'te' || m.type === 'ie') && !visible(m))).map((m) => m.type === 'te' ? lineQuad(m, .3) : m.quad);
  if (clips.length) {
    const f = (n) => (+n).toFixed(3);
    let pre = 'q\n';
    for (const q of clips) pre += `-100000 -100000 m 100000 -100000 l 100000 100000 l -100000 100000 l h ${f(q[0][0])} ${f(q[0][1])} m ${q.slice(1).map((pt) => `${f(pt[0])} ${f(pt[1])} l`).join(' ')} h W* n\n`;
    node.normalize && node.normalize();
    const preRef = out.context.register(out.context.flateStream(pre)), postRef = out.context.register(out.context.flateStream('\nQ\n'));
    node.set(PDFName.of('Contents'), out.context.obj([preRef, ...streamsOf(), postRef]));
  }
  // 3. Paint: the colour that was behind each change, then new pictures, and the text not placed above.
  for (const m of edits) {
    if (m.type === 'ae') continue;
    const q = m.type === 'te' ? lineQuad(m, .3) : m.quad;
    // Taken out of the content, the original leaves what was behind it untouched; clipped, it needs its background.
    if (m.type === 'erase' || !visible(m)) p.pushOperators(O('q'), O('rg', rgbOf(m.bg)), O('m', q[0].map((n) => PDFNumber.of(n))), ...q.slice(1).map((pt) => O('l', pt.map((n) => PDFNumber.of(n)))), O('h'), O('f'), O('Q'));
  }
  for (const m of pics) {
    if (m.deleted || !m.data || !m.mat) continue;
    let im = ctx.images.get(m.data); if (!im) { im = await out.embedPng(m.data); ctx.images.set(m.data, im); }
    const key = node.newXObject('CPDFIm', im.ref);
    p.pushOperators(O('q'), O('cm', m.mat.map((n) => PDFNumber.of(+(+n).toFixed(4)))), O('Do', [key]), O('Q'));
  }
  for (const [id, list] of newOps) if (!placed.has(id)) p.pushOperators(...list);
  void PDFRef; void PDFRawStream; void PDFHexString; void StandardFonts;
}
// An edited line drawn again: in the PDF's own font where it has the letters, else the closest standard font, with
// the original's text state (render mode and outline, character and word spacing; its width scale and rise are in
// its matrix). Returns the operators, in page space.
async function teOps(L, out, node, m, fonts, ctx) {
  const { PDFOperator, PDFNumber, PDFHexString, StandardFonts } = L;
  const O = (name, args = []) => PDFOperator.of(name, args), N = (n) => PDFNumber.of(+(+n).toFixed(4));
  const want = baseName(m.font);
  // The PDF's own font, unless it draws nothing visible (OCR text) or is a Type3 font
  let f = m.ocr || m.type3 || /glyphless/i.test(want) ? null : [...fonts.values()].find((x) => baseName(x.base) === want);
  if (f) {
    // Only letters this font really has: from its ToUnicode, and for a simple font without one, from what pdf.js read.
    const rev = new Map(f.hasToUnicode ? f.rev : []);
    if (!f.type0) for (const [u, code] of Object.entries(m.codes || {})) if (!rev.has(u) && (f.widths.get(code) || 0) > 0) rev.set(u, code);
    f = rev.size ? { ...f, rev } : null;
  }
  const stdName = { sans: 'Helvetica', serif: 'TimesRoman', mono: 'Courier' }[m.fam] + (m.bold && m.italic ? (m.fam === 'serif' ? 'BoldItalic' : 'BoldOblique') : m.bold ? 'Bold' : m.italic ? (m.fam === 'serif' ? 'Italic' : 'Oblique') : '');
  const runs = glyphRuns(m.text, f && f.rev), mixed = runs.some((r) => !r.own) && runs.some((r) => r.own);
  // The original's text state; what else the page set before (invisible text, rise) must not apply to the new line.
  const ops = [O('q'), ...(mixed ? [actualText(L, out, m.text)] : []), ...teStateOps(L, m), O('BT'), O('Tr', [N(m.tr || 0)]), O('Tc', [N(m.tc || 0)]), O('Tw', [N(m.tw || 0)]), O('Tz', [N(100)]), O('Ts', [N(0)]), O('Tm', teAt(m).map(N))];
  for (const r of runs) {
    if (r.own) {
      ops.push(O('Tf', [f.key, N(1)]), O('Tj', [PDFHexString.of(r.chars.map((c) => c.toString(16).padStart(f.bytes * 2, '0')).join(''))]));
    } else {
      let sf = ctx.std.get(stdName); if (!sf) { sf = await out.embedFont(StandardFonts[stdName] || StandardFonts.Helvetica); ctx.std.set(stdName, sf); }
      const key = node.newFontDictionary ? node.newFontDictionary('CPDF', sf.ref) : (() => { throw new Error('no font dictionary'); })();
      let hex; try { hex = sf.encodeText(r.chars.join('')); } catch { hex = sf.encodeText(r.chars.map((c) => (/[\x20-\x7E]/.test(c) ? c : '?')).join('')); }
      ops.push(O('Tf', [key, N(1)]), O('Tj', [hex]));
    }
  }
  ops.push(O('ET'), ...(mixed ? [O('EMC')] : []), O('Q'));
  return ops;
}
// The colours (and, for outlined text, line width) a new line is drawn with.
function teStateOps(L, m) {
  const { PDFOperator, PDFNumber } = L, O = (name, args = []) => PDFOperator.of(name, args);
  const rgb = (hex) => { const n = parseInt(String(hex || '#111111').slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255].map((x) => PDFNumber.of(+x.toFixed(4))); };
  const out = [O('rg', rgb(m.color))];
  if (m.tr === 1 || m.tr === 2) out.push(O('RG', rgb(m.stroke || m.color)), O('w', [PDFNumber.of(+(+(m.lw || 0)).toFixed(4))]));
  return out;
}
// A line split into runs set in the page's own font (`own`, its codes) or in a standard font (the letters). A word
// with any letter the font lacks is set in the standard font as a whole: switching fonts inside a word splits it
// into pieces that readers' search and copy don't put back together.
function glyphRuns(text, rev) {
  const runs = [];
  for (const tok of String(text).match(/\s+|\S+/g) || []) {
    const chars = [...tok], own = !!rev && chars.every((ch) => rev.has(ch)), vals = own ? chars.map((ch) => rev.get(ch)) : chars;
    const last = runs[runs.length - 1];
    if (last && last.own === own) last.chars.push(...vals); else runs.push({ own, chars: vals });
  }
  return runs;
}
// The line's text for readers (copy, search, screen readers), around a line drawn in more than one font.
function actualText(L, out, text) { return L.PDFOperator.of('BDC', [L.PDFName.of('Span'), out.context.obj({ ActualText: L.PDFHexString.fromText(text) })]); }
// Comments from other apps that were deleted or changed.
function saveCommentEdits(L, out, p, marks, same) {
  const edits = marks.filter((m) => m.type === 'ae'); if (!edits.length) return;
  const { PDFName, PDFArray, PDFDict, PDFHexString, PDFRef } = L;
  const annots = p.node.lookup(PDFName.of('Annots')); if (!(annots instanceof PDFArray)) return;
  const refOf = (id) => { const mm = /^(\d+)R(\d*)$/.exec(id || ''); return mm ? [+mm[1], +(mm[2] || 0)] : null; };
  for (let k = annots.size() - 1; k >= 0; k--) {
    const r = annots.get(k), d = out.context.lookup(r); if (!(d instanceof PDFDict)) continue;
    const rect = d.lookup(PDFName.of('Rect')); const rc = rect instanceof PDFArray ? rect.asArray().map((x) => out.context.lookup(x).asNumber()) : null;
    const sub = String(d.lookup(PDFName.of('Subtype')) || '').slice(1);
    const parent = d.get(PDFName.of('Parent'));
    const match = (m) => {
      const id = refOf(m.ref);
      if (same && r instanceof PDFRef && id) return r.objectNumber === id[0] && r.generationNumber === id[1];
      return rc && m.rect && rc.every((n, j) => Math.abs(n - m.rect[j]) < .6) && (!m.subtype || m.subtype === sub);
    };
    const m = edits.find(match);
    // A popup goes with its comment: matched by reference, or in copied pages by its parent's rectangle and type.
    const pd = parent ? out.context.lookup(parent) : null;
    const prc = pd instanceof PDFDict && pd.lookup(PDFName.of('Rect')) instanceof PDFArray ? pd.lookup(PDFName.of('Rect')).asArray().map((x) => out.context.lookup(x).asNumber()) : null;
    const psub = pd instanceof PDFDict ? String(pd.lookup(PDFName.of('Subtype')) || '').slice(1) : '';
    const parentDeleted = !!parent && edits.some((e) => e.deleted && (same && parent instanceof PDFRef ? (() => { const id = refOf(e.ref); return id && parent.objectNumber === id[0]; })() : prc && e.rect && prc.every((n, j) => Math.abs(n - e.rect[j]) < .6) && (!e.subtype || e.subtype === psub)));
    if ((m && m.deleted) || parentDeleted) {
      annots.remove(k);
      // Its words must not stay in the file: drop the object itself, and its popup
      if (r instanceof PDFRef) { const pop = d.get(PDFName.of('Popup')); out.context.delete(r); if (pop instanceof PDFRef) out.context.delete(pop); }
      continue;
    }
    if (m && m.contents != null) { d.set(PDFName.of('Contents'), PDFHexString.fromText(m.contents)); d.delete(PDFName.of('RC')); }
  }
  // Entries left pointing at deleted objects (a popup listed on its own) go too
  for (let k = annots.size() - 1; k >= 0; k--) { const r = annots.get(k); if (r instanceof PDFRef && !out.context.lookup(r)) annots.remove(k); }
}

/* ---------------- signature and pictures ---------------- */
// A signature is drawn, typed (in a handwriting font the system has) or taken from a picture of one. The last three
// used are kept on this device.
const SIG_INKS = [['#13235E', 'Blue'], ['#111111', 'Black']];
const SIG_FONTS = [
  ['Script', '"Snell Roundhand", "Segoe Script", "URW Chancery L", "Z003", "Apple Chancery", "Brush Script MT", cursive'],
  ['Brush', '"Brush Script MT", "Brush Script Std", "Segoe Script", "Z003", cursive'],
  ['Pen', '"Bradley Hand", "Segoe Print", "Comic Neue", "Chalkboard SE", cursive'],
];
const sigSaved = () => { const l = store.get('signatures', null); if (Array.isArray(l)) return l; const one = store.get('signature', null); return one ? [one] : []; };
const sigKeep = (sig) => store.set('signatures', [sig, ...sigSaved().filter((x) => x.data !== sig.data)].slice(0, 3));
function sigUse(sig) { sigKeep(sig); pendingImage = sig; setTool('sign'); toast(placeHint('the signature')); }
async function signature() {
  let mode = 'draw', ink = SIG_INKS[0][0], font = 0, pick = null;
  const saved = sigSaved();
  const tab = (k, t) => `<button type="button" role="tab" data-sig-mode="${k}" aria-selected="${k === 'draw'}" tabindex="${k === 'draw' ? 0 : -1}">${t}</button>`;
  const body = `<div class="sig-modes seg" role="tablist" aria-label="How to sign">${tab('draw', 'Draw')}${tab('type', 'Type')}${tab('upload', 'Picture')}</div>
    <div class="sig-row" data-sig-for="type" hidden><label class="field"><span>Your name</span><input id="sigName" type="text" autocomplete="name" maxlength="60"></label></div>
    <div class="sig-row" data-sig-for="upload" hidden><button type="button" class="btn" id="sigFileBtn">${ic('image-plus')}<span>Choose a picture…</span></button><input type="file" id="sigFile" accept="image/*" hidden><span class="sig-note">A white background becomes see-through.</span></div>
    <canvas class="sig-pad" id="sigPad" width="900" height="320" aria-label="Signature"></canvas>
    <div class="sig-row"><span class="sig-note" id="sigHint">Draw with the mouse, a finger or a pen.</span><span class="sig-opts">
      <span class="sig-fonts" data-sig-for="type" hidden role="group" aria-label="Style">${SIG_FONTS.map(([n, f], k) => `<button type="button" class="sig-font" data-sig-font="${k}" aria-pressed="${k === 0}" style="font-family:${esc(f)}">${n}</button>`).join('')}</span>
      <span class="sig-inks" data-sig-for="draw type" role="group" aria-label="Ink">${SIG_INKS.map(([c, n]) => `<button type="button" class="swatch" data-sig-ink="${c}" style="background:${c}" title="${n}" aria-label="${n}" aria-pressed="${c === ink}"></button>`).join('')}</span></span></div>
    ${saved.length ? `<div class="sig-saved"><span class="sig-note">Saved on this device</span><div class="sig-list">${saved.map((s, k) => `<span class="sig-item"><button type="button" class="sig-use" data-sig-use="${k}" aria-label="Use saved signature ${k + 1}"><img src="${s.data}" alt=""></button><button type="button" class="icon-btn sig-del" data-sig-del="${k}" aria-label="Remove saved signature ${k + 1}" title="Remove">${ic('x')}</button></span>`).join('')}</div></div>` : ''}`;
  const res = await dialog('Signature', body, [{ label: 'Clear', value: 'clear', keep: true }, { label: 'Cancel' }, { label: 'Place', value: 'place', primary: true }], (dlg) => {
    const c = $('#sigPad', dlg), g = c.getContext('2d'), name = $('#sigName', dlg);
    let drawing = false, any = false;
    const clear = () => { g.clearRect(0, 0, c.width, c.height); any = false; };
    const typed = () => {
      clear(); const t = name.value.trim(); if (!t) return;
      let size = 150; g.font = `${size}px ${SIG_FONTS[font][1]}`;
      while (size > 30 && g.measureText(t).width > c.width - 60) { size -= 6; g.font = `${size}px ${SIG_FONTS[font][1]}`; }
      g.fillStyle = ink; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText(t, c.width / 2, c.height / 2); any = true;
    };
    const setMode = (k) => {
      mode = k; clear();
      $$('[data-sig-mode]', dlg).forEach((b) => { b.setAttribute('aria-selected', b.dataset.sigMode === k); b.tabIndex = b.dataset.sigMode === k ? 0 : -1; });
      $$('[data-sig-for]', dlg).forEach((el) => { el.hidden = !el.dataset.sigFor.split(' ').includes(k); });
      $('#sigHint', dlg).textContent = { draw: 'Draw with the mouse, a finger or a pen.', type: 'Type your name, then pick a style.', upload: 'A photo or scan of your signature on white paper.' }[k];
      c.classList.toggle('typed', k !== 'draw');
      if (k === 'type') { typed(); name.focus(); }
    };
    $$('[data-sig-mode]', dlg).forEach((b) => b.onclick = () => setMode(b.dataset.sigMode));
    $('.sig-modes', dlg).addEventListener('keydown', (e) => tabKeys(e, $$('[data-sig-mode]', dlg), (b) => { setMode(b.dataset.sigMode); b.focus(); }));
    const pt = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
    c.onpointerdown = (e) => { if (mode !== 'draw') return; drawing = true; any = true; c.setPointerCapture(e.pointerId); g.lineWidth = 6; g.lineCap = g.lineJoin = 'round'; g.strokeStyle = ink; g.beginPath(); g.moveTo(...pt(e)); };
    c.onpointermove = (e) => { if (drawing) { g.lineTo(...pt(e)); g.stroke(); } };
    c.onpointerup = () => { drawing = false; };
    name.oninput = typed;
    name.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('.dlg-foot .btn.primary', dlg).click(); } };
    $$('[data-sig-font]', dlg).forEach((b) => b.onclick = () => { font = +b.dataset.sigFont; $$('[data-sig-font]', dlg).forEach((x) => x.setAttribute('aria-pressed', x === b)); typed(); });
    $$('[data-sig-ink]', dlg).forEach((b) => b.onclick = () => { ink = b.dataset.sigInk; $$('[data-sig-ink]', dlg).forEach((x) => x.setAttribute('aria-pressed', x === b)); if (mode === 'type') typed(); });
    $('#sigFileBtn', dlg).onclick = () => $('#sigFile', dlg).click();
    $('#sigFile', dlg).onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { clear(); sigFromPicture(c, await sigLoadImage(f)); any = true; } catch { toast('That picture could not be read'); }
    };
    $$('[data-sig-use]', dlg).forEach((b) => b.onclick = () => { pick = saved[+b.dataset.sigUse]; $('.dlg-foot .btn.primary', dlg).click(); });
    $$('[data-sig-del]', dlg).forEach((b) => b.onclick = () => {
      const k = +b.dataset.sigDel, gone = saved[k];
      store.set('signatures', sigSaved().filter((x) => x.data !== gone.data));
      b.closest('.sig-item').remove(); if (!$('.sig-item', dlg)) $('.sig-saved', dlg).remove();
      toast('Signature removed from this device');
    });
    dlg.__clear = () => { clear(); if (mode === 'type') { name.value = ''; name.focus(); } };
    dlg.__get = () => pick || (any ? trimCanvas(c) : null);
    dlg.__empty = () => ({ draw: 'Draw your signature first', type: 'Type your name first', upload: 'Choose a picture first' }[mode]);
  });
  if (res && res.value === 'place' && res.data) sigUse(res.data);
}
function sigLoadImage(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = r.result; }; r.onerror = rej; r.readAsDataURL(file); });
}
// The picture, fitted to the pad, with its white (and near-white) background made transparent.
function sigFromPicture(c, im) {
  const g = c.getContext('2d'), k = Math.min((c.width - 20) / im.naturalWidth, (c.height - 20) / im.naturalHeight);
  const w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k)), x = Math.round((c.width - w) / 2), y = Math.round((c.height - h) / 2);
  g.drawImage(im, x, y, w, h);
  const d = g.getImageData(x, y, w, h), px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const light = Math.min(px[i], px[i + 1], px[i + 2]); // the darkest channel: paper is light in all three
    if (light >= 225) px[i + 3] = 0; else if (light > 160) px[i + 3] = Math.round(px[i + 3] * (225 - light) / 65);
  }
  g.putImageData(d, x, y);
}
function trimCanvas(c) {
  const g = c.getContext('2d'), { width, height } = c, px = g.getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (px[(y * width + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 <= x0) return null;
  const t = document.createElement('canvas'); t.width = x1 - x0 + 12; t.height = y1 - y0 + 12;
  t.getContext('2d').drawImage(c, x0 - 6, y0 - 6, t.width, t.height, 0, 0, t.width, t.height);
  const w = 160, h = w * t.height / t.width;
  return { data: t.toDataURL('image/png'), w, h };
}
$('#imageInput').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
  const img = new Image(); img.src = data; await img.decode();
  // PNG keeps transparency; anything else becomes a PNG so pdf-lib can embed it.
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
  const w = Math.min(240, img.naturalWidth * .75), h = w * img.naturalHeight / img.naturalWidth;
  pendingImage = { data: c.toDataURL('image/png'), w, h };
  setTool('image'); toast(placeHint('the picture'));
});

/* ---------------- pages ---------------- */
function pageOp(fn, layout = true) {
  if (!doc || !doc.pages.length) return;
  const before = snapshot();
  fn();
  changed(before);
  if (layout) layoutPages(true).then(renderSide);
}
const rotatePage = (d) => pageOp(() => { const e = doc.pages[current]; e.rot = (e.rot + d + 360) % 360; });
const rotateAll = (d) => pageOp(() => doc.pages.forEach((e) => { e.rot = (e.rot + d + 360) % 360; }));
// Page moves and deletes are read out (the pages change under a screen reader's cursor without a word otherwise).
// `idx`: the pages moved (indexes before the move); `to`: where the first of them is now.
function pagesMoved(idx, to, together = true) { if (doc) announce(idx.length === 1 ? `Page ${idx[0] + 1} moved to ${to + 1}` : `${idx.length} pages moved${together ? ` to ${to + 1}-${to + idx.length}` : ''}`); }
function pagesDeleted(n) { if (doc) announce(`${n.length === 1 ? `Page ${n[0] + 1}` : `${n.length} pages`} deleted. ${doc.pages.length} left.`); }
const deletePage = () => { const n = current; pageOp(() => { doc.pages.splice(current, 1); current = Math.min(current, doc.pages.length - 1); }); pagesDeleted([n]); };
const movePage = (d) => { const t = current + d, n = current; if (!doc || t < 0 || t >= doc.pages.length) return; pageOp(() => { const [e] = doc.pages.splice(current, 1); doc.pages.splice(t, 0, e); current = t; }); pagesMoved([n], t); };
const duplicatePage = () => pageOp(() => { const e = doc.pages[current]; doc.pages.splice(current + 1, 0, { ...e }); current++; });
async function insertBlank() {
  const L = await loadPdfLib();
  const base = await (await pageOf(doc.pages[current])).getViewport({ scale: 1 });
  const pdf = await L.PDFDocument.create(); pdf.addPage([base.width, base.height]);
  const bytes = await pdf.save();
  await addSource(bytes, [0], current + 1);
}
async function addSource(bytes, indexes, at, name) {
  if (!doc) return false;
  let pd;
  try { pd = await loadProtected(bytes, name || 'this PDF'); }
  catch (e) { console.error(e); toast(`Could not add ${name || 'that file'}: it may not be a PDF.`); return false; }
  if (!pd) return false;
  const k = doc.sources.length;
  pageOp(() => {
    doc.sources.push(bytes); pdfDocs.set(k, pd);
    const ins = (indexes || [...Array(pd.numPages).keys()]).map((i) => ({ src: k, i, rot: 0 }));
    doc.pages.splice(at == null ? doc.pages.length : at, 0, ...ins);
  });
  return true;
}
$('#mergeInput').addEventListener('change', (e) => {
  const files = [...e.target.files]; e.target.value = '';
  serial(() => openOrAdd(files, !doc));
});
// Opens the first file (when asked) and adds the rest at the end. Stops if the first one doesn't open.
async function openOrAdd(files, openFirst) {
  if (!files.length) return;
  if (openFirst) { const f = files.shift(); if (!(await openBytes(new Uint8Array(await f.arrayBuffer()), f.name))) return; }
  let added = [];
  for (const f of files) if (await addSource(new Uint8Array(await f.arrayBuffer()), null, null, f.name)) added.push(f.name);
  if (added.length) toast(`Added ${added.length === 1 ? added[0] : added.length + ' PDFs'} at the end`);
}
async function extractPages() {
  const ans = await askText('Extract pages', `Which pages? For example 1-3, 5. This PDF has ${doc.pages.length}.`, String(current + 1), 'Extract');
  if (!ans) return;
  const want = parseRange(ans, doc.pages.length);
  if (!want.length) { toast('No pages in that range'); return; }
  try {
    const bytes = await buildPdf(want);
    if (bytes) await saveFile(bytes, `${doc.name} (pages ${ans.replace(/\s+/g, '')}).pdf`, 'application/pdf');
  } catch (e) { console.error(e); toast(`Could not extract the pages: ${e.message || e}`); }
}
function parseRange(s, max) {
  const out = [];
  for (const part of s.split(/[,;]\s*/)) {
    const m = part.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/); if (!m) continue;
    let a = +m[1], b = m[2] ? +m[2] : a; if (a > b) [a, b] = [b, a];
    for (let n = Math.max(1, a); n <= Math.min(max, b); n++) out.push(n - 1);
  }
  return [...new Set(out)];
}

/* ---------------- saving ----------------
   The original PDF is kept (bookmarks, forms, links, metadata) and the mark-up is added to it. When pages were
   deleted, moved or added, its pages are put in the new order and pages from other PDFs are copied in. Highlights, drawings, boxes, text and
   signatures are drawn into the page so every reader shows them; notes are real PDF comments. */
// The page for each entry, in order. Pages of `base` (a loaded source used as the saved PDF) are its own pages; others
// are copied with one copyPages call per source, so the copies share fonts and pictures. A page used twice is copied
// again in a later call, so each use is a page of its own.
async function savePagesFor(out, loaded, entries, base) {
  const bySrc = new Map(), got = new Map();
  for (const e of entries) { const m = bySrc.get(e.src) || new Map(); m.set(e.i, (m.get(e.i) || 0) + 1); bySrc.set(e.src, m); }
  for (const [k, counts] of bySrc) {
    const own = k === base ? out.getPages() : null;
    for (let r = 0; ; r++) {
      const idx = [...counts].filter(([, n]) => n > r).map(([i]) => i); if (!idx.length) break;
      const pgs = r === 0 && own ? idx.map((i) => own[i]) : await out.copyPages(loaded[k], idx);
      idx.forEach((i, j) => { const key = k + ':' + i; if (!got.has(key)) got.set(key, []); got.get(key).push(pgs[j]); });
    }
  }
  return entries.map((e) => got.get(e.src + ':' + e.i).shift());
}
// Makes `list` the document's pages, in that order, directly under the page tree's root. What a page took from the
// tree above it (resources, size, rotation) is written on the page first. Pages left out are deleted.
function saveSetPageTree(L, out, list) {
  const { PDFName, PDFArray, PDFDict, PDFRef, PDFNumber } = L, c = out.context, N = (k) => PDFName.of(k);
  for (const p of list) for (const k of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) {
    if (p.node.get(N(k))) continue;
    const v = p.node.getInheritableAttribute(N(k)); if (v) p.node.set(N(k), v);
  }
  const rootRef = out.catalog.get(N('Pages')), root = out.catalog.Pages(), keep = new Set(list.map((p) => p.ref.tag)), seen = new Set();
  const walk = (node) => {
    const kids = node.lookup(N('Kids')); if (!(kids instanceof PDFArray)) return;
    for (const r of kids.asArray()) {
      if (!(r instanceof PDFRef) || seen.has(r.tag)) continue; seen.add(r.tag);
      const d = c.lookup(r); if (!(d instanceof PDFDict)) continue;
      if (d.get(N('Kids'))) { walk(d); c.delete(r); } else if (!keep.has(r.tag)) c.delete(r);
    }
  };
  walk(root);
  root.set(N('Kids'), c.obj(list.map((p) => p.ref))); root.set(N('Count'), PDFNumber.of(list.length));
  for (const p of list) p.node.set(N('Parent'), rootRef);
  out.pageCount = undefined; out.pageCache.invalidate();
}
// Bookmarks and named destinations that go to a page no longer in the PDF are removed (a bookmark with bookmarks
// under it stays, without a target). `keep` holds the tags of the saved pages.
function saveDropDeadDests(L, out, keep) {
  const { PDFName, PDFArray, PDFDict, PDFRef, PDFNumber, PDFString, PDFHexString } = L, c = out.context, N = (k) => PDFName.of(k);
  const look = (o) => o instanceof PDFRef ? c.lookup(o) : o;
  const keyOf = (o) => o instanceof PDFName ? o.decodeText() : o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : null;
  const gone = (d) => {
    d = look(d); if (d instanceof PDFDict) d = look(d.get(N('D')));
    if (!(d instanceof PDFArray) || !d.size()) return false;
    const pg = d.get(0); return pg instanceof PDFRef && !keep.has(pg.tag);
  };
  // Named destinations, read before any is removed so bookmarks that use them can be checked.
  const named = new Map(), cat = out.catalog;
  const old = look(cat.get(N('Dests')));
  if (old instanceof PDFDict) for (const [k, v] of old.entries()) named.set(k.decodeText(), v);
  const names = look(cat.get(N('Names'))), tree = names instanceof PDFDict ? look(names.get(N('Dests'))) : null;
  const leaves = (node, fn, seen = new Set()) => {
    if (!(node instanceof PDFDict) || seen.has(node)) return; seen.add(node);
    const arr = look(node.get(N('Names'))); if (arr instanceof PDFArray) fn(arr);
    const kids = look(node.get(N('Kids'))); if (kids instanceof PDFArray) for (const r of kids.asArray()) leaves(look(r), fn, seen);
  };
  leaves(tree, (arr) => { for (let k = 0; k + 1 < arr.size(); k += 2) { const n = keyOf(look(arr.get(k))); if (n != null) named.set(n, arr.get(k + 1)); } });
  const target = (d) => { d = look(d); const n = keyOf(d); return n != null ? named.get(n) : d; };
  // Bookmarks
  const outlines = look(cat.get(N('Outlines')));
  const seen = new Set();
  const prune = (parent) => { // returns how many bookmarks show under `parent` when it is open
    const kids = []; let r = parent.get(N('First'));
    while (r instanceof PDFRef && !seen.has(r.tag)) { seen.add(r.tag); const it = c.lookup(r); if (!(it instanceof PDFDict)) break; kids.push([r, it]); r = it.get(N('Next')); }
    const kept = []; let shown = 0;
    for (const [ref, it] of kids) {
      const was = it.lookup(N('Count')), open = !(was instanceof PDFNumber) || was.asNumber() > 0;
      const under = prune(it);
      const a = look(it.get(N('A')));
      const d = it.get(N('Dest')) || (a instanceof PDFDict && String(a.get(N('S'))) === '/GoTo' ? a.get(N('D')) : null);
      if (d && gone(target(d))) {
        if (!it.get(N('First'))) { c.delete(ref); continue; }
        it.delete(N('Dest')); if (a) it.delete(N('A'));
      }
      if (it.get(N('First'))) it.set(N('Count'), PDFNumber.of(open ? under : -under)); else it.delete(N('Count'));
      kept.push([ref, it]); shown += 1 + (open ? under : 0);
    }
    kept.forEach(([, it], j) => {
      if (j) it.set(N('Prev'), kept[j - 1][0]); else it.delete(N('Prev'));
      if (j < kept.length - 1) it.set(N('Next'), kept[j + 1][0]); else it.delete(N('Next'));
    });
    if (kept.length) { parent.set(N('First'), kept[0][0]); parent.set(N('Last'), kept[kept.length - 1][0]); }
    else { parent.delete(N('First')); parent.delete(N('Last')); }
    return shown;
  };
  if (outlines instanceof PDFDict) {
    const shown = prune(outlines);
    if (outlines.get(N('First'))) outlines.set(N('Count'), PDFNumber.of(shown)); else cat.delete(N('Outlines'));
  }
  // Named destinations themselves
  if (old instanceof PDFDict) for (const [k, v] of old.entries()) if (gone(v)) old.delete(k);
  const fixTree = (node, seen = new Set()) => { // returns [first, last] name of what is left under node, or null
    if (!(node instanceof PDFDict) || seen.has(node)) return null; seen.add(node);
    let lo = null, hi = null;
    const arr = look(node.get(N('Names')));
    if (arr instanceof PDFArray) {
      for (let k = arr.size() - 2; k >= 0; k -= 2) if (gone(arr.get(k + 1))) { arr.remove(k + 1); arr.remove(k); }
      if (arr.size()) { lo = arr.get(0); hi = arr.get(arr.size() - 2); }
    }
    const kids = look(node.get(N('Kids')));
    if (kids instanceof PDFArray) for (let k = kids.size() - 1; k >= 0; k--) {
      const got = fixTree(look(kids.get(k)), seen);
      if (!got) { kids.remove(k); continue; }
      if (!hi) hi = got[1]; lo = got[0];
    }
    if (!lo) return null;
    if (node.get(N('Limits'))) node.set(N('Limits'), c.obj([lo, hi]));
    return [lo, hi];
  };
  if (tree instanceof PDFDict && !fixTree(tree)) { tree.delete(N('Kids')); tree.set(N('Names'), c.obj([])); }
}
// Objects nothing in the saved PDF refers to any more (deleted pages and what only they used) are dropped.
function saveDropUnused(L, out) {
  const { PDFRef, PDFDict, PDFArray } = L, seen = new Set(), stack = [];
  const visit = (o) => {
    if (!o) return;
    if (o instanceof PDFRef) { if (seen.has(o.tag)) return; seen.add(o.tag); const t = out.context.lookup(o); if (t) stack.push(t); return; }
    if (o instanceof PDFDict) { for (const [, v] of o.entries()) visit(v); return; }
    if (o instanceof PDFArray) { for (const v of o.asArray()) visit(v); return; }
    if (o.dict instanceof PDFDict) visit(o.dict);
  };
  const t = out.context.trailerInfo; visit(t.Root); visit(t.Info); visit(t.Encrypt);
  while (stack.length) visit(stack.pop());
  for (const [ref] of out.context.enumerateIndirectObjects()) if (!seen.has(ref.tag)) out.context.delete(ref);
}
// Returns null if the person cancels the password question.
async function buildPdf(only) {
  const L = await loadPdfLib();
  // Only protected files whose pages are still in the document count.
  const used = new Set(doc.pages.map((e) => e.src));
  const protKey = [...used].find((k) => doc.sources[k].password);
  const pw = protKey == null ? null : doc.sources[protKey].password;
  if (pw && doc.keepPassword == null) {
    const whose = protKey === 0 ? `${esc(doc.name)} is protected with a password.` : 'Some pages come from a PDF protected with a password.';
    const a = await dialog('Keep the password?', `<p>${whose} Should the saved PDF need the same password to open?</p>`, [{ label: 'Cancel' }, { label: 'Remove password', value: 'remove' }, { label: 'Keep password', value: 'keep', primary: true }]);
    if (!a) return null;
    doc.keepPassword = a === 'keep';
  }
  const { PDFDocument, degrees, rgb, StandardFonts, BlendMode, LineCapStyle, PDFName, PDFString, PDFHexString } = L;
  // Form values typed into the page are written by pdf.js into a copy of each source first.
  const bytes = await Promise.all(doc.sources.map(async (b, k) => {
    const pd = pdfDocs.get(k);
    try { if (pd.annotationStorage.size) return await pd.saveDocument(); } catch {}
    return b;
  }));
  // Protected sources are opened with their password, so what is saved is readable (pdf-lib can't save them otherwise).
  const loaded = await Promise.all(bytes.map(async (b, k) => {
    if (doc.sources[k].password) return PDFDocument.load(b, { password: doc.sources[k].password, updateMetadata: false });
    const d = await PDFDocument.load(b, { ignoreEncryption: true, updateMetadata: false });
    if (!d.isEncrypted) return d;
    // Encrypted with only an owner password (it opens without one, but has restrictions): decrypt to save it,
    // then encrypt again below with the same restrictions.
    try { const dd = await PDFDocument.load(b, { password: '', updateMetadata: false }); doc.sources[k].ownerOnly = true; return dd; } catch { return d; }
  }));
  const entries = only ? only.map((n) => doc.pages[n]) : doc.pages;
  // Every page of one source, in order (the opened file, or a copy of it made by a feature such as OCR): keep that file.
  const s0 = entries.length ? entries[0].src : 0;
  const same = !only && entries.length === loaded[s0].getPageCount() && entries.every((e, n) => e.src === s0 && e.i === n);
  let out, pages;
  if (same) { out = loaded[s0]; pages = out.getPages(); }
  else if (only || !entries.length) {
    // Extract: a new PDF with copies of the pages (one copy per source, so pages share their fonts and pictures).
    out = await PDFDocument.create();
    pages = await savePagesFor(out, loaded, entries, -1);
    for (const p of pages) out.addPage(p);
  } else {
    // Pages deleted, moved, added or merged: the opened file is kept (bookmarks, form, metadata, attachments) and its
    // pages are put in the new order. Pages from other PDFs are copied in, one copy per source.
    const n0 = entries.filter((e) => e.src === 0).length, count = new Map();
    for (const e of entries) count.set(e.src, (count.get(e.src) || 0) + 1);
    const base = n0 ? 0 : [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    out = loaded[base];
    const list = await savePagesFor(out, loaded, entries, base);
    saveSetPageTree(L, out, list);
    pages = out.getPages();
    saveDropDeadDests(L, out, new Set(pages.map((p) => p.ref.tag)));
  }
  const font = await out.embedFont(StandardFonts.Helvetica);
  const col = (hex) => { const n = parseInt(hex.slice(1), 16); return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
  const vec = (r) => { const a = r * Math.PI / 180; return { right: [Math.cos(a), Math.sin(a)], down: [Math.sin(a), -Math.cos(a)] }; };
  const imgCache = new Map(), editCtx = { images: imgCache, std: new Map() };
  for (let n = 0; n < entries.length; n++) {
    const e = entries[n], p = pages[n];
    if (e.rot) p.setRotation(degrees((p.getRotation().angle + e.rot) % 360));
    const pageMarks = doc.marks[pageKey(e)] || [];
    // Changes to the PDF's own content first (they replace what was there), then the mark-up on top.
    await saveContentEdits(L, out, p, pageMarks, editCtx);
    saveCommentEdits(L, out, p, pageMarks, same);
    const fm = (m) => FEATURE.markTypes[m.type];
    for (const m of pageMarks.filter((x) => fm(x) && fm(x).under && fm(x).save)) await fm(m).save({ L, out, p, m, entry: e, ctx: editCtx });
    for (const m of pageMarks) {
      if (CONTENT_TYPES.has(m.type)) continue;
      if (fm(m)) { if (!fm(m).under && fm(m).save) await fm(m).save({ L, out, p, m, entry: e, ctx: editCtx }); continue; }
      if (m.type === 'hl') for (const r of m.rects) p.drawRectangle({ x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]), width: Math.abs(r[2] - r[0]), height: Math.abs(r[3] - r[1]), color: col(m.color), opacity: .4, blendMode: BlendMode.Multiply });
      if (m.type === 'ink') for (let k = 1; k < m.pts.length; k++) p.drawLine({ start: { x: m.pts[k - 1][0], y: m.pts[k - 1][1] }, end: { x: m.pts[k][0], y: m.pts[k][1] }, thickness: m.w, color: col(m.color), lineCap: LineCapStyle.Round });
      if (m.type === 'rect') p.drawRectangle({ x: Math.min(m.x1, m.x2), y: Math.min(m.y1, m.y2), width: Math.abs(m.x2 - m.x1), height: Math.abs(m.y2 - m.y1), borderColor: col(m.color), borderWidth: m.w });
      if (m.type === 'text') {
        const { down } = vec(m.rot);
        m.text.split('\n').forEach((line, k) => {
          const off = m.size * (.85 + k * 1.2);
          const safe = [...line].map((c) => (font.encodeText ? c : c)).join('');
          try { p.drawText(safe, { x: m.x + down[0] * off, y: m.y + down[1] * off, size: m.size, font, color: col(m.color), rotate: degrees(m.rot) }); }
          catch { p.drawText(safe.replace(/[^\x20-\x7E]/g, '?'), { x: m.x + down[0] * off, y: m.y + down[1] * off, size: m.size, font, color: col(m.color), rotate: degrees(m.rot) }); }
        });
      }
      if (m.type === 'img') {
        let im = imgCache.get(m.data);
        if (!im) { im = await out.embedPng(m.data); imgCache.set(m.data, im); }
        const { down } = vec(m.rot);
        p.drawImage(im, { x: m.x + down[0] * m.h, y: m.y + down[1] * m.h, width: m.w, height: m.h, rotate: degrees(m.rot) });
      }
      if (m.type === 'note') {
        const annot = out.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [m.x, m.y - 22, m.x + 22, m.y], Contents: PDFHexString.fromText(m.text), Name: 'Comment', C: [1, .83, .23], ...((m.author || S.author) ? { T: PDFHexString.fromText(m.author || S.author) } : {}), F: 4, Open: false });
        annot.set(PDFName.of('NM'), PDFString.of('cpdf-' + m.id)); // replies find their note by it
        const ref = out.context.register(annot);
        let annots = p.node.lookup(PDFName.of('Annots'));
        if (!annots) { annots = out.context.obj([]); p.node.set(PDFName.of('Annots'), annots); }
        annots.push(ref);
      }
    }
    for (const h of FEATURE.savePage) await h({ L, out, p, entry: e, n, entries, marks: pageMarks, ctx: editCtx });
    for (const h of FEATURE.savePageLate) await h({ L, out, p, entry: e, n, entries, marks: pageMarks, ctx: editCtx });
  }
  for (const h of FEATURE.saveDoc) await h({ L, out, pages, entries, ctx: editCtx });
  if (!same) saveDropUnused(L, out); // deleted pages (and what only they used) are not written
  if (out.getTitle() === undefined) out.setTitle(doc.name); // keep the PDF's own title (or the one set in Document properties)
  out.setProducer('Cowdrey.PDF ' + VERSION + ' (bradcowdrey.com)'); out.setModificationDate(new Date());
  void PDFString;
  const ownerOnlyKey = doc.sources.findIndex((s0) => s0.ownerOnly);
  if (!(pw && doc.keepPassword) && ownerOnlyKey >= 0 && out.encrypt) {
    let flags = null; try { const f0 = await pdfDocs.get(ownerOnlyKey).getPermissions(); flags = f0 ? [...f0] : null; } catch {}
    const F = pdfjs.PermissionFlag || {}; const can = (f) => !flags || flags.includes(f);
    if (flags) out.encrypt({ userPassword: '', ownerPassword: uid() + uid(), permissions: { printing: can(F.PRINT) ? (can(F.PRINT_HIGH_QUALITY) ? 'highResolution' : 'lowResolution') : false, modifying: can(F.MODIFY_CONTENTS), copying: can(F.COPY), annotating: can(F.MODIFY_ANNOTATIONS), fillingForms: can(F.FILL_INTERACTIVE_FORMS), contentAccessibility: can(F.COPY_FOR_ACCESSIBILITY), documentAssembly: can(F.ASSEMBLE) } });
  }
  if (pw && doc.keepPassword && out.encrypt) {
    // Keep what the original allowed (printing, copying, changes). With any restriction, the owner password is a new
    // random one, so the open password doesn't lift the restrictions.
    let flags = null; try { const f = await pdfDocs.get(protKey).getPermissions(); flags = f ? [...f] : null; } catch {}
    const F = pdfjs.PermissionFlag || {}; const can = (f) => !flags || flags.includes(f);
    const permissions = { printing: can(F.PRINT) ? (can(F.PRINT_HIGH_QUALITY) ? 'highResolution' : 'lowResolution') : false, modifying: can(F.MODIFY_CONTENTS), copying: can(F.COPY), annotating: can(F.MODIFY_ANNOTATIONS), fillingForms: can(F.FILL_INTERACTIVE_FORMS), contentAccessibility: can(F.COPY_FOR_ACCESSIBILITY), documentAssembly: can(F.ASSEMBLE) };
    out.encrypt({ userPassword: pw, ownerPassword: flags ? uid() + uid() : pw, permissions });
  }
  return out.save();
}
function download(bytes, name, type = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const toBytes = (data) => typeof data === 'string' ? new TextEncoder().encode(data) : data;
// A file name the share sheet and file:// addresses accept as is.
const safeName = (name) => name.replace(/[\/\\:#?%*"<>|]+/g, '-').trim() || 'Document.pdf';
function shareAnchor() {
  const b = $('#saveBtn'); const r = b ? b.getBoundingClientRect() : { left: innerWidth / 2, bottom: 0, width: 0 };
  return { x: r.left + r.width / 2, y: r.bottom, preferredEdge: 'bottom' };
}
// The share sheet (iPhone, iPad, Android) or share menu (Mac): Save to Files, Drive, Mail, AirDrop, Messages, Print.
async function shareFile(data, name, type) {
  name = safeName(name);
  const path = await NATIVE.core.invoke('write_share_file', { name, contents: '', base64: bytesToB64(toBytes(data)) });
  const url = MAC_APP ? path : 'file://' + (ANDROID_APP ? path : encodeURI(path));
  await NATIVE.core.invoke('plugin:sharekit|share_file', { url, mimeType: type, title: name, ...(MAC_APP ? { position: shareAnchor() } : {}) });
}
// Saves a new file (an export, extracted pages, a copy): a save dialog on the Mac, the share sheet on phones,
// a download on the web. Returns the Mac path, true, or false when cancelled.
async function saveFile(data, name, type) {
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [, 'pdf'])[1];
  if (MAC_APP) {
    const target = await MAC_APP.dialog.save({ defaultPath: safeName(name), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!target) return false;
    await MAC_APP.core.invoke('write_binary_file', { path: target, base64: bytesToB64(toBytes(data)) });
    toast(`Saved ${target.split('/').pop()}`);
    return target;
  }
  if (NATIVE) { await shareFile(data, name, type); return true; }
  download(toBytes(data), name, type);
  return true;
}
const fileTime = async (path) => { try { return await MAC_APP.core.invoke('file_modified', { path }); } catch { return 0; } };
// Saves over the file the document came from (Mac), after checking nobody else changed it since.
async function nativeSave(bytes, copy) {
  const name = doc.name + (copy ? ' (copy)' : '') + '.pdf';
  if (MAC_APP) {
    let target = !copy && doc.path;
    if (target && doc.mtime) {
      const now = await fileTime(target);
      if (now && now !== doc.mtime) {
        const a = await dialog('This file changed', `<p>${esc(target.split('/').pop())} was changed by another app after you opened it here. Replacing it loses those changes.</p>`, [{ label: 'Cancel' }, { label: 'Save as new file…', value: 'new' }, { label: 'Replace', value: 'replace', danger: true }]);
        if (!a) return false;
        if (a === 'new') target = null;
      }
    }
    if (!target) target = await MAC_APP.dialog.save({ defaultPath: safeName(name), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!target) return false;
    await MAC_APP.core.invoke('write_binary_file', { path: target, base64: bytesToB64(bytes) });
    if (!copy) { doc.path = target; doc.name = target.split('/').pop().replace(/\.pdf$/i, ''); doc.mtime = await fileTime(target); setTitle(); persist(); }
    toast(`Saved ${target.split('/').pop()}`);
    return true;
  }
  // iPhone, iPad and Android: the share sheet offers Save to Files, Drive, Mail, AirDrop and the rest.
  await shareFile(bytes, name, 'application/pdf');
  return true;
}
async function savePdf(copy) {
  if (!doc) return false;
  try {
    const bytes = await buildPdf();
    if (!bytes) return false;
    if (NATIVE) {
      if (!(await nativeSave(bytes, copy))) return false;
      if (!copy) setSaved(true); // a copy leaves the document's own file as it was
      window.__lastSaved = bytes; return true;
    }
    if (doc.handle && !copy && doc.handle.createWritable) {
      const w = await doc.handle.createWritable(); await w.write(bytes); await w.close();
      toast(`Saved ${doc.name}.pdf`);
    } else if (!copy && window.showSaveFilePicker) {
      try {
        const h = await window.showSaveFilePicker({ suggestedName: doc.name + '.pdf', types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
        const w = await h.createWritable(); await w.write(bytes); await w.close(); doc.handle = h; toast(`Saved ${h.name}`);
      } catch (e) { if (e && e.name === 'AbortError') return false; download(bytes, doc.name + '.pdf'); }
    } else download(bytes, doc.name + (copy ? ' (copy)' : '') + '.pdf');
    if (!copy) setSaved(true);
    window.__lastSaved = bytes; return true;
  } catch (e) { console.error(e); toast(`Could not save: ${e.message || e}`); return false; }
}
async function sharePdf() {
  if (!doc) return;
  try { const bytes = await buildPdf(); if (bytes) await shareFile(bytes, doc.name + '.pdf', 'application/pdf'); }
  catch (e) { console.error(e); toast(`Could not share: ${e.message || e}`); }
}
async function exportImage() {
  const v = views[current]; if (!v) return;
  const vp = v.page.getViewport({ scale: 2, rotation: totalRot(v) });
  const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
  await v.page.render({ canvas: c, canvasContext: c.getContext('2d'), viewport: vp }).promise;
  const png = await new Promise((res) => c.toBlob(res, 'image/png'));
  try { await saveFile(new Uint8Array(await png.arrayBuffer()), `${doc.name} page ${current + 1}.png`, 'image/png'); }
  catch (e) { console.error(e); toast(`Could not export the page: ${e.message || e}`); }
}
async function exportText() {
  const parts = [];
  for (const e of doc.pages) { const tc = await (await pageOf(e)).getTextContent(); parts.push(tc.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join('')); }
  try { await saveFile(parts.join('\n\n'), doc.name + '.txt', 'text/plain'); }
  catch (e) { console.error(e); toast(`Could not export the text: ${e.message || e}`); }
}
async function printDoc() {
  keepPages = true; // every page stays drawn until printing is done
  for (const v of views) await renderView(v);
  try {
    // The apps' web views ignore window.print(): the Mac app and the phone apps open the system print dialog themselves.
    if (MAC_APP) await MAC_APP.core.invoke('print_page');
    else if (MOBILE_APP) await NATIVE.core.invoke('plugin:sharekit|native', { method: 'printPage', args: { title: doc.name } });
    else window.print();
  } catch (e) { toast(`Could not print: ${e.message || e}`); }
  finally { keepPages = false; }
}

/* ---------------- find ---------------- */
const findState = { q: '', hits: [], now: -1, texts: new Map() };
async function textOf(entry) {
  const k = pageKey(entry);
  if (!findState.texts.has(k)) findState.texts.set(k, await (await pageOf(entry)).getTextContent());
  return findState.texts.get(k);
}
// A page's text as one string, each letter mapped back to its piece of text ([item, letter]; null for a space or line
// break put between pieces), so a phrase split across pieces ('U' + 'ser Guide') is found too.
function findIndexOf(tc) {
  if (tc.findIndex) return tc.findIndex;
  let s = ''; const map = []; let prev = null;
  tc.items.forEach((it, idx) => {
    if (!it.str || !it.transform) { if (it.hasEOL) { s += '\n'; map.push(null); prev = null; } return; }
    if (prev && !/\s$/.test(s) && !/^\s/.test(it.str)) {
      const f = lineFrame({ tm: prev.transform }), dx = it.transform[4] - f.o[0], dy = it.transform[5] - f.o[1];
      const along = dx * f.u[0] + dy * f.u[1], perp = dx * f.v[0] + dy * f.v[1];
      if (Math.abs(perp) > f.size * .3 || along - prev.width > f.size * .25 || along < prev.width - f.size) { s += ' '; map.push(null); }
    }
    for (let j = 0; j < it.str.length; j++) map.push([idx, j]);
    s += it.str; prev = it;
    if (it.hasEOL) { s += '\n'; map.push(null); prev = null; }
  });
  return (tc.findIndex = { s, map });
}
const findOpts = { matchCase: false, words: false };
function findRegex(q) {
  const body = q.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(findOpts.words ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body, 'gu' + (findOpts.matchCase ? '' : 'i'));
}
let findGen = 0;
async function runFind(q) {
  const gen = ++findGen;
  findState.q = q; findState.hits = []; findState.now = -1;
  $$('.find-hit').forEach((h) => h.remove());
  if (!q || !doc) { $('#findCount').textContent = ''; findListDraw(); return; }
  const rx = findRegex(q), hits = [];
  for (let n = 0; n < doc.pages.length; n++) {
    const tc = await textOf(doc.pages[n]);
    if (gen !== findGen) return;
    const { s: text, map } = findIndexOf(tc);
    rx.lastIndex = 0;
    for (let m; (m = rx.exec(text));) {
      if (!m[0].length) { rx.lastIndex++; continue; }
      // The match's letters, in runs on the same piece of text: one box each.
      const parts = [];
      for (let k = m.index; k < m.index + m[0].length; k++) {
        const c = map[k]; if (!c) continue;
        const last = parts[parts.length - 1];
        if (last && last[0] === c[0] && last[1] + last[2] === c[1]) last[2]++; else parts.push([c[0], c[1], 1]);
      }
      if (parts.length) hits.push({ n, at: m.index, len: m[0].length, parts });
    }
  }
  findState.hits = hits;
  $('#findCount').textContent = hits.length ? `0 of ${hits.length}` : 'No matches';
  views.forEach((v) => v.rendered && paintFind(v));
  findListDraw();
  // From the page in view onwards
  if (hits.length) { const k = hits.findIndex((h) => h.n >= current); findState.now = (k < 0 ? 0 : k) - 1; stepFind(1); }
}
// A box for each run of a match on its piece of text, in the page's coordinates as shown.
function findBoxes(v, h) {
  const tc = findState.texts.get(pageKey(v.entry)); if (!tc) return [];
  return h.parts.map(([idx, p, len]) => {
    const it = tc.items[idx];
    const t = pdfjs.Util.transform(v.viewport.transform, it.transform);
    const fh = Math.hypot(t[2], t[3]), w = it.width * v.viewport.scale, per = it.str.length ? w / it.str.length : 0;
    return { x: t[4] + per * p, y: t[5] - fh, w: Math.max(4, per * len), h: fh * 1.15 };
  });
}
function paintFind(v) {
  $$('.find-hit', v.el).forEach((h) => h.remove());
  const n = views.indexOf(v);
  findState.hits.forEach((h, k) => {
    if (h.n !== n) return;
    for (const b of findBoxes(v, h)) {
      const el = document.createElement('div'); el.className = 'find-hit' + (k === findState.now ? ' now' : '');
      el.style.left = b.x + 'px'; el.style.top = b.y + 'px'; el.style.width = b.w + 'px'; el.style.height = b.h + 'px';
      v.el.appendChild(el);
    }
  });
}
function stepFind(d, to) {
  if (!findState.hits.length) return;
  findState.now = to ?? (findState.now + d + findState.hits.length) % findState.hits.length;
  const h = findState.hits[findState.now], v = views[h.n];
  $('#findCount').textContent = `${findState.now + 1} of ${findState.hits.length}`;
  goPage(h.n, true);
  // The match in the middle of the view (not just its page's top, where it may be out of sight).
  const b = findBoxes(v, h)[0];
  if (b) {
    const top = v.el.offsetTop + b.y + b.h / 2 - viewer.clientHeight / 2, left = v.el.offsetLeft + b.x + b.w / 2 - viewer.clientWidth / 2;
    viewer.scrollTo({ top: Math.max(0, top), left: viewer.scrollWidth > viewer.clientWidth ? Math.max(0, left) : 0, behavior: 'instant' });
  }
  const inList = $('#findList').contains(document.activeElement);
  $$('#findList [data-hit]').forEach((x) => { const on = +x.dataset.hit === findState.now; x.setAttribute('aria-current', on ? 'true' : 'false'); x.setAttribute('aria-selected', on); if (!inList) x.tabIndex = on ? 0 : -1; if (on) x.scrollIntoView({ block: 'nearest' }); });
  renderView(v).then(() => views.forEach((x) => x.rendered && paintFind(x)));
}
// All results: each match with its page and the words around it; choosing one goes to it. A list box: one Tab stop
// (the match in view), the arrows, Home and End move, Enter or a click goes to the match.
const FIND_LIST_MAX = 500;
function findListDraw() {
  const list = $('#findList'); if (!list || list.hidden) return;
  const hits = findState.hits;
  if (!findState.q) { list.innerHTML = '<p class="find-none">Type to search.</p>'; return; }
  if (!hits.length) { list.innerHTML = '<p class="find-none">No matches</p>'; return; }
  const row = (h, k) => {
    const tc = findState.texts.get(pageKey(doc.pages[h.n])), s = tc ? findIndexOf(tc).s : '';
    const flat = (x) => esc(x.replace(/\s+/g, ' '));
    const a = Math.max(0, h.at - 40), b = Math.min(s.length, h.at + h.len + 40);
    const before = s.slice(a, h.at).replace(/^\S*\s/, a ? '' : '$&'), after = s.slice(h.at + h.len, b).replace(/\s\S*$/, b < s.length ? '' : '$&');
    const on = k === (findState.now >= 0 && findState.now < Math.min(hits.length, FIND_LIST_MAX) ? findState.now : 0);
    return `<li role="none"><button type="button" role="option" data-hit="${k}" aria-current="${k === findState.now}" aria-selected="${k === findState.now}" tabindex="${on ? 0 : -1}"><b>Page ${h.n + 1}</b><span>${a ? '…' : ''}${flat(before)}<mark>${flat(s.slice(h.at, h.at + h.len))}</mark>${flat(after)}${b < s.length ? '…' : ''}</span></button></li>`;
  };
  list.innerHTML = `<p class="find-head">${hits.length === 1 ? '1 result' : `${hits.length} results`}${hits.length > FIND_LIST_MAX ? `, first ${FIND_LIST_MAX} shown` : ''}</p><ol role="listbox" aria-label="Results">${hits.slice(0, FIND_LIST_MAX).map(row).join('')}</ol>`;
}
function findListShow(on) {
  const list = $('#findList'), btn = $('#findAll');
  list.hidden = !on; btn.setAttribute('aria-pressed', on); btn.setAttribute('aria-expanded', on);
  findListDraw();
}
$('#findList').addEventListener('click', (e) => { const b = e.target.closest('[data-hit]'); if (b) { $$('#findList [data-hit]').forEach((x) => { x.tabIndex = x === b ? 0 : -1; }); stepFind(0, +b.dataset.hit); } });
$('#findList').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); findListShow(false); $('#findAll').focus(); return; }
  const bs = $$('#findList [data-hit]'), k = bs.indexOf(document.activeElement); if (k < 0) return;
  const n = { ArrowDown: k + 1, ArrowUp: k - 1, Home: 0, End: bs.length - 1 }[e.key]; if (n === undefined) return;
  e.preventDefault(); e.stopPropagation();
  const t = bs[Math.max(0, Math.min(bs.length - 1, n))]; bs.forEach((x) => { x.tabIndex = x === t ? 0 : -1; }); t.focus();
});
$('#findAll').onclick = () => findListShow($('#findList').hidden);
for (const [id, k] of [['#findCase', 'matchCase'], ['#findWord', 'words']]) $(id).onclick = () => { findOpts[k] = !findOpts[k]; $(id).setAttribute('aria-pressed', findOpts[k]); runFind($('#findInput').value.trim()); };
// Closing Find gives the focus back to what opened it (a button, a menu's button…), or else to the page.
let findReturn = null;
function openFind() {
  const a = document.activeElement;
  if ($('#findbar').hidden) findReturn = a && a !== document.body && !$('#findbar').contains(a) && !pop.contains(a) ? a : (pop.hidden ? null : popAnchor);
  $('#findbar').hidden = false; $('#findInput').focus(); $('#findInput').select();
}
function closeFind() {
  const had = $('#findbar').contains(document.activeElement) || document.activeElement === document.body;
  $('#findbar').hidden = true; findListShow(false); runFind('');
  const back = findReturn && findReturn.isConnected && findReturn.offsetParent !== null && !findReturn.disabled ? findReturn : viewer;
  findReturn = null;
  if (had) back.focus({ preventScroll: true });
}
let findTimer;
$('#findInput').addEventListener('input', (e) => { clearTimeout(findTimer); findTimer = setTimeout(() => runFind(e.target.value.trim()), 200); });
$('#findInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') closeFind(); });
$('#findNext').onclick = () => stepFind(1); $('#findPrev').onclick = () => stepFind(-1); $('#findClose').onclick = closeFind;

/* ---------------- sidebar: pages, outline, documents ---------------- */
function syncSideTabs() { $$('.side-tabs [data-side]').forEach((b) => { const on = b.dataset.side === S.side; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; b.id ||= 'side-' + b.dataset.side; if (on) $('#sidePanel').setAttribute('aria-labelledby', b.id); }); }
function setSide(t) { S.side = t; saveSettings(); syncSideTabs(); renderSide(); }
$$('.side-tabs [data-side]').forEach((b) => b.addEventListener('click', () => setSide(b.dataset.side)));
// Arrow keys, Home and End move between tabs (and choose them), as in any tab list.
function tabKeys(e, list, choose) {
  const k = list.indexOf(document.activeElement); if (k < 0) return;
  const n = { ArrowRight: k + 1, ArrowLeft: k - 1, ArrowDown: k + 1, ArrowUp: k - 1, Home: 0, End: list.length - 1 }[e.key];
  if (n === undefined) return;
  e.preventDefault(); e.stopPropagation();
  choose(list[(n + list.length) % list.length]);
}
$('.side-tabs').addEventListener('keydown', (e) => tabKeys(e, $$('.side-tabs [data-side]'), (b) => { setSide(b.dataset.side); b.focus(); }));
$('#sideClose').onclick = () => toggleSidebar(false);
let thumbIO;
async function renderSide() {
  const panel = $('#sidePanel');
  if (S.side === 'docs') return renderDocs();
  if (!doc) { panel.innerHTML = '<p class="empty-note">Open a PDF to see its pages.</p>'; return; }
  if (S.side === 'outline') {
    if (FEATURE.outlinePanel) return FEATURE.outlinePanel(panel);
    const outline = await pdfDocs.get(0).getOutline().catch(() => null);
    const list = (items) => `<ul class="outline-list">${items.map((o, k) => `<li><button type="button" data-o="${esc(k)}" style="padding-left:${8}px">${esc(o.title)}</button>${o.items && o.items.length ? `<div style="padding-left:12px">${list(o.items)}</div>` : ''}</li>`).join('')}</ul>`;
    panel.innerHTML = outline && outline.length ? list(outline) : '<p class="empty-note">This PDF has no outline.</p>';
    const flat = []; const walk = (items) => items.forEach((o) => { flat.push(o); o.items && walk(o.items); }); outline && walk(outline);
    $$('[data-o]', panel).forEach((b, k) => { b.onclick = () => goToDest(flat[k].dest); });
    return;
  }
  // A list box: one Tab stop (the page in view), arrows move, Shift+arrows choose several, Enter goes to the page.
  const had = document.activeElement && document.activeElement.closest && document.activeElement.closest('#sidePanel .thumb');
  const refocus = had ? (thumbChosen().has(+had.dataset.n) ? +had.dataset.n : current) : -1;
  panel.innerHTML = `<div class="thumbs" role="listbox" aria-label="Pages" aria-multiselectable="true" aria-orientation="vertical">${doc.pages.map((e, n) => `<button type="button" role="option" class="thumb" draggable="true" data-n="${n}" aria-label="Page ${n + 1}" aria-selected="false" tabindex="-1"><canvas width="1" height="1"></canvas><span aria-hidden="true">${n + 1}</span></button>`).join('')}</div>`;
  thumbIO && thumbIO.disconnect();
  thumbIO = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { thumbIO.unobserve(en.target); drawThumb(en.target); } }), { root: panel, rootMargin: '300px' });
  $$('.thumb', panel).forEach((t) => {
    thumbIO.observe(t);
    t.onclick = () => { goPage(+t.dataset.n); if (isPhone()) toggleSidebar(false); };
    t.ondragstart = (e) => { e.dataTransfer.setData('text/plain', t.dataset.n); };
    t.ondragover = (e) => { e.preventDefault(); t.classList.add('drag-over'); };
    t.ondragleave = () => t.classList.remove('drag-over');
    t.ondrop = (e) => {
      e.preventDefault(); t.classList.remove('drag-over');
      const from = +e.dataTransfer.getData('text/plain'), to = +t.dataset.n;
      if (Number.isNaN(from) || from === to) return;
      pageOp(() => { const [x] = doc.pages.splice(from, 1); doc.pages.splice(to, 0, x); current = to; }); pagesMoved([from], to);
    };
  });
  markThumb();
  if (refocus >= 0) { const t = $(`.thumb[data-n="${refocus}"]`, panel) || $(`.thumb[data-n="${current}"]`, panel); if (t) { t.focus({ preventScroll: true }); markThumb(); } }
  const t0 = $(`.thumb[data-n="${current}"]`, panel); if (t0) t0.scrollIntoView({ block: 'nearest' });
}
// A thumbnail shows what will be saved: the page, with its page design (watermark, header, background), redactions
// and mark-up drawn over it the way the page shows them. `data-size` on the element sets its longer side.
const thumbToken = new WeakMap();
// What a thumbnail depends on: when this changes (an edit, undo, redo), it is drawn again.
function thumbSig(e, n, extra) { return JSON.stringify([e.src, e.i, e.rot, e.crop || 0, n, doc.pages.length, doc.marks[pageKey(e)] || [], extra]); }
async function drawThumb(t) {
  const n = +t.dataset.n, e = doc && doc.pages[n]; if (!e) return;
  const tok = (thumbToken.get(t) || 0) + 1; thumbToken.set(t, tok);
  const sig = thumbSig(e, n, JSON.stringify(doc.marks.__doc || []));
  const page = await pageOf(e), rot = (page.rotate + e.rot) % 360;
  const vp = page.getViewport({ scale: 1, rotation: rot });
  const v2 = page.getViewport({ scale: (+t.dataset.size || 182) / Math.max(vp.width, vp.height), rotation: rot });
  const off = document.createElement('canvas'); off.width = v2.width; off.height = v2.height;
  const g = off.getContext('2d');
  // Pictures deleted or moved with Edit PDF are left out, as on the page (not painted over, which hides the text on them).
  const skip = await imageSkip({ entry: e, page }).catch(() => ({ filter: null, hidden: new Set() }));
  try { await page.render({ canvas: off, canvasContext: g, viewport: v2, operationsFilter: skip.filter }).promise; } catch {}
  if (thumbToken.get(t) !== tok) return;
  try { await thumbOverlays(e, n, page, v2, g, skip.hidden); } catch (err) { console.warn('thumbnail', err); }
  if (thumbToken.get(t) !== tok || !t.isConnected) return;
  const c = $('canvas', t); c.width = off.width; c.height = off.height; c.getContext('2d').drawImage(off, 0, 0);
  off.width = off.height = 0;
  t.dataset.sig = sig;
}
// Draws the page's layers (made by the same code as on the big page, at the thumbnail's scale) onto `g`.
// design: false leaves out the page design (watermark, header…), for a preview that draws its own.
async function thumbOverlays(e, n, page, vp, g, imgHidden, { design = true } = {}) {
  const marks = doc.marks[pageKey(e)] || [];
  if (!marks.length && !(design && (doc.marks.__doc || []).length)) return;
  if (marks.some((m) => m.type === 'te') && !page._cmapValue) { try { page._cmapValue = await contentMap(page); } catch {} }
  const el = document.createElement('div');
  el.dataset.n = n; el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `position:fixed;left:-100000px;top:0;width:${vp.width}px;height:${vp.height}px;visibility:hidden;pointer-events:none`;
  document.body.appendChild(el);
  try {
    const v = { el, entry: e, viewport: vp, page, rendered: true, thumb: true, imgHidden };
    // Drawn at the thumbnail's scale. What is selected stays so (features keep their own state, a crop under way…);
    // a selection's outline is a page style, which a picture of the layer does not have.
    const keep = scale; scale = vp.scale;
    try { drawMarks(v); if (design) for (const f of FEATURE.thumbLayers) { try { f(v); } catch (err) { console.warn(err); } } }
    finally { scale = keep; }
    // In the page's order: what goes under the text (blended with it), the mark-up, then what goes over everything.
    const layers = [...el.querySelectorAll(':scope > svg')].sort((a, b) => thumbZ(a) - thumbZ(b));
    for (const svg of layers) {
      if (!svg.childElementCount) continue;
      const copy = svg.cloneNode(true);
      thumbInline(svg, copy);
      copy.setAttribute('xmlns', NS); copy.setAttribute('width', g.canvas.width); copy.setAttribute('height', g.canvas.height);
      copy.setAttribute('viewBox', `0 0 ${vp.width} ${vp.height}`);
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(copy));
      try { await img.decode(); } catch { continue; }
      g.globalCompositeOperation = svg.classList.contains('pd-under') ? 'multiply' : 'source-over';
      g.drawImage(img, 0, 0, g.canvas.width, g.canvas.height);
    }
    g.globalCompositeOperation = 'source-over';
  } finally { el.remove(); }
}
const thumbZ = (svg) => (svg.classList.contains('pd-under') ? 1 : svg.classList.contains('marks') ? 4 : 5);
/* A layer drawn as a picture has none of the page's styles. So each shape gets the look the page gives it written onto
   it, and what the page hides, or what only helps while editing (class ui-only: a field's name tag, handles, a link's
   outline), is left out. Inside clip paths and other definitions nothing is changed. */
const THUMB_PROPS = ['white-space', 'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'mix-blend-mode'];
const THUMB_DEFS = /^(defs|clipPath|mask|pattern|linearGradient|radialGradient|filter|marker|symbol|title|desc|style|metadata)$/;
function thumbInline(svg, copy) {
  const from = [...svg.querySelectorAll('*')], to = [...copy.querySelectorAll('*')], gone = [];
  for (let k = 0; k < from.length; k++) {
    const a = from[k], b = to[k]; if (!b) break;
    if (a.closest('defs, clipPath, mask, pattern, linearGradient, radialGradient, filter, marker, symbol') || THUMB_DEFS.test(a.localName)) continue;
    if (a.classList.contains('ui-only')) { gone.push(b); continue; }
    const cs = getComputedStyle(a);
    if (cs.display === 'none') { gone.push(b); continue; }
    const st = [];
    for (const p of THUMB_PROPS) {
      const val = cs.getPropertyValue(p); if (!val) continue;
      if ((p === 'mix-blend-mode' || p === 'white-space') && val === 'normal') continue;
      if (p === 'stroke-dasharray' && val === 'none') continue;
      st.push(`${p}:${val}`);
    }
    b.setAttribute('style', st.join(';'));
    b.removeAttribute('class');
  }
  for (const b of gone) b.remove();
}
// After a change, undo or redo, the thumbnails whose page changed are drawn again (a moment later, once).
let thumbTimer;
function thumbsLater() { clearTimeout(thumbTimer); thumbTimer = setTimeout(thumbsRefresh, 300); }
function thumbsRefresh() {
  if (!doc) return;
  const dm = JSON.stringify(doc.marks.__doc || []);
  for (const t of $$('.thumb[data-sig], .pg60-cell[data-sig]')) {
    const e = doc.pages[+t.dataset.n];
    if (e && t.dataset.sig !== thumbSig(e, +t.dataset.n, dm)) drawThumb(t);
  }
}
// The chosen pages: those picked in the sidebar when there are several, else the page in view.
function thumbChosen() { const l = typeof pg60Valid === 'function' ? pg60Valid() : []; return new Set(l.length > 1 ? l : [current]); }
function markThumb() {
  const sel = thumbChosen(), a = document.activeElement, focused = a && a.closest && a.closest('#sidePanel .thumb');
  $$('#sidePanel .thumb').forEach((t) => {
    const n = +t.dataset.n;
    t.setAttribute('aria-selected', sel.has(n));
    if (n === current) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    t.tabIndex = (focused ? t === focused : n === current) ? 0 : -1;
  });
}
$('#sidePanel').addEventListener('keydown', (e) => {
  const t = e.target.closest && e.target.closest('#sidePanel .thumb'); if (!t || !doc || e.ctrlKey || e.metaKey) return;
  const list = $$('#sidePanel .thumb'), k = list.indexOf(t), last = list.length - 1;
  if (e.altKey) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault(); e.stopPropagation();
    if (!thumbChosen().has(k)) { current = k; if (FEATURE.thumbPick) FEATURE.thumbPick(k); }
    run(e.key === 'ArrowUp' ? 'up' : 'down'); return;
  }
  if (e.key === 'Enter') {
    e.preventDefault(); e.stopPropagation();
    goPage(k); if (isPhone()) toggleSidebar(false); else viewer.focus({ preventScroll: true });
    return;
  }
  const to = { ArrowUp: k - 1, ArrowLeft: k - 1, ArrowDown: k + 1, ArrowRight: k + 1, Home: 0, End: last }[e.key];
  if (to === undefined) return;
  e.preventDefault(); e.stopPropagation();
  const n = Math.max(0, Math.min(last, to)), nt = list[n];
  nt.focus(); nt.scrollIntoView({ block: 'nearest' });
  if (e.shiftKey && FEATURE.thumbExtend) FEATURE.thumbExtend(n);
  else { if (FEATURE.thumbPick) FEATURE.thumbPick(n); goPage(n, true); }
  markThumb();
});
let sideOpener = null; // what had focus when the phone sidebar opened; it gets it back on closing
function toggleSidebar(on) {
  const phone = isPhone();
  if (phone) {
    const was = app.dataset.sidebar === 'open', open = on ?? !was;
    app.dataset.sidebar = open ? 'open' : 'on';
    sideInert(open);
    if (open && !was) { sideOpener = document.activeElement; const t = $('.side-tabs [aria-selected="true"]'); requestAnimationFrame(() => t && t.focus({ preventScroll: true })); }
    if (!open && was) { const f = sideOpener; sideOpener = null; if (f && f.isConnected && f !== document.body) f.focus({ preventScroll: true }); }
    refreshRibbon(); return;
  }
  sideInert(false);
  S.sidebar = on ?? !S.sidebar; saveSettings(); app.dataset.sidebar = S.sidebar ? 'on' : 'off';
  if (doc && zoomFits()) setTimeout(() => layoutPages(true), 50);
}

// While the phone sidebar is open, everything behind its scrim is out of reach (inert), and Tab goes round inside it.
function sideInert(on) { $$('.titlebar, .ribbon, #viewer, .statusbar').forEach((el) => { el.inert = on; }); }
$('#sidebar').addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || app.dataset.sidebar !== 'open') return;
  const fs = $$('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])', $('#sidebar')).filter((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
  if (!fs.length) return;
  const first = fs[0], last = fs[fs.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
// Leaving the phone layout (a rotated tablet, a wider window) with the sidebar open: back to the docked sidebar.
matchMedia(PHONE_MQ).addEventListener('change', (e) => { if (!e.matches && app.dataset.sidebar === 'open') { sideInert(false); app.dataset.sidebar = S.sidebar ? 'on' : 'off'; refreshRibbon(); } });
// Phone: the sidebar is an overlay over a scrim; a tap outside it closes it (and does nothing else).
document.addEventListener('pointerdown', (e) => {
  if (app.dataset.sidebar !== 'open' || !isPhone() || e.target.closest('#sidebar')) return;
  e.preventDefault(); e.stopPropagation(); toggleSidebar(false);
  const eat = (ev) => { ev.preventDefault(); ev.stopPropagation(); }; // the click that follows the tap
  window.addEventListener('click', eat, { capture: true, once: true }); setTimeout(() => window.removeEventListener('click', eat, true), 500);
}, true);

/* ---------------- library (IndexedDB): every PDF you open, kept on this device ---------------- */
let dbp;
function db() {
  return dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(KEY, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('docs', { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}
async function dbDo(mode, fn) { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction('docs', mode); const out = fn(tx.objectStore('docs')); tx.oncomplete = () => res(out && out.result); tx.onerror = () => rej(tx.error); }); }
let persistTimer;
async function persistNow() {
  if (!doc) return;
  doc.updated = Date.now();
  // Passwords are never written to this device: a protected PDF asks for its password again when reopened.
  const rec = { id: doc.id, name: doc.name, path: doc.path || null, mtime: doc.mtime || 0, sources: doc.sources, pages: doc.pages, marks: doc.marks, updated: doc.updated };
  try { await dbDo('readwrite', (s) => s.put(rec)); } catch (e) { console.warn('could not keep the PDF on this device', e); }
  if (S.side === 'docs') renderDocs();
}
function persist() { clearTimeout(persistTimer); persistTimer = setTimeout(persistNow, 300); }
async function listDocs() { try { return (await dbDo('readonly', (s) => s.getAll())) || []; } catch { return []; } }
async function renderDocs() {
  const panel = $('#sidePanel');
  const all = (await listDocs()).sort((a, b) => b.updated - a.updated);
  if (S.side !== 'docs') return;
  panel.innerHTML = all.length ? `<p class="empty-note">Files you opened here. Choose one to switch to it.</p><ul class="doc-list">${all.map((d) => `<li class="doc-item"${doc && d.id === doc.id ? ' aria-current="true"' : ''}><button type="button" class="doc-open" data-id="${d.id}">${esc(d.name)}<span class="m">${new Date(d.updated).toLocaleDateString()} · ${d.pages.length} page${d.pages.length === 1 ? '' : 's'}</span></button><button type="button" class="icon-btn" data-del="${d.id}" title="Remove from Recent" aria-label="Remove ${esc(d.name)} from Recent">${ic('x')}</button></li>`).join('')}</ul>` : '<p class="empty-note">PDFs you open are kept here, on this device.</p>';
  icons();
  $$('[data-id]', panel).forEach((b) => { b.onclick = () => serial(() => openStored(b.dataset.id)); });
  $$('[data-del]', panel).forEach((b) => { b.onclick = async () => {
    const ok = await dialog('Remove this PDF?', '<p>It is removed from this device. The file you opened it from is not touched.</p>', [{ label: 'Keep it' }, { label: 'Remove', value: 'yes', danger: true }]);
    if (ok !== 'yes') return;
    await dbDo('readwrite', (s) => s.delete(b.dataset.del));
    if (doc && doc.id === b.dataset.del) { doc = null; pagesEl.innerHTML = ''; views = []; $('#drop').hidden = false; setTitle(); setSaved(true); updateStatus(); }
    renderDocs();
  }; });
}
async function openStored(id) {
  if (doc && doc.id === id) return true;
  const all = await listDocs(); const rec = all.find((d) => d.id === id); if (!rec) return false;
  const sources = rec.sources.map((b) => b instanceof Uint8Array ? b : new Uint8Array(b));
  // The file it came from is linked again only if it still exists; Save checks it hasn't changed since.
  let path = rec.path || null;
  if (path && MAC_APP && !(await fileTime(path))) path = null;
  return showDoc({ id: rec.id, name: rec.name, sources, pages: rec.pages, marks: rec.marks || {}, updated: rec.updated, handle: null, path, mtime: path ? rec.mtime || 0 : 0 });
}

/* ---------------- the sample PDF ----------------
   A two-page welcome document, made here with pdf-lib, so there is something to try without a file. */
async function makeSample() {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const maroon = rgb(.557, .071, .22), ink = rgb(.13, .11, .12), grey = rgb(.38, .34, .35);
  const W = 612, H = 792, M = 72;
  const wrap = (text, f, size, width) => {
    const out = []; let line = '';
    for (const w of text.split(' ')) { const t = line ? line + ' ' + w : w; if (f.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w; } else line = t; }
    if (line) out.push(line); return out;
  };
  const para = (p, text, y, o = {}) => { const size = o.size || 12, f = o.font || font; for (const l of wrap(text, f, size, W - 2 * M)) { p.drawText(l, { x: M, y, size, font: f, color: o.color || ink }); y -= size * 1.5; } return y - (o.after ?? 8); };
  const head = (p, n) => {
    p.drawRectangle({ x: 0, y: H - 10, width: W, height: 10, color: maroon });
    p.drawText('Cowdrey.PDF', { x: M, y: H - 46, size: 10, font: bold, color: maroon });
    p.drawText(`Sample · page ${n} of 2`, { x: W - M - font.widthOfTextAtSize(`Sample · page ${n} of 2`, 10), y: H - 46, size: 10, font, color: grey });
  };
  let p = pdf.addPage([W, H]); head(p, 1);
  let y = para(p, 'Welcome to Cowdrey.PDF', H - 120, { size: 30, font: bold, after: 4 });
  y = para(p, 'A free PDF viewer and editor by Bradley Cowdrey. Your PDFs stay on your device.', y, { size: 14, color: grey, after: 22 });
  y = para(p, 'Try it on this page', y, { size: 16, font: bold, color: maroon, after: 2 });
  for (const t of [
    'Highlight: select these words with the mouse, then choose Highlight on the Comment tab.',
    'Draw, add a box, type text or leave a note anywhere on the page.',
    'Sign: draw your signature once and place it wherever you need it.',
    'Find: press Cmd+F (Ctrl+F on Windows) and search for the word pelican.',
  ]) y = para(p, '•  ' + t, y, { after: 2 });
  y = para(p, 'Fill in a form', y - 18, { size: 16, font: bold, color: maroon, after: 6 });
  const form = pdf.getForm();
  p.drawText('Your name', { x: M, y: y - 4, size: 12, font, color: ink });
  const name = form.createTextField('name'); name.addToPage(p, { x: M + 80, y: y - 12, width: 260, height: 24, font });
  y -= 44;
  const agree = form.createCheckBox('agree'); agree.addToPage(p, { x: M, y: y - 4, width: 16, height: 16 });
  p.drawText('I tried the sample', { x: M + 26, y: y, size: 12, font, color: ink });
  para(p, 'Then choose Save PDF: what you typed and drew is saved into the PDF, readable in any app.', y - 50, { color: grey });
  p = pdf.addPage([W, H]); head(p, 2);
  y = para(p, 'Arrange the pages', H - 120, { size: 24, font: bold, after: 10 });
  y = para(p, 'On the Pages tab you can rotate, move, duplicate, insert and delete pages, add other PDFs at the end, or extract a few pages into a new PDF. Drag the thumbnails in the sidebar to reorder them.', y, { after: 18 });
  y = para(p, 'Everywhere you work', y, { size: 16, font: bold, color: maroon, after: 2 });
  y = para(p, 'Cowdrey.PDF runs in your browser and as an app for Mac, iPhone, iPad and Android. The pelican on this page is here so Find has something to find.', y, { after: 18 });
  para(p, 'bradcowdrey.com/cowdrey-pdf', y, { size: 11, color: maroon });
  pdf.setTitle('Welcome to Cowdrey.PDF'); pdf.setAuthor('Bradley Cowdrey');
  return pdf.save();
}
async function openSample() {
  try { await openBytes(await makeSample(), 'Welcome to Cowdrey.PDF.pdf'); }
  catch (e) { console.error(e); toast('Could not make the sample PDF.'); }
}

/* ---------------- opening files ---------------- */
async function openPath(path) {
  try {
    const f = await MAC_APP.core.invoke('read_text_file', { path });
    return await openBytes(b64ToBytes(f.content), f.name, f.path, await fileTime(f.path));
  } catch (e) { console.error(e); toast(`Could not open ${path.split('/').pop()}.`); return false; }
}
async function openFiles() {
  if (MAC_APP) {
    const picked = await MAC_APP.dialog.open({ multiple: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    const path = typeof picked === 'string' ? picked : picked && picked.path;
    if (path) await serial(() => openPath(path));
    return;
  }
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({ types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
      const f = await h.getFile();
      await serial(async () => openBytes(new Uint8Array(await f.arrayBuffer()), f.name, h));
      return;
    } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  $('#fileInput').click();
}
$('#fileInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) serial(async () => openBytes(new Uint8Array(await f.arrayBuffer()), f.name)); });
['dragenter', 'dragover'].forEach((t) => window.addEventListener(t, (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); app.dataset.dragging = 'on'; } }));
['dragleave', 'drop'].forEach((t) => window.addEventListener(t, () => { app.dataset.dragging = 'off'; }));
window.addEventListener('drop', async (e) => {
  const files = [...(e.dataTransfer ? e.dataTransfer.files : [])].filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
  if (!files.length) return;
  e.preventDefault();
  // Shift-drop adds to the open PDF; otherwise the first file opens and the rest are added to it.
  serial(() => openOrAdd(files, !doc || !e.shiftKey));
});

/* ---------------- dialogs ---------------- */
// One dialog at a time: a dialog asked for while another is open (an update notice during a password question)
// waits its turn, so every question gets its answer.
let dialogChain = Promise.resolve();
function dialog(...args) { const p = dialogChain.then(() => showDialog(...args)); dialogChain = p.catch(() => {}); return p; }
function showDialog(title, body, actions, setup) {
  const dlg = $('#dialog');
  dlg.innerHTML = `<div class="dlg-head"><h2 id="dlgTitle">${esc(title)}</h2><button class="icon-btn" type="button" data-x aria-label="Close">${ic('x')}</button></div><div class="dlg-body">${body}</div><div class="dlg-foot">${actions.map((a, k) => `<button type="button" class="btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}" data-a="${k}">${esc(a.label)}</button>`).join('')}</div>`;
  icons();
  if (setup) setup(dlg);
  return new Promise((res) => {
    const done = (v) => { dlg.close(); res(v); };
    $('[data-x]', dlg).onclick = () => done(null);
    $$('[data-a]', dlg).forEach((b) => b.onclick = () => {
      const a = actions[+b.dataset.a];
      if (a.value === 'clear' && dlg.__clear) { dlg.__clear(); return; }
      if (a.value === 'place' && dlg.__get) { const data = dlg.__get(); if (!data) { toast(dlg.__empty ? dlg.__empty() : 'Draw your signature first'); return; } done({ value: 'place', data }); return; }
      if (a.input) { done($('#dlgInput', dlg).value); return; }
      done(a.value ?? null);
    });
    dlg.oncancel = (e) => { e.preventDefault(); done(null); };
    dlg.showModal();
    // Start on the first field you type in (with a mouse and keyboard; a touch screen would open its keyboard), or else
    // on the first field, or else on the main button, never on the close button: what's typed at once isn't lost.
    // (not a field that belongs to a choice not made: focusing "Pages [1-3]" would choose it)
    const fine = matchMedia('(pointer: fine)').matches, texty = $$(`.dlg-body :is(${DLG_TEXTY})`, dlg).find((f) => { const l = f.closest('label'); return !(l && $('input[type="radio"]:not(:checked)', l)); });
    const first = $('.dlg-body [autofocus]', dlg) || (fine && texty) || $('.dlg-body :is(input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]))', dlg) || $('.dlg-foot .btn.primary:not([disabled])', dlg) || $('.dlg-foot .btn:not(.danger)', dlg);
    if (first && (document.activeElement === $('[data-x]', dlg) || !dlg.contains(document.activeElement))) { first.focus(); if (fine && first === texty && first.select) first.select(); }
    // Enter in a one-line field presses the main button (fields with their own Enter, like lists, say so first).
    dlg.onkeydown = (e) => {
      if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || e.shiftKey || e.altKey || !e.target.matches(`:is(${DLG_TEXTY}):not(textarea)`)) return;
      const pb = $('.dlg-foot .btn.primary:not([disabled])', dlg); if (pb) { e.preventDefault(); pb.click(); }
    };
    const inp = $('#dlgInput', dlg); if (inp) { inp.focus(); inp.select && inp.select(); inp.onkeydown = (e) => { if (e.key === 'Enter' && (inp.tagName !== 'TEXTAREA' || e.metaKey || e.ctrlKey)) { e.preventDefault(); done(inp.value); } }; }
  });
}
const DLG_TEXTY = 'input:not([type="hidden"], [type="radio"], [type="checkbox"], [type="range"], [type="color"], [type="file"], [type="button"], [disabled]), textarea:not([disabled])';
function askText(title, note, value, ok, password, multiline) {
  const field = multiline ? `<textarea id="dlgInput" rows="4">${esc(value)}</textarea>` : `<input id="dlgInput" type="${password ? 'password' : 'text'}" value="${esc(value)}" autocomplete="off">`;
  return dialog(title, `${note ? `<p id="dlgNote">${esc(note)}</p>` : ''}<label class="field">${field.replace('id="dlgInput"', `id="dlgInput" aria-labelledby="dlgTitle"${note ? ' aria-describedby="dlgNote"' : ''}`)}</label>`, [{ label: 'Cancel' }, { label: ok, primary: true, input: true }]);
}
// Links open in the browser. The apps' web views ignore target=_blank and window.open, so they hand links to the system.
const openExternal = (url) => { if (NATIVE && NATIVE.opener) NATIVE.opener.openUrl(url).catch(() => {}); else window.open(url, '_blank', 'noopener'); };
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || !NATIVE || !/^(https?:|mailto:)/i.test(a.getAttribute('href'))) return;
  e.preventDefault(); openExternal(a.href);
});
function about() {
  dialog('About Cowdrey.PDF', `<div class="about"><img class="logo" src="__APP_ICON__" alt="" aria-hidden="true"><div><strong style="font-size:18px;color:var(--ink)">Cowdrey.PDF ${VERSION}</strong><br>by Bradley Cowdrey · <a href="https://bradcowdrey.com" target="_blank" rel="noopener">bradcowdrey.com</a></div></div>
  <p>A PDF viewer and editor in the spirit of Cowdrey.MD: read, mark up, sign, fill forms, and rearrange pages. Your PDFs stay on this device.</p>
  <p style="font-size:12px">Built with pdf.js (Apache 2.0), pdf-lib (MIT) and Lucide (ISC). <a href="https://bradcowdrey.com/legal" target="_blank" rel="noopener">Terms of Use and Privacy</a></p>`, [{ label: 'Close', primary: true }]);
}

/* ---------------- commands, menus, ribbon ---------------- */
const C = {};
const has = () => !!doc && doc.pages.length > 0;
function cmd(id, o) { C[id] = o; }
function run(id) {
  const c = C[id]; if (!c) return;
  if (id !== 'undo' && id !== 'redo') closeLineEditor(true); // keep what's being typed before saving, rotating…
  if (c.enabled && !c.enabled()) return; closePopover(); c.run();
}
cmd('open', { label: 'Open…', icon: 'folder-open', key: 'Mod-o', run: openFiles });
cmd('save', { label: 'Save PDF', icon: 'download', key: 'Mod-s', enabled: has, run: () => savePdf(false) });
cmd('saveCopy', { label: 'Save a copy…', icon: 'copy', key: 'Mod-Shift-s', enabled: has, run: () => savePdf(true) });
cmd('sample', { label: 'Open the sample PDF', icon: 'book-open', run: () => serial(openSample) });
cmd('merge', { label: 'Combine PDFs…', icon: 'files', run: () => $('#mergeInput').click() }); // a list to order first: 60-pages.js
cmd('exportImage', { rlabel: 'Page as picture', label: 'Export this page as a picture', icon: 'image-down', enabled: has, run: exportImage });
cmd('exportText', { label: 'Export text (.txt)', icon: 'file-text', enabled: has, run: exportText });
cmd('print', { label: 'Print…', icon: 'printer', key: 'Mod-p', enabled: has, run: printDoc });
cmd('undo', { get label() { return undoStack.length ? 'Undo ' + undoName() : 'Undo'; }, rlabel: 'Undo', icon: 'undo-2', key: 'Mod-z', enabled: () => undoStack.length > 0, run: undo });
cmd('redo', { get label() { return redoStack.length ? 'Redo ' + redoName() : 'Redo'; }, rlabel: 'Redo', icon: 'redo-2', key: 'Mod-Shift-z', enabled: () => redoStack.length > 0, run: redo });
TEST_HOOKS.cmdLabel = (id) => C[id].label;
TEST_HOOKS.cmdEnabled = (id) => !C[id].enabled || !!C[id].enabled();
cmd('find', { label: 'Find…', icon: 'search', key: 'Mod-f', enabled: has, run: openFind });
cmd('deleteMark', { label: 'Delete selected', icon: 'trash-2', enabled: () => !!selMark || !!selContent, run: deleteSelected });
cmd('copyMark', { label: 'Copy', icon: 'copy', key: 'Mod-c', hidden: true, enabled: () => !!selMark, run: copyMark });
cmd('pasteMark', { label: 'Paste', icon: 'clipboard-paste', key: 'Mod-v', hidden: true, enabled: () => !!markClip && has(), run: () => pasteMark() });
cmd('dupMark', { label: 'Duplicate', icon: 'copy-plus', key: 'Mod-d', hidden: true, enabled: () => !!selMark, run: duplicateMark });
const tools = [['select', 'Select', 'mouse-pointer-2'], ['highlight', 'Highlight', 'highlighter'], ['pen', 'Draw', 'pen-line'], ['rect', 'Rectangle', 'square'], ['text', 'Add text', 'type'], ['note', 'Note', 'sticky-note'], ['edit', 'Edit PDF', 'text-cursor-input'], ['erase', 'Erase area', 'eraser']];
for (const [t, label, icon] of tools) cmd('tool_' + t, { label, icon, enabled: has, pressed: () => app.dataset.tool === t, run: () => { if (t === 'highlight' && highlightSelection()) return; setTool(t); } });
cmd('sign', { label: 'Signature…', icon: 'signature', enabled: has, run: signature });
cmd('image', { label: 'Picture…', icon: 'image-plus', enabled: has, run: () => $('#imageInput').click() });
cmd('rotL', { label: 'Rotate left', icon: 'rotate-ccw', enabled: has, run: () => rotatePage(-90) });
cmd('rotR', { rlabel: 'Rotate', label: 'Rotate right', icon: 'rotate-cw', key: 'Mod-r', enabled: has, run: () => rotatePage(90), menu: ['rotL', 'rotR', 'rotAll', 'pg60_rotate'] });
cmd('rotAll', { rlabel: 'Rotate all', label: 'Rotate all pages', icon: 'refresh-cw', enabled: has, run: () => rotateAll(90) });
cmd('up', { rlabel: 'Move up', label: 'Move page up', icon: 'arrow-up', enabled: () => has() && current > 0, run: () => movePage(-1) });
cmd('down', { rlabel: 'Move down', label: 'Move page down', icon: 'arrow-down', enabled: () => has() && current < doc.pages.length - 1, run: () => movePage(1) });
cmd('dup', { label: 'Duplicate page', icon: 'copy-plus', enabled: has, run: duplicatePage });
cmd('blank', { rlabel: 'Blank page', label: 'Insert blank page', icon: 'file-plus-2', enabled: has, run: insertBlank });
cmd('delPage', { rlabel: 'Delete', label: 'Delete page', icon: 'file-x-2', enabled: () => has() && doc.pages.length > 1, // a PDF keeps one page at least
  run: deletePage, menu: ['delPage', 'pg60_delete'] });
cmd('extract', { label: 'Extract pages…', icon: 'file-output', enabled: has, run: extractPages });
cmd('sidebar', { label: 'Sidebar', icon: 'panel-left', key: 'Mod-Alt-s', pressed: () => isPhone() ? app.dataset.sidebar === 'open' : S.sidebar, run: () => toggleSidebar() });
cmd('darkPage', { label: 'Dark pages', icon: 'moon-star', pressed: () => S.darkPage, run: () => { S.darkPage = !S.darkPage; saveSettings(); applyTheme(); refreshRibbon(); } });
cmd('zoomIn', { label: 'Zoom in', icon: 'zoom-in', key: 'Mod-=', enabled: has, run: () => setZoom(Math.min(400, Math.round(scale * 100) + 10)) });
cmd('zoomOut', { label: 'Zoom out', icon: 'zoom-out', key: 'Mod--', enabled: has, run: () => setZoom(Math.max(25, Math.round(scale * 100) - 10)) });
cmd('zoomFit', { label: 'Fit width', icon: 'move-horizontal', key: 'Mod-2', enabled: has, pressed: () => S.zoom === 'fit', run: () => setZoom('fit') });
cmd('zoomPage', { label: 'Fit page', icon: 'scan', key: 'Mod-0', enabled: has, pressed: () => S.zoom === 'page', run: () => setZoom('page') });
cmd('zoom100', { label: 'Actual size', icon: 'scan-line', key: 'Mod-1', enabled: has, pressed: () => S.zoom === 100, run: () => setZoom(100) });
[['system', 'Match system', 'sun-moon'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']].forEach(([v, l, i]) => cmd('theme_' + v, { label: 'Appearance: ' + l, icon: i, pressed: () => S.theme === v, run: () => { S.theme = v; saveSettings(); applyTheme(); } }));
cmd('about', { label: 'About Cowdrey.PDF', icon: 'info', run: about });
cmd('shortcuts', { label: 'Keyboard shortcuts', icon: 'keyboard', get hidden() { return !matchMedia('(any-pointer: fine)').matches; }, run: shortcutsDialog }); // not without a keyboard
function shortcutsDialog() {
  const byKey = new Map();
  for (const c of Object.values(C)) if (c.key) { const l = c.label.replace(/…$/, ''); (byKey.get(c.key) || byKey.set(c.key, []).get(c.key)).push(c.key === 'Mod-d' && l === 'Duplicate' ? 'Duplicate selection' : l); }
  const rows = [...byKey].map(([k, ls]) => [ls.length > 1 ? `${ls[0]}, or ${ls.slice(1).join(', or ').replace(/^./, (x) => x.toLowerCase())} when nothing is selected` : ls[0], fmtKey(k) + (k === 'Mod-Shift-z' ? ' or ' + fmtKey('Mod-y') : '')]);
  rows.push(['Delete selection', 'Delete'], ['Nudge selection', 'Arrows (Shift: 10 pt)'], ['Place the chosen note, stamp, text or signature in view', 'Enter'], ['Finish or cancel a tool', 'Esc']);
  const row = ([l, k]) => `<span>${esc(l)}</span><span style="color:var(--ink-3);text-align:right">${esc(k)}</span>`;
  return dialog('Keyboard shortcuts', `<div style="display:grid;grid-template-columns:1fr auto;gap:6px 18px">${rows.map(row).join('')}</div>`, [{ label: 'Close', primary: true }]);
}
cmd('legal', { label: 'Terms of Use and Privacy', icon: 'scale', run: () => openExternal('https://bradcowdrey.com/legal') });
cmd('share', { label: 'Share…', icon: 'share', enabled: has, hidden: !NATIVE, run: sharePdf });
cmd('checkUpdates', { label: 'Check for updates…', icon: 'refresh-cw', hidden: !MAC_APP, run: () => checkForUpdates(true) });

const fmtKey = (k) => k ? k.split(/-(?=.)/).map((p) => isMac ? ({ Mod: '⌘', Shift: '⇧', Alt: '⌥' }[p] || p.toUpperCase()) : ({ Mod: 'Ctrl', Shift: 'Shift', Alt: 'Alt' }[p] || p.toUpperCase())).join(isMac ? '' : '+') : '';
const MENUS = [
  ['File', ['open', 'save', 'saveCopy', 'share', '-', 'merge', 'exportImage', 'exportText', '-', 'print']],
  ['Edit', ['undo', 'redo', '-', 'deleteMark', '-', 'find', '-', 'tool_edit', 'tool_erase', 'tool_text', 'image']],
  ['View', ['sidebar', 'darkPage', '-', 'zoomIn', 'zoomOut', 'zoomFit', 'zoomPage', 'zoom100', '-', 'theme_system', 'theme_light', 'theme_dark']],
  ['Comment', ['tool_select', 'tool_highlight', 'tool_pen', 'tool_rect', 'tool_note', '-', 'sign']],
  ['Pages', ['rotL', 'rotR', 'rotAll', '-', 'up', 'down', 'dup', 'blank', 'merge', '-', 'extract', 'delPage']],
  ['Help', ['sample', 'shortcuts', 'legal', '-', 'checkUpdates', 'about']],
];
const shown = (id) => id === '-' || (C[id] && !C[id].hidden);
// A toggle (Sidebar, Dark pages…) is a checkbox item and a choice of one (Appearance) a radio item, each with its
// checked state; the three Appearance items are one group. The shortcut is announced as a key, not as part of the name.
const ariaKey = (k) => k.split(/-(?=.)/).map((p) => ({ Mod: isMac ? 'Meta' : 'Control', Shift: 'Shift', Alt: 'Alt' }[p] || p.toUpperCase())).join('+');
// A menu item: its icon, name and shortcut, then its check mark (drawn in a first column, shown only in a menu with a
// toggle in it).
const menuIcon = (icon) => icon ? ic(icon) : '<span></span>', menuChk = (on) => `<span class="mchk" aria-hidden="true">${on ? ic('check') : ''}</span>`;
function menuHtml(ids) {
  let html = '', group = false;
  for (const id of ids.filter(shown)) {
    const radio = /^theme_/.test(id) ? 'Appearance' : /^vw_lay_/.test(id) ? 'Page layout' : false;
    if (radio !== group) { html += (group ? '</div>' : '') + (radio ? `<div role="group" aria-label="${radio}">` : ''); group = radio; }
    if (id === '-') { html += '<div class="msep"></div>'; continue; }
    const c = C[id], on = c.pressed ? !!c.pressed() : null, dis = c.enabled && !c.enabled();
    const role = on === null ? 'role="menuitem"' : `role="${radio ? 'menuitemradio' : 'menuitemcheckbox'}" aria-checked="${on}"`;
    html += `<button type="button" class="mi" ${role} data-cmd="${id}"${on === null ? '' : ' data-chk'}${c.key ? ` aria-keyshortcuts="${ariaKey(c.key)}"` : ''}${dis ? ' disabled' : ''}>${menuIcon(c.icon)}<span>${esc(c.label)}</span><span class="k" aria-hidden="true">${fmtKey(c.key)}</span>${menuChk(on)}</button>`;
  }
  return html + (group ? '</div>' : '');
}
const pop = $('#popover');
let popAnchor = null; // the button that opened the popover; Escape gives it focus back
// `at`: { x, y, label } opens it at a spot (a right-click menu), above the spot if there is no room below.
function openPopover(anchor, html, at) {
  popAnchor = anchor;
  pop.innerHTML = html; pop.hidden = false; pop.classList.toggle('has-chk', !!$('[data-chk]', pop)); icons();
  if (!at && anchor.id) pop.setAttribute('aria-labelledby', anchor.id); else pop.removeAttribute('aria-labelledby');
  if (at && at.label) pop.setAttribute('aria-label', at.label); else pop.removeAttribute('aria-label');
  if (at) {
    pop.style.maxHeight = innerHeight - 16 + 'px';
    const h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(at.x, innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.style.top = (at.y + h > innerHeight - 8 ? Math.max(8, at.y - h) : at.y) + 'px';
  } else {
    const r = anchor.getBoundingClientRect();
    pop.style.maxHeight = Math.max(160, innerHeight - r.bottom - 12) + 'px';
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px'; pop.style.top = r.bottom + 4 + 'px';
  }
  const f = $('.pop-sw button[aria-checked="true"], .mi:not([disabled])', pop); f && f.focus();
}
function closePopover() { pop.hidden = true; popAnchor = null; $$('.ctx-for').forEach((t) => t.classList.remove('ctx-for')); $$('.menubar > button, #moreBtn, [data-rmenu]').forEach((b) => b.setAttribute('aria-expanded', 'false')); }
// Menu keys: Up and Down (and Home, End) move between items, Left and Right to the next menu, Escape closes and
// goes back to the menu's button, Tab closes.
pop.addEventListener('keydown', (e) => {
  const items = $$('.mi:not([disabled]), .pop-sw button, .pop-sw input', pop), i = items.indexOf(document.activeElement);
  const go = (n) => { e.preventDefault(); if (items.length) items[(n + items.length) % items.length].focus(); };
  if (e.key === 'ArrowDown') go(i + 1);
  else if (e.key === 'ArrowUp') go(i < 0 ? -1 : i - 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(-1);
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const a = popAnchor; closePopover(); if (a && a.isConnected) a.focus(); }
  else if (e.key === 'Tab') closePopover();
  else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && popAnchor && popAnchor.closest('.menubar')) {
    e.preventDefault();
    const bs = $$('.menubar > button'), k = bs.indexOf(popAnchor), n = bs[(k + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length];
    closePopover(); n.focus(); n.click();
  } else return;
  e.stopPropagation();
});
pop.addEventListener('click', (e) => {
  const x = e.target.closest('[data-ctx]');
  if (x) { const it = ctxItems[+x.dataset.ctx], back = popAnchor; closePopover(); if (back && back.isConnected) back.focus({ preventScroll: true }); if (it && !it.disabled) it.run(); return; }
  const sw = e.target.closest('[data-color]');
  if (sw) { pickColor(sw.dataset.color); const now = swatchNow(); $$('[data-color]', pop).forEach((x) => x.setAttribute('aria-checked', x.dataset.color === now)); return; }
  const b = e.target.closest('[data-cmd]'); if (b) run(b.dataset.cmd);
});
pop.addEventListener('change', (e) => { if (e.target.matches('[data-colorpick]')) { pickColor(e.target.value.toUpperCase()); closePopover(); } });
document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.menubar, #moreBtn, [data-rmenu]')) closePopover(); });
// Drawn again when a feature adds a menu (menuAdd).
function renderMenubar() {
  $('#menubar').innerHTML = MENUS.map(([t], k) => `<button type="button" id="menu-${k}" data-menu="${k}" aria-haspopup="menu" aria-expanded="false" tabindex="${k ? -1 : 0}">${t}</button>`).join('');
  $$('#menubar > button').forEach((b) => b.addEventListener('click', () => {
    const open = b.getAttribute('aria-expanded') === 'true';
    closePopover(); if (open) return;
    b.setAttribute('aria-expanded', 'true'); openPopover(b, menuHtml(MENUS[+b.dataset.menu][1]));
  }));
}
renderMenubar();
// On the menu bar: Left and Right move between menus, Down (or Enter, Space) opens one.
$('#menubar').addEventListener('keydown', (e) => {
  const bs = $$('#menubar > button'), k = bs.indexOf(document.activeElement); if (k < 0) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
    e.preventDefault(); e.stopPropagation();
    const n = bs[e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : (k + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length];
    bs.forEach((b) => { b.tabIndex = b === n ? 0 : -1; }); n.focus();
  } else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); if (bs[k].getAttribute('aria-expanded') !== 'true') bs[k].click(); }
});
// Phones have no menu bar: More (…) in the title bar opens the commands that are only in the menus.
function moreMenuHtml() {
  const onRibbon = new Set(Object.values(RIBBON).flatMap(([, groups]) => groups.flatMap(([, ids]) => Array.isArray(ids) ? ids.flatMap((id) => [id, ...((C[id] && C[id].menu) || [])]) : [])));
  return MENUS.map(([t, ids], k) => {
    const only = ids.filter((id) => id !== '-' && shown(id) && !onRibbon.has(id));
    return only.length ? `<div role="group" aria-labelledby="mh-${k}"><div class="mh" id="mh-${k}">${esc(t)}</div>${menuHtml(only)}</div>` : '';
  }).join('');
}
$('#moreBtn').addEventListener('click', () => {
  const b = $('#moreBtn'), open = b.getAttribute('aria-expanded') === 'true';
  closePopover(); if (open) return;
  b.setAttribute('aria-expanded', 'true'); openPopover(b, moreMenuHtml());
});

/* ---------------- right-click menus ----------------
   On a page in the sidebar, on a page and on a mark. They open with a right-click, Shift+F10 or the menu key
   (for what has focus, or the selected mark) and a long press on a touch screen, and work like the other menus. */
let ctxItems = [], ctxOpened = 0; // ctxOpened: when a long press or a key last opened one, so the browser's own event that follows opens no other
function ctxCmd(id, o = {}) { const c = C[id]; return c && !c.hidden ? { label: c.label, icon: c.icon, key: c.key, disabled: !!(c.enabled && !c.enabled()), run: () => run(id), ...o } : null; }
function openCtx(list, at, anchor, label) {
  const items = [];
  for (const it of list) if (it && !(it === '-' && (!items.length || items[items.length - 1] === '-'))) items.push(it);
  while (items[items.length - 1] === '-') items.pop();
  ctxItems = items;
  const html = items.map((it, k) => it === '-' ? '<div class="msep"></div>' : `<button type="button" class="mi" role="menuitem" data-ctx="${k}"${it.on === undefined ? '' : ' data-chk'}${it.disabled ? ' disabled' : ''}>${menuIcon(it.icon)}<span>${esc(it.label)}</span><span class="k">${fmtKey(it.key)}</span>${menuChk(it.on)}</button>`).join('');
  closePopover(); openPopover(anchor, html, { x: at.x, y: at.y, label });
  return true;
}
// A page in the sidebar: the commands work on that page (or on all the pages chosen there, when it is one of them).
function thumbMenu(t, at) {
  const n = +t.dataset.n;
  if (typeof pg60Valid === 'function' && !pg60Valid().includes(n)) pg60SetSel([]);
  const on = (id, o) => ctxCmd(id, { ...o, run: () => { current = n; markThumb(); run(id); } });
  const was = current; current = n; // what can be done to this page
  const items = [on('rotL'), on('rotR'), '-',
    C.pg60_blankBefore ? on('pg60_blankBefore') : null, C.pg60_blankAfter ? on('pg60_blankAfter') : ctxCmd('blank', { label: 'Insert blank page after', run: () => { current = n; markThumb(); insertBlank(); } }),
    on('pg60_insert', { label: 'Insert from PDF…' }), on('pg60_replace'), '-',
    on('dup'), on('extract'), on('pg60_crop'), '-',
    on('up'), on('down'), on('pg60_toStart'), on('pg60_toEnd'), '-', on('delPage')];
  current = was;
  openCtx(items, at, t, `Page ${n + 1}`); t.classList.add('ctx-for'); // shows which page the menu is for
  return true;
}
// A spot on a page: `cx`, `cy` on screen.
function pageMenu(v, cx, cy, anchor) {
  const b = v.el.getBoundingClientRect(), [x, y] = toPdf(v, cx - b.left, cy - b.top), n = views.indexOf(v);
  const text = String(getSelection() || '').trim();
  return openCtx([
    // text selected: mark it up from here, as from its bar
    ...(text ? [...selActionList().map((a) => ({ label: a.label, icon: a.icon, key: a.key, run: a.run })), '-'] : []),
    { label: 'Paste', icon: 'clipboard-paste', key: 'Mod-v', disabled: !markClip, run: () => pasteMark(null, v, x, y) },
    { label: 'Add comment here', icon: 'message-square-plus', run: () => addNote(v, x, y) },
    '-',
    { label: 'Select tool', icon: 'mouse-pointer-2', on: app.dataset.tool === 'select', run: () => { setTool('select'); pendingImage = null; } },
    { label: 'Rotate page', icon: 'rotate-cw', run: () => { current = n; rotatePage(90); } },
  ], { x: cx, y: cy }, anchor || viewer, `Page ${n + 1}`);
}
// A mark (selected first). A mark type can add commands with `menu: [command ids]`.
function markMenu(v, m, at, anchor) {
  selectMark({ key: pageKey(v.entry), id: m.id, entry: v.entry });
  const own = (FEATURE.markTypes[m.type] && FEATURE.markTypes[m.type].menu) || [];
  return openCtx([
    { label: 'Copy', icon: 'copy', key: 'Mod-c', run: copyMark },
    { label: 'Duplicate', icon: 'copy-plus', key: 'Mod-d', run: duplicateMark },
    { label: 'Delete', icon: 'trash-2', run: deleteSelected },
    '-',
    m.type === 'note' && { label: 'Edit note', icon: 'pencil', run: () => editNote(v, m) },
    m.type === 'text' && { label: 'Edit text', icon: 'pencil', run: () => editText(v, m) },
    ...own.map((id) => ctxCmd(id)),
  ], at, anchor || viewer, 'Mark');
}
const typingIn = (el) => !!el && (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable);
// The menu for whatever is at (x, y) on screen; false when there is none (the browser's own menu shows).
function ctxFor(el, x, y) {
  if (!doc || !el || typingIn(el) || $('#dialog').open) return false;
  const t = el.closest('#sidePanel .thumb, .pg60-cell'); if (t) return thumbMenu(t, { x, y });
  const pe = el.closest('#pages .page'), v = pe && views[+pe.dataset.n]; if (!v || v.el !== pe) return false;
  const hit = el.closest('svg.marks .mk[data-id]'), m = hit && marksOf(v.entry).find((mm) => mm.id === hit.dataset.id);
  return m ? markMenu(v, m, { x, y }) : pageMenu(v, x, y);
}
document.addEventListener('contextmenu', (e) => {
  if (Date.now() - ctxOpened < 700) { e.preventDefault(); return; } // already opened by a long press or a key
  ctxOpened = 0;
  let el = e.target; if (!el || !el.isConnected) el = document.elementFromPoint(e.clientX, e.clientY);
  if (ctxFor(el, e.clientX, e.clientY)) { e.preventDefault(); ctxPressEnd(); }
});
// Shift+F10 and the menu key: for the page in the sidebar that has focus, else the selected mark, else the page in view.
document.addEventListener('keydown', (e) => {
  if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) || !doc || $('#dialog').open) return;
  const a = document.activeElement;
  if (pop.contains(a) || typingIn(a)) return;
  e.preventDefault(); e.stopPropagation(); ctxOpened = Date.now();
  const t = a && a.closest && a.closest('#sidePanel .thumb, .pg60-cell');
  if (t) { const r = t.getBoundingClientRect(); thumbMenu(t, { x: r.left + r.width / 2, y: r.top + r.height / 2 }); return; }
  const m = selectedMark(), mv = m && views.find((x) => x.entry === selMark.entry), me = mv && mv.el.querySelector(`.mk[data-id="${CSS.escape(m.id)}"]`);
  if (me) { const r = me.getBoundingClientRect(); markMenu(mv, m, { x: r.left, y: r.bottom + 4 }); return; }
  const v = views[current]; if (!v) return;
  const b = v.el.getBoundingClientRect(), vr = viewer.getBoundingClientRect();
  pageMenu(v, Math.max(b.left, vr.left) + 40, Math.max(b.top, vr.top) + 40);
}, true);
// A long press (touch): the same menus, for pages in the sidebar, and on the page with the Select tool.
let ctxPress = null;
const ctxPressEnd = () => { if (ctxPress) { clearTimeout(ctxPress.timer); ctxPress = null; } };
document.addEventListener('pointerdown', (e) => {
  ctxPressEnd();
  if (e.pointerType !== 'touch' || !doc || !e.isPrimary || typingIn(e.target)) return;
  const onPage = e.target.closest('#pages .page');
  if (!e.target.closest('#sidePanel .thumb') && !(onPage && app.dataset.tool === 'select')) return;
  const p = ctxPress = { id: e.pointerId, x: e.clientX, y: e.clientY };
  p.timer = setTimeout(() => {
    if (ctxPress !== p) return; ctxPress = null;
    if (Date.now() - ctxOpened < 700 || !ctxFor(document.elementFromPoint(p.x, p.y), p.x, p.y)) return;
    ctxOpened = Date.now();
    // the click that ends the press does nothing else
    const eat = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    window.addEventListener('click', eat, { capture: true, once: true }); setTimeout(() => window.removeEventListener('click', eat, true), 800);
  }, 550);
}, true);
document.addEventListener('pointermove', (e) => { if (ctxPress && e.pointerId === ctxPress.id && Math.hypot(e.clientX - ctxPress.x, e.clientY - ctxPress.y) > 10) ctxPressEnd(); }, true);
document.addEventListener('pointerup', ctxPressEnd, true); document.addEventListener('pointercancel', ctxPressEnd, true);
// Ribbon tabs, in order. A tab with no groups is not shown. Features add groups with ribbonAdd().
const RIBBON = {
  home: ['Home', [['File', ['open', 'save', 'print']], ['Edit', ['undo', 'redo', 'find']], ['View', ['tool_hand', 'vw_layout', 'zoomIn', 'zoomOut', 'zoomFit', 'zoomPage', 'sidebar', 'darkPage'], 'rows']]],
  edit: ['Edit', [['Edit the PDF', ['tool_edit', 'tool_erase']], ['Add', ['tool_text', 'image']]]],
  markup: ['Comment', [['Tools', ['tool_select', 'tool_highlight', 'tool_pen', 'tool_note']], ['Colour', 'COLORS', 'swatches'], ['Shapes', ['tool_rect'], 'icons'], ['Add', ['sign']]]],
  pages: ['Pages', [['Rotate', ['rotR']], ['Order', ['up', 'down', 'dup']], ['Remove', ['delPage', 'extract']]]],
  forms: ['Forms', []],
  protect: ['Protect', []],
  export: ['Export', [['Save', ['save', 'saveCopy', 'share']], ['Export', ['exportImage', 'exportText', 'print']]]],
};
// Adds commands to a ribbon group (made if missing; `before` names a group to put it in front of). `look` makes a
// compact group on wide screens: 'rows' (small buttons with their names, two rows) or 'icons' (a grid of icons).
function ribbonAdd(tab, group, ids, before, look) {
  const t = RIBBON[tab]; if (!t) throw new Error('No ribbon tab ' + tab);
  let g = t[1].find(([label]) => label === group);
  if (!g) { g = [group, []]; const k = before ? t[1].findIndex(([label]) => label === before) : -1; k >= 0 ? t[1].splice(k, 0, g) : t[1].push(g); }
  if (look) g[2] = look;
  for (const id of ids) if (!g[1].includes(id)) g[1].push(id);
}
// Adds commands to a menu (made before Help if missing), after a separator.
function menuAdd(title, ids) {
  let m = MENUS.find(([t]) => t === title);
  if (!m) { m = [title, []]; MENUS.splice(MENUS.findIndex(([t]) => t === 'Help'), 0, m); renderMenubar(); }
  if (m[1].length && m[1][m[1].length - 1] !== '-') m[1].push('-');
  for (const id of ids) if (!m[1].includes(id)) m[1].push(id);
}
// One colour picker for the app: named round swatches, then + (the system picker) for any other colour. `attrs(c)`
// gives each swatch the attributes its code looks for; `pick` those of the colour input (null: no + swatch); `menu`
// makes the swatches menu items (in a popover).
const INK_COLORS = ['#111111', '#5F5F5F', '#E03131', '#2448C9', '#2F9E44', '#E8590C'];
const PALE_COLORS = ['#FFFFFF', '#FFF3BF', '#D3F9D8', '#D0EBFF', '#FFDEEB', '#E9ECEF'];
const colorName = (c) => ({ '#5F5F5F': 'Grey', '#2F9E44': 'Green', '#E8590C': 'Orange', '#000000': 'Black', '#FFFFFF': 'White', '#FFF3BF': 'Pale yellow', '#D3F9D8': 'Pale green', '#D0EBFF': 'Pale blue', '#FFDEEB': 'Pale pink', '#E9ECEF': 'Pale grey' })[String(c).toUpperCase()] || COLOR_NAMES[String(c).toUpperCase()] || c;
function swatchesHtml(colors, { now, attrs = () => '', pick = '', menu = false } = {}) {
  const on = String(now || '').toUpperCase();
  return colors.map((c) => `<button type="button" class="swatch" ${attrs(c)} style="background:${c}" title="${esc(colorName(c))}" aria-label="${esc(colorName(c))}" ${menu ? `role="menuitemradio" aria-checked="${on === c.toUpperCase()}"` : `aria-pressed="${on === c.toUpperCase()}"`}></button>`).join('')
    + (pick === null ? '' : `<label class="swatch sw-more" title="Custom colour…"><input type="color" ${pick} aria-label="Custom colour…">${ic('plus')}</label>`);
}
// Puts a menu's items in this order (by related jobs, as on the ribbon); items it does not name follow, after a separator.
function menuOrder(title, ids) {
  const m = MENUS.find(([t]) => t === title); if (!m) return;
  const rest = m[1].filter((id) => id !== '-' && !ids.includes(id));
  m[1] = [...ids, ...(rest.length ? ['-', ...rest] : [])];
}
const COLORS = ['#FFD43B', '#69DB7C', '#74C0FC', '#F783AC', '#E03131', '#2448C9', '#111111'];
const COLOR_NAMES = { '#FFD43B': 'Yellow', '#69DB7C': 'Green', '#74C0FC': 'Light blue', '#F783AC': 'Pink', '#E03131': 'Red', '#2448C9': 'Blue', '#111111': 'Black' };
// Each drawing tool keeps its own colour (the last one picked for it, else its default here): the pressed swatch is
// always the colour the tool in use draws with. With Select, the swatches are for the selected mark, or else for the
// drawing tool used last. Features add their tools and the marks a swatch can recolour.
const COLOR_TOOLS = { highlight: '#FFD43B', pen: '#2448C9', rect: '#E03131', text: '#111111' };
const COLOR_MARKS = new Set(['hl', 'ink', 'rect', 'text']);
const colorToolNow = () => (app.dataset.tool in COLOR_TOOLS ? app.dataset.tool : S.colorTool in COLOR_TOOLS ? S.colorTool : 'highlight');
const toolColor = (t = colorToolNow()) => (S.toolColor && S.toolColor[t]) || COLOR_TOOLS[t] || '#E03131';
const colorMark = () => { const m = selMark && doc && selectedMark(); return m && COLOR_MARKS.has(m.type) && typeof m.color === 'string' ? m : null; };
const swatchNow = () => { const m = colorMark(); return (m ? m.color : toolColor()).toUpperCase(); };
function pickColor(c) {
  const m = colorMark(), t = colorToolNow();
  // A selected mark takes the colour (one undo step); a drawing tool in use keeps it for its next marks too.
  if (m && m.color.toUpperCase() !== c) { const before = snapshot(); m.color = c; redrawPage(selMark.entry); changed(before); }
  if (!m || app.dataset.tool !== 'select') { S.toolColor = { ...S.toolColor, [t]: c }; saveSettings(); }
  if (!m && app.dataset.tool === 'select') { const tc = C['tool_' + t] || C['cm_' + t.slice(2)] || C[{ cmtype: 'cm_typewriter' }[t]]; toast(`${tc ? tc.label.replace(/…$/, '') : 'Next mark'}: ${COLOR_NAMES[c] || c}`); }
  refreshRibbon();
}
// The commands on a tab that are pressed for the tool in use now (the tool's own buttons, not other toggles).
function toolOnTab(tab) {
  const t = app.dataset.tool, ids = (RIBBON[tab] ? RIBBON[tab][1] : []).flatMap(([, x]) => Array.isArray(x) ? x : []);
  if (t === 'select') return true;
  const probe = () => ids.filter((id) => C[id] && C[id].pressed && C[id].pressed());
  const now = probe(); app.dataset.tool = '__probe'; const other = probe(); app.dataset.tool = t;
  return now.some((id) => !other.includes(id));
}
function chooseTab(k) {
  S.ribbon = k; saveSettings();
  for (const h of FEATURE.onTab || []) h(k);
  // A tool from another tab would stay on unseen (and, say, keep a form from being filled): go back to Select.
  if (!toolOnTab(k)) { setTool('select'); pendingImage = null; }
  renderRibbon();
}
// The ribbon tabs are a tab list: one Tab stop, arrow keys move between tabs, focus stays on the tab chosen.
$('#ribbonTabs').addEventListener('keydown', (e) => tabKeys(e, $$('#ribbonTabs [data-rt]'), (b) => { chooseTab(b.dataset.rt); $(`#ribbonTabs [data-rt="${b.dataset.rt}"]`).focus(); }));
function renderRibbon() {
  const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('#ribbonTabs');
  $('#ribbonTabs').innerHTML = Object.entries(RIBBON).filter(([, [, groups]]) => groups.length).map(([k, [t]]) => `<button type="button" role="tab" id="rt-${k}" data-rt="${k}" aria-controls="ribbonBody" aria-selected="${S.ribbon === k}" tabindex="${S.ribbon === k ? 0 : -1}">${t}</button>`).join('');
  $$('#ribbonTabs [data-rt]').forEach((b) => b.onclick = () => chooseTab(b.dataset.rt));
  if (focused) { const t = $(`#ribbonTabs [data-rt="${S.ribbon}"]`); t && t.focus({ preventScroll: true }); }
  $('#ribbonBody').setAttribute('aria-labelledby', 'rt-' + (RIBBON[S.ribbon] ? S.ribbon : 'home'));
  // Groups for a selection (Picture…) come last, so showing one never moves the tools people already know.
  const [, all] = RIBBON[S.ribbon] || RIBBON.home, onSel = ([, ids]) => Array.isArray(ids) && ids.length > 0 && ids.every((id) => C[id] && C[id].contextual);
  const groups = phoneFold([...all.filter((g) => !onSel(g)), ...all.filter(onSel)]);
  $('#ribbonBody').innerHTML = groups.map(([label, ids, look]) => `<div class="r-group${look ? ' r-' + look : ''}" role="toolbar" aria-label="${esc(label)}"><div class="r-items">${ids === 'COLORS'
    ? swatchesHtml(COLORS, { now: swatchNow(), attrs: (c) => `data-color="${c}"`, pick: `data-colorpick value="${swatchNow().toLowerCase()}"` })
    : ids.filter(shown).map(ribbonButton).join('')}</div><div class="r-label">${label}</div></div>`).join('');
  $$('#ribbonBody [data-color]').forEach((b) => b.onclick = () => pickColor(b.dataset.color));
  $$('#ribbonBody [data-colorpick]').forEach((i) => i.onchange = () => pickColor(i.value.toUpperCase()));
  icons(); refreshRibbon();
  const tabs = $('#ribbonTabs'), tab = $(`[data-rt="${S.ribbon}"]`, tabs);
  if (tab) scrollIntoRow(tabs, tab);
  const on = $('#ribbonBody [aria-pressed="true"]'); if (on) scrollIntoRow($('#ribbonBody'), on); else $('#ribbonBody').scrollLeft = 0;
  ribbonEdges();
}
const foldFaces = () => Object.fromEntries(Object.entries(C).filter(([id, c]) => id.startsWith('fold:') && c.run && $(`#ribbonBody [data-cmd="${id}"]`)).map(([id, c]) => [id.slice(5), c.menu]));
// Phones: a compact group (several small tools) is one button that lists them, and the colours fold into the Style
// button, so a tab like Comment is about one and a half screens wide. A group of 'icons' (Shapes) keeps a face: the
// shape in use, or the one used last, on a split button. Made as commands (fold:<group>) the ribbon draws as usual.
const foldLast = {};
function phoneFold(groups) {
  if (!isPhone()) return groups;
  const out = [], members = (ids) => ids.filter(shown), on = (id) => !!(C[id].pressed && C[id].pressed());
  for (let k = 0; k < groups.length; k++) {
    const [label, ids, look] = groups[k];
    if (look === 'swatches') {
      const next = groups[k + 1], style = next && next[0] === 'Style' && Array.isArray(next[1]) ? members(next[1]) : [];
      if (style.length) k++;
      cmd('fold:Style', { label: 'Style', icon: 'palette', menu: style.length ? style : ['tool_select'], menuHtml: () => foldStyleHtml(style) });
      out.push(['Style', ['fold:Style']]); continue;
    }
    let list = Array.isArray(ids) ? members(ids) : [], name = label;
    // groups of small buttons side by side (Text box, Add) are one button, named after the last of them
    while (look === 'rows' && groups[k + 1] && groups[k + 1][2] === 'rows' && Array.isArray(groups[k + 1][1])) { k++; name = groups[k][0]; list = [...list, ...members(groups[k][1])]; }
    if (!look || list.length < 2) { out.push(groups[k]); continue; }
    const label2 = name, face = () => list.find(on) || (list.includes(foldLast[label2]) ? foldLast[label2] : list[0]);
    cmd('fold:' + name, look === 'icons'
      ? { get label() { return C[face()].label; }, get icon() { return C[face()].icon; }, get rlabel() { return C[face()].rlabel; }, menu: list, pressed: () => on(face()), enabled: () => !C[face()].enabled || C[face()].enabled(), run: () => run(face()) }
      : { label: name, get icon() { return C[list.find(on) || list[0]].icon; }, menu: list, pressed: () => list.some(on) });
    out.push([name, ['fold:' + name]]);
  }
  return out;
}
// The Style button's list: the colours (as on the Comment tab), then the group's own commands; one with `sub` (a list
// of command ids) shows them under its name.
matchMedia(PHONE_MQ).addEventListener('change', () => renderRibbon()); // a phone turned, or a window made narrow
Object.assign(TEST_HOOKS, { menus: () => MENUS, S, docMarks: () => docMarks() });
function foldStyleHtml(ids) {
  const now = swatchNow();
  let html = `<div class="pop-sw" role="group" aria-label="Colour">${swatchesHtml(COLORS, { now, attrs: (c) => `data-color="${c}"`, pick: `data-colorpick value="${now.toLowerCase()}"`, menu: true })}</div>`;
  for (const id of ids) html += '<div class="msep"></div>' + (C[id].sub ? `<div role="group" aria-label="${esc(C[id].subLabel || C[id].label)}"><div class="mh" aria-hidden="true">${esc(C[id].subLabel || C[id].label)}</div>${menuHtml(C[id].sub)}</div>` : menuHtml([id]));
  return html;
}
// A ribbon button. A command with `menu` (a list of command ids) gets a small arrow beside it that opens them.
function ribbonButton(id) {
  const c = C[id], label = c.rlabel || c.label.replace(/…$/, '').replace(/^Appearance: /, '');
  const b = `<button type="button" class="rb" data-cmd="${id}" title="${esc((c.tip || c.label) + (c.key ? ' (' + fmtKey(c.key) + ')' : ''))}">${ic(c.icon)}<span>${esc(label)}</span></button>`;
  if (!c.menu) return b;
  if (!c.run) return `<button type="button" class="rb" data-rmenu="${id}" aria-haspopup="menu" aria-expanded="false" title="${esc(c.label)}">${ic(c.icon)}<span>${esc(label)}${ic('chevron-down')}</span></button>`;
  const more = `More ${label.toLowerCase()} options`;
  return `<span class="rb-split">${b}<button type="button" class="rb-more" data-rmenu="${id}" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(more)}" title="${esc(more)}">${ic('chevron-down')}</button></span>`;
}
function openRibbonMenu(id) {
  const b = $(`#ribbonBody [data-rmenu="${id}"]`); if (!b || !C[id] || !C[id].menu) return;
  b.setAttribute('aria-expanded', 'true'); openPopover(b.closest('.rb-split') || b, C[id].menuHtml ? C[id].menuHtml() : menuHtml(C[id].menu)); popAnchor = b;
}
$('#ribbonBody').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rmenu]'); if (!b) return;
  const open = b.getAttribute('aria-expanded') === 'true'; closePopover();
  if (!open) openRibbonMenu(b.dataset.rmenu);
});
// Scrolls a row sideways just enough to show el (never the page up or down).
function scrollIntoRow(row, el) {
  const r = row.getBoundingClientRect(), b = el.getBoundingClientRect(), pad = 48;
  if (b.left < r.left + pad) row.scrollLeft -= r.left + pad - b.left;
  else if (b.right > r.right - pad) row.scrollLeft += b.right - (r.right - pad);
}
// A row with more to see past an edge fades at that edge; the ribbon also shows a small arrow there (for a mouse).
function ribbonEdges() {
  for (const row of [$('#ribbonBody'), $('#ribbonTabs')]) {
    row.classList.toggle('more-l', row.scrollLeft > 1);
    row.classList.toggle('more-r', row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
  }
  const b = $('#ribbonBody'), r = b.parentElement;
  r.classList.toggle('more-l', b.classList.contains('more-l')); r.classList.toggle('more-r', b.classList.contains('more-r'));
}
$('#ribbonBody').addEventListener('scroll', ribbonEdges, { passive: true });
// A mouse wheel that only scrolls up and down moves a wide ribbon sideways.
$('#ribbonBody').addEventListener('wheel', (e) => {
  const b = e.currentTarget; if (e.ctrlKey || b.scrollWidth <= b.clientWidth + 1 || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
  e.preventDefault(); b.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; ribbonEdges();
}, { passive: false });
$$('.r-scroll').forEach((a) => {
  a.addEventListener('mousedown', (e) => e.preventDefault()); // keeps the focus where it is
  a.addEventListener('click', () => { const b = $('#ribbonBody'); b.scrollBy({ left: +a.dataset.dir * Math.max(120, b.clientWidth * .7), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); });
});
$('#ribbonTabs').addEventListener('scroll', ribbonEdges, { passive: true });
window.addEventListener('resize', ribbonEdges);
// Keyboard focus that lands on a button out of view brings it into view.
/* Each ribbon group is a toolbar with one Tab stop (the button last used there, or else the one pressed, or the first):
   Tab and Shift+Tab move between groups, the arrow keys (and Home, End) within one, Down opens a button's list. */
const rbLast = {}; // tab:group -> the item last focused in it
const rbKey = (b) => b.dataset.cmd || (b.dataset.rmenu ? 'menu:' + b.dataset.rmenu : '') || (b.dataset.color ? 'color:' + b.dataset.color : '') || (b.matches('[data-colorpick]') ? 'pick' : '');
const rbItems = (g) => $$('button:not([disabled]), input:not([disabled])', g).filter((b) => !b.closest('[hidden]'));
const rbGroupKey = (g) => S.ribbon + ':' + g.getAttribute('aria-label');
function rbRoving() {
  $$('#ribbonBody .r-group').forEach((g) => {
    const items = rbItems(g), want = rbLast[rbGroupKey(g)];
    const cur = (want && items.find((b) => rbKey(b) === want)) || items.find((b) => b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-checked') === 'true') || items[0];
    $$('button, input', g).forEach((b) => { b.tabIndex = b === cur ? 0 : -1; });
  });
}
$('#ribbonBody').addEventListener('focusin', (e) => {
  const g = e.target.closest('.r-group'); if (!g || !rbKey(e.target)) return;
  rbLast[rbGroupKey(g)] = rbKey(e.target);
  $$('button, input', g).forEach((b) => { b.tabIndex = b === e.target ? 0 : -1; });
});
$('#ribbonBody').addEventListener('keydown', (e) => {
  const g = e.target.closest('.r-group'); if (!g || e.altKey || e.ctrlKey || e.metaKey) return;
  const items = rbItems(g), k = items.indexOf(e.target); if (k < 0) return;
  const menu = e.target.closest('[data-rmenu]');
  if (e.key === 'ArrowDown' && menu) { e.preventDefault(); e.stopPropagation(); if (menu.getAttribute('aria-expanded') !== 'true') { closePopover(); openRibbonMenu(menu.dataset.rmenu); } return; }
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  const n = step ? items[(k + step + items.length) % items.length] : e.key === 'Home' ? items[0] : e.key === 'End' ? items[items.length - 1] : null;
  if (!n) return;
  e.preventDefault(); e.stopPropagation(); n.focus();
});
$('#ribbonBody').addEventListener('focusin', (e) => { const b = e.target.closest('button'); if (b && b.matches(':focus-visible')) scrollIntoRow($('#ribbonBody'), b); });
function refreshRibbon() {
  $$('#ribbonBody [data-cmd]').forEach((b) => { const c = C[b.dataset.cmd]; b.disabled = !!(c.enabled && !c.enabled()); if (c.pressed) b.setAttribute('aria-pressed', !!c.pressed()); });
  $$('#ribbonBody [data-rmenu]').forEach((b) => {
    const c = C[b.dataset.rmenu]; b.disabled = !c.menu.some((id) => id !== '-' && shown(id) && (!C[id].enabled || C[id].enabled()));
    if (!c.run && c.pressed) b.toggleAttribute('data-on', !!c.pressed());
  });
  for (const [g, list] of Object.entries(foldFaces())) {
    const now = list.find((id) => C[id].pressed && C[id].pressed()); if (now) foldLast[g] = now;
    const b = $(`#ribbonBody [data-cmd="fold:${g}"]`), c = C['fold:' + g];
    if (b && b.dataset.face !== (c.rlabel || c.label)) { b.dataset.face = c.rlabel || c.label; b.title = c.label; b.innerHTML = `${ic(c.icon)}<span>${esc(c.rlabel || c.label.replace(/…$/, ''))}</span>`; icons(); }
  }
  const sw = $('#ribbonBody [data-color]') && swatchNow(); $$('#ribbonBody [data-color]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.color === sw));
  // A group of commands that only work on a selection (a picture…) shows only while they can be used.
  let shift = false, appeared = null;
  $$('#ribbonBody .r-group').forEach((g) => {
    const bs = $$('[data-cmd]', g); if (!bs.length || !bs.every((b) => C[b.dataset.cmd].contextual)) return;
    g.classList.add('r-ctx');
    const hide = bs.every((b) => b.disabled); if (g.hidden !== hide) { g.hidden = hide; shift = true; if (!hide) appeared = g; }
  });
  // One that appears is scrolled into view, whole (it comes last, so it may start past the edge).
  if (appeared) {
    const row = $('#ribbonBody'), r = row.getBoundingClientRect(), b = appeared.getBoundingClientRect();
    if (b.right > r.right - 8 || b.left < r.left) row.scrollTo({ left: Math.max(0, Math.min(row.scrollLeft + b.left - r.left - 16, row.scrollLeft + b.right - r.right + 16)), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  if (shift) ribbonEdges();
  $('#saveBtn').disabled = !has();
  $$('.tb-actions .tb-undo[data-cmd]').forEach((b) => { const c = C[b.dataset.cmd]; b.disabled = !!(c.enabled && !c.enabled()); });
  $$('[data-cmd="undo"], [data-cmd="redo"]').forEach((b) => { if (pop.contains(b)) return; const c = C[b.dataset.cmd], t = c.label + (c.key ? ' (' + fmtKey(c.key) + ')' : ''); if (b.title !== t) { b.title = t; if (b.hasAttribute('aria-label')) b.setAttribute('aria-label', c.label); } });
  rbRoving();
  scheduleMacMenu();
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-cmd]'); if (b && !pop.contains(b)) run(b.dataset.cmd); });

/* ---------------- keys ---------------- */
document.addEventListener('keydown', (e) => {
  if ($('#dialog').open) return;
  if (!pop.hidden && pop.contains(document.activeElement)) return; // the menu's own keys
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  // A selected mark: copy, paste and duplicate it (text being selected or typed keeps the usual keys).
  if (mod && !typing && !e.shiftKey && !e.altKey && ['c', 'v', 'd'].includes(e.key.toLowerCase())) {
    const k = e.key.toLowerCase(), noText = !String(getSelection() || '').length;
    const done = k === 'c' ? noText && copyMark() : k === 'v' ? pasteMark() : duplicateMark();
    if (done) e.preventDefault();
    return;
  }
  if (mod) {
    const key = (e.shiftKey ? 'Shift-' : '') + (e.altKey ? 'Alt-' : '') + e.key.toLowerCase();
    const map = { 'o': 'open', 's': 'save', 'shift-s': 'saveCopy', 'p': 'print', 'z': 'undo', 'shift-z': 'redo', 'y': 'redo', 'f': 'find', '=': 'zoomIn', '+': 'zoomIn', '-': 'zoomOut', '0': 'zoomPage', '1': 'zoom100', '2': 'zoomFit', 'r': 'rotR', 'alt-s': 'sidebar' };
    const id = map[key.replace('Shift-', 'shift-').replace('Alt-', 'alt-')];
    if (id && !(typing && ['z', 'shift-z', 'y'].includes(key.toLowerCase()))) { e.preventDefault(); run(id); }
    return;
  }
  if (typing) return;
  if (e.key === 'Enter' && doc && keyPlaces(app.dataset.tool)) {
    // on the page, or still on the button that chose the tool (Enter there would only choose it again)
    const a = document.activeElement, c = a && a.dataset && C[a.dataset.cmd];
    if (!a || a === document.body || a.closest('#viewer') || (c && (a.dataset.cmd === app.dataset.tool || (c.pressed && c.pressed())))) { e.preventDefault(); placeByKey(); return; }
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && (selMark || selContent)) { e.preventDefault(); deleteSelected(); }
  if (e.key === 'Escape') { if (!pop.hidden) closePopover(); else if (app.dataset.sidebar === 'open' && isPhone()) toggleSidebar(false); else if (!$('#findbar').hidden) closeFind(); else if (selContent) selectContent(null); else { setTool('select'); pendingImage = null; selectMark(null); } }
  // Arrow keys move a selected mark (tab lists and menus handle their own arrows before this).
  if (/^Arrow/.test(e.key) && !e.altKey && selMark) { e.preventDefault(); nudgeMark(e.key, e.shiftKey); return; }
  if (/^Arrow/.test(e.key) && e.altKey && e.shiftKey && selMark) { e.preventDefault(); sizeMark(e.key); return; }
  // The arrows turn the page only from the page itself: on a button, swatch, tab or menu they stay with it.
  const a = document.activeElement;
  if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && a && a.matches && a.matches('[data-color]')) { // colour swatches: move along the row
    const bs = $$('[data-color]', a.parentElement), n = bs[(bs.indexOf(a) + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length];
    e.preventDefault(); if (n) n.focus(); return;
  }
  const onPage = !a || a === document.body || a === viewer || (viewer.contains(a) && !a.closest('button, a, [role], [tabindex]:not(#viewer)'));
  if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !e.altKey && onPage)) { if (doc) { e.preventDefault(); goPage(current + 1); } }
  if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && !e.altKey && onPage)) { if (doc) { e.preventDefault(); goPage(current - 1); } }
});

/* ---------------- theme ---------------- */
function applyTheme() {
  scheduleMacMenu();
  const root = document.documentElement;
  if (S.theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', S.theme);
  app.dataset.darkpage = S.darkPage ? 'on' : 'off';
  $('#themeBtn').innerHTML = ic({ system: 'sun-moon', light: 'sun', dark: 'moon' }[S.theme]);
  $('#themeBtn').title = { system: 'Theme: match system', light: 'Theme: light', dark: 'Theme: dark' }[S.theme];
  $('#themeBtn').setAttribute('aria-label', $('#themeBtn').title); // its name says the theme now
  icons();
}
$('#themeBtn').onclick = () => { S.theme = { system: 'light', light: 'dark', dark: 'system' }[S.theme]; saveSettings(); applyTheme(); toast($('#themeBtn').title); };
window.addEventListener('beforeunload', (e) => { if (doc && doc.dirty && doc.handle) { e.preventDefault(); e.returnValue = ''; } });

/*FEATURES*/

/* ---------------- the apps ---------------- */
// Files the system asked us to open: Finder (Mac), Open With from Files or Mail (iPhone, iPad), Open with (Android).
// Returns how many opened. Runs inside serial(), like every other open.
async function takeOpened() {
  let files = [], opened = 0;
  try { files = await NATIVE.core.invoke('take_opened_files'); } catch {}
  for (const f of files || []) {
    try {
      if (f.content) { if (await openBytes(b64ToBytes(f.content), f.name, MAC_APP ? f.path : null, MAC_APP ? await fileTime(f.path) : 0)) opened++; }
      else if (f.path.includes('://') && NATIVE.fs) { if (await openBytes(new Uint8Array(await NATIVE.fs.readFile(f.path)), await contentName(f.path))) opened++; }
    } catch (e) { toast(`Could not open that file: ${e}`); }
  }
  return opened;
}
// Android "Open with" hands over a content:// address: ask Android for the file's real name.
async function contentName(uri) {
  try { const r = await NATIVE.core.invoke('plugin:sharekit|native', { method: 'displayName', args: { uri } }); if (r && r.name) return r.name; } catch {}
  let last = uri;
  try { last = decodeURIComponent(uri); } catch {}
  last = last.split(/[/:]/).pop() || '';
  return /\.pdf$/i.test(last) ? last : 'Document.pdf';
}
// Mac updates: a signed in-place update when the release has one, otherwise the downloads page.
const RELEASES_PAGE = 'https://github.com/bradleycowdrey/cowdrey-pdf/releases/latest';
const RELEASES_API = 'https://api.github.com/repos/bradleycowdrey/cowdrey-pdf/releases/latest';
const isNewer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
async function checkForUpdates(manual) {
  if (!MAC_APP) return;
  if (manual) toast('Checking for updates…');
  if (MAC_APP.updater) {
    let update = null, ok = false;
    try { update = await MAC_APP.updater.check(); ok = true; } catch {}
    if (ok) {
      store.set('updateChecked', Date.now());
      if (!update) { if (manual) toast(`You have the latest version (${VERSION}).`); return; }
      if (!manual && store.get('skipVersion', '') === update.version) return;
      const a = await dialog(`Cowdrey.PDF ${update.version} is available`, `<p>You have version ${esc(VERSION)}. Cowdrey.PDF will keep your documents, install the update and reopen.</p>`, [{ label: 'Skip this version', value: 'skip' }, { label: 'Later' }, { label: 'Install and restart', value: 'go', primary: true }]);
      if (a === 'skip') store.set('skipVersion', update.version);
      if (a !== 'go') return;
      try {
        toast('Downloading the update…');
        clearTimeout(persistTimer); await persistNow();
        await update.downloadAndInstall();
        await MAC_APP.core.invoke('allow_exit').catch(() => {});
        await MAC_APP.process.relaunch();
      } catch (e) { if (await dialog('The update could not be installed', `<p>${esc(e.message || String(e))}</p><p>You can download the new version from the downloads page.</p>`, [{ label: 'Close' }, { label: 'Open downloads page', value: 'go', primary: true }]) === 'go') openExternal(RELEASES_PAGE); }
      return;
    }
  }
  let rel;
  try { const r = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' }); if (!r.ok) throw new Error(`GitHub answered ${r.status}`); rel = await r.json(); }
  catch (e) { if (manual && await dialog('Could not check for updates', `<p>${esc(e.message || String(e))}. Check your internet connection, or see the downloads page.</p>`, [{ label: 'Close' }, { label: 'Open downloads page', value: 'go', primary: true }]) === 'go') openExternal(RELEASES_PAGE); return; }
  store.set('updateChecked', Date.now());
  const latest = String(rel.tag_name || '').replace(/^v/i, '');
  if (!latest || !isNewer(latest, VERSION)) { if (manual) toast(`You have the latest version (${VERSION}).`); return; }
  if (!manual && store.get('skipVersion', '') === latest) return;
  const file = (rel.assets || []).find((x) => /\.dmg$/i.test(x.name));
  const a = await dialog(`Cowdrey.PDF ${latest} is available`, `<p>You have version ${esc(VERSION)}. Download the new version, open it, and drag Cowdrey.PDF into Applications to replace this one. Your documents are kept.</p>`, [{ label: 'Skip this version', value: 'skip' }, { label: 'Later' }, { label: 'Download', value: 'go', primary: true }]);
  if (a === 'skip') store.set('skipVersion', latest);
  if (a === 'go') { openExternal(file ? file.browser_download_url : (rel.html_url || RELEASES_PAGE)); toast('Downloading in your browser'); }
}
// Quitting with changes not yet saved to the file they came from: ask first (the app waits for the answer).
let quitAsked = false;
async function beforeQuit() {
  if (quitAsked) return; // already asking: that answer decides
  const ask = !!(doc && doc.dirty && doc.path);
  // Hold the quit before anything slow, so the app doesn't close before the question appears.
  if (ask) { quitAsked = true; await NATIVE.core.invoke('hold_quit', { hold: true }).catch(() => {}); }
  clearTimeout(persistTimer);
  try { await persistNow(); } catch {}
  if (ask) {
    const a = await dialog(`Save changes to ${doc.name}?`, '<p>Your changes are kept in Recent on this Mac either way. Saving also updates the file.</p>', [{ label: 'Cancel' }, { label: "Don't save", value: 'no' }, { label: 'Save', value: 'save', primary: true }]);
    quitAsked = false;
    if (!a || (a === 'save' && !(await savePdf(false)))) { await NATIVE.core.invoke('hold_quit', { hold: false }).catch(() => {}); return; }
  }
  NATIVE.core.invoke('quit_app').catch(() => {});
}
const ACCEL = { 'Mod-o': 'CmdOrCtrl+O', 'Mod-s': 'CmdOrCtrl+S', 'Mod-Shift-s': 'CmdOrCtrl+Shift+S', 'Mod-p': 'CmdOrCtrl+P', 'Mod-z': 'CmdOrCtrl+Z', 'Mod-Shift-z': 'CmdOrCtrl+Shift+Z', 'Mod-f': 'CmdOrCtrl+F', 'Mod-=': 'CmdOrCtrl+=', 'Mod--': 'CmdOrCtrl+-', 'Mod-0': 'CmdOrCtrl+0', 'Mod-1': 'CmdOrCtrl+1', 'Mod-2': 'CmdOrCtrl+2', 'Mod-r': 'CmdOrCtrl+R', 'Mod-Alt-s': 'CmdOrCtrl+Alt+S', 'Mod-Shift-r': 'CmdOrCtrl+Shift+R' };
// The Mac menu bar, built from the same menus. Undo and Redo are the app's own (the PDF edits), and Cut, Copy,
// Paste and Select All are the system's, for text fields. Checkmarks are rebuilt whenever something changes.
var lastMenu = '', menuTimer = null; // var: applyTheme can run before this line
function macMenu() {
  if (!MAC_APP) return;
  // Only a real switch is a check item: a command that opens a window (its name ends in …) never is (Apple's HIG).
  const item = (id) => ({ kind: 'item', id: 'cmd:' + id, label: C[id].label, accel: ACCEL[C[id].key] || null, checked: C[id].pressed && !/…$/.test(C[id].label) ? !!C[id].pressed() : null });
  const menus = MENUS.map(([title, ids]) => {
    // About and Check for Updates live in the Cowdrey.PDF menu.
    let items = ids.filter((id) => shown(id) && id !== 'about' && id !== 'checkUpdates').map((id) => id === '-' ? { kind: 'sep' } : item(id));
    if (title === 'Edit') {
      const rest = items.filter((x) => x.id !== 'cmd:undo' && x.id !== 'cmd:redo');
      while (rest.length && rest[0].kind === 'sep') rest.shift();
      items = [item('undo'), item('redo'), { kind: 'sep' }, { kind: 'native', role: 'cut' }, { kind: 'native', role: 'copy' }, { kind: 'native', role: 'paste' }, { kind: 'native', role: 'select_all' }, { kind: 'sep' }, ...rest];
    }
    items = items.filter((x, k, a) => x.kind !== 'sep' || (k > 0 && k < a.length - 1 && a[k - 1].kind !== 'sep')); // no separator at an end, or two together
    return { title, items };
  });
  const json = JSON.stringify(menus);
  if (json === lastMenu) return;
  lastMenu = json;
  MAC_APP.core.invoke('set_menu', { menus }).then(() => document.documentElement.classList.add('mac-app'), () => { lastMenu = ''; });
}
function scheduleMacMenu() { if (!MAC_APP) return; clearTimeout(menuTimer); menuTimer = setTimeout(macMenu, 120); }
if (NATIVE) {
  NATIVE.event.listen('open-files', () => serial(takeOpened));
  NATIVE.event.listen('menu-command', (e) => {
    const id = String(e.payload);
    // In a text field (a dialog, a form field), Undo and Redo edit the text, as everywhere on the Mac.
    const el = document.activeElement;
    if ((id === 'undo' || id === 'redo') && el && (/INPUT|TEXTAREA/.test(el.tagName) || el.isContentEditable)) { document.execCommand(id); return; }
    run(id); scheduleMacMenu();
  });
  // Quitting: keep Documents up to date, and ask about unsaved changes to a file; the app waits for this.
  NATIVE.event.listen('flush-and-quit', beforeQuit);
  macMenu();
}

/* ---------------- start ---------------- */
applyTheme();
app.dataset.sidebar = S.sidebar ? 'on' : 'off';
syncSideTabs();
renderRibbon(); renderSide(); updateStatus(); icons();
// A file the app was opened with (Finder, Files, Open with) comes first; otherwise the last document comes back.
serial(async () => {
  if (NATIVE && (await takeOpened())) return;
  // bradcowdrey.com/cowdrey-pdf/app?sample (the live demo on the product page) opens the sample.
  if (/[?&]sample\b/.test(location.search)) { await openSample(); return; }
  const last = store.get('current', null);
  if (last && !doc) { try { await openStored(last); } catch (e) { console.warn(e); } }
});
if (MAC_APP && Date.now() - (store.get('updateChecked', 0) || 0) > 864e5) setTimeout(() => checkForUpdates(false), 8000);
// For tests and automation
window.__cowdreyPdf = { ...TEST_HOOKS, get doc() { return doc; }, openBytes, buildPdf, run, setTool, views: () => views, highlightSelection, get current() { return current; }, contentMap: (n) => contentMap(views[n].page), tokenize: (t) => tokenizeContent(t).length };
