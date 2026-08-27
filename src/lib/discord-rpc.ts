/**
 * Discord Rich Presence — “Listening to Polarr”.
 *
 * Prefer Polarr desktop (Tauri IPC via `__POLARR_DESKTOP__` / `__TAURI__`).
 * Fall back to Discord’s local WebSocket RPC (ports 6463–6472) in a browser
 * when Discord is running on this machine.
 */

export type DiscordActivityPayload = {
  title: string;
  artist: string;
  album?: string;
  /** Absolute or relative cover URL; Discord needs a fetchable URL for art. */
  coverUrl?: string | null;
  /** Playback position in seconds. */
  progressSec?: number;
  /** Track duration in seconds. */
  durationSec?: number;
};

type RpcMessage = {
  cmd?: string;
  evt?: string;
  nonce?: string;
  data?: unknown;
};

type TauriInvoke = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

const PORTS = [6463, 6464, 6465, 6466, 6467, 6468, 6469, 6470, 6471, 6472];

let socket: WebSocket | null = null;
let clientId = "";
let ready = false;
let connecting: Promise<boolean> | null = null;
let nonceCounter = 0;
let unloadHooked = false;

function nextNonce() {
  nonceCounter += 1;
  return `polarr-${Date.now()}-${nonceCounter}`;
}

function clip(s: string, max = 128) {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function resolveCoverUrl(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  const value = raw.trim();
  try {
    const absolute = /^https?:\/\//i.test(value)
      ? value
      : typeof window !== "undefined"
        ? new URL(value, window.location.origin).href
        : value;
    if (/^https?:\/\//i.test(absolute)) return absolute.slice(0, 300);
  } catch {
    /* ignore bad URLs */
  }
  return undefined;
}

function buildState(artist: string, album?: string) {
  const a = artist.trim();
  const al = album?.trim();
  if (al && a) {
    const combined = `${a} · ${al}`;
    if (combined.length <= 128) return combined;
  }
  return clip(a || al || "Unknown artist");
}

function buildTimestamps(progressSec?: number, durationSec?: number) {
  const now = Math.floor(Date.now() / 1000);
  const progress =
    typeof progressSec === "number" && Number.isFinite(progressSec)
      ? Math.max(0, progressSec)
      : 0;
  const duration =
    typeof durationSec === "number" && Number.isFinite(durationSec)
      ? Math.max(0, durationSec)
      : 0;

  if (duration > 0) {
    const start = now - Math.min(progress, duration);
    return { start, end: start + duration };
  }
  return { start: now - progress };
}

function ensureUnloadHook() {
  if (typeof window === "undefined" || unloadHooked) return;
  unloadHooked = true;
  window.addEventListener("pagehide", () => {
    void clearDiscordActivity();
  });
}

function getTauriInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    __POLARR_DESKTOP__?: { discordRpc?: boolean };
    __TAURI__?: { core?: { invoke?: TauriInvoke } };
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
  };
  if (!w.__POLARR_DESKTOP__?.discordRpc) return null;
  const invoke =
    w.__TAURI__?.core?.invoke ?? w.__TAURI_INTERNALS__?.invoke ?? null;
  return typeof invoke === "function" ? invoke.bind(w.__TAURI__?.core ?? w) : null;
}

function send(payload: Record<string, unknown>) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function closeSocket() {
  ready = false;
  connecting = null;
  if (socket) {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }
  socket = null;
}

function connectPort(port: number, appId: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}/?v=1&encoding=json`);
    } catch {
      finish(false);
      return;
    }

    const timer = window.setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      finish(false);
    }, 1200);

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          v: 1,
          client_id: appId,
        }),
      );
    });

    ws.addEventListener("message", (ev) => {
      let msg: RpcMessage;
      try {
        msg = JSON.parse(String(ev.data)) as RpcMessage;
      } catch {
        return;
      }
      if (msg.cmd === "DISPATCH" && msg.evt === "READY") {
        window.clearTimeout(timer);
        socket = ws;
        ready = true;
        finish(true);
      }
    });

    ws.addEventListener("error", () => {
      window.clearTimeout(timer);
      finish(false);
    });
    ws.addEventListener("close", () => {
      window.clearTimeout(timer);
      if (socket === ws) {
        socket = null;
        ready = false;
      }
      finish(false);
    });
  });
}

async function ensureConnected(appId: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!appId.trim()) return false;
  if (ready && socket && clientId === appId) return true;
  if (connecting) return connecting;

  clientId = appId.trim();
  closeSocket();

  connecting = (async () => {
    for (const port of PORTS) {
      const ok = await connectPort(port, clientId);
      if (ok) return true;
    }
    return false;
  })();

  const ok = await connecting;
  connecting = null;
  return ok;
}

function activityFields(track: DiscordActivityPayload) {
  const cover = resolveCoverUrl(track.coverUrl);
  const timestamps = buildTimestamps(track.progressSec, track.durationSec);
  return {
    details: clip(track.title || "Unknown track"),
    state: buildState(track.artist, track.album),
    coverUrl: cover ?? null,
    albumText: clip(track.album || track.title || "Polarr"),
    startUnix: timestamps.start,
    endUnix: timestamps.end ?? null,
  };
}

/** Clear Discord activity. */
export async function clearDiscordActivity() {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      await invoke("discord_clear_presence");
      return;
    } catch {
      /* fall through to browser RPC */
    }
  }
  if (!ready || !socket) return;
  send({
    cmd: "SET_ACTIVITY",
    args: { pid: 0, activity: null },
    nonce: nextNonce(),
  });
}

/** Push current track as a Discord Rich Presence activity. */
export async function setDiscordListeningActivity(
  appId: string,
  track: DiscordActivityPayload | null,
): Promise<boolean> {
  ensureUnloadHook();

  if (!track) {
    await clearDiscordActivity();
    return true;
  }

  const fields = activityFields(track);
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      await invoke("discord_set_presence", {
        payload: {
          clientId: appId.trim(),
          title: fields.details,
          artist: fields.state,
          album: fields.albumText,
          coverUrl: fields.coverUrl,
          startUnix: fields.startUnix,
          endUnix: fields.endUnix,
        },
      });
      return true;
    } catch {
      /* Discord closed or IPC error — try browser RPC */
    }
  }

  const connected = await ensureConnected(appId);
  if (!connected) return false;

  const activity: Record<string, unknown> = {
    details: fields.details,
    state: fields.state,
    assets: {
      large_text: fields.albumText,
      ...(fields.coverUrl ? { large_image: fields.coverUrl } : {}),
    },
    timestamps: {
      start: fields.startUnix,
      ...(fields.endUnix != null ? { end: fields.endUnix } : {}),
    },
    type: 2, // LISTENING → “Listening to {App Name}”
  };

  send({
    cmd: "SET_ACTIVITY",
    args: {
      pid: 0,
      activity,
    },
    nonce: nextNonce(),
  });
  return true;
}

export function discordRpcDisconnect() {
  void clearDiscordActivity();
  closeSocket();
}
