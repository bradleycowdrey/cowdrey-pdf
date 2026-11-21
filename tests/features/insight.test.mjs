// Insight: tables to CSV and Excel, an extractive summary, and Ask the document. All on this device: no request
// leaves the page while any of it runs.
export default async (h) => {
  const { test, eq, ok, open, openPdf, require, path, root, fs, PDFDocument, answer } = h;
  const L = require(path.join(root, 'desktop/node_modules/pdf-lib'));
  const zlib = require('node:zlib');
  const tmp = path.join(root, 'tests/.ins-fixture.pdf');

  // Page 1: a ruled table (a header and three rows, three columns); page 2: a table lined up by spacing only, with
  // a heading and a paragraph around it; page 3: a scan (a picture, no text).
  const RULED = [['Name', 'City', 'Amount'], ['Smith, "Jo"', 'Leeds', '1,250.50'], ['Patel', 'York', '980'], ["O'Neil", 'Bath', '12']];
  const STREAM = [['Item', 'Client', 'Hours', 'Rate'], ['Logo design', 'Acme, "Big" Ltd', '12', '40.50'], ['Web pages', 'Blue Fox', '30', '55'], ['Print ads', 'Corner Shop', '8', '40.50']];
  async function tablesPdf() {
    const d = await PDFDocument.create(), f = await d.embedFont(L.StandardFonts.Helvetica), b = await d.embedFont(L.StandardFonts.HelveticaBold);
    const p1 = d.addPage([612, 792]);
    p1.drawText('Payments received', { x: 72, y: 720, size: 16, font: b });
    const xs = [72, 252, 402, 522], ys = [680, 655, 630, 605, 580];
    for (const y of ys) p1.drawLine({ start: { x: xs[0], y }, end: { x: xs[3], y }, thickness: 1, color: L.rgb(0, 0, 0) });
    for (const x of xs) p1.drawLine({ start: { x, y: ys[0] }, end: { x, y: ys[4] }, thickness: 1, color: L.rgb(0, 0, 0) });
    RULED.forEach((row, r) => row.forEach((t, c) => p1.drawText(t, { x: xs[c] + 6, y: ys[r] - 17, size: 11, font: r ? f : b })));
    p1.drawText('Totals are in pounds.', { x: 72, y: 540, size: 11, font: f });
    const p2 = d.addPage([612, 792]);
    p2.drawText('Hours this month', { x: 72, y: 720, size: 16, font: b });
    p2.drawText('The table below lists the work done for each client in March.', { x: 72, y: 690, size: 11, font: f });
    const cx = [72, 200, 380, 460];
    STREAM.forEach((row, r) => row.forEach((t, c) => p2.drawText(t, { x: cx[c], y: 640 - r * 20, size: 11, font: r ? f : b })));
    p2.drawText('All hours were checked by the studio before this invoice was sent.', { x: 72, y: 540, size: 11, font: f });
    const p3 = d.addPage([612, 792]); p3.drawRectangle({ x: 72, y: 500, width: 400, height: 200, color: L.rgb(0.85, 0.85, 0.85) });
    return Buffer.from(await d.save());
  }
  const csvOf = (rows) => '﻿' + rows.map((r) => r.map((v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\r\n') + '\r\n';
  // A minimal .zip reader (stored or deflated entries) and XML parser, to open the .xlsx as Excel would.
  function unzip(buf) {
    const out = {}; let k = 0;
    while (buf.readUInt32LE(k) === 0x04034b50) {
      const method = buf.readUInt16LE(k + 8), size = buf.readUInt32LE(k + 18), nl = buf.readUInt16LE(k + 26), xl = buf.readUInt16LE(k + 28);
      const name = buf.slice(k + 30, k + 30 + nl).toString('utf8'), data = buf.slice(k + 30 + nl + xl, k + 30 + nl + xl + size);
      out[name] = method === 8 ? zlib.inflateRawSync(data) : data; k += 30 + nl + xl + size;
    }
    return out;
  }
  function parseXml(s) {
    s = s.replace(/^<\?xml[^>]*\?>\s*/, '');
    const root = { name: '#root', kids: [], attrs: {} }, stack = [root];
    const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g; let m, at = 0;
    while ((m = re.exec(s))) {
      if (m.index !== at) throw new Error('bad XML at ' + at); at = re.lastIndex;
      if (m[5] !== undefined) { if (/[<>]/.test(m[5]) || /&(?!amp;|lt;|gt;|quot;|apos;)/.test(m[5])) throw new Error('bad text'); stack[stack.length - 1].kids.push(m[5].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')); continue; }
      if (m[1]) { const top = stack.pop(); if (top.name !== m[2]) throw new Error(`</${m[2]}> closes <${top.name}>`); continue; }
      const el = { name: m[2], attrs: Object.fromEntries([...m[3].matchAll(/([\w:.-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]])), kids: [] };
      stack[stack.length - 1].kids.push(el); if (!m[4]) stack.push(el);
    }
    if (at !== s.length || stack.length !== 1) throw new Error('unclosed XML');
    return root.kids.find((x) => typeof x === 'object');
  }
  const all = (el, name) => (typeof el !== 'object' ? [] : [...(el.name === name ? [el] : []), ...el.kids.flatMap((k) => all(k, name))]);
  const textIn = (el) => (typeof el === 'string' ? el : el.kids.map(textIn).join(''));
  function sheetCells(xlsx, n = 1) {
    const files = unzip(xlsx);
    for (const f of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', `xl/worksheets/sheet${n}.xml`]) ok(files[f], 'has ' + f);
    for (const f of Object.keys(files)) parseXml(files[f].toString('utf8'));
    const sheet = parseXml(files[`xl/worksheets/sheet${n}.xml`].toString('utf8'));
    const cells = {};
    for (const c of all(sheet, 'c')) {
      const v = all(c, 'v')[0];
      cells[c.attrs.r] = c.attrs.t === 'inlineStr' ? textIn(all(c, 't')[0]) : v ? Number(textIn(v)) : null;
      if (c.attrs.s) cells[c.attrs.r + ':s'] = c.attrs.s;
    }
    return { cells, files, sheets: all(parseXml(files['xl/workbook.xml'].toString('utf8')), 'sheet').map((s) => s.attrs.name) };
  }
  const openBytes = async (p, bytes, name) => {
    await p.evaluate(async ([b, n]) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); await window.__cowdreyPdf.openBytes(u, n); }, [bytes.toString('base64'), name]);
    await p.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 15000 }); await p.waitForTimeout(400);
  };
  const watchNet = (p) => { const r = []; p.on('request', (q) => { if (!/^(data|blob):/.test(q.url())) r.push(q.url()); }); return r; };
  const screenAt = (p, n, x, y) => p.evaluate(([n, x, y]) => { const v = window.__cowdreyPdf.views()[n], r = v.el.getBoundingClientRect(), [vx, vy] = v.viewport.convertToViewportPoint(x, y); return [r.left + vx, r.top + vy]; }, [n, x, y]);

  await test('tables: a ruled table and one lined up by spacing are found; CSV is exactly the cells, a comma and quotes included', async () => {
    const p = await open(); await openBytes(p, await tablesPdf(), 'Tables.pdf');
    const net = watchNet(p);
    const t1 = await p.evaluate(() => window.__cowdreyPdf.insTables(0)), t2 = await p.evaluate(() => window.__cowdreyPdf.insTables(1));
    eq(t1.map((t) => [t.method, t.rows]), [['lattice', RULED]]);
    eq(t2.map((t) => [t.method, t.rows]), [['stream', STREAM]], 'only the table, not the heading or the paragraphs');
    eq(await p.evaluate((r) => window.__cowdreyPdf.insCsv(r), RULED), csvOf(RULED));
    ok(csvOf(RULED).includes('"Smith, ""Jo"""') && csvOf(STREAM).includes('"Acme, ""Big"" Ltd"'), 'quoted as RFC 4180 says');
    // Drag a box around the ruled table with Extract table, then Save CSV
    await p.click('[data-rt="export"]'); await p.click('#ribbonBody [data-cmd="insTable"]');
    eq(await p.evaluate(() => document.querySelector('#app').dataset.tool), 'instable');
    const [ax, ay] = await screenAt(p, 0, 60, 690), [bx, by] = await screenAt(p, 0, 530, 570);
    await p.mouse.move(ax, ay); await p.mouse.down(); await p.mouse.move(bx, by, { steps: 6 }); await p.mouse.up();
    await p.waitForSelector('#dialog[open] .ins-tbl');
    eq(await p.$$eval('#dialog .ins-grid tr', (r) => r.map((x) => [...x.children].map((c) => c.textContent))), RULED, 'the preview');
    eq(await p.$$eval('#dialog .ins-grid th', (r) => r.length), 3, 'first row is the header');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dialog .dlg-foot button:has-text("Save CSV")')]);
    eq(dl.suggestedFilename(), 'Tables table p1.csv');
    const csv = fs.readFileSync(await dl.path());
    eq([...csv.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'UTF-8 with a BOM');
    eq(csv.toString('utf8'), csvOf(RULED));
    // Clicking a table (no drag) on page 2 finds the one under the pointer; Save Excel
    await p.evaluate(() => window.__cowdreyPdf.views()[1].el.scrollIntoView({ block: 'center' })); await p.waitForTimeout(300);
    await p.evaluate(() => window.__cowdreyPdf.run('insTable'));
    const [cx, cy] = await screenAt(p, 1, 250, 620);
    await p.mouse.click(cx, cy);
    await p.waitForSelector('#dialog[open] .ins-tbl');
    const [dx] = await Promise.all([p.waitForEvent('download'), p.click('#dialog .dlg-foot button:has-text("Save Excel")')]);
    eq(dx.suggestedFilename(), 'Tables table p2.xlsx');
    const { cells } = sheetCells(fs.readFileSync(await dx.path()));
    eq([cells.A1, cells.B1, cells.C1, cells.D1, cells['A1:s']], ['Item', 'Client', 'Hours', 'Rate', '1'], 'header row, bold');
    eq([cells.A2, cells.B2, cells.C2, cells.D2], ['Logo design', 'Acme, "Big" Ltd', 12, 40.5], 'numbers stored as numbers');
    eq([cells.A4, cells.C4, cells.D3], ['Print ads', 8, 55]);
    eq(net, [], 'nothing sent anywhere');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('tables: the preview moves, adds and removes column dividers; header off; copy as table; all tables to one workbook', async () => {
    const p = await open(); await openBytes(p, await tablesPdf(), 'Tables.pdf');
    const net = watchNet(p);
    const going = p.evaluate(() => window.__cowdreyPdf.insTableAt(1, [60, 140, 560, 230]));
    await p.waitForSelector('#dialog[open] .ins-tbl');
    eq(await p.$$eval('#dialog .ins-div', (d) => d.length), 3, 'three dividers for four columns');
    await p.click('#dialog .ins-div[data-k="1"] .ins-div-x');
    eq((await p.evaluate(() => window.__cowdreyPdf.insLast())).rows[1], ['Logo design Acme, "Big" Ltd', '12', '40.50'], 'divider removed: two columns are one');
    await p.click('#dialog [data-add]');
    eq(await p.$$eval('#dialog .ins-div', (d) => d.length), 3, 'added in the widest column');
    // drag the new divider to where the column starts
    const img = await p.locator('#dialog .ins-img').boundingBox(), d1 = await p.locator('#dialog .ins-div[data-k="1"]').boundingBox();
    const scale = img.width / 500;
    await p.mouse.move(d1.x + d1.width / 2, d1.y + d1.height / 2); await p.mouse.down(); await p.mouse.move(img.x + (190 - 60) * scale, d1.y + d1.height / 2, { steps: 6 }); await p.mouse.up();
    eq((await p.evaluate(() => window.__cowdreyPdf.insLast())).rows, STREAM, 'dragged back between the columns');
    await p.click('#insHeader');
    eq(await p.$$eval('#dialog .ins-grid th', (r) => r.length), 0, 'no header');
    await p.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://app.test' });
    await p.click('#dialog .dlg-foot button:has-text("Copy as table")'); await going;
    eq(await p.evaluate(() => navigator.clipboard.readText()), STREAM.map((r) => r.join('\t')).join('\n'));
    // Find tables on all pages: two tables, and the scan has no text; Save all as Excel
    await p.evaluate(() => window.__cowdreyPdf.run('insFind'));
    await p.waitForSelector('#dialog[open] [name="insWhich"]');
    await p.click('label:has(input[name="insWhich"][value="all"])'); await answer(p, 'Find tables');
    await p.waitForSelector('#dialog[open] .ins-found');
    eq(await p.textContent('#dlgTitle'), '2 tables found');
    ok((await p.textContent('#dialog .ins-found')).includes('Page 3 has no text'), 'the scan is pointed out');
    const [dl] = await Promise.all([p.waitForEvent('download'), answer(p, 'Save all as Excel')]);
    eq(dl.suggestedFilename(), 'Tables tables.xlsx');
    const x = fs.readFileSync(await dl.path()), one = sheetCells(x, 1), two = sheetCells(x, 2);
    eq(one.sheets, ['Page 1', 'Page 2']);
    eq([one.cells.A2, one.cells.C2, one.cells.C3], ['Smith, "Jo"', 1250.5, 980]);
    eq([two.cells.B2, two.cells.D4], ['Acme, "Big" Ltd', 40.5]);
    // a page without text: Recognize text is offered
    const r = p.evaluate(() => window.__cowdreyPdf.insTableAt(2, [60, 60, 500, 300]));
    await p.waitForSelector('#dialog[open]');
    eq(await p.textContent('#dlgTitle'), 'This page has no text yet');
    ok(await p.$('#dialog .dlg-foot button:has-text("Recognize text")'), 'Recognize text offered');
    await answer(p, 'Cancel'); await r;
    eq(net, [], 'nothing sent anywhere');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('tables: a long account number (more than 15 digits) stays text in Excel and keeps every digit', async () => {
    const d = await PDFDocument.create(), f = await d.embedFont(L.StandardFonts.Helvetica), pg = d.addPage([612, 792]);
    const ROWS = [['Item', 'Code', 'Qty', 'Amount'], ['Paper', '00412', '10', '4.50'], ['Ink', '998877', '2', '19.99'], ['Long account', '12345678901234567890', '3', '7.25'], ['Card', '123456789012345', '1', '2']];
    const cx = [72, 200, 400, 470];
    ROWS.forEach((row, r) => row.forEach((t, c) => pg.drawText(t, { x: cx[c], y: 700 - r * 20, size: 11, font: f })));
    const p = await open(); await openBytes(p, Buffer.from(await d.save()), 'Codes.pdf');
    const t = await p.evaluate(() => window.__cowdreyPdf.insTables(0));
    eq(t.map((x) => x.rows), [ROWS]);
    const x = Buffer.from(await p.evaluate((rows) => [...window.__cowdreyPdf.insXlsx([{ name: 'Codes', rows, header: true }])], t[0].rows));
    const { cells } = sheetCells(x);
    eq([cells.B2, cells.B3, cells.B4, cells.B5, cells.C4, cells.D4], ['00412', 998877, '12345678901234567890', 123456789012345, 3, 7.25], 'long digits as text, 15 digits still a number');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('summary and ask: each bullet of a list without full stops is a sentence of its own', async () => {
    const d = await PDFDocument.create(), f = await d.embedFont(L.StandardFonts.Helvetica), b = await d.embedFont(L.StandardFonts.HelveticaBold);
    const SLIDES = [
      ['Goals for next year', ['Launch the new mobile banking app in spring', 'Reduce support calls by a quarter', 'Open two branches in the north', 'Hire twenty new staff for the helpdesk', 'Move card payments to the new system', 'Train all staff on the mobile banking app', 'Cut paper statements by half', 'Retire the old desktop banking site by winter']],
      ['Risks', ['The mobile banking app may launch late', 'Support calls may rise while staff learn', 'New branches may cost more than planned', 'Hiring may be slow in the north', 'Card payments may fail during the move', 'Customers may miss paper statements', 'The old desktop site may still be needed', '1. Budgets are set in the autumn']],
    ];
    for (const [head, items] of SLIDES) {
      const pg = d.addPage([792, 612]); pg.drawText(head, { x: 60, y: 540, size: 28, font: b });
      items.forEach((t, k) => pg.drawText(/^\d/.test(t) ? t : '• ' + t, { x: 60, y: 490 - k * 26, size: 16, font: f }));
    }
    const p = await open(); await openBytes(p, Buffer.from(await d.save()), 'Plan.pdf');
    const t = await p.evaluate(async () => (await window.__cowdreyPdf.insText()).sents.map((x) => [x.n, x.text]));
    eq(t, SLIDES.flatMap(([head, items], n) => [[n, head], ...items.map((x) => [n, x])]), 'a heading, then one sentence per bullet');
    const s = await p.evaluate(async () => window.__cowdreyPdf.insSummaryOf(await window.__cowdreyPdf.insText(), 'medium'));
    ok(s.picked.length > 2 && s.picked.every((x) => !x.text.includes('•') && x.text.length < 60), 'short picks: ' + s.picked.map((x) => x.text));
    const r = await p.evaluate(async () => window.__cowdreyPdf.insAskOf(await window.__cowdreyPdf.insText(), 'retire the desktop banking site').map((x) => x.best.text));
    eq(r[0], 'Retire the old desktop banking site by winter');
    eq(p.errors, []); await p.ctx.close();
  });

  // Prose: a topic sentence said again in other words, among sentences on other things.
  const SUMMARY = [
    ['Solar panels on school roofs cut energy bills and teach students about clean power.', 'The cafeteria will serve a new lunch menu starting next week.', 'Energy bills at the school fell after the solar panels went on the roofs.', 'Buses will leave ten minutes earlier on Fridays.'],
    ['Students now learn about clean power by watching the solar panels on the school roof.', 'The library is closed on the first Monday of each month.', 'Solar panels also cut the energy bills of the school by a third.', 'The football team won its match on Saturday after a long season.'],
  ];
  const ASK = [
    ['Invoice 4471', 'This invoice covers design work for the spring campaign.', 'The work includes a logo, a brand guide and a website.', 'Questions about this invoice can be sent to the studio.'],
    ['Payment', 'Please pay by bank transfer to the account below.', 'The invoice is due on 12 March 2026.', 'Late payments may add a fee of two percent each month.'],
    ['Terms', 'Work is owned by the client once the invoice is paid in full.', 'The studio keeps all infor-', 'mation about the client private.', 'The studio may show the work in its portfolio.'],
  ];
  async function prosePdf(pages) {
    const d = await PDFDocument.create(), f = await d.embedFont(L.StandardFonts.Helvetica), b = await d.embedFont(L.StandardFonts.HelveticaBold);
    for (const lines of pages) {
      const pg = d.addPage([612, 792]); let y = 700;
      for (const t of lines) { const head = !/[.,-]$/.test(t) && t.split(' ').length < 3; pg.drawText(t, { x: 72, y, size: head ? 16 : 11, font: head ? b : f }); y -= head ? 30 : 16; }
    }
    return Buffer.from(await d.save());
  }

  await test('summary: TextRank picks the topic sentence first, with its page; key terms; the dialog says where the sentences come from', async () => {
    const p = await open(); await openBytes(p, await prosePdf(SUMMARY), 'School news.pdf');
    const net = watchNet(p);
    const s = await p.evaluate(async () => { const t = await window.__cowdreyPdf.insText(); return window.__cowdreyPdf.insSummaryOf(t, 'short'); });
    eq([s.ranked[0].text, s.ranked[0].n], [SUMMARY[0][0], 0], 'the topic sentence first');
    eq(s.picked.length, 3);
    ok(s.picked.every((x, k) => !k || x.n > s.picked[k - 1].n || (x.n === s.picked[k - 1].n)), 'in the order of the document');
    ok(!s.picked.some((x) => /football|library|cafeteria|Buses/.test(x.text)), 'not the sentences on other things: ' + s.picked.map((x) => x.text));
    const terms = s.terms.map((t) => t.term);
    ok(terms.slice(0, 4).some((t) => /solar panels?/i.test(t)) && terms.some((t) => /energy bills?/i.test(t)), 'key terms: ' + terms);
    await p.click('[data-rt="export"]'); await p.click('#ribbonBody [data-cmd="insSummary"]');
    await p.waitForSelector('#dialog[open] .ins-summary');
    ok((await p.textContent('#dialog .ins-summary')).includes("Picked from the document's own sentences, on this device."), 'honest note');
    ok(!(await p.$('#dialog [data-model]')), 'no model button without an on-device model');
    eq(await p.$$eval('#dialog .ins-sum li', (l) => l.length), 6, 'medium by default');
    await p.click('#dialog [data-len="short"]');
    eq(await p.$$eval('#dialog .ins-sum li p', (l) => l.map((x) => x.textContent)), s.picked.map((x) => x.text));
    // a page link goes to the sentence and marks it
    await p.click('#dialog .ins-sum li:nth-child(3) .ins-page');
    await p.waitForSelector('.page[data-n="1"] .ins-hit');
    eq(await p.evaluate(() => window.__cowdreyPdf.current), 1);
    eq(net, [], 'nothing sent anywhere');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('summary: the browser\'s on-device model is offered only when it is ready, and writes into the dialog', async () => {
    const p = await open({ init: () => { window.__asked = []; window.Summarizer = { availability: async () => 'available', create: async (o) => { window.__asked.push(o); return { inputQuota: 1e6, measureInputUsage: async (t) => t.length, summarize: async (t) => `A short summary of ${t.split(' ').length} words.`, destroy() {} }; } }; } });
    await openBytes(p, await prosePdf(SUMMARY), 'School news.pdf');
    await p.evaluate(() => window.__cowdreyPdf.run('insSummary'));
    await p.waitForSelector('#dialog[open] [data-model]');
    ok((await p.textContent('#dialog [data-model]')).includes("Write a summary with your browser's on-device model"));
    await p.click('#dialog [data-model]');
    await p.waitForFunction(() => /A short summary of \d+ words\./.test(document.querySelector('#dialog .ins-model-out').textContent));
    ok((await p.textContent('#dialog .ins-model')).includes('It can get things wrong'), 'its own note');
    await answer(p, 'Close');
    // only "available": a model still to download is not offered (the app never starts a download)
    const q = await open({ init: () => { window.Summarizer = { availability: async () => 'downloadable', create: async () => { throw new Error('should not be called'); } }; } });
    await openBytes(q, await prosePdf(SUMMARY), 'School news.pdf');
    await q.evaluate(() => window.__cowdreyPdf.run('insSummary'));
    await q.waitForSelector('#dialog[open] .ins-summary');
    ok(!(await q.$('#dialog [data-model]')), 'hidden');
    eq([...p.errors, ...q.errors], []); await p.ctx.close(); await q.ctx.close();
  });

  await test('ask: "when is the invoice due" finds the passage with the date, on its page; choosing it marks the sentence there', async () => {
    const p = await open(); await openBytes(p, await prosePdf(ASK), 'Invoice.pdf');
    const net = watchNet(p);
    const t = await p.evaluate(async () => (await window.__cowdreyPdf.insText()).sents.map((x) => [x.n, x.text]));
    ok(t.some(([n, x]) => n === 2 && x === 'The studio keeps all information about the client private.'), 'lines joined and the hyphen put back: ' + JSON.stringify(t));
    ok(t.some(([n, x]) => n === 1 && x === 'Payment') && t.some(([, x]) => x === 'Please pay by bank transfer to the account below.'), 'a heading is a sentence of its own');
    await p.click('[data-rt="export"]'); await p.click('#ribbonBody [data-cmd="insAsk"]');
    await p.waitForSelector('#insAsk:not([hidden]) #insQ');
    ok((await p.textContent('#insAsk')).includes('Shows the passages that best match your question.'), 'honest note');
    await p.fill('#insQ', 'when is the invoice due'); await p.keyboard.press('Enter');
    await p.waitForSelector('#insAsk .ins-hitem');
    const items = await p.$$eval('#insAsk .ins-hitem', (b) => b.map((x) => [x.querySelector('b').textContent, x.querySelector('mark') && x.querySelector('mark').textContent]));
    eq(items[0], ['Page 2', 'The invoice is due on 12 March 2026.'], 'the top result');
    ok(items.length >= 2 && items.length <= 5, 'up to five passages');
    await p.click('#insAsk .ins-hitem[data-r="0"]');
    await p.waitForSelector('.page[data-n="1"] .ins-hit');
    eq(await p.evaluate(() => window.__cowdreyPdf.current), 1, 'went to page 2');
    // the mark covers the sentence on the page
    const hit = await p.$eval('.page[data-n="1"] .ins-hit', (e) => e.getBoundingClientRect().toJSON());
    const span = await p.locator('.page[data-n="1"] .textLayer span', { hasText: '12 March 2026' }).first().boundingBox();
    ok(Math.abs(hit.y - span.y) < span.height && hit.width > span.width * 0.8, 'over the sentence');
    // other questions
    const r = await p.evaluate(async () => { const t = await window.__cowdreyPdf.insText(); return ['who owns the work', 'how much is the late fee', 'zebra'].map((q) => window.__cowdreyPdf.insAskOf(t, q).map((x) => [x.n, x.best.text])); });
    eq(r[0][0], [2, 'Work is owned by the client once the invoice is paid in full.']);
    eq(r[1][0], [1, 'Late payments may add a fee of two percent each month.']);
    eq(r[2], [], 'no match');
    await p.keyboard.press('Escape');
    eq(net, [], 'nothing sent anywhere');
    eq(p.errors, []); await p.ctx.close();
    fs.rmSync(tmp, { force: true });
  });
};
