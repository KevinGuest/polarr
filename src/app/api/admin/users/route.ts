import { z } from "zod";
import { json, getAdminUser, getStaffUser } from "@/lib/api";
import {
  listPublicProfiles,
  setUserRole,
  revokeUserAccess,
  getAdminUserDetail,
  transferServerOwnership,
} from "@/lib/db";
import { isUserRole, roleIsAdmin, roleIsOwner } from "@/lib/roles";
import { scrambleUserId, unscrambleUserId } from "@/lib/user-id";

export const dynamic = "force-dynamic";

function publicUser(u: ReturnType<typeof listPublicProfiles>[number]) {
  const detail = getAdminUserDetail(u.id);
  return {
    publicId: u.publicId,
    username: u.username,
    isAdmin: u.isAdmin,
    role: u.role,
    createdAt: u.createdAt,
    avatarUrl: u.avatarUrl,
    bannerColors: u.bannerColors,
    accessRevokedAt: detail?.accessRevokedAt ?? null,
  };
}

export async function GET() {
  const staff = await getStaffUser();
  if (!staff) return json({ error: "Staff only" }, { status: 403 });
  return json({
    users: listPublicProfiles().map(publicUser),
    mePublicId: scrambleUserId(staff.id),
    canManage: roleIsAdmin(staff.role),
    isOwner: roleIsOwner(staff.role),
  });
}

const roleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["member", "moderator", "admin", "owner"]),
  /** Required when role is owner — confirms transfer dialog. */
  confirmTransfer: z.boolean().optional(),
  isAdmin: z.boolean().optional(),
});

export async function POST(req: Request) {
  const actor = await getAdminUser();
  if (!actor) return json({ error: "Admin only" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = roleSchema.safeParse(body);
  if (!parsed.success) {
    const legacy = z
      .object({ userId: z.string().min(1), isAdmin: z.boolean() })
      .safeParse(body);
    if (!legacy.success) {
      return json({ error: "Invalid payload" }, { status: 400 });
    }
    const targetId = unscrambleUserId(legacy.data.userId);
    if (!targetId) return json({ error: "User not found" }, { status: 404 });
    if (targetId === actor.id && !legacy.data.isAdmin) {
      return json({ error: "You cannot demote yourself" }, { status: 400 });
    }
    try {
      const user = setUserRole(
        targetId,
        legacy.data.isAdmin ? "admin" : "member",
      );
      return json({ user: user ? publicUser(user) : null });
    } catch (err) {
      return json(
        { error: err instanceof Error ? err.message : "Update failed" },
        { status: 400 },
      );
    }
  }

  const targetId = unscrambleUserId(parsed.data.userId);
  if (!targetId) {
    return json({ error: "User not found" }, { status: 404 });
  }

  let role = parsed.data.role;
  if (parsed.data.isAdmin === true && role !== "owner") role = "admin";
  if (parsed.data.isAdmin === false && (role === "admin" || role === "owner")) {
    role = "member";
  }
  if (!isUserRole(role)) {
    return json({ error: "Invalid role" }, { status: 400 });
  }

  // Ownership transfer: only current server owner, confirmed from dialog.
  if (role === "owner") {
    if (!roleIsOwner(actor.role)) {
      return json(
        { error: "Only the Server Owner can transfer ownership" },
        { status: 403 },
      );
    }
    if (!parsed.data.confirmTransfer) {
      return json(
        {
          error:
            "Confirm ownership transfer to proceed. You will become a regular member.",
          requiresTransferConfirm: true,
        },
        { status: 400 },
      );
    }
    try {
      const user = transferServerOwnership(actor.id, targetId);
      return json({
        user: user ? publicUser(user) : null,
        transferred: true,
        demotedPublicId: scrambleUserId(actor.id),
      });
    } catch (err) {
      return json(
        { error: err instanceof Error ? err.message : "Transfer failed" },
        { status: 400 },
      );
    }
  }

  if (targetId === actor.id) {
    return json({ error: "You cannot change your own role here" }, { status: 400 });
  }

  try {
    const user = setUserRole(targetId, role);
    return json({ user: user ? publicUser(user) : null });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 400 },
    );
  }
}

const revokeSchema = z.object({
  userId: z.string().min(1),
});

export async function DELETE(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return json({ error: "Admin only" }, { status: 403 });

  const parsed = revokeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  const targetId = unscrambleUserId(parsed.data.userId);
  if (!targetId) {
    return json({ error: "User not found" }, { status: 404 });
  }
  if (targetId === admin.id) {
    return json({ error: "You cannot revoke your own access" }, { status: 400 });
  }

  try {
    revokeUserAccess(targetId);
    return json({ ok: true });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Revoke failed" },
      { status: 400 },
    );
  }
}
