import { cookies } from "next/headers";
import { json, getAuthUser } from "@/lib/api";
import { banPublicPayload, getActiveBan } from "@/lib/bans";
import { getPublicProfileById, getUserEmail } from "@/lib/db";
import { scrambleUserId } from "@/lib/user-id";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return json({ user: null }, { status: 401 });
  const email = getUserEmail(user.id);
  const ban = banPublicPayload(getActiveBan(user.id));
  const profile = getPublicProfileById(user.id);
  if (!profile) {
    return json({
      user: {
        publicId: scrambleUserId(user.id),
        username: user.username,
        isAdmin: user.isAdmin,
        role: user.role,
        email,
        createdAt: "",
        avatarUrl: null,
        bannerColors: null,
      },
      ban,
    });
  }
  return json({
    user: {
      publicId: profile.publicId,
      username: profile.username,
      isAdmin: profile.isAdmin,
      role: profile.role,
      email,
      createdAt: profile.createdAt,
      avatarUrl: profile.avatarUrl,
      bannerColors: profile.bannerColors,
    },
    ban,
  });
}

export async function DELETE() {
  const user = await getAuthUser();
  const cookieStore = await cookies();
  cookieStore.delete("polarr_token");
  if (user) {
    const { notifyDiscord } = await import("@/lib/admin-notify");
    notifyDiscord("userLogout", {
      title: "User signed out",
      description: `${user.username} signed out`,
      fields: [{ name: "User", value: user.username, inline: true }],
    });
  }
  return json({ ok: true });
}
