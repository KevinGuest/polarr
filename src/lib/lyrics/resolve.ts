import { trackMatchKey } from "../track-match";
import { getLyricsCache, setLyricsCache, type LyricsCacheRow } from "../db";
import { lrclibGet, lrclibSearch } from "./lrclib";
import type {
  LyricDocument,
  LyricSession,
  ResolveLyricsInput,
} from "./types";

const EMPTY: LyricDocument = {
  quality: "none",
  lines: [],
  source: "none",
  sourceDurationSec: null,
  externalId: null,
  instrumental: false,
  found: false,
};

/** Stable cache key: artist|title|durationBucket */
export function lyricsCacheKey(input: ResolveLyricsInput): string {
  const base = trackMatchKey(input.artist, input.title);
  if (!base) {
    return `${(input.artist || "").toLowerCase()}|${(input.title || "").toLowerCase()}`;
  }
  const dur = input.durationSec;
  const bucket =
    typeof dur === "number" && dur > 20 ? Math.round(dur / 5) * 5 : 0;
  return `${base}|d${bucket}`;
}

function rowToDoc(row: LyricsCacheRow): LyricDocument {
  let lines: LyricDocument["lines"] = [];
  try {
    const parsed = JSON.parse(row.linesJson) as unknown;
    if (Array.isArray(parsed)) {
      lines = parsed
        .filter(
          (l): l is { time: number; text: string; words?: unknown } =>
            !!l &&
            typeof l === "object" &&
            typeof (l as { text?: string }).text === "string",
        )
        .map((l) => {
          const words = Array.isArray(l.words)
            ? l.words
                .filter(
                  (w): w is { time: number; text: string } =>
                    !!w &&
                    typeof w === "object" &&
                    typeof (w as { text?: string }).text === "string" &&
                    typeof (w as { time?: number }).time === "number",
                )
                .map((w) => ({ time: w.time, text: w.text }))
            : [];
          return {
            time: typeof l.time === "number" ? l.time : 0,
            text: l.text,
            ...(words.length >= 2 ? { words } : {}),
          };
        });
    }
  } catch {
    lines = [];
  }
  return {
    quality: row.quality as LyricDocument["quality"],
    lines,
    source: row.source,
    sourceDurationSec: row.sourceDurationSec,
    externalId: row.externalId,
    instrumental: row.quality === "instrumental",
    found: row.quality !== "none",
  };
}

function shouldUseCache(row: LyricsCacheRow): boolean {
  const age = Date.now() - Date.parse(row.fetchedAt);
  const maxMs =
    row.quality === "none" || row.quality === "plain"
      ? 6 * 60 * 60 * 1000
      : 14 * 24 * 60 * 60 * 1000;
  return Number.isFinite(age) && age >= 0 && age < maxMs;
}

function buildSession(
  doc: LyricDocument,
  cacheKey: string,
  mediaDurationSec: number | null,
): LyricSession {
  return {
    ...doc,
    cacheKey,
    mediaDurationSec,
  };
}

/**
 * Resolve lyrics for a track: cache → lrclib get → lrclib search.
 * Line times are the provider stamps (no session offset / DTW rewrite).
 */
export async function resolveLyrics(
  input: ResolveLyricsInput,
): Promise<LyricSession> {
  const artist = input.artist.trim();
  const title = input.title.trim();
  const mediaDurationSec =
    typeof input.durationSec === "number" && input.durationSec > 0
      ? input.durationSec
      : null;
  const cacheKey = lyricsCacheKey({
    artist,
    title,
    album: input.album,
    durationSec: mediaDurationSec,
  });

  if (!artist || !title) {
    return buildSession(EMPTY, cacheKey, mediaDurationSec);
  }

  const cached = getLyricsCache(cacheKey);
  if (cached && shouldUseCache(cached)) {
    return buildSession(rowToDoc(cached), cacheKey, mediaDurationSec);
  }

  let doc: LyricDocument | null = null;
  try {
    doc = await lrclibGet({
      artist,
      title,
      album: input.album,
      durationSec: mediaDurationSec,
    });
    if (!doc || (!doc.found && !doc.instrumental)) {
      doc = await lrclibSearch({
        artist,
        title,
        album: input.album,
        durationSec: mediaDurationSec,
      });
    }
  } catch {
    doc = null;
  }

  if (!doc) doc = { ...EMPTY };

  setLyricsCache({
    cacheKey,
    artist,
    title,
    quality: doc.quality,
    source: doc.source,
    externalId: doc.externalId,
    sourceDurationSec: doc.sourceDurationSec,
    linesJson: JSON.stringify(doc.lines),
  });

  return buildSession(doc, cacheKey, mediaDurationSec);
}
