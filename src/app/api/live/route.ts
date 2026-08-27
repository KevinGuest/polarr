import { getAuthUserFromRequest, json } from "@/lib/api";
import {
  downloadPolicy,
  isRickrollTrack,
  RICKROLL,
  streamPolicy,
} from "@/lib/bans";
import { createLiveSession } from "@/lib/live-stream";
import {
  findTrackFast,
  getSettings,
  getTrack,
  type TrackRow,
} from "@/lib/db";
import { resolvePlayableAudioPath } from "@/lib/audio-path";
import { kickSaveOnPlay } from "@/lib/fallback-download";
import { lidarrHasTrackFile } from "@/lib/lidarr";
import { primaryArtistName } from "@/lib/track-match";
import { ytDlpAvailable } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DB hit is only usable if the audio file is still on disk (with path remap). */
function libraryFilePlayable(track: TrackRow): boolean {
  if (track.source === "stream") return false;
  return Boolean(resolvePlayableAudioPath(track.path));
}

function resolveLibraryTrack(input: {
  trackId?: string;
  artist: string;
  title: string;
}): TrackRow | null {
  const trackId = (input.trackId || "").trim();
  // Ignore ephemeral ids from prior live resolves
  const realId =
    trackId &&
    !trackId.includes(":") &&
    !trackId.startsWith("live") &&
    !trackId.startsWith("stream")
      ? trackId
      : "";
  if (realId) {
    const byId = getTrack(realId);
    if (byId && libraryFilePlayable(byId)) return byId;
    if (byId) {
      const promoted = findTrackFast(byId.artist, byId.title);
      if (promoted && libraryFilePlayable(promoted)) return promoted;
    }
  }
  const hit = findTrackFast(input.artist, input.title);
  if (hit && libraryFilePlayable(hit)) return hit;
  return null;
}

/**
 * Prefer local library; otherwise resolve a live remote stream (no download).
 * Body: { artist, title, album?, trackId? }
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
    trackId?: string;
    duration?: number | null;
    expectedDurationSec?: number | null;
  } | null;

  let artist = body?.artist?.trim() || "";
  let title = body?.title?.trim() || "";
  let album = body?.album?.trim() || "";
  const trackId = body?.trackId?.trim() || "";
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

  // Keep full credit for library match — findTrack already tries primary artist.
  // Only strip for the YouTube live query below.
  const local = policy.forceRickroll
    ? null
    : resolveLibraryTrack({ trackId, artist, title });
  if (local && libraryFilePlayable(local)) {
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

  const liveArtist = policy.forceRickroll
    ? artist
    : primaryArtistName(artist) || artist;

  if (!(await ytDlpAvailable())) {
    const { notifyDiscordStreamError } = await import("@/lib/admin-notify");
    notifyDiscordStreamError({
      dedupeKey: `ytdlp:${artist}|${title}`,
      title: "Stream error — yt-dlp unavailable",
      description: `${title} by ${artist}`,
      fields: [
        { name: "User", value: user.username, inline: true },
        { name: "Track", value: `${artist} — ${title}` },
      ],
    });
    return json(
      { error: "Live stream unavailable — yt-dlp not ready" },
      { status: 503 },
    );
  }

  const session = await createLiveSession({
    artist: liveArtist,
    title,
    album: album || title,
    expectedDurationSec,
  });
  if (!session) {
    const { notifyDiscordStreamError } = await import("@/lib/admin-notify");
    notifyDiscordStreamError({
      dedupeKey: `live:${artist}|${title}`,
      title: "Stream error — live resolve failed",
      description: `${title} by ${artist}`,
      fields: [
        { name: "User", value: user.username, inline: true },
        { name: "Track", value: `${artist} — ${title}` },
      ],
    });
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
    const settings = getSettings();
    if (dl.ok && settings.saveOnPlay) {
      const alreadyLocal = resolveLibraryTrack({ trackId, artist, title });
      const localOk = alreadyLocal && libraryFilePlayable(alreadyLocal);
      const alreadyLidarr =
        !localOk && (await lidarrHasTrackFile(artist, title));
      if (!localOk && !alreadyLidarr) {
        savingToLibrary = kickSaveOnPlay({
          artist,
          title,
          album: album || title,
        });
      }
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
