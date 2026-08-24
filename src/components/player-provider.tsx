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
import { primaryArtistName } from "@/lib/track-match";
import { formatDuration, titleLooksExplicit } from "@/lib/utils";
import { emitListenCredited } from "@/lib/ui-events";

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

/** Call after Settings toggles Discord presence so the player picks it up. */
export function invalidateDiscordPresenceCache() {
  discordPresenceCache.at = 0;
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

export type PlayerPanelId = "lyrics" | "devices" | "nowPlaying" | "queue";

export type QueueTab = "queue" | "recent";

/** @deprecated Use PlayerPanelId; "none" means close all via setPanel. */
export type PlayerPanel = PlayerPanelId | "none";

type OpenPanels = Record<PlayerPanelId, boolean>;

const CLOSED_PANELS: OpenPanels = {
  lyrics: false,
  devices: false,
  nowPlaying: false,
  queue: true, // permanent rail — never closable
};

const DEFAULT_PANELS: OpenPanels = {
  ...CLOSED_PANELS,
};

function withQueuePinned(panels: OpenPanels): OpenPanels {
  return panels.queue ? panels : { ...panels, queue: true };
}

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
  /** Open a panel without closing others; pass "none" to close all. */
  setPanel: (panel: PlayerPanel) => void;
  closePanel: (id: PlayerPanelId) => void;
  togglePanel: (panel: PlayerPanelId) => void;
  queueTab: QueueTab;
  setQueueTab: (tab: QueueTab) => void;
  /** Open the queue rail, optionally on a specific tab. */
  openQueue: (tab?: QueueTab) => void;
  progressLabel: string;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

const PLAYER_CHANNEL = "polarr-player";
const PLAYER_STORAGE_KEY = "polarr-player-v1";

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

function audioSrcFor(track: PlayerTrack): string {
  if (track.streamUrl) return track.streamUrl;
  return `/api/stream/${track.id}`;
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

/** Apply a new media URL; no-op if the element already has it. */
function setAudioSrc(audio: HTMLAudioElement, src: string) {
  const abs = new URL(src, window.location.origin).href;
  if (audio.src === abs) return false;
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
function isEphemeralTrack(track: PlayerTrack): boolean {
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
 * resolve so restricted accounts still get the rewrite.
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

  // Fresh live URL from search/album — skip a second /api/live round-trip
  if (
    ephemeral &&
    !force &&
    track.streamUrl &&
    /\/api\/live\//i.test(track.streamUrl)
  ) {
    return track;
  }

  try {
    const resolveArtist =
      (track.resolveArtist || "").trim() ||
      primaryArtistName(track.artist) ||
      track.artist;
    const res = await fetch("/api/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: track.title,
        artist: resolveArtist,
        album: track.album,
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
    // Library OK path: only rewrite when server forces rickroll (or ephemeral)
    if (
      !ephemeral &&
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
    if (data.savingToLibrary) {
      try {
        const { toastSavingToLibrary } = await import("@/lib/toast");
        toastSavingToLibrary(
          data.track?.artist || track.artist,
          data.track?.title || track.title,
        );
      } catch {
        /* ignore */
      }
    }
    if (!ephemeral && !data.rickroll) {
      return track;
    }
    const liveUrl = data.streamUrl || data.track?.streamUrl || null;
    const mode = data.mode === "library" ? "local" : "youtube";
    return {
      ...track,
      id: data.track?.id || track.id,
      title: data.track?.title || track.title,
      artist: data.track?.artist || track.artist,
      album: data.track?.album || track.album,
      coverPath: data.track?.coverPath || track.coverPath,
      streamUrl: liveUrl,
      quality: mode,
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
        artist:
          (track.resolveArtist || "").trim() ||
          primaryArtistName(track.artist) ||
          track.artist,
        album: track.album,
        duration: track.duration || undefined,
      }),
      credentials: "same-origin",
    }).catch(() => {
      /* ignore */
    });
    return;
  }

  const src = audioSrcFor(track);
  if (!src.startsWith("/api/stream/")) return;
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
  /** Demucs instrumental bus (full-quality stereo stem). */
  const instAudioRef = useRef<HTMLAudioElement | null>(null);
  const instReadyRef = useRef(false);
  const queueRef = useRef<PlayerTrack[]>([]);
  /** Queue snapshot before first “add/drop replaces upcoming” — restored if liked empty. */
  const fallbackQueueRef = useRef<PlayerTrack[] | null>(null);
  const trackRef = useRef<PlayerTrack | null>(null);
  const playingRef = useRef(false);
  const progressRef = useRef(0);
  const durationRef = useRef(0);
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
  const applyingRemoteRef = useRef(false);
  const publishRef = useRef<(partial?: Partial<SyncPayload>) => void>(() => {});

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
  const [shuffle, setShuffle] = useState(false);
  const [openPanels, setOpenPanelsState] = useState<OpenPanels>(DEFAULT_PANELS);
  const setOpenPanels = useCallback(
    (update: OpenPanels | ((prev: OpenPanels) => OpenPanels)) => {
      setOpenPanelsState((prev) => {
        const next = typeof update === "function" ? update(prev) : update;
        return withQueuePinned(next);
      });
    },
    [],
  );
  const [queueTab, setQueueTab] = useState<QueueTab>("queue");
  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);

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
    const vol = volumeRef.current;
    const level = vocalLevelRef.current;

    // Full original while stem isn't confirmed playing
    const instUsable =
      instReadyRef.current &&
      audioLooksPlayable(inst) &&
      // When user wants any instrumental mix, require inst to be running
      (level > 0.995 || (!inst!.paused && !inst!.ended));

    if (!instUsable) {
      mix.volume = vol;
      if (inst) inst.volume = 0;
      return;
    }

    const theta = (1 - level) * 0.5 * Math.PI;
    mix.volume = vol * Math.cos(theta);
    inst!.volume = vol * Math.sin(theta);
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

  const playBoth = useCallback(async () => {
    const mix = audioRef.current;
    if (!mix) return false;
    const ok = await safePlay(mix);
    if (ok && instReadyRef.current && vocalLevelRef.current < 0.999) {
      const instOk = await ensureInstPlaying();
      if (!instOk) {
        // Keep listening to original at full volume
        instReadyRef.current = false;
      }
    }
    applyMixVolumes();
    return ok;
  }, [applyMixVolumes, ensureInstPlaying]);

  const pauseBoth = useCallback(() => {
    audioRef.current?.pause();
    instAudioRef.current?.pause();
  }, []);

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
  }, []);

  publishRef.current = publish;

  const resolveAdvanceTarget = useCallback(
    async (current: PlayerTrack): Promise<PlayerTrack | null> => {
      const q = queueRef.current;
      const idx = q.findIndex((t) => t.id === current.id);
      const queued = idx >= 0 ? q[idx + 1] : undefined;
      if (queued) return queued;

      // Empty upcoming — Liked Songs only when shuffle is on
      if (!shuffleRef.current) {
        return null;
      }

      const liked = await fetchLikedPlayerTracks();
      const rest = shuffleTracks(liked.filter((t) => t.id !== current.id));
      if (rest.length > 0) {
        const nextQ = [current, ...rest];
        queueRef.current = nextQ;
        setQueue(nextQ);
        publishRef.current({
          queue: nextQ,
          ownerId: tabIdRef.current,
        });
        return rest[0]!;
      }

      // No likes — restore pre-replace queue, then stop
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

  const claimAndPlay = useCallback(
    (raw: PlayerTrack, nextQueue?: PlayerTrack[], gen?: number) => {
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

      const src = audioSrcFor(next);
      setAudioSrc(audio, src);
      applyMixVolumes();

      void (async () => {
        const current = () => playGen === playGenRef.current;
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
    [applyMixVolumes, playBoth, publish],
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
    progressRef.current = payload.progress;
    durationRef.current = payload.duration;
    volumeRef.current = payload.volume;

    setQueue(payload.queue);
    setTrack(payload.track);
    setPlaying(payload.playing);
    setProgress(payload.progress);
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
    };
    const onMeta = () => {
      const audio = audioRef.current;
      if (!audio || !isOwner()) return;
      setDuration(audio.duration || 0);
      durationRef.current = audio.duration || 0;
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
        setAudioSrc(el, audioSrcFor(ready));
        setProgress(0);
        progressRef.current = 0;
        trackRef.current = ready;
        setTrack(ready);
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

    /** 410 Gone / stale live URL / ban rewrite — re-mint session and continue. */
    let liveRecovering = false;
    const onMediaError = () => {
      const audio = audioRef.current;
      if (!audio || !isOwner() || liveRecovering) return;
      const current = trackRef.current;
      if (!current) return;
      liveRecovering = true;
      const resumeAt = audio.currentTime || progressRef.current || 0;
      const wantPlay = playingRef.current || !audio.paused;
      void (async () => {
        try {
          const fromId = current.id;
          const ready = await resolveIfNeeded(
            {
              ...current,
              streamUrl: null,
            },
            { force: true },
          );
          if (trackRef.current?.id !== fromId && trackRef.current?.id !== ready.id) {
            return;
          }
          // Nothing usable changed (missing file / ban) — don't loop
          if (audioSrcFor(ready) === audioSrcFor(current) && ready.id === fromId) {
            return;
          }
          if (!ready.streamUrl && isEphemeralTrack(ready)) return;
          const nextQ = replaceInQueue(queueRef.current, fromId, ready);
          queueRef.current = nextQ;
          setQueue(nextQ);
          trackRef.current = ready;
          setTrack(ready);
          const el = audioRef.current;
          if (!el) return;
          setAudioSrc(el, audioSrcFor(ready));
          const seekTo = () => {
            try {
              if (resumeAt > 0) el.currentTime = resumeAt;
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
          publishRef.current({
            track: ready,
            queue: nextQ,
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
    audio.volume = volumeRef.current;
    audioRef.current = audio;
    const inst = new Audio();
    inst.volume = 0;
    inst.preload = "auto";
    instAudioRef.current = inst;
    instReadyRef.current = false;
    attach(audio);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(PLAYER_CHANNEL);
      channelRef.current = channel;
      channel.onmessage = (ev: MessageEvent<SyncMsg>) => {
        const msg = ev.data;
        if (!msg || typeof msg !== "object") return;
        if (msg.kind === "hello") {
          if (msg.tabId === tabIdRef.current) return;
          if (isOwner() && (trackRef.current || queueRef.current.length)) {
            publishRef.current();
          }
          return;
        }
        if (msg.kind === "sync") {
          if (msg.payload.ownerId === tabIdRef.current) return;
          applyRemote(msg.payload);
        }
      };
    } catch {
      channel = null;
    }

    const stored = readStored();
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
      volumeRef.current = stored.volume ?? 0.8;
      const storedShuffle = Boolean(stored.shuffle);
      shuffleRef.current = storedShuffle;
      setQueue(stored.queue ?? []);
      setTrack(stored.track);
      setPlaying(uiPlaying);
      setProgress(stored.progress ?? 0);
      setDuration(stored.duration ?? 0);
      setVolumeState(stored.volume ?? 0.8);
      setShuffle(storedShuffle);
      audio.volume = stored.volume ?? 0.8;

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
        // Only prime local audio when no other tab is already playing.
        if (!remoteOwner) {
          audio.src = audioSrcFor(ready);
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
    }

    channel?.postMessage({
      kind: "hello",
      tabId: tabIdRef.current,
    } satisfies SyncMsg);

    const onStorage = (e: StorageEvent) => {
      if (e.key !== PLAYER_STORAGE_KEY || !e.newValue) return;
      try {
        const payload = JSON.parse(e.newValue) as SyncPayload;
        if (payload.ownerId === tabIdRef.current) return;
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
      channel?.close();
      channelRef.current = null;
    };
  }, [applyRemote, isOwner]);

  useEffect(() => {
    if (!playing || !track || !isOwner()) return;
    const tickSec = 15;
    const id = window.setInterval(() => {
      void fetch("/api/listen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seconds: tickSec,
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
    }, tickSec * 1000);
    return () => window.clearInterval(id);
  }, [playing, track, isOwner]);

  // Discord Rich Presence (local Discord desktop RPC) when user enabled it.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
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
        if (
          cancelled ||
          !discordPresenceCache.presenceOn ||
          !discordPresenceCache.appId
        ) {
          return;
        }

        const { setDiscordListeningActivity, clearDiscordActivity } =
          await import("@/lib/discord-rpc");
        if (cancelled) return;
        if (playing && track) {
          await setDiscordListeningActivity(discordPresenceCache.appId, {
            title: track.title,
            artist: track.artist,
            album: track.album,
            coverUrl: track.coverPath,
          });
        } else {
          await clearDiscordActivity();
        }
      } catch {
        /* Discord desktop may be closed */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [playing, track]);

  // Recently played / listening feed are driven by /api/listen after ≥15s.

  const play = useCallback(
    (next: PlayerTrack, nextQueue?: PlayerTrack[]) => {
      const gen = ++playGenRef.current;
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

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !track) return;

    // Use synced `playing` (not audio.paused) so a follower tab that shows
    // “playing elsewhere” pauses the session instead of starting a 2nd stream.
    const shouldPause = playingRef.current;
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
        setAudioSrc(audio, audioSrcFor(refreshed));
        seekTo();
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
      if (!audio || !duration) return;
      const wasPlaying = playingRef.current;
      ownerIdRef.current = tabIdRef.current;
      const next = Math.max(0, Math.min(1, ratio)) * duration;
      if (track && (!audio.src || audio.src !== new URL(audioSrcFor(track), window.location.origin).href)) {
        setAudioSrc(audio, audioSrcFor(track));
      }
      audio.currentTime = next;
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
      applyMixVolumes();
      if (isOwner()) publish({ volume: next });
    },
    [applyMixVolumes, isOwner, publish],
  );

  const loadInstrumental = useCallback(
    async (trackId: string, streamUrl: string) => {
      const inst = instAudioRef.current;
      const mix = audioRef.current;
      if (!inst || !mix) return;

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
        () => trackRef.current?.id === trackId,
        20_000,
      );
      if (!ready || trackRef.current?.id !== trackId) {
        const codes: Record<number, string> = {
          1: "load aborted",
          2: "network error",
          3: "decode error",
          4: "format not supported",
        };
        const detail = inst.error ? codes[inst.error.code] : null;
        setKaraokeStatus("error");
        setKaraokeError(
          detail
            ? `Instrumental failed to load (${detail}) — slide again to retry`
            : "Instrumental failed to load — slide again to retry",
        );
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

      // If user already wants instrumental, start bus before fading
      if (vocalLevelRef.current < 0.999 && playingRef.current && !mix.paused) {
        const ok = await ensureInstPlaying();
        if (!ok) {
          instReadyRef.current = false;
          applyMixVolumes();
          setKaraokeStatus("error");
          setKaraokeError("Browser blocked instrumental playback — press play again");
          return;
        }
      }

      applyMixVolumes();
      setKaraokeStatus("ready");
      setKaraokeError(null);
    },
    [applyMixVolumes, ensureInstPlaying],
  );

  const prepareKaraoke = useCallback(
    (trackId: string, artist: string, title: string, album?: string) => {
      let cancelled = false;
      let timer: number | undefined;

      const poll = async () => {
        if (cancelled) return;
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
          if (cancelled || trackRef.current?.id !== trackId) return;
          const status = data.status ?? "error";
          setKaraokeStatus(status);
          setKaraokeProgress(data.progress ?? 0);
          setKaraokeError(data.error ?? null);

          if (status === "ready" && data.streamUrl) {
            await loadInstrumental(trackId, data.streamUrl);
            return;
          }
          if (status === "processing" || status === "queued") {
            // Keep original mix full while demucs runs
            instReadyRef.current = false;
            applyMixVolumes();
            timer = window.setTimeout(poll, 1500);
            return;
          }
          instReadyRef.current = false;
          applyMixVolumes();
        } catch {
          if (cancelled) return;
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
      const next = Math.max(0, Math.min(1, v));
      setVocalLevelState(next);
      vocalLevelRef.current = next;

      // Slider gesture is a good moment to start the second audio element
      if (next < 0.999 && instReadyRef.current) {
        void ensureInstPlaying().then((ok) => {
          if (!ok) {
            // Don't mute original
            applyMixVolumes();
            return;
          }
          applyMixVolumes();
        });
        return;
      }
      applyMixVolumes();
    },
    [applyMixVolumes, ensureInstPlaying],
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

  // Demucs instrumental for library + live/stream (download then separate)
  useEffect(() => {
    if (!track?.id) return;
    if (vocalLevel >= 0.999) return;
    if (instReadyRef.current) return;
    return prepareKaraoke(
      track.id,
      track.artist,
      track.title,
      track.album || undefined,
    );
  }, [
    track?.id,
    track?.artist,
    track?.title,
    track?.album,
    vocalLevel,
    prepareKaraoke,
  ]);

  const toggleShuffle = useCallback(() => {
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
    void (async () => {
      const current = track;
      const n = await advanceTargetRef.current(current);
      if (n) play(n);
    })();
  }, [play, track]);

  const prev = useCallback(() => {
    if (!track) return;
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

  const isPanelOpen = useCallback(
    (id: PlayerPanelId) => (id === "queue" ? true : openPanels[id]),
    [openPanels],
  );

  const closePanel = useCallback((id: PlayerPanelId) => {
    if (id === "queue") return;
    setOpenPanels((prev) => ({ ...prev, [id]: false }));
  }, [setOpenPanels]);

  const setPanel = useCallback((next: PlayerPanel) => {
    if (next === "none") {
      setOpenPanels(CLOSED_PANELS);
      return;
    }
    if (next === "queue") {
      setOpenPanels((prev) => ({ ...prev, queue: true }));
      return;
    }
    setOpenPanels((prev) => ({ ...prev, [next]: true }));
  }, [setOpenPanels]);

  const togglePanel = useCallback((next: PlayerPanelId) => {
    if (next === "queue") return;
    setOpenPanels((prev) => ({ ...prev, [next]: !prev[next] }));
  }, [setOpenPanels]);

  const openQueue = useCallback((tab?: QueueTab) => {
    if (tab) setQueueTab(tab);
  }, []);

  const panel: PlayerPanel = openPanels.nowPlaying
    ? "nowPlaying"
    : openPanels.lyrics
      ? "lyrics"
      : openPanels.queue
        ? "queue"
        : openPanels.devices
          ? "devices"
          : "none";

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
      setPanel,
      closePanel,
      togglePanel,
      queueTab,
      setQueueTab,
      openQueue,
      progressLabel: `${formatDuration(progress)} / ${formatDuration(duration)}`,
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
      setPanel,
      closePanel,
      togglePanel,
      queueTab,
      openQueue,
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
