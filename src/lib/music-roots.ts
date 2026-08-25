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

/** Lidarr container paths that usually share a host folder with Polarr’s `/music`. */
const LIDARR_PATH_ALIASES: Record<string, string> = {
  "/downloads/complete/music": "/music",
  "/downloads/music": "/music",
  "/data/media/music": "/music",
  "/music": "/music",
};

function dirExists(dir: string): boolean {
  const p = dir.trim();
  if (!p) return false;
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
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
      out.set(key, { ...opt, path: prev.path, exists: prev.exists || opt.exists });
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
        const lidarrPath = (r.path || "").trim().replace(/[/\\]+$/, "");
        if (!lidarrPath) continue;
        const alias = LIDARR_PATH_ALIASES[lidarrPath] || lidarrPath;
        const visible = dirExists(lidarrPath)
          ? lidarrPath
          : dirExists(alias)
            ? alias
            : lidarrPath;
        const mapped = visible !== lidarrPath;
        add(out, {
          path: visible,
          label: mapped
            ? `Lidarr library (${lidarrPath} → ${visible})`
            : `Lidarr library (${lidarrPath})`,
          source: "lidarr",
          exists: dirExists(visible),
        });
      }
    }
  } catch {
    /* Lidarr offline */
  }

  const current = settings.musicRoot.trim();
  if (current) {
    add(out, {
      path: current,
      label: `Current (${current})`,
      source: "current",
      exists: dirExists(current),
    });
  }

  return [...out.values()].sort((a, b) => {
    if (a.exists !== b.exists) return a.exists ? -1 : 1;
    if (a.source === "lidarr" && b.source !== "lidarr") return -1;
    if (b.source === "lidarr" && a.source !== "lidarr") return 1;
    return a.path.localeCompare(b.path);
  });
}
