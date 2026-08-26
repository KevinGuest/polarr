import { findTrack } from "@/lib/db";
import { normalizeArtistName, trackMatchKey } from "@/lib/track-match";

type DeezerArtistHit = {
  id?: number;
  name?: string;
  nb_fan?: number;
};

type DeezerTopTrack = {
  id?: number;
  title?: string;
  title_short?: string;
  duration?: number;
  rank?: number;
  artist?: { name?: string };
  album?: { title?: string; cover_medium?: string; cover_big?: string };
};

export type ArtistPopularTrack = {
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverPath: string | null;
  /** Chart position 1–10 from Deezer (Spotify/Apple-style Popular). */
  chartRank: number;
  /** 0–100 for the popularity bars. */
  popularity: number;
};

async function deezerJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function artistNamesMatch(a: string, b: string): boolean {
  const left = normalizeArtistName(a);
  const right = normalizeArtistName(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

async function resolveDeezerArtistId(artist: string): Promise<number | null> {
  const data = await deezerJson<{ data?: DeezerArtistHit[] }>(
    `https://api.deezer.com/search/artist?q=${encodeURIComponent(artist)}&limit=12`,
  );
  const hits = data?.data || [];
  const exact =
    hits.find((h) => artistNamesMatch(h.name || "", artist)) || hits[0];
  return typeof exact?.id === "number" ? exact.id : null;
}

/**
 * Relative popularity 0–100 from Deezer artist top tracks (external chart order).
 * Keys are trackMatchKey(artist, title).
 */
export async function fetchArtistPopularityScores(
  artist: string,
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  const top = await fetchArtistPopularTracks(artist, 40);
  for (const t of top) {
    const key = trackMatchKey(t.artist, t.title);
    if (key) scores.set(key, t.popularity);
  }
  return scores;
}

/**
 * Spotify/Apple-style Popular list: Deezer artist top chart, capped.
 * Not the local library ranked by heuristic.
 */
export async function fetchArtistPopularTracks(
  artist: string,
  limit = 10,
): Promise<ArtistPopularTrack[]> {
  const deezerId = await resolveDeezerArtistId(artist);
  if (!deezerId) return [];

  const data = await deezerJson<{ data?: DeezerTopTrack[] }>(
    `https://api.deezer.com/artist/${deezerId}/top?limit=${Math.min(40, Math.max(limit, 10))}`,
  );
  const top = data?.data || [];
  if (!top.length) return [];

  const out: ArtistPopularTrack[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < top.length && out.length < limit; i++) {
    const track = top[i]!;
    const title = (track.title_short || track.title || "").trim();
    const trackArtist = (track.artist?.name || artist).trim();
    if (!title) continue;
    const key = trackMatchKey(trackArtist, title);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);

    const popularity = Math.round(
      100 - (out.length / Math.max(limit - 1, 1)) * 55,
    );

    out.push({
      title,
      artist: trackArtist || artist,
      album: (track.album?.title || "").trim(),
      duration: Number(track.duration) || 0,
      coverPath:
        track.album?.cover_medium || track.album?.cover_big || null,
      chartRank: out.length + 1,
      popularity: Math.max(20, Math.min(100, popularity)),
    });
  }
  return out;
}

/** Merge external scores with list position fallback for tracks missing Deezer data. */
export function popularityForTrack(
  scores: Map<string, number>,
  artist: string,
  title: string,
  listIndex: number,
  listLength: number,
): number {
  const key = trackMatchKey(artist, title);
  if (key && scores.has(key)) return scores.get(key)!;
  if (listLength <= 1) return 55;
  return Math.round(48 - (listIndex / Math.max(listLength - 1, 1)) * 32);
}

/**
 * Attach local library ids when the chart song is already on disk.
 */
export function hydratePopularWithLibrary(
  popular: ArtistPopularTrack[],
  fallbackArtist: string,
): {
  id: string;
  title: string;
  artist: string;
  primaryArtist: string;
  album: string;
  duration: number;
  coverPath: string | null;
  source: string;
  popularity: number;
}[] {
  return popular.map((t, i) => {
    const local =
      findTrack(t.artist, t.title) ||
      findTrack(fallbackArtist, t.title);
    const primary = t.artist || fallbackArtist;
    return {
      id: local?.id || `catalog:popular:${i}:${trackMatchKey(primary, t.title)}`,
      title: t.title,
      artist: primary,
      primaryArtist: primary,
      album: t.album || local?.album || "",
      duration: t.duration || local?.duration || 0,
      coverPath: t.coverPath || local?.coverPath || null,
      source: local ? local.source : "stream",
      popularity: t.popularity,
    };
  });
}
