import { json } from "@/lib/api";
import { searchTracksLocal } from "@/lib/db";
import {
  searchCatalog,
  type CatalogAlbumHit,
  type CatalogArtistHit,
} from "@/lib/catalog-search";
import { resolveArtistPortrait } from "@/lib/artist-portrait";
import { LidarrClient } from "@/lib/lidarr";

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

/**
 * Search: local library + multi-source catalog (tracks first).
 * Lidarr is optional enrichment with a short timeout so it never blocks track results.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  if (!q) {
    return json({
      local: [],
      tracks: [],
      albums: [],
      artists: [],
      lidarr: [],
    });
  }

  const local = searchTracksLocal(q, 40);

  const emptyLidarr = {
    hits: [] as Awaited<ReturnType<LidarrClient["lookup"]>>,
    error: null as string | null,
  };

  const [catalog, lidarrBundle] = await Promise.all([
    searchCatalog(q, 30).catch(() => ({
      tracks: [],
      albums: [] as CatalogAlbumHit[],
      artists: [] as CatalogArtistHit[],
    })),
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
  for (const a of catalog.albums) {
    albumByKey.set(`${a.artist.toLowerCase()}::${a.title.toLowerCase()}`, {
      ...a,
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
  for (const a of catalog.artists) {
    artistByKey.set(a.name.toLowerCase(), { ...a });
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

  // Prefer strict Deezer/Lidarr portraits over catalog thumbnails
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

  return json({
    query: q,
    local,
    tracks: catalog.tracks,
    albums: [...albumByKey.values()],
    artists,
    /** @deprecated use albums/artists */
    lidarr: lidarrBundle.hits,
    lidarrError: lidarrBundle.error,
  });
}
