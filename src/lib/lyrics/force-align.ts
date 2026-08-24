/**
 * Polarr local lyrics aligner (the product “AI”).
 *
 * Forced alignment: LRC line sequence × vocal-activity envelope via banded DTW.
 * Original code — not a port of Gentle / aeneas / any GPL aligner.
 *
 * Pipeline:
 *  1. Expected activity from LRC (sung blocks by char-count, gaps as silence)
 *  2. Observed activity from ffmpeg RMS (vocals stem if present, else mix)
 *  3. Banded DTW maps template time → media time (gaps absorb extra audio)
 *  4. Snap each line start to a nearby energy rise; hold through long silence
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { getTrack } from "../db";
import { getVocalsFile } from "../karaoke-stems";
import type { LyricLine } from "./types";
import {
  clampWarpScale,
  computeLyricsWarp,
  firstMeaningfulLyricTime,
  lastLyricTime,
} from "./align";
import {
  activityOnsetSec,
  activityTrailingSec,
  extractMediaEnvelope,
  type MediaEnvelope,
} from "./envelope";

const GAP_TEXT = /^(?:♪|♫)+$/;
const MIN_LINE_GAP = 0.28;
const DTW_STRIDE = 2;
const SNAP_SEC = 0.45;

function roundMs(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function isGapLine(line: LyricLine): boolean {
  const text = line.text.trim().replace(/\s+/g, "");
  return !text || GAP_TEXT.test(text);
}

function isMeaningfulLine(line: LyricLine): boolean {
  return !isGapLine(line) && Number.isFinite(line.time);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function downsample(src: Float32Array, stride: number): Float32Array {
  if (stride <= 1) return src;
  const n = Math.max(1, Math.floor(src.length / stride));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    const base = i * stride;
    for (let k = 0; k < stride; k++) acc += src[base + k] ?? 0;
    out[i] = acc / stride;
  }
  return out;
}

function sungDurationSec(line: LyricLine, gapSec: number): number {
  if (isGapLine(line)) return 0;
  const chars = line.text.replace(/\s+/g, "").length;
  const prior = chars * 0.068 + 0.28;
  return clamp(prior, 0.5, Math.max(0.5, gapSec * 0.88));
}

/**
 * Expected 0–1 vocal activity from timed LRC (t=0 → endSec).
 * Instrumental / ♪ rows stay off so DTW can stretch those gaps to real silence.
 */
export function buildExpectedActivity(
  lines: LyricLine[],
  hopSec: number,
  endSec: number,
): Float32Array {
  const n = Math.max(8, Math.round(Math.max(endSec, 1) / hopSec));
  const t = new Float32Array(n);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const start = Math.max(0, line.time);
    const next = lines[i + 1]?.time;
    const gap =
      typeof next === "number" && next > start
        ? next - start
        : sungDurationSec(line, 3.2) + 0.4;
    const sung = sungDurationSec(line, gap);
    if (sung <= 0.05) continue;
    const a = Math.max(0, Math.floor(start / hopSec));
    const b = Math.min(n, Math.ceil((start + sung) / hopSec));
    const span = Math.max(1, b - a);
    for (let k = a; k < b; k++) {
      const rel = (k - a) / span;
      const env =
        rel < 0.1 ? rel / 0.1 : rel > 0.82 ? Math.max(0, (1 - rel) / 0.18) : 1;
      if (env > t[k]!) t[k] = env;
    }
  }
  return t;
}

function localCost(a: number, b: number): number {
  let c = (a - b) * (a - b);
  // Don't park sung lines in long silence
  if (a > 0.45 && b < 0.12) c += 1.85;
  // Cheap to stretch matching silence (instrumental holds the previous line)
  if (a < 0.14 && b < 0.14) c *= 0.32;
  return c;
}

/**
 * Banded DTW. Returns template-index → observed-index (monotonic).
 * Steps: diagonal, consume audio (hold template / stretch gaps), skip template.
 */
export function bandedDtw(
  template: Float32Array,
  observed: Float32Array,
  bandFrac = 0.3,
): Int32Array | null {
  const n = template.length;
  const m = observed.length;
  if (n < 8 || m < 8) return null;

  const band = Math.max(20, Math.floor(Math.max(n, m) * bandFrac));
  const INF = 1e12;
  let prev = new Float64Array(m + 1);
  let curr = new Float64Array(m + 1);
  prev.fill(INF);
  prev[0] = 0;
  const dir = new Uint8Array(n * m);

  for (let i = 1; i <= n; i++) {
    curr.fill(INF);
    const jMid = Math.round((i * m) / n);
    const j0 = Math.max(1, jMid - band);
    const j1 = Math.min(m, jMid + band);
    for (let j = j0; j <= j1; j++) {
      const lc = localCost(template[i - 1]!, observed[j - 1]!);
      const diag = prev[j - 1]! + lc;
      const left = curr[j - 1]! + lc * 0.9;
      const up = prev[j]! + lc * 1.06;
      let best = diag;
      let code = 0;
      if (left < best) {
        best = left;
        code = 1;
      }
      if (up < best) {
        best = up;
        code = 2;
      }
      curr[j] = best;
      dir[(i - 1) * m + (j - 1)] = code;
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }

  if (!Number.isFinite(prev[m]!) || prev[m]! >= INF / 2) return null;

  const map = new Int32Array(n);
  map.fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    map[i - 1] = j - 1;
    const code = dir[(i - 1) * m + (j - 1)]!;
    if (code === 0) {
      i--;
      j--;
    } else if (code === 1) {
      j--;
    } else {
      i--;
    }
  }
  let last = 0;
  for (let t = 0; t < n; t++) {
    if (map[t]! < 0) map[t] = last;
    else last = map[t]!;
  }
  return map;
}

function energyAt(
  activity: Float32Array,
  hopSec: number,
  timeSec: number,
  windowSec: number,
): number {
  const a = Math.max(0, Math.floor(timeSec / hopSec));
  const b = Math.min(
    activity.length,
    a + Math.max(1, Math.ceil(windowSec / hopSec)),
  );
  let s = 0;
  for (let i = a; i < b; i++) s += activity[i]!;
  return s / Math.max(1, b - a);
}

export function meanEnergyAtStarts(
  times: number[],
  activity: Float32Array,
  hopSec: number,
): number {
  if (!times.length) return 0;
  let s = 0;
  for (const t of times) s += energyAt(activity, hopSec, t, 0.32);
  return s / times.length;
}

/**
 * Prefer a nearby energy rise so the line fires with the vocal, not mid-pad.
 * Search is bounded so we don't jump to the next phrase.
 */
export function snapToEnergyRise(
  timeSec: number,
  activity: Float32Array,
  hopSec: number,
  windowSec = SNAP_SEC,
): number {
  const n = activity.length;
  const center = Math.round(timeSec / hopSec);
  const w = Math.max(2, Math.round(windowSec / hopSec));
  const copy = Array.from(activity);
  copy.sort((a, b) => a - b);
  const thresh =
    copy[Math.floor(copy.length * 0.42)]! +
    0.2 *
      (copy[Math.floor(copy.length * 0.88)]! -
        copy[Math.floor(copy.length * 0.42)]!);

  let best = center;
  let bestScore = -1e9;
  const lo = Math.max(1, center - w);
  const hi = Math.min(n - 2, center + w);
  for (let i = lo; i <= hi; i++) {
    const prev = activity[i - 1]!;
    const cur = activity[i]!;
    const rise = cur - prev;
    const on = cur >= thresh ? 1 : 0;
    const dist = Math.abs(i - center) * hopSec;
    const score = rise * 4 + on * 0.35 - dist * 1.6;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best * hopSec;
}

function enforceMonotonic(times: number[]): number[] {
  const out = times.map((t) => (Number.isFinite(t) ? t : 0));
  for (let i = 1; i < out.length; i++) {
    if (out[i]! < out[i - 1]! + MIN_LINE_GAP) {
      out[i] = out[i - 1]! + MIN_LINE_GAP;
    }
  }
  return out;
}

function remapLines(lines: LyricLine[], mediaTimes: number[]): LyricLine[] {
  return lines.map((line, i) => {
    const t = roundMs(mediaTimes[i] ?? line.time);
    const words = line.words;
    if (!words?.length) return { ...line, time: t };
    const nextL = lines[i + 1]?.time;
    const nextM = mediaTimes[i + 1];
    const lrcDur =
      typeof nextL === "number" && nextL > line.time ? nextL - line.time : 0;
    const medDur =
      typeof nextM === "number" && nextM > t ? nextM - t : 0;
    const scale = lrcDur > 0.08 && medDur > 0.08 ? medDur / lrcDur : 1;
    return {
      ...line,
      time: t,
      words: words.map((w) => ({
        ...w,
        time: roundMs(t + (w.time - line.time) * scale),
      })),
    };
  });
}

export type AlignAudioRef = {
  path: string;
  kind: "vocals" | "mix";
  fingerprint: string;
};

function isStreamPath(p: string | null | undefined): boolean {
  if (!p) return true;
  return (
    p.startsWith("stream:") ||
    p.startsWith("stream://") ||
    p.startsWith("live:")
  );
}

/** Prefer a cached Demucs vocals stem; else the library mix. */
export function resolveAlignAudio(trackId: string | null | undefined): AlignAudioRef | null {
  const id = (trackId || "").trim();
  if (!id) return null;

  const vocals = getVocalsFile(id);
  if (vocals) {
    try {
      const st = fs.statSync(vocals);
      if (st.isFile() && st.size > 1024) {
        return {
          path: vocals,
          kind: "vocals",
          fingerprint: `v|${st.size}|${Math.floor(st.mtimeMs)}`,
        };
      }
    } catch {
      /* fall through */
    }
  }

  const track = getTrack(id);
  const mix = track?.path?.trim() || "";
  if (!mix || isStreamPath(mix)) return null;
  try {
    const st = fs.statSync(mix);
    if (!st.isFile() || st.size < 8_000) return null;
    return {
      path: mix,
      kind: "mix",
      fingerprint: `m|${st.size}|${Math.floor(st.mtimeMs)}`,
    };
  } catch {
    return null;
  }
}

export function lrcContentFingerprint(lines: LyricLine[]): string {
  const s = lines.map((l) => `${l.time.toFixed(2)}\t${l.text}`).join("\n");
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

export function alignCacheFingerprint(
  audio: AlignAudioRef,
  lines: LyricLine[],
): string {
  return `${audio.fingerprint}|${lrcContentFingerprint(lines)}`;
}

export type ForceAlignResult = {
  lines: LyricLine[];
  onsetSec: number;
  source: "dtw";
};

function warpMediaTimes(
  lines: LyricLine[],
  onsetSec: number,
  scale: number,
): number[] {
  const s = clampWarpScale(scale);
  return lines.map((l) => roundMs(onsetSec + l.time * (s === 1 ? 1 : s)));
}

/**
 * Align original LRC line times onto a media activity curve.
 * Returns null when DTW is no better than the linear warp (keep warp).
 */
export function alignLinesToEnvelope(
  lines: LyricLine[],
  envelope: MediaEnvelope,
  prior: { onsetSec: number; scale: number; mediaEndSec: number },
): ForceAlignResult | null {
  if (lines.length < 4) return null;
  const last = lastLyricTime(lines);
  if (last < 20) return null;

  const hop = envelope.hopSec;
  const activity = envelope.activity;
  const measuredOnset = activityOnsetSec(activity, hop);
  const trailing = activityTrailingSec(activity, hop);
  const onset =
    measuredOnset != null && measuredOnset >= 0.9
      ? measuredOnset
      : Math.max(0, prior.onsetSec);
  const endByTrail =
    trailing != null ? envelope.durationSec - trailing : envelope.durationSec;
  const contentEnd = Math.max(
    onset + 30,
    Math.min(endByTrail, prior.mediaEndSec || endByTrail),
  );

  const onsetHop = Math.max(0, Math.floor(onset / hop));
  const endHop = Math.min(activity.length, Math.max(onsetHop + 80, Math.ceil(contentEnd / hop)));
  const observedFull = activity.subarray(onsetHop, endHop);
  if (observedFull.length < 24) return null;

  const tmplHop = hop * DTW_STRIDE;
  const template = downsample(
    buildExpectedActivity(lines, hop, last + 4),
    DTW_STRIDE,
  );
  const observed = downsample(observedFull, DTW_STRIDE);
  const map = bandedDtw(template, observed);
  if (!map) return null;

  const raw: number[] = [];
  for (const line of lines) {
    const ti = clamp(
      Math.round(line.time / tmplHop),
      0,
      map.length - 1,
    );
    const obsIdx = map[ti]!;
    const t = onset + obsIdx * tmplHop;
    raw.push(t);
  }

  const snapped = raw.map((t, i) =>
    isGapLine(lines[i]!) ? t : snapToEnergyRise(t, activity, hop),
  );
  const times = enforceMonotonic(snapped);

  const first = times[0] ?? 0;
  const span = (times[times.length - 1] ?? first) - first;
  const lrcSpan = last - firstMeaningfulLyricTime(lines);
  if (span < Math.max(25, lrcSpan * 0.42)) return null;
  if (first > envelope.durationSec * 0.55) return null;

  const warpTimes = warpMediaTimes(lines, onset, prior.scale);
  const dtwScore = meanEnergyAtStarts(times, activity, hop);
  const warpScore = meanEnergyAtStarts(warpTimes, activity, hop);
  // Keep linear warp when DTW clearly parks lines in quieter audio
  if (warpScore > 0.02 && dtwScore < warpScore * 0.88) return null;

  return {
    lines: remapLines(lines, times),
    onsetSec: onset,
    source: "dtw",
  };
}

/**
 * Run ffmpeg envelope + DTW. Null if no file, ffmpeg missing, or quality gate fails.
 */
export async function forceAlignLyricLines(input: {
  lines: LyricLine[];
  trackId: string | null | undefined;
  sourceDurationSec?: number | null;
  mediaDurationSec?: number | null;
  autoOffsetSec: number;
  mediaOnsetSec?: number | null;
  mediaTrailingSec?: number | null;
}): Promise<ForceAlignResult | null> {
  if (input.lines.length < 4) return null;
  const audio = resolveAlignAudio(input.trackId);
  if (!audio) return null;

  const envelope = await extractMediaEnvelope(audio.path, audio.kind);
  if (!envelope) return null;

  const warp = computeLyricsWarp({
    lines: input.lines,
    sourceDurationSec: input.sourceDurationSec,
    mediaDurationSec: input.mediaDurationSec ?? envelope.durationSec,
    mediaOnsetSec: input.mediaOnsetSec,
    mediaTrailingSec: input.mediaTrailingSec,
    autoOffsetSec: input.autoOffsetSec,
  });

  return alignLinesToEnvelope(input.lines, envelope, {
    onsetSec: warp.onsetSec,
    scale: warp.scale,
    mediaEndSec: warp.mediaEndSec || envelope.durationSec,
  });
}
