import { json, requireAuth } from "@/lib/api";
import {
  findTrack,
  listTracksByArtist,
  searchPublicProfiles,
  searchTracksByLyrics,
  searchTracksLocal,
  type TrackRow,
} from "@/lib/db";
import {
  searchCatalog,
  type CatalogAlbumHit,
  type CatalogArtistHit,
  type CatalogTrackHit,
} from "@/lib/catalog-search";
import { listTracksFeaturingArtist } from "@/lib/artist-catalog";
import { coverFromMap, getAlbumCoverMap, LidarrClient } from "@/lib/lidarr";
import {
  artistNameMatchesQuery,
  isArtistNameQuery,
  namesMatch,
  normalizeArtistName,
  primaryArtistName,
  scoreArtistSearchHit,
  scoreLibrarySearchHit,
  trackMatchKey,
} from "@/lib/track-match";
import { localSourceBadge } from "@/lib/track-source-badge";
import { searchGeniusTracks } from "@/lib/lyrics/genius";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch(() => {
        clearTimeout(t);
        resolve(fallback);
      });
  });
}

function trackToHit(
  t: TrackRow,
  covers?: Map<string, string>,
): CatalogTrackHit {
  const image = covers
    ? coverFromMap(covers, t.artist, t.album, t.title, t.coverPath) || undefined
    : t.coverPath && /^https?:\/\//i.test(t.coverPath)
      ? t.coverPath
      : undefined;
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    image,
    duration: t.duration || undefined,
    localTrackId: t.id,
    onPolarr: true,
    localSource: localSourceBadge(t.source),
  };
}

function albumsFromLocal(
  tracks: TrackRow[],
  q: string,
  covers?: Map<string, string>,
): CatalogAlbumHit[] {
  const byKey = new Map<string, CatalogAlbumHit & { score: number }>();
  for (const t of tracks) {
    const album = (t.album || "").trim();
    if (!album) continue;
    const artist = primaryArtistName(t.artist) || t.artist;
    const key = `${normalizeArtistName(artist)}::${album.trim().toLowerCase()}`;
    const score = scoreLibrarySearchHit(
      q,
      { title: album, artist, album },
      true,
    );
    const prev = byKey.get(key);
    if (prev && prev.score >= score) continue;
    const image =
      (covers
        ? coverFromMap(covers, t.artist, t.album, t.title, t.coverPath)
        : null) ||
      (t.coverPath && /^https?:\/\//i.test(t.coverPath) ? t.coverPath : null) ||
      prev?.image;
    byKey.set(key, {
      id: `local:album:${key}`,
      title: album,
      artist,
      image: image || undefined,
      alreadyInLibrary: true,
      score,
    });
  }
  return [...byKey.values()]
    .filter((a) => a.score >= 80 || namesMatch(a.artist, q))
    .sort((a, b) => b.score - a.score)
    .map(({ score: _s, ...hit }) => hit);
}

function artistsFromLocal(tracks: TrackRow[]): CatalogArtistHit[] {
  const byKey = new Map<string, CatalogArtistHit>();
  for (const t of tracks) {
    const name = primaryArtistName(t.artist) || t.artist;
    const key = normalizeArtistName(name);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, {
      id: `local:artist:${key}`,
      name,
      alreadyInLibrary: true,
    });
  }
  return [...byKey.values()];
}

function hydrateCatalogTracks(
  catalog: CatalogTrackHit[],
  local: TrackRow[],
  q: string,
  covers?: Map<string, string>,
  artistName?: string,
): CatalogTrackHit[] {
  const byKey = new Map<string, TrackRow>();
  for (const t of local) {
    const k = trackMatchKey(t.artist, t.title);
    if (k && !byKey.has(k)) byKey.set(k, t);
  }

  const seen = new Set<string>();
  const hydrated: CatalogTrackHit[] = [];

  for (const hit of catalog) {
    const k = trackMatchKey(hit.artist, hit.title);
    const lib = (k && byKey.get(k)) || findTrack(hit.artist, hit.title);
    if (lib) {
      const lk = trackMatchKey(lib.artist, lib.title) || k || hit.id;
      if (seen.has(lk)) continue;
      seen.add(lk);
      const libCover = covers
        ? coverFromMap(covers, lib.artist, lib.album, lib.title, lib.coverPath)
        : lib.coverPath && /^https?:\/\//i.test(lib.coverPath)
          ? lib.coverPath
          : null;
      hydrated.push({
        ...hit,
        image: hit.image || libCover || undefined,
        duration: hit.duration || lib.duration || undefined,
        localTrackId: lib.id,
        onPolarr: true,
        localSource: localSourceBadge(lib.source),
      });
      continue;
    }
    const uniq = k || hit.id;
    if (seen.has(uniq)) continue;
    seen.add(uniq);
    hydrated.push({ ...hit, onPolarr: false });
  }

  for (const t of local) {
    const k = trackMatchKey(t.artist, t.title);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    else if (seen.has(t.id)) continue;
    else seen.add(t.id);
    hydrated.push(trackToHit(t, covers));
  }

  return hydrated.sort((a, b) => {
    if (artistName) {
      const d =
        scoreArtistSearchHit(artistName, b, Boolean(b.onPolarr)) -
        scoreArtistSearchHit(artistName, a, Boolean(a.onPolarr));
      if (d) return d;
    }
    return (
      scoreLibrarySearchHit(q, b, Boolean(b.onPolarr)) -
      scoreLibrarySearchHit(q, a, Boolean(a.onPolarr))
    );
  });
}

function markAlbumsInLibrary(
  albums: CatalogAlbumHit[],
  local: TrackRow[],
): CatalogAlbumHit[] {
  const keys = new Set(
    local.map(
      (t) =>
        `${normalizeArtistName(primaryArtistName(t.artist) || t.artist)}::${(t.album || "").trim().toLowerCase()}`,
    ),
  );
  return albums.map((a) => {
    const key = `${normalizeArtistName(a.artist)}::${a.title.trim().toLowerCase()}`;
    if (a.alreadyInLibrary || keys.has(key)) {
      return { ...a, alreadyInLibrary: true };
    }
    return a;
  });
}

function mergeLocalTracks(...groups: TrackRow[][]): TrackRow[] {
  const byId = new Map<string, TrackRow>();
  for (const group of groups) {
    for (const t of group) {
      if (!byId.has(t.id)) byId.set(t.id, t);
    }
  }
  return [...byId.values()];
}

function rankArtists(
  artists: CatalogArtistHit[],
  q: string,
): CatalogArtistHit[] {
  return [...artists].sort((a, b) => {
    const ae = artistNameMatchesQuery(a.name, q) ? 1 : 0;
    const be = artistNameMatchesQuery(b.name, q) ? 1 : 0;
    if (ae !== be) return be - ae;
    return Number(Boolean(b.image)) - Number(Boolean(a.image));
  });
}

function localHitsForArtistQuery(q: string, already: TrackRow[]): TrackRow[] {
  if (!isArtistNameQuery(q)) return already;
  return mergeLocalTracks(
    already,
    listTracksByArtist(q, 48),
    listTracksFeaturingArtist(q, 24),
  );
}

function profileHits(q: string) {
  return searchPublicProfiles(q, 12).map((u) => ({
    id: u.publicId,
    username: u.username,
    avatarUrl: u.avatarUrl,
    isAdmin: u.isAdmin,
    href: `/u/${encodeURIComponent(u.username)}`,
  }));
}

/**
 * Search: local library first, then catalog.
 * `?library=1` returns on-disk hits immediately so the UI can paint files
 * without waiting on Deezer/iTunes.
 */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const libraryOnly = searchParams.get("library") === "1";
  if (!q) {
    return json({
      local: [],
      tracks: [],
      albums: [],
      artists: [],
      profiles: [],
      lidarr: [],
    });
  }

  const profiles = profileHits(q);
  const local = localHitsForArtistQuery(
    q,
    mergeLocalTracks(searchTracksLocal(q, 48), searchTracksByLyrics(q, 24)),
  );
  const covers = await getAlbumCoverMap();
  const localAlbums = albumsFromLocal(local, q, covers);
  const localArtists = rankArtists(artistsFromLocal(local), q);

  if (libraryOnly) {
    const artistName = localArtists.find((a) =>
      artistNameMatchesQuery(a.name, q),
    )?.name;
    const localTracks = local.map((t) => trackToHit(t, covers));
    if (artistName) {
      localTracks.sort(
        (a, b) =>
          scoreArtistSearchHit(artistName, b, true) -
          scoreArtistSearchHit(artistName, a, true),
      );
    }
    return json({
      query: q,
      local,
      tracks: localTracks,
      albums: localAlbums,
      artists: localArtists,
      profiles,
      lidarr: [],
    });
  }

  const emptyCatalog = {
    tracks: [] as CatalogTrackHit[],
    albums: [] as CatalogAlbumHit[],
    artists: [] as CatalogArtistHit[],
  };
  const emptyLidarr = {
    hits: [] as Awaited<ReturnType<LidarrClient["lookup"]>>,
    error: null as string | null,
  };

  const lyricStyle = q.split(/\s+/).filter(Boolean).length >= 3;

  const [catalog, lidarrBundle, geniusTracks] = await Promise.all([
    withTimeout(
      searchCatalog(q, isArtistNameQuery(q) ? 40 : 30).catch(() => emptyCatalog),
      2500,
      emptyCatalog,
    ),
    withTimeout(
      (async () => {
        try {
          const client = LidarrClient.fromSettings();
          if (!client) return emptyLidarr;
          const hits = await client.lookup(q);
          return { hits, error: null as string | null };
        } catch (err) {
          return {
            hits: [] as Awaited<ReturnType<LidarrClient["lookup"]>>,
            error: err instanceof Error ? err.message : "Lidarr search failed",
          };
        }
      })(),
      2500,
      emptyLidarr,
    ),
    lyricStyle
      ? withTimeout(searchGeniusTracks(q, 15).catch(() => []), 2200, [])
      : Promise.resolve([] as Awaited<ReturnType<typeof searchGeniusTracks>>),
  ]);

  const geniusCatalog: CatalogTrackHit[] = geniusTracks.map((g) => ({
    id: g.id,
    title: g.title,
    artist: g.artist,
    album: g.title,
    onPolarr: false,
  }));
  const catalogMerged = {
    tracks: [...geniusCatalog, ...catalog.tracks],
    albums: catalog.albums,
    artists: catalog.artists,
  };

  const albumByKey = new Map<string, CatalogAlbumHit>();
  for (const a of localAlbums) {
    albumByKey.set(`${a.artist.toLowerCase()}::${a.title.toLowerCase()}`, {
      ...a,
    });
  }
  for (const a of catalogMerged.albums) {
    const key = `${a.artist.toLowerCase()}::${a.title.toLowerCase()}`;
    const prev = albumByKey.get(key);
    albumByKey.set(key, {
      ...a,
      image: a.image || prev?.image,
      alreadyInLibrary: a.alreadyInLibrary || prev?.alreadyInLibrary,
      foreignAlbumId: a.foreignAlbumId || prev?.foreignAlbumId,
      lidarrAlbumId: a.lidarrAlbumId ?? prev?.lidarrAlbumId,
    });
  }
  for (const hit of lidarrBundle.hits) {
    if (hit.type !== "album") continue;
    const key = `${hit.artist.toLowerCase()}::${hit.title.toLowerCase()}`;
    const prev = albumByKey.get(key);
    albumByKey.set(key, {
      id: prev?.id || hit.foreignId || `lidarr:album:${key}`,
      title: hit.title,
      artist: hit.artist,
      image: prev?.image || hit.image,
      year: prev?.year,
      foreignAlbumId: hit.foreignId || prev?.foreignAlbumId,
      lidarrAlbumId:
        hit.lidarrId != null && hit.lidarrId > 0
          ? hit.lidarrId
          : prev?.lidarrAlbumId,
      alreadyInLibrary: hit.alreadyInLibrary || prev?.alreadyInLibrary,
    });
  }

  const artistByKey = new Map<string, CatalogArtistHit>();
  for (const a of localArtists) {
    artistByKey.set(a.name.toLowerCase(), { ...a });
  }
  for (const a of catalogMerged.artists) {
    const key = a.name.toLowerCase();
    const prev = artistByKey.get(key);
    artistByKey.set(key, {
      ...a,
      image: a.image || prev?.image,
      alreadyInLibrary: a.alreadyInLibrary || prev?.alreadyInLibrary,
      foreignArtistId: a.foreignArtistId || prev?.foreignArtistId,
    });
  }
  for (const hit of lidarrBundle.hits) {
    if (hit.type !== "artist") continue;
    const name = hit.artist || hit.title;
    const key = name.toLowerCase();
    const prev = artistByKey.get(key);
    artistByKey.set(key, {
      id: prev?.id || hit.foreignId || `lidarr:artist:${key}`,
      name,
      image: prev?.image || hit.image,
      foreignArtistId: hit.foreignId || prev?.foreignArtistId,
      alreadyInLibrary: hit.alreadyInLibrary || prev?.alreadyInLibrary,
    });
  }

  const artists = rankArtists(
    [...artistByKey.values()].map((a) => ({ ...a })),
    q,
  );
  const matchedArtistName = artists.find((a) =>
    artistNameMatchesQuery(a.name, q),
  )?.name;

  const tracks = hydrateCatalogTracks(
    catalogMerged.tracks,
    local,
    q,
    covers,
    matchedArtistName,
  );
  const albums = markAlbumsInLibrary([...albumByKey.values()], local).sort(
    (a, b) => Number(Boolean(b.alreadyInLibrary)) - Number(Boolean(a.alreadyInLibrary)),
  );

  return json({
    query: q,
    local,
    tracks,
    albums,
    artists,
    profiles,
    /** @deprecated use albums/artists */
    lidarr: lidarrBundle.hits,
    lidarrError: lidarrBundle.error,
  });
}
