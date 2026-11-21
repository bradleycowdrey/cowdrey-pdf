/* ---------------- redaction: what else is scrubbed ----------------
   Helpers for applying redactions (80-protect.js rewrites the page content with them) and for what a PDF keeps
   outside its pages:
   - geometry: drawings that cross a redaction box are cut along it (curves flattened, the box taken out of each
     shape), letters go when the box covers more than a tenth of them, not only their middle;
   - marked content: the text a sequence carries for search and screen readers (/ActualText, /Alt, /E) goes when
     anything in it was removed, and a sequence left empty is no longer linked to the structure tree;
   - the structure tree (tags): elements whose content was redacted lose their alternate text, empty ones go, and
     the parent tree no longer points at content that is gone;
   - hidden places: bookmarks, named destinations, comments, form values, document properties, XMP metadata and
     attached file names that contain a redacted word (found with Search and redact, or removed after Apply).
   docMarks(): protscrub   { items: [{ kind, id }], terms: [regex source], flags }  hidden items to edit or remove */

/* ----- geometry ----- */
const rsArea = (P) => { let a = 0; for (let i = 0, n = P.length; i < n; i++) { const p = P[i], q = P[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
// The inside of a convex quad, as half-planes [a, b, c] (a·x + b·y + c >= 0 inside); null when it has no area.
function rsHalfPlanes(q) {
  const s = rsArea(q); if (Math.abs(s) < 1e-6) return null;
  const hp = [];
  for (let i = 0; i < q.length; i++) {
    const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % q.length];
    let a = y1 - y2, b = x2 - x1; if (s < 0) { a = -a; b = -b; }
    const l = Math.hypot(a, b); if (l < 1e-9) continue;
    hp.push([a / l, b / l, -(a * x1 + b * y1) / l]);
  }
  return hp;
}
const rsNeg = ([a, b, c]) => [-a, -b, -c];
// A closed polygon cut by a half-plane (Sutherland–Hodgman): what is on its inside.
function rsClip(P, [a, b, c]) {
  const out = [], n = P.length;
  for (let i = 0; i < n; i++) {
    const p = P[i], q = P[(i + 1) % n], fp = a * p[0] + b * p[1] + c, fq = a * q[0] + b * q[1] + c;
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}
const rsClipAll = (P, hp) => { for (const h of hp) { if (P.length < 3) return []; P = rsClip(P, h); } return P; };
// The outside of a convex region is split into pieces that don't overlap (outside edge i, inside edges before it),
// so a shape minus the region is the shape cut by each piece. Winding is kept, so fill rules still hold.
const rsRegions = (hp) => hp.map((h, i) => [rsNeg(h), ...hp.slice(0, i)]);
function rsSubtract(P, hp) {
  const out = [];
  for (const reg of rsRegions(hp)) { const R = rsClipAll(P, reg); if (R.length >= 3 && Math.abs(rsArea(R)) > 1e-7) out.push(R); }
  return out;
}
// The part of a segment inside a convex region, as [t0, t1], or null.
function rsSegIn(p, q, reg) {
  let t0 = 0, t1 = 1;
  for (const [a, b, c] of reg) {
    const fp = a * p[0] + b * p[1] + c, fq = a * q[0] + b * q[1] + c;
    if (fp < 0 && fq < 0) return null;
    if (fp < 0) t0 = Math.max(t0, fp / (fp - fq)); else if (fq < 0) t1 = Math.min(t1, fp / (fp - fq));
    if (t0 >= t1) return null;
  }
  return [t0, t1];
}
// An open line (a list of points) minus a convex region: the pieces left, as lines.
function rsSubtractLine(pts, hp) {
  const out = []; let cur = null;
  const at = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const near = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i], pieces = [];
    for (const reg of rsRegions(hp)) { const r = rsSegIn(p, q, reg); if (r && r[1] - r[0] > 1e-9) pieces.push(r); }
    pieces.sort((x, y) => x[0] - y[0]);
    for (const [t0, t1] of pieces) {
      const a = at(p, q, t0), b = at(p, q, t1);
      if (cur && near(cur[cur.length - 1], a)) cur.push(b); else { cur = [a, b]; out.push(cur); }
    }
  }
  return out;
}
// How much of a quad lies inside another (convex) one, as a share of its own area.
function rsCovered(q, hp) { const A = Math.abs(rsArea(q)); if (A < 1e-9 || !hp) return 0; return Math.abs(rsArea(rsClipAll(q, hp))) / A; }
const rsBox = (pts) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x0 <= x1 ? [x0, y0, x1, y1] : null; };
const rsBoxAnd = (a, b) => (!a ? b : !b ? a : [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
const rsCorners = (b) => [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
// A box in user space through a matrix, as a box on the page.
const rsBoxThrough = (m, b) => rsBox(rsCorners(b).map(([x, y]) => apply(m, x, y)));
const rsInside = (area, b) => rsCorners(b).every(([x, y]) => inQuad(area.q, x, y));
const rsNum = (n) => { const s = String(Math.round(n * 10000) / 10000); return s === '-0' ? '0' : s; };
const rsPolyOps = (P, close) => `${rsNum(P[0][0])} ${rsNum(P[0][1])} m ${P.slice(1).map(([x, y]) => `${rsNum(x)} ${rsNum(y)} l`).join(' ')}${close ? ' h' : ''}`;
// A cubic curve as a line, in steps small enough not to show (about every 1.5 pt on the page).
function rsFlatten(p0, p1, p2, p3, ctm) {
  const d = [p0, p1, p2, p3].map(([x, y]) => apply(ctm, x, y));
  let len = 0; for (let k = 1; k < 4; k++) len += Math.hypot(d[k][0] - d[k - 1][0], d[k][1] - d[k - 1][1]);
  const n = Math.max(4, Math.min(128, Math.ceil(len / 1.5))), out = [];
  for (let k = 1; k <= n; k++) {
    const t = k / n, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]]);
  }
  return out;
}
// A path being built in a content stream (m l c v y re h), in user space, with curves flattened.
function rsPathOp(path, o, n, start, ctm) {
  path = path || { start, subs: [] };
  const sub = () => path.subs[path.subs.length - 1];
  const cur = () => { const s = sub(); return s ? s.pts[s.pts.length - 1] : [0, 0]; };
  const open = () => { const s = sub(); if (!s || s.closed) path.subs.push({ pts: [s ? s.pts[0] : [0, 0]], closed: false }); return sub(); };
  if (o === 'm') path.subs.push({ pts: [[n(0), n(1)]], closed: false });
  else if (o === 'l') open().pts.push([n(0), n(1)]);
  else if (o === 'c') { const p0 = cur(); open().pts.push(...rsFlatten(p0, [n(0), n(1)], [n(2), n(3)], [n(4), n(5)], ctm)); }
  else if (o === 'v') { const p0 = cur(); open().pts.push(...rsFlatten(p0, p0, [n(0), n(1)], [n(2), n(3)], ctm)); }
  else if (o === 'y') { const p0 = cur(); open().pts.push(...rsFlatten(p0, [n(0), n(1)], [n(2), n(3)], [n(2), n(3)], ctm)); }
  else if (o === 're') { const x = n(0), y = n(1), w = n(2), h = n(3); path.subs.push({ pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true }); }
  else if (o === 'h') { const s = sub(); if (s) s.closed = true; }
  return path;
}
const RS_PATH_OPS = new Set(['m', 'l', 'c', 'v', 'y', 're', 'h']);
const RS_PAINT_OPS = new Set(['f', 'F', 'f*', 'S', 's', 'B', 'B*', 'b', 'b*', 'n']);
/* A path painted (f, S, B…) under redaction areas: null to keep it, ' ' to take it out (all of it is under a box), or
   its new drawing: the shapes with the boxes cut out of them (filled), then the lines without the parts in the
   boxes (stroked), so nothing inside a box is left in the file and everything outside looks the same. */
function rsPaint(path, o, ctm, lw, areas) {
  const fill = /^(f|F|f\*|B|B\*|b|b\*)$/.test(o), stroke = /^(S|s|B|B\*|b|b\*)$/.test(o), close = /^(s|b|b\*)$/.test(o);
  const dev = path.subs.filter((s) => s.pts.length).map((s) => ({ pts: s.pts.map(([x, y]) => apply(ctm, x, y)), closed: s.closed || close }));
  let bb = rsBox(dev.flatMap((s) => s.pts)); if (!bb) return null;
  const half = stroke ? Math.max(.5, lw * Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) / 2) : 0;
  bb = [bb[0] - half, bb[1] - half, bb[2] + half, bb[3] + half];
  const hits = areas.filter((a) => protOverlap(a.box, bb));
  if (!hits.length) return null;
  if (hits.some((a) => rsInside(a, bb))) return ' ';
  const inv = protInv(ctm); if (!inv) return ' ';
  let polys = fill ? dev.filter((s) => s.pts.length >= 3).map((s) => s.pts) : [];
  let lines = stroke ? dev.filter((s) => s.pts.length >= 2 || s.closed).map((s) => (s.closed ? [...s.pts, s.pts[0]] : s.pts)) : [];
  for (const a of hits) {
    const hp = a.hp !== undefined ? a.hp : (a.hp = rsHalfPlanes(a.q)); if (!hp) continue;
    polys = polys.flatMap((P) => rsSubtract(P, hp)); lines = lines.flatMap((l) => rsSubtractLine(l, hp));
  }
  const back = (P) => P.map(([x, y]) => apply(inv, x, y));
  let r = ' ';
  if (polys.length) r += polys.map((P) => rsPolyOps(back(P), true)).join(' ') + (/\*/.test(o) ? ' f* ' : ' f ');
  if (lines.length) r += lines.map((l) => rsPolyOps(back(l), false)).join(' ') + ' S ';
  return r;
}
// What a shading (sh) paints, on the page: inside the clip, and inside its own BBox when it has one. Null: no bound.
function rsShadingBox(L, out, res, name, ctm, clip) {
  const { PDFName, PDFDict, PDFStream } = L;
  let bb = null;
  try {
    const sd = res && res.lookup(PDFName.of('Shading')), sh = sd instanceof PDFDict ? sd.lookup(PDFName.of(name)) : null;
    const d = sh instanceof PDFStream ? sh.dict : sh instanceof PDFDict ? sh : null, b = d && d.lookup(PDFName.of('BBox'));
    const nums = b && protNums(out, b); if (nums && nums.length === 4) bb = rsBoxThrough(ctm, [Math.min(nums[0], nums[2]), Math.min(nums[1], nums[3]), Math.max(nums[0], nums[2]), Math.max(nums[1], nums[3])]);
  } catch {}
  return rsBoxAnd(clip, bb);
}

/* ----- letters ----- */
// A font's extent above and below the baseline (in text space per point of size) and the scale of its widths:
// 1/1000 for most fonts, the FontMatrix for a Type 3 font (whose letters are little drawings).
function rsFontMetrics(L, out, f) {
  if (!f) return { asc: .8, desc: -.2, k: .001 };
  if (f.rsMetrics) return f.rsMetrics;
  const { PDFName, PDFDict, PDFArray, PDFNumber } = L, N = PDFName.of;
  const num = (x) => { const v = x && out.context.lookup(x); return v instanceof PDFNumber ? v.asNumber() : null; };
  let asc = null, desc = null, k = .001;
  try {
    const d = out.context.lookup(f.ref);
    if (String(d.lookup(N('Subtype'))) === '/Type3') {
      const fm = d.lookup(N('FontMatrix')), m = fm instanceof PDFArray ? fm.asArray().map(num) : null;
      if (m && m[0]) k = Math.abs(m[0]);
      const bb = d.lookup(N('FontBBox')), b = bb instanceof PDFArray ? bb.asArray().map(num) : null, ky = m && m[3] ? Math.abs(m[3]) : k;
      if (b && b.every((x) => x != null) && (b[3] - b[1]) > 0) { asc = Math.max(b[1], b[3]) * ky; desc = Math.min(b[1], b[3]) * ky; }
    } else {
      let fd = d.lookup(N('FontDescriptor'));
      if (!(fd instanceof PDFDict)) { const df = d.lookup(N('DescendantFonts')), cid = df instanceof PDFArray ? df.lookup(0) : null; fd = cid instanceof PDFDict ? cid.lookup(N('FontDescriptor')) : null; }
      if (fd instanceof PDFDict) { asc = num(fd.get(N('Ascent'))); desc = num(fd.get(N('Descent'))); if (asc != null) asc /= 1000; if (desc != null) desc /= 1000; }
    }
  } catch {}
  if (!(asc > .3 && asc < 1.6)) asc = .8;
  if (!(desc <= 0 && desc > -.6)) desc = -.2;
  return (f.rsMetrics = { asc, desc, k });
}
// Whether a redaction takes a letter out: its middle is under a box, or a box covers more than a tenth of it.
function rsGlyphHit(areas, M, x0, x1, y0, y1) {
  const q = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => apply(M, x, y)), b = rsBox(q);
  const [cx, cy] = apply(M, (x0 + x1) / 2, y0 + (y1 - y0) * .4);
  for (const a of areas) {
    if (inQuad(a.q, cx, cy)) return true;
    if (!b || !protOverlap(a.box, b)) continue;
    if (a.hp === undefined) a.hp = rsHalfPlanes(a.q);
    if (rsCovered(q, a.hp) > .1) return true;
  }
  return false;
}

/* ----- marked content ----- */
// The keys of a marked-content property list that carry text: what is spoken or copied instead of the content.
const RS_TEXT_KEYS = ['ActualText', 'Alt', 'E'];
// An inline property list (<< … >> in the content stream) without those keys.
function rsScrubProps(raw) {
  const toks = tokenizeContent(raw), cut = [];
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'dict<' || t.t === '[') { depth++; continue; }
    if (t.t === 'dict>' || t.t === ']') { depth--; continue; }
    if (depth !== 1 || t.t !== 'name' || !RS_TEXT_KEYS.includes(t.v)) continue;
    // the value: one token, or a whole dictionary or array
    let j = i + 1, d = 0;
    for (; j < toks.length; j++) { const v = toks[j]; if (v.t === 'dict<' || v.t === '[') d++; else if (v.t === 'dict>' || v.t === ']') d--; if (d <= 0) break; }
    if (j >= toks.length) break;
    cut.push([t.start, toks[j].end]); i = j;
  }
  for (const [s, e] of cut.reverse()) raw = raw.slice(0, s) + ' ' + raw.slice(e);
  return raw;
}
function rsMcInfo(st, key) {
  const m = (st.ctx.rsMc ||= new Map());
  return m.get(key) || m.set(key, { hit: new Set(), gone: new Set() }).get(key);
}
// The marked-content sequences open while the content is rewritten: what happens inside them is noted, and when one
// ends after something in it was removed its text goes (and, when nothing is left in it, its link to the tags).
function rsMarked(st, src, res, mcKey, edits) {
  const stack = [];
  return {
    stack,
    hit() { for (const s of stack) s.hit = true; },
    kept() { for (const s of stack) s.kept++; },
    open(o, a, start, end) {
      if (o === 'BMC') { stack.push({ plain: true, hit: false, kept: 0 }); return; }
      const s = { tag: a[0] && a[0].t === 'name' ? a[0].v : 'Span', start, end, hit: false, kept: 0, mcid: null };
      if (a[1] && a[1].t === 'dict<') { s.inline = [a[1].start, a[a.length - 1].end]; const m = /\/MCID\s+(\d+)/.exec(src.slice(s.inline[0], s.inline[1])); if (m) s.mcid = +m[1]; }
      else if (a[1] && a[1].t === 'name') {
        s.named = a[1].v;
        const d = rsPropsDict(st.L, res, s.named), id = d && d.lookup(st.L.PDFName.of('MCID'));
        if (id instanceof st.L.PDFNumber) s.mcid = id.asNumber();
      }
      stack.push(s);
    },
    close() {
      const s = stack.pop();
      if (!s || s.plain || !s.hit || s.tag === 'OC') return; // an optional-content sequence only says which layer
      const info = mcKey != null && s.mcid != null ? rsMcInfo(st, mcKey) : null;
      const empty = s.kept === 0;
      if (info) (empty ? info.gone : info.hit).add(s.mcid);
      st.ctx.rsMcHit = true;
      if (empty) { edits.push([s.start, s.end, ` /${s.tag} BMC `]); return; } // nothing left: no MCID, no text
      if (s.inline) { const raw = src.slice(s.inline[0], s.inline[1]), clean = rsScrubProps(raw); if (clean !== raw) edits.push([s.inline[0], s.inline[1], clean]); }
      else if (s.named) rsScrubNamedProps(st, res, s.named);
    },
  };
}
function rsPropsDict(L, res, name) {
  const { PDFName, PDFDict } = L;
  const pr = res && res.lookup(PDFName.of('Properties')); if (!(pr instanceof PDFDict)) return null;
  const d = pr.lookup(PDFName.of(name)); return d instanceof PDFDict ? d : null;
}
// A named property list (in the resources' /Properties) is copied for this page or form and the copy cleaned, so
// other pages that use it keep theirs.
function rsScrubNamedProps(st, res, name) {
  const { L, out } = st, { PDFName, PDFDict } = L, N = PDFName.of;
  let pr = res.lookup(N('Properties')); if (!(pr instanceof PDFDict)) return;
  const done = (st.rsProps ||= new WeakSet());
  if (!done.has(res)) { pr = pr.clone(out.context); res.set(N('Properties'), pr); done.add(res); }
  const d = pr.lookup(N(name)); if (!(d instanceof PDFDict)) return;
  if (!RS_TEXT_KEYS.some((k) => d.has(N(k)))) return;
  const c = d.clone(out.context); for (const k of RS_TEXT_KEYS) c.delete(N(k));
  pr.set(N(name), out.context.register(c));
}

/* ----- the structure tree ----- */
// Text in a PDF string, name or text stream.
function rsText(L, out, v) {
  const { PDFString, PDFHexString, PDFName, PDFRawStream, PDFStream } = L;
  v = v && out.context.lookup(v);
  if (v instanceof PDFString || v instanceof PDFHexString) { try { return v.decodeText(); } catch { return ''; } }
  if (v instanceof PDFName) return v.decodeText ? v.decodeText() : String(v).slice(1);
  if (v instanceof PDFStream) return protStreamText(L, v instanceof PDFRawStream ? v : v);
  return '';
}
const rsMatch = (rx, s) => { if (!rx || !s) return false; rx.lastIndex = 0; const r = rx.test(s); rx.lastIndex = 0; return r; };
// After redacting: elements whose content was removed lose the text that describes it (the box's text becomes
// their alternate text), elements left with no content go, and the parent tree no longer points at content that is
// gone or at elements that went. `ctx.rsMc` has, per StructParents key, the MCIDs hit and those left empty.
function rsScrubStruct(L, out, ctx, rx) {
  const { PDFName, PDFDict, PDFArray, PDFNumber, PDFRef, PDFNull, PDFHexString } = L, N = PDFName.of;
  const root = out.catalog.lookup(N('StructTreeRoot')); if (!(root instanceof PDFDict)) return 0;
  const mc = ctx.rsMc || new Map(), look = (x) => (x == null ? x : out.context.lookup(x));
  const spOf = (r) => { const d = look(r), n = d instanceof PDFDict ? d.lookup(N('StructParents')) : null; return n instanceof PDFNumber ? n.asNumber() : null; };
  const state = (key, id) => { const i = key == null ? null : mc.get(key); return !i ? 0 : i.gone.has(id) ? 2 : i.hit.has(id) ? 1 : 0; };
  const gone = new Set(); let changed = 0;
  const kidsOf = (node) => { const K = node.get(N('K')); if (K == null) return []; const k = look(K); return k instanceof PDFArray ? k.asArray() : [K]; };
  const setKids = (node, keep) => { if (!keep.length) node.delete(N('K')); else node.set(N('K'), keep.length === 1 ? keep[0] : out.context.obj(keep)); };
  const clear = (node, keys) => { let n = 0; for (const k of keys) if (node.has(N(k))) { node.delete(N(k)); n++; } return n; };
  const walk = (node, pg, depth) => {
    const myPg = node.get(N('Pg')) || pg, kids = kidsOf(node), keep = [];
    let hit = false, under = false;
    for (const kid of kids) {
      const kd = look(kid);
      if (kd instanceof PDFNumber) { const s = state(spOf(myPg), kd.asNumber()); if (s) hit = true; if (s !== 2) keep.push(kid); continue; }
      if (!(kd instanceof PDFDict)) { if (kid instanceof PDFRef && kd === undefined) { hit = true; continue; } keep.push(kid); continue; }
      const type = String(kd.lookup(N('Type')) || '');
      if (type === '/MCR') {
        const id = kd.lookup(N('MCID')), stm = kd.get(N('Stm')), key = stm ? spOf(stm) : spOf(kd.get(N('Pg')) || myPg);
        const s = id instanceof PDFNumber ? state(key, id.asNumber()) : 0; if (s) hit = true; if (s !== 2) keep.push(kid); continue;
      }
      if (type === '/OBJR') { const o = kd.get(N('Obj')); if (o instanceof PDFRef && !look(o)) { hit = true; continue; } keep.push(kid); continue; }
      if (depth > 200) { keep.push(kid); continue; }
      const r = walk(kd, myPg, depth + 1);
      if (r.hit || r.under) under = true;
      if (r.empty) { gone.add(kd); changed++; continue; }
      keep.push(kid);
    }
    if (keep.length !== kids.length) setKids(node, keep);
    // Its own text, when it has a redacted word in it
    if (!hit && rx && ['Alt', 'ActualText', 'E', 'T'].some((k) => rsMatch(rx, rsText(L, out, node.get(N(k)))))) hit = true;
    if (hit) { changed += clear(node, ['Alt', 'ActualText', 'E', 'T']); if (ctx.protLabel) node.set(N('Alt'), PDFHexString.fromText(ctx.protLabel)); }
    else if (under) changed += clear(node, ['Alt', 'ActualText', 'E']); // what it says of its content may say what was redacted
    return { hit, under, empty: kids.length > 0 && keep.length === 0 };
  };
  const top = kidsOf(root), keepTop = [];
  for (const kid of top) { const kd = look(kid); if (kd instanceof PDFDict) { const r = walk(kd, null, 0); if (r.empty) { gone.add(kd); changed++; continue; } } keepTop.push(kid); }
  if (keepTop.length !== top.length) setKids(root, keepTop);
  // The parent tree: MCIDs left empty, and elements that went
  const isGone = (v) => { const d = look(v); return d instanceof PDFDict && gone.has(d); };
  const walkNums = (node, depth) => {
    if (!(node instanceof PDFDict) || depth > 40) return;
    const nums = node.lookup(N('Nums'));
    if (nums instanceof PDFArray) {
      for (let i = nums.size() - 2; i >= 0; i -= 2) {
        const k = look(nums.get(i)), v = look(nums.get(i + 1)), key = k instanceof PDFNumber ? k.asNumber() : null;
        if (v instanceof PDFArray) {
          const info = key != null ? mc.get(key) : null;
          for (let j = 0; j < v.size(); j++) if ((info && info.gone.has(j)) || isGone(v.get(j))) { v.set(j, PDFNull); changed++; }
        } else if (isGone(nums.get(i + 1))) { nums.remove(i + 1); nums.remove(i); changed++; }
      }
    }
    const kids = node.lookup(N('Kids')); if (kids instanceof PDFArray) for (const k of kids.asArray()) walkNums(look(k), depth + 1);
  };
  walkNums(root.lookup(N('ParentTree')), 0);
  return changed;
}

/* ----- hidden places: bookmarks, destinations, comments, form values, properties, metadata, attachments ----- */
// Walks a name tree, removing the entries `drop(name, value)` picks. Returns how many went.
function rsNameTree(L, out, node, drop, depth = 0) {
  const { PDFName, PDFDict, PDFArray } = L, N = PDFName.of;
  if (!(node instanceof PDFDict) || depth > 40) return 0;
  let n = 0;
  const names = node.lookup(N('Names'));
  if (names instanceof PDFArray) for (let i = names.size() - 2; i >= 0; i -= 2) if (drop(rsText(L, out, names.get(i)), names.get(i + 1))) { names.remove(i + 1); names.remove(i); n++; }
  const kids = node.lookup(N('Kids')); if (kids instanceof PDFArray) for (const k of kids.asArray()) n += rsNameTree(L, out, out.context.lookup(k), drop, depth + 1);
  return n;
}
// Bookmarks whose title `drop(title)` picks go, with the bookmarks under them; the counts are made right again.
function rsOutlines(L, out, drop) {
  const { PDFName, PDFDict, PDFNumber } = L, N = PDFName.of;
  const root = out.catalog.lookup(N('Outlines')); if (!(root instanceof PDFDict)) return 0;
  let n = 0;
  const childrenOf = (node) => { const list = []; let r = node.get(N('First')); const seen = new Set(); while (r && !seen.has(r)) { seen.add(r); const d = out.context.lookup(r); if (!(d instanceof PDFDict)) break; list.push([r, d]); r = d.get(N('Next')); } return list; };
  const fix = (node, depth) => {
    const kids = childrenOf(node).filter(([, d]) => { if (drop(rsText(L, out, d.get(N('Title'))))) { n++; return false; } return true; });
    kids.forEach(([r, d], k) => {
      if (k) d.set(N('Prev'), kids[k - 1][0]); else d.delete(N('Prev'));
      if (k < kids.length - 1) d.set(N('Next'), kids[k + 1][0]); else d.delete(N('Next'));
    });
    if (kids.length) { node.set(N('First'), kids[0][0]); node.set(N('Last'), kids[kids.length - 1][0]); } else { node.delete(N('First')); node.delete(N('Last')); }
    let visible = 0;
    for (const [, d] of kids) { const sub = depth < 60 ? fix(d, depth + 1) : 0, c = d.lookup(N('Count')), isOpen = !(c instanceof PDFNumber) || c.asNumber() > 0; visible += 1 + (isOpen ? sub : 0); if (sub) d.set(N('Count'), PDFNumber.of(isOpen ? sub : -sub)); else d.delete(N('Count')); }
    return visible;
  };
  const total = fix(root, 0);
  if (!root.get(N('First'))) out.catalog.delete(N('Outlines')); else root.set(N('Count'), PDFNumber.of(total));
  return n;
}
/* The hidden places that have a word matching `rx`: matching bookmarks, named destinations, comments and attached
   files go, form values and document properties lose the words. `pick` (a Set of "kind:id") limits it to the items
   chosen in Search and redact; null takes every match. Returns how many were changed. */
function rsCleanHidden(L, out, pages, rx, pick) {
  const { PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFStream, PDFBool } = L, N = PDFName.of, cat = out.catalog;
  const want = (kind, id) => !pick || pick.has(kind + ':' + id);
  const hit = (s) => rsMatch(rx, s);
  const cut = (s) => { rx.lastIndex = 0; const r = s.replace(rx, '').replace(/[ \t]{2,}/g, ' ').trim(); rx.lastIndex = 0; return r; };
  let n = 0;
  // bookmarks
  n += rsOutlines(L, out, (t) => hit(t) && want('bookmark', t));
  // named destinations (the name tree and the older /Dests dictionary)
  const names = cat.lookup(N('Names'));
  if (names instanceof PDFDict) {
    n += rsNameTree(L, out, names.lookup(N('Dests')), (name) => hit(name) && want('dest', name));
    // attached files, by their name, file name or description
    n += rsNameTree(L, out, names.lookup(N('EmbeddedFiles')), (name, v) => {
      const fs = out.context.lookup(v), fsd = fs instanceof PDFDict ? fs : null;
      const texts = [name, ...(fsd ? ['F', 'UF', 'Desc'].map((k) => rsText(L, out, fsd.get(N(k)))) : [])];
      return texts.some(hit) && want('attachment', name);
    });
  }
  const dests = cat.lookup(N('Dests'));
  if (dests instanceof PDFDict) for (const k of dests.keys()) { const name = k.decodeText ? k.decodeText() : String(k).slice(1); if (hit(name) && want('dest', name)) { dests.delete(k); n++; } }
  // comments (their text, author and subject) and attached-file comments (their file's name)
  for (const p of pages) n += protDropAnnots(L, out, p.node, (d, sub) => {
    if (sub === 'Widget' || sub === 'Link') return false;
    const fs = sub === 'FileAttachment' ? out.context.lookup(d.get(N('FS'))) : null;
    const texts = ['Contents', 'T', 'Subj', 'RC'].map((k) => rsText(L, out, d.get(N(k))));
    if (fs instanceof PDFDict) texts.push(...['F', 'UF', 'Desc'].map((k) => rsText(L, out, fs.get(N(k)))));
    const nm = rsText(L, out, d.get(N('NM')));
    return texts.some(hit) && (want('comment', nm) || want('comment', '*'));
  });
  // form values: the words are taken out of the value, and the field is drawn again by the reader
  const acro = cat.lookup(N('AcroForm'));
  if (acro instanceof PDFDict) {
    const seen = new Set(); let redraw = false;
    const field = (ref, prefix, depth) => {
      const d = out.context.lookup(ref); if (!(d instanceof PDFDict) || seen.has(d) || depth > 30) return; seen.add(d);
      const part = rsText(L, out, d.get(N('T'))), name = part ? (prefix ? prefix + '.' + part : part) : prefix;
      const v = d.lookup(N('V'));
      if ((v instanceof PDFString || v instanceof PDFHexString) && hit(v.decodeText()) && want('field', name)) {
        d.set(N('V'), PDFHexString.fromText(cut(v.decodeText()))); d.delete(N('AP')); redraw = true; n++;
      } else if (v instanceof PDFArray && v.asArray().some((x) => hit(rsText(L, out, x))) && want('field', name)) { d.delete(N('V')); d.delete(N('AP')); redraw = true; n++; }
      const kids = d.lookup(N('Kids'));
      if (kids instanceof PDFArray) for (const k of kids.asArray()) { const kd = out.context.lookup(k); if (redraw && kd instanceof PDFDict && !kd.has(N('T'))) kd.delete(N('AP')); field(k, name, depth + 1); }
    };
    const fields = acro.lookup(N('Fields')); if (fields instanceof PDFArray) for (const r of fields.asArray()) field(r, '', 0);
    if (redraw) acro.set(N('NeedAppearances'), PDFBool.True);
  }
  // document properties: the words are taken out (a property left empty goes)
  const info = out.context.lookup(out.context.trailerInfo.Info);
  if (info instanceof PDFDict) for (const k of info.keys()) {
    const key = String(k).slice(1), v = info.lookup(k);
    if (!(v instanceof PDFString || v instanceof PDFHexString) || !hit(v.decodeText()) || !want('info', key)) continue;
    const rest = cut(v.decodeText()); if (rest) info.set(k, PDFHexString.fromText(rest)); else info.delete(k); n++;
    // and the app doesn't put it back
    const setter = { Title: 'setTitle', Author: 'setAuthor', Subject: 'setSubject', Keywords: 'setKeywords' }[key]; if (setter) out[setter] = () => {};
  }
  // XMP metadata (the copy of the properties some apps keep): it goes when a word is in it
  for (const holder of [cat, ...pages.map((p) => p.node)]) {
    const md = holder.lookup(N('Metadata'));
    if (md instanceof PDFStream && hit(rsText(L, out, md)) && want('xmp', 'metadata')) { holder.delete(N('Metadata')); n++; }
  }
  return n;
}
// The words redactions were found by (Search and redact), as one pattern, or null.
function rsTermsRx(terms, flags = 'gi') {
  const list = [...new Set((terms || []).map((t) => String(t || '').trim()).filter((t) => t.length > 1))];
  if (!list.length) return null;
  try { return new RegExp(list.map((t) => `(?:${t})`).join('|'), flags.includes('g') ? flags : flags + 'g'); } catch { return null; }
}
const rsLiteral = (t) => protEscRe(String(t).trim()).replace(/\s+/g, '\\s+');
// The redacted words: every applied mark made from a search.
const rsRedactedTerms = () => [...new Set(protRedMarks(true).map(({ m }) => m.found).filter(Boolean))].map(rsLiteral);

/* ----- finding words in the hidden places, on screen (pdf.js) ----- */
// [{ hidden: { kind, id, where, entry?, a? }, text, before, after }]: one per bookmark, comment, field, property…
async function rsFindHidden(rx) {
  const found = [], add = (kind, id, where, s, extra = {}) => {
    if (!s) return;
    rx.lastIndex = 0; const m = rx.exec(s); rx.lastIndex = 0; if (!m) return;
    const near = (t) => t.replace(/\s+/g, ' ');
    found.push({ hidden: { kind, id, where, ...extra }, text: m[0], before: near(s.slice(Math.max(0, m.index - 40), m.index)), after: near(s.slice(m.index + m[0].length, m.index + m[0].length + 40)) });
  };
  for (const k of protUsedSources()) {
    const pd = pdfDocs.get(k); if (!pd) continue;
    try { const walk = (items, depth) => { for (const it of items || []) { add('bookmark', it.title, 'Bookmark', it.title); if (depth < 40) walk(it.items, depth + 1); } }; walk(await pd.getOutline(), 0); } catch {}
    try { for (const name of Object.keys((await pd.getDestinations()) || {})) add('dest', name, 'Named destination', name); } catch {}
    try { for (const a of Object.values((await pd.getAttachments()) || {})) add('attachment', a.filename, 'Attached file', [a.filename, a.description].filter(Boolean).join(' ')); } catch {}
    if (k === 0) try {
      const md = await pd.getMetadata(), info = md && md.info || {}, dm = docMarks().find((m) => m.type === 'docinfo') || {};
      for (const key of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer']) {
        const v = dm[key.toLowerCase()] ?? info[key]; add('info', key, `Document properties: ${key}`, typeof v === 'string' ? v : '');
      }
      const raw = md && md.metadata && md.metadata.getRaw ? md.metadata.getRaw() : '';
      if (raw) add('xmp', 'metadata', 'XMP metadata', String(raw).replace(/<[^>]+>/g, ' '));
    } catch {}
  }
  // comments on the pages: from other apps (pdf.js reads them), and the ones made here
  const seen = new Set(), fields = new Set();
  for (const entry of doc.pages) {
    const key = pageKey(entry); if (seen.has(key)) continue; seen.add(key);
    const n = doc.pages.indexOf(entry) + 1, list = marksOf(entry);
    try {
      for (const a of await (await pageOf(entry)).getAnnotations()) {
        if (a.subtype === 'Widget' && a.fieldName && !fields.has(a.fieldName)) {
          // a form value: as typed here, or as the PDF has it
          let v = a.fieldValue; try { const sv = pdfDocs.get(entry.src).annotationStorage.getValue(a.id, { value: v }); if (sv && sv.value !== undefined) v = sv.value; } catch {}
          const s = Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : '';
          if (s) { fields.add(a.fieldName); add('field', a.fieldName, `Form field “${a.fieldName}”`, s); }
          continue;
        }
        if (/^(Widget|Link|Popup)$/.test(a.subtype) || list.some((x) => x.type === 'ae' && x.ref === a.id && x.deleted)) continue;
        add('comment', a.id, `Comment, page ${n}`, [a.contentsObj && a.contentsObj.str, a.titleObj && a.titleObj.str, a.subject].filter(Boolean).join(' · '), { entry, a: { id: a.id, rect: a.rect, subtype: a.subtype } });
      }
    } catch {}
    for (const m of list) if (typeof m.text === 'string' && m.type !== 'redact' && !CONTENT_TYPES.has(m.type)) add('mark', m.id, `Comment, page ${n}`, m.text, { entry });
  }
  return found;
}
// Chosen hidden matches: comments are deleted now (as the Edit tool deletes them); the rest is edited or removed
// when the PDF is saved. Inside the caller's snapshot()/changed().
function rsMarkHidden(items, rx) {
  const later = [];
  for (const f of items) {
    const h = f.hidden;
    if (h.kind === 'mark') { const list = marksOf(h.entry), k = list.findIndex((m) => m.id === h.id); if (k >= 0) list.splice(k, 1); continue; }
    if (h.kind === 'comment') { const list = marksOf(h.entry), ae = list.find((x) => x.type === 'ae' && x.ref === h.a.id); if (ae) ae.deleted = true; else list.push({ id: uid(), type: 'ae', ref: h.a.id, rect: h.a.rect, subtype: h.a.subtype || '', deleted: true }); continue; }
    later.push({ kind: h.kind, id: h.id });
  }
  if (later.length) {
    const list = docMarks(), cur = list.find((m) => m.type === 'protscrub');
    const items0 = cur ? cur.items : [], terms = new Set([...(cur ? cur.terms : []), rx.source]);
    const next = { id: cur ? cur.id : uid(), type: 'protscrub', items: [...items0, ...later.filter((x) => !items0.some((y) => y.kind === x.kind && y.id === x.id))], terms: [...terms], flags: rx.flags };
    if (cur) list.splice(list.indexOf(cur), 1);
    list.push(next);
  }
  try { syncHiddenComments(); } catch {}
}
function rsApplyScrubMark(L, out, pages) {
  const m = protDM('protscrub'); if (!m || !m.items || !m.items.length) return 0;
  const rx = rsTermsRx(m.terms, m.flags || 'gi'); if (!rx) return 0;
  return rsCleanHidden(L, out, pages, rx, new Set(m.items.map((x) => x.kind + ':' + x.id)));
}

/* ----- the document properties dialog: its Security section offers the permissions password ----- */
new MutationObserver(() => {
  const dlg = $('#dialog'); if (!dlg || !dlg.open || !dlg.classList.contains('di-dlg') || $('.prot-unlock', dlg)) return;
  if (typeof protNeedsUnlock !== 'function' || !protNeedsUnlock()) return;
  const h = $$('.di-h', dlg).find((x) => /Security/.test(x.textContent)); if (!h) return;
  const dl = h.nextElementSibling, b = document.createElement('button');
  b.type = 'button'; b.className = 'btn prot-unlock'; b.textContent = 'Enter permissions password…';
  b.onclick = () => { const x = $('[data-x]', dlg); if (x) x.click(); setTimeout(() => run('protOwnerPw'), 0); };
  (dl || h).after(b);
}).observe(document.getElementById('dialog') || document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ['open', 'class'] });
addStyle('.prot-unlock { margin: 6px 0 2px; }');

TEST_HOOKS.rsFindHidden = async (opts) => (await rsFindHidden(protRegex(opts))).map((f) => [f.hidden.kind, f.hidden.id, f.text]);
Object.assign(TEST_HOOKS, { rsSubtract: (P, q) => rsSubtract(P, rsHalfPlanes(q)), rsSubtractLine: (l, q) => rsSubtractLine(l, rsHalfPlanes(q)), rsCovered: (g, q) => rsCovered(g, rsHalfPlanes(q)), rsScrubProps });
