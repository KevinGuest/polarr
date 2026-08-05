import { z } from "zod";
import { json, getAdminUser } from "@/lib/api";
import { listPublicProfiles, setUserAdmin } from "@/lib/db";
import { scrambleUserId, unscrambleUserId } from "@/lib/user-id";

export const dynamic = "force-dynamic";

function publicUser(u: ReturnType<typeof listPublicProfiles>[number]) {
  return {
    publicId: u.publicId,
    username: u.username,
    isAdmin: u.isAdmin,
    createdAt: u.createdAt,
    avatarUrl: u.avatarUrl,
    bannerColors: u.bannerColors,
  };
}

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return json({ error: "Admin only" }, { status: 403 });
  return json({
    users: listPublicProfiles().map(publicUser),
    mePublicId: scrambleUserId(admin.id),
  });
}

const patchSchema = z.object({
  userId: z.string().min(1),
  isAdmin: z.boolean(),
});

export async function POST(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return json({ error: "Admin only" }, { status: 403 });

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  const targetId = unscrambleUserId(parsed.data.userId);
  if (!targetId) {
    return json({ error: "User not found" }, { status: 404 });
  }

  if (targetId === admin.id && !parsed.data.isAdmin) {
    return json({ error: "You cannot demote yourself" }, { status: 400 });
  }

  try {
    const user = setUserAdmin(targetId, parsed.data.isAdmin);
    return json({ user: user ? publicUser(user) : null });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 400 },
    );
  }
}
