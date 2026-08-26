import { json, getAuthUser } from "@/lib/api";
import { getPlaylistById, getUserPlaylist } from "@/lib/db";
import { recommendTracksForPlaylist } from "@/lib/playlist-recommend";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const playlistId = (id || "").trim();
  if (!playlistId) return json({ error: "Missing playlist" }, { status: 400 });

  const playlist =
    getUserPlaylist(user.id, playlistId) ?? getPlaylistById(playlistId, user.id);
  if (!playlist) return json({ error: "Playlist not found" }, { status: 404 });

  const url = new URL(_req.url);
  const limitRaw = Number(url.searchParams.get("limit") || "12");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 12;

  const tracks = await recommendTracksForPlaylist(playlistId, {
    userId: user.id,
    limit,
  });

  return json({
    tracks,
    seedCount: playlist.trackCount,
    basedOn: "playlist",
  });
}
