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
import { globalSingleton, TtlCache } from "@/lib/ttl-cache";
import type { DiscoverPayload, DiscoverReleaseCard } from "@/lib/discover-types";

export type { DiscoverPayload, DiscoverReleaseCard };

const DISCOVER_TTL_MS = 10 * 60 * 1000;
/** Expired feeds stay servable while a background rebuild runs. */
const DISCOVER_STALE_MS = 24 * 60 * 60 * 1000;
/** A feed built with a source missing is retried sooner. */
const DISCOVER_PARTIAL_TTL_MS = 60 * 1000;
/**
 * No single upstream may hold the feed longer than this. A cold build fans out
 * to Lidarr, MusicBrainz and Deezer; one slow host used to stall the lot.
 */
const SOURCE_BUDGET_MS = 8_000;
const ANON_KEY = "anon";
// Shared across the page, route-handler and instrumentation module graphs —
// each used to hold its own copy and rebuild the same feed (see ttl-cache.ts).
const discoverCache = globalSingleton(
  "discover-feed",
  () => new TtlCache<DiscoverPayload>(DISCOVER_TTL_MS, 48, DISCOVER_STALE_MS),
);

type BuildResult = { payload: DiscoverPayload; partial: boolean };

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

async function buildDiscoverPayload(userId: string | null): Promise<BuildResult> {
  const startedAt = Date.now();
  const timings: string[] = [];
  let partial = false;
  /** Time a source and cap it at the budget, falling back instead of hanging. */
  function source<T>(name: string, work: Promise<T>, fallback: T): Promise<T> {
    const began = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const capped = new Promise<T>((resolve) => {
      timer = setTimeout(() => {
        partial = true;
        timings.push(`${name} timeout`);
        resolve(fallback);
      }, SOURCE_BUDGET_MS);
    });
    return Promise.race([
      work.then((value) => {
        timings.push(`${name} ${Date.now() - began}ms`);
        return value;
      }),
      capped,
    ]).finally(() => clearTimeout(timer));
  }

  const settings = getSettings();
  const client = LidarrClient.fromSettings();

  let lidarrLatest: ReleaseCard[] = [];
  let lidarrArtists: Awaited<ReturnType<LidarrClient["catalogArtists"]>> = [];
  let lidarrError: string | null = null;

  const tasteNames = userId ? tasteArtistNames(userId, 12) : [];

  const [mbNew, tasteAlbums, neighborhood, trending, lidarrBundle, moreFrom, fallbackReady] =
    await Promise.all([
      source(
        "mbNew",
        browseReleaseGroups(36, { monthsBack: 4 }).catch(() => []),
        [],
      ),
      source(
        "tasteAlbums",
        (async () => {
          if (tasteNames.length === 0) return [] as MbCatalogRelease[];
          const batches = await Promise.all(
            tasteNames
              .slice(0, 8)
              .map((name) =>
                browseReleaseGroupsForArtist(name, 6).catch(() => [] as MbCatalogRelease[]),
              ),
          );
          return batches.flat();
        })(),
        [] as MbCatalogRelease[],
      ),
      source(
        "neighborhood",
        userId
          ? expandTasteNeighborhood(userId, 8).catch(emptyNeighborhood)
          : Promise.resolve(emptyNeighborhood()),
        emptyNeighborhood(),
      ),
      source(
        "trending",
        fetchTrendingAlbums(28).catch(() => []),
        [],
      ),
      source(
        "lidarr",
        (async () => {
          if (!client) return null;
          try {
            const [rel, arts] = await Promise.all([
              client.latestReleases(36, 12),
              client.catalogArtists(48),
            ]);
            return { releases: rel, artists: arts };
          } catch (err) {
            lidarrError = err instanceof Error ? err.message : "Lidarr discover failed";
            return null;
          }
        })(),
        null,
      ),
      source(
        "moreFrom",
        pickMoreFromArtists(5).catch(() => []),
        [],
      ),
      source(
        "ytDlp",
        settings.fallbackEnabled ? ytDlpAvailable().catch(() => false) : Promise.resolve(false),
        false,
      ),
    ]);

  if (lidarrBundle) {
    lidarrLatest = lidarrBundle.releases;
    lidarrArtists = lidarrBundle.artists;
  }

  const [artists, moreFromFresh] = await Promise.all([
    source(
      "homeArtists",
      buildHomeArtists({
        userId,
        limit: 48,
        lidarrArtists,
      }).catch(() => [] as Awaited<ReturnType<typeof buildHomeArtists>>),
      [],
    ),
    source(
      "portraits",
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
      moreFrom,
    ),
  ]);

  const releases = mergeByKey([...lidarrLatest, ...mbNew.map(fromMb)]).sort((a, b) =>
    (b.releaseDate || String(b.year || "")).localeCompare(a.releaseDate || String(a.year || "")),
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
    ...neighborhood.albums.map((a): ReleaseCard => ({
      id: a.id,
      title: a.title,
      artist: a.artist,
      year: a.year,
      image: a.image,
      foreignAlbumId: a.foreignAlbumId,
      releaseDate: a.releaseDate,
      hasFile: false,
      monitored: false,
    })),
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

  const elapsed = Date.now() - startedAt;
  if (elapsed > 3_000 || partial) {
    console.info(
      `[polarr] discover build ${elapsed}ms${partial ? " (partial)" : ""} · ${timings.join(" · ")}`,
    );
  }

  const payload: DiscoverPayload = {
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
  return { payload, partial };
}

function emptyNeighborhood() {
  return {
    albums: [] as ExploreAlbum[],
    graph: new Map<string, number>(),
    heardAlbums: new Set<string>(),
  };
}

function rebuild(key: string, userId: string | null): Promise<DiscoverPayload> {
  let partial = false;
  const run = discoverCache.refresh(key, async () => {
    const built = await buildDiscoverPayload(userId);
    partial = built.partial;
    return built.payload;
  });
  // refresh() stores the feed at full TTL; one built with a source missing is
  // re-stored with a short TTL so it is retried soon (still served meanwhile).
  void run
    .then((payload) => {
      if (partial) discoverCache.set(key, payload, DISCOVER_PARTIAL_TTL_MS);
    })
    .catch(() => {});
  return run;
}

/**
 * Home / explore feed. Fresh for ~10m per user; after that the previous feed is
 * returned immediately and rebuilt in the background, so only a user's very
 * first request after a restart ever waits on the upstreams.
 */
export async function getDiscoverFeed(userId: string | null): Promise<DiscoverPayload> {
  const key = userId || ANON_KEY;
  return discoverCache.getOrRevalidate(key, () => rebuild(key, userId));
}

/**
 * Whatever can be painted right now, without waiting: this user's feed (even
 * expired), else the generic feed the boot warmer keeps hot, else null. Starts
 * a background build when the user's own feed is missing or expired.
 *
 * The home page renders with this so its HTML is never held behind Lidarr /
 * MusicBrainz / Deezer; the client then swaps in the personal feed.
 */
export function peekDiscoverFeed(userId: string | null): DiscoverPayload | null {
  const key = userId || ANON_KEY;
  if (discoverCache.get(key) === undefined) {
    void rebuild(key, userId).catch(() => {});
  }
  return discoverCache.getStale(key) ?? discoverCache.getStale(ANON_KEY) ?? null;
}

/** Rebuild a feed now regardless of age (boot / interval warmers). */
export function warmDiscoverFeed(userId: string | null): Promise<DiscoverPayload> {
  const key = userId || ANON_KEY;
  return rebuild(key, userId);
}

export function invalidateDiscoverCache(userId?: string | null) {
  if (userId === undefined) {
    discoverCache.invalidate();
    return;
  }
  discoverCache.invalidate(userId || ANON_KEY);
}
