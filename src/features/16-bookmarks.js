/* ---------------- bookmarks (src/features/16-bookmarks.js) ----------------
   The sidebar's Outline tab, made editable like PDFelement's Bookmarks panel: add a bookmark for the page in view
   (Ctrl/Cmd+B; named after the page's first heading, else "Page N"), rename it (double-click or F2), delete it, add a
   child, drag to reorder or nest (drop on the top or bottom edge of a row to place it before or after, on the middle
   to put it inside), point it at the page in view, and expand or collapse them all. Add bookmarks from headings builds
   the tree from the H1-H3 headings (the PDF's tags, the added tags, or worked out from the text). Each bookmark keeps
   its colour (/C), bold and italic (/F) and how its destination shows the page (/XYZ, /Fit, /FitH, /FitR ...), and
   Style and zoom changes them; actions Cowdrey.PDF doesn't follow (/Named, /GoToR, /Launch, /JavaScript) are kept.
   docMarks(): { id, type: 'bookmarks', items: [{ id, title, key: 'src:i' | null, top?, url?, open, items: [...],
   color?: [r, g, b], bold?, italic?, view?: { t: 'FitH', a: [...] }, zoom?: 'inherit' | 'fit' | 'width',
   act?: 'Named' | ..., actName?, raw?: [num, gen] (the outline item in the opened file, for its action) }] }.
   A bookmark points at a page by its key, so it follows the page when pages move; a bookmark whose page was deleted
   is shown crossed out, and saved without a destination only when it has bookmarks under it (else it is left out). The PDF's own bookmarks are read into this tree the first time one is changed, and
   on saving the tree replaces the PDF's outline. Until then the outline is shown as it is and saved untouched. */

const BM = { sel: null, cache: null, renaming: null, drag: null };
const bmMark = () => (doc ? docMarks().find((m) => m.type === 'bookmarks') : null);
const bmPhone = () => isPhone();
const bmPageOf = (key) => (key == null || !doc ? -1 : doc.pages.findIndex((e) => pageKey(e) === key));

// The PDF's own outline as a tree of bookmarks (read once per opened file).
async function bmImported() {
  const pd = pdfDocs.get(0);
  if (!pd) return [];
  if (BM.cache && BM.cache.pd === pd) return BM.cache.tree;
  const outline = await pd.getOutline().catch(() => null);
  const raw = outline && outline.length ? await bmRawOutline() : null;
  const conv = async (items, rawItems) => {
    const out = [];
    for (let k = 0; k < (items || []).length; k++) {
      const o = items[k], r = rawItems && rawItems.length === items.length ? rawItems[k] : null;
      let key = null, top, view = null;
      try {
        const explicit = typeof o.dest === 'string' ? await pd.getDestination(o.dest) : o.dest;
        if (Array.isArray(explicit) && explicit[0] != null) {
          const idx = typeof explicit[0] === 'number' ? explicit[0] : await pd.getPageIndex(explicit[0]);
          key = `0:${idx}`;
          const t = explicit[1] && explicit[1].name, a = explicit.slice(2).map((x) => (typeof x === 'number' ? x : null));
          if (t === 'XYZ') { if (typeof explicit[3] === 'number') top = explicit[3]; if (a[0] != null || a[2] != null) view = { t, a: a.slice(0, 3) }; }
          else if (/^Fit(H|V|R|B|BH|BV)?$/.test(t || '')) { view = { t, a }; if ((t === 'FitH' || t === 'FitBH') && a[0] != null) top = a[0]; if (t === 'FitR' && a[3] != null) top = a[3]; }
        }
      } catch {}
      const b = { id: uid(), title: String(o.title || '').trim() || 'Untitled', key, open: !(o.count < 0), items: await conv(o.items, r && r.items) };
      if (top != null) b.top = top;
      if (view) b.view = view;
      if (!key && o.url) b.url = o.url;
      const c = o.color && [...o.color].map((n) => +(n / 255).toFixed(3));
      if (c && c.some((n) => n > 0)) b.color = c;
      if (o.bold) b.bold = true;
      if (o.italic) b.italic = true;
      if (r && r.act && !key && !b.url) { b.act = r.act; b.raw = r.ref; if (o.action) b.actName = o.action; }
      out.push(b);
    }
    return out;
  };
  const tree = await conv(outline, raw);
  BM.cache = { pd, tree };
  return tree;
}
// The opened file's outline items as pdf-lib reads them (in pdf.js's order): their object and any action other than a
// destination or a web address.
async function bmRawOutline() {
  try {
    const L = await loadPdfLib(), b = doc.sources[0];
    const d = await L.PDFDocument.load(b, b.password ? { password: b.password, updateMetadata: false } : { ignoreEncryption: true, updateMetadata: false });
    const N = (s) => L.PDFName.of(s), c = d.context, seen = new Set();
    const look = (o) => (o instanceof L.PDFRef ? c.lookup(o) : o);
    const level = (first) => {
      const out = []; let r = first;
      while (r instanceof L.PDFRef && !seen.has(r.tag)) {
        seen.add(r.tag); const it = c.lookup(r); if (!(it instanceof L.PDFDict)) break;
        const a = look(it.get(N('A'))), s = a instanceof L.PDFDict ? look(a.get(N('S'))) : null, act = s instanceof L.PDFName ? s.decodeText() : null;
        out.push({ ref: [r.objectNumber, r.generationNumber], act: act && !['GoTo', 'URI'].includes(act) ? act : null, items: level(it.get(N('First'))) });
        r = it.get(N('Next'));
      }
      return out;
    };
    const root = look(d.catalog.get(N('Outlines')));
    return root instanceof L.PDFDict ? level(root.get(N('First'))) : null;
  } catch { return null; }
}
async function bmTree() { const m = bmMark(); return m ? m.items : bmImported(); }
function bmFind(list, id, parent = null) {
  for (let k = 0; k < list.length; k++) {
    if (list[k].id === id) return { item: list[k], list, k, parent };
    const r = bmFind(list[k].items || [], id, list[k]); if (r) return r;
  }
  return null;
}
const bmWalk = (list, fn, depth = 0) => list.forEach((b) => { fn(b, depth); bmWalk(b.items || [], fn, depth + 1); });
// One undoable change to the tree. The PDF's own bookmarks become the editable tree on the first change.
async function bmEdit(fn) {
  if (!has()) return;
  const imported = bmMark() ? null : await bmImported();
  const before = snapshot(), fresh = !bmMark();
  if (fresh) docMarks().push({ id: uid(), type: 'bookmarks', items: JSON.parse(JSON.stringify(imported)) });
  const r = fn(bmMark().items);
  if (r === false) { if (fresh) docMarks().splice(docMarks().indexOf(bmMark()), 1); return r; }
  changed(before);
  await bmRender();
  return r;
}

// The first heading on a page: the first line set larger than most of its text.
async function bmHeading(n) {
  try {
    const pg = await pageOf(doc.pages[n]); const tc = await pg.getTextContent();
    const its = tc.items.filter((i) => i.str && i.str.trim() && i.transform);
    if (!its.length) return null;
    const size = (i) => Math.hypot(i.transform[2], i.transform[3]) || i.height || 0;
    const weighted = its.flatMap((i) => Array(Math.min(200, i.str.length)).fill(size(i))).sort((a, b) => a - b);
    const median = weighted[Math.floor(weighted.length / 2)];
    const lines = [];
    for (const i of its) {
      const y = i.transform[5], s = size(i);
      let line = lines.find((l) => Math.abs(l.y - y) < Math.max(2, s * .4));
      if (!line) { line = { y, items: [], size: 0 }; lines.push(line); }
      line.items.push(i); line.size = Math.max(line.size, s);
    }
    lines.sort((a, b) => b.y - a.y);
    const k = lines.findIndex((l) => l.size >= median * 1.15);
    if (k < 0) return null;
    const head = lines[k];
    // A heading wrapped over lines: the lines right under it at the same size (within 5%) are part of it.
    const parts = [head];
    for (let j = k + 1; j < lines.length; j++) {
      const l = lines[j], prev = parts[parts.length - 1];
      if (Math.abs(l.size - head.size) > head.size * .05 || prev.y - l.y > head.size * 1.6) break;
      parts.push(l);
    }
    const lineText = (l) => {
      l.items.sort((a, b) => a.transform[4] - b.transform[4]);
      let t = '', end = null;
      for (const i of l.items) { if (end != null && i.transform[4] > end + size(i) * .15 && !/\s$/.test(t)) t += ' '; t += i.str; end = i.transform[4] + (i.width || 0); }
      return t;
    };
    const text = parts.map(lineText).join(' ').replace(/\s+/g, ' ').trim();
    return text ? (text.length > 80 ? text.slice(0, 79).trim() + '…' : text) : null;
  } catch { return null; }
}

/* ---- commands ---- */
async function bmAdd(child) {
  if (!has()) return;
  const n = current, key = pageKey(doc.pages[n]);
  const b = { id: uid(), title: (await bmHeading(n)) || `Page ${n + 1}`, key, open: true, items: [] };
  await bmEdit((items) => {
    const at = BM.sel && bmFind(items, BM.sel);
    if (child && at) { at.item.items = at.item.items || []; at.item.items.push(b); at.item.open = true; }
    else if (at) at.list.splice(at.k + 1, 0, b);
    else { const k = items.findIndex((x) => bmPageOf(x.key) > n); k < 0 ? items.push(b) : items.splice(k, 0, b); }
  });
  BM.sel = b.id;
  if (!bmPhone() && !S.sidebar) toggleSidebar(true);
  if (!bmPhone() && S.side !== 'outline') setSide('outline');
  if (bmPhone() && app.dataset.sidebar !== 'open') { toast(`Bookmark added: ${b.title}`); return; }
  await bmRender(); bmRename(b.id);
}
async function bmDelete() {
  const id = BM.sel; if (!id) return;
  await bmEdit((items) => {
    const at = bmFind(items, id); if (!at) return false;
    at.list.splice(at.k, 1);
    const next = at.list[at.k] || at.list[at.k - 1] || at.parent;
    BM.sel = next ? next.id : null;
  });
}
async function bmSetDest() {
  const id = BM.sel; if (!id || !has()) return;
  const key = pageKey(doc.pages[current]);
  await bmEdit((items) => { const at = bmFind(items, id); if (!at) return false; at.item.key = key; for (const k of ['top', 'url', 'view', 'act', 'raw', 'actName']) delete at.item[k]; });
  toast(`Bookmark goes to page ${current + 1}`);
}
async function bmSetTitle(id, title) {
  title = String(title || '').replace(/\s+/g, ' ').trim();
  const t = await bmTree(), cur = bmFind(t, id);
  if (!title || !cur || cur.item.title === title) return;
  await bmEdit((items) => { const at = bmFind(items, id); if (at) at.item.title = title; });
}
// Moves a bookmark before or after another, or inside it (as its last child).
async function bmMove(id, targetId, where) {
  if (id === targetId) return;
  const t = await bmTree(), src = bmFind(t, id);
  if (!src || (targetId && bmFind(src.item.items || [], targetId))) return; // not into itself
  await bmEdit((items) => {
    const a = bmFind(items, id); a.list.splice(a.k, 1);
    if (!targetId) { items.push(a.item); return; }
    const b = bmFind(items, targetId);
    if (where === 'inside') { b.item.items = b.item.items || []; b.item.items.push(a.item); b.item.open = true; }
    else b.list.splice(b.k + (where === 'after' ? 1 : 0), 0, a.item);
  });
}
// Open or closed is how the tree is shown, not a change to the document: no undo step.
async function bmSetOpen(ids, open) {
  const t = await bmTree();
  bmWalk(t, (b) => { if ((ids === 'all' || ids.includes(b.id)) && b.items && b.items.length) b.open = open; });
  if (bmMark()) persist();
  bmRender();
}
async function bmGo(id) {
  const at = bmFind(await bmTree(), id); if (!at) return;
  const n = bmPageOf(at.item.key);
  if (n >= 0) goPage(n);
  else if (at.item.url) openExternal(at.item.url);
  else if (at.item.act === 'Named' && BM_NAMED[at.item.actName]) goPage(BM_NAMED[at.item.actName]());
  else if (at.item.act) toast('This bookmark runs an action Cowdrey.PDF doesn’t follow. It is kept in the saved PDF.');
  else toast(at.item.key == null ? 'This bookmark has no destination' : 'This bookmark’s page was deleted');
}

const BM_NAMED = { NextPage: () => Math.min(doc.pages.length - 1, current + 1), PrevPage: () => Math.max(0, current - 1), FirstPage: () => 0, LastPage: () => doc.pages.length - 1 };
const BM_COLORS = ['#000000', '#E03131', '#2448C9', '#2F9E44', '#E8590C', '#7048E8'];
const bmHex = (c) => '#' + (c || [0, 0, 0]).map((n) => Math.round(n * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const bmRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255].map((x) => +x.toFixed(3)); };
// Colour, bold and italic, and how the page is shown when the bookmark is chosen.
async function bmStyle() {
  const id = BM.sel; if (!id) return;
  const at = bmFind(await bmTree(), id); if (!at) return;
  const b = at.item, now = bmHex(b.color), zoom = b.zoom || 'keep';
  const body = `<div class="bm-style">
    <div class="field"><span>Colour</span><div class="bm-sw" role="group" aria-label="Colour">${BM_COLORS.map((c) => `<button type="button" class="swatch" data-bmc="${c}" style="background:${c}" aria-label="${esc(c === '#000000' ? 'Black' : colorName(c))}" aria-pressed="${now === c}"></button>`).join('')}</div></div>
    <label class="check"><input type="checkbox" data-bms="bold"${b.bold ? ' checked' : ''}> Bold</label>
    <label class="check"><input type="checkbox" data-bms="italic"${b.italic ? ' checked' : ''}> Italic</label>
    <label class="field"><span>Zoom</span><select data-bms="zoom">
      ${[['keep', b.view ? `As it is (${b.view.t})` : 'As it is'], ['inherit', 'Inherit zoom'], ['fit', 'Fit page'], ['width', 'Fit width']].map(([v, t]) => `<option value="${v}"${zoom === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}
    </select></label></div>`;
  let color = now, st = null;
  const a = await dialog('Bookmark style', body, [{ label: 'Cancel' }, { label: 'Done', value: 'ok', primary: true }], (dlg) => {
    const read = () => { st = { bold: $('[data-bms="bold"]', dlg).checked, italic: $('[data-bms="italic"]', dlg).checked, zoom: $('[data-bms="zoom"]', dlg).value }; };
    $$('[data-bmc]', dlg).forEach((s) => s.onclick = () => { color = s.dataset.bmc; $$('[data-bmc]', dlg).forEach((x) => x.setAttribute('aria-pressed', x === s)); });
    $$('[data-bms]', dlg).forEach((x) => x.onchange = read);
    read();
  });
  if (a !== 'ok' || !st) return;
  await bmSetStyle(id, { color: color === '#000000' ? null : bmRgb(color), bold: st.bold, italic: st.italic, zoom: st.zoom === 'keep' ? null : st.zoom });
}
async function bmSetStyle(id, st) {
  await bmEdit((items) => {
    const at = bmFind(items, id); if (!at) return false;
    const b = at.item;
    if ('color' in st) { if (st.color) b.color = st.color; else delete b.color; }
    for (const k of ['bold', 'italic']) if (k in st) { if (st[k]) b[k] = true; else delete b[k]; }
    if ('zoom' in st) { if (st.zoom) b.zoom = st.zoom; else delete b.zoom; }
  });
}
// Bookmarks from the headings (H1 to H3), nested by level, in one step.
async function bmFromHeadings() {
  if (!has()) return;
  let list = [];
  if (typeof acHeadingsList === 'function') list = await acHeadingsList();
  else for (let n = 0; n < doc.pages.length; n++) { const t = await bmHeading(n); if (t) list.push({ level: 1, title: t, key: pageKey(doc.pages[n]) }); }
  if (!list.length) { toast('No headings found'); return; }
  const tree = [], stack = [];
  for (const h of list) {
    const b = { id: uid(), title: h.title, key: h.key, open: true, items: [] };
    if (typeof h.top === 'number') b.top = +h.top.toFixed(2);
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    (stack.length ? stack[stack.length - 1].b.items : tree).push(b);
    stack.push({ level: h.level, b });
  }
  const old = await bmTree();
  let mode = 'replace';
  if (old.length) {
    mode = await dialog('Add bookmarks from headings', `<p>${list.length} heading${list.length > 1 ? 's' : ''} found. Replace the bookmarks you have, or add these after them?</p>`, [{ label: 'Cancel' }, { label: 'Add after', value: 'add' }, { label: 'Replace', value: 'replace', primary: true }]);
    if (!mode) return;
  }
  await bmEdit((items) => { if (mode === 'replace') items.splice(0, items.length); items.push(...tree); });
  BM.sel = null;
  if (!bmPhone() && !S.sidebar) toggleSidebar(true);
  if (!bmPhone() && S.side !== 'outline') setSide('outline');
  await bmRender();
  toast(`${list.length} bookmark${list.length > 1 ? 's' : ''} added`);
}

/* ---- the panel ---- */
async function bmRender(panel = $('#sidePanel')) {
  if (!doc || S.side !== 'outline' || !panel) return;
  const d = doc, tree = await bmTree();
  if (doc !== d || S.side !== 'outline') return;
  if (BM.sel && !bmFind(tree, BM.sel)) BM.sel = null;
  let anyClosed = false, anyKids = false;
  bmWalk(tree, (b) => { if (b.items && b.items.length) { anyKids = true; if (!b.open) anyClosed = true; } });
  const row = (b, depth) => {
    const kids = b.items && b.items.length, n = bmPageOf(b.key), sel = b.id === BM.sel;
    return `<li role="treeitem" data-bm="${b.id}" aria-selected="${sel}"${kids ? ` aria-expanded="${!!b.open}"` : ''}>
      <div class="bm-row${n < 0 && !b.url && !b.act && b.key != null ? ' bm-gone' : ''}" draggable="true" tabindex="${sel || (!BM.sel && b === tree[0]) ? 0 : -1}" style="padding-left:${4 + depth * 14}px">
        ${kids ? `<button type="button" class="bm-tw" tabindex="-1" aria-label="${b.open ? 'Collapse' : 'Expand'}">${ic(b.open ? 'chevron-down' : 'chevron-right')}</button>` : '<span class="bm-tw"></span>'}
        ${b.color ? `<span class="bm-dot" style="background:${bmHex(b.color)}" aria-hidden="true"></span>` : ''}<span class="bm-t${b.bold ? ' bm-b' : ''}${b.italic ? ' bm-i' : ''}" title="${esc(b.title)}">${esc(b.title)}</span>
        <span class="bm-pg"${n < 0 ? ` title="${b.url ? esc(b.url) : b.act ? esc(`Action: ${b.actName || b.act}`) : b.key == null ? 'No destination' : 'Its page was deleted'}"` : ''}>${n >= 0 ? n + 1 : b.url ? ic('external-link') : b.act ? ic('zap') : '–'}</span>
      </div>
      ${kids && b.open ? `<ul role="group">${b.items.map((c) => row(c, depth + 1)).join('')}</ul>` : ''}
    </li>`;
  };
  const tb = (act, icon, label, dis) => `<button type="button" class="icon-btn" data-bma="${act}" title="${esc(label)}" aria-label="${esc(label)}"${dis ? ' disabled' : ''}>${ic(icon)}</button>`;
  const none = !BM.sel;
  panel.innerHTML = `<div class="bm-bar" role="toolbar" aria-label="Bookmarks">
      ${tb('add', 'bookmark-plus', `Add bookmark (${fmtKey('Mod-b')})`)}${tb('child', 'corner-down-right', 'Add child bookmark', none)}${tb('rename', 'pencil', 'Rename (F2)', none)}${tb('dest', 'locate-fixed', 'Set to page in view', none)}${tb('style', 'palette', 'Style and zoom', none)}${tb('del', 'trash-2', 'Delete', none)}${tb('toggle', anyClosed ? 'chevrons-up-down' : 'chevrons-down-up', anyClosed ? 'Expand all' : 'Collapse all', !anyKids)}${tb('heads', 'list-tree', 'Add bookmarks from headings')}
    </div>
    ${tree.length ? `<ul class="bm-tree" role="tree" aria-label="Bookmarks">${tree.map((b) => row(b, 0)).join('')}</ul><div class="bm-end" data-bm-end></div>`
    : `<p class="empty-note">No bookmarks yet. Choose ${ic('bookmark-plus')} to add one for the page in view.</p>`}`;
  icons();
  bmWire(panel);
}
function bmRows(panel) { return $$('.bm-row', panel); }
function bmFocus(panel, id) { const li = $(`[data-bm="${id}"] > .bm-row`, panel); if (li) { bmRows(panel).forEach((r) => r.tabIndex = -1); li.tabIndex = 0; li.focus(); } }
async function bmSelect(id, go) {
  BM.sel = id; const panel = $('#sidePanel');
  $$('[data-bm]', panel).forEach((li) => li.setAttribute('aria-selected', li.dataset.bm === id));
  $$('.bm-bar [data-bma]', panel).forEach((b) => { if (!['add', 'toggle', 'heads'].includes(b.dataset.bma)) b.disabled = !id; });
  bmFocus(panel, id);
  if (go) await bmGo(id);
}
function bmWire(panel) {
  $$('[data-bma]', panel).forEach((b) => b.onclick = async () => {
    const a = b.dataset.bma;
    if (a === 'add') return bmAdd(false);
    if (a === 'child') return bmAdd(true);
    if (a === 'rename') return bmRename(BM.sel);
    if (a === 'dest') return bmSetDest();
    if (a === 'del') return bmDelete();
    if (a === 'style') return bmStyle();
    if (a === 'heads') return bmFromHeadings();
    if (a === 'toggle') return bmSetOpen('all', b.getAttribute('aria-label') === 'Expand all');
  });
  $$('[data-bm]', panel).forEach((li) => {
    const id = li.dataset.bm, r = $(':scope > .bm-row', li);
    r.onclick = (e) => {
      if (BM.renaming) return;
      const tw = e.target.closest('.bm-tw');
      if (tw && tw.tagName === 'BUTTON') { bmSetOpen([id], li.getAttribute('aria-expanded') !== 'true'); return; }
      bmSelect(id, true);
      if (bmPhone() && e.detail === 1) setTimeout(() => { if (!BM.renaming) toggleSidebar(false); }, 350);
    };
    r.ondblclick = (e) => { if (!e.target.closest('.bm-tw')) bmRename(id); };
    r.ondragstart = (e) => { BM.drag = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-bookmark', id); li.classList.add('bm-dragging'); };
    r.ondragend = () => { BM.drag = null; li.classList.remove('bm-dragging'); $$('.bm-before, .bm-after, .bm-inside', panel).forEach((x) => x.classList.remove('bm-before', 'bm-after', 'bm-inside')); };
    const zone = (e) => { const b = r.getBoundingClientRect(), f = (e.clientY - b.top) / b.height; return f < .3 ? 'before' : f > .7 ? 'after' : 'inside'; };
    r.ondragover = (e) => {
      if (!BM.drag || BM.drag === id) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      r.classList.remove('bm-before', 'bm-after', 'bm-inside'); r.classList.add('bm-' + zone(e));
    };
    r.ondragleave = () => r.classList.remove('bm-before', 'bm-after', 'bm-inside');
    r.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); const from = BM.drag; r.classList.remove('bm-before', 'bm-after', 'bm-inside'); BM.drag = null; if (from) bmMove(from, id, zone(e)); };
  });
  const end = $('[data-bm-end]', panel);
  if (end) {
    end.ondragover = (e) => { if (BM.drag) { e.preventDefault(); end.classList.add('bm-after'); } };
    end.ondragleave = () => end.classList.remove('bm-after');
    end.ondrop = (e) => { e.preventDefault(); end.classList.remove('bm-after'); const from = BM.drag; BM.drag = null; if (from) bmMove(from, null); };
  }
  const tree = $('.bm-tree', panel);
  if (tree) tree.onkeydown = (e) => {
    if (BM.renaming || e.target.tagName === 'INPUT') return;
    const rows = bmRows(panel), k = rows.indexOf(document.activeElement); if (k < 0) return;
    const li = rows[k].parentElement, id = li.dataset.bm;
    const keys = {
      ArrowDown: () => rows[k + 1] && bmSelect(rows[k + 1].parentElement.dataset.bm),
      ArrowUp: () => rows[k - 1] && bmSelect(rows[k - 1].parentElement.dataset.bm),
      ArrowRight: () => li.getAttribute('aria-expanded') === 'false' ? bmSetOpen([id], true).then(() => bmFocus(panel, id)) : null,
      ArrowLeft: () => li.getAttribute('aria-expanded') === 'true' ? bmSetOpen([id], false).then(() => bmFocus(panel, id)) : (li.parentElement.closest('[data-bm]') && bmSelect(li.parentElement.closest('[data-bm]').dataset.bm)),
      Enter: () => bmSelect(id, true), ' ': () => bmSelect(id, true),
      F2: () => bmRename(id),
      Delete: () => { BM.sel = id; return bmDelete().then(() => BM.sel && bmFocus($('#sidePanel'), BM.sel)); },
      Backspace: () => { BM.sel = id; return bmDelete().then(() => BM.sel && bmFocus($('#sidePanel'), BM.sel)); },
    };
    if (!keys[e.key] || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault(); e.stopPropagation(); keys[e.key]();
  };
}
// Rename in place: Enter or leaving the field keeps the name, Esc leaves it as it was.
FEATURE.commitEdits.push(async () => { if (BM.renaming && BM.finishRename) await BM.finishRename(true); }); // a name being typed is kept before a save
function bmRename(id) {
  const panel = $('#sidePanel'), li = id && $(`[data-bm="${id}"]`, panel); if (!li) return;
  BM.sel = id;
  const t = $(':scope > .bm-row .bm-t', li), old = t.textContent;
  const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'bm-in'; inp.value = old; inp.setAttribute('aria-label', 'Bookmark name');
  t.replaceWith(inp); BM.renaming = id;
  $(':scope > .bm-row', li).draggable = false;
  let done = false;
  const finish = async (keep) => {
    if (done) return; done = true; BM.renaming = null;
    if (keep && inp.value.trim() && inp.value.trim() !== old) await bmSetTitle(id, inp.value);
    else await bmRender();
    bmFocus($('#sidePanel'), id);
  };
  BM.finishRename = finish;
  inp.onkeydown = (e) => { if (!((e.metaKey || e.ctrlKey) && /^[sp]$/i.test(e.key))) e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') { e.preventDefault(); finish(false); } };
  inp.onblur = () => finish(true);
  inp.onclick = (e) => e.stopPropagation(); inp.ondblclick = (e) => e.stopPropagation();
  inp.focus(); inp.select();
}

/* ---- saving: the tree replaces the PDF's outline, each bookmark going to its page in the saved file ---- */
FEATURE.saveDoc.push(async ({ L, out, pages, entries, ctx: ctx0 }) => {
  const m = bmMark(); if (!m) return;
  const { PDFName, PDFDict, PDFRef, PDFHexString, PDFString } = L, N = PDFName.of, ctx = out.context, cat = out.catalog;
  // The old outline's items go, so they don't stay in the file unused.
  const oldRef = cat.get(N('Outlines'));
  const old = oldRef instanceof PDFRef ? ctx.lookup(oldRef) : oldRef;
  // Actions of the opened file's bookmarks that are kept as they are (read before its old items go).
  const acts = new Map(), src0 = ctx0 && ctx0.sources && ctx0.sources.loaded[0];
  bmWalk(m.items, (b) => {
    if (!b.raw || !b.act) return;
    const from = src0 || out, it = from.context.lookup(PDFRef.of(b.raw[0], b.raw[1]));
    if (!(it instanceof PDFDict) || !it.get(N('A'))) return;
    let a = it.get(N('A'));
    if (from !== out) { try { a = L.PDFObjectCopier.for(from.context, out.context).copy(a); } catch { return; } }
    acts.set(b.id, a);
  });
  if (old instanceof PDFDict) {
    const seen = new Set();
    const kill = (ref) => { while (ref instanceof PDFRef && !seen.has(String(ref))) { seen.add(String(ref)); const d = ctx.lookup(ref); if (!(d instanceof PDFDict)) break; kill(d.get(N('First'))); const next = d.get(N('Next')); ctx.delete(ref); ref = next; } };
    kill(old.get(N('First')));
    if (oldRef instanceof PDFRef) ctx.delete(oldRef);
  }
  cat.delete(N('Outlines'));
  const pageFor = new Map();
  entries.forEach((e, n) => { const k = pageKey(e); if (!pageFor.has(k)) pageFor.set(k, pages[n]); });
  // A bookmark whose page is gone, with nothing under it, would go nowhere in any reader: it is left out.
  const live = (list) => list.flatMap((b) => {
    const items = live(b.items || []);
    return b.key != null && !pageFor.get(b.key) && !b.url && !acts.has(b.id) && !items.length ? [] : [{ ...b, items }];
  });
  const items = live(m.items);
  if (!items.length) return;
  const build = (list, parentRef) => {
    const refs = list.map(() => ctx.nextRef());
    let visible = 0;
    list.forEach((b, k) => {
      const d = ctx.obj({});
      d.set(N('Title'), PDFHexString.fromText(b.title || 'Untitled'));
      d.set(N('Parent'), parentRef);
      if (k > 0) d.set(N('Prev'), refs[k - 1]);
      if (k < list.length - 1) d.set(N('Next'), refs[k + 1]);
      const p = b.key != null && pageFor.get(b.key);
      if (p) d.set(N('Dest'), ctx.obj(bmDest(p, b, N)));
      else if (b.url) d.set(N('A'), ctx.obj({ S: 'URI', URI: PDFString.of(b.url) }));
      else if (acts.has(b.id)) d.set(N('A'), acts.get(b.id));
      if (b.color) d.set(N('C'), ctx.obj(b.color));
      if (b.bold || b.italic) d.set(N('F'), ctx.obj((b.italic ? 1 : 0) | (b.bold ? 2 : 0)));
      visible++;
      if (b.items && b.items.length) {
        const r = build(b.items, refs[k]);
        d.set(N('First'), r.first); d.set(N('Last'), r.last); d.set(N('Count'), ctx.obj(b.open ? r.visible : -r.visible));
        if (b.open) visible += r.visible;
      }
      ctx.assign(refs[k], d);
    });
    return { first: refs[0], last: refs[refs.length - 1], visible };
  };
  const rootRef = ctx.nextRef();
  const r = build(items, rootRef);
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: r.first, Last: r.last, Count: r.visible }));
  cat.set(N('Outlines'), rootRef);
});

// The destination: the zoom chosen in Style and zoom, else the kind the PDF had (Fit, FitH, FitR ...), else XYZ.
function bmDest(p, b, N) {
  const c = p.getCropBox(), top = typeof b.top === 'number' ? b.top : c.y + c.height;
  if (b.zoom === 'fit') return [p.ref, N('Fit')];
  if (b.zoom === 'width') return [p.ref, N('FitH'), top];
  if (b.zoom === 'inherit') return [p.ref, N('XYZ'), null, top, null];
  const v = b.view;
  if (v && v.t === 'XYZ') return [p.ref, N('XYZ'), v.a[0] ?? null, top, v.a[2] ?? null];
  if (v && /^Fit(H|V|R|B|BH|BV)?$/.test(v.t)) return [p.ref, N(v.t), ...(v.a || []).map((x) => (x == null ? null : x))];
  return [p.ref, N('XYZ'), null, top, null];
}
FEATURE.outlinePanel = (panel) => bmRender(panel);
FEATURE.onDocShown.push(() => { BM.sel = null; BM.renaming = null; BM.cache = null; });
cmd('bmAdd', { label: 'Add bookmark', icon: 'bookmark-plus', key: 'Mod-b', enabled: has, run: () => bmAdd(false) });
{ const vm = MENUS.find(([t]) => t === 'View'), i = vm ? vm[1].indexOf('sidebar') : -1; if (i >= 0) vm[1].splice(i + 1, 0, 'bmAdd'); else menuAdd('View', ['bmAdd']); }
ribbonAdd('home', 'Edit', ['bmAdd']);
setTimeout(() => { try { ACCEL['Mod-b'] = 'CmdOrCtrl+B'; scheduleMacMenu(); } catch {} }, 0);
document.addEventListener('keydown', (e) => {
  if ($('#dialog').open || !(isMac ? e.metaKey : e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'b') return;
  const a = document.activeElement; if (a && (/INPUT|TEXTAREA|SELECT/.test(a.tagName) || a.isContentEditable)) return;
  e.preventDefault(); run('bmAdd');
});
TEST_HOOKS.bmTree = () => bmTree();
TEST_HOOKS.bmMove = bmMove;
TEST_HOOKS.bmFromHeadings = bmFromHeadings;
TEST_HOOKS.bmSetStyle = bmSetStyle;
TEST_HOOKS.bmSetTitle = bmSetTitle;
cmd('bmHeadings', { label: 'Add bookmarks from headings', rlabel: 'Bookmark headings', icon: 'list-tree', enabled: has, run: bmFromHeadings });
menuAdd('View', ['bmHeadings']);

addStyle(`
.bm-bar { position: sticky; top: 0; z-index: 2; display: flex; gap: 2px; padding: 0 0 6px; background: var(--chrome); }
@media (max-width: 760px), (max-height: 500px) and (pointer: coarse) { .bm-bar { background: var(--surface); } }
.bm-bar .icon-btn { width: 32px; height: 32px; }
.bm-bar .icon-btn:hover:not(:disabled) { background: var(--hover); color: var(--ink); }
.bm-bar .icon-btn:disabled { opacity: .35; cursor: default; }
.bm-tree, .bm-tree ul { list-style: none; margin: 0; padding: 0; }
.bm-row { display: flex; align-items: center; gap: 2px; min-height: 32px; padding-right: 6px; border-radius: 6px; cursor: pointer; color: var(--ink); font-size: 13px; position: relative; }
.bm-row:hover { background: var(--hover); }
.bm-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
[aria-selected="true"] > .bm-row { background: var(--accent-soft); color: var(--accent); }
.bm-tw { flex: none; width: 22px; height: 22px; display: grid; place-items: center; border: 0; background: none; padding: 0; color: var(--ink-3); cursor: pointer; border-radius: 4px; }
.bm-tw svg { width: 15px; height: 15px; }
.bm-t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bm-pg { flex: none; font-size: 11px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.bm-pg svg { width: 13px; height: 13px; }
.bm-gone .bm-t { color: var(--ink-3); text-decoration: line-through; }
.bm-b { font-weight: 600; } .bm-i { font-style: italic; }
.bm-dot { flex: none; width: 8px; height: 8px; border-radius: 4px; margin-right: 4px; }
.bm-style { display: grid; gap: 10px; } .bm-sw { display: flex; gap: 6px; margin-top: 4px; }
.bm-style .check { display: flex; gap: 6px; align-items: center; }
.bm-in { flex: 1; min-width: 0; font: inherit; color: var(--ink); background: var(--chrome); border: 1px solid var(--accent); border-radius: 5px; padding: 3px 6px; }
.bm-dragging { opacity: .5; }
.bm-before { box-shadow: inset 0 2px 0 var(--accent); }
.bm-after { box-shadow: inset 0 -2px 0 var(--accent); }
.bm-inside { outline: 2px dashed var(--accent); outline-offset: -2px; }
.bm-end { min-height: 24px; }
.empty-note svg { width: 14px; height: 14px; vertical-align: -2px; }
`);
