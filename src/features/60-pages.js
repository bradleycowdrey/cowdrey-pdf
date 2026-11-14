/* ---------------- page tools (src/features/60-pages.js) ----------------
   Like PDFelement's Page tab: split into several files, insert or replace pages from another PDF, crop, reverse,
   rotate a range, and choose several pages in the sidebar (Shift- or Cmd/Ctrl-click) so Rotate, Delete, Extract,
   Duplicate and Move work on all of them.
   A crop is kept on the page entry (entry.crop = [x1, y1, x2, y2] in PDF points, the page's own coordinates), so it
   follows the page when pages move, is undone with the rest, and is saved as the page's CropBox and TrimBox. */

const PG60_MM = 72 / 25.4;
let pg60Sel = new Set();   // chosen pages (indexes in doc.pages) in the sidebar
let pg60Anchor = null;     // where a Shift-click range starts
let pg60Drag = null;       // the box being dragged with the Crop tool: { v, x1, y1, x2, y2 }

// The pages a page command works on: the pages chosen in the sidebar when there are several, else the page in view.
const pg60Valid = () => [...pg60Sel].filter((n) => doc && n >= 0 && n < doc.pages.length).sort((a, b) => a - b);
const pg60Many = () => pg60Valid().length > 1;
const pg60Targets = () => (pg60Many() ? pg60Valid() : [current]);
// [0, 1, 2, 4] -> "1-3, 5"
function pg60RangeText(list) {
  const s = [...list].sort((a, b) => a - b), out = [];
  for (let k = 0; k < s.length; k++) {
    let j = k; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > k ? `${s[k] + 1}-${s[j] + 1}` : `${s[k] + 1}`); k = j;
  }
  return out.join(', ');
}
const pg60Plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function pg60SetSel(list) { pg60Sel = new Set(list); pg60Paint(); refreshRibbon(); }

/* ---- dialogs: the fields' values are kept as they change, so they can be read once the dialog closes ---- */
function pg60Ask(title, body, actions, setup) {
  const vals = {};
  const p = dialog(title, `<div class="pg60-dlg">${body}</div>`, actions, (dlg) => {
    const collect = () => { for (const el of $$('[name]', dlg)) { if (el.type === 'radio') { if (el.checked) vals[el.name] = el.value; } else vals[el.name] = el.value; } };
    collect(); dlg.oninput = collect; dlg.onchange = collect;
    // Typing in a field chooses the option it belongs to.
    for (const el of $$('[data-pick]', dlg)) el.addEventListener('focus', () => { const r = $(`input[type=radio][value="${el.dataset.pick}"]`, dlg); if (r) { r.checked = true; collect(); } });
    if (setup) setup(dlg, vals);
  });
  return p.then((a) => (a == null ? null : { action: a, vals }));
}
const pg60Opt = (name, value, label, checked, extra = '') => `<label class="pg60-opt"><input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''}><span>${label}</span>${extra}</label>`;

/* ---- choosing another PDF ---- */
const pg60Input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/pdf,.pdf', hidden: true, id: 'pg60File' });
document.body.appendChild(pg60Input);
// Resolves with { bytes, name } or null.
function pg60PickPdf() {
  return new Promise((res) => {
    pg60Input.value = '';
    pg60Input.onchange = async () => { const f = pg60Input.files[0]; pg60Input.onchange = null; res(f ? { bytes: new Uint8Array(await f.arrayBuffer()), name: f.name } : null); };
    pg60Input.click();
  });
}
async function pg60LoadOther() {
  const f = await pg60PickPdf(); if (!f) return null;
  let pd;
  try { pd = await loadProtected(f.bytes, f.name); } catch (e) { console.error(e); toast(`Could not open ${f.name}: it may not be a PDF.`); return null; }
  if (!pd) return null;
  return { ...f, pd, count: pd.numPages };
}
// Adds another PDF as a source and changes doc.pages with it, as one step to undo.
function pg60WithSource(other, fn) {
  const k = doc.sources.length;
  pageOp(() => { doc.sources.push(other.bytes); pdfDocs.set(k, other.pd); fn(k); });
}

/* ---- insert from another PDF ---- */
async function pg60Insert() {
  const other = await pg60LoadOther(); if (!other) return;
  const here = current + 1;
  const r = await pg60Ask(`Insert pages from ${other.name.replace(/\.pdf$/i, '')}`, `
    <p>That PDF has ${pg60Plural(other.count, 'page')}.</p>
    <label class="field"><span>Pages to insert</span><input name="pages" value="1-${other.count}" autocomplete="off"></label>
    <div class="pg60-label">Where</div>
    ${pg60Opt('where', 'before', `Before this page (${here})`)}
    ${pg60Opt('where', 'after', `After this page (${here})`, true)}
    ${pg60Opt('where', 'start', 'At the start')}
    ${pg60Opt('where', 'end', 'At the end')}
    ${pg60Opt('where', 'at', 'Before page', false, `<input class="pg60-num" name="at" type="number" min="1" max="${doc.pages.length + 1}" value="${here}" data-pick="at">`)}`,
  [{ label: 'Cancel' }, { label: 'Insert', value: 'ok', primary: true }]);
  if (!r) { try { other.pd.destroy(); } catch {} return; }
  const idx = parseRange(r.vals.pages || '', other.count);
  if (!idx.length) { toast('No pages in that range'); try { other.pd.destroy(); } catch {} return; }
  const len = doc.pages.length;
  const at = { before: current, after: current + 1, start: 0, end: len, at: Math.max(0, Math.min(len, (parseInt(r.vals.at, 10) || 1) - 1)) }[r.vals.where] ?? current + 1;
  pg60WithSource(other, (k) => { doc.pages.splice(at, 0, ...idx.map((i) => ({ src: k, i, rot: 0 }))); current = at; });
  pg60SetSel([]);
  toast(`Inserted ${pg60Plural(idx.length, 'page')}`);
}

/* ---- combine: this PDF and others, in an order you set ---- */
const pg60Multi = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/pdf,.pdf', multiple: true, hidden: true, id: 'pg60Files' });
document.body.appendChild(pg60Multi);
// Resolves with [{ bytes, name }] (empty when nothing was chosen).
function pg60PickPdfs() {
  return new Promise((res) => {
    pg60Multi.value = '';
    pg60Multi.oncancel = () => res([]);
    pg60Multi.onchange = async () => { const fs = [...pg60Multi.files]; pg60Multi.onchange = null; res(await Promise.all(fs.map(async (f) => ({ bytes: new Uint8Array(await f.arrayBuffer()), name: f.name })))); };
    pg60Multi.click();
  });
}
async function pg60LoadMany(files) {
  const out = [];
  for (const f of files) {
    let pd;
    try { pd = await loadProtected(f.bytes, f.name); } catch (e) { console.error(e); toast(`Could not open ${f.name}: it may not be a PDF.`); continue; }
    if (pd) out.push({ ...f, pd, count: pd.numPages });
  }
  return out;
}
// The list in the Combine dialog: each file with its page count, moved up or down or taken out.
function pg60FilesHtml(rows) {
  const name = (r) => esc(r.cur ? `${r.name} (open now)` : r.name.replace(/\.pdf$/i, ''));
  return rows.map((r, k) => `<li class="pg60-file" data-k="${k}">${ic(r.cur ? 'file-pen' : 'file')}<span class="pg60-fname">${name(r)}</span><span class="pg60-fcount">${pg60Plural(r.count, 'page')}</span>
    <button type="button" class="icon-btn" data-mv="-1" aria-label="Move ${name(r)} up"${k ? '' : ' disabled'}>${ic('arrow-up')}</button>
    <button type="button" class="icon-btn" data-mv="1" aria-label="Move ${name(r)} down"${k < rows.length - 1 ? '' : ' disabled'}>${ic('arrow-down')}</button>
    ${r.cur ? '<span class="pg60-fgap"></span>' : `<button type="button" class="icon-btn" data-rm aria-label="Remove ${name(r)}">${ic('x')}</button>`}</li>`).join('');
}
async function pg60Combine() {
  const rows = doc ? [{ cur: true, name: doc.name, count: doc.pages.length }] : [];
  const drop = () => { for (const r of rows) if (r.pd) { try { r.pd.destroy(); } catch {} } };
  let pick = true;
  for (;;) {
    if (pick) { rows.push(...await pg60LoadMany(await pg60PickPdfs())); pick = false; }
    if (!rows.some((r) => !r.cur)) { drop(); return; }
    const r = await pg60Ask('Combine PDFs', `
      <p>The files are joined in this order. Move them up or down, or take one out.</p>
      <ol class="pg60-files"></ol>
      <p class="pg60-note pg60-total"></p>`,
    [{ label: 'Cancel' }, { label: 'Add files…', value: 'add' }, { label: 'Combine', value: 'ok', primary: true }], (dlg) => {
      const list = $('.pg60-files', dlg), btn = $('.dlg-foot .btn.primary', dlg);
      const draw = (focus) => {
        list.innerHTML = pg60FilesHtml(rows); icons();
        const total = rows.reduce((t, x) => t + x.count, 0);
        $('.pg60-total', dlg).textContent = `${pg60Plural(rows.length, 'file')}, ${pg60Plural(total, 'page')} in all.`;
        btn.disabled = !rows.some((x) => !x.cur);
        if (focus) { const b = $(`[data-k="${focus[0]}"] ${focus[1]}`, list); (b && !b.disabled ? b : btn).focus(); }
      };
      list.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        const k = +b.closest('[data-k]').dataset.k;
        if (b.hasAttribute('data-rm')) { const [x] = rows.splice(k, 1); if (x.pd) { try { x.pd.destroy(); } catch {} } draw([Math.min(k, rows.length - 1), '[data-rm]']); return; }
        const t = k + +b.dataset.mv; if (t < 0 || t >= rows.length) return;
        [rows[k], rows[t]] = [rows[t], rows[k]]; draw([t, `[data-mv="${b.dataset.mv}"]`]);
      });
      draw();
    });
    if (!r) { drop(); return; }
    if (r.action === 'add') { pick = true; continue; }
    break;
  }
  let pages = 0;
  if (doc) {
    pageOp(() => {
      const mine = doc.pages, out = [];
      for (const x of rows) {
        if (x.cur) { out.push(...mine); continue; }
        const k = doc.sources.length; doc.sources.push(x.bytes); pdfDocs.set(k, x.pd);
        out.push(...[...Array(x.count).keys()].map((i) => ({ src: k, i, rot: 0 })));
      }
      doc.pages = out; current = 0;
    });
    pages = doc.pages.length;
  } else {
    const [first, ...rest] = rows;
    try { first.pd.destroy(); } catch {}
    if (!(await serial(() => openBytes(first.bytes, first.name)))) { for (const x of rest) { try { x.pd.destroy(); } catch {} } return; }
    if (rest.length) pageOp(() => { for (const x of rest) { const k = doc.sources.length; doc.sources.push(x.bytes); pdfDocs.set(k, x.pd); doc.pages.push(...[...Array(x.count).keys()].map((i) => ({ src: k, i, rot: 0 }))); } });
    pages = doc.pages.length;
  }
  pg60SetSel([]);
  toast(`Combined ${pg60Plural(rows.length, 'file')} into ${pg60Plural(pages, 'page')}`);
}

/* ---- replace pages with pages from another PDF ---- */
async function pg60Replace() {
  const other = await pg60LoadOther(); if (!other) return;
  const mine = pg60Targets();
  const r = await pg60Ask('Replace pages', `
    <label class="field"><span>Pages to replace in this PDF (it has ${doc.pages.length})</span><input name="mine" value="${esc(pg60RangeText(mine))}" autocomplete="off"></label>
    <label class="field"><span>With these pages from ${esc(other.name.replace(/\.pdf$/i, ''))} (it has ${other.count})</span><input name="theirs" value="${esc(pg60RangeText([...Array(Math.min(other.count, mine.length)).keys()]))}" autocomplete="off"></label>`,
  [{ label: 'Cancel' }, { label: 'Replace', value: 'ok', primary: true }]);
  if (!r) { try { other.pd.destroy(); } catch {} return; }
  const out = parseRange(r.vals.mine || '', doc.pages.length), inn = parseRange(r.vals.theirs || '', other.count);
  if (!out.length || !inn.length) { toast('No pages in that range'); try { other.pd.destroy(); } catch {} return; }
  const at = Math.min(...out), gone = new Set(out);
  pg60WithSource(other, (k) => {
    doc.pages = doc.pages.filter((_, n) => !gone.has(n));
    doc.pages.splice(at, 0, ...inn.map((i) => ({ src: k, i, rot: 0 })));
    current = at;
  });
  pg60SetSel([]);
  toast(`Replaced ${pg60Plural(out.length, 'page')}`);
}

/* ---- split into several files ---- */
async function pg60Split() {
  const total = doc.pages.length;
  const r = await pg60Ask('Split into files', `
    <p>Each part is saved as its own PDF. This PDF has ${pg60Plural(total, 'page')}.</p>
    ${pg60Opt('how', 'every', 'Every', true, `<input class="pg60-num" name="every" type="number" min="1" max="${total}" value="${Math.max(1, Math.ceil(total / 2))}" data-pick="every"><span>pages</span>`)}
    ${pg60Opt('how', 'ranges', 'By ranges', false, `<input class="pg60-wide" name="ranges" placeholder="1-3, 4-9" value="" data-pick="ranges" autocomplete="off">`)}
    ${pg60Opt('how', 'each', 'One file per page')}`,
  [{ label: 'Cancel' }, { label: 'Split', value: 'ok', primary: true }]);
  if (!r) return;
  const parts = pg60SplitParts(r.vals, total);
  if (!parts.length) { toast('No pages in those ranges'); return; }
  let saved = 0;
  try {
    for (let k = 0; k < parts.length; k++) {
      const bytes = await buildPdf(parts[k]);
      if (!bytes) return;
      const ok = await saveFile(bytes, `${doc.name} (part ${k + 1}).pdf`, 'application/pdf');
      if (!ok) break;
      saved++;
      if (!NATIVE) await new Promise((res) => setTimeout(res, 150)); // browsers drop downloads started all at once
    }
  } catch (e) { console.error(e); toast(`Could not split the PDF: ${e.message || e}`); return; }
  if (saved) toast(saved === 1 ? 'Saved 1 part' : `Split into ${saved} files`);
}
function pg60SplitParts(vals, total) {
  const all = [...Array(total).keys()];
  if (vals.how === 'each') return all.map((n) => [n]);
  if (vals.how === 'ranges') return String(vals.ranges || '').split(/[,;]/).map((s) => parseRange(s, total)).filter((x) => x.length);
  const n = Math.max(1, parseInt(vals.every, 10) || 1), out = [];
  for (let k = 0; k < total; k += n) out.push(all.slice(k, k + n));
  return out;
}

/* ---- reverse, rotate a range ---- */
function pg60Reverse() {
  const t = pg60Many() ? pg60Valid() : [...doc.pages.keys()];
  pageOp(() => {
    const picked = t.map((n) => doc.pages[n]).reverse();
    t.forEach((n, k) => { doc.pages[n] = picked[k]; });
  });
  toast(t.length === doc.pages.length ? 'Page order reversed' : `Reversed ${pg60Plural(t.length, 'page')}`);
}
async function pg60RotateRange() {
  const t = pg60Many() ? pg60Valid() : [...doc.pages.keys()];
  const r = await pg60Ask('Rotate pages', `
    <label class="field"><span>Pages (this PDF has ${doc.pages.length})</span><input name="pages" value="${esc(pg60RangeText(t))}" autocomplete="off"></label>
    ${pg60Opt('dir', '90', 'Right (clockwise)', true)}
    ${pg60Opt('dir', '270', 'Left (anticlockwise)')}
    ${pg60Opt('dir', '180', 'Upside down')}`,
  [{ label: 'Cancel' }, { label: 'Rotate', value: 'ok', primary: true }]);
  if (!r) return;
  const idx = parseRange(r.vals.pages || '', doc.pages.length);
  if (!idx.length) { toast('No pages in that range'); return; }
  pg60RotateMany(idx, +r.vals.dir || 90);
}
function pg60RotateMany(idx, d) {
  pageOp(() => idx.forEach((n) => { const e = doc.pages[n]; e.rot = (e.rot + d + 360) % 360; }));
  toast(`Rotated ${pg60Plural(idx.length, 'page')}`);
}

/* ---- several pages at once: the existing page commands work on every chosen page ---- */
function pg60DeleteMany(idx) {
  const gone = new Set(idx);
  pageOp(() => { doc.pages = doc.pages.filter((_, n) => !gone.has(n)); current = Math.max(0, Math.min(idx[0], doc.pages.length - 1)); });
  pg60SetSel([]);
  toast(`Deleted ${pg60Plural(idx.length, 'page')}`);
}
// Asks before deleting: which pages (a range, starting with idx), with the count on the button. Enter deletes.
async function pg60DeleteAsk(idx = pg60Targets()) {
  if (!has()) return;
  const N = doc.pages.length;
  const r = await pg60Ask('Delete pages', `
    <label class="field"><span>Pages (this PDF has ${N})</span><input name="pages" value="${esc(pg60RangeText(idx))}" autocomplete="off" placeholder="e.g. 2-4, 7"></label>
    <p class="pg60-note">You can undo this.</p>`,
  [{ label: 'Cancel' }, { label: `Delete ${pg60Plural(idx.length, 'page')}`, value: 'ok', primary: true }], (dlg, vals) => {
    const inp = $('input[name="pages"]', dlg), btn = $('.dlg-foot .btn.primary', dlg);
    const upd = () => { const k = parseRange(vals.pages || '', N).length; btn.textContent = k ? `Delete ${pg60Plural(k, 'page')}` : 'Delete'; btn.disabled = !k; };
    dlg.addEventListener('input', upd);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!btn.disabled) btn.click(); } });
    requestAnimationFrame(() => { inp.focus(); inp.select(); });
  });
  if (!r || r.action !== 'ok') return;
  const del = parseRange(r.vals.pages || '', N);
  if (!del.length) { toast('No pages in that range'); return; }
  pg60DeleteMany([...new Set(del)].sort((a, b) => a - b));
}
// Moves the chosen pages one place up (-1) or down (1), keeping them chosen.
function pg60MoveMany(idx, d) {
  const set = new Set(idx);
  pageOp(() => {
    const a = doc.pages.map((e, n) => ({ e, sel: set.has(n) }));
    const order = d < 0 ? [...a.keys()] : [...a.keys()].reverse();
    for (const k of order) { const t = k + d; if (a[k].sel && t >= 0 && t < a.length && !a[t].sel) [a[k], a[t]] = [a[t], a[k]]; }
    doc.pages = a.map((x) => x.e);
    pg60Sel = new Set(a.map((x, n) => (x.sel ? n : -1)).filter((n) => n >= 0));
    current = Math.min(...pg60Sel);
  });
}
// Moves the chosen pages so they stand together before page `to` (an index before the move).
function pg60MoveTo(idx, to) {
  const set = new Set(idx);
  pageOp(() => {
    const moving = idx.map((n) => doc.pages[n]);
    const before = doc.pages.slice(0, to).filter((_, n) => !set.has(n)), after = doc.pages.slice(to).filter((_, n) => !set.has(n + to));
    doc.pages = before.concat(moving, after);
    pg60Sel = new Set(moving.map((_, k) => before.length + k));
    current = before.length;
  });
}
function pg60DupMany(idx) {
  const set = new Set(idx);
  pageOp(() => { doc.pages = doc.pages.flatMap((e, n) => (set.has(n) ? [e, JSON.parse(JSON.stringify(e))] : [e])); });
  pg60SetSel([]);
  toast(`Duplicated ${pg60Plural(idx.length, 'page')}`);
}
async function pg60ExtractMany(idx) {
  try {
    const bytes = await buildPdf(idx);
    if (bytes) await saveFile(bytes, `${doc.name} (pages ${pg60RangeText(idx).replace(/\s+/g, '')}).pdf`, 'application/pdf');
  } catch (e) { console.error(e); toast(`Could not extract the pages: ${e.message || e}`); }
}
function pg60Wrap(id, multi, enabled) {
  const c = C[id]; if (!c) return;
  const run0 = c.run, en0 = c.enabled;
  c.run = () => (pg60Many() ? multi(pg60Valid()) : run0());
  if (enabled) c.enabled = () => (pg60Many() ? has() && enabled(pg60Valid()) : !en0 || en0());
}
pg60Wrap('rotL', (idx) => pg60RotateMany(idx, -90));
pg60Wrap('rotR', (idx) => pg60RotateMany(idx, 90));
pg60Wrap('delPage', (idx) => pg60DeleteAsk(idx)); // one page in view: at once (undo brings it back); several: asked
pg60Wrap('extract', pg60ExtractMany);
pg60Wrap('dup', pg60DupMany);
pg60Wrap('up', (idx) => pg60MoveMany(idx, -1), (idx) => idx.some((n, k) => n !== k));
pg60Wrap('down', (idx) => pg60MoveMany(idx, 1), (idx) => idx.some((n, k) => n !== doc.pages.length - idx.length + k));

/* ---- the Pages sidebar: Shift-click picks a run of pages, Cmd/Ctrl-click adds or removes one ---- */
const pg60Panel = $('#sidePanel');
pg60Panel.addEventListener('click', (e) => {
  if (e.target.closest('.pg60-selbar button')) { pg60SetSel([]); return; }
  const t = e.target.closest('.thumb'); if (!t || !doc) return;
  const n = +t.dataset.n, add = isMac ? e.metaKey : e.ctrlKey || e.metaKey;
  if (e.shiftKey || add) {
    e.stopPropagation(); e.preventDefault();
    const now = pg60Valid().length ? pg60Valid() : [current];
    if (e.shiftKey) {
      const a = pg60Anchor ?? current, lo = Math.min(a, n), hi = Math.max(a, n);
      pg60Sel = new Set([...(add ? now : []), ...Array.from({ length: hi - lo + 1 }, (_, k) => lo + k)]);
    } else {
      pg60Sel = new Set(now); pg60Sel.has(n) ? pg60Sel.delete(n) : pg60Sel.add(n); pg60Anchor = n;
    }
    pg60Paint(); refreshRibbon();
    return;
  }
  pg60Sel = new Set([n]); pg60Anchor = n; pg60Paint(); // the sidebar's own click goes to the page
}, true);
// Dragging one of several chosen pages moves them all.
pg60Panel.addEventListener('drop', (e) => {
  const t = e.target.closest('.thumb'); if (!t || !pg60Many()) return;
  const from = +e.dataTransfer.getData('text/plain'), idx = pg60Valid();
  if (!idx.includes(from)) return;
  e.stopPropagation(); e.preventDefault(); t.classList.remove('drag-over');
  let to = +t.dataset.n; if (to > from) to++; // dropped on a later page: put them after it
  pg60MoveTo(idx, to);
}, true);
// Delete or Backspace on a page in the sidebar asks to delete it (or the pages chosen there).
document.addEventListener('keydown', (e) => {
  if (!doc || $('#dialog').open || !(e.key === 'Delete' || e.key === 'Backspace')) return;
  const t = document.activeElement && document.activeElement.closest && document.activeElement.closest('#sidePanel .thumb');
  if (!t) return;
  if (selMark || selContent) return;
  e.preventDefault();
  pg60DeleteAsk(pg60Many() ? pg60Valid() : [+t.dataset.n]);
});
// Cmd/Ctrl+A on a page in the sidebar selects every page.
document.addEventListener('keydown', (e) => {
  if (!doc || $('#dialog').open || e.key.toLowerCase() !== 'a' || !(isMac ? e.metaKey : e.ctrlKey) || e.shiftKey || e.altKey) return;
  if (!(document.activeElement && document.activeElement.closest && document.activeElement.closest('#sidePanel .thumb'))) return;
  e.preventDefault(); run('pg60_selAll');
});
function pg60Paint() {
  const many = pg60Many(), sel = new Set(pg60Valid());
  for (const t of $$('.thumb', pg60Panel)) t.classList.toggle('pg60-sel', many && sel.has(+t.dataset.n));
  const list = $('.thumbs', pg60Panel); if (!list) return;
  let bar = $('.pg60-selbar', pg60Panel);
  if (!many) { if (bar) bar.remove(); return; }
  if (!bar) { bar = document.createElement('div'); bar.className = 'pg60-selbar'; list.parentNode.insertBefore(bar, list); }
  bar.innerHTML = `<span>${sel.size} pages selected</span><button type="button" class="btn link">Clear</button>`;
}
// Thumbnails show the crop too: clipped, and taking only the room of what is left.
async function pg60ThumbCrop(t) {
  const e = doc && doc.pages[+t.dataset.n], c = $('canvas', t); if (!e || !c) return;
  if (!e.crop || c.width < 2) { c.style.clipPath = c.style.margin = ''; return; }
  const page = await pageOf(e), vp = page.getViewport({ scale: 1, rotation: (page.rotate + e.rot) % 360 });
  const [l, tp, r, b] = pg60Insets(vp, e.crop), k = c.offsetWidth / vp.width;
  c.style.clipPath = `inset(${tp * k}px ${r * k}px ${b * k}px ${l * k}px)`;
  c.style.margin = `${-tp * k}px ${-r * k}px ${-b * k}px ${-l * k}px`;
}
new MutationObserver((recs) => {
  if (recs.some((r) => r.type === 'childList' && r.target === pg60Panel)) pg60Paint();
  const redo = new Set(recs.filter((r) => r.type === 'attributes').map((r) => r.target.closest('.thumb')).filter(Boolean));
  redo.forEach(pg60ThumbCrop);
}).observe(pg60Panel, { childList: true, subtree: true, attributes: true, attributeFilter: ['width', 'height'] });
FEATURE.onDocShown.push(() => { pg60Sel = new Set(); pg60Anchor = null; });

/* ---- crop ---- */
// The margins (left, top, right, bottom) a crop box leaves on a page as shown, in the viewport's units.
function pg60Insets(vp, crop) {
  const r = [...vp.convertToViewportPoint(crop[0], crop[1]), ...vp.convertToViewportPoint(crop[2], crop[3])];
  const x1 = Math.min(r[0], r[2]), x2 = Math.max(r[0], r[2]), y1 = Math.min(r[1], r[3]), y2 = Math.max(r[1], r[3]);
  return [Math.max(0, x1), Math.max(0, y1), Math.max(0, vp.width - x2), Math.max(0, vp.height - y2)];
}
// On screen a cropped page is clipped to its crop box and takes only that much room.
function pg60ApplyCrop(v) {
  const c = v.entry.crop, el = v.el;
  if (!c || app.dataset.tool === 'crop') { el.style.clipPath = el.style.margin = el.style.transform = ''; el.classList.remove('pg60-cropped'); }
  else {
    const [l, t, r, b] = pg60Insets(v.viewport, c);
    // Moved up with a transform rather than a margin, so the page's offsetTop (going to a page, the page in view)
    // is where its visible part starts.
    el.style.clipPath = `inset(${t}px ${r}px ${b}px ${l}px)`; el.style.margin = `0 ${-r}px ${-(t + b)}px ${-l}px`;
    el.style.transform = t ? `translateY(${-t}px)` : '';
    el.classList.add('pg60-cropped');
  }
  pg60Overlay(v);
}
// With the Crop tool, each page is shown whole with what is cut off dimmed, and the box being dragged.
function pg60Overlay(v) {
  let svg = $('svg.pg60-ov', v.el);
  if (app.dataset.tool !== 'crop') { if (svg) svg.remove(); return; }
  if (!svg) { svg = svgEl('svg', { class: 'pg60-ov', 'aria-hidden': 'true' }); v.el.appendChild(svg); }
  const W = v.viewport.width, H = v.viewport.height;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = '';
  let box = null;
  if (pg60Drag && pg60Drag.v === v) box = [Math.min(pg60Drag.x1, pg60Drag.x2), Math.min(pg60Drag.y1, pg60Drag.y2), Math.max(pg60Drag.x1, pg60Drag.x2), Math.max(pg60Drag.y1, pg60Drag.y2)];
  else if (v.entry.crop) { const [l, t, r, b] = pg60Insets(v.viewport, v.entry.crop); box = [l, t, W - r, H - b]; }
  if (!box) return;
  svg.appendChild(svgEl('path', { d: `M0 0H${W}V${H}H0Z M${box[0]} ${box[1]}V${box[3]}H${box[2]}V${box[1]}Z`, 'fill-rule': 'evenodd', class: 'pg60-dim' }));
  svg.appendChild(svgEl('rect', { x: box[0], y: box[1], width: box[2] - box[0], height: box[3] - box[1], class: 'pg60-box' }));
}
function pg60ApplyAll() { for (const v of views) pg60ApplyCrop(v); }
// Every page is laid out again after page changes, zoom and undo: crop each one as it is added.
new MutationObserver((recs) => {
  for (const r of recs) for (const el of r.addedNodes) {
    if (!el.classList || !el.classList.contains('page')) continue;
    const v = views[+el.dataset.n]; if (v && v.el === el) pg60ApplyCrop(v);
  }
}).observe(pagesEl, { childList: true });
FEATURE.afterRender.push((v) => pg60Overlay(v));
let pg60Tool = app.dataset.tool;
new MutationObserver(() => { if (app.dataset.tool === pg60Tool) return; const was = pg60Tool; pg60Tool = app.dataset.tool; if (was === 'crop' || pg60Tool === 'crop') pg60ApplyAll(); }).observe(app, { attributes: true, attributeFilter: ['data-tool'] });

FEATURE.tools.crop = {
  down(e, v) {
    e.preventDefault();
    const [x, y] = localPoint(e, v), W = v.viewport.width, H = v.viewport.height;
    const clamp = (p) => [Math.max(0, Math.min(W, p[0])), Math.max(0, Math.min(H, p[1]))];
    pg60Drag = { v, x1: x, y1: y, x2: x, y2: y };
    const move = (ev) => { const [a, b] = clamp(localPoint(ev, v)); pg60Drag.x2 = a; pg60Drag.y2 = b; pg60Overlay(v); };
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      move(ev);
      const d = pg60Drag; pg60Drag = null;
      const x1 = Math.min(d.x1, d.x2), x2 = Math.max(d.x1, d.x2), y1 = Math.min(d.y1, d.y2), y2 = Math.max(d.y1, d.y2);
      if (x2 - x1 < 8 || y2 - y1 < 8) { pg60Overlay(v); return; }
      const n = views.indexOf(v);
      pg60CropDialog(n, [x1 / scale, y1 / scale, (W - x2) / scale, (H - y2) / scale]).then(() => pg60Overlay(v));
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  },
};
// margins: [left, top, right, bottom] in points, as the page is shown (rotation included).
async function pg60CropDialog(n = current, margins) {
  if (!doc || !doc.pages.length) return;
  const e = doc.pages[n];
  if (!margins) {
    margins = [0, 0, 0, 0];
    if (e.crop) { const page = await pageOf(e); margins = pg60Insets(page.getViewport({ scale: 1, rotation: (page.rotate + e.rot) % 360 }), e.crop); }
  }
  const mm = (pt) => (Math.round(pt / PG60_MM * 10) / 10).toString();
  const many = pg60Many();
  const r = await pg60Ask('Crop pages', `
    <p>How much to cut off each edge, in millimetres. Drag a box on the page with the Crop tool to set these by eye.</p>
    <div class="pg60-grid">
      <label class="field"><span>Top</span><input name="t" type="number" min="0" step="0.5" value="${mm(margins[1])}"></label>
      <label class="field"><span>Bottom</span><input name="b" type="number" min="0" step="0.5" value="${mm(margins[3])}"></label>
      <label class="field"><span>Left</span><input name="l" type="number" min="0" step="0.5" value="${mm(margins[0])}"></label>
      <label class="field"><span>Right</span><input name="r" type="number" min="0" step="0.5" value="${mm(margins[2])}"></label>
    </div>
    <div class="pg60-label">Crop</div>
    ${pg60Opt('to', 'this', `This page (${n + 1})`, !many)}
    ${many ? pg60Opt('to', 'chosen', `The selected pages (${esc(pg60RangeText(pg60Valid()))})`, true) : ''}
    ${pg60Opt('to', 'all', 'All pages')}
    ${pg60Opt('to', 'range', 'Pages', false, `<input class="pg60-wide" name="range" placeholder="1-3, 5" data-pick="range" autocomplete="off">`)}`,
  [{ label: 'Cancel' }, ...(doc.pages.some((x) => x.crop) ? [{ label: 'Remove crop', value: 'remove' }] : []), { label: 'Crop', value: 'ok', primary: true }]);
  if (!r) return;
  const v = r.vals;
  const idx = v.to === 'all' ? [...doc.pages.keys()] : v.to === 'chosen' ? pg60Valid() : v.to === 'range' ? parseRange(v.range || '', doc.pages.length) : [n];
  if (!idx.length) { toast('No pages in that range'); return; }
  const num = (k) => Math.max(0, parseFloat(String(v[k]).replace(',', '.')) || 0) * PG60_MM;
  const remove = r.action === 'remove';
  await pg60SetCrop(idx, remove ? null : [num('l'), num('t'), num('r'), num('b')]);
  if (app.dataset.tool === 'crop') setTool('select');
}
// Crops pages by margins (points, as each page is shown), or removes their crop (null). Returns how many changed.
async function pg60SetCrop(idx, margins) {
  const crops = [];
  for (const n of idx) {
    const e = doc.pages[n]; if (!e) continue;
    if (!margins || margins.every((m) => m < .01)) { crops.push([e, null]); continue; }
    const page = await pageOf(e), vp = page.getViewport({ scale: 1, rotation: (page.rotate + e.rot) % 360 });
    const [l, t, r, b] = margins;
    if (vp.width - l - r < 18 || vp.height - t - b < 18) continue; // nothing (or almost nothing) would be left
    const [ax, ay] = vp.convertToPdfPoint(l, t), [bx, by] = vp.convertToPdfPoint(vp.width - r, vp.height - b);
    const q = (x) => Math.round(x * 100) / 100;
    crops.push([e, [q(Math.min(ax, bx)), q(Math.min(ay, by)), q(Math.max(ax, bx)), q(Math.max(ay, by))]]);
  }
  if (!crops.length) { toast('Those margins leave nothing of the page'); return 0; }
  pageOp(() => { for (const [e, c] of crops) { if (c) e.crop = c; else delete e.crop; } });
  toast(!margins ? 'Crop removed' : `Cropped ${pg60Plural(crops.length, 'page')}`);
  return crops.length;
}
// Saved as the page's CropBox (what readers show) and TrimBox (the finished size for printing).
FEATURE.savePage.push(({ p, entry }) => {
  const c = entry.crop; if (!c) return;
  const [x1, y1, x2, y2] = c;
  p.setCropBox(x1, y1, x2 - x1, y2 - y1);
  p.setTrimBox(x1, y1, x2 - x1, y2 - y1);
});

/* ---- commands, ribbon, menu ---- */
cmd('tool_crop', { label: 'Crop', icon: 'crop', enabled: has, pressed: () => app.dataset.tool === 'crop', run: () => { if (app.dataset.tool === 'crop') return setTool('select'); setTool('crop'); toast('Drag a box on the page to keep just that part'); } });
cmd('pg60_crop', { label: 'Crop margins…', icon: 'scan', enabled: has, run: () => pg60CropDialog() });
cmd('pg60_split', { rlabel: 'Split', label: 'Split into files…', icon: 'split', enabled: has, run: pg60Split });
cmd('pg60_insert', { label: 'Insert from PDF…', icon: 'file-input', enabled: has, run: pg60Insert });
cmd('merge', { label: 'Combine PDFs…', icon: 'files', run: () => pg60Combine() });
cmd('pg60_ins', { label: 'Insert pages', rlabel: 'Insert', icon: 'file-plus-2', menu: ['blank', 'pg60_insert', 'pg60_replace', '-', 'merge'] });
cmd('pg60_replace', { label: 'Replace pages…', icon: 'replace', enabled: has, run: pg60Replace });
cmd('pg60_reverse', { label: 'Reverse order', icon: 'arrow-down-up', enabled: () => has() && doc.pages.length > 1, run: pg60Reverse });
cmd('pg60_rotate', { label: 'Rotate pages…', icon: 'rotate-cw-square', enabled: has, run: pg60RotateRange });
cmd('pg60_delete', { label: 'Delete pages…', icon: 'trash-2', enabled: has, run: () => pg60DeleteAsk() });
cmd('pg60_selAll', { label: 'Select all pages', icon: 'list-checks', enabled: () => has() && doc.pages.length > 1, run: () => { pg60SetSel([...doc.pages.keys()]); if (S.side !== 'thumbs') setSide('thumbs'); } });
// One button per job: Rotate and Delete open their other choices from a small arrow, Insert is a list.
ribbonAdd('pages', 'Order', ['pg60_reverse']);
ribbonAdd('pages', 'Insert', ['pg60_ins'], 'Remove');
ribbonAdd('pages', 'Crop', ['tool_crop', 'pg60_crop'], 'Remove');
ribbonAdd('pages', 'Remove', ['pg60_split']);
menuAdd('Pages', ['pg60_selAll', 'pg60_rotate', 'pg60_reverse', '-', 'pg60_insert', 'pg60_replace', 'pg60_split', 'pg60_delete', '-', 'tool_crop', 'pg60_crop']);

addStyle(`
.app[data-tool="crop"] .marks { cursor: crosshair; }
.page svg.pg60-ov { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5; }
.pg60-dim { fill: rgba(17, 12, 15, .55); }
.pg60-box { fill: none; stroke: var(--accent); stroke-width: 2; stroke-dasharray: 6 4; }
.thumb.pg60-sel { background: var(--accent-soft); color: var(--accent); outline: 2px solid var(--accent); outline-offset: -2px; }
.pg60-selbar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 8px; padding: 4px 4px 4px 10px; border-radius: 8px; background: var(--surface); border: 1px solid var(--line); color: var(--ink); font-size: 12px; }
.pg60-selbar .btn { height: 26px; padding: 0 8px; }
.pg60-dlg .field span { color: var(--ink-2); font-size: 13px; }
.pg60-label { margin: 12px 0 4px; color: var(--ink); font-weight: 600; font-size: 13px; }
.pg60-opt { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-height: 34px; color: var(--ink); cursor: pointer; }
.pg60-opt input[type="radio"] { accent-color: var(--accent); width: 16px; height: 16px; margin: 0; }
.pg60-opt input:not([type="radio"]) { font: inherit; color: var(--ink); background: var(--chrome); border: 1px solid var(--line); border-radius: 8px; padding: 5px 8px; }
.pg60-num { width: 72px; }
.pg60-note { font-size: 12px; color: var(--ink-3); margin: 4px 0 0; }
.pg60-wide { flex: 1; min-width: 120px; }
.pg60-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.pg60-grid .field { margin: 4px 0; }
.pg60-grid input { width: 100%; box-sizing: border-box; }
.pg60-files { list-style: none; margin: 8px 0 0; padding: 0; border: 1px solid var(--line); border-radius: 8px; max-height: 300px; overflow: auto; }
.pg60-file { display: flex; align-items: center; gap: 6px; padding: 4px 4px 4px 10px; color: var(--ink); }
.pg60-file + .pg60-file { border-top: 1px solid var(--line); }
.pg60-file > svg { width: 16px; height: 16px; flex: none; color: var(--ink-3); }
.pg60-fname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pg60-fcount { color: var(--ink-3); font-size: 12px; white-space: nowrap; margin-right: 4px; }
.pg60-fgap { width: 34px; flex: none; }
.pg60-file .icon-btn:disabled { opacity: .35; cursor: default; }
`);
TEST_HOOKS.pg60 = { sel: () => pg60Valid(), setSel: (l) => pg60SetSel(l), crop: (idx, m) => pg60SetCrop(idx, m) };
