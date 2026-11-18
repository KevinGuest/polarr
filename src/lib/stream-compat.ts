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
import { dataDir } from "@/lib/paths";
import { resolveFfmpeg } from "@/lib/tools";
import type { StreamQuality } from "@/lib/playback-settings";
import { isStreamQuality } from "@/lib/playback-settings";

/**
 * Pre-encoded sidecar tier. AAC-LC 256 kbps is Apple Music's default and is
 * effectively transparent; it decodes natively everywhere (Safari, AVPlayer,
 * WebView2, Chromium) and is ~4-5× smaller than FLAC — so first-byte-to-sound
 * on click is a fraction of streaming the lossless original.
 */
export const SIDECAR_QUALITY: StreamQuality = "high";

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
  const mobile = (req.headers.get("x-polarr-mobile-platform") || "").trim().toLowerCase();
  if (mobile === "iphone" || mobile === "ipad" || mobile === "ios") return true;
  const ua = req.headers.get("user-agent") || "";
  return /iPhone|iPad|iPod/i.test(ua);
}

export function wantsOfflineDownload(req: Request): boolean {
  return new URL(req.url).searchParams.get("download") === "1";
}

export function streamQualityFromRequest(req: Request): StreamQuality {
  const raw = (new URL(req.url).searchParams.get("quality") || "").trim().toLowerCase();
  return isStreamQuality(raw) ? raw : "high";
}

/** Explicit `quality=` on the URL (web/desktop opt into an AAC tier this way). */
export function requestedStreamQuality(req: Request): StreamQuality | null {
  const raw = (new URL(req.url).searchParams.get("quality") || "").trim().toLowerCase();
  return isStreamQuality(raw) ? raw : null;
}

/**
 * Original must be re-encoded to be served as a device-friendly M4A.
 * Lossy originals (mp3/m4a/aac) are already small and universally decodable —
 * never re-encode those.
 */
export function needsEncode(ext: string): boolean {
  const e = ext.toLowerCase();
  return IOS_TRANSCODE_EXTS.has(e) && !IOS_NATIVE_EXTS.has(e);
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

const SIDECAR_PREFIX = "polarr-compat-";

/**
 * Persistent sidecar directory under the data dir (survives container
 * restarts, unlike os.tmpdir()). Falls back to tmp when data isn't writable.
 */
let encodeCacheDirCache: string | null = null;
export function encodeCacheDir(): string {
  if (encodeCacheDirCache) return encodeCacheDirCache;
  const env = (process.env.POLARR_ENCODE_CACHE_DIR || "").trim();
  const candidates = [env, path.join(safeDataDir(), "encode-cache")].filter(Boolean);
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      encodeCacheDirCache = dir;
      return dir;
    } catch {
      /* try next */
    }
  }
  encodeCacheDirCache = os.tmpdir();
  return encodeCacheDirCache;
}

function safeDataDir(): string {
  try {
    return dataDir();
  } catch {
    return os.tmpdir();
  }
}

function sidecarPathFor(
  filePath: string,
  quality: StreamQuality,
  st: { mtimeMs: number; size: number },
): string {
  const key = createHash("sha1")
    .update(`${filePath}\0${quality}\0${st.mtimeMs}\0${st.size}\0m4a-v2`)
    .digest("hex")
    .slice(0, 20);
  return path.join(encodeCacheDir(), `${SIDECAR_PREFIX}${key}.m4a`);
}

function compatCachePath(filePath: string, quality: StreamQuality): string | null {
  try {
    return sidecarPathFor(filePath, quality, fs.statSync(filePath));
  } catch {
    return null;
  }
}

/** Sync lookup: sidecar already on disk? (No encode, never blocks.) */
export function getCachedCompatM4a(
  filePath: string,
  quality: StreamQuality,
): { path: string; size: number } | null {
  const out = compatCachePath(filePath, quality);
  if (!out) return null;
  try {
    const st = fs.statSync(out);
    if (st.isFile() && st.size > 1024) return { path: out, size: st.size };
  } catch {
    /* miss */
  }
  return null;
}

/** De-dupe concurrent encodes of the same output (iOS request + pre-encoder). */
const inflightEncodes = new Map<string, Promise<{ path: string; size: number } | null>>();

/**
 * Encode (or reuse) a seekable AAC/ALAC M4A. The encode itself is never
 * aborted by a single requester — other waiters (and the sidecar cache)
 * benefit from letting it finish.
 */
export async function ensureCompatM4a(
  filePath: string,
  quality: StreamQuality,
): Promise<{ path: string; size: number } | null> {
  const out = compatCachePath(filePath, quality);
  if (!out) return null;
  const cached = getCachedCompatM4a(filePath, quality);
  if (cached) return cached;

  const existing = inflightEncodes.get(out);
  if (existing) return existing;

  const argsTail =
    quality === "lossless"
      ? ["-c:a", "alac", "-movflags", "+faststart", "-f", "ipod"]
      : ["-c:a", "aac", "-b:a", aacBitrate(quality), "-movflags", "+faststart", "-f", "ipod"];

  // Shared encodes must not die with the first requester's abort.
  const task = (async () => {
    const encoded = await encodeTempFile(filePath, argsTail, "m4a", null);
    if (!encoded) return null;
    try {
      fs.renameSync(encoded.path, out);
      const st = fs.statSync(out);
      return { path: out, size: st.size };
    } catch {
      return encoded;
    }
  })();
  inflightEncodes.set(out, task);
  try {
    return await task;
  } finally {
    inflightEncodes.delete(out);
  }
}

/* ───────────────────────── background pre-encoder ───────────────────────── */

const PREENCODE_DISABLED = /^(0|false|off|no)$/i.test((process.env.POLARR_PREENCODE || "").trim());
/** Stop filling the cache past this many GB (on-demand encodes still run). */
const PREENCODE_MAX_BYTES =
  Math.max(1, Number(process.env.POLARR_ENCODE_CACHE_MAX_GB) || 50) * 1024 ** 3;

const g = globalThis as typeof globalThis & {
  __polarrPreencode?: {
    queue: string[];
    queued: Set<string>;
    running: boolean;
    encoded: number;
    failed: number;
    lastSweep: number;
    /** Tracked sidecar bytes; -1 until first measured. */
    cacheBytes: number;
    cacheBytesAt: number;
  };
};
function preState() {
  if (!g.__polarrPreencode) {
    g.__polarrPreencode = {
      queue: [],
      queued: new Set(),
      running: false,
      encoded: 0,
      failed: 0,
      lastSweep: 0,
      cacheBytes: -1,
      cacheBytesAt: 0,
    };
  }
  // State created by an older build of this module (dev hot reload).
  if (typeof g.__polarrPreencode.cacheBytes !== "number") {
    g.__polarrPreencode.cacheBytes = -1;
    g.__polarrPreencode.cacheBytesAt = 0;
  }
  return g.__polarrPreencode;
}

const CACHE_BYTES_REMEASURE_MS = 15 * 60_000;

/**
 * Size of the sidecar cache. Measured off the event loop and then tracked
 * incrementally: the pre-encoder used to re-stat every sidecar synchronously
 * before each encode, so filling a library of N tracks cost N² blocking stats
 * and stalled streams / pages more and more as the cache grew.
 */
async function cacheDirBytes(): Promise<number> {
  const s = preState();
  if (s.cacheBytes >= 0 && Date.now() - s.cacheBytesAt < CACHE_BYTES_REMEASURE_MS) {
    return s.cacheBytes;
  }
  let total = 0;
  try {
    const dir = encodeCacheDir();
    const names = await fs.promises.readdir(dir);
    for (const name of names) {
      if (!name.startsWith(SIDECAR_PREFIX)) continue;
      try {
        total += (await fs.promises.stat(path.join(dir, name))).size;
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  s.cacheBytes = total;
  s.cacheBytesAt = Date.now();
  return total;
}

/**
 * Queue a sidecar for a single file (e.g. first play of a track that has no
 * sidecar yet). Encodes run one at a time so ffmpeg never starves playback.
 */
export function scheduleSidecarEncode(
  filePath: string,
  quality: StreamQuality = SIDECAR_QUALITY,
): void {
  if (PREENCODE_DISABLED || !ffmpegBin()) return;
  if (!needsEncode(path.extname(filePath))) return;
  if (getCachedCompatM4a(filePath, quality)) return;
  const key = `${quality}\0${filePath}`;
  const s = preState();
  if (s.queued.has(key)) return;
  s.queued.add(key);
  // Interactive misses jump the line ahead of the bulk library sweep.
  s.queue.unshift(key);
  void drainPreencodeQueue();
}

async function drainPreencodeQueue() {
  const s = preState();
  if (s.running) return;
  s.running = true;
  try {
    while (s.queue.length) {
      const key = s.queue.shift()!;
      s.queued.delete(key);
      const sep = key.indexOf("\0");
      const quality = key.slice(0, sep) as StreamQuality;
      const filePath = key.slice(sep + 1);
      if (getCachedCompatM4a(filePath, quality)) continue;
      if ((await cacheDirBytes()) >= PREENCODE_MAX_BYTES) {
        console.warn(
          `[polarr] encode cache at limit (${(PREENCODE_MAX_BYTES / 1024 ** 3).toFixed(0)} GB) — skipping pre-encode; raise POLARR_ENCODE_CACHE_MAX_GB`,
        );
        s.queue.length = 0;
        s.queued.clear();
        break;
      }
      const ok = await ensureCompatM4a(filePath, quality);
      if (ok) {
        s.encoded += 1;
        if (s.cacheBytes >= 0) s.cacheBytes += ok.size;
      } else s.failed += 1;
      // Yield between files so request handlers / scans interleave.
      await new Promise((r) => setTimeout(r, 150));
    }
  } finally {
    s.running = false;
  }
}

/**
 * Enqueue sidecars for every library track that needs one (newest first) and
 * drop sidecars whose source no longer exists. Called after each library scan.
 */
export async function warmLibrarySidecars(paths: string[]): Promise<{
  queued: number;
  removed: number;
}> {
  if (PREENCODE_DISABLED || !ffmpegBin()) return { queued: 0, removed: 0 };
  const s = preState();
  const expected = new Set<string>();
  let queued = 0;
  // One directory listing instead of an existsSync per track, and async stats:
  // this runs over the whole library after every scan and must not block.
  let present: Set<string> | null = null;
  try {
    present = new Set(await fs.promises.readdir(encodeCacheDir()));
  } catch {
    present = null;
  }
  for (const p of paths) {
    if (!p || !needsEncode(path.extname(p))) continue;
    let out: string;
    try {
      out = sidecarPathFor(p, SIDECAR_QUALITY, await fs.promises.stat(p));
    } catch {
      continue;
    }
    const name = path.basename(out);
    expected.add(name);
    if (present ? present.has(name) : fs.existsSync(out)) continue;
    const key = `${SIDECAR_QUALITY}\0${p}`;
    if (s.queued.has(key)) continue;
    s.queued.add(key);
    s.queue.push(key);
    queued += 1;
  }

  // Sweep orphans (file edited/deleted) at most once a day; keep other tiers'
  // on-demand encodes younger than a week so iOS users aren't re-encoded daily.
  let removed = 0;
  const now = Date.now();
  if (now - s.lastSweep > 24 * 3600_000) {
    s.lastSweep = now;
    try {
      const dir = encodeCacheDir();
      for (const name of await fs.promises.readdir(dir)) {
        if (!name.startsWith(SIDECAR_PREFIX) || expected.has(name)) continue;
        const full = path.join(dir, name);
        try {
          const st = await fs.promises.stat(full);
          if (now - st.mtimeMs < 7 * 24 * 3600_000) continue;
          await fs.promises.unlink(full);
          removed += 1;
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    if (removed) s.cacheBytesAt = 0; // re-measure after a sweep
  }

  if (queued) void drainPreencodeQueue();
  return { queued, removed };
}

export function getPreencodeStatus() {
  const s = preState();
  void cacheDirBytes().catch(() => {});
  return {
    enabled: !PREENCODE_DISABLED && Boolean(ffmpegBin()),
    quality: SIDECAR_QUALITY,
    pending: s.queue.length,
    running: s.running,
    encoded: s.encoded,
    failed: s.failed,
    cacheDir: encodeCacheDir(),
    // Last measured size (refreshed in the background, never on this request).
    cacheBytes: Math.max(0, s.cacheBytes),
  };
}

/** Byte-range response so HTMLMediaElement can seek. */
export function serveCompatRangedFile(
  req: Request,
  filePath: string,
  size: number,
  contentType: string,
  quality: StreamQuality,
): Response {
  // Sidecar name is keyed on source mtime+size — safe to treat as immutable so
  // the browser / service worker reuse it across seeks and replays.
  const cacheControl = "private, max-age=86400, immutable";
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

  const cached = await ensureCompatM4a(filePath, quality);
  if (!cached) return null;
  // Copy to a disposable temp so download cleanup can unlink freely.
  const tmp = path.join(os.tmpdir(), `polarr-dl-${process.pid}-${Date.now()}.m4a`);
  try {
    fs.copyFileSync(cached.path, tmp);
  } catch {
    return serveTempFile(cached, "audio/mp4", quality, "track.m4a", signal);
  }
  let size = 0;
  try {
    size = fs.statSync(tmp).size;
  } catch {
    return null;
  }
  return serveTempFile({ path: tmp, size }, "audio/mp4", quality, "track.m4a", signal);
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
  const cached = await ensureCompatM4a(filePath, quality);
  if (cached) {
    return serveCompatRangedFile(req, cached.path, cached.size, "audio/mp4", quality);
  }
  if (quality === "lossless") return null;
  return startCompatAacStream(filePath, ext, quality, req.signal);
}
