import { z } from "zod";
import { getAuthUser, json } from "@/lib/api";
import {
  addTrackToPlaylist,
  createPlaylist,
  isTrackLiked,
  listPlaylistTracks,
  listUserPlaylists,
  listUserPlaylistsForTrack,
  removeTrackFromPlaylist,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const playlistId = params.get("id");
  const forTrack = (params.get("forTrack") || "").trim();

  if (playlistId) {
    const tracks = listPlaylistTracks(user.id, playlistId);
    return json({ tracks });
  }

  if (forTrack) {
    return json({
      playlists: listUserPlaylistsForTrack(user.id, forTrack),
      liked: isTrackLiked(user.id, forTrack),
    });
  }

  return json({ playlists: listUserPlaylists(user.id) });
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
});

const addSchema = z.object({
  playlistId: z.string().min(1),
  trackId: z.string().min(1),
});

const removeSchema = z.object({
  playlistId: z.string().min(1),
  trackId: z.string().min(1),
  action: z.literal("remove"),
});

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  if ("action" in raw && (raw as { action?: string }).action === "remove") {
    const parsed = removeSchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const result = removeTrackFromPlaylist(
      user.id,
      parsed.data.playlistId,
      parsed.data.trackId,
    );
    return result.ok
      ? json({ ok: true })
      : json({ error: result.error }, { status: 400 });
  }

  if ("playlistId" in raw && "trackId" in raw) {
    const parsed = addSchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const result = addTrackToPlaylist(
      user.id,
      parsed.data.playlistId,
      parsed.data.trackId,
    );
    return result.ok
      ? json({ ok: true })
      : json({ error: result.error }, { status: 400 });
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const playlist = createPlaylist(user.id, parsed.data.name);
  if ("trackId" in raw && typeof (raw as { trackId?: string }).trackId === "string") {
    addTrackToPlaylist(
      user.id,
      playlist.id,
      (raw as { trackId: string }).trackId,
    );
  }
  return json({ playlist });
}
