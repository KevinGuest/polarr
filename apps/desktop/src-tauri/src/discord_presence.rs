//! Discord Rich Presence via local Discord desktop IPC.
//! Called from the Polarr server webview (`__POLARR_DESKTOP__.discordRpc` + Tauri invoke).

use std::sync::Mutex;

use discord_rich_presence::{
    activity::{Activity, ActivityType, Assets, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use serde::Deserialize;
use tauri::State;

pub struct DiscordPresenceState {
    inner: Mutex<Option<ConnectedClient>>,
}

struct ConnectedClient {
    client_id: String,
    ipc: DiscordIpcClient,
}

impl Default for DiscordPresenceState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresencePayload {
    client_id: String,
    title: String,
    artist: String,
    album: Option<String>,
    cover_url: Option<String>,
    start_unix: Option<i64>,
    end_unix: Option<i64>,
}

fn truncate(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        return t.to_string();
    }
    let mut out: String = t.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Discord fetches covers from its CDN side — only public HTTPS URLs work.
fn is_public_https_cover(raw: &str) -> bool {
    let Ok(url) = url::Url::parse(raw) else {
        return false;
    };
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    if host == "localhost"
        || host == "127.0.0.1"
        || host == "::1"
        || host == "0.0.0.0"
        || host.ends_with(".local")
        || host.ends_with(".localhost")
    {
        return false;
    }
    if let Ok(std::net::IpAddr::V4(v4)) = host.parse::<std::net::IpAddr>() {
        if v4.is_loopback() || v4.is_private() || v4.is_link_local() {
            return false;
        }
    }
    true
}

fn ensure_client(
    slot: &mut Option<ConnectedClient>,
    client_id: &str,
) -> Result<(), String> {
    let id = client_id.trim();
    if id.is_empty() {
        return Err("Discord Client ID is empty".into());
    }

    if let Some(existing) = slot.as_ref() {
        if existing.client_id == id {
            return Ok(());
        }
    }

    if let Some(mut old) = slot.take() {
        let _ = old.ipc.clear_activity();
        let _ = old.ipc.close();
    }

    let mut ipc = DiscordIpcClient::new(id);
    ipc
        .connect()
        .map_err(|e| format!("Connect to Discord failed (is Discord running?): {e}"))?;
    *slot = Some(ConnectedClient {
        client_id: id.to_string(),
        ipc,
    });
    Ok(())
}

fn apply_activity(
    ipc: &mut DiscordIpcClient,
    payload: &PresencePayload,
) -> Result<(), String> {
    let details = truncate(&payload.title, 128);
    let state = truncate(&payload.artist, 128);
    let album_text = truncate(
        payload
            .album
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&payload.title),
        128,
    );

    let mut assets = Assets::new().large_text(album_text);
    if let Some(cover) = payload
        .cover_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter(|s| is_public_https_cover(s))
    {
        assets = assets.large_image(truncate(cover, 300));
    }

    let mut activity = Activity::new()
        .details(details)
        .state(state)
        .assets(assets)
        .activity_type(ActivityType::Listening);

    if let Some(start) = payload.start_unix {
        let mut ts = Timestamps::new().start(start);
        if let Some(end) = payload.end_unix {
            ts = ts.end(end);
        }
        activity = activity.timestamps(ts);
    }

    ipc
        .set_activity(activity)
        .map_err(|e| format!("set_activity: {e}"))
}

#[tauri::command]
pub fn discord_set_presence(
    state: State<'_, DiscordPresenceState>,
    payload: PresencePayload,
) -> Result<(), String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "Discord presence lock poisoned".to_string())?;

    ensure_client(&mut guard, &payload.client_id)?;

    let client = guard
        .as_mut()
        .ok_or_else(|| "Discord IPC not connected".to_string())?;

    if let Err(err) = apply_activity(&mut client.ipc, &payload) {
        // Discord may have restarted — reconnect once.
        let id = client.client_id.clone();
        let _ = client.ipc.close();
        *guard = None;
        ensure_client(&mut guard, &id)?;
        let client = guard
            .as_mut()
            .ok_or_else(|| "Discord IPC reconnect failed".to_string())?;
        apply_activity(&mut client.ipc, &payload).map_err(|_| err)?;
    }
    Ok(())
}

#[tauri::command]
pub fn discord_clear_presence(state: State<'_, DiscordPresenceState>) -> Result<(), String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "Discord presence lock poisoned".to_string())?;

    if let Some(client) = guard.as_mut() {
        let _ = client.ipc.clear_activity();
    }
    Ok(())
}

/// Connect to Discord IPC only (no activity). Used when enabling listening status.
#[tauri::command]
pub fn discord_probe_presence(
    state: State<'_, DiscordPresenceState>,
    client_id: String,
) -> Result<(), String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "Discord presence lock poisoned".to_string())?;
    ensure_client(&mut guard, &client_id)?;
    Ok(())
}

/// Drop the IPC connection (app quit). Best-effort clear first.
pub fn shutdown(state: &DiscordPresenceState) {
    if let Ok(mut guard) = state.inner.lock() {
        if let Some(mut client) = guard.take() {
            let _ = client.ipc.clear_activity();
            let _ = client.ipc.close();
        }
    }
}
