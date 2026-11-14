/* ---------------- forms: make and change form fields (the Forms tab) ----------------
   New fields are marks of type 'ff' (in PDF coordinates, like every mark) until the PDF is saved; saving makes them
   real AcroForm fields with pdf-lib's form API, so they can be filled in here and in any reader.
     ff      { kind: text | check | radio | combo | list | button | date | sig, x1, y1, x2, y2, rot, name, tip, req,
               ro, val, size, multi, max, opts, exp, label, act, url, fmt }
   Fields already in the PDF: deleting one adds an 'ae' mark (deleted) for each of its widgets, which hides it on
   screen and takes it out of the page when saving (the core does this for comments), and an 'ffmod' document mark
   that takes the field out of the form. Renaming one and changing its tooltip, required and read-only settings is an
   'ffmod' document mark too. 'ffflat' (a document mark) flattens the form when saving.
   Recognize form looks for blank lines (underscores, drawn lines), empty boxes and ☐ characters and proposes fields
   there; they are only added when you click them, or Add all. */
const FF_KINDS = {
  text: { label: 'Text field', icon: 'rectangle-ellipsis', base: 'Text', w: 160, h: 22 },
  check: { label: 'Check box', icon: 'square-check', base: 'CheckBox', w: 14, h: 14 },
  radio: { label: 'Radio button', icon: 'circle-dot', base: 'Group', w: 14, h: 14 },
  combo: { label: 'Drop-down', icon: 'square-chevron-down', base: 'Dropdown', w: 140, h: 22 },
  list: { label: 'List box', icon: 'list', base: 'ListBox', w: 140, h: 64 },
  button: { label: 'Button', icon: 'mouse-pointer-click', base: 'Button', w: 90, h: 24 },
  date: { label: 'Date field', icon: 'calendar-days', base: 'Date', w: 110, h: 22 },
  sig: { label: 'Signature field', icon: 'signature', base: 'Signature', w: 180, h: 44 },
};
const FF_DATE_FORMATS = ['mm/dd/yyyy', 'dd/mm/yyyy', 'yyyy-mm-dd', 'd mmm yyyy', 'mmm d, yyyy'];
const FF_SIZES = [0, 8, 9, 10, 11, 12, 14, 16, 18, 24];
const FF_BORDER = '#8C8C99'; // rgb(.55, .55, .6), the border saved fields get
let ffSelX = null;          // the name of a field already in the PDF that is selected
let ffProposals = [];        // fields Recognize form found: { pid, key, kind, x1, y1, x2, y2 }
const ffKnown = new Set();   // names of the fields already in the PDF
let ffLastRadio = null;      // the group the next radio button joins

const ffIsTool = () => /^ff_/.test(app.dataset.tool || '');
const ffAllMarks = () => doc ? Object.entries(doc.marks).filter(([k]) => k !== '__doc').flatMap(([, l]) => l) : [];
const ffMarks = () => ffAllMarks().filter((m) => m.type === 'ff');
const ffMods = () => doc ? docMarks().filter((m) => m.type === 'ffmod') : [];
const ffFlat = () => !!doc && docMarks().some((m) => m.type === 'ffflat');
const ffModOf = (name) => ffMods().find((m) => m.name === name);
const ffShown = (name) => { const m = ffModOf(name); return m && m.newName ? m.newName : name; };
const ffBox = (m) => [Math.min(m.x1, m.x2), Math.min(m.y1, m.y2), Math.max(m.x1, m.x2), Math.max(m.y1, m.y2)];
const ffClean = (s) => String(s || '').trim().replace(/\./g, '_');
const ffFind = (id) => { for (const v of views) { const m = marksOf(v.entry).find((x) => x.id === id); if (m) return { v, m }; } for (const [k, l] of Object.entries(doc.marks)) { if (k === '__doc') continue; const m = l.find((x) => x.id === id); if (m) return { v: null, m, key: k }; } return null; };

// Every name in use: fields in the PDF (renamed ones by their new name, deleted ones not) and new fields.
function ffNames(exceptId) {
  const s = new Set();
  for (const n of ffKnown) { const md = ffModOf(n); if (!(md && md.del)) s.add(ffShown(n)); }
  for (const m of ffMarks()) if (m.id !== exceptId) s.add(m.name);
  return s;
}
function ffNextName(kind) {
  const used = ffNames(), base = FF_KINDS[kind].base;
  let n = 1; while (used.has(base + n)) n++;
  return base + n;
}
// Every widget of every field in the PDFs the document is made from (pdf.js's getFieldObjects() only lists fields
// when scripting is on).
async function ffAllWidgets() {
  const out = [];
  for (const [src, pd] of pdfDocs) for (let i = 0; i < pd.numPages; i++) {
    try { for (const a of await (await pd.getPage(i + 1)).getAnnotations({ intent: 'display' })) if (a.annotationType === pdfjs.AnnotationType.WIDGET && a.fieldName) out.push({ src, pd, a }); } catch {}
  }
  return out;
}
async function ffLoadKnown() {
  const all = await ffAllWidgets();
  ffKnown.clear(); for (const { a } of all) ffKnown.add(a.fieldName);
}
FEATURE.onDocShown.push(() => { ffSelX = null; ffProposals = []; ffBar(); ffLastRadio = null; ffKnownSrcs = pdfDocs.size; ffLoadKnown().then(() => refreshRibbon()).catch(() => {}); });

/* ---- form design and filling in ----
   New fields are designed (moved, resized, given properties) while a form tool or Edit fields is chosen on the Forms
   tab. Otherwise (Select, Esc, another tab, or Fill in) they can be filled in at once, like the fields already in
   the PDF; what is typed is the field's value. */
const ffDesign = () => S.ribbon === 'forms' && ffIsTool();
const FF_FILLABLE = new Set(['text', 'date', 'check', 'radio', 'combo', 'list']);
function ffRedrawAll() { selectMark(null); views.forEach((v) => { if (v.rendered) { drawMarks(v); ffLayer(v); } }); }
(FEATURE.onTab ||= []).push(() => { ffFillOn = false; ffRedrawAll(); });
// Choosing a form tool designs the form; Select (or Esc) fills it in.
let ffWasDesign = false;
new MutationObserver(() => { if (app.dataset.tool !== 'select') ffFillOn = false; const d = ffDesign(); if (d !== ffWasDesign) { ffWasDesign = d; if (!d) ffSelectX(null); ffRedrawAll(); } }).observe(app, { attributes: true, attributeFilter: ['data-tool'] });
function ffEndPreview() {}
// Fill in: leave form design to try the fields (pressed only once chosen); pressed again, back to Edit fields.
let ffFillOn = false;
function ffPreview() {
  if (!ffFillOn) { if (app.dataset.tool !== 'select') setTool('select'); ffFillOn = true; refreshRibbon(); toast('Fill in the fields to try them'); }
  else { setTool('ff_edit'); ffLoadKnown(); }
}
Object.assign(TOOL_HINTS, { ff_edit: 'Click a field to select it; double-click for its properties' });
for (const k of Object.keys(FF_KINDS)) TOOL_HINTS['ff_' + k] = 'Drag on the page';
// An HTML control over a new field, to fill it in. A change is kept like any other (undo takes it back).
function ffFillControl(m, fs) {
  let el;
  if (m.kind === 'text' || m.kind === 'date') {
    el = document.createElement(m.multi ? 'textarea' : 'input'); el.value = m.val || '';
    if (m.max > 0) el.maxLength = m.max;
    if (m.kind === 'date') el.placeholder = m.fmt || FF_DATE_FORMATS[0];
  } else if (m.kind === 'check' || m.kind === 'radio') {
    el = document.createElement('input'); el.type = m.kind === 'check' ? 'checkbox' : 'radio'; el.checked = !!m.val;
  } else {
    el = document.createElement('select'); if (m.kind === 'list') el.size = Math.max(2, (m.opts || []).length);
    for (const o of m.opts || []) el.appendChild(Object.assign(document.createElement('option'), { value: o, textContent: o }));
    el.value = m.val || ''; if (!(m.opts || []).includes(m.val)) el.selectedIndex = -1;
  }
  el.className = 'ff-ctl ff-ctl-' + m.kind; el.style.fontSize = fs + 'px';
  el.setAttribute('aria-label', m.tip || m.name); el.dataset.field = m.name;
  if (m.ro) el.disabled = true;
  if (m.req) el.required = true;
  el.addEventListener('pointerdown', (e) => e.stopPropagation()); // fill it in, don't select or move it
  el.addEventListener('change', () => {
    const before = snapshot(), val = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
    if (m.kind === 'radio') { for (const r of ffMarks()) if (r.kind === 'radio' && r.name === m.name) r.val = r.id === m.id; }
    else m.val = val;
    changed(before);
    if (m.kind === 'radio') views.forEach((v) => v.rendered && drawMarks(v));
  });
  return el;
}
// The controls sit in their own layer over the page (not inside the SVG, where some browsers misplace them), drawn
// again with the marks.
function ffFillLayer(v) {
  let lay = v.el.querySelector('.ff-fill-layer');
  const list = !doc || ffFlat() || ffDesign() ? [] : marksOf(v.entry).filter((m) => m.type === 'ff' && FF_FILLABLE.has(m.kind));
  if (!list.length) { if (lay) lay.remove(); return; }
  if (!lay) { lay = document.createElement('div'); lay.className = 'ff-fill-layer'; v.el.appendChild(lay); }
  if (lay.contains(document.activeElement) && lay.__sig === JSON.stringify(list) + scale) return; // typing in it: leave it
  lay.__sig = JSON.stringify(list) + scale;
  const had = [...lay.children].indexOf(document.activeElement); // a tick moved focus nowhere: keep it on that field
  lay.innerHTML = '';
  for (const m of list) {
    const [X0, Y0, X1, Y1] = ffBox(m), pts = [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]].map(([x, y]) => toView(v, x, y));
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]), w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    const d = ((totalRot(v) - (m.rot || 0)) % 360 + 360) % 360, lw = d % 180 ? h : w, lh = d % 180 ? w : h;
    const cx = Math.min(...xs) + w / 2, cy = Math.min(...ys) + h / 2;
    const fs = (m.size || (m.kind === 'list' ? 9 : Math.min(12, Math.max(6, (lh / scale) * .62)))) * scale;
    const el = ffFillControl(m, fs);
    Object.assign(el.style, { left: `${cx - lw / 2}px`, top: `${cy - lh / 2}px`, width: `${lw}px`, height: `${lh}px`, transform: d ? `rotate(${d}deg)` : '' });
    lay.appendChild(el);
  }
  if (had >= 0 && lay.children[had]) lay.children[had].focus({ preventScroll: true });
}

/* ---- drawing new fields (they look as they will once saved) ---- */
function ffDraw(v, m, svg) {
  ffHookSvg(v, svg);
  // A thumbnail shows the field as it will print: no name tag, no handles, no tint (v.thumb).
  const flat = ffFlat() || !!v.thumb, filling = !flat && !ffDesign() && FF_FILLABLE.has(m.kind);
  const [X0, Y0, X1, Y1] = ffBox(m);
  const pts = [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]].map(([x, y]) => toView(v, x, y));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  const g = svgEl('g', { class: (filling ? 'ff-fill ' : 'mk ') + 'ff-mk' + (flat ? ' ff-flat' : '') });
  const d = ((totalRot(v) - (m.rot || 0)) % 360 + 360) % 360;
  const lw = d % 180 ? h : w, lh = d % 180 ? w : h, cx = x + w / 2, cy = y + h / 2;
  const inner = svgEl('g', { transform: `rotate(${d} ${cx} ${cy}) translate(${cx - lw / 2} ${cy - lh / 2})` });
  const s = scale, fs = (m.size || (m.kind === 'list' ? 9 : Math.min(12, Math.max(6, (lh / s) * .62)))) * s;
  const txt = (str, tx, ty, attrs = {}) => { const t = svgEl('text', { x: tx, y: ty, 'font-size': fs, 'font-family': 'Helvetica, Arial, sans-serif', fill: '#111', ...attrs }); t.textContent = str; return t; };
  const clipId = 'ffc' + m.id;
  const clip = svgEl('clipPath', { id: clipId }); clip.appendChild(svgEl('rect', { x: 0, y: 0, width: lw, height: lh })); inner.appendChild(clip);
  const body = svgEl('g', { 'clip-path': `url(#${clipId})` });
  if (filling) {
    if (m.kind !== 'radio') inner.appendChild(svgEl('rect', { x: 0, y: 0, width: lw, height: lh, fill: m.kind === 'check' || m.kind === 'list' ? '#fff' : 'none', stroke: m.kind === 'check' ? '#000' : FF_BORDER, 'stroke-width': s }));
    g.appendChild(inner);
    return g;
  }
  if (m.kind === 'radio') {
    inner.appendChild(svgEl('rect', { class: 'ff-hit', x: 0, y: 0, width: lw, height: lh, fill: flat ? 'transparent' : 'rgba(174, 23, 71, .06)' }));
    const r = Math.min(lw, lh) / 2 - .5 * s;
    inner.appendChild(svgEl('circle', { cx: lw / 2, cy: lh / 2, r, fill: '#fff', stroke: '#000', 'stroke-width': s }));
    if (m.val) inner.appendChild(svgEl('circle', { cx: lw / 2, cy: lh / 2, r: r * .45, fill: '#000' }));
  } else {
    const fill = m.kind === 'button' ? '#BFBFBF' : m.kind === 'check' ? '#fff' : 'rgba(174, 23, 71, .06)';
    inner.appendChild(svgEl('rect', { class: 'ff-box', x: 0, y: 0, width: lw, height: lh, fill: flat && fill.startsWith('rgba') ? 'transparent' : fill, stroke: m.kind === 'check' || m.kind === 'button' ? '#000' : FF_BORDER, 'stroke-width': s }));
    if (m.kind === 'check' && m.val) inner.appendChild(svgEl('path', { d: `M${lw * .2} ${lh * .52} L${lw * .42} ${lh * .74} L${lw * .8} ${lh * .26}`, fill: 'none', stroke: '#000', 'stroke-width': Math.max(1, lw * .12) }));
    if (m.kind === 'text' || m.kind === 'date') {
      const shown = m.val || (m.kind === 'date' && !flat ? m.fmt || FF_DATE_FORMATS[0] : '');
      if (m.multi && m.val) m.val.split('\n').forEach((line, k) => body.appendChild(txt(line, 2 * s, fs * (1 + k * 1.15) + s)));
      else if (shown) body.appendChild(txt(shown, 2 * s, lh / 2 + fs * .35, m.val ? {} : { fill: '#8C8C99' }));
    }
    if (m.kind === 'combo') {
      if (m.val) body.appendChild(txt(m.val, 2 * s, lh / 2 + fs * .35));
      if (!flat) inner.appendChild(svgEl('path', { d: `M${lw - 12 * s} ${lh / 2 - 2 * s} l${4 * s} ${4 * s} l${4 * s} ${-4 * s}`, fill: 'none', stroke: '#555', 'stroke-width': 1.2 * s }));
    }
    if (m.kind === 'list') (m.opts || []).forEach((o, k) => {
      const ty = 2 * s + fs * 1.15 * k;
      if (o === m.val) body.appendChild(svgEl('rect', { x: s, y: ty, width: lw - 2 * s, height: fs * 1.15, fill: '#99C1F1' }));
      body.appendChild(txt(o, 2 * s, ty + fs * .9));
    });
    if (m.kind === 'button') body.appendChild(txt(m.label || 'Button', lw / 2, lh / 2 + fs * .35, { 'text-anchor': 'middle' }));
    if (m.kind === 'sig' && !flat) body.appendChild(txt('Sign here', 4 * s, lh - 6 * s, { fill: '#8C8C99', 'font-size': Math.min(12 * s, lh * .4) }));
  }
  inner.appendChild(body);
  g.appendChild(inner);
  // The field's name, while a form tool is chosen (not part of the PDF)
  if (!flat) g.appendChild(ffTag(x, y, m.name));
  if (!v.thumb && selMark && selMark.id === m.id) for (const [k, [hx, hy]] of pts.entries()) {
    const hd = svgEl('rect', { class: 'ff-handle ui-only', x: hx - 5, y: hy - 5, width: 10, height: 10, rx: 2 });
    hd.addEventListener('pointerdown', (e) => ffResize(e, v, m, k));
    g.appendChild(hd);
  }
  return g;
}
function ffTag(x, y, name) {
  const t = svgEl('g', { class: 'ff-tag ui-only', transform: `translate(${x} ${Math.max(0, y - 15)})` });
  t.appendChild(svgEl('rect', { x: 0, y: 0, width: String(name).length * 6.3 + 8, height: 14, rx: 3 }));
  const tx = svgEl('text', { x: 4, y: 10.5 }); tx.textContent = name; t.appendChild(tx);
  return t;
}
// Double-click a field (Select or a form tool) for its properties. Pressing on a field redraws it (to select it),
// and moving it cancels the browser's own click, so double-clicks are told apart here: two presses on one field.
let ffLastDown = { t: 0, id: null, x: 0, y: 0 };
function ffIsDouble(e, id) {
  const d = ffLastDown, now = performance.now();
  const dbl = d.id === id && now - d.t < 450 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8;
  ffLastDown = dbl ? { t: 0, id: null, x: 0, y: 0 } : { t: now, id, x: e.clientX, y: e.clientY };
  return dbl;
}
function ffHookSvg(v, svg) {
  if (svg.__ff) return; svg.__ff = true;
  svg.addEventListener('pointerdown', (e) => {
    const hit = e.target.closest && e.target.closest('.ff-mk'); if (!hit || hit.classList.contains('ff-fill') || e.target.closest('.ff-handle')) return;
    const tool = app.dataset.tool; if (tool !== 'select' && !/^ff_/.test(tool)) return;
    if (ffIsDouble(e, hit.dataset.id)) ffOnRelease(e, () => ffProps(hit.dataset.id));
  }, true);
}
// Opens the properties when the second press ends where it began (so a quick press-and-drag still moves the field).
function ffOnRelease(e, fn) {
  const x = e.clientX, y = e.clientY;
  const up = (ev) => { window.removeEventListener('pointerup', up); if (Math.hypot(ev.clientX - x, ev.clientY - y) < 5) fn(); };
  window.addEventListener('pointerup', up);
}
// Drag a corner: the opposite corner stays where it is.
function ffResize(e, v, m, k) {
  e.stopPropagation(); e.preventDefault();
  const before = snapshot(), [X0, Y0, X1, Y1] = ffBox(m);
  const corners = [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]], fixed = corners[(k + 2) % 4];
  let moved = false;
  const move = (ev) => {
    const [px, py] = toPdf(v, ...localPoint(ev, v));
    m.x1 = fixed[0]; m.y1 = fixed[1]; m.x2 = px; m.y2 = py;
    if (Math.abs(m.x2 - m.x1) < 6) m.x2 = m.x1 + (m.x2 < m.x1 ? -6 : 6);
    if (Math.abs(m.y2 - m.y1) < 6) m.y2 = m.y1 + (m.y2 < m.y1 ? -6 : 6);
    moved = true; drawMarks(v);
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (moved) { [m.x1, m.y1, m.x2, m.y2] = ffBox(m); changed(before); } };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
FEATURE.markTypes.ff = {
  draw: ffDraw,
  // Collected here and made in one go once every page is in the saved PDF (see the saveDoc step below).
  save({ p, m, ctx }) { (ctx.ffNew || (ctx.ffNew = [])).push({ p, m }); },
};

/* ---- the tools: drag a box to add a field ---- */
function ffNew(kind, v, x1, y1, x2, y2) {
  const m = { id: uid(), type: 'ff', kind, x1, y1, x2, y2, rot: totalRot(v), name: ffNextName(kind), tip: '', req: false, ro: false, val: '', size: 0 };
  if (kind === 'text') Object.assign(m, { multi: false, max: 0 });
  if (kind === 'date') m.fmt = FF_DATE_FORMATS[0];
  if (kind === 'combo' || kind === 'list') m.opts = ['Option 1', 'Option 2', 'Option 3'];
  if (kind === 'check') { m.exp = 'Yes'; m.val = false; }
  if (kind === 'radio') {
    const group = ffLastRadio && ffMarks().some((r) => r.kind === 'radio' && r.name === ffLastRadio) ? ffLastRadio : ffNextName('radio');
    const taken = new Set(ffMarks().filter((r) => r.kind === 'radio' && r.name === group).map((r) => r.exp));
    let n = 1; while (taken.has('Choice' + n)) n++;
    Object.assign(m, { name: group, exp: 'Choice' + n, val: false });
    ffLastRadio = group;
  }
  if (kind === 'button') Object.assign(m, { label: 'Button', act: 'none', url: '' });
  return m;
}
function ffToolDown(kind) {
  return (e, v) => {
    const hit = e.target.closest && e.target.closest('.ff-mk');
    if (hit) { // a new field: select it and move it
      const m = marksOf(v.entry).find((x) => x.id === hit.dataset.id);
      ffSelectX(null); selectMark({ key: pageKey(v.entry), id: hit.dataset.id, entry: v.entry });
      if (m) startMove(e, v, m);
      return;
    }
    e.preventDefault();
    ffSelectX(null);
    const before = snapshot();
    const [sx, sy] = toPdf(v, ...localPoint(e, v));
    const m = ffNew(kind, v, sx, sy, sx, sy);
    marksOf(v.entry).push(m);
    let dragged = false;
    const move = (ev) => { [m.x2, m.y2] = toPdf(v, ...localPoint(ev, v)); dragged = Math.abs(m.x2 - m.x1) > 4 || Math.abs(m.y2 - m.y1) > 4; drawMarks(v); };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (!dragged) { // a click: the usual size, with its top-left corner where you clicked (upright as you see the page)
        const K = FF_KINDS[kind], [px, py] = localPoint(e, v), sw = K.w * scale, sh = K.h * scale;
        [m.x1, m.y1] = toPdf(v, px, py); [m.x2, m.y2] = toPdf(v, px + sw, py + sh);
      } else if (kind === 'check' || kind === 'radio') { // square
        const [X0, Y0, X1, Y1] = ffBox(m), s0 = Math.max(8, Math.min(X1 - X0, Y1 - Y0));
        m.x2 = m.x1 + (m.x2 < m.x1 ? -s0 : s0); m.y2 = m.y1 + (m.y2 < m.y1 ? -s0 : s0);
      }
      [m.x1, m.y1, m.x2, m.y2] = ffBox(m);
      selMark = { key: pageKey(v.entry), id: m.id, entry: v.entry };
      drawMarks(v); changed(before);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
}
for (const [kind, K] of Object.entries(FF_KINDS)) {
  const t = 'ff_' + kind;
  FEATURE.tools[t] = { down: ffToolDown(kind) };
  cmd(t, { label: K.label, icon: K.icon, enabled: has, pressed: () => app.dataset.tool === t, run: () => { setTool(t); ffLoadKnown(); } });
}
FEATURE.tools.ff_edit = { down: (e, v) => { // Edit fields: pick a new field (the fields already in the PDF have their own layer)
  const hit = e.target.closest && e.target.closest('.ff-mk');
  ffSelectX(null);
  if (!hit) { selectMark(null); return; }
  const m = marksOf(v.entry).find((x) => x.id === hit.dataset.id);
  selectMark({ key: pageKey(v.entry), id: hit.dataset.id, entry: v.entry });
  if (m) startMove(e, v, m);
} };
cmd('ff_edit', { label: 'Edit fields', icon: 'square-mouse-pointer', enabled: has, pressed: () => app.dataset.tool === 'ff_edit', run: () => { setTool('ff_edit'); ffLoadKnown(); } });

/* ---- fields already in the PDF: outlined while a form tool is chosen ---- */
async function ffWidgets(v) {
  if (!v.ffWidgets) { try { v.ffWidgets = (await v.page.getAnnotations({ intent: 'display' })).filter((a) => a.annotationType === pdfjs.AnnotationType.WIDGET && a.fieldName && a.rect); } catch { v.ffWidgets = []; } }
  return v.ffWidgets;
}
function ffGone(entry) { return new Set(marksOf(entry).filter((m) => m.type === 'ae' && m.deleted).map((m) => m.ref)); }
function ffLayer(v) {
  if (!doc || !v.rendered || !v.el.isConnected) return;
  ffFillLayer(v);
  app.dataset.ffflat = ffFlat() ? 'on' : 'off';
  let s = v.el.querySelector('svg.ff-layer');
  if (!s) {
    s = svgEl('svg', { class: 'ff-layer' }); v.el.appendChild(s);
    s.addEventListener('pointerdown', (e) => ffLayerDown(e, v));
  }
  s.setAttribute('viewBox', `0 0 ${v.viewport.width} ${v.viewport.height}`);
  s.innerHTML = '';
  const gone = ffGone(v.entry), flat = ffFlat();
  for (const a of v.ffWidgets || []) {
    if (gone.has(a.id) || flat) continue;
    const [x0, y0, x1, y1] = a.rect, pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => toView(v, x, y));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), x = Math.min(...xs), y = Math.min(...ys);
    const g = svgEl('g', { class: 'ffx-g' });
    const r = svgEl('rect', { class: 'ffx' + (ffSelX === a.fieldName ? ' sel' : ''), x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y });
    r.dataset.name = a.fieldName; g.appendChild(r);
    g.appendChild(ffTag(x, y, ffShown(a.fieldName)));
    s.appendChild(g);
  }
  const key = pageKey(v.entry);
  for (const pr of ffProposals.filter((q) => q.key === key)) {
    const pts = [[pr.x1, pr.y1], [pr.x2, pr.y2]].map(([x, y]) => toView(v, x, y));
    const x = Math.min(pts[0][0], pts[1][0]), y = Math.min(pts[0][1], pts[1][1]);
    const g = svgEl('g', { class: 'ff-prop' }); g.dataset.pid = pr.pid;
    g.appendChild(svgEl('rect', { x, y, width: Math.abs(pts[1][0] - pts[0][0]), height: Math.abs(pts[1][1] - pts[0][1]), rx: 2 }));
    const t = svgEl('title', {}); t.textContent = `Add ${FF_KINDS[pr.kind].label.toLowerCase()}`; g.appendChild(t);
    const pw = Math.abs(pts[1][0] - pts[0][0]), ph = Math.abs(pts[1][1] - pts[0][1]);
    const b = svgEl('g', { class: 'ff-plus', transform: pw < 30 ? `translate(${x - 20} ${y + ph / 2 - 8})` : `translate(${x - 8} ${y - 8})` });
    b.appendChild(svgEl('circle', { cx: 8, cy: 8, r: 8 })); b.appendChild(svgEl('path', { d: 'M8 4v8M4 8h8' }));
    g.appendChild(b);
    s.appendChild(g);
  }
}
function ffLayerDown(e, v) {
  const pg = e.target.closest('.ff-prop');
  if (pg) { e.preventDefault(); e.stopPropagation(); ffAddProposals([pg.dataset.pid]); return; }
  const r = e.target.closest('.ffx'); if (!r || !ffIsTool()) return;
  e.preventDefault(); e.stopPropagation();
  selectMark(null); ffSelectX(r.dataset.name);
  if (ffIsDouble(e, 'x:' + r.dataset.name)) ffOnRelease(e, () => ffPropsExisting(r.dataset.name));
}
function ffSelectX(name) {
  if (ffSelX === name) return;
  ffSelX = name; views.forEach((v) => ffLayer(v)); refreshRibbon();
}
FEATURE.afterRender.push((v) => {
  v.ffWidgets = null;
  ffWidgets(v).then(() => ffLayer(v));
  // The marks are drawn again after every change and undo: draw this layer again with them.
  const ms = v.el.querySelector('svg.marks');
  if (ms && !ms.__ffObs) { ms.__ffObs = new MutationObserver(() => ffLayer(v)); ms.__ffObs.observe(ms, { childList: true }); }
});

async function ffDeleteExisting(name) {
  const before = snapshot(), done = new Set();
  for (const entry of doc.pages) {
    const key = pageKey(entry); if (done.has(key)) continue; done.add(key);
    let annots = []; try { annots = await (await pageOf(entry)).getAnnotations({ intent: 'display' }); } catch {}
    const gone = ffGone(entry);
    for (const a of annots) if (a.annotationType === pdfjs.AnnotationType.WIDGET && a.fieldName === name && !gone.has(a.id)) marksOf(entry).push({ id: uid(), type: 'ae', ref: a.id, rect: a.rect, subtype: 'Widget', deleted: true });
  }
  const md = ffModOf(name); if (md) md.del = true; else docMarks().push({ id: uid(), type: 'ffmod', name, del: true });
  ffSelX = null; changed(before);
  syncHiddenComments();
  toast('Field deleted');
}
function ffDeleteSelected() {
  if (ffSelX) return ffDeleteExisting(ffSelX);
  if (selMark) deleteSelected();
}
document.addEventListener('keydown', (e) => {
  if ($('#dialog').open || !ffSelX || selMark) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); ffDeleteExisting(ffSelX); }
  if (e.key === 'Escape') ffSelectX(null);
});

/* ---- properties ---- */
const ffChk = (id, label, on) => `<label class="ff-chk"><input type="checkbox" id="${id}"${on ? ' checked' : ''}> ${esc(label)}</label>`;
const ffInp = (id, label, value, attrs = '') => `<label class="field"><span>${esc(label)}</span><input id="${id}" value="${esc(value ?? '')}" autocomplete="off" ${attrs}></label>`;
const ffSel = (id, label, opts, value) => `<label class="field"><span>${esc(label)}</span><select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
async function ffProps(id) {
  const f = ffFind(id); if (!f || f.m.type !== 'ff') return;
  const m = f.m, k = m.kind, K = FF_KINDS[k];
  const sizes = FF_SIZES.map((n) => [n, n ? n + ' pt' : 'Auto']);
  let html = `<div class="ff-props">${ffInp('ffName', k === 'radio' ? 'Group name' : 'Name', m.name)}${ffInp('ffTip', 'Tooltip', m.tip, 'placeholder="Shown on hover"')}`;
  if (k === 'text') html += ffInp('ffVal', 'Default value', m.val);
  if (k === 'date') html += ffSel('ffFmt', 'Date format', FF_DATE_FORMATS.map((x) => [x, x]), m.fmt) + ffInp('ffVal', 'Default value', m.val, `placeholder="${esc(m.fmt)}"`);
  if (k === 'combo' || k === 'list') html += `<label class="field ff-wide"><span>Options, one per line</span><textarea id="ffOpts" rows="4">${esc((m.opts || []).join('\n'))}</textarea></label>` + ffInp('ffVal', 'Default choice', m.val, 'placeholder="None"');
  if (k === 'check' || k === 'radio') html += ffInp('ffExp', 'Export value', m.exp);
  if (k === 'button') html += ffInp('ffLabel', 'Label', m.label) + ffSel('ffAct', 'When clicked', [['none', 'Nothing'], ['reset', 'Reset the form'], ['url', 'Open a link']], m.act) + ffInp('ffUrl', 'Link', m.url, 'placeholder="https://"');
  if (k === 'text') html += ffInp('ffMax', 'Maximum characters', m.max || '', 'type="number" min="0" placeholder="No limit"');
  if (k !== 'check' && k !== 'radio' && k !== 'sig') html += ffSel('ffSize', 'Font size', sizes, m.size || 0);
  html += `<div class="ff-checks ff-wide">${k === 'text' ? ffChk('ffMulti', 'Multiple lines', m.multi) : ''}${k === 'check' ? ffChk('ffOn', 'Ticked to start with', m.val) : ''}${k === 'radio' ? ffChk('ffOn', 'Chosen to start with', m.val) : ''}${ffChk('ffReq', 'Required', m.req)}${ffChk('ffRo', 'Read-only', m.ro)}</div></div>`;
  const a = await dialog(`${K.label} properties`, html, [{ label: 'Delete field', value: 'delete', danger: true }, { label: 'Cancel' }, { label: 'Save', value: 'save', primary: true }], (dlg) => {
    const act = $('#ffAct', dlg), url = $('#ffUrl', dlg);
    if (act && url) { const sync = () => { url.closest('.field').hidden = act.value !== 'url'; }; act.onchange = sync; sync(); }
    const fmt = $('#ffFmt', dlg); if (fmt) fmt.onchange = () => { $('#ffVal', dlg).placeholder = fmt.value; };
    setTimeout(() => { const n = $('#ffName', dlg); n.focus(); n.select(); }, 0);
  });
  const dlg = $('#dialog');
  if (a === 'delete') { const before = snapshot(); const list = f.key ? doc.marks[f.key] : marksOf(f.v.entry); list.splice(list.indexOf(m), 1); selMark = null; views.forEach((v) => v.rendered && drawMarks(v)); changed(before); toast('Field deleted'); return; }
  if (a !== 'save') return;
  const val = (sel) => { const e = $(sel, dlg); return e ? e.value : undefined; }, on = (sel) => { const e = $(sel, dlg); return e ? e.checked : undefined; };
  const before = snapshot();
  let name = ffClean(val('#ffName')) || m.name;
  if (name !== m.name) {
    const used = ffNames(m.id);
    // Radio buttons with the same name are one group; anything else needs a name of its own.
    const sameGroup = k === 'radio' && ffMarks().some((r) => r.id !== m.id && r.kind === 'radio' && r.name === name);
    if (used.has(name) && !sameGroup) { let n = 2; while (used.has(`${name} ${n}`)) n++; toast(`A field is already called ${name}. This one is ${name} ${n}.`); name = `${name} ${n}`; }
  }
  m.name = name; if (k === 'radio') ffLastRadio = name;
  m.tip = val('#ffTip').trim(); m.req = on('#ffReq'); m.ro = on('#ffRo');
  if (val('#ffSize') !== undefined) m.size = +val('#ffSize') || 0;
  if (k === 'text') { m.multi = on('#ffMulti'); m.max = Math.max(0, parseInt(val('#ffMax'), 10) || 0); m.val = m.max ? val('#ffVal').slice(0, m.max) : val('#ffVal'); if (!m.multi) m.val = m.val.replace(/\n/g, ' '); }
  if (k === 'date') { m.fmt = val('#ffFmt'); m.val = val('#ffVal').trim(); }
  if (k === 'combo' || k === 'list') {
    m.opts = [...new Set(val('#ffOpts').split('\n').map((x) => x.trim()).filter(Boolean))];
    const d = val('#ffVal').trim(); m.val = m.opts.includes(d) ? d : '';
    if (d && !m.val) toast(`${d} is not one of the options, so nothing is chosen to start with`);
  }
  if (k === 'check' || k === 'radio') {
    m.exp = ffClean(val('#ffExp')) || (k === 'check' ? 'Yes' : m.exp); m.val = on('#ffOn');
    if (k === 'radio' && m.val) for (const r of ffMarks()) if (r !== m && r.kind === 'radio' && r.name === m.name) r.val = false;
  }
  if (k === 'button') { m.label = val('#ffLabel'); m.act = val('#ffAct'); m.url = val('#ffUrl').trim(); if (m.act === 'url' && m.url && !/^[a-z][a-z0-9+.-]*:/i.test(m.url)) m.url = 'https://' + m.url; }
  views.forEach((v) => v.rendered && drawMarks(v)); changed(before);
  toast('Field updated');
}
async function ffPropsExisting(name) {
  const v = views.find((vv) => (vv.ffWidgets || []).some((a) => a.fieldName === name));
  const a0 = v && v.ffWidgets.find((a) => a.fieldName === name); if (!a0) return;
  const md = ffModOf(name) || {};
  const html = `<div class="ff-props">${ffInp('ffName', 'Name', ffShown(name))}${ffInp('ffTip', 'Tooltip', md.tip ?? a0.alternativeText ?? '', 'placeholder="Shown on hover"')}<div class="ff-checks ff-wide">${ffChk('ffReq', 'Required', md.req ?? a0.required)}${ffChk('ffRo', 'Read-only', md.ro ?? a0.readOnly)}</div></div>`;
  const a = await dialog('Field properties', html, [{ label: 'Delete field', value: 'delete', danger: true }, { label: 'Cancel' }, { label: 'Save', value: 'save', primary: true }], (dlg) => setTimeout(() => { const n = $('#ffName', dlg); n.focus(); n.select(); }, 0));
  if (a === 'delete') return ffDeleteExisting(name);
  if (a !== 'save') return;
  const dlg = $('#dialog');
  let newName = ffClean($('#ffName', dlg).value) || ffShown(name);
  if (newName !== ffShown(name) && ffNames().has(newName)) { toast(`A field is already called ${newName}`); newName = ffShown(name); }
  const before = snapshot();
  let mod = ffModOf(name); if (!mod) { mod = { id: uid(), type: 'ffmod', name }; docMarks().push(mod); }
  mod.newName = newName === name ? undefined : newName;
  mod.tip = $('#ffTip', dlg).value.trim(); mod.req = $('#ffReq', dlg).checked; mod.ro = $('#ffRo', dlg).checked;
  changed(before); views.forEach((vv) => ffLayer(vv));
  toast('Field updated');
}
function ffPropsSelected() {
  if (ffSelX) return ffPropsExisting(ffSelX);
  if (selMark) { const f = ffFind(selMark.id); if (f && f.m.type === 'ff') ffProps(f.m.id); }
}
const ffSelectedNew = () => { if (!selMark || !doc) return false; const f = ffFind(selMark.id); return !!f && f.m.type === 'ff'; };

/* ---- Recognize form ---- */
async function ffScanPage(entry) {
  const page = await pageOf(entry), cm = await contentMap(page);
  const ops = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE });
  const O = pdfjs.OPS, found = [];
  // Blank lines typed as underscores, and ☐ boxes typed as characters
  const texts = [];
  for (const L of cm.lines) {
    const f = lineFrame(L); if (Math.abs(f.u[1]) > .01 || f.u[0] < 0) { texts.push(quadBox(L.quad)); continue; }
    const glyphs = cm.glyphs.get(L.fontName), chars = [...L.str];
    const cw = chars.map((c) => (glyphs && glyphs.get(c) && glyphs.get(c).w) || (c === ' ' ? 280 : 550));
    const total = cw.reduce((a, b) => a + b, 0) || 1, at = (i) => L.width * cw.slice(0, i).reduce((a, b) => a + b, 0) / total;
    const [ox, oy] = f.o, size = f.size;
    // The words around the blanks count as text; the blanks don't
    const words = (i, j) => { if (chars.slice(i, j).join('').trim()) texts.push([ox + at(i), oy + L.descent * size, ox + at(j), oy + L.ascent * size]); };
    let last = 0;
    for (const mm of L.str.matchAll(/_{3,}|[☐□]/g)) {
      const i = [...L.str.slice(0, mm.index)].length, j = i + [...mm[0]].length;
      const x0 = ox + at(i), x1 = ox + at(j);
      if (mm[0][0] === '_') { if (x1 - x0 >= 18) found.push({ kind: 'text', x1: x0, y1: oy - size * .1, x2: x1, y2: oy - size * .1 + Math.max(14, size * 1.35), why: 'line' }); }
      else { const sq = size * .7; found.push({ kind: 'check', x1: x0 + (x1 - x0 - sq) / 2, y1: oy, x2: x0 + (x1 - x0 + sq) / 2, y2: oy + sq, why: 'box' }); }
      words(last, i); last = j;
    }
    words(last, chars.length);
  }
  // Drawn lines and empty boxes
  const stroke = new Set([O.stroke, O.closeStroke, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
  const fill = new Set([O.fill, O.eoFill]);
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], a = ops.argsArray[i];
    if (fn === O.save) stack.push(ctm);
    else if (fn === O.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === O.transform) ctm = mul(a, ctm);
    else if (fn === O.paintFormXObjectBegin) { stack.push(ctm); if (a && a[0]) ctm = mul(a[0], ctm); }
    else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === O.constructPath && a && (stroke.has(a[0]) || fill.has(a[0])) && a[1] && a[1][0]) {
      if (Math.abs(ctm[1]) > .001 || Math.abs(ctm[2]) > .001) continue; // only upright drawings
      const buf = a[1][0], subs = []; let cur = null;
      for (let k = 0; k < buf.length;) {
        const op = buf[k++];
        if (op === 0) { cur = { pts: [[buf[k], buf[k + 1]]], curved: false }; subs.push(cur); k += 2; }
        else if (op === 1) { if (cur) cur.pts.push([buf[k], buf[k + 1]]); k += 2; }
        else if (op === 2) { if (cur) { cur.curved = true; cur.pts.push([buf[k + 4], buf[k + 5]]); } k += 6; }
        else if (op === 3) { if (cur) { cur.curved = true; cur.pts.push([buf[k + 2], buf[k + 3]]); } k += 4; }
      }
      for (const sp of subs) {
        if (sp.curved || sp.pts.length < 2) continue;
        const P = sp.pts.map(([x, y]) => apply(ctm, x, y)), xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), w = x1 - x0, h = y1 - y0;
        if (h <= 1.6 && w >= 36) found.push({ kind: 'text', x1: x0, y1: y1 + .5, x2: x1, y2: y1 + 18.5, why: 'line' });
        else if (stroke.has(a[0]) && sp.pts.length >= 4 && w >= 6 && w <= 24 && Math.abs(w - h) <= 2.5) found.push({ kind: 'check', x1: x0 + 1, y1: y0 + 1, x2: x1 - 1, y2: y1 - 1, why: 'box' });
        else if (stroke.has(a[0]) && sp.pts.length >= 4 && w >= 40 && h >= 12 && h <= 40) found.push({ kind: 'text', x1: x0 + 1.5, y1: y0 + 1.5, x2: x1 - 1.5, y2: y1 - 1.5, why: 'box' });
      }
    }
  }
  // Not where there is text, a field already, or another proposal
  const inter = (p, q) => Math.max(0, Math.min(p[2], q[2]) - Math.max(p[0], q[0])) * Math.max(0, Math.min(p[3], q[3]) - Math.max(p[1], q[1]));
  const area = (p) => (p[2] - p[0]) * (p[3] - p[1]);
  let annots = []; try { annots = await page.getAnnotations({ intent: 'display' }); } catch {}
  const gone = ffGone(entry);
  const taken = annots.filter((x) => x.annotationType === pdfjs.AnnotationType.WIDGET && x.rect && !gone.has(x.id)).map((x) => x.rect)
    .concat(marksOf(entry).filter((m) => m.type === 'ff').map(ffBox));
  const out = [];
  for (const c of found) {
    const r = [c.x1, c.y1, c.x2, c.y2];
    if (texts.some((t) => inter(t, r) > area(r) * (c.why === 'box' ? .02 : .25))) continue;
    if (taken.concat(out.map((o) => [o.x1, o.y1, o.x2, o.y2])).some((t) => inter(t, r) > Math.min(area(t), area(r)) * .4)) continue;
    out.push(c);
  }
  return out;
}
async function ffRecognize() {
  ffProposals = [];
  const done = new Set();
  for (const entry of doc.pages) {
    const key = pageKey(entry); if (done.has(key)) continue; done.add(key);
    try { for (const c of await ffScanPage(entry)) ffProposals.push({ pid: uid(), key, kind: c.kind, x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2 }); } catch (e) { console.warn('recognize', e); }
  }
  views.forEach((v) => ffLayer(v)); ffBar();
  if (!ffProposals.length) { toast('No blank lines or empty boxes found'); return; }
  const first = doc.pages.findIndex((e) => pageKey(e) === ffProposals[0].key);
  if (first >= 0 && first !== current) goPage(first);
}
function ffAddProposals(pids) {
  const list = ffProposals.filter((p) => pids.includes(p.pid)); if (!list.length) return;
  const before = snapshot();
  for (const pr of list) {
    const entry = doc.pages.find((e) => pageKey(e) === pr.key); if (!entry) continue;
    const v = views.find((vv) => vv.entry === entry); if (!v) continue;
    const m = ffNew(pr.kind, v, pr.x1, pr.y1, pr.x2, pr.y2);
    marksOf(entry).push(m);
  }
  ffProposals = ffProposals.filter((p) => !pids.includes(p.pid));
  views.forEach((v) => v.rendered && drawMarks(v)); changed(before); ffBar();
  toast(list.length === 1 ? `${FF_KINDS[list[0].kind].label} added` : `${list.length} fields added`);
}
// The bar under the pages while there are proposals to review.
function ffBar() {
  let bar = $('#ffBar');
  if (!ffProposals.length) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'ffBar'; bar.className = 'ff-bar'; bar.setAttribute('role', 'status');
    document.body.appendChild(bar);
    bar.addEventListener('click', (e) => { const b = e.target.closest('[data-ff]'); if (!b) return; if (b.dataset.ff === 'all') ffAddProposals(ffProposals.map((p) => p.pid)); else { ffProposals = []; views.forEach((v) => ffLayer(v)); ffBar(); } });
  }
  const n = ffProposals.length;
  bar.innerHTML = `<span>${n} possible ${n === 1 ? 'field' : 'fields'} found. Click one to add it.</span><button type="button" class="btn primary" data-ff="all">Add all</button><button type="button" class="btn" data-ff="done">Done</button>`;
}

/* ---- Clear form and Flatten form ---- */
async function ffClear() {
  const a = await dialog('Clear form', '<p>Empty every field and untick every box?</p>', [{ label: 'Cancel' }, { label: 'Clear form', value: 'clear-form', primary: true }]);
  if (a !== 'clear-form') return;
  let n = 0;
  for (const { pd, a: f } of await ffAllWidgets()) {
    if (f.fieldType === 'Sig' || f.pushButton) continue;
    const value = f.checkBox || f.radioButton ? false : f.fieldType === 'Ch' ? [] : '';
    pd.annotationStorage.setValue(f.id, { value }); n++;
  }
  const before = snapshot(); let k = 0;
  for (const m of ffMarks()) if (m.val && m.kind !== 'button') { m.val = typeof m.val === 'boolean' ? false : ''; k++; }
  if (k) changed(before); else setSaved(false);
  for (const v of views) if (v.rendered) rerenderView(v);
  toast(n || k ? 'Form cleared' : 'This PDF has no fields to clear');
}
async function ffFlatten() {
  if (ffFlat()) { const before = snapshot(); doc.marks.__doc = docMarks().filter((m) => m.type !== 'ffflat'); changed(before); views.forEach((v) => { if (v.rendered) { drawMarks(v); ffLayer(v); } }); toast('Form fields can be filled in again'); return; }
  const a = await dialog('Flatten form', '<p>When you save, the fields become part of the page: what is filled in stays as it is, and can no longer be changed.</p>', [{ label: 'Cancel' }, { label: 'Flatten form', value: 'flatten', primary: true }]);
  if (a !== 'flatten') return;
  const before = snapshot(); docMarks().push({ id: uid(), type: 'ffflat' }); ffSelX = null; selectMark(null);
  changed(before); views.forEach((v) => { if (v.rendered) { drawMarks(v); ffLayer(v); } });
  toast('Form flattened');
}

/* ---- saving ---- */
// Put the form in order before pdf-lib reads it: entries for widgets deleted from the pages (or on a deleted page)
// go, and fields whose widgets are on the pages are listed (pages copied in from another PDF are not on its list).
function ffFixAcroForm(L, out, pages) {
  const { PDFName, PDFArray, PDFDict, PDFRef } = L, c = out.context;
  const hasWidget = pages.some((p) => { const a = p.node.lookup(PDFName.of('Annots')); return a instanceof PDFArray && a.asArray().some((r) => { const d = c.lookup(r); return d instanceof PDFDict && String(d.get(PDFName.of('Subtype'))) === '/Widget'; }); });
  if (!out.catalog.get(PDFName.of('AcroForm')) && !hasWidget) return; // no form: don't add one
  const af = out.catalog.getOrCreateAcroForm().dict;
  let fields = af.lookup(PDFName.of('Fields'));
  if (!(fields instanceof PDFArray)) { fields = c.obj([]); af.set(PDFName.of('Fields'), fields); }
  // Each widget on a page names that page (a copied page's widgets named a copy of the page they came from).
  const onPage = new Set(pages.map((p) => p.ref.tag)), shown = new Set();
  for (const p of pages) {
    const annots = p.node.lookup(PDFName.of('Annots')); if (!(annots instanceof PDFArray)) continue;
    for (const r of annots.asArray()) {
      const d = c.lookup(r); if (!(d instanceof PDFDict) || String(d.get(PDFName.of('Subtype'))) !== '/Widget') continue;
      if (r instanceof PDFRef) shown.add(r.tag);
      if (d.get(PDFName.of('P'))) d.set(PDFName.of('P'), p.ref);
    }
  }
  // A widget whose page was deleted
  const offPage = (r, d) => { const P = d.get(PDFName.of('P')); return String(d.get(PDFName.of('Subtype'))) === '/Widget' && P instanceof PDFRef && !onPage.has(P.tag) && !(r instanceof PDFRef && shown.has(r.tag)); };
  const clean = (arr) => {
    for (let k = arr.size() - 1; k >= 0; k--) {
      const r = arr.get(k), d = r instanceof PDFRef ? c.lookup(r) : r;
      if (!(d instanceof PDFDict) || offPage(r, d)) { arr.remove(k); continue; }
      const kids = d.lookup(PDFName.of('Kids'));
      if (kids instanceof PDFArray && kids.size()) { clean(kids); if (!kids.size()) arr.remove(k); }
    }
  };
  clean(fields);
  const listed = new Set();
  for (let k = 0; k < fields.size(); k++) { const r = fields.get(k); if (r instanceof PDFRef) listed.add(r.tag); }
  for (const p of pages) {
    const annots = p.node.lookup(PDFName.of('Annots')); if (!(annots instanceof PDFArray)) continue;
    for (let k = 0; k < annots.size(); k++) {
      let r = annots.get(k), d = c.lookup(r);
      if (!(d instanceof PDFDict) || String(d.get(PDFName.of('Subtype'))) !== '/Widget') continue;
      for (let n = 0; n < 32; n++) { const pr = d.get(PDFName.of('Parent')); const pd = pr instanceof PDFRef ? c.lookup(pr) : null; if (!(pd instanceof PDFDict)) break; r = pr; d = pd; }
      if (r instanceof PDFRef && !listed.has(r.tag) && (d.get(PDFName.of('T')) || d.get(PDFName.of('FT')))) { fields.push(r); listed.add(r.tag); }
    }
  }
}
// Where pdf-lib should place a widget so that its rectangle is the field's box, upright for the person who drew it.
function ffPlace(L, m, bw) {
  const [X0, Y0, X1, Y1] = ffBox(m), W = X1 - X0, H = Y1 - Y0, b = bw / 2, r = ((m.rot || 0) % 360 + 360) % 360;
  const o = r === 90 ? { x: X0 + W - b, y: Y0 + b, width: H - bw, height: W - bw }
    : r === 180 ? { x: X0 + W - b, y: Y0 + H - b, width: W - bw, height: H - bw }
      : r === 270 ? { x: X0 + b, y: Y0 + H - b, width: H - bw, height: W - bw }
        : { x: X0 + b, y: Y0 + b, width: W - bw, height: H - bw };
  return { ...o, borderWidth: bw, rotate: L.degrees(r) };
}
async function ffSaveNew(L, out, form, list) {
  const { PDFName, PDFHexString, PDFString, PDFDict, rgb } = L, c = out.context;
  const grey = rgb(.55, .55, .6), black = rgb(0, 0, 0), white = rgb(1, 1, 1);
  const names = new Set(form.getFields().map((f) => f.getName()));
  const unique = (n) => { let s = n, k = 2; while (names.has(s)) s = `${n} ${k++}`; names.add(s); return s; };
  const common = (f, m) => {
    if (m.tip) f.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(m.tip));
    if (m.req) f.enableRequired();
    if (m.ro) f.enableReadOnly();
  };
  const groups = new Map();
  for (const { p, m } of list) {
    if (m.kind === 'radio') { const g = groups.get(m.name) || []; g.push({ p, m }); groups.set(m.name, g); continue; }
    const name = unique(ffClean(m.name) || FF_KINDS[m.kind].base);
    if (m.kind === 'text' || m.kind === 'date') {
      const f = form.createTextField(name);
      if (m.multi) f.enableMultiline();
      if (m.max > 0) f.setMaxLength(m.max);
      if (m.val) { f.setText(m.max ? m.val.slice(0, m.max) : m.val); f.acroField.dict.set(PDFName.of('DV'), PDFHexString.fromText(m.val)); }
      f.addToPage(p, { ...ffPlace(L, m, 1), borderColor: grey, backgroundColor: undefined, textColor: black });
      if (m.size) f.setFontSize(m.size);
      if (m.kind === 'date') {
        const js = (s) => c.obj({ S: 'JavaScript', JS: PDFString.of(s) });
        const fmt = m.fmt || FF_DATE_FORMATS[0];
        f.acroField.dict.set(PDFName.of('AA'), c.obj({ K: js(`AFDate_KeystrokeEx("${fmt}");`), F: js(`AFDate_FormatEx("${fmt}");`) }));
      }
      common(f, m);
    } else if (m.kind === 'check') {
      const f = form.createCheckBox(name);
      f.addToPage(p, { ...ffPlace(L, m, 1), borderColor: black, backgroundColor: white, textColor: black });
      const exp = ffClean(m.exp) || 'Yes';
      if (exp !== 'Yes') for (const w of f.acroField.getWidgets()) { // the "on" look is named after the export value
        const ap = w.dict.lookup(PDFName.of('AP'));
        if (ap instanceof PDFDict) for (const k of ['N', 'D']) { const s = ap.lookup(PDFName.of(k)); if (s instanceof PDFDict && s.get(PDFName.of('Yes'))) { s.set(PDFName.of(exp), s.get(PDFName.of('Yes'))); s.delete(PDFName.of('Yes')); } }
      }
      if (m.val) { f.check(); f.acroField.dict.set(PDFName.of('DV'), PDFName.of(exp)); }
      common(f, m);
    } else if (m.kind === 'combo' || m.kind === 'list') {
      const f = m.kind === 'combo' ? form.createDropdown(name) : form.createOptionList(name);
      if (m.opts && m.opts.length) f.setOptions(m.opts);
      if (m.val && (m.opts || []).includes(m.val)) { f.select(m.val); f.acroField.dict.set(PDFName.of('DV'), PDFHexString.fromText(m.val)); }
      f.addToPage(p, { ...ffPlace(L, m, 1), borderColor: grey, backgroundColor: m.kind === 'list' ? white : undefined, textColor: black });
      if (m.size) f.setFontSize(m.size);
      common(f, m);
    } else if (m.kind === 'button') {
      const f = form.createButton(name);
      f.addToPage(m.label || 'Button', p, { ...ffPlace(L, m, 1), borderColor: black, backgroundColor: rgb(.75, .75, .75), textColor: black });
      if (m.size) f.setFontSize(m.size);
      const action = m.act === 'reset' ? c.obj({ S: 'ResetForm' }) : m.act === 'url' && m.url ? c.obj({ S: 'URI', URI: PDFString.of(m.url) }) : null;
      if (action) for (const w of f.acroField.getWidgets()) w.dict.set(PDFName.of('A'), action);
      common(f, m);
    } else if (m.kind === 'sig') {
      // pdf-lib has no way to make a signature field: an empty /Sig field, with its widget and a border to sign in.
      const [X0, Y0, X1, Y1] = ffBox(m), w = X1 - X0, h = Y1 - Y0, r = ((m.rot || 0) % 360 + 360) % 360;
      const ap = c.register(c.stream(`0.55 0.55 0.6 RG 1 w 0.5 0.5 ${(w - 1).toFixed(2)} ${(h - 1).toFixed(2)} re S`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h] }));
      const dict = c.obj({ FT: 'Sig', T: PDFHexString.fromText(name), Type: 'Annot', Subtype: 'Widget', Rect: [X0, Y0, X1, Y1], F: 4, P: p.ref, MK: { BC: [.55, .55, .6], R: r }, AP: { N: ap } });
      if (m.tip) dict.set(PDFName.of('TU'), PDFHexString.fromText(m.tip));
      const ff = (m.ro ? 1 : 0) | (m.req ? 2 : 0); if (ff) dict.set(PDFName.of('Ff'), c.obj(ff));
      const ref = c.register(dict);
      p.node.addAnnot(ref);
      out.catalog.getOrCreateAcroForm().addField(ref);
    }
  }
  for (const [gname, items] of groups) {
    const name = unique(ffClean(gname) || 'Group');
    const g = form.createRadioGroup(name), used = new Set();
    let chosen = null;
    for (const { p, m } of items) {
      let exp = ffClean(m.exp) || 'Choice', e = exp, k = 2; while (used.has(e)) e = `${exp}${k++}`; used.add(e);
      g.addOptionToPage(e, p, { ...ffPlace(L, m, 1), borderColor: black, backgroundColor: white, textColor: black });
      if (m.val) chosen = e;
    }
    const lead = items[0].m;
    if (chosen) { g.select(chosen); g.acroField.dict.set(PDFName.of('DV'), PDFName.of(chosen)); }
    if (items.some((x) => x.m.tip)) g.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(items.find((x) => x.m.tip).m.tip));
    if (lead.req || items.some((x) => x.m.req)) g.enableRequired();
    if (items.some((x) => x.m.ro)) g.enableReadOnly();
  }
}
FEATURE.saveDoc.push(async ({ L, out, pages, ctx }) => {
  ffFixAcroForm(L, out, pages); // always: pages moved, deleted or copied in change which fields the PDF has
  const news = ctx.ffNew || [], mods = ffMods(), flat = ffFlat();
  if (!news.length && !mods.length && !flat) return;
  const { PDFName, PDFHexString } = L;
  const form = out.getForm();
  for (const md of mods) {
    const f = form.getFields().find((x) => x.getName() === md.name); if (!f) continue;
    try {
      if (md.del) { form.removeField(f); continue; }
      if (md.newName && md.newName !== md.name) f.acroField.dict.set(PDFName.of('T'), PDFHexString.fromText(md.newName));
      if (md.tip != null) { if (md.tip) f.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(md.tip)); else f.acroField.dict.delete(PDFName.of('TU')); }
      if (md.req != null) md.req ? f.enableRequired() : f.disableRequired();
      if (md.ro != null) md.ro ? f.enableReadOnly() : f.disableReadOnly();
    } catch (e) { console.warn('form field', md.name, e); }
  }
  if (news.length) await ffSaveNew(L, out, form, news);
  try { form.updateFieldAppearances(); } catch (e) { console.warn('field appearances', e); }
  if (flat) form.flatten({ updateFieldAppearances: false });
});

/* ---- commands, ribbon, menu ---- */
cmd('ffProps', { label: 'Properties…', icon: 'sliders-horizontal', enabled: () => has() && (!!ffSelX || ffSelectedNew()), run: ffPropsSelected });
FEATURE.markTypes.ff.menu = ['ffProps']; // in the mark's right-click menu
cmd('ffDelete', { label: 'Delete field', icon: 'trash-2', enabled: () => has() && (!!ffSelX || ffSelectedNew()), run: ffDeleteSelected });
cmd('ffRecognize', { label: 'Recognize form', icon: 'scan-search', enabled: has, run: ffRecognize });
// Clear and Flatten form only for a PDF with a form (its own fields, or ones added here).
let ffKnownSrcs = -1;
const ffHasForm = () => {
  if (pdfDocs.size !== ffKnownSrcs) { ffKnownSrcs = pdfDocs.size; ffLoadKnown().then(() => refreshRibbon()).catch(() => {}); } // a PDF inserted since
  return ffKnown.size > 0 || ffFlat() || Object.values(doc.marks).some((l) => Array.isArray(l) && l.some((m) => m && m.type === 'ff'));
};
cmd('ffClear', { label: 'Clear form…', icon: 'list-restart', enabled: () => has() && ffHasForm(), run: ffClear });
cmd('ffFlatten', { label: 'Flatten form', tip: 'Flatten form: make the form fields part of the page when you save. Comments stay comments.', icon: 'layers-2', enabled: () => has() && ffHasForm(), pressed: ffFlat, run: ffFlatten });
cmd('ffPreview', { label: 'Fill in', icon: 'pencil-line', enabled: () => has() && !ffFlat(), pressed: () => S.ribbon === 'forms' && ffFillOn && app.dataset.tool === 'select', run: ffPreview });
ribbonAdd('forms', 'Add fields', Object.keys(FF_KINDS).map((k) => 'ff_' + k));
ribbonAdd('forms', 'Fields', ['ff_edit', 'ffProps', 'ffDelete']);
ribbonAdd('forms', 'Form', ['ffPreview', 'ffRecognize', 'ffClear', 'ffFlatten']);
menuAdd('Forms', Object.keys(FF_KINDS).map((k) => 'ff_' + k));
menuAdd('Forms', ['ff_edit', 'ffProps', 'ffDelete']);
menuAdd('Forms', ['ffPreview', 'ffRecognize', 'ffClear', 'ffFlatten']);
TEST_HOOKS.ffProposals = () => ffProposals.map(({ kind, x1, y1, x2, y2 }) => ({ kind, x1, y1, x2, y2 }));

addStyle(`
.app[data-tool^="ff_"] .marks { cursor: crosshair; }
.app[data-tool="ff_edit"] .marks { cursor: default; }
.app[data-tool^="ff_"]:not([data-tool="ff_edit"]) .marks, .marks .ff-mk, .ff-layer .ffx { touch-action: none; } /* a finger draws or moves the field instead of scrolling */
.marks .ff-mk .ff-hit { fill: rgba(174, 23, 71, .06); }
.app[data-tool^="ff_"] .marks .ff-mk, .app[data-tool="select"] .marks .ff-mk { cursor: move; }
.marks .ff-tag, .ff-layer .ff-tag { display: none; pointer-events: none; }
.app[data-tool^="ff_"] .marks .ff-tag, .app[data-tool^="ff_"] .ff-layer .ff-tag, .marks .ff-mk.sel .ff-tag { display: block; }
.ff-tag rect { fill: #AE1747; }
.ff-tag text { fill: #fff; font: 600 10px/1 var(--font-ui); }
.ff-fill-layer { position: absolute; inset: 0; z-index: 5; pointer-events: none; }
.ff-fill-layer .ff-ctl { position: absolute; pointer-events: auto; transform-origin: 50% 50%; box-sizing: border-box; width: 100%; height: 100%; min-height: 0; min-width: 0; line-height: 1.1; margin: 0; padding: 0 2px; border: 0; border-radius: 0; font-family: Helvetica, Arial, sans-serif; color: #111; background: rgba(0, 54, 255, .13); outline: none; resize: none; }
.ff-fill-layer .ff-ctl:focus { background: transparent; box-shadow: inset 0 0 0 1px #2448C9; }
.ff-fill-layer .ff-ctl:disabled { background: transparent; }
.ff-fill-layer select.ff-ctl-list { padding: 0; }
.ff-fill-layer .ff-ctl-check, .ff-fill-layer .ff-ctl-radio { accent-color: #111; background: none; padding: 0; cursor: pointer; }
.ff-fill-layer .ff-ctl-radio { border-radius: 50%; }
.marks .ff-handle { fill: #fff; stroke: #AE1747; stroke-width: 1.5; cursor: nwse-resize; pointer-events: auto; }
.ff-layer { position: absolute; inset: 0; z-index: 5; overflow: visible; pointer-events: none; width: 100%; height: 100%; }
.ff-layer .ffx { display: none; fill: rgba(174, 23, 71, .05); stroke: #AE1747; stroke-width: 1; stroke-dasharray: 4 2; }
.app[data-tool^="ff_"] .ff-layer .ffx { display: block; pointer-events: auto; cursor: pointer; }
.ff-layer .ffx.sel { fill: rgba(174, 23, 71, .14); stroke-width: 2; stroke-dasharray: none; }
.ff-layer .ff-prop { pointer-events: auto; cursor: copy; }
.ff-layer .ff-prop rect { fill: rgba(36, 72, 201, .10); stroke: #2448C9; stroke-width: 1.5; stroke-dasharray: 5 3; }
.ff-layer .ff-prop:hover rect { fill: rgba(36, 72, 201, .22); }
.ff-layer .ff-plus circle { fill: #2448C9; }
.ff-layer .ff-plus path { stroke: #fff; stroke-width: 2; stroke-linecap: round; }
.app[data-ffflat="on"] .page .annotationLayer section { pointer-events: none; }
.app[data-ffflat="on"] .page .annotationLayer :is(input, textarea, select) { background: transparent !important; border-color: transparent !important; }
.ff-props { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.ff-props .field { margin: 6px 0; min-width: 0; }
.ff-props .field > span { font-size: 12px; color: var(--ink-3); }
.ff-props .field[hidden] { display: none; }
.ff-props .field select { font: inherit; color: var(--ink); background: var(--chrome); border: 1px solid var(--line); border-radius: 8px; padding: 7px 8px; min-width: 0; }
.ff-props .field input, .ff-props .field textarea { min-width: 0; width: 100%; }
.ff-props .ff-wide { grid-column: 1 / -1; }
.ff-checks { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 8px 0 2px; color: var(--ink); }
.ff-chk { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.ff-chk input { accent-color: var(--accent); width: 16px; height: 16px; margin: 0; }
.ff-bar { position: fixed; left: 50%; bottom: 48px; transform: translateX(-50%); z-index: 20; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center;
  max-width: calc(100vw - 32px); padding: 8px 8px 8px 14px; border-radius: 22px; background: var(--surface); color: var(--ink); border: 1px solid var(--line); box-shadow: 0 10px 30px rgba(0,0,0,.25); }
.ff-bar .btn { height: 30px; padding: 0 12px; }
@media (max-width: 520px) { .ff-props { grid-template-columns: 1fr; } .ff-bar { bottom: 56px; border-radius: 14px; } }
`);
// pdf.js turns its form layer with the page using these rules from its viewer stylesheet (only part of it is built
// in), so fields on a turned page sit where the page shows them.
addStyle(`
.page .annotationLayer { transform-origin: 0 0; }
.page .annotationLayer[data-main-rotation="90"], .page .annotationLayer [data-main-rotation="90"] { transform: rotate(90deg) translateY(-100%); }
.page .annotationLayer[data-main-rotation="180"], .page .annotationLayer [data-main-rotation="180"] { transform: rotate(180deg) translate(-100%, -100%); }
.page .annotationLayer[data-main-rotation="270"], .page .annotationLayer [data-main-rotation="270"] { transform: rotate(270deg) translateX(-100%); }
`);
// With the Forms tab shown, the tab names are wider than a phone: they scroll sideways instead of widening the page.
addStyle('.ribbon-tabs { overflow-x: auto; scrollbar-width: none; } .ribbon-tabs::-webkit-scrollbar { display: none; } .ribbon-tabs button { flex: none; }');
