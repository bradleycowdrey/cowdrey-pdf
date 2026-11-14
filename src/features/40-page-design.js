/* ---------------- page design: watermark, background, header & footer, Bates numbering ----------------
   Document-wide settings kept in docMarks() as { id, rev, type: 'pd_watermark' | 'pd_background' | 'pd_headfoot' |
   'pd_bates', … }. One layout function (pdLayout) places them on a page as the reader sees it (points, origin at the
   bottom left, y up, after rotation). The screen draws that layout as SVG under and over the page; saving maps it
   into the page's own coordinates and draws it with pdf-lib, behind the content (a stream put first) or in front.
   Page numbers follow page n of the saved file, so they follow reordering and extraction. */
const PD_TYPES = { pd_background: 'Background', pd_watermark: 'Watermark', pd_headfoot: 'Header & footer', pd_bates: 'Bates numbering' };
const PD_ICONS = { pd_background: 'paint-roller', pd_watermark: 'droplets', pd_headfoot: 'panel-top', pd_bates: 'hash' };
const PD_ORDER = ['pd_background', 'pd_watermark', 'pd_headfoot', 'pd_bates'];
const PD_SLOTS = [['tl', 'Top left'], ['tc', 'Top centre'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['bc', 'Bottom centre'], ['br', 'Bottom right']];
const PD_FONTS = [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']];
const PD_MM = 72 / 25.4;
const PD_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PD_DATES = ['d mmmm yyyy', 'mmmm d, yyyy', 'dd/mm/yyyy', 'mm/dd/yyyy', 'yyyy-mm-dd', 'd/m/yy'];
// Characters the standard PDF fonts can write (WinAnsi); anything else shows as "?" on screen and in the file.
const PD_ANSI = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const pdClean = (s) => [...String(s)].map((c) => { const k = c.codePointAt(0); return (k >= 32 && k <= 126) || (k >= 160 && k <= 255) || PD_ANSI.includes(c) ? c : '?'; }).join('');
const pdDefaults = {
  pd_watermark: () => ({ kind: 'text', text: 'CONFIDENTIAL', font: 'sans', bold: true, size: 64, color: '#E03131', scale: 50, opacity: 30, rotation: 45, layout: 'center', front: 'front', range: '' }),
  pd_background: () => ({ kind: 'color', color: '#FFF3BF', fit: 'stretch', opacity: 100, range: '' }),
  pd_headfoot: () => ({ tl: '', tc: '', tr: '', bl: '', bc: 'Page <<page>> of <<pages>>', br: '', font: 'sans', bold: false, size: 10, color: '#333333', dateFmt: 'd mmmm yyyy', mTop: 12, mBottom: 12, mSide: 18, start: 1, range: '' }),
  pd_bates: () => ({ prefix: 'ABC', start: 1, digits: 6, suffix: '', slot: 'br', font: 'sans', bold: false, size: 10, color: '#111111', mTop: 12, mBottom: 12, mSide: 18, range: '' }),
};
const pdLastUsed = {};

function pdItems() { return doc ? docMarks().filter((m) => PD_TYPES[m.type]).sort((a, b) => PD_ORDER.indexOf(a.type) - PD_ORDER.indexOf(b.type)) : []; }
// The pages (0-based, in order) an item is on, out of N.
function pdPages(m, N) { return m.range && m.range.trim() ? parseRange(m.range, N).sort((a, b) => a - b) : [...Array(N).keys()]; }
function pdDate(fmt, d = new Date()) {
  const D = d.getDate(), M = d.getMonth() + 1, Y = d.getFullYear(), p2 = (x) => String(x).padStart(2, '0');
  return fmt.replace(/yyyy|yy|mmmm|mm|m|dd|d/g, (t) => ({ yyyy: Y, yy: p2(Y % 100), mmmm: PD_MONTHS[M - 1], mm: p2(M), m: M, dd: p2(D), d: D }[t]));
}
const pdBates = (m, num) => `${m.prefix || ''}${String(num).padStart(Math.max(1, Math.min(12, m.digits | 0)), '0')}${m.suffix || ''}`;
// A place in a header's text moved out of any field it falls inside (to the field's end).
function pdOutside(s, at) { for (const mt of String(s).matchAll(/<<[^<>]*>>/g)) if (at > mt.index && at < mt.index + mt[0].length) return mt.index + mt[0].length; return at; }
// Text with a broken field in it ("<<pa<<page>>ge>>"): what is left of << or >> once the real fields are taken out.
const pdBroken = (s) => /<<|>>/.test(String(s || '').replace(/<<\s*(pages|page|date)\s*>>/gi, ''));
function pdTokens(s, page, pages, date) { return String(s).replace(/<<\s*(pages|page|date)\s*>>/gi, (_, t) => ({ page, pages, date }[t.toLowerCase()])); }

// Centres for a tiled watermark: a grid turned with the watermark, rows offset by half a step, covering the page.
function pdTiles(W, H, a, stepX, stepY, reach) {
  const out = [], c = Math.cos(a), s = Math.sin(a), R = Math.hypot(W, H) / 2 + Math.max(stepX, stepY);
  for (let j = -Math.ceil(R / stepY); j <= Math.ceil(R / stepY); j++) for (let i = -Math.ceil(R / stepX) - 1; i <= Math.ceil(R / stepX); i++) {
    const u = i * stepX + (j & 1 ? stepX / 2 : 0), w = j * stepY, cx = W / 2 + c * u - s * w, cy = H / 2 + s * u + c * w;
    if (cx > -reach && cx < W + reach && cy > -reach && cy < H + reach) out.push([cx, cy]);
  }
  return out;
}
// What to draw on page n of N, a W×H page as seen: { under: [...], over: [...] } of
// { kind: 'rect' | 'text' | 'image', x, y (bottom left / baseline start), angle (degrees, anticlockwise), … }.
// `list` is the settings to draw (the document's, or a dialog's preview of them).
function pdLayout(n, N, W, H, measure, date = new Date(), list = pdItems()) {
  const under = [], over = [];
  for (const m of list) {
    const pages = pdPages(m, N), k = pages.indexOf(n);
    if (k < 0) continue;
    const op = Math.max(0, Math.min(100, m.opacity ?? 100)) / 100;
    if (m.type === 'pd_background') {
      if (m.kind === 'image' && m.data) {
        let w = W, h = H;
        if (m.fit === 'fit') { const r = Math.min(W / m.iw, H / m.ih); w = m.iw * r; h = m.ih * r; }
        under.push({ kind: 'image', data: m.data, x: (W - w) / 2, y: (H - h) / 2, w, h, angle: 0, opacity: op });
      } else under.push({ kind: 'rect', x: 0, y: 0, w: W, h: H, color: m.color, opacity: op, angle: 0 });
    } else if (m.type === 'pd_watermark') {
      const to = m.front === 'behind' ? under : over;
      const a = (+m.rotation || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      let w, h, item;
      if (m.kind === 'image') {
        if (!m.data) continue;
        w = W * Math.max(1, +m.scale || 50) / 100; h = w * m.ih / m.iw;
        item = (cx, cy) => ({ kind: 'image', data: m.data, x: cx - c * w / 2 + s * h / 2, y: cy - s * w / 2 - c * h / 2, w, h, angle: +m.rotation || 0, opacity: op });
      } else {
        const text = pdClean(m.text || ''), size = Math.max(1, +m.size || 48);
        if (!text.trim()) continue;
        w = measure(text, m.font, m.bold, size); h = size * .7;
        item = (cx, cy) => ({ kind: 'text', text, x: cx - c * w / 2 + s * h / 2, y: cy - s * w / 2 - c * h / 2, angle: +m.rotation || 0, size, font: m.font, bold: !!m.bold, color: m.color, opacity: op });
      }
      const centres = m.layout === 'tile' ? pdTiles(W, H, a, m.kind === 'image' ? w * 1.4 : w + h * 3, m.kind === 'image' ? h * 1.6 : h * 4.5, Math.hypot(w, h) / 2) : [[W / 2, H / 2]];
      for (const [cx, cy] of centres) to.push(item(cx, cy));
    } else {
      const size = Math.max(1, +m.size || 10), slots = {};
      if (m.type === 'pd_headfoot') {
        const first = Math.round(+m.start || 1), date0 = pdDate(m.dateFmt || PD_DATES[0], date);
        for (const [s] of PD_SLOTS) if (m[s]) slots[s] = pdTokens(m[s], first + k, first + pages.length - 1, date0);
      } else slots[m.slot || 'br'] = pdBates(m, Math.max(0, Math.round(+m.start || 0)) + k);
      for (const [s, raw] of Object.entries(slots)) {
        const text = pdClean(raw); if (!text.trim()) continue;
        const tw = measure(text, m.font, m.bold, size), side = (+m.mSide || 0) * PD_MM;
        const x = s[1] === 'l' ? side : s[1] === 'r' ? W - side - tw : (W - tw) / 2;
        const y = s[0] === 't' ? H - (+m.mTop || 0) * PD_MM - size * .75 : (+m.mBottom || 0) * PD_MM + size * .22;
        over.push({ kind: 'text', text, x, y, angle: 0, size, font: m.font, bold: !!m.bold, color: m.color, opacity: 1 });
      }
    }
  }
  return { under, over };
}

/* on screen */
let pdCanvas;
function pdMeasure(text, fam, bold, size) {
  const g = (pdCanvas ||= document.createElement('canvas')).getContext('2d');
  g.font = `${bold ? 'bold ' : ''}${size}px ${cssFamily(fam || 'sans')}`;
  return g.measureText(text).width;
}
function pdSvg(v, cls) {
  let s = v.el.querySelector('svg.' + cls);
  if (!s) { s = svgEl('svg', { class: 'pd-layer ' + cls, 'aria-hidden': 'true' }); v.el.appendChild(s); }
  return s;
}
function pdPaint(svg, items, sc, H) {
  svg.innerHTML = '';
  for (const it of items) {
    const sx = it.x * sc, sy = (H - it.y) * sc, rot = it.angle ? `rotate(${-it.angle} ${sx} ${sy})` : '';
    let e;
    if (it.kind === 'rect') e = svgEl('rect', { x: sx, y: sy - it.h * sc, width: it.w * sc, height: it.h * sc, fill: it.color, 'fill-opacity': it.opacity });
    else if (it.kind === 'image') e = svgEl('image', { x: sx, y: sy - it.h * sc, width: it.w * sc, height: it.h * sc, href: it.data, preserveAspectRatio: 'none', opacity: it.opacity });
    else { e = svgEl('text', { x: sx, y: sy, 'font-size': it.size * sc, 'font-family': cssFamily(it.font || 'sans'), 'font-weight': it.bold ? 700 : 400, fill: it.color, 'fill-opacity': it.opacity }); e.textContent = it.text; }
    if (rot) e.setAttribute('transform', rot);
    svg.appendChild(e);
  }
}
function pdDrawView(v) {
  if (!doc || !v.rendered || !v.el.isConnected) return;
  const items = pdItems(), n = +v.el.dataset.n, N = doc.pages.length, today = pdDate('yyyy-mm-dd');
  const sig = [n, N, v.viewport.scale, v.viewport.rotation, today, ...items.map((m) => m.id + ':' + m.rev)].join('|');
  const had = v.el.querySelector('svg.pd-over');
  if (v.pdSig === sig && (had || !items.length)) return;
  v.pdSig = sig;
  if (!items.length) { $$('svg.pd-layer', v.el).forEach((e) => e.remove()); return; }
  const sc = v.viewport.scale, W = v.viewport.width / sc, H = v.viewport.height / sc;
  const { under, over } = pdLayout(n, N, W, H, pdMeasure);
  pdPaint(pdSvg(v, 'pd-under'), under, sc, H);
  pdPaint(pdSvg(v, 'pd-over'), over, sc, H);
  for (const s of $$('svg.pd-layer', v.el)) s.setAttribute('viewBox', `0 0 ${v.viewport.width} ${v.viewport.height}`);
}
function pdRefreshAll() { for (const v of views) pdDrawView(v); }
FEATURE.afterRender.push((v) => {
  v.pdSig = null; pdDrawView(v);
  // Undo and redo redraw a page's marks without drawing it again: follow the marks layer to stay in step.
  const marksSvg = v.el.querySelector('svg.marks');
  if (marksSvg && !marksSvg.pdWatch) { marksSvg.pdWatch = new MutationObserver(() => pdDrawView(v)); marksSvg.pdWatch.observe(marksSvg, { childList: true }); }
});
FEATURE.thumbLayers.push((v) => { v.pdSig = null; pdDrawView(v); }); // thumbnails show it too
addStyle(`
.pd-layer { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: hidden; }
.pd-layer text { white-space: pre; user-select: none; }
.pd-under { z-index: 1; mix-blend-mode: multiply; }
.pd-over { z-index: 5; }
.app[data-darkpage="on"] .pd-layer { filter: invert(.92) hue-rotate(180deg); }
.app[data-darkpage="on"] .pd-under { mix-blend-mode: screen; }
.pd-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px; }
.pd-form .pd-wide { grid-column: 1 / -1; }
.pd-form[hidden] { display: none; }
.pd-form .field { margin: 6px 0; min-width: 0; }
.pd-form .field > span, .pd-slots .field > span { font-size: 12px; color: var(--ink-3); }
.pd-slots .field { margin: 6px 0; min-width: 0; }
.pd-slots .field input { min-width: 0; width: 100%; box-sizing: border-box; padding: 7px 10px; }
.pd-slots .field input[aria-invalid="true"] { border-color: var(--danger); box-shadow: 0 0 0 1px var(--danger); }
.pd-err { font-size: 12px; color: var(--danger); margin: 0 0 6px; }
.pd-err[hidden] { display: none; }
.pd-form .field select, .pd-form .field input { font: inherit; color: var(--ink); background: var(--chrome); border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; min-width: 0; width: 100%; box-sizing: border-box; }
.pd-form .field input[type="color"] { padding: 2px 4px; height: 36px; cursor: pointer; }
.pd-form .field input[type="range"] { padding: 0; border: 0; background: none; accent-color: var(--accent); height: 36px; }
.pd-form .pd-check { flex-direction: row; align-items: center; gap: 8px; align-self: end; height: 36px; margin: 6px 0; color: var(--ink); }
.pd-form .pd-check input { width: auto; accent-color: var(--accent); }
.pd-seg { justify-self: start; margin: 4px 0 6px; }
.pd-form .sw-row input[type="color"] { padding: 0; border: 0; height: 100%; }
.pd-form .sw-row { min-height: 36px; }
.pd-slots { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 8px; }
.pd-tokens { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 2px 0 6px; font-size: 12px; color: var(--ink-3); }
.pd-tokens .btn { height: 26px; padding: 0 10px; font-size: 12px; }
.pd-pic { display: flex; gap: 10px; align-items: center; }
.pd-pic img { width: 56px; height: 56px; object-fit: contain; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.pd-pic img[hidden] { display: none; }
.pd-note { font-size: 12px; color: var(--ink-3); margin: 2px 0 0; }
.pd-sample { font-size: 13px; color: var(--ink); background: var(--chrome); border: 1px dashed var(--line); border-radius: 8px; padding: 6px 10px; margin: 6px 0; overflow-wrap: anywhere; }
.pd-list { display: flex; flex-direction: column; gap: 8px; margin: 4px 0; }
.pd-row { display: flex; align-items: center; gap: 10px; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; }
.pd-row .pd-ic { color: var(--accent); display: grid; place-items: center; }
.pd-row .pd-ic svg { width: 18px; height: 18px; }
.pd-row .pd-what { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pd-row .pd-what strong { color: var(--ink); font-weight: 600; }
.pd-row .pd-what span { font-size: 12px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pd-row .btn { height: 30px; padding: 0 12px; }
dialog.pd-dialog { width: min(760px, calc(100vw - 32px)); }
/* The page stays in view behind these dialogs: a light dim, no blur. */
dialog.pd-dialog::backdrop { backdrop-filter: none; -webkit-backdrop-filter: none; background: rgba(18, 12, 15, .18); }
.pd-dialog .dlg-foot { flex-wrap: wrap; }
.pd-dialog .dlg-foot .pd-rm { margin-right: auto; }
.pd-wrap { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 0 20px; align-items: start; }
.pd-main { min-width: 0; }
.pd-prev { margin: 8px 0; position: sticky; top: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.pd-prev-page { position: relative; width: 100%; aspect-ratio: 612 / 792; background: #fff; border: 1px solid var(--line); border-radius: 3px; box-shadow: 0 2px 10px rgba(0, 0, 0, .18); overflow: hidden; }
.pd-prev-page canvas { display: block; width: 100%; height: 100%; }
.pd-prev-page svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: hidden; }
.pd-prev-page svg text { white-space: pre; }
.pd-prev .pd-pv-under { mix-blend-mode: multiply; }
.pd-prev figcaption { font-size: 12px; color: var(--ink-3); }
@media (max-width: 640px) {
  .pd-wrap { grid-template-columns: minmax(0, 1fr); }
  .pd-prev { order: -1; z-index: 2; top: -6px; margin: 0 0 4px; padding: 10px 0 8px; background: var(--surface); border-bottom: 1px solid var(--line); }
  .pd-prev-page { width: auto; height: 160px; max-width: 100%; }
}
@media (max-width: 560px) {
  .pd-form { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 520px) {
  .pd-slots { grid-template-columns: minmax(0, 1fr); }
  .pd-row { flex-wrap: wrap; }
  .pd-row .pd-what { flex-basis: calc(100% - 40px); }
}
`);

/* saving */
const PD_STD = { sans: ['Helvetica', 'HelveticaBold'], serif: ['TimesRoman', 'TimesRomanBold'], mono: ['Courier', 'CourierBold'] };
function pdRgb(L, hex) { const n = parseInt(String(hex || '#000000').slice(1), 16) || 0; return L.rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); }
async function pdDrawItems(L, out, p, items, map, r, ctx) {
  for (const it of items) {
    const [x, y] = map(it.x, it.y), rotate = L.degrees((it.angle + r) % 360);
    if (it.kind === 'rect') p.drawRectangle({ x, y, width: it.w, height: it.h, color: pdRgb(L, it.color), opacity: it.opacity, rotate });
    else if (it.kind === 'image') {
      let im = ctx.images.get(it.data);
      if (!im) { im = await out.embedPng(it.data); ctx.images.set(it.data, im); }
      p.drawImage(im, { x, y, width: it.w, height: it.h, opacity: it.opacity, rotate });
    } else p.drawText(it.text, { x, y, size: it.size, font: ctx.pdFonts.get((it.font || 'sans') + (it.bold ? 'b' : '')), color: pdRgb(L, it.color), opacity: it.opacity, rotate });
  }
}
// Drawn after every other savePage hook, so applying redactions (which rewrites what is already in the page) never
// cuts letters out of it; page design from an earlier save is taken out when the file is opened (see pdReadBack).
FEATURE.savePageLate.push(async ({ L, out, p, n, entries, ctx }) => {
  const items = pdItems(); if (!items.length) return;
  ctx.pdFonts ||= new Map();
  for (const m of items) {
    const key = (m.font || 'sans') + (m.bold ? 'b' : '');
    if ((m.type !== 'pd_background' && !(m.type === 'pd_watermark' && m.kind === 'image')) && !ctx.pdFonts.has(key)) ctx.pdFonts.set(key, await out.embedFont(L.StandardFonts[PD_STD[m.font || 'sans'][m.bold ? 1 : 0]]));
  }
  const box = p.getCropBox(), r = ((Math.round(p.getRotation().angle / 90) * 90) % 360 + 360) % 360;
  const W = r % 180 ? box.height : box.width, H = r % 180 ? box.width : box.height;
  // From the page as seen (x right, y up) to the page's own space, which is turned by its /Rotate (clockwise).
  const map = (x, y) => r === 0 ? [box.x + x, box.y + y] : r === 90 ? [box.x + box.width - y, box.y + x] : r === 180 ? [box.x + box.width - x, box.y + box.height - y] : [box.x + y, box.y + box.height - x];
  const { under, over } = pdLayout(n, entries.length, W, H, (text, fam, bold, size) => ctx.pdFonts.get((fam || 'sans') + (bold ? 'b' : '')).widthOfTextAtSize(text, size));
  if (under.length) {
    // Behind the content: drawn in a stream of its own, which then goes first in the page's list of streams.
    p.getContentStream(false);
    pdTag(L, out, p, true); await pdDrawItems(L, out, p, under, map, r, ctx); pdTag(L, out, p, false);
    const contents = p.node.Contents(), ref = p.contentStreamRef, at = contents ? contents.indexOf(ref) : -1;
    if (at > 0) { contents.remove(at); contents.insert(0, ref); }
    p.getContentStream(false); // what's drawn next goes on top again
  }
  if (over.length) { pdTag(L, out, p, true); await pdDrawItems(L, out, p, over, map, r, ctx); pdTag(L, out, p, false); }
});
/* Kept in the saved PDF, so it can be changed or removed when the file is opened again: what is drawn is marked as
   an artifact tagged /CowdreyPdfPD, and the settings are a JSON string in the document's Info under the same key.
   Opening such a file takes the tagged drawing out of the pages and puts the settings back in docMarks(). */
const PD_KEY = 'CowdreyPdfPD';
function pdTag(L, out, p, on) {
  p.pushOperators(on ? L.PDFOperator.of('BDC', [L.PDFName.of('Artifact'), out.context.obj({ Type: 'Pagination', [PD_KEY]: 1 })]) : L.PDFOperator.of('EMC'));
}
// ASCII only (\uXXXX for the rest), with \ ( ) escaped for a PDF literal string.
const pdPdfString = (L, json) => L.PDFString.of(json.replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).replace(/[\\()]/g, '\\$&'));
FEATURE.saveDoc.push(async ({ L, out }) => {
  const items = pdItems(), info = out.getInfoDict(), key = L.PDFName.of(PD_KEY);
  if (items.length) info.set(key, pdPdfString(L, JSON.stringify(items))); else info.delete(key);
});
// Where tagged drawing starts and ends in a content stream: [start, end] of each BDC … EMC tagged /CowdreyPdfPD.
function pdTaggedSpans(s) {
  const spans = []; let operands = [], opStart = null, depth = 0, start = 0;
  for (const t of tokenizeContent(s)) {
    if (t.t !== 'op') { if (opStart == null) opStart = t.start; operands.push(t); continue; }
    const at = opStart ?? t.start;
    if (t.v === 'BDC' || t.v === 'BMC') { if (depth) depth++; else if (operands.some((x) => x.t === 'name' && x.v === PD_KEY)) { depth = 1; start = at; } }
    else if (t.v === 'EMC' && depth && --depth === 0) spans.push([start, t.end]);
    operands = []; opStart = null;
  }
  return spans;
}
// Takes the tagged drawing out of a pdf-lib page. Returns true if there was any.
function pdStripPage(L, out, p) {
  const { PDFName, PDFArray, PDFRawStream, decodePDFRawStream } = L, node = p.node;
  const raw = node.get(PDFName.of('Contents')), r = raw && out.context.lookup(raw);
  const parts = r instanceof PDFArray ? r.asArray() : raw ? [raw] : [];
  const text = (st) => { try { const b = st instanceof PDFRawStream ? decodePDFRawStream(st).decode() : st.getContents(); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return s; } catch { return ''; } };
  let src = parts.map((x) => { const st = out.context.lookup(x); return st ? text(st) : ''; }).join('\n');
  if (!src.includes(PD_KEY)) return false;
  const spans = pdTaggedSpans(src); if (!spans.length) return false;
  for (const [a, b] of spans.reverse()) src = src.slice(0, a) + ' ' + src.slice(b);
  const bytes = new Uint8Array(src.length); for (let i = 0; i < src.length; i++) bytes[i] = src.charCodeAt(i) & 255;
  node.set(PDFName.of('Contents'), out.context.register(out.context.flateStream(bytes)));
  return true;
}
let pdOpening = Promise.resolve();
async function pdReadBack(d) {
  const pd = pdfDocs.get(0), src = d.sources[0];
  if (!pd || !src) return;
  let raw;
  try { const md = await pd.getMetadata(), c = md && md.info && md.info.Custom; raw = c && (c instanceof Map ? c.get(PD_KEY) : c[PD_KEY]); } catch { return; }
  if (typeof raw !== 'string') return;
  let list; try { list = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(list)) return;
  const L = await loadPdfLib();
  // A PDF opened with its password is read with it, and the copy without the drawing is protected again the same way
  // (same password, same restrictions, as saving does), so it stays a protected source like the one opened.
  const pw = src.password;
  const out = await L.PDFDocument.load(src, pw ? { password: pw, updateMetadata: false } : { ignoreEncryption: true, updateMetadata: false });
  if (out.isEncrypted && !pw) return;
  for (const p of out.getPages()) pdStripPage(L, out, p);
  out.getInfoDict().delete(L.PDFName.of(PD_KEY));
  if (pw) {
    let flags = null; try { const f = await pd.getPermissions(); flags = f ? [...f] : null; } catch {}
    const F = pdfjs.PermissionFlag || {}, can = (f) => !flags || flags.includes(f);
    out.encrypt({ userPassword: pw, ownerPassword: flags ? uid() + uid() : pw, permissions: { printing: can(F.PRINT) ? (can(F.PRINT_HIGH_QUALITY) ? 'highResolution' : 'lowResolution') : false, modifying: can(F.MODIFY_CONTENTS), copying: can(F.COPY), annotating: can(F.MODIFY_ANNOTATIONS), fillingForms: can(F.FILL_INTERACTIVE_FORMS), contentAccessibility: can(F.COPY_FOR_ACCESSIBILITY), documentAssembly: can(F.ASSEMBLE) } });
  }
  const bytes = await out.save();
  if (pw) bytes.password = pw;
  const npd = await loadProtected(bytes, d.name);
  if (!npd) return;
  if (doc !== d || pdfDocs.get(0) !== pd) { try { npd.destroy(); } catch {} return; }
  // The source without the drawing replaces the opened one: the settings draw it again, and saving writes it anew.
  d.sources[0] = bytes; pdfDocs.set(0, npd); try { pd.destroy(); } catch {}
  const have = docMarks();
  for (const m of list) if (m && PD_TYPES[m.type] && m.id && !have.some((x) => x.id === m.id)) have.push({ ...m, rev: uid() });
  syncHiddenComments(); persist();
  await layoutPages(true); renderSide();
}
FEATURE.onDocShown.push((d) => { pdOpening = pdReadBack(d).catch((e) => console.warn('page design: could not read it back', e)); });
TEST_HOOKS.pdOpening = () => pdOpening;

/* dialogs */
const pdField = {
  text: (k, label, val, o = {}) => `<label class="field${o.wide ? ' pd-wide' : ''}"><span>${label}</span><input data-k="${k}" type="text" value="${esc(val ?? '')}" placeholder="${esc(o.ph || '')}" autocomplete="off"></label>`,
  num: (k, label, val, min, max, step = 1) => `<label class="field"><span>${label}</span><input data-k="${k}" type="number" inputmode="decimal" value="${esc(val)}" min="${min}" max="${max}" step="${step}"></label>`,
  sel: (k, label, val, opts) => `<label class="field"><span>${label}</span><select data-k="${k}">${opts.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(val) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`,
  color: (k, label, val, colors = INK_COLORS) => `<div class="field"><span id="pd-${k}-l">${label}</span><span class="sw-row" role="group" aria-labelledby="pd-${k}-l">${swatchesHtml(colors, { now: val, attrs: (c) => `data-pdc="${k}" data-c="${c}"`, pick: `data-k="${k}" value="${esc(val)}"` })}</span></div>`,
  check: (k, label, val) => `<label class="field pd-check"><input data-k="${k}" type="checkbox"${val ? ' checked' : ''}><span>${label}</span></label>`,
  slider: (k, label, val) => `<label class="field"><span>${label} <b data-out="${k}">${val}%</b></span><input data-k="${k}" type="range" min="0" max="100" step="5" value="${esc(val)}"></label>`,
  seg: (k, val, opts) => `<div class="seg pd-seg pd-wide" role="radiogroup">${opts.map(([v, t]) => `<label><input type="radio" name="pd-${k}" data-k="${k}" value="${v}"${v === val ? ' checked' : ''}><span>${t}</span></label>`).join('')}</div>`,
  range: (val) => pdField.text('range', 'Pages', val, { ph: 'All pages, or e.g. 1-3, 5' }),
  font: (m) => pdField.sel('font', 'Font', m.font, PD_FONTS) + pdField.num('size', 'Size (pt)', m.size, 4, 400) + pdField.color('color', 'Colour', m.color) + pdField.check('bold', 'Bold', m.bold),
  margins: (m) => pdField.num('mTop', 'Top margin (mm)', m.mTop, 0, 200, .5) + pdField.num('mBottom', 'Bottom margin (mm)', m.mBottom, 0, 200, .5) + pdField.num('mSide', 'Side margins (mm)', m.mSide, 0, 200, .5),
};
function pdRead(dlg, m) {
  for (const el of $$('[data-k]', dlg)) {
    const k = el.dataset.k;
    if (el.type === 'checkbox') m[k] = el.checked;
    else if (el.type === 'radio') { if (el.checked) m[k] = el.value; }
    else if (el.type === 'number' || el.type === 'range') { if (el.value !== '' && isFinite(+el.value)) m[k] = +el.value; }
    else m[k] = el.value;
  }
  for (const o of $$('[data-out]', dlg)) o.textContent = m[o.dataset.out] + '%';
  for (const b of $$('[data-pdc]', dlg)) b.setAttribute('aria-pressed', b.dataset.c.toLowerCase() === String(m[b.dataset.pdc]).toLowerCase());
  for (const el of $$('[data-show]', dlg)) { const [k, v] = el.dataset.show.split('='); el.hidden = m[k] !== v; }
  return m;
}
// A picture chosen in a dialog, as a PNG no larger than 2000 px.
async function pdPicture(file) {
  const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  const img = new Image(); img.src = data; await img.decode();
  const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { data: c.toDataURL('image/png'), iw: c.width, ih: c.height };
}
const pdPicField = (m, label) => `<div class="field pd-wide"><span>${label}</span><div class="pd-pic"><img alt="" data-pic${m.data ? ` src="${m.data}"` : ' hidden'}><input type="file" accept="image/*" data-file></div></div>`;
function pdBody(type, m) {
  const F = pdField;
  if (type === 'pd_watermark') return `<div class="pd-form">${F.seg('kind', m.kind, [['text', 'Text'], ['image', 'Picture']])}
    <div class="pd-form pd-wide" data-show="kind=text"${m.kind !== 'text' ? ' hidden' : ''}>${F.text('text', 'Text', m.text, { wide: true })}${F.font(m)}</div>
    <div class="pd-form pd-wide" data-show="kind=image"${m.kind !== 'image' ? ' hidden' : ''}>${pdPicField(m, 'Picture')}${F.num('scale', 'Width (% of page)', m.scale, 1, 200)}</div>
    ${F.slider('opacity', 'Opacity', m.opacity)}${F.num('rotation', 'Rotation (°)', m.rotation, -360, 360)}
    ${F.sel('layout', 'Position', m.layout, [['center', 'Centre of the page'], ['tile', 'Tiled across the page']])}
    ${F.sel('front', 'Layer', m.front, [['front', 'In front of the page'], ['behind', 'Behind the page']])}
    ${F.range(m.range)}</div>`;
  if (type === 'pd_background') return `<div class="pd-form">${F.seg('kind', m.kind, [['color', 'Colour'], ['image', 'Picture']])}
    <div class="pd-form pd-wide" data-show="kind=color"${m.kind !== 'color' ? ' hidden' : ''}>${F.color('color', 'Colour', m.color, PALE_COLORS)}</div>
    <div class="pd-form pd-wide" data-show="kind=image"${m.kind !== 'image' ? ' hidden' : ''}>${pdPicField(m, 'Picture')}${F.sel('fit', 'Size', m.fit, [['stretch', 'Fill the page'], ['fit', 'Fit inside the page']])}</div>
    ${F.slider('opacity', 'Opacity', m.opacity)}${F.range(m.range)}</div>
    <p class="pd-note">The background goes behind everything on the page.</p>`;
  if (type === 'pd_headfoot') return `<div class="pd-slots">${PD_SLOTS.map(([k, t]) => F.text(k, t, m[k])).join('')}</div>
    <div class="pd-tokens"><span>Insert:</span><button type="button" class="btn" data-token="<<page>>">Page number</button><button type="button" class="btn" data-token="<<pages>>">Page count</button><button type="button" class="btn" data-token="<<date>>">Date</button></div>
    <p class="pd-err" data-pd-err role="alert" hidden>A page number, page count or date field is broken. Delete it, then use Insert.</p>
    <div class="pd-form">${F.sel('dateFmt', 'Date format', m.dateFmt, PD_DATES.map((f) => [f, pdDate(f)]))}${F.num('start', 'First page number', m.start, 0, 99999)}
    ${F.font(m)}${F.margins(m)}${F.range(m.range)}</div>`;
  return `<div class="pd-form">${F.text('prefix', 'Prefix', m.prefix)}${F.text('suffix', 'Suffix', m.suffix)}${F.num('start', 'Start number', m.start, 0, 999999999999)}${F.num('digits', 'Digits', m.digits, 1, 12)}
    <div class="pd-sample pd-wide" data-sample></div>
    ${F.sel('slot', 'Position', m.slot, PD_SLOTS)}${F.font(m)}${F.margins(m)}${F.range(m.range)}</div>
    <p class="pd-note">Numbers run across the saved PDF's pages in order.</p>`;
}
function pdCheck(type, m) {
  if (m.range && m.range.trim() && !parseRange(m.range, doc.pages.length).length) return 'Check the pages: use numbers like 1-3, 5';
  if ((type === 'pd_watermark' || type === 'pd_background') && m.kind === 'image' && !m.data) return 'Choose a picture first';
  if (type === 'pd_watermark' && m.kind === 'text' && !String(m.text || '').trim()) return 'Type the watermark text';
  if (type === 'pd_headfoot' && !PD_SLOTS.some(([k]) => String(m[k] || '').trim())) return 'Type a header or footer in at least one place';
  if (type === 'pd_headfoot' && PD_SLOTS.some(([k]) => pdBroken(m[k]))) return 'A page number, page count or date field is broken. Delete it and insert it again.';
  return null;
}
// A small picture of one page in the dialog, with the settings being changed drawn on it (by pdLayout, as on the page
// and in the saved PDF) and drawn again on every change. It shows the page in view, or the first page they go on.
function pdPreview(dlg, type, m, existing) {
  const box = $('[data-preview]', dlg), page = box && $('.pd-prev-page', box);
  if (!page) return () => {};
  const cv = $('canvas', page), under = $('.pd-pv-under', page), over = $('.pd-pv-over', page), cap = $('figcaption', box);
  const shots = new Map(); let shown = -1;
  const shot = async (n) => {
    const e = doc.pages[n], pg = await pageOf(e), rotation = (pg.rotate + e.rot) % 360;
    const v1 = pg.getViewport({ scale: 1, rotation }), v = pg.getViewport({ scale: 440 / Math.max(v1.width, v1.height), rotation });
    const c = document.createElement('canvas'); c.width = Math.round(v.width); c.height = Math.round(v.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvas: c, canvasContext: g, viewport: v }).promise;
    // The page as it is now: its edits, mark-up and redactions (its page design is drawn below, from the settings).
    try { await thumbOverlays(e, n, pg, v, g, null, { design: false }); } catch {}
    return { c, W: v1.width, H: v1.height };
  };
  const paint = () => {
    const sh = shots.get(shown); if (!sh) return;
    const list = [...pdItems().filter((x) => !existing || x.id !== existing.id), { ...m, type }].sort((a, b) => PD_ORDER.indexOf(a.type) - PD_ORDER.indexOf(b.type));
    const { under: u, over: o } = pdLayout(shown, doc.pages.length, sh.W, sh.H, pdMeasure, new Date(), list);
    pdPaint(under, u, 1, sh.H); pdPaint(over, o, 1, sh.H);
  };
  return async () => {
    const N = doc.pages.length, pages = pdPages(m, N), n = !pages.length || pages.includes(current) ? Math.min(current, N - 1) : pages[0];
    if (n < 0) return;
    if (n !== shown) {
      shown = n; cap.textContent = `Page ${n + 1} of ${N}`;
      if (!shots.has(n)) { try { shots.set(n, await shot(n)); } catch { return; } }
      if (shown !== n) return;
      const sh = shots.get(n);
      cv.width = sh.c.width; cv.height = sh.c.height; cv.getContext('2d').drawImage(sh.c, 0, 0);
      page.style.aspectRatio = `${sh.W} / ${sh.H}`;
      for (const s of [under, over]) s.setAttribute('viewBox', `0 0 ${sh.W} ${sh.H}`);
    }
    paint();
  };
}
const pdPreviewHtml = '<figure class="pd-prev" data-preview><div class="pd-prev-page"><canvas width="1" height="1" aria-hidden="true"></canvas><svg class="pd-pv-under" aria-hidden="true"></svg><svg class="pd-pv-over" aria-hidden="true"></svg></div><figcaption></figcaption></figure>';
const PD_VERB = { pd_watermark: ['Add watermark', 'Watermark added', 'Watermark updated', 'Edit watermark'], pd_background: ['Add background', 'Background added', 'Background updated', 'Edit background'], pd_headfoot: ['Add header & footer', 'Header & footer added', 'Header & footer updated', 'Edit header & footer'], pd_bates: ['Add Bates numbers', 'Bates numbers added', 'Bates numbers updated', 'Edit Bates numbering'] };
async function pdEdit(type, existing) {
  if (!has()) return;
  const m = existing ? JSON.parse(JSON.stringify(existing)) : { ...pdDefaults[type](), ...(pdLastUsed[type] || {}), type };
  let err = null;
  // Changing one that is there already: it can also be removed, or another one added next to it.
  const actions = existing ? [{ label: 'Remove', value: 'rm' }, { label: 'Add another', value: 'add' }, { label: 'Cancel' }, { label: 'Save changes', value: 'ok', primary: true }]
    : [{ label: 'Cancel' }, { label: PD_VERB[type][0], value: 'ok', primary: true }];
  do {
    const title = existing ? PD_VERB[type][3] : PD_TYPES[type];
    const res = await dialog(title, `<div class="pd-wrap"><div class="pd-main">${pdBody(type, m)}</div>${pdPreviewHtml}</div>`, actions, (dlg) => {
      // The dialog element is reused: listen on its body, which is new for each dialog.
      const body = $('.dlg-body', dlg);
      dlg.classList.add('pd-dialog');
      if (existing) $('.dlg-foot [data-a="0"]', dlg).classList.add('pd-rm');
      let focusSlot = null;
      const preview = pdPreview(dlg, type, m, existing);
      const sync = () => {
        pdRead(dlg, m);
        const s = $('[data-sample]', dlg); if (s) s.textContent = `First page: ${pdClean(pdBates(m, Math.max(0, Math.round(+m.start || 0))))}`;
        // A field that was typed over or split is marked, and the dialog can't be confirmed until it is fixed.
        let bad = false;
        for (const [k] of PD_SLOTS) { const el = $(`[data-k="${k}"]`, dlg); if (!el) continue; const b = pdBroken(el.value); bad ||= b; if (b) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); }
        const pb = $('.dlg-foot .btn.primary', dlg); if (pb && type === 'pd_headfoot') pb.disabled = bad;
        const note = $('[data-pd-err]', dlg); if (note) note.hidden = !bad;
        preview().catch(() => {});
      };
      body.addEventListener('input', sync); body.addEventListener('change', sync);
      body.addEventListener('click', (e) => { const s = e.target.closest('[data-pdc]'); if (!s) return; const i = $(`input[data-k="${s.dataset.pdc}"]`, body); i.value = s.dataset.c.toLowerCase(); i.dispatchEvent(new Event('input', { bubbles: true })); });
      body.addEventListener('focusin', (e) => { if (e.target.dataset && PD_SLOTS.some(([k]) => k === e.target.dataset.k)) focusSlot = e.target; });
      // A field goes in at the caret, but never inside another field ("Page <<pa|ge>>" puts it after "<<page>>").
      for (const b of $$('[data-token]', dlg)) b.onclick = () => {
        const el = focusSlot || $('[data-k="bc"]', dlg), tok = b.dataset.token;
        const at = pdOutside(el.value, el.selectionStart ?? el.value.length), end = Math.max(at, pdOutside(el.value, el.selectionEnd ?? at));
        el.value = el.value.slice(0, at) + tok + el.value.slice(end); el.focus(); el.selectionStart = el.selectionEnd = at + tok.length; sync();
      };
      const file = $('[data-file]', dlg);
      if (file) file.onchange = async () => {
        const f = file.files[0]; if (!f) return;
        try { Object.assign(m, await pdPicture(f)); const im = $('[data-pic]', dlg); im.src = m.data; im.hidden = false; sync(); } catch { toast('That picture could not be read'); }
      };
      sync();
    });
    $('#dialog').classList.remove('pd-dialog');
    if (res === 'rm') return pdRemove(existing.id);
    if (res === 'add') return pdEdit(type);
    if (res !== 'ok') return;
    err = pdCheck(type, m);
    if (err) toast(err);
  } while (err);
  const before = snapshot();
  m.rev = uid();
  if (existing) { const list = docMarks(), k = list.findIndex((x) => x.id === existing.id); if (k >= 0) list[k] = m; else list.push(m); }
  else { m.id = uid(); docMarks().push(m); }
  changed(before);
  // The next one starts from these settings, except for the pages, which are chosen each time.
  const { id, rev, data, iw, ih, range, ...keep } = m; void id; void rev; void data; void iw; void ih; void range;
  pdLastUsed[type] = keep;
  pdRefreshAll();
  toast(PD_VERB[type][existing ? 2 : 1]);
}
function pdRemove(id) {
  const list = docMarks(), k = list.findIndex((x) => x.id === id); if (k < 0) return;
  const before = snapshot(); const [m] = list.splice(k, 1); changed(before); pdRefreshAll();
  toast(`${PD_TYPES[m.type]} removed`);
}
function pdSummary(m) {
  const pages = m.range && m.range.trim() ? 'pages ' + m.range.trim() : 'all pages';
  if (m.type === 'pd_watermark') return [m.kind === 'image' ? 'Picture' : `“${m.text}”`, m.layout === 'tile' ? 'tiled' : 'centre', `${m.opacity}%`, m.front === 'behind' ? 'behind' : 'in front', pages].join(' · ');
  if (m.type === 'pd_background') return [m.kind === 'image' ? 'Picture' : m.color.toUpperCase(), `${m.opacity}%`, pages].join(' · ');
  if (m.type === 'pd_headfoot') return [PD_SLOTS.filter(([k]) => m[k]).map(([k]) => m[k]).join(' / '), pages].join(' · ');
  return [pdBates(m, m.start), PD_SLOTS.find(([k]) => k === m.slot)[1].toLowerCase(), pages].join(' · ');
}
// Everything added (or, given a type, each one of that type, with a button to add another).
async function pdManage(type) {
  if (!has()) return;
  let edit = null;
  const res = await dialog(type ? PD_TYPES[type] : 'Page design', '<div class="pd-list" data-list></div>', type ? [{ label: 'Add another', value: 'add' }, { label: 'Close', primary: true }] : [{ label: 'Close', primary: true }], (dlg) => {
    const box = $('[data-list]', dlg);
    const draw = () => {
      const items = pdItems().filter((m) => !type || m.type === type);
      box.innerHTML = items.length ? items.map((m) => `<div class="pd-row" data-id="${m.id}"><span class="pd-ic">${ic(PD_ICONS[m.type])}</span><div class="pd-what"><strong>${PD_TYPES[m.type]}</strong><span title="${esc(pdSummary(m))}">${esc(pdSummary(m))}</span></div><button type="button" class="btn" data-edit="${m.id}">Edit</button><button type="button" class="btn" data-remove="${m.id}">Remove</button></div>`).join('')
        : '<p>Nothing added yet. Add a watermark, background, header & footer or Bates numbers from the Edit tab.</p>';
      icons();
    };
    box.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.remove) { pdRemove(b.dataset.remove); draw(); }
      if (b.dataset.edit) { edit = pdItems().find((m) => m.id === b.dataset.edit); $('[data-x]', dlg).click(); }
    };
    draw();
  });
  if (edit) await pdEdit(edit.type, edit);
  else if (res === 'add') await pdEdit(type);
}
// The ribbon buttons open what is there already: the one of that kind to change, a list when there are several.
function pdOpen(type) {
  const ex = pdItems().filter((m) => m.type === type);
  return ex.length === 1 ? pdEdit(type, ex[0]) : ex.length ? pdManage(type) : pdEdit(type);
}

cmd('pd_watermark', { label: 'Watermark…', icon: PD_ICONS.pd_watermark, enabled: has, run: () => pdOpen('pd_watermark') });
cmd('pd_background', { label: 'Background…', icon: PD_ICONS.pd_background, enabled: has, run: () => pdOpen('pd_background') });
cmd('pd_headfoot', { label: 'Header & footer…', icon: PD_ICONS.pd_headfoot, enabled: has, run: () => pdOpen('pd_headfoot') });
cmd('pd_bates', { label: 'Bates numbering…', icon: PD_ICONS.pd_bates, enabled: has, run: () => pdOpen('pd_bates') });
cmd('pd_manage', { label: 'Manage page design…', icon: 'layout-template', enabled: () => has() && pdItems().length > 0, run: () => pdManage() });
ribbonAdd('edit', 'Page design', ['pd_watermark', 'pd_background', 'pd_headfoot', 'pd_bates', 'pd_manage']);
menuAdd('Edit', ['pd_watermark', 'pd_background', 'pd_headfoot', 'pd_bates', 'pd_manage']);
TEST_HOOKS.pdItems = () => pdItems();
TEST_HOOKS.cmdIcon = (id) => C[id] && C[id].icon;
