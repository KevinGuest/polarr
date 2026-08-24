import type { LyricLine } from "./types";
import { lyricSpanSec } from "./parse-lrc";

const MAX_ABS = 120;

/** Reject wild duration mismatches so a bad LRC/media pair cannot stretch the map. */
export const WARP_SCALE_MIN = 0.85;
export const WARP_SCALE_MAX = 1.15;
/** |scale − 1| below this → identity (onset shift only, current behavior). */
const WARP_IDENTITY_EPS = 0.02;
/** Leftover pad treated as outro, not tempo, when ffmpeg found no trailing silence. */
const OUTRO_PAD_SEC = 12;

export type LyricsWarp = {
  /** Media-domain content start (leading silence / intro pad). */
  onsetSec: number;
  /** mediaSpan / lrcSpan, clamped. 1 = no stretch. */
  scale: number;
  /** First meaningful LRC line time (span start). */
  lrcStartSec: number;
  /** LRC song length used for the ratio (from t=0). */
  lrcSpanSec: number;
  /** Media content end (before trailing pad). */
  mediaEndSec: number;
};

const GAP_TEXT = /^(?:♪|♫)+$/;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function roundMs(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function isMeaningfulLine(line: LyricLine): boolean {
  const text = line.text.trim();
  if (!text) return false;
  if (GAP_TEXT.test(text.replace(/\s+/g, ""))) return false;
  return Number.isFinite(line.time);
}

/** First sung/spoken line time (skip empty / ♪ gap rows). */
export function firstMeaningfulLyricTime(lines: LyricLine[]): number {
  for (const line of lines) {
    if (isMeaningfulLine(line)) return line.time;
  }
  const times = lines.map((l) => l.time).filter((t) => Number.isFinite(t));
  return times.length ? Math.min(...times) : 0;
}

export function lastLyricTime(lines: LyricLine[]): number {
  const times = lines.map((l) => l.time).filter((t) => Number.isFinite(t));
  return times.length ? Math.max(...times) : 0;
}

/**
 * LRCLIB duration is usable when it sits just after the last line (song tail),
 * not minutes off (wrong recording).
 */
export function trustworthySourceDurationSec(
  sourceDurationSec: number | null | undefined,
  lastLineSec: number,
): number | null {
  if (typeof sourceDurationSec !== "number" || !Number.isFinite(sourceDurationSec)) {
    return null;
  }
  if (sourceDurationSec < 30 || lastLineSec < 20) return null;
  if (sourceDurationSec < lastLineSec - 5) return null;
  if (sourceDurationSec > lastLineSec + 60) return null;
  return sourceDurationSec;
}

/**
 * LRC “song” length from document t=0 → last line (or trusted provider duration).
 * Scaling from t=0 keeps a timed intro in the LRC (first line at 12s stays ~12s).
 */
export function estimateLrcSpanSec(input: {
  lines: LyricLine[];
  sourceDurationSec?: number | null;
}): { startSec: number; endSec: number; spanSec: number } | null {
  const last = lastLyricTime(input.lines);
  if (last < 20) return null;
  const start = firstMeaningfulLyricTime(input.lines);
  const trusted = trustworthySourceDurationSec(input.sourceDurationSec, last);
  const end = Math.max(last, trusted ?? 0);
  const span = end;
  if (span < 30) return null;
  return { startSec: start, endSec: end, spanSec: span };
}

export function clampWarpScale(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const clamped = Math.max(WARP_SCALE_MIN, Math.min(WARP_SCALE_MAX, raw));
  if (Math.abs(clamped - 1) < WARP_IDENTITY_EPS) return 1;
  return Math.round(clamped * 1000) / 1000;
}

/**
 * Content start used by the warp. Matches the fused auto shift so intro pad
 * is not counted twice (once as offset, again as a shorter media span).
 * User nudge is not mixed in.
 */
export function warpOnsetFromAuto(input: {
  mediaOnsetSec: number | null | undefined;
  autoOffsetSec: number;
}): number {
  if (input.autoOffsetSec < -0.8) return round1(-input.autoOffsetSec);
  const measured =
    typeof input.mediaOnsetSec === "number" &&
    Number.isFinite(input.mediaOnsetSec) &&
    input.mediaOnsetSec >= 0.9
      ? input.mediaOnsetSec
      : null;
  if (measured != null) return round1(measured);
  return 0;
}

/**
 * Content end: trailing silence when measured, else leftover duration pad
 * (YouTube outro) when it is clearly padding rather than a tempo difference.
 */
export function estimateMediaEndSec(input: {
  mediaDurationSec: number;
  onsetSec: number;
  lrcSpanSec: number;
  mediaTrailingSec?: number | null;
}): number {
  const media = input.mediaDurationSec;
  const onset = Math.max(0, input.onsetSec);
  const trailing =
    typeof input.mediaTrailingSec === "number" &&
    Number.isFinite(input.mediaTrailingSec) &&
    input.mediaTrailingSec >= 0.8
      ? Math.min(input.mediaTrailingSec, 60)
      : 0;

  const afterSilence = trailing > 0 ? round1(media - trailing) : media;
  const leftover = afterSilence - onset - input.lrcSpanSec;
  const mediaEnd =
    leftover >= OUTRO_PAD_SEC
      ? round1(afterSilence - leftover)
      : afterSilence;

  return Math.max(onset + 30, mediaEnd);
}

/**
 * Linear LRC→media warp: `media ≈ onset + lrcTime * scale`.
 * Session line times store `lrcTime * scale`; `offsetSec` still supplies −onset
 * plus the user nudge so existing saved offsets keep working.
 */
export function computeLyricsWarp(input: {
  lines: LyricLine[];
  sourceDurationSec?: number | null;
  mediaDurationSec: number | null | undefined;
  mediaOnsetSec?: number | null;
  mediaTrailingSec?: number | null;
  autoOffsetSec: number;
}): LyricsWarp {
  const identity: LyricsWarp = {
    onsetSec: 0,
    scale: 1,
    lrcStartSec: 0,
    lrcSpanSec: 0,
    mediaEndSec: 0,
  };

  const media = input.mediaDurationSec;
  if (typeof media !== "number" || media < 40) return identity;

  const lrc = estimateLrcSpanSec({
    lines: input.lines,
    sourceDurationSec: input.sourceDurationSec,
  });
  if (!lrc) return identity;

  const onset = Math.min(
    warpOnsetFromAuto({
      mediaOnsetSec: input.mediaOnsetSec,
      autoOffsetSec: input.autoOffsetSec,
    }),
    Math.max(0, media - 40),
  );
  const mediaEnd = estimateMediaEndSec({
    mediaDurationSec: media,
    onsetSec: onset,
    lrcSpanSec: lrc.spanSec,
    mediaTrailingSec: input.mediaTrailingSec,
  });
  const mediaSpan = mediaEnd - onset;
  if (mediaSpan < 30) return { ...identity, onsetSec: onset, mediaEndSec: mediaEnd };

  const scale = clampWarpScale(mediaSpan / lrc.spanSec);
  return {
    onsetSec: onset,
    scale,
    lrcStartSec: lrc.startSec,
    lrcSpanSec: lrc.spanSec,
    mediaEndSec: mediaEnd,
  };
}

/** Map one LRC stamp into session clock time (offset still applied at playback). */
export function warpLrcTime(lrcTime: number, scale: number): number {
  if (!Number.isFinite(lrcTime)) return 0;
  if (scale === 1 || !Number.isFinite(scale)) return lrcTime;
  return roundMs(lrcTime * scale);
}

/**
 * Copy lines into the session clock. Does not invent word timestamps —
 * only scales stamps that already exist.
 */
export function warpLyricLines(lines: LyricLine[], scale: number): LyricLine[] {
  if (scale === 1 || !Number.isFinite(scale) || !lines.length) return lines;
  return lines.map((line) => {
    const time = warpLrcTime(line.time, scale);
    const words = line.words;
    if (!words?.length) return { ...line, time };
    return {
      ...line,
      time,
      words: words.map((w) => ({ ...w, time: warpLrcTime(w.time, scale) })),
    };
  });
}

/**
 * Media progress for a session line. Inverse of `clockSec = progress + offset`
 * after line times have been warped.
 */
export function lyricLineSeekSec(lineTime: number, offsetSec: number): number {
  if (!Number.isFinite(lineTime)) return 0;
  return Math.max(0, lineTime - (offsetSec || 0));
}

/**
 * When media is longer than the timed lyric document (classic YouTube intro /
 * outro padding), suggest a negative clock offset so lines fire later.
 *
 * Clock uses `progress + offset` — negative offset delays the lyric line map.
 */
export function suggestLyricsOffsetSec(input: {
  mediaDurationSec: number | null | undefined;
  sourceDurationSec: number | null | undefined;
  lines: LyricLine[];
}): number {
  const media = input.mediaDurationSec;
  if (typeof media !== "number" || media < 40) return 0;

  const lastLine =
    input.lines.length > 0
      ? Math.max(...input.lines.map((l) => l.time))
      : 0;
  const span = lyricSpanSec(input.lines);
  const source =
    typeof input.sourceDurationSec === "number" && input.sourceDurationSec > 20
      ? input.sourceDurationSec
      : null;

  // Best available estimate of “real song” length without stream extras
  const songLen = Math.max(
    source ?? 0,
    lastLine > 10 ? lastLine + 8 : 0,
    span ?? 0,
  );
  if (songLen < 30) return 0;

  const pad = media - songLen;
  // Only auto-nudge when stream is clearly padded (intros, MVs)
  if (pad < 12) return 0;
  // Assume most padding sits at the front (intros / logos)
  const intro = Math.min(pad * 0.9, MAX_ABS);
  return -Math.round(intro * 10) / 10;
}

/**
 * Map measured “song zero” on the media timeline to a lyrics clock offset.
 * LRC t=0 lands at `mediaOnsetSec` → offset = −onset.
 */
export function offsetFromMediaOnsetSec(mediaOnsetSec: number): number {
  if (!Number.isFinite(mediaOnsetSec) || mediaOnsetSec < 0.9) return 0;
  return clampLyricsOffset(-mediaOnsetSec);
}

/**
 * Fuse file-measured onset with duration-pad heuristic.
 * Prefer real leading silence when present; fall back to duration when the
 * file is loud from t=0 (music-filled YouTube intros).
 */
export function fuseLyricsOffsetSuggestions(input: {
  durationOffset: number;
  /** Seconds from file start until content begins */
  mediaOnsetSec: number | null | undefined;
}): { offsetSec: number; source: "audio" | "duration" | "none" } {
  const dur = clampLyricsOffset(input.durationOffset || 0);
  const onset =
    typeof input.mediaOnsetSec === "number" && Number.isFinite(input.mediaOnsetSec)
      ? input.mediaOnsetSec
      : null;
  const audio = onset != null ? offsetFromMediaOnsetSec(onset) : 0;

  // Clear opening silence / quiet pad on the actual file
  if (onset != null && onset >= 1.2 && audio < -0.8) {
    // Duration still wins when the stream is much longer than silence alone
    // (continuous MV music under logos — silence underestimates the intro)
    if (dur <= -12 && onset < Math.abs(dur) * 0.4) {
      return { offsetSec: dur, source: "duration" };
    }
    return { offsetSec: audio, source: "audio" };
  }

  if (dur !== 0) return { offsetSec: dur, source: "duration" };
  return { offsetSec: 0, source: "none" };
}

export function clampLyricsOffset(sec: number): number {
  if (!Number.isFinite(sec)) return 0;
  return Math.max(-MAX_ABS, Math.min(MAX_ABS, Math.round(sec * 10) / 10));
}
