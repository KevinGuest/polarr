import { z } from "zod";
import { json } from "@/lib/api";
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
  const token = new URL(req.url).searchParams.get("token") || "";
  return json({ valid: passwordResetTokenValid(token) });
}

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Enter a new password" }, { status: 400 });
  }
  if (parsed.data.password !== parsed.data.confirmPassword) {
    return json({ error: "Passwords do not match" }, { status: 400 });
  }

  const userId = consumePasswordResetToken(parsed.data.token);
  if (!userId) {
    return json(
      { error: "This reset link is invalid or has expired" },
      { status: 400 },
    );
  }

  const result = setUserPassword(userId, parsed.data.password);
  if (!result.ok) {
    return json({ error: result.error }, { status: 400 });
  }

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
