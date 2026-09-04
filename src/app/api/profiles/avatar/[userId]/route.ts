import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { getAuthUserFromRequest, json } from "@/lib/api";
import { getUserAvatarPath } from "@/lib/db";
import { avatarsDir } from "@/lib/paths";
import { unscrambleUserId } from "@/lib/user-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(
  req: Request,
  ctx: { params: Promise<{ userId: string }> },
) {
  const me = getAuthUserFromRequest(req);
  if (!me) return json({ error: "Unauthorized" }, { status: 401 });

  const { userId: token } = await ctx.params;
  const decoded = decodeURIComponent(token || "");
  if (
    !decoded ||
    decoded.includes("..") ||
    decoded.includes("/") ||
    decoded.includes("\\")
  ) {
    return json({ error: "Not found" }, { status: 404 });
  }

  const userId = unscrambleUserId(decoded);
  if (!userId) return json({ error: "Not found" }, { status: 404 });

  const stored = getUserAvatarPath(userId);
  if (!stored || !existsSync(stored)) {
    return json({ error: "No avatar" }, { status: 404 });
  }

  const root = path.resolve(avatarsDir());
  const resolved = path.resolve(stored);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return json({ error: "Not found" }, { status: 404 });
  }

  const ext = path.extname(resolved).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const { size, mtimeMs } = statSync(resolved);
  // Buffer is more reliable than piping createReadStream through Next Responses
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
