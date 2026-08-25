import { json } from "@/lib/api";
import {
  findTrack,
  searchPublicProfiles,
  searchTracksLocal,
  type TrackRow,
} from "@/lib/db";
import {
  searchCatalog,
  type CatalogAlbumHit,
  type CatalogArtistHit,
  type CatalogTrackHit,
} from "@/lib/catalog-search";
import { resolveArtistPortrait } from "@/lib/artist-portrait";
import { LidarrClient } from "@/lib/lidarr";
import {
  namesMatch,
  normalizeArtistName,
  primaryArtistName,
  scoreLibrarySearchHit,
  trackMatchKey,
} from "@/lib/track-match";

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

function trackToHit(t: TrackRow): CatalogTrackHit {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    image: t.coverPath || undefined,
    duration: t.duration || undefined,
    localTrackId: t.id,
    onPolarr: true,
  };
}

function albumsFromLocal(tracks: TrackRow[], q: string): CatalogAlbumHit[] {
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
    byKey.set(key, {
      id: `local:album:${key}`,
      title: album,
      artist,
      image: t.coverPath || prev?.image,
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
      hydrated.push({
        ...hit,
        image: hit.image || lib.coverPath || undefined,
        duration: hit.duration || lib.duration || undefined,
        localTrackId: lib.id,
        onPolarr: true,
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
    hydrated.push(trackToHit(t));
  }

  return hydrated.sort(
    (a, b) =>
      scoreLibrarySearchHit(q, b, Boolean(b.onPolarr)) -
      scoreLibrarySearchHit(q, a, Boolean(a.onPolarr)),
  );
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
  const local = searchTracksLocal(q, 48);
  const localAlbums = albumsFromLocal(local, q);
  const localArtists = artistsFromLocal(local);

  if (libraryOnly) {
    return json({
      query: q,
      local,
      tracks: local.map(trackToHit),
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

  const [catalog, lidarrBundle] = await Promise.all([
    withTimeout(
      searchCatalog(q, 30).catch(() => emptyCatalog),
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
  ]);

  const albumByKey = new Map<string, CatalogAlbumHit>();
  for (const a of localAlbums) {
    albumByKey.set(`${a.artist.toLowerCase()}::${a.title.toLowerCase()}`, {
      ...a,
    });
  }
  for (const a of catalog.albums) {
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
  for (const a of catalog.artists) {
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

  const artistsRaw = [...artistByKey.values()];
  const artists = await Promise.all(
    artistsRaw.map(async (a, i) => {
      if (i >= 16) return a;
      const portrait = await resolveArtistPortrait({
        artist: a.name,
        foreignArtistId: a.foreignArtistId,
      }).catch(() => null);
      return portrait ? { ...a, image: portrait } : a;
    }),
  );

  const tracks = hydrateCatalogTracks(catalog.tracks, local, q);
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
