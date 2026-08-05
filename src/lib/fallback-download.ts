import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  createDownloadJob,
  getTrackByPath,
  listDownloads,
  updateDownloadJob,
  upsertTrack,
  type TrackRow,
} from "./db";
import { downloadsDir } from "./paths";

/**
 * Fallback acquisition pipeline (Downtify-inspired):
 * free-text / metadata search → yt-dlp audio extract → local library.
 * Uses system `yt-dlp` + `ffmpeg` when available.
 */
export function ytDlpAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("yt-dlp", ["--version"], {
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

function run(
  cmd: string,
  args: string[],
  onLine?: (line: string) => void,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: process.platform === "win32",
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (buf: Buffer) => {
      const text = buf.toString();
      stdout += text;
      text.split(/\r?\n/).forEach((line) => line && onLine?.(line));
    });
    child.stderr?.on("data", (buf: Buffer) => {
      const text = buf.toString();
      stderr += text;
      text.split(/\r?\n/).forEach((line) => line && onLine?.(line));
    });
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ code: code ?? 1, stdout, stderr }),
    );
  });
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

  // Fire-and-forget worker for local/dev environments
  void processDownloadJob(job.id);
  return job;
}

export async function processDownloadJob(id: string) {
  const jobs = listDownloads(200);
  const job = jobs.find((j) => j.id === id);
  if (!job) return;

  updateDownloadJob(id, { status: "running", progress: 1 });

  const available = await ytDlpAvailable();
  if (!available) {
    updateDownloadJob(id, {
      status: "failed",
      error:
        "yt-dlp is not installed. Install yt-dlp and ffmpeg for fallback downloads.",
      progress: 0,
    });
    return;
  }

  const outDir = path.join(downloadsDir(), job.artist.replace(/[<>:"/\\|?*]/g, "_"));
  fs.mkdirSync(outDir, { recursive: true });
  const outTemplate = path.join(outDir, "%(artist)s - %(title)s.%(ext)s");

  try {
    const searchQuery = `ytsearch1:${job.query}`;
    const result = await run(
      "yt-dlp",
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
        const p = parseProgress(line);
        if (p != null) updateDownloadJob(id, { progress: p });
      },
    );

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

    const st = fs.statSync(/*turbopackIgnore: true*/ outputPath);
    upsertTrack({
      id: randomBytes(12).toString("hex"),
      title: maybeTitle || job.title,
      artist: maybeArtist || job.artist,
      album: "Fallback Downloads",
      duration: 0,
      path: outputPath,
      coverPath: null,
      source: "fallback",
      externalId: null,
      fileSize: st.size,
      mtimeMs: st.mtimeMs,
    });

    // Ensure track is immediately streamable; request status flips in updateDownloadJob.
    const track = getTrackByPath(outputPath) as TrackRow | null;

    updateDownloadJob(id, {
      status: "completed",
      progress: 100,
      outputPath,
      error: null,
    });

    return track;
  } catch (err) {
    updateDownloadJob(id, {
      status: "failed",
      error: err instanceof Error ? err.message : "Unknown download error",
      progress: 0,
    });
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
