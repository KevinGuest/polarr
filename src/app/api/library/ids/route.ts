import { getAuthUser, json } from "@/lib/api";
import { listLibraryTrackIds } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Paged library ids for the background head-cache worker. */
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const offsetRaw = Number(url.searchParams.get("offset") || "0");
  const limitRaw = Number(url.searchParams.get("limit") || "80");
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 80;

  const { ids, total } = listLibraryTrackIds(limit, offset);
  return json({
    ids,
    total,
    offset,
    limit,
    done: offset + ids.length >= total,
  });
}
