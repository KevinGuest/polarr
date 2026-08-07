/**
 * General-market trending albums / artists (no API key).
 * Deezer public chart → Polarr home Explore + Artists fill.
 */

export type TrendingAlbum = {
  id: string;
  title: string;
  artist: string;
  year?: number;
  image?: string;
  releaseDate?: string;
  /** 1 = hottest on chart */
  rank: number;
};

export type TrendingArtist = {
  name: string;
  image?: string;
  /** 1 = hottest on chart */
  rank: number;
};

type DeezerChartAlbum = {
  id?: number;
  title?: string;
  cover_medium?: string;
  cover_big?: string;
  release_date?: string;
  artist?: { name?: string };
};

const TREND_TTL_MS = 45 * 60 * 1000;
let trendCache: { at: number; items: TrendingAlbum[] } | null = null;

/** Top albums worldwide (Deezer chart). Cached ~45m. */
export async function fetchTrendingAlbums(
  limit = 30,
): Promise<TrendingAlbum[]> {
  if (trendCache && Date.now() - trendCache.at < TREND_TTL_MS) {
    return trendCache.items.slice(0, limit);
  }

  try {
    const res = await fetch(
      `https://api.deezer.com/chart/0/albums?limit=${Math.min(limit, 50)}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 1800 },
      },
    );
    if (!res.ok) return trendCache?.items.slice(0, limit) || [];
    const data = (await res.json()) as { data?: DeezerChartAlbum[] };
    const items: TrendingAlbum[] = [];
    let rank = 1;
    for (const a of data.data || []) {
      const title = (a.title || "").trim();
      const artist = (a.artist?.name || "").trim();
      if (!title || !artist) continue;
      const date = (a.release_date || "").slice(0, 10);
      items.push({
        id: `deezer:${a.id ?? `${artist}-${title}`}`,
        title,
        artist,
        year: date ? Number(date.slice(0, 4)) || undefined : undefined,
        image: a.cover_big || a.cover_medium,
        releaseDate: date || undefined,
        rank: rank++,
      });
      if (items.length >= limit) break;
    }
    if (items.length > 0) {
      trendCache = { at: Date.now(), items };
    }
    return items.slice(0, limit);
  } catch {
    return trendCache?.items.slice(0, limit) || [];
  }
}

type DeezerChartArtist = {
  id?: number;
  name?: string;
  picture_xl?: string;
  picture_big?: string;
  picture_medium?: string;
};

const TREND_ARTIST_TTL_MS = 45 * 60 * 1000;
let trendArtistCache: { at: number; items: TrendingArtist[] } | null = null;

/** Top artists worldwide (Deezer chart). Cached ~45m. */
export async function fetchTrendingArtists(
  limit = 24,
): Promise<TrendingArtist[]> {
  if (
    trendArtistCache &&
    Date.now() - trendArtistCache.at < TREND_ARTIST_TTL_MS
  ) {
    return trendArtistCache.items.slice(0, limit);
  }

  try {
    const res = await fetch(
      `https://api.deezer.com/chart/0/artists?limit=${Math.min(limit, 50)}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 1800 },
      },
    );
    if (!res.ok) return trendArtistCache?.items.slice(0, limit) || [];
    const data = (await res.json()) as { data?: DeezerChartArtist[] };
    const items: TrendingArtist[] = [];
    let rank = 1;
    for (const a of data.data || []) {
      const name = (a.name || "").trim();
      if (!name) continue;
      items.push({
        name,
        image: a.picture_xl || a.picture_big || a.picture_medium,
        rank: rank++,
      });
      if (items.length >= limit) break;
    }
    if (items.length > 0) {
      trendArtistCache = { at: Date.now(), items };
    }
    return items.slice(0, limit);
  } catch {
    return trendArtistCache?.items.slice(0, limit) || [];
  }
}
