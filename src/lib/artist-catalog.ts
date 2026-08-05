/**
 * Artist discography for home “More from …” shelves and the artist page.
 * Albums (Lidarr + library), singles (orphan / 1-track), and featured appearances.
 */

import { listTracks, listTracksByArtist, type TrackRow } from "@/lib/db";
import {
  artistCoverKey,
  coverFrom,
  getArtistCoverMap,
  LidarrClient,
  type LidarrAlbum,
  type LidarrArtist,
} from "@/lib/lidarr";
import {
  extractFeaturedArtists,
  formatTrackArtistLine,
} from "@/lib/utils";

export type CatalogTile =
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

export type ArtistCatalog = {
  artist: string;
  image?: string | null;
  albums: CatalogTile[];
  singles: CatalogTile[];
  features: CatalogTile[];
  /** Albums + singles + features, albums first. */
  tiles: CatalogTile[];
  tracks: TrackRow[];
};

function artistKey(name: string): string {
  return name.trim().toLowerCase();
}

function namesMatch(a: string, b: string): boolean {
  const left = artistKey(a);
  const right = artistKey(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function isSingleAlbum(album: string | undefined, trackTitle: string): boolean {
  const a = (album || "").trim();
  if (!a) return true;
  const lower = a.toLowerCase();
  if (
    lower === "unknown" ||
    lower === "unknown album" ||
    lower === "singles" ||
    lower === "single" ||
    lower === "non-album tracks"
  ) {
    return true;
  }
  return lower === trackTitle.trim().toLowerCase();
}

/** Tracks where this artist is credited as a featured guest. */
export function listTracksFeaturingArtist(
  artist: string,
  limit = 40,
): TrackRow[] {
  const target = artist.trim();
  if (!target) return [];
  const primary = artistKey(target);
  const out: TrackRow[] = [];
  for (const t of listTracks(500)) {
    if (artistKey(t.artist) === primary) continue;
    const feats = extractFeaturedArtists(t.title);
    if (feats.some((f) => namesMatch(f, target))) {
      out.push(t);
      if (out.length >= limit) break;
      continue;
    }
    // Multi-artist credit in the artist field: "A, B" / "A & B" / "A feat. B"
    const line = formatTrackArtistLine(t.artist, t.title);
    const parts = line.split(",").map((s) => s.trim());
    if (
      parts.length > 1 &&
      parts.some((p) => namesMatch(p, target)) &&
      !namesMatch(parts[0] || "", target)
    ) {
      out.push(t);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function albumTileFromLocal(
  sample: TrackRow,
  group: TrackRow[],
  title: string,
): CatalogTile {
  return {
    kind: "album",
    id: `album-${artistKey(sample.artist)}-${artistKey(title)}`,
    title,
    subtitle: sample.artist,
    artist: sample.artist,
    album: title,
    image: sample.coverPath,
    trackCount: group.length,
  };
}

function albumTileFromLidarr(
  album: LidarrAlbum,
  artistName: string,
): CatalogTile | null {
  const title = (album.title || "").trim();
  if (!title) return null;
  const image = coverFrom(album.images) || null;
  return {
    kind: "album",
    id: `lidarr-album-${album.id ?? album.foreignAlbumId ?? artistKey(title)}`,
    title,
    subtitle: artistName,
    artist: artistName,
    album: title,
    image,
    trackCount: album.statistics?.totalTrackCount || 0,
    foreignAlbumId: album.foreignAlbumId,
    lidarrAlbumId: album.id,
    releaseDate: album.releaseDate,
  };
}

export function buildArtistCatalog(
  artist: string,
  opts?: {
    trackLimit?: number;
    lidarrAlbums?: LidarrAlbum[];
    artistImage?: string | null;
  },
): ArtistCatalog {
  const name = artist.trim();
  const own = listTracksByArtist(name, opts?.trackLimit ?? 200);
  const featuresRaw = listTracksFeaturingArtist(name, 40);

  const byAlbum = new Map<string, TrackRow[]>();
  for (const t of own) {
    const key = (t.album || "").trim().toLowerCase() || `__single__:${t.id}`;
    const cur = byAlbum.get(key);
    if (cur) cur.push(t);
    else byAlbum.set(key, [t]);
  }

  const localAlbums: CatalogTile[] = [];
  const singles: CatalogTile[] = [];

  for (const [, group] of byAlbum) {
    const sample = group[0];
    if (!sample) continue;
    const albumTitle = (sample.album || "").trim();
    const treatAsSingle =
      group.length <= 1 && isSingleAlbum(albumTitle, sample.title);

    if (treatAsSingle) {
      for (const t of group) {
        singles.push({
          kind: "single",
          id: `single-${t.id}`,
          title: t.title,
          subtitle: formatTrackArtistLine(t.artist, t.title),
          artist: t.artist,
          album: t.album,
          image: t.coverPath,
          trackId: t.id,
          duration: t.duration,
          coverPath: t.coverPath,
        });
      }
      continue;
    }

    const title = albumTitle || sample.title;
    localAlbums.push(albumTileFromLocal(sample, group, title));
  }

  const lidarrAlbumTiles = (opts?.lidarrAlbums || [])
    .map((a) => albumTileFromLidarr(a, name))
    .filter((t): t is CatalogTile => Boolean(t));

  // Prefer Lidarr album cards (covers + foreign ids); fill gaps from local
  const albumKeys = new Set(
    lidarrAlbumTiles.map((a) => artistKey(a.kind === "album" ? a.album : a.title)),
  );
  const albums = [
    ...lidarrAlbumTiles,
    ...localAlbums.filter((a) => {
      if (a.kind !== "album") return false;
      return !albumKeys.has(artistKey(a.album));
    }),
  ];

  albums.sort((a, b) => {
    const da = a.kind === "album" ? a.releaseDate || "" : "";
    const db = b.kind === "album" ? b.releaseDate || "" : "";
    if (da || db) return db.localeCompare(da);
    return a.title.localeCompare(b.title);
  });
  singles.sort((a, b) => a.title.localeCompare(b.title));

  const features: CatalogTile[] = featuresRaw.map((t) => ({
    kind: "feature" as const,
    id: `feat-${t.id}`,
    title: t.title,
    subtitle: `With ${formatTrackArtistLine(t.artist, t.title)}`,
    artist: t.artist,
    album: t.album,
    image: t.coverPath,
    trackId: t.id,
    duration: t.duration,
    coverPath: t.coverPath,
  }));

  const image =
    opts?.artistImage ||
    albums.find((a) => a.image)?.image ||
    singles.find((s) => s.image)?.image ||
    features.find((f) => f.image)?.image ||
    own[0]?.coverPath ||
    null;

  const tiles = [...albums, ...singles, ...features];

  return {
    artist: name,
    image,
    albums,
    singles,
    features,
    tiles,
    tracks: own,
  };
}

function rankLocalArtists(limit: number) {
  const tops = listTracks(300);
  const counts = new Map<string, { artist: string; n: number; mtime: number }>();
  for (const t of tops) {
    const key = artistKey(t.artist);
    if (!key || key === "unknown" || key === "unknown artist") continue;
    const cur = counts.get(key);
    if (cur) {
      cur.n += 1;
      cur.mtime = Math.max(cur.mtime, t.mtimeMs || 0);
    } else {
      counts.set(key, {
        artist: t.artist.trim(),
        n: 1,
        mtime: t.mtimeMs || 0,
      });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || b.mtime - a.mtime)
    .slice(0, limit);
}

function rankLidarrArtists(
  artists: LidarrArtist[],
  albums: LidarrAlbum[],
  limit: number,
) {
  const newest = new Map<string, { artist: string; date: string; n: number }>();
  const nameById = new Map<number, string>();
  for (const a of artists) {
    if (a.id != null && a.artistName) nameById.set(a.id, a.artistName);
  }
  for (const album of albums) {
    const name =
      album.artist?.artistName ||
      (album.artistId != null ? nameById.get(album.artistId) : "") ||
      "";
    const key = artistKey(name);
    if (!key) continue;
    const date = (album.releaseDate || "").slice(0, 10);
    const cur = newest.get(key);
    if (!cur) {
      newest.set(key, { artist: name.trim(), date, n: 1 });
    } else {
      cur.n += 1;
      if (date && date > cur.date) cur.date = date;
    }
  }
  return [...newest.values()]
    .sort((a, b) => b.date.localeCompare(a.date) || b.n - a.n)
    .slice(0, limit);
}

/** Seed artists for home “More from …” rows (Lidarr discography + local extras). */
export async function pickMoreFromArtists(limit = 3): Promise<ArtistCatalog[]> {
  const client = LidarrClient.fromSettings();
  const [artistCovers, albums, artists] = await Promise.all([
    getArtistCoverMap(),
    client ? client.listAlbums().catch(() => [] as LidarrAlbum[]) : Promise.resolve([] as LidarrAlbum[]),
    client
      ? client.listArtists().catch(() => [] as LidarrArtist[])
      : Promise.resolve([] as LidarrArtist[]),
  ]);

  const nameById = new Map<number, string>();
  for (const a of artists) {
    if (a.id != null && a.artistName) nameById.set(a.id, a.artistName);
  }

  const albumsByArtist = new Map<string, LidarrAlbum[]>();
  for (const album of albums) {
    const name =
      album.artist?.artistName ||
      (album.artistId != null ? nameById.get(album.artistId) : "") ||
      "";
    const key = artistKey(name);
    if (!key) continue;
    const cur = albumsByArtist.get(key);
    if (cur) cur.push(album);
    else albumsByArtist.set(key, [album]);
  }

  const seeds: { artist: string }[] = [];
  const seen = new Set<string>();
  for (const row of [
    ...rankLocalArtists(limit * 2),
    ...rankLidarrArtists(artists, albums, limit * 3),
  ]) {
    const key = artistKey(row.artist);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    seeds.push({ artist: row.artist });
    if (seeds.length >= Math.max(limit * 3, 6)) break;
  }

  const shelves: ArtistCatalog[] = [];
  for (const row of seeds) {
    const key = artistKey(row.artist);
    const lidarrAlbums = albumsByArtist.get(key) || [];
    const matchArtist = artists.find((a) => artistKey(a.artistName) === key);
    const artistImage =
      (matchArtist?.foreignArtistId
        ? artistCovers.get(`mbid:${matchArtist.foreignArtistId}`)
        : null) ||
      artistCovers.get(artistCoverKey(row.artist)) ||
      null;
    const cat = buildArtistCatalog(row.artist, {
      lidarrAlbums,
      artistImage,
    });
    if (cat.tiles.length < 1) continue;
    shelves.push(cat);
    if (shelves.length >= limit) break;
  }
  return shelves;
}
