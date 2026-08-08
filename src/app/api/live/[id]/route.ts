import { getAuthUserFromRequest, json } from "@/lib/api";
import { getLiveSession, serveLiveSession } from "@/lib/live-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Proxy a cached live remote audio URL (range-friendly when origin allows). */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  // Read cookie from the Request directly — avoids Next cookies()/headers() await cost
  const user = getAuthUserFromRequest(req);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const { id: raw } = await ctx.params;
  const id = raw.startsWith("live:") ? raw.slice(5) : raw;
  const session = getLiveSession(id);
  if (!session) {
    return json({ error: "Live session expired — play again" }, { status: 410 });
  }

  return serveLiveSession(session, req);
}
