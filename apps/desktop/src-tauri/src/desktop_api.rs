//! Native HTTP transport for the progressively bundled desktop UI.
//!
//! The local webview must not depend on cross-origin browser cookies or CORS.
//! Requests are therefore sent by Rust to the configured Polarr server. The
//! existing server webview remains the production UI until screen parity is
//! complete.

use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use url::Url;

const MAX_API_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const MAX_MEDIA_RESPONSE_BYTES: usize = 12 * 1024 * 1024;

pub struct DesktopApiState {
    client: Mutex<Client>,
}

impl Default for DesktopApiState {
    fn default() -> Self {
        Self {
            client: Mutex::new(build_client()),
        }
    }
}

fn desktop_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    return "windows";
    #[cfg(target_os = "macos")]
    return "macos";
    #[cfg(target_os = "linux")]
    return "linux";
    #[allow(unreachable_code)]
    "desktop"
}

fn build_client() -> Client {
    Client::builder()
        .cookie_store(true)
        // Return redirects to the UI instead of following them off-origin.
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(concat!("Polarr Desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("build desktop API client")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopApiRequest {
    method: String,
    path: String,
    body: Option<String>,
    content_type: Option<String>,
    accept: Option<String>,
    if_none_match: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopApiResponse {
    status: u16,
    body: String,
    content_type: Option<String>,
    etag: Option<String>,
    location: Option<String>,
}

fn api_url(base: &str, path: &str) -> Result<Url, String> {
    if !path.starts_with("/api/") || path.contains('\\') {
        return Err("Desktop API requests must use a /api/ path".into());
    }
    let base_url = Url::parse(base).map_err(|_| "Saved server URL is invalid".to_string())?;
    let url = base_url
        .join(path)
        .map_err(|_| "Desktop API path is invalid".to_string())?;
    if url.scheme() != base_url.scheme()
        || url.host_str() != base_url.host_str()
        || url.port_or_known_default() != base_url.port_or_known_default()
        || !url.path().starts_with("/api/")
    {
        return Err("Desktop API request escaped the configured server".into());
    }
    Ok(url)
}

fn api_method(raw: &str) -> Result<Method, String> {
    match raw.trim().to_ascii_uppercase().as_str() {
        "GET" => Ok(Method::GET),
        "POST" => Ok(Method::POST),
        "PUT" => Ok(Method::PUT),
        "PATCH" => Ok(Method::PATCH),
        "DELETE" => Ok(Method::DELETE),
        _ => Err("Unsupported desktop API method".into()),
    }
}

#[tauri::command]
pub async fn desktop_api_request(
    app: AppHandle,
    state: State<'_, DesktopApiState>,
    request: DesktopApiRequest,
) -> Result<DesktopApiResponse, String> {
    let base =
        super::read_config(&app)?.ok_or_else(|| "Connect to a Polarr server first".to_string())?;
    let url = api_url(&base, &request.path)?;
    let method = api_method(&request.method)?;
    let client = state
        .client
        .lock()
        .map_err(|_| "Desktop API session lock poisoned".to_string())?
        .clone();

    let mut builder = client
        .request(method, url)
        .header("X-Polarr-Desktop-Platform", desktop_platform());
    if let Some(value) = request.content_type.filter(|s| !s.trim().is_empty()) {
        builder = builder.header(reqwest::header::CONTENT_TYPE, value);
    }
    if let Some(value) = request.accept.filter(|s| !s.trim().is_empty()) {
        builder = builder.header(reqwest::header::ACCEPT, value);
    }
    if let Some(value) = request.if_none_match.filter(|s| !s.trim().is_empty()) {
        builder = builder.header(reqwest::header::IF_NONE_MATCH, value);
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|e| format!("Could not reach the Polarr server: {e}"))?;
    if response
        .content_length()
        .is_some_and(|len| len > MAX_API_RESPONSE_BYTES as u64)
    {
        return Err("Desktop API response is too large".into());
    }

    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let location = response
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Read desktop API response: {e}"))?;
    if bytes.len() > MAX_API_RESPONSE_BYTES {
        return Err("Desktop API response is too large".into());
    }
    let body = String::from_utf8(bytes.to_vec())
        .map_err(|_| "Desktop API response was not text".to_string())?;

    Ok(DesktopApiResponse {
        status,
        body,
        content_type,
        etag,
        location,
    })
}

/// Fetch protected artwork through the native client and return a browser-safe
/// data URL. This avoids WebView CORS/cookie differences for profile photos
/// while keeping the API path constrained to the configured Polarr server.
#[tauri::command]
pub async fn desktop_media_data_url(
    app: AppHandle,
    state: State<'_, DesktopApiState>,
    path: String,
    token: String,
) -> Result<Option<String>, String> {
    if token.trim().len() < 8 || token.len() > 512 {
        return Err("Desktop media session token is invalid".into());
    }
    let base =
        super::read_config(&app)?.ok_or_else(|| "Connect to a Polarr server first".to_string())?;
    let url = api_url(&base, &path)?;
    let client = state
        .client
        .lock()
        .map_err(|_| "Desktop API session lock poisoned".to_string())?
        .clone();
    let response = client
        .get(url)
        .bearer_auth(token.trim())
        .header("X-Polarr-Desktop-Platform", desktop_platform())
        .send()
        .await
        .map_err(|e| format!("Could not load desktop artwork: {e}"))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!(
            "Desktop artwork request failed ({})",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|len| len > MAX_MEDIA_RESPONSE_BYTES as u64)
    {
        return Err("Desktop artwork is too large".into());
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .trim()
        .to_string();
    if !content_type.starts_with("image/") && content_type != "application/octet-stream" {
        return Err("Desktop artwork response was not an image".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Read desktop artwork: {e}"))?;
    if bytes.is_empty() || bytes.len() > MAX_MEDIA_RESPONSE_BYTES {
        return Err("Desktop artwork response size is invalid".into());
    }
    Ok(Some(format!(
        "data:{content_type};base64,{}",
        B64.encode(bytes)
    )))
}

#[tauri::command]
pub fn desktop_api_reset_session(state: State<'_, DesktopApiState>) -> Result<(), String> {
    let mut client = state
        .client
        .lock()
        .map_err(|_| "Desktop API session lock poisoned".to_string())?;
    *client = build_client();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_path_stays_on_configured_server() {
        let url = api_url("http://umbrel.local:3647", "/api/account?x=1").unwrap();
        assert_eq!(url.as_str(), "http://umbrel.local:3647/api/account?x=1");
    }

    #[test]
    fn api_path_rejects_external_and_non_api_urls() {
        assert!(api_url("http://umbrel.local:3647", "https://evil.test/api/x").is_err());
        assert!(api_url("http://umbrel.local:3647", "/settings").is_err());
        assert!(api_url("http://umbrel.local:3647", "/api\\evil").is_err());
    }

    #[test]
    fn api_method_is_allowlisted() {
        assert_eq!(api_method("get").unwrap(), Method::GET);
        assert!(api_method("TRACE").is_err());
    }
}
