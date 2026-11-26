// App Store screenshots for iPhone 6.9" (1320 x 2868), iPad 13" (2064 x 2752) and Mac (2880 x 1800), all from the
// real app in dark mode, on the family template shared with Cowdrey.MD (tests/store-frame.mjs, the same file in both
// repos, a word-for-word copy of the family master): a deep raspberry ground, a Fraunces headline, one line in
// Instrument Sans, and the device with the app: the iPhone, the iPad, and on the Mac the app's window on the family's
// MacBook desktop.
//
// Run: python3 build.py && (cd desktop && npm ci) && npm install --no-save playwright@1.56.1 &&
//      node tests/app-store-screens.mjs [--only=iphone,ipad,mac] [--shots=1,2] [--raw=dir] [--docs=dir]
//   -> docs/app-store/{iphone,ipad,mac}-0N-<slug>.png (RGB, no alpha, as App Store Connect wants them)
//
// Every document is fictional and made here with pdf-lib (or drawn in the page, for the scan). The phone and tablet
// are the iPhone and iPad app (touch, their user agent, the safe areas of the real screens); the Mac is the Mac App
// Store build in a window with the macOS title bar, on a MacBook's desktop. The app's clock is fixed at the family's
// MAC_CLOCK time (Wed Nov 25 2026, 9:41 AM), so the dates it shows (a comment's day) never drift between runs.
import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
import { compose as frame, desktop, THEMES } from './store-frame.mjs';
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
  // The Mac window: 1380 x 851 points, the app's 1380 x 823 under the 28-point macOS title bar the template draws
  // (the app has no title bar of its own). At this width the ribbon of every tab the stories use fits the window, and
  // the window sits on the MacBook's 1512 x 982 pt desktop at its real size with 66 pt of wallpaper at each side and
  // about 50 pt above and below it, under the 32 pt menu bar.
  mac: { w: 1380, h: 823, scale: 2, touch: false, safe: { top: 0, bottom: 0 }, out: [2880, 1800], titlebar: 28 },
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
// The app's clock: the family's MAC_CLOCK time ('Wed Nov 25  9:41 AM', 2026), so a comment made in a story is dated
// 25 Nov 2026 on every run, and the Mac's menu bar agrees with it.
const NOW = { time: '2026-11-25T09:41:00-08:00', zone: 'America/Los_Angeles', locale: 'en-US' };
async function app(kind, h) {
  const d = DEVICES[kind];
  await launch();
  const ctx = await browser.newContext({ viewport: { width: d.w, height: h || d.h }, colorScheme: 'dark', deviceScaleFactor: d.scale, hasTouch: d.touch, isMobile: kind === 'iphone', acceptDownloads: true, locale: NOW.locale, timezoneId: NOW.zone, ...(d.ua ? { userAgent: d.ua } : {}) });
  await ctx.clock.setSystemTime(new Date(NOW.time));
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
// The dates in the documents, one line for the whole set. The app's clock is MAC_CLOCK (Wed Nov 25 2026, in the Mac's
// menu bar), and a comment made in a story is dated that day, so no document in any picture is dated after it: the
// proposal is from the week before (16 November 2026), valid until 18 December and moved to 8 January 2027 in the
// edit, with the kick-off in January; the minutes of the proposal review are from 20 November, the reference and the
// supplier's invoice from early November (the invoice's PAID stamp from the week after), and the supplier form is
// signed the day before the clock (the date typed in the fill-and-sign story).
const ONE_DATE_LINE = { proposal: '16 November 2026', valid: '18 December 2026', extended: '8 January 2027', kickoff: '2027-01-11',
  minutes: '20 November 2026', signed: '24 November 2026', letter: '9 November 2026', until: 'October 2026', scan: '10 November 2026', paid: '18 NOV 2026', pack: 'Alder & Co client file' };
const DATES = { device: ONE_DATE_LINE, mac: ONE_DATE_LINE };

// A design studio's proposal to a client, as studios send them: a cover, a summary, the approach, the scope and
// fees, a timeline and the page to sign, in the studio's own type with one accent colour.
const PROPOSAL = { studio: 'Northwind Studio', client: 'Alder & Co.', title: 'Website redesign', ref: 'NW-2611', file: 'Alder & Co proposal.pdf' };
const longDate = (d) => `${d.getUTCDate()} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
async function proposal(D = DATES.device) {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  // Without ligatures: an "fi" drawn as one glyph would come back as that glyph when the line is retyped.
  const font = (fam, file) => pdf.embedFont(GF(fam, file), { features: { liga: false } });
  const f = await font('noto-sans', '400Regular/NotoSans_400Regular.ttf');
  const m = await font('noto-sans', '600SemiBold/NotoSans_600SemiBold.ttf');
  const b = await font('noto-sans', '700Bold/NotoSans_700Bold.ttf');
  const serif = await font('noto-serif', '600SemiBold/NotoSerif_600SemiBold.ttf');
  const accent = hex('#B4532A'), ink = hex('#1A1D21'), grey = hex('#5E6570'), light = hex('#9AA0A8'), rule = hex('#DADDE1'), tint = hex('#F7F1EC'), white = hex('#FFFFFF');
  const M = 64, R = W - M, PAGES = 6;
  const text = (p, t, x, y, size = 10.5, font = f, color = ink) => p.drawText(t, { x, y, size, font, color });
  const right = (p, t, x, y, size = 10.5, font = f, color = ink) => text(p, t, x - font.widthOfTextAtSize(t, size), y, size, font, color);
  const line = (p, x1, y1, x2, y2, color = rule, thickness = .6) => p.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color });
  // Words wrapped to a width, one drawText per line (so each line is one line of text in a viewer).
  const wrap = (t, width, size, font = f) => {
    const out = []; let cur = '';
    for (const w of t.split(' ')) { const s = cur ? cur + ' ' + w : w; if (font.widthOfTextAtSize(s, size) > width && cur) { out.push(cur); cur = w; } else cur = s; }
    return cur ? [...out, cur] : out;
  };
  const para = (p, t, y, o = {}) => {
    const size = o.size || 10.5, lead = size * (o.lead || 1.6);
    for (const l of o.lines || wrap(t, o.width || R - M, size, o.font || f)) { text(p, l, o.x ?? M, y, size, o.font || f, o.color || ink); y -= lead; }
    return y;
  };
  const mark = (p, x, y, s) => { p.drawRectangle({ x, y, width: s, height: s, color: accent }); text(p, 'N', x + s * .25, y + s * .22, s * .62, b, white); };
  const kicker = (p, t, y) => text(p, t.toUpperCase(), M, y, 8, b, accent);
  // Every page after the cover: the studio's mark and the document's name, and a footer with the page number.
  const page = (n, kick, title) => {
    const p = pdf.addPage([W, H]);
    mark(p, M, H - 58, 14); text(p, PROPOSAL.studio, M + 22, H - 54, 9.5, m, ink);
    right(p, `${PROPOSAL.title} proposal  ·  ${PROPOSAL.client}`, R, H - 54, 8.5, f, grey);
    line(p, M, H - 72, R, H - 72);
    footer(p, n);
    kicker(p, kick, H - 122); text(p, title, M, H - 152, 24, serif, ink);
    return p;
  };
  const footer = (p, n) => {
    line(p, M, 58, R, 58);
    text(p, `${PROPOSAL.studio}  ·  Proposal ${PROPOSAL.ref}  ·  Confidential`, M, 42, 8, f, light);
    right(p, `Page ${n} of ${PAGES}`, R, 42, 8, f, light);
  };
  const start = new Date(D.kickoff + 'T12:00:00Z');
  const week = (w) => longDate(new Date(start.getTime() + (w - 1) * 7 * 864e5));
  const PHASES = [
    { n: '01', name: 'Discovery', does: ['Stakeholder interviews, analytics', 'review and a content audit'], weeks: [1, 3], fee: 6400 },
    { n: '02', name: 'UX and structure', does: ['Sitemap, wireframes for 12 key', 'templates, prototype testing'], weeks: [3, 6], fee: 9800 },
    { n: '03', name: 'Visual design', does: ['Design system, high-fidelity', 'pages, accessibility review'], weeks: [5, 9], fee: 12600 },
    { n: '04', name: 'Build and launch', does: ['CMS build, content migration,', 'testing and launch support'], weeks: [8, 14], fee: 18200 },
  ];
  const money = (v) => '$' + v.toLocaleString('en-US');
  const total = PHASES.reduce((s, x) => s + x.fee, 0);

  // 1. Cover
  let p = pdf.addPage([W, H]);
  p.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: accent });
  mark(p, M, H - 92, 26); text(p, PROPOSAL.studio, M + 38, H - 84, 15, m, ink);
  right(p, `Proposal ${PROPOSAL.ref}`, R, H - 82, 9, f, grey);
  kicker(p, 'Proposal', H - 196);
  text(p, PROPOSAL.title, M, H - 242, 34, serif, ink);
  text(p, `for ${PROPOSAL.client}`, M, H - 274, 20, serif, grey);
  p.drawRectangle({ x: M, y: H - 310, width: 48, height: 3, color: accent });
  let y = H - 368;
  for (const [k, v] of [['Client', 'Alder & Co.'], ['Date', D.proposal], ['Prepared by', 'Alex Morgan, Studio director'], ['Valid until', D.valid]]) {
    text(p, k.toUpperCase(), M, y, 8, b, light); text(p, v, M + 120, y - 1, 12, m, ink);
    y -= 14; line(p, M, y, R, y); y -= 26;
  }
  para(p, 'A new website that sells as well as the shops do: clearer to browse, faster on a phone, and simple for the Alder team to keep up to date.', 200, { size: 12, color: grey, width: 290, lead: 1.55 });
  footer(p, 1);

  // 2. Executive summary
  p = page(2, 'Executive summary', 'Why now, and what we propose');
  y = para(p, 'Alder & Co. has grown from one shop to six, and half of your sales now start online. The current site was built for a catalogue, not a store: products are hard to find, checkout takes five steps, and three in four visitors arrive on a phone.', H - 196, { size: 11.5, color: grey, lead: 1.65 });
  y = para(p, 'We propose a 14-week redesign in four phases, for a fixed fee of $47,000. You will have a site your team can update without us, and a design system that keeps new pages on brand.', y - 8, { size: 11.5, color: grey, lead: 1.65 });
  y -= 34;
  p.drawRectangle({ x: M, y: y - 74, width: R - M, height: 92, color: tint });
  [['14 weeks', 'from kick-off to launch'], [money(total), 'fixed fee, four phases'], ['3 steps', 'to checkout, down from five']].forEach(([v, l], i) => {
    const x = M + 22 + i * 164; text(p, v, x, y - 22, 22, serif, accent); text(p, l, x, y - 44, 9.5, f, grey);
  });
  y -= 124;
  text(p, 'What success looks like', M, y, 14, m, ink); y -= 46;
  for (const [t, d] of [['Found in two taps', 'Every product reachable from the home page in two taps or fewer.'], ['Updated by your team', 'New products and offers go live the same day, without a developer.'], ['More online orders', 'Raise the share of visits that end in an order from 1.9% to 2.6%.']]) {
    p.drawRectangle({ x: M, y: y - 3, width: 3, height: 32, color: accent });
    text(p, t, M + 16, y + 17, 11.5, m, ink); text(p, d, M + 16, y + 1, 10.5, f, grey); y -= 52;
  }

  // 3. Approach
  p = page(3, 'Our approach', 'How we will work together');
  y = para(p, 'We work in short, open phases. You see the work every week, and nothing moves to the next phase until you have signed it off.', H - 196, { size: 11.5, color: grey, lead: 1.65 });
  y -= 14;
  for (const [n, t, d] of [['1', 'Start with your customers', 'Interviews with shoppers and shop staff, and a review of a year of analytics, before we draw a single page.'], ['2', 'Design in the open', 'A shared board with every sketch and decision, and a 30-minute review with your team each Thursday.'], ['3', 'Build to last', 'A design system and a CMS your team is trained on, so the site keeps its shape long after launch.']]) {
    p.drawCircle({ x: M + 13, y: y - 4, size: 13, color: tint }); text(p, n, M + 9.5, y - 9, 12, b, accent);
    text(p, t, M + 40, y, 12.5, m, ink); para(p, d, y - 19, { x: M + 40, width: R - M - 40, color: grey, size: 10.5, lead: 1.55 }); y -= 84;
  }
  y -= 4; line(p, M, y, R, y); y -= 30;
  text(p, 'Included', M, y, 11.5, m, ink); text(p, 'Not included', M + 252, y, 11.5, m, ink); y -= 22;
  const inc = ['Up to 12 page templates', 'Migration of up to 120 pages', 'Two rounds of revisions per phase', 'CMS training for four people'];
  const exc = ['Photography and video', 'Copywriting for new pages', 'Paid search and advertising', 'Hosting fees'];
  inc.forEach((t, i) => { text(p, '+', M, y - i * 20, 10.5, b, accent); text(p, t, M + 14, y - i * 20, 10.5, f, ink); text(p, '–', M + 252, y - i * 20, 10.5, b, light); text(p, exc[i], M + 266, y - i * 20, 10.5, f, grey); });

  // 4. Scope and fees
  p = page(4, 'Scope and fees', 'Four phases, one fixed fee');
  y = H - 204; const cx = [M, M + 160, M + 352];
  text(p, 'PHASE', cx[0], y, 8, b, light); text(p, 'DELIVERABLES', cx[1], y, 8, b, light); text(p, 'WEEKS', cx[2], y, 8, b, light); right(p, 'FEE', R, y, 8, b, light);
  y -= 12; line(p, M, y, R, y, ink, .8); y -= 26;
  for (const ph of PHASES) {
    text(p, ph.n, cx[0], y, 10.5, b, accent); text(p, ph.name, cx[0] + 24, y, 11.5, m, ink);
    ph.does.forEach((t, i) => text(p, t, cx[1], y - i * 16, 10.5, f, grey));
    text(p, `${ph.weeks[0]}–${ph.weeks[1]}`, cx[2], y, 10.5, f, ink);
    right(p, money(ph.fee), R, y, 11.5, m, ink);
    y -= 32; line(p, M, y, R, y); y -= 26;
  }
  y += 4; p.drawRectangle({ x: M, y: y - 16, width: R - M, height: 40, color: tint });
  text(p, 'Total, fixed fee', M + 14, y, 12.5, m, ink); right(p, money(total), R - 14, y - 1, 16, serif, accent);
  y -= 66;
  text(p, 'Payment schedule', M, y, 12.5, m, ink); y -= 26;
  for (const [pc, t, v] of [['30%', 'On signing this proposal', total * .3], ['40%', 'When the visual design is signed off', total * .4], ['30%', 'At launch', total * .3]]) {
    text(p, pc, M, y, 10.5, b, accent); text(p, t, M + 44, y, 10.5, f, ink); right(p, money(v), R, y, 10.5, f, ink); y -= 12; line(p, M, y, R, y); y -= 20;
  }
  y -= 8;
  text(p, 'Fees exclude sales tax. Invoices are due within 14 days. Support after launch: $1,200 a month.', M, y, 9.5, f, grey);

  // 5. Timeline
  p = page(5, 'Timeline', `Fourteen weeks, from ${week(1)}`);
  const gx = M + 130, gw = R - gx, cw = gw / 14; y = H - 206;
  for (let w = 1; w <= 14; w++) text(p, String(w), gx + (w - .5) * cw - f.widthOfTextAtSize(String(w), 8) / 2, y, 8, f, light);
  text(p, 'WEEK', M, y, 8, b, light);
  y -= 12; const top = y;
  const rows = [...PHASES.map((x) => [x.name, x.weeks]), ['Content migration', [10, 13]], ['Launch', [14, 14]]];
  const bottom = top - rows.length * 40;
  for (let w = 0; w <= 14; w++) line(p, gx + w * cw, top, gx + w * cw, bottom, hex('#ECEEF0'), .5);
  rows.forEach(([t, [a, z]], i) => {
    const ry = top - i * 40 - 26;
    text(p, t, M, ry + 2, 10.5, i < 4 ? m : f, ink);
    p.drawRectangle({ x: gx + (a - 1) * cw + 2, y: ry - 2, width: (z - a + 1) * cw - 4, height: 14, color: i === 5 ? accent : i < 4 ? hex('#D9926F') : hex('#EBC6B2') });
  });
  line(p, M, bottom, R, bottom); y = bottom - 40;
  text(p, 'Key dates', M, y, 12.5, m, ink); y -= 26;
  for (const [t, w] of [['Kick-off workshop at your office', 1], ['Wireframes signed off', 6], ['Visual design signed off', 9], ['Site ready for your team to test', 13], ['Launch', 14]]) {
    p.drawCircle({ x: M + 4, y: y + 3.5, size: 3.5, color: accent });
    text(p, t, M + 16, y, 10.5, f, ink); right(p, week(w), R, y, 10.5, m, ink); y -= 12; line(p, M, y, R, y); y -= 20;
  }

  // 6. Next steps and acceptance
  p = page(6, 'Next steps', 'Getting started');
  y = H - 204;
  for (const [n, t] of [['1', `Sign and return this page by ${D.valid}.`], ['2', 'We send the first invoice and book the kick-off workshop.'], ['3', `Discovery starts on ${week(1)}.`]]) {
    text(p, n, M, y, 12, b, accent); text(p, t, M + 22, y, 11.5, f, ink); y -= 30;
  }
  y -= 18; line(p, M, y, R, y); y -= 40;
  text(p, 'Acceptance', M, y, 16, serif, ink); y -= 28;
  y = para(p, `By signing below, Alder & Co. accepts this proposal (${PROPOSAL.ref}) and the fixed fee of ${money(total)}, under Northwind Studio's standard terms of business.`, y, { size: 10.5, color: grey, lead: 1.6 });
  y -= 70;
  // Two blocks to sign: a line for the signature, the name and title, and the date.
  const sigs = (x, who, name) => {
    text(p, who.toUpperCase(), x, y + 52, 8, b, light);
    line(p, x, y, x + 220, y, ink, .8); text(p, 'Signature', x, y - 16, 8.5, f, light);
    if (name) text(p, name, x, y - 56, 10.5, m, ink);
    line(p, x, y - 62, x + 220, y - 62, ink, .8); text(p, 'Name and title', x, y - 78, 8.5, f, light);
    line(p, x, y - 124, x + 220, y - 124, ink, .8); text(p, 'Date', x, y - 140, 8.5, f, light);
  };
  sigs(M, 'For Alder & Co.');
  sigs(M + 264, 'For Northwind Studio', 'Alex Morgan, Studio director');
  pdf.setTitle(`${PROPOSAL.title} proposal for ${PROPOSAL.client}`); pdf.setAuthor(PROPOSAL.studio);
  return pdf.save();
}

// The studio's terms of business, which the proposal's acceptance page names: three pages in the proposal's house
// style (the mark, the running head, numbered clauses and a footer), sent with it.
async function terms() {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const font = (fam, file) => pdf.embedFont(GF(fam, file), { features: { liga: false } });
  const f = await font('noto-sans', '400Regular/NotoSans_400Regular.ttf');
  const m = await font('noto-sans', '600SemiBold/NotoSans_600SemiBold.ttf');
  const b = await font('noto-sans', '700Bold/NotoSans_700Bold.ttf');
  const serif = await font('noto-serif', '600SemiBold/NotoSerif_600SemiBold.ttf');
  const accent = hex('#B4532A'), ink = hex('#1A1D21'), grey = hex('#5E6570'), light = hex('#9AA0A8'), rule = hex('#DADDE1'), white = hex('#FFFFFF');
  const M = 64, R = W - M, PAGES = 3;
  const text = (p, t, x, y, size, fo, color) => p.drawText(t, { x, y, size, font: fo, color });
  const wrap = (t, width, size) => {
    const out = []; let cur = '';
    for (const w of t.split(' ')) { const s = cur ? cur + ' ' + w : w; if (f.widthOfTextAtSize(s, size) > width && cur) { out.push(cur); cur = w; } else cur = s; }
    return cur ? [...out, cur] : out;
  };
  const CLAUSES = [
    ['Scope', ['The work is what the signed proposal describes, phase by phase. Anything outside it is quoted separately and starts only once you have agreed the quote in writing.', 'Each phase ends with a sign-off. Once a phase is signed off, changes to it are new work.']],
    ['Revisions', ['Each phase includes two rounds of revisions. A round is one set of consolidated comments from your team, sent to us in one message or one shared document.']],
    ['Fees and payment', ['Fees are fixed for the scope in the proposal and exclude sales tax. We invoice on the schedule in the proposal, and invoices are due within 14 days.', 'If an invoice is more than 30 days late we may pause the work until it is paid, and the timeline moves by the length of the pause.']],
    ['Your part', ['You give us a named contact who can sign off each phase, access to your analytics and current site, and the content and photographs the proposal lists as yours.', 'Feedback within five working days keeps the timeline. Longer delays move the dates that follow.']],
    ['Ownership', ['When the final invoice is paid, you own the designs, the templates and the code we write for you. We keep the right to show the work in our portfolio, unless you ask us not to.', 'Fonts, photographs and software from third parties stay under their own licences.']],
    ['Confidentiality', ['We keep your business information private and use it only for this project. The same applies to anything we share with you about our methods and pricing.']],
    ['Launch and support', ['We fix any defect in our work that you report within 30 days of launch, at no charge. After that, support is available at the monthly fee in the proposal, cancellable with a month’s notice.']],
    ['Ending the project', ['Either of us may end the project with 14 days’ notice in writing. You pay for the work done up to that date, and we hand over everything made so far.']],
    ['Accessibility', ['We design and build to the Web Content Accessibility Guidelines 2.2 at level AA, and test the key templates with a screen reader before launch. Content your team adds later is yours to keep accessible.']],
    ['Hosting and third parties', ['Hosting, domain names, plug-ins and paid services are in your name and on your account. We set them up for you and pass on their costs at the price we pay.', 'We are not responsible for outages or changes made by those services, but we will help you deal with them.']],
    ['Personal data', ['Where we handle your customers\u2019 personal data, we do so only on your instructions, keep it secure, and delete it when the project ends. We sign a data processing agreement if you need one.']],
    ['Liability', ['Our total liability under this agreement is limited to the fees paid. Neither of us is liable for indirect losses, such as lost profits or lost data.']],
    ['Disputes', ['If something goes wrong, tell us first: the studio director will reply within two working days. If we cannot settle it between us, we will try mediation before going to court.']],
    ['General', ['These terms and the signed proposal are the whole agreement between us. Changes to them are valid only in writing and signed by both of us.', 'If any part of these terms cannot be enforced, the rest still applies.']],
  ];
  // The clauses flowed over the pages, each page under the running head with a kicker and a title on the first.
  let n = 0, p, y;
  const next = () => {
    n++; p = pdf.addPage([W, H]);
    p.drawRectangle({ x: M, y: H - 58, width: 14, height: 14, color: accent }); text(p, 'N', M + 3.5, H - 55, 8.7, b, white);
    text(p, 'Northwind Studio', M + 22, H - 54, 9.5, m, ink);
    const rh = 'Terms of business  ·  2026 edition'; text(p, rh, R - f.widthOfTextAtSize(rh, 8.5), H - 54, 8.5, f, grey);
    p.drawLine({ start: { x: M, y: H - 72 }, end: { x: R, y: H - 72 }, thickness: .6, color: rule });
    p.drawLine({ start: { x: M, y: 58 }, end: { x: R, y: 58 }, thickness: .6, color: rule });
    text(p, 'Northwind Studio  ·  Terms of business', M, 42, 8, f, light);
    const pg = `Page ${n} of ${PAGES}`; text(p, pg, R - f.widthOfTextAtSize(pg, 8), 42, 8, f, light);
    y = H - 122;
    if (n === 1) {
      text(p, 'TERMS OF BUSINESS', M, y, 8, b, accent); text(p, 'How we work with clients', M, y - 30, 24, serif, ink);
      y -= 64;
      for (const l of wrap('These terms apply to every project Northwind Studio takes on, together with the proposal you sign. Where the two differ, the proposal wins.', R - M, 11.5)) { text(p, l, M, y, 11.5, f, grey); y -= 19; }
      y -= 20;
    }
  };
  next();
  CLAUSES.forEach(([t, paras], i) => {
    const lines = paras.map((x) => wrap(x, R - M - 34, 10.5));
    const need = 26 + lines.reduce((s, l) => s + l.length * 16.5 + 8, 0);
    if (y - need < 80) next();
    text(p, String(i + 1).padStart(2, '0'), M, y, 10.5, b, accent); text(p, t, M + 34, y, 12.5, m, ink); y -= 22;
    for (const ls of lines) { for (const l of ls) { text(p, l, M + 34, y, 10.5, f, grey); y -= 16.5; } y -= 8; }
    y -= 14;
  });
  if (n !== PAGES) throw new Error(`terms ran to ${n} pages, not ${PAGES}`);
  pdf.setTitle('Northwind Studio terms of business'); pdf.setAuthor('Northwind Studio');
  return pdf.save();
}

// Alder & Co.'s new supplier form, as the studio fills it in once the proposal is agreed, with real form fields:
// text fields, the payment terms as a radio group, tick boxes for the declarations, the date and a line to sign.
async function form(D = DATES.device) {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const f = await pdf.embedFont(StandardFonts.Helvetica), b = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(GF('noto-serif', '700Bold/NotoSerif_700Bold.ttf'));
  const navy = hex('#1E3A5F'), gold = hex('#C9A45C'), grey = hex('#5F6670'), ink = hex('#1D2228'), pale = hex('#EEF2F7'), edge = hex('#B7C0CC'), box = hex('#8A94A3');
  const M = 56, p = pdf.addPage([W, H]), fm = pdf.getForm();
  p.drawRectangle({ x: 0, y: H - 112, width: W, height: 112, color: navy });
  p.drawRectangle({ x: 0, y: H - 116, width: W, height: 4, color: gold });
  // The company's mark: an "A&" in a square
  p.drawRectangle({ x: W - M - 46, y: H - 82, width: 46, height: 46, borderColor: gold, borderWidth: 2 });
  p.drawText('A&', { x: W - M - 38, y: H - 66, size: 18, font: serif, color: gold });
  p.drawText('Alder & Co.', { x: M, y: H - 56, size: 23, font: serif, color: hex('#FFFFFF') });
  p.drawText(`New supplier form  ·  Finance department  ·  Form AP-04`, { x: M, y: H - 82, size: 11.5, font: f, color: hex('#C9D5E4') });
  let y = H - 146;
  const label = (t, x, yy) => p.drawText(t, { x, y: yy, size: 9, font: b, color: grey });
  const field = (name, t, x, yy, w, value) => {
    label(t.toUpperCase(), x, yy + 30);
    const tf = fm.createTextField(name); tf.addToPage(p, { x, y: yy, width: w, height: 24, borderColor: edge, borderWidth: 1, backgroundColor: hex('#FFFFFF'), font: f });
    tf.setFontSize(12); if (value) tf.setText(value);
  };
  const head = (t) => { p.drawText(t, { x: M, y, size: 14, font: b, color: navy }); };
  head('Supplier details'); y -= 50;
  field('company', 'Company name', M, y, 290, 'Northwind Studio Ltd'); field('taxid', 'Tax ID', M + 310, y, W - 2 * M - 310, '84-2190573'); y -= 52;
  field('contact', 'Contact name', M, y, 290, 'Alex Morgan'); field('phone', 'Phone', M + 310, y, W - 2 * M - 310, '555-0163'); y -= 52;
  field('email', 'Accounts email', M, y, 290, 'accounts@northwind.example'); field('po', 'Purchase order', M + 310, y, W - 2 * M - 310, 'PO-30871'); y -= 52;
  field('address', 'Registered address', M, y, W - 2 * M, '4th floor, 12 Foundry Street, Portland, OR 97209'); y -= 46;
  head('Payment terms'); y -= 28;
  const rg = fm.createRadioGroup('terms');
  [['14', '14 days', 'from invoice date'], ['30', '30 days', 'from invoice date'], ['60', '60 days', 'end of month']].forEach(([n, t, sub], i) => {
    const x = M + i * 168;
    rg.addOptionToPage(n, p, { x, y: y - 4, width: 16, height: 16, borderColor: box, borderWidth: 1, backgroundColor: hex('#FFFFFF') });
    p.drawText(t, { x: x + 24, y, size: 12, font: b, color: ink }); p.drawText(sub, { x: x + 24, y: y - 15, size: 9.5, font: f, color: grey });
  });
  rg.select('14');
  y -= 50;
  head('Declarations'); y -= 12;
  p.drawRectangle({ x: M, y: y - 84, width: W - 2 * M, height: 84, color: pale });
  [['insurance', 'We hold professional indemnity insurance of at least $1 million.', true], ['conduct', 'We have read and accept the Alder & Co. supplier code of conduct.', true], ['einvoice', 'Send purchase orders and remittances by email only.', false]].forEach(([n, t, on], i) => {
    const yy = y - 24 - i * 24;
    const cb = fm.createCheckBox(n); cb.addToPage(p, { x: M + 16, y: yy - 4, width: 16, height: 16, borderColor: box, borderWidth: 1, backgroundColor: hex('#FFFFFF') }); if (on) cb.check();
    p.drawText(t, { x: M + 42, y: yy, size: 11.5, font: f, color: ink });
  });
  y -= 114;
  head('Authorisation'); y -= 22;
  for (const t of ['I confirm that the details above are correct and that I may sign for the supplier.', 'Alder & Co. will check the bank details by phone before the first payment is made.']) { p.drawText(t, { x: M, y, size: 10.5, font: f, color: ink }); y -= 16; }
  y -= 44;
  p.drawLine({ start: { x: M, y }, end: { x: M + 290, y }, thickness: .8, color: box });
  label('SIGNATURE', M, y - 16);
  field('date', 'Date', M + 310, y, W - 2 * M - 310); // typed in the story
  p.drawText('Return this form to accounts.payable@alder.example. Bank details are collected separately, by phone.', { x: M, y: 40, size: 8.5, font: f, color: grey });
  pdf.setTitle('New supplier form');
  return { bytes: await pdf.save(), sigLine: [M + 20, y + 4] };
}

// An employment reference full of personal details, to redact.
async function letter(D = DATES.device) {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const f = await pdf.embedFont(GF('noto-serif', '400Regular/NotoSerif_400Regular.ttf'));
  const b = await pdf.embedFont(GF('noto-serif', '700Bold/NotoSerif_700Bold.ttf'));
  const s = await pdf.embedFont(StandardFonts.Helvetica), sb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const plum = hex('#3B2F5C'), grey = hex('#62666E'), ink = hex('#1D2228');
  const M = 72, p = pdf.addPage([W, H]);
  p.drawRectangle({ x: M, y: H - 92, width: 30, height: 30, color: plum });
  p.drawText('B', { x: M + 9, y: H - 84, size: 18, font: sb, color: hex('#FFFFFF') });
  p.drawText('Brightline Logistics', { x: M + 42, y: H - 76, size: 15, font: sb, color: plum });
  p.drawText('People team  ·  22 Market Street, Oakfield  ·  555-0118  ·  people@brightline.example', { x: M + 42, y: H - 90, size: 8.5, font: s, color: grey });
  let y = H - 150;
  const P = (arr, o = {}) => { for (const t of arr) { p.drawText(t, { x: M, y, size: o.size || 11, font: o.font || f, color: o.color || ink }); y -= (o.size || 11) * 1.65; } y -= 8; };
  P([D.letter], { color: grey });
  P(['Employment reference: Jordan Ellis'], { font: b, size: 15, color: plum });
  P(['To whom it may concern,']);
  P(['Jordan Ellis worked for Brightline Logistics as an operations coordinator', `from June 2021 to ${D.until}, on a salary of $58,000 a year at leaving.`, 'Jordan left us of their own accord, in good standing.']);
  P(['Jordan ran our carrier bookings with care, was well liked by clients', 'and colleagues, and we would gladly employ Jordan again.']);
  P(['Personal details we hold:'], { font: b });
  for (const [k, v] of [['Phone', '555-0194'], ['Email', 'jordan.ellis@example.com'], ['Date of birth', '23 September 1994'], ['Employee number', 'BL-31926'], ['Home address', '41 Linden Road, Millbrook']]) {
    p.drawText(k, { x: M, y, size: 11, font: s, color: grey }); p.drawText(v, { x: M + 130, y, size: 11, font: f, color: ink }); y -= 22;
  }
  y -= 14;
  P(['If you would like to talk about this reference, please call me on 555-0118.']);
  P(['Yours faithfully,']); y -= 20;
  P(['Sam Okafor', 'Head of People, Brightline Logistics'], { color: ink });
  pdf.setTitle('Employment reference');
  return pdf.save();
}

// The minutes of the proposal review with the client: the meeting that agreed the proposal's changes.
async function minutes(D = DATES.device) {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const f = await pdf.embedFont(StandardFonts.Helvetica), b = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(GF('noto-serif', '700Bold/NotoSerif_700Bold.ttf'));
  const navy = hex('#1E3A5F'), grey = hex('#5F6670'), ink = hex('#1D2228'), line = hex('#D5DAE1');
  const M = 64, p = pdf.addPage([W, H]);
  p.drawText('ALDER & CO.  ·  MEETING MINUTES', { x: M, y: H - 70, size: 9, font: b, color: grey });
  p.drawText('Website redesign: proposal review', { x: M, y: H - 102, size: 21, font: serif, color: navy });
  let y = H - 140;
  for (const [k, v] of [['Date', D.minutes], ['Present', 'Dana Whitfield, Priya Shah (Alder & Co.); Alex Morgan (Northwind Studio)'], ['Subject', 'Proposal NW-2611, scope, fees and timeline']]) {
    p.drawText(k, { x: M, y, size: 10, font: b, color: grey }); p.drawText(v, { x: M + 70, y, size: 10, font: f, color: ink }); y -= 17;
  }
  y -= 10; p.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: .8, color: line }); y -= 28;
  const items = [
    ['Scope', ['The four phases in the proposal are agreed. The client asked for the online', 'shop to stay out of scope for now and be quoted separately.']],
    ['Fees', ['The fixed fee of $47,000 is agreed. The client asked to split the build fee', 'into two payments; the studio will send a new fees page.']],
    ['Timeline', ['Fourteen weeks from kick-off. The client will name one contact who signs', 'off each phase, with feedback within five working days.']],
    ['Supplier set-up', ['The studio will return the new supplier form to Finance this week.']],
  ];
  items.forEach(([t, ls], i) => {
    p.drawText(`${i + 1}.`, { x: M, y, size: 12, font: b, color: navy }); p.drawText(t, { x: M + 22, y, size: 12, font: b, color: ink }); y -= 19;
    for (const l of ls) { p.drawText(l, { x: M + 22, y, size: 10.5, font: f, color: ink }); y -= 15.5; }
    y -= 14;
  });
  y -= 6; p.drawText('Actions', { x: M, y, size: 13, font: b, color: navy }); y -= 24;
  p.drawText('ACTION', { x: M, y, size: 8.5, font: b, color: grey }); p.drawText('OWNER', { x: M + 300, y, size: 8.5, font: b, color: grey }); p.drawText('DUE', { x: M + 410, y, size: 8.5, font: b, color: grey }); y -= 8;
  for (const [a, o, d] of [['Send the revised fees page', 'Alex Morgan', '25 Nov 2026'], ['Return the new supplier form', 'Alex Morgan', '27 Nov 2026'], ['Sign and return the proposal', 'Dana Whitfield', '18 Dec 2026']]) {
    p.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: .6, color: line }); y -= 18;
    p.drawText(a, { x: M, y, size: 10.5, font: f, color: ink }); p.drawText(o, { x: M + 300, y, size: 10.5, font: f, color: ink }); p.drawText(d, { x: M + 410, y, size: 10.5, font: f, color: ink }); y -= 10;
  }
  p.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: .6, color: line });
  p.drawText('Minutes taken by Priya Shah  ·  Alder & Co.  ·  Internal', { x: M, y: 56, size: 8.5, font: f, color: grey });
  pdf.setTitle('Proposal review minutes');
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
// Highlight one whole line of page n as the app does a text selection. (A drag that starts at the very left edge of
// a line that follows a number on the same line can catch the page's own layer and select all of it.)
const highlightLine = (p, n, text) => p.evaluate(([n, text]) => {
  const el = [...document.querySelectorAll(`.page[data-n="${n}"] .textLayer span`)].find((s) => s.textContent === text);
  const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  return window.__cowdreyPdf.highlightSelection();
}, [n, text]);
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
const setZoom = async (p, z) => { await p.evaluate((z) => { const r = document.querySelector('#zoomRange'); r.value = z; r.dispatchEvent(new Event('change')); }, z); await p.waitForTimeout(1500); };
// Scroll so the top of the line with this text on page n sits `gap` points under the top of the view.
async function lineTo(p, n, text, gap) {
  await p.waitForFunction(findSpan, [n, text], { timeout: 15000 });
  await p.evaluate(([n, text, gap, fs]) => {
    const el = eval(fs)([n, text]), v = document.querySelector('#viewer');
    v.scrollTop += el.getBoundingClientRect().top - (v.getBoundingClientRect().top + gap);
  }, [n, text, gap, findSpan.toString()]);
  await p.waitForTimeout(700);
}
// On the iPhone, Fit width leaves a page's margins and a lot of grey around a small page. Zoom in two steps (to
// about 87%), so the page's text runs from edge to edge of the screen, and keep the page centred across.
async function phoneZoom(p) {
  if (p.kind !== 'iphone') return;
  await run(p, 'zoomIn'); await p.waitForTimeout(300); await run(p, 'zoomIn'); await p.waitForTimeout(1200);
}
// Scroll so the line with this text on page n sits at fraction f of the view's height, the page centred across.
// (A span that is exactly the text wins over one that only contains it: recognized text comes word by word.)
const findSpan = ([n, text]) => {
  const all = [...document.querySelectorAll(`.page[data-n="${n}"] .textLayer span`)];
  return all.find((s) => s.textContent.trim() === text) || all.find((s) => s.textContent.includes(text));
};
async function centerOn(p, n, text, f = .5) {
  await p.waitForFunction(findSpan, [n, text], { timeout: 15000 });
  await p.evaluate(([n, text, f, fs]) => {
    const el = eval(fs)([n, text]);
    const v = document.querySelector('#viewer'), vr = v.getBoundingClientRect(), r = el.getBoundingClientRect();
    v.scrollTop += r.top + r.height / 2 - (vr.top + vr.height * f);
    v.scrollLeft = (v.scrollWidth - v.clientWidth) / 2;
  }, [n, text, f, findSpan.toString()]);
  await p.waitForTimeout(700);
}
// Scroll so the top of page n sits just under the floating search bar: the letterhead is whole and in view, and no
// line of the page is cut by the bar's edge.
async function belowFind(p, n) {
  await p.evaluate((n) => {
    const v = document.querySelector('#viewer'), el = document.querySelector(`.page[data-n="${n}"]`), bar = document.querySelector('#findbar');
    v.scrollTop += el.getBoundingClientRect().top - (bar.getBoundingClientRect().bottom + 6);
    v.scrollLeft = (v.scrollWidth - v.clientWidth) / 2;
  }, n);
  await p.waitForTimeout(700);
}
// Drag with the mouse from the start of the words `from` in the line holding `a` to the end of the words `to` in the
// line holding `b` (on page n), as you select a phrase that starts or ends inside a line.
async function dragText(p, n, a, from, b, to) {
  const [s, e] = await p.evaluate(([n, a, from, b, to]) => {
    const all = [...document.querySelectorAll(`.page[data-n="${n}"] .textLayer span`)];
    const rect = (line, sub, end) => {
      const el = all.find((x) => x.textContent.includes(line)), t = el.firstChild, i = t.textContent.indexOf(sub);
      const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + sub.length);
      const q = r.getBoundingClientRect(); return [end ? q.right - 1 : q.left + 1, q.top + q.height / 2];
    };
    return [rect(a, from, false), rect(b, to, true)];
  }, [n, a, from, b, to]);
  await p.mouse.move(s[0], s[1]); await p.mouse.down(); await p.mouse.move(e[0], e[1], { steps: 10 }); await p.mouse.up();
  await p.waitForTimeout(300);
}
// Drag across the words from one to another (the first word after it that starts with `to`), as a finger or the mouse
// selects text.
async function selectWords(p, n, from, to) {
  const [a, b] = await p.evaluate(([n, from, to]) => {
    const all = [...document.querySelectorAll(`.page[data-n="${n}"] .textLayer span`)];
    const i = all.findIndex((s) => s.textContent.trim() === from), j = all.findIndex((s, k) => k > i && s.textContent.trim().startsWith(to));
    const r = (el) => { const q = el.getBoundingClientRect(); return [q.left, q.top, q.width, q.height]; };
    return [r(all[i]), r(all[j])];
  }, [n, from, to]);
  await p.mouse.move(a[0] + 1, a[1] + a[3] / 2); await p.mouse.down();
  await p.mouse.move(b[0] + b[2] - 1, b[1] + b[3] / 2, { steps: 10 }); await p.mouse.up();
  await p.waitForTimeout(300);
}

const STORIES = [
  { slug: 'edit-text', title: 'Edit any PDF.\nRight on the page.', sub: 'Tap a line and type, in the PDF’s own font.', subMac: 'Click a line and type, in the PDF’s own font.',
    macH: 859, // (the taller Mac window of the organize story, below)
    async shoot(p, docs) {
      await openDoc(p, docs.proposal, PROPOSAL.file);
      await tab(p, 'Edit'); await run(p, 'txtEditLines'); await p.waitForTimeout(400);
      if (p.kind === 'iphone') {
        // The cover, zoomed in so its details run across the screen, labels and all: the proposal's last day,
        // moved on two weeks for the client. (The last line of the details, so the format bar opens over the
        // empty paper under them.)
        // (The cover's "Proposal" kicker a little under the ribbon, so the page does not start cut mid-line.)
        await phoneZoom(p); await setZoom(p, 140); await lineTo(p, 0, 'PROPOSAL', 10);
        await p.evaluate(async (x) => { const v = document.querySelector('#viewer'), el = document.querySelector('.page[data-n="0"]'); v.scrollLeft += el.getBoundingClientRect().left + el.offsetWidth * x - v.getBoundingClientRect().left; }, 50 / W);
        await p.waitForTimeout(500);
        await tapLine(p, 0, docs.D.valid);
        await p.keyboard.press('End'); for (let i = 0; i < docs.D.valid.length; i++) await p.keyboard.press('Backspace');
        await p.keyboard.type(docs.D.extended, { delay: 20 });
      } else {
        if (p.kind === 'mac') { await run(p, 'sidebar'); await p.waitForTimeout(500); }
        await goPage(p, 1);
        if (p.kind === 'mac') {
          // Close in on the page (110%, in the taller window), so the edit box and the format bar read at thumbnail
          // size: the whole width of the page with the grey on both sides, from the gap above the "Executive summary"
          // kicker and the page's title (so the picture reads as the proposal) to the paper under the last line of
          // its text, so no line is cut at an edge.
          await setZoom(p, 110);
          await p.evaluate(([H]) => {
            const v = document.querySelector('#viewer'), el = document.querySelector('.page[data-n="1"]');
            v.scrollTop += el.getBoundingClientRect().top - v.getBoundingClientRect().top + el.offsetHeight * 104 / H;
            v.scrollLeft = (v.scrollWidth - v.clientWidth) / 2;
          }, [H]);
          await p.waitForTimeout(700);
        }
        // The summary's last goal, the target raised after a call with the client (the page's last line, so the
        // format bar opens over the empty paper under it).
        await tapLine(p, 1, 'Raise the share of visits');
        await p.keyboard.press('End'); for (let i = 0; i < 'to 2.6%.'.length; i++) await p.keyboard.press('Backspace');
        await p.keyboard.type('to 3% within a year.', { delay: 20 });
      }
      await p.waitForTimeout(400);
    } },
  { slug: 'scans-to-text', title: 'Scans become\nsearchable text.', sub: 'Search and copy words on scanned pages.',
    async shoot(p, docs) {
      await openDoc(p, docs.scan, 'Kestrel invoice.pdf');
      if (p.kind === 'mac') await tab(p, 'Edit'); // where Recognize text is
      await onePage(p);
      const r = await p.evaluate(() => window.__cowdreyPdf.ocrRunHeadless({ lang: 'eng' }));
      if (!r.words) throw new Error('OCR found no words: ' + JSON.stringify(r));
      await p.waitForTimeout(600);
      await run(p, 'find'); await p.fill('#findInput', 'invoice'); await p.waitForTimeout(900);
      // The invoice's opening paragraph and its items, with the hits for "invoice", and the payment paragraph under
      // the items selected, both its lines, as you would to copy it: what was a picture of a page is text now. (The
      // selection's own toolbar opens under it, in the gap above the closing, clear of the items.)
      await phoneZoom(p);
      // (On the Mac the selection's toolbar opens above it and would cover the list: the hits alone tell it there.)
      // The Mac at 125%: the letter whole from "Dear Accounts team" to the signature, the closing and the PAID stamp,
      // the view's top in the gap under the date and its foot in the paper under the signer's name, clear of the edge.
      if (p.kind === 'mac') { await setZoom(p, 125); await lineTo(p, 0, 'Dear', 16); await p.evaluate(() => { const v = document.querySelector('#viewer'); v.scrollLeft = (v.scrollWidth - v.clientWidth) / 2; }); }
      else { await belowFind(p, 0); await selectWords(p, 0, 'Payment', 'accounts@'); }
    } },
  { slug: 'fill-and-sign', title: 'Fill in forms.\nSign in seconds.', sub: 'Type into any form, then sign it with your finger.', subMac: 'Type into any form, then add your signature.',
    async shoot(p, docs) {
      await openDoc(p, docs.form.bytes, 'Alder & Co supplier form.pdf');
      await onePage(p);
      await p.waitForSelector('.annotationLayer input');
      // The date, typed into its field (on the iPhone the page zooms in to a field while it has the focus, and back
      // out when the focus leaves it), then the signature drawn and put on its line.
      {
        const field = p.locator('.page[data-n="0"] .annotationLayer input[name="date"]');
        await field.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
        if (p.kind === 'mac') await field.click(); else await field.tap();
        await p.waitForTimeout(800);
        await p.keyboard.type(docs.D.signed, { delay: 20 }); await p.waitForTimeout(300);
        await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
        await p.waitForTimeout(1200);
      }
      if (p.kind === 'mac') await tab(p, 'Protect'); // its first tool is Signature
      await run(p, 'sign'); await p.waitForSelector('#dialog[open] #sigPad');
      const pad = await (await p.$('#sigPad')).boundingBox();
      for (const stroke of SIGNATURE) {
        const pts = smooth(stroke);
        await p.mouse.move(pad.x + pts[0][0] * pad.width, pad.y + pts[0][1] * pad.height); await p.mouse.down();
        for (const [x, y] of pts.slice(1)) await p.mouse.move(pad.x + x * pad.width, pad.y + y * pad.height);
        await p.mouse.up();
      }
      await p.click('#dialog .dlg-foot .btn.primary'); await p.waitForTimeout(400);
      // The Mac at 150%, so the form's words read at thumbnail size: from the "Payment terms" heading, 24 points
      // under the ribbon, past the declarations and the authorisation to the signature and the date. The iPhone keeps the page
      // at its width, so the whole form is in view, banner to foot; the iPad shows the page whole.
      if (p.kind === 'mac') { await setZoom(p, 150); await lineTo(p, 0, 'Payment terms', 24); }
      else if (p.kind === 'iphone') { await goPage(p, 0, 'center'); await p.evaluate(() => { const v = document.querySelector('#viewer'); v.scrollLeft = (v.scrollWidth - v.clientWidth) / 2; }); }
      else await goPage(p, 0, 'end');
      const [sx, sy] = docs.form.sigLine;
      const [x, y] = await at(p, 0, sx + 120, sy + 22);
      await p.mouse.click(x, y); await p.waitForTimeout(500);
      await run(p, 'tool_select'); await p.keyboard.press('Escape');
      await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    } },
  { slug: 'comments', title: 'Mark it up.\nTalk it through.', sub: 'Highlight, comment and reply.', macH: 859,
    async shoot(p, docs) {
      // The fees page, as the client reads it: the build fee and the payment it falls in highlighted, the client's
      // question on the build phase, and in the comments list the studio's answer under it.
      await openDoc(p, docs.proposal, PROPOSAL.file);
      await tab(p, 'Comment');
      // (The Mac at 125%, in the taller window: from the page's kicker and title, so it reads as the proposal, to
      // the last payment, the view's foot in the gap above the note under them.)
      const top = async () => { if (p.kind === 'mac') await pageAt(p, 3, 104 / H); else await goPage(p, 3); };
      if (p.kind === 'mac') await setZoom(p, 125);
      await top();
      await run(p, 'tool_highlight');
      await selectText(p, 3, '$18,200'); await highlightLine(p, 3, 'When the visual design is signed off');
      await p.evaluate(() => window.__cowdreyPdf.setAuthor('Dana Whitfield'));
      // (On the iPhone the note goes in the gap before the fee, so the strip beside the comments list, below, holds it.)
      await run(p, 'tool_note'); { const [x, y] = await at(p, 3, p.kind === 'iphone' ? 457 : 558, 386); await p.mouse.click(x, y); }
      await p.waitForSelector('.page-ask textarea'); await p.fill('.page-ask textarea', 'Could we split the build fee into two payments?'); await p.click('.page-ask .btn.primary'); await p.waitForTimeout(300);
      await p.evaluate(() => window.__cowdreyPdf.setAuthor('Alex Morgan'));
      await run(p, 'tool_select'); await p.keyboard.press('Escape');
      {
        await run(p, 'cm_list'); await p.waitForTimeout(600);
        const note = p.locator('#sidePanel [data-cm-go]', { hasText: 'two payments' }).first();
        await note.click();
        // (On the iPhone, choosing a comment closes the list to show the note on the page: open it again, where the
        // note's thread is open and takes the reply.)
        if (p.kind === 'iphone') { await p.waitForTimeout(500); await run(p, 'cm_list'); await p.waitForTimeout(600); }
        await p.waitForSelector('#sidePanel [data-cm-reply]');
        await p.fill('#sidePanel [data-cm-reply]', 'Yes, happy to. I’ll move half of it to launch and send a new page 4 today.');
        await p.click('#sidePanel [data-cm-send]'); await p.waitForTimeout(600);
      }
      await top();
      await p.evaluate(() => { const v = document.querySelector('#viewer'); v.scrollLeft = (v.scrollWidth - v.clientWidth) / 2; });
      // On the iPhone the comments list covers most of the screen, and the page shows in the strip beside it: zoomed
      // so the strip holds the fee column of the fees page, from the table's head to the last payment, with the
      // highlighted build fee, the note beside it and the total, and nothing else (no line of running text, no
      // page head or foot, no next page) to be cut by the list's edge.
      if (p.kind === 'iphone') {
        const strip = await p.evaluate(() => { const v = document.querySelector('#viewer').getBoundingClientRect(), s = document.querySelector('.sidebar').getBoundingClientRect(); return [s.right, v.right, v.top, Math.min(v.bottom, document.querySelector('.statusbar').getBoundingClientRect().top)]; });
        const [x0, x1] = [444, 553]; // the page's points the strip shows across: from the note to the fees' right edge
        const pxPerPt = async () => { const [a] = await at(p, 3, 0, 0), [b] = await at(p, 3, 100, 0); return (b - a) / 100; };
        let z = await p.evaluate(() => +document.querySelector('#zoomRange').value);
        for (let i = 0; i < 2; i++) { z = Math.round(z * (strip[1] - strip[0]) / (x1 - x0) / await pxPerPt()); await setZoom(p, z); }
        const [px, py] = await at(p, 3, x0, H - 356); // (356 points down: midway from the page's head to the line under the payments)
        await p.evaluate(([dx, dy]) => { const v = document.querySelector('#viewer'); v.scrollLeft += dx; v.scrollTop += dy; }, [px - strip[0], py - (strip[2] + strip[3]) / 2]);
        await p.waitForTimeout(700);
      }
      await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    } },
  { slug: 'redact', title: 'Redact for real.\nGone for good.', sub: 'Private details are removed, not covered.',
    async shoot(p, docs) {
      await openDoc(p, docs.letter, 'Employment reference.pdf');
      await onePage(p);
      await tab(p, 'Protect');
      for (const t of ['Jordan', 'Ellis', '$58,000', '555-0194', 'jordan.ellis@example.com', '23 September 1994', 'BL-31926', '41 Linden Road, Millbrook']) {
        await run(p, 'protRedSearch'); await p.waitForSelector('#dialog[open] input[name=text]'); await p.fill('#dialog input[name=text]', t);
        await p.click('#dialog .dlg-foot button:has-text("Find")');
        await p.waitForSelector('#dialog[open] .dlg-foot button:has-text("Mark")'); await p.click('#dialog .dlg-foot button:has-text("Mark")'); await p.waitForTimeout(250);
      }
      await run(p, 'protRedApply'); await p.waitForSelector('#dialog[open]'); await p.click('#dialog .dlg-foot button:has-text("Apply")'); await p.waitForTimeout(800);
      // the redacted contact details in the middle of the view
      if (p.kind === 'mac') await pageAt(p, 0, .155);
      if (p.kind === 'iphone') { await phoneZoom(p); await centerOn(p, 0, 'Personal details we hold', .45); }
    } },
  { slug: 'organize-pages', title: 'Put every page\nin its place.', sub: 'Move, turn, combine and split pages.',
    // On the Mac the window is 36 points taller than the others (859 pt, still 30 pt clear of the menu bar and the
    // desktop's foot), so both rows of the grid are whole, with their page numbers, and the view ends in the gap
    // under the second row.
    macH: 859,
    async shoot(p, docs) {
      // The client file, twelve pages long (the proposal and its terms of business, the minutes, the supplier form
      // and the scanned invoice), so the grid fills the screen, with two pages picked to move together.
      await openDoc(p, docs.pack, `${docs.D.pack}.pdf`);
      await tab(p, 'Pages'); await run(p, 'pg60_organize'); await p.waitForTimeout(2500);
      await p.evaluate(() => window.__cowdreyPdf.pg60.setSel([2, 3])); await p.waitForTimeout(600);
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
  const p = await app(kind, kind === 'mac' && story.macH);
  await story.shoot(p, docs);
  await p.evaluate(() => document.querySelectorAll('.ribbon-body').forEach((r) => { if (!r.dataset.keepScroll) r.scrollLeft = 0; }));
  // the tab strip from its start, so "Home" is never cut off, with the chosen tab still in view
  await p.evaluate(() => document.querySelectorAll('.ribbon-tabs').forEach((t) => { const a = t.querySelector('[aria-selected="true"], .on, .active'); t.scrollLeft = 0; if (a && a.offsetLeft + a.offsetWidth > t.clientWidth) t.scrollLeft = a.offsetLeft + a.offsetWidth - t.clientWidth + 8; }));
  // the rows that scroll sideways fade at the edge with more to see, as they do in the app after any scroll
  await p.evaluate(() => { const b = document.querySelector('#ribbonBody'); b && b.dispatchEvent(new Event('scroll')); });
  if (kind === 'mac') await p.mouse.move(DEVICES.mac.w - 6, DEVICES.mac.h - 6);
  // what happened is shown in a toast for a moment: wait for it to go, so it covers nothing
  await p.waitForFunction(() => !document.querySelector('#toast.show'), null, { timeout: 15000 }).catch(() => {});
  const png = await grab(p);
  if (p.errors.length) console.warn(kind, story.slug, p.errors);
  await p.ctx.close();
  return png;
}

/* ---------------- the template ---------------- */
// The family template (tests/store-frame.mjs, the same file in Cowdrey.MD) in Cowdrey.PDF's raspberry.
const b64 = (f) => fs.readFileSync(path.join(root, f)).toString('base64');
const FONTS = { fraunces: b64('design/app-store/fraunces.woff2'), instrument: b64('fonts/instrument-sans-latin-wght-normal.woff2') };
// The headline is a picture's first words: one or two lines, kept short enough to read in a search result.
// The Mac: the window on the family desktop (the menu bar with the app's name and the clock, the Dock hidden), and
// that desktop on the MacBook.
async function compose(kind, story, raw, file) {
  const sub = kind === 'mac' && story.subMac ? story.subMac : story.sub;
  // Every headline in the set is two lines, so the iPhone sits where every family app's does, at the two-line height.
  // The Mac's copy has room for one headline line and the sub-line only, so there the two lines run as one.
  if (kind !== 'mac') return frame(browser, kind, { head: story.title, sub, png: raw, title: 'Cowdrey.PDF', file, lines: 2 }, THEMES.pdf, FONTS);
  // The Mac: the window at its real point size, centred on the MacBook's desktop under the menu bar, with the
  // template's title bar (the app's capture has none of its own), the family's clock and the Dock hidden.
  const M = DEVICES.mac;
  const screen = await desktop(browser, { theme: THEMES.pdf, app: 'Cowdrey.PDF', fonts: FONTS,
    windows: [{ png: raw, w: M.w, h: (story.macH || M.h) + M.titlebar, chrome: 'window' }] });
  return frame(browser, kind, { head: story.title.replace(/\n/g, ' '), sub, device: 'macbook', png: screen, file }, THEMES.pdf, FONTS);
}

// The organize story's document: the studio's client file for Alder & Co., in one PDF (twelve pages, none of them
// twice): the proposal and the terms of business that go with it, the minutes of the proposal review, the client's
// new supplier form, and a supplier's scanned invoice for the printed proposals.
async function pack(d, D = DATES.device) {
  const out = await PDFDocument.create();
  for (const bytes of [d.proposal, d.terms, d.minutes, d.form.bytes, d.scan]) {
    const src = await PDFDocument.load(bytes);
    for (const pg of await out.copyPages(src, src.getPageIndices())) out.addPage(pg);
  }
  out.setTitle(D.pack);
  return out.save();
}

// A supplier's invoice letter to the studio: typed, printed, signed and scanned at 200 dpi (drawn here in the browser, so the PDF has only a
// picture of the page and no text until it is recognized).
async function scan(D = DATES.device) {
  await launch();
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  const png = await p.evaluate(([date, paid]) => {
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
    g.fillStyle = '#23395B'; g.font = `bold 64px ${serif}`; g.fillText('Kestrel Print & Paper Co.', 170, 250);
    g.fillStyle = '#3C3C3C'; g.font = `34px ${serif}`; g.fillText('Unit 7, Mill Lane Trading Estate  ·  Oakfield  ·  555-0147', 170, 305);
    g.fillRect(170, 340, 1360, 3);
    g.fillStyle = '#1E1E1E'; g.font = `40px ${serif}`;
    const lines = [date, '', 'Dear Accounts team,', '', 'Thank you for your order PO-30871. Please find below our invoice', 'INV-4471 for the printed proposals and samples delivered to your', 'studio on 6 November.', '', 'Invoice INV-4471:', '', ['KP-210  Proposal binders (x40)', '$312'], ['KP-118  Uncoated paper, 120 gsm', '$184'], ['KP-305  Colour sample cards', '$96'], ['Total due', '$592'], '', 'Payment is due within 14 days. Please quote INV-4471 on your', 'remittance, and send it to accounts@kestrel.example.', '', 'Thank you for your business.', '', 'With best wishes,'];
    let y = 450; for (const t of lines) { if (Array.isArray(t)) { g.fillText(t[0], 250, y); g.fillText(t[1], 1180, y); } else g.fillText(t, 170, y); y += 62; }
    // a signature in ink
    g.strokeStyle = '#1B2A6B'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath();
    g.moveTo(180, y + 40); g.bezierCurveTo(220, y - 30, 260, y + 70, 300, y + 10); g.bezierCurveTo(330, y - 20, 350, y + 60, 390, y + 20); g.bezierCurveTo(420, y - 10, 470, y + 50, 520, y + 15); g.bezierCurveTo(560, y - 5, 600, y + 30, 650, y + 25); g.stroke();
    g.fillStyle = '#1E1E1E'; g.font = `40px ${serif}`; g.fillText('Ruth Adeyemi, Accounts Manager', 170, y + 120);
    g.restore();
    // a rubber stamp
    g.save(); g.translate(1310, 1640); g.rotate(-0.21); g.strokeStyle = 'rgba(176, 38, 60, .72)'; g.fillStyle = 'rgba(176, 38, 60, .72)'; g.lineWidth = 7;
    g.strokeRect(-190, -70, 380, 140); g.font = `bold 50px ${serif}`; g.textAlign = 'center'; g.fillText('PAID', 0, 2); g.font = `bold 30px ${serif}`; g.fillText(paid, 0, 46); g.restore();
    return c.toDataURL('image/png').split(',')[1];
  }, [D.scan, D.paid]);
  await ctx.close();
  const pdf = await PDFDocument.create();
  const im = await pdf.embedPng(Buffer.from(png, 'base64'));
  pdf.addPage([W, H]).drawImage(im, { x: 0, y: 0, width: W, height: H });
  pdf.setTitle('Kestrel invoice INV-4471 (scan)');
  return pdf.save();
}

export { DEVICES, app, openDoc, run, tab, grab, launch, proposal, form, letter, minutes };
if (ARG.docs) {
  fs.writeFileSync(path.join(ARG.docs, 'proposal.pdf'), await proposal());
  fs.writeFileSync(path.join(ARG.docs, 'terms.pdf'), await terms());
  fs.writeFileSync(path.join(ARG.docs, 'form.pdf'), (await form()).bytes);
  fs.writeFileSync(path.join(ARG.docs, 'letter.pdf'), await letter());
  fs.writeFileSync(path.join(ARG.docs, 'minutes.pdf'), await minutes());
  fs.writeFileSync(path.join(ARG.docs, 'scan.pdf'), await scan()); await browser.close();
} else {
  // The documents for each set of dates (the Mac's, and the iPhone's and iPad's), made once.
  const made = {};
  const docsFor = async (kind) => {
    const D = DATES[kind === 'mac' ? 'mac' : 'device'];
    if (made[D.proposal]) return made[D.proposal];
    const docs = { D, proposal: await proposal(D), terms: await terms(), minutes: await minutes(D), form: await form(D), letter: await letter(D), scan: await scan(D) };
    docs.pack = await pack(docs, D);
    return (made[D.proposal] = docs);
  };
  // The Mac leads with Fill in and sign: Edit text outlines every line on the page, busy as a first picture.
  const ORDER = { mac: ['fill-and-sign', 'edit-text', 'scans-to-text', 'comments', 'redact', 'organize-pages'] };
  for (const kind of ONLY) {
    const order = (ORDER[kind] || STORIES.map((s) => s.slug)).map((slug) => STORIES.find((s) => s.slug === slug));
    const docs = await docsFor(kind);
    for (const [k, story] of order.entries()) {
      if (SHOTS && !SHOTS.includes(k + 1)) continue;
      const rawFile = RAW && path.join(RAW, `${kind}-${story.slug}.png`);
      const raw = ARG.reuse ? fs.readFileSync(rawFile) : await capture(kind, story, docs);
      if (RAW && !ARG.reuse) fs.writeFileSync(rawFile, raw);
      await launch();
      const file = `${kind}-${String(k + 1).padStart(2, '0')}-${story.slug}.png`;
      fs.writeFileSync(path.join(OUT, file), await compose(kind, story, raw, file)); console.log('wrote docs/app-store/' + file);
    }
  }
  await browser.close();
}
