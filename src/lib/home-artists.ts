/**
 * Home “Artists” shelf — Spotify-style affinity, not Lidarr-only.
 *
 * Priority:
 * 1) Your plays + likes (when signed in)
 * 2) Household listening
 * 3) Downloaded library depth
 * 4) Chart artists (so empty installs still feel alive)
 * Lidarr is only used for MBID / cover hints when names match.
 */

import {
  topArtistsFromLibrary,
  topArtistsFromListening,
} from "@/lib/db";
import {
  normalizeArtistName,
  primaryArtistName,
  resolveArtistPortrait,
} from "@/lib/artist-portrait";
import { tasteArtistNames } from "@/lib/made-for";
import { fetchTrendingArtists } from "@/lib/trending";

export type HomeArtist = {
  name: string;
  image?: string;
  foreignArtistId?: string;
};

type Ranked = {
  name: string;
  score: number;
  image?: string;
  foreignArtistId?: string;
};

function keyOf(raw: string): string {
  return normalizeArtistName(primaryArtistName(raw));
}

function mergeIn(
  map: Map<string, Ranked>,
  rawName: string,
  score: number,
  extra?: { image?: string; foreignArtistId?: string },
) {
  const name = primaryArtistName(rawName).trim() || rawName.trim();
  const key = keyOf(name);
  if (!key) return;
  const prev = map.get(key);
  if (!prev) {
    map.set(key, {
      name,
      score,
      image: extra?.image,
      foreignArtistId: extra?.foreignArtistId,
    });
    return;
  }
  prev.score += score;
  if (!prev.image && extra?.image) prev.image = extra.image;
  if (!prev.foreignArtistId && extra?.foreignArtistId) {
    prev.foreignArtistId = extra.foreignArtistId;
  }
  // Prefer cleaner / shorter display label
  if (name.length < prev.name.length) prev.name = name;
}

/** Build circular artist row for home. */
export async function buildHomeArtists(opts: {
  userId?: string | null;
  limit?: number;
  lidarrArtists?: {
    name: string;
    image?: string;
    foreignArtistId?: string;
  }[];
}): Promise<HomeArtist[]> {
  const limit = opts.limit ?? 24;
  const ranked = new Map<string, Ranked>();

  // 1) Personal taste (plays + likes)
  if (opts.userId) {
    const taste = tasteArtistNames(opts.userId, 20);
    taste.forEach((name, i) => {
      mergeIn(ranked, name, 100 - i * 3);
    });
  }

  // 2) Household listening (streams count)
  for (const row of topArtistsFromListening(40)) {
    mergeIn(ranked, row.artist, 12 + Math.min(row.plays, 40));
  }

  // 3) Files on disk (shared library)
  for (const row of topArtistsFromLibrary(30)) {
    mergeIn(ranked, row.artist, 8 + Math.min(row.tracks, 30));
  }

  // 4) Chart fill — always, so cold start / guests still see faces
  const chart = await fetchTrendingArtists(24).catch(() => []);
  for (const a of chart) {
    mergeIn(ranked, a.name, Math.max(2, 28 - a.rank), {
      image: a.image,
    });
  }

  // Lidarr: attach MBID / poster when we already care about the name
  for (const a of opts.lidarrArtists || []) {
    const key = keyOf(a.name);
    if (!key) continue;
    const prev = ranked.get(key);
    if (prev) {
      if (!prev.foreignArtistId && a.foreignArtistId) {
        prev.foreignArtistId = a.foreignArtistId;
      }
      if (!prev.image && a.image) prev.image = a.image;
      prev.score += 4;
    } else {
      // Light boost only — don’t flood the shelf with every monitored artist
      mergeIn(ranked, a.name, 3, {
        image: a.image,
        foreignArtistId: a.foreignArtistId,
      });
    }
  }

  const sorted = [...ranked.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);

  const withPortraits = await Promise.all(
    sorted.map(async (a): Promise<HomeArtist | null> => {
      const fresh = await resolveArtistPortrait({
        artist: a.name,
        foreignArtistId: a.foreignArtistId,
      }).catch(() => null);
      const image = fresh || a.image;
      if (!image) return null;
      return {
        name: a.name,
        image,
        foreignArtistId: a.foreignArtistId,
      };
    }),
  );

  return withPortraits.filter((a): a is HomeArtist => a != null);
}
