// Accessibility: tags kept through page deletes and merges, what the app adds is tagged, alt text, auto-tagging,
// reading order, the accessibility check, PDF/UA, and bookmarks from headings (and their styles and actions).
export default async (h) => {
  const { test, open, openPdf, eq, ok, savedOf, reopen, require, path, root, fs, WORD } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const N = (s) => L.PDFName.of(s);
  const tmp = (name) => path.join(require('node:os').tmpdir(), `cowdrey-acc-${process.pid}-${name}.pdf`);
  const SAMPLE = path.join(root, 'tests/fixtures/sample.pdf');

  // A tagged PDF: each page has an H1 (MCID 0) and a P (MCID 1) under a Document element, with a ParentTree.
  async function taggedPdf(label, n, file) {
    const d = await L.PDFDocument.create(), f = await d.embedFont(L.StandardFonts.Helvetica), c = d.context;
    const rootRef = c.nextRef(), docRef = c.nextRef(), nums = [], kids = [];
    for (let i = 0; i < n; i++) {
      const pg = d.addPage([612, 792]); pg.node.setFontDictionary(N('F1'), f.ref);
      const s = `/H1 <</MCID 0>> BDC BT /F1 24 Tf 72 700 Td (${label} heading ${i + 1}) Tj ET EMC\n/P <</MCID 1>> BDC BT /F1 12 Tf 72 660 Td (${label} body text on page ${i + 1}.) Tj ET EMC\n`;
      pg.node.set(N('Contents'), c.register(c.stream(s)));
      pg.node.set(N('StructParents'), L.PDFNumber.of(i));
      const hh = c.register(c.obj({ Type: 'StructElem', S: 'H1', P: docRef, Pg: pg.ref, K: 0 }));
      const pp = c.register(c.obj({ Type: 'StructElem', S: 'P', P: docRef, Pg: pg.ref, K: 1 }));
      kids.push(hh, pp); nums.push(L.PDFNumber.of(i), c.register(c.obj([hh, pp])));
    }
    c.assign(docRef, c.obj({ Type: 'StructElem', S: 'Document', P: rootRef, K: kids }));
    const pt = c.obj({}); pt.set(N('Nums'), c.obj(nums));
    c.assign(rootRef, c.obj({ Type: 'StructTreeRoot', K: docRef, ParentTree: c.register(pt), ParentTreeNextKey: n, RoleMap: { Heading: 'H1' } }));
    d.catalog.set(N('StructTreeRoot'), rootRef); d.catalog.set(N('MarkInfo'), c.obj({ Marked: true })); d.catalog.set(N('Lang'), L.PDFString.of('en'));
    d.setTitle(label + ' report');
    fs.writeFileSync(file, await d.save()); return file;
  }
  // The saved tree: each element as { S, pg (page index or null), mc: [MCIDs], alt, kids, objr }.
  const treeOf = (d) => {
    const refs = d.getPages().map((p) => p.ref.toString());
    const rt = d.catalog.lookup(N('StructTreeRoot')); if (!rt) return null;
    const look = (o) => (o instanceof L.PDFRef ? d.context.lookup(o) : o);
    const kidsOf = (e) => { const k = e.get(N('K')); if (!k) return []; const o = look(k); return o instanceof L.PDFArray ? o.asArray() : [k]; };
    const walk = (e) => kidsOf(e).filter((k) => k instanceof L.PDFRef).map((k) => {
      const x = look(k); const pg = x.get(N('Pg'));
      const mc = kidsOf(x).map(look).filter((o) => o instanceof L.PDFNumber).map((o) => o.asNumber());
      const objr = kidsOf(x).map(look).filter((o) => o instanceof L.PDFDict && String(o.get(N('Type'))) === '/OBJR').map((o) => String(o.get(N('Obj'))));
      const alt = x.lookup(N('Alt')); return { ref: k.toString(), S: String(x.get(N('S'))).slice(1), pg: pg ? refs.indexOf(String(pg)) : null, pgRef: pg ? String(pg) : null, mc, objr, alt: alt ? alt.decodeText() : null, kids: walk(x) };
    });
    return walk(rt);
  };
  const flat = (t, out = []) => { for (const e of t || []) { out.push(e); flat(e.kids, out); } return out; };
  const parentTree = (d) => {
    const rt = d.catalog.lookup(N('StructTreeRoot')), pt = rt.lookup(N('ParentTree')), m = new Map();
    const take = (node) => { const nums = node.lookup(N('Nums')); if (nums) { const a = nums.asArray(); for (let i = 0; i + 1 < a.length; i += 2) m.set(a[i].asNumber(), d.context.lookup(a[i + 1]) || a[i + 1]); } const kids = node.lookup(N('Kids')); if (kids) for (const k of kids.asArray()) take(d.context.lookup(k)); };
    take(pt); return { map: m, next: rt.lookup(N('ParentTreeNextKey')).asNumber() };
  };
  const streamOf = (d, n) => {
    const pg = d.getPage(n), c = pg.node.Contents(), list = c instanceof L.PDFArray ? c.asArray().map((r) => d.context.lookup(r)) : [c];
    return list.map((s) => Buffer.from(s instanceof L.PDFRawStream ? L.decodePDFRawStream(s).decode() : s.getContents()).toString('latin1')).join('\n');
  };
  const bdcMcids = (s) => [...s.matchAll(/\/MCID\s+(\d+)/g)].map((m) => +m[1]).sort((a, b) => a - b);
  // pdf.js's view of a page's tags (in the app, after reopening the saved file).
  const pdfjsTree = (p, n = 0) => p.evaluate(async (k) => { const v = window.__cowdreyPdf.views()[k]; return v.page.getStructTree(); }, n);
  const findNode = (t, fn) => { if (!t) return null; if (fn(t)) return t; for (const c of t.children || []) { const r = findNode(c, fn); if (r) return r; } return null; };
  const jump = async (p, n) => {
    await p.$eval('#pageJump', (e, v) => { e.value = v; e.dispatchEvent(new Event('change')); }, String(n));
    await p.waitForFunction((k) => window.__cowdreyPdf.current === k, n - 1, { timeout: 5000 }); await p.waitForTimeout(500);
  };
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id).then(() => p.waitForTimeout(300));

  await test('Accessibility: a tagged PDF with a page deleted keeps the tags of the other pages only, with a new ParentTree', async () => {
    const f = await taggedPdf('Alpha', 3, tmp('a'));
    const p = await open(); await openPdf(p, f, 'Alpha.pdf');
    await jump(p, 2); await run(p, 'delPage');
    const bytes = await savedOf(p), d = await L.PDFDocument.load(bytes);
    eq(d.getPageCount(), 2);
    const all = flat(treeOf(d)), pageRefs = d.getPages().map((x) => x.ref.toString());
    ok(all.every((e) => e.pgRef == null || pageRefs.includes(e.pgRef)), 'every /Pg is a page of the document: ' + JSON.stringify(all.map((e) => e.pgRef)));
    eq(all.filter((e) => e.S === 'H1').map((e) => e.pg), [0, 1]);
    const { map, next } = parentTree(d), keys = d.getPages().map((x) => x.node.get(N('StructParents')).asNumber());
    eq([...map.keys()].sort(), keys.slice().sort(), 'the ParentTree has the remaining pages only');
    eq(next, 2);
    keys.forEach((k, i) => { const arr = map.get(k).asArray(); eq(arr.map((r) => String(d.context.lookup(r).get(N('Pg')))), [pageRefs[i], pageRefs[i]]); });
    ok(!d.context.enumerateIndirectObjects().some(([, o]) => o instanceof L.PDFDict && String(o.get(N('S'))) === '/H1' && String(o.get(N('Pg'))) && !pageRefs.includes(String(o.get(N('Pg'))))), 'the deleted page’s tags are not left in the file');
    // pdf.js reads the tags of what was page 3 as the new page 2
    await reopen(p, bytes);
    const t = await pdfjsTree(p, 1);
    ok(findNode(t, (x) => x.role === 'H1'), 'pdf.js sees the heading: ' + JSON.stringify(t));
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Accessibility: combining two tagged PDFs keeps both trees; each page’s StructParents and MCIDs match its content', async () => {
    const a = await taggedPdf('Alpha', 2, tmp('ma')), b = await taggedPdf('Bravo', 2, tmp('mb'));
    const p = await open(); await openPdf(p, a, 'Alpha.pdf');
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), run(p, 'merge')]);
    await fc.setFiles([b]); await p.waitForSelector('#dialog[open] .pg60-file'); await p.waitForTimeout(300);
    await p.click('#dialog .btn.primary'); await p.waitForFunction(() => window.__cowdreyPdf.doc.pages.length === 4, null, { timeout: 10000 }); await p.waitForTimeout(500);
    const bytes = await savedOf(p), d = await L.PDFDocument.load(bytes);
    const t = treeOf(d), all = flat(t);
    ok(all.some((e) => e.S === 'Part'), 'the added PDF’s tags are under a Part');
    eq(all.filter((e) => e.S === 'H1').map((e) => e.pg), [0, 1, 2, 3]);
    eq(all.filter((e) => e.S === 'P').map((e) => e.pg), [0, 1, 2, 3]);
    const { map } = parentTree(d), refs = d.getPages().map((x) => x.ref.toString());
    for (let i = 0; i < 4; i++) {
      const k = d.getPage(i).node.get(N('StructParents')).asNumber(), arr = map.get(k).asArray();
      ok(arr.every((r) => String(d.context.lookup(r).get(N('Pg'))) === refs[i]), `page ${i + 1}: its ParentTree entries point at it`);
      eq(arr.map((x, j) => j), bdcMcids(streamOf(d, i)), `page ${i + 1}: MCIDs match the content`);
    }
    const rm = d.catalog.lookup(N('StructTreeRoot')).lookup(N('RoleMap'));
    eq(String(rm.get(N('Heading'))), '/H1', 'role map kept');
    await reopen(p, bytes);
    await jump(p, 3);
    const t3 = await pdfjsTree(p, 2);
    ok(findNode(t3, (x) => x.role === 'H1'), 'pdf.js sees the copied heading: ' + JSON.stringify(t3));
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Accessibility: on a tagged page, a highlight is a tagged comment, a picture is decoration and added text is a new P', async () => {
    const f = await taggedPdf('Alpha', 1, tmp('c'));
    const p = await open(); await openPdf(p, f, 'Alpha.pdf');
    await p.click('[data-rt="markup"]'); await p.click('[data-cmd="tool_highlight"]'); await h.selectText(p, 0, 'Alpha body'); await p.waitForTimeout(300);
    const g = await p.locator('.page[data-n="0"]').boundingBox();
    await p.click('[data-rt="edit"]'); await p.click('[data-cmd="tool_text"]'); await p.mouse.click(g.x + 100, g.y + 400);
    await p.waitForSelector('.page .txt-editor'); await p.keyboard.type('Approved by the board'); await p.keyboard.press('Escape');
    await p.waitForFunction(() => Object.values(window.__cowdreyPdf.doc.marks).flat().some((m) => m.type === 'text'), null, { timeout: 10000 });
    // a signature (a picture drawn on the page)
    await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 20; c.height = 10; const x = c.getContext('2d'); x.fillStyle = '#123'; x.fillRect(0, 0, 20, 10); const doc = window.__cowdreyPdf.doc; doc.marks['0:0'].push({ id: 'sig1', type: 'img', x: 300, y: 300, w: 80, h: 40, data: c.toDataURL('image/png'), rot: 0 }); });
    const bytes = await savedOf(p), d = await L.PDFDocument.load(bytes), s = streamOf(d, 0);
    ok(/\/Artifact BMC\s+q[\s\S]*?Do[\s\S]*?Q\s+EMC/.test(s), 'the signature is decoration: ' + s.slice(-600));
    const m = /\/P <<\s*\/MCID (\d+)\s*>> BDC([\s\S]*?)EMC/.exec(s.slice(s.indexOf('EMC', s.lastIndexOf('/P <</MCID 1>>')) + 3));
    ok(m && /Tj/.test(m[2]), 'the added text is marked content: ' + s);
    const mcid = +m[1]; eq(mcid, 2);
    const all = flat(treeOf(d)), added = all.find((e) => e.S === 'P' && e.mc.includes(mcid));
    ok(added && added.pg === 0, 'a P element for the added text');
    const annots = d.getPage(0).node.Annots().asArray(), hl = annots.find((r) => String(d.context.lookup(r).get(N('Subtype'))) === '/Highlight');
    ok(hl, 'the highlight is a comment');
    ok(all.some((e) => e.S === 'Annot' && e.objr.includes(hl.toString())), 'the highlight is tagged as an Annot');
    ok(d.context.lookup(hl).get(N('StructParent')), 'with its StructParent');
    const { map } = parentTree(d), arr = map.get(d.getPage(0).node.get(N('StructParents')).asNumber()).asArray();
    eq(arr.map((x, j) => j), bdcMcids(s), 'the ParentTree has the new MCID');
    eq(String(d.getPage(0).node.get(N('Tabs'))), '/S');
    await reopen(p, bytes);
    const t = await pdfjsTree(p, 0);
    ok(findNode(t, (x) => x.role === 'P' && (x.children || []).some((c) => c.id && c.id.endsWith('_mc' + mcid))), 'pdf.js sees the new paragraph');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Accessibility: alt text on a picture of word.pdf is a Figure with /Alt, which pdf.js reads; decorative pictures are artifacts', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await run(p, 'acAlt'); await p.waitForSelector('#dialog[open] .ac-alt-row');
    eq(await p.$$eval('#dialog .ac-alt-row', (r) => r.length), 1);
    await p.waitForFunction(() => { const i = document.querySelector('#dialog .ac-thumb'); return i && i.src && i.src.startsWith('data:image/png'); }, null, { timeout: 8000 });
    await p.fill('#dialog [data-alt="0"]', 'Company logo');
    await p.click('#dialog .btn.primary'); await p.waitForTimeout(300);
    const bytes = await savedOf(p), d = await L.PDFDocument.load(bytes), s = streamOf(d, 0);
    ok(/\/Figure <<\s*\/MCID 0\s*>> BDC\s*(q\s+)?[^]*?\/Image-\d+ Do\s*(Q\s*)?EMC|\/Figure <<\s*\/MCID 0\s*>> BDC\s*\/Image-\d+ Do/.test(s), 'the picture is marked: ' + s);
    const fig = flat(treeOf(d)).find((e) => e.S === 'Figure');
    ok(fig && fig.alt === 'Company logo' && fig.mc[0] === 0 && fig.pg === 0, JSON.stringify(fig));
    await reopen(p, bytes);
    const t = await pdfjsTree(p, 0);
    ok(findNode(t, (x) => x.role === 'Figure' && x.alt === 'Company logo'), 'pdf.js reads the alt text: ' + JSON.stringify(t));
    // the app's screen reader layer has it too
    await p.waitForSelector('.page[data-n="0"] .ac-tree [role="img"][aria-label="Company logo"]', { state: 'attached', timeout: 5000 });
    // the saved alt text shows when the panel opens again, and marking it decorative makes it an artifact
    await run(p, 'acAlt'); await p.waitForSelector('#dialog[open] .ac-alt-row');
    eq(await p.inputValue('#dialog [data-alt="0"]'), 'Company logo');
    await p.check('#dialog [data-deco="0"]'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(300);
    const d2 = await L.PDFDocument.load(await savedOf(p)), s2 = streamOf(d2, 0);
    ok(/\/Artifact BMC\s*\/Image-\d+ Do/.test(s2) && !/\/Figure/.test(s2), 'decorative: ' + s2);
    ok(!flat(treeOf(d2)).some((e) => e.S === 'Figure' && e.mc.length), 'no figure element with content');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Accessibility: Add tags automatically on sample.pdf: H1 then P in reading order, MarkInfo, form fields tagged; the check passes but for what needs a person', async () => {
    const p = await open(); await openPdf(p, SAMPLE);
    eq(await p.evaluate(() => window.__cowdreyPdf.cmdEnabled('acAutoTag')), true);
    await run(p, 'acAutoTag'); await p.waitForTimeout(500);
    eq(await p.evaluate(() => window.__cowdreyPdf.cmdEnabled('acAutoTag')), false, 'once');
    // one undo step
    await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
    eq(await p.evaluate(() => (window.__cowdreyPdf.doc.marks.__doc || []).some((m) => m.type === 'autotag')), false, 'undone');
    await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(200);
    const bytes = await savedOf(p), d = await L.PDFDocument.load(bytes);
    eq(String(d.catalog.lookup(N('MarkInfo')).get(N('Marked'))), 'true');
    const t = treeOf(d); eq(t.length, 1); eq(t[0].S, 'Document');
    const top = t[0].kids.map((e) => `${e.S}@${e.pg}`);
    eq(top.filter((x) => !/^Form/.test(x)), ['H1@0', 'P@0', 'P@0', 'P@0', 'H1@1', 'P@1', 'H1@2', 'P@2'], JSON.stringify(top));
    eq(top.filter((x) => /^Form/.test(x)).length, 2, 'the text field and the checkbox');
    for (let i = 0; i < 3; i++) { const s = streamOf(d, i); ok(/\/H1 <<\s*\/MCID 0\s*>> BDC/.test(s) && /\/P <<\s*\/MCID 1\s*>> BDC/.test(s), `page ${i + 1} marked: ` + s.slice(0, 400)); eq(String(d.getPage(i).node.get(N('Tabs'))), '/S'); }
    const { map } = parentTree(d);
    for (let i = 0; i < 3; i++) eq(map.get(d.getPage(i).node.get(N('StructParents')).asNumber()).asArray().map((x, j) => j), bdcMcids(streamOf(d, i)));
    const w = d.getPage(0).node.Annots().asArray().filter((r) => String(d.context.lookup(r).get(N('Subtype'))) === '/Widget');
    ok(w.every((r) => d.context.lookup(r).get(N('StructParent'))), 'widgets have StructParent');
    // the check: fix what can be fixed, the rest needs a person (here: the fonts are not embedded)
    let items = await p.evaluate(() => window.__cowdreyPdf.acCheck());
    const fails = (xs) => xs.filter((x) => !x.ok && x.level === 'error').map((x) => x.id);
    ok(fails(items).includes('lang') && fails(items).includes('dtitle'), JSON.stringify(fails(items)));
    ok(!fails(items).includes('tagged') && !fails(items).includes('content') && !fails(items).includes('annots'), JSON.stringify(items.filter((x) => !x.ok)));
    await p.evaluate(() => window.__cowdreyPdf.acFixSet('lang', 'en-US')); await p.evaluate(() => window.__cowdreyPdf.acFixSet('dtitle', true));
    items = await p.evaluate(() => window.__cowdreyPdf.acCheck());
    eq(fails(items).filter((id) => !['alt', 'headings', 'tables', 'fonts', 'unicode', 'js'].includes(id)), [], JSON.stringify(items.filter((x) => !x.ok)));
    const saved2 = await L.PDFDocument.load(await savedOf(p));
    eq(saved2.catalog.lookup(N('Lang')).decodeText(), 'en-US');
    eq(String(saved2.catalog.lookup(N('ViewerPreferences')).get(N('DisplayDocTitle'))), 'true');
    await reopen(p, bytes);
    const tt = await pdfjsTree(p, 0);
    ok(tt && findNode(tt, (x) => x.role === 'H1') && findNode(tt, (x) => x.role === 'P'), 'pdf.js tree: ' + JSON.stringify(tt));
    // the reader layer: a heading for screen readers, the loose text layer hidden from them
    await p.waitForSelector('.page[data-n="0"] .ac-tree h1', { state: 'attached', timeout: 5000 });
    eq(await p.$eval('.page[data-n="0"] .ac-tree h1', (e) => e.textContent.trim()), 'Quarterly report, page 1');
    eq(await p.$eval('.page[data-n="0"] .textLayer', (e) => e.getAttribute('aria-hidden')), 'true');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Accessibility: the check lists a figure without alt text until it has some; the dialog shows results with Fix buttons', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    let items = await p.evaluate(() => window.__cowdreyPdf.acCheck());
    ok(items.find((x) => x.id === 'tagged' && !x.ok && x.fix === 'autotag'), 'untagged, with Add tags');
    await run(p, 'acAutoTag'); await p.waitForTimeout(400);
    items = await p.evaluate(() => window.__cowdreyPdf.acCheck());
    const alt = items.find((x) => x.id === 'alt');
    eq([alt.ok, alt.label], [false, 'Figure without alt text']);
    // the dialog
    await run(p, 'acCheck'); await p.waitForSelector('#dialog[open] .ac-results');
    ok((await p.textContent('#dialog')).includes('Figure without alt text'), 'listed');
    ok(await p.$('#dialog [data-fix="lang"]'), 'a Fix button for the language');
    await p.click('#dialog [data-fix="lang"]');
    await p.waitForSelector('#dialog[open] #dlgInput'); await p.fill('#dlgInput', 'en-GB'); await p.click('#dialog .btn.primary');
    await p.waitForSelector('#dialog[open] .ac-results'); await p.waitForTimeout(200);
    ok(!(await p.$('#dialog [data-fix="lang"]')), 'fixed: ' + await p.textContent('#dialog'));
    await p.click('#dialog .btn.primary');
    // alt text (stored for the picture) goes on the auto-tagged figure
    const rows = await p.evaluate(() => window.__cowdreyPdf.acPictures());
    eq(rows.length, 1);
    await p.evaluate(() => window.__cowdreyPdf.acSaveAlt([{ k: 0, alt: 'Company logo' }]));
    items = await p.evaluate(() => window.__cowdreyPdf.acCheck());
    eq(items.find((x) => x.id === 'alt').ok, true, 'no figure without alt text after');
    ok(!items.some((x) => !x.ok && x.label === 'Figure without alt text'));
    const d = await L.PDFDocument.load(await savedOf(p));
    ok(flat(treeOf(d)).some((e) => e.S === 'Figure' && e.alt === 'Company logo'), 'the figure has its alt text');
    eq(d.catalog.lookup(N('Lang')).decodeText(), 'en-GB');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Accessibility: Save as PDF/UA refuses while there are problems, else writes pdfuaid:part 1 in the XMP', async () => {
    const p = await open(); await openPdf(p, SAMPLE);
    await run(p, 'acSaveUA'); await p.waitForSelector('#dialog[open]');
    eq(await p.textContent('#dialog h2'), 'Not ready for PDF/UA');
    ok((await p.textContent('#dialog')).includes('The PDF has no tags'), 'lists the problems');
    await p.click('#dialog .dlg-foot .btn:text-is("Close")');
    await run(p, 'acAutoTag');
    await p.evaluate(() => window.__cowdreyPdf.acFixSet('lang', 'en-US')); await p.evaluate(() => window.__cowdreyPdf.acFixSet('dtitle', true));
    const bytes = Buffer.from(await p.evaluate(() => window.__cowdreyPdf.acSaveUABytes()));
    const d = await L.PDFDocument.load(bytes), md = d.catalog.lookup(N('Metadata'));
    const xmp = Buffer.from(md.getContents()).toString('utf8');
    ok(/<pdfuaid:part>1<\/pdfuaid:part>/.test(xmp) && /xmlns:pdfuaid="http:\/\/www.aiim.org\/pdfua\/ns\/id\/"/.test(xmp), xmp);
    ok(/<dc:title>[\s\S]*Quarterly report/.test(xmp), 'with the title');
    eq(String(md.dict.get(N('Subtype'))), '/XML');
    // a plain save does not claim PDF/UA
    const plain = await L.PDFDocument.load(await savedOf(p)), pm = plain.catalog.lookup(N('Metadata'));
    ok(!pm || !/pdfuaid/.test(Buffer.from(pm.getContents()).toString('utf8')), 'plain save');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Accessibility: reading order lists the tags of the page; moving and retagging are saved (added tags and the PDF’s own)', async () => {
    const p = await open(); await openPdf(p, SAMPLE);
    await run(p, 'acAutoTag'); await run(p, 'acOrder');
    await p.waitForSelector('#acOrder .ac-item'); await p.waitForTimeout(300);
    const roles = await p.$$eval('#acOrder .ac-item select', (s) => s.map((x) => x.value));
    eq(roles, ['H1', 'P', 'P', 'P']);
    ok(await p.$('.page[data-n="0"] svg.ac-ord .ac-box'), 'numbered boxes on the page');
    // the second paragraph up, before the first; then the heading becomes H2
    const m = await p.evaluate(() => window.__cowdreyPdf.acOrderModel(0));
    await p.evaluate(([a, b]) => window.__cowdreyPdf.acOrderEdit({ op: 'move', id: a, before: b }), [m.items[2].id, m.items[1].id]);
    await p.selectOption('#acOrder .ac-item:first-child select', 'H2'); await p.waitForTimeout(400);
    let d = await L.PDFDocument.load(await savedOf(p));
    const texts = flat(treeOf(d)).filter((e) => e.pg === 0 && /^(H\d|P)$/.test(e.S)).map((e) => e.S);
    eq(texts, ['H2', 'P', 'P', 'P']);
    const p0 = treeOf(d)[0].kids.filter((e) => e.pg === 0 && e.S === 'P');
    eq(p0.map((e) => e.mc.length), [1, 2, 1], 'the one-line paragraph first, then the two-line one');
    // merge and split
    const m2 = await p.evaluate(() => window.__cowdreyPdf.acOrderModel(0));
    await p.evaluate((id) => window.__cowdreyPdf.acOrderEdit({ op: 'split', id }), m2.items[2].id);
    eq((await p.evaluate(() => window.__cowdreyPdf.acOrderModel(0))).items.map((x) => x.role), ['H2', 'P', 'P', 'P', 'P']);
    const m3 = await p.evaluate(() => window.__cowdreyPdf.acOrderModel(0));
    await p.evaluate((id) => window.__cowdreyPdf.acOrderEdit({ op: 'merge', id }), m3.items[3].id);
    eq((await p.evaluate(() => window.__cowdreyPdf.acOrderModel(0))).items.length, 4);
    await run(p, 'acOrder'); ok(!(await p.$('#acOrder')), 'closed');
    // a tagged PDF: its own elements, moved and retagged
    const f = await taggedPdf('Alpha', 1, tmp('o'));
    await openPdf(p, f, 'Alpha.pdf');
    let tm = await p.evaluate(() => window.__cowdreyPdf.acOrderModel(0));
    eq(tm.mode, 'tags'); eq(tm.items.map((x) => x.role), ['H1', 'P']);
    ok(tm.items[0].box && tm.items[0].text.includes('Alpha heading 1'), JSON.stringify(tm.items[0]));
    await p.evaluate(([a, b]) => window.__cowdreyPdf.acOrderEdit({ op: 'move', id: a, before: b }), [tm.items[1].id, tm.items[0].id]);
    tm = await p.evaluate(() => window.__cowdreyPdf.acOrderModel(0));
    await p.evaluate((id) => window.__cowdreyPdf.acOrderEdit({ op: 'retag', id, S: 'Artifact' }), tm.items[1].id);
    d = await L.PDFDocument.load(await savedOf(p));
    eq(flat(treeOf(d)).filter((e) => e.S !== 'Document').map((e) => e.S), ['P']);
    ok(/\/Artifact BMC\s*BT \/F1 24 Tf/.test(streamOf(d, 0)), 'the heading is decoration now: ' + streamOf(d, 0));
    eq(p.errors, []); await p.ctx.close();
  });

  // Headings at three sizes over two pages, for bookmarks.
  async function headingsPdf(file) {
    const d = await L.PDFDocument.create(), b = await d.embedFont(L.StandardFonts.HelveticaBold), r = await d.embedFont(L.StandardFonts.Helvetica);
    const para = (pg, y) => { pg.drawText('Body text that runs across the page, set in a smaller size than any heading here.', { x: 72, y, size: 11, font: r }); pg.drawText('A second line of the same paragraph, so the page has more body text than headings.', { x: 72, y: y - 14, size: 11, font: r }); };
    const p1 = d.addPage([612, 792]);
    p1.drawText('Chapter One', { x: 72, y: 700, size: 24, font: b }); para(p1, 670);
    p1.drawText('First section', { x: 72, y: 610, size: 16, font: b }); para(p1, 585);
    p1.drawText('A detail', { x: 72, y: 530, size: 13, font: b }); para(p1, 510);
    p1.drawText('Second section', { x: 72, y: 450, size: 16, font: b }); para(p1, 425);
    const p2 = d.addPage([612, 792]);
    p2.drawText('Chapter Two', { x: 72, y: 700, size: 24, font: b }); para(p2, 670);
    p2.drawText('Third section', { x: 72, y: 610, size: 16, font: b }); para(p2, 585);
    fs.writeFileSync(file, await d.save()); return file;
  }
  const bmTitles = (tree, depth = 0) => tree.flatMap((b) => [' '.repeat(depth * 2) + b.title, ...bmTitles(b.items || [], depth + 1)]);

  await test('Bookmarks: Add bookmarks from headings nests H1 to H3 in one step (auto tags, the PDF’s tags, or the text)', async () => {
    const p = await open(); await openPdf(p, await headingsPdf(tmp('h')), 'Book.pdf');
    await run(p, 'bmHeadings'); await p.waitForTimeout(300);
    const want = ['Chapter One', '  First section', '    A detail', '  Second section', 'Chapter Two', '  Third section'];
    eq(bmTitles(await p.evaluate(() => window.__cowdreyPdf.bmTree())), want, 'from the text');
    await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
    eq((await p.evaluate(() => window.__cowdreyPdf.bmTree())).length, 0, 'one undo step');
    // after Add tags automatically, from the tags (and saved with the right pages)
    await run(p, 'acAutoTag'); await run(p, 'bmHeadings'); await p.waitForTimeout(300);
    eq(bmTitles(await p.evaluate(() => window.__cowdreyPdf.bmTree())), want, 'from the added tags');
    const bytes = await savedOf(p), d = await L.PDFDocument.load(bytes), refs = d.getPages().map((x) => x.ref.toString());
    const first = d.context.lookup(d.catalog.lookup(N('Outlines')).get(N('First')));
    eq([first.lookup(N('Title')).decodeText(), refs.indexOf(String(first.lookup(N('Dest')).get(0)))], ['Chapter One', 0]);
    // reopened, the PDF is tagged: the bookmarks come from its own tags
    await reopen(p, bytes);
    const going = p.evaluate(() => window.__cowdreyPdf.bmFromHeadings()); await p.waitForSelector('#dialog[open]'); await p.click('#dialog .btn.primary'); await going; await p.waitForTimeout(300);
    eq(bmTitles(await p.evaluate(() => window.__cowdreyPdf.bmTree())), want, 'from the PDF’s tags');
    // sample.pdf (auto-tagged): one heading a page
    await openPdf(p, SAMPLE); await run(p, 'acAutoTag'); await run(p, 'bmHeadings');
    eq(bmTitles(await p.evaluate(() => window.__cowdreyPdf.bmTree())), ['Quarterly report, page 1', 'Quarterly report, page 2', 'Quarterly report, page 3']);
    eq(p.errors, []); await p.ctx.close();
  });

  // An outline with a red bold bookmark (FitH), a /Named action and a /JavaScript one.
  async function styledOutline(file) {
    const d = await L.PDFDocument.create(), f = await d.embedFont(L.StandardFonts.Helvetica);
    const pages = [1, 2].map((n) => { const pg = d.addPage([612, 792]); pg.drawText(`Page ${n}`, { x: 72, y: 700, size: 20, font: f }); return pg; });
    const c = d.context, rootRef = c.nextRef(), a = c.nextRef(), b = c.nextRef(), j = c.nextRef();
    c.assign(a, c.obj({ Title: L.PDFHexString.fromText('Red one'), Parent: rootRef, Next: b, Dest: [pages[1].ref, 'FitH', 500], C: [1, 0, 0], F: 2 }));
    c.assign(b, c.obj({ Title: L.PDFHexString.fromText('Next page'), Parent: rootRef, Prev: a, Next: j, A: { S: 'Named', N: 'NextPage' } }));
    c.assign(j, c.obj({ Title: L.PDFHexString.fromText('Script'), Parent: rootRef, Prev: b, A: { S: 'JavaScript', JS: L.PDFString.of('app.alert(1)') } }));
    c.assign(rootRef, c.obj({ Type: 'Outlines', First: a, Last: j, Count: 3 }));
    d.catalog.set(N('Outlines'), rootRef);
    fs.writeFileSync(file, await d.save()); return file;
  }
  const items = (d) => { const out = []; let r = d.catalog.lookup(N('Outlines')).get(N('First')); while (r) { const it = d.context.lookup(r); out.push(it); r = it.get(N('Next')); } return out; };

  await test('Bookmarks: colour and bold (/C, /F) and the destination kind are kept through a rename; actions are kept; Style and zoom changes them', async () => {
    const p = await open(); await openPdf(p, await styledOutline(tmp('s')), 'Styled.pdf');
    await p.click('[data-side="outline"]'); await p.waitForTimeout(300);
    const tree = await p.evaluate(() => window.__cowdreyPdf.bmTree());
    eq(tree.map((b) => [b.title, b.color || null, !!b.bold, b.act || null]), [['Red one', [1, 0, 0], true, null], ['Next page', null, false, 'Named'], ['Script', null, false, 'JavaScript']]);
    await p.evaluate((id) => window.__cowdreyPdf.bmSetTitle(id, 'Red renamed'), tree[0].id); await p.waitForTimeout(200);
    ok(await p.$('#sidePanel .bm-t.bm-b'), 'shown in bold'); ok(await p.$('#sidePanel .bm-dot'), 'with its colour');
    let d = await L.PDFDocument.load(await savedOf(p)), its = items(d);
    eq(its.map((x) => x.lookup(N('Title')).decodeText()), ['Red renamed', 'Next page', 'Script']);
    eq(its[0].lookup(N('C')).asArray().map((n) => n.asNumber()), [1, 0, 0]);
    eq(its[0].lookup(N('F')).asNumber(), 2);
    const dest = its[0].lookup(N('Dest'));
    eq([String(dest.get(1)), dest.get(2).asNumber()], ['/FitH', 500], 'FitH kept');
    const named = its[1].lookup(N('A'));
    eq([String(named.get(N('S'))), String(named.get(N('N')))], ['/Named', '/NextPage']);
    eq(String(its[2].lookup(N('A')).get(N('S'))), '/JavaScript');
    // style and zoom
    await p.evaluate((id) => window.__cowdreyPdf.bmSetStyle(id, { color: null, bold: false, italic: true, zoom: 'fit' }), tree[0].id);
    d = await L.PDFDocument.load(await savedOf(p)); its = items(d);
    eq([its[0].get(N('C')) || null, its[0].lookup(N('F')).asNumber(), String(its[0].lookup(N('Dest')).get(1))], [null, 1, '/Fit']);
    // the Style dialog
    await p.click('#sidePanel .bm-row >> nth=0'); await p.waitForTimeout(300);
    await p.click('#sidePanel [data-bma="style"]'); await p.waitForSelector('#dialog[open] .bm-style');
    await p.click('#dialog [data-bmc="#E03131"]'); await p.check('#dialog [data-bms="bold"]'); await p.selectOption('#dialog [data-bms="zoom"]', 'width');
    await p.click('#dialog .btn.primary'); await p.waitForTimeout(300);
    d = await L.PDFDocument.load(await savedOf(p)); its = items(d);
    eq([its[0].lookup(N('C')).asArray().map((n) => +n.asNumber().toFixed(2)), its[0].lookup(N('F')).asNumber(), String(its[0].lookup(N('Dest')).get(1))], [[0.88, 0.19, 0.19], 3, '/FitH']);
    // a page deleted: the action bookmarks still stay
    await run(p, 'delPage');
    d = await L.PDFDocument.load(await savedOf(p));
    ok(items(d).some((x) => x.lookup(N('A')) && String(x.lookup(N('A')).get(N('S'))) === '/Named'), 'the Named action survives');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Accessibility: the ribbon has an Accessibility group on the Export tab', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="export"]');
    for (const id of ['acCheck', 'acAutoTag', 'acAlt', 'acOrder', 'acSaveUA']) ok(await p.$(`#ribbonBody [data-cmd="${id}"]`), id);
    await p.ctx.close();
  });

  for (const n of ['a', 'ma', 'mb', 'c', 'o', 'h', 's']) { try { fs.unlinkSync(tmp(n)); } catch {} }
};
