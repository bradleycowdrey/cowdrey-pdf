/* View: the Hand tool (and Space held down to pan), page layouts (continuous, single page, two pages), the
   Attachments panel in the sidebar, and page labels (iii, A-1…) in the page box and the thumbnails.
   Fit page, Actual size and the layouts themselves are in the core (fitScale, layoutPages, goPage).

   docMarks(): { id, type: 'file', fid, name, mime, size, desc, at } — a file attached here, written into the PDF's
   attached files when it is saved. Its bytes are kept on this device (IndexedDB 'cowdrey.pdf.files', by fid), not in
   the marks, so undo and Recent stay small. */

/* ---- Hand tool: drag to move around the document; Space held down does the same in any tool ---- */
TOOL_HINTS.hand = 'Drag to move around the page';
cmd('tool_hand', { label: 'Hand', icon: 'hand', key: 'h', enabled: has, pressed: () => app.dataset.tool === 'hand', run: () => setTool('hand') });
FEATURE.tools.hand = { down() {} }; // the page layers let the press through to the viewer, which pans
let vwSpace = false, vwSpaceUsed = false, vwPan = null;
const vwPanning = () => app.dataset.tool === 'hand' || vwSpace;
viewer.addEventListener('pointerdown', (e) => {
  if (!vwPanning() || !has() || e.pointerType === 'touch' || e.button !== 0) return; // a finger scrolls by itself
  if (e.target.closest && e.target.closest('.find-dock, .line-editor, .page-ask, input, textarea, select, [contenteditable="true"]')) return;
  e.preventDefault(); e.stopPropagation(); // no selection, no drawing with the tool in use
  navUnlock();
  vwPan = { id: e.pointerId, x: e.clientX, y: e.clientY, top: viewer.scrollTop, left: viewer.scrollLeft, moved: false, target: e.target };
  try { viewer.setPointerCapture(e.pointerId); } catch {}
  app.classList.add('vw-grabbing');
  if (vwSpace) vwSpaceUsed = true;
  viewer.focus({ preventScroll: true });
}, true);
viewer.addEventListener('pointermove', (e) => {
  const p = vwPan; if (!p || e.pointerId !== p.id) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  if (!p.moved && Math.hypot(dx, dy) < 3) return;
  p.moved = true;
  viewer.scrollLeft = p.left - dx; viewer.scrollTop = p.top - dy;
});
function vwPanEnd(e) {
  const p = vwPan; if (!p || e.pointerId !== p.id) return;
  vwPan = null; app.classList.remove('vw-grabbing');
  try { viewer.releasePointerCapture(e.pointerId); } catch {}
  // A click without a drag still follows a link, as Acrobat's Hand tool does.
  if (!p.moved && e.type === 'pointerup') { const a = p.target.closest && p.target.closest('.annotationLayer a[href]'); if (a) a.click(); }
}
viewer.addEventListener('pointerup', vwPanEnd); viewer.addEventListener('pointercancel', vwPanEnd);
// Space on the page: held down and dragged, it pans; tapped, it scrolls a screen down (Shift: up), as it did before.
const vwOnPage = () => {
  const a = document.activeElement;
  return !a || a === document.body || a === viewer || (viewer.contains(a) && !a.closest('button, a, input, textarea, select, [contenteditable], [role], [tabindex]:not(#viewer)'));
};
document.addEventListener('keydown', (e) => {
  if ($('#dialog').open || !has()) return;
  if (!pop.hidden && pop.contains(document.activeElement)) return;
  if (e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey && vwOnPage() && matchMedia('(any-pointer: fine)').matches) {
    e.preventDefault();
    if (!e.repeat && !vwSpace) { vwSpace = true; vwSpaceUsed = false; app.classList.add('vw-space'); }
    return;
  }
  // H: the Hand tool (from anywhere but a text field)
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
  if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !typing) { e.preventDefault(); run('tool_hand'); }
}, true);
function vwSpaceOff() { vwSpace = false; app.classList.remove('vw-space'); }
document.addEventListener('keyup', (e) => {
  if (e.key !== ' ' || !vwSpace) return;
  const used = vwSpaceUsed || vwPan; vwSpaceOff();
  if (used || !has()) return;
  e.preventDefault();
  const d = e.shiftKey ? -1 : 1, atEnd = viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 2, atTop = viewer.scrollTop <= 0;
  if (singleUp() && d > 0 && atEnd) return goPage(current + 1, true);
  if (singleUp() && d < 0 && atTop && current > 0) { goPage(current - 1, true); viewer.scrollTop = viewer.scrollHeight; return; }
  viewer.scrollBy({ top: d * viewer.clientHeight * .85, behavior: reduceMotion.matches ? 'instant' : 'smooth' });
});
window.addEventListener('blur', vwSpaceOff);

/* ---- page layout ---- */
S.layout = ['scroll', 'single', 'two'].includes(S.layout) ? S.layout : 'scroll';
async function vwSetLayout(l, cover = S.cover) {
  if (S.layout === l && !!S.cover === !!cover) return;
  S.layout = l; S.cover = !!cover; saveSettings();
  if (doc) { const at = current; await layoutPages(true); goPage(at, true); }
  refreshRibbon();
}
cmd('vw_lay_scroll', { label: 'Continuous', icon: 'rows-2', enabled: has, pressed: () => S.layout === 'scroll', run: () => vwSetLayout('scroll') });
cmd('vw_lay_single', { label: 'Single page', icon: 'file', enabled: has, pressed: () => S.layout === 'single', run: () => vwSetLayout('single') });
cmd('vw_lay_two', { label: 'Two pages', icon: 'book-open', enabled: has, pressed: () => S.layout === 'two' && !S.cover, run: () => vwSetLayout('two', false) });
cmd('vw_lay_cover', { label: 'Two pages with cover', icon: 'book', enabled: has, pressed: () => S.layout === 'two' && !!S.cover, run: () => vwSetLayout('two', true) });
const VW_LAYOUTS = ['vw_lay_scroll', 'vw_lay_single', 'vw_lay_two', 'vw_lay_cover'];
cmd('vw_layout', { label: 'Page layout', rlabel: 'Layout', icon: 'book-open', enabled: has, menu: VW_LAYOUTS });
// One page at a time: scrolling past its end (or its top) turns the page. A wheel at the edge first stops there, so
// one long flick does not turn several pages.
let vwEdge = 0, vwTurned = 0;
viewer.addEventListener('wheel', (e) => {
  if (!singleUp() || !has() || e.ctrlKey || e.metaKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
  const d = Math.sign(e.deltaY), atEnd = viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 2, atTop = viewer.scrollTop <= 0;
  const edge = (d > 0 && atEnd && current < views.length - 1) ? 1 : (d < 0 && atTop && current > 0) ? -1 : 0;
  const now = performance.now();
  if (!edge) { vwEdge = 0; return; }
  if (vwEdge !== edge) { vwEdge = edge; vwTurned = now; return; } // arrived at the edge: stop there first
  if (now - vwTurned < 350) { vwTurned = now; return; } // still the same flick
  vwEdge = 0; vwTurned = now;
  goPage(current + edge, true);
  if (edge < 0) viewer.scrollTop = viewer.scrollHeight;
}, { passive: true });

/* ---- page labels: iii, 1, A-1… as the PDF names its pages ---- */
let vwLabels = null; // the opened file's labels, by its own page index (null: it has none, or they are 1, 2, 3…)
async function vwReadLabels(d) {
  vwLabels = null;
  try {
    const l = await pdfDocs.get(0).getPageLabels();
    if (doc === d && l && l.some((x, i) => x !== String(i + 1))) vwLabels = l;
  } catch {}
}
// The label of the page now at place n, or '' when it has none (pages from another PDF, or no labels).
function vwLabel(n) { const e = doc && doc.pages[n]; return vwLabels && e && e.src === 0 && vwLabels[e.i] ? vwLabels[e.i] : ''; }
const vwHasLabels = () => !!(vwLabels && doc && doc.pages.some((e, n) => vwLabel(n) && vwLabel(n) !== String(n + 1)));
function vwLabelStatus() {
  const box = $('#pageJump'), on = vwHasLabels() && doc.pages.length > 0, l = on ? vwLabel(current) : '';
  $('#pageOf').textContent = on ? `(${current + 1} of ` : 'of ';
  $('#pageEnd').textContent = on ? ')' : '';
  box.inputMode = on ? 'text' : 'numeric';
  box.setAttribute('aria-label', on ? 'Page label or number' : 'Page number');
  if (on && document.activeElement !== box) box.value = l || current + 1;
  box.style.width = on ? `${Math.max(44, Math.min(110, 18 + 8 * String(box.value).length))}px` : '';
}
const vwUpdateStatus0 = updateStatus;
updateStatus = function () { vwUpdateStatus0(); vwLabelStatus(); };
// Go to page: a label first (as typed, any case), else a page number.
function vwFindPage(text) {
  const t = String(text).trim(); if (!t || !doc) return -1;
  if (vwHasLabels()) { const k = doc.pages.findIndex((e, n) => vwLabel(n).toLowerCase() === t.toLowerCase()); if (k >= 0) return k; }
  const n = parseInt(t, 10); return n ? Math.max(0, Math.min(doc.pages.length - 1, n - 1)) : -1;
}
// Before the page box's own handler (which knows only numbers): the status bar sees the change first.
$('.statusbar').addEventListener('change', (e) => {
  if (e.target !== $('#pageJump') || !vwHasLabels()) return;
  e.stopPropagation();
  const n = vwFindPage(e.target.value); if (n >= 0) goPage(n);
}, true);
function vwThumbLabels() {
  if (!vwHasLabels()) return;
  for (const t of $$('#sidePanel .thumb')) {
    const n = +t.dataset.n, l = vwLabel(n), s = $(':scope > span', t);
    if (!l || l === String(n + 1)) continue;
    if (s) s.textContent = `${l} (${n + 1})`;
    t.setAttribute('aria-label', `Page ${l} (${n + 1} of ${doc.pages.length})`);
  }
}
FEATURE.onDocShown.push(async (d) => { await vwReadLabels(d); if (doc !== d) return; updateStatus(); vwThumbLabels(); vwAttCache = null; if (S.side === 'files') renderSide(); });
TEST_HOOKS.pageLabel = (n) => vwLabel(n);

/* ---- attached files: a sidebar tab listing them, Save for each, Attach file… to add one ---- */
{
  const tabs = $('.side-tabs'), b = document.createElement('button');
  Object.assign(b, { type: 'button', title: 'Attachments', innerHTML: `${ic('paperclip')}<span>Files</span>` });
  b.setAttribute('role', 'tab'); b.dataset.side = 'files'; b.setAttribute('aria-selected', 'false'); b.setAttribute('aria-controls', 'sidePanel'); b.setAttribute('aria-label', 'Attachments');
  b.addEventListener('click', () => setSide('files'));
  tabs.insertBefore(b, $('[data-side="docs"]', tabs));
}
const vwRenderSide0 = renderSide;
renderSide = async function () {
  if (S.side === 'files') return vwFilesPanel();
  const r = await vwRenderSide0();
  if (S.side === 'thumbs') vwThumbLabels();
  return r;
};
let vwDbP = null;
function vwDb() {
  return vwDbP || (vwDbP = new Promise((res, rej) => {
    const r = indexedDB.open('cowdrey.pdf.files', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => { vwDbP = null; rej(r.error); };
  }));
}
async function vwDbDo(mode, fn) {
  const db = await vwDb();
  return new Promise((res, rej) => { const t = db.transaction('files', mode), q = fn(t.objectStore('files')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); });
}
const vwBytes = new Map(); // fid -> Uint8Array, for this session
async function vwFileBytes(fid) {
  if (vwBytes.has(fid)) return vwBytes.get(fid);
  try { const r = await vwDbDo('readonly', (s) => s.get(fid)); if (r && r.bytes) { const b = new Uint8Array(r.bytes); vwBytes.set(fid, b); return b; } } catch (e) { console.warn(e); }
  return null;
}
const vwAdded = () => (doc ? docMarks().filter((m) => m.type === 'file') : []);
const vwSize = (n) => (n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
// The files in the opened PDF: its attached files (the EmbeddedFiles name tree) and file attachment comments.
let vwAttCache = null; // { doc, list: [{ name, desc, bytes, entry? }] }
async function vwFilesIn(d) {
  if (vwAttCache && vwAttCache.doc === d) return vwAttCache.list;
  const list = [], pd = pdfDocs.get(0);
  try {
    const att = await pd.getAttachments(); // a Map (pdf.js 6) or an object; the bytes are asked for one by one
    for (const [key, f] of att instanceof Map ? att : Object.entries(att || {})) {
      list.push({ name: f.filename || key, desc: f.description || '', bytes: f.content || await pd.getAttachmentContent(key).catch(() => null) });
    }
  } catch (e) { console.warn('attachments', e); }
  for (let i = 0; i < pd.numPages; i++) {
    try {
      const page = await pd.getPage(i + 1);
      for (const a of await page.getAnnotations({ intent: 'display' })) {
        if (a.subtype !== 'FileAttachment' || !a.file) continue;
        const bytes = a.file.content || (a.fileId != null ? await pd.getAttachmentContent(a.fileId).catch(() => null) : null);
        list.push({ name: a.file.filename || 'Attachment', desc: a.file.description || (a.contentsObj && a.contentsObj.str) || '', bytes, entry: { src: 0, i } });
      }
    } catch {}
    if (doc !== d) return [];
  }
  vwAttCache = { doc: d, list };
  return list;
}
async function vwFilesPanel() {
  const panel = $('#sidePanel');
  if (!doc) { panel.innerHTML = '<p class="empty-note">Open a PDF to see its attached files.</p>'; return; }
  const d = doc;
  if (!vwAttCache || vwAttCache.doc !== d) panel.innerHTML = '<p class="empty-note">Looking for attached files…</p>';
  const inPdf = await vwFilesIn(d);
  if (doc !== d || S.side !== 'files') return;
  const rows = [];
  inPdf.forEach((f, k) => {
    let where = '';
    if (f.entry) { const n = doc.pages.findIndex((e) => e.src === 0 && e.i === f.entry.i); if (n < 0) return; where = `On page ${vwLabel(n) || n + 1}`; }
    rows.push({ key: 'p' + k, name: f.name, meta: [vwSize(f.bytes ? f.bytes.length : 0), where, f.desc].filter(Boolean).join(' · '), get: async () => f.bytes });
  });
  for (const m of vwAdded()) rows.push({ key: 'a' + m.id, name: m.name, meta: `${vwSize(m.size)} · Added, kept when you save`, get: () => vwFileBytes(m.fid), mark: m });
  panel.innerHTML = `${rows.length ? `<ul class="vw-files" aria-label="Attachments">${rows.map((r) => `<li class="vw-file">${ic('paperclip')}<span class="vw-fname" title="${esc(r.name)}">${esc(r.name)}<span class="m">${esc(r.meta)}</span></span>`
    + `<button type="button" class="btn vw-fsave" data-save="${esc(r.key)}" aria-label="Save ${esc(r.name)}">Save</button>`
    + (r.mark ? `<button type="button" class="icon-btn" data-remove="${esc(r.mark.id)}" title="Remove" aria-label="Remove ${esc(r.name)}">${ic('x')}</button>` : '') + '</li>').join('')}</ul>`
    : '<p class="empty-note">This PDF has no attached files.</p>'}
    <button type="button" class="btn vw-fadd" data-cmd="vw_attach">${ic('paperclip')}<span>Attach file…</span></button>`;
  icons();
  $$('[data-save]', panel).forEach((b) => { b.onclick = async () => {
    const r = rows.find((x) => x.key === b.dataset.save), bytes = r && await r.get();
    if (!bytes) { toast('That file is no longer on this device. Attach it again.'); return; }
    await saveFile(bytes, r.name, (r.mark && r.mark.mime) || 'application/octet-stream');
  }; });
  $$('[data-remove]', panel).forEach((b) => { b.onclick = () => {
    const list = docMarks(), k = list.findIndex((m) => m.id === b.dataset.remove); if (k < 0) return;
    const before = snapshot(); list.splice(k, 1); changed(before, 'Remove attachment');
    renderSide();
  }; });
}
const vwFileInput = Object.assign(document.createElement('input'), { type: 'file', multiple: true, hidden: true, id: 'vwFileInput' });
document.body.appendChild(vwFileInput);
vwFileInput.addEventListener('change', async () => {
  const files = [...vwFileInput.files]; vwFileInput.value = '';
  if (files.length) await vwAttach(files);
});
async function vwAttach(files) {
  if (!has()) return;
  const taken = new Set([...(await vwFilesIn(doc)).filter((f) => !f.entry).map((f) => f.name), ...vwAdded().map((m) => m.name)]);
  const before = snapshot(); let n = 0;
  for (const f of files) {
    if (f.size > 100 * 1024 * 1024) { toast(`${f.name} is too big to attach (over 100 MB).`); continue; }
    const bytes = new Uint8Array(await f.arrayBuffer()), fid = uid();
    // A name already used gets a number, so each file keeps its own entry in the PDF.
    let name = f.name || 'Attachment', k = 2; const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    while (taken.has(name)) name = `${stem} (${k++})${ext}`;
    taken.add(name);
    try { await vwDbDo('readwrite', (s) => s.put({ id: fid, doc: doc.id, bytes })); } catch (e) { console.warn('could not keep the file on this device', e); }
    vwBytes.set(fid, bytes);
    docMarks().push({ id: uid(), type: 'file', fid, name, mime: f.type || 'application/octet-stream', size: bytes.length, at: Date.now() });
    n++;
  }
  if (!n) return;
  changed(before, n > 1 ? 'Attach files' : 'Attach file');
  toast(n > 1 ? `Attached ${n} files` : `Attached ${vwAdded().pop().name}`);
  if (S.side !== 'files') setSide('files'); else renderSide();
  if (!isPhone() && !S.sidebar) toggleSidebar(true);
}
TEST_HOOKS.attachFiles = (files) => vwAttach(files);
cmd('vw_attach', { label: 'Attach file…', rlabel: 'Attach file', icon: 'paperclip', enabled: has, run: () => vwFileInput.click() });
cmd('vw_files', { label: 'Attachments', icon: 'paperclip', enabled: has, pressed: () => S.side === 'files' && (isPhone() ? app.dataset.sidebar === 'open' : S.sidebar), run: () => { setSide('files'); if (isPhone() || !S.sidebar) toggleSidebar(true); } });
FEATURE.saveDoc.push(async ({ out }) => {
  for (const m of vwAdded()) {
    const bytes = await vwFileBytes(m.fid);
    if (!bytes) { console.warn('attachment missing on this device', m.name); continue; }
    await out.attach(bytes, m.name, { mimeType: m.mime, description: m.desc || undefined, creationDate: new Date(m.at), modificationDate: new Date(m.at) });
  }
});
// Files kept for documents no longer in Recent are let go, once, a little after start.
setTimeout(async () => {
  try {
    const docs = await listDocs(), keep = new Set(docs.flatMap((d) => ((d.marks && d.marks.__doc) || []).filter((m) => m.type === 'file').map((m) => m.fid)));
    if (doc) for (const m of vwAdded()) keep.add(m.fid);
    const ids = await vwDbDo('readonly', (s) => s.getAllKeys());
    const gone = (ids || []).filter((id) => !keep.has(id));
    if (gone.length) await vwDbDo('readwrite', (s) => { for (const id of gone) s.delete(id); });
  } catch {}
}, 5000);

/* ---- where it all goes ---- */
ribbonAdd('markup', 'Add', ['vw_attach']);
{ // View menu: after the zoom, the Hand tool, the layouts and Attachments
  const vm = MENUS.find(([t]) => t === 'View')[1], k = vm.indexOf('zoom100');
  vm.splice(k < 0 ? vm.length : k + 1, 0, '-', 'tool_hand', '-', ...VW_LAYOUTS, '-', 'vw_files');
}
addStyle(`
.app[data-tool="hand"] .viewer, .app.vw-space .viewer { cursor: grab; user-select: none; -webkit-user-select: none; }
.app[data-tool="hand"] .viewer :is(.page, .page *), .app.vw-space .viewer :is(.page, .page *) { cursor: grab !important; user-select: none !important; -webkit-user-select: none !important; }
.app.vw-grabbing .viewer, .app.vw-grabbing .viewer :is(.page, .page *) { cursor: grabbing !important; }
.app[data-tool="hand"] .page :is(.marks, .marks *), .app.vw-space .page :is(.marks, .marks *) { pointer-events: none !important; }
.app[data-tool="hand"] .page .annotationLayer a { cursor: pointer !important; }
.vw-files { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.vw-file { display: flex; align-items: center; gap: 8px; padding: 6px 4px 6px 8px; border-radius: 6px; color: var(--ink); }
.vw-file:hover { background: var(--hover); }
.vw-file > svg { flex: none; width: 16px; height: 16px; color: var(--ink-3); }
.vw-fname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.vw-fname .m { display: block; font-size: 11px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; }
.vw-file .btn.vw-fsave { flex: none; padding: 3px 10px; font-size: 12px; }
.vw-file .icon-btn { flex: none; width: 26px; height: 26px; }
.btn.vw-fadd { margin: 4px 8px; }
`);
