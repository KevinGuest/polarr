import { headers } from "next/headers";

const COOKIE_NAME = "polarr_token";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Session cookie options. `secure` is set only when the request arrived over
 * HTTPS — hardcoding it would break plain-HTTP LAN / Tor setups common on
 * self-hosted boxes.
 */
export async function sessionCookieOptions() {
  const h = await headers();
  const proto = (h.get("x-forwarded-proto") || "").split(",")[0]?.trim();
  const host = h.get("host") || "";
  const isHttps =
    proto === "https" ||
    // Direct TLS termination without a proxy header is rare in dev; assume
    // https for non-local hosts that came in without a proto hint.
    (proto === "" && !isLocalHost(host));

  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    secure: isHttps,
  };
}

function isLocalHost(host: string): boolean {
  const name = host.split(":")[0]?.toLowerCase() || "";
  return (
    name === "localhost" ||
    name === "127.0.0.1" ||
    name === "::1" ||
    name === "0.0.0.0" ||
    name.endsWith(".local") ||
    name.endsWith(".lan") ||
    name.endsWith(".onion") ||
    /^10\./.test(name) ||
    /^192\.168\./.test(name) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(name)
  );
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
