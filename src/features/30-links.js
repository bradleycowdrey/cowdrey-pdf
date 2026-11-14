/* ---------------- links ----------------
   The Link tool (Edit tab): drag a box on the page, then choose where it goes: a web address or a page of this PDF.
     link   a new link: { x1, y1, x2, y2 } in PDF coordinates and { uri } or { page: "src:i" } (the original page's key,
            so moving pages keeps it pointing at the same page; a link to a page that was deleted is not saved)
     lnkx   a link already in the PDF given a new target: { ref (pdf.js id), rect, uri | page }
   A link already in the PDF that is deleted is an 'ae' mark (as a deleted comment is): hidden on screen, removed on save.
   On screen, links are invisible except with the Link tool (new ones dashed, the PDF's own outlined). With the Select
   tool new and changed links are followed like any other. Saved, they are real /Link annotations. Internal links the PDF
   already had are pointed at the right page again when pages are reordered, merged or deleted. */
addStyle(`
.marks .lnk-box { fill: color-mix(in srgb, var(--accent) 10%, transparent); stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 5 3; pointer-events: none; display: none; }
.app[data-tool="link"] .marks .lnk-box { display: inline; }
.marks .lnk-draft { fill: color-mix(in srgb, var(--accent) 10%, transparent); stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 5 3; pointer-events: none; }
.app[data-tool="link"] .marks { cursor: crosshair; }
.app[data-tool="link"] .marks.lnk-over { cursor: pointer; }
.lnk-layer { position: absolute; inset: 0; z-index: 5; pointer-events: none; }
.lnk-layer > * { position: absolute; display: block; box-sizing: border-box; }
.lnk-layer .lnk-a { pointer-events: none; }
.app[data-tool="select"] .lnk-layer .lnk-a { pointer-events: auto; cursor: pointer; }
.lnk-layer .lnk-out { display: none; border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent); border-radius: 2px; }
.app[data-tool="link"] .lnk-layer .lnk-out { display: block; }
.app[data-tool="link"] .lnk-layer .lnk-hover { background: color-mix(in srgb, var(--accent) 14%, transparent); outline: 1.5px solid var(--accent); }
.lnk-kind { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 2px; }
.lnk-kind label { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--line); border-radius: 17px; cursor: pointer; color: var(--ink); background: var(--chrome); }
.lnk-kind label:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.lnk-kind input { accent-color: var(--accent); margin: 0; }
.lnk-dlg-foot { flex-wrap: wrap; }
.field.lnk-web[hidden], .field.lnk-page[hidden] { display: none; }
.lnk-dlg-foot .lnk-del { margin-right: auto; }
`);

cmd('tool_link', { label: 'Link', icon: 'link', enabled: has, pressed: () => app.dataset.tool === 'link', run: () => {
  const was = app.dataset.tool; setTool('link');
  if (was !== 'link') toast('Drag a box to add a link, or click a link to change it');
} });
ribbonAdd('edit', 'Links', ['tool_link']);
menuAdd('Mark up', ['tool_link']);

const lnkRect = (m) => [Math.min(m.x1, m.x2), Math.min(m.y1, m.y2), Math.max(m.x1, m.x2), Math.max(m.y1, m.y2)];
// A rectangle in PDF coordinates, as a box on screen (any rotation).
function lnkScreenBox(v, r) {
  const pts = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]].map(([x, y]) => toView(v, x, y));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
const lnkPageNo = (key) => { const n = doc.pages.findIndex((e) => pageKey(e) === key); return n < 0 ? null : n + 1; };
const lnkDeleted = (entry) => new Set(marksOf(entry).filter((m) => m.type === 'ae' && m.deleted).map((m) => m.ref));
// Makes what was typed into a web address a PDF can hold: https:// added when missing, an email address as mailto:.
function lnkNormalUrl(s) {
  s = String(s || '').trim(); if (!s) return null;
  if (/^(javascript|data|file|vbscript):/i.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = /^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(s) ? 'mailto:' + s : 'https://' + s.replace(/^\/+/, '');
  if (/^https?:/i.test(s)) { try { const u = new URL(s); if (!u.hostname || !/\./.test(u.hostname) && u.hostname !== 'localhost') return null; return u.href; } catch { return null; } }
  try { return encodeURI(decodeURI(s)); } catch { return encodeURI(s); }
}

// The links already in a page (pdf.js annotations), with the page each internal one goes to ("src:i").
function lnkExisting(v) {
  const page = v.page;
  return page._lnkList || (page._lnkList = (async () => {
    const A = pdfjs.AnnotationType;
    const annots = await page.getAnnotations({ intent: 'display' }).catch(() => []);
    const out = [];
    for (const a of annots) {
      if (a.annotationType !== A.LINK || !a.rect || !a.id) continue;
      out.push({ id: a.id, rect: a.rect, url: a.url || a.unsafeUrl || null, key: a.dest != null ? await lnkDestKey(v.entry.src, a.dest) : null, internal: a.dest != null, other: a.dest == null && !(a.url || a.unsafeUrl) });
    }
    page._lnkValue = out;
    return out;
  })());
}
// The page a pdf.js destination (a name or an explicit array) goes to, as "src:i", or null.
async function lnkDestKey(src, dest) {
  try {
    const pd = pdfDocs.get(src);
    const ex = typeof dest === 'string' ? await pd.getDestination(dest) : dest;
    if (!Array.isArray(ex) || ex[0] == null) return null;
    const idx = typeof ex[0] === 'number' ? ex[0] : await pd.getPageIndex(ex[0]);
    return `${src}:${idx}`;
  } catch { return null; }
}
// What is under a point (PDF coordinates) with the Link tool: a new link, then one already in the PDF.
async function lnkHit(v, x, y) {
  const own = marksOf(v.entry);
  const inR = (r) => x >= Math.min(r[0], r[2]) - 1 && x <= Math.max(r[0], r[2]) + 1 && y >= Math.min(r[1], r[3]) - 1 && y <= Math.max(r[1], r[3]) + 1;
  for (let k = own.length - 1; k >= 0; k--) if (own[k].type === 'link' && inR(lnkRect(own[k]))) return { mark: own[k] };
  const gone = lnkDeleted(v.entry);
  for (const a of await lnkExisting(v)) if (!gone.has(a.id) && inR(a.rect)) return { a, mark: own.find((m) => m.type === 'lnkx' && m.ref === a.id) };
  return null;
}

// On screen: new links are a dashed box with the Link tool; the links layer (above the page) holds what is clicked
// with the Select tool and the outlines of the PDF's own links.
FEATURE.markTypes.link = {
  draw(v, m) {
    const b = lnkScreenBox(v, lnkRect(m));
    return svgEl('rect', { class: 'lnk-box', x: b.left, y: b.top, width: b.width, height: b.height, rx: 2 });
  },
  move(m, o, dx, dy) { m.x1 = o.x1 + dx; m.x2 = o.x2 + dx; m.y1 = o.y1 + dy; m.y2 = o.y2 + dy; },
};
// A changed link has nothing of its own to draw; the empty group keeps the marks layer in step (see lnkWatch).
FEATURE.markTypes.lnkx = { draw: () => svgEl('g', {}) };

function lnkFollow(m) {
  if (m.uri) { openExternal(m.uri); return; }
  const n = lnkPageNo(m.page);
  if (n == null) toast('That page is no longer in this PDF'); else goPage(n - 1);
}
function lnkLabel(m) { if (m.uri) return m.uri; const n = lnkPageNo(m.page); return n ? `Go to page ${n}` : 'Page deleted'; }
function lnkLayer(v) {
  if (!v.rendered || !v.el.isConnected) return;
  let layer = v.el.querySelector(':scope > .lnk-layer');
  if (!layer) { layer = document.createElement('div'); layer.className = 'lnk-layer'; v.el.appendChild(layer); }
  layer.innerHTML = '';
  const place = (el, r) => { const b = lnkScreenBox(v, r); Object.assign(el.style, { left: b.left + 'px', top: b.top + 'px', width: b.width + 'px', height: b.height + 'px' }); layer.appendChild(el); return el; };
  const anchor = (m, r, data) => {
    const a = document.createElement('a'); a.className = 'lnk-a'; a.title = lnkLabel(m);
    a.setAttribute('aria-label', lnkLabel(m));
    a.href = m.uri || '#';
    Object.assign(a.dataset, data);
    a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); lnkFollow(m); });
    return place(a, r);
  };
  const own = marksOf(v.entry), gone = lnkDeleted(v.entry);
  const list = v.page._lnkValue;
  if (list) for (const a of list) {
    if (gone.has(a.id)) continue;
    const o = place(document.createElement('div'), a.rect); o.className = 'lnk-out'; o.dataset.ref = a.id;
    const mx = own.find((m) => m.type === 'lnkx' && m.ref === a.id);
    if (mx) anchor(mx, a.rect, { ref: a.id });
  }
  for (const m of own) if (m.type === 'link') anchor(m, lnkRect(m), { id: m.id });
}
// The links layer follows the marks: whenever the page's marks are drawn again (an edit, undo, redo), it is rebuilt.
FEATURE.afterRender.push((v) => {
  const svg = v.el.querySelector('svg.marks');
  if (svg && !svg._lnkWatch) {
    let queued = false;
    svg._lnkWatch = new MutationObserver(() => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; lnkLayer(v); }); });
    svg._lnkWatch.observe(svg, { childList: true });
  }
  lnkLayer(v);
  lnkExisting(v).then(() => lnkLayer(v));
});

// The tool: drag to add a link; click a link to change or delete it.
FEATURE.tools.link = {
  down(e, v) {
    e.preventDefault();
    const [sx, sy] = localPoint(e, v), svg = v.el.querySelector('svg.marks');
    let draft = null, cx = sx, cy = sy;
    const move = (ev) => {
      [cx, cy] = localPoint(ev, v);
      if (!draft && Math.hypot(cx - sx, cy - sy) < 5) return;
      if (!draft) { draft = svgEl('rect', { class: 'lnk-draft', rx: 2 }); svg.appendChild(draft); }
      draft.setAttribute('x', Math.min(sx, cx)); draft.setAttribute('y', Math.min(sy, cy));
      draft.setAttribute('width', Math.abs(cx - sx)); draft.setAttribute('height', Math.abs(cy - sy));
    };
    const up = async () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (draft) {
        draft.remove();
        const [x1, y1] = toPdf(v, sx, sy), [x2, y2] = toPdf(v, cx, cy);
        if (Math.abs(x2 - x1) < 4 || Math.abs(y2 - y1) < 4) { toast('Drag a bigger box for the link'); return; }
        return lnkAdd(v, { x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) });
      }
      const hit = await lnkHit(v, ...toPdf(v, sx, sy));
      if (!hit) { toast('Drag a box over what should be the link'); return; }
      if (hit.a) return lnkEditExisting(v, hit.a, hit.mark);
      return lnkEditNew(v, hit.mark);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  },
  move(e, v) {
    if (e.buttons) return;
    const [x, y] = toPdf(v, ...localPoint(e, v));
    lnkHit(v, x, y).then((hit) => {
      const svg = v.el.querySelector('svg.marks'), layer = v.el.querySelector('.lnk-layer');
      if (svg) svg.classList.toggle('lnk-over', !!hit);
      if (!layer) return;
      layer.querySelectorAll('.lnk-hover').forEach((n) => n.classList.remove('lnk-hover'));
      if (hit && hit.a) { const o = layer.querySelector(`.lnk-out[data-ref="${CSS.escape(hit.a.id)}"]`); if (o) o.classList.add('lnk-hover'); }
    });
  },
};

// The dialog: where the link goes. Resolves { uri } or { page } (a page number), 'delete', or null (cancelled).
async function lnkAsk({ title, ok, uri = '', page = '', kind = 'web', canDelete = false, note = '' }) {
  for (;;) {
    const n = doc.pages.length;
    const body = `${note ? `<p>${esc(note)}</p>` : ''}<div class="lnk-kind" role="radiogroup" aria-label="Link to">
      <label><input type="radio" name="lnkKind" value="web"${kind === 'web' ? ' checked' : ''}> Web address</label>
      <label><input type="radio" name="lnkKind" value="page"${kind === 'page' ? ' checked' : ''}> Page in this PDF</label></div>
      <label class="field lnk-web"${kind === 'web' ? '' : ' hidden'}><span>Web address</span><input id="lnkUrl" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://example.com" value="${esc(uri)}"></label>
      <label class="field lnk-page"${kind === 'page' ? '' : ' hidden'}><span>Page number (1 to ${n})</span><input id="lnkPage" type="number" inputmode="numeric" min="1" max="${n}" value="${esc(page)}"></label>`;
    const state = { kind, uri, page };
    const actions = [...(canDelete ? [{ label: 'Delete link', value: 'delete', danger: true }] : []), { label: 'Cancel' }, { label: ok, value: 'ok', primary: true }];
    const res = await dialog(title, body, actions, (dlg) => {
      const foot = $('.dlg-foot', dlg); foot.classList.add('lnk-dlg-foot');
      const del = $('.btn.danger', foot); if (del) del.classList.add('lnk-del');
      const url = $('#lnkUrl', dlg), pg = $('#lnkPage', dlg);
      const show = () => { $('.lnk-web', dlg).hidden = state.kind !== 'web'; $('.lnk-page', dlg).hidden = state.kind !== 'page'; (state.kind === 'web' ? url : pg).focus(); };
      $$('input[name="lnkKind"]', dlg).forEach((r) => r.addEventListener('change', () => { state.kind = r.value; show(); }));
      url.addEventListener('input', () => { state.uri = url.value; });
      pg.addEventListener('input', () => { state.page = pg.value; });
      for (const inp of [url, pg]) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('.btn.primary', foot).click(); } });
      setTimeout(show, 0);
    });
    if (res !== 'ok') return res === 'delete' ? 'delete' : null;
    ({ kind, uri, page } = state);
    if (kind === 'web') {
      const u = lnkNormalUrl(uri);
      if (u) return { uri: u };
      toast(uri.trim() ? 'That web address doesn’t look right' : 'Type a web address for the link');
    } else {
      const p = parseInt(page, 10);
      if (p >= 1 && p <= n) return { page: p };
      toast(`Type a page number from 1 to ${n}`);
    }
  }
}
const lnkTarget = (res) => res.uri ? { uri: res.uri, page: undefined } : { uri: undefined, page: pageKey(doc.pages[res.page - 1]) };
const lnkSet = (m, res) => { const t = lnkTarget(res); delete m.uri; delete m.page; if (t.uri) m.uri = t.uri; else m.page = t.page; };

async function lnkAdd(v, r) {
  const here = views.indexOf(v) + 1;
  const res = await lnkAsk({ title: 'Add link', ok: 'Add link', page: String(Math.min(doc.pages.length, here + 1)) });
  if (!res || res === 'delete') return;
  const before = snapshot();
  const m = { id: uid(), type: 'link', ...r }; lnkSet(m, res);
  marksOf(v.entry).push(m);
  redrawPage(v.entry); changed(before); toast('Link added');
}
async function lnkEditNew(v, m) {
  const res = await lnkAsk({ title: 'Edit link', ok: 'Save', canDelete: true, kind: m.uri ? 'web' : 'page', uri: m.uri || '', page: m.page ? String(lnkPageNo(m.page) || '') : '' });
  if (!res) return;
  const before = snapshot(), list = marksOf(v.entry);
  if (res === 'delete') { list.splice(list.indexOf(m), 1); redrawPage(v.entry); changed(before); toast('Link deleted'); return; }
  lnkSet(m, res); redrawPage(v.entry); changed(before); toast('Link changed');
}
async function lnkEditExisting(v, a, mark) {
  let kind = 'web', uri = '', page = '';
  if (mark) { kind = mark.uri ? 'web' : 'page'; uri = mark.uri || ''; page = mark.page ? String(lnkPageNo(mark.page) || '') : ''; }
  else if (a.internal) { kind = 'page'; page = a.key ? String(lnkPageNo(a.key) || '') : ''; }
  else uri = a.url || '';
  const res = await lnkAsk({ title: 'Edit link', ok: 'Save', canDelete: true, kind, uri, page, note: a.other && !mark ? 'This link runs an action Cowdrey.PDF doesn’t show. Choose a new place for it to go, or delete it.' : '' });
  if (!res) return;
  const before = snapshot(), list = marksOf(v.entry);
  if (mark) list.splice(list.indexOf(mark), 1);
  if (res === 'delete') {
    list.push({ id: uid(), type: 'ae', ref: a.id, rect: a.rect, subtype: 'Link', deleted: true });
    changed(before); syncHiddenComments(); toast('Link deleted'); return;
  }
  const m = { id: uid(), type: 'lnkx', ref: a.id, rect: a.rect }; lnkSet(m, res); list.push(m);
  redrawPage(v.entry); changed(before); toast('Link changed');
}

/* Saving. New links become /Link annotations; changed ones get their new target; and when the saved PDF is assembled
   from copied pages, the PDF's own internal links are pointed at the copied pages (or removed if their page was deleted). */
FEATURE.savePage.push(async ({ L, out, p, entry, entries, marks }) => {
  const { PDFName, PDFArray, PDFDict, PDFRef, PDFNull, PDFNumber, PDFHexString } = L;
  const outPages = out.getPages();
  const same = entries === doc.pages && doc.sources.length === 1 && entries.every((e, n) => e.src === 0 && e.i === n) && pdfDocs.get(0).numPages === entries.length;
  const idxOf = (key) => entries.findIndex((e) => pageKey(e) === key);
  const asciiHex = (s) => PDFHexString.of([...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
  const top = (pg) => { const b = pg.getCropBox(); return b.y + b.height; };
  // Where a link goes, as the entries of its annotation dictionary; null when its page is not in the saved PDF.
  const target = (m) => {
    if (m.uri) return { A: out.context.obj({ S: 'URI', URI: asciiHex(m.uri) }) };
    const k = idxOf(m.page); if (k < 0) return null;
    return { Dest: out.context.obj([outPages[k].ref, PDFName.of('XYZ'), PDFNull, PDFNumber.of(top(outPages[k])), PDFNull]) };
  };
  let annots = p.node.lookup(PDFName.of('Annots'));
  const changes = marks.filter((m) => m.type === 'lnkx');
  // The PDF's own links on this page
  if (annots instanceof PDFArray && (changes.length || !same)) {
    const pd = pdfDocs.get(entry.src), page = await pd.getPage(entry.i + 1);
    const A = pdfjs.AnnotationType;
    const known = (await page.getAnnotations({ intent: 'display' }).catch(() => [])).filter((a) => a.annotationType === A.LINK && a.rect && a.id);
    const used = new Set();
    const refId = (r) => `${r.objectNumber}R${r.generationNumber ? r.generationNumber : ''}`;
    for (let k = annots.size() - 1; k >= 0; k--) {
      const r = annots.get(k), d = out.context.lookup(r);
      if (!(d instanceof PDFDict) || String(d.get(PDFName.of('Subtype'))) !== '/Link') continue;
      const rect = d.lookup(PDFName.of('Rect')); if (!(rect instanceof PDFArray)) continue;
      const rc = rect.asArray().map((x) => out.context.lookup(x).asNumber()), nr = [Math.min(rc[0], rc[2]), Math.min(rc[1], rc[3]), Math.max(rc[0], rc[2]), Math.max(rc[1], rc[3])];
      const a = known.find((x) => !used.has(x.id) && (same && r instanceof PDFRef ? x.id === refId(r) : x.rect.every((n, j) => Math.abs(n - nr[j]) < .6)));
      if (!a) continue;
      used.add(a.id);
      const m = changes.find((c) => c.ref === a.id);
      const remove = () => { annots.remove(k); if (r instanceof PDFRef) out.context.delete(r); };
      if (m) {
        const t = target(m);
        if (!t) { remove(); continue; }
        d.delete(PDFName.of('A')); d.delete(PDFName.of('Dest')); d.delete(PDFName.of('PA'));
        for (const [key, val] of Object.entries(t)) d.set(PDFName.of(key), val);
        continue;
      }
      if (same || a.dest == null) continue;
      // Copied pages: the destination pointed into the PDF the page came from (pdf-lib copied that page along with
      // the link, outside the page list; lnkSweep drops such copies once every page is saved).
      const key = await lnkDestKey(entry.src, a.dest), at = key == null ? -1 : idxOf(key);
      if (at < 0) { remove(); continue; }
      let view = [PDFName.of('XYZ'), PDFNull, PDFNumber.of(top(outPages[at])), PDFNull];
      try {
        const ex = typeof a.dest === 'string' ? await pd.getDestination(a.dest) : a.dest;
        if (Array.isArray(ex) && ex[1] && ex[1].name) view = [PDFName.of(ex[1].name), ...ex.slice(2).map((x) => typeof x === 'number' ? PDFNumber.of(x) : PDFNull)];
      } catch {}
      d.delete(PDFName.of('A')); d.set(PDFName.of('Dest'), out.context.obj([outPages[at].ref, ...view]));
    }
  }
  // New links
  for (const m of marks) {
    if (m.type !== 'link') continue;
    const t = target(m); if (!t) continue;
    const annot = out.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: lnkRect(m).map((n) => +n.toFixed(2)), Border: [0, 0, 0], F: 4, ...t });
    if (!(annots instanceof PDFArray)) { annots = out.context.obj([]); p.node.set(PDFName.of('Annots'), annots); }
    annots.push(out.context.register(annot));
  }
});

// Copied pages: pdf-lib also copies every page a link pointed to (and, through that page's links, the pages it points
// to), outside the page list. Once links point at the saved pages, those copies (and their content) are dropped.
function lnkSweep(L, out) {
  const { PDFName, PDFArray, PDFDict, PDFRef } = L;
  const kept = new Set(out.getPages().map((pg) => pg.ref.toString()));
  const list = (c) => c instanceof PDFArray ? c.asArray() : c ? [c] : [];
  const keepContents = new Set(out.getPages().flatMap((pg) => list(pg.node.get(PDFName.of('Contents'))).map(String)));
  const strays = out.context.enumerateIndirectObjects().filter(([r, o]) => o instanceof PDFDict && !kept.has(r.toString()) && String(o.get(PDFName.of('Type'))) === '/Page' && !o.get(PDFName.of('Kids')));
  if (!strays.length) return;
  // A copy something in the saved file still refers to (say a form button that goes to it) is kept.
  const refsIn = (o, seen = new Set()) => {
    const outR = [];
    const walk = (x) => {
      if (x instanceof PDFRef) { outR.push(x.toString()); return; }
      if (x instanceof PDFDict) { if (seen.has(x)) return; seen.add(x); for (const [, v] of x.entries()) walk(v); }
      else if (x instanceof PDFArray) for (const v of x.asArray()) walk(v);
    };
    walk(o); return outR;
  };
  const used = new Set();
  const stack = [out.context.trailerInfo.Root, out.context.trailerInfo.Info].filter(Boolean).map(String);
  while (stack.length) {
    const id = stack.pop(); if (used.has(id)) continue; used.add(id);
    const [num, gen] = id.split(' ').map(Number), obj = out.context.lookup(PDFRef.of(num, gen));
    if (obj) for (const r of refsIn(obj.dict || obj)) stack.push(r);
  }
  for (const [r, o] of strays) {
    if (used.has(r.toString())) continue;
    for (const c of list(o.get(PDFName.of('Contents')))) if (c instanceof PDFRef && !keepContents.has(String(c)) && !used.has(String(c))) out.context.delete(c);
    out.context.delete(r);
  }
}
FEATURE.saveDoc.push(async ({ L, out, entries }) => {
  const same = entries === doc.pages && doc.sources.length === 1 && entries.every((e, n) => e.src === 0 && e.i === n) && pdfDocs.get(0).numPages === entries.length;
  if (!same) lnkSweep(L, out);
});
