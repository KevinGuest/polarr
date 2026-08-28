import { json, requireAuth } from "@/lib/api";
import {
  fetchArtistPopularTracks,
  hydratePopularWithLibrary,
} from "@/lib/artist-popularity";
import { buildArtistCatalog } from "@/lib/artist-catalog";
import { resolveArtistPortrait } from "@/lib/artist-portrait";
import {
  artistCoverKey,
  coverFrom,
  getArtistCoverMap,
  LidarrClient,
  resolveTrackCover,
  type LidarrAlbum,
} from "@/lib/lidarr";
import { formatTrackArtistLine } from "@/lib/utils";

export const dynamic = "force-dynamic";

function artistMatches(
  album: LidarrAlbum,
  key: string,
  foreignArtistId?: string,
): boolean {
  if (
    foreignArtistId &&
    album.artist?.foreignArtistId &&
    album.artist.foreignArtistId === foreignArtistId
  ) {
    return true;
  }
  const name = (album.artist?.artistName || "").trim().toLowerCase();
  if (!name) return false;
  return name === key || name.includes(key) || key.includes(name);
}

/** Browse-only discography: Lidarr album lookup, never request/monitor. */
async function lookupDiscography(
  client: LidarrClient,
  artist: string,
  foreignArtistId?: string,
): Promise<LidarrAlbum[]> {
  const term = foreignArtistId
    ? `lidarr:${foreignArtistId}`
    : artist;
  let hits = await client.searchAlbums(term).catch(() => [] as LidarrAlbum[]);
  if (hits.length === 0 && foreignArtistId) {
    hits = await client.searchAlbums(artist).catch(() => [] as LidarrAlbum[]);
  }
  const key = artist.trim().toLowerCase();
  const filtered = hits.filter((a) =>
    artistMatches(a, key, foreignArtistId),
  );
  // Dedup by foreign id / title
  const seen = new Set<string>();
  const out: LidarrAlbum[] = [];
  for (const a of filtered.length ? filtered : hits) {
    const id =
      (a.foreignAlbumId || "").toLowerCase() ||
      `${(a.artist?.artistName || "").toLowerCase()}::${(a.title || "").toLowerCase()}`;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(a);
  }
  return out;
}

export async function GET(req: Request) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  const url = new URL(req.url);
  const artist = (url.searchParams.get("name") || "").trim();
  const foreignFromQuery = (
    url.searchParams.get("foreignArtistId") || ""
  ).trim();
  const imageHint = (url.searchParams.get("image") || "").trim();
  if (!artist) return json({ error: "name required" }, { status: 400 });

  const key = artist.trim().toLowerCase();
  const client = LidarrClient.fromSettings();
  let lidarrAlbums: LidarrAlbum[] = [];
  let foreignArtistId: string | undefined = foreignFromQuery || undefined;

  if (client) {
    const [albums, artists] = await Promise.all([
      client.listAlbums().catch(() => [] as LidarrAlbum[]),
      client.listArtists().catch(() => []),
    ]);
    const match = artists.find((a) => {
      if (
        foreignArtistId &&
        a.foreignArtistId &&
        a.foreignArtistId === foreignArtistId
      ) {
        return true;
      }
      return (a.artistName || "").trim().toLowerCase() === key;
    });
    if (!foreignArtistId) foreignArtistId = match?.foreignArtistId;
    const artistId = match?.id;
    const libraryAlbums = albums.filter((a) => {
      const name = (a.artist?.artistName || "").trim().toLowerCase();
      if (name === key) return true;
      return artistId != null && a.artistId === artistId;
    });

    // Always browse full discography via lookup; never request/monitor.
    const lookedUp = await lookupDiscography(
      client,
      artist,
      foreignArtistId,
    );
    const byKey = new Map<string, LidarrAlbum>();
    for (const a of lookedUp) {
      const id =
        (a.foreignAlbumId || "").toLowerCase() ||
        `${(a.title || "").toLowerCase()}`;
      if (id) byKey.set(id, a);
    }
    for (const a of libraryAlbums) {
      const id =
        (a.foreignAlbumId || "").toLowerCase() ||
        `${(a.title || "").toLowerCase()}`;
      if (id) byKey.set(id, a); // library wins (real ids, stats)
    }
    lidarrAlbums = [...byKey.values()];

    // Prefer canonical MBID from artist lookup when missing
    if (!match && !foreignArtistId) {
      const artistHits = await client
        .searchArtists(artist)
        .catch(() => []);
      const best =
        artistHits.find(
          (a) => (a.artistName || "").trim().toLowerCase() === key,
        ) || artistHits[0];
      if (best?.foreignArtistId) foreignArtistId = best.foreignArtistId;
    }
  }

  const artistCovers = await getArtistCoverMap();
  // Prefer Deezer (fresher) over Lidarr MediaCover posters
  const [fresh, chartPopular] = await Promise.all([
    resolveArtistPortrait({
      artist,
      foreignArtistId,
    }).catch(() => null),
    fetchArtistPopularTracks(artist, 10).catch(() => []),
  ]);
  let artistImage =
    fresh ||
    imageHint ||
    (foreignArtistId
      ? artistCovers.get(`mbid:${foreignArtistId}`)
      : null) ||
    artistCovers.get(artistCoverKey(artist)) ||
    null;

  if (!artistImage && client && foreignArtistId) {
    const artistHits = await client
      .searchArtists(`lidarr:${foreignArtistId}`)
      .catch(() => []);
    const hit =
      artistHits.find((a) => a.foreignArtistId === foreignArtistId) ||
      artistHits[0];
    artistImage = coverFrom(hit?.images) || artistImage;
  }

  const catalog = buildArtistCatalog(artist, {
    lidarrAlbums,
    artistImage,
  });

  const coverJobs: {
    id: string;
    coverPath: string | null;
    artist: string;
    album?: string;
  }[] = catalog.tracks.slice(0, 24).map((t) => ({
    id: t.id,
    coverPath: t.coverPath,
    artist: t.artist,
    album: t.album,
  }));

  for (const f of catalog.features) {
    if (f.kind === "album") continue;
    if (coverJobs.some((c) => c.id === f.trackId)) continue;
    coverJobs.push({
      id: f.trackId,
      coverPath: f.coverPath ?? null,
      artist: f.artist,
      album: f.album,
    });
  }

  const popularHydrated = hydratePopularWithLibrary(chartPopular, artist);
  for (const t of popularHydrated) {
    if (coverJobs.some((c) => c.id === t.id)) continue;
    coverJobs.push({
      id: t.id,
      coverPath: t.coverPath,
      artist: t.artist,
      album: t.album,
    });
  }

  const covers = await Promise.all(
    coverJobs.map(async (t) => ({
      id: t.id,
      coverUrl: await resolveTrackCover({
        coverPath: t.coverPath,
        artist: t.artist,
        album: t.album || "",
      }),
    })),
  );
  const coverById = new Map(covers.map((c) => [c.id, c.coverUrl]));

  const tiles = catalog.tiles.map((tile) => {
    if (tile.kind === "album") {
      const sample = catalog.tracks.find(
        (t) => (t.album || "").trim() === tile.album,
      );
      const img =
        (tile.image &&
        (/^https?:\/\//i.test(tile.image) || tile.image.startsWith("/api/"))
          ? tile.image
          : sample
            ? coverById.get(sample.id)
            : undefined) || tile.image;
      return { ...tile, image: img };
    }
    const img =
      (tile.image &&
      (/^https?:\/\//i.test(tile.image) || tile.image.startsWith("/api/"))
        ? tile.image
        : coverById.get(tile.trackId)) || tile.image;
    return { ...tile, image: img, coverPath: img };
  });

  return json({
    artist,
    foreignArtistId: foreignArtistId || null,
    image:
      (catalog.image &&
      (/^https?:\/\//i.test(catalog.image) ||
        catalog.image.startsWith("/api/"))
        ? catalog.image
        : coverById.get(catalog.tracks[0]?.id || "")) || catalog.image,
    albums: catalog.albums.map((tile) => {
      if (tile.kind !== "album") return tile;
      const match = tiles.find((t) => t.id === tile.id);
      return match || tile;
    }),
    singles: catalog.singles.map((tile) => {
      const match = tiles.find((t) => t.id === tile.id);
      return match || tile;
    }),
    features: catalog.features,
    tiles,
    // Spotify/Apple-style Popular: external chart top 10 only (not local library ranked).
    tracks: popularHydrated.map((t) => ({
      id: t.id,
      title: t.title,
      artist: formatTrackArtistLine(t.artist, t.title),
      primaryArtist: t.primaryArtist,
      album: t.album,
      duration: t.duration,
      coverPath:
        (t.coverPath && /^https?:\/\//i.test(t.coverPath)
          ? t.coverPath
          : null) ||
        coverById.get(t.id) ||
        t.coverPath,
      source: t.source,
      popularity: t.popularity,
    })),
  });
}
