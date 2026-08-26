import { z } from "zod";
import { json, getAdminUser, getStaffUser } from "@/lib/api";
import {
  createUserBan,
  expiresAtFromDuration,
  liftUserBan,
  listBans,
} from "@/lib/bans";
import { getDb } from "@/lib/db";
import { scrambleUserId, unscrambleUserId } from "@/lib/user-id";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await getStaffUser();
  if (!staff) return json({ error: "Admin only" }, { status: 403 });
  const bans = listBans(150).map((b) => ({
    ...b,
    publicUserId: scrambleUserId(b.userId),
  }));
  // Ban targets: not yourself, not the server owner.
  const users = (
    getDb()
      .prepare(
        `SELECT id, username, role, access_revoked_at as revoked
         FROM users
         WHERE id != ?
           AND lower(coalesce(role, 'member')) != 'owner'
         ORDER BY lower(username) ASC`,
      )
      .all(staff.id) as {
      id: string;
      username: string;
      role: string | null;
      revoked: string | null;
    }[]
  ).map((u) => ({
    publicId: scrambleUserId(u.id),
    username: u.username,
    role: u.role || "member",
    revoked: Boolean(u.revoked),
  }));
  return json({ bans, users });
}

const createSchema = z.object({
  userId: z.string().min(1), // scrambled public id
  stream: z.boolean().default(false),
  download: z.boolean().default(false),
  user: z.boolean().default(false),
  duration: z.enum(["permanent", "1h", "24h", "7d", "30d", "custom"]),
  customEndsAt: z.string().optional().nullable(),
  reason: z.string().max(500).optional().nullable(),
});

export async function POST(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return json({ error: "Admin only" }, { status: 403 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Invalid ban" }, { status: 400 });
  }
  const body = parsed.data;
  if (!body.stream && !body.download && !body.user) {
    return json(
      { error: "Pick at least one ban type: streaming, downloads, or user" },
      { status: 400 },
    );
  }
  const realId = unscrambleUserId(body.userId);
  if (!realId) return json({ error: "Unknown user" }, { status: 400 });
  if (realId === admin.id) {
    return json({ error: "You can’t ban yourself" }, { status: 400 });
  }
  const target = getDb()
    .prepare(`SELECT role FROM users WHERE id = ?`)
    .get(realId) as { role: string | null } | undefined;
  if (target?.role === "owner") {
    return json({ error: "Cannot ban the server owner" }, { status: 400 });
  }

  try {
    const expiresAt = expiresAtFromDuration(
      body.duration,
      body.customEndsAt,
    );
    const ban = createUserBan({
      userId: realId,
      stream: body.stream,
      download: body.download,
      user: body.user,
      expiresAt,
      reason: body.reason,
      createdBy: admin.id,
      createdByUsername: admin.username,
    });
    const targetName =
      (
        getDb()
          .prepare(`SELECT username FROM users WHERE id = ?`)
          .get(realId) as { username: string } | undefined
      )?.username || "user";
    const kinds = [
      body.user ? "account" : null,
      body.stream ? "stream" : null,
      body.download ? "download" : null,
    ]
      .filter(Boolean)
      .join(", ");
    const { notifyDiscord } = await import("@/lib/admin-notify");
    notifyDiscord("userBanned", {
      title: "User banned",
      description: `${admin.username} banned ${targetName}`,
      fields: [
        { name: "User", value: targetName, inline: true },
        { name: "Types", value: kinds || "—", inline: true },
        {
          name: "Duration",
          value: ban.expiresAt
            ? `until ${new Date(ban.expiresAt).toLocaleString()}`
            : "permanent",
          inline: true,
        },
        ...(ban.reason
          ? [{ name: "Reason", value: ban.reason }]
          : []),
      ],
      href: "/admin/bans",
    });
    return json({
      ban: {
        ...ban,
        publicUserId: scrambleUserId(ban.userId),
      },
    });
  } catch (err) {
    return json(
      {
        error: err instanceof Error ? err.message : "Could not create ban",
      },
      { status: 400 },
    );
  }
}

const liftSchema = z.object({
  banId: z.string().min(1),
});

export async function DELETE(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return json({ error: "Admin only" }, { status: 403 });
  const parsed = liftSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "banId required" }, { status: 400 });
  }
  const banRow = getDb()
    .prepare(
      `SELECT b.user_id as userId, u.username
       FROM user_bans b
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.id = ?`,
    )
    .get(parsed.data.banId) as
    | { userId: string; username: string | null }
    | undefined;
  const ok = liftUserBan(parsed.data.banId);
  if (!ok) return json({ error: "Ban not found or already lifted" }, { status: 404 });
  const { notifyDiscord } = await import("@/lib/admin-notify");
  notifyDiscord("userUnbanned", {
    title: "User unbanned",
    description: `${admin.username} lifted a ban on ${banRow?.username || "a user"}`,
    fields: [
      { name: "User", value: banRow?.username || "—", inline: true },
      { name: "By", value: admin.username, inline: true },
    ],
    href: "/admin/bans",
  });
  return json({ ok: true });
}
