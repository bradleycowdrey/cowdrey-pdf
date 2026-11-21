/* ---------------- enhance a picture ----------------
   Brightness, contrast, auto levels, saturation, greyscale, black and white (a threshold), sharpen (unsharp mask),
   straighten (an angle, or Auto), remove specks (a median filter) and resample to a resolution, for the picture
   selected (one in the PDF, picked with Edit PDF, or one added here). A panel beside the page holds the settings; the
   result shows live on a canvas over the picture. Apply makes one new picture (the original leaves the saved file) and
   can be undone. Pictures in CMYK become RGB once changed: the panel says so. */
const IE_DEF = { brightness: 0, contrast: 0, saturation: 0, sharpen: 0, angle: 0, level: false, gray: false, bw: false, threshold: 128, speck: false, resample: false, dpi: 150 };
let ieNow = null; // { sel, v, id, src: canvas (full size), small: canvas (preview size), o, view: canvas, panel, codec, cmyk, raf }

/* ---- the pixel work (pure: a canvas in, a new canvas out) ---- */
const ieCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ieLum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
function ieProcess(src, o, size) {
  let c = src;
  const W = c.width, H = c.height;
  if (o.angle) { // turned about the centre; the corners left are white (or clear, for a picture with transparency)
    const t = ieCanvas(W, H), g = t.getContext('2d');
    if (o.opaque !== false) { g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, H); }
    g.translate(W / 2, H / 2); g.rotate(o.angle * Math.PI / 180); g.drawImage(c, -W / 2, -H / 2);
    c = t;
  }
  const out = ieCanvas(W, H), g = out.getContext('2d', { willReadFrequently: true });
  g.drawImage(c, 0, 0);
  const img = g.getImageData(0, 0, W, H), d = img.data, n = W * H;
  if (o.speck) ieMedian(d, W, H);
  if (o.level) ieLevels(d);
  const b = o.brightness * 2.55, cc = o.contrast * 2.55, f = (259 * (cc + 255)) / (255 * (259 - cc)), s = 1 + o.saturation / 100;
  if (b || cc || o.saturation || o.gray || o.bw) {
    for (let i = 0; i < n * 4; i += 4) {
      let r = d[i], gg = d[i + 1], bb = d[i + 2];
      if (b) { r += b; gg += b; bb += b; }
      if (cc) { r = f * (r - 128) + 128; gg = f * (gg - 128) + 128; bb = f * (bb - 128) + 128; }
      if (o.saturation && !o.gray && !o.bw) { const L = ieLum(r, gg, bb); r = L + (r - L) * s; gg = L + (gg - L) * s; bb = L + (bb - L) * s; }
      if (o.gray || o.bw) { const L = ieLum(r, gg, bb); r = gg = bb = o.bw ? (L >= o.threshold ? 255 : 0) : L; }
      d[i] = r; d[i + 1] = gg; d[i + 2] = bb; // the array clamps and rounds
    }
  }
  if (o.sharpen && !o.bw) ieSharpen(d, W, H, o.sharpen / 50);
  // grey stays exactly grey after rounding
  if (o.gray || o.bw) for (let i = 0; i < n * 4; i += 4) d[i + 1] = d[i + 2] = d[i];
  g.putImageData(img, 0, 0);
  if (!size || (size[0] === W && size[1] === H)) return out;
  const r = ieCanvas(size[0], size[1]), rg = r.getContext('2d');
  rg.imageSmoothingEnabled = true; rg.imageSmoothingQuality = 'high'; rg.drawImage(out, 0, 0, size[0], size[1]);
  return r;
}
// Auto levels: each colour stretched so its darkest and lightest half percent reach black and white.
function ieLevels(d) {
  const n = d.length / 4;
  for (let ch = 0; ch < 3; ch++) {
    const h = new Uint32Array(256); for (let i = ch; i < d.length; i += 4) h[d[i]]++;
    let lo = 0, hi = 255, acc = 0; const cut = n * 0.005;
    while (lo < 255 && (acc += h[lo]) <= cut) lo++;
    acc = 0; while (hi > 0 && (acc += h[hi]) <= cut) hi--;
    if (hi - lo < 8) continue;
    const k = 255 / (hi - lo);
    for (let i = ch; i < d.length; i += 4) d[i] = (d[i] - lo) * k;
  }
}
// Remove specks: the middle value of each 3 × 3 neighbourhood, colour by colour.
function ieMedian(d, W, H) {
  const src = new Uint8ClampedArray(d), v = new Array(9);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    for (let ch = 0; ch < 3; ch++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) v[k++] = src[((y + dy) * W + x + dx) * 4 + ch];
      v.sort((a, b) => a - b);
      d[(y * W + x) * 4 + ch] = v[4];
    }
  }
}
// Sharpen: an unsharp mask over a small blur.
function ieSharpen(d, W, H, amount) {
  const src = new Uint8ClampedArray(d), K = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    for (let ch = 0; ch < 3; ch++) {
      let s = 0, k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += src[((y + dy) * W + x + dx) * 4 + ch] * K[k++];
      const i = (y * W + x) * 4 + ch; d[i] = src[i] + amount * (src[i] - s / 16);
    }
  }
}
// How far a picture's lines of text (or other lines) lean, in degrees (clockwise on screen): the angle at which its
// dark pixels fall into the sharpest rows. The OCR clean-up module's own deskew is used when it is there.
async function ieAutoAngle(c) {
  for (const f of [typeof ocrCleanDeskewAngle === 'function' ? ocrCleanDeskewAngle : null, typeof ocrClean !== 'undefined' && ocrClean && typeof ocrClean.deskewAngle === 'function' ? ocrClean.deskewAngle : null]) {
    if (!f) continue;
    try { const a = await f(c); const deg = typeof a === 'number' ? a : a && a.angle; if (Number.isFinite(deg)) return deg; } catch (e) { console.warn('deskew', e); }
  }
  const k = Math.min(1, 500 / Math.max(c.width, c.height)), w = Math.max(1, Math.round(c.width * k)), h = Math.max(1, Math.round(c.height * k));
  const t = ieCanvas(w, h), g = t.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, w, h); g.drawImage(c, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data; let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += ieLum(d[i], d[i + 1], d[i + 2]);
  const mean = sum / (w * h), pts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (ieLum(d[i], d[i + 1], d[i + 2]) < Math.min(128, mean * 0.75)) pts.push(x - w / 2, y - h / 2); }
  if (pts.length < 40) return 0;
  const step = Math.max(1, Math.floor(pts.length / 2 / 30000)) * 2;
  let best = 0, bestScore = -1;
  for (let a = -15; a <= 15.001; a += 0.25) {
    const r = a * Math.PI / 180, sn = Math.sin(r), cs = Math.cos(r), off = Math.ceil(Math.hypot(w, h) / 2), bins = new Float64Array(off * 2 + 2);
    for (let i = 0; i < pts.length; i += step) bins[Math.round(pts[i + 1] * cs - pts[i] * sn) + off]++;
    let s = 0; for (const b of bins) s += b * b;
    if (s > bestScore * 1.0001) { bestScore = s; best = a; }
  }
  return -best; // turn it back
}

/* ---- the panel ---- */
addStyle(`
.ie-panel { position: fixed; z-index: 40; right: 16px; top: 130px; width: 290px; max-height: calc(100vh - 160px); overflow: auto; background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 10px 34px rgba(0,0,0,.28); padding: 12px 14px; font-size: 13px; }
.ie-panel h2 { font-size: 14px; margin: 0 0 8px; }
.ie-panel .ie-row { display: grid; grid-template-columns: 92px 1fr 38px; align-items: center; gap: 6px; margin: 6px 0; }
.ie-panel .ie-row input[type="range"] { width: 100%; accent-color: var(--accent); }
.ie-panel .ie-row output { font-variant-numeric: tabular-nums; text-align: right; color: var(--ink-2); font-size: 12px; }
.ie-panel .ie-check { display: flex; align-items: center; gap: 8px; margin: 6px 0; cursor: pointer; }
.ie-panel .ie-check input { accent-color: var(--accent); margin: 0; }
.ie-panel .ie-dpi { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
.ie-panel .ie-dpi input[type="number"] { width: 72px; }
.ie-panel .ie-note { font-size: 12px; color: var(--ink-2); margin: 8px 0; }
.ie-panel .ie-foot { display: flex; gap: 6px; justify-content: flex-end; margin-top: 12px; }
.ie-panel .ie-foot .btn { height: 30px; padding: 0 12px; }
.ie-panel .ie-auto { height: 24px; padding: 0 8px; font-size: 12px; }
.ie-view { position: absolute; left: 0; top: 0; z-index: 4; transform-origin: 0 0; pointer-events: none; }
@media (max-width: 760px), (max-height: 500px) and (pointer: coarse) { .ie-panel { left: 8px; right: 8px; top: auto; bottom: 8px; width: auto; max-height: 52vh; } }
`);
const IE_SLIDERS = [['brightness', 'Brightness', -100, 100, 1], ['contrast', 'Contrast', -100, 100, 1], ['saturation', 'Saturation', -100, 100, 1], ['sharpen', 'Sharpen', 0, 100, 1], ['angle', 'Straighten', -45, 45, 0.25]];
function ieDpiNow(st) { const m = st.mat, wIn = Math.hypot(m[0], m[1]) / 72; return wIn > 0 ? Math.round(st.src.width / wIn) : 0; }
async function ieOpen() {
  const sel = picSel(); if (!sel) return;
  if (ieNow) ieClose();
  const data = await picDataOf(sel); if (!data) { toast('This picture can’t be changed, but it can be deleted or erased.'); return; }
  const img = new Image(); img.src = data; try { await img.decode(); } catch { toast('This picture can’t be changed.'); return; }
  const src = ieCanvas(img.naturalWidth, img.naturalHeight), sg = src.getContext('2d', { willReadFrequently: true }); sg.drawImage(img, 0, 0);
  const k = Math.min(1, 700 / Math.max(src.width, src.height)), small = ieCanvas(Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k)));
  small.getContext('2d').drawImage(src, 0, 0, small.width, small.height);
  const opaque = picOpaque(sg.getImageData(0, 0, src.width, src.height).data);
  let cmyk = false;
  if (sel.kind === 'ie' && (!sel.s.mark || sel.s.mark.orig)) { const info = await picInfo(sel.v.entry, sel.s.im).catch(() => null); cmyk = !!(info && info.cmyk); }
  const st = ieNow = { sel, v: sel.v, id: picIdOf(sel), src, small, opaque, o: { ...IE_DEF, opaque }, codec: await picCodecOf(sel), cmyk, mat: picMatOf(sel).slice() };
  st.o.dpi = ieDpiNow(st) || 150;
  const panel = st.panel = document.createElement('div');
  panel.className = 'ie-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Enhance picture');
  panel.innerHTML = `<h2>Enhance picture</h2>
    ${IE_SLIDERS.map(([k, label, lo, hi, step]) => `<label class="ie-row"><span>${label}</span><input type="range" id="ie_${k}" data-k="${k}" min="${lo}" max="${hi}" step="${step}" value="${st.o[k]}"><output id="ie_${k}_v">${st.o[k]}</output></label>`).join('')}
    <div class="ie-row" style="grid-template-columns: 1fr auto"><span></span><button type="button" class="btn ie-auto" id="ieAuto">Straighten automatically</button></div>
    <label class="ie-check"><input type="checkbox" id="ie_level" data-k="level"><span>Auto levels</span></label>
    <label class="ie-check"><input type="checkbox" id="ie_gray" data-k="gray"><span>Greyscale</span></label>
    <label class="ie-check"><input type="checkbox" id="ie_bw" data-k="bw"><span>Black and white</span></label>
    <label class="ie-row" id="ie_threshold_row" hidden><span>Threshold</span><input type="range" id="ie_threshold" data-k="threshold" min="1" max="254" step="1" value="${st.o.threshold}"><output id="ie_threshold_v">${st.o.threshold}</output></label>
    <label class="ie-check"><input type="checkbox" id="ie_speck" data-k="speck"><span>Remove specks</span></label>
    <div class="ie-dpi"><label class="ie-check" style="margin:0"><input type="checkbox" id="ie_resample" data-k="resample"><span>Resample to</span></label><input type="number" id="ie_dpi" data-k="dpi" min="36" max="1200" step="1" value="${st.o.dpi}" aria-label="Resolution in dots per inch"><span>dpi</span></div>
    <p class="ie-note">${esc(`${st.src.width} × ${st.src.height} pixels, about ${ieDpiNow(st)} dpi.`)}${cmyk ? ' This picture is CMYK: once changed it is saved as RGB.' : ''}</p>
    <div class="ie-foot"><button type="button" class="btn" id="ieReset">Reset</button><button type="button" class="btn" id="ieCancel">Cancel</button><button type="button" class="btn primary" id="ieApply">Apply</button></div>`;
  document.body.appendChild(panel);
  panel.addEventListener('input', (e) => {
    const t = e.target, k = t.dataset && t.dataset.k; if (!k) return;
    st.o[k] = t.type === 'checkbox' ? t.checked : +t.value;
    const out = $(`#ie_${k}_v`, panel); if (out) out.textContent = t.value;
    if (k === 'bw') $('#ie_threshold_row', panel).hidden = !t.checked;
    iePreview();
  });
  $('#ieAuto', panel).onclick = async () => { const a = Math.max(-45, Math.min(45, Math.round(await ieAutoAngle(st.src) * 4) / 4)); st.o.angle = a; $('#ie_angle', panel).value = a; $('#ie_angle_v', panel).textContent = a; iePreview(); };
  $('#ieReset', panel).onclick = () => { ieSet({ ...IE_DEF, dpi: ieDpiNow(st) || 150 }); };
  $('#ieCancel', panel).onclick = () => ieClose();
  $('#ieApply', panel).onclick = () => ieApply();
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ieClose(); } });
  iePreview(); refreshRibbon();
  const first = $('#ie_brightness', panel); if (first) first.focus();
}
// Settings set from outside (Reset, the tests): the panel follows.
function ieSet(o) {
  const st = ieNow; if (!st) return;
  Object.assign(st.o, o);
  for (const [k, v] of Object.entries(st.o)) {
    const el = $(`#ie_${k}`, st.panel); if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    const out = $(`#ie_${k}_v`, st.panel); if (out) out.textContent = v;
  }
  $('#ie_threshold_row', st.panel).hidden = !st.o.bw;
  iePreview();
}
// The live result, on a canvas laid over the picture on the page.
function iePreview() {
  const st = ieNow; if (!st) return;
  cancelAnimationFrame(st.raf);
  st.raf = requestAnimationFrame(() => {
    if (ieNow !== st) return;
    const v = st.v, o = { ...st.o, angle: st.o.angle };
    const c = ieProcess(st.small, o);
    let view = v.el.querySelector(':scope > canvas.ie-view');
    if (!view) { view = document.createElement('canvas'); view.className = 'ie-view'; v.el.appendChild(view); }
    view.width = c.width; view.height = c.height; view.getContext('2d').drawImage(c, 0, 0);
    const m = picMatOf(st.sel), O = toView(v, ...apply(m, 0, 1)), X = toView(v, ...apply(m, 1, 1)), Y = toView(v, ...apply(m, 0, 0));
    view.style.transform = `matrix(${(X[0] - O[0]) / c.width}, ${(X[1] - O[1]) / c.width}, ${(Y[0] - O[0]) / c.height}, ${(Y[1] - O[1]) / c.height}, ${O[0]}, ${O[1]})`;
    const crop = picCropOf(st.sel);
    view.style.clipPath = crop ? `inset(${(1 - crop[3]) * 100}% ${(1 - crop[2]) * 100}% ${crop[1] * 100}% ${crop[0] * 100}%)` : '';
  });
}
function ieClose() {
  const st = ieNow; if (!st) return;
  ieNow = null; cancelAnimationFrame(st.raf);
  st.panel.remove();
  const view = st.v.el.querySelector(':scope > canvas.ie-view'); if (view) view.remove();
  refreshRibbon();
}
async function ieApply() {
  const st = ieNow; if (!st) return false;
  const o = st.o, sameAsBefore = JSON.stringify({ ...o, dpi: 0, opaque: 0 }) === JSON.stringify({ ...IE_DEF, dpi: 0, opaque: 0 });
  if (sameAsBefore) { ieClose(); return false; }
  let size = null;
  if (o.resample && o.dpi > 0) {
    const m = st.mat, wIn = Math.hypot(m[0], m[1]) / 72, hIn = Math.hypot(m[2], m[3]) / 72;
    size = [Math.max(1, Math.round(wIn * o.dpi)), Math.max(1, Math.round(hIn * o.dpi))];
    if (size[0] * size[1] > 40e6) { toast('That resolution is too high for this picture.'); return false; }
  }
  const c = ieProcess(st.src, o, size), grey = o.gray || o.bw;
  const opaque = picOpaque(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
  // JPEG stays JPEG, except for grey results, which are kept exactly (Flate, one grey channel).
  const data = st.codec === 'jpeg' && opaque && !grey ? c.toDataURL('image/jpeg', 0.92) : c.toDataURL('image/png');
  const codec = st.codec === 'jpeg' && !opaque && !grey ? 'jpeg' : null;
  const sel = st.sel;
  ieClose();
  const done = await picEdit((m) => { m.data = data; m.orig = false; if (codec) m.codec = codec; else delete m.codec; }, sel);
  if (done) undoToast('Picture changed');
  return done;
}
// The panel goes when the picture is no longer selected (or another one is).
FEATURE.afterRender.push(() => { if (ieNow && !ieNow.v.el.isConnected) ieClose(); });
FEATURE.onDocShown.push(() => ieClose());
FEATURE.onDocClosed.push(() => ieClose());
const ieDrawMarks0 = drawMarks;
drawMarks = function (v) {
  ieDrawMarks0(v);
  const st = ieNow;
  if (st && st.v === v) { const s = picSel(); if (!s || picIdOf(s) && st.id && picIdOf(s) !== st.id) ieClose(); else iePreview(); }
};

/* ---- commands and menus ---- */
cmd('imgEnhance', { contextual: true, rlabel: 'Enhance', label: 'Enhance picture…', icon: 'sliders-horizontal', enabled: () => !!picSel() && !picCrop, pressed: () => !!ieNow, run: () => (ieNow ? ieClose() : ieOpen()) });
ribbonAdd('edit', 'Picture', ['imgEnhance']);
const IE_MENU = ['picRotL', 'picRotR', 'picFlipH', 'picFlipV', '-', 'picCrop', 'imgEnhance', '-', 'picReplace', 'picExtract', '-', 'picDelete'];
const ieMenuItems = () => IE_MENU.map((id) => id === '-' ? '-' : ctxCmd(id));
FEATURE.markTypes.pic.menu = IE_MENU.filter((id) => id !== '-' && id !== 'picDelete');
// Right-click on the picture selected with Edit PDF (or on a picture moved before): the picture's own menu.
const iePageMenu0 = pageMenu;
pageMenu = function (v, cx, cy, anchor) {
  const sel = picSel();
  if (sel && sel.v === v && sel.kind === 'ie') {
    const b = v.el.getBoundingClientRect(), [x, y] = toPdf(v, cx - b.left, cy - b.top);
    if (inQuad(picQuad(picMatOf(sel), picCropOf(sel)), x, y)) return openCtx(ieMenuItems(), { x: cx, y: cy }, anchor || viewer, 'Picture');
  }
  return iePageMenu0(v, cx, cy, anchor);
};
const ieMarkMenu0 = markMenu;
markMenu = function (v, m, at, anchor) {
  if (m.type === 'ie' && !m.deleted) {
    contentMap(v.page).then((cm) => {
      if (!(selContent && selContent.mark === m)) selectContent({ v, kind: 'image', im: imageOf(cm, m) || { n: m.n, quad: m.quad, mat: quadMat(m.quad) }, mark: m });
      openCtx(ieMenuItems(), at, anchor || viewer, 'Picture');
    });
    return true;
  }
  if (m.type === 'img') {
    const r = ieMarkMenu0(v, m, at, anchor);
    const extra = ['-', ...IE_MENU.filter((id) => id !== '-' && id !== 'picDelete')].map((id) => id === '-' ? '-' : ctxCmd(id));
    return openCtx([...ctxItems, ...extra], at, anchor || viewer, 'Picture') && r;
  }
  return ieMarkMenu0(v, m, at, anchor);
};

TEST_HOOKS.ieOpen = () => ieOpen();
TEST_HOOKS.ieSet = (o) => ieSet(o);
TEST_HOOKS.ieApply = () => ieApply();
TEST_HOOKS.ieAutoAngle = async (data) => { const img = new Image(); img.src = data; await img.decode(); const c = ieCanvas(img.naturalWidth, img.naturalHeight); c.getContext('2d').drawImage(img, 0, 0); return ieAutoAngle(c); };
TEST_HOOKS.ieOpenNow = () => !!ieNow;
