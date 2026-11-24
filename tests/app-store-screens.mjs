// App Store screenshots for iPhone 6.9" (1320 x 2868), iPad 13" (2064 x 2752) and Mac (2880 x 1800), all from the
// real app in dark mode, in one template: a deep raspberry background, a Fraunces headline, one line in the system
// font, and a plain device frame with the app inside.
//
// Run: python3 build.py && (cd desktop && npm ci) && npm install --no-save playwright@1.56.1 &&
//      node tests/app-store-screens.mjs [--only=iphone,ipad,mac] [--shots=1,2] [--raw=dir] [--docs=dir]
//   -> docs/app-store/{iphone,ipad,mac}-0N-<slug>.png (RGB, no alpha, as App Store Connect wants them)
//
// Every document is fictional and made here with pdf-lib (or drawn in the page, for the scan). The phone and tablet
// are the iPhone and iPad app (touch, their user agent, the safe areas of the real screens); the Mac is the Mac App
// Store build in a window with the macOS title bar.
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { try { pw = require(path.join(process.cwd(), 'node_modules/playwright')); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); } }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NM = path.join(root, 'desktop/node_modules');
const L = require(path.join(NM, 'pdf-lib'));
const { PDFDocument, StandardFonts, rgb } = L;
const OUT = path.join(root, 'docs/app-store');
const ARG = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const ONLY = ARG.only ? ARG.only.split(',') : ['iphone', 'ipad', 'mac'];
const SHOTS = ARG.shots ? ARG.shots.split(',').map(Number) : null;
const RAW = ARG.raw || null;

/* ---------------- the devices ---------------- */
// Screen sizes in points, and the safe areas of the real screens (iPhone 16 Pro Max and 13-inch iPad Pro).
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const DEVICES = {
  iphone: { w: 440, h: 956, scale: 3, touch: true, ua: IPHONE_UA, safe: { top: 62, bottom: 34 }, out: [1320, 2868] },
  ipad: { w: 1032, h: 1376, scale: 2, touch: true, ua: IPAD_UA, safe: { top: 24, bottom: 20 }, out: [2064, 2752] },
  // The Mac window: 1280 x 800 points with the 28-point macOS title bar drawn by the template above it.
  mac: { w: 1280, h: 772, scale: 2, touch: false, safe: { top: 0, bottom: 0 }, out: [2880, 1800], titlebar: 28 },
};

// The app's native side, as far as the page asks at start: nothing opened from Files or Finder.
const native = (appStore) => {
  window.__TAURI__ = {
    core: { invoke: async (c) => (c === 'take_opened_files' ? [] : null) },
    dialog: {}, event: { listen: async () => {} }, opener: { openUrl: async () => {} },
  };
  if (appStore) window.__COWDREY_APP_STORE__ = true;
};

let browser;
const launch = async () => (browser ||= await pw.chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }));
// The app's index.html with the device's safe areas put in (a browser has none: env() is 0 there).
function html(d) {
  let s = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const [side, v] of Object.entries({ top: d.safe.top, bottom: d.safe.bottom, left: 0, right: 0 })) s = s.split(`env(safe-area-inset-${side}, 0px)`).join(v + 'px');
  return s;
}
async function app(kind) {
  const d = DEVICES[kind];
  await launch();
  const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, colorScheme: 'dark', deviceScaleFactor: d.scale, hasTouch: d.touch, isMobile: kind === 'iphone', acceptDownloads: true, ...(d.ua ? { userAgent: d.ua } : {}) });
  const p = await ctx.newPage();
  p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
  await p.addInitScript(native, kind === 'mac');
  const body = html(d);
  await ctx.route('**/*', (r) => {
    const u = r.request().url();
    if (u === 'https://app.test/') return r.fulfill({ body, contentType: 'text/html' });
    const m = u.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.+)$/);
    if (m) {
      const f = path.join(NM, m[1], m[2]);
      if (fs.existsSync(f)) return r.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.wasm') ? 'application/wasm' : f.endsWith('.gz') ? 'application/gzip' : 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
    }
    return r.abort();
  });
  await p.goto('https://app.test/');
  await p.waitForFunction(() => window.__cowdreyPdf, null, { timeout: 15000 });
  await p.evaluate(() => window.__cowdreyPdf.setAuthor && window.__cowdreyPdf.setAuthor('Alex Morgan'));
  p.ctx = ctx; p.kind = kind;
  return p;
}
async function openDoc(p, bytes, name) {
  await p.evaluate(async ([b, n]) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); await window.__cowdreyPdf.openBytes(u, n); }, [Buffer.from(bytes).toString('base64'), name]);
  await p.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 15000 });
  await p.waitForTimeout(700);
}
const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
const tab = async (p, name) => { const t = p.locator('.ribbon-tabs button', { hasText: name }).first(); if (await t.count()) await t.click(); await p.waitForTimeout(300); };
const grab = async (p) => { await p.waitForTimeout(500); const b = await p.screenshot(); return b; };

/* ---------------- the documents (all fictional) ---------------- */
const fontkit = require(path.join(NM, '@pdf-lib/fontkit'));
const GF = (fam, file) => fs.readFileSync(path.join(NM, '@expo-google-fonts', fam, file));
const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const W = 612, H = 792;

// A ferry company's yearly review: a cover, highlights, a chart, a table, the fleet and a map, in its own colours.
async function review() {
  const pdf = await PDFDocument.create();
  const f = await pdf.embedFont(StandardFonts.Helvetica), b = await pdf.embedFont(StandardFonts.HelveticaBold);
  const teal = hex('#17707A'), tealL = hex('#A9D3D3'), navy = hex('#14284B'), grey = hex('#5F6670'), ink = hex('#1D2228'), sand = hex('#F4EFE6'), sea = hex('#DCEEF0'), coral = hex('#E2725B');
  const M = 64;
  const text = (p, t, x, y, size = 11.5, font = f, color = ink) => p.drawText(t, { x, y, size, font, color });
  const para = (p, arr, y, o = {}) => { for (const t of arr) { text(p, t, o.x || M, y, o.size || 11.5, o.font || f, o.color || ink); y -= (o.size || 11.5) * (o.lead || 1.5); } return y; };
  const head = (p, n, title) => {
    p.drawRectangle({ x: 0, y: H - 10, width: W, height: 10, color: teal });
    text(p, 'HARBOUR LINE FERRIES', M, H - 46, 8.5, b, teal);
    const t = `Service review 2026`; text(p, t, W - M - f.widthOfTextAtSize(t, 8.5), H - 46, 8.5, f, grey);
    if (title) text(p, title, M, H - 104, 24, b, navy);
    p.drawLine({ start: { x: M, y: 52 }, end: { x: W - M, y: 52 }, thickness: .5, color: hex('#D9DCE0') });
    text(p, String(n), W / 2 - 3, 34, 9, f, grey);
  };
  // A ferry on the water, drawn with shapes.
  const ferry = (p, x, y, s, hull = navy) => {
    const P = (d, color, o = {}) => p.drawSvgPath(d, { x, y, scale: s, color, borderWidth: 0, ...o });
    P('M 0 60 L 300 60 L 270 100 L 20 100 Z', hull);
    P('M 40 60 L 250 60 L 240 28 L 60 28 Z', hex('#FFFFFF'));
    P('M 80 28 L 220 28 L 210 2 L 96 2 Z', hex('#FFFFFF'));
    for (let i = 0; i < 7; i++) P(`M ${62 + i * 25} 38 h 16 v 12 h -16 Z`, teal);
    for (let i = 0; i < 4; i++) P(`M ${104 + i * 26} 9 h 16 v 11 h -16 Z`, teal);
    P('M 150 2 L 162 2 L 162 -22 L 150 -22 Z', coral);
  };
  const waves = (p, y0, depth, color, amp = 5, len = 46, x0 = 0, x1 = W) => {
    let d = `M ${x0} 0`; for (let x = x0; x < x1; x += len) d += ` q ${len / 4} ${-amp} ${len / 2} 0 t ${len / 2} 0`;
    d += ` L ${x1} ${depth} L ${x0} ${depth} Z`;
    p.drawSvgPath(d, { x: 0, y: y0, color, borderWidth: 0 });
  };

  // 1. Cover
  let p = pdf.addPage([W, H]);
  p.drawRectangle({ x: 0, y: H - 360, width: W, height: 360, color: sea });
  p.drawCircle({ x: 470, y: H - 120, size: 46, color: hex('#F6C66B') });
  ferry(p, 150, H - 176, .95);
  waves(p, H - 262, 98, tealL, 6, 52); waves(p, H - 300, 60, teal, 5, 40);
  text(p, 'HARBOUR LINE FERRIES', M, H - 400, 9, b, teal);
  text(p, '2026 Service Review', M, H - 440, 32, b, navy);
  para(p, ['A year of steady growth on the harbour: more crossings, fewer delays', 'and two new stops on the north shore.'], H - 472, { color: grey, size: 13 });
  p.drawRectangle({ x: M, y: 200, width: W - 2 * M, height: 86, color: sand });
  [['1.84M', 'passengers'], ['96.2%', 'on time'], ['41,300', 'crossings']].forEach(([v, l], i) => {
    const x = M + 24 + i * 164; text(p, v, x, 248, 24, b, teal); text(p, l, x, 228, 10.5, f, grey);
  });
  para(p, ['Prepared for the board, the city transport office and our passengers.', 'Published March 2027.'], 150, { color: grey, size: 10 });
  // 2. Highlights
  p = pdf.addPage([W, H]); head(p, 2, 'Highlights of the year');
  let y = para(p, ['Ridership grew for the third year running. Summer weekends were the', 'busiest on record, and the new timetable cut the wait between', 'sailings on the harbour loop to twelve minutes.'], H - 140, { color: grey, size: 12.5 });
  y -= 12;
  for (const [t, d] of [['Ridership up 12 percent on 2025', 'More than 1.8 million trips, led by commuters on the north shore.'], ['Average delay down to 2.1 minutes', 'New berths at Pier 3 and Kings Wharf cut the time at each stop.'], ['Kestrel, our first electric ferry', 'Kestrel carried one in five passengers from June to December.'], ['Two new stops on the north shore', 'Birch Point and Gull Harbour opened in April.']]) {
    p.drawCircle({ x: M + 6, y: y + 4, size: 4, color: teal });
    text(p, t, M + 20, y, 13, b, navy); y -= 18; text(p, d, M + 20, y, 11.5, f, grey); y -= 32;
  }
  y -= 4; text(p, 'Next year', M, y, 16, b, navy); y -= 26;
  y = para(p, ['We plan a second electric ferry, contactless boarding at every stop and a', 'quieter timetable on Sunday evenings. Fares stay the same for a fourth year.'], y);
  // 3. Chart
  p = pdf.addPage([W, H]); head(p, 3, 'Passengers by month');
  para(p, ['Thousands of passengers each month. August was the busiest month on', 'record, with 210,000 passengers.'], H - 140, { color: grey, size: 12.5 });
  const vals = [98, 104, 121, 138, 160, 182, 205, 210, 176, 150, 122, 134];
  for (let g = 0; g <= 4; g++) { const gy = 360 + g * 60; p.drawLine({ start: { x: M + 24, y: gy }, end: { x: W - M, y: gy }, thickness: .4, color: hex('#E3E6E9') }); text(p, String(g * 60), M, gy - 3, 8.5, f, grey); }
  vals.forEach((v, i) => { const x = M + 36 + i * 38.5; p.drawRectangle({ x, y: 360, width: 24, height: v, color: i === 7 ? teal : tealL }); text(p, 'JFMAMJJASOND'[i], x + 8, 344, 9, f, grey); });
  para(p, ['Kestrel carried one in five passengers from June, and the evening', 'sailings added in May were full most Fridays.'], 300);
  // 4. Routes
  p = pdf.addPage([W, H]); head(p, 4, 'Routes and stops');
  y = H - 150; const cols = [M, M + 170, M + 250, M + 350];
  ['Route', 'Stops', 'Crossings', 'On time'].forEach((t, i) => text(p, t, cols[i], y, 10.5, b, grey));
  y -= 12; p.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: .8, color: navy }); y -= 22;
  for (const r of [['Harbour loop', '6', '18,900', '97.1%'], ['North shore', '4', '12,600', '95.4%'], ['Island run', '3', '9,800', '95.8%'], ['Night service', '5', '2,400', '98.3%']]) {
    r.forEach((t, i) => text(p, t, cols[i], y, 12, i ? f : b, ink)); y -= 12; p.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: .4, color: hex('#E3E6E9') }); y -= 22;
  }
  p.drawRectangle({ x: M, y: 150, width: W - 2 * M, height: 300, color: sea });
  p.drawSvgPath('M 0 0 L 484 0 L 484 52 C 420 86 330 40 240 66 C 150 92 70 58 0 84 Z', { x: M, y: 450, color: sand, borderWidth: 0 });
  [[140, 380, 'Kings Wharf'], [260, 330, 'Pier 3'], [380, 400, 'Birch Point'], [470, 300, 'Gull Harbour']].forEach(([x, yy, t]) => { p.drawCircle({ x, y: yy, size: 6, color: coral }); text(p, t, x + 10, yy - 3, 9.5, b, navy); });
  p.drawSvgPath('M 140 -380 Q 200 -300 260 -330 T 380 -400 T 470 -300', { x: 0, y: 0, borderColor: teal, borderWidth: 2, borderDashArray: [5, 4] });
  // 5. Fleet
  p = pdf.addPage([W, H]); head(p, 5, 'Our fleet');
  p.drawRectangle({ x: M, y: H - 380, width: W - 2 * M, height: 230, color: sea });
  ferry(p, 150, H - 262, .9, teal); waves(p, H - 336, 44, tealL, 5, 44, M, W - M);
  para(p, ['Kestrel joined the fleet in June: 300 seats, no exhaust, and a full charge', 'in the eight minutes she spends at Kings Wharf.', '', 'Our six other ferries were refitted with quieter engines and new seats.', 'Two of them will be replaced by electric ferries by 2029.'], H - 420);
  // 6. Contacts
  p = pdf.addPage([W, H]); head(p, 6, 'Contacts');
  para(p, ['Operations: Jamie Rivera, 555-0142, jamie.rivera@example.com', 'Fleet: Priya Nair, 555-0177, priya.nair@example.com', 'Passenger services: 555-0100, hello@example.com'], H - 150, { lead: 1.9 });
  pdf.setTitle('Service review 2026'); pdf.setAuthor('Harbour Line Ferries');
  return pdf.save();
}

// A club's membership form, with real form fields.
async function form() {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const f = await pdf.embedFont(StandardFonts.Helvetica), b = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(GF('noto-serif', '700Bold/NotoSerif_700Bold.ttf'));
  const green = hex('#1F5E4B'), grey = hex('#5F6670'), ink = hex('#1D2228'), mint = hex('#E7F1EC');
  const M = 56, p = pdf.addPage([W, H]), fm = pdf.getForm();
  p.drawRectangle({ x: 0, y: H - 120, width: W, height: 120, color: green });
  // Two oars, crossed
  for (const [a, c] of [[0.6, hex('#E8D9B5')], [-0.6, hex('#E8D9B5')]]) p.drawSvgPath(`M 0 0 L ${a > 0 ? 70 : -70} 70`, { x: W - 110, y: H - 25, borderColor: c, borderWidth: 4 });
  p.drawEllipse({ x: W - 110 + 70 - 4, y: H - 95 + 4, xScale: 8, yScale: 14, color: hex('#E8D9B5'), rotate: L.degrees(45) });
  p.drawEllipse({ x: W - 110 - 70 + 4, y: H - 95 + 4, xScale: 8, yScale: 14, color: hex('#E8D9B5'), rotate: L.degrees(-45) });
  p.drawText('Riverside Rowing Club', { x: M, y: H - 62, size: 24, font: serif, color: hex('#FFFFFF') });
  p.drawText('Membership form, 2027 season', { x: M, y: H - 88, size: 12, font: f, color: hex('#CFE3DA') });
  let y = H - 160;
  const label = (t, x, yy) => p.drawText(t, { x, y: yy, size: 9.5, font: b, color: grey });
  const field = (name, t, x, yy, w, value) => {
    label(t.toUpperCase(), x, yy + 30);
    const tf = fm.createTextField(name); tf.addToPage(p, { x, y: yy, width: w, height: 24, borderColor: hex('#B9C2BE'), borderWidth: 1, backgroundColor: hex('#FFFFFF'), font: f });
    tf.setFontSize(12); if (value) tf.setText(value);
  };
  p.drawText('About you', { x: M, y, size: 15, font: b, color: green }); y -= 52;
  field('name', 'Full name', M, y, 300, 'Alex Morgan'); field('dob', 'Date of birth', M + 320, y, 180, '14 May 1991'); y -= 58;
  field('email', 'Email', M, y, 300, 'alex.morgan@example.com'); field('phone', 'Phone', M + 320, y, 180, '555-0163'); y -= 58;
  field('address', 'Address', M, y, 500, '18 Willow Lane, Riverside'); y -= 50;
  p.drawText('Membership', { x: M, y, size: 15, font: b, color: green }); y -= 30;
  const opts = [['adult', 'Adult rower', '$240 a year'], ['student', 'Student', '$120 a year'], ['social', 'Social member', '$60 a year']];
  opts.forEach(([n, t, price], i) => {
    const x = M + i * 170; const cb = fm.createCheckBox('m_' + n);
    cb.addToPage(p, { x, y: y - 4, width: 16, height: 16, borderColor: hex('#8B9590'), borderWidth: 1, backgroundColor: hex('#FFFFFF') });
    if (n === 'adult') cb.check();
    p.drawText(t, { x: x + 24, y, size: 12, font: b, color: ink }); p.drawText(price, { x: x + 24, y: y - 15, size: 10, font: f, color: grey });
  });
  y -= 50;
  p.drawRectangle({ x: M, y: y - 64, width: W - 2 * M, height: 82, color: mint });
  const cb2 = fm.createCheckBox('course'); cb2.addToPage(p, { x: M + 16, y: y - 6, width: 16, height: 16, borderColor: hex('#8B9590'), borderWidth: 1, backgroundColor: hex('#FFFFFF') }); cb2.check();
  p.drawText('Sign me up for the Learn to Row course (four Saturday mornings)', { x: M + 42, y: y - 2, size: 11.5, font: f, color: ink });
  const cb3 = fm.createCheckBox('volunteer'); cb3.addToPage(p, { x: M + 16, y: y - 40, width: 16, height: 16, borderColor: hex('#8B9590'), borderWidth: 1, backgroundColor: hex('#FFFFFF') });
  p.drawText('I can help at the spring regatta', { x: M + 42, y: y - 36, size: 11.5, font: f, color: ink });
  y -= 110;
  p.drawText('Declaration', { x: M, y, size: 15, font: b, color: green }); y -= 22;
  for (const t of ['I can swim 50 metres in light clothing, and I agree to follow the club\'s', 'safety rules on and off the water.']) { p.drawText(t, { x: M, y, size: 11.5, font: f, color: ink }); y -= 17; }
  y -= 56;
  p.drawLine({ start: { x: M, y }, end: { x: M + 300, y }, thickness: .8, color: hex('#8B9590') });
  label('SIGNATURE', M, y - 16);
  field('date', 'Date', M + 320, y, 180, '2 March 2027');
  p.drawText('Riverside Rowing Club, Boathouse Road. Hand this form in at the boathouse or bring it to your first session.', { x: M, y: 60, size: 8.5, font: f, color: grey });
  pdf.setTitle('Membership 2027');
  return { bytes: await pdf.save(), sigLine: [M + 20, y + 4] };
}

// A reference letter full of personal details, to redact.
async function letter() {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const f = await pdf.embedFont(GF('noto-serif', '400Regular/NotoSerif_400Regular.ttf'));
  const b = await pdf.embedFont(GF('noto-serif', '700Bold/NotoSerif_700Bold.ttf'));
  const s = await pdf.embedFont(StandardFonts.Helvetica), sb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const plum = hex('#3B2F5C'), grey = hex('#62666E'), ink = hex('#1D2228');
  const M = 72, p = pdf.addPage([W, H]);
  p.drawRectangle({ x: M, y: H - 92, width: 30, height: 30, color: plum });
  p.drawText('O', { x: M + 8, y: H - 84, size: 18, font: sb, color: hex('#FFFFFF') });
  p.drawText('Oakfield Lettings', { x: M + 42, y: H - 76, size: 15, font: sb, color: plum });
  p.drawText('22 Market Street, Oakfield  ·  555-0118  ·  lettings@example.com', { x: M + 42, y: H - 90, size: 8.5, font: s, color: grey });
  let y = H - 150;
  const P = (arr, o = {}) => { for (const t of arr) { p.drawText(t, { x: M, y, size: o.size || 11, font: o.font || f, color: o.color || ink }); y -= (o.size || 11) * 1.65; } y -= 8; };
  P(['4 February 2027'], { color: grey });
  P(['Tenant reference: Jordan Ellis'], { font: b, size: 15, color: plum });
  P(['To whom it may concern,']);
  P(['Jordan Ellis rented 7 Orchard Court, Oakfield, from us between June 2023', 'and January 2027. The rent of $1,450 a month was always paid on time,', 'and the flat was left clean and in good order.']);
  P(['Jordan was a considerate neighbour, and we would rent to Jordan again.', 'We have no hesitation in recommending Jordan as a tenant.']);
  P(['Contact details we hold:'], { font: b });
  for (const [k, v] of [['Phone', '555-0194'], ['Email', 'jordan.ellis@example.com'], ['Date of birth', '23 September 1994'], ['Bank account', '40-12-77  31926458'], ['Previous address', '41 Kestrel Road, Millbrook']]) {
    p.drawText(k, { x: M, y, size: 11, font: s, color: grey }); p.drawText(v, { x: M + 130, y, size: 11, font: f, color: ink }); y -= 22;
  }
  y -= 14;
  P(['If you would like to talk about this reference, please call me on 555-0118.']);
  P(['Yours faithfully,']); y -= 20;
  P(['Sam Okafor', 'Lettings manager, Oakfield Lettings'], { color: ink });
  pdf.setTitle('Tenant reference');
  return pdf.save();
}

/* ---------------- the stories, best first ---------------- */
const goPage = async (p, n, block = 'start') => { await p.evaluate(([n, block]) => { const v = document.querySelector(`.page[data-n="${n}"]`); v && v.scrollIntoView({ block }); }, [n, block]); await p.waitForTimeout(500); };
const lineAt = (p, n, text) => p.locator(`.page[data-n="${n}"] .textLayer span`, { hasText: text }).first();
async function tapLine(p, n, text, where = 'end') {
  const b = await (await lineAt(p, n, text)).boundingBox();
  const x = where === 'end' ? b.x + b.width - 2 : b.x + 2, y = b.y + b.height / 2;
  if (p.kind === 'mac') await p.mouse.click(x, y); else await p.touchscreen.tap(x, y);
  await p.waitForTimeout(400);
}
async function selectText(p, n, text) {
  const b = await (await lineAt(p, n, text)).boundingBox();
  await p.mouse.move(b.x + 1, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(200);
}
// A one-page document: on the iPad the page gets the whole width (the page list would show a single thumbnail), and
// the Mac fits the page to the width, so the words are as large as they are when you work.
async function onePage(p) {
  if (p.kind === 'ipad') { await run(p, 'sidebar'); await p.waitForTimeout(500); }
  if (p.kind !== 'iphone') { await zoom(p, 'zoomFit'); await p.waitForTimeout(600); }
}
// Scroll so that a point a fraction of the way down page n is at the top of the view.
const pageAt = async (p, n, f) => { await p.evaluate(([n, f]) => { const v = document.querySelector('#viewer'), el = document.querySelector(`.page[data-n="${n}"]`); v.scrollTop += el.getBoundingClientRect().top - v.getBoundingClientRect().top + el.offsetHeight * f; }, [n, f]); await p.waitForTimeout(500); };
const zoom = (p, z) => p.evaluate((z) => window.__cowdreyPdf.run(z), z);

const STORIES = [
  { slug: 'edit-text', title: 'Edit any PDF', sub: 'Tap a line and type. The words keep the PDF’s own font.', subMac: 'Click a line and type. The words keep the PDF’s own font.',
    async shoot(p, docs) {
      await openDoc(p, docs.review, 'Service review 2026.pdf');
      await tab(p, 'Edit'); await run(p, 'txtEditLines'); await p.waitForTimeout(400);
      if (p.kind === 'iphone') {
        // The cover's title: large enough to type into at this zoom, so the whole page stays in view.
        await tapLine(p, 0, '2026 Service Review');
        await p.keyboard.press('End'); for (let i = 0; i < 14; i++) await p.keyboard.press('Backspace');
        await p.keyboard.type('Year in Review', { delay: 20 });
      } else {
        await goPage(p, 1);
        await tapLine(p, 1, 'Average delay down');
        await p.keyboard.press('End'); for (let i = 0; i < 11; i++) await p.keyboard.press('Backspace');
        await p.keyboard.type('1.8 minutes', { delay: 20 });
      }
      await p.waitForTimeout(400);
    } },
  { slug: 'scans-to-text', title: 'Scans become text', sub: 'Search, select and copy the words on scanned pages.',
    async shoot(p, docs) {
      await openDoc(p, docs.scan, 'Garden letter.pdf');
      await onePage(p);
      const r = await p.evaluate(() => window.__cowdreyPdf.ocrRunHeadless({ lang: 'eng' }));
      if (!r.words) throw new Error('OCR found no words: ' + JSON.stringify(r));
      await p.waitForTimeout(600);
      await run(p, 'find'); await p.fill('#findInput', 'plot'); await p.waitForTimeout(900);
      await p.evaluate(() => { document.querySelector('#viewer').scrollTop = 0; }); await p.waitForTimeout(400);
    } },
  { slug: 'fill-and-sign', title: 'Fill in and sign', sub: 'Type into any form, then sign it with your finger.', subMac: 'Type into any form, then add your signature.',
    async shoot(p, docs) {
      await openDoc(p, docs.form.bytes, 'Membership 2027.pdf');
      await onePage(p);
      await p.waitForSelector('.annotationLayer input');
      await run(p, 'sign'); await p.waitForSelector('#dialog[open] #sigPad');
      const pad = await (await p.$('#sigPad')).boundingBox();
      for (const stroke of SIGNATURE) {
        const pts = smooth(stroke);
        await p.mouse.move(pad.x + pts[0][0] * pad.width, pad.y + pts[0][1] * pad.height); await p.mouse.down();
        for (const [x, y] of pts.slice(1)) await p.mouse.move(pad.x + x * pad.width, pad.y + y * pad.height);
        await p.mouse.up();
      }
      await p.click('#dialog .dlg-foot .btn.primary'); await p.waitForTimeout(400);
      if (p.kind === 'mac') await pageAt(p, 0, .445); else await goPage(p, 0, 'end');
      const [sx, sy] = docs.form.sigLine;
      const [x, y] = await at(p, 0, sx + 120, sy + 22);
      await p.mouse.click(x, y); await p.waitForTimeout(500);
      await run(p, 'tool_select'); await p.keyboard.press('Escape');
      await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    } },
  { slug: 'comments', title: 'Mark it up', sub: 'Highlight, comment and reply, as real PDF comments.',
    async shoot(p, docs) {
      await openDoc(p, docs.review, 'Service review 2026.pdf');
      await tab(p, 'Comment'); await goPage(p, 1);
      await run(p, 'tool_highlight');
      for (const t of ['Ridership up 12 percent on 2025', 'Kestrel, our first electric ferry']) await selectText(p, 1, t);
      await p.evaluate(() => window.__cowdreyPdf.setAuthor('Priya Nair'));
      await run(p, 'tool_note'); { const [x, y] = await at(p, 1, 500, 590); await p.mouse.click(x, y); }
      await p.waitForSelector('.page-ask textarea'); await p.fill('.page-ask textarea', 'Can we add the Sunday figures here?'); await p.click('.page-ask .btn.primary'); await p.waitForTimeout(300);
      await p.evaluate(() => window.__cowdreyPdf.setAuthor('Alex Morgan'));
      await run(p, 'tool_select'); await p.keyboard.press('Escape');
      if (p.kind !== 'iphone') { await run(p, 'cm_list'); await p.waitForTimeout(600); }
      await goPage(p, 1);
      await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    } },
  { slug: 'redact', title: 'Redact for real', sub: 'Private details are taken out of the file, not just covered.',
    async shoot(p, docs) {
      await openDoc(p, docs.letter, 'Tenant reference.pdf');
      await onePage(p);
      await tab(p, 'Protect');
      for (const t of ['Jordan', 'Ellis', '7 Orchard Court', '555-0194', 'jordan.ellis@example.com', '23 September 1994', '31926458', '40-12-77', '41 Kestrel Road, Millbrook']) {
        await run(p, 'protRedSearch'); await p.waitForSelector('#dialog[open] input[name=text]'); await p.fill('#dialog input[name=text]', t);
        await p.click('#dialog .dlg-foot button:has-text("Find")');
        await p.waitForSelector('#dialog[open] .dlg-foot button:has-text("Mark")'); await p.click('#dialog .dlg-foot button:has-text("Mark")'); await p.waitForTimeout(250);
      }
      await run(p, 'protRedApply'); await p.waitForSelector('#dialog[open]'); await p.click('#dialog .dlg-foot button:has-text("Apply")'); await p.waitForTimeout(800);
      // the redacted contact details in the middle of the view
      if (p.kind === 'mac') await pageAt(p, 0, .19);
    } },
  { slug: 'organize-pages', title: 'Pages in order', sub: 'Move, turn, combine and split pages in one view.',
    async shoot(p, docs) {
      await openDoc(p, docs.review, 'Service review 2026.pdf');
      await tab(p, 'Pages'); await run(p, 'pg60_organize'); await p.waitForTimeout(1500);
      await p.evaluate(() => window.__cowdreyPdf.pg60.setSel([2])); await p.waitForTimeout(400);
    } },
];
// A handwritten "Alex Morgan", as strokes in the signature pad (fractions of its width and height).
const SIGNATURE = [
  [[.06, .80], [.11, .52], [.16, .22], [.19, .30], [.21, .62], [.24, .80]],
  [[.10, .58], [.17, .54], [.23, .52], [.27, .40], [.28, .22], [.29, .50], [.30, .66], [.33, .58], [.36, .54], [.34, .64], [.38, .66], [.41, .56], [.43, .64], [.46, .54], [.44, .66], [.48, .62]],
  [[.51, .78], [.54, .40], [.56, .24], [.58, .52], [.60, .70], [.63, .34], [.65, .24], [.67, .56], [.69, .70], [.72, .58], [.75, .54], [.74, .64], [.77, .62], [.79, .55], [.80, .64], [.83, .56], [.86, .60], [.85, .80], [.82, .92], [.80, .82], [.86, .60], [.89, .56], [.90, .64], [.93, .56], [.95, .62]],
  [[.12, .90], [.40, .86], [.70, .84], [.92, .82]],
];
// Catmull-Rom through the points, so the pen moves in curves.
function smooth(pts, n = 8) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    for (let k = 0; k < n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t; out.push([0, 1].map((j) => .5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3))); }
  }
  out.push(pts[pts.length - 1]); return out;
}
// A point on page n (PDF units) on the screen.
const at = (p, n, x, y) => p.evaluate(([n, x, y]) => { const v = window.__cowdreyPdf.views()[n]; const [vx, vy] = v.viewport.convertToViewportPoint(x, y); const r = v.el.getBoundingClientRect(); return [r.left + vx, r.top + vy]; }, [n, x, y]);

async function capture(kind, story, docs) {
  const p = await app(kind);
  await story.shoot(p, docs);
  await p.evaluate(() => document.querySelectorAll('.ribbon-body').forEach((r) => { if (!r.dataset.keepScroll) r.scrollLeft = 0; }));
  // the tab strip from its start, so "Home" is never cut off, with the chosen tab still in view
  await p.evaluate(() => document.querySelectorAll('.ribbon-tabs').forEach((t) => { const a = t.querySelector('[aria-selected="true"], .on, .active'); t.scrollLeft = 0; if (a && a.offsetLeft + a.offsetWidth > t.clientWidth) t.scrollLeft = a.offsetLeft + a.offsetWidth - t.clientWidth + 8; }));
  if (kind === 'mac') await p.mouse.move(DEVICES.mac.w - 6, DEVICES.mac.h - 6);
  // what happened is shown in a toast for a moment: wait for it to go, so it covers nothing
  await p.waitForFunction(() => !document.querySelector('#toast.show'), null, { timeout: 15000 }).catch(() => {});
  const png = await grab(p);
  if (p.errors.length) console.warn(kind, story.slug, p.errors);
  await p.ctx.close();
  return png;
}

/* ---------------- the template ---------------- */
// One look for every device: a deep raspberry ground (the icon's #C61F52 to #7C0B31, taken down to near black), the
// headline in Fraunces (SIL Open Font License, design/app-store/), one line in the system font, and a plain device.
const FRAUNCES = fs.readFileSync(path.join(root, 'design/app-store/fraunces.woff2')).toString('base64');
// Layout per device, in CSS pixels of a canvas at half the output size (drawn at 2x).
const LAYOUT = {
  iphone: { cw: 660, ch: 1434, head: 60, top: 92, subTop: 22, devW: 504, devTop: 316, bezel: 11, radius: 62, h1: 64, sub: 27, subW: 560 },
  ipad: { cw: 1032, ch: 1376, head: 68, top: 84, subTop: 22, devW: 790, devTop: 262, bezel: 20, radius: 26, h1: 76, sub: 32, subW: 960 },
  mac: { cw: 1440, ch: 900, head: 50, top: 62, subTop: 14, devW: 1000, devTop: 186, bezel: 14, radius: 14, h1: 58, sub: 26, subW: 1100 },
};
function composeHtml(kind, story, rawB64) {
  const d = DEVICES[kind], l = LAYOUT[kind];
  const sw = l.devW - 2 * l.bezel, k = sw / d.w; // screen width in canvas px, and points to canvas px
  const tb = d.titlebar ? d.titlebar * k : 0;
  const sh = (d.h * k) + tb, devH = sh + 2 * l.bezel;
  const sub = kind === 'mac' && story.subMac ? story.subMac : story.sub;
  const island = kind === 'iphone' ? `<div class="island" style="width:${125 * k}px;height:${37 * k}px;top:${11 * k}px;border-radius:${19 * k}px"></div>` : '';
  const camera = kind === 'ipad' ? `<div class="cam" style="top:${l.bezel / 2 - 3}px"></div>` : kind === 'mac' ? `<div class="cam" style="top:${l.bezel / 2 - 2.5}px;width:5px;height:5px"></div>` : '';
  const titlebar = tb ? `<div class="tb" style="height:${tb}px;font-size:${13 * k}px"><span class="lights">${['#FF5F57', '#FEBC2E', '#28C840'].map((c) => `<i style="background:${c};width:${12 * k}px;height:${12 * k}px;margin-right:${8 * k}px"></i>`).join('')}</span><span>Cowdrey.PDF</span></div>` : '';
  const base = kind === 'mac' ? `<div class="base" style="top:${l.devTop + devH}px;left:${(l.cw - l.devW * 1.16) / 2}px;width:${l.devW * 1.16}px"></div>` : '';
  const sr = kind === 'iphone' ? l.radius * k * (440 / 440) : kind === 'ipad' ? 18 * k : 6;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Fraunces; src: url(data:font/woff2;base64,${FRAUNCES}) format("woff2"); font-weight: 100 900; }
html, body { margin: 0; width: ${l.cw}px; height: ${l.ch}px; overflow: hidden; }
body { background: #12060B; position: relative; -webkit-font-smoothing: antialiased; }
.bg { position: absolute; inset: 0; background:
  radial-gradient(90% 55% at 50% ${kind === 'mac' ? 105 : 62}%, rgba(198, 31, 82, .42), rgba(198, 31, 82, 0) 70%),
  radial-gradient(120% 70% at 50% -10%, #5A1028 0%, rgba(90, 16, 40, 0) 70%),
  linear-gradient(180deg, #3A0B1D 0%, #1C0710 55%, #12060B 100%); }
h1 { position: absolute; left: 0; right: 0; top: ${l.top}px; margin: 0; text-align: center; color: #FFF7F4;
  font: 600 ${l.h1}px/1.04 Fraunces, Georgia, serif; font-variation-settings: "opsz" 144; letter-spacing: -.015em; }
p { position: absolute; left: ${(l.cw - l.subW) / 2}px; width: ${l.subW}px; top: ${l.top + l.h1 * 1.04 + l.subTop}px; margin: 0; text-align: center;
  color: rgba(255, 236, 241, .74); font: 400 ${l.sub}px/1.3 -apple-system, "SF Pro Display", Inter, system-ui, sans-serif; letter-spacing: -.005em; text-wrap: balance; }
.dev { position: absolute; left: ${(l.cw - l.devW) / 2}px; top: ${l.devTop}px; width: ${l.devW}px; height: ${devH}px; box-sizing: border-box;
  border-radius: ${kind === 'mac' ? `${l.radius}px ${l.radius}px 4px 4px` : (sr + l.bezel) + 'px'}; background: #050505;
  box-shadow: 0 0 0 ${kind === 'mac' ? 1.5 : 2}px #3C3A3D, 0 0 0 ${kind === 'mac' ? 2.5 : 3.5}px #1A1819, 0 30px 80px rgba(0, 0, 0, .55), 0 8px 24px rgba(0, 0, 0, .35); }
.screen { position: absolute; left: ${l.bezel}px; top: ${l.bezel}px; width: ${sw}px; height: ${sh}px; border-radius: ${sr}px; overflow: hidden; background: #000; }
.screen img { position: absolute; left: 0; top: ${tb}px; width: ${sw}px; height: ${d.h * k}px; }
.island { position: absolute; left: 50%; transform: translateX(-50%); background: #000; z-index: 2; }
.cam { position: absolute; left: 50%; transform: translateX(-50%); width: 6px; height: 6px; border-radius: 50%; background: #1E2228; box-shadow: inset 0 0 1px #3A4450; }
.tb { position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; justify-content: center; background: #2C2A2B; border-bottom: 1px solid #000;
  color: rgba(255, 255, 255, .78); font-family: -apple-system, "SF Pro Text", Inter, system-ui, sans-serif; font-weight: 600; }
.lights { position: absolute; left: ${13 * k}px; top: 50%; transform: translateY(-50%); display: flex; }
.lights i { display: block; border-radius: 50%; }
.base { position: absolute; height: 16px; border-radius: 2px 2px 14px 14px / 2px 2px 10px 10px; background: linear-gradient(#5A595C, #2E2D30 40%, #1C1B1D); box-shadow: 0 20px 40px rgba(0, 0, 0, .5); }
.base::before { content: ""; position: absolute; left: 50%; top: 0; width: 15%; height: 6px; transform: translateX(-50%); border-radius: 0 0 8px 8px; background: #19181A; }
</style></head><body><div class="bg"></div>
<h1>${story.title}</h1><p>${sub}</p>
<div class="dev">${camera}<div class="screen">${titlebar}<img src="data:image/png;base64,${rawB64}">${island}</div></div>${base}
</body></html>`;
}
// The composed picture, at the exact App Store size, as an RGB PNG (no alpha channel).
async function compose(kind, story, raw) {
  const l = LAYOUT[kind];
  const ctx = await browser.newContext({ viewport: { width: l.cw, height: l.ch }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const p = await ctx.newPage();
  await p.setContent(composeHtml(kind, story, raw.toString('base64')));
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(200);
  const png = await p.screenshot({ type: 'png' });
  await ctx.close();
  return rgbPng(png);
}
// Chromium's PNG is already opaque; it is written again as colour type 2 (RGB), so no alpha channel is left at all.
function rgbPng(buf) {
  const sig = buf.subarray(0, 8); let o = 8, ihdr, idat = [];
  while (o < buf.length) { const n = buf.readUInt32BE(o), t = buf.toString('latin1', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + n); if (t === 'IHDR') ihdr = d; if (t === 'IDAT') idat.push(d); o += 12 + n; }
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4), depth = ihdr[8], type = ihdr[9];
  if (type === 2 && depth === 8) return buf;
  if (depth !== 8 || type !== 6 || ihdr[12]) throw new Error('unexpected PNG ' + type + '/' + depth);
  const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = 4, stride = w * bpp, out = Buffer.alloc(h * (w * 3 + 1));
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const pr = (() => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })();
      cur[i] = (line[i] + [0, a, b, (a + b) >> 1, pr][f]) & 255;
    }
    const q = y * (w * 3 + 1); out[q] = 0;
    for (let x = 0; x < w; x++) { const al = cur[x * 4 + 3] / 255; for (let c = 0; c < 3; c++) out[q + 1 + x * 3 + c] = Math.round(cur[x * 4 + c] * al + 0x12 * (1 - al)); }
    [prev, cur] = [cur, prev];
  }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'latin1'), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const hd = Buffer.alloc(13); hd.writeUInt32BE(w, 0); hd.writeUInt32BE(h, 4); hd[8] = 8; hd[9] = 2;
  return Buffer.concat([sig, chunk('IHDR', hd), chunk('IDAT', zlib.deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// A scanned letter: typed, printed, signed and scanned at 200 dpi (drawn here in the browser, so the PDF has only a
// picture of the page and no text until it is recognized).
async function scan() {
  await launch();
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  const png = await p.evaluate(() => {
    const W = 1700, H = 2200, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#F6F3EC'; g.fillRect(0, 0, W, H);
    // paper grain and a little shading at the edges, as from a flatbed
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const img = g.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (rnd() - .5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    const v = g.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, H * .75); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(60,50,30,.10)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    g.save(); g.translate(W / 2, H / 2); g.rotate(-0.006); g.translate(-W / 2, -H / 2);
    const serif = '"Liberation Serif", "Times New Roman", Times, serif';
    g.fillStyle = '#2E5E3A'; g.font = `bold 64px ${serif}`; g.fillText('Northfield Community Garden', 170, 250);
    g.fillStyle = '#3C3C3C'; g.font = `34px ${serif}`; g.fillText('Allotment Office  ·  Mill Lane  ·  Northfield', 170, 305);
    g.fillRect(170, 340, 1360, 3);
    g.fillStyle = '#1E1E1E'; g.font = `40px ${serif}`;
    const lines = ['10 February 2027', '', 'Dear plot holder,', '', 'Thank you for another good year at the garden. The spring work day', 'is on Saturday 13 March, starting at 9 in the morning. We will clear', 'the paths, mend the fences and spread compost on the shared beds.', '', 'Plot fees for the new season are due by 31 March:', '', ['Full plot', '$48'], ['Half plot', '$26'], ['Raised bed', '$15'], '', 'Water will be turned on at the standpipes on 1 April. Please keep', 'hoses off the paths, and bring your own tools if you can.', '', 'Seed swap tables will be open in the potting shed all morning.', '', 'With best wishes,'];
    let y = 450; for (const t of lines) { if (Array.isArray(t)) { g.fillText(t[0], 250, y); g.fillText(t[1], 720, y); } else g.fillText(t, 170, y); y += 62; }
    // a signature in ink
    g.strokeStyle = '#1B2A6B'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath();
    g.moveTo(180, y + 40); g.bezierCurveTo(220, y - 30, 260, y + 70, 300, y + 10); g.bezierCurveTo(330, y - 20, 350, y + 60, 390, y + 20); g.bezierCurveTo(420, y - 10, 470, y + 50, 520, y + 15); g.bezierCurveTo(560, y - 5, 600, y + 30, 650, y + 25); g.stroke();
    g.fillStyle = '#1E1E1E'; g.font = `40px ${serif}`; g.fillText('Ruth Adeyemi, Garden Secretary', 170, y + 120);
    g.restore();
    // a rubber stamp
    g.save(); g.translate(1310, 1640); g.rotate(-0.21); g.strokeStyle = 'rgba(176, 38, 60, .72)'; g.fillStyle = 'rgba(176, 38, 60, .72)'; g.lineWidth = 7;
    g.strokeRect(-190, -70, 380, 140); g.font = `bold 50px ${serif}`; g.textAlign = 'center'; g.fillText('PAID', 0, 2); g.font = `bold 30px ${serif}`; g.fillText('12 FEB 2027', 0, 46); g.restore();
    return c.toDataURL('image/png').split(',')[1];
  });
  await ctx.close();
  const pdf = await PDFDocument.create();
  const im = await pdf.embedPng(Buffer.from(png, 'base64'));
  pdf.addPage([W, H]).drawImage(im, { x: 0, y: 0, width: W, height: H });
  pdf.setTitle('Garden letter (scan)');
  return pdf.save();
}

export { DEVICES, app, openDoc, run, tab, grab, launch, review, form, letter };
if (ARG.docs) {
  fs.writeFileSync(path.join(ARG.docs, 'review.pdf'), await review());
  fs.writeFileSync(path.join(ARG.docs, 'form.pdf'), (await form()).bytes);
  fs.writeFileSync(path.join(ARG.docs, 'letter.pdf'), await letter());
  fs.writeFileSync(path.join(ARG.docs, 'scan.pdf'), await scan()); await browser.close();
} else {
  const docs = { review: await review(), form: await form(), letter: await letter(), scan: await scan() };
  for (const [k, story] of STORIES.entries()) {
    if (SHOTS && !SHOTS.includes(k + 1)) continue;
    for (const kind of ONLY) {
      const raw = ARG.reuse ? fs.readFileSync(path.join(RAW, `${kind}-${k + 1}.png`)) : await capture(kind, story, docs);
      if (RAW && !ARG.reuse) fs.writeFileSync(path.join(RAW, `${kind}-${k + 1}.png`), raw);
      await launch();
      const file = `${kind}-${String(k + 1).padStart(2, '0')}-${story.slug}.png`;
      fs.writeFileSync(path.join(OUT, file), await compose(kind, story, raw)); console.log('wrote docs/app-store/' + file);
    }
  }
  await browser.close();
}
