// Package 3 acceptance: PDF/A-1b/2b/3b (and 2u, 3u, "1b-u"), PDF/X-1a/3/4, the document properties editor.
//
//   (cd desktop && npm ci) && python3 build.py && node tests/conformance/pkg3.mjs
//
// Needs: Playwright (npm install --no-save playwright@1.56.1) with Chromium, Java 11+, python3 with fonttools, pillow and
// pikepdf (pip install fonttools pillow pikepdf). It makes every input file itself (tests/conformance/fixtures.py
// and make-fixtures.mjs, from pinned npm font packages and the pinned pdf.js / pdf-lib in desktop/node_modules), opens
// each in the real app (index.html in Chromium), exports it through the app's own dialogs (File > Save as PDF/A…,
// Save as PDF/X…, Document properties and Save), then checks every output:
//   PDF/A   veraPDF (the greenfield CLI from Maven Central, $VERAPDF or downloaded into tests/conformance/.cache),
//           with the flavour of each file: 1b, 2b, 2u, 3b, 3u. Zero failed rules is a pass.
//   PDF/X   veraPDF does not validate PDF/X. tests/conformance/pdfx_check.py checks the key ISO 15930 requirements
//           instead (output intent GTS_PDFX with a destination profile, GTS_PDFXVersion, TrimBox/BleedBox/MediaBox,
//           Trapped, no encryption, fonts embedded, no RGB or transparency in X-1a, no 16-bit in X-3…). It is not a
//           certified PDF/X validator.
// Negative checks pass when the app shows its refusal and no file is saved.
// Prints a table, writes tests/conformance/out/pkg3-report.json, exits 1 if any check fails.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import os from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process'; import { createRequire } from 'node:module';
import { open as openApp, close, root } from '../harness.mjs';
import { makeFixtures } from './make-fixtures.mjs';
const require = createRequire(import.meta.url);
const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
const { PDFName, PDFDict, PDFArray, PDFStream, PDFRawStream, PDFNumber, PDFString, PDFHexString } = L, N = PDFName.of;
const here = path.join(root, 'tests/conformance'), cache = path.join(here, '.cache'), out = path.join(here, 'out');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(cache, { recursive: true });
const t0 = Date.now(), log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);

// ---------------------------------------------------------------- inputs: pinned fonts, veraPDF
const PINNED = [
  { name: '@expo-google-fonts/noto-sans-arabic', version: '0.4.3', file: '400Regular/NotoSansArabic_400Regular.ttf' },
  { name: '@expo-google-fonts/noto-emoji', version: '0.4.8', file: '400Regular/NotoEmoji_400Regular.ttf' },
];
async function npmFile({ name, version, file }) {
  const dir = path.join(cache, `${name.replace('/', '__')}@${version}`), f = path.join(dir, 'package', file);
  if (fs.existsSync(f)) return f;
  const meta = await (await fetch(`https://registry.npmjs.org/${name}/${version}`)).json();
  const tgz = Buffer.from(await (await fetch(meta.dist.tarball)).arrayBuffer());
  const [alg, want] = meta.dist.integrity.split('-');
  if (crypto.createHash(alg).update(tgz).digest('base64') !== want) throw new Error(`${name}@${version}: integrity check failed`);
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'p.tgz'), tgz);
  execFileSync('tar', ['xzf', path.join(dir, 'p.tgz'), '-C', dir]);
  return f;
}
const VERA = { version: '1.30.4', sha256: 'f00c4d2a18dd3af7e9450bc9ac6688726fc4acf1a9d97d52e3e992021e84f93e' };
async function veraJar() {
  if (process.env.VERAPDF && fs.existsSync(process.env.VERAPDF)) return process.env.VERAPDF;
  const f = path.join(cache, `verapdf-cli-${VERA.version}.jar`);
  if (!fs.existsSync(f)) {
    log('downloading veraPDF', VERA.version, 'from Maven Central');
    const b = Buffer.from(await (await fetch(`https://repo1.maven.org/maven2/org/verapdf/apps/cli/${VERA.version}/cli-${VERA.version}.jar`)).arrayBuffer());
    if (crypto.createHash('sha256').update(b).digest('hex') !== VERA.sha256) throw new Error('veraPDF jar: checksum mismatch');
    fs.writeFileSync(f, b);
  }
  return f;
}

// ---------------------------------------------------------------- the app
const results = []; // { id, check, sub, pass, detail, substitute }
const record = (id, check, sub, pass, detail = '', extra = {}) => { results.push({ id, check, sub, pass: !!pass, detail, ...extra }); log(pass ? 'ok  ' : 'FAIL', `${id} ${sub}`, detail ? '— ' + String(detail).slice(0, 300) : ''); };
let page = null;
async function app() {
  if (page) { try { await page.ctx.close(); } catch {} }
  page = await openApp(); return page;
}
async function openFile(p, file, name = path.basename(file)) {
  const bytes = fs.readFileSync(file);
  await p.evaluate(async ([b, n]) => { await window.__cowdreyPdf.openBytes(new Uint8Array(b), n); }, [Array.from(bytes), name]);
  await p.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 30000 });
  await p.waitForTimeout(400);
}
const run = (p, id) => p.evaluate((i) => { window.__cowdreyPdf.run(i); }, id);
const dlgTitle = (p) => p.textContent('#dialog h2').catch(() => '');
const dlgText = (p) => p.textContent('#dialog .dlg-body').catch(() => '');
// Exports through the dialogs. kind: { a: '2b', intent } or { x: '4' }. Returns { file?, dialogs: [{ title, text }] }.
// scripts: 'remove' answers the scripts question with "Remove and save"; otherwise it is cancelled.
async function exportVia(p, kind, name, { scripts = 'cancel', timeout = 180000 } = {}) {
  const dialogs = [];
  let dl = null; const onDl = (d) => { dl = d; }; p.on('download', onDl);
  try {
    if (kind.a) {
      await run(p, 'savePdfa'); await p.waitForSelector('#dialog[open] .pdfa-levels');
      await p.check(`#dialog [name="pdfaLevel"][value="${kind.a}"]`);
      await p.selectOption('#dialog [name="pdfaIntent"]', kind.intent || 'srgb');
    } else {
      await run(p, 'savePdfx'); await p.waitForSelector('#dialog[open] [name="pdfxKind"]');
      await p.check(`#dialog [name="pdfxKind"][value="${kind.x}"]`);
    }
    await p.click('#dialog .dlg-foot .btn.primary');
    const end = Date.now() + timeout; let idle = 0;
    await p.waitForTimeout(300);
    while (Date.now() < end) {
      if (dl) break;
      const open = await p.$('#dialog[open]');
      if (open) {
        const title = (await dlgTitle(p)).trim(), text = (await dlgText(p)).replace(/\s+/g, ' ').trim();
        if (!dialogs.length || dialogs[dialogs.length - 1].title !== title) dialogs.push({ title, text });
        if (title === 'Scripts and actions') { await p.click(`#dialog .dlg-foot button:has-text("${scripts === 'remove' ? 'Remove and save' : 'Cancel'}")`); if (scripts !== 'remove') break; }
        else if (/^Can't save as|^Not PDF\/[AX]/.test(title)) { await p.click(`#dialog .dlg-foot button:has-text("${/^Not/.test(title) ? 'Cancel' : (await p.$('#dialog .dlg-foot button:has-text("Cancel")')) ? 'Cancel' : 'OK'}")`); break; }
        else if (title === 'Attachments') { await p.click('#dialog .dlg-foot button:has-text("Cancel")'); break; }
        await p.waitForTimeout(300); continue;
      }
      if (!(await p.evaluate(() => window.__cowdreyPdf.pdfaIsBusy()))) { idle += 1; if (idle > 6) break; } else idle = 0;
      await p.waitForTimeout(250);
    }
    if (!dl) await p.waitForTimeout(1500); // a file that would still come
    if (!dl) return { dialogs };
    const f = path.join(out, name); await dl.saveAs(f);
    return { file: f, suggested: dl.suggestedFilename(), dialogs };
  } finally { p.off('download', onDl); }
}
// File > Save in the web app: a download of the whole document.
async function saveVia(p, name) {
  const [d] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), run(p, 'saveCopy')]);
  const f = path.join(out, name); await d.saveAs(f); await p.waitForTimeout(200); return f;
}

// ---------------------------------------------------------------- validators
function veraPdf(jar, flavour, files) {
  if (!files.length) return {};
  const r = spawnSync('java', ['-Xmx1500m', '-jar', jar, '--flavour', flavour, '--format', 'mrr', '--maxfailuresdisplayed', '3', ...files], { encoding: 'utf8', maxBuffer: 256 << 20, timeout: 900000 });
  const res = {};
  for (const job of (r.stdout || '').split('<job>').slice(1)) {
    const name = (/<name>([^<]+)<\/name>/.exec(job) || [])[1];
    const comp = /isCompliant="(true|false)"/.exec(job);
    const failed = [...job.matchAll(/<rule [^>]*clause="([^"]+)" testNumber="(\d+)" status="failed"[^>]*>\s*<description>([^<]*)/g)].map((m) => `${m[1]}-${m[2]}: ${m[3].trim().slice(0, 140)}`);
    const exc = /<exceptionMessage>([^<]*)/.exec(job) || /exception="([^"]*)"/.exec(job);
    if (name) res[path.resolve(name)] = { compliant: comp ? comp[1] === 'true' : false, failed, error: exc ? exc[1] : comp ? '' : 'no report' };
  }
  for (const f of files) if (!res[path.resolve(f)]) res[path.resolve(f)] = { compliant: false, failed: [], error: (r.stderr || r.stdout || 'veraPDF did not report').split('\n').filter((l) => !/JAVA_TOOL/.test(l)).slice(0, 5).join(' ') };
  return res;
}
function pdfxCheck(kind, file) {
  const r = spawnSync('python3', ['-I', path.join(here, 'pdfx_check.py'), kind, file], { encoding: 'utf8' });
  try { return JSON.parse(r.stdout); } catch { return { ok: false, failed: [{ rule: 'pdfx_check.py', problems: [(r.stderr || r.stdout).slice(0, 400)] }] }; }
}

// ---------------------------------------------------------------- go
const jar = await veraJar();
log('veraPDF:', jar);
const fontFiles = await Promise.all(PINNED.map(npmFile));
const assets = path.join(cache, 'assets');
execFileSync('python3', ['-I', path.join(here, 'fixtures.py'), assets, path.join(root, 'desktop/node_modules/pdfjs-dist/standard_fonts/FoxitSerif.pfb'), ...fontFiles], { stdio: 'inherit' });
const fx = await makeFixtures(assets, path.join(out, 'fixtures'));
log('fixtures:', Object.keys(fx).join(', '));

const A = [['1b', 'srgb'], ['2b', 'srgb'], ['2u', 'srgb'], ['3b', 'srgb'], ['3u', 'srgb']], X = ['1a', '3', '4'];
const pending = []; // files to validate: { file, flavour | pdfx, id, sub }
const want = (file, v, id, sub, then) => pending.push({ file, v, id, sub, then });

// 1-9. Positive profiles
const POS = [
  ['P3-01', 'PDF/A-1b: subsetted Type 1, JPEG, text annotation, link', 'a1b', { a: '1b' }],
  ['P3-02', 'PDF/A-2b: as 1b plus a CID (CJK) font', 'a2b', { a: '2b' }],
  ['P3-03', 'PDF/A-3b: as 2b plus an embedded file and a Form XObject', 'a3b', { a: '3b' }],
  ['P3-04', 'PDF/A-1b "u": one subsetted Unicode TrueType (Arabic + emoji), ToUnicode-mapped', 'a1bu', { a: '1b' }],
  ['P3-05', 'PDF/A-2u (2b-u): Chinese text and emoji', 'a2u', { a: '2u' }],
  ['P3-06', 'PDF/A-3u (3b-u): everything above combined', 'a3u', { a: '3u' }],
  ['P3-07', 'PDF/X-1a: CMYK-only content, no alpha, no RGB', 'x1a', { x: '1a' }],
  ['P3-08', 'PDF/X-3: RGB in an ICC profile, no alpha', 'x3', { x: '3' }],
  ['P3-09', 'PDF/X-4: a transparency object, every colour space', 'x4', { x: '4' }],
];
let p = await app();
for (const [id, check, f, kind] of POS) {
  await openFile(p, fx[f]);
  const r = await exportVia(p, kind, `${id}-${f}.pdf`);
  if (!r.file) { record(id, check, f, false, 'no file: ' + JSON.stringify(r.dialogs)); continue; }
  want(r.file, kind.a || 'x' + kind.x, id, `${f} → ${kind.a ? 'PDF/A-' + kind.a : 'PDF/X-' + kind.x}`);
}
// The same PDF/A inputs with Info /Trapped /False (reportlab, Distiller and PDF/X tools write it): pdf:Trapped must not
// reach a PDF/A packet without an extension schema.
for (const [id, , f, kind] of POS.filter((x) => x[3].a)) {
  p = await app(); await openFile(p, fx['trap-' + f]);
  const r = await exportVia(p, kind, `${id}-trap-${f}.pdf`);
  if (!r.file) { record(id, POS.find((x) => x[0] === id)[1], `${f} with Info /Trapped`, false, 'no file: ' + JSON.stringify(r.dialogs)); continue; }
  want(r.file, kind.a, id, `${f} with Info /Trapped /False → PDF/A-${kind.a}`);
}
// The repository's Word export (a CID TrueType font with an "ft" ligature glyph its ToUnicode map leaves out) as 2u
// and 3u: the mapping is found in the font's own ligature table.
for (const [id, a] of [['P3-05', '2u'], ['P3-06', '3u']]) {
  p = await app(); await openFile(p, path.join(root, 'tests/fixtures/word.pdf'));
  const r = await exportVia(p, { a }, `${id}-word-${a}.pdf`);
  if (!r.file) { record(id, POS.find((x) => x[0] === id)[1], `tests/fixtures/word.pdf → PDF/A-${a}`, false, 'no file: ' + JSON.stringify(r.dialogs)); continue; }
  want(r.file, a, id, `tests/fixtures/word.pdf (ligature glyph with no ToUnicode entry) → PDF/A-${a}`);
}
// Not a matrix row: a form whose field appearances use Helvetica (not embedded) with a /Differences encoding. PDF/A-1
// allows no Differences on a TrueType font, so the stand-in font is made symbolic there.
const FORM = 'Form fields (Helvetica, not embedded, with /Differences) as PDF/A-1b, 2b, 3b';
for (const [f, a] of [['form', '1b'], ['form', '2b'], ['form', '3b'], ['trap-form', '1b']]) {
  p = await app(); await openFile(p, fx[f]);
  const r = await exportVia(p, { a }, `P3-R1-${f}-${a}.pdf`);
  if (!r.file) { record('P3-R1', FORM, `${f} → PDF/A-${a}`, false, 'no file: ' + JSON.stringify(r.dialogs)); continue; }
  want(r.file, a, 'P3-R1', `${f} → PDF/A-${a}`);
}
// 10-13. Negatives: a clear refusal in the app, and no file
const NEG = [
  ['P3-10', 'RGB-only content as PDF/A-1b with a CMYK output intent → refused', 'neg-rgb', { a: '1b', intent: 'cmyk' }, /uses RGB colours/],
  ['P3-11', '16-bit deep colour as PDF/X-3 → refused', 'neg-16bit', { x: '3' }, /16 bits per colour/],
  ['P3-12', 'Alpha channel / transparency as PDF/X-1a → refused', 'neg-alpha', { x: '1a' }, /see-through objects \(transparency/],
  ['P3-13', 'Embedded JavaScript / actions as PDF/A-2b → refused', 'neg-js', { a: '2b' }, /JavaScript \(\d+ scripts?\)/],
];
for (const [id, check, f, kind, re] of NEG) {
  p = await app(); await openFile(p, fx[f]);
  const before = await p.evaluate(() => !!window.__lastPdfa);
  const r = await exportVia(p, kind, `${id}-${f}.pdf`);
  const shown = r.dialogs.find((d) => re.test(d.text));
  const after = await p.evaluate(() => !!window.__lastPdfa);
  record(id, check, f, !r.file && shown && before === after && !p.errors.length, shown ? `“${shown.title}”: ${shown.text.slice(0, 220)}${r.file ? ' — BUT A FILE WAS SAVED' : '; no file saved'}` : 'no refusal shown: ' + JSON.stringify(r.dialogs));
}
// the converter itself refuses too (no bytes), for the record
{
  const res = await p.evaluate(async (files) => {
    const o = {};
    for (const [k, b, opts] of files) { const r = await window.__cowdreyPdf.pdfaConvert(new Uint8Array(b), opts); o[k] = { blocked: r.blocked || null, bytes: !!r.bytes, why: (r.problems || []).map((x) => x.code).concat(r.text ? [r.text] : []) }; }
    return o;
  }, [['rgb', Array.from(fs.readFileSync(fx['neg-rgb'])), { part: 1, conformance: 'B', intent: 'cmyk' }], ['16bit', Array.from(fs.readFileSync(fx['neg-16bit'])), { pdfx: '3' }], ['alpha', Array.from(fs.readFileSync(fx['neg-alpha'])), { pdfx: '1a' }], ['js', Array.from(fs.readFileSync(fx['neg-js'])), { part: 2, conformance: 'B', scripts: 'refuse' }]]);
  log('converter refusals:', JSON.stringify(res));
}
// and once you agree to remove the scripts, the PDF/A-2b copy is clean
{ p = await app(); await openFile(p, fx['neg-js']); const r = await exportVia(p, { a: '2b' }, 'P3-13-after-remove.pdf', { scripts: 'remove' }); if (r.file) want(r.file, '2b', 'P3-13', 'after "Remove and save": the copy validates'); else record('P3-13', NEG[3][1], 'after "Remove and save"', false, 'no file'); }

// 14-17 document properties
const textOf = (d, v) => { const o = d.context.lookup(v); return o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : undefined; };
const infoOf = (d) => { const i = d.getInfoDict(), o = {}; for (const [k, v] of i.entries()) o[k.decodeText()] = textOf(d, v); return o; };
const xmpText = (d) => { const s = d.catalog.lookup(N('Metadata')); if (!s) return ''; return Buffer.from(s instanceof PDFRawStream ? L.decodePDFRawStream(s).decode() : s.getContents()).toString('utf8'); };
const load = async (f) => L.PDFDocument.load(fs.readFileSync(f), { updateMetadata: false });
// In the page: the XMP as a set of statements (property path = value), for comparing packets by meaning.
const triples = (p, xml) => p.evaluate((x) => {
  const s = x.slice(x.indexOf('<x:xmpmeta') >= 0 ? x.indexOf('<x:xmpmeta') : x.indexOf('<rdf:RDF'));
  const d = new DOMParser().parseFromString(s.slice(0, s.lastIndexOf('>') + 1).replace(/<\?xpacket[^>]*\?>\s*$/, ''), 'application/xml');
  const R = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#', outp = [];
  const walk = (el, pfx) => {
    const kids = [...el.children];
    if (!kids.length) { outp.push(`${pfx} = ${el.textContent.trim()}${el.getAttribute('xml:lang') ? ' @' + el.getAttribute('xml:lang') : ''}`); return; }
    kids.forEach((c, i) => walk(c, `${pfx}/${c.namespaceURI === R && c.localName === 'li' ? (el.localName === 'Seq' ? 'li' + i : 'li') : '{' + c.namespaceURI + '}' + c.localName}`));
  };
  for (const desc of d.getElementsByTagNameNS(R, 'Description')) {
    if (desc.parentNode.namespaceURI !== R || desc.parentNode.localName !== 'RDF') continue;
    for (const a of desc.attributes) if (a.namespaceURI && a.namespaceURI !== R && a.namespaceURI !== 'http://www.w3.org/2000/xmlns/') outp.push(`{${a.namespaceURI}}${a.localName} = ${a.value}`);
    for (const c of desc.children) walk(c, `{${c.namespaceURI}}${c.localName}`);
  }
  return outp.sort();
}, xml);
const VOLATILE = /^\{http:\/\/ns\.adobe\.com\/pdf\/1\.3\/\}Producer|^\{http:\/\/ns\.adobe\.com\/xap\/1\.0\/\}(ModifyDate|MetadataDate)|^\{http:\/\/ns\.adobe\.com\/xap\/1\.0\/mm\/\}InstanceID/;
async function props(p) { await run(p, 'docProps'); await p.waitForSelector('#dialog[open] .di'); return p; }
async function readProps(p) {
  await props(p);
  const v = await p.evaluate(() => { const o = {}; document.querySelectorAll('#dialog [data-di], #dialog [data-dx]').forEach((i) => { o[i.dataset.di || i.dataset.dx] = i.type === 'checkbox' ? i.checked : i.value; }); o.labels = [...document.querySelectorAll('#dialog .di-lrow')].map((r) => [r.querySelector('[data-lf]').value, r.querySelector('[data-ls]').value, r.querySelector('[data-lp]').value, r.querySelector('[data-ln]').value].join('|')); return o; });
  await p.click('#dialog .dlg-foot button:has-text("Cancel")'); await p.waitForTimeout(150);
  return v;
}
const done = async (p) => { await p.click('#dialog .dlg-foot button:has-text("Done")'); await p.waitForTimeout(250); };
const PRODUCER = /^Cowdrey\.PDF \d+\.\d+\.\d+ \(bradcowdrey\.com\)$/;
{
  // P3-14: every description field round-trips
  const id = 'P3-14', check = 'Doc-info: title, author, subject, keywords, creator, producer round-trip';
  p = await app(); await openFile(p, fx.docinfo, 'Annual.pdf');
  const set = { title: 'Rapport — final', author: 'Zoë Ångström; Bo Li', subject: 'Results, 2026 (audited)', keywords: 'finance; audit; ünïcode', creator: 'Writer 8.1', producer: 'Hand-set Producer 2.0' };
  await props(p);
  for (const k of ['title', 'author', 'subject', 'keywords']) await p.fill(`#dialog [data-di="${k}"]`, set[k]);
  for (const k of ['creator', 'producer']) await p.fill(`#dialog [data-dx="${k}"]`, set[k]);
  await done(p);
  const f1 = await saveVia(p, `${id}-saved.pdf`);
  const d1 = await load(f1), info = infoOf(d1), x = xmpText(d1);
  const fileOk = info.Title === set.title && info.Author === set.author && info.Subject === set.subject && info.Keywords === set.keywords && info.Creator === set.creator && info.Producer === set.producer;
  const xmpOk = x.includes(`<pdf:Producer>${set.producer}</pdf:Producer>`) && x.includes('Rapport — final') && x.includes('Writer 8.1') && x.includes('Rapport annuel 2026');
  // reopen the saved file in the app: the dialog shows exactly the same values
  p = await app(); await openFile(p, f1, 'Annual.pdf');
  const v = await readProps(p);
  const same = Object.entries(set).every(([k, val]) => v[k] === val);
  record(id, check, 'saved, reopened, identical', fileOk && xmpOk && same, `Info ${JSON.stringify({ Title: info.Title, Author: info.Author, Subject: info.Subject, Keywords: info.Keywords, Creator: info.Creator, Producer: info.Producer })}; XMP in step ${xmpOk}; dialog after reopening ${same ? 'identical' : JSON.stringify(v)}`);
  // P3-17b: the producer typed was used by that save; the next export writes the app's own again
  const f2 = await saveVia(p, `${id}-resaved.pdf`), d2 = await load(f2), info2 = infoOf(d2), x2 = xmpText(d2);
  const pdfa = await exportVia(p, { a: '2b' }, `${id}-resaved-pdfa.pdf`); const d3 = pdfa.file ? await load(pdfa.file) : null;
  record('P3-18', 'Doc-info: producer tag updated on every re-export', 're-export after a hand-set producer', info.Producer === set.producer && PRODUCER.test(info2.Producer) && x2.includes(`<pdf:Producer>${info2.Producer}</pdf:Producer>`) && d3 && PRODUCER.test(infoOf(d3).Producer), `save 1: ${info.Producer}; re-save: ${info2.Producer} (XMP ${/<pdf:Producer>([^<]*)/.exec(x2)?.[1]}); PDF/A re-export: ${d3 ? infoOf(d3).Producer : 'none'}`);
}
{
  // P3-15: creation and modification dates: settable, and the modification date updated on re-export
  const id = 'P3-15', check = 'Doc-info: creation and modification dates settable + ModDate auto-updated on re-export';
  p = await app(); await openFile(p, fx.docinfo, 'Annual.pdf');
  await props(p);
  await p.fill('#dialog [data-dx="created"]', '2020-01-02T03:04:05'); await p.fill('#dialog [data-dx="modified"]', '2021-02-03T04:05:06');
  await done(p);
  const f1 = await saveVia(p, `${id}-set.pdf`), d1 = await load(f1);
  const tz = await p.evaluate(() => new Date('2020-01-02T03:04:05').toISOString());
  const tzm = await p.evaluate(() => new Date('2021-02-03T04:05:06').toISOString());
  const c1 = d1.getCreationDate(), m1 = d1.getModificationDate(), x1 = xmpText(d1);
  const setOk = c1 && c1.toISOString() === tz && m1 && m1.toISOString() === tzm && x1.includes(tz.replace(/\.000Z$/, 'Z')) && x1.includes(tzm.replace(/\.000Z$/, 'Z'));
  p = await app(); await openFile(p, f1, 'Annual.pdf');
  const v = await readProps(p);
  // Done with the dialog untouched (its Modified field shows the file's date): not a change, so the save stamps now
  await props(p); await done(p);
  const before = Date.now();
  const f2 = await saveVia(p, `${id}-reexport.pdf`), d2 = await load(f2), c2 = d2.getCreationDate(), m2 = d2.getModificationDate(), x2 = xmpText(d2);
  const autoOk = c2 && c2.toISOString() === tz && m2 && +m2 >= Math.floor(before / 1000) * 1000 - 1000 && x2.includes(pdfaIsoNode(m2));
  record(id, check, 'set, saved, reopened, re-exported', setOk && v.created === '2020-01-02T03:04:05' && v.modified === '2021-02-03T04:05:06' && autoOk, `set: created ${c1 && c1.toISOString()}, modified ${m1 && m1.toISOString()} (XMP in step ${x1.includes(tzm.replace(/\.000Z$/, 'Z'))}); reopened dialog created ${v.created}, modified ${v.modified}; re-export: created ${c2 && c2.toISOString()}, modified ${m2 && m2.toISOString()} (now; XMP ModifyDate ${/<xmp:ModifyDate>([^<]*)/.exec(x2)?.[1]})`);
}
function pdfaIsoNode(d) { return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); }
{
  // P3-16: page labels i, ii, iii then 1, 2, 3
  const id = 'P3-16', check = 'Doc-info: page labels, Roman then Arabic (i, ii, iii, 1, 2, 3)';
  p = await app(); await openFile(p, fx.docinfo, 'Annual.pdf');
  await props(p); await p.click('#dialog [data-di-tab="view"]');
  await p.click('#dialog [data-ladd]'); await p.fill('#dialog .di-lrow:nth-child(1) [data-lf]', '1'); await p.selectOption('#dialog .di-lrow:nth-child(1) [data-ls]', 'r');
  await p.click('#dialog [data-ladd]'); await p.fill('#dialog .di-lrow:nth-child(2) [data-lf]', '4'); await p.selectOption('#dialog .di-lrow:nth-child(2) [data-ls]', 'D'); await p.fill('#dialog .di-lrow:nth-child(2) [data-ln]', '1');
  await p.dispatchEvent('#dialog .di-lrow:nth-child(2) [data-ln]', 'input');
  const preview = await p.textContent('#dialog [data-lpreview]');
  await done(p);
  const f1 = await saveVia(p, `${id}-labels.pdf`);
  const pdfjs = await import(path.join(root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
  const pd = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f1)), verbosity: 0 }).promise; const labels = await pd.getPageLabels(); await pd.loadingTask.destroy();
  p = await app(); await openFile(p, f1, 'Annual.pdf');
  const v = await readProps(p);
  const appLabels = await p.evaluate(async () => { const n = window.__cowdreyPdf.doc.pages.length, l = (await window.__cowdreyPdf.diMeta(0)).labels; return Array.from({ length: n }, (_, k) => window.__cowdreyPdf.diLabelOf(l, k + 1)); });
  const f2 = await saveVia(p, `${id}-resaved.pdf`);
  const pd2 = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f2)), verbosity: 0 }).promise; const labels2 = await pd2.getPageLabels(); await pd2.loadingTask.destroy();
  const wantL = ['i', 'ii', 'iii', '1', '2', '3'];
  record(id, check, 'set, saved, reopened, saved again', JSON.stringify(labels) === JSON.stringify(wantL) && JSON.stringify(appLabels) === JSON.stringify(wantL) && JSON.stringify(labels2) === JSON.stringify(wantL), `dialog preview “${preview}”; pdf.js reads ${JSON.stringify(labels)}; reopened in the app ${JSON.stringify(appLabels)} (ranges ${v.labels.join(' ; ')}); saved again ${JSON.stringify(labels2)}`);
}
{
  // P3-17: an untouched /Info and XMP packet are kept
  const id = 'P3-17', check = 'Doc-info: existing /Info dict + XMP packet preserved when untouched';
  p = await app(); await openFile(p, fx.docinfo, 'Annual.pdf');
  const f1 = await saveVia(p, `${id}-untouched.pdf`);
  const d0 = await load(fx.docinfo), d1 = await load(f1), i0 = infoOf(d0), i1 = infoOf(d1);
  const infoDiff = [...new Set([...Object.keys(i0), ...Object.keys(i1)])].filter((k) => i0[k] !== i1[k]);
  const x0 = xmpText(d0), x1 = xmpText(d1), t0 = await triples(p, x0), t1 = await triples(p, x1);
  const lost = t0.filter((s) => !t1.includes(s) && !VOLATILE.test(s)), added = t1.filter((s) => !t0.includes(s) && !VOLATILE.test(s));
  const volatile = t1.filter((s) => VOLATILE.test(s) && !t0.includes(s));
  const infoOk = infoDiff.every((k) => k === 'Producer' || k === 'ModDate');
  record(id, check, 'saved with no changes', infoOk && !lost.length && !added.length && x1.includes('<?xpacket begin='), `Info: ${infoDiff.length ? 'only ' + infoDiff.join(', ') + ' changed (each save stamps them)' : 'byte-identical values'}; XMP: ${t0.length} statements, ${lost.length} lost, ${added.length} added${lost.length ? ' LOST ' + lost.join(' | ') : ''}${added.length ? ' ADDED ' + added.join(' | ') : ''}; changed by the save: ${volatile.map((s) => s.replace(/^\{[^}]*\}/, '')).join(', ')}; XMP bytes ${x0 === x1 ? 'identical' : 'not byte-identical (re-serialised), semantically identical'}`);
}
{
  // P3-18a: the XMP packet is editable on its own in the dialog
  const id = 'P3-18', check = 'Doc-info: XMP packet individually editable';
  p = await app(); await openFile(p, fx.docinfo, 'Annual.pdf');
  await props(p); await p.click('#dialog [data-di-tab="xmp"]');
  const x0 = await p.inputValue('#dialog [data-dx="xmp"]');
  const x1 = x0.replace('<acme:ProjectCode>P-42</acme:ProjectCode>', '<acme:ProjectCode>P-43</acme:ProjectCode>').replace('Rapport annuel 2026', 'Rapport annuel 2026, version 2').replace('<photoshop:AuthorsPosition>Editor</photoshop:AuthorsPosition>', '<photoshop:AuthorsPosition>Chief editor</photoshop:AuthorsPosition>');
  await p.fill('#dialog [data-dx="xmp"]', x1); await done(p);
  const f1 = await saveVia(p, `${id}-xmp-edited.pdf`), d1 = await load(f1), xs = xmpText(d1), t1 = await triples(p, xs);
  const okEdits = xs.includes('P-43') && xs.includes('Rapport annuel 2026, version 2') && xs.includes('Chief editor') && !xs.includes('P-42');
  const kept = t1.some((s) => /Reviewers/.test(s) && /Bo/.test(s)) && xs.includes('© 2026 Example Ltd');
  p = await app(); await openFile(p, f1, 'Annual.pdf');
  await props(p); await p.click('#dialog [data-di-tab="xmp"]'); const again = await p.inputValue('#dialog [data-dx="xmp"]'); await p.click('#dialog .dlg-foot button:has-text("Cancel")');
  record(id, check, 'edited in the XMP tab, saved, reopened', okEdits && kept && again.includes('P-43') && PRODUCER.test(infoOf(d1).Producer) && xs.includes(`<pdf:Producer>${infoOf(d1).Producer}</pdf:Producer>`), `saved packet: P-43 ${xs.includes('P-43')}, fr title edited ${xs.includes('version 2')}, photoshop edited ${xs.includes('Chief editor')}, other properties kept ${kept}; producer written on this save: ${infoOf(d1).Producer}; reopened dialog shows the edit ${again.includes('P-43')}`);
}
// 19. Scale: 50 scanned pages
{
  const id = 'P3-19', check = 'Scale: 50-page scanned PDF, full export, memory reasonable';
  p = await app(); await openFile(p, fx.scan50, 'Scanned.pdf');
  const cdp = await p.ctx.newCDPSession(p); await cdp.send('Performance.enable');
  const heap0 = (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize').value;
  const rss = () => { let max = 0; for (const pid of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) { try { const c = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); if (!/--type=renderer/.test(c) || !/chrom/i.test(c)) continue; const m = /VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8')); if (m) max = Math.max(max, +m[1] * 1024); } catch {} } return max; };
  let peakHeap = heap0, peakRss = rss(); const rss0 = peakRss;
  const timer = setInterval(async () => { try { const h = (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize').value; peakHeap = Math.max(peakHeap, h); peakRss = Math.max(peakRss, rss()); } catch {} }, 50);
  const s = Date.now(); const r = await exportVia(p, { a: '2b' }, `${id}-scan50-2b.pdf`, { timeout: 600000 }); const secs = (Date.now() - s) / 1000;
  clearInterval(timer);
  const mb = (b) => (b / 1048576).toFixed(0) + ' MB', inMb = fs.statSync(fx.scan50).size;
  const pages = r.file ? (await load(r.file)).getPageCount() : 0;
  const okMem = peakHeap < 600 * 1048576 && peakRss < 1600 * 1048576;
  const scale = { seconds: secs, inputBytes: inMb, outputBytes: r.file ? fs.statSync(r.file).size : 0, jsHeapStart: heap0, jsHeapPeak: peakHeap, rendererRssStart: rss0, rendererRssPeak: peakRss };
  fs.writeFileSync(path.join(out, 'scale.json'), JSON.stringify(scale, null, 1));
  if (r.file && pages === 50 && okMem) want(r.file, '2b', id, `50 pages → PDF/A-2b in ${secs.toFixed(1)} s; input ${mb(inMb)}, output ${mb(scale.outputBytes)}; JS heap ${mb(heap0)} → peak ${mb(peakHeap)}; renderer RSS ${mb(rss0)} → peak ${mb(peakRss)} (limits 600 MB heap, 1600 MB RSS)`);
  else record(id, check, 'export', false, `file ${!!r.file}, pages ${pages}, heap peak ${mb(peakHeap)}, RSS peak ${mb(peakRss)} ${JSON.stringify(r.dialogs)}`);
}
// 20, 21. Blank page and annotations, every profile
const ALL = [...A.map(([a]) => ({ a })), ...X.map((x) => ({ x }))];
const kindName = (k) => (k.a ? 'PDF/A-' + k.a : 'PDF/X-' + k.x);
const annotsOf = async (f) => { const d = await load(f); const an = d.getPages()[0].node.lookup(N('Annots')); return (an ? an.asArray().map((r) => d.context.lookup(r)) : []).map((a) => { const g = (k) => { const v = a.lookup(N(k)); return v instanceof PDFArray ? v.asArray().map((x) => { const o = d.context.lookup(x); return o instanceof PDFNumber ? o.asNumber() : o instanceof PDFArray ? o.asArray().map((y) => d.context.lookup(y).asNumber()) : String(o); }) : v instanceof PDFNumber ? v.asNumber() : v ? textOf(d, v) ?? String(v) : null; }; return { sub: String(a.get(N('Subtype'))), nm: g('NM'), rect: g('Rect'), contents: g('Contents'), t: g('T'), quad: g('QuadPoints'), ink: g('InkList'), c: g('C'), f: g('F'), ap: !!a.lookup(N('AP')), popup: !!a.get(N('Popup')) || !!a.get(N('Parent')) }; }); };
const annBefore = await annotsOf(fx.annots);
for (const k of ALL) {
  p = await app(); await openFile(p, fx.blank, 'Blank.pdf');
  const r = await exportVia(p, k, `P3-20-blank-${k.a || 'x' + k.x}.pdf`);
  if (r.file) want(r.file, k.a || 'x' + k.x, 'P3-20', `blank page → ${kindName(k)}`); else record('P3-20', 'Single blank page, every profile', kindName(k), false, JSON.stringify(r.dialogs));
}
for (const k of ALL) {
  p = await app(); await openFile(p, fx['trap-blank'], 'Blank.pdf');
  const r = await exportVia(p, k, `P3-20-trap-blank-${k.a || 'x' + k.x}.pdf`);
  if (r.file) want(r.file, k.a || 'x' + k.x, 'P3-20', `blank page with Info /Trapped → ${kindName(k)}`); else record('P3-20', 'Single blank page, every profile', kindName(k) + ' (Trapped)', false, JSON.stringify(r.dialogs));
}
{
  p = await app(); await openFile(p, fx['trap-annots'], 'Annotations.pdf');
  const r = await exportVia(p, { a: '1b' }, 'P3-21-trap-annots-1b.pdf');
  if (r.file) want(r.file, '1b', 'P3-21', 'highlight + note + ink, Info /Trapped → PDF/A-1b'); else record('P3-21', 'Existing annotations kept by every profile', 'PDF/A-1b (Trapped)', false, JSON.stringify(r.dialogs));
}
for (const k of ALL) {
  p = await app(); await openFile(p, fx.annots, 'Annotations.pdf');
  const r = await exportVia(p, k, `P3-21-annots-${k.a || 'x' + k.x}.pdf`);
  if (!r.file) { record('P3-21', 'Existing annotations kept by every profile', kindName(k), false, JSON.stringify(r.dialogs)); continue; }
  const after = await annotsOf(r.file);
  const key = (a) => JSON.stringify([a.sub, a.nm, a.rect, a.contents, a.t, a.quad, a.ink, a.c, a.popup]);
  const same = annBefore.length === after.length && annBefore.every((a, i) => key(a) === key(after[i]));
  const flags = after.map((a, i) => `${a.sub.slice(1)} F ${annBefore[i] ? annBefore[i].f : '?'}→${a.f}`).join(', ');
  want(r.file, k.a || 'x' + k.x, 'P3-21', `highlight + note + ink → ${kindName(k)}: ${same ? `${after.length} annotations kept (subtype, NM, rect, contents, author, quads, ink, colour, popup)` : 'ANNOTATIONS CHANGED ' + JSON.stringify(after)}; ${flags}`, same);
}
await close();

// ---------------------------------------------------------------- validate
log('validating', pending.length, 'files');
const byV = {}; for (const x of pending) (byV[x.v] ||= []).push(x);
const vera = {};
for (const v of Object.keys(byV).filter((v) => !v.startsWith('x'))) { log('veraPDF', v, byV[v].length, 'files'); Object.assign(vera, veraPdf(jar, v, byV[v].map((x) => x.file))); }
const CHECKS = { 'P3-01': POS[0][1], 'P3-02': POS[1][1], 'P3-03': POS[2][1], 'P3-04': POS[3][1], 'P3-05': POS[4][1], 'P3-06': POS[5][1], 'P3-07': POS[6][1], 'P3-08': POS[7][1], 'P3-09': POS[8][1], 'P3-13': NEG[3][1], 'P3-19': 'Scale: 50-page scanned PDF, full export, memory reasonable', 'P3-20': 'Single blank page, every profile', 'P3-21': 'Existing annotations kept by every profile', 'P3-R1': FORM };
for (const x of pending) {
  if (x.v.startsWith('x')) {
    const r = pdfxCheck(x.v.slice(1), x.file);
    record(x.id, CHECKS[x.id], x.sub, r.ok && x.then !== false, `pdfx_check.py (ISO 15930 rules; veraPDF has no PDF/X profile): ${r.ok ? `all ${r.passed.length} rules pass` : 'FAILED ' + JSON.stringify(r.failed)}`, { validator: 'pdfx_check.py' });
  } else {
    const r = vera[path.resolve(x.file)] || { compliant: false, error: 'not validated' };
    record(x.id, CHECKS[x.id], x.sub, r.compliant && x.then !== false, `veraPDF ${VERA.version} --flavour ${x.v}: ${r.compliant ? 'compliant, 0 failed rules' : 'NOT compliant ' + (r.failed || []).join(' | ') + ' ' + (r.error || '')}`, { validator: 'veraPDF' });
  }
}

// ---------------------------------------------------------------- report
const ids = [...new Set(results.map((r) => r.id))].sort();
const rows = ids.map((id) => { const rs = results.filter((r) => r.id === id); return { id, check: rs.find((r) => r.check)?.check || '', pass: rs.every((r) => r.pass), n: rs.length, failed: rs.filter((r) => !r.pass).length, subs: rs }; });
console.log('\n' + '='.repeat(110) + '\nPACKAGE 3 — PDF/A · PDF/X · doc-info editor\n' + '='.repeat(110));
for (const r of rows) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.check}  (${r.n - r.failed}/${r.n})`);
  for (const s of r.subs) console.log(`        ${s.pass ? 'ok  ' : 'FAIL'} ${s.sub}${s.detail ? ' — ' + s.detail : ''}`);
}
const passed = rows.filter((r) => r.pass).length;
console.log(`\n${passed}/${rows.length} package 3 checks pass (${results.filter((r) => r.pass).length}/${results.length} sub-checks) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
fs.writeFileSync(path.join(out, 'pkg3-report.json'), JSON.stringify({ when: new Date().toISOString(), verapdf: VERA.version, rows: rows.map(({ subs, ...r }) => ({ ...r, subs: subs.map(({ id, check, ...s }) => s) })) }, null, 1));
process.exit(passed === rows.length ? 0 : 1);
