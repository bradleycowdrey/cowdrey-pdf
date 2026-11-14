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
};
