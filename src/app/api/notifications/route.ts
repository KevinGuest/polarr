import { z } from "zod";
import { getAuthUser, json } from "@/lib/api";
import {
  countUnreadNotifications,
  getRequest,
  listNotifications,
  markNotificationsRead,
} from "@/lib/db";
import { resolveRequestCover } from "@/lib/request-cover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const raw = listNotifications(user.id, 40);

  const coverByRequest = new Map<string, string | null>();
  const mediaByRequest = new Map<string, string | null>();
  const requestIds = [
    ...new Set(raw.filter((n) => n.requestId).map((n) => n.requestId as string)),
  ];
  await Promise.all(
    requestIds.map(async (requestId) => {
      const req = getRequest(requestId);
      if (!req) {
        coverByRequest.set(requestId, null);
        mediaByRequest.set(requestId, null);
        return;
      }
      mediaByRequest.set(requestId, req.mediaType);
      const needsCover = raw.some(
        (n) => n.requestId === requestId && !n.imageUrl,
      );
      if (!needsCover) return;
      const cover = await resolveRequestCover(req).catch(() => null);
      coverByRequest.set(requestId, cover);
    }),
  );

  const items = raw.map((n) => ({
    id: n.id,
    kind: n.kind,
    actorLabel: n.actorLabel,
    message: n.message,
    href: n.href,
    imageSeed: n.imageSeed,
    image:
      n.imageUrl ||
      (n.requestId ? coverByRequest.get(n.requestId) : null) ||
      null,
    mediaType:
      n.mediaType ||
      (n.requestId ? mediaByRequest.get(n.requestId) : null) ||
      null,
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
