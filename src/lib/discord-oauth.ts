import { getSettings } from "@/lib/db";
import { resolvePublicBaseUrl } from "@/lib/public-url";

const OAUTH_STATE_COOKIE = "polarr_discord_oauth";

export function getDiscordRedirectUri(): string {
  const settings = getSettings();
  const base = resolvePublicBaseUrl(settings);
  if (base) return `${base}/api/discord/callback`;
  return "http://localhost:3000/api/discord/callback";
}

export function oauthStateCookieName(): string {
  return OAUTH_STATE_COOKIE;
}
