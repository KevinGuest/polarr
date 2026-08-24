import { z } from "zod";
import { getAuthUser, json } from "@/lib/api";
import {
  createPlaylistFolder,
  deletePlaylistFolder,
  getPlaylistFolder,
  listPlaylistFolders,
  listUserPlaylistsInFolder,
  renamePlaylistFolder,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const folder = getPlaylistFolder(user.id, id);
    if (!folder) return json({ error: "Folder not found" }, { status: 404 });
    return json({
      folder,
      playlists: listUserPlaylistsInFolder(user.id, id),
    });
  }

  return json({ folders: listPlaylistFolders(user.id) });
}

const createSchema = z.object({
  name: z.string().min(1).max(80).optional(),
});

const renameSchema = z.object({
  action: z.literal("rename"),
  folderId: z.string().min(1),
  name: z.string().min(1).max(80),
});

const deleteSchema = z.object({
  action: z.literal("delete"),
  folderId: z.string().min(1),
});

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  const action = (raw as { action?: string }).action;

  if (action === "rename") {
    const parsed = renameSchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const folder = renamePlaylistFolder(
      user.id,
      parsed.data.folderId,
      parsed.data.name,
    );
    return folder
      ? json({ folder })
      : json({ error: "Folder not found" }, { status: 404 });
  }

  if (action === "delete") {
    const parsed = deleteSchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const result = deletePlaylistFolder(user.id, parsed.data.folderId);
    return result.ok
      ? json({ ok: true })
      : json({ error: result.error }, { status: 404 });
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const folder = createPlaylistFolder(user.id, parsed.data.name);
  return json({ folder });
}
