import fs from "node:fs";
import path from "node:path";
import { getSettings } from "./db";
import { LidarrClient } from "./lidarr";
import { downloadsDir, musicDir } from "./paths";

export type DetectedMusicRoot = {
  path: string;
  label: string;
  source: "lidarr" | "mount" | "env" | "downloads" | "current";
  exists: boolean;
};

/**
 * Paths Lidarr / Umbrel use that usually share the same host folder Polarr
 * mounts at `/music` (see umbrel compose: downloads/music → /music).
 */
const LIDARR_PATH_ALIASES: Record<string, string> = {
  "/downloads/complete/music": "/music",
  "/downloads/music": "/music",
  "/downloads/media/music": "/music",
  "/data/media/music": "/music",
  "/data/storage/downloads/music": "/music",
  "/music": "/music",
};

/** Longer prefixes first so /downloads/media/music beats /downloads. */
const LIDARR_PATH_PREFIXES: [string, string][] = (
  [
    ["/downloads/complete/music", "/music"],
    ["/downloads/media/music", "/music"],
    ["/data/storage/downloads/music", "/music"],
    ["/downloads/music", "/music"],
    ["/data/media/music", "/music"],
  ] as [string, string][]
).sort((a, b) => b[0].length - a[0].length);

function stripTrailingSlash(dir: string): string {
  return dir.replace(/[/\\]+$/, "") || "/";
}

function dirExists(dir: string): boolean {
  const p = dir.trim();
  if (!p) return false;
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Map a Lidarr/Umbrel-style path into this container (usually `/music`).
 * Returns null when no known alias applies.
 */
export function remapForeignMusicPath(input: string): string | null {
  const raw = stripTrailingSlash((input || "").trim().replace(/\\/g, "/"));
  if (!raw || raw === ".") return null;

  const exact = LIDARR_PATH_ALIASES[raw];
  if (exact) return exact;

  for (const [from, to] of LIDARR_PATH_PREFIXES) {
    if (raw === from) return to;
    if (raw.startsWith(`${from}/`)) {
      return path.posix.join(to, raw.slice(from.length + 1));
    }
  }
  return null;
}

function isWindowsAbsolute(input: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(input.trim());
}

function isUnixAbsolute(input: string): boolean {
  const t = input.trim().replace(/\\/g, "/");
  return t.startsWith("/") && !isWindowsAbsolute(t);
}

/**
 * Prefer a path that exists for this process.
 * Umbrel/Lidarr Unix paths get remapped into the container mount.
 * Windows localhost paths are kept as-is (never rewritten to /music).
 */
export function resolveBrowsableMusicPath(input: string): {
  path: string;
  remappedFrom?: string;
} {
  const raw = (input || "").trim();
  if (!raw) return { path: process.platform === "win32" ? musicDir() : "/" };

  // Keep Windows separators for exists checks / persisted settings.
  if (isWindowsAbsolute(raw) || process.platform === "win32") {
    const winPath = stripTrailingSlash(path.resolve(raw));
    if (dirExists(winPath)) return { path: winPath };
    // Don't substitute musicDir — user typed a real host path that isn't there yet.
    return { path: winPath };
  }

  const requested = stripTrailingSlash(raw.replace(/\\/g, "/"));
  if (requested && dirExists(requested)) {
    return { path: requested };
  }

  // Only remap Unix Lidarr/Umbrel-style paths (/downloads/media/music → /music).
  if (isUnixAbsolute(requested)) {
    const remapped = remapForeignMusicPath(requested);
    if (remapped && dirExists(remapped)) {
      return { path: remapped, remappedFrom: requested };
    }

    const env = (process.env.POLARR_MUSIC_DIR || "").trim();
    if (env && dirExists(env)) {
      return {
        path: env,
        remappedFrom: requested || undefined,
      };
    }

    try {
      const mount = musicDir();
      if (dirExists(mount)) {
        return {
          path: mount,
          remappedFrom: requested || undefined,
        };
      }
    } catch {
      /* ignore */
    }
  }

  return { path: requested || "/" };
}

function normalizeKey(dir: string): string {
  return path.resolve(dir.trim().replace(/[/\\]+$/, "") || ".");
}

function add(
  out: Map<string, DetectedMusicRoot>,
  opt: DetectedMusicRoot,
) {
  const p = opt.path.trim();
  if (!p) return;
  const key = normalizeKey(p);
  const prev = out.get(key);
  if (prev) {
    if (prev.source !== "lidarr" && opt.source === "lidarr") {
      out.set(key, {
        ...opt,
        path: prev.path,
        exists: prev.exists || opt.exists,
      });
    }
    return;
  }
  out.set(key, { ...opt, path: p, exists: dirExists(p) });
}

/**
 * Folders Polarr can index: Lidarr root folders (mapped into this container
 * when needed), the music mount, and the current setting.
 */
export async function detectMusicRoots(): Promise<DetectedMusicRoot[]> {
  const settings = getSettings();
  const out = new Map<string, DetectedMusicRoot>();

  const env = (process.env.POLARR_MUSIC_DIR || "").trim();
  if (env) {
    add(out, {
      path: env,
      label: `Container mount (${env})`,
      source: "env",
      exists: dirExists(env),
    });
  }

  try {
    const mount = musicDir();
    add(out, {
      path: mount,
      label: `Polarr music folder (${mount})`,
      source: "mount",
      exists: dirExists(mount),
    });
  } catch {
    /* unreadable mount */
  }

  try {
    const dl = downloadsDir();
    add(out, {
      path: dl,
      label: `Downloads (${dl})`,
      source: "downloads",
      exists: dirExists(dl),
    });
  } catch {
    /* ignore */
  }

  try {
    const client = LidarrClient.fromSettings();
    if (client) {
      const roots = await client.rootFolders().catch(() => []);
      for (const r of roots) {
        const lidarrPath = stripTrailingSlash((r.path || "").trim());
        if (!lidarrPath) continue;
        const alias =
          remapForeignMusicPath(lidarrPath) ||
          LIDARR_PATH_ALIASES[lidarrPath] ||
          lidarrPath;
        const visible = dirExists(lidarrPath)
          ? lidarrPath
          : dirExists(alias)
            ? alias
            : lidarrPath;
        const mapped = visible !== lidarrPath;
        add(out, {
          path: visible,
          label: mapped
            ? `Lidarr / Umbrel (${lidarrPath} → ${visible})`
            : `Lidarr library (${lidarrPath})`,
          source: "lidarr",
          exists: dirExists(visible),
        });
      }
    }
  } catch {
    /* Lidarr offline */
  }

  // Always surface Umbrel’s usual mount when /music exists
  if (dirExists("/music")) {
    add(out, {
      path: "/music",
      label: "Umbrel downloads/music → /music",
      source: "mount",
      exists: true,
    });
  }

  const current = settings.musicRoot.trim();
  if (current) {
    const resolved = resolveBrowsableMusicPath(current);
    add(out, {
      path: resolved.path,
      label:
        resolved.remappedFrom && resolved.remappedFrom !== resolved.path
          ? `Current (${resolved.remappedFrom} → ${resolved.path})`
          : `Current (${resolved.path})`,
      source: "current",
      exists: dirExists(resolved.path),
    });
  }

  return [...out.values()].sort((a, b) => {
    if (a.exists !== b.exists) return a.exists ? -1 : 1;
    if (a.source === "lidarr" && b.source !== "lidarr") return -1;
    if (b.source === "lidarr" && a.source !== "lidarr") return 1;
    return a.path.localeCompare(b.path);
  });
}
