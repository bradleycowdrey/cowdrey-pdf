// What thumbnails and previews show (src/app.js thumbOverlays), the page-design dialog preview and its fields
// (src/features/40-page-design.js), read aloud when speech fails (95-create-read.js), and the list of matches in
// Search and redact (80-protect.js).
export default async (h) => {
  const { test, eq, ok, open, openPdf, path, root, savedOf, require, answer } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
  const settle = (p, ms = 900) => p.waitForTimeout(ms);
  // Pixels of a canvas: [black (near #000), maroon (the name tag's #AE1747)].
  const px = (p, sel) => p.evaluate((sel) => {
    const c = document.querySelector(sel); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let black = 0, maroon = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 200 && d[i] + d[i + 1] + d[i + 2] < 90) black++; if (Math.abs(d[i] - 174) < 30 && d[i + 1] < 60 && Math.abs(d[i + 2] - 71) < 35) maroon++; }
    return [black, maroon];
  }, sel);
  const thumb = '#sidePanel .thumb[data-n="0"] canvas';

  await test('thumbnails: new form fields look as saved (no black fill, no name tag or handles); links are not drawn', async () => {
    const p = await open(); await openPdf(p); await settle(p, 600);
    const [b0, m0] = await px(p, thumb), before = await p.$eval(thumb, (c) => c.toDataURL());
    const g = await p.locator('.page[data-n="0"]').boundingBox();
    await p.click('#ribbonTabs button:text-is("Forms")');
    await p.locator('#ribbonBody button:has-text("Text field")').click();
    await p.mouse.move(g.x + 90, g.y + 600); await p.mouse.down(); await p.mouse.move(g.x + 400, g.y + 640, { steps: 5 }); await p.mouse.up(); await settle(p, 300);
    await p.keyboard.press('Escape');
    await p.locator('#ribbonBody button:has-text("Check box")').click(); await p.mouse.click(g.x + 450, g.y + 620); await settle(p, 300);
    eq((await h.marks(p)).filter((t) => t === 'ff').length, 2, 'two fields');
    // a link over some words, with a web address
    await p.evaluate(() => { const d = window.__cowdreyPdf.doc, k = Object.keys(d.marks).find((x) => x !== '__doc'); d.marks[k].push({ id: 'lnk1', type: 'link', x1: 60, y1: 400, x2: 420, y2: 440, uri: 'https://example.com' }); });
    await run(p, 'undo'); await run(p, 'redo'); await settle(p, 1200); // redraws the thumbnail with the link in it
    ok(await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().some((m) => m.type === 'link')), 'link kept');
    const [b1, m1] = await px(p, thumb);
    ok(b1 - b0 < 120, `no black boxes or labels: black ${b0} → ${b1}`);
    ok(m1 - m0 < 15, `no name tags: maroon ${m0} → ${m1}`);
    ok(await p.$eval(thumb, (c) => c.toDataURL()) !== before, 'the fields are drawn in it');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('page design dialog: the preview shows the page as edited (mark-up and redactions), not the original', async () => {
    const p = await open(); await openPdf(p);
    const g = await p.locator('.page[data-n="0"]').boundingBox();
    const prev = '#dialog .pd-prev canvas';
    await p.click('[data-rt="edit"]'); await p.click('[data-cmd="pd_watermark"]'); await p.waitForSelector('#dialog[open] .pd-form'); await settle(p, 600);
    const [plain] = await px(p, prev);
    await p.click('#dialog .dlg-foot button:has-text("Cancel")');
    // a big area marked and applied as a black redaction
    await p.click('[data-rt="protect"]'); await p.click('[data-cmd="protRedArea"]');
    await p.mouse.move(g.x + 40, g.y + 40); await p.mouse.down(); await p.mouse.move(g.x + g.width - 40, g.y + 260, { steps: 4 }); await p.mouse.up();
    await p.click('[data-cmd="protRedApply"]'); await p.waitForSelector('#dialog[open]'); await p.click('#dialog .dlg-foot button:has-text("Apply")'); await settle(p, 500);
    await p.click('[data-rt="edit"]'); await p.click('[data-cmd="pd_watermark"]'); await p.waitForSelector('#dialog[open] .pd-form'); await settle(p, 900);
    const [red] = await px(p, prev);
    ok(red > plain + 3000, `the redaction is in the preview: black ${plain} → ${red}`);
    await p.click('#dialog .dlg-foot button:has-text("Cancel")');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('header & footer: Page number inserted inside a field goes after it; broken fields are caught; saved PDF reads "Page 2 of 3"', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="edit"]'); await p.click('[data-cmd="pd_headfoot"]'); await p.waitForSelector('#dialog[open] .pd-slots');
    const bc = '#dialog [data-k="bc"]';
    eq(await p.inputValue(bc), 'Page <<page>> of <<pages>>');
    // the caret between "pa" and "ge" of the first field
    await p.click(bc); await p.evaluate((s) => { const el = document.querySelector(s); el.focus(); el.setSelectionRange(8, 8); }, bc);
    await p.click('#dialog [data-token="<<page>>"]');
    eq(await p.inputValue(bc), 'Page <<page>><<page>> of <<pages>>', 'not split');
    eq(await p.evaluate((s) => document.querySelector(s).selectionStart, bc), 21, 'caret after the new field');
    // A field typed over by hand is marked, and the dialog can't be confirmed
    await p.fill(bc, 'Page <<pa2ge>> of <<pages>>');
    eq(await p.getAttribute(bc, 'aria-invalid'), 'true'); ok(await p.isVisible('#dialog [data-pd-err]'), 'says what is wrong');
    ok(await p.$eval('#dialog .dlg-foot .btn.primary', (b) => b.disabled), 'Add is off');
    await p.fill(bc, 'Page <<page>> of <<pages>>');
    eq(await p.getAttribute(bc, 'aria-invalid'), null);
    await p.click('#dialog .dlg-foot .btn.primary'); await settle(p, 500);
    const d = await L.PDFDocument.load(await savedOf(p));
    eq(d.getPageCount(), 3);
    const pdfjs = await import(path.join(root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
    const pd = await pdfjs.getDocument({ data: new Uint8Array(await savedOf(p)), verbosity: 0 }).promise;
    const t = (await (await pd.getPage(2)).getTextContent()).items.map((i) => i.str).join(' '); await pd.loadingTask.destroy();
    ok(/Page 2 of 3/.test(t) && !/<</.test(t), 'footer on page 2: ' + t.slice(-60));
    eq(p.errors, []); await p.ctx.close();
  });

  const speech = (fail) => [({ fail }) => {
    window.__said = [];
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speaking: false, pending: false,
      speak(u) { window.__said.push(u.text); setTimeout(() => (fail ? u.onerror && u.onerror({ error: fail }) : u.onend && u.onend({})), 5); },
      cancel() {}, getVoices: () => [], addEventListener() {} } });
  }, { fail }];

  await test('read aloud: when no voice can speak it stops with a message on the page it began, not skimming to the end', async () => {
    const p = await open({ init: speech('synthesis-failed') }); await openPdf(p);
    await p.evaluate(() => window.__cowdreyPdf.run('crdReadAloud')); await settle(p, 1200);
    const st = await p.evaluate(() => [window.__cowdreyPdf.crdSayState().on, window.__said.length, window.__cowdreyPdf.current, document.querySelector('#toast').textContent]);
    eq(st[0], false, 'stopped'); eq(st[1], 1, 'tried one sentence only');
    eq(st[2], await p.evaluate(() => window.__cowdreyPdf.current), 'stays');
    ok(/isn't available/.test(st[3]), 'says why: ' + st[3]);
    ok(await p.$eval('#crdSayBar', (b) => b.hidden), 'bar closed'); eq(await p.$$eval('.crd-say', (e) => e.length), 0);
    eq(p.errors, []); await p.ctx.close();
  });
  await test('read aloud: other errors skip a sentence, but three in a row stop it; it starts on the page in view', async () => {
    const p = await open({ init: speech('text-too-long') }); await openPdf(p);
    await p.evaluate(() => window.__cowdreyPdf.views()[1].el.scrollIntoView()); await settle(p, 400);
    const from = await p.evaluate(() => window.__cowdreyPdf.current);
    ok(from >= 1, 'page 2 in view');
    await p.evaluate(() => window.__cowdreyPdf.run('crdReadAloud')); await settle(p, 1200);
    eq(await p.evaluate(() => [window.__cowdreyPdf.crdSayState().on, window.__said.length]), [false, 3]);
    const page2 = await p.evaluate(async (n) => (await window.__cowdreyPdf.views()[n].page.getTextContent()).items.map((i) => i.str).join(' ').replace(/\s+/g, ' '), from);
    const first = await p.evaluate(() => window.__said[0]);
    ok(page2.includes(first.split(' ').slice(0, 2).join(' ')), `reads from page ${from + 1}: "${first}"`);
    eq(await p.evaluate(() => window.__cowdreyPdf.current), from, 'back where it began');
    eq(p.errors, []); await p.ctx.close();
  });
  await test('read aloud: "not allowed" asks for a click', async () => {
    const p = await open({ init: speech('not-allowed') }); await openPdf(p);
    await p.evaluate(() => window.__cowdreyPdf.run('crdReadAloud')); await settle(p, 600);
    ok(/click/.test(await p.textContent('#toast')), await p.textContent('#toast'));
    eq(await p.evaluate(() => window.__said.length), 1);
    await p.ctx.close();
  });

  await test('search and redact: lists each match with its page and words around it; shows it; unticked ones are not marked', async () => {
    const p = await open(); await openPdf(p);
    await run(p, 'protRedSearch'); await p.waitForSelector('#dialog[open] input[name=text]');
    await p.fill('#dialog input[name=text]', 'pelican'); await answer(p, 'Find');
    await p.waitForSelector('#dialog[open] .prot-hits');
    const rows = await p.$$eval('#dialog .prot-hit', (r) => r.map((x) => [x.querySelector('.prot-hit-pg').textContent, x.querySelector('mark').textContent.toLowerCase(), x.querySelector('.prot-hit-ctx').textContent.length]));
    eq(rows.length, 6, 'all six');
    ok(rows.every((r) => /^Page \d$/.test(r[0]) && r[1] === 'pelican' && r[2] > 12), JSON.stringify(rows));
    eq(await p.textContent('#dialog .dlg-foot .btn.primary'), 'Mark all 6');
    // the first is shown; choosing the last shows it, on its page
    await p.waitForFunction(() => document.querySelector('#dialog .prot-hit-view canvas').width > 100);
    await p.click('#dialog .prot-hit:last-child .prot-hit-go');
    ok(await p.$eval('#dialog .prot-hit:last-child', (x) => x.classList.contains('on')), 'shown');
    eq(await p.textContent('#dialog .prot-hit-view figcaption'), rows[5][0] + ': ' + (await p.$eval('#dialog .prot-hit:last-child mark', (m) => m.textContent)));
    // untick two
    await p.uncheck('#dialog .prot-hit:nth-child(1) input'); await p.uncheck('#dialog .prot-hit:nth-child(6) input');
    eq(await p.textContent('#dialog .dlg-foot .btn.primary'), 'Mark 4');
    await p.click('#dialog .dlg-foot .btn.primary'); await settle(p, 400);
    eq((await h.marks(p)).filter((t) => t === 'redact').length, 4);
    ok(/^4 marked for redaction on page/.test(await p.textContent('#toast')), await p.textContent('#toast'));
    // Untick all: nothing can be marked
    await run(p, 'protRedSearch'); await p.waitForSelector('#dialog[open] input[name=text]'); await answer(p, 'Find'); await p.waitForSelector('#dialog[open] .prot-hits');
    await p.click('#dialog [data-all="0"]'); ok(await p.$eval('#dialog .dlg-foot .btn.primary', (b) => b.disabled), 'off with none ticked');
    await answer(p, 'Back'); await p.waitForSelector('#dialog[open] input[name=text]'); eq(await p.inputValue('#dialog input[name=text]'), 'pelican', 'back to the search');
    await answer(p, 'Cancel');
    eq(p.errors, []); await p.ctx.close();
  });
};
