import { z } from "zod";
import { json } from "@/lib/api";
import {
  enforceAuthRateLimit,
  recordAuthRateFailure,
  recordAuthRateSuccess,
} from "@/lib/auth-rate-limit";
import {
  consumePasswordResetToken,
  getDb,
  passwordResetTokenValid,
  setUserPassword,
} from "@/lib/db";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-password";

export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().min(32).max(128),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(128),
  confirmPassword: z.string().min(MIN_PASSWORD_LENGTH).max(128),
});

export async function GET(req: Request) {
  const limited = enforceAuthRateLimit(req, "reset");
  if (limited) return limited;

  const token = new URL(req.url).searchParams.get("token") || "";
  const valid = passwordResetTokenValid(token);
  if (!valid) recordAuthRateFailure(req, "reset");
  else recordAuthRateSuccess(req, "reset");
  return json({ valid });
}

export async function POST(req: Request) {
  const limited = enforceAuthRateLimit(req, "reset");
  if (limited) return limited;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    recordAuthRateFailure(req, "reset");
    return json({ error: "Enter a new password" }, { status: 400 });
  }
  if (parsed.data.password !== parsed.data.confirmPassword) {
    recordAuthRateFailure(req, "reset");
    return json({ error: "Passwords do not match" }, { status: 400 });
  }

  const userId = consumePasswordResetToken(parsed.data.token);
  if (!userId) {
    recordAuthRateFailure(req, "reset");
    return json(
      { error: "This reset link is invalid or has expired" },
      { status: 400 },
    );
  }

  const result = setUserPassword(userId, parsed.data.password);
  if (!result.ok) {
    recordAuthRateFailure(req, "reset");
    return json({ error: result.error }, { status: 400 });
  }

  recordAuthRateSuccess(req, "reset");

  const username =
    (
      getDb()
        .prepare(`SELECT username FROM users WHERE id = ?`)
        .get(userId) as { username: string } | undefined
    )?.username || "user";
  const { notifyDiscord } = await import("@/lib/admin-notify");
  notifyDiscord("passwordResetCompleted", {
    title: "Password changed",
    description: `${username} set a new password via reset link`,
    fields: [{ name: "User", value: username, inline: true }],
  });

  return json({ ok: true });
}
