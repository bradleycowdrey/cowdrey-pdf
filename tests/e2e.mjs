// End-to-end tests for Cowdrey.PDF. Run: (cd desktop && npm ci) && node tests/sample.mjs && node tests/e2e.mjs
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
import { open as openApp, openPdf, close, missing, root } from './harness.mjs';
// Comments are signed with your name once it is set: tests start with one, unless they ask for none (askName).
async function open(o = {}) { const p = await openApp(o); if (!o.askName) await p.evaluate(() => window.__cowdreyPdf.setAuthor && window.__cowdreyPdf.setAuthor('Tester')); return p; }
const require = createRequire(import.meta.url);
const { PDFDocument } = require('../desktop/node_modules/pdf-lib');
const results = [];
async function test(name, fn) { try { await fn(); results.push([true, name]); } catch (e) { results.push([false, name, e.message.split('\n')[0]]); } }
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, m) => { if (!v) throw new Error(m || 'not ok'); };
const saved = async (p) => PDFDocument.load(Buffer.from(await p.evaluate(async () => Array.from(await window.__cowdreyPdf.buildPdf()))));
const marks = (p) => p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().map((m) => m.type));
async function selectText(p, n, text, frac = .5) {
  const s = p.locator(`.page[data-n="${n}"] .textLayer span`, { hasText: text }).first();
  const b = await s.boundingBox();
  await p.mouse.move(b.x + 1, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width * frac, b.y + b.height / 2, { steps: 5 }); await p.mouse.up();
}

await test('opens a PDF: pages, thumbnails, page count, title, text layer; nothing fails to load', async () => {
  const p = await open(); await openPdf(p);
  eq(await p.$$eval('.page', (e) => e.length), 3); eq(await p.textContent('#pageCount'), '3');
  eq(await p.textContent('#docTitle'), 'Quarterly report');
  ok(await p.$('.textLayer span'), 'selectable text'); eq(await p.$$eval('.thumb', (e) => e.length), 3);
  ok(await p.evaluate(() => { const c = document.querySelector('.page canvas.pdf'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let ink = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 3] > 0) ink++; return ink > 500; }), 'page drawn');
  eq(p.errors, []); await p.ctx.close();
});
await test('find: counts every match across pages and steps through them', async () => {
  const p = await open(); await openPdf(p);
  await p.keyboard.press('Control+f'); await p.fill('#findInput', 'pelican'); await p.waitForTimeout(600);
  eq(await p.textContent('#findCount'), '1 of 6');
  await p.keyboard.press('Enter'); eq(await p.textContent('#findCount'), '2 of 6');
  ok(await p.$('.find-hit.now'), 'current match marked');
  await p.keyboard.press('Escape'); ok(await p.$eval('#findbar', (e) => e.hidden), 'closed'); eq(await p.$$eval('.find-hit', (e) => e.length), 0);
  await p.ctx.close();
});
await test('mark up: highlight selected text, draw, box, text, note; undo and redo; all saved into the PDF', async () => {
  const p = await open(); await openPdf(p);
  await p.click('[data-rt="markup"]');
  await p.click('[data-cmd="tool_highlight"]'); await selectText(p, 0, 'Cowdrey.PDF opens'); await p.waitForTimeout(200);
  await p.click('[data-cmd="tool_pen"]');
  const g = await p.locator('.page[data-n="0"]').boundingBox();
  await p.mouse.move(g.x + 100, g.y + 500); await p.mouse.down(); await p.mouse.move(g.x + 300, g.y + 540, { steps: 8 }); await p.mouse.up();
  await p.click('[data-cmd="tool_rect"]');
  await p.mouse.move(g.x + 90, g.y + 480); await p.mouse.down(); await p.mouse.move(g.x + 320, g.y + 560, { steps: 4 }); await p.mouse.up();
  await p.click('[data-rt="edit"]'); await p.click('[data-cmd="tool_text"]'); await p.mouse.click(g.x + 100, g.y + 620);
  await p.fill('#dlgInput', 'Approved'); await p.click('#dialog .btn.primary');
  await p.click('[data-rt="markup"]'); await p.click('[data-cmd="tool_note"]'); await p.mouse.click(g.x + 400, g.y + 620);
  await p.fill('#dlgInput', 'Check the numbers'); await p.click('#dialog .btn.primary');
  eq(await marks(p), ['hl', 'ink', 'rect', 'text', 'note']);
  await p.keyboard.press('Control+z'); eq((await marks(p)).length, 4, 'undo');
  await p.keyboard.press('Control+Shift+z'); eq((await marks(p)).length, 5, 'redo');
  const d = await saved(p);
  const annots = d.getPages()[0].node.Annots();
  ok(annots && annots.asArray().some((r) => String(d.context.lookup(r).get(require('../desktop/node_modules/pdf-lib').PDFName.of('Subtype'))) === '/Text'), 'note is a real PDF comment');
  eq(d.getPageCount(), 3); eq(p.errors, []); await p.ctx.close();
});
await test('select a mark: move it by dragging, delete it with the Delete key', async () => {
  const p = await open(); await openPdf(p);
  await p.click('[data-rt="markup"]'); await p.click('[data-cmd="tool_rect"]');
  const g = await p.locator('.page[data-n="0"]').boundingBox();
  await p.mouse.move(g.x + 100, g.y + 500); await p.mouse.down(); await p.mouse.move(g.x + 200, g.y + 560, { steps: 3 }); await p.mouse.up();
  await p.click('[data-cmd="tool_select"]');
  const before = await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat()[0].x1);
  await p.mouse.move(g.x + 100, g.y + 530); await p.mouse.down(); await p.mouse.move(g.x + 160, g.y + 530, { steps: 4 }); await p.mouse.up();
  const after = await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat()[0].x1);
  ok(after > before + 20, `moved ${before} → ${after}`);
  await p.keyboard.press('Delete'); eq(await marks(p), []);
  await p.ctx.close();
});
await test('forms: typed values and ticks are kept in the saved PDF; checkbox tick shows', async () => {
  const p = await open(); await openPdf(p);
  await p.fill('.annotationLayer input[name="name"]', 'Bradley Cowdrey'); await p.click('.annotationLayer .checkBox input');
  ok(await p.$eval('.checkBox [data-canvas-name="checked"]', (c) => getComputedStyle(c).display !== 'none'), 'tick drawn');
  const f = (await saved(p)).getForm();
  eq(f.getTextField('name').getText(), 'Bradley Cowdrey'); eq(f.getCheckBox('agree').isChecked(), true);
  await p.ctx.close();
});
await test('pages: rotate, move, duplicate, delete, insert blank; saved PDF follows', async () => {
  const p = await open(); await openPdf(p);
  const run = (id) => p.evaluate((i) => window.__cowdreyPdf.run(i), id).then(() => p.waitForTimeout(250));
  await run('rotR'); await run('down'); await run('dup'); await run('blank'); await p.waitForSelector('#dialog[open]'); await p.click('#dialog .btn.primary'); // after this page, its size
  await p.waitForFunction(() => window.__cowdreyPdf.doc.pages.length === 5, null, { timeout: 10000 }); // the blank page is made with pdf-lib, which may still be loading
  const order = await p.evaluate(() => window.__cowdreyPdf.doc.pages.map((e) => `${e.src}:${e.i}:${e.rot}`));
  eq(order, ['0:1:0', '0:0:90', '0:0:90', '1:0:0', '0:2:0']);
  await run('delPage');
  const d = await saved(p);
  eq(d.getPageCount(), 4); eq(d.getPages().map((x) => x.getRotation().angle), [0, 90, 0, 0]); // the copy (third) was deleted
  eq(await p.$$eval('.thumb', (e) => e.length), 4); eq(p.errors, []);
  await p.ctx.close();
});
await test('signature: drawn once, kept for next time, placed as a picture in the PDF', async () => {
  const p = await open(); await openPdf(p);
  await p.evaluate(() => window.__cowdreyPdf.run('sign'));
  const pad = await p.locator('#sigPad').boundingBox();
  await p.mouse.move(pad.x + 20, pad.y + 80); await p.mouse.down(); await p.mouse.move(pad.x + 200, pad.y + 40, { steps: 10 }); await p.mouse.move(pad.x + 300, pad.y + 100, { steps: 10 }); await p.mouse.up();
  await p.click('#dialog .btn.primary');
  const g = await p.locator('.page[data-n="0"]').boundingBox();
  await p.mouse.click(g.x + 300, g.y + 450);
  eq(await marks(p), ['img']);
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem('cowdrey.pdf:signatures') || '[]').length === 1), 'kept');
  const d = await saved(p); ok(d.getPageCount() === 3);
  await p.ctx.close();
});
await test('library: an opened PDF and its mark-up come back after a reload', async () => {
  const p = await open(); await openPdf(p);
  await p.click('[data-rt="markup"]'); await p.click('[data-cmd="tool_rect"]');
  const g = await p.locator('.page[data-n="0"]').boundingBox();
  await p.mouse.move(g.x + 100, g.y + 500); await p.mouse.down(); await p.mouse.move(g.x + 200, g.y + 560, { steps: 3 }); await p.mouse.up();
  await p.waitForTimeout(600);
  await p.reload(); await p.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 15000 }); await p.waitForTimeout(400);
  eq(await p.textContent('#docTitle'), 'Quarterly report'); eq(await marks(p), ['rect']);
  await p.click('[data-side="docs"]'); await p.waitForSelector('.doc-item'); eq(await p.$$eval('.doc-item', (e) => e.length), 1);
  await p.ctx.close();
});
await test('extract pages: parses ranges', async () => {
  const p = await open(); await openPdf(p);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => window.__cowdreyPdf.run('extract')).then(async () => { await p.fill('#dlgInput', '1, 3'); await p.click('#dialog .btn.primary'); })]);
  const d = await PDFDocument.load(fs.readFileSync(await dl.path()));
  eq(d.getPageCount(), 2); eq(dl.suggestedFilename(), 'Quarterly report (pages 1,3).pdf');
  await p.ctx.close();
});
await test('phone: the page fits the screen, the sidebar is out of the way, nothing scrolls sideways', async () => {
  const p = await open({ width: 390, height: 844, touch: true }); await openPdf(p);
  const w = await p.$eval('.page', (e) => e.getBoundingClientRect().width);
  ok(w <= 390 - 24, `page ${w}px`); eq(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  eq(await p.$eval('#sidebar', (e) => getComputedStyle(e).visibility), 'hidden');
  await p.ctx.close();
});
await test('dark pages and themes', async () => {
  const p = await open(); await openPdf(p);
  await p.evaluate(() => window.__cowdreyPdf.run('darkPage'));
  ok((await p.$eval('.page canvas.pdf', (c) => getComputedStyle(c).filter)).includes('invert'), 'dark page');
  await p.evaluate(() => window.__cowdreyPdf.run('theme_light'));
  eq(await p.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light');
  await p.ctx.close();
});
await test('Mac app: opens a PDF from Finder, saves back to the same file, menu bar matches the app', async () => {
  const b64 = fs.readFileSync(path.join(root, 'tests/fixtures/sample.pdf')).toString('base64');
  const p = await open({ init: [(b) => {
    window.__calls = [];
    window.__TAURI__ = { core: { invoke: async (c, a) => { window.__calls.push([c, a]); if (c === 'take_opened_files') { if (window.__h) return []; window.__h = 1; return [{ name: 'Report.pdf', path: '/Users/me/Report.pdf', content: b }]; } return null; } },
      dialog: {}, event: { listen: async () => {} }, opener: {} };
  }, b64] });
  await p.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 15000 });
  eq(await p.textContent('#docTitle'), 'Report');
  await p.evaluate(() => window.__cowdreyPdf.run('save')); await p.waitForTimeout(800);
  const w = await p.evaluate(() => window.__calls.filter(([c]) => c === 'write_binary_file').map(([, a]) => [a.path, a.base64.length > 1000]));
  eq(w, [['/Users/me/Report.pdf', true]], 'saved in place');
  const menus = await p.evaluate(() => (window.__calls.find(([c]) => c === 'set_menu') || [])[1]);
  const titles = menus.menus.map((m) => m.title);
  eq([titles.slice(0, 5), titles[titles.length - 1]], [['File', 'Edit', 'View', 'Comment', 'Pages'], 'Help']);
  // Every entry must be one the Mac side understands, or the whole menu bar is refused.
  const bad = menus.menus.flatMap((m) => m.items).filter((x) => !x || typeof x !== 'object' || !['item', 'sep', 'native'].includes(x.kind) || (x.kind === 'item' && !(x.id && x.label)));
  eq(bad, [], 'menu items'); ok(menus.menus[0].items.some((x) => x.id === 'cmd:save'), 'File has Save');
  eq(p.errors, []); await p.ctx.close();
});
await test('iPhone app: Save PDF opens the share sheet with the PDF', async () => {
  const p = await open({ width: 390, height: 844, touch: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', init: () => {
    window.__calls = [];
    window.__TAURI__ = { core: { invoke: async (c, a) => { window.__calls.push([c, a]); if (c === 'write_share_file') return '/private/var/tmp/' + a.name; return c === 'take_opened_files' ? [] : null; } }, dialog: {}, event: { listen: async () => {} }, opener: {} };
  } });
  await openPdf(p);
  await p.evaluate(() => window.__cowdreyPdf.run('save')); await p.waitForTimeout(800);
  const calls = await p.evaluate(() => window.__calls.filter(([c]) => /share/.test(c)).map(([c, a]) => [c, a.name || a.url, a.mimeType || (a.base64 || '').length > 1000]));
  eq(calls, [['write_share_file', 'Quarterly report.pdf', true], ['plugin:sharekit|share_file', 'file:///private/var/tmp/Quarterly%20report.pdf', 'application/pdf']]);
  eq(p.errors, []); await p.ctx.close();
});
// A pretend Mac app: records every call to the native side. `files` are what Finder opened the app with.
const fixture = (n) => fs.readFileSync(path.join(root, 'tests/fixtures', n)).toString('base64');
function macApp(opts = {}) {
  return [(o) => {
    window.__calls = []; window.__events = {}; window.__mtime = o.mtime || 1000;
    const pending = o.files || [];
    window.__TAURI__ = {
      core: { invoke: async (c, a) => {
        window.__calls.push([c, a]);
        if (c === 'take_opened_files') return pending.splice(0);
        if (c === 'file_modified') return window.__mtime;
        if (c === 'read_text_file') return { name: a.path.split('/').pop(), path: a.path, content: o.read };
        if (c === 'write_share_file') return '/tmp/' + a.name;
        return null;
      } },
      dialog: { save: async (a) => { window.__calls.push(['dialog.save', a]); return '/Users/me/Desktop/' + a.defaultPath; }, open: async () => '/Users/me/Picked.pdf' },
      event: { listen: async (n, f) => { window.__events[n] = f; } },
      opener: { openUrl: async (u) => { window.__calls.push(['openUrl', u]); } },
    };
  }, opts];
}
const calls = (p, re) => p.evaluate((r) => window.__calls.filter(([c]) => new RegExp(r).test(c)), re.source);
const answer = async (p, label) => { await p.waitForSelector('#dialog[open]'); await p.click(`#dialog .dlg-foot button:has-text("${label}")`); };
const waitPages = (p) => p.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 15000 });

await test('protected PDF: asks for the password, never stores it, saves with or without it as chosen', async () => {
  const p = await open();
  const b64 = fixture('protected.pdf');
  const opening = p.evaluate(async (b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return window.__cowdreyPdf.openBytes(u, 'Secret.pdf'); }, b64);
  await p.waitForSelector('#dialog[open] #dlgInput'); await p.fill('#dlgInput', 'wrong'); await p.click('#dialog .btn.primary');
  await p.waitForFunction(() => /did not open/.test(document.querySelector('#dialog h2').textContent));
  await p.fill('#dlgInput', 'pelican'); await p.click('#dialog .btn.primary');
  eq(await opening, true); await waitPages(p); await p.waitForTimeout(400);
  const stored = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('cowdrey.pdf', 1); r.onsuccess = () => { const q = r.result.transaction('docs').objectStore('docs').getAll(); q.onsuccess = () => res(JSON.stringify(q.result.map((d) => Object.keys(d)))); }; }));
  ok(!/password/i.test(stored), 'no password in the library: ' + stored);
  const C = require('../desktop/node_modules/@cantoo/pdf-lib');
  const build = () => p.evaluate(async () => { const b = await window.__cowdreyPdf.buildPdf(); return b && Array.from(b); });
  let out = build(); await answer(p, 'Keep password');
  const kept = Buffer.from(await out);
  await PDFDocument.load(kept).then(() => { throw new Error('kept copy opened without a password'); }, () => {});
  eq((await C.PDFDocument.load(kept, { password: 'pelican' })).getPageCount(), 3);
  const pdfjs = await import(path.join(root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
  const perms = async (b) => [...((await (await pdfjs.getDocument({ data: new Uint8Array(b), password: 'pelican' }).promise).getPermissions()) || [])].sort((x, y) => x - y);
  eq(await perms(kept), await perms(fs.readFileSync(path.join(root, 'tests/fixtures/protected.pdf'))), 'restrictions kept');
  ok((await perms(kept)).length > 0 && !(await perms(kept)).includes(pdfjs.PermissionFlag.COPY), 'copying still not allowed');
  await p.evaluate(() => { window.__cowdreyPdf.doc.keepPassword = null; });
  out = build(); await answer(p, 'Remove password');
  const plain = await PDFDocument.load(Buffer.from(await out));
  eq(plain.getPageCount(), 3); eq(plain.getForm().getFields().length, 2, 'form kept');
  eq(p.errors, []); await p.ctx.close();
});
await test('Mac app: a file opened from Finder at launch wins over last time\'s document', async () => {
  const first = await open(); await openPdf(first, undefined, 'Last time.pdf');
  const p = await first.ctx.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
  const [fn, arg] = macApp({ files: [{ name: 'Report.pdf', path: '/Users/me/Report.pdf', content: fixture('sample.pdf') }] });
  await p.addInitScript(fn, arg); await p.goto('https://app.test/'); await waitPages(p); await p.waitForTimeout(1500);
  eq(await p.textContent('#docTitle'), 'Report');
  eq(await p.evaluate(() => window.__cowdreyPdf.doc.path), '/Users/me/Report.pdf');
  eq(p.errors, []); await first.ctx.close();
});
await test('Mac app: print, export, extract and share use the Mac, not the browser', async () => {
  const p = await open({ init: macApp({ files: [{ name: 'Report.pdf', path: '/Users/me/Report.pdf', content: fixture('sample.pdf') }] }) });
  await waitPages(p);
  await p.evaluate(() => window.__cowdreyPdf.run('print')); await p.waitForTimeout(300);
  eq((await calls(p, /^print_page$/)).length, 1, 'print');
  await p.evaluate(() => window.__cowdreyPdf.run('exportText')); await p.waitForTimeout(500);
  await p.evaluate(() => window.__cowdreyPdf.run('exportImage')); await p.waitForTimeout(1200);
  await p.evaluate(() => window.__cowdreyPdf.run('extract')); await p.fill('#dlgInput', '2-3'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(800);
  const writes = (await calls(p, /^write_binary_file$/)).map(([, a]) => a.path);
  eq(writes, ['/Users/me/Desktop/Report.txt', '/Users/me/Desktop/Report page 1.png', '/Users/me/Desktop/Report (pages 2-3).pdf']);
  await p.evaluate(() => window.__cowdreyPdf.run('share')); await p.waitForTimeout(800);
  const share = (await calls(p, /sharekit\|share_file/)).map(([, a]) => [a.url, a.mimeType, !!a.position]);
  eq(share, [['/tmp/Report.pdf', 'application/pdf', true]]);
  await p.evaluate(() => window.__cowdreyPdf.run('legal')); await p.waitForTimeout(100);
  eq((await calls(p, /^openUrl$/)).map(([, u]) => u), ['https://bradcowdrey.com/legal']);
  eq(p.errors, []); await p.ctx.close();
});
await test('Mac app: Save a copy leaves the file edited; a file changed elsewhere is not replaced without asking', async () => {
  const p = await open({ init: macApp({ files: [{ name: 'Report.pdf', path: '/Users/me/Report.pdf', content: fixture('sample.pdf') }] }) });
  await waitPages(p);
  await p.evaluate(() => window.__cowdreyPdf.run('rotR')); await p.waitForTimeout(200);
  await p.evaluate(() => window.__cowdreyPdf.run('saveCopy')); await p.waitForTimeout(800);
  eq(await p.evaluate(() => window.__cowdreyPdf.doc.dirty), true, 'still edited after a copy');
  eq(await p.evaluate(() => window.__cowdreyPdf.doc.path), '/Users/me/Report.pdf');
  await p.evaluate(() => { window.__mtime = 2000; window.__calls.length = 0; });
  p.evaluate(() => window.__cowdreyPdf.run('save'));
  await answer(p, 'Cancel'); await p.waitForTimeout(300);
  eq((await calls(p, /^write_binary_file$/)).length, 0, 'nothing written after Cancel');
  p.evaluate(() => window.__cowdreyPdf.run('save'));
  await answer(p, 'Replace'); await p.waitForTimeout(800);
  eq((await calls(p, /^write_binary_file$/)).map(([, a]) => a.path), ['/Users/me/Report.pdf']);
  eq(await p.evaluate(() => window.__cowdreyPdf.doc.dirty), false);
  eq(p.errors, []); await p.ctx.close();
});
await test('Mac app: quitting with unsaved changes to a file asks first; menu Undo is the app\'s', async () => {
  const p = await open({ init: macApp({ files: [{ name: 'Report.pdf', path: '/Users/me/Report.pdf', content: fixture('sample.pdf') }] }) });
  await waitPages(p);
  const menu = await p.evaluate(() => window.__calls.filter(([c]) => c === 'set_menu').pop()[1].menus.find((m) => m.title === 'Edit').items.slice(0, 2).map((x) => x.id));
  eq(menu, ['cmd:undo', 'cmd:redo']);
  await p.evaluate(() => window.__cowdreyPdf.run('rotR')); await p.waitForTimeout(200);
  await p.evaluate(() => window.__events['menu-command']({ payload: 'undo' })); await p.waitForTimeout(200);
  eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages[0].rot), 0, 'menu Undo undid the rotation');
  await p.evaluate(() => window.__cowdreyPdf.run('rotR')); await p.waitForTimeout(200);
  p.evaluate(() => window.__events['flush-and-quit']());
  await p.waitForSelector('#dialog[open]');
  eq((await calls(p, /hold_quit/)).length, 1, 'the quit is held before anything else');
  p.evaluate(() => window.__events['flush-and-quit']()); await p.waitForTimeout(300); // a second Cmd+Q waits for the answer
  eq((await calls(p, /quit_app/)).length, 0, 'a second Cmd+Q does not quit past the question');
  await answer(p, 'Cancel'); await p.waitForTimeout(200);
  eq((await calls(p, /hold_quit|quit_app/)).map(([c, a]) => c + (a ? ':' + a.hold : '')), ['hold_quit:true', 'hold_quit:false']);
  p.evaluate(() => window.__events['flush-and-quit']());
  await answer(p, "Don't save"); await p.waitForTimeout(300);
  eq((await calls(p, /quit_app/)).length, 1, 'quits after Don\'t save');
  eq(p.errors, []); await p.ctx.close();
});
await test('dialogs wait their turn: a notice during a password question doesn\'t lose it, and opening carries on', async () => {
  const p = await open();
  const b64 = fixture('protected.pdf');
  const opening = p.evaluate(async (b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return window.__cowdreyPdf.openBytes(u, 'Secret.pdf'); }, b64);
  await p.waitForSelector('#dialog[open] #dlgInput');
  await p.evaluate(() => window.__cowdreyPdf.run('about')); await p.waitForTimeout(200);
  ok(await p.$('#dialog[open] #dlgInput'), 'the password question is still showing');
  await p.fill('#dlgInput', 'pelican'); await p.click('#dialog .btn.primary');
  eq(await opening, true);
  await p.waitForFunction(() => /About/.test(document.querySelector('#dialog[open] h2')?.textContent || ''));
  await answer(p, 'Close');
  await openPdf(p); eq(await p.textContent('#docTitle'), 'Quarterly report', 'later opens still work');
  eq(p.errors, []); await p.ctx.close();
});
await test('drop: if the first PDF doesn\'t open, the others are not added to the open document', async () => {
  const p = await open(); await openPdf(p);
  await p.evaluate(async (b) => {
    const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File(['not a pdf'], 'Broken.pdf', { type: 'application/pdf' })); dt.items.add(new File([u], 'Other.pdf', { type: 'application/pdf' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, fixture('sample.pdf'));
  await p.waitForTimeout(1500);
  eq(await p.evaluate(() => [window.__cowdreyPdf.doc.name, window.__cowdreyPdf.doc.pages.length]), ['Quarterly report', 3]);
  await p.ctx.close();
});
await test('phone apps: Print uses the system print dialog; Android "Open with" gets the real file name', async () => {
  const p = await open({ width: 412, height: 915, touch: true, ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', init: [(b) => {
    window.__calls = [];
    const pending = [{ name: '', path: 'content://com.android.providers.downloads.documents/document/msf%3A1000001234', content: '' }];
    window.__TAURI__ = { core: { invoke: async (c, a) => { window.__calls.push([c, a]); if (c === 'take_opened_files') return pending.splice(0); if (c === 'plugin:sharekit|native' && a.method === 'displayName') return { name: 'Lease agreement.pdf' }; return null; } },
      fs: { readFile: async () => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; } },
      dialog: {}, event: { listen: async () => {} }, opener: {} };
  }, fixture('sample.pdf')] });
  await waitPages(p); await p.waitForTimeout(400);
  eq(await p.textContent('#docTitle'), 'Lease agreement');
  await p.evaluate(() => window.__cowdreyPdf.run('print')); await p.waitForTimeout(400);
  eq((await calls(p, /sharekit\|native/)).map(([, a]) => a.method), ['displayName', 'printPage']);
  eq(p.errors, []); await p.ctx.close();
});
await test('sample PDF: Try a sample opens a two-page guide with a form and a pelican to find', async () => {
  const p = await open();
  await p.click('#drop [data-cmd="sample"]'); await waitPages(p); await p.waitForTimeout(600);
  eq(await p.textContent('#docTitle'), 'Welcome to Cowdrey.PDF'); eq(await p.textContent('#pageCount'), '2');
  ok(await p.$('.annotationLayer input[type="text"]'), 'form field');
  ok((await p.textContent('.page[data-n="0"] .textLayer')).includes('pelican'), 'text layer');
  eq(p.errors, []); await p.ctx.close();
});
// Editing what's already in a PDF (tests/fixtures/word.pdf: CID fonts as Word saves them, a tinted panel, a picture,
// a red line, and a sticky note and a square from "another app").
const WORD = path.join(root, 'tests/fixtures/word.pdf');
const savedOf = async (p) => Buffer.from(await p.evaluate(async () => Array.from(await window.__cowdreyPdf.buildPdf())));
async function reopen(p, bytes) {
  await p.evaluate(async (b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); await window.__cowdreyPdf.openBytes(u, 'Saved.pdf'); }, bytes.toString('base64'));
  await p.waitForFunction(() => document.querySelector('.page canvas.pdf') && document.querySelector('.textLayer span'), null, { timeout: 15000 }); await p.waitForTimeout(500);
}
const pageText = (p) => p.$$eval('.page[data-n="0"] .textLayer span', (s) => s.map((x) => x.textContent).join(' '));
// A point in PDF coordinates on page 1, on screen.
const at = (p, x, y) => p.evaluate(([x, y]) => { const v = window.__cowdreyPdf.views()[0]; const [vx, vy] = v.viewport.convertToViewportPoint(x, y); const r = v.el.getBoundingClientRect(); return [r.left + vx, r.top + vy]; }, [x, y]);

await test('Edit PDF: a line is rewritten in its own font and colour; the saved PDF has only the new text', async () => {
  const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
  await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
  const b = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'Budget' }).first().boundingBox();
  await p.mouse.click(b.x + 20, b.y + b.height / 2);
  await p.waitForSelector('.line-editor'); eq(await p.textContent('.line-editor'), 'Budget: 42,000 dollars, on track.');
  await p.keyboard.type('Budget: 45,500 dollars, on track.'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  const [m] = await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat());
  eq([m.type, m.text, /Carlito-Bold/.test(m.font), m.bg], ['te', 'Budget: 45,500 dollars, on track.', true, '#edf2fc'], 'edit');
  ok(parseInt(m.color.slice(1, 3), 16) < 60, 'dark text colour ' + m.color);
  const out = await savedOf(p);
  // The new line is set in the PDF's own Carlito Bold, not a substitute
  const d = await PDFDocument.load(out), fonts = d.getPage(0).node.Resources().lookup(require('../desktop/node_modules/pdf-lib').PDFName.of('Font'));
  ok(fonts.entries().every(([, r]) => /Carlito/.test(String(d.context.lookup(r).get(require('../desktop/node_modules/pdf-lib').PDFName.of('BaseFont'))))), 'no substitute font added');
  await reopen(p, out);
  const t = await pageText(p);
  ok(t.includes('Budget: 45,500 dollars, on track.') && !t.includes('42,000'), t);
  eq(p.errors.filter((e) => !/annotation-comment/.test(e)), []); await p.ctx.close();
});
await test('Edit PDF: Escape keeps the edit and Undo takes it back; typing the original back removes the edit; undo brings it back', async () => {
  const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
  await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
  const b = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'Prepared' }).first().boundingBox();
  await p.mouse.click(b.x + 10, b.y + b.height / 2); await p.waitForSelector('.line-editor');
  await p.keyboard.type('Kept by Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  eq(await marks(p), ['te'], 'Escape keeps the edit');
  ok(/undoes it/.test(await p.textContent('#toast')), 'says how to undo');
  await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
  eq(await marks(p), [], 'Undo cancels it');
  await p.mouse.click(b.x + 10, b.y + b.height / 2); await p.waitForSelector('.line-editor');
  await p.keyboard.type('Prepared by Alex on 4 March.'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  eq(await marks(p), ['te']);
  await p.mouse.click(b.x + 10, b.y + b.height / 2); await p.waitForSelector('.line-editor');
  eq(await p.textContent('.line-editor'), 'Prepared by Alex on 4 March.', 'reopens the edit');
  await p.keyboard.type('Prepared by the delivery team on 3 March.'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  eq(await marks(p), [], 'back to the original');
  await p.evaluate(() => window.__cowdreyPdf.run('undo')); await p.waitForTimeout(200);
  eq(await marks(p), ['te'], 'undo');
  await p.ctx.close();
});
await test('Edit PDF: a picture is moved, resized and deleted; the saved PDF draws it in its new place only', async () => {
  const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
  await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
  const [sx, sy] = await at(p, 460, 480), [tx, ty] = await at(p, 360, 460);
  await p.mouse.move(sx, sy); await p.mouse.down(); await p.mouse.move(tx, ty, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(600);
  let m = (await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat()))[0];
  eq([m.type, ...m.mat.map(Math.round)], ['ie', 120, 0, 0, 120, 300, 400], 'moved');
  // resize from the corner handle (bottom right), along the diagonal
  const [hx, hy] = await at(p, 420, 400), [h2x, h2y] = await at(p, 480, 340);
  await p.mouse.move(hx, hy); await p.mouse.down(); await p.mouse.move(h2x, h2y, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(400);
  m = (await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat()))[0];
  eq(m.mat.map(Math.round), [180, 0, 0, 180, 300, 340], 'resized, top-left kept');
  await reopen(p, await savedOf(p));
  const imgs = await p.evaluate(async () => (await window.__cowdreyPdf.contentMap(0)).images.map((i) => i.quad.flat().map(Math.round)));
  eq(imgs, [[300, 340, 480, 340, 480, 520, 300, 520]], 'one picture, in its new place');
  await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
  const [cx, cy] = await at(p, 390, 430); await p.mouse.click(cx, cy); await p.waitForTimeout(300);
  await p.keyboard.press('Delete'); await p.waitForTimeout(300);
  await reopen(p, await savedOf(p));
  eq(await p.evaluate(async () => (await window.__cowdreyPdf.contentMap(0)).images.length), 0, 'deleted');
  eq(p.errors.filter((e) => !/annotation-comment/.test(e)), []); await p.ctx.close();
});
await test('Edit PDF: a comment from another app is edited, another deleted; Erase area clears a line', async () => {
  const p = await open(); await openPdf(p, WORD, 'Pelican report.pdf');
  await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
  // the sticky note: double-click to change its text
  const [nx, ny] = await at(p, 570, 700);
  await p.mouse.dblclick(nx, ny); await p.waitForSelector('#dialog[open] #dlgInput');
  eq(await p.inputValue('#dlgInput'), 'Please check the budget figure.');
  await p.fill('#dlgInput', 'Budget confirmed.'); await p.click('#dialog .btn.primary'); await p.waitForTimeout(300);
  // the square drawn around a sentence: click its edge, then Delete
  const [ex, ey] = await at(p, 71, 583); await p.mouse.click(ex, ey); await p.waitForTimeout(200); await p.keyboard.press('Delete'); await p.waitForTimeout(500);
  // Erase area over the red line
  await p.evaluate(() => window.__cowdreyPdf.run('tool_erase'));
  const [a1, b1] = await at(p, 60, 408), [a2, b2] = await at(p, 560, 392);
  await p.mouse.move(a1, b1); await p.mouse.down(); await p.mouse.move(a2, b2, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(300);
  eq((await marks(p)).sort(), ['ae', 'ae', 'erase']);
  const out = await savedOf(p);
  const d = await PDFDocument.load(out), L = require('../desktop/node_modules/pdf-lib');
  const annots = d.getPage(0).node.Annots().asArray().map((r) => d.context.lookup(r));
  eq(annots.map((a) => String(a.get(L.PDFName.of('Subtype')))), ['/Text'], 'square deleted');
  eq(annots[0].lookup(L.PDFName.of('Contents')).decodeText(), 'Budget confirmed.');
  ok(!d.context.enumerateIndirectObjects().some(([, o]) => o instanceof L.PDFDict && String(o.get(L.PDFName.of('Subtype'))) === '/Square'), 'the deleted square is not left in the file');
  // the erased area is clipped out of the page
  const content = d.getPage(0).node.Contents(); ok(content, 'content');
  await reopen(p, out);
  const px = await p.evaluate(async () => { const v = window.__cowdreyPdf.views()[0]; const c = v.el.querySelector('canvas.pdf'); const [x, y] = v.viewport.convertToViewportPoint(300, 400); const k = c.width / v.viewport.width; return [...c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data].slice(0, 3); });
  ok(px.every((n) => n > 240), 'the red line is gone: ' + px);
  await p.ctx.close();
});
await test('Edit PDF: a PDF from Chrome keeps its subset fonts; letters they lack use the closest standard font', async () => {
  const p = await open(); await openPdf(p, path.join(root, 'tests/fixtures/chrome.pdf'), 'Summary.pdf');
  await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
  for (const [find, typed] of [['Revenue', 'Revenue grew by 12% in every region, quickly.'], ['Next review', 'Next review: 21 July.']]) {
    const b = await p.locator('.page[data-n="0"] .textLayer span', { hasText: find }).first().boundingBox();
    await p.mouse.click(b.x + 8, b.y + b.height / 2); await p.waitForSelector('.line-editor');
    await p.keyboard.type(typed); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  }
  const ms = await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat());
  eq(ms.map((m) => [/Carlito/.test(m.font), m.fam, m.bold]), [[true, 'sans', false], [true, 'sans', true]]);
  const g = parseInt(ms[1].color.slice(3, 5), 16), r = parseInt(ms[1].color.slice(1, 3), 16);
  ok(g > r + 40, 'the green line stays green: ' + ms[1].color);
  await reopen(p, await savedOf(p));
  const t = (await pageText(p)).replace(/\s+/g, '');
  ok(t.includes('Revenuegrewby12%ineveryregion,quickly.') && t.includes('Nextreview:21July.') && !t.includes('14June'), t);
  eq(p.errors, []); await p.ctx.close();
});
await test('Edit PDF: saving keeps the next word in another font, lines broken with \', and content stored as an array', async () => {
  const p = await open(); await openPdf(p, path.join(root, 'tests/fixtures/tricky.pdf'), 'Tricky.pdf');
  await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
  for (const [find, typed] of [['Hello', 'Howdy'], ['Line two', 'Line 2']]) {
    const b = await p.locator('.page[data-n="0"] .textLayer span', { hasText: find }).first().boundingBox();
    await p.mouse.click(b.x + 5, b.y + b.height / 2); await p.waitForSelector('.line-editor');
    await p.keyboard.type(typed); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  }
  await reopen(p, await savedOf(p));
  const items = await p.evaluate(async () => { const v = window.__cowdreyPdf.views()[0]; const tc = await v.page.getTextContent(); return tc.items.filter((i) => i.str.trim()).map((i) => [i.str, Math.round(i.transform[5])]); });
  const y = Object.fromEntries(items);
  eq([y.Howdy, y.world, y['Line one'], y['Line 2'], y['Line three']], [700, 700, 650, 636, 622], JSON.stringify(items));
  ok(!items.some(([t]) => /Hello|Line two/.test(t)), 'old text gone');
  eq(p.errors, []); await p.ctx.close();
});
await test('Edit PDF: the content reader never hangs on a malformed stream', async () => {
  const p = await open();
  const n = await p.evaluate(() => [window.__cowdreyPdf.tokenize('BT <414243'), window.__cowdreyPdf.tokenize('q > } { Q (open'), window.__cowdreyPdf.tokenize('BI /W 2 /H 2 ID abc')]);
  ok(n.every((x) => x > 0), JSON.stringify(n)); await p.ctx.close();
});
// Feature tests: tests/features/*.test.mjs, each exporting a function that receives these helpers.
{
  const dir = path.join(root, 'tests/features');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort() : [];
  const helpers = { test, eq, ok, open, openPdf, root, path, fs, require, PDFDocument, saved, savedOf, marks, reopen, pageText, at, fixture, macApp, calls, answer, waitPages, WORD, selectText };
  for (const f of files) { const mod = await import(path.join(dir, f)); await mod.default(helpers); }
}
await test('every library URL resolves to a file in the pinned packages', async () => { eq([...missing], []); });

await close();
for (const [pass, name, err] of results) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${err ? '\n      ' + err : ''}`);
const n = results.filter((r) => r[0]).length;
console.log(`\n${n}/${results.length} passed`);
process.exit(n === results.length ? 0 : 1);
