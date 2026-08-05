import { z } from "zod";
import { getAuthUser, json } from "@/lib/api";
import { listRecentPlays, recordPlay } from "@/lib/db";
import { getAlbumCoverMap, albumCoverKey } from "@/lib/lidarr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const postSchema = z.object({
  trackId: z.string().min(1),
});

/** List this user's recently played tracks. */
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const limitRaw = Number(new URL(req.url).searchParams.get("limit") || "24");
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 24));

  const covers = await getAlbumCoverMap();
  const items = listRecentPlays(user.id, limit).map((t) => {
    const fromDb =
      t.coverPath && /^https?:\/\//i.test(t.coverPath) ? t.coverPath : null;
    const fromLidarr = covers.get(albumCoverKey(t.artist, t.album)) || null;
    return {
      id: t.id,
      title: t.title,
      artist: t.artist,
      album: t.album,
      coverPath: fromDb || fromLidarr,
      playedAt: t.playedAt,
      liked: t.liked,
    };
  });

  return json({ items });
}

/** Record a play for Recently Played. */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  recordPlay(user.id, parsed.data.trackId);
  return json({ ok: true });
}
