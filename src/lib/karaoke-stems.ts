/**
 * High-quality karaoke instrumentals via HT-Demucs (ONNX).
 * Works on library files and live/stream plays (download → separate → cache).
 * Cache: data/karaoke/{key}/instrumental.m4a
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { getTrack } from "./db";
import { createLiveSession, getLiveSession } from "./live-stream";
import { dataDir } from "./paths";
import { ensureYtDlp, ffmpegAvailable } from "./tools";
import { matchYtmAudio, YTM_AUDIO_FORMAT } from "./ytm-match";

export type KaraokeStatus =
  | "ready"
  | "processing"
  | "queued"
  | "unavailable"
  | "error"
  | "idle";

export type KaraokeInfo = {
  status: KaraokeStatus;
  streamUrl?: string;
  error?: string;
  progress?: number;
  quality: "demucs" | "none";
};

export type KaraokeRequestMeta = {
  artist?: string;
  title?: string;
  album?: string;
};

type JobState = {
  status: KaraokeStatus;
  error?: string;
  progress: number;
  /** Work-dir key for status + instrumental paths. */
  key: string;
  promise?: Promise<void>;
};

type ResolvedSource =
  | {
      kind: "file";
      key: string;
      filePath: string;
    }
  | {
      kind: "remote";
      key: string;
      /** Prefer direct download URL when live session is warm. */
      remoteUrl?: string;
      /** yt-dlp search when no warm URL. */
      searchQuery: string;
    };

const jobs = new Map<string, JobState>();
/** trackId / live id → stable cache key */
const idToKey = new Map<string, string>();
let chain: Promise<void> = Promise.resolve();

/**
 * Identifies this server process in status.json. A "processing"/"queued"
 * status written by a previous (dead) process must not block a re-queue —
 * without this, a crash mid-separation leaves the track stuck forever.
 */
const BOOT_ID = randomUUID();

function hasLiveJobForKey(key: string): boolean {
  for (const j of jobs.values()) {
    if (j.key === key) return true;
  }
  return false;
}

function requireFromApp() {
  return createRequire(path.join(process.cwd(), "package.json"));
}

function demucsCliPath(): string | null {
  try {
    const req = requireFromApp();
    const pkg = path.dirname(req.resolve("demucs/package.json"));
    const cli = path.join(pkg, "dist", "cli.js");
    if (fs.existsSync(cli)) return cli;
  } catch {
    /* not installed */
  }
  return null;
}

function findFfmpeg(): string {
  return process.env.POLARR_FFMPEG_PATH?.trim() || "ffmpeg";
}

function karaokeRoot(): string {
  const dir = path.join(dataDir(), "karaoke");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function hashKey(parts: string): string {
  return createHash("sha1").update(parts).digest("hex").slice(0, 24);
}

function libraryKey(trackId: string, filePath: string): string {
  const st = fs.statSync(filePath);
  return hashKey(
    `lib|${trackId}|${filePath}|${st.size}|${Math.floor(st.mtimeMs)}`,
  );
}

function liveKey(artist: string, title: string): string {
  return hashKey(
    `live|${artist.trim().toLowerCase()}|${title.trim().toLowerCase()}`,
  );
}

function trackWorkDir(key: string): string {
  const dir = path.join(karaokeRoot(), key);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function instrumentalPathForKey(key: string): string {
  return path.join(trackWorkDir(key), "instrumental.m4a");
}

function statusPathForKey(key: string): string {
  return path.join(trackWorkDir(key), "status.json");
}

function run(
  cmd: string,
  args: string[],
  onLine?: (line: string) => void,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: false,
      env: process.env,
      windowsHide: true,
      cwd: process.cwd(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (buf: Buffer) => {
      const text = buf.toString();
      stdout += text;
      text.split(/\r?\n/).forEach((l) => l && onLine?.(l));
    });
    child.stderr?.on("data", (buf: Buffer) => {
      const text = buf.toString();
      stderr += text;
      text.split(/\r?\n/).forEach((l) => l && onLine?.(l));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function parseDemucsProgress(line: string): number | null {
  const m = /^(\d+)\/(\d+)\s*$/.exec(line.trim());
  if (!m) return null;
  const step = Number(m[1]);
  const total = Number(m[2]);
  if (!total) return null;
  return Math.min(1, Math.max(0, step / total));
}

function writeStatus(key: string, job: JobState) {
  try {
    fs.writeFileSync(
      statusPathForKey(key),
      JSON.stringify({
        status: job.status,
        error: job.error,
        progress: job.progress,
        quality: job.status === "ready" ? "demucs" : "none",
        updatedAt: Date.now(),
        bootId: BOOT_ID,
      }),
    );
  } catch {
    /* ignore */
  }
}

function rememberKey(trackId: string, key: string) {
  idToKey.set(trackId, key);
  try {
    const p = path.join(karaokeRoot(), "aliases.json");
    let map: Record<string, string> = {};
    if (fs.existsSync(p)) {
      map = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, string>;
    }
    map[trackId] = key;
    fs.writeFileSync(p, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function lookupKey(trackId: string): string | null {
  if (idToKey.has(trackId)) return idToKey.get(trackId)!;
  try {
    const p = path.join(karaokeRoot(), "aliases.json");
    if (!fs.existsSync(p)) return null;
    const map = JSON.parse(fs.readFileSync(p, "utf8")) as Record<
      string,
      string
    >;
    if (map[trackId]) {
      idToKey.set(trackId, map[trackId]);
      return map[trackId];
    }
  } catch {
    /* ignore */
  }
  return null;
}

function isStreamPath(p: string | null | undefined): boolean {
  if (!p) return true;
  return (
    p.startsWith("stream:") ||
    p.startsWith("stream://") ||
    p.startsWith("live:")
  );
}

function normalizeLiveId(trackId: string): string {
  return trackId.startsWith("live:") ? trackId.slice(5) : trackId;
}

/**
 * Resolve a demucs input: local file, or remote (live/session / yt-dlp search).
 */
async function resolveSource(
  trackId: string,
  meta?: KaraokeRequestMeta,
): Promise<ResolvedSource | { error: string }> {
  const artist = (meta?.artist || "").trim();
  const title = (meta?.title || "").trim();

  // 1) Library track with a real file on disk
  const track = getTrack(trackId);
  if (track?.path && !isStreamPath(track.path) && fs.existsSync(track.path)) {
    const key = libraryKey(trackId, track.path);
    rememberKey(trackId, key);
    return { kind: "file", key, filePath: track.path };
  }

  // 2) Active live session (warm remote URL)
  if (trackId.startsWith("live:") || getLiveSession(normalizeLiveId(trackId))) {
    const sid = normalizeLiveId(trackId);
    const session = getLiveSession(sid);
    if (session) {
      const a = session.artist || artist;
      const t = session.title || title;
      if (a && t) {
        const key = liveKey(a, t);
        rememberKey(trackId, key);
        return {
          kind: "remote",
          key,
          remoteUrl: session.remoteUrl,
          searchQuery: `${a} ${t}`.trim(),
        };
      }
    }
  }

  // 3) Metadata fallthrough: live id expired, catalog, or stream stub
  const a =
    artist ||
    track?.artist ||
    (trackId.startsWith("stream:")
      ? decodeURIComponent(trackId.slice(7).split("|")[0] || "")
      : "");
  const t =
    title ||
    track?.title ||
    (trackId.startsWith("stream:")
      ? decodeURIComponent(trackId.slice(7).split("|")[1] || "")
      : "");

  if (!a || !t) {
    return {
      error:
        "Need artist + title to prepare karaoke for a stream. Play the track first, then try again.",
    };
  }

  const key = liveKey(a, t);
  rememberKey(trackId, key);

  // Prefer a fresh live remote so we reuse the same CDN URL when possible
  const live = await createLiveSession({
    artist: a,
    title: t,
    album: meta?.album || track?.album,
  });
  if (live) {
    const sid = live.id.startsWith("live:") ? live.id.slice(5) : live.id;
    const session = getLiveSession(sid);
    if (session?.remoteUrl) {
      rememberKey(live.id, key);
      return {
        kind: "remote",
        key,
        remoteUrl: session.remoteUrl,
        searchQuery: `${a} ${t}`.trim(),
      };
    }
  }

  return {
    kind: "remote",
    key,
    searchQuery: `${a} ${t}`.trim(),
  };
}

/** Download remote/live audio into workDir/source.* then return wav path. */
async function acquireRemoteWav(
  source: Extract<ResolvedSource, { kind: "remote" }>,
  work: string,
  job: JobState,
): Promise<string | null> {
  const ytDlp = await ensureYtDlp();
  const ff = findFfmpeg();
  const rawOut = path.join(work, "source_dl.%(ext)s");
  const rawPattern = path.join(work, "source_dl.");

  job.progress = 0.04;
  writeStatus(source.key, job);

  if (ytDlp) {
    // Prefer exact remote (live session), else ranked YTM match
    let sourceArg = source.remoteUrl;
    if (!sourceArg) {
      const parts = source.searchQuery.trim().split(/\s+/);
      const artistHint = parts.length > 1 ? parts[0]! : "";
      const titleHint =
        parts.length > 1 ? parts.slice(1).join(" ") : source.searchQuery;
      const match = await matchYtmAudio({
        artist: artistHint,
        title: titleHint,
        query: source.searchQuery,
      });
      sourceArg =
        match?.url ||
        `ytsearch1:${source.searchQuery.trim()} official audio`;
    }
    const args = [
      sourceArg,
      "-f",
      YTM_AUDIO_FORMAT,
      "-o",
      rawOut,
      "--no-playlist",
      "--no-warnings",
    ];

    const dl = await run(ytDlp, args);
    if (dl.code !== 0) {
      job.error = `Could not download audio for separation.\n${dl.stderr.slice(-400)}`;
      return null;
    }
  } else if (source.remoteUrl && (await ffmpegAvailable())) {
    // Fallback: ffmpeg only (works for some progressive URLs)
    const tmp = path.join(work, "source_dl.bin");
    const dl = await run(ff, ["-y", "-i", source.remoteUrl, "-c", "copy", tmp]);
    if (dl.code !== 0 || !fs.existsSync(tmp)) {
      job.error = "Could not download stream (yt-dlp/ffmpeg unavailable).";
      return null;
    }
  } else {
    job.error = "yt-dlp is required to prepare karaoke from live streams.";
    return null;
  }

  const found = fs
    .readdirSync(work)
    .filter((n) => n.startsWith("source_dl."))
    .map((n) => path.join(work, n))
    .find((p) => fs.existsSync(p) && fs.statSync(p).size > 1024);

  if (!found) {
    // ffmpeg fallback path name
    const bin = path.join(work, "source_dl.bin");
    if (fs.existsSync(bin) && fs.statSync(bin).size > 1024) {
      // continue with bin
    } else {
      job.error = "Download finished but no audio file was written.";
      return null;
    }
  }

  const input = found || path.join(work, "source_dl.bin");
  const wavIn = path.join(work, "input.wav");
  job.progress = 0.08;
  writeStatus(source.key, job);

  const dec = await run(ff, [
    "-y",
    "-i",
    input,
    "-ar",
    "44100",
    "-ac",
    "2",
    "-c:a",
    "pcm_s16le",
    wavIn,
  ]);
  if (dec.code !== 0 || !fs.existsSync(wavIn)) {
    job.error = `Failed to decode stream audio.\n${dec.stderr.slice(-400)}`;
    return null;
  }

  // Drop downloaded container (save space)
  try {
    fs.unlinkSync(input);
  } catch {
    /* ignore */
  }

  void rawPattern;
  return wavIn;
}

async function renderInstrumental(
  trackId: string,
  source: ResolvedSource,
  job: JobState,
): Promise<void> {
  const cli = demucsCliPath();
  if (!cli) {
    job.status = "unavailable";
    job.error =
      "HT-Demucs is not installed. Run npm install demucs and restart Polarr.";
    return;
  }
  if (!(await ffmpegAvailable())) {
    job.status = "unavailable";
    job.error = "ffmpeg is required to prepare high-quality instrumentals.";
    return;
  }

  const key = source.key;
  const work = trackWorkDir(key);
  const outInst = instrumentalPathForKey(key);
  if (fs.existsSync(outInst) && fs.statSync(outInst).size > 1024) {
    job.status = "ready";
    job.progress = 1;
    rememberKey(trackId, key);
    writeStatus(key, job);
    return;
  }

  job.status = "processing";
  job.progress = 0.02;
  writeStatus(key, job);

  let wavIn: string;
  if (source.kind === "file") {
    wavIn = path.join(work, "input.wav");
    const ff = findFfmpeg();
    job.progress = 0.05;
    const dec = await run(ff, [
      "-y",
      "-i",
      source.filePath,
      "-ar",
      "44100",
      "-ac",
      "2",
      "-c:a",
      "pcm_s16le",
      wavIn,
    ]);
    if (dec.code !== 0 || !fs.existsSync(wavIn)) {
      job.status = "error";
      job.error = `Failed to decode audio for separation.\n${dec.stderr.slice(-400)}`;
      writeStatus(key, job);
      return;
    }
  } else {
    const acquired = await acquireRemoteWav(source, work, job);
    if (!acquired) {
      job.status = "error";
      writeStatus(key, job);
      return;
    }
    wavIn = acquired;
  }

  job.progress = 0.1;
  writeStatus(key, job);

  const sepDir = path.join(work, "separated");
  fs.mkdirSync(sepDir, { recursive: true });
  const node = process.execPath;
  const sep = await run(
    node,
    [cli, wavIn, "--mp3", "--output", sepDir, "--overlap", "0.25"],
    (line) => {
      const p = parseDemucsProgress(line);
      if (p != null) {
        job.progress = 0.1 + p * 0.8;
        writeStatus(key, job);
      }
    },
  );

  if (sep.code !== 0) {
    job.status = "error";
    job.error = `Stem separation failed.\n${(sep.stderr || sep.stdout).slice(-500)}`;
    writeStatus(key, job);
    return;
  }

  const base = path.basename(wavIn, path.extname(wavIn));
  const stemDir = path.join(sepDir, base);
  const drums = path.join(stemDir, "drums.mp3");
  const bass = path.join(stemDir, "bass.mp3");
  const other = path.join(stemDir, "other.mp3");
  for (const p of [drums, bass, other]) {
    if (!fs.existsSync(p)) {
      job.status = "error";
      job.error = `Separation finished but stem missing: ${path.basename(p)}`;
      writeStatus(key, job);
      return;
    }
  }

  job.progress = 0.92;
  writeStatus(key, job);

  const ff = findFfmpeg();
  const mix = await run(ff, [
    "-y",
    "-i",
    drums,
    "-i",
    bass,
    "-i",
    other,
    "-filter_complex",
    "[0:a][1:a][2:a]amix=inputs=3:duration=longest:dropout_transition=0:normalize=0",
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    "-movflags",
    "+faststart",
    outInst,
  ]);

  if (mix.code !== 0 || !fs.existsSync(outInst)) {
    job.status = "error";
    job.error = `Failed to mix instrumental stems.\n${mix.stderr.slice(-400)}`;
    writeStatus(key, job);
    return;
  }

  try {
    fs.rmSync(sepDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(wavIn);
  } catch {
    /* ignore */
  }

  job.status = "ready";
  job.progress = 1;
  rememberKey(trackId, key);
  writeStatus(key, job);
}

function infoFromKey(
  trackId: string,
  key: string,
  job?: JobState,
): KaraokeInfo | null {
  const inst = instrumentalPathForKey(key);
  if (fs.existsSync(inst) && fs.statSync(inst).size > 1024) {
    return {
      status: "ready",
      quality: "demucs",
      streamUrl: `/api/karaoke/${encodeURIComponent(trackId)}/stream`,
      progress: 1,
    };
  }
  if (job) {
    return {
      status: job.status,
      quality: "none",
      error: job.error,
      progress: job.progress,
      streamUrl:
        job.status === "ready"
          ? `/api/karaoke/${encodeURIComponent(trackId)}/stream`
          : undefined,
    };
  }
  try {
    const raw = fs.readFileSync(statusPathForKey(key), "utf8");
    const parsed = JSON.parse(raw) as {
      status?: KaraokeStatus;
      error?: string;
      progress?: number;
      bootId?: string;
    };
    if (parsed.status === "ready" && fs.existsSync(inst)) {
      return {
        status: "ready",
        quality: "demucs",
        streamUrl: `/api/karaoke/${encodeURIComponent(trackId)}/stream`,
        progress: 1,
      };
    }
    if (parsed.status === "processing" || parsed.status === "queued") {
      // Only trust in-flight statuses backed by a job in this process.
      // Otherwise it is a leftover from a dead server — report null so the
      // caller falls through to idle and can re-queue separation.
      if (parsed.bootId === BOOT_ID && hasLiveJobForKey(key)) {
        return {
          status: parsed.status,
          quality: "none",
          error: parsed.error,
          progress: parsed.progress ?? 0,
        };
      }
      return null;
    }
    if (parsed.status === "error") {
      return {
        status: "error",
        quality: "none",
        error: parsed.error,
        progress: parsed.progress ?? 0,
      };
    }
  } catch {
    /* none */
  }
  return null;
}

export function getKaraokeInfo(
  trackId: string,
  meta?: KaraokeRequestMeta,
): KaraokeInfo {
  if (!demucsCliPath()) {
    return {
      status: "unavailable",
      quality: "none",
      error:
        "HT-Demucs is not installed. Run npm install demucs and restart Polarr.",
    };
  }

  const mem = jobs.get(trackId);
  if (mem) {
    const fromJob = infoFromKey(trackId, mem.key, mem);
    if (fromJob) return fromJob;
  }

  const known = lookupKey(trackId);
  if (known) {
    const hit = infoFromKey(trackId, known);
    if (hit) return hit;
  }

  // Stable live key preview when we already have artist/title
  if (meta?.artist && meta?.title) {
    const key = liveKey(meta.artist, meta.title);
    const hit = infoFromKey(trackId, key);
    if (hit) return hit;
  }

  // Library file ready without prior alias
  const track = getTrack(trackId);
  if (track?.path && !isStreamPath(track.path) && fs.existsSync(track.path)) {
    const key = libraryKey(trackId, track.path);
    const hit = infoFromKey(trackId, key);
    if (hit) return hit;
  }

  return { status: "idle", quality: "none", progress: 0 };
}

export function getInstrumentalFile(trackId: string): string | null {
  const keys = [
    lookupKey(trackId),
    jobs.get(trackId)?.key,
  ].filter(Boolean) as string[];

  const track = getTrack(trackId);
  if (track?.path && !isStreamPath(track.path) && fs.existsSync(track.path)) {
    keys.push(libraryKey(trackId, track.path));
  }

  for (const key of keys) {
    const inst = instrumentalPathForKey(key);
    if (fs.existsSync(inst) && fs.statSync(inst).size > 1024) return inst;
  }
  return null;
}

/**
 * Ensure instrumental exists (queues Demucs for library or live/stream).
 */
export function ensureKaraokeInstrumental(
  trackId: string,
  meta?: KaraokeRequestMeta,
): KaraokeInfo {
  const info = getKaraokeInfo(trackId, meta);
  if (info.status === "ready" || info.status === "unavailable") return info;
  if (info.status === "processing" || info.status === "queued") return info;

  if (!demucsCliPath()) {
    return {
      status: "unavailable",
      quality: "none",
      error:
        "HT-Demucs is not installed. Run npm install demucs and restart Polarr.",
    };
  }

  const existing = jobs.get(trackId);
  if (existing?.promise) {
    return {
      status: existing.status,
      quality: "none",
      progress: existing.progress,
      error: existing.error,
    };
  }

  // Placeholder until resolveSource fills in key
  const job: JobState = {
    status: "queued",
    progress: 0,
    key: lookupKey(trackId) || hashKey(trackId),
  };
  jobs.set(trackId, job);

  job.promise = chain = chain
    .then(async () => {
      job.status = "processing";
      const source = await resolveSource(trackId, meta);
      if ("error" in source) {
        job.status = "unavailable";
        job.error = source.error;
        return;
      }
      job.key = source.key;
      rememberKey(trackId, source.key);
      writeStatus(source.key, job);
      await renderInstrumental(trackId, source, job);
    })
    .catch((err) => {
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
      try {
        writeStatus(job.key, job);
      } catch {
        /* ignore */
      }
    })
    .finally(() => {
      setTimeout(() => {
        if (jobs.get(trackId) === job) jobs.delete(trackId);
      }, 60_000);
    });

  return {
    status: "queued",
    quality: "none",
    progress: 0,
  };
}
