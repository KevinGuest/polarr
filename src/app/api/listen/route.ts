import { z } from "zod";
import { getAuthUser, json } from "@/lib/api";
import { addListenSeconds } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  seconds: z.number().positive().max(3600),
  trackId: z.string().min(1).optional(),
});

/** Client heartbeat while audio plays — credited to the signed-in user. */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  addListenSeconds(user.id, parsed.data.seconds, parsed.data.trackId ?? null);
  return json({ ok: true });
}
