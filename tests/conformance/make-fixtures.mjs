// Builds the package 3 input PDFs with pdf-lib, from the files tests/conformance/fixtures.py made (fonts, pictures).
// makeFixtures(assetDir, outDir) -> { name: path }. Every file is made the same way each time (fixed dates and ids).
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
const fontkit = require(path.join(root, 'desktop/node_modules/@pdf-lib/fontkit'));
const { PDFDocument, PDFName, PDFString, PDFHexString, PDFNumber, PDFArray, PDFDict, PDFRawStream } = L, N = PDFName.of;
const FIXED = new Date('2026-03-04T05:06:07Z');

// The sRGB profile the app makes in code is not available here: this is a small ICC v2 sRGB profile written the same
// way (matrix/TRC), for the fixtures' own ICCBased colours.
function srgbIcc() {
  const s15 = (v) => Math.round(v * 65536) | 0, ascii = (t) => [...t].map((c) => c.charCodeAt(0));
  const block = (n, fill) => { const b = new Uint8Array(n); fill(new DataView(b.buffer), b); return b; };
  const xyz = (x, y, z) => block(20, (v, b) => { b.set(ascii('XYZ ')); v.setInt32(8, s15(x)); v.setInt32(12, s15(y)); v.setInt32(16, s15(z)); });
  const desc = (t) => block(12 + t.length + 1 + 4 + 4 + 2 + 1 + 67, (v, b) => { b.set(ascii('desc')); v.setUint32(8, t.length + 1); b.set(ascii(t), 12); });
  const text = (t) => block(8 + t.length + 1, (v, b) => { b.set(ascii('text')); b.set(ascii(t), 8); });
  const curv = block(14, (v, b) => { b.set(ascii('curv')); v.setUint32(8, 1); v.setUint16(12, 563); }); // gamma 2.2
  const tags = [['desc', desc('Fixture sRGB')], ['cprt', text('No copyright')], ['wtpt', xyz(0.9642, 1, 0.8249)], ['rXYZ', xyz(0.4361, 0.2225, 0.0139)], ['gXYZ', xyz(0.3851, 0.7169, 0.0971)], ['bXYZ', xyz(0.1431, 0.0606, 0.7141)], ['rTRC', curv], ['gTRC', curv], ['bTRC', curv]];
  let off = 128 + 4 + tags.length * 12; const at = [];
  for (const [, d] of tags) { at.push(off); off += Math.ceil(d.length / 4) * 4; }
  const icc = new Uint8Array(off), v = new DataView(icc.buffer);
  v.setUint32(0, off); v.setUint32(8, 0x02100000); icc.set(ascii('mntr'), 12); icc.set(ascii('RGB '), 16); icc.set(ascii('XYZ '), 20); icc.set(ascii('acsp'), 36);
  v.setInt32(68, s15(0.9642)); v.setInt32(72, s15(1)); v.setInt32(76, s15(0.8249)); v.setUint32(128, tags.length);
  tags.forEach(([t, d], i) => { icc.set(ascii(t), 132 + i * 12); v.setUint32(136 + i * 12, at[i]); v.setUint32(140 + i * 12, d.length); icc.set(d, at[i]); });
  return icc;
}

export async function makeFixtures(A, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const asset = (n) => fs.readFileSync(path.join(A, n));
  const t1 = JSON.parse(fs.readFileSync(path.join(A, 'type1.json'), 'utf8'));
  const texts = JSON.parse(fs.readFileSync(path.join(A, 'texts.json'), 'utf8'));
  const CJK = fs.readFileSync(path.join(root, 'tests/fixtures/fonts-cjk-sample.ttf'));
  const files = {};
  const W = (n) => { const m = []; for (let c = 32; c <= 126; c++) m.push(c); return m; };
  const WIN = { 32: 'space', 44: 'comma', 45: 'hyphen', 46: 'period', 47: 'slash', 58: 'colon', 48: 'zero', 49: 'one', 50: 'two', 51: 'three', 52: 'four', 53: 'five', 54: 'six', 55: 'seven', 56: 'eight', 57: 'nine' };
  const glyphOf = (c) => WIN[c] || (/[A-Za-z]/.test(String.fromCharCode(c)) ? String.fromCharCode(c) : null);
  const newDoc = async (title) => {
    const d = await PDFDocument.create({ updateMetadata: false }); d.registerFontkit(fontkit);
    d.setTitle(title); d.setAuthor('Cowdrey conformance fixtures'); d.setCreator('tests/conformance/make-fixtures.mjs'); d.setProducer('pdf-lib');
    d.setCreationDate(FIXED); d.setModificationDate(FIXED);
    const id = PDFHexString.of('00112233445566778899aabbccddeeff'); d.context.trailerInfo.ID = d.context.obj([id, id]);
    return d;
  };
  // pdf-lib names its font subsets "Name-1234": they get the usual subset tag (ABCDEF+Name), as other tools write them.
  const tagSubsets = (d) => {
    let k = 0;
    for (const [, o] of d.context.enumerateIndirectObjects()) {
      if (!(o instanceof PDFDict) || String(o.get(N('Subtype'))) !== '/Type0') continue;
      const tag = 'CWDR' + String.fromCharCode(65 + Math.floor(k / 26), 65 + (k % 26)); k++;
      const rename = (dict, key) => { const v = dict.get(N(key)); if (v instanceof PDFName && !/^[A-Z]{6}\+/.test(v.decodeText())) dict.set(N(key), N(`${tag}+${v.decodeText().replace(/-\d+$/, '')}`)); };
      rename(o, 'BaseFont');
      const cid = d.context.lookup(o.lookup(N('DescendantFonts')).get(0)); rename(cid, 'BaseFont');
      rename(cid.lookup(N('FontDescriptor')), 'FontName');
    }
  };
  const save = async (d, name) => { await d.flush(); tagSubsets(d); const f = path.join(outDir, name); fs.writeFileSync(f, await d.save({ useObjectStreams: false })); files[name.replace(/\.pdf$/, '')] = f; return f; };
  // a page's content: our own operators, with resources added to the page
  const draw = (d, page, ops) => { const s = d.context.flateStream(Buffer.from(ops, 'latin1')); const ref = d.context.register(s); const c = page.node.get(N('Contents')); if (!c) page.node.set(N('Contents'), d.context.obj([ref])); else { const arr = d.context.lookup(c); if (arr instanceof PDFArray) arr.push(ref); else page.node.set(N('Contents'), d.context.obj([c, ref])); } };
  const res = (page, kind, key, ref) => { const r = page.node.Resources(); let k = r.lookup(N(kind)); if (!k) { k = page.doc ? null : null; k = r.context ? null : null; } let dict = r.lookup(N(kind)); if (!(dict instanceof PDFDict)) { dict = page.node.context.obj({}); r.set(N(kind), dict); } dict.set(N(key), ref); };
  // ---- pieces
  const type1Font = (d) => {
    const prog = asset('type1.pfa');
    const ff = d.context.register(d.context.flateStream(prog, { Length1: t1.length1, Length2: t1.length2, Length3: t1.length3 }));
    const fd = d.context.register(d.context.obj({ Type: 'FontDescriptor', FontName: `CWDRYA+${t1.name}`, Flags: 34, FontBBox: t1.bbox, ItalicAngle: 0, Ascent: t1.bbox[3], Descent: t1.bbox[1], CapHeight: 662, StemV: 80, FontFile: ff }));
    const widths = W().map((c) => { const g = glyphOf(c); return g && t1.widths[g] != null ? t1.widths[g] : 0; });
    return d.context.register(d.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: `CWDRYA+${t1.name}`, FirstChar: 32, LastChar: 126, Widths: widths, Encoding: 'WinAnsiEncoding', FontDescriptor: fd }));
  };
  const pdfStr = (s) => '(' + s.replace(/[\\()]/g, (c) => '\\' + c) + ')';
  const addType1 = (d, page, y = 760, colour = '0 g') => { res(page, 'Font', 'FT1', type1Font(d)); draw(d, page, `BT /FT1 16 Tf ${colour} 50 ${y} Td ${pdfStr(t1.text)} Tj ET`); };
  const addJpeg = async (d, page, y = 520) => { const im = await d.embedJpg(asset('photo.jpg')); page.drawImage(im, { x: 50, y, width: 240, height: 150 }); };
  const addNote = (d, page) => { const a = d.context.register(d.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [320, 700, 340, 720], Contents: PDFHexString.fromText('A note for the archive'), T: PDFHexString.fromText('Fixture'), Name: 'Comment', C: [1, 0.83, 0.23], F: 4, NM: PDFString.of('fx-note') })); annot(d, page, a); };
  const addLink = (d, page) => { const a = d.context.register(d.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 740, 300, 756], Border: [0, 0, 0], A: d.context.obj({ Type: 'Action', S: 'URI', URI: PDFString.of('https://example.org/archive') }) })); annot(d, page, a); };
  const annot = (d, page, ref) => { let an = page.node.lookup(N('Annots')); if (!(an instanceof PDFArray)) { an = d.context.obj([]); page.node.set(N('Annots'), an); } an.push(ref); };
  const addCjk = async (d, page, y = 460, extra = '') => { const f = await d.embedFont(CJK, { subset: true }); page.drawText('中文测试汉字' + extra, { x: 50, y, size: 22, font: f }); };
  const addArabicEmoji = async (d, page, y = 420) => { const f = await d.embedFont(asset('arabic-emoji.ttf'), { subset: true }); page.drawText(texts.arabic, { x: 50, y, size: 22, font: f }); page.drawText(texts.emoji, { x: 50, y: y - 34, size: 22, font: f }); };
  const addEmoji = async (d, page, y = 380) => { const f = await d.embedFont(asset('emoji.ttf'), { subset: true }); page.drawText(texts.emoji, { x: 50, y, size: 22, font: f }); };
  const addAttachment = async (d) => { await d.attach(Buffer.from('<?xml version="1.0"?>\n<invoice number="2026-001"><total currency="EUR">120.00</total></invoice>\n'), 'invoice.xml', { mimeType: 'application/xml', description: 'The invoice data', creationDate: FIXED, modificationDate: FIXED }); };
  const addForm = (d, page) => {
    const fx = d.context.register(d.context.flateStream(Buffer.from('q 0.2 0.5 0.8 rg 0 0 160 60 re f 1 g BT /FT1 12 Tf 10 24 Td (Form XObject) Tj ET Q', 'latin1'), { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 160, 60], Resources: d.context.obj({ Font: d.context.obj({ FT1: type1Font(d) }) }) }));
    res(page, 'XObject', 'Fx1', fx); draw(d, page, 'q 1 0 0 1 340 520 cm /Fx1 Do Q');
  };
  const iccRef = (d) => d.context.register(d.context.flateStream(srgbIcc(), { N: 3 }));
  const rawImage = (d, { w, h, bpc = 8, cs, data, smask }) => { const dict = { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, BitsPerComponent: bpc, ColorSpace: cs }; if (smask) dict.SMask = smask; return d.context.register(d.context.flateStream(data, dict)); };
  const gradient = (w, h, n, bpc = 8) => { const b = Buffer.alloc(w * h * n * (bpc / 8)); let o = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < n; c++) { const v = ((x * (c + 1) + y * (3 - c)) * 97) % 256; if (bpc === 16) { b.writeUInt16BE(Math.min(65535, v * 256 + (x * 7) % 256), o); o += 2; } else b[o++] = v; } return b; };

  // ---- PDF/A-1b: Type 1 subset + JPEG + note + link
  const base = async (title, page = null) => { const d = await newDoc(title); const p = page || d.addPage([595, 842]); addType1(d, p); await addJpeg(d, p); addNote(d, p); addLink(d, p); return [d, p]; };
  { const [d] = await base('PDF/A-1b fixture'); await save(d, 'a1b.pdf'); }
  // ---- PDF/A-2b: + CID CJK font
  { const [d, p] = await base('PDF/A-2b fixture'); await addCjk(d, p); await save(d, 'a2b.pdf'); }
  // ---- PDF/A-3b: + an attachment and a Form XObject
  { const [d, p] = await base('PDF/A-3b fixture'); await addCjk(d, p); await addAttachment(d); addForm(d, p); await save(d, 'a3b.pdf'); }
  // ---- PDF/A-1b "u": one subsetted TrueType (Arabic + emoji), Unicode-mapped
  { const d = await newDoc('PDF/A-1b Unicode fixture'); const p = d.addPage([595, 842]); await addArabicEmoji(d, p, 700); await save(d, 'a1bu.pdf'); }
  // ---- PDF/A-2u: Chinese text, emoji
  { const d = await newDoc('PDF/A-2u fixture'); const p = d.addPage([595, 842]); await addCjk(d, p, 700); await addEmoji(d, p, 650); await save(d, 'a2u.pdf'); }
  // ---- PDF/A-3u: everything above
  { const [d, p] = await base('PDF/A-3u fixture'); await addCjk(d, p); await addArabicEmoji(d, p, 400); await addEmoji(d, p, 320); await addAttachment(d); addForm(d, p); await save(d, 'a3u.pdf'); }
  // ---- PDF/X-1a: CMYK only (CMYK fills, a CMYK picture, Type 1 text in black), no RGB, no transparency
  {
    const d = await newDoc('PDF/X-1a fixture'); const p = d.addPage([595, 842]);
    addType1(d, p, 760, '0 0 0 1 k');
    const im = rawImage(d, { w: 64, h: 48, cs: 'DeviceCMYK', data: gradient(64, 48, 4) }); res(p, 'XObject', 'ImC', im);
    draw(d, p, 'q 0.1 0.8 0.9 0 k 50 600 200 100 re f 0 0 0 0.6 K 4 w 300 600 200 100 re S Q q 240 0 0 180 50 380 cm /ImC Do Q q 0.5 g 300 380 120 80 re f Q');
    await save(d, 'x1a.pdf');
  }
  // ---- PDF/X-3: RGB in an ICC profile (fills and a picture), no transparency
  {
    const d = await newDoc('PDF/X-3 fixture'); const p = d.addPage([595, 842]);
    addType1(d, p, 760, '0 0 0 1 k');
    const icc = iccRef(d), cs = d.context.obj([N('ICCBased'), icc]);
    res(p, 'ColorSpace', 'CS0', cs);
    const im = rawImage(d, { w: 64, h: 48, cs, data: gradient(64, 48, 3) }); res(p, 'XObject', 'ImR', im);
    draw(d, p, 'q /CS0 cs 0.2 0.4 0.8 sc 50 600 200 100 re f /CS0 CS 0.9 0.1 0.1 SC 4 w 300 600 200 100 re S Q q 240 0 0 180 50 380 cm /ImR Do Q q 0 0 0 0.3 k 300 380 120 80 re f Q');
    await save(d, 'x3.pdf');
  }
  // ---- PDF/X-4: a transparency object, every kind of colour space (CMYK, grey, ICC RGB, Lab, a spot colour, device RGB)
  {
    const d = await newDoc('PDF/X-4 fixture'); const p = d.addPage([595, 842]);
    addType1(d, p, 760, '0 0 0 1 k');
    const ctx = d.context, icc = iccRef(d);
    const tint = ctx.register(ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 0.6, 1, 0], N: 1 }));
    res(p, 'ColorSpace', 'CSi', ctx.obj([N('ICCBased'), icc]));
    res(p, 'ColorSpace', 'CSl', ctx.obj([N('Lab'), ctx.obj({ WhitePoint: [0.9642, 1, 0.8249], Range: [-100, 100, -100, 100] })]));
    res(p, 'ColorSpace', 'CSs', ctx.obj([N('Separation'), N('Orange'), N('DeviceCMYK'), tint]));
    res(p, 'ExtGState', 'GSt', ctx.register(ctx.obj({ Type: 'ExtGState', ca: 0.5, CA: 0.5, BM: 'Multiply' })));
    const mask = rawImage(d, { w: 64, h: 48, cs: 'DeviceGray', data: gradient(64, 48, 1) });
    const im = rawImage(d, { w: 64, h: 48, cs: ctx.obj([N('ICCBased'), icc]), data: gradient(64, 48, 3), smask: mask }); res(p, 'XObject', 'ImA', im);
    draw(d, p, 'q 0.1 0.8 0.9 0 k 50 600 200 100 re f 0.4 g 300 600 200 100 re f /CSi cs 0.2 0.4 0.8 sc 50 480 120 80 re f /CSl cs 60 40 -30 sc 190 480 120 80 re f /CSs cs 1 sc 330 480 120 80 re f 0.1 0.6 0.3 rg 470 480 80 80 re f Q q /GSt gs 0 0.9 0.2 0 k 120 520 260 140 re f Q q 240 0 0 180 50 260 cm /ImA Do Q');
    await save(d, 'x4.pdf');
  }
  // ---- negatives
  { const d = await newDoc('RGB only'); const p = d.addPage([595, 842]); draw(d, p, 'q 0.9 0.2 0.1 rg 50 600 300 150 re f 0.1 0.3 0.9 RG 6 w 80 400 300 150 re S Q'); await addJpeg(d, p, 200); await save(d, 'neg-rgb.pdf'); }
  { const d = await newDoc('16-bit picture'); const p = d.addPage([595, 842]); const icc = iccRef(d); const im = rawImage(d, { w: 64, h: 48, bpc: 16, cs: d.context.obj([N('ICCBased'), icc]), data: gradient(64, 48, 3, 16) }); res(p, 'XObject', 'Im16', im); draw(d, p, 'q 320 0 0 240 50 400 cm /Im16 Do Q'); await save(d, 'neg-16bit.pdf'); }
  {
    const d = await newDoc('Alpha'); const p = d.addPage([595, 842]); const ctx = d.context;
    const mask = rawImage(d, { w: 64, h: 48, cs: 'DeviceGray', data: gradient(64, 48, 1) });
    const im = rawImage(d, { w: 64, h: 48, cs: 'DeviceCMYK', data: gradient(64, 48, 4), smask: mask }); res(p, 'XObject', 'ImA', im);
    res(p, 'ExtGState', 'GSa', ctx.register(ctx.obj({ Type: 'ExtGState', ca: 0.4 })));
    draw(d, p, 'q /GSa gs 0 0.8 0.8 0 k 50 600 300 150 re f Q q 320 0 0 240 50 300 cm /ImA Do Q'); await save(d, 'neg-alpha.pdf');
  }
  {
    const d = await newDoc('Scripts'); const p = d.addPage([595, 842]); const ctx = d.context; addType1(d, p);
    d.catalog.set(N('OpenAction'), ctx.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of('app.alert("hello")') }));
    d.catalog.set(N('Names'), ctx.obj({ JavaScript: ctx.obj({ Names: [PDFString.of('init'), ctx.register(ctx.obj({ S: 'JavaScript', JS: PDFString.of('var x = 1;') }))] }) }));
    p.node.set(N('AA'), ctx.obj({ O: ctx.obj({ S: 'JavaScript', JS: PDFString.of('this.print()') }) }));
    annot(d, p, ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 600, 250, 630], Border: [0, 0, 0], A: ctx.obj({ S: 'Launch', F: PDFString.of('calc.exe') }) })));
    await save(d, 'neg-js.pdf');
  }
  // ---- one blank page
  { const d = await newDoc('Blank'); d.addPage([595, 842]); await save(d, 'blank.pdf'); }
  // ---- highlight + note + ink, as Acrobat writes them (appearances included; the highlight multiplies)
  {
    const d = await newDoc('Annotations'); const p = d.addPage([595, 842]); const ctx = d.context; addType1(d, p, 700);
    const ap = (ops, bbox, resources = {}) => ctx.register(ctx.flateStream(Buffer.from(ops, 'latin1'), { Type: 'XObject', Subtype: 'Form', BBox: bbox, Resources: ctx.obj(resources) }));
    const hlAp = ap('/GS0 gs 1 1 0 rg 48 696 300 20 re f', [48, 696, 348, 716], { ExtGState: ctx.obj({ GS0: ctx.obj({ Type: 'ExtGState', BM: 'Multiply' }) }) });
    const hl = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: [48, 696, 348, 716], QuadPoints: [48, 716, 348, 716, 48, 696, 348, 696], C: [1, 1, 0], CA: 1, F: 4, Contents: PDFHexString.fromText('Highlighted'), T: PDFHexString.fromText('Reviewer'), NM: PDFString.of('fx-hl'), AP: ctx.obj({ N: hlAp }) }));
    const pop = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [360, 600, 560, 700], Parent: hl, Open: false, F: 28 }));
    ctx.lookup(hl).set(N('Popup'), pop);
    const noteAp = ap('q 1 0.83 0.23 rg 0.3 G 0.5 w 0.5 0.5 19 19 re B Q', [0, 0, 20, 20]);
    const note = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [400, 650, 420, 670], Contents: PDFHexString.fromText('Check this'), T: PDFHexString.fromText('Reviewer'), Name: 'Comment', C: [1, 0.83, 0.23], F: 28, NM: PDFString.of('fx-note'), AP: ctx.obj({ N: noteAp }) }));
    const inkAp = ap('q 0 0 1 RG 2 w 1 J 1 j 100 500 m 150 560 l 200 500 l 250 560 l S Q', [98, 498, 252, 562]);
    const ink = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Ink', Rect: [98, 498, 252, 562], InkList: [[100, 500, 150, 560, 200, 500, 250, 560]], C: [0, 0, 1], BS: ctx.obj({ W: 2 }), F: 4, T: PDFHexString.fromText('Reviewer'), NM: PDFString.of('fx-ink'), AP: ctx.obj({ N: inkAp }) }));
    for (const a of [hl, pop, note, ink]) annot(d, p, a);
    await save(d, 'annots.pdf');
  }
  // ---- 50 scanned pages (a grey JPEG each)
  {
    const d = await newDoc('Scanned, 50 pages');
    for (let n = 1; n <= 50; n++) { const im = await d.embedJpg(asset(`scan-${String(n).padStart(2, '0')}.jpg`)); const p = d.addPage([595.28, 841.89]); p.drawImage(im, { x: 0, y: 0, width: 595.28, height: 841.89 }); }
    await save(d, 'scan50.pdf');
  }
  // ---- document properties: a full Info dictionary, a rich XMP packet, six pages
  {
    const d = await newDoc('Annual report 2026'); d.setSubject('The year in review'); d.getInfoDict().set(N('Keywords'), PDFHexString.fromText('report, annual, 2026')); d.setCreator('Writer 7'); d.setProducer('Some Producer 1.0');
    d.getInfoDict().set(N('Department'), PDFHexString.fromText('Finance & Ops'));
    for (let i = 0; i < 6; i++) { const p = d.addPage([595, 842]); addType1(d, p, 700); }
    const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Fixture XMP 1.0">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:acme="http://example.org/acme/1.0/">
<dc:format>application/pdf</dc:format>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Annual report 2026</rdf:li><rdf:li xml:lang="fr">Rapport annuel 2026</rdf:li></rdf:Alt></dc:title>
<dc:creator><rdf:Seq><rdf:li>Cowdrey conformance fixtures</rdf:li></rdf:Seq></dc:creator>
<dc:description><rdf:Alt><rdf:li xml:lang="x-default">The year in review</rdf:li></rdf:Alt></dc:description>
<dc:subject><rdf:Bag><rdf:li>report</rdf:li><rdf:li>annual</rdf:li><rdf:li>2026</rdf:li></rdf:Bag></dc:subject>
<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">© 2026 Example Ltd</rdf:li></rdf:Alt></dc:rights>
<xmp:CreatorTool>Writer 7</xmp:CreatorTool><xmp:CreateDate>2026-03-04T05:06:07Z</xmp:CreateDate><xmp:ModifyDate>2026-03-04T05:06:07Z</xmp:ModifyDate><xmp:MetadataDate>2026-03-04T05:06:07Z</xmp:MetadataDate>
<pdf:Producer>Some Producer 1.0</pdf:Producer><pdf:Keywords>report, annual, 2026</pdf:Keywords>
<xmpMM:DocumentID>uuid:6f1c2b9e-1111-4222-8333-944455556666</xmpMM:DocumentID><xmpMM:InstanceID>uuid:6f1c2b9e-1111-4222-8333-944455556667</xmpMM:InstanceID>
<xmpRights:Marked>True</xmpRights:Marked><photoshop:AuthorsPosition>Editor</photoshop:AuthorsPosition>
<acme:ProjectCode>P-42</acme:ProjectCode><acme:Reviewers><rdf:Bag><rdf:li>Ana</rdf:li><rdf:li>Bo</rdf:li></rdf:Bag></acme:Reviewers>
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
    d.catalog.set(N('Metadata'), d.context.register(d.context.stream(Buffer.from(xmp, 'utf8'), { Type: 'Metadata', Subtype: 'XML' })));
    await save(d, 'docinfo.pdf');
  }
  // ---- a form as reportlab writes one: a text field and a check box whose appearances use Helvetica, not embedded,
  // with a PDFDocEncoding-like /Differences encoding (codes 24-31 and 128-160 differ from WinAnsi)
  {
    const d = await newDoc('Form'); const p = d.addPage([595, 842]); const ctx = d.context; addType1(d, p, 780);
    const diffs = [24, 'breve', 'caron', 'circumflex', 'dotaccent', 'hungarumlaut', 'ogonek', 'ring', 'tilde', 39, 'quotesingle', 96, 'grave', 128, 'bullet', 'dagger', 'daggerdbl', 'ellipsis', 'emdash', 'endash', 'florin', 'fraction', 'guilsinglleft', 'guilsinglright', 'minus', 'perthousand', 'quotedblbase', 'quotedblleft', 'quotedblright', 'quoteleft', 'quoteright', 'quotesinglbase', 'trademark', 'fi', 'fl', 'Lslash', 'OE', 'Scaron', 'Ydieresis', 'Zcaron', 'dotlessi', 'lslash', 'oe', 'scaron', 'zcaron', 160, 'Euro'];
    const helv = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Name: 'Helv', Encoding: ctx.obj({ Type: 'Encoding', Differences: diffs.map((x) => (typeof x === 'number' ? PDFNumber.of(x) : N(x))) }) }));
    const zadb = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'ZapfDingbats', Name: 'ZaDb' }));
    const ap = (ops, bbox, font) => ctx.register(ctx.flateStream(Buffer.from(ops, 'latin1'), { Type: 'XObject', Subtype: 'Form', BBox: bbox, Resources: ctx.obj({ Font: ctx.obj(font) }) }));
    const txAp = ap('/Tx BMC q 0.8 0.8 1 rg 0 0 200 20 re f 0 G 1 w 0.5 0.5 199 19 re S BT /Helv 12 Tf 0 g 3 5 Td (Ada \\200 Lovelace) Tj ET Q EMC', [0, 0, 200, 20], { Helv: helv });
    const onAp = ap('q 0 G 1 w 0.5 0.5 19 19 re S BT /Helv 14 Tf 0 g 4 4 Td (X) Tj ET Q', [0, 0, 20, 20], { Helv: helv });
    const offAp = ap('q 0 G 1 w 0.5 0.5 19 19 re S Q', [0, 0, 20, 20], {});
    const tx = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('name'), V: PDFHexString.fromText('Ada • Lovelace'), DA: PDFString.of('/Helv 12 Tf 0 g'), Rect: [100, 700, 300, 720], F: 4, P: p.ref, MK: ctx.obj({ BG: [0.8, 0.8, 1] }), AP: ctx.obj({ N: txAp }) }));
    const cb = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Btn', T: PDFString.of('agree'), V: 'Yes', AS: 'Yes', DA: PDFString.of('/ZaDb 0 Tf 0 g'), Rect: [100, 660, 120, 680], F: 4, P: p.ref, AP: ctx.obj({ N: ctx.obj({ Yes: onAp, Off: offAp }) }) }));
    annot(d, p, tx); annot(d, p, cb);
    d.catalog.set(N('AcroForm'), ctx.obj({ Fields: [tx, cb], DA: PDFString.of('/Helv 0 Tf 0 g'), DR: ctx.obj({ Font: ctx.obj({ Helv: helv, ZaDb: zadb }) }) }));
    await save(d, 'form.pdf');
  }
  // ---- Info /Trapped /False, as reportlab, Distiller and PDF/X tools write it: copies of the PDF/A inputs
  for (const n of ['a1b', 'a2b', 'a3b', 'a1bu', 'a2u', 'a3u', 'blank', 'annots', 'form']) {
    const d = await PDFDocument.load(fs.readFileSync(files[n]), { updateMetadata: false });
    d.getInfoDict().set(N('Trapped'), N('False'));
    const f = path.join(outDir, `trap-${n}.pdf`); fs.writeFileSync(f, await d.save({ useObjectStreams: false })); files[`trap-${n}`] = f;
  }
  return files;
}
