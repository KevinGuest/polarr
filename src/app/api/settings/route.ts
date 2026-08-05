import { z } from "zod";
import { getAdminUser, getAuthUser, json } from "@/lib/api";
import {
  getSettings,
  hasUsers,
  smtpConfigured,
  updateSettings,
  type NotifyEventFlags,
} from "@/lib/db";
import { NOTIFY_EVENT_IDS } from "@/lib/notify-events";
import { isDiscordWebhookUrl, sendDiscordTest } from "@/lib/discord";
import { probeLidarr } from "@/lib/lidarr";

export const dynamic = "force-dynamic";

function maskSecrets(settings: ReturnType<typeof getSettings>) {
  return {
    ...settings,
    lidarrApiKey: settings.lidarrApiKey ? "••••••••" : "",
    smtpPassword: settings.smtpPassword ? "••••••••" : "",
    smtpConfigured: smtpConfigured(settings),
    discordWebhookUrl: "",
    discordWebhookConfigured: Boolean(settings.discordWebhookUrl.trim()),
  };
}

const notifyEventsSchema = z
  .record(z.string(), z.boolean())
  .optional();

function mergeNotifyEvents(
  current: NotifyEventFlags,
  patch?: Record<string, boolean> | null,
): NotifyEventFlags {
  if (!patch) return current;
  const next = { ...current };
  for (const id of NOTIFY_EVENT_IDS) {
    if (typeof patch[id] === "boolean") next[id] = patch[id]!;
  }
  return next;
}

export async function GET() {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const settings = getSettings();
  const isAdmin = Boolean(user.isAdmin);

  if (!isAdmin) {
    return json({
      serverName: settings.serverName,
      publicUrl: settings.publicUrl,
      setupComplete: settings.setupComplete,
      hasUsers: hasUsers(),
    });
  }

  return json({
    ...maskSecrets(settings),
    hasUsers: hasUsers(),
  });
}

const bodySchema = z.object({
  serverName: z.string().min(1).max(80).optional(),
  lidarrUrl: z.string().url().or(z.literal("")).optional(),
  lidarrApiKey: z.string().optional(),
  musicRoot: z.string().optional(),
  fallbackEnabled: z.boolean().optional(),
  publicUrl: z.string().optional(),
  testLidarr: z.boolean().optional(),
  testDiscord: z.boolean().optional(),
  smtpHost: z.string().max(255).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpUser: z.string().max(255).optional(),
  smtpPassword: z.string().max(255).optional(),
  smtpFrom: z.string().max(255).optional(),
  smtpSecure: z.boolean().optional(),
  notifyEmailEnabled: z.boolean().optional(),
  notifyDiscordEnabled: z.boolean().optional(),
  discordWebhookUrl: z.string().max(500).optional(),
  notifyEmailEvents: notifyEventsSchema,
  notifyDiscordEvents: notifyEventsSchema,
});

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;
  const current = getSettings();
  const touchesLidarr =
    body.testLidarr ||
    body.lidarrUrl !== undefined ||
    body.lidarrApiKey !== undefined ||
    body.musicRoot !== undefined;
  const touchesSmtp =
    body.smtpHost !== undefined ||
    body.smtpPort !== undefined ||
    body.smtpUser !== undefined ||
    body.smtpPassword !== undefined ||
    body.smtpFrom !== undefined ||
    body.smtpSecure !== undefined;
  const touchesNotify =
    body.testDiscord ||
    body.notifyEmailEnabled !== undefined ||
    body.notifyDiscordEnabled !== undefined ||
    body.discordWebhookUrl !== undefined ||
    body.notifyEmailEvents !== undefined ||
    body.notifyDiscordEvents !== undefined;

  if (touchesLidarr || touchesSmtp || touchesNotify) {
    const admin = await getAdminUser();
    if (!admin) return json({ error: "Admin only" }, { status: 403 });
  }

  if (body.testLidarr) {
    const url = body.lidarrUrl ?? current.lidarrUrl;
    const key =
      body.lidarrApiKey && body.lidarrApiKey !== "••••••••"
        ? body.lidarrApiKey
        : current.lidarrApiKey;
    try {
      const status = await probeLidarr(url, key);
      return json({ ok: true, status });
    } catch (err) {
      return json(
        {
          ok: false,
          error: err instanceof Error ? err.message : "Connection failed",
        },
        { status: 400 },
      );
    }
  }

  if (body.testDiscord) {
    const webhook = (body.discordWebhookUrl ?? current.discordWebhookUrl).trim();
    if (!isDiscordWebhookUrl(webhook)) {
      return json({ error: "Enter a valid Discord webhook URL" }, { status: 400 });
    }
    try {
      await sendDiscordTest(webhook);
      return json({ ok: true });
    } catch (err) {
      return json(
        {
          ok: false,
          error: err instanceof Error ? err.message : "Discord test failed",
        },
        { status: 400 },
      );
    }
  }

  if (
    body.discordWebhookUrl !== undefined &&
    body.discordWebhookUrl.trim() &&
    !isDiscordWebhookUrl(body.discordWebhookUrl)
  ) {
    return json({ error: "Invalid Discord webhook URL" }, { status: 400 });
  }

  const next = updateSettings({
    serverName: body.serverName ?? current.serverName,
    lidarrUrl: body.lidarrUrl ?? current.lidarrUrl,
    lidarrApiKey:
      body.lidarrApiKey && body.lidarrApiKey !== "••••••••"
        ? body.lidarrApiKey
        : current.lidarrApiKey,
    musicRoot: body.musicRoot ?? current.musicRoot,
    fallbackEnabled: true,
    publicUrl: body.publicUrl ?? current.publicUrl,
    smtpHost: body.smtpHost ?? current.smtpHost,
    smtpPort: body.smtpPort ?? current.smtpPort,
    smtpUser: body.smtpUser ?? current.smtpUser,
    smtpPassword:
      body.smtpPassword && body.smtpPassword !== "••••••••"
        ? body.smtpPassword
        : current.smtpPassword,
    smtpFrom: body.smtpFrom ?? current.smtpFrom,
    smtpSecure: body.smtpSecure ?? current.smtpSecure,
    notifyEmailEnabled: body.notifyEmailEnabled ?? current.notifyEmailEnabled,
    notifyDiscordEnabled:
      body.notifyDiscordEnabled ?? current.notifyDiscordEnabled,
    discordWebhookUrl:
      body.discordWebhookUrl !== undefined
        ? body.discordWebhookUrl.trim()
        : current.discordWebhookUrl,
    notifyEmailEvents: mergeNotifyEvents(
      current.notifyEmailEvents,
      body.notifyEmailEvents,
    ),
    notifyDiscordEvents: mergeNotifyEvents(
      current.notifyDiscordEvents,
      body.notifyDiscordEvents,
    ),
  });

  const isAdmin = Boolean(user.isAdmin);
  return json({
    ok: true,
    settings: isAdmin
      ? maskSecrets(next)
      : {
          serverName: next.serverName,
          publicUrl: next.publicUrl,
        },
  });
}
