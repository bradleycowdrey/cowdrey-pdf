// Makes tests/fixtures/sample.pdf: three pages of text, a heading, an outline-free form with a text field and a checkbox.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb, PDFName } = require('../desktop/node_modules/pdf-lib');
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const form = pdf.getForm();
for (let n = 1; n <= 3; n++) {
  const p = pdf.addPage([612, 792]);
  p.drawText(`Quarterly report, page ${n}`, { x: 72, y: 700, size: 24, font: bold, color: rgb(.1, .14, .2) });
  const body = 'Cowdrey.PDF opens this page, finds the word pelican, and keeps every highlight in place.';
  p.drawText(body, { x: 72, y: 660, size: 12, font });
  p.drawText(`The pelican count on page ${n} is ${n * 7}.`, { x: 72, y: 640, size: 12, font });
  if (n === 1) {
    p.drawText('Name:', { x: 72, y: 590, size: 12, font });
    const tf = form.createTextField('name'); tf.addToPage(p, { x: 120, y: 582, width: 200, height: 22 });
    const cb = form.createCheckBox('agree'); cb.addToPage(p, { x: 72, y: 550, width: 16, height: 16 });
    p.drawText('I agree', { x: 96, y: 553, size: 12, font });
  }
}
pdf.setTitle('Quarterly report');
fs.mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./fixtures/sample.pdf', import.meta.url), await pdf.save());
console.log('tests/fixtures/sample.pdf');
// The same PDF, protected with the password "pelican", with copying and changes not allowed (made with @cantoo/pdf-lib, which the app saves with).
const C = require('../desktop/node_modules/@cantoo/pdf-lib');
const prot = await C.PDFDocument.load(fs.readFileSync(new URL('./fixtures/sample.pdf', import.meta.url)));
prot.encrypt({ userPassword: 'pelican', ownerPassword: 'pelican-owner', permissions: { printing: 'highResolution', copying: false, modifying: false, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: false } });
fs.writeFileSync(new URL('./fixtures/protected.pdf', import.meta.url), await prot.save());
console.log('tests/fixtures/protected.pdf');
// A PDF with content structures that are easy to get wrong when editing (tests/fixtures/tricky.pdf):
// a regular word followed by a bold one on the same line, lines broken with the ' operator, and the page's
// content stored as a reference to an array of streams.
{
  const t = await PDFDocument.create();
  const reg = await t.embedFont(StandardFonts.Helvetica), bold = await t.embedFont(StandardFonts.HelveticaBold);
  const pg = t.addPage([612, 792]);
  pg.node.setFontDictionary(PDFName.of('F1'), reg.ref); pg.node.setFontDictionary(PDFName.of('F2'), bold.ref);
  const w = reg.widthOfTextAtSize('Hello ', 12);
  const s1 = t.context.register(t.context.stream(`BT /F1 12 Tf 1 0 0 1 72 700 Tm (Hello ) Tj ET BT /F2 12 Tf 1 0 0 1 ${(72 + w).toFixed(2)} 700 Tm (world) Tj ET`));
  const s2 = t.context.register(t.context.stream('BT /F1 12 Tf 14 TL 72 650 Td (Line one) Tj (Line two) \' (Line three) \' ET'));
  pg.node.set(PDFName.of('Contents'), t.context.register(t.context.obj([s1, s2])));
  fs.writeFileSync(new URL('./fixtures/tricky.pdf', import.meta.url), await t.save({ useObjectStreams: false }));
  console.log('tests/fixtures/tricky.pdf');
}
