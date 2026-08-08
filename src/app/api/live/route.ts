import { getAuthUserFromRequest, json } from "@/lib/api";
import {
  isRickrollTrack,
  RICKROLL,
  streamPolicy,
} from "@/lib/bans";
import { createLiveSession } from "@/lib/live-stream";
import { findTrack } from "@/lib/db";
import { ytDlpAvailable } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prefer local library; otherwise resolve a live remote stream (no download).
 * Body: { artist, title, album? }
 */
export async function POST(req: Request) {
  const user = getAuthUserFromRequest(req);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const policy = streamPolicy(user.id);
  if (!policy.ok) {
    return json({ error: policy.error || "Streaming banned" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    artist?: string;
    title?: string;
    album?: string;
  } | null;

  let artist = body?.artist?.trim() || "";
  let title = body?.title?.trim() || "";
  let album = body?.album?.trim() || "";

  if (policy.forceRickroll) {
    artist = RICKROLL.artist;
    title = RICKROLL.title;
    album = RICKROLL.album;
  } else if (!artist || !title) {
    return json({ error: "artist and title required" }, { status: 400 });
  }

  const local = findTrack(artist, title);
  if (local) {
    if (
      policy.forceRickroll &&
      !isRickrollTrack(local.artist, local.title)
    ) {
      // Force rickroll path below
    } else {
      return json({
        mode: "library",
        track: {
          id: local.id,
          title: local.title,
          artist: local.artist,
          album: local.album,
          coverPath: local.coverPath,
        },
        streamUrl: `/api/stream/${local.id}`,
        rickroll: policy.forceRickroll || undefined,
      });
    }
  }

  if (!(await ytDlpAvailable())) {
    return json(
      { error: "Live stream unavailable — yt-dlp not ready" },
      { status: 503 },
    );
  }

  const session = await createLiveSession({
    artist,
    title,
    album: album || title,
  });
  if (!session) {
    return json(
      {
        error: policy.forceRickroll
          ? "Could not load your only allowed track"
          : "Could not resolve a live stream for this track",
      },
      { status: 404 },
    );
  }

  return json({
    mode: "live",
    track: {
      id: session.id,
      title,
      artist,
      album: album || title,
      streamUrl: session.streamUrl,
    },
    streamUrl: session.streamUrl,
    rickroll: policy.forceRickroll || undefined,
  });
}
