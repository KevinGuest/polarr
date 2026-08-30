use std::fs;
use std::path::PathBuf;
#[cfg(not(target_os = "windows"))]
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use url::Url;

mod desktop_api;
mod discord_presence;
#[cfg(target_os = "macos")]
mod macos_window;
mod offline;
mod server_webview;

const CONFIG_FILE: &str = "server.json";
const DESKTOP_PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize, Default)]
struct ServerConfig {
    url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerLaunchState {
    url: Option<String>,
    skip_auto_connect: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopProtocolRange {
    min: u32,
    max: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopServerManifest {
    app: String,
    server_version: String,
    protocol: DesktopProtocolRange,
    capabilities: Vec<String>,
    web_app_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerProbeResult {
    url: String,
    manifest: Option<DesktopServerManifest>,
    legacy: bool,
}

fn clean_device_name(raw: &str) -> Option<String> {
    let name = raw.trim().trim_end_matches(".local").trim();
    if name.is_empty() {
        None
    } else {
        Some(name.chars().take(80).collect())
    }
}

fn native_device_name() -> Option<String> {
    #[cfg(target_os = "windows")]
    if let Ok(name) = std::env::var("COMPUTERNAME") {
        if let Some(name) = clean_device_name(&name) {
            return Some(name);
        }
    }

    #[cfg(target_os = "macos")]
    if let Ok(output) = Command::new("/usr/sbin/scutil")
        .args(["--get", "ComputerName"])
        .output()
    {
        if output.status.success() {
            if let Some(name) = clean_device_name(&String::from_utf8_lossy(&output.stdout)) {
                return Some(name);
            }
        }
    }

    if let Ok(name) = std::env::var("HOSTNAME") {
        if let Some(name) = clean_device_name(&name) {
            return Some(name);
        }
    }

    #[cfg(not(target_os = "windows"))]
    if let Ok(output) = Command::new("hostname").output() {
        if output.status.success() {
            return clean_device_name(&String::from_utf8_lossy(&output.stdout));
        }
    }

    None
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create config dir: {e}"))?;
    Ok(dir.join(CONFIG_FILE))
}

fn read_config(app: &AppHandle) -> Result<Option<String>, String> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read config: {e}"))?;
    let cfg: ServerConfig = serde_json::from_str(&raw).map_err(|e| format!("parse config: {e}"))?;
    if cfg.url.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(cfg.url))
    }
}

fn write_config(app: &AppHandle, url: &str) -> Result<(), String> {
    let path = config_path(app)?;
    let cfg = ServerConfig {
        url: url.to_string(),
    };
    let raw = serde_json::to_string_pretty(&cfg).map_err(|e| format!("serialize: {e}"))?;
    fs::write(&path, raw).map_err(|e| format!("write config: {e}"))
}

fn inject_mdns_host(with_scheme: &str) -> Option<String> {
    let (scheme, rest) = if let Some(r) = with_scheme.strip_prefix("http://") {
        ("http://", r)
    } else if let Some(r) = with_scheme.strip_prefix("https://") {
        ("https://", r)
    } else {
        return None;
    };
    let host_end = rest
        .find(|c: char| matches!(c, ':' | '/' | '?' | '#'))
        .unwrap_or(rest.len());
    let host = &rest[..host_end];
    if host.is_empty() || host.contains('.') || host.eq_ignore_ascii_case("localhost") {
        return None;
    }
    if host.parse::<std::net::IpAddr>().is_ok() {
        return None;
    }
    Some(format!("{scheme}{host}.local{}", &rest[host_end..]))
}

fn parse_server_url(with_scheme: &str) -> Result<Url, String> {
    match Url::parse(with_scheme) {
        Ok(parsed) => Ok(parsed),
        Err(_) => {
            let Some(injected) = inject_mdns_host(with_scheme) else {
                return Err(
                    "That does not look like a valid URL. Example: http://192.168.1.10:3647"
                        .into(),
                );
            };
            Url::parse(&injected).map_err(|_| {
                "That does not look like a valid URL. Example: http://192.168.1.10:3647"
                    .to_string()
            })
        }
    }
}

fn candidate_urls(raw: &str) -> Result<Vec<String>, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Enter your Polarr server URL.".into());
    }

    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };

    let parsed = parse_server_url(&with_scheme)?;

    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("Only http:// and https:// URLs are supported.".into()),
    }

    let Some(host) = parsed.host_str() else {
        return Err("URL must include a host.".into());
    };

    let mut out = Vec::new();
    let primary = parsed.to_string().trim_end_matches('/').to_string();
    out.push(primary);

    if !host.contains('.')
        && !host.eq_ignore_ascii_case("localhost")
        && host.parse::<std::net::IpAddr>().is_err()
    {
        let mut rewritten = parsed.clone();
        let mdns = format!("{host}.local");
        rewritten
            .set_host(Some(&mdns))
            .map_err(|_| format!("Could not use host {mdns}"))?;
        let local = rewritten.to_string().trim_end_matches('/').to_string();
        if !out.iter().any(|u| u == &local) {
            out.push(local);
        }
    }

    Ok(out)
}

fn normalize_url(raw: &str) -> Result<String, String> {
    let mut urls = candidate_urls(raw)?;
    Ok(urls.remove(0))
}

fn looks_like_polarr(body: &serde_json::Value) -> bool {
    if body.get("app").and_then(|v| v.as_str()) == Some("polarr") {
        return true;
    }
    body.get("status").and_then(|v| v.as_str()) == Some("ok")
        && body.get("setupComplete").is_some()
        && body.get("hasUsers").is_some()
}

fn validate_desktop_manifest(manifest: &DesktopServerManifest) -> Result<(), String> {
    if manifest.app != "polarr" {
        return Err("URL is not a Polarr server".into());
    }
    if manifest.protocol.min > DESKTOP_PROTOCOL_VERSION {
        return Err(format!(
            "This server requires a newer Polarr Desktop (server {})",
            manifest.server_version
        ));
    }
    if manifest.protocol.max < DESKTOP_PROTOCOL_VERSION {
        return Err(format!(
            "This Polarr Desktop requires a newer Polarr server (server {})",
            manifest.server_version
        ));
    }
    Ok(())
}

async fn probe_polarr(base: &str) -> Result<Option<DesktopServerManifest>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|e| e.to_string())?;

    if let Ok(response) = client.get(format!("{base}/api/v1/desktop")).send().await {
        if response.status().is_success() {
            if let Ok(manifest) = response.json::<DesktopServerManifest>().await {
                validate_desktop_manifest(&manifest)?;
                return Ok(Some(manifest));
            }
        }
    }

    for path in ["/api/v1/status", "/api/status"] {
        let response = match client.get(format!("{base}{path}")).send().await {
            Ok(r) => r,
            Err(_) => continue,
        };
        if !response.status().is_success() {
            continue;
        }
        let Ok(body) = response.json::<serde_json::Value>().await else {
            continue;
        };
        if looks_like_polarr(&body) {
            return Ok(None);
        }
    }

    Err("URL not valid".into())
}

#[tauri::command]
async fn probe_server_url(url: String) -> Result<String, String> {
    Ok(probe_server(url).await?.url)
}

#[tauri::command]
async fn probe_server(url: String) -> Result<ServerProbeResult, String> {
    let candidates = candidate_urls(&url)?;
    let mut last_err = "URL not valid".to_string();
    for candidate in candidates {
        match probe_polarr(&candidate).await {
            Ok(manifest) => {
                return Ok(ServerProbeResult {
                    url: candidate,
                    legacy: manifest.is_none(),
                    manifest,
                })
            }
            Err(err) => last_err = err,
        }
    }
    Err(last_err)
}

#[tauri::command]
fn get_server_url(app: AppHandle) -> Result<ServerLaunchState, String> {
    let skip_auto_connect = server_webview::take_opening_crashed(&app);
    Ok(ServerLaunchState {
        url: read_config(&app)?,
        skip_auto_connect,
    })
}

#[tauri::command]
fn set_server_url(app: AppHandle, url: String) -> Result<String, String> {
    let normalized = normalize_url(&url)?;
    write_config(&app, &normalized)?;
    Ok(normalized)
}

#[tauri::command]
fn clear_server_url(app: AppHandle) -> Result<(), String> {
    let path = config_path(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("clear config: {e}"))?;
    }
    if let Some(wv) = app.get_webview(server_webview::SERVER_WEBVIEW_LABEL) {
        let _ = wv.close();
    }
    server_webview::forget_server_url();
    let _ = server_webview::dispatch_fill_shell(&app);
    let _ = app.emit("server-cleared", ());
    Ok(())
}

#[tauri::command]
fn get_desktop_device_name() -> String {
    native_device_name().unwrap_or_else(|| "This Computer".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let presence = discord_presence::DiscordPresenceState::default();
    let desktop_api = desktop_api::DesktopApiState::default();
    let offline_state = offline::OfflineState::default();

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(presence)
        .manage(desktop_api)
        .manage(offline_state)
        .setup(|app| {
            server_webview::install_chrome_down_relay(app.handle());
            server_webview::install_resize_handler(app.handle());
            if let Some(window) = app.get_window("main") {
                let _ = window.set_theme(Some(tauri::Theme::Dark));
                #[cfg(windows)]
                {
                    let _ = window.set_decorations(false);
                }
                #[cfg(target_os = "macos")]
                {
                    macos_window::apply(app.handle());
                }
                // Stay hidden until JS finishes the updater window. Parenting
                // the updater to main (or showing main first) put the full
                // app behind "Checking for updates…".
            }
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("polarroffline", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || {
                let path = request.uri().path().trim_start_matches('/');
                let track_id = match path.split('/').find(|s| !s.is_empty()) {
                    Some(id) => {
                        match urlencoding_decode(id) {
                            Ok(s) => s,
                            Err(_) => id.to_string(),
                        }
                    }
                    None => {
                        responder.respond(
                            http_response(404, "text/plain", b"missing track id".to_vec(), None),
                        );
                        return;
                    }
                };

                let range = request
                    .headers()
                    .get(http::header::RANGE)
                    .and_then(|v| v.to_str().ok())
                    .and_then(offline::parse_range_header);

                let state = app.state::<offline::OfflineState>();
                match offline::handle_protocol(&app, &state, &track_id, range) {
                    Ok((body, content_type, ranged)) => {
                        if let Some((start, end, total)) = ranged {
                            responder.respond(http_response(
                                206,
                                &content_type,
                                body,
                                Some(format!("bytes {start}-{end}/{total}")),
                            ));
                        } else {
                            responder.respond(http_response(200, &content_type, body, None));
                        }
                    }
                    Err(err) => {
                        let status = if err.contains("unauthorized") {
                            401
                        } else if err.contains("not found") {
                            404
                        } else if err.contains("range") {
                            416
                        } else {
                            500
                        };
                        responder.respond(http_response(
                            status,
                            "text/plain",
                            err.into_bytes(),
                            None,
                        ));
                    }
                }
            });
        })
        .invoke_handler(tauri::generate_handler![
            get_server_url,
            set_server_url,
            clear_server_url,
            probe_server_url,
            probe_server,
            get_desktop_device_name,
            desktop_api::desktop_api_request,
            desktop_api::desktop_api_reset_session,
            server_webview::open_server_webview,
            server_webview::hide_server_webview,
            server_webview::show_server_webview,
            server_webview::close_server_webview,
            server_webview::server_history_back,
            server_webview::server_history_forward,
            server_webview::desktop_chrome_up,
            server_webview::get_server_webview_href,
            discord_presence::discord_set_presence,
            discord_presence::discord_clear_presence,
            discord_presence::discord_probe_presence,
            offline::offline_set_session,
            offline::offline_list,
            offline::offline_has,
            offline::offline_ids,
            offline::offline_remove,
            offline::offline_clear_all,
            offline::offline_begin_download,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Polarr desktop")
        .run(|app, event| {
            if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
                let state = app.state::<discord_presence::DiscordPresenceState>();
                discord_presence::shutdown(&state);
            }
        });
}

fn urlencoding_decode(s: &str) -> Result<String, ()> {
    let bytes: Result<Vec<u8>, ()> = percent_decode(s);
    bytes.and_then(|b| String::from_utf8(b).map_err(|_| ()))
}

fn percent_decode(input: &str) -> Result<Vec<u8>, ()> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let h = from_hex(bytes[i + 1])?;
                let l = from_hex(bytes[i + 2])?;
                out.push((h << 4) | l);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    Ok(out)
}

fn from_hex(b: u8) -> Result<u8, ()> {
    match b {
        b'0'..=b'9' => Ok(b - b'0'),
        b'a'..=b'f' => Ok(b - b'a' + 10),
        b'A'..=b'F' => Ok(b - b'A' + 10),
        _ => Err(()),
    }
}

fn http_response(
    status: u16,
    content_type: &str,
    body: Vec<u8>,
    content_range: Option<String>,
) -> http::Response<Vec<u8>> {
    let mut builder = http::Response::builder()
        .status(status)
        .header(http::header::CONTENT_TYPE, content_type)
        .header(http::header::ACCEPT_RANGES, "bytes")
        .header(http::header::CACHE_CONTROL, "no-store")
        .header(http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    if let Some(cr) = content_range {
        builder = builder.header(http::header::CONTENT_RANGE, cr);
    }
    builder.body(body).unwrap_or_else(|_| {
        http::Response::builder()
            .status(500)
            .body(Vec::new())
            .unwrap()
    })
}

#[cfg(test)]
mod tests {
    use super::{
        candidate_urls, clean_device_name, inject_mdns_host, normalize_url,
        validate_desktop_manifest, DesktopProtocolRange, DesktopServerManifest,
    };

    fn manifest(min: u32, max: u32) -> DesktopServerManifest {
        DesktopServerManifest {
            app: "polarr".into(),
            server_version: "0.6.21".into(),
            protocol: DesktopProtocolRange { min, max },
            capabilities: vec!["web-app".into()],
            web_app_path: "/".into(),
        }
    }

    #[test]
    fn umbrel_keeps_port_and_adds_local() {
        let urls = candidate_urls("http://umbrel:3647").unwrap();
        assert!(
            urls.iter()
                .any(|u| u.contains("umbrel.local") && u.contains(":3647")),
            "{urls:?}"
        );
        assert!(
            urls.iter()
                .any(|u| u.contains("://umbrel:") && u.contains("3647")),
            "{urls:?}"
        );
    }

    #[test]
    fn umbrel_local_keeps_port() {
        let urls = candidate_urls("http://umbrel.local:3647").unwrap();
        assert_eq!(urls, vec!["http://umbrel.local:3647"]);
    }

    #[test]
    fn inject_local_before_port() {
        assert_eq!(
            inject_mdns_host("http://umbrel:3647").as_deref(),
            Some("http://umbrel.local:3647")
        );
    }

    #[test]
    fn normalize_ip_with_port() {
        assert_eq!(
            normalize_url("http://192.168.1.10:3647").unwrap(),
            "http://192.168.1.10:3647"
        );
    }

    #[test]
    fn cleans_native_device_names() {
        assert_eq!(
            clean_device_name("DESKTOP-SSNAPJL\n").as_deref(),
            Some("DESKTOP-SSNAPJL")
        );
        assert_eq!(
            clean_device_name("Studio-Mac.local").as_deref(),
            Some("Studio-Mac")
        );
        assert_eq!(clean_device_name("   "), None);
    }

    #[test]
    fn accepts_compatible_desktop_protocol() {
        assert!(validate_desktop_manifest(&manifest(1, 1)).is_ok());
        assert!(validate_desktop_manifest(&manifest(1, 2)).is_ok());
    }

    #[test]
    fn rejects_incompatible_desktop_protocol() {
        assert!(validate_desktop_manifest(&manifest(2, 2)).is_err());
        assert!(validate_desktop_manifest(&manifest(0, 0)).is_err());
    }
}
