import fs from "node:fs";
import path from "node:path";
import { getAdminUser, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type FsBrowseEntry = {
  name: string;
  path: string;
  type: "dir" | "file";
};

const isWin = process.platform === "win32";

function safeResolve(input: string): string | null {
  const fallback = isWin ? process.cwd() : "/";
  const raw = (input || "").trim() || fallback;
  try {
    if (isWin) return path.resolve(raw);
    return path.posix.resolve("/", raw.replace(/\\/g, "/"));
  } catch {
    return null;
  }
}

function parentOf(dir: string): string | null {
  if (!isWin && (dir === "/" || dir === "")) return null;
  const parent = path.dirname(dir);
  if (!parent || parent === dir) return null;
  return parent;
}

function joinPath(dir: string, name: string): string {
  return isWin ? path.join(dir, name) : path.posix.join(dir, name);
}

/**
 * Admin-only directory browser for picking a music root (Sonarr-style).
 * GET ?path=/music
 */
export async function GET(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const requested =
    url.searchParams.get("path") || (isWin ? process.cwd() : "/");
  const dir = safeResolve(requested);
  if (!dir) return json({ error: "Invalid path" }, { status: 400 });

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
  });
}
