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
 */
export function ytDlpAvailable(): Promise<boolean> {
  return toolsYtDlpAvailable();
}

const activeProcs = new Map<string, ChildProcess>();
const stopFlags = new Set<string>();

function isStopped(jobId: string): boolean {
  return stopFlags.has(jobId);
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

  stopFlags.add(jobId);
  const child = activeProcs.get(jobId);
  if (child) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already exiting */
    }
    // Force on Windows if still alive shortly after
    setTimeout(() => {
      try {
        if (!child.killed) child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 800);
  }

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
  if (isStopped(id) || job.status === "cancelled") return;

  updateDownloadJob(id, { status: "running", progress: 1 });

  const ytDlp = await ensureYtDlp();
  if (isStopped(id)) return;
  if (!ytDlp) {
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
      // stopDownloadJob already wrote cancelled state
      stopFlags.delete(id);
      return;
    }

    if (result.code !== 0) {
      updateDownloadJob(id, {
        status: "failed",
        error: result.stderr.slice(-500) || "Download failed",
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
      updateDownloadJob(id, {
        status: "failed",
        error: "Download finished but output file was not found",
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
    updateDownloadJob(id, {
      status: "failed",
      error: err instanceof Error ? err.message : "Unknown download error",
      progress: 0,
    });
  } finally {
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
