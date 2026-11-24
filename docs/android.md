# Cowdrey.PDF for Android: signing, releasing and Google Play

The Android app is built by `.github/workflows/android-app.yml`. Every run builds a universal APK (phones on arm64 and
armv7, and x86_64) and an App Bundle (.aab), then tests the app on two emulators: Android 15 with 4 GB of memory, and
Android 16 (a newer web view) with 2 GB. Nothing in this guide needs a secret in the repository files: the upload key
lives only in GitHub's encrypted secrets and on your own computer.

## What happens today, without the upload key

- The APK is signed with a throwaway key made for that run. It installs and works, but each new build has a different
  key, so Android makes you uninstall the old one first (which deletes its Recent list and signing IDs).
- The App Bundle is not signed, so Google Play cannot take it.
- Nothing is published: the APK and the AAB are only attached to the workflow run (Actions, the run, Artifacts).
- The device test still runs in full. Its log and screenshots are on the `android-build-log` branch: the first phone
  at the top, the second in `second-phone/`. The branch is replaced on every run, and `screenshots.txt` lists the
  run's screenshots.

## 1. Make the upload key (once, on your own computer)

You need Java's `keytool` (any JDK, for example `brew install openjdk` on a Mac).

```sh
keytool -genkeypair -v \
  -keystore cowdrey-pdf-upload.jks \
  -alias upload \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Bradley Cowdrey, O=Bradley Cowdrey"
```

It asks for a password twice. Use a long random one and keep it in your password manager.

Keep `cowdrey-pdf-upload.jks` and its password safe and backed up (password manager, plus an offline copy). With Play
App Signing (below) a lost upload key can be reset through Google, but it takes days. Never commit the file.

## 2. Add the three secrets to GitHub

In the repository on GitHub: Settings, Secrets and variables, Actions, New repository secret. Add:

| Name | Value |
| --- | --- |
| `ANDROID_KEYSTORE` | the keystore file as base64 (see below) |
| `ANDROID_KEYSTORE_PASSWORD` | the password you chose in step 1 |
| `ANDROID_KEY_ALIAS` | `upload` (the `-alias` from step 1) |

To get the base64 text of the keystore:

```sh
# macOS: copies it to the clipboard, ready to paste
base64 -i cowdrey-pdf-upload.jks | pbcopy
# Linux
base64 -w0 cowdrey-pdf-upload.jks
```

Or with the GitHub command line, without the value ever showing on screen:

```sh
base64 -i cowdrey-pdf-upload.jks | gh secret set ANDROID_KEYSTORE -R bradleycowdrey/cowdrey-pdf
gh secret set ANDROID_KEYSTORE_PASSWORD -R bradleycowdrey/cowdrey-pdf   # it asks for the value
gh secret set ANDROID_KEY_ALIAS -R bradleycowdrey/cowdrey-pdf --body upload
```

From the next build on:

- The APK is signed with the upload key, so updates install over the previous version.
- The App Bundle is signed too, ready for Google Play.
- On `main` only, the APK is added to the version's GitHub release as `Cowdrey.PDF.apk`, so
  `https://github.com/bradleycowdrey/cowdrey-pdf/releases/latest/download/Cowdrey.PDF.apk` always gives the newest one.
  Builds of other branches are never published.

To build without pushing: Actions, "Android app", Run workflow (on `main`). Leave "Only build the test app" off.

## 3. Google Play

### Once: the developer account

1. Go to [play.google.com/console](https://play.google.com/console) and sign up (a one-off fee of 25 US dollars).
   A personal account has to verify your identity, and new personal accounts must run a closed test with at least 12
   testers for 14 days before they can publish to everyone. An organisation account (a D-U-N-S number) skips that.
2. Create the app: Create app, name `Cowdrey.PDF`, default language English (United Kingdom) or (United States),
   App, Free.

### Once: the store listing and policies

Everything to paste is in [`docs/play-store/listing.md`](play-store/listing.md):

- Main store listing: app name, short description, full description, app icon (512 x 512) and feature graphic
  (1024 x 500), phone screenshots (at least 2).
- App content: privacy policy URL, ads (none), app access (no login), content rating questionnaire, target audience
  (18 and over is simplest; the app is fine for everyone), data safety (no data collected or shared), government app (no),
  financial features (none), health (none).
- Category: Productivity. Contact email and website.

### Each release: upload the App Bundle

1. Run the workflow with the upload key set (step 2). Download `Cowdrey.PDF-Android` from the run's Artifacts and take
   `Cowdrey.PDF.aab` out of the zip.
2. In Play Console: Test and release, Testing, Internal testing, Create new release.
3. The first time, accept **Play App Signing**: Google keeps the key that signs what phones install, and your key from
   step 1 is only the upload key. Choose "Use Google-generated key".
4. Upload `Cowdrey.PDF.aab`. The release name fills in from the version (1.1.0, version code 1001000).
5. Release notes: the "What's new" text from `docs/play-store/listing.md`.
6. Save, Review release, Start rollout to Internal testing. Add yourself (and testers) under Testers, then open the
   opt-in link on the phone.
7. When it works: promote the release to Closed testing, then to Production.

Each new version needs a higher version code. It comes from the version in `desktop/src-tauri/tauri.conf.json`
(1.1.0 becomes 1001000), so bumping the version is enough.

### Updates

- Copies installed from Google Play are updated by Google Play. The app's "Check for updates…" says so and checks
  nothing itself.
- Copies installed from the APK on GitHub check GitHub's latest release once a day and offer the newer APK.

## The network: timestamps and revocation checks

The app goes online only when the person asks it to (a timestamp server they set, or "Check revocation online").
Neither request is made by the web view, whose `fetch` most timestamp, OCSP and CRL servers block (they send no CORS
headers): the page hands the request to the app (`desktop/src-tauri/src/tsa.rs`), which checks it and has Android make
it (`tsaPost` and `pkiFetch` in `desktop/src-tauri/plugins/sharekit/android/src/main/java/AndroidPdf.kt`). The page
cannot call those two directly: they are not in the plugin's list of methods the page may use.

- **Timestamps** are https only, through Android's own network stack (the phone's certificate authorities, DNS and proxy).
- **Revocation checks** send an OCSP request (a POST of at most 8 KB, `application/ocsp-request` only) or fetch a
  revocation list (a GET); answers over 32 MB are refused, and a list may move (at most 5 redirects, GET only) only to
  another http or https address. https goes through Android's own network stack, as timestamps do.
- Each timestamp request, and each revocation check with all its redirects, must finish within 60 seconds: besides the
  per-read timeouts, the connection is closed at that deadline, so a server that sends a byte now and then can't hold
  the app's background thread.

**Plain http, and why the app still allows no cleartext traffic.** Most OCSP responders and CRLs are plain http, which
is safe for them: every answer is signed by the certificate's issuer, and the page checks that signature, the nonce
and the dates before it believes an answer, so someone on the network can at worst make a check fail, never change its
result. But the release app allows no cleartext traffic (Tauri sets `usesCleartextTraffic` to false for release builds,
true only for the debug build the device test drives), and Android's network security config can only allow cleartext
for named domains or for the whole app, while OCSP and CRL servers can be any host a certificate names. Allowing it for
the whole app would also let the web view and every other request use plain http. So nothing in the manifest changes:
`pkiFetch` speaks plain http/1.1 itself, on a socket of its own (through the phone's http proxy when it has one), for
exactly these two kinds of request and nothing else. Everything else in the app stays https only, and the device test
runs the same code as the release app, because `pkiFetch` never relies on the debug build's cleartext setting.

The device test checks this end to end: it makes a small certificate authority with openssl on the runner
(`tests/android/pki.mjs`), runs `openssl ocsp` and a tiny http server for its revocation list there, reached from the
emulator at `10.0.2.2`, signs with a certificate that names both, and checks revocation from the Signatures panel: not
revoked, then revoked (a new OCSP request, not a kept answer), then revoked from the CRL once the OCSP responder is gone. The release
APK test (`tests/android/release.mjs`) does the same with taps on the release build itself, whose cleartext traffic is
off: a PDF signed on the runner (with `openssl cms`) is opened from Android and checked from the Signatures panel.

## When the device test loses its connection

The device test drives the debug build's web view through Playwright, which watches the device's web views with an
adb command every half second; one such command failing on a busy emulator closes Playwright's connection, although
the app and its page are still running (run 38, on the 2 GB phone, as OCR started). `tests/android/run.mjs` then
connects again and checks that the app's process is the same and that its page is the same page (a mark the test set
in it is still there). Only then is the scenario run once more, and `result.txt` lists it under "run again after the
test lost its connection". If the app's process or its page is gone (a crash, the web view's renderer killed for
memory, a reload), the scenario fails as before, with the phone's free memory and Android's lines about killed or
dead processes in the log.

## What only you can do

- Create the upload key and add the three secrets (steps 1 and 2).
- Create the Play Console account, verify your identity, fill in the listing and policies, and upload the first AAB.
- Optionally, after the first signed release: say on the README and the website that the Android app is available.
