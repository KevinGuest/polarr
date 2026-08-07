import { z } from "zod";
import { getAuthUser, json } from "@/lib/api";
import {
  discordOAuthConfigured,
  getDiscordLink,
  getSettings,
  getUserEmail,
  setDiscordPresenceEnabled,
  updateUserEmail,
  updateUsername,
  updateUserPassword,
} from "@/lib/db";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-password";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });
  const settings = getSettings();
  const discord = getDiscordLink(user.id);
  return json({
    username: user.username,
    email: getUserEmail(user.id),
    discord: discord
      ? {
          linked: true,
          username: discord.discordUsername,
          presenceEnabled: discord.presenceEnabled,
        }
      : { linked: false, username: null, presenceEnabled: false },
    discordOAuthReady: discordOAuthConfigured(settings),
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
  })
  .refine(
    (d) =>
      d.email !== undefined ||
      d.username !== undefined ||
      d.newPassword !== undefined ||
      d.discordPresenceEnabled !== undefined,
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
  let email = getUserEmail(user.id);

  if (body.username !== undefined) {
    const result = updateUsername(user.id, body.username);
    if (!result.ok) return json({ error: result.error }, { status: 400 });
    username = result.username;
  }

  if (body.email !== undefined) {
    const result = updateUserEmail(user.id, body.email);
    if (!result.ok) return json({ error: result.error }, { status: 400 });
    email = result.email;
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
    const link = getDiscordLink(user.id);
    if (!link) {
      return json({ error: "Link Discord first" }, { status: 400 });
    }
    setDiscordPresenceEnabled(user.id, body.discordPresenceEnabled);
  }

  const discord = getDiscordLink(user.id);
  return json({
    ok: true,
    username,
    email,
    discord: discord
      ? {
          linked: true,
          username: discord.discordUsername,
          presenceEnabled: discord.presenceEnabled,
        }
      : { linked: false, username: null, presenceEnabled: false },
  });
}
