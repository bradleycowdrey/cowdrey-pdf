/* ---------------- text editing: paragraphs, formatting, text boxes, find and replace ----------------
   What this adds to the Edit PDF tool and the Text tool:
     tpara  lines of the PDF rewritten as one block: the original lines (src) are taken out of the page exactly like
            te lines (saveContentEdits is given them with no text), and the block's text is drawn again, wrapped to the
            block's width, in the PDF's own font (or the closest standard font when bold or italic is asked for and
            the font isn't, or a letter is missing), with its size, colour, underline and alignment. A line formatted
            in line mode becomes a one-line tpara (no wrapping).
     text   (the Text tool's mark) gains fam, bold, italic, underline, align and a box width (w) with wrapped lines
            (lines, their widths lw, and the block width bw). Old text marks (no fam) draw and save as before.
   "Edit as paragraphs" switches the Edit PDF tool between lines and paragraphs. "Replace text…" rewrites every line
   that has the phrase as a te mark (or the text of a tpara), all in one undo step.
   The module wraps a few core functions (onEditDown, onEditHover, openLineEditor, closeLineEditor, addText,
   editText): each wrapper calls the core one for everything it doesn't handle. */
const TXT_SWATCHES = INK_COLORS;
const TXT_FAMS = [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono'], ['page', 'Same as the page']];
const txtStdName = (fam, bold, italic) => ({ sans: 'Helvetica', serif: 'TimesRoman', mono: 'Courier' }[fam] || 'Helvetica') + (bold && italic ? (fam === 'serif' ? 'BoldItalic' : 'BoldOblique') : bold ? 'Bold' : italic ? (fam === 'serif' ? 'Italic' : 'Oblique') : '');
const txtRound = (n) => Math.round(n * 10) / 10;
const txtHexRgb = (hex) => { const n = parseInt(String(hex || '#111111').slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const txtVec = (r) => { const a = r * Math.PI / 180; return { right: [Math.cos(a), Math.sin(a)], down: [Math.sin(a), -Math.cos(a)] }; };
const txtSafe = (s) => s.replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…€]/g, '?');
const txtEditing = new Set(); // ids of marks whose editor is open (their text isn't drawn underneath)

/* ---- wrapping and measuring ---- */
// Greedy wrapping: words stay whole unless one is wider than the box. '\n' starts a new line.
function txtWrap(text, maxW, width) {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (!maxW) { out.push(para); continue; }
    let line = '';
    for (const w of para.split(/(\s+)/)) {
      if (!w) continue;
      if (/^\s+$/.test(w)) { line += w; continue; }
      const t = line + w;
      if (!line.trim() || width(t.replace(/\s+$/, '')) <= maxW + 1e-6) line = t;
      else { out.push(line.replace(/\s+$/, '')); line = w; }
      while (line.length > 1 && width(line) > maxW + 1e-6) {
        let k = line.length - 1; while (k > 1 && width(line.slice(0, k)) > maxW) k--;
        out.push(line.slice(0, k)); line = line.slice(k);
      }
    }
    out.push(line.replace(/\s+$/, ''));
  }
  return out;
}
const txtCtx = document.createElement('canvas').getContext('2d');
// Width of a string in PDF units for a tpara, measured the way teImage draws it: the page's own font (as pdf.js
// loaded it) for letters it has, the closest standard font for the rest.
function txtMeasurer(page, m) {
  const cm = page && page._cmapValue, t0 = m.src[0].tm;
  const L = cm && cm.lines.find((l) => sameOrigin(l.tm, t0));
  const loaded = m.loaded || (L ? L.fontName : null), map = !m.std && !m.ocr && !m.type3 && loaded && cm && cm.glyphs.get(loaded);
  const hsc = Math.hypot(t0[0], t0[1]) / (Math.hypot(t0[2], t0[3]) || 1);
  const own = `100px "${loaded}", ${cssFamily(m.fam)}`, fb = `${m.bold ? 'bold ' : ''}${m.italic ? 'italic ' : ''}100px ${cssFamily(m.fam)}`;
  return (s) => {
    let w = 0, run = '', kind = '';
    const flush = () => { if (run) { txtCtx.font = kind === 'own' ? own : fb; w += txtCtx.measureText(run).width; } run = ''; };
    for (const ch of s) {
      const g0 = map && map.get(ch), gl = g0 && g0.inFont ? g0 : null;
      if (gl && /^[\x00-\x1f\x7f-\x9f]$/.test(gl.fc)) { flush(); w += (gl.w || 250) / 10; continue; }
      const k = gl ? 'own' : 'fb';
      if (k !== kind) { flush(); kind = k; }
      run += gl ? gl.fc : ch;
    }
    flush();
    // The line's own spacing (relative to its size), as it is drawn and saved.
    if (m.tc || m.tw) for (const ch of s) w += ((m.tc || 0) + (ch === ' ' ? m.tw || 0 : 0)) * 100;
    return w / 100 * hsc * m.size;
  };
}
// Standard fonts' widths (for text boxes), from pdf-lib's metrics.
const txtStdFonts = new Map();
function txtStdFont(name) {
  if (!txtStdFonts.has(name)) txtStdFonts.set(name, (async () => { const L = await loadPdfLib(); const d = await L.PDFDocument.create(); return d.embedFont(L.StandardFonts[name] || L.StandardFonts.Helvetica); })());
  return txtStdFonts.get(name);
}
const txtStdWidth = (font, size) => (s) => { try { return font.widthOfTextAtSize(s, size); } catch { return font.widthOfTextAtSize(txtSafe(s), size); } };
// Lines joined into a paragraph: a line ending in a hyphen runs straight on.
const txtJoin = (strs) => strs.reduce((a, s, k) => (k === 0 ? s : /-$/.test(a) ? a + s : a + ' ' + s), '');

/* ---- tpara geometry ---- */
// The block's frame: the first original line's origin (moved by dx, dy), its directions, and the size and leading now.
function txtFrame(m) {
  const f = lineFrame(m.src[0]), k = m.size / f.size;
  return { ...f, k, lead: txtLead(m, m.size, m.spacing, f.size), o: [f.o[0] + (m.dx || 0), f.o[1] + (m.dy || 0)] };
}
// Line spacing: a multiple of single spacing (1.2 times the size), or as in the PDF (lead0): as the original's,
// and more for a larger size (never less: smaller text keeps the paragraph's line spacing, so it still matches the text around it).
const TXT_SPACINGS = [1, 1.15, 1.5, 2];
const txtLead = (m, size, spacing = m.spacing, size0 = m.size0) => (+spacing ? +spacing * 1.2 * size : m.lead0 * Math.max(1, size / size0));
const txtOrigin = (F, i, x) => [F.o[0] + F.u[0] * x - F.v[0] * i * F.lead, F.o[1] + F.u[1] * x - F.v[1] * i * F.lead];
const txtAlignK = (a) => ({ center: .5, right: 1 }[a] || 0);
function txtRelayout(page, m) {
  m.std = txtIsStd(m);
  m.lines = m.wrap ? txtWrap(m.text, m.wrap, txtMeasurer(page, m)) : m.text.split('\n');
}
/* ---- Font: the text's own font, another font the page uses, or a standard one (Helvetica, Times, Courier) ---- */
// face: '' (the text's own), 'sans' | 'serif' | 'mono' (standard), or 'f:' + the name pdf.js loaded another of the
// page's fonts as. A face from the page is written with that font where it has the letters (as the own font is).
const TXT_STD_FACES = [['sans', 'Helvetica'], ['serif', 'Times'], ['mono', 'Courier']];
const txtFontInfo = new Map(); // loaded name -> { font, codes, fam, bold, italic, ascent, descent, label }
// A font's name as people know it: no subset tag, words apart ("ABCDEF+Carlito-Bold-8659" is "Carlito Bold").
const txtFontLabel = (name) => baseName(name).replace(/[-_,+]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+\d{3,}$/, '').replace(/\s*\b(MT|PS|PSMT)$/, '').trim() || 'As in the PDF';
const txtStdFace = (face) => TXT_STD_FACES.some(([k]) => k === face);
// Drawn in a standard font: a standard face, or bold or italic asked of a font that isn't.
const txtIsStd = (m) => txtStdFace(m.face) || m.bold !== (m.loaded ? !!m.fbold : m.base.bold) || m.italic !== (m.loaded ? !!m.fitalic : m.base.italic);
function txtApplyFace(m, face = '') {
  if (!m.own0) m.own0 = { font: m.font, codes: m.codes, fam: m.fam, ocr: m.ocr, type3: m.type3, ascent: m.ascent, descent: m.descent };
  const info = /^f:/.test(face) && txtFontInfo.get(face.slice(2));
  Object.assign(m, m.own0); delete m.loaded; delete m.fbold; delete m.fitalic;
  m.face = info || txtStdFace(face) ? face : '';
  if (info) Object.assign(m, { font: info.font, codes: info.codes, fam: info.fam, ocr: false, type3: false, ascent: info.ascent, descent: info.descent, loaded: face.slice(2), fbold: info.bold, fitalic: info.italic });
  else if (txtStdFace(face)) m.fam = face;
  return m;
}
// A tpara as it would be with a format (for measuring while the editor is open).
const txtFaced = (m, f) => { const t = txtApplyFace({ ...m }, f.face); Object.assign(t, { size: f.size, bold: f.bold, italic: f.italic, spacing: f.spacing || 0 }); t.std = txtIsStd(t); return t; };
// The fonts the page's text uses (not a scan's invisible text, not drawn fonts), each once, by name.
async function txtPageFonts(v) {
  return v.page._txtFonts || (v.page._txtFonts = (async () => {
    const cm = await contentMap(v.page), out = [], names = new Set();
    for (const L of cm.lines) {
      const k = L.fontName;
      if (cm.invisible.has(k) || out.some((x) => x.loaded === k)) continue;
      const fo = await fontObj(v.page, k) || {}, name = String(fo.name || '');
      if (!name || fo.isType3Font || /glyphless/i.test(name)) continue;
      const label = txtFontLabel(name);
      if (names.has(label)) continue; names.add(label);
      const codes = {}; for (const [u, gl] of cm.glyphs.get(k) || []) if (gl.inFont && gl.code != null) codes[u] = gl.code;
      const info = { loaded: k, font: name, label, codes, fam: stdFamily(name + ' ' + L.family), bold: !!fo.bold || /bold|black|heavy|semibold|demi/i.test(name), italic: !!fo.italic || /italic|oblique/i.test(name), ascent: L.ascent, descent: L.descent };
      txtFontInfo.set(k, info); out.push(info);
    }
    return out;
  })().catch(() => []));
}
// The Font list for text in the PDF: its own font first, the page's other fonts, then the standard ones.
function txtFaceOpts(v, m) {
  const cm = v.page._cmapValue, src = m.src ? m.src[0] : m, L = cm && cm.lines.find((l) => sameOrigin(l.tm, src.tm));
  const ownName = (m.own0 || m).font, own = ownName && !/glyphless/i.test(ownName) ? txtFontLabel(ownName) : 'As in the PDF';
  return { own, base: m.base || { bold: !!m.bold, italic: !!m.italic }, fonts: txtPageFonts(v).then((list) => list.filter((x) => x.loaded !== (L && L.fontName) && x.label !== own)) };
}
const txtSrc = (t) => ({ tm: t.tm, width: t.width, ascent: t.ascent, descent: t.descent, quad: t.quad, font: t.font, bg: t.bg, ocr: !!t.ocr, orig: t.orig });
function txtNewPara(tes, wrap, lead0) {
  const t = tes[0], size = lineFrame(t).size;
  const base = { text: txtJoin(tes.map((x) => x.orig)), size, color: t.color, bold: !!t.bold, italic: !!t.italic, underline: false, align: 'left', face: '', spacing: 0 };
  // The first line's text state (outline, spacing) carries over, as it does for a single edited line.
  // Spacing only when every line has the same (a line set tighter to fit is not the paragraph's spacing).
  const st = {}; for (const k of ['tr', 'lw', 'stroke']) if (t[k] != null) st[k] = t[k];
  for (const k of ['tc', 'tw']) if (t[k] != null && tes.every((x) => x[k] === t[k])) st[k] = t[k];
  return { id: uid(), type: 'tpara', src: tes.map(txtSrc), font: t.font, fam: t.fam, codes: t.codes || {}, ocr: !!t.ocr, type3: !!t.type3, ascent: t.ascent, descent: t.descent, size0: size, lead0, wrap, base, size, color: t.color, bold: base.bold, italic: base.italic, underline: false, align: 'left', std: false, text: '', lines: [], ...st };
}
// A te mark for a line, as the Edit tool makes one (its font, colours and the letters its font has).
async function txtTeFor(v, L, cm) {
  const fo = await fontObj(v.page, L.fontName) || {};
  const name = String(fo.name || ''), { bg, fg } = sampleColors(v, L.quad);
  const codes = {}; for (const [u, gl] of cm.glyphs.get(L.fontName) || []) if (gl.inFont && gl.code != null) codes[u] = gl.code;
  const ocr = cm.invisible.has(L.fontName) || /glyphless/i.test(name);
  return { id: uid(), type: 'te', tm: L.tm, width: L.width, ascent: L.ascent, descent: L.descent, quad: L.quad, orig: L.str, text: L.str, font: name, fam: stdFamily(name + ' ' + L.family), bold: !!fo.bold || /bold|black|heavy|semibold|demi/i.test(name), italic: !!fo.italic || /italic|oblique/i.test(name) || Math.abs(L.tm[2] / (L.tm[3] || 1)) > .1, bg, color: ocr ? '#111111' : lineColor(L, fg), codes, ocr, type3: !!fo.isType3Font, ...teState(L, ocr) };
}
const txtCovered = (entry, L) => marksOf(entry).some((m) => m.type === 'tpara' && m.src.some((s) => sameOrigin(s.tm, L.tm)));
FEATURE.lineTaken = txtCovered; // a line in a rewritten paragraph is not moved by the line before it
// Lines that make a paragraph with L: same font and size, same left edge, evenly spaced, one under the other.
function txtBlock(cm, L, entry) {
  const f0 = lineFrame(L), sz = f0.size;
  const rel = (c) => { const dx = c.tm[4] - f0.o[0], dy = c.tm[5] - f0.o[1]; return { c, a: dx * f0.u[0] + dy * f0.u[1], p: dx * f0.v[0] + dy * f0.v[1] }; };
  const like = (c) => c === L || (c.fontName === L.fontName && Math.abs(lineFrame(c).size - sz) < .05 && (() => { const f = lineFrame(c); return f.u[0] * f0.u[0] + f.u[1] * f0.u[1] > .999; })() && !txtCovered(entry, c));
  const cands = cm.lines.filter(like).map(rel).filter((x) => Math.abs(x.a) < sz * .6).sort((a, b) => b.p - a.p);
  const k = cands.findIndex((x) => x.c === L), block = [cands[k]], colW = Math.max(...cands.map((x) => x.c.width));
  let lead = 0;
  const walk = (dir) => {
    let cur = k;
    for (let j = k + dir; j >= 0 && j < cands.length; j += dir) {
      const gap = Math.abs(cands[cur].p - cands[j].p);
      if (gap < sz * .5) continue;
      // Single to double spacing (body text set at 2.6 em, as in long manuals), the same all the way down.
      if (gap > sz * 3.2) break;
      if (!lead) { if (gap < sz * .9) break; lead = gap; } else if (Math.abs(gap - lead) > sz * .15) break;
      // Widely spaced lines are a paragraph only when they are full (wrapped) lines: every line but the last is
      // most of the block's width, so a list of short lines spaced apart stays separate.
      if (gap > sz * 1.9) {
        const upper = dir > 0 ? cands[cur] : cands[j];
        if (upper.c.width < colW * .6) break;
      }
      if (dir > 0) block.push(cands[j]); else block.unshift(cands[j]);
      cur = j;
    }
  };
  walk(1); walk(-1);
  const top = block[0];
  return { lines: block.map((x) => x.c), lead: lead || sz * 1.2, wrap: Math.max(...block.map((x) => x.c.width + x.a - top.a)) + .5 };
}

/* ---- tpara on screen and in the saved PDF ---- */
const txtPoly = (v, q, fill) => svgEl('polygon', { points: q.map(([x, y]) => toView(v, x, y).map((n) => n.toFixed(1)).join(',')).join(' '), fill });
FEATURE.markTypes.tpara = {
  under: true,
  draw(v, m) {
    const g = svgEl('g', { class: 'mk' });
    for (const s of m.src) g.appendChild(txtPoly(v, s.quad, s.bg));
    if (!v.page._cmapValue && !v.page._txtCm) { v.page._txtCm = 1; contentMap(v.page).then((cm) => { v.page._cmapValue = cm; redrawPage(v.entry); }).catch(() => {}); }
    if (txtEditing.has(m.id)) return g;
    const F = txtFrame(m), meas = txtMeasurer(v.page, m), ang = (() => { const [ox, oy] = toView(v, ...F.o), [ax, ay] = toView(v, F.o[0] + F.u[0], F.o[1] + F.u[1]); return Math.atan2(ay - oy, ax - ox) * 180 / Math.PI; })();
    const t0 = m.src[0].tm, k = F.k;
    // Something to click across the whole block, gaps between lines included.
    const n = Math.max(1, m.lines.length), wmax = m.wrap || Math.max(1, ...m.lines.map(meas));
    const top = [F.o[0] + F.v[0] * m.size * .9, F.o[1] + F.v[1] * m.size * .9], dn = (n - 1) * F.lead + m.size * 1.2;
    g.appendChild(txtPoly(v, [top, [top[0] + F.u[0] * wmax, top[1] + F.u[1] * wmax], [top[0] + F.u[0] * wmax - F.v[0] * dn, top[1] + F.u[1] * wmax - F.v[1] * dn], [top[0] - F.v[0] * dn, top[1] - F.v[1] * dn]], 'transparent'));
    m.lines.forEach((line, i) => {
      if (!line.trim()) return;
      const w = meas(line), x = m.wrap ? Math.max(0, m.wrap - w) * txtAlignK(m.align) : 0;
      const org = txtOrigin(F, i, x), [ox, oy] = toView(v, ...org);
      const im = teImage(v, { id: `${m.id}:${i}:${m.size}:${+m.std}${+m.bold}${+m.italic}:${m.fam}`, text: line, color: m.color, tm: [t0[0] * k, t0[1] * k, t0[2] * k, t0[3] * k, t0[4], t0[5]], fam: m.fam, bold: m.bold, italic: m.italic, ascent: m.ascent, descent: m.descent, type3: m.std || m.type3, ocr: m.ocr, loaded: m.loaded, tr: m.tr, lw: m.lw, stroke: m.stroke, tc: m.tc, tw: m.tw });
      const gl = svgEl('g', { transform: `rotate(${ang.toFixed(2)} ${ox} ${oy})` });
      gl.appendChild(svgEl('image', { x: ox, y: oy - im.asc, width: im.w, height: im.h, href: im.url }));
      if (m.underline) { const uy = oy + m.size * scale * .12; gl.appendChild(svgEl('line', { x1: ox, y1: uy, x2: ox + w * scale, y2: uy, stroke: m.color, 'stroke-width': Math.max(.75, m.size * scale * .06) })); }
      g.appendChild(gl);
    });
    return g;
  },
  move(m, o, dx, dy) { m.dx = (o.dx || 0) + dx; m.dy = (o.dy || 0) + dy; },
  async save({ L, out, p, m, ctx }) {
    // The original lines come out of the page as edited lines with no text would; the block is drawn where the
    // first of them was in the content (so reading order stays), or over the page when none was found there.
    const ops = await txtDrawPara(L, out, p, m, ctx);
    await saveContentEdits(L, out, p, m.src.map((s, i) => ({ ...s, id: m.id + ':' + i, type: 'te', text: '', codes: {}, grp: m.id, ...(i === 0 ? { emit: ops } : {}) })), ctx);
  },
};
async function txtDrawPara(L, out, p, m, ctx) {
  const { PDFNumber, PDFHexString, PDFOperator, StandardFonts, rgb } = L;
  const node = p.node, { fonts } = pageFonts(L, out, node), want = baseName(m.font);
  let f = m.std || m.ocr || m.type3 || /glyphless/i.test(want) ? null : [...fonts.values()].find((x) => baseName(x.base) === want);
  if (f) {
    const rev = new Map(f.hasToUnicode ? f.rev : []);
    if (!f.type0) for (const [u, code] of Object.entries(m.codes || {})) if (!rev.has(u) && (f.widths.get(code) || 0) > 0) rev.set(u, code);
    f = rev.size ? { ...f, rev } : null;
  }
  const stdName = txtStdName(m.fam, m.bold, m.italic);
  const std = async () => { let sf = ctx.std.get(stdName); if (!sf) { sf = await out.embedFont(StandardFonts[stdName] || StandardFonts.Helvetica); ctx.std.set(stdName, sf); } return sf; };
  const F = txtFrame(m), t0 = m.src[0].tm, hs = Math.hypot(t0[0], t0[1]) * F.k;
  const O = (name, args = []) => PDFOperator.of(name, args), N = (n) => PDFNumber.of(+(+n).toFixed(4));
  const col = txtHexRgb(m.color), all = [];
  for (let i = 0; i < m.lines.length; i++) {
    const line = m.lines[i]; if (!line.trim()) continue;
    const runs = glyphRuns(line, f && f.rev), mixed = runs.some((r) => !r.own) && runs.some((r) => r.own);
    let w = 0;
    for (const r of runs) {
      if (r.own) { r.w = r.chars.reduce((s, c) => s + (f.widths.get(c) ?? f.dw), 0) / 1000; continue; }
      const sf = await std(); r.sf = sf;
      try { r.hex = sf.encodeText(r.chars.join('')); r.w = sf.widthOfTextAtSize(r.chars.join(''), 1); } catch { const s = txtSafe(r.chars.join('')); r.hex = sf.encodeText(s); r.w = sf.widthOfTextAtSize(s, 1); }
    }
    for (const r of runs) w += (r.w + r.chars.length * (m.tc || 0)) * hs;
    const x = m.wrap ? Math.max(0, m.wrap - w) * txtAlignK(m.align) : 0, org = txtOrigin(F, i, x);
    const ops = [O('q'), ...(mixed ? [actualText(L, out, line)] : []), ...teStateOps(L, m), O('BT'), O('Tr', [N(m.tr || 0)]), O('Tc', [N(m.tc || 0)]), O('Tw', [N(m.tw || 0)]), O('Tz', [N(100)]), O('Ts', [N(0)]), O('Tm', [t0[0] * F.k, t0[1] * F.k, t0[2] * F.k, t0[3] * F.k, org[0], org[1]].map(N))];
    for (const r of runs) {
      if (r.own) ops.push(O('Tf', [f.key, N(1)]), O('Tj', [PDFHexString.of(r.chars.map((c) => c.toString(16).padStart(f.bytes * 2, '0')).join(''))]));
      else ops.push(O('Tf', [node.newFontDictionary('CPDF', r.sf.ref), N(1)]), O('Tj', [r.hex]));
    }
    ops.push(O('ET'), ...(mixed ? [O('EMC')] : []), O('Q'));
    all.push(...ops);
    if (m.underline) {
      const d = m.size * .12, s0 = [org[0] - F.v[0] * d, org[1] - F.v[1] * d];
      all.push(...L.drawLine({ start: { x: s0[0], y: s0[1] }, end: { x: s0[0] + F.u[0] * w, y: s0[1] + F.u[1] * w }, thickness: Math.max(.5, m.size * .06), color: rgb(...col) }));
    }
  }
  return all;
}

/* ---- text boxes (the Text tool) ---- */
function txtBoxLines(m) { return m.lines || String(m.text).split('\n'); }
FEATURE.markTypes.text = {
  draw(v, m) {
    const [x, y] = toView(v, m.x, m.y), ang = (totalRot(v) - m.rot + 360) % 360;
    const ax = x + (m.bw || 0) * scale * txtAlignK(m.align);
    const g = svgEl('text', { class: 'mk', x: ax, y, fill: m.color, 'font-size': m.size * scale, 'font-family': cssFamily(m.fam || 'sans'), 'font-weight': m.bold ? 'bold' : 'normal', 'font-style': m.italic ? 'italic' : 'normal', 'text-decoration': m.underline ? 'underline' : 'none', 'text-anchor': { center: 'middle', right: 'end' }[m.align] || 'start', transform: `rotate(${ang} ${x} ${y})` });
    if (txtEditing.has(m.id)) g.setAttribute('opacity', '0');
    txtBoxLines(m).forEach((line, k) => { const t = svgEl('tspan', { x: ax, dy: k ? m.size * scale * 1.2 : m.size * scale * .85 }); t.textContent = line || ' '; g.appendChild(t); });
    return g;
  },
  async save({ L, out, p, m, ctx }) {
    const { StandardFonts, degrees, rgb } = L;
    const name = txtStdName(m.fam || 'sans', m.bold, m.italic);
    let font = ctx.std.get(name); if (!font) { font = await out.embedFont(StandardFonts[name] || StandardFonts.Helvetica); ctx.std.set(name, font); }
    const { right, down } = txtVec(m.rot), color = rgb(...txtHexRgb(m.color)), width = txtStdWidth(font, m.size);
    const lines = txtBoxLines(m), bw = m.bw || 0;
    lines.forEach((line, k) => {
      if (!line) return;
      const w = width(line), off = m.size * (.85 + k * 1.2), dx = bw ? Math.max(0, bw - w) * txtAlignK(m.align) : 0;
      const x = m.x + down[0] * off + right[0] * dx, y = m.y + down[1] * off + right[1] * dx;
      try { p.drawText(line, { x, y, size: m.size, font, color, rotate: degrees(m.rot) }); }
      catch { p.drawText(txtSafe(line), { x, y, size: m.size, font, color, rotate: degrees(m.rot) }); }
      if (m.underline) { const u = m.size * .12; p.drawLine({ start: { x: x + down[0] * u, y: y + down[1] * u }, end: { x: x + down[0] * u + right[0] * w, y: y + down[1] * u + right[1] * w }, thickness: Math.max(.5, m.size * .06), color }); }
    });
  },
};
// Lines, their widths and the box width, with the standard font's own widths (so alignment in the PDF is exact).
async function txtLayoutBox(m) {
  const font = await txtStdFont(txtStdName(m.fam || 'sans', m.bold, m.italic)), width = txtStdWidth(font, m.size);
  m.lines = txtWrap(m.text, m.w || 0, width);
  m.lw = m.lines.map((s) => txtRound(width(s)));
  m.bw = m.w || Math.max(0, ...m.lw);
}
// The standard family closest to the page's main font (the one with the most letters).
async function txtPageFam(v) {
  try {
    const cm = await contentMap(v.page), n = new Map();
    for (const L of cm.lines) n.set(L.fontName, (n.get(L.fontName) || 0) + L.str.length);
    const top = [...n.entries()].sort((a, b) => b[1] - a[1])[0]; if (!top) return 'sans';
    const L = cm.lines.find((l) => l.fontName === top[0]), fo = await fontObj(v.page, top[0]) || {};
    return stdFamily(String(fo.name || '') + ' ' + L.family);
  } catch { return 'sans'; }
}
function txtBoxHit(v, x, y) {
  const list = marksOf(v.entry);
  for (let k = list.length - 1; k >= 0; k--) {
    const m = list[k]; if (m.type !== 'text') continue;
    const { right, down } = txtVec(m.rot), dx = x - m.x, dy = y - m.y, a = dx * right[0] + dy * right[1], b = dx * down[0] + dy * down[1];
    const n = txtBoxLines(m).length, bw = m.bw || Math.max(...txtBoxLines(m).map((s) => s.length)) * m.size * .55;
    if (a >= -3 && a <= bw + 3 && b >= -3 && b <= m.size * (.85 + (n - 1) * 1.2 + .35) + 3) return m;
  }
  return null;
}

/* ---- the format bar ---- */
// The swatches with a text's own colour: in place of a swatch it is close to (#000000 for #111111), else first.
function txtOwnSwatches(own) {
  const rgb = (c) => txtHexRgb(c).map((x) => x * 255), o = rgb(own);
  const near = TXT_SWATCHES.findIndex((c) => rgb(c).reduce((s, x, k) => s + Math.abs(x - o[k]), 0) < 60);
  return near >= 0 ? TXT_SWATCHES.map((c, k) => (k === near ? own : c)) : [own, ...TXT_SWATCHES.slice(0, -1)];
}
let txtBar = null, txtBarDown = false;
window.addEventListener('pointerup', () => setTimeout(() => { txtBarDown = false; }, 0), true);
window.addEventListener('pointercancel', () => { txtBarDown = false; }, true);
function txtBarEl(fmt, opts, onChange, refocus) {
  const bar = document.createElement('div');
  bar.className = 'txt-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Text format');
  // Text in a colour of its own (not one of the swatches) shows that colour first, pressed, so the bar says what it is.
  const own = /^#[0-9a-f]{6}$/i.test(fmt.color || '') && !TXT_SWATCHES.some((c) => c.toLowerCase() === fmt.color.toLowerCase()) ? fmt.color : null;
  const btn = (k, icon, label, extra = '') => `<button type="button" class="txt-b" data-tf="${k}" ${extra} title="${label}" aria-label="${label}">${ic(icon)}</button>`;
  const sel = (k, icon, label, html) => `<label class="txt-grp txt-sel" title="${label}">${ic(icon)}<select data-tf="${k}" aria-label="${label}">${html}</select></label>`;
  bar.innerHTML = [
    opts.face ? sel('face', 'type', 'Font', `<option value="">${esc(opts.face.own)}</option>${TXT_STD_FACES.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}`) : '',
    opts.family ? `<select data-tf="fam" aria-label="Font" title="Font">${TXT_FAMS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>` : '',
    `<span class="txt-grp">${btn('smaller', 'minus', 'Smaller')}<span class="txt-size" aria-live="polite" title="Size in points"></span>${btn('bigger', 'plus', 'Bigger')}</span>`,
    `<span class="txt-grp txt-colgrp"><button type="button" class="txt-b txt-colbtn" data-tf="colors" title="Colour" aria-label="Colour" aria-expanded="false"><span class="txt-dot"></span></button></span>`,
    `<span class="txt-grp txt-cols sw-row" role="group" aria-label="Colour">${swatchesHtml(own ? txtOwnSwatches(own) : TXT_SWATCHES, { now: fmt.color, attrs: (c) => `data-tf="color" data-c="${c}"` + (c === own ? ' data-own=""' : ''), pick: 'data-tf="pick"' })}</span>`,
    `<span class="txt-grp">${btn('bold', 'bold', 'Bold')}${btn('italic', 'italic', 'Italic')}${btn('underline', 'underline', 'Underline')}</span>`,
    opts.align ? `<span class="txt-grp">${btn('left', 'align-left', 'Align left')}${btn('center', 'align-center', 'Centre')}${btn('right', 'align-right', 'Align right')}</span>` : '',
    opts.spacing ? sel('spacing', 'unfold-vertical', 'Line spacing', `<option value="0">As is</option>${TXT_SPACINGS.map((n) => `<option value="${n}">${n % 1 ? n : n.toFixed(1)}</option>`).join('')}`) : '',
  ].join('');
  const sync = () => {
    $('.txt-size', bar).textContent = txtRound(fmt.size);
    $$('[data-tf="color"]', bar).forEach((b) => b.setAttribute('aria-pressed', b.dataset.c.toLowerCase() === String(fmt.color).toLowerCase()));
    $('[data-tf="pick"]', bar).value = /^#[0-9a-f]{6}$/i.test(fmt.color) ? fmt.color : '#111111';
    $('.txt-dot', bar).style.background = fmt.color;
    for (const k of ['bold', 'italic', 'underline']) $(`[data-tf="${k}"]`, bar).setAttribute('aria-pressed', !!fmt[k]);
    for (const k of ['left', 'center', 'right']) { const b = $(`[data-tf="${k}"]`, bar); if (b) b.setAttribute('aria-pressed', (fmt.align || 'left') === k); }
    const s = $('[data-tf="fam"]', bar); if (s) s.value = fmt.famPick || fmt.fam || 'sans';
    const fc = $('[data-tf="face"]', bar); if (fc) fc.value = fmt.face || '';
    const sp = $('[data-tf="spacing"]', bar); if (sp) sp.value = String(+fmt.spacing || 0);
  };
  const ownSw = $('[data-own]', bar); if (ownSw) { ownSw.title = 'Colour now'; ownSw.setAttribute('aria-label', `Colour now (${own})`); }
  // Buttons keep the focus in the text being edited.
  bar.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  bar.addEventListener('pointerdown', (e) => { txtBarDown = true; e.stopPropagation(); });
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tf]'); if (!b) return;
    e.stopPropagation();
    const k = b.dataset.tf, step = fmt.size < 12 ? .5 : 1;
    if (k === 'smaller') fmt.size = Math.max(4, txtRound(fmt.size - step));
    else if (k === 'bigger') fmt.size = Math.min(200, txtRound(fmt.size + step));
    else if (k === 'colors') { const o = bar.classList.toggle('txt-show-cols'); b.setAttribute('aria-expanded', o); refocus && refocus(); return; }
    else if (k === 'color') { fmt.color = b.dataset.c; bar.classList.remove('txt-show-cols'); $('.txt-colbtn', bar).setAttribute('aria-expanded', 'false'); }
    else if (k === 'bold' || k === 'italic' || k === 'underline') fmt[k] = !fmt[k];
    else if (k === 'left' || k === 'center' || k === 'right') fmt.align = k;
    sync(); onChange(fmt); refocus && refocus();
  });
  const pick = $('[data-tf="pick"]', bar);
  pick.addEventListener('input', () => { fmt.color = pick.value; sync(); onChange(fmt); });
  pick.addEventListener('change', () => { refocus && refocus(); });
  const fam = $('[data-tf="fam"]', bar);
  if (fam) fam.addEventListener('change', () => { fmt.famPick = fam.value; onChange(fmt); refocus && refocus(); });
  for (const k of ['face', 'spacing']) {
    const el = $(`[data-tf="${k}"]`, bar); if (!el) continue;
    el.addEventListener('change', () => {
      fmt[k] = k === 'spacing' ? +el.value : el.value;
      // A font of the page comes as it is (bold or not); back to the text's own font, its own bold and italic.
      const info = k === 'face' && (/^f:/.test(el.value) ? txtFontInfo.get(el.value.slice(2)) : !el.value && opts.face.base);
      if (info) { fmt.bold = !!info.bold; fmt.italic = !!info.italic; }
      sync(); onChange(fmt); refocus && refocus();
    });
  }
  // The page's other fonts join the Font list once they have been read (after the text's own font).
  if (opts.face) opts.face.fonts.then((list) => {
    const fc = $('[data-tf="face"]', bar); if (!fc || !list.length) return;
    fc.options[0].insertAdjacentHTML('afterend', list.map((x) => `<option value="f:${esc(x.loaded)}">${esc(x.label)}</option>`).join(''));
    fc.value = fmt.face || '';
  });
  sync();
  return bar;
}
// The bar floats over the page, above what's being edited (below it near the top of the page).
function txtShowBar(v, target, fmt, opts, onChange, refocus) {
  txtHideBar();
  const bar = txtBar = txtBarEl(fmt, opts, (f) => { onChange(f); txtPlaceBar(v, target); }, refocus);
  bar.classList.add('floating');
  txtBarKeys(bar, target, refocus);
  v.el.appendChild(bar); icons();
  txtPlaceBar(v, target);
  return bar;
}
// It never covers the line above (the text just before what is being changed): it goes in the room between the two
// when there is enough, else under what is being edited (in the room above the next line when there is enough), and
// always inside what the viewer shows (above a phone's keyboard too).
function txtPlaceBar(v, target) {
  const bar = txtBar; if (!bar || !target.isConnected) return;
  // Inside the page and inside what the viewer shows of it (a page zoomed wider than the screen): no wider than that.
  const pr = v.el.getBoundingClientRect(), er = target.getBoundingClientRect(), vr = viewer.getBoundingClientRect();
  bar.style.maxWidth = Math.max(160, Math.min(pr.right, vr.right) - Math.max(pr.left, vr.left) - 8) + 'px';
  const bw = bar.offsetWidth, bh = bar.offsetHeight, lo = Math.max(4, vr.left - pr.left + 4), hi = Math.min(pr.width, vr.right - pr.left) - bw - 4;
  const left = Math.max(lo, Math.min(er.left - pr.left, hi));
  const vv = window.visualViewport, vTop = Math.max(vr.top, vv ? vv.offsetTop : 0) + 4, vBot = Math.min(vr.bottom, vv ? vv.offsetTop + vv.height : innerHeight) - 4;
  // The nearest text above and below, in the bar's width (the lines being edited are left out).
  let prev = -Infinity, next = Infinity;
  const x0 = pr.left + left, x1 = x0 + bw;
  // (from the page's own lines when they have been read: the text layer is drawn again, later, after a zoom)
  const cm = v.page && v.page._cmapValue;
  const boxes = cm ? cm.lines.map((L) => { const pts = L.quad.map(([x, y]) => toView(v, x, y)), xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]); return { left: pr.left + Math.min(...xs), right: pr.left + Math.max(...xs), top: pr.top + Math.min(...ys), bottom: pr.top + Math.max(...ys), width: 1, height: 1 }; })
    : [...v.el.querySelectorAll('.textLayer span')].filter((sp) => sp.textContent.trim()).map((sp) => sp.getBoundingClientRect());
  for (const r of boxes) {
    if (!r.width || !r.height || r.right < x0 || r.left > x1) continue;
    const mid = (r.top + r.bottom) / 2;
    if (mid > er.top && mid < er.bottom) continue;
    if (mid <= er.top) prev = Math.max(prev, r.bottom); else next = Math.min(next, r.top);
  }
  const gap = (room) => Math.max(2, Math.min(8, (room - bh) / 2));
  const roomAbove = er.top - Math.max(prev, vTop), roomBelow = Math.min(next, vBot) - er.bottom;
  let top;
  if (roomAbove >= bh + 4) top = er.top - bh - gap(roomAbove);
  else if (roomBelow >= bh + 4) top = er.bottom + gap(roomBelow);
  else top = er.bottom + 6; // no room either side: over the next line, never the one before
  // ...unless that is out of view (a line at the bottom of the viewer): then over the line before, as the bar must
  // never cover what is being edited (a second press there selects a word). Only when neither side fits is it kept
  // in view over the text (a phone's keyboard).
  if (top + bh > vBot && er.top - bh - 6 >= vTop) top = er.top - bh - 6;
  top = Math.max(vTop, Math.min(top, vBot - bh)); // a phone: in view
  bar.style.left = left + 'px'; bar.style.top = (top - pr.top) + 'px';
}
// The keys of an editor with its bar: Tab and Shift+Tab go round the text and the bar (Escape in the bar goes back
// to the text), and Ctrl/Cmd+B, I and U press Bold, Italic and Underline, as in a word processor.
const TXT_FMT_KEYS = { b: 'bold', i: 'italic', u: 'underline' };
const txtBarStops = (bar) => $$('button, select, input:not([type="hidden"])', bar).filter((b) => !b.disabled && b.getClientRects().length);
function txtFmtKey(e, bar) {
  const k = (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && TXT_FMT_KEYS[(e.key || '').toLowerCase()];
  const b = k && $(`[data-tf="${k}"]`, bar); if (!b) return false;
  e.preventDefault(); e.stopPropagation(); b.click(); return true;
}
function txtBarKeys(bar, target, refocus) {
  const back = () => (refocus ? refocus() : target.focus({ preventScroll: true }));
  target.addEventListener('keydown', (e) => {
    if (txtBar !== bar || txtFmtKey(e, bar) || e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
    const stops = txtBarStops(bar); if (!stops.length) return;
    e.preventDefault(); e.stopPropagation(); (e.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
  });
  bar.addEventListener('keydown', (e) => {
    if (txtFmtKey(e, bar)) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); back(); return; }
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
    const stops = txtBarStops(bar), k = stops.indexOf(document.activeElement);
    if (k < 0 || (e.shiftKey ? k > 0 : k < stops.length - 1)) return; // within the bar: the browser moves along
    e.preventDefault(); e.stopPropagation(); back();
  });
}
function txtHideBar() { if (txtBar) { txtBar.remove(); txtBar = null; } }
const txtBarBusy = () => (txtBar && txtBar.contains(document.activeElement)) || txtBarDown;

/* ---- the editor for paragraphs and text boxes: a text area over the page ---- */
let txtEd = null; // { v, ta, m, fmt, done(text, fmt) }
function txtOpenEditor(v, o) {
  // o: { m, text, fmt, opts, single, place(ta, fmt), done(text, fmt) }
  txtCloseEditor(true);
  const ta = document.createElement('textarea');
  ta.className = 'txt-editor'; ta.spellcheck = false; ta.rows = 1; ta.value = o.text; ta.setAttribute('aria-label', o.label || 'Edit this text');
  if (o.single || !o.width) ta.wrap = 'off';
  if (o.placeholder) ta.placeholder = o.placeholder;
  v.el.appendChild(ta);
  const E = txtEd = { v, ta, ...o };
  txtOverNoteGone();
  txtEditing.add(o.m.id); drawMarks(v);
  const fit = () => { o.place(ta, E.fmt); ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; if (o.single || !o.width) { ta.style.width = '0'; ta.style.width = Math.max(o.minWidth || 20, ta.scrollWidth + 2) + 'px'; } if (o.after) o.after(ta, E.fmt, fit); };
  fit();
  ta.addEventListener('input', () => { fit(); txtPlaceBar(v, ta); });
  ta.addEventListener('keydown', (e) => {
    // Escape keeps, like clicking away (Undo takes it back), and the tool stays on: the page's own Escape doesn't run.
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const was = ta.value; txtCloseEditor(true); keptHint(was !== o.text); return; }
    if (e.key === 'Enter' && (o.single || e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); txtCloseEditor(true, true); return; }
    if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
  });
  ta.addEventListener('blur', () => setTimeout(() => { if (txtEd === E && !txtBarBusy() && document.activeElement !== ta) txtCloseEditor(true); }, 0));
  txtShowBar(v, ta, E.fmt, o.opts, () => { fit(); }, () => ta.focus({ preventScroll: true }));
  ta.focus({ preventScroll: true });
  // Opened by a click with Edit PDF: the caret goes where the click was (a double click selects the word). Else all.
  if (editAt) placeCaret(ta, editAt); else ta.select();
}
// done: closed with Done (Ctrl+Enter), which may ask; Escape and clicking away never do.
function txtCloseEditor(commit, done = false) {
  const E = txtEd; if (!E) return;
  const had = document.activeElement === E.ta || !!(txtBar && txtBar.contains(document.activeElement));
  txtEd = null; txtHideBar(); txtEditing.delete(E.m.id);
  if (E.cleanup) E.cleanup();
  const text = E.ta.value.replace(/\r/g, '');
  E.ta.remove();
  if (had) viewer.focus({ preventScroll: true }); // the keys go on working on the page
  if (commit) Promise.resolve(E.done(text, E.fmt, done)).catch((e) => console.warn(e)).finally(() => drawMarks(E.v));
  else drawMarks(E.v);
}
const txtFmtOf = (m) => ({ size: m.size, color: m.color, bold: !!m.bold, italic: !!m.italic, underline: !!m.underline, align: m.align || 'left', fam: m.fam || 'sans', famPick: m.famPick || m.fam || 'sans', face: m.face || '', spacing: +m.spacing || 0 });
const txtSameFmt = (a, b) => ['size', 'color', 'bold', 'italic', 'underline', 'align', 'face', 'spacing'].every((k) => String(a[k] ?? (k === 'spacing' ? 0 : '')) === String(b[k] ?? (k === 'spacing' ? 0 : '')));
const txtCss = (fam, f, px) => `${f.bold ? 'bold ' : ''}${f.italic ? 'italic ' : ''}${px}px ${cssFamily(fam)}`;

// The editor types in the page's own font (as pdf.js loaded it) unless bold or italic changes it, so it wraps as the result will.
function txtParaFont(v, m, f, px) {
  const t = txtFaced(m, f), cm = v.page._cmapValue, L = cm && cm.lines.find((l) => sameOrigin(l.tm, m.src[0].tm)), name = t.loaded || (L && L.fontName);
  const own = name && !t.std && !t.ocr && !t.type3 && document.fonts.check(`${px}px "${name}"`);
  return own ? `${px}px "${name}", ${cssFamily(t.fam)}` : txtCss(t.fam, f, px);
}
// How a paragraph's text fits the room its original lines had, at a format: { n (lines), over (runs past the last
// original line) }. A paragraph never grows downwards silently: the editor warns, and committing asks.
function txtParaFit(page, m, text, f) {
  if (!m.wrap) return { n: 1, over: false };
  const t = txtFaced(m, f);
  const n = txtWrap(text, m.wrap, txtMeasurer(page, t)).length, lead = txtLead(m, f.size, f.spacing);
  return { n, over: (n - 1) * lead > (m.src.length - 1) * m.lead0 + .5 };
}
// The largest size, in half points down to 70% of the original size, at which it fits. null when none does.
function txtParaFitSize(page, m, text, f) {
  const min = Math.max(4, m.size0 * .7);
  for (let s = Math.min(f.size, Math.floor(f.size * 2) / 2); s >= min - 1e-6; s -= .5) if (!txtParaFit(page, m, text, { ...f, size: s }).over) return txtRound(s);
  return null;
}
const TXT_LONGER = 'This paragraph is now longer than the space it had';
// A paragraph (tpara) in the editor. isNew: the block isn't a mark yet; absorb: te marks it replaces.
// draft: { text, fmt } to carry on editing from (after "Keep editing").
function txtEditPara(v, m, isNew, absorb = [], draft = null) {
  const fmt = draft ? { ...draft.fmt } : txtFmtOf(m);
  let note = null;
  txtOpenEditor(v, {
    m, text: draft ? draft.text : m.text, fmt,
    after(ta, f, refit) {
      const fit = txtParaFit(v.page, m, ta.value.replace(/\r/g, ''), f);
      ta.classList.toggle('txt-over-ed', fit.over);
      if (!fit.over) { if (note) { note.remove(); note = null; } return; }
      if (!note) {
        note = document.createElement('div'); note.className = 'txt-over'; note.setAttribute('role', 'status');
        note.innerHTML = `<span>${TXT_LONGER}.</span><button type="button" class="btn" data-shrink>Shrink to fit</button>`;
        note.addEventListener('mousedown', (e) => e.preventDefault()); // the text keeps the focus
        note.addEventListener('pointerdown', (e) => e.stopPropagation());
        $('[data-shrink]', note).onclick = (e) => {
          e.stopPropagation();
          const s = txtParaFitSize(v.page, m, ta.value.replace(/\r/g, ''), f);
          if (s == null) { toast('Even at 70% of its size it would not fit. Shorten the text, or let it run.'); return; }
          f.size = s; if (txtBar) { const z = $('.txt-size', txtBar); if (z) z.textContent = txtRound(s); }
          refit(); txtPlaceBar(v, ta);
        };
        v.el.appendChild(note);
      }
      // Under the text, or under the format bar when the bar sits below it (near the top of the page).
      const place = () => { if (!note) return; const below = txtBar && txtBar.isConnected && txtBar.offsetTop > ta.offsetTop; note.style.left = Math.max(4, Math.min(ta.offsetLeft, v.el.clientWidth - note.offsetWidth - 4)) + 'px'; note.style.top = (below ? txtBar.offsetTop + txtBar.offsetHeight : ta.offsetTop + ta.offsetHeight) + 8 + 'px'; };
      place(); requestAnimationFrame(place);
    },
    cleanup() { if (note) { note.remove(); note = null; } }, single: !m.wrap, width: !!m.wrap, minWidth: (m.wrap || m.src[0].width) * scale, label: m.wrap ? 'Edit this paragraph' : 'Edit this line',
    opts: { align: !!m.wrap, spacing: !!m.wrap, face: txtFaceOpts(v, m) },
    place(ta, f) {
      const F = txtFrame({ ...m, size: f.size, spacing: f.spacing || 0 }), px = f.size * scale, lh = F.lead * scale;
      const [ox, oy] = toView(v, ...F.o), [ax, ay] = toView(v, F.o[0] + F.u[0], F.o[1] + F.u[1]), ang = Math.atan2(ay - oy, ax - ox) * 180 / Math.PI;
      const base = (m.wrap ? lh : px * 1.25) / 2 + .35 * px;
      Object.assign(ta.style, { left: ox + 'px', top: (oy - base) + 'px', font: txtParaFont(v, m, f, px), lineHeight: (m.wrap ? lh : px * 1.25) + 'px', color: f.color, background: m.src[0].bg, textDecoration: f.underline ? 'underline' : 'none', textAlign: f.align || 'left', transformOrigin: `0 ${base}px`, transform: `rotate(${ang}deg)` });
      if (m.wrap) ta.style.width = (m.wrap * scale + 3) + 'px';
    },
    async done(text, f, asked) {
      const list = marksOf(v.entry);
      const back = text === m.base.text && txtSameFmt(f, m.base) && !m.dx && !m.dy;
      if (isNew ? back && !absorb.length : text === m.text && txtSameFmt(f, m)) return;
      const fit = back ? { over: false } : txtParaFit(v.page, m, text, f);
      // Asked once per paragraph: after "Let it run", it isn't asked again (the editor still warns).
      // Done asks; Escape or a click away keeps it as typed and says so, with Shrink to fit and Undo at hand.
      let quiet = null;
      if (fit.over && !m.runOver && !asked) quiet = { s: txtParaFitSize(v.page, m, text, f), more: fit.n - m.src.length };
      else if (fit.over && !m.runOver) {
        const s = txtParaFitSize(v.page, m, text, f);
        const a = await dialog(TXT_LONGER, `<p>It now takes ${fit.n} lines; it had ${m.src.length}. Kept like this, it runs over what is below it on the page.</p>${s == null ? '<p>It does not fit even at 70% of its size. Shorten the text, or let it run.</p>' : `<p>Shrink to fit makes the text ${s} pt (it is ${txtRound(f.size)} pt).</p>`}`,
          [{ label: 'Keep editing', value: 'edit' }, { label: 'Let it run', value: 'run' }, ...(s == null ? [] : [{ label: 'Shrink to fit', value: 'shrink', primary: true }])]);
        if (a === 'shrink') { f = { ...f, size: s }; fit.over = false; }
        else if (a !== 'run') { txtEditPara(v, m, isNew, absorb, { text, fmt: f }); return; }
      }
      const before = snapshot();
      for (const t of absorb) { const k = list.indexOf(t); if (k >= 0) list.splice(k, 1); }
      if (back) { const k = list.indexOf(m); if (k >= 0) list.splice(k, 1); }
      else {
        Object.assign(m, { text, size: f.size, color: f.color, bold: f.bold, italic: f.italic, underline: f.underline, align: f.align || 'left', spacing: +f.spacing || 0, runOver: !!fit.over });
        txtApplyFace(m, f.face); txtRelayout(v.page, m);
        if (isNew) list.push(m);
      }
      changed(before);
      if (quiet) txtOverNote(v, m, quiet);
    },
  });
}
// After a paragraph was kept longer than its space (Escape): a note under it, with Shrink to fit and Undo. It goes
// after a while, or when something else is edited.
function txtOverNote(v, m, { s, more }) {
  txtOverNoteGone();
  const note = document.createElement('div'); note.className = 'txt-over txt-over-kept'; note.setAttribute('role', 'status');
  note.innerHTML = `<span>Paragraph is ${more === 1 ? '1 line' : more + ' lines'} longer than before.</span>${s == null ? '' : '<button type="button" class="btn" data-shrink>Shrink to fit</button>'}<button type="button" class="btn" data-undo>Undo</button>`;
  note.addEventListener('pointerdown', (e) => e.stopPropagation());
  note.timer = setTimeout(txtOverNoteGone, 12000);
  const sh = $('[data-shrink]', note);
  if (sh) sh.onclick = () => { txtOverNoteGone(); const before = snapshot(); Object.assign(m, { size: s, runOver: false }); txtRelayout(v.page, m); changed(before); drawMarks(v); };
  $('[data-undo]', note).onclick = () => { txtOverNoteGone(); run('undo'); };
  const F = txtFrame(m), [x, y] = toView(v, ...txtOrigin(F, Math.max(0, m.lines.length - 1), 0));
  note.style.left = Math.max(4, Math.min(x, v.el.clientWidth - 320)) + 'px'; note.style.top = (y + m.size * scale * .5 + 8) + 'px';
  v.el.appendChild(note);
}
function txtOverNoteGone() { for (const n of $$('.txt-over-kept')) { clearTimeout(n.timer); n.parentNode && n.parentNode.removeChild(n); } }
// Starts editing the paragraph around line L (para mode). Returns false when L is a line on its own.
async function txtStartPara(v, L) {
  const cm = await contentMap(v.page); v.page._cmapValue = cm;
  const B = txtBlock(cm, L, v.entry);
  if (B.lines.length < 2) return false;
  const own = marksOf(v.entry), absorb = [], tes = [];
  for (const l of B.lines) {
    const te = own.find((m) => m.type === 'te' && sameOrigin(m.tm, l.tm));
    if (te) absorb.push(te);
    tes.push(te || await txtTeFor(v, l, cm));
  }
  const m = txtNewPara(tes, B.wrap, B.lead);
  // The block is as wide as its widest line measured the way it is drawn again (kerning and spacing make that a
  // little wider than in the PDF at times), so each line that fitted still fits and only real overflow re-wraps.
  const meas = txtMeasurer(v.page, m), f0 = lineFrame(m.src[0]);
  const left = (s) => (s.tm[4] - f0.o[0]) * f0.u[0] + (s.tm[5] - f0.o[1]) * f0.u[1];
  m.wrap = Math.max(m.wrap, ...m.src.map((s) => left(s) + meas(s.orig))) + Math.max(1, f0.size * .1);
  m.text = txtJoin(tes.map((t) => t.text));
  txtRelayout(v.page, m);
  txtEditPara(v, m, true, absorb);
  return true;
}
// Where a text box's editor sits: over the box, in its format.
const txtBoxPlace = (v, m) => (ta, f) => {
  const [x, y] = toView(v, m.x, m.y), px = f.size * scale, ang = (totalRot(v) - m.rot + 360) % 360, shift = px * .1;
  Object.assign(ta.style, { left: x + 'px', top: (y - shift) + 'px', font: txtCss(f.famPick === 'page' ? m.fam : f.famPick || m.fam || 'sans', f, px), lineHeight: px * 1.2 + 'px', color: f.color, background: 'rgba(255,255,255,.92)', textDecoration: f.underline ? 'underline' : 'none', textAlign: f.align || 'left', transformOrigin: `0 ${shift}px`, transform: `rotate(${ang}deg)` });
  if (m.w) ta.style.width = (m.w * scale + 3) + 'px';
};
// A text box in the editor.
function txtEditBox(v, m) {
  if (txtEd && txtEd.m.id === m.id) return;
  const fmt = txtFmtOf(m);
  txtOpenEditor(v, {
    m, text: m.text, fmt, width: !!m.w, minWidth: 40, label: 'Edit this text', opts: { family: true, align: true },
    place: txtBoxPlace(v, m),
    async done(text, f) {
      const fam = f.famPick === 'page' ? (m.famPick === 'page' ? m.fam : await txtPageFam(v)) : f.famPick;
      if (text === m.text && txtSameFmt(f, m) && fam === (m.fam || 'sans')) return;
      const before = snapshot(), list = marksOf(v.entry);
      if (!text.trim()) { list.splice(list.indexOf(m), 1); changed(before); toast('Text removed'); return; }
      Object.assign(m, { text, size: f.size, color: f.color, bold: f.bold, italic: f.italic, underline: f.underline, align: f.align || 'left', fam, famPick: f.famPick });
      await txtLayoutBox(m);
      changed(before);
    },
  });
}

/* ---- wrapping the core: the Edit tool, its line editor, the Text tool ---- */
// Line mode: the core's line editor, with the format bar. A formatted line becomes a one-line tpara.
let txtLine = null; // { le, base, fmt }
const txtCoreOpenLine = openLineEditor;
openLineEditor = function (v, m, isNew) {
  txtCoreOpenLine(v, m, isNew);
  const le = lineEditor; if (!le || le.m !== m) return;
  const base = { size: lineFrame(m).size, color: m.color, bold: !!m.bold, italic: !!m.italic, underline: false, align: 'left', face: '', spacing: 0 };
  txtLine = { le, base, fmt: { ...base } };
  txtShowBar(v, le.ed, txtLine.fmt, { align: false, face: txtFaceOpts(v, m) }, (f) => {
    const px = f.size * scale, asc = Math.max(m.ascent, .9) * px, desc = Math.max(-m.descent, .3) * px, [, oy] = toView(v, m.tm[4], m.tm[5]);
    // Another font: the page's (as pdf.js loaded it, unless bold or italic is asked of it), or a standard one.
    const info = /^f:/.test(f.face) && txtFontInfo.get(f.face.slice(2)), fam = info ? info.fam : f.face;
    const font = !f.face ? lineFont(v, m, px, f.bold, f.italic) : info && f.bold === info.bold && f.italic === info.italic ? `${px}px "${info.loaded}", ${cssFamily(fam)}` : txtCss(fam, f, px);
    Object.assign(le.ed.style, { font, color: f.color, textDecoration: f.underline ? 'underline' : 'none', top: (oy - asc) + 'px', height: (asc + desc) + 'px', lineHeight: (asc + desc) + 'px', transformOrigin: `0 ${asc}px` });
  }, () => le.ed.focus({ preventScroll: true }));
};
const txtCoreCloseLine = closeLineEditor;
closeLineEditor = function (commit) {
  if (txtEd) txtCloseEditor(commit);
  const le = lineEditor, T = txtLine && txtLine.le === le ? txtLine : null;
  if (le && commit && txtBarBusy() && document.activeElement !== le.ed && T) return; // the format bar is in use
  // Focus in the editor or its bar goes back to the page when they close, never to the start of the window.
  const had = le && (document.activeElement === le.ed || (txtBar && txtBar.contains(document.activeElement)));
  if (had && document.activeElement !== le.ed) le.ed.focus({ preventScroll: true });
  txtLine = null; txtHideBar();
  if (!le || !commit || !T || txtSameFmt(T.fmt, T.base)) return txtCoreCloseLine(commit);
  lineEditor = null; editingIds.delete(le.m.id);
  const text = le.ed.textContent.replace(/[\r\n]+/g, ' ');
  le.ed.remove(); if (had) viewer.focus({ preventScroll: true }); phoneZoomBack();
  const before = snapshot(), list = marksOf(le.v.entry);
  if (!le.isNew) { const k = list.indexOf(le.m); if (k >= 0) list.splice(k, 1); }
  const m = txtNewPara([le.m], 0, T.base.size * 1.2);
  Object.assign(m, { text, size: T.fmt.size, color: T.fmt.color, bold: T.fmt.bold, italic: T.fmt.italic, underline: T.fmt.underline });
  txtApplyFace(m, T.fmt.face); txtRelayout(le.v.page, m);
  list.push(m);
  drawMarks(le.v); changed(before);
};
let txtSoloHinted = false;
const txtCoreEditDown = onEditDown;
onEditDown = async function (e, v) {
  e.preventDefault();
  if (txtBar && txtBar.contains(document.activeElement)) document.activeElement.blur();
  txtBarDown = false;
  const own = e.target.closest && e.target.closest('.mk');
  const om = own && marksOf(v.entry).find((m) => m.id === own.dataset.id);
  if (om && om.type === 'tpara') { closeLineEditor(true); selectContent(null); return txtEditPara(v, om, false); }
  if (S.txtPara && (!om || om.type === 'te')) {
    closeLineEditor(true);
    const [x, y] = toPdf(v, ...localPoint(e, v));
    const cm = await contentMap(v.page);
    const L = om ? cm.lines.find((l) => sameOrigin(l.tm, om.tm)) : cm.lines.find((l) => inQuad(l.quad, x, y));
    if (L && !txtCovered(v.entry, L)) {
      selectContent(null); if (await txtStartPara(v, L)) return;
      if (!txtSoloHinted) { txtSoloHinted = true; toast('This line is not part of a paragraph, so it is edited on its own.'); }
    }
  }
  return txtCoreEditDown(e, v);
};
// Paragraph mode: hovering outlines the whole paragraph.
const txtCoreHover = onEditHover;
onEditHover = function (e, v) {
  if (txtEd) return;
  if (!S.txtPara || app.dataset.tool !== 'edit' || lineEditor) return txtCoreHover(e, v);
  const t = Date.now(); if (t - (v._txtHover || 0) < 60) return; v._txtHover = t;
  const [x, y] = toPdf(v, ...localPoint(e, v));
  contentMap(v.page).then((cm) => {
    const svg = v.el.querySelector('svg.marks'); if (!svg) return;
    svg.querySelectorAll('.content-hover').forEach((n) => n.remove());
    const L = cm.lines.find((l) => inQuad(l.quad, x, y));
    if (!L || txtCovered(v.entry, L)) return txtCoreHover(e, v);
    svg.style.cursor = 'text';
    for (const l of txtBlock(cm, L, v.entry).lines) svg.appendChild(svgEl('polygon', { class: 'content-hover', points: l.quad.map(([qx, qy]) => toView(v, qx, qy).join(',')).join(' ') }));
  });
};
// Add text: click for text that fits, or drag across to make a box the text wraps in.
const txtLast = () => Object.assign({ size: 14, color: S.color === '#FFD43B' ? '#111111' : S.color, bold: false, italic: false, underline: false, align: 'left', famPick: 'sans' }, S.txtFmt || {});
addText = function (v, x, y) {
  if (txtEd) { txtCloseEditor(true); return; } // a click away from the text being typed keeps it; the next click adds more
  const hit = txtBoxHit(v, x, y);
  if (hit) { selectMark(null); return txtEditBox(v, hit); }
  const start = toView(v, x, y), svg = v.el.querySelector('svg.marks');
  let guide = null;
  const move = (ev) => {
    const [px] = localPoint(ev, v);
    if (!guide && Math.abs(px - start[0]) > 12 && svg) { guide = svgEl('rect', { class: 'txt-guide', height: 14 * scale * 1.2, y: start[1] }); svg.appendChild(guide); }
    if (guide) { guide.setAttribute('x', Math.min(px, start[0])); guide.setAttribute('width', Math.abs(px - start[0])); }
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    if (guide) guide.remove();
    let boxW = 0;
    const [px, py] = localPoint(ev, v);
    if (Math.hypot(px - start[0], py - start[1]) > 12) {
      const [x2, y2] = toPdf(v, px, py), { right } = txtVec(totalRot(v));
      const w = (x2 - x) * right[0] + (y2 - y) * right[1];
      if (w < 0) { x += w * right[0]; y += w * right[1]; }
      boxW = Math.round(Math.abs(w));
    }
    txtAddInline(v, x, y, boxW);
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
};
// Add text types straight onto the page, in the editor text boxes use, with its format bar. Escape, Enter with Ctrl
// (⌘) or a click away keeps the text and leaves the Text tool on; a box left empty adds nothing.
function txtAddInline(v, x, y, boxW) {
  const fmt = txtLast();
  const m = { id: uid(), type: 'text', x, y, text: '', size: fmt.size, color: fmt.color, rot: totalRot(v), fam: 'sans', famPick: fmt.famPick, bold: fmt.bold, italic: fmt.italic, underline: fmt.underline, align: fmt.align, w: boxW || 0 };
  txtOpenEditor(v, {
    m, text: '', fmt, width: !!m.w, minWidth: 90, label: 'Add text', placeholder: 'Type here', opts: { family: true, align: true },
    place: txtBoxPlace(v, m),
    async done(text, f) {
      S.txtFmt = { size: f.size, color: f.color, bold: f.bold, italic: f.italic, underline: f.underline, align: f.align, famPick: f.famPick }; saveSettings();
      if (!text.trim()) return;
      const fam = f.famPick === 'page' ? await txtPageFam(v) : f.famPick;
      Object.assign(m, { text, size: f.size, color: f.color, bold: f.bold, italic: f.italic, underline: f.underline, align: f.align || 'left', fam, famPick: f.famPick });
      await txtLayoutBox(m);
      const before = snapshot();
      marksOf(v.entry).push(m);
      drawMarks(v); changed(before);
    },
  });
}
TEST_HOOKS.txtEditing = () => !!txtEd;
// Double-click a text box (Select or Edit PDF) to edit it in place. Two presses are watched here: the first press
// redraws the marks and starts a move (which cancels the browser's own mouse events), so no dblclick arrives.
let txtLastDown = null;
document.addEventListener('pointerdown', (e) => {
  if (!doc || !['select', 'edit'].includes(app.dataset.tool) || txtEd || (e.target.closest && e.target.closest('.txt-bar, .txt-editor, dialog'))) { txtLastDown = null; return; }
  const v = views.find((x) => { if (!x.rendered) return false; const r = x.el.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; });
  const m = v && txtBoxHit(v, ...toPdf(v, ...localPoint(e, v))), now = Date.now();
  if (m && txtLastDown && txtLastDown.id === m.id && now - txtLastDown.t < 500) { txtLastDown = null; setTimeout(() => { closeLineEditor(true); txtEditBox(v, m); }, 0); return; }
  txtLastDown = m ? { id: m.id, t: now } : null;
}, true);
// After the pointer's own focus change (a double-click), or the editor would lose the focus at once.
editText = function (v, m) { setTimeout(() => txtEditBox(v, m), 0); };

/* ---- find and replace ---- */
// A view to read a page with: the one on screen, or the page drawn off screen (for its colours).
async function txtViewOf(entry) {
  const v = views.find((x) => x.entry === entry && x.rendered && x.el.querySelector('canvas.pdf'));
  if (v) return v;
  const page = await pageOf(entry), viewport = page.getViewport({ scale: 1.5, rotation: (page.rotate + entry.rot) % 360 });
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  try { await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise; } catch (e) { console.warn(e); }
  return { el: { querySelector: () => canvas }, viewport, page, entry };
}
function txtPattern(q, o) {
  const s = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flags = 'gu' + (o.matchCase ? '' : 'i');
  if (!o.whole) return new RegExp(s, flags);
  try { return new RegExp(`(?<![\\p{L}\\p{N}_])${s}(?![\\p{L}\\p{N}_])`, flags); } catch { return new RegExp(`\\b${s}\\b`, flags); } // older Safari: no look-behind
}
// Everything with text on a page, top to bottom: lines (as they read now) and paragraphs.
async function txtItems(entry) {
  const page = await pageOf(entry), cm = await contentMap(page); page._cmapValue = cm;
  const own = marksOf(entry), items = [];
  for (const L of cm.lines) {
    if (txtCovered(entry, L)) continue;
    const te = own.find((m) => m.type === 'te' && sameOrigin(m.tm, L.tm));
    items.push({ kind: 'line', L, te, text: te ? te.text : L.str, y: -L.tm[5], x: L.tm[4] });
  }
  for (const m of own) if (m.type === 'tpara') items.push({ kind: 'para', m, text: m.text, y: -m.src[0].tm[5], x: m.src[0].tm[4] });
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  return { page, cm, items };
}
// Replaces in one item (from character `from`, `limit` times at most). Returns how many were replaced.
async function txtReplaceItem(entry, it, cm, re, rep, from = 0, limit = Infinity) {
  let n = 0;
  re.lastIndex = 0;
  const text = it.text.replace(re, (s, off) => { if (off < from || n >= limit) return s; n++; return rep; });
  if (!n) return 0;
  const list = marksOf(entry);
  if (it.kind === 'para') { it.m.text = text; txtRelayout(await pageOf(entry), it.m); return n; }
  // A run moved along by an earlier replacement on its line is already a mark: that one changes.
  it.te ||= list.find((m) => m.type === 'te' && sameOrigin(m.tm, it.L.tm));
  const v = await txtViewOf(entry);
  let te = it.te;
  if (te) te.text = text;
  else { te = await txtTeFor(v, it.L, cm); te.text = text; list.push(te); it.te = te; }
  // The line keeps its alignment (a centred title stays centred, on the page), and what follows it moves along.
  v.page._cmapValue ||= cm;
  const f = teFollowers(v, te); await f.ready;
  teAlign(v, te, f);
  if (te.text === te.orig && !te.dx && list.includes(te)) list.splice(list.indexOf(te), 1);
  return n;
}
const txtRS = { q: '', with: '', matchCase: false, whole: false, at: null };
async function txtReplaceAll(q, rep, o) {
  if (!q) return 0;
  const re = txtPattern(q, o), before = snapshot(), seen = new Set();
  let n = 0;
  for (const entry of doc.pages) {
    if (seen.has(pageKey(entry))) continue; seen.add(pageKey(entry));
    const { cm, items } = await txtItems(entry);
    for (const it of items) { re.lastIndex = 0; if (re.test(it.text)) { re.lastIndex = 0; n += await txtReplaceItem(entry, it, cm, re, rep); } }
  }
  if (n) { changed(before); views.forEach((v) => v.rendered && drawMarks(v)); }
  return n;
}
// Replaces the next match after the last one replaced (from the page in view the first time).
async function txtReplaceNext(q, rep, o) {
  if (!q) return 0;
  const re = txtPattern(q, o), N = doc.pages.length, at = txtRS.at || { n: current, k: 0, c: 0 };
  for (let s = 0; s <= N; s++) {
    const n = (at.n + s) % N, entry = doc.pages[n], { cm, items } = await txtItems(entry);
    for (let k = s === 0 ? at.k : 0; k < items.length; k++) {
      const it = items[k], from = s === 0 && k === at.k ? at.c : 0;
      re.lastIndex = 0; const hit = re.exec(it.text.slice(from)); if (!hit) continue;
      const before = snapshot();
      await txtReplaceItem(entry, it, cm, txtPattern(q, o), rep, from, 1);
      changed(before); redrawPage(entry);
      txtRS.at = { n, k, c: from + hit.index + rep.length };
      if (n !== current) goPage(n);
      return 1;
    }
  }
  txtRS.at = null;
  return 0;
}
async function txtReplaceDialog() {
  if (!has()) return;
  closeLineEditor(true);
  const sel = String(window.getSelection() || '').trim();
  if (sel && sel.length < 80 && !sel.includes('\n')) txtRS.q = sel;
  txtRS.at = null;
  await dialog('Replace text', `<label class="field"><span>Find</span><input id="txtFind" type="text" autocomplete="off" value="${esc(txtRS.q)}"></label><label class="field"><span>Replace with</span><input id="txtWith" type="text" autocomplete="off" value="${esc(txtRS.with)}"></label><div class="txt-checks"><label><input type="checkbox" id="txtCase"${txtRS.matchCase ? ' checked' : ''}> Match case</label><label><input type="checkbox" id="txtWhole"${txtRS.whole ? ' checked' : ''}> Whole words only</label></div><p class="txt-status" id="txtStatus" role="status" aria-live="polite"></p>`,
    [{ label: 'Close' }, { label: 'Replace', value: 'one' }, { label: 'Replace all', value: 'all', primary: true }], (dlg) => {
      const read = () => { txtRS.q = $('#txtFind', dlg).value; txtRS.with = $('#txtWith', dlg).value; txtRS.matchCase = $('#txtCase', dlg).checked; txtRS.whole = $('#txtWhole', dlg).checked; };
      const status = (s) => { $('#txtStatus', dlg).textContent = s; };
      let busy = false;
      const go = async (all) => {
        if (busy) return; read();
        if (!txtRS.q) { status('Type the words to find.'); $('#txtFind', dlg).focus(); return; }
        busy = true;
        try {
          if (all) { const n = await txtReplaceAll(txtRS.q, txtRS.with, txtRS); txtRS.at = null; const msg = n ? `${n} replaced` : 'Nothing found to replace'; status(msg); toast(msg); }
          else { const n = await txtReplaceNext(txtRS.q, txtRS.with, txtRS); status(n ? '1 replaced' : 'No more found'); }
        } catch (e) { console.warn(e); status('That could not be replaced.'); }
        busy = false;
      };
      ['#txtFind', '#txtWith', '#txtCase', '#txtWhole'].forEach((s) => $(s, dlg).addEventListener('input', () => { txtRS.at = null; }));
      ['#txtFind', '#txtWith'].forEach((s) => $(s, dlg).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(e.metaKey || e.ctrlKey); } }));
      // Replace and Replace all keep the dialog open, to see how many were replaced and to go on.
      dlg.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (!b || b.dataset.a === '0') return; e.stopPropagation(); go(b.dataset.a === '2'); }, { capture: true, signal: (txtRS.ac = new AbortController()).signal });
      setTimeout(() => { const f = $('#txtFind', dlg); f.focus(); f.select(); }, 0);
    });
  if (txtRS.ac) txtRS.ac.abort();
}

/* ---- commands, ribbon, keys, styles ---- */
const TXT_REPLACE_KEY = isMac ? 'Mod-Alt-f' : 'Mod-h';
cmd('txtParaMode', { label: 'Edit as paragraphs', icon: 'pilcrow', enabled: has, pressed: () => !!S.txtPara, run: () => {
  S.txtPara = !S.txtPara; saveSettings();
  if (app.dataset.tool !== 'edit') setTool('edit'); else refreshRibbon();
  toast(S.txtPara ? 'Click a paragraph to edit it as one block' : 'Click a line to edit it');
} });
cmd('txtReplace', { label: 'Replace text…', icon: 'replace', key: TXT_REPLACE_KEY, enabled: has, run: txtReplaceDialog });
ribbonAdd('edit', 'Edit the PDF', ['txtParaMode', 'txtReplace']);
{ const em = MENUS.find(([t]) => t === 'Edit'), i = em ? em[1].indexOf('find') : -1; if (i >= 0) em[1].splice(i + 1, 0, 'txtReplace'); else menuAdd('Edit', ['txtReplace']); }
{ const em = MENUS.find(([t]) => t === 'Edit'), i = em ? em[1].indexOf('tool_erase') : -1; if (i >= 0) em[1].splice(i + 1, 0, 'txtParaMode'); else menuAdd('Edit', ['txtParaMode']); }
setTimeout(() => { try { ACCEL['Mod-Alt-f'] = 'CmdOrCtrl+Alt+F'; ACCEL['Mod-h'] = 'CmdOrCtrl+H'; scheduleMacMenu(); } catch {} }, 0);
document.addEventListener('keydown', (e) => {
  if ($('#dialog').open || !(isMac ? e.metaKey : e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if ((k === 'h' && !e.shiftKey && !e.altKey) || ((k === 'f' || e.code === 'KeyF') && e.altKey && !e.shiftKey)) { e.preventDefault(); e.stopPropagation(); run('txtReplace'); }
}, true);
TEST_HOOKS.txtWrap = txtWrap;

addStyle(`
.txt-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; padding: 5px 6px; background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: 10px; font: 13px/1 var(--font-ui); color-scheme: normal; }
.txt-bar.floating { position: absolute; z-index: 8; box-shadow: 0 8px 28px rgba(0,0,0,.3), 0 0 0 1px var(--line); max-width: calc(100% - 8px); }
.txt-slot .txt-bar { margin: 4px 0 2px; }
.txt-bar .txt-colgrp { display: none; }
.txt-dot { --sw-edge: rgb(0 0 0 / .2); width: 18px; height: 18px; border-radius: 50%; box-shadow: inset 0 0 0 1px var(--sw-edge), 0 0 0 2px var(--surface), 0 0 0 3px var(--line); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .txt-dot { --sw-edge: rgb(255 255 255 / .34); } }
:root[data-theme="dark"] .txt-dot { --sw-edge: rgb(255 255 255 / .34); }
@media (max-width: 760px), (max-height: 500px) and (pointer: coarse) {
  /* Phones: one row; the colours open from one button */
  .txt-bar.floating { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; overscroll-behavior: contain; }
  .txt-bar.floating::-webkit-scrollbar { display: none; }
  .txt-bar.floating .txt-grp { flex: none; }
  .txt-bar.floating .txt-colgrp { display: inline-flex; }
  .txt-bar.floating .txt-cols { display: none; }
  .txt-bar.floating.txt-show-cols .txt-cols { display: inline-flex; }
  .txt-bar.floating.txt-show-cols .txt-grp:not(.txt-cols):not(.txt-colgrp) { display: none; }
  .txt-bar.floating .txt-cols .swatch { width: 26px; height: 26px; }
}
.txt-grp { display: inline-flex; align-items: center; gap: 2px; padding-right: 6px; border-right: 1px solid var(--line); }
.txt-grp:last-child { border-right: 0; padding-right: 0; }
.txt-b { border: 0; background: none; color: var(--ink); width: 30px; height: 30px; border-radius: 6px; display: inline-grid; place-items: center; cursor: pointer; padding: 0; }
.txt-b:hover { background: var(--hover); }
.txt-b[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); }
.txt-b [data-lucide], .txt-b svg { width: 16px; height: 16px; }
@media (pointer: coarse) { .txt-b { width: 44px; height: 44px; } .txt-bar select { height: 44px; } } /* a finger's 44px */
.txt-size { min-width: 30px; text-align: center; font-variant-numeric: tabular-nums; color: var(--ink); }
.txt-bar .sw-row { gap: 4px; }
@media (pointer: fine) { .txt-bar .sw-row .swatch { width: 20px; height: 20px; } .txt-bar .sw-more svg { width: 12px; height: 12px; } }
.txt-sel { gap: 4px; color: var(--ink-2); }
.txt-sel svg { width: 15px; height: 15px; flex: none; }
.txt-sel select { max-width: 150px; }
@media (max-width: 760px) { .txt-sel select { max-width: 112px; } }
.txt-bar select { font: inherit; color: var(--ink); background: var(--chrome); border: 1px solid var(--line); border-radius: 6px; height: 30px; padding: 0 6px; }
.txt-editor { position: absolute; z-index: 6; margin: 0; padding: 0 1px; border: 0; resize: none; overflow: hidden; outline: 2px solid var(--accent); outline-offset: 1px; border-radius: 1px; caret-color: currentColor; box-shadow: 0 4px 18px rgba(0,0,0,.18); white-space: pre-wrap; overflow-wrap: break-word; color-scheme: light; }
.txt-editor[wrap="off"] { white-space: pre; }
.txt-editor.txt-over-ed { outline-color: var(--danger, #E03131); }
.txt-over { position: absolute; z-index: 7; display: flex; align-items: center; gap: 8px; max-width: min(360px, calc(100% - 8px)); box-sizing: border-box; padding: 6px 6px 6px 10px; background: var(--surface); color: var(--ink); border: 1px solid var(--danger, #E03131); border-radius: 10px; box-shadow: 0 4px 18px rgba(0,0,0,.18); font: 12px/1.3 var(--font-ui); }
.txt-over .btn { height: 28px; padding: 0 10px; font-size: 12px; flex: none; }
.txt-over-kept { max-width: min(440px, calc(100% - 8px)); }
.field textarea.txt-paper { background: #fff; color-scheme: light; }
.field.txt-wfield { flex-direction: row; align-items: center; gap: 10px; }
.field.txt-wfield input { width: 130px; }
.txt-hint { font-size: 12px; color: var(--ink-3); margin: 4px 0 0; }
.txt-checks { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 4px 0; }
.txt-checks label { display: inline-flex; gap: 6px; align-items: center; color: var(--ink); }
.txt-checks input { accent-color: var(--accent); }
.marks .txt-guide { fill: color-mix(in srgb, var(--accent) 10%, transparent); stroke: var(--accent); stroke-dasharray: 4 3; pointer-events: none; }
.txt-status { min-height: 1.4em; margin: 6px 0 0; color: var(--ink); font-weight: 500; }
`);
