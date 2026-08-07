import { headers } from "next/headers";

/** Best-effort client IP from proxy headers or the connection. */
export async function getRequestIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = h.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf) return cf.slice(0, 64);
  return null;
}

export function normalizeHwid(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v.length < 8 || v.length > 128) return null;
  if (!/^[a-zA-Z0-9._:-]+$/.test(v)) return null;
  return v;
}
