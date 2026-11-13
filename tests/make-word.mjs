// Makes tests/fixtures/word.pdf, a document like one saved from Word: fonts embedded as CID fonts (Carlito,
// metric-compatible with Calibri), coloured text, a tinted panel behind a line, a picture, and two comments made in
// "another app" (a sticky note and a square). Run once; the PDF is committed, since CI may not have the fonts.
import fs from 'node:fs'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PDFDocument, rgb, PDFName, PDFString } = require('../desktop/node_modules/pdf-lib');
const fontkit = require('../desktop/node_modules/@pdf-lib/fontkit');
const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
const F = '/usr/share/fonts/truetype/crosextra/';
const reg = await pdf.embedFont(fs.readFileSync(F + 'Carlito-Regular.ttf'), { subset: false });
const bold = await pdf.embedFont(fs.readFileSync(F + 'Carlito-Bold.ttf'), { subset: false });
const p = pdf.addPage([612, 792]);
p.drawText('Project Pelican: status report', { x: 72, y: 700, size: 26, font: bold, color: rgb(0.12, 0.23, 0.45) });
p.drawText('Prepared by the delivery team on 3 March.', { x: 72, y: 670, size: 12, font: reg, color: rgb(0.35, 0.35, 0.35) });
p.drawRectangle({ x: 66, y: 612, width: 480, height: 30, color: rgb(0.93, 0.95, 0.99) });
p.drawText('Budget: 42,000 dollars, on track.', { x: 76, y: 622, size: 14, font: bold, color: rgb(0.1, 0.1, 0.1) });
p.drawText('The second phase starts in April, after the pilot in two stores.', { x: 72, y: 580, size: 12, font: reg, color: rgb(0.1, 0.1, 0.1) });
const png = await pdf.embedPng(fs.readFileSync(new URL('../site/icon.png', import.meta.url)));
p.drawImage(png, { x: 400, y: 420, width: 120, height: 120 });
p.drawLine({ start: { x: 72, y: 400 }, end: { x: 540, y: 400 }, thickness: 2, color: rgb(0.6, 0.1, 0.2) });
const annot = (o) => { const r = pdf.context.register(pdf.context.obj(o)); let a = p.node.lookup(PDFName.of('Annots')); if (!a) { a = pdf.context.obj([]); p.node.set(PDFName.of('Annots'), a); } a.push(r); };
annot({ Type: 'Annot', Subtype: 'Text', Rect: [560, 690, 580, 710], Contents: PDFString.of('Please check the budget figure.'), T: PDFString.of('Reviewer'), C: [1, 0.8, 0.2], Name: 'Comment', F: 4 });
annot({ Type: 'Annot', Subtype: 'Square', Rect: [70, 570, 400, 596], C: [0.9, 0.1, 0.1], BS: { W: 2 }, Contents: PDFString.of('Confirm dates'), T: PDFString.of('Reviewer'), F: 4 });
pdf.setTitle('Project Pelican');
fs.writeFileSync(new URL('./fixtures/word.pdf', import.meta.url), await pdf.save());
console.log('tests/fixtures/word.pdf');
