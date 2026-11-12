// Cowdrey.PDF by Bradley Cowdrey (bradcowdrey.com). A PDF viewer and editor in the spirit of Cowdrey.MD.
// Pages are shown with pdf.js (Apache 2.0; its legacy build, which also runs on older iPhones, iPads and Android web views) and saved with pdf-lib (MIT). Nothing leaves the device.
'use strict';
const VERSION = '0.1.1';
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/pdf.worker.min.mjs';
const PDFLIB = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.esm.min.js';
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
const saveSettings = () => store.set('settings', S);
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }

/* ---------------- libraries (loaded on first use) ---------------- */
let pdfjs, pdfLib;
async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  try { pdfjs = await import(PDFJS); }
  catch (e) { pdfjs = null; toast('The PDF reader could not start. Restart Cowdrey.PDF and try again.'); throw e; }
  // A worker from another origin can't be started directly: start it from a copy of its code.
  try {
    const code = await (await fetch(PDFJS_WORKER)).text();
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  } catch { pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; }
  return pdfjs;
}
async function loadPdfLib() { return pdfLib || (pdfLib = await import(PDFLIB)); }

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

async function openBytes(bytes, name, handle) {
  await loadPdfjs();
  let pd;
  try { pd = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false }).promise; }
  catch (e) {
    if (e && e.name === 'PasswordException') {
      const pw = await askText('This PDF is protected', 'Enter the password to open it. It is not stored.', '', 'Open', true);
      if (pw == null) return;
      try { pd = await pdfjs.getDocument({ data: bytes.slice(), password: pw, isEvalSupported: false }).promise; }
      catch { toast('That password did not open the PDF.'); return; }
      bytes.password = pw;
    } else { toast(`Could not open ${name}: it may not be a PDF.`); return; }
  }
  const d = { id: uid(), name: name.replace(/\.pdf$/i, ''), sources: [bytes], pages: [], marks: {}, updated: Date.now(), handle: typeof handle === 'object' ? handle : null, path: typeof handle === 'string' ? handle : null };
  for (let i = 0; i < pd.numPages; i++) d.pages.push({ src: 0, i, rot: 0 });
  await showDoc(d, [pd]);
  persist();
}
async function showDoc(d, loaded) {
  for (const p of pdfDocs.values()) try { p.destroy(); } catch {}
  pdfDocs.clear();
  doc = d; selMark = null; undoStack.length = redoStack.length = 0;
  await loadPdfjs();
  for (let k = 0; k < d.sources.length; k++) {
    const pd = loaded && loaded[k] ? loaded[k] : await pdfjs.getDocument({ data: d.sources[k].slice(), password: d.sources[k].password, isEvalSupported: false }).promise;
    pdfDocs.set(k, pd);
  }
  $('#drop').hidden = true;
  setTitle(); setSaved(true);
  await layoutPages();
  renderSide();
  store.set('current', d.id);
}
function setTitle() { $('#docTitle').textContent = doc ? doc.name : 'Cowdrey.PDF'; document.title = doc ? `${doc.name} · Cowdrey.PDF` : 'Cowdrey.PDF'; }
function setSaved(saved) {
  if (doc) doc.dirty = !saved;
  $('#saveState').innerHTML = !doc ? '' : saved ? `${ic('check')} ${doc.path ? 'Saved' : 'Saved on this device'}` : (doc.path ? 'Edited · Save to update the file' : 'Edited · Save PDF to keep a copy');
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
  // Text you can select and search
  try {
    const tl = document.createElement('div'); tl.className = 'textLayer'; el.appendChild(tl);
    await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport }).render();
  } catch (e) { console.warn('text layer', e); }
  // Form fields and links
  try {
    const annots = await page.getAnnotations({ intent: 'display' });
    if (annots.length) {
      const al = document.createElement('div'); al.className = 'annotationLayer'; el.appendChild(al);
      linkService.pagesCount = doc.pages.length;
      const layer = new pdfjs.AnnotationLayer({ div: al, page, viewport: viewport.clone({ dontFlip: true }), accessibilityManager: null, annotationCanvasMap: canvasMap, annotationEditorUIManager: null, structTreeLayer: null, commentManager: null, linkService, annotationStorage: pd.annotationStorage });
      await layer.render({ annotations: annots, viewport: viewport.clone({ dontFlip: true }), page, linkService, renderForms: true, annotationStorage: pd.annotationStorage, enableScripting: false, hasJSActions: false, fieldObjects: null, imageResourcesPath: '', downloadManager: null });
      al.addEventListener('input', () => setSaved(false));
      al.addEventListener('change', () => setSaved(false));
    }
  } catch (e) { console.warn('annotation layer', e); }
  drawMarks(v);
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
function goPage(n, instant) {
  if (!views.length) return;
  n = Math.max(0, Math.min(views.length - 1, n));
  current = n;
  viewer.scrollTo({ top: views[n].el.offsetTop - 16, behavior: instant ? 'instant' : 'smooth' });
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
function svgEl(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
function drawMarks(v) {
  let svg = v.el.querySelector('svg.marks');
  if (!svg) {
    svg = svgEl('svg', { class: 'marks' });
    v.el.appendChild(svg);
    svg.addEventListener('pointerdown', (e) => onMarksDown(e, v));
  }
  svg.setAttribute('viewBox', `0 0 ${v.viewport.width} ${v.viewport.height}`);
  svg.innerHTML = '';
  const rotNow = totalRot(v);
  for (const m of marksOf(v.entry)) {
    let g;
    if (m.type === 'hl') {
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
}
function redrawPage(entry) { for (const v of views) if (v.entry === entry && v.rendered) drawMarks(v); }
function snapshot() { return JSON.stringify({ pages: doc.pages, marks: doc.marks }); }
function changed(before) {
  undoStack.push(before); if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  setSaved(false); persist(); refreshRibbon();
}
function restore(s, layout) {
  const o = JSON.parse(s); doc.pages = o.pages; doc.marks = o.marks; selMark = null;
  layout ? layoutPages(true).then(renderSide) : views.forEach((v) => v.rendered && drawMarks(v));
  setSaved(false); persist(); refreshRibbon();
}
function undo() { if (!undoStack.length) return; const now = snapshot(); const prev = undoStack.pop(); redoStack.push(now); restore(prev, JSON.parse(prev).pages.length !== doc.pages.length || prev.includes('"rot"') && prev !== now); }
function redo() { if (!redoStack.length) return; const now = snapshot(); const next = redoStack.pop(); undoStack.push(now); restore(next, true); }
function localPoint(e, v) { const r = v.el.getBoundingClientRect(); return [(e.clientX - r.left), (e.clientY - r.top)]; }
function onMarksDown(e, v) {
  const tool = app.dataset.tool;
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
function selectMark(s) { selMark = s; views.forEach((v) => v.rendered && drawMarks(v)); refreshRibbon(); }
function deleteSelected() {
  if (!selMark) return;
  const before = snapshot();
  const list = doc.marks[selMark.key] || [];
  const k = list.findIndex((m) => m.id === selMark.id);
  if (k < 0) return;
  list.splice(k, 1); const entry = selMark.entry; selMark = null; redrawPage(entry); changed(before);
}
function startMove(e, v, m) {
  if (!m) return;
  e.preventDefault();
  const before = snapshot();
  const [sx, sy] = toPdf(v, ...localPoint(e, v));
  const orig = JSON.stringify(m);
  let moved = false;
  const move = (ev) => {
    const [cx, cy] = toPdf(v, ...localPoint(ev, v));
    const dx = cx - sx, dy = cy - sy;
    const o = JSON.parse(orig);
    if (o.rects) m.rects = o.rects.map((r) => [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy]);
    if (o.pts) m.pts = o.pts.map((p) => [p[0] + dx, p[1] + dy]);
    if ('x1' in o) { m.x1 = o.x1 + dx; m.x2 = o.x2 + dx; m.y1 = o.y1 + dy; m.y2 = o.y2 + dy; }
    if ('x' in o) { m.x = o.x + dx; m.y = o.y + dy; }
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
function setTool(t) { app.dataset.tool = t; if (t !== 'select') selectMark(null); refreshRibbon(); }

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
async function addSource(bytes, indexes, at) {
  const k = doc.sources.length;
  const pd = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  pageOp(() => {
    doc.sources.push(bytes); pdfDocs.set(k, pd);
    const ins = (indexes || [...Array(pd.numPages).keys()]).map((i) => ({ src: k, i, rot: 0 }));
    doc.pages.splice(at == null ? doc.pages.length : at, 0, ...ins);
  });
}
$('#mergeInput').addEventListener('change', async (e) => {
  const files = [...e.target.files]; e.target.value = '';
  if (!doc) { for (const f of files.slice(0, 1)) await openBytes(new Uint8Array(await f.arrayBuffer()), f.name); files.shift(); }
  for (const f of files) await addSource(new Uint8Array(await f.arrayBuffer()), null, null);
  if (files.length) toast(`Added ${files.length === 1 ? files[0].name : files.length + ' PDFs'} at the end`);
});
async function extractPages() {
  const ans = await askText('Extract pages', `Which pages? For example 1-3, 5. This PDF has ${doc.pages.length}.`, String(current + 1), 'Extract');
  if (!ans) return;
  const want = parseRange(ans, doc.pages.length);
  if (!want.length) { toast('No pages in that range'); return; }
  const bytes = await buildPdf(want);
  download(bytes, `${doc.name} (pages ${ans.replace(/\s+/g, '')}).pdf`);
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
async function buildPdf(only) {
  const L = await loadPdfLib();
  const { PDFDocument, degrees, rgb, StandardFonts, BlendMode, LineCapStyle, PDFName, PDFString, PDFHexString } = L;
  // Form values typed into the page are written by pdf.js into a copy of each source first.
  const bytes = await Promise.all(doc.sources.map(async (b, k) => {
    const pd = pdfDocs.get(k);
    try { if (pd.annotationStorage.size) return await pd.saveDocument(); } catch {}
    return b;
  }));
  const loaded = await Promise.all(bytes.map((b) => PDFDocument.load(b, { ignoreEncryption: true, updateMetadata: false })));
  const entries = only ? only.map((n) => doc.pages[n]) : doc.pages;
  const same = !only && doc.sources.length === 1 && entries.length === loaded[0].getPageCount() && entries.every((e, n) => e.src === 0 && e.i === n);
  let out, pages;
  if (same) { out = loaded[0]; pages = out.getPages(); }
  else {
    out = await PDFDocument.create();
    pages = [];
    for (const e of entries) { const [p] = await out.copyPages(loaded[e.src], [e.i]); out.addPage(p); pages.push(p); }
  }
  const font = await out.embedFont(StandardFonts.Helvetica);
  const col = (hex) => { const n = parseInt(hex.slice(1), 16); return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
  const vec = (r) => { const a = r * Math.PI / 180; return { right: [Math.cos(a), Math.sin(a)], down: [Math.sin(a), -Math.cos(a)] }; };
  const imgCache = new Map();
  for (let n = 0; n < entries.length; n++) {
    const e = entries[n], p = pages[n];
    if (e.rot) p.setRotation(degrees((p.getRotation().angle + e.rot) % 360));
    for (const m of (doc.marks[pageKey(e)] || [])) {
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
  }
  out.setTitle(doc.name); out.setProducer('Cowdrey.PDF ' + VERSION + ' (bradcowdrey.com)'); out.setModificationDate(new Date());
  void PDFString;
  return out.save();
}
function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function nativeSave(bytes, copy) {
  const name = doc.name + (copy ? ' (copy)' : '') + '.pdf';
  if (MAC_APP) {
    let target = !copy && doc.path;
    if (!target) target = await MAC_APP.dialog.save({ defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!target) return false;
    await MAC_APP.core.invoke('write_binary_file', { path: target, base64: bytesToB64(bytes) });
    if (!copy) doc.path = target;
    toast(`Saved ${target.split('/').pop()}`);
    return true;
  }
  // iPhone, iPad and Android: the share sheet offers Save to Files, Drive, Mail, AirDrop and the rest.
  const path = await NATIVE.core.invoke('write_share_file', { name, contents: '', base64: bytesToB64(bytes) });
  await NATIVE.core.invoke('plugin:sharekit|share_file', { url: 'file://' + (ANDROID_APP ? path : encodeURI(path)), mimeType: 'application/pdf', title: name });
  return true;
}
async function savePdf(copy) {
  if (!doc) return;
  try {
    const bytes = await buildPdf();
    if (NATIVE) { if (await nativeSave(bytes, copy)) { setSaved(true); window.__lastSaved = bytes; } return; }
    if (doc.handle && !copy && doc.handle.createWritable) {
      const w = await doc.handle.createWritable(); await w.write(bytes); await w.close();
      toast(`Saved ${doc.name}.pdf`);
    } else if (!copy && window.showSaveFilePicker) {
      try {
        const h = await window.showSaveFilePicker({ suggestedName: doc.name + '.pdf', types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
        const w = await h.createWritable(); await w.write(bytes); await w.close(); doc.handle = h; toast(`Saved ${h.name}`);
      } catch (e) { if (e && e.name === 'AbortError') return; download(bytes, doc.name + '.pdf'); }
    } else download(bytes, doc.name + (copy ? ' (copy)' : '') + '.pdf');
    setSaved(true); window.__lastSaved = bytes;
  } catch (e) { console.error(e); toast(`Could not save: ${e.message || e}`); }
}
async function exportImage() {
  const v = views[current]; if (!v) return;
  const vp = v.page.getViewport({ scale: 2, rotation: totalRot(v) });
  const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
  await v.page.render({ canvas: c, canvasContext: c.getContext('2d'), viewport: vp }).promise;
  const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `${doc.name} page ${current + 1}.png`; a.click();
}
async function exportText() {
  const parts = [];
  for (const e of doc.pages) { const tc = await (await pageOf(e)).getTextContent(); parts.push(tc.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join('')); }
  const url = URL.createObjectURL(new Blob([parts.join('\n\n')], { type: 'text/plain' }));
  const a = document.createElement('a'); a.href = url; a.download = doc.name + '.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function printDoc() {
  for (const v of views) await renderView(v);
  window.print();
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
function setSide(t) { S.side = t; saveSettings(); $$('.side-tabs [data-side]').forEach((b) => b.setAttribute('aria-selected', b.dataset.side === t)); renderSide(); }
$$('.side-tabs [data-side]').forEach((b) => b.addEventListener('click', () => setSide(b.dataset.side)));
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
function toggleSidebar(on) {
  const phone = matchMedia('(max-width: 760px)').matches;
  if (phone) { app.dataset.sidebar = on ?? app.dataset.sidebar !== 'open' ? 'open' : 'on'; if (on === false) app.dataset.sidebar = 'on'; return; }
  S.sidebar = on ?? !S.sidebar; saveSettings(); app.dataset.sidebar = S.sidebar ? 'on' : 'off';
  if (doc && S.zoom === 'fit') setTimeout(() => layoutPages(true), 50);
}

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
  const rec = { id: doc.id, name: doc.name, path: doc.path || null, sources: doc.sources, passwords: doc.sources.map((s) => s.password || null), pages: doc.pages, marks: doc.marks, updated: doc.updated };
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
  $$('[data-id]', panel).forEach((b) => { b.onclick = () => openStored(b.dataset.id); });
  $$('[data-del]', panel).forEach((b) => { b.onclick = async () => {
    const ok = await dialog('Remove this PDF?', '<p>It is removed from this device. The file you opened it from is not touched.</p>', [{ label: 'Keep it' }, { label: 'Remove', value: 'yes', danger: true }]);
    if (ok !== 'yes') return;
    await dbDo('readwrite', (s) => s.delete(b.dataset.del));
    if (doc && doc.id === b.dataset.del) { doc = null; pagesEl.innerHTML = ''; views = []; $('#drop').hidden = false; setTitle(); setSaved(true); updateStatus(); }
    renderDocs();
  }; });
}
async function openStored(id) {
  const all = await listDocs(); const rec = all.find((d) => d.id === id); if (!rec) return;
  const sources = rec.sources.map((b, k) => { const u = b instanceof Uint8Array ? b : new Uint8Array(b); if (rec.passwords && rec.passwords[k]) u.password = rec.passwords[k]; return u; });
  await showDoc({ id: rec.id, name: rec.name, sources, pages: rec.pages, marks: rec.marks || {}, updated: rec.updated, handle: null, path: rec.path || null });
}

/* ---------------- opening files ---------------- */
async function openFiles() {
  if (MAC_APP) {
    const picked = await MAC_APP.dialog.open({ multiple: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    const path = typeof picked === 'string' ? picked : picked && picked.path;
    if (!path) return;
    try {
      const f = await MAC_APP.core.invoke('read_text_file', { path });
      await openBytes(b64ToBytes(f.content), f.name, f.path);
    } catch (e) { console.error(e); toast(`Could not open ${path.split('/').pop()}.`); }
    return;
  }
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({ types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
      const f = await h.getFile();
      await openBytes(new Uint8Array(await f.arrayBuffer()), f.name, h);
      return;
    } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  $('#fileInput').click();
}
$('#fileInput').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await openBytes(new Uint8Array(await f.arrayBuffer()), f.name); });
['dragenter', 'dragover'].forEach((t) => window.addEventListener(t, (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); app.dataset.dragging = 'on'; } }));
['dragleave', 'drop'].forEach((t) => window.addEventListener(t, () => { app.dataset.dragging = 'off'; }));
window.addEventListener('drop', async (e) => {
  const files = [...(e.dataTransfer ? e.dataTransfer.files : [])].filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
  if (!files.length) return;
  e.preventDefault();
  if (!doc || !e.shiftKey) { await openBytes(new Uint8Array(await files[0].arrayBuffer()), files[0].name); files.shift(); }
  for (const f of files) await addSource(new Uint8Array(await f.arrayBuffer()), null, null);
});

/* ---------------- dialogs ---------------- */
function dialog(title, body, actions, setup) {
  const dlg = $('#dialog');
  dlg.innerHTML = `<div class="dlg-head"><h2>${esc(title)}</h2><button class="icon-btn" type="button" data-x aria-label="Close">${ic('x')}</button></div><div class="dlg-body">${body}</div><div class="dlg-foot">${actions.map((a, k) => `<button type="button" class="btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}" data-a="${k}">${esc(a.label)}</button>`).join('')}</div>`;
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
    const inp = $('#dlgInput', dlg); if (inp) { inp.focus(); inp.select && inp.select(); inp.onkeydown = (e) => { if (e.key === 'Enter' && (inp.tagName !== 'TEXTAREA' || e.metaKey || e.ctrlKey)) { e.preventDefault(); done(inp.value); } }; }
  });
}
function askText(title, note, value, ok, password, multiline) {
  const field = multiline ? `<textarea id="dlgInput" rows="4">${esc(value)}</textarea>` : `<input id="dlgInput" type="${password ? 'password' : 'text'}" value="${esc(value)}" autocomplete="off">`;
  return dialog(title, `${note ? `<p>${esc(note)}</p>` : ''}<label class="field">${field}</label>`, [{ label: 'Cancel' }, { label: ok, primary: true, input: true }]);
}
function about() {
  dialog('About Cowdrey.PDF', `<div class="about"><img class="logo" src="__APP_ICON__" alt="" aria-hidden="true"><div><strong style="font-size:18px;color:var(--ink)">Cowdrey.PDF ${VERSION}</strong><br>by Bradley Cowdrey · <a href="https://bradcowdrey.com" target="_blank" rel="noopener">bradcowdrey.com</a></div></div>
  <p>A PDF viewer and editor in the spirit of Cowdrey.MD: read, mark up, sign, fill forms, and rearrange pages. Your PDFs stay on this device.</p>
  <p style="font-size:12px">Built with pdf.js (Apache 2.0), pdf-lib (MIT) and Lucide (ISC). <a href="https://bradcowdrey.com/legal" target="_blank" rel="noopener">Terms of Use and Privacy</a></p>`, [{ label: 'Close', primary: true }]);
}

/* ---------------- commands, menus, ribbon ---------------- */
const C = {};
const has = () => !!doc && doc.pages.length > 0;
function cmd(id, o) { C[id] = o; }
function run(id) { const c = C[id]; if (!c) return; if (c.enabled && !c.enabled()) return; closePopover(); c.run(); }
cmd('open', { label: 'Open…', icon: 'folder-open', key: 'Mod-o', run: openFiles });
cmd('save', { label: 'Save PDF', icon: 'download', key: 'Mod-s', enabled: has, run: () => savePdf(false) });
cmd('saveCopy', { label: 'Save a copy…', icon: 'copy', key: 'Mod-Shift-s', enabled: has, run: () => savePdf(true) });
cmd('merge', { label: 'Add PDFs at the end…', icon: 'files', run: () => $('#mergeInput').click() });
cmd('exportImage', { label: 'Export this page as an image', icon: 'image-down', enabled: has, run: exportImage });
cmd('exportText', { label: 'Export text (.txt)', icon: 'file-text', enabled: has, run: exportText });
cmd('print', { label: 'Print…', icon: 'printer', key: 'Mod-p', enabled: has, run: printDoc });
cmd('undo', { label: 'Undo', icon: 'undo-2', key: 'Mod-z', enabled: () => undoStack.length > 0, run: undo });
cmd('redo', { label: 'Redo', icon: 'redo-2', key: 'Mod-Shift-z', enabled: () => redoStack.length > 0, run: redo });
cmd('find', { label: 'Find…', icon: 'search', key: 'Mod-f', enabled: has, run: openFind });
cmd('deleteMark', { label: 'Delete selected mark', icon: 'trash-2', enabled: () => !!selMark, run: deleteSelected });
const tools = [['select', 'Select', 'mouse-pointer-2'], ['highlight', 'Highlight', 'highlighter'], ['pen', 'Draw', 'pen-line'], ['rect', 'Box', 'square'], ['text', 'Text', 'type'], ['note', 'Note', 'sticky-note']];
for (const [t, label, icon] of tools) cmd('tool_' + t, { label, icon, enabled: has, pressed: () => app.dataset.tool === t, run: () => { if (t === 'highlight' && highlightSelection()) return; setTool(t); } });
cmd('sign', { label: 'Signature…', icon: 'signature', enabled: has, run: signature });
cmd('image', { label: 'Picture…', icon: 'image-plus', enabled: has, run: () => $('#imageInput').click() });
cmd('rotL', { label: 'Rotate left', icon: 'rotate-ccw', enabled: has, run: () => rotatePage(-90) });
cmd('rotR', { label: 'Rotate right', icon: 'rotate-cw', key: 'Mod-r', enabled: has, run: () => rotatePage(90) });
cmd('rotAll', { label: 'Rotate all pages', icon: 'refresh-cw', enabled: has, run: () => rotateAll(90) });
cmd('up', { label: 'Move page up', icon: 'arrow-up', enabled: () => has() && current > 0, run: () => movePage(-1) });
cmd('down', { label: 'Move page down', icon: 'arrow-down', enabled: () => has() && current < doc.pages.length - 1, run: () => movePage(1) });
cmd('dup', { label: 'Duplicate page', icon: 'copy-plus', enabled: has, run: duplicatePage });
cmd('blank', { label: 'Insert blank page', icon: 'file-plus-2', enabled: has, run: insertBlank });
cmd('delPage', { label: 'Delete page', icon: 'file-x-2', enabled: has, run: deletePage });
cmd('extract', { label: 'Extract pages…', icon: 'file-output', enabled: has, run: extractPages });
cmd('sidebar', { label: 'Sidebar', icon: 'panel-left', key: 'Mod-Alt-s', pressed: () => S.sidebar, run: () => toggleSidebar() });
cmd('darkPage', { label: 'Dark pages', icon: 'moon-star', pressed: () => S.darkPage, run: () => { S.darkPage = !S.darkPage; saveSettings(); applyTheme(); refreshRibbon(); } });
cmd('zoomIn', { label: 'Zoom in', icon: 'zoom-in', key: 'Mod-=', enabled: has, run: () => setZoom(Math.min(400, Math.round(scale * 100) + 10)) });
cmd('zoomOut', { label: 'Zoom out', icon: 'zoom-out', key: 'Mod--', enabled: has, run: () => setZoom(Math.max(25, Math.round(scale * 100) - 10)) });
cmd('zoomFit', { label: 'Fit width', icon: 'move-horizontal', key: 'Mod-0', enabled: has, run: () => setZoom('fit') });
cmd('zoom100', { label: 'Actual size', icon: 'scan', enabled: has, run: () => setZoom(100) });
[['system', 'Match system', 'sun-moon'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']].forEach(([v, l, i]) => cmd('theme_' + v, { label: 'Appearance: ' + l, icon: i, pressed: () => S.theme === v, run: () => { S.theme = v; saveSettings(); applyTheme(); } }));
cmd('about', { label: 'About Cowdrey.PDF', icon: 'info', run: about });
cmd('shortcuts', { label: 'Keyboard shortcuts', icon: 'keyboard', run: () => dialog('Keyboard shortcuts', `<div style="display:grid;grid-template-columns:1fr auto;gap:6px 18px">${Object.values(C).filter((c) => c.key).map((c) => `<span>${esc(c.label)}</span><span style="color:var(--ink-3)">${fmtKey(c.key)}</span>`).join('')}</div>`, [{ label: 'Close', primary: true }]) });
cmd('legal', { label: 'Terms of Use and Privacy', icon: 'scale', run: () => window.open('https://bradcowdrey.com/legal', '_blank', 'noopener') });

const fmtKey = (k) => k ? k.split(/-(?=.)/).map((p) => isMac ? ({ Mod: '⌘', Shift: '⇧', Alt: '⌥' }[p] || p.toUpperCase()) : ({ Mod: 'Ctrl', Shift: 'Shift', Alt: 'Alt' }[p] || p.toUpperCase())).join(isMac ? '' : '+') : '';
const MENUS = [
  ['File', ['open', 'save', 'saveCopy', '-', 'merge', 'exportImage', 'exportText', '-', 'print']],
  ['Edit', ['undo', 'redo', '-', 'deleteMark', '-', 'find']],
  ['View', ['sidebar', 'darkPage', '-', 'zoomIn', 'zoomOut', 'zoomFit', 'zoom100', '-', 'theme_system', 'theme_light', 'theme_dark']],
  ['Mark up', ['tool_select', 'tool_highlight', 'tool_pen', 'tool_rect', 'tool_text', 'tool_note', '-', 'sign', 'image']],
  ['Pages', ['rotL', 'rotR', 'rotAll', '-', 'up', 'down', 'dup', 'blank', 'merge', '-', 'extract', 'delPage']],
  ['Help', ['shortcuts', 'legal', '-', 'about']],
];
function menuHtml(ids) {
  return ids.map((id) => id === '-' ? '<div class="msep"></div>' : (() => { const c = C[id]; const on = c.pressed ? c.pressed() : null; const dis = c.enabled && !c.enabled(); return `<button type="button" class="mi" role="menuitem" data-cmd="${id}"${dis ? ' disabled' : ''}>${on === null ? ic(c.icon) : on ? ic('check') : '<span></span>'}<span>${esc(c.label)}</span><span class="k">${fmtKey(c.key)}</span></button>`; })()).join('');
}
const pop = $('#popover');
function openPopover(anchor, html) {
  pop.innerHTML = html; pop.hidden = false; icons();
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 8) + 'px'; pop.style.top = r.bottom + 4 + 'px';
  const f = $('.mi:not([disabled])', pop); f && f.focus();
}
function closePopover() { pop.hidden = true; $$('.menubar > button').forEach((b) => b.setAttribute('aria-expanded', 'false')); }
pop.addEventListener('click', (e) => { const b = e.target.closest('[data-cmd]'); if (b) run(b.dataset.cmd); });
document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.menubar')) closePopover(); });
$('#menubar').innerHTML = MENUS.map(([t], k) => `<button type="button" data-menu="${k}" aria-haspopup="menu" aria-expanded="false">${t}</button>`).join('');
$$('#menubar > button').forEach((b) => b.addEventListener('click', () => {
  const open = b.getAttribute('aria-expanded') === 'true';
  closePopover(); if (open) return;
  b.setAttribute('aria-expanded', 'true'); openPopover(b, menuHtml(MENUS[+b.dataset.menu][1]));
}));
const RIBBON = {
  home: ['Home', [['File', ['open', 'save', 'print']], ['Edit', ['undo', 'redo', 'find']], ['View', ['zoomOut', 'zoomIn', 'zoomFit', 'sidebar', 'darkPage']]]],
  markup: ['Mark up', [['Tools', ['tool_select', 'tool_highlight', 'tool_pen', 'tool_rect', 'tool_text', 'tool_note']], ['Add', ['sign', 'image']], ['Colour', 'COLORS'], ['Edit', ['deleteMark', 'undo']]]],
  pages: ['Pages', [['Rotate', ['rotL', 'rotR', 'rotAll']], ['Order', ['up', 'down', 'dup']], ['Insert', ['blank', 'merge']], ['Remove', ['extract', 'delPage']]]],
  export: ['Export', [['Save', ['save', 'saveCopy']], ['Export', ['exportImage', 'exportText', 'print']]]],
};
const COLORS = ['#FFD43B', '#69DB7C', '#74C0FC', '#F783AC', '#E03131', '#2448C9', '#111111'];
function renderRibbon() {
  $('#ribbonTabs').innerHTML = Object.entries(RIBBON).map(([k, [t]]) => `<button type="button" role="tab" data-rt="${k}" aria-selected="${S.ribbon === k}">${t}</button>`).join('');
  $$('#ribbonTabs [data-rt]').forEach((b) => b.onclick = () => { S.ribbon = b.dataset.rt; saveSettings(); renderRibbon(); });
  const [, groups] = RIBBON[S.ribbon] || RIBBON.home;
  $('#ribbonBody').innerHTML = groups.map(([label, ids]) => `<div class="r-group"><div class="r-items">${ids === 'COLORS'
    ? COLORS.map((c) => `<button type="button" class="swatch" data-color="${c}" style="background:${c}" aria-label="Colour ${c}" aria-pressed="${S.color === c}"></button>`).join('')
    : ids.map((id) => `<button type="button" class="rb" data-cmd="${id}" title="${esc(C[id].label + (C[id].key ? ' (' + fmtKey(C[id].key) + ')' : ''))}">${ic(C[id].icon)}<span>${esc(C[id].label.replace(/…$/, '').replace(/^Appearance: /, ''))}</span></button>`).join('')}</div><div class="r-label">${label}</div></div>`).join('');
  $$('#ribbonBody [data-color]').forEach((b) => b.onclick = () => { S.color = b.dataset.color; saveSettings(); renderRibbon(); });
  icons(); refreshRibbon();
}
function refreshRibbon() {
  $$('#ribbonBody [data-cmd]').forEach((b) => { const c = C[b.dataset.cmd]; b.disabled = !!(c.enabled && !c.enabled()); if (c.pressed) b.setAttribute('aria-pressed', !!c.pressed()); });
  $('#saveBtn').disabled = !has();
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-cmd]'); if (b && !pop.contains(b)) run(b.dataset.cmd); });

/* ---------------- keys ---------------- */
document.addEventListener('keydown', (e) => {
  if ($('#dialog').open) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod) {
    const key = (e.shiftKey ? 'Shift-' : '') + (e.altKey ? 'Alt-' : '') + e.key.toLowerCase();
    const map = { 'o': 'open', 's': 'save', 'shift-s': 'saveCopy', 'p': 'print', 'z': 'undo', 'shift-z': 'redo', 'y': 'redo', 'f': 'find', '=': 'zoomIn', '+': 'zoomIn', '-': 'zoomOut', '0': 'zoomFit', 'r': 'rotR', 'alt-s': 'sidebar' };
    const id = map[key.replace('Shift-', 'shift-').replace('Alt-', 'alt-')];
    if (id && !(typing && ['z', 'shift-z', 'y'].includes(key.toLowerCase()))) { e.preventDefault(); run(id); }
    return;
  }
  if (typing) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selMark) { e.preventDefault(); deleteSelected(); }
  if (e.key === 'Escape') { if (!$('#findbar').hidden) closeFind(); else { setTool('select'); pendingImage = null; selectMark(null); } }
  if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !e.altKey)) { if (doc) { e.preventDefault(); goPage(current + 1); } }
  if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && !e.altKey)) { if (doc) { e.preventDefault(); goPage(current - 1); } }
});

/* ---------------- theme ---------------- */
function applyTheme() {
  const root = document.documentElement;
  if (S.theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', S.theme);
  app.dataset.darkpage = S.darkPage ? 'on' : 'off';
  $('#themeBtn').innerHTML = ic({ system: 'sun-moon', light: 'sun', dark: 'moon' }[S.theme]);
  $('#themeBtn').title = { system: 'Appearance: match system', light: 'Appearance: light', dark: 'Appearance: dark' }[S.theme];
  icons();
}
$('#themeBtn').onclick = () => { S.theme = { system: 'light', light: 'dark', dark: 'system' }[S.theme]; saveSettings(); applyTheme(); toast($('#themeBtn').title); };
window.addEventListener('beforeunload', (e) => { if (doc && doc.dirty && doc.handle) { e.preventDefault(); e.returnValue = ''; } });

/* ---------------- the apps ---------------- */
// Files the system asked us to open: Finder (Mac), Open With from Files or Mail (iPhone, iPad), Open with (Android).
async function takeOpened() {
  let files = [];
  try { files = await NATIVE.core.invoke('take_opened_files'); } catch {}
  for (const f of files || []) {
    try {
      if (f.content) await openBytes(b64ToBytes(f.content), f.name, MAC_APP ? f.path : null);
      else if (f.path.includes('://') && NATIVE.fs) await openBytes(new Uint8Array(await NATIVE.fs.readFile(f.path)), decodeURIComponent(f.path.split('/').pop()).replace(/^.*[:%]/, '') || 'Document.pdf');
    } catch (e) { toast(`Could not open that file: ${e}`); }
  }
}
const ACCEL = { 'Mod-o': 'CmdOrCtrl+O', 'Mod-s': 'CmdOrCtrl+S', 'Mod-Shift-s': 'CmdOrCtrl+Shift+S', 'Mod-p': 'CmdOrCtrl+P', 'Mod-z': 'CmdOrCtrl+Z', 'Mod-Shift-z': 'CmdOrCtrl+Shift+Z', 'Mod-f': 'CmdOrCtrl+F', 'Mod-=': 'CmdOrCtrl+=', 'Mod--': 'CmdOrCtrl+-', 'Mod-0': 'CmdOrCtrl+0', 'Mod-r': 'CmdOrCtrl+R', 'Mod-Alt-s': 'CmdOrCtrl+Alt+S' };
function macMenu() {
  if (!MAC_APP) return;
  const menus = MENUS.filter(([t]) => t !== 'Help' || true).map(([title, ids]) => ({
    title: title === 'Help' ? 'Help' : title,
    items: (title === 'Edit' ? [{ kind: 'native', role: 'undo' }, { kind: 'native', role: 'redo' }, { kind: 'sep' }, { kind: 'native', role: 'cut' }, { kind: 'native', role: 'copy' }, { kind: 'native', role: 'paste' }, { kind: 'native', role: 'select_all' }, { kind: 'sep' }] : [])
      .concat(ids.filter((id) => id === '-' || (C[id] && !(title === 'Edit' && (id === 'undo' || id === 'redo')) && id !== 'about')).map((id) => id === '-' ? { kind: 'sep' } : { kind: 'item', id: 'cmd:' + id, label: C[id].label, accel: ACCEL[C[id].key] || null, checked: C[id].pressed ? !!C[id].pressed() : null })),
  }));
  MAC_APP.core.invoke('set_menu', { menus }).catch(() => {});
}
if (NATIVE) {
  NATIVE.event.listen('open-files', takeOpened);
  setTimeout(takeOpened, 0);
  NATIVE.event.listen('menu-command', (e) => { const id = String(e.payload); if (id === 'undo' || id === 'redo') run(id); else run(id); setTimeout(macMenu, 50); });
  // Quitting: keep the library up to date first; the app waits a moment for this.
  NATIVE.event.listen('flush-and-quit', async () => { clearTimeout(persistTimer); try { await persistNow(); } catch {} NATIVE.core.invoke('quit_app').catch(() => {}); });
  macMenu();
}

/* ---------------- start ---------------- */
applyTheme();
app.dataset.sidebar = S.sidebar ? 'on' : 'off';
$$('.side-tabs [data-side]').forEach((b) => b.setAttribute('aria-selected', b.dataset.side === S.side));
renderRibbon(); renderSide(); updateStatus(); icons();
(async () => {
  const last = store.get('current', null);
  if (last) { try { await openStored(last); } catch (e) { console.warn(e); } }
})();
// For tests and automation
window.__cowdreyPdf = { get doc() { return doc; }, openBytes, buildPdf, run, setTool, views: () => views, highlightSelection, get current() { return current; } };
