// Create PDF (blank, from pictures, from the clipboard), Read aloud, Read mode, export every page as pictures.
export default async (h) => {
  const { test, eq, ok, open, openPdf, PDFDocument, answer, waitPages, savedOf, macApp, calls, fixture } = h;
  // Pictures drawn in the page with a canvas, as File objects, kept on window.__pics.
  const makePics = (p, sizes) => p.evaluate(async (sz) => {
    window.__pics = [];
    for (const [w, hh, type, name] of sz) {
      const c = document.createElement('canvas'); c.width = w; c.height = hh;
      const g = c.getContext('2d'); g.fillStyle = '#2448C9'; g.fillRect(0, 0, w, hh); g.fillStyle = '#FFD43B'; g.fillRect(w / 4, hh / 4, w / 2, hh / 2);
      const b = await new Promise((r) => c.toBlob(r, type, .9));
      window.__pics.push(new File([b], name, { type }));
    }
  }, sizes);
  const sizesOf = (d) => d.getPages().map((pg) => pg.getSize()).map(({ width, height }) => [Math.round(width), Math.round(height)]);

  await test('create: a blank PDF in the size, orientation and number of pages asked for, named Untitled', async () => {
    const p = await open();
    ok(await p.$('#drop [data-cmd="crdNewBlank"]'), 'offered on the empty screen');
    await p.click('#drop [data-cmd="crdNewBlank"]');
    await p.waitForSelector('#dialog[open] #crdSize');
    await p.selectOption('#crdSize', 'a4'); await p.click('label:has(input[name="crdOri"][value="l"])'); await p.fill('#dlgInput', '3');
    await answer(p, 'Create'); await waitPages(p); await p.waitForTimeout(300);
    eq(await p.textContent('#docTitle'), 'Untitled'); eq(await p.textContent('#pageCount'), '3');
    const d = await PDFDocument.load(await savedOf(p));
    eq(sizesOf(d), [[842, 595], [842, 595], [842, 595]]);
    // remembered for next time; Legal portrait from the File menu
    await p.click('#fileBtn'); await p.click('#popover [data-cmd="crdNewBlank"]');
    await p.waitForSelector('#dialog[open] #crdSize');
    eq(await p.inputValue('#crdSize'), 'a4');
    await p.selectOption('#crdSize', 'legal'); await p.click('label:has(input[name="crdOri"][value="p"])');
    await answer(p, 'Create'); await p.waitForFunction(() => document.querySelector('#pageCount').textContent === '1');
    eq(sizesOf(await PDFDocument.load(await savedOf(p))), [[612, 1008]]);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('create: from pictures, one per page in the order picked, fitted or on Letter with margins; added to an open PDF', async () => {
    const p = await open();
    await makePics(p, [[400, 300, 'image/png', 'wide.png'], [200, 400, 'image/jpeg', 'tall.jpg'], [300, 300, 'image/webp', 'square.webp']]);
    let going = p.evaluate(() => window.__cowdreyPdf.crdPicturesChosen(window.__pics));
    await p.waitForSelector('#dialog[open] #crdPicSize'); ok(!(await p.$('#crdPicWhere')), 'no "put them in" without a PDF');
    await p.selectOption('#crdPicSize', 'fit'); await answer(p, 'Create'); await going;
    await waitPages(p); await p.waitForTimeout(300);
    eq(await p.textContent('#docTitle'), 'Untitled');
    let d = await PDFDocument.load(await savedOf(p));
    eq(sizesOf(d), [[300, 225], [150, 300], [225, 225]], 'fit each picture at 96 dpi');
    // a colour from the middle of the first page is the picture's yellow
    const px = await p.evaluate(() => { const c = document.querySelector('.page[data-n="0"] canvas.pdf'); return [...c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data].slice(0, 3); });
    ok(px[0] > 200 && px[1] > 170 && px[2] < 120, 'picture drawn: ' + px);
    // Letter with margins, added after page 1 of the open PDF
    going = p.evaluate(() => window.__cowdreyPdf.crdPicturesChosen(window.__pics.slice(0, 2)));
    await p.waitForSelector('#dialog[open] #crdPicWhere');
    await p.selectOption('#crdPicSize', 'letter'); await p.selectOption('#crdPicWhere', 'add'); await answer(p, 'Create'); await going;
    await p.waitForFunction(() => document.querySelector('#pageCount').textContent === '5');
    d = await PDFDocument.load(await savedOf(p));
    eq(sizesOf(d), [[300, 225], [792, 612], [612, 792], [150, 300], [225, 225]], 'landscape Letter for the wide picture');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('create: dropping pictures (no PDF) makes a PDF from them', async () => {
    const p = await open();
    await makePics(p, [[160, 120, 'image/png', 'Holiday.png']]);
    await p.evaluate(() => { const dt = new DataTransfer(); window.__pics.forEach((f) => dt.items.add(f)); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
    await answer(p, 'Create'); await waitPages(p); await p.waitForTimeout(300);
    eq(await p.textContent('#docTitle'), 'Holiday'); eq(await p.textContent('#pageCount'), '1');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('create: pasting a picture makes a one-page PDF, or with a PDF open adds a page or places it', async () => {
    const p = await open();
    await makePics(p, [[400, 200, 'image/png', 'image.png']]);
    const paste = () => p.evaluate(() => { const dt = new DataTransfer(); dt.items.add(window.__pics[0]); document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    await paste(); await waitPages(p); await p.waitForTimeout(300);
    eq(await p.textContent('#docTitle'), 'Pasted picture');
    eq(sizesOf(await PDFDocument.load(await savedOf(p))), [[300, 150]]);
    await openPdf(p);
    await paste(); await answer(p, 'New page');
    await p.waitForFunction(() => document.querySelector('#pageCount').textContent === '4');
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.map((e) => e.src)), [0, 1, 0, 0], 'after page 1');
    await paste(); await answer(p, 'Place on page');
    await p.waitForFunction(() => document.querySelector('#app').dataset.tool === 'image');
    const g = await p.locator('.page[data-n="0"]').boundingBox(); await p.mouse.click(g.x + 200, g.y + 200);
    eq(await h.marks(p), ['img']);
    // From clipboard: waits for a paste in its box
    await p.evaluate(() => window.__cowdreyPdf.run('crdClip'));
    await p.waitForSelector('#dialog[open] #crdPasteZone');
    await p.evaluate(() => { const dt = new DataTransfer(); dt.items.add(window.__pics[0]); document.querySelector('#crdPasteZone').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    await answer(p, 'New PDF'); await p.waitForFunction(() => document.querySelector('#docTitle').textContent === 'Pasted picture');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('read aloud: speaks the page\'s sentences with the chosen speed, highlights them, moves on to the next page', async () => {
    const p = await open({ init: () => {
      window.__said = [];
      window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u) { window.__said.push([u.text, u.rate, u.voice && u.voice.name]); if (!window.__hold) setTimeout(() => u.onend && u.onend({}), 5); else window.__last = u; },
        cancel() {}, pause() {}, resume() {}, getVoices: () => [{ name: 'Pelican', voiceURI: 'pelican', lang: 'en-GB', default: false }, { name: 'Gull', voiceURI: 'gull', lang: 'en-US', default: true }], addEventListener() {} } });
    } });
    await openPdf(p);
    await p.evaluate(() => { window.__hold = true; window.__cowdreyPdf.run('crdReadAloud'); });
    await p.waitForSelector('#crdSayBar:not([hidden])');
    await p.waitForFunction(() => window.__said.length === 1);
    ok(await p.$('.page[data-n="0"] .crd-say'), 'sentence highlighted');
    const page1 = await p.evaluate(async () => (await window.__cowdreyPdf.views()[0].page.getTextContent()).items.map((i) => i.str).join(' '));
    const first = await p.evaluate(() => window.__said[0][0]);
    ok(first.length > 3 && page1.replace(/\s+/g, ' ').includes(first.split(' ').slice(0, 3).join(' ')), `reads page 1: "${first}"`);
    // speed and voice, remembered
    await p.selectOption('#crdSayRate', '1.5'); await p.selectOption('#crdSayVoice', 'pelican');
    eq(await p.evaluate(() => window.__said.at(-1).slice(1)), [1.5, 'Pelican']);
    eq(await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('cowdrey.pdf:settings')); return [s.crdRate, s.crdVoice]; }), [1.5, 'pelican']);
    // pause and play
    await p.click('#crdSayBar [data-crd="play"]'); eq((await p.evaluate(() => window.__cowdreyPdf.crdSayState())).paused, true);
    const n = await p.evaluate(() => window.__said.length);
    await p.click('#crdSayBar [data-crd="play"]'); eq(await p.evaluate(() => window.__said.length), n + 1, 'says the sentence again');
    // let it run: it goes on to page 2 and reads it
    await p.evaluate(() => { window.__hold = false; window.__last.onend({}); });
    await p.waitForFunction(() => window.__cowdreyPdf.crdSayState().n >= 1, null, { timeout: 10000 });
    eq(await p.evaluate(() => window.__cowdreyPdf.current >= 1), true, 'scrolled to the next page');
    await p.waitForFunction(() => !window.__cowdreyPdf.crdSayState().on, null, { timeout: 15000 });
    const all = await p.evaluate(() => window.__said.map((s) => s[0]).join(' '));
    const last = await p.evaluate(async () => (await window.__cowdreyPdf.views()[2].page.getTextContent()).items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim().split(' ').slice(-2).join(' '));
    ok(all.includes(last), `read to the end ("${last}")`);
    ok(await p.$eval('#crdSayBar', (b) => b.hidden), 'bar closes when finished'); eq(await p.$$eval('.crd-say', (e) => e.length), 0);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('read aloud: hidden where the device has no speech', async () => {
    const p = await open({ init: () => { delete window.speechSynthesis; delete Window.prototype.speechSynthesis; window.SpeechSynthesisUtterance = undefined; } });
    await openPdf(p);
    ok(!(await p.$('#ribbonBody [data-cmd="crdReadAloud"]')), 'not on the Home tab');
    ok(await p.$('#ribbonBody [data-cmd="crdReadMode"]'), 'Read mode still is');
    await p.ctx.close();
  });

  await test('read mode: hides the ribbon, menus and sidebar; arrows turn pages; Esc and the exit button leave', async () => {
    const p = await open(); await openPdf(p);
    const width = () => p.$eval('.page', (e) => Math.round(e.getBoundingClientRect().width));
    const before = await width();
    await p.keyboard.press('F11'); await p.waitForTimeout(400);
    ok(await p.$eval('.page', (e) => e.getBoundingClientRect().height <= innerHeight), 'the whole page shows');
    ok(await p.$eval('#app', (a) => a.classList.contains('crd-reading')), 'on');
    for (const s of ['.titlebar', '.ribbon', '#sidebar', '.statusbar']) eq(await p.$eval(s, (e) => getComputedStyle(e).display), 'none', s);
    ok(await p.$eval('#crdReadBar', (b) => !b.hidden), 'exit bar');
    await p.keyboard.press('ArrowDown'); await p.waitForTimeout(400); eq(await p.evaluate(() => window.__cowdreyPdf.current), 1);
    eq(await p.textContent('#crdReadWhere'), '2 / 3');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok(!(await p.$eval('#app', (a) => a.classList.contains('crd-reading'))), 'Esc leaves');
    ok(await p.$eval('.ribbon', (e) => getComputedStyle(e).display !== 'none'), 'ribbon back');
    await p.keyboard.press('Control+Shift+R'); await p.waitForTimeout(200);
    ok(await p.$eval('#app', (a) => a.classList.contains('crd-reading')), 'Mod-Shift-R');
    await p.click('#crdReadBar [data-crd="exit"]'); await p.waitForTimeout(400);
    ok(!(await p.$eval('#app', (a) => a.classList.contains('crd-reading'))), 'exit button');
    eq(await width(), before, 'zoom back as it was');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('export: every page as PNGs in one STORE .zip; the entries are valid PNGs of the right size', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="export"]');
    const [dl] = await Promise.all([p.waitForEvent('download'), (async () => {
      await p.click('#ribbonBody [data-cmd="crdExportPages"]');
      await p.waitForSelector('#dialog[open] #crdFmt'); await p.selectOption('#crdDpi', '72'); await p.fill('#dlgInput', '1-3');
      await answer(p, 'Export');
    })()]);
    eq(dl.suggestedFilename(), 'Quarterly report pages.zip');
    const zip = h.fs.readFileSync(await dl.path());
    // read the zip: end record, central directory, local headers, CRC-32
    const zlib = await import('node:zlib');
    const e = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const count = zip.readUInt16LE(e + 10); let cd = zip.readUInt32LE(e + 16);
    const entries = [];
    for (let k = 0; k < count; k++) {
      eq(zip.readUInt32LE(cd), 0x02014b50, 'central header');
      const method = zip.readUInt16LE(cd + 10), crc = zip.readUInt32LE(cd + 16), size = zip.readUInt32LE(cd + 24), nl = zip.readUInt16LE(cd + 28), xl = zip.readUInt16LE(cd + 30), cl = zip.readUInt16LE(cd + 32), off = zip.readUInt32LE(cd + 42);
      const name = zip.toString('utf8', cd + 46, cd + 46 + nl);
      eq(zip.readUInt32LE(off), 0x04034b50, 'local header');
      const data = zip.subarray(off + 30 + zip.readUInt16LE(off + 26) + zip.readUInt16LE(off + 28), off + 30 + zip.readUInt16LE(off + 26) + zip.readUInt16LE(off + 28) + size);
      eq(method, 0, 'stored'); eq(zlib.crc32(data) >>> 0, crc, 'crc of ' + name);
      entries.push([name, data]); cd += 46 + nl + xl + cl;
    }
    eq(entries.map(([n]) => n), ['Quarterly report page 1.png', 'Quarterly report page 2.png', 'Quarterly report page 3.png']);
    for (const [n, d] of entries) {
      eq([...d.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], n + ' is a PNG');
      eq([d.readUInt32BE(16), d.readUInt32BE(20)], [612, 792], n + ' at 72 dpi');
    }
    eq(p.errors, []); await p.ctx.close();
  });

  await test('export: one page as JPEG at 150 dpi saves a single picture; the Mac app saves through the Mac', async () => {
    const p = await open({ init: macApp({ files: [{ name: 'Report.pdf', path: '/Users/me/Report.pdf', content: fixture('sample.pdf') }] }) });
    await waitPages(p);
    eq(await p.evaluate(() => window.__cowdreyPdf.crdExportRun({ format: 'jpeg', dpi: 150, range: '2' })), 'Report page 2.jpg');
    await p.evaluate(() => window.__cowdreyPdf.crdExportRun({ format: 'png', dpi: 72, range: '1-2' }));
    const w = await calls(p, /^write_binary_file$/);
    eq(w.map(([, a]) => a.path), ['/Users/me/Desktop/Report page 2.jpg', '/Users/me/Desktop/Report pages.zip']);
    const jpg = Buffer.from(w[0][1].base64, 'base64'); eq([jpg[0], jpg[1]], [0xFF, 0xD8], 'JPEG');
    const menus = await p.evaluate(() => window.__calls.filter(([c]) => c === 'set_menu').pop()[1].menus);
    const file = menus.find((m) => m.title === 'File').items.map((x) => x.id);
    eq(file.slice(0, 3), ['cmd:crdNewBlank', 'cmd:crdNewPictures', 'cmd:crdNewClip'], 'File menu starts with New');
    ok(menus.find((m) => m.title === 'View').items.some((x) => x.id === 'cmd:crdReadMode'), 'View has Read mode');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('create and read: phone width, nothing scrolls sideways; the read-aloud bar fits', async () => {
    const p = await open({ width: 390, height: 844, touch: true, init: () => {
      window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak() {}, cancel() {}, pause() {}, resume() {}, getVoices: () => [{ name: 'A very long voice name indeed', voiceURI: 'x', lang: 'en-AU' }], addEventListener() {} } });
    } });
    eq(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'empty screen');
    await openPdf(p);
    await p.evaluate(() => window.__cowdreyPdf.run('crdReadAloud')); await p.waitForSelector('#crdSayBar:not([hidden])');
    const r = await p.$eval('#crdSayBar', (b) => { const x = b.getBoundingClientRect(); return [x.left, x.right]; });
    ok(r[0] >= 0 && r[1] <= 390, 'bar on screen ' + r);
    eq(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    eq(p.errors, []); await p.ctx.close();
  });
};
