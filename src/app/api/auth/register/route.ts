import { z } from "zod";
import { cookies } from "next/headers";
import { json } from "@/lib/api";
import { authenticate, createAdminUser, hasUsers } from "@/lib/db";

export const dynamic = "force-dynamic";

const schema = z.object({
  username: z.string().min(1).max(40).trim(),
  password: z.string().min(8).max(128),
  confirmPassword: z.string().min(8).max(128),
});

/**
 * Immich-style first run: the first account becomes admin and completes setup.
 * Rejected once any user exists.
 */
export async function POST(req: Request) {
  if (hasUsers()) {
    return json(
      { error: "Admin account already exists. Sign in instead." },
      { status: 409 },
    );
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return json({ error: "Invalid registration details" }, { status: 400 });
  }

  const { username, password, confirmPassword } = parsed.data;
  if (password !== confirmPassword) {
    return json({ error: "Passwords do not match" }, { status: 400 });
  }

  try {
    const user = createAdminUser(username, password);
    const session = authenticate(username, password);
    if (!session) {
      return json({ error: "Account created but sign-in failed" }, { status: 500 });
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
      user: { ...user, isAdmin: true },
    });
  } catch (err) {
    return json(
      {
        error: err instanceof Error ? err.message : "Registration failed",
      },
      { status: 400 },
    );
  }
}
