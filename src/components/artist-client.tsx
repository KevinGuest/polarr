"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Play, Shuffle } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { PopularityIndicator } from "@/components/popularity-indicator";
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
import { cn, formatDuration, formatTrackArtistLine } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

type ArtistTrack = PlayerTrack & {
  duration?: number;
  source?: string;
  primaryArtist?: string;
  popularity?: number;
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
      releaseDate?: string;
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

function shuffleArray<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function albumMeta(tile: Extract<CatalogTile, { kind: "album" }>): string {
  const year = tile.releaseDate?.slice(0, 4);
  return year ? `Album · ${year}` : "Album";
}

function coverUrl(path?: string | null): string | undefined {
  if (path && /^https?:\/\//i.test(path)) return path;
  return undefined;
}

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
  const [popularExpanded, setPopularExpanded] = useState(false);
  const [showStickyTitle, setShowStickyTitle] = useState(false);
  const heroSentinelRef = useRef<HTMLDivElement>(null);
  const discographyRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!name) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setPopularExpanded(false);
    const qs = new URLSearchParams({ name });
    if (foreignArtistId) qs.set("foreignArtistId", foreignArtistId);
    if (imageParam) qs.set("image", imageParam);
    void fetch(`/api/artist?${qs.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setTracks(data.tracks || []);
        setTiles(Array.isArray(data.tiles) ? data.tiles : []);
        setImage(data.image || null);
      })
      .finally(() => setLoading(false));
  }, [name, foreignArtistId, imageParam]);

  useEffect(() => {
    const el = heroSentinelRef.current;
    if (!el || loading) return;
    const obs = new IntersectionObserver(
      ([entry]) => setShowStickyTitle(!entry?.isIntersecting),
      { threshold: 0, rootMargin: "-56px 0px 0px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading, name]);

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

  const statsParts: string[] = [];
  if (albums.length) {
    statsParts.push(`${albums.length} album${albums.length === 1 ? "" : "s"}`);
  }
  if (singles.length) {
    statsParts.push(
      `${singles.length} single${singles.length === 1 ? "" : "s"}`,
    );
  }
  if (features.length) {
    statsParts.push(
      `${features.length} feature${features.length === 1 ? "" : "s"}`,
    );
  }
  if (!statsParts.length && tracks.length) {
    statsParts.push(`${tracks.length} track${tracks.length === 1 ? "" : "s"}`);
  }

  // Spotify/Apple: show top 5; See more expands to top 10 only.
  const popularTracks = popularExpanded
    ? tracks.slice(0, 10)
    : tracks.slice(0, 5);

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

  function playAll() {
    if (!tracks[0]) return;
    play(tracks[0], tracks);
  }

  function playShuffled() {
    if (!tracks.length) return;
    const shuffled = shuffleArray(tracks);
    play(shuffled[0]!, shuffled);
  }

  function openAlbum(a: Extract<CatalogTile, { kind: "album" }>) {
    router.push(
      albumHref({
        title: a.album,
        artist: a.artist,
        foreignAlbumId: a.foreignAlbumId,
        lidarrAlbumId:
          a.lidarrAlbumId != null && a.lidarrAlbumId > 0
            ? a.lidarrAlbumId
            : undefined,
      }),
    );
  }

  function renderPopularRow(t: ArtistTrack, i: number, mobile: boolean) {
    return (
      <li key={t.id}>
        <TrackContextMenu track={t}>
          <div
            draggable
            onDragStart={(e) => setDragTrack(e, t)}
            className={cn(
              "group/row flex w-full cursor-grab items-center gap-3 transition-colors hover:bg-muted/30 active:cursor-grabbing",
              mobile ? "py-2.5" : "px-3 py-2.5",
            )}
          >
            <button
              type="button"
              onClick={() => play(t, tracks)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span
                className={cn(
                  "shrink-0 tabular-nums text-muted-foreground",
                  mobile ? "w-4 text-sm" : "w-5 text-xs",
                )}
              >
                {i + 1}
              </span>
              <CoverArt
                seed={t.title}
                image={coverUrl(t.coverPath)}
                className={cn(
                  "shrink-0 rounded-md",
                  mobile ? "size-12" : "size-10",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{t.title}</div>
                {mobile ? (
                  <div className="mt-1">
                    <PopularityIndicator score={t.popularity ?? 50} />
                  </div>
                ) : (
                  <div className="mt-0.5 flex min-w-0 items-center gap-2">
                    <PopularityIndicator score={t.popularity ?? 50} />
                    <span className="truncate text-xs text-muted-foreground">
                      {formatTrackArtistLine(
                        t.primaryArtist || t.artist,
                        t.title,
                        t.artist !== t.primaryArtist ? t.artist : null,
                      )}
                      {t.album ? ` · ${t.album}` : ""}
                    </span>
                  </div>
                )}
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
            {!mobile ? (
              <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                {formatDuration(t.duration || 0)}
              </span>
            ) : null}
          </div>
        </TrackContextMenu>
      </li>
    );
  }

  return (
    <>
      {/* Mobile — Spotify-style artist page */}
      <div className="lg:hidden">
        <div
          className={cn(
            "fixed inset-x-0 top-0 z-30 flex items-center gap-2 px-3 pb-2.5 pt-[max(0.5rem,var(--safe-top))] transition-colors duration-200",
            showStickyTitle
              ? "border-b border-border/50 bg-background/90 backdrop-blur-md"
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
            {name}
          </h1>
        </div>

        {loading ? (
          <div className="space-y-4 pt-2" aria-busy="true">
            <Skeleton className="aspect-[4/3] w-full max-h-72 rounded-none" />
            <Skeleton className="mx-4 h-10 w-48" />
            <div className="space-y-3 px-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-md" />
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="relative -mx-4 aspect-[4/3] max-h-72 w-[calc(100%+2rem)] overflow-hidden">
              <CoverArt
                seed={name}
                image={image || undefined}
                className="size-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-black/40" />
              <div className="absolute inset-x-0 bottom-0 p-4 pb-5">
                <h1 className="text-[2rem] font-bold leading-tight tracking-tight">
                  {name}
                </h1>
                {statsParts.length ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {statsParts.join(" · ")}
                  </p>
                ) : null}
              </div>
            </div>
            <div ref={heroSentinelRef} className="h-px" aria-hidden />

            {tracks[0] ? (
              <div className="flex items-center justify-end gap-5 px-1 py-4">
                <button
                  type="button"
                  onClick={playShuffled}
                  className="rounded-full p-2 text-muted-foreground hover:text-foreground"
                  aria-label="Shuffle play"
                >
                  <Shuffle className="size-6" />
                </button>
                <button
                  type="button"
                  onClick={playAll}
                  className="flex size-14 items-center justify-center rounded-full bg-foreground text-background shadow-lg transition-opacity hover:opacity-90"
                  aria-label="Play artist"
                >
                  <Play className="size-6 translate-x-0.5" fill="currentColor" />
                </button>
              </div>
            ) : null}

            {tracks.length > 0 ? (
              <section className="mb-8">
                <h2 className="mb-3 px-1 text-2xl font-bold tracking-tight">
                  Popular
                </h2>
                <ul>{popularTracks.map((t, i) => renderPopularRow(t, i, true))}</ul>
                {tracks.length > 5 ? (
                  <button
                    type="button"
                    onClick={() => setPopularExpanded((v) => !v)}
                    className="mx-auto mt-2 block px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    {popularExpanded ? "See less" : "See more"}
                  </button>
                ) : null}
              </section>
            ) : null}

            {albums.length > 0 ? (
              <section className="mb-8">
                <div className="mb-3 flex items-baseline justify-between px-1">
                  <h2 className="text-2xl font-bold tracking-tight">
                    Popular releases
                  </h2>
                </div>
                <ul className="space-y-1">
                  {albums.slice(0, 4).map((a) => {
                    if (a.kind !== "album") return null;
                    return (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => openAlbum(a)}
                          className="flex w-full items-center gap-3 rounded-md px-1 py-2 text-left transition-colors hover:bg-muted/30"
                        >
                          <CoverArt
                            seed={a.title}
                            image={a.image || undefined}
                            className="size-14 shrink-0 rounded-md"
                          />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{a.title}</div>
                            <div className="truncate text-sm text-muted-foreground">
                              {albumMeta(a)}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {albums.length > 4 ? (
                  <button
                    type="button"
                    onClick={() =>
                      discographyRef.current?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      })
                    }
                    className="mx-auto mt-4 block rounded-full border border-border px-5 py-2 text-sm font-semibold"
                  >
                    See discography
                  </button>
                ) : null}
              </section>
            ) : null}

            {albums.length > 0 ? (
              <section ref={discographyRef} className="scroll-mt-4">
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
              </section>
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
            ) : null}

            {tracks.length === 0 && tiles.length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">
                No albums or tracks found for this artist yet.
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* Desktop — existing layout */}
      <div className="hidden space-y-10 lg:block">
        <section className="flex flex-col gap-4 sm:flex-row sm:items-end">
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
              {statsParts.join(" · ") || null}
            </p>
            {tracks[0] ? (
              <button
                type="button"
                onClick={playAll}
                className="mt-2 flex size-12 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90"
                aria-label="Play"
              >
                <Play className="size-5 translate-x-0.5" fill="currentColor" />
              </button>
            ) : null}
          </div>
        </section>

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
                  {popularTracks.map((t, i) => renderPopularRow(t, i, false))}
                </ul>
                {tracks.length > 5 ? (
                  <button
                    type="button"
                    onClick={() => setPopularExpanded((v) => !v)}
                    className="mt-1 px-1 text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    {popularExpanded ? "See less" : "See more"}
                  </button>
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
