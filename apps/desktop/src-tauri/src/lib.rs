use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use url::Url;

mod discord_presence;
mod offline;
mod server_webview;

const CONFIG_FILE: &str = "server.json";

#[derive(Debug, Serialize, Deserialize, Default)]
struct ServerConfig {
    url: String,
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

fn normalize_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Enter your Polarr server URL.".into());
    }

    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };

    let parsed = Url::parse(&with_scheme).map_err(|_| {
        "That does not look like a valid URL. Example: http://192.168.1.10:3647".to_string()
    })?;

    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("Only http:// and https:// URLs are supported.".into()),
    }

    if parsed.host_str().is_none() {
        return Err("URL must include a host.".into());
    }

    Ok(with_scheme.trim_end_matches('/').to_string())
}

#[tauri::command]
fn get_server_url(app: AppHandle) -> Result<Option<String>, String> {
    read_config(&app)
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
    let _ = app.emit("server-cleared", ());
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let presence = discord_presence::DiscordPresenceState::default();
    let offline_state = offline::OfflineState::default();

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(presence)
        .manage(offline_state)
        .setup(|app| {
            server_webview::install_chrome_down_relay(app.handle());
            server_webview::install_resize_handler(app.handle());
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
