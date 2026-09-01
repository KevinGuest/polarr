/**
 * Discord Rich Presence — “Listening to Polarr”.
 *
 * Desktop-only via Tauri named-pipe IPC (`discord_set_presence`).
 * Browser WebSocket RPC is intentionally unsupported: Discord closes sockets
 * from non-allowlisted origins and requires AUTHORIZE/AUTHENTICATE this app
 * never performs. Client ID comes from Admin → Notifications (never hardcoded).
 */

export type DiscordActivityPayload = {
  title: string;
  artist: string;
  album?: string;
  /** Absolute or relative cover URL; only public HTTPS is forwarded to Discord. */
  coverUrl?: string | null;
  /** Playback position in seconds. */
  progressSec?: number;
  /** Track duration in seconds. */
  durationSec?: number;
};

export type DiscordPresenceResult =
  | { ok: true }
  | { ok: false; error: string };

type TauriInvoke = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

let lastSentKey: string | null = null;
let lastSentAt = 0;
const RESEND_SAME_MS = 45_000;
let lastError: string | null = null;

function activityKey(appId: string, fields: ReturnType<typeof activityFields>) {
  return [
    appId.trim(),
    fields.details,
    fields.state,
    fields.albumText,
    fields.coverUrl || "",
    String(fields.startUnix ?? ""),
    String(fields.endUnix ?? ""),
  ].join("|");
}

function clip(s: string, max = 128) {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".localhost")
  ) {
    return true;
  }
  // IPv4 private / link-local
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  // IPv6 unique-local / link-local
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    return true;
  }
  return false;
}

/**
 * Discord fetches cover art from its servers. Only public HTTPS URLs work;
 * localhost / Umbrel / LAN HTTP covers are omitted (presence still works).
 */
export function resolvePublicCoverUrl(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  const value = raw.trim();
  try {
    const absolute = /^https?:\/\//i.test(value)
      ? value
      : typeof window !== "undefined"
        ? new URL(value, window.location.origin).href
        : value;
    const url = new URL(absolute);
    if (url.protocol !== "https:") return undefined;
    if (isPrivateOrLocalHost(url.hostname)) return undefined;
    return absolute.slice(0, 300);
  } catch {
    return undefined;
  }
}

function buildArtistState(artist: string) {
  return clip(artist.trim() || "Unknown artist");
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

function getTauriInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    __POLARR_DESKTOP__?: { discordRpc?: boolean };
    __TAURI__?: { core?: { invoke?: TauriInvoke } };
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
  };
  const invokeOwner = w.__TAURI__?.core ?? w.__TAURI_INTERNALS__;
  const invoke = invokeOwner?.invoke ?? null;
  if (typeof invoke !== "function") return null;
  // Tauri internals are authoritative. The injected desktop marker can land a
  // frame later than the player, which previously made the first presence push
  // look like a browser and disappear until the 45-second retry.
  if (!w.__POLARR_DESKTOP__?.discordRpc && !w.__TAURI_INTERNALS__) return null;
  return invoke.bind(invokeOwner);
}

/** True when running inside Polarr desktop with Discord IPC available. */
export function isDesktopDiscordRpcAvailable(): boolean {
  return getTauriInvoke() !== null;
}

export function getLastDiscordPresenceError(): string | null {
  return lastError;
}

function activityFields(track: DiscordActivityPayload) {
  const cover = resolvePublicCoverUrl(track.coverUrl);
  const timestamps = buildTimestamps(track.progressSec, track.durationSec);
  return {
    details: clip(track.title || "Unknown track"),
    // Keep the activity line artist-only. Album belongs to the cover hover.
    state: buildArtistState(track.artist),
    coverUrl: cover ?? null,
    albumText: clip(track.album || track.title || "Polarr"),
    startUnix: timestamps.start,
    endUnix: timestamps.end ?? null,
  };
}

function fail(error: string): DiscordPresenceResult {
  lastError = error;
  return { ok: false, error };
}

function ok(): DiscordPresenceResult {
  lastError = null;
  return { ok: true };
}

/** Clear Discord activity (desktop IPC only). */
export async function clearDiscordActivity(): Promise<DiscordPresenceResult> {
  lastSentKey = null;
  lastSentAt = 0;
  const invoke = getTauriInvoke();
  if (!invoke) {
    return ok(); // Browser: nothing to clear
  }
  try {
    await invoke("discord_clear_presence");
    return ok();
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : typeof e === "string"
          ? e
          : "Could not clear Discord presence";
    return fail(msg);
  }
}

/**
 * Push current track as Discord Rich Presence.
 * Requires Polarr desktop + Discord desktop + admin Client ID (passed as appId).
 */
export async function setDiscordListeningActivity(
  appId: string,
  track: DiscordActivityPayload | null,
): Promise<DiscordPresenceResult> {
  if (!track) {
    return clearDiscordActivity();
  }

  const id = appId.trim();
  if (!id) {
    return fail("Discord Client ID is not configured (Admin → Notifications)");
  }

  const invoke = getTauriInvoke();
  if (!invoke) {
    return fail(
      "Rich Presence only works in the Polarr desktop app with Discord open",
    );
  }

  const fields = activityFields(track);
  const key = activityKey(id, fields);
  const now = Date.now();
  if (lastSentKey === key && now - lastSentAt < RESEND_SAME_MS) {
    return ok();
  }

  try {
    await invoke("discord_set_presence", {
      payload: {
        clientId: id,
        title: fields.details,
        artist: fields.state,
        album: fields.albumText,
        coverUrl: fields.coverUrl,
        startUnix: fields.startUnix,
        endUnix: fields.endUnix,
      },
    });
    lastSentKey = key;
    lastSentAt = now;
    return ok();
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : typeof e === "string"
          ? e
          : "Could not update Discord presence (is Discord running?)";
    return fail(msg);
  }
}

/** Lightweight connect check used when enabling the Settings toggle. */
export async function probeDiscordPresence(
  appId: string,
): Promise<DiscordPresenceResult> {
  const id = appId.trim();
  if (!id) {
    return fail("Discord Client ID is not configured (Admin → Notifications)");
  }
  const invoke = getTauriInvoke();
  if (!invoke) {
    return fail(
      "Rich Presence only works in the Polarr desktop app with Discord open",
    );
  }
  // Connect only — never set a placeholder activity (that stuck as “Polarr / Connected”).
  try {
    await invoke("discord_probe_presence", { clientId: id });
    return ok();
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : typeof e === "string"
          ? e
          : "Could not connect to Discord (is Discord running?)";
    return fail(msg);
  }
}

export function discordRpcDisconnect() {
  void clearDiscordActivity();
}
