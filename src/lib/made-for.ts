import fs from "node:fs";
import {
  listLikedTracks,
  listRecentPlays,
  listTasteExcludeIds,
  listTracks,
  type TrackRow,
} from "@/lib/db";
import { primaryArtistName } from "@/lib/artist-portrait";
import { listenArtistAffinity, rankExploreAlbums } from "@/lib/explore-recommend";

export type MadeForTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverPath: string | null;
  source: string;
};

export type MadeForMix = {
  id: string;
  kind: "discover_weekly" | "daily_mix" | "liked" | "radio";
  title: string;
  description: string;
  /** Accent for Daily Mix badge (css color) */
  accent: string;
  /** Two-digit label e.g. "01" — null for Discover Weekly */
  badge: string | null;
  coverSeed: string;
  tracks: MadeForTrack[];
};

const DAILY_ACCENTS = [
  "#7dd3fc", // cyan
  "#fde047", // yellow
  "#fb923c", // orange
  "#f9a8d4", // pink
  "#86efac", // green
  "#c4b5fd", // purple
];

function streamableCatalog(limit = 400, excludeIds?: Set<string>): TrackRow[] {
  return listTracks(limit).filter((t) => {
    if (excludeIds?.has(t.id)) return false;
    try {
      return Boolean(t.path && fs.existsSync(t.path));
    } catch {
      return false;
    }
  });
}

function toDto(t: TrackRow): MadeForTrack {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    coverPath: t.coverPath,
    source: t.source,
  };
}

/** Deterministic shuffle from a day seed so mixes stay stable within a day. */
function seededShuffle<T>(items: T[], seed: string): T[] {
  const out = [...items];
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let i = out.length - 1; i > 0; i--) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function artistKey(artist: string) {
  return primaryArtistName(artist).trim().toLowerCase() || artist.trim().toLowerCase();
}

/** Play + like weighted artist affinity for home Explore ranking. */
export function tasteArtistScores(userId: string): Map<string, number> {
  return listenArtistAffinity(userId).scores;
}

/** Top artist display names by taste score (for MusicBrainz explore queries). */
export function tasteArtistNames(userId: string, limit = 8): string[] {
  const { scores, labels } = listenArtistAffinity(userId);
  if (scores.size === 0) {
    // Fallback: legacy recent-play labels if affinity empty
    const recent = listRecentPlays(userId, 40);
    const liked = listLikedTracks(userId, 40);
    const artistScore = new Map<string, number>();
    const label = new Map<string, string>();
    for (const t of [...recent, ...liked]) {
      const k = artistKey(t.artist);
      if (!k) continue;
      const display = primaryArtistName(t.artist).trim() || t.artist.trim();
      if (!label.has(k)) label.set(k, display);
      artistScore.set(k, (artistScore.get(k) || 0) + 1);
    }
    return [...artistScore.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([k]) => label.get(k) || k)
      .filter(Boolean);
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => labels.get(k) || k)
    .filter(Boolean);
}

/** Rank catalog cards by taste affinity (unknown artists keep mid priority). */
export function rankByTasteArtist<T extends { artist: string }>(
  userId: string | null | undefined,
  items: T[],
): T[] {
  if (!userId || items.length === 0) return items;
  const scores = tasteArtistScores(userId);
  if (scores.size === 0) return items;
  return [...items].sort((a, b) => {
    const sa = scores.get(artistKey(a.artist)) || 0;
    const sb = scores.get(artistKey(b.artist)) || 0;
    if (sb !== sa) return sb - sa;
    return (a.artist || "").localeCompare(b.artist || "");
  });
}

/**
 * Blend global trending with personal taste (listen-first).
 * Prefer {@link rankExploreAlbums} for new Explore shelves.
 */
export function blendTrendingWithTaste<
  T extends { artist: string; id: string; title?: string; releaseDate?: string; year?: number; foreignAlbumId?: string; rank?: number },
>(
  userId: string | null | undefined,
  trending: (T & { rank?: number })[],
  preferencePool: T[],
  limit = 28,
): T[] {
  return rankExploreAlbums({
    userId,
    trending: trending as (T & { rank?: number; title: string })[],
    preferencePool: preferencePool.map((p) => ({
      ...p,
      title: p.title || p.id,
    })) as (T & { title: string })[],
    limit,
  }) as T[];
}

function formatArtistList(artists: string[], max = 3): string {
  const clean = artists.filter(Boolean);
  if (clean.length === 0) return "Fresh picks from your library";
  if (clean.length <= max) return clean.join(", ");
  return `${clean.slice(0, max).join(", ")} and more`;
}

function pickTracksForArtists(
  catalog: TrackRow[],
  artists: Set<string>,
  excludeIds: Set<string>,
  limit: number,
  seed: string,
): TrackRow[] {
  const pool = catalog.filter(
    (t) => artists.has(artistKey(t.artist)) && !excludeIds.has(t.id),
  );
  return seededShuffle(pool, seed).slice(0, limit);
}

/**
 * Lightweight personalization: cluster streamable tracks by taste signals
 * (plays + likes) into Daily Mixes + Discover Weekly.
 */
export function buildMadeForMixes(
  userId: string,
  username: string,
): { username: string; mixes: MadeForMix[] } {
  const day = new Date().toISOString().slice(0, 10);
  const excluded = new Set(listTasteExcludeIds(userId));
  const catalog = streamableCatalog(400, excluded);
  const recent = listRecentPlays(userId, 100).filter((t) => !excluded.has(t.id));
  const liked = listLikedTracks(userId, 200).filter((t) => !excluded.has(t.id));
  const likedPlayable = liked.filter((t) => Boolean(t.path));

  if (catalog.length === 0) {
    return { username, mixes: [] };
  }

  // Artist scores from plays (recency-weighted) + likes
  const artistScore = new Map<string, number>();
  const artistLabel = new Map<string, string>();
  const playedIds = new Set(recent.map((t) => t.id));

  recent.forEach((t, i) => {
    const k = artistKey(t.artist);
    if (!k) return;
    artistLabel.set(k, t.artist);
    const weight = Math.max(1, 20 - i * 0.15);
    artistScore.set(k, (artistScore.get(k) || 0) + weight);
  });
  for (const t of liked) {
    const k = artistKey(t.artist);
    if (!k) continue;
    artistLabel.set(k, t.artist);
    artistScore.set(k, (artistScore.get(k) || 0) + 8);
  }

  // Cold start: invent taste from catalog diversity
  if (artistScore.size === 0) {
    const byArtist = new Map<string, number>();
    for (const t of catalog) {
      const k = artistKey(t.artist);
      if (!k) continue;
      artistLabel.set(k, t.artist);
      byArtist.set(k, (byArtist.get(k) || 0) + 1);
    }
    for (const [k, c] of byArtist) {
      artistScore.set(k, c);
    }
  }

  const rankedArtists = [...artistScore.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  const mixes: MadeForMix[] = [];
  const usedInDaily = new Set<string>();

  // Discover Weekly — underplayed / less familiar artists + newer adds
  {
    const familiar = new Set(rankedArtists.slice(0, 8));
    const pool = catalog.filter((t) => {
      const k = artistKey(t.artist);
      if (familiar.has(k) && playedIds.has(t.id)) return false;
      return true;
    });
    const scored = [...pool].sort((a, b) => {
      const fa = familiar.has(artistKey(a.artist)) ? 0 : 2;
      const fb = familiar.has(artistKey(b.artist)) ? 0 : 2;
      const sa = (a.source === "fallback" ? 1 : 0) + fa + a.mtimeMs / 1e15;
      const sb = (b.source === "fallback" ? 1 : 0) + fb + b.mtimeMs / 1e15;
      return sb - sa;
    });
    const picked = seededShuffle(scored.slice(0, 80), `dw-${day}-${userId}`).slice(
      0,
      30,
    );
    if (picked.length >= 5) {
      const descArtists = [
        ...new Set(picked.map((t) => t.artist)),
      ].slice(0, 4);
      mixes.push({
        id: "discover-weekly",
        kind: "discover_weekly",
        title: "Discover Weekly",
        description: `Your shortcut to hidden gems · ${formatArtistList(descArtists)}`,
        accent: "#f472b6",
        badge: null,
        coverSeed: `discover-weekly-${username}`,
        tracks: picked.map(toDto),
      });
    }
  }

  // Daily Mix 1..N — cluster top artists into mixes of ~2–3 artists each
  const mixCount = Math.min(5, Math.max(1, Math.ceil(rankedArtists.length / 2)));
  for (let i = 0; i < mixCount; i++) {
    const cluster = rankedArtists.slice(i * 2, i * 2 + 3);
    if (cluster.length === 0) break;
    const artistSet = new Set(cluster);
    const picked = pickTracksForArtists(
      catalog,
      artistSet,
      usedInDaily,
      28,
      `dm-${i}-${day}-${userId}`,
    );
    // Fill from same artists even if already used, if pool thin
    const filled =
      picked.length >= 5
        ? picked
        : pickTracksForArtists(
            catalog,
            artistSet,
            new Set(),
            28,
            `dm-fill-${i}-${day}`,
          );
    if (filled.length < 3) continue;
    for (const t of filled) usedInDaily.add(t.id);

    const labels = cluster
      .map((k) => artistLabel.get(k) || k)
      .filter(Boolean);
    const n = String(i + 1).padStart(2, "0");
    mixes.push({
      id: `daily-mix-${i + 1}`,
      kind: "daily_mix",
      title: `Daily Mix ${i + 1}`,
      description: formatArtistList(labels),
      accent: DAILY_ACCENTS[i % DAILY_ACCENTS.length],
      badge: n,
      coverSeed: `daily-mix-${i + 1}-${labels[0] || username}`,
      tracks: filled.map(toDto),
    });
  }

  // Liked Songs radio (library files only — stream-only likes still affect taste)
  if (likedPlayable.length >= 5) {
    const shuffled = seededShuffle(likedPlayable, `liked-${day}-${userId}`).slice(
      0,
      40,
    );
    mixes.push({
      id: "liked-mix",
      kind: "liked",
      title: "Liked Mix",
      description: `Made for ${username} · songs you hearted`,
      accent: "#c084fc",
      badge: null,
      coverSeed: `liked-mix-${username}`,
      tracks: shuffled.map(toDto),
    });
  }

  // Library radio cold-fill if still empty
  if (mixes.length === 0 && catalog.length >= 3) {
    const shuffled = seededShuffle(catalog, `radio-${day}-${userId}`).slice(
      0,
      30,
    );
    mixes.push({
      id: "library-radio",
      kind: "radio",
      title: "Library Radio",
      description: `Made for ${username} · from what’s on this server`,
      accent: "#94a3b8",
      badge: null,
      coverSeed: `library-radio-${username}`,
      tracks: shuffled.map(toDto),
    });
  }

  return { username, mixes };
}

/**
 * Song radio from a seed track: same artist first, then related library picks,
 * excluding taste-blocked tracks.
 */
export function buildSongRadio(
  userId: string,
  seed: TrackRow,
): MadeForTrack[] {
  return buildTasteAutoplay(userId, {
    seed,
    excludeIds: [seed.id],
    limit: 40,
  });
}

/**
 * Continuous queue filler from listen affinity (+ optional seed continuity).
 * Library/streamable files only — used when upcoming queue is empty.
 */
export function buildTasteAutoplay(
  userId: string,
  opts?: {
    seed?: TrackRow | null;
    seedArtist?: string;
    seedAlbum?: string;
    excludeIds?: Iterable<string>;
    limit?: number;
  },
): MadeForTrack[] {
  const limit = Math.max(1, Math.min(opts?.limit ?? 28, 60));
  const excluded = new Set(listTasteExcludeIds(userId));
  for (const id of opts?.excludeIds || []) {
    if (id) excluded.add(id);
  }
  if (opts?.seed?.id) excluded.add(opts.seed.id);

  const catalog = streamableCatalog(500, excluded);
  if (catalog.length === 0) return [];

  const { scores } = listenArtistAffinity(userId);
  let maxTaste = 1;
  for (const v of scores.values()) if (v > maxTaste) maxTaste = v;
  const hasTaste = scores.size > 0 && maxTaste > 1;

  const seedArtist = artistKey(
    opts?.seed?.artist || opts?.seedArtist || "",
  );
  const seedAlbum = (
    opts?.seed?.album ||
    opts?.seedAlbum ||
    ""
  )
    .trim()
    .toLowerCase();

  const day = new Date().toISOString().slice(0, 10);
  // Stable jitter so the same session isn’t identical every fill, but not pure random.
  const jitterSeed = `auto-${userId}-${day}-${seedArtist || "x"}-${excluded.size}`;

  const scored = catalog.map((t, i) => {
    const ak = artistKey(t.artist);
    const tasteRaw = scores.get(ak) || 0;
    const tasteNorm = hasTaste ? Math.min(1, tasteRaw / maxTaste) : 0;
    let score = hasTaste ? tasteNorm * 0.72 : 0.2;

    if (seedArtist && ak === seedArtist) score += 0.28;
    if (
      seedAlbum &&
      t.album.trim().toLowerCase() === seedAlbum &&
      seedArtist &&
      ak === seedArtist
    ) {
      score += 0.18;
    }

    // Mild position-stable jitter (not Math.random each request)
    let h = 2166136261;
    const key = `${jitterSeed}:${t.id}:${i}`;
    for (let c = 0; c < key.length; c++) {
      h ^= key.charCodeAt(c);
      h = Math.imul(h, 16777619);
    }
    score += (Math.abs(h) % 1000) / 1000 * 0.12;

    return { t, score, ak };
  });

  scored.sort((a, b) => b.score - a.score);

  const out: TrackRow[] = [];
  const perArtist = new Map<string, number>();
  for (const row of scored) {
    const n = perArtist.get(row.ak) || 0;
    // Keep variety — seed artist can appear a bit more
    const cap = row.ak && row.ak === seedArtist ? 4 : 2;
    if (n >= cap) continue;
    perArtist.set(row.ak, n + 1);
    out.push(row.t);
    if (out.length >= limit) break;
  }

  return out.map(toDto);
}


