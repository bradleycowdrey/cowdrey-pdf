// Certificate chains, revocation (OCSP and CRL, from local servers), P-384 and Ed25519, and how damage is reported
// (src/features/76-sign2-trust.js and 76-sign.js). The certificates are made with openssl; skipped without it.
// The full acceptance run, with external validators, is tests/conformance/pkg4.mjs.
import http from 'node:http'; import { spawnSync } from 'node:child_process';

export default async (h) => {
  const { test, eq, ok, open, openPdf, fs, path } = h;
  if (spawnSync('openssl', ['version']).status !== 0) { await test('certificate chains and revocation: skipped (no openssl)', async () => {}); return; }
  const W = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'cowdrey-signtrust-'));
  const f = (n) => path.join(W, n), DAY = 86400000;
  const ossl = (...a) => { const r = spawnSync('openssl', a, { encoding: 'utf8', cwd: W }); if (r.status) throw new Error(a.slice(0, 2).join(' ') + ': ' + r.stderr); return r.stdout; };
  const ts14 = (d) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  const srv = http.createServer((rq, rs) => {
    const ch = []; rq.on('data', (c) => ch.push(c));
    rq.on('end', () => {
      try {
        if (rq.url === '/ocsp') { fs.writeFileSync(f('q.der'), Buffer.concat(ch)); ossl('ocsp', '-index', f('ca/index.txt'), '-CA', f('inter.pem'), '-rsigner', f('inter.pem'), '-rkey', f('inter.key'), '-reqin', f('q.der'), '-respout', f('r.der'), '-nmin', '5'); rs.writeHead(200); return rs.end(fs.readFileSync(f('r.der'))); }
        if (rq.url === '/inter.crl') { ossl('ca', '-config', f('ca/ca.cnf'), '-gencrl', '-out', f('crl.pem')); ossl('crl', '-in', f('crl.pem'), '-outform', 'DER', '-out', f('crl.der')); rs.writeHead(200); return rs.end(fs.readFileSync(f('crl.der'))); }
        rs.writeHead(404); rs.end();
      } catch (e) { rs.writeHead(500); rs.end(e.message); }
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  const BASE = `http://127.0.0.1:${srv.address().port}`;
  fs.writeFileSync(f('req.cnf'), '[ req ]\ndistinguished_name = dn\nprompt = no\n[ dn ]\nCN = x\n[ v3_root ]\nbasicConstraints = critical,CA:TRUE\nkeyUsage = critical,keyCertSign,cRLSign,digitalSignature\nsubjectKeyIdentifier = hash\n');
  const key = (n, a) => ossl('genpkey', ...a, '-out', f(n + '.key'));
  const self = (n, cn, a, md = ['-sha256']) => { key(n, a); ossl('req', '-x509', '-new', '-config', f('req.cnf'), '-extensions', 'v3_root', '-key', f(n + '.key'), ...md, '-days', '365', '-subj', `/CN=${cn}`, '-out', f(n + '.pem')); };
  const RSA = ['-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048'];
  self('root', 'Trust Test Root', RSA);
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
  issue('oldca', 'under', 'Trust Test Under Expired', 'crlonly', new Date(now - 30 * DAY), new Date(now + 300 * DAY));
  ossl('ca', '-config', f('ca/ca.cnf'), '-revoke', f('gone.pem'), '-crl_reason', 'keyCompromise');
  ossl('ca', '-config', f('ca/ca.cnf'), '-revoke', f('gonecrl.pem'), '-crl_reason', 'superseded');
  self('p384', 'Trust Test P-384', ['-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-384'], ['-sha384']);
  self('ed', 'Trust Test Ed25519', ['-algorithm', 'ED25519'], []);
  const p12 = (n, chain) => { const extra = chain ? ['-certfile', chain] : []; ossl('pkcs12', '-export', '-inkey', f(n + '.key'), '-in', f(n + '.pem'), ...extra, '-passout', 'pass:pw', '-out', f(n + '.p12')); return fs.readFileSync(f(n + '.p12')); };
  fs.writeFileSync(f('chain.pem'), fs.readFileSync(f('inter.pem'), 'utf8') + fs.readFileSync(f('root.pem'), 'utf8'));
  fs.writeFileSync(f('oldchain.pem'), fs.readFileSync(f('old.pem'), 'utf8') + fs.readFileSync(f('root.pem'), 'utf8'));
  const IDS = { leaf: p12('leaf', f('chain.pem')), gone: p12('gone', f('chain.pem')), gonecrl: p12('gonecrl', f('chain.pem')), under: p12('under', f('oldchain.pem')), p384: p12('p384'), ed: p12('ed') };

  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
  const route = (p) => p.ctx.route(BASE + '/**', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const res = await fetch(r.request().url(), { method: r.request().method(), body: r.request().postDataBuffer() || undefined });
    return r.fulfill({ status: res.status, headers: cors, body: Buffer.from(await res.arrayBuffer()) });
  });
  const sign = async (p, name) => {
    const id = await p.evaluate(([b]) => window.__cowdreyPdf.sgImportId(b, 'pw'), [Array.from(IDS[name])]);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.evaluate((i) => window.__cowdreyPdf.sgSignNow({ id: i.id, password: 'pw', page: 0, rect: [300, 640, 520, 700] }), id)]);
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
