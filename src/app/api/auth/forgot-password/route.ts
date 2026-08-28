import { z } from "zod";
import { json } from "@/lib/api";
import {
  createPasswordResetToken,
  findUserForPasswordReset,
  getSettings,
  smtpConfigured,
} from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/password-reset-email";
import { resolvePublicBaseUrl } from "@/lib/public-url";
import { getRequestIpFromRequest } from "@/lib/request-client";
import {
  loginBlockedForMs,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/login-rate-limit";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email().max(255).trim().toLowerCase(),
});

const OK_MSG =
  "If an account with that email exists, we sent a reset link.";

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Enter a valid email address" }, { status: 400 });
  }

  const settings = getSettings();
  if (!smtpConfigured(settings)) {
    return json(
      {
        error:
          "Password reset email isn’t available — ask an admin to configure SMTP, or reset your password for you.",
      },
      { status: 503 },
    );
  }

  const ip = getRequestIpFromRequest(req);
  const waitMs = loginBlockedForMs(ip, `forgot:${parsed.data.email}`);
  if (waitMs > 0) {
    const seconds = Math.ceil(waitMs / 1000);
    return json(
      { error: `Too many attempts. Try again in ${seconds}s.` },
      { status: 429, headers: { "Retry-After": String(seconds) } },
    );
  }

  const user = findUserForPasswordReset(parsed.data.email);
  if (!user) {
    // Same response — don’t leak whether the account exists
    recordLoginFailure(ip, `forgot:${parsed.data.email}`);
    return json({ ok: true, message: OK_MSG });
  }

  const base =
    resolvePublicBaseUrl(settings, req) || "http://localhost:3000";
  try {
    const token = createPasswordResetToken(user.id);
    await sendPasswordResetEmail({
      to: user.email,
      username: user.username,
      resetUrl: `${base}/reset-password?token=${encodeURIComponent(token)}`,
    });
    recordLoginSuccess(ip, `forgot:${parsed.data.email}`);
    const { notifyDiscord, notifyIpField } = await import("@/lib/admin-notify");
    notifyDiscord("passwordResetRequested", {
      title: "Password reset requested",
      description: `${user.username} requested a password reset`,
      fields: [
        { name: "User", value: user.username, inline: true },
        { name: "Email", value: user.email, inline: true },
        notifyIpField(ip),
      ],
    });
  } catch (err) {
    recordLoginFailure(ip, `forgot:${parsed.data.email}`);
    return json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Couldn’t send the reset email",
      },
      { status: 502 },
    );
  }

  return json({ ok: true, message: OK_MSG });
}
