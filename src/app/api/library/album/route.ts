import { json, getAdminUser, getAuthUser } from "@/lib/api";
import { deleteAlbumTracks } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Admin/Owner only: remove album tracks from the index and delete files on disk. */
export async function DELETE(req: Request) {
  const admin = await getAdminUser();
  if (!admin) {
    const user = await getAuthUser();
    if (!user) return json({ error: "Unauthorized" }, { status: 401 });
    return json({ error: "Admin only" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const artist = (searchParams.get("artist") || "").trim();
  const album = (searchParams.get("album") || "").trim();
  if (!artist || !album) {
    return json({ error: "artist and album required" }, { status: 400 });
  }

  const removed = deleteAlbumTracks(artist, album, { deleteFiles: true });
  return json({ ok: true, removed });
}
