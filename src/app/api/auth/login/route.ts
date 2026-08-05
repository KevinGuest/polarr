import { z } from "zod";
import { cookies } from "next/headers";
import { json } from "@/lib/api";
import { authenticate } from "@/lib/db";

export const dynamic = "force-dynamic";

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return json({ error: "Invalid credentials payload" }, { status: 400 });
  }
  const result = authenticate(parsed.data.username, parsed.data.password);
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
