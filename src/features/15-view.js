/* View: the Hand tool (and Space held down to pan), page layouts (continuous, single page, two pages), the
   Attachments panel in the sidebar, and page labels (iii, A-1…) in the page box and the thumbnails.
   Fit page, Actual size and the layouts themselves are in the core (fitScale, layoutPages, goPage).

   docMarks(): { id, type: 'file', fid, name, mime, size, desc, rel, at } — a file attached here, written into the PDF's
   attached files when it is saved; { type: 'attedit', key, name, desc, rel, removed } — a change to a file the PDF
   came with (renamed, described, given an AFRelationship, removed). The bytes of files attached here are kept on this
   device (IndexedDB 'cowdrey.pdf.files', by fid), not in the marks, so undo and Recent stay small. */

/* ---- Hand tool: drag to move around the document; Space held down does the same in any tool ---- */
TOOL_HINTS.hand = 'Drag to move around the page';
// (not without a mouse or trackpad: a finger pans already)
cmd('tool_hand', { label: 'Hand', icon: 'hand', key: 'h', enabled: has, get hidden() { return !matchMedia('(any-pointer: fine)').matches; }, pressed: () => app.dataset.tool === 'hand', run: () => setTool('hand') });
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
  Object.assign(b, { type: 'button', title: 'Attachments', innerHTML: `${ic('paperclip')}<span>Attachments</span>` });
  b.setAttribute('role', 'tab'); b.dataset.side = 'files'; b.setAttribute('aria-selected', 'false'); b.setAttribute('aria-controls', 'sidePanel');
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
// The files in the opened PDF: its attached files (the EmbeddedFiles name tree; `key` is the tree's name for each)
// and file attachment comments.
let vwAttCache = null; // { doc, list: [{ key?, name, desc, bytes, entry? }] }
async function vwFilesIn(d) {
  if (vwAttCache && vwAttCache.doc === d) return vwAttCache.list;
  const list = [], pd = pdfDocs.get(0);
  try {
    const att = await pd.getAttachments(); // a Map (pdf.js 6) or an object; the bytes are asked for one by one
    for (const [key, f] of att instanceof Map ? att : Object.entries(att || {})) {
      list.push({ key, name: f.filename || key, desc: f.description || '', bytes: f.content || await pd.getAttachmentContent(key).catch(() => null) });
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
// Changes to the files the PDF came with: docMarks() { type: 'attedit', key, name?, desc?, rel?, removed? } (one per file).
const VW_RELS = [['', 'Not set'], ['Source', 'Source'], ['Data', 'Data'], ['Alternative', 'Alternative'], ['Supplement', 'Supplement'], ['Unspecified', 'Unspecified']];
const vwEdits = () => (doc ? docMarks().filter((m) => m.type === 'attedit') : []);
const vwEditOf = (key) => vwEdits().find((m) => m.key === key);
const vwRelLabel = (rel) => (rel ? `Relationship: ${rel}` : '');
// What a file the PDF came with is called and says now (its edits applied), its relationship as stored in the PDF.
let vwRelCache = null; // { doc, map: key -> AFRelationship }
async function vwRelsIn(d) {
  if (vwRelCache && vwRelCache.doc === d) return vwRelCache.map;
  const map = new Map();
  try {
    const L = await loadPdfLib(), pdf = await picSrcDoc(0);
    for (const it of vwTreeList(L, pdf.context, pdf.catalog)) { const s = pdf.context.lookup(it.raw), r = s instanceof L.PDFDict ? s.lookup(L.PDFName.of('AFRelationship')) : null; if (r) map.set(it.key, String(r).slice(1)); }
  } catch (e) { console.warn(e); }
  vwRelCache = { doc: d, map };
  return map;
}
async function vwEditDlg(title, cur) {
  const body = `<label class="field"><span>Name</span><input id="vwAttName" type="text" value="${esc(cur.name)}" autocomplete="off"></label>
    <label class="field"><span>Description</span><input id="vwAttDesc" type="text" value="${esc(cur.desc || '')}" autocomplete="off"></label>
    <label class="field"><span>Relationship to this PDF</span><select id="vwAttRel">${VW_RELS.map(([k, l]) => `<option value="${k}"${(cur.rel || '') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <p class="vw-note">The relationship says what the file is to the PDF (for e-invoices and PDF/A-3: Source for the file it was made from, Data for the invoice data). It is listed with the PDF's associated files.</p>`;
  let got = null;
  const a = await dialog(title, body, [{ label: 'Cancel' }, { label: 'Save', primary: true, value: 'ok' }], (dlg) => {
    const read = () => { got = { name: $('#vwAttName', dlg).value.trim(), desc: $('#vwAttDesc', dlg).value.trim(), rel: $('#vwAttRel', dlg).value }; };
    dlg.addEventListener('input', read); dlg.addEventListener('change', read); read();
  });
  if (a !== 'ok' || !got) return null;
  if (!got.name) got.name = cur.name;
  return got;
}
async function vwFilesPanel() {
  const panel = $('#sidePanel');
  if (!doc) { panel.innerHTML = '<p class="empty-note">Open a PDF to see its attached files.</p>'; return; }
  const d = doc;
  if (!vwAttCache || vwAttCache.doc !== d) panel.innerHTML = '<p class="empty-note">Looking for attached files…</p>';
  const inPdf = await vwFilesIn(d), rels = await vwRelsIn(d);
  if (doc !== d || S.side !== 'files') return;
  const rows = [];
  inPdf.forEach((f, k) => {
    let where = '';
    if (f.entry) { const n = doc.pages.findIndex((e) => e.src === 0 && e.i === f.entry.i); if (n < 0) return; where = `On page ${vwLabel(n) || n + 1}`; }
    const ed = f.key != null ? vwEditOf(f.key) : null;
    if (ed && ed.removed) return;
    const name = (ed && ed.name) || f.name, desc = ed && ed.desc != null ? ed.desc : f.desc, rel = ed && ed.rel != null ? ed.rel : rels.get(f.key) || '';
    rows.push({ key: 'p' + k, name, meta: [vwSize(f.bytes ? f.bytes.length : 0), where, desc, vwRelLabel(rel)].filter(Boolean).join(' · '), get: async () => f.bytes, orig: f.key != null ? { key: f.key, name, desc, rel } : null });
  });
  for (const m of vwAdded()) rows.push({ key: 'a' + m.id, name: m.name, meta: [`${vwSize(m.size)} · Added, kept when you save`, m.desc, vwRelLabel(m.rel)].filter(Boolean).join(' · '), get: () => vwFileBytes(m.fid), mark: m });
  // files attached to pages here (Attach file on the Comment tab)
  doc.pages.forEach((e, n) => { for (const m of marksOf(e)) if (m.type === 'mdFile') rows.push({ key: 'c' + m.id, name: m.name, meta: [vwSize(m.size), `On page ${vwLabel(n) || n + 1}, added`, m.desc].filter(Boolean).join(' · '), get: () => vwFileBytes(m.fid), page: m }); });
  panel.innerHTML = `${rows.length ? `<ul class="vw-files" aria-label="Attachments">${rows.map((r) => `<li class="vw-file">${ic('paperclip')}<span class="vw-fname" title="${esc(r.name)}">${esc(r.name)}<span class="m">${esc(r.meta)}</span></span>`
    + `<button type="button" class="btn vw-fsave" data-save="${esc(r.key)}" aria-label="Save ${esc(r.name)}">Save</button>`
    + (r.mark || r.orig ? `<button type="button" class="icon-btn" data-edit="${esc(r.key)}" title="Rename or describe" aria-label="Edit ${esc(r.name)}">${ic('pencil')}</button>` : '')
    + (r.mark || r.orig ? `<button type="button" class="icon-btn" data-remove="${esc(r.key)}" title="Remove" aria-label="Remove ${esc(r.name)}">${ic('x')}</button>` : '') + '</li>').join('')}</ul>`
    : '<p class="empty-note">This PDF has no attached files.</p>'}
    <button type="button" class="btn vw-fadd" data-cmd="vw_attach">${ic('paperclip')}<span>Attach file…</span></button>`;
  icons();
  const rowOf = (b, k) => rows.find((x) => x.key === b.dataset[k]);
  $$('[data-save]', panel).forEach((b) => { b.onclick = async () => {
    const r = rowOf(b, 'save'), bytes = r && await r.get();
    if (!bytes) { toast('That file is no longer on this device. Attach it again.'); return; }
    await saveFile(bytes, r.name, ((r.mark || r.page) && (r.mark || r.page).mime) || 'application/octet-stream');
  }; });
  $$('[data-edit]', panel).forEach((b) => { b.onclick = async () => {
    const r = rowOf(b, 'edit'); if (!r) return;
    const cur = r.mark ? { name: r.mark.name, desc: r.mark.desc || '', rel: r.mark.rel || '' } : r.orig;
    const got = await vwEditDlg(`Edit ${r.name}`, cur); if (!got) return;
    const taken = new Set(rows.filter((x) => x !== r && !x.page && !(x.meta || '').startsWith('On page')).map((x) => x.name));
    if (got.name !== cur.name && taken.has(got.name)) { toast(`There is already a file called ${got.name}.`); return; }
    const before = snapshot();
    if (r.mark) Object.assign(r.mark, got);
    else { let ed = vwEditOf(r.orig.key); if (!ed) docMarks().push(ed = { id: uid(), type: 'attedit', key: r.orig.key }); Object.assign(ed, got); }
    changed(before, 'Attachment'); renderSide();
  }; });
  $$('[data-remove]', panel).forEach((b) => { b.onclick = () => {
    const r = rowOf(b, 'remove'); if (!r) return;
    const before = snapshot(), list = docMarks();
    if (r.mark) { const k = list.indexOf(r.mark); if (k < 0) return; list.splice(k, 1); }
    else { let ed = vwEditOf(r.orig.key); if (!ed) list.push(ed = { id: uid(), type: 'attedit', key: r.orig.key }); ed.removed = true; }
    changed(before, 'Remove attachment');
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
  const taken = new Set([...(await vwFilesIn(doc)).filter((f) => !f.entry && !(vwEditOf(f.key) || {}).removed).map((f) => (vwEditOf(f.key) || {}).name || f.name), ...vwAdded().map((m) => m.name)]);
  const before = snapshot(); let n = 0;
  for (const f of files) {
    if (f.size > 100 * 1024 * 1024) { toast(`${f.name} is too big to attach (over 100 MB).`); continue; }
    const bytes = new Uint8Array(await f.arrayBuffer()), fid = uid();
    // A name already used gets a number, so each file keeps its own entry in the PDF.
    const name = vwFreeName(f.name || 'Attachment', taken);
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
// "Name.txt", or "Name (2).txt" … when that is taken.
function vwFreeName(name, taken) {
  const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  let out = name, k = 2; while (taken.has(out)) out = `${stem} (${k++})${ext}`;
  return out;
}
TEST_HOOKS.attachFiles = (files) => vwAttach(files);
cmd('vw_attach', { label: 'Attach file…', rlabel: 'Attach file', icon: 'paperclip', enabled: has, run: () => vwFileInput.click(), menu: ['vw_attach', 'vw_files'] }); // its arrow: the Attachments panel
cmd('vw_files', { label: 'Attachments', icon: 'paperclip', enabled: has, pressed: () => S.side === 'files' && (isPhone() ? app.dataset.sidebar === 'open' : S.sidebar), run: () => { setSide('files'); if (isPhone() || !S.sidebar) toggleSidebar(true); } });
const VW_AFR = new Set(['Source', 'Data', 'Alternative', 'Supplement', 'Unspecified']);
FEATURE.saveDoc.push(async ({ out }) => {
  for (const m of vwAdded()) {
    const bytes = await vwFileBytes(m.fid);
    if (!bytes) { console.warn('attachment missing on this device', m.name); continue; }
    await out.attach(bytes, m.name, { mimeType: m.mime, description: m.desc || undefined, creationDate: new Date(m.at), modificationDate: new Date(m.at), ...(VW_AFR.has(m.rel) ? { afRelationship: m.rel } : {}) });
  }
});
// The attached files' name tree, flattened: [{ key, raw }] (raw: the file specification, usually a reference).
function vwTreeList(L, c, catalog) {
  const { PDFName, PDFDict, PDFArray, PDFRef, PDFString, PDFHexString } = L, N = (k) => PDFName.of(k), look = (o) => (o instanceof PDFRef ? c.lookup(o) : o), out = [];
  const names = look(catalog.get(N('Names'))), tree = names instanceof PDFDict ? look(names.get(N('EmbeddedFiles'))) : null;
  const walk = (node, seen) => {
    if (!(node instanceof PDFDict) || seen.has(node)) return; seen.add(node);
    const arr = look(node.get(N('Names')));
    if (arr instanceof PDFArray) for (let k = 0; k + 1 < arr.size(); k += 2) { const key = look(arr.get(k)); if (key instanceof PDFString || key instanceof PDFHexString) out.push({ key: key.decodeText(), raw: arr.get(k + 1) }); }
    const kids = look(node.get(N('Kids'))); if (kids instanceof PDFArray) for (const r of kids.asArray()) walk(look(r), seen);
  };
  walk(tree, new Set());
  return out;
}
// The source the saved PDF is built on (as buildPdf chooses it), or -1 for a new PDF (pages extracted).
function vwBaseOf(entries) {
  if (entries !== doc.pages || !entries.length) return -1;
  const s0 = entries[0].src, pd = pdfDocs.get(s0);
  if (pd && entries.length === pd.numPages && entries.every((e, n) => e.src === s0 && e.i === n)) return s0;
  const count = new Map(); for (const e of entries) count.set(e.src, (count.get(e.src) || 0) + 1);
  return count.has(0) ? 0 : [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}
// Files the PDF came with, as changed here (renamed, described, given a relationship, removed), and the files of every
// other PDF combined into it (copied in, a name already used getting " (2)"). The relationship goes in the catalog's
// associated files (/AF) too, as PDF/A-3 and e-invoices want.
async function vwSaveTree({ L, out, entries }) {
  const { PDFName, PDFDict, PDFArray, PDFRef, PDFString, PDFHexString, PDFObjectCopier } = L, N = (k) => PDFName.of(k), c = out.context;
  const base = vwBaseOf(entries), edits = vwEdits();
  const others = base < 0 ? [] : [...new Set(entries.map((e) => e.src))].filter((k) => k !== base);
  if (!(edits.length && base === 0) && !others.length) return;
  const look = (o) => (o instanceof PDFRef ? c.lookup(o) : o), cat = out.catalog;
  const list = vwTreeList(L, c, cat), dropped = new Set();
  const setName = (spec, name) => { spec.set(N('UF'), PDFHexString.fromText(name)); spec.set(N('F'), PDFString.of(name.replace(/[^\x20-\x7E]/g, '_'))); };
  const applyEdit = (it, key) => {
    const ed = edits.find((m) => m.key === key); if (!ed) return;
    if (ed.removed) { it.gone = true; return; }
    const spec = look(it.raw); if (!(spec instanceof PDFDict)) return;
    if (ed.name && ed.name !== key) { setName(spec, ed.name); it.key = ed.name; }
    if (ed.desc != null) { if (ed.desc) spec.set(N('Desc'), PDFHexString.fromText(ed.desc)); else spec.delete(N('Desc')); }
    if (ed.rel != null) { if (ed.rel) spec.set(N('AFRelationship'), N(ed.rel)); else spec.delete(N('AFRelationship')); }
  };
  if (base === 0) for (const it of list) applyEdit(it, it.key);
  const taken = new Set(list.filter((it) => !it.gone).map((it) => it.key));
  for (const k of others) {
    let d; try { d = await picSrcDoc(k); } catch { d = null; } if (!d) continue;
    const src = vwTreeList(L, d.context, d.catalog); if (!src.length) continue;
    const copier = PDFObjectCopier.for(d.context, c);
    for (const s of src) {
      const o = d.context.lookup(s.raw); if (!(o instanceof PDFDict)) continue;
      const it = { key: s.key, raw: c.register(copier.copy(o)) };
      if (k === 0) applyEdit(it, s.key);
      if (it.gone) continue;
      const free = vwFreeName(it.key, taken);
      if (free !== it.key) { setName(look(it.raw), free); it.key = free; }
      taken.add(it.key); list.push(it);
    }
  }
  for (const it of list) if (it.gone && it.raw instanceof PDFRef) dropped.add(it.raw.tag);
  const keep = list.filter((it) => !it.gone).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let names = look(cat.get(N('Names')));
  if (!(names instanceof PDFDict)) { names = c.obj({}); cat.set(N('Names'), names); }
  const arr = c.obj([]); for (const it of keep) { arr.push(PDFHexString.fromText(it.key)); arr.push(it.raw); }
  if (keep.length) names.set(N('EmbeddedFiles'), c.obj({ Names: arr })); else names.delete(N('EmbeddedFiles'));
  // Associated files: those removed leave it; those with a relationship are in it.
  let af = look(cat.get(N('AF')));
  if (af instanceof PDFArray) for (let k = af.size() - 1; k >= 0; k--) { const r = af.get(k); if (r instanceof PDFRef && dropped.has(r.tag)) af.remove(k); }
  for (const it of keep) {
    const spec = look(it.raw); if (!(spec instanceof PDFDict) || !spec.get(N('AFRelationship'))) continue;
    if (!(it.raw instanceof PDFRef)) { const r = c.register(spec); arr.set(keep.indexOf(it) * 2 + 1, r); it.raw = r; }
    if (!(af instanceof PDFArray)) { af = c.obj([]); cat.set(N('AF'), af); }
    if (!af.asArray().some((r) => r instanceof PDFRef && r.tag === it.raw.tag)) af.push(it.raw);
  }
  if (af instanceof PDFArray && !af.size()) cat.delete(N('AF'));
}
FEATURE.saveDoc.push(async (a) => { try { await vwSaveTree(a); } catch (e) { console.warn('attachments: the files of the PDF', e); } });
// Files kept for documents no longer in Recent are let go, once, a little after start.
setTimeout(async () => {
  try {
    const fidsOf = (marks) => Object.values(marks || {}).flat().filter((m) => m && m.fid).map((m) => m.fid);
    const docs = await listDocs(), keep = new Set(docs.flatMap((d) => fidsOf(d.marks)));
    if (doc) for (const f of fidsOf(doc.marks)) keep.add(f);
    const ids = await vwDbDo('readonly', (s) => s.getAllKeys());
    const gone = (ids || []).filter((id) => !keep.has(id));
    if (gone.length) await vwDbDo('readwrite', (s) => { for (const id of gone) s.delete(id); });
  } catch {}
}, 5000);

/* ---- where it all goes ---- */
{ // View menu: after the zoom, the Hand tool, the layouts and Attachments
  const vm = MENUS.find(([t]) => t === 'View')[1], k = vm.indexOf('zoom100');
  vm.splice(k < 0 ? vm.length : k + 1, 0, '-', 'tool_hand', '-', ...VW_LAYOUTS, '-', 'vw_files');
  const em = MENUS.find(([t]) => t === 'Edit')[1], j = em.indexOf('image'); // Edit: after Add picture
  em.splice(j < 0 ? em.length : j + 1, 0, 'vw_attach');
}
ribbonAdd('edit', 'Add', ['vw_attach']); // as in the Edit menu, after Picture; its arrow lists Attachments too
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
.vw-note { font-size: 12px; color: var(--ink-2); }
`);
