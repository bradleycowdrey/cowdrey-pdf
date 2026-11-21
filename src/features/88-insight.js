/* ---------------- Insight: tables, a summary and questions, worked out on this device ----------------
   Text tools, not a chatbot: everything here comes from the document's own text, read with pdf.js, and nothing is
   sent anywhere or downloaded.

   Tables ("Extract table…" drags a box or clicks a table; "Find tables…" looks on a range of pages):
     - Ruled (lattice): the page's ruling lines from its drawing operators (re, m/l stroked, thin fills, through the
       CTM) make a grid; a ruling that stops short spans the cells either side of it. Words go in the cell their middle
       is in.
     - Unruled (stream): rows from the words' lines; columns where no row has text (the gaps between the starts and
       ends of the pieces of text, across the rows); a row with nothing in its first column carries on the row above.
     - Scanned pages use the text Recognize text (OCR) laid over them; without it, the dialog offers to run it.
     A preview lets you drag, add and remove column dividers and say whether the first row is a header. Out: CSV
     (UTF-8 with a BOM, RFC 4180 quoting), Excel (.xlsx: a minimal SpreadsheetML package, inline strings, numbers as
     numbers, made with crdZip), or the clipboard (tab-separated). Every table in a range goes to one .xlsx, a sheet
     each.
     Everything is worked out in the page as shown (points, y down, its rotation applied), so a turned page reads
     the right way up.
   Summarize: an extractive summary. The sentences (lines joined, words broken by a hyphen put back), TextRank over
     TF-IDF cosine similarity, the best few in the order they come, each with its page; and the key terms (TF-IDF
     words and phrases). With the browser's own on-device model (window.Summarizer or window.LanguageModel, only when
     it is already available), it can also write one; never offered where there is none (the apps).
   Ask the document: a panel; BM25 over passages (about three sentences each, by page) with light English stemming
     and stop words (other languages: words as they are). The best five, with the best sentence in each; choosing
     one goes to it and marks it on the page. */

/* --- words and lines, in the page as shown --- */
async function insPage(n) {
  const e = doc.pages[n], page = await pageOf(e), tc = await textOf(e);
  const vp = page.getViewport({ scale: 1, rotation: (page.rotate + e.rot) % 360 });
  return { e, page, tc, vp };
}
// Words with their boxes: x0, x1, y0 (top), y1 (bottom), cx, cy, size.
function insWords(P) {
  const { s, map } = findIndexOf(P.tc), out = [];
  for (const m of s.matchAll(/\S+/g)) {
    const parts = [];
    for (let c = m.index; c < m.index + m[0].length; c++) {
      const x = map[c]; if (!x) continue;
      const l = parts[parts.length - 1];
      if (l && l[0] === x[0] && l[2] === x[1]) l[2]++; else parts.push([x[0], x[1], x[1] + 1]);
    }
    const quads = parts.map(([i, a, b]) => cmpQuad(P.tc.items[i], a, b, P.tc.styles)).filter(Boolean);
    if (!quads.length) continue;
    const pts = quads.flat().map(([x, y]) => P.vp.convertToViewportPoint(x, y)), xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    out.push({ t: m[0], x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.max(1, (y1 - y0) / 1.15) });
  }
  return out;
}
const insMedian = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

/* --- ruling lines --- */
// Straight lines across or down the page, from its drawing: [{ h, a, b, at }] (h: across; a..b along, at: where).
async function insRulings(P) {
  if (P.rulings) return P.rulings;
  const O = pdfjs.OPS, out = [];
  let list; try { list = await P.page.getOperatorList(); } catch { return (P.rulings = []); }
  const STROKE = new Set([O.stroke, O.closeStroke, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
  const FILL = new Set([O.fill, O.eoFill, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
  const view = (x, y) => { const [px, py] = apply(ctm, x, y); return P.vp.convertToViewportPoint(px, py); };
  const seg = (p, q, tol = 1) => {
    const dx = Math.abs(p[0] - q[0]), dy = Math.abs(p[1] - q[1]);
    if (dy <= tol && dx > 2) out.push({ h: true, a: Math.min(p[0], q[0]), b: Math.max(p[0], q[0]), at: (p[1] + q[1]) / 2 });
    else if (dx <= tol && dy > 2) out.push({ h: false, a: Math.min(p[1], q[1]), b: Math.max(p[1], q[1]), at: (p[0] + q[0]) / 2 });
  };
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i], a = list.argsArray[i];
    if (fn === O.save) stack.push(ctm);
    else if (fn === O.restore) ctm = stack.pop() || ctm;
    else if (fn === O.transform) ctm = mul(a, ctm);
    else if (fn === O.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(a[0]) || (a[0] && a[0].length === 6)) ctm = mul(Array.from(a[0]), ctm); }
    else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === O.constructPath) {
      const [op, data] = a, path = data && data[0];
      const stroke = STROKE.has(op), fill = FILL.has(op);
      if ((!stroke && !fill) || !path || typeof path.length !== 'number') continue;
      // the path's pieces: DrawOPS moveTo 0, lineTo 1, curveTo 2 (6 numbers), quadraticCurveTo 3 (4), closePath 4
      const subs = []; let cur = null;
      for (let k = 0; k < path.length;) {
        const c = path[k++];
        if (c === 0) { cur = [view(path[k], path[k + 1])]; subs.push(cur); k += 2; }
        else if (c === 1) { if (!cur) { cur = []; subs.push(cur); } cur.push(view(path[k], path[k + 1])); k += 2; }
        else if (c === 2) { cur = null; k += 6; }
        else if (c === 3) { cur = null; k += 4; }
        else if (c === 4) { if (cur && cur.length) cur.push(cur[0]); }
        else break;
      }
      for (const sp of subs) {
        if (!sp || sp.length < 2) continue;
        const xs = sp.map((p) => p[0]), ys = sp.map((p) => p[1]), w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
        const square = sp.every((p, k) => !k || Math.abs(p[0] - sp[k - 1][0]) < 0.5 || Math.abs(p[1] - sp[k - 1][1]) < 0.5);
        if (stroke) for (let k = 1; k < sp.length; k++) seg(sp[k - 1], sp[k]);
        else if (fill && square && sp.length >= 4) {
          // a thin filled box is a line; a bigger one (a shaded cell) gives its edges
          if (h <= 4 && w > 2) seg([Math.min(...xs), (Math.min(...ys) + Math.max(...ys)) / 2], [Math.max(...xs), (Math.min(...ys) + Math.max(...ys)) / 2]);
          else if (w <= 4 && h > 2) seg([(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...ys)], [(Math.min(...xs) + Math.max(...xs)) / 2, Math.max(...ys)]);
          else for (let k = 1; k < sp.length; k++) seg(sp[k - 1], sp[k]);
        }
      }
    }
  }
  return (P.rulings = out);
}
// Lines on the same row (or column) that touch become one.
function insJoin(lines, tol = 2) {
  const out = [];
  for (const l of [...lines].sort((p, q) => p.at - q.at || p.a - q.a)) {
    const m = out.find((x) => Math.abs(x.at - l.at) <= tol && l.a <= x.b + tol && x.a <= l.b + tol);
    if (m) { m.a = Math.min(m.a, l.a); m.b = Math.max(m.b, l.b); m.at = (m.at + l.at) / 2; } else out.push({ ...l });
  }
  return out;
}
const insCluster = (vals, tol) => { const out = []; for (const v of [...vals].sort((a, b) => a - b)) { const l = out[out.length - 1]; if (l && v - l.v <= tol) { l.n++; l.v += (v - l.v) / l.n; l.max = v; } else out.push({ v, n: 1, max: v }); } return out.map((c) => c.v); };
// Ruled tables: groups of lines that cross, with at least two across and two down. [{ box, xs, ys, h, v }]
function insGrids(lines, box) {
  const tol = 2.5, inBox = (l) => !box || (l.h ? l.at >= box[1] - tol && l.at <= box[3] + tol && l.b >= box[0] - tol && l.a <= box[2] + tol : l.at >= box[0] - tol && l.at <= box[2] + tol && l.b >= box[1] - tol && l.a <= box[3] + tol);
  const clip = (l) => (!box ? l : l.h ? { ...l, a: Math.max(l.a, box[0]), b: Math.min(l.b, box[2]) } : { ...l, a: Math.max(l.a, box[1]), b: Math.min(l.b, box[3]) });
  const H = insJoin(lines.filter((l) => l.h && inBox(l)).map(clip)), V = insJoin(lines.filter((l) => !l.h && inBox(l)).map(clip));
  const all = [...H, ...V], parent = all.map((_, k) => k), find = (k) => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  H.forEach((h, i) => V.forEach((v, j) => { if (v.at >= h.a - tol && v.at <= h.b + tol && h.at >= v.a - tol && h.at <= v.b + tol) parent[find(i)] = find(H.length + j); }));
  const groups = new Map(); all.forEach((l, k) => { const r = find(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(l); });
  const out = [];
  for (const g of groups.values()) {
    const gh = g.filter((l) => l.h), gv = g.filter((l) => !l.h);
    if (gh.length < 2 || gv.length < 2) continue;
    const xs = insCluster(gv.map((l) => l.at), tol), ys = insCluster(gh.map((l) => l.at), tol);
    if (xs.length < 2 || ys.length < 2) continue;
    out.push({ box: [xs[0], ys[0], xs[xs.length - 1], ys[ys.length - 1]], xs, ys, h: gh, v: gv });
  }
  return out;
}
// A ruled table's merged cells: where a line between two cells is missing, they are one.
function insSpans(g) {
  const nr = g.ys.length - 1, nc = g.xs.length - 1, tol = 2.5, root = Array.from({ length: nr * nc }, (_, k) => k);
  const find = (k) => (root[k] === k ? k : (root[k] = find(root[k])));
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) root[Math.max(ra, rb)] = Math.min(ra, rb); };
  const covers = (ls, at, mid) => ls.some((l) => Math.abs(l.at - at) <= tol && l.a - tol <= mid && mid <= l.b + tol);
  for (let r = 0; r < nr; r++) for (let c = 1; c < nc; c++) if (!covers(g.v, g.xs[c], (g.ys[r] + g.ys[r + 1]) / 2)) union(r * nc + c - 1, r * nc + c);
  for (let r = 1; r < nr; r++) for (let c = 0; c < nc; c++) if (!covers(g.h, g.ys[r], (g.xs[c] + g.xs[c + 1]) / 2)) union((r - 1) * nc + c, r * nc + c);
  const m = root.map((_, k) => find(k));
  return m.some((x, k) => x !== k) ? m : null;
}

/* --- unruled tables --- */
// Rows: the words' lines (middles within half a line of each other).
function insRows(words) {
  const ws = [...words].sort((a, b) => a.cy - b.cy || a.x0 - b.x0), rows = [];
  for (const w of ws) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(w.cy - r.cy) <= Math.max(2, 0.5 * Math.min(w.size, r.size))) { r.words.push(w); r.cy = (r.cy * (r.words.length - 1) + w.cy) / r.words.length; r.y0 = Math.min(r.y0, w.y0); r.y1 = Math.max(r.y1, w.y1); }
    else rows.push({ cy: w.cy, size: w.size, y0: w.y0, y1: w.y1, words: [w] });
  }
  for (const r of rows) {
    r.words.sort((a, b) => a.x0 - b.x0);
    // pieces: words closer than about a letter's width are one piece of text
    r.segs = [];
    for (const w of r.words) { const s = r.segs[r.segs.length - 1]; if (s && w.x0 - s.x1 < Math.max(4, 0.8 * w.size)) { s.x1 = Math.max(s.x1, w.x1); s.n++; } else r.segs.push({ x0: w.x0, x1: w.x1, n: 1 }); }
  }
  return rows;
}
// Column dividers for rows of pieces: the middles of the gaps no row (or hardly any) has text in.
function insColumns(rows, box) {
  const many = rows.filter((r) => r.segs.length >= 2), use = many.length >= 2 ? many : rows;
  const lo = box ? box[0] : Math.min(...use.flatMap((r) => r.segs.map((s) => s.x0))), hi = box ? box[2] : Math.max(...use.flatMap((r) => r.segs.map((s) => s.x1)));
  const n = Math.max(1, Math.ceil(hi - lo)), cover = new Uint16Array(n + 1);
  for (const r of use) for (const s of r.segs) for (let x = Math.max(0, Math.floor(s.x0 - lo)); x <= Math.min(n, Math.ceil(s.x1 - lo)); x++) cover[x]++;
  const allow = Math.floor(use.length * 0.1), size = insMedian(use.map((r) => r.size)) || 10, cuts = [];
  let first = 0; while (first <= n && cover[first] <= allow) first++;
  let last = n; while (last >= 0 && cover[last] <= allow) last--;
  for (let x = first; x <= last;) {
    if (cover[x] > allow) { x++; continue; }
    let e = x; while (e <= last && cover[e] <= allow) e++;
    if (e - x >= Math.max(4, 0.6 * size)) cuts.push(lo + (x + e) / 2);
    x = e;
  }
  return { xs: [lo + first - 1, ...cuts, lo + last + 1], size };
}
// Row boundaries (top to bottom) between rows of words.
function insRowLines(rows) {
  const ys = [rows[0].y0 - 1];
  for (let k = 1; k < rows.length; k++) ys.push((rows[k - 1].y1 + rows[k].y0) / 2);
  ys.push(rows[rows.length - 1].y1 + 1);
  return ys;
}
// Unruled tables among words: runs of rows that have two or more pieces of text, lined up in columns.
function insStreamTables(words, box) {
  const rows = insRows(words); if (!rows.length) return [];
  const make = (rs) => {
    const { xs } = insColumns(rs, box); if (xs.length < 3) return null;
    const ys = insRowLines(rs);
    return { box: box ? [...box] : [xs[0], ys[0], xs[xs.length - 1], ys[ys.length - 1]], xs, ys, method: 'stream' };
  };
  if (box) { const t = make(rows); return t ? [t] : []; }
  // On a whole page: blocks of at least three rows, most with two pieces or more, close together.
  const out = []; let run = [];
  const flush = () => {
    while (run.length && run[run.length - 1].segs.length < 2) run.pop();
    const many = run.filter((r) => r.segs.length >= 2).length;
    if (many >= 3 && many * 2 >= run.length) { const t = make(run); if (t) out.push(t); }
    run = [];
  };
  for (const r of rows) {
    const last = run[run.length - 1];
    if (last && r.y0 - last.y1 > 2.2 * Math.max(r.size, last.size)) flush();
    if (!run.length && r.segs.length < 2) continue;
    run.push(r);
    if (run.length >= 3 && run.slice(-3).every((x) => x.segs.length < 2)) { run.splice(-3); flush(); }
  }
  flush();
  return out;
}

/* --- cells --- */
// The text of each cell, row by row (merged cells: their text in the first, the rest empty).
function insCells(t, words) {
  const nr = t.ys.length - 1, nc = t.xs.length - 1, cells = Array.from({ length: nr * nc }, () => []);
  for (const w of words) {
    if (w.cx < t.xs[0] || w.cx > t.xs[nc] || w.cy < t.ys[0] || w.cy > t.ys[nr]) continue;
    let c = 0; while (c < nc - 1 && w.cx >= t.xs[c + 1]) c++;
    let r = 0; while (r < nr - 1 && w.cy >= t.ys[r + 1]) r++;
    const k = t.spans ? t.spans[r * nc + c] : r * nc + c;
    cells[k].push(w);
  }
  const text = (ws) => insRows(ws).map((r) => r.words.map((w) => w.t).join(' ')).join(' ').trim();
  let rows = Array.from({ length: nr }, (_, r) => Array.from({ length: nc }, (_, c) => text(cells[r * nc + c])));
  if (t.method === 'stream') {
    // a row with nothing in its first column carries on the one above (a cell of several lines)
    const out = [];
    for (const row of rows) {
      const prev = out[out.length - 1];
      if (prev && !row[0] && row.some(Boolean)) row.forEach((v, c) => { if (v) prev[c] = prev[c] ? prev[c] + ' ' + v : v; });
      else out.push(row);
    }
    rows = out;
  }
  // rows and columns with nothing in them are left out
  rows = rows.filter((r) => r.some(Boolean));
  const keep = Array.from({ length: nc }, (_, c) => rows.some((r) => r[c]));
  return rows.map((r) => r.filter((_, c) => keep[c]));
}
// Tables on page n: in a box (view points), or anywhere on it. [{ n, box, xs, ys, spans?, method }]
async function insFindOn(n, box = null) {
  const P = await insPage(n), words = insWords(P);
  const grids = insGrids(await insRulings(P), box).filter((g) => words.some((w) => w.cx > g.box[0] && w.cx < g.box[2] && w.cy > g.box[1] && w.cy < g.box[3]));
  const tables = grids.map((g) => ({ n, box: g.box, xs: g.xs, ys: g.ys, spans: insSpans(g), method: 'lattice' }));
  const outside = words.filter((w) => !tables.some((t) => w.cx >= t.box[0] && w.cx <= t.box[2] && w.cy >= t.box[1] && w.cy <= t.box[3]));
  if (box && !tables.length) { const inner = outside.filter((w) => w.cx >= box[0] && w.cx <= box[2] && w.cy >= box[1] && w.cy <= box[3]); tables.push(...insStreamTables(inner, box).map((t) => ({ ...t, n }))); }
  else if (!box) tables.push(...insStreamTables(outside, null).map((t) => ({ ...t, n })));
  tables.sort((a, b) => a.box[1] - b.box[1]);
  return { tables, words, P, noText: !words.length };
}

/* --- out --- */
function insCsv(rows) {
  const q = (v) => (/[",\r\n]|^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return '﻿' + rows.map((r) => r.map((v) => q(String(v))).join(',')).join('\r\n') + '\r\n';
}
const insTsv = (rows) => rows.map((r) => r.map((v) => String(v).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
const INS_NUM = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
// A number Excel can hold exactly: no leading zero (a code), and at most 15 significant digits, so a long account
// number or ID stays text and keeps every digit.
const insIsNum = (v) => INS_NUM.test(v) && !/^[-+]?0\d/.test(v) && v.replace(/\D/g, '').replace(/^0+|0+$/g, '').length <= 15;
const insXml = (s) => String(s).replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const insCol = (c) => { let s = ''; for (c++; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s; return s; };
// A minimal .xlsx: one sheet per table. sheets: [{ name, rows, header }]
function insXlsx(sheets) {
  const enc = new TextEncoder(), X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const used = new Set(), names = sheets.map((s, k) => {
    let n = String(s.name || `Table ${k + 1}`).replace(/[\[\]:*?/\\]/g, ' ').replace(/^'|'$/g, '').trim().slice(0, 31) || `Table ${k + 1}`;
    for (let i = 2; used.has(n.toLowerCase()); i++) n = `${n.slice(0, 27)} (${i})`;
    used.add(n.toLowerCase()); return n;
  });
  const files = [
    ['[Content_Types].xml', `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, k) => `<Override PartName="/xl/worksheets/sheet${k + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${X}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, k) => `<sheet name="${insXml(n)}" sheetId="${k + 1}" r:id="rId${k + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, k) => `<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${k + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', `${X}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`],
    ...sheets.map((s, k) => [`xl/worksheets/sheet${k + 1}.xml`, `${X}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${s.rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => {
      v = String(v ?? ''); if (!v) return '';
      const ref = insCol(c) + (r + 1), st = s.header && r === 0 ? ' s="1"' : '';
      if (insIsNum(v) && !(s.header && r === 0)) return `<c r="${ref}"${st}><v>${Number(v.replace(/[,+]/g, ''))}</v></c>`;
      return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${insXml(v)}</t></is></c>`;
    }).join('')}</row>`).join('')}</sheetData></worksheet>`]),
  ];
  return crdZip(files.map(([name, text]) => ({ name, data: enc.encode(text) })));
}
const insTableName = (t, k, of) => `${doc.name} p${t.n + 1}${of > 1 ? ` table ${k + 1}` : ''}`;
async function insSave(kind, rows, t, header) {
  const base = `${doc.name} table p${t.n + 1}`;
  if (kind === 'csv') return saveFile(insCsv(rows), base + '.csv', 'text/csv');
  if (kind === 'xlsx') return saveFile(insXlsx([{ name: `Page ${t.n + 1}`, rows, header }]), base + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  if (kind === 'copy') {
    try { await navigator.clipboard.writeText(insTsv(rows)); toast('Table copied. Paste it into a spreadsheet.'); } catch { toast('Could not copy the table'); }
  }
  return null;
}

/* --- the table preview --- */
let insLast = null; // what the last preview was left with (for the tests)
async function insPreview(t, words, P) {
  const tb = { ...t, xs: [...t.xs], ys: [...t.ys], header: true };
  const W = tb.box[2] - tb.box[0], H = tb.box[3] - tb.box[1], s = Math.min(2.5, 560 / Math.max(40, W), 360 / Math.max(20, H));
  const rowsNow = () => insCells(tb, words);
  const gridHtml = () => {
    const rows = rowsNow(); insLast = { rows, header: tb.header, xs: [...tb.xs] };
    if (!rows.length) return '<p class="ins-none">No text in this table.</p>';
    return `<table>${rows.map((r, k) => `<tr>${r.map((v) => (k === 0 && tb.header ? `<th>${esc(v)}</th>` : `<td>${esc(v)}</td>`)).join('')}</tr>`).join('')}</table>`;
  };
  const divHtml = () => tb.xs.slice(1, -1).map((x, k) => `<div class="ins-div" data-k="${k + 1}" style="left:${((x - tb.box[0]) * s).toFixed(1)}px" role="slider" tabindex="0" aria-label="Column divider ${k + 1}" aria-valuenow="${Math.round(x)}"><button type="button" class="ins-div-x" data-del="${k + 1}" title="Remove this divider" aria-label="Remove divider ${k + 1}">${ic('x')}</button></div>`).join('');
  const rowLines = () => tb.ys.slice(1, -1).map((y) => `<i class="ins-rowline" style="top:${((y - tb.box[1]) * s).toFixed(1)}px"></i>`).join('');
  const body = `<div class="ins-tbl">
    <p class="ins-note">${tb.method === 'lattice' ? 'Found by the table’s lines.' : 'Found by how the text lines up.'} Drag a divider to move it, double-click the picture to add one, or × to remove one.</p>
    <div class="ins-prev"><div class="ins-img" style="width:${(W * s).toFixed(0)}px;height:${(H * s).toFixed(0)}px"><canvas></canvas><div class="ins-lines">${rowLines()}</div><div class="ins-divs">${divHtml()}</div></div></div>
    <div class="ins-row"><label class="ins-check"><input type="checkbox" id="insHeader" checked> First row is header</label><button type="button" class="btn" data-add>${ic('plus')}<span>Add divider</span></button></div>
    <div class="ins-grid" aria-label="Table preview">${gridHtml()}</div>
  </div>`;
  const a = await dialog(`Table on page ${t.n + 1}`, body, [{ label: 'Cancel' }, { label: 'Copy as table', value: 'copy' }, { label: 'Save CSV', value: 'csv' }, { label: 'Save Excel', value: 'xlsx', primary: true }], (dlg) => {
    $('.dlg-body', dlg).classList.add('ins-wide'); dlg.classList.add('ins-dlg');
    const img = $('.ins-img', dlg), cv = $('canvas', img);
    (async () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const vp = P.page.getViewport({ scale: s * dpr, rotation: P.vp.rotation, offsetX: -tb.box[0] * s * dpr, offsetY: -tb.box[1] * s * dpr });
      cv.width = Math.max(1, Math.round(W * s * dpr)); cv.height = Math.max(1, Math.round(H * s * dpr));
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
      try { await P.page.render({ canvas: cv, canvasContext: g, viewport: vp }).promise; } catch {}
    })();
    const redraw = () => { $('.ins-divs', dlg).innerHTML = divHtml(); $('.ins-grid', dlg).innerHTML = gridHtml(); icons(); };
    const edited = () => { tb.spans = null; };
    const toX = (clientX) => tb.box[0] + (clientX - img.getBoundingClientRect().left) / s;
    const addAt = (x) => { if (x <= tb.xs[0] + 2 || x >= tb.xs[tb.xs.length - 1] - 2) return; tb.xs.push(x); tb.xs.sort((p, q) => p - q); edited(); redraw(); };
    img.addEventListener('dblclick', (e) => { if (!e.target.closest('.ins-div')) addAt(toX(e.clientX)); });
    $('[data-add]', dlg).onclick = () => {
      // in the middle of the widest column
      let best = 0; for (let k = 1; k < tb.xs.length; k++) if (tb.xs[k] - tb.xs[k - 1] > tb.xs[best + 1] - tb.xs[best]) best = k - 1;
      addAt((tb.xs[best] + tb.xs[best + 1]) / 2);
    };
    $('#insHeader', dlg).onchange = (e) => { tb.header = e.target.checked; $('.ins-grid', dlg).innerHTML = gridHtml(); };
    $('.ins-divs', dlg).addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) { tb.xs.splice(+b.dataset.del, 1); edited(); redraw(); } });
    $('.ins-divs', dlg).addEventListener('pointerdown', (e) => {
      const d = e.target.closest('.ins-div'); if (!d || e.target.closest('[data-del]')) return;
      e.preventDefault(); const k = +d.dataset.k; d.setPointerCapture(e.pointerId);
      const move = (ev) => { const x = Math.max(tb.xs[k - 1] + 2, Math.min(tb.xs[k + 1] - 2, toX(ev.clientX))); tb.xs[k] = x; d.style.left = ((x - tb.box[0]) * s) + 'px'; };
      const up = () => { d.removeEventListener('pointermove', move); d.removeEventListener('pointerup', up); edited(); redraw(); };
      d.addEventListener('pointermove', move); d.addEventListener('pointerup', up);
    });
    $('.ins-divs', dlg).addEventListener('keydown', (e) => {
      const d = e.target.closest('.ins-div'); if (!d) return;
      const k = +d.dataset.k, step = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); tb.xs.splice(k, 1); edited(); redraw(); return; }
      if (!dx) return;
      e.preventDefault(); tb.xs[k] = Math.max(tb.xs[k - 1] + 2, Math.min(tb.xs[k + 1] - 2, tb.xs[k] + dx)); edited(); redraw();
      const again = $(`.ins-div[data-k="${k}"]`, dlg); if (again) again.focus();
    });
  });
  if (!a) return null;
  const rows = rowsNow();
  await insSave(a, rows, t, tb.header);
  return { action: a, rows };
}
// No text on the page: offer Recognize text.
async function insNoText(n) {
  const a = await dialog('This page has no text yet', `<p>Page ${n + 1} looks like a scan: its words are a picture. Recognize the text first, then extract the table.</p>`, [{ label: 'Cancel' }, ...(C.ocr ? [{ label: 'Recognize text', value: 'ocr', primary: true }] : [])]);
  if (a === 'ocr') run('ocr');
}
// A table at a point or in a box on page n (view points). Returns what the preview did.
async function insTableAt(n, box, point) {
  const found = await insFindOn(n, box);
  if (found.noText) { await insNoText(n); return null; }
  let t = found.tables[0];
  if (point) t = found.tables.find((x) => point[0] >= x.box[0] && point[0] <= x.box[2] && point[1] >= x.box[1] && point[1] <= x.box[3]);
  if (!t) { toast(point ? 'No table there. Drag a box around the table.' : 'No table found in that box'); return null; }
  return insPreview(t, found.words, found.P);
}
// The tool: drag a box around a table, or click one.
TOOL_HINTS.instable = 'Drag a box around the table, or click a table';
FEATURE.tools.instable = {
  down(e, v) {
    e.preventDefault();
    const [sx, sy] = localPoint(e, v), svg = v.el.querySelector('svg.marks');
    let draft = null, cx = sx, cy = sy;
    const move = (ev) => {
      [cx, cy] = pagePoint(ev, v);
      if (!draft && Math.hypot(cx - sx, cy - sy) < 5) return;
      if (!draft) { draft = svgEl('rect', { class: 'ins-draft', rx: 2 }); svg.appendChild(draft); }
      draft.setAttribute('x', Math.min(sx, cx)); draft.setAttribute('y', Math.min(sy, cy)); draft.setAttribute('width', Math.abs(cx - sx)); draft.setAttribute('height', Math.abs(cy - sy));
    };
    const up = async () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      const k = v.viewport.scale, n = views.indexOf(v);
      if (draft) draft.remove();
      setTool('select');
      if (draft) return insTableAt(n, [Math.min(sx, cx) / k, Math.min(sy, cy) / k, Math.max(sx, cx) / k, Math.max(sy, cy) / k]);
      return insTableAt(n, null, [sx / k, sy / k]);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  },
};
// Every table on a range of pages, in a list; one .xlsx with a sheet each.
async function insFindDialog() {
  if (!has()) return;
  const st = { which: 'current', range: `1-${doc.pages.length}` };
  const a = await dialog('Find tables', `<div class="ocr-dlg"><p>Looks for tables in the text of the pages, on this device.</p>
    <fieldset class="ocr-pages"><legend>Pages</legend>
      <label><input type="radio" name="insWhich" value="current" checked> This page (${current + 1})</label>
      <label><input type="radio" name="insWhich" value="all"> All pages (${doc.pages.length})</label>
      <label class="ocr-range"><input type="radio" name="insWhich" value="range"> Pages <input type="text" id="insRange" value="${esc(st.range)}" aria-label="Page range, for example 1-3, 5" autocomplete="off"></label>
    </fieldset></div>`, [{ label: 'Cancel' }, { label: 'Find tables', value: 'go', primary: true }], (dlg) => {
    $$('[name="insWhich"]', dlg).forEach((r) => r.addEventListener('change', () => { st.which = r.value; }));
    const rg = $('#insRange', dlg);
    rg.addEventListener('input', () => { st.range = rg.value; st.which = 'range'; $('[name="insWhich"][value="range"]', dlg).checked = true; });
  });
  if (a !== 'go') return;
  const pages = st.which === 'all' ? doc.pages.map((_, n) => n) : st.which === 'range' ? parseRange(st.range, doc.pages.length) : [current];
  if (!pages.length) { toast('No pages in that range'); return; }
  return insFindRun(pages);
}
async function insFindRun(pages, { list = true } = {}) {
  const found = [], bare = [];
  for (let k = 0; k < pages.length; k++) {
    if (pages.length > 3) toast(`Looking at page ${pages[k] + 1} (${k + 1} of ${pages.length})…`);
    const r = await insFindOn(pages[k]);
    if (r.noText) bare.push(pages[k]);
    for (const t of r.tables) { const rows = insCells(t, r.words); if (rows.length >= 2 && rows[0].length >= 2) found.push({ t, rows, words: r.words, P: r.P }); }
  }
  if (!list) return { found, bare };
  if (!found.length) {
    if (bare.length === pages.length) { await insNoText(bare[0]); return { found, bare }; }
    toast(bare.length ? `No tables found. ${bare.length === 1 ? '1 page has' : `${bare.length} pages have`} no text: recognize the text first.` : 'No tables found');
    return { found, bare };
  }
  const st = { pick: null };
  const a = await dialog(found.length === 1 ? '1 table found' : `${found.length} tables found`, `<div class="ins-found">
    <ol>${found.map((f, k) => `<li><button type="button" class="ins-found-item" data-k="${k}">${ic('table')}<span><b>Page ${f.t.n + 1}</b> · ${f.rows.length} rows, ${f.rows[0].length} columns · ${f.t.method === 'lattice' ? 'ruled' : 'by spacing'}<small>${esc(f.rows[0].join(' · ').slice(0, 90))}</small></span></button></li>`).join('')}</ol>
    ${bare.length ? `<p class="ins-note">${bare.length === 1 ? `Page ${bare[0] + 1} has` : `${bare.length} pages have`} no text: recognize the text to look there too.</p>` : ''}
    <p class="ins-note">Choose a table to check it and change its columns, or save them all to one Excel file, a sheet each.</p></div>`,
  [{ label: 'Close' }, { label: 'Save all as Excel', value: 'xlsx', primary: true }], (dlg) => {
    $$('.ins-found-item', dlg).forEach((b) => { b.onclick = () => { st.pick = +b.dataset.k; $('[data-x]', dlg).click(); }; });
  });
  if (st.pick != null) { const f = found[st.pick]; return insPreview(f.t, f.words, f.P); }
  if (a === 'xlsx') {
    const sheets = found.map((f, k) => ({ name: `Page ${f.t.n + 1}${found.filter((g) => g.t.n === f.t.n).length > 1 ? ` (${found.filter((g, j) => g.t.n === f.t.n && j <= k).length})` : ''}`, rows: f.rows, header: true }));
    await saveFile(insXlsx(sheets), `${doc.name} tables.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
  return { found, bare };
}

/* --- sentences --- */
const INS_BULLET = /^(?:[•▪▫◦‣⁃●○■□◆◇►▸▶➢➤✓✔∙·*–—-](?:\s|$)|[•▪▫◦‣⁃●○■□◆◇►▸▶➢➤✓✔∙]|\(?(?:\d{1,3}|[a-zA-Z]|[ivxIVX]{1,5})[.)](?:\s|$))/u;
const INS_GLYPH = /[•▪▫◦‣⁃●○■□◆◇►▸▶➢➤✓✔∙·*–—-]/u;
const INS_ABBR = /^(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|inc|ltd|co|corp|no|nos|fig|figs|p|pp|vol|e\.g|i\.e|cf|al|approx|dept|est|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|[a-z])\.$/i;
// A page's sentences: { text, a, b } with a..b the letters they cover in findIndexOf(tc).s. Lines are joined, a word
// broken by a hyphen at the end of a line is put back together, and a heading or a block further down starts anew.
function insSentencesOf(tc) {
  const { s, map } = findIndexOf(tc), starts = new Set();
  let prev = null;
  tc.items.forEach((it, i) => {
    if (!it.str || !it.str.trim() || !it.transform) return;
    const y = it.transform[5], h = it.height || Math.hypot(it.transform[2], it.transform[3]) || 10;
    if (prev && (Math.abs(prev.y - y) > 1.9 * Math.max(h, prev.h) || Math.max(h, prev.h) > 1.3 * Math.min(h, prev.h))) starts.add(i);
    // a bullet or a numbered item at the start of a line begins a new sentence (lists, slides, agendas)
    else if (prev && Math.abs(prev.y - y) > 0.5 * Math.min(h, prev.h) && INS_BULLET.test(it.str.trimStart())) starts.add(i);
    prev = { y, h };
  });
  const t = [], o = [];
  for (let k = 0; k < s.length; k++) {
    const c = s[k], m = map[k];
    if (m && m[1] === 0 && starts.has(m[0]) && t.length) { t.push('\u2029'); o.push(k); }
    if (c === '-' && m && k > 0 && /\p{L}/u.test(s[k - 1]) && /[\n ]/.test(s[k + 1] || '') && /\p{Ll}/u.test(s[k + 2] || '') && tc.items[m[0]].str.trimEnd().length - 1 === m[1]) { k++; continue; }
    if (/\s/.test(c)) { if (t.length && t[t.length - 1] !== ' ' && t[t.length - 1] !== '\u2029') { t.push(' '); o.push(k); } continue; }
    t.push(c); o.push(k);
  }
  const T = t.join(''), out = []; let start = 0;
  const push = (end) => {
    let a = start, b = end;
    while (a < b && /[\s\u2029]/.test(T[a])) a++;
    while (a < b && INS_GLYPH.test(T[a]) && /\s/.test(T[a + 1] || ' ')) { a++; while (a < b && /\s/.test(T[a])) a++; }
    while (b > a && /[\s\u2029]/.test(T[b - 1])) b--;
    if (b > a && /[\p{L}\p{N}]/u.test(T.slice(a, b))) out.push({ text: T.slice(a, b), a: o[a], b: o[b - 1] + 1 });
    start = end;
  };
  for (let k = 0; k < T.length; k++) {
    if (T[k] === '\u2029') { push(k); continue; }
    if (!/[.!?…]/.test(T[k])) continue;
    let e = k + 1; while (e < T.length && /[.!?…"'”’)\]]/.test(T[e])) e++;
    if (e < T.length && !(T[e] === ' ' && /[\p{Lu}\p{N}"“‘(\[]/u.test(T[e + 1] || '')) && T[e] !== '\u2029') continue;
    if (T[k] === '.' && e === k + 1 && INS_ABBR.test((T.slice(0, k + 1).match(/(\S+)$/) || ['', ''])[1])) continue;
    if (/^[\s\u2029]*\(?(?:\d{1,3}|[ivxIVX]{1,5})[.)]$/.test(T.slice(start, e))) continue; // "1." of a numbered item
    push(e); k = e - 1;
  }
  push(T.length);
  return out;
}
const INS_STOP = new Set(('a about above after again against all also am an and any are aren\'t as at be because been before being below between both but by can can\'t cannot could did do does doing don\'t down during each either few for from further had has have having he her here hers herself him himself his how i if in into is isn\'t it it\'s its itself just let me more most much must my myself no nor not now of off on once only or other ought our ours ourselves out over own per same she should so some such than that the their theirs them themselves then there these they this those through thus to too under until up upon us very via was we were what when where whether which while who whom whose why will with within without would yet you your yours yourself yourselves').split(' '));
// A light English stemmer: plurals, -ed and -ing, and a few long endings (enough to match "invoices" with "invoice").
function insStem(w) {
  if (w.length <= 3) return w;
  w = w.replace(/['’]s$/, '');
  if (/sses$/.test(w)) w = w.slice(0, -2);
  else if (/ies$/.test(w) && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (/[^su]s$/.test(w)) w = w.slice(0, -1);
  const m = w.match(/^(.*?)(ing|ed)$/);
  if (m && m[1].length >= 3 && /[aeiouy]/.test(m[1])) {
    w = m[1];
    if (/(at|bl|iz)$/.test(w)) w += 'e';
    else if (/([^aeiouylsz])\1$/.test(w)) w = w.slice(0, -1);
  }
  return w.replace(/ational$/, 'ate').replace(/ization$/, 'ize').replace(/(ful|ous|ive)ness$/, '$1').replace(/(.{4,})ly$/, '$1');
}
const insWordsOf = (s) => (String(s).toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) || []);
function insTokens(s, english) {
  const ws = insWordsOf(s);
  return english ? ws.filter((w) => !INS_STOP.has(w) && (w.length > 1 || /\d/.test(w))).map(insStem) : ws;
}
// The document's text: sentences of every page (or of `pages`), once per state of the pages.
const insCache = new WeakMap();
async function insText(pages = doc.pages.map((_, n) => n)) {
  const sig = pages.map((n) => pageKey(doc.pages[n])).join(',');
  const c = insCache.get(doc); if (c && c.sig === sig) return c;
  const sents = [];
  for (const n of pages) {
    const tc = await textOf(doc.pages[n]);
    for (const x of insSentencesOf(tc)) sents.push({ ...x, n, k: sents.length });
  }
  const all = sents.flatMap((x) => insWordsOf(x.text)), stops = all.filter((w) => INS_STOP.has(w)).length;
  const english = all.length > 0 && stops / all.length > 0.12;
  for (const x of sents) x.tok = insTokens(x.text, english);
  const out = { sig, sents, english };
  insCache.set(doc, out);
  return out;
}

/* --- summary --- */
// TF-IDF vectors of the sentences, and TextRank over their cosine similarity.
function insRank(sents) {
  const N = sents.length, df = new Map();
  for (const x of sents) for (const t of new Set(x.tok)) df.set(t, (df.get(t) || 0) + 1);
  const idf = (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;
  const vecs = sents.map((x) => { const v = new Map(); for (const t of x.tok) v.set(t, (v.get(t) || 0) + 1); let nn = 0; for (const [t, f] of v) { const w = (1 + Math.log(f)) * idf(t); v.set(t, w); nn += w * w; } return { v, norm: Math.sqrt(nn) || 1 }; });
  const post = new Map(); vecs.forEach(({ v }, i) => { for (const [t, w] of v) { if (!post.has(t)) post.set(t, []); post.get(t).push([i, w]); } });
  const W = sents.map(() => new Map());
  for (const [t, list] of post) {
    if (list.length < 2 || list.length > Math.max(40, N * 0.5)) continue; // a word in most sentences tells them apart from nothing
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const [i, wi] = list[a], [j, wj] = list[b], d = wi * wj / (vecs[i].norm * vecs[j].norm);
      W[i].set(j, (W[i].get(j) || 0) + d); W[j].set(i, (W[j].get(i) || 0) + d);
    }
    void t;
  }
  const out = W.map((m) => [...m.values()].reduce((s, x) => s + x, 0));
  let score = new Float64Array(N).fill(1 / Math.max(1, N));
  for (let it = 0; it < 60; it++) {
    const next = new Float64Array(N).fill(0.15 / Math.max(1, N));
    for (let j = 0; j < N; j++) { if (!out[j]) continue; for (const [i, w] of W[j]) next[i] += 0.85 * w / out[j] * score[j]; }
    let d = 0; for (let i = 0; i < N; i++) d += Math.abs(next[i] - score[i]);
    score = next; if (d < 1e-7) break;
  }
  const cos = (i, j) => { const a = vecs[i], b = vecs[j]; let d = 0; for (const [t, w] of a.v) { const u = b.v.get(t); if (u) d += w * u; } return d / (a.norm * b.norm); };
  return { score, cos, idf };
}
const INS_LENGTHS = { short: [3, 0.08], medium: [6, 0.15], long: [10, 0.3] };
function insSummaryOf(text, length = 'medium') {
  const cand = text.sents.filter((x) => x.tok.length >= 3 && x.text.length <= 600 && /\p{L}/u.test(x.text));
  if (!cand.length) return { picked: [], ranked: [], terms: [] };
  const { score, cos, idf } = insRank(cand);
  const order = cand.map((_, i) => i).sort((a, b) => score[b] - score[a] || a - b);
  const [base, frac] = INS_LENGTHS[length] || INS_LENGTHS.medium;
  const want = Math.min(cand.length, Math.max(base, Math.round(cand.length * frac)), base * 2);
  const chosen = [];
  for (const i of order) { if (chosen.length >= want) break; if (chosen.some((j) => cos(i, j) > 0.6)) continue; chosen.push(i); }
  const ranked = chosen.map((i) => ({ text: cand[i].text, n: cand[i].n, a: cand[i].a, b: cand[i].b, k: cand[i].k, score: score[i] }));
  const picked = [...ranked].sort((a, b) => a.k - b.k);
  return { picked, ranked, terms: insTerms(text, idf) };
}
// Key terms: words and two- or three-word phrases that come up often here and not in every sentence.
function insTerms(text, idf) {
  const tf = new Map(), forms = new Map(), phrases = new Map();
  const note = (key, surface) => { const f = forms.get(key) || new Map(); f.set(surface, (f.get(surface) || 0) + 1); forms.set(key, f); };
  for (const x of text.sents) {
    const ws = x.text.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) || [];
    let run = [];
    const flush = () => {
      for (let L = 2; L <= 3; L++) for (let i = 0; i + L <= run.length; i++) {
        const part = run.slice(i, i + L), key = part.map((p) => p.key).join(' ');
        phrases.set(key, (phrases.get(key) || 0) + 1); note(key, part.map((p) => p.w).join(' '));
      }
      run = [];
    };
    for (const w of ws) {
      const lw = w.toLowerCase();
      if ((text.english && INS_STOP.has(lw)) || /^\d+$/.test(lw) || lw.length < 3) { flush(); continue; }
      const key = text.english ? insStem(lw) : lw;
      tf.set(key, (tf.get(key) || 0) + 1); note(key, w);
      run.push({ key, w });
    }
    flush();
  }
  const surface = (key) => { const f = forms.get(key); let best = key, n = -1; for (const [s, c] of f) { const lo = s === s.toLowerCase() ? c + 0.5 : c; if (lo > n) { n = lo; best = s; } } return /^\p{Lu}[\p{Ll}]/u.test(best) && [...f.keys()].some((s) => s === s.toLowerCase()) ? best.toLowerCase() : best; };
  const scored = [...tf].filter(([, c]) => c >= 2).map(([k, c]) => ({ key: k, score: c * idf(k), n: c }));
  for (const [k, c] of phrases) if (c >= 2) scored.push({ key: k, score: 1.5 * c * k.split(' ').reduce((s, t) => s + idf(t), 0) / k.split(' ').length, n: c, phrase: true });
  scored.sort((a, b) => b.score - a.score);
  const out = [];
  for (const s of scored) {
    if (out.length >= 8) break;
    if (out.some((o) => (o.phrase && o.key.split(' ').includes(s.key) && o.n + 1 >= s.n) || (s.phrase && o.phrase && (o.key.includes(s.key) || s.key.includes(o.key))))) continue;
    if (s.phrase) for (let i = out.length - 1; i >= 0; i--) if (!out[i].phrase && s.key.split(' ').includes(out[i].key) && s.n + 1 >= out[i].n) out.splice(i, 1);
    out.push(s);
  }
  return out.map((s) => ({ term: surface(s.key), count: s.n }));
}
// The browser's own on-device model, only when it is ready to use now (no download is ever started from here).
// Asked once; a browser that takes long to answer is taken as having none ready.
let insModelKind;
async function insModel() {
  if (insModelKind !== undefined) return insModelKind;
  const ready = async (api) => {
    try { return !!api && typeof api.availability === 'function' && (await Promise.race([api.availability(), new Promise((r) => setTimeout(() => r('slow'), 1200))])) === 'available'; }
    catch { return false; }
  };
  insModelKind = (await ready(window.Summarizer)) ? 'summarizer' : (await ready(window.LanguageModel)) ? 'prompt' : null;
  return insModelKind;
}
async function insModelSummary(kind, text) {
  let t = text.sents.map((x) => x.text).join(' ').slice(0, 24000);
  if (kind === 'summarizer') {
    const s = await window.Summarizer.create({ type: 'tldr', format: 'plain-text', length: 'medium', sharedContext: 'A document the reader has open.' });
    try {
      if (s.inputQuota && s.measureInputUsage) for (let i = 0; i < 8 && (await s.measureInputUsage(t)) > s.inputQuota; i++) t = t.slice(0, Math.floor(t.length * 0.7));
      return await s.summarize(t);
    } finally { try { s.destroy && s.destroy(); } catch {} }
  }
  const lm = await window.LanguageModel.create();
  try { return await lm.prompt(`Summarize this document in a short paragraph. Use only what it says.\n\n${t.slice(0, 12000)}`); }
  finally { try { lm.destroy && lm.destroy(); } catch {} }
}
async function insSummaryDialog() {
  if (!has()) return;
  toast('Reading the document…');
  const text = await insText();
  if (!text.sents.length) { await insNoText(current); return; }
  const st = { length: S.insLength || 'medium', go: null };
  let sum = insSummaryOf(text, st.length);
  const model = await insModel();
  const list = () => (sum.picked.length ? `<ol class="ins-sum">${sum.picked.map((x, k) => `<li><p>${esc(x.text)}</p><button type="button" class="btn link ins-page" data-k="${k}" aria-label="Go to page ${x.n + 1}">Page ${x.n + 1}</button></li>`).join('')}</ol>` : '<p class="ins-none">No sentences long enough to pick from.</p>');
  const terms = () => (sum.terms.length ? `<h3>Key terms</h3><div class="ins-terms">${sum.terms.map((t) => `<button type="button" class="ins-term" data-term="${esc(t.term)}" title="Find “${esc(t.term)}”">${esc(t.term)}<b>${t.count}</b></button>`).join('')}</div>` : '');
  const a = await dialog('Summary', `<div class="ins-summary">
      <div class="seg ins-len" role="radiogroup" aria-label="Length">${['short', 'medium', 'long'].map((l) => `<button type="button" role="radio" data-len="${l}" aria-checked="${l === st.length}" aria-selected="${l === st.length}">${l[0].toUpperCase() + l.slice(1)}</button>`).join('')}</div>
      <div class="ins-sum-list">${list()}</div>
      <div class="ins-sum-terms">${terms()}</div>
      <p class="ins-note">${ic('info')}<span>Picked from the document's own sentences, on this device.</span></p>
      ${model ? `<div class="ins-model"><button type="button" class="btn" data-model>${ic('sparkles')}<span>Write a summary with your browser's on-device model</span></button><div class="ins-model-out" hidden></div><p class="ins-note">Written by the model built into your browser, on this device. It can get things wrong: check it against the pages.</p></div>` : ''}
    </div>`, [{ label: 'Copy', value: 'copy' }, { label: 'Close', primary: true }], (dlg) => {
    dlg.classList.add('ins-dlg');
    const draw = () => { $('.ins-sum-list', dlg).innerHTML = list(); $('.ins-sum-terms', dlg).innerHTML = terms(); bind(); };
    const bind = () => {
      $$('.ins-page', dlg).forEach((b) => { b.onclick = () => { st.go = sum.picked[+b.dataset.k]; $('[data-x]', dlg).click(); }; });
      $$('.ins-term', dlg).forEach((b) => { b.onclick = () => { st.find = b.dataset.term; $('[data-x]', dlg).click(); }; });
    };
    bind();
    $$('[data-len]', dlg).forEach((b) => { b.onclick = () => { st.length = b.dataset.len; S.insLength = st.length; saveSettings(); $$('[data-len]', dlg).forEach((x) => { const on = x === b; x.setAttribute('aria-checked', on); x.setAttribute('aria-selected', on); }); sum = insSummaryOf(text, st.length); draw(); }; });
    const mb = $('[data-model]', dlg);
    if (mb) mb.onclick = async () => {
      const out = $('.ins-model-out', dlg); mb.disabled = true; out.hidden = false; out.textContent = 'Writing…';
      try { out.textContent = await insModelSummary(model, text); st.model = out.textContent; }
      catch (e) { console.warn(e); out.textContent = 'The browser’s model could not write a summary.'; }
      finally { mb.disabled = false; }
    };
  });
  if (a === 'copy') {
    const txt = [...sum.picked.map((x) => `${x.text} (page ${x.n + 1})`), ...(sum.terms.length ? ['', 'Key terms: ' + sum.terms.map((t) => t.term).join(', ')] : []), ...(st.model ? ['', st.model] : [])].join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Summary copied'); } catch { toast('Could not copy the summary'); }
  }
  if (st.go) insShow(st.go.n, st.go.a, st.go.b);
  if (st.find) { openFind(); $('#findInput').value = st.find; runFind(st.find); }
  return sum;
}

/* --- ask the document --- */
const INS_MONTHS = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b(?:19|20)\d{2}\b/i;
const INS_AMOUNT = /[$€£¥]\s?\d|\d\s?(?:%|percent|usd|eur|gbp|dollars?|euros?|pounds?)\b|\b\d[\d,]*\.\d{2}\b/i;
// Passages of about three sentences on a page (each sentence starts one), scored with BM25.
function insPassages(text) {
  if (text.passages) return text.passages;
  const byPage = new Map(); for (const x of text.sents) { if (!byPage.has(x.n)) byPage.set(x.n, []); byPage.get(x.n).push(x); }
  const out = [];
  for (const [n, ss] of byPage) {
    if (ss.length <= 3) { out.push({ n, ss }); continue; }
    for (let i = 0; i + 3 <= ss.length; i++) out.push({ n, ss: ss.slice(i, i + 3) });
  }
  for (const p of out) { p.tok = p.ss.flatMap((x) => x.tok); p.text = p.ss.map((x) => x.text).join(' '); }
  return (text.passages = out);
}
function insAskOf(text, question, most = 5) {
  const ps = insPassages(text); if (!ps.length) return [];
  let q = insTokens(question, text.english); if (!q.length) q = insWordsOf(question);
  q = [...new Set(q)]; if (!q.length) return [];
  const N = ps.length, avg = ps.reduce((s, p) => s + p.tok.length, 0) / N || 1, df = new Map();
  for (const p of ps) for (const t of new Set(p.tok)) if (q.includes(t)) df.set(t, (df.get(t) || 0) + 1);
  const idf = (t) => Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
  const k1 = 1.2, b = 0.75, qw = question.toLowerCase();
  const kind = /^\s*when\b|\bwhat (?:date|day|time)\b|\bdeadline\b/.test(qw) ? INS_MONTHS : /\bhow (?:much|many)\b|\bcost\b|\bprice\b|\bamount\b|\btotal\b/.test(qw) ? INS_AMOUNT : null;
  const scoreOf = (tok) => { const tf = new Map(); for (const t of tok) if (q.includes(t)) tf.set(t, (tf.get(t) || 0) + 1); let s = 0; for (const [t, f] of tf) s += idf(t) * f * (k1 + 1) / (f + k1 * (1 - b + b * tok.length / avg)); return s; };
  const scored = ps.map((p) => { let s = scoreOf(p.tok); if (s > 0 && kind && kind.test(p.text)) s *= 1.25; return { p, s }; }).filter((x) => x.s > 0).sort((x, y) => y.s - x.s || x.p.ss[0].k - y.p.ss[0].k);
  const out = [];
  for (const { p, s } of scored) {
    if (out.length >= most) break;
    if (out.some((o) => o.n === p.n && o.p.ss[0].k <= p.ss[p.ss.length - 1].k && p.ss[0].k <= o.p.ss[o.p.ss.length - 1].k)) continue;
    // the sentence that matches best
    let best = p.ss[0], bs = -1;
    for (const x of p.ss) { let v = q.reduce((sum, t) => sum + (x.tok.includes(t) ? idf(t) : 0), 0); if (kind && kind.test(x.text)) v += 0.5; if (v > bs) { bs = v; best = x; } }
    out.push({ n: p.n, p, score: s, text: p.text, best: { text: best.text, a: best.a, b: best.b } });
  }
  return out.map(({ n, score, text: t, best }) => ({ n, score, text: t, best }));
}
function insAskEl() {
  let el = $('#insAsk'); if (el) return el;
  el = document.createElement('aside'); el.id = 'insAsk'; el.className = 'ins-ask'; el.hidden = true; el.setAttribute('aria-label', 'Ask the document');
  el.innerHTML = `<div class="ins-ask-head"><h2>${ic('message-circle-question')}<span>Ask the document</span></h2><button class="icon-btn" type="button" data-x title="Close" aria-label="Close">${ic('x')}</button></div>
    <form class="ins-ask-form" role="search"><input type="search" id="insQ" placeholder="For example: when is it due?" aria-label="Your question" autocomplete="off"><button class="btn primary" type="submit">Ask</button></form>
    <p class="ins-note">Shows the passages that best match your question. It looks through the text on this device; it does not write answers.</p>
    <div class="ins-results" aria-live="polite"></div>`;
  $('.workspace').appendChild(el);
  icons();
  $('[data-x]', el).onclick = () => insAskToggle(false);
  $('.ins-ask-form', el).addEventListener('submit', (e) => { e.preventDefault(); insAsk($('#insQ').value); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); insAskToggle(false); } });
  $('.ins-results', el).addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (!b) return; const r = insAskLast[+b.dataset.r]; if (r) { $$('.ins-hitem', el).forEach((x) => x.setAttribute('aria-current', x === b)); insShow(r.n, r.best.a, r.best.b); if (isPhone()) insAskToggle(false); } });
  return el;
}
let insAskLast = [];
const insAskOpen = () => !!$('#insAsk') && !$('#insAsk').hidden;
function insAskToggle(on = !insAskOpen()) {
  const el = insAskEl(); el.hidden = !on; app.classList.toggle('ins-asking', on);
  if (on) setTimeout(() => $('#insQ').focus(), 0); else { insClearHit(); viewer.focus({ preventScroll: true }); }
  if (doc && zoomFits() && !isPhone()) layoutPages(true);
  refreshRibbon();
}
async function insAsk(question) {
  const el = insAskEl(), box = $('.ins-results', el);
  question = String(question || '').trim();
  if (!question) { box.innerHTML = ''; insAskLast = []; return []; }
  box.innerHTML = '<p class="ins-none">Looking…</p>';
  const text = await insText();
  if (!text.sents.length) { box.innerHTML = `<p class="ins-none">This document has no text to look through. Recognize the text first.</p>`; return []; }
  const res = insAskOf(text, question);
  insAskLast = res;
  const mark = (r) => { const at = r.text.indexOf(r.best.text); return at < 0 ? esc(r.text) : `${esc(r.text.slice(0, at))}<mark>${esc(r.best.text)}</mark>${esc(r.text.slice(at + r.best.text.length))}`; };
  box.innerHTML = res.length ? `<ol>${res.map((r, k) => `<li><button type="button" class="ins-hitem" data-r="${k}" aria-current="false"><b>Page ${r.n + 1}</b><span>${mark(r)}</span></button></li>`).join('')}</ol>` : '<p class="ins-none">No passage matches those words. Try other words, or fewer.</p>';
  return res;
}
// Goes to a sentence on page n (letters a..b of its text) and marks it.
let insHit = null;
function insClearHit() { insHit = null; $$('.ins-hit').forEach((x) => x.remove()); }
function insHitParts(tc, a, b) {
  const { map } = findIndexOf(tc), parts = [];
  for (let k = a; k < b; k++) { const c = map[k]; if (!c) continue; const l = parts[parts.length - 1]; if (l && l[0] === c[0] && l[1] + l[2] === c[1]) l[2]++; else parts.push([c[0], c[1], 1]); }
  return parts;
}
function insPaintHit(v) {
  $$('.ins-hit', v.el).forEach((x) => x.remove());
  if (!insHit || views.indexOf(v) !== insHit.n) return [];
  const boxes = findBoxes(v, { parts: insHit.parts });
  for (const bx of boxes) { const d = document.createElement('div'); d.className = 'ins-hit'; Object.assign(d.style, { left: bx.x + 'px', top: bx.y + 'px', width: bx.w + 'px', height: bx.h + 'px' }); v.el.appendChild(d); }
  return boxes;
}
async function insShow(n, a, b) {
  const v = views[n]; if (!v) return;
  const tc = await textOf(doc.pages[n]);
  insHit = { n, parts: insHitParts(tc, a, b) };
  goPage(n, true);
  await renderView(v);
  const boxes = insPaintHit(v);
  if (boxes.length) {
    const y0 = Math.min(...boxes.map((x) => x.y)), y1 = Math.max(...boxes.map((x) => x.y + x.h));
    viewer.scrollTo({ top: Math.max(0, v.el.offsetTop + (y0 + y1) / 2 - viewer.clientHeight / 2), behavior: 'instant' });
  }
  announce(`Page ${n + 1}`);
}
FEATURE.afterRender.push((v) => { if (insHit && views.indexOf(v) === insHit.n) insPaintHit(v); });
FEATURE.onDocShown.push(() => { insClearHit(); insAskLast = []; const el = $('#insAsk'); if (el) { $('.ins-results', el).innerHTML = ''; $('#insQ').value = ''; } });
FEATURE.onDocClosed.push(() => { insClearHit(); if (insAskOpen()) insAskToggle(false); });

/* --- commands --- */
cmd('insTable', { label: 'Extract table…', rlabel: 'Extract table', icon: 'table', enabled: has, pressed: () => app.dataset.tool === 'instable', run: () => { if (app.dataset.tool === 'instable') setTool('select'); else { setTool('instable'); if (!isPhone()) toast('Drag a box around the table, or click a table'); } } });
cmd('insFind', { label: 'Find tables…', rlabel: 'Find tables', icon: 'table-properties', enabled: has, run: insFindDialog });
cmd('insSummary', { label: 'Summarize…', rlabel: 'Summarize', icon: 'text-quote', enabled: has, run: insSummaryDialog });
cmd('insAsk', { label: 'Ask the document', rlabel: 'Ask', icon: 'message-circle-question', enabled: has, pressed: insAskOpen, run: () => insAskToggle() });
ribbonAdd('export', 'Insight', ['insTable', 'insFind', 'insSummary', 'insAsk']);
menuAdd('Edit', ['insTable', 'insFind', 'insSummary', 'insAsk']);

addStyle(`
.workspace { position: relative; }
.app[data-tool="instable"] svg.marks { cursor: crosshair; }
svg.marks .ins-draft { fill: rgba(28,126,214,.1); stroke: #1C7ED6; stroke-width: 1.5; stroke-dasharray: 5 3; }
.ins-dlg { width: min(720px, calc(100vw - 24px)); max-width: none; }
.ins-tbl .ins-prev { overflow: auto; max-height: 400px; border: 1px solid var(--line); border-radius: 8px; background: var(--canvas); padding: 12px; margin: 8px 0; }
.ins-img { position: relative; margin: 0 auto; background: #fff; color-scheme: light; }
.ins-img canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.ins-rowline { position: absolute; left: 0; right: 0; height: 0; border-top: 1px dashed rgba(28,126,214,.55); pointer-events: none; }
.ins-div { position: absolute; top: -8px; bottom: -8px; width: 12px; margin-left: -6px; cursor: ew-resize; touch-action: none; z-index: 2; outline: none; }
.ins-div::before { content: ''; position: absolute; left: 5px; top: 8px; bottom: 8px; border-left: 2px solid #1C7ED6; }
.ins-div:focus-visible::before, .ins-div:hover::before { border-left-color: var(--accent); border-left-width: 3px; }
.ins-div-x { position: absolute; top: -12px; left: -4px; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--line); background: var(--surface); color: var(--ink); display: flex; align-items: center; justify-content: center; padding: 0; cursor: pointer; }
.ins-div-x svg { width: 12px; height: 12px; }
.ins-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin: 4px 0 8px; }
.ins-check { display: flex; align-items: center; gap: 8px; color: var(--ink); cursor: pointer; }
.ins-check input { accent-color: var(--brand); width: 16px; height: 16px; margin: 0; }
.ins-grid { overflow: auto; max-height: 220px; border: 1px solid var(--line); border-radius: 8px; }
.ins-grid table { border-collapse: collapse; font-size: 12.5px; width: max-content; min-width: 100%; }
.ins-grid th, .ins-grid td { border: 1px solid var(--line); padding: 4px 8px; text-align: left; vertical-align: top; color: var(--ink); }
.ins-grid th { background: var(--hover); font-weight: 600; }
.ins-note { font-size: 12px; color: var(--ink-3); display: flex; gap: 6px; align-items: flex-start; }
.ins-note svg { width: 14px; height: 14px; flex: none; margin-top: 1px; }
.ins-none { color: var(--ink-2); padding: 8px 0; }
.ins-found ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ins-found-item { display: flex; gap: 10px; align-items: flex-start; width: 100%; text-align: left; font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 10px; cursor: pointer; }
.ins-found-item:hover { background: var(--hover); }
.ins-found-item span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ins-found-item small { color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ins-summary .ins-len { margin-bottom: 8px; }
.ins-sum { margin: 0; padding: 0 0 0 20px; display: flex; flex-direction: column; gap: 8px; max-height: 340px; overflow: auto; }
.ins-sum li p { margin: 0; color: var(--ink); line-height: 1.45; }
.ins-sum .ins-page { height: auto; padding: 2px 0; font-size: 12px; }
.ins-summary h3 { font-size: 13px; margin: 14px 0 6px; color: var(--ink); }
.ins-terms { display: flex; flex-wrap: wrap; gap: 6px; }
.ins-term { font: inherit; font-size: 12.5px; color: var(--ink); background: var(--hover); border: 1px solid var(--line); border-radius: 12px; padding: 3px 10px; cursor: pointer; display: inline-flex; gap: 6px; align-items: baseline; }
.ins-term b { font-weight: 500; color: var(--ink-3); font-size: 11px; }
.ins-model { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 10px; }
.ins-model-out { margin: 8px 0; padding: 10px; border-radius: 8px; background: var(--hover); color: var(--ink); white-space: pre-wrap; line-height: 1.45; }
.ins-ask { position: relative; min-height: 0; z-index: 30; display: flex; flex-direction: column; background: var(--surface); border-left: 1px solid var(--line); box-shadow: -8px 0 24px rgba(0,0,0,.12); }
.ins-ask[hidden] { display: none; }
.app.ins-asking .workspace { grid-template-columns: 240px minmax(0, 1fr) 340px; }
.app.ins-asking[data-sidebar="off"] .workspace { grid-template-columns: 0 minmax(0, 1fr) 340px; }
.app.ins-asking .workspace > .sidebar { grid-column: 1; grid-row: 1; }
.app.ins-asking .workspace > .viewer { grid-column: 2; grid-row: 1; }
.app.ins-asking .workspace > .ins-ask { grid-column: 3; grid-row: 1; }
.ins-ask-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 10px 4px 14px; }
.ins-ask-head h2 { display: flex; align-items: center; gap: 8px; font-size: 15px; margin: 0; color: var(--ink); }
.ins-ask-form { display: flex; gap: 6px; padding: 6px 12px; }
.ins-ask-form input { flex: 1; min-width: 0; font: inherit; color: var(--ink); background: var(--chrome); border: 1px solid var(--line); border-radius: 17px; padding: 6px 12px; }
.ins-ask > .ins-note { padding: 0 14px; margin: 4px 0 6px; }
.ins-results { flex: 1; overflow: auto; padding: 0 8px 16px; }
.ins-results ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ins-results .ins-none { padding: 8px 6px; }
.ins-hitem { display: flex; flex-direction: column; gap: 4px; width: 100%; text-align: left; font: inherit; font-size: 13px; line-height: 1.45; color: var(--ink-2); background: none; border: 1px solid var(--line); border-radius: 10px; padding: 9px 10px; cursor: pointer; }
.ins-hitem:hover { background: var(--hover); }
.ins-hitem[aria-current="true"] { border-color: var(--accent); background: var(--accent-soft); }
.ins-hitem b { color: var(--ink); font-size: 12px; }
.ins-hitem mark { background: rgba(255,212,59,.45); color: var(--ink); border-radius: 2px; }
.page .ins-hit { position: absolute; background: rgba(255,212,59,.45); mix-blend-mode: multiply; border-radius: 2px; pointer-events: none; z-index: 6; box-shadow: 0 0 0 1px rgba(230,119,0,.7); }
@media (max-width: 760px), (max-height: 500px) and (pointer: coarse) {
  .app.ins-asking .workspace, .app.ins-asking[data-sidebar="off"] .workspace { grid-template-columns: 1fr; }
  .app.ins-asking .workspace > .sidebar, .app.ins-asking .workspace > .viewer, .app.ins-asking .workspace > .ins-ask { grid-column: auto; grid-row: auto; }
  .ins-ask { position: absolute; bottom: 0; right: 0; left: 0; top: auto; width: auto; height: 62%; border-left: 0; border-top: 1px solid var(--line); border-radius: 14px 14px 0 0; box-shadow: 0 -8px 24px rgba(0,0,0,.2); }
}
`);

Object.assign(TEST_HOOKS, {
  insFindOn, insFindRun, insCells, insCsv, insXlsx, insTableAt, insText, insSummaryOf, insAskOf, insAsk, insSentencesOf, insStem,
  insSummaryDialog, insShow, insLast: () => insLast, insHit: () => insHit,
  insTables: async (n, box) => { const r = await insFindOn(n, box); return r.tables.map((t) => ({ method: t.method, box: t.box, rows: insCells(t, r.words) })); },
});
