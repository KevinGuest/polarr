import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { getAuthUser, json } from "@/lib/api";
import { getUserAvatarPath, setUserAvatar } from "@/lib/db";
import { avatarsDir } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

function parseBannerColors(raw: unknown): string[] | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length < 2 ||
      !parsed.every((c) => typeof c === "string" && c.length < 80)
    ) {
      return null;
    }
    return parsed.slice(0, 4) as string[];
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const me = await getAuthUser();
  if (!me) return json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("avatar");
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

  const bannerColors = parseBannerColors(form.get("bannerColors"));
  const dir = avatarsDir();
  await mkdir(dir, { recursive: true });

  const filename = `${me.id}.${ext}`;
  const abs = path.join(dir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(abs, buffer);

  // Drop any previous avatar with a different extension
  const previous = getUserAvatarPath(me.id);
  if (previous && previous !== abs) {
    await unlink(previous).catch(() => null);
  }

  const profile = setUserAvatar(me.id, abs, bannerColors);
  return json({
    ok: true,
    user: profile,
  });
}
