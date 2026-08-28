import { z } from "zod";
import { cookies } from "next/headers";
import { json } from "@/lib/api";
import {
  enforceAuthRateLimit,
  recordAuthRateFailure,
  recordAuthRateSuccess,
} from "@/lib/auth-rate-limit";
import { authenticate, createAdminUser, hasUsers } from "@/lib/db";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-password";
import { getRequestIpFromRequest, normalizeHwid } from "@/lib/request-client";
import { sessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";

const schema = z.object({
  username: z.string().min(1).max(40).trim(),
  email: z.string().email("Enter a valid email").max(255),
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

/**
 * Immich-style first run: the first account becomes admin and completes setup.
 * Rejected once any user exists.
 */
export async function POST(req: Request) {
  const limited = enforceAuthRateLimit(req, "register");
  if (limited) return limited;

  if (hasUsers()) {
    recordAuthRateFailure(req, "register");
    return json(
      { error: "Admin account already exists. Sign in instead." },
      { status: 409 },
    );
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    recordAuthRateFailure(req, "register");
    const first = parsed.error.issues[0]?.message;
    return json(
      { error: first || "Invalid registration details" },
      { status: 400 },
    );
  }

  const { username, email, password, confirmPassword } = parsed.data;
  if (password !== confirmPassword) {
    recordAuthRateFailure(req, "register");
    return json({ error: "Passwords do not match" }, { status: 400 });
  }

  try {
    const user = createAdminUser(username, password, email);
    const ip = getRequestIpFromRequest(req);
    const hwid = normalizeHwid(parsed.data.hwid);
    const session = authenticate(username, password, { ip, hwid });
    if (!session || "banned" in session) {
      recordAuthRateFailure(req, "register");
      return json(
        { error: "Account created but sign-in failed" },
        { status: 500 },
      );
    }

    recordAuthRateSuccess(req, "register");

    const cookieStore = await cookies();
    cookieStore.set(
      SESSION_COOKIE_NAME,
      session.token,
      await sessionCookieOptions(),
    );

  return json({
      token: session.token,
      user: { ...user, isAdmin: true, role: "owner" },
      next: "lidarr",
  });
  } catch (err) {
    recordAuthRateFailure(req, "register");
    return json(
      {
        error: err instanceof Error ? err.message : "Registration failed",
      },
      { status: 400 },
    );
  }
}
