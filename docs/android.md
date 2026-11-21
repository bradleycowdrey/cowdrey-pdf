# Cowdrey.PDF for Android: signing, releasing and Google Play

The Android app is built by `.github/workflows/android-app.yml`. Every run builds a universal APK (phones on arm64 and
armv7, and x86_64) and an App Bundle (.aab), then tests the app on an Android 15 emulator. Nothing in this guide needs
a secret in the repository files: the upload key lives only in GitHub's encrypted secrets and on your own computer.

## What happens today, without the upload key

- The APK is signed with a throwaway key made for that run. It installs and works, but each new build has a different
  key, so Android makes you uninstall the old one first (which deletes its Recent list and signing IDs).
- The App Bundle is not signed, so Google Play cannot take it.
- Nothing is published: the APK and the AAB are only attached to the workflow run (Actions, the run, Artifacts).
- The device test still runs in full. Its log and screenshots are on the `android-build-log` branch.

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

## What only you can do

- Create the upload key and add the three secrets (steps 1 and 2).
- Create the Play Console account, verify your identity, fill in the listing and policies, and upload the first AAB.
- Optionally, after the first signed release: say on the README and the website that the Android app is available.
