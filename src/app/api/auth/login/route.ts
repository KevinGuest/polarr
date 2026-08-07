import { z } from "zod";
import { cookies } from "next/headers";
import { json } from "@/lib/api";
import { authenticate } from "@/lib/db";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-password";
import { getRequestIp, normalizeHwid } from "@/lib/request-client";

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
  const ip = await getRequestIp();
  const hwid = normalizeHwid(parsed.data.hwid);
  const result = authenticate(parsed.data.username, parsed.data.password, {
    ip,
    hwid,
  });
  if (!result) {
    return json({ error: "Invalid username or password" }, { status: 401 });
  }
  const cookieStore = await cookies();
  cookieStore.set("polarr_token", result.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return json({ token: result.token, user: result.user });
}
