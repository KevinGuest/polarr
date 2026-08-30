/**
 * Admin Discord webhook alerts for configured notify events.
 * Fire-and-forget — never blocks the request path.
 */

import { discordConfigured, sendDiscordWebhook } from "@/lib/discord";
import { getSettings } from "@/lib/db";
import type { NotifyEventId } from "@/lib/notify-events";
import { resolvePublicBaseUrl } from "@/lib/public-url";
import { describeRequestClient, describeUserAgent } from "@/lib/user-agent";

const COLORS: Partial<Record<NotifyEventId, number>> = {
  requestNew: 0x5865f2,
  downloadStarted: 0xfaa61a,
  requestAvailable: 0x57f287,
  requestFailed: 0xed4245,
  passwordResetRequested: 0xfaa61a,
  passwordResetCompleted: 0x57f287,
  inviteCreated: 0x5865f2,
  inviteUsed: 0x57f287,
  userBanned: 0xed4245,
  userUnbanned: 0x57f287,
  trackAdded: 0x57f287,
  userLogin: 0x5865f2,
  userLogout: 0x99aab5,
  streamError: 0xed4245,
};

export type DiscordNotifyField = {
  name: string;
  value: string;
  inline?: boolean;
};

export function notifyIpField(
  ip: string | null | undefined,
): DiscordNotifyField {
  const value = (ip || "").trim() || "unknown";
  return { name: "IP", value, inline: true };
}

/**
 * Sign-in/out alert fields describing the client: the platform the user
 * connected from, plus a device model when the User-Agent exposes one.
 */
export function notifyPlatformFields(
  ua: string | null | undefined,
): DiscordNotifyField[] {
  const { platform, device } = describeUserAgent(ua);
  const fields: DiscordNotifyField[] = [
    { name: "Platform", value: platform, inline: true },
  ];
  if (device) fields.push({ name: "Device", value: device, inline: true });
  return fields;
}

/** Platform fields that recognize the Polarr desktop shell. */
export function notifyRequestPlatformFields(req: Request): DiscordNotifyField[] {
  const { platform, device } = describeRequestClient(req);
  const fields: DiscordNotifyField[] = [
    { name: "Platform", value: platform, inline: true },
  ];
  if (device) fields.push({ name: "Device", value: device, inline: true });
  return fields;
}

/** Debounce noisy stream errors (Range retries, etc.). */
const streamErrorSeen = new Map<string, number>();
const STREAM_ERROR_TTL_MS = 5 * 60_000;

export function notifyDiscord(
  event: NotifyEventId,
  input: {
    title: string;
    description?: string;
    fields?: DiscordNotifyField[];
    href?: string | null;
  },
): void {
  try {
    const settings = getSettings();
    if (!settings.notifyDiscordEnabled || !discordConfigured(settings)) return;
    if (!settings.notifyDiscordEvents[event]) return;

    const base = resolvePublicBaseUrl(settings);
    const url =
      input.href && base
        ? input.href.startsWith("http")
          ? input.href
          : `${base}${input.href.startsWith("/") ? "" : "/"}${input.href}`
        : undefined;

    const embed: Record<string, unknown> = {
      title: input.title.slice(0, 256),
      color: COLORS[event] ?? 0x5865f2,
      timestamp: new Date().toISOString(),
      footer: { text: settings.serverName.trim() || "Polarr" },
    };
    if (input.description) {
      embed.description = input.description.slice(0, 4000);
    }
    if (input.fields?.length) {
      embed.fields = input.fields.slice(0, 25).map((f) => ({
        name: f.name.slice(0, 256),
        value: f.value.slice(0, 1024),
        inline: Boolean(f.inline),
      }));
    }
    if (url) embed.url = url;

    void sendDiscordWebhook({ embeds: [embed] }).catch(() => {
      /* webhook outage — ignore */
    });
  } catch {
    /* never throw into callers */
  }
}

/** Stream/live errors — at most once per key every 5 minutes. */
export function notifyDiscordStreamError(input: {
  title: string;
  description?: string;
  fields?: DiscordNotifyField[];
  dedupeKey: string;
}): void {
  const now = Date.now();
  const prev = streamErrorSeen.get(input.dedupeKey);
  if (prev && now - prev < STREAM_ERROR_TTL_MS) return;
  streamErrorSeen.set(input.dedupeKey, now);
  if (streamErrorSeen.size > 200) {
    for (const [k, at] of streamErrorSeen) {
      if (now - at > STREAM_ERROR_TTL_MS) streamErrorSeen.delete(k);
    }
  }
  notifyDiscord("streamError", {
    title: input.title,
    description: input.description,
    fields: input.fields,
  });
}
