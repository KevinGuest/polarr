import { z } from "zod";
import { cookies } from "next/headers";
import { json } from "@/lib/api";
import { authenticate, redeemInvite } from "@/lib/db";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-password";
import { getRequestIp, normalizeHwid } from "@/lib/request-client";

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
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message;
    return json({ error: first || "Invalid join details" }, { status: 400 });
  }

  const { code, username, password, confirmPassword } = parsed.data;
  if (password !== confirmPassword) {
    return json({ error: "Passwords do not match" }, { status: 400 });
  }

  try {
    const user = redeemInvite(code, username, password);
    const ip = await getRequestIp();
    const hwid = normalizeHwid(parsed.data.hwid);
    const session = authenticate(username, password, { ip, hwid });
    if (!session) {
      return json(
        { error: "Account created but sign-in failed" },
        { status: 500 },
      );
    }

    const cookieStore = await cookies();
    cookieStore.set("polarr_token", session.token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return json({
      token: session.token,
      user,
    });
  } catch (err) {
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
