/* ---------------- OCR clean-up: the page image made easy to read before text recognition ----------------
   ocrClean(imageData, opts) -> { imageData, angle, turn, width, height, map, mode, gray? } is a pure function (plain
   JavaScript on the pixels, no canvas, no app state), so it runs in a worker, in tests, and for picture clean-up:
     1. grayscale, then auto-levels (the darkest ink to black, the paper to white);
     2. which way the lines run (with opts.orient): lines running up the page are turned a quarter turn to run across;
     3. deskew: the slant of the lines, found by a projection-profile search from -maxAngle to +maxAngle degrees in
        `step` degree steps (on a smaller copy), then the image is turned straight (bilinear);
     4. binarisation: Sauvola (local mean and spread, for uneven light and shadows) or Otsu (one threshold);
     5. despeckle: specks of ink no bigger than `despeckle` pixels each way are taken out, and lone ones up to twice that.
   `map` is the affine matrix [a, b, c, d, e, f] that takes a pixel of the result back to the source image
   (x' = a x + c y + e, y' = b x + d y + f), so words found on the clean image land on the original scan.
   `angle` is the slant that was taken out, in degrees, clockwise as seen (y runs down); `turn` the quarter turn
   (0 or 90, clockwise) and, after ocrCleanFlip, 180 or 270. `mode` guesses what the source is: 'bw' (black ink on
   white), 'gray' or 'colour'. With opts.keepGray the straightened gray image (before binarisation) is returned too. */

// [a, b, c, d, e, f] matrices, the PDF way: ocrcMul(m, n) applies m, then n.
const ocrcMul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const ocrcApply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function ocrcInvert(m) {
  const det = m[0] * m[3] - m[1] * m[2] || 1;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
// Turning straight by `angle` degrees about the middle of a w x h image: result pixel -> source pixel.
function ocrcDeskew(angle, w, h) {
  const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), cx = w / 2, cy = h / 2;
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}
// Luma, 0..255
function ocrcGray(d, n, hist) {
  const g = new Uint8Array(n), px = new Uint32Array(d.buffer, d.byteOffset, n);
  for (let i = 0; i < n; i++) { const p = px[i], v = ((p & 255) * 77 + ((p >> 8) & 255) * 150 + ((p >> 16) & 255) * 29) >> 8; g[i] = v; hist[v]++; }
  return g;
}
// What the page is: colour (some real colour on it), black and white (almost nothing between ink and paper) or gray.
function ocrcMode(d, g, n) {
  let colour = 0, mid = 0, seen = 0;
  for (let i = 0; i < n; i += 7) {
    const j = i * 4, r = d[j], gg = d[j + 1], b = d[j + 2];
    if (Math.abs(r - gg) + Math.abs(gg - b) + Math.abs(r - b) > 60) colour++;
    if (g[i] > 70 && g[i] < 185) mid++;
    seen++;
  }
  return colour > Math.max(50, seen * .001) ? 'colour' : mid > seen * .05 ? 'gray' : 'bw';
}
// Auto-levels: the 0.5% darkest to black and the 2% lightest to white.
function ocrcLevel(g, h) {
  const n = g.length;
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255; lo++) { acc += h[lo]; if (acc > n * .005) break; }
  acc = 0;
  for (; hi > 0; hi--) { acc += h[hi]; if (acc > n * .02) break; }
  if (hi - lo < 32) return;
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.max(0, Math.min(255, Math.round((v - lo) * 255 / (hi - lo))));
  for (let i = 0; i < n; i++) g[i] = lut[g[i]];
}
function ocrcOtsu(hist, total) {
  let sum = 0; for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let v = 0; v < 256; v++) {
    wB += hist[v]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += v * hist[v];
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; t = v; }
  }
  return t;
}
// The ink of a smaller copy (about 1100 px on its long side), as points about its middle, for the angle search.
function ocrcInkPoints(g, w, h) {
  const f = Math.max(1, Math.round(Math.max(w, h) / 1100)), sw = Math.floor(w / f), sh = Math.floor(h / f);
  const small = new Uint8Array(sw * sh), hist = new Uint32Array(256), ff = f * f;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let s = 0;
    for (let yy = 0; yy < f; yy++) { const row = (y * f + yy) * w + x * f; for (let xx = 0; xx < f; xx++) s += g[row + xx]; }
    const v = (s / ff) | 0; small[y * sw + x] = v; hist[v]++;
  }
  const t = Math.min(ocrcOtsu(hist, sw * sh), 200);
  let n = 0; for (let i = 0; i < small.length; i++) if (small[i] < t) n++;
  const stride = Math.max(1, Math.ceil(n / 60000));
  const xs = new Float32Array(Math.ceil(n / stride) + 1), ys = new Float32Array(xs.length);
  let k = 0, c = 0;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (small[y * sw + x] < t && (c++ % stride === 0)) { xs[k] = x - sw / 2; ys[k] = y - sh / 2; k++; }
  return { xs: xs.subarray(0, k), ys: ys.subarray(0, k), n: k, diag: Math.ceil(Math.hypot(sw, sh)) + 4, f };
}
// Projection profile: for each angle, how sharply the ink falls into rows (the sum of squares of the row counts).
// Returns the best angle (refined between steps) and its score against the score at 0.
function ocrcSearch(P, maxAngle, step) {
  const bins = new Float64Array(P.diag), half = P.diag / 2, steps = Math.round(maxAngle / step), scores = [];
  for (let k = -steps; k <= steps; k++) {
    const a = k * step * Math.PI / 180, s = Math.sin(a), c = Math.cos(a);
    bins.fill(0);
    for (let i = 0; i < P.n; i++) bins[(-P.xs[i] * s + P.ys[i] * c + half) | 0]++;
    let sc = 0; for (let b = 0; b < bins.length; b++) sc += bins[b] * bins[b];
    scores.push(sc);
  }
  let best = 0; for (let k = 1; k < scores.length; k++) if (scores[k] > scores[best]) best = k;
  let angle = (best - steps) * step;
  if (best > 0 && best < scores.length - 1) {
    const l = scores[best - 1], m = scores[best], r = scores[best + 1], den = l - 2 * m + r;
    if (den < 0) angle += Math.max(-.5, Math.min(.5, .5 * (l - r) / den)) * step;
  }
  return { angle, score: scores[best], flat: scores[steps] || 1, mean: scores.reduce((a, b) => a + b, 0) / scores.length };
}
// A quarter turn clockwise (the result is h wide and w tall).
function ocrcTurn90(g, w, h) {
  const o = new Uint8Array(w * h);
  for (let v = 0; v < w; v++) { const sy = v; for (let u = 0; u < h; u++) o[v * h + u] = g[(h - 1 - u) * w + sy]; }
  return o;
}
// The image turned by the matrix (result pixel -> source pixel), with white where it runs off the source.
function ocrcWarp(g, w, h, m) {
  // fixed point (16 bits of fraction): a quarter of the time of floating point here
  const o = new Uint8Array(w * h), F = 65536;
  const [a, b, c, d, e, f] = m, ai = Math.round(a * F), bi = Math.round(b * F), wl = (w - 1) * F, hl = (h - 1) * F;
  for (let v = 0; v < h; v++) {
    let x = Math.round((a * .5 + c * (v + .5) + e - .5) * F), y = Math.round((b * .5 + d * (v + .5) + f - .5) * F);
    const row = v * w;
    for (let u = 0; u < w; u++, x += ai, y += bi) {
      if (x < 0 || y < 0 || x >= wl || y >= hl) { o[row + u] = 255; continue; }
      const x0 = x >> 16, y0 = y >> 16, fx = (x & 0xffff) >> 8, fy = (y & 0xffff) >> 8, i = y0 * w + x0;
      const p00 = g[i], p01 = g[i + 1], p10 = g[i + w], p11 = g[i + w + 1];
      const top = (p00 << 8) + (p01 - p00) * fx, bot = (p10 << 8) + (p11 - p10) * fx;
      o[row + u] = ((top << 8) + (bot - top) * fy) >> 16;
    }
  }
  return o;
}
// Ink (1) or paper (0), Sauvola style: a threshold from the mean and spread around each block of the page (blocks of
// about 16 px at 300 dpi, a window of 5 x 5 blocks), blended between blocks so no block edges show.
function ocrcSauvola(g, w, h, k = .3) {
  const B = Math.max(8, Math.round(Math.min(w, h) / 160)), gw = Math.ceil(w / B), gh = Math.ceil(h / B);
  const S = new Float64Array(gw * gh), SS = new Float64Array(gw * gh), N = new Float64Array(gw * gh);
  // (every other pixel each way is plenty for a mean and a spread)
  const bxOf = new Int32Array(w); for (let x = 0; x < w; x++) bxOf[x] = (x / B) | 0;
  for (let y = 0; y < h; y += 2) {
    const row = y * w, by = ((y / B) | 0) * gw;
    for (let x = 0; x < w; x += 2) { const v = g[row + x], bi = by + bxOf[x]; S[bi] += v; SS[bi] += v * v; N[bi]++; }
  }
  const T = new Float32Array(gw * gh), r = 2;
  for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
    let s = 0, ss = 0, n = 0;
    for (let yy = Math.max(0, by - r); yy <= Math.min(gh - 1, by + r); yy++) for (let xx = Math.max(0, bx - r); xx <= Math.min(gw - 1, bx + r); xx++) { const i = yy * gw + xx; s += S[i]; ss += SS[i]; n += N[i]; }
    const m = s / n, sd = Math.sqrt(Math.max(0, ss / n - m * m));
    T[by * gw + bx] = m * (1 + k * (sd / 128 - 1));
  }
  // each row of blocks blended across the page once, then each pixel row between two of them
  const TX = new Float32Array(gh * w);
  for (let by = 0; by < gh; by++) for (let x = 0; x < w; x++) {
    let gx = (x + .5) / B - .5; if (gx < 0) gx = 0; if (gx > gw - 1) gx = gw - 1;
    const i0 = Math.max(0, Math.min(gw - 2, Math.floor(gx))), i1 = Math.min(gw - 1, i0 + 1), fx = gw > 1 ? gx - i0 : 0;
    TX[by * w + x] = T[by * gw + i0] + (T[by * gw + i1] - T[by * gw + i0]) * fx;
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let gy = (y + .5) / B - .5; if (gy < 0) gy = 0; if (gy > gh - 1) gy = gh - 1;
    const j0 = Math.max(0, Math.min(gh - 2, Math.floor(gy))), fy = gh > 1 ? gy - j0 : 0, j1 = Math.min(gh - 1, j0 + 1), row = y * w, a0 = j0 * w, a1 = j1 * w;
    for (let x = 0; x < w; x++) { const t0 = TX[a0 + x]; out[row + x] = g[row + x] < t0 + (TX[a1 + x] - t0) * fy ? 1 : 0; }
  }
  return out;
}
function ocrcOtsuBin(g) {
  const hist = new Uint32Array(256); for (let i = 0; i < g.length; i++) hist[g[i]]++;
  const t = ocrcOtsu(hist, g.length), out = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) out[i] = g[i] <= t ? 1 : 0;
  return out;
}
// Specks: groups of touching ink pixels (8 ways) no bigger than `size` pixels across and down are taken out, and those
// up to twice that size too when nothing else is inked near them (4 x size around): a full stop or the dot of an i
// always has its letter close by, dust on the glass does not.
function ocrcDespeckle(bin, w, h, size) {
  let ink = 0; for (let i = 0; i < bin.length; i++) ink += bin[i];
  const big = size * 2, stack = new Int32Array(ink + 1), keep = new Int32Array(big * big + 1), lone = [];
  let removed = 0;
  for (let start = 0; start < bin.length; start++) {
    if (bin[start] !== 1) continue;
    let sp = 0, kept = 0, small = true, x0 = start % w, x1 = x0, y0 = (start / w) | 0, y1 = y0;
    stack[sp++] = start; bin[start] = 2;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p / w) | 0;
      if (small) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x1 - x0 >= big || y1 - y0 >= big || kept >= keep.length) small = false; else keep[kept++] = p;
      }
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx; if (bin[q] === 1) { bin[q] = 2; stack[sp++] = q; }
        }
      }
    }
    if (!small) continue;
    if (x1 - x0 < size && y1 - y0 < size) { for (let k = 0; k < kept; k++) bin[keep[k]] = 0; removed++; }
    else lone.push([x0, y0, x1, y1, keep.slice(0, kept)]);
  }
  const R = size * 4;
  for (const [x0, y0, x1, y1, px] of lone) {
    let near = false;
    for (let y = Math.max(0, y0 - R); y <= Math.min(h - 1, y1 + R) && !near; y++) {
      const row = y * w, inY = y >= y0 && y <= y1;
      for (let x = Math.max(0, x0 - R); x <= Math.min(w - 1, x1 + R); x++) if (bin[row + x] && !(inY && x >= x0 && x <= x1)) { near = true; break; }
    }
    if (!near) { for (let k = 0; k < px.length; k++) bin[px[k]] = 0; removed++; }
  }
  return removed; // ink is left as 2: anything but 0 is ink
}
function ocrClean(imageData, opts = {}) {
  const o = { level: true, deskew: true, orient: false, binarize: 'sauvola', despeckle: 3, maxAngle: 10, step: .2, minAngle: .25, keepGray: false, ...opts };
  const W = imageData.width, H = imageData.height, n = W * H;
  const hist = new Uint32Array(256);
  let g = ocrcGray(imageData.data, n, hist);
  const mode = ocrcMode(imageData.data, g, n);
  if (o.level) ocrcLevel(g, hist);
  let w = W, h = H, map = [1, 0, 0, 1, 0, 0], turn = 0, angle = 0;
  if (o.angle != null) angle = +o.angle || 0;
  else if (o.deskew || o.orient) {
    let P = ocrcInkPoints(g, w, h);
    if (P.n > 50) {
      if (o.orient) {
        // lines running up or down the page: the same search on the copy turned a quarter turn
        const Q = { ...P, xs: new Float32Array(P.n), ys: new Float32Array(P.n) };
        for (let i = 0; i < P.n; i++) { Q.xs[i] = -P.ys[i]; Q.ys[i] = P.xs[i]; }
        // (a coarse search each way first: 1 degree steps)
        const across = ocrcSearch(P, o.maxAngle, 1), cols = ocrcSearch(Q, o.maxAngle, 1);
        if (cols.score > across.score * 1.3) {
          g = ocrcTurn90(g, w, h); map = [0, -1, 1, 0, 0, h]; [w, h] = [h, w]; turn = 90; P = Q;
        }
      }
      // only a clear peak is taken for a slant (a page of pictures or noise has none)
      const rows = o.deskew ? ocrcSearch(P, o.maxAngle, o.step) : null;
      if (rows && rows.score > rows.flat * 1.01) angle = rows.angle;
    }
  }
  if (Math.abs(angle) >= o.minAngle) {
    const D = ocrcDeskew(angle, w, h);
    g = ocrcWarp(g, w, h, D);
    map = ocrcMul(D, map);
  } else angle = 0;
  let bin = null;
  if (o.binarize) {
    bin = o.binarize === 'otsu' ? ocrcOtsuBin(g) : ocrcSauvola(g, w, h);
    if (o.despeckle > 0) ocrcDespeckle(bin, w, h, o.despeckle);
  }
  const outData = new Uint8ClampedArray(w * h * 4), px = new Uint32Array(outData.buffer);
  if (bin) for (let i = 0; i < w * h; i++) px[i] = bin[i] ? 0xff000000 : 0xffffffff;
  else for (let i = 0; i < w * h; i++) px[i] = 0xff000000 | (g[i] * 0x010101);
  const res = { imageData: typeof ImageData === 'function' ? new ImageData(outData, w, h) : { data: outData, width: w, height: h }, angle: +angle.toFixed(3), turn, width: w, height: h, map, mode };
  if (o.keepGray) res.gray = g;
  return res;
}
// Half a turn more (the engine found the page upside down).
function ocrCleanFlip(res) {
  const w = res.width, h = res.height, px = new Uint32Array(res.imageData.data.buffer, res.imageData.data.byteOffset, w * h);
  px.reverse();
  if (res.gray) res.gray.reverse();
  res.map = ocrcMul([-1, 0, 0, -1, w, h], res.map);
  res.turn = (res.turn + 180) % 360;
  return res;
}
// Packs ink (1) / paper into 1-bit rows (0 = black, as DeviceGray reads them), for a black-and-white page image.
function ocrcPack1(imageData) {
  const { width: w, height: h, data } = imageData, rowBytes = (w + 7) >> 3, out = new Uint8Array(rowBytes * h).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4] < 128) out[y * rowBytes + (x >> 3)] &= ~(0x80 >> (x & 7));
  return out;
}

// The same work in a worker, so the page stays responsive; on the main thread when a worker can't be made.
const OCR_CLEAN_SRC = [ocrcMul, ocrcApply, ocrcDeskew, ocrcGray, ocrcMode, ocrcLevel, ocrcOtsu, ocrcInkPoints, ocrcSearch, ocrcTurn90, ocrcWarp, ocrcSauvola, ocrcOtsuBin, ocrcDespeckle, ocrClean]
  .map((f) => (typeof f === 'function' && !/^(function|async)/.test(f.toString()) ? `const ${f.name} = ${f}` : String(f))).join('\n');
let ocrCleanW = null, ocrCleanSeq = 0;
const ocrCleanWaiting = new Map();
function ocrCleanWorker() {
  if (ocrCleanW !== null) return ocrCleanW;
  try {
    const src = OCR_CLEAN_SRC + `\nonmessage = (e) => { const { id, data, width, height, opts } = e.data; try { const r = ocrClean({ data: new Uint8ClampedArray(data), width, height }, opts); const buf = r.imageData.data.buffer; const out = { id, angle: r.angle, turn: r.turn, width: r.width, height: r.height, map: r.map, mode: r.mode, data: buf, gray: r.gray ? r.gray.buffer : null }; postMessage(out, r.gray ? [buf, r.gray.buffer] : [buf]); } catch (err) { postMessage({ id, error: String(err && err.message || err) }); } };`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    ocrCleanW = new Worker(url);
    URL.revokeObjectURL(url);
    ocrCleanW.onmessage = (e) => { const f = ocrCleanWaiting.get(e.data.id); if (f) { ocrCleanWaiting.delete(e.data.id); f(e.data); } };
    ocrCleanW.onerror = (e) => { e.preventDefault && e.preventDefault(); for (const f of ocrCleanWaiting.values()) f({ error: 'worker' }); ocrCleanWaiting.clear(); ocrCleanW.terminate(); ocrCleanW = false; };
  } catch { ocrCleanW = false; }
  return ocrCleanW;
}
async function ocrCleanAsync(imageData, opts = {}) {
  const w = ocrCleanWorker();
  if (w) {
    const id = ++ocrCleanSeq, copy = new Uint8ClampedArray(imageData.data);
    const r = await new Promise((res) => { ocrCleanWaiting.set(id, res); w.postMessage({ id, data: copy.buffer, width: imageData.width, height: imageData.height, opts }, [copy.buffer]); });
    if (!r.error) return { imageData: new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), angle: r.angle, turn: r.turn, width: r.width, height: r.height, map: r.map, mode: r.mode, ...(r.gray ? { gray: new Uint8Array(r.gray) } : {}) };
  }
  return ocrClean(imageData, opts);
}

TEST_HOOKS.ocrClean = (imageData, opts) => ocrClean(imageData, opts);
TEST_HOOKS.ocrCleanAsync = (imageData, opts) => ocrCleanAsync(imageData, opts);
