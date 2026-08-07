import {
  albumCoverKey,
  artistCoverKey,
  coverFrom,
  getAlbumCoverMap,
  getArtistCoverMap,
  LidarrClient,
  resolveTrackCover,
} from "@/lib/lidarr";
import type { RequestRow } from "@/lib/db";

/** Sync cover from Lidarr library maps (+ CAA for album MBID). */
export function coverFromRequestMaps(
  r: Pick<
    RequestRow,
    | "mediaType"
    | "title"
    | "artist"
    | "album"
    | "foreignArtistId"
    | "foreignAlbumId"
  >,
  albumCovers: Map<string, string>,
  artistCovers: Map<string, string>,
): string | null {
  if (r.mediaType === "artist") {
    return (
      (r.foreignArtistId
        ? artistCovers.get(`mbid:${r.foreignArtistId}`)
        : null) ||
      artistCovers.get(artistCoverKey(r.artist)) ||
      artistCovers.get(artistCoverKey(r.title)) ||
      null
    );
  }

  const album = (r.album || r.title || "").trim();
  const fromLidarr = album
    ? albumCovers.get(albumCoverKey(r.artist, album)) || null
    : null;
  if (fromLidarr) return fromLidarr;
  if (r.foreignAlbumId) {
    return `https://coverartarchive.org/release-group/${encodeURIComponent(r.foreignAlbumId)}/front-500`;
  }
  return artistCovers.get(artistCoverKey(r.artist)) || null;
}

/**
 * Resolve art for a request: library maps, then Lidarr lookup / CAA.
 * Used by notifications + request list.
 */
export async function resolveRequestCover(
  r: Pick<
    RequestRow,
    | "mediaType"
    | "title"
    | "artist"
    | "album"
    | "foreignArtistId"
    | "foreignAlbumId"
  >,
): Promise<string | null> {
  const [albumCovers, artistCovers] = await Promise.all([
    getAlbumCoverMap(),
    getArtistCoverMap(),
  ]);
  const mapped = coverFromRequestMaps(r, albumCovers, artistCovers);
  if (mapped) return mapped;

  if (r.mediaType === "track" || r.mediaType === "album") {
    const fromTrack = await resolveTrackCover({
      coverPath: null,
      artist: r.artist,
      album: r.album || r.title,
    });
    if (fromTrack) return fromTrack;
  }

  const client = LidarrClient.fromSettings();
  if (!client) return null;

  if (r.mediaType === "artist") {
    const term = r.foreignArtistId
      ? `lidarr:${r.foreignArtistId}`
      : r.artist || r.title;
    const hits = await client.searchArtists(term).catch(() => []);
    const key = (r.artist || r.title).trim().toLowerCase();
    const best =
      hits.find((a) => a.foreignArtistId === r.foreignArtistId) ||
      hits.find((a) => (a.artistName || "").trim().toLowerCase() === key) ||
      hits[0];
    return coverFrom(best?.images) || null;
  }

  const term = `${r.artist} ${r.title}`.trim();
  const hits = await client.searchAlbums(term).catch(() => []);
  const titleKey = r.title.trim().toLowerCase();
  const artistKey = r.artist.trim().toLowerCase();
  const best =
    hits.find(
      (a) =>
        (a.title || "").trim().toLowerCase() === titleKey &&
        (a.artist?.artistName || "")
          .trim()
          .toLowerCase()
          .includes(artistKey.slice(0, 12)),
    ) || hits[0];
  const img = coverFrom(best?.images);
  if (img) return img;
  if (best?.foreignAlbumId) {
    return `https://coverartarchive.org/release-group/${encodeURIComponent(best.foreignAlbumId)}/front-500`;
  }
  return null;
}
