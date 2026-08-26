/**
 * Playlist recommender — seeds from tracks already in the playlist.
 * Expands via Deezer related artists, ranks library tracks not yet on the list.
 */

import {
  listPlaylistTracksById,
  listTasteExcludeIds,
  listTracksByArtist,
  searchTracksLocal,
  type TrackRow,
} from "@/lib/db";
import { relatedArtistNames } from "@/lib/explore-recommend";
import { primaryArtistName } from "@/lib/artist-portrait";

export type PlaylistRecommendTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverPath: string | null;
  score: number;
  reason: "same_artist" | "related_artist" | "co_listen";
};

function artistKey(artist: string) {
  return (
    primaryArtistName(artist).trim().toLowerCase() ||
    artist.trim().toLowerCase()
  );
}

function trackKey(t: { artist: string; title: string }) {
  return `${artistKey(t.artist)}::${t.title.trim().toLowerCase()}`;
}

/** Pull library rows for an artist (exact + soft search fallback). */
function libraryTracksForArtist(name: string, limit: number): TrackRow[] {
  const exact = listTracksByArtist(name, limit);
  if (exact.length >= Math.min(8, limit)) return exact;
  const seen = new Set(exact.map((t) => t.id));
  const out = [...exact];
  for (const hit of searchTracksLocal(name, limit * 2)) {
    if (seen.has(hit.id)) continue;
    if (artistKey(hit.artist) !== artistKey(name)) {
      // Allow featuring / multi-artist credits that contain the seed
      const hay = hit.artist.toLowerCase();
      const needle = artistKey(name);
      if (!needle || !hay.includes(needle)) continue;
    }
    seen.add(hit.id);
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Recommend library tracks for a playlist based on its current songs.
 */
export async function recommendTracksForPlaylist(
  playlistId: string,
  opts?: { userId?: string; limit?: number },
): Promise<PlaylistRecommendTrack[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 12, 1), 40);
  const seeds = listPlaylistTracksById(playlistId);
  if (seeds.length === 0) return [];

  const excludeIds = new Set(seeds.map((t) => t.id));
  const excludeKeys = new Set(seeds.map((t) => trackKey(t)));
  if (opts?.userId) {
    for (const id of listTasteExcludeIds(opts.userId)) excludeIds.add(id);
  }

  /** Artist weight from how often they appear on the playlist. */
  const artistScores = new Map<string, number>();
  const artistLabels = new Map<string, string>();
  for (const t of seeds) {
    const k = artistKey(t.artist);
    if (!k) continue;
    const display = primaryArtistName(t.artist).trim() || t.artist.trim();
    if (!artistLabels.has(k)) artistLabels.set(k, display);
    artistScores.set(k, (artistScores.get(k) || 0) + 1);
  }

  const rankedSeeds = [...artistScores.entries()].sort((a, b) => b[1] - a[1]);
  const topSeeds = rankedSeeds.slice(0, 8);

  type Cand = {
    track: TrackRow;
    score: number;
    reason: PlaylistRecommendTrack["reason"];
  };
  const candidates = new Map<string, Cand>();

  function consider(
    track: TrackRow,
    base: number,
    reason: PlaylistRecommendTrack["reason"],
  ) {
    if (excludeIds.has(track.id)) return;
    if (excludeKeys.has(trackKey(track))) return;
    const prev = candidates.get(track.id);
    if (prev && prev.score >= base) return;
    candidates.set(track.id, { track, score: base, reason });
  }

  // Same-artist deeper cuts from the library
  for (const [key, weight] of topSeeds) {
    const name = artistLabels.get(key) || key;
    const rows = libraryTracksForArtist(name, 24);
    rows.forEach((row, idx) => {
      const recencyBoost = Math.max(0.4, 1 - idx / 24);
      consider(row, 40 * weight * recencyBoost, "same_artist");
    });
  }

  // Related-artist expansion (Deezer) → match into local library
  await Promise.all(
    topSeeds.slice(0, 6).map(async ([key, weight], seedIdx) => {
      const name = artistLabels.get(key) || key;
      const related = await relatedArtistNames(name, 5).catch(() => [] as string[]);
      related.forEach((relName, relIdx) => {
        const rk = artistKey(relName);
        if (!rk || artistScores.has(rk)) return;
        const inherit = weight * (0.65 - seedIdx * 0.05 - relIdx * 0.08);
        if (inherit <= 0.15) return;
        const rows = libraryTracksForArtist(relName, 12);
        rows.forEach((row, idx) => {
          consider(
            row,
            22 * inherit * Math.max(0.35, 1 - idx / 12),
            "related_artist",
          );
        });
      });
    }),
  );

  // Album co-occurrence: other tracks from albums already on the playlist
  const albumCounts = new Map<string, { artist: string; album: string; n: number }>();
  for (const t of seeds) {
    const album = t.album?.trim();
    if (!album) continue;
    const k = `${artistKey(t.artist)}::${album.toLowerCase()}`;
    const prev = albumCounts.get(k);
    if (prev) prev.n += 1;
    else albumCounts.set(k, { artist: t.artist, album, n: 1 });
  }
  for (const { artist, album, n } of albumCounts.values()) {
    const rows = libraryTracksForArtist(primaryArtistName(artist) || artist, 30);
    for (const row of rows) {
      if (row.album.trim().toLowerCase() !== album.toLowerCase()) continue;
      consider(row, 28 * n, "co_listen");
    }
  }

  // Diversity: cap per artist in the final list
  const sorted = [...candidates.values()].sort((a, b) => b.score - a.score);
  const artistHits = new Map<string, number>();
  const out: PlaylistRecommendTrack[] = [];
  for (const c of sorted) {
    const ak = artistKey(c.track.artist);
    const hits = artistHits.get(ak) || 0;
    if (hits >= 3) continue;
    artistHits.set(ak, hits + 1);
    out.push({
      id: c.track.id,
      title: c.track.title,
      artist: c.track.artist,
      album: c.track.album,
      duration: c.track.duration,
      coverPath: c.track.coverPath,
      score: Math.round(c.score * 100) / 100,
      reason: c.reason,
    });
    if (out.length >= limit) break;
  }
  return out;
}
