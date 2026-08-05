/**
 * MusicBrainz helpers for catalog tracklists when Lidarr has no album id yet.
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

type MbArtistCredit = {
  name?: string;
  joinphrase?: string;
  artist?: { name?: string };
}[];

type MbReleaseGroup = {
  id?: string;
  title?: string;
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

const UA = "Polarr/1.0 (https://github.com/getumbrel/polarr)";

async function mbFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`https://musicbrainz.org/ws/2${path}`, {
      headers: { Accept: "application/json", "User-Agent": UA },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function parseTrackNumber(raw?: string, fallback = 0): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Resolve tracklist for a MusicBrainz release-group MBID. */
export async function tracksForReleaseGroup(
  releaseGroupId: string,
): Promise<MbTrack[]> {
  const mbid = releaseGroupId.trim();
  if (!mbid) return [];

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
  return tracks;
}

type MbSearchHit = {
  id: string;
  title?: string;
  score?: number;
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
