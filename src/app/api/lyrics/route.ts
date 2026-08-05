import { json } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LrcLibHit = {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
};

export type LyricLine = {
  time: number;
  text: string;
};

function parseLrc(raw: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const row of raw.split(/\r?\n/)) {
    const match = row.match(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/);
    if (!match) continue;
    const min = Number(match[1]);
    const sec = Number(match[2]);
    const frac = match[3] ? Number(match[3].padEnd(3, "0")) / 1000 : 0;
    const text = match[4].trim();
    if (!text) continue;
    lines.push({ time: min * 60 + sec + frac, text });
  }
  return lines;
}

/** Fetch follow-along lyrics (LRCLIB) for the current track. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const artist = (url.searchParams.get("artist") || "").trim();
  const title = (url.searchParams.get("title") || "").trim();
  if (!artist || !title) {
    return json({ error: "artist and title required" }, { status: 400 });
  }

  try {
    const qs = new URLSearchParams({
      artist_name: artist,
      track_name: title,
    });
    const res = await fetch(`https://lrclib.net/api/get?${qs}`, {
      headers: { "User-Agent": "Polarr/0.1 (self-hosted music)" },
      next: { revalidate: 86400 },
    });

    if (res.status === 404) {
      return json({ lines: [], instrumental: false, found: false });
    }
    if (!res.ok) {
      return json({ error: "Lyrics lookup failed" }, { status: 502 });
    }

    const data = (await res.json()) as LrcLibHit;
    if (data.instrumental) {
      return json({ lines: [], instrumental: true, found: true });
    }
    if (data.syncedLyrics) {
      return json({
        lines: parseLrc(data.syncedLyrics),
        instrumental: false,
        found: true,
        synced: true,
      });
    }
    if (data.plainLyrics) {
      const lines = data.plainLyrics
        .split(/\r?\n/)
        .map((text) => text.trim())
        .filter(Boolean)
        .map((text, i) => ({ time: i * 4, text }));
      return json({
        lines,
        instrumental: false,
        found: true,
        synced: false,
      });
    }
    return json({ lines: [], instrumental: false, found: false });
  } catch {
    return json({ error: "Lyrics lookup failed" }, { status: 502 });
  }
}
