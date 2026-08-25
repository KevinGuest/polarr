import type { Settings } from "@/lib/db";

/** Hostnames that must never appear in emailed / external links. */
export function isUnusablePublicHost(hostname: string): boolean {
  const h = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return !h || h === "0.0.0.0" || h === "::" || h === "[::]";
}

/**
 * Normalize a candidate base URL: trim, strip trailing slash, reject blank /
 * bind-all hosts (0.0.0.0, ::). Accepts full URLs or host[:port] (assumes http).
 */
export function normalizePublicBaseUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return null;

  try {
    const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `http://${trimmed}`;
    const u = new URL(withProto);
    if (isUnusablePublicHost(u.hostname)) return null;
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function headerValue(
  headers: Headers | undefined,
  name: string,
): string {
  if (!headers) return "";
  return (headers.get(name) || "").split(",")[0]?.trim() || "";
}

/** Build origin from proto + host headers when they are usable. */
function originFromHostParts(
  proto: string,
  host: string,
): string | null {
  const h = host.trim();
  if (!h) return null;
  const hostname = h.split(":")[0] || h;
  if (isUnusablePublicHost(hostname.replace(/^\[|\]$/g, ""))) return null;
  const scheme =
    proto === "https" || proto === "http" ? proto : "http";
  return normalizePublicBaseUrl(`${scheme}://${h}`);
}

function originFromRequest(request?: Request | null): string | null {
  if (!request) return null;
  const headers = request.headers;

  const originHdr = headerValue(headers, "origin");
  const fromOrigin = normalizePublicBaseUrl(originHdr);
  if (fromOrigin) return fromOrigin;

  const xfProto = headerValue(headers, "x-forwarded-proto").toLowerCase();
  const xfHost =
    headerValue(headers, "x-forwarded-host") || headerValue(headers, "host");
  const fromForwarded = originFromHostParts(xfProto, xfHost);
  if (fromForwarded) return fromForwarded;

  try {
    return normalizePublicBaseUrl(new URL(request.url).origin);
  } catch {
    return null;
  }
}

/**
 * Public site base for invite emails, OAuth redirects, and absolute asset URLs.
 * Prefer settings.publicUrl; never returns 0.0.0.0 / :: / blank.
 */
export function resolvePublicBaseUrl(
  settings: Pick<Settings, "publicUrl"> | { publicUrl?: string | null },
  request?: Request | null,
): string | null {
  const fromSettings = normalizePublicBaseUrl(settings.publicUrl ?? "");
  if (fromSettings) return fromSettings;
  return originFromRequest(request ?? null);
}

/**
 * Same as resolvePublicBaseUrl, but throws a clear admin-facing error when
 * nothing usable is available (so we never mail http://0.0.0.0/...).
 */
export function requirePublicBaseUrl(
  settings: Pick<Settings, "publicUrl"> | { publicUrl?: string | null },
  request?: Request | null,
): string {
  const base = resolvePublicBaseUrl(settings, request);
  if (base) return base;
  throw new Error(
    "Set Public URL under Admin → SMTP before sending invite emails. Without it, join links can point at an unreachable address (e.g. 0.0.0.0).",
  );
}
