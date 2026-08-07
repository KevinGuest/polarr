import { cookies } from "next/headers";
import { json, getAuthUser } from "@/lib/api";
import { getPublicProfileById, getUserEmail } from "@/lib/db";
import { scrambleUserId } from "@/lib/user-id";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return json({ user: null }, { status: 401 });
  const email = getUserEmail(user.id);
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
  });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete("polarr_token");
  return json({ ok: true });
}
