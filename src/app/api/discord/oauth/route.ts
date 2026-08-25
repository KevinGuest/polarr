import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getAuthUser, json } from "@/lib/api";
import {
  clearDiscordLink,
  discordOAuthConfigured,
  getSettings,
} from "@/lib/db";
import { resolvePublicBaseUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

const OAUTH_STATE_COOKIE = "polarr_discord_oauth";

function redirectUri(): string {
  const s = getSettings();
  const base = resolvePublicBaseUrl(s);
  if (base) return `${base}/api/discord/callback`;
  return "http://localhost:3000/api/discord/callback";
}

export function getDiscordRedirectUri() {
  return redirectUri();
}

export function oauthStateCookieName() {
  return OAUTH_STATE_COOKIE;
}

/** Start Discord OAuth (identify). */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const settings = getSettings();
  if (!discordOAuthConfigured(settings)) {
    return json(
      {
        error:
          "Discord linking isn’t configured. Ask an admin to add a Discord Application Client ID & Secret.",
      },
      { status: 400 },
    );
  }

  const state = randomBytes(16).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE, `${user.id}:${state}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const params = new URLSearchParams({
    client_id: settings.discordClientId.trim(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "identify",
    state,
    prompt: "consent",
  });

  return json({
    url: `https://discord.com/api/oauth2/authorize?${params.toString()}`,
    redirectUri: redirectUri(),
  });
}

/** Unlink Discord. */
export async function DELETE() {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });
  clearDiscordLink(user.id);
  return json({ ok: true });
}
