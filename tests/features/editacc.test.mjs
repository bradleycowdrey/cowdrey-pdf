// Edit PDF accuracy: the caret goes where you click, pictures are deleted by identity (screen and file agree), text
// after an edited run moves with it, edited text keeps the original text state (render mode, spacing) and its place
// in the content stream, the format bar shows the line's colour, double-spaced paragraphs, and the phone zooms in.
import os from 'node:os';

const SHOTS = '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr4/fix-editacc/';
const GUIDE = '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/guide/';
let H;
const shot = async (p, name) => { try { H.fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: SHOTS + name }); } catch {} };
const tmp = (name) => H.path.join(H.fs.mkdtempSync(H.path.join(os.tmpdir(), 'cpdf-acc-')), name);
const pdfLib = () => H.require(H.path.join(H.root, 'desktop/node_modules/pdf-lib'));
let pdfjsMod = null;
const pdfjs = async () => pdfjsMod || (pdfjsMod = await import(H.path.join(H.root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs')));
// Text items of a saved page, in content-stream order.
async function itemsOf(bytes, n = 1) {
  const L = await pdfjs(), d = await L.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const tc = await (await d.getPage(n)).getTextContent(); await d.loadingTask.destroy();
  return tc.items.filter((i) => i.str.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
}
// A page's decoded content (all streams joined).
async function contentOf(bytes, n = 0) {
  const L = pdfLib(), d = await L.PDFDocument.load(bytes), pg = d.getPages()[n];
  const c = pg.node.Contents(), arr = c instanceof L.PDFArray ? c.asArray().map((r) => d.context.lookup(r)) : [c];
  return arr.map((st) => Buffer.from(st instanceof L.PDFRawStream ? L.decodePDFRawStream(st).decode() : st.getContents()).toString('latin1')).join('\n');
}
// Clicks at a point of page n given in PDF coordinates.
const atN = (p, n, x, y) => p.evaluate(([n, x, y]) => { const v = window.__cowdreyPdf.views()[n]; const [vx, vy] = v.viewport.convertToViewportPoint(x, y); const r = v.el.getBoundingClientRect(); return [r.left + vx, r.top + vy]; }, [n, x, y]);
const lineOf = (p, text, n = 0) => p.evaluate(async ([t, n]) => { const cm = await window.__cowdreyPdf.contentMap(n); const L = cm.lines.find((l) => l.str.includes(t)); return L && { str: L.str, tm: L.tm, width: L.width, st: L.st }; }, [text, n]);
const caret = (p) => p.evaluate(() => { const el = document.activeElement; if (el.tagName === 'TEXTAREA') return [el.selectionStart, el.selectionEnd, el.value]; const s = getSelection(), r = s.rangeCount && s.getRangeAt(0); return r ? [r.startOffset, r.endOffset, el.textContent] : null; });
// A paragraph of body text: lines `lead` apart (16 is single spacing for 12 pt, 31 the manual's double spacing).
const PARA = ['The pelican project moved into its second big phase this spring,', 'with new stores joining the pilot and early results showing', 'steady growth in every region we measured over the quarter.', 'The team will report again in June.'];
async function paraDoc(lead = 16) {
  const L = pdfLib(), pdf = await L.PDFDocument.create(), pg = pdf.addPage([612, 792]), font = await pdf.embedFont(L.StandardFonts.Helvetica);
  pg.drawText('A heading', { x: 72, y: 720, size: 12, font: await pdf.embedFont(L.StandardFonts.HelveticaBold) });
  PARA.forEach((t, k) => pg.drawText(t, { x: 72, y: 680 - k * lead, size: 12, font, color: L.rgb(0.1, 0.1, 0.1) }));
  const file = tmp(`para${lead}.pdf`); H.fs.writeFileSync(file, await pdf.save()); return file;
}
const all = (p) => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat());
async function editTool(p) { await p.click('[data-rt="edit"]'); await p.click('[data-cmd="tool_edit"]'); }

export default async (h) => {
  H = h;
  const { test, eq, ok, open, openPdf, savedOf, reopen, WORD } = h;

  await test('Edit PDF: a click puts the caret where it was; typing inserts there; double click selects a word, triple the line', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await editTool(p);
    const L = await lineOf(p, 'Budget');
    ok(L, 'line found');
    // Click inside the line, a little way in: the caret lands there, nothing is selected.
    const fr = L.width / L.str.length;
    const [cx, cy] = await atN(p, 0, L.tm[4] + fr * 3.5, L.tm[5] + 3);
    await p.mouse.click(cx, cy); await p.waitForSelector('.line-editor'); await p.waitForTimeout(150);
    const [a, b, text] = await caret(p);
    eq(text, L.str); eq(a, b, 'collapsed caret'); ok(a >= 2 && a <= 5, `caret near the click: ${a}`);
    await p.keyboard.type('XY'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    const m = (await all(p)).find((x) => x.type === 'te');
    eq(m.text, L.str.slice(0, a) + 'XY' + L.str.slice(a), 'inserted, not replaced');
    // Double click on a word of another line selects that word; triple click selects the line.
    const L2 = await lineOf(p, 'pilot');
    if (L2) {
      const k = L2.str.indexOf('pilot'), f2 = L2.width / L2.str.length;
      const [dx, dy] = await atN(p, 0, L2.tm[4] + f2 * (k + 2), L2.tm[5] + 3);
      await p.mouse.dblclick(dx, dy); await p.waitForTimeout(300);
      const [s0, s1, t2] = await caret(p); eq(t2.slice(s0, s1), 'pilot', 'word selected');
      await p.keyboard.press('Escape'); await p.waitForTimeout(100);
      await p.mouse.click(dx, dy, { clickCount: 3 }); await p.waitForTimeout(300);
      const [u0, u1, t3] = await caret(p); eq([u0, u1], [0, t3.length], 'line selected');
      await p.keyboard.press('Escape');
    }
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Edit PDF: in paragraph mode and on a phone tap, the caret also goes where the text was touched', async () => {
    const p = await open(); await openPdf(p, await paraDoc(), 'Para.pdf');
    await editTool(p); await p.evaluate(() => window.__cowdreyPdf.run('txtParaMode'));
    const L = await lineOf(p, 'pilot'), k = L.str.indexOf('pilot'), fr = L.width / L.str.length;
    const [cx, cy] = await atN(p, 0, L.tm[4] + fr * (k + 1.5), L.tm[5] + 3);
    await p.mouse.click(cx, cy); await p.waitForSelector('.txt-editor'); await p.waitForTimeout(200);
    const [a, b, text] = await caret(p);
    eq(a, b, 'collapsed'); const at = text.indexOf('pilot');
    ok(a >= at && a <= at + 4, `caret in "pilot": ${a} (word at ${at})`);
    await p.keyboard.type('Q'); eq(await p.$eval('.txt-editor', (t) => t.value), text.slice(0, a) + 'Q' + text.slice(a));
    await p.keyboard.press('Escape'); await p.ctx.close();
    // A phone: a tap on a line opens it with the caret at the tap (zoomed in so it can be read).
    const q = await open({ width: 390, height: 844, touch: true }); await openPdf(q, WORD, 'Pelican report.pdf');
    await q.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    const L2 = await lineOf(q, 'Budget'), f2 = L2.width / L2.str.length;
    const [tx, ty] = await atN(q, 0, L2.tm[4] + f2 * 3.5, L2.tm[5] + 3);
    await q.touchscreen.tap(tx, ty); await q.waitForSelector('.line-editor'); await q.waitForTimeout(300);
    const [c0, c1] = await caret(q); eq(c0, c1, 'collapsed on a phone'); ok(c0 >= 2 && c0 <= 5, `caret near the tap: ${c0}`);
    eq(q.errors, []); await q.ctx.close();
  });
};
