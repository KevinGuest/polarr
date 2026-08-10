import { json } from "@/lib/api";
import { resolveLyrics } from "@/lib/lyrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fetch follow-along lyrics for the current track.
 * Prefer /api/lyrics/session for full karaoke session payload.
 */
export async function GET(req: Request) {
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
      lines: session.lines,
      instrumental: session.instrumental,
      found: session.found,
      synced: session.quality === "synced",
      quality: session.quality,
      source: session.source,
    });
  } catch {
    return json({ error: "Lyrics lookup failed" }, { status: 502 });
  }
}
