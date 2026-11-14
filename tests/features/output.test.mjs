// Saved-output correctness: what was edited away is not left in the file, values typed into fields are saved even
// while their box still has focus, annotations are well formed, our own text boxes stay editable after reopening,
// Compress never makes a file bigger, and page design is tagged so other editors can find it.
import os from 'node:os';

const SHOTS = '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr6/fix-output/';
const GUIDE = '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/guide/';
let H;
const shot = async (p, name) => { try { H.fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: SHOTS + name }); } catch {} };
const pdfLib = () => H.require(H.path.join(H.root, 'desktop/node_modules/pdf-lib'));
let pdfjsMod = null;
const pdfjs = async () => pdfjsMod || (pdfjsMod = await import(H.path.join(H.root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs')));
// The saved file, passed back as base64 (a big PDF as a JSON array of numbers would not fit in memory).
const savedBig = async (p) => Buffer.from(await p.evaluate(async () => { const b = await window.__cowdreyPdf.buildPdf(); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }), 'base64');
const decoded = (L, st) => { try { return Buffer.from(L.decodePDFRawStream(st).decode()); } catch { return Buffer.from(st.getContents()); } };

// Objects in the file that nothing refers to (from the trailer's Root, Info and Encrypt).
function unreachable(L, d) {
  const seen = new Set();
  const visit = (x) => {
    if (x instanceof L.PDFRef) { if (seen.has(x.tag)) return; seen.add(x.tag); visit(d.context.lookup(x)); }
    else if (x instanceof L.PDFDict) for (const [, v] of x.entries()) visit(v);
    else if (x instanceof L.PDFArray) for (const v of x.asArray()) visit(v);
    else if (x && x.dict instanceof L.PDFDict) visit(x.dict);
  };
  const t = d.context.trailerInfo; visit(t.Root); visit(t.Info); visit(t.Encrypt);
  const what = (o) => { const dd = o instanceof L.PDFDict ? o : o && o.dict; return dd ? [...dd.entries()].filter(([k]) => /Type|Subtype|Length|BaseFont/.test(k.asString())).map(([k, v]) => k.asString() + ' ' + v.toString()).join(' ') : String(o); };
  return d.context.enumerateIndirectObjects().filter(([r]) => !seen.has(r.tag)).map(([r, o]) => r.toString() + ' ' + what(o));
}
// The text in every stream of the file that could be page content, read with the fonts of page k (so glyph codes
// become letters): each stream is drawn on a page of its own and pdf.js reads it back.
async function textOfEveryStream(bytes, k) {
  const L = pdfLib(), d = await L.PDFDocument.load(bytes), N = (s) => L.PDFName.of(s);
  const src = d.getPage(k), res = src.node.Resources(), n0 = d.getPageCount();
  for (const [ref, o] of d.context.enumerateIndirectObjects()) {
    if (!(o instanceof L.PDFRawStream)) continue;
    const t = o.dict.get(N('Type')), s = o.dict.get(N('Subtype'));
    if (t || (s && String(s) !== '/Form') || o.dict.get(N('Length1')) || o.dict.get(N('Length2'))) continue;
    const pg = d.addPage([src.getWidth(), src.getHeight()]);
    pg.node.set(N('Resources'), String(s) === '/Form' && o.dict.get(N('Resources')) ? o.dict.get(N('Resources')) : res);
    pg.node.set(N('Contents'), ref);
  }
  const doc = await (await pdfjs()).getDocument({ data: new Uint8Array(await d.save()), verbosity: 0 }).promise;
  let all = '';
  for (let n = n0 + 1; n <= doc.numPages; n++) { try { const tc = await (await doc.getPage(n)).getTextContent(); all += tc.items.map((i) => i.str).join('') + '\n'; } catch {} }
  await doc.loadingTask.destroy();
  return all.replace(/\s+/g, '');
}
// The decoded content streams of the given pages of a file, as latin1 strings.
async function contentOf(bytes, pages) {
  const L = pdfLib(), d = await L.PDFDocument.load(bytes), out = [];
  for (const k of pages) { const c = d.getPage(k).node.Contents(); const arr = c instanceof L.PDFArray ? c.asArray().map((r) => d.context.lookup(r)) : [c]; for (const st of arr) out.push(decoded(L, st).toString('latin1')); }
  return out;
}
async function everyStream(bytes) {
  const L = pdfLib(), d = await L.PDFDocument.load(bytes), out = [];
  for (const [, o] of d.context.enumerateIndirectObjects()) if (o instanceof L.PDFRawStream) out.push(decoded(L, o).toString('latin1'));
  return out;
}

export default async (h) => {
  H = h;
  const { test, eq, ok, open, openPdf, savedOf, reopen, pageText, WORD } = h;
  const editLine = async (p, n, find, typed) => {
    const b = await p.locator(`.page[data-n="${n}"] .textLayer span`, { hasText: find }).first().boundingBox();
    await p.mouse.click(b.x + Math.min(20, b.width / 3), b.y + b.height / 2); await p.waitForSelector('.line-editor');
    await p.keyboard.press('Control+a'); await p.keyboard.type(typed); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  };
  // The privacy check: the old words are nowhere in the file, read with the page's own fonts from every stream.
  const goneFromFile = async (bytes, original, page, oldWords, newWords) => {
    const L = pdfLib(), d = await L.PDFDocument.load(bytes);
    eq(unreachable(L, d), [], 'objects nothing refers to');
    const old = new Set(await contentOf(original, [page])), now = await everyStream(bytes);
    ok(!now.some((s) => old.has(s)), 'an original content stream of the edited page is still in the file');
    const t = await textOfEveryStream(bytes, page);
    ok(t.includes(newWords.replace(/\s+/g, '')), 'the new words are read back (the check works): ' + t.slice(0, 200));
    for (const w of oldWords) ok(!t.includes(w.replace(/\s+/g, '')), `"${w}" is still in the saved file`);
  };

  await test('saved file: a line edited on word.pdf leaves no trace of the old words in any stream, in every save path', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    await editLine(p, 0, 'Budget', 'Budget: 45,500 dollars, on track.');
    const original = h.fs.readFileSync(WORD);
    await goneFromFile(await savedOf(p), original, 0, ['42,000'], 'Budget: 45,500 dollars');
    // Save a copy and Save go through the same build; the downloaded bytes are checked too.
    await p.evaluate(() => { window.showSaveFilePicker = undefined; });
    const [dl] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => window.__cowdreyPdf.run('saveCopy'))]);
    const copy = h.fs.readFileSync(await dl.path());
    await goneFromFile(copy, original, 0, ['42,000'], 'Budget: 45,500 dollars');
    eq(p.errors.filter((e) => !/annotation-comment/.test(e)), []); await p.ctx.close();
  });

  await test('saved file: on the brochure, edited and replaced text is gone from every stream', async () => {
    const file = GUIDE + 'pdfelement-guide.pdf'; if (!h.fs.existsSync(file)) return;
    const p = await open(); await openPdf(p, file, 'Guide.pdf');
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    await editLine(p, 0, 'Hey there!', 'Hello there, dear reader!');
    // Replace all across the brochure: every page whose text changed is written anew, its old content not kept.
    await p.evaluate(() => window.__cowdreyPdf.run('txtReplace')); await p.waitForSelector('#dialog[open] #txtFind');
    await p.fill('#txtFind', 'PDFelement'); await p.fill('#txtWith', 'Cowdrey.PDF'); await p.click('#dialog .btn.primary');
    await p.waitForFunction(() => /replaced/.test(document.querySelector('#txtStatus').textContent), null, { timeout: 30000 });
    await p.click('#dialog [data-a="0"]');
    const bytes = await savedBig(p);
    await goneFromFile(bytes, h.fs.readFileSync(file), 0, ['Heythere!'], 'Hello there, dear reader!');
    const old = new Set(await contentOf(h.fs.readFileSync(file), [...Array(13).keys()])), now = await everyStream(bytes);
    const edited = await p.evaluate(() => Object.keys(window.__cowdreyPdf.doc.marks).filter((k) => window.__cowdreyPdf.doc.marks[k].length).length);
    ok(edited > 3, 'replace all changed several pages: ' + edited);
    eq(now.filter((s) => old.has(s)).length, 13 - edited, 'only the content of pages with no edits is the original');
    await p.ctx.close();
  });

  await test('saved file: a password-protected PDF saved with its password keeps no trace of an edited line', async () => {
    const p = await open();
    const opening = p.evaluate(async (b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return window.__cowdreyPdf.openBytes(u, 'Secret.pdf'); }, h.fixture('protected.pdf'));
    await p.waitForSelector('#dialog[open] #dlgInput'); await p.fill('#dlgInput', 'pelican'); await p.click('#dialog .btn.primary');
    await opening; await h.waitPages(p); await p.waitForTimeout(400);
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    await editLine(p, 0, 'Quarterly', 'Yearly report');
    const out = p.evaluate(async () => Array.from(await window.__cowdreyPdf.buildPdf())); await h.answer(p, 'Keep password');
    const C = h.require(h.path.join(h.root, 'desktop/node_modules/@cantoo/pdf-lib'));
    const d = await C.PDFDocument.load(Buffer.from(await out), { password: 'pelican' });
    const dec = (st) => { try { return Buffer.from(C.decodePDFRawStream(st).decode()).toString('latin1'); } catch { return ''; } };
    const orig = await C.PDFDocument.load(h.fs.readFileSync(h.path.join(h.root, 'tests/fixtures/protected.pdf')), { password: 'pelican' });
    const oc = orig.getPage(0).node.Contents(), old = new Set((oc instanceof C.PDFArray ? oc.asArray().map((r) => orig.context.lookup(r)) : [oc]).map(dec));
    ok(!d.context.enumerateIndirectObjects().some(([, o]) => o instanceof C.PDFRawStream && old.has(dec(o))), 'the original page content is still in the file');
    await p.ctx.close();
  });

  // Ctrl+S while still typing: the downloaded file (the web app with no file picker) has what was typed.
  const ctrlS = async (p) => {
    await p.evaluate(() => { window.showSaveFilePicker = undefined; });
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.keyboard.press('Control+s')]);
    return h.fs.readFileSync(await dl.path());
  };
  const textOf = async (bytes) => {
    const doc = await (await pdfjs()).getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
    const tc = await (await doc.getPage(1)).getTextContent(); await doc.loadingTask.destroy();
    return tc.items.map((i) => i.str).join(' ');
  };
  const annotTexts = async (bytes) => {
    const L = pdfLib(), d = await L.PDFDocument.load(bytes), a = d.getPage(0).node.Annots();
    return a ? a.asArray().map((r) => d.context.lookup(r)).map((x) => { const c = x.lookup(L.PDFName.of('Contents')); return c ? c.decodeText() : ''; }) : [];
  };
  const drag = async (p, [x1, y1], [x2, y2]) => { const a = await h.at(p, x1, y1), b = await h.at(p, x2, y2); await p.mouse.move(...a); await p.mouse.down(); await p.mouse.move(...b, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(120); };

  await test('saved file: Ctrl+S while typing in a form field made here keeps the value (and Undo still takes it back)', async () => {
    const p = await open({ width: 1000, height: 1300 }); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.click('[data-rt="forms"]'); await p.click('[data-cmd="ff_text"]'); await drag(p, [100, 300], [300, 280]);
    await p.click('[data-rt="home"]'); await p.waitForTimeout(200);
    await p.click('.ff-fill-layer .ff-ctl-text'); await p.keyboard.type('Filled value');
    const bytes = await ctrlS(p);
    const L = pdfLib(), f = (await L.PDFDocument.load(bytes)).getForm().getFields().filter((x) => x instanceof L.PDFTextField);
    ok(f.some((x) => x.getText() === 'Filled value'), 'saved values: ' + JSON.stringify(f.map((x) => x.getText())));
    await p.keyboard.press('Escape'); await p.click('#viewer', { position: { x: 5, y: 5 } }).catch(() => {});
    await p.evaluate(() => window.__cowdreyPdf.run('undo')); await p.waitForTimeout(200);
    eq(await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().filter((m) => m.type === 'ff').map((m) => m.val || '')), [''], 'undo takes the value back');
    await p.ctx.close();
  });

  await test('saved file: Ctrl+S while typing keeps the words in every editor (line, paragraph, Add text, note, callout, typewriter, bookmark name)', async () => {
    const got = {};
    { // a line in Edit PDF
      const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
      await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
      const b = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'Budget' }).first().boundingBox();
      await p.mouse.click(b.x + 20, b.y + b.height / 2); await p.waitForSelector('.line-editor');
      await p.keyboard.press('Control+a'); await p.keyboard.type('Budget: 99 dollars');
      got.line = /Budget: 99 dollars/.test(await textOf(await ctrlS(p))); await p.ctx.close();
    }
    { // a paragraph
      const p = await open(); await openPdf(p);
      await p.evaluate(() => window.__cowdreyPdf.run('txtParaMode'));
      const b = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'pelican count' }).first().boundingBox();
      await p.mouse.click(b.x + 10, b.y + b.height / 2); await p.waitForSelector('.txt-editor');
      await p.keyboard.press('Control+a'); await p.keyboard.type('Zebras everywhere');
      got.paragraph = /Zebras everywhere/.test(await textOf(await ctrlS(p))); await p.ctx.close();
    }
    { // Add text
      const p = await open(); await openPdf(p);
      await p.evaluate(() => window.__cowdreyPdf.run('tool_text')); await p.mouse.click(...(await h.at(p, 100, 620)));
      await p.waitForSelector('.txt-editor'); await p.keyboard.type('Added words');
      got.text = /Added words/.test(await textOf(await ctrlS(p))); await p.ctx.close();
    }
    { // a note, a callout and typewriter text, each still being typed
      for (const [k, tool, place] of [['note', 'tool_note', 'click'], ['callout', 'cm_callout', 'drag'], ['typewriter', 'cm_typewriter', 'click']]) {
        const p = await open(); await openPdf(p);
        await p.evaluate((t) => window.__cowdreyPdf.run(t), tool);
        if (place === 'drag') await drag(p, [100, 640], [200, 600]); else await p.mouse.click(...(await h.at(p, 100, 620)));
        await p.waitForSelector('.page-ask textarea'); await p.keyboard.type('Words for ' + k);
        got[k] = (await annotTexts(await ctrlS(p))).includes('Words for ' + k); await p.ctx.close();
      }
    }
    { // a bookmark's name
      const p = await open(); await openPdf(p);
      await p.click('[data-side="outline"]'); await p.click('#viewer'); await p.keyboard.press('Control+b');
      await p.waitForSelector('#sidePanel .bm-in'); await p.fill('#sidePanel .bm-in', 'Named mid-typing');
      const d = await pdfLib().PDFDocument.load(await ctrlS(p)), L = pdfLib();
      const o = d.catalog.lookup(L.PDFName.of('Outlines')), first = o && o.lookup(L.PDFName.of('First'));
      got.bookmark = !!first && first.lookup(L.PDFName.of('Title')).decodeText() === 'Named mid-typing'; await p.ctx.close();
    }
    eq(got, { line: true, paragraph: true, text: true, note: true, callout: true, typewriter: true, bookmark: true });
  });

  const annotsOf = (L, d, n = 0) => { const a = d.getPage(n).node.Annots(); return a ? a.asArray().map((r) => d.context.lookup(r)).filter((x) => String(x.get(L.PDFName.of('Subtype'))) !== '/Widget') : []; };
  const numsOf = (L, x) => (x instanceof L.PDFArray ? x.asArray().map((n) => n.asNumber()) : []);
  const typeIn = async (p, text) => { await p.waitForSelector('.page-ask textarea'); await p.fill('.page-ask textarea', text); await p.click('.page-ask .btn.primary'); await p.waitForTimeout(150); };

  await test('saved file: callout and typewriter /DA is a plain string; every comment\'s Rect holds its QuadPoints, vertices and leader', async () => {
    const p = await open({ height: 1300 }); await openPdf(p);
    await p.click('[data-rt="markup"]');
    for (const [id, frac] of [['cm_underline', .5], ['cm_strike', .6], ['tool_highlight', .4]]) { await p.click(`[data-cmd="${id}"]`); await h.selectText(p, 0, id === 'cm_strike' ? 'The pelican count' : 'Cowdrey.PDF opens', frac); await p.waitForTimeout(150); }
    await p.click('[data-cmd="cm_polygon"]'); for (const pt of [[60, 300], [160, 340], [120, 260]]) await p.mouse.click(...(await h.at(p, ...pt))); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
    await p.click('[data-cmd="cm_callout"]'); await drag(p, [300, 400], [420, 330]); await typeIn(p, 'Callout words');
    await p.click('[data-cmd="cm_typewriter"]'); await p.mouse.click(...(await h.at(p, 60, 200))); await typeIn(p, 'Typed note');
    const L = pdfLib(), N = (k) => L.PDFName.of(k), d = await L.PDFDocument.load(await savedOf(p)), as = annotsOf(L, d);
    const subs = as.map((a) => String(a.get(N('Subtype'))).slice(1));
    for (const want of ['Underline', 'StrikeOut', 'Polygon', 'FreeText']) ok(subs.includes(want), want + ' saved: ' + subs);
    const ft = as.filter((a) => String(a.get(N('Subtype'))) === '/FreeText');
    eq(ft.length, 2, 'callout and typewriter');
    for (const a of ft) {
      const da = a.get(N('DA'));
      ok(da instanceof L.PDFString, '/DA is a literal string, not ' + (da && da.constructor.name));
      ok(/^\/Helv 12 Tf [\d.]+ [\d.]+ [\d.]+ rg$/.test(da.decodeText()), 'DA ' + da.decodeText());
      ok(/^font: Helvetica 12pt; color: #[0-9a-f]{6}$/.test(a.get(N('DS')).decodeText()), 'DS');
    }
    for (const a of as) {
      const [x0, y0, x1, y1] = numsOf(L, a.get(N('Rect'))), sub = String(a.get(N('Subtype')));
      for (const k of ['QuadPoints', 'Vertices', 'CL', 'L']) {
        const v = numsOf(L, a.get(N(k)));
        for (let j = 0; j + 1 < v.length; j += 2) ok(v[j] >= x0 - .01 && v[j] <= x1 + .01 && v[j + 1] >= y0 - .01 && v[j + 1] <= y1 + .01, `${sub} ${k} point ${v[j]},${v[j + 1]} outside its Rect ${[x0, y0, x1, y1]}`);
      }
    }
    // pdf.js reads the appearance strings without complaint
    const warn = []; const orig = console.log; console.log = (...a) => { warn.push(a.join(' ')); };
    try { const doc2 = await (await pdfjs()).getDocument({ data: new Uint8Array(await d.save()), verbosity: 1 }).promise; await (await doc2.getPage(1)).getAnnotations(); await doc2.loadingTask.destroy(); } finally { console.log = orig; }
    ok(!warn.some((w) => /parseDefaultAppearance|Unknown command/.test(w)), warn.join('\n'));
    await p.ctx.close();
  });

  await test('reopened: our callout and typewriter text can be edited again, keeping where they are and how they look', async () => {
    const p = await open({ height: 1300 }); await openPdf(p);
    await p.click('[data-rt="markup"]');
    await p.click('[data-cmd="cm_callout"]'); await drag(p, [300, 400], [420, 330]); await typeIn(p, 'Callout words');
    await p.click('[data-cmd="cm_typewriter"]'); await p.mouse.click(...(await h.at(p, 60, 200))); await typeIn(p, 'Typed note');
    const L = pdfLib(), N = (k) => L.PDFName.of(k);
    const first = await savedOf(p), rectOf = async (b) => Object.fromEntries(annotsOf(L, await L.PDFDocument.load(b)).filter((a) => String(a.get(N('Subtype'))) === '/FreeText').map((a) => [a.lookup(N('Contents')).decodeText(), numsOf(L, a.get(N('Rect'))).map((n) => Math.round(n))]));
    const r1 = await rectOf(first);
    const look = await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().map(({ type, x, y, rot, tx, ty, size, color, lw }) => ({ type, x, y, rot, tx, ty, size, color, lw })));
    await reopen(p, first); await p.waitForTimeout(500);
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    for (const [pt, was, now] of [[[65, 195], 'Typed note', 'Typed again'], [[340, 380], 'Callout words', 'Callout changed']]) {
      await p.mouse.dblclick(...(await h.at(p, ...pt)));
      await p.waitForSelector('#dialog[open] #dlgInput', { timeout: 5000 });
      eq(await p.inputValue('#dlgInput'), was, 'the words to edit');
      await p.fill('#dlgInput', now); await p.click('#dialog .btn.primary'); await p.waitForTimeout(400);
    }
    await shot(p, 'reopened-freetext-edited.png');
    const ms = await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().map(({ type, x, y, rot, tx, ty, size, color, lw, text, deleted }) => ({ type, x, y, rot, tx, ty, size, color, lw, text, deleted })));
    eq(ms.filter((m) => m.type === 'ae').map((m) => m.deleted), [true, true], 'the old annotations go');
    const back = ms.filter((m) => m.type !== 'ae');
    eq(back.map(({ text, ...k }) => k).sort((a, b) => a.type.localeCompare(b.type)), look.map((k) => ({ ...k, deleted: undefined })).sort((a, b) => a.type.localeCompare(b.type)), 'the same place and look');
    const r2 = await rectOf(await savedOf(p));
    eq(Object.keys(r2).sort(), ['Callout changed', 'Typed again'], 'saved once each, with the new words');
    ok(Math.abs(r2['Typed again'][1] - r1['Typed note'][1]) <= 1 && Math.abs(r2['Typed again'][3] - r1['Typed note'][3]) <= 1 && r2['Typed again'][0] === r1['Typed note'][0], 'typewriter in place ' + r1['Typed note'] + ' → ' + r2['Typed again']);
    const pick = (r) => [r[0], r[1], r[3]]; // wider words make the box wider to the right only
    eq(pick(r2['Callout changed']), pick(r1['Callout words']), 'callout in place');
    eq(p.errors, []); await p.ctx.close();
  });

  const compressAt = async (p, lv) => {
    await p.evaluate(() => window.__cowdreyPdf.run('protCompress'));
    await p.waitForFunction(() => /^Now /.test((document.querySelector('#protSize') || {}).textContent || ''), null, { timeout: 30000 });
    ok(await p.isChecked('#dialog input[name=level][value="150"]'), 'Balanced is chosen to begin with');
    await p.click(`#dialog input[name=level][value="${lv}"]`); await p.waitForTimeout(300);
    await p.click('#dialog .dlg-foot .btn.primary'); await p.waitForTimeout(200);
  };
  await test('Compress never makes a file bigger: an already compact PDF is saved as it was, and you are told', async () => {
    const size0 = h.fs.statSync(WORD).size;
    for (const lv of ['150', 'keep']) {
      const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
      await compressAt(p, lv);
      const out = await savedOf(p);
      ok(out.length <= size0, `${lv}: ${size0} → ${out.length}`);
      ok(/would not make this PDF smaller/.test(await p.evaluate(() => document.body.textContent)), 'said so');
      await p.ctx.close();
    }
    // With an edit, compressing still never gives a bigger file than not compressing.
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    await editLine(p, 0, 'Budget', 'Budget: 45,500 dollars, on track.');
    const plain = (await savedOf(p)).length;
    await compressAt(p, '150');
    const packed = (await savedOf(p)).length;
    ok(packed <= plain, `compressed ${packed} vs not ${plain}`);
    await p.ctx.close();
  });
};
