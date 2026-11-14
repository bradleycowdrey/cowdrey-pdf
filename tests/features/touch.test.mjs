// Drawing accuracy, phones and keyboard: shapes stay on the page they were started on, keyboard editing of the page's
// lines and pictures, phone menu and dialog targets, first focus in dialogs, and small fixes to the status bar and
// Read aloud.
const SHOTS = '/tmp/claude-0/-home-user/5a94d03a-474e-54c6-ac96-d898e81e4eb4/scratchpad/rr6/fix-touch/';
let H;
const shot = async (p, name) => { try { H.fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: SHOTS + name }); } catch {} };

export default async (h) => {
  H = h; const { test, eq, ok, open, openPdf, WORD, saved, require } = h;
  const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id).then(() => p.waitForTimeout(150));
  const allMarks = (p) => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat());
  // Every point a mark holds, in PDF units.
  const pointsOf = (m) => [
    ...(m.x1 != null ? [[m.x1, m.y1], [m.x2, m.y2]] : []),
    ...(m.pts || []), ...(m.rects || []).flatMap((r) => [[r[0], r[1]], [r[2], r[3]]]), ...(m.quads || []).flat(),
  ];

  await test('drawing: box, oval, line, area highlight, pen and redaction drags stop at the edge of their page', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    const view = await p.evaluate(() => window.__cowdreyPdf.views()[0].page.view);
    const pg = await p.locator('.page[data-n="0"]').boundingBox();
    const tools = ['tool_rect', 'cm_oval', 'cm_line', 'cm_area', 'tool_pen', 'protRedArea'];
    for (const [i, t] of tools.entries()) {
      await run(p, t);
      const y = pg.y + 120 + i * 70;
      await p.mouse.move(pg.x + pg.width - 120, y); await p.mouse.down();
      await p.mouse.move(pg.x + pg.width + 150, y + 40, { steps: 6 }); // off the right edge, over the canvas
      await p.mouse.move(pg.x + pg.width + 150, y + 30, { steps: 2 });
      await p.mouse.up(); await p.waitForTimeout(150);
    }
    // and one dragged down past the bottom of the page, onto the next page
    await run(p, 'tool_rect');
    await p.$eval('#viewer', (v) => { v.scrollTop += v.querySelector('.page[data-n="0"]').getBoundingClientRect().bottom - v.getBoundingClientRect().top - v.clientHeight / 2; });
    await p.waitForTimeout(300);
    const pb = await p.locator('.page[data-n="0"]').boundingBox();
    await p.mouse.move(pb.x + 100, pb.y + pb.height - 60); await p.mouse.down();
    await p.mouse.move(pb.x + 160, pb.y + pb.height + 120, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(150);
    await run(p, 'tool_select');
    const ms = await allMarks(p);
    eq(ms.length, tools.length + 1, 'every drag made a mark: ' + ms.map((m) => m.type));
    const keys = await p.evaluate(() => Object.entries(window.__cowdreyPdf.doc.marks).filter(([, l]) => l.length).map(([k]) => k));
    eq(keys.length, 1, 'all on the page they started on');
    for (const m of ms) {
      const pts = pointsOf(m); ok(pts.length, m.type + ' has points');
      for (const [x, y] of pts) ok(x >= view[0] - .01 && x <= view[2] + .01 && y >= view[1] - .01 && y <= view[3] + .01, `${m.type}${m.kind ? ' ' + m.kind : ''} point ${x.toFixed(1)},${y.toFixed(1)} is on the page ${view}`);
      ok(pts.some(([x]) => Math.abs(x - view[2]) < 1) || m.type === 'rect' && m.y2 != null, `${m.type} reaches the edge`);
    }
    // on screen: nothing drawn outside the page
    const over = await p.$eval('.page[data-n="0"] svg.marks', (s) => { const r = s.closest('.page').getBoundingClientRect(); return [...s.querySelectorAll('*')].filter((e) => e.getBBox && !e.matches('.mk-handle, .mk-handle *') && !['g', 'defs', 'clipPath', 'mask', 'pattern'].includes(e.tagName)).filter((e) => { const b = e.getBoundingClientRect(); return b.width && (b.right > r.right + 4 || b.bottom > r.bottom + 4); }).map((e) => e.tagName + '.' + e.getAttribute('class') + ':' + Math.round(e.getBoundingClientRect().right - r.right)).join(' '); });
    eq(over, '', 'nothing drawn past the page on screen');
    await shot(p, 'clamp-after-dark-1440.png');
    // in the saved file: every annotation's Rect inside the page
    const d = await saved(p), { PDFName } = require(H.path.join(H.root, 'desktop/node_modules/pdf-lib'));
    const pg0 = d.getPages()[0], [W, Hh] = [pg0.getWidth(), pg0.getHeight()];
    const rects = (pg0.node.Annots() ? pg0.node.Annots().asArray() : []).map((r) => d.context.lookup(r).get(PDFName.of('Rect'))).filter(Boolean).map((a) => a.asArray().map((n) => n.asNumber()));
    ok(rects.length >= tools.length, 'saved as annotations: ' + rects.length);
    for (const r of rects) ok(r[0] >= -4 && r[2] <= W + 4 && r[1] >= -4 && r[3] <= Hh + 4, `saved Rect ${r.map(Math.round)} inside ${W}x${Hh}`);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Edit PDF from the keyboard: Tab and arrows go through the lines and pictures, Enter edits or selects, Escape leaves', async () => {
    const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
    await run(p, 'tool_edit'); await p.waitForTimeout(300);
    await p.focus('#viewer');
    const said = () => p.waitForTimeout(120).then(() => p.textContent('#announce'));
    const outline = () => p.$eval('.kb-block', (e) => { const r = e.getBoundingClientRect(); return [r.width > 4, getComputedStyle(e).outlineStyle]; }).catch(() => null);
    await p.keyboard.press('Tab'); await p.waitForTimeout(300);
    eq(await outline(), [true, 'solid'], 'a visible outline');
    const first = await said(); ok(/^Line: /.test(first), 'announced: ' + first);
    eq(await p.evaluate(() => document.activeElement.id), 'viewer', 'the focus stays on the page');
    await p.keyboard.press('ArrowDown'); const second = await said(); ok(second !== first && /^(Line: |Picture)/.test(second), 'next block: ' + second);
    await p.keyboard.press('ArrowUp'); eq(await said(), first, 'and back');
    // the blocks include the page's pictures
    const labels = [first]; for (let i = 0; i < 40; i++) { await p.keyboard.press('ArrowDown'); const l = await said(); if (labels.at(-1) === l) break; labels.push(l); }
    ok(labels.includes('Picture'), 'a picture: ' + labels.join(' | '));
    // Enter on a line opens it, caret at its end
    await p.keyboard.press('Home'); await p.waitForTimeout(100);
    await p.keyboard.press('Enter'); await p.waitForSelector('.line-editor'); await p.waitForTimeout(200);
    const [c0, c1, text] = await p.evaluate(() => { const s = getSelection(), r = s.getRangeAt(0); return [r.startOffset, r.endOffset, document.activeElement.textContent]; });
    eq([c0, c1], [text.length, text.length], 'caret at the end of "' + text + '"');
    ok(first.endsWith(text.trim()) || first.includes(text.trim().slice(0, 8)), `the line announced was opened: ${first} / ${text}`);
    await p.keyboard.type(' Done'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    eq(await p.evaluate(() => document.activeElement.id), 'viewer');
    ok((await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().map((m) => m.text))).some((t) => t && t.endsWith(' Done')), 'typed at the end');
    // Tab again goes on from the line edited; on to the picture, Enter selects it, Delete removes it
    await p.keyboard.press('Tab'); await p.waitForTimeout(300);
    for (let i = 0; i < 40 && (await said()) !== 'Picture'; i++) await p.keyboard.press('ArrowDown');
    eq(await said(), 'Picture');
    await shot(p, 'kb-edit-picture-dark-1440.png');
    await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    ok(await p.$('.page svg.marks .content-sel'), 'the picture is selected');
    eq(await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().filter((m) => m.type === 'ie').length), 0, 'not moved');
    await p.keyboard.press('Delete'); await p.waitForTimeout(200);
    eq(await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().filter((m) => m.type === 'ie' && m.deleted).length), 1, 'deleted');
    // Escape leaves the outline; Tab past the last block goes on to the rest of the app
    await p.focus('#viewer'); await p.keyboard.press('Tab'); await p.waitForTimeout(300); ok(await outline(), 'outline back');
    await p.keyboard.press('Escape'); ok(!(await p.$('.kb-block')), 'gone after Escape');
    await p.keyboard.press('Tab'); await p.waitForTimeout(300); await p.keyboard.press('End');
    await p.keyboard.press('Tab'); await p.waitForTimeout(100);
    ok(await p.evaluate(() => document.activeElement.id !== 'viewer'), 'Tab from the last block leaves the page'); ok(!(await p.$('.kb-block')), 'outline gone');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Keyboard shortcuts lists the Edit PDF keys', async () => {
    const p = await open(); await openPdf(p);
    await run(p, 'shortcuts');
    const t = await p.textContent('#dialog');
    ok(/Edit PDF: go to the next line or picture/.test(t) && /Edit PDF: edit that line or select that picture/.test(t), t.slice(0, 200));
    await p.ctx.close();
  });
};
