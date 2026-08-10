import { trackMatchKey } from "../track-match";
import {
  getLyricsCache,
  getTrack,
  setLyricsCache,
  type LyricsCacheRow,
} from "../db";
import {
  suggestLyricsOffsetSec,
  clampLyricsOffset,
  fuseLyricsOffsetSuggestions,
} from "./align";
import { detectMediaOnsetSec } from "./onset";
import { lrclibGet, lrclibSearch } from "./lrclib";
import type {
  LyricDocument,
  LyricSession,
  OffsetSuggestSource,
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
          (l): l is { time: number; text: string } =>
            !!l &&
            typeof l === "object" &&
            typeof (l as { text?: string }).text === "string",
        )
        .map((l) => ({
          time: typeof l.time === "number" ? l.time : 0,
          text: l.text,
        }));
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

async function measureMediaOnset(
  trackId: string | null | undefined,
): Promise<number | null> {
  const id = (trackId || "").trim();
  if (!id) return null;
  const track = getTrack(id);
  if (!track?.path) return null;
  try {
    return await detectMediaOnsetSec(track.path);
  } catch {
    return null;
  }
}

async function buildSession(
  doc: LyricDocument,
  cacheKey: string,
  mediaDurationSec: number | null,
  stored: LyricsCacheRow | null | undefined,
  trackId: string | null | undefined,
): Promise<LyricSession> {
  const durationOffset = suggestLyricsOffsetSec({
    mediaDurationSec,
    sourceDurationSec: doc.sourceDurationSec,
    lines: doc.lines,
  });

  let mediaOnsetSec: number | null = null;
  if (doc.quality === "synced" && doc.lines.length > 0) {
    mediaOnsetSec = await measureMediaOnset(trackId);
  }

  const fused = fuseLyricsOffsetSuggestions({
    durationOffset,
    mediaOnsetSec,
  });
  const offsetSuggested = clampLyricsOffset(fused.offsetSec);
  const offsetSource: OffsetSuggestSource = fused.source;

  const offsetUserSet = Boolean(stored?.offsetUserSet);
  const offsetSec = offsetUserSet
    ? clampLyricsOffset(stored?.offsetSec ?? 0)
    : offsetSuggested;

  return {
    ...doc,
    offsetSec,
    offsetSuggested,
    offsetUserSet,
    offsetSource,
    cacheKey,
    mediaDurationSec,
  };
}

/**
 * Resolve lyrics for a track: cache → lrclib get → lrclib search.
 * When `trackId` is set, auto-aligns offset to the on-disk audio file.
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
    return buildSession(EMPTY, cacheKey, mediaDurationSec, null, input.trackId);
  }

  const cached = getLyricsCache(cacheKey);
  if (cached && shouldUseCache(cached)) {
    return buildSession(
      rowToDoc(cached),
      cacheKey,
      mediaDurationSec,
      cached,
      input.trackId,
    );
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

  // Re-read so user offset survives a content refresh
  const after = getLyricsCache(cacheKey);
  return buildSession(doc, cacheKey, mediaDurationSec, after, input.trackId);
}
