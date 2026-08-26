/**
 * Artist portraits for home / search / album headers.
 * Strict name matching only — never grab the first fuzzy Deezer/Lidarr hit.
 */

import {
  artistCoverKey,
  getArtistCoverMap,
  LidarrClient,
  coverFrom,
} from "@/lib/lidarr";
import {
  namesMatch,
  normalizeArtistName,
  primaryArtistName,
} from "@/lib/track-match";
export { namesMatch, normalizeArtistName, primaryArtistName };

const PORTRAIT_TTL_MS = 6 * 60 * 60 * 1000;
/** Bump when matching rules change so stale wrong URLs are dropped. */
const PORTRAIT_CACHE_VERSION = 2;
const portraitCache = new Map<string, { at: number; url: string | null }>();

type DeezerArtist = {
  name?: string;
  nb_fan?: number;
  picture_xl?: string;
  picture_big?: string;
  picture_medium?: string;
};

function cacheKey(artist: string, mbid?: string | null): string {
  return `v${PORTRAIT_CACHE_VERSION}|${(mbid || "").toLowerCase()}|${artist.trim().toLowerCase()}`;
}

function deezerPicture(a: DeezerArtist | undefined): string | null {
  if (!a) return null;
  return a.picture_xl || a.picture_big || a.picture_medium || null;
}

async function deezerPortraitFor(name: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=15`,
      {
        headers: { Accept: "application/json", "User-Agent": "Polarr/1.0" },
        next: { revalidate: 1800 },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: DeezerArtist[] };
    const matches = (data.data || []).filter((a) =>
      namesMatch(a.name || "", name),
    );
    if (matches.length === 0) return null;
    // Exact name can collide (fan accounts) — pick the real artist by fans
    matches.sort((a, b) => (b.nb_fan || 0) - (a.nb_fan || 0));
    return deezerPicture(matches[0]);
  } catch {
    return null;
  }
}

/** High-res artist photo for album/artist headers. */
export async function resolveArtistPortrait(input: {
  artist: string;
  foreignArtistId?: string | null;
}): Promise<string | null> {
  const raw = input.artist.trim();
  if (!raw) return null;
  const name = primaryArtistName(raw);
  if (!name) return null;

  const key = cacheKey(name, input.foreignArtistId);
  const hit = portraitCache.get(key);
  if (hit && Date.now() - hit.at < PORTRAIT_TTL_MS) return hit.url;

  let url: string | null = null;

  // 1) Deezer — strict name match only
  url = await deezerPortraitFor(name);

  // 2) Lidarr library map (MBID first)
  if (!url) {
    const map = await getArtistCoverMap().catch(
      () => new Map<string, string>(),
    );
    url =
      (input.foreignArtistId
        ? map.get(`mbid:${input.foreignArtistId}`)
        : null) ||
      map.get(artistCoverKey(name)) ||
      null;
  }

  // 3) Lidarr lookup by MBID
  if (!url && input.foreignArtistId) {
    const client = LidarrClient.fromSettings();
    if (client) {
      const hits = await client
        .searchArtists(`lidarr:${input.foreignArtistId}`)
        .catch(() => []);
      const match = hits.find(
        (a) => a.foreignArtistId === input.foreignArtistId,
      );
      url = coverFrom(match?.images) || null;
    }
  }

  // 4) Lidarr text search — exact name only (never first fuzzy hit)
  if (!url) {
    const client = LidarrClient.fromSettings();
    if (client) {
      const hits = await client.searchArtists(name).catch(() => []);
      const match = hits.find((a) =>
        namesMatch(a.artistName || "", name),
      );
      url = coverFrom(match?.images) || null;
    }
  }

  portraitCache.set(key, { at: Date.now(), url });
  if (portraitCache.size > 200) {
    const oldest = [...portraitCache.entries()].sort(
      (a, b) => a[1].at - b[1].at,
    );
    for (const [k] of oldest.slice(0, 40)) portraitCache.delete(k);
  }
  return url;
}
