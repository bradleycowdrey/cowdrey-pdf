// Actions (File > Actions…): the same steps on many PDFs. Bates numbers carry on across files, a failed file doesn't
// stop the run, Cancel stops after the current file, actions export and import as .json, and the open document is
// left as it was.
export default async (h) => {
  const { test, eq, ok, open, openPdf, root, path, fs, require, answer } = h;
  const C = require(path.join(root, 'desktop/node_modules/@cantoo/pdf-lib'));
  const pdfjs = await import(path.join(root, 'desktop/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
  const FONTS = path.join(root, 'desktop/node_modules/pdfjs-dist/standard_fonts/');
  async function make(pages, label) {
    const d = await C.PDFDocument.create(), f = await d.embedFont(C.StandardFonts.Helvetica);
    for (let k = 0; k < pages; k++) { const p = d.addPage([612, 792]); p.drawText(`${label} page ${k + 1}`, { x: 72, y: 700, size: 18, font: f }); }
    d.setTitle(label + ' original');
    return Buffer.from(await d.save());
  }
  const files = async () => [
    { name: 'Alpha.pdf', b64: (await make(2, 'Alpha')).toString('base64') },
    { name: 'Bravo.pdf', b64: (await make(3, 'Bravo')).toString('base64') },
    { name: 'Charlie.pdf', b64: (await make(1, 'Charlie')).toString('base64') },
  ];
  // .zip files stored without compression (as the app writes them)
  function unzip(buf) {
    const out = []; let k = 0;
    while (k + 30 <= buf.length && buf.readUInt32LE(k) === 0x04034b50) {
      eq(buf.readUInt16LE(k + 8), 0, 'stored');
      const size = buf.readUInt32LE(k + 18), nl = buf.readUInt16LE(k + 26), xl = buf.readUInt16LE(k + 28);
      const name = buf.slice(k + 30, k + 30 + nl).toString('utf8'), at = k + 30 + nl + xl;
      out.push({ name, data: buf.slice(at, at + size) }); k = at + size;
    }
    return out;
  }
  const textOf = async (bytes) => {
    const t = pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: FONTS }); const d = await t.promise; const pages = [];
    for (let i = 1; i <= d.numPages; i++) pages.push((await (await d.getPage(i)).getTextContent()).items.map((x) => x.str).join(' '));
    await t.destroy(); return pages;
  };
  const batesOf = async (bytes) => (await textOf(bytes)).map((s) => (s.match(/ABC\d{6}/) || [''])[0]);
  const ACTION = { name: 'Review', steps: [{ id: 'rotate', opts: { range: '1', angle: 90 } }, { id: 'bates', opts: { prefix: 'ABC', start: 1, digits: 6, suffix: '', slot: 'br', size: 10, range: '' } }, { id: 'docinfo', opts: { title: '<<file>> (reviewed)', author: '', subject: '', keywords: '' } }] };
  const state = (p) => p.evaluate(() => { const H = window.__cowdreyPdf, d = H.doc; return d && { id: d.id, name: d.name, pages: JSON.stringify(d.pages), marks: JSON.stringify(d.marks), dirty: !!d.dirty, title: document.querySelector('#docTitle').textContent, views: H.views().length, sources: d.sources.length }; });

  await test('actions: rotate page 1, Bates ABC from 1 (6 digits), Title “<<file>> (reviewed)” on 3 PDFs: one zip, numbers carry on, log lists them; the open PDF is untouched', async () => {
    const p = await open(); await openPdf(p);
    await p.evaluate(() => window.__cowdreyPdf.run('rotR')); await p.waitForTimeout(300); // a change of its own, with undo
    const before = await state(p), undoBefore = await p.evaluate(() => window.__cowdreyPdf.cmdLabel && window.__cowdreyPdf.cmdEnabled('undo'));
    const r = await p.evaluate(([a, l]) => window.__cowdreyPdf.batchRun(a, l), [ACTION, await files()]);
    eq(r.results.map((x) => x.status), ['done', 'done', 'done']);
    const z = unzip(Buffer.from(r.zip, 'base64'));
    eq(z.map((f) => f.name), ['Alpha.pdf', 'Bravo.pdf', 'Charlie.pdf'], 'three PDFs, in order');
    const want = [['ABC000001', 'ABC000002'], ['ABC000003', 'ABC000004', 'ABC000005'], ['ABC000006']];
    for (let k = 0; k < 3; k++) {
      const d = await C.PDFDocument.load(z[k].data);
      eq(d.getPage(0).getRotation().angle, 90, z[k].name + ' page 1 turned');
      if (d.getPageCount() > 1) eq(d.getPage(1).getRotation().angle, 0, 'page 2 not turned');
      eq(d.getTitle(), z[k].name.replace('.pdf', '') + ' (reviewed)', 'title');
      eq(await batesOf(z[k].data), want[k], z[k].name + ' Bates');
      ok((await textOf(z[k].data))[0].includes(z[k].name.replace('.pdf', '') + ' page 1'), 'its own text kept');
    }
    eq(r.results.map((x) => x.bates && [x.bates.first, x.bates.last]), [['ABC000001', 'ABC000002'], ['ABC000003', 'ABC000005'], ['ABC000006', 'ABC000006']]);
    const csv = r.csv.trim().split(/\r\n/);
    eq(csv[0], '"File","Saved as","Status","Pages","First Bates","Last Bates","Note"');
    ok(csv[1].startsWith('"Alpha.pdf","Alpha.pdf","done","2","ABC000001","ABC000002"'), csv[1]);
    ok(csv[2].startsWith('"Bravo.pdf","Bravo.pdf","done","3","ABC000003","ABC000005"'), csv[2]);
    ok(csv[3].startsWith('"Charlie.pdf","Charlie.pdf","done","1","ABC000006","ABC000006"'), csv[3]);
    // the open document: as it was, shown again, its undo kept, nothing new in Recent
    const after = await state(p);
    eq(after, before, 'open document unchanged');
    eq(await p.evaluate(() => window.__cowdreyPdf.cmdEnabled('undo')), undoBefore, 'undo kept');
    await p.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 10000 });
    ok(await p.evaluate(() => !document.querySelector('.app[data-batch]')), 'pages shown again');
    const saved = await p.evaluate(async () => (await window.__cowdreyPdf.buildPdf()).length);
    ok(saved > 1000, 'it still saves');
    await p.click('[data-side="docs"]'); await p.waitForSelector('.doc-item');
    eq(await p.$$eval('.doc-item', (e) => e.length), 1, 'no working documents in Recent');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('actions: a corrupt file is reported as failed and the others still finish (it uses no Bates numbers)', async () => {
    const p = await open();
    const l = await files(); l.splice(1, 0, { name: 'Broken.pdf', b64: Buffer.from('%PDF-1.7\nthis is not really a pdf').toString('base64') });
    const r = await p.evaluate(([a, x]) => window.__cowdreyPdf.batchRun(a, x), [ACTION, l]);
    eq(r.results.map((x) => x.status), ['done', 'failed', 'done', 'done']);
    ok(r.results[1].error, 'with a reason');
    const z = unzip(Buffer.from(r.zip, 'base64'));
    eq(z.map((f) => f.name), ['Alpha.pdf', 'Bravo.pdf', 'Charlie.pdf']);
    eq(await batesOf(z[1].data), ['ABC000003', 'ABC000004', 'ABC000005'], 'numbers carry on past the failed file');
    ok(r.csv.includes('"Broken.pdf","","failed"'), r.csv);
    ok(await p.evaluate(() => !window.__cowdreyPdf.doc), 'no document was open, and none is now');
    eq(await p.evaluate(() => getComputedStyle(document.querySelector('#drop')).display !== 'none' && !document.querySelector('#drop').hidden), true, 'the start screen is back');
    eq(p.errors.filter((e) => !/not really|Invalid PDF|PDF header/i.test(e)), []); await p.ctx.close();
  });

  await test('actions: Cancel stops after the current file', async () => {
    const p = await open();
    const r = await p.evaluate(([a, l]) => window.__cowdreyPdf.batchRun(a, l, { cancelAt: 1 }), [ACTION, await files()]);
    eq(r.results.map((x) => x.status), ['done', 'done', 'cancelled'], 'the second file finishes, the third is not run');
    ok(r.cancelled);
    eq(unzip(Buffer.from(r.zip, 'base64')).map((f) => f.name), ['Alpha.pdf', 'Bravo.pdf']);
    ok(r.csv.includes('"Charlie.pdf","","cancelled"'), r.csv);
    await p.ctx.close();
  });

  await test('actions: an action exported as .json imports back the same; unknown files are refused', async () => {
    const p = await open();
    const back = await p.evaluate((a) => { const H = window.__cowdreyPdf; return H.batchImportJson(H.batchExportJson(a)); }, ACTION);
    eq(back, { name: ACTION.name, steps: ACTION.steps });
    const bad = await p.evaluate(() => { try { window.__cowdreyPdf.batchImportJson('{"hello":1}'); return 'accepted'; } catch (e) { return e.message; } });
    eq(bad, 'This is not an action file');
    // through the dialog: Import… adds it to the list, Export gives the same file back
    const f = path.join(root, 'tests/fixtures', '.batch-action.json');
    fs.writeFileSync(f, await p.evaluate((a) => window.__cowdreyPdf.batchExportJson(a), ACTION));
    await p.evaluate(() => window.__cowdreyPdf.run('batch')); await p.waitForSelector('#dialog[open] .batch-acts');
    // file-picker interception is turned on asynchronously: give it a moment before the click (as in media.test.mjs)
    const choosing = p.waitForEvent('filechooser'); await p.waitForTimeout(500); await answer(p, 'Import…'); const chooser = await choosing;
    await chooser.setFiles(f); fs.unlinkSync(f);
    await p.waitForFunction(() => [...document.querySelectorAll('#dialog .batch-act strong')].some((s) => s.textContent === 'Review'), null, { timeout: 5000 });
    eq((await p.evaluate(() => window.__cowdreyPdf.batchSaved())).map((a) => [a.name, a.steps]), [['Review', ACTION.steps]], 'kept in settings');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dialog .batch-act:has(strong:text-is("Review")) [data-do="export"]')]);
    eq(dl.suggestedFilename(), 'Review.json');
    const again = await p.evaluate((t) => window.__cowdreyPdf.batchImportJson(t), fs.readFileSync(await dl.path(), 'utf8'));
    eq(again, { name: ACTION.name, steps: ACTION.steps }, 'round trip');
    await p.ctx.close();
  });

  await test('actions: the dialogs — presets, a new action with steps in order, Run on files… with a progress list, a zip and the Bates log; the open PDF stays', async () => {
    const p = await open(); await openPdf(p);
    const before = await state(p);
    await p.click('[data-rt="export"]');
    ok(await p.$('#ribbonBody .r-group[aria-label="Batch"] [data-cmd="batch"]'), 'on the Export tab');
    ok((await p.evaluate(() => window.__cowdreyPdf.menus().find(([t]) => t === 'File')[1])).includes('batch'), 'in the File menu');
    await p.click('#ribbonBody [data-cmd="batch"]'); await p.waitForSelector('#dialog[open] .batch-acts');
    const names = await p.$$eval('#dialog .batch-act strong', (s) => s.map((x) => x.textContent));
    for (const n of ['Bates number a set of PDFs', 'Make smaller']) ok(names.includes(n), n);
    // built-in actions are listed only when this version has their steps
    const avail = await p.evaluate(() => window.__cowdreyPdf.batchSteps());
    eq(names.includes('Prepare for archive (PDF/A)'), avail.includes('pdfa'), 'PDF/A only with its step');
    eq(names.includes('Make searchable (OCR)'), avail.includes('ocr'), 'OCR only with its step');
    await answer(p, 'New action'); await p.waitForSelector('#dialog[open] #batchSteps');
    await p.fill('#batchName', 'Stamp and turn');
    await p.selectOption('#batchAddSel', 'bates'); await p.click('#batchAddBtn');
    await p.selectOption('#batchAddSel', 'rotate'); await p.click('#batchAddBtn');
    await p.selectOption('#batchAddSel', 'docinfo'); await p.click('#batchAddBtn');
    // move Rotate first, set the options, remove Properties
    await p.click('#batchSteps .batch-step:nth-child(2) [data-mv="-1"]');
    eq(await p.$$eval('#batchSteps .batch-step strong', (s) => s.map((x) => x.textContent)), ['Rotate pages', 'Bates numbering', 'Set document properties']);
    await p.fill('#batchSteps .batch-step:nth-child(1) [data-bk="range"]', '1');
    await p.selectOption('#batchSteps .batch-step:nth-child(1) [data-bk="angle"]', '180');
    await p.fill('#batchSteps .batch-step:nth-child(2) [data-bk="prefix"]', 'ABC');
    await p.fill('#batchSteps .batch-step:nth-child(2) [data-bk="start"]', '1');
    await p.click('#batchSteps .batch-step:nth-child(3) [data-rm]');
    await answer(p, 'Save'); await p.waitForSelector('#dialog[open] .batch-acts');
    const kept = (await p.evaluate(() => window.__cowdreyPdf.batchSaved())).find((a) => a.name === 'Stamp and turn');
    eq(kept.steps.map((s) => s.id), ['rotate', 'bates']);
    eq([kept.steps[0].opts.range, kept.steps[0].opts.angle, kept.steps[1].opts.start, kept.steps[1].opts.digits], ['1', 180, 1, 6], 'options kept, numbers as numbers');
    // Run on files…: the web picker (an <input multiple> here), output in one zip
    await p.evaluate(() => { window.showOpenFilePicker = undefined; });
    await p.click('#dialog .batch-act:has(strong:text-is("Stamp and turn")) [data-do="run"]'); await p.waitForSelector('#dialog[open] #batchFileList');
    eq(await p.$eval('#dialog .dlg-foot .btn.primary', (b) => b.disabled), true, 'nothing to run yet');
    const dir = path.join(root, 'tests/fixtures'), fl = await files(), paths = fl.map((x) => { const f = path.join(dir, '.batch-' + x.name); fs.writeFileSync(f, Buffer.from(x.b64, 'base64')); return f; });
    const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#batchFiles')]);
    eq(chooser.isMultiple(), true, 'many files at once');
    await chooser.setFiles(paths); // read when the run gets to them: removed at the end
    await p.waitForFunction(() => document.querySelectorAll('#batchFileList li:not(.batch-empty)').length === 3);
    eq(await p.textContent('#dialog .dlg-foot .btn.primary'), 'Run on 3 files');
    const [zipDl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), answer(p, 'Run on 3 files')]);
    await p.waitForFunction(() => /3 files done/.test((document.querySelector('#dialog .batch-head') || {}).textContent || ''), null, { timeout: 30000 });
    eq(await p.$$eval('#dialog .batch-prog li', (l) => l.map((x) => x.dataset.status)), ['done', 'done', 'done']);
    ok((await p.textContent('#dialog .batch-prog li:nth-child(2) .batch-nt')).includes('ABC000003–ABC000005'), 'each file’s numbers in the list');
    eq(zipDl.suggestedFilename(), 'Stamp and turn.zip');
    paths.forEach((f) => fs.unlinkSync(f));
    const z = unzip(fs.readFileSync(await zipDl.path()));
    eq(z.map((f) => f.name), ['.batch-Alpha.pdf', '.batch-Bravo.pdf', '.batch-Charlie.pdf']);
    eq((await C.PDFDocument.load(z[1].data)).getPage(0).getRotation().angle, 180);
    eq(await batesOf(z[2].data), ['ABC000006']);
    const [csvDl] = await Promise.all([p.waitForEvent('download'), p.click('#dialog .batch-done [data-log]')]);
    eq(csvDl.suggestedFilename(), 'Stamp and turn Bates log.csv');
    ok(fs.readFileSync(await csvDl.path(), 'utf8').includes('"ABC000003","ABC000005"'), 'log');
    await answer(p, 'Done');
    eq(await state(p), before, 'the open document is as it was');
    // the next dialog still opens (the progress dialog let go of its turn)
    await p.evaluate(() => window.__cowdreyPdf.run('batch')); await p.waitForSelector('#dialog[open] .batch-acts', { timeout: 5000 });
    await answer(p, 'Close');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('actions: Optimize, Export as text and Set password steps; the saved PDFs open only with the password', async () => {
    const p = await open();
    const action = { name: 'Lock', steps: [{ id: 'optimize', opts: { preset: 'lossless' } }, { id: 'text', opts: { keepPdf: true } }, { id: 'password', opts: { useOpen: true, limit: false } }] };
    const r = await p.evaluate(([a, l]) => window.__cowdreyPdf.batchRun(a, l, { secrets: { password: { open: 'pelican', owner: '' } } }), [action, (await files()).slice(0, 2)]);
    eq(r.results.map((x) => x.status), ['done', 'done'], JSON.stringify(r.results));
    const z = unzip(Buffer.from(r.zip, 'base64'));
    eq(z.map((f) => f.name), ['Alpha.pdf', 'Alpha.txt', 'Bravo.pdf', 'Bravo.txt']);
    ok(z[1].data.toString('utf8').includes('Alpha page 2'), 'the text');
    let needs = false; try { await pdfjs.getDocument({ data: new Uint8Array(z[0].data) }).promise; } catch (e) { needs = e.name === 'PasswordException'; }
    ok(needs, 'needs a password');
    const t = pdfjs.getDocument({ data: new Uint8Array(z[0].data), password: 'pelican', standardFontDataUrl: FONTS }); const d = await t.promise; eq(d.numPages, 2); await t.destroy();
    ok(await p.evaluate(() => window.__cowdreyPdf.batchSteps().includes('optimize')), 'Optimize is a step');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('actions on the Mac: many files from the Open panel, a folder (list_folder), results next to the originals with a suffix', async () => {
    const fl = await files();
    const init = [(o) => {
      window.__calls = [];
      const content = Object.fromEntries(o.files.map((f) => ['/Users/me/Case/' + f.name, f.b64]));
      window.__TAURI__ = {
        core: { invoke: async (c, a) => {
          window.__calls.push([c, a && a.path, a && a.dir]);
          if (c === 'take_opened_files') return [];
          if (c === 'file_modified') return 1000;
          if (c === 'read_text_file') return { name: a.path.split('/').pop(), path: a.path, content: content[a.path] };
          if (c === 'list_folder') return { name: 'Case', files: o.files.map((f) => ({ path: f.name, modified: 1 })), folders: [] };
          return null;
        } },
        dialog: { save: async (a) => '/Users/me/Desktop/' + a.defaultPath, open: async (a) => { window.__calls.push(['dialog.open', JSON.stringify(a)]); return a && a.directory ? '/Users/me/Case' : Object.keys(content).slice(0, 2); } },
        event: { listen: async () => {} }, opener: { openUrl: async () => {} },
      };
    }, { files: fl }];
    const p = await open({ init });
    await p.evaluate((a) => window.__cowdreyPdf.batchKeep(a), ACTION);
    await p.evaluate(() => window.__cowdreyPdf.run('batch')); await p.waitForSelector('#dialog[open] .batch-acts');
    await p.click('#dialog .batch-act:has(strong:text-is("Review")) [data-do="run"]'); await p.waitForSelector('#dialog[open] #batchFileList');
    await p.click('#batchFiles');
    await p.waitForFunction(() => document.querySelectorAll('#batchFileList li:not(.batch-empty)').length === 2);
    ok((await p.evaluate(() => window.__calls.find((c) => c[0] === 'dialog.open')[1])).includes('"multiple":true'), 'the Open panel takes many');
    await p.click('#batchFolder'); // the third comes from the folder; the two already listed are not listed twice
    await p.waitForFunction(() => document.querySelectorAll('#batchFileList li:not(.batch-empty)').length === 3);
    ok(await p.isVisible('#dialog [data-out="next"]'), 'Next to the originals is offered');
    await p.check('#dialog input[value="next"]'); await p.fill('#batchSuffix', ' reviewed');
    await answer(p, 'Run on 3 files');
    await p.waitForFunction(() => /3 files done/.test((document.querySelector('#dialog .batch-head') || {}).textContent || ''), null, { timeout: 30000 });
    const written = await p.evaluate(() => window.__calls.filter((c) => c[0] === 'write_binary_file').map((c) => c[1]));
    eq(written, ['/Users/me/Case/Alpha reviewed.pdf', '/Users/me/Case/Bravo reviewed.pdf', '/Users/me/Case/Charlie reviewed.pdf']);
    await answer(p, 'Done');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('actions in a folder: files with the same name (from subfolders) and files already there are never replaced', async () => {
    const fl = await files();
    const init = [([A, B, C2]) => {
      const file = (name, b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new File([u], name, { type: 'application/pdf' }); };
      const fileH = (name, b64) => ({ kind: 'file', name, getFile: async () => file(name, b64) });
      const dirH = (name, entries) => ({ kind: 'directory', name, async *entries() { for (const e of entries) yield [e.name, e]; } });
      window.__writes = []; window.__have = new Set(['Other.pdf']); // a file already in the output folder
      window.showDirectoryPicker = async (o) => {
        if (o && o.mode === 'readwrite') return { kind: 'directory', name: 'Out', getFileHandle: async (n, opt) => {
          if (!window.__have.has(n) && !(opt && opt.create)) throw new DOMException('not found', 'NotFoundError');
          return { createWritable: async () => ({ write: async () => {}, close: async () => { window.__have.add(n); window.__writes.push(n); } }) };
        } };
        return dirH('Cases', [dirH('Smith', [fileH('Contract.pdf', A)]), dirH('Jones', [fileH('Contract.pdf', B)]), fileH('Other.pdf', C2)]);
      };
    }, fl.map((f) => f.b64)];
    const p = await open({ init });
    await p.evaluate(() => window.__cowdreyPdf.run('batch')); await p.waitForSelector('#dialog[open] .batch-acts');
    await p.click('#dialog .batch-act[data-id="preset-bates"] [data-do="run"]'); await p.waitForSelector('#dialog[open] #batchFolder');
    await p.click('#batchFolder');
    await p.waitForFunction(() => document.querySelectorAll('#batchFileList li:not(.batch-empty)').length === 3);
    await p.check('#dialog [name="batchOut"][value="folder"]');
    await p.waitForFunction(() => document.querySelector('#batchOutLabel').textContent === 'Out');
    await answer(p, 'Run on 3 files');
    await p.waitForFunction(() => /3 files done/.test((document.querySelector('#dialog .batch-head') || {}).textContent || ''), null, { timeout: 30000 });
    const writes = await p.evaluate(() => window.__writes);
    eq(writes.length, 3, 'three files written'); eq(new Set(writes.map((x) => x.toLowerCase())).size, 3, 'each under its own name: ' + writes);
    ok(!writes.includes('Other.pdf'), 'the file already there is kept');
    const res = await p.evaluate(() => window.__batchLast.results.map((r) => [r.name, r.out[0]]));
    eq(res.map((r) => r[0]), ['Jones/Contract.pdf', 'Other.pdf', 'Smith/Contract.pdf'], 'the log names each file by its folder');
    eq(res.map((r) => r[1]), writes, 'the log says where each went');
    await answer(p, 'Done');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('actions: the list dialog shows only its own buttons, and they fit on a phone', async () => {
    const p = await open({ width: 390, height: 800, touch: true });
    await p.evaluate(() => window.__cowdreyPdf.run('batch')); await p.waitForSelector('#dialog[open] .batch-acts');
    const btns = await p.$$eval('#dialog .dlg-foot button', (l) => l.filter((b) => getComputedStyle(b).display !== 'none').map((b) => { const r = b.getBoundingClientRect(); return [b.textContent.trim(), r.left, r.right]; }));
    eq(btns.map((b) => b[0]), ['Import…', 'New action', 'Close']);
    for (const [label, l, r] of btns) ok(l >= 0 && r <= 390, `${label} on screen: ${l}–${r}`);
    await answer(p, 'Close');
    eq(p.errors, []); await p.ctx.close();
  });

  await test('actions: an imported step named like a property of every object (constructor, toString, __proto__) is unknown, not run', async () => {
    const p = await open();
    const a = await p.evaluate(() => { const H = window.__cowdreyPdf; return H.batchKeep(H.batchImportJson('{"cowdreyPdfAction":1,"name":"Odd","steps":[{"id":"constructor","opts":{}},{"id":"toString","opts":{}},{"id":"__proto__","opts":{}}]}')); });
    eq(await p.evaluate(() => ['constructor', 'toString', '__proto__', 'hasOwnProperty'].filter((x) => window.__cowdreyPdf.batchSteps().includes(x))), []);
    await p.evaluate(() => window.__cowdreyPdf.run('batch')); await p.waitForSelector('#dialog[open] .batch-acts');
    await p.click('#dialog .batch-act:has(strong:text-is("Odd")) [data-do="run"]'); await p.waitForSelector('#dialog[open] #batchFileList');
    ok(/not in this version/.test(await p.textContent('#dialog .prot-err')), 'it says the steps are not in this version');
    await answer(p, 'Cancel');
    const r = await p.evaluate(([x, l]) => window.__cowdreyPdf.batchRun(x, l), [a, (await files()).slice(0, 1)]);
    eq(r.results.map((x) => x.status), ['failed']);
    ok(/not in this version/.test(r.results[0].error), r.results[0].error);
    eq(p.errors, []); await p.ctx.close();
  });
};
