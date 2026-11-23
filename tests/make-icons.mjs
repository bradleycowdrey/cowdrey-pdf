// The app icons, from desktop/src-tauri/icons/icon.svg (the artwork, edge to edge).
// - iPhone, iPad and Android (ios-source.png, android-source.png): the square artwork. The system draws the rounded shape.
// - Mac (icon.icns, icon.png, 32x32 to 128x128@2x) and Windows (icon.ico): the macOS shape on Apple's icon grid:
//   an 824 x 824 rounded square with continuous corners, centred in 1024 x 1024, with a soft shadow below it, as on
//   Cowdrey.MD and Cowdrey One. A square icon looks out of place in the Dock and Launchpad.
// Run: npm install --no-save playwright@1.56.1 && node tests/make-icons.mjs  (needs python3 with Pillow for .icns/.ico)
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(process.cwd(), 'node_modules/playwright')); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(root, 'desktop/src-tauri/icons');
const svg = fs.readFileSync(path.join(DIR, 'icon.svg'), 'utf8');

// Apple's continuous-corner rounded square: each corner is a quarter superellipse that starts 1.53 radii from the
// corner (where the curve of an Apple icon starts) and passes where a plain corner of radius 185.4 on 824 would.
function squircle(x, y, s, r = 185.4, steps = 48) {
  const R = 1.52866483 * r, n = Math.log(0.5) / Math.log(1 - r * (1 - Math.SQRT1_2) / R);
  // t = 0: on the side edge, R from the corner; t = pi/2: on the top or bottom edge, R from the corner.
  const q = (t) => [R - R * Math.cos(t) ** (2 / n), R - R * Math.sin(t) ** (2 / n)];
  const pts = [];
  // Corners clockwise from top left: corner point, directions into the square, and whether t runs backwards.
  for (const [cx, cy, sx, sy, back] of [[x, y, 1, 1, false], [x + s, y, -1, 1, true], [x + s, y + s, -1, -1, false], [x, y + s, 1, -1, true]])
    for (let i = 0; i <= steps; i++) {
      const [u, v] = q((back ? steps - i : i) / steps * Math.PI / 2);
      pts.push((cx + sx * u).toFixed(2) + ' ' + (cy + sy * v).toFixed(2));
    }
  return 'M' + pts.join('L') + 'Z';
}
const SHAPE = squircle(100, 100, 824);
const art = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
const mac = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}</style></head><body>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <clipPath id="c"><path d="${SHAPE}"/></clipPath>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="14"/><feOffset dy="12"/>
      <feComponentTransfer><feFuncA type="linear" slope=".32"/></feComponentTransfer></filter>
    <filter id="s2" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="2"/><feOffset dy="2"/>
      <feComponentTransfer><feFuncA type="linear" slope=".18"/></feComponentTransfer></filter>
    <linearGradient id="hl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".35" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient>
  </defs>
  <path d="${SHAPE}" filter="url(#s)"/>
  <path d="${SHAPE}" filter="url(#s2)"/>
  <g clip-path="url(#c)">
    <image href="${art}" x="100" y="100" width="824" height="824"/>
    <path d="${SHAPE}" fill="url(#hl)"/>
  </g>
  <path d="${SHAPE}" fill="none" stroke="url(#rim)" stroke-width="3" clip-path="url(#c)"/>
</svg></body></html>`;
const flat = `<!doctype html><html><head><style>html,body{margin:0}</style></head><body><img src="${art}" width="1024" height="1024" style="display:block"></body></html>`;

const browser = await pw.chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
await page.setContent(mac); await page.waitForTimeout(300);
await page.screenshot({ path: path.join(tmp, 'mac.png'), omitBackground: true });
await page.setContent(flat); await page.waitForTimeout(300);
await page.screenshot({ path: path.join(tmp, 'flat.png') });
await browser.close();

execFileSync('python3', ['-I', '-c', `
import sys
from PIL import Image
d, tmp = sys.argv[1], sys.argv[2]
m = Image.open(tmp + '/mac.png').convert('RGBA')
f = Image.open(tmp + '/flat.png').convert('RGB')
f.save(d + '/ios-source.png', optimize=True)
f.save(d + '/android-source.png', optimize=True)
for name, s in [('32x32', 32), ('64x64', 64), ('128x128', 128), ('128x128@2x', 256), ('icon', 512)]:
    m.resize((s, s), Image.LANCZOS).save(d + '/' + name + '.png', optimize=True)
m.save(d + '/icon.icns')
m.save(d + '/icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (256, 256)])
`, DIR, tmp]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('wrote desktop/src-tauri/icons: icon.icns, icon.ico, icon.png, 32x32 to 128x128@2x, ios-source.png, android-source.png');
