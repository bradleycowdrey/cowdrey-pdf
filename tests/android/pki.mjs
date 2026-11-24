// A small certificate authority for the device test's revocation scenario (tests/android/run.mjs), made with openssl on
// the machine that runs the emulator: a root, an intermediate and a signer whose certificate names an OCSP responder
// (openssl ocsp, run here) and a revocation list (a tiny http server here, a new list on each request). Both listen on
// this machine; the emulator reaches it at 10.0.2.2. Plain http, as most real OCSP and CRL servers are.
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// dir: an empty folder for the files; host: how the device names this machine (10.0.2.2 from the emulator)
export async function startPki(dir, host = '10.0.2.2') {
  fs.mkdirSync(dir, { recursive: true });
  const f = (n) => path.join(dir, n), DAY = 86400000, now = Date.now();
  const ossl = (...a) => { const r = spawnSync('openssl', a, { encoding: 'utf8', cwd: dir }); if (r.status) throw new Error('openssl ' + a.slice(0, 2).join(' ') + ': ' + r.stderr); return r.stdout; };
  const ts14 = (d) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  const ocspPort = await freePort();
  let crlHits = 0;
  const crl = http.createServer((rq, rs) => {
    if (rq.url !== '/inter.crl') { rs.writeHead(404); return rs.end(); }
    try {
      crlHits++;
      ossl('ca', '-config', f('ca/ca.cnf'), '-gencrl', '-out', f('crl.pem')); ossl('crl', '-in', f('crl.pem'), '-outform', 'DER', '-out', f('crl.der'));
      rs.writeHead(200, { 'content-type': 'application/pkix-crl' }); rs.end(fs.readFileSync(f('crl.der')));
    } catch (e) { rs.writeHead(500); rs.end(e.message); }
  });
  await new Promise((r) => crl.listen(0, '127.0.0.1', r));
  const crlPort = crl.address().port;
  const OCSP = `http://${host}:${ocspPort}/`, CRL = `http://${host}:${crlPort}/inter.crl`;

  fs.writeFileSync(f('req.cnf'), '[ req ]\ndistinguished_name = dn\nprompt = no\n[ dn ]\nCN = x\n[ v3_root ]\nbasicConstraints = critical,CA:TRUE\nkeyUsage = critical,keyCertSign,cRLSign,digitalSignature\nsubjectKeyIdentifier = hash\n');
  const RSA = ['-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048'];
  const key = (n) => ossl('genpkey', ...RSA, '-out', f(n + '.key'));
  key('root'); ossl('req', '-x509', '-new', '-config', f('req.cnf'), '-extensions', 'v3_root', '-key', f('root.key'), '-sha256', '-days', '365', '-subj', '/CN=Device Test Root', '-out', f('root.pem'));
  const ca = (d, cert) => {
    fs.mkdirSync(f(d + '/new'), { recursive: true }); fs.writeFileSync(f(d + '/index.txt'), ''); fs.writeFileSync(f(d + '/serial'), '1000\n'); fs.writeFileSync(f(d + '/crlnumber'), '01\n');
    fs.writeFileSync(f(d + '/ca.cnf'), `[ ca ]\ndefault_ca = d\n[ d ]\ndir = ${f(d)}\ndatabase = $dir/index.txt\nnew_certs_dir = $dir/new\nserial = $dir/serial\ncrlnumber = $dir/crlnumber\ncertificate = ${f(cert + '.pem')}\nprivate_key = ${f(cert + '.key')}\ndefault_md = sha256\npolicy = p\nunique_subject = no\ndefault_crl_days = 30\n[ p ]\ncommonName = supplied\n[ ca_ext ]\nbasicConstraints = critical,CA:TRUE\nkeyUsage = critical,keyCertSign,cRLSign\n[ leaf ]\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature,nonRepudiation\nauthorityInfoAccess = OCSP;URI:${OCSP}\ncrlDistributionPoints = URI:${CRL}\n`);
  };
  const issue = (d, n, cn, ext) => { key(n); ossl('req', '-new', '-config', f('req.cnf'), '-key', f(n + '.key'), '-subj', `/CN=${cn}`, '-out', f(n + '.csr')); ossl('ca', '-batch', '-notext', '-config', f(d + '/ca.cnf'), '-in', f(n + '.csr'), '-out', f(n + '.pem'), '-extensions', ext, '-startdate', ts14(new Date(now - DAY)), '-enddate', ts14(new Date(now + 300 * DAY))); };
  ca('rootca', 'root'); issue('rootca', 'inter', 'Device Test Intermediate', 'ca_ext');
  ca('ca', 'inter'); issue('ca', 'leaf', 'Device Test Signer', 'leaf');
  fs.writeFileSync(f('chain.pem'), fs.readFileSync(f('inter.pem'), 'utf8') + fs.readFileSync(f('root.pem'), 'utf8'));
  const password = 'pw4321';
  ossl('pkcs12', '-export', '-inkey', f('leaf.key'), '-in', f('leaf.pem'), '-certfile', f('chain.pem'), '-passout', 'pass:' + password, '-out', f('leaf.p12'));

  // openssl's own OCSP responder, signing its answers with the intermediate's key. It reads the CA's index only
  // between requests (one behind), so it is started again after a revocation, and answers from the new index at once.
  let ocspLog = '', ocsp = null;
  const startOcsp = async () => {
    const mark = ocspLog.length;
    ocsp = spawn('openssl', ['ocsp', '-index', f('ca/index.txt'), '-port', String(ocspPort), '-rsigner', f('inter.pem'), '-rkey', f('inter.key'), '-CA', f('inter.pem'), '-nmin', '5', '-text', '-ignore_err', '-timeout', '20'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    ocsp.stdout.on('data', (d) => { ocspLog += d; }); ocsp.stderr.on('data', (d) => { ocspLog += d; });
    // (ready when it says so: a test connection would hold up the responder, which answers one connection at a time)
    const ready = () => /waiting for OCSP client connections/.test(ocspLog.slice(mark));
    for (let i = 0; i < 100 && !ready(); i++) await sleep(100);
    if (!ready()) throw new Error('openssl ocsp did not start: ' + ocspLog.slice(mark, mark + 400));
  };
  const stopOcsp = async () => { if (!ocsp || ocsp.exitCode !== null || ocsp.signalCode !== null) return; const p = ocsp; p.kill(); await new Promise((r) => p.once('exit', r)); };
  await startOcsp();
  const ocspHits = () => (ocspLog.match(/OCSP Request Data:/g) || []).length;
  // A PDF signed here with the signer's certificate (a detached CMS signature made by openssl cms, its chain in it):
  // for the release APK, whose web view the test can't drive to sign (tests/android/release.mjs).
  const signPdf = async (pdf) => {
    const L = createRequire(fileURLToPath(import.meta.url))(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../desktop/node_modules/pdf-lib'));
    const d = await L.PDFDocument.load(pdf), SIG = 16384, RANGE = [0, 1111111111, 2222222222, 3333333333];
    const sig = d.context.register(d.context.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', ByteRange: RANGE, Contents: L.PDFHexString.of('0'.repeat(SIG * 2)), M: L.PDFString.fromDate(new Date()) }));
    const pg = d.getPage(0);
    const w = d.context.register(d.context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: L.PDFString.of('Signature1'), Rect: [0, 0, 0, 0], F: 132, P: pg.ref, V: sig }));
    pg.node.addAnnot(w);
    const af = d.catalog.getOrCreateAcroForm(); af.addField(w); af.dict.set(L.PDFName.of('SigFlags'), L.PDFNumber.of(3));
    let s = Buffer.from(await d.save({ useObjectStreams: false })).toString('latin1');
    const holder = `<${'0'.repeat(SIG * 2)}>`, a = s.indexOf(holder), b = a + holder.length;
    const rx = /\/ByteRange\s*\[\s*0 1111111111 2222222222 3333333333\s*\]/, m = s.match(rx);
    if (a < 0 || !m || s.indexOf(holder, b) >= 0) throw new Error('the signature placeholder');
    const br = `/ByteRange [0 ${a} ${b} ${s.length - b}]`; s = s.replace(rx, br.padEnd(m[0].length, ' '));
    fs.writeFileSync(f('content.bin'), Buffer.from(s.slice(0, a) + s.slice(b), 'latin1'));
    ossl('cms', '-sign', '-binary', '-in', f('content.bin'), '-signer', f('leaf.pem'), '-inkey', f('leaf.key'), '-certfile', f('chain.pem'), '-md', 'sha256', '-nosmimecap', '-outform', 'DER', '-out', f('sig.der'));
    const hex = fs.readFileSync(f('sig.der')).toString('hex');
    if (hex.length > SIG * 2) throw new Error('the signature is larger than its place');
    return Buffer.from(s.slice(0, a + 1) + hex.padEnd(SIG * 2, '0') + s.slice(b - 1), 'latin1');
  };
  return {
    signPdf,
    p12: fs.readFileSync(f('leaf.p12')), password, name: 'Device Test Signer', ocsp: OCSP, crl: CRL, ocspPort, crlPort,
    ocspHits, crlHits: () => crlHits, ocspLog: () => ocspLog,
    revoke: async () => { ossl('ca', '-config', f('ca/ca.cnf'), '-revoke', f('leaf.pem'), '-crl_reason', 'keyCompromise'); await stopOcsp(); await startOcsp(); },
    stopOcsp,
    close: async () => { await stopOcsp(); crl.close(); },
  };
}
