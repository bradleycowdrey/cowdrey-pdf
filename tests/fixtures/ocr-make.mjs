// Run: node tests/fixtures/ocr-make.mjs. Makes tests/fixtures/ocr-skew.pdf (a page scanned 3 degrees askew, with specks) and ocr-sideways.pdf (a page fed
// in sideways, with no /Rotate), and ocr-scans.json with where each word is on each image.
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
import { open, close, root } from '../harness.mjs';
const require = createRequire(import.meta.url);
const { PDFDocument } = require('../../desktop/node_modules/pdf-lib');
const LINES = ['The quick brown fox jumps over the lazy pelican.', 'Invoice 4471 is due on 12 March 2026.', 'Please pay by bank transfer within thirty days.'];
const p = await open();
const make = (turn, skew) => p.evaluate(([LINES, turn, skew]) => {
  const W = 1700, H = 2200, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.fillStyle = '#151515'; x.font = '44px "Liberation Serif", "Times New Roman", Times, serif'; x.textBaseline = 'alphabetic';
  const lines = [];
  LINES.forEach((line, k) => {
    const by = 360 + k * 110; let cx = 170; const words = [];
    for (const w of line.split(' ')) {
      const m = x.measureText(w); x.fillText(w, cx, by);
      words.push({ text: w, box: [cx, by - m.actualBoundingBoxAscent, cx + m.width, by + m.actualBoundingBoxDescent] });
      cx += m.width + x.measureText(' ').width;
    }
    lines.push({ text: line, words });
  });
  // the scan: turned (skew, clockwise as seen) about the middle; or turned a quarter turn to the left (fed sideways)
  const out = document.createElement('canvas'), side = turn === 90;
  out.width = side ? H : W; out.height = side ? W : H;
  const y = out.getContext('2d'); y.fillStyle = '#f3f1ec'; y.fillRect(0, 0, out.width, out.height);
  let M;
  if (side) M = new DOMMatrix().translate(0, W).rotate(-90);
  else M = new DOMMatrix().translate(W / 2, H / 2).rotate(skew).translate(-W / 2, -H / 2);
  y.setTransform(M); y.globalCompositeOperation = 'multiply'; y.drawImage(c, 0, 0); y.setTransform(1, 0, 0, 1, 0, 0); y.globalCompositeOperation = 'source-over';
  // specks of dust: 1 and 2 pixels
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // (not on or right next to a word: there a speck can't be told from a full stop)
  const inv = M.inverse(), boxes = lines.flatMap((l) => l.words.map((w) => w.box));
  y.fillStyle = '#222';
  for (let k = 0; k < 900; k++) {
    const s = 1 + (k % 2), sx = Math.floor(rnd() * out.width), sy = Math.floor(rnd() * out.height), q = inv.transformPoint(new DOMPoint(sx, sy));
    if (boxes.some(([x0, y0, x1, y1]) => q.x > x0 - 16 && q.x < x1 + 16 && q.y > y0 - 16 && q.y < y1 + 16)) continue;
    y.fillRect(sx, sy, s, s);
  }
  for (const l of lines) for (const w of l.words) { const [x0, y0, x1, y1] = w.box; w.quad = [[x0, y1], [x1, y1], [x1, y0], [x0, y0]].map(([a, b]) => { const q = M.transformPoint(new DOMPoint(a, b)); return [+q.x.toFixed(2), +q.y.toFixed(2)]; }); delete w.box; }
  return { jpg: out.toDataURL('image/jpeg', .82).split(',')[1], W: out.width, H: out.height, lines };
}, [LINES, turn, skew]);
const info = {};
for (const [name, turn, skew] of [['ocr-skew', 0, 3], ['ocr-sideways', 90, 0]]) {
  const s = await make(turn, skew);
  const d = await PDFDocument.create(); d.setTitle(name === 'ocr-skew' ? 'A page scanned askew' : 'A page scanned sideways'); d.setCreator('Cowdrey.PDF tests'); d.setProducer('Cowdrey.PDF tests');
  d.setCreationDate(new Date('2026-01-01T00:00:00Z')); d.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  const img = await d.embedJpg(Buffer.from(s.jpg, 'base64'));
  const pw = s.W * 72 / 200, ph = s.H * 72 / 200;
  d.addPage([pw, ph]).drawImage(img, { x: 0, y: 0, width: pw, height: ph });
  fs.writeFileSync(path.join(root, 'tests/fixtures', name + '.pdf'), await d.save({ useObjectStreams: false }));
  info[name] = { W: s.W, H: s.H, dpi: 200, page: [pw, ph], skew, turn, lines: s.lines };
}
fs.writeFileSync(path.join(root, 'tests/fixtures/ocr-scans.json'), JSON.stringify(info, null, 1) + '\n');
await close();
console.log('made', Object.keys(info));
