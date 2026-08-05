import { z } from "zod";
import { json, getAuthUser, getAdminUser } from "@/lib/api";
import {
  createRequest,
  findTrack,
  getSettings,
  listRequestEvents,
  listRequests,
  requestStats,
  updateRequestStatus,
  type RequestRow,
} from "@/lib/db";
import { albumCoverKey, artistCoverKey, getAlbumCoverMap, getArtistCoverMap, LidarrClient } from "@/lib/lidarr";
import {
  enqueueFallbackDownload,
  stopDownloadJob,
  stopRequest,
} from "@/lib/fallback-download";

export const dynamic = "force-dynamic";

function requestCover(
  r: RequestRow,
  albumCovers: Map<string, string>,
  artistCovers: Map<string, string>,
): string | null {
  if (r.mediaType === "artist") {
    return (
      (r.foreignArtistId
        ? artistCovers.get(`mbid:${r.foreignArtistId}`)
        : null) ||
      artistCovers.get(artistCoverKey(r.artist)) ||
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  // Stats OK for dashboard badges; full log is admin-only.
  if (searchParams.get("stats") === "1") {
    return json({ stats: requestStats() });
  }
  const admin = await getAdminUser();
  if (!admin) {
    return json({ error: "Admin only" }, { status: 403 });
  }
  const id = searchParams.get("id");
  if (id) {
    return json({ events: listRequestEvents(id) });
  }
  const [albumCovers, artistCovers] = await Promise.all([
    getAlbumCoverMap(),
    getArtistCoverMap(),
  ]);
  const requests = listRequests(200).map((r) => ({
    ...r,
    coverPath: requestCover(r, albumCovers, artistCovers),
  }));
  return json({ requests, stats: requestStats() });
}

const stopSchema = z.object({
  action: z.literal("stop"),
  requestId: z.string().optional(),
  jobId: z.string().optional(),
});

const schema = z.object({
  title: z.string().min(1),
  artist: z.string().min(1),
  album: z.string().optional(),
  foreignId: z.string().optional(),
  foreignArtistId: z.string().optional(),
  foreignAlbumId: z.string().optional(),
  type: z.enum(["artist", "album", "track"]).default("album"),
  prefer: z.enum(["lidarr", "fallback", "auto"]).default("auto"),
});

export async function POST(req: Request) {
  const raw = await req.json();

  // Admin stop signal
  if (raw && typeof raw === "object" && raw.action === "stop") {
    const admin = await getAdminUser();
    if (!admin) {
      return json({ error: "Admin only" }, { status: 403 });
    }
    const parsed = stopSchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { requestId, jobId } = parsed.data;
    if (!requestId && !jobId) {
      return json({ error: "requestId or jobId required" }, { status: 400 });
    }
    if (jobId) {
      const r = stopDownloadJob(jobId);
      return r.ok
        ? json({ ok: true, stopped: "job", jobId })
        : json({ error: r.error }, { status: 400 });
    }
    const r = stopRequest(requestId!);
    return r.ok
      ? json({ ok: true, stopped: "request", requestId })
      : json({ error: r.error }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;
  const settings = getSettings();
  const user = await getAuthUser();
  const query =
    body.type === "track"
      ? `${body.artist} ${body.title}`.trim()
      : `${body.artist} ${body.album || body.title}`.trim();
  const foreignArtistId = body.foreignArtistId || body.foreignId || undefined;
  const foreignAlbumId = body.foreignAlbumId || undefined;

  const streamFirst =
    body.prefer === "auto" &&
    settings.fallbackEnabled &&
    body.type === "track";
  const wantFallback =
    body.prefer === "fallback" ||
    streamFirst ||
    (body.prefer === "auto" && settings.fallbackEnabled);
  const wantLidarr = body.prefer !== "fallback" && !streamFirst;

  const existing = findTrack(body.artist, body.title);
  if (existing) {
    return json({
      request: null,
      path: "library",
      alreadyAvailable: true,
      track: {
        id: existing.id,
        title: existing.title,
        artist: existing.artist,
        album: existing.album,
        duration: existing.duration,
        source: existing.source,
      },
      streamUrl: `/api/stream/${existing.id}`,
    });
  }

  const base = {
    title: body.title,
    artist: body.artist,
    album: body.album || body.title,
    mediaType: body.type as "artist" | "album" | "track",
    foreignArtistId: foreignArtistId ?? null,
    foreignAlbumId: foreignAlbumId ?? null,
    requestedBy: user?.username ?? null,
  };

  if (wantLidarr && foreignArtistId && body.type === "artist") {
    try {
      const client = LidarrClient.fromSettings();
      if (!client) throw new Error("Lidarr is not configured");
      const artist = await client.requestArtist(foreignArtistId, body.artist);
      const request = createRequest({
        ...base,
        status: "queued",
        source: "lidarr",
        externalId: String(artist.id ?? foreignArtistId),
        lidarrArtistId: artist.id ?? null,
        foreignArtistId,
      });
      if (request.status === "available") {
        return json({ request, path: "library", alreadyAvailable: true });
      }
      return json({ request, path: "lidarr" });
    } catch (err) {
      if (!wantFallback) {
        return json(
          {
            error: err instanceof Error ? err.message : "Lidarr request failed",
          },
          { status: 400 },
        );
      }
    }
  }

  if (wantLidarr && body.type !== "track") {
    try {
      const client = LidarrClient.fromSettings();
      if (client) {
        const lookup = await client.lookup(`${body.artist} ${body.title}`);
        const artistHit =
          lookup.find(
            (r) =>
              r.type === "artist" &&
              (r.foreignId === foreignArtistId ||
                r.artist.toLowerCase() === body.artist.toLowerCase()),
          ) || lookup.find((r) => r.type === "artist");

        if (artistHit?.foreignId) {
          const artist = await client.requestArtist(
            artistHit.foreignId,
            body.artist,
          );
          const request = createRequest({
            ...base,
            status: "queued",
            source: "lidarr",
            externalId: artistHit.foreignId,
            foreignArtistId: artistHit.foreignId,
            lidarrArtistId: artist.id ?? null,
          });
          if (request.status === "available") {
            return json({ request, path: "library", alreadyAvailable: true });
          }
          return json({ request, path: "lidarr" });
        }
      }
    } catch (err) {
      if (!wantFallback) {
        return json(
          {
            error: err instanceof Error ? err.message : "Lidarr request failed",
          },
          { status: 400 },
        );
      }
    }
  }

  if (!settings.fallbackEnabled && body.prefer !== "fallback") {
    const failed = createRequest({
      ...base,
      status: "failed",
      source: "lidarr",
      error: "Could not queue via Lidarr, and acquire path is not available",
    });
    return json(
      {
        error: "Could not queue via Lidarr, and acquire path is not available",
        request: failed,
      },
      { status: 400 },
    );
  }

  let request = createRequest({
    ...base,
    status: "pending",
    source: "fallback",
  });

  if (request.status === "available") {
    const track = findTrack(body.artist, body.title);
    return json({
      request,
      path: "library",
      alreadyAvailable: true,
      track: track
        ? {
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.duration,
            source: track.source,
          }
        : null,
      streamUrl: track ? `/api/stream/${track.id}` : null,
    });
  }

  if (request.downloadJobId || request.status !== "pending") {
    return json({ request, path: request.source, deduped: true });
  }

  const job = await enqueueFallbackDownload({
    query,
    title: body.title,
    artist: body.artist,
    requestId: request.id,
  });

  request =
    updateRequestStatus(request.id, "downloading", {
      downloadJobId: job.id,
      message: "Acquire started — will stream when ready",
    }) || request;

  return json({
    request,
    job,
    path: "fallback",
    streamWhenReady: true,
  });
}
