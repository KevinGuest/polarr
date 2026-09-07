import { getAuthUser, json } from "@/lib/api";
import { listLibrarySync } from "@/lib/db";
import { coverFromMap, getAlbumCoverMap } from "@/lib/lidarr";

export const dynamic = "force-dynamic";

/**
 * Incremental library metadata for on-device cache.
 * ?since=<ISO> — only rows updated/deleted after that watermark
 * ?limit=2000 — page size (max 5000)
 */
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const since = url.searchParams.get("since");
  const limitRaw = Number.parseInt(url.searchParams.get("limit") || "2000", 10);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 2000;

  const page = listLibrarySync({ since, limit });
  const covers = await getAlbumCoverMap();
  const tracks = page.tracks.map((t) => ({
    ...t,
    coverPath:
      coverFromMap(covers, t.artist, t.album, t.title, t.coverPath) ||
      t.coverPath,
  }));

  return json(
    {
      since: since || null,
      version: page.version,
      complete: page.complete,
      nextSince: page.nextSince,
      total: page.total,
      tracks,
      deletedIds: page.deletedIds,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
