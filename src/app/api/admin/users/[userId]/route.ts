import { json, getStaffUser } from "@/lib/api";
import { getAdminUserDetail, getUserActivityStats } from "@/lib/db";
import { unscrambleUserId } from "@/lib/user-id";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
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
      lastIp: detail.lastIp,
      lastHwid: detail.lastHwid,
      accessRevokedAt: detail.accessRevokedAt,
      invite: detail.invite,
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
