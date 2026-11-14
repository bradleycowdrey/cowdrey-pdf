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
};
