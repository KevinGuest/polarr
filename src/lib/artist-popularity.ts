import { normalizeArtistName, trackMatchKey } from "@/lib/track-match";

type DeezerArtistHit = {
  id?: number;
  name?: string;
  nb_fan?: number;
};

type DeezerTopTrack = {
  title?: string;
  rank?: number;
  artist?: { name?: string };
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
  const deezerId = await resolveDeezerArtistId(artist);
  if (!deezerId) return scores;

  const data = await deezerJson<{ data?: DeezerTopTrack[] }>(
    `https://api.deezer.com/artist/${deezerId}/top?limit=40`,
  );
  const top = data?.data || [];
  if (!top.length) return scores;

  const maxIndex = Math.max(top.length - 1, 1);
  top.forEach((track, index) => {
    const title = (track.title || "").trim();
    const trackArtist = (track.artist?.name || artist).trim();
    if (!title) return;
    const key = trackMatchKey(trackArtist, title);
    if (!key) return;
    const fromRank =
      typeof track.rank === "number" && track.rank > 0
        ? Math.max(8, Math.round(100 - Math.log10(track.rank + 1) * 22))
        : Math.round(100 - (index / maxIndex) * 72);
    const prev = scores.get(key) ?? 0;
    scores.set(key, Math.max(prev, Math.min(100, fromRank)));
  });

  return scores;
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
