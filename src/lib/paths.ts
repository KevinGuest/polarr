import path from "node:path";
import fs from "node:fs";

/** Ensure dir exists and is writable; throw a clear error for Docker bind mounts. */
function ensureWritableDir(dir: string, label: string): string {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${label} (${dir}) could not be created: ${msg}. ` +
        `On Docker bind mounts, fix ownership: chown -R 1000:1000 <host-data-dir>`,
    );
  }
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    throw new Error(
      `${label} (${dir}) is not writable. ` +
        `On Docker: sudo chown -R 1000:1000 <host-data-dir> ` +
        `(or rebuild with the entrypoint that chowns /data on start).`,
    );
  }
  return dir;
}

export function dataDir(): string {
  const dir = process.env.POLARR_DATA_DIR || path.join(process.cwd(), "data");
  return ensureWritableDir(dir, "POLARR_DATA_DIR");
}

export function musicDir(): string {
  const dir = process.env.POLARR_MUSIC_DIR || path.join(process.cwd(), "music");
  return ensureWritableDir(dir, "POLARR_MUSIC_DIR");
}

export function downloadsDir(): string {
  const dir =
    process.env.POLARR_DOWNLOADS_DIR || path.join(musicDir(), "downloads");
  return ensureWritableDir(dir, "POLARR_DOWNLOADS_DIR");
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
