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
//! certificate's serial number and its issuer's fingerprints, never the document.

/// Posts a timestamp request (base64) to `url` (https only) and returns the server's answer (base64).
#[tauri::command]
pub async fn tsa_post(url: String, body: String) -> Result<String, String> {
    post(url, body).await
}

#[cfg(not(target_os = "android"))]
async fn post(url: String, body: String) -> Result<String, String> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let target = reqwest::Url::parse(url.trim()).map_err(|_| "That is not a web address".to_string())?;
    if target.scheme() != "https" {
        return Err("The timestamp server must use https".into());
    }
    let request = b64.decode(body.as_bytes()).map_err(|e| e.to_string())?;
    // A timestamp request is a few hundred bytes; anything much larger is not one.
    if request.len() > 8192 {
        return Err("That is not a timestamp request".into());
    }
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(concat!("Cowdrey.PDF/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .post(target)
        .header(reqwest::header::CONTENT_TYPE, "application/timestamp-query")
        .body(request)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("error {}", status.as_u16()));
    }
    let answer = res.bytes().await.map_err(|e| e.to_string())?;
    if answer.len() > 1 << 20 {
        return Err("The answer is too large".into());
    }
    Ok(b64.encode(&answer))
}

/// GETs `url` (body: None) or POSTs `body` (base64) as `content_type` to it; returns the answer (base64).
#[tauri::command]
pub async fn pki_fetch(url: String, body: Option<String>, content_type: Option<String>) -> Result<String, String> {
    fetch(url, body, content_type).await
}

#[cfg(not(target_os = "android"))]
async fn fetch(url: String, body: Option<String>, content_type: Option<String>) -> Result<String, String> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let target = reqwest::Url::parse(url.trim()).map_err(|_| "That is not a web address".to_string())?;
    if target.scheme() != "https" && target.scheme() != "http" {
        return Err("Revocation servers are reached over http or https only".into());
    }
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(concat!("Cowdrey.PDF/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let req = match body {
        Some(b) => {
            let data = b64.decode(b.as_bytes()).map_err(|e| e.to_string())?;
            // An OCSP request is a few hundred bytes.
            if data.len() > 8192 {
                return Err("That is not a revocation request".into());
            }
            let kind = content_type.unwrap_or_else(|| "application/ocsp-request".into());
            if kind != "application/ocsp-request" {
                return Err("Only OCSP requests are sent".into());
            }
            client.post(target).header(reqwest::header::CONTENT_TYPE, kind).body(data)
        }
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
    Ok(b64.encode(&answer))
}

#[cfg(target_os = "android")]
async fn fetch(_url: String, _body: Option<String>, _content_type: Option<String>) -> Result<String, String> {
    Err("Revocation checks are not available in the Android app yet".into())
}

// Android: its web view and this app have no HTTP client set up for this yet; the page says so.
#[cfg(target_os = "android")]
async fn post(_url: String, _body: String) -> Result<String, String> {
    Err("Timestamps are not available in the Android app yet".into())
}
