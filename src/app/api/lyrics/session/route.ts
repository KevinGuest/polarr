import { getAuthUserFromRequest, json } from "@/lib/api";
import { resolveLyrics } from "@/lib/lyrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Karaoke lyrics session — resolved document + quality.
 * Line times are the lyrics source stamps (LRCLIB), not a local offset/DTW map.
 * Query: artist, title, album?, duration? (media seconds)
 */
export async function GET(req: Request) {
  const user = getAuthUserFromRequest(req);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const artist = (url.searchParams.get("artist") || "").trim();
  const title = (url.searchParams.get("title") || "").trim();
  const album = (url.searchParams.get("album") || "").trim() || undefined;
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
      cacheKey: session.cacheKey,
      mediaDurationSec: session.mediaDurationSec,
      geniusSections: session.geniusSections ?? null,
    });
  } catch {
    return json({ error: "Lyrics session failed" }, { status: 502 });
  }
}
