import { z } from "zod";
import { cookies } from "next/headers";
import { json } from "@/lib/api";
import { authenticate } from "@/lib/db";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-password";
import { getRequestIpFromRequest, normalizeHwid } from "@/lib/request-client";
import {
  loginBlockedForMs,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/login-rate-limit";
import { sessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";

const schema = z.object({
  username: z.string().min(1).max(40).trim(),
  password: z.string().min(1).max(128),
  hwid: z.string().max(128).optional(),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Enter a username and password" }, { status: 400 });
  }
  if (parsed.data.password.length < MIN_PASSWORD_LENGTH) {
    return json(
      {
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      },
      { status: 400 },
    );
  }
  const ip = getRequestIpFromRequest(req);

  const waitMs = loginBlockedForMs(ip, parsed.data.username);
  if (waitMs > 0) {
    const seconds = Math.ceil(waitMs / 1000);
    return json(
      { error: `Too many attempts. Try again in ${seconds}s.` },
      { status: 429, headers: { "Retry-After": String(seconds) } },
    );
  }

  const hwid = normalizeHwid(parsed.data.hwid);
  const result = authenticate(parsed.data.username, parsed.data.password, {
    ip,
    hwid,
    userAgent: req.headers.get("user-agent"),
  });
  if (!result) {
    recordLoginFailure(ip, parsed.data.username);
    return json({ error: "Invalid username or password" }, { status: 401 });
  }
  if ("banned" in result && result.banned) {
    return json(
      {
        error: result.banMessage,
        banned: true,
        expiresAt: result.expiresAt,
        permanent: result.permanent,
      },
      { status: 403 },
    );
  }
  recordLoginSuccess(ip, parsed.data.username);
  const cookieStore = await cookies();
  cookieStore.set(
    SESSION_COOKIE_NAME,
    result.token,
    await sessionCookieOptions(),
  );
  const { notifyDiscord, notifyIpField, notifyRequestPlatformFields } =
    await import("@/lib/admin-notify");
  notifyDiscord("userLogin", {
    title: "User signed in",
    description: `${result.user.username} signed in`,
    fields: [
      { name: "User", value: result.user.username, inline: true },
      { name: "Method", value: "password", inline: true },
      notifyIpField(ip),
      ...notifyRequestPlatformFields(req),
    ],
  });
  return json({ token: result.token, user: result.user });
}
