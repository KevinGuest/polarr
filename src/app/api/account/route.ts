import { z } from "zod";
import { getAuthUser, json } from "@/lib/api";
import {
  discordOAuthConfigured,
  discordPresenceAppConfigured,
  createEmailChangeToken,
  getDiscordLink,
  getDiscordPresenceEnabled,
  getSettings,
  getUserEmail,
  setDiscordLoginEnabled,
  setDiscordPresenceEnabled,
  smtpConfigured,
  updateUsername,
  updateUserPassword,
} from "@/lib/db";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-password";
import { resolvePublicBaseUrl } from "@/lib/public-url";
import { sendEmailChangeConfirmation } from "@/lib/email-change-email";

export const dynamic = "force-dynamic";

function discordPayload(userId: string) {
  const discord = getDiscordLink(userId);
  const presenceEnabled = getDiscordPresenceEnabled(userId);
  if (!discord) {
    return { linked: false as const, presenceEnabled };
  }
  return {
    linked: true as const,
    username: discord.discordUsername,
    displayName: discord.discordDisplayName,
    avatarUrl: discord.avatarUrl,
    presenceEnabled,
    loginEnabled: discord.loginEnabled,
  };
}

export async function GET() {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });
  const settings = getSettings();
  return json({
    username: user.username,
    email: getUserEmail(user.id),
    discord: discordPayload(user.id),
    discordOAuthReady: discordOAuthConfigured(settings),
    discordPresenceReady: discordPresenceAppConfigured(settings),
    discordClientId: settings.discordClientId.trim() || null,
  });
}

const patchSchema = z
  .object({
    email: z.string().min(1).max(255).optional(),
    username: z.string().min(1).max(40).optional(),
    currentPassword: z.string().min(1).max(128).optional(),
    newPassword: z
      .string()
      .min(
        MIN_PASSWORD_LENGTH,
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      )
      .max(128)
      .optional(),
    confirmPassword: z.string().min(1).max(128).optional(),
    discordPresenceEnabled: z.boolean().optional(),
    discordLoginEnabled: z.boolean().optional(),
  })
  .refine(
    (d) =>
      d.email !== undefined ||
      d.username !== undefined ||
      d.newPassword !== undefined ||
      d.discordPresenceEnabled !== undefined ||
      d.discordLoginEnabled !== undefined,
    { message: "Nothing to update" },
  );

export async function PATCH(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message;
    return json({ error: first || "Invalid payload" }, { status: 400 });
  }
  const body = parsed.data;

  let username = user.username;
  const email = getUserEmail(user.id);
  let emailConfirmationSent = false;
  let pendingEmail: string | null = null;

  if (body.username !== undefined) {
    const result = updateUsername(user.id, body.username);
    if (!result.ok) return json({ error: result.error }, { status: 400 });
    username = result.username;
  }

  if (body.email !== undefined) {
    const settings = getSettings();
    if (!smtpConfigured(settings)) {
      return json(
        { error: "Email changes require SMTP to be configured by an admin" },
        { status: 503 },
      );
    }
    const result = createEmailChangeToken(user.id, body.email);
    if (!result.ok) return json({ error: result.error }, { status: 400 });
    const base = resolvePublicBaseUrl(settings, req) || "http://localhost:3000";
    try {
      await sendEmailChangeConfirmation({
        to: result.email,
        username,
        confirmUrl: `${base}/api/account/confirm-email?token=${encodeURIComponent(result.token)}`,
      });
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Could not send the confirmation email",
        },
        { status: 502 },
      );
    }
    emailConfirmationSent = true;
    pendingEmail = result.email;
  }

  if (body.newPassword !== undefined) {
    if (!body.currentPassword) {
      return json({ error: "Current password is required" }, { status: 400 });
    }
    if (body.confirmPassword !== undefined && body.newPassword !== body.confirmPassword) {
      return json({ error: "New passwords do not match" }, { status: 400 });
    }
    const result = updateUserPassword(
      user.id,
      body.currentPassword,
      body.newPassword,
    );
    if (!result.ok) return json({ error: result.error }, { status: 400 });
  }

  if (body.discordPresenceEnabled !== undefined) {
    if (!discordPresenceAppConfigured()) {
      return json(
        { error: "Discord Client ID is not configured on this server" },
        { status: 400 },
      );
    }
    if (body.discordPresenceEnabled && !getDiscordLink(user.id)) {
      return json(
        { error: "Link your Discord account first" },
        { status: 400 },
      );
    }
    setDiscordPresenceEnabled(user.id, body.discordPresenceEnabled);
  }

  if (body.discordLoginEnabled !== undefined) {
    if (!getDiscordLink(user.id)) {
      return json(
        { error: "Link your Discord account first" },
        { status: 400 },
      );
    }
    setDiscordLoginEnabled(user.id, body.discordLoginEnabled);
  }

  const settings = getSettings();
  return json({
    ok: true,
    username,
    email,
    emailConfirmationSent,
    pendingEmail,
    discord: discordPayload(user.id),
    discordOAuthReady: discordOAuthConfigured(settings),
    discordPresenceReady: discordPresenceAppConfigured(settings),
    discordClientId: settings.discordClientId.trim() || null,
  });
}
