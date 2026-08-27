"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpLeft,
  Check,
  CirclePlus,
  Play,
  Search,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CoverArt } from "@/components/cover-art";
import { ExplicitBadge } from "@/components/explicit-badge";
import { UserAvatar } from "@/components/user-avatar";
import { albumHref } from "@/lib/album-ref";
import {
  MediaShelfGrid,
  MediaTileShell,
  ShelfHeader,
} from "@/components/media-shelf";
import { TrackActionsDrawer } from "@/components/track-actions-drawer";
import { TrackContextMenu } from "@/components/track-context-menu";
import { TrackRowActions } from "@/components/track-row-actions";
import { usePlayer, type PlayerTrack } from "@/components/player-provider";
import { cn, formatTrackArtistLine, titleLooksExplicit } from "@/lib/utils";
import type { LocalSourceBadge } from "@/lib/track-source-badge";
import { RECENT_PLAYED_CHANGED_EVENT } from "@/lib/ui-events";
import { MobileSearchHeader } from "@/components/mobile-search-header";
import { MobileSaveButton } from "@/components/saved-in-drawer";
import {
  readRecentPlayedTracks,
  removeRecentPlayedTrack,
  type RecentPlayedTrack,
} from "@/lib/recent-searches";

const TOP_PREVIEW = 8;
type SearchScope = "polarr" | "library";
type SearchFilter = "all" | "songs" | "artists" | "albums" | "profiles";

type CatalogTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  image?: string;
  duration?: number;
  localTrackId?: string;
  onPolarr?: boolean;
  localSource?: LocalSourceBadge;
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

type CatalogProfile = {
  id: string;
  username: string;
  avatarUrl: string | null;
  isAdmin?: boolean;
  href: string;
};

type MixedRow =
  | { kind: "track"; hit: CatalogTrack }
  | { kind: "album"; hit: CatalogAlbum }
  | { kind: "artist"; hit: CatalogArtist };

const FILTER_CHIPS: { id: SearchFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "songs", label: "Songs" },
  { id: "artists", label: "Artists" },
  { id: "albums", label: "Albums" },
  { id: "profiles", label: "Profiles" },
];

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

function parseFilter(raw: string | null): SearchFilter {
  if (
    raw === "songs" ||
    raw === "artists" ||
    raw === "albums" ||
    raw === "profiles"
  ) {
    return raw;
  }
  return "all";
}

function mixedRowKey(row: MixedRow) {
  return `${row.kind}:${row.hit.id}`;
}

function CategoryBadge({ label }: { label: string }) {
  return (
    <Badge variant="secondary" className="shrink-0 capitalize">
      {label}
    </Badge>
  );
}

export function SearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { play } = usePlayer();
  const q = searchParams.get("q") || "";
  const view = searchParams.get("view");
  const filter = parseFilter(searchParams.get("filter"));
  const scope: SearchScope =
    searchParams.get("scope") === "library" ? "library" : "polarr";
  const [tracks, setTracks] = useState<CatalogTrack[]>([]);
  const [albums, setAlbums] = useState<CatalogAlbum[]>([]);
  const [artists, setArtists] = useState<CatalogArtist[]>([]);
  const [profiles, setProfiles] = useState<CatalogProfile[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [recentVersion, setRecentVersion] = useState(0);

  const recentItems = useMemo(
    () => readRecentPlayedTracks(),
    [recentVersion, q],
  );

  function bumpRecent() {
    setRecentVersion((v) => v + 1);
  }

  useEffect(() => {
    function onRecentPlayed() {
      bumpRecent();
    }
    window.addEventListener(RECENT_PLAYED_CHANGED_EVENT, onRecentPlayed);
    return () => {
      window.removeEventListener(RECENT_PLAYED_CHANGED_EVENT, onRecentPlayed);
    };
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setTracks([]);
      setAlbums([]);
      setArtists([]);
      setProfiles([]);
      setCatalogError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let gotFull = false;
    setLoading(true);

    function applySearch(
      data: {
        tracks?: CatalogTrack[];
        albums?: CatalogAlbum[];
        artists?: CatalogArtist[];
        profiles?: CatalogProfile[];
        lidarrError?: string | null;
      },
      isFull: boolean,
    ) {
      if (cancelled) return;
      if (!isFull && gotFull) return;
      if (isFull) gotFull = true;
      setTracks(data.tracks || []);
      setAlbums(data.albums || []);
      setArtists(data.artists || []);
      setProfiles(data.profiles || []);
      const hasHits =
        (data.tracks?.length || 0) +
          (data.albums?.length || 0) +
          (data.artists?.length || 0) +
          (data.profiles?.length || 0) >
        0;
      setCatalogError(
        hasHits
          ? null
          : isFull
            ? data.lidarrError || "No matches — try another spelling."
            : null,
      );
      if (hasHits || isFull) setLoading(false);
    }

    const handle = setTimeout(() => {
      void fetch(
        `/api/search?q=${encodeURIComponent(term)}&library=1`,
        { cache: "no-store" },
      )
        .then(async (r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) applySearch(data, false);
        })
        .catch(() => {
          /* full search still coming */
        });

      void fetch(`/api/search?q=${encodeURIComponent(term)}`, {
        cache: "no-store",
      })
        .then(async (r) => {
          if (!r.ok) throw new Error(`Search failed (${r.status})`);
          return r.json();
        })
        .then((data) => applySearch(data, true))
        .catch((err) => {
          if (cancelled || gotFull) return;
          setCatalogError(
            err instanceof Error ? err.message : "Search failed",
          );
          setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q]);

  const scopedTracks = useMemo(() => {
    if (scope === "library") {
      return tracks.filter((t) => t.onPolarr || t.localTrackId);
    }
    return tracks;
  }, [tracks, scope]);

  const scopedAlbums = useMemo(() => {
    if (scope === "library") {
      return albums.filter((a) => a.alreadyInLibrary);
    }
    return albums;
  }, [albums, scope]);

  const scopedArtists = useMemo(() => {
    if (scope === "library") {
      return artists.filter((a) => a.alreadyInLibrary);
    }
    return artists;
  }, [artists, scope]);

  const topResult = useMemo((): MixedRow | null => {
    const term = q.trim().toLowerCase();
    if (!term) return null;

    const exactTrack = scopedTracks.find(
      (t) => t.title.trim().toLowerCase() === term,
    );
    if (exactTrack) return { kind: "track", hit: exactTrack };

    const prefixTrack = scopedTracks.find((t) =>
      t.title.trim().toLowerCase().startsWith(term),
    );
    if (prefixTrack) return { kind: "track", hit: prefixTrack };

    const exactArtist = scopedArtists.find(
      (a) => a.name.trim().toLowerCase() === term,
    );
    if (exactArtist) return { kind: "artist", hit: exactArtist };

    if (scopedTracks[0]) return { kind: "track", hit: scopedTracks[0] };
    if (scopedArtists[0]) return { kind: "artist", hit: scopedArtists[0] };
    if (scopedAlbums[0]) return { kind: "album", hit: scopedAlbums[0] };
    return null;
  }, [q, scopedTracks, scopedArtists, scopedAlbums]);

  const mixedRows = useMemo((): MixedRow[] => {
    const topKey = topResult ? mixedRowKey(topResult) : null;
    const rows: MixedRow[] = [
      ...scopedTracks.map((hit) => ({ kind: "track" as const, hit })),
      ...scopedArtists.map((hit) => ({ kind: "artist" as const, hit })),
      ...scopedAlbums.map((hit) => ({ kind: "album" as const, hit })),
    ];
    return topKey ? rows.filter((r) => mixedRowKey(r) !== topKey) : rows;
  }, [scopedTracks, scopedArtists, scopedAlbums, topResult]);

  /** Query completions that update alongside live results (Spotify-style). */
  const querySuggestions = useMemo(() => {
    const term = q.trim();
    if (term.length < 1) return [] as string[];
    const lower = term.toLowerCase();
    const out: string[] = [];
    const seen = new Set<string>();

    function push(text: string) {
      const t = text.trim().replace(/\s+/g, " ");
      if (!t || t.length < term.length) return;
      const key = t.toLowerCase();
      if (seen.has(key) || key === lower) return;
      if (!key.startsWith(lower) && !key.includes(` ${lower}`)) return;
      seen.add(key);
      out.push(t);
    }

    for (const a of scopedArtists) push(a.name);
    for (const t of scopedTracks) {
      push(t.title);
      push(`${t.title} ${formatTrackArtistLine(t.artist, t.title)}`);
      push(formatTrackArtistLine(t.artist, t.title));
    }
    for (const a of scopedAlbums) {
      push(a.title);
      push(`${a.title} ${a.artist}`);
    }
    return out.slice(0, 5);
  }, [q, scopedArtists, scopedTracks, scopedAlbums]);

  async function playCatalogTrack(hit: CatalogTrack) {
    if (hit.localTrackId) {
      const pt: PlayerTrack = {
        id: hit.localTrackId,
        title: hit.title,
        artist: formatTrackArtistLine(hit.artist, hit.title),
        resolveArtist: hit.artist,
        album: hit.album,
        coverPath: hit.image || null,
        duration: hit.duration,
        quality: "local",
      };
      play(pt, [pt]);
      return;
    }
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
        resolveArtist: hit.artist,
        album: live.track.album || hit.album,
        coverPath: hit.image || live.track.coverPath || null,
        streamUrl: live.streamUrl || live.track.streamUrl,
        quality: live.mode === "library" ? "local" : "youtube",
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
      const cover = hit.image || data?.album?.image || null;
      const albumArtist = data?.album?.artist || hit.artist;
      const albumTitle = data?.album?.title || hit.title;
      const queue: PlayerTrack[] = list.map(
        (t: {
          title: string;
          artists?: string;
          localTrackId?: string | null;
          duration?: number;
        }) => ({
          id:
            t.localTrackId ||
            `stream:${albumArtist.trim().toLowerCase()}|${t.title.trim().toLowerCase()}`,
          title: t.title,
          artist: formatTrackArtistLine(albumArtist, t.title, t.artists),
          resolveArtist: albumArtist,
          album: albumTitle,
          coverPath: cover,
          duration: t.duration || undefined,
          quality: t.localTrackId ? "local" : "youtube",
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
    mixedRows.length === 0 &&
    !topResult &&
    profiles.length === 0;

  function searchHref(extra?: Record<string, string | null>) {
    const qs = new URLSearchParams();
    if (term) qs.set("q", term);
    if (scope === "library") qs.set("scope", "library");
    const nextFilter = extra && "filter" in extra ? extra.filter : filter;
    if (nextFilter && nextFilter !== "all") qs.set("filter", nextFilter);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        if (k === "filter") continue;
        if (v == null) qs.delete(k);
        else qs.set(k, v);
      }
    }
    const s = qs.toString();
    return s ? `/search?${s}` : "/search";
  }

  function removeRecent(key: string) {
    removeRecentPlayedTrack(key);
    bumpRecent();
  }

  function renderFilterChips() {
    if (!term) return null;
    return (
      <div
        className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="Search filters"
      >
        {FILTER_CHIPS.map((chip) => {
          const active = filter === chip.id;
          return (
            <Link
              key={chip.id}
              href={searchHref({ filter: chip.id === "all" ? null : chip.id })}
              role="tab"
              aria-selected={active}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-foreground text-background"
                  : "bg-muted text-foreground hover:bg-muted/80",
              )}
            >
              {chip.label}
            </Link>
          );
        })}
      </div>
    );
  }

  function renderMobileRemoveButton(key: string) {
    return (
      <button
        type="button"
        aria-label="Remove from recent searches"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          removeRecent(key);
        }}
        className="flex size-9 shrink-0 items-center justify-center text-muted-foreground"
      >
        <X className="size-4" strokeWidth={2} />
      </button>
    );
  }

  function renderMobileAlbumSaveIcon(saved: boolean) {
    if (saved) {
      return (
        <span className="flex size-9 shrink-0 items-center justify-center">
          <span className="flex size-6 items-center justify-center rounded-full bg-foreground text-background">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        </span>
      );
    }
    return (
      <span className="flex size-9 shrink-0 items-center justify-center">
        <CirclePlus className="size-6 text-muted-foreground" strokeWidth={1.5} />
      </span>
    );
  }

  function renderPlayControl(
    opts: {
      busy: boolean;
      onPlay: () => void;
      label: string;
      size?: "md" | "lg";
    },
  ) {
    const sizeClass = opts.size === "lg" ? "size-12" : "size-10";
    const iconClass = opts.size === "lg" ? "size-5" : "size-4";
    return (
      <button
        type="button"
        aria-label={opts.label}
        disabled={opts.busy || Boolean(busy)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          opts.onPlay();
        }}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-foreground text-background shadow-md transition-transform hover:scale-105 disabled:opacity-40",
          sizeClass,
        )}
      >
        <Play
          className={cn(iconClass, "translate-x-0.5")}
          fill="currentColor"
        />
      </button>
    );
  }

  function renderTopResultCard(row: MixedRow, compact?: boolean) {
    const artSize = compact ? "size-20" : "size-28";
    const titleClass = compact
      ? "text-xl font-bold leading-tight"
      : "text-2xl font-bold leading-tight tracking-tight sm:text-3xl";

    if (row.kind === "track") {
      const hit = row.hit;
      const explicit = titleLooksExplicit(hit.title);
      const artistLine = formatTrackArtistLine(hit.artist, hit.title);
      const playing = busy === `track:${hit.id}`;
      return (
        <div
          key={`top:${mixedRowKey(row)}`}
          className="flex min-w-0 items-center gap-4 rounded-xl bg-muted/40 p-3 sm:gap-5 sm:p-4"
        >
          <button
            type="button"
            onClick={() => void playCatalogTrack(hit)}
            className="shrink-0 text-left"
            aria-label={`Play ${hit.title}`}
          >
            <CoverArt
              seed={hit.title}
              image={hit.image}
              className={cn(artSize, "rounded-md shadow-md")}
            />
          </button>
          <div className="min-w-0 flex-1">
            <div className={cn("truncate text-foreground", titleClass)}>
              {hit.title}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
              {explicit ? <ExplicitBadge /> : null}
              <span className="truncate">Song · {artistLine}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <MobileSaveButton
              trackId={hit.localTrackId || hit.id}
              artist={hit.artist}
              title={hit.title}
              album={hit.album}
              coverPath={hit.image}
              duration={hit.duration}
              onPolarr={Boolean(hit.onPolarr)}
              alreadyInLibrary={Boolean(hit.onPolarr || hit.localTrackId)}
              onDownload={
                hit.onPolarr || hit.localTrackId
                  ? undefined
                  : () => void playCatalogTrack(hit)
              }
              onSavedChange={bumpRecent}
              size="sm"
              className="text-muted-foreground"
            />
            {renderPlayControl({
              busy: playing || Boolean(busy),
              onPlay: () => void playCatalogTrack(hit),
              label: `Play ${hit.title}`,
              size: "lg",
            })}
          </div>
        </div>
      );
    }

    if (row.kind === "album") {
      const hit = row.hit;
      const href = albumPageHref(hit);
      const playing = busy === `album:${hit.id}`;
      return (
        <div
          key={`top:${mixedRowKey(row)}`}
          className="flex min-w-0 items-center gap-4 rounded-xl bg-muted/40 p-3 sm:gap-5 sm:p-4"
        >
          <button
            type="button"
            onClick={() => router.push(href)}
            className="shrink-0 text-left"
          >
            <CoverArt
              seed={hit.title}
              image={hit.image}
              className={cn(artSize, "rounded-md shadow-md")}
            />
          </button>
          <button
            type="button"
            onClick={() => router.push(href)}
            className="min-w-0 flex-1 text-left"
          >
            <div className={cn("truncate text-foreground", titleClass)}>
              {hit.title}
            </div>
            <div className="mt-1 truncate text-sm text-muted-foreground">
              Album · {hit.artist}
            </div>
          </button>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {renderPlayControl({
              busy: playing || Boolean(busy),
              onPlay: () => void playCatalogAlbum(hit),
              label: `Play ${hit.title}`,
              size: "lg",
            })}
          </div>
        </div>
      );
    }

    const hit = row.hit;
    const href = artistPageHref(hit);
    return (
      <button
        type="button"
        key={`top:${mixedRowKey(row)}`}
        onClick={() => router.push(href)}
        className="flex w-full min-w-0 items-center gap-4 rounded-xl bg-muted/40 p-3 text-left sm:gap-5 sm:p-4"
      >
        <CoverArt
          seed={hit.name}
          image={hit.image}
          className={cn(artSize, "rounded-full shadow-md")}
        />
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-foreground", titleClass)}>
            {hit.name}
          </div>
          <div className="mt-1 truncate text-sm text-muted-foreground">
            Artist
          </div>
        </div>
      </button>
    );
  }

  function renderResultRow(
    row: MixedRow,
    opts?: { mobile?: boolean; showRemove?: string },
  ) {
    const mobile = Boolean(opts?.mobile);
    const pad = mobile ? "py-2.5" : "px-2 py-2.5 sm:px-3";
    const thumb = "size-12 shrink-0";

    if (row.kind === "album") {
      const hit = row.hit;
      const href = albumPageHref(hit);
      return (
        <li key={mixedRowKey(row)}>
          <div className={cn("group/row flex min-w-0 items-center gap-3", pad)}>
            <button
              type="button"
              onClick={() => router.push(href)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <CoverArt
                seed={hit.title}
                image={hit.image}
                className={cn(thumb, "rounded-md")}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{hit.title}</div>
                <div className="truncate text-sm text-muted-foreground">
                  Album · {hit.artist}
                  {hit.year ? ` · ${hit.year}` : ""}
                </div>
              </div>
            </button>
            <CategoryBadge label="Album" />
            {mobile ? (
              renderMobileAlbumSaveIcon(Boolean(hit.alreadyInLibrary))
            ) : (
              <div className="flex shrink-0 items-center gap-1 opacity-80 transition-opacity group-hover/row:opacity-100">
                <TrackRowActions
                  trackId={hit.id}
                  artist={hit.artist}
                  title={hit.title}
                  album={hit.title}
                  coverPath={hit.image}
                  showPolarrBadge={false}
                />
              </div>
            )}
            {opts?.showRemove
              ? renderMobileRemoveButton(opts.showRemove)
              : null}
          </div>
        </li>
      );
    }

    if (row.kind === "artist") {
      const hit = row.hit;
      const href = artistPageHref(hit);
      return (
        <li key={mixedRowKey(row)}>
          <button
            type="button"
            onClick={() => router.push(href)}
            className={cn(
              "group/row flex w-full min-w-0 items-center gap-3 text-left transition-colors hover:bg-muted/30",
              pad,
              !mobile && "rounded-md",
            )}
          >
            <CoverArt
              seed={hit.name}
              image={hit.image}
              className={cn(thumb, "rounded-full")}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{hit.name}</div>
              <div className="truncate text-sm text-muted-foreground">
                Artist
              </div>
            </div>
            <CategoryBadge label="Artist" />
            {opts?.showRemove
              ? renderMobileRemoveButton(opts.showRemove)
              : null}
          </button>
        </li>
      );
    }

    const hit = row.hit;
    const trackId = hit.localTrackId || hit.id;
    const explicit = titleLooksExplicit(hit.title);
    const artistLine = formatTrackArtistLine(hit.artist, hit.title);
    const pt: PlayerTrack = {
      id: trackId,
      title: hit.title,
      artist: artistLine,
      album: hit.album || "",
      coverPath: hit.image,
      duration: hit.duration,
      resolveArtist: hit.artist,
      explicit,
    };

    const body = (
      <div className={cn("group/row flex min-w-0 items-center gap-3", pad)}>
        <button
          type="button"
          onClick={() => void playCatalogTrack(hit)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <CoverArt
            seed={hit.title}
            image={hit.image}
            className={cn(thumb, "rounded-md")}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{hit.title}</div>
            <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
              {explicit ? <ExplicitBadge /> : null}
              <span className="truncate">Song · {artistLine}</span>
            </div>
          </div>
        </button>
        <CategoryBadge label="Song" />
        {mobile ? (
          <>
            {!opts?.showRemove ? (
              <TrackActionsDrawer
                track={pt}
                onPolarr={Boolean(hit.onPolarr)}
                inLibrary={Boolean(hit.onPolarr || hit.localTrackId)}
                onDownload={
                  hit.onPolarr || hit.localTrackId
                    ? undefined
                    : () => void playCatalogTrack(hit)
                }
                onChanged={bumpRecent}
              />
            ) : null}
            <MobileSaveButton
              trackId={trackId}
              artist={hit.artist}
              title={hit.title}
              album={hit.album}
              coverPath={hit.image}
              duration={hit.duration}
              onPolarr={Boolean(hit.onPolarr)}
              alreadyInLibrary={Boolean(hit.onPolarr || hit.localTrackId)}
              onDownload={
                hit.onPolarr || hit.localTrackId
                  ? undefined
                  : () => void playCatalogTrack(hit)
              }
              onSavedChange={bumpRecent}
            />
          </>
        ) : (
          <TrackRowActions
            trackId={trackId}
            artist={hit.artist}
            title={hit.title}
            album={hit.album}
            coverPath={hit.image}
            duration={hit.duration}
            onPolarr={Boolean(hit.onPolarr)}
          />
        )}
        {opts?.showRemove ? renderMobileRemoveButton(opts.showRemove) : null}
      </div>
    );

    if (mobile) {
      return <li key={mixedRowKey(row)}>{body}</li>;
    }

    return (
      <TrackContextMenu key={mixedRowKey(row)} track={pt}>
        <li>{body}</li>
      </TrackContextMenu>
    );
  }

  function renderMobileRecentItem(item: RecentPlayedTrack) {
    return renderResultRow(
      {
        kind: "track",
        hit: {
          id: item.trackId,
          title: item.title,
          artist: item.artist,
          album: item.album || "",
          image: item.image,
          localTrackId: item.localTrackId,
          onPolarr: item.onPolarr,
        },
      },
      { mobile: true, showRemove: item.key },
    );
  }

  function renderProfileRow(hit: CatalogProfile, mobile?: boolean) {
    return (
      <li key={`profile:${hit.id}`}>
        <button
          type="button"
          onClick={() => router.push(hit.href)}
          className={cn(
            "group/row flex w-full min-w-0 items-center gap-3 text-left transition-colors hover:bg-muted/30",
            mobile ? "py-2.5" : "rounded-md px-2 py-2.5 sm:px-3",
          )}
        >
          <UserAvatar
            username={hit.username}
            avatarUrl={hit.avatarUrl}
            textClassName="text-sm"
            className="size-12 shrink-0 rounded-full"
          />
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="truncate font-medium">{hit.username}</div>
            <div className="truncate text-sm text-muted-foreground">
              Profile
            </div>
          </div>
          <CategoryBadge label="Profile" />
        </button>
      </li>
    );
  }

  function applySuggestion(text: string) {
    const qs = new URLSearchParams();
    qs.set("q", text);
    if (scope === "library") qs.set("scope", "library");
    if (filter !== "all") qs.set("filter", filter);
    router.replace(`/search?${qs.toString()}`);
  }

  const filteredSongRows: MixedRow[] = scopedTracks.map((hit) => ({
    kind: "track",
    hit,
  }));
  const filteredAlbumRows: MixedRow[] = scopedAlbums.map((hit) => ({
    kind: "album",
    hit,
  }));
  const filteredArtistRows: MixedRow[] = scopedArtists.map((hit) => ({
    kind: "artist",
    hit,
  }));

  const listForFilter = (): MixedRow[] => {
    if (filter === "songs") return filteredSongRows;
    if (filter === "albums") return filteredAlbumRows;
    if (filter === "artists") return filteredArtistRows;
    return mixedRows;
  };

  const mobileEmpty =
    !loading &&
    term &&
    !topResult &&
    mixedRows.length === 0 &&
    profiles.length === 0 &&
    querySuggestions.length === 0;

  function renderAllResults(mobile: boolean) {
    const rows = listForFilter();
    const showTop = filter === "all" && topResult;
    const showProfiles =
      filter === "all"
        ? profiles.length > 0
        : filter === "profiles"
          ? profiles.length > 0
          : false;
    const profileList =
      filter === "profiles" ? profiles : profiles.slice(0, TOP_PREVIEW);
    const showProfilesAll = filter === "all" && profiles.length > TOP_PREVIEW;

    if (filter === "profiles") {
      return (
        <div className="space-y-3">
          {loading && profiles.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Searching…</p>
          ) : profiles.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              No profiles found.
            </p>
          ) : (
            <ul>{profileList.map((p) => renderProfileRow(p, mobile))}</ul>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-5">
        {showTop ? renderTopResultCard(topResult, mobile) : null}

        {loading && rows.length === 0 && !showTop ? (
          <p className="py-2 text-sm text-muted-foreground">Searching…</p>
        ) : null}

        {rows.length > 0 ? (
          <ul>{rows.map((row) => renderResultRow(row, { mobile }))}</ul>
        ) : !loading && !showTop && filter !== "all" ? (
          <p className="py-2 text-sm text-muted-foreground">No matches.</p>
        ) : null}

        {showProfiles ? (
          <section className="min-w-0 space-y-2">
            {!mobile ? (
              <ShelfHeader
                title="Profiles"
                showSeeAll={showProfilesAll}
                seeAllHref={searchHref({ view: "profiles", filter: null })}
              />
            ) : (
              <h2 className="text-base font-semibold text-foreground">
                Profiles
              </h2>
            )}
            <ul>
              {profileList.map((p) => renderProfileRow(p, mobile))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  const mobileResults = (
    <div>
      {!term ? (
        recentItems.length > 0 ? (
          <section>
            <h2 className="mb-1.5 text-xl font-bold text-foreground">
              Recent searches
            </h2>
            <ul>{recentItems.map((item) => renderMobileRecentItem(item))}</ul>
          </section>
        ) : null
      ) : mobileEmpty ? (
        <p className="py-4 text-sm text-muted-foreground">
          {catalogError || "No matches."}
        </p>
      ) : (
        <div className="space-y-4">
          {renderFilterChips()}
          {querySuggestions.length > 0 && filter === "all" ? (
            <ul className="mb-1">
              {querySuggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => applySuggestion(s)}
                    className="flex w-full items-center gap-3 py-2.5 text-left"
                  >
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted/70">
                      <Search
                        className="size-5 text-muted-foreground"
                        strokeWidth={2}
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
                      {s}
                    </span>
                    <ArrowUpLeft
                      className="size-5 shrink-0 text-muted-foreground"
                      strokeWidth={1.75}
                    />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {renderAllResults(true)}
        </div>
      )}
    </div>
  );

  if (term && view === "top") {
    const allRows: MixedRow[] = topResult
      ? [topResult, ...mixedRows]
      : mixedRows;
    return (
      <div className="min-w-0 space-y-8">
        <div className="flex items-center gap-3">
          <Link
            href={searchHref({ view: null })}
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
        ) : allRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matches.</p>
        ) : (
          <ul className="min-w-0">
            {allRows.map((row) => renderResultRow(row))}
          </ul>
        )}
      </div>
    );
  }

  if (term && view === "profiles") {
    return (
      <div className="min-w-0 space-y-8">
        <div className="flex items-center gap-3">
          <Link
            href={searchHref({ view: null })}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            aria-label="Back to search"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <ShelfHeader title="Profiles" titleAs="h1" />
          </div>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Searching…</p>
        ) : profiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No profiles found.</p>
        ) : (
          <ul className="min-w-0">
            {profiles.map((hit) => renderProfileRow(hit))}
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
            href={searchHref({ view: null, filter: "artists" })}
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

  return (
    <div className="min-w-0">
      <div className="lg:hidden">
        <MobileSearchHeader />
        <div className="pt-2">{mobileResults}</div>
      </div>

      <div className="hidden min-w-0 space-y-6 lg:block">
        {message ? (
          <p className="text-sm text-foreground">{message}</p>
        ) : null}
        {catalogError && empty ? (
          <p className="text-sm text-destructive">{catalogError}</p>
        ) : null}
        {empty && !catalogError ? (
          <p className="text-sm text-muted-foreground">No matches.</p>
        ) : null}
        {loading && term && !topResult && mixedRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Searching…</p>
        ) : null}

        {term ? (
          <div className="space-y-5">
            {renderFilterChips()}
            {renderAllResults(false)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
