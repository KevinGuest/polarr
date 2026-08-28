//! Spotify-like offline cache for Polarr desktop.
//!
//! Threat model: casual copy protection — blobs under app data are AES-GCM
//! encrypted with a key derived from a per-device secret + user id. This is
//! not DRM against a determined attacker with debugger access.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use tiny_http::{Header, Method, Response, Server, StatusCode};

const MAGIC: &[u8; 8] = b"PLROFF01";
const INDEX_FILE: &str = "index.json";
const DEVICE_KEY_FILE: &str = "device.key";
const KDF_LABEL: &[u8] = b"polarr-offline-v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineTrackMeta {
    pub track_id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub cover_url: Option<String>,
    pub duration: Option<f64>,
    pub content_type: Option<String>,
    pub user_id: String,
    pub downloaded_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct OfflineIndex {
    tracks: Vec<OfflineTrackMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlobHeader {
    track_id: String,
    title: String,
    artist: String,
    album: Option<String>,
    cover_url: Option<String>,
    duration: Option<f64>,
    content_type: String,
    user_id: String,
    nonce_b64: String,
    v: u32,
}

struct IngestSlot {
    token: String,
    track: OfflineTrackMeta,
}

pub struct OfflineState {
    authorized_user_id: Mutex<Option<String>>,
    ingest: Mutex<Option<IngestSlot>>,
}

impl Default for OfflineState {
    fn default() -> Self {
        Self {
            authorized_user_id: Mutex::new(None),
            ingest: Mutex::new(None),
        }
    }
}

fn offline_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?
        .join("offline");
    fs::create_dir_all(&dir).map_err(|e| format!("create offline dir: {e}"))?;
    Ok(dir)
}

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(offline_dir(app)?.join(INDEX_FILE))
}

fn blob_path(app: &AppHandle, track_id: &str) -> Result<PathBuf, String> {
    let safe: String = track_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    Ok(offline_dir(app)?.join(format!("{safe}.polarr")))
}

fn read_index(app: &AppHandle) -> Result<OfflineIndex, String> {
    let path = index_path(app)?;
    if !path.exists() {
        return Ok(OfflineIndex::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read index: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("parse index: {e}"))
}

fn write_index(app: &AppHandle, index: &OfflineIndex) -> Result<(), String> {
    let path = index_path(app)?;
    let raw = serde_json::to_string_pretty(index).map_err(|e| format!("serialize index: {e}"))?;
    fs::write(&path, raw).map_err(|e| format!("write index: {e}"))
}

fn device_secret(app: &AppHandle) -> Result<[u8; 32], String> {
    let path = offline_dir(app)?.join(DEVICE_KEY_FILE);
    if path.exists() {
        let bytes = fs::read(&path).map_err(|e| format!("read device key: {e}"))?;
        if bytes.len() == 32 {
            let mut out = [0u8; 32];
            out.copy_from_slice(&bytes);
            return Ok(out);
        }
    }
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    fs::write(&path, key).map_err(|e| format!("write device key: {e}"))?;
    Ok(key)
}

fn derive_key(device: &[u8; 32], user_id: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(KDF_LABEL);
    hasher.update(device);
    hasher.update(user_id.as_bytes());
    let dig = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&dig);
    out
}

fn encrypt_blob(
    app: &AppHandle,
    meta: &OfflineTrackMeta,
    plaintext: &[u8],
    content_type: &str,
) -> Result<(), String> {
    let device = device_secret(app)?;
    let key = derive_key(&device, &meta.user_id);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("cipher: {e}"))?;

    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| "encrypt failed".to_string())?;

    let header = BlobHeader {
        track_id: meta.track_id.clone(),
        title: meta.title.clone(),
        artist: meta.artist.clone(),
        album: meta.album.clone(),
        cover_url: meta.cover_url.clone(),
        duration: meta.duration,
        content_type: content_type.to_string(),
        user_id: meta.user_id.clone(),
        nonce_b64: B64.encode(nonce_bytes),
        v: 1,
    };
    let header_json = serde_json::to_vec(&header).map_err(|e| format!("header json: {e}"))?;
    let header_len = header_json.len() as u32;

    let path = blob_path(app, &meta.track_id)?;
    let mut file = File::create(&path).map_err(|e| format!("create blob: {e}"))?;
    file.write_all(MAGIC).map_err(|e| format!("write magic: {e}"))?;
    file.write_all(&header_len.to_le_bytes())
        .map_err(|e| format!("write header len: {e}"))?;
    file.write_all(&header_json)
        .map_err(|e| format!("write header: {e}"))?;
    file.write_all(&ciphertext)
        .map_err(|e| format!("write cipher: {e}"))?;
    Ok(())
}

fn read_blob_parts(path: &Path) -> Result<(BlobHeader, Vec<u8>), String> {
    let mut file = File::open(path).map_err(|e| format!("open blob: {e}"))?;
    let mut magic = [0u8; 8];
    file.read_exact(&mut magic)
        .map_err(|e| format!("read magic: {e}"))?;
    if &magic != MAGIC {
        return Err("invalid offline blob".into());
    }
    let mut len_buf = [0u8; 4];
    file.read_exact(&mut len_buf)
        .map_err(|e| format!("read header len: {e}"))?;
    let header_len = u32::from_le_bytes(len_buf) as usize;
    if header_len > 1_000_000 {
        return Err("corrupt offline blob header".into());
    }
    let mut header_bytes = vec![0u8; header_len];
    file.read_exact(&mut header_bytes)
        .map_err(|e| format!("read header: {e}"))?;
    let header: BlobHeader =
        serde_json::from_slice(&header_bytes).map_err(|e| format!("parse header: {e}"))?;
    let mut ciphertext = Vec::new();
    file.read_to_end(&mut ciphertext)
        .map_err(|e| format!("read ciphertext: {e}"))?;
    Ok((header, ciphertext))
}

fn decrypt_blob(app: &AppHandle, track_id: &str) -> Result<(BlobHeader, Vec<u8>), String> {
    let path = blob_path(app, track_id)?;
    if !path.exists() {
        return Err("offline track not found".into());
    }
    let (header, ciphertext) = read_blob_parts(&path)?;
    let device = device_secret(app)?;
    let key = derive_key(&device, &header.user_id);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("cipher: {e}"))?;
    let nonce_bytes = B64
        .decode(header.nonce_b64.as_bytes())
        .map_err(|_| "bad nonce".to_string())?;
    if nonce_bytes.len() != 12 {
        return Err("bad nonce length".into());
    }
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "decrypt failed — wrong user or corrupt cache".to_string())?;
    Ok((header, plaintext))
}

fn upsert_index(app: &AppHandle, meta: OfflineTrackMeta) -> Result<(), String> {
    let mut index = read_index(app)?;
    index.tracks.retain(|t| t.track_id != meta.track_id);
    index.tracks.insert(0, meta);
    write_index(app, &index)
}

fn remove_from_index(app: &AppHandle, track_id: &str) -> Result<(), String> {
    let mut index = read_index(app)?;
    index.tracks.retain(|t| t.track_id != track_id);
    write_index(app, &index)
}

fn with_cors<R: std::io::Read>(res: Response<R>) -> Response<R> {
    res.with_header(
        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
    )
    .with_header(
        Header::from_bytes(
            &b"Access-Control-Allow-Methods"[..],
            &b"PUT, POST, OPTIONS"[..],
        )
        .unwrap(),
    )
    .with_header(
        Header::from_bytes(
            &b"Access-Control-Allow-Headers"[..],
            &b"Content-Type, X-Polarr-Token"[..],
        )
        .unwrap(),
    )
}

fn unix_now_secs() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginDownloadRequest {
    pub track_id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub cover_url: Option<String>,
    pub duration: Option<f64>,
    pub content_type: Option<String>,
    pub user_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginDownloadResponse {
    pub ingest_url: String,
    pub track_id: String,
}

#[tauri::command]
pub fn offline_set_session(
    state: State<'_, OfflineState>,
    user_id: Option<String>,
) -> Result<(), String> {
    let mut guard = state
        .authorized_user_id
        .lock()
        .map_err(|_| "lock poisoned".to_string())?;
    *guard = user_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    Ok(())
}

#[tauri::command]
pub fn offline_list(app: AppHandle) -> Result<Vec<OfflineTrackMeta>, String> {
    Ok(read_index(&app)?.tracks)
}

#[tauri::command]
pub fn offline_has(app: AppHandle, track_id: String) -> Result<bool, String> {
    Ok(blob_path(&app, &track_id)?.exists())
}

#[tauri::command]
pub fn offline_ids(app: AppHandle) -> Result<Vec<String>, String> {
    Ok(read_index(&app)?
        .tracks
        .into_iter()
        .map(|t| t.track_id)
        .collect())
}

#[tauri::command]
pub fn offline_remove(app: AppHandle, track_id: String) -> Result<(), String> {
    let path = blob_path(&app, &track_id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("remove blob: {e}"))?;
    }
    remove_from_index(&app, &track_id)
}

#[tauri::command]
pub fn offline_clear_all(app: AppHandle) -> Result<(), String> {
    let dir = offline_dir(&app)?;
    if dir.exists() {
        for entry in fs::read_dir(&dir).map_err(|e| format!("read offline dir: {e}"))? {
            let entry = entry.map_err(|e| format!("dir entry: {e}"))?;
            let path = entry.path();
            let is_blob = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("polarr"))
                .unwrap_or(false);
            let is_index = path.file_name().and_then(|n| n.to_str()) == Some(INDEX_FILE);
            if is_blob || is_index {
                let _ = fs::remove_file(path);
            }
        }
    }
    write_index(&app, &OfflineIndex::default())
}

#[tauri::command]
pub fn offline_begin_download(
    app: AppHandle,
    state: State<'_, OfflineState>,
    track: BeginDownloadRequest,
) -> Result<BeginDownloadResponse, String> {
    if track.user_id.trim().is_empty() {
        return Err("Sign in to download offline".into());
    }
    {
        let mut auth = state
            .authorized_user_id
            .lock()
            .map_err(|_| "lock poisoned".to_string())?;
        *auth = Some(track.user_id.clone());
    }

    let token = uuid::Uuid::new_v4().to_string();
    let meta = OfflineTrackMeta {
        track_id: track.track_id.clone(),
        title: track.title,
        artist: track.artist,
        album: track.album,
        cover_url: track.cover_url,
        duration: track.duration,
        content_type: track.content_type.clone(),
        user_id: track.user_id,
        downloaded_at: None,
    };

    {
        let mut ingest = state
            .ingest
            .lock()
            .map_err(|_| "lock poisoned".to_string())?;
        *ingest = Some(IngestSlot {
            token: token.clone(),
            track: meta,
        });
    }

    let server = Server::http("127.0.0.1:0").map_err(|e| format!("bind ingest: {e}"))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or_else(|| "ingest addr".to_string())?;

    let app_handle = app.clone();
    let expected_token = token.clone();
    let track_id = track.track_id.clone();

    thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(180);
        while Instant::now() < deadline {
            match server.recv_timeout(Duration::from_millis(500)) {
                Ok(Some(mut request)) => {
                    let url = request.url().to_string();
                    let method = request.method().clone();
                    let ok_path = url.starts_with("/ingest");

                    if method == Method::Options {
                        let _ = request.respond(with_cors(Response::empty(StatusCode(204))));
                        continue;
                    }

                    let token_ok = url.contains(&format!("token={expected_token}"))
                        || request.headers().iter().any(|h| {
                            h.field.equiv(&"X-Polarr-Token") && h.value.as_str() == expected_token
                        });

                    if method != Method::Put && method != Method::Post {
                        let _ = request.respond(with_cors(Response::empty(StatusCode(405))));
                        continue;
                    }
                    if !ok_path || !token_ok {
                        let _ = request.respond(with_cors(Response::empty(StatusCode(403))));
                        continue;
                    }

                    let content_type = request
                        .headers()
                        .iter()
                        .find(|h| h.field.equiv(&"Content-Type"))
                        .map(|h| h.value.as_str().to_string())
                        .unwrap_or_else(|| "application/octet-stream".into());

                    let mut body = Vec::new();
                    if request.as_reader().read_to_end(&mut body).is_err() {
                        let _ = request.respond(with_cors(Response::empty(StatusCode(400))));
                        break;
                    }

                    let slot = {
                        let st = app_handle.state::<OfflineState>();
                        let mut ingest = match st.ingest.lock() {
                            Ok(g) => g,
                            Err(_) => {
                                let _ = request.respond(with_cors(Response::empty(StatusCode(500))));
                                break;
                            }
                        };
                        ingest.take()
                    };

                    let Some(slot) = slot else {
                        let _ = request.respond(with_cors(Response::empty(StatusCode(410))));
                        break;
                    };
                    if slot.token != expected_token {
                        let _ = request.respond(with_cors(Response::empty(StatusCode(403))));
                        break;
                    }

                    let mut meta = slot.track;
                    meta.content_type = Some(content_type.clone());
                    meta.downloaded_at = Some(unix_now_secs());

                    match encrypt_blob(&app_handle, &meta, &body, &content_type) {
                        Ok(()) => {
                            let _ = upsert_index(&app_handle, meta);
                            let header = Header::from_bytes(
                                &b"Content-Type"[..],
                                &b"application/json"[..],
                            )
                            .unwrap();
                            let _ = request.respond(with_cors(
                                Response::from_string(r#"{"ok":true}"#)
                                    .with_header(header)
                                    .with_status_code(StatusCode(200)),
                            ));
                        }
                        Err(err) => {
                            let safe = err.replace('"', "'");
                            let _ = request.respond(with_cors(
                                Response::from_string(format!(r#"{{"error":"{safe}"}}"#))
                                    .with_status_code(StatusCode(500)),
                            ));
                        }
                    }
                    break;
                }
                Ok(None) => continue,
                Err(_) => break,
            }
        }

        if let Some(st) = app_handle.try_state::<OfflineState>() {
            if let Ok(mut ingest) = st.ingest.lock() {
                if ingest
                    .as_ref()
                    .map(|s| s.track.track_id == track_id)
                    .unwrap_or(false)
                {
                    *ingest = None;
                }
            }
        }
    });

    Ok(BeginDownloadResponse {
        ingest_url: format!("http://127.0.0.1:{port}/ingest?token={token}"),
        track_id: track.track_id,
    })
}

/// Decrypt + optionally slice for the custom protocol handler.
pub fn handle_protocol(
    app: &AppHandle,
    state: &OfflineState,
    track_id: &str,
    range: Option<(u64, Option<u64>)>,
) -> Result<(Vec<u8>, String, Option<(u64, u64, u64)>), String> {
    let user_id = state
        .authorized_user_id
        .lock()
        .map_err(|_| "lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "unauthorized".to_string())?;

    let (header, plaintext) = decrypt_blob(app, track_id)?;
    if header.user_id != user_id {
        return Err("unauthorized for this offline cache".into());
    }

    let content_type = if header.content_type.is_empty() {
        "audio/mpeg".into()
    } else {
        header.content_type
    };

    let total = plaintext.len() as u64;
    if let Some((start, end_opt)) = range {
        if start >= total {
            return Err("range not satisfiable".into());
        }
        let end = end_opt.unwrap_or(total - 1).min(total - 1);
        let slice = plaintext[start as usize..=end as usize].to_vec();
        Ok((slice, content_type, Some((start, end, total))))
    } else {
        Ok((plaintext, content_type, None))
    }
}

pub fn parse_range_header(value: &str) -> Option<(u64, Option<u64>)> {
    let value = value.trim();
    if !value.starts_with("bytes=") {
        return None;
    }
    let spec = &value[6..];
    let mut parts = spec.splitn(2, '-');
    let start: u64 = parts.next()?.parse().ok()?;
    let end = parts
        .next()
        .filter(|s| !s.is_empty())
        .and_then(|s| s.parse().ok());
    Some((start, end))
}
