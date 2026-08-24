import { z } from "zod";
import { json, getAuthUser, getStaffUser } from "@/lib/api";
import {
  createRequest,
  findTrack,
  getSettings,
  listRequestEvents,
  listRequests,
  listStreamedTrackActivity,
  activityUserForUsername,
  requestStats,
  updateRequestStatus,
} from "@/lib/db";
import { coverFromRequestMaps } from "@/lib/request-cover";
import {
  coverFrom,
  getAlbumCoverMap,
  getArtistCoverMap,
  LidarrClient,
} from "@/lib/lidarr";
import {
  enqueueFallbackDownload,
  failTimedOutDownloads,
  stopDownloadJob,
  stopRequest,
} from "@/lib/fallback-download";
import { downloadPolicy } from "@/lib/bans";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  // Stats OK for dashboard badges; full log is admin-only.
  if (searchParams.get("stats") === "1") {
    return json({ stats: requestStats() });
  }
  const admin = await getStaffUser();
  if (!admin) {
    return json({ error: "Admin only" }, { status: 403 });
  }
  // Collapse hung downloads while the activity page is open.
  failTimedOutDownloads();
  const id = searchParams.get("id");
  if (id) {
    return json({ events: listRequestEvents(id) });
  }
  const [albumCovers, artistCovers] = await Promise.all([
    getAlbumCoverMap(),
    getArtistCoverMap(),
  ]);
  const requests = listRequests(200).map((r) => {
    const requester = activityUserForUsername(r.requestedBy);
    return {
      ...r,
      coverPath: coverFromRequestMaps(r, albumCovers, artistCovers),
      requester,
      streamers: requester ? [requester] : [],
    };
  });
  const streams = listStreamedTrackActivity(100);
  return json({ requests, streams, stats: requestStats() });
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
  image: z.string().min(1).max(2048).optional(),
  type: z.enum(["artist", "album", "track"]).default("album"),
  prefer: z.enum(["lidarr", "fallback", "auto"]).default("auto"),
});

export async function POST(req: Request) {
  const raw = await req.json();

  // Admin stop signal
  if (raw && typeof raw === "object" && raw.action === "stop") {
    const admin = await getStaffUser();
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
  if (user) {
    const dl = downloadPolicy(user.id);
    if (!dl.ok) {
      return json({ error: dl.error || "Downloads banned" }, { status: 403 });
    }
  }
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
    imageUrl: body.image?.trim() || null,
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
        imageUrl: base.imageUrl || coverFrom(artist.images) || null,
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
            imageUrl:
              base.imageUrl ||
              artistHit.image ||
              coverFrom(artist.images) ||
              null,
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
      error: "Could not queue via Lidarr, and download path is not available",
    });
    return json(
      {
        error: "Could not queue via Lidarr, and download path is not available",
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
    album: body.album || body.title,
    requestId: request.id,
  });

  request =
    updateRequestStatus(request.id, "downloading", {
      downloadJobId: job.id,
      message: "Download started — will stream when ready",
    }) || request;

  return json({
    request,
    job,
    path: "fallback",
    streamWhenReady: true,
  });
}
