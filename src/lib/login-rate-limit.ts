import {
  rateLimitBlockedForMs,
  rateLimitKeys,
  recordRateLimitFailure,
  recordRateLimitSuccess,
} from "@/lib/rate-limit";

const NAMESPACE = "login";

/** Milliseconds the caller must still wait, or 0 when allowed. */
export function loginBlockedForMs(
  ip: string | null,
  username: string,
): number {
  return rateLimitBlockedForMs(NAMESPACE, rateLimitKeys(ip, username));
}

export function recordLoginFailure(ip: string | null, username: string) {
  recordRateLimitFailure(NAMESPACE, rateLimitKeys(ip, username));
}

export function recordLoginSuccess(ip: string | null, username: string) {
  recordRateLimitSuccess(NAMESPACE, rateLimitKeys(ip, username));
}
