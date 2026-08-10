/**
 * Detect where timed-lyric “song zero” lands on an audio file.
 * Uses band-limited silence detection over the first ~2.5 minutes.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { ffmpegAvailable } from "../tools";

const ONSET_CACHE = new Map<string, { mtimeMs: number; onsetSec: number | null }>();

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
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      // Keep tail only — silence tags near the start still appear early
      if (stderr.length > 120_000) stderr = stderr.slice(-80_000);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(stderr);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(stderr);
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

/**
 * Seconds from file start until continuous (band-limited) content begins.
 * Returns null when the file is loud from t≈0 or analysis is unavailable.
 */
export async function detectMediaOnsetSec(
  filePath: string,
): Promise<number | null> {
  const path = (filePath || "").trim();
  if (!path) return null;

  let mtimeMs = 0;
  try {
    const st = fs.statSync(path);
    if (!st.isFile() || st.size < 8_000) return null;
    mtimeMs = st.mtimeMs;
  } catch {
    return null;
  }

  const hit = ONSET_CACHE.get(path);
  if (hit && hit.mtimeMs === mtimeMs) return hit.onsetSec;

  if (!(await ffmpegAvailable())) {
    ONSET_CACHE.set(path, { mtimeMs, onsetSec: null });
    return null;
  }

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

  // Second pass: quieter noise floor for library files with soft air / breath
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

  ONSET_CACHE.set(path, { mtimeMs, onsetSec: onset });
  return onset;
}
