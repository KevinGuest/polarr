import { z } from "zod";
import { getStaffUser, json } from "@/lib/api";
import { adminDeletePlaylist, listAllUserPlaylists } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await getStaffUser();
  if (!staff) return json({ error: "Admin only" }, { status: 403 });

  const playlists = listAllUserPlaylists().map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    trackCount: p.trackCount,
    ownerUsername: p.ownerUsername,
    userId: p.userId,
    updatedAt: p.updatedAt,
    createdAt: p.createdAt,
    coverUrl: p.coverUrl,
  }));

  return json({ playlists });
}

const deleteSchema = z.object({
  id: z.string().min(1).max(80),
});

export async function DELETE(req: Request) {
  const staff = await getStaffUser();
  if (!staff) return json({ error: "Admin only" }, { status: 403 });

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Playlist id required" }, { status: 400 });
  }

  const result = adminDeletePlaylist(parsed.data.id);
  if (!result.ok) {
    return json({ error: result.error || "Delete failed" }, { status: 404 });
  }
  return json({ ok: true });
}
