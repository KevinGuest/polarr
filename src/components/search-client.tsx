"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CoverArt } from "@/components/cover-art";
import { albumHref } from "@/lib/album-ref";
import {
  MediaShelfGrid,
  MediaShelfRow,
  MediaTileShell,
  ShelfHeader,
} from "@/components/media-shelf";
import { TrackContextMenu } from "@/components/track-context-menu";
import { TrackRowActions } from "@/components/track-row-actions";
import { usePlayer, type PlayerTrack } from "@/components/player-provider";
import { formatTrackArtistLine } from "@/lib/utils";

const TOP_PREVIEW = 8;

type LocalTrack = PlayerTrack & {
  duration: number;
  source: string;
};

type CatalogTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  image?: string;
  duration?: number;
};

type CatalogAlbum = {
  id: string;
  title: string;
  artist: string;
  image?: string;
  year?: number;
  foreignAlbumId?: string;
  lidarrAlbumId?: number;
  alreadyInLibrary?: boolean;
};

type CatalogArtist = {
  id: string;
  name: string;
  image?: string;
  foreignArtistId?: string;
  alreadyInLibrary?: boolean;
};

type CatalogRow =
  | { kind: "track"; hit: CatalogTrack }
  | { kind: "album"; hit: CatalogAlbum };

function albumPageHref(hit: CatalogAlbum) {
  return albumHref({
    title: hit.title,
    artist: hit.artist,
    foreignAlbumId: hit.foreignAlbumId,
    lidarrAlbumId: hit.lidarrAlbumId,
  });
}

function artistPageHref(hit: CatalogArtist) {
  const qs = new URLSearchParams({ name: hit.name });
  if (hit.foreignArtistId) qs.set("foreignArtistId", hit.foreignArtistId);
  if (hit.image) qs.set("image", hit.image);
  return `/artist?${qs.toString()}`;
}

export function SearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { play } = usePlayer();
  const q = searchParams.get("q") || "";
  const view = searchParams.get("view");
  const [local, setLocal] = useState<LocalTrack[]>([]);
  const [tracks, setTracks] = useState<CatalogTrack[]>([]);
  const [albums, setAlbums] = useState<CatalogAlbum[]>([]);
  const [artists, setArtists] = useState<CatalogArtist[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setLocal([]);
      setTracks([]);
      setAlbums([]);
      setArtists([]);
      setCatalogError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      void fetch(`/api/search?q=${encodeURIComponent(term)}`, {
        cache: "no-store",
      })
        .then(async (r) => {
          if (!r.ok) throw new Error(`Search failed (${r.status})`);
          return r.json();
        })
        .then((data) => {
          if (cancelled) return;
          setLocal(data.local || []);
          setTracks(data.tracks || []);
          setAlbums(data.albums || []);
          setArtists(data.artists || []);
          const hasCatalog =
            (data.tracks?.length || 0) +
              (data.albums?.length || 0) +
              (data.artists?.length || 0) >
            0;
          setCatalogError(
            hasCatalog
              ? null
              : data.lidarrError ||
                  "No catalog matches — try another spelling.",
          );
        })
        .catch((err) => {
          if (cancelled) return;
          setLocal([]);
          setTracks([]);
          setAlbums([]);
          setArtists([]);
          setCatalogError(
            err instanceof Error ? err.message : "Search failed",
          );
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q]);

  const catalogRows = useMemo((): CatalogRow[] => {
    return [
      ...tracks.map((hit) => ({ kind: "track" as const, hit })),
      ...albums.map((hit) => ({ kind: "album" as const, hit })),
    ];
  }, [tracks, albums]);

  async function playCatalogTrack(hit: CatalogTrack) {
    setBusy(`track:${hit.id}`);
    setMessage(null);
    try {
      const liveRes = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: hit.title,
          artist: hit.artist,
          album: hit.album,
        }),
      });
      const live = await liveRes.json().catch(() => null);
      if (!liveRes.ok || !live?.track?.id) {
        setMessage(live?.error || "Couldn’t start playback");
        return;
      }
      const pt: PlayerTrack = {
        id: live.track.id,
        title: live.track.title || hit.title,
        artist: formatTrackArtistLine(
          live.track.artist || hit.artist,
          live.track.title || hit.title,
        ),
        album: live.track.album || hit.album,
        coverPath: hit.image || live.track.coverPath || null,
        streamUrl: live.streamUrl || live.track.streamUrl,
      };
      play(pt, [pt]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Playback failed");
    } finally {
      setBusy(null);
    }
  }

  async function playCatalogAlbum(hit: CatalogAlbum) {
    setBusy(`album:${hit.id}`);
    setMessage(null);
    try {
      const qs = new URLSearchParams({
        title: hit.title,
        artist: hit.artist,
      });
      if (hit.foreignAlbumId) qs.set("foreignAlbumId", hit.foreignAlbumId);
      if (hit.lidarrAlbumId != null) {
        qs.set("lidarrAlbumId", String(hit.lidarrAlbumId));
      }
      const res = await fetch(`/api/album?${qs.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      const list = Array.isArray(data?.tracks) ? data.tracks : [];
      if (!res.ok || list.length === 0) {
        setMessage(data?.error || "No tracks to play on this album");
        return;
      }
      const cover =
        hit.image || data?.album?.image || null;
      const albumArtist = data?.album?.artist || hit.artist;
      const albumTitle = data?.album?.title || hit.title;
      const queue: PlayerTrack[] = list.map(
        (t: {
          title: string;
          artists?: string;
          localTrackId?: string | null;
        }) => ({
          id:
            t.localTrackId ||
            `stream:${albumArtist.trim().toLowerCase()}|${t.title.trim().toLowerCase()}`,
          title: t.title,
          artist: t.artists || albumArtist,
          album: albumTitle,
          coverPath: cover,
        }),
      );
      const first = queue[0]!;
      play(first, queue);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Playback failed");
    } finally {
      setBusy(null);
    }
  }

  const term = q.trim();
  const empty =
    !loading &&
    term &&
    local.length === 0 &&
    catalogRows.length === 0 &&
    artists.length === 0;

  function searchHref(extra?: Record<string, string>) {
    const qs = new URLSearchParams();
    if (term) qs.set("q", term);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) qs.set(k, v);
    }
    const s = qs.toString();
    return s ? `/search?${s}` : "/search";
  }

  function renderCatalogRow(row: CatalogRow) {
    if (row.kind === "album") {
      const hit = row.hit;
      const href = albumPageHref(hit);
      const albumTrack: PlayerTrack = {
        id: hit.id,
        title: hit.title,
        artist: hit.artist,
        album: hit.title,
        coverPath: hit.image,
      };
      const playing = busy === `album:${hit.id}`;
      return (
        <TrackContextMenu key={`album:${hit.id}`} track={albumTrack}>
          <li className="group/row flex min-w-0 items-center gap-3 px-4 py-3.5">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden text-left"
              onClick={() => router.push(href)}
            >
              <CoverArt
                seed={hit.title}
                image={hit.image}
                className="size-10 shrink-0 rounded-md"
              />
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{hit.title}</span>
                  <Badge variant="outline" className="shrink-0">
                    album
                  </Badge>
                  {hit.alreadyInLibrary ? (
                    <Badge variant="success" className="shrink-0">
                      in library
                    </Badge>
                  ) : null}
                </div>
                <div className="truncate text-sm text-muted-foreground">
                  {hit.artist}
                  {hit.year ? ` · ${hit.year}` : ""}
                </div>
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-1">
              <TrackRowActions
                trackId={hit.id}
                artist={hit.artist}
                title={hit.title}
                album={hit.title}
                coverPath={hit.image}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={Boolean(busy)}
                onClick={() => void playCatalogAlbum(hit)}
              >
                <Play className="size-4" />
                {playing ? "…" : "Play"}
              </Button>
            </div>
          </li>
        </TrackContextMenu>
      );
    }

    const t = row.hit;
    const pt: PlayerTrack = {
      id: t.id,
      title: t.title,
      artist: t.artist,
      album: t.album,
      coverPath: t.image,
    };
    const playing = busy === `track:${t.id}`;
    return (
      <TrackContextMenu key={`track:${t.id}`} track={pt}>
        <li className="group/row flex min-w-0 items-center gap-3 px-4 py-3.5">
          <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
            {t.album ? (
              <button
                type="button"
                aria-label={`Open album ${t.album}`}
                onClick={() =>
                  router.push(
                    albumHref({
                      title: t.album,
                      artist: t.artist,
                    }),
                  )
                }
                className="shrink-0 rounded-md transition-opacity hover:opacity-90"
              >
                <CoverArt
                  seed={t.title}
                  image={t.image}
                  className="size-10 rounded-md"
                />
              </button>
            ) : (
              <CoverArt
                seed={t.title}
                image={t.image}
                className="size-10 shrink-0 rounded-md"
              />
            )}
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="truncate font-medium">{t.title}</div>
              <div className="truncate text-sm text-muted-foreground">
                {formatTrackArtistLine(t.artist, t.title)}
                {t.album ? ` · ${t.album}` : ""}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <TrackRowActions
              trackId={t.id}
              artist={t.artist}
              title={t.title}
              album={t.album}
              coverPath={t.image}
              duration={t.duration}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={Boolean(busy)}
              onClick={() => void playCatalogTrack(t)}
            >
              <Play className="size-4" />
              {playing ? "…" : "Play"}
            </Button>
          </div>
        </li>
      </TrackContextMenu>
    );
  }

  if (term && view === "top") {
    return (
      <div className="min-w-0 space-y-8">
        <div className="flex items-center gap-3">
          <Link
            href={searchHref()}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            aria-label="Back to search"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <ShelfHeader title="Top results" titleAs="h1" />
          </div>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Searching…</p>
        ) : catalogRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matches.</p>
        ) : (
          <ul className="min-w-0 divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
            {catalogRows.map((row) => renderCatalogRow(row))}
          </ul>
        )}
      </div>
    );
  }

  if (term && view === "artists") {
    return (
      <div className="min-w-0 space-y-8">
        <div className="flex items-center gap-3">
          <Link
            href={searchHref()}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            aria-label="Back to search"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <ShelfHeader title="Artists" titleAs="h1" />
          </div>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Searching…</p>
        ) : artists.length === 0 ? (
          <p className="text-sm text-muted-foreground">No artists found.</p>
        ) : (
          <MediaShelfGrid>
            {artists.map((hit) => (
              <MediaTileShell
                key={hit.id}
                title={hit.name}
                subtitle="Artist"
                ariaLabel={`Open ${hit.name}`}
                onOpen={() => router.push(artistPageHref(hit))}
                coverShape="circle"
                cover={
                  <CoverArt
                    seed={hit.name}
                    image={hit.image}
                    className="size-full rounded-full"
                  />
                }
              />
            ))}
          </MediaShelfGrid>
        )}
      </div>
    );
  }

  const topPreview = catalogRows.slice(0, TOP_PREVIEW);
  const showTopAll = catalogRows.length > TOP_PREVIEW;

  return (
    <div className="min-w-0 space-y-10">
      {term ? null : (
        <section className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Find tracks, albums, and artists.
          </p>
          {message ? (
            <p className="text-sm text-foreground">{message}</p>
          ) : null}
        </section>
      )}
      {term && message ? (
        <p className="text-sm text-foreground">{message}</p>
      ) : null}
      {catalogError && empty ? (
        <p className="text-sm text-destructive">{catalogError}</p>
      ) : null}
      {empty && !catalogError ? (
        <p className="text-sm text-muted-foreground">No matches.</p>
      ) : null}
      {loading && term ? (
        <p className="text-sm text-muted-foreground">Searching…</p>
      ) : null}

      {topPreview.length > 0 ? (
        <section className="min-w-0 space-y-3">
          <ShelfHeader
            title="Top results"
            showSeeAll={showTopAll}
            seeAllHref={searchHref({ view: "top" })}
          />
          <ul className="min-w-0 divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
            {topPreview.map((row) => renderCatalogRow(row))}
          </ul>
        </section>
      ) : null}

      {local.length > 0 ? (
        <section className="min-w-0 space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            On this server
          </h2>
          <ul className="min-w-0 divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
            {local.map((t) => (
              <TrackContextMenu key={t.id} track={t}>
                <li className="group/row flex min-w-0 items-center gap-3 px-4 py-3.5">
                  <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
                    {t.album ? (
                      <button
                        type="button"
                        aria-label={`Open album ${t.album}`}
                        onClick={() =>
                          router.push(
                            albumHref({
                              title: t.album,
                              artist: t.artist,
                            }),
                          )
                        }
                        className="shrink-0 rounded-md transition-opacity hover:opacity-90"
                      >
                        <CoverArt
                          seed={t.title}
                          image={t.coverPath}
                          className="size-10 rounded-md"
                        />
                      </button>
                    ) : (
                      <CoverArt
                        seed={t.title}
                        image={t.coverPath}
                        className="size-10 shrink-0 rounded-md"
                      />
                    )}
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <div className="truncate font-medium">{t.title}</div>
                      <div className="truncate text-sm text-muted-foreground">
                        {formatTrackArtistLine(t.artist, t.title)} · {t.album}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <TrackRowActions
                      trackId={t.id}
                      artist={t.artist}
                      title={t.title}
                      album={t.album}
                      coverPath={t.coverPath}
                      duration={t.duration}
                      inLibrary
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => play(t, [t])}
                    >
                      <Play className="size-4" /> Play
                    </Button>
                  </div>
                </li>
              </TrackContextMenu>
            ))}
          </ul>
        </section>
      ) : null}

      {artists.length > 0 ? (
        <MediaShelfRow
          title="Artists"
          itemCount={artists.length}
          seeAllHref={searchHref({ view: "artists" })}
        >
          {(visible) =>
            artists.slice(0, visible).map((hit) => (
              <MediaTileShell
                key={hit.id}
                title={hit.name}
                subtitle="Artist"
                ariaLabel={`Open ${hit.name}`}
                onOpen={() => router.push(artistPageHref(hit))}
                coverShape="circle"
                cover={
                  <CoverArt
                    seed={hit.name}
                    image={hit.image}
                    className="size-full rounded-full"
                  />
                }
              />
            ))
          }
        </MediaShelfRow>
      ) : null}
    </div>
  );
}
