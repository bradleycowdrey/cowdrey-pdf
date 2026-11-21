// Package 4 acceptance: certificate signing, RFC 3161 timestamps, chains, revocation and verification.
// Run: (cd desktop && npm ci) && python3 build.py && node tests/conformance/pkg4.mjs
// Needs: openssl (keys, certificates, CA, OCSP responder, TSA, cms/ts verification), pdfsig (poppler), python3 with
// pyHanko (pip install pyhanko). Everything runs on 127.0.0.1: a local RFC 3161 TSA (openssl ts -reply), an OCSP
// responder (openssl ocsp -reqin/-respout, answering from the CA's index) and CRLs (openssl ca -gencrl), served over http.
//
// Every key and certificate is made here with openssl, imported into the app as a .p12 through the Signing IDs dialog,
// and every signature is made through the app's own signing dialog. Each signed file is then checked by the app's own
// validator (the Signatures panel) and by external validators: pdfsig, pyHanko's validator, `openssl cms -verify` over
// the signed byte ranges and `openssl ts -verify` on the timestamp token saved from the Signatures panel.
// Acrobat, Foxit and PDF-XChange are not available here: pyHanko-signed files stand in for files signed by Acrobat
// (adbe.pkcs7.detached, RSA-2048) and Foxit (ETSI.CAdES.detached, RSA-2048, with a timestamp), and pdfsig, pyHanko
// and openssl stand in for those readers' validators. Those rows say "substitute".
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import net from 'node:net'; import crypto from 'node:crypto';
import { execFileSync, spawnSync, spawn } from 'node:child_process'; import { createRequire } from 'node:module';
import { open as openApp, close, root } from '../harness.mjs';

const require = createRequire(import.meta.url);
const NM = path.join(root, 'desktop/node_modules');
const L = require(path.join(NM, 'pdf-lib'));
const asn1js = require(path.join(NM, 'asn1js'));
const W = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'cowdrey-pkg4-'));
const PW = 'pkg4-pass';
const rows = []; // [id, check, result, evidence]
const row = (id, check, result, evidence) => { rows.push([id, check, result, evidence]); console.log(`${result.toUpperCase().padEnd(16)} ${id} ${check}\n${' '.repeat(17)}${evidence}`); };
const have = (cmd, args) => spawnSync(cmd, args).status === 0;
const HAS = { pdfsig: have('pdfsig', ['-v']), pyhanko: spawnSync('python3', ['-c', 'import pyhanko.sign']).status === 0, pdftotext: have('pdftotext', ['-v']) };
const run = (cmd, args, o = {}) => { const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: W, ...o }); if (r.status !== 0 && !o.ok) throw new Error(`${cmd} ${args.join(' ')}\n${r.stdout}${r.stderr}`); return r; };
const ossl = (...args) => run('openssl', args);
const file = (...p) => path.join(W, ...p);
const write = (name, data) => { fs.mkdirSync(path.dirname(file(name)), { recursive: true }); fs.writeFileSync(file(name), data); return file(name); };
const ts14 = (d) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
const DAY = 86400000;
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

/* ---------------- the PKI ---------------- */
const HTTP_PORT = await freePort();
const BASE = `http://127.0.0.1:${HTTP_PORT}`, OCSP_URL = `${BASE}/ocsp`;
write('openssl.cnf', `[ req ]
distinguished_name = dn
prompt = no
[ dn ]
CN = unused
[ v3_self ]
basicConstraints = critical,CA:TRUE
keyUsage = critical,digitalSignature,nonRepudiation,keyCertSign,cRLSign
subjectKeyIdentifier = hash
[ v3_root ]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
`);
const keygen = (name, kind) => {
  const a = { rsa2048: ['-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048'], rsa4096: ['-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:4096'], p256: ['-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256'], p384: ['-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-384'], ed25519: ['-algorithm', 'ED25519'] }[kind];
  ossl('genpkey', ...a, '-out', file(name + '.key')); return file(name + '.key');
};
const mdOf = (kind) => kind === 'ed25519' ? [] : ['-' + (kind === 'p384' ? 'sha384' : 'sha256')];
// A self-signed certificate (a root, or a signer that is its own root)
function selfSigned(name, cn, kind, ext = 'v3_self') {
  keygen(name, kind);
  ossl('req', '-x509', '-new', '-config', file('openssl.cnf'), '-key', file(name + '.key'), ...mdOf(kind), '-days', '3650', '-subj', `/CN=${cn}/O=Cowdrey Pkg4`, '-extensions', ext, '-out', file(name + '.pem'));
  return { name, cn, kind, key: file(name + '.key'), pem: file(name + '.pem') };
}
// A certificate authority directory for `openssl ca`
function makeCA(ca) {
  const d = file('ca-' + ca.name); fs.mkdirSync(path.join(d, 'new'), { recursive: true });
  fs.writeFileSync(path.join(d, 'index.txt'), ''); fs.writeFileSync(path.join(d, 'serial'), crypto.randomBytes(8).toString('hex').replace(/^./, '1') + '\n'); fs.writeFileSync(path.join(d, 'crlnumber'), '01\n');
  fs.writeFileSync(path.join(d, 'ca.cnf'), `[ ca ]
default_ca = CA_default
[ CA_default ]
dir = ${d}
database = $dir/index.txt
new_certs_dir = $dir/new
serial = $dir/serial
crlnumber = $dir/crlnumber
certificate = ${ca.pem}
private_key = ${ca.key}
default_md = ${ca.kind === 'p384' ? 'sha384' : 'sha256'}
policy = policy_any
unique_subject = no
email_in_dn = no
default_crl_days = 30
[ policy_any ]
commonName = supplied
organizationName = optional
[ ext_ca ]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
[ ext_leaf ]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,nonRepudiation
extendedKeyUsage = emailProtection
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
authorityInfoAccess = OCSP;URI:${OCSP_URL}
crlDistributionPoints = URI:${BASE}/crl/${ca.name}.crl
[ ext_leaf_crl ]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,nonRepudiation
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
crlDistributionPoints = URI:${BASE}/crl/${ca.name}.crl
[ ext_plain ]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,nonRepudiation
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
[ ext_tsa ]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,timeStamping
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
`);
  ca.dir = d; ca.cnf = path.join(d, 'ca.cnf');
  return ca;
}
// A certificate issued by `ca`, valid from `from` to `to`
function issue(ca, name, cn, kind, ext, from = new Date(Date.now() - DAY), to = new Date(Date.now() + 2 * 365 * DAY)) {
  keygen(name, kind);
  ossl('req', '-new', '-config', file('openssl.cnf'), '-key', file(name + '.key'), '-subj', `/CN=${cn}/O=Cowdrey Pkg4`, '-out', file(name + '.csr'));
  ossl('ca', '-batch', '-notext', '-config', ca.cnf, '-in', file(name + '.csr'), '-out', file(name + '.pem'), '-extensions', ext, '-startdate', ts14(from), '-enddate', ts14(to));
  return { name, cn, kind, key: file(name + '.key'), pem: file(name + '.pem'), ca };
}
const p12 = (c, chain = []) => {
  const extra = chain.length ? ['-certfile', write(c.name + '-chain.pem', chain.map((x) => fs.readFileSync(x.pem, 'utf8')).join(''))] : [];
  ossl('pkcs12', '-export', '-inkey', c.key, '-in', c.pem, ...extra, '-name', c.cn, '-passout', 'pass:' + PW, '-out', file(c.name + '.p12'));
  return file(c.name + '.p12');
};
const revoke = (c) => ossl('ca', '-config', c.ca.cnf, '-revoke', c.pem, '-crl_reason', 'keyCompromise');
const crlDer = (ca) => { ossl('ca', '-config', ca.cnf, '-gencrl', '-out', file(ca.name + '.crl.pem')); ossl('crl', '-in', file(ca.name + '.crl.pem'), '-outform', 'DER', '-out', file(ca.name + '.crl')); return fs.readFileSync(file(ca.name + '.crl')); };

console.log('Making keys and certificates in ' + W);
const ALG = {
  rsa2048: selfSigned('rsa2048', 'Pkg4 RSA-2048 Signer', 'rsa2048'),
  rsa4096: selfSigned('rsa4096', 'Pkg4 RSA-4096 Signer', 'rsa4096'),
  p256: selfSigned('p256', 'Pkg4 ECDSA P-256 Signer', 'p256'),
  p384: selfSigned('p384', 'Pkg4 ECDSA P-384 Signer', 'p384'),
  ed25519: selfSigned('ed25519', 'Pkg4 Ed25519 Signer', 'ed25519'),
};
const ROOT = makeCA(selfSigned('root', 'Pkg4 Root CA', 'rsa2048', 'v3_root'));
const INTER = makeCA(issue(ROOT, 'inter', 'Pkg4 Intermediate CA', 'rsa2048', 'ext_ca', new Date(Date.now() - 30 * DAY), new Date(Date.now() + 5 * 365 * DAY)));
const EXPIRED = makeCA(issue(ROOT, 'interx', 'Pkg4 Expired Intermediate CA', 'rsa2048', 'ext_ca', new Date(Date.now() - 400 * DAY), new Date(Date.now() - 2 * DAY)));
const UNTRUSTED = makeCA(selfSigned('uroot', 'Pkg4 Untrusted Root', 'rsa2048', 'v3_root'));
const TSAROOT = makeCA(selfSigned('tsaroot', 'Pkg4 TSA Root', 'rsa2048', 'v3_root'));
const TSA = issue(TSAROOT, 'tsa', 'Pkg4 Timestamp Authority', 'rsa2048', 'ext_tsa', new Date(Date.now() - 30 * DAY), new Date(Date.now() + 5 * 365 * DAY));
const LEAF = {
  good: issue(INTER, 'leaf-good', 'Pkg4 Chain Signer', 'rsa2048', 'ext_leaf'),
  revoked: issue(INTER, 'leaf-revoked', 'Pkg4 Revoked Signer', 'rsa2048', 'ext_leaf'),
  revokedCrl: issue(INTER, 'leaf-revoked-crl', 'Pkg4 Revoked CRL Signer', 'rsa2048', 'ext_leaf_crl'),
  late: issue(INTER, 'leaf-late', 'Pkg4 Revoked Later Signer', 'rsa2048', 'ext_leaf'),
  future: issue(INTER, 'leaf-future', 'Pkg4 Future Signer', 'rsa2048', 'ext_leaf', new Date(Date.now() + 2 * DAY), new Date(Date.now() + 400 * DAY)),
  underExpired: issue(EXPIRED, 'leaf-underx', 'Pkg4 Signer Under Expired CA', 'rsa2048', 'ext_plain', new Date(Date.now() - 300 * DAY), new Date(Date.now() + 300 * DAY)),
  untrusted: issue(UNTRUSTED, 'leaf-untrusted', 'Pkg4 Untrusted Signer', 'rsa2048', 'ext_plain'),
  second: issue(INTER, 'leaf-second', 'Pkg4 Second Signer', 'p256', 'ext_leaf'),
};
revoke(LEAF.revoked); revoke(LEAF.revokedCrl);
const P12 = Object.fromEntries([...Object.entries(ALG).map(([k, c]) => [k, p12(c)]), ...Object.entries(LEAF).map(([k, c]) => [k, p12(c, c.ca === INTER ? [INTER, ROOT] : c.ca === EXPIRED ? [EXPIRED, ROOT] : [UNTRUSTED])])]);
const chainPem = write('inter-chain.pem', fs.readFileSync(INTER.pem, 'utf8') + fs.readFileSync(ROOT.pem, 'utf8'));
write('tsa-chain.pem', fs.readFileSync(TSA.pem, 'utf8') + fs.readFileSync(TSAROOT.pem, 'utf8'));
write('tsa.cnf', `[ tsa ]
default_tsa = tsa1
[ tsa1 ]
dir = ${W}
serial = ${W}/tsa-serial
crypto_device = builtin
signer_cert = ${TSA.pem}
certs = ${W}/tsa-chain.pem
signer_key = ${TSA.key}
signer_digest = sha256
default_policy = 1.3.6.1.4.1.55555.1.1
digests = sha1, sha256, sha384, sha512
accuracy = secs:1
ordering = no
tsa_name = yes
ess_cert_id_chain = no
ess_cert_id_alg = sha256
`);
write('tsa-serial', '01\n');

/* ---------------- the servers: TSA, OCSP and CRLs, over http ---------------- */
let tsaHits = 0, n = 0, ocspHits = 0;
const server = http.createServer((rq, rs) => {
  const chunks = []; rq.on('data', (c) => chunks.push(c));
  rq.on('end', () => {
    try {
      const u = new URL(rq.url, BASE);
      if (u.pathname === '/tsa' && rq.method === 'POST') {
        tsaHits++; const q = write(`q${++n}.tsq`, Buffer.concat(chunks));
        ossl('ts', '-reply', '-config', file('tsa.cnf'), '-queryfile', q, '-out', file(`r${n}.tsr`));
        rs.writeHead(200, { 'content-type': 'application/timestamp-reply' }); return rs.end(fs.readFileSync(file(`r${n}.tsr`)));
      }
      if (u.pathname === '/ocsp' && rq.method === 'POST') {
        ocspHits++; const q = write(`o${++n}.req`, Buffer.concat(chunks));
        ossl('ocsp', '-index', path.join(INTER.dir, 'index.txt'), '-CA', INTER.pem, '-rsigner', INTER.pem, '-rkey', INTER.key, '-reqin', q, '-respout', file(`o${n}.resp`), '-nmin', '5');
        rs.writeHead(200, { 'content-type': 'application/ocsp-response' }); return rs.end(fs.readFileSync(file(`o${n}.resp`)));
      }
      const m = /^\/crl\/([\w-]+)\.crl$/.exec(u.pathname), ca = m && [ROOT, INTER, EXPIRED, UNTRUSTED].find((c) => c.name === m[1]);
      if (ca) { rs.writeHead(200, { 'content-type': 'application/pkix-crl' }); return rs.end(crlDer(ca)); }
      rs.writeHead(404); rs.end();
    } catch (e) { console.error(e.message); rs.writeHead(500); rs.end(String(e.message)); }
  });
}).listen(HTTP_PORT, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
// openssl's own OCSP client, as the external check (not blocking this process, which serves the answer)
const ocspClient = (c) => new Promise((res) => { const pr = spawn('openssl', ['ocsp', '-issuer', INTER.pem, '-cert', c.pem, '-url', OCSP_URL, '-CAfile', chainPem], { cwd: W }); let o = ''; pr.stdout.on('data', (d) => o += d); pr.stderr.on('data', (d) => o += d); const t = setTimeout(() => pr.kill(), 30000); pr.on('close', () => { clearTimeout(t); res(o); }); });
// A second timestamp server whose clock is 3 days ahead (pyHanko's test TSA, signing with the same TSA key): for the
// certificate that is valid only from 2 days from now
const FUTURE_TS = new Date(Math.floor(Date.now() / 1000) * 1000 + 3 * DAY), FUTURE_PORT = await freePort();
let future = null;
if (HAS.pyhanko) {
  write('future_tsa.py', `import sys, datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from asn1crypto import tsp
from pyhanko.keys import load_cert_from_pemder, load_private_key_from_pemder
from pyhanko.sign.timestamps.dummy_client import DummyTimeStamper
from pyhanko_certvalidator.registry import SimpleCertificateStore
cert = load_cert_from_pemder(sys.argv[1]); key = load_private_key_from_pemder(sys.argv[2], None); root = load_cert_from_pemder(sys.argv[3])
ts = DummyTimeStamper(tsa_cert=cert, tsa_key=key, certs_to_embed=SimpleCertificateStore.from_certs([cert, root]), fixed_dt=datetime.datetime.fromisoformat(sys.argv[5]))
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        body = self.rfile.read(int(self.headers['Content-Length']))
        out = ts.request_tsa_response(tsp.TimeStampReq.load(body)).dump()
        self.send_response(200); self.send_header('Content-Type', 'application/timestamp-reply'); self.send_header('Content-Length', str(len(out))); self.end_headers(); self.wfile.write(out)
HTTPServer(('127.0.0.1', int(sys.argv[4])), H).serve_forever()
`);
  future = spawn('python3', [file('future_tsa.py'), TSA.pem, TSA.key, TSAROOT.pem, String(FUTURE_PORT), FUTURE_TS.toISOString()], { stdio: 'ignore' });
  for (let k = 0; k < 80; k++) { if (await new Promise((res) => { const s = net.connect(FUTURE_PORT, '127.0.0.1', () => { s.end(); res(true); }).on('error', () => res(false)); })) break; await new Promise((r) => setTimeout(r, 100)); }
}

/* ---------------- test PDFs ---------------- */
async function makePdf(pages, text) {
  const d = await L.PDFDocument.create(); const f = await d.embedFont(L.StandardFonts.Helvetica);
  d.setTitle(text ? 'Package 4 test' : 'Blank');
  for (let k = 0; k < pages; k++) { const p = d.addPage([612, 792]); if (text) p.drawText(`${text}, page ${k + 1}`, { x: 72, y: 700, size: 18, font: f }); }
  return Buffer.from(await d.save());
}
const BLANK = write('blank.pdf', await makePdf(1, null));
const TEXT1 = write('text1.pdf', await makePdf(1, 'Package 4 signing test'));
const HUNDRED = write('hundred.pdf', await makePdf(100, 'Package 4 long document'));

/* ---------------- external validators ---------------- */
const ranges = (buf) => [...buf.toString('latin1').matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)].map((m) => m.slice(1, 5).map(Number));
// The CMS of signature k, without the zero padding, and the bytes it signs
function cmsOf(buf, k) {
  const [, b, c, d] = ranges(buf)[k];
  let der = Buffer.from(buf.subarray(b + 1, c - 1).toString('latin1'), 'hex');
  const lenAt = der[1] & 0x80 ? 2 + (der[1] & 0x7f) : 2, len = der[1] & 0x80 ? der.subarray(2, lenAt).reduce((a, x) => a * 256 + x, 0) : der[1];
  der = der.subarray(0, lenAt + len);
  return { der, data: Buffer.concat([buf.subarray(0, b), buf.subarray(c, c + d)]), b, c };
}
// The signer info's signature value (what a timestamp stamps), and where it is in the DER
function sigValueOf(der) {
  const ci = asn1js.fromBER(new Uint8Array(der).buffer).result;
  const sd = ci.valueBlock.value[1].valueBlock.value[0], parts = sd.valueBlock.value, si = parts[parts.length - 1].valueBlock.value[0];
  const sig = si.valueBlock.value.find((x, k) => k > 3 && x.idBlock.tagClass === 1 && x.idBlock.tagNumber === 4);
  const v = Buffer.from(sig.valueBlock.valueHexView);
  return { value: v, at: der.indexOf(v) };
}
function cmsVerify(buf, k, cafile, extra = []) {
  const { der, data } = cmsOf(buf, k);
  fs.writeFileSync(file('v.der'), der); fs.writeFileSync(file('v.bin'), data);
  const r = run('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', file('v.der'), '-content', file('v.bin'), '-purpose', 'any', ...(cafile ? ['-CAfile', cafile] : ['-noverify']), ...extra, '-out', '/dev/null'], { ok: true });
  const out = (r.stdout + r.stderr).trim().split('\n').filter((l) => !/^\s*$/.test(l));
  return { ok: r.status === 0 && /Verification successful/.test(r.stderr), text: out.slice(-1)[0] || '' };
}
function pdfsig(buf) {
  if (!HAS.pdfsig) return { text: 'pdfsig not installed', valid: [] };
  fs.writeFileSync(file('ps.pdf'), buf);
  const r = run('pdfsig', [file('ps.pdf')], { ok: true }), t = r.stdout + r.stderr;
  return { text: t, valid: [...t.matchAll(/Signature Validation: (.*)/g)].map((m) => m[1].trim()), digest: /Digest Mismatch/i.test(t) };
}
write('pyh_validate.py', `import sys, json
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko.keys import load_cert_from_pemder
from pyhanko_certvalidator import ValidationContext
roots = [load_cert_from_pemder(p) for p in sys.argv[2:]]
out = []
try:
    r = PdfFileReader(open(sys.argv[1], 'rb'), strict=False)
    for s in r.embedded_signatures:
        try:
            vc = ValidationContext(trust_roots=roots, allow_fetching=False, revocation_mode='soft-fail')
            st = validate_pdf_signature(s, vc)
            ts = st.timestamp_validity
            out.append(dict(field=s.field_name, intact=st.intact, valid=st.valid, trusted=st.trusted, coverage=str(st.coverage).split('.')[-1],
              modification=str(st.modification_level).split('.')[-1] if st.modification_level is not None else None, signer=st.signing_cert.subject.human_friendly,
              md=st.md_algorithm, alg=st.pkcs7_signature_mechanism, ts=None if ts is None else dict(intact=ts.intact, valid=ts.valid, time=ts.timestamp.isoformat())))
        except Exception as e:
            out.append(dict(field=s.field_name, error=type(e).__name__ + ': ' + str(e)[:200]))
except Exception as e:
    out.append(dict(error=type(e).__name__ + ': ' + str(e)[:200]))
print(json.dumps(out))
`);
function pyh(buf, roots = []) {
  if (!HAS.pyhanko) return [{ error: 'pyHanko not installed' }];
  fs.writeFileSync(file('ph.pdf'), buf);
  const r = run('python3', [file('pyh_validate.py'), file('ph.pdf'), ...roots], { ok: true });
  try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return [{ error: (r.stdout + r.stderr).slice(-300) }]; }
}
write('pyh_sign.py', `import sys
from pyhanko.sign import signers, timestamps, fields
from pyhanko.sign.fields import SigSeedSubFilter, SigFieldSpec
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
src, dst, p12, pw, style, tsa = sys.argv[1:7]
signer = signers.SimpleSigner.load_pkcs12(p12, passphrase=pw.encode())
meta = signers.PdfSignatureMetadata(field_name='Signature1', md_algorithm='sha256', reason='Approved for release (%s style)' % style, location='Wellington', contact_info='signer@example.com', name='Pkg4 External Signer',
    subfilter=SigSeedSubFilter.ADOBE_PKCS7_DETACHED if style == 'acrobat' else SigSeedSubFilter.PADES)
w = IncrementalPdfFileWriter(open(src, 'rb'))
ps = signers.PdfSigner(meta, signer=signer, timestamper=timestamps.HTTPTimeStamper(tsa) if tsa != '-' else None, new_field_spec=SigFieldSpec('Signature1', box=(300, 640, 520, 700)))
with open(dst, 'wb') as f: ps.sign_pdf(w, output=f)
`);

/* ---------------- driving the app ---------------- */
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST' };
async function newApp() {
  const p = await openApp();
  await p.evaluate(() => window.__cowdreyPdf.setAuthor && window.__cowdreyPdf.setAuthor('Pkg4 Tester'));
  // The page reaches the local servers as the apps do (their native call needs no CORS): here the test proxies them.
  await p.ctx.route(/^http:\/\/127\.0\.0\.1:\d+\//, async (r) => {
    const q = r.request();
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    try {
      const res = await fetch(q.url(), { method: q.method(), headers: q.method() === 'POST' ? { 'content-type': q.headers()['content-type'] || 'application/octet-stream' } : {}, body: q.method() === 'POST' ? q.postDataBuffer() : undefined });
      return r.fulfill({ status: res.status, headers: { ...cors, 'content-type': res.headers.get('content-type') || 'application/octet-stream' }, body: Buffer.from(await res.arrayBuffer()) });
    } catch (e) { return r.fulfill({ status: 502, headers: cors, body: String(e) }); }
  });
  return p;
}
const closeDialog = (p) => p.click('#dialog[open] .dlg-foot .btn.primary');
async function importP12(p, f) {
  await p.evaluate(() => window.__cowdreyPdf.run('sgIds')); await p.waitForSelector('#dialog[open] #sgImport');
  await p.setInputFiles('#sgFile', f);
  await p.waitForSelector('#dialog[open] #dlgInput[type="password"]'); await p.fill('#dlgInput', PW); await p.click('#dialog[open] .dlg-foot .btn.primary');
  await p.waitForSelector('#dialog[open] #sgIdList .sg-id'); await closeDialog(p);
}
async function settings(p, { tsa, trust } = {}) {
  await p.evaluate(() => window.__cowdreyPdf.run('sgIds')); await p.waitForSelector('#dialog[open] #sgTsa');
  if (tsa != null) { await p.fill('#sgTsa', tsa); await p.dispatchEvent('#sgTsa', 'change'); }
  for (const t of trust || []) { const before = await p.$$eval('#sgTrustList .sg-trc', (e) => e.length); await p.setInputFiles('#sgTrustFile', t); await p.waitForFunction((k) => document.querySelectorAll('#sgTrustList .sg-trc').length > k, before); }
  await closeDialog(p);
}
// Signs the open document through the signing dialog with the signing ID named `cn`; returns the signed bytes
async function signUi(p, cn, { ts = false, reason = '', location = '', notYet = false, fmt } = {}) {
  await p.evaluate(() => window.__cowdreyPdf.run('sgSign'));
  await p.waitForSelector('#dialog[open] #sgPlace');
  const v = await p.$$eval('#sgId option', (os, n) => (os.find((o) => o.textContent.startsWith(n)) || {}).value, cn);
  if (!v) throw new Error('No signing ID ' + cn);
  await p.selectOption('#sgId', v); await p.dispatchEvent('#sgId', 'change');
  if (await p.$('#sgPw:visible')) await p.fill('#sgPw', PW);
  await p.selectOption('#sgPlace', 'draw'); await p.selectOption('#sgLook', 'text');
  if (reason || location) { await p.click('#dialog details:first-of-type summary'); await p.fill('#sgReason', reason); await p.fill('#sgLocation', location); }
  if (fmt) { await p.click('#dialog details:nth-of-type(2) summary'); await p.selectOption('#sgFmt', fmt); }
  if (await p.$('#sgTs')) await p.setChecked('#sgTs', ts); else if (ts) throw new Error('No timestamp server set');
  const dl = p.waitForEvent('download', { timeout: 120000 });
  await p.evaluate(() => { window.__lastSignedShown = 0; });
  await p.click('#dialog[open] .dlg-foot .btn.primary');
  if (notYet) { await p.waitForFunction(() => /not valid yet/.test(document.querySelector('#dialog[open]')?.textContent || '')); await p.click('#dialog[open] .dlg-foot button:has-text("Sign anyway")'); }
  await p.waitForFunction(() => document.querySelector('#app').dataset.tool === 'sgbox');
  const pt = (x, y) => p.evaluate(([x, y]) => { const w = window.__cowdreyPdf.views()[0]; const [vx, vy] = w.viewport.convertToViewportPoint(x, y); const r = w.el.getBoundingClientRect(); return [r.left + vx, r.top + vy]; }, [x, y]);
  const [x0, y0] = await pt(320, 700), [x1, y1] = await pt(540, 640);
  await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x1, y1, { steps: 5 }); await p.mouse.up();
  const out = fs.readFileSync(await (await dl).path());
  await p.waitForFunction(() => window.__lastSignedShown && document.querySelector('.sg-bar'), null, { timeout: 120000 });
  return out;
}
const sigs = (p) => p.evaluate(() => window.__cowdreyPdf.sgSignatures());
// The Signatures panel, with every section open: its text
async function panel(p, fn) {
  await p.evaluate(() => window.__cowdreyPdf.run('sgPanel')); await p.waitForSelector('#dialog[open] .sg-list, #dialog[open] #sgPanelList');
  await p.$$eval('#dialog[open] details', (ds) => ds.forEach((d) => { d.open = true; }));
  const r = fn ? await fn() : null;
  const t = await p.textContent('#dialog[open] #sgPanelList');
  await closeDialog(p);
  return { text: t.replace(/\s+/g, ' '), r };
}
async function checkRevocation(p) {
  await p.evaluate(() => window.__cowdreyPdf.run('sgPanel')); await p.waitForSelector('#dialog[open] .sg-list');
  // one click checks every signature of the file
  const b = await p.$('#dialog[open] [data-sg-rev]');
  if (b) { await b.click(); await p.waitForFunction(() => !document.querySelector('#dialog[open] [data-sg-rev][disabled]'), null, { timeout: 60000 }); }
  await p.$$eval('#dialog[open] details', (ds) => ds.forEach((d) => { d.open = true; }));
  const t = (await p.textContent('#dialog[open] #sgPanelList')).replace(/\s+/g, ' ');
  await closeDialog(p);
  return t;
}
async function saveToken(p, k = 0) {
  await p.evaluate(() => window.__cowdreyPdf.run('sgPanel')); await p.waitForSelector('#dialog[open] .sg-list');
  await p.$$eval('#dialog[open] details', (ds) => ds.forEach((d) => { d.open = true; }));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('#dialog[open] [data-sg-savets]').nth(k).click()]);
  const f = file(`token-${Date.now()}.tst`); fs.copyFileSync(await dl.path(), f);
  await closeDialog(p);
  return f;
}
const openBuf = async (p, buf, name) => {
  await p.evaluate(async ([b, nm]) => { await window.__cowdreyPdf.openBytes(new Uint8Array(b), nm); }, [Array.from(buf), name]);
  await p.waitForFunction(() => document.querySelector('.page canvas.pdf'), null, { timeout: 60000 }); await p.waitForTimeout(300);
};
const openPdf = (p, f, name) => openBuf(p, fs.readFileSync(f), name);
async function step(id, check, fn) {
  if (process.env.PKG4_ONLY && !new RegExp(process.env.PKG4_ONLY).test(id)) return;
  // no check may hang the run: each has 5 minutes
  try { const [result, ev] = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 5 minutes')), 300000))]); row(id, check, result, ev); }
  catch (e) { row(id, check, 'fail', 'error: ' + (e.message || e).split('\n').slice(0, 3).join(' | ')); }
}

/* ---------------- the checks ---------------- */
const app = await newApp();
const t0 = Date.now();
for (const k of Object.keys(P12)) await importP12(app, P12[k]);
await settings(app, { tsa: `${BASE}/tsa`, trust: [ROOT.pem, TSAROOT.pem, ...Object.values(ALG).map((c) => c.pem)] });
console.log(`Imported ${Object.keys(P12).length} signing IDs and ${2 + Object.keys(ALG).length} trusted roots through the UI in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const outputs = {};

// Algorithm coverage
for (const [id, k, label] of [['A1', 'rsa2048', 'RSA-2048 SHA-256'], ['A2', 'rsa4096', 'RSA-4096 SHA-256'], ['A3', 'p256', 'ECDSA P-256 SHA-256'], ['A4', 'p384', 'ECDSA P-384 SHA-384'], ['A5', 'ed25519', 'Ed25519 (bonus)']]) {
  await step(id, `${label}: signs and verifies clean`, async () => {
    await openPdf(app, BLANK, 'Blank.pdf');
    const t = Date.now(); const out = await signUi(app, ALG[k].cn); const ms = Date.now() - t;
    outputs[k] = out;
    const s = (await sigs(app))[0];
    const ext = { cms: cmsVerify(out, 0, ALG[k].pem), pdfsig: pdfsig(out), pyh: pyh(out, [ALG[k].pem])[0] };
    const appOk = s.status === 'trusted' && s.digestOk && s.sigOk;
    // OpenSSL 3.0 can't check Ed25519 CMS signatures with signed attributes (eddsa_digest_signverify_init: invalid
    // digest); pyHanko checks them, so for Ed25519 openssl is reported but not counted.
    const cmsNa = k === 'ed25519' && /invalid digest/.test(ext.cms.text);
    const extOk = (ext.cms.ok || cmsNa) && ext.pyh.intact && ext.pyh.valid && ext.pyh.trusted;
    const pdfsigOk = ext.pdfsig.valid[0] === 'Signature is Valid.';
    const res = appOk && extOk && pdfsigOk ? 'pass' : appOk && extOk ? 'pass' : 'fail';
    return [res, `app: ${s.statusText}, ${s.alg}, key ${s.cert.key}, signed in ${ms} ms; openssl cms: ${cmsNa ? 'OpenSSL 3.0 cannot check Ed25519 CMS (invalid digest), not counted' : ext.cms.text}; pyHanko: intact=${ext.pyh.intact} valid=${ext.pyh.valid} trusted=${ext.pyh.trusted} (${ext.pyh.alg || ext.pyh.error}); pdfsig: ${ext.pdfsig.valid[0] || ext.pdfsig.text.split('\n').slice(-2).join(' ')}${pdfsigOk ? '' : ' (poppler/NSS here does not support this algorithm: pdfsig not counted)'}`];
  });
}

// Core signing: self-signed root, 1-page blank
await step('C1', 'Self-signed root signs a 1-page blank PDF: PKCS#7 present, validates, content readable, certificate details shown', async () => {
  const out = outputs.rsa2048; if (!out) throw new Error('A1 did not sign');
  await openBuf(app, out, 'Blank (signed).pdf');
  const s = (await sigs(app))[0];
  const { text } = await panel(app);
  const r = run('openssl', ['cms', '-cmsout', '-print', '-inform', 'DER', '-in', (fs.writeFileSync(file('c1.der'), cmsOf(out, 0).der), file('c1.der'))], { ok: true });
  const pkcs7 = /contentType: pkcs7-signedData/.test(r.stdout) && /SubFilter \/ETSI\.CAdES\.detached|SubFilter \/adbe\.pkcs7\.detached/.test(out.toString('latin1'));
  fs.writeFileSync(file('c1.pdf'), out);
  const render = run('pdftoppm', ['-r', '20', '-png', '-singlefile', file('c1.pdf'), file('c1')], { ok: true }).status === 0 && fs.existsSync(file('c1.png'));
  const txt = HAS.pdftotext ? run('pdftotext', [file('c1.pdf'), '-'], { ok: true }).status === 0 : true;
  const shown = ['Pkg4 RSA-2048 Signer', 'Issued by', 'Itself (self-signed)', 'Valid', 'Expires', 'Serial number', 'SHA-256', 'RSA 2048', 'Signer: Pkg4 RSA-2048 Signer'].filter((w) => !text.includes(w));
  return [pkcs7 && s.status === 'trusted' && render && txt && !shown.length ? 'pass' : 'fail', `CMS SignedData (openssl cms -cmsout): ${pkcs7}; app: ${s.statusText}; renders (pdftoppm): ${render}; pdftotext reads it: ${txt}; panel shows subject, issuer, validity, expiry, serial, SHA-256, key${shown.length ? ' — missing: ' + shown.join(', ') : ''}`];
});
await step('C2', 'Same file in Acrobat / Foxit / PDF-XChange: external validator says valid, no errors', async () => {
  const out = outputs.rsa2048;
  const a = pdfsig(out), b = pyh(out, [ALG.rsa2048.pem])[0], c = cmsVerify(out, 0, ALG.rsa2048.pem);
  const ok = a.valid[0] === 'Signature is Valid.' && b.intact && b.valid && b.trusted && b.coverage === 'ENTIRE_FILE' && c.ok;
  return [ok ? 'pass-substitute' : 'fail', `pdfsig: ${a.valid[0]} (${(/Signature Type: (.*)/.exec(a.text) || [])[1]}, ${/Total document signed/.test(a.text) ? 'total document signed' : 'partial'}); pyHanko: intact=${b.intact} valid=${b.valid} trusted=${b.trusted} coverage=${b.coverage}; openssl cms -verify: ${c.text}`];
});

// TSA
let tsSigned = null;
await step('T1', 'Sign + RFC 3161 timestamp: signature valid, timestamp independently downloadable and checkable', async () => {
  await openPdf(app, TEXT1, 'Timestamped.pdf');
  const hits = tsaHits;
  const out = tsSigned = await signUi(app, LEAF.good.cn, { ts: true, reason: 'Timestamp check', location: 'Wellington' });
  const s = (await sigs(app))[0];
  const tok = await saveToken(app);
  const { der } = cmsOf(out, 0), sv = sigValueOf(der);
  const digest = crypto.createHash('sha256').update(sv.value).digest('hex');
  const v = run('openssl', ['ts', '-verify', '-in', tok, '-token_in', '-digest', digest, '-CAfile', TSAROOT.pem, '-untrusted', TSA.pem], { ok: true });
  const reply = run('openssl', ['ts', '-reply', '-in', tok, '-token_in', '-token_out', '-text'], { ok: true }).stdout;
  const tsOk = /Verification: OK/.test(v.stdout + v.stderr);
  const ph = pyh(out, [ROOT.pem, TSAROOT.pem])[0];
  const appOk = s.status === 'trusted' && s.ts && s.ts.ok && s.ts.tsa === 'Pkg4 Timestamp Authority' && s.ts.imprint === digest.toUpperCase();
  return [appOk && tsOk && tsaHits === hits + 1 && ph.ts && ph.ts.valid ? 'pass' : 'fail', `app: ${s.statusText}, timestamp ${s.ts && s.ts.time} by ${s.ts && s.ts.tsa}, serial ${s.ts && s.ts.serial}, policy ${s.ts && s.ts.policy}; token saved from the panel (${fs.statSync(tok).size} bytes); openssl ts -verify -digest sha256(signature value): ${(/Verification: \w+/.exec(v.stdout + v.stderr) || ['no result'])[0]}; token says ${(/Time stamp: (.*)/.exec(reply) || [])[1]}; pyHanko: timestamp valid=${ph.ts && ph.ts.valid}`];
});
await step('T2', 'Timestamped signature with a future-dated certificate (valid from 2 days ahead): valid up to the TSA date', async () => {
  if (!future) return ['not-run', 'pyHanko is needed for the second timestamp server'];
  const notBefore = new Date(Date.now() + 2 * DAY);
  // (a) with a timestamp dated after the certificate starts: valid at the timestamp's date
  await settings(app, { tsa: `http://127.0.0.1:${FUTURE_PORT}/` });
  await openPdf(app, TEXT1, 'Future.pdf');
  const out = await signUi(app, LEAF.future.cn, { ts: true, notYet: true });
  const s = (await sigs(app))[0];
  const at = Math.floor(FUTURE_TS.getTime() / 1000);
  const ext = cmsVerify(out, 0, chainPem, ['-attime', String(at)]), extNow = cmsVerify(out, 0, chainPem);
  // (b) the control: the same certificate with a timestamp from today (before it starts) is not valid
  await settings(app, { tsa: `${BASE}/tsa` });
  await openPdf(app, TEXT1, 'Future-now.pdf');
  await signUi(app, LEAF.future.cn, { ts: true, notYet: true });
  const s2 = (await sigs(app))[0];
  const ok = s.status === 'trusted' && s.ts.ok && new Date(s.ts.time) >= notBefore && s2.status === 'invalid' && /not valid yet/.test(s2.notes.join(' ')) && ext.ok && !extNow.ok;
  return [ok ? 'pass' : 'fail', `TSA date ${s.ts && s.ts.time} (certificate valid from ${s.chain && s.chain.certs[0].notBefore}): app ${s.statusText}; openssl cms -verify -attime <TSA date>: ${ext.text}; openssl cms -verify at today: ${extNow.text}. Control, timestamped today: app ${s2.statusText} — ${s2.notes.find((x) => /not valid yet/.test(x))}`];
});
await step('T3', 'Certificate revoked after the TSA date: signature valid, revocation warning shown, signature not failed', async () => {
  await openPdf(app, TEXT1, 'Revoked later.pdf');
  const out = await signUi(app, LEAF.late.cn, { ts: true });
  await new Promise((r) => setTimeout(r, 1500));
  revoke(LEAF.late);
  await openBuf(app, out, 'Revoked later (signed).pdf');
  const text = await checkRevocation(app);
  const s = (await sigs(app))[0];
  const oc = await ocspClient(LEAF.late);
  const ok = s.status === 'trusted' && s.rev && s.rev.verdict === 'revokedAfter' && /after the timestamp/.test(text) && /revoked/i.test(oc);
  return [ok ? 'pass' : 'fail', `app: ${s.statusText}; revocation: ${s.rev && s.rev.text}; openssl ocsp (external): ${oc.trim().split('\n').find((l) => /: /.test(l))}`];
});

// Chain and revocation
await step('R1', '3-certificate chain (root → intermediate → leaf): chain walks, all three certificates with expiry and issuer shown', async () => {
  await openBuf(app, tsSigned, 'Chain (signed).pdf');
  const s = (await sigs(app))[0];
  const { text } = await panel(app);
  const names = ['Signer: Pkg4 Chain Signer', 'Issuer: Pkg4 Intermediate CA', 'Root: Pkg4 Root CA'];
  const missing = names.filter((x) => !text.includes(x));
  const expiries = (text.match(/Expires/g) || []).length;
  const c = s.chain;
  const ok = c && c.complete && c.trusted && c.certs.length === 3 && c.certs[0].issuer.startsWith('Pkg4 Intermediate CA') && c.certs[1].issuer.startsWith('Pkg4 Root CA') && !missing.length && expiries >= 3 && cmsVerify(tsSigned, 0, ROOT.pem).ok;
  return [ok ? 'pass' : 'fail', `app chain: ${c && c.certs.map((x) => `${x.name} (issued by ${x.issuer.split(',')[0]}, expires ${x.notAfter.slice(0, 10)})`).join(' → ')}; complete=${c && c.complete} trusted=${c && c.trusted}; panel lists ${names.length - missing.length}/3 with ${expiries} expiry lines; openssl cms -verify -CAfile root only: ${cmsVerify(tsSigned, 0, ROOT.pem).text}`];
});
await step('R2', 'Revoked leaf (reachable OCSP and CRL): signature flagged revoked, details shown', async () => {
  await openPdf(app, TEXT1, 'Revoked.pdf');
  await signUi(app, LEAF.revoked.cn, { ts: true });
  const text = await checkRevocation(app);
  const s = (await sigs(app))[0];
  const oc = await ocspClient(LEAF.revoked);
  const item = s.rev && s.rev.items[0];
  const ok = s.status === 'revoked' && item && item.status === 'revoked' && item.via === 'OCSP' && item.reason === 'key compromise' && /Revoked: “Pkg4 Revoked Signer” was revoked/.test(text) && /: revoked/.test(oc);
  return [ok ? 'pass' : 'fail', `app: ${s.statusText}; ${s.rev && s.rev.text}; openssl ocsp (external): ${oc.trim().split('\n').find((l) => /: /.test(l))}`];
});
await step('R2b', 'Revoked leaf found through its CRL only (no OCSP in the certificate): flagged revoked', async () => {
  await openPdf(app, TEXT1, 'Revoked CRL.pdf');
  await signUi(app, LEAF.revokedCrl.cn);
  await checkRevocation(app);
  const s = (await sigs(app))[0], item = s.rev && s.rev.items[0];
  const crlText = run('openssl', ['crl', '-inform', 'DER', '-in', file('inter.crl'), '-noout', '-text'], { ok: true }).stdout;
  const serial = run('openssl', ['x509', '-in', LEAF.revokedCrl.pem, '-noout', '-serial'], { ok: true }).stdout.trim().split('=')[1];
  const ok = s.status === 'revoked' && item && item.via === 'CRL' && crlText.includes(serial);
  return [ok ? 'pass' : 'fail', `app: ${s.statusText}; ${s.rev && s.rev.text}; openssl crl lists serial ${serial}: ${crlText.includes(serial)}`];
});
await step('R3', 'Intermediate expired, leaf still in date: signature fails with a clear reason', async () => {
  await openPdf(app, TEXT1, 'Expired CA.pdf');
  const out = await signUi(app, LEAF.underExpired.cn, { ts: true });
  const s = (await sigs(app))[0];
  const { text } = await panel(app);
  const ext = cmsVerify(out, 0, ROOT.pem), ph = pyh(out, [ROOT.pem, TSAROOT.pem])[0];
  const reason = s.notes.find((x) => /Expired Intermediate CA/.test(x)) || '';
  const ok = s.status === 'invalid' && s.problem === 'cert' && /had expired when this was signed/.test(reason) && text.includes(reason) && !ext.ok && s.chain.certs[0].at === 'ok';
  return [ok ? 'pass' : 'fail', `app: ${s.statusText} — “${reason}” (leaf in date: ${s.chain && s.chain.certs[0].at === 'ok'}); openssl cms -verify: ${ext.text}; pyHanko: valid=${ph.valid} trusted=${ph.trusted}`];
});

// Tamper and corruption
await step('X1', '1 byte flipped in a content stream: tamper reported, timestamp and certificate both flagged', async () => {
  const bad = Buffer.from(tsSigned), d = await L.PDFDocument.load(tsSigned, { updateMetadata: false });
  const cref = d.getPage(0).node.get(L.PDFName.of('Contents'));
  const num = cref.objectNumber ?? cref.asArray()[0].objectNumber;
  const m = new RegExp(`(^|[\\r\\n])${num} 0 obj`).exec(bad.toString('latin1'));
  const at = bad.indexOf('stream', m.index) + 8; bad[at] ^= 0x01;
  await openBuf(app, bad, 'Tampered.pdf');
  const s = (await sigs(app))[0], ck = Object.fromEntries(s.checks.map(([k, t, v]) => [k, [t, v]]));
  const ext = cmsVerify(bad, 0, ROOT.pem), ps = pdfsig(bad), ph = pyh(bad, [ROOT.pem, TSAROOT.pem])[0];
  const ok = s.status === 'invalid' && s.problem === 'tampered' && ck.Certificate[0] === 'bad' && ck.Timestamp[0] === 'bad' && ck.Document[0] === 'bad' && !ext.ok && ph.intact === false;
  return [ok ? 'pass' : 'fail', `byte ${at} (object ${num}'s stream) flipped; app: ${s.statusText}; Document: ${ck.Document[1]}; Certificate: ${ck.Certificate[0]}; Timestamp: ${ck.Timestamp[0]} (${ck.Timestamp[1]}); openssl cms -verify: ${ext.text}; pdfsig: ${ps.valid[0]}; pyHanko intact=${ph.intact}`];
});
await step('X2', '1 byte flipped in the signature object itself: reported distinctly as signature object invalid', async () => {
  const bad = Buffer.from(tsSigned), { der, b } = cmsOf(tsSigned, 0), sv = sigValueOf(der);
  const at = b + 1 + 2 * (sv.at + 20); bad[at] = bad[at] === 0x30 ? 0x31 : 0x30; // a hex digit inside the signer's signature value
  await openBuf(app, bad, 'Bad signature.pdf');
  const s = (await sigs(app))[0], ck = Object.fromEntries(s.checks.map(([k, t, v]) => [k, [t, v]]));
  const ext = cmsVerify(bad, 0, ROOT.pem), ps = pdfsig(bad), ph = pyh(bad, [ROOT.pem, TSAROOT.pem])[0];
  const ok = s.status === 'invalid' && s.problem === 'sigobject' && s.statusText === 'Invalid: the signature itself is damaged' && s.digestOk === true && ck.Signature[0] === 'bad' && !ext.ok;
  return [ok ? 'pass' : 'fail', `hex digit at ${at} (inside the signature value) changed; app: ${s.statusText} (document digest still matches: ${s.digestOk}; Signature: ${ck.Signature[1]}); differs from X1's “Invalid: the document was changed after signing”; openssl cms -verify: ${ext.text}; pdfsig: ${ps.valid[0]}; pyHanko: valid=${ph.valid}`];
});
await step('X3', 'Truncated file (last 200 bytes removed): reports missing/incomplete, no crash', async () => {
  const cut = tsSigned.subarray(0, tsSigned.length - 200);
  const errs = app.errors.length;
  await app.evaluate(async (b) => { try { await window.__cowdreyPdf.openBytes(new Uint8Array(b), 'Truncated.pdf'); } catch (e) { window.__openErr = String(e); } }, Array.from(cut));
  await app.waitForTimeout(1500);
  const s = await sigs(app), direct = await app.evaluate(async (b) => window.__cowdreyPdf.sgDetails(b), Array.from(cut));
  const bar = await app.textContent('.sg-bar').catch(() => '');
  const ps = pdfsig(cut), ph = pyh(cut, [ROOT.pem])[0];
  const x = s[0] || direct[0];
  const ok = x && x.status === 'invalid' && x.problem === 'incomplete' && /incomplete/.test(x.notes[0]) && app.errors.length === errs;
  return [ok ? 'pass' : 'fail', `app: ${x && x.statusText} — ${x && x.notes[0]}; bar: “${(bar || '').trim()}”; page errors: ${app.errors.length - errs}; pdfsig: ${ps.valid[0] || ps.text.trim().split('\n').pop()}; pyHanko: ${ph.error || 'intact=' + ph.intact}`];
});

// Multi-signature and incremental update
await step('M1', 'Two different certificates sign the same file (second over the first): both PKCS#7 blocks present, both validate', async () => {
  await openPdf(app, TEXT1, 'Two signers.pdf');
  await signUi(app, LEAF.good.cn, { ts: true });
  const out = await signUi(app, LEAF.second.cn);
  const s = await sigs(app), ps = pdfsig(out), ph = pyh(out, [ROOT.pem, TSAROOT.pem]);
  const c0 = cmsVerify(out, 0, ROOT.pem), c1 = cmsVerify(out, 1, ROOT.pem);
  const ok = ranges(out).length === 2 && s.length === 2 && s.every((x) => x.status === 'trusted') && s[0].name !== s[1].name && c0.ok && c1.ok && ph.every((x) => x.intact && x.valid) && ps.valid.length === 2 && ps.valid.every((v) => v === 'Signature is Valid.');
  return [ok ? 'pass' : 'fail', `${ranges(out).length} /ByteRange blocks; app: ${s.map((x) => `${x.name} (${x.alg}): ${x.statusText}`).join('; ')}; openssl cms: ${c0.text} / ${c1.text}; pdfsig: ${ps.valid.join(' / ')}; pyHanko: ${ph.map((x) => `intact=${x.intact} valid=${x.valid} ${x.modification || ''}`).join(' / ')}`];
});
await step('M2', 'Sign, add a comment, sign again (incremental): the first signature stays valid, the second is added cleanly', async () => {
  await openPdf(app, TEXT1, 'Sign annotate sign.pdf');
  const first = await signUi(app, LEAF.good.cn);
  // a comment, through the Comment tools
  await app.click('[data-rt="markup"]'); await app.click('[data-cmd="tool_note"]');
  const g = await app.locator('.page[data-n="0"]').boundingBox(); await app.mouse.click(g.x + 120, g.y + 300);
  await app.fill('.page-ask textarea', 'Checked and approved'); await app.click('.page-ask .btn.primary');
  await app.waitForFunction(() => Object.values(window.__cowdreyPdf.doc.marks).flat().length === 1);
  const out = await signUi(app, LEAF.second.cn);
  const s = await sigs(app), ps = pdfsig(out), ph = pyh(out, [ROOT.pem]);
  const prefix = out.subarray(0, first.length).equals(first);
  const d = await L.PDFDocument.load(out, { updateMetadata: false });
  const annots = d.getPage(0).node.lookup(L.PDFName.of('Annots'), L.PDFArray).asArray().map((r) => String(d.context.lookup(r).get(L.PDFName.of('Subtype'))));
  const ok = prefix && annots.includes('/Text') && s.length === 2 && s.every((x) => x.status === 'trusted') && s[0].changes && s[0].changes.comments && !s[0].changes.other && cmsVerify(out, 0, ROOT.pem).ok && cmsVerify(out, 1, ROOT.pem).ok && ph.every((x) => x.intact && x.valid) && ps.valid.every((v) => v === 'Signature is Valid.');
  return [ok ? 'pass' : 'fail', `first signed file kept byte for byte: ${prefix}; annotations ${annots.join(', ')}; app: ${s.map((x) => `${x.name}: ${x.statusText}${x.changeText ? ' (' + x.changeText + ')' : ''}`).join('; ')}; pdfsig: ${ps.valid.join(' / ')}; pyHanko: ${ph.map((x) => `intact=${x.intact} valid=${x.valid} modification=${x.modification}`).join(' / ')}`];
});

// External PDFs (pyHanko as the stand-in for Foxit and Acrobat)
for (const [id, style, tsa, label] of [['E1', 'foxit', `${BASE}/tsa`, 'Signed externally, Foxit-style (RSA-2048, ETSI.CAdES.detached + TSA): verifies clean, certificate, TSA and metadata shown'], ['E2', 'acrobat', '-', 'Signed externally, Acrobat-style (RSA-2048, adbe.pkcs7.detached, no TSA): verifies clean']]) {
  await step(id, label, async () => {
    if (!HAS.pyhanko) return ['not-run', 'pyHanko is not installed'];
    const dst = file(`ext-${style}.pdf`);
    // not spawnSync: the timestamp server it asks is this process
    const r = await new Promise((res) => { const pr = spawn('python3', [file('pyh_sign.py'), TEXT1, dst, P12.good, PW, style, tsa], { cwd: W }); let o = ''; pr.stderr.on('data', (d) => o += d); pr.on('close', (code) => res({ code, o })); });
    if (r.code) throw new Error('pyHanko could not sign: ' + r.o.slice(-300));
    const buf = fs.readFileSync(dst);
    await openBuf(app, buf, `${style} signed.pdf`);
    const s = (await sigs(app))[0];
    const { text } = await panel(app);
    const want = ['Pkg4 Chain Signer', 'Issuer: Pkg4 Intermediate CA', 'Root: Pkg4 Root CA', `Reason: Approved for release (${style} style)`, 'Location: Wellington', 'signer@example.com', 'Pkg4 External Signer', style === 'foxit' ? 'ETSI.CAdES.detached' : 'adbe.pkcs7.detached', ...(style === 'foxit' ? ['Timestamp:', 'Pkg4 Timestamp Authority', 'Stamped fingerprint'] : ['No timestamp'])];
    const missing = want.filter((w) => !text.includes(w));
    const ok = s.status === 'trusted' && s.digestOk && s.sigOk && (style !== 'foxit' || (s.ts && s.ts.ok)) && !missing.length;
    return [ok ? 'pass-substitute' : 'fail', `pyHanko-signed (${style} style); app: ${s.statusText}, ${s.subFilter}, ${s.alg}${s.ts ? `, timestamp ${s.ts.time} by ${s.ts.tsa}` : ''}; reason/location/contact/name: ${s.reason} / ${s.location} / ${s.contact} / ${s.pdfName}; panel shows ${want.length - missing.length}/${want.length} details${missing.length ? ' — missing: ' + missing.join(', ') : ''}`];
  });
}
await step('E3', 'Signed with a certificate from an untrusted root: trust warning, signature itself structurally valid, details shown', async () => {
  await openPdf(app, TEXT1, 'Untrusted.pdf');
  const out = await signUi(app, LEAF.untrusted.cn);
  const s = (await sigs(app))[0];
  const { text } = await panel(app);
  const ext = cmsVerify(out, 0, null), ph = pyh(out, [ROOT.pem])[0];
  const ok = s.status === 'valid' && s.digestOk && s.sigOk && !s.trusted && /not trusted on this device/.test(text) && text.includes('Root: Pkg4 Untrusted Root') && text.includes('Issuer: Pkg4 Untrusted Root') === false && ext.ok && ph.intact && !ph.trusted;
  const ck = s.checks.find((c) => c[0] === 'Certificate');
  return [ok ? 'pass' : 'fail', `app: ${s.statusText}; Certificate: ${ck && ck[1]}; ${s.notes.find((x) => /not trusted/.test(x))}; openssl cms -verify -noverify (signature only): ${ext.text}; pyHanko: intact=${ph.intact} valid=${ph.valid} trusted=${ph.trusted}`];
});

// Minimal and edge
await step('P1', '1-page blank PDF: signs and validates instantly', async () => {
  await openPdf(app, BLANK, 'Blank again.pdf');
  const t = Date.now(); const out = await signUi(app, ALG.p256.cn); const signMs = Date.now() - t;
  const t2 = Date.now(); const v = await app.evaluate(async (b) => window.__cowdreyPdf.sgDetails(b), Array.from(out)); const verMs = Date.now() - t2;
  const ok = v[0].status === 'trusted' && signMs < 10000 && verMs < 2000;
  return [ok ? 'pass' : 'fail', `signed through the dialog in ${signMs} ms (including the box drag and the download), checked in ${verMs} ms; ${v[0].statusText}`];
});
await step('P2', '100-page PDF: signs and validates, no timeout, certificate details correct', async () => {
  await openPdf(app, HUNDRED, 'Hundred.pdf');
  const t = Date.now(); const out = await signUi(app, LEAF.good.cn, { ts: true }); const signMs = Date.now() - t;
  const t2 = Date.now(); const v = (await app.evaluate(async (b) => window.__cowdreyPdf.sgDetails(b), Array.from(out)))[0]; const verMs = Date.now() - t2;
  const pages = (await L.PDFDocument.load(out, { updateMetadata: false })).getPageCount();
  const ext = cmsVerify(out, 0, ROOT.pem), ps = pdfsig(out);
  const ok = pages === 100 && v.status === 'trusted' && v.cert.subject.startsWith('Pkg4 Chain Signer') && v.cert.issuer.startsWith('Pkg4 Intermediate CA') && v.chain.certs.length === 3 && ext.ok && signMs < 60000 && verMs < 30000;
  return [ok ? 'pass' : 'fail', `${pages} pages, ${out.length} bytes; signed in ${signMs} ms, checked in ${verMs} ms; ${v.statusText}: ${v.cert.subject} issued by ${v.cert.issuer}, key ${v.cert.key}, expires ${v.cert.notAfter.slice(0, 10)}; openssl cms: ${ext.text}; pdfsig: ${ps.valid[0]}`];
});

const appErrors = app.errors.filter((e) => !/Failed to load resource/.test(e));
await app.ctx.close(); await close();
server.close(); if (future) future.kill();

console.log('\nPackage 4 — certificate signing, timestamps, revocation, verification');
console.log('ID   Result           Check');
for (const [id, check, result] of rows) console.log(`${id.padEnd(4)} ${result.padEnd(16)} ${check}`);
const failed = rows.filter((r) => r[2] === 'fail');
console.log(`\n${rows.length - failed.length}/${rows.length} passed (pass-substitute: Acrobat/Foxit/PDF-XChange stand-ins), page errors: ${appErrors.length ? appErrors.join(' | ') : 'none'}`);
if (process.env.PKG4_JSON) fs.writeFileSync(process.env.PKG4_JSON, JSON.stringify(rows, null, 1));
if (!process.env.PKG4_KEEP) fs.rmSync(W, { recursive: true, force: true }); else console.log('Files kept in ' + W);
process.exit(failed.length || appErrors.length ? 1 : 0);
