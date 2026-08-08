import { getSettings, type Settings } from "@/lib/db";

const DISCORD_WEBHOOK_RE =
  /^https:\/\/((canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/i;

export function isDiscordWebhookUrl(url: string) {
  return DISCORD_WEBHOOK_RE.test(url.trim());
}

export function discordConfigured(settings?: Settings) {
  const s = settings ?? getSettings();
  // Webhook URL alone is enough — enable flag auto-follows a successful save.
  return Boolean(isDiscordWebhookUrl(s.discordWebhookUrl));
}

/** Public fallback so Discord can fetch the icon without a configured Public URL. */
const DEFAULT_AVATAR_URL =
  "https://raw.githubusercontent.com/KevinGuest/polarr/main/public/polarr-icon.png";

function avatarUrl(settings: Settings) {
  const base = settings.publicUrl.trim().replace(/\/$/, "");
  if (base) return `${base}/polarr-icon.png`;
  return DEFAULT_AVATAR_URL;
}

export async function sendDiscordWebhook(input: {
  content?: string;
  embeds?: Record<string, unknown>[];
  webhookUrl?: string;
}) {
  const settings = getSettings();
  const webhook = (input.webhookUrl ?? settings.discordWebhookUrl).trim();
  if (!isDiscordWebhookUrl(webhook)) {
    throw new Error("Invalid Discord webhook URL");
  }

  const body: Record<string, unknown> = {
    username: "Polarr",
    avatar_url: avatarUrl(settings),
    allowed_mentions: { parse: [] },
  };
  if (input.content) body.content = input.content;
  if (input.embeds?.length) body.embeds = input.embeds;

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      text
        ? `Discord webhook failed (${res.status}): ${text.slice(0, 160)}`
        : `Discord webhook failed (${res.status})`,
    );
  }
}

export async function sendDiscordTest(webhookUrl?: string) {
  const settings = getSettings();
  await sendDiscordWebhook({
    webhookUrl,
    content: `Notifications are connected for **${settings.serverName || "Polarr"}**.`,
  });
}
