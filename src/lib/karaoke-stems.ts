/**
 * High-quality karaoke instrumentals via HT-Demucs (ONNX).
 * Library / Lidarr / downloaded files only — streamed YouTube audio is not
 * a stable demucs source (wrong file, drift vs the live mix).
 * Cache: data/karaoke/{key}/instrumental.m4a
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { findTrack, getTrack, type TrackRow } from "./db";
import { dataDir, musicDir } from "./paths";
import { resolveFfmpeg } from "./tools";

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

type ResolvedSource = {
  kind: "file";
  key: string;
  filePath: string;
  libraryId: string;
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
    const onnx = path.join(pkg, "htdemucs.onnx");
    if (fs.existsSync(cli) && fs.existsSync(onnx)) return cli;
  } catch {
    /* not installed */
  }
  return null;
}

function findFfmpeg(): string | null {
  return resolveFfmpeg();
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

function trackWorkDir(key: string): string {
  const dir = path.join(karaokeRoot(), key);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function instrumentalPathForKey(key: string): string {
  return path.join(trackWorkDir(key), "instrumental.m4a");
}

function karaokeStreamUrl(
  trackId: string,
  meta?: KaraokeRequestMeta,
): string {
  const u = `/api/karaoke/${encodeURIComponent(trackId)}/stream`;
  const qs = new URLSearchParams();
  if (meta?.artist?.trim()) qs.set("artist", meta.artist.trim());
  if (meta?.title?.trim()) qs.set("title", meta.title.trim());
  if (meta?.album?.trim()) qs.set("album", meta.album.trim());
  const q = qs.toString();
  return q ? `${u}?${q}` : u;
}

export function vocalsPathForKey(key: string): string {
  return path.join(trackWorkDir(key), "vocals.mp3");
}

function statusPathForKey(key: string): string {
  return path.join(trackWorkDir(key), "status.json");
}

function run(
  cmd: string,
  args: string[],
  onLine?: (line: string) => void,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: { code: number; stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(cmd, args, {
      shell: false,
      env: process.env,
      windowsHide: true,
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
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
    child.on("error", (err) => {
      done({
        code: 1,
        stdout,
        stderr: err instanceof Error ? err.message : String(err),
      });
    });
    child.on("close", (code) => {
      done({ code: code ?? 1, stdout, stderr });
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

function fileOnDisk(track: TrackRow | null | undefined): string | null {
  const raw = track?.path?.trim() || "";
  if (!raw || isStreamPath(raw)) return null;
  const tries = [raw, path.resolve(raw)];
  if (raw.startsWith("/music")) {
    tries.push(
      path.join(musicDir(), raw.slice("/music".length).replace(/^[\\/]+/, "")),
    );
  }
  const seen = new Set<string>();
  for (const p of tries) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.size >= 1024) return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

function artistTitleFromRequest(
  trackId: string,
  meta?: KaraokeRequestMeta,
  track?: TrackRow | null,
): { artist: string; title: string } {
  let artist = (meta?.artist || track?.artist || "").trim();
  let title = (meta?.title || track?.title || "").trim();
  if ((!artist || !title) && trackId.startsWith("stream:")) {
    const [a, t] = trackId.slice(7).split("|");
    if (!artist) {
      try {
        artist = decodeURIComponent(a || "").trim();
      } catch {
        artist = (a || "").trim();
      }
    }
    if (!title) {
      try {
        title = decodeURIComponent(t || "").trim();
      } catch {
        title = (t || "").trim();
      }
    }
  }
  return { artist, title };
}

/**
 * Library / Lidarr / fallback-download row with a real audio file.
 * Stream and live ids can still resolve when the same song is on disk.
 */
export function resolveKaraokeLibraryTrack(
  trackId: string,
  meta?: KaraokeRequestMeta,
): TrackRow | null {
  const id = (trackId || "").trim();
  const byId = id ? getTrack(id) : null;
  if (fileOnDisk(byId)) return byId;

  const { artist, title } = artistTitleFromRequest(id, meta, byId);
  if (!artist || !title) return null;
  const hit = findTrack(artist, title);
  return fileOnDisk(hit) ? hit : null;
}

const NO_LIBRARY_FILE =
  "Karaoke is only available for tracks saved on this server.";

/**
 * Demucs input: on-disk library file only (never yt-dlp / live CDN).
 */
function resolveSource(
  trackId: string,
  meta?: KaraokeRequestMeta,
): ResolvedSource | { error: string } {
  const track = resolveKaraokeLibraryTrack(trackId, meta);
  const filePath = fileOnDisk(track);
  if (!track || !filePath) {
    return { error: NO_LIBRARY_FILE };
  }
  const key = libraryKey(track.id, filePath);
  rememberKey(trackId, key);
  rememberKey(track.id, key);
  return { kind: "file", key, filePath, libraryId: track.id };
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
  const ffDecode = findFfmpeg();
  if (!ffDecode) {
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

  const wavIn = path.join(work, "input.wav");
  job.progress = 0.05;
  const decodeArgs = (map: string[]) => [
    "-nostdin",
    "-hide_banner",
    "-y",
    "-i",
    source.filePath,
    ...map,
    "-ar",
    "44100",
    "-ac",
    "2",
    "-c:a",
    "pcm_s16le",
    wavIn,
  ];
  let dec = await run(ffDecode, decodeArgs(["-vn", "-map", "0:a:0"]));
  if (dec.code !== 0 || !fs.existsSync(wavIn)) {
    try {
      if (fs.existsSync(wavIn)) fs.unlinkSync(wavIn);
    } catch {
      /* retry */
    }
    dec = await run(ffDecode, decodeArgs(["-vn"]));
  }
  if (dec.code !== 0 || !fs.existsSync(wavIn)) {
    const msg = dec.stderr || "";
    if (/ENOENT|not found|cannot find the file/i.test(msg)) {
      job.status = "unavailable";
      job.error = "ffmpeg is required to prepare high-quality instrumentals.";
    } else {
      job.status = "error";
      job.error = `Failed to decode audio for separation.\n${msg.slice(-400)}`;
    }
    writeStatus(key, job);
    return;
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
  const vocalsSrc = path.join(stemDir, "vocals.mp3");
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
  if (!ff) {
    job.status = "unavailable";
    job.error = "ffmpeg is required to prepare high-quality instrumentals.";
    writeStatus(key, job);
    return;
  }
  const mix = await run(ff, [
    "-nostdin",
    "-hide_banner",
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

  // Keep vocals for the local lyrics aligner (envelope DTW)
  if (fs.existsSync(vocalsSrc) && fs.statSync(vocalsSrc).size > 1024) {
    try {
      fs.copyFileSync(vocalsSrc, vocalsPathForKey(key));
    } catch {
      /* aligner will fall back to the mix */
    }
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
  meta?: KaraokeRequestMeta,
): KaraokeInfo | null {
  const inst = instrumentalPathForKey(key);
  const instReady =
    fs.existsSync(inst) && fs.statSync(inst).size > 1024;
  if (instReady) {
    return {
      status: "ready",
      quality: "demucs",
      streamUrl: karaokeStreamUrl(trackId, meta),
      progress: 1,
    };
  }
  if (job && job.status !== "ready") {
    return {
      status: job.status,
      quality: "none",
      error: job.error,
      progress: job.progress,
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
    if (parsed.status === "ready" && fs.existsSync(inst) && fs.statSync(inst).size > 1024) {
      return {
        status: "ready",
        quality: "demucs",
        streamUrl: karaokeStreamUrl(trackId, meta),
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
  if (!findFfmpeg()) {
    return {
      status: "unavailable",
      quality: "none",
      error: "ffmpeg is required to prepare high-quality instrumentals.",
    };
  }

  const mem = jobs.get(trackId);
  if (mem) {
    const fromJob = infoFromKey(trackId, mem.key, mem, meta);
    if (fromJob) return fromJob;
  }

  const known = lookupKey(trackId);
  if (known) {
    const hit = infoFromKey(trackId, known, undefined, meta);
    if (hit) return hit;
  }

  const track = resolveKaraokeLibraryTrack(trackId, meta);
  if (track && track.id !== trackId) {
    const byLib = jobs.get(track.id);
    if (byLib) {
      const fromJob = infoFromKey(trackId, byLib.key, byLib, meta);
      if (fromJob) return fromJob;
    }
    const libAlias = lookupKey(track.id);
    if (libAlias) {
      const hit = infoFromKey(trackId, libAlias, undefined, meta);
      if (hit) return hit;
    }
  }
  const filePath = fileOnDisk(track);
  if (track && filePath) {
    const key = libraryKey(track.id, filePath);
    const hit = infoFromKey(trackId, key, undefined, meta);
    if (hit) return hit;
  }

  return { status: "idle", quality: "none", progress: 0 };
}

function karaokeKeysForTrack(
  trackId: string,
  meta?: KaraokeRequestMeta,
): string[] {
  const keys: string[] = [];
  const add = (k: string | null | undefined) => {
    if (k && !keys.includes(k)) keys.push(k);
  };
  add(lookupKey(trackId));
  add(jobs.get(trackId)?.key);

  const track = resolveKaraokeLibraryTrack(trackId, meta);
  if (track) {
    add(lookupKey(track.id));
    add(jobs.get(track.id)?.key);
    const filePath = fileOnDisk(track);
    if (filePath) add(libraryKey(track.id, filePath));
  }
  return keys;
}

export function getInstrumentalFile(
  trackId: string,
  meta?: KaraokeRequestMeta,
): string | null {
  for (const key of karaokeKeysForTrack(trackId, meta)) {
    const inst = instrumentalPathForKey(key);
    if (fs.existsSync(inst) && fs.statSync(inst).size > 1024) return inst;
  }
  return null;
}

/** Isolated vocal stem when karaoke Demucs has already run for this track. */
export function getVocalsFile(
  trackId: string,
  meta?: KaraokeRequestMeta,
): string | null {
  for (const key of karaokeKeysForTrack(trackId, meta)) {
    const vocals = vocalsPathForKey(key);
    if (fs.existsSync(vocals) && fs.statSync(vocals).size > 1024) return vocals;
  }
  return null;
}

/**
 * Ensure instrumental exists (queues Demucs for an on-disk library file).
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

  const source = resolveSource(trackId, meta);
  if ("error" in source) {
    return {
      status: "unavailable",
      quality: "none",
      error: source.error,
    };
  }

  const existing = jobs.get(trackId) || jobs.get(source.libraryId);
  if (existing?.promise) {
    return {
      status: existing.status,
      quality: "none",
      progress: existing.progress,
      error: existing.error,
    };
  }

  const job: JobState = {
    status: "queued",
    progress: 0,
    key: source.key,
  };
  jobs.set(trackId, job);
  jobs.set(source.libraryId, job);
  rememberKey(trackId, source.key);
  rememberKey(source.libraryId, source.key);

  job.promise = chain = chain
    .then(async () => {
      job.status = "processing";
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
        if (jobs.get(source.libraryId) === job) jobs.delete(source.libraryId);
      }, 60_000);
    });

  return {
    status: "queued",
    quality: "none",
    progress: 0,
  };
}
