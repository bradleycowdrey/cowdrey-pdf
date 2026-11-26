# App Store frames

Cowdrey.PDF's App Store screenshots follow the Cowdrey family standard ([STANDARD.md](STANDARD.md)), the same one every Cowdrey app uses: the app's catalog sky, an uppercase eyebrow, a Fraunces headline and a one-line subhead in Cowdrey One's type scale, and the real app in a drawn iPhone, iPad or Mac window.

| File | What it is |
|---|---|
| `store-frames.js` | The family compositor (a copy of the family master; keep it the same). Frames raw captures and writes `measure.json`. Here it also draws the 9:41 iOS status bar (`statusBar` in the config), because the captures come from a browser and have none. |
| `apps/cowdrey-pdf.json` | Cowdrey.PDF's frames: which capture, in which order, with which words. 6 iPhone, 3 iPad and 5 Mac frames. |
| `check.js` | Checks every picture `docs/app-store/listing.json` names against the standard: exact size, RGB without alpha, and the measured type sizes and positions. |
| `fonts/` | Fraunces and Inter, both under the SIL Open Font License 1.1 (`Fraunces-LICENSE.txt`, `Inter-LICENSE.txt`). |

## Making the screenshots

```
(cd desktop && npm ci) && python3 build.py && npm install --no-save playwright@1.56.1
node tests/app-store-screens.mjs            # captures the app, frames it, checks it
node tests/app-store-screens.mjs --reuse    # frames the raw captures already in tests/.app-store-raw again
node scripts/store-frames/check.js          # checks docs/app-store only
```

`tests/app-store-screens.mjs` captures the raw screens from the real app (iPhone 16 Pro Max and 13-inch iPad Pro sizes, the Mac window at 16:10) into `tests/.app-store-raw/` (not committed), then runs `store-frames.js`, which writes `docs/app-store/<device>-<n>-<id>.png` and `docs/app-store/measure.json`, then runs `check.js`. The App Store listing workflow uploads only the files `listing.json` names, only from `main`.

Copy that does not fit is rewritten in `apps/cowdrey-pdf.json`, never set smaller: the compositor stops with an error instead.
