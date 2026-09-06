"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { nativeAssetUrl, ensureNativeMediaTicket, isNativeClient, nativeClientPlatform } from "@/lib/native-client";
import {
  bindMediaSessionActions,
  setMediaSessionPlaybackState,
  setMediaSessionPositionState,
  updateMediaSessionMetadata,
} from "@/lib/media-session";
import {
  readSystemVolume,
  subscribeSystemVolume,
  usesSystemVolume,
  writeSystemVolume,
} from "@/lib/ios-system-volume";
import { primaryArtistName } from "@/lib/track-match";
import { pushRecentPlayedTrack } from "@/lib/recent-searches";
import { formatDuration, titleLooksExplicit } from "@/lib/utils";
import { emitListenCredited, MEDIA_TICKET_UPDATED_EVENT } from "@/lib/ui-events";
import { LISTEN_HEARTBEAT_SECONDS } from "@/lib/listen";
import { offlineStreamUrl } from "@/lib/desktop-offline";
import {
  detectConnectDevice,
  resolveConnectDevice,
  type LocalConnectDevice,
} from "@/lib/player-device";
import type {
  ConnectCommand,
  ConnectDevice,
  ConnectPlaybackState,
  ConnectTrack,
} from "@/lib/player-sync";
import {
  EQ_FREQUENCIES,
  PLAYBACK_OUTPUT_EVENT,
  PLAYBACK_SETTINGS_KEY,
  PLAYBACK_SETTINGS_EVENT,
  playbackNeedsWebAudio,
  readPlaybackSettings,
  volumeLevelGain,
  type PlaybackSettings,
} from "@/lib/playback-settings";

type AudioEffectsGraph = {
  source: MediaElementAudioSourceNode;
  filters: BiquadFilterNode[];
  master: GainNode;
  splitter: ChannelSplitterNode;
  merger: ChannelMergerNode;
  monoLeft: GainNode;
  monoRight: GainNode;
};

export type KaraokeUiStatus =
  | "idle"
  | "ready"
  | "processing"
  | "queued"
  | "unavailable"
  | "error";

/** Where the audio bytes are coming from right now. */
export type PlaybackQuality = "local" | "youtube";

export type PlayerTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverPath?: string | null;
  /** When set, player uses this URL instead of /api/stream/{id} (e.g. live). */
  streamUrl?: string | null;
  /** Parental advisory / explicit content. */
  explicit?: boolean;
  /** Local library file vs YouTube (yt-dlp) live fallback. */
  quality?: PlaybackQuality | null;
  /**
   * Artist used for live/YTM resolve (album / primary credit).
   * Display credit stays in `artist` (feat. lines, etc.).
   */
  resolveArtist?: string | null;
  /** Catalog duration in seconds — passed to live/YTM match when resolving. */
  duration?: number | null;
};

function postListenCredit(seconds: number, track: PlayerTrack) {
  const sec = Math.max(0, Math.min(3600, Math.floor(seconds)));
  if (sec <= 0) return;
  void fetch("/api/listen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      seconds: sec,
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      coverPath: track.coverPath ?? null,
    }),
    keepalive: true,
  })
    .then((res) => {
      if (res.ok) emitListenCredited({ trackId: track.id });
    })
    .catch(() => null);
}

/** Infer Local vs YouTube from id / stream URL / explicit stamp. */
export function playbackQuality(track: PlayerTrack): PlaybackQuality {
  if (track.quality === "local" || track.quality === "youtube") {
    return track.quality;
  }
  if (track.streamUrl && /\/api\/live\//i.test(track.streamUrl)) {
    return "youtube";
  }
  if (
    track.id.startsWith("live:") ||
    track.id.startsWith("stream:") ||
    track.id.startsWith("catalog:")
  ) {
    return "youtube";
  }
  return "local";
}

/** Karaoke only when the player is actually reading a file on this server. */
export function isKaraokeEligible(track: PlayerTrack | null | undefined): boolean {
  if (!track?.id) return false;
  if (
    track.id.startsWith("live:") ||
    track.id.startsWith("stream:") ||
    track.id.startsWith("catalog:")
  ) {
    return false;
  }
  if (track.streamUrl && /\/api\/live\//i.test(track.streamUrl)) {
    return false;
  }
  return playbackQuality(track) === "local";
}

function withExplicit(track: PlayerTrack): PlayerTrack {
  if (track.explicit) return track;
  return titleLooksExplicit(track.title)
    ? { ...track, explicit: true }
    : track;
}

function withPlayerMeta(track: PlayerTrack): PlayerTrack {
  const base = withExplicit(track);
  return { ...base, quality: playbackQuality(base) };
}

function shuffleTracks(items: PlayerTrack[]): PlayerTrack[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

/** Cached Discord presence prefs (invalidated ~60s). */
let discordPresenceCache: {
  at: number;
  presenceOn: boolean;
  appId: string | null;
} = { at: 0, presenceOn: false, appId: null };

let discordPresenceClearTimer: number | null = null;

function cancelDiscordPresenceClear() {
  if (discordPresenceClearTimer != null) {
    window.clearTimeout(discordPresenceClearTimer);
    discordPresenceClearTimer = null;
  }
}

const PRESENCE_INVALIDATE_EVENT = "polarr-discord-presence-invalidate";

/** Call after Settings toggles Discord presence so the player picks it up. */
export function invalidateDiscordPresenceCache() {
  discordPresenceCache.at = 0;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PRESENCE_INVALIDATE_EVENT));
  }
}

async function fetchLikedPlayerTracks(): Promise<PlayerTrack[]> {
  try {
    const res = await fetch("/api/likes", { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data.tracks) ? data.tracks : [];
    return list.map((t: {
      id: string;
      title: string;
      artist: string;
      album?: string;
      coverPath?: string | null;
    }) =>
      withExplicit({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album || "",
        coverPath: t.coverPath,
      }),
    );
  } catch {
    return [];
  }
}

/** Taste / listen-affinity autoplay filler when the queue runs dry. */
async function fetchTasteAutoplayTracks(
  current: PlayerTrack,
  excludeIds: string[],
  limit = 24,
): Promise<PlayerTrack[]> {
  try {
    const qs = new URLSearchParams();
    qs.set("limit", String(limit));
    if (
      !current.id.startsWith("live:") &&
      !current.id.startsWith("stream:") &&
      !current.id.startsWith("catalog:")
    ) {
      qs.set("trackId", current.id);
    }
    const artist =
      (current.resolveArtist || "").trim() ||
      primaryArtistName(current.artist) ||
      current.artist;
    if (artist) qs.set("artist", artist);
    if (current.album) qs.set("album", current.album);
    if (excludeIds.length) {
      qs.set("exclude", excludeIds.slice(0, 100).join(","));
    }
    const res = await fetch(`/api/radio?${qs.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data.tracks) ? data.tracks : [];
    return list.map(
      (t: {
        id: string;
        title: string;
        artist: string;
        album?: string;
        coverPath?: string | null;
      }) =>
        withPlayerMeta({
          id: t.id,
          title: t.title,
          artist: t.artist,
          album: t.album || "",
          coverPath: t.coverPath,
          quality: "local",
        }),
    );
  } catch {
    return [];
  }
}

export type PlayerPanelId = "lyrics" | "devices" | "nowPlaying" | "queue";

export type QueueTab = "queue" | "recent";

/** @deprecated Use PlayerPanelId; "none" means close all via setPanel. */
export type PlayerPanel = PlayerPanelId | "none";

type OpenPanels = Record<PlayerPanelId, boolean>;

const CLOSED_PANELS: OpenPanels = {
  lyrics: false,
  devices: false,
  nowPlaying: false,
  queue: false,
};

const DEFAULT_PANELS: OpenPanels = {
  ...CLOSED_PANELS,
  queue: true,
};

export type ConnectDeviceInfo = {
  id: string;
  name: string;
  kind: "phone" | "tablet" | "computer";
  self: boolean;
  active: boolean;
};

type PlayerContextValue = {
  track: PlayerTrack | null;
  queue: PlayerTrack[];
  playing: boolean;
  progress: number;
  duration: number;
  volume: number;
  /**
   * Karaoke mix: 1 = full original, 0 = full Demucs instrumental.
   * Requires a prepared stem (see karaokeStatus).
   */
  vocalLevel: number;
  /** Instrumental stem pipeline for the current library track. */
  karaokeStatus: KaraokeUiStatus;
  karaokeProgress: number;
  karaokeError: string | null;
  /** True when the current track is a file on this server (not YouTube/live). */
  karaokeEligible: boolean;
  shuffle: boolean;
  /** True when any overlay is open (legacy convenience). */
  panel: PlayerPanel;
  isPanelOpen: (id: PlayerPanelId) => boolean;
  play: (track: PlayerTrack, queue?: PlayerTrack[]) => void;
  toggle: () => void;
  seek: (ratio: number) => void;
  next: () => void;
  prev: () => void;
  setVolume: (v: number) => void;
  setVocalLevel: (v: number) => void;
  toggleShuffle: () => void;
  addToQueue: (track: PlayerTrack) => void;
  removeFromQueue: (trackId: string) => void;
  playQueueIndex: (index: number) => void;
  /** Patch http(s) cover URLs onto queued / current tracks by id. */
  patchTrackCovers: (covers: Record<string, string>) => void;
  /** Open a panel without closing others; pass "none" to close all. */
  setPanel: (panel: PlayerPanel) => void;
  closePanel: (id: PlayerPanelId) => void;
  togglePanel: (panel: PlayerPanelId) => void;
  queueTab: QueueTab;
  setQueueTab: (tab: QueueTab) => void;
  /** Open the queue rail, optionally on a specific tab. */
  openQueue: (tab?: QueueTab) => void;
  progressLabel: string;
  connectDevices: ConnectDeviceInfo[];
  activeConnectDevice: ConnectDeviceInfo | null;
  isRemotePlayback: boolean;
  transferPlayback: (deviceId: string) => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

const PLAYER_CHANNEL = "polarr-player";
const PLAYER_STORAGE_KEY = "polarr-player-v1";
const QUEUE_RAIL_STORAGE_KEY = "polarr-queue-rail-v1";

type SyncPayload = {
  track: PlayerTrack | null;
  queue: PlayerTrack[];
  playing: boolean;
  progress: number;
  duration: number;
  volume: number;
  shuffle?: boolean;
  ownerId: string;
  updatedAt: number;
};

type SyncMsg =
  | { kind: "sync"; payload: SyncPayload }
  | { kind: "hello"; tabId: string };

function newCommandId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function trackToConnect(track: PlayerTrack): ConnectTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    coverPath: track.coverPath,
    streamUrl: track.streamUrl,
    explicit: track.explicit,
    quality: track.quality,
    resolveArtist: track.resolveArtist,
    duration: track.duration,
  };
}

function connectToTrack(track: ConnectTrack): PlayerTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    coverPath: track.coverPath,
    streamUrl: track.streamUrl,
    explicit: track.explicit,
    quality: track.quality,
    resolveArtist: track.resolveArtist,
    duration: track.duration,
  };
}

type ConnectSyncResponse = {
  devices?: ConnectDevice[];
  state?: ConnectPlaybackState | null;
  commands?: ConnectCommand[];
};

async function postConnectSync(body: {
  device: LocalConnectDevice;
  state?: {
    track: ConnectTrack | null;
    queue: ConnectTrack[];
    playing: boolean;
    progress: number;
    duration: number;
    volume: number;
    shuffle: boolean;
  };
  command?: ConnectCommand | { id: string; type: "transfer"; targetId: string };
}): Promise<ConnectSyncResponse | null> {
  try {
    const res = await fetch("/api/player/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    return (await res.json()) as ConnectSyncResponse;
  } catch {
    return null;
  }
}

function audioSrcFor(track: PlayerTrack): string {
  const offline = offlineStreamUrl(track.id);
  if (offline) return offline;
  let src =
    track.streamUrl
      ? nativeAssetUrl(track.streamUrl) || track.streamUrl
      : nativeAssetUrl(`/api/stream/${track.id}`) || `/api/stream/${track.id}`;
  // iOS HTMLAudio cannot decode FLAC — ask the server for a phone encode.
  if (
    typeof navigator !== "undefined" &&
    (nativeClientPlatform() === "ios" ||
      /iPhone|iPad|iPod/i.test(navigator.userAgent || ""))
  ) {
    try {
      const url = new URL(src, window.location.origin);
      if (/\/api\/(stream|live)\//.test(url.pathname)) {
        url.searchParams.set("compat", "1");
        url.searchParams.set(
          "quality",
          readPlaybackSettings().streamQuality || "high",
        );
        src = url.toString();
      }
    } catch {
      /* keep original */
    }
  }
  return src;
}

/** Browser throws this when play() is raced by pause/src change — not a real failure. */
function isBenignPlayError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name: unknown }).name) : "";
  const msg = "message" in err ? String((err as { message: unknown }).message) : "";
  return (
    name === "AbortError" ||
    name === "NotAllowedError" ||
    /interrupted by a (new load request|call to pause)/i.test(msg)
  );
}

/**
 * play() that never rejects. AbortError / NotAllowedError → false.
 * Stops Next/React overlay noise from rapid track changes.
 */
function safePlay(audio: HTMLAudioElement): Promise<boolean> {
  try {
    const p = audio.play();
    if (p === undefined) return Promise.resolve(true);
    return p.then(() => true).catch((err: unknown) => {
      if (isBenignPlayError(err)) return false;
      console.warn("[player] play() failed", err);
      return false;
    });
  } catch (err) {
    if (isBenignPlayError(err)) return Promise.resolve(false);
    console.warn("[player] play() failed", err);
    return Promise.resolve(false);
  }
}

/** Compare stream URLs ignoring volatile auth tickets (mediaTicket rotation). */
function streamUrlKey(url: string): string {
  try {
    const parsed = new URL(
      url,
      typeof window !== "undefined" ? window.location.origin : "https://local.invalid",
    );
    parsed.searchParams.delete("mediaTicket");
    parsed.hash = "";
    return `${parsed.origin}${parsed.pathname}?${parsed.searchParams.toString()}`;
  } catch {
    return url;
  }
}

function sameStreamUrl(a: string, b: string): boolean {
  return Boolean(a) && Boolean(b) && streamUrlKey(a) === streamUrlKey(b);
}

/** Swap mediaTicket on an existing element without treating it as a new track. */
function restampAudioTicket(audio: HTMLAudioElement): boolean {
  if (!isNativeClient() || !audio.src) return false;
  const ticket = window.__POLARR_NATIVE_CLIENT__?.mediaTicket;
  if (!ticket) return false;
  try {
    const url = new URL(audio.src);
    if (!/\/api\/(stream|live)\//.test(url.pathname)) return false;
    if (url.searchParams.get("mediaTicket") === ticket) return false;
    const resumeAt = audio.currentTime || 0;
    const wasPlaying = !audio.paused;
    url.searchParams.set("mediaTicket", ticket);
    audio.src = url.toString();
    const seekTo = () => {
      try {
        if (resumeAt > 0.25) audio.currentTime = resumeAt;
      } catch {
        /* ignore */
      }
    };
    audio.addEventListener("loadedmetadata", seekTo, { once: true });
    audio.addEventListener("canplay", seekTo, { once: true });
    if (wasPlaying) void safePlay(audio).then(() => seekTo());
    return true;
  } catch {
    return false;
  }
}

function finiteDuration(...values: Array<number | null | undefined>): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return 0;
}

/** Apply a new media URL; no-op if the element already has the same stream. */
function setAudioSrc(audio: HTMLAudioElement, src: string, force = false) {
  if (!force && audio.src && sameStreamUrl(audio.src, src)) return false;
  audio.pause();
  audio.src = src;
  // Force the element to abandon any in-flight fetch/play cleanly.
  try {
    audio.load();
  } catch {
    /* ignore */
  }
  return true;
}

function seekAudioTo(audio: HTMLAudioElement, seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0.25) return;
  try {
    if (Math.abs(audio.currentTime - seconds) > 0.35) {
      audio.currentTime = seconds;
    }
  } catch {
    /* not seekable yet */
  }
}

/** Keep retrying seek across load/play races; stop once the playhead lands. */
function armResumeSeek(audio: HTMLAudioElement, resumeAt: number): () => void {
  let finished = false;
  const events = ["loadedmetadata", "loadeddata", "canplay"] as const;
  const timers: number[] = [];

  const cleanup = () => {
    if (finished) return;
    finished = true;
    for (const ev of events) audio.removeEventListener(ev, seek);
    for (const timer of timers) window.clearTimeout(timer);
  };

  const seek = () => {
    if (finished) return;
    seekAudioTo(audio, resumeAt);
    if (
      audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      Math.abs(audio.currentTime - resumeAt) < 0.85
    ) {
      cleanup();
    }
  };

  for (const ev of events) audio.addEventListener(ev, seek);
  seek();
  for (const ms of [80, 200, 500, 1200]) {
    timers.push(window.setTimeout(seek, ms));
  }
  timers.push(window.setTimeout(cleanup, 2_500));
  return cleanup;
}

/** Wait until the element can start playback. Timeout / error → false. */
function waitForCanPlay(
  audio: HTMLAudioElement,
  isCurrent: () => boolean,
  timeoutMs = 12_000,
): Promise<boolean> {
  if (!isCurrent()) return Promise.resolve(false);
  if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      audio.removeEventListener("canplay", onReady);
      audio.removeEventListener("loadeddata", onReady);
      audio.removeEventListener("error", onErr);
      window.clearTimeout(timer);
      resolve(ok && isCurrent());
    };
    const onReady = () => {
      if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        finish(true);
      }
    };
    const onErr = () => finish(false);
    // Never treat timeout as success — that muted the mix with a silent inst bus
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    audio.addEventListener("canplay", onReady);
    audio.addEventListener("loadeddata", onReady);
    audio.addEventListener("error", onErr, { once: true });
  });
}

function audioLooksPlayable(el: HTMLAudioElement | null | undefined): boolean {
  if (!el?.src) return false;
  if (el.error) return false;
  if (!(el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)) return false;
  if (!Number.isFinite(el.duration) || el.duration <= 0) return false;
  return true;
}

/** Live / catalog / stream ids may need resolve before play. */
function isLibraryTrackId(id: string): boolean {
  const t = (id || "").trim();
  if (!t || t.includes(":")) return false;
  // Library ids are hex from randomBytes(12) — never live:/stream:/catalog:
  return /^[a-f0-9]{16,}$/i.test(t) || (t.length >= 8 && !/[/:\\]/.test(t));
}

function isEphemeralTrack(track: PlayerTrack): boolean {
  // Real library rows always play via /api/stream — even if a prior miss
  // stamped quality: "youtube" into session storage.
  if (track.quality === "local") return false;
  if (isLibraryTrackId(track.id)) return false;
  if (track.quality === "youtube") return true;
  if (
    track.id.startsWith("live:") ||
    track.id.startsWith("stream:") ||
    track.id.startsWith("catalog:")
  ) {
    return true;
  }
  return Boolean(track.streamUrl && /\/api\/live\//i.test(track.streamUrl));
}

/**
 * Resolve stream/catalog/live tracks to a playable URL.
 *
 * Library tracks skip the network — /api/stream/{id} is ready immediately.
 * Ban/rickroll is enforced on the stream endpoint; media errors force a
 * resolve so restricted accounts still get the rewrite — and so a missing
 * local file can fall through to YouTube live.
 *
 * Ephemeral ids with a fresh /api/live URL are reused (search/album already
 * resolved). Re-POST only when streamUrl is missing, or opts.force (410 /
 * media error). Server dedupes by artist|title when the session is alive.
 */
async function resolveIfNeeded(
  track: PlayerTrack,
  opts?: { force?: boolean },
): Promise<PlayerTrack> {
  const ephemeral = isEphemeralTrack(track);
  const force = Boolean(opts?.force);

  if (!ephemeral && !force) {
    // Strip stale live proxy URLs from hydrated library tracks
    if (track.streamUrl && /\/api\/live\//i.test(track.streamUrl)) {
      return { ...track, streamUrl: null };
    }
    return track;
  }

  try {
    const resolveArtist =
      (track.resolveArtist || "").trim() ||
      primaryArtistName(track.artist) ||
      track.artist;
    const libraryTrackId = isLibraryTrackId(track.id) ? track.id : undefined;
    const res = await fetch("/api/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: track.title,
        // Full credit for library match; server strips for YouTube.
        artist: track.artist || resolveArtist,
        album: track.album,
        trackId: libraryTrackId,
        duration: track.duration || undefined,
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.status === 403) {
      const msg =
        typeof data?.error === "string"
          ? data.error
          : "Playback isn’t allowed on your account.";
      try {
        const { toastError } = await import("@/lib/toast");
        toastError(msg);
      } catch {
        /* ignore */
      }
      return track;
    }
    // Logged out / expired session — silent (login page must not toast this)
    if (res.status === 401) {
      return track;
    }
    if (!res.ok || !data) {
      const msg =
        typeof data?.error === "string"
          ? data.error
          : "Couldn’t match this track — won’t play the wrong song.";
      try {
        const { toastError } = await import("@/lib/toast");
        toastError(msg);
      } catch {
        /* ignore */
      }
      return track;
    }
    // Healthy library play: keep the local id (unless force-recovering / rickroll).
    if (
      !ephemeral &&
      !force &&
      !data.rickroll &&
      data.mode === "library" &&
      data.track?.id === track.id
    ) {
      return {
        ...track,
        streamUrl: data.streamUrl || track.streamUrl || null,
        quality: "local",
      };
    }
    // Non-force library track that resolved to something else — don't swap mid-play.
    if (!ephemeral && !force && !data.rickroll) {
      return track;
    }
    // force / ephemeral / rickroll: adopt server answer (YouTube live or library).
    const mode = data.mode === "library" ? "local" : "youtube";
    if (mode === "local") {
      return {
        ...track,
        id: data.track?.id || track.id,
        title: data.track?.title || track.title,
        artist: data.track?.artist || track.artist,
        album: data.track?.album || track.album,
        coverPath: data.track?.coverPath || track.coverPath,
        streamUrl: null,
        quality: "local",
      };
    }
    const liveUrl = data.streamUrl || data.track?.streamUrl || null;
    return {
      ...track,
      id: data.track?.id || track.id,
      title: data.track?.title || track.title,
      artist: data.track?.artist || track.artist,
      album: data.track?.album || track.album,
      coverPath: data.track?.coverPath || track.coverPath,
      streamUrl: liveUrl,
      quality: "youtube",
    };
  } catch {
    return track;
  }
}

const prefetched = new Set<string>();

/**
 * Warm the next track while the current one plays.
 * Library: Range-fetch the first bytes into the browser cache.
 * Live/catalog: resolve the session server-side (yt-dlp is ~3s cold), which
 * also warms the server's byte cache, so the skip starts instantly.
 */
function prefetchStream(track: PlayerTrack | null | undefined) {
  if (!track) return;
  if (prefetched.has(track.id)) return;
  prefetched.add(track.id);
  if (prefetched.size > 200) prefetched.clear();

  if (isEphemeralTrack(track)) {
    void fetch("/api/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: track.title,
        artist: track.artist,
        album: track.album,
        trackId: isLibraryTrackId(track.id) ? track.id : undefined,
        duration: track.duration || undefined,
      }),
      credentials: "same-origin",
    }).catch(() => {
      /* ignore */
    });
    return;
  }

  const src = audioSrcFor(track);
  let pathname = src;
  try {
    pathname = new URL(src, window.location.origin).pathname;
  } catch {
    /* keep */
  }
  if (!pathname.includes("/api/stream/")) return;
  void fetch(src, {
    headers: { Range: "bytes=0-262143" },
    credentials: "same-origin",
    cache: "force-cache",
  }).catch(() => {
    /* ignore */
  });
}

/** Swap a queue entry when a stream/catalog id resolves to a real track. */
function replaceInQueue(
  queue: PlayerTrack[],
  fromId: string,
  ready: PlayerTrack,
): PlayerTrack[] {
  if (fromId === ready.id) return queue;
  return queue.map((t) => (t.id === fromId ? ready : t));
}

function readStored(): SyncPayload | null {
  try {
    const raw = localStorage.getItem(PLAYER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SyncPayload;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(payload: SyncPayload) {
  try {
    localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota / private mode */
  }
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Warm second program bus used for crossfade and gapless hand-off. */
  const nextAudioRef = useRef<HTMLAudioElement | null>(null);
  /** Demucs instrumental bus (full-quality stereo stem). */
  const instAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const effectsGraphsRef = useRef<AudioEffectsGraph[]>([]);
  const transitionBusyRef = useRef(false);
  const transitionTimerRef = useRef<number | null>(null);
  const transitionExhaustedTrackRef = useRef<string | null>(null);
  const playbackSettingsRef = useRef<PlaybackSettings>(readPlaybackSettings());
  const instReadyRef = useRef(false);
  /** Bumps when karaoke prep is cancelled/superseded so aborted loads don't flash Unavailable. */
  const karaokeGenRef = useRef(0);
  const karaokeStatusRef = useRef<KaraokeUiStatus>("idle");
  /** True while a prepareKaraoke poll loop owns this track (survives status→queued re-renders). */
  const karaokePrepActiveRef = useRef(false);
  const queueRef = useRef<PlayerTrack[]>([]);
  /** Queue snapshot before first “add/drop replaces upcoming” — restored if liked empty. */
  const fallbackQueueRef = useRef<PlayerTrack[] | null>(null);
  const trackRef = useRef<PlayerTrack | null>(null);
  const playingRef = useRef(false);
  const progressRef = useRef(0);
  const durationRef = useRef(0);
  const presenceClockRef = useRef<{
    trackId: string;
    startUnix: number;
    durationSec: number;
  } | null>(null);
  const volumeRef = useRef(0.8);
  const vocalLevelRef = useRef(1);
  const attachAudioListenersRef = useRef<(el: HTMLAudioElement) => void>(
    () => {},
  );
  const detachAudioListenersRef = useRef<(el: HTMLAudioElement) => void>(
    () => {},
  );
  const shuffleRef = useRef(false);
  const ownerIdRef = useRef<string | null>(null);
  /** Bumps on each play request so stale play()/resolve races are ignored. */
  const playGenRef = useRef(0);
  const tabIdRef = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `tab-${Math.random().toString(36).slice(2)}`,
  );
  const channelRef = useRef<BroadcastChannel | null>(null);
  const listenAnchorRef = useRef<{ trackId: string; at: number } | null>(null);
  const applyingRemoteRef = useRef(false);
  const publishRef = useRef<(partial?: Partial<SyncPayload>) => void>(() => {});
  const localDeviceRef = useRef<LocalConnectDevice>(
    typeof window === "undefined"
      ? { id: "", name: "This web browser", kind: "computer" }
      : detectConnectDevice(),
  );
  const followingRemoteRef = useRef(false);
  const sendConnectCommandRef = useRef<
    (
      command:
        | ConnectCommand
        | { id: string; type: "transfer"; targetId: string },
    ) => void
  >(() => {});
  const playRef = useRef<(track: PlayerTrack, queue?: PlayerTrack[]) => void>(
    () => {},
  );
  const lastPushedStateAtRef = useRef(0);
  /** Follower UI clock: progress at server `updatedAt`, then extrapolate while playing. */
  const remoteEpochRef = useRef<{
    progress: number;
    at: number;
    playing: boolean;
    trackId: string | null;
  } | null>(null);
  const lastRemoteUpdatedAtRef = useRef(0);

  const [track, setTrack] = useState<PlayerTrack | null>(null);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [vocalLevel, setVocalLevelState] = useState(1);
  const [karaokeStatus, setKaraokeStatus] = useState<KaraokeUiStatus>("idle");
  const [karaokeProgress, setKaraokeProgress] = useState(0);
  const [karaokeError, setKaraokeError] = useState<string | null>(null);

  useEffect(() => {
    karaokeStatusRef.current = karaokeStatus;
  }, [karaokeStatus]);
  const [shuffle, setShuffle] = useState(false);
  const [connectDevices, setConnectDevices] = useState<ConnectDeviceInfo[]>([]);
  const [activeConnectDevice, setActiveConnectDevice] =
    useState<ConnectDeviceInfo | null>(null);
  const [isRemotePlayback, setIsRemotePlayback] = useState(false);
  const [openPanels, setOpenPanelsState] = useState<OpenPanels>(DEFAULT_PANELS);
  const setOpenPanels = setOpenPanelsState;
  const [queuePreferenceReady, setQueuePreferenceReady] = useState(false);
  const [queueTab, setQueueTab] = useState<QueueTab>("queue");
  /** Bumped on seek so Discord progress bar timestamps resync. */
  const [presenceRev, setPresenceRev] = useState(0);
  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);

  useEffect(() => {
    let cancelled = false;
    let queueOpen: boolean | null = null;
    try {
      const stored = localStorage.getItem(QUEUE_RAIL_STORAGE_KEY);
      if (stored === "0" || stored === "1") {
        queueOpen = stored === "1";
      }
    } catch {
      /* private mode */
    }
    queueMicrotask(() => {
      if (cancelled) return;
      if (queueOpen != null) {
        setOpenPanelsState((prev) => ({ ...prev, queue: queueOpen! }));
      }
      setQueuePreferenceReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!queuePreferenceReady) return;
    try {
      localStorage.setItem(
        QUEUE_RAIL_STORAGE_KEY,
        openPanels.queue ? "1" : "0",
      );
    } catch {
      /* private mode */
    }
  }, [openPanels.queue, queuePreferenceReady]);

  // Leave karaoke / overlay panels when navigating away (sidebar album, etc.)
  useEffect(() => {
    if (prevPathnameRef.current === pathname) return;
    prevPathnameRef.current = pathname;
    setOpenPanels((prev) => {
      if (!prev.lyrics && !prev.devices && !prev.nowPlaying) return prev;
      return {
        ...prev,
        lyrics: false,
        devices: false,
        nowPlaying: false,
      };
    });
  }, [pathname, setOpenPanels]);

  useEffect(() => {
    queueRef.current = queue;
    const currentId = trackRef.current?.id;
    const currentIndex = currentId
      ? queue.findIndex((item) => item.id === currentId)
      : -1;
    if (currentIndex >= 0 && currentIndex < queue.length - 1) {
      transitionExhaustedTrackRef.current = null;
    }
  }, [queue]);
  useEffect(() => {
    trackRef.current = track;
  }, [track]);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    vocalLevelRef.current = vocalLevel;
  }, [vocalLevel]);

  /** Equal-power crossfade — never mute the original until instrumental is actually live. */
  const applyMixVolumes = useCallback(() => {
    const mix = audioRef.current;
    const inst = instAudioRef.current;
    if (!mix) return;
    // On iOS, hardware volume is separate — keep element gain full.
    const vol = usesSystemVolume() ? 1 : volumeRef.current;
    const level = vocalLevelRef.current;
    const settingsGain = volumeLevelGain(
      playbackSettingsRef.current.volumeLevel,
    );
    const mixGraph =
      effectsGraphsRef.current.find(
        (graph) => graph.source.mediaElement === mix,
      ) || null;
    const instGraph = inst
      ? effectsGraphsRef.current.find(
          (graph) => graph.source.mediaElement === inst,
        ) || null
      : null;
    // createMediaElementSource bypasses element.volume — drive Web Audio gain.
    const webAudio =
      Boolean(audioContextRef.current) &&
      Boolean(mixGraph) &&
      playbackNeedsWebAudio(playbackSettingsRef.current);

    // Full original while stem isn't confirmed playing
    const instUsable =
      instReadyRef.current &&
      audioLooksPlayable(inst) &&
      // When user wants any instrumental mix, require inst to be running
      (level > 0.995 || (!inst!.paused && !inst!.ended));

    if (!instUsable) {
      if (webAudio && mixGraph) {
        mix.volume = 1;
        mixGraph.master.gain.value = vol * settingsGain;
        if (inst) inst.volume = 1;
        if (instGraph) instGraph.master.gain.value = 0;
      } else {
        mix.volume = vol;
        if (inst) inst.volume = 0;
      }
      return;
    }

    const theta = (1 - level) * 0.5 * Math.PI;
    if (webAudio && mixGraph) {
      mix.volume = 1;
      if (inst) inst.volume = 1;
      mixGraph.master.gain.value = vol * settingsGain * Math.cos(theta);
      if (instGraph) {
        instGraph.master.gain.value = vol * settingsGain * Math.sin(theta);
      }
    } else {
      mix.volume = vol * Math.cos(theta);
      inst!.volume = vol * Math.sin(theta);
    }
  }, []);

  /** Start instrumental bus; returns true only if playback actually started. */
  const ensureInstPlaying = useCallback(async (): Promise<boolean> => {
    const mix = audioRef.current;
    const inst = instAudioRef.current;
    if (!mix || !inst || !instReadyRef.current || !audioLooksPlayable(inst)) {
      return false;
    }
    try {
      if (Math.abs(inst.currentTime - mix.currentTime) > 0.15) {
        inst.currentTime = mix.currentTime;
      }
    } catch {
      /* ignore seek failures */
    }
    if (inst.paused || inst.ended) {
      const ok = await safePlay(inst);
      if (!ok || inst.paused) return false;
    }
    return true;
  }, []);

  const syncInstToMix = useCallback(() => {
    const mix = audioRef.current;
    const inst = instAudioRef.current;
    if (!mix || !inst || !instReadyRef.current || !inst.src) return;
    try {
      if (Math.abs(inst.currentTime - mix.currentTime) > 0.1) {
        inst.currentTime = mix.currentTime;
      }
    } catch {
      /* not ready */
    }
  }, []);

  const configureEffectsGraph = useCallback(
    (graph: AudioEffectsGraph, settings: PlaybackSettings) => {
      const context = audioContextRef.current;
      if (!context) return;
      const firstFilter = graph.filters[0];
      graph.source.disconnect();
      graph.splitter.disconnect();
      graph.merger.disconnect();
      graph.monoLeft.disconnect();
      graph.monoRight.disconnect();
      graph.filters.forEach((filter) => filter.disconnect());
      graph.master.disconnect();

      if (settings.monoAudio) {
        graph.source.connect(graph.splitter);
        graph.splitter.connect(graph.monoLeft, 0);
        graph.splitter.connect(graph.monoRight, 1);
        graph.monoLeft.connect(graph.merger, 0, 0);
        graph.monoLeft.connect(graph.merger, 0, 1);
        graph.monoRight.connect(graph.merger, 0, 0);
        graph.monoRight.connect(graph.merger, 0, 1);
        graph.merger.connect(firstFilter);
      } else {
        graph.source.connect(firstFilter);
      }

      graph.filters.forEach((filter, index) => {
        filter.frequency.value = EQ_FREQUENCIES[index];
        filter.Q.value = 1;
        filter.gain.value = settings.equalizerEnabled
          ? settings.equalizerBands[index] || 0
          : 0;
        const next = graph.filters[index + 1];
        filter.connect(next || graph.master);
      });
      graph.master.gain.value = volumeLevelGain(settings.volumeLevel);
      graph.master.connect(context.destination);
    },
    [],
  );

  const applyOutputDevice = useCallback(async (settings: PlaybackSettings) => {
    const sinkId = settings.outputDeviceId || "default";
    const context = audioContextRef.current as (AudioContext & {
      setSinkId?: (id: string) => Promise<void>;
    }) | null;

    try {
      // Media elements connected through createMediaElementSource() are heard
      // through AudioContext.destination. Selecting a sink on the elements
      // alone therefore has no effect once EQ/mono/volume processing is active.
      if (context) {
        if (typeof context.setSinkId === "function") {
          await context.setSinkId(sinkId);
        } else if (sinkId !== "default") {
          throw new Error(
            "This platform cannot route processed audio to an individual device.",
          );
        }
      } else {
        for (const element of [
          audioRef.current,
          instAudioRef.current,
          nextAudioRef.current,
        ]) {
          if (!element) continue;
          const selectable = element as HTMLAudioElement & {
            setSinkId?: (id: string) => Promise<void>;
          };
          if (typeof selectable.setSinkId === "function") {
            await selectable.setSinkId(sinkId);
          }
        }
      }
      window.dispatchEvent(
        new CustomEvent(PLAYBACK_OUTPUT_EVENT, {
          detail: { ok: true, deviceId: sinkId },
        }),
      );
    } catch (error) {
      if (sinkId !== "default") {
        const fallback = { ...settings, outputDeviceId: "default" };
        playbackSettingsRef.current = fallback;
        try {
          localStorage.setItem(
            PLAYBACK_SETTINGS_KEY,
            JSON.stringify(fallback),
          );
        } catch {
          /* private mode */
        }
      }
      window.dispatchEvent(
        new CustomEvent(PLAYBACK_OUTPUT_EVENT, {
          detail: {
            ok: false,
            deviceId: sinkId,
            error:
              error instanceof Error
                ? error.message
                : "The selected audio output is unavailable.",
          },
        }),
      );
    }

    for (const element of [
      audioRef.current,
      instAudioRef.current,
      nextAudioRef.current,
    ]) {
      if (!element) continue;
      element.preload = settings.gaplessEnabled ? "auto" : "metadata";
    }
  }, []);

  const ensureAudioEffects = useCallback(() => {
    if (
      audioContextRef.current ||
      !audioRef.current ||
      !instAudioRef.current ||
      !nextAudioRef.current
    ) {
      return;
    }
    // Skip Web Audio until EQ/mono/loudness/sink need it. createMediaElementSource
    // permanently captures the element; on Capacitor (cross-origin streams) that
    // often yields silent "playing" without CORS on the media element.
    if (!playbackNeedsWebAudio(playbackSettingsRef.current)) return;
    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextCtor) return;
    try {
      const context = new AudioContextCtor();
      audioContextRef.current = context;
      effectsGraphsRef.current = [
        audioRef.current,
        instAudioRef.current,
        nextAudioRef.current,
      ].map((element) => {
          // Required before createMediaElementSource for cross-origin streams.
          if (isNativeClient() && !element.crossOrigin) {
            element.crossOrigin = "anonymous";
          }
          const filters = EQ_FREQUENCIES.map(() => {
            const filter = context.createBiquadFilter();
            filter.type = "peaking";
            return filter;
          });
          const monoLeft = context.createGain();
          const monoRight = context.createGain();
          monoLeft.gain.value = 0.5;
          monoRight.gain.value = 0.5;
          return {
            source: context.createMediaElementSource(element),
            filters,
            master: context.createGain(),
            splitter: context.createChannelSplitter(2),
            merger: context.createChannelMerger(2),
            monoLeft,
            monoRight,
          };
      });
      effectsGraphsRef.current.forEach((graph) =>
        configureEffectsGraph(graph, playbackSettingsRef.current),
      );
      void applyOutputDevice(playbackSettingsRef.current);
    } catch {
      effectsGraphsRef.current = [];
      void audioContextRef.current?.close().catch(() => null);
      audioContextRef.current = null;
    }
  }, [applyOutputDevice, configureEffectsGraph]);

  const playBoth = useCallback(async () => {
    const mix = audioRef.current;
    if (!mix) return false;
    if (playbackNeedsWebAudio(playbackSettingsRef.current)) {
      ensureAudioEffects();
      if (audioContextRef.current?.state === "suspended") {
        await audioContextRef.current.resume().catch(() => null);
      }
    }
    const ok = await safePlay(mix);
    if (ok && instReadyRef.current && vocalLevelRef.current < 0.999) {
      await ensureInstPlaying();
    }
    applyMixVolumes();
    return ok;
  }, [applyMixVolumes, ensureAudioEffects, ensureInstPlaying]);

  const pauseBoth = useCallback(() => {
    audioRef.current?.pause();
    instAudioRef.current?.pause();
    nextAudioRef.current?.pause();
  }, []);

  const graphFor = useCallback((element: HTMLAudioElement | null) => {
    if (!element) return null;
    return (
      effectsGraphsRef.current.find(
        (graph) => graph.source.mediaElement === element,
      ) || null
    );
  }, []);

  const cancelTransition = useCallback(() => {
    transitionBusyRef.current = false;
    if (transitionTimerRef.current != null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    const spare = nextAudioRef.current;
    if (spare) {
      spare.pause();
      spare.removeAttribute("src");
      try {
        spare.load();
      } catch {
        /* ignore */
      }
    }
    const context = audioContextRef.current;
    const spareGraph = graphFor(spare);
    if (context && spareGraph) {
      spareGraph.master.gain.cancelScheduledValues(context.currentTime);
      spareGraph.master.gain.setValueAtTime(
        volumeLevelGain(playbackSettingsRef.current.volumeLevel) *
          volumeRef.current,
        context.currentTime,
      );
    }
  }, [graphFor]);

  useEffect(() => {
    const applySettings = (settings: PlaybackSettings) => {
      cancelTransition();
      playbackSettingsRef.current = settings;
      if (playbackNeedsWebAudio(settings)) ensureAudioEffects();
      effectsGraphsRef.current.forEach((graph) =>
        configureEffectsGraph(graph, settings),
      );
      void applyOutputDevice(settings);
      applyMixVolumes();
    };
    applySettings(readPlaybackSettings());
    const onSettings = (event: Event) => {
      const detail = (event as CustomEvent<PlaybackSettings>).detail;
      applySettings(detail || readPlaybackSettings());
    };
    window.addEventListener(PLAYBACK_SETTINGS_EVENT, onSettings);
    return () =>
      window.removeEventListener(PLAYBACK_SETTINGS_EVENT, onSettings);
  }, [applyMixVolumes, applyOutputDevice, cancelTransition, configureEffectsGraph, ensureAudioEffects]);

  useEffect(() => {
    shuffleRef.current = shuffle;
  }, [shuffle]);

  const isOwner = useCallback(
    () => ownerIdRef.current === tabIdRef.current,
    [],
  );

  const publish = useCallback((partial?: Partial<SyncPayload>) => {
    if (applyingRemoteRef.current) return;
    const payload: SyncPayload = {
      track: trackRef.current,
      queue: queueRef.current,
      playing: playingRef.current,
      progress: audioRef.current?.currentTime ?? progressRef.current,
      duration: durationRef.current,
      volume: volumeRef.current,
      shuffle: shuffleRef.current,
      ownerId: ownerIdRef.current ?? tabIdRef.current,
      updatedAt: Date.now(),
      ...partial,
    };
    if (partial?.ownerId) ownerIdRef.current = partial.ownerId;
    else if (!ownerIdRef.current) ownerIdRef.current = tabIdRef.current;
    payload.ownerId = ownerIdRef.current;
    writeStored(payload);
    channelRef.current?.postMessage({ kind: "sync", payload } satisfies SyncMsg);
    if (
      payload.ownerId === tabIdRef.current &&
      !followingRemoteRef.current &&
      localDeviceRef.current.id
    ) {
      lastPushedStateAtRef.current = payload.updatedAt;
      void postConnectSync({
        device: localDeviceRef.current,
        state: {
          track: payload.track ? trackToConnect(payload.track) : null,
          queue: payload.queue.map(trackToConnect),
          playing: payload.playing,
          progress: payload.progress,
          duration: payload.duration,
          volume: payload.volume,
          shuffle: Boolean(payload.shuffle),
        },
      }).catch(() => null);
    }
  }, []);

  publishRef.current = publish;

  const resolveAdvanceTarget = useCallback(
    async (current: PlayerTrack): Promise<PlayerTrack | null> => {
      const q = queueRef.current;
      const idx = q.findIndex((t) => t.id === current.id);
      const queued = idx >= 0 ? q[idx + 1] : undefined;
      if (queued) {
        // Soft top-up: keep a taste-based runway ahead of the playhead
        const remaining = idx >= 0 ? q.length - idx - 1 : 0;
        if (remaining <= 2) {
          void topUpQueueFromTasteRef.current(current);
        }
        return queued;
      }

      // Nothing upcoming — grow the queue from this user’s listen taste
      const exclude = new Set(q.map((t) => t.id));
      exclude.add(current.id);
      let fill = await fetchTasteAutoplayTracks(
        current,
        [...exclude],
        24,
      );
      fill = fill.filter((t) => !exclude.has(t.id));

      // Fallback: liked songs when the library/taste pool is thin
      if (fill.length === 0) {
        const liked = await fetchLikedPlayerTracks();
        fill = shuffleTracks(liked.filter((t) => !exclude.has(t.id)));
      }

      if (fill.length > 0) {
        const nextQ =
          idx >= 0
            ? [...q.slice(0, idx + 1), ...fill]
            : [current, ...fill];
        queueRef.current = nextQ;
        setQueue(nextQ);
        publishRef.current({
          queue: nextQ,
          ownerId: tabIdRef.current,
        });
        return fill[0]!;
      }

      // No autoplay material — restore pre-replace queue if we had one
      const original = fallbackQueueRef.current;
      if (original?.length) {
        fallbackQueueRef.current = null;
        queueRef.current = original;
        setQueue(original);
        publishRef.current({
          queue: original,
          ownerId: tabIdRef.current,
        });
      }
      return null;
    },
    [],
  );

  const advanceTargetRef = useRef(resolveAdvanceTarget);
  advanceTargetRef.current = resolveAdvanceTarget;

  const startTransition = useCallback(async () => {
    if (transitionBusyRef.current || !isOwner() || !playingRef.current) return;
    const current = trackRef.current;
    const oldAudio = audioRef.current;
    const warmAudio = nextAudioRef.current;
    if (!current || !oldAudio || !warmAudio) return;
    if (transitionExhaustedTrackRef.current === current.id) return;

    const settings = playbackSettingsRef.current;
    const crossfadeSeconds = settings.crossfadeEnabled
      ? Math.max(1, Math.min(12, settings.crossfadeSeconds))
      : 0;
    if (crossfadeSeconds <= 0 && !settings.gaplessEnabled) return;
    if (vocalLevelRef.current < 0.999 || instReadyRef.current) return;

    const remaining = Math.max(0, (oldAudio.duration || 0) - oldAudio.currentTime);
    // Resolve and buffer ahead of the audible hand-off. Waiting until the last
    // second makes "gapless" depend on network latency and live-track lookup.
    const threshold = (crossfadeSeconds > 0 ? crossfadeSeconds : 0.05) + 5;
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > threshold) {
      return;
    }

    transitionBusyRef.current = true;
    const transitionGen = playGenRef.current;
    try {
      const nextTrack = await advanceTargetRef.current(current);
      if (!nextTrack) {
        transitionExhaustedTrackRef.current = current.id;
        transitionBusyRef.current = false;
        return;
      }
      if (
        transitionGen !== playGenRef.current ||
        trackRef.current?.id !== current.id
      ) {
        transitionBusyRef.current = false;
        return;
      }
      const fromId = nextTrack.id;
      const ready = await resolveIfNeeded(nextTrack);
      if (
        transitionGen !== playGenRef.current ||
        trackRef.current?.id !== current.id ||
        (isEphemeralTrack(ready) && !ready.streamUrl)
      ) {
        transitionBusyRef.current = false;
        return;
      }

      const nextQ = replaceInQueue(queueRef.current, fromId, ready);
      queueRef.current = nextQ;
      setQueue(nextQ);

      warmAudio.pause();
      warmAudio.removeAttribute("src");
      warmAudio.volume = volumeRef.current;
      setAudioSrc(warmAudio, audioSrcFor(ready));
      if (playbackNeedsWebAudio(playbackSettingsRef.current)) {
        ensureAudioEffects();
      }
      const stillCurrent = () =>
        transitionBusyRef.current &&
        transitionGen === playGenRef.current &&
        trackRef.current?.id === current.id &&
        playingRef.current;
      let playable = audioLooksPlayable(warmAudio);
      if (!playable) {
        playable = await waitForCanPlay(warmAudio, stillCurrent, 4_000);
      }
      if (!playable || !stillCurrent()) {
        transitionBusyRef.current = false;
        return;
      }

      const audibleLead = crossfadeSeconds > 0 ? crossfadeSeconds : 0.05;
      while (stillCurrent()) {
        const nowRemaining = Math.max(
          0,
          (oldAudio.duration || 0) - oldAudio.currentTime,
        );
        if (nowRemaining <= audibleLead + 0.12) break;
        await new Promise<void>((resolve) => window.setTimeout(resolve, 80));
      }
      if (!stillCurrent()) {
        transitionBusyRef.current = false;
        return;
      }

      const context = audioContextRef.current;
      if (context?.state === "suspended") {
        await context.resume().catch(() => null);
      }
      const oldGraph = graphFor(oldAudio);
      const warmGraph = graphFor(warmAudio);
      const baseGain =
        volumeLevelGain(settings.volumeLevel) * volumeRef.current;
      if (context && oldGraph && warmGraph) {
        const now = context.currentTime;
        oldGraph.master.gain.cancelScheduledValues(now);
        warmGraph.master.gain.cancelScheduledValues(now);
        oldGraph.master.gain.setValueAtTime(baseGain, now);
        warmGraph.master.gain.setValueAtTime(0, now);
      }

      const played = await safePlay(warmAudio);
      if (!played || !stillCurrent()) {
        if (context && warmGraph) {
          warmGraph.master.gain.setValueAtTime(baseGain, context.currentTime);
        }
        transitionBusyRef.current = false;
        return;
      }

      // Promote the warm bus immediately so progress, seeking, Connect and
      // Discord all follow the track that has started, while the old bus fades.
      detachAudioListenersRef.current(oldAudio);
      audioRef.current = warmAudio;
      nextAudioRef.current = oldAudio;
      attachAudioListenersRef.current(warmAudio);

      karaokeGenRef.current += 1;
      karaokePrepActiveRef.current = false;
      vocalLevelRef.current = 1;
      setVocalLevelState(1);
      instReadyRef.current = false;
      const inst = instAudioRef.current;
      if (inst) {
        inst.pause();
        inst.removeAttribute("src");
        try {
          inst.load();
        } catch {
          /* ignore */
        }
      }
      setKaraokeStatus("idle");
      setKaraokeProgress(0);
      setKaraokeError(null);

      trackRef.current = ready;
      transitionExhaustedTrackRef.current = null;
      setTrack(ready);
      progressRef.current = warmAudio.currentTime || 0;
      setProgress(progressRef.current);
      durationRef.current = warmAudio.duration || ready.duration || 0;
      setDuration(durationRef.current);
      playingRef.current = true;
      setPlaying(true);
      pushRecentPlayedTrack({
        id: ready.id,
        title: ready.title,
        artist:
          ready.resolveArtist || primaryArtistName(ready.artist) || ready.artist,
        album: ready.album,
        coverPath: ready.coverPath,
        quality: ready.quality ?? undefined,
        localTrackId:
          ready.quality === "local" && !isEphemeralTrack(ready)
            ? ready.id
            : undefined,
        onPolarr: ready.quality === "local",
      });
      publishRef.current({
        track: ready,
        queue: nextQ,
        playing: true,
        progress: progressRef.current,
        ownerId: tabIdRef.current,
      });

      const fadeRemaining = Math.max(
        0,
        (oldAudio.duration || 0) - oldAudio.currentTime,
      );
      const fadeSeconds =
        crossfadeSeconds > 0
          ? Math.max(0.15, Math.min(crossfadeSeconds, fadeRemaining))
          : 0.04;
      if (context && oldGraph && warmGraph) {
        const now = context.currentTime;
        const points = 48;
        const fadeOut = new Float32Array(points);
        const fadeIn = new Float32Array(points);
        for (let index = 0; index < points; index += 1) {
          const ratio = index / (points - 1);
          fadeOut[index] = Math.cos(ratio * 0.5 * Math.PI) * baseGain;
          fadeIn[index] = Math.sin(ratio * 0.5 * Math.PI) * baseGain;
        }
        oldGraph.master.gain.setValueCurveAtTime(fadeOut, now, fadeSeconds);
        warmGraph.master.gain.setValueCurveAtTime(fadeIn, now, fadeSeconds);
      } else {
        oldAudio.pause();
      }

      transitionTimerRef.current = window.setTimeout(() => {
        transitionTimerRef.current = null;
        oldAudio.pause();
        oldAudio.removeAttribute("src");
        try {
          oldAudio.load();
        } catch {
          /* ignore */
        }
        if (context && oldGraph) {
          oldGraph.master.gain.cancelScheduledValues(context.currentTime);
          oldGraph.master.gain.setValueAtTime(baseGain, context.currentTime);
        }
        transitionBusyRef.current = false;
        const qi = nextQ.findIndex((item) => item.id === ready.id);
        prefetchStream(qi >= 0 ? nextQ[qi + 1] : undefined);
      }, Math.ceil(fadeSeconds * 1_000) + 40);
    } catch {
      transitionBusyRef.current = false;
    }
  }, [ensureAudioEffects, graphFor, isOwner]);

  const autoplayTopUpBusyRef = useRef(false);
  const topUpQueueFromTasteRef = useRef(
    async (_current: PlayerTrack): Promise<void> => {},
  );
  topUpQueueFromTasteRef.current = async (current: PlayerTrack) => {
    if (autoplayTopUpBusyRef.current) return;
    autoplayTopUpBusyRef.current = true;
    try {
      const q = queueRef.current;
      const idx = q.findIndex((t) => t.id === current.id);
      const remaining = idx >= 0 ? q.length - idx - 1 : q.length;
      if (remaining > 2) return;

      const exclude = new Set(q.map((t) => t.id));
      exclude.add(current.id);
      const fill = (
        await fetchTasteAutoplayTracks(current, [...exclude], 16)
      ).filter((t) => !exclude.has(t.id));
      if (fill.length === 0) return;

      const head = idx >= 0 ? q.slice(0, idx + 1) : [];
      const upcoming = (idx >= 0 ? q.slice(idx + 1) : q).concat(fill);
      const capped = [...head, ...upcoming.slice(0, 40)];
      queueRef.current = capped;
      setQueue(capped);
      publishRef.current({
        queue: capped,
        ownerId: tabIdRef.current,
      });
    } finally {
      autoplayTopUpBusyRef.current = false;
    }
  };

  const claimAndPlay = useCallback(
    (raw: PlayerTrack, nextQueue?: PlayerTrack[], gen?: number) => {
      cancelTransition();
      transitionExhaustedTrackRef.current = null;
      const audio = audioRef.current;
      if (!audio) return;
      const playGen = gen ?? ++playGenRef.current;
      if (playGen !== playGenRef.current) return;

      const next = withPlayerMeta(raw);
      const queue = nextQueue?.map(withPlayerMeta);
      ownerIdRef.current = tabIdRef.current;
      if (queue) {
        queueRef.current = queue;
        setQueue(queue);
      }
      trackRef.current = next;
      setTrack(next);
      setProgress(0);
      progressRef.current = 0;

      // Always leave karaoke when the song changes
      karaokeGenRef.current += 1;
      karaokePrepActiveRef.current = false;
      vocalLevelRef.current = 1;
      setVocalLevelState(1);

      // Reset instrumental bus until stem loads for this track
      instReadyRef.current = false;
      const inst = instAudioRef.current;
      if (inst) {
        inst.pause();
        inst.removeAttribute("src");
        try {
          inst.load();
        } catch {
          /* ignore */
        }
      }
      setKaraokeStatus("idle");
      setKaraokeProgress(0);
      setKaraokeError(null);

      void (async () => {
        const current = () => playGen === playGenRef.current;
        // Native <audio> needs mediaTicket, but only block play when we have none —
        // awaiting a refresh here drops the iOS user-gesture for audio.play().
        if (isNativeClient() && !window.__POLARR_NATIVE_CLIENT__?.mediaTicket) {
          await ensureNativeMediaTicket();
        }
        if (!current()) return;
        setAudioSrc(audio, audioSrcFor(next));
        applyMixVolumes();
        // Start immediately — don't wait for canplay (saves buffer latency).
        // Retry once if the element wasn't ready yet.
        let ok = await playBoth();
        if (!ok && current()) {
          const buffered = await waitForCanPlay(audio, current, 8_000);
          if (!buffered || !current()) return;
          ok = await playBoth();
        }
        if (!ok || !current()) return;
        playingRef.current = true;
        setPlaying(true);
        publish({
          track: next,
          queue: queueRef.current,
          playing: true,
          progress: 0,
          ownerId: tabIdRef.current,
        });
        const q = queueRef.current;
        const idx = q.findIndex((t) => t.id === next.id);
        prefetchStream(idx >= 0 ? q[idx + 1] : undefined);
      })();
    },
    [applyMixVolumes, cancelTransition, playBoth, publish],
  );

  const applyRemote = useCallback((payload: SyncPayload) => {
    if (payload.ownerId === tabIdRef.current) return;
    applyingRemoteRef.current = true;
    ownerIdRef.current = payload.ownerId;

    const audio = audioRef.current;
    // UI-only follower: stop local media so we never compete for the stream
    // (opening miniplayer used to load the same URL and hiccup playback).
    if (audio) {
      if (!audio.paused) audio.pause();
      if (audio.src) {
        audio.removeAttribute("src");
        try {
          audio.load();
        } catch {
          /* ignore */
        }
      }
      audio.volume = payload.volume;
    }
    const inst = instAudioRef.current;
    if (inst) {
      inst.pause();
      if (inst.src) {
        inst.removeAttribute("src");
        try {
          inst.load();
        } catch {
          /* ignore */
        }
      }
    }
    instReadyRef.current = false;

    queueRef.current = payload.queue;
    trackRef.current = payload.track;
    playingRef.current = payload.playing;
    durationRef.current = payload.duration;
    volumeRef.current = payload.volume;

    const epochAt = payload.updatedAt || Date.now();
    remoteEpochRef.current = {
      progress: payload.progress,
      at: epochAt,
      playing: payload.playing,
      trackId: payload.track?.id ?? null,
    };
    const displayProgress = payload.playing
      ? payload.progress + Math.max(0, (Date.now() - epochAt) / 1000)
      : payload.progress;
    const capped =
      payload.duration > 0
        ? Math.min(payload.duration, displayProgress)
        : displayProgress;
    progressRef.current = capped;

    setQueue(payload.queue);
    setTrack(payload.track);
    setPlaying(payload.playing);
    setProgress(capped);
    setDuration(payload.duration);
    setVolumeState(payload.volume);
    if (typeof payload.shuffle === "boolean") {
      shuffleRef.current = payload.shuffle;
      setShuffle(payload.shuffle);
    }

    // Followers must not write localStorage — that can race the owner mid-play.
    queueMicrotask(() => {
      applyingRemoteRef.current = false;
    });
  }, []);

  useEffect(() => {
    const onTime = () => {
      const audio = audioRef.current;
      if (!audio || !isOwner()) return;
      setProgress(audio.currentTime);
      progressRef.current = audio.currentTime;
      const inst = instAudioRef.current;
      if (inst && instReadyRef.current && inst.src) {
        try {
          if (Math.abs(inst.currentTime - audio.currentTime) > 0.12) {
            inst.currentTime = audio.currentTime;
          }
        } catch {
          /* ignore */
        }
      }
      void startTransition();
    };
    const onMeta = () => {
      const audio = audioRef.current;
      if (!audio || !isOwner()) return;
      const next = finiteDuration(
        audio.duration,
        trackRef.current?.duration,
        durationRef.current,
      );
      durationRef.current = next;
      setDuration(next);
    };
    const onEnded = () => {
      const audio = audioRef.current;
      if (!audio || !isOwner()) return;
      setPlaying(false);
      playingRef.current = false;
      const current = trackRef.current;
      if (!current) {
        publishRef.current({ playing: false });
        return;
      }
      void (async () => {
        const nextTrack = await advanceTargetRef.current(current);
        if (!nextTrack) {
          publishRef.current({ playing: false, progress: audio.currentTime });
          return;
        }
        if (trackRef.current?.id !== current.id) return; // user skipped meanwhile
        const fromId = nextTrack.id;
        const ready = await resolveIfNeeded(nextTrack);
        if (trackRef.current?.id !== current.id) return;
        if (isEphemeralTrack(ready) && !ready.streamUrl) return;
        const nextQ = replaceInQueue(queueRef.current, fromId, ready);
        queueRef.current = nextQ;
        setQueue(nextQ);
        const el = audioRef.current;
        if (!el) return;
        // Natural advance = new song — exit karaoke
        karaokeGenRef.current += 1;
        karaokePrepActiveRef.current = false;
        vocalLevelRef.current = 1;
        setVocalLevelState(1);
        instReadyRef.current = false;
        const inst = instAudioRef.current;
        if (inst) {
          inst.pause();
          inst.removeAttribute("src");
          try {
            inst.load();
          } catch {
            /* ignore */
          }
        }
        setKaraokeStatus("idle");
        setKaraokeProgress(0);
        setKaraokeError(null);
        setAudioSrc(el, audioSrcFor(ready));
        setProgress(0);
        progressRef.current = 0;
        trackRef.current = ready;
        setTrack(ready);
        applyMixVolumes();
        const gen = ++playGenRef.current;
        const currentGen = () => gen === playGenRef.current;
        void (async () => {
          let played = await safePlay(el);
          if (!played && currentGen()) {
            const ok = await waitForCanPlay(el, currentGen, 8_000);
            if (!ok || !currentGen()) return;
            played = await safePlay(el);
          }
          if (!played || !currentGen()) return;
          playingRef.current = true;
          setPlaying(true);
          publishRef.current({
            track: ready,
            queue: nextQ,
            playing: true,
            progress: 0,
            ownerId: tabIdRef.current,
          });
          const qi = nextQ.findIndex((t) => t.id === ready.id);
          prefetchStream(qi >= 0 ? nextQ[qi + 1] : undefined);
        })();
      })();
    };

    /** Stale ticket / live URL / ban rewrite — recover without always reminting. */
    let liveRecovering = false;
    let lastErrorAt = 0;
    const onMediaError = () => {
      const audio = audioRef.current;
      if (!audio || !isOwner() || liveRecovering) return;
      const current = trackRef.current;
      if (!current) return;
      const now = Date.now();
      if (now - lastErrorAt < 1500) return;
      lastErrorAt = now;
      liveRecovering = true;
      const resumeAt = Math.max(progressRef.current || 0, audio.currentTime || 0);
      const wantPlay = playingRef.current || !audio.paused;
      void (async () => {
        try {
          // Most common iOS failure: mediaTicket expired while src stayed put.
          if (isNativeClient()) {
            await ensureNativeMediaTicket();
            if (restampAudioTicket(audio)) {
              const seekTo = () => {
                try {
                  if (resumeAt > 0.25) audio.currentTime = resumeAt;
                } catch {
                  /* ignore */
                }
              };
              seekTo();
              audio.addEventListener("loadedmetadata", seekTo, { once: true });
              if (wantPlay) {
                await waitForCanPlay(audio, () => trackRef.current?.id === current.id, 8_000);
                await safePlay(audio);
                seekTo();
              }
              progressRef.current = resumeAt;
              setProgress(resumeAt);
              return;
            }
          }

          const fromId = current.id;
          const ready = await resolveIfNeeded(
            {
              ...current,
              streamUrl: null,
            },
            { force: isEphemeralTrack(current) },
          );
          if (trackRef.current?.id !== fromId && trackRef.current?.id !== ready.id) {
            return;
          }
          const nextSrc = audioSrcFor(ready);
          // Same stream key — restamp/force only if the element is dead.
          if (sameStreamUrl(audio.src, nextSrc) && ready.id === fromId) {
            if (!audio.error) return;
            setAudioSrc(audio, nextSrc, true);
          } else {
            if (!ready.streamUrl && isEphemeralTrack(ready)) return;
            const nextQ = replaceInQueue(queueRef.current, fromId, ready);
            queueRef.current = nextQ;
            setQueue(nextQ);
            trackRef.current = ready;
            setTrack(ready);
            setAudioSrc(audio, nextSrc, true);
          }
          const el = audioRef.current;
          if (!el) return;
          const seekTo = () => {
            try {
              if (resumeAt > 0.25) el.currentTime = resumeAt;
            } catch {
              /* ignore */
            }
          };
          seekTo();
          el.addEventListener("loadedmetadata", seekTo, { once: true });
          if (wantPlay) {
            const gen = ++playGenRef.current;
            const currentGen = () => gen === playGenRef.current;
            let played = await safePlay(el);
            if (!played && currentGen()) {
              await waitForCanPlay(el, currentGen, 8_000);
              if (!currentGen()) return;
              played = await safePlay(el);
            }
            if (played && currentGen()) {
              playingRef.current = true;
              setPlaying(true);
            }
          }
          progressRef.current = resumeAt;
          setProgress(resumeAt);
          publishRef.current({
            track: trackRef.current,
            queue: queueRef.current,
            playing: wantPlay,
            progress: resumeAt,
            ownerId: tabIdRef.current,
          });
        } catch {
          /* leave paused */
        } finally {
          liveRecovering = false;
        }
      })();
    };

    const attach = (el: HTMLAudioElement) => {
      el.addEventListener("timeupdate", onTime);
      el.addEventListener("loadedmetadata", onMeta);
      el.addEventListener("ended", onEnded);
      el.addEventListener("error", onMediaError);
    };
    const detach = (el: HTMLAudioElement) => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onMediaError);
    };
    attachAudioListenersRef.current = attach;
    detachAudioListenersRef.current = detach;

    const audio = new Audio();
    audio.preload = "auto";
    // iOS WKWebView needs CORS for Web Audio / analysis when enabled.
    const iosNative = nativeClientPlatform() === "ios";
    if (iosNative) {
      audio.crossOrigin = "anonymous";
    }
    audio.volume = volumeRef.current;
    audioRef.current = audio;
    const inst = new Audio();
    if (iosNative) inst.crossOrigin = "anonymous";
    inst.volume = 0;
    inst.preload = "auto";
    instAudioRef.current = inst;
    const nextAudio = new Audio();
    if (iosNative) nextAudio.crossOrigin = "anonymous";
    nextAudio.volume = volumeRef.current;
    nextAudio.preload = "auto";
    nextAudioRef.current = nextAudio;
    instReadyRef.current = false;
    attach(audio);

    let remoteTabAlive = false;
    const markRemoteAlive = () => {
      remoteTabAlive = true;
    };

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(PLAYER_CHANNEL);
      channelRef.current = channel;
      channel.onmessage = (ev: MessageEvent<SyncMsg>) => {
        const msg = ev.data;
        if (!msg || typeof msg !== "object") return;
        if (msg.kind === "hello") {
          if (msg.tabId === tabIdRef.current) return;
          markRemoteAlive();
          if (isOwner() && (trackRef.current || queueRef.current.length)) {
            publishRef.current();
          }
          return;
        }
        if (msg.kind === "sync") {
          if (msg.payload.ownerId === tabIdRef.current) return;
          markRemoteAlive();
          applyRemote(msg.payload);
        }
      };
    } catch {
      channel = null;
    }

    const stored = readStored();
    const staleOwnerId =
      stored?.ownerId && stored.ownerId !== tabIdRef.current
        ? stored.ownerId
        : null;
    if (stored?.track) {
      applyingRemoteRef.current = true;
      // Another tab owns active playback — mirror UI only until hello/sync.
      const remoteOwner =
        Boolean(stored.ownerId) && stored.ownerId !== tabIdRef.current;
      ownerIdRef.current = stored.ownerId || null;
      queueRef.current = stored.queue ?? [];
      trackRef.current = stored.track;
      // Never autoplay in a freshly opened tab (dual audio + autoplay block).
      // Keep UI `playing` from store when following so controls don't flash.
      const uiPlaying = remoteOwner ? Boolean(stored.playing) : false;
      playingRef.current = uiPlaying;
      progressRef.current = stored.progress ?? 0;
      durationRef.current = stored.duration ?? 0;
      const restoredVolume = stored.volume ?? 0.8;
      volumeRef.current = restoredVolume;
      const storedShuffle = Boolean(stored.shuffle);
      shuffleRef.current = storedShuffle;
      setQueue(stored.queue ?? []);
      setTrack(stored.track);
      setPlaying(uiPlaying);
      setProgress(stored.progress ?? 0);
      setDuration(stored.duration ?? 0);
      setVolumeState(restoredVolume);
      setShuffle(storedShuffle);
      audio.volume = restoredVolume;

      const savedProgress = stored.progress ?? 0;
      const hydrateId = stored.track.id;
      const applyHydrated = (ready: PlayerTrack) => {
        // User may have started something else while we refreshed.
        if (
          trackRef.current &&
          trackRef.current.id !== hydrateId &&
          trackRef.current.title !== stored.track!.title
        ) {
          return;
        }
        const nextQ = replaceInQueue(queueRef.current, hydrateId, ready);
        queueRef.current = nextQ;
        setQueue(nextQ);
        trackRef.current = ready;
        setTrack(ready);
        const catalogDuration = finiteDuration(
          ready.duration,
          stored.duration,
          durationRef.current,
        );
        if (catalogDuration > 0) {
          durationRef.current = catalogDuration;
          setDuration(catalogDuration);
        }
        // Only prime local audio when no other tab is already playing.
        if (!remoteOwner) {
          void (async () => {
            if (isNativeClient()) {
              await ensureNativeMediaTicket().catch(() => null);
            }
            if (
              trackRef.current &&
              trackRef.current.id !== hydrateId &&
              trackRef.current.title !== stored.track!.title
            ) {
              return;
            }
            setAudioSrc(audio, audioSrcFor(ready));
            const seekTo = () => {
              try {
                if (Number.isFinite(savedProgress) && savedProgress > 0) {
                  audio.currentTime = savedProgress;
                }
              } catch {
                /* not seekable yet */
              }
            };
            seekTo();
            audio.addEventListener("loadedmetadata", seekTo, { once: true });
            audio.addEventListener("canplay", seekTo, { once: true });
          })();
        }
        // Do not writeStored({ playing: false }) — that used to race the owner.
      };

      if (isEphemeralTrack(stored.track)) {
        // Persisted /api/live URLs die with server memory — strip before resolve
        void resolveIfNeeded({
          ...stored.track,
          streamUrl: null,
        }).then(applyHydrated);
      } else {
        applyHydrated(stored.track);
      }

      queueMicrotask(() => {
        applyingRemoteRef.current = false;
      });
    } else {
      // Fresh install / cleared web storage: keep the player visible with the
      // last server-side listen, paused at the bottom. This also survives a
      // desktop reinstall because recent plays live on the Polarr server.
      void fetch("/api/recent?limit=1", { cache: "no-store" })
        .then(async (res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (trackRef.current) return;
          const row = Array.isArray(data?.items) ? data.items[0] : null;
          if (!row?.id || !row?.title || !row?.artist) return;
          const ready = withPlayerMeta({
            id: String(row.id),
            title: String(row.title),
            artist: String(row.artist),
            album: String(row.album || ""),
            coverPath: row.coverPath || null,
            explicit: Boolean(row.explicit),
            duration: Number(row.duration) || null,
          });
          const restoredQueue = [ready];
          ownerIdRef.current = tabIdRef.current;
          trackRef.current = ready;
          queueRef.current = restoredQueue;
          playingRef.current = false;
          progressRef.current = 0;
          durationRef.current = ready.duration || 0;
          setTrack(ready);
          setQueue(restoredQueue);
          setPlaying(false);
          setProgress(0);
          setDuration(ready.duration || 0);
          setAudioSrc(audio, audioSrcFor(ready));
          writeStored({
            track: ready,
            queue: restoredQueue,
            playing: false,
            progress: 0,
            duration: ready.duration || 0,
            volume: volumeRef.current,
            shuffle: shuffleRef.current,
            ownerId: tabIdRef.current,
            updatedAt: Date.now(),
          });
        })
        .catch(() => null);
    }

    channel?.postMessage({
      kind: "hello",
      tabId: tabIdRef.current,
    } satisfies SyncMsg);

    const staleOwnerTimer = window.setTimeout(() => {
      if (remoteTabAlive || !staleOwnerId) return;
      ownerIdRef.current = tabIdRef.current;
      publishRef.current({
        ownerId: tabIdRef.current,
        playing: false,
      });
    }, 2500);

    const onStorage = (e: StorageEvent) => {
      if (e.key !== PLAYER_STORAGE_KEY || !e.newValue) return;
      try {
        const payload = JSON.parse(e.newValue) as SyncPayload;
        if (payload.ownerId === tabIdRef.current) return;
        markRemoteAlive();
        applyRemote(payload);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", onStorage);

    const syncTick = window.setInterval(() => {
      if (!isOwner() || !playingRef.current) return;
      publishRef.current();
    }, 1500);

    const onUnload = () => {
      if (!isOwner()) return;
      const payload: SyncPayload = {
        track: trackRef.current,
        queue: queueRef.current,
        playing: false,
        progress: audioRef.current?.currentTime ?? progressRef.current,
        duration: durationRef.current,
        volume: volumeRef.current,
        shuffle: shuffleRef.current,
        ownerId: tabIdRef.current,
        updatedAt: Date.now(),
      };
      writeStored(payload);
      try {
        channelRef.current?.postMessage({
          kind: "sync",
          payload,
        } satisfies SyncMsg);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pagehide", onUnload);

    return () => {
      window.clearTimeout(staleOwnerTimer);
      window.clearInterval(syncTick);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", onUnload);
      onUnload();
      const el = audioRef.current ?? audio;
      el.pause();
      detach(el);
      const instEl = instAudioRef.current;
      if (instEl) {
        instEl.pause();
        instEl.removeAttribute("src");
      }
      instAudioRef.current = null;
      const nextEl = nextAudioRef.current;
      if (nextEl) {
        nextEl.pause();
        detach(nextEl);
        nextEl.removeAttribute("src");
      }
      nextAudioRef.current = null;
      if (transitionTimerRef.current != null) {
        window.clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = null;
      }
      transitionBusyRef.current = false;
      channel?.close();
      channelRef.current = null;
      effectsGraphsRef.current = [];
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context) void context.close().catch(() => null);
    };
  }, [applyRemote, isOwner, startTransition]);

  const applyConnectDevices = useCallback(
    (devices: ConnectDevice[], ownerId: string | null) => {
      const self = localDeviceRef.current;
      const infos: ConnectDeviceInfo[] = devices.map((d) => ({
        id: d.id,
        name: d.id === self.id ? self.name : d.name,
        kind: d.kind,
        self: d.id === self.id,
        active: Boolean(ownerId) ? d.id === ownerId : d.id === self.id,
      }));
      if (!infos.some((d) => d.self) && self.id) {
        infos.unshift({
          id: self.id,
          name: self.name,
          kind: self.kind,
          self: true,
          active: !ownerId || ownerId === self.id,
        });
      }
      setConnectDevices(infos);
      const active =
        infos.find((d) => d.active) ?? infos.find((d) => d.self) ?? null;
      setActiveConnectDevice(active);
      const remote = Boolean(ownerId) && ownerId !== self.id;
      followingRemoteRef.current = remote;
      setIsRemotePlayback(remote);
    },
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    localDeviceRef.current = detectConnectDevice();
    let cancelled = false;
    void resolveConnectDevice().then((device) => {
      if (!cancelled) localDeviceRef.current = device;
    });

    const runCommands = (commands: ConnectCommand[]) => {
      for (const command of commands) {
        if (command.type === "release") {
          followingRemoteRef.current = true;
          setIsRemotePlayback(true);
          applyRemote({
            track: trackRef.current,
            queue: queueRef.current,
            playing: playingRef.current,
            progress: progressRef.current,
            duration: durationRef.current,
            volume: volumeRef.current,
            shuffle: shuffleRef.current,
            ownerId: `remote-${Date.now()}`,
            updatedAt: Date.now(),
          });
          continue;
        }
        if (command.type === "become-owner") {
          followingRemoteRef.current = false;
          setIsRemotePlayback(false);
          ownerIdRef.current = tabIdRef.current;
          const current = trackRef.current;
          const audio = audioRef.current;
          if (current && audio) {
            const epoch = remoteEpochRef.current;
            let resumeAt = progressRef.current;
            if (epoch?.playing) {
              resumeAt =
                epoch.progress + Math.max(0, (Date.now() - epoch.at) / 1000);
            } else if (epoch && Number.isFinite(epoch.progress)) {
              resumeAt = epoch.progress;
            }
            if (durationRef.current > 0) {
              resumeAt = Math.min(durationRef.current, resumeAt);
            }
            remoteEpochRef.current = null;
            progressRef.current = resumeAt;
            setProgress(resumeAt);
            setAudioSrc(audio, audioSrcFor(current));
            const disarm = armResumeSeek(audio, resumeAt);
            const shouldPlay = playingRef.current;
            const trackId = current.id;
            void (async () => {
              await waitForCanPlay(
                audio,
                () => trackRef.current?.id === trackId,
                10_000,
              );
              seekAudioTo(audio, resumeAt);
              if (shouldPlay && trackRef.current?.id === trackId) {
                await playBoth();
                seekAudioTo(audio, resumeAt);
              }
              window.setTimeout(disarm, 2_500);
            })();
            publishRef.current({
              ownerId: tabIdRef.current,
              playing: shouldPlay,
              progress: resumeAt,
            });
          }
          continue;
        }
        if (command.type === "play-track") {
          followingRemoteRef.current = false;
          playRef.current(
            connectToTrack(command.track),
            command.queue?.map(connectToTrack),
          );
          continue;
        }
        if (command.type === "play") {
          if (!playingRef.current) {
            const audio = audioRef.current;
            const current = trackRef.current;
            if (audio && current) {
              ownerIdRef.current = tabIdRef.current;
              setAudioSrc(audio, audioSrcFor(current));
              void playBoth().then((ok) => {
                if (!ok) return;
                playingRef.current = true;
                setPlaying(true);
                publishRef.current({
                  playing: true,
                  ownerId: tabIdRef.current,
                });
              });
            }
          }
          continue;
        }
        if (command.type === "pause") {
          pauseBoth();
          playingRef.current = false;
          setPlaying(false);
          publishRef.current({
            playing: false,
            ownerId: tabIdRef.current,
          });
          continue;
        }
        if (command.type === "toggle") {
          const audio = audioRef.current;
          if (!audio || !trackRef.current) continue;
          if (playingRef.current) {
            pauseBoth();
            playingRef.current = false;
            setPlaying(false);
            publishRef.current({
              playing: false,
              ownerId: tabIdRef.current,
            });
          } else {
            ownerIdRef.current = tabIdRef.current;
            void playBoth().then((ok) => {
              if (!ok) return;
              playingRef.current = true;
              setPlaying(true);
              publishRef.current({
                playing: true,
                ownerId: tabIdRef.current,
              });
            });
          }
          continue;
        }
        if (command.type === "seek") {
          const audio = audioRef.current;
          if (!audio) continue;
          ownerIdRef.current = tabIdRef.current;
          audio.currentTime = command.progress;
          setProgress(command.progress);
          progressRef.current = command.progress;
          publishRef.current({
            progress: command.progress,
            ownerId: tabIdRef.current,
          });
          continue;
        }
        if (command.type === "next") {
          const current = trackRef.current;
          if (!current) continue;
          void advanceTargetRef.current(current).then((n) => {
            if (n) playRef.current(n);
          });
          continue;
        }
        if (command.type === "prev") {
          const current = trackRef.current;
          const audio = audioRef.current;
          if (!current) continue;
          if (audio && audio.currentTime > 3) {
            audio.currentTime = 0;
            setProgress(0);
            publishRef.current({ progress: 0, ownerId: tabIdRef.current });
            continue;
          }
          const idx = queueRef.current.findIndex((t) => t.id === current.id);
          const prevTrack = queueRef.current[idx - 1];
          if (prevTrack) playRef.current(prevTrack);
          continue;
        }
        if (command.type === "volume") {
          volumeRef.current = command.volume;
          setVolumeState(command.volume);
          applyMixVolumes();
          publishRef.current({ volume: command.volume });
          continue;
        }
        if (command.type === "shuffle") {
          const next = !shuffleRef.current;
          shuffleRef.current = next;
          setShuffle(next);
          publishRef.current({ shuffle: next, ownerId: tabIdRef.current });
        }
      }
    };

    const tick = async () => {
      if (cancelled) return;
      const device = localDeviceRef.current;
      if (!device.id) return;
      const data = await postConnectSync({ device });
      if (cancelled || !data) return;

      const ownerId = data.state?.ownerId ?? null;
      applyConnectDevices(data.devices ?? [], ownerId);

      const takingOwnership = Boolean(
        data.commands?.some((command) => command.type === "become-owner"),
      );

      if (
        data.state &&
        data.state.ownerId &&
        data.state.ownerId !== device.id &&
        data.state.updatedAt >= lastPushedStateAtRef.current
      ) {
        // Same snapshot — keep extrapolating; don't freeze the timer.
        if (data.state.updatedAt !== lastRemoteUpdatedAtRef.current) {
          lastRemoteUpdatedAtRef.current = data.state.updatedAt;
          applyRemote({
            track: data.state.track ? connectToTrack(data.state.track) : null,
            queue: (data.state.queue ?? []).map(connectToTrack),
            playing: data.state.playing,
            progress: data.state.progress,
            duration: data.state.duration,
            volume: data.state.volume,
            shuffle: data.state.shuffle,
            ownerId: data.state.ownerId,
            updatedAt: data.state.updatedAt,
          });
        }
      } else if (takingOwnership && data.state) {
        // Adopt server position before loading audio — skip applyRemote (clears src).
        lastRemoteUpdatedAtRef.current = data.state.updatedAt;
        if (data.state.track) {
          trackRef.current = connectToTrack(data.state.track);
          setTrack(trackRef.current);
        }
        queueRef.current = (data.state.queue ?? []).map(connectToTrack);
        setQueue(queueRef.current);
        playingRef.current = data.state.playing;
        setPlaying(data.state.playing);
        durationRef.current = data.state.duration;
        setDuration(data.state.duration);
        volumeRef.current = data.state.volume;
        setVolumeState(data.state.volume);
        if (typeof data.state.shuffle === "boolean") {
          shuffleRef.current = data.state.shuffle;
          setShuffle(data.state.shuffle);
        }
        remoteEpochRef.current = {
          progress: data.state.progress,
          at: data.state.updatedAt || Date.now(),
          playing: data.state.playing,
          trackId: data.state.track?.id ?? null,
        };
        const display = data.state.playing
          ? data.state.progress +
            Math.max(0, (Date.now() - (data.state.updatedAt || Date.now())) / 1000)
          : data.state.progress;
        progressRef.current = display;
        setProgress(display);
        followingRemoteRef.current = false;
        setIsRemotePlayback(false);
      } else if (!data.state?.ownerId || data.state.ownerId === device.id) {
        followingRemoteRef.current = false;
        setIsRemotePlayback(false);
      }

      if (data.commands?.length) {
        runCommands(data.commands);
      }
    };

    sendConnectCommandRef.current = (command) => {
      const device = localDeviceRef.current;
      void postConnectSync({ device, command }).then((data) => {
        if (!data || cancelled) return;
        applyConnectDevices(data.devices ?? [], data.state?.ownerId ?? null);
        if (
          data.state &&
          data.state.ownerId &&
          data.state.ownerId !== device.id &&
          data.state.updatedAt !== lastRemoteUpdatedAtRef.current
        ) {
          lastRemoteUpdatedAtRef.current = data.state.updatedAt;
          applyRemote({
            track: data.state.track ? connectToTrack(data.state.track) : null,
            queue: (data.state.queue ?? []).map(connectToTrack),
            playing: data.state.playing,
            progress: data.state.progress,
            duration: data.state.duration,
            volume: data.state.volume,
            shuffle: data.state.shuffle,
            ownerId: data.state.ownerId,
            updatedAt: data.state.updatedAt,
          });
        }
        if (data.commands?.length) runCommands(data.commands);
      });
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 1600);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [applyConnectDevices, applyMixVolumes, applyRemote, pauseBoth, playBoth]);

  // Smooth Connect follower scrubber between ~1.5s owner heartbeats.
  useEffect(() => {
    if (!isRemotePlayback) return;
    const id = window.setInterval(() => {
      const epoch = remoteEpochRef.current;
      if (!epoch?.playing) return;
      let next = epoch.progress + Math.max(0, (Date.now() - epoch.at) / 1000);
      if (durationRef.current > 0) next = Math.min(durationRef.current, next);
      progressRef.current = next;
      setProgress(next);
    }, 250);
    return () => window.clearInterval(id);
  }, [isRemotePlayback, playing, track?.id]);

  const flushListenCredit = useCallback(() => {
    if (!isOwner()) return;
    const audio = audioRef.current;
    const t = trackRef.current;
    if (!audio || !t) return;
    const anchor = listenAnchorRef.current;
    if (!anchor || anchor.trackId !== t.id) return;
    const delta = Math.max(
      0,
      Math.min(3600, Math.floor(audio.currentTime - anchor.at)),
    );
    if (delta <= 0) return;
    listenAnchorRef.current = { trackId: t.id, at: audio.currentTime };
    postListenCredit(delta, t);
  }, [isOwner]);

  useEffect(() => {
    if (!track || !isOwner()) {
      listenAnchorRef.current = null;
      return;
    }

    if (!playing) {
      flushListenCredit();
      listenAnchorRef.current = null;
      return;
    }

    listenAnchorRef.current = {
      trackId: track.id,
      at: audioRef.current?.currentTime ?? progressRef.current ?? 0,
    };

    const tickMs = LISTEN_HEARTBEAT_SECONDS * 1000;
    const id = window.setInterval(() => {
      flushListenCredit();
    }, tickMs);
    return () => {
      window.clearInterval(id);
      flushListenCredit();
      listenAnchorRef.current = null;
    };
  }, [playing, track, isOwner, flushListenCredit]);

  // Discord Rich Presence (desktop IPC only).
  useEffect(() => {
    const onInvalidate = () => setPresenceRev((n) => n + 1);
    window.addEventListener(PRESENCE_INVALIDATE_EVENT, onInvalidate);
    return () => {
      window.removeEventListener(PRESENCE_INVALIDATE_EVENT, onInvalidate);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    cancelDiscordPresenceClear();

    const pushPresence = async () => {
      try {
        if (
          discordPresenceCache.at === 0 ||
          Date.now() - discordPresenceCache.at > 60_000
        ) {
          const res = await fetch("/api/account", { cache: "no-store" });
          if (!res.ok) return;
          const data = await res.json();
          discordPresenceCache = {
            at: Date.now(),
            presenceOn: Boolean(data.discord?.presenceEnabled),
            appId:
              typeof data.discordClientId === "string" &&
              data.discordClientId.trim()
                ? data.discordClientId.trim()
                : null,
          };
        }
        if (cancelled) return;
        if (
          !discordPresenceCache.presenceOn ||
          !discordPresenceCache.appId
        ) {
          const { clearDiscordActivity } = await import("@/lib/discord-rpc");
          if (!cancelled) await clearDiscordActivity();
          return;
        }

        const { setDiscordListeningActivity, clearDiscordActivity } =
          await import("@/lib/discord-rpc");
        if (cancelled) return;
        // Keep presence on the current track even while paused / between
        // song advances (`playing` briefly goes false on ended).
        if (!track) {
          presenceClockRef.current = null;
          await clearDiscordActivity();
          return;
        }

        const durationSec =
          durationRef.current ||
          (typeof track.duration === "number" ? track.duration : 0) ||
          0;
        let clock = presenceClockRef.current;
        if (!clock || clock.trackId !== track.id) {
          const progressSec =
            audioRef.current?.currentTime ?? progressRef.current ?? 0;
          const now = Math.floor(Date.now() / 1000);
          clock = {
            trackId: track.id,
            startUnix: now - Math.max(0, Math.floor(progressSec)),
            durationSec: durationSec > 0 ? durationSec : 0,
          };
          presenceClockRef.current = clock;
        } else if (durationSec > 0 && clock.durationSec <= 0) {
          clock = { ...clock, durationSec };
          presenceClockRef.current = clock;
        }

        const now = Math.floor(Date.now() / 1000);
        const result = await setDiscordListeningActivity(
          discordPresenceCache.appId,
          {
            title: track.title,
            artist: track.artist,
            album: track.album,
            coverUrl: track.coverPath,
            progressSec: Math.max(0, now - clock.startUnix),
            durationSec: clock.durationSec,
          },
        );
        if (!result.ok && process.env.NODE_ENV === "development") {
          console.warn("[discord-presence]", result.error);
        }
      } catch (e) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[discord-presence]", e);
        }
      }
    };

    void pushPresence();

    // The remote webview and native IPC bridge become ready independently.
    // Retry promptly during startup instead of making Discord wait for the
    // regular heartbeat after an early bridge or client race.
    const startupRetries = track
      ? [
          window.setTimeout(() => void pushPresence(), 1_500),
          window.setTimeout(() => void pushPresence(), 6_000),
        ]
      : [];

    const interval = track
      ? window.setInterval(() => {
          void pushPresence();
        }, 45_000)
      : 0;

    return () => {
      cancelled = true;
      startupRetries.forEach((timer) => window.clearTimeout(timer));
      if (interval) window.clearInterval(interval);
    };
  }, [
    track?.id,
    track?.title,
    track?.artist,
    track?.album,
    track?.coverPath,
    duration,
    presenceRev,
  ]);

  // Clear presence when the player unmounts — delayed so React remounts
  // (Strict Mode / shell swap) don't flicker Discord off.
  useEffect(() => {
    cancelDiscordPresenceClear();
    return () => {
      discordPresenceClearTimer = window.setTimeout(() => {
        discordPresenceClearTimer = null;
        void import("@/lib/discord-rpc")
          .then(({ clearDiscordActivity }) => clearDiscordActivity())
          .catch(() => null);
      }, 800);
    };
  }, []);

  // Recently played / listening feed are driven by /api/listen after qualify threshold.

  const play = useCallback(
    (next: PlayerTrack, nextQueue?: PlayerTrack[]) => {
      if (followingRemoteRef.current) {
        sendConnectCommandRef.current({
          id: newCommandId(),
          type: "play-track",
          track: trackToConnect(next),
          queue: nextQueue?.map(trackToConnect),
        });
        applyingRemoteRef.current = true;
        trackRef.current = next;
        setTrack(next);
        if (nextQueue) {
          queueRef.current = nextQueue;
          setQueue(nextQueue);
        }
        playingRef.current = true;
        setPlaying(true);
        setProgress(0);
        progressRef.current = 0;
        queueMicrotask(() => {
          applyingRemoteRef.current = false;
        });
        return;
      }
      const gen = ++playGenRef.current;
      pushRecentPlayedTrack({
        id: next.id,
        title: next.title,
        artist: next.resolveArtist || primaryArtistName(next.artist) || next.artist,
        album: next.album,
        coverPath: next.coverPath,
        quality: next.quality ?? undefined,
        localTrackId:
          next.quality === "local" &&
          !next.id.startsWith("stream:") &&
          !next.id.startsWith("live:")
            ? next.id
            : undefined,
        onPolarr: next.quality === "local",
      });
      // Library tracks: set src + play() in this tick (no /api/live wait).
      if (!isEphemeralTrack(next)) {
        const ready =
          next.streamUrl && /\/api\/live\//i.test(next.streamUrl)
            ? { ...next, streamUrl: null, quality: "local" as const }
            : { ...next, quality: next.quality ?? ("local" as const) };
        let queue = nextQueue?.map(withExplicit);
        if (queue) fallbackQueueRef.current = null;
        claimAndPlay(ready, queue, gen);
        return;
      }
      void (async () => {
        const fromId = next.id;
        const ready = await resolveIfNeeded(next);
        if (gen !== playGenRef.current) return;
        if (isEphemeralTrack(ready) && !ready.streamUrl) return;
        let queue = nextQueue?.map(withExplicit);
        if (queue) {
          // Album / playlist / shelf play — clear add-to-queue restore snapshot
          fallbackQueueRef.current = null;
          queue = replaceInQueue(queue, fromId, ready);
        } else if (fromId !== ready.id) {
          queue = replaceInQueue(queueRef.current, fromId, ready);
        }
        claimAndPlay(ready, queue, gen);
      })();
    },
    [claimAndPlay],
  );
  playRef.current = play;

  const toggle = useCallback(() => {
    if (followingRemoteRef.current) {
      const shouldPause = playingRef.current;
      sendConnectCommandRef.current({
        id: newCommandId(),
        type: shouldPause ? "pause" : "play",
      });
      playingRef.current = !shouldPause;
      setPlaying(!shouldPause);
      return;
    }
    const audio = audioRef.current;
    if (!audio || !track) return;

    // Remote followers are handled above. For the local owner, the media
    // element is authoritative: restored/cross-tab state can say "playing"
    // even when the browser has paused or rejected the element.
    const shouldPause = !audio.paused;
    ownerIdRef.current = tabIdRef.current;

    if (shouldPause) {
      pauseBoth();
      playingRef.current = false;
      setPlaying(false);
      publish({
        playing: false,
        progress: audio.currentTime,
        ownerId: tabIdRef.current,
      });
      return;
    }

    const resumeAt = audio.currentTime || progressRef.current || 0;

    void (async () => {
      const gen = ++playGenRef.current;
      const currentGen = () => gen === playGenRef.current;

      let ready = track;
      if (isEphemeralTrack(track)) {
        const fromId = track.id;
        ready = await resolveIfNeeded({ ...track, streamUrl: null });
        if (!currentGen()) return;
        if (
          trackRef.current?.id !== fromId &&
          trackRef.current?.id !== ready.id
        ) {
          return;
        }
        const nextQ = replaceInQueue(queueRef.current, fromId, ready);
        queueRef.current = nextQ;
        setQueue(nextQ);
        trackRef.current = ready;
        setTrack(ready);
      }

      if (!currentGen()) return;
      const nextSrc = audioSrcFor(ready);
      const alreadyReady =
        Boolean(audio.src) &&
        sameStreamUrl(audio.src, nextSrc) &&
        !audio.error &&
        audioLooksPlayable(audio);

      if (!alreadyReady) {
        if (isNativeClient() && !window.__POLARR_NATIVE_CLIENT__?.mediaTicket) {
          await ensureNativeMediaTicket().catch(() => null);
          if (!currentGen()) return;
        }
        setAudioSrc(audio, audioSrcFor(ready));
        const seekTo = () => {
          try {
            if (Number.isFinite(resumeAt) && resumeAt > 0) {
              audio.currentTime = resumeAt;
            }
          } catch {
            /* ignore */
          }
        };
        seekTo();
        audio.addEventListener("loadedmetadata", seekTo, { once: true });
      } else if (
        Number.isFinite(resumeAt) &&
        resumeAt > 0.5 &&
        Math.abs(audio.currentTime - resumeAt) > 1.25
      ) {
        try {
          audio.currentTime = resumeAt;
        } catch {
          /* ignore */
        }
      }

      let ok = await playBoth();
      if (!ok && currentGen()) {
        const buffered = await waitForCanPlay(audio, currentGen, 8_000);
        if (buffered && currentGen()) ok = await playBoth();
      }
      if (!ok && isEphemeralTrack(ready) && currentGen()) {
        // Stale media / autoplay — one more live refresh then retry
        const fromId = ready.id;
        const refreshed = await resolveIfNeeded(
          {
            ...ready,
            streamUrl: null,
          },
          { force: true },
        );
        if (!currentGen()) return;
        const nextQ = replaceInQueue(queueRef.current, fromId, refreshed);
        queueRef.current = nextQ;
        setQueue(nextQ);
        trackRef.current = refreshed;
        setTrack(refreshed);
        setAudioSrc(audio, audioSrcFor(refreshed), true);
        try {
          if (resumeAt > 0) audio.currentTime = resumeAt;
        } catch {
          /* ignore */
        }
        ok = await playBoth();
        if (!ok && currentGen()) {
          await waitForCanPlay(audio, currentGen, 8_000);
          if (!currentGen()) return;
          ok = await playBoth();
        }
        ready = refreshed;
      }
      if (!ok || !currentGen()) return;
      playingRef.current = true;
      setPlaying(true);
      publish({
        track: ready,
        queue: queueRef.current,
        playing: true,
        progress: audio.currentTime || resumeAt,
        ownerId: tabIdRef.current,
      });
    })();
  }, [pauseBoth, playBoth, publish, track]);

  const seek = useCallback(
    (ratio: number) => {
      const audio = audioRef.current;
      const total = finiteDuration(
        duration,
        audio?.duration,
        trackRef.current?.duration,
        durationRef.current,
      );
      if (!total) return;
      const next = Math.max(0, Math.min(1, ratio)) * total;
      if (followingRemoteRef.current) {
        sendConnectCommandRef.current({
          id: newCommandId(),
          type: "seek",
          progress: next,
        });
        setProgress(next);
        progressRef.current = next;
        return;
      }
      if (!audio) return;
      const wasPlaying = playingRef.current;
      ownerIdRef.current = tabIdRef.current;
      // Never reload the stream on scrub — ticket/query churn looks like a
      // new URL and was restarting tracks from 0 on every seek.
      if (track && (!audio.src || audio.error)) {
        setAudioSrc(audio, audioSrcFor(track), Boolean(audio.error));
      }
      try {
        audio.currentTime = next;
      } catch {
        /* not seekable yet */
      }
      const inst = instAudioRef.current;
      if (inst && instReadyRef.current && inst.src) {
        try {
          inst.currentTime = next;
        } catch {
          /* ignore */
        }
      }
      setProgress(next);
      progressRef.current = next;
      if (total > 0 && durationRef.current !== total) {
        durationRef.current = total;
        setDuration(total);
      }
      setPresenceRev((n) => n + 1);
      if (wasPlaying && audio.paused) {
        void playBoth().then((ok) => {
          if (!ok) return;
          playingRef.current = true;
          setPlaying(true);
          publish({
            progress: next,
            playing: true,
            ownerId: tabIdRef.current,
          });
        });
        return;
      }
      publish({
        progress: next,
        ownerId: tabIdRef.current,
      });
    },
    [duration, playBoth, publish, track],
  );

  const setVolume = useCallback(
    (v: number) => {
      const next = Math.max(0, Math.min(1, v));
      setVolumeState(next);
      volumeRef.current = next;
      if (usesSystemVolume()) {
        // Keep element gain full; hardware/Control Center owns loudness.
        if (audioRef.current) audioRef.current.volume = 1;
        if (instAudioRef.current) {
          /* mix volumes still apply relative karaoke gains against ref */
        }
        applyMixVolumes();
        void writeSystemVolume(next);
      } else {
        applyMixVolumes();
      }
      if (followingRemoteRef.current) {
        sendConnectCommandRef.current({
          id: newCommandId(),
          type: "volume",
          volume: next,
        });
        return;
      }
      if (isOwner()) publish({ volume: next });
    },
    [applyMixVolumes, isOwner, publish],
  );

  const loadInstrumental = useCallback(
    async (trackId: string, streamUrl: string, gen: number) => {
      const inst = instAudioRef.current;
      const mix = audioRef.current;
      if (!inst || !mix) return;
      if (gen !== karaokeGenRef.current) return;

      // Never leave the mix muted while we load
      instReadyRef.current = false;
      applyMixVolumes();

      // A prior failed attempt leaves the element errored with the same src;
      // setAudioSrc would no-op and every retry would time out. Hard-reset.
      if (inst.error) {
        inst.removeAttribute("src");
        try {
          inst.load();
        } catch {
          /* ignore */
        }
      }
      setAudioSrc(inst, streamUrl);
      const ready = await waitForCanPlay(
        inst,
        () =>
          gen === karaokeGenRef.current && trackRef.current?.id === trackId,
        20_000,
      );
      if (gen !== karaokeGenRef.current) return;
      if (!ready || trackRef.current?.id !== trackId) {
        // Aborted / superseded prep — don't flash Unavailable for slider noise
        if (inst.error && inst.error.code !== 1) {
          const codes: Record<number, string> = {
            2: "network error",
            3: "decode error",
            4: "format not supported",
          };
          const detail = codes[inst.error.code] || null;
          setKaraokeStatus("error");
          setKaraokeError(
            detail
              ? `Instrumental failed to load (${detail}) — slide again to retry`
              : "Instrumental failed to load — slide again to retry",
          );
        }
        return;
      }
      if (!audioLooksPlayable(inst)) {
        setKaraokeStatus("error");
        setKaraokeError("Instrumental has no playable audio");
        return;
      }

      try {
        inst.currentTime = mix.currentTime;
      } catch {
        /* ignore */
      }

      instReadyRef.current = true;

      applyMixVolumes();
      setKaraokeStatus("ready");
      setKaraokeError(null);

      // play() here is often outside a user gesture (Demucs finished later).
      // Keep the stem loaded; the next slider/play click starts the bus.
      if (vocalLevelRef.current < 0.999 && playingRef.current && !mix.paused) {
        await ensureInstPlaying();
        applyMixVolumes();
      }
    },
    [applyMixVolumes, ensureInstPlaying],
  );

  const prepareKaraoke = useCallback(
    (trackId: string, artist: string, title: string, album?: string) => {
      const gen = ++karaokeGenRef.current;
      let cancelled = false;
      let timer: number | undefined;

      const poll = async () => {
        if (cancelled || gen !== karaokeGenRef.current) return;
        try {
          const res = await fetch(
            `/api/karaoke/${encodeURIComponent(trackId)}`,
            {
              method: "POST",
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ artist, title, album }),
            },
          );
          const data = (await res.json()) as {
            status?: KaraokeUiStatus;
            progress?: number;
            error?: string;
            streamUrl?: string;
          };
          if (cancelled || gen !== karaokeGenRef.current) return;
          if (trackRef.current?.id !== trackId) return;
          if (!isKaraokeEligible(trackRef.current)) return;
          const status = data.status ?? "error";
          setKaraokeStatus(status);
          setKaraokeProgress(data.progress ?? 0);
          setKaraokeError(data.error ?? null);

          if (status === "ready" && data.streamUrl) {
            await loadInstrumental(trackId, data.streamUrl, gen);
            return;
          }
          if (status === "processing" || status === "queued") {
            // Keep original mix full while demucs runs
            instReadyRef.current = false;
            applyMixVolumes();
            timer = window.setTimeout(poll, 1500);
            return;
          }
          // unavailable / error / idle — allow a later slider retry
          karaokePrepActiveRef.current = false;
          instReadyRef.current = false;
          applyMixVolumes();
        } catch {
          if (cancelled || gen !== karaokeGenRef.current) return;
          karaokePrepActiveRef.current = false;
          setKaraokeStatus("error");
          setKaraokeError("Could not prepare instrumental");
          instReadyRef.current = false;
          applyMixVolumes();
        }
      };

      void poll();
      return () => {
        cancelled = true;
        if (timer) window.clearTimeout(timer);
      };
    },
    [applyMixVolumes, loadInstrumental],
  );

  const setVocalLevel = useCallback(
    (v: number) => {
      if (!isKaraokeEligible(trackRef.current)) {
        vocalLevelRef.current = 1;
        setVocalLevelState(1);
        applyMixVolumes();
        return;
      }
      const next = Math.max(0, Math.min(1, v));
      setVocalLevelState(next);
      vocalLevelRef.current = next;

      // Failed prep: retry from the slider without thrashing every tick.
      const st = karaokeStatusRef.current;
      if (
        next < 0.999 &&
        !instReadyRef.current &&
        !karaokePrepActiveRef.current &&
        (st === "error" || st === "unavailable")
      ) {
        const t = trackRef.current;
        setKaraokeStatus("idle");
        setKaraokeError(null);
        if (t && isKaraokeEligible(t)) {
          karaokePrepActiveRef.current = true;
          prepareKaraoke(
            t.id,
            t.artist,
            t.title,
            t.album || undefined,
          );
        }
      }

      if (next < 0.999 && instReadyRef.current) {
        void ensureInstPlaying().then((ok) => {
          if (!ok) {
            applyMixVolumes();
            return;
          }
          applyMixVolumes();
        });
        return;
      }
      applyMixVolumes();
    },
    [applyMixVolumes, ensureInstPlaying, prepareKaraoke],
  );

  // Safety: if mix was faded but inst stalled, restore original
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const mix = audioRef.current;
      const inst = instAudioRef.current;
      if (!mix || vocalLevelRef.current >= 0.999) return;
      if (!instReadyRef.current) {
        if (mix.volume < volumeRef.current * 0.5) {
          mix.volume = volumeRef.current;
        }
        return;
      }
      if (inst && (inst.paused || inst.error) && mix.volume < volumeRef.current * 0.2) {
        mix.volume = volumeRef.current;
        if (inst) inst.volume = 0;
      }
    }, 800);
    return () => window.clearInterval(id);
  }, [playing]);

  const singingActive = vocalLevel < 0.999;

  // Demucs instrumental — start once when sing mode engages for a library track.
  // Do not restart on every slider tick (that aborted loads → Unavailable).
  useEffect(() => {
    if (!track?.id || !isKaraokeEligible(track) || !singingActive) {
      if (!singingActive) karaokePrepActiveRef.current = false;
      return;
    }
    if (instReadyRef.current || karaokePrepActiveRef.current) return;

    karaokePrepActiveRef.current = true;
    const stop = prepareKaraoke(
      track.id,
      track.artist,
      track.title,
      track.album || undefined,
    );
    return () => {
      stop();
      karaokePrepActiveRef.current = false;
      karaokeGenRef.current += 1;
    };
  }, [
    track?.id,
    singingActive,
    prepareKaraoke,
  ]);

  // Skip / play a stream while karaoke is open — dump the mix, don't yt-dlp
  useEffect(() => {
    if (!track) return;
    if (isKaraokeEligible(track)) return;

    karaokeGenRef.current += 1;
    karaokePrepActiveRef.current = false;
    vocalLevelRef.current = 1;
    setVocalLevelState(1);
    instReadyRef.current = false;
    const inst = instAudioRef.current;
    if (inst) {
      inst.pause();
      inst.removeAttribute("src");
      try {
        inst.load();
      } catch {
        /* ignore */
      }
    }
    setKaraokeStatus("idle");
    setKaraokeProgress(0);
    setKaraokeError(null);
    applyMixVolumes();
  }, [track?.id, track?.quality, track?.streamUrl, applyMixVolumes]);

  const toggleShuffle = useCallback(() => {
    if (followingRemoteRef.current) {
      sendConnectCommandRef.current({ id: newCommandId(), type: "shuffle" });
      setShuffle((prev) => {
        const next = !prev;
        shuffleRef.current = next;
        return next;
      });
      return;
    }
    setShuffle((prev) => {
      const next = !prev;
      shuffleRef.current = next;
      ownerIdRef.current = tabIdRef.current;
      publish({ shuffle: next, ownerId: tabIdRef.current });
      return next;
    });
  }, [publish]);

  const next = useCallback(() => {
    if (!track) return;
    if (followingRemoteRef.current) {
      sendConnectCommandRef.current({ id: newCommandId(), type: "next" });
      return;
    }
    void (async () => {
      const current = track;
      const n = await advanceTargetRef.current(current);
      if (n) play(n);
    })();
  }, [play, track]);

  const prev = useCallback(() => {
    if (!track) return;
    if (followingRemoteRef.current) {
      sendConnectCommandRef.current({ id: newCommandId(), type: "prev" });
      return;
    }
    const audio = audioRef.current;
    ownerIdRef.current = tabIdRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setProgress(0);
      publish({ progress: 0, ownerId: tabIdRef.current });
      return;
    }
    const idx = queue.findIndex((t) => t.id === track.id);
    const p = queue[idx - 1];
    if (p) play(p);
  }, [play, publish, queue, track]);

  // Lock screen / Dynamic Island / Control Center Now Playing.
  useEffect(() => {
    bindMediaSessionActions({
      play: () => {
        if (!playingRef.current) toggle();
      },
      pause: () => {
        if (playingRef.current) toggle();
      },
      next,
      prev,
      seekTo: (seconds) => {
        const dur = durationRef.current;
        if (dur > 0) seek(seconds / dur);
        else {
          const audio = audioRef.current;
          if (!audio) return;
          audio.currentTime = Math.max(0, seconds);
          progressRef.current = audio.currentTime;
          setProgress(audio.currentTime);
        }
      },
      getPosition: () =>
        audioRef.current?.currentTime ?? progressRef.current ?? 0,
      getDuration: () => durationRef.current || 0,
    });
  }, [next, prev, seek, toggle]);

  useEffect(() => {
    if (!track || isRemotePlayback) {
      if (!track) void updateMediaSessionMetadata(null);
      setMediaSessionPlaybackState("none");
      return;
    }
    void updateMediaSessionMetadata({
      title: track.title,
      artist:
        track.resolveArtist || primaryArtistName(track.artist) || track.artist,
      album: track.album,
      coverPath: track.coverPath,
    });
  }, [
    track?.id,
    track?.title,
    track?.artist,
    track?.album,
    track?.coverPath,
    track?.resolveArtist,
    isRemotePlayback,
  ]);

  useEffect(() => {
    if (!track || isRemotePlayback) return;
    const onTicket = () => {
      const audio = audioRef.current;
      if (audio && isOwner()) restampAudioTicket(audio);
      void updateMediaSessionMetadata({
        title: track.title,
        artist:
          track.resolveArtist || primaryArtistName(track.artist) || track.artist,
        album: track.album,
        coverPath: track.coverPath,
      });
    };
    window.addEventListener(MEDIA_TICKET_UPDATED_EVENT, onTicket);
    return () => window.removeEventListener(MEDIA_TICKET_UPDATED_EVENT, onTicket);
  }, [track, isRemotePlayback, isOwner]);

  useEffect(() => {
    if (!usesSystemVolume()) return;
    let cancelled = false;
    void readSystemVolume().then((v) => {
      if (cancelled || v == null) return;
      volumeRef.current = v;
      setVolumeState(v);
      if (audioRef.current) audioRef.current.volume = 1;
      applyMixVolumes();
    });
    const unsub = subscribeSystemVolume((v) => {
      volumeRef.current = v;
      setVolumeState(v);
      if (audioRef.current) audioRef.current.volume = 1;
      applyMixVolumes();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [applyMixVolumes]);

  useEffect(() => {
    if (!track || isRemotePlayback) {
      setMediaSessionPlaybackState("none");
      return;
    }
    setMediaSessionPlaybackState(playing ? "playing" : "paused");
  }, [playing, track, isRemotePlayback]);

  useEffect(() => {
    if (!track || isRemotePlayback) return;
    setMediaSessionPositionState(progress, duration, playing ? 1 : 1);
  }, [progress, duration, playing, track, isRemotePlayback]);

  /**
   * Add / drop onto queue: wipe album upcoming on first add (keep now-playing),
   * then append further adds. Snapshot original queue for restore when empty.
   */
  const addToQueue = useCallback(
    (item: PlayerTrack) => {
      const normalized = withExplicit(item);
      const current = trackRef.current;
      const prevQ = queueRef.current;
      const inReplaceSession = fallbackQueueRef.current != null;

      let nextQ: PlayerTrack[];
      if (!inReplaceSession) {
        if (prevQ.length > 0) fallbackQueueRef.current = prevQ.slice();
        if (current) {
          nextQ =
            current.id === normalized.id
              ? [current]
              : [current, normalized];
        } else {
          nextQ = [normalized];
        }
      } else {
        const base =
          prevQ.length > 0
            ? prevQ
            : current
              ? [current]
              : [];
        nextQ = base.some((t) => t.id === normalized.id)
          ? base
          : [...base, normalized];
      }

      queueRef.current = nextQ;
      setQueue(nextQ);
      ownerIdRef.current = tabIdRef.current;
      publish({ queue: nextQ, ownerId: tabIdRef.current });

      if (!current) {
        claimAndPlay(normalized, nextQ);
      }
    },
    [claimAndPlay, publish],
  );

  const removeFromQueue = useCallback(
    (trackId: string) => {
      setQueue((prev) => {
        const currentIdx = track
          ? prev.findIndex((t) => t.id === track.id)
          : -1;
        const removeIdx = prev.findIndex(
          (t, i) => i > currentIdx && t.id === trackId,
        );
        if (removeIdx < 0) return prev;
        const nextQ = prev.filter((_, i) => i !== removeIdx);
        queueRef.current = nextQ;
        ownerIdRef.current = tabIdRef.current;
        publish({ queue: nextQ, ownerId: tabIdRef.current });
        return nextQ;
      });
    },
    [publish, track],
  );

  const playQueueIndex = useCallback(
    (index: number) => {
      const item = queue[index];
      if (item) play(item);
    },
    [play, queue],
  );

  const patchTrackCovers = useCallback(
    (covers: Record<string, string>) => {
      const entries = Object.entries(covers).filter(([, url]) => Boolean(url));
      if (entries.length === 0) return;
      const map = new Map(entries);

      setQueue((prev) => {
        let changed = false;
        const nextQ = prev.map((t) => {
          const url = map.get(t.id);
          if (!url) return t;
          if (t.coverPath) return t;
          changed = true;
          return { ...t, coverPath: url };
        });
        if (!changed) return prev;
        queueRef.current = nextQ;
        return nextQ;
      });

      setTrack((prev) => {
        if (!prev) return prev;
        const url = map.get(prev.id);
        if (!url) return prev;
        if (prev.coverPath) return prev;
        return { ...prev, coverPath: url };
      });
    },
    [],
  );

  const isPanelOpen = useCallback(
    (id: PlayerPanelId) => openPanels[id],
    [openPanels],
  );

  const closePanel = useCallback((id: PlayerPanelId) => {
    setOpenPanels((prev) => ({ ...prev, [id]: false }));
  }, [setOpenPanels]);

  const setPanel = useCallback((next: PlayerPanel) => {
    if (next === "none") {
      setOpenPanels((prev) => ({
        ...prev,
        lyrics: false,
        devices: false,
        nowPlaying: false,
      }));
      return;
    }
    if (next === "queue") {
      setOpenPanels((prev) => ({ ...prev, queue: true }));
      return;
    }
    setOpenPanels((prev) => ({ ...prev, [next]: true }));
  }, [setOpenPanels]);

  const togglePanel = useCallback((next: PlayerPanelId) => {
    setOpenPanels((prev) => ({ ...prev, [next]: !prev[next] }));
  }, [setOpenPanels]);

  const openQueue = useCallback((tab?: QueueTab) => {
    if (tab) setQueueTab(tab);
    setOpenPanels((prev) => ({ ...prev, queue: true }));
  }, [setOpenPanels]);

  const transferPlayback = useCallback((deviceId: string) => {
    const self = localDeviceRef.current;
    if (!deviceId) return;
    // Selecting the device that already owns playback is informational only.
    // Re-sending a transfer reapplies remote state and can replace the queue.
    if (activeConnectDevice?.id === deviceId) return;

    const audio = audioRef.current;
    const wasFollowing = followingRemoteRef.current;
    const epoch = remoteEpochRef.current;
    let resumeAt = progressRef.current;
    if (!wasFollowing && audio) {
      resumeAt = audio.currentTime || progressRef.current;
    } else if (epoch?.playing) {
      resumeAt = epoch.progress + Math.max(0, (Date.now() - epoch.at) / 1000);
    } else if (epoch && Number.isFinite(epoch.progress)) {
      resumeAt = epoch.progress;
    }
    if (durationRef.current > 0) {
      resumeAt = Math.min(durationRef.current, Math.max(0, resumeAt));
    }
    progressRef.current = resumeAt;
    setProgress(resumeAt);

    // Owner flushes exact position in the same request as transfer.
    if (!wasFollowing && trackRef.current && self.id) {
      lastPushedStateAtRef.current = Date.now();
      void postConnectSync({
        device: self,
        state: {
          track: trackToConnect(trackRef.current),
          queue: queueRef.current.map(trackToConnect),
          playing: playingRef.current,
          progress: resumeAt,
          duration: durationRef.current,
          volume: volumeRef.current,
          shuffle: shuffleRef.current,
        },
        command: {
          id: newCommandId(),
          type: "transfer",
          targetId: deviceId,
        },
      }).then((data) => {
        if (!data) return;
        applyConnectDevices(data.devices ?? [], data.state?.ownerId ?? null);
        if (data.commands?.length) {
          // Local command runner lives in the connect effect; nudge via sync tick.
        }
      });
    } else {
      sendConnectCommandRef.current({
        id: newCommandId(),
        type: "transfer",
        targetId: deviceId,
      });
    }

    if (deviceId === self.id) {
      followingRemoteRef.current = false;
      setIsRemotePlayback(false);
      ownerIdRef.current = tabIdRef.current;
      const current = trackRef.current;
      if (current && audio) {
        remoteEpochRef.current = null;
        setAudioSrc(audio, audioSrcFor(current));
        const disarm = armResumeSeek(audio, resumeAt);
        const shouldPlay = playingRef.current;
        const trackId = current.id;
        void (async () => {
          await waitForCanPlay(
            audio,
            () => trackRef.current?.id === trackId,
            10_000,
          );
          seekAudioTo(audio, resumeAt);
          if (shouldPlay && trackRef.current?.id === trackId) {
            await playBoth();
            seekAudioTo(audio, resumeAt);
          }
          window.setTimeout(disarm, 2_500);
        })();
        publish({
          ownerId: tabIdRef.current,
          playing: shouldPlay,
          progress: resumeAt,
        });
      }
      applyConnectDevices(connectDevices.map((d) => ({
        id: d.id,
        name: d.name,
        kind: d.kind,
        lastSeen: Date.now(),
      })), self.id);
    } else {
      followingRemoteRef.current = true;
      setIsRemotePlayback(true);
      remoteEpochRef.current = {
        progress: resumeAt,
        at: Date.now(),
        playing: playingRef.current,
        trackId: trackRef.current?.id ?? null,
      };
      applyRemote({
        track: trackRef.current,
        queue: queueRef.current,
        playing: playingRef.current,
        progress: resumeAt,
        duration: durationRef.current,
        volume: volumeRef.current,
        shuffle: shuffleRef.current,
        ownerId: deviceId,
        updatedAt: Date.now(),
      });
      applyConnectDevices(
        connectDevices.map((d) => ({
          id: d.id,
          name: d.name,
          kind: d.kind,
          lastSeen: Date.now(),
        })),
        deviceId,
      );
    }
  }, [activeConnectDevice?.id, applyConnectDevices, applyRemote, connectDevices, playBoth, publish]);

  const panel: PlayerPanel = openPanels.nowPlaying
    ? "nowPlaying"
    : openPanels.lyrics
      ? "lyrics"
      : openPanels.queue
        ? "queue"
        : openPanels.devices
          ? "devices"
          : "none";

  const karaokeEligible = isKaraokeEligible(track);

  const value = useMemo(
    () => ({
      track,
      queue,
      playing,
      progress,
      duration,
      volume,
      vocalLevel,
      karaokeStatus,
      karaokeProgress,
      karaokeError,
      karaokeEligible,
      shuffle,
      panel,
      isPanelOpen,
      play,
      toggle,
      seek,
      next,
      prev,
      setVolume,
      setVocalLevel,
      toggleShuffle,
      addToQueue,
      removeFromQueue,
      playQueueIndex,
      patchTrackCovers,
      setPanel,
      closePanel,
      togglePanel,
      queueTab,
      setQueueTab,
      openQueue,
      progressLabel: `${formatDuration(progress)} / ${formatDuration(duration)}`,
      connectDevices,
      activeConnectDevice,
      isRemotePlayback,
      transferPlayback,
    }),
    [
      track,
      queue,
      playing,
      progress,
      duration,
      volume,
      vocalLevel,
      karaokeStatus,
      karaokeProgress,
      karaokeError,
      karaokeEligible,
      shuffle,
      panel,
      isPanelOpen,
      play,
      toggle,
      seek,
      next,
      prev,
      setVolume,
      setVocalLevel,
      toggleShuffle,
      addToQueue,
      removeFromQueue,
      playQueueIndex,
      patchTrackCovers,
      setPanel,
      closePanel,
      togglePanel,
      queueTab,
      openQueue,
      connectDevices,
      activeConnectDevice,
      isRemotePlayback,
      transferPlayback,
    ],
  );

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}
