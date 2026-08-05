/**
 * Live (no-download) stream resolution via yt-dlp URL dump.
 * Used when users play a track without queuing a library acquire.
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { ensureYtDlp } from "./tools";

type LiveEntry = {
  remoteUrl: string;
  title: string;
  artist: string;
  album: string;
  expiresAt: number;
};

const liveCache = new Map<string, LiveEntry>();
const LIVE_TTL_MS = 45 * 60 * 1000;

function cleanupLiveCache() {
  const now = Date.now();
  for (const [id, entry] of liveCache) {
    if (entry.expiresAt <= now) liveCache.delete(id);
  }
}

function runYtDlp(ytDlp: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlp, args, {
      shell: false,
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (buf: Buffer) => {
      stdout += buf.toString();
    });
    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Resolve a remote progressive/audio URL (may expire). */
export async function resolveLiveRemoteUrl(query: string): Promise<string | null> {
  const ytDlp = await ensureYtDlp();
  if (!ytDlp) return null;

  const searchQuery = `ytsearch1:${query.trim()}`;
  const result = await runYtDlp(ytDlp, [
    searchQuery,
    "-g",
    "-f",
    "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best",
    "--no-playlist",
    "--no-warnings",
  ]);

  if (result.code !== 0) return null;
  const url = result.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^https?:\/\//i.test(l));
  return url || null;
}

export function getLiveSession(id: string): LiveEntry | null {
  cleanupLiveCache();
  const entry = liveCache.get(id);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    liveCache.delete(id);
    return null;
  }
  return entry;
}

/** Create a short-lived live play session; returns id for /api/live/[id]. */
export async function createLiveSession(input: {
  artist: string;
  title: string;
  album?: string;
}): Promise<{ id: string; streamUrl: string } | null> {
  const query = `${input.artist} ${input.title}`.trim();
  if (!query) return null;

  const remoteUrl = await resolveLiveRemoteUrl(query);
  if (!remoteUrl) return null;

  const id = createHash("sha256")
    .update(`${query}:${randomBytes(6).toString("hex")}`)
    .digest("hex")
    .slice(0, 24);

  liveCache.set(id, {
    remoteUrl,
    title: input.title,
    artist: input.artist,
    album: input.album || input.title,
    expiresAt: Date.now() + LIVE_TTL_MS,
  });

  return {
    id: `live:${id}`,
    streamUrl: `/api/live/${id}`,
  };
}
