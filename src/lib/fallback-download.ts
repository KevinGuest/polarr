import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  createDownloadJob,
  getDownload,
  getRequest,
  getTrackByPath,
  listDownloads,
  updateDownloadJob,
  updateRequestStatus,
  upsertTrack,
  type TrackRow,
} from "./db";
import { downloadsDir } from "./paths";
import {
  ensureYtDlp,
  ffmpegAvailable,
  ytDlpAvailable as toolsYtDlpAvailable,
} from "./tools";

/**
 * Fallback acquisition pipeline (Downtify-inspired):
 * free-text / metadata search → yt-dlp audio extract → local library.
 * Resolves yt-dlp from image install, PATH, or auto-download under data/bin.
 * Admin stop signal kills the active child and marks the job cancelled.
 * Jobs older than DOWNLOAD_TIMEOUT_MS are failed as "Request timed out".
 */
export function ytDlpAvailable(): Promise<boolean> {
  return toolsYtDlpAvailable();
}

/** Max wall time for a fallback download before auto-fail. */
export const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

export const REQUEST_TIMED_OUT = "Request timed out";
export const TRACK_NOT_FOUND = "Track not found";
export const ALBUM_NOT_FOUND = "Album not found";

const activeProcs = new Map<string, ChildProcess>();
const stopFlags = new Set<string>();
const timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();

function isStopped(jobId: string): boolean {
  return stopFlags.has(jobId);
}

function clearTimeoutTimer(jobId: string) {
  const t = timeoutTimers.get(jobId);
  if (t) {
    clearTimeout(t);
    timeoutTimers.delete(jobId);
  }
}

function killJobProcess(jobId: string) {
  const child = activeProcs.get(jobId);
  if (!child) return;
  try {
    child.kill("SIGTERM");
  } catch {
    /* already exiting */
  }
  setTimeout(() => {
    try {
      if (!child.killed) child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }, 800);
}

/** Map yt-dlp / OS noise into short UI errors for hover. */
export function friendlyDownloadError(
  stderr: string,
  code?: number,
  mediaType?: string | null,
): string {
  const s = (stderr || "").toLowerCase();
  if (
    /timed?\s*out|timeout|deadline exceeded|etimedout/.test(s)
  ) {
    return REQUEST_TIMED_OUT;
  }
  if (
    /no results?|no video results?|unable to (download|extract|download webpage)|does not exist|not found|unsupported url|entry not found|video unavailable|no suitable formats?|private video|copyright/.test(
      s,
    )
  ) {
    return mediaType === "album" || mediaType === "artist"
      ? ALBUM_NOT_FOUND
      : TRACK_NOT_FOUND;
  }
  const tail = (stderr || "").trim().slice(-280);
  if (tail) return tail.split(/\r?\n/).filter(Boolean).slice(-1)[0] || "Download failed";
  if (code != null && code !== 0) return "Download failed";
  return "Download failed";
}

/**
 * Fail a running/queued job as timed out (kills yt-dlp if active).
 * Idempotent if already terminal.
 */
export function failDownloadTimedOut(jobId: string): boolean {
  const job = getDownload(jobId);
  if (!job) return false;
  if (
    job.status === "completed" ||
    job.status === "failed" ||
    job.status === "cancelled"
  ) {
    return false;
  }

  clearTimeoutTimer(jobId);
  stopFlags.add(jobId);
  killJobProcess(jobId);
  updateDownloadJob(jobId, {
    status: "failed",
    error: REQUEST_TIMED_OUT,
    progress: 0,
  });
  return true;
}

/** Sweep stuck jobs past 30m (orphan after restart or hung child). */
export function failTimedOutDownloads(): number {
  const cutoff = Date.now() - DOWNLOAD_TIMEOUT_MS;
  let n = 0;
  for (const job of listDownloads(200)) {
    if (job.status !== "queued" && job.status !== "running") continue;
    const started = Date.parse(job.createdAt);
    if (!Number.isFinite(started) || started > cutoff) continue;
    if (failDownloadTimedOut(job.id)) n += 1;
  }
  return n;
}

function scheduleJobTimeout(jobId: string, createdAt: string) {
  clearTimeoutTimer(jobId);
  const started = Date.parse(createdAt);
  const elapsed = Number.isFinite(started) ? Date.now() - started : 0;
  const remaining = Math.max(0, DOWNLOAD_TIMEOUT_MS - elapsed);
  const timer = setTimeout(() => {
    timeoutTimers.delete(jobId);
    failDownloadTimedOut(jobId);
  }, remaining);
  // Don't keep process alive solely for idle timeout in rare edge cases
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
  timeoutTimers.set(jobId, timer);
}

function run(
  jobId: string,
  cmd: string,
  args: string[],
  onLine?: (line: string) => void,
): Promise<{ code: number; stdout: string; stderr: string; cancelled: boolean }> {
  return new Promise((resolve, reject) => {
    if (isStopped(jobId)) {
      resolve({ code: -1, stdout: "", stderr: "Stopped", cancelled: true });
      return;
    }
    // Never use shell:true — Node concatenates args unquoted on Windows, which
    // splits queries like "Artist - Title" and -o templates into fake URLs.
    const child = spawn(cmd, args, {
      shell: false,
      env: process.env,
      windowsHide: true,
    });
    activeProcs.set(jobId, child);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (buf: Buffer) => {
      if (isStopped(jobId)) return;
      const text = buf.toString();
      stdout += text;
      text.split(/\r?\n/).forEach((line) => line && onLine?.(line));
    });
    child.stderr?.on("data", (buf: Buffer) => {
      if (isStopped(jobId)) return;
      const text = buf.toString();
      stderr += text;
      text.split(/\r?\n/).forEach((line) => line && onLine?.(line));
    });
    child.on("error", (err) => {
      activeProcs.delete(jobId);
      reject(err);
    });
    child.on("close", (code) => {
      activeProcs.delete(jobId);
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
        cancelled: isStopped(jobId),
      });
    });
  });
}

/** Kill active yt-dlp child and mark job + linked request cancelled. */
export function stopDownloadJob(jobId: string): {
  ok: boolean;
  error?: string;
} {
  const job = getDownload(jobId);
  if (!job) return { ok: false, error: "Job not found" };
  if (job.status === "completed" || job.status === "cancelled") {
    return { ok: false, error: `Job already ${job.status}` };
  }

  clearTimeoutTimer(jobId);
  stopFlags.add(jobId);
  killJobProcess(jobId);

  updateDownloadJob(jobId, {
    status: "cancelled",
    error: "Stopped by admin",
    progress: job.progress,
  });
  return { ok: true };
}

export function stopRequest(requestId: string): {
  ok: boolean;
  error?: string;
} {
  const req = getRequest(requestId);
  if (!req) return { ok: false, error: "Request not found" };
  if (
    req.status === "available" ||
    req.status === "cancelled" ||
    req.status === "failed"
  ) {
    return { ok: false, error: `Request already ${req.status}` };
  }

  if (req.downloadJobId) {
    const r = stopDownloadJob(req.downloadJobId);
    if (r.ok) return r;
  }

  updateRequestStatus(requestId, "cancelled", {
    message: "Stopped by admin",
    error: null,
  });
  return { ok: true };
}

function parseProgress(line: string): number | null {
  const m = line.match(/(\d{1,3}(?:\.\d+)?)%/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.min(99, n) : null;
}

export async function enqueueFallbackDownload(input: {
  query: string;
  title?: string;
  artist?: string;
  requestId?: string | null;
}) {
  const job = createDownloadJob({
    query: input.query,
    title: input.title || input.query,
    artist: input.artist || "Unknown Artist",
    requestId: input.requestId ?? null,
  });

  void processDownloadJob(job.id);
  return job;
}

export async function processDownloadJob(id: string) {
  const jobs = listDownloads(200);
  const job = jobs.find((j) => j.id === id);
  if (!job) return;
  if (isStopped(id) || job.status === "cancelled" || job.status === "failed") {
    return;
  }

  // Already past the wall clock — don't start
  const started = Date.parse(job.createdAt);
  if (Number.isFinite(started) && Date.now() - started >= DOWNLOAD_TIMEOUT_MS) {
    failDownloadTimedOut(id);
    return;
  }

  updateDownloadJob(id, { status: "running", progress: 1 });
  scheduleJobTimeout(id, job.createdAt);

  const ytDlp = await ensureYtDlp();
  if (isStopped(id)) return;
  if (!ytDlp) {
    clearTimeoutTimer(id);
    updateDownloadJob(id, {
      status: "failed",
      error:
        "yt-dlp could not be installed or found. Set POLARR_YTDLP_PATH or install yt-dlp.",
      progress: 0,
    });
    return;
  }

  const hasFfmpeg = await ffmpegAvailable();
  if (isStopped(id)) return;
  if (!hasFfmpeg) {
    clearTimeoutTimer(id);
    updateDownloadJob(id, {
      status: "failed",
      error:
        "ffmpeg is required for audio conversion. It ships in the Docker image; install ffmpeg locally for dev.",
      progress: 0,
    });
    return;
  }

  const outDir = path.join(
    downloadsDir(),
    job.artist.replace(/[<>:"/\\|?*]/g, "_"),
  );
  fs.mkdirSync(outDir, { recursive: true });
  const outTemplate = path.join(outDir, "%(artist)s - %(title)s.%(ext)s");

  try {
    const searchQuery = `ytsearch1:${job.query}`;
    const result = await run(
      id,
      ytDlp,
      [
        searchQuery,
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0",
        "--embed-metadata",
        "--embed-thumbnail",
        "-o",
        outTemplate,
        "--print",
        "after_move:filepath",
        "--no-playlist",
      ],
      (line) => {
        if (isStopped(id)) return;
        const p = parseProgress(line);
        if (p != null) updateDownloadJob(id, { progress: p });
      },
    );

    if (result.cancelled || isStopped(id)) {
      // stop / timeout already wrote terminal state
      stopFlags.delete(id);
      return;
    }

    if (result.code !== 0) {
      const linked = job.requestId ? getRequest(job.requestId) : null;
      updateDownloadJob(id, {
        status: "failed",
        error: friendlyDownloadError(
          result.stderr,
          result.code,
          linked?.mediaType,
        ),
        progress: 0,
      });
      return;
    }

    const lines = result.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const outputPath =
      lines.find((l) => fs.existsSync(l)) ||
      findNewestAudio(outDir) ||
      null;

    if (!outputPath) {
      const linked = job.requestId ? getRequest(job.requestId) : null;
      updateDownloadJob(id, {
        status: "failed",
        error:
          linked?.mediaType === "album" || linked?.mediaType === "artist"
            ? ALBUM_NOT_FOUND
            : TRACK_NOT_FOUND,
        progress: 0,
      });
      return;
    }

    const base = path.basename(outputPath, path.extname(outputPath));
    const [maybeArtist, maybeTitle] = base.includes(" - ")
      ? base.split(" - ").map((s) => s.trim())
      : [job.artist, job.title];

    const linked = job.requestId ? getRequest(job.requestId) : null;
    const albumName =
      (linked?.album && linked.album.trim()) || "Fallback Downloads";

    const st = fs.statSync(/*turbopackIgnore: true*/ outputPath);
    upsertTrack({
      id: randomBytes(12).toString("hex"),
      // Prefer request metadata so findTrack(artist, title) matches after acquire
      title: job.title || maybeTitle,
      artist: job.artist || maybeArtist,
      album: albumName,
      duration: 0,
      path: outputPath,
      coverPath: null,
      source: "fallback",
      externalId: null,
      fileSize: st.size,
      mtimeMs: st.mtimeMs,
    });

    const track = getTrackByPath(outputPath) as TrackRow | null;

    // Timeout may have won the race — don't complete a failed job
    const still = getDownload(id);
    if (!still || still.status === "failed" || still.status === "cancelled") {
      return track;
    }

    updateDownloadJob(id, {
      status: "completed",
      progress: 100,
      outputPath,
      error: null,
    });

    return track;
  } catch (err) {
    if (isStopped(id)) {
      stopFlags.delete(id);
      return;
    }
    const msg = err instanceof Error ? err.message : "Unknown download error";
    updateDownloadJob(id, {
      status: "failed",
      error: friendlyDownloadError(msg),
      progress: 0,
    });
  } finally {
    clearTimeoutTimer(id);
    stopFlags.delete(id);
  }
}

function findNewestAudio(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(mp3|flac|m4a|ogg|opus|wav)$/i.test(f))
    .map((f) => {
      const p = path.join(dir, f);
      return { p, mtime: fs.statSync(p).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.p ?? null;
}
