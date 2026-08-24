import { getAuthUserFromRequest, json } from "@/lib/api";
import {
  downloadPolicy,
  isRickrollTrack,
  RICKROLL,
  streamPolicy,
} from "@/lib/bans";
import { createLiveSession } from "@/lib/live-stream";
import { findTrack, getSettings } from "@/lib/db";
import { kickSaveOnPlay } from "@/lib/fallback-download";
import { primaryArtistName } from "@/lib/track-match";
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
    duration?: number | null;
    expectedDurationSec?: number | null;
  } | null;

  let artist = body?.artist?.trim() || "";
  let title = body?.title?.trim() || "";
  let album = body?.album?.trim() || "";
  const durationRaw = body?.expectedDurationSec ?? body?.duration;
  const expectedDurationSec =
    typeof durationRaw === "number" &&
    Number.isFinite(durationRaw) &&
    durationRaw > 0
      ? durationRaw
      : null;

  if (policy.forceRickroll) {
    artist = RICKROLL.artist;
    title = RICKROLL.title;
    album = RICKROLL.album;
  } else if (!artist || !title) {
    return json({ error: "artist and title required" }, { status: 400 });
  }

  // Live / library match on primary credit (drop feat. noise)
  if (!policy.forceRickroll) {
    artist = primaryArtistName(artist) || artist;
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
    expectedDurationSec,
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

  let savingToLibrary = false;
  if (!policy.forceRickroll) {
    const dl = downloadPolicy(user.id);
    if (dl.ok) {
      savingToLibrary = kickSaveOnPlay({
        artist,
        title,
        album: album || title,
      });
    }
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
    savingToLibrary: savingToLibrary || undefined,
  });
}
