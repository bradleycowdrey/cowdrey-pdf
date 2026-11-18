//! Security-scoped bookmarks, for the Mac App Store build only (cargo feature `app-store`).
//!
//! The App Sandbox lets the app read and write a file only while the person has handed it over: chosen in an
//! Open or Save panel, or opened from Finder. That permission ends when the app quits, but Cowdrey.PDF reopens
//! recent documents and saves back to the file they came from. So each file the app is given gets a
//! security-scoped bookmark (kept in the app's own data folder), and before the app touches that path again
//! in a later session, the bookmark is resolved and access to the file is started again.
//!
//! Paths the app was never given have no bookmark: they behave exactly as before (the sandbox decides).
use base64::Engine;
use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2_foundation::{NSData, NSString, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions, NSURL};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Paths whose access was started in this session (it lasts until the app quits).
static STARTED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn store_path(app: &AppHandle) -> Option<PathBuf> {
    // Inside the sandbox this is ~/Library/Containers/com.bradcowdrey.cowdreypdf/Data/Library/Application Support/...
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("bookmarks.json"))
}

fn load(app: &AppHandle) -> HashMap<String, String> {
    store_path(app)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, map: &HashMap<String, String>) {
    if let (Some(p), Ok(json)) = (store_path(app), serde_json::to_vec(map)) {
        let _ = std::fs::write(p, json);
    }
}

fn bookmark_for(path: &str) -> Option<Vec<u8>> {
    bookmark_of(&NSURL::fileURLWithPath(&NSString::from_str(path)))
}

fn bookmark_of(url: &NSURL) -> Option<Vec<u8>> {
    let data = url
        .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::WithSecurityScope,
            None,
            None,
        )
        .ok()?;
    Some(data.to_vec())
}

/// Keep a bookmark for a file the person just handed over (opened or saved), so it can be reached next time.
/// Only the most recent 200 files are kept.
pub fn remember(app: &AppHandle, path: &str) {
    let Some(bytes) = bookmark_for(path) else { return };
    STARTED.lock().unwrap().get_or_insert_with(HashSet::new).insert(path.to_string());
    let mut map = load(app);
    map.insert(path.to_string(), base64::engine::general_purpose::STANDARD.encode(bytes));
    if map.len() > 200 {
        // Drop bookmarks of files that no longer exist first, then the rest in no particular order.
        map.retain(|p, _| std::path::Path::new(p).exists());
        while map.len() > 200 {
            let k = map.keys().next().cloned().unwrap();
            map.remove(&k);
        }
    }
    save(app, &map);
}

/// Before reading, checking or writing `path`: if it has a bookmark and its access has not been started in this
/// session, resolve the bookmark and start access. Does nothing for paths without one.
pub fn access(app: &AppHandle, path: &str) {
    if STARTED.lock().unwrap().get_or_insert_with(HashSet::new).contains(path) {
        return;
    }
    let mut map = load(app);
    let Some(b64) = map.get(path).cloned() else { return };
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64) else { return };
    let data = NSData::with_bytes(&bytes);
    let mut stale = Bool::NO;
    let resolved: Option<Retained<NSURL>> = unsafe {
        NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
            &data,
            NSURLBookmarkResolutionOptions::WithSecurityScope,
            None,
            &mut stale,
        )
    }
    .ok();
    let Some(url) = resolved else {
        // The file is gone or the bookmark no longer resolves: forget it.
        map.remove(path);
        save(app, &map);
        return;
    };
    // Where the bookmark points now (the file may have been moved or renamed since it was saved).
    let now = url.path().map(|p| p.to_string()).unwrap_or_else(|| path.to_string());
    if unsafe { url.startAccessingSecurityScopedResource() } {
        // Access stays open until the app quits; STARTED makes sure it is started only once per file, so each
        // start is matched by the single release the system makes when the process ends.
        let mut started = STARTED.lock().unwrap();
        let started = started.get_or_insert_with(HashSet::new);
        started.insert(path.to_string());
        started.insert(now.clone());
        // The file moved or was replaced since: renew the bookmark from the resolved URL (not the old path,
        // which may no longer exist) while access is open. If the file moved away from `path`, the bookmark is
        // filed under its new path and the old entry dropped; otherwise it stays under `path`, the key the page
        // uses (the resolved path can be spelled differently, e.g. /private/var for /var).
        if stale.as_bool() {
            if let Some(fresh) = bookmark_of(&url) {
                let moved = now != path && !std::path::Path::new(path).exists();
                if moved {
                    map.remove(path);
                }
                let key = if moved { now } else { path.to_string() };
                map.insert(key, base64::engine::general_purpose::STANDARD.encode(fresh));
                save(app, &map);
            }
        }
    }
}
