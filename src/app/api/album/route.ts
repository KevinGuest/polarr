import { getAuthUser, json } from "@/lib/api";
import {
  findTrack,
  getSettings,
  listOfflineTrackIds,
  listTracksForAlbum,
  setAlbumCover,
} from "@/lib/db";
import {
  coverFrom,
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
import { resolveArtistPortrait } from "@/lib/artist-portrait";
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

type AlbumPayload = {
  album: {
    title: string;
    artist: string;
    image: string | null;
    artistImage: string | null;
    foreignArtistId: string | null;
    year: number | null;
    foreignAlbumId: string | null;
    lidarrAlbumId: number | null;
  };
  tracks: AlbumTrackDto[];
  source: "lidarr" | "musicbrainz" | "library" | "none";
  fallbackReady: boolean;
  error: string | null;
};

const albumResponseCache = new Map<
  string,
  { at: number; payload: AlbumPayload }
>();
const ALBUM_CACHE_TTL_MS = 2 * 60 * 1000;

function coverFromAlbum(a: LidarrAlbum): string | undefined {
  return coverFrom(a.images);
}

function artistIdFromAlbum(a: LidarrAlbum | null | undefined): string | undefined {
  return a?.artist?.foreignArtistId || undefined;
}

function caaCover(foreignAlbumId: string): string {
  return `https://coverartarchive.org/release-group/${encodeURIComponent(foreignAlbumId)}/front-500`;
}

function mapLocalFallback(artist: string, albumTitle: string): AlbumTrackDto[] {
  return listTracksForAlbum(artist, albumTitle).map((t, i) => ({
    key: `local-${t.id}`,
    title: t.title,
    trackNumber: i + 1,
    duration: t.duration || 0,
    available: true,
    downloaded: false,
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
): AlbumTrackDto[] {
  return tracks.map((t) => {
    const local = findTrack(artist, t.title);
    if (!local) return t;
    return {
      ...t,
      available: true,
      localTrackId: local.id,
      streamUrl: `/api/stream/${local.id}`,
      duration: t.duration || local.duration || 0,
    };
  });
}

/**
 * `downloaded` is per-user (offline marks) while the payload cache is shared —
 * so the cache stores neutral flags and each response overlays the viewer's.
 */
function withUserDownloads(
  payload: AlbumPayload,
  offline: Set<string>,
): AlbumPayload {
  return {
    ...payload,
    tracks: payload.tracks.map((t) => ({
      ...t,
      downloaded: Boolean(t.localTrackId && offline.has(t.localTrackId)),
    })),
  };
}

function cacheKey(params: URLSearchParams): string {
  return [
    params.get("title") || "",
    params.get("artist") || "",
    params.get("foreignAlbumId") || "",
    params.get("lidarrAlbumId") || "",
  ]
    .map((s) => s.trim().toLowerCase())
    .join("|");
}

/**
 * Catalog album detail: Lidarr / MusicBrainz tracklist merged with local library.
 * Resolves album by lidarr id, foreign MBID, or artist+title lookup.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const user = await getAuthUser();
  const offline = new Set(user ? listOfflineTrackIds(user.id) : []);
  const key = cacheKey(searchParams);
  const cached = albumResponseCache.get(key);
  if (cached && Date.now() - cached.at < ALBUM_CACHE_TTL_MS) {
    return json(withUserDownloads(cached.payload, offline), {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  }

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
  const client = LidarrClient.fromSettings();

  let tracks: AlbumTrackDto[] = [];
  let source: "lidarr" | "musicbrainz" | "library" | "none" = "none";
  let resolvedImage = image;
  let year: number | undefined;
  let error: string | null = null;
  let albumMetaLoaded: LidarrAlbum | null = null;
  let foreignArtistId: string | undefined;

  try {
    if (client) {
      let albumId = Number.isFinite(lidarrAlbumId) ? lidarrAlbumId : null;

      // Resolve via foreign MBID already in Lidarr library
      if (!albumId && foreignAlbumId) {
        const byForeign = await client
          .getAlbumByForeignId(foreignAlbumId)
          .catch(() => []);
        if (byForeign[0]) {
          albumMetaLoaded = byForeign[0];
          foreignArtistId =
            foreignArtistId || artistIdFromAlbum(byForeign[0]);
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
      if (albumId && albumId > 0 && (!title || !artist) && !albumMetaLoaded) {
        const byId = await client.getAlbum(albumId).catch(() => null);
        if (byId) {
          albumMetaLoaded = byId;
          foreignArtistId = foreignArtistId || artistIdFromAlbum(byId);
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
          albumMetaLoaded = best.album;
          foreignArtistId =
            foreignArtistId || artistIdFromAlbum(best.album);
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
        // Fill missing meta only if we never loaded this album already
        if (
          (!foreignAlbumId || !title || !artist || !year) &&
          !albumMetaLoaded
        ) {
          const byId = await client.getAlbum(albumId).catch(() => null);
          if (byId) {
            albumMetaLoaded = byId;
            foreignArtistId = foreignArtistId || artistIdFromAlbum(byId);
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
        } else if (albumMetaLoaded) {
          foreignArtistId =
            foreignArtistId || artistIdFromAlbum(albumMetaLoaded);
          if (!title) title = (albumMetaLoaded.title || "").trim();
          if (!artist) {
            artist = (albumMetaLoaded.artist?.artistName || "").trim();
          }
          if (!foreignAlbumId && albumMetaLoaded.foreignAlbumId) {
            foreignAlbumId = albumMetaLoaded.foreignAlbumId;
          }
          if (!resolvedImage) resolvedImage = coverFromAlbum(albumMetaLoaded);
          if (!year && albumMetaLoaded.releaseDate) {
            year =
              Number(albumMetaLoaded.releaseDate.slice(0, 4)) || undefined;
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
                downloaded: false,
                hasFile: Boolean(t.hasFile),
                localTrackId: local?.id ?? null,
                streamUrl: local ? `/api/stream/${local.id}` : null,
                explicit: Boolean(t.explicit) || titleLooksExplicit(trackTitle),
                artists: formatTrackArtistLine(artist, trackTitle),
              } satisfies AlbumTrackDto;
            })
            .filter((t) => t.title)
            .sort((a, b) => a.trackNumber - b.trackNumber);
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
    tracks = mergeAvailability(tracks, artist);
  }

  // Always surface local files for this album (partial downloads)
  if (tracks.length === 0) {
    const local = mapLocalFallback(artist, title);
    if (local.length) {
      source = "library";
      tracks = local;
      error = null;
    }
  }

  // Parallel tail: MB feature credits ∥ cover ∥ yt-dlp ready
  const needMbCredits =
    source === "lidarr" && tracks.length > 0 && Boolean(foreignAlbumId);
  // Prefer CAA when we have MBID — skip expensive listAlbums cover map
  if (!resolvedImage && foreignAlbumId) {
    resolvedImage = caaCover(foreignAlbumId);
  }

  const [mbCredits, coverHit, artistPortrait, fallbackReady] = await Promise.all([
    needMbCredits
      ? tracksForReleaseGroup(foreignAlbumId).catch(() => [] as Awaited<
          ReturnType<typeof tracksForReleaseGroup>
        >)
      : Promise.resolve([] as Awaited<ReturnType<typeof tracksForReleaseGroup>>),
    resolvedImage
      ? Promise.resolve(null as string | null)
      : resolveTrackCover({
          coverPath: null,
          artist,
          album: title,
        }).catch(() => null),
    resolveArtistPortrait({
      artist,
      foreignArtistId,
    }).catch(() => null),
    settings.fallbackEnabled
      ? ytDlpAvailable().catch(() => false)
      : Promise.resolve(false),
  ]);

  if (mbCredits.length > 0) {
    const byTitle = new Map(
      mbCredits.map((t) => [t.title.trim().toLowerCase(), t] as const),
    );
    tracks = tracks.map((t) => {
      const hit = byTitle.get(t.title.trim().toLowerCase());
      if (!hit?.artists) return t;
      return {
        ...t,
        artists: formatTrackArtistLine(artist, t.title, hit.artists),
      };
    });
  }

  if (!resolvedImage && coverHit) resolvedImage = coverHit;
  if (!resolvedImage && foreignAlbumId) resolvedImage = caaCover(foreignAlbumId);

  if (resolvedImage) {
    try {
      setAlbumCover(artist, title, resolvedImage);
    } catch {
      /* non-fatal */
    }
  }

  const payload: AlbumPayload = {
    album: {
      title,
      artist,
      image: resolvedImage || null,
      artistImage: artistPortrait || null,
      foreignArtistId: foreignArtistId || null,
      year: year ?? null,
      foreignAlbumId: foreignAlbumId || null,
      lidarrAlbumId: Number.isFinite(lidarrAlbumId) ? lidarrAlbumId : null,
    },
    tracks,
    source,
    fallbackReady: Boolean(fallbackReady),
    error,
  };

  albumResponseCache.set(key, { at: Date.now(), payload });
  if (albumResponseCache.size > 80) {
    const oldest = [...albumResponseCache.entries()].sort(
      (a, b) => a[1].at - b[1].at,
    );
    for (const [k] of oldest.slice(0, 20)) albumResponseCache.delete(k);
  }

  return json(withUserDownloads(payload, offline), {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
