import { json, getAdminUser } from "@/lib/api";
import { getUserActivityStats } from "@/lib/db";
import { unscrambleUserId } from "@/lib/user-id";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ userId: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return json({ error: "Admin only" }, { status: 403 });

  const { userId: token } = await ctx.params;
  const userId = unscrambleUserId(decodeURIComponent(token || ""));
  if (!userId) return json({ error: "Not found" }, { status: 404 });

  const stats = getUserActivityStats(userId);
  if (!stats) return json({ error: "User not found" }, { status: 404 });

  // Don't leak internal id in the payload
  const { user, ...rest } = stats;
  return json({
    ...rest,
    user: {
      publicId: user.publicId,
      username: user.username,
      isAdmin: user.isAdmin,
      createdAt: user.createdAt,
      avatarUrl: user.avatarUrl,
      bannerColors: user.bannerColors,
    },
  });
}
