"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Loader2, Play } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { ExplicitBadge } from "@/components/explicit-badge";
import { TrackContextMenu } from "@/components/track-context-menu";
import { TrackRowActions } from "@/components/track-row-actions";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlayer, type PlayerTrack } from "@/components/player-provider";
import { decodeAlbumId } from "@/lib/album-ref";
import { setDragTrack } from "@/lib/drag-track";
import {
  LIBRARY_CHANGED_EVENT,
  emitLibraryChanged,
} from "@/lib/ui-events";
import { cn, formatAlbumLength, formatDuration, formatTrackArtistLine } from "@/lib/utils";
import { toast } from "sonner";

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
  artists?: string;
};

type AlbumMeta = {
  title: string;
  artist: string;
  image: string | null;
  year: number | null;
  foreignAlbumId: string | null;
  lidarrAlbumId: number | null;
};

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export function AlbumClient({ albumId }: { albumId: string }) {
  const { play } = usePlayer();
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
  const [msg, setMsg] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

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
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setIsAdmin(Boolean(data.user?.isAdmin));
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        album: album?.title || title,
        coverPath: album?.image || null,
        streamUrl: t.streamUrl || null,
        explicit: t.explicit,
      })),
    [tracks, album, artist, title],
  );

  function queueWithCurrent(current: PlayerTrack): PlayerTrack[] {
    return albumQueue.map((t) =>
      t.id === current.id ||
      (t.id.startsWith("stream:") &&
        t.title === current.title &&
        t.artist === current.artist)
        ? current
        : t,
    );
  }

  async function acquireAndPlay(track: AlbumTrack) {
    const coverPath = album?.image || null;
    const trackArtists = artistsFor(track);
    if (track.localTrackId) {
      const pt: PlayerTrack = {
        id: track.localTrackId,
        title: track.title,
        artist: trackArtists,
        album: album?.title || title,
        coverPath,
        explicit: track.explicit,
      };
      play(pt, queueWithCurrent(pt));
      return;
    }

    if (!fallbackReady) {
      setMsg("Acquire path not ready — check yt-dlp / Admin Lidarr settings");
      return;
    }

    setBusyKey(track.key);
    setMsg(null);

    try {
      // Prefer live remote stream (no download); download is a separate control
      const liveRes = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: track.title,
          artist: album?.artist || artist,
          album: album?.title || title,
        }),
      });
      const live = await liveRes.json().catch(() => null);
      if (liveRes.ok && live?.track?.id) {
        const pt: PlayerTrack = {
          id: live.track.id,
          title: live.track.title || track.title,
          artist: formatTrackArtistLine(
            live.track.artist || album?.artist || artist,
            live.track.title || track.title,
            track.artists,
          ),
          album: live.track.album || title,
          coverPath,
          streamUrl: live.streamUrl || live.track.streamUrl,
          explicit: track.explicit,
        };
        play(pt, queueWithCurrent(pt));
        setMsg(null);
        if (live.mode === "library") void load();
        return;
      }

      // Fallback: queue acquire when live resolve fails
      const body = {
        title: track.title,
        artist: album?.artist || artist,
        album: album?.title || title,
        foreignAlbumId: album?.foreignAlbumId || foreignAlbumId || undefined,
        type: "track" as const,
        prefer: "fallback" as const,
      };

      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || live?.error || "Playback failed");
        return;
      }

      if (data.track?.id) {
        const pt: PlayerTrack = {
          id: data.track.id,
          title: data.track.title || track.title,
          artist: formatTrackArtistLine(
            data.track.artist || album?.artist || artist,
            data.track.title || track.title,
            track.artists,
          ),
          album: data.track.album || title,
          coverPath,
          explicit: track.explicit,
        };
        play(pt, queueWithCurrent(pt));
        setMsg(null);
        void load();
        return;
      }

      for (let i = 0; i < 40; i++) {
        await sleep(1500);
        const poll = await fetch("/api/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const pj = await poll.json();
        if (pj.track?.id) {
          const pt: PlayerTrack = {
            id: pj.track.id,
            title: pj.track.title || track.title,
            artist: formatTrackArtistLine(
              pj.track.artist || album?.artist || artist,
              pj.track.title || track.title,
              track.artists,
            ),
            album: pj.track.album || title,
            coverPath,
            explicit: track.explicit,
          };
          play(pt, queueWithCurrent(pt));
          setMsg(null);
          void load();
          return;
        }
      }
      setMsg("Still acquiring — try again in a moment");
      void load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Playback failed");
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
      setMsg("Acquire path not ready — check yt-dlp");
      return;
    }
    setBusyKey(track.key);
    setMsg(null);
    try {
      const body = {
        title: track.title,
        artist: album?.artist || artist,
        album: album?.title || title,
        foreignAlbumId: album?.foreignAlbumId || foreignAlbumId || undefined,
        type: "track" as const,
        prefer: "fallback" as const,
      };
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "Download failed");
        return;
      }
      if (data.track?.id) {
        setMsg(null);
        void load();
        return;
      }
      for (let i = 0; i < 40; i++) {
        await sleep(1500);
        const poll = await fetch("/api/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const pj = await poll.json();
        if (pj.track?.id) {
          setMsg(null);
          void load();
          return;
        }
      }
      setMsg("Still downloading — check Requests if needed");
      void load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusyKey(null);
    }
  }

  async function removeFromLibrary(track: AlbumTrack) {
    if (!track.localTrackId) return;
    if (
      !confirm(
        `Remove “${track.title}” from the library and delete the file on disk? It will need to be re-downloaded to play again.`,
      )
    ) {
      return;
    }
    setBusyKey(track.key);
    try {
      const res = await fetch(
        `/api/tracks/${encodeURIComponent(track.localTrackId)}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(
          typeof data?.error === "string"
            ? data.error
            : "Couldn’t remove from library",
        );
        return;
      }
      const removedId = track.localTrackId;
      setTracks((prev) =>
        prev.map((t) =>
          t.key === track.key
            ? {
                ...t,
                available: false,
                downloaded: false,
                hasFile: false,
                localTrackId: null,
                streamUrl: null,
              }
            : t,
        ),
      );
      emitLibraryChanged({ trackId: removedId });
      toast.success("Removed from library");
    } catch {
      toast.error("Couldn’t remove from library");
    } finally {
      setBusyKey(null);
    }
  }

  function playAvailable() {
    const first = albumQueue[0];
    if (!first) {
      const next = tracks[0];
      if (next) void acquireAndPlay(next);
      return;
    }
    play(first, albumQueue);
  }

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

  return (
    <div className="flex min-h-full flex-col">
      <section className="relative -mx-6 -mt-6 border-b border-border px-6 pb-10 pt-8 md:-mx-8 md:px-8 lg:-mx-10 lg:px-10">
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
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl">
              {loading && !displayTitle ? "…" : displayTitle || "Album"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {displayArtist}
              {album?.year ? ` · ${album.year}` : ""}
              {tracks.length
                ? ` · ${tracks.length} song${tracks.length === 1 ? "" : "s"}, ${formatAlbumLength(totalSeconds)}`
                : ""}
            </p>
            {msg && <p className="text-sm text-foreground">{msg}</p>}
            {error && !tracks.length && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => playAvailable()}
                disabled={loading || (!tracks.length && !fallbackReady)}
                className="flex size-14 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                aria-label="Play"
              >
                <Play className="size-6 translate-x-0.5" fill="currentColor" />
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
            No tracklist found for this album yet. Search may still acquire by
            title, or add it in Lidarr so Polarr can read tracks.
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[480px] border-separate border-spacing-y-0.5 text-left text-sm">
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
                  const playerTrack: PlayerTrack = {
                    id: t.localTrackId || `stream:${t.key}`,
                    title: t.title,
                    artist: trackArtists,
                    album: album?.title || title,
                    coverPath: album?.image || null,
                    streamUrl: t.streamUrl || null,
                    explicit: t.explicit,
                  };
                  const row = (
                    <tr
                      draggable
                      onDragStart={(e) => setDragTrack(e, playerTrack)}
                      className="group/row cursor-grab transition-colors active:cursor-grabbing"
                      onClick={() => void acquireAndPlay(t)}
                    >
                      <td className="rounded-l-md py-3 pl-3 tabular-nums text-muted-foreground group-hover/row:bg-muted/30">
                        {busy ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <>
                            <span className="group-hover/row:hidden">
                              {t.trackNumber}
                            </span>
                            <Play
                              className="hidden size-3.5 group-hover/row:inline"
                              fill="currentColor"
                            />
                          </>
                        )}
                      </td>
                      <td className="py-3 pr-4 group-hover/row:bg-muted/30">
                        <div className="min-w-0">
                          <div
                            className={cn(
                              "truncate font-medium",
                              t.available
                                ? "text-foreground"
                                : "text-foreground/80",
                            )}
                          >
                            {t.title}
                          </div>
                          <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                            {t.explicit ? <ExplicitBadge /> : null}
                            <span className="truncate">{trackArtists}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 group-hover/row:bg-muted/30">
                        <TrackRowActions
                          trackId={t.localTrackId || `catalog:${t.key}`}
                          artist={trackArtists}
                          title={t.title}
                          album={album?.title || title}
                          coverPath={album?.image || null}
                          duration={t.duration}
                          inLibrary={t.available}
                          downloading={busy}
                          onDownload={
                            t.available
                              ? undefined
                              : () => void markDownloaded(t)
                          }
                          onRemoveFromLibrary={
                            isAdmin && t.available && t.localTrackId
                              ? () => void removeFromLibrary(t)
                              : undefined
                          }
                        />
                      </td>
                      <td className="rounded-r-md py-3 pr-3 text-right tabular-nums text-muted-foreground group-hover/row:bg-muted/30">
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
  );
}
