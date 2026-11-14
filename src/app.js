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
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }

/* ---------------- features ----------------
   Feature modules in src/features/*.js are joined into this file by build.py (where /*FEATURES*\/ stands, before
   the apps and start sections) and plug in through this registry. See src/features/README.md. */
const FEATURE = {
  markTypes: {},   // type -> { draw(v, m, svg) -> SVG element, save: async ({ L, out, p, m, entry, ctx }), under?: true (drawn and saved before other marks), move?(m, orig, dx, dy) }
  tools: {},       // tool id -> { down(e, v), move?(e, v) } — pointer handling on the page while the tool is chosen
  savePage: [],    // async ({ L, out, p, entry, n, entries, marks, ctx }) — after a page's marks are saved
  saveDoc: [],     // async ({ L, out, pages, entries, ctx }) — after every page, before the file is written
  afterRender: [], // (v) — after a page is drawn on screen
  onDocShown: [],  // (doc) — when a document is shown
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
function setTitle() { $('#docTitle').textContent = doc ? doc.name : 'Cowdrey.PDF'; document.title = doc ? `${doc.name} · Cowdrey.PDF` : 'Cowdrey.PDF'; }
// `opened`: the document was just opened, not saved. An unedited file says nothing; one that comes back from
// Documents with changes says they are kept there.
function setSaved(saved, opened) {
  if (doc) doc.dirty = !saved;
  const kept = opened && doc && Object.values(doc.marks).some((l) => l && l.length);
  $('#saveState').innerHTML = !doc || (opened && !kept) ? '' : opened ? 'Changes kept in Documents' : saved ? `${ic('check')} Saved` : (doc.path ? 'Edited · Save to update the file' : 'Edited · Save PDF to keep a copy');
  icons();
}

/* ---------------- rendering ---------------- */
const viewer = $('#viewer'), pagesEl = $('#pages');
async function pageOf(entry) { return pdfDocs.get(entry.src).getPage(entry.i + 1); }
function fitScale(page, entry) {
  const v = page.getViewport({ scale: 1, rotation: (page.rotate + entry.rot) % 360 });
  // Fit the width, but no larger than 150%: a page wider than that reads worse, not better.
  return Math.max(0.25, Math.min(1.5, (viewer.clientWidth - 48) / v.width));
}
let io;
async function layoutPages(keep) {
  if (!doc) return;
  closeLineEditor(true); selContent = null;
  const anchor = keep ? current : 0;
  pagesEl.innerHTML = '';
  views = [];
  if (!doc.pages.length) { pagesEl.innerHTML = '<p class="empty-note">This PDF has no pages left. Insert a page or undo.</p>'; updateStatus(); return; }
  const first = await pageOf(doc.pages[0]);
  scale = S.zoom === 'fit' ? fitScale(first, doc.pages[0]) : S.zoom / 100;
  io && io.disconnect();
  io = new IntersectionObserver((ents) => { for (const e of ents) if (e.isIntersecting) renderView(views[+e.target.dataset.n]); }, { root: viewer, rootMargin: '600px 0px' });
  for (let n = 0; n < doc.pages.length; n++) {
    const entry = doc.pages[n];
    const page = await pageOf(entry);
    const viewport = page.getViewport({ scale, rotation: (page.rotate + entry.rot) % 360 });
    const el = document.createElement('div');
    el.className = 'page'; el.dataset.n = n;
    el.style.width = viewport.width + 'px'; el.style.height = viewport.height + 'px';
    el.style.setProperty('--scale-factor', scale); el.style.setProperty('--total-scale-factor', scale); el.style.setProperty('--user-unit', 1);
    el.setAttribute('aria-label', `Page ${n + 1}`);
    pagesEl.appendChild(el);
    views.push({ el, entry, viewport, page, rendered: false });
    io.observe(el);
  }
  updateZoomLabel();
  if (keep) goPage(anchor, true);
  updateStatus();
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
    await page.render({ annotationCanvasMap: canvasMap, canvas, canvasContext: canvas.getContext('2d'), viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null, annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS, annotationStorage: pd.annotationStorage }).promise;
  } catch (e) { if (!/cancel/i.test(String(e))) console.warn(e); }
  if (stale()) return;
  // Text you can select and search
  try {
    const tl = document.createElement('div'); tl.className = 'textLayer'; el.appendChild(tl);
    await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport }).render();
  } catch (e) { console.warn('text layer', e); }
  if (stale()) return;
  // Form fields and links
  try {
    let annots = await page.getAnnotations({ intent: 'display' });
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
    }
  } catch (e) { console.warn('annotation layer', e); }
  if (marksOf(v.entry).some((m) => m.type === 'te')) { try { v.page._cmapValue = await contentMap(page); } catch {} }
  if (stale()) return;
  drawMarks(v);
  for (const f of FEATURE.afterRender) { try { f(v); } catch (e) { console.warn(e); } }
  if (findState.q) paintFind(v);
}
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
function goPage(n, instant) {
  if (!views.length) return;
  n = Math.max(0, Math.min(views.length - 1, n));
  current = n;
  viewer.scrollTo({ top: views[n].el.offsetTop - 16, behavior: instant || reduceMotion.matches ? 'instant' : 'smooth' });
  updateStatus();
}
viewer.addEventListener('scroll', () => {
  if (!views.length) return;
  const mid = viewer.scrollTop + viewer.clientHeight / 3;
  let n = 0;
  for (let k = 0; k < views.length; k++) if (views[k].el.offsetTop <= mid) n = k;
  if (n !== current) { current = n; updateStatus(); markThumb(); }
}, { passive: true });
function updateStatus() {
  $('#pageCount').textContent = doc ? doc.pages.length : 0;
  if (document.activeElement !== $('#pageJump')) $('#pageJump').value = doc && doc.pages.length ? current + 1 : '';
  refreshRibbon();
}
$('#pageJump').addEventListener('change', (e) => { const n = parseInt(e.target.value, 10); if (n) goPage(n - 1); });
function setZoom(z) { S.zoom = z; saveSettings(); layoutPages(true); }
function updateZoomLabel() {
  $('#zoomLabel').textContent = S.zoom === 'fit' ? `Fit · ${Math.round(scale * 100)}%` : `${S.zoom}%`;
  $('#zoomRange').value = Math.round(scale * 100);
}
$('#zoomRange').addEventListener('change', (e) => setZoom(+e.target.value));
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (doc && S.zoom === 'fit') layoutPages(true); }, 200); });

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
    g.dataset.id = m.id;
    if (selMark && selMark.id === m.id) g.classList.add('sel');
    svg.appendChild(g);
  }
  drawSelection(v, svg);
}
function redrawPage(entry) { for (const v of views) if (v.entry === entry && v.rendered) drawMarks(v); }
function snapshot() { return JSON.stringify({ pages: doc.pages, marks: doc.marks }); }
function changed(before) {
  undoStack.push(before); if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  setSaved(false); persist(); refreshRibbon();
}
function restore(s, layout) {
  const o = JSON.parse(s); doc.pages = o.pages; doc.marks = o.marks; selMark = null; selContent = null;
  syncHiddenComments();
  layout ? layoutPages(true).then(renderSide) : views.forEach((v) => v.rendered && drawMarks(v));
  setSaved(false); persist(); refreshRibbon();
}
function undo() { if (!undoStack.length) return; const now = snapshot(); const prev = undoStack.pop(); redoStack.push(now); restore(prev, JSON.parse(prev).pages.length !== doc.pages.length || prev.includes('"rot"') && prev !== now); }
function redo() { if (!redoStack.length) return; const now = snapshot(); const next = redoStack.pop(); undoStack.push(now); restore(next, true); }
function localPoint(e, v) { const r = v.el.getBoundingClientRect(); return [(e.clientX - r.left), (e.clientY - r.top)]; }
function onMarksDown(e, v) {
  const tool = app.dataset.tool;
  if (tool === 'edit') return onEditDown(e, v);
  if (tool === 'erase') return startErase(e, v);
  if (FEATURE.tools[tool]) return FEATURE.tools[tool].down(e, v);
  const hit = e.target.closest('.mk');
  if (tool === 'select') {
    if (!hit) { selectMark(null); return; }
    selectMark({ key: pageKey(v.entry), id: hit.dataset.id, entry: v.entry });
    const m = marksOf(v.entry).find((x) => x.id === hit.dataset.id);
    if (m && m.type === 'note' && e.detail === 2) { editNote(v, m); return; }
    if (m && m.type === 'text' && e.detail === 2) { editText(v, m); return; }
    startMove(e, v, m);
    return;
  }
  const [px, py] = localPoint(e, v);
  const [x, y] = toPdf(v, px, py);
  if (tool === 'pen') return startInk(e, v);
  if (tool === 'rect') return startRect(e, v);
  if (tool === 'text') { e.preventDefault(); return addText(v, x, y); }
  if (tool === 'note') { e.preventDefault(); return addNote(v, x, y); }
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
function selectMark(s) { selMark = s; views.forEach((v) => v.rendered && drawMarks(v)); refreshRibbon(); }
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
// Copy, paste and duplicate the selected mark. A paste lands on the page in view, 10 pt down and right of the
// original (or of the last paste), and is selected.
let markClip = null;
function copyMark() { const m = selectedMark(); if (!m) return false; markClip = { m: JSON.stringify(m), n: 0 }; toast('Copied'); return true; }
function pasteMark(src) {
  const clip = src || markClip; if (!clip || !has()) return false;
  const entry = src ? selMark.entry : doc.pages[current];
  const m = JSON.parse(clip.m), k = ++clip.n * 10;
  m.id = uid(); delete m.pending;
  const before = snapshot();
  offsetMark(m, JSON.parse(clip.m), k, -k);
  marksOf(entry).push(m); changed(before);
  selectMark({ key: pageKey(entry), id: m.id, entry });
  return true;
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
  const m = { id: uid(), type: 'ink', pts: [toPdf(v, ...localPoint(e, v))], color: S.color === '#FFD43B' ? '#2448C9' : S.color, w: S.width };
  marksOf(v.entry).push(m);
  const move = (ev) => { m.pts.push(toPdf(v, ...localPoint(ev, v))); drawMarks(v); };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (m.pts.length < 2) m.pts.push(m.pts[0]); drawMarks(v); changed(before); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
function startRect(e, v) {
  e.preventDefault();
  const before = snapshot();
  const [x, y] = toPdf(v, ...localPoint(e, v));
  const m = { id: uid(), type: 'rect', x1: x, y1: y, x2: x, y2: y, color: S.color === '#FFD43B' ? '#E03131' : S.color, w: S.width };
  marksOf(v.entry).push(m);
  const move = (ev) => { [m.x2, m.y2] = toPdf(v, ...localPoint(ev, v)); drawMarks(v); };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    if (Math.abs(m.x2 - m.x1) < 3 && Math.abs(m.y2 - m.y1) < 3) { marksOf(v.entry).splice(marksOf(v.entry).indexOf(m), 1); drawMarks(v); return; }
    changed(before);
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
async function addText(v, x, y) {
  const text = await askText('Add text', 'Type the text to place on the page.', '', 'Add', false, true);
  if (!text) return;
  const before = snapshot();
  marksOf(v.entry).push({ id: uid(), type: 'text', x, y, text, size: 14, color: S.color === '#FFD43B' ? '#111111' : S.color, rot: totalRot(v) });
  drawMarks(v); changed(before); setTool('select');
}
async function editText(v, m) {
  const text = await askText('Edit text', '', m.text, 'Save', false, true);
  if (text == null) return;
  const before = snapshot(); m.text = text; drawMarks(v); changed(before);
}
async function addNote(v, x, y) {
  const text = await askText('Add a note', 'The note shows as a comment in any PDF reader.', '', 'Add', false, true);
  if (!text) return;
  const before = snapshot();
  marksOf(v.entry).push({ id: uid(), type: 'note', x, y, text });
  drawMarks(v); changed(before); setTool('select');
}
async function editNote(v, m) {
  const text = await askText('Note', '', m.text, 'Save', false, true);
  if (text == null) return;
  const before = snapshot(); m.text = text; drawMarks(v); changed(before);
}
let pendingImage = null; // { data, w, h } waiting to be placed
function placeImage(v, px, py) {
  if (!pendingImage) return;
  const before = snapshot();
  const [x, y] = toPdf(v, px, py);
  marksOf(v.entry).push({ id: uid(), type: 'img', x, y, w: pendingImage.w, h: pendingImage.h, data: pendingImage.data, rot: totalRot(v) });
  pendingImage = null; drawMarks(v); changed(before); setTool('select');
}
// Highlight: select text with the Highlight tool (or select it, then press Highlight).
function highlightSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return false;
  const before = snapshot();
  let any = false;
  for (let r = 0; r < sel.rangeCount; r++) {
    for (const rect of sel.getRangeAt(r).getClientRects()) {
      if (rect.width < 1 || rect.height < 1) continue;
      const v = views.find((vv) => { const b = vv.el.getBoundingClientRect(); return rect.top >= b.top - 2 && rect.bottom <= b.bottom + 2 && rect.left >= b.left - 2 && rect.right <= b.right + 2; });
      if (!v) continue;
      const b = v.el.getBoundingClientRect();
      const [x1, y1] = toPdf(v, rect.left - b.left, rect.top - b.top), [x2, y2] = toPdf(v, rect.right - b.left, rect.bottom - b.top);
      let list = marksOf(v.entry), m = list.find((mm) => mm.pending);
      if (!m) { m = { id: uid(), type: 'hl', rects: [], color: S.color, pending: true }; list.push(m); }
      m.rects.push([x1, y1, x2, y2]); any = true;
    }
  }
  for (const v of views) for (const m of (doc.marks[pageKey(v.entry)] || [])) delete m.pending;
  sel.removeAllRanges();
  if (any) { views.forEach((v) => v.rendered && drawMarks(v)); changed(before); }
  return any;
}
document.addEventListener('pointerup', () => { if (app.dataset.tool === 'highlight') setTimeout(highlightSelection, 0); });
function setTool(t) {
  closeLineEditor(true);
  const was = app.dataset.tool;
  app.dataset.tool = t;
  if (t !== 'select') selectMark(null);
  if (t !== 'edit' && selContent) selectContent(null);
  if (t === 'edit' && was !== 'edit') toast(`${matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click'} text to change it, or a picture or comment to move it. Esc keeps a change; ${fmtKey('Mod-z')} undoes it.`);
  if (t === 'erase' && was !== 'erase') toast('Drag over anything to erase it');
  refreshRibbon();
}

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
    const O = pdfjs.OPS, glyphs = new Map(), images = [], stack = [], invisible = new Set();
    let font = null, ctm = [1, 0, 0, 1, 0, 0], mode = 0;
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], a = ops.argsArray[i];
      if (fn === O.setFont) font = a[0];
      else if (fn === O.setTextRenderingMode) mode = a[0];
      else if (fn === O.showText && font) {
        // Text drawn invisibly (the words a scanner's OCR lays over a scanned page)
        if (mode === 3 || mode === 7) invisible.add(font);
        let g = glyphs.get(font); if (!g) glyphs.set(font, g = new Map());
        for (const gl of a[0] || []) if (gl && gl.unicode && gl.fontChar != null && !g.has(gl.unicode)) g.set(gl.unicode, { fc: gl.fontChar, w: gl.width, code: gl.originalCharCode, inFont: gl.isInFont !== false });
      } else if (fn === O.save) stack.push([ctm, mode]);
      else if (fn === O.restore) [ctm, mode] = stack.pop() || [[1, 0, 0, 1, 0, 0], 0];
      else if (fn === O.transform) ctm = mul(a, ctm);
      else if (fn === O.paintFormXObjectBegin) { stack.push([ctm, mode]); if (a && a[0]) ctm = mul(a[0], ctm); }
      else if (fn === O.paintFormXObjectEnd) [ctm, mode] = stack.pop() || [ctm, mode];
      else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject) {
        const quad = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => apply(ctm, x, y));
        const [x0, y0, x1, y1] = quadBox(quad);
        if (x1 - x0 > 2 && y1 - y0 > 2) images.push({ n: images.length, objId: fn === O.paintImageXObject ? a[0] : null, inline: fn === O.paintInlineImageXObject ? a[0] : null, quad, mat: ctm.slice() });
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
    for (const L of lines) { L.str = L.str.replace(/\s+$/, ''); L.quad = lineQuad(L, .3); }
    const A = pdfjs.AnnotationType;
    const comments = annots.filter((a) => a.rect && a.id && ![A.WIDGET, A.LINK, A.POPUP].includes(a.annotationType));
    return { lines: lines.filter((L) => L.str && L.width > 0), images, comments, glyphs, invisible };
  })());
}
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
    const im = cm.images[k], mark = own.find((m) => m.type === 'ie' && m.n === im.n);
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
  const key = [m.id, m.text, m.color, scale, ratio, loaded].join('|');
  if (teCache.has(key)) return teCache.get(key);
  const { size, u } = lineFrame(m), hsc = Math.hypot(m.tm[0], m.tm[1]) / (Math.hypot(m.tm[2], m.tm[3]) || 1);
  const px = size * scale * ratio, fb = `${m.bold ? 'bold ' : ''}${m.italic ? 'italic ' : ''}${px}px ${cssFamily(m.fam)}`, own = `${px}px "${loaded}", ${cssFamily(m.fam)}`;
  // Runs of letters drawn with the PDF's font, and runs the font doesn't have (drawn in the closest standard font).
  // A letter pdf.js maps to a control code (a space, usually) is not drawn, only advanced by its width.
  const runs = [];
  for (const ch of m.text) {
    const g0 = map && map.get(ch), gl = g0 && g0.inFont ? g0 : null, blank = !!gl && /^[\x00-\x1f\x7f-\x9f]$/.test(gl.fc);
    const kind = blank ? 'gap' : gl ? 'own' : 'fb', last = runs[runs.length - 1];
    if (kind === 'gap') runs.push({ kind, s: '', adv: (gl.w || 250) / 1000 * px * hsc });
    else if (last && last.kind === kind) last.s += kind === 'own' ? gl.fc : ch;
    else runs.push({ kind, s: kind === 'own' ? gl.fc : ch });
  }
  const c = document.createElement('canvas'), g = c.getContext('2d');
  let w = 0; for (const r of runs) { if (r.kind === 'gap') { r.w = r.adv; w += r.w; continue; } g.font = r.kind === 'own' ? own : fb; r.w = g.measureText(r.s).width * hsc; w += r.w; }
  const asc = Math.max(m.ascent, .9) * px, desc = Math.max(-m.descent, .3) * px;
  c.width = Math.ceil(w + 4); c.height = Math.ceil(asc + desc + 2);
  g.fillStyle = m.color; let x = 0;
  for (const r of runs) { if (r.s) { g.save(); g.font = r.kind === 'own' ? own : fb; g.translate(x, asc); g.scale(hsc, 1); g.fillText(r.s, 0, 0); g.restore(); } x += r.w; }
  const out = { url: c.toDataURL('image/png'), w: c.width / ratio, h: c.height / ratio, asc: asc / ratio };
  void u; if (teCache.size > 200) teCache.clear(); teCache.set(key, out);
  return out;
}
// Marks that clear part of the page are drawn first, under everything else.
function drawContentMark(v, m, svg) {
  const poly = (q, fill) => svgEl('polygon', { points: q.map(([x, y]) => toView(v, x, y).map((n) => n.toFixed(1)).join(',')).join(' '), fill });
  if (m.type === 'erase') { const g = poly(m.quad, m.bg); g.setAttribute('class', 'mk'); if (m.drafting) { g.setAttribute('fill', 'none'); g.setAttribute('stroke', 'var(--accent)'); g.setAttribute('stroke-dasharray', '4 3'); } return g; }
  if (m.type === 'te') {
    const g = svgEl('g', { class: 'mk' });
    g.appendChild(poly(m.quad, m.bg));
    if (!editingIds.has(m.id)) {
      const im = teImage(v, m), [ox, oy] = toView(v, m.tm[4], m.tm[5]), { u } = lineFrame(m);
      const [ax, ay] = toView(v, m.tm[4] + u[0], m.tm[5] + u[1]), ang = Math.atan2(ay - oy, ax - ox) * 180 / Math.PI;
      g.appendChild(svgEl('image', { x: ox, y: oy - im.asc, width: im.w, height: im.h, href: im.url, transform: `rotate(${ang.toFixed(2)} ${ox} ${oy})` }));
    }
    return g;
  }
  if (m.type === 'ie') {
    const g = svgEl('g', { class: 'mk' });
    g.appendChild(poly(m.quad, m.bg));
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
async function onEditDown(e, v) {
  e.preventDefault();
  closeLineEditor(true);
  const [x, y] = toPdf(v, ...localPoint(e, v));
  // An edit made earlier: change it again.
  const own = e.target.closest && e.target.closest('.mk');
  const om = own && marksOf(v.entry).find((m) => m.id === own.dataset.id);
  if (om && om.type === 'te') { selectContent(null); return openLineEditor(v, om, false); }
  if (om && om.type === 'ie' && !om.deleted) { const cm = await contentMap(v.page); selectContent({ v, kind: 'image', im: cm.images[om.n] || { n: om.n, quad: om.quad, mat: quadMat(om.quad) }, mark: om }); return startImageDrag(e, v, selContent, 'move'); }
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
  if (hit.kind === 'annot' && e.detail === 2) return editComment(v, hit.a, hit.mark);
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
  const m = { id: uid(), type: 'ie', n: s.im.n, quad: s.im.quad, bg: sampleColors(v, s.im.quad).bg, data, mat: (s.im.mat || quadMat(s.im.quad)).slice() };
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
    else list.push({ id: uid(), type: 'ie', n: s.im.n, quad: s.im.quad, bg: sampleColors(s.v, s.im.quad).bg, data: '', mat: (s.im.mat || quadMat(s.im.quad)).slice(), deleted: true });
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
  let m = mark;
  if (!m) {
    const fo = await fontObj(v.page, L.fontName) || {};
    const name = String(fo.name || ''), { bg, fg } = sampleColors(v, L.quad);
    // The character code of each letter this font has (for fonts without a Unicode table, the only reliable source)
    const codes = {}; for (const [u, gl] of cm.glyphs.get(L.fontName) || []) if (gl.inFont && gl.code != null) codes[u] = gl.code;
    const ocr = cm.invisible.has(L.fontName) || /glyphless/i.test(name);
    m = { id: uid(), type: 'te', tm: L.tm, width: L.width, ascent: L.ascent, descent: L.descent, quad: L.quad, orig: L.str, text: L.str, font: name, fam: stdFamily(name + ' ' + L.family), bold: !!fo.bold || /bold|black|heavy|semibold|demi/i.test(name), italic: !!fo.italic || /italic|oblique/i.test(name), bg, color: ocr ? '#111111' : fg, codes, ocr, type3: !!fo.isType3Font };
  }
  openLineEditor(v, m, !mark);
}
function openLineEditor(v, m, isNew) {
  const { size, u } = lineFrame(m), px = size * scale;
  const [ox, oy] = toView(v, m.tm[4], m.tm[5]), [ax, ay] = toView(v, m.tm[4] + u[0], m.tm[5] + u[1]);
  const ang = Math.atan2(ay - oy, ax - ox) * 180 / Math.PI, asc = Math.max(m.ascent, .9) * px, desc = Math.max(-m.descent, .3) * px;
  const ed = document.createElement('div');
  ed.className = 'line-editor'; ed.spellcheck = false; ed.setAttribute('role', 'textbox'); ed.setAttribute('aria-label', 'Edit this line');
  try { ed.contentEditable = 'plaintext-only'; } catch { ed.contentEditable = 'true'; }
  if (ed.contentEditable !== 'plaintext-only') ed.contentEditable = 'true';
  ed.textContent = m.text;
  Object.assign(ed.style, { left: ox + 'px', top: (oy - asc) + 'px', height: (asc + desc) + 'px', lineHeight: (asc + desc) + 'px', minWidth: (m.width * scale + 4) + 'px', font: `${m.bold ? 'bold ' : ''}${m.italic ? 'italic ' : ''}${px}px ${cssFamily(m.fam)}`, color: m.color, background: m.bg, transformOrigin: `0 ${asc}px`, transform: `rotate(${ang}deg)` });
  v.el.appendChild(ed);
  editingIds.add(m.id); drawMarks(v);
  lineEditor = { ed, v, m, isNew };
  ed.focus();
  const r = document.createRange(); r.selectNodeContents(ed); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  ed.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); closeLineEditor(true); }
    if (e.key === 'Escape') { e.preventDefault(); keptHint(closeLineEditor(true)); }
    if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
  });
  ed.addEventListener('blur', () => setTimeout(() => { if (lineEditor && lineEditor.ed === ed) closeLineEditor(true); }, 0));
}
// Escape, like clicking away, keeps what was typed; Undo takes it back. Says so once a session.
let keptHinted = false;
function keptHint(changedSomething) { if (changedSomething && !keptHinted) { keptHinted = true; toast(`Change kept. ${fmtKey('Mod-z')} undoes it.`); } }
// Returns true if the edit changed the page.
function closeLineEditor(commit) {
  if (!lineEditor) return false;
  const { ed, v, m, isNew } = lineEditor; lineEditor = null;
  editingIds.delete(m.id);
  const text = ed.textContent.replace(/[\r\n]+/g, ' ');
  ed.remove();
  if (commit && text !== m.text) {
    const before = snapshot(), list = marksOf(v.entry);
    if (text === m.orig && !isNew) list.splice(list.indexOf(m), 1); // back to the original: no edit left
    else { m.text = text; if (isNew) list.push(m); }
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
function walkContent(s, fontWidth, onShow, onImage) {
  const toks = tokenizeContent(s);
  let ctm = [1, 0, 0, 1, 0, 0], tm = [1, 0, 0, 1, 0, 0], tlm = tm, font = null, fs = 1, tc = 0, tw = 0, th = 1, tl = 0, tr = 0;
  const gstack = [], ops = []; let operands = [], opStart = null, arrStack = [], bi = null;
  for (const t of toks) {
    if (t.t === 'op') {
      const o = t.v, a = operands, start = opStart ?? t.start, end = t.end;
      operands = []; opStart = null;
      const num = (k) => (a[k] && a[k].t === 'num' ? a[k].v : 0);
      if (o === 'BI') { bi = { start }; continue; }
      if (o === 'ID') continue;
      if (o === 'EI') { if (bi) { onImage({ start: bi.start, end, ctm, inline: true }); bi = null; } continue; }
      if (bi) continue;
      if (o === 'q') gstack.push([ctm, font, fs, tc, tw, th, tl, tr]);
      else if (o === 'Q') { const g = gstack.pop(); if (g) [ctm, font, fs, tc, tw, th, tl, tr] = g; }
      else if (o === 'Tr') tr = num(0);
      else if (o === 'cm') ctm = mul([0, 1, 2, 3, 4, 5].map(num), ctm);
      else if (o === 'BT') { tm = tlm = [1, 0, 0, 1, 0, 0]; }
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
        ops.push({ start, end, origin, font, fs, keep, invisible: tr === 3 || tr === 7, strings: parts.filter((p) => p.t === 'str').map((p) => p.v) });
        onShow && onShow(ops[ops.length - 1]);
        tm = mul([1, 0, 0, 1, adv, 0], tm);
      } else if (o === 'Do') onImage({ start, end, ctm, name: a[0] && a[0].v });
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
async function saveContentEdits(L, out, p, marks, ctx) {
  const edits = marks.filter((m) => CONTENT_TYPES.has(m.type) && !m.drafting);
  if (!edits.length) return;
  const { PDFName, PDFArray, PDFDict, PDFRef, PDFOperator, PDFNumber, PDFHexString, PDFRawStream, StandardFonts } = L;
  const node = p.node;
  const { fonts, fontWidth, text } = pageFonts(L, out, node);
  // 1. Take edited lines and changed pictures out of the page's own content.
  const lines = edits.filter((m) => m.type === 'te'), pics = edits.filter((m) => m.type === 'ie');
  // Contents may be one stream, an array of them, or a reference to such an array.
  const streamsOf = () => { const raw = node.get(PDFName.of('Contents')); const r = raw && out.context.lookup(raw); return r instanceof PDFArray ? r.asArray() : raw ? [raw] : []; };
  const parts = streamsOf();
  let src = parts.map((r) => { const st = out.context.lookup(r); return st ? text(st) : ''; }).join('\n');
  const cut = [], removed = new Set(), hidden = new Set();
  const xo = (() => { const res = node.Resources && node.Resources(); const x = res && res.lookup(PDFName.of('XObject')); return x instanceof PDFDict ? x : null; })();
  const isImage = (name) => { const o = xo && xo.lookup(PDFName.of(name)); return o && o.dict && String(o.dict.lookup(PDFName.of('Subtype'))) === '/Image'; };
  try {
    walkContent(src, fontWidth, (op) => {
      // A piece of text belongs to an edited line when it is in the line's font and starts on the line's baseline,
      // within the line (not at its end, where a word in another font or a link may follow).
      const f = fonts.get(op.font);
      for (const m of lines) {
        const fr = lineFrame(m), dx = op.origin[0] - fr.o[0], dy = op.origin[1] - fr.o[1];
        const along = dx * fr.u[0] + dy * fr.u[1], perp = dx * fr.v[0] + dy * fr.v[1];
        if (perp < -fr.size * .35 || perp > fr.size * .35 || along < -Math.max(1, fr.size * .3) || along > m.width - Math.min(1, fr.size * .1)) continue;
        if (m.font && f && f.base && baseName(f.base) !== baseName(m.font)) continue;
        cut.push([op.start, op.end, op.keep]); removed.add(m.id); if (op.invisible) hidden.add(m.id); break;
      }
    }, (im) => {
      if (!im.inline && !isImage(im.name)) return;
      const q = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => apply(im.ctm, x, y)), b = quadBox(q);
      for (const m of pics) { const mb = quadBox(m.quad); if (b.every((n, k) => Math.abs(n - mb[k]) < .75)) { cut.push([im.start, im.end, ' ']); removed.add(m.id); break; } }
    });
  } catch (e) { console.warn('content edit: reading the page failed, clipping instead', e); cut.length = 0; removed.clear(); }
  if (cut.length) {
    cut.sort((a, b) => b[0] - a[0]);
    for (const [a, b, keep] of cut) src = src.slice(0, a) + (keep || ' ') + src.slice(b);
    const bytes = new Uint8Array(src.length); for (let i = 0; i < src.length; i++) bytes[i] = src.charCodeAt(i) & 255;
    node.set(PDFName.of('Contents'), out.context.register(out.context.flateStream(bytes)));
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
  // 3. Paint: the colour that was behind each change, then new pictures and text.
  const rgbOf = (hex) => { const n = parseInt(String(hex || '#ffffff').slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255].map((x) => PDFNumber.of(+x.toFixed(4))); };
  const O = (name, args = []) => PDFOperator.of(name, args);
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
  for (const m of lines) {
    if (!m.text.trim()) continue;
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
    const runs = [];
    for (const ch of m.text) { const code = f ? f.rev.get(ch) : undefined; const own = code != null; const last = runs[runs.length - 1]; if (last && last.own === own) last.chars.push(own ? code : ch); else runs.push({ own, chars: [own ? code : ch] }); }
    // A clean text state: what the page set before (invisible text, spacing, rise) must not apply to the new line.
    const ops = [O('q'), O('rg', rgbOf(m.color)), O('BT'), O('Tr', [PDFNumber.of(0)]), O('Tc', [PDFNumber.of(0)]), O('Tw', [PDFNumber.of(0)]), O('Tz', [PDFNumber.of(100)]), O('Ts', [PDFNumber.of(0)]), O('Tm', m.tm.map((n) => PDFNumber.of(+(+n).toFixed(4))))];
    for (const r of runs) {
      if (r.own) {
        ops.push(O('Tf', [f.key, PDFNumber.of(1)]), O('Tj', [PDFHexString.of(r.chars.map((c) => c.toString(16).padStart(f.bytes * 2, '0')).join(''))]));
      } else {
        let sf = ctx.std.get(stdName); if (!sf) { sf = await out.embedFont(StandardFonts[stdName] || StandardFonts.Helvetica); ctx.std.set(stdName, sf); }
        const key = node.newFontDictionary ? node.newFontDictionary('CPDF', sf.ref) : (() => { throw new Error('no font dictionary'); })();
        let hex; try { hex = sf.encodeText(r.chars.join('')); } catch { hex = sf.encodeText(r.chars.map((c) => (/[\x20-\x7E]/.test(c) ? c : '?')).join('')); }
        ops.push(O('Tf', [key, PDFNumber.of(1)]), O('Tj', [hex]));
      }
    }
    ops.push(O('ET'), O('Q'));
    p.pushOperators(...ops);
  }
  void PDFRef; void PDFRawStream;
}
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
async function signature() {
  const saved = store.get('signature', null);
  const body = `<p>Draw your signature. It is kept on this device for next time.</p><canvas class="sig-pad" id="sigPad" width="900" height="320"></canvas>`;
  const res = await dialog('Signature', body, [{ label: 'Clear', value: 'clear', keep: true }, ...(saved ? [{ label: 'Use saved', value: 'saved' }] : []), { label: 'Cancel' }, { label: 'Place', value: 'place', primary: true }], (dlg) => {
    const c = $('#sigPad', dlg), g = c.getContext('2d');
    g.lineWidth = 6; g.lineCap = g.lineJoin = 'round'; g.strokeStyle = '#13235E';
    let drawing = false, any = false;
    const pt = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
    c.onpointerdown = (e) => { drawing = true; any = true; c.setPointerCapture(e.pointerId); g.beginPath(); g.moveTo(...pt(e)); };
    c.onpointermove = (e) => { if (drawing) { g.lineTo(...pt(e)); g.stroke(); } };
    c.onpointerup = () => { drawing = false; };
    dlg.__clear = () => { g.clearRect(0, 0, c.width, c.height); any = false; };
    dlg.__get = () => (any ? trimCanvas(c) : null);
  });
  if (res === 'saved' && saved) { pendingImage = saved; setTool('sign'); toast('Click where the signature goes'); return; }
  if (res && res.value === 'place' && res.data) { store.set('signature', res.data); pendingImage = res.data; setTool('sign'); toast('Click where the signature goes'); }
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
  setTool('image'); toast('Click where the picture goes');
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
const deletePage = () => pageOp(() => { doc.pages.splice(current, 1); current = Math.min(current, doc.pages.length - 1); });
const movePage = (d) => pageOp(() => { const t = current + d; if (t < 0 || t >= doc.pages.length) return; const [e] = doc.pages.splice(current, 1); doc.pages.splice(t, 0, e); current = t; });
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
   With the pages unchanged, the original PDF is kept (bookmarks, forms, links, metadata) and the mark-up is added
   to it. Otherwise a new PDF is assembled from the pages in their new order. Highlights, drawings, boxes, text and
   signatures are drawn into the page so every reader shows them; notes are real PDF comments. */
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
  else {
    out = await PDFDocument.create();
    pages = [];
    for (const e of entries) { const [p] = await out.copyPages(loaded[e.src], [e.i]); out.addPage(p); pages.push(p); }
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
        const annot = out.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [m.x, m.y - 22, m.x + 22, m.y], Contents: PDFHexString.fromText(m.text), Name: 'Comment', C: [1, .83, .23], T: PDFHexString.fromText('Cowdrey.PDF'), F: 4, Open: false });
        const ref = out.context.register(annot);
        let annots = p.node.lookup(PDFName.of('Annots'));
        if (!annots) { annots = out.context.obj([]); p.node.set(PDFName.of('Annots'), annots); }
        annots.push(ref);
      }
    }
    for (const h of FEATURE.savePage) await h({ L, out, p, entry: e, n, entries, marks: pageMarks, ctx: editCtx });
  }
  for (const h of FEATURE.saveDoc) await h({ L, out, pages, entries, ctx: editCtx });
  out.setTitle(doc.name); out.setProducer('Cowdrey.PDF ' + VERSION + ' (bradcowdrey.com)'); out.setModificationDate(new Date());
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
  for (const v of views) await renderView(v);
  try {
    // The apps' web views ignore window.print(): the Mac app and the phone apps open the system print dialog themselves.
    if (MAC_APP) await MAC_APP.core.invoke('print_page');
    else if (MOBILE_APP) await NATIVE.core.invoke('plugin:sharekit|native', { method: 'printPage', args: { title: doc.name } });
    else window.print();
  } catch (e) { toast(`Could not print: ${e.message || e}`); }
}

/* ---------------- find ---------------- */
const findState = { q: '', hits: [], now: -1, texts: new Map() };
async function textOf(entry) {
  const k = pageKey(entry);
  if (!findState.texts.has(k)) findState.texts.set(k, await (await pageOf(entry)).getTextContent());
  return findState.texts.get(k);
}
async function runFind(q) {
  findState.q = q; findState.hits = []; findState.now = -1;
  $$('.find-hit').forEach((h) => h.remove());
  if (!q || !doc) { $('#findCount').textContent = ''; return; }
  const needle = q.toLowerCase();
  for (let n = 0; n < doc.pages.length; n++) {
    const tc = await textOf(doc.pages[n]);
    tc.items.forEach((it, idx) => { let p = it.str.toLowerCase().indexOf(needle); while (p >= 0) { findState.hits.push({ n, idx, p }); p = it.str.toLowerCase().indexOf(needle, p + 1); } });
  }
  $('#findCount').textContent = findState.hits.length ? `0 of ${findState.hits.length}` : 'No matches';
  views.forEach((v) => v.rendered && paintFind(v));
  if (findState.hits.length) stepFind(1);
}
function paintFind(v) {
  $$('.find-hit', v.el).forEach((h) => h.remove());
  const n = views.indexOf(v), tc = findState.texts.get(pageKey(v.entry));
  if (!tc) return;
  findState.hits.forEach((h, k) => {
    if (h.n !== n) return;
    const it = tc.items[h.idx];
    const t = pdfjs.Util.transform(v.viewport.transform, it.transform);
    const fh = Math.hypot(t[2], t[3]), w = it.width * scale, per = it.str.length ? w / it.str.length : 0;
    const el = document.createElement('div'); el.className = 'find-hit' + (k === findState.now ? ' now' : '');
    el.style.left = (t[4] + per * h.p) + 'px'; el.style.top = (t[5] - fh) + 'px';
    el.style.width = Math.max(4, per * findState.q.length) + 'px'; el.style.height = fh * 1.15 + 'px';
    v.el.appendChild(el);
  });
}
function stepFind(d) {
  if (!findState.hits.length) return;
  findState.now = (findState.now + d + findState.hits.length) % findState.hits.length;
  const h = findState.hits[findState.now];
  $('#findCount').textContent = `${findState.now + 1} of ${findState.hits.length}`;
  goPage(h.n, true);
  renderView(views[h.n]).then(() => views.forEach((v) => v.rendered && paintFind(v)));
}
function openFind() { $('#findbar').hidden = false; $('#findInput').focus(); $('#findInput').select(); }
function closeFind() { $('#findbar').hidden = true; runFind(''); }
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
    const outline = await pdfDocs.get(0).getOutline().catch(() => null);
    const list = (items) => `<ul class="outline-list">${items.map((o, k) => `<li><button type="button" data-o="${esc(k)}" style="padding-left:${8}px">${esc(o.title)}</button>${o.items && o.items.length ? `<div style="padding-left:12px">${list(o.items)}</div>` : ''}</li>`).join('')}</ul>`;
    panel.innerHTML = outline && outline.length ? list(outline) : '<p class="empty-note">This PDF has no outline.</p>';
    const flat = []; const walk = (items) => items.forEach((o) => { flat.push(o); o.items && walk(o.items); }); outline && walk(outline);
    $$('[data-o]', panel).forEach((b, k) => { b.onclick = () => goToDest(flat[k].dest); });
    return;
  }
  panel.innerHTML = `<div class="thumbs">${doc.pages.map((e, n) => `<button type="button" class="thumb" draggable="true" data-n="${n}" aria-label="Page ${n + 1}"><canvas width="1" height="1"></canvas><span>${n + 1}</span></button>`).join('')}</div>`;
  thumbIO && thumbIO.disconnect();
  thumbIO = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { thumbIO.unobserve(en.target); drawThumb(en.target); } }), { root: panel, rootMargin: '300px' });
  $$('.thumb', panel).forEach((t) => {
    thumbIO.observe(t);
    t.onclick = () => { goPage(+t.dataset.n); if (matchMedia('(max-width: 760px)').matches) toggleSidebar(false); };
    t.ondragstart = (e) => { e.dataTransfer.setData('text/plain', t.dataset.n); };
    t.ondragover = (e) => { e.preventDefault(); t.classList.add('drag-over'); };
    t.ondragleave = () => t.classList.remove('drag-over');
    t.ondrop = (e) => {
      e.preventDefault(); t.classList.remove('drag-over');
      const from = +e.dataTransfer.getData('text/plain'), to = +t.dataset.n;
      if (Number.isNaN(from) || from === to) return;
      pageOp(() => { const [x] = doc.pages.splice(from, 1); doc.pages.splice(to, 0, x); current = to; });
    };
  });
  markThumb();
}
async function drawThumb(t) {
  const e = doc.pages[+t.dataset.n]; if (!e) return;
  const page = await pageOf(e);
  const vp = page.getViewport({ scale: 1, rotation: (page.rotate + e.rot) % 360 });
  const s = 140 / Math.max(vp.width, vp.height) * 1.3;
  const v2 = page.getViewport({ scale: s, rotation: (page.rotate + e.rot) % 360 });
  const c = $('canvas', t); c.width = v2.width; c.height = v2.height;
  try { await page.render({ canvas: c, canvasContext: c.getContext('2d'), viewport: v2 }).promise; } catch {}
}
function markThumb() { $$('.thumb').forEach((t) => t.setAttribute('aria-current', +t.dataset.n === current)); }
const isPhone = () => matchMedia('(max-width: 760px)').matches;
let sideOpener = null; // what had focus when the phone sidebar opened; it gets it back on closing
function toggleSidebar(on) {
  const phone = isPhone();
  if (phone) {
    const was = app.dataset.sidebar === 'open', open = on ?? !was;
    app.dataset.sidebar = open ? 'open' : 'on';
    if (open && !was) { sideOpener = document.activeElement; const t = $('.side-tabs [aria-selected="true"]'); setTimeout(() => t && t.focus({ preventScroll: true }), 0); }
    if (!open && was) { const f = sideOpener; sideOpener = null; if (f && f.isConnected && f !== document.body) f.focus({ preventScroll: true }); }
    refreshRibbon(); return;
  }
  S.sidebar = on ?? !S.sidebar; saveSettings(); app.dataset.sidebar = S.sidebar ? 'on' : 'off';
  if (doc && S.zoom === 'fit') setTimeout(() => layoutPages(true), 50);
}

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
  panel.innerHTML = all.length ? `<ul class="doc-list">${all.map((d) => `<li class="doc-item"${doc && d.id === doc.id ? ' aria-current="true"' : ''}><button type="button" class="doc-open" data-id="${d.id}">${esc(d.name)}<span class="m">${new Date(d.updated).toLocaleDateString()} · ${d.pages.length} page${d.pages.length === 1 ? '' : 's'}</span></button><button type="button" class="icon-btn" data-del="${d.id}" title="Remove from this device">${ic('trash-2')}</button></li>`).join('')}</ul>` : '<p class="empty-note">PDFs you open are kept here, on this device.</p>';
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
      if (a.value === 'place' && dlg.__get) { const data = dlg.__get(); if (!data) { toast('Draw your signature first'); return; } done({ value: 'place', data }); return; }
      if (a.input) { done($('#dlgInput', dlg).value); return; }
      done(a.value ?? null);
    });
    dlg.oncancel = (e) => { e.preventDefault(); done(null); };
    dlg.showModal();
    // Start on the first field, or else on the main button, never on the close button.
    const first = $('.dlg-body :is(input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]))', dlg) || $('.dlg-foot .btn.primary:not([disabled])', dlg) || $('.dlg-foot .btn:not(.danger)', dlg);
    if (first && document.activeElement === $('[data-x]', dlg)) first.focus();
    const inp = $('#dlgInput', dlg); if (inp) { inp.focus(); inp.select && inp.select(); inp.onkeydown = (e) => { if (e.key === 'Enter' && (inp.tagName !== 'TEXTAREA' || e.metaKey || e.ctrlKey)) { e.preventDefault(); done(inp.value); } }; }
  });
}
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
cmd('merge', { rlabel: 'Add PDFs', label: 'Add PDFs at the end…', icon: 'files', run: () => $('#mergeInput').click() });
cmd('exportImage', { label: 'Export this page as a picture', icon: 'image-down', enabled: has, run: exportImage });
cmd('exportText', { label: 'Export text (.txt)', icon: 'file-text', enabled: has, run: exportText });
cmd('print', { label: 'Print…', icon: 'printer', key: 'Mod-p', enabled: has, run: printDoc });
cmd('undo', { label: 'Undo', icon: 'undo-2', key: 'Mod-z', enabled: () => undoStack.length > 0, run: undo });
cmd('redo', { label: 'Redo', icon: 'redo-2', key: 'Mod-Shift-z', enabled: () => redoStack.length > 0, run: redo });
cmd('find', { label: 'Find…', icon: 'search', key: 'Mod-f', enabled: has, run: openFind });
cmd('deleteMark', { label: 'Delete selected', icon: 'trash-2', enabled: () => !!selMark || !!selContent, run: deleteSelected });
cmd('copyMark', { label: 'Copy', icon: 'copy', key: 'Mod-c', hidden: true, enabled: () => !!selMark, run: copyMark });
cmd('pasteMark', { label: 'Paste', icon: 'clipboard-paste', key: 'Mod-v', hidden: true, enabled: () => !!markClip && has(), run: () => pasteMark() });
cmd('dupMark', { label: 'Duplicate', icon: 'copy-plus', key: 'Mod-d', hidden: true, enabled: () => !!selMark, run: duplicateMark });
const tools = [['select', 'Select', 'mouse-pointer-2'], ['highlight', 'Highlight', 'highlighter'], ['pen', 'Draw', 'pen-line'], ['rect', 'Box', 'square'], ['text', 'Add text', 'type'], ['note', 'Note', 'sticky-note'], ['edit', 'Edit PDF', 'text-cursor-input'], ['erase', 'Erase area', 'eraser']];
for (const [t, label, icon] of tools) cmd('tool_' + t, { label, icon, enabled: has, pressed: () => app.dataset.tool === t, run: () => { if (t === 'highlight' && highlightSelection()) return; setTool(t); } });
cmd('sign', { label: 'Signature…', icon: 'signature', enabled: has, run: signature });
cmd('image', { label: 'Picture…', icon: 'image-plus', enabled: has, run: () => $('#imageInput').click() });
cmd('rotL', { label: 'Rotate left', icon: 'rotate-ccw', enabled: has, run: () => rotatePage(-90) });
cmd('rotR', { label: 'Rotate right', icon: 'rotate-cw', key: 'Mod-r', enabled: has, run: () => rotatePage(90) });
cmd('rotAll', { rlabel: 'Rotate all', label: 'Rotate all pages', icon: 'refresh-cw', enabled: has, run: () => rotateAll(90) });
cmd('up', { rlabel: 'Move up', label: 'Move page up', icon: 'arrow-up', enabled: () => has() && current > 0, run: () => movePage(-1) });
cmd('down', { rlabel: 'Move down', label: 'Move page down', icon: 'arrow-down', enabled: () => has() && current < doc.pages.length - 1, run: () => movePage(1) });
cmd('dup', { label: 'Duplicate page', icon: 'copy-plus', enabled: has, run: duplicatePage });
cmd('blank', { rlabel: 'Blank page', label: 'Insert blank page', icon: 'file-plus-2', enabled: has, run: insertBlank });
cmd('delPage', { label: 'Delete page', icon: 'file-x-2', enabled: has, run: deletePage });
cmd('extract', { label: 'Extract pages…', icon: 'file-output', enabled: has, run: extractPages });
cmd('sidebar', { label: 'Sidebar', icon: 'panel-left', key: 'Mod-Alt-s', pressed: () => isPhone() ? app.dataset.sidebar === 'open' : S.sidebar, run: () => toggleSidebar() });
cmd('darkPage', { label: 'Dark pages', icon: 'moon-star', pressed: () => S.darkPage, run: () => { S.darkPage = !S.darkPage; saveSettings(); applyTheme(); refreshRibbon(); } });
cmd('zoomIn', { label: 'Zoom in', icon: 'zoom-in', key: 'Mod-=', enabled: has, run: () => setZoom(Math.min(400, Math.round(scale * 100) + 10)) });
cmd('zoomOut', { label: 'Zoom out', icon: 'zoom-out', key: 'Mod--', enabled: has, run: () => setZoom(Math.max(25, Math.round(scale * 100) - 10)) });
cmd('zoomFit', { label: 'Fit width', icon: 'move-horizontal', key: 'Mod-0', enabled: has, run: () => setZoom('fit') });
cmd('zoom100', { label: 'Actual size', icon: 'scan', enabled: has, run: () => setZoom(100) });
[['system', 'Match system', 'sun-moon'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']].forEach(([v, l, i]) => cmd('theme_' + v, { label: 'Appearance: ' + l, icon: i, pressed: () => S.theme === v, run: () => { S.theme = v; saveSettings(); applyTheme(); } }));
cmd('about', { label: 'About Cowdrey.PDF', icon: 'info', run: about });
cmd('shortcuts', { label: 'Keyboard shortcuts', icon: 'keyboard', run: () => dialog('Keyboard shortcuts', `<div style="display:grid;grid-template-columns:1fr auto;gap:6px 18px">${Object.values(C).filter((c) => c.key).map((c) => `<span>${esc(c.label)}</span><span style="color:var(--ink-3)">${fmtKey(c.key)}</span>`).join('')}</div>`, [{ label: 'Close', primary: true }]) });
cmd('legal', { label: 'Terms of Use and Privacy', icon: 'scale', run: () => openExternal('https://bradcowdrey.com/legal') });
cmd('share', { label: 'Share…', icon: 'share', enabled: has, hidden: !NATIVE, run: sharePdf });
cmd('checkUpdates', { label: 'Check for updates…', icon: 'refresh-cw', hidden: !MAC_APP, run: () => checkForUpdates(true) });

const fmtKey = (k) => k ? k.split(/-(?=.)/).map((p) => isMac ? ({ Mod: '⌘', Shift: '⇧', Alt: '⌥' }[p] || p.toUpperCase()) : ({ Mod: 'Ctrl', Shift: 'Shift', Alt: 'Alt' }[p] || p.toUpperCase())).join(isMac ? '' : '+') : '';
const MENUS = [
  ['File', ['open', 'save', 'saveCopy', 'share', '-', 'merge', 'exportImage', 'exportText', '-', 'print']],
  ['Edit', ['undo', 'redo', '-', 'deleteMark', '-', 'find', '-', 'tool_edit', 'tool_erase', 'tool_text', 'image']],
  ['View', ['sidebar', 'darkPage', '-', 'zoomIn', 'zoomOut', 'zoomFit', 'zoom100', '-', 'theme_system', 'theme_light', 'theme_dark']],
  ['Comment', ['tool_select', 'tool_highlight', 'tool_pen', 'tool_rect', 'tool_note', '-', 'sign']],
  ['Pages', ['rotL', 'rotR', 'rotAll', '-', 'up', 'down', 'dup', 'blank', 'merge', '-', 'extract', 'delPage']],
  ['Help', ['sample', 'shortcuts', 'legal', '-', 'checkUpdates', 'about']],
];
const shown = (id) => id === '-' || (C[id] && !C[id].hidden);
function menuHtml(ids) {
  return ids.filter(shown).map((id) => id === '-' ? '<div class="msep"></div>' : (() => { const c = C[id]; const on = c.pressed ? c.pressed() : null; const dis = c.enabled && !c.enabled(); return `<button type="button" class="mi" role="menuitem" data-cmd="${id}"${dis ? ' disabled' : ''}>${on === null ? ic(c.icon) : on ? ic('check') : '<span></span>'}<span>${esc(c.label)}</span><span class="k">${fmtKey(c.key)}</span></button>`; })()).join('');
}
const pop = $('#popover');
let popAnchor = null; // the button that opened the popover; Escape gives it focus back
function openPopover(anchor, html) {
  popAnchor = anchor;
  pop.innerHTML = html; pop.hidden = false; icons();
  if (anchor.id) pop.setAttribute('aria-labelledby', anchor.id); else pop.removeAttribute('aria-labelledby');
  const r = anchor.getBoundingClientRect();
  pop.style.maxHeight = Math.max(160, innerHeight - r.bottom - 12) + 'px';
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px'; pop.style.top = r.bottom + 4 + 'px';
  const f = $('.mi:not([disabled])', pop); f && f.focus();
}
function closePopover() { pop.hidden = true; popAnchor = null; $$('.menubar > button, #moreBtn').forEach((b) => b.setAttribute('aria-expanded', 'false')); }
// Menu keys: Up and Down (and Home, End) move between items, Left and Right to the next menu, Escape closes and
// goes back to the menu's button, Tab closes.
pop.addEventListener('keydown', (e) => {
  const items = $$('.mi:not([disabled])', pop), i = items.indexOf(document.activeElement);
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
pop.addEventListener('click', (e) => { const b = e.target.closest('[data-cmd]'); if (b) run(b.dataset.cmd); });
document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.menubar, #moreBtn')) closePopover(); });
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
  const onRibbon = new Set(Object.values(RIBBON).flatMap(([, groups]) => groups.flatMap(([, ids]) => Array.isArray(ids) ? ids : [])));
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
// Ribbon tabs, in order. A tab with no groups is not shown. Features add groups with ribbonAdd().
const RIBBON = {
  home: ['Home', [['File', ['open', 'save', 'print']], ['Edit', ['undo', 'redo', 'find']], ['View', ['zoomOut', 'zoomIn', 'zoomFit', 'sidebar', 'darkPage']]]],
  edit: ['Edit', [['Edit the PDF', ['tool_edit', 'tool_erase']], ['Add', ['tool_text', 'image']]]],
  markup: ['Comment', [['Tools', ['tool_select', 'tool_highlight', 'tool_pen', 'tool_rect', 'tool_note']], ['Colour', 'COLORS'], ['Add', ['sign']]]],
  pages: ['Pages', [['Rotate', ['rotL', 'rotR', 'rotAll']], ['Order', ['up', 'down', 'dup']], ['Insert', ['blank', 'merge']], ['Remove', ['extract', 'delPage']]]],
  forms: ['Forms', []],
  protect: ['Protect', []],
  export: ['Export', [['Save', ['save', 'saveCopy', 'share']], ['Export', ['exportImage', 'exportText', 'print']]]],
};
// Adds commands to a ribbon group (made if missing; `before` names a group to put it in front of).
function ribbonAdd(tab, group, ids, before) {
  const t = RIBBON[tab]; if (!t) throw new Error('No ribbon tab ' + tab);
  let g = t[1].find(([label]) => label === group);
  if (!g) { g = [group, []]; const k = before ? t[1].findIndex(([label]) => label === before) : -1; k >= 0 ? t[1].splice(k, 0, g) : t[1].push(g); }
  for (const id of ids) if (!g[1].includes(id)) g[1].push(id);
}
// Adds commands to a menu (made before Help if missing), after a separator.
function menuAdd(title, ids) {
  let m = MENUS.find(([t]) => t === title);
  if (!m) { m = [title, []]; MENUS.splice(MENUS.findIndex(([t]) => t === 'Help'), 0, m); renderMenubar(); }
  if (m[1].length && m[1][m[1].length - 1] !== '-') m[1].push('-');
  for (const id of ids) if (!m[1].includes(id)) m[1].push(id);
}
const COLORS = ['#FFD43B', '#69DB7C', '#74C0FC', '#F783AC', '#E03131', '#2448C9', '#111111'];
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
  const [, groups] = RIBBON[S.ribbon] || RIBBON.home;
  $('#ribbonBody').innerHTML = groups.map(([label, ids]) => `<div class="r-group" role="group" aria-label="${esc(label)}"><div class="r-items">${ids === 'COLORS'
    ? COLORS.map((c) => `<button type="button" class="swatch" data-color="${c}" style="background:${c}" aria-label="Colour ${c}" aria-pressed="${S.color === c}"></button>`).join('')
    : ids.filter(shown).map((id) => `<button type="button" class="rb" data-cmd="${id}" title="${esc(C[id].label + (C[id].key ? ' (' + fmtKey(C[id].key) + ')' : ''))}">${ic(C[id].icon)}<span>${esc(C[id].rlabel || C[id].label.replace(/…$/, '').replace(/^Appearance: /, ''))}</span></button>`).join('')}</div><div class="r-label">${label}</div></div>`).join('');
  $$('#ribbonBody [data-color]').forEach((b) => b.onclick = () => { S.color = b.dataset.color; saveSettings(); renderRibbon(); });
  icons(); refreshRibbon();
  const tabs = $('#ribbonTabs'), tab = $(`[data-rt="${S.ribbon}"]`, tabs);
  if (tab) scrollIntoRow(tabs, tab);
  const on = $('#ribbonBody [aria-pressed="true"]'); if (on) scrollIntoRow($('#ribbonBody'), on); else $('#ribbonBody').scrollLeft = 0;
  ribbonEdges();
}
// Scrolls a row sideways just enough to show el (never the page up or down).
function scrollIntoRow(row, el) {
  const r = row.getBoundingClientRect(), b = el.getBoundingClientRect(), pad = 48;
  if (b.left < r.left + pad) row.scrollLeft -= r.left + pad - b.left;
  else if (b.right > r.right - pad) row.scrollLeft += b.right - (r.right - pad);
}
// A row with more to see past an edge fades at that edge.
function ribbonEdges() {
  for (const row of [$('#ribbonBody'), $('#ribbonTabs')]) {
    row.classList.toggle('more-l', row.scrollLeft > 1);
    row.classList.toggle('more-r', row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
  }
}
$('#ribbonBody').addEventListener('scroll', ribbonEdges, { passive: true });
$('#ribbonTabs').addEventListener('scroll', ribbonEdges, { passive: true });
window.addEventListener('resize', ribbonEdges);
// Keyboard focus that lands on a button out of view brings it into view.
$('#ribbonBody').addEventListener('focusin', (e) => { const b = e.target.closest('button'); if (b && b.matches(':focus-visible')) scrollIntoRow($('#ribbonBody'), b); });
function refreshRibbon() {
  $$('#ribbonBody [data-cmd]').forEach((b) => { const c = C[b.dataset.cmd]; b.disabled = !!(c.enabled && !c.enabled()); if (c.pressed) b.setAttribute('aria-pressed', !!c.pressed()); });
  // A group of commands that only work on a selection (a picture…) shows only while they can be used.
  let shift = false;
  $$('#ribbonBody .r-group').forEach((g) => {
    const bs = $$('[data-cmd]', g); if (!bs.length || !bs.every((b) => C[b.dataset.cmd].contextual)) return;
    const hide = bs.every((b) => b.disabled); if (g.hidden !== hide) { g.hidden = hide; shift = true; }
  });
  if (shift) ribbonEdges();
  $('#saveBtn').disabled = !has();
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
    const map = { 'o': 'open', 's': 'save', 'shift-s': 'saveCopy', 'p': 'print', 'z': 'undo', 'shift-z': 'redo', 'y': 'redo', 'f': 'find', '=': 'zoomIn', '+': 'zoomIn', '-': 'zoomOut', '0': 'zoomFit', 'r': 'rotR', 'alt-s': 'sidebar' };
    const id = map[key.replace('Shift-', 'shift-').replace('Alt-', 'alt-')];
    if (id && !(typing && ['z', 'shift-z', 'y'].includes(key.toLowerCase()))) { e.preventDefault(); run(id); }
    return;
  }
  if (typing) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && (selMark || selContent)) { e.preventDefault(); deleteSelected(); }
  if (e.key === 'Escape') { if (!pop.hidden) closePopover(); else if (app.dataset.sidebar === 'open' && isPhone()) toggleSidebar(false); else if (!$('#findbar').hidden) closeFind(); else if (selContent) selectContent(null); else { setTool('select'); pendingImage = null; selectMark(null); } }
  // Arrow keys move a selected mark (tab lists and menus handle their own arrows before this).
  if (/^Arrow/.test(e.key) && !e.altKey && selMark) { e.preventDefault(); nudgeMark(e.key, e.shiftKey); return; }
  if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !e.altKey)) { if (doc) { e.preventDefault(); goPage(current + 1); } }
  if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && !e.altKey)) { if (doc) { e.preventDefault(); goPage(current - 1); } }
});

/* ---------------- theme ---------------- */
function applyTheme() {
  scheduleMacMenu();
  const root = document.documentElement;
  if (S.theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', S.theme);
  app.dataset.darkpage = S.darkPage ? 'on' : 'off';
  $('#themeBtn').innerHTML = ic({ system: 'sun-moon', light: 'sun', dark: 'moon' }[S.theme]);
  $('#themeBtn').title = { system: 'Appearance: match system', light: 'Appearance: light', dark: 'Appearance: dark' }[S.theme];
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
    const a = await dialog(`Save changes to ${doc.name}?`, '<p>Your changes are kept in Documents on this Mac either way. Saving also updates the file.</p>', [{ label: 'Cancel' }, { label: "Don't save", value: 'no' }, { label: 'Save', value: 'save', primary: true }]);
    quitAsked = false;
    if (!a || (a === 'save' && !(await savePdf(false)))) { await NATIVE.core.invoke('hold_quit', { hold: false }).catch(() => {}); return; }
  }
  NATIVE.core.invoke('quit_app').catch(() => {});
}
const ACCEL = { 'Mod-o': 'CmdOrCtrl+O', 'Mod-s': 'CmdOrCtrl+S', 'Mod-Shift-s': 'CmdOrCtrl+Shift+S', 'Mod-p': 'CmdOrCtrl+P', 'Mod-z': 'CmdOrCtrl+Z', 'Mod-Shift-z': 'CmdOrCtrl+Shift+Z', 'Mod-f': 'CmdOrCtrl+F', 'Mod-=': 'CmdOrCtrl+=', 'Mod--': 'CmdOrCtrl+-', 'Mod-0': 'CmdOrCtrl+0', 'Mod-r': 'CmdOrCtrl+R', 'Mod-Alt-s': 'CmdOrCtrl+Alt+S' };
// The Mac menu bar, built from the same menus. Undo and Redo are the app's own (the PDF edits), and Cut, Copy,
// Paste and Select All are the system's, for text fields. Checkmarks are rebuilt whenever something changes.
var lastMenu = '', menuTimer = null; // var: applyTheme can run before this line
function macMenu() {
  if (!MAC_APP) return;
  const item = (id) => ({ kind: 'item', id: 'cmd:' + id, label: C[id].label, accel: ACCEL[C[id].key] || null, checked: C[id].pressed ? !!C[id].pressed() : null });
  const menus = MENUS.map(([title, ids]) => {
    // About and Check for Updates live in the Cowdrey.PDF menu.
    let items = ids.filter((id) => shown(id) && id !== 'about' && id !== 'checkUpdates').map((id) => id === '-' ? { kind: 'sep' } : item(id));
    if (title === 'Edit') {
      const rest = items.filter((x) => x.id !== 'cmd:undo' && x.id !== 'cmd:redo');
      while (rest.length && rest[0].kind === 'sep') rest.shift();
      items = [item('undo'), item('redo'), { kind: 'sep' }, { kind: 'native', role: 'cut' }, { kind: 'native', role: 'copy' }, { kind: 'native', role: 'paste' }, { kind: 'native', role: 'select_all' }, { kind: 'sep' }, ...rest];
    }
    return { title, items };
  });
  const json = JSON.stringify(menus);
  if (json === lastMenu) return;
  lastMenu = json;
  MAC_APP.core.invoke('set_menu', { menus }).catch(() => { lastMenu = ''; });
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
