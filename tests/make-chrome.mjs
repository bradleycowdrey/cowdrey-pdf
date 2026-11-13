// Makes tests/fixtures/chrome.pdf with Chrome's own PDF writer (as "Save as PDF" in Chrome does): subset TrueType
// fonts (Carlito and Caladea, metric-compatible with Calibri and Cambria), a heading, a serif paragraph and a coloured
// line. Run once; the PDF is committed, since CI may not have the fonts.
import fs from 'node:fs'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const F = '/usr/share/fonts/truetype/crosextra/';
const font = (fam, file, w) => `@font-face { font-family: ${fam}; src: url(data:font/ttf;base64,${fs.readFileSync(F + file).toString('base64')}); font-weight: ${w}; }`;
const html = `<style>${font('Body', 'Carlito-Regular.ttf', 400)}${font('Body', 'Carlito-Bold.ttf', 700)}${font('Serif', 'Caladea-Regular.ttf', 400)}
body { margin: 72px; font-family: Body; } h1 { font-size: 28px; color: #7E0B32; margin: 0 0 12px; } p { font-size: 15px; margin: 0 0 10px; }
.serif { font-family: Serif; font-size: 16px; } .note { color: #1F6F43; font-weight: 700; }</style>
<h1>Quarterly summary</h1><p>Revenue grew in every region this quarter.</p><p class="serif">Our thanks to the whole team for a strong finish.</p><p class="note">Next review: 14 June.</p>`;
const b = await pw.chromium.launch(); const p = await b.newPage();
await p.setContent(html); await p.evaluate(() => document.fonts.ready);
fs.writeFileSync(new URL('./fixtures/chrome.pdf', import.meta.url), await p.pdf({ format: 'Letter', printBackground: true }));
await b.close(); console.log('tests/fixtures/chrome.pdf');
