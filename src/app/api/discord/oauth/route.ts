import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getAuthUser, json } from "@/lib/api";
import {
  clearDiscordLink,
  discordOAuthConfigured,
  getSettings,
} from "@/lib/db";
import {
  getDiscordRedirectUri,
  oauthStateCookieName,
} from "@/lib/discord-oauth";

export const dynamic = "force-dynamic";

/** Start Discord OAuth for account identity. Rich Presence uses desktop IPC. */
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
  // link:<userId>:<state> — callback distinguishes from login:<state>
  cookieStore.set(oauthStateCookieName(), `link:${user.id}:${state}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const params = new URLSearchParams({
    client_id: settings.discordClientId.trim(),
    redirect_uri: getDiscordRedirectUri(),
    response_type: "code",
    // rpc.activities.write is restricted to Discord's local RPC authorization
    // flow and requires Discord approval. Requesting it through this normal web
    // callback breaks account linking for unapproved applications.
    scope: "identify",
    state,
    prompt: "consent",
  });

  return json({
    url: `https://discord.com/api/oauth2/authorize?${params.toString()}`,
    redirectUri: getDiscordRedirectUri(),
  });
}

/** Unlink Discord. */
export async function DELETE() {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });
  clearDiscordLink(user.id);
  return json({ ok: true });
}
