import { z } from "zod";
import { cookies } from "next/headers";
import { json } from "@/lib/api";
import {
  enforceAuthRateLimit,
  recordAuthRateFailure,
  recordAuthRateSuccess,
} from "@/lib/auth-rate-limit";
import { authenticate, redeemInvite } from "@/lib/db";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-password";
import { getRequestIpFromRequest, normalizeHwid } from "@/lib/request-client";
import { sessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/session-cookie";
import { requestSessionUserAgent } from "@/lib/user-agent";

export const dynamic = "force-dynamic";

const schema = z.object({
  code: z.string().min(4).max(64).trim(),
  username: z.string().min(1).max(40).trim(),
  password: z
    .string()
    .min(
      MIN_PASSWORD_LENGTH,
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    )
    .max(128),
  confirmPassword: z.string().min(1).max(128),
  hwid: z.string().max(128).optional(),
});

export async function POST(req: Request) {
  const limited = enforceAuthRateLimit(req, "join");
  if (limited) return limited;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    recordAuthRateFailure(req, "join");
    const first = parsed.error.issues[0]?.message;
    return json({ error: first || "Invalid join details" }, { status: 400 });
  }

  const { code, username, password, confirmPassword } = parsed.data;
  if (password !== confirmPassword) {
    recordAuthRateFailure(req, "join");
    return json({ error: "Passwords do not match" }, { status: 400 });
  }

  try {
    const ip = getRequestIpFromRequest(req);
    const hwid = normalizeHwid(parsed.data.hwid);
    const user = redeemInvite(code, username, password, { ip, hwid });
    const session = authenticate(username, password, {
      ip,
      hwid,
      userAgent: requestSessionUserAgent(req),
    });
    if (!session || "banned" in session) {
      recordAuthRateFailure(req, "join");
      return json(
        { error: "Account created but sign-in failed" },
        { status: 500 },
      );
    }

    recordAuthRateSuccess(req, "join");

    const cookieStore = await cookies();
    cookieStore.set(
      SESSION_COOKIE_NAME,
      session.token,
      await sessionCookieOptions(),
    );

    return json({
      token: session.token,
      user,
    });
  } catch (err) {
    recordAuthRateFailure(req, "join");
    const message = err instanceof Error ? err.message : "Join failed";
    const status =
      message.includes("UNIQUE") || message.toLowerCase().includes("unique")
        ? 409
        : 400;
    return json(
      {
        error: message.includes("UNIQUE")
          ? "Username already taken"
          : message,
      },
      { status },
    );
  }
}
