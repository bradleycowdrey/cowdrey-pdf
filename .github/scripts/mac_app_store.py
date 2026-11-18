"""Signing and App Store Connect steps for the Mac App Store build of Cowdrey.PDF (mac-app-store.yml).

  prepare     Checks the app record, adds the macOS platform (a MAC_OS App Store version) when the app has none,
              revokes the throwaway certificates an earlier run of this workflow made, makes a new private key,
              CSR and two certificates (Apple Distribution, Mac Installer Distribution), and a fresh Mac App Store
              provisioning profile for the bundle ID. Writes into OUT_DIR:
                app.p12, installer.p12 (password in P12_PASSWORD), embedded.provisionprofile, state.json
  wait-build  After the upload, waits until App Store Connect lists the build (BUILD_NUMBER) and prints its state.

Nothing is submitted for review. Environment: APPLE_API_ISSUER, APPLE_API_KEY (key ID), P8 (private key text),
OUT_DIR, P12_PASSWORD, STATE_IN (state.json of the previous run, if any), BUILD_NUMBER.

Throwaway certificates: each run signs on a fresh machine whose private key dies with it, so each run makes its own
certificates. Apple caps how many an account may hold, so the IDs this workflow created are kept in state.json on the
mac-app-store-log branch and revoked by the next run. Certificates made by a person or by other workflows are never
touched, except, when Apple refuses a new one for being over the limit, ones named "Created via API" that are more
than a day old (a run of a CI job is never that long).
"""
import base64, datetime, json, os, sys, time, urllib.error, urllib.parse, urllib.request

import jwt
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VERSION = json.load(open(os.path.join(ROOT, 'desktop', 'src-tauri', 'tauri.conf.json')))['version']
BUNDLE = 'com.bradcowdrey.cowdreypdf'
API = 'https://api.appstoreconnect.apple.com'
PROFILE_PREFIX = 'Cowdrey.PDF Mac App Store CI'


def token():
    now = int(time.time())
    return jwt.encode({'iss': os.environ['APPLE_API_ISSUER'].strip(), 'iat': now, 'exp': now + 900, 'aud': 'appstoreconnect-v1'},
                      os.environ['P8'].replace('\r', '').strip(), algorithm='ES256',
                      headers={'kid': os.environ['APPLE_API_KEY'].strip(), 'typ': 'JWT'})


class ApiError(Exception):
    def __init__(self, msg, code):
        super().__init__(msg)
        self.code = code


def call(method, path, body=None):
    url = path if path.startswith('http') else API + path
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        text = e.read().decode(errors='replace')
        try:
            text = '; '.join(f"{x.get('title')}: {x.get('detail')}" for x in json.loads(text)['errors'])
        except Exception:
            pass
        raise ApiError(f'{method} {path.split("?")[0]} -> HTTP {e.code}: {text}', e.code)


def rel(type_, id_):
    return {'data': {'type': type_, 'id': id_}}


def app_record():
    apps = call('GET', f'/v1/apps?filter[bundleId]={BUNDLE}')['data']
    if not apps:
        sys.exit(f'BLOCKER: no app with bundle ID {BUNDLE} in App Store Connect.')
    return apps[0]


def ensure_mac_platform(app):
    """The same app record as iPhone and iPad (universal purchase): add macOS by creating a MAC_OS version."""
    vs = call('GET', f"/v1/apps/{app['id']}/appStoreVersions?filter[platform]=MAC_OS&limit=20")['data']
    if vs:
        print('macOS versions in App Store Connect: ' + ', '.join(
            f"{v['attributes']['versionString']} ({v['attributes'].get('appStoreState')})" for v in vs))
        return
    try:
        v = call('POST', '/v1/appStoreVersions', {'data': {'type': 'appStoreVersions',
                                                          'attributes': {'platform': 'MAC_OS', 'versionString': VERSION},
                                                          'relationships': {'app': rel('apps', app['id'])}}})['data']
        print(f"Added the macOS platform: App Store version {VERSION} for MAC_OS ({v['attributes'].get('appStoreState')}).")
    except ApiError as e:
        print(f'Could not add the macOS platform through the API: {e}')
        print('BLOCKER for the owner: in App Store Connect, open Apps > Cowdrey.PDF, click the + next to "iOS App" in the '
              f'sidebar (Add Platform), choose macOS, and enter version {VERSION}. Then run this workflow again.')


def bundle_id():
    b = [x for x in call('GET', f'/v1/bundleIds?filter[identifier]={BUNDLE}&limit=20')['data']
         if x['attributes']['identifier'] == BUNDLE]
    if not b:
        sys.exit(f'BLOCKER: the identifier {BUNDLE} is not registered under Certificates, Identifiers & Profiles.')
    print(f"Bundle ID {BUNDLE}: platform {b[0]['attributes'].get('platform')}")
    return b[0]


def list_certs():
    out, url = [], '/v1/certificates?limit=200&fields[certificates]=name,displayName,certificateType,expirationDate,serialNumber'
    while url:
        page = call('GET', url)
        out += page['data']
        url = page.get('links', {}).get('next')
    return out


def revoke(cid, why):
    try:
        call('DELETE', f'/v1/certificates/{cid}')
        print(f'Revoked {why} (…{cid[-4:]}).')
    except ApiError as e:
        if e.code == 404:
            print(f'{why} (…{cid[-4:]}) was already gone.')
        else:
            print(f'Could not revoke {why}: {e}')


def new_cert(key, kind, state):
    csr = (x509.CertificateSigningRequestBuilder()
           .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Cowdrey.PDF Mac App Store CI'),
                                    x509.NameAttribute(NameOID.COUNTRY_NAME, 'US')]))
           .sign(key, hashes.SHA256()))
    pem = csr.public_bytes(serialization.Encoding.PEM).decode()
    body = {'data': {'type': 'certificates', 'attributes': {'certificateType': kind, 'csrContent': pem}}}
    try:
        c = call('POST', '/v1/certificates', body)['data']
    except ApiError as e:
        if e.code != 409:
            raise
        print(f'Apple refused a new {kind} certificate: {e}')
        # Over the limit: free a slot from stale CI certificates of this type (more than a day old, "Created via API").
        cutoff = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=365 - 1)
        freed = False
        for x in list_certs():
            a = x['attributes']
            name = (a.get('name') or '') + ' ' + (a.get('displayName') or '')
            exp = a.get('expirationDate')
            # Apple certificates last a year: created more than a day ago means expiring before now + 364 days.
            if a.get('certificateType') == kind and 'Created via API' in name and exp and \
                    datetime.datetime.fromisoformat(exp.replace('Z', '+00:00')) < cutoff:
                revoke(x['id'], f'stale CI certificate {name.strip()} ({kind})')
                freed = True
                break
        if not freed:
            raise ApiError(f'{e}. BLOCKER for the owner: the account holds the most {kind} certificates Apple allows. '
                           'Revoke one you no longer use at developer.apple.com > Certificates, then run this again.', 409)
        c = call('POST', '/v1/certificates', body)['data']
    state['certificates'].append(c['id'])
    der = base64.b64decode(c['attributes']['certificateContent'])
    cert = x509.load_der_x509_certificate(der)
    cn = cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value
    print(f"New {kind} certificate: {cn}, expires {c['attributes'].get('expirationDate')} (…{c['id'][-4:]})")
    return c['id'], cert, cn


def p12(path, key, cert, password):
    enc = (serialization.PrivateFormat.PKCS12.encryption_builder().kdf_rounds(50000)
           .key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC).hmac_hash(hashes.SHA1()).build(password.encode()))
    open(path, 'wb').write(pkcs12.serialize_key_and_certificates(b'cowdrey-pdf-ci', key, cert, None, enc))


def prepare():
    out = os.environ['OUT_DIR']
    os.makedirs(out, exist_ok=True)
    app = app_record()
    print(f"App: {app['attributes']['name']} ({app['id']}), bundle {BUNDLE}, version {VERSION}")
    ensure_mac_platform(app)
    bid = bundle_id()

    # 1. Revoke the certificates the previous run of this workflow made, and delete this workflow's old profiles.
    try:
        prev = json.load(open(os.environ.get('STATE_IN') or '/nonexistent'))
    except Exception:
        prev = {}
    for cid in prev.get('certificates', []):
        revoke(cid, 'the previous run\'s certificate')
    for p in call('GET', f'/v1/profiles?filter[name]={urllib.parse.quote(PROFILE_PREFIX)}&limit=200')['data']:
        if p['attributes']['name'].startswith(PROFILE_PREFIX):
            try:
                call('DELETE', f"/v1/profiles/{p['id']}")
                print(f"Deleted the old profile {p['attributes']['name']}")
            except ApiError as e:
                print(f'Could not delete an old profile: {e}')
    summary = {}
    for x in list_certs():
        a = x['attributes']
        t = a.get('certificateType')
        summary[t] = summary.get(t, 0) + 1
        if t in ('DISTRIBUTION', 'MAC_APP_DISTRIBUTION', 'MAC_INSTALLER_DISTRIBUTION'):
            print(f"  {t}: {a.get('name')} / {a.get('displayName')}, expires {a.get('expirationDate')} (…{x['id'][-4:]})")
    print('Certificates on the account now: ' + ', '.join(f'{k} x{v}' for k, v in sorted(summary.items())))

    # 2. New key, two certificates. state.json is written straight away, so a later failure still lets the next
    #    run revoke them.
    state = {'certificates': []}
    state_path = os.path.join(out, 'state.json')
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    password = os.environ['P12_PASSWORD']
    try:
        # The Mac-only application certificate ("3rd Party Mac Developer Application") has its own allowance, so the
        # Apple Distribution certificates the iPhone build and people use are left alone. Apple Distribution is the
        # fallback: a Mac App Store profile accepts either.
        try:
            app_id, app_cert, app_cn = new_cert(key, 'MAC_APP_DISTRIBUTION', state)
        except ApiError as e:
            print(f'No Mac App Distribution certificate ({e}); trying Apple Distribution.')
            app_id, app_cert, app_cn = new_cert(key, 'DISTRIBUTION', state)
        json.dump(state, open(state_path, 'w'))
        p12(os.path.join(out, 'app.p12'), key, app_cert, password)
        # Its own key: one keychain can't import the same private key twice.
        key2 = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        _, inst_cert, inst_cn = new_cert(key2, 'MAC_INSTALLER_DISTRIBUTION', state)
        json.dump(state, open(state_path, 'w'))
        p12(os.path.join(out, 'installer.p12'), key2, inst_cert, password)
    finally:
        json.dump(state, open(state_path, 'w'))

    # 3. A Mac App Store profile for the bundle ID with the new Apple Distribution certificate.
    name = f"{PROFILE_PREFIX} {os.environ.get('GITHUB_RUN_NUMBER', 'local')}"
    try:
        prof = call('POST', '/v1/profiles', {'data': {'type': 'profiles', 'attributes': {'name': name, 'profileType': 'MAC_APP_STORE'},
                                                      'relationships': {'bundleId': rel('bundleIds', bid['id']),
                                                                        'certificates': {'data': [{'type': 'certificates', 'id': app_id}]}}}})['data']
    except ApiError as e:
        sys.exit(f'Could not create the Mac App Store profile: {e}\nIf this says the bundle ID is iOS only, the owner must '
                 f'open developer.apple.com > Identifiers > {BUNDLE} and make sure macOS is among its platforms.')
    open(os.path.join(out, 'embedded.provisionprofile'), 'wb').write(base64.b64decode(prof['attributes']['profileContent']))
    print(f"Profile: {name} ({prof['attributes'].get('profileState')}, expires {prof['attributes'].get('expirationDate')})")
    with open(os.environ.get('GITHUB_OUTPUT', os.devnull), 'a') as gh:
        sha1 = app_cert.fingerprint(hashes.SHA1()).hex().upper()
        gh.write(f'app_identity={app_cn}\napp_sha1={sha1}\ninstaller_identity={inst_cn}\n')


def wait_build():
    app = app_record()
    number = os.environ['BUILD_NUMBER']
    for i in range(40):
        bs = call('GET', f"/v1/builds?filter[app]={app['id']}&filter[preReleaseVersion.platform]=MAC_OS"
                         f"&filter[version]={number}&limit=5")['data']
        if bs:
            a = bs[0]['attributes']
            print(f"App Store Connect lists macOS build {a.get('version')} of {VERSION}: {a.get('processingState')}, uploaded {a.get('uploadedDate')}")
            if a.get('processingState') in ('VALID', 'INVALID', 'FAILED') or i >= 25:
                if a.get('processingState') in ('INVALID', 'FAILED'):
                    sys.exit('Apple could not process the build: see the email App Store Connect sent to the account holder.')
                return
        else:
            print(f'Waiting for App Store Connect to list macOS build {number}…', flush=True)
        time.sleep(30)
    print('The build was uploaded but App Store Connect has not listed it yet; it usually appears within 30 minutes.')


if __name__ == '__main__':
    {'prepare': prepare, 'wait-build': wait_build}[sys.argv[1]]()
