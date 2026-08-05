import { json, getAuthUser } from "@/lib/api";
import { buildMadeForMixes } from "@/lib/made-for";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return json({ error: "Sign in required" }, { status: 401 });
  }
  const payload = buildMadeForMixes(user.id, user.username);
  return json(payload);
}
