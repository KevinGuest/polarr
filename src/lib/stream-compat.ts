/**
 * iOS Safari / WKWebView cannot decode FLAC (and some other codecs) via
 * HTMLAudioElement. Clients send compat=1 + quality=… and we either pass
 * through phone-native files or encode a device-friendly copy.
 *
 * Qualities (Spotify-style):
 *  - lossless — original when already playable on iOS; else ALAC in .m4a
 *  - high     — AAC ~256 kbps
 *  - standard — AAC ~160 kbps
 *  - compact  — AAC ~96 kbps
 *
 * Offline downloads (download=1) materialize a full file with Content-Length.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { resolveFfmpeg } from "@/lib/tools";
import type { StreamQuality } from "@/lib/playback-settings";
import { isStreamQuality } from "@/lib/playback-settings";

/** Need encode for iOS <audio>. */
export const IOS_TRANSCODE_EXTS = new Set([
  ".flac",
  ".ogg",
  ".opus",
  ".wav",
  ".wma",
  ".aiff",
  ".aif",
]);

/** Already fine on iOS — never re-encode these for compat. */
export const IOS_NATIVE_EXTS = new Set([".mp3", ".m4a", ".aac"]);

export function wantsCompatStream(req: Request): boolean {
  const url = new URL(req.url);
  if (url.searchParams.get("compat") === "1") return true;
  const mobile = (req.headers.get("x-polarr-mobile-platform") || "")
    .trim()
    .toLowerCase();
  if (mobile === "iphone" || mobile === "ipad" || mobile === "ios") return true;
  const ua = req.headers.get("user-agent") || "";
  return /iPhone|iPad|iPod/i.test(ua);
}

export function wantsOfflineDownload(req: Request): boolean {
  return new URL(req.url).searchParams.get("download") === "1";
}

export function streamQualityFromRequest(req: Request): StreamQuality {
  const raw = (new URL(req.url).searchParams.get("quality") || "")
    .trim()
    .toLowerCase();
  return isStreamQuality(raw) ? raw : "high";
}

function ffmpegBin(): string | null {
  return resolveFfmpeg();
}

function aacBitrate(quality: StreamQuality): string {
  if (quality === "compact") return "96k";
  if (quality === "standard") return "160k";
  return "256k"; // high (and fallback)
}

function killChild(child: ReturnType<typeof spawn>) {
  try {
    if (!child.killed) child.kill("SIGKILL");
  } catch {
    /* ignore */
  }
}

function attachAbort(signal: AbortSignal | null | undefined, kill: () => void) {
  if (!signal) return;
  if (signal.aborted) {
    kill();
    return;
  }
  signal.addEventListener("abort", kill, { once: true });
}

/**
 * Live AAC ADTS pipe — fallback only when a seekable M4A encode fails.
 * Progressive ADTS cannot scrub (Accept-Ranges: none).
 */
export function startCompatAacStream(
  filePath: string,
  ext: string,
  quality: StreamQuality,
  signal?: AbortSignal | null,
): Response | null {
  if (!IOS_TRANSCODE_EXTS.has(ext.toLowerCase())) return null;
  if (quality === "lossless") return null; // use ALAC file path instead
  const ffmpeg = ffmpegBin();
  if (!ffmpeg) return null;

  const child = spawn(
    ffmpeg,
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      filePath,
      "-vn",
      "-c:a",
      "aac",
      "-b:a",
      aacBitrate(quality),
      "-f",
      "adts",
      "pipe:1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const stdout = child.stdout;
  if (!stdout) {
    killChild(child);
    return null;
  }

  const kill = () => killChild(child);
  attachAbort(signal, kill);
  stdout.on("error", kill);
  child.stderr?.on("data", () => {
    /* drain */
  });
  child.on("error", kill);
  child.on("close", () => {
    if (signal) signal.removeEventListener("abort", kill);
  });

  const web = Readable.toWeb(stdout) as unknown as ReadableStream;
  return new Response(web, {
    status: 200,
    headers: {
      "Content-Type": "audio/aac",
      "Cache-Control": "private, no-store",
      "Accept-Ranges": "none",
      "X-Polarr-Stream-Quality": quality,
    },
  });
}

function compatCachePath(filePath: string, quality: StreamQuality): string | null {
  try {
    const st = fs.statSync(filePath);
    const key = createHash("sha1")
      .update(
        `${filePath}\0${quality}\0${st.mtimeMs}\0${st.size}\0m4a-v2`,
      )
      .digest("hex")
      .slice(0, 20);
    return path.join(os.tmpdir(), `polarr-compat-${key}.m4a`);
  } catch {
    return null;
  }
}

/** Encode (or reuse) a seekable AAC/ALAC M4A for iOS HTMLAudio scrubbing. */
async function ensureCompatM4a(
  filePath: string,
  quality: StreamQuality,
  signal?: AbortSignal | null,
): Promise<{ path: string; size: number } | null> {
  const out = compatCachePath(filePath, quality);
  if (!out) return null;
  try {
    if (fs.existsSync(out)) {
      const st = fs.statSync(out);
      if (st.isFile() && st.size > 1024) return { path: out, size: st.size };
    }
  } catch {
    /* re-encode */
  }

  const argsTail =
    quality === "lossless"
      ? ["-c:a", "alac", "-movflags", "+faststart", "-f", "ipod"]
      : [
          "-c:a",
          "aac",
          "-b:a",
          aacBitrate(quality),
          "-movflags",
          "+faststart",
          "-f",
          "ipod",
        ];

  const encoded = await encodeTempFile(filePath, argsTail, "m4a", signal);
  if (!encoded) return null;
  try {
    fs.renameSync(encoded.path, out);
    const st = fs.statSync(out);
    return { path: out, size: st.size };
  } catch {
    return encoded;
  }
}

/** Byte-range response so HTMLMediaElement can seek. */
export function serveCompatRangedFile(
  req: Request,
  filePath: string,
  size: number,
  contentType: string,
  quality: StreamQuality,
): Response {
  const cacheControl = "private, max-age=3600";
  const range = req.headers.get("range");
  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (!match) {
      return new Response("Invalid range", { status: 416 });
    }
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : size - 1;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      start >= size ||
      end >= size ||
      end < start
    ) {
      return new Response("Range not satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    const chunk = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(stream as unknown as BodyInit, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunk),
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
        "X-Polarr-Stream-Quality": quality,
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Length": String(size),
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl,
      "X-Polarr-Stream-Quality": quality,
    },
  });
}

async function encodeTempFile(
  filePath: string,
  argsTail: string[],
  outExt: string,
  signal?: AbortSignal | null,
): Promise<{ path: string; size: number } | null> {
  const ffmpeg = ffmpegBin();
  if (!ffmpeg) return null;

  const tmp = path.join(
    os.tmpdir(),
    `polarr-compat-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.${outExt}`,
  );

  const code = await new Promise<number>((resolve) => {
    const child = spawn(
      ffmpeg,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        filePath,
        "-vn",
        ...argsTail,
        tmp,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const kill = () => killChild(child);
    if (signal?.aborted) {
      kill();
      resolve(1);
      return;
    }
    attachAbort(signal, kill);
    child.stderr?.on("data", () => {
      /* drain */
    });
    child.on("error", () => resolve(1));
    child.on("close", (exit) => {
      if (signal) signal.removeEventListener("abort", kill);
      resolve(exit ?? 1);
    });
  });

  if (code !== 0 || !fs.existsSync(tmp)) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return null;
  }

  try {
    const stat = fs.statSync(tmp);
    return { path: tmp, size: stat.size };
  } catch {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return null;
  }
}

function serveTempFile(
  tmp: { path: string; size: number },
  contentType: string,
  quality: StreamQuality,
  filename: string,
  signal?: AbortSignal | null,
): Response {
  const stream = fs.createReadStream(tmp.path);
  const cleanup = () => {
    try {
      fs.unlinkSync(tmp.path);
    } catch {
      /* ignore */
    }
  };
  stream.on("close", cleanup);
  stream.on("error", cleanup);
  if (signal) signal.addEventListener("abort", cleanup, { once: true });

  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(tmp.size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "Accept-Ranges": "none",
      "X-Polarr-Stream-Quality": quality,
    },
  });
}

/** Offline / lossless: full file with Content-Length. */
export async function startCompatEncodedDownload(
  filePath: string,
  ext: string,
  quality: StreamQuality,
  signal?: AbortSignal | null,
): Promise<Response | null> {
  if (!IOS_TRANSCODE_EXTS.has(ext.toLowerCase())) return null;

  const cached = await ensureCompatM4a(filePath, quality, signal);
  if (!cached) return null;
  // Copy to a disposable temp so download cleanup can unlink freely.
  const tmp = path.join(
    os.tmpdir(),
    `polarr-dl-${process.pid}-${Date.now()}.m4a`,
  );
  try {
    fs.copyFileSync(cached.path, tmp);
  } catch {
    return serveTempFile(
      cached,
      "audio/mp4",
      quality,
      "track.m4a",
      signal,
    );
  }
  let size = 0;
  try {
    size = fs.statSync(tmp).size;
  } catch {
    return null;
  }
  return serveTempFile(
    { path: tmp, size },
    "audio/mp4",
    quality,
    "track.m4a",
    signal,
  );
}

/**
 * Progressive play: seekable AAC/ALAC M4A (byte ranges). Falls back to ADTS
 * pipe only if encode fails — that path cannot scrub.
 */
export async function startCompatPlayback(
  filePath: string,
  ext: string,
  quality: StreamQuality,
  req: Request,
): Promise<Response | null> {
  if (!IOS_TRANSCODE_EXTS.has(ext.toLowerCase())) return null;
  const cached = await ensureCompatM4a(filePath, quality, req.signal);
  if (cached) {
    return serveCompatRangedFile(
      req,
      cached.path,
      cached.size,
      "audio/mp4",
      quality,
    );
  }
  if (quality === "lossless") return null;
  return startCompatAacStream(filePath, ext, quality, req.signal);
}
