// Saving after page changes (src/app.js buildPdf): the opened PDF is kept and its pages rearranged, so files don't
// grow, and bookmarks, named destinations, form fields and document info survive. Also the forms save step.
import os from 'node:os';
export default async (h) => {
  const { test, eq, ok, open, openPdf, path, fs, require, root, savedOf } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const { PDFName, PDFDict, PDFArray, PDFRef, PDFString, PDFHexString, PDFNumber } = L;
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
  const goTo = (p, n) => p.evaluate((k) => window.__cowdreyPdf.views()[k].el.scrollIntoView(), n).then(() => p.waitForTimeout(400));
  const tmp = (name) => path.join(os.tmpdir(), `save-${process.pid}-${name}`);

  // word.pdf three times over, its pages sharing fonts and pictures as a real multi-page file does.
  const word3 = tmp('word3.pdf');
  { const src = await L.PDFDocument.load(fs.readFileSync(path.join(root, 'tests/fixtures/word.pdf')));
    const d = await L.PDFDocument.create(), [p0] = await d.copyPages(src, [0]); d.addPage(p0);
    for (let k = 0; k < 2; k++) { const pg = d.addPage([p0.getWidth(), p0.getHeight()]); for (const key of ['Resources', 'Contents']) pg.node.set(PDFName.of(key), p0.node.get(PDFName.of(key))); }
    fs.writeFileSync(word3, await d.save()); }

  // Four pages that say their names, with bookmarks (one nested, one by name), named destinations and document info.
  const bm = tmp('bm.pdf');
  { const d = await L.PDFDocument.create(), f = await d.embedFont(L.StandardFonts.Helvetica), c = d.context;
    for (const n of ['One', 'Two', 'Three', 'Four']) d.addPage([400, 500]).drawText(n, { x: 50, y: 400, size: 24, font: f });
    const pg = d.getPages(), dest = (k) => c.obj([pg[k].ref, PDFName.of('XYZ'), null, 500, null]);
    const outlines = c.nextRef(), refs = [0, 1, 2, 3, 4].map(() => c.nextRef());
    const item = (k, title, extra) => c.obj({ Title: PDFHexString.fromText(title), Parent: outlines, ...extra });
    c.assign(refs[0], item(0, 'Page one', { Dest: dest(0), Next: refs[1] }));
    c.assign(refs[1], item(1, 'Page two', { Dest: dest(1), Prev: refs[0], Next: refs[2], First: refs[4], Last: refs[4], Count: 1 }));
    c.assign(refs[4], c.obj({ Title: PDFHexString.fromText('Page three (under two)'), Parent: refs[1], Dest: dest(2) }));
    c.assign(refs[2], item(2, 'Page three', { A: { S: 'GoTo', D: PDFString.of('third') }, Prev: refs[1], Next: refs[3] }));
    c.assign(refs[3], item(3, 'Page four', { Dest: dest(3), Prev: refs[2] }));
    c.assign(outlines, c.obj({ Type: 'Outlines', First: refs[0], Last: refs[3], Count: 5 }));
    d.catalog.set(PDFName.of('Outlines'), outlines);
    d.catalog.set(PDFName.of('Names'), c.obj({ Dests: c.obj({ Names: [PDFString.of('fourth'), dest(3), PDFString.of('third'), dest(2)] }) }));
    d.setTitle('Annual Plan 2026'); d.setAuthor('Jane Doe'); d.setSubject('Plans'); d.setKeywords(['plan', '2026']);
    fs.writeFileSync(bm, await d.save()); }

  // The saved outline as [title, page number or null, children]; also the named destinations as name: page.
  const outline = (d) => {
    const pages = d.getPages().map((p) => p.ref.tag), look = (o) => o instanceof PDFRef ? d.context.lookup(o) : o;
    const named = {};
    const names = look(d.catalog.get(PDFName.of('Names'))), tree = names && look(names.get(PDFName.of('Dests')));
    const arr = tree && look(tree.get(PDFName.of('Names')));
    if (arr instanceof PDFArray) for (let k = 0; k < arr.size(); k += 2) named[look(arr.get(k)).decodeText()] = look(arr.get(k + 1));
    const pageOf = (dst) => { dst = look(dst); if (dst instanceof PDFString || dst instanceof PDFHexString) dst = named[dst.decodeText()]; return dst instanceof PDFArray ? pages.indexOf(dst.get(0).tag) + 1 : null; };
    const walk = (node) => {
      const out = []; let r = node.get(PDFName.of('First'));
      while (r) {
        const it = look(r), a = look(it.get(PDFName.of('A')));
        const t = pageOf(it.get(PDFName.of('Dest')) || (a instanceof PDFDict ? a.get(PDFName.of('D')) : null));
        out.push(it.get(PDFName.of('First')) ? [look(it.get(PDFName.of('Title'))).decodeText(), t, walk(it)] : [look(it.get(PDFName.of('Title'))).decodeText(), t]);
        r = it.get(PDFName.of('Next'));
      }
      return out;
    };
    const o = look(d.catalog.get(PDFName.of('Outlines')));
    return { items: o ? walk(o) : [], count: o ? o.lookup(PDFName.of('Count'), PDFNumber).asNumber() : 0, named: Object.fromEntries(Object.entries(named).map(([k, v]) => [k, pages.indexOf(v.get(0).tag) + 1])) };
  };
  const texts = async (bytes) => {
    const p = await open(); await p.evaluate(async (b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); await window.__cowdreyPdf.openBytes(u, 'x.pdf'); }, bytes.toString('base64'));
    await p.waitForTimeout(800);
    const t = await p.evaluate(() => Promise.all(window.__cowdreyPdf.views().map(async (v) => (await v.page.getTextContent()).items.map((i) => i.str).join('').trim())));
    await p.ctx.close(); return t;
  };

  await test('save: moving a page keeps the file size (fonts and pictures stay shared); deleting one makes it smaller', async () => {
    const p = await open(); await openPdf(p, word3, 'Word.pdf');
    const plain = (await savedOf(p)).length;
    await run(p, 'down'); await p.waitForTimeout(300);
    const moved = (await savedOf(p)).length;
    ok(Math.abs(moved - plain) / plain < .1, `moved ${moved} vs plain ${plain}`);
    await goTo(p, 0); await run(p, 'delPage'); await p.waitForTimeout(300);
    const del = await savedOf(p);
    ok(del.length < plain * 1.1, `deleted ${del.length} vs plain ${plain}`);
    eq((await L.PDFDocument.load(del)).getPageCount(), 2);
    // Extract copies each source once, so two pages cost about what one does
    const ex = Buffer.from(await p.evaluate(async () => Array.from(await window.__cowdreyPdf.buildPdf([0, 1]))));
    ok(ex.length < plain * 1.1, `extract ${ex.length} vs plain ${plain}`);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('save: bookmarks, named destinations and document info survive deleting and moving pages', async () => {
    const p = await open(); await openPdf(p, bm, 'Annual plan.pdf');
    let d = await L.PDFDocument.load(await savedOf(p));
    eq(d.getTitle(), 'Annual Plan 2026', 'title kept on a plain save');
    eq(outline(d).items, [['Page one', 1], ['Page two', 2, [['Page three (under two)', 3]]], ['Page three', 3], ['Page four', 4]]);
    await goTo(p, 2); await run(p, 'delPage'); await p.waitForTimeout(300); // delete "Three"
    await goTo(p, 0); await run(p, 'down'); await p.waitForTimeout(300); // Two, One, Four
    const bytes = await savedOf(p); d = await L.PDFDocument.load(bytes, { updateMetadata: false });
    const o = outline(d);
    eq(o.items, [['Page one', 2], ['Page two', 1], ['Page four', 3]]);
    eq(o.count, 3); eq(o.named, { fourth: 3 });
    eq([d.getTitle(), d.getAuthor(), d.getSubject(), d.getKeywords()], ['Annual Plan 2026', 'Jane Doe', 'Plans', 'plan 2026']);
    eq(await texts(bytes), ['Two', 'One', 'Four']);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('save: a PDF with no title gets the file name as its title', async () => {
    const p = await open(); await openPdf(p, path.join(root, 'tests/fixtures/chrome.pdf'), 'Untitled page.pdf');
    eq((await L.PDFDocument.load(await savedOf(p))).getTitle(), 'Untitled page');
    await p.ctx.close();
  });

  await test('save: filled form fields stay fields after moving, deleting, duplicating pages and adding a blank page', async () => {
    const p = await open(); await openPdf(p);
    await p.fill('.annotationLayer input[name="name"]', 'Jane Q'); await p.click('.annotationLayer .checkBox input'); await p.waitForTimeout(200);
    const check = async (what, pages) => {
      const d = await L.PDFDocument.load(await savedOf(p)), f = d.getForm();
      eq(d.getPageCount(), pages, what);
      ok(f.getFields().length >= 2, `${what}: ${f.getFields().length} fields`);
      eq([f.getTextField('name').getText(), f.getCheckBox('agree').isChecked()], ['Jane Q', true], what);
      // every field's widget is on a page of the saved PDF
      const tags = new Set(d.getPages().map((pg) => pg.ref.tag));
      for (const fl of f.getFields()) for (const w of fl.acroField.getWidgets()) ok(tags.has(w.P().tag), `${what}: ${fl.getName()} on a page`);
    };
    await goTo(p, 0); await run(p, 'down'); await p.waitForTimeout(300); await check('move', 3);
    await goTo(p, 2); await run(p, 'delPage'); await p.waitForTimeout(300); await check('delete', 2);
    await goTo(p, 1); await run(p, 'dup'); await p.waitForTimeout(300); await check('duplicate', 3);
    await goTo(p, 0); await run(p, 'blank'); await p.waitForTimeout(500); await check('blank page', 4);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('save: deleting the page with the fields removes them from the form', async () => {
    const p = await open(); await openPdf(p);
    await goTo(p, 0); await run(p, 'delPage'); await p.waitForTimeout(300);
    const d = await L.PDFDocument.load(await savedOf(p));
    eq(d.getForm().getFields().map((f) => f.getName()), []);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('save: merging another PDF keeps this one\'s filled fields and adds the other\'s pages in order', async () => {
    const p = await open(); await openPdf(p);
    await p.fill('.annotationLayer input[name="name"]', 'Jane Q'); await p.waitForTimeout(200);
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), run(p, 'merge')]);
    await fc.setFiles(bm); await p.waitForSelector('#dialog[open] .pg60-file'); await p.click('#dialog .btn.primary'); // Combine
    await p.waitForFunction(() => window.__cowdreyPdf.doc.pages.length === 7, null, { timeout: 10000 });
    const bytes = await savedOf(p), d = await L.PDFDocument.load(bytes);
    eq(d.getPageCount(), 7); eq(d.getForm().getTextField('name').getText(), 'Jane Q');
    eq((await texts(bytes)).slice(3), ['One', 'Two', 'Three', 'Four']);
    eq(p.errors, []); await p.ctx.close();
  });
};
