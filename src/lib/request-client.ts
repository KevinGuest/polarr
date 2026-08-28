import { headers } from "next/headers";

/**
 * Best-effort client IP. Prefer Cloudflare's connecting IP when present —
 * behind CF, X-Forwarded-For is often the edge/proxy hop, not the visitor.
 *
 * Prefer `getRequestIpFromRequest(req)` in Route Handlers — Next can omit
 * hop-by-hop headers from `headers()`.
 */
export async function getRequestIp(): Promise<string | null> {
  const h = await headers();
  return getRequestIpFromHeaders(h);
}

/** Sync IP for Route Handlers / middleware (no async headers()). */
export function getRequestIpFromRequest(req: Request): string | null {
  return getRequestIpFromHeaders(req.headers);
}

function cleanIp(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith("for=")) s = s.slice(4).trim();
  s = s.replace(/^"|"$/g, "").replace(/^\[|\]$/g, "").trim();
  if (!s || s.toLowerCase() === "unknown" || s === "null") return null;
  // IPv4 with port
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(s)) {
    s = s.replace(/:\d+$/, "");
  }
  return s.slice(0, 64) || null;
}

function firstForwardedFor(value: string): string | null {
  for (const part of value.split(",")) {
    const ip = cleanIp(part);
    if (ip) return ip;
  }
  return null;
}

function fromForwardedHeader(value: string): string | null {
  // RFC 7239: Forwarded: for=1.2.3.4;proto=https, for="[2001:db8::1]"
  for (const hop of value.split(",")) {
    const m = /(?:^|;)\s*for\s*=\s*([^;]+)/i.exec(hop);
    if (!m?.[1]) continue;
    const ip = cleanIp(m[1]);
    if (ip) return ip;
  }
  return null;
}

function getRequestIpFromHeaders(h: Headers): string | null {
  const cf = cleanIp(h.get("cf-connecting-ip") || "");
  if (cf) return cf;
  const trueClient = cleanIp(h.get("true-client-ip") || "");
  if (trueClient) return trueClient;
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const pick = firstForwardedFor(forwarded);
    if (pick) return pick;
  }
  const rfc = h.get("forwarded");
  if (rfc) {
    const pick = fromForwardedHeader(rfc);
    if (pick) return pick;
  }
  const real = cleanIp(h.get("x-real-ip") || "");
  if (real) return real;
  const fly = cleanIp(h.get("fly-client-ip") || "");
  if (fly) return fly;
  const client = cleanIp(h.get("x-client-ip") || "");
  if (client) return client;
  return null;
}

/** Discord / admin display — always a field, never a blank omit. */
export function formatClientIp(ip: string | null | undefined): string {
  return (ip || "").trim() || "unknown";
}

export function normalizeHwid(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v.length < 8 || v.length > 128) return null;
  if (!/^[a-zA-Z0-9._:-]+$/.test(v)) return null;
  return v;
}
