import { z } from "zod";
import { getAuthUser, json } from "@/lib/api";
import {
  excludeTrackFromTaste,
  isTrackTasteExcluded,
  listTasteExcludeIds,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });
  return json({ trackIds: listTasteExcludeIds(user.id) });
}

const schema = z.object({
  trackId: z.string().min(1),
});

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "trackId required" }, { status: 400 });
  }
  const ok = excludeTrackFromTaste(user.id, parsed.data.trackId);
  if (!ok) return json({ error: "Track not found" }, { status: 404 });
  return json({
    ok: true,
    excluded: isTrackTasteExcluded(user.id, parsed.data.trackId),
  });
}
