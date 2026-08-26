import { headers } from "next/headers";

/**
 * Best-effort client IP. Prefer Cloudflare's connecting IP when present —
 * behind CF, X-Forwarded-For is often the edge/proxy hop, not the visitor.
 */
export async function getRequestIp(): Promise<string | null> {
  const h = await headers();
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf) return cf.slice(0, 64);
  const trueClient = h.get("true-client-ip")?.trim();
  if (trueClient) return trueClient.slice(0, 64);
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    // Rightmost public-ish hop is often the client when proxies append left→right;
    // take the first non-empty entry (typical when CF/nginx put the visitor first).
    const parts = forwarded
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const pick = parts[0];
    if (pick) return pick.slice(0, 64);
  }
  const real = h.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  return null;
}

export function normalizeHwid(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v.length < 8 || v.length > 128) return null;
  if (!/^[a-zA-Z0-9._:-]+$/.test(v)) return null;
  return v;
}
