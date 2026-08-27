/**
 * Polarr desktop offline downloads bridge.
 *
 * Desktop-only: talks to Tauri IPC (`invoke`) from the child server webview.
 * Legacy iframe shells still get a postMessage fallback.
 * Umbrel/browser users never see this path.
 *
 * Playback URL (Windows / Tauri 2 custom protocol):
 *   http://polarroffline.localhost/{trackId}
 */

import {
  hasPolarrDesktopGlobal,
  isPolarrDesktop as isDesktopShell,
} from "@/lib/desktop-shell";

export type DesktopOfflineTrack = {
  trackId: string;
  title: string;
  artist: string;
  album?: string | null;
  coverUrl?: string | null;
  duration?: number | null;
  contentType?: string | null;
  userId: string;
};

export type OfflineTrackStatus =
  | "idle"
  | "queued"
  | "downloading"
  | "done"
  | "error";

export type OfflineProgressDetail = {
  active: boolean;
  done: number;
  total: number;
  collectionId: string | null;
  /** Per-track status for the active (or last) batch. */
  statuses: Record<string, OfflineTrackStatus>;
};

export const OFFLINE_PROGRESS_EVENT = "polarr-offline-progress";

const CHANNEL = "polarr-desktop-offline";

type TauriInvoke = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

let bridge: boolean | null = null;
let authorizedUserId: string | null = null;
let offlineIds = new Set<string>();
let syncTimer: number | null = null;

let batchCancelled = false;
let batchRunning = false;
let progress: OfflineProgressDetail = {
  active: false,
  done: 0,
  total: 0,
  collectionId: null,
  statuses: {},
};

function getTauriInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    __POLARR_DESKTOP__?: { offline?: boolean };
    __TAURI__?: { core?: { invoke?: TauriInvoke } };
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
  };
  // Prefer explicit desktop flag; still try invoke if shell markers exist.
  if (w.__POLARR_DESKTOP__ && w.__POLARR_DESKTOP__.offline === false) {
    return null;
  }
  const invoke =
    w.__TAURI__?.core?.invoke ?? w.__TAURI_INTERNALS__?.invoke ?? null;
  if (typeof invoke !== "function") return null;
  return invoke.bind(w.__TAURI__?.core ?? w);
}

function emitProgress() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(OFFLINE_PROGRESS_EVENT, { detail: { ...progress } }),
  );
}

function setProgress(next: Partial<OfflineProgressDetail>) {
  progress = { ...progress, ...next };
  emitProgress();
}

function postToParent(
  type: string,
  payload?: Record<string, unknown>,
): Promise<{
  ok: boolean;
  error?: string;
  ingestUrl?: string;
  trackId?: string;
  ids?: string[];
  tracks?: DesktopOfflineTrack[];
  has?: boolean;
}> {
  if (typeof window === "undefined" || window.parent === window) {
    return Promise.resolve({ ok: false });
  }

  return new Promise((resolve) => {
    const id = `polarr-off-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve({ ok: false, error: "timeout" });
    }, 8_000);

    function onMessage(event: MessageEvent) {
      const data = event.data as {
        channel?: string;
        type?: string;
        id?: string;
        ok?: boolean;
        error?: string;
        ingestUrl?: string;
        trackId?: string;
        ids?: string[];
        tracks?: DesktopOfflineTrack[];
        has?: boolean;
      } | null;
      if (
        !data ||
        data.channel !== CHANNEL ||
        data.id !== id ||
        (data.type !== "pong" && data.type !== "ack")
      ) {
        return;
      }
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve({
        ok: data.type === "pong" || data.ok !== false,
        error: data.error,
        ingestUrl: data.ingestUrl,
        trackId: data.trackId,
        ids: data.ids,
        tracks: data.tracks,
        has: data.has,
      });
    }

    window.addEventListener("message", onMessage);
    try {
      window.parent.postMessage({ channel: CHANNEL, type, id, payload }, "*");
    } catch {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve({ ok: false, error: "postMessage failed" });
    }
  });
}

async function callDesktop(
  type: string,
  payload?: Record<string, unknown>,
): Promise<{
  ok: boolean;
  error?: string;
  ingestUrl?: string;
  trackId?: string;
  ids?: string[];
  tracks?: DesktopOfflineTrack[];
  has?: boolean;
}> {
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      switch (type) {
        case "ping":
          return { ok: true };
        case "session": {
          await invoke("offline_set_session", {
            userId: (payload?.userId as string | null | undefined) ?? null,
          });
          return { ok: true };
        }
        case "ids": {
          const ids = (await invoke("offline_ids")) as string[];
          return { ok: true, ids: Array.isArray(ids) ? ids : [] };
        }
        case "list": {
          const tracks = (await invoke("offline_list")) as DesktopOfflineTrack[];
          return { ok: true, tracks: Array.isArray(tracks) ? tracks : [] };
        }
        case "has": {
          const has = (await invoke("offline_has", {
            trackId: String(payload?.trackId || ""),
          })) as boolean;
          return { ok: true, has: Boolean(has) };
        }
        case "remove": {
          await invoke("offline_remove", {
            trackId: String(payload?.trackId || ""),
          });
          return { ok: true };
        }
        case "begin-download": {
          const track = payload || {};
          const res = (await invoke("offline_begin_download", {
            track: {
              trackId: track.trackId,
              title: track.title,
              artist: track.artist,
              album: track.album ?? null,
              coverUrl: track.coverUrl ?? null,
              duration: track.duration ?? null,
              contentType: track.contentType ?? null,
              userId: track.userId,
            },
          })) as { ingestUrl?: string; trackId?: string };
          return {
            ok: Boolean(res?.ingestUrl),
            ingestUrl: res?.ingestUrl,
            trackId: res?.trackId,
            error: res?.ingestUrl ? undefined : "No ingest URL",
          };
        }
        case "download-done":
          return { ok: true };
        default:
          return { ok: false, error: `unknown ${type}` };
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return postToParent(type, payload);
}

/** True when running inside the Polarr desktop app. */
export async function isPolarrDesktop(): Promise<boolean> {
  if (bridge !== null) return bridge;
  if (typeof window === "undefined") {
    bridge = false;
    return false;
  }
  if (hasPolarrDesktopGlobal() || isDesktopShell()) {
    const invoke = getTauriInvoke();
    if (invoke) {
      bridge = true;
      markDesktopGlobal();
      return true;
    }
  }
  const res = await postToParent("ping");
  bridge = res.ok;
  if (bridge) markDesktopGlobal();
  return bridge;
}

/** Sync helper — marks `__POLARR_DESKTOP__` for feature detection. */
export function markDesktopGlobal() {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __POLARR_DESKTOP__?: Record<string, unknown> };
  w.__POLARR_DESKTOP__ = {
    ...(w.__POLARR_DESKTOP__ || {}),
    offline: true,
  };
}

export function offlineStreamUrl(trackId: string): string | null {
  if (!authorizedUserId || !offlineIds.has(trackId)) return null;
  // Tauri 2 custom schemes on Windows are exposed as http://{scheme}.localhost/
  return `http://polarroffline.localhost/${encodeURIComponent(trackId)}`;
}

export function isTrackOfflineCached(trackId: string): boolean {
  return offlineIds.has(trackId);
}

export function getOfflineProgress(): OfflineProgressDetail {
  return { ...progress, statuses: { ...progress.statuses } };
}

export function subscribeOfflineProgress(
  handler: (detail: OfflineProgressDetail) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent<OfflineProgressDetail>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener(OFFLINE_PROGRESS_EVENT, onEvent);
  handler(getOfflineProgress());
  return () => window.removeEventListener(OFFLINE_PROGRESS_EVENT, onEvent);
}

export async function refreshOfflineIds(): Promise<string[]> {
  if (!(await isPolarrDesktop())) return [];
  const res = await callDesktop("ids");
  if (!res.ok || !Array.isArray(res.ids)) return [...offlineIds];
  offlineIds = new Set(res.ids);
  return res.ids;
}

export async function setDesktopOfflineSession(
  userId: string | null,
): Promise<boolean> {
  if (!(await isPolarrDesktop())) return false;
  authorizedUserId = userId;
  const res = await callDesktop("session", { userId });
  if (res.ok && userId) {
    await refreshOfflineIds();
  }
  if (!userId) {
    offlineIds = new Set();
  }
  return res.ok;
}

export async function clearDesktopOfflineSession(): Promise<void> {
  await setDesktopOfflineSession(null);
}

/**
 * Download a library track into the encrypted desktop offline cache.
 * Fetches `/api/stream/{id}` in the web origin (cookies), then PUTs into the
 * shell's localhost ingest endpoint for encryption.
 */
export async function downloadTrackOffline(
  track: DesktopOfflineTrack,
): Promise<void> {
  if (!(await isPolarrDesktop())) {
    throw new Error("Offline downloads require the Polarr desktop app");
  }
  if (!track.userId) {
    throw new Error("Sign in to download offline");
  }

  await setDesktopOfflineSession(track.userId);

  const begin = await callDesktop("begin-download", {
    trackId: track.trackId,
    title: track.title,
    artist: track.artist,
    album: track.album ?? null,
    coverUrl: track.coverUrl ?? null,
    duration: track.duration ?? null,
    contentType: track.contentType ?? null,
    userId: track.userId,
  });
  if (!begin.ok || !begin.ingestUrl) {
    throw new Error(begin.error || "Couldn’t start offline download");
  }

  const streamRes = await fetch(
    `/api/stream/${encodeURIComponent(track.trackId)}`,
  );
  if (!streamRes.ok) {
    throw new Error(
      streamRes.status === 401
        ? "Sign in to download offline"
        : `Stream failed (${streamRes.status})`,
    );
  }

  const contentType =
    streamRes.headers.get("content-type") ||
    track.contentType ||
    "application/octet-stream";
  const buf = await streamRes.arrayBuffer();

  const putRes = await fetch(begin.ingestUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: buf,
  });

  if (!putRes.ok) {
    const errText = await putRes.text().catch(() => "");
    throw new Error(errText || `Offline ingest failed (${putRes.status})`);
  }

  // Mark on server so album/library "downloaded" badges stay consistent.
  await fetch(`/api/tracks/${encodeURIComponent(track.trackId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: "polarr-desktop" }),
  }).catch(() => null);

  await callDesktop("download-done", { trackId: track.trackId });
  offlineIds.add(track.trackId);
}

export async function removeTrackOffline(trackId: string): Promise<void> {
  if (!(await isPolarrDesktop())) return;
  await callDesktop("remove", { trackId });
  offlineIds.delete(trackId);
}

export function cancelOfflineBatch(): void {
  if (!batchRunning) return;
  batchCancelled = true;
}

export function isOfflineBatchActive(): boolean {
  return batchRunning;
}

/**
 * Sequentially download playlist/album tracks. Supports cancel via
 * `cancelOfflineBatch()`. Emits `OFFLINE_PROGRESS_EVENT` for sidebar UI.
 */
export async function downloadTracksOfflineBatch(opts: {
  collectionId: string;
  tracks: DesktopOfflineTrack[];
}): Promise<{ done: number; total: number; cancelled: boolean }> {
  if (!(await isPolarrDesktop())) {
    throw new Error("Offline downloads require the Polarr desktop app");
  }
  if (batchRunning) {
    throw new Error("A download is already in progress");
  }

  const tracks = opts.tracks.filter(
    (t) =>
      t.trackId &&
      !t.trackId.startsWith("live:") &&
      !t.trackId.startsWith("stream:") &&
      !t.trackId.startsWith("catalog:"),
  );

  const pending = tracks.filter((t) => !offlineIds.has(t.trackId));
  if (pending.length === 0) {
    return { done: tracks.length, total: tracks.length, cancelled: false };
  }

  batchRunning = true;
  batchCancelled = false;

  const statuses: Record<string, OfflineTrackStatus> = {};
  for (const t of tracks) {
    statuses[t.trackId] = offlineIds.has(t.trackId) ? "done" : "queued";
  }

  const already = tracks.length - pending.length;
  setProgress({
    active: true,
    done: already,
    total: tracks.length,
    collectionId: opts.collectionId,
    statuses: { ...statuses },
  });

  let finished = already;
  try {
    for (const track of pending) {
      if (batchCancelled) break;
      statuses[track.trackId] = "downloading";
      setProgress({
        active: true,
        done: finished,
        total: tracks.length,
        collectionId: opts.collectionId,
        statuses: { ...statuses },
      });
      try {
        await downloadTrackOffline(track);
        statuses[track.trackId] = "done";
        finished += 1;
      } catch {
        statuses[track.trackId] = "error";
      }
      setProgress({
        active: !batchCancelled && finished < tracks.length,
        done: finished,
        total: tracks.length,
        collectionId: opts.collectionId,
        statuses: { ...statuses },
      });
    }
  } finally {
    batchRunning = false;
    const cancelled = batchCancelled;
    batchCancelled = false;
    setProgress({
      active: false,
      done: finished,
      total: tracks.length,
      collectionId: opts.collectionId,
      statuses: { ...statuses },
    });
    return { done: finished, total: tracks.length, cancelled };
  }
}

export async function removeTracksOfflineBatch(
  trackIds: string[],
): Promise<void> {
  if (!(await isPolarrDesktop())) return;
  for (const id of trackIds) {
    await removeTrackOffline(id);
  }
}

/** Keep session + id set warm while the desktop shell is open. */
export function startDesktopOfflineSync(getUserId: () => string | null) {
  if (typeof window === "undefined") return () => undefined;
  if (syncTimer != null) return () => undefined;

  const tick = () => {
    void (async () => {
      if (!(await isPolarrDesktop())) return;
      markDesktopGlobal();
      const uid = getUserId();
      if (uid !== authorizedUserId) {
        await setDesktopOfflineSession(uid);
      } else if (uid) {
        await refreshOfflineIds();
      }
    })();
  };

  tick();
  syncTimer = window.setInterval(tick, 20_000);
  return () => {
    if (syncTimer != null) {
      window.clearInterval(syncTimer);
      syncTimer = null;
    }
  };
}
