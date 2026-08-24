import { trackMatchKey } from "../track-match";
import {
  getLyricsCache,
  setLyricsCache,
  setLyricsCacheAligned,
  setLyricsCacheOffset,
  type LyricsCacheRow,
} from "../db";
import { resolveKaraokeLibraryTrack } from "../karaoke-stems";
import {
  suggestLyricsOffsetSec,
  clampLyricsOffset,
  fuseLyricsOffsetSuggestions,
  computeLyricsWarp,
  warpLyricLines,
} from "./align";
import { detectMediaContentBounds } from "./onset";
import {
  activityOnsetSec,
  activityTrailingSec,
  extractMediaEnvelope,
} from "./envelope";
import {
  alignCacheFingerprint,
  alignLinesToEnvelope,
  resolveAlignAudio,
} from "./force-align";
import { lrclibGet, lrclibSearch } from "./lrclib";
import type {
  LyricDocument,
  LyricLine,
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

function parseStoredAligned(
  stored: LyricsCacheRow | null | undefined,
  fingerprint: string,
  original: LyricLine[],
): LyricLine[] | null {
  if (!stored?.alignedJson || stored.alignedFingerprint !== fingerprint) {
    return null;
  }
  try {
    const parsed = JSON.parse(stored.alignedJson) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== original.length) return null;
    const lines: LyricLine[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i] as {
        time?: unknown;
        text?: unknown;
        words?: unknown;
      } | null;
      const o = original[i]!;
      if (!p || typeof p !== "object" || typeof p.time !== "number") return null;
      if (typeof p.text === "string" && p.text !== o.text) return null;
      const words = Array.isArray(p.words)
        ? p.words
            .filter(
              (w): w is { time: number; text: string } =>
                !!w &&
                typeof w === "object" &&
                typeof (w as { text?: string }).text === "string" &&
                typeof (w as { time?: number }).time === "number",
            )
            .map((w) => ({ time: w.time, text: w.text }))
        : [];
      lines.push({
        time: p.time,
        text: o.text,
        ...(words.length >= 2 ? { words } : o.words ? { words: o.words } : {}),
      });
    }
    return lines;
  } catch {
    return null;
  }
}

async function measureMediaBounds(
  trackId: string | null | undefined,
  meta?: { artist?: string; title?: string },
): Promise<{ onsetSec: number | null; trailingSec: number | null }> {
  const empty = { onsetSec: null, trailingSec: null };
  const id = (trackId || "").trim();
  if (!id || id.startsWith("live:") || id.startsWith("stream:") || id.startsWith("catalog:")) {
    return empty;
  }
  const track = resolveKaraokeLibraryTrack(id, meta);
  if (!track?.path) return empty;
  try {
    return await detectMediaContentBounds(track.path);
  } catch {
    return empty;
  }
}

function sessionOffsets(input: {
  fusedAuto: number;
  offsetSource: OffsetSuggestSource;
  stored: LyricsCacheRow | null | undefined;
  aligned: boolean;
  migrateResidual: boolean;
  cacheKey: string;
}): { offsetSec: number; offsetSuggested: number; offsetUserSet: boolean } {
  const offsetUserSet = Boolean(input.stored?.offsetUserSet);
  if (!input.aligned) {
    const offsetSuggested = clampLyricsOffset(input.fusedAuto);
    return {
      offsetSuggested,
      offsetUserSet,
      offsetSec: offsetUserSet
        ? clampLyricsOffset(input.stored?.offsetSec ?? 0)
        : offsetSuggested,
    };
  }

  // Media timestamps: auto shift is already in the line map.
  const offsetSuggested = 0;
  if (!offsetUserSet) {
    return { offsetSuggested, offsetUserSet: false, offsetSec: 0 };
  }

  let offsetSec = clampLyricsOffset(input.stored?.offsetSec ?? 0);
  if (input.migrateResidual) {
    const residual = clampLyricsOffset(offsetSec - input.fusedAuto);
    if (Math.abs(residual - offsetSec) > 0.15) {
      try {
        setLyricsCacheOffset(input.cacheKey, residual, true);
      } catch {
        /* keep in-memory residual */
      }
      offsetSec = residual;
    }
  }
  return { offsetSuggested, offsetUserSet: true, offsetSec };
}

async function buildSession(
  doc: LyricDocument,
  cacheKey: string,
  mediaDurationSec: number | null,
  stored: LyricsCacheRow | null | undefined,
  trackId: string | null | undefined,
  meta?: { artist?: string; title?: string },
): Promise<LyricSession> {
  const durationOffset = suggestLyricsOffsetSec({
    mediaDurationSec,
    sourceDurationSec: doc.sourceDurationSec,
    lines: doc.lines,
  });

  const base = (
    lines: LyricLine[],
    warpScale: number,
    warpOnsetSec: number,
    alignSource: LyricSession["alignSource"],
    fusedAuto: number,
    offsetSource: OffsetSuggestSource,
    migrateResidual: boolean,
  ): LyricSession => {
    const offs = sessionOffsets({
      fusedAuto,
      offsetSource,
      stored,
      aligned: alignSource === "dtw",
      migrateResidual,
      cacheKey,
    });
    return {
      ...doc,
      lines,
      ...offs,
      offsetSource: alignSource === "dtw" ? "audio" : offsetSource,
      cacheKey,
      mediaDurationSec,
      warpScale,
      warpOnsetSec,
      alignSource,
    };
  };

  if (doc.quality !== "synced" || doc.lines.length === 0) {
    const fused = fuseLyricsOffsetSuggestions({
      durationOffset,
      mediaOnsetSec: null,
    });
    return base(
      doc.lines,
      1,
      0,
      "none",
      fused.offsetSec,
      fused.source,
      false,
    );
  }

  const audio = resolveAlignAudio(trackId, meta);
  if (audio) {
    const fingerprint = alignCacheFingerprint(audio, doc.lines);
    const cachedAligned = parseStoredAligned(stored, fingerprint, doc.lines);
    if (cachedAligned) {
      const fused = fuseLyricsOffsetSuggestions({
        durationOffset,
        mediaOnsetSec: null,
      });
      return base(cachedAligned, 1, 0, "dtw", fused.offsetSec, "audio", false);
    }

    try {
      const envelope = await extractMediaEnvelope(audio.path, audio.kind);
      if (envelope) {
        const mediaOnsetSec = activityOnsetSec(envelope.activity, envelope.hopSec);
        const mediaTrailingSec = activityTrailingSec(
          envelope.activity,
          envelope.hopSec,
        );
        const fused = fuseLyricsOffsetSuggestions({
          durationOffset,
          mediaOnsetSec,
        });
        const warp = computeLyricsWarp({
          lines: doc.lines,
          sourceDurationSec: doc.sourceDurationSec,
          mediaDurationSec: mediaDurationSec ?? envelope.durationSec,
          mediaOnsetSec,
          mediaTrailingSec,
          autoOffsetSec: fused.offsetSec,
        });
        const aligned = alignLinesToEnvelope(doc.lines, envelope, {
          onsetSec: warp.onsetSec,
          scale: warp.scale,
          mediaEndSec: warp.mediaEndSec || envelope.durationSec,
        });
        if (aligned) {
          try {
            setLyricsCacheAligned(
              cacheKey,
              JSON.stringify(aligned.lines),
              fingerprint,
            );
          } catch {
            /* next open can re-run */
          }
          return base(
            aligned.lines,
            warp.scale,
            aligned.onsetSec,
            "dtw",
            fused.offsetSec,
            fused.source,
            true,
          );
        }
        return base(
          warpLyricLines(doc.lines, warp.scale),
          warp.scale,
          warp.onsetSec,
          "warp",
          fused.offsetSec,
          fused.source,
          false,
        );
      }
    } catch {
      /* fall through to silencedetect + warp */
    }
  }

  let mediaOnsetSec: number | null = null;
  let mediaTrailingSec: number | null = null;
  const bounds = await measureMediaBounds(trackId, meta);
  mediaOnsetSec = bounds.onsetSec;
  mediaTrailingSec = bounds.trailingSec;

  const fused = fuseLyricsOffsetSuggestions({
    durationOffset,
    mediaOnsetSec,
  });
  const warp = computeLyricsWarp({
    lines: doc.lines,
    sourceDurationSec: doc.sourceDurationSec,
    mediaDurationSec,
    mediaOnsetSec,
    mediaTrailingSec,
    autoOffsetSec: fused.offsetSec,
  });
  return base(
    warpLyricLines(doc.lines, warp.scale),
    warp.scale,
    warp.onsetSec,
    "warp",
    fused.offsetSec,
    fused.source,
    false,
  );
}

/**
 * Resolve lyrics for a track: cache → lrclib get → lrclib search.
 * When `trackId` points at an on-disk file, DTW-aligns synced LRC to the vocal.
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

  const alignMeta = { artist, title };

  if (!artist || !title) {
    return buildSession(
      EMPTY,
      cacheKey,
      mediaDurationSec,
      null,
      input.trackId,
      alignMeta,
    );
  }

  const cached = getLyricsCache(cacheKey);
  if (cached && shouldUseCache(cached)) {
    return buildSession(
      rowToDoc(cached),
      cacheKey,
      mediaDurationSec,
      cached,
      input.trackId,
      alignMeta,
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
  return buildSession(
    doc,
    cacheKey,
    mediaDurationSec,
    after,
    input.trackId,
    alignMeta,
  );
}
