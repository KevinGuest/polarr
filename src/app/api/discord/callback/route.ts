import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api";
import {
  discordOAuthConfigured,
  getSettings,
  setDiscordLink,
} from "@/lib/db";
import {
  getDiscordRedirectUri,
  oauthStateCookieName,
} from "@/app/api/discord/oauth/route";
import { resolvePublicBaseUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  const settings = getSettings();
  const publicBase =
    resolvePublicBaseUrl(settings, req) || "http://localhost:3000";

  const go = (q: string) =>
    NextResponse.redirect(`${publicBase}/settings?tab=discord&${q}`);

  if (err) return go("discord=denied");
  if (!code || !state) return go("discord=missing");

  const user = await getAuthUser();
  if (!user) return go("discord=auth");

  if (!discordOAuthConfigured(settings)) return go("discord=config");

  const cookieStore = await cookies();
  const raw = cookieStore.get(oauthStateCookieName())?.value || "";
  cookieStore.delete(oauthStateCookieName());
  const expected = `${user.id}:${state}`;
  if (!raw || raw !== expected) return go("discord=state");

  const body = new URLSearchParams({
    client_id: settings.discordClientId.trim(),
    client_secret: settings.discordClientSecret.trim(),
    grant_type: "authorization_code",
    code,
    redirect_uri: getDiscordRedirectUri(),
  });

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!tokenRes.ok) return go("discord=token");

  const token = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!token.access_token) return go("discord=token");

  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${token.access_token}` },
    cache: "no-store",
  });
  if (!meRes.ok) return go("discord=user");
  const me = (await meRes.json()) as {
    id?: string;
    username?: string;
    global_name?: string | null;
  };
  if (!me.id) return go("discord=user");

  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000).toISOString()
    : null;

  setDiscordLink(user.id, {
    discordId: me.id,
    discordUsername: (me.global_name || me.username || "Discord").trim(),
    accessToken: token.access_token,
    refreshToken: token.refresh_token || null,
    expiresAt,
  });

  return go("discord=linked");
}
