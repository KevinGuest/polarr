import { z } from "zod";
import { json, getStaffUser } from "@/lib/api";
import {
  createInvite,
  deleteInvite,
  getInviteById,
  getSettings,
  inviteStatus,
  listInvites,
  revokeInvite,
  smtpConfigured,
} from "@/lib/db";
import { sendInviteEmail } from "@/lib/mail";
import { scrambleUserId } from "@/lib/user-id";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await getStaffUser();
  if (!admin) return json({ error: "Admin only" }, { status: 403 });

  const settings = getSettings();
  const invites = listInvites(200).map((inv) => ({
    ...inv,
    status: inviteStatus(inv),
    usedByPublicId: inv.usedBy ? scrambleUserId(inv.usedBy) : null,
  }));
  return json({
    invites,
    emailConfigured: smtpConfigured(settings),
    serverName: settings.serverName || "Polarr",
  });
}

const createSchema = z.object({
  email: z.string().email().max(255),
  expiresInDays: z.number().int().min(0).max(365).optional(),
});

export async function POST(req: Request) {
  const admin = await getStaffUser();
  if (!admin) return json({ error: "Admin only" }, { status: 403 });

  const settings = getSettings();
  if (!smtpConfigured(settings)) {
    return json(
      { error: "Invites are disabled until SMTP is configured" },
      { status: 400 },
    );
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ error: "Valid email is required" }, { status: 400 });
  }

  const expiresInDays = parsed.data.expiresInDays ?? 14;
  const invite = createInvite(admin.id, {
    expiresInDays,
    emailedTo: parsed.data.email,
  });

  const base =
    settings.publicUrl.trim().replace(/\/$/, "") ||
    new URL(req.url).origin;
  const joinUrl = `${base}/join?code=${encodeURIComponent(invite.code)}`;

  try {
    await sendInviteEmail({
      to: parsed.data.email,
      code: invite.code,
      joinUrl,
      invitedBy: admin.username,
      expiresAt: invite.expiresAt,
    });
  } catch (err) {
    deleteInvite(invite.id);
    return json(
      {
        error:
          err instanceof Error
            ? `Invite not sent: ${err.message}`
            : "Invite not sent",
      },
      { status: 400 },
    );
  }

  return json({
    invite: { ...invite, status: inviteStatus(invite) },
    emailedTo: parsed.data.email,
  });
}

const revokeSchema = z.object({
  id: z.string().min(1),
});

const resendSchema = z.object({
  id: z.string().min(1),
  action: z.literal("resend"),
});

/** Resend the join email for an open invite. */
export async function PATCH(req: Request) {
  const admin = await getStaffUser();
  if (!admin) return json({ error: "Admin only" }, { status: 403 });

  const settings = getSettings();
  if (!smtpConfigured(settings)) {
    return json(
      { error: "Invites are disabled until SMTP is configured" },
      { status: 400 },
    );
  }

  const parsed = resendSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  const invite = getInviteById(parsed.data.id);
  if (!invite) return json({ error: "Invite not found" }, { status: 404 });
  if (inviteStatus(invite) !== "open") {
    return json({ error: "Only open invites can be resent" }, { status: 400 });
  }
  const to = invite.emailedTo?.trim();
  if (!to) {
    return json(
      { error: "This invite has no email address to resend to" },
      { status: 400 },
    );
  }

  const base =
    settings.publicUrl.trim().replace(/\/$/, "") ||
    new URL(req.url).origin;
  const joinUrl = `${base}/join?code=${encodeURIComponent(invite.code)}`;

  try {
    await sendInviteEmail({
      to,
      code: invite.code,
      joinUrl,
      invitedBy: admin.username,
      expiresAt: invite.expiresAt,
    });
  } catch (err) {
    return json(
      {
        error:
          err instanceof Error
            ? `Invite not resent: ${err.message}`
            : "Invite not resent",
      },
      { status: 400 },
    );
  }

  return json({
    invite: { ...invite, status: inviteStatus(invite) },
    emailedTo: to,
  });
}

export async function DELETE(req: Request) {
  const admin = await getStaffUser();
  if (!admin) return json({ error: "Admin only" }, { status: 403 });

  const parsed = revokeSchema.safeParse(await req.json());
  if (!parsed.success) {
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    revokeInvite(parsed.data.id);
    return json({ ok: true });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Revoke failed" },
      { status: 400 },
    );
  }
}
