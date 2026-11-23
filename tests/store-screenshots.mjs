// App Store screenshots for iPhone, iPad and Mac, in the style of Cowdrey One: a caption in Fraunces over the app's
// colour (its icon's crimson, as on its Cowdrey One card), and the real app, in dark mode, inside a drawn device.
// The app is driven here with made-up documents; nothing is mocked up by hand.
//   iPhone 6.9" 1320 x 2868, iPad 13" 2064 x 2752, Mac 2880 x 1800 -> docs/app-store/{iphone,ipad,mac}-0N-*.png
// Run: (cd desktop && npm ci) && npm install --no-save playwright@1.56.1 && python3 build.py && node tests/store-screenshots.mjs [iphone|ipad|mac]
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
import { open, close, root } from './harness.mjs';
const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb } = require('../desktop/node_modules/pdf-lib');
let pw; try { pw = require('playwright'); } catch { pw = require(path.join(process.cwd(), 'node_modules/playwright')); }
const OUT = path.join(root, 'docs/app-store');
const font = (f) => 'data:font/woff2;base64,' + fs.readFileSync(path.join(root, f)).toString('base64');
const FRAUNCES = font('tests/fixtures/fonts/fraunces.woff2'), SANS = font('fonts/instrument-sans-latin-wght-normal.woff2');

const SHOTS = [
  ['01-edit-text', 'Edit any PDF', 'Tap a line and type. It keeps its own font.'],
  ['02-comments', 'Mark up and comment', 'Highlights, notes, shapes and callouts.'],
  ['03-organize-pages', 'Put pages in order', 'See every page at once. Move, rotate, delete.'],
  ['04-fill-and-sign', 'Fill in and sign forms', 'Type in the fields, then add your signature.'],
  ['05-redact', 'Redact for real', 'Private details are taken out, not just covered.'],
];
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
// Each device: the canvas (points) and its scale, the screen (points), the system bars the app sits between, and
// how the device is drawn. The app is captured at the screen's full size and scale, then placed in the frame.
const DEVICES = {
  iphone: { canvas: [440, 956], scale: 3, screen: [440, 956], top: 62, bottom: 34, ua: IPHONE_UA, touch: true,
    radius: 62, bezel: 7, rim: 3.5, title: 46, sub: 18.5, capTop: 64, gap: 34 },
  ipad: { canvas: [1032, 1376], scale: 2, screen: [1032, 1376], top: 32, bottom: 20, ua: IPAD_UA, touch: true,
    radius: 30, bezel: 20, rim: 3.5, title: 68, sub: 27, capTop: 84, gap: 50 },
  mac: { canvas: [1440, 900], scale: 2, screen: [1160, 652], top: 28, bottom: 0, title: 52, sub: 21, capTop: 50, gap: 30 },
};

// A fictional ferry company's yearly review: twelve pages, with figures, charts and tables. Letter size, or for the
// iPhone a narrow page (like a report made for phones), so that it reads at the size a phone shows it.
async function review(narrow = false) {
  const pdf = await PDFDocument.create();
  const f = await pdf.embedFont(StandardFonts.Helvetica), b = await pdf.embedFont(StandardFonts.HelveticaBold);
  const teal = rgb(.09, .42, .45), navy = rgb(.1, .17, .33), grey = rgb(.4, .4, .42), ink = rgb(.12, .12, .14), sand = rgb(.95, .93, .89), amber = rgb(.91, .62, .2);
  const W = narrow ? 430 : 612, H = narrow ? 640 : 792, M = narrow ? 30 : 64, CW = W - 2 * M, X = CW / 484;
  const head = (p, n) => {
    p.drawRectangle({ x: 0, y: H - 12, width: W, height: 12, color: teal });
    p.drawText('Harbour Line Ferries', { x: M, y: H - 48, size: 9, font: b, color: teal });
    const t = `Service review 2026  ·  ${n}`; p.drawText(t, { x: W - M - f.widthOfTextAtSize(t, 9), y: H - 48, size: 9, font: f, color: grey });
    p.drawLine({ start: { x: M, y: 50 }, end: { x: W - M, y: 50 }, thickness: .5, color: rgb(.85, .85, .85) });
    p.drawText(String(n), { x: W / 2 - 3, y: 34, size: 9, font: f, color: grey });
  };
  const wrap = (t, size, fo) => { const out = []; let cur = ''; for (const w of t.split(' ')) { const n = cur ? cur + ' ' + w : w; if (cur && fo.widthOfTextAtSize(n, size) > CW) { out.push(cur); cur = (t.startsWith('•') ? '    ' : '') + w; } else cur = n; } out.push(cur); return out; };
  const lines = (p, arr, y, o = {}) => { if (narrow && !o.keep) arr = arr.reduce((acc, t) => { if (!t.startsWith('•') && acc.length && !acc[acc.length - 1].startsWith('•')) acc[acc.length - 1] += ' ' + t; else acc.push(t); return acc; }, []); // one paragraph, wrapped again
    arr = arr.flatMap((t) => wrap(t, o.size || 11.5, o.font || f)); for (const t of arr) { p.drawText(t, { x: o.x || M, y, size: o.size || 11.5, font: o.font || f, color: o.color || ink }); y -= (o.size || 11.5) * 1.55; } return y; };
  const page = (n, title, intro) => { const p = pdf.addPage([W, H]); head(p, n); p.drawText(title, { x: M, y: H - 110, size: 22, font: b, color: navy }); return [p, intro ? lines(p, intro, H - 138, { color: grey }) : H - 138]; };
  const bars = (p, vals, y0, hi, labels) => vals.forEach((v, i) => { const x = M + 8 + i * (CW / vals.length); p.drawRectangle({ x, y: y0, width: CW / vals.length - 12 * X, height: v * (narrow ? .8 : 1), color: hi.includes(i) ? amber : teal }); if (labels) p.drawText(labels[i], { x: x + 4, y: y0 - 14, size: 8, font: f, color: grey }); });
  const table = (p, rows, y) => { rows.forEach((r, i) => { if (i === 0) p.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 18, color: navy }); else if (i % 2 === 0) p.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 18, color: sand }); r.forEach((c, j) => p.drawText(c, { x: M + 6 + [0, 170, 270, 370][j] * X, y, size: narrow ? 8.5 : 9.5, font: i === 0 || j === 0 ? b : f, color: i === 0 ? rgb(1, 1, 1) : ink })); y -= 20; }); return y; };

  let p = pdf.addPage([W, H]); head(p, 1);
  p.drawText('2026 Service Review', { x: M, y: H - 110, size: narrow ? 24 : 26, font: b, color: navy });
  let y = lines(p, ['A year of steady growth on the harbour: more crossings, fewer delays and', 'two new stops on the north shore.'], H - 140, { color: grey, size: 13 });
  p.drawRectangle({ x: M, y: y - 80, width: W - 2 * M, height: 82, color: sand });
  [['1.84M', 'passengers'], ['96.2%', 'on time'], ['41,300', 'crossings']].forEach(([v, l], i) => {
    const x = M + 16 + i * CW / 3; p.drawText(v, { x, y: y - 40, size: narrow ? 20 : 24, font: b, color: teal }); p.drawText(l, { x, y: y - 60, size: 10.5, font: f, color: grey });
  });
  y -= 120;
  p.drawText('Highlights', { x: M, y, size: 15, font: b, color: navy }); y -= 26;
  y = lines(p, ['•  Ridership up 12 percent on 2025', '•  Average delay down to 2.1 minutes', '•  Kestrel, our first electric ferry', '•  Two new stops on the north shore'], y);
  y -= 16; p.drawText('Next year', { x: M, y, size: 15, font: b, color: navy }); y -= 26;
  lines(p, ['We plan a second electric vessel, contactless boarding at every stop and a', 'quieter timetable on Sunday evenings.'], y);
  [p, y] = page(2, 'Passengers by month', ['Thousands of passengers per month. Summer weekends remain the busiest', 'time on the water.']);
  bars(p, [98, 104, 121, 138, 160, 182, 205, 210, 176, 150, 122, 134], narrow ? 300 : 420, [6, 7], 'JFMAMJJASOND'.split(''));
  lines(p, ['July and August together carried almost a quarter of the year’s passengers.'], narrow ? 250 : 370);
  [p, y] = page(3, 'Routes at a glance');
  y = table(p, [['Route', 'Crossings', 'On time', 'Change'], ['Quay to Northpoint', '14,820', '97.1%', '+8%'], ['Quay to Ferry Hill', '9,410', '95.8%', '+5%'], ['Northpoint to Gull Bay', '6,250', '96.4%', '+12%'], ['Quay to Castle Steps', '5,960', '94.9%', '+4%'], ['Gull Bay to Lantern Pier', '4,860', '98.0%', 'new']], H - 150);
  lines(p, ['Lantern Pier opened in September and is already busier than forecast.'], y - 20);
  [p, y] = page(4, 'Contact and staff');
  y = H - 150; for (const [who, tel, mail] of [['Operations: Jamie Rivera', '555-0142', 'jamie.rivera@example.com'], ['Fleet: Priya Nair', '555-0177', 'priya.nair@example.com'], ['Customer service', '555-0100', 'help@example.com']]) { p.drawText(who, { x: M, y, size: 12, font: b, color: navy }); y = lines(p, [`Phone ${tel}`, `Email ${mail}`], y - 19, { keep: true }) - 10; }
  [p, y] = page(5, 'Our fleet');
  for (const [n, d] of [['Kestrel', 'Electric, 240 seats. Charges at the Quay in eight minutes.'], ['Osprey', 'Hybrid, 360 seats. Refitted with new seating in March.'], ['Tern and Plover', 'Diesel, 180 seats each. To be replaced by electric vessels by 2029.'], ['Little Auk', 'Water taxi, 12 seats. Runs on request after 10 pm.']]) { p.drawText(n, { x: M, y, size: 12, font: b, color: teal }); y = lines(p, [d], y - 18) - 8; }
  [p, y] = page(6, 'Customers and crew', ['We asked 2,400 passengers about their journeys.']);
  [['Cleanliness', 88], ['Value for money', 74], ['Information at stops', 69], ['Crew friendliness', 93]].forEach(([l, v], i) => { const yy = y - 10 - i * 30; p.drawText(l, { x: M, y: yy, size: 10, font: f, color: ink }); p.drawRectangle({ x: M + 150 * X, y: yy - 2, width: v * 2.8 * X, height: 12, color: teal }); p.drawText(v + '%', { x: M + (160 + v * 2.8) * X, y: yy, size: 9, font: b, color: ink }); });
  [p, y] = page(7, 'Money', ['Fares covered 79 percent of running costs, up from 73 percent.']);
  p.drawRectangle({ x: M, y: y - 90, width: W - 2 * M, height: 92, color: sand });
  [['Fares', '£6.42M'], ['Running costs', '£8.23M'], ['Fleet investment', '£3.10M']].forEach(([l, v], i) => { p.drawText(l, { x: M + 16, y: y - 24 - i * 26, size: 10.5, font: f, color: ink }); p.drawText(v, { x: W - M - 70, y: y - 24 - i * 26, size: 10.5, font: b, color: ink }); });
  [p, y] = page(8, 'Timetable highlights');
  table(p, [['Route', 'Every', 'First', 'Last'], ['Quay to Northpoint', '15 min', '06:10', '23:40'], ['Quay to Ferry Hill', '20 min', '06:30', '22:50'], ['Northpoint to Gull Bay', '30 min', '07:00', '21:30'], ['Quay to Castle Steps', '30 min', '07:15', '20:45']], H - 150);
  [p, y] = page(9, 'Carbon per crossing', ['Kilograms of CO2 per crossing, 2021 to 2026.']);
  bars(p, [180, 172, 160, 150, 96, 60], narrow ? 280 : 330, [5], ['2021', '2022', '2023', '2024', '2025', '2026']);
  [p, y] = page(10, 'Step-free travel', ['Every stop now has a step-free route from the street to the boat.', 'Ramps at Castle Steps and Ferry Hill were rebuilt in the spring.']);
  [p, y] = page(11, 'Safety', ['Reported incidents per 100,000 passengers.']);
  bars(p, [120, 104, 108, 80, 62, 50], narrow ? 280 : 330, [5], ['2021', '2022', '2023', '2024', '2025', '2026']);
  [p, y] = page(12, 'Thank you', ['To our crews, our passengers and our partners on the harbour: thank you', 'for a record year.']);
  pdf.setTitle('Service review 2026');
  return pdf.save();
}

// The pretend native app: the iPhone and iPad app, or the Mac App Store build. Its native side only answers what the
// page asks at start.
const native = (mac) => {
  window.__TAURI__ = { core: { invoke: async (c) => (c === 'take_opened_files' ? [] : null) }, dialog: {}, event: { listen: async () => {} }, opener: { openUrl: async () => {} } };
  if (mac) window.__COWDREY_APP_STORE__ = true;
};

async function app(kind, bytes, name) {
  const d = DEVICES[kind];
  const [w, h] = [d.screen[0], d.screen[1] - (kind === 'mac' ? d.top : d.top + d.bottom)];
  const p = await open({ width: w, height: h, scale: d.scale, scheme: 'dark', touch: !!d.touch, ua: d.ua, init: [native, kind === 'mac'] });
  await p.evaluate(() => window.__cowdreyPdf.setAuthor && window.__cowdreyPdf.setAuthor('Alex Morgan'));
  if (bytes) {
    await p.evaluate(async ([b, n]) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); await window.__cowdreyPdf.openBytes(u, n); }, [Buffer.from(bytes).toString('base64'), name]);
    await p.waitForFunction(() => document.querySelector('.page canvas.pdf') && document.querySelector('.textLayer span'), null, { timeout: 15000 });
    await p.waitForTimeout(700);
  }
  p.kind = kind;
  return p;
}
const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
const tab = async (p, name) => { const t = p.locator('.ribbon-tabs button', { hasText: name }).first(); if (await t.count()) await t.click(); await p.waitForTimeout(300); };
async function select(p, text) {
  const s = p.locator('.page[data-n="0"] .textLayer span', { hasText: text }).first();
  await s.scrollIntoViewIfNeeded();
  await p.evaluate((t) => { const el = [...document.querySelectorAll('.page[data-n="0"] .textLayer span')].find((x) => x.textContent.includes(t)); const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }, text);
}
// The app's colours at the top and bottom edges, for the status bar and the home indicator area.
const edges = (p) => p.evaluate(() => {
  const bg = (el) => { while (el) { const c = getComputedStyle(el).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; el = el.parentElement; } return getComputedStyle(document.body).backgroundColor; };
  return [bg(document.elementFromPoint(innerWidth / 2, 2)), bg(document.elementFromPoint(innerWidth / 2, innerHeight - 2))];
});

// The status bar, as iOS and iPadOS draw it, in white for a dark app.
const glyphs = `
  <svg class="sig" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx=".8"/><rect x="5" y="5.5" width="3" height="6.5" rx=".8"/><rect x="10" y="3" width="3" height="9" rx=".8"/><rect x="15" y="0" width="3" height="12" rx=".8"/></svg>
  <svg class="wifi" viewBox="0 0 17 12"><path d="M8.5 2.3c2.4 0 4.6.9 6.3 2.5l1.2-1.2A10.6 10.6 0 0 0 8.5.6 10.6 10.6 0 0 0 1 3.6l1.2 1.2a9 9 0 0 1 6.3-2.5zm0 3.4c1.5 0 2.9.6 3.9 1.5l1.2-1.2a7.3 7.3 0 0 0-10.2 0l1.2 1.2c1-.9 2.4-1.5 3.9-1.5zm0 3.4c.6 0 1.2.2 1.6.6L8.5 11.3 6.9 9.7c.4-.4 1-.6 1.6-.6z"/></svg>
  <span class="bat"><i></i></span>`;
function statusBar(kind, color) {
  if (kind === 'iphone') return `<div class="sb" style="background:${color}"><span class="time">9:41</span><span class="right">${glyphs}</span></div>`;
  return `<div class="sb ipad" style="background:${color}"><span class="time">9:41&nbsp;&nbsp;Mon Jun 9</span><span class="right">${glyphs.replace(/<svg class="sig"[\s\S]*?<\/svg>/, '')}<span class="pct">100%</span></span></div>`;
}

function compose(kind, img, [topColor, bottomColor], title, sub) {
  const d = DEVICES[kind], [CW, CH] = d.canvas, [SW, SH] = d.screen;
  const capH = d.capTop + d.title * 1.1 + 14 + d.sub * 1.4;
  let device;
  if (kind === 'mac') {
    const k = 1, x = (CW - SW) / 2, y = capH + d.gap;
    device = `<div class="win" style="left:${x}px;top:${y}px;width:${SW}px;height:${SH}px">
      <div class="tb"><span class="tl"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></span><span class="tt">Cowdrey.PDF</span></div>
      <img src="${img}" style="width:${SW}px;height:${SH - d.top}px;display:block"></div>`;
    void k;
  } else {
    const outerW = SW + 2 * (d.bezel + d.rim), outerH = SH + 2 * (d.bezel + d.rim);
    const avail = CH - capH - d.gap - (kind === 'iphone' ? 30 : 44);
    const k = Math.min(avail / outerH, (CW * (kind === 'iphone' ? 0.86 : 0.84)) / outerW);
    const x = (CW - outerW * k) / 2, y = capH + d.gap;
    const island = kind === 'iphone' ? `<div class="island"></div>` : `<div class="cam"></div>`;
    const buttons = kind === 'iphone'
      ? `<i class="btn" style="left:-3px;top:${118}px;height:28px"></i><i class="btn" style="left:-3px;top:${172}px;height:56px"></i><i class="btn" style="left:-3px;top:${240}px;height:56px"></i><i class="btn r" style="right:-3px;top:${200}px;height:88px"></i><i class="btn r" style="right:-3px;top:${560}px;height:60px"></i>`
      : `<i class="btn top" style="top:-3px;right:${70}px;width:56px"></i><i class="btn r" style="right:-3px;top:${110}px;height:52px"></i><i class="btn r" style="right:-3px;top:${172}px;height:52px"></i>`;
    device = `<div class="dev" style="left:${x}px;top:${y}px;width:${outerW}px;height:${outerH}px;transform:scale(${k});border-radius:${d.radius + d.bezel + d.rim}px;padding:${d.rim}px">
      ${buttons}
      <div class="bezel" style="border-radius:${d.radius + d.bezel}px;padding:${d.bezel}px">
        <div class="screen" style="width:${SW}px;height:${SH}px;border-radius:${d.radius}px;background:${bottomColor}">
          ${statusBar(kind, topColor)}
          <img src="${img}" style="width:${SW}px;height:${SH - d.top - d.bottom}px;display:block">
          <div class="home" style="height:${d.bottom}px;background:${bottomColor}"><i style="width:${kind === 'iphone' ? 146 : 320}px"></i></div>
          ${island}
        </div>
      </div></div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Fraunces;src:url(${FRAUNCES}) format('woff2');font-weight:100 900}
@font-face{font-family:IS;src:url(${SANS}) format('woff2');font-weight:400 700}
html,body{margin:0;width:${CW}px;height:${CH}px;overflow:hidden}
body{position:relative;background:#5E0A28;font-family:IS,sans-serif;-webkit-font-smoothing:antialiased}
.sky{position:absolute;inset:0;background:radial-gradient(120% 70% at 15% 0%,rgba(255,255,255,.16),rgba(255,255,255,0) 60%),linear-gradient(180deg,#B0234F 0%,#8A1640 45%,#5E0A28 100%)}
.glow{position:absolute;left:50%;top:${capH + d.gap + 40}px;width:${CW * 1.1}px;height:${CH * .7}px;transform:translateX(-50%);background:radial-gradient(closest-side,rgba(0,0,0,.28),rgba(0,0,0,0))}
.cap{position:absolute;left:0;right:0;top:${d.capTop}px;text-align:center;color:#fff;padding:0 ${CW * .06}px}
h1{margin:0;font-family:Fraunces,serif;font-weight:600;font-size:${d.title}px;line-height:1.1;letter-spacing:-.01em;font-variation-settings:'opsz' 144}
p{margin:14px 0 0;font-size:${d.sub}px;line-height:1.4;color:rgba(255,255,255,.82);font-weight:500}
.dev{position:absolute;box-sizing:border-box;transform-origin:0 0;background:linear-gradient(145deg,#6d6a6e,#2c2b2e 35%,#4a484c 60%,#232225);box-shadow:0 2px 0 rgba(255,255,255,.12) inset,0 60px 120px rgba(20,0,8,.55),0 18px 40px rgba(20,0,8,.35)}
.bezel{background:#050505;box-sizing:border-box;height:100%;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.screen{position:relative;overflow:hidden}
.btn{position:absolute;width:4px;border-radius:2px;background:linear-gradient(90deg,#3a383c,#6d6a6e)}
.btn.top{height:4px;width:auto}
.island{position:absolute;left:50%;top:11px;width:126px;height:37px;margin-left:-63px;border-radius:19px;background:#000}
.cam{position:absolute;left:50%;top:-${d.bezel / 2 + 4}px;width:8px;height:8px;margin-left:-4px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#2a3550,#07080c 70%)}
.sb{position:relative;height:${d.top}px;display:flex;align-items:center;justify-content:space-between;color:#fff;font:600 17px -apple-system,IS,sans-serif;padding:${kind === 'iphone' ? '14px 34px 0 52px' : '2px 22px 0 22px'};box-sizing:border-box}
.sb.ipad{font-size:15px}
.sb .right{display:flex;align-items:center;gap:6px}
.sb svg{fill:#fff;height:12px}.sb .sig{width:18px}.sb .wifi{width:17px}
.bat{width:25px;height:12px;border:1.5px solid rgba(255,255,255,.45);border-radius:4px;box-sizing:border-box;padding:1.5px;position:relative}
.bat::after{content:'';position:absolute;right:-4px;top:3.5px;width:2px;height:4px;border-radius:0 1px 1px 0;background:rgba(255,255,255,.45)}
.bat i{display:block;height:100%;border-radius:1.5px;background:#fff}
.pct{font-size:14px;margin-left:2px}
.home{position:relative;display:flex;align-items:flex-end;justify-content:center}
.home i{display:block;height:5px;border-radius:3px;background:rgba(255,255,255,.75);margin-bottom:8px}
.win{position:absolute;border-radius:12px;overflow:hidden;background:#1e1e1e;box-shadow:0 0 0 1px rgba(255,255,255,.14),0 0 0 2px rgba(0,0,0,.5),0 50px 110px rgba(20,0,8,.6),0 16px 36px rgba(20,0,8,.35)}
.tb{height:${d.top}px;display:flex;align-items:center;position:relative;background:${topColor};border-bottom:1px solid rgba(255,255,255,.06)}
.tl{display:flex;gap:8px;padding-left:14px}.tl i{width:12px;height:12px;border-radius:50%;display:block}
.tt{position:absolute;left:0;right:0;text-align:center;color:rgba(255,255,255,.85);font:600 13px -apple-system,IS,sans-serif;pointer-events:none}
</style></head><body><div class="sky"></div><div class="glow"></div>
<div class="cap"><h1>${title}</h1><p>${sub}</p></div>${device}</body></html>`;
}

let composer;
async function shot(p, file, title, sub) {
  await p.mouse.move(2, 2);
  // Let the app's passing hints and messages go first.
  await p.waitForFunction(() => ![...document.querySelectorAll('.toast, [role=status]')].some((t) => t.offsetParent && t.textContent.trim()), null, { timeout: 12000 }).catch(() => {});
  await p.evaluate(() => getSelection().removeAllRanges());
  await p.waitForTimeout(500);
  const raw = await p.screenshot();
  const colors = await edges(p);
  await p.ctx.close();
  const d = DEVICES[p.kind];
  composer ||= await pw.chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
  const c = await composer.newPage({ viewport: { width: d.canvas[0], height: d.canvas[1] }, deviceScaleFactor: d.scale });
  await c.setContent(compose(p.kind, 'data:image/png;base64,' + raw.toString('base64'), colors, title, sub));
  await c.evaluate(() => document.fonts.ready);
  // One line each: a caption that is too long for the width gets smaller, never wraps.
  await c.evaluate(() => { for (const el of document.querySelectorAll('.cap h1, .cap p')) { let s = parseFloat(getComputedStyle(el).fontSize); el.style.whiteSpace = 'nowrap'; while (el.scrollWidth > el.clientWidth && s > 8) el.style.fontSize = (s -= .5) + 'px'; } });
  await c.waitForTimeout(300);
  const out = path.join(OUT, `${p.kind}-${file}.png`);
  await c.screenshot({ path: out }); await c.close();
  console.log('wrote docs/app-store/' + path.basename(out));
}

const DOCS = { letter: await review(), narrow: await review(true) };
const kinds = process.argv.slice(2).filter((k) => DEVICES[k]); if (!kinds.length) kinds.push('iphone', 'ipad', 'mac');
const phone = (p) => p.kind === 'iphone';
const SCENES = {
  // 1. Edit the words in place, with the text formatting bar.
  '01-edit-text': async (k) => {
    const p = await app(k, k === 'iphone' ? DOCS.narrow : DOCS.letter, 'Service review 2026.pdf');
    await tab(p, 'Edit'); await run(p, 'txtEditLines'); await p.waitForTimeout(500);
    const line = p.locator('.page[data-n="0"] .textLayer span', { hasText: 'Ridership up 12' }).first();
    await line.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
    const b = await line.boundingBox(); await p.mouse.click(b.x + b.width * .42, b.y + b.height / 2); await p.waitForTimeout(500);
    await p.keyboard.press('End'); for (let i = 0; i < 18; i++) await p.keyboard.press('Backspace');
    await p.keyboard.type('14 percent on 2025'); await p.waitForTimeout(400);
    return p;
  },
  // 2. Mark up: two highlights, and the comments list beside the page where there is room.
  '02-comments': async (k) => {
    const p = await app(k, k === 'iphone' ? DOCS.narrow : DOCS.letter, 'Service review 2026.pdf');
    await tab(p, 'Comment');
    for (const t of ['Ridership up 12 percent', 'Kestrel, our first electric']) { await select(p, t); await p.evaluate(() => window.__cowdreyPdf.highlightSelection()); await p.waitForTimeout(200); }
    if (!phone(p)) { await run(p, 'cm_list'); await p.waitForTimeout(500); }
    await p.evaluate(() => document.querySelector('.pages') && document.querySelector('.pages').scrollTo(0, 0));
    return p;
  },
  // 3. Organize pages.
  '03-organize-pages': async (k) => {
    const p = await app(k, k === 'iphone' ? DOCS.narrow : DOCS.letter, 'Service review 2026.pdf');
    await tab(p, 'Pages'); await run(p, 'pg60_organize'); await p.waitForTimeout(1200);
    const t = p.locator('.org-grid .org-thumb, .organize .thumb, [data-org] .thumb').nth(2); if (await t.count()) { await t.click(); await p.waitForTimeout(300); }
    return p;
  },
  // 4. Fill in a form: the app's own sample PDF.
  '04-fill-and-sign': async (k) => {
    const p = await app(k, null);
    await run(p, 'sample');
    await p.waitForFunction(() => document.querySelector('.page canvas.pdf') && document.querySelector('.annotationLayer input'), null, { timeout: 15000 });
    await p.waitForTimeout(600);
    await tab(p, 'Forms');
    const field = p.locator('.annotationLayer input[type=text]').first(); await field.scrollIntoViewIfNeeded();
    // A finger on the iPhone and iPad, the mouse on the Mac.
    const press = (l) => (DEVICES[k].touch ? l.tap() : l.click());
    await press(field); await field.focus(); await p.keyboard.type('Alex Morgan');
    await press(p.locator('.annotationLayer input[type=checkbox]').first());
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    // On the Mac, show the start of the form's section, not a line cut in half.
    if (k === 'mac') await p.evaluate(() => { const h = [...document.querySelectorAll('.page[data-n="0"] .textLayer span')].find((s) => s.textContent.includes('Try it on this page')); h && h.scrollIntoView({ block: 'start' }); document.querySelector('#viewer').scrollBy(0, -24); });
    return p;
  },
  // 5. Redact: every email address and phone number, marked for redaction.
  '05-redact': async (k) => {
    const p = await app(k, k === 'iphone' ? DOCS.narrow : DOCS.letter, 'Service review 2026.pdf');
    await run(p, 'zoomFit');
    await tab(p, 'Protect'); await run(p, 'protRedSearch');
    await p.waitForSelector('#dialog[open] input[name=text]'); await p.fill('#dialog input[name=text]', '');
    await p.check('#dialog input[name=email]'); await p.check('#dialog input[name=phone]');
    await p.click('#dialog .dlg-foot button:has-text("Find")');
    await p.waitForSelector('#dialog[open] .dlg-foot button:has-text("Mark")'); await p.click('#dialog .dlg-foot button:has-text("Mark")'); await p.waitForTimeout(600);
    await p.evaluate(() => { const v = document.querySelector('.page[data-n="3"]'); v && v.scrollIntoView({ block: 'start' }); });
    // On a large screen, bring the names up, clear of the message at the bottom.
    if (!phone(p)) await p.evaluate(() => document.querySelector('#viewer').scrollBy(0, 70));
    await p.waitForTimeout(700);
    return p;
  },
};
for (const k of kinds) for (const [file, title, sub] of SHOTS) {
  if (process.env.ONLY && !file.startsWith(process.env.ONLY)) continue; // ONLY=04: one screenshot
  const p = await SCENES[file](k);
  if (p.errors.length) console.log(`${k}-${file}: page errors: ${p.errors.join(' | ')}`);
  await shot(p, file, title, sub);
}
if (composer) await composer.close();
await close();
