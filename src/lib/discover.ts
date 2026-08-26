import { getSettings } from "@/lib/db";
import { pickMoreFromArtists } from "@/lib/artist-catalog";
import { buildHomeArtists } from "@/lib/home-artists";
import { LidarrClient } from "@/lib/lidarr";
import { tasteArtistNames } from "@/lib/made-for";
import {
  expandTasteNeighborhood,
  rankExploreAlbums,
  type ExploreAlbum,
} from "@/lib/explore-recommend";
import {
  browseReleaseGroups,
  browseReleaseGroupsForArtist,
  type MbCatalogRelease,
} from "@/lib/musicbrainz";
import { fetchTrendingAlbums } from "@/lib/trending";
import { resolveArtistPortrait } from "@/lib/artist-portrait";
import { ytDlpAvailable } from "@/lib/fallback-download";
import { TtlCache } from "@/lib/ttl-cache";
import type {
  DiscoverPayload,
  DiscoverReleaseCard,
} from "@/lib/discover-types";

export type { DiscoverPayload, DiscoverReleaseCard };

const DISCOVER_TTL_MS = 10 * 60 * 1000;
const discoverCache = new TtlCache<DiscoverPayload>(DISCOVER_TTL_MS, 48);

type ReleaseCard = DiscoverReleaseCard;

function fromMb(r: MbCatalogRelease): ReleaseCard {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    year: r.year,
    image: r.image,
    foreignAlbumId: r.foreignAlbumId,
    releaseDate: r.releaseDate,
    hasFile: false,
    monitored: false,
  };
}

function mergeByKey(items: ReleaseCard[]): ReleaseCard[] {
  const seen = new Set<string>();
  const out: ReleaseCard[] = [];
  for (const r of items) {
    const key = (r.foreignAlbumId || r.id || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

async function buildDiscoverPayload(
  userId: string | null,
): Promise<DiscoverPayload> {
  const settings = getSettings();
  const client = LidarrClient.fromSettings();

  let lidarrLatest: ReleaseCard[] = [];
  let lidarrArtists: Awaited<ReturnType<LidarrClient["catalogArtists"]>> = [];
  let lidarrError: string | null = null;

  const tasteNames = userId ? tasteArtistNames(userId, 12) : [];

  const [
    mbNew,
    tasteAlbums,
    neighborhood,
    trending,
    lidarrBundle,
    moreFrom,
    fallbackReady,
  ] = await Promise.all([
    browseReleaseGroups(36, { monthsBack: 4 }).catch(() => []),
    (async () => {
      if (tasteNames.length === 0) return [] as MbCatalogRelease[];
      const batches = await Promise.all(
        tasteNames.slice(0, 8).map((name) =>
          browseReleaseGroupsForArtist(name, 6).catch(
            () => [] as MbCatalogRelease[],
          ),
        ),
      );
      return batches.flat();
    })(),
    userId
      ? expandTasteNeighborhood(userId, 8).catch(() => ({
          albums: [] as ExploreAlbum[],
          graph: new Map<string, number>(),
          heardAlbums: new Set<string>(),
        }))
      : Promise.resolve({
          albums: [] as ExploreAlbum[],
          graph: new Map<string, number>(),
          heardAlbums: new Set<string>(),
        }),
    fetchTrendingAlbums(28).catch(() => []),
    (async () => {
      if (!client) return null;
      try {
        const [rel, arts] = await Promise.all([
          client.latestReleases(36, 12),
          client.catalogArtists(48),
        ]);
        return { releases: rel, artists: arts };
      } catch (err) {
        lidarrError =
          err instanceof Error ? err.message : "Lidarr discover failed";
        return null;
      }
    })(),
    pickMoreFromArtists(5).catch(() => []),
    settings.fallbackEnabled
      ? ytDlpAvailable().catch(() => false)
      : Promise.resolve(false),
  ]);

  if (lidarrBundle) {
    lidarrLatest = lidarrBundle.releases;
    lidarrArtists = lidarrBundle.artists;
  }

  const [artists, moreFromFresh] = await Promise.all([
    buildHomeArtists({
      userId,
      limit: 48,
      lidarrArtists,
    }).catch(() => [] as Awaited<ReturnType<typeof buildHomeArtists>>),
    Promise.all(
      moreFrom.map(async (cat) => {
        if (cat.image && /^https?:\/\//i.test(cat.image)) {
          return cat;
        }
        const fresh = await resolveArtistPortrait({
          artist: cat.artist,
        }).catch(() => null);
        return {
          ...cat,
          image: fresh || cat.image,
        };
      }),
    ),
  ]);

  const releases = mergeByKey([
    ...lidarrLatest,
    ...mbNew.map(fromMb),
  ]).sort((a, b) =>
    (b.releaseDate || String(b.year || "")).localeCompare(
      a.releaseDate || String(a.year || ""),
    ),
  );

  const latestKeys = new Set(
    releases.slice(0, 12).map((r) => (r.foreignAlbumId || r.id).toLowerCase()),
  );

  const trendingCards: ReleaseCard[] = trending.map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    year: t.year,
    image: t.image,
    releaseDate: t.releaseDate,
    hasFile: false,
    monitored: false,
    rank: t.rank,
  }));

  const preferencePool = mergeByKey([
    ...neighborhood.albums.map(
      (a): ReleaseCard => ({
        id: a.id,
        title: a.title,
        artist: a.artist,
        year: a.year,
        image: a.image,
        foreignAlbumId: a.foreignAlbumId,
        releaseDate: a.releaseDate,
        hasFile: false,
        monitored: false,
      }),
    ),
    ...tasteAlbums.map(fromMb),
    ...mbNew.map(fromMb),
  ]).filter((r) => !latestKeys.has((r.foreignAlbumId || r.id).toLowerCase()));

  const catalog = rankExploreAlbums({
    userId: userId ?? undefined,
    trending: trendingCards.filter(
      (r) => !latestKeys.has((r.foreignAlbumId || r.id).toLowerCase()),
    ),
    preferencePool,
    graph: neighborhood.graph.size > 0 ? neighborhood.graph : undefined,
    heardAlbums: neighborhood.heardAlbums,
    limit: 36,
  });

  const moreFromDto = moreFromFresh.map((cat) => ({
    artist: cat.artist,
    image: cat.image,
    items: cat.tiles.slice(0, 16).map((tile) => {
      if (tile.kind === "album") {
        return {
          kind: "album" as const,
          id: tile.id,
          title: tile.title,
          subtitle: tile.subtitle,
          artist: tile.artist,
          album: tile.album,
          image: tile.image,
          trackCount: tile.trackCount,
          foreignAlbumId: tile.foreignAlbumId,
          lidarrAlbumId: tile.lidarrAlbumId,
        };
      }
      return {
        kind: tile.kind,
        id: tile.id,
        title: tile.title,
        subtitle: tile.subtitle,
        artist: tile.artist,
        album: tile.album,
        image: tile.image,
        trackId: tile.trackId,
        duration: tile.duration,
        coverPath: tile.coverPath,
      };
    }),
  }));

  return {
    catalog,
    releases: releases.slice(0, 36),
    artists,
    moreFrom: moreFromDto,
    personalized: Boolean(userId && tasteNames.length > 0),
    tracks: [],
    lidarrError,
    fallbackReady: Boolean(fallbackReady),
    streamDefault: fallbackReady ? "fallback" : "library",
  };
}

/**
 * Home / explore feed. Cached ~10m per user so the always-on container
 * serves warm shelves after the first visitor.
 */
export async function getDiscoverFeed(
  userId: string | null,
): Promise<DiscoverPayload> {
  const key = userId || "anon";
  return discoverCache.getOrSet(key, () => buildDiscoverPayload(userId));
}

export function invalidateDiscoverCache(userId?: string | null) {
  if (userId === undefined) {
    discoverCache.invalidate();
    return;
  }
  discoverCache.invalidate(userId || "anon");
}
