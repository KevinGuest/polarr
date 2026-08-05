import { cookies } from "next/headers";
import { json, getAuthUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return json({ user: null }, { status: 401 });
  return json({ user });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete("polarr_token");
  return json({ ok: true });
}
