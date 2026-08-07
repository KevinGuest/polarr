import { json, getAuthUser } from "@/lib/api";
import { getSettings } from "@/lib/db";
import { pickMoreFromArtists } from "@/lib/artist-catalog";
import { buildHomeArtists } from "@/lib/home-artists";
import { LidarrClient } from "@/lib/lidarr";
import {
  blendTrendingWithTaste,
  tasteArtistNames,
} from "@/lib/made-for";
import {
  browseReleaseGroups,
  browseReleaseGroupsForArtist,
  type MbCatalogRelease,
} from "@/lib/musicbrainz";
import { fetchTrendingAlbums } from "@/lib/trending";
import { resolveArtistPortrait } from "@/lib/artist-portrait";
import { ytDlpAvailable } from "@/lib/fallback-download";

export const dynamic = "force-dynamic";

type ReleaseCard = {
  id: string;
  title: string;
  artist: string;
  year?: number;
  image?: string;
  foreignAlbumId?: string;
  releaseDate?: string;
  hasFile: boolean;
  monitored: boolean;
  lidarrAlbumId?: number;
  rank?: number;
};

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

/**
 * Home feed: Latest (anything new) → Explore (trending + taste) → artists.
 */
export async function GET() {
  const settings = getSettings();
  const user = await getAuthUser();
  const client = LidarrClient.fromSettings();

  let lidarrLatest: ReleaseCard[] = [];
  let lidarrArtists: Awaited<ReturnType<LidarrClient["catalogArtists"]>> = [];
  let lidarrError: string | null = null;

  const tasteNames = user ? tasteArtistNames(user.id, 6) : [];

  const [
    mbNew,
    tasteAlbums,
    trending,
    lidarrBundle,
    moreFrom,
    fallbackReady,
  ] = await Promise.all([
    browseReleaseGroups(36, { monthsBack: 4 }).catch(() => []),
    (async () => {
      if (tasteNames.length === 0) return [] as MbCatalogRelease[];
      const batches = await Promise.all(
        tasteNames.slice(0, 5).map((name) =>
          browseReleaseGroupsForArtist(name, 5).catch(
            () => [] as MbCatalogRelease[],
          ),
        ),
      );
      return batches.flat();
    })(),
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
    pickMoreFromArtists(3).catch(() => []),
    settings.fallbackEnabled
      ? ytDlpAvailable().catch(() => false)
      : Promise.resolve(false),
  ]);

  if (lidarrBundle) {
    lidarrLatest = lidarrBundle.releases;
    lidarrArtists = lidarrBundle.artists;
  }

  const artists = await buildHomeArtists({
    userId: user?.id,
    limit: 24,
    lidarrArtists,
  }).catch(() => [] as Awaited<ReturnType<typeof buildHomeArtists>>);

  const moreFromFresh = await Promise.all(
    moreFrom.map(async (cat) => {
      const fresh = await resolveArtistPortrait({
        artist: cat.artist,
      }).catch(() => null);
      return {
        ...cat,
        image: fresh || cat.image,
      };
    }),
  );

  // Latest = anything new (Lidarr window + fresh MusicBrainz), date-sorted
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

  // Explore = charts (trending) blended with preference pool
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
    ...tasteAlbums.map(fromMb),
    ...mbNew.map(fromMb),
  ]).filter((r) => !latestKeys.has((r.foreignAlbumId || r.id).toLowerCase()));

  const catalog = blendTrendingWithTaste(
    user?.id,
    trendingCards.filter(
      (r) => !latestKeys.has((r.foreignAlbumId || r.id).toLowerCase()),
    ),
    preferencePool,
    28,
  );

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

  return json({
    catalog,
    releases: releases.slice(0, 36),
    artists,
    moreFrom: moreFromDto,
    personalized: Boolean(user && tasteNames.length > 0),
    /** @deprecated prefer moreFrom — kept empty for older clients */
    tracks: [],
    lidarrError,
    fallbackReady: Boolean(fallbackReady),
    streamDefault: fallbackReady ? "fallback" : "library",
  });
}
