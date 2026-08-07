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
  queryKey: string;
};

const liveCache = new Map<string, LiveEntry>();
/** artist|title → session id — reuse within TTL (skip next / replay). */
const queryIndex = new Map<string, string>();
const LIVE_TTL_MS = 45 * 60 * 1000;
const inFlight = new Map<string, Promise<{ id: string; streamUrl: string } | null>>();

function liveQueryKey(artist: string, title: string): string {
  return `${artist.trim().toLowerCase()}|${title.trim().toLowerCase()}`;
}

function cleanupLiveCache() {
  const now = Date.now();
  for (const [id, entry] of liveCache) {
    if (entry.expiresAt <= now) {
      liveCache.delete(id);
      if (queryIndex.get(entry.queryKey) === id) queryIndex.delete(entry.queryKey);
    }
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
    if (queryIndex.get(entry.queryKey) === id) queryIndex.delete(entry.queryKey);
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

  cleanupLiveCache();
  const qKey = liveQueryKey(input.artist, input.title);

  const existingId = queryIndex.get(qKey);
  if (existingId) {
    const entry = liveCache.get(existingId);
    if (entry && entry.expiresAt > Date.now()) {
      return {
        id: `live:${existingId}`,
        streamUrl: `/api/live/${existingId}`,
      };
    }
  }

  const pending = inFlight.get(qKey);
  if (pending) return pending;

  const work = (async () => {
    const remoteUrl = await resolveLiveRemoteUrl(query);
    if (!remoteUrl) return null;

    const id = createHash("sha256")
      .update(`${qKey}:${randomBytes(6).toString("hex")}`)
      .digest("hex")
      .slice(0, 24);

    const expiresAt = Date.now() + LIVE_TTL_MS;
    liveCache.set(id, {
      remoteUrl,
      title: input.title,
      artist: input.artist,
      album: input.album || input.title,
      expiresAt,
      queryKey: qKey,
    });
    queryIndex.set(qKey, id);

    return {
      id: `live:${id}`,
      streamUrl: `/api/live/${id}`,
    };
  })().finally(() => {
    inFlight.delete(qKey);
  });

  inFlight.set(qKey, work);
  return work;
}
