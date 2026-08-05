"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { ListeningCover } from "@/components/listening-cover";
import { TrackContextMenu } from "@/components/track-context-menu";
import { albumHref } from "@/lib/album-ref";
import { MediaShelfRow, MediaTileShell } from "@/components/media-shelf";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlayer, type PlayerTrack } from "@/components/player-provider";
import { LISTEN_CREDITED_EVENT } from "@/lib/ui-events";
import { formatTrackArtistLine } from "@/lib/utils";

function catalogAlbumHref(r: {
  title: string;
  artist: string;
  foreignAlbumId?: string;
  lidarrAlbumId?: number;
}) {
  return albumHref({
    title: r.title,
    artist: r.artist,
    foreignAlbumId: r.foreignAlbumId,
    lidarrAlbumId: r.lidarrAlbumId,
  });
}

type Release = {
  id: string;
  title: string;
  artist: string;
  year?: number;
  image?: string;
  foreignAlbumId?: string;
  foreignArtistId?: string;
  releaseDate?: string;
  hasFile: boolean;
  monitored: boolean;
  lidarrAlbumId?: number;
};

type OthersItem = PlayerTrack & {
  playedAt: string;
  listenedBy: string;
  listenedByAvatarUrl?: string | null;
};

type MoreFromItem =
  | {
      kind: "album";
      id: string;
      title: string;
      subtitle: string;
      artist: string;
      album: string;
      image?: string | null;
      trackCount: number;
      foreignAlbumId?: string;
      lidarrAlbumId?: number;
    }
  | {
      kind: "single" | "feature";
      id: string;
      title: string;
      subtitle: string;
      artist: string;
      album?: string;
      image?: string | null;
      trackId: string;
      duration?: number;
      coverPath?: string | null;
    };

type MoreFromShelf = {
  artist: string;
  image?: string | null;
  items: MoreFromItem[];
};

export function HomeClient() {
  const router = useRouter();
  const { play } = usePlayer();
  const [moreFrom, setMoreFrom] = useState<MoreFromShelf[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [others, setOthers] = useState<OthersItem[]>([]);
  const [lidarrError, setLidarrError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadOthers = useCallback(async () => {
    try {
      const res = await fetch("/api/listening?limit=48", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      setOthers(Array.isArray(data.items) ? data.items : []);
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/discover", { cache: "no-store" });
      const data = await res.json();
      setMoreFrom(Array.isArray(data.moreFrom) ? data.moreFrom : []);
      setReleases(data.releases || []);
      setLidarrError(data.lidarrError || null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadOthers();
    const t = window.setInterval(() => {
      void loadOthers();
    }, 15_000);
    const onListen = () => {
      void loadOthers();
    };
    window.addEventListener(LISTEN_CREDITED_EVENT, onListen);
    return () => {
      window.clearInterval(t);
      window.removeEventListener(LISTEN_CREDITED_EVENT, onListen);
    };
  }, [load, loadOthers]);

  function playOthers(item: OthersItem) {
    const queue = others.map((r) => ({
      id: r.id,
      title: r.title,
      artist: formatTrackArtistLine(r.artist, r.title),
      album: r.album,
      coverPath: r.coverPath,
    }));
    play(
      { ...item, artist: formatTrackArtistLine(item.artist, item.title) },
      queue,
    );
  }

  function playShelfTrack(item: Extract<MoreFromItem, { trackId: string }>) {
    const pt: PlayerTrack = {
      id: item.trackId,
      title: item.title,
      artist: item.subtitle || item.artist,
      album: item.album || "",
      coverPath: item.coverPath || item.image || null,
    };
    play(pt, [pt]);
  }

  return (
    <div className="space-y-10">
      {lidarrError && (
        <p className="text-sm text-destructive">Lidarr: {lidarrError}</p>
      )}

      <MediaShelfRow
        title="What others are listening to"
        seeAllHref="/browse/listening"
        itemCount={others.length}
        empty={
          <p className="text-sm text-muted-foreground">
            Tracks show up here after anyone on this server listens for 15+
            seconds.
          </p>
        }
      >
        {(visible) =>
          others.slice(0, visible).map((item, i) => (
            <TrackContextMenu key={item.id} track={item}>
              <div className="min-w-0">
                <MediaTileShell
                  title={item.title}
                  subtitle={`${formatTrackArtistLine(item.artist, item.title)} · ${item.listenedBy}`}
                  ariaLabel={`Play ${item.title}`}
                  onOpen={() => playOthers(item)}
                  cover={
                    <ListeningCover
                      title={item.title}
                      coverPath={item.coverPath}
                      listenedBy={item.listenedBy}
                      avatarUrl={item.listenedByAvatarUrl}
                      delayMs={(i % 5) * 700}
                    />
                  }
                  playButton={
                    <button
                      type="button"
                      aria-label={`Play ${item.title}`}
                      onClick={() => playOthers(item)}
                      className="absolute bottom-2 right-2 flex size-9 items-center justify-center rounded-full border border-border bg-background/95 shadow-md transition-transform hover:scale-105"
                    >
                      <Play className="size-3.5" fill="currentColor" />
                    </button>
                  }
                />
              </div>
            </TrackContextMenu>
          ))
        }
      </MediaShelfRow>

      <MediaShelfRow
        title="Latest releases"
        seeAllHref="/browse/releases"
        itemCount={releases.length}
        empty={
          <div className="flex gap-5" aria-busy={loading || undefined}>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="w-36 shrink-0 space-y-2.5">
                    <Skeleton className="aspect-square w-full rounded-md" />
                    <Skeleton className="h-3.5 w-4/5" />
                    <Skeleton className="h-3 w-3/5" />
                  </div>
                ))
              : (
                  <p className="text-sm text-muted-foreground">
                    No recent albums. Connect Lidarr in Admin, then open an album to pick tracks.
                  </p>
                )}
          </div>
        }
      >
        {(visible) =>
          releases.slice(0, visible).map((r) => {
            const href = catalogAlbumHref(r);
            return (
              <MediaTileShell
                key={r.id}
                title={r.title}
                subtitle={r.artist}
                ariaLabel={`Open ${r.title}`}
                onOpen={() => router.push(href)}
                cover={
                  <CoverArt
                    seed={r.title}
                    image={r.image}
                    className="size-full"
                  />
                }
              />
            );
          })
        }
      </MediaShelfRow>

      {loading && moreFrom.length === 0
        ? Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-12 shrink-0 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-6 w-40" />
                </div>
              </div>
              <div className="flex gap-5">
                {Array.from({ length: 5 }).map((__, j) => (
                  <div key={j} className="w-36 shrink-0 space-y-2.5">
                    <Skeleton className="aspect-square w-full rounded-md" />
                    <Skeleton className="h-3.5 w-4/5" />
                    <Skeleton className="h-3 w-3/5" />
                  </div>
                ))}
              </div>
            </div>
          ))
        : null}

      {moreFrom.map((shelf) => (
        <MediaShelfRow
          key={shelf.artist}
          eyebrow="More from"
          title={shelf.artist}
          seeAllHref={`/artist?name=${encodeURIComponent(shelf.artist)}`}
          itemCount={shelf.items.length}
          leading={
            <button
              type="button"
              onClick={() =>
                router.push(
                  `/artist?name=${encodeURIComponent(shelf.artist)}`,
                )
              }
              className="shrink-0 overflow-hidden rounded-full"
              aria-label={`Open ${shelf.artist}`}
            >
              <CoverArt
                seed={shelf.artist}
                image={shelf.image || undefined}
                className="size-12 rounded-full"
              />
            </button>
          }
        >
          {(visible) =>
            shelf.items.slice(0, visible).map((item) => {
              if (item.kind === "album") {
                const href = albumHref({
                  title: item.album,
                  artist: item.artist,
                  foreignAlbumId: item.foreignAlbumId,
                  lidarrAlbumId: item.lidarrAlbumId,
                });
                return (
                  <MediaTileShell
                    key={item.id}
                    title={item.title}
                    subtitle={item.subtitle}
                    ariaLabel={`Open ${item.title}`}
                    onOpen={() => router.push(href)}
                    cover={
                      <CoverArt
                        seed={item.title}
                        image={item.image || undefined}
                        className="size-full"
                      />
                    }
                  />
                );
              }

              const track: PlayerTrack = {
                id: item.trackId,
                title: item.title,
                artist: item.subtitle || item.artist,
                album: item.album || "",
                coverPath: item.coverPath || item.image || null,
              };
              return (
                <TrackContextMenu key={item.id} track={track}>
                  <div className="min-w-0">
                    <MediaTileShell
                      title={item.title}
                      subtitle={item.subtitle}
                      ariaLabel={`Play ${item.title}`}
                      onOpen={() => playShelfTrack(item)}
                      cover={
                        <CoverArt
                          seed={item.album || item.title}
                          image={item.image || undefined}
                          className="size-full"
                        />
                      }
                      playButton={
                        <button
                          type="button"
                          aria-label={`Play ${item.title}`}
                          onClick={() => playShelfTrack(item)}
                          className="absolute bottom-2 right-2 flex size-9 items-center justify-center rounded-full border border-border bg-background/95 shadow-md transition-transform hover:scale-105"
                        >
                          <Play className="size-3.5" fill="currentColor" />
                        </button>
                      }
                    />
                  </div>
                </TrackContextMenu>
              );
            })
          }
        </MediaShelfRow>
      ))}
    </div>
  );
}
