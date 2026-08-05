import { z } from "zod";
import { json, getAuthUser } from "@/lib/api";
import {
  createRequest,
  findTrack,
  getSettings,
  listRequestEvents,
  listRequests,
  requestStats,
  updateRequestStatus,
} from "@/lib/db";
import { LidarrClient } from "@/lib/lidarr";
import { enqueueFallbackDownload } from "@/lib/fallback-download";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("stats") === "1") {
    return json({ stats: requestStats() });
  }
  const id = searchParams.get("id");
  if (id) {
    const events = listRequestEvents(id);
    return json({ events });
  }
  return json({ requests: listRequests(200), stats: requestStats() });
}

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
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;
  const settings = getSettings();
  const user = await getAuthUser();
  const query = `${body.artist} ${body.album || body.title}`.trim();
  const foreignArtistId = body.foreignArtistId || body.foreignId || undefined;
  const foreignAlbumId = body.foreignAlbumId || undefined;

  // Track-type + auto: prefer downtify so audio is streamable without waiting on Lidarr.
  const streamFirst =
    body.prefer === "auto" &&
    settings.fallbackEnabled &&
    body.type === "track";
  const wantFallback =
    body.prefer === "fallback" ||
    streamFirst ||
    (body.prefer === "auto" && settings.fallbackEnabled);
  const wantLidarr = body.prefer !== "fallback" && !streamFirst;

  // Already on disk (incl. prior downtify acquire) → stream immediately
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

  // Artist request via Lidarr
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

  // Album / artist discover via Lidarr
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
      error:
        "Could not queue via Lidarr, and fallback downloads are disabled in settings",
    });
    return json(
      {
        error:
          "Could not queue via Lidarr, and fallback downloads are disabled in settings",
        request: failed,
      },
      { status: 400 },
    );
  }

  // Create request first so download can link request_id
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

  // Deduped active request that already has work in flight
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
      message: "Fallback download started — will stream when ready",
    }) || request;

  return json({
    request,
    job,
    path: "fallback",
    streamWhenReady: true,
  });
}
