"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Clock,
  Heart,
  Play,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CoverArt } from "@/components/cover-art";
import { TrackContextMenu } from "@/components/track-context-menu";
import { TrackRowActions } from "@/components/track-row-actions";
import { TrackRowIndex } from "@/components/track-row-index";
import { ExplicitBadge } from "@/components/explicit-badge";
import { usePlayer, type PlayerTrack } from "@/components/player-provider";
import { albumHref } from "@/lib/album-ref";
import {
  LIBRARY_CHANGED_EVENT,
  LIKES_CHANGED_EVENT,
  emitLibraryChanged,
} from "@/lib/ui-events";
import { setDragTrack } from "@/lib/drag-track";
import {
  isPlayerRowCurrent,
  trackRowEndCell,
  trackRowMidCell,
  trackRowStartCell,
} from "@/lib/player-row";
import { cn, formatAlbumLength, formatDuration, formatTrackArtistLine, titleLooksExplicit } from "@/lib/utils";

type Track = PlayerTrack & {
  source: string;
  path: string;
  album?: string;
  duration?: number;
  liked?: boolean;
  streamOnly?: boolean;
};

function toPlayable(t: Track): PlayerTrack {
  const local =
    Boolean(t.path) &&
    !t.streamOnly &&
    !t.id.startsWith("stream:") &&
    !t.id.startsWith("live:") &&
    !t.id.startsWith("catalog:");
  const explicit = t.explicit ?? titleLooksExplicit(t.title);
  if (local) {
    return {
      id: t.id,
      title: t.title,
      artist: t.artist,
      album: t.album || t.title,
      coverPath: t.coverPath,
      duration: t.duration,
      quality: "local",
      explicit,
    };
  }
  const id =
    t.id.startsWith("live:") ||
    t.id.startsWith("stream:") ||
    t.id.startsWith("catalog:")
      ? t.id
      : `stream:${t.artist.trim().toLowerCase()}|${t.title.trim().toLowerCase()}`;
  return {
    id,
    title: t.title,
    artist: t.artist,
    album: t.album || t.title,
    coverPath: t.coverPath,
    duration: t.duration,
    quality: "youtube",
    explicit,
  };
}

export function LibraryClient({
  mode = "library",
}: {
  mode?: "library" | "liked";
}) {
  const router = useRouter();
  const { play, track, queue } = usePlayer();
  const searchParams = useSearchParams();
  const filterAlbum = searchParams.get("album");
  const filterArtist = searchParams.get("artist");

  // Album detail lives on /album — keep old library?album= links working
  useEffect(() => {
    if (mode !== "library" || !filterAlbum) return;
    router.replace(
      albumHref({
        title: filterAlbum,
        artist: filterArtist || "",
      }),
    );
  }, [mode, filterAlbum, filterArtist, router]);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [root, setRoot] = useState<string | null>(null);

  async function loadLibrary(scan = false) {
    setScanning(scan);
    const res = await fetch(scan ? "/api/library?scan=1" : "/api/library");
    const data = await res.json();
    setTracks(data.tracks || []);
    if (data.root) setRoot(data.root);
    setScanning(false);
  }

  async function loadLiked() {
    const res = await fetch("/api/likes");
    if (!res.ok) {
      setTracks([]);
      return;
    }
    const data = await res.json();
    const list = (data.tracks || []) as Track[];
    setTracks(
      list.map((t) => ({
        ...t,
        source: t.source || "library",
        path: t.path || "",
        liked: true,
        streamOnly:
          Boolean(t.streamOnly) ||
          !t.path ||
          t.source === "stream" ||
          t.id.startsWith("stream:"),
      })),
    );
    setLikedIds(new Set(list.map((t) => t.id)));
  }

  async function loadLikesMap() {
    const res = await fetch("/api/likes");
    if (!res.ok) return;
    const data = await res.json();
    const list = (data.tracks || []) as { id: string }[];
    setLikedIds(new Set(list.map((t) => t.id)));
  }

  async function load(scan = false) {
    if (mode === "liked") {
      await loadLiked();
      return;
    }
    await loadLibrary(scan);
    await loadLikesMap();
  }

  useEffect(() => {
    if (mode === "library" && filterAlbum) return;
    void load(false);
  }, [mode, filterAlbum]);

  useEffect(() => {
    if (mode !== "liked") return;
    const onLikesChanged = () => {
      void loadLiked();
    };
    window.addEventListener(LIKES_CHANGED_EVENT, onLikesChanged);
    return () => {
      window.removeEventListener(LIKES_CHANGED_EVENT, onLikesChanged);
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "library") return;
    const onLibraryChanged = (event: Event) => {
      const trackId = (event as CustomEvent<{ trackId?: string }>).detail
        ?.trackId;
      if (trackId) {
        setTracks((prev) => prev.filter((t) => t.id !== trackId));
        return;
      }
      void loadLibrary(false);
    };
    window.addEventListener(LIBRARY_CHANGED_EVENT, onLibraryChanged);
    return () => {
      window.removeEventListener(LIBRARY_CHANGED_EVENT, onLibraryChanged);
    };
  }, [mode]);

  const albums = useMemo(() => {
    const map = new Map<
      string,
      { title: string; artist: string; tracks: Track[] }
    >();
    for (const t of tracks) {
      const key = `${t.artist}::${t.album || t.title}`;
      const cur = map.get(key);
      if (cur) cur.tracks.push(t);
      else
        map.set(key, {
          title: t.album || t.title,
          artist: t.artist,
          tracks: [t],
        });
    }
    return [...map.values()];
  }, [tracks]);

  const filteredTracks = useMemo(() => {
    if (mode === "liked") return tracks;
    if (!filterAlbum) return tracks;
    const albumQ = filterAlbum.trim().toLowerCase();
    const artistQ = filterArtist?.trim().toLowerCase() || null;
    return tracks.filter((t) => {
      const albumName = (t.album || t.title).trim().toLowerCase();
      if (albumName !== albumQ) return false;
      if (!artistQ) return true;
      return t.artist.trim().toLowerCase() === artistQ;
    });
  }, [tracks, mode, filterAlbum, filterArtist]);

  const focusedAlbum = useMemo(() => {
    if (!filterAlbum || mode === "liked") return null;
    const albumQ = filterAlbum.trim().toLowerCase();
    const artistQ = filterArtist?.trim().toLowerCase() || null;
    const matched = albums.find((a) => {
      if (a.title.trim().toLowerCase() !== albumQ) return false;
      if (!artistQ) return true;
      return a.artist.trim().toLowerCase() === artistQ;
    });
    if (matched) return matched;
    // Still treat URL as an album page even before tracks load / if empty
    return {
      title: filterAlbum,
      artist: filterArtist || "Unknown",
      tracks: filteredTracks,
    };
  }, [albums, filterAlbum, filterArtist, mode, filteredTracks]);

  const playableQueue = useMemo(
    () => filteredTracks.map(toPlayable),
    [filteredTracks],
  );

  function playFrom(t: Track) {
    play(toPlayable(t), playableQueue);
  }

  const albumView = mode !== "liked" && Boolean(filterAlbum);

  const featured =
    mode === "liked" ? null : focusedAlbum || albums[0];

  const albumSeconds = useMemo(
    () =>
      filteredTracks.reduce(
        (sum, t) => sum + (Number.isFinite(t.duration) ? t.duration || 0 : 0),
        0,
      ),
    [filteredTracks],
  );

  // After hooks: old /library?album= links redirect to /album
  if (mode === "library" && filterAlbum) {
    return (
      <p className="p-6 text-sm text-muted-foreground">Opening album…</p>
    );
  }

  const heroTitle =
    mode === "liked"
      ? "Liked Songs"
      : albumView && filterAlbum
        ? filterAlbum
        : "Library";

  const heroLabel =
    mode === "liked" ? "Playlist" : albumView ? "Album" : "Collection";

  const heroMeta =
    mode === "liked"
      ? `${filteredTracks.length} song${filteredTracks.length === 1 ? "" : "s"}`
      : albumView
        ? `${filterArtist || focusedAlbum?.artist || "Unknown"} · ${filteredTracks.length} song${filteredTracks.length === 1 ? "" : "s"}, ${formatAlbumLength(albumSeconds)}`
        : `${tracks.length} tracks · ${albums.length} albums${root ? ` · ${root}` : ""}`;

  function onLikedChange(trackId: string, liked: boolean) {
    setLikedIds((prev) => {
      const next = new Set(prev);
      if (liked) next.add(trackId);
      else next.delete(trackId);
      return next;
    });
    if (mode === "liked" && !liked) {
      setTracks((prev) => prev.filter((t) => t.id !== trackId));
    }
  }

  async function downloadTrack(t: Track) {
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: t.title,
          artist: t.artist,
          album: t.album || t.title,
          type: "track",
          prefer: "fallback",
        }),
      });
      if (!res.ok) return;
      setTracks((prev) =>
        prev.map((row) =>
          row.id === t.id ? { ...row, streamOnly: false, path: row.path || "pending" } : row,
        ),
      );
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <section
        className={cn(
          "relative -mx-6 -mt-6 border-b border-border px-6 pb-8 pt-8 md:-mx-8 md:px-8 lg:-mx-10 lg:px-10",
          albumView && "pb-10",
        )}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-35"
          style={{
            background:
              mode === "liked"
                ? "linear-gradient(180deg, hsl(265 80% 28%) 0%, hsl(var(--background)) 100%)"
                : albumView
                  ? "linear-gradient(180deg, hsl(20 18% 22%) 0%, hsl(var(--background)) 100%)"
                  : "linear-gradient(180deg, hsl(0 0% 18%) 0%, hsl(var(--background)) 100%)",
          }}
          aria-hidden
        />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end">
          {mode === "liked" ? (
            <div
              className="flex size-40 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#450af5] via-[#8e2de2] to-[#c44cff] sm:size-44"
              aria-hidden
            >
              <Heart className="size-16 fill-white text-white" strokeWidth={0} />
            </div>
          ) : (
            <CoverArt
              seed={featured?.title || "Library"}
              className={cn(
                "shrink-0 rounded-lg shadow-lg",
                albumView
                  ? "size-44 sm:size-52 md:size-56"
                  : "size-40 sm:size-44",
              )}
            />
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {heroLabel}
            </p>
            <h1
              className={cn(
                "font-semibold tracking-tight",
                albumView
                  ? "text-3xl sm:text-4xl md:text-5xl"
                  : "text-3xl",
              )}
            >
              {heroTitle}
            </h1>
            <p className="text-sm text-muted-foreground">{heroMeta}</p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              {filteredTracks[0] && (
                <button
                  type="button"
                  onClick={() => playFrom(filteredTracks[0])}
                  className={cn(
                    "flex items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90",
                    albumView ? "size-14" : "h-10 gap-2 rounded-md px-4 text-sm font-medium",
                  )}
                  aria-label="Play"
                >
                  <Play
                    className={albumView ? "size-6 translate-x-0.5" : "size-4"}
                    fill="currentColor"
                  />
                  {!albumView ? <span>Play</span> : null}
                </button>
              )}
              {mode === "library" && !albumView ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void load(true)}
                  disabled={scanning}
                >
                  <RefreshCw
                    className={`size-4 ${scanning ? "animate-spin" : ""}`}
                  />
                  Scan
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="pt-6">
        {filteredTracks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-16 text-center text-muted-foreground">
            {mode === "liked"
              ? "No liked songs yet. Tap the heart on any track to save it here."
              : albumView
                ? "No tracks for this album yet."
                : "Empty library. Scan music, or Get / Stream from Search."}
          </div>
        ) : albumView ? (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[480px] border-separate border-spacing-y-1 text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="w-10 pb-3 pl-3 font-medium">#</th>
                  <th className="pb-3 pr-4 font-medium">Title</th>
                  <th className="w-[5.5rem] pb-3 font-medium" aria-label="Actions" />
                  <th className="w-16 pb-3 pr-3 text-right font-medium">
                    <Clock className="ml-auto size-3.5" aria-label="Duration" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredTracks.map((t, i) => {
                  const isCurrent = isPlayerRowCurrent(
                    track,
                    {
                      id: t.id,
                      localTrackId: t.id,
                      title: t.title,
                      artist: t.artist,
                    },
                    queue,
                  );
                  return (
                    <TrackContextMenu
                      key={t.id}
                      track={toPlayable(t)}
                      inLibrary={!t.streamOnly}
                    >
                      <tr
                        draggable
                        onDragStart={(e) => setDragTrack(e, t)}
                        className="group/row cursor-grab transition-colors active:cursor-grabbing"
                        onClick={() => playFrom(t)}
                      >
                      <td
                        className={trackRowStartCell(
                          isCurrent,
                          "py-3 pl-3 tabular-nums text-muted-foreground",
                        )}
                      >
                        <TrackRowIndex n={i + 1} isCurrent={isCurrent} />
                      </td>
                      <td className={trackRowMidCell(isCurrent, "py-3 pr-4")}>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{t.title}</div>
                          <div className="truncate text-sm text-muted-foreground">
                            {formatTrackArtistLine(t.artist, t.title)}
                          </div>
                        </div>
                      </td>
                      <td className={trackRowMidCell(isCurrent, "py-3")}>
                        <TrackRowActions
                          trackId={t.id}
                          artist={t.artist}
                          title={t.title}
                          album={t.album}
                          coverPath={t.coverPath}
                          duration={t.duration}
                          liked={likedIds.has(t.id) || Boolean(t.liked)}
                          onPolarr={!t.streamOnly}
                          onDownload={
                            t.streamOnly
                              ? () => void downloadTrack(t)
                              : undefined
                          }
                          onLikedChange={(liked) => onLikedChange(t.id, liked)}
                        />
                      </td>
                      <td
                        className={trackRowEndCell(
                          isCurrent,
                          "py-3 pr-3 text-right tabular-nums text-muted-foreground",
                        )}
                      >
                        {formatDuration(t.duration || 0)}
                      </td>
                    </tr>
                    </TrackContextMenu>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-y-1 text-left text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="w-10 pb-3 pl-2 font-medium">#</th>
                  <th className="pb-3 pr-4 font-medium">Title</th>
                  <th className="pb-3 pr-4 font-medium">Artist</th>
                  <th className="hidden pb-3 pr-4 font-medium md:table-cell">
                    Album
                  </th>
                  <th className="w-[5.5rem] pb-3 font-medium" aria-label="Actions" />
                  <th className="w-16 pb-3 pr-2 text-right font-medium">
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredTracks.map((t, i) => {
                  const playable = toPlayable(t);
                  const isCurrent = isPlayerRowCurrent(
                    track,
                    {
                      id: playable.id,
                      localTrackId: t.id,
                      title: t.title,
                      artist: t.artist,
                    },
                    queue,
                  );
                  return (
                    <TrackContextMenu
                      key={t.id}
                      track={playable}
                      inLibrary={!t.streamOnly}
                    >
                      <tr
                        draggable
                        onDragStart={(e) => setDragTrack(e, playable)}
                        className="group/row cursor-grab transition-colors active:cursor-grabbing"
                        onClick={() => playFrom(t)}
                      >
                      <td
                        className={trackRowStartCell(
                          isCurrent,
                          "py-3 pl-2 tabular-nums text-muted-foreground",
                        )}
                      >
                        <TrackRowIndex n={i + 1} isCurrent={isCurrent} />
                      </td>
                      <td className={trackRowMidCell(isCurrent, "py-3 pr-4")}>
                        <div className="flex min-w-0 items-center gap-3">
                          <CoverArt
                            seed={`${t.artist}-${t.title}`}
                            image={t.coverPath}
                            className="size-10 shrink-0 rounded-sm"
                          />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{t.title}</div>
                            {mode === "liked" ? (
                              <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground md:hidden">
                                {titleLooksExplicit(t.title) ? (
                                  <ExplicitBadge />
                                ) : null}
                                <span className="truncate">
                                  {formatTrackArtistLine(t.artist, t.title)}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td
                        className={trackRowMidCell(
                          isCurrent,
                          "py-3 pr-4 text-muted-foreground",
                        )}
                      >
                        {formatTrackArtistLine(t.artist, t.title)}
                      </td>
                      <td
                        className={trackRowMidCell(
                          isCurrent,
                          "hidden py-3 pr-4 text-muted-foreground md:table-cell",
                        )}
                      >
                        {t.album && t.artist ? (
                          <Link
                            href={albumHref({
                              title: t.album,
                              artist: t.artist,
                            })}
                            onClick={(e) => e.stopPropagation()}
                            className="block truncate hover:underline"
                          >
                            {t.album}
                          </Link>
                        ) : (
                          t.album
                        )}
                      </td>
                      <td className={trackRowMidCell(isCurrent, "py-3")}>
                        <TrackRowActions
                          trackId={t.id}
                          artist={t.artist}
                          title={t.title}
                          album={t.album}
                          coverPath={t.coverPath}
                          duration={t.duration}
                          liked={
                            mode === "liked" ||
                            likedIds.has(t.id) ||
                            Boolean(t.liked)
                          }
                          onPolarr={!t.streamOnly}
                          onDownload={
                            t.streamOnly
                              ? () => void downloadTrack(t)
                              : undefined
                          }
                          onLikedChange={(liked) => onLikedChange(t.id, liked)}
                        />
                      </td>
                      <td
                        className={trackRowEndCell(
                          isCurrent,
                          "py-3 pr-2 text-right tabular-nums text-muted-foreground",
                        )}
                      >
                        {formatDuration(t.duration || 0)}
                      </td>
                    </tr>
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
