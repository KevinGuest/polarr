/**
 * Band-limited RMS envelope from an on-disk audio file (mix or vocals stem).
 * Original Polarr code — used by the local lyrics aligner.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { ffmpegAvailable } from "../tools";

export const ENVELOPE_SR = 22050;
/** ~40ms hop — fine enough to snap line starts, cheap to DTW after stride. */
export const ENVELOPE_HOP_SAMPLES = 882;
export const ENVELOPE_HOP_SEC = ENVELOPE_HOP_SAMPLES / ENVELOPE_SR;

const MAX_PCM_BYTES = 40 * 1024 * 1024;
const MAX_TRACK_SEC = 720;

function ffmpegBin(): string {
  return process.env.POLARR_FFMPEG_PATH?.trim() || "ffmpeg";
}

function runFfmpegPcm(args: string[], timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const finish = (err: Error | null, buf: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(buf);
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      finish(new Error("ffmpeg envelope timed out"), Buffer.alloc(0));
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_PCM_BYTES) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        finish(new Error("pcm too large"), Buffer.alloc(0));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr?.on("data", () => {
      /* decode progress only */
    });
    child.on("error", (err) => finish(err, Buffer.alloc(0)));
    child.on("close", (code) => {
      if (code !== 0 && total < 2048) {
        finish(new Error(`ffmpeg exited ${code}`), Buffer.alloc(0));
        return;
      }
      finish(null, Buffer.concat(chunks, total));
    });
  });
}

/** RMS per hop from interleaved s16le mono. */
export function rmsFromS16le(
  pcm: Buffer,
  hopSamples = ENVELOPE_HOP_SAMPLES,
): Float32Array {
  const samples = pcm.length >> 1;
  const hops = Math.max(0, Math.floor(samples / hopSamples));
  const out = new Float32Array(hops);
  for (let h = 0; h < hops; h++) {
    const base = h * hopSamples;
    let acc = 0;
    for (let i = 0; i < hopSamples; i++) {
      const s = pcm.readInt16LE((base + i) * 2) / 32768;
      acc += s * s;
    }
    out[h] = Math.sqrt(acc / hopSamples);
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))),
  );
  return sorted[idx]!;
}

/**
 * Turn raw RMS into a 0–1 vocal-activity curve.
 * Subtracts a slow floor so pads / sustained mix energy don’t look like singing.
 */
export function rmsToActivity(rms: Float32Array, hopSec: number): Float32Array {
  const n = rms.length;
  const out = new Float32Array(n);
  if (n < 4) return out;

  const win = Math.max(5, Math.round(1.8 / hopSec));
  const scratch: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - win);
    const b = Math.min(n, i + win + 1);
    scratch.length = 0;
    for (let k = a; k < b; k++) scratch.push(rms[k]!);
    scratch.sort((x, y) => x - y);
    const floor = percentile(scratch, 0.3);
    out[i] = Math.max(0, rms[i]! - floor);
  }

  // Light onset mix so line attacks stand out without becoming a click track
  const mixed = new Float32Array(n);
  mixed[0] = out[0]!;
  for (let i = 1; i < n; i++) {
    const onset = Math.max(0, out[i]! - out[i - 1]!);
    mixed[i] = out[i]! * 0.86 + onset * 0.14;
  }

  // Smooth ~120ms
  const sm = Math.max(1, Math.round(0.12 / hopSec));
  const smooth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    let c = 0;
    for (let k = i - sm; k <= i + sm; k++) {
      if (k < 0 || k >= n) continue;
      acc += mixed[k]!;
      c++;
    }
    smooth[i] = c ? acc / c : 0;
  }

  const copy = Array.from(smooth).sort((a, b) => a - b);
  const p95 = percentile(copy, 0.95);
  const scale = p95 > 1e-6 ? p95 : 1;
  for (let i = 0; i < n; i++) {
    smooth[i] = Math.max(0, Math.min(1, smooth[i]! / scale));
  }
  return smooth;
}

export type MediaEnvelope = {
  /** 0–1 vocal-ish activity, one value per hop. */
  activity: Float32Array;
  hopSec: number;
  durationSec: number;
};

/**
 * Decode mono 22050 Hz, band-limit toward vocals, return activity vs time.
 * `vocals` skips the harsh band-limit (stem is already isolated).
 */
export async function extractMediaEnvelope(
  filePath: string,
  kind: "vocals" | "mix" = "mix",
): Promise<MediaEnvelope | null> {
  const path = (filePath || "").trim();
  if (!path) return null;
  try {
    const st = fs.statSync(path);
    if (!st.isFile() || st.size < 8_000) return null;
  } catch {
    return null;
  }
  if (!(await ffmpegAvailable())) return null;

  const af =
    kind === "vocals"
      ? "highpass=f=120,lowpass=f=8000"
      : "highpass=f=300,lowpass=f=3500";

  let pcm: Buffer;
  try {
    pcm = await runFfmpegPcm(
      [
        "-hide_banner",
        "-nostats",
        "-t",
        String(MAX_TRACK_SEC),
        "-i",
        path,
        "-ac",
        "1",
        "-ar",
        String(ENVELOPE_SR),
        "-af",
        af,
        "-f",
        "s16le",
        "pipe:1",
      ],
      20_000,
    );
  } catch {
    return null;
  }
  if (pcm.length < ENVELOPE_HOP_SAMPLES * 2 * 8) return null;

  const rms = rmsFromS16le(pcm);
  if (rms.length < 16) return null;
  const activity = rmsToActivity(rms, ENVELOPE_HOP_SEC);
  return {
    activity,
    hopSec: ENVELOPE_HOP_SEC,
    durationSec: rms.length * ENVELOPE_HOP_SEC,
  };
}

export function activityOnsetSec(activity: Float32Array, hopSec: number): number | null {
  if (activity.length < 8) return null;
  const copy = Array.from(activity).sort((a, b) => a - b);
  const lo = percentile(copy, 0.35);
  const hi = percentile(copy, 0.9);
  const thresh = lo + 0.18 * Math.max(1e-6, hi - lo);
  const need = Math.max(3, Math.round(0.35 / hopSec));
  for (let i = 0; i < activity.length - need; i++) {
    let ok = true;
    for (let k = 0; k < need; k++) {
      if (activity[i + k]! < thresh) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const t = i * hopSec;
    if (t < 0.9) return null;
    if (t > 140) return null;
    return Math.round(t * 10) / 10;
  }
  return null;
}

export function activityTrailingSec(
  activity: Float32Array,
  hopSec: number,
): number | null {
  if (activity.length < 16) return null;
  const copy = Array.from(activity).sort((a, b) => a - b);
  const lo = percentile(copy, 0.35);
  const hi = percentile(copy, 0.9);
  const thresh = lo + 0.12 * Math.max(1e-6, hi - lo);
  let i = activity.length - 1;
  while (i > 0 && activity[i]! < thresh) i--;
  const trailing = (activity.length - 1 - i) * hopSec;
  if (trailing < 0.8 || trailing > 60) return null;
  return Math.round(trailing * 10) / 10;
}
