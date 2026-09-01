import { z } from "zod";
import { json, getAdminUser, getStaffUser } from "@/lib/api";
import {
  getAdminUserDetail,
  getAdminUserSessions,
  getUserActivityStats,
  revokeAdminUserSession,
} from "@/lib/db";
import { unscrambleUserId } from "@/lib/user-id";

export const dynamic = "force-dynamic";

function tokenFromRequest(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const match = /(?:^|;\s*)polarr_token=([^;]+)/.exec(
    req.headers.get("cookie") || "",
  );
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ userId: string }> },
) {
  const staff = await getStaffUser();
  if (!staff) return json({ error: "Staff only" }, { status: 403 });

  const { userId: token } = await ctx.params;
  const userId = unscrambleUserId(decodeURIComponent(token || ""));
  if (!userId) return json({ error: "Not found" }, { status: 404 });

  const detail = getAdminUserDetail(userId);
  if (!detail) return json({ error: "User not found" }, { status: 404 });

  const stats = getUserActivityStats(userId);

  return json({
    user: {
      publicId: detail.publicId,
      username: detail.username,
      isAdmin: detail.isAdmin,
      role: detail.role,
      createdAt: detail.createdAt,
      avatarUrl: detail.avatarUrl,
      bannerColors: detail.bannerColors,
      email: detail.email,
      discordId: detail.discordId,
      discordUsername: detail.discordUsername,
      discordDisplayName: detail.discordDisplayName,
      lastIp: detail.lastIp,
      lastHwid: detail.lastHwid,
      accessRevokedAt: detail.accessRevokedAt,
      invite: detail.invite,
      sessions: getAdminUserSessions(userId, tokenFromRequest(req)),
    },
    requestsTotal: stats?.requestsTotal ?? 0,
    requestsByStatus: stats?.requestsByStatus ?? {},
    downloads: stats?.downloads ?? { total: 0, completed: 0, active: 0 },
    albumsListed: stats?.albumsListed ?? 0,
    libraryTracks: stats?.libraryTracks ?? 0,
    listensMinutes: stats?.listensMinutes ?? 0,
    plays: stats?.plays ?? 0,
    recentRequests: stats?.recentRequests ?? [],
  });
}

const revokeSessionSchema = z.object({ sessionId: z.string().min(1).max(64) });

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ userId: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return json({ error: "Admin only" }, { status: 403 });
  const { userId: token } = await ctx.params;
  const userId = unscrambleUserId(decodeURIComponent(token || ""));
  if (!userId) return json({ error: "Not found" }, { status: 404 });
  const parsed = revokeSessionSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return json({ error: "Invalid session" }, { status: 400 });
  }
  if (!revokeAdminUserSession(userId, parsed.data.sessionId)) {
    return json({ error: "Session not found" }, { status: 404 });
  }
  return json({ ok: true });
}
