import { z } from "zod";
import { json, getStaffUser } from "@/lib/api";
import {
  createInvite,
  deleteInvite,
  getSettings,
  inviteStatus,
  listInvites,
  revokeInvite,
  smtpConfigured,
} from "@/lib/db";
import { sendInviteEmail } from "@/lib/mail";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await getStaffUser();
  if (!admin) return json({ error: "Admin only" }, { status: 403 });

  const settings = getSettings();
  const invites = listInvites(200).map((inv) => ({
    ...inv,
    status: inviteStatus(inv),
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

export async function DELETE(req: Request) {
  const admin = await getStaffUser();
  if (!admin) return json({ error: "Admin only" }, { status: 403 });

  const parsed = revokeSchema.safeParse(await req.json());
  if (!parsed.success) {
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const invite = revokeInvite(parsed.data.id);
    return json({ invite: { ...invite, status: inviteStatus(invite) } });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Revoke failed" },
      { status: 400 },
    );
  }
}
