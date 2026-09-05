/**
 * Drive iOS/Android lock screen + Dynamic Island / Now Playing from the
 * HTML audio element via the Media Session API.
 *
 * Artwork must be absolute http(s) URLs the OS can fetch itself — blob: and
 * capacitor: URLs never appear on the lock screen. Protected Polarr covers
 * rely on `mediaTicket` query params (same as <audio>/<img>).
 */

import {
  ensureNativeMediaTicket,
  isNativeClient,
  nativeAssetUrl,
  nativeServerUrl,
} from "@/lib/native-client";

export type MediaSessionTrackInfo = {
  title: string;
  artist: string;
  album?: string;
  coverPath?: string | null;
};

export type MediaSessionActions = {
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  /** Absolute seconds from start of track */
  seekTo: (seconds: number) => void;
  /** Current playhead seconds (for relative seek actions) */
  getPosition: () => number;
  getDuration: () => number;
};

const ARTWORK_SIZES = [
  "96x96",
  "128x128",
  "192x192",
  "256x256",
  "384x384",
  "512x512",
] as const;

let actionsBound = false;
let actionHandlers: MediaSessionActions | null = null;

function guessImageType(url: string): string | undefined {
  const path = url.split("?")[0]?.toLowerCase() || "";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return undefined;
}

/** Absolute http(s) cover URL suitable for the system Now Playing UI. */
export function mediaSessionArtworkUrl(
  coverPath: string | null | undefined,
): string | null {
  if (!coverPath) return null;
  if (coverPath.startsWith("blob:") || coverPath.startsWith("data:")) return null;

  let candidate = coverPath.trim();
  if (!candidate) return null;

  if (isNativeClient()) {
    const stamped = nativeAssetUrl(candidate);
    if (stamped) candidate = stamped;
  } else if (candidate.startsWith("/")) {
    try {
      candidate = new URL(candidate, window.location.origin).toString();
    } catch {
      return null;
    }
  }

  // nativeAssetUrl may still return a root-relative path if no server bridge.
  if (candidate.startsWith("/")) {
    const server = nativeServerUrl() || (typeof window !== "undefined" ? window.location.origin : null);
    if (!server) return null;
    try {
      candidate = new URL(candidate, `${server}/`).toString();
    } catch {
      return null;
    }
  }

  if (!/^https?:\/\//i.test(candidate)) return null;
  return candidate;
}

function artworkList(coverUrl: string | null): MediaImage[] {
  if (!coverUrl) return [];
  const type = guessImageType(coverUrl);
  return ARTWORK_SIZES.map((sizes) => ({
    src: coverUrl,
    sizes,
    ...(type ? { type } : {}),
  }));
}

export async function updateMediaSessionMetadata(
  track: MediaSessionTrackInfo | null,
): Promise<void> {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;

  if (!track) {
    try {
      navigator.mediaSession.metadata = null;
    } catch {
      /* ignore */
    }
    return;
  }

  if (isNativeClient()) {
    await ensureNativeMediaTicket().catch(() => null);
  }

  const artwork = mediaSessionArtworkUrl(track.coverPath);
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title?.trim() || "Unknown track",
      artist: track.artist?.trim() || "Unknown artist",
      album: track.album?.trim() || "",
      artwork: artworkList(artwork),
    });
  } catch {
    /* Older WebViews may reject partial metadata. */
  }
}

export function setMediaSessionPlaybackState(
  state: MediaSessionPlaybackState,
): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch {
    /* ignore */
  }
}

export function setMediaSessionPositionState(
  positionSec: number,
  durationSec: number,
  playbackRate = 1,
): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  if (!("setPositionState" in navigator.mediaSession)) return;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return;
  const duration = durationSec;
  const position = Math.min(duration, Math.max(0, positionSec));
  try {
    navigator.mediaSession.setPositionState({
      duration,
      position,
      playbackRate: Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1,
    });
  } catch {
    /* Ignore when duration/position are temporarily inconsistent. */
  }
}

export function bindMediaSessionActions(actions: MediaSessionActions): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  actionHandlers = actions;
  if (actionsBound) return;
  actionsBound = true;

  const set = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      /* Action unsupported on this platform. */
    }
  };

  set("play", () => actionHandlers?.play());
  set("pause", () => actionHandlers?.pause());
  set("previoustrack", () => actionHandlers?.prev());
  set("nexttrack", () => actionHandlers?.next());
  set("seekto", (details) => {
    if (typeof details.seekTime === "number") actionHandlers?.seekTo(details.seekTime);
  });
  set("seekbackward", (details) => {
    const offset = details.seekOffset ?? 10;
    const pos = actionHandlers?.getPosition() ?? 0;
    actionHandlers?.seekTo(Math.max(0, pos - offset));
  });
  set("seekforward", (details) => {
    const offset = details.seekOffset ?? 10;
    const pos = actionHandlers?.getPosition() ?? 0;
    const duration = actionHandlers?.getDuration() ?? 0;
    const next = pos + offset;
    actionHandlers?.seekTo(duration > 0 ? Math.min(duration, next) : next);
  });
}
