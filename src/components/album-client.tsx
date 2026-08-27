"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  CirclePlus,
  Clock,
  Pause,
  Play,
  Shuffle,
} from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { ExplicitBadge } from "@/components/explicit-badge";
import { MobileSaveButton } from "@/components/saved-in-drawer";
import { NowPlayingBars } from "@/components/now-playing-bars";
import { PolarrAvailabilityBadge } from "@/components/stream-quality-badge";
import { TrackActionsDrawer } from "@/components/track-actions-drawer";
import { TrackContextMenu } from "@/components/track-context-menu";
import { TrackRowActions } from "@/components/track-row-actions";
import { TrackRowIndex } from "@/components/track-row-index";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlayer, type PlayerTrack } from "@/components/player-provider";
import {
  isPlayerRowCurrent,
  trackRowEndCell,
  trackRowMidCell,
  trackRowStartCell,
} from "@/lib/player-row";
import { decodeAlbumId } from "@/lib/album-ref";
import { setDragTrack } from "@/lib/drag-track";
import {
  LIBRARY_CHANGED_EVENT,
  LIBRARY_PINS_CHANGED_EVENT,
  emitLibraryPinsChanged,
} from "@/lib/ui-events";
import { cn, formatAlbumLength, formatDuration, formatTrackArtistLine } from "@/lib/utils";
import type { LocalSourceBadge } from "@/lib/track-source-badge";
import { toastError, toastSuccess, toastInfo } from "@/lib/toast";
import {
  PlaylistOfflineDownloadButton,
} from "@/components/playlist-offline-download";
import type { DesktopOfflineTrack } from "@/lib/desktop-offline";
import { useAuthOptional } from "@/components/auth-provider";

function shuffleArray<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

type AlbumTrack = {
  key: string;
  title: string;
  trackNumber: number;
  duration: number;
  available: boolean;
  downloaded: boolean;
  hasFile: boolean;
  localTrackId: string | null;
  streamUrl: string | null;
  explicit?: boolean;
  localSource?: LocalSourceBadge | null;
  artists?: string;
};

type AlbumMeta = {
  title: string;
  artist: string;
  image: string | null;
  artistImage: string | null;
  foreignArtistId: string | null;
  year: number | null;
  foreignAlbumId: string | null;
  lidarrAlbumId: number | null;
};

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Same format as libraryAlbumPinKey in db.ts (client cannot import sqlite). */
function albumLibraryPinKey(artistName: string, albumTitle: string) {
  return `album:${artistName.trim().toLowerCase()}::${albumTitle.trim().toLowerCase()}`;
}

export function AlbumClient({ albumId }: { albumId: string }) {
  const auth = useAuthOptional();
  const { play, toggle, track, queue, playing } = usePlayer();
  const router = useRouter();
  const ref = useMemo(() => decodeAlbumId(albumId), [albumId]);

  const title = ref?.title || "";
  const artist = ref?.artist || "";
  const foreignAlbumId = ref?.foreignAlbumId || "";
  const lidarrAlbumId =
    ref?.lidarrAlbumId != null ? String(ref.lidarrAlbumId) : "";

  const [album, setAlbum] = useState<AlbumMeta | null>(null);
  const [tracks, setTracks] = useState<AlbumTrack[]>([]);
  const [fallbackReady, setFallbackReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [inYourLibrary, setInYourLibrary] = useState(false);

  const load = useCallback(async () => {
    if (!ref) {
      setError("Invalid album link");
      setLoading(false);
      return;
    }
    if (!title && !artist && !foreignAlbumId && !lidarrAlbumId) {
      setError("Missing album or artist");
      setLoading(false);
      return;
    }
    const qs = new URLSearchParams();
    if (title) qs.set("title", title);
    if (artist) qs.set("artist", artist);
    if (foreignAlbumId) qs.set("foreignAlbumId", foreignAlbumId);
    if (lidarrAlbumId) qs.set("lidarrAlbumId", lidarrAlbumId);

    const res = await fetch(`/api/album?${qs.toString()}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to load album");
      setLoading(false);
      return;
    }
    setAlbum(data.album);
    setTracks(data.tracks || []);
    setFallbackReady(Boolean(data.fallbackReady));
    setError(data.error || null);
    setLoading(false);
  }, [ref, title, artist, foreignAlbumId, lidarrAlbumId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    const onLibraryChanged = (event: Event) => {
      const trackId = (event as CustomEvent<{ trackId?: string }>).detail
        ?.trackId;
      if (!trackId) {
        void load();
        return;
      }
      setTracks((prev) =>
        prev.map((t) =>
          t.localTrackId === trackId
            ? {
                ...t,
                available: false,
                downloaded: false,
                hasFile: false,
                localTrackId: null,
                streamUrl: null,
                localSource: null,
              }
            : t,
        ),
      );
    };
    window.addEventListener(LIBRARY_CHANGED_EVENT, onLibraryChanged);
    return () => {
      window.removeEventListener(LIBRARY_CHANGED_EVENT, onLibraryChanged);
    };
  }, [load]);

  const libraryPinKey = useMemo(() => {
    const albumTitle = album?.title || title;
    const albumArtist = album?.artist || artist;
    if (!albumTitle || !albumArtist) return "";
    return albumLibraryPinKey(albumArtist, albumTitle);
  }, [album?.title, album?.artist, title, artist]);

  useEffect(() => {
    if (!libraryPinKey) {
      setInYourLibrary(false);
      return;
    }
    let cancelled = false;
    async function loadPin() {
      try {
        const res = await fetch("/api/library/pins", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const pins = Array.isArray(data?.pins) ? (data.pins as string[]) : [];
        if (!cancelled) setInYourLibrary(pins.includes(libraryPinKey));
      } catch {
        /* ignore */
      }
    }
    void loadPin();
    const onPinsChanged = () => {
      void loadPin();
    };
    window.addEventListener(LIBRARY_PINS_CHANGED_EVENT, onPinsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(LIBRARY_PINS_CHANGED_EVENT, onPinsChanged);
    };
  }, [libraryPinKey]);

  const totalSeconds = useMemo(
    () => tracks.reduce((s, t) => s + (t.duration || 0), 0),
    [tracks],
  );

  function artistsFor(t: AlbumTrack): string {
    return formatTrackArtistLine(album?.artist || artist, t.title, t.artists);
  }

  const albumQueue: PlayerTrack[] = useMemo(
    () =>
      tracks.map((t) => ({
        id: t.localTrackId || `stream:${t.key}`,
        title: t.title,
        artist: formatTrackArtistLine(
          album?.artist || artist,
          t.title,
          t.artists,
        ),
        resolveArtist: album?.artist || artist,
        album: album?.title || title,
        coverPath: album?.image || null,
        streamUrl: t.streamUrl || null,
        explicit: t.explicit,
        duration: t.duration || undefined,
        quality: t.localTrackId ? "local" : "youtube",
      })),
    [tracks, album, artist, title],
  );

  const offlineTracks: DesktopOfflineTrack[] = useMemo(
    () =>
      tracks
        .filter((t) => Boolean(t.localTrackId))
        .map((t) => ({
          trackId: t.localTrackId!,
          title: t.title,
          artist: artistsFor(t),
          album: album?.title || title,
          coverUrl: album?.image || null,
          duration: t.duration || null,
          userId: auth?.user?.publicId || "",
        })),
    // artistsFor depends on album/artist; keep deps explicit
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracks, album, artist, title, auth?.user?.publicId],
  );

  async function playTrack(track: AlbumTrack) {
    const coverPath = album?.image || null;
    const trackArtists = artistsFor(track);
    if (track.localTrackId) {
      const pt: PlayerTrack = {
        id: track.localTrackId,
        title: track.title,
        artist: trackArtists,
        resolveArtist: album?.artist || artist,
        album: album?.title || title,
        coverPath,
        explicit: track.explicit,
        duration: track.duration || undefined,
        quality: "local",
      };
      play(pt, [pt]);
      return;
    }

    setBusyKey(track.key);

    try {
      // Live first byte now; server may also save a library copy in the background.
      const liveRes = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: track.title,
          artist: album?.artist || artist,
          album: album?.title || title,
          duration: track.duration || undefined,
        }),
      });
      const live = await liveRes.json().catch(() => null);
      if (!liveRes.ok || !live?.track?.id) {
        toastError(
          live?.error ||
            "Couldn’t start stream — try Download if you want it in the library",
        );
        return;
      }
      const pt: PlayerTrack = {
        id: live.track.id,
        title: live.track.title || track.title,
        artist: formatTrackArtistLine(
          live.track.artist || album?.artist || artist,
          live.track.title || track.title,
          track.artists,
        ),
        resolveArtist: album?.artist || artist,
        album: live.track.album || title,
        coverPath,
        streamUrl: live.streamUrl || live.track.streamUrl,
        explicit: track.explicit,
        duration: track.duration || undefined,
        quality: live.mode === "library" ? "local" : "youtube",
      };
      play(pt, [pt]);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Playback failed");
    } finally {
      setBusyKey(null);
    }
  }

  async function markDownloaded(track: AlbumTrack) {
    if (track.localTrackId) {
      setBusyKey(track.key);
      try {
        await fetch(`/api/tracks/${track.localTrackId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId: "web" }),
        });
        setTracks((prev) =>
          prev.map((t) =>
            t.key === track.key ? { ...t, downloaded: true } : t,
          ),
        );
      } finally {
        setBusyKey(null);
      }
      return;
    }

    // Explicit download / library acquire (not live stream)
    if (!fallbackReady) {
      toastError("Download path not ready — check yt-dlp");
      return;
    }
    setBusyKey(track.key);
    try {
      const body = {
        title: track.title,
        artist: album?.artist || artist,
        album: album?.title || title,
        foreignAlbumId: album?.foreignAlbumId || foreignAlbumId || undefined,
        type: "track" as const,
        prefer: "fallback" as const,
      };
      // One create only — polling must not re-POST (that spammed Requests).
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toastError(data.error || "Download failed");
        return;
      }
      if (data.track?.id) {
        toastSuccess("Downloaded");
        void load();
        return;
      }

      const qs = new URLSearchParams();
      if (title) qs.set("title", title);
      if (artist) qs.set("artist", artist);
      if (foreignAlbumId) qs.set("foreignAlbumId", foreignAlbumId);
      if (lidarrAlbumId) qs.set("lidarrAlbumId", lidarrAlbumId);

      for (let i = 0; i < 40; i++) {
        await sleep(1500);
        const poll = await fetch(`/api/album?${qs.toString()}`, {
          cache: "no-store",
        });
        if (!poll.ok) continue;
        const albumData = await poll.json();
        const rows = (albumData.tracks || []) as AlbumTrack[];
        const hit = rows.find(
          (t) =>
            t.key === track.key ||
            (t.title === track.title && (t.localTrackId || t.downloaded)),
        );
        if (hit?.localTrackId || hit?.downloaded || hit?.hasFile) {
          toastSuccess("Downloaded");
          setAlbum(albumData.album);
          setTracks(rows);
          setFallbackReady(Boolean(albumData.fallbackReady));
          return;
        }
      }
      toastInfo("Still downloading — check Requests if needed");
      void load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusyKey(null);
    }
  }

  function playAvailable() {
    const first = albumQueue[0];
    if (!first) {
      const next = tracks[0];
      if (next) void playTrack(next);
      return;
    }
    play(first, albumQueue);
  }

  function rowIsCurrent(t: AlbumTrack): boolean {
    const playerTrack = toPlayerTrack(t);
    return isPlayerRowCurrent(
      track,
      {
        id: playerTrack.id,
        localTrackId: t.localTrackId,
        streamId: `stream:${t.key}`,
        title: t.title,
        artist: album?.artist || artist || playerTrack.artist,
      },
      queue,
    );
  }

  const inThisAlbum = Boolean(track && tracks.some((t) => rowIsCurrent(t)));

  function onPlayClick() {
    if (inThisAlbum) {
      toggle();
      return;
    }
    playAvailable();
  }

  async function toggleYourLibrary() {
    if (!libraryPinKey) return;
    const next = !inYourLibrary;
    setInYourLibrary(next);
    try {
      const res = await fetch("/api/library/pins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemKey: libraryPinKey, pinned: next }),
      });
      if (!res.ok) {
        setInYourLibrary(!next);
        toastError("Couldn’t update Your Library");
        return;
      }
      emitLibraryPinsChanged();
      toastSuccess(
        next ? "Added to Your Library" : "Removed from Your Library",
      );
    } catch {
      setInYourLibrary(!next);
      toastError("Couldn’t update Your Library");
    }
  }

  const [showStickyTitle, setShowStickyTitle] = useState(false);
  const heroSentinelRef = useRef<HTMLDivElement>(null);
  const stickyTitle = album?.title || title;

  useEffect(() => {
    const el = heroSentinelRef.current;
    if (!el || loading) return;
    const obs = new IntersectionObserver(
      ([entry]) => setShowStickyTitle(!entry?.isIntersecting),
      { threshold: 0, rootMargin: "-56px 0px 0px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading, stickyTitle]);

  if (!ref) {
    return (
      <p className="text-sm text-muted-foreground">
        Invalid album link.
      </p>
    );
  }

  // MBID-only refs resolve title/artist from the API
  if (!foreignAlbumId && !lidarrAlbumId && (!title || !artist)) {
    return (
      <p className="text-sm text-muted-foreground">
        Pick an album from Home or Search.
      </p>
    );
  }

  const displayTitle = album?.title || title;
  const displayArtist = album?.artist || artist;
  const coverSeed = displayTitle || foreignAlbumId || "album";
  const coverImage = album?.image || undefined;
  const artistImage = album?.artistImage || undefined;

  function openArtist() {
    if (!displayArtist) return;
    const qs = new URLSearchParams({ name: displayArtist });
    if (album?.foreignArtistId) {
      qs.set("foreignArtistId", album.foreignArtistId);
    }
    if (artistImage) qs.set("image", artistImage);
    router.push(`/artist?${qs.toString()}`);
  }

  function playShuffled() {
    if (!albumQueue.length) {
      playAvailable();
      return;
    }
    const shuffled = shuffleArray(albumQueue);
    play(shuffled[0]!, shuffled);
  }

  function toPlayerTrack(t: AlbumTrack): PlayerTrack {
    const trackArtists = formatTrackArtistLine(
      album?.artist || artist,
      t.title,
      t.artists,
    );
    return {
      id: t.localTrackId || `stream:${t.key}`,
      title: t.title,
      artist: trackArtists,
      resolveArtist: album?.artist || artist,
      album: album?.title || title,
      coverPath: album?.image || null,
      streamUrl: t.streamUrl || null,
      explicit: t.explicit,
      duration: t.duration || undefined,
    };
  }

  const canPlay = !loading && (tracks.length > 0 || fallbackReady);

  return (
    <>
      {/* Mobile — Spotify-style album */}
      <div className="lg:hidden">
        <div
          className={cn(
            "fixed inset-x-0 top-0 z-30 flex items-center gap-2 px-3 pb-2.5 pt-[max(0.5rem,var(--safe-top))] transition-colors duration-200",
            showStickyTitle
              ? "border-b border-border/40 bg-background/75 backdrop-blur-md"
              : "bg-transparent",
          )}
        >
          <button
            type="button"
            onClick={() => router.back()}
            className={cn(
              "rounded-full p-1.5",
              showStickyTitle
                ? "text-foreground"
                : "bg-black/35 text-white backdrop-blur-sm",
            )}
            aria-label="Go back"
          >
            <ChevronLeft className="size-6" />
          </button>
          <h1
            className={cn(
              "min-w-0 flex-1 truncate text-base font-semibold transition-opacity duration-200",
              showStickyTitle ? "opacity-100" : "opacity-0",
            )}
          >
            {displayTitle || "Album"}
          </h1>
        </div>

        {loading && !displayTitle ? (
          <div className="space-y-4 pt-2" aria-busy="true">
            <Skeleton className="mx-auto size-56 rounded-md" />
            <Skeleton className="mx-4 h-8 w-2/3" />
            <Skeleton className="mx-4 h-4 w-1/3" />
          </div>
        ) : (
          <>
            <div className="relative pb-1 pt-[max(3.25rem,calc(var(--safe-top)+2.75rem))]">
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "linear-gradient(180deg, hsl(20 22% 34%) 0%, hsl(20 16% 20%) 55%, hsl(var(--background)) 100%)",
                }}
                aria-hidden
              />
              <div className="relative mx-auto aspect-square w-[calc(100%-3rem)] max-w-[18rem] overflow-hidden rounded-md shadow-2xl">
                <CoverArt
                  seed={coverSeed}
                  image={coverImage}
                  className="size-full"
                />
              </div>
              <div ref={heroSentinelRef} className="relative h-px" aria-hidden />

              <div className="relative space-y-3 px-4 pb-2 pt-4">
              <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight">
                {displayTitle || "Album"}
              </h1>

              {displayArtist ? (
                <button
                  type="button"
                  onClick={() => openArtist()}
                  className="flex min-w-0 items-center gap-2 text-left"
                >
                  <CoverArt
                    seed={displayArtist}
                    image={artistImage}
                    className="size-6 shrink-0 rounded-full"
                  />
                  <span className="truncate text-sm font-semibold">
                    {displayArtist}
                  </span>
                </button>
              ) : null}

              <p className="text-sm text-muted-foreground">
                Album
                {album?.year ? ` · ${album.year}` : ""}
                {tracks.length
                  ? ` · ${tracks.length} song${tracks.length === 1 ? "" : "s"}`
                  : ""}
              </p>

              {error && !tracks.length ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => void toggleYourLibrary()}
                  disabled={!libraryPinKey}
                  className="flex size-10 items-center justify-center text-muted-foreground disabled:opacity-40"
                  aria-label={
                    inYourLibrary
                      ? "Remove from Your Library"
                      : "Add to Your Library"
                  }
                  aria-pressed={inYourLibrary}
                >
                  {inYourLibrary ? (
                    <span className="flex size-7 items-center justify-center rounded-full bg-foreground text-background">
                      <Check className="size-4" strokeWidth={3} />
                    </span>
                  ) : (
                    <CirclePlus className="size-8" strokeWidth={1.5} />
                  )}
                </button>

                <div className="min-w-0 flex-1" />

                <button
                  type="button"
                  onClick={playShuffled}
                  disabled={!canPlay}
                  className="rounded-full p-2 text-muted-foreground hover:text-foreground disabled:opacity-40"
                  aria-label="Shuffle play"
                >
                  <Shuffle className="size-6" />
                </button>
                <button
                  type="button"
                  onClick={onPlayClick}
                  disabled={!canPlay}
                  className="flex size-14 items-center justify-center rounded-full bg-foreground text-background shadow-lg transition-opacity hover:opacity-90 disabled:opacity-40"
                  aria-label={inThisAlbum && playing ? "Pause" : "Play album"}
                >
                  {inThisAlbum && playing ? (
                    <Pause className="size-6" fill="currentColor" />
                  ) : (
                    <Play className="size-6 translate-x-0.5" fill="currentColor" />
                  )}
                </button>
              </div>
            </div>
            </div>

            <section className="pt-2">
              {loading ? (
                <div className="space-y-2 px-4" aria-busy="true">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-md" />
                  ))}
                </div>
              ) : tracks.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No tracklist found for this album yet.
                </p>
              ) : (
                <ul>
                  {tracks.map((t) => {
                    const busy = busyKey === t.key;
                    const playerTrack = toPlayerTrack(t);
                    const isCurrent = rowIsCurrent(t);
                    return (
                      <li key={t.key}>
                        <div className="flex w-full items-center gap-3 px-4 py-2.5">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void playTrack(t)}
                            className="min-w-0 flex-1 text-left disabled:opacity-50"
                          >
                            <div
                              className={cn(
                                "flex min-w-0 items-center gap-2",
                                isCurrent
                                  ? "text-primary"
                                  : t.available
                                    ? "text-foreground"
                                    : "text-foreground/80",
                              )}
                            >
                              {isCurrent ? (
                                <NowPlayingBars playing={playing} />
                              ) : null}
                              <span className="truncate text-[15px] font-medium">
                                {t.title}
                              </span>
                            </div>
                            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                              {t.explicit ? <ExplicitBadge /> : null}
                              <span className="min-w-0 truncate">
                                {playerTrack.artist}
                              </span>
                            </div>
                          </button>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <PolarrAvailabilityBadge available={t.available} />
                            <MobileSaveButton
                              trackId={t.localTrackId || `stream:${t.key}`}
                              artist={album?.artist || artist || playerTrack.artist}
                              title={t.title}
                              album={album?.title || title}
                              coverPath={album?.image || null}
                              duration={t.duration}
                              onPolarr={t.available}
                              alreadyInLibrary={t.available && Boolean(t.localTrackId)}
                              onDownload={
                                t.available
                                  ? undefined
                                  : () => void markDownloaded(t)
                              }
                              size="sm"
                            />
                          </div>
                          <TrackActionsDrawer
                            track={playerTrack}
                            onPolarr={t.available}
                            inLibrary={t.available && Boolean(t.localTrackId)}
                            onDownload={
                              t.available
                                ? undefined
                                : () => void markDownloaded(t)
                            }
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      {/* Desktop — existing layout */}
      <div className="hidden min-h-full flex-col lg:flex">
      <section className="relative -mx-4 -mt-4 border-b border-border px-4 pb-10 pt-8 md:-mx-8 md:px-8 lg:-mx-10 lg:px-10">
        <div
          className="pointer-events-none absolute inset-0 opacity-35"
          style={{
            background:
              "linear-gradient(180deg, hsl(20 18% 22%) 0%, hsl(var(--background)) 100%)",
          }}
          aria-hidden
        />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end">
          <CoverArt
            seed={coverSeed}
            image={coverImage}
            className="size-44 shrink-0 rounded-lg shadow-lg sm:size-52 md:size-56"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Album
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
              {loading && !displayTitle ? "…" : displayTitle || "Album"}
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted-foreground">
              {displayArtist ? (
                <button
                  type="button"
                  onClick={() => openArtist()}
                  className="inline-flex min-w-0 items-center gap-2 rounded-full pr-1 text-left transition-opacity hover:opacity-90"
                >
                  <CoverArt
                    seed={displayArtist}
                    image={artistImage}
                    className="size-7 shrink-0 rounded-full"
                  />
                  <span className="truncate font-semibold text-foreground">
                    {displayArtist}
                  </span>
                </button>
              ) : null}
              {album?.year ? (
                <span className="tabular-nums">· {album.year}</span>
              ) : null}
              {tracks.length ? (
                <span>
                  · {tracks.length} song{tracks.length === 1 ? "" : "s"},{" "}
                  {formatAlbumLength(totalSeconds)}
                </span>
              ) : null}
            </div>
            {error && !tracks.length && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={onPlayClick}
                disabled={loading || (!tracks.length && !fallbackReady)}
                className="flex size-14 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                aria-label={inThisAlbum && playing ? "Pause" : "Play"}
              >
                {inThisAlbum && playing ? (
                  <Pause className="size-6" fill="currentColor" />
                ) : (
                  <Play className="size-6 translate-x-0.5" fill="currentColor" />
                )}
              </button>
              <PlaylistOfflineDownloadButton
                collectionId={`album:${albumId}`}
                tracks={offlineTracks}
              />
              <button
                type="button"
                onClick={() => void toggleYourLibrary()}
                disabled={!libraryPinKey}
                className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                aria-label={
                  inYourLibrary
                    ? "Remove from Your Library"
                    : "Add to Your Library"
                }
                aria-pressed={inYourLibrary}
              >
                {inYourLibrary ? (
                  <span className="flex size-7 items-center justify-center rounded-full bg-foreground text-background">
                    <Check className="size-4" strokeWidth={3} />
                  </span>
                ) : (
                  <CirclePlus className="size-8" strokeWidth={1.5} />
                )}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="pt-6">
        {loading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading tracklist">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                <Skeleton className="size-4 shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/5 max-w-xs" />
                  <Skeleton className="h-3 w-1/4 max-w-[10rem]" />
                </div>
                <Skeleton className="h-4 w-10 shrink-0" />
              </div>
            ))}
          </div>
        ) : tracks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-16 text-center text-muted-foreground">
            <p>No tracklist found for this album yet.</p>
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[480px] border-separate border-spacing-y-1 text-left text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="w-10 pb-3 pl-3 font-medium">#</th>
                  <th className="pb-3 pr-4 font-medium">Title</th>
                  <th className="w-[5.5rem] pb-3 font-medium" aria-label="Actions" />
                  <th className="w-16 pb-3 pr-3 text-right font-medium">
                    <Clock className="ml-auto size-3.5" aria-label="Duration" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {tracks.map((t) => {
                  const busy = busyKey === t.key;
                  const trackArtists = formatTrackArtistLine(
                    album?.artist || artist,
                    t.title,
                    t.artists,
                  );
                  const streamId = `stream:${t.key}`;
                  const playerTrack: PlayerTrack = {
                    id: t.localTrackId || streamId,
                    title: t.title,
                    artist: trackArtists,
                    resolveArtist: album?.artist || artist,
                    album: album?.title || title,
                    coverPath: album?.image || null,
                    streamUrl: t.streamUrl || null,
                    explicit: t.explicit,
                    duration: t.duration || undefined,
                  };
                  const isCurrent = rowIsCurrent(t);
                  const row = (
                    <tr
                      draggable
                      onDragStart={(e) => setDragTrack(e, playerTrack)}
                      className="group/row cursor-grab transition-colors active:cursor-grabbing"
                      onClick={() => void playTrack(t)}
                    >
                      <td
                        className={trackRowStartCell(
                          isCurrent,
                          "py-3 pl-3 tabular-nums text-muted-foreground",
                        )}
                      >
                        <TrackRowIndex
                          n={t.trackNumber}
                          isCurrent={isCurrent}
                          playing={playing}
                          busy={busy}
                        />
                      </td>
                      <td className={trackRowMidCell(isCurrent, "py-3 pr-4")}>
                        <div className="min-w-0">
                          <div
                            className={cn(
                              "truncate font-medium",
                              isCurrent
                                ? "text-primary"
                                : t.available
                                  ? "text-foreground"
                                  : "text-foreground/80",
                            )}
                          >
                            {t.title}
                          </div>
                          <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                            {t.explicit ? <ExplicitBadge /> : null}
                            <span className="min-w-0 truncate">{trackArtists}</span>
                          </div>
                        </div>
                      </td>
                      <td className={trackRowMidCell(isCurrent, "py-3")}>
                        <TrackRowActions
                          trackId={t.localTrackId || `stream:${t.key}`}
                          artist={album?.artist || artist || trackArtists}
                          title={t.title}
                          album={album?.title || title}
                          coverPath={album?.image || null}
                          duration={t.duration}
                          onPolarr={t.available}
                          downloading={busy}
                          onDownload={
                            t.available
                              ? undefined
                              : () => void markDownloaded(t)
                          }
                        />
                      </td>
                      <td
                        className={trackRowEndCell(
                          isCurrent,
                          "py-3 pr-3 text-right tabular-nums text-muted-foreground",
                        )}
                      >
                        {t.duration ? formatDuration(t.duration) : "—"}
                      </td>
                    </tr>
                  );

                  return (
                    <TrackContextMenu
                      key={t.key}
                      track={playerTrack}
                      inLibrary={t.available && Boolean(t.localTrackId)}
                    >
                      {row}
                    </TrackContextMenu>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </div>
    </>
  );
}
