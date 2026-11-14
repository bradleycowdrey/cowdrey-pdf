/* ---------------- protect ----------------
   The Protect tab: redaction, passwords and permissions, flatten, compress, and removing hidden information.
   redact      a mark (per page): areas to black out, in PDF coordinates. Marked (red outline) until applied; once
               applied, saving takes the text, pictures, drawings and comments under it out of the file for good.
   docMarks():  protsec      a password and permissions (the passwords themselves stay in memory only), or "remove"
                protflatten  comments and/or form fields made part of the page when saved
                protcompress pictures down-sampled and the file packed when saved
                protclean    metadata, attachments, JavaScript (and comments) removed when saved */
const protSecrets = new Map(); // protsec mark id -> { open, owner }: never stored on this device
let protMeasuring = false, protCompressOverride = null;
const protNum = (n) => { const s = String(Math.round(n * 1000) / 1000); return s === '-0' ? '0' : s; };
const protOverlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const protContains = (a, b) => a[0] <= b[0] + .5 && a[1] <= b[1] + .5 && a[2] >= b[2] - .5 && a[3] >= b[3] - .5;
const protInv = (m) => { const d = m[0] * m[3] - m[1] * m[2]; return d ? [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d] : null; };
const protRgb = (hex) => { const n = parseInt(String(hex || '#000000').slice(1), 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const protDark = (hex) => { const [r, g, b] = protRgb(hex); return .2126 * r + .7152 * g + .0722 * b < .55; };
const protSize = (n) => n < 1024 ? `${n} bytes` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const protBytes = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
const protStr = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return s; };
const protEscRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const protDM = (type) => (doc ? docMarks().find((m) => m.type === type) : null);
const protRedMarks = (applied) => { const out = []; if (!doc) return out; const seen = new Set(); for (const e of doc.pages) { const k = pageKey(e); if (seen.has(k)) continue; seen.add(k); for (const m of doc.marks[k] || []) if (m.type === 'redact' && (applied == null || !!m.applied === applied)) out.push({ e, m }); } return out; };
const protUsedSources = () => (doc ? [...new Set(doc.pages.map((e) => e.src))] : []);
// The overlay text's size: as large as fits the box, at most 14 pt.
const protAlong = (b) => (b[3] - b[1] > (b[2] - b[0]) * 1.2 ? 90 : 0);
const protLabelSize = (label, w, h) => Math.max(4, Math.min(h * .62, 14, (w * .9) / (Math.max(1, label.length) * .56)));

function protSetDM(type, obj) {
  const before = snapshot(), list = docMarks();
  for (let k = list.length - 1; k >= 0; k--) if (list[k].type === type) list.splice(k, 1);
  if (obj) list.push({ id: uid(), type, ...obj });
  changed(before);
}

/* ----- dialogs ----- */
function protVals(root) {
  const o = {};
  for (const el of root.querySelectorAll('[name]')) {
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
}
// A dialog with fields: resolves with { action, ...values } or null when cancelled.
async function protAsk(title, body, actions, setup) {
  let vals = {};
  const res = await dialog(title, body, actions, (dlg) => {
    const b = $('.dlg-body', dlg), upd = () => { vals = protVals(b); };
    b.addEventListener('input', upd); b.addEventListener('change', upd);
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'radio') { e.preventDefault(); const pr = $('.dlg-foot .btn.primary', dlg); pr && pr.click(); } });
    if (setup) setup(dlg, upd);
    upd();
    const first = $('input:not([type=checkbox]):not([type=radio]):not([hidden])', b);
    // Unless the person has already moved into a field (focusing later would pull their typing into the first one).
    if (first) setTimeout(() => { if (!b.contains(document.activeElement)) first.focus(); }, 30);
  });
  return res == null ? null : { action: res, ...vals };
}

addStyle(`
/* With the Protect tab shown, the tab row is wider than a phone: it scrolls instead of widening the page. */
.ribbon-tabs { overflow-x: auto; scrollbar-width: none; }
.ribbon-tabs::-webkit-scrollbar { display: none; }
.ribbon-tabs button { flex: none; }
.app[data-tool="protredtext"] .marks { pointer-events: none !important; }
.app[data-tool="protredarea"] .marks { cursor: crosshair; }
.prot-checks { display: grid; gap: 8px; margin: 10px 0; }
.prot-check { display: flex; gap: 8px; align-items: flex-start; color: var(--ink); cursor: pointer; }
.prot-check input { accent-color: var(--brand); width: 16px; height: 16px; margin: 2px 0 0; flex: none; }
.prot-check small { display: block; color: var(--ink-3); font-size: 12px; }
.prot-row { display: flex; gap: 10px; flex-wrap: wrap; }
.prot-row .field { flex: 1 1 170px; min-width: 0; }
.field > span { font-size: 12px; color: var(--ink-2); }
.prot-sub { margin: 4px 0 4px 24px; }
.prot-sub[hidden] { display: none; }
.prot-size { color: var(--ink); background: var(--chrome); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; margin: 10px 0 4px; font-variant-numeric: tabular-nums; }
.prot-err { color: var(--danger); margin: 4px 0; }
.prot-fill { display: flex; align-items: center; gap: 10px; color: var(--ink); margin: 8px 0; }
.prot-fill input[type=color] { width: 40px; height: 28px; padding: 0 2px; border: 1px solid var(--line); border-radius: 6px; background: var(--chrome); }
.prot-sw { width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--surface); box-shadow: 0 0 0 1px var(--line); cursor: pointer; padding: 0; }
.prot-sw[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--accent); }
.marks .prot-red.applied { cursor: default; }
.prot-hit-sum { margin: 0 0 6px; }
.prot-hit-bar { display: flex; gap: 6px; margin: 0 0 6px; }
.prot-hit-bar .btn { height: 28px; padding: 0 10px; font-size: 12px; }
.prot-hits { list-style: none; margin: 0; padding: 2px; max-height: 210px; overflow: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--chrome); }
.prot-hit { display: flex; align-items: flex-start; gap: 8px; padding: 4px 6px; border-radius: 6px; }
.prot-hit.on { background: var(--accent-soft); }
.prot-hit input { accent-color: var(--brand); width: 16px; height: 16px; margin: 4px 0 0; flex: none; }
.prot-hit-go { flex: 1; min-width: 0; display: flex; gap: 8px; align-items: baseline; border: 0; background: none; padding: 2px 0; text-align: left; color: var(--ink); font: inherit; font-size: 13px; cursor: pointer; }
.prot-hit-pg { flex: none; color: var(--ink-3); font-size: 12px; font-variant-numeric: tabular-nums; min-width: 52px; }
.prot-hit-ctx { min-width: 0; overflow-wrap: anywhere; }
.prot-hit-ctx mark { background: color-mix(in srgb, #E03131 22%, transparent); color: inherit; border-radius: 2px; padding: 0 1px; font-weight: 600; }
.prot-hit-view { margin: 8px 0 0; }
.prot-hit-view canvas { display: block; width: 100%; height: auto; max-height: 180px; object-fit: contain; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.prot-hit-view figcaption { font-size: 12px; color: var(--ink-3); margin-top: 4px; overflow-wrap: anywhere; }
@media (pointer: coarse) { .prot-hit { padding: 6px; } .prot-hit input { width: 22px; height: 22px; margin-top: 1px; } }
`);

/* ----- redaction marks ----- */
FEATURE.markTypes.redact = {
  draw(v, m) {
    const g = svgEl('g', { class: 'mk prot-red' + (m.applied ? ' applied' : '') });
    for (const q of m.quads) {
      const pts = q.map(([x, y]) => toView(v, x, y));
      g.appendChild(svgEl('polygon', { points: pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' '), fill: m.applied ? m.fill : 'rgba(224,49,49,.10)', stroke: m.applied ? m.fill : '#E03131', 'stroke-width': m.applied ? .5 : 1.5 }));
      if (m.applied && m.label) {
        // The text runs along the box's longer side, the way the page's own text runs.
        const b = quadBox(q), along = protAlong(b), w = along ? b[3] - b[1] : b[2] - b[0], h = along ? b[2] - b[0] : b[3] - b[1];
        const c0 = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], [cx, cy] = toView(v, ...c0), [dx, dy] = toView(v, c0[0] + (along ? 0 : 1), c0[1] + (along ? 1 : 0));
        const ang = Math.atan2(dy - cy, dx - cx) * 180 / Math.PI;
        const t = svgEl('text', { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: protDark(m.fill) ? '#ffffff' : '#000000', 'font-size': protLabelSize(m.label, w, h) * scale, 'font-family': 'Helvetica, Arial, sans-serif', transform: `rotate(${ang.toFixed(2)} ${cx} ${cy})` });
        t.textContent = m.label; g.appendChild(t);
      }
    }
    return g;
  },
  move(m, o, dx, dy) { m.quads = o.quads.map((q) => q.map(([x, y]) => [x + dx, y + dy])); },
  // A redaction not applied yet is saved as a Redact annotation, so other apps can apply it too.
  save({ L, out, p, m }) {
    if (m.applied) return;
    const { PDFName, PDFHexString } = L;
    const bs = m.quads.map(quadBox), r = [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
    const qp = []; for (const b of bs) qp.push(b[0], b[3], b[2], b[3], b[0], b[1], b[2], b[1]);
    let ap = '1 0 0 RG 1.5 w\n'; for (const b of bs) ap += `${protNum(b[0])} ${protNum(b[1])} ${protNum(b[2] - b[0])} ${protNum(b[3] - b[1])} re S\n`;
    const apRef = out.context.register(out.context.flateStream(ap, { Type: 'XObject', Subtype: 'Form', BBox: r }));
    const annot = out.context.obj({ Type: 'Annot', Subtype: 'Redact', Rect: r, QuadPoints: qp.map((n) => +protNum(n)), C: [1, 0, 0], IC: protRgb(m.fill || '#000000').map((n) => +protNum(n)), F: 4, T: PDFHexString.fromText('Cowdrey.PDF'), AP: { N: apRef }, ...(m.label ? { OverlayText: PDFHexString.fromText(m.label) } : {}) });
    const ref = out.context.register(annot);
    let annots = p.node.lookup(PDFName.of('Annots'));
    if (!annots) { annots = out.context.obj([]); p.node.set(PDFName.of('Annots'), annots); }
    annots.push(ref);
  },
};
// Mark for redaction: drag an area.
FEATURE.tools.protredarea = {
  down(e, v) {
    e.preventDefault();
    const before = snapshot();
    const [x, y] = toPdf(v, ...localPoint(e, v));
    const m = { id: uid(), type: 'redact', quads: [[[x, y], [x, y], [x, y], [x, y]]], fill: '#000000', label: '', applied: false };
    marksOf(v.entry).push(m);
    const move = (ev) => { const [x2, y2] = toPdf(v, ...localPoint(ev, v)); m.quads = [[[x, y], [x2, y], [x2, y2], [x, y2]]]; drawMarks(v); };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      const b = quadBox(m.quads[0]);
      if (b[2] - b[0] < 2 || b[3] - b[1] < 2) { marksOf(v.entry).splice(marksOf(v.entry).indexOf(m), 1); drawMarks(v); return; }
      drawMarks(v); changed(before);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  },
};
// Mark for redaction: the text selected on the page.
FEATURE.selActions.push({ label: 'Mark for redaction', icon: 'eraser', order: 40, run: () => protMarkSelection() });
function protMarkSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !doc) return false;
  const before = snapshot(), made = new Map();
  for (let r = 0; r < sel.rangeCount; r++) {
    for (const rect of sel.getRangeAt(r).getClientRects()) {
      if (rect.width < 1 || rect.height < 1) continue;
      const v = views.find((vv) => { const b = vv.el.getBoundingClientRect(); return rect.top >= b.top - 2 && rect.bottom <= b.bottom + 2 && rect.left >= b.left - 2 && rect.right <= b.right + 2; });
      if (!v) continue;
      const b = v.el.getBoundingClientRect(), l = rect.left - b.left, t = rect.top - b.top, rr = rect.right - b.left, bt = rect.bottom - b.top;
      const q = [toPdf(v, l, bt), toPdf(v, rr, bt), toPdf(v, rr, t), toPdf(v, l, t)];
      let m = made.get(v.entry);
      if (!m) { m = { id: uid(), type: 'redact', quads: [], fill: '#000000', label: '', applied: false }; made.set(v.entry, m); marksOf(v.entry).push(m); }
      m.quads.push(q);
    }
  }
  sel.removeAllRanges();
  if (!made.size) return false;
  views.forEach((v) => v.rendered && drawMarks(v)); changed(before);
  return true;
}
document.addEventListener('pointerup', () => { if (app.dataset.tool === 'protredtext') setTimeout(protMarkSelection, 0); });

/* ----- search and redact ----- */
const PROT_PATTERNS = {
  email: '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}',
  phone: '(?:\\+\\d{1,3}[\\s.-]?)?(?:\\(\\d{2,4}\\)[\\s.-]?)?\\d{3,4}[\\s.-]\\d{3,4}(?:[\\s.-]\\d{2,4})?(?!\\d)',
};
function protRegex({ text, matchCase, wholeWords, email, phone }) {
  const parts = [];
  const t = String(text || '').trim();
  if (t) { let s = protEscRe(t).replace(/\s+/g, '\\s+'); if (wholeWords) s = (/^\w/.test(t) ? '\\b' : '') + s + (/\w$/.test(t) ? '\\b' : ''); parts.push(s); }
  if (email) parts.push(PROT_PATTERNS.email);
  if (phone) parts.push(PROT_PATTERNS.phone);
  return parts.length ? new RegExp(parts.map((p) => `(?:${p})`).join('|'), matchCase ? 'g' : 'gi') : null;
}
// Every match on every page, as quads in PDF coordinates: one list of quads per match.
async function protFind(rx) {
  const found = [];
  const seen = new Set();
  for (const entry of doc.pages) {
    if (seen.has(pageKey(entry))) continue; seen.add(pageKey(entry));
    const page = await pageOf(entry), tc = await page.getTextContent();
    let cm = null; try { cm = await contentMap(page); } catch {}
    // The page's text in one string, each letter mapped back to its piece of text.
    let s = ''; const map = []; let prev = null;
    for (const it of tc.items) {
      if (!it.str || !it.transform) { if (it.hasEOL) { s += '\n'; map.push(null); } continue; }
      if (prev && !/\s$/.test(s) && !/^\s/.test(it.str)) {
        const f = lineFrame({ tm: prev.transform }), dx = it.transform[4] - f.o[0], dy = it.transform[5] - f.o[1];
        const along = dx * f.u[0] + dy * f.u[1], perp = dx * f.v[0] + dy * f.v[1];
        if (Math.abs(perp) > f.size * .3 || along - prev.width > f.size * .25 || along < prev.width - f.size) { s += ' '; map.push(null); }
      }
      for (let j = 0; j < it.str.length; j++) map.push([it, j]);
      s += it.str; prev = it;
      if (it.hasEOL) { s += '\n'; map.push(null); prev = null; }
    }
    // Where each letter starts within its piece: from the font's own widths, scaled to the piece's width.
    const xs = new Map();
    const xOf = (it) => {
      let a = xs.get(it); if (a) return a;
      const g = cm && cm.glyphs.get(it.fontName), ws = [...it.str].length === it.str.length ? [...it.str].map((ch) => { const gl = g && g.get(ch); return gl && gl.w > 0 ? gl.w : null; }) : null;
      const known = ws ? ws.filter((w) => w != null) : [], avg = known.length ? known.reduce((x, y) => x + y, 0) / known.length : 1;
      const w = ws ? ws.map((x) => x ?? avg) : [...Array(it.str.length)].map(() => 1), tot = w.reduce((x, y) => x + y, 0) || 1;
      a = [0]; for (const x of w) a.push(a[a.length - 1] + x / tot * it.width);
      xs.set(it, a); return a;
    };
    rx.lastIndex = 0;
    for (let mt; (mt = rx.exec(s));) {
      if (!mt[0].length) { rx.lastIndex++; continue; }
      const byItem = new Map();
      for (let k = mt.index; k < mt.index + mt[0].length; k++) {
        const ref = map[k]; if (!ref || /\s/.test(s[k])) continue;
        const r = byItem.get(ref[0]) || byItem.set(ref[0], [ref[1], ref[1]]).get(ref[0]);
        r[0] = Math.min(r[0], ref[1]); r[1] = Math.max(r[1], ref[1]);
      }
      const quads = [];
      for (const [it, [j0, j1]] of byItem) {
        const a = xOf(it), { u, v, o } = lineFrame({ tm: it.transform });
        const P = (x, y) => [o[0] + u[0] * x + v[0] * y, o[1] + u[1] * x + v[1] * y];
        const [y0, y1] = protGlyphBand(tc, it), x0 = a[j0], x1 = a[j1 + 1];
        quads.push([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)]);
      }
      // With the words around it, for the list of matches to check.
      const near = (t) => t.replace(/\s+/g, ' ');
      if (quads.length) found.push({ entry, quads, text: mt[0], before: near(s.slice(Math.max(0, mt.index - 40), mt.index)), after: near(s.slice(mt.index + mt[0].length, mt.index + mt[0].length + 40)) });
    }
  }
  return found;
}
// How far a piece of text reaches below and above its baseline, for a redaction box: the font's descent and ascent
// clamped to the letters (a font's ascent often leaves room for accents), and never into the line above or below.
const protGlyphExt = (st) => [Math.max(st.descent ?? -.2, -.22), Math.min(st.ascent ?? .8, .9)];
function protGlyphBand(tc, it) {
  const f = lineFrame({ tm: it.transform }), size = f.size, ext = protGlyphExt(tc.styles[it.fontName] || {});
  let y0 = ext[0] * size, y1 = ext[1] * size;
  for (const jt of tc.items) {
    if (jt === it || !jt.str || !jt.str.trim() || !jt.transform) continue;
    const g = lineFrame({ tm: jt.transform }); if (g.u[0] * f.u[0] + g.u[1] * f.u[1] < .99) continue; // same direction only
    const dx = g.o[0] - f.o[0], dy = g.o[1] - f.o[1], along = dx * f.u[0] + dy * f.u[1], perp = dx * f.v[0] + dy * f.v[1];
    if (along > it.width || along + jt.width < 0 || Math.abs(perp) < size * .3 || Math.abs(perp) > size * 2.5) continue; // not side by side
    const e = protGlyphExt(tc.styles[jt.fontName] || {});
    // Stop where the neighbour's letters start, but always cover this line's capitals and most of its descenders.
    if (perp > 0) { const top = perp + e[0] * g.size; if (top < y1) y1 = Math.max(size * .72, top); }
    else { const bot = perp + e[1] * g.size; if (bot > y0) y0 = Math.min(-size * .14, bot); }
  }
  return [y0, y1];
}
async function protSearch() {
  const last = S.protSearch || {};
  const r = await protAsk('Search and redact', `<p>Find words or patterns and mark every match for redaction. Nothing is removed until you apply the redactions.</p>
    <label class="field"><span>Words or phrase</span><input name="text" type="text" autocomplete="off" value="${esc(last.text || '')}"></label>
    <div class="prot-checks">
      <label class="prot-check"><input type="checkbox" name="wholeWords"${last.wholeWords !== false ? ' checked' : ''}> Whole words only</label>
      <label class="prot-check"><input type="checkbox" name="matchCase"${last.matchCase ? ' checked' : ''}> Match case</label>
      <label class="prot-check"><input type="checkbox" name="email"${last.email ? ' checked' : ''}> Email addresses</label>
      <label class="prot-check"><input type="checkbox" name="phone"${last.phone ? ' checked' : ''}> Phone numbers</label>
    </div>`, [{ label: 'Cancel' }, { label: 'Find', value: 'find', primary: true }]);
  if (!r || r.action !== 'find') return;
  S.protSearch = { text: r.text, wholeWords: r.wholeWords, matchCase: r.matchCase, email: r.email, phone: r.phone }; saveSettings();
  const rx = protRegex(r);
  if (!rx) { toast('Type something to find, or choose a pattern'); return; }
  const found = await protFind(rx);
  if (!found.length) { toast('No matches found'); return; }
  const pick = await protReview(found);
  if (pick === 'back') return protSearch();
  if (!pick || !pick.length) return;
  const before = snapshot();
  for (const f of pick) marksOf(f.entry).push({ id: uid(), type: 'redact', quads: f.quads, fill: '#000000', label: '', applied: false, found: f.text });
  views.forEach((v) => v.rendered && drawMarks(v)); changed(before);
  // The view goes to the first one, so what was marked can be seen.
  const pages = [...new Set(pick.map(protPageNo))].sort((a, b) => a - b);
  goPage(pages[0] - 1);
  toast(`${pick.length} marked for redaction on page${pages.length > 1 ? 's' : ''} ${pages.length > 6 ? pages.slice(0, 6).join(', ') + '…' : pages.join(', ')}`);
}
const protPageNo = (f) => doc.pages.indexOf(f.entry) + 1;
/* The matches, to check before marking: each with its page and the words around it, ticked. Choosing one shows it
   on its page, in the dialog. Untick any that should stay. */
async function protReview(found) {
  let picked = found.map(() => true);
  const pages = [...new Set(found.map(protPageNo))];
  const list = found.map((f, k) => `<li class="prot-hit" data-k="${k}"><input type="checkbox" checked aria-label="Mark match ${k + 1} on page ${protPageNo(f)}">
    <button type="button" class="prot-hit-go" data-go="${k}"><span class="prot-hit-pg">Page ${protPageNo(f)}</span><span class="prot-hit-ctx">${f.before.trim() ? '…' : ''}${esc(f.before.trimStart())}<mark>${esc(f.text)}</mark>${esc(f.after.trimEnd())}${f.after.trim() ? '…' : ''}</span></button></li>`).join('');
  const res = await dialog('Search and redact', `<p class="prot-hit-sum">${found.length} match${found.length === 1 ? '' : 'es'} on ${pages.length === 1 ? 'page ' + pages[0] : pages.length + ' pages'}. Untick any you want to keep.</p>
    <div class="prot-hit-bar"><button type="button" class="btn" data-all="1">Tick all</button><button type="button" class="btn" data-all="0">Untick all</button></div>
    <ul class="prot-hits" aria-label="Matches">${list}</ul>
    <figure class="prot-hit-view"><canvas width="1" height="1" aria-hidden="true"></canvas><figcaption aria-live="polite"></figcaption></figure>`,
  [{ label: 'Back', value: 'back' }, { label: 'Cancel' }, { label: 'Mark', value: 'mark', primary: true }], (dlg) => {
    const pb = $('.dlg-foot .btn.primary', dlg), boxes = $$('.prot-hit input', dlg);
    const count = () => { picked = boxes.map((b) => b.checked); const n = picked.filter(Boolean).length; pb.textContent = n === found.length && n > 1 ? `Mark all ${n}` : `Mark ${n}`; pb.disabled = !n; };
    let shownK = -1;
    const show = async (k) => {
      shownK = k; $$('.prot-hit', dlg).forEach((li) => li.classList.toggle('on', +li.dataset.k === k));
      const f = found[k], cap = $('figcaption', dlg); cap.textContent = `Page ${protPageNo(f)}: ${f.text}`;
      try { const c = await protHitShot(f); if (shownK !== k || !dlg.open) return; const cv = $('.prot-hit-view canvas', dlg); cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0); } catch {}
    };
    $('.prot-hits', dlg).addEventListener('change', count);
    $('.prot-hits', dlg).addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) show(+g.dataset.go); });
    // Up and down move between the matches.
    $('.prot-hits', dlg).addEventListener('keydown', (e) => {
      if (!/^(ArrowUp|ArrowDown)$/.test(e.key)) return;
      const gos = $$('[data-go]', dlg), at = gos.indexOf(e.target.closest('[data-go]')), k = Math.max(0, Math.min(gos.length - 1, (at < 0 ? shownK : at) + (e.key === 'ArrowDown' ? 1 : -1)));
      e.preventDefault(); gos[k].focus(); show(k);
    });
    $$('[data-all]', dlg).forEach((b) => b.onclick = () => { boxes.forEach((x) => { x.checked = b.dataset.all === '1'; }); count(); });
    count(); show(0);
  });
  if (res === 'back') return 'back';
  return res === 'mark' ? found.filter((f, k) => picked[k]) : null;
}
// A close-up of one match on its page, outlined, for the list of matches.
const protShots = new WeakMap();
async function protHitShot(f) {
  const page = await pageOf(f.entry), rotation = (page.rotate + f.entry.rot) % 360;
  const v = page.getViewport({ scale: 2, rotation });
  let full = protShots.get(f.entry);
  if (!full) {
    full = document.createElement('canvas'); full.width = Math.round(v.width); full.height = Math.round(v.height);
    const g = full.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, full.width, full.height);
    await page.render({ canvas: full, canvasContext: g, viewport: v }).promise;
    protShots.set(f.entry, full);
  }
  const pts = f.quads.flat().map(([x, y]) => v.convertToViewportPoint(x, y)), xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const b = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const W = Math.min(full.width, Math.max(520, b[2] - b[0] + 120)), H = Math.min(full.height, Math.max(140, b[3] - b[1] + 80));
  const x0 = Math.max(0, Math.min(full.width - W, (b[0] + b[2]) / 2 - W / 2)), y0 = Math.max(0, Math.min(full.height - H, (b[1] + b[3]) / 2 - H / 2));
  const c = document.createElement('canvas'); c.width = Math.round(W); c.height = Math.round(H);
  const g = c.getContext('2d'); g.drawImage(full, x0, y0, W, H, 0, 0, W, H);
  g.fillStyle = 'rgba(224,49,49,.12)'; g.strokeStyle = '#E03131'; g.lineWidth = 3;
  for (const q of f.quads) { g.beginPath(); q.map(([x, y]) => v.convertToViewportPoint(x, y)).forEach(([x, y], i) => (i ? g.lineTo(x - x0, y - y0) : g.moveTo(x - x0, y - y0))); g.closePath(); g.fill(); g.stroke(); }
  return c;
}

/* ----- apply ----- */
// A mark's rough extent, to find what overlaps a redaction.
function protMarkBox(m) {
  const pts = m.rects ? m.rects.flatMap((r) => [[r[0], r[1]], [r[2], r[3]]]) : m.pts ? m.pts : 'x1' in m ? [[m.x1, m.y1], [m.x2, m.y2]]
    : m.type === 'note' ? [[m.x, m.y - 22], [m.x + 22, m.y]] : m.type === 'img' ? [[m.x, m.y], [m.x + m.w, m.y + m.h]] : m.type === 'text' ? [[m.x, m.y - m.size * 1.2 * m.text.split('\n').length], [m.x + m.size * .55 * Math.max(...m.text.split('\n').map((l) => l.length)), m.y]] : null;
  return pts && pts.length ? quadBox(pts) : null;
}
async function protApply() {
  const pend = protRedMarks(false);
  if (!pend.length) { toast('Mark text or an area for redaction first'); return; }
  const last = S.protRedact || { fill: '#000000', label: '' };
  const swatches = ['#000000', '#FFFFFF', '#E03131'];
  const r = await protAsk('Apply redactions', `<p>${pend.length === 1 ? 'The marked area is' : `The ${pend.length} marked areas are`} covered with a box. When you save, the text, pictures and drawings under ${pend.length === 1 ? 'it' : 'them'} are taken out of the PDF for good, and comments over ${pend.length === 1 ? 'it' : 'them'} are removed.</p>
    <div class="prot-fill"><span>Box colour</span>${swatches.map((c) => `<button type="button" class="prot-sw" data-sw="${c}" style="background:${c}" aria-label="Colour ${c}" aria-pressed="${last.fill.toUpperCase() === c}"></button>`).join('')}<input type="color" name="fill" value="${esc(last.fill)}" aria-label="Other colour"></div>
    <label class="field"><span>Text on the box (optional)</span><input name="label" type="text" autocomplete="off" placeholder="For example: Redacted" value="${esc(last.label || '')}"></label>`,
  [{ label: 'Cancel' }, { label: 'Apply', value: 'apply', primary: true }], (dlg, upd) => {
    const col = $('input[name=fill]', dlg);
    $$('[data-sw]', dlg).forEach((b) => b.onclick = () => { col.value = b.dataset.sw.toLowerCase(); $$('[data-sw]', dlg).forEach((x) => x.setAttribute('aria-pressed', x === b)); upd(); });
    col.addEventListener('input', () => $$('[data-sw]', dlg).forEach((x) => x.setAttribute('aria-pressed', x.dataset.sw.toLowerCase() === col.value.toLowerCase())));
  });
  if (!r || r.action !== 'apply') return;
  const fill = /^#[0-9a-f]{6}$/i.test(r.fill) ? r.fill.toLowerCase() : '#000000', label = String(r.label || '').trim().slice(0, 60);
  S.protRedact = { fill, label }; saveSettings();
  const before = snapshot();
  const byEntry = new Map(); for (const { e, m } of pend) (byEntry.get(e) || byEntry.set(e, []).get(e)).push(m);
  for (const [e, ms] of byEntry) {
    for (const m of ms) { m.applied = true; m.fill = fill; m.label = label; }
    const boxes = ms.flatMap((m) => m.quads.map(quadBox)), list = marksOf(e);
    // Mark-up drawn over a redaction goes with it.
    for (let k = list.length - 1; k >= 0; k--) {
      const x = list[k]; if (x.type === 'redact' || CONTENT_TYPES.has(x.type)) continue;
      const b = protMarkBox(x); if (b && boxes.some((bb) => protOverlap(bb, b))) list.splice(k, 1);
    }
    // So do comments from other apps (they are deleted the way the Edit tool deletes them).
    try {
      const cm = await contentMap(await pageOf(e));
      for (const a of cm.comments) {
        if (!boxes.some((bb) => protOverlap(bb, a.rect))) continue;
        const ae = list.find((x) => x.type === 'ae' && x.ref === a.id);
        if (ae) ae.deleted = true; else list.push({ id: uid(), type: 'ae', ref: a.id, rect: a.rect, subtype: a.subtype || '', deleted: true });
      }
    } catch (err) { console.warn(err); }
  }
  changed(before); syncHiddenComments();
  views.forEach((v) => { if (v.rendered) { drawMarks(v); protHideSpans(v); } });
  toast(`${pend.length === 1 ? 'Redaction' : pend.length + ' redactions'} applied. Save the PDF to remove the content for good.`);
}
// On screen, text under an applied redaction can't be selected, copied or found.
function protHideSpans(v) {
  const qs = marksOf(v.entry).filter((m) => m.type === 'redact' && m.applied).flatMap((m) => m.quads);
  if (!qs.length) return;
  const r = v.el.getBoundingClientRect();
  for (const s of v.el.querySelectorAll('.textLayer span')) {
    const b = s.getBoundingClientRect(); if (!b.width || !s.textContent) continue;
    const t = s.textContent, n = t.length; let changedAny = false, outS = '';
    for (let k = 0; k < n; k++) {
      const [x, y] = toPdf(v, b.left - r.left + (k + .5) / n * b.width, b.top - r.top + b.height / 2);
      if (qs.some((q) => inQuad(q, x, y))) { outS += ' '; changedAny = true; } else outS += t[k];
    }
    if (changedAny) s.textContent = outS;
  }
}
FEATURE.afterRender.push((v) => { protHideSpans(v); protFormsLocked(v); });

/* ----- saving redactions ----- */
function protStreamText(L, st) {
  try { const b = st instanceof L.PDFRawStream ? L.decodePDFRawStream(st).decode() : st.getUnencodedContents(); return protStr(b); } catch { return ''; }
}
// A copy of a resource dictionary (and its pictures and forms) this page or form can change on its own.
function protCloneRes(L, out, res) {
  const { PDFDict, PDFName } = L;
  const nr = res instanceof PDFDict ? res.clone(out.context) : out.context.obj({});
  const xo = nr.lookup(PDFName.of('XObject'));
  if (xo instanceof PDFDict) nr.set(PDFName.of('XObject'), xo.clone(out.context));
  return nr;
}
function protAddXObject(L, out, res, ref, tag) {
  const { PDFDict, PDFName } = L;
  let xo = res.lookup(PDFName.of('XObject'));
  if (!(xo instanceof PDFDict)) { xo = out.context.obj({}); res.set(PDFName.of('XObject'), xo); }
  let k = 1; while (xo.has(PDFName.of(tag + k))) k++;
  xo.set(PDFName.of(tag + k), ref);
  return tag + k;
}
const protNums = (out, arr) => { try { return arr.asArray().map((x) => out.context.lookup(x).asNumber()); } catch { return null; } };
// A picture's pixels, as pdf.js decoded them, on a canvas.
async function protImageCanvas(page, im) {
  let obj = im.inline || null;
  if (!obj && im.objId) obj = await new Promise((res) => {
    let done = false; const fin = (x) => { if (!done) { done = true; res(x); } };
    try { (/^g_/.test(im.objId) ? page.commonObjs : page.objs).get(im.objId, fin); } catch { fin(null); }
    setTimeout(() => fin(null), 4000);
  });
  if (!obj || !obj.width || !obj.height) return null;
  const c = document.createElement('canvas'); c.width = obj.width; c.height = obj.height; const g = c.getContext('2d');
  try {
    if (obj.bitmap) g.drawImage(obj.bitmap, 0, 0);
    else if (obj.data) {
      const w = obj.width, h = obj.height, n = w * h, src = obj.data, id = g.createImageData(w, h), d = id.data;
      if (obj.kind === 1) { const rb = (w + 7) >> 3; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const on = (src[y * rb + (x >> 3)] >> (7 - (x & 7))) & 1, i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = on ? 255 : 0; d[i + 3] = 255; } }
      else {
        const bpp = obj.kind === 3 ? 4 : obj.kind === 2 ? 3 : src.length / n;
        for (let i = 0; i < n; i++) {
          if (bpp >= 4) { d[i * 4] = src[i * 4]; d[i * 4 + 1] = src[i * 4 + 1]; d[i * 4 + 2] = src[i * 4 + 2]; d[i * 4 + 3] = src[i * 4 + 3]; }
          else if (bpp >= 3) { d[i * 4] = src[i * 3]; d[i * 4 + 1] = src[i * 3 + 1]; d[i * 4 + 2] = src[i * 3 + 2]; d[i * 4 + 3] = 255; }
          else { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = src[i]; d[i * 4 + 3] = 255; }
        }
      }
      g.putImageData(id, 0, 0);
    } else return null;
  } catch { return null; }
  return c;
}
// A picture under a redaction: removed when it is all covered; otherwise redrawn with the covered pixels painted over.
// Returns the content that replaces it, or null to keep it as it is.
async function protImageOp(st, ctm, info) {
  const box = quadBox(matQuad(ctm)), hits = st.areas.filter((a) => protOverlap(a.box, box));
  if (!hits.length) return null;
  if (hits.some((a) => protContains(a.box, box))) return ' ';
  // The same picture drawn again in the same place (some PDFs draw it twice) uses the one redacted copy.
  const key = info.key && `${info.key}|${ctm.map((n) => n.toFixed(2)).join(',')}`, cache = (st.redImages ||= new Map());
  if (key && cache.has(key)) return ` /${protAddXObject(st.L, st.out, info.res, cache.get(key), 'CPDFRed')} Do `;
  const im = st.cm && st.cm.images.find((i) => !!i.inline === !!info.inline && quadBox(i.quad).every((n, k) => Math.abs(n - box[k]) < .75));
  const c = im && await protImageCanvas(st.page, im), inv = protInv(ctm);
  if (!c || !inv) return ' '; // its pixels can't be read: it goes, rather than leave what's under the box in the file
  const g = c.getContext('2d');
  for (const a of hits) {
    const pts = a.q.map(([x, y]) => { const [ux, uy] = apply(inv, x, y); return [ux * c.width, (1 - uy) * c.height]; });
    g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
    g.fillStyle = a.fill; g.strokeStyle = a.fill; g.lineWidth = 2; g.fill(); g.stroke();
  }
  const { L, out } = st;
  const ref = info.jpeg ? protJpegXObject(out, c, info.smask) : (await out.embedPng(c.toDataURL('image/png'))).ref;
  if (key) cache.set(key, ref);
  return ` /${protAddXObject(L, out, info.res, ref, 'CPDFRed')} Do `;
}
// A JPEG picture stays a JPEG. When it had a soft mask (see-through parts), the mask is saved beside it as a small
// grey picture made from the redacted pixels, so the painted-over area is solid and the file does not grow.
function protJpegXObject(out, c, smask) {
  const w = c.width, h = c.height, g = c.getContext('2d');
  let alpha = null;
  if (smask) {
    const id = g.getImageData(0, 0, w, h), d = id.data; alpha = new Uint8Array(w * h); let solid = true;
    for (let i = 0; i < w * h; i++) { alpha[i] = d[i * 4 + 3]; if (alpha[i] !== 255) solid = false; d[i * 4 + 3] = 255; }
    if (solid) alpha = null; else g.putImageData(id, 0, 0); // colours without their see-through, for the JPEG
  }
  const jpg = Uint8Array.from(atob(c.toDataURL('image/jpeg', .92).split(',')[1]), (ch) => ch.charCodeAt(0));
  const dict = { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' };
  if (alpha) dict.SMask = out.context.register(out.context.flateStream(alpha, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }));
  return out.context.register(out.context.stream(jpg, dict));
}
// Rewrites a content stream so nothing under the redaction areas is left in it: letters are taken out (the rest of
// their line stays where it was), pictures are cut or painted over, and forms are rewritten the same way.
async function protRewrite(st, src, res, ctm0, depth) {
  const { L, out } = st, { PDFName, PDFDict, PDFRef, PDFStream } = L;
  const { fonts, fontWidth } = pageFonts(L, out, { Resources: () => res });
  const xo = res && res.lookup(PDFName.of('XObject')), xod = xo instanceof PDFDict ? xo : null;
  const toks = tokenizeContent(src);
  let ctm = ctm0.slice(), tm = [1, 0, 0, 1, 0, 0], tlm = tm, font = null, fs = 1, tc = 0, tw = 0, th = 1, tl = 0, rise = 0;
  const gstack = [], edits = [], touched = new Set();
  let operands = [], opStart = null, arrStack = [], bi = null;
  for (const t of toks) {
    if (t.t !== 'op') {
      if (opStart == null) opStart = t.start;
      if (t.t === '[') { arrStack.push(operands); operands = []; continue; }
      if (t.t === ']') { const arr = operands; operands = arrStack.pop() || []; operands.push(...arr); continue; }
      operands.push(t); continue;
    }
    const o = t.v, a = operands, start = opStart ?? t.start, end = t.end;
    operands = []; opStart = null; arrStack = [];
    const num = (k) => (a[k] && a[k].t === 'num' ? a[k].v : 0);
    if (o === 'BI') { bi = { start }; continue; }
    if (o === 'ID') continue;
    if (o === 'EI') { if (bi) { const r = await protImageOp(st, ctm, { inline: true, res }); if (r != null) edits.push([bi.start, end, r]); bi = null; } continue; }
    if (bi) continue;
    if (o === 'q') gstack.push([ctm, font, fs, tc, tw, th, tl, rise]);
    else if (o === 'Q') { const g = gstack.pop(); if (g) [ctm, font, fs, tc, tw, th, tl, rise] = g; }
    else if (o === 'cm') ctm = mul([0, 1, 2, 3, 4, 5].map(num), ctm);
    else if (o === 'BT') { tm = tlm = [1, 0, 0, 1, 0, 0]; }
    else if (o === 'Tf') { font = a[0] && a[0].v; fs = num(1); }
    else if (o === 'Tc') tc = num(0);
    else if (o === 'Tw') tw = num(0);
    else if (o === 'Tz') th = num(0) / 100;
    else if (o === 'TL') tl = num(0);
    else if (o === 'Ts') rise = num(0);
    else if (o === 'Td' || o === 'TD') { if (o === 'TD') tl = -num(1); tlm = mul([1, 0, 0, 1, num(0), num(1)], tlm); tm = tlm; }
    else if (o === 'Tm') { tm = tlm = [0, 1, 2, 3, 4, 5].map(num); }
    else if (o === 'T*') { tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; }
    else if (o === 'Tj' || o === 'TJ' || o === "'" || o === '"') {
      let prefix = '';
      if (o === "'" || o === '"') { if (o === '"') { tw = num(0); tc = num(1); prefix = `${protNum(tw)} Tw ${protNum(tc)} Tc `; } prefix += 'T* '; tlm = mul([1, 0, 0, 1, 0, -tl], tlm); tm = tlm; }
      const parts = o === 'TJ' ? a.filter((x) => x.t === 'str' || x.t === 'num') : a.filter((x) => x.t === 'str').slice(-1);
      const M = mul(tm, ctm), f = fonts.get(font), nb = f ? f.bytes : 1;
      let adv = 0, any = false, run = null, pend = 0; const outParts = [];
      const flushRun = () => { if (run != null) { outParts.push('<' + run + '>'); run = null; } };
      const flushPend = () => { if (pend) { outParts.push(protNum(pend)); pend = 0; } };
      for (const p of parts) {
        if (p.t === 'num') { flushRun(); pend += p.v; adv -= p.v / 1000 * fs * th; continue; }
        for (const { code, w, space } of fontWidth(font, p.v)) {
          const gw = (w / 1000 * fs + tc + (space ? tw : 0)) * th;
          const [cx, cy] = apply(M, adv + w / 2000 * fs * th, rise + fs * .3);
          if (fs && th && st.areas.some((ar) => inQuad(ar.q, cx, cy))) { any = true; flushRun(); pend -= (w / 1000 * fs + tc + (space ? tw : 0)) * 1000 / fs; }
          else { flushPend(); run = (run || '') + code.toString(16).padStart(nb * 2, '0'); }
          adv += gw;
        }
      }
      flushRun(); flushPend();
      if (any) edits.push([start, end, ` ${prefix}[${outParts.join(' ')}] TJ `]);
      tm = mul([1, 0, 0, 1, adv, 0], tm);
    } else if (o === 'Do' && xod && a[0] && a[0].t === 'name') {
      const name = a[0].v, obj = xod.lookup(PDFName.of(name)), ref = xod.get(PDFName.of(name));
      if (!(obj instanceof PDFStream)) continue;
      const sub = String(obj.dict.lookup(PDFName.of('Subtype')) || '');
      if (sub === '/Image') {
        const filt = String(obj.dict.lookup(PDFName.of('Filter')) || '');
        const r = await protImageOp(st, ctm, { res, jpeg: /DCTDecode/.test(filt), smask: obj.dict.has(PDFName.of('SMask')), key: ref instanceof PDFRef ? ref.toString() : null });
        if (r != null) { edits.push([start, end, r]); touched.add(name); }
      } else if (sub === '/Form' && depth < 8) {
        const mt = obj.dict.lookup(PDFName.of('Matrix')), M = (mt && protNums(out, mt)) || [1, 0, 0, 1, 0, 0];
        const bb = protNums(out, obj.dict.lookup(PDFName.of('BBox'))), fctm = mul(M, ctm);
        if (bb) { const q = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]].map(([x, y]) => apply(fctm, x, y)); if (!st.areas.some((ar) => protOverlap(ar.box, quadBox(q)))) continue; }
        const fr0 = obj.dict.lookup(PDFName.of('Resources')), fres = protCloneRes(L, out, fr0 instanceof PDFDict ? fr0 : res);
        const fsrc = protStreamText(L, obj), nsrc = await protRewrite(st, fsrc, fres, fctm, depth + 1);
        if (nsrc === fsrc) continue;
        const ns = out.context.flateStream(protBytes(nsrc), {});
        for (const [k, v] of obj.dict.entries()) if (!['/Length', '/Filter', '/DecodeParms'].includes(k.asString())) ns.dict.set(k, v);
        ns.dict.set(PDFName.of('Resources'), fres);
        edits.push([start, end, ` /${protAddXObject(L, out, res, out.context.register(ns), 'CPDFRedF')} Do `]); touched.add(name);
        void ref; void PDFRef;
      }
    }
  }
  if (!edits.length) return src;
  edits.sort((x, y) => y[0] - x[0]);
  for (const [s0, e0, r] of edits) src = src.slice(0, s0) + r + src.slice(e0);
  // Pictures and forms no longer drawn here leave this resource dictionary, so they aren't kept in the file.
  if (xod) {
    const own = res.lookup(PDFName.of('XObject'));
    for (const name of touched) if (!new RegExp('/' + protEscRe(name) + '\\s+Do\\b').test(src)) own.delete(PDFName.of(name));
  }
  return src;
}
function protDropField(L, out, ref, d) {
  const { PDFName, PDFDict, PDFArray } = L;
  const acro = out.catalog.lookup(PDFName.of('AcroForm'));
  let child = ref, parentRef = d.get(PDFName.of('Parent'));
  for (let guard = 0; guard < 20; guard++) {
    const container = parentRef ? out.context.lookup(parentRef) : acro;
    if (!(container instanceof PDFDict)) return;
    const arr = container.lookup(PDFName.of(parentRef ? 'Kids' : 'Fields'));
    if (!(arr instanceof PDFArray)) return;
    for (let i = arr.size() - 1; i >= 0; i--) if (arr.get(i) === child) arr.remove(i);
    if (!parentRef || arr.size()) return;
    child = parentRef; parentRef = container.get(PDFName.of('Parent')); out.context.delete(child);
  }
}
// Removes a page's annotations that match `drop(dict, subtype)`, with their popups (and form fields, for widgets).
function protDropAnnots(L, out, node, drop) {
  const { PDFName, PDFArray, PDFDict, PDFRef } = L;
  const annots = node.lookup(PDFName.of('Annots')); if (!(annots instanceof PDFArray)) return 0;
  const gone = new Set(); let n = 0;
  for (let k = annots.size() - 1; k >= 0; k--) {
    const r = annots.get(k), d = out.context.lookup(r); if (!(d instanceof PDFDict)) continue;
    const sub = String(d.lookup(PDFName.of('Subtype')) || '').slice(1);
    if (sub === 'Popup' || !drop(d, sub)) continue;
    annots.remove(k); n++; gone.add(r);
    const pop = d.get(PDFName.of('Popup')); if (pop instanceof PDFRef) gone.add(pop);
    if (sub === 'Widget') protDropField(L, out, r, d);
  }
  for (let k = annots.size() - 1; k >= 0; k--) {
    const r = annots.get(k), d = out.context.lookup(r);
    if (!d || (d instanceof PDFDict && gone.has(d.get(PDFName.of('Parent'))))) { annots.remove(k); if (r instanceof PDFRef) gone.add(r); }
  }
  for (const r of gone) if (r instanceof PDFRef) out.context.delete(r);
  return n;
}
FEATURE.savePage.push(async ({ L, out, p, entry, marks, ctx }) => {
  const reds = marks.filter((m) => m.type === 'redact' && m.applied);
  if (!reds.length) return;
  ctx.protRedacted = true;
  const { PDFName, PDFArray, PDFNumber, PDFOperator, StandardFonts, degrees, rgb } = L;
  const node = p.node;
  const areas = reds.flatMap((m) => m.quads.map((q) => ({ q, box: quadBox(q), fill: m.fill || '#000000', label: m.label || '' })));
  // 1. Comments, links and form fields over a redaction
  protDropAnnots(L, out, node, (d) => { const rc = protNums(out, d.lookup(PDFName.of('Rect'))); if (!rc) return false; const b = [Math.min(rc[0], rc[2]), Math.min(rc[1], rc[3]), Math.max(rc[0], rc[2]), Math.max(rc[1], rc[3])]; return areas.some((a) => protOverlap(a.box, b)) && String(d.lookup(PDFName.of('Subtype'))) !== '/Redact'; });
  node.delete(PDFName.of('Thumb'));
  // 2. The page's content, rewritten without what's under the redactions
  node.normalize && node.normalize();
  const page = await pageOf(entry); let cm = null; try { cm = await contentMap(page); } catch {}
  const st = { L, out, cm, page, areas };
  const raw = node.get(PDFName.of('Contents')), rc = raw && out.context.lookup(raw);
  const parts = rc instanceof PDFArray ? rc.asArray() : raw ? [raw] : [];
  const src = parts.map((r) => { const s0 = out.context.lookup(r); return s0 ? protStreamText(L, s0) : ''; }).join('\n');
  const res = protCloneRes(L, out, node.Resources());
  node.set(PDFName.of('Resources'), res);
  const nsrc = await protRewrite(st, src, res, [1, 0, 0, 1, 0, 0], 0);
  // 3. Drawings under the redactions are clipped out (each area cut out of the page in turn).
  const f = protNum;
  let pre = 'q\n';
  for (const { q } of areas) pre += `-100000 -100000 m 100000 -100000 l 100000 100000 l -100000 100000 l h ${f(q[0][0])} ${f(q[0][1])} m ${q.slice(1).map((pt) => `${f(pt[0])} ${f(pt[1])} l`).join(' ')} h W* n\n`;
  node.set(PDFName.of('Contents'), out.context.obj([pre, nsrc, '\nQ\n'].map((s) => out.context.register(out.context.flateStream(protBytes(s))))));
  // pdf-lib writes later drawing into a new stream after these.
  p.contentStream = undefined; p.contentStreamRef = undefined;
  // 4. The boxes, and their text
  const O = (name, args = []) => PDFOperator.of(name, args), N = (n) => PDFNumber.of(+protNum(n));
  for (const { q, fill } of areas) p.pushOperators(O('q'), O('rg', protRgb(fill).map(N)), O('m', q[0].map(N)), ...q.slice(1).map((pt) => O('l', pt.map(N))), O('h'), O('f'), O('Q'));
  for (const { box: b, fill, label } of areas) {
    if (!label) continue;
    const font = ctx.protHelv || (ctx.protHelv = await out.embedFont(StandardFonts.Helvetica));
    const rot = protAlong(b), w = rot ? b[3] - b[1] : b[2] - b[0], h = rot ? b[2] - b[0] : b[3] - b[1], size = protLabelSize(label, w, h);
    let text = label; try { font.encodeText(text); } catch { text = label.replace(/[^\x20-\x7E]/g, '?'); }
    const tw = font.widthOfTextAtSize(text, size), a = rot * Math.PI / 180, right = [Math.cos(a), Math.sin(a)], up = [-Math.sin(a), Math.cos(a)];
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, x = cx - right[0] * tw / 2 - up[0] * size * .35, y = cy - right[1] * tw / 2 - up[1] * size * .35;
    p.drawText(text, { x, y, size, font, color: protDark(fill) ? rgb(1, 1, 1) : rgb(0, 0, 0), rotate: degrees(rot) });
  }
});
// Everything no longer used (the content and pictures redactions replaced, deleted comments) is left out of the file.
function protCollectGarbage(L, out) {
  const { PDFRef, PDFDict, PDFArray } = L;
  const seen = new Set(), stack = [];
  const visit = (o) => {
    if (!o) return;
    if (o instanceof PDFRef) { if (seen.has(o.tag)) return; seen.add(o.tag); const t = out.context.lookup(o); if (t) stack.push(t); return; }
    if (o instanceof PDFDict) { for (const [, v] of o.entries()) visit(v); return; }
    if (o instanceof PDFArray) { for (const v of o.asArray()) visit(v); return; }
    if (o.dict instanceof PDFDict) visit(o.dict);
  };
  const t = out.context.trailerInfo; visit(t.Root); visit(t.Info); visit(t.Encrypt);
  while (stack.length) visit(stack.pop());
  let n = 0;
  for (const [ref] of out.context.enumerateIndirectObjects()) if (!seen.has(ref.tag)) { out.context.delete(ref); n++; }
  return n;
}

/* ----- flatten ----- */
function protFormsLocked(v) {
  const s = protDM('protflatten'), lock = !!(s && s.forms);
  for (const el of v.el.querySelectorAll('.annotationLayer input, .annotationLayer textarea, .annotationLayer select')) {
    if (lock && !el.disabled) { el.disabled = true; el.dataset.protLocked = '1'; }
    else if (!lock && el.dataset.protLocked) { el.disabled = false; delete el.dataset.protLocked; }
  }
}
function protFlattenPage(L, out, p, opt) {
  const { PDFName, PDFArray, PDFDict, PDFRef, PDFStream, PDFNumber, PDFOperator } = L;
  const node = p.node, annots = node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return 0;
  const O = (name, args = []) => PDFOperator.of(name, args), N = (n) => PDFNumber.of(+protNum(n));
  let left = 0; const draw = [];
  protDropAnnots(L, out, node, (d, sub) => {
    if (sub === 'Link' || sub === 'Redact') return false;
    if (sub === 'Widget' ? !opt.forms : !opt.comments) return false;
    const F = d.lookup(PDFName.of('F')), flags = F instanceof PDFNumber ? F.asNumber() : 0;
    if (flags & (2 | 32)) return true; // hidden: nothing to draw
    const rc = protNums(out, d.lookup(PDFName.of('Rect'))); if (!rc) return true;
    const rect = [Math.min(rc[0], rc[2]), Math.min(rc[1], rc[3]), Math.max(rc[0], rc[2]), Math.max(rc[1], rc[3])];
    const ap = d.lookup(PDFName.of('AP')), nRaw = ap instanceof PDFDict ? ap.get(PDFName.of('N')) : null;
    let apRef = nRaw, apObj = nRaw && out.context.lookup(nRaw);
    if (apObj instanceof PDFDict && !(apObj instanceof PDFStream)) { const as = d.get(PDFName.of('AS')); apRef = as ? apObj.get(as) : null; apObj = apRef && out.context.lookup(apRef); }
    if (apObj instanceof PDFStream) { draw.push({ apRef, apObj, rect }); return true; }
    if (ap) return true; // an appearance for another state (a box not ticked): nothing shows
    if (sub === 'Text') { draw.push({ note: true, rect }); return true; }
    if (sub === 'Widget') return true;
    left++; return false; // no appearance to draw: it stays a comment
  });
  for (const it of draw) {
    const [x0, y0, x1, y1] = it.rect;
    if (it.note) {
      const s = Math.min(20, x1 - x0 || 20, y1 - y0 || 20), y = y1 - s;
      p.pushOperators(O('q'), O('rg', [1, .83, .23].map(N)), O('RG', [.72, .54, 0].map(N)), O('w', [N(.8)]), O('re', [x0, y, s, s].map(N)), O('B'),
        O('RG', [.42, .31, 0].map(N)), O('w', [N(1.2)]), ...[.35, .55, .75].flatMap((k, j) => [O('m', [N(x0 + s * .25), N(y + s * (1 - k))]), O('l', [N(x0 + s * (j === 2 ? .6 : .75)), N(y + s * (1 - k))])]), O('S'), O('Q'));
      continue;
    }
    const dict = it.apObj.dict;
    if (!dict.has(PDFName.of('Subtype'))) { dict.set(PDFName.of('Type'), PDFName.of('XObject')); dict.set(PDFName.of('Subtype'), PDFName.of('Form')); }
    const bb = protNums(out, dict.lookup(PDFName.of('BBox'))); if (!bb) continue;
    const mt = dict.lookup(PDFName.of('Matrix')), M = (mt && protNums(out, mt)) || [1, 0, 0, 1, 0, 0];
    const tb = quadBox([[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]].map(([x, y]) => apply(M, x, y)));
    if (tb[2] - tb[0] < 1e-6 || tb[3] - tb[1] < 1e-6) continue;
    const sx = (x1 - x0) / (tb[2] - tb[0]), sy = (y1 - y0) / (tb[3] - tb[1]);
    const ref = it.apRef instanceof PDFRef ? it.apRef : out.context.register(it.apObj);
    const key = node.newXObject('CPDFFlat', ref);
    p.pushOperators(O('q'), O('cm', [sx, 0, 0, sy, x0 - tb[0] * sx, y0 - tb[1] * sy].map(N)), O('Do', [key]), O('Q'));
  }
  return left;
}

/* ----- remove hidden information ----- */
function protClean(L, out, pages, opt) {
  const { PDFName, PDFDict, PDFArray, PDFRef } = L, N = PDFName.of, cat = out.catalog;
  const names = cat.lookup(N('Names'));
  if (opt.metadata) {
    const info = out.context.lookup(out.context.trailerInfo.Info);
    if (info instanceof PDFDict) for (const k of info.keys()) info.delete(k);
    cat.delete(N('Metadata')); cat.delete(N('PieceInfo'));
    for (const p of pages) { p.node.delete(N('Metadata')); p.node.delete(N('PieceInfo')); }
    // The title, producer and dates the app would add next are left out too.
    for (const f of ['setTitle', 'setAuthor', 'setSubject', 'setKeywords', 'setProducer', 'setCreator', 'setCreationDate', 'setModificationDate']) out[f] = () => {};
  }
  if (opt.attachments) {
    if (names instanceof PDFDict) names.delete(N('EmbeddedFiles'));
    cat.delete(N('AF'));
    for (const p of pages) { p.node.delete(N('AF')); protDropAnnots(L, out, p.node, (d, sub) => sub === 'FileAttachment'); }
  }
  if (opt.javascript) {
    if (names instanceof PDFDict) names.delete(N('JavaScript'));
    const isJs = (o) => { const d = o instanceof PDFRef ? out.context.lookup(o) : o; return d instanceof PDFDict && /^\/(JavaScript|Rendition|Launch|ImportData|ResetForm|SubmitForm)$/.test(String(d.lookup(N('S')))); };
    const sweep = (d) => {
      d.delete(N('AA'));
      for (const k of ['A', 'OpenAction', 'Next']) { const v = d.get(N(k)); if (v && isJs(v)) d.delete(N(k)); }
    };
    sweep(cat);
    for (const [, o] of out.context.enumerateIndirectObjects()) if (o instanceof PDFDict) sweep(o);
    for (const p of pages) { sweep(p.node); const an = p.node.lookup(N('Annots')); if (an instanceof PDFArray) for (const r of an.asArray()) { const d = out.context.lookup(r); if (d instanceof PDFDict) sweep(d); } }
    const acro = cat.lookup(N('AcroForm')); if (acro instanceof PDFDict) acro.delete(N('XFA'));
  }
  if (opt.comments) for (const p of pages) protDropAnnots(L, out, p.node, (d, sub) => !['Widget', 'Link'].includes(sub));
}

/* ----- compress ----- */
async function protDecodeImage(L, out, s0) {
  const { PDFName, PDFArray, PDFNumber, PDFStream } = L, d = s0.dict, N = PDFName.of;
  const num = (k) => { const x = d.lookup(N(k)); return x instanceof PDFNumber ? x.asNumber() : null; };
  const W = num('Width'), H = num('Height'), bpc = num('BitsPerComponent');
  if (!W || !H || d.lookup(N('ImageMask')) && String(d.lookup(N('ImageMask'))) === 'true' || d.has(N('Decode'))) return null;
  let cs = d.lookup(N('ColorSpace')), comps = null;
  if (cs instanceof PDFArray && String(cs.lookup(0)) === '/ICCBased') { const icc = cs.lookup(1); const n = icc instanceof PDFStream && icc.dict.lookup(N('N')); comps = n instanceof PDFNumber ? n.asNumber() : null; }
  else comps = { '/DeviceRGB': 3, '/DeviceGray': 1, '/CalRGB': 3, '/CalGray': 1 }[String(cs)] || null;
  if (cs instanceof PDFArray && String(cs.lookup(0)) === '/CalRGB') comps = 3;
  if (comps !== 1 && comps !== 3) return null;
  const fl = d.lookup(N('Filter')), filters = fl instanceof PDFArray ? fl.asArray().map(String) : fl ? [String(fl)] : [];
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  if (filters.length === 1 && filters[0] === '/DCTDecode') {
    try { const bmp = await createImageBitmap(new Blob([s0.getContents()], { type: 'image/jpeg' })); g.drawImage(bmp, 0, 0, W, H); bmp.close && bmp.close(); return c; } catch { return null; }
  }
  if (bpc !== 8 || d.has(N('DecodeParms')) || !(filters.length === 0 || (filters.length === 1 && filters[0] === '/FlateDecode'))) return null;
  let raw; try { raw = filters.length ? L.decodePDFRawStream(s0).decode() : s0.getContents(); } catch { return null; }
  if (raw.length < W * H * comps) return null;
  const id = g.createImageData(W, H), px = id.data;
  for (let i = 0, n = W * H; i < n; i++) {
    if (comps === 3) { px[i * 4] = raw[i * 3]; px[i * 4 + 1] = raw[i * 3 + 1]; px[i * 4 + 2] = raw[i * 3 + 2]; } else px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = raw[i];
    px[i * 4 + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  return c;
}
const protCanvasJpeg = (c, q) => new Promise((res) => c.toBlob(async (b) => res(b ? new Uint8Array(await b.arrayBuffer()) : null), 'image/jpeg', q));
function protScaled(c, w, h) { const t = document.createElement('canvas'); t.width = w; t.height = h; const g = t.getContext('2d'); g.imageSmoothingQuality = 'high'; g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(c, 0, 0, w, h); return t; }
async function protCompress(L, out, pages, opt) {
  const { PDFName, PDFDict, PDFRawStream, PDFStream, PDFRef, PDFNumber } = L, N = PDFName.of;
  let images = 0;
  if (opt.dpi) {
    // The largest size each picture is drawn at, in points.
    const placed = new Map();
    const walk = (src, res, ctm0, depth) => {
      const xo = res && res.lookup(N('XObject')); if (!(xo instanceof PDFDict)) return;
      const { fontWidth } = pageFonts(L, out, { Resources: () => res });
      try {
        walkContent(src, fontWidth, null, (im) => {
          if (im.inline || !im.name) return;
          const ref = xo.get(N(im.name)), obj = xo.lookup(N(im.name)); if (!(ref instanceof PDFRef) || !(obj instanceof PDFStream)) return;
          const ctm = mul(im.ctm, ctm0), sub = String(obj.dict.lookup(N('Subtype')));
          if (sub === '/Image') { const w = Math.hypot(ctm[0], ctm[1]), h = Math.hypot(ctm[2], ctm[3]), was = placed.get(ref.tag); placed.set(ref.tag, { ref, w: Math.max(w, was ? was.w : 0), h: Math.max(h, was ? was.h : 0) }); }
          else if (sub === '/Form' && depth < 6) { const mt = obj.dict.lookup(N('Matrix')); const fr = obj.dict.lookup(N('Resources')); walk(protStreamText(L, obj), fr instanceof PDFDict ? fr : res, mul((mt && protNums(out, mt)) || [1, 0, 0, 1, 0, 0], ctm), depth + 1); }
        });
      } catch (e) { console.warn('compress: reading a page failed', e); }
    };
    for (const p of pages) {
      const raw = p.node.get(N('Contents')), rc = raw && out.context.lookup(raw);
      const parts = rc && rc.asArray && !(rc instanceof PDFStream) ? rc.asArray() : raw ? [raw] : [];
      walk(parts.map((r) => { const s0 = out.context.lookup(r); return s0 ? protStreamText(L, s0) : ''; }).join('\n'), p.node.Resources(), [1, 0, 0, 1, 0, 0], 0);
    }
    for (const { ref, w, h } of placed.values()) {
      const s0 = out.context.lookup(ref); if (!(s0 instanceof PDFRawStream)) continue;
      const W = s0.dict.lookup(N('Width')), H = s0.dict.lookup(N('Height')); if (!(W instanceof PDFNumber) || !(H instanceof PDFNumber) || w < 1 || h < 1) continue;
      const ppi = Math.min(W.asNumber() / (w / 72), H.asNumber() / (h / 72));
      if (ppi <= opt.dpi * 1.15) continue;
      const tw = Math.max(1, Math.round(w / 72 * opt.dpi)), tht = Math.max(1, Math.round(h / 72 * opt.dpi));
      const c = await protDecodeImage(L, out, s0); if (!c) continue;
      const jpg = await protCanvasJpeg(protScaled(c, tw, tht), opt.quality || .75);
      if (!jpg || jpg.length >= s0.getContents().length * .9) continue;
      const ns = out.context.stream(jpg, { Type: 'XObject', Subtype: 'Image', Width: tw, Height: tht, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' });
      for (const k of ['SMask', 'Intent', 'Interpolate', 'OC']) { const v = s0.dict.get(N(k)); if (v) ns.dict.set(N(k), v); }
      const mk = s0.dict.get(N('Mask')); if (mk instanceof PDFRef) ns.dict.set(N('Mask'), mk);
      // A soft mask (transparency) bigger than the new picture is made the same size.
      const sm = s0.dict.lookup(N('SMask'));
      if (sm instanceof PDFRawStream) {
        const smc = await protDecodeImage(L, out, sm), smRef = s0.dict.get(N('SMask'));
        const sW = sm.dict.lookup(N('Width')); if (smc && smRef instanceof PDFRef && sW instanceof PDFNumber && sW.asNumber() > tw) {
          const g = protScaled(smc, tw, tht).getContext('2d').getImageData(0, 0, tw, tht).data, gray = new Uint8Array(tw * tht);
          for (let i = 0; i < gray.length; i++) gray[i] = g[i * 4];
          out.context.assign(smRef, out.context.flateStream(gray, { Type: 'XObject', Subtype: 'Image', Width: tw, Height: tht, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }));
        }
      }
      out.context.assign(ref, ns); images++;
    }
  }
  // Streams stored without compression are compressed.
  for (const [ref, o] of out.context.enumerateIndirectObjects()) {
    if (!(o instanceof PDFRawStream) || o.dict.has(N('Filter'))) continue;
    if (/^\/(Metadata|XRef|ObjStm)$/.test(String(o.dict.lookup(N('Type')) || '')) || o.getContents().length < 64) continue;
    const ns = out.context.flateStream(o.getContents(), {});
    for (const [k, v] of o.dict.entries()) if (k.asString() !== '/Length') ns.dict.set(k, v);
    out.context.assign(ref, ns);
  }
  // Saved with object streams (smaller cross-reference data, many small objects packed together).
  const save = out.save.bind(out); out.save = (o = {}) => save({ useObjectStreams: true, ...o });
  return images;
}

/* ----- passwords and permissions ----- */
// The password settings that apply now: one set here (while its passwords are in memory), or "remove".
function protSec() {
  if (!doc) return null;
  const m = docMarks().find((x) => x.type === 'protsec');
  if (!m) return null;
  if (m.mode === 'remove') return m;
  return protSecrets.has(m.id) ? m : null;
}
// Restrictions on a PDF that opened without a password are kept: only its author can lift them.
async function protLockedFlags() {
  let flags = null;
  for (const k of protUsedSources()) {
    if (doc.sources[k].password) continue;
    try { const f = await pdfDocs.get(k).getPermissions(); if (f) flags = flags ? flags.filter((x) => f.includes(x)) : [...f]; } catch {}
  }
  return flags;
}
// Saving asks whether to keep a PDF's own password; a password set or removed here answers that question.
FEATURE.onDocShown.push((d) => {
  let stored = d.keepPassword;
  try {
    Object.defineProperty(d, 'keepPassword', { configurable: true, enumerable: false,
      get() { if (doc === d && protSec()) return false; if (stored == null && protMeasuring) return true; return stored; },
      set(v) { stored = v; } });
  } catch {}
});
async function protPassword() {
  const cur = protSec(), old = cur && cur.mode === 'set' ? cur : null, sec = old ? protSecrets.get(old.id) : null;
  const pm = (old && old.perms) || { print: true, copy: false, edit: false, comment: true, forms: true };
  const locked = await protLockedFlags();
  let err = '', vals = { useOpen: old ? !!old.open : true, limit: old ? !!old.limit : false, open: sec ? sec.open : '', open2: sec ? sec.open : '', owner: sec ? sec.owner : '', ...pm };
  for (;;) {
    const ck = (n, label, note) => `<label class="prot-check"><input type="checkbox" name="${n}"${vals[n] ? ' checked' : ''}><span>${label}${note ? `<small>${note}</small>` : ''}</span></label>`;
    const r = await protAsk('Set password', `${err ? `<p class="prot-err" role="alert">${esc(err)}</p>` : ''}
      <div class="prot-checks">${ck('useOpen', 'Require a password to open the PDF')}</div>
      <div class="prot-sub prot-row" data-show="useOpen"${vals.useOpen ? '' : ' hidden'}>
        <label class="field"><span>Open password</span><input name="open" type="password" autocomplete="new-password" value="${esc(vals.open)}"></label>
        <label class="field"><span>Type it again</span><input name="open2" type="password" autocomplete="new-password" value="${esc(vals.open2)}"></label></div>
      <div class="prot-checks">${ck('limit', 'Limit printing, copying and changes', 'A permissions password is needed to lift the limits.')}</div>
      <div class="prot-sub" data-show="limit"${vals.limit ? '' : ' hidden'}>
        <label class="field"><span>Permissions password</span><input name="owner" type="password" autocomplete="new-password" value="${esc(vals.owner)}"></label>
        <div class="prot-checks">${ck('print', 'Allow printing')}${ck('copy', 'Allow copying text and pictures')}${ck('edit', 'Allow changes to pages and content')}${ck('comment', 'Allow comments')}${ck('forms', 'Allow filling in forms')}</div></div>
      ${locked ? '<p style="font-size:12px">This PDF’s author limited what it allows. Those limits stay.</p>' : ''}
      <p style="font-size:12px">Passwords are used when you save. They are not kept on this device.</p>`,
    [{ label: 'Cancel' }, { label: 'Set password', value: 'set', primary: true }], (dlg) => {
      const b = $('.dlg-body', dlg);
      b.addEventListener('change', (e) => { const sub = e.target.name && $(`[data-show="${e.target.name}"]`, b); if (sub) sub.hidden = !e.target.checked; });
    });
    if (!r || r.action !== 'set') return;
    vals = r;
    if (!r.useOpen && !r.limit) err = 'Choose an open password, limits, or both.';
    else if (r.useOpen && !r.open) err = 'Type an open password.';
    else if (r.useOpen && r.open !== r.open2) err = 'The two open passwords are different.';
    else if (r.limit && !r.owner) err = 'Type a permissions password.';
    else if (r.limit && r.useOpen && r.owner === r.open) err = 'Use a permissions password that is different from the open password.';
    else break;
  }
  const perms = { print: !!vals.print, copy: !!vals.copy, edit: !!vals.edit, comment: !!vals.comment, forms: !!vals.forms };
  const before = snapshot(), list = docMarks();
  for (let k = list.length - 1; k >= 0; k--) if (list[k].type === 'protsec') list.splice(k, 1);
  const m = { id: uid(), type: 'protsec', mode: 'set', open: !!vals.useOpen, limit: !!vals.limit, perms: vals.limit ? perms : null };
  protSecrets.set(m.id, { open: vals.useOpen ? vals.open : '', owner: vals.limit ? vals.owner : '' });
  list.push(m); changed(before);
  toast(vals.useOpen ? 'Password set. Save the PDF to protect it.' : 'Limits set. Save the PDF to apply them.');
}
async function protRemoveSecurity() {
  const pwd = protUsedSources().some((k) => doc.sources[k].password), mine = docMarks().some((m) => m.type === 'protsec' && m.mode === 'set');
  if (!pwd && !mine) {
    toast((await protLockedFlags()) ? 'This PDF’s limits were set by its author and stay' : 'This PDF has no password');
    return;
  }
  const before = snapshot(), list = docMarks();
  for (let k = list.length - 1; k >= 0; k--) if (list[k].type === 'protsec') list.splice(k, 1);
  if (pwd) list.push({ id: uid(), type: 'protsec', mode: 'remove' });
  changed(before);
  toast(pwd ? 'Security removed. Save the PDF to keep it without a password.' : 'Password removed');
}
async function protEncrypt(L, out) {
  const m = protSec();
  const stale = !m && doc && docMarks().some((x) => x.type === 'protsec' && x.mode === 'set');
  if (stale) toast('The password set earlier was not kept on this device. Set it again to protect the PDF.');
  if (!m || !out.encrypt) return;
  if (m.mode === 'set') {
    const s = protSecrets.get(m.id), pm = m.perms || { print: true, copy: true, edit: true, comment: true, forms: true };
    const flags = await protLockedFlags(), F = pdfjs.PermissionFlag || {}, can = (f) => !flags || flags.includes(f);
    const permissions = {
      printing: pm.print && can(F.PRINT) ? (can(F.PRINT_HIGH_QUALITY) ? 'highResolution' : 'lowResolution') : false,
      modifying: pm.edit && can(F.MODIFY_CONTENTS), copying: pm.copy && can(F.COPY), annotating: pm.comment && can(F.MODIFY_ANNOTATIONS),
      fillingForms: (pm.forms || pm.comment) && can(F.FILL_INTERACTIVE_FORMS), contentAccessibility: can(F.COPY_FOR_ACCESSIBILITY), documentAssembly: pm.edit && can(F.ASSEMBLE),
    };
    const owner = s.owner || (flags ? uid() + uid() : s.open || uid() + uid());
    out.encrypt({ userPassword: s.open || '', ownerPassword: owner, permissions });
  }
  // This choice wins: the app doesn't encrypt again with the original's settings.
  out.encrypt = () => {};
}

/* ----- the save step for the document-wide settings ----- */
FEATURE.saveDoc.push(async ({ L, out, pages, ctx }) => {
  const fl = protDM('protflatten');
  if (fl && (fl.forms || fl.comments)) {
    let left = 0; for (const p of pages) left += protFlattenPage(L, out, p, fl);
    if (fl.forms) { out.catalog.delete(L.PDFName.of('AcroForm')); try { out.formCache && out.formCache.invalidate && out.formCache.invalidate(); } catch {} }
    ctx.protFlattenLeft = left;
  }
  const cl = protDM('protclean');
  if (cl) protClean(L, out, pages, cl);
  const cp = protCompressOverride || protDM('protcompress');
  if (ctx.protRedacted || cl || fl || (cp && !cp.off)) protCollectGarbage(L, out);
  if (cp && !cp.off) { await protCompress(L, out, pages, cp); protCollectGarbage(L, out); }
  await protEncrypt(L, out);
});

/* ----- dialogs for the document-wide settings ----- */
async function protFlatten() {
  const cur = protDM('protflatten');
  const r = await protAsk('Flatten pages', `<p>Comments and form fields become part of the page when you save, so they look the same everywhere and can no longer be changed.</p>
    <div class="prot-checks">
      <label class="prot-check"><input type="checkbox" name="comments"${!cur || cur.comments ? ' checked' : ''}> Comments and notes</label>
      <label class="prot-check"><input type="checkbox" name="forms"${!cur || cur.forms ? ' checked' : ''}> Form fields</label>
    </div>`, [...(cur ? [{ label: 'Don’t flatten', value: 'off' }] : []), { label: 'Cancel' }, { label: 'Flatten', value: 'on', primary: true }]);
  if (!r || !r.action) return;
  if (r.action === 'off' || (!r.comments && !r.forms)) { protSetDM('protflatten', null); toast('Nothing will be flattened'); }
  else { protSetDM('protflatten', { comments: !!r.comments, forms: !!r.forms }); toast(`${r.comments && r.forms ? 'Comments and form fields' : r.forms ? 'Form fields' : 'Comments'} will be flattened when you save`); }
  views.forEach((v) => v.rendered && protFormsLocked(v));
}
async function protClean_() {
  const cur = protDM('protclean');
  const ck = (n, label, note, on) => `<label class="prot-check"><input type="checkbox" name="${n}"${(cur ? cur[n] : on) ? ' checked' : ''}><span>${label}<small>${note}</small></span></label>`;
  const r = await protAsk('Remove hidden information', `<p>Chosen items are removed when you save.</p><div class="prot-checks">
      ${ck('metadata', 'Document properties and metadata', 'Title, author, the app that made it, dates and keywords.', true)}
      ${ck('attachments', 'Attached files', 'Files embedded in the PDF.', true)}
      ${ck('javascript', 'Scripts and actions', 'JavaScript, and actions that run on opening or on clicks.', true)}
      ${ck('comments', 'Comments', 'Notes and mark-up from other apps.', false)}</div>`,
  [...(cur ? [{ label: 'Keep everything', value: 'off' }] : []), { label: 'Cancel' }, { label: 'Remove', value: 'on', primary: true }]);
  if (!r || !r.action) return;
  const pick = { metadata: !!r.metadata, attachments: !!r.attachments, javascript: !!r.javascript, comments: !!r.comments };
  if (r.action === 'off' || !Object.values(pick).some(Boolean)) { protSetDM('protclean', null); toast('Nothing will be removed'); return; }
  protSetDM('protclean', pick); toast('Hidden information will be removed when you save');
}
// Builds the PDF as it would be saved (with a compression choice), to tell its size.
let protMeasureChain = Promise.resolve();
function protMeasure(opt) {
  const run = async () => {
    protCompressOverride = opt; protMeasuring = true;
    try { const b = await buildPdf(); return b ? b.length : null; }
    finally { protCompressOverride = null; protMeasuring = false; }
  };
  const p = protMeasureChain.then(run, run); protMeasureChain = p.catch(() => {}); return p;
}
const PROT_LEVELS = { keep: { dpi: 0, quality: .8 }, 150: { dpi: 150, quality: .75 }, 96: { dpi: 96, quality: .6 } };
async function protCompressDlg() {
  const cur = protDM('protcompress'), level = cur ? (cur.dpi ? String(cur.dpi) : 'keep') : '150';
  const radio = (v, label, note) => `<label class="prot-check"><input type="radio" name="level" value="${v}"${level === v ? ' checked' : ''}><span>${label}<small>${note}</small></span></label>`;
  let before = null;
  const r = await protAsk('Compress', `<p>Makes the PDF smaller when you save: pictures larger than needed are made smaller, and the file is packed more tightly.</p>
    <div class="prot-checks">${radio('150', 'Balanced', 'Pictures at 150 pixels per inch: good on screen and in print.')}${radio('96', 'Smallest', 'Pictures at 96 pixels per inch: good on screen.')}${radio('keep', 'Keep pictures as they are', 'Only the file is packed.')}</div>
    <div class="prot-size" id="protSize" aria-live="polite">Working out the size…</div>`,
  [...(cur ? [{ label: 'Don’t compress', value: 'off' }] : []), { label: 'Cancel' }, { label: 'Compress', value: 'on', primary: true }], (dlg, upd) => {
    const out = $('#protSize', dlg); let ask = 0, tried = false;
    const show = async () => {
      const n = ++ask, lv = ($('input[name=level]:checked', dlg) || {}).value || '150';
      out.textContent = 'Working out the size…';
      try {
        if (before == null) before = await protMeasure({ off: true });
        const after = await protMeasure(PROT_LEVELS[lv]);
        if (n !== ask) return;
        if (before == null || after == null) { out.textContent = 'The size can’t be worked out.'; return; }
        const pc = Math.round((1 - after / before) * 100), none = after >= before * .98;
        // Balanced gains next to nothing: once, see whether Smallest does better and choose it if so.
        if (none && lv === '150' && !tried) {
          tried = true;
          const small = await protMeasure(PROT_LEVELS['96']);
          if (n !== ask) return;
          if (small != null && small <= before * .95) {
            const r96 = $('input[name=level][value="96"]', dlg); r96.checked = true; upd();
            if (document.activeElement && document.activeElement.name === 'level') r96.focus();
            const spc = Math.round((1 - small / before) * 100);
            out.textContent = `Now ${protSize(before)}. Balanced would save less than 2%. Smallest saves ${spc}% (${protSize(small)}), so it is selected.`;
            out.dataset.before = before; out.dataset.after = small; out.classList.remove('none');
            return;
          }
        }
        // Compress stays the main button; the note says how little it would gain.
        out.textContent = none
          ? `Now ${protSize(before)}. This PDF is already compact: compressing would save less than 2%.`
          : `Now ${protSize(before)}. Compressed: ${protSize(after)} (${pc}% smaller).`;
        out.dataset.before = before; out.dataset.after = after; out.classList.toggle('none', none);
      } catch (e) { console.warn(e); if (n === ask) out.textContent = 'The size can’t be worked out.'; }
    };
    $$('input[name=level]', dlg).forEach((x) => x.addEventListener('change', show));
    show();
  });
  if (!r || !r.action) return;
  if (r.action === 'off') { protSetDM('protcompress', null); toast('The PDF won’t be compressed'); return; }
  protSetDM('protcompress', { ...PROT_LEVELS[r.level || '150'], level: r.level || '150' });
  toast('The PDF will be compressed when you save');
}

/* ----- commands and ribbon ----- */
const protHasPending = () => protRedMarks(false).length > 0;
cmd('protRedText', { label: 'Mark text', icon: 'text-select', enabled: has, pressed: () => app.dataset.tool === 'protredtext', run: () => { if (protMarkSelection()) return; setTool('protredtext'); toast('Select the text to redact'); } });
cmd('protRedArea', { label: 'Mark area', icon: 'box-select', enabled: has, pressed: () => app.dataset.tool === 'protredarea', run: () => { setTool('protredarea'); toast('Drag over the area to redact'); } });
cmd('protRedSearch', { label: 'Search and redact…', icon: 'search-check', enabled: has, run: protSearch });
cmd('protRedApply', { label: 'Apply redactions…', icon: 'file-check-2', enabled: () => has() && protHasPending(), run: protApply });
cmd('protPassword', { label: 'Set password…', icon: 'lock', enabled: has, pressed: () => !!(protSec() && protSec().mode === 'set'), run: protPassword });
// Only when there is a password to remove: one the PDF came with, or one set here.
cmd('protUnsecure', { label: 'Remove security', icon: 'lock-open', enabled: () => has() && (protUsedSources().some((k) => doc.sources[k].password) || docMarks().some((m) => m.type === 'protsec' && m.mode === 'set')), run: protRemoveSecurity });
cmd('protFlatten', { label: 'Flatten pages…', tip: 'Flatten pages: make comments and form fields part of the page content when you save, so they can no longer be changed', icon: 'layers', enabled: has, pressed: () => !!protDM('protflatten'), run: protFlatten });
cmd('protCompress', { label: 'Compress…', icon: 'shrink', enabled: has, pressed: () => !!protDM('protcompress'), run: protCompressDlg });
cmd('protClean', { label: 'Remove hidden info…', icon: 'eye-off', enabled: has, pressed: () => !!protDM('protclean'), run: protClean_ });
ribbonAdd('protect', 'Redact', ['protRedText', 'protRedArea', 'protRedSearch', 'protRedApply']);
ribbonAdd('protect', 'Security', ['protPassword', 'protUnsecure']);
ribbonAdd('protect', 'Document', ['protFlatten', 'protCompress', 'protClean']);
menuAdd('Protect', ['protRedText', 'protRedArea', 'protRedSearch', 'protRedApply']);
menuAdd('Protect', ['protPassword', 'protUnsecure']);
menuAdd('Protect', ['protFlatten', 'protCompress', 'protClean']);
TEST_HOOKS.protFind = async (opts) => (await protFind(protRegex(opts))).map((f) => f.text);
TEST_HOOKS.protFindQuads = async (opts) => (await protFind(protRegex(opts))).map((f) => f.quads);
TEST_HOOKS.protMeasure = (opt) => protMeasure(opt);
