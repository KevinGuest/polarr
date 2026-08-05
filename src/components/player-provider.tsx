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
import { formatDuration, titleLooksExplicit } from "@/lib/utils";
import { emitListenCredited } from "@/lib/ui-events";

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
};

function withExplicit(track: PlayerTrack): PlayerTrack {
  if (track.explicit) return track;
  return titleLooksExplicit(track.title)
    ? { ...track, explicit: true }
    : track;
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
  /** True when any overlay is open (legacy convenience). */
  panel: PlayerPanel;
  isPanelOpen: (id: PlayerPanelId) => boolean;
  play: (track: PlayerTrack, queue?: PlayerTrack[]) => void;
  toggle: () => void;
  seek: (ratio: number) => void;
  next: () => void;
  prev: () => void;
  setVolume: (v: number) => void;
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

/** Resolve stream/catalog tracks to a playable URL (library or live). */
async function resolveIfNeeded(track: PlayerTrack): Promise<PlayerTrack> {
  if (track.streamUrl) return track;
  if (!track.id.startsWith("stream:") && !track.id.startsWith("catalog:")) {
    return track;
  }
  try {
    const res = await fetch("/api/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: track.title,
        artist: track.artist,
        album: track.album,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) return track;
    return {
      ...track,
      id: data.track?.id || track.id,
      title: data.track?.title || track.title,
      artist: data.track?.artist || track.artist,
      album: data.track?.album || track.album,
      coverPath: data.track?.coverPath || track.coverPath,
      streamUrl: data.streamUrl || data.track?.streamUrl || null,
    };
  } catch {
    return track;
  }
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
  const queueRef = useRef<PlayerTrack[]>([]);
  const trackRef = useRef<PlayerTrack | null>(null);
  const playingRef = useRef(false);
  const progressRef = useRef(0);
  const durationRef = useRef(0);
  const volumeRef = useRef(0.8);
  const ownerIdRef = useRef<string | null>(null);
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

  const claimAndPlay = useCallback(
    (raw: PlayerTrack, nextQueue?: PlayerTrack[]) => {
      const audio = audioRef.current;
      if (!audio) return;
      const next = withExplicit(raw);
      const queue = nextQueue?.map(withExplicit);
      ownerIdRef.current = tabIdRef.current;
      if (queue) {
        queueRef.current = queue;
        setQueue(queue);
      }
      trackRef.current = next;
      setTrack(next);
      setProgress(0);
      progressRef.current = 0;
      audio.src = audioSrcFor(next);
      void audio.play().then(() => {
        playingRef.current = true;
        setPlaying(true);
        publish({
          track: next,
          queue: queueRef.current,
          playing: true,
          progress: 0,
          ownerId: tabIdRef.current,
        });
      });
    },
    [publish],
  );

  const applyRemote = useCallback((payload: SyncPayload) => {
    if (payload.ownerId === tabIdRef.current) return;
    applyingRemoteRef.current = true;
    ownerIdRef.current = payload.ownerId;

    const audio = audioRef.current;
    if (audio && !audio.paused) audio.pause();

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
    if (audio) audio.volume = payload.volume;

    // Followers mirror UI only — never play local audio while another tab owns it.
    if (audio && payload.track) {
      const nextSrc = audioSrcFor(payload.track);
      const abs = new URL(nextSrc, window.location.origin).href;
      if (audio.src !== abs) {
        audio.src = nextSrc;
      }
      if (Number.isFinite(payload.progress)) {
        try {
          audio.currentTime = payload.progress;
        } catch {
          /* not seekable yet */
        }
      }
    }

    writeStored(payload);
    queueMicrotask(() => {
      applyingRemoteRef.current = false;
    });
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audio.volume = volumeRef.current;
    audioRef.current = audio;

    const onTime = () => {
      if (!isOwner()) return;
      setProgress(audio.currentTime);
      progressRef.current = audio.currentTime;
    };
    const onMeta = () => {
      if (!isOwner()) return;
      setDuration(audio.duration || 0);
      durationRef.current = audio.duration || 0;
    };
    const onEnded = () => {
      if (!isOwner()) return;
      setPlaying(false);
      playingRef.current = false;
      const current = trackRef.current;
      if (!current) {
        publishRef.current({ playing: false });
        return;
      }
      const q = queueRef.current;
      const idx = q.findIndex((t) => t.id === current.id);
      const nextTrack = q[idx + 1];
      if (!nextTrack) {
        publishRef.current({ playing: false, progress: audio.currentTime });
        return;
      }
      void (async () => {
        const fromId = nextTrack.id;
        const ready = await resolveIfNeeded(nextTrack);
        if (trackRef.current?.id !== current.id) return; // user skipped meanwhile
        const nextQ = replaceInQueue(queueRef.current, fromId, ready);
        queueRef.current = nextQ;
        setQueue(nextQ);
        audio.src = audioSrcFor(ready);
        setProgress(0);
        progressRef.current = 0;
        trackRef.current = ready;
        setTrack(ready);
        void audio.play().then(() => {
          playingRef.current = true;
          setPlaying(true);
          publishRef.current({
            track: ready,
            queue: nextQ,
            playing: true,
            progress: 0,
            ownerId: tabIdRef.current,
          });
        });
      })();
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnded);

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
      ownerIdRef.current = stored.ownerId;
      queueRef.current = stored.queue ?? [];
      trackRef.current = stored.track;
      // Don't auto-resume audio in a new tab (autoplay + dual playback).
      playingRef.current = false;
      progressRef.current = stored.progress ?? 0;
      durationRef.current = stored.duration ?? 0;
      volumeRef.current = stored.volume ?? 0.8;
      setQueue(stored.queue ?? []);
      setTrack(stored.track);
      setPlaying(false);
      setProgress(stored.progress ?? 0);
      setDuration(stored.duration ?? 0);
      setVolumeState(stored.volume ?? 0.8);
      audio.volume = stored.volume ?? 0.8;
      audio.src = audioSrcFor(stored.track);
      try {
        audio.currentTime = stored.progress ?? 0;
      } catch {
        /* ignore */
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
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnded);
      channel?.close();
      channelRef.current = null;
    };
  }, [applyRemote, isOwner]);

  useEffect(() => {
    if (!playing || !track || !isOwner()) return;
    const tickSec = 15;
    const trackId = track.id.startsWith("live:") ? undefined : track.id;
    const id = window.setInterval(() => {
      void fetch("/api/listen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seconds: tickSec,
          ...(trackId ? { trackId } : {}),
        }),
        keepalive: true,
      })
        .then((res) => {
          if (res.ok && trackId) emitListenCredited({ trackId });
        })
        .catch(() => null);
    }, tickSec * 1000);
    return () => window.clearInterval(id);
  }, [playing, track?.id, isOwner]);

  // Recently played / listening feed are driven by /api/listen after ≥15s.

  const play = useCallback(
    (next: PlayerTrack, nextQueue?: PlayerTrack[]) => {
      void (async () => {
        const fromId = next.id;
        const ready = await resolveIfNeeded(next);
        let queue = nextQueue?.map(withExplicit);
        if (queue) {
          queue = replaceInQueue(queue, fromId, ready);
        } else if (fromId !== ready.id) {
          queue = replaceInQueue(queueRef.current, fromId, ready);
        }
        claimAndPlay(ready, queue);
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
      audio.pause();
      playingRef.current = false;
      setPlaying(false);
      publish({
        playing: false,
        progress: audio.currentTime,
        ownerId: tabIdRef.current,
      });
      return;
    }

    const needLoad =
      !audio.src ||
      audio.src !==
        new URL(audioSrcFor(track), window.location.origin).href;
    if (needLoad) audio.src = audioSrcFor(track);
    void audio.play().then(() => {
      playingRef.current = true;
      setPlaying(true);
      publish({
        playing: true,
        progress: audio.currentTime,
        ownerId: tabIdRef.current,
      });
    });
  }, [publish, track]);

  const seek = useCallback(
    (ratio: number) => {
      const audio = audioRef.current;
      if (!audio || !duration) return;
      const wasPlaying = playingRef.current;
      ownerIdRef.current = tabIdRef.current;
      const next = Math.max(0, Math.min(1, ratio)) * duration;
      if (track && (!audio.src || audio.src !== new URL(audioSrcFor(track), window.location.origin).href)) {
        audio.src = audioSrcFor(track);
      }
      audio.currentTime = next;
      setProgress(next);
      progressRef.current = next;
      if (wasPlaying && audio.paused) {
        void audio.play().then(() => {
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
    [duration, publish, track],
  );

  const setVolume = useCallback(
    (v: number) => {
      const next = Math.max(0, Math.min(1, v));
      setVolumeState(next);
      volumeRef.current = next;
      if (audioRef.current) audioRef.current.volume = next;
      if (isOwner()) publish({ volume: next });
    },
    [isOwner, publish],
  );

  const next = useCallback(() => {
    if (!track) return;
    const idx = queue.findIndex((t) => t.id === track.id);
    const n = queue[idx + 1];
    if (n) play(n);
  }, [play, queue, track]);

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

  const addToQueue = useCallback(
    (item: PlayerTrack) => {
      const normalized = withExplicit(item);
      setQueue((prev) => {
        let nextQ: PlayerTrack[];
        if (!track) nextQ = [...prev, normalized];
        else {
          const idx = prev.findIndex((t) => t.id === track.id);
          if (idx < 0) nextQ = [...prev, normalized];
          else {
            nextQ = [...prev];
            nextQ.splice(idx + 1, 0, normalized);
          }
        }
        queueRef.current = nextQ;
        publish({ queue: nextQ, ownerId: tabIdRef.current });
        return nextQ;
      });
      ownerIdRef.current = tabIdRef.current;
    },
    [publish, track],
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
      panel,
      isPanelOpen,
      play,
      toggle,
      seek,
      next,
      prev,
      setVolume,
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
      panel,
      isPanelOpen,
      play,
      toggle,
      seek,
      next,
      prev,
      setVolume,
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
