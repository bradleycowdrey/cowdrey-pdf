/* ---------------- comments: the Comment tab (text mark-up, shapes, callouts, typewriter, stamps) and the Comments panel ----------------
   Every comment is a mark in PDF coordinates, drawn on screen from the same geometry that is written into the saved
   PDF as a real annotation with its own appearance (so other apps list, select and move it as a comment):
     cmMarkup  underline / strikethrough / squiggly over selected text (QuadPoints)
     cmShape   oval, cloud (Circle / Square with a cloudy border), line, arrow (Line), polygon, polyline
     cmCallout a box of text with a leader line to a point (FreeText, callout)
     cmType    typewriter text, no box (FreeText, typewriter)
     cmStamp   a stamp (Stamp)
   The core highlight (hl, also the area highlight), box (rect) and pen (ink) marks are saved the same way, as
   Highlight, Square and Ink annotations, so every comment made here is a comment in other apps too. */
const CM_FILL_OPACITY = 0.25;
const CM_TILT = 8; // stamps lean a little, like a rubber stamp
const CM_STAMPS = [
  ['approved', 'Approved', '#2B8A3E', 'Approved'], ['notApproved', 'Not approved', '#C92A2A', 'NotApproved'],
  ['draft', 'Draft', '#1C7ED6', 'Draft'], ['final', 'Final', '#2B8A3E', 'Final'], ['confidential', 'Confidential', '#C92A2A', 'Confidential'],
  ['forComment', 'For comment', '#1C7ED6', 'ForComment'], ['received', 'Received', '#7048E8', 'Received'], ['void', 'Void', '#C92A2A', 'Void'],
];
const CM = { draft: null, stamp: null, panelToken: 0, panelTimer: null };
const cmStroke = () => (S.color === '#FFD43B' ? '#E03131' : S.color);
const cmRgb = (hex) => { const n = parseInt(String(hex || '#000000').slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const cmNum = (n) => { const r = Math.round(n * 1000) / 1000; return Object.is(r, -0) ? '0' : String(r); };
const cmToday = () => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
// A frame turned by `deg` (counter-clockwise, in PDF space): u runs right, d runs down, as you read it.
function cmFrame(x, y, deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const P = (u, d) => [x + c * u + s * d, y + s * u - c * d];
  P.local = (px, py) => [(px - x) * c + (py - y) * s, (px - x) * s - (py - y) * c];
  return P;
}
let cmMeasureCtx;
function cmMeasure(str, size, bold) {
  cmMeasureCtx ||= document.createElement('canvas').getContext('2d');
  cmMeasureCtx.font = `${bold ? 'bold ' : ''}${size}px Helvetica, Arial, sans-serif`;
  return cmMeasureCtx.measureText(str).width;
}

/* ---- geometry: paths ['M',x,y] ['L',x,y] ['C',x1,y1,x2,y2,x,y] ['Z'] and text runs, all in PDF space ---- */
const cmRectPath = (x1, y1, x2, y2) => [['M', x1, y1], ['L', x2, y1], ['L', x2, y2], ['L', x1, y2], ['Z']];
function cmEllipse(x1, y1, x2, y2) {
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2, k = 0.5523;
  return [['M', cx + rx, cy], ['C', cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry], ['C', cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy],
    ['C', cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry], ['C', cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy], ['Z']];
}
function cmCloud(x1, y1, x2, y2, w) {
  const a = Math.min(x1, x2), b = Math.min(y1, y2), c = Math.max(x1, x2), d = Math.max(y1, y2), r = 5 + w;
  const corners = [[a, b], [c, b], [c, d], [a, d]], out = [['M', a, b]];
  for (let s = 0; s < 4; s++) {
    const [px, py] = corners[s], [qx, qy] = corners[(s + 1) % 4], len = Math.hypot(qx - px, qy - py), n = Math.max(1, Math.round(len / (2 * r)));
    const ux = (qx - px) / len || 0, uy = (qy - py) / len || 0, nx = uy, ny = -ux; // outward, going round anticlockwise
    for (let k = 0; k < n; k++) {
      const sx = px + (qx - px) * k / n, sy = py + (qy - py) * k / n, ex = px + (qx - px) * (k + 1) / n, ey = py + (qy - py) * (k + 1) / n, h = len / n * 0.62;
      out.push(['C', sx + nx * h - ux * h * 0.15, sy + ny * h - uy * h * 0.15, ex + nx * h + ux * h * 0.15, ey + ny * h + uy * h * 0.15, ex, ey]);
    }
  }
  out.push(['Z']);
  return out;
}
function cmArrowHead(sx, sy, ex, ey, w) {
  const len = Math.hypot(ex - sx, ey - sy) || 1, ux = (ex - sx) / len, uy = (ey - sy) / len, s = Math.max(8, w * 4);
  return [['M', ex - ux * s - uy * s * 0.5, ey - uy * s + ux * s * 0.5], ['L', ex, ey], ['L', ex - ux * s + uy * s * 0.5, ey - uy * s - ux * s * 0.5]];
}
const cmPoly = (pts, close) => pts.map((p, k) => [k ? 'L' : 'M', p[0], p[1]]).concat(close ? [['Z']] : []);
// A quad from a text selection: [TLx, TLy, TRx, TRy, BLx, BLy, BRx, BRy] (as read on screen), in PDF space.
function cmQuadParts(q) {
  const TL = [q[0], q[1]], TR = [q[2], q[3]], BL = [q[4], q[5]], BR = [q[6], q[7]];
  const h = Math.hypot(TL[0] - BL[0], TL[1] - BL[1]) || 1, up = [(TL[0] - BL[0]) / h, (TL[1] - BL[1]) / h];
  return { TL, TR, BL, BR, h, up };
}
function cmGeom(m) {
  const g = { paths: [], texts: [] };
  const stroke = (d, color, w, extra) => g.paths.push({ d, stroke: color, w, ...extra });
  if (m.type === 'hl') { for (const r of m.rects) g.paths.push({ d: cmRectPath(r[0], r[1], r[2], r[3]), fill: m.color, fo: 0.4, mul: true }); return g; }
  if (m.type === 'ink') { stroke(cmPoly(m.pts.length > 1 ? m.pts : [m.pts[0], m.pts[0]]), m.color, m.w, { round: true }); return g; }
  if (m.type === 'rect') { g.paths.push({ d: cmRectPath(m.x1, m.y1, m.x2, m.y2), stroke: m.color, w: m.w, fill: m.fill ? m.color : null, fo: CM_FILL_OPACITY }); return g; }
  if (m.type === 'cmMarkup') {
    for (const q of m.quads) {
      const { TL, TR, BL, BR, h, up } = cmQuadParts(q), lw = Math.max(0.8, h * 0.07);
      if (m.kind === 'underline') { const o = h * 0.06; stroke([['M', BL[0] + up[0] * o, BL[1] + up[1] * o], ['L', BR[0] + up[0] * o, BR[1] + up[1] * o]], m.color, lw); }
      else if (m.kind === 'strike') { const o = h * 0.05; stroke([['M', (TL[0] + BL[0]) / 2 - up[0] * o, (TL[1] + BL[1]) / 2 - up[1] * o], ['L', (TR[0] + BR[0]) / 2 - up[0] * o, (TR[1] + BR[1]) / 2 - up[1] * o]], m.color, lw); }
      else {
        const len = Math.hypot(BR[0] - BL[0], BR[1] - BL[1]) || 1, dir = [(BR[0] - BL[0]) / len, (BR[1] - BL[1]) / len], amp = Math.max(1, h * 0.08), step = amp * 1.6;
        const d = []; let k = 0;
        for (let t = 0; t <= len + 0.01; t += step, k++) { const o = amp * (1 + (k % 2 ? 1 : -1)) + h * 0.02; d.push([k ? 'L' : 'M', BL[0] + dir[0] * Math.min(t, len) + up[0] * o, BL[1] + dir[1] * Math.min(t, len) + up[1] * o]); }
        stroke(d, m.color, Math.max(0.7, lw * 0.8), { round: true });
      }
    }
    return g;
  }
  if (m.type === 'cmShape') {
    const fill = m.fill ? m.color : null;
    if (m.kind === 'oval') g.paths.push({ d: cmEllipse(m.x1, m.y1, m.x2, m.y2), stroke: m.color, w: m.w, fill, fo: CM_FILL_OPACITY });
    else if (m.kind === 'cloud') g.paths.push({ d: cmCloud(m.x1, m.y1, m.x2, m.y2, m.w), stroke: m.color, w: m.w, fill, fo: CM_FILL_OPACITY, round: true });
    else if (m.kind === 'line' || m.kind === 'arrow') {
      const [[x1, y1], [x2, y2]] = m.pts;
      stroke([['M', x1, y1], ['L', x2, y2]], m.color, m.w, { round: true });
      if (m.kind === 'arrow') stroke(cmArrowHead(x1, y1, x2, y2, m.w), m.color, m.w, { round: true });
    } else if (m.kind === 'polygon') g.paths.push({ d: cmPoly(m.pts, true), stroke: m.color, w: m.w, fill, fo: CM_FILL_OPACITY, round: true });
    else stroke(cmPoly(m.pts), m.color, m.w, { round: true });
    return g;
  }
  if (m.type === 'cmCallout') {
    const P = cmFrame(m.x, m.y, m.rot), [tu, td] = P.local(m.tx, m.ty);
    const ku = Math.max(0, Math.min(m.bw, tu)), kd = Math.max(0, Math.min(m.bh, td));
    if (Math.hypot(tu - ku, td - kd) > 2) {
      const [kx, ky] = P(ku, kd);
      stroke([['M', kx, ky], ['L', m.tx, m.ty]], m.color, m.lw, { round: true });
      stroke(cmArrowHead(kx, ky, m.tx, m.ty, m.lw), m.color, m.lw, { round: true });
    }
    g.paths.push({ d: cmPoly([P(0, 0), P(m.bw, 0), P(m.bw, m.bh), P(0, m.bh)], true), stroke: m.color, w: m.lw, fill: '#FFFFFF', fo: 1 });
    m.text.split('\n').forEach((line, k) => { const [x, y] = P(6, 6 + m.size * (0.85 + k * 1.2)); g.texts.push({ x, y, a: m.rot, str: line, size: m.size, color: m.color }); });
    return g;
  }
  if (m.type === 'cmType') {
    const P = cmFrame(m.x, m.y, m.rot);
    m.text.split('\n').forEach((line, k) => { const [x, y] = P(0, m.size * (0.85 + k * 1.2)); g.texts.push({ x, y, a: m.rot, str: line, size: m.size, color: m.color }); });
    return g;
  }
  if (m.type === 'cmStamp') {
    const a = m.rot + (m.tilt || 0), P = cmFrame(m.x, m.y, a), w2 = m.bw / 2, h2 = m.bh / 2;
    const rr = (i, r) => { // a rounded rectangle, inset by i
      const x0 = -w2 + i, x1 = w2 - i, y0 = -h2 + i, y1 = h2 - i, k = r * 0.45;
      return [['M', ...P(x0 + r, y0)], ['L', ...P(x1 - r, y0)], ['C', ...P(x1 - k, y0), ...P(x1, y0 + k), ...P(x1, y0 + r)], ['L', ...P(x1, y1 - r)], ['C', ...P(x1, y1 - k), ...P(x1 - k, y1), ...P(x1 - r, y1)],
        ['L', ...P(x0 + r, y1)], ['C', ...P(x0 + k, y1), ...P(x0, y1 - k), ...P(x0, y1 - r)], ['L', ...P(x0, y0 + r)], ['C', ...P(x0, y0 + k), ...P(x0 + k, y0), ...P(x0 + r, y0)], ['Z']];
    };
    g.paths.push({ d: rr(0, 7), stroke: m.color, w: 2.4, fill: m.color, fo: 0.07 });
    g.paths.push({ d: rr(3.5, 4.5), stroke: m.color, w: 0.8 });
    const size = m.size || 18;
    g.texts.push({ ...cmXY(P(0, m.sub ? -1 : size * 0.36)), a, str: m.label.toUpperCase(), size, bold: true, color: m.color, mid: true });
    if (m.sub) g.texts.push({ ...cmXY(P(0, size * 0.62)), a, str: m.sub, size: 8, color: m.color, mid: true });
    return g;
  }
  return g;
}
const cmXY = ([x, y]) => ({ x, y });

/* ---- drawing on screen ---- */
function cmDraw(v, m) {
  const geo = cmGeom(m), g = svgEl('g', { class: 'mk' }), rotNow = totalRot(v);
  const pt = (x, y) => toView(v, x, y).map((n) => n.toFixed(1)).join(' ');
  const dOf = (d) => d.map((c) => c[0] === 'Z' ? 'Z' : c[0] === 'C' ? `C${pt(c[1], c[2])} ${pt(c[3], c[4])} ${pt(c[5], c[6])}` : c[0] + pt(c[1], c[2])).join('');
  if (m.type === 'cmMarkup') for (const q of m.quads) g.appendChild(svgEl('path', { d: dOf(cmPoly([[q[0], q[1]], [q[2], q[3]], [q[6], q[7]], [q[4], q[5]]], true)), fill: 'transparent' }));
  for (const p of geo.paths) {
    const at = { d: dOf(p.d), fill: p.fill || 'none', stroke: p.stroke || 'none' };
    if (p.fill) at['fill-opacity'] = p.fo ?? 1;
    if (p.stroke) { at['stroke-width'] = p.w * scale; if (p.round) { at['stroke-linecap'] = 'round'; at['stroke-linejoin'] = 'round'; } }
    if (p.mul) at.style = 'mix-blend-mode:multiply';
    g.appendChild(svgEl('path', at));
    // thin lines are easy to pick up
    if (p.stroke && !p.fill && m.type !== 'cmMarkup') g.appendChild(svgEl('path', { d: at.d, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(10, p.w * scale + 6) }));
  }
  for (const t of geo.texts) {
    const [x, y] = toView(v, t.x, t.y);
    const el = svgEl('text', { x, y, fill: t.color, 'font-size': t.size * scale, 'font-family': 'Helvetica, Arial, sans-serif', 'font-weight': t.bold ? 'bold' : 'normal', 'text-anchor': t.mid ? 'middle' : 'start', transform: `rotate(${(rotNow - t.a + 720) % 360} ${x} ${y})`, style: 'white-space:pre' });
    el.textContent = t.str || ' ';
    g.appendChild(el);
  }
  if (m.type === 'cmType' || m.type === 'cmCallout' || m.type === 'cmStamp') {
    g.addEventListener('dblclick', (e) => { if (app.dataset.tool === 'select') { e.stopPropagation(); cmEditText(v, m); } });
  }
  return g;
}
async function cmEditText(v, m) {
  if (m.type === 'cmStamp') {
    if (m.stamp !== 'custom') { toast('Pick another stamp from Stamp, or move this one'); return; }
    const t = await askText('Edit stamp', '', m.label, 'Save'); if (!t || !t.trim()) return;
    const before = snapshot(); m.label = t.trim(); m.text = m.label; Object.assign(m, cmStampSize(m.label, m.sub)); drawMarks(v); changed(before); return;
  }
  const t = await askText(m.type === 'cmCallout' ? 'Edit callout' : 'Edit text', '', m.text, 'Save', false, true);
  if (t == null || !t.trim()) return;
  const before = snapshot(); m.text = t;
  if (m.type === 'cmCallout') Object.assign(m, cmBoxSize(t, m.size));
  drawMarks(v); changed(before);
}

/* ---- saving: a real annotation with its own appearance ---- */
async function cmFonts(L, out, ctx) {
  return ctx.cmFonts || (ctx.cmFonts = { F1: await out.embedFont(L.StandardFonts.Helvetica), F2: await out.embedFont(L.StandardFonts.HelveticaBold) });
}
function cmEncode(font, str) {
  try { return font.encodeText(str).toString(); } catch {}
  return font.encodeText([...str].map((c) => { try { font.encodeText(c); return c; } catch { return '?'; } }).join('')).toString();
}
function cmAnnotInfo(m, L) {
  const { PDFHexString } = L, rgb = cmRgb(m.color);
  const bbox = (pts) => { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  const quadsOfRects = (rects) => rects.flatMap((r) => { const [a, b, c, d] = bbox([[r[0], r[1]], [r[2], r[3]]]); return [a, d, c, d, a, b, c, b]; });
  const da = (size) => PDFHexString.fromText(`/Helv ${size} Tf ${rgb.map(cmNum).join(' ')} rg`);
  switch (m.type) {
    case 'hl': return { Subtype: 'Highlight', QuadPoints: quadsOfRects(m.rects), contents: m.text || '' };
    case 'ink': return { Subtype: 'Ink', InkList: [m.pts.flat()], BS: { W: m.w, S: 'S' } };
    case 'rect': return { Subtype: 'Square', BS: { W: m.w, S: 'S' }, ...(m.fill ? { IC: rgb } : {}) };
    case 'cmMarkup': return { Subtype: { underline: 'Underline', strike: 'StrikeOut', squiggly: 'Squiggly' }[m.kind], QuadPoints: m.quads.flat(), contents: m.text || '' };
    case 'cmShape': {
      const ic = m.fill ? { IC: rgb } : {}, bs = { BS: { W: m.w, S: 'S' } };
      if (m.kind === 'oval') return { Subtype: 'Circle', ...bs, ...ic };
      if (m.kind === 'cloud') return { Subtype: 'Square', ...bs, ...ic, BE: { S: 'C', I: 1 } };
      if (m.kind === 'line' || m.kind === 'arrow') return { Subtype: 'Line', L: m.pts.flat(), ...bs, LE: ['None', m.kind === 'arrow' ? 'OpenArrow' : 'None'] };
      return { Subtype: m.kind === 'polygon' ? 'Polygon' : 'PolyLine', Vertices: m.pts.flat(), ...bs, ...ic };
    }
    case 'cmCallout': {
      const P = cmFrame(m.x, m.y, m.rot), [tu, td] = P.local(m.tx, m.ty), knee = P(Math.max(0, Math.min(m.bw, tu)), Math.max(0, Math.min(m.bh, td)));
      return { Subtype: 'FreeText', IT: 'FreeTextCallout', CL: [m.tx, m.ty, ...knee], LE: 'OpenArrow', DA: da(m.size), BS: { W: m.lw, S: 'S' }, contents: m.text };
    }
    case 'cmType': return { Subtype: 'FreeText', IT: 'FreeTextTypeWriter', DA: da(m.size), BS: { W: 0 }, contents: m.text };
    case 'cmStamp': return { Subtype: 'Stamp', Name: m.name || 'Draft', contents: m.sub ? `${m.label} ${m.sub}` : m.label };
  }
  return null;
}
async function cmSave({ L, out, p, m, ctx }) {
  const info = cmAnnotInfo(m, L); if (!info) return;
  const { PDFName, PDFHexString, PDFString } = L;
  const fonts = await cmFonts(L, out, ctx), geo = cmGeom(m);
  const ops = [], gs = {}, pts = [];
  let wMax = 0;
  const col = (hex) => cmRgb(hex).map(cmNum).join(' ');
  for (const P of geo.paths) {
    ops.push('q');
    if ((P.fill && P.fo != null && P.fo < 1) || P.mul) { const n = 'G' + Object.keys(gs).length; gs[n] = { Type: 'ExtGState', ca: P.fill ? (P.fo ?? 1) : 1, CA: 1, ...(P.mul ? { BM: 'Multiply' } : {}) }; ops.push(`/${n} gs`); }
    if (P.stroke) { ops.push(`${col(P.stroke)} RG`, `${cmNum(P.w)} w`, P.round ? '1 J 1 j' : '0 J 0 j'); wMax = Math.max(wMax, P.w); }
    if (P.fill) ops.push(`${col(P.fill)} rg`);
    for (const c of P.d) {
      if (c[0] === 'Z') { ops.push('h'); continue; }
      const xy = c.slice(1); for (let k = 0; k < xy.length; k += 2) pts.push([xy[k], xy[k + 1]]);
      ops.push(xy.map(cmNum).join(' ') + ' ' + { M: 'm', L: 'l', C: 'c' }[c[0]]);
    }
    ops.push(P.fill && P.stroke ? 'B' : P.fill ? 'f' : 'S', 'Q');
  }
  for (const t of geo.texts) {
    if (!t.str) continue;
    const font = t.bold ? fonts.F2 : fonts.F1, fname = t.bold ? 'F2' : 'F1', enc = cmEncode(font, t.str);
    let w = 0; try { w = font.widthOfTextAtSize(t.str, t.size); } catch { w = cmMeasure(t.str, t.size, t.bold); }
    const a = t.a * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const x = t.mid ? t.x - c * w / 2 : t.x, y = t.mid ? t.y - s * w / 2 : t.y;
    ops.push('BT', `/${fname} ${cmNum(t.size)} Tf`, `${col(t.color)} rg`, `${[c, s, -s, c, x, y].map(cmNum).join(' ')} Tm`, `${enc} Tj`, 'ET');
    for (const [u, d] of [[0, -t.size * 0.3], [w, -t.size * 0.3], [0, t.size], [w, t.size]]) pts.push([x + c * u - s * d, y + s * u + c * d]); // d: up from the baseline
  }
  if (!pts.length) return;
  const pad = wMax / 2 + 2;
  const rect = [Math.min(...pts.map((q) => q[0])) - pad, Math.min(...pts.map((q) => q[1])) - pad, Math.max(...pts.map((q) => q[0])) + pad, Math.max(...pts.map((q) => q[1])) + pad];
  const ap = out.context.stream(ops.join('\n'), { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: rect, Resources: { Font: { F1: fonts.F1.ref, F2: fonts.F2.ref, Helv: fonts.F1.ref }, ExtGState: gs } });
  const { Subtype, contents, ...extra } = info;
  const annot = out.context.obj({
    Type: 'Annot', Subtype, Rect: rect, F: 4, C: cmRgb(m.color), ...extra,
    AP: { N: out.context.register(ap) },
  });
  annot.set(PDFName.of('NM'), PDFString.of('cpdf-' + m.id));
  const who = cmAuthorOf(m); if (who) annot.set(PDFName.of('T'), PDFHexString.fromText(who));
  annot.set(PDFName.of('M'), PDFString.fromDate(m.at ? new Date(m.at) : new Date()));
  if (contents) annot.set(PDFName.of('Contents'), PDFHexString.fromText(contents));
  const ref = out.context.register(annot);
  let annots = p.node.lookup(PDFName.of('Annots'));
  if (!annots) { annots = out.context.obj([]); p.node.set(PDFName.of('Annots'), annots); }
  annots.push(ref);
}
const cmMoveQuads = (m, o, dx, dy) => { if (o.quads) m.quads = o.quads.map((q) => q.map((n, k) => n + (k % 2 ? dy : dx))); };
const cmMoveCallout = (m, o, dx, dy) => { m.tx = o.tx + dx; m.ty = o.ty + dy; };
for (const t of ['cmMarkup', 'cmShape', 'cmCallout', 'cmType', 'cmStamp']) FEATURE.markTypes[t] = { draw: cmDraw, save: cmSave, move: t === 'cmMarkup' ? cmMoveQuads : t === 'cmCallout' ? cmMoveCallout : undefined };
// The core highlight, box and pen marks: drawn as before, saved as Highlight, Square and Ink comments.
for (const t of ['hl', 'rect', 'ink']) FEATURE.markTypes[t] = { draw: cmDraw, save: cmSave };

/* ---- text mark-up from a selection ---- */
const CM_MARKUP = { underline: ['Underline', 'underline'], strike: ['Strikethrough', 'strikethrough'], squiggly: ['Squiggly', 'waves'] };
function cmMarkupSelection(kind) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return false;
  const text = sel.toString().replace(/\s+/g, ' ').trim();
  const byView = new Map();
  for (let r = 0; r < sel.rangeCount; r++) {
    for (const rect of sel.getRangeAt(r).getClientRects()) {
      if (rect.width < 1 || rect.height < 1) continue;
      const v = views.find((vv) => { const b = vv.el.getBoundingClientRect(); return rect.top >= b.top - 2 && rect.bottom <= b.bottom + 2 && rect.left >= b.left - 2 && rect.right <= b.right + 2; });
      if (!v) continue;
      const b = v.el.getBoundingClientRect(), P = (x, y) => toPdf(v, x - b.left, y - b.top);
      const q = [...P(rect.left, rect.top), ...P(rect.right, rect.top), ...P(rect.left, rect.bottom), ...P(rect.right, rect.bottom)];
      (byView.get(v) || byView.set(v, []).get(v)).push(q);
    }
  }
  sel.removeAllRanges();
  if (!byView.size) return false;
  const before = snapshot(), color = cmStroke();
  for (const [v, quads] of byView) { marksOf(v.entry).push({ id: uid(), type: 'cmMarkup', kind, quads, color, text }); drawMarks(v); }
  changed(before);
  return true;
}
// A selection made on the page with one of these tools is marked up when the button is let go.
const cmMarkupKind = () => { const t = app.dataset.tool || ''; return t.startsWith('cm') && CM_MARKUP[t.slice(2)] ? t.slice(2) : null; };
document.addEventListener('pointerdown', (e) => { CM.selDown = !!(e.target.closest && e.target.closest('#pages')); }, true);
document.addEventListener('pointerup', () => {
  const k = cmMarkupKind(); if (!k || !CM.selDown) return;
  CM.selDown = false; setTimeout(() => { if (cmMarkupKind() === k) cmMarkupSelection(k); }, 0);
});
for (const [kind, [label, icon]] of Object.entries(CM_MARKUP)) {
  cmd('cm_' + kind, { label, icon, enabled: has, pressed: () => app.dataset.tool === 'cm' + kind, run: () => { if (cmMarkupSelection(kind)) return; setTool('cm' + kind); toast('Select text to ' + (kind === 'strike' ? 'strike it through' : kind === 'squiggly' ? 'add a squiggly line' : 'underline it')); } });
}

/* ---- shapes dragged out on the page ---- */
function cmDrag(e, v, make, update) {
  e.preventDefault();
  const before = snapshot(), start = localPoint(e, v), m = make(...toPdf(v, ...start));
  marksOf(v.entry).push(m); drawMarks(v);
  let end = start;
  const move = (ev) => { end = localPoint(ev, v); update(m, ...toPdf(v, ...end)); drawMarks(v); };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 4) { const list = marksOf(v.entry); list.splice(list.indexOf(m), 1); drawMarks(v); return; }
    changed(before);
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
const cmBoxMark = (type, extra) => (x, y) => ({ id: uid(), type, x1: x, y1: y, x2: x, y2: y, color: cmStroke(), w: S.width, ...extra() });
const cmBoxUpdate = (m, x, y) => { m.x2 = x; m.y2 = y; };
const cmLineUpdate = (m, x, y) => { m.pts[1] = [x, y]; };
FEATURE.tools.cmarea = { down: (e, v) => cmDrag(e, v, (x, y) => ({ id: uid(), type: 'hl', area: true, rects: [[x, y, x, y]], color: S.color }), (m, x, y) => { m.rects[0][2] = x; m.rects[0][3] = y; }) };
FEATURE.tools.rect = { down: (e, v) => cmDrag(e, v, cmBoxMark('rect', () => (S.cmFill ? { fill: true } : {})), cmBoxUpdate) };
FEATURE.tools.cmoval = { down: (e, v) => cmDrag(e, v, cmBoxMark('cmShape', () => ({ kind: 'oval', fill: !!S.cmFill })), cmBoxUpdate) };
FEATURE.tools.cmcloud = { down: (e, v) => cmDrag(e, v, cmBoxMark('cmShape', () => ({ kind: 'cloud', fill: !!S.cmFill })), cmBoxUpdate) };
for (const kind of ['line', 'arrow']) FEATURE.tools['cm' + kind] = { down: (e, v) => cmDrag(e, v, (x, y) => ({ id: uid(), type: 'cmShape', kind, pts: [[x, y], [x, y]], color: cmStroke(), w: S.width }), cmLineUpdate) };

/* ---- polygon and polyline: click points, double-click (or Enter) to finish ---- */
function cmDraftDraw() {
  const d = CM.draft; if (!d) return;
  const svg = d.v.el.querySelector('svg.marks'); if (!svg) return;
  const old = svg.querySelector('.cm-draft'); if (old) old.remove();
  const pts = d.hover ? d.pts.concat([d.hover]) : d.pts;
  const g = svgEl('g', { class: 'cm-draft' });
  g.appendChild(svgEl('path', { d: pts.map((p, k) => (k ? 'L' : 'M') + toView(d.v, p[0], p[1]).map((n) => n.toFixed(1)).join(' ')).join('') + (d.kind === 'polygon' && pts.length > 2 ? 'Z' : ''), fill: d.kind === 'polygon' && S.cmFill ? d.color : 'none', 'fill-opacity': CM_FILL_OPACITY, stroke: d.color, 'stroke-width': S.width * scale, 'stroke-linejoin': 'round', 'stroke-dasharray': '5 3' }));
  for (const p of d.pts) { const [x, y] = toView(d.v, p[0], p[1]); g.appendChild(svgEl('circle', { cx: x, cy: y, r: 3, fill: 'var(--surface)', stroke: d.color, 'stroke-width': 1.5 })); }
  svg.appendChild(g);
}
function cmDraftEnd(keep) {
  const d = CM.draft; if (!d) return;
  CM.draft = null;
  const enough = d.pts.length >= (d.kind === 'polygon' ? 3 : 2);
  if (keep && enough) {
    const before = snapshot();
    marksOf(d.v.entry).push({ id: uid(), type: 'cmShape', kind: d.kind, pts: d.pts, color: d.color, w: S.width, ...(d.kind === 'polygon' ? { fill: !!S.cmFill } : {}) });
    changed(before);
  }
  if (d.v.rendered) drawMarks(d.v);
}
for (const kind of ['polygon', 'polyline']) {
  FEATURE.tools['cm' + kind] = {
    down(e, v) {
      e.preventDefault();
      const pt = toPdf(v, ...localPoint(e, v));
      if (CM.draft && CM.draft.v !== v) cmDraftEnd(true);
      if (!CM.draft) CM.draft = { v, kind, pts: [], color: cmStroke() };
      const d = CM.draft, last = d.pts[d.pts.length - 1], sp = localPoint(e, v), now = Date.now();
      // a double-click, or a double tap (touch has no click count), finishes the shape
      const again = d.lastTap && now - d.lastTap.t < 450 && Math.hypot(sp[0] - d.lastTap.p[0], sp[1] - d.lastTap.p[1]) < 12;
      d.lastTap = { t: now, p: sp };
      if (e.detail >= 2 || again) { cmDraftEnd(true); return; }
      if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) > 1) d.pts.push(pt);
      cmDraftDraw();
    },
    move(e, v) { if (!CM.draft || CM.draft.v !== v) return; CM.draft.hover = toPdf(v, ...localPoint(e, v)); cmDraftDraw(); },
  };
}
FEATURE.afterRender.push(() => cmDraftDraw());
// Choosing another tool (or Escape) finishes the shape being drawn.
new MutationObserver(() => { if (CM.draft && app.dataset.tool !== 'cm' + CM.draft.kind) cmDraftEnd(true); }).observe(app, { attributes: true, attributeFilter: ['data-tool'] });
document.addEventListener('keydown', (e) => { if (CM.draft && e.key === 'Enter' && !$('#dialog').open) { e.preventDefault(); cmDraftEnd(true); } });

/* ---- callout and typewriter ---- */
function cmBoxSize(text, size) {
  const lines = text.split('\n');
  return { bw: Math.max(30, ...lines.map((l) => cmMeasure(l, size))) + 12, bh: 12 + size * (1.2 * (lines.length - 1) + 1.1) };
}
FEATURE.tools.cmcallout = {
  down(e, v) {
    e.preventDefault();
    const start = localPoint(e, v); let end = start;
    const color = S.color === '#FFD43B' ? '#E03131' : S.color;
    const svg = v.el.querySelector('svg.marks');
    const line = svgEl('line', { class: 'cm-draft', x1: start[0], y1: start[1], x2: start[0], y2: start[1], stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': '5 3' });
    svg.appendChild(line);
    const move = (ev) => { end = localPoint(ev, v); line.setAttribute('x2', end[0]); line.setAttribute('y2', end[1]); };
    const up = async () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); line.remove();
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 10) end = [start[0] + 40, start[1] - 70];
      const text = await askText('Add a callout', 'Type the callout text. It points to where you pressed.', '', 'Add', false, true);
      if (!text || !text.trim()) return;
      const before = snapshot(), [tx, ty] = toPdf(v, ...start), size = 12, rot = totalRot(v);
      const box = cmBoxSize(text, size);
      // the box sits on the far side of where the drag ended, so the leader line meets its nearest edge
      const ox = end[0] < start[0] ? end[0] - box.bw * scale : end[0], oy = end[1] < start[1] ? end[1] - box.bh * scale : end[1];
      const [x, y] = toPdf(v, ox, oy);
      marksOf(v.entry).push({ id: uid(), type: 'cmCallout', x, y, rot, tx, ty, text, size, color, lw: Math.max(1, Math.min(S.width, 3)), ...box });
      drawMarks(v); changed(before); setTool('select');
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  },
};
FEATURE.tools.cmtype = {
  async down(e, v) {
    e.preventDefault();
    const [x, y] = toPdf(v, ...localPoint(e, v));
    const text = await askText('Typewriter', 'Type the text to place here.', '', 'Add', false, true);
    if (!text || !text.trim()) return;
    const before = snapshot();
    marksOf(v.entry).push({ id: uid(), type: 'cmType', x, y, rot: totalRot(v), text, size: 12, color: S.color === '#FFD43B' ? '#111111' : S.color });
    drawMarks(v); changed(before);
  },
};

/* ---- stamps ---- */
function cmStampSize(label, sub) {
  const size = 18;
  return { size, bw: Math.max(cmMeasure(label.toUpperCase(), size, true), sub ? cmMeasure(sub, 8) : 0) + 26, bh: sub ? 42 : 32 };
}
function cmStampHtml(label, color, sub) {
  return `<span class="cm-stamp-face" style="--cm-c:${color}">${esc(label.toUpperCase())}${sub ? `<small>${esc(sub)}</small>` : ''}</span>`;
}
async function cmPickStamp() {
  let pick = null, custom = '';
  const body = `<p>Pick a stamp, then click the page to place it.</p><div class="cm-stamps">${CM_STAMPS.map(([k, label, color]) => `<button type="button" class="cm-stamp" data-stamp="${k}" aria-label="${esc(label)}">${cmStampHtml(label, color, k === 'received' ? cmToday() : '')}</button>`).join('')}</div>
    <label class="field"><span>Custom stamp</span><input id="cmStampText" type="text" placeholder="Your text, like Paid" autocomplete="off" maxlength="40"></label>`;
  const a = await dialog('Stamp', body, [{ label: 'Cancel' }, { label: 'Use custom stamp', primary: true, value: 'custom' }], (dlg) => {
    $$('[data-stamp]', dlg).forEach((b) => b.onclick = () => { pick = b.dataset.stamp; $('[data-a="1"]', dlg).click(); });
    const inp = $('#cmStampText', dlg);
    inp.oninput = () => { custom = inp.value; };
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('[data-a="1"]', dlg).click(); } };
  });
  if (!a) return;
  if (pick) {
    const [k, label, color, name] = CM_STAMPS.find((s) => s[0] === pick);
    CM.stamp = { stamp: k, label, color, name, sub: k === 'received' ? cmToday() : '' };
  } else {
    if (!custom.trim()) { toast('Type the stamp text first'); return; }
    CM.stamp = { stamp: 'custom', label: custom.trim(), color: S.color === '#FFD43B' ? '#1C7ED6' : S.color, name: 'Custom', sub: '' };
  }
  setTool('cmstamp'); toast('Click the page to place the stamp');
}
FEATURE.tools.cmstamp = {
  down(e, v) {
    e.preventDefault();
    if (!CM.stamp) { cmPickStamp(); return; }
    const [x, y] = toPdf(v, ...localPoint(e, v)), s = CM.stamp, before = snapshot();
    marksOf(v.entry).push({ id: uid(), type: 'cmStamp', x, y, rot: totalRot(v), tilt: CM_TILT, stamp: s.stamp, label: s.label, sub: s.sub, name: s.name, color: s.color, text: s.label, ...cmStampSize(s.label, s.sub) });
    drawMarks(v); changed(before); setTool('select');
  },
};

/* ---- commands and the Comment tab ---- */
const cmTool = (id, label, icon, tool, hint) => cmd(id, { label, icon, enabled: has, pressed: () => app.dataset.tool === tool, run: () => { setTool(tool); if (hint) toast(hint); } });
cmTool('cm_area', 'Area highlight', 'scan', 'cmarea', 'Drag over the part of the page to highlight');
cmTool('cm_oval', 'Oval', 'circle', 'cmoval');
cmTool('cm_line', 'Line', 'slash', 'cmline');
cmTool('cm_arrow', 'Arrow', 'move-up-right', 'cmarrow');
cmTool('cm_polygon', 'Polygon', 'pentagon', 'cmpolygon', 'Click each corner, then double-click to finish');
cmTool('cm_polyline', 'Polyline', 'waypoints', 'cmpolyline', 'Click each point, then double-click to finish');
cmTool('cm_cloud', 'Cloud', 'cloud', 'cmcloud');
cmTool('cm_callout', 'Callout', 'message-square-quote', 'cmcallout', 'Press where the callout points, then drag to where its text goes');
cmTool('cm_typewriter', 'Typewriter', 'keyboard', 'cmtype', 'Click where the text goes');
cmd('cm_stamp', { label: 'Stamp…', icon: 'stamp', enabled: has, pressed: () => app.dataset.tool === 'cmstamp', run: cmPickStamp });
const CM_WIDTHS = [1, 2, 3, 4, 6, 8];
const cmSelected = () => { if (!selMark || !doc) return null; const m = (doc.marks[selMark.key] || []).find((x) => x.id === selMark.id); return m ? { m, entry: selMark.entry } : null; };
function cmSetWidth(w) {
  S.width = w; saveSettings();
  const s = cmSelected();
  if (s && ('w' in s.m || 'lw' in s.m) && s.m.type !== 'img') { const before = snapshot(); if ('lw' in s.m) s.m.lw = Math.min(w, 3); else s.m.w = w; redrawPage(s.entry); changed(before); }
  renderRibbon(); toast(`Line width ${w} pt`);
}
cmd('cm_width', {
  get label() { return `Width ${S.width} pt`; }, icon: 'baseline', enabled: has,
  run: () => {
    const b = $('#ribbonBody [data-cmd="cm_width"]');
    if (!b) { cmSetWidth(CM_WIDTHS[(CM_WIDTHS.indexOf(S.width) + 1) % CM_WIDTHS.length]); return; }
    openPopover(b, menuHtml(CM_WIDTHS.map((w) => 'cm_w' + w)));
  },
});
for (const w of CM_WIDTHS) cmd('cm_w' + w, { label: `${w} pt`, icon: 'minus', pressed: () => S.width === w, run: () => cmSetWidth(w) });
cmd('cm_fill', {
  label: 'Fill', icon: 'paint-bucket', enabled: has, pressed: () => !!S.cmFill,
  run: () => {
    S.cmFill = !S.cmFill; saveSettings();
    const s = cmSelected();
    if (s && (s.m.type === 'rect' || (s.m.type === 'cmShape' && /oval|cloud|polygon/.test(s.m.kind)))) { const before = snapshot(); s.m.fill = S.cmFill; redrawPage(s.entry); changed(before); }
    refreshRibbon(); toast(S.cmFill ? 'Shapes are filled' : 'Shapes are outlines');
  },
});
cmd('cm_list', { label: 'Comments list', icon: 'messages-square', enabled: has, run: () => { if (matchMedia('(max-width: 760px)').matches) toggleSidebar(true); else if (!S.sidebar) toggleSidebar(true); setSide('comments'); } });
ribbonAdd('markup', 'Text mark-up', ['cm_underline', 'cm_strike', 'cm_squiggly', 'cm_area'], 'Add');
ribbonAdd('markup', 'Shapes', ['cm_oval', 'cm_line', 'cm_arrow', 'cm_polygon', 'cm_polyline', 'cm_cloud'], 'Add');
ribbonAdd('markup', 'Text', ['cm_callout', 'cm_typewriter'], 'Add');
ribbonAdd('markup', 'Stamp', ['cm_stamp'], 'Add');
ribbonAdd('markup', 'Style', ['cm_width', 'cm_fill'], 'Edit');
ribbonAdd('markup', 'Edit', ['cm_list']);
menuAdd('Mark up', ['cm_underline', 'cm_strike', 'cm_squiggly', 'cm_area', '-', 'cm_oval', 'cm_line', 'cm_arrow', 'cm_polygon', 'cm_polyline', 'cm_cloud', '-', 'cm_callout', 'cm_typewriter', 'cm_stamp', '-', 'cm_fill', 'cm_list']);
// A colour picked while a comment is selected changes that comment's colour.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('#ribbonBody [data-color]'); if (!b) return;
  const s = cmSelected(); if (!s || !('color' in s.m)) return;
  const before = snapshot(); s.m.color = b.dataset.color; redrawPage(s.entry); changed(before);
});

/* ---- the Comments panel: every comment on every page, yours and the PDF's own ---- */
const CM_SUBTYPES = { Text: 'Note', FreeText: 'Text box', Line: 'Line', Square: 'Rectangle', Circle: 'Oval', Polygon: 'Polygon', PolyLine: 'Polyline', Highlight: 'Highlight', Underline: 'Underline', Squiggly: 'Squiggly', StrikeOut: 'Strikethrough', Stamp: 'Stamp', Caret: 'Caret', Ink: 'Drawing', FileAttachment: 'Attachment', Sound: 'Sound', Redact: 'Redaction' };
function cmDescribe(m) {
  const own = FEATURE.markTypes[m.type] && FEATURE.markTypes[m.type].listLabel;
  if (own) return { label: typeof own === 'function' ? own(m) : own, text: m.text || '' };
  switch (m.type) {
    case 'hl': return { label: m.area ? 'Area highlight' : 'Highlight', text: m.text || '' };
    case 'ink': return { label: 'Drawing', text: '' };
    case 'rect': return { label: 'Rectangle', text: '' };
    case 'text': return { label: 'Text', text: m.text };
    case 'note': return { label: 'Note', text: m.text };
    case 'cmMarkup': return { label: CM_MARKUP[m.kind][0], text: m.text || '' };
    case 'cmShape': return { label: { oval: 'Oval', cloud: 'Cloud', line: 'Line', arrow: 'Arrow', polygon: 'Polygon', polyline: 'Polyline' }[m.kind], text: '' };
    case 'cmCallout': return { label: 'Callout', text: m.text };
    case 'cmType': return { label: 'Typewriter', text: m.text };
    case 'cmStamp': return { label: 'Stamp', text: m.sub ? `${m.label} · ${m.sub}` : m.label };
  }
  return null;
}
const cmTop = (m) => {
  if (m.rects) return Math.max(...m.rects.flatMap((r) => [r[1], r[3]]));
  if (m.quads) return Math.max(...m.quads.flatMap((q) => [q[1], q[3], q[5], q[7]]));
  if (m.pts) return Math.max(...m.pts.map((p) => p[1]));
  if ('y1' in m) return Math.max(m.y1, m.y2);
  return m.y || 0;
};
async function cmPageAnnots(entry) {
  try { const page = await pageOf(entry); return await (page._cmAnnots || (page._cmAnnots = page.getAnnotations({ intent: 'display' }))); } catch { return []; }
}
async function cmItems() {
  const A = pdfjs.AnnotationType, items = [];
  for (let n = 0; n < doc.pages.length; n++) {
    const entry = doc.pages[n], own = doc.marks[pageKey(entry)] || [];
    for (const m of own) { const d = cmDescribe(m); if (d) items.push({ n, entry, m, ...d, color: m.color || (m.type === 'note' ? '#FFD43B' : '#888888'), y: cmTop(m), by: cmAuthorOf(m), at: m.at || 0 }); }
    const gone = new Set(own.filter((m) => m.type === 'ae' && m.deleted).map((m) => m.ref));
    for (const a of await cmPageAnnots(entry)) {
      if (!a.rect || !a.id || [A.WIDGET, A.LINK, A.POPUP].includes(a.annotationType) || gone.has(a.id) || (a.parentId && gone.has(a.parentId))) continue;
      const ed = own.find((m) => m.type === 'ae' && m.ref === a.id && m.contents != null);
      const text = ed ? ed.contents : (a.contentsObj && a.contentsObj.str) || (Array.isArray(a.textContent) ? a.textContent.join(' ') : '') || '';
      const c = a.color && a.color.length === 3 ? `rgb(${a.color[0]},${a.color[1]},${a.color[2]})` : '#888888';
      items.push({ n, entry, a, label: a.subtype === 'Line' && a.lineEndings && a.lineEndings.some((e) => e !== 'None') ? 'Arrow' : CM_SUBTYPES[a.subtype] || a.subtype || 'Comment', text, color: c, y: a.rect[3], by: (a.titleObj && a.titleObj.str) || '', at: cmPdfDate(a.modificationDate || a.creationDate) });
    }
  }
  items.sort((p, q) => p.n - q.n || q.y - p.y);
  return items;
}
/* ---- who wrote a comment, and when ---- */
// S.author: the name written as the author of your comments. undefined: not asked yet; '': asked, left blank.
const cmAuthorOf = (m) => m.author || S.author || '';
// A PDF date (D:YYYYMMDDHHmmSS…) as milliseconds, or 0.
function cmPdfDate(s) {
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(String(s || '')); if (!m) return 0;
  const t = Date.UTC(+m[1], (+m[2] || 1) - 1, +m[3] || 1, +m[4] || 0, +m[5] || 0, +m[6] || 0); return isFinite(t) ? t : 0;
}
const cmWhen = (t) => t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
async function cmAskName(first) {
  const name = await dialog('Your name', `<p>${first ? 'Your comments show this name as their author. You can change it in the Comments panel.' : 'Shown as the author of your new comments.'}</p><label class="field"><span>Name</span><input id="dlgInput" type="text" value="${esc(S.author || '')}" autocomplete="name" maxlength="80"></label>`,
    [{ label: first ? 'Skip' : 'Cancel' }, { label: 'Save', primary: true, input: true }]);
  if (name == null) { if (first && S.author == null) { S.author = ''; saveSettings(); } return; }
  S.author = name.trim(); saveSettings();
  // The comment that brought the question up is yours too.
  if (first && S.author && doc) for (const [key, list] of Object.entries(doc.marks)) if (key !== '__doc' && Array.isArray(list)) for (const m of list) if (m && m.at && !m.author) m.author = S.author;
  cmPanelSoon();
}
// New comments get their date, and your name once you have given it; the first one asks for the name.
const cmChanged0 = changed;
changed = function (before) {
  cmChanged0(before);
  if (!doc) return;
  let fresh = false;
  for (const [key, list] of Object.entries(doc.marks)) {
    if (key === '__doc' || !Array.isArray(list)) continue;
    for (const m of list) if (m && !m.at && m.type !== 'ae' && !m.drafting && !String(before).includes(`"id":"${m.id}"`) && cmDescribe(m)) { m.at = Date.now(); if (S.author) m.author = S.author; fresh = true; }
  }
  if (fresh && S.author == null && !CM.askingName) { CM.askingName = true; cmAskName(true).finally(() => { CM.askingName = false; }); }
};
const CM_SORTS = [['page', 'By page'], ['new', 'Newest first'], ['old', 'Oldest first']];
const CM_EVERYONE = '*everyone*';
async function cmRenderPanel() {
  const panel = $('#sidePanel');
  if (!doc) { panel.innerHTML = '<p class="empty-note">Open a PDF to see its comments.</p>'; return; }
  const token = ++CM.panelToken;
  await loadPdfjs();
  const all = await cmItems();
  if (token !== CM.panelToken || S.side !== 'comments') return;
  const types = [...new Set(all.map((it) => it.label))].sort(), authors = [...new Set(all.map((it) => it.by || ''))].sort();
  const f = CM.filter || (CM.filter = { type: '', by: CM_EVERYONE, sort: S.cmSort || 'page' });
  if (f.type && !types.includes(f.type)) f.type = '';
  if (f.by !== CM_EVERYONE && !authors.includes(f.by)) f.by = CM_EVERYONE;
  const items = all.filter((it) => (!f.type || it.label === f.type) && (f.by === CM_EVERYONE || (it.by || '') === f.by));
  // Newest or oldest first; comments without a date go last.
  if (f.sort !== 'page') items.sort((p, q) => (!p.at - !q.at) || (f.sort === 'new' ? q.at - p.at : p.at - q.at) || p.n - q.n || q.y - p.y);
  CM.items = items;
  const opt = (v, t, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(t)}</option>`;
  const you = `<div class="cm-you"><span>Your name: <b>${S.author ? esc(S.author) : 'not set'}</b></span><button type="button" class="btn" data-cm-name>${S.author ? 'Change' : 'Set name'}</button></div>`;
  const bar = all.length ? `<div class="cm-filters">
    <label><span>Type</span><select data-cm-f="type">${opt('', 'All types', !f.type)}${types.map((t) => opt(t, t, f.type === t)).join('')}</select></label>
    <label><span>Author</span><select data-cm-f="by">${opt(CM_EVERYONE, 'Everyone', f.by === CM_EVERYONE)}${authors.map((a) => opt(a, a || 'No name', f.by === a)).join('')}</select></label>
    <label><span>Sort</span><select data-cm-f="sort">${CM_SORTS.map(([v, t]) => opt(v, t, f.sort === v)).join('')}</select></label></div>` : '';
  const head = `<div class="cm-head">${items.length === all.length ? `${all.length} comment${all.length === 1 ? '' : 's'}` : `${items.length} of ${all.length} comments`}</div>`;
  panel.innerHTML = you + (!all.length
    ? '<p class="empty-note">No comments yet. Add them from the Comment tab: highlight, underline, shapes, callouts and stamps.</p>'
    : bar + head + (items.length ? `<ul class="cm-list">${items.map((it, k) => `<li class="cm-item${it.m && selMark && selMark.id === it.m.id ? ' on' : ''}"><button type="button" class="cm-go" data-cm-go="${k}"><span class="cm-dot" style="background:${esc(it.color)}"></span><span class="cm-body"><span class="cm-top"><b>${esc(it.label)}</b><span>Page ${it.n + 1}</span></span>${it.text ? `<span class="cm-snip">${esc(it.text.slice(0, 140))}</span>` : ''}${it.by || it.at ? `<span class="cm-by">${esc([it.by, cmWhen(it.at)].filter(Boolean).join(' · '))}</span>` : ''}</span></button><button type="button" class="icon-btn cm-del" data-cm-del="${k}" title="Delete comment" aria-label="Delete ${esc(it.label)} on page ${it.n + 1}">${ic('trash-2')}</button></li>`).join('')}</ul>` : '<p class="empty-note">No comments match these filters.</p>'));
  icons();
  $$('[data-cm-go]', panel).forEach((b) => b.onclick = () => cmGoTo(items[+b.dataset.cmGo]));
  $$('[data-cm-del]', panel).forEach((b) => b.onclick = () => cmDelete(items[+b.dataset.cmDel]));
  $$('[data-cm-f]', panel).forEach((el) => el.onchange = () => {
    const k = el.dataset.cmF; f[k] = el.value;
    if (k === 'sort') { S.cmSort = el.value; saveSettings(); }
    cmRenderPanel().then(() => { const again = $(`#sidePanel [data-cm-f="${k}"]`); if (again) again.focus(); });
  });
  const nb = $('[data-cm-name]', panel); if (nb) nb.onclick = () => cmAskName(false);
}
function cmGoTo(it) {
  goPage(it.n);
  if (it.m) { setTool('select'); selectMark({ key: pageKey(it.entry), id: it.m.id, entry: it.entry }); }
  if (matchMedia('(max-width: 760px)').matches) toggleSidebar(false);
}
function cmDelete(it) {
  const before = snapshot(), list = marksOf(it.entry);
  if (it.m) { const k = list.indexOf(it.m); if (k < 0) return; list.splice(k, 1); if (selMark && selMark.id === it.m.id) selMark = null; redrawPage(it.entry); changed(before); }
  else { list.push({ id: uid(), type: 'ae', ref: it.a.id, rect: it.a.rect, subtype: it.a.subtype || '', deleted: true }); changed(before); syncHiddenComments(); redrawPage(it.entry); }
  toast(`${it.label} deleted`);
}
function cmPanelSoon() { if (S.side !== 'comments') return; clearTimeout(CM.panelTimer); CM.panelTimer = setTimeout(cmRenderPanel, 120); }
// The sidebar gets a Comments tab; the panel follows every change (undo and redo too).
{
  const tabs = $('.side-tabs');
  const b = document.createElement('button');
  Object.assign(b, { type: 'button', textContent: 'Comments' }); b.setAttribute('role', 'tab'); b.dataset.side = 'comments'; b.setAttribute('aria-selected', 'false');
  b.addEventListener('click', () => setSide('comments'));
  tabs.appendChild(b);
}
const cmRenderSide0 = renderSide;
renderSide = function () { if (S.side === 'comments') return cmRenderPanel(); return cmRenderSide0(); };
const cmPersist0 = persist;
persist = function () { cmPersist0(); cmPanelSoon(); };
const cmSelectMark0 = selectMark;
selectMark = function (s) { cmSelectMark0(s); if (S.side === 'comments') $$('#sidePanel .cm-item').forEach((li, k) => { const it = CM.items && CM.items[k]; li.classList.toggle('on', !!(s && it && it.m && it.m.id === s.id)); }); };

addStyle(`
.sidebar .side-tabs { grid-template-columns: repeat(2, 1fr); } /* four tabs: two rows of two */
.app[data-tool="cmunderline"] .marks, .app[data-tool="cmstrike"] .marks, .app[data-tool="cmsquiggly"] .marks { pointer-events: none !important; }
.app[data-tool="cmtype"] .marks { cursor: text; }
.app[data-tool="cmstamp"] .marks { cursor: copy; }
.marks .cm-draft { pointer-events: none; }
.cm-head { font-size: 12px; color: var(--ink-3); padding: 4px 8px 6px; }
.cm-you { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--ink-3); padding: 2px 8px 8px; }
.cm-you b { color: var(--ink); font-weight: 600; overflow-wrap: anywhere; }
.cm-you .btn { height: 28px; padding: 0 10px; font-size: 12px; flex: none; }
.cm-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; padding: 0 8px 6px; }
.cm-filters label { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 11px; color: var(--ink-3); }
.cm-filters select { font: inherit; font-size: 12px; color: var(--ink); background: var(--chrome); border: 1px solid var(--line); border-radius: 7px; padding: 4px 6px; min-width: 0; width: 100%; height: 30px; }
.cm-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.cm-item { display: flex; align-items: flex-start; border-radius: 8px; }
.cm-item:hover { background: var(--hover); }
.cm-item.on { background: var(--accent-soft); }
.cm-go { flex: 1; min-width: 0; display: flex; gap: 8px; align-items: flex-start; border: 0; background: none; text-align: left; padding: 7px 4px 7px 8px; cursor: pointer; color: var(--ink); }
.cm-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; margin-top: 4px; box-shadow: 0 0 0 1px var(--line); }
.cm-body { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.cm-top { display: flex; gap: 6px; align-items: baseline; font-size: 13px; }
.cm-top b { font-weight: 600; }
.cm-top span { color: var(--ink-3); font-size: 12px; }
.cm-snip { font-size: 12px; color: var(--ink-2); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
.cm-by { font-size: 11px; color: var(--ink-3); }
.cm-del { width: 30px; height: 30px; margin: 4px 2px 0 0; opacity: .7; }
.cm-item:hover .cm-del, .cm-del:focus-visible { opacity: 1; }
.cm-stamps { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; margin: 8px 0 4px; }
.cm-stamp { border: 1px solid var(--line); background: #FFFFFF; border-radius: 10px; padding: 10px 6px; cursor: pointer; display: grid; place-items: center; min-height: 58px; }
.cm-stamp:hover, .cm-stamp:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.cm-stamp-face { display: inline-flex; flex-direction: column; align-items: center; color: var(--cm-c); border: 2px solid var(--cm-c); box-shadow: inset 0 0 0 2px #fff, inset 0 0 0 3px var(--cm-c); border-radius: 7px; padding: 3px 9px; font: 700 13px/1.15 Helvetica, Arial, sans-serif; letter-spacing: .02em; white-space: nowrap; transform: rotate(-${CM_TILT}deg); background: color-mix(in srgb, var(--cm-c) 7%, #fff); }
.cm-stamp-face small { font-weight: 400; font-size: 9px; }
`);
TEST_HOOKS.cmItems = async () => (await cmItems()).map((it) => [it.label, it.n + 1, it.text, !!it.m]);
TEST_HOOKS.setAuthor = (name) => { S.author = name; saveSettings(); };
