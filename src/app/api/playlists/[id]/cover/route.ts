import { mkdir, writeFile, unlink } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { getAuthUser, getAuthUserFromRequest, json } from "@/lib/api";
import {
  getPlaylistCoverPath,
  getPlaylistCoverPathById,
  getUserPlaylist,
  normalizePlaylistId,
  setPlaylistCoverPath,
} from "@/lib/db";
import { playlistCoversDir } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = getAuthUserFromRequest(req);
  if (!me) return json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const playlistId = normalizePlaylistId(id);
  if (
    !playlistId ||
    playlistId.includes("..") ||
    playlistId.includes("/") ||
    playlistId.includes("\\")
  ) {
    return json({ error: "Not found" }, { status: 404 });
  }

  const stored =
    getPlaylistCoverPath(me.id, playlistId) ||
    getPlaylistCoverPathById(playlistId);
  if (!stored || !existsSync(stored)) {
    return json({ error: "No cover" }, { status: 404 });
  }

  const root = path.resolve(playlistCoversDir());
  const resolved = path.resolve(stored);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return json({ error: "Not found" }, { status: 404 });
  }

  const ext = path.extname(resolved).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const { size, mtimeMs } = statSync(resolved);
  const body = readFileSync(resolved);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(size),
      "Cache-Control": "private, no-cache, must-revalidate",
      ETag: `"${size}-${Math.round(mtimeMs)}"`,
    },
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getAuthUser();
  if (!me) return json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const playlistId = normalizePlaylistId(id);
  if (!playlistId || !getUserPlaylist(me.id, playlistId)) {
    return json({ error: "Playlist not found" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("cover") ?? form.get("image") ?? form.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return json({ error: "Image file required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return json({ error: "Image must be under 5MB" }, { status: 400 });
  }

  const ext = ALLOWED.get(file.type);
  if (!ext) {
    return json(
      { error: "Use a JPEG, PNG, WebP, or GIF image" },
      { status: 400 },
    );
  }

  const dir = playlistCoversDir();
  await mkdir(dir, { recursive: true });

  const filename = `${playlistId}.${ext}`;
  const abs = path.join(dir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(abs, buffer);

  const previous = getPlaylistCoverPath(me.id, playlistId);
  if (previous && previous !== abs) {
    await unlink(previous).catch(() => null);
  }

  const playlist = setPlaylistCoverPath(me.id, playlistId, filename);
  return json({ ok: true, playlist });
}
