import { getAuthUser, json } from "@/lib/api";
import { listOthersListening } from "@/lib/db";
import { albumCoverKey, getAlbumCoverMap } from "@/lib/lidarr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recent tracks anyone on this homeserver has been listening to (≥15s). */
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const limitRaw = Number(new URL(req.url).searchParams.get("limit") || "16");
  const limit = Math.min(60, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 16));

  const covers = await getAlbumCoverMap();
  const items = listOthersListening(user.id, limit).map((t) => {
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
      listenedBy: t.listenedBy,
      listenedByAvatarUrl: t.listenedByAvatarUrl,
    };
  });

  return json(
    { items },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
