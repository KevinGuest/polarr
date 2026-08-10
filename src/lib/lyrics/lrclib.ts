/**
 * LRCLIB client — get by metadata + search, prefer duration-aligned hits.
 * https://lrclib.net/docs
 */
import { namesMatch, normalizeTitle, scoreTrackMatch } from "../track-match";
import { parseLrc, plainLines } from "./parse-lrc";
import type { LyricDocument, ResolveLyricsInput } from "./types";

const UA = "Polarr/0.5 (self-hosted; +https://github.com/KevinGuest/polarr)";

type LrcLibRecord = {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
};

function docFromRecord(rec: LrcLibRecord): LyricDocument {
  if (rec.instrumental) {
    return {
      quality: "instrumental",
      lines: [],
      source: "lrclib",
      sourceDurationSec:
        typeof rec.duration === "number" ? rec.duration : null,
      externalId: rec.id != null ? String(rec.id) : null,
      instrumental: true,
      found: true,
    };
  }
  if (rec.syncedLyrics?.trim()) {
    const lines = parseLrc(rec.syncedLyrics);
    if (lines.length) {
      return {
        quality: "synced",
        lines,
        source: "lrclib",
        sourceDurationSec:
          typeof rec.duration === "number" ? rec.duration : null,
        externalId: rec.id != null ? String(rec.id) : null,
        instrumental: false,
        found: true,
      };
    }
  }
  if (rec.plainLyrics?.trim()) {
    const lines = plainLines(rec.plainLyrics);
    if (lines.length) {
      return {
        quality: "plain",
        lines,
        source: "lrclib",
        sourceDurationSec:
          typeof rec.duration === "number" ? rec.duration : null,
        externalId: rec.id != null ? String(rec.id) : null,
        instrumental: false,
        found: true,
      };
    }
  }
  return {
    quality: "none",
    lines: [],
    source: "lrclib",
    sourceDurationSec:
      typeof rec.duration === "number" ? rec.duration : null,
    externalId: rec.id != null ? String(rec.id) : null,
    instrumental: false,
    found: false,
  };
}

function durationScore(
  recordDuration: number | undefined,
  mediaDuration: number | null | undefined,
): number {
  if (
    typeof recordDuration !== "number" ||
    !mediaDuration ||
    mediaDuration < 20
  ) {
    return 0;
  }
  const diff = Math.abs(recordDuration - mediaDuration);
  if (diff <= 3) return 40;
  if (diff <= 8) return 25;
  if (diff <= 15) return 12;
  if (diff <= 30) return 0;
  return -25;
}

function rankRecord(
  rec: LrcLibRecord,
  input: ResolveLyricsInput,
): number {
  let score = scoreTrackMatch(
    {
      title: rec.trackName || "",
      artist: rec.artistName || "",
    },
    input.artist,
    input.title,
  );
  if (rec.syncedLyrics?.trim()) score += 30;
  else if (rec.plainLyrics?.trim()) score += 8;
  if (rec.instrumental) score += 5;
  score += durationScore(rec.duration, input.durationSec);
  const wantTitle = normalizeTitle(input.title);
  const hitTitle = normalizeTitle(rec.trackName || "");
  if (wantTitle && hitTitle === wantTitle) score += 10;
  if (
    input.album &&
    rec.albumName &&
    normalizeTitle(input.album) === normalizeTitle(rec.albumName)
  ) {
    score += 8;
  }
  return score;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    next: { revalidate: 0 },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lrclib ${res.status}`);
  return (await res.json()) as T;
}

/** Exact metadata get — fastest when it hits. */
export async function lrclibGet(
  input: ResolveLyricsInput,
): Promise<LyricDocument | null> {
  const qs = new URLSearchParams({
    artist_name: input.artist,
    track_name: input.title,
  });
  if (input.album) qs.set("album_name", input.album);
  if (input.durationSec && input.durationSec > 0) {
    qs.set("duration", String(Math.round(input.durationSec)));
  }
  try {
    const data = await fetchJson<LrcLibRecord>(
      `https://lrclib.net/api/get?${qs}`,
    );
    if (!data) return null;
    const doc = docFromRecord(data);
    return doc.found || doc.instrumental ? doc : null;
  } catch {
    return null;
  }
}

/** Free search — rank by name match + duration + synced preference. */
export async function lrclibSearch(
  input: ResolveLyricsInput,
): Promise<LyricDocument | null> {
  const q = `${input.artist} ${input.title}`.trim();
  if (!q) return null;
  const qs = new URLSearchParams({ q });
  try {
    const data = await fetchJson<LrcLibRecord[]>(
      `https://lrclib.net/api/search?${qs}`,
    );
    if (!data?.length) return null;

    const ranked = data
      .map((rec) => ({ rec, score: rankRecord(rec, input) }))
      .filter((r) => r.score >= 50)
      .sort((a, b) => b.score - a.score);

    for (const { rec } of ranked) {
      // Prefer name match at least loosely
      if (
        !namesMatch(rec.artistName || "", input.artist) &&
        scoreTrackMatch(
          { title: rec.trackName || "", artist: rec.artistName || "" },
          input.artist,
          input.title,
        ) < 50
      ) {
        continue;
      }
      const doc = docFromRecord(rec);
      if (doc.found || doc.instrumental) return doc;
    }
    // Fall through: best ranked that produced any doc
    for (const { rec } of ranked) {
      const doc = docFromRecord(rec);
      if (doc.found || doc.instrumental) return doc;
    }
    return null;
  } catch {
    return null;
  }
}
