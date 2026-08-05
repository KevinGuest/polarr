import { getAuthUser, json } from "@/lib/api";
import { getLiveSession } from "@/lib/live-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Proxy a cached live remote audio URL (range-friendly when origin allows). */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const { id: raw } = await ctx.params;
  const id = raw.startsWith("live:") ? raw.slice(5) : raw;
  const session = getLiveSession(id);
  if (!session) {
    return json({ error: "Live session expired — play again" }, { status: 410 });
  }

  const range = req.headers.get("range");
  const headers: HeadersInit = {
    "User-Agent":
      "Mozilla/5.0 (compatible; Polarr/1.0; +https://github.com/KevinGuest/polarr)",
    Accept: "*/*",
  };
  if (range) headers.Range = range;

  let upstream: Response;
  try {
    upstream = await fetch(session.remoteUrl, { headers });
  } catch {
    return json({ error: "Upstream stream failed" }, { status: 502 });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return json(
      { error: `Upstream returned ${upstream.status}` },
      { status: 502 },
    );
  }

  const out = new Headers();
  const contentType = upstream.headers.get("content-type") || "audio/mp4";
  out.set("Content-Type", contentType);
  out.set("Cache-Control", "private, no-store");
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) out.set("Content-Length", contentLength);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) out.set("Content-Range", contentRange);
  const acceptRanges = upstream.headers.get("accept-ranges");
  if (acceptRanges) out.set("Accept-Ranges", acceptRanges);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: out,
  });
}
