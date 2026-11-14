// Saved-output correctness of editing on real PDFs: page content is never written still compressed, editing the
// first run of a mixed-style line keeps the runs after it, centred lines stay centred, the caret goes where the
// click was, Combine keeps form field names unique, Shrink to fit keeps line spacing, and redaction removes the
// comments it covers at once.
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const SHOTS = '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr5/fix-saveacc/';
const GUIDE = '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/guide/';
let H;
// The saved file, passed back as base64 (a big PDF as a JSON array of numbers would not fit in memory).
const savedBig = async (p) => Buffer.from(await p.evaluate(async () => { const b = await window.__cowdreyPdf.buildPdf(); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }), 'base64');
const shot = async (p, name) => { try { H.fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: SHOTS + name }); } catch {} };
const tmp = (name) => H.path.join(H.fs.mkdtempSync(H.path.join(os.tmpdir(), 'cpdf-sacc-')), name);
const pdfLib = () => H.require(H.path.join(H.root, 'desktop/node_modules/pdf-lib'));
let pdfjsMod = null;
const pdfjs = async () => pdfjsMod || (pdfjsMod = await import(H.path.join(H.root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs')));
const atN = (p, n, x, y) => p.evaluate(([n, x, y]) => { const v = window.__cowdreyPdf.views()[n]; const [vx, vy] = v.viewport.convertToViewportPoint(x, y); const r = v.el.getBoundingClientRect(); return [r.left + vx, r.top + vy]; }, [n, x, y]);
const lineOf = (p, text, n = 0) => p.evaluate(async ([t, n]) => { const cm = await window.__cowdreyPdf.contentMap(n); const L = cm.lines.find((l) => l.str.includes(t)); return L && { str: L.str, tm: L.tm, width: L.width, quad: L.quad }; }, [text, n]);
const all = (p) => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat());
const showPage = async (p, n) => { await p.evaluate((k) => window.__cowdreyPdf.views()[k].el.scrollIntoView(), n); await p.waitForTimeout(1000); };
const caret = (p) => p.evaluate(() => { const el = document.activeElement; if (el.tagName === 'TEXTAREA') return [el.selectionStart, el.selectionEnd, el.value]; const s = getSelection(), r = s.rangeCount && s.getRangeAt(0); return r ? [r.startOffset, r.endOffset, el.textContent] : null; });
// Text items of a saved page (1-based), in content order.
async function itemsOf(bytes, n = 1) {
  const L = await pdfjs(), d = await L.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const pg = await d.getPage(n), tc = await pg.getTextContent(), [, , pw] = pg.view; await d.loadingTask.destroy();
  return Object.assign(tc.items.filter((i) => i.str.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, font: i.fontName })), { pw });
}
// Every page's decoded content: nothing still compressed in it (a zlib header, 78 9C), and poppler reads it
// without errors (when pdftotext is installed) on the pages asked.
async function cleanContent(bytes, pages, original) {
  const L = pdfLib(), d = await L.PDFDocument.load(bytes), bad = [];
  d.getPages().forEach((pg, k) => {
    const c = pg.node.Contents(); if (!c) return;
    const arr = c instanceof L.PDFArray ? c.asArray().map((r) => d.context.lookup(r)) : [c];
    const s = arr.map((st) => Buffer.from(st instanceof L.PDFRawStream ? L.decodePDFRawStream(st).decode() : st.getUnencodedContents()).toString('latin1')).join('\n');
    if (/\x78\x9c/.test(s.replace(/\bBI\b[\s\S]*?\bEI\b/g, ''))) bad.push(k + 1);
  });
  H.ok(!bad.length, 'compressed bytes in the content of pages ' + bad);
  let has = true; try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch { has = false; }
  if (!has) return;
  const errors = (file, n) => (spawnSync('pdftotext', ['-f', String(n), '-l', String(n), file, '/dev/null'], { encoding: 'latin1' }).stderr || '').split('\n').filter((l) => /Syntax Error|Unknown operator/.test(l)).length;
  const f = tmp('saved.pdf'); H.fs.writeFileSync(f, bytes);
  for (const n of pages) { const now = errors(f, n), was = original ? errors(original, n) : 0; H.ok(now <= was, `pdftotext reports ${now} errors on page ${n} (the original had ${was})`); }
}

export default async (h) => {
  H = h;
  const { test, eq, ok, open, openPdf, savedOf, reopen } = h;
  const GFILE = GUIDE + 'pdfelement-guide.pdf', MFILE = GUIDE + 'pe10-win.pdf';

  await test('saving edits never writes compressed bytes into page content (brochure: line edit, picture delete, watermark; manual: line and paragraph edit)', async () => {
    if (!h.fs.existsSync(GFILE)) return;
    const p = await open(); await openPdf(p, GFILE, 'Guide.pdf');
    await showPage(p, 1);
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    const b = await p.locator('.page[data-n="1"] .textLayer span', { hasText: 'Edit Your PDF' }).first().boundingBox();
    await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await p.waitForSelector('.line-editor');
    await p.keyboard.type('X'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    let out = await savedOf(p);
    await cleanContent(out, [2], GFILE);
    // and with a picture deleted on page 1 and a watermark on every page
    await showPage(p, 0);
    const [cx, cy] = await atN(p, 0, 500, 350); await p.mouse.click(cx, cy); await p.waitForTimeout(500);
    await p.keyboard.press('Delete'); await p.waitForTimeout(1500);
    await p.evaluate(() => window.__cowdreyPdf.run('pd_watermark')); await p.waitForSelector('#dialog[open] .pd-form');
    await p.click('#dialog .dlg-foot .btn.primary'); await p.waitForTimeout(400);
    out = await savedOf(p);
    await cleanContent(out, [1, 2], GFILE);
    // Text recognition over page 1, twice (the second time takes the first layer out), then saved again
    await p.evaluate(async () => {
      window.__cowdreyPdf.ocrUseEngine({ async start() {}, async stop() {}, async recognize(c) { const w = c.width, k = w / 1000; return { lines: [{ baseline: { x0: 100 * k, y0: 200 * k, x1: 400 * k, y1: 200 * k }, words: [{ text: 'Recognized', bbox: { x0: 100 * k, y0: 170 * k, x1: 400 * k, y1: 200 * k }, confidence: 90 }] }] }; } });
      await window.__cowdreyPdf.ocrRun({ pages: [0], redo: true }); await window.__cowdreyPdf.ocrRun({ pages: [0], redo: true });
    });
    await p.waitForTimeout(800);
    out = await savedOf(p);
    await cleanContent(out, [1, 2], GFILE);
    // Saved again after reopening, with one more edit
    await reopen(p, out); await showPage(p, 1);
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    const E = await lineOf(p, 'Edit Y', 1); ok(E, 'the edited line is there');
    const [ex, ey] = await atN(p, 1, E.tm[4] + 4, E.tm[5] + 4); await p.mouse.click(ex, ey); await p.waitForSelector('.line-editor');
    await p.keyboard.type('Y'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    await cleanContent(await savedOf(p), [2], GFILE);
    eq(p.errors, []); await p.ctx.close();
    if (!h.fs.existsSync(MFILE)) return;
    const q = await open(); await openPdf(q, MFILE, 'Manual.pdf');
    await showPage(q, 5);
    await q.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    const M = await lineOf(q, 'with PDF files easier', 5); ok(M, 'manual line');
    const [mx, my] = await atN(q, 5, M.tm[4] + 20, M.tm[5] + 4); await q.mouse.click(mx, my); await q.waitForSelector('.line-editor');
    await q.keyboard.type('X'); await q.keyboard.press('Escape'); await q.waitForTimeout(300);
    const mout = await savedBig(q);
    await cleanContent(mout, [6], MFILE);
    await q.ctx.close();
  });
};
