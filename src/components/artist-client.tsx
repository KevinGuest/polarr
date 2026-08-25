"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Play } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { TrackContextMenu } from "@/components/track-context-menu";
import { TrackRowActions } from "@/components/track-row-actions";
import {
  MediaShelfRow,
  MediaTileShell,
  ShelfHeader,
} from "@/components/media-shelf";
import { usePlayer, type PlayerTrack } from "@/components/player-provider";
import { albumHref } from "@/lib/album-ref";
import { setDragTrack } from "@/lib/drag-track";
import { formatDuration, formatTrackArtistLine } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

type ArtistTrack = PlayerTrack & {
  duration?: number;
  source?: string;
  primaryArtist?: string;
};

type CatalogTile =
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

export function ArtistClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { play } = usePlayer();
  const name = searchParams.get("name") || "";
  const foreignArtistId = searchParams.get("foreignArtistId") || "";
  const imageParam = searchParams.get("image") || "";
  const [tracks, setTracks] = useState<ArtistTrack[]>([]);
  const [tiles, setTiles] = useState<CatalogTile[]>([]);
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!name) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const qs = new URLSearchParams({ name });
    if (foreignArtistId) qs.set("foreignArtistId", foreignArtistId);
    if (imageParam) qs.set("image", imageParam);
    void fetch(`/api/artist?${qs.toString()}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((data) => {
        setTracks(data.tracks || []);
        setTiles(Array.isArray(data.tiles) ? data.tiles : []);
        setImage(data.image || null);
      })
      .finally(() => setLoading(false));
  }, [name, foreignArtistId, imageParam]);

  if (!name) {
    return (
      <p className="text-sm text-muted-foreground">
        Pick an artist from a track menu.
      </p>
    );
  }

  const albums = tiles.filter((t) => t.kind === "album");
  const singles = tiles.filter((t) => t.kind === "single");
  const features = tiles.filter((t) => t.kind === "feature");

  function playTile(item: Extract<CatalogTile, { trackId: string }>) {
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
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <CoverArt
          seed={name}
          image={image || undefined}
          className="size-40 shrink-0 rounded-full shadow-lg sm:size-48"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Artist
          </p>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            {name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {albums.length
              ? `${albums.length} album${albums.length === 1 ? "" : "s"}`
              : null}
            {singles.length
              ? `${albums.length ? " · " : ""}${singles.length} single${singles.length === 1 ? "" : "s"}`
              : null}
            {features.length
              ? `${albums.length || singles.length ? " · " : ""}${features.length} feature${features.length === 1 ? "" : "s"}`
              : null}
            {!albums.length && !singles.length && !features.length
              ? `${tracks.length} track${tracks.length === 1 ? "" : "s"}`
              : null}
          </p>
          {tracks[0] ? (
            <button
              type="button"
              onClick={() => play(tracks[0], tracks)}
              className="mt-2 flex size-12 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90"
              aria-label="Play"
            >
              <Play className="size-5 translate-x-0.5" fill="currentColor" />
            </button>
          ) : null}
        </div>
      </header>

      {loading ? (
        <div className="space-y-6" aria-busy="true">
          <div className="flex gap-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="w-36 shrink-0 space-y-2.5">
                <Skeleton className="aspect-square w-full rounded-md" />
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            ))}
          </div>
        </div>
      ) : tracks.length === 0 && tiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No albums or tracks found for this artist yet.
        </p>
      ) : (
        <>
          {albums.length > 0 ? (
            <MediaShelfRow title="Albums" itemCount={albums.length}>
              {(visible) =>
                albums.slice(0, visible).map((a) => {
                  if (a.kind !== "album") return null;
                  const href = albumHref({
                    title: a.album,
                    artist: a.artist,
                    foreignAlbumId: a.foreignAlbumId,
                    lidarrAlbumId:
                      a.lidarrAlbumId != null && a.lidarrAlbumId > 0
                        ? a.lidarrAlbumId
                        : undefined,
                  });
                  return (
                    <MediaTileShell
                      key={a.id}
                      title={a.title}
                      subtitle={a.subtitle}
                      ariaLabel={`Open ${a.title}`}
                      onOpen={() => router.push(href)}
                      cover={
                        <CoverArt
                          seed={a.title}
                          image={a.image || undefined}
                          className="size-full"
                        />
                      }
                    />
                  );
                })
              }
            </MediaShelfRow>
          ) : null}

          {singles.length > 0 ? (
            <MediaShelfRow title="Singles" itemCount={singles.length}>
              {(visible) =>
                singles.slice(0, visible).map((item) => {
                  if (item.kind === "album") {
                    const href = albumHref({
                      title: item.album,
                      artist: item.artist,
                      foreignAlbumId: item.foreignAlbumId,
                      lidarrAlbumId:
                        item.lidarrAlbumId != null && item.lidarrAlbumId > 0
                          ? item.lidarrAlbumId
                          : undefined,
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
                  if (item.kind !== "single") return null;
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
                          onOpen={() => playTile(item)}
                          cover={
                            <CoverArt
                              seed={item.title}
                              image={item.image || undefined}
                              className="size-full"
                            />
                          }
                          playButton={
                            <button
                              type="button"
                              aria-label={`Play ${item.title}`}
                              onClick={() => playTile(item)}
                              className="absolute bottom-2 right-2 flex size-9 items-center justify-center rounded-full border border-border bg-background/95 shadow-md transition-transform hover:scale-105"
                            >
                              <Play
                                className="size-3.5"
                                fill="currentColor"
                              />
                            </button>
                          }
                        />
                      </div>
                    </TrackContextMenu>
                  );
                })
              }
            </MediaShelfRow>
          ) : null}

          {features.length > 0 ? (
            <MediaShelfRow
              title="Appears on"
              itemCount={features.length}
              fillRow={false}
            >
              {(visible) =>
                features.slice(0, visible).map((item) => {
                  if (item.kind !== "feature") return null;
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
                          onOpen={() => playTile(item)}
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
                              onClick={() => playTile(item)}
                              className="absolute bottom-2 right-2 flex size-9 items-center justify-center rounded-full border border-border bg-background/95 shadow-md transition-transform hover:scale-105"
                            >
                              <Play
                                className="size-3.5"
                                fill="currentColor"
                              />
                            </button>
                          }
                        />
                      </div>
                    </TrackContextMenu>
                  );
                })
              }
            </MediaShelfRow>
          ) : null}

          {tracks.length > 0 ? (
            <section className="space-y-4">
              <ShelfHeader title="Popular" />
              <ul className="divide-y divide-border/60 rounded-lg border border-border">
                {tracks.slice(0, 10).map((t, i) => (
                  <li key={t.id}>
                    <TrackContextMenu track={t}>
                      <div
                        draggable
                        onDragStart={(e) => setDragTrack(e, t)}
                        className="group/row flex w-full cursor-grab items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/30 active:cursor-grabbing"
                      >
                        <button
                          type="button"
                          onClick={() => play(t, tracks)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <span className="w-5 text-xs tabular-nums text-muted-foreground">
                            {i + 1}
                          </span>
                          <CoverArt
                            seed={t.title}
                            image={
                              t.coverPath && /^https?:\/\//i.test(t.coverPath)
                                ? t.coverPath
                                : undefined
                            }
                            className="size-10 shrink-0 rounded-md"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">
                              {t.title}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {formatTrackArtistLine(
                                t.primaryArtist || t.artist,
                                t.title,
                                t.artist !== t.primaryArtist ? t.artist : null,
                              )}
                              {t.album ? ` · ${t.album}` : ""}
                            </div>
                          </div>
                        </button>
                        <TrackRowActions
                          trackId={t.id}
                          artist={t.primaryArtist || t.artist}
                          title={t.title}
                          album={t.album}
                          coverPath={t.coverPath}
                          duration={t.duration}
                          onPolarr
                        />
                        <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                          {formatDuration(t.duration || 0)}
                        </span>
                      </div>
                    </TrackContextMenu>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
