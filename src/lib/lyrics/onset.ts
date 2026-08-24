/**
 * Detect where timed-lyric content starts and ends on an audio file.
 * Leading: band-limited silence over the first ~2.5 minutes.
 * Trailing: silencedetect on the last ~90 seconds (YouTube outro / pad).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { ffmpegAvailable } from "../tools";

const TAIL_WINDOW_SEC = 90;

type MediaBounds = {
  onsetSec: number | null;
  trailingSec: number | null;
};

const BOUNDS_CACHE = new Map<string, { mtimeMs: number } & MediaBounds>();

function ffmpegBin(): string {
  return process.env.POLARR_FFMPEG_PATH?.trim() || "ffmpeg";
}

function runFfmpeg(args: string[], timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegBin(), args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let head = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (head.length < 4000) head += text;
      stderr += text;
      // Keep tail — trailing silence tags land at the end of the log
      if (stderr.length > 120_000) stderr = stderr.slice(-80_000);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(head.length && !stderr.includes(head.slice(0, 40)) ? `${head}\n${stderr}` : stderr);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(head.length && !stderr.includes(head.slice(0, 40)) ? `${head}\n${stderr}` : stderr);
    });
  });
}

/**
 * Parse ffmpeg silencedetect log → leading content onset seconds.
 * Exported for unit-style checks.
 */
export function parseLeadingOnsetSec(stderr: string): number | null {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    const s = /silence_start:\s*([-\d.]+)/i.exec(line);
    if (s) {
      const v = Number(s[1]);
      if (Number.isFinite(v)) starts.push(v);
    }
    const e = /silence_end:\s*([-\d.]+)/i.exec(line);
    if (e) {
      const v = Number(e[1]);
      if (Number.isFinite(v)) ends.push(v);
    }
  }

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!;
    // Leading pad: silence begins at/near file start
    if (start <= 0.45) {
      const end = ends[i];
      if (typeof end === "number" && end >= 0.9 && end <= 140) {
        return Math.round(end * 10) / 10;
      }
    }
  }

  // Some ffmpeg builds only print silence_end when silence began at t=0
  if (!starts.length && ends.length) {
    const end = ends[0]!;
    if (end >= 0.9 && end <= 140) return Math.round(end * 10) / 10;
  }

  return null;
}

export function parseFfmpegDurationSec(stderr: string): number | null {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i.exec(stderr);
  if (!m) return null;
  const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number.isFinite(sec) && sec > 0 ? sec : null;
}

/**
 * Parse ffmpeg silencedetect on a tail window → trailing silence seconds.
 * Handles both window-relative timestamps (common after -sseof) and
 * file-absolute PTS.
 */
export function parseTrailingSilenceSec(
  stderr: string,
  windowSec = TAIL_WINDOW_SEC,
): number | null {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    const s = /silence_start:\s*([-\d.]+)/i.exec(line);
    if (s) {
      const v = Number(s[1]);
      if (Number.isFinite(v) && v >= 0) starts.push(v);
    }
    const e = /silence_end:\s*([-\d.]+)/i.exec(line);
    if (e) {
      const v = Number(e[1]);
      if (Number.isFinite(v) && v >= 0) ends.push(v);
    }
  }
  if (!starts.length) return null;

  const fileDur = parseFfmpegDurationSec(stderr);
  const maxT = Math.max(...starts, ...ends);
  const absolute = maxT > windowSec + 2;
  const endT = absolute
    ? (fileDur && fileDur > maxT - 2 ? fileDur : maxT)
    : Math.min(windowSec, fileDur ?? windowSec);

  const events = [
    ...starts.map((t) => ({ t, kind: "start" as const })),
    ...ends.map((t) => ({ t, kind: "end" as const })),
  ].sort((a, b) => a.t - b.t || (a.kind === "end" ? -1 : 1));

  let inSilence = false;
  let lastStart = 0;
  let lastEnd = 0;
  for (const ev of events) {
    if (ev.kind === "start") {
      inSilence = true;
      lastStart = ev.t;
    } else {
      inSilence = false;
      lastEnd = ev.t;
    }
  }

  if (!inSilence) {
    // Silence that ends at EOF still counts as trailing pad
    if (!(lastEnd > 0 && endT - lastEnd <= 0.45)) return null;
  }

  const trailing = endT - lastStart;
  if (trailing < 0.8 || trailing > 60) return null;
  return Math.round(trailing * 10) / 10;
}

async function detectLeadingOnset(path: string): Promise<number | null> {
  // Speech-ish band so pure low pad / soft MV noise counts as silence more often
  const stderr = await runFfmpeg([
    "-hide_banner",
    "-nostats",
    "-t",
    "150",
    "-i",
    path,
    "-af",
    "highpass=f=150,lowpass=f=4500,silencedetect=noise=-42dB:d=0.35",
    "-f",
    "null",
    "-",
  ]);

  let onset = parseLeadingOnsetSec(stderr);

  if (onset == null) {
    const stderr2 = await runFfmpeg([
      "-hide_banner",
      "-nostats",
      "-t",
      "90",
      "-i",
      path,
      "-af",
      "silencedetect=noise=-50dB:d=0.45",
      "-f",
      "null",
      "-",
    ]);
    onset = parseLeadingOnsetSec(stderr2);
  }
  return onset;
}

async function detectTrailingSilence(path: string): Promise<number | null> {
  const stderr = await runFfmpeg(
    [
      "-hide_banner",
      "-nostats",
      "-sseof",
      `-${TAIL_WINDOW_SEC}`,
      "-i",
      path,
      "-af",
      "highpass=f=150,lowpass=f=4500,silencedetect=noise=-42dB:d=0.4",
      "-f",
      "null",
      "-",
    ],
    25_000,
  );

  let trailing = parseTrailingSilenceSec(stderr, TAIL_WINDOW_SEC);

  if (trailing == null) {
    const stderr2 = await runFfmpeg(
      [
        "-hide_banner",
        "-nostats",
        "-sseof",
        `-${TAIL_WINDOW_SEC}`,
        "-i",
        path,
        "-af",
        "silencedetect=noise=-50dB:d=0.5",
        "-f",
        "null",
        "-",
      ],
      25_000,
    );
    trailing = parseTrailingSilenceSec(stderr2, TAIL_WINDOW_SEC);
  }
  return trailing;
}

/**
 * Leading content onset + trailing silence on an on-disk file.
 * Nulls mean “loud through that edge” or analysis unavailable.
 */
export async function detectMediaContentBounds(
  filePath: string,
): Promise<MediaBounds> {
  const empty: MediaBounds = { onsetSec: null, trailingSec: null };
  const path = (filePath || "").trim();
  if (!path) return empty;

  let mtimeMs = 0;
  try {
    const st = fs.statSync(path);
    if (!st.isFile() || st.size < 8_000) return empty;
    mtimeMs = st.mtimeMs;
  } catch {
    return empty;
  }

  const hit = BOUNDS_CACHE.get(path);
  if (hit && hit.mtimeMs === mtimeMs) {
    return { onsetSec: hit.onsetSec, trailingSec: hit.trailingSec };
  }

  if (!(await ffmpegAvailable())) {
    BOUNDS_CACHE.set(path, { mtimeMs, ...empty });
    return empty;
  }

  const [onsetSec, trailingSec] = await Promise.all([
    detectLeadingOnset(path),
    detectTrailingSilence(path),
  ]);

  const bounds: MediaBounds = { onsetSec, trailingSec };
  BOUNDS_CACHE.set(path, { mtimeMs, ...bounds });
  return bounds;
}

/**
 * Seconds from file start until continuous (band-limited) content begins.
 * Returns null when the file is loud from t≈0 or analysis is unavailable.
 */
export async function detectMediaOnsetSec(
  filePath: string,
): Promise<number | null> {
  const bounds = await detectMediaContentBounds(filePath);
  return bounds.onsetSec;
}
