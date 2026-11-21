// Certificate signatures (src/features/76-sign.js): signing IDs, PAdES signing as an incremental update, RFC 3161
// timestamps from a local mock server, checking signatures, and the warning before saving a signed PDF.
// The checks on the saved bytes are independent of the app: Node's crypto and asn1js, and pdfsig (poppler) if installed.
import crypto from 'node:crypto'; import http from 'node:http'; import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

export default async (h) => {
  const { test, eq, ok, open, openPdf, reopen, at, fs, path, root } = h;
  const req = createRequire(path.join(root, 'tests/e2e.mjs'));
  const NM = path.join(root, 'desktop/node_modules');
  const forge = req(path.join(NM, 'node-forge'));
  const asn1js = req(path.join(NM, 'asn1js'));
  const pkijs = req(path.join(NM, 'pkijs'));
  const L = req(path.join(NM, 'pdf-lib'));
  pkijs.setEngine('node', new pkijs.CryptoEngine({ name: 'node', crypto: crypto.webcrypto }));
  const SAMPLE = fs.readFileSync(path.join(root, 'tests/fixtures/sample.pdf'));
  const fixture = (n) => fs.readFileSync(path.join(root, 'tests/fixtures', n));
  const hasPdfsig = spawnSync('pdfsig', ['-v']).status === 0;
  const hasQpdf = spawnSync('qpdf', ['--version']).status === 0;
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'cowdrey-sign-'));

  // A test-only signing ID made here: RSA, self-signed, in a PKCS#12 with the old 3DES cipher WebCrypto lacks.
  function makeP12(cn, password) {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const key = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }));
    const cert = forge.pki.createCertificate();
    cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e); cert.serialNumber = '01' + crypto.randomBytes(8).toString('hex');
    cert.validity.notBefore = new Date(Date.now() - 86400000); cert.validity.notAfter = new Date(Date.now() + 3 * 365 * 86400000);
    const attrs = [{ name: 'commonName', value: cn }, { name: 'organizationName', value: 'Cowdrey Tests' }];
    cert.setSubject(attrs); cert.setIssuer(attrs);
    cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, nonRepudiation: true }]);
    cert.sign(key, forge.md.sha256.create());
    const asn = forge.pkcs12.toPkcs12Asn1(key, [cert], password, { algorithm: '3des' });
    return Buffer.from(forge.asn1.toDer(asn).getBytes(), 'binary');
  }
  const RSA_P12 = makeP12('Test Signer', 'pw1234'), RSA2_P12 = makeP12('Second Signer', 'second');

  // Every signature's /ByteRange in a file, in file order
  const ranges = (buf) => [...buf.toString('latin1').matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)].map((m) => m.slice(1, 5).map(Number));
  // Checks a signature with Node's crypto and asn1js only: the digest over the ranges, and the signer's signature.
  function nodeVerify(buf, [a, b, c, d]) {
    const hex = buf.subarray(b + 1, c - 1).toString('latin1');
    const der = Buffer.from(hex, 'hex');
    const ci = asn1js.fromBER(new Uint8Array(der).buffer).result;
    const sd = ci.valueBlock.value[1].valueBlock.value[0], parts = sd.valueBlock.value;
    const certsEl = parts.find((x) => x.idBlock.tagClass === 3 && x.idBlock.tagNumber === 0);
    const certs = certsEl.valueBlock.value.map((x) => new crypto.X509Certificate(Buffer.from(x.toBER(false))));
    const si = parts[parts.length - 1].valueBlock.value[0], sp = si.valueBlock.value;
    const serial = Buffer.from(sp[1].valueBlock.value[1].valueBlock.valueHexView).toString('hex').toUpperCase().replace(/^0+/, '');
    const signer = certs.find((x) => x.serialNumber.replace(/^0+/, '') === serial);
    const sa = sp.find((x) => x.idBlock.tagClass === 3 && x.idBlock.tagNumber === 0);
    const saDer = Buffer.from(sa.valueBeforeDecodeView); saDer[0] = 0x31;
    const attr = (oid) => sa.valueBlock.value.find((x) => x.valueBlock.value[0].valueBlock.toString() === oid);
    const md = Buffer.from(attr('1.2.840.113549.1.9.4').valueBlock.value[1].valueBlock.value[0].valueBlock.valueHexView);
    const digestAlg = sp[2].valueBlock.value[0].valueBlock.toString(), sigAlg = sp.find((x, k) => k > 2 && x.idBlock.tagClass === 1 && x.idBlock.tagNumber === 16).valueBlock.value[0].valueBlock.toString();
    const sig = Buffer.from(sp.find((x, k) => k > 3 && x.idBlock.tagClass === 1 && x.idBlock.tagNumber === 4).valueBlock.valueHexView);
    const un = sp.find((x) => x.idBlock.tagClass === 3 && x.idBlock.tagNumber === 1);
    const hash = { '2.16.840.1.101.3.4.2.1': 'sha256', '2.16.840.1.101.3.4.2.2': 'sha384' }[digestAlg];
    const content = Buffer.concat([buf.subarray(0, b), buf.subarray(c, c + d)]);
    return {
      digestOk: crypto.createHash(hash).update(content).digest().equals(md),
      sigOk: !!signer && crypto.verify(hash, saDer, signer.publicKey, sig),
      covers: a === 0 && /^<[0-9A-Fa-f]+>$/.test(buf.subarray(b, c).toString('latin1')),
      sigAlg, certs: certs.length, signer: signer && signer.subject,
      signedAttrs: sa.valueBlock.value.map((x) => x.valueBlock.value[0].valueBlock.toString()),
      unsigned: un ? un.valueBlock.value.map((x) => x.valueBlock.value[0].valueBlock.toString()) : [],
    };
  }
  const pdfsig = (buf) => { const f = path.join(tmp, 'check.pdf'); fs.writeFileSync(f, buf); const r = spawnSync('pdfsig', [f], { encoding: 'utf8' }); return (r.stdout || '') + (r.stderr || ''); };
  // A PDF parsed again by pdf-lib: the signature fields and their values
  async function sigFields(buf) {
    const d = await L.PDFDocument.load(buf, { updateMetadata: false });
    const acro = d.catalog.lookup(L.PDFName.of('AcroForm'), L.PDFDict);
    return { d, acro, fields: d.getForm().getFields().filter((f) => f.acroField.dict.get(L.PDFName.of('FT')) === L.PDFName.of('Sig')).map((f) => ({ name: f.getName(), signed: !!f.acroField.dict.get(L.PDFName.of('V')) })) };
  }
  // Appends an incremental update by hand (a comment on page 1), the way another app would.
  async function appendComment(buf) {
    const d = await L.PDFDocument.load(buf, { updateMetadata: false });
    const s = buf.toString('latin1'), last = +/startxref\s+(\d+)\s*%%EOF\s*$/.exec(s)[1];
    const size = Math.max(d.context.largestObjectNumber + 1, ...[...s.matchAll(/\/Size (\d+)/g)].map((m) => +m[1]));
    const page = d.getPage(0), annotNum = size;
    const annots = page.node.lookup(L.PDFName.of('Annots'), L.PDFArray);
    annots.push(L.PDFRef.of(annotNum, 0));
    const ser = (o) => { const u = new Uint8Array(o.sizeInBytes()); o.copyBytesInto(u, 0); return Buffer.from(u); };
    const objs = [[page.ref.objectNumber, ser(page.node)], [annotNum, Buffer.from('<< /Type /Annot /Subtype /Text /Rect [72 72 92 92] /Contents (Looks good) /F 4 /Name /Comment >>')]];
    const parts = [buf]; let pos = buf.length; const offs = {};
    for (const [n, body] of objs) { offs[n] = pos; const chunk = Buffer.concat([Buffer.from(`${n} 0 obj\n`), body, Buffer.from('\nendobj\n')]); parts.push(chunk); pos += chunk.length; }
    const root = /\/Root (\d+ \d+ R)/.exec(s.slice(last))[1];
    const xn = size + 1, nums = [...objs.map(([n]) => n), xn].sort((a, b) => a - b); offs[xn] = pos;
    const rows = Buffer.concat(nums.map((n) => { const r = Buffer.alloc(7); r[0] = 1; r.writeUInt32BE(offs[n], 1); return r; }));
    const head = `${xn} 0 obj\n<< /Type /XRef /Size ${xn + 1} /W [1 4 2] /Index [${nums.map((n) => n + ' 1').join(' ')}] /Root ${root} /Prev ${last} /Length ${rows.length} >>\nstream\n`;
    parts.push(Buffer.from(head), rows, Buffer.from(`\nendstream\nendobj\nstartxref\n${pos}\n%%EOF\n`));
    return Buffer.concat(parts);
  }
  // The signing dialog: password, where, look, reason; then the box when one is drawn. Returns the saved file.
  async function signUi(p, { password, place = 'draw', look = 'text', reason = '', box = [320, 640, 540, 700], certify, ts, fmt } = {}) {
    await p.evaluate(() => window.__cowdreyPdf.run('sgSign'));
    await p.waitForSelector('#dialog[open] #sgPlace');
    if (await p.$('#sgPw:visible')) await p.fill('#sgPw', password);
    await p.selectOption('#sgPlace', place); await p.selectOption('#sgLook', look);
    if (reason) { await p.click('#dialog details:first-of-type summary'); await p.fill('#sgReason', reason); }
    if (certify || fmt) { await p.click('#dialog details:nth-of-type(2) summary'); if (certify) await p.selectOption('#sgCertify', String(certify)); if (fmt) await p.selectOption('#sgFmt', fmt); }
    if (ts != null && await p.$('#sgTs')) await p.setChecked('#sgTs', ts);
    const dl = p.waitForEvent('download', { timeout: 30000 });
    await p.evaluate(() => { window.__lastSignedShown = 0; });
    await p.click('#dialog .dlg-foot .btn.primary');
    if (place === 'draw') {
      await p.waitForFunction(() => document.querySelector('#app').dataset.tool === 'sgbox');
      const [x0, y0] = await at(p, box[0], box[3]), [x1, y1] = await at(p, box[2], box[1]);
      await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x1, y1, { steps: 6 }); await p.mouse.up();
    }
    const d = await dl;
    const out = fs.readFileSync(await d.path());
    await p.waitForFunction(() => window.__lastSignedShown && document.querySelector('.sg-bar'), null, { timeout: 15000 });
    return { out, name: d.suggestedFilename() };
  }
  const importId = (p, buf, pw) => p.evaluate(([b, w]) => window.__cowdreyPdf.sgImportId(b, w), [Array.from(buf), pw]);
  const sigs = (p) => p.evaluate(() => window.__cowdreyPdf.sgSignatures());
  const openBuf = async (p, buf, name = 'Signed.pdf') => {
    await p.evaluate(async ([b, n]) => { await window.__cowdreyPdf.openBytes(new Uint8Array(b), n); }, [Array.from(buf), name]);
    await p.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 15000 }); await p.waitForTimeout(400);
  };
  const panelText = async (p) => { await p.evaluate(() => window.__cowdreyPdf.run('sgPanel')); await p.waitForSelector('#dialog[open] .sg-list'); return p.textContent('#dialog .sg-list'); };
  const closeDialog = (p) => p.click('#dialog .dlg-foot .btn.primary');

  let signedA = null; // tests/fixtures/sample.pdf signed with a visible box, kept for the tests after
  await test('certificate signing: sign with a drawn box; the original bytes, then one incremental update; the signature checks out', async () => {
    const p = await open(); await openPdf(p);
    await p.click('[data-rt="protect"]');
    for (const c of ['sgSign', 'sgPanel', 'sgIds']) ok(await p.$(`.ribbon-body [data-cmd="${c}"]`), 'ribbon has ' + c);
    eq(await p.evaluate(() => window.__cowdreyPdf.sgEdits()), 'none');
    await importId(p, RSA_P12, 'pw1234');
    const { out, name } = await signUi(p, { password: 'pw1234', look: 'typed', reason: 'Approved' });
    signedA = out;
    eq(name, 'Quarterly report (signed).pdf');
    ok(out.subarray(0, SAMPLE.length).equals(SAMPLE), 'the original bytes are a prefix');
    const tail = out.subarray(SAMPLE.length).toString('latin1');
    const lastXref = +/startxref\s+(\d+)\s*%%EOF\s*$/.exec(SAMPLE.toString('latin1'))[1];
    eq((tail.match(/startxref/g) || []).length, 1, 'one incremental section');
    ok(tail.includes(`/Prev ${lastXref}`), 'with /Prev pointing at the last xref');
    ok(/\/Type \/XRef/.test(tail), 'an xref stream, as the original has');
    const [br] = ranges(out); eq(ranges(out).length, 1);
    eq(br[2] + br[3], out.length, 'the range runs to the end of the file');
    const v = nodeVerify(out, br);
    ok(v.covers, 'everything but the /Contents hex is covered');
    ok(v.digestOk, 'messageDigest = SHA-256 over the ranges'); ok(v.sigOk, 'the RSA signature verifies (Node crypto)');
    eq(v.sigAlg, '1.2.840.113549.1.1.11'); eq(v.signer, 'CN=Test Signer\nO=Cowdrey Tests');
    eq(v.signedAttrs.sort(), ['1.2.840.113549.1.9.16.2.47', '1.2.840.113549.1.9.3', '1.2.840.113549.1.9.4'], 'CAdES: contentType, messageDigest, signingCertificateV2 (no signingTime)');
    ok(/\/SubFilter \/ETSI\.CAdES\.detached/.test(tail) && /\/Filter \/Adobe\.PPKLite/.test(tail), 'PAdES filter');
    // parsed again: a signed signature field with a widget on page 1, SigFlags 3, an appearance with the text
    const { d, acro, fields } = await sigFields(out);
    eq(fields, [{ name: 'Signature1', signed: true }]);
    eq(acro.get(L.PDFName.of('SigFlags')).asNumber(), 3);
    const w = d.getForm().getField('Signature1').acroField.getWidgets()[0];
    ok(w.getRectangle().width > 200 && w.getRectangle().y > 600, JSON.stringify(w.getRectangle()));
    eq(w.dict.get(L.PDFName.of('F')).asNumber(), 4);
    ok(d.getPage(0).node.Annots().asArray().some((r) => r.toString() === d.getForm().getField('Signature1').acroField.ref.toString()), 'on page 1');
    const apStream = d.context.lookup(w.dict.lookup(L.PDFName.of('AP'), L.PDFDict).get(L.PDFName.of('N')));
    const apText = Buffer.from(apStream.getContents()).toString('latin1');
    ok(apText.includes('(Digitally signed by Test Signer)') && apText.includes('(Reason: Approved)') && apText.includes('/Im1 Do'), apText);
    if (hasPdfsig) { const r = pdfsig(out); ok(/Signature is Valid/.test(r) && /Total document signed/.test(r), r); }
    if (hasQpdf) execFileSync('qpdf', ['--check', path.join(tmp, 'check.pdf')]);
    // the signed file is what is open now, and its pages show the signature
    eq(await p.textContent('#docTitle'), 'Quarterly report (signed)');
    ok((await p.textContent('.sg-bar')).includes('This PDF is digitally signed by Test Signer'), await p.textContent('.sg-bar'));
    eq(p.errors, []); await p.ctx.close();
  });
  await test('certificate signing: the Signatures panel says valid, not verified, until the certificate is trusted', async () => {
    ok(signedA, 'signed file from the test before');
    const p = await open(); await openBuf(p, signedA);
    await p.waitForSelector('.sg-bar');
    const t = await panelText(p);
    ok(t.includes('Valid, signer not verified') && t.includes('Test Signer') && /Signed .*20\d\d/.test(t) && t.includes('No timestamp') && t.includes('Reason: Approved'), t);
    ok((await p.textContent('#dialog')).includes('Revocation is checked only when you ask'), 'says revocation is checked only when asked');
    ok(t.includes('Document: Not changed since it was signed') && t.includes('Revocation: Can’t be checked: the certificates name no revocation service') && t.includes('Certificates (1)'), t);
    await p.click('#dialog [data-sg-trust]');
    await p.waitForFunction(() => document.querySelector('#dialog .sg-list').textContent.includes('Valid, signer trusted'));
    await closeDialog(p);
    eq((await sigs(p))[0].status, 'trusted');
    // trusted on this device: opening it again remembers
    await openBuf(p, signedA, 'Again.pdf');
    eq((await sigs(p)).map((x) => x.statusText), ['Valid, signer trusted']);
    // Go to field
    await p.evaluate(() => window.__cowdreyPdf.run('sgPanel')); await p.waitForSelector('#dialog[open] [data-sg-go]');
    await p.click('#dialog [data-sg-go]'); await p.waitForSelector('.sg-flash');
    eq(p.errors, []); await p.ctx.close();
  });
  await test('certificate signing: a byte changed in the signed part is Invalid; a comment added later is allowed and said', async () => {
    const p = await open();
    const bad = Buffer.from(signedA), k = bad.indexOf('/BBox [ 0 0 201 23 ]');
    ok(k > 0 && k < ranges(signedA)[0][1]); bad[k + 13] = '2'.charCodeAt(0); // 201 -> 202
    await openBuf(p, bad);
    const s1 = await sigs(p);
    eq([s1[0].status, s1[0].digestOk, s1[0].problem, s1[0].statusText], ['invalid', false, 'tampered', 'Invalid: the document was changed after signing']);
    ok((await panelText(p)).includes('Invalid'), 'panel'); await closeDialog(p);
    ok(!nodeVerify(bad, ranges(bad)[0]).digestOk, 'Node agrees');
    const more = await appendComment(signedA);
    await openBuf(p, more);
    const s2 = await sigs(p);
    eq([s2[0].status, s2[0].statusText, s2[0].digestOk, s2[0].sigOk, s2[0].changeText], ['valid', 'Valid, signer not verified', true, true, 'Changed after signing: comments added (allowed).']);
    eq(s2[0].changes, { comments: true, form: false, sign: false, other: false });
    ok((await p.textContent('.sg-bar')).includes('Comments or form entries were added after signing'), 'the bar says so');
    eq(p.errors, []); await p.ctx.close();
  });
  // Appends an incremental update by hand: `objs` ([[num, body]]) and a cross-reference section that lists them.
  // how: 'stream' (one xref stream), 'chain' (an xref stream that lists them, then one that lists only itself and
  // points back at it: only the second is at startxref), 'hybrid' (a classic table with /XRefStm pointing at a stream
  // that lists them) or 'hidden' (written but not listed anywhere).
  function appendRaw(buf, objs, how = 'stream') {
    const s = buf.toString('latin1'), last = +/startxref\s+(\d+)\s*%%EOF\s*$/.exec(s)[1];
    const size = Math.max(...[...s.matchAll(/\/Size (\d+)/g)].map((m) => +m[1]));
    const root = [...s.matchAll(/\/Root (\d+ \d+ R)/g)].pop()[1];
    const parts = [buf]; let pos = buf.length; const offs = {};
    for (const [n, body] of objs) { offs[n] = pos; const chunk = Buffer.from(`${n} 0 obj\n${body}\nendobj\n`, 'latin1'); parts.push(chunk); pos += chunk.length; }
    const xs = (num, list, prev) => { // an xref stream at pos listing `list` and itself
      offs[num] = pos; const nums = [...list, num].sort((a, b) => a - b);
      const rows = Buffer.concat(nums.map((n) => { const r = Buffer.alloc(7); r[0] = 1; r.writeUInt32BE(offs[n], 1); return r; }));
      const at = pos, chunk = Buffer.concat([Buffer.from(`${num} 0 obj\n<< /Type /XRef /Size ${size + 3} /W [1 4 2] /Index [${nums.map((n) => n + ' 1').join(' ')}] /Root ${root} /Prev ${prev} /Length ${rows.length} >>\nstream\n`), rows, Buffer.from('\nendstream\nendobj\n')]);
      parts.push(chunk); pos += chunk.length; return at;
    };
    const listed = how === 'hidden' ? [] : objs.map(([n]) => n);
    let start;
    if (how === 'chain') { const a = xs(size, listed, last); start = xs(size + 1, [], a); }
    else if (how === 'hybrid') { const a = xs(size, listed, last); start = pos; parts.push(Buffer.from(`xref\n0 1\n0000000000 65535 f\r\ntrailer\n<< /Size ${size + 1} /Root ${root} /Prev ${last} /XRefStm ${a} >>\n`)); }
    else start = xs(size, listed, last);
    parts.push(Buffer.from(`startxref\n${start}\n%%EOF\n`));
    return Buffer.concat(parts);
  }
  await test('certificate signing: page changes hidden from the check are caught (more xref sections, /XRefStm, disguised objects, an edited signature)', async () => {
    ok(signedA, 'signed file from the tests before');
    const p = await open();
    const d = await L.PDFDocument.load(signedA, { updateMetadata: false }), pg = d.getPage(0).node;
    const cref = pg.get(L.PDFName.of('Contents')), contentNum = (cref instanceof L.PDFRef ? cref : d.context.lookup(cref).get(0)).objectNumber;
    const fonts = d.context.lookup(pg.Resources().get(L.PDFName.of('Font'))), fontRef = fonts.values().find((v) => v instanceof L.PDFRef);
    const ser = (o) => { const u = new Uint8Array(o.sizeInBytes()); o.copyBytesInto(u, 0); return Buffer.from(u).toString('latin1'); };
    const draw = 'BT /Helvetica 28 Tf 72 500 Td (PAY EVE 1,000,000) Tj ET';
    const content = (dict = '') => `<< ${dict}/Length ${draw.length} >>\nstream\n${draw}\nendstream`;
    const verify = (buf) => p.evaluate(async (b) => window.__cowdreyPdf.sgVerify(b), Array.from(buf));
    const pageText = (buf) => p.evaluate(async (b) => { const x = await pdfjsLib.getDocument({ data: new Uint8Array(b) }).promise; return (await (await x.getPage(1)).getTextContent()).items.map((i) => i.str).join(' '); }, Array.from(buf));
    const st = signedA.toString('latin1'), m = /(\d+) 0 obj\n(<< \/Type \/Sig [\s\S]*?)\nendobj/.exec(st);
    ok(m && m.index < ranges(signedA)[0][1], 'the signature dictionary');
    const cases = {
      'a second xref section behind the last one': appendRaw(signedA, [[contentNum, content()]], 'chain'),
      'a hybrid table whose /XRefStm lists the change': appendRaw(signedA, [[contentNum, content()]], 'hybrid'),
      'page content typed as a signature': appendRaw(signedA, [[contentNum, content('/Type /Sig ')]]),
      'page content typed as metadata': appendRaw(signedA, [[contentNum, content('/Type /Metadata ')]]),
      'page content typed as an xref stream': appendRaw(signedA, [[contentNum, content('/Type /X#52ef ')]]),
      'a font that gains /Fields': appendRaw(signedA, [[fontRef.objectNumber, ser(d.context.lookup(fontRef)).replace(/>>\s*$/, '/Fields [] >>').replace(/\/BaseFont \/[A-Za-z-]+/, '/BaseFont /Courier')]]),
      'page content written but not listed': appendRaw(signedA, [[contentNum, content()]], 'hidden'),
      'the signature dictionary edited': appendRaw(signedA, [[+m[1], m[2].replace(/\/M \([^)]*\)/, "/M (D:20200101120000+00'00')").replace(/\/Reason <[0-9A-F]+>/, '/Reason (I reject this document)')]]),
    };
    for (const [what, buf] of Object.entries(cases)) {
      const [v] = await verify(buf);
      eq([what, v.status, v.changes && v.changes.other, v.changes && v.changes.sign], [what, 'changed', true, false]);
    }
    await openBuf(p, cases['a second xref section behind the last one']); // (loads pdf.js)
    eq((await sigs(p))[0].status, 'changed');
    ok((await pageText(cases['a second xref section behind the last one'])).includes('PAY EVE'), 'pdf.js shows the change the check caught');
    // the panel shows the details as signed, not as edited later
    await openBuf(p, cases['the signature dictionary edited']);
    const [x] = await sigs(p);
    eq([x.status, x.reason], ['changed', 'Approved']);
    ok(Math.abs(new Date(x.when) - Date.now()) < 3600e3, x.when);
    // still fine: an update that only adds a comment, or a new signature
    eq((await verify(await appendComment(signedA)))[0].changes, { comments: true, form: false, sign: false, other: false });
    eq(p.errors, []); await p.ctx.close();
  });
  await test('certificate signing: a second signer signs the signed file as it is; both signatures stay valid', async () => {
    const p = await open(); await openBuf(p, signedA, 'Quarterly report (signed).pdf');
    await importId(p, RSA2_P12, 'second');
    await p.evaluate(() => window.__cowdreyPdf.sgIds()).then((l) => ok(l.length === 1));
    const { out, name } = await signUi(p, { password: 'second', box: [320, 470, 540, 530] });
    eq(name, 'Quarterly report (signed).pdf');
    ok(out.subarray(0, signedA.length).equals(signedA), 'the first signed file is a prefix');
    const rs = ranges(out); eq(rs.length, 2);
    for (const r of rs) { const v = nodeVerify(out, r); ok(v.digestOk && v.sigOk && v.covers, JSON.stringify(v)); }
    eq(rs[0][2] + rs[0][3], signedA.length); eq(rs[1][2] + rs[1][3], out.length);
    if (hasPdfsig) { const r = pdfsig(out); eq((r.match(/Signature is Valid/g) || []).length, 2, r); }
    const s = await sigs(p);
    eq(s.map((x) => [x.name, x.status]), [['Test Signer', 'valid'], ['Second Signer', 'valid']]);
    eq(s[0].changes.sign, true); eq(s[0].changes.other, false);
    ok((await panelText(p)).includes('Signed again after this signature'), 'first one says it was signed again');
    await closeDialog(p);
    const { fields } = await sigFields(out);
    eq(fields, [{ name: 'Signature1', signed: true }, { name: 'Signature2', signed: true }]);
    eq(p.errors, []); await p.ctx.close();
  });

  // A mock timestamp server (RFC 3161), signing with a test key; the page reaches it through https://tsa.test/.
  const tsaKeys = await crypto.webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const tsaCert = new pkijs.Certificate();
  tsaCert.version = 2; tsaCert.serialNumber = new asn1js.Integer({ value: 4242 });
  for (const n of [tsaCert.subject, tsaCert.issuer]) n.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.Utf8String({ value: 'Test Timestamp Authority' }) }));
  tsaCert.notBefore.value = new Date(Date.now() - 86400000); tsaCert.notAfter.value = new Date(Date.now() + 365 * 86400000);
  tsaCert.extensions = [new pkijs.Extension({ extnID: '2.5.29.37', critical: true, extnValue: new pkijs.ExtKeyUsage({ keyPurposes: ['1.3.6.1.5.5.7.3.8'] }).toSchema().toBER(false) })];
  await tsaCert.subjectPublicKeyInfo.importKey(tsaKeys.publicKey); await tsaCert.sign(tsaKeys.privateKey, 'SHA-256');
  let tsaSerial = 0, tsaHits = 0;
  const TSA_TIME = new Date(Math.floor(Date.now() / 1000) * 1000 - 3600000); // the certificates are valid from a day ago
  const tsa = http.createServer((rq, rs) => {
    const chunks = []; rq.on('data', (c) => chunks.push(c));
    rq.on('end', async () => {
      tsaHits++;
      try {
        const q = pkijs.TimeStampReq.fromBER(new Uint8Array(Buffer.concat(chunks)).buffer);
        const tst = new pkijs.TSTInfo({ version: 1, policy: '1.2.3.4.5', messageImprint: q.messageImprint, serialNumber: new asn1js.Integer({ value: ++tsaSerial }), genTime: TSA_TIME, nonce: q.nonce });
        const tstDer = tst.toSchema().toBER(false);
        const md = await crypto.webcrypto.subtle.digest('SHA-256', tstDer);
        const sd = new pkijs.SignedData({
          version: 3, encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: '1.2.840.113549.1.9.16.1.4', eContent: new asn1js.OctetString({ valueHex: tstDer }) }),
          signerInfos: [new pkijs.SignerInfo({ version: 1, sid: new pkijs.IssuerAndSerialNumber({ issuer: tsaCert.issuer, serialNumber: tsaCert.serialNumber }), signedAttrs: new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes: [
            new pkijs.Attribute({ type: '1.2.840.113549.1.9.3', values: [new asn1js.ObjectIdentifier({ value: '1.2.840.113549.1.9.16.1.4' })] }),
            new pkijs.Attribute({ type: '1.2.840.113549.1.9.4', values: [new asn1js.OctetString({ valueHex: md })] })] }) })],
          certificates: q.certReq ? [tsaCert] : [],
        });
        sd.encapContentInfo.eContent = new asn1js.OctetString({ valueHex: tstDer }); // DER, as timestamp servers send it (pkijs would split it)
        await sd.sign(tsaKeys.privateKey, 0, 'SHA-256');
        const resp = new pkijs.TimeStampResp({ status: new pkijs.PKIStatusInfo({ status: 0 }), timeStampToken: new pkijs.ContentInfo({ contentType: '1.2.840.113549.1.7.2', content: sd.toSchema(true) }) });
        rs.writeHead(200, { 'content-type': 'application/timestamp-reply' }); rs.end(Buffer.from(resp.toSchema().toBER(false)));
      } catch (e) { rs.writeHead(500); rs.end(String(e)); }
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => tsa.on('listening', r));
  const routeTsa = (p) => p.ctx.route('https://tsa.test/**', async (r) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const res = await fetch(`http://127.0.0.1:${tsa.address().port}/`, { method: 'POST', body: r.request().postDataBuffer() });
    return r.fulfill({ status: res.status, headers: { ...cors, 'content-type': 'application/timestamp-reply' }, body: Buffer.from(await res.arrayBuffer()) });
  });
  await test('certificate signing: a timestamp from a timestamp server (only a fingerprint is sent); none asked for with the setting off', async () => {
    const p = await open(); await routeTsa(p); await openPdf(p);
    await importId(p, RSA_P12, 'pw1234');
    // the setting: off (empty) at first, so no request
    const hits0 = tsaHits;
    const plain = await signUi(p, { password: 'pw1234' });
    eq(tsaHits, hits0, 'no request without a timestamp server');
    eq(nodeVerify(plain.out, ranges(plain.out)[0]).unsigned, []);
    // set it in Signing IDs
    await p.evaluate(() => window.__cowdreyPdf.run('sgIds')); await p.waitForSelector('#dialog[open] #sgTsa');
    ok((await p.textContent('#dialog')).includes('Sends a fingerprint of the signature, not the document, to the timestamp server.'), 'the setting says what it sends');
    await p.fill('#sgTsa', 'https://tsa.test/ts'); await p.dispatchEvent('#sgTsa', 'change'); await closeDialog(p);
    await openPdf(p);
    const { out } = await signUi(p, { password: 'pw1234', ts: true });
    eq(tsaHits, hits0 + 1, 'one request');
    const v = nodeVerify(out, ranges(out)[0]);
    ok(v.digestOk && v.sigOk, 'still valid'); eq(v.unsigned, ['1.2.840.113549.1.9.16.2.14'], 'the token is an unsigned attribute');
    const s = await sigs(p);
    eq([s[0].status, s[0].ts.ok, s[0].ts.time, s[0].ts.tsa, s[0].when], ['valid', true, TSA_TIME.toISOString(), 'Test Timestamp Authority', TSA_TIME.toISOString()]);
    const t = await panelText(p); ok(t.includes('Timestamp:') && t.includes('Test Timestamp Authority') && t.includes('2026'), t);
    await closeDialog(p);
    if (hasPdfsig) { const r = pdfsig(out); ok(/Signature is Valid/.test(r), r); }
    // unticked: no request
    await openPdf(p);
    await signUi(p, { password: 'pw1234', ts: false });
    eq(tsaHits, hits0 + 1, 'no request when not ticked');
    // a server that fails: signing stops with a message, nothing saved
    await p.ctx.unroute('https://tsa.test/**');
    await p.ctx.route('https://tsa.test/**', (r) => r.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' }, body: 'busy' }));
    await openPdf(p);
    await p.evaluate(() => window.__cowdreyPdf.run('sgSign')); await p.waitForSelector('#dialog[open] #sgPlace');
    await p.fill('#sgPw', 'pw1234'); await p.selectOption('#sgPlace', 'draw');
    await p.click('#dialog .dlg-foot .btn.primary');
    await p.waitForFunction(() => document.querySelector('#app').dataset.tool === 'sgbox');
    const [x0, y0] = await at(p, 320, 700), [x1, y1] = await at(p, 540, 640);
    await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x1, y1, { steps: 4 }); await p.mouse.up();
    await p.waitForSelector('#dialog[open]'); ok((await p.textContent('#dialog')).includes('error 503'), await p.textContent('#dialog'));
    await closeDialog(p);
    eq(p.errors.filter((e) => !/503|Failed to load resource/.test(e)), []); await p.ctx.close();
  });
  await test('certificate signing: saving an edited signed PDF warns first; Cancel saves nothing; unedited and form-only saves keep the signatures', async () => {
    const p = await open(); await openBuf(p, signedA, 'Quarterly report (signed).pdf');
    await p.waitForSelector('.sg-bar');
    // unedited: Save writes the file as it is (a download: no file picker here)
    await p.evaluate(() => { window.showSaveFilePicker = undefined; window.__lastSaved = null; });
    const [d0] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => window.__cowdreyPdf.run('save'))]);
    ok(fs.readFileSync(await d0.path()).equals(signedA), 'the same bytes');
    // form values typed in: added after the signature as an incremental update
    await p.fill('.annotationLayer input[name="name"]', 'Bradley'); await p.waitForTimeout(200);
    eq(await p.evaluate(() => window.__cowdreyPdf.sgEdits()), 'form');
    const [d1] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => window.__cowdreyPdf.run('save'))]);
    const filled = fs.readFileSync(await d1.path());
    ok(filled.length > signedA.length && filled.subarray(0, signedA.length).equals(signedA), 'signed bytes kept as a prefix');
    eq((await h.PDFDocument.load(filled)).getForm().getTextField('name').getText(), 'Bradley');
    eq(await p.evaluate(async (b) => window.__cowdreyPdf.sgVerify(b), Array.from(filled)), [{ status: 'valid', statusText: 'Valid, signer not verified', name: 'Test Signer', changes: { comments: false, form: true, sign: false, other: false }, ts: false }]);
    // a comment: added as an incremental update too, no warning
    await p.evaluate(() => window.__cowdreyPdf.run('tool_rect'));
    const g = await p.locator('.page[data-n="0"]').boundingBox();
    await p.mouse.move(g.x + 100, g.y + 40); await p.mouse.down(); await p.mouse.move(g.x + 200, g.y + 90, { steps: 3 }); await p.mouse.up();
    eq(await p.evaluate(() => window.__cowdreyPdf.sgEdits()), 'other');
    const [dc] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => window.__cowdreyPdf.run('save'))]);
    const commented = fs.readFileSync(await dc.path());
    ok(commented.length > filled.length && commented.subarray(0, signedA.length).equals(signedA), 'signed bytes kept as a prefix');
    const vc = await p.evaluate(async (b) => window.__cowdreyPdf.sgVerify(b), Array.from(commented));
    eq([vc[0].status, vc[0].changes], ['valid', { comments: true, form: true, sign: false, other: false }]);
    // an edit that is not a comment (a page turned): the warning; Cancel saves nothing
    await p.evaluate(() => window.__cowdreyPdf.run('rotR'));
    let downloads = 0; p.on('download', () => downloads++);
    await p.evaluate(() => { window.__lastSaved = null; window.__cowdreyPdf.run('save'); });
    await p.waitForSelector('#dialog[open]');
    ok((await p.textContent('#dialog')).includes('Saving makes a new copy of the file and the existing signatures will show as changed. Save a copy instead?'), await p.textContent('#dialog'));
    await p.click('#dialog .dlg-foot button:has-text("Cancel")'); await p.waitForTimeout(600);
    eq([downloads, await p.evaluate(() => window.__lastSaved)], [0, null], 'nothing saved');
    // Save a copy
    const [d2] = await Promise.all([p.waitForEvent('download'), (async () => { await p.evaluate(() => { window.__cowdreyPdf.run('save'); }); await p.waitForSelector('#dialog[open]'); await p.click('#dialog .dlg-foot button:has-text("Save a copy")'); })()]);
    eq(d2.suggestedFilename(), 'Quarterly report (signed) (copy).pdf');
    const copy = fs.readFileSync(await d2.path());
    eq((await p.evaluate(async (b) => window.__cowdreyPdf.sgVerify(b), Array.from(copy)))[0].status, 'invalid', 'a rewritten file breaks the signature, as warned');
    eq(p.errors, []); await p.ctx.close();
  });
  await test('certificate signing: an ECDSA P-256 signing ID made on the device signs and validates', async () => {
    const p = await open(); await openPdf(p);
    // no signing ID yet: offered to create one
    await p.evaluate(() => window.__cowdreyPdf.run('sgSign'));
    await p.waitForSelector('#dialog[open]'); await p.click('#dialog .dlg-foot button:has-text("Create a signing ID")');
    await p.waitForSelector('#dialog[open] #sgcName');
    await p.fill('#sgcName', 'Ada Device'); await p.fill('#sgcEmail', 'ada@example.com'); await p.selectOption('#sgcKind', 'ec');
    await p.fill('#sgcPw', 'abcd'); await p.fill('#sgcPw2', 'abce');
    await p.click('#dialog .dlg-foot .btn.primary'); await p.waitForTimeout(200);
    ok(await p.$('#dialog[open] #sgcName'), 'different passwords keep the dialog open');
    await p.fill('#sgcPw2', 'abcd'); await p.click('#dialog .dlg-foot .btn.primary');
    // then the signing dialog; a wrong password first
    await p.waitForSelector('#dialog[open] #sgPlace', { timeout: 30000 });
    await p.fill('#sgPw', 'nope'); await p.check('#sgRemember'); await p.selectOption('#sgPlace', 'draw');
    await p.click('#dialog .dlg-foot .btn.primary');
    await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('That password is not right for this signing ID.'));
    await p.waitForSelector('#dialog[open] #sgPw');
    await p.fill('#sgPw', 'abcd'); await p.check('#sgRemember'); await p.selectOption('#sgPlace', 'draw');
    const dl = p.waitForEvent('download');
    await p.click('#dialog .dlg-foot .btn.primary');
    await p.waitForFunction(() => document.querySelector('#app').dataset.tool === 'sgbox');
    const [x0, y0] = await at(p, 320, 700), [x1, y1] = await at(p, 540, 640);
    await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x1, y1, { steps: 4 }); await p.mouse.up();
    const out = fs.readFileSync(await (await dl).path());
    const v = nodeVerify(out, ranges(out)[0]);
    ok(v.digestOk && v.sigOk, 'verifies with Node crypto'); eq(v.sigAlg, '1.2.840.10045.4.3.2', 'ecdsa-with-SHA256');
    ok(/CN=Ada Device/.test(v.signer), v.signer);
    await p.waitForSelector('.sg-bar');
    const s = await sigs(p);
    eq([s[0].status, s[0].name, s[0].cert.key], ['valid', 'Ada Device', 'ECDSA P-256']);
    if (hasPdfsig) { const r = pdfsig(out); ok(/Signature is Valid/.test(r), r); }
    // the password was remembered (in memory): the next signing does not ask
    await p.evaluate(() => window.__cowdreyPdf.run('sgSign')); await p.waitForSelector('#dialog[open] #sgPlace');
    ok(await p.$eval('#sgPwRow', (e) => e.hidden), 'no password asked'); await p.click('#dialog .dlg-foot button:has-text("Cancel")');
    // stored as a PKCS#12 that OpenSSL reads with the same password
    const p12 = Buffer.from((await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('cowdrey.pdf-signing', 1); r.onsuccess = () => { const t = r.result.transaction('ids').objectStore('ids').getAll(); t.onsuccess = () => res(Array.from(t.result[0].p12)); }; }))));
    const f = path.join(tmp, 'made.p12'); fs.writeFileSync(f, p12);
    if (spawnSync('openssl', ['version']).status === 0) { const r = spawnSync('openssl', ['pkcs12', '-in', f, '-nokeys', '-passin', 'pass:abcd'], { encoding: 'utf8' }); ok(/subject=.*Ada Device/.test(r.stdout), r.stdout + r.stderr); }
    ok(!(await p.evaluate(() => JSON.stringify(localStorage))).includes('abcd'), 'the password is not stored');
    eq(p.errors, []); await p.ctx.close();
  });
  await test('certificate signing: signing IDs from OpenSSL (EC, legacy RC2-40, a chain with its CA); wrong passwords; delete', async () => {
    const p = await open(); await openPdf(p);
    const r1 = await p.evaluate((b) => window.__cowdreyPdf.sgOpenP12(b, 'wrong'), Array.from(fixture('sign-ec.p12')));
    eq(r1, { error: 'That password is not right for this signing ID.' });
    eq(await p.evaluate((b) => window.__cowdreyPdf.sgOpenP12(b, 'test'), Array.from(fixture('sign-ec.p12'))), { name: 'Test EC Signer', chain: 1, alg: 'ECDSA' });
    eq(await p.evaluate((b) => window.__cowdreyPdf.sgOpenP12(b, 'test'), Array.from(fixture('sign-legacy.p12'))), { name: 'Legacy Signer', chain: 1, alg: 'RSASSA-PKCS1-v1_5' });
    eq((await p.evaluate((b) => window.__cowdreyPdf.sgOpenP12(b, 'x'), Array.from(Buffer.from('not a p12')))).error, 'This file is not a signing ID (.p12 or .pfx).');
    // a chain: the certificate with the key signs, and both certificates go in the signature
    const chain = await importId(p, fixture('sign-chain.p12'), 'test');
    eq([chain.name, chain.chain], ['Chain Signer', 2]);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.evaluate((i) => window.__cowdreyPdf.sgSignNow({ id: i, password: 'test', page: 0, rect: [300, 640, 520, 700] }), chain.id)]);
    const out = fs.readFileSync(await dl.path());
    const v = nodeVerify(out, ranges(out)[0]);
    ok(v.digestOk && v.sigOk, 'valid'); eq(v.certs, 2); ok(/CN=Chain Signer/.test(v.signer), v.signer);
    await p.waitForSelector('.sg-bar');
    // trusting the CA trusts what it issued
    const ca = new crypto.X509Certificate(Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(fixture('sign-chain.p12').toString('binary')), 'test').getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag].find((b) => /Test CA/.test(b.cert.subject.getField('CN').value)).cert)).getBytes(), 'binary'));
    await p.evaluate((fp) => new Promise((res) => { const r = indexedDB.open('cowdrey.pdf-signing', 1); r.onsuccess = () => { const t = r.result.transaction('trust', 'readwrite'); t.objectStore('trust').put({ fp, name: 'CA' }); t.oncomplete = res; }; }), ca.fingerprint256.replace(/:/g, ''));
    await openBuf(p, out);
    eq((await sigs(p))[0].status, 'trusted');
    // the Signing IDs dialog lists it; delete
    await p.evaluate(() => window.__cowdreyPdf.run('sgIds')); await p.waitForSelector('#dialog[open] .sg-id');
    ok((await p.textContent('#dialog .sg-ids')).includes('Chain Signer') && (await p.textContent('#dialog .sg-ids')).includes('Cowdrey Test CA'), 'subject and issuer shown');
    await p.click('#dialog [data-sg-del]'); await p.waitForFunction(() => !document.querySelector('#dialog .sg-id'));
    await closeDialog(p);
    eq(await p.evaluate(() => window.__cowdreyPdf.sgIds()), []);
    eq(p.errors, []); await p.ctx.close();
  });
  await test('certificate signing: classic xref tables; PKCS #7; certify; a field from the Forms tab; protected PDFs refused', async () => {
    const p = await open(); await openPdf(p, path.join(root, 'tests/fixtures/chrome.pdf'), 'Summary.pdf');
    const id = await importId(p, RSA_P12, 'pw1234');
    const chrome = fixture('chrome.pdf');
    const { out } = await signUi(p, { password: 'pw1234', box: [72, 500, 300, 560], certify: 2, fmt: 'adbe.pkcs7.detached' });
    ok(out.subarray(0, chrome.length).equals(chrome), 'prefix');
    const tail = out.subarray(chrome.length).toString('latin1');
    ok(/\nxref\n0 1\n0000000000 65535 f\r\n/.test(tail) && /trailer\n<< \/Size \d+ \/Root/.test(tail) && !/\/Type \/XRef/.test(tail), 'a classic xref table and trailer, as the original has');
    ok(/\/SubFilter \/adbe\.pkcs7\.detached/.test(tail) && /\/TransformMethod \/DocMDP \/TransformParams << \/Type \/TransformParams \/P 2/.test(tail), 'PKCS #7, certified');
    const v = nodeVerify(out, ranges(out)[0]);
    ok(v.digestOk && v.sigOk && v.signedAttrs.includes('1.2.840.113549.1.9.5'), 'valid, with signingTime');
    if (hasPdfsig) { const r = pdfsig(out); ok(/Signature is Valid/.test(r), r); }
    const d = await L.PDFDocument.load(out);
    ok(d.catalog.lookup(L.PDFName.of('Perms'), L.PDFDict).get(L.PDFName.of('DocMDP')), 'catalog /Perms /DocMDP');
    const s = await sigs(p); eq([s[0].status, s[0].certify, s[0].subFilter], ['valid', 2, 'adbe.pkcs7.detached']);
    // certified with form filling only: a comment added later is not allowed
    const more = await appendComment(out);
    const vm = await p.evaluate(async (b) => window.__cowdreyPdf.sgVerify(b), Array.from(more));
    eq(vm[0].status, 'changed');
    // a signature field made on the Forms tab (the document then has changes: it is saved, then signed)
    await openPdf(p);
    await p.evaluate(() => { const D = window.__cowdreyPdf.doc; (D.marks['0:0'] ||= []).push({ id: 'sigf1', type: 'ff', kind: 'sig', x1: 300, y1: 640, x2: 500, y2: 690, rot: 0, name: 'Approver' }); });
    eq(await p.evaluate(() => window.__cowdreyPdf.sgEdits()), 'other');
    await p.evaluate(() => window.__cowdreyPdf.run('sgSign')); await p.waitForSelector('#dialog[open] #sgPlace');
    ok(await p.$('#sgPlace option[value="m:sigf1"]'), 'the new field is offered');
    await p.click('#dialog .dlg-foot button:has-text("Cancel")');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.evaluate(async (i) => { const ids = await window.__cowdreyPdf.sgIds(); return window.__cowdreyPdf.sgSignNow({ id: ids[0].id, password: 'pw1234', field: null, page: 0, rect: [300, 640, 500, 690], mark: true }); }, id.id)]);
    const viaBuild = fs.readFileSync(await dl.path());
    const vb = nodeVerify(viaBuild, ranges(viaBuild)[0]); ok(vb.digestOk && vb.sigOk, 'signs what was saved');
    // the forms package's hook is there
    eq(await p.evaluate(() => window.__cowdreyPdf.sgHasSigFieldHook()), true, 'FEATURE.onSigField is set');
    eq(p.errors, []); await p.ctx.close();
  });
  // A hybrid-reference file (a classic xref table whose trailer has /XRefStm, for an object kept in an object stream)
  function makeHybrid(buf) {
    const s = buf.toString('latin1'), last = +/startxref\s+(\d+)\s*%%EOF\s*$/.exec(s)[1];
    const size = +/\/Size (\d+)/.exec(s.slice(last))[1], root = /\/Root (\d+ \d+ R)/.exec(s.slice(last))[1];
    const os = size, inner = size + 1, xs = size + 2, parts = [buf, Buffer.from('\n')]; let pos = buf.length + 1; const offs = {};
    const add = (n, body) => { offs[n] = pos; const b = Buffer.concat([Buffer.from(`${n} 0 obj\n`), Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n')]); parts.push(b); pos += b.length; };
    const head = `${inner} 0 `, obj = '<< /Kept (in an object stream) >>';
    add(os, `<< /Type /ObjStm /N 1 /First ${head.length} /Length ${head.length + obj.length} >>\nstream\n${head}${obj}\nendstream`);
    offs[xs] = pos;
    const row = (t, a, b) => { const r = Buffer.alloc(7); r[0] = t; r.writeUInt32BE(a, 1); r.writeUInt16BE(b, 5); return r; };
    const rows = Buffer.concat([row(1, offs[os], 0), row(2, os, 0), row(1, offs[xs], 0)]);
    const xsHead = `${xs} 0 obj\n<< /Type /XRef /Size ${xs + 1} /W [1 4 2] /Index [${os} 3] /Root ${root} /Length ${rows.length} >>\nstream\n`;
    const xsObj = Buffer.concat([Buffer.from(xsHead), rows, Buffer.from('\nendstream\nendobj\n')]); parts.push(xsObj); pos += xsObj.length;
    const pad = (n) => String(n).padStart(10, '0');
    parts.push(Buffer.from(`xref\n0 1\n0000000000 65535 f\r\n${os} 1\n${pad(offs[os])} 00000 n\r\n${xs} 1\n${pad(offs[xs])} 00000 n\r\ntrailer\n<< /Size ${xs + 1} /Root ${root} /Prev ${last} /XRefStm ${offs[xs]} >>\nstartxref\n${pos}\n%%EOF\n`));
    return Buffer.concat(parts);
  }
  await test('certificate signing: a hybrid-reference file gets a classic xref section that points back at it', async () => {
    const hy = makeHybrid(fixture('chrome.pdf'));
    const p = await open(); await openBuf(p, hy, 'Hybrid.pdf');
    eq(await p.evaluate(() => window.__cowdreyPdf.sgEdits()), 'none');
    await importId(p, RSA_P12, 'pw1234');
    const { out } = await signUi(p, { password: 'pw1234', box: [72, 500, 300, 560] });
    ok(out.subarray(0, hy.length).equals(hy), 'prefix');
    const tail = out.subarray(hy.length).toString('latin1'), lastXref = +/startxref\s+(\d+)\s*%%EOF\s*$/.exec(hy.toString('latin1'))[1];
    ok(/\nxref\n/.test(tail) && tail.includes(`/Prev ${lastXref}`) && !tail.includes('/XRefStm'), tail.slice(-300));
    const v = nodeVerify(out, ranges(out)[0]); ok(v.digestOk && v.sigOk, 'valid');
    if (hasPdfsig) { const r = pdfsig(out); ok(/Signature is Valid/.test(r), r); }
    eq((await sigs(p))[0].status, 'valid');
    eq(p.errors, []); await p.ctx.close();
  });
  await test('certificate signing: an empty signature field in the PDF is signed in place, through the same incremental update', async () => {
    // a PDF with an empty signature field, as another app saves it
    const p = await open(); await openPdf(p);
    await p.evaluate(() => { const D = window.__cowdreyPdf.doc; (D.marks['0:0'] ||= []).push({ id: 'sigf2', type: 'ff', kind: 'sig', x1: 300, y1: 640, x2: 500, y2: 690, rot: 0, name: 'Client' }); });
    const withField = Buffer.from(await p.evaluate(async () => Array.from(await window.__cowdreyPdf.buildPdf())));
    await openBuf(p, withField, 'Contract.pdf');
    eq(await p.evaluate(() => window.__cowdreyPdf.sgEdits()), 'none');
    await importId(p, RSA_P12, 'pw1234');
    const { out } = await signUi(p, { password: 'pw1234', place: 'f:Client' });
    ok(out.subarray(0, withField.length).equals(withField), 'prefix');
    const { fields } = await sigFields(out);
    eq(fields, [{ name: 'Client', signed: true }]);
    const v = nodeVerify(out, ranges(out)[0]); ok(v.digestOk && v.sigOk);
    eq((await sigs(p))[0].field, 'Client');
    eq(p.errors, []); await p.ctx.close();
  });
  await test('certificate signing: a protected PDF is refused with a clear message', async () => {
    const p = await open();
    const opening = p.evaluate((b) => window.__cowdreyPdf.openBytes(new Uint8Array(b), 'Secret.pdf'), Array.from(fixture('protected.pdf')));
    await p.waitForSelector('#dialog[open] #dlgInput'); await p.fill('#dlgInput', 'pelican'); await p.click('#dialog .btn.primary');
    await opening; await p.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 15000 });
    await importId(p, RSA_P12, 'pw1234');
    await p.evaluate(() => window.__cowdreyPdf.run('sgSign'));
    await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('Remove the password before signing'));
    await p.ctx.close();
  });
  await test('certificate signing: the apps carry the signing libraries (desktop/dist loads them from ./vendor, offline)', async () => {
    const dist = path.join(root, 'desktop/dist');
    if (!fs.existsSync(path.join(dist, 'index.html')) || fs.statSync(path.join(dist, 'index.html')).mtimeMs < fs.statSync(path.join(root, 'index.html')).mtimeMs) execFileSync('node', [path.join(root, 'desktop/build.mjs')]);
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    for (const f of ['pkijs/build/index.es.js', 'asn1js/build/index.es.js', 'pvtsutils/build/index.es.js', 'pvutils/build/utils.es.js', 'node-forge/dist/forge.min.js']) {
      ok(html.includes('./vendor/' + f) && fs.existsSync(path.join(dist, 'vendor', f)), f);
    }
    ok(!/cdn\.jsdelivr\.net\/npm\/(pkijs|asn1js|pvtsutils|pvutils|node-forge)/.test(html), 'no CDN address left');
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2' };
    const srv = http.createServer((q, r) => { const rel = decodeURIComponent(q.url.split('?')[0]); const f = path.join(dist, rel === '/' ? 'index.html' : rel); if (!f.startsWith(dist) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); }).listen(0, '127.0.0.1');
    await new Promise((r) => srv.on('listening', r));
    const p = await open();
    const ctx = await p.ctx.browser().newContext(); const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await page.goto(`http://127.0.0.1:${srv.address().port}/`);
    await page.waitForFunction(() => window.__cowdreyPdf, null, { timeout: 15000 });
    eq(await page.evaluate(() => window.__cowdreyPdf.sgLoadLibs()), true);
    eq(errors, []);
    srv.close(); await ctx.close(); await p.ctx.close();
  });
  tsa.close();
};
