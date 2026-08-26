"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { ListeningCover } from "@/components/listening-cover";
import { TrackContextMenu } from "@/components/track-context-menu";
import { albumHref } from "@/lib/album-ref";
import {
  MediaShelfRow,
  MediaTileShell,
} from "@/components/media-shelf";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlayer, type PlayerTrack } from "@/components/player-provider";
import {
  fetchDiscoverFeed,
  peekDiscoverCache,
  seedDiscoverCache,
} from "@/lib/discover-client";
import type {
  DiscoverMoreFromShelf,
  DiscoverPayload,
  DiscoverReleaseCard,
} from "@/lib/discover-types";
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

type Release = DiscoverReleaseCard;

type CatalogArtist = {
  name: string;
  image?: string;
  foreignArtistId?: string;
};

type OthersItem = PlayerTrack & {
  playedAt: string;
  listenedBy: string;
  listenedByAvatarUrl?: string | null;
  listeners?: { username: string; avatarUrl?: string | null }[];
};

type MoreFromItem = DiscoverMoreFromShelf["items"][number];
type MoreFromShelf = DiscoverMoreFromShelf;

function packMoreFromRows(shelves: MoreFromShelf[]) {
  const rows: MoreFromShelf[][] = [];
  let i = 0;
  let pair = true;
  while (i < shelves.length) {
    if (pair && i + 1 < shelves.length) {
      rows.push([shelves[i], shelves[i + 1]]);
      i += 2;
    } else {
      rows.push([shelves[i]]);
      i += 1;
    }
    pair = !pair;
  }
  return rows;
}

function ShelfSkeleton({
  count = 6,
  size = "large",
}: {
  count?: number;
  size?: "large" | "compact";
}) {
  const tileClass =
    size === "compact"
      ? "w-[calc((100%-1.5rem)/3.25)] max-w-[6.75rem] shrink-0 space-y-2"
      : "w-[calc((100%-0.75rem)/2.35)] max-w-[9.75rem] shrink-0 space-y-2";
  return (
    <>
      <div
        className="-mr-4 flex gap-3 overflow-hidden pr-4 lg:hidden"
        aria-busy
      >
        {Array.from({ length: Math.min(count, size === "compact" ? 5 : 4) }).map(
          (_, i) => (
            <div key={i} className={tileClass}>
              <Skeleton className="aspect-square w-full rounded-md" />
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          ),
        )}
      </div>
      <div
        className="hidden w-full gap-4 lg:grid"
        style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
        aria-busy
      >
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="min-w-0 space-y-2.5">
            <Skeleton className="aspect-square w-full rounded-md" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        ))}
      </div>
    </>
  );
}

function applyDiscover(
  data: DiscoverPayload,
  set: {
    setCatalog: (v: Release[]) => void;
    setMoreFrom: (v: MoreFromShelf[]) => void;
    setReleases: (v: Release[]) => void;
    setArtists: (v: CatalogArtist[]) => void;
    setLidarrError: (v: string | null) => void;
  },
) {
  set.setCatalog(Array.isArray(data.catalog) ? data.catalog : []);
  set.setMoreFrom(Array.isArray(data.moreFrom) ? data.moreFrom : []);
  set.setReleases(Array.isArray(data.releases) ? data.releases : []);
  set.setArtists(Array.isArray(data.artists) ? data.artists : []);
  set.setLidarrError(data.lidarrError || null);
}

export function HomeClient({
  initialDiscover = null,
}: {
  initialDiscover?: DiscoverPayload | null;
}) {
  const router = useRouter();
  const { play } = usePlayer();
  const seeded = initialDiscover ?? peekDiscoverCache();
  const [moreFrom, setMoreFrom] = useState<MoreFromShelf[]>(
    () => seeded?.moreFrom || [],
  );
  const [catalog, setCatalog] = useState<Release[]>(
    () => seeded?.catalog || [],
  );
  const [releases, setReleases] = useState<Release[]>(
    () => seeded?.releases || [],
  );
  const [artists, setArtists] = useState<CatalogArtist[]>(
    () => seeded?.artists || [],
  );
  const [others, setOthers] = useState<OthersItem[]>([]);
  const [lidarrError, setLidarrError] = useState<string | null>(
    () => seeded?.lidarrError || null,
  );
  const [loading, setLoading] = useState(!seeded);

  const loadOthers = useCallback(async () => {
    try {
      const res = await fetch("/api/listening?limit=48");
      if (!res.ok) return;
      const data = await res.json();
      const next = Array.isArray(data.items) ? data.items : [];
      // Keep last good shelf if a poll returns empty while we already had items
      // (transient glitch). First load / true empty still shows the empty copy.
      setOthers((prev) => (next.length === 0 && prev.length > 0 ? prev : next));
    } catch {
      /* keep previous */
    }
  }, []);

  const load = useCallback(
    async (opts?: { force?: boolean; background?: boolean }) => {
      if (!opts?.background) setLoading(true);
      try {
        const data = await fetchDiscoverFeed({ force: opts?.force });
        applyDiscover(data, {
          setCatalog,
          setMoreFrom,
          setReleases,
          setArtists,
          setLidarrError,
        });
      } catch {
        /* keep previous shelves */
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (initialDiscover) {
      seedDiscoverCache(initialDiscover);
    }
    // Warm paint from SSR / module cache; refresh in background when stale.
    if (seeded) {
      void load({ force: true, background: true });
    } else {
      void load();
    }
    void loadOthers();
    const t = window.setInterval(() => {
      void loadOthers();
    }, 30_000);
    const onListen = () => {
      void loadOthers();
    };
    window.addEventListener(LISTEN_CREDITED_EVENT, onListen);
    return () => {
      window.clearInterval(t);
      window.removeEventListener(LISTEN_CREDITED_EVENT, onListen);
    };
    // intentionally once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function playOthersTrack(item: OthersItem) {
    const pt: PlayerTrack = {
      id: item.id,
      title: item.title,
      artist: item.artist,
      resolveArtist: item.artist,
      album: item.album || item.title,
      coverPath: item.coverPath || null,
    };
    play(pt, [pt]);
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

  function openArtist(a: CatalogArtist) {
    const qs = new URLSearchParams({ name: a.name });
    if (a.foreignArtistId) qs.set("foreignArtistId", a.foreignArtistId);
    if (a.image) qs.set("image", a.image);
    router.push(`/artist?${qs.toString()}`);
  }

  function releaseTiles(list: Release[], visible: number, compact = false) {
    return list.slice(0, visible).map((r) => {
      const href = catalogAlbumHref(r);
      return (
        <MediaTileShell
          key={r.id}
          title={r.title}
          subtitle={r.artist}
          ariaLabel={`Open ${r.title}`}
          onOpen={() => router.push(href)}
          compact={compact}
          cover={
            <CoverArt seed={r.title} image={r.image} className="size-full" />
          }
        />
      );
    });
  }

  return (
    <div className="space-y-8 lg:space-y-10">
      {lidarrError && (
        <p className="text-sm text-destructive">Lidarr: {lidarrError}</p>
      )}

      {others.length > 0 ? (
        <MediaShelfRow
          title="What others are listening to"
          itemCount={others.length}
          fillRow={false}
          mobileTileSize="compact"
        >
          {(visible) =>
            others.slice(0, visible).map((item, i) => (
              <TrackContextMenu key={item.id} track={item}>
                <div className="min-w-0">
                  <MediaTileShell
                    title={item.title}
                    subtitle={formatTrackArtistLine(item.artist, item.title)}
                    ariaLabel={`Play ${item.title}`}
                    onOpen={() => playOthersTrack(item)}
                    compact
                    cover={
                      <ListeningCover
                        title={item.title}
                        coverPath={item.coverPath}
                        listenedBy={item.listenedBy}
                        avatarUrl={item.listenedByAvatarUrl}
                        listeners={item.listeners}
                        delayMs={(i % 5) * 700}
                      />
                    }
                  />
                </div>
              </TrackContextMenu>
            ))
          }
        </MediaShelfRow>
      ) : null}

      <MediaShelfRow
        title="Latest releases"
        seeAllHref="/browse/releases"
        itemCount={releases.length}
        mobileTileSize="compact"
        empty={
          loading ? (
            <ShelfSkeleton size="compact" />
          ) : (
            <p className="text-sm text-muted-foreground">
              New albums from Lidarr and MusicBrainz show up here.
            </p>
          )
        }
      >
        {(visible) => releaseTiles(releases, visible, true)}
      </MediaShelfRow>

      <MediaShelfRow
        title="Explore"
        seeAllHref="/browse/explore"
        itemCount={catalog.length}
        mobileTileSize="compact"
        empty={
          loading ? (
            <ShelfSkeleton size="compact" />
          ) : (
            <p className="text-sm text-muted-foreground">
              What’s trending, nudged by what you play and like.
            </p>
          )
        }
      >
        {(visible) => releaseTiles(catalog, visible, true)}
      </MediaShelfRow>

      <MediaShelfRow
        title="Artists"
        seeAllHref="/browse/artists"
        itemCount={artists.length}
        mobileTileSize="compact"
        empty={
          loading ? (
            <ShelfSkeleton size="compact" />
          ) : (
            <p className="text-sm text-muted-foreground">
              Artists you play, like, or keep in the library show up here —
              plus what’s charting.
            </p>
          )
        }
      >
        {(visible) =>
          artists.slice(0, visible).map((a) => (
            <MediaTileShell
              key={a.foreignArtistId || a.name}
              title={a.name}
              subtitle="Artist"
              ariaLabel={`Open ${a.name}`}
              onOpen={() => openArtist(a)}
              coverShape="circle"
              compact
              cover={
                <CoverArt
                  seed={a.name}
                  image={a.image}
                  className="size-full rounded-full"
                />
              }
            />
          ))
        }
      </MediaShelfRow>

      {loading && moreFrom.length === 0 ? (
        <div className="space-y-9 lg:grid lg:grid-cols-2 lg:gap-10">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-3 lg:space-y-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-12 shrink-0 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-6 w-40" />
                </div>
              </div>
              <ShelfSkeleton count={4} />
            </div>
          ))}
        </div>
      ) : null}

      {packMoreFromRows(moreFrom).map((row) => (
        <div
          key={row.map((s) => s.artist).join("|")}
          className={row.length > 1 ? "space-y-9 lg:grid lg:grid-cols-2 lg:gap-10 lg:space-y-0" : undefined}
        >
          {row.map((shelf) => (
            <MediaShelfRow
              key={shelf.artist}
              eyebrow="More like"
              title={shelf.artist}
              seeAllHref={`/artist?name=${encodeURIComponent(shelf.artist)}`}
              itemCount={shelf.items.length}
              fillRow={row.length === 1}
              mobileTileSize="large"
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
              {(visible) => {
                const cap = row.length > 1 ? Math.min(visible, 4) : visible;
                return shelf.items.slice(0, cap).map((item) => {
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
                });
              }}
            </MediaShelfRow>
          ))}
        </div>
      ))}
    </div>
  );
}
