import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { json } from "@/lib/api";
import {
  enforceAuthRateLimit,
  recordAuthRateFailure,
} from "@/lib/auth-rate-limit";
import { discordOAuthConfigured, getSettings } from "@/lib/db";
import {
  getDiscordRedirectUri,
  oauthStateCookieName,
} from "@/lib/discord-oauth";

export const dynamic = "force-dynamic";

/**
 * Start Discord OAuth for sign-in (no Polarr session required).
 * Only succeeds in the callback if this Discord account is already linked.
 */
export async function GET(req: Request) {
  const limited = enforceAuthRateLimit(req, "discord-login");
  if (limited) return limited;

  const settings = getSettings();
  if (!discordOAuthConfigured(settings)) {
    recordAuthRateFailure(req, "discord-login");
    return json(
      {
        error: "Discord sign-in isn’t configured on this server.",
        available: false,
      },
      { status: 400 },
    );
  }

  const state = randomBytes(16).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set(oauthStateCookieName(), `login:${state}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const redirectUri = getDiscordRedirectUri();
  const params = new URLSearchParams({
    client_id: settings.discordClientId.trim(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify",
    state,
    prompt: "consent",
  });

  return json({
    available: true,
    url: `https://discord.com/api/oauth2/authorize?${params.toString()}`,
    redirectUri,
  });
}
