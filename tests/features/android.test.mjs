// The Android app's own code paths in the page (src/app.js, "the Android app"), with a pretend Android native side
// that records every call. The real thing runs on an emulator in CI: tests/android/run.mjs.
export default async (h) => {
  const { test, eq, ok, open, openPdf, root, path, fs } = h;
  const UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36';
  const SAMPLE = fs.readFileSync(path.join(root, 'tests/fixtures/sample.pdf')).toString('base64');
  // answers: { saveAs: [{ saved, uri, name } …] in order, writeTo: 'fail' | undefined, tts: bool, shared: [{ uri, name }] }
  const android = (answers = {}) => ({ width: 412, height: 915, touch: true, ua: UA, init: [([o, b]) => {
    window.__calls = []; window.__files = {}; window.__said = [];
    const saveAs = (o.saveAs || []).slice(), shared = (o.shared || []).slice(), opened = (o.opened || []).slice();
    window.__TAURI__ = {
      core: { invoke: async (c, a) => {
        window.__calls.push([c, a]);
        if (c === 'take_opened_files') return opened.splice(0);
        if (c === 'tsa_post') throw new Error('no answer (test)');
        if (c === 'write_share_file') { const p = '/data/user/0/app/cache/outgoing/' + a.name; window.__files[p] = (a.append ? window.__files[p] || '' : '') + atob(a.base64); return p; }
        if (c !== 'plugin:sharekit|native') return null;
        const m = a.method, x = a.args || {};
        if (m === 'saveAs') return saveAs.length ? saveAs.shift() : { saved: false };
        if (m === 'writeTo') { if (o.writeTo === 'fail') throw new Error('no permission'); return { saved: true, uri: x.uri, name: 'Kept.pdf' }; }
        if (m === 'saveToFolder') return { saved: true, folder: 'Download', names: x.files.map((f) => f.name) };
        if (m === 'takeSharedFiles') return { files: shared.splice(0) };
        if (m === 'displayName') return { name: 'Shared.pdf' };
        if (m === 'insets') return { top: 24, bottom: 48, left: 0, right: 0, keyboard: 0 };
        if (m === 'ttsAvailable') return { available: !!o.tts, engines: o.tts ? 1 : 0 };
        if (m === 'speak') { window.__said.push(x.text); await new Promise((r) => setTimeout(r, 30)); return { done: true }; }
        if (m === 'appInfo') return { installer: o.installer || '' };
        // a picture Android decodes (HEIC): a 300 x 200 JPEG, read back in parts
        const jpeg = async () => { const c = new OffscreenCanvas(300, 200), g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 300, 200); window.__jpeg = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg' })).arrayBuffer()); return window.__jpeg; };
        if (m === 'decodeImage') { await jpeg(); return { path: '/data/user/0/app/cache/outgoing/p (decoded).jpg', size: window.__jpeg.length, width: 300, height: 200, type: 'image/jpeg' }; }
        if (m === 'pickImages') { await jpeg(); return { files: [{ path: '/data/user/0/app/cache/outgoing/picked 1 0.jpg', size: window.__jpeg.length, name: 'Beach.heic', type: 'image/jpeg', width: 300, height: 200 }, { name: 'Broken.heic', error: 'unreadable' }] }; }
        if (m === 'readPart') { const b = window.__jpeg.subarray(x.at, x.at + Math.min(x.length, 100)); let t = ''; for (const c of b) t += String.fromCharCode(c); return { base64: btoa(t), size: window.__jpeg.length }; }
        return {};
      } },
      fs: { readFile: async () => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; } },
      dialog: {}, event: { listen: async () => {} }, opener: { openUrl: async () => {} },
    };
  }, [answers, SAMPLE]] });
  const native = (p, method) => p.evaluate((m) => window.__calls.filter(([c, a]) => c === 'plugin:sharekit|native' && (!m || a.method === m)).map(([, a]) => a), method);
  const state = (p) => p.evaluate(() => document.querySelector('#saveState').textContent.trim());
  const draw = async (p) => {
    await p.evaluate(() => window.__cowdreyPdf.run('tool_rect'));
    const g = await p.locator('.page[data-n="0"]').boundingBox();
    await p.mouse.move(g.x + 60, g.y + 200); await p.mouse.down(); await p.mouse.move(g.x + 160, g.y + 260, { steps: 3 }); await p.mouse.up();
    await p.evaluate(() => window.__cowdreyPdf.run('tool_select'));
  };

  await test('Android app: Save PDF opens the save dialog; "Saved" only when saved; then Save goes to the same file', async () => {
    const p = await open(android({ saveAs: [{ saved: false }, { saved: true, uri: 'content://docs/document/1', name: 'Quarterly report.pdf' }] }));
    await openPdf(p); await draw(p);
    // cancelled: nothing saved, still edited
    await p.evaluate(() => window.__cowdreyPdf.run('save')); await p.waitForTimeout(600);
    ok(/Edited/.test(await state(p)), await state(p));
    const first = (await native(p, 'saveAs'))[0];
    eq([first.args.name, first.args.mimeType, first.args.path], ['Quarterly report.pdf', 'application/pdf', '/data/user/0/app/cache/outgoing/Quarterly report.pdf']);
    ok(await p.evaluate((f) => window.__files[f].startsWith('%PDF-'), first.args.path), 'the PDF was written for the dialog');
    // saved
    await p.evaluate(() => window.__cowdreyPdf.run('save')); await p.waitForTimeout(600);
    ok(/Saved/.test(await state(p)), await state(p));
    ok(/Saved Quarterly report\.pdf/.test(await p.textContent('#toast')), await p.textContent('#toast'));
    // the next save goes to the same file, with no dialog
    await draw(p);
    ok(/Save to update the file/.test(await state(p)), await state(p));
    await p.evaluate(() => window.__cowdreyPdf.run('save')); await p.waitForTimeout(600);
    eq((await native(p, 'writeTo')).map((a) => a.args.uri), ['content://docs/document/1']);
    eq((await native(p, 'saveAs')).length, 2, 'no third dialog');
    ok(/Saved/.test(await state(p)), await state(p));
    eq(await p.textContent('#docTitle'), 'Kept', 'the name the file has now');
    // Share… is not saving
    await draw(p);
    await p.evaluate(() => window.__cowdreyPdf.run('share')); await p.waitForTimeout(600);
    ok(/Edited/.test(await state(p)), 'still edited after sharing');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Android app: when the saved file can no longer be written, Save asks where again', async () => {
    const p = await open(android({ writeTo: 'fail', saveAs: [{ saved: true, uri: 'content://docs/document/1', name: 'A.pdf' }, { saved: true, uri: 'content://docs/document/2', name: 'B.pdf' }] }));
    await openPdf(p); await draw(p);
    await p.evaluate(() => window.__cowdreyPdf.run('save')); await p.waitForTimeout(500);
    await draw(p);
    await p.evaluate(() => window.__cowdreyPdf.run('save')); await p.waitForTimeout(600);
    eq((await native(p, 'saveAs')).length, 2); eq(await p.textContent('#docTitle'), 'B');
    await p.ctx.close();
  });

  await test('Android app: exports use the save dialog; a large file goes over in parts; split saves every part into one folder', async () => {
    const p = await open(android({ saveAs: [{ saved: true, uri: 'content://x/1', name: 'Quarterly report.txt' }] }));
    await openPdf(p);
    await p.evaluate(() => window.__cowdreyPdf.run('exportText')); await p.waitForTimeout(600);
    const s = (await native(p, 'saveAs'))[0];
    eq([s.args.name, s.args.mimeType], ['Quarterly report.txt', 'text/plain']);
    ok(/Saved Quarterly report\.txt/.test(await p.textContent('#toast')), await p.textContent('#toast'));
    // 9 MB in three parts of at most 4 MB, put back together in order
    const parts = await p.evaluate(async () => {
      const big = new Uint8Array(9 << 20); for (let i = 0; i < big.length; i += 4096) big[i] = (i >> 12) & 255;
      window.__calls.length = 0;
      const path = await window.__cowdreyPdf.writeOutgoing(big, 'Big.pdf');
      const w = window.__calls.filter(([c]) => c === 'write_share_file').map(([, a]) => [a.append, a.base64.length]);
      const got = window.__files[path]; let same = got.length === big.length;
      for (let i = 0; same && i < big.length; i += 4096) same = got.charCodeAt(i) === big[i];
      return { w, same };
    });
    eq(parts.w.map(([a]) => a), [false, true, true]); ok(parts.same, 'the parts make the file');
    // Split into files: one folder for all the parts
    await p.evaluate(() => window.__cowdreyPdf.run('pg60_split')); await p.waitForSelector('#dialog[open]');
    await p.check('#dialog input[name="how"][value="each"]'); await p.click('#dialog .dlg-foot .btn.primary'); await p.waitForTimeout(1500);
    const f = await native(p, 'saveToFolder');
    eq(f.length, 1, 'one folder picker');
    eq(f[0].args.files.map((x) => [x.name, x.mimeType]), [1, 2, 3].map((k) => [`Quarterly report (part ${k}).pdf`, 'application/pdf']));
    ok(/Saved 3 files in Download/.test(await p.textContent('#toast')), await p.textContent('#toast'));
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Android app: Print sends the PDF itself to the print service; theme sets the system bars; insets reach the page', async () => {
    const p = await open(android());
    await openPdf(p);
    await p.evaluate(() => window.__cowdreyPdf.run('print')); await p.waitForTimeout(800);
    const pr = await native(p, 'printPdf');
    eq([pr.length, pr[0].args.name, pr[0].args.pages], [1, 'Quarterly report.pdf', 3]);
    ok(await p.evaluate((f) => window.__files[f].startsWith('%PDF-'), pr[0].args.path), 'a PDF to print');
    eq((await native(p, 'systemBars')).pop().args.dark, true, 'dark theme (the test browser is dark)');
    await p.evaluate(() => window.__cowdreyPdf.run('theme_light')); await p.waitForTimeout(100);
    eq((await native(p, 'systemBars')).pop().args.dark, false);
    // the navigation bar's height keeps the bottom bar clear of it
    ok(/48px/.test(await p.evaluate(() => document.documentElement.style.getPropertyValue('--sab'))), 'the inset');
    ok(parseFloat(await p.$eval('.statusbar', (e) => getComputedStyle(e).paddingBottom)) >= 48, 'the bottom bar');
    // the phone in dark mode while the web view says light: the page follows the phone
    await p.evaluate(() => window.__cowdreyPdf.run('theme_system')); await p.emulateMedia({ colorScheme: 'light' });
    await p.evaluate(() => window.__cowdreyNight(true));
    eq(await p.evaluate(() => document.documentElement.dataset.theme), 'dark');
    eq((await native(p, 'systemBars')).pop().args.dark, true);
    await p.evaluate(() => window.__cowdreyNight(false));
    eq(await p.evaluate(() => document.documentElement.dataset.theme || ''), '');
    await p.evaluate(() => window.__cowdreyInsets({ top: 24, bottom: 0, left: 0, right: 0, keyboard: 300 }));
    eq(await p.evaluate(() => document.documentElement.dataset.keyboard), 'up');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Android app: Open with a file it cannot read, or a web link, says so; PDFs shared several at once open', async () => {
    const p = await open(android({ opened: [{ name: 'Old.pdf', path: '/sdcard/Old.pdf', content: '', error: 'unreadable' }] }));
    await p.waitForFunction(() => /Could not open Old\.pdf/.test(document.querySelector('#toast').textContent), null, { timeout: 10000 });
    await p.ctx.close();
    const q = await open(android({ opened: [{ name: '', path: 'https://example.com/a.pdf', content: '', error: 'link' }] }));
    await q.waitForFunction(() => /Download the PDF first/.test(document.querySelector('#toast').textContent), null, { timeout: 10000 });
    await q.ctx.close();
    const r = await open(android({ shared: [{ uri: 'content://media/external/downloads/1', name: 'One.pdf' }, { uri: 'content://media/external/downloads/2', name: 'Two.pdf' }] }));
    await r.waitForFunction(() => document.querySelector('#docTitle').textContent === 'Two', null, { timeout: 15000 });
    await r.click('[data-side="docs"]').catch(() => {});
    const names = await r.evaluate(async () => (await window.__cowdreyPdf.listDocs()).map((d) => d.name).sort());
    eq(names, ['One', 'Two']);
    eq(r.errors.filter((e) => !/ERR_FAILED/.test(e)), []); await r.ctx.close();
  });

  await test('Android app: pickers for signing IDs, XFDF and actions show every file; PDF and picture pickers keep their filter', async () => {
    const p = await open(android());
    const acc = await p.evaluate(() => {
      const out = {};
      for (const a of ['.p12,.pfx,application/x-pkcs12', '.xfdf,.xml,application/vnd.adobe.xfdf', 'application/json,.json', 'application/pdf,.pdf', 'image/*', 'image/png,image/jpeg,.png,.jpg']) {
        const i = document.createElement('input'); i.type = 'file'; i.accept = a;
        i.addEventListener('click', (e) => e.preventDefault()); // no real picker in the test
        i.click(); out[a] = i.accept;
      }
      return out;
    });
    ok(acc['.p12,.pfx,application/x-pkcs12'].endsWith(',*/*') && acc['.xfdf,.xml,application/vnd.adobe.xfdf'].endsWith(',*/*') && acc['application/json,.json'].endsWith(',*/*'), JSON.stringify(acc));
    eq([acc['application/pdf,.pdf'], acc['image/*'], acc['image/png,image/jpeg,.png,.jpg']], ['application/pdf,.pdf', 'image/*', 'image/png,image/jpeg,.png,.jpg']);
    await p.ctx.close();
  });

  await test('Android app: Read aloud speaks with Android\'s text-to-speech; hidden when the phone has no speech engine', async () => {
    const p = await open(android({ tts: true }));
    await openPdf(p);
    await p.evaluate(() => window.__cowdreyPdf.run('crdReadAloud'));
    await p.waitForFunction(() => window.__said.length >= 2, null, { timeout: 10000 });
    const st = await p.evaluate(() => window.__cowdreyPdf.crdSayState());
    ok(st.on && st.k >= 1, 'reads on, one sentence after another: ' + JSON.stringify(st));
    eq(await p.evaluate(() => window.__said[0]), (await p.evaluate(() => window.__cowdreyPdf.crdSayState().sents[0])));
    await p.evaluate(() => window.__cowdreyPdf.run('crdReadAloud')); await p.waitForTimeout(200);
    ok((await native(p, 'stopSpeaking')).length >= 1, 'stopped');
    eq(p.errors, []); await p.ctx.close();
    const q = await open(android({ tts: false }));
    await openPdf(q);
    await q.waitForFunction(() => window.__calls.some(([c, a]) => a && a.method === 'ttsAvailable'), null, { timeout: 10000 }); await q.waitForTimeout(300);
    ok(await q.evaluate(() => window.__cowdreyPdf.cmdHidden('crdReadAloud')), 'hidden');
    await q.ctx.close();
  });

  await test('Android app: long-press and drag a page thumbnail moves the page', async () => {
    const p = await open(android());
    await openPdf(p);
    await p.evaluate(() => window.__cowdreyPdf.run('sidebar')); await p.waitForTimeout(300);
    await p.click('[data-side="thumbs"]').catch(() => {});
    await p.waitForSelector('.thumb[data-n="2"]');
    const a = await p.locator('.thumb[data-n="0"]').boundingBox(), b = await p.locator('.thumb[data-n="2"]').boundingBox();
    const cdp = await p.ctx.newCDPSession(p);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', a.x + a.width / 2, a.y + a.height / 2); await p.waitForTimeout(700);
    for (let k = 1; k <= 6; k++) await touch('touchMove', a.x + a.width / 2, a.y + a.height / 2 + (b.y + b.height * .7 - a.y - a.height / 2) * k / 6);
    await touch('touchEnd'); await p.waitForTimeout(500);
    eq(await p.evaluate(() => window.__cowdreyPdf.doc.pages.map((e) => e.i)), [1, 2, 0]);
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Android app: the keyboard coming up (a shorter window) keeps a note being typed and a line being edited', async () => {
    const p = await open(android());
    await openPdf(p);
    eq(await p.evaluate(() => document.querySelector('#zoomLabel').textContent.startsWith('Fit')), true, 'fit width');
    await p.evaluate(() => window.__cowdreyPdf.run('tool_note'));
    const g = await p.locator('.page[data-n="0"]').boundingBox();
    await p.mouse.click(g.x + 200, g.y + 120);
    await p.waitForSelector('.page-ask textarea');
    // the keyboard: Android makes the web view shorter
    await p.setViewportSize({ width: 412, height: 560 }); await p.waitForTimeout(600);
    ok(await p.$('.page-ask textarea'), 'the note is still open');
    await p.fill('.page-ask textarea', 'Typed with the keyboard up'); await p.click('.page-ask .btn.primary');
    eq(await p.evaluate(() => Object.values(window.__cowdreyPdf.doc.marks).flat().filter((m) => m.type === 'note').map((m) => m.text)), ['Typed with the keyboard up']);
    await p.setViewportSize({ width: 412, height: 915 }); await p.waitForTimeout(600);
    // a line in Edit PDF
    await p.evaluate(() => window.__cowdreyPdf.run('tool_edit'));
    const s = await p.locator('.page[data-n="0"] .textLayer span', { hasText: 'Cowdrey.PDF opens' }).first().boundingBox();
    await p.mouse.click(s.x + 10, s.y + s.height / 2);
    await p.waitForSelector('.line-editor');
    await p.setViewportSize({ width: 412, height: 560 }); await p.waitForTimeout(600);
    ok(await p.evaluate(() => !!document.activeElement.closest('.line-editor')), 'still editing the line');
    // with Fit width, a wider window still lays the pages out again
    await p.keyboard.press('Escape'); await p.evaluate(() => { window.__cowdreyPdf.run('tool_select'); window.__cowdreyPdf.run('zoomFit'); }); await p.waitForTimeout(800);
    const w0 = await p.$eval('.page[data-n="0"]', (e) => e.offsetWidth);
    await p.setViewportSize({ width: 560, height: 560 }); await p.waitForTimeout(800);
    ok(await p.$eval('.page[data-n="0"]', (e) => e.offsetWidth) > w0, 'wider pages');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Android app: a timestamp request goes through the app (tsa_post), not the web view, which most servers block', async () => {
    const p = await open(android()); await openPdf(p);
    const web = []; p.on('request', (r) => { if (/tsa\.example/.test(r.url())) web.push(r.url()); });
    const id = await p.evaluate(async () => (await window.__cowdreyPdf.sgCreateId({ name: 'Droid Signer', password: 'pw1234' })).id);
    await p.evaluate((i) => { window.__cowdreyPdf.sgSignNow({ id: i, password: 'pw1234', page: 0, rect: [300, 640, 520, 700], o: { tsa: 'https://tsa.example/ts' } }); }, id);
    await p.waitForSelector('#dialog[open]', { timeout: 30000 });
    const said = await p.textContent('#dialog');
    ok(/Could not sign/.test(said) && /could not be reached \(no answer \(test\)\)/.test(said), said);
    const calls = await p.evaluate(() => window.__calls.filter(([c]) => c === 'tsa_post').map(([, a]) => [a.url, atob(a.body).charCodeAt(0), atob(a.body).length]));
    eq(calls.length, 1, 'one tsa_post'); eq(calls[0].slice(0, 2), ['https://tsa.example/ts', 0x30]);
    ok(calls[0][2] > 50 && calls[0][2] < 200, 'a timestamp request, not the document: ' + calls[0][2] + ' bytes');
    eq(web, [], 'nothing posted from the web view');
    await p.ctx.close();
  });
  await test('Android app: Check for updates offers the APK from GitHub, but not when Google Play installed the app', async () => {
    const p = await open(android({ installer: 'com.android.vending' }));
    ok(await p.evaluate(() => !window.__cowdreyPdf.cmdHidden('checkUpdates')), 'offered');
    await p.evaluate(() => window.__cowdreyPdf.run('checkUpdates')); await p.waitForTimeout(300);
    ok(/Google Play keeps Cowdrey\.PDF up to date/.test(await p.textContent('#toast')), await p.textContent('#toast'));
    await p.ctx.close();
  });

  // Android's web view before Chrome 125 (the emulator has 124; phones that missed updates have older) has no CSS
  // round(), which pdf.js sizes its layers with: the page gives them their size with calc() instead. (Here the
  // browser has round(), so the test checks that the layers are sized with calc() when round() is said to be missing.)
  await test('Android app: a web view without CSS round() still puts form fields and words where they are on the page', async () => {
    const p = await open({ width: 412, height: 915, touch: true, init: () => {
      const supports = CSS.supports.bind(CSS);
      CSS.supports = (...x) => (/round\(/.test(x.join(' ')) ? false : supports(...x));
    } });
    await openPdf(p); await p.waitForSelector('.page[data-n="0"] .annotationLayer input[name="name"]');
    const r = await p.evaluate(() => {
      const box = (e) => { const b = e.getBoundingClientRect(); return [b.width, b.height]; };
      const pg = document.querySelector('.page[data-n="0"]'), al = pg.querySelector('.annotationLayer'), tl = pg.querySelector('.textLayer'), f = al.querySelector('input[name="name"]');
      const b = f.getBoundingClientRect(), hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { page: box(pg), layer: box(al), text: box(tl), field: box(f), hit: hit && hit.name, sized: [al.style.width, tl.style.width] };
    });
    ok(Math.abs(r.layer[0] - r.page[0]) < 2 && Math.abs(r.layer[1] - r.page[1]) < 2, 'the form layer covers the page: ' + JSON.stringify(r));
    ok(Math.abs(r.text[0] - r.page[0]) < 2, 'the text layer covers the page: ' + JSON.stringify(r));
    ok(r.field[0] > 60 && r.field[1] > 8, 'the field has its size: ' + JSON.stringify(r));
    eq(r.hit, 'name', 'a tap on the field reaches it');
    ok(r.sized.every((w) => /^calc\(/.test(w)), 'sized with calc(): ' + r.sized);
    eq(p.errors, []); await p.ctx.close();
  });

  // On a phone, the keyboard going down mid-tap made the web view drop the click (tests/android/run.mjs found Save PDF
  // doing nothing when tapped while typing): a button tapped while typing leaves the focus, and the keyboard, as they are.
  await test('Android app: Save PDF tapped while typing in a field saves at once, with the typed value; the field keeps the focus until the click, then the keyboard goes down', async () => {
    const p = await open(android({ saveAs: [{ saved: true, uri: 'content://docs/document/7', name: 'Quarterly report.pdf' }] }));
    await openPdf(p);
    // (the pages are laid out again for the phone's width just after opening: the field is tapped once they settle)
    await p.waitForTimeout(1500);
    await p.tap('.annotationLayer input[name="name"]');
    await p.waitForFunction(() => document.activeElement && document.activeElement.name === 'name');
    await p.keyboard.type('Typed then saved');
    await p.evaluate(() => { window.__focusAtClick = null; document.querySelector('#saveBtn').addEventListener('click', () => { window.__focusAtClick = document.activeElement && document.activeElement.name; }, { once: true }); });
    await p.tap('#saveBtn'); await p.waitForTimeout(800);
    eq(await p.evaluate(() => window.__focusAtClick), 'name', 'the field still has the focus when Save runs');
    eq(await p.evaluate(() => document.activeElement && document.activeElement.name), undefined, 'then the typing ends (the keyboard goes down)');
    eq((await native(p, 'saveAs')).length, 1, 'the save dialog');
    const path = (await native(p, 'saveAs'))[0].args.path;
    const bytes = await p.evaluate((f) => Array.from(window.__files[f], (c) => c.charCodeAt(0)), path);
    eq((await h.PDFDocument.load(new Uint8Array(bytes))).getForm().getTextField('name').getText(), 'Typed then saved');
    // a checkbox is not typing: the focus moves as usual
    await p.tap('.annotationLayer .checkBox input'); await p.tap('#saveBtn'); await p.waitForTimeout(600);
    eq(await p.evaluate(() => document.activeElement && document.activeElement.id), 'saveBtn');
    // Find's arrows are next to its field: typing goes on (the keyboard stays up)
    await p.evaluate(() => window.__cowdreyPdf.run('find')); await p.waitForSelector('#findInput:focus');
    await p.keyboard.type('pelican'); await p.tap('#findNext'); await p.waitForTimeout(400);
    eq(await p.evaluate(() => document.activeElement && document.activeElement.id), 'findInput', 'Find keeps the focus');
    eq(p.errors, []); await p.ctx.close();
  });

  // Android's web view can't read HEIC photos: Android decodes them, and the JPEG comes back in parts.
  await test('Android app: a HEIC photo the web view cannot read is decoded by Android and becomes a PDF page', async () => {
    const p = await open(android());
    const r = await p.evaluate(async () => {
      const heic = new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99, 1, 2, 3, 4])], 'Photo.heic', { type: 'image/heic' });
      const bytes = await window.__cowdreyPdf.crdPicturesPdf([heic], 'fit');
      return { pdf: bytes && bytes.length, parts: window.__calls.filter(([c, a]) => a && a.method === 'readPart').length, wrote: Object.keys(window.__files).filter((f) => /\.heic$/.test(f)).length };
    });
    ok(r.pdf > 0, 'a PDF was made'); ok(r.parts > 1, 'read back in parts: ' + r.parts); eq(r.wrote, 1, 'the photo was handed to Android');
    const d = await h.PDFDocument.load(new Uint8Array(await p.evaluate(async () => Array.from(await window.__cowdreyPdf.crdPicturesPdf([new File([new Uint8Array(16)], 'Photo.heic', { type: 'image/heic' })], 'fit')))));
    eq(d.getPageCount(), 1); eq([Math.round(d.getPage(0).getWidth()), Math.round(d.getPage(0).getHeight())], [225, 150], 'the decoded size (300 x 200 px at 96 dpi)');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('Android app: New PDF from pictures uses Android\'s photo picker, Android reads the photos; one it can\'t read is named', async () => {
    const p = await open(android());
    await p.evaluate(() => window.__cowdreyPdf.run('crdNewPictures'));
    await p.waitForSelector('#dialog[open] #crdPicSize');
    ok(/Could not read Broken\.heic/.test(await p.textContent('#toast')), await p.textContent('#toast'));
    eq((await native(p, 'pickImages')).length, 1, 'the photo picker, once');
    await p.click('#dialog .dlg-foot .btn.primary');
    await p.waitForFunction(() => window.__cowdreyPdf.doc && window.__cowdreyPdf.doc.pages.length === 1);
    eq(await p.textContent('#docTitle'), 'Beach');
    eq(await p.evaluate(() => document.querySelector('#crdPicInput').value), '', 'the web view\'s own picker was not used');
    eq(p.errors, []); await p.ctx.close();
  });

  // Android can close an app soon after it leaves the screen: a change still waiting to be kept is kept at once.
  await test('Android app: leaving the app keeps the last change on the device at once', async () => {
    const p = await open(android());
    await openPdf(p); await draw(p);
    await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(150); // well inside the usual wait before a change is kept
    const kept = await p.evaluate(async () => (await window.__cowdreyPdf.listDocs()).find((d) => d.id === window.__cowdreyPdf.doc.id));
    ok(kept && Object.values(kept.marks).flat().some((m) => m.type === 'rect'), 'the box is kept');
    eq(p.errors, []); await p.ctx.close();
  });
};
