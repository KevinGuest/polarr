/**
 * Client bridge to the audio cache service worker (`/public/sw.js`).
 *
 * The worker keeps the last ~40 played library tracks in the Cache API so
 * replays start from disk. Nothing here throws: unsupported browsers,
 * insecure origins, and the native iOS shell (AVPlayer bypasses the page
 * fetch pipeline) simply no-op.
 */

import { nativeClientPlatform } from "@/lib/native-client";

const SW_URL = "/sw.js";

export function audioCacheSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  if (!("serviceWorker" in navigator) || !("caches" in window)) return false;
  if (nativeClientPlatform() === "ios") return false;
  // SWs need a secure context (https or localhost).
  return window.isSecureContext;
}

let registering: Promise<ServiceWorkerRegistration | null> | null = null;

/** Idempotent; resolves to the registration (or null when unsupported). */
export function registerAudioCacheWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!audioCacheSupported()) return Promise.resolve(null);
  if (registering) return registering;
  registering = navigator.serviceWorker
    .register(SW_URL, { scope: "/" })
    .catch(() => null);
  return registering;
}

function post(message: unknown) {
  if (!audioCacheSupported()) return;
  const ctrl = navigator.serviceWorker.controller;
  if (ctrl) {
    ctrl.postMessage(message);
    return;
  }
  // First load after registration: controller attaches on `ready`.
  void navigator.serviceWorker.ready
    .then((reg) => reg.active?.postMessage(message))
    .catch(() => {});
}

/** Ask the worker to store the full track body for instant replays. */
export function cacheTrackUrl(url: string) {
  if (!url || !/\/api\/stream\//.test(url)) return;
  post({ type: "cache-track", url });
}

/** Respect Data Saver / metered hints for speculative prefetch. */
function prefetchAllowed(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (conn?.saveData) return false;
  if (conn?.effectiveType && /(^|-)2g$/.test(conn.effectiveType)) return false;
  return true;
}

const MAX_HEAD_BATCH = 120;

/**
 * Ask the worker to store the first ~15 s of each stream URL (Spotify-style
 * "heads"). Order matters: earlier URLs are fetched first. Cheap to call
 * repeatedly — the worker skips anything it already has.
 */
export function cacheHeadUrls(urls: readonly string[]) {
  if (!prefetchAllowed()) return;
  const list = urls.filter((u) => u && /\/api\/stream\//.test(u));
  if (!list.length) return;
  post({ type: "cache-heads", urls: list.slice(0, MAX_HEAD_BATCH) });
}

/** Wipe cached audio (logout / account switch) — web SW cache and iOS heads. */
export async function clearAudioCache() {
  try {
    const { nativeIosPlayerClearHeadCache } = await import("@/lib/ios-player");
    nativeIosPlayerClearHeadCache();
  } catch {
    /* ignore */
  }
  post({ type: "clear" });
  try {
    if (typeof caches !== "undefined") {
      await caches.delete("polarr-audio-v2");
      await caches.delete("polarr-audio-v1");
    }
  } catch {
    /* ignore */
  }
}
