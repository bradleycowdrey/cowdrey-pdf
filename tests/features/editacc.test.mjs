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
// A solid-colour PNG, w x h.
import zlib from 'node:zlib';
function png(w, h, [r, g, b]) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), cr = Buffer.alloc(4); len.writeUInt32BE(data.length); cr.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// As the brochure's background: a form XObject draws a picture, then the same picture again clipped to nothing
// (0 0 1 1 re W n); a second, small picture sits on the page itself; text on top.
async function clippedDoc() {
  const L = pdfLib(), { PDFOperator: Op, PDFNumber: Num } = L, O = (n, a = []) => Op.of(n, a.map((x) => (typeof x === 'number' ? Num.of(x) : x)));
  const inner = await L.PDFDocument.create(), ip = inner.addPage([300, 300]);
  const img = await inner.embedPng(png(16, 16, [40, 110, 230])), name = ip.node.newXObject('Im', img.ref);
  ip.pushOperators(O('q'), O('cm', [300, 0, 0, 300, 0, 0]), O('Do', [name]), O('Q'), O('q'), O('re', [0, 0, 1, 1]), O('W'), O('n'), O('cm', [300, 0, 0, 300, 0, 0]), O('Do', [name]), O('Q'));
  const pdf = await L.PDFDocument.create(), p = pdf.addPage([400, 400]), font = await pdf.embedFont(L.StandardFonts.Helvetica);
  p.drawPage(await pdf.embedPage((await L.PDFDocument.load(await inner.save())).getPage(0)), { x: 50, y: 50 });
  p.drawImage(await pdf.embedPng(png(8, 8, [230, 60, 40])), { x: 300, y: 20, width: 60, height: 20 });
  p.drawText('Page text on top', { x: 80, y: 200, size: 18, font, color: L.rgb(0, 0, 0) });
  const file = tmp('clipped.pdf'); H.fs.writeFileSync(file, await pdf.save()); return file;
}
// Text with its own text state: faux bold (2 Tr with a 0.8 line width, blue fill and stroke), character spacing,
// word spacing and a 90% width; then two plain lines, all in reading order.
async function stateDoc() {
  const L = pdfLib(), { PDFOperator: Op, PDFNumber: Num } = L, O = (n, a = []) => Op.of(n, a.map((x) => (typeof x === 'number' ? Num.of(x) : x)));
  const pdf = await L.PDFDocument.create(), p = pdf.addPage([500, 400]), font = await pdf.embedFont(L.StandardFonts.Helvetica);
  const key = p.node.newFontDictionary('F', font.ref);
  const line = (t, x, y, st = []) => p.pushOperators(O('q'), ...st, O('BT'), O('Tf', [key, 20]), O('Td', [x, y]), O('Tj', [font.encodeText(t)]), O('ET'), O('Q'));
  line('First line here', 40, 330);
  line('Hey there!', 40, 280, [O('rg', [0.02, 0.38, 1]), O('RG', [0.02, 0.38, 1]), O('w', [0.8]), O('Tr', [2]), O('Tc', [1]), O('Tw', [3]), O('Tz', [90])]);
  line('Last line here', 40, 230);
  const file = tmp('state.pdf'); H.fs.writeFileSync(file, await pdf.save()); return file;
}
// The colour on screen at a point of page n (PDF coordinates).
const pixel = (p, x, y, n = 0) => p.evaluate(([x, y, n]) => {
  const v = window.__cowdreyPdf.views()[n], c = v.el.querySelector('canvas.pdf'), k = c.width / v.viewport.width;
  const [vx, vy] = v.viewport.convertToViewportPoint(x, y);
  return Array.from(c.getContext('2d').getImageData(Math.round(vx * k), Math.round(vy * k), 1, 1).data.slice(0, 3));
}, [x, y, n]);
const blue = (c) => c[2] > 180 && c[0] < 120;
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

  await test('Edit PDF: deleting a picture hides the same draw on screen that the saved file removes (clipped copies, forms)', async () => {
    const p = await open(); await openPdf(p, await clippedDoc(), 'Clipped.pdf');
    await editTool(p);
    const imgs = await p.evaluate(async () => (await window.__cowdreyPdf.contentMap(0)).images.map((i) => [i.raw, i.quad.flat().map(Math.round)]));
    eq(imgs.map((i) => i[0]), [0, 2], 'the copy clipped to nothing is not a picture you can pick');
    ok(blue(await pixel(p, 120, 300)), 'blue picture shows');
    const [cx, cy] = await atN(p, 0, 120, 300); await p.mouse.click(cx, cy); await p.waitForTimeout(300);
    await p.keyboard.press('Delete'); await p.waitForTimeout(1200);
    const m = (await all(p)).find((x) => x.type === 'ie');
    eq([m.deleted, m.raw], [true, 0], 'the visible draw, by identity');
    const screen = await pixel(p, 120, 300);
    ok(!blue(screen), 'gone on screen: ' + screen);
    ok(!blue(await pixel(p, 330, 30)) && (await pixel(p, 330, 30))[0] > 180, 'the other picture stays');
    await shot(p, 'pic-deleted-screen.png');
    await reopen(p, await savedOf(p));
    const saved = await pixel(p, 120, 300);
    ok(!blue(saved), 'gone in the saved file too: ' + saved);
    ok((await pixel(p, 330, 30))[0] > 180, 'the other picture is still saved');
    eq(await p.evaluate(async () => (await window.__cowdreyPdf.contentMap(0)).images.length), 1, 'one picture left');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Edit PDF: on the brochure, deleting the page-one picture looks the same on screen and in the saved file', async () => {
    const file = GUIDE + 'pdfelement-guide.pdf'; if (!H.fs.existsSync(file)) return;
    const p = await open(); await openPdf(p, file, 'Guide.pdf');
    await editTool(p);
    await p.evaluate(() => window.__cowdreyPdf.run('zoomOut')); await p.evaluate(() => window.__cowdreyPdf.run('zoomOut')); await p.waitForTimeout(800);
    await p.evaluate(() => { const v = window.__cowdreyPdf.views()[0], [, vy] = v.viewport.convertToViewportPoint(500, 350); document.querySelector('#viewer').scrollTop = v.el.offsetTop + vy - 400; });
    await p.waitForTimeout(800);
    const [cx, cy] = await atN(p, 0, 500, 350); await p.mouse.click(cx, cy); await p.waitForTimeout(500);
    await p.keyboard.press('Delete'); await p.waitForTimeout(2500);
    eq((await all(p)).filter((x) => x.type === 'ie').map((x) => [x.raw, x.deleted]), [[0, true]]);
    const pts = [[500, 350], [200, 300], [800, 500], [500, 1000], [100, 1300], [900, 100]];
    const before = []; for (const [x, y] of pts) before.push(await pixel(p, x, y));
    await shot(p, 'brochure-deleted-screen.png');
    await reopen(p, await savedOf(p));
    await p.waitForTimeout(800);
    const after = []; for (const [x, y] of pts) after.push(await pixel(p, x, y));
    await shot(p, 'brochure-deleted-saved.png');
    ok(after.every((c, k) => c.every((n, j) => Math.abs(n - before[k][j]) < 40)), 'screen ' + JSON.stringify(before) + ' saved ' + JSON.stringify(after));
    await p.ctx.close();
  });

  await test('Edit PDF: editing part of a mixed-font line moves the next run along; nothing is drawn over it', async () => {
    const p = await open(); await openPdf(p, H.path.join(H.root, 'tests/fixtures/tricky.pdf'), 'Tricky.pdf');
    await editTool(p);
    const before = await (async () => { const L = await lineOf(p, 'Hello'), W = await lineOf(p, 'world'); return { L, W }; })();
    const [cx, cy] = await atN(p, 0, before.L.tm[4] + 2, before.L.tm[5] + 3);
    await p.mouse.click(cx, cy); await p.waitForSelector('.line-editor');
    await p.keyboard.press('End'); await p.keyboard.type(' (edited)'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
    const ms = await all(p), w = ms.find((m) => m.orig === 'world'), hm = ms.find((m) => /edited/.test(m.text));
    ok(w && w.dx > 20, 'world moves along on screen: ' + JSON.stringify(w && w.dx));
    await shot(p, 'mixed-font-screen.png');
    const out = await savedOf(p), it = await itemsOf(out);
    const hi = it.find((i) => /edited/.test(i.s)), wi = it.find((i) => i.s.trim() === 'world');
    ok(hi && wi, JSON.stringify(it));
    ok(wi.x >= hi.x + hi.w + 2, `world (x ${wi.x}) starts after the edited text ends (${hi.x + hi.w}), the space kept`);
    ok(Math.abs(wi.y - hi.y) < .5, 'same baseline');
    ok(Math.abs(wi.x - (before.W.tm[4] + w.dx)) < .5, 'where the screen put it');
    // Taking the edit back puts it back
    await p.mouse.click(cx, cy); await p.waitForSelector('.line-editor');
    await p.keyboard.press('Control+a'); await p.keyboard.type(hm.orig); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
    eq((await all(p)).length, 0, 'no edits left');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Edit PDF: edited text keeps its render mode, line width, spacing and width scale, on screen and saved', async () => {
    const p = await open(); await openPdf(p, await stateDoc(), 'State.pdf');
    await editTool(p);
    const L = await lineOf(p, 'Hey there');
    eq([L.st.tr, L.st.lw, +L.st.tc.toFixed(3), +L.st.tw.toFixed(3), L.st.fill], [2, .8, .05, .15, '#0561ff']);
    const [cx, cy] = await atN(p, 0, L.tm[4] + 5, L.tm[5] + 4); await p.mouse.click(cx, cy); await p.waitForSelector('.line-editor');
    const css = await p.$eval('.line-editor', (e) => [e.style.letterSpacing, e.style.webkitTextStroke, e.style.transform]);
    ok(parseFloat(css[0]) > 0 && /px/.test(css[1]) && /scaleX\(0\.9/.test(css[2]), 'the editor has the spacing, outline and width: ' + css);
    await p.keyboard.press('End'); await p.keyboard.type(' Hi'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    const m = (await all(p))[0];
    eq([m.text, m.tr, m.lw, m.stroke, m.tc, m.tw], ['Hey there! Hi', 2, .8, '#0561ff', .05, .15]);
    await shot(p, 'state-screen.png');
    const out = await savedOf(p), cs = await contentOf(out);
    ok(/2 Tr/.test(cs) && /0\.8 w/.test(cs) && /0\.05 Tc/.test(cs) && /0\.15 Tw/.test(cs), 'saved with the same text state');
    // Its width in the saved file: the font's widths with the spacing, at 90%
    const it = (await itemsOf(out)).find((i) => /Hi$/.test(i.s));
    const font = await pdfLib().PDFDocument.create().then((d) => d.embedFont(pdfLib().StandardFonts.Helvetica));
    const want = (font.widthOfTextAtSize('Hey there! Hi', 20) + 13 * 1 + 2 * 3) * .9;
    ok(Math.abs(it.w - want) < 1, `width ${it.w} ≈ ${want}`);
    // and on screen the drawn line is about as wide
    const adv = await p.evaluate(() => { const im = [...document.querySelectorAll('.page[data-n="0"] svg.marks image')].pop(); return im && +im.getAttribute('width'); });
    const sc = await p.evaluate(() => window.__cowdreyPdf.views()[0].viewport.scale);
    ok(Math.abs(adv / sc - want) < 8, `screen ${adv / sc} ≈ ${want}`);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Edit PDF: an edited line keeps its place in the reading order (lines and paragraphs)', async () => {
    const p = await open(); await openPdf(p, await stateDoc(), 'State.pdf');
    await editTool(p);
    const L = await lineOf(p, 'Hey there');
    const [cx, cy] = await atN(p, 0, L.tm[4] + 5, L.tm[5] + 4); await p.mouse.click(cx, cy); await p.waitForSelector('.line-editor');
    await p.keyboard.press('End'); await p.keyboard.type(' Hi'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    eq((await itemsOf(await savedOf(p))).map((i) => i.s), ['First line here', 'Hey there! Hi', 'Last line here']);
    await p.ctx.close();
    const q = await open(); await openPdf(q, H.path.join(H.root, 'tests/fixtures/chrome.pdf'), 'Summary.pdf');
    await editTool(q);
    const order0 = (await itemsOf(H.fs.readFileSync(H.path.join(H.root, 'tests/fixtures/chrome.pdf')))).map((i) => i.s.trim()).filter(Boolean);
    const Q = await lineOf(q, 'Quarterly');
    const [qx, qy] = await atN(q, 0, Q.tm[4] + 5, Q.tm[5] + 4); await q.mouse.click(qx, qy); await q.waitForSelector('.line-editor');
    await q.keyboard.press('End'); await q.keyboard.type(' (edited)'); await q.keyboard.press('Enter'); await q.waitForTimeout(300);
    const order1 = (await itemsOf(await savedOf(q))).map((i) => i.s.trim()).filter(Boolean);
    const k0 = order0.findIndex((s) => /Quarterly/.test(s)), k1 = order1.findIndex((s) => /Quarterly/.test(s));
    eq([k1, /edited/.test(order1.slice(k1, k1 + 2).join(' '))], [k0, true], 'the heading stays first: ' + JSON.stringify(order1));
    await q.ctx.close();
    // A paragraph drawn again sits where its first line was
    const r = await open(); await openPdf(r, await paraDoc(), 'Para.pdf');
    await editTool(r); await r.evaluate(() => window.__cowdreyPdf.run('txtParaMode'));
    const P = await lineOf(r, 'pelican'), [px, py] = await atN(r, 0, P.tm[4] + 5, P.tm[5] + 4);
    await r.mouse.click(px, py); await r.waitForSelector('.txt-editor');
    await r.keyboard.press('Control+End'); await r.keyboard.type(' More.'); await r.keyboard.press('Control+Enter'); await r.waitForTimeout(400);
    const its = (await itemsOf(await savedOf(r))).map((i) => i.s);
    eq(its[0], 'A heading', JSON.stringify(its)); ok(/pelican/.test(its[1]) && /More\.$/.test(its[its.length - 1]), JSON.stringify(its));
    eq(r.errors, []); await r.ctx.close();
  });

  await test('Edit PDF: the format bar shows the line\'s own colour, pressed', async () => {
    const p = await open(); await openPdf(p, await stateDoc(), 'State.pdf');
    await editTool(p);
    const L = await lineOf(p, 'Hey there');
    const [cx, cy] = await atN(p, 0, L.tm[4] + 5, L.tm[5] + 4); await p.mouse.click(cx, cy); await p.waitForSelector('.txt-bar');
    const sw = await p.$$eval('.txt-bar [data-tf="color"]', (b) => b.map((x) => [x.dataset.c, x.getAttribute('aria-pressed')]));
    eq(sw[0], ['#0561ff', 'true'], 'its colour first, pressed'); eq(sw.filter((x) => x[1] === 'true').length, 1, 'only that one');
    eq(await p.$eval('.txt-bar .txt-dot', (d) => getComputedStyle(d).backgroundColor), 'rgb(5, 97, 255)');
    await p.click('.txt-bar [data-tf="colors"]').catch(() => {});
    await shot(p, 'format-bar-colour-dark.png');
    await p.ctx.close();
    // A black line: black is pressed, and only black
    const q = await open({ scheme: 'light' }); await openPdf(q, await stateDoc(), 'State.pdf');
    await editTool(q);
    const F = await lineOf(q, 'First');
    const [fx, fy] = await atN(q, 0, F.tm[4] + 5, F.tm[5] + 4); await q.mouse.click(fx, fy); await q.waitForSelector('.txt-bar');
    const sw2 = await q.$$eval('.txt-bar [data-tf="color"]', (b) => b.map((x) => [x.dataset.c, x.getAttribute('aria-pressed')]));
    eq(sw2.filter((x) => x[1] === 'true'), [['#000000', 'true']], 'its black, in black\'s place: ' + JSON.stringify(sw2));
    eq(sw2.length, 6, 'one black, not two');
    await shot(q, 'format-bar-colour-light.png');
    await q.ctx.close();
  });

  await test('Edit PDF: paragraph mode groups double-spaced body text, but not short lines spaced apart', async () => {
    const p = await open(); await openPdf(p, await paraDoc(31), 'Double.pdf');
    await editTool(p); await p.evaluate(() => window.__cowdreyPdf.run('txtParaMode'));
    const P = await lineOf(p, 'stores'), [px, py] = await atN(p, 0, P.tm[4] + 5, P.tm[5] + 4);
    await p.mouse.click(px, py); await p.waitForSelector('.txt-editor');
    eq(await p.inputValue('.txt-editor'), PARA.join(' '), 'the whole paragraph');
    await p.keyboard.press('Escape'); await p.ctx.close();
    const file = GUIDE + 'pe10-win.pdf'; if (!H.fs.existsSync(file)) return;
    const q = await open(); await openPdf(q, file, 'Manual.pdf');
    await q.evaluate(() => window.__cowdreyPdf.views()[5].el.scrollIntoView()); await q.waitForTimeout(1200);
    await q.evaluate(() => { window.__cowdreyPdf.run('tool_edit'); window.__cowdreyPdf.run('txtParaMode'); });
    const M = await lineOf(q, 'with PDF files easier', 5);
    if (!M) return;
    const [mx, my] = await atN(q, 5, M.tm[4] + 20, M.tm[5] + 4); await q.mouse.click(mx, my); await q.waitForSelector('.txt-editor');
    const v = await q.inputValue('.txt-editor');
    ok(v.includes('with PDF files easier') && v.length > M.str.length + 40, 'more than one line: ' + v);
    await q.ctx.close();
  });

  await test('Edit PDF: on a phone, a line too small to read is zoomed to at least 14 px while edited, then zoom comes back', async () => {
    const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    const z0 = await p.textContent('#zoomLabel'), top0 = await p.$eval('#viewer', (v) => v.scrollTop);
    const L = await lineOf(p, 'Prepared'), [tx, ty] = await atN(p, 0, L.tm[4] + 30, L.tm[5] + 3);
    ok(12 * (await p.evaluate(() => window.__cowdreyPdf.views()[0].viewport.scale)) < 14, 'small at fit width');
    await p.touchscreen.tap(tx, ty); await p.waitForSelector('.line-editor'); await p.waitForTimeout(300);
    const fs = await p.$eval('.line-editor', (e) => parseFloat(getComputedStyle(e).fontSize));
    ok(fs >= 14, 'readable: ' + fs);
    const b = await p.$eval('.line-editor', (e) => { const r = e.getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom]; });
    ok(b[2] > 60 && b[3] < 844 && b[1] > 0 && b[0] < 390, 'on screen: ' + b);
    await shot(p, 'phone-zoomed-editing.png');
    await p.keyboard.press('Escape'); await p.waitForTimeout(1200);
    eq(await p.textContent('#zoomLabel'), z0, 'zoom back'); ok(Math.abs((await p.$eval('#viewer', (v) => v.scrollTop)) - top0) < 2, 'scroll back');
    eq(p.errors, []); await p.ctx.close();
  });
};
