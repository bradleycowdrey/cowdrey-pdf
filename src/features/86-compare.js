/* ---------------- Compare: two versions of a PDF ----------------
   File → "Compare with another PDF…" (and Home → Review) sets the open document (New) against another PDF (Old).
   The other PDF is read with pdf.js only, on this device: it is not added to the document, and nothing of it is kept.

   1. Pages are lined up first. Each page's words make a set of three-word runs (shingles); an LCS over how alike the
      pages are (Jaccard) pairs them, so a page put in or taken out is reported as "Page inserted" or "Page removed"
      and the pages after it are still compared with their own counterparts. Pages without text (scans) are compared
      by a small picture of them.
   2. Each pair of pages: the words (pdf.js text content, each word's box worked out in proportion inside its piece of
      text, as Find does) are diffed with Myers' O(ND) algorithm, and the runs of changes are Added, Removed or
      Changed. Options: case, punctuation, spacing, the top and bottom 6% (headers and footers), and font or size
      changes ("formatting", from each piece's font and height).
   3. Pictures and drawings: both pages are drawn at 100 dpi; the pixels that differ by more than 32 outside the text
      (which step 2 covers) are grown a little and gathered into boxes larger than 6 x 6 px. Always on for pages
      without text.
   4. The compare view: Old and New side by side, scrolled and zoomed together (each row is as tall as the taller page
      of its pair, so one scroll position shows the same pair on both sides), the changes coloured (added green,
      removed red, changed amber, pictures blue), a list of them by page with filters, and [ and ] to step through.
      Overlay shows New with Old faint behind it. Phones show one side at a time.
   5. "Save compare report": a copy of New (or Old) with each change as a comment (Highlight, StrikeOut, Caret,
      Square, or a label for a whole page) whose text says what it was and is now, after a cover page with the counts.
      It is made with pdf-lib from the bytes, never through the open document's marks, so the document stays as it
      was. "Copy change list" copies the same list as text. */

const CMP_DPI = 100, CMP_DIFF = 32, CMP_EDGE = 0.06, CMP_GROW = 2;
const CMP_KIND = {
  insert: { label: 'Added', name: 'Text added', rgb: [0.18, 0.62, 0.27] },
  delete: { label: 'Removed', name: 'Text removed', rgb: [0.88, 0.19, 0.19] },
  replace: { label: 'Changed', name: 'Text changed', rgb: [0.96, 0.6, 0.05] },
  format: { label: 'Formatting', name: 'Formatting changed', rgb: [0.96, 0.6, 0.05] },
  visual: { label: 'Picture', name: 'Picture or drawing changed', rgb: [0.11, 0.49, 0.84] },
  pageInsert: { label: 'Page', name: 'Page inserted', rgb: [0.18, 0.62, 0.27] },
  pageRemove: { label: 'Page', name: 'Page removed', rgb: [0.88, 0.19, 0.19] },
};
const CMP_FILTERS = [['insert', 'Added'], ['delete', 'Removed'], ['replace', 'Changed'], ['format', 'Formatting'], ['visual', 'Pictures'], ['page', 'Pages']];
const cmpFilterOf = (k) => (k === 'pageInsert' || k === 'pageRemove' ? 'page' : k);
const cmpOpts = Object.assign({ ignoreCase: false, ignorePunct: false, ignoreSpace: true, ignoreHeadFoot: false, format: false, visual: true }, store.get('compare', {}));
let cmp = null; // the comparison on screen (see cmpOpen)
let cmpBusy = false;

/* --- the two sides --- */
// The open document (its pages as they are now: order, rotation; its own mark-up is not compared).
function cmpDocSide() {
  const d = doc;
  return { name: d.name, count: d.pages.length, fromDoc: true, d, data: [], date: d.mtime ? new Date(d.mtime) : null,
    page: (k) => pageOf(d.pages[k]), rot: (k, pg) => (pg.rotate + d.pages[k].rot) % 360 };
}
function cmpFileSide(pd, bytes, name, date) {
  return { name: String(name || 'Other PDF').replace(/\.pdf$/i, ''), count: pd.numPages, pd, bytes, data: [], date: date || null,
    page: (k) => pd.getPage(k + 1), rot: (k, pg) => pg.rotate };
}
// A word's box: a run of letters [a, b) of a piece of text, in proportion to its width (as Find does). PDF points:
// bottom-left, bottom-right, top-right, top-left, along the text's own direction.
// Where each letter of a piece of text starts: the piece's width shared out by how wide its letters are in a font of
// the same kind (measured once per piece), which places words much better than equal shares.
const cmpMeasure = document.createElement('canvas').getContext('2d'), cmpOffs = new WeakMap();
function cmpOffsets(it, styles) {
  let o = cmpOffs.get(it); if (o) return o;
  const s = it.str, n = s.length, w = it.width || 0;
  o = new Float64Array(n + 1);
  if (n <= 400) {
    const st = styles && styles[it.fontName];
    cmpMeasure.font = `100px ${st && st.fontFamily ? st.fontFamily : 'sans-serif'}`;
    for (let k = 1; k <= n; k++) o[k] = cmpMeasure.measureText(s.slice(0, k)).width;
  }
  const total = o[n];
  for (let k = 0; k <= n; k++) o[k] = total > 0 ? o[k] * w / total : w * k / n;
  cmpOffs.set(it, o);
  return o;
}
function cmpQuad(it, a, b, styles) {
  const t = it.transform; if (!t || !it.str) return null;
  let ux = t[0], uy = t[1]; const len = Math.hypot(ux, uy) || 1; ux /= len; uy /= len;
  const size = Math.hypot(t[2], t[3]) || it.height || 10, off = cmpOffsets(it, styles), da = off[a], db = off[b];
  const vx = -uy, vy = ux, dn = size * 0.25, up = size * 0.9;
  const x0 = t[4] + ux * da, y0 = t[5] + uy * da, x1 = t[4] + ux * db, y1 = t[5] + uy * db;
  return [[x0 - vx * dn, y0 - vy * dn], [x1 - vx * dn, y1 - vy * dn], [x1 + vx * up, y1 + vy * up], [x0 + vx * up, y0 + vy * up]];
}
const cmpBox = (qs) => { const xs = qs.flat().map((p) => p[0]), ys = qs.flat().map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
// One page of a side, read once: its words (with boxes and font), the boxes of its pieces of text, its size.
async function cmpRead(side, k) {
  if (side.data[k]) return side.data[k];
  const page = await side.page(k), tc = await page.getTextContent();
  const { s, map } = findIndexOf(tc), words = [];
  for (const m of s.matchAll(/\S+/g)) {
    const parts = [];
    for (let c = m.index; c < m.index + m[0].length; c++) {
      const x = map[c]; if (!x) continue;
      const l = parts[parts.length - 1];
      if (l && l[0] === x[0] && l[2] === x[1]) l[2]++; else parts.push([x[0], x[1], x[1] + 1]);
    }
    const quads = parts.map(([i, a, b]) => cmpQuad(tc.items[i], a, b, tc.styles)).filter(Boolean);
    if (!quads.length) continue;
    const it = tc.items[parts[0][0]], bb = cmpBox(quads);
    words.push({ t: m[0], quads, fid: it.fontName, size: Math.round((it.height || 0) * 2) / 2, cy: (bb[1] + bb[3]) / 2 });
  }
  const boxes = tc.items.filter((it) => it.str && it.str.trim() && it.transform).map((it) => cmpQuad(it, 0, it.str.length, tc.styles)).filter(Boolean);
  return (side.data[k] = { page, view: page.view, words, boxes });
}
// The fonts' own names (pdf.js names them g_d0_f1… per document): read from the page's fonts once they are loaded.
async function cmpFontNames(dat) {
  if (dat.fonts) return dat.fonts;
  try { await dat.page.getOperatorList(); } catch {}
  const names = {};
  for (const w of dat.words) {
    if (w.fid in names) continue;
    let n = '';
    try { if (dat.page.commonObjs.has(w.fid)) { const f = dat.page.commonObjs.get(w.fid); n = baseName(f && (f.name || f.loadedName) || ''); } } catch {}
    names[w.fid] = n || w.fid;
  }
  return (dat.fonts = names);
}

/* --- what is compared --- */
function cmpKey(t, o) {
  let s = t.normalize('NFKC').replace(/[‘’‚‛]/g, "'").replace(/[“”„‟]/g, '"').replace(/[‐‑‒–—]/g, '-');
  if (o.ignoreCase) s = s.toLocaleLowerCase();
  if (o.ignorePunct) s = s.replace(/[\p{P}\p{S}]/gu, '');
  return s;
}
function cmpWords(dat, o) {
  const [, y0, , y1] = dat.view, h = y1 - y0;
  return dat.words.filter((w) => !o.ignoreHeadFoot || (w.cy > y0 + h * CMP_EDGE && w.cy < y1 - h * CMP_EDGE))
    .map((w) => ({ ...w, key: cmpKey(w.t, o) })).filter((w) => w.key);
}
function cmpShingles(ws) {
  const keys = ws.map((w) => w.key.toLowerCase()), set = new Set();
  if (keys.length < 3) keys.forEach((k) => set.add(k));
  else for (let i = 0; i + 2 < keys.length; i++) set.add(keys[i] + '\u0001' + keys[i + 1] + '\u0001' + keys[i + 2]);
  return set;
}
function cmpJaccard(a, b) {
  if (!a.size || !b.size) return a.size || b.size ? 0 : null;
  const [sm, lg] = a.size < b.size ? [a, b] : [b, a]; let n = 0;
  for (const x of sm) if (lg.has(x)) n++;
  return n / (a.size + b.size - n);
}
// A page without text, as 32 x 32 grey levels (to tell scans apart).
async function cmpThumb(dat) {
  if (dat.thumb) return dat.thumb;
  const vp0 = dat.page.getViewport({ scale: 1, rotation: 0 }), vp = dat.page.getViewport({ scale: 64 / Math.max(vp0.width, vp0.height), rotation: 0 });
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  try { await dat.page.render({ canvas: c, canvasContext: g, viewport: vp }).promise; } catch {}
  const t = document.createElement('canvas'); t.width = t.height = 32;
  const tg = t.getContext('2d', { willReadFrequently: true }); tg.drawImage(c, 0, 0, 32, 32);
  const d = tg.getImageData(0, 0, 32, 32).data, out = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) out[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
  return (dat.thumb = out);
}

/* --- lining the pages up --- */
// Pairs [old, new] in order, with null for a page only one side has. sim(i, j) is 0..1.
function cmpAlign(nO, nN, sim) {
  const S = new Map(), at = (i, j) => { const k = i * (nN + 1) + j; if (!S.has(k)) S.set(k, sim(i, j)); return S.get(k); };
  // The best-scoring common subsequence of pages alike by at least thr, over old [o0, o1) and new [n0, n1).
  const lcs = (o0, o1, n0, n1, thr) => {
    const R = o1 - o0, Cn = n1 - n0; if (R <= 0 || Cn <= 0) return [];
    const W = Cn + 1, D = new Float64Array((R + 1) * W);
    for (let i = R - 1; i >= 0; i--) for (let j = Cn - 1; j >= 0; j--) {
      const s = at(o0 + i, n0 + j); let best = Math.max(D[(i + 1) * W + j], D[i * W + j + 1]);
      if (s >= thr) best = Math.max(best, D[(i + 1) * W + j + 1] + s);
      D[i * W + j] = best;
    }
    const out = []; let i = 0, j = 0;
    while (i < R && j < Cn) {
      const s = at(o0 + i, n0 + j);
      if (s >= thr && Math.abs(D[i * W + j] - (D[(i + 1) * W + j + 1] + s)) < 1e-9) { out.push([o0 + i, n0 + j]); i++; j++; }
      else if (D[(i + 1) * W + j] >= D[i * W + j + 1]) i++; else j++;
    }
    return out;
  };
  const pairs = [];
  // Between two matched pages: pages a little alike are paired too; as many on each side are taken as rewritten pages.
  const gap = (o0, o1, n0, n1) => {
    let a = o0, b = n0;
    for (const [x, y] of [...lcs(o0, o1, n0, n1, 0.05), [o1, n1]]) {
      const ro = x - a, rn = y - b;
      if (ro === rn) for (let k = 0; k < ro; k++) pairs.push([a + k, b + k]);
      else { for (let k = 0; k < ro; k++) pairs.push([a + k, null]); for (let k = 0; k < rn; k++) pairs.push([null, b + k]); }
      if (x < o1) pairs.push([x, y]);
      a = x + 1; b = y + 1;
    }
  };
  let po = 0, pn = 0;
  for (const [x, y] of lcs(0, nO, 0, nN, 0.2)) { gap(po, x, pn, y); pairs.push([x, y]); po = x + 1; pn = y + 1; }
  gap(po, nO, pn, nN);
  return pairs;
}

/* --- Myers' diff (An O(ND) Difference Algorithm and Its Variations, 1986) --- */
// a, b: arrays of numbers. Returns the edit script in order: [0, i, j] same, [-1, i] only in a, [1, j] only in b.
// null when the two differ in more than `most` places (then the whole page is one change).
function cmpMyers(a, b, most = 6000) {
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length; while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const N = ea - s, M = eb - s, ops = [];
  for (let i = 0; i < s; i++) ops.push([0, i, i]);
  if (!N) for (let j = 0; j < M; j++) ops.push([1, s + j]);
  else if (!M) for (let i = 0; i < N; i++) ops.push([-1, s + i]);
  else {
    const A = (i) => a[s + i], B = (j) => b[s + j], MAX = Math.min(N + M, most), off = MAX + 1;
    const v = new Int32Array(2 * MAX + 3), trace = [];
    let D = -1;
    outer: for (let d = 0; d <= MAX; d++) {
      trace.push(v.slice(off - d - 1, off + d + 2)); // v[k] for k in [-d-1, d+1], before step d
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1, y = x - k;
        while (x < N && y < M && A(x) === B(y)) { x++; y++; }
        v[off + k] = x;
        if (x >= N && y >= M) { D = d; break outer; }
      }
    }
    if (D < 0) return null;
    const mid = []; let x = N, y = M;
    for (let d = D; d > 0; d--) {
      const t = trace[d], V = (k) => t[k + d + 1], k = x - y;
      const pk = k === -d || (k !== d && V(k - 1) < V(k + 1)) ? k + 1 : k - 1, px = V(pk), py = px - pk;
      while (x > px && y > py) { mid.push([0, s + x - 1, s + y - 1]); x--; y--; }
      if (x === px) mid.push([1, s + py]); else mid.push([-1, s + px]);
      x = px; y = py;
    }
    while (x > 0 && y > 0) { mid.push([0, s + x - 1, s + y - 1]); x--; y--; }
    ops.push(...mid.reverse());
  }
  for (let i = ea, j = eb; i < a.length; i++, j++) ops.push([0, i, j]);
  return ops;
}

/* --- one pair of pages --- */
// A thin box where text was taken out (or put in on the other side): after word `before` (or before the first word).
function cmpGapQuad(ws, before) {
  const prev = ws[before], next = ws[before + 1];
  const q = prev ? prev.quads[prev.quads.length - 1] : next ? next.quads[0] : null; if (!q) return null;
  const [p, t] = prev ? [q[1], q[2]] : [q[0], q[3]];
  let ux = q[1][0] - q[0][0], uy = q[1][1] - q[0][1]; const l = Math.hypot(ux, uy) || 1; ux /= l; uy /= l;
  const w = Math.max(2, Math.hypot(t[0] - p[0], t[1] - p[1]) * 0.18), sx = prev ? 0.5 : -w - 0.5;
  const a = [p[0] + ux * sx, p[1] + uy * sx], b = [t[0] + ux * sx, t[1] + uy * sx];
  return [a, [a[0] + ux * w, a[1] + uy * w], [b[0] + ux * w, b[1] + uy * w], b];
}
const cmpJoin = (ws) => ws.map((w) => w.t).join(' ');
function cmpTextChanges(A, B, o, fontsA, fontsB) {
  const ids = new Map(), id = (k) => { if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
  const a = A.map((w) => id(w.key)), b = B.map((w) => id(w.key));
  let ops = cmpMyers(a, b);
  if (!ops) ops = [...A.map((_, i) => [-1, i]), ...B.map((_, j) => [1, j])];
  const out = []; let run = null, fmt = null, li = -1, lj = -1;
  const endRun = () => {
    if (!run) return;
    const del = run.del.map((i) => A[i]), ins = run.ins.map((j) => B[j]);
    const kind = del.length && ins.length ? 'replace' : del.length ? 'delete' : 'insert';
    const flat = (ws) => ws.map((w) => w.key).join('');
    if (!(o.ignoreSpace && kind === 'replace' && flat(del) === flat(ins))) {
      out.push({ kind, was: cmpJoin(del), now: cmpJoin(ins),
        oq: del.length ? del.flatMap((w) => w.quads) : [cmpGapQuad(A, run.ai)].filter(Boolean), og: !del.length,
        nq: ins.length ? ins.flatMap((w) => w.quads) : [cmpGapQuad(B, run.aj)].filter(Boolean), ng: !ins.length });
    }
    run = null;
  };
  const endFmt = () => {
    if (!fmt) return;
    const wa = fmt.map(([i]) => A[i]), wb = fmt.map(([, j]) => B[j]);
    const desc = (w, f) => `${f[w.fid] || 'font'} ${w.size} pt`;
    out.push({ kind: 'format', was: `${cmpJoin(wa)} (${desc(wa[0], fontsA)})`, now: `${cmpJoin(wb)} (${desc(wb[0], fontsB)})`, oq: wa.flatMap((w) => w.quads), nq: wb.flatMap((w) => w.quads) });
    fmt = null;
  };
  for (const op of ops) {
    if (op[0] === 0) {
      endRun(); li = op[1]; lj = op[2];
      if (o.format) {
        const wa = A[op[1]], wb = B[op[2]];
        const differs = (fontsA[wa.fid] || wa.fid) !== (fontsB[wb.fid] || wb.fid) || Math.abs(wa.size - wb.size) > 0.4;
        const sameAsRun = fmt && (() => { const [fi, fj] = fmt[0]; return fontsA[A[fi].fid] === fontsA[wa.fid] && fontsB[B[fj].fid] === fontsB[wb.fid] && A[fi].size === wa.size && B[fj].size === wb.size; })();
        if (differs) { if (fmt && !sameAsRun) endFmt(); (fmt ||= []).push([op[1], op[2]]); } else endFmt();
      }
      continue;
    }
    endFmt();
    if (!run) run = { del: [], ins: [], ai: li, aj: lj };
    if (op[0] < 0) run.del.push(op[1]); else run.ins.push(op[1]);
  }
  endRun(); endFmt();
  return out;
}
// Pictures and drawings: both pages drawn at 100 dpi, unturned; differing pixels outside the text, in boxes.
async function cmpRaster(page, s) {
  const vp = page.getViewport({ scale: s, rotation: 0 });
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
  const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvas: c, canvasContext: g, viewport: vp }).promise;
  const data = g.getImageData(0, 0, c.width, c.height).data, w = c.width, h = c.height;
  c.width = c.height = 0;
  return { data, w, h, vp };
}
// Grows the marked pixels by r in each direction (a box filter, by rows then by columns).
function cmpDilate(m, W, H, r) {
  const t = new Uint8Array(m.length);
  for (let y = 0; y < H; y++) { let n = 0; const o = y * W; for (let x = 0; x < Math.min(r, W); x++) n += m[o + x]; for (let x = 0; x < W; x++) { if (x + r < W) n += m[o + x + r]; if (x - r - 1 >= 0) n -= m[o + x - r - 1]; t[o + x] = n > 0 ? 1 : 0; } }
  for (let x = 0; x < W; x++) { let n = 0; for (let y = 0; y < Math.min(r, H); y++) n += t[y * W + x]; for (let y = 0; y < H; y++) { if (y + r < H) n += t[(y + r) * W + x]; if (y - r - 1 >= 0) n -= t[(y - r - 1) * W + x]; m[y * W + x] = n > 0 ? 1 : 0; } }
}
// Boxes [x0, y0, x1, y1] (pixels, x1/y1 past the end) of the connected marked areas. Clears the mask.
function cmpComponents(m, W, H) {
  const out = [], stack = new Int32Array(m.length);
  for (let p = 0; p < m.length; p++) {
    if (!m[p]) continue;
    let sp = 0, x0 = W, y0 = H, x1 = -1, y1 = -1; stack[sp++] = p; m[p] = 0;
    while (sp) {
      const q = stack[--sp], x = q % W, y = (q - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && m[q - 1]) { m[q - 1] = 0; stack[sp++] = q - 1; }
      if (x < W - 1 && m[q + 1]) { m[q + 1] = 0; stack[sp++] = q + 1; }
      if (y > 0 && m[q - W]) { m[q - W] = 0; stack[sp++] = q - W; }
      if (y < H - 1 && m[q + W]) { m[q + W] = 0; stack[sp++] = q + W; }
    }
    out.push([x0, y0, x1 + 1, y1 + 1]);
  }
  return out;
}
// Boxes near each other (a moved shape: where it was and where it is) become one.
function cmpMergeBoxes(bs, near) {
  const list = bs.map((b) => b.slice());
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < list.length && !again; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a[0] - near <= b[2] && b[0] - near <= a[2] && a[1] - near <= b[3] && b[1] - near <= a[3]) {
        list[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]; list.splice(j, 1); again = true; break;
      }
    }
  }
  return list;
}
async function cmpVisual(da, db, textChanges) {
  const s = CMP_DPI / 72, ra = await cmpRaster(da.page, s), rb = await cmpRaster(db.page, s);
  const W = Math.max(ra.w, rb.w), H = Math.max(ra.h, rb.h), mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ia = y < ra.h && x < ra.w ? (y * ra.w + x) * 4 : -1, ib = y < rb.h && x < rb.w ? (y * rb.w + x) * 4 : -1;
    let d = 0;
    for (let c = 0; c < 3; c++) { const u = ia < 0 ? 255 : ra.data[ia + c], w = ib < 0 ? 255 : rb.data[ib + c]; d = Math.max(d, Math.abs(u - w)); }
    if (d > CMP_DIFF) mask[y * W + x] = 1;
  }
  const px = (vp, q, pad) => {
    const pts = q.map(([x, y]) => vp.convertToViewportPoint(x, y)), xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return [Math.floor(Math.min(...xs) - pad), Math.floor(Math.min(...ys) - pad), Math.ceil(Math.max(...xs) + pad), Math.ceil(Math.max(...ys) + pad)];
  };
  // The text is compared word by word: text that only moved (a line pushed along by a word put in) is not a picture.
  for (const [vp, boxes] of [[ra.vp, da.boxes], [rb.vp, db.boxes]]) for (const q of boxes) {
    const [x0, y0, x1, y1] = px(vp, q, 2);
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) mask.fill(0, y * W + Math.max(0, x0), y * W + Math.max(0, Math.min(W, x1)));
  }
  cmpDilate(mask, W, H, CMP_GROW);
  let boxes = cmpComponents(mask, W, H).map(([x0, y0, x1, y1]) => [x0 + CMP_GROW, y0 + CMP_GROW, x1 - CMP_GROW, y1 - CMP_GROW]).filter(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0);
  boxes = cmpMergeBoxes(boxes, 12).filter(([x0, y0, x1, y1]) => (x1 - x0 > 6 || y1 - y0 > 6) && (x1 - x0) * (y1 - y0) > 36);
  const hits = textChanges.flatMap((c) => [...c.oq.map((q) => px(ra.vp, q, 0)), ...c.nq.map((q) => px(rb.vp, q, 0))]);
  const meets = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  boxes = boxes.filter((b) => !hits.some((h) => meets(b, h)));
  const toPdf = (vp, [x0, y0, x1, y1]) => { const a = vp.convertToPdfPoint(x0, y0), b = vp.convertToPdfPoint(x1, y1); return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; };
  return boxes.map((b) => ({ kind: 'visual', was: '', now: '', ob: toPdf(ra.vp, b), nb: toPdf(rb.vp, b) }));
}
const cmpRectQuad = ([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/* --- the whole comparison --- */
async function cmpCompute(oldS, newS, o, progress = () => false) {
  const total = oldS.count + newS.count;
  const words = { old: [], new: [] }, sig = { old: [], new: [] };
  for (const [key, side] of [['old', oldS], ['new', newS]]) for (let k = 0; k < side.count; k++) {
    if (progress(`Reading ${key === 'old' ? 'Old' : 'New'}, page ${k + 1} of ${side.count}…`, ((key === 'new' ? oldS.count : 0) + k) / total * 0.3)) return null;
    const dat = await cmpRead(side, k);
    words[key][k] = cmpWords(dat, o); sig[key][k] = cmpShingles(words[key][k]);
  }
  // Pages without text are told apart by how they look.
  for (const [key, side] of [['old', oldS], ['new', newS]]) for (let k = 0; k < side.count; k++) if (!sig[key][k].size) await cmpThumb(side.data[k]);
  const pairs = cmpAlign(oldS.count, newS.count, (i, j) => {
    const s = cmpJaccard(sig.old[i], sig.new[j]);
    if (s !== null) return s;
    const a = oldS.data[i].thumb, b = newS.data[j].thumb; let d = 0;
    for (let q = 0; q < 1024; q++) d += Math.abs(a[q] - b[q]);
    return 0.3 + 0.7 * Math.max(0, 1 - d / 1024 / 40);
  });
  const changes = [];
  for (let r = 0; r < pairs.length; r++) {
    const [i, j] = pairs[r];
    if (progress(`Comparing page ${j != null ? j + 1 : i + 1}…`, 0.3 + 0.7 * r / pairs.length)) return null;
    if (i == null) { changes.push({ kind: 'pageInsert', o: null, n: j, row: r, was: '', now: `Page ${j + 1}`, oq: [], nq: [] }); continue; }
    if (j == null) { changes.push({ kind: 'pageRemove', o: i, n: null, row: r, was: `Page ${i + 1}`, now: '', oq: [], nq: [] }); continue; }
    const da = oldS.data[i], db = newS.data[j];
    const fa = o.format ? await cmpFontNames(da) : {}, fb = o.format ? await cmpFontNames(db) : {};
    const text = cmpTextChanges(words.old[i], words.new[j], o, fa, fb);
    const noText = !words.old[i].length && !words.new[j].length;
    const pics = o.visual || noText ? await cmpVisual(da, db, text) : [];
    const here = [...text, ...pics].map((c) => ({ ...c, o: i, n: j, row: r }));
    // top to bottom, then left to right, on New (or on Old where New has nothing to show)
    const where = (c) => { const b = c.nb || (c.nq.length ? cmpBox(c.nq) : c.ob || cmpBox(c.oq)); return [-b[3], b[0]]; };
    here.sort((p, q) => { const a = where(p), b = where(q); return Math.abs(a[0] - b[0]) > 3 ? a[0] - b[0] : a[1] - b[1]; });
    changes.push(...here);
  }
  changes.forEach((c, k) => { c.id = k; if (c.kind === 'visual') { c.oq = [cmpRectQuad(c.ob)]; c.nq = [cmpRectQuad(c.nb)]; } });
  return { pairs, changes };
}
const cmpCounts = (changes) => { const n = {}; for (const k of Object.keys(CMP_KIND)) n[k] = 0; for (const c of changes) n[c.kind]++; return n; };
const cmpQuote = (s, most = 80) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return `“${s.length > most ? s.slice(0, most - 1) + '…' : s}”`; };
function cmpDescribe(c) {
  switch (c.kind) {
    case 'insert': return `Added ${cmpQuote(c.now)}`;
    case 'delete': return `Removed ${cmpQuote(c.was)}`;
    case 'replace': return `Changed ${cmpQuote(c.was)} to ${cmpQuote(c.now)}`;
    case 'format': return `Formatting of ${cmpQuote(c.now)}, was ${cmpQuote(c.was)}`;
    case 'visual': return 'Picture or drawing changed';
    case 'pageInsert': return 'Page inserted';
    case 'pageRemove': return `Page removed (Old page ${c.o + 1})`;
  }
  return '';
}
const cmpWhere = (c) => (c.n != null ? `Page ${c.n + 1}` : `Old page ${c.o + 1}`);
function cmpListText(res = cmp) {
  if (!res) return '';
  const head = `Compared “${res.old.name}” (Old) with “${res.new.name}” (New): ${res.changes.length === 1 ? '1 change' : `${res.changes.length} changes`}.`;
  return [head, ...res.changes.map((c) => `${cmpWhere(c)}: ${cmpDescribe(c)}`)].join('\n');
}

/* --- the report --- */
async function cmpLibLoad(L, bytes) {
  if (bytes.password) return L.PDFDocument.load(bytes, { password: bytes.password, updateMetadata: false });
  const d = await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return d.isEncrypted ? L.PDFDocument.load(bytes, { password: '', updateMetadata: false }) : d;
}
// A copy of one side's pages, as pdf-lib pages in order.
async function cmpBaseCopy(L, side) {
  if (!side.fromDoc) { const out = await cmpLibLoad(L, side.bytes); return out; }
  const d = side.d, plain = d.sources.length === 1 && d.pages.length && d.pages.every((e, k) => e.i === k && e.src === 0 && !e.rot && !e.crop);
  const whole = plain && (await cmpLibLoad(L, d.sources[0]));
  if (whole && whole.getPageCount() === d.pages.length) return whole;
  const out = await L.PDFDocument.create(), loaded = new Map();
  for (const e of d.pages) {
    if (!loaded.has(e.src)) loaded.set(e.src, await cmpLibLoad(L, d.sources[e.src]));
    const [pg] = await out.copyPages(loaded.get(e.src), [e.i]);
    const p = out.addPage(pg);
    if (e.rot) p.setRotation(L.degrees((p.getRotation().angle + e.rot) % 360));
  }
  return out;
}
const cmpNum = (x) => +(+x).toFixed(2);
// One comment on a report page, with its own look (so every reader shows it the same way).
function cmpAnnot(L, out, p, a, ctx) {
  const { PDFName, PDFHexString, PDFString } = L;
  const pts = a.quads ? a.quads.flat() : [[a.rect[0], a.rect[1]], [a.rect[2], a.rect[3]]];
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const rect = [Math.min(...xs) - 2, Math.min(...ys) - 2, Math.max(...xs) + 2, Math.max(...ys) + 2].map(cmpNum);
  const col = a.rgb.map(cmpNum).join(' '), ops = [], res = {};
  const path = (q) => `${q.map(([x, y], k) => `${cmpNum(x)} ${cmpNum(y)} ${k ? 'l' : 'm'}`).join(' ')} h`;
  const extra = {};
  if (a.sub === 'Highlight') {
    res.ExtGState = { G0: { Type: 'ExtGState', BM: 'Multiply', ca: 0.45, CA: 0.45 } };
    ops.push('/G0 gs', `${col} rg`, ...a.quads.map(path), 'f');
  } else if (a.sub === 'StrikeOut') {
    ops.push(`${col} RG`);
    for (const q of a.quads) {
      const h = Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]), m0 = [q[0][0] + (q[3][0] - q[0][0]) * 0.42, q[0][1] + (q[3][1] - q[0][1]) * 0.42], m1 = [q[1][0] + (q[2][0] - q[1][0]) * 0.42, q[1][1] + (q[2][1] - q[1][1]) * 0.42];
      ops.push(`${cmpNum(Math.max(0.8, h / 12))} w`, `${cmpNum(m0[0])} ${cmpNum(m0[1])} m ${cmpNum(m1[0])} ${cmpNum(m1[1])} l S`);
    }
  } else if (a.sub === 'Caret') {
    const q = a.quads[0], [x0, y0, x1] = cmpBox([q]), cx = (x0 + x1) / 2, w = Math.max(3, (q[3][1] - q[0][1]) * 0.35);
    extra.Rect = [cx - w - 1, y0 - 1, cx + w + 1, y0 + w * 1.6 + 1].map(cmpNum);
    ops.push(`${col} rg`, `${cmpNum(cx - w)} ${cmpNum(y0)} m ${cmpNum(cx)} ${cmpNum(y0 + w * 1.6)} l ${cmpNum(cx + w)} ${cmpNum(y0)} l h f`);
    extra.Sy = 'None';
  } else if (a.sub === 'Square') {
    ops.push(`${col} RG`, '1.5 w', `${cmpNum(a.rect[0] - 1)} ${cmpNum(a.rect[1] - 1)} ${cmpNum(a.rect[2] - a.rect[0] + 2)} ${cmpNum(a.rect[3] - a.rect[1] + 2)} re S`);
    extra.BS = { W: 1.5, S: 'S' };
  } else if (a.sub === 'FreeText') {
    // a label at the top of the page: "Page inserted"
    const [x0, , x1, y1] = a.rect, size = 11, w = ctx.bold.widthOfTextAtSize(a.label, size) + 16, top = y1 - 10;
    extra.Rect = [x0 + 10, top - 22, Math.min(x1 - 10, x0 + 10 + w), top].map(cmpNum);
    const [rx0, ry0, rx1, ry1] = extra.Rect;
    res.Font = { Helv: ctx.bold.ref };
    ops.push(`${col} rg`, `${rx0} ${ry0} ${cmpNum(rx1 - rx0)} ${cmpNum(ry1 - ry0)} re f`, 'BT', '1 1 1 rg', `/Helv ${size} Tf`, `${cmpNum(rx0 + 8)} ${cmpNum(ry0 + 7)} Td`, `${ctx.enc(ctx.bold, a.label)} Tj`, 'ET');
    extra.DA = PDFString.of(`/Helv ${size} Tf 1 1 1 rg`);
  }
  const r = extra.Rect || rect;
  const ap = out.context.stream(ops.join('\n'), { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: r, Resources: res });
  const dict = out.context.obj({ Type: 'Annot', Subtype: a.sub, F: 4, C: a.rgb, ...extra, Rect: r, AP: { N: out.context.register(ap) } });
  if (a.quads && a.sub !== 'Caret') dict.set(PDFName.of('QuadPoints'), out.context.obj(a.quads.flatMap((q) => [...q[3], ...q[2], ...q[0], ...q[1]].map(cmpNum))));
  dict.set(PDFName.of('Contents'), PDFHexString.fromText(a.contents));
  dict.set(PDFName.of('T'), PDFHexString.fromText('Compare'));
  dict.set(PDFName.of('Subj'), PDFHexString.fromText(a.subject));
  dict.set(PDFName.of('NM'), PDFString.of('cpdf-cmp-' + uid()));
  dict.set(PDFName.of('M'), PDFString.fromDate(new Date()));
  const ref = out.context.register(dict);
  let annots = p.node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof L.PDFArray)) { annots = out.context.obj([]); p.node.set(PDFName.of('Annots'), annots); }
  annots.push(ref);
}
function cmpContents(c) {
  switch (c.kind) {
    case 'insert': return `Added\nNow: ${c.now}`;
    case 'delete': return `Removed\nWas: ${c.was}`;
    case 'replace': return `Changed\nWas: ${c.was}\nNow: ${c.now}`;
    case 'format': return `Formatting changed\nWas: ${c.was}\nNow: ${c.now}`;
    case 'visual': return 'Picture or drawing changed';
  }
  return '';
}
const cmpDate = (d) => (d && !isNaN(d) ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'unknown');
// The date a side was last changed: from the file, or else from the PDF's own information.
async function cmpSideDate(side) {
  if (side.date) return side.date;
  try {
    const pd = side.pd || pdfDocs.get(0), m = await pd.getMetadata(), s = m && m.info && (m.info.ModDate || m.info.CreationDate);
    const d = s && pdfjs.PDFDateString && pdfjs.PDFDateString.toDateObject(s);
    if (d) return d;
  } catch {}
  return null;
}
// The report: a copy of one side ('new' or 'old') with the changes as comments, after a cover page. Returns bytes.
async function cmpReport(on = 'new', res = cmp) {
  const L = await loadPdfLib(), side = res[on];
  const out = await cmpBaseCopy(L, side);
  const ctx = { font: await out.embedFont(L.StandardFonts.Helvetica), bold: await out.embedFont(L.StandardFonts.HelveticaBold) };
  ctx.enc = (f, s) => cmpEncode(f, s).toString();
  const pages = out.getPages(), key = on === 'new' ? 'n' : 'o';
  for (const c of res.changes) {
    const k = c[key];
    if (c.kind === 'pageInsert' || c.kind === 'pageRemove') {
      const mine = (c.kind === 'pageInsert') === (on === 'new');
      let target = k, where = 'before';
      if (!mine) { // the page is only on the other side: say so on the page that follows it here (or the last one)
        const next = res.pairs.slice(c.row + 1).find((pr) => pr[on === 'new' ? 1 : 0] != null);
        target = next ? next[on === 'new' ? 1 : 0] : pages.length - 1;
        if (!next) where = 'after';
      }
      if (target == null || target < 0 || !pages[target]) continue;
      const p = pages[target], { x, y, width, height } = p.getCropBox();
      const label = mine ? CMP_KIND[c.kind].name : c.kind === 'pageInsert' ? `New page ${c.n + 1} inserted ${where} this page` : `Old page ${c.o + 1} removed ${where} this page`;
      cmpAnnot(L, out, p, { sub: 'FreeText', rect: [x, y, x + width, y + height], label, rgb: CMP_KIND[c.kind].rgb, contents: label, subject: CMP_KIND[c.kind].name }, ctx);
      continue;
    }
    if (k == null || !pages[k]) continue;
    const p = pages[k], rgb = CMP_KIND[c.kind].rgb, contents = cmpContents(c), subject = CMP_KIND[c.kind].name;
    const quads = c[key + 'q'];
    if (c.kind === 'visual') { cmpAnnot(L, out, p, { sub: 'Square', rect: c[key + 'b'], rgb, contents, subject }, ctx); continue; }
    if (!quads.length) continue;
    let sub;
    if (c.kind === 'format') sub = 'Highlight';
    else if (on === 'new') sub = c.kind === 'delete' ? 'StrikeOut' : 'Highlight';
    else sub = c.kind === 'insert' ? 'Caret' : 'StrikeOut';
    cmpAnnot(L, out, p, { sub, quads, rgb, contents, subject }, ctx);
  }
  await cmpCover(L, out, res, on, ctx);
  return out.save();
}
function cmpEncode(font, s) {
  try { return font.encodeText(s); } catch {}
  return font.encodeText([...s].map((c) => { try { font.encodeText(c); return c; } catch { return '?'; } }).join(''));
}
// The cover page (more than one when the list of pages is long), put in front of the pages.
async function cmpCover(L, out, res, on, ctx) {
  const first = out.getPage(0), { width: W0, height: H0 } = first.getSize();
  const [W, H] = W0 > H0 ? [792, 612] : [612, 792];
  const n = cmpCounts(res.changes), lines = [];
  const safe = (s) => [...String(s)].map((c) => { try { ctx.font.encodeText(c); return c; } catch { return '?'; } }).join('');
  const add = (text, o = {}) => lines.push({ text: safe(text), size: 11, ...o });
  const [dOld, dNew] = [await cmpSideDate(res.old), await cmpSideDate(res.new)];
  add('Compare report', { size: 22, bold: true, gap: 6 });
  add(`Made on ${cmpDate(new Date())} with Cowdrey.PDF, on this device.`, { size: 10, gray: true, gap: 16 });
  add(`New: ${res.new.name}`, { bold: true }); add(`${res.new.count === 1 ? '1 page' : `${res.new.count} pages`}, last changed ${cmpDate(dNew)}`, { size: 10, gray: true, gap: 8 });
  add(`Old: ${res.old.name}`, { bold: true }); add(`${res.old.count === 1 ? '1 page' : `${res.old.count} pages`}, last changed ${cmpDate(dOld)}`, { size: 10, gray: true, gap: 16 });
  add(`Changes: ${res.changes.length}`, { size: 14, bold: true, gap: 4 });
  for (const [k, label] of [['insert', 'Text added'], ['delete', 'Text removed'], ['replace', 'Text changed'], ['format', 'Formatting changed'], ['visual', 'Pictures or drawings changed'], ['pageInsert', 'Pages inserted'], ['pageRemove', 'Pages removed']]) {
    if (k === 'format' && !res.opts.format) continue;
    add(`${label}: ${n[k]}`, { indent: 12, count: true });
  }
  lines[lines.length - 1].gap = 16;
  const skip = [res.opts.ignoreCase && 'case', res.opts.ignorePunct && 'punctuation', res.opts.ignoreSpace && 'spacing', res.opts.ignoreHeadFoot && 'headers and footers'].filter(Boolean);
  if (skip.length) { add(`Not counted: ${skip.join(', ')}.`, { size: 10, gray: true, gap: 16 }); }
  const marked = on === 'new' ? 'New' : 'Old';
  add(`Pages with changes (marked on ${marked}; page numbers of this report)`, { size: 14, bold: true, gap: 4 });
  const byPage = new Map(), key = on === 'new' ? 'n' : 'o';
  for (const c of res.changes) { const k = c[key]; if (k == null) continue; if (!byPage.has(k)) byPage.set(k, []); byPage.get(k).push(c); }
  const coverCount = () => Math.max(1, Math.ceil(lines.length / 44));
  const pageList = [...byPage.keys()].sort((a, b) => a - b);
  if (!pageList.length) add('No changes found.', { indent: 12 });
  const entries = pageList.map((k) => {
    const cs = byPage.get(k), cn = cmpCounts(cs);
    const parts = [['pageInsert', 'page inserted'], ['pageRemove', 'page removed'], ['insert', 'added'], ['delete', 'removed'], ['replace', 'changed'], ['format', 'formatting'], ['visual', 'picture or drawing']].filter(([kk]) => cn[kk]).map(([kk, w]) => (kk.startsWith('page') ? w : `${cn[kk]} ${w}`));
    return { k, text: parts.join(', ') };
  });
  // the page numbers depend on how many cover pages there are: lay out once, then number
  for (const e of entries) add('', { indent: 12, entry: e });
  const covers = coverCount();
  for (const l of lines) if (l.entry) l.text = safe(`Page ${l.entry.k + 1 + covers} (${marked} page ${l.entry.k + 1}): ${l.entry.text}`);
  add('Each change is a comment on its page, coloured: added green, removed red, changed amber, pictures blue.', { size: 10, gray: true, top: 12 });
  // write
  let p = null, y = 0, made = 0;
  const newPage = () => { p = out.insertPage(made++, [W, H]); y = H - 64; };
  newPage();
  for (const l of lines) {
    const font = l.bold ? ctx.bold : ctx.font, x = 64 + (l.indent || 0), width = W - 64 - x;
    // long lines wrap
    const words = l.text.split(' '), rows = []; let row = '';
    for (const w of words) { const t = row ? row + ' ' + w : w; if (row && font.widthOfTextAtSize(t, l.size) > width) { rows.push(row); row = w; } else row = t; }
    rows.push(row);
    if (l.top) y -= l.top;
    for (const r of rows) {
      if (y < 64) newPage();
      p.drawText(r, { x, y, size: l.size, font, color: l.gray ? L.rgb(0.35, 0.33, 0.34) : L.rgb(0.1, 0.08, 0.09) });
      y -= l.size * 1.45;
    }
    y -= l.gap || 0;
  }
  return made;
}

/* --- the view --- */
function cmpEl() {
  let el = $('#cmpView'); if (el) return el;
  el = document.createElement('section'); el.id = 'cmpView'; el.className = 'cmp'; el.hidden = true; el.setAttribute('aria-label', 'Compare');
  el.innerHTML = `<div class="cmp-bar">
      <button class="btn" type="button" data-c="exit" title="Close compare (Esc)">${ic('x')}<span>Close compare</span></button>
      <div class="cmp-names"><span class="cmp-tag old">Old</span><span class="cmp-name" data-name="old"></span><button class="icon-btn" type="button" data-c="swap" title="Swap Old and New" aria-label="Swap Old and New">${ic('arrow-left-right')}</button><span class="cmp-tag new">New</span><span class="cmp-name" data-name="new"></span></div>
      <div class="seg cmp-mode" role="radiogroup" aria-label="View"><button type="button" role="radio" data-mode="side" aria-checked="true" aria-selected="true">${ic('columns-2')}<span>Side by side</span></button><button type="button" role="radio" data-mode="overlay" aria-checked="false" aria-selected="false">${ic('layers')}<span>Overlay</span></button></div>
      <div class="seg cmp-show" role="radiogroup" aria-label="Show"><button type="button" role="radio" data-show="old" aria-checked="false" aria-selected="false">Old</button><button type="button" role="radio" data-show="new" aria-checked="true" aria-selected="true">New</button></div>
      <span class="cmp-spacer"></span>
      <span class="cmp-step"><button class="icon-btn" type="button" data-c="prev" title="Previous change ([)" aria-label="Previous change">${ic('chevron-up')}</button><span class="cmp-count" aria-live="polite"></span><button class="icon-btn" type="button" data-c="next" title="Next change (])" aria-label="Next change">${ic('chevron-down')}</button></span>
      <span class="cmp-zoom"><button class="icon-btn" type="button" data-c="zoomOut" title="Zoom out" aria-label="Zoom out">${ic('minus')}</button><button class="icon-btn" type="button" data-c="zoomIn" title="Zoom in" aria-label="Zoom in">${ic('plus')}</button></span>
      <button class="btn" type="button" data-c="opts" title="What to compare">${ic('sliders-horizontal')}<span>Options</span></button>
      <button class="btn" type="button" data-c="copy" title="Copy the list of changes as text">${ic('copy')}<span>Copy change list</span></button>
      <button class="btn primary" type="button" data-c="report" title="Save a PDF with the changes marked">${ic('file-down')}<span>Save compare report</span></button>
      <button class="btn cmp-list-btn" type="button" data-c="list" aria-expanded="false">${ic('list')}<span>Changes</span></button>
    </div>
    <div class="cmp-body">
      <div class="cmp-panes">
        <div class="cmp-pane" data-side="old"><div class="cmp-head"><span class="cmp-tag old">Old</span><span data-name="old"></span></div><div class="cmp-scroll" tabindex="0" aria-label="Old version"><div class="cmp-rows"></div></div></div>
        <div class="cmp-pane" data-side="new"><div class="cmp-head"><span class="cmp-tag new">New</span><span data-name="new"></span></div><div class="cmp-scroll" tabindex="0" aria-label="New version"><div class="cmp-rows"></div></div></div>
      </div>
      <aside class="cmp-side" aria-label="Changes"><div class="cmp-sum" aria-live="polite"></div><div class="cmp-filters" role="group" aria-label="Show these changes"></div><div class="cmp-list"></div></aside>
      <div class="cmp-busy" hidden><div class="cmp-busy-card"><p class="cmp-busy-text" aria-live="polite">Comparing…</p><div class="ocr-bar" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100"><i></i></div><p class="ocr-note">Both files stay on this device.</p><button class="btn" type="button" data-c="cancel">Cancel</button></div></div>
    </div>`;
  $('.workspace').appendChild(el);
  icons();
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-c], [data-mode], [data-show], [data-cid], [data-f]'); if (!b || !cmp) { if (b && b.dataset.c === 'cancel' && cmpBusyState) cmpBusyState.cancel = true; return; }
    if (b.dataset.mode) return cmpSetMode(b.dataset.mode);
    if (b.dataset.show) return cmpSetShow(b.dataset.show);
    if (b.dataset.f) { cmp.hide.has(b.dataset.f) ? cmp.hide.delete(b.dataset.f) : cmp.hide.add(b.dataset.f); cmpFilters(); return; }
    if (b.dataset.cid) { cmpGo(+b.dataset.cid); if (isPhone() && b.closest('.cmp-list')) cmpListToggle(false); return; }
    const c = b.dataset.c;
    if (c === 'exit') cmpClose();
    else if (c === 'swap') cmpRerun({ swap: true });
    else if (c === 'prev') cmpStep(-1);
    else if (c === 'next') cmpStep(1);
    else if (c === 'zoomIn') cmpZoom(1.25);
    else if (c === 'zoomOut') cmpZoom(0.8);
    else if (c === 'opts') cmpOptionsAgain();
    else if (c === 'copy') cmpCopy();
    else if (c === 'report') cmpReportDialog();
    else if (c === 'list') cmpListToggle();
    else if (c === 'cancel' && cmpBusyState) cmpBusyState.cancel = true;
  });
  // Scrolled together: each row is as tall in both panes, so the same scroll position is the same pair of pages.
  const [so, sn] = $$('.cmp-scroll', el);
  const sync = (from, to) => {
    if (from._echo != null && Math.abs(from.scrollTop - from._echo) < 2) { from._echo = null; return; }
    from._echo = null;
    if (!to.offsetParent) return;
    to._echo = from.scrollTop; to.scrollTop = from.scrollTop;
    const fw = from.scrollWidth - from.clientWidth, tw = to.scrollWidth - to.clientWidth;
    if (fw > 0 && tw > 0) to.scrollLeft = from.scrollLeft / fw * tw;
  };
  so.addEventListener('scroll', () => sync(so, sn), { passive: true });
  sn.addEventListener('scroll', () => sync(sn, so), { passive: true });
  for (const s of [so, sn]) s.addEventListener('wheel', (e) => { if (!(e.ctrlKey || e.metaKey) || !cmp) return; e.preventDefault(); cmpZoom(e.deltaY < 0 ? 1.1 : 0.9); }, { passive: false });
  return el;
}
let cmpBusyState = null;
function cmpBusyShow(on) {
  const el = cmpEl(), b = $('.cmp-busy', el);
  b.hidden = !on;
  if (on) { cmpBusyState = { cancel: false }; cmpBusySet('Getting ready…', 0); }
  return cmpBusyState;
}
function cmpBusySet(text, f) {
  const el = $('#cmpView'); if (!el) return;
  $('.cmp-busy-text', el).textContent = text;
  const pct = Math.round(Math.max(0, Math.min(1, f || 0)) * 100), bar = $('.cmp-busy .ocr-bar', el);
  bar.firstChild.style.width = pct + '%'; bar.setAttribute('aria-valuenow', pct);
}
const cmpOn = () => !!cmp && app.classList.contains('cmp-on');
// Shows the comparison of two sides. Returns the comparison, or null when it was cancelled.
async function cmpOpen(oldS, newS, o = cmpOpts) {
  const el = cmpEl();
  const prev = cmp;
  app.classList.add('cmp-on'); el.hidden = false;
  closePopover(); if (app.dataset.tool !== 'select') setTool('select');
  const busy = cmpBusyShow(true);
  let res = null;
  cmpBusy = true;
  try { res = await cmpCompute(oldS, newS, { ...o }, (t, f) => { cmpBusySet(t, f); return busy.cancel; }); }
  catch (e) { console.error(e); toast(`Could not compare: ${e.message || e}`); }
  finally { cmpBusy = false; cmpBusyShow(false); }
  if (!res) {
    if (prev && prev !== cmp) return null;
    if (!prev) { cmpLeave(oldS, newS); }
    refreshRibbon();
    return null;
  }
  if (prev && prev.old !== oldS && prev.old !== newS && prev.old.pd) try { prev.old.pd.destroy(); } catch {}
  if (prev && prev.new !== oldS && prev.new !== newS && prev.new.pd) try { prev.new.pd.destroy(); } catch {}
  cmp = { old: oldS, new: newS, opts: { ...o }, pairs: res.pairs, changes: res.changes, now: -1, hide: new Set(prev ? prev.hide : []), mode: prev ? prev.mode : 'side', show: prev ? prev.show : 'new', zoom: prev ? prev.zoom : 1 };
  $$('[data-name="old"]', el).forEach((x) => { x.textContent = oldS.name; x.title = oldS.name; });
  $$('[data-name="new"]', el).forEach((x) => { x.textContent = newS.name; x.title = newS.name; });
  cmpSetMode(cmp.mode, true); cmpSetShow(cmp.show, true);
  cmpLayout(); cmpFilters();
  refreshRibbon();
  const n = res.changes.length;
  announce(n ? `${n === 1 ? '1 change' : `${n} changes`} found` : 'No changes found');
  if (n) cmpGo(0, true); else cmpCount();
  return cmp;
}
function cmpLeave(oldS, newS) {
  for (const s of [oldS, newS]) if (s && s.pd && !s.fromDoc) try { s.pd.destroy(); } catch {}
  app.classList.remove('cmp-on'); const el = $('#cmpView'); if (el) el.hidden = true;
}
function cmpClose() {
  if (!cmp) { cmpLeave(); return; }
  const c = cmp; cmp = null;
  if (c.io) c.io.disconnect();
  $$('#cmpView .cmp-rows').forEach((r) => { r.innerHTML = ''; });
  cmpLeave(c.old, c.new);
  refreshRibbon();
  viewer.focus({ preventScroll: true });
}
function cmpSetMode(mode, quiet) {
  cmp.mode = mode;
  const el = $('#cmpView'); el.dataset.mode = mode;
  $$('.cmp-mode [data-mode]', el).forEach((b) => { const on = b.dataset.mode === mode; b.setAttribute('aria-checked', on); b.setAttribute('aria-selected', on); });
  if (!quiet) { cmpLayout(); cmpGo(cmp.now, true); }
}
function cmpSetShow(side, quiet) {
  cmp.show = side;
  const el = $('#cmpView'); el.dataset.show = side;
  $$('.cmp-show [data-show]', el).forEach((b) => { const on = b.dataset.show === side; b.setAttribute('aria-checked', on); b.setAttribute('aria-selected', on); });
  if (!quiet) { const s = $(`.cmp-pane[data-side="${side}"] .cmp-scroll`, el), o = $(`.cmp-pane[data-side="${side === 'old' ? 'new' : 'old'}"] .cmp-scroll`, el); s.scrollTop = o.scrollTop; cmpGo(cmp.now, true); }
}
function cmpZoom(f) {
  if (!cmp) return;
  const sc = $('.cmp-pane[data-side="new"] .cmp-scroll') , top = sc.scrollTop / Math.max(1, sc.scrollHeight);
  cmp.zoom = Math.max(0.25, Math.min(4, cmp.zoom * f));
  cmpLayout();
  for (const s of $$('#cmpView .cmp-scroll')) { s._echo = null; s.scrollTop = top * s.scrollHeight; }
}
const cmpPanes = () => (cmp.mode === 'overlay' || isPhone() ? 1 : 2);
// The rows: one per pair of pages, as tall as the taller page, in both panes.
function cmpLayout() {
  const el = $('#cmpView'), c = cmp;
  if (c.io) c.io.disconnect();
  const pane = $('.cmp-pane[data-side="new"] .cmp-scroll', el);
  const paneW = Math.max(200, (($('.cmp-panes', el).clientWidth || 800) / cmpPanes()) - 40);
  const size = (side, k) => { if (k == null) return null; const pg = side.data[k].page, vp = pg.getViewport({ scale: 1, rotation: side.rot(k, pg) }); return [vp.width, vp.height]; };
  const sizes = c.pairs.map(([i, j]) => [size(c.old, i), size(c.new, j)]);
  const widest = Math.max(...sizes.flat().filter(Boolean).map((s) => s[0]), 1);
  c.scale = paneW / widest * c.zoom;
  const s = c.scale;
  for (const sideKey of ['old', 'new']) {
    const rows = $(`.cmp-pane[data-side="${sideKey}"] .cmp-rows`, el);
    rows.innerHTML = c.pairs.map((pr, r) => {
      const [so, sn] = sizes[r], mine = sideKey === 'old' ? so : sn, theirs = sideKey === 'old' ? sn : so;
      const hgt = Math.max(so ? so[1] : 0, sn ? sn[1] : 0) * s;
      const k = pr[sideKey === 'old' ? 0 : 1];
      const slot = mine
        ? `<div class="cmp-slot" data-k="${k}" style="width:${(mine[0] * s).toFixed(1)}px;height:${(mine[1] * s).toFixed(1)}px"><span class="cmp-pno" aria-hidden="true">${k + 1}</span></div>`
        : `<div class="cmp-missing" style="width:${(theirs[0] * s).toFixed(1)}px;height:${(theirs[1] * s).toFixed(1)}px"><span>${sideKey === 'old' ? `Page inserted in New (page ${pr[1] + 1})` : `Page removed from New (Old page ${pr[0] + 1})`}</span></div>`;
      return `<div class="cmp-row" data-r="${r}" style="height:${(hgt + 16).toFixed(1)}px">${slot}</div>`;
    }).join('');
  }
  c.io = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) cmpPaintRow(+en.target.dataset.r, en.target.closest('.cmp-pane').dataset.side); }), { rootMargin: '600px 0px' });
  $$('.cmp-row', el).forEach((r) => c.io.observe(r));
  void pane;
}
async function cmpPaintRow(r, sideKey) {
  const c = cmp; if (!c) return;
  const row = $(`#cmpView .cmp-pane[data-side="${sideKey}"] .cmp-row[data-r="${r}"]`), slot = row && $('.cmp-slot', row);
  const key = `${c.scale}:${c.mode}`;
  if (!slot || slot.dataset.drawn === key) return;
  slot.dataset.drawn = key;
  const side = c[sideKey], k = +slot.dataset.k, pg = side.data[k].page;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const draw = async (s0, pageObj, rot, cls) => {
    const vp = pageObj.getViewport({ scale: c.scale * dpr, rotation: rot });
    const cv = document.createElement('canvas'); cv.className = cls; cv.width = Math.max(1, Math.round(vp.width)); cv.height = Math.max(1, Math.round(vp.height));
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    await pageObj.render({ canvas: cv, canvasContext: g, viewport: vp }).promise;
    return cv;
  };
  try {
    const parts = [await draw(c.scale, pg, side.rot(k, pg), 'cmp-pdf')];
    const other = c.pairs[r][0];
    if (sideKey === 'new' && c.mode === 'overlay' && other != null) { const op = c.old.data[other].page; parts.unshift(await draw(c.scale, op, c.old.rot(other, op), 'cmp-under')); }
    if (!cmp || slot.dataset.drawn !== key) return;
    $$('canvas', slot).forEach((x) => x.remove());
    slot.prepend(...parts);
    cmpOverlay(slot, sideKey, r);
  } catch (e) { console.warn(e); slot.dataset.drawn = ''; }
}
// The coloured boxes over one page.
function cmpOverlay(slot, sideKey, r) {
  const c = cmp, side = c[sideKey], k = +slot.dataset.k, pg = side.data[k].page;
  const vp = pg.getViewport({ scale: c.scale, rotation: side.rot(k, pg) });
  $$('.cmp-hl', slot).forEach((x) => x.remove());
  const key = sideKey === 'old' ? 'o' : 'n';
  const html = [];
  for (const ch of c.changes) {
    if (ch.row !== r || ch[key] == null) continue;
    for (const q of ch[key + 'q']) {
      const pts = q.map(([x, y]) => vp.convertToViewportPoint(x, y)), xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
      const gap = ch[key + 'g'] ? ' gap' : '';
      html.push(`<div class="cmp-hl k-${ch.kind} f-${cmpFilterOf(ch.kind)}${gap}${ch.id === c.now ? ' now' : ''}" data-cid="${ch.id}" title="${esc(cmpDescribe(ch))}" style="left:${x0.toFixed(1)}px;top:${y0.toFixed(1)}px;width:${Math.max(3, w).toFixed(1)}px;height:${Math.max(3, h).toFixed(1)}px"></div>`);
    }
  }
  slot.insertAdjacentHTML('beforeend', html.join(''));
}
const cmpVisible = () => cmp.changes.filter((c) => !cmp.hide.has(cmpFilterOf(c.kind)));
function cmpFilters() {
  const el = $('#cmpView'), c = cmp, n = cmpCounts(c.changes);
  const count = (f) => (f === 'page' ? n.pageInsert + n.pageRemove : n[f]);
  const total = c.changes.length;
  $('.cmp-sum', el).textContent = total ? `${total === 1 ? '1 change' : `${total} changes`}` : 'No changes found';
  $('.cmp-filters', el).innerHTML = CMP_FILTERS.filter(([f]) => f !== 'format' || c.opts.format).map(([f, label]) => `<button type="button" class="cmp-chip f-${f}" data-f="${f}" aria-pressed="${!c.hide.has(f)}"${count(f) ? '' : ' disabled'}><i class="cmp-dot"></i>${esc(label)} <b>${count(f)}</b></button>`).join('');
  for (const [f] of CMP_FILTERS) el.classList.toggle('cmp-hide-' + f, c.hide.has(f));
  // The list, by page
  const groups = [];
  for (const ch of c.changes) {
    const g = groups[groups.length - 1];
    if (g && g.row === ch.row) g.items.push(ch); else groups.push({ row: ch.row, items: [ch] });
  }
  const label = (g) => { const [i, j] = c.pairs[g.row]; return j != null ? `Page ${j + 1}${i != null && i !== j ? ` <span>(Old page ${i + 1})</span>` : ''}` : `Old page ${i + 1}`; };
  $('.cmp-list', el).innerHTML = total ? `<ol>${groups.map((g) => `<li class="cmp-grp"><h3>${label(g)} <b>${g.items.length}</b></h3><ol>${g.items.map((ch) => `<li><button type="button" class="cmp-item k-${ch.kind} f-${cmpFilterOf(ch.kind)}" data-cid="${ch.id}" aria-current="${ch.id === c.now}"><span class="cmp-badge">${esc(CMP_KIND[ch.kind].label)}</span><span class="cmp-txt">${esc(cmpDescribe(ch).replace(/^(Added|Removed|Changed) /, ''))}</span></button></li>`).join('')}</ol></li>`).join('')}</ol>`
    : '<p class="cmp-none">The two versions are the same, with these options.</p>';
  $('.cmp-list-btn span', el).textContent = `Changes (${total})`;
  cmpCount();
}
function cmpCount() {
  const el = $('#cmpView'), vis = cmpVisible(), k = vis.findIndex((x) => x.id === cmp.now);
  $('.cmp-count', el).textContent = vis.length ? `${k >= 0 ? k + 1 : '–'} of ${vis.length}` : '0';
  $$('[data-c="prev"], [data-c="next"]', el).forEach((b) => { b.disabled = !vis.length; });
}
function cmpStep(d) {
  if (!cmp) return;
  const vis = cmpVisible(); if (!vis.length) return;
  let k = vis.findIndex((x) => x.id === cmp.now);
  if (k < 0) { k = d > 0 ? vis.findIndex((x) => x.id > cmp.now) : -1; if (k < 0) k = d > 0 ? 0 : vis.length - 1; } else k = (k + d + vis.length) % vis.length;
  cmpGo(vis[k].id);
}
// Goes to a change: both panes scroll to it (together), it is marked, and the list shows it.
function cmpGo(id, quiet) {
  const c = cmp; if (!c) return;
  const ch = c.changes[id];
  c.now = ch ? id : -1;
  const el = $('#cmpView');
  $$('.cmp-hl.now, .cmp-item[aria-current="true"]', el).forEach((x) => { if (x.classList.contains('cmp-hl')) x.classList.remove('now'); else x.setAttribute('aria-current', 'false'); });
  cmpCount();
  if (!ch) return;
  $$(`.cmp-hl[data-cid="${id}"]`, el).forEach((x) => x.classList.add('now'));
  const item = $(`.cmp-item[data-cid="${id}"]`, el); if (item) { item.setAttribute('aria-current', 'true'); item.scrollIntoView({ block: 'nearest' }); }
  // where it is: on the side that has it (New unless only Old does), in its row
  const sideKey = (c.mode === 'overlay' || isPhone()) ? (c.mode === 'overlay' ? 'new' : c.show) : (ch.n != null ? 'new' : 'old');
  const pane = $(`.cmp-pane[data-side="${sideKey}"] .cmp-scroll`, el), row = $(`.cmp-row[data-r="${ch.row}"]`, pane);
  if (!row) return;
  let y = row.offsetTop, h = row.offsetHeight;
  const key = sideKey === 'old' ? 'o' : 'n', k = ch[key];
  if (k != null && ch[key + 'q'].length) {
    const side = c[sideKey], pg = side.data[k].page, vp = pg.getViewport({ scale: c.scale, rotation: side.rot(k, pg) });
    const ys = ch[key + 'q'].flat().map(([x0, y0]) => vp.convertToViewportPoint(x0, y0)[1]), slot = $('.cmp-slot', row);
    y = row.offsetTop + (slot ? slot.offsetTop : 0) + Math.min(...ys); h = Math.max(...ys) - Math.min(...ys);
  }
  pane._echo = null;
  pane.scrollTop = Math.max(0, y + h / 2 - pane.clientHeight / 2);
  if (!quiet) announce(`${cmpWhere(ch)}: ${cmpDescribe(ch)}`);
}
function cmpListToggle(on) {
  const el = $('#cmpView'), b = $('[data-c="list"]', el);
  on = on ?? !el.classList.contains('cmp-list-open');
  el.classList.toggle('cmp-list-open', on); b.setAttribute('aria-expanded', on);
}
async function cmpCopy() {
  const text = cmpListText();
  try { await navigator.clipboard.writeText(text); toast('Change list copied'); }
  catch { toast('Could not copy the change list'); }
  return text;
}
async function cmpReportDialog() {
  if (!cmp) return;
  const a = await dialog('Save compare report', `<div class="cmp-dlg"><p>A PDF with a cover page that counts the changes, and each change as a comment on its page.</p>
    <fieldset class="cmp-opts"><legend>Mark the changes on</legend>
      <label><input type="radio" name="cmpOn" value="new" checked> New: ${esc(cmp.new.name)}</label>
      <label><input type="radio" name="cmpOn" value="old"> Old: ${esc(cmp.old.name)}</label></fieldset></div>`,
  [{ label: 'Cancel' }, { label: 'Save report', value: 'ok', primary: true }]);
  if (a !== 'ok') return;
  const on = ($('#dialog input[name="cmpOn"]:checked') || {}).value || 'new';
  return cmpSaveReport(on);
}
async function cmpSaveReport(on = 'new') {
  if (!cmp) return null;
  try {
    toast('Making the report…');
    const bytes = await cmpReport(on);
    const name = `${cmp[on].name} compared.pdf`;
    await saveFile(bytes, name, 'application/pdf');
    return bytes;
  } catch (e) { console.error(e); toast(`Could not make the report: ${e.message || e}`); return null; }
}

/* --- starting --- */
const cmpInput = document.createElement('input');
cmpInput.type = 'file'; cmpInput.accept = 'application/pdf,.pdf'; cmpInput.hidden = true; cmpInput.id = 'cmpInput';
document.body.appendChild(cmpInput);
let cmpPicked = null; // { bytes, name, date } of the other PDF
cmpInput.addEventListener('change', async () => {
  const f = cmpInput.files[0]; cmpInput.value = '';
  if (!f) return;
  cmpPicked = { bytes: new Uint8Array(await f.arrayBuffer()), name: f.name, date: f.lastModified ? new Date(f.lastModified) : null };
  if (cmpPickWaiting) { const w = cmpPickWaiting; cmpPickWaiting = null; w(cmpPicked); } else cmpDialog(cmpPicked);
});
let cmpPickWaiting = null;
// The other PDF: from the Mac's open dialog, or the browser's file picker.
async function cmpPick(thenDialog = true) {
  if (MAC_APP) {
    const picked = await MAC_APP.dialog.open({ multiple: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    const path = typeof picked === 'string' ? picked : picked && picked.path; if (!path) return null;
    try {
      const f = await MAC_APP.core.invoke('read_text_file', { path });
      cmpPicked = { bytes: b64ToBytes(f.content), name: f.name, date: (await fileTime(path)) ? new Date(await fileTime(path)) : null };
    } catch (e) { console.error(e); toast(`Could not open ${path.split('/').pop()}.`); return null; }
    if (thenDialog) cmpDialog(cmpPicked);
    return cmpPicked;
  }
  if (!thenDialog) return new Promise((res) => { cmpPickWaiting = res; cmpInput.click(); });
  cmpInput.click();
  return null;
}
function cmpOptionsHtml(o) {
  const box = (k, label) => `<label><input type="checkbox" data-o="${k}"${o[k] ? ' checked' : ''}> ${esc(label)}</label>`;
  return `<fieldset class="cmp-opts"><legend>Compare</legend>
    ${box('ignoreCase', 'Ignore case (capitals)')}
    ${box('ignorePunct', 'Ignore punctuation')}
    ${box('ignoreSpace', 'Ignore spacing between words')}
    ${box('ignoreHeadFoot', 'Ignore headers and footers (top and bottom 6% of the page)')}
    ${box('format', 'Show formatting changes (font and size)')}
    ${box('visual', 'Compare pictures and drawings')}
  </fieldset>`;
}
// The dialog: which is New and which is Old (swap), and what to compare.
async function cmpDialog(picked, { again = false } = {}) {
  if (!has() || cmpBusy) return null;
  const st = { swap: again ? !cmp.new.fromDoc : false, o: { ...cmpOpts }, picked };
  const marksNote = Object.values(doc.marks).some((l) => Array.isArray(l) && l.length) ? '<p class="ocr-note">Changes you made here that are not saved yet are not compared: the pages are compared as they are in the file.</p>' : '';
  const names = () => [doc.name, String(st.picked.name).replace(/\.pdf$/i, '')];
  const a = await dialog(again ? 'Compare options' : 'Compare PDFs', `<div class="cmp-dlg">
      <div class="cmp-pick">
        <div class="cmp-role"><span class="cmp-tag new">New</span><b data-role="new"></b></div>
        <button type="button" class="btn" data-swap title="Swap Old and New">${ic('arrow-left-right')}<span>Swap</span></button>
        <div class="cmp-role"><span class="cmp-tag old">Old</span><b data-role="old"></b></div>
      </div>
      ${again ? '' : '<button type="button" class="btn link" data-another>Choose another PDF…</button>'}
      ${cmpOptionsHtml(st.o)}
      ${marksNote}
      <p class="ocr-note">Both files stay on this device.</p>
    </div>`, [{ label: 'Cancel' }, { label: 'Compare', value: 'go', primary: true }], (dlg) => {
    const show = () => { const [d, p] = names(); $('[data-role="new"]', dlg).textContent = st.swap ? p : d; $('[data-role="old"]', dlg).textContent = st.swap ? d : p; };
    show();
    $('[data-swap]', dlg).onclick = () => { st.swap = !st.swap; show(); };
    const another = $('[data-another]', dlg);
    if (another) another.onclick = async () => { const p = await cmpPick(false); if (p) { st.picked = p; show(); } };
    $$('[data-o]', dlg).forEach((x) => x.addEventListener('change', () => { st.o[x.dataset.o] = x.checked; }));
  });
  if (a !== 'go') return null;
  Object.assign(cmpOpts, st.o); store.set('compare', cmpOpts);
  if (again) return cmpRerun({ swap: st.swap !== !cmp.new.fromDoc, opts: st.o });
  return cmpStart({ bytes: st.picked.bytes, name: st.picked.name, date: st.picked.date, swap: st.swap, opts: st.o });
}
function cmpOptionsAgain() { if (cmp) cmpDialog({ name: (cmp.new.fromDoc ? cmp.old : cmp.new).name }, { again: true }); }
// Compares the open document with a PDF given as bytes. swap: the given PDF is New and the open document Old.
async function cmpStart({ bytes, name = 'Other.pdf', date = null, swap = false, opts = cmpOpts } = {}) {
  if (!has() || cmpBusy) return null;
  let pd;
  try { pd = await loadProtected(bytes, name); }
  catch (e) { console.error(e); toast(`Could not open ${name}: it may not be a PDF.`); return null; }
  if (!pd) return null;
  if (cmp) cmpClose();
  const other = cmpFileSide(pd, bytes, name, date), mine = cmpDocSide();
  return cmpOpen(swap ? mine : other, swap ? other : mine, opts);
}
// The same two files again: swapped, or with other options.
async function cmpRerun({ swap = false, opts = cmp.opts } = {}) {
  if (!cmp || cmpBusy) return null;
  const [o, n] = swap ? [cmp.new, cmp.old] : [cmp.old, cmp.new];
  return cmpOpen(o, n, opts);
}

document.addEventListener('keydown', (e) => {
  if (!cmpOn() || $('#dialog').open || e.ctrlKey || e.metaKey || e.altKey) return;
  const a = document.activeElement;
  if (a && (/INPUT|TEXTAREA|SELECT/.test(a.tagName) || a.isContentEditable)) return;
  if (e.key === ']' || e.key === '[') { e.preventDefault(); e.stopPropagation(); cmpStep(e.key === ']' ? 1 : -1); }
  else if (e.key === 'Escape' && pop.hidden) { e.preventDefault(); e.stopPropagation(); cmpClose(); }
}, true);
FEATURE.onDocClosed.push(() => { if (cmp || cmpOn()) cmpClose(); });
FEATURE.onDocShown.push(() => { if (cmp && cmp.new.d !== doc && cmp.old.d !== doc) cmpClose(); });
window.addEventListener('resize', () => { if (cmpOn() && cmp) { clearTimeout(cmp.rt); cmp.rt = setTimeout(() => { if (cmp) { cmpLayout(); cmpGo(cmp.now, true); } }, 200); } });

cmd('compare', { label: 'Compare with another PDF…', rlabel: 'Compare', icon: 'git-compare', enabled: () => has() && !cmpBusy, pressed: cmpOn, run: () => (cmpOn() ? cmpClose() : cmpPick()) });
{ const fm = MENUS.find(([t]) => t === 'File'); if (fm) { const i = fm[1].indexOf('merge'); fm[1].splice(i >= 0 ? i + 1 : fm[1].length, 0, 'compare'); } }
// (Home is full on a 1440 px screen: its test keeps it so. Compare sits with the other reviewing tools.)
ribbonAdd('markup', 'Review', ['compare']);

addStyle(`
.workspace { position: relative; }
.cmp { position: absolute; inset: 0; z-index: 40; display: flex; flex-direction: column; background: var(--canvas); color: var(--ink); min-width: 0; }
.cmp[hidden] { display: none; }
.cmp-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 12px; background: var(--chrome); border-bottom: 1px solid var(--line); }
.cmp-names { display: flex; align-items: center; gap: 6px; min-width: 0; }
.cmp-name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: 13px; }
.cmp-tag { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: .02em; padding: 2px 7px; border-radius: 6px; background: var(--hover); color: var(--ink-2); flex: none; }
.cmp-tag.new { background: color-mix(in srgb, #2F9E44 22%, transparent); color: var(--ink); }
.cmp-tag.old { background: color-mix(in srgb, #E03131 20%, transparent); color: var(--ink); }
.cmp-spacer { flex: 1; }
.cmp-step, .cmp-zoom { display: inline-flex; align-items: center; gap: 2px; }
.cmp-count { min-width: 56px; text-align: center; font-size: 13px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.cmp .cmp-show { display: none; }
.cmp .cmp-list-btn { display: none; }
.cmp-body { position: relative; flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 300px; }
.cmp-panes { display: grid; grid-template-columns: 1fr 1fr; min-width: 0; min-height: 0; }
.cmp[data-mode="overlay"] .cmp-panes { grid-template-columns: 1fr; }
.cmp[data-mode="overlay"] .cmp-pane[data-side="old"] { display: none; }
.cmp-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-right: 1px solid var(--line); }
.cmp-head { display: flex; align-items: center; gap: 8px; padding: 6px 12px; font-size: 12px; color: var(--ink-2); background: var(--chrome); border-bottom: 1px solid var(--line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cmp-scroll { flex: 1; overflow: auto; min-height: 0; outline: none; }
.cmp-scroll:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
.cmp-rows { padding: 8px 20px 40px; width: max-content; min-width: 100%; box-sizing: border-box; }
.cmp-row { display: flex; justify-content: center; align-items: flex-start; padding-top: 8px; box-sizing: border-box; }
.cmp-slot { position: relative; background: #fff; box-shadow: var(--page-shadow); flex: none; color-scheme: light; }
.cmp-slot canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.cmp[data-mode="overlay"] .cmp-slot canvas.cmp-under { opacity: .35; }
.cmp[data-mode="overlay"] .cmp-slot canvas.cmp-pdf:not(:only-of-type) { mix-blend-mode: multiply; }
.cmp-pno { position: absolute; left: -18px; top: 0; font-size: 11px; color: var(--ink-3); }
.cmp-missing { flex: none; display: flex; align-items: center; justify-content: center; border: 2px dashed var(--line); border-radius: 4px; color: var(--ink-2); font-size: 13px; text-align: center; padding: 12px; box-sizing: border-box; }
.cmp-hl { position: absolute; border-radius: 2px; cursor: pointer; mix-blend-mode: multiply; }
.cmp-hl.k-insert { background: rgba(47,158,68,.35); }
.cmp-hl.k-delete { background: rgba(224,49,49,.33); }
.cmp-hl.k-replace { background: rgba(245,159,0,.42); }
.cmp-hl.k-format { background: rgba(245,159,0,.18); outline: 1.5px dashed rgba(230,119,0,.9); }
.cmp-hl.k-visual { background: rgba(28,126,214,.12); outline: 2px solid rgba(28,126,214,.9); mix-blend-mode: normal; }
.cmp-hl.gap { background: none; border-left: 3px solid; border-radius: 0; }
.cmp-hl.gap.k-insert { border-color: rgb(47,158,68); } .cmp-hl.gap.k-delete { border-color: rgb(224,49,49); }
.cmp-hl.now { box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--accent); mix-blend-mode: normal; z-index: 2; }
.cmp-hide-insert .f-insert.cmp-hl, .cmp-hide-delete .f-delete.cmp-hl, .cmp-hide-replace .f-replace.cmp-hl, .cmp-hide-format .f-format.cmp-hl, .cmp-hide-visual .f-visual.cmp-hl,
.cmp-hide-insert li:has(> .f-insert), .cmp-hide-delete li:has(> .f-delete), .cmp-hide-replace li:has(> .f-replace), .cmp-hide-format li:has(> .f-format), .cmp-hide-visual li:has(> .f-visual), .cmp-hide-page li:has(> .f-page) { display: none; }
.cmp-side { display: flex; flex-direction: column; min-height: 0; background: var(--surface); border-left: 1px solid var(--line); }
.cmp-sum { padding: 12px 14px 4px; font-weight: 600; }
.cmp-filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 12px 10px; border-bottom: 1px solid var(--line); }
.cmp-chip { display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 12px; padding: 3px 9px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: var(--ink-2); cursor: pointer; }
.cmp-chip[aria-pressed="true"] { background: var(--hover); color: var(--ink); }
.cmp-chip[aria-pressed="false"] .cmp-dot { opacity: .25; }
.cmp-chip:disabled { opacity: .45; cursor: default; }
.cmp-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.f-insert .cmp-dot, .k-insert .cmp-badge { background: #2F9E44; } .f-delete .cmp-dot, .k-delete .cmp-badge { background: #E03131; }
.f-replace .cmp-dot, .k-replace .cmp-badge, .f-format .cmp-dot, .k-format .cmp-badge { background: #F59F00; }
.f-visual .cmp-dot, .k-visual .cmp-badge { background: #1C7ED6; } .f-page .cmp-dot, .k-pageInsert .cmp-badge, .k-pageRemove .cmp-badge { background: #7048E8; }
.cmp-list { flex: 1; overflow: auto; padding: 4px 0 20px; }
.cmp-list ol { list-style: none; margin: 0; padding: 0; }
.cmp-grp h3 { font-size: 12px; font-weight: 600; color: var(--ink-2); margin: 10px 14px 4px; display: flex; gap: 6px; align-items: baseline; }
.cmp-grp h3 span { font-weight: 400; } .cmp-grp h3 b { margin-left: auto; font-weight: 500; color: var(--ink-3); }
.cmp-item { display: flex; align-items: baseline; gap: 8px; width: 100%; text-align: left; font: inherit; font-size: 13px; color: var(--ink); background: none; border: 0; padding: 6px 14px; cursor: pointer; }
.cmp-item:hover { background: var(--hover); }
.cmp-item[aria-current="true"] { background: var(--accent-soft); }
.cmp-badge { flex: none; font-size: 10.5px; font-weight: 700; color: #fff; padding: 1px 6px; border-radius: 5px; }
.k-replace .cmp-badge, .k-format .cmp-badge { color: #2b1d00; }
.cmp-txt { min-width: 0; overflow-wrap: anywhere; }
.cmp-none { padding: 14px; color: var(--ink-2); }
.cmp-busy { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--canvas) 80%, transparent); z-index: 5; }
.cmp-busy[hidden] { display: none; }
.cmp-busy-card { width: min(380px, calc(100% - 32px)); background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 18px; box-shadow: 0 10px 30px rgba(0,0,0,.2); display: flex; flex-direction: column; gap: 10px; }
.cmp-busy-card .btn { align-self: flex-end; }
.cmp-dlg .cmp-pick { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: center; margin: 4px 0 8px; }
.cmp-dlg .cmp-role { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 10px; border: 1px solid var(--line); border-radius: 10px; }
.cmp-dlg .cmp-role b { overflow-wrap: anywhere; font-weight: 600; }
.cmp-dlg .cmp-role .cmp-tag { align-self: flex-start; }
.cmp-opts { border: 0; margin: 10px 0 4px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.cmp-opts legend { color: var(--ink); font-weight: 600; padding: 0; margin-bottom: 4px; }
.cmp-opts label { display: flex; align-items: center; gap: 8px; color: var(--ink); cursor: pointer; min-height: 26px; }
.cmp-opts input { accent-color: var(--brand); width: 16px; height: 16px; margin: 0; flex: none; }
@media (max-width: 1200px) { .cmp-bar .btn:not(.primary) > span { display: none; } .cmp-bar .btn:not(.primary) { padding: 0 10px; } .cmp-mode > button > span { display: none; } }
@media (max-width: 760px), (max-height: 500px) and (pointer: coarse) {
  .cmp-body { grid-template-columns: 1fr; }
  .cmp-panes { grid-template-columns: 1fr; }
  .cmp[data-show="new"] .cmp-pane[data-side="old"], .cmp[data-show="old"] .cmp-pane[data-side="new"] { display: none; }
  .cmp[data-mode="overlay"] .cmp-pane[data-side="new"] { display: flex; }
  .cmp[data-mode="overlay"] .cmp-show { display: none; }
  .cmp .cmp-show { display: inline-grid; }
  .cmp-names, .cmp-zoom, .cmp-spacer { display: none; }
  .cmp .cmp-list-btn { display: inline-flex; }
  .cmp-list-btn > span { display: inline !important; }
  .cmp-bar .btn.primary > span { display: none; }
  .cmp-side { position: absolute; left: 0; right: 0; bottom: 0; max-height: 60%; z-index: 4; border-top: 1px solid var(--line); border-left: 0; box-shadow: 0 -8px 24px rgba(0,0,0,.2); border-radius: 14px 14px 0 0; display: none; }
  .cmp.cmp-list-open .cmp-side { display: flex; }
  .cmp-rows { padding: 8px 12px 40px; }
}
`);

Object.assign(TEST_HOOKS, {
  cmpStart, cmpRerun, cmpClose, cmpGo, cmpStep, cmpListText, cmpReport, cmpSaveReport, cmpMyers, cmpAlign,
  cmpState: () => cmp && { old: cmp.old.name, new: cmp.new.name, now: cmp.now, mode: cmp.mode, show: cmp.show, pairs: cmp.pairs, changes: cmp.changes.map((c) => ({ id: c.id, kind: c.kind, o: c.o, n: c.n, was: c.was, now: c.now })) },
});
