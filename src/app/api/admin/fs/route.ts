import fs from "node:fs";
import path from "node:path";
import { getAdminUser, json } from "@/lib/api";
import { musicDir } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type FsBrowseEntry = {
  name: string;
  path: string;
  type: "dir" | "file";
};

const isWin = process.platform === "win32";

function looksUnixAbsolute(p: string): boolean {
  const t = p.trim().replace(/\\/g, "/");
  return t.startsWith("/") && !/^[a-zA-Z]:\//.test(t);
}

function winDriveRoots(): string[] {
  const roots: string[] = [];
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    const root = `${letter}:\\`;
    try {
      if (fs.existsSync(root)) roots.push(root);
    } catch {
      /* ignore */
    }
  }
  return roots;
}

/** Same idea on every platform: start where we can actually list folders. */
function defaultBrowsePath(): string {
  if (isWin) {
    try {
      const mount = musicDir();
      if (fs.existsSync(mount) && fs.statSync(mount).isDirectory()) return mount;
    } catch {
      /* fall through */
    }
    return process.cwd();
  }
  // Linux / Umbrel / Docker — browse the real FS from root (like Windows drives).
  return "/";
}

function quickBrowsePaths(): { path: string; label: string }[] {
  const out: { path: string; label: string }[] = [];
  const seen = new Set<string>();
  const add = (p: string, label: string) => {
    const key = isWin ? path.resolve(p) : path.posix.resolve(p);
    if (seen.has(key)) return;
    try {
      if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) return;
    } catch {
      return;
    }
    seen.add(key);
    out.push({ path: p, label });
  };

  if (isWin) {
    try {
      add(musicDir(), "Music folder");
    } catch {
      /* ignore */
    }
    add(process.cwd(), "App folder");
    for (const root of winDriveRoots()) add(root, root);
  } else {
    add("/", "/");
    add("/downloads", "/downloads");
    add("/downloads/media/music", "/downloads/media/music");
    add("/downloads/music", "/downloads/music");
    add("/music", "/music");
    try {
      add(musicDir(), "Music folder");
    } catch {
      /* ignore */
    }
    add("/data", "/data");
  }
  return out;
}

function safeResolve(input: string): string | null {
  const raw = (input || "").trim();
  if (!raw) return defaultBrowsePath();
  try {
    if (isWin) {
      // Don't turn Umbrel-style "/music" into C:\music on Windows.
      if (looksUnixAbsolute(raw)) return defaultBrowsePath();
      return path.resolve(raw);
    }
    return path.posix.resolve("/", raw.replace(/\\/g, "/"));
  } catch {
    return null;
  }
}

function parentOf(dir: string): string | null {
  if (!isWin && (dir === "/" || dir === "")) return null;
  if (isWin && /^[a-zA-Z]:\\$/.test(dir)) return null;
  const parent = path.dirname(dir);
  if (!parent || parent === dir) return null;
  return parent;
}

function joinPath(dir: string, name: string): string {
  return isWin ? path.join(dir, name) : path.posix.join(dir, name);
}

/**
 * Admin-only directory browser for picking a music root (Sonarr-style).
 * Same behavior everywhere: list real folders Polarr can see — no silent remaps.
 * GET ?path=/downloads/media/music  or  ?path=C:\Music
 */
export async function GET(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const requested = url.searchParams.get("path") || defaultBrowsePath();
  const dir = safeResolve(requested);
  if (!dir) return json({ error: "Invalid path" }, { status: 400 });

  const quickPaths = quickBrowsePaths();

  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    return json(
      {
        error: "Path not found",
        path: dir,
        parent: parentOf(dir),
        entries: [],
        platform: process.platform,
        quickPaths,
        hint: "That folder isn’t visible here. Browse from a shortcut below, or go up and pick a folder Polarr can see.",
        suggested: quickPaths[0]?.path || (isWin ? process.cwd() : "/"),
      },
      { status: 404 },
    );
  }
  if (!stat.isDirectory()) {
    return json({ error: "Not a directory" }, { status: 400 });
  }

  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return json({ error: "Cannot read directory" }, { status: 403 });
  }

  const entries: FsBrowseEntry[] = [];
  for (const name of names) {
    if (name === "." || name === "..") continue;
    if ((dir === "/" || /^[a-zA-Z]:\\$/.test(dir)) && name.startsWith(".")) {
      continue;
    }
    const full = joinPath(dir, name);
    try {
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        entries.push({ name, path: full, type: "dir" });
      } else if (st.isFile()) {
        entries.push({ name, path: full, type: "file" });
      }
    } catch {
      /* unreadable — skip */
    }
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return json({
    path: dir,
    parent: parentOf(dir),
    entries,
    platform: process.platform,
    quickPaths,
  });
}
