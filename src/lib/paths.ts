import path from "node:path";
import fs from "node:fs";

function canWriteDir(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function tryEnsureWritableDir(dir: string): string | null {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return null;
  }
  return canWriteDir(dir) ? dir : null;
}

/** Data dir must be writable — SQLite lives here. */
function ensureWritableDir(dir: string, label: string): string {
  const ok = tryEnsureWritableDir(dir);
  if (ok) return ok;
  throw new Error(
    `${label} (${dir}) is not writable. ` +
      `On Docker: sudo chown -R 1000:1000 <host-data-dir>`,
  );
}

export function dataDir(): string {
  const dir = process.env.POLARR_DATA_DIR || path.join(process.cwd(), "data");
  return ensureWritableDir(dir, "POLARR_DATA_DIR");
}

/**
 * Library root. Lidarr’s complete folder is often read-only to Polarr —
 * still usable for scan/stream if it exists.
 */
export function musicDir(): string {
  const dir = process.env.POLARR_MUSIC_DIR || path.join(process.cwd(), "music");
  const writable = tryEnsureWritableDir(dir);
  if (writable) return writable;
  try {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
  } catch {
    /* fall through */
  }
  return dataDir();
}

/**
 * Fallback downloads. Never crash play because Lidarr’s music mount isn’t ours.
 * Prefer POLARR_DOWNLOADS_DIR, then {music}/downloads, then {data}/downloads.
 */
export function downloadsDir(): string {
  const preferred = (process.env.POLARR_DOWNLOADS_DIR || "").trim();
  if (preferred) {
    const ok = tryEnsureWritableDir(preferred);
    if (ok) return ok;
  }
  const underMusic = path.join(
    process.env.POLARR_MUSIC_DIR || path.join(process.cwd(), "music"),
    "downloads",
  );
  const musicDl = tryEnsureWritableDir(underMusic);
  if (musicDl) return musicDl;
  return ensureWritableDir(
    path.join(dataDir(), "downloads"),
    "POLARR_DOWNLOADS_DIR",
  );
}

/** True when filePath resolves under a Polarr-managed music root. */
export function isManagedMusicPath(
  filePath: string,
  extraRoots: string[] = [],
): boolean {
  const abs = path.resolve(filePath);
  const roots = Array.from(
    new Set(
      [musicDir(), downloadsDir(), ...extraRoots]
        .filter(Boolean)
        .map((r) => path.resolve(r)),
    ),
  );
  return roots.some((root) => abs === root || abs.startsWith(root + path.sep));
}

/**
 * Hard-delete an audio file from disk when it lives under a managed music root.
 * Returns true if the file was removed (or already gone after a safe path check).
 */
export function unlinkManagedAudioFile(
  filePath: string | null | undefined,
  extraRoots: string[] = [],
): boolean {
  if (!filePath?.trim()) return false;
  if (!isManagedMusicPath(filePath, extraRoots)) return false;
  const abs = path.resolve(filePath);
  try {
    if (!fs.existsSync(abs)) return true;
    fs.unlinkSync(abs);
    return true;
  } catch {
    return false;
  }
}

export function dbPath(): string {
  return path.join(dataDir(), "polarr.db");
}

export function avatarsDir(): string {
  const dir = path.join(dataDir(), "avatars");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** User-uploaded playlist cover images (`{playlistId}.ext`). */
export function playlistCoversDir(): string {
  const dir = path.join(dataDir(), "playlist-covers");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
