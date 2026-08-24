import { json, getAdminUser, getAuthUser } from "@/lib/api";
import {
  deleteTrack,
  getTrack,
  listOfflineTrackIds,
  markOffline,
} from "@/lib/db";
import { resolveTrackCover } from "@/lib/lidarr";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const track = getTrack(id);
  if (!track) return json({ error: "Not found" }, { status: 404 });
  const coverUrl = await resolveTrackCover({
    coverPath: track.coverPath,
    artist: track.artist,
    album: track.album,
  });
  const user = await getAuthUser();
  const offline = user ? listOfflineTrackIds(user.id).includes(id) : false;
  return json({
    track: {
      ...track,
      coverPath: coverUrl || track.coverPath,
      coverUrl,
      streamUrl: `/api/stream/${track.id}`,
      downloadUrl: `/api/stream/${track.id}?download=1`,
    },
    downloaded: Boolean(track.path) || offline,
    offline,
  });
}

const offlineSchema = z.object({
  deviceId: z.string().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const track = getTrack(id);
  if (!track) return json({ error: "Not found" }, { status: 404 });
  const body = offlineSchema.safeParse(await req.json().catch(() => ({})));
  markOffline(id, user.id, body.success ? body.data.deviceId : undefined);
  return json({
    ok: true,
    offline: {
      trackId: id,
      streamUrl: `/api/stream/${id}`,
      title: track.title,
      artist: track.artist,
      album: track.album,
    },
  });
}

/** Admin/Owner only: remove from the index and delete the file on disk. */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) {
    const user = await getAuthUser();
    if (!user) return json({ error: "Unauthorized" }, { status: 401 });
    return json({ error: "Admin only" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const removed = deleteTrack(id, { deleteFiles: true });
  if (!removed) return json({ error: "Not found" }, { status: 404 });
  return json({ ok: true, track: removed, hardDeleted: true });
}
