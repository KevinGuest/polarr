import type { LyricLine } from "./types";
import { lyricSpanSec } from "./parse-lrc";

const MAX_ABS = 120;

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
