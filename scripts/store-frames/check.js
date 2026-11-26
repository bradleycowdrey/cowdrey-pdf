// Checks a set of framed App Store screenshots against the family standard (README.md here), before they are
// published for review or uploaded: every picture named in docs/app-store/listing.json must be an opaque RGB PNG at
// Apple's exact size for its device, and must be in measure.json with the standard's type sizes and positions.
//
// Usage: node scripts/store-frames/check.js [docs/app-store]
// Exits 1 and lists every difference when anything is off.
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.argv[2] || path.join(__dirname, '../../docs/app-store'));
// The standard's numbers: canvas, type sizes in px, eyebrow baseline, headline top (line box), subhead bottom, device top.
const STD = {
  iphone: { size: [1320, 2868], eyebrow: 39, headline: 108, subhead: 51, baseline: 184, headlineTop: 213, subheadBottom: 531, deviceTop: 640, lines: 2 },
  ipad: { size: [2064, 2752], eyebrow: 52, headline: 144, subhead: 68, baseline: 204, headlineTop: 244, subheadBottom: 513, deviceTop: 600, lines: 1 },
  mac: { size: [2880, 1800], eyebrow: 39, headline: 108, subhead: 51, baseline: 144, headlineTop: 173, subheadBottom: 374, deviceTop: 470, lines: 1 },
};
const DISPLAY = { APP_IPHONE_67: 'iphone', APP_IPHONE_69: 'iphone', APP_IPAD_PRO_3GEN_129: 'ipad', APP_IPAD_PRO_129: 'ipad', APP_DESKTOP: 'mac' };

const errors = [];
const listing = JSON.parse(fs.readFileSync(path.join(dir, 'listing.json'), 'utf8'));
const measures = JSON.parse(fs.readFileSync(path.join(dir, 'measure.json'), 'utf8'));
const byFile = Object.fromEntries(measures.map((m) => [m.file, m]));
const sets = { ...listing.screenshots, ...((listing.mac && listing.mac.screenshots) || {}) };

let n = 0;
for (const [display, files] of Object.entries(sets)) {
  const kind = DISPLAY[display];
  if (!kind) { errors.push(`${display}: not a display type this check knows`); continue; }
  const S = STD[kind];
  for (const file of files) {
    n++;
    const f = path.join(dir, file);
    if (!fs.existsSync(f)) { errors.push(`${file}: missing`); continue; }
    const b = fs.readFileSync(f);
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20), depth = b[24], type = b[25];
    if (w !== S.size[0] || h !== S.size[1]) errors.push(`${file}: ${w} x ${h}, not ${S.size.join(' x ')}`);
    if (depth !== 8 || type !== 2) errors.push(`${file}: not an 8-bit RGB PNG without alpha (colour type ${type})`);
    if (!file.startsWith(kind + '-')) errors.push(`${file}: listed for ${display}, but not named ${kind}-<n>-<id>.png`);
    const m = byFile[file];
    if (!m) { errors.push(`${file}: not in measure.json (made with scripts/store-frames/store-frames.js?)`); continue; }
    const want = {
      'eyebrow size': [m.eyebrow.fontSize, S.eyebrow], 'headline size': [m.headline.fontSize, S.headline], 'subhead size': [m.subhead.fontSize, S.subhead],
      'eyebrow baseline': [m.eyebrowBaseline, S.baseline], 'headline top': [m.headline.top, S.headlineTop], 'subhead bottom': [m.subhead.bottom, S.subheadBottom], 'device top': [m.deviceTop, S.deviceTop],
      'headline lines': [m.headline.lines, S.lines],
    };
    for (const [k, [got, std]] of Object.entries(want)) if (got !== std) errors.push(`${file}: ${k} ${got}, the standard is ${std}`);
    if (m.headline.fontFamily !== 'Fraunces' || m.eyebrow.fontFamily !== 'Inter Store' || m.subhead.fontFamily !== 'Inter Store') errors.push(`${file}: not set in Fraunces and Inter`);
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`${n} App Store screenshots match the family standard (sizes, type and positions).`);
