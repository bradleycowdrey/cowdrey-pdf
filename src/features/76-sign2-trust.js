/* ---------------- certificate signatures, part 2: certificate chains, revocation, timestamp details, Ed25519 ----------------
   Used by 76-sign.js when it checks a signature.

   The chain: from the signer's certificate up, each issuer is looked for among the certificates in the signature and
   the certificates trusted on this device (a trusted root need not be in the signature), and its signature on the
   certificate below is checked. Every certificate of the chain must have been valid when the document was signed:
   at the time of the timestamp when there is one (a certificate that expired since still counts), else at the time
   the signature says. A timestamp's time is relied on only when its authority is trusted on this device (its chain
   reaches a trusted certificate, and its certificate is one for timestamps); otherwise the Timestamp line warns and
   the signer's clock is used, since anyone can run a timestamp server and backdate. An issuer must be a certificate authority. A signature is trusted when its chain reaches a
   certificate trusted on this device.

   Revocation (CRL and OCSP) is checked only when asked: a setting in Signing IDs, or "Check revocation online" in the
   Signatures panel. It asks the servers each certificate names (its OCSP responder, else its CRL), sending the
   certificate's serial number and its issuer's fingerprints, never the document. In the apps the requests go through a
   native call (pki_fetch), so the servers need no CORS. A certificate revoked before the document was signed makes the
   signature Revoked; revoked after its timestamp, the signature still counts and a warning says when.

   Ed25519 (RFC 8419): pkijs has no Ed25519, so its CMS signatures are made and checked here with WebCrypto
   (Chromium 137+, Safari 17+). A device without it says so. */
const SG_ED = '1.3.101.112';
const SG_SIGALG = {
  '1.2.840.113549.1.1.1': 'RSA', '1.2.840.113549.1.1.5': 'RSA with SHA-1', '1.2.840.113549.1.1.11': 'RSA with SHA-256', '1.2.840.113549.1.1.12': 'RSA with SHA-384', '1.2.840.113549.1.1.13': 'RSA with SHA-512',
  '1.2.840.113549.1.1.10': 'RSA-PSS', '1.2.840.10045.4.3.2': 'ECDSA with SHA-256', '1.2.840.10045.4.3.3': 'ECDSA with SHA-384', '1.2.840.10045.4.3.4': 'ECDSA with SHA-512', [SG_ED]: 'Ed25519',
};
const SG_REASONS = ['unspecified', 'key compromise', 'CA compromise', 'affiliation changed', 'superseded', 'cessation of operation', 'certificate hold', '', 'removed from CRL', 'privilege withdrawn', 'AA compromise'];
const sgDer = (c) => new Uint8Array(c.toSchema(true).toBER(false));
const sgNameEq = (a, b) => { try { return sgEq(a.toSchema().toBER(false), b.toSchema().toBER(false)); } catch { return false; } };
const sgWhenS = (d) => d ? d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
const sgDay = (d) => d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';

// What kind of key a certificate has: RSA 2048, ECDSA P-384, Ed25519…
function sgKeyText(c) {
  const a = c.subjectPublicKeyInfo.algorithm, id = a.algorithmId;
  if (id === SG_ED) return 'Ed25519';
  if (id === '1.2.840.10045.2.1') { let o = ''; try { o = a.algorithmParams.valueBlock.toString(); } catch {} return 'ECDSA ' + ((SG_CURVES[o] || [])[0] || 'curve ' + o); }
  if (id === '1.2.840.113549.1.1.1' || id === '1.2.840.113549.1.1.10') {
    try { const m = sgStrip0(c.subjectPublicKeyInfo.parsedKey.modulus.valueBlock.valueHexView); return (id === '1.2.840.113549.1.1.10' ? 'RSA-PSS ' : 'RSA ') + m.length * 8; } catch { return 'RSA'; }
  }
  return 'Other (' + id + ')';
}
// The extensions that matter here
function sgExt(c) {
  const o = { ca: false, ocsp: [], crl: [], eku: [], ski: null, aki: null };
  for (const e of c.extensions || []) {
    const v = e.parsedValue;
    try {
      if (e.extnID === '2.5.29.19' && v) { o.ca = !!v.cA; o.pathLen = v.pathLenConstraint; }
      else if (e.extnID === '2.5.29.37' && v) o.eku = v.keyPurposes || [];
      else if (e.extnID === '2.5.29.14' && v) o.ski = sgHex(v.valueBlock.valueHexView);
      else if (e.extnID === '2.5.29.35' && v && v.keyIdentifier) o.aki = sgHex(v.keyIdentifier.valueBlock.valueHexView);
      else if (e.extnID === '1.3.6.1.5.5.7.1.1' && v) for (const d of v.accessDescriptions || []) { if (d.accessMethod === '1.3.6.1.5.5.7.48.1' && d.accessLocation.type === 6) o.ocsp.push(String(d.accessLocation.value)); }
      else if (e.extnID === '2.5.29.31' && v) for (const p of v.distributionPoints || []) for (const g of Array.isArray(p.distributionPoint) ? p.distributionPoint : []) { if (g.type === 6) o.crl.push(String(g.value)); }
    } catch {}
  }
  o.ocsp = o.ocsp.filter((u) => /^https?:\/\//i.test(u)); o.crl = o.crl.filter((u) => /^https?:\/\//i.test(u));
  return o;
}
// Ed25519 with WebCrypto: true/false, or null when this device has no Ed25519
async function sgEdVerify(spki, sig, data) {
  let key;
  try { key = await crypto.subtle.importKey('spki', new Uint8Array(spki.toSchema().toBER(false)), { name: 'Ed25519' }, false, ['verify']); }
  catch { return null; }
  try { return await crypto.subtle.verify({ name: 'Ed25519' }, key, new Uint8Array(sig), new Uint8Array(data)); } catch { return false; }
}
// Whether `issuer`'s key signed `cert` (a certificate, or anything with tbsView, signatureValue and signatureAlgorithm)
async function sgSignedBy(cert, issuer) {
  try {
    if (cert.signatureAlgorithm.algorithmId === SG_ED) return !!(await sgEdVerify(issuer.subjectPublicKeyInfo, cert.signatureValue.valueBlock.valueHexView, cert.tbsView));
    const { pkijs } = await sgLoadLibs();
    return !!(await pkijs.getCrypto(true).verifyWithPublicKey(cert.tbsView, cert.signatureValue, issuer.subjectPublicKeyInfo, cert.signatureAlgorithm));
  } catch { return false; }
}
// The certificates trusted on this device: [{ fp, name, der? }] (those trusted from a signature before 1.2 have no der)
const sgTrustRecs = async () => (await sgTx('trust', 'readonly', (s) => s.getAll()).catch(() => [])) || [];
// Fingerprints are worked out before the transaction (an await inside it would end it)
async function sgTrustAdd(der, name) { const fp = await sgFp(der); return sgTx('trust', 'readwrite', (s) => s.put({ fp, name, der: new Uint8Array(der), added: Date.now() })); }

// The chain from `leaf` up: { certs: [{ c, info, ext, key, trusted, at: 'ok'|'expired'|'early', now: … }], complete,
// trusted, problems: [text] (each one makes the signature invalid), notes: [text] }
async function sgBuildChain(leaf, pool, trust, at) {
  const { pkijs } = await sgLoadLibs();
  const fps = new Set(trust.map((r) => r.fp));
  const extra = []; for (const r of trust) if (r.der) try { extra.push(pkijs.Certificate.fromBER(new Uint8Array(r.der))); } catch {}
  const cands = [...(pool || []), ...extra];
  const chain = [leaf], out = { certs: [], complete: false, trusted: false, problems: [], notes: [] };
  for (let cur = leaf, hop = 0; hop < 10; hop++) {
    if (sgNameEq(cur.subject, cur.issuer) && await sgSignedBy(cur, cur)) { out.complete = true; break; }
    let up = null;
    for (const x of cands) {
      if (!sgNameEq(x.subject, cur.issuer) || chain.some((y) => sgEq(sgDer(y), sgDer(x)))) continue;
      if (await sgSignedBy(cur, x)) { up = x; break; }
    }
    if (!up) break;
    chain.push(up); cur = up;
  }
  const when = at || new Date(), now = new Date();
  for (let k = 0; k < chain.length; k++) {
    const c = chain[k], der = sgDer(c), info = await sgCertInfo(der), ext = sgExt(c);
    const state = (t) => t < info.notBefore ? 'early' : t > info.notAfter ? 'expired' : 'ok';
    const x = { c, der, info, ext, key: sgKeyText(c), trusted: fps.has(info.fp), at: state(when), now: state(now), alg: SG_SIGALG[c.signatureAlgorithm.algorithmId] || c.signatureAlgorithm.algorithmId };
    out.certs.push(x);
    const who = k ? `The certificate “${info.name}”, which vouches for the signer’s,` : 'The signer’s certificate';
    if (x.at === 'expired') out.problems.push(`${who} had expired when this was signed (it expired on ${sgDay(info.notAfter)}).`);
    else if (x.at === 'early') out.problems.push(`${who} was not valid yet when this was signed (it is valid from ${sgDay(info.notBefore)}).`);
    else if (x.now === 'expired' && !k) out.notes.push(`The signer’s certificate has expired since (on ${sgDay(info.notAfter)}). It was valid when this was signed.`);
    if (k && !ext.ca && !(info.selfSigned && k === chain.length - 1 && !(c.extensions || []).some((e) => e.extnID === '2.5.29.19'))) out.problems.push(`The certificate “${info.name}” is not allowed to issue certificates, so the chain is broken.`);
  }
  out.trusted = out.certs.some((x) => x.trusted);
  const top = out.certs[out.certs.length - 1];
  if (!out.complete) out.notes.push(`The certificate that issued “${top.info.name}” is not in the signature or trusted on this device, so the chain stops there.`);
  else if (!out.trusted && out.certs.length > 1) out.notes.push(`The chain ends at “${top.info.name}”, which is not trusted on this device.`);
  return out;
}

/* ---- revocation ---- */
// GET (no body) or POST to a revocation server: fetch on the web, a native call in the apps (no CORS needed there)
async function sgNetFetch(url, body, type) {
  if (!/^https?:\/\//i.test(url)) throw new SgError('Not a web address: ' + url);
  if (NATIVE && !ANDROID_APP) {
    try { return b64ToBytes(await NATIVE.core.invoke('pki_fetch', { url, body: body ? bytesToB64(body) : null, contentType: type || null })); }
    catch (e) { throw new SgError(`${new URL(url).host} could not be reached (${e && e.message ? e.message : e})`); }
  }
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 20000);
  let r;
  try { r = await fetch(url, { method: body ? 'POST' : 'GET', ...(body ? { headers: { 'Content-Type': type }, body } : {}), cache: 'no-store', credentials: 'omit', signal: ac.signal }); }
  catch { throw new SgError(`${new URL(url).host} could not be reached, or it blocks requests from web pages (the apps can ask it)`); }
  finally { clearTimeout(t); }
  if (!r.ok) throw new SgError(`${new URL(url).host} said no (error ${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}
const sgPemOrDer = (u) => { const t = sgLatin1(u.subarray(0, 64)); if (!/-----BEGIN/.test(t)) return u; const b = sgLatin1(u).replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''); return b64ToBytes(b); };
const sgRevTime = (x) => { try { return x.toDate ? x.toDate() : x.value instanceof Date ? x.value : new Date(x); } catch { return null; } };
// OCSP for `cert`, issued by `issuer`: { status: 'good'|'revoked'|'unknown', at, reason, produced }
const SG_OCSP_NONCE = '1.3.6.1.5.5.7.48.1.2';
async function sgOcsp(url, cert, issuer) {
  const { pkijs, asn1js } = await sgLoadLibs();
  const req = new pkijs.OCSPRequest();
  await req.createForCertificate(cert, { hashAlgorithm: 'SHA-1', issuerCertificate: issuer });
  // a nonce (RFC 8954), so an old answer can't be passed off as a new one
  const nonce = new asn1js.OctetString({ valueHex: crypto.getRandomValues(new Uint8Array(16)).buffer }).toBER(false);
  req.tbsRequest.requestExtensions = [new pkijs.Extension({ extnID: SG_OCSP_NONCE, extnValue: nonce })];
  const answer = await sgNetFetch(url, new Uint8Array(req.toSchema(true).toBER(false)), 'application/ocsp-request');
  let or, basic;
  try { or = pkijs.OCSPResponse.fromBER(answer); } catch { throw new SgError('The OCSP answer could not be read'); }
  const code = or.responseStatus.valueBlock.valueDec;
  if (code !== 0) throw new SgError(`The OCSP server could not answer (${['', 'malformed request', 'internal error', 'try later', '', 'signature required', 'unauthorized'][code] || 'code ' + code})`);
  try { basic = pkijs.BasicOCSPResponse.fromBER(or.responseBytes.response.valueBlock.valueHexView); } catch { throw new SgError('The OCSP answer could not be read'); }
  // who signed the answer: the issuer itself, or a responder the issuer made for this (id-kp-OCSPSigning)
  const rid = basic.tbsResponseData.responderID, cands = [issuer, ...(basic.certs || [])];
  let signer = null;
  for (const c of cands) {
    if (rid instanceof pkijs.RelativeDistinguishedNames ? sgNameEq(c.subject, rid) : rid instanceof asn1js.OctetString && sgEq(await sgDigest('SHA-1', c.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView), rid.valueBlock.valueHexView)) { signer = c; break; }
  }
  if (!signer) throw new SgError('The OCSP answer is signed by someone else');
  if (signer !== issuer && !sgEq(sgDer(signer), sgDer(issuer)) && !((await sgSignedBy(signer, issuer)) && sgExt(signer).eku.includes('1.3.6.1.5.5.7.3.9'))) throw new SgError('The OCSP answer is signed by someone the issuer did not authorise');
  const sigOk = basic.signatureAlgorithm.algorithmId === SG_ED ? await sgEdVerify(signer.subjectPublicKeyInfo, basic.signature.valueBlock.valueHexView, basic.tbsResponseData.tbsView)
    : await pkijs.getCrypto(true).verifyWithPublicKey(basic.tbsResponseData.tbsView, basic.signature, signer.subjectPublicKeyInfo, basic.signatureAlgorithm).catch(() => false);
  if (!sigOk) throw new SgError('The OCSP answer’s signature is not valid');
  const one = (basic.tbsResponseData.responses || []).find((r) => r.certID.serialNumber.isEqual(cert.serialNumber));
  if (!one) throw new SgError('The OCSP answer is about another certificate');
  // fresh: its nonce is ours, or (a server that ignores nonces) it is in date
  const echo = (basic.tbsResponseData.responseExtensions || []).find((e) => e.extnID === SG_OCSP_NONCE);
  if (echo && !sgEq(echo.extnValue.valueBlock.valueHexView, new Uint8Array(nonce))) throw new SgError('The OCSP answer is an old one (its nonce is not ours)');
  const t = Date.now(), skew = 5 * 60000, tu = one.thisUpdate ? +one.thisUpdate : NaN, nu = one.nextUpdate ? +one.nextUpdate : NaN;
  if (!(tu <= t + skew)) throw new SgError('The OCSP answer is dated in the future');
  if (nu < t - skew) throw new SgError(`The OCSP answer is out of date (it was good until ${sgWhenS(one.nextUpdate)})`);
  if (!echo && isNaN(nu) && tu < t - 60 * 60000) throw new SgError(`The OCSP answer is out of date (from ${sgWhenS(one.thisUpdate)})`);
  const st = one.certStatus, tag = st && st.idBlock ? st.idBlock.tagNumber : 2, out = { produced: basic.tbsResponseData.producedAt, via: 'OCSP' };
  if (tag === 0) out.status = 'good';
  else if (tag === 1) {
    out.status = 'revoked';
    const parts = st.valueBlock.value || [];
    out.at = parts[0] ? sgRevTime(parts[0]) : null;
    const rs = parts.find((p) => p.idBlock && p.idBlock.tagClass === 3 && p.idBlock.tagNumber === 0);
    if (rs) try { const e = rs.valueBlock.value ? rs.valueBlock.value[0] : null; const n = e ? e.valueBlock.valueDec : asn1js.fromBER(rs.valueBlock.valueHexView).result.valueBlock.valueDec; out.reason = SG_REASONS[n] || ''; } catch {}
  } else out.status = 'unknown';
  return out;
}
// The CRL at `url` for `cert`, issued by `issuer`
async function sgCrl(url, cert, issuer) {
  const { pkijs } = await sgLoadLibs();
  const der = sgPemOrDer(await sgNetFetch(url));
  let crl; try { crl = pkijs.CertificateRevocationList.fromBER(der); } catch { throw new SgError('The revocation list could not be read'); }
  if (!sgNameEq(crl.issuer, issuer.subject) || !(await sgSignedBy(crl, issuer))) throw new SgError('The revocation list is not signed by the certificate’s issuer');
  const out = { via: 'CRL', produced: crl.thisUpdate && crl.thisUpdate.value, next: crl.nextUpdate && crl.nextUpdate.value };
  if (out.produced && out.produced > Date.now() + 5 * 60000) throw new SgError('The revocation list is dated in the future');
  const e = (crl.revokedCertificates || []).find((r) => r.userCertificate.isEqual(cert.serialNumber));
  if (!e) { if (out.next && out.next < Date.now() - 5 * 60000) throw new SgError(`The revocation list is out of date (it was good until ${sgWhenS(out.next)})`); out.status = 'good'; return out; }
  out.status = 'revoked'; out.at = e.revocationDate && e.revocationDate.value;
  const rc = (e.crlEntryExtensions && e.crlEntryExtensions.extensions || []).find((x) => x.extnID === '2.5.29.21');
  if (rc) try { const { asn1js } = await sgLoadLibs(); out.reason = SG_REASONS[asn1js.fromBER(rc.extnValue.valueBlock.valueHexView).result.valueBlock.valueDec] || ''; } catch {}
  return out;
}
const sgRevCache = new Map();
// The hosts a revocation check would ask, for the chain of a checked signature
const sgRevHosts = (chain) => [...new Set((chain || []).slice(0, -1).flatMap((x) => [...x.ext.ocsp.slice(0, 1), ...(x.ext.ocsp.length ? [] : x.ext.crl.slice(0, 1))]).map((u) => { try { return new URL(u).host; } catch { return ''; } }).filter(Boolean))];
// Checks every certificate of a chain that has an issuer above it: OCSP first, then the CRL.
// { verdict: 'good'|'revoked'|'revokedAfter'|'unknown'|'none', items: [{ name, status, via, host, at, reason, error }] }
async function sgRevocation(chain, when, stamped) {
  const items = [];
  for (let k = 0; k < chain.length; k++) {
    const x = chain[k], up = chain[k + 1];
    if (!up) { if (!x.info.selfSigned) items.push({ name: x.info.name, status: 'unknown', error: 'Its issuer is not known, so it can’t be checked' }); continue; }
    const tries = [...x.ext.ocsp.map((u) => ['OCSP', u]), ...x.ext.crl.map((u) => ['CRL', u])];
    if (!tries.length) { items.push({ name: x.info.name, status: 'none' }); continue; }
    let res = null; const errors = [];
    for (const [via, url] of tries) {
      const key = via + ' ' + url + ' ' + x.info.serial;
      try {
        if (!sgRevCache.has(key)) sgRevCache.set(key, via === 'OCSP' ? sgOcsp(url, x.c, up.c) : sgCrl(url, x.c, up.c));
        res = { ...(await sgRevCache.get(key)), host: new URL(url).host, url };
        if (res.status === 'unknown' && via === 'OCSP') { errors.push(`${res.host}: does not know this certificate`); res = null; continue; }
        break;
      } catch (e) { sgRevCache.delete(key); errors.push(e.message || String(e)); }
    }
    items.push(res ? { name: x.info.name, ...res } : { name: x.info.name, status: 'unknown', error: errors.join('; ') });
  }
  let verdict = 'good';
  const revoked = items.filter((i) => i.status === 'revoked');
  if (revoked.length) verdict = stamped && when && revoked.every((i) => i.at && i.at > when) ? 'revokedAfter' : 'revoked';
  else if (items.some((i) => i.status === 'unknown')) verdict = 'unknown';
  else if (items.every((i) => i.status === 'none')) verdict = 'none';
  return { verdict, items, checkedAt: new Date() };
}
function sgRevText(rev, when) {
  if (!rev) return 'Not checked';
  const r = rev.items.find((i) => i.status === 'revoked');
  const why = (i) => i.reason ? ` (${i.reason})` : '';
  if (rev.verdict === 'revoked') return `Revoked: “${r.name}” was revoked${r.at ? ' on ' + sgWhenS(r.at) : ''}${why(r)}${when && r.at && r.at > when ? ', and the signing time is not proven by a timestamp' : ''} (${r.via} from ${r.host}).`;
  if (rev.verdict === 'revokedAfter') return `Warning: “${r.name}” was revoked on ${sgWhenS(r.at)}${why(r)}, after the timestamp (${sgWhenS(when)}). The signature was made before that, so it still counts (${r.via} from ${r.host}).`;
  if (rev.verdict === 'none') return 'Not checked: the certificates name no revocation service.';
  const good = rev.items.filter((i) => i.status === 'good');
  if (rev.verdict === 'unknown') { const u = rev.items.find((i) => i.status === 'unknown'); return `Not checked for “${u.name}”: ${u.error || 'no answer'}.${good.length ? ` Not revoked: ${good.map((i) => `“${i.name}” (${i.via} from ${i.host})`).join(', ')}.` : ''}`; }
  return `Not revoked: ${good.map((i) => `“${i.name}” (${i.via} from ${i.host})`).join(', ')}.`;
}

/* ---- Ed25519 CMS (RFC 8419: SHA-512 for the message digest, the signature over the signed attributes) ---- */
async function sgEdSignCms(pkijs, asn1js, sd, key) {
  const si = sd.signerInfos[0];
  si.digestAlgorithm = new pkijs.AlgorithmIdentifier({ algorithmId: SG_OID.sha512 });
  si.signatureAlgorithm = new pkijs.AlgorithmIdentifier({ algorithmId: SG_ED });
  sd.digestAlgorithms = [new pkijs.AlgorithmIdentifier({ algorithmId: SG_OID.sha512 })];
  const enc = new Uint8Array(si.signedAttrs.toSchema(true).toBER(false)); si.signedAttrs.encodedValue = enc.slice().buffer;
  enc[0] = 0x31;
  let sig;
  try { sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, enc)); } catch { throw new SgError('This device can’t sign with Ed25519 keys.'); }
  si.signature = new asn1js.OctetString({ valueHex: sig.buffer });
}
// The signer's signature over the signed attributes alone (not the content): true/false/null (can't tell)
async function sgAttrsSigOk(si, signer) {
  if (!si.signedAttrs || !signer) return null;
  const v = new Uint8Array(si.signedAttrs.encodedValue).slice(); if (!v.length) return null;
  v[0] = 0x31;
  const id = si.signatureAlgorithm.algorithmId;
  if (id === SG_ED) return sgEdVerify(signer.subjectPublicKeyInfo, si.signature.valueBlock.valueHexView, v);
  try {
    const { pkijs } = await sgLoadLibs();
    const hash = SG_HASH[si.digestAlgorithm.algorithmId];
    // rsaEncryption as the signature algorithm (common in CMS): the hash is the digest algorithm's
    return !!(await pkijs.getCrypto(true).verifyWithPublicKey(v, si.signature, signer.subjectPublicKeyInfo, si.signatureAlgorithm, id === '1.2.840.113549.1.1.1' || id === '1.2.840.10045.2.1' ? hash : undefined));
  } catch { return false; }
}

/* ---- timestamp details ---- */
const SG_HASHNAME = { [SG_OID.sha1]: 'SHA-1', [SG_OID.sha256]: 'SHA-256', [SG_OID.sha384]: 'SHA-384', [SG_OID.sha512]: 'SHA-512' };
// The ESS signing-certificate attribute (RFC 3161 / RFC 5035) names the certificate the timestamp authority signed
// with by its hash. When it is there it must be the certificate the token verified with. Missing: nothing to compare.
async function sgEssOk(si, cert) {
  try {
    const at = si.signedAttrs && si.signedAttrs.attributes.find((x) => x.type === '1.2.840.113549.1.9.16.2.47' || x.type === '1.2.840.113549.1.9.16.2.12');
    if (!at) return true;
    const v2 = at.type === '1.2.840.113549.1.9.16.2.47';
    const first = at.values[0].valueBlock.value[0].valueBlock.value[0], parts = first.valueBlock.value;
    let alg = v2 ? 'SHA-256' : 'SHA-1', k = 0;
    if (v2 && parts[0] && parts[0].idBlock.tagClass === 1 && parts[0].idBlock.tagNumber === 16) { // hashAlgorithm given (else SHA-256)
      alg = SG_HASH[parts[0].valueBlock.value[0].valueBlock.toString()]; k = 1;
    }
    if (!alg) return false;
    const want = parts[k].valueBlock.valueHexView;
    return sgEq(await sgDigest(alg, new Uint8Array(cert.toSchema(false).toBER(false))), want);
  } catch { return false; }
}
async function sgTokenDetails(tst, sd, trust, signer) {
  const out = { serial: '', policy: '', hash: '', imprint: '', tsaChain: null };
  try { out.serial = sgHex(tst.serialNumber.valueBlock.valueHexView).toUpperCase(); } catch {}
  try { out.policy = tst.policy; } catch {}
  try { out.hash = SG_HASHNAME[tst.messageImprint.hashAlgorithm.algorithmId] || tst.messageImprint.hashAlgorithm.algorithmId; out.imprint = sgHex(tst.messageImprint.hashedMessage.valueBlock.valueHexView).toUpperCase(); } catch {}
  try { if (tst.accuracy) { const a = tst.accuracy; out.accuracy = [a.seconds && a.seconds + ' s', a.millis && a.millis + ' ms', a.micros && a.micros + ' µs'].filter(Boolean).join(' '); } } catch {}
  try {
    const certs = (sd.certificates || []).filter((c) => c.subject);
    // only the certificate the token verified with (no signer found: no chain, so the time is not relied on)
    if (signer) out.tsaChain = await sgBuildChain(signer, certs, trust, tst.genTime);
  } catch (e) { console.warn(e); }
  return out;
}
TEST_HOOKS.sgRevCacheClear = () => { sgRevCache.clear(); return true; };
