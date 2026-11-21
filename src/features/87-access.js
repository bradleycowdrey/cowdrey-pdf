/* ---------------- accessibility (src/features/87-access.js) ----------------
   Tagged PDF, kept and made. Everything here runs on the device.
   - Saving keeps a tagged PDF's tags: tags of deleted pages go (the ParentTree is built again), pages copied in from
     other tagged PDFs bring their tags (under a /Part element), and what the app draws on a tagged page is tagged too:
     mark-up as /Artifact, added text as a new /P, added pictures as a /Figure with their alt text. Comments, links and
     form fields get Annot, Link and Form elements.
   - Edit > Add tags automatically (an untagged PDF): headings by size and weight, paragraphs, lists, figures, tables
     (with the table finder of 88-insight.js when it is there), running headers, footers and page numbers as
     artifacts; the page content is marked with MCIDs when saving. docMarks(): { type: 'autotag', stats, pages }.
   - Alt text: each picture gets alt text or is marked decorative. docMarks(): { type: 'acalt', items: [...] }; added
     pictures keep theirs on the mark (m.alt, m.deco).
   - Reading order: the tags of the page in view, numbered on the page; drag to reorder, change a tag's type, merge,
     split. Auto tags change in the autotag mark; a PDF's own tags with { type: 'acorder', ops: [...] }.
   - Accessibility check (a subset of the Matterhorn protocol for PDF/UA), with fixes where they can be automatic
     ({ type: 'a11yfix', lang, title, dtitle, tabs, artifacts, annots }), and Save as PDF/UA.
   - In the app, a screen reader reads a tagged page by its tags (a hidden tree with headings, lists, figures). */

const ACC = { ua: false, order: false, srcDocs: new WeakMap(), thumbs: new Map(), tagCache: new WeakMap() };
const acMark = (type) => (doc ? docMarks().find((m) => m.type === type) : null);
const AC_ROLES = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'L', 'LI', 'Figure', 'Table', 'Caption', 'Quote', 'Note', 'Code', 'Formula', 'Span', 'Link', 'Form', 'Annot', 'Lbl', 'LBody', 'TR', 'TH', 'TD', 'Document', 'Part', 'Sect', 'Div', 'Art', 'BlockQuote', 'TOC', 'TOCI', 'Index', 'NonStruct', 'Private', 'Reference', 'BibEntry', 'Ruby', 'Warichu', 'THead', 'TBody', 'TFoot'];
const AC_PICK = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'L', 'Figure', 'Table', 'Caption', 'Quote', 'Note', 'Code', 'Artifact'];
const AC_GROUPING = new Set(['Document', 'Part', 'Sect', 'Div', 'Art', 'NonStruct', 'Private', 'TOC', 'Index', 'BlockQuote']);
const ac2 = (n) => +(+n).toFixed(2);

/* ---- pdf-lib helpers ---- */
function acK(L, out) {
  const c = out.context, N = (s) => L.PDFName.of(s);
  const look = (o) => (o instanceof L.PDFRef ? c.lookup(o) : o);
  const dict = (o) => { o = look(o); return o instanceof L.PDFDict ? o : null; };
  const num = (o) => { o = look(o); return o instanceof L.PDFNumber ? o.asNumber() : null; };
  const name = (o) => { o = look(o); return o instanceof L.PDFName ? o.decodeText() : null; };
  const str = (o) => { o = look(o); return o instanceof L.PDFString || o instanceof L.PDFHexString ? o.decodeText() : null; };
  const nums = (o) => { o = look(o); return o instanceof L.PDFArray ? o.asArray().map(num) : null; };
  return { ...L, L, out, c, N, look, dict, num, name, str, nums, cat: out.catalog };
}
function acText(K, st) {
  try {
    const b = st instanceof K.PDFRawStream ? K.decodePDFRawStream(st).decode() : st.getUnencodedContents ? st.getUnencodedContents() : st.getContents();
    let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return s;
  } catch { return ''; }
}
function acContents(K, node) { const raw = node.get(K.N('Contents')), r = raw && K.look(raw); return r instanceof K.PDFArray ? r.asArray() : raw ? [raw] : []; }
const acSrcOf = (K, node) => acContents(K, node).map((r) => { const st = K.look(r); return st ? acText(K, st) : ''; }).join('\n');
function acSetSrc(K, node, src) {
  const b = new Uint8Array(src.length); for (let i = 0; i < src.length; i++) b[i] = src.charCodeAt(i) & 255;
  node.set(K.N('Contents'), K.c.obj([K.c.register(K.c.flateStream(b))]));
}
// Inserts text at offsets of a content stream (each [at, text], or [start, end, open, close] around a range).
function acInsert(src, wraps) {
  const at = [];
  for (const w of wraps) { at.push([w.end, w.close, 0]); at.push([w.start, w.open, 1]); }
  at.sort((a, b) => b[0] - a[0] || a[2] - b[2]);
  for (const [k, t] of at) src = src.slice(0, k) + t + src.slice(k);
  return src;
}

/* ---- reading a content stream: what paints (text, paths, pictures), and the marked content around it ---- */
const AC_PATH = new Set(['m', 'l', 'c', 'v', 'y', 'h', 're']), AC_PAINT = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);
const AC_SHOW = new Set(['Tj', 'TJ', "'", '"']), AC_GAP = new Set(['q', 'Q', 'BT', 'ET', 'BDC', 'BMC', 'EMC', 'BI', 'ID', 'EI', 'BX', 'EX']);
function acUnits(ops, mcOf, nameOf) {
  const units = [], stack = [], seqs = []; let bt = 0, inBT = false, path = null, bi = null, maxMcid = -1;
  const inner = () => { for (let k = stack.length - 1; k >= 0; k--) if (stack[k].mcid != null || stack[k].tag === 'Artifact') return stack[k]; return null; };
  const add = (kind, from, to, extra) => { const mc = inner(); units.push({ kind, from, to, start: ops[from].start, end: ops[to].end, bt: inBT ? bt : 0, covered: !!mc, mc, ...extra }); };
  ops.forEach((op, i) => {
    const o = op.o;
    if (bi != null) { if (o === 'EI') { add('inline', bi, i); bi = null; } return; }
    if (o === 'BDC' || o === 'BMC') { const m = mcOf(op); if (m.mcid != null && m.mcid > maxMcid) maxMcid = m.mcid; stack.push({ ...m, from: i, start: op.start, openEnd: op.end }); return; }
    if (o === 'EMC') { const s = stack.pop(); if (s) seqs.push({ ...s, to: i, end: op.end }); return; }
    if (o === 'BT') { inBT = true; bt++; return; }
    if (o === 'ET') { inBT = false; return; }
    if (o === 'BI') { bi = i; return; }
    if (AC_PATH.has(o)) { if (path == null) path = i; return; }
    if (AC_PAINT.has(o)) { add('path', path ?? i, i); path = null; return; }
    if (o === 'n') { path = null; return; }
    if (o === 'sh') { add('shade', i, i); return; }
    if (o === 'Do') { add('xobj', i, i, { name: nameOf(op) }); return; }
    if (AC_SHOW.has(o)) add('text', i, i);
  });
  return { ops, units, seqs, maxMcid };
}
function acScan(src) {
  const toks = tokenizeContent(src), ops = []; let args = [], st = null;
  for (const t of toks) {
    if (t.t === 'op') { ops.push({ o: t.v, start: st ?? t.start, end: t.end, args }); args = []; st = null; continue; }
    if (st == null) st = t.start; args.push(t);
  }
  return acUnits(ops, (op) => {
    const a = op.args, tag = a[0] && a[0].t === 'name' ? a[0].v : ''; let mcid = null;
    for (let k = 0; k + 1 < a.length; k++) if (a[k].t === 'name' && a[k].v === 'MCID' && a[k + 1].t === 'num') mcid = a[k + 1].v;
    return { tag, mcid };
  }, (op) => op.args[0] && op.args[0].v);
}
// The same for operators pdf-lib is about to write (marks drawn on the page).
function acScanOps(K, list) {
  const ops = list.map((op, i) => ({ o: op.name, args: op.args || [], start: i, end: i }));
  return acUnits(ops, (op) => {
    const a = op.args, tag = a[0] instanceof K.PDFName ? a[0].decodeText() : ''; let mcid = null;
    if (a[1] instanceof K.PDFDict) mcid = K.num(a[1].get(K.N('MCID')));
    return { tag, mcid };
  }, (op) => (op.args[0] instanceof K.PDFName ? op.args[0].decodeText() : null));
}
const acGapSafe = (scan, a, b) => { for (let k = a.to + 1; k < b.from; k++) if (AC_GAP.has(scan.ops[k].o)) return false; return true; };
// Runs of units with the same target, each run one marked-content sequence.
function acGroups(scan, target) {
  const out = []; let cur = null, prev = null;
  for (const u of scan.units) {
    const t = u.covered ? null : target(u);
    if (t == null) { cur = null; prev = u; continue; }
    if (cur && cur.t === t && prev && acGapSafe(scan, prev, u)) { cur.units.push(u); cur.end = u.end; cur.to = u.to; }
    else { cur = { t, units: [u], start: u.start, end: u.end, from: u.from, to: u.to }; out.push(cur); }
    prev = u;
  }
  return out;
}
// Where each piece of text and picture is drawn (page space), by its place in the stream.
function acGeometry(K, node, src) {
  const { fontWidth } = pageFonts(K.L, K.out, node), shows = new Map(), images = new Map();
  try { walkContent(src, fontWidth, (op) => shows.set(op.start, op), (im) => images.set(im.start, im)); } catch {}
  const res = node.Resources && node.Resources(), xo = res && res.lookup(K.N('XObject'));
  const xobj = (name) => { const st = xo instanceof K.PDFDict && name ? xo.lookup(K.N(name)) : null; return st && st.dict ? st : null; };
  const kindOf = (u) => { if (u.kind !== 'xobj') return u.kind; const st = xobj(u.name); const sub = st && K.name(st.dict.get(K.N('Subtype'))); return sub === 'Image' ? 'image' : sub === 'Form' ? 'form' : 'other'; };
  const boxOf = (u) => {
    const im = images.get(u.start); if (!im) return null;
    if (kindOf(u) === 'form') {
      const st = xobj(u.name), bb = st && K.nums(st.dict.get(K.N('BBox'))), m = (st && K.nums(st.dict.get(K.N('Matrix')))) || [1, 0, 0, 1, 0, 0];
      if (!bb || bb.length !== 4) return null; const mm = mul(m, im.ctm);
      return quadBox([[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]].map(([x, y]) => apply(mm, x, y)));
    }
    return quadBox([[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => apply(im.ctm, x, y)));
  };
  return { shows, images, kindOf, boxOf };
}
const acSameBox = (a, b, tol = 1.5) => a && b && a.every((n, k) => Math.abs(n - b[k]) <= tol);
const acOpenTag = (role, mcid, sub) => role === 'Artifact' ? (sub ? `/Artifact <</Type /Pagination /Subtype /${sub}>> BDC\n` : '/Artifact BMC\n') : `/${role} <</MCID ${mcid}>> BDC\n`;

/* ---- the structure tree ---- */
function acRoot(K, create) {
  let ref = K.cat.get(K.N('StructTreeRoot')), root = K.dict(ref);
  if (!root && !create) return null;
  if (!root) { root = K.c.obj({ Type: 'StructTreeRoot' }); }
  if (!(ref instanceof K.PDFRef)) { ref = K.c.register(root); K.cat.set(K.N('StructTreeRoot'), ref); }
  return { root, ref };
}
function acKids(K, e) {
  const k = e.get(K.N('K')); if (k == null) return [];
  const o = K.look(k); return o instanceof K.PDFArray ? o.asArray() : [k];
}
function acSetKids(K, e, list) { if (list.length) e.set(K.N('K'), K.c.obj(list)); else e.delete(K.N('K')); }
const acIsElem = (K, o) => o instanceof K.PDFDict && !!o.get(K.N('S')) && !['MCR', 'OBJR'].includes(K.name(o.get(K.N('Type'))));
// Depth first, in order: fn(ref, elem, parentRef, parentDict, page) — page is the element's own /Pg or the nearest above.
function acWalk(K, fn) {
  const r = acRoot(K); if (!r) return;
  const seen = new Set();
  const go = (pref, pe, pg) => {
    for (const kid of acKids(K, pe)) {
      if (!(kid instanceof K.PDFRef) || seen.has(kid.tag)) continue;
      const e = K.dict(kid); if (!acIsElem(K, e)) continue;
      seen.add(kid.tag);
      const own = e.get(K.N('Pg')), page = own instanceof K.PDFRef ? own : pg;
      if (fn(kid, e, pref, pe, page) === false) continue;
      go(kid, e, page);
    }
  };
  go(r.ref, r.root, null);
}
// Content items of an element: { kind: 'mc' | 'obj', page (ref tag), mcid, obj, stm }.
function acItems(K, e, page) {
  const out = [];
  for (const kid of acKids(K, e)) {
    const o = K.look(kid);
    if (o instanceof K.PDFNumber) { out.push({ kind: 'mc', page, mcid: o.asNumber() }); continue; }
    if (o instanceof K.PDFDict && !(kid instanceof K.PDFRef)) {
      const t = K.name(o.get(K.N('Type'))), pg = o.get(K.N('Pg')), p2 = pg instanceof K.PDFRef ? pg : page;
      if (t === 'MCR') out.push({ kind: 'mc', page: p2, mcid: K.num(o.get(K.N('MCID'))), stm: o.get(K.N('Stm')) || null });
      else if (t === 'OBJR') out.push({ kind: 'obj', page: p2, obj: o.get(K.N('Obj')) });
    }
  }
  return out;
}
const acRoleOf = (K, S) => {
  const r = acRoot(K), rm = r && K.dict(r.root.get(K.N('RoleMap')));
  let s = S, n = 0; while (rm && !AC_ROLES.includes(s) && n++ < 10) { const m = K.name(rm.get(K.N(s))); if (!m) break; s = m; }
  return s;
};
function acNewElem(K, S, parentRef, extra = {}) {
  const d = K.c.obj({ Type: 'StructElem', S, P: parentRef });
  for (const [k, v] of Object.entries(extra)) if (v != null) d.set(K.N(k), v);
  return K.c.register(d);
}
// The element new tags go in: the one element under the root (a Document), or a new Document.
function acContainer(K) {
  const r = acRoot(K, true), kids = acKids(K, r.root).filter((k) => k instanceof K.PDFRef && acIsElem(K, K.dict(k)));
  if (kids.length === 1) return { ref: kids[0], dict: K.dict(kids[0]) };
  if (!kids.length) { const ref = acNewElem(K, 'Document', r.ref); acSetKids(K, r.root, [ref]); return { ref, dict: K.dict(ref) }; }
  return { ref: r.ref, dict: r.root };
}
function acAppend(K, parent, ref) { const list = acKids(K, parent.dict); list.push(ref); acSetKids(K, parent.dict, list); K.dict(ref).set(K.N('P'), parent.ref); }
// Puts new elements after the last element with content on their page (in reading order), or at the end. The tree is
// walked once for all of them and each parent's kids are written once (a PDF with thousands of links stays quick).
function acInserter(K) {
  let last = null; const adds = [];
  const index = () => {
    last = new Map();
    acWalk(K, (er, e, pr, pe, page) => { for (const it of acItems(K, e, page)) if (it.page) last.set(it.page.tag, { er, pr, pe }); });
  };
  return {
    add(pageRef, ref) { if (!last) index(); adds.push({ at: last.get(pageRef.tag) || null, ref }); },
    flush() {
      const byParent = new Map(), tail = [];
      for (const a of adds) {
        if (!a.at) { tail.push(a.ref); continue; }
        let g = byParent.get(a.at.pe); if (!g) byParent.set(a.at.pe, g = { pr: a.at.pr, after: new Map() });
        const t = a.at.er.tag; if (!g.after.has(t)) g.after.set(t, []); g.after.get(t).push(a.ref);
      }
      for (const [pe, g] of byParent) {
        const list = [], left = new Map(g.after);
        for (const kid of acKids(K, pe)) { list.push(kid); const x = kid instanceof K.PDFRef && left.get(kid.tag); if (x) { list.push(...x); left.delete(kid.tag); } }
        for (const x of left.values()) list.push(...x); // its anchor left the tree since: at the end of the parent
        acSetKids(K, pe, list);
        for (const refs of g.after.values()) for (const r of refs) K.dict(r).set(K.N('P'), g.pr);
      }
      if (tail.length) { const box = acContainer(K); acSetKids(K, box.dict, [...acKids(K, box.dict), ...tail]); for (const r of tail) K.dict(r).set(K.N('P'), box.ref); }
      adds.length = 0; last = null;
    },
  };
}
// Removes an element left with nothing in it (and a parent that it leaves empty, up to a grouping element).
function acDropEmpty(K, ref) {
  for (let n = 0; ref && n < 50; n++) {
    const e = K.dict(ref); if (!acIsElem(K, e) || acKids(K, e).length) return;
    const par = acParentOf(K, ref); if (!par) return;
    acSetKids(K, par.dict, acKids(K, par.dict).filter((x) => !(x instanceof K.PDFRef && x.tag === ref.tag)));
    if (par.dict === acRoot(K).root || AC_GROUPING.has(acRoleOf(K, K.name(par.dict.get(K.N('S'))) || ''))) return;
    ref = par.ref;
  }
}
// After pages are moved, merged or extracted in another order: the elements of each grouping element (Document, Part,
// Sect…) in the order of the pages they are on. Elements on the same page keep their order.
function acSortByPage(K, pages) {
  const r = acRoot(K); if (!r) return;
  const at = new Map(pages.map((p, i) => [p.ref.tag, i])), memo = new Map();
  const keyOf = (ref, inh, seen) => {
    if (memo.has(ref.tag)) return memo.get(ref.tag);
    const e = K.dict(ref); if (!acIsElem(K, e) || seen.has(ref.tag)) return Infinity;
    seen.add(ref.tag);
    const own = e.get(K.N('Pg')), pg = own instanceof K.PDFRef ? own : inh; let k = Infinity;
    for (const it of acItems(K, e, pg)) if (it.page && at.has(it.page.tag)) k = Math.min(k, at.get(it.page.tag));
    for (const kid of acKids(K, e)) if (kid instanceof K.PDFRef) k = Math.min(k, keyOf(kid, pg, seen));
    memo.set(ref.tag, k); return k;
  };
  const done = new Set();
  const sort = (dict, inh) => {
    const kids = acKids(K, dict), refs = kids.filter((kid) => kid instanceof K.PDFRef && acIsElem(K, K.dict(kid)));
    if (refs.length > 1 && refs.length === kids.length) {
      // an element with nothing on a page stays after the one before it
      let prev = 0; const keyed = refs.map((kid, n) => { let k = keyOf(kid, inh, new Set()); if (!Number.isFinite(k)) k = prev; prev = k; return { kid, k, n }; });
      keyed.sort((a, b) => a.k - b.k || a.n - b.n);
      if (keyed.some((x, n) => x.n !== n)) acSetKids(K, dict, keyed.map((x) => x.kid));
    }
    for (const kid of refs) {
      if (done.has(kid.tag)) continue; done.add(kid.tag);
      const e = K.dict(kid), own = e.get(K.N('Pg'));
      if (AC_GROUPING.has(acRoleOf(K, K.name(e.get(K.N('S'))) || ''))) sort(e, own instanceof K.PDFRef ? own : inh);
    }
  };
  sort(r.root, null);
}

/* ---- tags through page deletes and merges ---- */
// Tags of pages no longer in the PDF go (an element keeps its place while anything under it is still shown).
function acPrune(K, keep) {
  const r = acRoot(K); if (!r) return;
  const seen = new Set();
  const prune = (e, inh) => {
    const pg = e.get(K.N('Pg')), own = pg instanceof K.PDFRef, live = !own || keep.has(pg.tag), eff = own ? (live ? pg : null) : inh;
    const kids = acKids(K, e), kept = [];
    for (const kid of kids) {
      const o = K.look(kid);
      if (o instanceof K.PDFNumber) { if (eff) kept.push(kid); continue; }
      if (o instanceof K.PDFDict && !(kid instanceof K.PDFRef)) {
        const t = K.name(o.get(K.N('Type'))), p2 = o.get(K.N('Pg')), page = p2 instanceof K.PDFRef ? (keep.has(p2.tag) ? p2 : null) : eff;
        if (t === 'OBJR') { const obj = o.get(K.N('Obj')); if (page && obj instanceof K.PDFRef && K.c.lookup(obj)) kept.push(kid); continue; }
        if (page) kept.push(kid);
        continue;
      }
      if (kid instanceof K.PDFRef && acIsElem(K, o)) { if (seen.has(kid.tag)) continue; seen.add(kid.tag); if (prune(o, eff)) kept.push(kid); continue; }
      kept.push(kid);
    }
    if (own && !live) e.delete(K.N('Pg'));
    acSetKids(K, e, kept);
    return kept.length > 0 || (!kids.length && live);
  };
  acSetKids(K, r.root, acKids(K, r.root).filter((kid) => { const o = K.dict(kid); if (!acIsElem(K, o)) return false; seen.add(kid.tag); return prune(o, null); }));
}
// A copy of a value from another PDF (attributes, class maps): pages and elements are not followed.
function acCopyVal(K, S, v, maps) {
  if (v instanceof S.PDFRef) {
    if (maps.memo.has(v.tag)) return maps.memo.get(v.tag);
    const o = S.c.lookup(v); if (o == null) return null;
    if (o instanceof S.PDFDict) {
      const t = S.name(o.get(S.N('Type')));
      if (t === 'Page') return maps.pages.get(v.tag) || null;
      if (o.get(S.N('S')) && (t === 'StructElem' || !t) && o.get(S.N('P'))) return null;
    }
    const nref = K.c.nextRef(); maps.memo.set(v.tag, nref);
    const copy = acCopyVal(K, S, o, maps); if (copy == null) return null;
    K.c.assign(nref, copy); return nref;
  }
  if (v instanceof S.PDFDict) { const d = K.c.obj({}); for (const [k, x] of v.entries()) { const y = acCopyVal(K, S, x, maps); if (y != null) d.set(K.N(k.decodeText()), y); } return d; }
  if (v instanceof S.PDFArray) { const a = K.c.obj([]); for (const x of v.asArray()) { const y = acCopyVal(K, S, x, maps); a.push(y == null ? K.PDFNull : y); } return a; }
  if (v instanceof S.PDFRawStream) { const d = acCopyVal(K, S, v.dict, maps); return K.PDFRawStream.of(d, v.contents); }
  if (v instanceof S.PDFName) return K.N(v.decodeText());
  if (v instanceof S.PDFNumber) return K.PDFNumber.of(v.asNumber());
  if (v instanceof S.PDFBool) return v.asBoolean() ? K.PDFBool.True : K.PDFBool.False;
  if (v instanceof S.PDFString) return K.PDFString.of(v.asString());
  if (v instanceof S.PDFHexString) return K.PDFHexString.of(v.asString());
  if (v === S.PDFNull) return K.PDFNull;
  return v;
}
// The elements of `S`'s tree that have content on the pages in maps.pages, copied with the pages' new refs.
function acCopyTree(K, S, maps) {
  const r = acRoot(S); if (!r) return [];
  const seen = new Set();
  const copy = (srcRef, inh) => {
    const e = S.dict(srcRef);
    const pg = e.get(S.N('Pg')), own = pg instanceof S.PDFRef, mapped = own ? (maps.pages.get(pg.tag) || null) : inh;
    const kids = [], childRefs = [];
    for (const kid of acKids(S, e)) {
      const o = S.look(kid);
      if (o instanceof S.PDFNumber) { if (mapped) kids.push(K.PDFNumber.of(o.asNumber())); continue; }
      if (o instanceof S.PDFDict && !(kid instanceof S.PDFRef)) {
        const t = S.name(o.get(S.N('Type'))), p2 = o.get(S.N('Pg')), page = p2 instanceof S.PDFRef ? (maps.pages.get(p2.tag) || null) : mapped;
        if (t === 'OBJR') { const obj = o.get(S.N('Obj')), a = obj instanceof S.PDFRef && maps.annots.get(obj.tag); if (a) kids.push(K.c.obj({ Type: 'OBJR', Obj: a, ...(page ? { Pg: page } : {}) })); continue; }
        if (t === 'MCR' && page && !o.get(S.N('Stm'))) kids.push(K.c.obj({ Type: 'MCR', Pg: page, MCID: S.num(o.get(S.N('MCID'))) }));
        continue;
      }
      if (kid instanceof S.PDFRef && acIsElem(S, o) && !seen.has(kid.tag)) { seen.add(kid.tag); const c = copy(kid, mapped); if (c) { kids.push(c); childRefs.push(c); } }
    }
    if (!kids.length) return null;
    const d = K.c.obj({});
    for (const [k, v] of e.entries()) {
      const key = k.decodeText(); if (['K', 'P', 'Pg', 'ID', 'Ref'].includes(key)) continue;
      const y = acCopyVal(K, S, v, maps); if (y != null) d.set(K.N(key), y);
    }
    if (own && mapped) d.set(K.N('Pg'), mapped);
    const ref = K.c.register(d);
    d.set(K.N('K'), K.c.obj(kids));
    for (const c of childRefs) K.dict(c).set(K.N('P'), ref);
    return ref;
  };
  const tops = [];
  for (const kid of acKids(S, r.root)) { const o = S.dict(kid); if (!acIsElem(S, o) || seen.has(kid.tag)) continue; seen.add(kid.tag); const c = copy(kid, null); if (c) tops.push(c); }
  // Role and class maps: what the copied tags use and the PDF does not have yet.
  const dst = acRoot(K, true).root;
  for (const key of ['RoleMap', 'ClassMap']) {
    const from = S.dict(r.root.get(S.N(key))); if (!from) continue;
    let to = K.dict(dst.get(K.N(key))); if (!to) { to = K.c.obj({}); dst.set(K.N(key), to); }
    for (const [k, v] of from.entries()) if (!to.get(K.N(k.decodeText()))) { const y = acCopyVal(K, S, v, maps); if (y != null) to.set(K.N(k.decodeText()), y); }
  }
  return tops;
}
// The annotations of a copied page, matched to the source's (same type, place and name).
function acAnnotMap(K, S, srcPage, outPage, into) {
  const list = (P, node) => { const a = P.look(node.get(P.N('Annots'))); return a instanceof P.PDFArray ? a.asArray().filter((r) => r instanceof P.PDFRef) : []; };
  const sig = (P, r) => { const d = P.dict(r); if (!d) return ''; const rc = P.nums(d.get(P.N('Rect'))) || []; return [P.name(d.get(P.N('Subtype'))), rc.map((n) => Math.round((n || 0) * 10)).join(','), P.str(d.get(P.N('NM'))) || P.str(d.get(P.N('T'))) || ''].join('|'); };
  const outs = list(K, outPage).map((r) => [r, sig(K, r)]), used = new Set();
  for (const r of list(S, srcPage)) {
    const s = sig(S, r), m = outs.find(([o, t]) => t === s && !used.has(o.tag));
    if (m) { used.add(m[0].tag); into.set(r.tag, m[0]); }
  }
}
function acSrcTagged(L, ctx, k) {
  const d = ctx.sources && ctx.sources.loaded[k]; if (!d) return false;
  ctx.acTagged ||= new Map();
  if (!ctx.acTagged.has(k)) ctx.acTagged.set(k, !!d.catalog.get(L.PDFName.of('StructTreeRoot')));
  return ctx.acTagged.get(k);
}
function acKeepStructure(K, pages, entries, ctx) {
  const { loaded, refs } = ctx.sources, groups = [];
  entries.forEach((e, n) => {
    const src = loaded[e.src], sref = refs[e.src][e.i], p = pages[n];
    if (!acSrcTagged(K.L, ctx, e.src)) return;
    if (src === K.out && sref.tag === p.ref.tag) return; // the page itself, with its tags in place
    let g = groups.find((x) => x.src === e.src && !x.pages.has(sref.tag));
    if (!g) { g = { src: e.src, pages: new Map(), pairs: [] }; groups.push(g); }
    g.pages.set(sref.tag, p.ref); g.pairs.push([sref, p]);
  });
  const parts = [];
  for (const g of groups) {
    const S = acK(K.L, loaded[g.src]), maps = { pages: g.pages, annots: new Map(), memo: new Map() };
    for (const [sref, p] of g.pairs) { const sp = S.dict(sref); if (sp) acAnnotMap(K, S, sp, p.node, maps.annots); }
    const tops = acCopyTree(K, S, maps);
    if (tops.length) parts.push(tops);
  }
  acPrune(K, new Set(pages.map((p) => p.ref.tag)));
  if (!parts.length) return;
  const box = acContainer(K);
  for (const tops of parts) {
    const part = acNewElem(K, 'Part', box.ref);
    acSetKids(K, K.dict(part), tops); for (const t of tops) K.dict(t).set(K.N('P'), part);
    acAppend(K, box, part);
  }
}
// The ParentTree, built again from the tree: each page's MCIDs and each tagged annotation.
function acRebuildParentTree(K) {
  const r = acRoot(K); if (!r) return;
  const byPage = new Map(), byStm = new Map(), objs = [], ids = [];
  const put = (m, tag, mcid, er) => { let a = m.get(tag); if (!a) m.set(tag, a = []); if (Number.isInteger(mcid) && mcid >= 0 && mcid < 100000) a[mcid] = er; };
  acWalk(K, (er, e, pr, pe, page) => {
    const id = e.get(K.N('ID')); if (id) ids.push([id, er]);
    for (const it of acItems(K, e, page)) {
      if (it.kind === 'obj') { if (it.obj instanceof K.PDFRef) objs.push([it.obj, er]); continue; }
      if (it.stm instanceof K.PDFRef) put(byStm, it.stm.tag, it.mcid, er);
      else if (it.page) put(byPage, it.page.tag, it.mcid, er);
    }
  });
  let key = 0; const nums = [];
  const arrOf = (a) => K.c.register(K.c.obj(Array.from({ length: a.length }, (_, i) => a[i] || K.PDFNull)));
  for (const p of K.out.getPages()) {
    const a = byPage.get(p.ref.tag);
    if (!a || !a.length) { p.node.delete(K.N('StructParents')); continue; }
    p.node.set(K.N('StructParents'), K.PDFNumber.of(key)); nums.push(K.PDFNumber.of(key), arrOf(a)); key++;
  }
  for (const [tag, a] of byStm) {
    const st = [...K.c.enumerateIndirectObjects()].find(([ref]) => ref.tag === tag);
    if (!st || !st[1].dict) continue;
    st[1].dict.set(K.N('StructParents'), K.PDFNumber.of(key)); nums.push(K.PDFNumber.of(key), arrOf(a)); key++;
  }
  const tagged = new Set();
  for (const [obj, er] of objs) {
    const a = K.dict(obj); if (!a || tagged.has(obj.tag)) continue; tagged.add(obj.tag);
    a.set(K.N('StructParent'), K.PDFNumber.of(key)); nums.push(K.PDFNumber.of(key), er); key++;
  }
  for (const p of K.out.getPages()) {
    const an = K.look(p.node.get(K.N('Annots')));
    if (an instanceof K.PDFArray) for (const ref of an.asArray()) { const d = K.dict(ref); if (d && ref instanceof K.PDFRef && !tagged.has(ref.tag)) d.delete(K.N('StructParent')); }
  }
  const pt = K.c.obj({}); pt.set(K.N('Nums'), K.c.obj(nums));
  r.root.set(K.N('ParentTree'), K.c.register(pt));
  r.root.set(K.N('ParentTreeNextKey'), K.PDFNumber.of(key));
  if (r.root.get(K.N('IDTree'))) {
    if (!ids.length) r.root.delete(K.N('IDTree'));
    else {
      const s = (x) => { const o = K.look(x); return o && o.asString ? o.asString() : String(o); };
      ids.sort((a, b) => (s(a[0]) < s(b[0]) ? -1 : 1));
      const names = K.c.obj([]); for (const [id, er] of ids) { names.push(id); names.push(er); }
      r.root.set(K.N('IDTree'), K.c.register(K.c.obj({ Names: names })));
    }
  }
}

/* ---- what the app draws on a tagged page ---- */
const acMarkRole = (m) => m.type === 'text' || m.type === 'tpara' ? 'P' : m.type === 'pic' ? (m.deco ? 'Artifact' : 'Figure') : 'Artifact';
function acNextMcid(K, ctx, p) {
  ctx.acMc ||= new Map();
  if (!ctx.acMc.has(p.ref.tag)) {
    let max = -1;
    for (const r of acContents(K, p.node)) { const st = K.look(r); if (!st || st === p.contentStream) continue; for (const m of acText(K, st).matchAll(/\/MCID\s+(\d+)/g)) max = Math.max(max, +m[1]); }
    ctx.acMc.set(p.ref.tag, max + 1);
  }
  const n = ctx.acMc.get(p.ref.tag); ctx.acMc.set(p.ref.tag, n + 1); return n;
}
function acWrapOps(K, ctx, p, ops, ranges) {
  const O = (name, args) => K.PDFOperator.of(name, args);
  ranges.sort((a, b) => b.from - a.from);
  const made = [];
  for (const r of ranges) {
    if (r.role === 'Artifact') { ops.splice(r.to, 0, O('EMC', [])); ops.splice(r.from, 0, O('BMC', [K.N('Artifact')])); continue; }
    const mcid = acNextMcid(K, ctx, p);
    ops.splice(r.to, 0, O('EMC', [])); ops.splice(r.from, 0, O('BDC', [K.N(r.role), K.c.obj({ MCID: mcid })]));
    made.push({ pg: p.ref, role: r.role, mcid, alt: r.alt || '', box: r.box || null });
  }
  return made.reverse();
}
// Right after the marks are drawn (before redaction rewrites the page): each mark's drawing is tagged.
async function acEarly({ L, out, p, entry, ctx }) {
  if (!(acSrcTagged(L, ctx, entry.src) || acMark('autotag'))) return;
  const K = acK(L, out), cs = p.contentStream; if (!cs) return;
  const ops = cs.operators, recs = ctx.markOps.filter((r) => r.p === p && r.b && r.b.cs === cs);
  const ranges = recs.map((r) => ({ m: r.m, from: r.a && r.a.cs === cs ? r.a.n : 0, to: r.b.n })).filter((x) => x.to > x.from)
    .map((x) => ({ ...x, role: acMarkRole(x.m), alt: x.m.alt, box: x.m.type === 'pic' && x.m.mat ? quadBox(matQuad(x.m.mat)) : null }));
  // What Edit PDF painted before the marks (replaced text and pictures, covered areas): text is content, the rest decoration.
  const first = ranges.length ? Math.min(...ranges.map((r) => r.from)) : ops.length;
  let depth = 0, start = 0;
  for (let i = 0; i < first; i++) {
    const o = ops[i].name;
    if (o === 'q') { if (depth++ === 0) start = i; continue; }
    if (o === 'Q') { if (--depth === 0) ranges.push({ from: start, to: i + 1, role: ops.slice(start, i).some((x) => AC_SHOW.has(x.name)) ? 'P' : 'Artifact' }); if (depth < 0) depth = 0; continue; }
    if (depth === 0) ranges.push({ from: i, to: i + 1, role: AC_SHOW.has(o) ? 'P' : 'Artifact' });
  }
  (ctx.acPending ||= []).push(...acWrapOps(K, ctx, p, ops, ranges.filter((r) => r.to > r.from)));
  (ctx.acSeen ||= new Map()).set(p.ref.tag, { cs, n: ops.length });
}
// After every other hook (redaction boxes, headers and footers): what is still unmarked on a tagged page is decoration.
async function acLate({ L, out, p, entry, ctx }) {
  if (!acSrcTagged(L, ctx, entry.src)) return;
  const K = acK(L, out), cs = p.contentStream; if (!cs) return;
  const seen = ctx.acSeen && ctx.acSeen.get(p.ref.tag), from = seen && seen.cs === cs ? seen.n : 0, ops = cs.operators;
  if (from >= ops.length) return;
  const scan = acScanOps(K, ops);
  const groups = acGroups(scan, (u) => (u.from >= from ? 'Artifact' : null));
  acWrapOps(K, ctx, p, ops, groups.map((g) => ({ from: g.from, to: g.to + 1, role: 'Artifact' })));
}
// Elements for added text and pictures, after what was already on their page.
function acApplyPending(K, ctx, skip) {
  const ins = acInserter(K);
  for (const it of ctx.acPending || []) {
    if (skip && skip.has(it.pg.tag)) continue;
    const ref = acNewElem(K, it.role, null, { Pg: it.pg, K: K.PDFNumber.of(it.mcid), ...(it.role === 'Figure' ? acFigureAttrs(K, it.alt, it.box) : {}) });
    ins.add(it.pg, ref);
  }
  ins.flush();
}
function acFigureAttrs(K, alt, box) {
  return { ...(alt ? { Alt: K.PDFHexString.fromText(alt) } : {}), ...(box ? { A: K.c.obj({ O: 'Layout', BBox: box.map(ac2) }) } : {}) };
}
// Comments, links and form fields of a tagged PDF that have no tag: Annot, Link and Form elements.
function acTagAnnots(K, pages, place) {
  const done = new Set(), ins = acInserter(K);
  acWalk(K, (er, e, pr, pe, page) => { for (const it of acItems(K, e, page)) if (it.kind === 'obj' && it.obj instanceof K.PDFRef) done.add(it.obj.tag); });
  for (const p of pages) {
    const an = K.look(p.node.get(K.N('Annots'))); if (!(an instanceof K.PDFArray)) continue;
    let any = false;
    for (const ref of an.asArray()) {
      const d = K.dict(ref); if (!d || !(ref instanceof K.PDFRef) || done.has(ref.tag)) continue;
      const sub = K.name(d.get(K.N('Subtype'))), f = K.num(d.get(K.N('F'))) || 0;
      if (sub === 'Popup' || f & 2) continue;
      any = true; done.add(ref.tag);
      const S = sub === 'Link' ? 'Link' : sub === 'Widget' ? 'Form' : 'Annot';
      if (S === 'Link' && !K.str(d.get(K.N('Contents')))) {
        const a = K.dict(d.get(K.N('A'))), uri = a && (K.str(a.get(K.N('URI'))) || (K.look(a.get(K.N('URI'))) || {}).value);
        d.set(K.N('Contents'), K.PDFHexString.fromText(uri ? `Link to ${uri}` : 'Link'));
      }
      const alt = S === 'Form' ? K.str(d.get(K.N('TU'))) || K.str(K.dict(d.get(K.N('Parent')))?.get(K.N('TU'))) : K.str(d.get(K.N('Contents')));
      const elem = acNewElem(K, S, null, { Pg: p.ref, K: K.c.obj([K.c.obj({ Type: 'OBJR', Obj: ref, Pg: p.ref })]), ...(alt && S !== 'Link' ? { Alt: K.PDFHexString.fromText(alt) } : {}) });
      if (!(place && place(p, d, elem))) ins.add(p.ref, elem);
    }
    if (any || an.size()) p.node.set(K.N('Tabs'), K.N('S'));
  }
  ins.flush();
}

/* ---- auto-tagging: the plan (made with pdf.js when the command runs, or when saving for pages added since) ---- */
const AC_BULLET = /^\s*(?:[•●▪◦‣∙·○■□➢►–—*-]|\(?(?:\d{1,3}|[a-zA-Z]|[ivxIVX]{1,4})[.)])\s+\S/;
const AC_PAGENUM = /^(?:page\s*)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$|^[-–]\s*\d{1,4}\s*[-–]$/i;
const acNorm = (s) => s.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
async function acPageInfo(entry) {
  const page = await pageOf(entry), cm = await contentMap(page), lines = [];
  const bold = new Map();
  for (const L0 of cm.lines) {
    if (!bold.has(L0.fontName)) { const f = await Promise.race([fontObj(page, L0.fontName), new Promise((r) => setTimeout(() => r(null), 400))]); bold.set(L0.fontName, !!f && !!(f.bold || f.black || /bold|black|heavy|semibold|demi/i.test(f.name || ''))); }
    const b = quadBox(L0.quad).map(ac2);
    lines.push([...b, L0.str, ac2(lineFrame(L0).size), bold.get(L0.fontName) ? 1 : 0]);
  }
  return { lines, images: cm.images.map((im) => ({ box: quadBox(im.quad).map(ac2), raw: im.raw })), view: page.view, cm, page };
}
function acStatsOf(infos) {
  const w = new Map(), heads = new Map(), zones = new Map();
  for (const info of infos) {
    const H = info.view[3] - info.view[1], seen = new Set();
    for (const l of info.lines) { const s = Math.round(l[5] * 2) / 2; w.set(s, (w.get(s) || 0) + l[4].length); }
    for (const l of info.lines) {
      const cy = (l[1] + l[3]) / 2, z = cy > info.view[3] - H * .08 ? 'Header' : cy < info.view[1] + H * .08 ? 'Footer' : null;
      if (!z) continue; const k = z + ':' + acNorm(l[4]); if (seen.has(k)) continue; seen.add(k); zones.set(k, (zones.get(k) || 0) + 1);
    }
  }
  const body = [...w].sort((a, b) => b[1] - a[1])[0]?.[0] || 12;
  for (const info of infos) for (const l of info.lines) { const s = Math.round(l[5] * 2) / 2; if (s >= body * 1.15 && l[4].length <= 200) heads.set(s, (heads.get(s) || 0) + 1); }
  const levels = [...heads.keys()].sort((a, b) => b - a).slice(0, 3);
  const repeat = [...zones].filter(([, n]) => n >= 2 && n >= Math.min(3, infos.length * .3)).map(([k]) => k);
  return { body, levels, repeat };
}
let acBlockN = 0;
const acBid = () => 'b' + (++acBlockN).toString(36) + uid().slice(0, 4);
function acBlocksOf(info, stats) {
  const H = info.view[3] - info.view[1], repeat = new Set(stats.repeat || []);
  const level = (l) => { const s = Math.round(l[5] * 2) / 2; if (s < stats.body * 1.15) return 0; const k = stats.levels.indexOf(s); return k < 0 ? 3 : k + 1; };
  const top = (b) => Math.max(...acBlockLines(b).map((l) => l[3]));
  const blocks = []; let cur = null, last = null;
  const sameLine = (a, b) => Math.abs((a[1] + a[3]) / 2 - (b[1] + b[3]) / 2) < Math.min(a[5], b[5]) * .35 && b[0] >= a[0];
  const near = (a, b) => { const gap = a[1] - b[3], sz = Math.max(a[5], b[5]); return gap > -sz * .6 && gap < sz * .95 && b[0] > a[0] - sz * 3 && b[0] < a[0] + sz * 6; };
  for (const l of info.lines) {
    const cy = (l[1] + l[3]) / 2, zone = cy > info.view[3] - H * .08 ? 'Header' : cy < info.view[1] + H * .08 ? 'Footer' : null;
    if (zone && (repeat.has(zone + ':' + acNorm(l[4])) || AC_PAGENUM.test(l[4].trim()))) { blocks.push({ id: acBid(), role: 'Artifact', sub: zone, lines: [l] }); cur = null; last = l; continue; }
    if (cur && last && sameLine(last, l)) { (cur.role === 'L' ? cur.items[cur.items.length - 1] : cur.lines).push(l); last = l; continue; }
    if (AC_BULLET.test(l[4]) && !level(l)) {
      if (cur && cur.role === 'L' && last && l[1] < last[3] && last[1] - l[3] < l[5] * 1.2) cur.items.push([l]);
      else { cur = { id: acBid(), role: 'L', items: [[l]] }; blocks.push(cur); }
      last = l; continue;
    }
    if (cur && cur.role === 'L' && last && near(last, l) && l[0] > cur.items[cur.items.length - 1][0][0] + 1) { cur.items[cur.items.length - 1].push(l); last = l; continue; }
    const lv = level(l), role = lv ? 'H' + lv : 'P';
    if (cur && cur.role === role && last && near(last, l) && Math.abs(last[5] - l[5]) < l[5] * .08) { cur.lines.push(l); last = l; continue; }
    cur = { id: acBid(), role, lines: [l] }; blocks.push(cur); last = l;
  }
  // A short line on its own in bold, between paragraphs, is a heading one level below the largest ones.
  const sub = Math.min(3, stats.levels.length + 1);
  blocks.forEach((b, k) => {
    if (b.role !== 'P' || b.lines.length > 2 || !b.lines.every((l) => l[6])) return;
    const t = b.lines.map((l) => l[4]).join(' ');
    if (t.length > 70 || /[.,;:!?]$/.test(t.trim())) return;
    const next = blocks[k + 1]; if (next && next.role === 'P' && next.lines.every((l) => l[6])) return;
    b.role = 'H' + sub;
  });
  // Tables, when the table finder is there (88-insight.js): their lines become cells.
  if (typeof insightTables === 'function') {
    let tables = []; try { tables = insightTables(info) || []; } catch (e) { console.warn('tables', e); }
    for (const t of tables) {
      if (!t || !t.box || !Array.isArray(t.rows)) continue;
      const inT = (l) => { const x = (l[0] + l[2]) / 2, y = (l[1] + l[3]) / 2; return x >= t.box[0] && x <= t.box[2] && y >= t.box[1] && y <= t.box[3]; };
      let at = -1;
      const rows = t.rows.map((r) => r.map((c) => ({ th: !!(c.header || c.th), box: c.box, lines: [] })));
      for (let k = 0; k < blocks.length; k++) {
        const b = blocks[k]; if (b.role === 'Artifact' || b.role === 'Figure') continue;
        const keep = [];
        const lists = b.role === 'L' ? b.items : [b.lines];
        for (const list of lists) for (const l of list) {
          if (!inT(l)) { keep.push(l); continue; }
          if (at < 0) at = k;
          const x = (l[0] + l[2]) / 2, y = (l[1] + l[3]) / 2;
          const cell = rows.flat().find((c) => c.box && x >= c.box[0] - 1 && x <= c.box[2] + 1 && y >= c.box[1] - 1 && y <= c.box[3] + 1);
          if (cell) cell.lines.push(l); else keep.push(l);
        }
        if (b.role === 'L') b.items = b.items.map((list) => list.filter((l) => keep.includes(l))).filter((x) => x.length); else b.lines = keep;
      }
      for (let k = blocks.length - 1; k >= 0; k--) if (!acBlockLines(blocks[k]).length) { blocks.splice(k, 1); if (at > k) at--; }
      blocks.splice(at < 0 ? blocks.length : at, 0, { id: acBid(), role: 'Table', box: t.box.map(ac2), rows });
    }
  }
  // Pictures, in their place from the top of the page.
  for (const im of info.images) {
    const b = { id: acBid(), role: 'Figure', box: im.box, raw: im.raw, lines: [] }, t = im.box[3];
    const k = blocks.findIndex((x) => x.role !== 'Artifact' && acBlockLines(x).length && top(x) < t - 1);
    blocks.splice(k < 0 ? blocks.length : k, 0, b);
  }
  return blocks;
}
const acBlockLines = (b) => b.role === 'L' ? (b.items || []).flat() : b.role === 'Table' ? (b.rows || []).flat().flatMap((c) => c.lines) : (b.lines || []);
const acBlockText = (b) => acBlockLines(b).map((l) => l[4]).join(' ').replace(/\s+/g, ' ').trim();
const acBlockBox = (b) => { const ls = acBlockLines(b); if (!ls.length) return b.box || null; return [Math.min(...ls.map((l) => l[0])), Math.min(...ls.map((l) => l[1])), Math.max(...ls.map((l) => l[2])), Math.max(...ls.map((l) => l[3]))]; };
async function acPlan(list) {
  const infos = []; for (const e of list) infos.push(await acPageInfo(e));
  const stats = acStatsOf(infos), pages = {};
  list.forEach((e, k) => { pages[pageKey(e)] = acBlocksOf(infos[k], stats); });
  return { stats, pages };
}
async function acBlocksFor(m, entry) {
  const key = pageKey(entry);
  if (m.pages && m.pages[key]) return m.pages[key];
  return acBlocksOf(await acPageInfo(entry), m.stats || { body: 12, levels: [], repeat: [] });
}

/* ---- auto-tagging: applied when saving ---- */
async function acApplyAutotag(K, m, pages, entries, ctx) {
  const box = acContainer(K), alt = acMark('acalt'), done = new Set();
  for (let n = 0; n < pages.length; n++) {
    const p = pages[n], e = entries[n], node = p.node, blocks = await acBlocksFor(m, e);
    const src = acSrcOf(K, node), scan = acScan(src), geo = acGeometry(K, node, src);
    const altFor = (b) => alt && (alt.items || []).find((it) => it.key === pageKey(e) && acSameBox(it.box, b.box));
    // Each line of the plan, with the element its text goes in.
    const lines = [];
    blocks.forEach((b) => {
      if (b.role === 'L') b.items.forEach((list, i) => list.forEach((l) => lines.push({ t: `${b.id}/${i}`, l })));
      else if (b.role === 'Table') b.rows.forEach((r, i) => r.forEach((c, j) => c.lines.forEach((l) => lines.push({ t: `${b.id}/${i}/${j}`, l }))));
      else (b.lines || []).forEach((l) => lines.push({ t: b.role === 'Artifact' ? 'A:' + (b.sub || '') : b.id, l }));
    });
    const textTarget = (o) => {
      let best = null, area = Infinity;
      for (const x of lines) { const [x0, y0, x1, y1] = x.l, h = y1 - y0; if (o[0] >= x0 - 2 && o[0] <= x1 + 1 && o[1] >= y0 - h * .3 && o[1] <= y1 + h * .3) { const a = (x1 - x0) * h; if (a < area) { area = a; best = x.t; } } }
      if (best) return best;
      let d = Infinity;
      for (const x of lines) { const [x0, y0, x1, y1] = x.l, dx = Math.max(x0 - o[0], 0, o[0] - x1), dy = Math.max(y0 - o[1], 0, o[1] - y1), dd = Math.hypot(dx, dy); if (dd < d && dd < (y1 - y0) * 2) { d = dd; best = x.t; } }
      return best || 'extra';
    };
    const figs = blocks.filter((b) => b.role === 'Figure'), usedFig = new Set();
    const target = (u) => {
      const k = geo.kindOf(u);
      if (k === 'text') { const sh = geo.shows.get(u.start); return sh ? textTarget(sh.origin) : 'extra'; }
      if (k === 'image' || k === 'inline') {
        const bx = geo.boxOf(u), f = figs.find((b) => !usedFig.has(b.id) && acSameBox(b.box, bx));
        if (!f) return 'A:'; usedFig.add(f.id); const a = altFor(f); return a && a.deco ? 'A:' : f.id;
      }
      if (k === 'form') {
        const bx = geo.boxOf(u); if (!bx) return 'A:';
        const f = figs.find((b) => !usedFig.has(b.id) && acSameBox(b.box, bx)); if (f) { usedFig.add(f.id); return f.id; }
        const x = lines.find(({ l }) => { const cx = (l[0] + l[2]) / 2, cy = (l[1] + l[3]) / 2; return cx >= bx[0] && cx <= bx[2] && cy >= bx[1] && cy <= bx[3]; });
        return x ? x.t : 'A:';
      }
      return 'A:';
    };
    // A list item's label (the bullet or number), when it is drawn on its own.
    const targets = new Map();
    for (const u of scan.units) if (!u.covered) targets.set(u, target(u));
    const byItem = new Map();
    for (const u of scan.units) { const t = targets.get(u); if (t && /^b[^/]*\/\d+$/.test(t) && u.kind === 'text') { if (!byItem.has(t)) byItem.set(t, []); byItem.get(t).push(u); } }
    for (const [t, us] of byItem) {
      if (us.length < 2) continue; const a = geo.shows.get(us[0].start), b = geo.shows.get(us[1].start);
      if (a && b && b.origin[0] > a.origin[0] + 2 && a.strings.join('').length <= 4) targets.set(us[0], t + '/lbl');
    }
    const groups = acGroups(scan, (u) => targets.get(u) || null);
    let next = scan.maxMcid + 1;
    const mcids = new Map(), wraps = [];
    for (const g of groups) {
      if (g.t.startsWith('A:')) { wraps.push({ start: g.start, end: g.end, open: acOpenTag('Artifact', 0, g.t.slice(2)), close: '\nEMC\n' }); continue; }
      const role = g.t.endsWith('/lbl') ? 'Lbl' : 'P', mcid = next++;
      wraps.push({ start: g.start, end: g.end, open: acOpenTag(role === 'Lbl' ? 'Lbl' : acRoleFor(blocks, g.t), mcid), close: '\nEMC\n' });
      if (!mcids.has(g.t)) mcids.set(g.t, []); mcids.get(g.t).push(mcid);
    }
    if (wraps.length) acSetSrc(K, node, acInsert(src, wraps));
    // The elements, in the plan's order.
    const mk = (S, parentRef, ids, extra) => acNewElem(K, S, parentRef, { Pg: p.ref, ...(ids ? { K: K.c.obj(ids.map((x) => K.PDFNumber.of(x))) } : {}), ...(extra || {}) });
    const pageElems = [];
    for (const b of blocks) {
      if (b.role === 'Artifact') continue;
      if (b.role === 'L') {
        const items = b.items.map((_, i) => i).filter((i) => mcids.has(`${b.id}/${i}`) || mcids.has(`${b.id}/${i}/lbl`)); if (!items.length) continue;
        const Lr = mk('L', box.ref), lis = [];
        for (const i of items) {
          const li = mk('LI', Lr), kids = [];
          if (mcids.has(`${b.id}/${i}/lbl`)) kids.push(mk('Lbl', li, mcids.get(`${b.id}/${i}/lbl`)));
          if (mcids.has(`${b.id}/${i}`)) kids.push(mk('LBody', li, mcids.get(`${b.id}/${i}`)));
          acSetKids(K, K.dict(li), kids); lis.push(li);
        }
        acSetKids(K, K.dict(Lr), lis); pageElems.push({ ref: Lr, b }); continue;
      }
      if (b.role === 'Table') {
        const T = mk('Table', box.ref), trs = [];
        b.rows.forEach((r, i) => {
          const tr = mk('TR', T), cells = r.map((c, j) => mk(c.th ? 'TH' : 'TD', tr, mcids.get(`${b.id}/${i}/${j}`) || null, c.th ? { A: K.c.obj({ O: 'Table', Scope: 'Column' }) } : null));
          acSetKids(K, K.dict(tr), cells); trs.push(tr);
        });
        if (![...mcids.keys()].some((t) => t.startsWith(b.id + '/'))) continue;
        acSetKids(K, K.dict(T), trs); pageElems.push({ ref: T, b }); continue;
      }
      const ids = mcids.get(b.id); if (!ids) continue;
      const a = b.role === 'Figure' ? altFor(b) : null;
      pageElems.push({ ref: mk(b.role, box.ref, ids, b.role === 'Figure' ? acFigureAttrs(K, (a && a.alt) || b.alt || '', b.box) : null), b });
    }
    if (mcids.has('extra')) pageElems.push({ ref: mk('P', box.ref, mcids.get('extra')), b: null });
    // Links in the paragraph they are on; added text and pictures after the page's content.
    const an = K.look(node.get(K.N('Annots')));
    if (an instanceof K.PDFArray) for (const ref of an.asArray()) {
      const d = K.dict(ref); if (!d || K.name(d.get(K.N('Subtype'))) !== 'Link' || !(ref instanceof K.PDFRef)) continue;
      const rc = K.nums(d.get(K.N('Rect'))); if (!rc) continue;
      const cx = (rc[0] + rc[2]) / 2, cy = (rc[1] + rc[3]) / 2;
      const host = pageElems.find(({ b }) => b && acBlockLines(b).some((l) => cx >= l[0] - 1 && cx <= l[2] + 1 && cy >= l[1] - 2 && cy <= l[3] + 2));
      if (!K.str(d.get(K.N('Contents')))) { const a = K.dict(d.get(K.N('A'))), uri = a && (K.str(a.get(K.N('URI'))) || ''); d.set(K.N('Contents'), K.PDFHexString.fromText(uri ? `Link to ${uri}` : 'Link')); }
      const link = acNewElem(K, 'Link', host ? host.ref : box.ref, { Pg: p.ref, K: K.c.obj([K.c.obj({ Type: 'OBJR', Obj: ref, Pg: p.ref })]) });
      if (host) { const list = acKids(K, K.dict(host.ref)); list.push(link); acSetKids(K, K.dict(host.ref), list); } else pageElems.push({ ref: link, b: null });
    }
    for (const it of (ctx.acPending || []).filter((x) => x.pg.tag === p.ref.tag)) pageElems.push({ ref: mk(it.role, box.ref, [it.mcid], it.role === 'Figure' ? acFigureAttrs(K, it.alt, it.box) : null), b: null });
    const kids = acKids(K, box.dict); kids.push(...pageElems.map((x) => x.ref)); acSetKids(K, box.dict, kids);
    p.node.set(K.N('Tabs'), K.N('S'));
    done.add(p.ref.tag);
  }
  K.cat.set(K.N('MarkInfo'), K.c.obj({ Marked: true }));
  const r = acRoot(K, true); if (!r.root.get(K.N('RoleMap'))) r.root.set(K.N('RoleMap'), K.c.obj({}));
  return done;
}
const acRoleFor = (blocks, t) => { const id = t.split('/')[0], b = blocks.find((x) => x.id === id); if (!b) return 'P'; return b.role === 'L' ? 'LBody' : b.role === 'Table' ? (b.rows[+t.split('/')[1]][+t.split('/')[2]].th ? 'TH' : 'TD') : b.role; };

/* ---- alt text, when saving ---- */
function acApplyAlt(K, m, pages, entries, skip) {
  const place = acInserter(K);
  for (let n = 0; n < pages.length; n++) {
    const p = pages[n], key = pageKey(entries[n]);
    if (skip && skip.has(p.ref.tag)) continue;
    const items = (m.items || []).filter((it) => it.key === key && it.box); if (!items.length) continue;
    const node = p.node, src = acSrcOf(K, node), scan = acScan(src), geo = acGeometry(K, node, src);
    const pics = scan.units.filter((u) => ['image', 'inline'].includes(geo.kindOf(u)));
    const wraps = [], used = new Set(), owners = acOwners(K, p.ref);
    let next = null;
    const elems = [];
    for (const it of items) {
      const u = pics.find((x) => !used.has(x) && acSameBox(geo.boxOf(x), it.box)); if (!u) continue; used.add(u);
      if (u.covered && u.mc && u.mc.mcid != null) {
        const er = owners.get(u.mc.mcid), e = er && K.dict(er);
        if (!e) continue;
        if (it.deco) { wraps.push({ start: u.mc.start, end: u.mc.openEnd, replace: '/Artifact BMC\n' }); acDropMcid(K, e, p.ref, u.mc.mcid); acDropEmpty(K, er); continue; }
        if (it.alt) e.set(K.N('Alt'), K.PDFHexString.fromText(it.alt));
        continue;
      }
      if (u.covered) continue; // already decoration
      if (it.deco) { wraps.push({ start: u.start, end: u.end, open: '/Artifact BMC\n', close: '\nEMC\n' }); continue; }
      if (next == null) next = scan.maxMcid + 1;
      const mcid = next++;
      wraps.push({ start: u.start, end: u.end, open: `/Figure <</MCID ${mcid}>> BDC\n`, close: '\nEMC\n' });
      elems.push(acNewElem(K, 'Figure', null, { Pg: p.ref, K: K.PDFNumber.of(mcid), ...acFigureAttrs(K, it.alt, it.box) }));
    }
    if (!wraps.length) continue;
    let s = src;
    const repl = wraps.filter((w) => w.replace).sort((a, b) => b.start - a.start);
    const ins = wraps.filter((w) => !w.replace);
    // replacements and insertions never overlap (a covered picture is not wrapped again)
    const all = [...repl.map((w) => ({ at: w.start, del: w.end - w.start, t: w.replace })), ...ins.flatMap((w) => [{ at: w.end, del: 0, t: w.close, o: 0 }, { at: w.start, del: 0, t: w.open, o: 1 }])];
    all.sort((a, b) => b.at - a.at || (a.o ?? 0) - (b.o ?? 0));
    for (const x of all) s = s.slice(0, x.at) + x.t + s.slice(x.at + x.del);
    acSetSrc(K, node, s);
    for (const ref of elems) place.add(p.ref, ref);
  }
  place.flush();
  // Pictures already tagged in the PDF, named by their element.
  for (const it of (m.items || []).filter((x) => x.ref && !x.deco && doc.sources.length && acBaseIsSource0(K))) {
    const e = K.dict(K.PDFRef.of(it.ref[0], it.ref[1])); if (!acIsElem(K, e)) continue;
    if (it.alt) e.set(K.N('Alt'), K.PDFHexString.fromText(it.alt));
  }
}
const acBaseIsSource0 = (K) => !!(K.ctx0 && K.ctx0 === K.out);
// Which element owns each MCID of a page.
function acOwners(K, pageRef) {
  const m = new Map();
  acWalk(K, (er, e, pr, pe, page) => { for (const it of acItems(K, e, page)) if (it.kind === 'mc' && !it.stm && it.page && it.page.tag === pageRef.tag) m.set(it.mcid, er); });
  return m;
}
function acDropMcid(K, e, pageRef, mcid) {
  const own = e.get(K.N('Pg'));
  acSetKids(K, e, acKids(K, e).filter((kid) => {
    const o = K.look(kid);
    if (o instanceof K.PDFNumber) return !(o.asNumber() === mcid && own instanceof K.PDFRef && own.tag === pageRef.tag);
    if (o instanceof K.PDFDict && K.name(o.get(K.N('Type'))) === 'MCR') { const pg = o.get(K.N('Pg')) || own; return !(K.num(o.get(K.N('MCID'))) === mcid && pg && pg.tag === pageRef.tag); }
    return true;
  }));
}

/* ---- reading order and tag type changes on the PDF's own tags ---- */
// ops: { op: 'move', ref, before } or { op: 'move', ref, after } (a sibling's ref; the panel moves an element to the end
// of its page with after: the parent can hold every page's elements) | { op: 'retag', ref, S } |
// { op: 'merge', ref, next } | { op: 'split', ref }. Refs are [num, gen] of the opened file's objects.
function acParentOf(K, ref) {
  let found = null;
  const r = acRoot(K); if (!r) return null;
  if (acKids(K, r.root).some((k) => k instanceof K.PDFRef && k.tag === ref.tag)) return { ref: r.ref, dict: r.root };
  acWalk(K, (er, e) => { if (found) return false; if (acKids(K, e).some((k) => k instanceof K.PDFRef && k.tag === ref.tag)) found = { ref: er, dict: e }; });
  return found;
}
function acTagOps(K, ops, artifacts) {
  const R = (x) => K.PDFRef.of(x[0], x[1] || 0);
  for (const op of ops || []) {
    try {
      const ref = R(op.ref), e = K.dict(ref); if (!acIsElem(K, e)) continue;
      const par = acParentOf(K, ref); if (!par) continue;
      const list = acKids(K, par.dict), k = list.findIndex((x) => x instanceof K.PDFRef && x.tag === ref.tag);
      if (op.op === 'retag') {
        if (op.S !== 'Artifact') { e.set(K.N('S'), K.N(op.S)); continue; }
        // Decoration: its content is marked as an artifact, and it leaves the tree.
        const items = []; const collect = (x, pg) => { for (const it of acItems(K, x, pg)) items.push(it); for (const kid of acKids(K, x)) { const d = K.dict(kid); if (kid instanceof K.PDFRef && acIsElem(K, d)) { const o = d.get(K.N('Pg')); collect(d, o instanceof K.PDFRef ? o : pg); } } };
        const own = e.get(K.N('Pg')); collect(e, own instanceof K.PDFRef ? own : null);
        if (artifacts) for (const it of items) if (it.kind === 'mc' && it.page && !it.stm) { if (!artifacts.has(it.page.tag)) artifacts.set(it.page.tag, new Set()); artifacts.get(it.page.tag).add(it.mcid); }
        list.splice(k, 1); acSetKids(K, par.dict, list); continue;
      }
      if (op.op === 'move') {
        list.splice(k, 1);
        const find = (x) => list.findIndex((y) => y instanceof K.PDFRef && y.tag === R(x).tag);
        let at = op.before ? find(op.before) : -1;
        if (op.after) { at = find(op.after); if (at >= 0) at++; }
        list.splice(at < 0 ? list.length : at, 0, ref); acSetKids(K, par.dict, list); continue;
      }
      if (op.op === 'merge') {
        const nref = R(op.next), ne = K.dict(nref); if (!acIsElem(K, ne)) continue;
        const npar = acParentOf(K, nref); if (!npar) continue;
        const pgA = e.get(K.N('Pg')), pgB = ne.get(K.N('Pg'));
        const moved = acKids(K, ne).map((kid) => {
          const o = K.look(kid);
          if (o instanceof K.PDFNumber && pgB instanceof K.PDFRef && !(pgA instanceof K.PDFRef && pgA.tag === pgB.tag)) return K.c.obj({ Type: 'MCR', Pg: pgB, MCID: o.asNumber() });
          if (kid instanceof K.PDFRef && acIsElem(K, K.dict(kid))) K.dict(kid).set(K.N('P'), ref);
          return kid;
        });
        if (!(pgA instanceof K.PDFRef) && pgB instanceof K.PDFRef) {
          // numbers under the first element stay on its pages; it takes the second's page for what it gets
          e.set(K.N('Pg'), pgB);
        }
        acSetKids(K, e, [...acKids(K, e), ...moved]);
        const nl = acKids(K, npar.dict).filter((x) => !(x instanceof K.PDFRef && x.tag === nref.tag)); acSetKids(K, npar.dict, nl);
        continue;
      }
      if (op.op === 'split') {
        const kids = acKids(K, e); if (kids.length < 2) continue;
        const parts = kids.map((kid) => {
          const d = K.c.obj({}); for (const [kk, v] of e.entries()) if (!['K', 'ID'].includes(kk.decodeText())) d.set(kk, v);
          d.set(K.N('K'), K.c.obj([kid])); const nr = K.c.register(d);
          if (kid instanceof K.PDFRef && acIsElem(K, K.dict(kid))) K.dict(kid).set(K.N('P'), nr);
          return nr;
        });
        list.splice(k, 1, ...parts); acSetKids(K, par.dict, list);
      }
    } catch (err) { console.warn('tag edit', err); }
  }
}
// The MCIDs of a page turned into decoration: their BDC becomes /Artifact BMC.
function acMcidsToArtifact(K, p, set) {
  const src = acSrcOf(K, p.node), scan = acScan(src), cut = [];
  for (const s of scan.seqs) if (s.mcid != null && set.has(s.mcid)) cut.push([s.start, s.openEnd]);
  if (!cut.length) return;
  cut.sort((a, b) => b[0] - a[0]); let out = src;
  for (const [a, b] of cut) out = out.slice(0, a) + '/Artifact BMC' + out.slice(b);
  acSetSrc(K, p.node, out);
}

/* ---- checker fixes and PDF/UA, when saving ---- */
function acApplyFixes(K, f, pages) {
  if (!f) return;
  const di = docMarks().find((m) => m.type === 'docinfo' && m.lang);
  if (f.lang && !di && !K.str(K.cat.get(K.N('Lang')))) K.cat.set(K.N('Lang'), K.PDFString.of(f.lang));
  if (f.title && !(K.out.getTitle() || '').trim()) K.out.setTitle(f.title);
  if (f.dtitle) {
    let vp = K.dict(K.cat.get(K.N('ViewerPreferences')));
    if (!vp) { vp = K.c.obj({}); K.cat.set(K.N('ViewerPreferences'), vp); }
    vp.set(K.N('DisplayDocTitle'), K.PDFBool.True);
  }
  if (f.marked && acRoot(K)) K.cat.set(K.N('MarkInfo'), K.c.obj({ Marked: true }));
  if (f.tabs) for (const p of pages) if (p.node.get(K.N('Annots'))) p.node.set(K.N('Tabs'), K.N('S'));
  if (f.annots && acRoot(K)) acTagAnnots(K, pages);
  if (f.artifacts && acRoot(K)) for (const p of pages) {
    const src = acSrcOf(K, p.node), scan = acScan(src);
    const groups = acGroups(scan, () => 'A');
    if (groups.length) acSetSrc(K, p.node, acInsert(src, groups.map((g) => ({ start: g.start, end: g.end, open: '/Artifact BMC\n', close: '\nEMC\n' }))));
  }
}
const acXmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Adds pdfuaid:part 1 (and dc:title, when missing) to the PDF's XMP, or writes a small XMP packet.
function acWriteUA(K, title) {
  const ref = K.cat.get(K.N('Metadata')), st = K.look(ref);
  let xmp = '';
  if (st && st.dict) { try { const b = st instanceof K.PDFRawStream ? K.decodePDFRawStream(st).decode() : st.getContents(); xmp = new TextDecoder().decode(b); } catch {} }
  const titleXml = `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${acXmlEsc(title)}</rdf:li></rdf:Alt></dc:title></rdf:Description>`;
  const ua = '<rdf:Description rdf:about="" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/"><pdfuaid:part>1</pdfuaid:part></rdf:Description>';
  if (!/<\/rdf:RDF>/.test(xmp)) {
    xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${titleXml}${ua}</rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>`;
  } else {
    if (/pdfuaid:part/.test(xmp)) xmp = xmp.replace(/<pdfuaid:part>[^<]*<\/pdfuaid:part>/, '<pdfuaid:part>1</pdfuaid:part>').replace(/pdfuaid:part="[^"]*"/, 'pdfuaid:part="1"');
    else xmp = xmp.replace(/<\/rdf:RDF>/, ua + '</rdf:RDF>');
    if (!/<dc:title/.test(xmp)) xmp = xmp.replace(/<\/rdf:RDF>/, titleXml + '</rdf:RDF>');
  }
  const bytes = new TextEncoder().encode(xmp);
  const ns = K.c.stream(bytes, { Type: 'Metadata', Subtype: 'XML', Length: bytes.length });
  K.cat.set(K.N('Metadata'), K.c.register(ns));
}

/* ---- the save hooks ---- */
FEATURE.savePage.unshift(async (a) => { try { await acEarly(a); } catch (e) { console.error('accessibility: tagging the marks failed', e); } });
FEATURE.savePageLate.push(async (a) => { try { await acLate(a); } catch (e) { console.error('accessibility: tagging the page failed', e); } });
FEATURE.saveDoc.push(async ({ L, out, pages, entries, ctx }) => {
  try {
    const K = acK(L, out); K.ctx0 = ctx.sources && ctx.sources.loaded[0];
    const anyTagged = entries.some((e) => acSrcTagged(L, ctx, e.src)), hadRoot = !!acRoot(K);
    if (anyTagged) acKeepStructure(K, pages, entries, ctx);
    // Tags copied into a file that had none (an extract, or tagged pages added to an untagged PDF): it is tagged now.
    if (anyTagged && !hadRoot && acRoot(K) && !K.dict(K.cat.get(K.N('MarkInfo')))) K.cat.set(K.N('MarkInfo'), K.c.obj({ Marked: true }));
    const ed = acMark('acorder');
    if (ed && acRoot(K) && acBaseIsSource0(K)) {
      const art = new Map(); acTagOps(K, ed.ops, art);
      for (const p of pages) if (art.has(p.ref.tag)) acMcidsToArtifact(K, p, art.get(p.ref.tag));
    }
    const at = acMark('autotag');
    let auto = null;
    if (at && !anyTagged) auto = await acApplyAutotag(K, at, pages, entries, ctx);
    const alt = acMark('acalt'); if (alt) acApplyAlt(K, alt, pages, entries, auto);
    if (anyTagged) acApplyPending(K, ctx, auto);
    if (anyTagged || auto) acTagAnnots(K, pages, null);
    acApplyFixes(K, acMark('a11yfix'), pages);
    // Pages in another order than in their files (moved, extracted, or combined): the tags follow the pages.
    const inOrder = entries.every((e, n) => e.src === entries[0].src && (n === 0 || e.i > entries[n - 1].i));
    if (anyTagged && !inOrder && acRoot(K)) acSortByPage(K, pages);
    if (acRoot(K)) acRebuildParentTree(K);
    if (ACC.ua) {
      const f = acMark('a11yfix');
      if (!K.str(K.cat.get(K.N('Lang'))) && f && f.lang) K.cat.set(K.N('Lang'), K.PDFString.of(f.lang));
      acWriteUA(K, out.getTitle() || doc.name);
    }
  } catch (e) { console.error('accessibility: saving the tags failed', e); }
});

/* ---- the checker (on the PDF as it would be saved) ---- */
async function acAnalyze(L, d) {
  const K = acK(L, d), items = [], pages = d.getPages();
  const add = (id, ok, label, detail, fix, level = 'error') => items.push({ id, ok, label, detail: detail || '', fix: ok ? null : fix || null, level: ok ? 'pass' : level });
  const root = acRoot(K), mi = K.dict(K.cat.get(K.N('MarkInfo'))), marked = !!mi && String(K.look(mi.get(K.N('Marked')))) === 'true';
  add('tagged', !!root && marked, root && marked ? 'Tagged PDF' : root ? 'Tags present but the PDF is not marked as tagged' : 'The PDF has no tags',
    root ? '' : 'Screen readers need tags to read the PDF in order.', root ? 'marked' : 'autotag');
  const lang = K.str(K.cat.get(K.N('Lang')));
  add('lang', !!(lang && lang.trim()), lang ? `Document language (${lang})` : 'No document language', 'Screen readers use it to pick a voice.', 'lang');
  let xmp = ''; const ms = K.look(K.cat.get(K.N('Metadata'))); if (ms && ms.dict) { try { xmp = new TextDecoder().decode(ms instanceof K.PDFRawStream ? K.decodePDFRawStream(ms).decode() : ms.getContents()); } catch {} }
  const title = (d.getTitle() || '').trim() || ((xmp.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]*)</) || [])[1] || '').trim();
  add('title', !!title, title ? `Document title (${title})` : 'No document title', '', 'title');
  const vp = K.dict(K.cat.get(K.N('ViewerPreferences'))), dt = vp && String(K.look(vp.get(K.N('DisplayDocTitle')))) === 'true';
  add('dtitle', !!dt, dt ? 'The title shows in the title bar' : 'The file name shows in the title bar, not the title', '', 'dtitle');
  // Content: everything painted is tagged or marked as decoration (all pages up to 40, then a sample).
  const sample = pages.length <= 40 ? pages.map((_, i) => i) : [...new Set(Array.from({ length: 40 }, (_, k) => Math.floor(k * pages.length / 40)))];
  const loose = [];
  for (const i of sample) { const sc = acScan(acSrcOf(K, pages[i].node)); if (sc.units.some((u) => !u.covered)) loose.push(i + 1); }
  add('content', !loose.length, loose.length ? 'Content that is not tagged' : 'All content is tagged or marked as decoration', loose.length ? `Page${loose.length > 1 ? 's' : ''} ${acPagesText(loose)}` : '', root ? 'artifacts' : 'autotag');
  // The tree
  let noAlt = 0, noTH = 0, skip = null, prev = 0, figs = 0, tables = 0; const tagged = new Set();
  if (root) acWalk(K, (er, e, pr, pe, page) => {
    const S = acRoleOf(K, K.name(e.get(K.N('S'))) || '');
    for (const it of acItems(K, e, page)) if (it.kind === 'obj' && it.obj instanceof K.PDFRef) tagged.add(it.obj.tag);
    if (S === 'Figure') { figs++; if (!K.str(e.get(K.N('Alt'))) && !K.str(e.get(K.N('ActualText')))) noAlt++; }
    if (S === 'Table') { tables++; let th = false; acWalkUnder(K, e, (x) => { if (acRoleOf(K, K.name(x.get(K.N('S'))) || '') === 'TH') th = true; }); if (!th) noTH++; }
    const h = /^H([1-6])$/.exec(S);
    if (h) { const lv = +h[1]; if (!skip && lv > prev + 1) skip = `H${prev || '–'} to H${lv}`; prev = lv; }
  });
  if (root) {
    add('alt', !noAlt, noAlt ? 'Figure without alt text' : figs ? 'Every figure has alt text' : 'No figures', noAlt ? `${noAlt} figure${noAlt > 1 ? 's' : ''}` : '', 'alt');
    add('headings', !skip, skip ? 'Headings skip a level' : 'Headings nest in order', skip || '', 'order');
    add('tables', !noTH, noTH ? 'Table without header cells' : tables ? 'Tables have header cells' : 'No tables', noTH ? `${noTH} table${noTH > 1 ? 's' : ''}` : '', 'order');
  }
  // Fonts: embedded, and with a way back to the letters
  const bad = new Map();
  const fontsOf = (res, depth, seen = new Set()) => {
    const R = K.dict(res); if (!R || depth > 4) return;
    const F = K.dict(R.get(K.N('Font')));
    if (F) for (const [, fr] of F.entries()) {
      const f = K.dict(fr); if (!f || seen.has(f)) continue; seen.add(f);
      const sub = K.name(f.get(K.N('Subtype'))), base = (K.name(f.get(K.N('BaseFont'))) || 'Type 3').replace(/^[A-Z]{6}\+/, '');
      if (sub === 'Type3') continue;
      const desc = sub === 'Type0' ? K.dict(K.dict((K.look(f.get(K.N('DescendantFonts'))) || { asArray: () => [] }).asArray()[0])?.get(K.N('FontDescriptor'))) : K.dict(f.get(K.N('FontDescriptor')));
      const embedded = !!desc && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => desc.get(K.N(k)));
      const enc = K.name(f.get(K.N('Encoding'))), uni = !!f.get(K.N('ToUnicode')) || (sub !== 'Type0' && ['WinAnsiEncoding', 'MacRomanEncoding', 'StandardEncoding'].includes(enc || ''));
      if (!embedded) bad.set(base, (bad.get(base) || '') + 'e'); if (!uni) bad.set(base, (bad.get(base) || '') + 'u');
    }
    const X = K.dict(R.get(K.N('XObject')));
    if (X) for (const [, xr] of X.entries()) { const x = K.look(xr); if (x && x.dict && K.name(x.dict.get(K.N('Subtype'))) === 'Form') fontsOf(x.dict.get(K.N('Resources')), depth + 1, seen); }
  };
  for (const p of pages) fontsOf(p.node.Resources(), 0);
  const notEmb = [...bad].filter(([, v]) => v.includes('e')).map(([k]) => k), noUni = [...bad].filter(([, v]) => v.includes('u')).map(([k]) => k);
  add('fonts', !notEmb.length, notEmb.length ? 'Fonts not embedded' : 'Fonts are embedded', notEmb.join(', '), typeof pdfaEmbedFonts === 'function' ? 'fonts' : null);
  add('unicode', !noUni.length, noUni.length ? 'Fonts without a Unicode map' : 'Text maps to Unicode', noUni.join(', '), null);
  // Annotations
  let untagged = 0, noTabs = 0;
  for (const p of pages) {
    const an = K.look(p.node.get(K.N('Annots'))); if (!(an instanceof K.PDFArray) || !an.size()) continue;
    if (K.name(p.node.get(K.N('Tabs'))) !== 'S') noTabs++;
    for (const r of an.asArray()) { const a = K.dict(r); if (!a) continue; const sub = K.name(a.get(K.N('Subtype'))); if (sub === 'Popup' || (K.num(a.get(K.N('F'))) || 0) & 2) continue; if (!(r instanceof K.PDFRef) || !tagged.has(r.tag)) untagged++; }
  }
  add('annots', !untagged, untagged ? 'Links, comments or form fields not tagged' : 'Links, comments and form fields are tagged', untagged ? `${untagged}` : '', root ? 'annots' : 'autotag');
  add('tabs', !noTabs, noTabs ? 'Tab order does not follow the tags' : 'Tab order follows the tags', noTabs ? `${noTabs} page${noTabs > 1 ? 's' : ''}` : '', 'tabs');
  // Scripts (they can make pages change or flicker): only a person can tell whether they are safe.
  let js = false;
  const names = K.dict(K.cat.get(K.N('Names'))); if (names && names.get(K.N('JavaScript'))) js = true;
  const oa = K.dict(K.cat.get(K.N('OpenAction'))); if (oa && K.name(oa.get(K.N('S'))) === 'JavaScript') js = true;
  if (K.cat.get(K.N('AA'))) js = true;
  for (const p of pages) { if (p.node.get(K.N('AA'))) js = true; const an = K.look(p.node.get(K.N('Annots'))); if (an instanceof K.PDFArray) for (const r of an.asArray()) { const a = K.dict(r); const act = a && K.dict(a.get(K.N('A'))); if ((act && K.name(act.get(K.N('S'))) === 'JavaScript') || (a && a.get(K.N('AA')))) js = true; } }
  add('js', !js, js ? 'The PDF has scripts' : 'No scripts', js ? 'Check that nothing flashes or moves on its own.' : '', null, 'warning');
  return items;
}
const acWalkUnder = (K, e, fn, seen = new Set()) => { for (const kid of acKids(K, e)) { const d = K.dict(kid); if (kid instanceof K.PDFRef && acIsElem(K, d) && !seen.has(kid.tag)) { seen.add(kid.tag); fn(d); acWalkUnder(K, d, fn, seen); } } };
const acPagesText = (list) => list.length > 8 ? list.slice(0, 8).join(', ') + ` and ${list.length - 8} more` : list.join(', ');
// Items a person has to look at (no automatic fix): alt text, headings, tables, fonts, scripts.
const AC_HUMAN = new Set(['alt', 'headings', 'tables', 'fonts', 'unicode', 'js']);
async function acRunCheck() {
  const bytes = await buildPdf(); if (!bytes) return null;
  const L = await loadPdfLib();
  const d = await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return acAnalyze(L, d);
}

/* ---- commands ---- */
async function acSrcDoc(k) {
  const b = doc && doc.sources[k]; if (!b) return null;
  let p = ACC.srcDocs.get(b);
  if (!p) { const L = await loadPdfLib(); p = L.PDFDocument.load(b, b.password ? { password: b.password, updateMetadata: false } : { ignoreEncryption: true, updateMetadata: false }).catch(() => null); ACC.srcDocs.set(b, p); }
  return p;
}
async function acIsTagged() {
  if (!doc) return false;
  for (const k of new Set(doc.pages.map((e) => e.src))) { const d = await acSrcDoc(k); if (d && d.catalog.get((await loadPdfLib()).PDFName.of('StructTreeRoot'))) return true; }
  return false;
}
async function acSetMark(type, fn) {
  const before = snapshot(), list = docMarks();
  let m = list.find((x) => x.type === type);
  if (!m) { m = { id: uid(), type }; list.push(m); }
  if (fn(m) === false) { const k = list.indexOf(m); if (Object.keys(m).length <= 2) list.splice(k, 1); return false; }
  changed(before); return true;
}
async function acAutoTag() {
  if (!has()) return;
  if (await acIsTagged()) { toast('This PDF already has tags. Use Reading order to change them.'); return; }
  if (acMark('autotag')) { toast('Tags are already added. They are saved with the PDF.'); return; }
  const big = doc.pages.length > 20; if (big) toast('Adding tags…');
  const plan = await acPlan(doc.pages);
  await acSetMark('autotag', (m) => { m.stats = plan.stats; m.pages = plan.pages; });
  toast('Tags added. They are saved with the PDF.', { label: 'Undo', run: () => undo() });
  acOrderRefresh();
}
// The headings of the document, for bookmarks: from its tags, the added tags, or worked out from the text.
async function acHeadingsList() {
  if (!has()) return [];
  const out = [];
  if (await acIsTagged()) {
    for (let n = 0; n < doc.pages.length; n++) {
      const page = await pageOf(doc.pages[n]); let tree = null; try { tree = await page.getStructTree(); } catch {}
      if (!tree) continue;
      const tc = await page.getTextContent({ includeMarkedContent: true }), text = new Map(), tops = new Map(); const stack = [];
      for (const it of tc.items) {
        if (it.type === 'beginMarkedContentProps' || it.type === 'beginMarkedContent') { stack.push(it.id || null); continue; }
        if (it.type === 'endMarkedContent') { stack.pop(); continue; }
        for (const id of stack) if (id) { text.set(id, (text.get(id) || '') + (it.str || '') + (it.hasEOL ? ' ' : '')); if (it.transform) tops.set(id, Math.max(tops.get(id) ?? -Infinity, it.transform[5] + (it.height || 0))); }
      }
      const walk = (node) => {
        const h = /^H([1-6])$/.exec(node.role || '');
        if (h && +h[1] <= 3) {
          let t = '', top = -Infinity; const go = (x) => { for (const c of x.children || []) { if (c.type === 'content') { t += text.get(c.id) || ''; top = Math.max(top, tops.get(c.id) ?? -Infinity); } else go(c); } };
          go(node); t = t.replace(/\s+/g, ' ').trim();
          if (t) out.push({ level: +h[1], title: t, key: pageKey(doc.pages[n]), top: Number.isFinite(top) ? top : null });
          return;
        }
        for (const c of node.children || []) if (!c.type) walk(c);
      };
      walk(tree);
    }
    return out;
  }
  const m = acMark('autotag'), plan = m ? null : await acPlan(doc.pages);
  for (const e of doc.pages) {
    const blocks = m ? await acBlocksFor(m, e) : plan.pages[pageKey(e)];
    for (const b of blocks) { const h = /^H([1-3])$/.exec(b.role); if (!h) continue; const t = acBlockText(b); if (t) out.push({ level: +h[1], title: t.length > 120 ? t.slice(0, 119).trim() + '…' : t, key: pageKey(e), top: Math.max(...acBlockLines(b).map((l) => l[3])) }); }
  }
  return out;
}

/* ---- alt text panel ---- */
async function acPageThumb(entry) {
  const key = pageKey(entry); if (ACC.thumbs.has(key)) return ACC.thumbs.get(key);
  const p = (async () => {
    const page = await pageOf(entry), vp = page.getViewport({ scale: 1.2, rotation: 0 });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    await page.render({ canvas: c, canvasContext: c.getContext('2d'), viewport: vp, annotationMode: pdfjs.AnnotationMode.DISABLE }).promise;
    return { c, vp };
  })().catch(() => null);
  ACC.thumbs.set(key, p); return p;
}
async function acCrop(entry, box) {
  const t = await acPageThumb(entry); if (!t) return '';
  const [x0, y0] = t.vp.convertToViewportPoint(box[0], box[3]), [x1, y1] = t.vp.convertToViewportPoint(box[2], box[1]);
  const sx = Math.max(0, Math.min(x0, x1)), sy = Math.max(0, Math.min(y0, y1)), sw = Math.max(1, Math.abs(x1 - x0)), sh = Math.max(1, Math.abs(y1 - y0));
  const k = Math.min(1, 96 / Math.max(sw, sh)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  c.getContext('2d').drawImage(t.c, sx, sy, sw, sh, 0, 0, c.width, c.height);
  try { return c.toDataURL('image/png'); } catch { return ''; }
}
// The pictures of the document: pictures in the PDF, pictures added here, and figures the PDF's tags describe.
async function acPictures() {
  const out = [], m = acMark('acalt'), items = (m && m.items) || [];
  const src0 = await acSrcDoc(0), L = await loadPdfLib();
  let figs = [];
  if (src0 && src0.catalog.get(L.PDFName.of('StructTreeRoot'))) {
    const K = acK(L, src0), pageOfRef = new Map(src0.getPages().map((pg, i) => [pg.ref.tag, i]));
    acWalk(K, (er, e, pr, pe, page) => {
      if (acRoleOf(K, K.name(e.get(K.N('S'))) || '') !== 'Figure') return;
      const a = K.dict(e.get(K.N('A'))), bb = a && K.nums(a.get(K.N('BBox')));
      figs.push({ ref: [er.objectNumber, er.generationNumber], alt: K.str(e.get(K.N('Alt'))) || '', page: page ? pageOfRef.get(page.tag) : null, box: bb, used: false });
    });
  }
  for (let n = 0; n < doc.pages.length; n++) {
    const e = doc.pages[n], key = pageKey(e);
    let cm = null; try { cm = await contentMap(await pageOf(e)); } catch {}
    for (const im of (cm && cm.images) || []) {
      const box = quadBox(im.quad).map(ac2), it = items.find((x) => x.key === key && acSameBox(x.box, box));
      const fig = e.src === 0 && figs.find((f) => !f.used && f.page === e.i && f.box && acSameBox(f.box, box, 3));
      if (fig) fig.used = true;
      out.push({ n, key, box, raw: im.raw, alt: it ? it.alt || '' : fig ? fig.alt : '', deco: !!(it && it.deco), ref: fig ? fig.ref : null, kind: 'pdf', entry: e });
    }
    for (const mk of marksOf(e).filter((x) => x.type === 'pic' && x.mat)) out.push({ n, key, box: quadBox(matQuad(mk.mat)), alt: mk.alt || '', deco: !!mk.deco, mark: mk.id, kind: 'pic', entry: e, data: mk.data });
    for (const f of figs.filter((x) => !x.used && e.src === 0 && x.page === e.i)) {
      f.used = true; const it = items.find((x) => x.ref && x.ref[0] === f.ref[0] && x.ref[1] === f.ref[1]);
      out.push({ n, key, box: f.box, alt: it ? it.alt : f.alt, deco: false, ref: f.ref, kind: 'tag', entry: e });
    }
  }
  return out;
}
async function acSaveAlt(rows) {
  return acSetMark('acalt', (m) => {
    const items = [];
    for (const r of rows) {
      if (r.kind === 'pic') { for (const e of doc.pages) { const mk = marksOf(e).find((x) => x.id === r.mark); if (mk) { mk.alt = r.alt || ''; mk.deco = !!r.deco; if (!mk.alt) delete mk.alt; if (!mk.deco) delete mk.deco; } } continue; }
      if (!r.alt && !r.deco) continue;
      items.push(r.kind === 'tag' ? { key: r.key, ref: r.ref, alt: r.alt || '' } : { key: r.key, box: r.box, raw: r.raw, alt: r.alt || '', deco: !!r.deco, ...(r.ref ? { ref: r.ref } : {}) });
    }
    m.items = items;
  });
}
async function acAltPanel() {
  if (!has()) return;
  const rows = await acPictures();
  if (!rows.length) { toast('There are no pictures in this PDF.'); return; }
  const shown = rows.slice(0, 300);
  const body = `<p class="ac-note">Describe each picture for people who can’t see it, or mark it as decorative so screen readers skip it.</p>
    <ul class="ac-alt" role="list">${shown.map((r, k) => `<li class="ac-alt-row" data-k="${k}">
      <img class="ac-thumb" alt="" data-thumb="${k}"${r.data ? ` src="${esc(r.data)}"` : ''}>
      <div class="ac-alt-f"><label class="field"><span>Picture ${k + 1}, page ${r.n + 1}${r.kind === 'tag' ? ' (tagged figure)' : ''}</span>
        <textarea rows="2" data-alt="${k}" placeholder="Alt text" aria-label="Alt text for picture ${k + 1} on page ${r.n + 1}"${r.deco ? ' disabled' : ''}>${esc(r.alt || '')}</textarea></label>
        ${r.kind === 'tag' ? '' : `<label class="check"><input type="checkbox" data-deco="${k}"${r.deco ? ' checked' : ''}> Decorative</label>`}</div></li>`).join('')}</ul>
    ${rows.length > shown.length ? `<p class="ac-note">The first ${shown.length} pictures are shown.</p>` : ''}`;
  const a = await dialog('Alt text', body, [{ label: 'Cancel' }, { label: 'Save', value: 'save', primary: true }], (dlg) => {
    dlg.classList.add('ac-dlg');
    $$('[data-deco]', dlg).forEach((c) => c.onchange = () => { const t = $(`[data-alt="${c.dataset.deco}"]`, dlg); t.disabled = c.checked; shown[+c.dataset.deco].deco = c.checked; });
    $$('[data-alt]', dlg).forEach((t) => t.oninput = () => { shown[+t.dataset.alt].alt = t.value.trim(); });
    shown.forEach(async (r, k) => { if (r.data || !r.box) return; const url = await acCrop(r.entry, r.box); const img = $(`[data-thumb="${k}"]`, dlg); if (img && url) img.src = url; });
  });
  if (a !== 'save') return;
  await acSaveAlt(rows);
  toast('Alt text saved');
}

/* ---- reading order panel ---- */
// The page's tags as a list: { id, role, text, depth, box, kind: 'block' | 'elem', count }.
async function acOrderModel(n) {
  const e = doc.pages[n]; if (!e) return { mode: 'none', items: [] };
  const at = acMark('autotag');
  if (at) {
    const blocks = await acBlocksFor(at, e);
    return { mode: 'auto', items: blocks.map((b) => ({ id: b.id, role: b.role, text: b.role === 'Figure' ? 'Picture' : acBlockText(b), depth: 0, box: acBlockBox(b), count: b.role === 'L' ? b.items.length : acBlockLines(b).length })) };
  }
  const src = await acSrcDoc(e.src), L = await loadPdfLib();
  if (!src || !src.catalog.get(L.PDFName.of('StructTreeRoot'))) return { mode: 'none', items: [] };
  if (e.src !== 0) return { mode: 'other', items: [] };
  // A fresh copy with the changes so far, so the list shows what will be saved.
  const d = await L.PDFDocument.load(doc.sources[0], doc.sources[0].password ? { password: doc.sources[0].password, updateMetadata: false } : { ignoreEncryption: true, updateMetadata: false });
  const K = acK(L, d), ed = acMark('acorder'); if (ed) acTagOps(K, ed.ops, null);
  const pref = d.getPage(e.i).ref, items = [], depthOf = new Map();
  const page = await pageOf(e), tc = await page.getTextContent({ includeMarkedContent: true }), boxes = new Map(), text = new Map(), stack = [];
  for (const it of tc.items) {
    if (it.type === 'beginMarkedContentProps' || it.type === 'beginMarkedContent') { stack.push(it.id || null); continue; }
    if (it.type === 'endMarkedContent') { stack.pop(); continue; }
    if (!it.transform) continue;
    const sz = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10, x = it.transform[4], y = it.transform[5], b = [x, y - sz * .25, x + (it.width || 0), y + sz * .85];
    for (const id of stack) if (id) { const m = /_mc(\d+)$/.exec(id); if (!m) continue; const k = +m[1]; const o = boxes.get(k); boxes.set(k, o ? [Math.min(o[0], b[0]), Math.min(o[1], b[1]), Math.max(o[2], b[2]), Math.max(o[3], b[3])] : b); text.set(k, (text.get(k) || '') + (it.str || '') + (it.hasEOL ? ' ' : '')); }
  }
  const mine = (x, pg) => acItems(K, x, pg).filter((it) => it.kind === 'mc' && it.page && it.page.tag === pref.tag).map((it) => it.mcid);
  const under = (x, pg, fn) => { fn(x, pg); for (const kid of acKids(K, x)) { const dd = K.dict(kid); if (kid instanceof K.PDFRef && acIsElem(K, dd)) { const o = dd.get(K.N('Pg')); under(dd, o instanceof K.PDFRef ? o : pg, fn); } } };
  acWalk(K, (er, el, pr, pe, pg) => {
    const ids = []; under(el, pg, (x, p2) => ids.push(...mine(x, p2)));
    const annots = acItems(K, el, pg).filter((it) => it.kind === 'obj' && it.page && it.page.tag === pref.tag);
    if (!ids.length && !annots.length) return false;
    const S = K.name(el.get(K.N('S'))) || '', depth = (depthOf.get(pr && pr.tag) ?? -1) + 1; depthOf.set(er.tag, depth);
    if (AC_GROUPING.has(acRoleOf(K, S)) && depth === 0 && !mine(el, pg).length) { depthOf.set(er.tag, -1); return; }
    let box = null; for (const k of ids) { const b = boxes.get(k); if (b) box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b; }
    if (!box) { const a = K.dict(el.get(K.N('A'))), bb = a && K.nums(a.get(K.N('BBox'))); if (bb && bb.length === 4) box = bb; }
    const t = ids.map((k) => text.get(k) || '').join(' ').replace(/\s+/g, ' ').trim();
    items.push({ id: `${er.objectNumber}:${er.generationNumber}`, ref: [er.objectNumber, er.generationNumber], parent: pr ? `${pr.objectNumber}:${pr.generationNumber}` : '', role: S, text: t || (acRoleOf(K, S) === 'Figure' ? K.str(el.get(K.N('Alt'))) || 'Picture' : annots.length ? S : ''), depth: Math.max(0, depth), box, count: acKids(K, el).length });
  });
  return { mode: 'tags', items };
}
async function acOrderEdit(op) {
  const n = current, e = doc.pages[n]; if (!e) return;
  const model = await acOrderModel(n);
  if (model.mode === 'auto') {
    const key = pageKey(e), at = acMark('autotag'), blocks = JSON.parse(JSON.stringify(await acBlocksFor(at, e)));
    const k = blocks.findIndex((b) => b.id === op.id); if (k < 0) return;
    if (op.op === 'move') { const [b] = blocks.splice(k, 1); let j = op.before ? blocks.findIndex((x) => x.id === op.before) : -1; if (op.after) { j = blocks.findIndex((x) => x.id === op.after); if (j >= 0) j++; } blocks.splice(j < 0 ? blocks.length : j, 0, b); }
    if (op.op === 'retag') {
      const b = blocks[k];
      if (op.S === 'L' && b.role !== 'L') { b.items = (b.lines || []).map((l) => [l]); delete b.lines; }
      else if (op.S !== 'L' && b.role === 'L') { b.lines = b.items.flat(); delete b.items; }
      if (b.role === 'Table' && op.S !== 'Table') { b.lines = acBlockLines(b); delete b.rows; }
      if (op.S === 'Table' && b.role !== 'Table') return;
      b.role = op.S;
    }
    if (op.op === 'merge') {
      const a = blocks[k], b = blocks[k + 1]; if (!b || a.role === 'Figure' || b.role === 'Figure' || a.role === 'Table' || b.role === 'Table') return;
      if (a.role === 'L') a.items.push(...(b.role === 'L' ? b.items : [b.lines])); else a.lines = [...a.lines, ...acBlockLines(b)];
      blocks.splice(k + 1, 1);
    }
    if (op.op === 'split') {
      const b = blocks[k]; if (b.role === 'Figure' || b.role === 'Table') return;
      const parts = b.role === 'L' ? b.items.map((items) => ({ id: acBid(), role: 'L', items: [items] })) : b.lines.map((l) => ({ id: acBid(), role: b.role, lines: [l] }));
      if (parts.length < 2) return;
      blocks.splice(k, 1, ...parts);
    }
    await acSetMark('autotag', (m) => { m.pages = { ...(m.pages || {}), [key]: blocks }; });
  } else if (model.mode === 'tags') {
    const it = model.items.find((x) => x.id === op.id); if (!it) return;
    const R = (id) => id ? id.split(':').map(Number) : null;
    const o = { op: op.op, ref: it.ref };
    if (op.op === 'retag') o.S = op.S;
    if (op.op === 'move') {
      const b = op.before && model.items.find((x) => x.id === op.before); if (b && b.parent !== it.parent) return;
      if (b) o.before = R(b.id);
      else {
        // To the end of this page: after the last element of the page with the same parent (the parent can be the
        // Document, which holds the elements of every page).
        const sibs = model.items.filter((x) => x.parent === it.parent && x.id !== it.id), a = op.after ? sibs.find((x) => x.id === op.after) : sibs[sibs.length - 1];
        if (!a) return; o.after = R(a.id);
      }
    }
    if (op.op === 'merge') { const k = model.items.indexOf(it), nx = model.items.slice(k + 1).find((x) => x.parent === it.parent); if (!nx) return; o.next = R(nx.id); }
    await acSetMark('acorder', (m) => { m.ops = [...(m.ops || []), o]; });
  }
  acOrderRefresh();
}
function acOrderToggle(on = !ACC.order) {
  ACC.order = on;
  let panel = $('#acOrder');
  if (!on) { if (panel) panel.remove(); $$('.ac-ord').forEach((x) => x.remove()); refreshRibbon && refreshRibbon(); return; }
  if (!panel) {
    panel = document.createElement('section'); panel.id = 'acOrder'; panel.className = 'ac-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Reading order');
    document.body.appendChild(panel);
  }
  refreshRibbon && refreshRibbon();
  acOrderRefresh();
}
let acOrderTimer = null;
function acOrderRefresh() { if (!ACC.order) return; clearTimeout(acOrderTimer); acOrderTimer = setTimeout(acOrderRender, 30); }
async function acOrderRender() {
  const panel = $('#acOrder'); if (!panel || !doc) return;
  const n = current, model = await acOrderModel(n); ACC.model = model; ACC.modelPage = n;
  const sel = ACC.orderSel;
  const opts = (r) => AC_PICK.concat(AC_PICK.includes(r) ? [] : [r]).map((x) => `<option${x === r ? ' selected' : ''}>${x}</option>`).join('');
  panel.innerHTML = `<div class="ac-head"><h2>Reading order</h2><span class="ac-pg">Page ${n + 1}</span><button type="button" class="icon-btn" data-aco="close" aria-label="Close">${ic('x')}</button></div>
    ${model.mode === 'none' ? `<p class="ac-note">This PDF has no tags yet.</p><button type="button" class="btn primary" data-aco="autotag">${ic('tags')} Add tags automatically</button>`
    : model.mode === 'other' ? '<p class="ac-note">This page comes from another PDF. Its tags are kept as they are.</p>'
    : !model.items.length ? '<p class="ac-note">Nothing on this page is tagged.</p>'
    : `<p class="ac-note">Drag a tag to change the order screen readers read in.</p>
      <ol class="ac-list">${model.items.map((it, k) => `<li class="ac-item${it.id === sel ? ' on' : ''}" data-id="${esc(it.id)}" draggable="true" style="margin-left:${it.depth * 14}px">
        <span class="ac-num" aria-hidden="true">${k + 1}</span>
        <select data-role aria-label="Tag type of item ${k + 1}">${opts(it.role)}</select>
        <span class="ac-txt" title="${esc(it.text)}">${esc(it.text.slice(0, 80)) || '<em>(no text)</em>'}</span>
        <span class="ac-btns">
          <button type="button" class="icon-btn" data-act="up" aria-label="Move up"${k === 0 ? ' disabled' : ''}>${ic('arrow-up')}</button>
          <button type="button" class="icon-btn" data-act="down" aria-label="Move down"${k === model.items.length - 1 ? ' disabled' : ''}>${ic('arrow-down')}</button>
          <button type="button" class="icon-btn" data-act="merge" aria-label="Merge with next"${k === model.items.length - 1 ? ' disabled' : ''}>${ic('merge')}</button>
          <button type="button" class="icon-btn" data-act="split" aria-label="Split"${it.count < 2 ? ' disabled' : ''}>${ic('split')}</button>
        </span></li>`).join('')}</ol>`}`;
  icons();
  const close = $('[data-aco="close"]', panel); if (close) close.onclick = () => acOrderToggle(false);
  const auto = $('[data-aco="autotag"]', panel); if (auto) auto.onclick = () => run('acAutoTag');
  const items = model.items;
  const sibAfter = (k, dir) => { const it = items[k]; if (model.mode !== 'tags') return items[k + dir]; let j = k + dir; while (items[j] && items[j].parent !== it.parent) j += dir; return items[j]; };
  $$('.ac-item', panel).forEach((li, k) => {
    const it = items[k];
    li.onclick = (ev) => { if (ev.target.closest('select, button')) return; ACC.orderSel = it.id; $$('.ac-item', panel).forEach((x) => x.classList.toggle('on', x === li)); acOrderDrawAll(); };
    $('[data-role]', li).onchange = (ev) => acOrderEdit({ op: 'retag', id: it.id, S: ev.target.value });
    $('[data-act="up"]', li).onclick = () => { const b = sibAfter(k, -1); if (b) acOrderEdit({ op: 'move', id: it.id, before: b.id }); };
    $('[data-act="down"]', li).onclick = () => { const b = sibAfter(k, 1); if (b) acOrderEdit({ op: 'move', id: it.id, after: b.id }); };
    $('[data-act="merge"]', li).onclick = () => acOrderEdit({ op: 'merge', id: it.id });
    $('[data-act="split"]', li).onclick = () => acOrderEdit({ op: 'split', id: it.id });
    li.ondragstart = (ev) => { ACC.drag = it.id; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/x-tag', it.id); li.classList.add('drag'); };
    li.ondragend = () => { ACC.drag = null; li.classList.remove('drag'); $$('.ac-before', panel).forEach((x) => x.classList.remove('ac-before')); };
    li.ondragover = (ev) => { if (!ACC.drag || ACC.drag === it.id) return; ev.preventDefault(); li.classList.add('ac-before'); };
    li.ondragleave = () => li.classList.remove('ac-before');
    li.ondrop = (ev) => { ev.preventDefault(); li.classList.remove('ac-before'); const from = ACC.drag; ACC.drag = null; if (from && from !== it.id) acOrderEdit({ op: 'move', id: from, before: it.id }); };
  });
  acOrderDrawAll();
}
function acOrderDrawAll() { for (const v of views) if (v.rendered) acOrderDraw(v); }
function acOrderDraw(v) {
  v.el.querySelectorAll('.ac-ord').forEach((x) => x.remove());
  if (!ACC.order || !ACC.model || views.indexOf(v) !== ACC.modelPage) return;
  const svg = svgEl('svg', { class: 'ac-ord', 'aria-hidden': 'true', width: v.viewport.width, height: v.viewport.height });
  ACC.model.items.forEach((it, k) => {
    if (!it.box) return;
    const pts = [[it.box[0], it.box[1]], [it.box[2], it.box[1]], [it.box[2], it.box[3]], [it.box[0], it.box[3]]].map(([x, y]) => toView(v, x, y));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), x = Math.min(...xs), y = Math.min(...ys);
    const g = svgEl('g', { class: 'ac-box' + (it.id === ACC.orderSel ? ' on' : '') + (it.role === 'Artifact' ? ' art' : '') });
    g.appendChild(svgEl('rect', { x: x - 2, y: y - 2, width: Math.max(...xs) - x + 4, height: Math.max(...ys) - y + 4, rx: 3 }));
    g.appendChild(svgEl('circle', { cx: x - 2, cy: y - 2, r: 9 }));
    const t = svgEl('text', { x: x - 2, y: y + 2, 'text-anchor': 'middle' }); t.textContent = String(k + 1); g.appendChild(t);
    svg.appendChild(g);
  });
  v.el.appendChild(svg);
}
FEATURE.afterRender.push((v) => { if (ACC.order) { if (views.indexOf(v) === current && ACC.modelPage !== current) acOrderRefresh(); else acOrderDraw(v); } });
FEATURE.onDocShown.push(() => { ACC.thumbs.clear(); ACC.model = null; ACC.orderSel = null; if (ACC.order) acOrderRefresh(); });
FEATURE.onDocClosed.push(() => { acOrderToggle(false); ACC.thumbs.clear(); });
setInterval(() => { if (ACC.order && doc && ACC.modelPage !== current) acOrderRefresh(); }, 600);

/* ---- the checker panel ---- */
async function acFix(id) {
  if (id === 'autotag') { await acAutoTag(); return true; }
  if (id === 'alt') { await acAltPanel(); return true; }
  if (id === 'order') { acOrderToggle(true); return true; }
  if (id === 'fonts' && typeof pdfaEmbedFonts === 'function') { await pdfaEmbedFonts(); return true; }
  let value = true;
  if (id === 'lang') { value = await askText('Document language', 'The language screen readers read the PDF in, for example en-US, fr or de.', (navigator.language || 'en-US')); if (!value || !value.trim()) return false; value = value.trim(); }
  if (id === 'title') {
    value = await askText('Document title', '', doc.name); if (!value || !value.trim()) return false; value = value.trim();
  }
  return acSetMark('a11yfix', (m) => { m[id] = value; if (id === 'title') m.title = value; });
}
async function acCheckPanel() {
  if (!has()) return;
  const show = async () => {
    const items = await acRunCheck(); if (!items) return null;
    const errs = items.filter((x) => !x.ok && x.level === 'error').length;
    const row = (x) => `<li class="ac-res ${x.ok ? 'ok' : x.level}">${ic(x.ok ? 'circle-check' : x.level === 'warning' ? 'triangle-alert' : 'circle-x')}
      <div><div class="ac-l">${esc(x.label)}</div>${x.detail ? `<div class="ac-d">${esc(x.detail)}</div>` : ''}</div>
      ${x.fix ? `<button type="button" class="btn" data-fix="${x.fix}">${x.fix === 'alt' ? 'Add alt text' : x.fix === 'order' ? 'Reading order' : x.fix === 'autotag' ? 'Add tags' : 'Fix'}</button>` : ''}</li>`;
    const bad = items.filter((x) => !x.ok), good = items.filter((x) => x.ok);
    const body = `<p class="ac-sum">${errs ? `${errs} problem${errs > 1 ? 's' : ''} found.` : 'No problems found.'} The check covers the main PDF/UA rules; some things only a person can judge, such as whether alt text describes the picture.</p>
      <ul class="ac-results">${bad.map(row).join('')}</ul>${good.length ? `<details class="ac-passed"><summary>Passed (${good.length})</summary><ul class="ac-results">${good.map(row).join('')}</ul></details>` : ''}`;
    return dialog('Accessibility check', body, [{ label: 'Done', primary: true }], (dlg) => {
      dlg.classList.add('ac-dlg');
      $$('[data-fix]', dlg).forEach((b) => b.onclick = () => { dlg.close(); ACC.nextFix = b.dataset.fix; dlg.dispatchEvent(new Event('cancel')); });
    });
  };
  for (let k = 0; k < 8; k++) {
    ACC.nextFix = null;
    await show();
    const f = ACC.nextFix; if (!f) return;
    const done = await acFix(f);
    if (f === 'alt' || f === 'order' || !done) return;
  }
}
async function acSaveUA() {
  if (!has()) return;
  const items = await acRunCheck(); if (!items) return;
  const errs = items.filter((x) => !x.ok && x.level === 'error');
  if (errs.length) {
    const a = await dialog('Not ready for PDF/UA', `<p>Fix these first, then save again:</p><ul class="ac-results">${errs.map((x) => `<li class="ac-res error">${ic('circle-x')}<div><div class="ac-l">${esc(x.label)}</div>${x.detail ? `<div class="ac-d">${esc(x.detail)}</div>` : ''}</div></li>`).join('')}</ul>`, [{ label: 'Close' }, { label: 'Accessibility check…', value: 'check', primary: true }]);
    if (a === 'check') acCheckPanel();
    return;
  }
  ACC.ua = true;
  let bytes; try { bytes = await buildPdf(); } finally { ACC.ua = false; }
  if (!bytes) return;
  const r = await saveFile(bytes, `${doc.name} (PDF-UA).pdf`, 'application/pdf');
  if (r) toast('Saved as PDF/UA');
}

/* ---- screen readers in the app: a tagged page is read by its tags ---- */
const AC_ARIA = { P: ['p'], H1: ['h1'], H2: ['h2'], H3: ['h3'], H4: ['h4'], H5: ['h5'], H6: ['h6'], H: ['span', 'heading', 2], L: ['ul'], LI: ['li'], Lbl: ['span'], LBody: ['span'], Table: ['table'], TR: ['tr'], TH: ['th'], TD: ['td'], THead: ['thead'], TBody: ['tbody'], TFoot: ['tfoot'], Figure: ['span', 'img'], Caption: ['span', 'note'], BlockQuote: ['blockquote'], Quote: ['q'], Code: ['code'], Note: ['span', 'note'], Link: ['span'], Form: ['span'], Document: ['div'], Part: ['div'], Sect: ['section'], Art: ['article'], Div: ['div'], TOC: ['ul'], TOCI: ['li'] };
FEATURE.afterRender.push((v) => { acReaderLayer(v).catch(() => {}); });
async function acReaderLayer(v) {
  const page = v.page, el = v.el; if (!page || el.querySelector('.ac-tree')) return;
  let tree = null; try { tree = await page.getStructTree(); } catch {}
  if (!tree || !(tree.children || []).length || !el.isConnected) return;
  const tc = await page.getTextContent({ includeMarkedContent: true }), text = new Map(), stack = [];
  for (const it of tc.items) {
    if (it.type === 'beginMarkedContentProps' || it.type === 'beginMarkedContent') { stack.push(it.id || null); continue; }
    if (it.type === 'endMarkedContent') { stack.pop(); continue; }
    const id = [...stack].reverse().find(Boolean); if (id) text.set(id, (text.get(id) || '') + (it.str || '') + (it.hasEOL ? ' ' : ''));
  }
  let words = 0;
  const build = (node) => {
    if (node.type === 'content') { const t = text.get(node.id) || ''; words += t.trim().length; return document.createTextNode(t); }
    if (node.type) return null;
    const [tag, role, level] = AC_ARIA[node.role] || ['span'];
    const e = document.createElement(tag);
    if (role) e.setAttribute('role', role); if (level) e.setAttribute('aria-level', level);
    if (node.lang) e.lang = node.lang;
    if (node.alt != null) { e.setAttribute('aria-label', node.alt); if (!role) e.setAttribute('role', 'img'); }
    for (const c of node.children || []) { const x = build(c); if (x) e.appendChild(x); }
    return e;
  };
  const root = document.createElement('div'); root.className = 'ac-tree';
  for (const c of tree.children) { const x = build(c); if (x) root.appendChild(x); }
  if (!words && !root.querySelector('[aria-label]')) return;
  if (el.querySelector('.ac-tree')) return;
  el.appendChild(root);
  const tl = el.querySelector('.textLayer'); if (tl) tl.setAttribute('aria-hidden', 'true');
}
// For the form and link layer: links and fields named after their tags.
FEATURE.structTreeLayer = (v, page) => {
  let p = null;
  const ids = async () => {
    if (!p) p = page.getStructTree().catch(() => null).then((tree) => {
      const m = new Map();
      const walk = (n, alt) => { for (const c of (n && n.children) || []) { if (c.type === 'annotation') m.set(c.id, alt); else if (!c.type) walk(c, c.alt || alt); } };
      walk(tree, null); return m;
    });
    return p;
  };
  return {
    async getAriaAttributes(id) { const m = await ids(); const alt = m && m.get(id); return alt ? new Map([['aria-label', alt]]) : null; },
    async getAnnotationIds() { const m = await ids(); return new Set(m ? m.keys() : []); },
  };
};

cmd('acCheck', { label: 'Accessibility check…', rlabel: 'Check', icon: 'accessibility', enabled: has, run: acCheckPanel });
cmd('acAutoTag', { label: 'Add tags automatically', rlabel: 'Add tags', icon: 'tags', enabled: () => has() && !acMark('autotag'), run: acAutoTag });
cmd('acAlt', { label: 'Alt text…', icon: 'image', enabled: has, run: acAltPanel });
cmd('acOrder', { label: 'Reading order', icon: 'list-ordered', enabled: has, pressed: () => ACC.order, run: () => acOrderToggle() });
cmd('acSaveUA', { label: 'Save as PDF/UA…', rlabel: 'Save PDF/UA', icon: 'file-check', enabled: has, run: acSaveUA });
ribbonAdd('export', 'Accessibility', ['acCheck', 'acAutoTag', 'acAlt', 'acOrder', ...(C.bmHeadings ? ['bmHeadings'] : []), 'acSaveUA']);
menuAdd('Edit', ['acCheck', 'acAutoTag', 'acAlt', 'acOrder']);
// Save as PDF/UA goes with the other ways to save (File keeps Close last).
{ const fm = MENUS.find(([t]) => t === 'File'), i = fm ? fm[1].indexOf('saveCopy') : -1; if (i >= 0) fm[1].splice(i + 1, 0, 'acSaveUA'); else ribbonAdd('export', 'Save', ['acSaveUA']); }
TEST_HOOKS.acPlan = async () => (await acPlan(doc.pages));
TEST_HOOKS.acCheck = async () => acRunCheck();
TEST_HOOKS.acHeadings = () => acHeadingsList();
TEST_HOOKS.acPictures = async () => (await acPictures()).map(({ entry, ...r }) => r);
TEST_HOOKS.acSaveAlt = async (rows) => { const all = await acPictures(); for (const r of rows) Object.assign(all[r.k], r); return acSaveAlt(all); };
TEST_HOOKS.acFixSet = (id, value) => acSetMark('a11yfix', (m) => { m[id] = value; });
TEST_HOOKS.acSaveUABytes = async () => { ACC.ua = true; try { return Array.from(await buildPdf()); } finally { ACC.ua = false; } };
TEST_HOOKS.acOrderModel = async (n) => acOrderModel(n ?? current);
TEST_HOOKS.acOrderEdit = (op) => acOrderEdit(op);
TEST_HOOKS.acSaveUA = acSaveUA;

addStyle(`
.ac-tree { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; left: 0; top: 0; }
.ac-dlg { width: min(620px, calc(100vw - 32px)); }
.ac-dlg .dlg-body { max-height: min(70vh, 640px); overflow: auto; }
.ac-note, .ac-sum { color: var(--ink-2); font-size: 13px; margin: 0 0 10px; }
.ac-alt { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.ac-alt-row { display: flex; gap: 12px; align-items: flex-start; padding: 8px; border: 1px solid var(--line); border-radius: 8px; }
.ac-thumb { flex: none; width: 96px; height: 72px; object-fit: contain; background: var(--hover); border-radius: 6px; }
.ac-alt-f { flex: 1; min-width: 0; display: grid; gap: 4px; }
.ac-alt-f textarea { width: 100%; box-sizing: border-box; font: inherit; }
.ac-alt-f .field span { font-size: 12px; color: var(--ink-3); }
.ac-alt-f .check { font-size: 13px; color: var(--ink-2); display: flex; gap: 6px; align-items: center; }
.ac-results { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.ac-res { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; font-size: 13px; }
.ac-res > svg { flex: none; width: 18px; height: 18px; }
.ac-res > div { flex: 1; min-width: 0; }
.ac-res.ok > svg { color: var(--ok, #2f9e44); } .ac-res.error > svg { color: var(--danger, #e03131); } .ac-res.warning > svg { color: #e8590c; }
.ac-l { color: var(--ink); } .ac-d { color: var(--ink-3); font-size: 12px; overflow-wrap: anywhere; }
.ac-passed { margin-top: 10px; font-size: 13px; color: var(--ink-2); } .ac-passed summary { cursor: pointer; margin-bottom: 6px; }
.ac-panel { position: fixed; right: 16px; top: 120px; z-index: 40; width: min(360px, calc(100vw - 32px)); max-height: calc(100vh - 160px); overflow: auto; background: var(--surface, var(--chrome)); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.25); padding: 10px 12px; box-sizing: border-box; }
.ac-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.ac-head h2 { font-size: 14px; margin: 0; flex: 1; }
.ac-pg { font-size: 12px; color: var(--ink-3); }
/* one column as wide as the panel: a long line of text is cut short, never pushing the buttons out of view */
.ac-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; }
.ac-item { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 6px; font-size: 13px; cursor: grab; border: 1px solid transparent; min-width: 0; box-sizing: border-box; }
.ac-item:hover { background: var(--hover); } .ac-item.on { border-color: var(--accent); background: var(--accent-soft); }
.ac-item.drag { opacity: .5; } .ac-item.ac-before { box-shadow: inset 0 2px 0 var(--accent); }
.ac-num { flex: none; min-width: 20px; height: 20px; border-radius: 10px; background: var(--accent); color: #fff; font-size: 11px; display: grid; place-items: center; font-variant-numeric: tabular-nums; }
.ac-item select { flex: none; font: inherit; font-size: 12px; max-width: 86px; }
.ac-txt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-2); }
.ac-btns { flex: none; display: flex; } .ac-btns .icon-btn { width: 26px; height: 26px; } .ac-btns svg { width: 14px; height: 14px; }
.ac-btns .icon-btn:disabled { opacity: .3; }
@media (pointer: coarse) { .ac-item { flex-wrap: wrap; } .ac-btns { margin-left: auto; } .ac-btns .icon-btn { width: 40px; height: 40px; } .ac-txt { order: 5; flex-basis: 100%; } }
.ac-panel .btn svg { width: 15px; height: 15px; vertical-align: -3px; }
svg.ac-ord { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 5; overflow: visible; }
.ac-box rect { fill: rgba(36, 72, 201, .08); stroke: #2448c9; stroke-width: 1.2; }
.ac-box circle { fill: #2448c9; } .ac-box text { fill: #fff; font: 600 11px system-ui, sans-serif; }
.ac-box.art rect { stroke-dasharray: 3 3; stroke: #868e96; fill: none; } .ac-box.art circle { fill: #868e96; }
.ac-box.on rect { stroke: #e8590c; stroke-width: 2; } .ac-box.on circle { fill: #e8590c; }
@media (max-width: 760px) { .ac-panel { left: 16px; right: 16px; width: auto; top: auto; bottom: 16px; max-height: 45vh; } }
`);
