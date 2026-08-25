/**
 * Explore recommender — listen-first personalization.
 *
 * Pipeline:
 * 1) Build artist affinity from listens (depth + recency) + likes
 * 2) Expand with Deezer related artists (neighborhood discovery)
 * 3) Pull albums for seed + related artists
 * 4) Score taste-heavy; charts only as cold-start / spice
 * 5) Diversity-cap so one artist doesn’t own the shelf
 */

import {
  listLikedTracks,
  listTasteExcludeIds,
  listUserListenSignals,
} from "@/lib/db";
import { primaryArtistName } from "@/lib/artist-portrait";
import type { TrendingAlbum } from "@/lib/trending";

export type ExploreAlbum = {
  id: string;
  title: string;
  artist: string;
  year?: number;
  image?: string;
  foreignAlbumId?: string;
  releaseDate?: string;
  hasFile?: boolean;
  monitored?: boolean;
  lidarrAlbumId?: number;
  rank?: number;
};

function artistKey(artist: string) {
  return (
    primaryArtistName(artist).trim().toLowerCase() ||
    artist.trim().toLowerCase()
  );
}

function albumKey(artist: string, title: string) {
  return `${artistKey(artist)}::${title.trim().toLowerCase()}`;
}

function daysAgo(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 365;
  return Math.max(0, (Date.now() - t) / (24 * 60 * 60 * 1000));
}

/** Recency × listen-depth artist affinity from real plays. */
export function listenArtistAffinity(userId: string): {
  scores: Map<string, number>;
  labels: Map<string, string>;
  heardAlbums: Set<string>;
} {
  const scores = new Map<string, number>();
  const labels = new Map<string, string>();
  const heardAlbums = new Set<string>();
  const excluded = new Set(listTasteExcludeIds(userId));

  const signals = listUserListenSignals(userId, 250);
  signals.forEach((s, i) => {
    if (s.trackId && excluded.has(s.trackId)) return;
    const k = artistKey(s.artist);
    if (!k) return;
    const display = primaryArtistName(s.artist).trim() || s.artist.trim();
    if (!labels.has(k)) labels.set(k, display);
    if (s.album) heardAlbums.add(albumKey(s.artist, s.album));

    const recency = Math.max(0.35, 1 - daysAgo(s.playedAt) / 90);
    const depth = Math.min(2.5, Math.log2(1 + s.listenedSeconds / 30));
    // Position bonus: recent unique tracks still matter
    const pos = Math.max(0.4, 1 - i / 200);
    const w = 10 * recency * depth * pos;
    scores.set(k, (scores.get(k) || 0) + w);
  });

  for (const t of listLikedTracks(userId, 200)) {
    if (excluded.has(t.id)) continue;
    const k = artistKey(t.artist);
    if (!k) continue;
    const display = primaryArtistName(t.artist).trim() || t.artist.trim();
    if (!labels.has(k)) labels.set(k, display);
    if (t.album) heardAlbums.add(albumKey(t.artist, t.album));
    scores.set(k, (scores.get(k) || 0) + 14);
  }

  return { scores, labels, heardAlbums };
}

export function topListenArtists(userId: string, limit = 12): string[] {
  const { scores, labels } = listenArtistAffinity(userId);
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => labels.get(k) || k)
    .filter(Boolean);
}

type DeezerArtistHit = { id?: number; name?: string };
type DeezerAlbumHit = {
  id?: number;
  title?: string;
  cover_medium?: string;
  cover_big?: string;
  release_date?: string;
  artist?: { name?: string };
};

const artistIdCache = new Map<string, { at: number; id: number | null }>();
const relatedCache = new Map<
  string,
  { at: number; artists: { id: number; name: string }[] }
>();
const albumCache = new Map<string, { at: number; albums: ExploreAlbum[] }>();
const CACHE_TTL = 45 * 60 * 1000;

async function deezerJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 1800 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function resolveDeezerArtistId(name: string): Promise<number | null> {
  const key = artistKey(name);
  if (!key) return null;
  const hit = artistIdCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.id;

  const data = await deezerJson<{ data?: DeezerArtistHit[] }>(
    `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=8`,
  );
  let id: number | null = null;
  for (const a of data?.data || []) {
    const n = (a.name || "").trim();
    if (!n || a.id == null) continue;
    if (artistKey(n) === key) {
      id = Number(a.id);
      break;
    }
    if (id == null) id = Number(a.id);
  }
  artistIdCache.set(key, { at: Date.now(), id });
  return id;
}

async function fetchRelatedDeezerArtists(
  artistId: number,
  limit = 6,
): Promise<{ id: number; name: string }[]> {
  const ck = String(artistId);
  const hit = relatedCache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.artists.slice(0, limit);

  const data = await deezerJson<{ data?: DeezerArtistHit[] }>(
    `https://api.deezer.com/artist/${artistId}/related?limit=${Math.min(limit, 12)}`,
  );
  const artists: { id: number; name: string }[] = [];
  for (const a of data?.data || []) {
    const name = (a.name || "").trim();
    if (!name || a.id == null) continue;
    artists.push({ id: Number(a.id), name });
    if (artists.length >= limit) break;
  }
  relatedCache.set(ck, { at: Date.now(), artists });
  return artists;
}

function mapDeezerAlbum(
  a: DeezerAlbumHit,
  fallbackArtist?: string,
): ExploreAlbum | null {
  const title = (a.title || "").trim();
  const artist = (a.artist?.name || fallbackArtist || "").trim();
  if (!title || !artist || a.id == null) return null;
  const date = (a.release_date || "").slice(0, 10);
  return {
    id: `deezer:album:${a.id}`,
    title,
    artist,
    year: date ? Number(date.slice(0, 4)) || undefined : undefined,
    image: a.cover_big || a.cover_medium,
    releaseDate: date || undefined,
    hasFile: false,
    monitored: false,
  };
}

async function fetchDeezerArtistAlbums(
  artistId: number,
  artistName: string,
  limit = 8,
): Promise<ExploreAlbum[]> {
  const ck = `${artistId}:${limit}`;
  const hit = albumCache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.albums.slice(0, limit);

  const data = await deezerJson<{ data?: DeezerAlbumHit[] }>(
    `https://api.deezer.com/artist/${artistId}/albums?limit=${Math.min(limit, 25)}`,
  );
  const albums: ExploreAlbum[] = [];
  const seen = new Set<string>();
  for (const raw of data?.data || []) {
    const mapped = mapDeezerAlbum(raw, artistName);
    if (!mapped) continue;
    const k = albumKey(mapped.artist, mapped.title);
    if (seen.has(k)) continue;
    seen.add(k);
    albums.push(mapped);
    if (albums.length >= limit) break;
  }
  albumCache.set(ck, { at: Date.now(), albums });
  return albums;
}

/**
 * Expand listen seeds → related artists → album candidates (Deezer).
 * Returns albums + a related-artist affinity map (fraction of seed score).
 */
export async function expandTasteNeighborhood(
  userId: string,
  seedLimit = 8,
): Promise<{
  albums: ExploreAlbum[];
  graph: Map<string, number>;
  heardAlbums: Set<string>;
}> {
  const { scores, labels, heardAlbums } = listenArtistAffinity(userId);
  const graph = new Map<string, number>(scores);
  const seeds = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, seedLimit);

  if (seeds.length === 0) {
    return { albums: [], graph, heardAlbums };
  }

  const albums: ExploreAlbum[] = [];
  const seenAlbum = new Set<string>();

  await Promise.all(
    seeds.map(async ([key, seedScore]) => {
      const name = labels.get(key) || key;
      const id = await resolveDeezerArtistId(name);
      if (id == null) return;

      const [own, related] = await Promise.all([
        fetchDeezerArtistAlbums(id, name, 6),
        fetchRelatedDeezerArtists(id, 5),
      ]);

      for (const a of own) {
        const k = albumKey(a.artist, a.title);
        if (seenAlbum.has(k)) continue;
        seenAlbum.add(k);
        albums.push(a);
      }

      // Related artists inherit a slice of the seed’s affinity
      const relatedSlice = related.slice(0, 4);
      await Promise.all(
        relatedSlice.map(async (rel, idx) => {
          const rk = artistKey(rel.name);
          if (!rk) return;
          const inherit = seedScore * (0.55 - idx * 0.08);
          graph.set(rk, Math.max(graph.get(rk) || 0, inherit));
          if (!labels.has(rk)) labels.set(rk, rel.name);
          const relAlbums = await fetchDeezerArtistAlbums(rel.id, rel.name, 4);
          for (const a of relAlbums) {
            const k = albumKey(a.artist, a.title);
            if (seenAlbum.has(k)) continue;
            seenAlbum.add(k);
            albums.push(a);
          }
        }),
      );
    }),
  );

  return { albums, graph, heardAlbums };
}

function freshnessScore(releaseDate?: string, year?: number): number {
  const iso =
    releaseDate ||
    (year != null && year > 1900 ? `${year}-06-01` : undefined);
  if (!iso) return 0.25;
  const d = daysAgo(iso);
  if (d <= 90) return 1;
  if (d <= 365) return 0.7;
  if (d <= 365 * 3) return 0.4;
  return 0.2;
}

/**
 * Taste-first Explore ranking.
 * ~75% listen/neighborhood affinity, novelty + freshness, charts as spice.
 */
export function rankExploreAlbums<T extends ExploreAlbum>(opts: {
  userId?: string | null;
  trending: (T & { rank?: number })[];
  preferencePool: T[];
  graph?: Map<string, number>;
  heardAlbums?: Set<string>;
  limit?: number;
}): T[] {
  const limit = opts.limit ?? 36;
  const taste =
    opts.graph ||
    (opts.userId
      ? listenArtistAffinity(opts.userId).scores
      : new Map<string, number>());
  const heard =
    opts.heardAlbums ||
    (opts.userId
      ? listenArtistAffinity(opts.userId).heardAlbums
      : new Set<string>());

  let maxTaste = 1;
  for (const v of taste.values()) if (v > maxTaste) maxTaste = v;
  const hasTaste = taste.size > 0 && maxTaste > 1;

  const byKey = new Map<string, T & { rank?: number }>();
  for (const t of opts.trending) {
    byKey.set((t.foreignAlbumId || t.id).toLowerCase(), t);
  }
  for (const p of opts.preferencePool) {
    const k = (p.foreignAlbumId || p.id).toLowerCase();
    if (!byKey.has(k)) byKey.set(k, p);
  }

  const trendRank = new Map<string, number>();
  opts.trending.forEach((t, i) => {
    trendRank.set((t.foreignAlbumId || t.id).toLowerCase(), t.rank ?? i + 1);
  });
  const trendCount = Math.max(opts.trending.length, 1);

  const scored = [...byKey.values()].map((item) => {
    const key = (item.foreignAlbumId || item.id).toLowerCase();
    const r = trendRank.get(key);
    const chart =
      r != null ? Math.max(0, 1 - (r - 1) / trendCount) : 0.05;

    const ak = artistKey(item.artist);
    const tasteRaw = taste.get(ak) || 0;
    const tasteNorm = Math.min(1, tasteRaw / maxTaste);

    const heardHit = heard.has(albumKey(item.artist, item.title));
    // Prefer discovery: albums you haven’t spun yet
    const novelty = heardHit ? 0.15 : 1;

    const fresh = freshnessScore(item.releaseDate, item.year);

    let score: number;
    if (!hasTaste) {
      score = chart * 0.7 + fresh * 0.3;
    } else {
      // Listen graph dominates; chart is light seasoning
      score =
        tasteNorm * 0.62 +
        novelty * 0.16 +
        fresh * 0.1 +
        chart * 0.12;
      // Soft boost when both taste + chart agree
      if (r != null && tasteRaw > 0) score += 0.06;
    }

    return { item, score, ak };
  });

  scored.sort((a, b) => b.score - a.score);

  // Diversity: at most 2 albums per artist in the final shelf
  const out: T[] = [];
  const perArtist = new Map<string, number>();
  for (const row of scored) {
    const n = perArtist.get(row.ak) || 0;
    if (n >= 2) continue;
    perArtist.set(row.ak, n + 1);
    out.push(row.item);
    if (out.length >= limit) break;
  }

  // Fill if diversity left gaps
  if (out.length < limit) {
    const have = new Set(
      out.map((i) => (i.foreignAlbumId || i.id).toLowerCase()),
    );
    for (const row of scored) {
      const k = (row.item.foreignAlbumId || row.item.id).toLowerCase();
      if (have.has(k)) continue;
      out.push(row.item);
      have.add(k);
      if (out.length >= limit) break;
    }
  }

  return out;
}

/** Convert Deezer chart albums into ExploreAlbum shape. */
export function trendingToExplore(items: TrendingAlbum[]): ExploreAlbum[] {
  return items.map((t) => ({
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
}
