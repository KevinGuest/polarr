import { z } from "zod";
import { getAuthUser, json } from "@/lib/api";
import {
  addTrackToPlaylist,
  createPlaylist,
  deletePlaylist,
  getUserPlaylist,
  isTrackLiked,
  listPlaylistTracks,
  listUserPlaylists,
  listUserPlaylistsForTrack,
  normalizePlaylistId,
  PLAYLIST_DESCRIPTION_MAX,
  renamePlaylist,
  removeTrackFromPlaylist,
  setPlaylistFolder,
  updatePlaylistDetails,
} from "@/lib/db";
import { titleLooksExplicit } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const playlistId = normalizePlaylistId(params.get("id"));
  const forTrack = (params.get("forTrack") || "").trim();

  if (playlistId) {
    const playlist = getUserPlaylist(user.id, playlistId);
    if (!playlist) return json({ error: "Playlist not found" }, { status: 404 });
    const tracks = listPlaylistTracks(user.id, playlistId).map((t) => ({
      ...t,
      explicit: titleLooksExplicit(t.title),
      localTrackId: t.id,
    }));
    return json({ playlist, tracks });
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
  name: z.string().min(1).max(80).optional(),
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

const renameSchema = z.object({
  action: z.literal("rename"),
  playlistId: z.string().min(1),
  name: z.string().min(1).max(80),
  description: z.string().max(PLAYLIST_DESCRIPTION_MAX).optional(),
});

const patchDetailsSchema = z
  .object({
    playlistId: z.string().min(1),
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(PLAYLIST_DESCRIPTION_MAX).optional(),
  })
  .refine((d) => d.name !== undefined || d.description !== undefined, {
    message: "Nothing to update",
  });

const deleteSchema = z.object({
  action: z.literal("delete"),
  playlistId: z.string().min(1),
});

const moveSchema = z.object({
  action: z.literal("move"),
  playlistId: z.string().min(1),
  folderId: z.string().min(1).nullable(),
});

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  const action = (raw as { action?: string }).action;

  if (action === "remove") {
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

  if (action === "rename") {
    const parsed = renameSchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const playlist = renamePlaylist(
      user.id,
      parsed.data.playlistId,
      parsed.data.name,
      parsed.data.description,
    );
    return playlist
      ? json({ playlist })
      : json({ error: "Playlist not found" }, { status: 404 });
  }

  if (action === "delete") {
    const parsed = deleteSchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const result = deletePlaylist(user.id, parsed.data.playlistId);
    return result.ok
      ? json({ ok: true })
      : json({ error: result.error }, { status: 404 });
  }

  if (action === "move") {
    const parsed = moveSchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const playlist = setPlaylistFolder(
      user.id,
      parsed.data.playlistId,
      parsed.data.folderId,
    );
    return playlist
      ? json({ playlist })
      : json({ error: "Playlist or folder not found" }, { status: 404 });
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

export async function PATCH(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const parsed = patchDetailsSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message;
    return json({ error: first || "Invalid payload" }, { status: 400 });
  }

  const playlist = updatePlaylistDetails(user.id, parsed.data.playlistId, {
    name: parsed.data.name,
    description: parsed.data.description,
  });
  return playlist
    ? json({ playlist })
    : json({ error: "Playlist not found" }, { status: 404 });
}
