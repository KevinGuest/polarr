import { getAuthUserFromRequest, json } from "@/lib/api";
import { setLyricsCacheOffset } from "@/lib/db";
import { clampLyricsOffset, resolveLyrics } from "@/lib/lyrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Karaoke lyrics session — resolved document + quality + track-aligned clock.
 * Line times are warped (LRC × scale) or DTW-aligned to the vocal;
 * offsetSec is onset shift + user nudge (nudge-only after DTW).
 * Query: artist, title, album?, duration? (media seconds), trackId? (file bounds)
 */
export async function GET(req: Request) {
  const user = getAuthUserFromRequest(req);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const artist = (url.searchParams.get("artist") || "").trim();
  const title = (url.searchParams.get("title") || "").trim();
  const album = (url.searchParams.get("album") || "").trim() || undefined;
  const trackId = (url.searchParams.get("trackId") || "").trim() || undefined;
  const durationRaw = url.searchParams.get("duration");
  const durationSec = durationRaw ? Number(durationRaw) : null;

  if (!artist || !title) {
    return json({ error: "artist and title required" }, { status: 400 });
  }

  try {
    const session = await resolveLyrics({
      artist,
      title,
      album,
      trackId,
      durationSec:
        durationSec && Number.isFinite(durationSec) && durationSec > 0
          ? durationSec
          : null,
    });

    return json({
      quality: session.quality,
      lines: session.lines,
      source: session.source,
      sourceDurationSec: session.sourceDurationSec,
      externalId: session.externalId,
      instrumental: session.instrumental,
      found: session.found,
      synced: session.quality === "synced",
      offsetSec: session.offsetSec,
      offsetSuggested: session.offsetSuggested,
      offsetUserSet: session.offsetUserSet,
      offsetSource: session.offsetSource,
      warpScale: session.warpScale,
      warpOnsetSec: session.warpOnsetSec,
      alignSource: session.alignSource,
      cacheKey: session.cacheKey,
      mediaDurationSec: session.mediaDurationSec,
    });
  } catch {
    return json({ error: "Lyrics session failed" }, { status: 502 });
  }
}

/**
 * Persist lyrics clock offset for a cache key (per track/duration bucket).
 * Body: { cacheKey, offsetSec, userSet?: boolean }
 * `userSet: false` keeps auto mode (re-follow track analysis next open).
 */
export async function PATCH(req: Request) {
  const user = getAuthUserFromRequest(req);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  let body: { cacheKey?: string; offsetSec?: number; userSet?: boolean };
  try {
    body = (await req.json()) as {
      cacheKey?: string;
      offsetSec?: number;
      userSet?: boolean;
    };
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  const cacheKey = (body.cacheKey || "").trim();
  if (!cacheKey || cacheKey.length > 400) {
    return json({ error: "cacheKey required" }, { status: 400 });
  }
  if (typeof body.offsetSec !== "number" || !Number.isFinite(body.offsetSec)) {
    return json({ error: "offsetSec required" }, { status: 400 });
  }

  const offsetSec = clampLyricsOffset(body.offsetSec);
  const userSet = body.userSet !== false;
  setLyricsCacheOffset(cacheKey, offsetSec, userSet);
  return json({ ok: true, offsetSec, offsetUserSet: userSet });
}
