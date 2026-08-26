import { z } from "zod";
import fs from "node:fs";
import { getAdminUser, getAuthUser, json } from "@/lib/api";
import {
  getServerOwnerContact,
  getSettings,
  hasUsers,
  smtpConfigured,
  updateSettings,
  verifyUserPassword,
  type NotifyEventFlags,
} from "@/lib/db";
import { NOTIFY_EVENT_IDS } from "@/lib/notify-events";
import { DOWNLOAD_QUALITIES } from "@/lib/download-quality";
import { isDiscordWebhookUrl, sendDiscordTest } from "@/lib/discord";
import { sendSmtpTestEmail } from "@/lib/mail";
import { probeLidarr } from "@/lib/lidarr";
import { probeGenius } from "@/lib/lyrics/genius";
import { detectMusicRoots, resolveBrowsableMusicPath } from "@/lib/music-roots";
import { normalizePublicBaseUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

/** Keep the admin’s pick when it exists; only remap when the path isn’t visible. */
function persistMusicRoot(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  try {
    if (fs.existsSync(trimmed) && fs.statSync(trimmed).isDirectory()) {
      return trimmed.replace(/[/\\]+$/, "") || trimmed;
    }
  } catch {
    /* fall through */
  }
  return resolveBrowsableMusicPath(trimmed).path;
}

function maskSecrets(settings: ReturnType<typeof getSettings>) {
  return {
    ...settings,
    lidarrApiKey: settings.lidarrApiKey ? "••••••••" : "",
    smtpPassword: settings.smtpPassword ? "••••••••" : "",
    spotifyClientSecret: settings.spotifyClientSecret ? "••••••••" : "",
    geniusClientSecret: settings.geniusClientSecret ? "••••••••" : "",
    geniusAccessToken: settings.geniusAccessToken ? "••••••••" : "",
    // Never send live Discord credentials in GET — reveal after password.
    discordClientId: settings.discordClientId ? "••••••••" : "",
    discordClientSecret: settings.discordClientSecret ? "••••••••" : "",
    smtpConfigured: smtpConfigured(settings),
    discordWebhookUrl: "",
    discordWebhookConfigured: Boolean(settings.discordWebhookUrl.trim()),
    spotifyConfigured: Boolean(
      settings.spotifyClientId.trim() && settings.spotifyClientSecret.trim(),
    ),
    geniusConfigured: Boolean(settings.geniusAccessToken.trim()),
    discordOAuthConfigured: Boolean(
      settings.discordClientId.trim() && settings.discordClientSecret.trim(),
    ),
    discordPresenceConfigured: Boolean(settings.discordClientId.trim()),
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
    detectedMusicRoots: await detectMusicRoots(),
  });
}

const bodySchema = z.object({
  serverName: z.string().min(1).max(80).optional(),
  lidarrUrl: z.string().url().or(z.literal("")).optional(),
  lidarrApiKey: z.string().optional(),
  saveOnPlay: z.boolean().optional(),
  libraryScanMinutes: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(60)]).optional(),
  musicRoot: z.string().optional(),
  fallbackEnabled: z.boolean().optional(),
  downloadQuality: z
    .enum(DOWNLOAD_QUALITIES.map((q) => q.id) as [string, ...string[]])
    .optional(),
  publicUrl: z.string().optional(),
  testLidarr: z.boolean().optional(),
  testDiscord: z.boolean().optional(),
  testSmtp: z.boolean().optional(),
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
  spotifyClientId: z.string().max(120).optional(),
  spotifyClientSecret: z.string().max(120).optional(),
  geniusClientId: z.string().max(120).optional(),
  geniusClientSecret: z.string().max(120).optional(),
  geniusAccessToken: z.string().max(200).optional(),
  testGenius: z.boolean().optional(),
  discordClientId: z.string().max(120).optional(),
  discordClientSecret: z.string().max(120).optional(),
  /** Confirm account password and return live Discord secrets for admin UI. */
  revealDiscordSecrets: z.boolean().optional(),
  password: z.string().max(128).optional(),
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
    body.saveOnPlay !== undefined ||
    body.libraryScanMinutes !== undefined ||
    body.musicRoot !== undefined ||
    body.spotifyClientId !== undefined ||
    body.spotifyClientSecret !== undefined ||
    body.geniusClientId !== undefined ||
    body.geniusClientSecret !== undefined ||
    body.geniusAccessToken !== undefined ||
    body.testGenius ||
    body.discordClientId !== undefined ||
    body.discordClientSecret !== undefined;
  const touchesServer =
    body.serverName !== undefined ||
    body.publicUrl !== undefined ||
    body.downloadQuality !== undefined;
  const touchesSmtp =
    body.smtpHost !== undefined ||
    body.smtpPort !== undefined ||
    body.smtpUser !== undefined ||
    body.smtpPassword !== undefined ||
    body.smtpFrom !== undefined ||
    body.smtpSecure !== undefined;
  const touchesNotify =
    body.testDiscord ||
    body.testSmtp ||
    body.revealDiscordSecrets ||
    body.notifyEmailEnabled !== undefined ||
    body.notifyDiscordEnabled !== undefined ||
    body.discordWebhookUrl !== undefined ||
    body.notifyEmailEvents !== undefined ||
    body.notifyDiscordEvents !== undefined;

  if (touchesLidarr || touchesSmtp || touchesNotify || touchesServer) {
    const admin = await getAdminUser();
    if (!admin) return json({ error: "Admin only" }, { status: 403 });
  }

  if (body.revealDiscordSecrets) {
    const password = (body.password || "").trim();
    if (!password) {
      return json({ error: "Password is required" }, { status: 400 });
    }
    const admin = await getAdminUser();
    if (!admin) return json({ error: "Admin only" }, { status: 403 });
    if (!verifyUserPassword(admin.id, password)) {
      return json({ error: "Incorrect password" }, { status: 403 });
    }
    const s = getSettings();
    return json({
      ok: true,
      secrets: {
        discordClientId: s.discordClientId,
        discordClientSecret: s.discordClientSecret,
        discordWebhookUrl: s.discordWebhookUrl,
      },
    });
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

  if (body.testGenius) {
    // Persist any new token fields first so the probe uses them.
    updateSettings({
      geniusClientId: body.geniusClientId ?? current.geniusClientId,
      geniusClientSecret:
        body.geniusClientSecret && body.geniusClientSecret !== "••••••••"
          ? body.geniusClientSecret
          : current.geniusClientSecret,
      geniusAccessToken:
        body.geniusAccessToken && body.geniusAccessToken !== "••••••••"
          ? body.geniusAccessToken
          : current.geniusAccessToken,
    });
    const result = await probeGenius();
    if (!result.ok) {
      return json(
        { ok: false, error: result.error || "Genius test failed", result },
        { status: 400 },
      );
    }
    return json({ ok: true, result });
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

  if (body.testSmtp) {
    const host = (body.smtpHost ?? current.smtpHost).trim();
    const from = (body.smtpFrom ?? current.smtpFrom).trim();
    const port = body.smtpPort ?? current.smtpPort;
    if (!host || !from || !(port > 0)) {
      return json(
        { error: "Enter host, port, and from address before testing SMTP" },
        { status: 400 },
      );
    }
    const owner = getServerOwnerContact();
    if (!owner) {
      return json(
        {
          error:
            "Server Owner has no email on file. Set an email on the owner account first.",
        },
        { status: 400 },
      );
    }
    const probeSettings = {
      ...current,
      smtpHost: body.smtpHost ?? current.smtpHost,
      smtpPort: body.smtpPort ?? current.smtpPort,
      smtpUser: body.smtpUser ?? current.smtpUser,
      smtpPassword:
        body.smtpPassword && body.smtpPassword !== "••••••••"
          ? body.smtpPassword
          : current.smtpPassword,
      smtpFrom: body.smtpFrom ?? current.smtpFrom,
      smtpSecure: body.smtpSecure ?? current.smtpSecure,
    };
    if (!smtpConfigured(probeSettings)) {
      return json({ error: "SMTP is not fully configured" }, { status: 400 });
    }
    try {
      const result = await sendSmtpTestEmail({
        to: owner.email,
        recipientName: owner.username,
        settings: probeSettings,
      });
      return json({ ok: true, to: result.to });
    } catch (err) {
      return json(
        {
          ok: false,
          error: err instanceof Error ? err.message : "SMTP test failed",
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

  let nextPublicUrl = body.publicUrl ?? current.publicUrl;
  if (body.publicUrl !== undefined) {
    const raw = body.publicUrl.trim();
    if (!raw) {
      nextPublicUrl = "";
    } else {
      const normalized = normalizePublicBaseUrl(raw);
      if (!normalized) {
        return json(
          {
            error:
              "Public URL must be a reachable http(s) address — not 0.0.0.0, ::, or blank",
          },
          { status: 400 },
        );
      }
      nextPublicUrl = normalized;
    }
  }

  const next = updateSettings({
    serverName: body.serverName ?? current.serverName,
    lidarrUrl: body.lidarrUrl ?? current.lidarrUrl,
    lidarrApiKey:
      body.lidarrApiKey && body.lidarrApiKey !== "••••••••"
        ? body.lidarrApiKey
        : current.lidarrApiKey,
    saveOnPlay: body.saveOnPlay ?? current.saveOnPlay,
    libraryScanMinutes:
      body.libraryScanMinutes ?? current.libraryScanMinutes,
    musicRoot: (() => {
      if (body.musicRoot === undefined) return current.musicRoot;
      return persistMusicRoot(body.musicRoot);
    })(),
    fallbackEnabled: true,
    downloadQuality:
      (body.downloadQuality as typeof current.downloadQuality | undefined) ??
      current.downloadQuality,
    publicUrl: nextPublicUrl,
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
    spotifyClientId: body.spotifyClientId ?? current.spotifyClientId,
    spotifyClientSecret:
      body.spotifyClientSecret && body.spotifyClientSecret !== "••••••••"
        ? body.spotifyClientSecret
        : current.spotifyClientSecret,
    geniusClientId: body.geniusClientId ?? current.geniusClientId,
    geniusClientSecret:
      body.geniusClientSecret && body.geniusClientSecret !== "••••••••"
        ? body.geniusClientSecret
        : current.geniusClientSecret,
    geniusAccessToken:
      body.geniusAccessToken && body.geniusAccessToken !== "••••••••"
        ? body.geniusAccessToken
        : current.geniusAccessToken,
    discordClientId:
      body.discordClientId !== undefined
        ? body.discordClientId && body.discordClientId !== "••••••••"
          ? body.discordClientId
          : current.discordClientId
        : current.discordClientId,
    discordClientSecret:
      body.discordClientSecret && body.discordClientSecret !== "••••••••"
        ? body.discordClientSecret
        : current.discordClientSecret,
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
