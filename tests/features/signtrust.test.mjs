// Certificate chains, revocation (OCSP and CRL, from local servers), P-384 and Ed25519, and how damage is reported
// (src/features/76-sign2-trust.js and 76-sign.js). The certificates are made with openssl; skipped without it.
// The full acceptance run, with external validators, is tests/conformance/pkg4.mjs.
import http from 'node:http'; import { spawnSync } from 'node:child_process'; import { createRequire } from 'node:module'; import crypto from 'node:crypto';

export default async (h) => {
  const { test, eq, ok, open, openPdf, fs, path, root } = h;
  if (spawnSync('openssl', ['version']).status !== 0) { await test('certificate chains and revocation: skipped (no openssl)', async () => {}); return; }
  const W = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'cowdrey-signtrust-'));
  const f = (n) => path.join(W, n), DAY = 86400000;
  const ossl = (...a) => { const r = spawnSync('openssl', a, { encoding: 'utf8', cwd: W }); if (r.status) throw new Error(a.slice(0, 2).join(' ') + ': ' + r.stderr); return r.stdout; };
  const ts14 = (d) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  // the OCSP server: 'ok' answers; 'replay' sends the answer it gave before (another nonce); 'stale' sends one without a
  // nonce whose nextUpdate has passed (re-signed by the issuer)
  let ocspMode = 'ok', lastOcsp = null, tsaN = 0;
  const NM = path.join(root, 'desktop/node_modules'), req = createRequire(path.join(root, 'tests/e2e.mjs'));
  const srv = http.createServer((rq, rs) => {
    const ch = []; rq.on('data', (c) => ch.push(c));
    rq.on('end', async () => {
      try {
        if (rq.url === '/ocsp') {
          if (ocspMode === 'replay' && lastOcsp) { rs.writeHead(200); return rs.end(lastOcsp); }
          fs.writeFileSync(f('q.der'), Buffer.concat(ch)); ossl('ocsp', '-index', f('ca/index.txt'), '-CA', f('inter.pem'), '-rsigner', f('inter.pem'), '-rkey', f('inter.key'), '-reqin', f('q.der'), '-respout', f('r.der'), '-nmin', '5');
          let out = fs.readFileSync(f('r.der')); lastOcsp = out;
          if (ocspMode === 'stale') out = await staleOcsp(out);
          rs.writeHead(200); return rs.end(out);
        }
        if (rq.url === '/tsa') { fs.writeFileSync(f('t.tsq'), Buffer.concat(ch)); ossl('ts', '-reply', '-config', f('tsa.cnf'), '-queryfile', f('t.tsq'), '-out', f('t.tsr')); tsaN++; rs.writeHead(200, { 'content-type': 'application/timestamp-reply' }); return rs.end(fs.readFileSync(f('t.tsr'))); }
        if (rq.url === '/inter.crl') { ossl('ca', '-config', f('ca/ca.cnf'), '-gencrl', '-out', f('crl.pem')); ossl('crl', '-in', f('crl.pem'), '-outform', 'DER', '-out', f('crl.der')); rs.writeHead(200); return rs.end(fs.readFileSync(f('crl.der'))); }
        rs.writeHead(404); rs.end();
      } catch (e) { rs.writeHead(500); rs.end(e.message); }
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  const staleOcsp = async (der) => {
    const pkijs = req(path.join(NM, 'pkijs')), asn1js = req(path.join(NM, 'asn1js'));
    pkijs.setEngine('node', new pkijs.CryptoEngine({ name: 'node', crypto: crypto.webcrypto }));
    const resp = pkijs.OCSPResponse.fromBER(new Uint8Array(der).buffer), basic = pkijs.BasicOCSPResponse.fromBER(resp.responseBytes.response.valueBlock.valueHexView);
    const one = basic.tbsResponseData.responses[0]; one.thisUpdate = new Date(Date.now() - 10 * DAY); one.nextUpdate = new Date(Date.now() - 3 * DAY);
    delete basic.tbsResponseData.responseExtensions;
    const pem = fs.readFileSync(f('inter.key'), 'utf8').replace(/-----[^-]+-----|\s+/g, '');
    const key = await crypto.webcrypto.subtle.importKey('pkcs8', Buffer.from(pem, 'base64'), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    await basic.sign(key, 'SHA-256');
    resp.responseBytes.response = new asn1js.OctetString({ valueHex: basic.toSchema().toBER(false) });
    return Buffer.from(resp.toSchema().toBER(false));
  };
  const BASE = `http://127.0.0.1:${srv.address().port}`;
  fs.writeFileSync(f('req.cnf'), '[ req ]\ndistinguished_name = dn\nprompt = no\n[ dn ]\nCN = x\n[ v3_root ]\nbasicConstraints = critical,CA:TRUE\nkeyUsage = critical,keyCertSign,cRLSign,digitalSignature\nsubjectKeyIdentifier = hash\n');
  const key = (n, a) => ossl('genpkey', ...a, '-out', f(n + '.key'));
  const self = (n, cn, a, md = ['-sha256']) => { key(n, a); ossl('req', '-x509', '-new', '-config', f('req.cnf'), '-extensions', 'v3_root', '-key', f(n + '.key'), ...md, '-days', '365', '-subj', `/CN=${cn}`, '-out', f(n + '.pem')); };
  const RSA = ['-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048'];
  self('root', 'Trust Test Root', RSA);
  // a timestamp authority of its own (self-signed, for timestamps), not trusted until a test trusts it
  fs.appendFileSync(f('req.cnf'), '[ v3_tsa ]\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature\nextendedKeyUsage = critical,timeStamping\n');
  key('tsa', RSA); ossl('req', '-x509', '-new', '-config', f('req.cnf'), '-extensions', 'v3_tsa', '-key', f('tsa.key'), '-sha256', '-days', '365', '-subj', '/CN=Trust Test TSA', '-out', f('tsa.pem'));
  fs.writeFileSync(f('tsa-serial'), '01\n');
  fs.writeFileSync(f('tsa.cnf'), `[ tsa ]\ndefault_tsa = t\n[ t ]\nserial = ${f('tsa-serial')}\ncrypto_device = builtin\nsigner_cert = ${f('tsa.pem')}\ncerts = ${f('tsa.pem')}\nsigner_key = ${f('tsa.key')}\nsigner_digest = sha256\ndefault_policy = 1.2.3.4.1\ndigests = sha256, sha384, sha512\naccuracy = secs:1\nordering = no\ntsa_name = yes\ness_cert_id_alg = sha256\n`);
  const ca = (dir, cert) => {
    fs.mkdirSync(f(dir + '/new'), { recursive: true }); fs.writeFileSync(f(dir + '/index.txt'), ''); fs.writeFileSync(f(dir + '/serial'), '1000\n'); fs.writeFileSync(f(dir + '/crlnumber'), '01\n');
    fs.writeFileSync(f(dir + '/ca.cnf'), `[ ca ]\ndefault_ca = d\n[ d ]\ndir = ${f(dir)}\ndatabase = $dir/index.txt\nnew_certs_dir = $dir/new\nserial = $dir/serial\ncrlnumber = $dir/crlnumber\ncertificate = ${f(cert + '.pem')}\nprivate_key = ${f(cert + '.key')}\ndefault_md = sha256\npolicy = p\nunique_subject = no\ndefault_crl_days = 30\n[ p ]\ncommonName = supplied\n[ ca_ext ]\nbasicConstraints = critical,CA:TRUE\nkeyUsage = critical,keyCertSign,cRLSign\n[ leaf ]\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature,nonRepudiation\nauthorityInfoAccess = OCSP;URI:${BASE}/ocsp\ncrlDistributionPoints = URI:${BASE}/inter.crl\n[ crlonly ]\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature\ncrlDistributionPoints = URI:${BASE}/inter.crl\n`);
  };
  const issue = (dir, n, cn, ext, from, to) => { key(n, RSA); ossl('req', '-new', '-config', f('req.cnf'), '-key', f(n + '.key'), '-subj', `/CN=${cn}`, '-out', f(n + '.csr')); ossl('ca', '-batch', '-notext', '-config', f(dir + '/ca.cnf'), '-in', f(n + '.csr'), '-out', f(n + '.pem'), '-extensions', ext, '-startdate', ts14(from), '-enddate', ts14(to)); };
  const now = Date.now();
  ca('rootca', 'root');
  issue('rootca', 'inter', 'Trust Test Intermediate', 'ca_ext', new Date(now - 10 * DAY), new Date(now + 900 * DAY));
  issue('rootca', 'old', 'Trust Test Expired CA', 'ca_ext', new Date(now - 90 * DAY), new Date(now - DAY));
  ca('ca', 'inter'); ca('oldca', 'old');
  issue('ca', 'leaf', 'Trust Test Signer', 'leaf', new Date(now - DAY), new Date(now + 300 * DAY));
  issue('ca', 'gone', 'Trust Test Revoked', 'leaf', new Date(now - DAY), new Date(now + 300 * DAY));
  issue('ca', 'gonecrl', 'Trust Test Revoked CRL', 'crlonly', new Date(now - DAY), new Date(now + 300 * DAY));
  issue('ca', 'late', 'Trust Test Revoked Later', 'leaf', new Date(now - DAY), new Date(now + 300 * DAY));
  issue('ca', 'replay', 'Trust Test Replayed', 'leaf', new Date(now - DAY), new Date(now + 300 * DAY));
  issue('ca', 'turn', 'Trust Test Revoked Meanwhile', 'leaf', new Date(now - DAY), new Date(now + 300 * DAY));
  issue('ca', 'droid', 'Trust Test Android Signer', 'leaf', new Date(now - DAY), new Date(now + 300 * DAY));
  issue('oldca', 'under', 'Trust Test Under Expired', 'crlonly', new Date(now - 30 * DAY), new Date(now + 300 * DAY));
  ossl('ca', '-config', f('ca/ca.cnf'), '-revoke', f('gone.pem'), '-crl_reason', 'keyCompromise');
  ossl('ca', '-config', f('ca/ca.cnf'), '-revoke', f('gonecrl.pem'), '-crl_reason', 'superseded');
  self('p384', 'Trust Test P-384', ['-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-384'], ['-sha384']);
  self('ed', 'Trust Test Ed25519', ['-algorithm', 'ED25519'], []);
  const p12 = (n, chain) => { const extra = chain ? ['-certfile', chain] : []; ossl('pkcs12', '-export', '-inkey', f(n + '.key'), '-in', f(n + '.pem'), ...extra, '-passout', 'pass:pw', '-out', f(n + '.p12')); return fs.readFileSync(f(n + '.p12')); };
  fs.writeFileSync(f('chain.pem'), fs.readFileSync(f('inter.pem'), 'utf8') + fs.readFileSync(f('root.pem'), 'utf8'));
  fs.writeFileSync(f('oldchain.pem'), fs.readFileSync(f('old.pem'), 'utf8') + fs.readFileSync(f('root.pem'), 'utf8'));
  const IDS = { leaf: p12('leaf', f('chain.pem')), gone: p12('gone', f('chain.pem')), gonecrl: p12('gonecrl', f('chain.pem')), late: p12('late', f('chain.pem')), replay: p12('replay', f('chain.pem')), turn: p12('turn', f('chain.pem')), droid: p12('droid', f('chain.pem')), under: p12('under', f('oldchain.pem')), p384: p12('p384'), ed: p12('ed') };

  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
  const route = (p) => p.ctx.route(BASE + '/**', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const res = await fetch(r.request().url(), { method: r.request().method(), body: r.request().postDataBuffer() || undefined });
    return r.fulfill({ status: res.status, headers: cors, body: Buffer.from(await res.arrayBuffer()) });
  });
  const sign = async (p, name, o = {}) => {
    const id = await p.evaluate(([b]) => window.__cowdreyPdf.sgImportId(b, 'pw'), [Array.from(IDS[name])]);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.evaluate(([i, o]) => window.__cowdreyPdf.sgSignNow({ id: i.id, password: 'pw', page: 0, rect: [300, 640, 520, 700], o }), [id, o])]);
    await p.waitForFunction(() => window.__lastSignedShown && document.querySelector('.sg-bar'));
    return fs.readFileSync(await dl.path());
  };
  const details = (p, buf, o) => p.evaluate(([b, x]) => window.__cowdreyPdf.sgDetails(b, x), [Array.from(buf), o || {}]);

  await test('certificate chains: root → intermediate → signer walks to a root trusted from a file; untrusted until then', async () => {
    const p = await open(); await route(p); await openPdf(p);
    const out = await sign(p, 'leaf');
    let [s] = await details(p, out);
    eq([s.status, s.chain.certs.map((c) => c.name), s.chain.complete, s.trusted], ['valid', ['Trust Test Signer', 'Trust Test Intermediate', 'Trust Test Root'], true, false]);
    ok(s.notes.some((n) => /The chain ends at “Trust Test Root”, which is not trusted on this device/.test(n)), s.notes.join(' | '));
    eq(await p.evaluate((b) => window.__cowdreyPdf.sgTrustImport(b), Array.from(fs.readFileSync(f('root.pem')))), 1);
    [s] = await details(p, out);
    eq([s.status, s.chain.certs.map((c) => c.issuer.split(',')[0])], ['trusted', ['Trust Test Intermediate', 'Trust Test Root', 'Trust Test Root']]);
    // the panel lists every certificate with its issuer and expiry
    await p.evaluate(() => window.__cowdreyPdf.run('sgPanel')); await p.waitForSelector('#dialog[open] .sg-chain');
    const t = await p.textContent('#dialog .sg-chain');
    ok(['Signer: Trust Test Signer', 'Issuer: Trust Test Intermediate', 'Root: Trust Test Root', 'Expires'].every((w) => t.includes(w)), t);
    eq(p.errors, []); await p.ctx.close();
  });
  await test('certificate chains: an intermediate that had expired when signing makes the signature invalid, with the reason', async () => {
    const p = await open(); await route(p); await openPdf(p);
    await p.evaluate((b) => window.__cowdreyPdf.sgTrustImport(b), Array.from(fs.readFileSync(f('root.pem'))));
    const [s] = await details(p, await sign(p, 'under'));
    eq([s.status, s.problem, s.chain.certs[0].at, s.chain.certs[1].at], ['invalid', 'cert', 'ok', 'expired']);
    ok(/“Trust Test Expired CA”, which vouches for the signer’s, had expired when this was signed/.test(s.notes.join(' ')), s.notes.join(' | '));
    eq(p.errors, []); await p.ctx.close();
  });
  await test('revocation: only when asked; OCSP says revoked, the CRL says revoked, a good certificate is not revoked', async () => {
    const p = await open(); await route(p); await openPdf(p);
    let hits = 0; p.on('request', (r) => { if (r.url().startsWith(BASE)) hits++; });
    const good = await sign(p, 'leaf'); await openPdf(p);
    const gone = await sign(p, 'gone'); await openPdf(p);
    const gonecrl = await sign(p, 'gonecrl');
    eq([(await details(p, gone))[0].rev, hits], [null, 0], 'nothing asked unless asked');
    const [a] = await details(p, good, { revocation: true }), [b] = await details(p, gone, { revocation: true }), [c] = await details(p, gonecrl, { revocation: true });
    eq([a.status, a.rev.verdict, a.rev.items[0].via], ['valid', 'good', 'OCSP']);
    eq([b.status, b.rev.verdict, b.rev.items[0].via, b.rev.items[0].reason], ['revoked', 'revoked', 'OCSP', 'key compromise']);
    eq([c.status, c.rev.items[0].via, c.rev.items[0].reason], ['revoked', 'CRL', 'superseded']);
    // the panel's button asks, and says which servers
    await p.evaluate(() => window.__cowdreyPdf.run('sgPanel')); await p.waitForSelector('#dialog[open] [data-sg-rev]');
    ok((await p.textContent('#dialog')).includes(`Asks 127.0.0.1:${srv.address().port} whether a certificate was revoked`), await p.textContent('#dialog'));
    await p.click('#dialog [data-sg-rev]'); await p.waitForFunction(() => /Revoked: “Trust Test Revoked CRL” was revoked/.test(document.querySelector('#dialog .sg-list').textContent));
    eq(p.errors, []); await p.ctx.close();
  });
  await test('revocation: each check asks again, so a certificate revoked since the last check shows as revoked', async () => {
    const p = await open(); await route(p); await openPdf(p);
    let hits = 0; p.on('request', (r) => { if (r.url().startsWith(BASE + '/ocsp')) hits++; });
    const first = await sign(p, 'turn');
    const [a] = await details(p, first, { revocation: true });
    eq([a.status, a.rev.verdict, hits], ['valid', 'good', 1]);
    ok(/Not revoked: .* As of /.test(a.rev.text), a.rev.text);
    ossl('ca', '-config', f('ca/ca.cnf'), '-revoke', f('turn.pem'), '-crl_reason', 'keyCompromise');
    // the same file, checked again in the same session: asked again, now revoked
    const [b] = await details(p, first, { revocation: true });
    eq([b.status, b.rev.verdict, hits], ['revoked', 'revoked', 2]);
    ok(+new Date(b.rev.checkedAt) >= +new Date(a.rev.checkedAt), 'when it was checked');
    // a new signature with the now revoked certificate, checked from the panel's button
    await openPdf(p); await sign(p, 'turn');
    await p.evaluate(() => window.__cowdreyPdf.run('sgPanel')); await p.waitForSelector('#dialog[open] [data-sg-rev]');
    await p.click('#dialog [data-sg-rev]'); await p.waitForFunction(() => /Revoked: “Trust Test Revoked Meanwhile” was revoked/.test(document.querySelector('#dialog .sg-list').textContent));
    eq(hits, 3, 'the button asked the server');
    ok(/Check revocation again/.test(await p.textContent('#dialog .sg-list')), 'it can be checked again');
    eq(p.errors, []); await p.ctx.close();
  });
  await test('revocation in the Android app: asked through the app (pki_fetch), never with the web view\'s fetch; asked again after a revocation', async () => {
    // signed on the web, then checked in a pretend Android app whose pki_fetch is answered from here (as Android's
    // own network stack would): the servers send no CORS headers, so a fetch from the page could not have worked
    const w = await open(); await route(w); await openPdf(w);
    const out = await sign(w, 'droid'); await w.ctx.close();
    const UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36';
    const p = await open({ width: 412, height: 915, touch: true, ua: UA, init: () => {
      window.__pkiCalls = [];
      window.__TAURI__ = {
        core: { invoke: async (c, a) => {
          if (c === 'pki_fetch') { window.__pkiCalls.push(a); return window.__pkiFetch(a); }
          if (c === 'take_opened_files') return [];
          if (c === 'plugin:sharekit|native') return a.method === 'insets' ? { top: 0, bottom: 0, left: 0, right: 0, keyboard: 0 } : {};
          return null;
        } },
        fs: {}, dialog: {}, event: { listen: async () => {} }, opener: { openUrl: async () => {} },
      };
    } });
    const asked = [];
    await p.exposeFunction('__pkiFetch', async ({ url, body, contentType }) => {
      asked.push([body ? 'POST' : 'GET', new URL(url).pathname, contentType]);
      const r = await fetch(url, { method: body ? 'POST' : 'GET', ...(body ? { headers: { 'content-type': contentType }, body: Buffer.from(body, 'base64') } : {}) });
      if (!r.ok) throw new Error('error ' + r.status);
      return Buffer.from(await r.arrayBuffer()).toString('base64');
    });
    let direct = 0; p.on('request', (r) => { if (r.url().startsWith(BASE)) direct++; });
    await openPdf(p);
    ok(await p.evaluate(() => /Android/.test(navigator.userAgent) && !!window.__TAURI__), 'the pretend Android app');
    const [a] = await details(p, out, { revocation: true });
    eq([a.status, a.rev.verdict, a.rev.items[0].via], ['valid', 'good', 'OCSP']);
    ok(/Not revoked: “Trust Test Android Signer” \(OCSP from 127\.0\.0\.1:/.test(a.rev.text), a.rev.text);
    ossl('ca', '-config', f('ca/ca.cnf'), '-revoke', f('droid.pem'), '-crl_reason', 'keyCompromise');
    const [b] = await details(p, out, { revocation: true });
    eq([b.status, b.rev.verdict, b.rev.items[0].reason], ['revoked', 'revoked', 'key compromise']);
    eq(asked, [['POST', '/ocsp', 'application/ocsp-request'], ['POST', '/ocsp', 'application/ocsp-request']], 'one OCSP request per check, through the app');
    const calls = await p.evaluate(() => window.__pkiCalls.map((c) => [c.url.replace(/:\d+/, ''), typeof c.body, c.contentType]));
    eq(calls, [['http://127.0.0.1/ocsp', 'string', 'application/ocsp-request'], ['http://127.0.0.1/ocsp', 'string', 'application/ocsp-request']]);
    eq(direct, 0, 'no request from the web view itself');
    eq(p.errors, []); await p.ctx.close();
  });
  await test('revocation: an old OCSP answer (another nonce, or out of date) is not taken; the CRL is asked instead', async () => {
    const p = await open(); await route(p); await openPdf(p);
    const good = await sign(p, 'leaf'); await openPdf(p);
    const later = await sign(p, 'replay');
   
    ocspMode = 'ok'; const [g0] = await details(p, later, { revocation: true }); // the "good" answer a replay sends
    eq([g0.status, g0.rev.verdict, g0.rev.items[0].via], ['valid', 'good', 'OCSP']);
    ossl('ca', '-config', f('ca/ca.cnf'), '-revoke', f('replay.pem'), '-crl_reason', 'keyCompromise');
    ocspMode = 'replay';
    const [g] = await details(p, later, { revocation: true });
    eq([g.status, g.rev.items[0].via], ['revoked', 'CRL'], 'a replayed "good" answer is not taken');
    ocspMode = 'stale';
    const [a] = await details(p, good, { revocation: true });
    eq([a.status, a.rev.verdict, a.rev.items[0].via], ['valid', 'good', 'CRL'], 'an out-of-date answer is not taken');
    ocspMode = 'ok';
    eq(p.errors, []); await p.ctx.close();
  });
  await test('timestamps: the time is relied on only when the timestamp authority is trusted (revoked after the timestamp)', async () => {
    const p = await open(); await route(p); await openPdf(p);
    await p.evaluate((b) => window.__cowdreyPdf.sgTrustImport(b), Array.from(fs.readFileSync(f('root.pem'))));
    const n0 = tsaN, out = await sign(p, 'late', { tsa: BASE + '/tsa' });
    eq(tsaN, n0 + 1, 'one timestamp asked for');
    await new Promise((r) => setTimeout(r, 1500));
    ossl('ca', '-config', f('ca/ca.cnf'), '-revoke', f('late.pem'), '-crl_reason', 'keyCompromise');
   
    let [s] = await details(p, out, { revocation: true });
    eq([s.status, s.rev.verdict, s.ts.ok, s.ts.trusted, s.checks.find((k) => k[0] === 'Timestamp')[1]], ['revoked', 'revoked', true, false, 'warn'], 'an untrusted timestamp does not settle when it was signed');
    ok(/Not relied on, timestamp authority not trusted/.test(s.checks.find((k) => k[0] === 'Timestamp')[2]), s.checks.join(' | '));
    // trusted from the panel's timestamp details
    await p.evaluate(() => window.__cowdreyPdf.run('sgPanel')); await p.waitForSelector('#dialog[open] .sg-tsd');
    await p.click('#dialog .sg-tsd summary'); await p.click('#dialog [data-sg-trustts]');
    await p.waitForFunction(() => /Stop trusting this timestamp authority/.test(document.querySelector('#dialog .sg-list').textContent));
   
    [s] = await details(p, out, { revocation: true });
    eq([s.status, s.rev.verdict, s.ts.trusted, s.checks.find((k) => k[0] === 'Timestamp')[1], s.when], ['trusted', 'revokedAfter', true, 'ok', s.ts.time]);
    ok(/after the timestamp/.test(s.rev.text), s.rev.text);
    eq(p.errors, []); await p.ctx.close();
  });
  await test('certificate signing: a file cut short before its signature’s byte range is reported incomplete, not unsigned', async () => {
    const p = await open(); await openPdf(p);
    const out = await sign(p, 'leaf'), s = out.toString('latin1');
    // cut inside the signature dictionary, before /ByteRange, and with the whole dictionary gone
    const br = s.lastIndexOf('/ByteRange'), cs = s.lastIndexOf('/Contents <'), obj = s.lastIndexOf(' obj', Math.min(br, cs));
    for (const at of [Math.min(br, cs) + 40, obj - 5]) {
      const v = await details(p, out.subarray(0, at));
      eq(v.map((x) => [x.status, x.problem]), [['invalid', 'incomplete']], 'cut at ' + at + ' of ' + out.length);
    }
    // opened, the bar says so
    await p.evaluate(async (b) => { await window.__cowdreyPdf.openBytes(new Uint8Array(b), 'cut.pdf'); }, Array.from(out.subarray(0, Math.min(br, cs) + 40)));
    eq((await p.evaluate(() => window.__cowdreyPdf.sgSignatures())).map((x) => x.problem), ['incomplete']);
    eq(p.errors, []); await p.ctx.close();
  });
  await test('certificate signing: ECDSA P-384 (SHA-384) and Ed25519 signing IDs from OpenSSL sign and verify', async () => {
    const p = await open(); await openPdf(p);
    const [x] = await details(p, await sign(p, 'p384')); await openPdf(p);
    const [y] = await details(p, await sign(p, 'ed'));
    eq([x.status, x.alg, x.cert.key], ['valid', 'ECDSA with SHA-384', 'ECDSA P-384']);
    eq([y.status, y.alg, y.cert.key], ['valid', 'Ed25519', 'Ed25519']);
    eq(p.errors, []); await p.ctx.close();
  });
  await test('certificate signing: damage is told apart: the signed content, the signature object, a file cut short', async () => {
    const p = await open(); await openPdf(p);
    const out = await sign(p, 'p384');
    const s = out.toString('latin1'), m = /\/ByteRange\s*\[\s*0\s+(\d+)\s+(\d+)/.exec(s), b = +m[1];
    const content = Buffer.from(out); content[s.indexOf('stream', 200) + 9] ^= 1;
    const sigobj = Buffer.from(out); const hex = out.subarray(b + 1, +m[2] - 1).toString('latin1').replace(/0+$/, ''); const at = b + 1 + hex.length - 10; sigobj[at] = sigobj[at] === 0x41 ? 0x42 : 0x41;
    const cut = out.subarray(0, out.length - 200);
    const [c] = await details(p, content), [g] = await details(p, sigobj), [t] = await details(p, cut);
    eq([c.problem, c.statusText, c.checks.find((k) => k[0] === 'Certificate')[1]], ['tampered', 'Invalid: the document was changed after signing', 'bad']);
    eq([g.problem, g.statusText, g.digestOk], ['sigobject', 'Invalid: the signature itself is damaged', true]);
    eq([t.problem, t.statusText], ['incomplete', 'Invalid: the file is incomplete']);
    eq(p.errors, []); await p.ctx.close();
  });
  await test('certificate signing: sign, add a comment, sign again: the comment is an incremental update and the first signature stays valid', async () => {
    const p = await open(); await openPdf(p);
    const first = await sign(p, 'p384');
    await p.evaluate(() => { const D = window.__cowdreyPdf.doc; (D.marks['0:0'] ||= []).push({ id: 'n1', type: 'note', x: 100, y: 300, text: 'Looks right' }); });
    const keep = Buffer.from(await p.evaluate(() => window.__cowdreyPdf.sgKeepBytes()));
    ok(keep.length > first.length && keep.subarray(0, first.length).equals(first), 'the signed file is a prefix');
    const out = await sign(p, 'ed');
    ok(out.subarray(0, first.length).equals(first), 'still a prefix after the second signature');
    const v = await details(p, out);
    eq(v.map((x) => [x.status, x.changes && x.changes.comments, x.changes && x.changes.other]), [['valid', true, false], ['valid', null, null]]);
    eq(p.errors, []); await p.ctx.close();
  });
  srv.close();
  fs.rmSync(W, { recursive: true, force: true });
};
