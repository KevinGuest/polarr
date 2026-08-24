import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";

/** Keep in sync with Dockerfile ARG YT_DLP_VERSION. */
export const YT_DLP_VERSION = "2026.07.04";

let cachedYtDlp: string | null | undefined;
let ensurePromise: Promise<string | null> | null = null;

function binDir(): string {
  const dir = path.join(dataDir(), "bin");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ytDlpLocalName(): string {
  return process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
}

function releaseAssetName(): string | null {
  if (process.platform === "win32" && process.arch === "x64") {
    return "yt-dlp.exe";
  }
  if (process.platform === "linux") {
    if (process.arch === "x64") return "yt-dlp_linux";
    if (process.arch === "arm64") return "yt-dlp_linux_aarch64";
  }
  if (process.platform === "darwin") {
    // Single universal/macOS binary name used upstream for recent releases.
    return "yt-dlp_macos";
  }
  return null;
}

function candidatePaths(): string[] {
  const name = ytDlpLocalName();
  const env = process.env.POLARR_YTDLP_PATH?.trim();
  return [
    ...(env ? [env] : []),
    path.join(binDir(), name),
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
  ];
}

function probeCommand(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    // Always spawn an absolute path with shell:false — Node DEP0190 warns when
    // shell:true is combined with an args array (args are concatenated unescaped).
    const file = path.isAbsolute(cmd) ? cmd : whichSync(cmd);
    if (!file) {
      resolve(false);
      return;
    }
    const child = spawn(file, args, {
      stdio: "ignore",
      shell: false,
      env: process.env,
      windowsHide: true,
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

/** Resolve a command name on PATH to an absolute path (Windows-friendly). */
export function whichSync(cmd: string): string | null {
  const pathEnv = process.env.PATH || process.env.Path || "";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];
  const names =
    process.platform === "win32" && !path.extname(cmd)
      ? exts.map((ext) => cmd + ext)
      : [cmd];

  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const full = path.join(dir, name);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

async function pathWorks(filePath: string): Promise<boolean> {
  if (!fs.existsSync(filePath)) return false;
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
  } catch {
    try {
      fs.chmodSync(filePath, 0o755);
    } catch {
      /* windows or no-op */
    }
  }
  return probeCommand(filePath, ["--version"]);
}

/**
 * Locate a working yt-dlp: env path, data/bin, system installs, then PATH.
 * Always returns an absolute path when found so callers can spawn without shell.
 */
export async function findYtDlp(): Promise<string | null> {
  for (const c of candidatePaths()) {
    if (await pathWorks(c)) return path.resolve(c);
  }
  for (const name of ["yt-dlp", "yt-dlp.exe"]) {
    const resolved = whichSync(name);
    if (resolved && (await pathWorks(resolved))) return resolved;
  }
  return null;
}

async function downloadYtDlpBinary(): Promise<string | null> {
  const asset = releaseAssetName();
  if (!asset) return null;

  const dest = path.join(binDir(), ytDlpLocalName());
  const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/${asset}`;

  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "polarr" },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) return null;
    fs.writeFileSync(dest, buf, { mode: 0o755 });
    try {
      fs.chmodSync(dest, 0o755);
    } catch {
      /* windows */
    }
    if (await pathWorks(dest)) return dest;
  } catch {
    return null;
  }
  return null;
}

/**
 * Ensure yt-dlp is available (system path, image bin, or auto-download).
 * Safe to call often; caches a successful path.
 */
export async function ensureYtDlp(): Promise<string | null> {
  if (cachedYtDlp && path.isAbsolute(cachedYtDlp)) return cachedYtDlp;
  cachedYtDlp = undefined;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const found = await findYtDlp();
    if (found) {
      cachedYtDlp = found;
      return found;
    }
    const downloaded = await downloadYtDlpBinary();
    cachedYtDlp = downloaded ? path.resolve(downloaded) : null;
    return cachedYtDlp;
  })().finally(() => {
    ensurePromise = null;
  });

  return ensurePromise;
}

export async function ytDlpAvailable(): Promise<boolean> {
  return Boolean(await ensureYtDlp());
}

/** Absolute ffmpeg path for spawn({ shell: false }). Null if missing. */
export function resolveFfmpeg(): string | null {
  const env = process.env.POLARR_FFMPEG_PATH?.trim();
  if (env) {
    if (path.isAbsolute(env)) return fs.existsSync(env) ? env : null;
    return whichSync(env);
  }
  return whichSync("ffmpeg");
}

export async function ffmpegAvailable(): Promise<boolean> {
  const file = resolveFfmpeg();
  if (!file) return false;
  return pathWorks(file);
}
