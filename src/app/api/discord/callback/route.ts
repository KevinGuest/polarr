import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api";
import {
  createSessionForUser,
  discordOAuthConfigured,
  getSettings,
  getUserIdByDiscordId,
  setDiscordLink,
} from "@/lib/db";
import {
  getDiscordRedirectUri,
  oauthStateCookieName,
} from "@/app/api/discord/oauth/route";
import { resolvePublicBaseUrl } from "@/lib/public-url";
import { getRequestIp } from "@/lib/request-client";
import {
  loginBlockedForMs,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/login-rate-limit";
import { sessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";

type DiscordToken = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

type DiscordMe = {
  id?: string;
  username?: string;
  global_name?: string | null;
};

async function exchangeCode(code: string, settings: ReturnType<typeof getSettings>) {
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
  if (!tokenRes.ok) return null;
  const token = (await tokenRes.json()) as DiscordToken;
  if (!token.access_token) return null;

  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${token.access_token}` },
    cache: "no-store",
  });
  if (!meRes.ok) return null;
  const me = (await meRes.json()) as DiscordMe;
  if (!me.id) return null;

  return { token, me };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  const settings = getSettings();
  const publicBase =
    resolvePublicBaseUrl(settings, req) || "http://localhost:3000";

  const goSettings = (q: string) =>
    NextResponse.redirect(`${publicBase}/settings?tab=discord&${q}`);
  const goLogin = (q: string) =>
    NextResponse.redirect(`${publicBase}/login?${q}`);

  const cookieStore = await cookies();
  const raw = cookieStore.get(oauthStateCookieName())?.value || "";
  cookieStore.delete(oauthStateCookieName());

  const isLogin = raw.startsWith("login:");
  const isLink =
    raw.startsWith("link:") ||
    // legacy cookie: `<userId>:<state>`
    (!isLogin && raw.includes(":") && !raw.startsWith("login:"));

  if (err) {
    return isLogin ? goLogin("discord=denied") : goSettings("discord=denied");
  }
  if (!code || !state) {
    return isLogin ? goLogin("discord=missing") : goSettings("discord=missing");
  }
  if (!discordOAuthConfigured(settings)) {
    return isLogin ? goLogin("discord=config") : goSettings("discord=config");
  }

  // ——— Sign in with Discord (already-linked accounts only) ———
  if (isLogin) {
    const expected = `login:${state}`;
    if (!raw || raw !== expected) return goLogin("discord=state");

    const ip = await getRequestIp();
    const waitMs = loginBlockedForMs(ip, "discord");
    if (waitMs > 0) {
      return goLogin("discord=rate");
    }

    const exchanged = await exchangeCode(code, settings);
    if (!exchanged) {
      recordLoginFailure(ip, "discord");
      return goLogin("discord=token");
    }

    const { token, me } = exchanged;
    const userId = getUserIdByDiscordId(me.id!);
    if (!userId) {
      recordLoginFailure(ip, "discord");
      return goLogin("discord=nolink");
    }

    const expiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000).toISOString()
      : null;

    setDiscordLink(userId, {
      discordId: me.id!,
      discordUsername: (me.global_name || me.username || "Discord").trim(),
      accessToken: token.access_token!,
      refreshToken: token.refresh_token || null,
      expiresAt,
    });

    const result = createSessionForUser(userId, { ip });
    if (!result) {
      recordLoginFailure(ip, "discord");
      return goLogin("discord=auth");
    }
    if ("banned" in result && result.banned) {
      return goLogin("discord=banned");
    }

    recordLoginSuccess(ip, "discord");
    cookieStore.set(
      SESSION_COOKIE_NAME,
      result.token,
      await sessionCookieOptions(),
    );
    const { notifyDiscord } = await import("@/lib/admin-notify");
    notifyDiscord("userLogin", {
      title: "User signed in",
      description: `${result.user.username} signed in with Discord`,
      fields: [
        { name: "User", value: result.user.username, inline: true },
        { name: "Method", value: "discord", inline: true },
        ...(ip ? [{ name: "IP", value: ip, inline: true }] : []),
      ],
    });
    return NextResponse.redirect(`${publicBase}/`);
  }

  // ——— Link Discord to signed-in Polarr account ———
  if (!isLink) return goSettings("discord=state");

  const user = await getAuthUser();
  if (!user) return goSettings("discord=auth");

  let expected = `link:${user.id}:${state}`;
  // Accept pre-0.6.13 cookie format `userId:state`
  const legacyExpected = `${user.id}:${state}`;
  if (!raw || (raw !== expected && raw !== legacyExpected)) {
    return goSettings("discord=state");
  }

  const exchanged = await exchangeCode(code, settings);
  if (!exchanged) return goSettings("discord=token");

  const { token, me } = exchanged;
  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000).toISOString()
    : null;

  setDiscordLink(user.id, {
    discordId: me.id!,
    discordUsername: (me.global_name || me.username || "Discord").trim(),
    accessToken: token.access_token!,
    refreshToken: token.refresh_token || null,
    expiresAt,
  });

  return goSettings("discord=linked");
}
