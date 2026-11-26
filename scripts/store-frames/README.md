# App Store frames

Cowdrey.PDF's App Store screenshots follow the Cowdrey family standard ([STANDARD.md](STANDARD.md)), the same one every Cowdrey app uses: the app's catalog sky, an uppercase eyebrow, a Fraunces headline and a one-line subhead in Cowdrey One's type scale, and the real app in a drawn iPhone, iPad or Mac window.

| File | What it is |
|---|---|
| `store-frames.js` | The family compositor (a copy of the family master; keep it the same). Frames raw captures and writes `measure.json`. It can also draw a 9:41 iOS status bar (`statusBar` in the config) over a browser capture; Cowdrey.PDF's config leaves it off, because its iPhone and iPad captures come from the iOS Simulator with the real status bar. |
| `apps/cowdrey-pdf.json` | Cowdrey.PDF's frames: which capture, in which order, with which words. 6 iPhone, 3 iPad and 5 Mac frames. |
| `check.js` | Checks every picture `docs/app-store/listing.json` names against the standard: exact size, RGB without alpha, and the measured type sizes and positions. |
| `fonts/` | Fraunces and Inter, both under the SIL Open Font License 1.1 (`Fraunces-LICENSE.txt`, `Inter-LICENSE.txt`). |

## Making the screenshots

The iPhone and iPad screenshots are taken in the iOS Simulator, from the real app, with the Simulator's own status bar
set to 9:41, full Wi-Fi, signal and battery. The Mac screenshots are taken in a browser, as before. Both play the same
stories (`tests/app-store-stories.mjs`), so every screen is reached the same way.

**iPhone and iPad (a Mac with Xcode; in CI, the App Store listing workflow run by hand with "screenshots" ticked):**

```
(cd desktop && npm ci && node build.mjs) && node tests/app-store-sim/inject.mjs   # the capture build of desktop/dist
(cd desktop && npx tauri ios init --ci && npx tauri ios build --target aarch64-sim)  # the app for the Simulator, unsigned
node tests/app-store-screens.mjs --docs=/tmp/docs                                  # the story documents
node tests/app-store-sim/run.mjs --app <Cowdrey.PDF.app> --docs /tmp/docs --raw tests/.app-store-raw
node tests/app-store-screens.mjs --only=iphone,ipad --reuse                        # frames them, then checks
```

`run.mjs` makes a 6.9" iPhone (iPhone 17 or 16 Pro Max) and a 13" iPad Pro in the newest iOS runtime, in dark mode,
sets the status bar with `simctl status_bar`, and for each frame launches the app, which plays the frame's story
(`tests/app-store-sim/in-app.js`, a small stand-in for Playwright's page inside the app) and tells `run.mjs` when the
screen is ready; `run.mjs` then takes it with `simctl io screenshot`. The capture build is `desktop/dist` with
`tests/app-store-sim/boot.js` first in its head (fixed clock, empty storage, the story player); it is made only for
this, never for TestFlight or the App Store. `node tests/app-store-sim/run.mjs --browser=webkit --docs /tmp/docs`
plays the same stories in Playwright's WebKit on any machine, to check the player (those pictures have no status bar
and are not for the App Store).

**Mac (any machine):**

```
(cd desktop && npm ci) && python3 build.py && npm install --no-save playwright@1.56.1
node tests/app-store-screens.mjs --only=mac           # captures the app, frames it, checks it
node tests/app-store-screens.mjs --reuse              # frames the raw captures already in tests/.app-store-raw again
node scripts/store-frames/check.js                    # checks docs/app-store only
```

`tests/app-store-screens.mjs` captures the raw screens from the real app (the Mac window at 16:10; iPhone 16 Pro Max and 13-inch iPad Pro sizes in a browser too, for a quick look, without a status bar) into `tests/.app-store-raw/` (not committed), then runs `store-frames.js`, which writes `docs/app-store/<device>-<n>-<id>.png` and `docs/app-store/measure.json`, then runs `check.js`. The App Store listing workflow uploads only the files `listing.json` names, only from `main`.

Copy that does not fit is rewritten in `apps/cowdrey-pdf.json`, never set smaller: the compositor stops with an error instead.
