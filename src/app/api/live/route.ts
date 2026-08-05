import { getAuthUser, json } from "@/lib/api";
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
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    artist?: string;
    title?: string;
    album?: string;
  } | null;

  const artist = body?.artist?.trim() || "";
  const title = body?.title?.trim() || "";
  if (!artist || !title) {
    return json({ error: "artist and title required" }, { status: 400 });
  }

  const local = findTrack(artist, title);
  if (local) {
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
    });
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
    album: body?.album,
  });
  if (!session) {
    return json(
      { error: "Could not resolve a live stream for this track" },
      { status: 404 },
    );
  }

  return json({
    mode: "live",
    track: {
      id: session.id,
      title,
      artist,
      album: body?.album || title,
      streamUrl: session.streamUrl,
    },
    streamUrl: session.streamUrl,
  });
}
