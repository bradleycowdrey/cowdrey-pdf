// Redaction leaves nothing behind: marked-content text, the structure tree, drawings and shadings under the box,
// letters partly under it, and the words in bookmarks and document properties (Also remove hidden information).
import { execFileSync } from 'node:child_process';
export default async (h) => {
  const { test, eq, ok, open, openPdf, root, path, fs, require, savedOf, reopen, answer } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const pdfjs = await import(path.join(root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
  const N = L.PDFName.of;
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
  const tmp = (name, bytes) => { const f = path.join(root, 'tests/fixtures', '.rs-' + name); fs.writeFileSync(f, bytes); return f; };
  const textOf = async (bytes) => { const task = pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: path.join(root, 'desktop/node_modules/pdfjs-dist/standard_fonts/'), verbosity: 0 }); const d = await task.promise; let s = ''; for (let i = 1; i <= d.numPages; i++) s += (await (await d.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ') + '\n'; await task.destroy(); return s; };
  const noErrors = (p) => eq(p.errors.filter((e) => !/annotation-comment/.test(e)), []);
  // Every string, name and (inflated) stream in the file, as text.
  const everything = (d) => {
    const out = [], seen = new Set();
    const visit = (o, depth) => {
      if (!o || depth > 50) return;
      if (o instanceof L.PDFRef) { if (seen.has(o.tag)) return; seen.add(o.tag); return visit(d.context.lookup(o), depth + 1); }
      if (o instanceof L.PDFString || o instanceof L.PDFHexString) { out.push(o.decodeText()); return; }
      if (o instanceof L.PDFName) { out.push(o.decodeText()); return; }
      if (o instanceof L.PDFDict) { for (const [k, v] of o.entries()) { out.push(k.decodeText()); visit(v, depth + 1); } return; }
      if (o instanceof L.PDFArray) { for (const v of o.asArray()) visit(v, depth + 1); return; }
      if (o instanceof L.PDFRawStream) { visit(o.dict, depth + 1); try { out.push(Buffer.from(L.decodePDFRawStream(o).decode()).toString('latin1')); } catch { out.push(Buffer.from(o.getContents()).toString('latin1')); } }
    };
    for (const [ref] of d.context.enumerateIndirectObjects()) visit(ref, 0);
    visit(d.context.trailerInfo.Info, 0);
    return out.join('\n');
  };
  const contentOf = (d, n = 0) => { const c = d.getPage(n).node.Contents(); const arr = c instanceof L.PDFArray ? c.asArray().map((r) => d.context.lookup(r)) : [c]; return arr.map((s) => Buffer.from(L.decodePDFRawStream(s).decode()).toString('latin1')).join('\n'); };
  const pixel = (p, x, y) => p.evaluate(([x0, y0]) => { const v = window.__cowdreyPdf.views()[0], c = v.el.querySelector('canvas.pdf'), k = c.width / v.viewport.width; const [vx, vy] = v.viewport.convertToViewportPoint(x0, y0); return [...c.getContext('2d').getImageData(Math.round(vx * k), Math.round(vy * k), 1, 1).data]; }, [x, y]);

  // A tagged PDF: a public line, a secret word (its marked content and structure element carry it as ActualText and
  // Alt too), a blue rectangle and a shading under the word, a red bar crossing the word's box, and an X partly over
  // the end of the word. A bookmark and the Subject carry the word as well.
  const SIZE = 40, X0 = 100, Y0 = 500;
  async function tagged() {
    const d = await L.PDFDocument.create(), pg = d.addPage([612, 792]), c = d.context;
    const f = await d.embedFont(L.StandardFonts.Helvetica);
    const wT = f.widthOfTextAtSize('TOPSECRET', SIZE), wX = f.widthOfTextAtSize('X', SIZE), xX = X0 + wT - .4 * wX;
    const sh = c.obj({ ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [200, 495, 230, 525], Extend: [true, true], Function: { FunctionType: 2, Domain: [0, 1], C0: [1, .8, 0], C1: [0, .6, .2], N: 1 } });
    pg.node.set(N('Resources'), c.obj({ Font: { F1: f.ref }, Shading: { Sh1: c.register(sh) } }));
    const content = [
      '/P <</MCID 0>> BDC BT /F1 14 Tf 72 700 Td (Public line here) Tj ET EMC',
      `/Span <</MCID 1 /ActualText (TOPSECRET-AT)>> BDC BT /F1 ${SIZE} Tf ${X0} ${Y0} Td (TOPSECRET) Tj ET EMC`,
      '/Artifact BMC',
      'q 0.2 0.4 0.8 rg 150 500 40 20 re f Q', // all under the word's box
      'q 0.9 0.1 0.1 rg 300 505 120 15 re f Q', // crosses the box's right edge
      'q 200 495 30 30 re W n /Sh1 sh Q', // a shading in a clip under the box
      `BT /F1 ${SIZE} Tf ${xX.toFixed(3)} ${Y0} Td (X) Tj ET`, // 40% of it under the box, its middle outside
      'EMC',
    ].join('\n');
    pg.node.set(N('Contents'), c.register(c.flateStream(content)));
    pg.node.set(N('StructParents'), L.PDFNumber.of(0));
    const rootRef = c.nextRef(), docRef = c.nextRef(), pRef = c.nextRef(), sRef = c.nextRef();
    c.assign(pRef, c.obj({ Type: 'StructElem', S: 'P', P: docRef, Pg: pg.ref, K: 0 }));
    c.assign(sRef, c.obj({ Type: 'StructElem', S: 'Span', P: docRef, Pg: pg.ref, K: 1, Alt: L.PDFString.of('ALT-TOPSECRET'), ActualText: L.PDFString.of('SE-TOPSECRET') }));
    c.assign(docRef, c.obj({ Type: 'StructElem', S: 'Document', P: rootRef, K: [pRef, sRef] }));
    c.assign(rootRef, c.obj({ Type: 'StructTreeRoot', K: docRef, ParentTree: c.obj({ Nums: [0, c.obj([pRef, sRef])] }), ParentTreeNextKey: 1 }));
    d.catalog.set(N('StructTreeRoot'), rootRef); d.catalog.set(N('MarkInfo'), c.obj({ Marked: true }));
    // bookmarks: one with the word, one without
    const outRef = c.nextRef(), b1 = c.nextRef(), b2 = c.nextRef();
    c.assign(b1, c.obj({ Title: L.PDFHexString.fromText('TOPSECRET plan'), Parent: outRef, Next: b2, Dest: [pg.ref, 'XYZ', null, 792, null] }));
    c.assign(b2, c.obj({ Title: L.PDFHexString.fromText('Overview'), Parent: outRef, Prev: b1, Dest: [pg.ref, 'XYZ', null, 700, null] }));
    c.assign(outRef, c.obj({ Type: 'Outlines', First: b1, Last: b2, Count: 2 }));
    d.catalog.set(N('Outlines'), outRef);
    d.setSubject('About the TOPSECRET programme'); d.setTitle('Plan');
    return { bytes: await d.save({ useObjectStreams: false }), xX, wX, wT };
  }
  const redact = async (p, text, opts = {}) => {
    await run(p, 'protRedSearch'); await p.waitForSelector('#dialog[open] input[name=text]');
    await p.fill('#dialog input[name=text]', text);
    if (opts.whole === false) await p.uncheck('#dialog input[name=wholeWords]');
    if (opts.hidden) await p.check('#dialog input[name=hidden]'); else await p.uncheck('#dialog input[name=hidden]');
    await answer(p, 'Find'); await p.waitForSelector('#dialog[open] .prot-hits');
  };

  await h.test('redaction scrub: geometry helpers cut shapes and lines along a box', async () => {
    const p = await open();
    const r = await p.evaluate(() => {
      const H = window.__cowdreyPdf, box = [[0, 0], [10, 0], [10, 10], [0, 10]];
      const area = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const q = P[i], s = P[(i + 1) % P.length]; a += q[0] * s[1] - s[0] * q[1]; } return Math.abs(a / 2); };
      const sq = H.rsSubtract([[5, 5], [20, 5], [20, 20], [5, 20]], box).reduce((t, P) => t + area(P), 0); // 225 - 25
      const inside = H.rsSubtract([[2, 2], [8, 2], [8, 8], [2, 8]], box).length;
      const ring = H.rsSubtract([[-5, -5], [15, -5], [15, 15], [-5, 15]], box).reduce((t, P) => t + area(P), 0); // 400 - 100
      const line = H.rsSubtractLine([[-5, 5], [15, 5]], box);
      const turned = H.rsSubtract([[5, 5], [20, 5], [20, 20], [5, 20]], [[5, -5], [15, 5], [5, 15], [-5, 5]]).reduce((t, P) => t + area(P), 0); // a diamond: 225 - 50
      return { sq, inside, ring, line, cover: [H.rsCovered([[8, 0], [13, 0], [13, 10], [8, 10]], box), H.rsCovered([[20, 0], [30, 0], [30, 10], [20, 10]], box)], turned, props: H.rsScrubProps('<</MCID 3 /ActualText (secret) /Alt <</X (y)>> /Lang (en)>>') };
    });
    ok(Math.abs(r.sq - 200) < 1e-6, 'square minus box: ' + r.sq);
    eq(r.inside, 0, 'all inside: nothing left');
    ok(Math.abs(r.ring - 300) < 1e-6, 'a frame is left: ' + r.ring);
    eq(r.line.map((l) => l.map((pt) => pt.map((n) => Math.round(n * 1000) / 1000))), [[[-5, 5], [0, 5]], [[10, 5], [15, 5]]], 'a line cut in two');
    ok(Math.abs(r.turned - 175) < 1e-6, 'a turned box: ' + r.turned);
    eq(r.cover.map((x) => Math.round(x * 100) / 100), [.4, 0], 'share of a letter under a box');
    ok(/\/MCID 3/.test(r.props) && /\/Lang \(en\)/.test(r.props) && !/secret|Alt|ActualText/.test(r.props), r.props);
    await p.ctx.close();
  });

  await h.test('redaction scrub: a tagged PDF keeps no trace of the redacted word, in content, tags, drawings, bookmarks or properties', async () => {
    const { bytes, xX, wX, wT } = await tagged();
    const file = tmp('tagged.pdf', bytes);
    try {
      const p = await open(); await openPdf(p, file, 'Tagged.pdf');
      const before = { bar: await pixel(p, 400, 512), bar2: await pixel(p, 360, 508), pub: await pixel(p, 75, 704) };
      ok(before.bar[0] > 180 && before.bar[1] < 80, 'red bar drawn: ' + before.bar);
      await p.click('[data-rt="protect"]');
      await redact(p, 'TOPSECRET', { whole: false });
      await answer(p, 'Mark'); await p.waitForTimeout(300);
      const q = await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().find((m) => m.type === 'redact').quads[0]);
      const xs = q.map((t) => t[0]), ys = q.map((t) => t[1]), box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      ok(box[0] <= 150 && box[2] >= 190 && box[1] <= 495 && box[3] >= 525 && box[2] < 420, 'the box covers the drawings under the word: ' + box);
      ok(xX + wX / 2 > box[2] && xX < box[2], 'the X has its middle outside the box: ' + [xX, wX, box[2]]);
      await run(p, 'protRedApply'); await p.waitForSelector('#dialog[open] input[name=label]');
      await p.fill('#dialog input[name=label]', 'Withheld'); await answer(p, 'Apply');
      // The word is in the bookmarks and the properties too: asked whether to remove hidden information
      await p.waitForFunction(() => /Also remove hidden information/.test(document.querySelector('#dialog[open] h2')?.textContent || ''), null, { timeout: 10000 });
      const listed = await p.$$eval('#dialog .prot-leaks li', (e) => e.map((x) => x.textContent));
      ok(listed.some((t) => /Bookmark/.test(t)) && listed.some((t) => /Subject/.test(t)), JSON.stringify(listed));
      await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rs-hidden-dialog.png' });
      await answer(p, 'Remove'); await p.waitForTimeout(200);
      ok(await p.evaluate(() => (window.__cowdreyPdf.doc.marks.__doc || []).some((m) => m.type === 'protclean' && m.words)), 'Remove hidden information is on, with the redacted words');
      const out = await savedOf(p), d = await L.PDFDocument.load(out, { updateMetadata: false });
      // nothing anywhere in the file (inflated) has the word
      const all = everything(d);
      ok(!/topsecret/i.test(all), 'the word is still in the file: ' + (/.{0,60}topsecret.{0,60}/i.exec(all) || [''])[0]);
      ok(!/topsecret/i.test(Buffer.from(out).toString('latin1')), 'not in the raw bytes either');
      // the drawing all under the box, and the shading under it, are gone; the bar across its edge is cut
      const cs = contentOf(d);
      ok(!/150 500 40 20 re/.test(cs) && !/\b150 500 m\b/.test(cs), 'the covered rectangle is gone');
      ok(!/\/Sh1\s+sh/.test(cs), 'the covered shading is gone');
      const shd = d.getPage(0).node.Resources().lookup(N('Shading'));
      ok(!shd || !shd.get(N('Sh1')), 'and is no longer in the resources');
      ok(!/300 505 120 15 re/.test(cs), 'the crossing bar is redrawn');
      const kept = [...cs.matchAll(/([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l ([\d.]+) ([\d.]+) l ([\d.]+) ([\d.]+) l h f/g)].map((m) => m.slice(1).map(Number));
      ok(kept.some((pts) => Math.min(pts[0], pts[2], pts[4], pts[6]) >= box[2] - .01 && Math.max(pts[0], pts[2], pts[4], pts[6]) <= 420.01), 'the bar outside the box: ' + JSON.stringify(kept));
      // marked content and tags
      ok(/\/Span BMC/.test(cs) && !/MCID 1\b/.test(cs), 'the emptied sequence has no MCID any more');
      ok(/\/P <<\/MCID 0>> BDC/.test(cs), 'the public line keeps its tag');
      const st = d.catalog.lookup(N('StructTreeRoot')), nums = st.lookup(N('ParentTree')).lookup(N('Nums')), arr = nums.lookup(1);
      ok(arr.get(1) === undefined || arr.get(1) === L.PDFNull || d.context.lookup(arr.get(1)) === L.PDFNull, 'no parent tree entry for the removed MCID');
      ok(d.context.lookup(arr.get(0)) instanceof L.PDFDict, 'the public line\'s entry stays');
      const docEl = st.lookup(N('K')), kids = docEl.lookup(N('K'));
      const kidList = kids instanceof L.PDFArray ? kids.asArray() : [kids];
      eq(kidList.map((k) => String(d.context.lookup(k).get(N('S')))), ['/P'], 'the empty element went');
      // text: the word, and the X it partly covered, are gone; the rest stays
      const txt = await textOf(out);
      ok(!/TOPSECRET|X/.test(txt) && txt.includes('Public line here'), txt);
      if (fs.existsSync('/usr/bin/pdftotext')) {
        const f2 = tmp('tagged-out.pdf', out);
        try { const t = execFileSync('/usr/bin/pdftotext', [f2, '-']).toString(); ok(!/topsecret/i.test(t) && /Public line here/.test(t), 'pdftotext: ' + t); } finally { fs.unlinkSync(f2); }
      }
      // bookmarks and properties
      const outl = d.catalog.lookup(N('Outlines'));
      ok(outl && outl.lookup(N('First')) === outl.lookup(N('Last')) && outl.lookup(N('First')).lookup(N('Title')).decodeText() === 'Overview', 'the bookmark with the word went, the other stays');
      ok(!d.getSubject(), 'Subject removed or blank: ' + d.getSubject());
      // the bar outside the box looks the same, the box is drawn over the rest
      await reopen(p, out);
      eq(await pixel(p, 400, 512), before.bar, 'the bar outside the box is unchanged');
      eq(await pixel(p, 360, 508), before.bar2, 'next to the box too');
      const inBox = await pixel(p, 170, 510); ok(inBox[0] < 30 && inBox[1] < 30 && inBox[2] < 30, 'black box over the word: ' + inBox);
      eq(await pixel(p, 75, 704), before.pub, 'the public line is untouched');
      await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rs-saved.png' });
      void wT; noErrors(p); await p.ctx.close();
    } finally { fs.unlinkSync(file); }
  });

  await h.test('redaction scrub: a named property list is copied and cleaned; an element whose content is partly redacted loses its alternate text and gets the box text', async () => {
    const d = await L.PDFDocument.create(), pg = d.addPage([612, 792]), c = d.context, f = await d.embedFont(L.StandardFonts.Helvetica);
    const props = c.register(c.obj({ MCID: 0, ActualText: L.PDFString.of('Codeword Heron and more') }));
    pg.node.set(N('Resources'), c.obj({ Font: { F1: f.ref }, Properties: { MC0: props } }));
    pg.node.set(N('Contents'), c.register(c.flateStream('/Span /MC0 BDC BT /F1 24 Tf 72 600 Td (Codeword Heron and more) Tj ET EMC')));
    pg.node.set(N('StructParents'), L.PDFNumber.of(0));
    const rootRef = c.nextRef(), sRef = c.nextRef();
    c.assign(sRef, c.obj({ Type: 'StructElem', S: 'P', P: rootRef, Pg: pg.ref, K: c.obj({ Type: 'MCR', MCID: 0, Pg: pg.ref }), Alt: L.PDFString.of('Heron') }));
    c.assign(rootRef, c.obj({ Type: 'StructTreeRoot', K: [sRef], ParentTree: c.obj({ Nums: [0, c.obj([sRef])] }) }));
    d.catalog.set(N('StructTreeRoot'), rootRef);
    const file = tmp('named.pdf', await d.save({ useObjectStreams: false }));
    try {
      const p = await open(); await openPdf(p, file, 'Named.pdf');
      await redact(p, 'Heron'); await answer(p, 'Mark'); await p.waitForTimeout(200);
      await run(p, 'protRedApply'); await p.waitForSelector('#dialog[open] input[name=label]');
      await p.fill('#dialog input[name=label]', 'Withheld'); await answer(p, 'Apply'); await p.waitForTimeout(600);
      eq(await p.$('#dialog[open]'), null, 'no hidden places to ask about');
      const out = await savedOf(p), o = await L.PDFDocument.load(out);
      ok(!/heron/i.test(everything(o)), 'no trace: ' + (/.{0,40}heron.{0,40}/i.exec(everything(o)) || [''])[0]);
      const cs = contentOf(o); ok(/\/Span \/MC0 BDC/.test(cs), 'the sequence keeps its (cleaned) property list: ' + cs.slice(0, 300));
      const pr = o.getPage(0).node.Resources().lookup(N('Properties')).lookup(N('MC0'));
      ok(pr.get(N('MCID')) && !pr.get(N('ActualText')), 'MCID kept, ActualText gone');
      const el = o.catalog.lookup(N('StructTreeRoot')).lookup(N('K')).lookup(0);
      eq([el.lookup(N('Alt')).decodeText(), !!el.get(N('K'))], ['Withheld', true], 'the box text is its alternate text; its content stays');
      const t = await textOf(out); ok(t.includes('Codeword') && t.includes('and more') && !t.includes('Heron'), t);
      noErrors(p); await p.ctx.close();
    } finally { fs.unlinkSync(file); }
  });

  await h.test('redaction scrub: Search and redact also finds the word in comments, bookmarks, form fields and properties, and saving removes it there', async () => {
    const { bytes } = await tagged();
    const d0 = await L.PDFDocument.load(bytes), pg = d0.getPage(0), form = d0.getForm();
    const tf = form.createTextField('codename'); tf.setText('TOPSECRET falcon'); tf.addToPage(pg, { x: 72, y: 300, width: 200, height: 24 });
    const note = d0.context.register(d0.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [500, 700, 520, 720], Contents: L.PDFHexString.fromText('Keep TOPSECRET quiet'), F: 4 }));
    pg.node.lookup(N('Annots')).push(note);
    const file = tmp('hidden.pdf', await d0.save({ useObjectStreams: false }));
    try {
      const p = await open(); await openPdf(p, file, 'Hidden.pdf');
      await redact(p, 'TOPSECRET', { hidden: true, whole: false });
      const rows = await p.$$eval('#dialog .prot-hit-pg', (e) => e.map((x) => x.textContent));
      for (const want of ['Page 1', 'Bookmark', 'Form field “codename”', 'Document properties: Subject', 'Comment, page 1']) ok(rows.includes(want), want + ' in ' + JSON.stringify(rows));
      ok(/outside the pages/.test(await p.textContent('#dialog .prot-hit-sum')), await p.textContent('#dialog .prot-hit-sum'));
      await p.screenshot({ path: '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rs-search-hidden.png' });
      await answer(p, 'Mark'); await p.waitForTimeout(300);
      ok(/outside the pages/.test(await p.textContent('#toast')), await p.textContent('#toast'));
      const out = await savedOf(p), d = await L.PDFDocument.load(out, { updateMetadata: false });
      const outl = d.catalog.lookup(N('Outlines'));
      eq(outl.lookup(N('First')).lookup(N('Title')).decodeText(), 'Overview', 'bookmark removed');
      eq(d.getSubject(), 'About the programme', 'the word is taken out of the Subject');
      eq(d.getForm().getTextField('codename').getText(), 'falcon', 'and out of the form value');
      const subs = (d.getPage(0).node.Annots() ? d.getPage(0).node.Annots().asArray() : []).map((r) => String(d.context.lookup(r).get(N('Subtype'))));
      ok(!subs.includes('/Text'), 'the comment went: ' + subs);
      ok(!/topsecret/i.test(everything(d).replace(/\(TOPSECRET\) Tj|TOPSECRET-AT|ALT-TOPSECRET|SE-TOPSECRET/g, '')), 'nowhere outside the (unredacted) page'); // the page itself was only marked, not applied
      noErrors(p); await p.ctx.close();
    } finally { fs.unlinkSync(file); }
  });
  await h.test('redaction scrub: a dragged area cuts a circle and a line along its edge, and takes out Type 3 letters under it', async () => {
    const d = await L.PDFDocument.create(), pg = d.addPage([612, 792]), c = d.context;
    const proc = c.register(c.flateStream('1000 0 0 0 1000 1000 d1 0 0 1000 1000 re f'));
    const t3 = c.register(c.obj({ Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1000, 1000], FontMatrix: [0.001, 0, 0, 0.001, 0, 0], CharProcs: { sq: proc }, Encoding: { Type: 'Encoding', Differences: [97, 'sq'] }, FirstChar: 97, LastChar: 97, Widths: [1000], Resources: {} }));
    pg.node.set(N('Resources'), c.obj({ Font: { F3: t3 } }));
    const k = 0.5523 * 40, cx = 300, cy = 350, r = 40;
    const circle = `${cx + r} ${cy} m ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} c ${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} c ${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} c ${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} c h`;
    pg.node.set(N('Contents'), c.register(c.flateStream([
      `q 0.1 0.3 0.9 rg ${circle} f Q`,
      'q 0.9 0.1 0.1 RG 4 w 150 480 m 350 480 l S Q',
      'q 0 0.6 0 rg BT /F3 20 Tf 210 440 Td (aa) Tj ET BT /F3 20 Tf 320 440 Td (a) Tj ET Q',
    ].join('\n'))));
    const file = tmp('shapes.pdf', await d.save({ useObjectStreams: false }));
    try {
      const p = await open(); await openPdf(p, file, 'Shapes.pdf').catch(() => {}); // there may be no text layer to wait for
      await p.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 15000 }); await p.waitForTimeout(500);
      const outside = [[330, 350], [300, 395], [170, 480], [330, 480], [330, 450]];
      const before = []; for (const [x, y] of outside) before.push(await pixel(p, x, y));
      ok(before[0][2] > 180 && before[2][0] > 180 && before[4][1] > 100 && before[4][0] < 60, 'drawn: ' + JSON.stringify(before));
      await p.click('[data-rt="protect"]'); await p.click('[data-cmd="protRedArea"]');
      const [ax, ay] = await h.at(p, 200, 500), [bx, by] = await h.at(p, 300, 300);
      await p.mouse.move(ax, ay); await p.mouse.down(); await p.mouse.move(bx, by, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(200);
      await run(p, 'protRedApply'); await answer(p, 'Apply'); await p.waitForTimeout(400);
      const box = await p.evaluate(() => { const q = Object.values(window.__cowdreyPdf.doc.marks).flat().find((m) => m.type === 'redact').quads[0]; const xs = q.map((t) => t[0]), ys = q.map((t) => t[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; });
      const out = await savedOf(p), o = await L.PDFDocument.load(out), cs = contentOf(o);
      ok(!/ c\b/.test(cs.replace(/\/F3/g, '')), 'the crossing circle is redrawn as lines');
      const pts = [...cs.matchAll(/(-?[\d.]+) (-?[\d.]+) [ml]\b/g)].map((m) => [+m[1], +m[2]]);
      const inside = pts.filter(([x, y]) => x > box[0] + .05 && x < box[2] - .05 && y > box[1] + .05 && y < box[3] - .05);
      eq(inside, [], 'no point of a drawing inside the box');
      ok(!/\(aa\)/.test(cs) && /\(a\) Tj/.test(cs), 'the Type 3 letters under the box are gone, the other stays');
      await reopen(p, out).catch(() => {});
      await p.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 15000 }); await p.waitForTimeout(500);
      for (let i = 0; i < outside.length; i++) { const now = await pixel(p, ...outside[i]); ok(now.every((v, j) => Math.abs(v - before[i][j]) < 40), `outside the box at ${outside[i]}: ${before[i]} → ${now}`); }
      for (const [x, y] of [[290, 350], [250, 480], [220, 450]]) { const v = await pixel(p, x, y); ok(v[0] < 30 && v[1] < 30 && v[2] < 30, `black inside the box at ${x},${y}: ${v}`); }
      noErrors(p); await p.ctx.close();
    } finally { fs.unlinkSync(file); }
  });

  // Redacts every match of `word` (whole words off), applies the boxes and returns the saved file and the box.
  async function redactAll(file, name, word) {
    const p = await open(); await openPdf(p, file, name);
    await redact(p, word, { whole: false }); await answer(p, 'Mark'); await p.waitForTimeout(200);
    await run(p, 'protRedApply'); await answer(p, 'Apply'); await p.waitForTimeout(500);
    if (await p.$('#dialog[open]')) await answer(p, 'Not now');
    const boxes = await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().filter((m) => m.type === 'redact').flatMap((m) => m.quads).map((q) => { const xs = q.map((t) => t[0]), ys = q.map((t) => t[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }));
    const out = await savedOf(p); noErrors(p); await p.ctx.close();
    return { out, boxes };
  }
  async function plainPdf(content, extra) {
    const d = await L.PDFDocument.create(), pg = d.addPage([612, 792]), c = d.context, f = await d.embedFont(L.StandardFonts.Helvetica);
    const res = { Font: { F1: f.ref } }; if (extra) extra(c, res, f);
    pg.node.set(N('Resources'), c.obj(res)); pg.node.set(N('Contents'), c.register(c.flateStream(content)));
    return d.save({ useObjectStreams: false });
  }

  await h.test('redaction scrub: on tightly spaced lines (a standard font, no font descriptor) the line below the box keeps its letters', async () => {
    const file = tmp('tight.pdf', await plainPdf('BT /F1 12 Tf 72 700 Td (Hello SECRETWORD world) Tj ET BT /F1 12 Tf 72 690 Td (another line) Tj ET'));
    try {
      const { out, boxes } = await redactAll(file, 'Tight.pdf', 'SECRETWORD');
      ok(boxes.length === 1 && boxes[0][1] > 690 + .52 * 12, 'the box stays above the next line\'s letters: ' + boxes);
      const t = await textOf(out);
      ok(t.includes('another line') && t.includes('Hello') && t.includes('world') && !/SECRET|WORD/.test(t), t);
    } finally { fs.unlinkSync(file); }
  });

  await h.test('redaction scrub: a shape filled and used as the clip (W f) under the box goes; a form drawn squeezed (Tz from the page) loses the right letters', async () => {
    const file = tmp('clipform.pdf', await plainPdf(
      'BT /F1 40 Tf 100 500 Td (TOPSECRET) Tj ET q 150 505 30 10 re W f Q q 0.9 0.1 0.1 rg 300 505 120 15 re W f 0 0 1 rg 0 0 612 792 re f Q\n' +
      'BT /F1 20 Tf 50 Tz 72 300 Td (sq) Tj ET q 1 0 0 1 72 200 cm /Fx Do Q',
      (c, res, f) => { res.XObject = { Fx: c.register(c.flateStream('BT /F1 20 Tf 0 0 Td (in form TOPSECRET here) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 400, 40], Resources: { Font: { F1: f.ref } } })) }; }));
    try {
      const { out, boxes } = await redactAll(file, 'ClipForm.pdf', 'TOPSECRET');
      eq(boxes.length, 2, 'the word on the page and in the form');
      const d = await L.PDFDocument.load(out), cs = contentOf(d);
      ok(!/150 505 30 10 re/.test(cs) && !/\b150 505 m\b/.test(cs), 'the covered clip-and-fill shape is gone: ' + cs.slice(0, 400));
      ok(/0 0 0 0 re\s+W n/.test(cs), 'an empty clip in its place');
      ok(/300 505 120 15 re\s+W n/.test(cs), 'the crossing one keeps its clip');
      const t = await textOf(out);
      ok(!/TOP|SECRET|CRET/.test(t), 'nothing of the word is left: ' + t);
      ok(/in form/.test(t) && /here/.test(t), 'the rest of the form\'s line stays: ' + t);
    } finally { fs.unlinkSync(file); }
  });
};
