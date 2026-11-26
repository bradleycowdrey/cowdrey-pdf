// The App Store stories: how each screen is reached in the app, step by step. Shared by the browser capture
// (tests/app-store-screens.mjs, through Playwright) and the iOS Simulator capture (tests/app-store-sim, through a
// small stand-in for Playwright's page that runs inside the app itself), so both steer the app the same way.
// Uses only the page API (evaluate, waitForFunction, locator, mouse, touchscreen, keyboard, fill, click…) and
// p.openDoc(bytes, name); no Node modules.
const H = 792; // a US Letter page's height in points (the documents' pages)
const run = (p, id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id);
const tab = async (p, name) => { const t = p.locator('.ribbon-tabs button', { hasText: name }).first(); if (await t.count()) await t.click(); await p.waitForTimeout(300); };
const openDoc = (p, bytes, name) => p.openDoc(bytes, name);

/* ---------------- the stories, best first ---------------- */
const goPage = async (p, n, block = 'start') => { await p.evaluate(([n, block]) => { const v = document.querySelector(`.page[data-n="${n}"]`); v && v.scrollIntoView({ block }); }, [n, block]); await p.waitForTimeout(500); };
const lineAt = (p, n, text) => p.locator(`.page[data-n="${n}"] .textLayer span`, { hasText: text }).first();
async function tapLine(p, n, text, where = 'end') {
  const b = await (await lineAt(p, n, text)).boundingBox();
  const x = where === 'end' ? b.x + b.width - 2 : b.x + 2, y = b.y + b.height / 2;
  if (p.kind === 'mac') await p.mouse.click(x, y); else await p.touchscreen.tap(x, y);
  await p.waitForTimeout(400);
}
async function selectText(p, n, text) {
  const b = await (await lineAt(p, n, text)).boundingBox();
  await p.mouse.move(b.x + 1, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(200);
}
// A one-page document: on the iPad the page gets the whole width (the page list would show a single thumbnail), and
// the Mac fits the page to the width, so the words are as large as they are when you work.
async function onePage(p) {
  if (p.kind === 'ipad') { await run(p, 'sidebar'); await p.waitForTimeout(500); }
  if (p.kind !== 'iphone') { await zoom(p, 'zoomFit'); await p.waitForTimeout(600); }
}
// Scroll so that a point a fraction of the way down page n is at the top of the view.
const pageAt = async (p, n, f) => { await p.evaluate(([n, f]) => { const v = document.querySelector('#viewer'), el = document.querySelector(`.page[data-n="${n}"]`); v.scrollTop += el.getBoundingClientRect().top - v.getBoundingClientRect().top + el.offsetHeight * f; }, [n, f]); await p.waitForTimeout(500); };
const zoom = (p, z) => p.evaluate((z) => window.__cowdreyPdf.run(z), z);
const setZoom = async (p, z) => { await p.evaluate((z) => { const r = document.querySelector('#zoomRange'); r.value = z; r.dispatchEvent(new Event('change')); }, z); await p.waitForTimeout(1500); };
// Scroll so the top of the line with this text on page n sits `gap` points under the top of the view.
async function lineTo(p, n, text, gap) {
  await p.waitForFunction(findSpan, [n, text], { timeout: 15000 });
  await p.evaluate(([n, text, gap, fs]) => {
    const el = eval(fs)([n, text]), v = document.querySelector('#viewer');
    v.scrollTop += el.getBoundingClientRect().top - (v.getBoundingClientRect().top + gap);
  }, [n, text, gap, findSpan.toString()]);
  await p.waitForTimeout(700);
}
// On the iPhone, Fit width leaves a page's margins and a lot of grey around a small page. Zoom in two steps (to
// about 87%), so the page's text runs from edge to edge of the screen, and keep the page centred across.
async function phoneZoom(p) {
  if (p.kind !== 'iphone') return;
  await run(p, 'zoomIn'); await p.waitForTimeout(300); await run(p, 'zoomIn'); await p.waitForTimeout(1200);
}
// Scroll so the line with this text on page n sits at fraction f of the view's height, the page centred across.
// (A span that is exactly the text wins over one that only contains it: recognized text comes word by word.)
const findSpan = ([n, text]) => {
  const all = [...document.querySelectorAll(`.page[data-n="${n}"] .textLayer span`)];
  return all.find((s) => s.textContent.trim() === text) || all.find((s) => s.textContent.includes(text));
};
async function centerOn(p, n, text, f = .5) {
  await p.waitForFunction(findSpan, [n, text], { timeout: 15000 });
  await p.evaluate(([n, text, f, fs]) => {
    const el = eval(fs)([n, text]);
    const v = document.querySelector('#viewer'), vr = v.getBoundingClientRect(), r = el.getBoundingClientRect();
    v.scrollTop += r.top + r.height / 2 - (vr.top + vr.height * f);
    v.scrollLeft = (v.scrollWidth - v.clientWidth) / 2;
  }, [n, text, f, findSpan.toString()]);
  await p.waitForTimeout(700);
}
// Scroll so the top of page n sits just under the floating search bar: the letterhead is whole and in view, and no
// line of the page is cut by the bar's edge.
async function belowFind(p, n) {
  await p.evaluate((n) => {
    const v = document.querySelector('#viewer'), el = document.querySelector(`.page[data-n="${n}"]`), bar = document.querySelector('#findbar');
    v.scrollTop += el.getBoundingClientRect().top - (bar.getBoundingClientRect().bottom + 6);
    v.scrollLeft = (v.scrollWidth - v.clientWidth) / 2;
  }, n);
  await p.waitForTimeout(700);
}
// Drag across the words from one to another (the first of them after it), as a finger or the mouse selects text.
async function selectWords(p, n, from, to) {
  const [a, b] = await p.evaluate(([n, from, to]) => {
    const all = [...document.querySelectorAll(`.page[data-n="${n}"] .textLayer span`)];
    const i = all.findIndex((s) => s.textContent.trim() === from), j = all.findIndex((s, k) => k > i && s.textContent.trim() === to);
    const r = (el) => { const q = el.getBoundingClientRect(); return [q.left, q.top, q.width, q.height]; };
    return [r(all[i]), r(all[j])];
  }, [n, from, to]);
  await p.mouse.move(a[0] + 1, a[1] + a[3] / 2); await p.mouse.down();
  await p.mouse.move(b[0] + b[2] - 1, b[1] + b[3] / 2, { steps: 10 }); await p.mouse.up();
  await p.waitForTimeout(300);
}

const STORIES = [
  { slug: 'edit-text',
    async shoot(p, docs) {
      await openDoc(p, docs.review, 'Service review 2026.pdf');
      await tab(p, 'Edit'); await run(p, 'txtEditLines'); await p.waitForTimeout(400);
      if (p.kind === 'iphone') {
        // The cover's title, zoomed in so the text runs across the screen, in the middle of the view.
        await phoneZoom(p); await centerOn(p, 0, '2026 Service Review', .42);
        await tapLine(p, 0, '2026 Service Review');
        await p.keyboard.press('End'); for (let i = 0; i < 14; i++) await p.keyboard.press('Backspace');
        await p.keyboard.type('Year in Review', { delay: 20 });
      } else {
        await goPage(p, 1);
        if (p.kind === 'mac') {
          // Close in on the page (150%), so the edit box and the format bar read at thumbnail size: the whole width
          // of the page with the grey on both sides, from under the page's running head (the view's top falls in
          // the gap above the title) to past the last line of its text, so no line is cut at an edge.
          await setZoom(p, 150);
          await p.evaluate(([H]) => {
            const v = document.querySelector('#viewer'), el = document.querySelector('.page[data-n="1"]');
            v.scrollTop += el.getBoundingClientRect().top - v.getBoundingClientRect().top + el.offsetHeight * 62 / H;
            v.scrollLeft = (v.scrollWidth - v.clientWidth) / 2;
          }, [H]);
          await p.waitForTimeout(700);
        }
        if (p.kind === 'ipad') {
          // The last line of the page's text, so the format bar opens over the empty foot of the page and no
          // line is cut by its edge.
          await tapLine(p, 1, 'quieter timetable');
          await p.keyboard.press('End'); for (let i = 0; i < 12; i++) await p.keyboard.press('Backspace');
          await p.keyboard.type('fifth year.', { delay: 20 });
        } else {
          await tapLine(p, 1, 'Average delay down');
          await p.keyboard.press('End'); for (let i = 0; i < 11; i++) await p.keyboard.press('Backspace');
          await p.keyboard.type('1.8 minutes', { delay: 20 });
        }
      }
      await p.waitForTimeout(400);
    } },
  { slug: 'scans-to-text',
    async shoot(p, docs) {
      await openDoc(p, docs.scan, 'Garden letter.pdf');
      if (p.kind === 'mac') await tab(p, 'Edit'); // where Recognize text is
      await onePage(p);
      const r = await p.evaluate(() => window.__cowdreyPdf.ocrRunHeadless({ lang: 'eng' }));
      if (!r.words) throw new Error('OCR found no words: ' + JSON.stringify(r));
      await p.waitForTimeout(600);
      await run(p, 'find'); await p.fill('#findInput', 'plot'); await p.waitForTimeout(900);
      // The fees paragraph and the price list (three of the hits) in the middle of the view, and the line under the
      // list selected, as you would to copy it: what was a picture of a page is text now. (The selection's own
      // toolbar opens under it, clear of the list.)
      await phoneZoom(p);
      // (On the Mac the selection's toolbar opens above it and would cover the list: the hits alone tell it there.)
      // The Mac at 125%: the letter whole from "Dear plot holder" to the signature, the closing and the PAID stamp,
      // the view's top in the gap under the date and its foot in the paper under the secretary's name.
      if (p.kind === 'mac') { await setZoom(p, 125); await lineTo(p, 0, 'Dear', 28); await p.evaluate(() => { const v = document.querySelector('#viewer'); v.scrollLeft = (v.scrollWidth - v.clientWidth) / 2; }); }
      else { await belowFind(p, 0); await selectWords(p, 0, 'Water', 'Please'); }
    } },
  { slug: 'fill-and-sign',
    async shoot(p, docs) {
      await openDoc(p, docs.form.bytes, 'Membership 2027.pdf');
      await onePage(p);
      await p.waitForSelector('.annotationLayer input');
      if (p.kind === 'mac') await tab(p, 'Protect'); // its first tool is Signature
      await run(p, 'sign'); await p.waitForSelector('#dialog[open] #sigPad');
      const pad = await (await p.$('#sigPad')).boundingBox();
      for (const stroke of SIGNATURE) {
        const pts = smooth(stroke);
        await p.mouse.move(pad.x + pts[0][0] * pad.width, pad.y + pts[0][1] * pad.height); await p.mouse.down();
        for (const [x, y] of pts.slice(1)) await p.mouse.move(pad.x + x * pad.width, pad.y + y * pad.height);
        await p.mouse.up();
      }
      await p.click('#dialog .dlg-foot .btn.primary'); await p.waitForTimeout(400);
      // The Mac at 100%: the form from "About you", 24 points under the ribbon, to the signature and date, so the
      // first line in view is a heading and none is cut.
      if (p.kind === 'mac') { await setZoom(p, 100); await lineTo(p, 0, 'About you', 24); } else if (p.kind === 'iphone') { await phoneZoom(p); await centerOn(p, 0, 'Declaration', .5); } else await goPage(p, 0, 'end');
      const [sx, sy] = docs.form.sigLine;
      const [x, y] = await at(p, 0, sx + 120, sy + 22);
      await p.mouse.click(x, y); await p.waitForTimeout(500);
      await run(p, 'tool_select'); await p.keyboard.press('Escape');
      await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    } },
  { slug: 'comments',
    async shoot(p, docs) {
      await openDoc(p, docs.review, 'Service review 2026.pdf');
      await tab(p, 'Comment'); await goPage(p, 1);
      await run(p, 'tool_highlight');
      for (const t of ['Ridership up 12 percent on 2025', 'Kestrel, our first electric ferry']) await selectText(p, 1, t);
      await p.evaluate(() => window.__cowdreyPdf.setAuthor('Priya Nair'));
      await run(p, 'tool_note'); { const [x, y] = await at(p, 1, 500, 590); await p.mouse.click(x, y); }
      await p.waitForSelector('.page-ask textarea'); await p.fill('.page-ask textarea', 'Can we add the Sunday figures here?'); await p.click('.page-ask .btn.primary'); await p.waitForTimeout(300);
      await p.evaluate(() => window.__cowdreyPdf.setAuthor('Alex Morgan'));
      await run(p, 'tool_select'); await p.keyboard.press('Escape');
      if (p.kind !== 'iphone') { await run(p, 'cm_list'); await p.waitForTimeout(600); }
      await goPage(p, 1);
      await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    } },
  { slug: 'redact',
    async shoot(p, docs) {
      await openDoc(p, docs.letter, 'Tenant reference.pdf');
      await onePage(p);
      await tab(p, 'Protect');
      for (const t of ['Jordan', 'Ellis', '7 Orchard Court', '555-0194', 'jordan.ellis@example.com', '23 September 1994', '31926458', '40-12-77', '41 Kestrel Road, Millbrook']) {
        await run(p, 'protRedSearch'); await p.waitForSelector('#dialog[open] input[name=text]'); await p.fill('#dialog input[name=text]', t);
        await p.click('#dialog .dlg-foot button:has-text("Find")');
        await p.waitForSelector('#dialog[open] .dlg-foot button:has-text("Mark")'); await p.click('#dialog .dlg-foot button:has-text("Mark")'); await p.waitForTimeout(250);
      }
      await run(p, 'protRedApply'); await p.waitForSelector('#dialog[open]'); await p.click('#dialog .dlg-foot button:has-text("Apply")'); await p.waitForTimeout(800);
      // the redacted contact details in the middle of the view
      if (p.kind === 'mac') await pageAt(p, 0, .13);
      if (p.kind === 'iphone') { await phoneZoom(p); await centerOn(p, 0, 'Contact details we hold', .45); }
    } },
  { slug: 'organize-pages',
    async shoot(p, docs) {
      // A board pack of twelve pages, so the grid fills the screen, with two pages picked to move together.
      await openDoc(p, docs.pack, 'Board pack 2027.pdf');
      await tab(p, 'Pages'); await run(p, 'pg60_organize'); await p.waitForTimeout(2500);
      await p.evaluate(() => window.__cowdreyPdf.pg60.setSel([2, 3])); await p.waitForTimeout(600);
    } },
];
// A handwritten "Alex Morgan", as strokes in the signature pad (fractions of its width and height).
const SIGNATURE = [
  [[.06, .80], [.11, .52], [.16, .22], [.19, .30], [.21, .62], [.24, .80]],
  [[.10, .58], [.17, .54], [.23, .52], [.27, .40], [.28, .22], [.29, .50], [.30, .66], [.33, .58], [.36, .54], [.34, .64], [.38, .66], [.41, .56], [.43, .64], [.46, .54], [.44, .66], [.48, .62]],
  [[.51, .78], [.54, .40], [.56, .24], [.58, .52], [.60, .70], [.63, .34], [.65, .24], [.67, .56], [.69, .70], [.72, .58], [.75, .54], [.74, .64], [.77, .62], [.79, .55], [.80, .64], [.83, .56], [.86, .60], [.85, .80], [.82, .92], [.80, .82], [.86, .60], [.89, .56], [.90, .64], [.93, .56], [.95, .62]],
  [[.12, .90], [.40, .86], [.70, .84], [.92, .82]],
];
// Catmull-Rom through the points, so the pen moves in curves.
function smooth(pts, n = 8) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    for (let k = 0; k < n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t; out.push([0, 1].map((j) => .5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3))); }
  }
  out.push(pts[pts.length - 1]); return out;
}
// A point on page n (PDF units) on the screen.
const at = (p, n, x, y) => p.evaluate(([n, x, y]) => { const v = window.__cowdreyPdf.views()[n]; const [vx, vy] = v.viewport.convertToViewportPoint(x, y); const r = v.el.getBoundingClientRect(); return [r.left + vx, r.top + vy]; }, [n, x, y]);

// After a story, before the picture: the ribbon and tab strip from their start, and no toast.
async function finish(p) {
  await p.evaluate(() => document.querySelectorAll('.ribbon-body').forEach((r) => { if (!r.dataset.keepScroll) r.scrollLeft = 0; }));
  // the tab strip from its start, so "Home" is never cut off, with the chosen tab still in view
  await p.evaluate(() => document.querySelectorAll('.ribbon-tabs').forEach((t) => { const a = t.querySelector('[aria-selected="true"], .on, .active'); t.scrollLeft = 0; if (a && a.offsetLeft + a.offsetWidth > t.clientWidth) t.scrollLeft = a.offsetLeft + a.offsetWidth - t.clientWidth + 8; }));
  // the rows that scroll sideways fade at the edge with more to see, as they do in the app after any scroll
  await p.evaluate(() => { const b = document.querySelector('#ribbonBody'); b && b.dispatchEvent(new Event('scroll')); });
  // what happened is shown in a toast for a moment: wait for it to go, so it covers nothing
  await p.waitForFunction(() => !document.querySelector('#toast.show'), null, { timeout: 15000 }).catch(() => {});
}

export { STORIES, finish, run, tab };
