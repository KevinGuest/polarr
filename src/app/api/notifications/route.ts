import { z } from "zod";
import { getAuthUser, json } from "@/lib/api";
import {
  countUnreadNotifications,
  listNotifications,
  markNotificationsRead,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const items = listNotifications(user.id, 40).map((n) => ({
    id: n.id,
    kind: n.kind,
    actorLabel: n.actorLabel,
    message: n.message,
    href: n.href,
    imageSeed: n.imageSeed,
    createdAt: n.createdAt,
    readAt: n.readAt,
    unread: n.unread,
  }));

  return json({
    unread: countUnreadNotifications(user.id),
    items,
  });
}

const markSchema = z.object({
  action: z.literal("mark_read"),
  ids: z.array(z.string().min(1)).optional(),
});

/** Mark notifications as read (all unread when ids omitted). */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const parsed = markSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  const marked = markNotificationsRead(user.id, parsed.data.ids);
  return json({
    ok: true,
    marked,
    unread: countUnreadNotifications(user.id),
  });
}
