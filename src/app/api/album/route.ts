import { json } from "@/lib/api";
import {
  findTrack,
  getSettings,
  listOfflineTrackIds,
  listTracksForAlbum,
  setAlbumCover,
} from "@/lib/db";
import {
  LidarrClient,
  relevanceScore,
  resolveTrackCover,
  type LidarrAlbum,
} from "@/lib/lidarr";
import {
  findReleaseGroupId,
  releaseGroupMeta,
  tracksForReleaseGroup,
} from "@/lib/musicbrainz";
import { ytDlpAvailable } from "@/lib/fallback-download";
import { titleLooksExplicit, formatTrackArtistLine } from "@/lib/utils";

export const dynamic = "force-dynamic";

export type AlbumTrackDto = {
  key: string;
  title: string;
  trackNumber: number;
  duration: number;
  available: boolean;
  downloaded: boolean;
  hasFile: boolean;
  localTrackId: string | null;
  streamUrl: string | null;
  explicit: boolean;
  /** Display artists (album artist + features when known). */
  artists: string;
};

function coverFromAlbum(a: LidarrAlbum): string | undefined {
  const imgs = a.images;
  if (!imgs?.length) return undefined;
  const preferred =
    imgs.find((i) => i.coverType === "cover") ||
    imgs.find((i) => i.coverType === "poster") ||
    imgs[0];
  const url = preferred?.remoteUrl || preferred?.url;
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  return url;
}

function mapLocalFallback(
  artist: string,
  albumTitle: string,
  offline: Set<string>,
): AlbumTrackDto[] {
  return listTracksForAlbum(artist, albumTitle).map((t, i) => ({
    key: `local-${t.id}`,
    title: t.title,
    trackNumber: i + 1,
    duration: t.duration || 0,
    available: true,
    downloaded: offline.has(t.id),
    hasFile: true,
    localTrackId: t.id,
    streamUrl: `/api/stream/${t.id}`,
    explicit: titleLooksExplicit(t.title),
    artists: formatTrackArtistLine(artist, t.title),
  }));
}

function mergeAvailability(
  tracks: AlbumTrackDto[],
  artist: string,
  offline: Set<string>,
): AlbumTrackDto[] {
  return tracks.map((t) => {
    const local = findTrack(artist, t.title);
    if (!local) return t;
    return {
      ...t,
      available: true,
      downloaded: offline.has(local.id) || t.downloaded,
      localTrackId: local.id,
      streamUrl: `/api/stream/${local.id}`,
      duration: t.duration || local.duration || 0,
    };
  });
}

/**
 * Catalog album detail: Lidarr / MusicBrainz tracklist merged with local library.
 * Resolves album by lidarr id, foreign MBID, or artist+title lookup.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  let title = (searchParams.get("title") || "").trim();
  let artist = (searchParams.get("artist") || "").trim();
  let foreignAlbumId = (searchParams.get("foreignAlbumId") || "").trim();
  const image = (searchParams.get("image") || "").trim() || undefined;
  const lidarrAlbumIdRaw = searchParams.get("lidarrAlbumId");
  let lidarrAlbumId = lidarrAlbumIdRaw
    ? Number.parseInt(lidarrAlbumIdRaw, 10)
    : NaN;

  if (!title && !artist && !foreignAlbumId && !Number.isFinite(lidarrAlbumId)) {
    return json(
      { error: "album id, title/artist, or foreignAlbumId required" },
      { status: 400 },
    );
  }

  const settings = getSettings();
  const offline = new Set(listOfflineTrackIds());
  const client = LidarrClient.fromSettings();

  let tracks: AlbumTrackDto[] = [];
  let source: "lidarr" | "musicbrainz" | "library" | "none" = "none";
  let resolvedImage = image;
  let year: number | undefined;
  let error: string | null = null;

  try {
    if (client) {
      let albumId = Number.isFinite(lidarrAlbumId) ? lidarrAlbumId : null;

      // Resolve via foreign MBID already in Lidarr library
      if (!albumId && foreignAlbumId) {
        const byForeign = await client
          .getAlbumByForeignId(foreignAlbumId)
          .catch(() => []);
        if (byForeign[0]) {
          albumId = byForeign[0].id ?? null;
          if (!title) title = (byForeign[0].title || "").trim();
          if (!artist) {
            artist = (byForeign[0].artist?.artistName || "").trim();
          }
          if (!resolvedImage) resolvedImage = coverFromAlbum(byForeign[0]);
          if (byForeign[0].releaseDate) {
            year = Number(byForeign[0].releaseDate.slice(0, 4)) || undefined;
          }
          if (!foreignAlbumId && byForeign[0].foreignAlbumId) {
            foreignAlbumId = byForeign[0].foreignAlbumId;
          }
        }
      }

      // Resolve meta from lidarr album id when title/artist missing
      if (albumId && albumId > 0 && (!title || !artist)) {
        const byId = await client.getAlbum(albumId).catch(() => null);
        if (byId) {
          if (!title) title = (byId.title || "").trim();
          if (!artist) artist = (byId.artist?.artistName || "").trim();
          if (!foreignAlbumId && byId.foreignAlbumId) {
            foreignAlbumId = byId.foreignAlbumId;
          }
          if (!resolvedImage) resolvedImage = coverFromAlbum(byId);
          if (byId.releaseDate) {
            year = Number(byId.releaseDate.slice(0, 4)) || undefined;
          }
        }
      }

      // Resolve via artist + title lookup (library sidebar / partial downloads)
      if (!albumId && title && artist) {
        const term = `${artist} ${title}`;
        const hits = await client.searchAlbums(term).catch(() => []);
        const ranked = [...hits]
          .map((a) => {
            const aTitle = a.title || "";
            const aArtist = a.artist?.artistName || "";
            return {
              album: a,
              score: relevanceScore(term, aTitle, aArtist),
            };
          })
          .filter((x) => x.score >= 45)
          .sort((a, b) => b.score - a.score);

        // Prefer exact-ish title match for this artist
        const best =
          ranked.find(
            (x) =>
              (x.album.title || "").trim().toLowerCase() ===
                title.toLowerCase() &&
              (x.album.artist?.artistName || "")
                .trim()
                .toLowerCase()
                .includes(artist.toLowerCase().slice(0, 12)),
          ) || ranked[0];

        if (best?.album) {
          // Lookup hits for albums not in Lidarr often have id 0 / missing —
          // only use a real library id for /track?albumId=
          const rawId = best.album.id;
          albumId =
            typeof rawId === "number" && rawId > 0 ? rawId : null;
          if (!foreignAlbumId && best.album.foreignAlbumId) {
            foreignAlbumId = best.album.foreignAlbumId;
          }
          if (!resolvedImage) resolvedImage = coverFromAlbum(best.album);
          if (best.album.releaseDate) {
            year = Number(best.album.releaseDate.slice(0, 4)) || undefined;
          }
        }
      }

      if (albumId && albumId > 0) {
        lidarrAlbumId = albumId;
        if (!foreignAlbumId || !title || !artist) {
          const byId = await client.getAlbum(albumId).catch(() => null);
          if (byId) {
            if (!title) title = (byId.title || "").trim();
            if (!artist) artist = (byId.artist?.artistName || "").trim();
            if (!foreignAlbumId && byId.foreignAlbumId) {
              foreignAlbumId = byId.foreignAlbumId;
            }
            if (!resolvedImage) resolvedImage = coverFromAlbum(byId);
            if (!year && byId.releaseDate) {
              year = Number(byId.releaseDate.slice(0, 4)) || undefined;
            }
          }
        }
        const lidarrTracks = await client.getAlbumTracks(albumId);
        if (lidarrTracks.length > 0) {
          source = "lidarr";
          tracks = lidarrTracks
            .map((t, i) => {
              const trackTitle = (t.title || "").trim();
              const trackNumber =
                t.absoluteTrackNumber ||
                Number.parseInt(t.trackNumber || "", 10) ||
                i + 1;
              const durationSec = t.duration
                ? Math.round(t.duration / 1000)
                : 0;
              const local = findTrack(artist, trackTitle);
              return {
                key: `lidarr-${t.id ?? `${trackNumber}-${trackTitle}`}`,
                title: trackTitle,
                trackNumber,
                duration: durationSec,
                available: Boolean(local),
                downloaded: local ? offline.has(local.id) : false,
                hasFile: Boolean(t.hasFile),
                localTrackId: local?.id ?? null,
                streamUrl: local ? `/api/stream/${local.id}` : null,
                explicit: Boolean(t.explicit) || titleLooksExplicit(trackTitle),
                artists: formatTrackArtistLine(artist, trackTitle),
              } satisfies AlbumTrackDto;
            })
            .filter((t) => t.title)
            .sort((a, b) => a.trackNumber - b.trackNumber);

          // Lidarr track payloads omit guest credits — merge MusicBrainz when possible
          if (tracks.length > 0 && foreignAlbumId) {
            try {
              const mb = await tracksForReleaseGroup(foreignAlbumId);
              if (mb.length > 0) {
                const byTitle = new Map(
                  mb.map((t) => [t.title.trim().toLowerCase(), t] as const),
                );
                tracks = tracks.map((t) => {
                  const hit = byTitle.get(t.title.trim().toLowerCase());
                  if (!hit?.artists) return t;
                  return {
                    ...t,
                    artists: formatTrackArtistLine(
                      artist,
                      t.title,
                      hit.artists,
                    ),
                  };
                });
              }
            } catch {
              /* non-fatal */
            }
          }
        }
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Lidarr tracklist failed";
  }

  // Fill title/artist from MusicBrainz when only MBID was supplied
  if (foreignAlbumId && (!title || !artist)) {
    const meta = await releaseGroupMeta(foreignAlbumId).catch(() => null);
    if (meta) {
      if (!title) title = meta.title;
      if (!artist) artist = meta.artist;
    }
  }

  if (!title || !artist) {
    return json(
      { error: "Could not resolve album title and artist" },
      { status: 404 },
    );
  }

  // MusicBrainz when Lidarr had no tracklist
  if (tracks.length === 0) {
    try {
      if (!foreignAlbumId && title && artist) {
        foreignAlbumId =
          (await findReleaseGroupId(artist, title)) || "";
      }
      if (foreignAlbumId) {
        const mb = await tracksForReleaseGroup(foreignAlbumId);
        if (mb.length > 0) {
          source = "musicbrainz";
          tracks = mergeAvailability(
            mb.map((t) => ({
              key: `mb-${t.trackNumber}-${t.title}`,
              title: t.title,
              trackNumber: t.trackNumber,
              duration: t.durationMs ? Math.round(t.durationMs / 1000) : 0,
              available: false,
              downloaded: false,
              hasFile: false,
              localTrackId: null,
              streamUrl: null,
              explicit: titleLooksExplicit(t.title),
              artists: formatTrackArtistLine(artist, t.title, t.artists),
            })),
            artist,
            offline,
          );
          error = null;
        }
      }
    } catch (err) {
      if (!error) {
        error =
          err instanceof Error ? err.message : "MusicBrainz tracklist failed";
      }
    }
  } else {
    tracks = mergeAvailability(tracks, artist, offline);
  }

  // Always surface local files for this album (partial downloads)
  if (tracks.length === 0) {
    const local = mapLocalFallback(artist, title, offline);
    if (local.length) {
      source = "library";
      tracks = local;
      error = null;
    }
  }

  if (!resolvedImage) {
    resolvedImage =
      (await resolveTrackCover({
        coverPath: null,
        artist,
        album: title,
      })) || undefined;
  }

  // Cover Art Archive when Lidarr has no art (common for yt-dlp-only albums)
  if (!resolvedImage && foreignAlbumId) {
    resolvedImage = `https://coverartarchive.org/release-group/${encodeURIComponent(foreignAlbumId)}/front-500`;
  }

  if (resolvedImage) {
    try {
      setAlbumCover(artist, title, resolvedImage);
    } catch {
      /* non-fatal */
    }
  }

  const fallbackReady =
    settings.fallbackEnabled && (await ytDlpAvailable());

  return json({
    album: {
      title,
      artist,
      image: resolvedImage || null,
      year: year ?? null,
      foreignAlbumId: foreignAlbumId || null,
      lidarrAlbumId: Number.isFinite(lidarrAlbumId) ? lidarrAlbumId : null,
    },
    tracks,
    source,
    fallbackReady,
    error,
  });
}
