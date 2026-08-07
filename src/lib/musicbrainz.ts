/**
 * MusicBrainz helpers for catalog tracklists + home browse.
 * foreignAlbumId from Lidarr is typically a MusicBrainz release-group MBID.
 */

import { formatArtistCredit } from "@/lib/utils";

export type MbTrack = {
  title: string;
  trackNumber: number;
  durationMs: number;
  /** Full recording artist credit when available (includes features). */
  artists?: string;
};

export type MbCatalogRelease = {
  id: string;
  title: string;
  artist: string;
  year?: number;
  image: string;
  foreignAlbumId: string;
  releaseDate?: string;
};

type MbArtistCredit = {
  name?: string;
  joinphrase?: string;
  artist?: { name?: string };
}[];

type MbReleaseGroup = {
  id?: string;
  title?: string;
  "first-release-date"?: string;
  "artist-credit"?: MbArtistCredit;
  releases?: { id: string; title?: string; status?: string }[];
};

type MbRelease = {
  id?: string;
  media?: {
    tracks?: {
      title?: string;
      number?: string;
      length?: number | null;
      recording?: {
        title?: string;
        length?: number | null;
        "artist-credit"?: MbArtistCredit;
      };
      "artist-credit"?: MbArtistCredit;
    }[];
  }[];
};

const UA = "Polarr/1.0 (https://github.com/KevinGuest/polarr)";
const MB_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const mbCache = new Map<string, { at: number; value: unknown }>();

function cacheGet<T>(key: string): T | undefined {
  const hit = mbCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > MB_TTL_MS) {
    mbCache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown) {
  mbCache.set(key, { at: Date.now(), value });
  // Cap size
  if (mbCache.size > 400) {
    const oldest = [...mbCache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [k] of oldest.slice(0, 80)) mbCache.delete(k);
  }
}

async function mbFetch<T>(path: string): Promise<T | null> {
  const cached = cacheGet<T>(path);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(`https://musicbrainz.org/ws/2${path}`, {
      headers: { Accept: "application/json", "User-Agent": UA },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as T;
    cacheSet(path, data);
    return data;
  } catch {
    return null;
  }
}

function parseTrackNumber(raw?: string, fallback = 0): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function caaFront(releaseGroupId: string, size = 500): string {
  return `https://coverartarchive.org/release-group/${encodeURIComponent(releaseGroupId)}/front-${size}`;
}

/** Resolve tracklist for a MusicBrainz release-group MBID. */
export async function tracksForReleaseGroup(
  releaseGroupId: string,
): Promise<MbTrack[]> {
  const mbid = releaseGroupId.trim();
  if (!mbid) return [];

  const trackCacheKey = `tracks:${mbid}`;
  const cachedTracks = cacheGet<MbTrack[]>(trackCacheKey);
  if (cachedTracks) return cachedTracks;

  const group = await mbFetch<MbReleaseGroup>(
    `/release-group/${encodeURIComponent(mbid)}?inc=releases&fmt=json`,
  );
  const releases = group?.releases || [];
  if (releases.length === 0) return [];

  // Prefer Official, then first release
  const preferred =
    releases.find((r) => (r.status || "").toLowerCase() === "official") ||
    releases[0];

  const release = await mbFetch<MbRelease>(
    `/release/${encodeURIComponent(preferred.id)}?inc=recordings+artist-credits&fmt=json`,
  );
  if (!release?.media?.length) return [];

  const tracks: MbTrack[] = [];
  let fallbackNum = 1;
  for (const medium of release.media) {
    for (const t of medium.tracks || []) {
      const title = (t.recording?.title || t.title || "").trim();
      if (!title) continue;
      const durationMs = t.length ?? t.recording?.length ?? 0;
      const artists =
        formatArtistCredit(t.recording?.["artist-credit"]) ||
        formatArtistCredit(t["artist-credit"]) ||
        undefined;
      tracks.push({
        title,
        trackNumber: parseTrackNumber(t.number, fallbackNum),
        durationMs: typeof durationMs === "number" ? durationMs : 0,
        artists,
      });
      fallbackNum += 1;
    }
  }
  cacheSet(trackCacheKey, tracks);
  return tracks;
}

type MbSearchHit = {
  id: string;
  title?: string;
  score?: number;
  "first-release-date"?: string;
  "artist-credit"?: MbArtistCredit;
};

/** Title + primary artist for a release-group MBID. */
export async function releaseGroupMeta(
  releaseGroupId: string,
): Promise<{ title: string; artist: string } | null> {
  const mbid = releaseGroupId.trim();
  if (!mbid) return null;
  const group = await mbFetch<{
    title?: string;
    "artist-credit"?: MbArtistCredit;
  }>(`/release-group/${encodeURIComponent(mbid)}?inc=artists&fmt=json`);
  const title = (group?.title || "").trim();
  const artist = formatArtistCredit(group?.["artist-credit"]);
  if (!title || !artist) return null;
  return { title, artist };
}

/** Find a release-group MBID by artist + album title. */
export async function findReleaseGroupId(
  artist: string,
  album: string,
): Promise<string | null> {
  const a = artist.trim();
  const t = album.trim();
  if (!a || !t) return null;
  const query = `artist:"${a.replace(/"/g, "")}" AND releasegroup:"${t.replace(/"/g, "")}"`;
  const data = await mbFetch<{ "release-groups"?: MbSearchHit[] }>(
    `/release-group?query=${encodeURIComponent(query)}&fmt=json&limit=5`,
  );
  const hits = data?.["release-groups"] || [];
  if (!hits.length) return null;

  const aLower = a.toLowerCase();
  const tLower = t.toLowerCase();
  const exact =
    hits.find((h) => {
      const title = (h.title || "").trim().toLowerCase();
      const credit = formatArtistCredit(h["artist-credit"]).toLowerCase();
      return title === tLower && credit === aLower;
    }) || hits[0];

  return exact?.id || null;
}

/** Browse recent / notable albums from MusicBrainz (home catalog shelves). */
export async function browseReleaseGroups(
  limit = 28,
  opts?: { year?: number; tag?: string; monthsBack?: number },
): Promise<MbCatalogRelease[]> {
  const year = opts?.year || new Date().getUTCFullYear();
  const tag = opts?.tag?.trim();
  const monthsBack = opts?.monthsBack;
  let dateClause = `firstreleasedate:[${year - 1}-01-01 TO ${year}-12-31]`;
  if (monthsBack != null && monthsBack > 0) {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - monthsBack);
    const a = start.toISOString().slice(0, 10);
    const b = end.toISOString().slice(0, 10);
    dateClause = `firstreleasedate:[${a} TO ${b}]`;
  }
  const queryParts = [
    "primarytype:album",
    "status:official",
    dateClause,
  ];
  if (tag) queryParts.push(`tag:${tag.replace(/\s+/g, "")}`);
  const query = queryParts.join(" AND ");
  const path = `/release-group?query=${encodeURIComponent(query)}&fmt=json&limit=${Math.min(limit, 50)}`;
  const data = await mbFetch<{ "release-groups"?: MbSearchHit[] }>(path);
  return mapReleaseGroupHits(data?.["release-groups"] || [], limit);
}

/** Albums for a specific artist (Explore personalization). */
export async function browseReleaseGroupsForArtist(
  artist: string,
  limit = 8,
): Promise<MbCatalogRelease[]> {
  const a = artist.trim().replace(/"/g, "");
  if (!a) return [];
  const query = `artist:"${a}" AND primarytype:album AND status:official`;
  const path = `/release-group?query=${encodeURIComponent(query)}&fmt=json&limit=${Math.min(limit, 25)}`;
  const data = await mbFetch<{ "release-groups"?: MbSearchHit[] }>(path);
  return mapReleaseGroupHits(data?.["release-groups"] || [], limit);
}

function mapReleaseGroupHits(
  hits: MbSearchHit[],
  limit: number,
): MbCatalogRelease[] {
  const out: MbCatalogRelease[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const id = (h.id || "").trim();
    const title = (h.title || "").trim();
    const artist = formatArtistCredit(h["artist-credit"]);
    if (!id || !title || !artist || seen.has(id)) continue;
    seen.add(id);
    const date = (h["first-release-date"] || "").slice(0, 4);
    out.push({
      id,
      title,
      artist,
      year: date ? Number(date) || undefined : undefined,
      image: caaFront(id, 500),
      foreignAlbumId: id,
      releaseDate: (h["first-release-date"] || "").slice(0, 10) || undefined,
    });
    if (out.length >= limit) break;
  }
  return out;
}
