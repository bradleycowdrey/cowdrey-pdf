# Cowdrey.PDF on Google Play

Everything Google Play shows for Cowdrey.PDF lives in this folder:

| File | What it is |
|---|---|
| `listing.json` | Title (30 characters), short description (80), full description (4000), contact email and website |
| `icon.png` | 512 × 512 app icon, full-bleed (Play rounds the corners), from `desktop/src-tauri/icons/ios-source.png` |
| `feature-graphic.png` | 1024 × 500 banner at the top of the listing, in the family style on Cowdrey.PDF's raspberry |
| `phone-1.png` … `phone-6.png` | Phone screenshots, 1080 × 2160, dark mode: edit text, scans become text, fill in and sign, mark it up, redact, pages in order |

The full description is the App Store's, with the Apple words changed for Android (phone or tablet instead of iPhone or iPad; no VoiceOver line; opening PDFs with Open with or Share and saving where you choose, as Android does).

The screenshots are the app's own interface at a Pixel 7's width, as the Android app runs it, with the fictional documents and the same six stories as the App Store pictures, without the frame and headlines. They were made with a copy of `tests/app-store-screens.mjs` whose phone is a Pixel 7 (412 × 823 dp at 2.625×, an Android web view's user agent, so the page takes its Android code paths, and no safe areas), keeping the raw screens and trimming 1 px from each side to 1080 × 2160.

Two workflows send it to Play with `.github/scripts/play_publish.py` (the same script in each of Bradley's apps):

- **Android app** (`android-app.yml`) uploads the signed App Bundle to the **closed test** for release builds of `main`: a push that changes the version in `desktop/src-tauri/tauri.conf.json`, or a run started by hand (Actions → Android app → Run workflow, with "Only build the test app" off). It sends a build only after the device tests on the first emulator (Android 15) have passed; the second phone's test runs afterwards and doesn't hold it back. Other Android builds don't go to Play. Release notes ("What's new") come from the version's CHANGELOG entry, without the lines only about the Mac, iPhone or iPad; when nothing is left, one line about the app.
- **Google Play listing** (`play-listing.yml`) updates the text and pictures when anything here (except this README) changes on `main`, or when run by hand.

Both need the repository secret **`PLAY_SERVICE_ACCOUNT_JSON`**; without it they skip Play and still pass. The App Bundle is signed with the upload key from the secrets the Android workflow already uses: `ANDROID_KEYSTORE`, `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS` (see `docs/android.md`). Without them the bundle isn't signed and nothing goes to Play. Each step of an upload says `[OK]`, `[SKIP]` or `[NEEDS YOU]` in the run's log (and on the `android-build-log` branch); `[NEEDS YOU]` is also a warning on the run, for something only you can do in Play Console.

**Version codes.** Tauri makes Android's version code from the version number: major × 1,000,000 + minor × 1,000 + patch, so 2.1.0 is 2001000 and 2.1.1 is 2001001. Each new version has a higher code. A build of a version Play already has is skipped (`[SKIP]` in the log); to send a new build to testers, raise the version as for any release.

**Target API level.** Play requires new apps to target Android 16 (API 36) or later. The Android project is generated in CI by the Tauri CLI pinned in `desktop/package-lock.json` (2.12.1), which sets `compileSdk` and `targetSdk` to 37 (run 48 of the Android workflow, 26 November 2026: `targetSdk = 37`, and only the Internet permission). Every signed build also checks the App Bundle itself with Google's bundletool ("Check the Google Play App Bundle"): the package name, the version, a target of at least 36, and no permission to install apps. The run stops there if any of them is wrong.

**Updates.** Google Play updates the copy it installs. That copy never checks GitHub for updates: Check for updates says "Google Play keeps Cowdrey.PDF up to date" (the app asks Android which store installed it). The APK on GitHub still checks GitHub's latest release once a day, as before. Play signs its copy with Google's app signing key and the APK is signed with the upload key, so one can't install over the other: switching means uninstalling first, which deletes the app's Recent list and signing IDs (save your PDFs and export your signing IDs first).

## One-time setup in Play Console

### 1. The app (done)

Cowdrey.PDF exists in Play Console. It gets its package name, `com.bradcowdrey.cowdreypdf` (the `identifier` in `desktop/src-tauri/tauri.conf.json`), from the first App Bundle uploaded to it.

### 2. Set up the closed test

**Test and release → Testing → Closed testing.** Use the track Play made (**Closed testing – Alpha**; the workflow's `alpha` track is this one).
- **Countries / regions:** add the countries your testers are in (or all).
- **Testers:** create an email list with your testers' Google accounts (at least 12), and save. Copy the **join link** to send them.

### 3. Let the workflows in

- Google Cloud console: in a project of yours, enable the **Google Play Android Developer API**, create a **service account** and download a **JSON key** for it (or use the one the other apps already use).
- GitHub → this repository → **Settings → Secrets and variables → Actions → New repository secret:** `PLAY_SERVICE_ACCOUNT_JSON`, with the whole JSON file as its value.
- Play Console → **Users and permissions:** the service account's email address (`client_email` in the JSON). Under **App permissions**, add Cowdrey.PDF with **View app information**, **Release apps to testing tracks**, **Manage testing tracks and edit tester lists** and **Manage store presence** (store listing).
- Run **Actions → Google Play listing → Run workflow** once, to fill in the store listing from this folder.

### 4. The first App Bundle

Run **Actions → Android app → Run workflow** on `main` (leave "Only build the test app" off). When the device tests have passed, its **Google Play closed test** step uploads the bundle and puts it on the closed test.

If that step says Play needs the first bundle by hand (Play only lets the API in after an app's first bundle has been uploaded in Play Console):

1. Download the run's artifact **Cowdrey.PDF-Android** (a zip with `Cowdrey.PDF.aab` and `Cowdrey.PDF.apk`). The bundle is signed with the upload key. Artifacts are kept for 90 days.
2. Closed testing – Alpha → **Create new release**. App signing: **Google-generated app signing key** (chosen for Cowdrey.PDF; the first upload locks it in). The key that signed this bundle becomes the app's upload key.
3. Upload `Cowdrey.PDF.aab`. Release name: e.g. `2.1.0 (2001000)`; release notes: a line or two of what's new. **Next → Save.**

From then on, the workflow uploads each new version itself. (A hand-uploaded 2.1.0 has version code 2001000, so the workflow skips 2.1.0 and sends 2.1.1 and later.)

### 5. Store settings

**Grow users → Store presence → Store settings:** category **Productivity**; contact email **legal@bradcowdrey.com**; website **https://bradcowdrey.com/cowdrey-pdf** (the listing workflow also sets these two).

If **Advanced settings → Form factors** offers Android TV (Tauri's Android project includes a TV launcher entry), leave it off: TV needs its own screenshots and review.

### 6. App content (Policy and programs → App content)

Suggested answers, checked against the Android app's code (`src/`, the Android plugin in `desktop/src-tauri/plugins/sharekit/android`, `desktop/build.mjs`) and the [Terms](https://github.com/bradleycowdrey/cowdrey-md/blob/main/TERMS.md).

**Before review:** the Terms (`TERMS.md`, kept in cowdrey-md; the privacy policy at bradcowdrey.com/legal) don't have Cowdrey.PDF yet. Add it to Sections 6, 15 and 25 (what stays on the device, the optional downloads, timestamps and revocation checks below, and the Android download's update check), as they say for each app, so the privacy policy describes this app too.

- **Privacy policy:** `https://bradcowdrey.com/legal`
- **Ads:** No, the app doesn't contain ads.
- **App access:** All functionality is available without special access. (No account or login; the start screen's "Try a sample PDF" opens a guide made on the device.)
- **Content rating:** category **All Other App Types** (a productivity tool: not a game, social, news, entertainment or store app). Answer **No** to every question: violence, fear, sexuality, gambling, language, controlled substances, crude humour; users interacting or exchanging content with other users (PDFs are shared only through Android's share sheet, to apps the user picks); sharing location; buying digital goods; web browser or search engine (a web link in a PDF opens in the user's browser). Expected result: Everyone, PEGI 3, USK 0.
- **Target audience and content:** **13–15, 16–17 and 18 and over** (or 18 and over only). Not designed for children: the Terms say the Services aren't directed to children under 13. "Could your store listing unintentionally appeal to children?" **No.**
- **News app:** No. **Government app:** No. **Financial features:** none. **Health:** none. **Advertising ID:** not used.
- **Permissions:** only Internet. Files and pictures come through Android's own picker and save dialog, so there is no storage, photo or media permission, and nothing to declare. (The `<queries>` entry for text-to-speech engines is for Read aloud.)
- **Data safety:**
  - *Does your app collect or share any of the required user data types?* **No.** Then submit; the encryption and deletion questions are only asked when data is collected.
  - Why: PDFs are read and saved through Android's file picker and save dialog, and every change is made on the device. The Recent list, signatures, signing IDs (certificates and their keys), stamps, settings and downloaded fonts and OCR languages are kept in the app's own storage on the device until the user removes them or uninstalls the app. There are no accounts, servers of Bradley's own, analytics, ads, crash reporting or third-party SDKs. The PDF, OCR and signing libraries and the fonts for Latin, Greek and Cyrillic text are built into the app (`desktop/build.mjs`).
  - What leaves the device, each only when the user asks, and why none of it is a data type to declare:
    - **OCR in a language other than English** downloads that language's data once from jsDelivr (cdn.jsdelivr.net); **a font for Chinese, Japanese, Korean, Hindi or Thai** text is downloaded once from jsDelivr after asking. Plain downloads: they send nothing about the user or the document.
    - **A timestamp for a certificate signature** sends a SHA-256 fingerprint of the signature (not the document) to the timestamp server the user enters.
    - **Check revocation online** sends the certificate's serial number and its issuer's fingerprints to the OCSP server named in the certificate, or downloads the revocation list (CRL) it names. Never the document.
    - **Share, Save and Print** hand a PDF to the app, folder or printer the user picks, through Android's share sheet, save dialog and print service: user-initiated, not collection or sharing.
    - The APK from GitHub (not the Play copy) also asks GitHub's public releases API once a day whether there's a newer version.
  - Judgement calls: Play's data types don't cover the IP address a server sees when the app downloads a public file, or a signature's fingerprint. The closest call is the revocation check, which tells a certificate authority's server which certificate is being checked, as every PDF reader that checks revocation does; it's the user's own request to the server the certificate names, and carries nothing about the user. If you'd rather declare it, it would be Personal info → Other info: shared, optional, for App functionality. The family's cautious rule (data the app sends to a third-party service counts as shared) leaves the answer at "No" because none of these requests carries one of Play's data types.
  - Android's own backup: the app doesn't turn off Android's Auto Backup (Tauri's default), so Android may copy the app's storage, the Recent list and signing IDs included, to the user's own Google account backup, under the user's backup settings. That is Android's service, not data sent to Bradley; Play's form doesn't ask about it.

### 7. Roll out and run the test

- **Publishing overview → Send changes for review.** When the app's setup is complete, roll out the release on the closed test (Closed testing – Alpha → Releases).
- Send testers the join link. Each one opens it, accepts, and installs Cowdrey.PDF from Play.
- Because this is a personal developer account, **at least 12 testers must stay opted in for 14 days in a row** before you can apply for production (**Dashboard → Apply for production**). Keep the test running and the testers opted in for the whole 14 days; new versions during the test are fine.
