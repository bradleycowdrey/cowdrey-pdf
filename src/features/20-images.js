/* ---------------- pictures ----------------
   Rotate, flip, crop, replace, save and delete a picture: one already in the PDF (selected with the Edit PDF tool,
   an `ie` mark) or one added with Picture… or a signature (`img` marks, selected with Select or Edit PDF).
   A picture is placed by a matrix (`mat`) that maps its unit square onto the page; turning and flipping change it.
   A crop is a rectangle [u0, v0, u1, v1] in that unit square (v up), drawn with an SVG clip path and saved as a clip
   before the picture is painted (or, with "Keep the full picture" off, the cut-off pixels are removed and the picture
   is made again from what is left). An added picture becomes a `pic` mark (matrix, crop) the first time it is changed.
   Saving: a picture from the PDF whose pixels are its own (`orig`) is drawn from its original picture object, with a new
   matrix only, so moving, turning or flipping it never makes a copy (a JPEG keeps its bytes, CMYK and ICC colours stay).
   A picture whose pixels changed (cut, enhanced, replaced) is written once as a new object: JPEG when it was one
   (`codec: 'jpeg'`, or a JPEG data URL), else Flate, grey when every pixel is. Then picture objects nothing on a page
   draws any more are taken out of its resources, so deleted and replaced pictures leave the file. */
const PIC_TYPES = new Set(['img', 'pic']);
let picCrop = null; // { v, id, mat, rect, drag? } while a crop is being chosen

// The selected picture: { kind: 'ie', v, s } (Edit PDF) or { kind: 'mark', v, m } (an added picture).
function picSel() {
  if (typeof selContent !== 'undefined' && selContent && selContent.kind === 'image' && selContent.v && selContent.v.rendered) return { kind: 'ie', v: selContent.v, s: selContent };
  if (selMark && doc) {
    const m = (doc.marks[selMark.key] || []).find((x) => x.id === selMark.id);
    if (m && PIC_TYPES.has(m.type)) {
      const v = views.find((vv) => vv.rendered && pageKey(vv.entry) === selMark.key);
      if (v) return { kind: 'mark', v, m };
    }
  }
  return null;
}
// An added picture's matrix, from where pdf-lib draws it (top-left x, y; turned by rot degrees).
function picImgMat(m) {
  const r = (m.rot || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [m.w * c, m.w * s, -m.h * s, m.h * c, m.x + s * m.h, m.y - c * m.h];
}
function picMatOf(sel) { return sel.kind === 'ie' ? imageMat(sel.s) : sel.m.type === 'pic' ? sel.m.mat : picImgMat(sel.m); }
function picCropOf(sel) { return (sel.kind === 'ie' ? sel.s.mark && sel.s.mark.crop : sel.m.crop) || null; }
function picIdOf(sel) { return sel.kind === 'ie' ? sel.s.mark && sel.s.mark.id : sel.m.id; }
// The part of the unit square that shows, on the page.
function picQuad(mat, crop) { const [u0, v0, u1, v1] = crop || [0, 0, 1, 1]; return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, w]) => apply(mat, u, w)); }
// Page point -> the picture's unit square
function picUnit(mat, x, y) { const [a, b, c, d, e, f] = mat, det = a * d - b * c || 1e-9, X = x - e, Y = y - f; return [(d * X - c * Y) / det, (-b * X + a * Y) / det]; }
// An added picture turns into a `pic` mark (same id, so it stays selected).
function picToPic(m) {
  if (m.type === 'pic') return m;
  const mat = picImgMat(m);
  delete m.x; delete m.y; delete m.w; delete m.h; delete m.rot;
  m.type = 'pic'; m.mat = mat;
  return m;
}
// Makes a change to the selected picture, with undo.
async function picEdit(fn, chosen) {
  const sel = chosen || picSel(); if (!sel) return false;
  const before = snapshot();
  let m;
  if (sel.kind === 'ie') { m = await imageMark(sel.v, sel.s); if (!m) { drawMarks(sel.v); return false; } m.deleted = false; }
  else m = picToPic(sel.m);
  fn(m, sel);
  drawMarks(sel.v); changed(before);
  return true;
}
// A page-space change about the centre of what shows: linear part [a, b, c, d] (x' = a x + c y).
function picAbout(lin) {
  return (m) => {
    const [cx, cy] = apply(m.mat, ...(m.crop ? [(m.crop[0] + m.crop[2]) / 2, (m.crop[1] + m.crop[3]) / 2] : [.5, .5]));
    const [a, b, c, d] = lin;
    m.mat = mul(m.mat, [a, b, c, d, cx - (a * cx + c * cy), cy - (b * cx + d * cy)]).map((n) => Math.abs(n) < 1e-9 ? 0 : +n.toFixed(6));
  };
}
const picRotate = (dir) => picAbout(dir > 0 ? [0, -1, 1, 0] : [0, 1, -1, 0]); // dir > 0: clockwise on screen
// Mirror across the screen's own vertical (horizontal flip) or horizontal axis, whatever the page's rotation.
function picFlip(horizontal) {
  return (m, sel) => {
    const v = sel.v, p0 = toPdf(v, 0, 0), p1 = horizontal ? toPdf(v, 1, 0) : toPdf(v, 0, 1);
    let dx = p1[0] - p0[0], dy = p1[1] - p0[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    picAbout([1 - 2 * dx * dx, -2 * dx * dy, -2 * dx * dy, 1 - 2 * dy * dy])(m);
  };
}

/* On screen */
function picClip(el, crop, id) {
  if (!el || !crop) return;
  const [u0, v0, u1, v1] = crop, cid = 'picclip-' + id;
  const cp = svgEl('clipPath', { id: cid, clipPathUnits: 'objectBoundingBox' });
  cp.appendChild(svgEl('rect', { x: u0, y: 1 - v1, width: u1 - u0, height: v1 - v0 }));
  const defs = svgEl('defs', {}); defs.appendChild(cp);
  el.parentNode.insertBefore(defs, el);
  el.setAttribute('clip-path', `url(#${cid})`);
}
function picImageEl(v, mat, data) {
  const o = toView(v, ...apply(mat, 0, 1)), x = toView(v, ...apply(mat, 1, 1)), y = toView(v, ...apply(mat, 0, 0));
  return svgEl('image', { x: 0, y: 0, width: 1, height: 1, href: data, preserveAspectRatio: 'none', transform: `matrix(${x[0] - o[0]} ${x[1] - o[1]} ${y[0] - o[0]} ${y[1] - o[1]} ${o[0]} ${o[1]})` });
}
const picCropping = (id) => !!picCrop && picCrop.id === id;
FEATURE.markTypes.pic = {
  draw(v, m) {
    const g = svgEl('g', { class: 'mk' }), im = picImageEl(v, m.mat, m.data);
    g.appendChild(im);
    if (m.crop && !picCropping(m.id)) picClip(im, m.crop, m.id);
    return g;
  },
  async save({ L, out, p, m, ctx }) { await picPaint(L, out, p, m, ctx); },
  move(m, o, dx, dy) { m.mat = [o.mat[0], o.mat[1], o.mat[2], o.mat[3], o.mat[4] + dx, o.mat[5] + dy]; },
};
// A picture from the PDF that has been cropped is clipped on screen too.
const picDrawContentCore = drawContentMark;
drawContentMark = function (v, m, svg) {
  const g = picDrawContentCore(v, m, svg);
  if (g && m.type === 'ie' && m.crop && !m.deleted && !picCropping(m.id)) picClip(g.querySelector('image'), m.crop, m.id);
  return g;
};
// After the marks are drawn: the selection outline follows the crop, and the picture's toolbar and crop frame show.
const picDrawMarksCore = drawMarks;
drawMarks = function (v) {
  picDrawMarksCore(v);
  try { picAfterDraw(v); } catch (e) { console.warn('pictures', e); }
};
function picAfterDraw(v) {
  const sel = picSel();
  if (picCrop && (!sel || picIdOf(sel) !== picCrop.id && picCrop.id)) picCropEnd(false);
  if (picCrop && (!sel || sel.v !== picCrop.v)) picCropEnd(false);
  const svg = v.el.querySelector('svg.marks');
  if (sel && sel.v === v && sel.kind === 'ie' && svg && !picCrop) {
    const c = picCropOf(sel), poly = svg.querySelector('.content-sel');
    if (c && poly) poly.setAttribute('points', picQuad(imageMat(sel.s), c).map(([x, y]) => toView(v, x, y).join(',')).join(' '));
  }
  // A resize handle at the corner of what shows that is bottom-right on screen, for every picture (also when it
  // is turned, flipped or cropped, where the Edit PDF tool's own handle would not be at a corner of what shows).
  if (sel && sel.v === v && svg && !picCrop) {
    svg.querySelectorAll('.content-handle').forEach((n) => n.remove());
    const [hx, hy] = toView(v, ...picHandle(v, sel).at);
    const h = svgEl('rect', { class: 'content-handle pic-resize', x: hx - 6, y: hy - 6, width: 12, height: 12, rx: 3 });
    h.addEventListener('pointerdown', (e) => picResizeDown(e, sel));
    svg.appendChild(h);
  }
  picBar(v, sel && sel.v === v ? sel : null);
  if (picCrop && picCrop.v === v) picCropDraw();
}
function picHandle(v, sel) {
  const q = picQuad(picMatOf(sel), picCropOf(sel)), sv = q.map(([x, y]) => toView(v, x, y));
  let k = 0; for (let i = 1; i < 4; i++) if (sv[i][0] + sv[i][1] > sv[k][0] + sv[k][1]) k = i;
  return { at: q[k], anchor: q[(k + 2) % 4] };
}
// Resizing keeps the opposite corner where it is and scales both ways alike.
function picResizeDown(e, sel) {
  e.preventDefault(); e.stopPropagation();
  const v = sel.v, mat0 = picMatOf(sel).slice(), { at: br, anchor: tl } = picHandle(v, sel);
  const d0 = Math.hypot(br[0] - tl[0], br[1] - tl[1]) || 1;
  const before = snapshot(), [sx, sy] = toPdf(v, ...localPoint(e, v));
  let mat = mat0, moved = false;
  const move = (ev) => {
    const [cx, cy] = toPdf(v, ...localPoint(ev, v));
    if (!moved && Math.hypot(cx - sx, cy - sy) < 2) return;
    moved = true;
    const k = Math.max(8 / d0, Math.hypot(br[0] + cx - sx - tl[0], br[1] + cy - sy - tl[1]) / d0);
    mat = mul(mat0, [k, 0, 0, k, tl[0] * (1 - k), tl[1] * (1 - k)]);
    if (sel.kind === 'ie') sel.s.preview = mat; else picToPic(sel.m).mat = mat;
    drawMarks(v);
  };
  const up = async () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    if (!moved) return;
    if (sel.kind === 'ie') {
      delete sel.s.preview;
      const m = await imageMark(v, sel.s); if (!m) { drawMarks(v); return; }
      m.mat = mat; m.deleted = false;
    }
    drawMarks(v); changed(before);
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}

/* The floating toolbar */
addStyle(`
.pic-bar { position: absolute; z-index: 6; display: flex; align-items: center; gap: 2px; padding: 4px; border-radius: 10px; background: var(--surface); color: var(--ink); border: 1px solid var(--line); box-shadow: 0 6px 22px rgba(0,0,0,.22); white-space: nowrap; }
.pic-bar .icon-btn { width: 32px; height: 32px; color: var(--ink); }
.pic-bar .icon-btn:hover { background: var(--hover); }
.pic-bar .icon-btn:disabled { opacity: .4; cursor: default; }
.pic-bar .pic-sep { width: 1px; height: 20px; background: var(--line); margin: 0 3px; }
.pic-bar .btn { height: 30px; padding: 0 12px; }
.pic-bar .pic-hint { font-size: 12px; color: var(--ink-2); padding: 0 6px; }
.pic-bar .pic-keep { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--ink-2); padding: 0 8px 0 2px; cursor: pointer; }
.pic-bar .pic-keep input { margin: 0; accent-color: var(--accent); }
.marks .pic-resize { pointer-events: auto; cursor: nwse-resize; }
.pic-crop { position: absolute; inset: 0; z-index: 5; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
.pic-crop .pic-shade { fill: rgba(0,0,0,.5); fill-rule: evenodd; pointer-events: none; }
.pic-crop .pic-frame { fill: transparent; stroke: #fff; stroke-width: 1.5; cursor: move; }
.pic-crop .pic-frame-2 { fill: none; stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 5 4; pointer-events: none; }
.pic-crop .pic-handle { fill: var(--surface); stroke: var(--accent); stroke-width: 2; }
@media (max-width: 760px), (max-height: 500px) and (pointer: coarse) { .pic-bar { gap: 1px; padding: 3px; } .pic-bar .icon-btn { width: 36px; height: 36px; } .pic-bar .pic-sep, .pic-bar .pic-hint, .pic-bar .pic-wide { display: none; } .pic-bar .pic-keep span { font-size: 11px; white-space: normal; max-width: 110px; } }
`);
const PIC_TOOLS = [['picRotL', 'rotate-ccw'], ['picRotR', 'rotate-cw'], ['picFlipH', 'flip-horizontal-2'], ['picFlipV', 'flip-vertical-2'], ['picCrop', 'crop'], ['imgEnhance', 'sliders-horizontal', 'pic-wide'], '-', ['picReplace', 'replace'], ['picExtract', 'image-down'], '-', ['picDelete', 'trash-2']];
function picBar(v, sel) {
  let bar = v.el.querySelector(':scope > .pic-bar');
  if (!sel || (typeof lineEditor !== 'undefined' && lineEditor)) { if (bar) bar.remove(); return; }
  const mode = picCrop ? 'crop' : 'tools';
  if (!bar || bar.dataset.mode !== mode) {
    if (bar) bar.remove();
    bar = document.createElement('div'); bar.className = 'pic-bar'; bar.dataset.mode = mode;
    bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Picture');
    bar.innerHTML = mode === 'crop'
      ? `<span class="pic-hint">Drag the corners to crop</span><label class="pic-keep" title="Off: the cut-off part is removed from the file"><input type="checkbox" id="picCropKeep"${picKeepFull() ? ' checked' : ''}><span>Keep the full picture (crop by hiding)</span></label><button type="button" class="btn" data-cmd="picCropCancel">Cancel</button><button type="button" class="btn primary" data-cmd="picCropApply">${ic('check')}<span>Apply</span></button>`
      : PIC_TOOLS.filter((t) => t === '-' || C[t[0]]).map((t) => t === '-' ? '<span class="pic-sep"></span>' : `<button type="button" class="icon-btn${t[2] ? ' ' + t[2] : ''}" data-cmd="${t[0]}" title="${esc(C[t[0]].label)}" aria-label="${esc(C[t[0]].label)}">${ic(t[1])}</button>`).join('');
    const keep = bar.querySelector('#picCropKeep'); if (keep) keep.onchange = () => { S.picCropKeep = keep.checked; saveSettings(); };
    // Keep the page from seeing the press (it would start a drag or clear the selection).
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    v.el.appendChild(bar); icons();
  }
  const q = picQuad(picCrop && picCrop.v === v ? picCrop.mat : picMatOf(sel), picCrop ? null : picCropOf(sel)).map(([x, y]) => toView(v, x, y));
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const bw = bar.offsetWidth, bh = bar.offsetHeight, W = v.el.clientWidth || v.viewport.width, H = v.el.clientHeight || v.viewport.height;
  let top = Math.min(...ys) - bh - 10;
  if (top < 4) top = Math.max(...ys) + 10;
  if (top + bh > H - 4) top = Math.max(4, Math.min(...ys) + 8);
  const left = Math.max(4, Math.min(W - bw - 4, (Math.min(...xs) + Math.max(...xs)) / 2 - bw / 2));
  bar.style.left = left + 'px'; bar.style.top = top + 'px';
}

/* Crop: a frame over the picture; drag its corners or the frame, or drag out a new one on the picture. */
function picCropStart() {
  const sel = picSel(); if (!sel) return;
  picCrop = { v: sel.v, id: picIdOf(sel) || null, mat: picMatOf(sel).slice(), rect: (picCropOf(sel) || [0, 0, 1, 1]).slice() };
  drawMarks(sel.v);
}
function picCropEnd(apply) {
  const c = picCrop; if (!c) return;
  picCrop = null;
  const ov = c.v.el.querySelector(':scope > .pic-crop'); if (ov) ov.remove();
  if (!apply) { drawMarks(c.v); return; }
  const [u0, v0, u1, v1] = c.rect, full = u0 < .002 && v0 < .002 && u1 > .998 && v1 > .998;
  if (!full && !picKeepFull()) { picCutApply(c.rect); return; }
  picEdit((m) => { if (full) delete m.crop; else m.crop = c.rect.map((n) => +n.toFixed(5)); }).then((done) => { if (done) toast(full ? 'Crop removed' : 'Picture cropped'); });
}
// "Keep the full picture (crop by hiding)": on unless turned off (then the cut-off pixels leave the file).
const picKeepFull = () => S.picCropKeep !== false;
// A real crop: the picture is made again from the part kept, in its own kind (JPEG stays JPEG), and placed where that
// part was. Its transparency (soft mask) is cut the same way.
async function picCutApply(rect) {
  const sel = picSel(); if (!sel) return;
  const src = await picDataOf(sel); if (!src) { toast('This picture can’t be cropped, but it can be deleted or erased.'); return; }
  const codec = await picCodecOf(sel);
  let cut; try { cut = await picCutPixels(src, rect, codec); } catch (e) { console.warn(e); toast('This picture can’t be cropped.'); return; }
  const done = await picEdit((m) => {
    const [r0, r1, r2, r3] = cut.r;
    m.mat = mul([r2 - r0, 0, 0, r3 - r1, r0, r1], m.mat).map((n) => Math.abs(n) < 1e-9 ? 0 : +n.toFixed(6));
    m.data = cut.data; m.orig = false; delete m.crop;
    if (cut.codec) m.codec = cut.codec; else delete m.codec;
  });
  if (done) toast('Picture cropped. The cut-off part is removed.');
}
async function picCutPixels(data, rect, codec) {
  const img = new Image(); img.src = data; await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight, [u0, v0, u1, v1] = rect;
  const sx = Math.max(0, Math.min(W - 1, Math.round(u0 * W))), sy = Math.max(0, Math.min(H - 1, Math.round((1 - v1) * H)));
  const sw = Math.max(1, Math.min(W - sx, Math.round((u1 - u0) * W))), sh = Math.max(1, Math.min(H - sy, Math.round((v1 - v0) * H)));
  const c = document.createElement('canvas'); c.width = sw; c.height = sh;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const opaque = picOpaque(g.getImageData(0, 0, sw, sh).data);
  // the part of the unit square kept, to whole pixels
  const r = [sx / W, 1 - (sy + sh) / H, (sx + sw) / W, 1 - sy / H];
  if (codec === 'jpeg' && opaque) return { data: c.toDataURL('image/jpeg', 0.92), r };
  return { data: c.toDataURL('image/png'), r, codec: codec === 'jpeg' ? 'jpeg' : undefined };
}
function picOpaque(px) { for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) return false; return true; }
// The selected picture's pixels (a data URL).
async function picDataOf(sel) { return sel.kind === 'ie' ? (sel.s.mark && sel.s.mark.data) || await imagePng(sel.v, sel.s.im) : sel.m.data; }
// How a picture is kept: 'jpeg' or 'png'.
async function picCodecOf(sel) {
  const m = sel.kind === 'ie' ? sel.s.mark : sel.m;
  if (m && /^data:image\/jpeg/.test(m.data || '')) return 'jpeg';
  if (m && m.codec) return m.codec;
  if (sel.kind === 'ie' && (!m || m.orig)) { const info = await picInfo(sel.v.entry, sel.s.im).catch(() => null); return info && info.jpeg ? 'jpeg' : 'png'; }
  return 'png';
}
function picCropDraw() {
  const c = picCrop, v = c.v;
  let ov = v.el.querySelector(':scope > .pic-crop');
  if (!ov) {
    ov = svgEl('svg', { class: 'pic-crop' });
    ov.addEventListener('pointerdown', (e) => picCropDown(e));
    v.el.appendChild(ov);
  }
  ov.setAttribute('viewBox', `0 0 ${v.viewport.width} ${v.viewport.height}`);
  const P = (q) => q.map(([x, y]) => toView(v, x, y).map((n) => n.toFixed(1)).join(','));
  const full = P(picQuad(c.mat)), crop = P(picQuad(c.mat, c.rect));
  ov.innerHTML = '';
  ov.appendChild(svgEl('path', { class: 'pic-shade', d: `M${full.join('L')}Z M${crop.join('L')}Z` }));
  ov.appendChild(svgEl('polygon', { class: 'pic-frame', points: crop.join(' ') }));
  ov.appendChild(svgEl('polygon', { class: 'pic-frame-2', points: crop.join(' ') }));
  for (const pt of crop) { const [x, y] = pt.split(',').map(Number); ov.appendChild(svgEl('rect', { class: 'pic-handle', x: x - 6, y: y - 6, width: 12, height: 12, rx: 2 })); }
}
function picCropDown(e) {
  const c = picCrop; if (!c) return;
  e.preventDefault(); e.stopPropagation();
  const v = c.v, unitAt = (ev) => picUnit(c.mat, ...toPdf(v, ...localPoint(ev, v)));
  const [lx, ly] = localPoint(e, v), [u, w] = unitAt(e), r0 = c.rect.slice();
  const corners = [[r0[0], r0[1]], [r0[2], r0[1]], [r0[2], r0[3]], [r0[0], r0[3]]];
  const k = corners.findIndex(([cu, cv]) => { const [x, y] = toView(v, ...apply(c.mat, cu, cv)); return Math.hypot(x - lx, y - ly) < (e.pointerType === 'touch' ? 22 : 14); });
  const cl = (n) => Math.max(0, Math.min(1, n)), MIN = .02;
  let mode;
  if (k >= 0) mode = 'corner';
  else if (u >= r0[0] && u <= r0[2] && w >= r0[1] && w <= r0[3]) mode = 'move';
  else if (u >= 0 && u <= 1 && w >= 0 && w <= 1) mode = 'new';
  else return;
  const move = (ev) => {
    const [cu, cv] = unitAt(ev).map(cl);
    if (mode === 'move') {
      const du = Math.max(-r0[0], Math.min(1 - r0[2], cu - cl(u))), dv = Math.max(-r0[1], Math.min(1 - r0[3], cv - cl(w)));
      c.rect = [r0[0] + du, r0[1] + dv, r0[2] + du, r0[3] + dv];
    } else {
      // The corner opposite the one dragged (or where the drag began) stays put.
      const [au, av] = mode === 'new' ? [cl(u), cl(w)] : corners[(k + 2) % 4];
      let x0 = Math.min(au, cu), x1 = Math.max(au, cu), y0 = Math.min(av, cv), y1 = Math.max(av, cv);
      if (x1 - x0 < MIN) { if (cu < au) x0 = Math.max(0, x1 - MIN); else x1 = Math.min(1, x0 + MIN); }
      if (y1 - y0 < MIN) { if (cv < av) y0 = Math.max(0, y1 - MIN); else y1 = Math.min(1, y0 + MIN); }
      c.rect = [x0, y0, x1, y1];
    }
    picCropDraw();
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
window.addEventListener('keydown', (e) => {
  if (!picCrop || $('#dialog').open) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); picCropEnd(false); }
  else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); picCropEnd(true); }
  else if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation();
}, true);

/* Replace: a new picture in the same place, fitted inside the old one's box, keeping its own proportions. */
const picInput = document.createElement('input');
picInput.type = 'file'; picInput.accept = 'image/png,image/jpeg,image/webp,image/gif'; picInput.hidden = true; picInput.id = 'picReplaceInput';
document.body.appendChild(picInput);
async function picLoad(file) {
  const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  const img = new Image(); img.src = data; await img.decode();
  // A JPEG is kept as it is (saved with its own bytes); other kinds become PNG.
  if (/^data:image\/jpeg/.test(data) && [1, 3].includes(picJpegComps(picB64Bytes(data)))) return { data, w: img.naturalWidth, h: img.naturalHeight };
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
  return { data: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight };
}
function picFit(mat, crop, w, h) {
  const q = picQuad(mat, crop), U = [q[1][0] - q[0][0], q[1][1] - q[0][1]], V = [q[3][0] - q[0][0], q[3][1] - q[0][1]];
  const W = Math.hypot(...U) || 1, H = Math.hypot(...V) || 1, centre = [q[0][0] + (U[0] + V[0]) / 2, q[0][1] + (U[1] + V[1]) / 2];
  // Keep the way the box is turned, but not a flip: the new picture reads the right way round.
  let up, right;
  if (U[0] * V[1] - U[1] * V[0] >= 0) { up = [V[0] / H, V[1] / H]; right = [up[1], -up[0]]; }
  else { right = [U[0] / W, U[1] / W]; up = [-right[1], right[0]]; }
  const a = w / h, [nw, nh] = W / H > a ? [H * a, H] : [W, W / a];
  const r = (n) => Math.abs(n) < 1e-9 ? 0 : +n.toFixed(6);
  return [right[0] * nw, right[1] * nw, up[0] * nh, up[1] * nh, centre[0] - (right[0] * nw + up[0] * nh) / 2, centre[1] - (right[1] * nw + up[1] * nh) / 2].map(r);
}
picInput.addEventListener('change', async () => {
  const f = picInput.files[0]; picInput.value = '';
  if (!f) return;
  let pic; try { pic = await picLoad(f); } catch { toast('That file isn’t a picture Cowdrey.PDF can read.'); return; }
  const done = await picEdit((m) => { m.mat = picFit(m.mat, m.crop, pic.w, pic.h); m.data = pic.data; m.orig = false; delete m.codec; delete m.crop; });
  if (done) toast('Picture replaced');
});

/* Extract: the picture's pixels as a PNG file (cropped, if it is). */
const picB64Bytes = (url) => { const b = atob(url.slice(url.indexOf(',') + 1)), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
async function picPixels(data, crop) {
  if (!crop) return data;
  const img = new Image(); img.src = data; await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight, [u0, v0, u1, v1] = crop;
  const sx = Math.round(u0 * W), sy = Math.round((1 - v1) * H), sw = Math.max(1, Math.round((u1 - u0) * W)), sh = Math.max(1, Math.round((v1 - v0) * H));
  const c = document.createElement('canvas'); c.width = sw; c.height = sh; c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return c.toDataURL('image/png');
}
async function picExtract() {
  const sel = picSel(); if (!sel) return;
  let data = sel.kind === 'ie' ? (sel.s.mark && sel.s.mark.data) || await imagePng(sel.v, sel.s.im) : sel.m.data;
  if (!data) { toast('This picture can’t be saved as a file.'); return; }
  data = await picPixels(data, picCropOf(sel));
  const name = `${String(doc.name || 'Document').replace(/\.pdf$/i, '')} picture.png`;
  if (await saveFile(picB64Bytes(data), name, 'image/png') === true) toast('Picture saved');
}
function picDelete() {
  const sel = picSel(); if (!sel) return;
  if (sel.kind === 'ie') deleteContent(); else deleteSelected();
  toast('Picture deleted');
}

/* Saving: a picture with a crop is clipped to it before it is painted. */
async function picPaint(L, out, p, m, ctx) {
  if (!m.data || !m.mat) return;
  const { PDFOperator, PDFNumber } = L, O = (n, a = []) => PDFOperator.of(n, a), N = (x) => PDFNumber.of(+(+x).toFixed(4));
  const key = p.node.newXObject('CPDFIm', await picXObject(L, out, m, ctx)), ops = [O('q')];
  if (m.crop) { const q = picQuad(m.mat, m.crop); ops.push(O('m', q[0].map(N)), O('l', q[1].map(N)), O('l', q[2].map(N)), O('l', q[3].map(N)), O('h'), O('W'), O('n')); }
  ops.push(O('cm', m.mat.map(N)), O('Do', [key]), O('Q'));
  p.pushOperators(...ops);
}
// Pictures from the PDF with a crop are painted here (the Edit PDF save paints the others, without a clip).
const picSaveContentCore = saveContentEdits;
saveContentEdits = async function (L, out, p, marks, ctx) {
  const cropped = new Set(marks.filter((m) => m.type === 'ie' && m.crop && !m.deleted && m.data && m.mat && !m.drafting));
  if (!cropped.size) return picSaveContentCore(L, out, p, marks, ctx);
  await picSaveContentCore(L, out, p, marks.map((m) => cropped.has(m) ? { ...m, data: '' } : m), ctx);
  for (const m of cropped) await picPaint(L, out, p, m, ctx);
};

// The Edit PDF tool finds what was clicked before it starts a drag; by then a quick click may be over, and the
// picture would follow the pointer until the next click. A drag only starts while the button is still down.
let picPressed = false;
window.addEventListener('pointerdown', () => { picPressed = true; }, true);
for (const t of ['pointerup', 'pointercancel']) window.addEventListener(t, () => { picPressed = false; }, true);
const picStartImageDragCore = startImageDrag;
startImageDrag = function (e, v, s, mode) { if (!picPressed) { drawMarks(v); return; } return picStartImageDragCore(e, v, s, mode); };

/* What a picture in the PDF is made of: read with pdf-lib from the file it came from (its kind, colours, bytes). */
const picSrcDocs = new WeakMap(); // source bytes -> its pdf-lib document
async function picSrcDoc(src) {
  const b = doc && doc.sources[src]; if (!b) return null;
  let d = picSrcDocs.get(b);
  if (!d) { const L = await loadPdfLib(); d = L.PDFDocument.load(b, b.password ? { password: b.password, updateMetadata: false } : { ignoreEncryption: true, updateMetadata: false }); picSrcDocs.set(b, d); }
  return d;
}
function picStreamBytes(L, st) {
  if (st instanceof L.PDFRawStream) return L.decodePDFRawStream(st).decode();
  return st.getUnencodedContents ? st.getUnencodedContents() : st.getContents();
}
const picLatin = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return s; };
function picPageText(L, ctx, node) {
  const raw = node.get(L.PDFName.of('Contents')), r = raw && ctx.lookup(raw);
  const list = r instanceof L.PDFArray ? r.asArray() : raw ? [raw] : [];
  return list.map((x) => { const st = ctx.lookup(x); return st && st.dict ? picLatin(picStreamBytes(L, st)) : ''; }).join('\n');
}
// Every picture a page draws (forms followed), with where it goes: [{ quad, st, ref, name }].
function picDraws(L, d, node) {
  const { PDFName, PDFDict, PDFArray, PDFRef, PDFNumber } = L, N = (k) => PDFName.of(k), c = d.context, out = [];
  const walk = (src, res, ctm, depth) => {
    const R = res instanceof PDFRef ? c.lookup(res) : res, xo = R instanceof PDFDict ? R.lookup(N('XObject')) : null;
    walkContent(src, () => [], null, (im) => {
      if (im.inline || !(xo instanceof PDFDict)) return;
      const raw = xo.get(N(im.name)), st = raw && c.lookup(raw);
      if (!st || !st.dict) return;
      const sub = String(st.dict.lookup(N('Subtype')));
      if (sub === '/Image') { if (String(st.dict.lookup(N('ImageMask'))) !== 'true') out.push({ quad: [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => apply(im.ctm, x, y)), st, ref: raw instanceof PDFRef ? raw : null, name: im.name }); }
      else if (sub === '/Form' && depth < 6) {
        const M = st.dict.lookup(N('Matrix')), fm = M instanceof PDFArray && M.size() === 6 ? M.asArray().map((x) => { const n = c.lookup(x); return n instanceof PDFNumber ? n.asNumber() : 0; }) : [1, 0, 0, 1, 0, 0];
        let t = ''; try { t = picLatin(picStreamBytes(L, st)); } catch { return; }
        walk(t, st.dict.lookup(N('Resources')) || R, mul(fm, im.ctm), depth + 1);
      }
    }, ctm);
  };
  let src = ''; try { src = picPageText(L, c, node); } catch { return out; }
  walk(src, node.Resources(), [1, 0, 0, 1, 0, 0], 0);
  return out;
}
// The kind of a picture object: { jpeg, cmyk, cs, bpc, w, h, smask, bytes (a JPEG's own), ref }.
function picKind(L, st, ref) {
  const { PDFName, PDFArray, PDFNumber } = L, N = (k) => PDFName.of(k), D = st.dict;
  const f = D.lookup(N('Filter')), filters = f instanceof PDFArray ? f.asArray().map(String) : f ? [String(f)] : [];
  const csv = D.lookup(N('ColorSpace'));
  const cs = csv instanceof PDFName ? String(csv).slice(1) : csv instanceof PDFArray ? String(csv.lookup(0)).slice(1) : '';
  let comps = 0;
  if (cs === 'ICCBased') { const icc = csv.lookup(1), n = icc && icc.dict && icc.dict.lookup(N('N')); comps = n instanceof PDFNumber ? n.asNumber() : 0; }
  const jpeg = filters.length === 1 && filters[0] === '/DCTDecode', bytes = jpeg ? st.getContents() : null;
  if (jpeg && !cs) comps = picJpegComps(bytes);
  const num = (k) => { const n = D.lookup(N(k)); return n instanceof PDFNumber ? n.asNumber() : 0; };
  return { jpeg, cs, cmyk: cs === 'DeviceCMYK' || comps === 4, bpc: num('BitsPerComponent'), w: num('Width'), h: num('Height'), smask: !!D.get(N('SMask')), bytes, ref };
}
// The picture object behind a picture pdf.js drew on the page (`im` from contentMap): found by where it is drawn.
async function picInfo(entry, im) {
  const L = await loadPdfLib(), d = await picSrcDoc(entry.src); if (!d) return null;
  const b = quadBox(im.quad), draws = picDraws(L, d, d.getPage(entry.i).node);
  const dr = draws.find((x) => quadBox(x.quad).every((n, k) => Math.abs(n - b[k]) < 1));
  return dr ? picKind(L, dr.st, dr.ref) : null;
}
// The number of colour components in a JPEG (from its frame header), or 0.
function picJpegComps(b) {
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xFF) { i++; continue; }
    const mk = b[i + 1];
    if (mk === 0xFF) { i++; continue; }
    if (mk === 0xD8 || mk === 0x01 || (mk >= 0xD0 && mk <= 0xD7)) { i += 2; continue; }
    if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) return b[i + 9];
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return 0;
}

/* Saving: the picture object a picture is drawn from. */
async function picXObject(L, out, m, ctx) {
  if (m.orig && ctx.picRefs && ctx.picRefs.get(m.id)) return ctx.picRefs.get(m.id);
  if (!m.data) return null;
  const cache = ctx.picX || (ctx.picX = new Map()), key = (m.codec || '') + '|' + m.data;
  if (!cache.has(key)) cache.set(key, picWrite(L, out, m.data, m.codec));
  return cache.get(key);
}
FEATURE.picXObject = picXObject;
// A new picture object from a data URL: a JPEG with its own bytes; else Flate (grey when every pixel is), or JPEG at
// 92% when `codec` is 'jpeg'; transparency as a soft mask.
async function picWrite(L, out, data, codec) {
  const c = out.context, img = new Image(); img.src = data; await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight, head = { Type: 'XObject', Subtype: 'Image', Width: W, Height: H, BitsPerComponent: 8 };
  if (/^data:image\/jpeg/.test(data)) {
    const bytes = picB64Bytes(data), comps = picJpegComps(bytes);
    if (comps === 1 || comps === 3) return c.register(c.stream(bytes, { ...head, ColorSpace: comps === 1 ? 'DeviceGray' : 'DeviceRGB', Filter: 'DCTDecode' }));
  }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, W, H).data, n = W * H;
  let opaque = true, gray = true;
  for (let i = 0; i < px.length; i += 4) { if (px[i + 3] !== 255) opaque = false; if (px[i] !== px[i + 1] || px[i] !== px[i + 2]) gray = false; }
  let smask = null;
  if (!opaque) { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = px[i * 4 + 3]; smask = c.register(c.flateStream(a, { ...head, ColorSpace: 'DeviceGray' })); }
  const dict = { ...head, ...(smask ? { SMask: smask } : {}) };
  if (codec === 'jpeg') {
    const w = document.createElement('canvas'); w.width = W; w.height = H;
    const wg = w.getContext('2d'); wg.fillStyle = '#FFFFFF'; wg.fillRect(0, 0, W, H); wg.drawImage(cv, 0, 0);
    const blob = await new Promise((res) => w.toBlob(res, 'image/jpeg', 0.92));
    return c.register(c.stream(new Uint8Array(await blob.arrayBuffer()), { ...dict, ColorSpace: 'DeviceRGB', Filter: 'DCTDecode' }));
  }
  const k = gray ? 1 : 3, b = new Uint8Array(n * k);
  if (gray) for (let i = 0; i < n; i++) b[i] = px[i * 4];
  else for (let i = 0; i < n; i++) { b[i * 3] = px[i * 4]; b[i * 3 + 1] = px[i * 4 + 1]; b[i * 3 + 2] = px[i * 4 + 2]; }
  return c.register(c.flateStream(b, { ...dict, ColorSpace: gray ? 'DeviceGray' : 'DeviceRGB' }));
}

/* Saving: picture and form objects nothing on a page draws any more are taken out of its resources (and so out of the
   file, which keeps only what something refers to). A page's resources may be shared with other pages, so the page
   gets its own copy of them first. A form's resources are used by that form's content alone, so the form gets a
   trimmed copy of its own (whoever draws the form sees the same content). */
function picDropUnused(L, out, pages) {
  const { PDFName, PDFDict, PDFRef } = L, N = (k) => PDFName.of(k), c = out.context;
  const look = (o) => (o instanceof PDFRef ? c.lookup(o) : o);
  // Every name a content stream spells out (whatever operator it is for: a name anywhere keeps its entry).
  const namesCache = new Map();
  const namesIn = (src) => { let s = namesCache.get(src); if (!s) { s = new Set(); for (const m of src.matchAll(/\/([^\s/[\]<>(){}%]+)/g)) s.add(m[1]); namesCache.set(src, s); } return s; };
  const uses = (src, key) => {
    const a = key.asString().slice(1); let b = a; try { b = key.decodeText(); } catch {}
    const s = namesIn(src); return s.has(a) || s.has(b);
  };
  const text = (st) => picLatin(picStreamBytes(L, st));
  const isForm = (st) => st && st.dict && String(st.dict.lookup(N('Subtype'))) === '/Form';
  // A Type 3 font without resources of its own draws with the page's: such resources are left alone.
  const type3 = (R) => { const F = look(R.get(N('Font'))); return F instanceof PDFDict && F.entries().some(([, f]) => { const d = look(f); return d instanceof PDFDict && String(d.lookup(N('Subtype'))) === '/Type3' && !d.get(N('Resources')); }); };
  const seenForms = new Set();
  let dropped = 0;
  // Trims the XObjects of `R` (the resources `src` is drawn with); `own` puts the trimmed copy in place.
  const trim = (R, src, own, depth) => {
    if (!(R instanceof PDFDict) || depth > 6) return;
    const xo = look(R.get(N('XObject')));
    if (!(xo instanceof PDFDict) || type3(R)) return;
    // Forms without resources of their own draw with these: what they draw counts too (until nothing new is added).
    let all = src; const added = new Set();
    for (let grew = true; grew;) {
      grew = false;
      for (const [k, v] of xo.entries()) {
        const st = look(v), id = k.asString();
        if (added.has(id) || !isForm(st) || st.dict.get(N('Resources')) || !uses(all, k)) continue;
        try { all += '\n' + text(st); } catch { return; }
        added.add(id); grew = true;
      }
    }
    const gone = xo.entries().filter(([k]) => !uses(all, k)).map(([k]) => k);
    // The forms still drawn have their own resources trimmed in turn.
    for (const [k, v] of xo.entries()) {
      if (gone.includes(k)) continue;
      const st = look(v); if (!isForm(st)) continue;
      const tag = v instanceof PDFRef ? v.tag : null; if (tag && seenForms.has(tag)) continue; if (tag) seenForms.add(tag);
      const FR = look(st.dict.get(N('Resources'))); if (!(FR instanceof PDFDict)) continue;
      let fs; try { fs = text(st); } catch { continue; }
      trim(FR, fs, (copy) => st.dict.set(N('Resources'), copy), depth + 1);
    }
    if (!gone.length) return;
    const R2 = R.clone(c), xo2 = xo.clone(c);
    for (const k of gone) xo2.delete(k);
    R2.set(N('XObject'), xo2); own(R2); dropped += gone.length;
  };
  for (const p of pages) {
    let src; try { src = picPageText(L, c, p.node); } catch { continue; }
    trim(p.node.Resources(), src, (copy) => p.node.set(N('Resources'), copy), 0);
  }
  return dropped;
}
FEATURE.saveDoc.push(async ({ L, out, pages }) => { try { picDropUnused(L, out, pages); } catch (e) { console.warn('pictures: unused objects', e); } });

/* Export all pictures: a .zip with each picture once (a JPEG with its own bytes, others as PNG). */
async function picExportAll() {
  if (!has()) return;
  if (typeof crdZip !== 'function') { toast('Exporting pictures isn’t available here.'); return; }
  const L = await loadPdfLib(), files = [], seen = new Set(), extOf = (u) => /^data:image\/jpeg/.test(u) ? 'jpg' : 'png';
  for (let n = 0; n < doc.pages.length; n++) {
    const e = doc.pages[n], pd = pdfDocs.get(e.src); if (!pd) continue;
    let page, cm, draws = [];
    try { page = await pd.getPage(e.i + 1); cm = await contentMap(page); } catch { continue; }
    try { const d = await picSrcDoc(e.src); draws = picDraws(L, d, d.getPage(e.i).node); } catch (er) { console.warn(er); }
    const marks = marksOf(e);
    for (const im of cm.images) {
      const mk = marks.find((m) => m.type === 'ie' && (m.raw != null ? m.raw === im.raw : m.n === im.n));
      if (mk && mk.deleted) continue;
      if (mk && !mk.orig && mk.data) { files.push({ data: picB64Bytes(mk.data), ext: extOf(mk.data), n }); continue; }
      const b = quadBox(im.quad), dr = draws.find((x) => quadBox(x.quad).every((q, k) => Math.abs(q - b[k]) < 1));
      const id = dr && dr.ref ? `${e.src}:${dr.ref.tag}` : null;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      const kind = dr && picKind(L, dr.st, dr.ref);
      if (kind && kind.jpeg && !kind.cmyk) { files.push({ data: kind.bytes, ext: 'jpg', n }); continue; }
      const png = await imagePng({ page }, im); if (png) files.push({ data: picB64Bytes(png), ext: 'png', n });
    }
    for (const m of marks) if (PIC_TYPES.has(m.type) && m.data) files.push({ data: picB64Bytes(m.data), ext: extOf(m.data), n });
  }
  if (!files.length) { toast('This PDF has no pictures.'); return; }
  const zip = crdZip(files.map((f, k) => ({ name: `Picture ${k + 1} (page ${f.n + 1}).${f.ext}`, data: f.data })));
  if (await saveFile(zip, `${String(doc.name || 'Document').replace(/\.pdf$/i, '')} pictures.zip`, 'application/zip') === true) toast(`${files.length} picture${files.length === 1 ? '' : 's'} saved`);
}

/* Commands */
const picOn = () => !!picSel() && !picCrop;
cmd('picRotL', { contextual: true, label: 'Rotate left', icon: 'rotate-ccw', enabled: picOn, run: () => picEdit(picRotate(-1)) });
cmd('picRotR', { contextual: true, label: 'Rotate right', icon: 'rotate-cw', enabled: picOn, run: () => picEdit(picRotate(1)) });
cmd('picFlipH', { contextual: true, label: 'Flip horizontal', icon: 'flip-horizontal-2', enabled: picOn, run: () => picEdit(picFlip(true)) });
cmd('picFlipV', { contextual: true, label: 'Flip vertical', icon: 'flip-vertical-2', enabled: picOn, run: () => picEdit(picFlip(false)) });
cmd('picCrop', { contextual: true, label: 'Crop', icon: 'crop', enabled: picOn, run: picCropStart });
cmd('picCropApply', { label: 'Apply crop', icon: 'check', enabled: () => !!picCrop, run: () => picCropEnd(true) });
cmd('picCropCancel', { label: 'Cancel crop', icon: 'x', enabled: () => !!picCrop, run: () => picCropEnd(false) });
cmd('picReplace', { contextual: true, label: 'Replace…', icon: 'replace', enabled: picOn, run: () => picInput.click() });
cmd('picExtract', { contextual: true, rlabel: 'Save as PNG', label: 'Save picture as PNG…', icon: 'image-down', enabled: picOn, run: picExtract });
cmd('picDelete', { label: 'Delete picture', icon: 'trash-2', enabled: picOn, run: picDelete });
cmd('picExportAll', { rlabel: 'All pictures', label: 'Export all pictures…', icon: 'images', enabled: has, run: picExportAll });
ribbonAdd('edit', 'Picture', ['picRotL', 'picRotR', 'picFlipH', 'picFlipV', 'picCrop', 'picReplace', 'picExtract']);
ribbonAdd('export', 'Export', ['picExportAll']);
// Next to the other exports, so Close (Cmd+W) stays last in File.
{ const fm = MENUS.find(([t]) => t === 'File'), i = fm ? fm[1].indexOf('exportText') : -1; if (i >= 0) { if (!fm[1].includes('picExportAll')) fm[1].splice(i + 1, 0, 'picExportAll'); } else menuAdd('File', ['picExportAll']); }

// For tests: each picture painted on a page, with its matrix and the box of the clip in force when it is painted.
TEST_HOOKS.picOps = async (n) => {
  const page = views[n].page, ops = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE }), O = pdfjs.OPS;
  const out = [], stack = []; let ctm = [1, 0, 0, 1, 0, 0], clip = null, pathBox = null, pendingClip = false;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], a = ops.argsArray[i];
    if (fn === O.save) stack.push([ctm, clip]);
    else if (fn === O.restore) [ctm, clip] = stack.pop() || [[1, 0, 0, 1, 0, 0], null];
    else if (fn === O.transform) ctm = mul(a, ctm);
    else if (fn === O.clip || fn === O.eoClip) pendingClip = true;
    else if (fn === O.constructPath) {
      // [op, [path], minMax]: minMax is the path's box in user space
      const mm = a[2], b = mm && [apply(ctm, mm[0], mm[1]), apply(ctm, mm[2], mm[3])];
      pathBox = b ? [Math.min(b[0][0], b[1][0]), Math.min(b[0][1], b[1][1]), Math.max(b[0][0], b[1][0]), Math.max(b[0][1], b[1][1])] : null;
      if (pendingClip || a[0] === O.endPath) { if (pendingClip && pathBox) clip = clip ? [Math.max(clip[0], pathBox[0]), Math.max(clip[1], pathBox[1]), Math.min(clip[2], pathBox[2]), Math.min(clip[3], pathBox[3])] : pathBox; pendingClip = false; }
    } else if (fn === O.endPath && pendingClip && pathBox) { clip = clip ? [Math.max(clip[0], pathBox[0]), Math.max(clip[1], pathBox[1]), Math.min(clip[2], pathBox[2]), Math.min(clip[3], pathBox[3])] : pathBox; pendingClip = false; }
    else if (fn === O.paintFormXObjectBegin) { stack.push([ctm, clip]); if (a && a[0]) ctm = mul(a[0], ctm); }
    else if (fn === O.paintFormXObjectEnd) [ctm, clip] = stack.pop() || [ctm, clip];
    else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject) out.push({ mat: ctm.map((x) => Math.round(x * 100) / 100), clip: clip && clip.map((x) => Math.round(x * 10) / 10) });
  }
  return out;
};
TEST_HOOKS.picInfo = async (n) => { const v = views[n], cm = await contentMap(v.page); return Promise.all(cm.images.map(async (im) => { const k = await picInfo(v.entry, im); return k && { jpeg: k.jpeg, cs: k.cs, cmyk: k.cmyk, w: k.w, h: k.h, smask: k.smask }; })); };
TEST_HOOKS.picExportAll = picExportAll;
TEST_HOOKS.picSel = () => { const s = picSel(); return s && { kind: s.kind, mat: picMatOf(s), crop: picCropOf(s), cropping: !!picCrop }; };
