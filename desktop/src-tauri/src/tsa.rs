//! Trusted timestamps (RFC 3161) for certificate signatures (src/features/76-sign.js).
//!
//! The page builds the timestamp request itself: it holds only a SHA-256 fingerprint of the signature, never the
//! document. A web view can't post it to most timestamp servers (they send no CORS headers), so the app does:
//! one POST of that request to the https address the person set, and the server's answer handed back.
//! Nothing is sent unless the person turned timestamps on and set a server.
//!
//! Revocation checks (pki_fetch): an OCSP request (POST) or a revocation list (GET), to the address a certificate
//! names, only when the person asked for revocation to be checked. OCSP and CRL servers commonly use plain http: their
//! answers are signed by the certificate's issuer, and the page checks that signature. The OCSP request holds the
//! certificate's serial number and its issuer's fingerprints, never the document. On Android the request is made on
//! the Kotlin side (sharekit's AndroidPdf.kt, pkiFetch), as timestamps are.

/// Posts a timestamp request (base64) to `url` (https only) and returns the server's answer (base64).
#[tauri::command]
pub async fn tsa_post(app: tauri::AppHandle, url: String, body: String) -> Result<String, String> {
    use base64::Engine;
    let request = base64::engine::general_purpose::STANDARD.decode(body.as_bytes()).map_err(|e| e.to_string())?;
    // A timestamp request is a few hundred bytes; anything much larger is not one.
    if request.len() > 8192 {
        return Err("That is not a timestamp request".into());
    }
    let url = url.trim().to_string();
    #[cfg(target_os = "android")]
    {
        let _ = request;
        android(app, url, body).await
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        post(url, request).await
    }
}

/// Android: the POST is made on the Kotlin side (sharekit's AndroidPdf.kt, tsaPost) with Android's own network
/// stack, so the phone's certificate authorities, DNS and proxy settings apply as in any other Android app.
#[cfg(target_os = "android")]
async fn android(app: tauri::AppHandle, url: String, body: String) -> Result<String, String> {
    use tauri_plugin_sharekit::ShareExt;
    let lower = url.to_ascii_lowercase();
    if !lower.starts_with("https://") {
        return Err(if lower.contains("://") { "The timestamp server must use https".into() } else { "That is not a web address".into() });
    }
    let answer = tauri::async_runtime::spawn_blocking(move || app.share().native("tsaPost", serde_json::json!({ "url": url, "body": body })))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    answer.get("body").and_then(|b| b.as_str()).map(str::to_string).ok_or_else(|| "No answer from the timestamp server".to_string())
}

/// The Mac and iPhone: reqwest with rustls and the system's own certificate check. An error carries its whole chain
/// of causes (not only "error sending request"), so a failure says what went wrong.
#[cfg(not(target_os = "android"))]
async fn post(url: String, request: Vec<u8>) -> Result<String, String> {
    use base64::Engine;
    let target = reqwest::Url::parse(&url).map_err(|_| "That is not a web address".to_string())?;
    if target.scheme() != "https" {
        return Err("The timestamp server must use https".into());
    }
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(concat!("Cowdrey.PDF/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| chain(&e))?;
    let res = client
        .post(target)
        .header(reqwest::header::CONTENT_TYPE, "application/timestamp-query")
        .body(request)
        .send()
        .await
        .map_err(|e| chain(&e))?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("error {}", status.as_u16()));
    }
    let answer = res.bytes().await.map_err(|e| chain(&e))?;
    if answer.len() > 1 << 20 {
        return Err("The answer is too large".into());
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(&answer))
}

/// An error and each of its causes, joined: "error sending request: dns error: …".
#[cfg(not(target_os = "android"))]
fn chain(e: &dyn std::error::Error) -> String {
    let mut out = e.to_string();
    let mut cause = e.source();
    while let Some(c) = cause {
        let s = c.to_string();
        if !out.contains(&s) {
            out.push_str(": ");
            out.push_str(&s);
        }
        cause = c.source();
    }
    out
}

/// GETs `url` (body: None) or POSTs `body` (base64) as `content_type` to it; returns the answer (base64).
#[tauri::command]
pub async fn pki_fetch(app: tauri::AppHandle, url: String, body: Option<String>, content_type: Option<String>) -> Result<String, String> {
    use base64::Engine;
    let url = url.trim().to_string();
    let lower = url.to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err(if lower.contains("://") { "Revocation servers are reached over http or https only".into() } else { "That is not a web address".into() });
    }
    let request = match &body {
        Some(b) => Some(base64::engine::general_purpose::STANDARD.decode(b.as_bytes()).map_err(|e| e.to_string())?),
        None => None,
    };
    if let Some(r) = &request {
        // An OCSP request is a few hundred bytes.
        if r.len() > 8192 {
            return Err("That is not a revocation request".into());
        }
        if content_type.as_deref().unwrap_or("application/ocsp-request") != "application/ocsp-request" {
            return Err("Only OCSP requests are sent".into());
        }
    }
    #[cfg(target_os = "android")]
    {
        let _ = request;
        android_fetch(app, url, body).await
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        fetch(url, request).await
    }
}

/// Android: the request is made on the Kotlin side (sharekit's AndroidPdf.kt, pkiFetch): https with Android's own
/// network stack, plain http on a socket of its own, so the app as a whole still allows no cleartext traffic.
#[cfg(target_os = "android")]
async fn android_fetch(app: tauri::AppHandle, url: String, body: Option<String>) -> Result<String, String> {
    use tauri_plugin_sharekit::ShareExt;
    let args = serde_json::json!({ "url": url, "body": body, "contentType": body.as_ref().map(|_| "application/ocsp-request") });
    let answer = tauri::async_runtime::spawn_blocking(move || app.share().native("pkiFetch", args))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    answer.get("body").and_then(|b| b.as_str()).map(str::to_string).ok_or_else(|| "No answer from the revocation server".to_string())
}

/// The Mac and iPhone: reqwest, as for timestamps.
#[cfg(not(target_os = "android"))]
async fn fetch(url: String, request: Option<Vec<u8>>) -> Result<String, String> {
    use base64::Engine;
    let target = reqwest::Url::parse(&url).map_err(|_| "That is not a web address".to_string())?;
    if target.scheme() != "https" && target.scheme() != "http" {
        return Err("Revocation servers are reached over http or https only".into());
    }
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(concat!("Cowdrey.PDF/", env!("CARGO_PKG_VERSION")))
        // a revocation list may move, but only to another http or https address
        .redirect(reqwest::redirect::Policy::custom(|a| {
            if a.previous().len() >= 5 || !matches!(a.url().scheme(), "http" | "https") { a.stop() } else { a.follow() }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let req = match request {
        Some(data) => client.post(target).header(reqwest::header::CONTENT_TYPE, "application/ocsp-request").body(data),
        None => client.get(target),
    };
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("error {}", status.as_u16()));
    }
    let answer = res.bytes().await.map_err(|e| e.to_string())?;
    // Revocation lists can be large; much larger than this is not one.
    if answer.len() > 32 << 20 {
        return Err("The answer is too large".into());
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(&answer))
}
