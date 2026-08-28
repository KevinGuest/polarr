import {
  rateLimitBlockedForMs,
  rateLimitKeys,
  rateLimitResponse,
  recordRateLimitFailure,
  recordRateLimitSuccess,
} from "@/lib/rate-limit";
import { getRequestIpFromRequest } from "@/lib/request-client";

type AuthRateScope = "register" | "join" | "reset" | "discord-login";

const OPTIONS: Record<
  AuthRateScope,
  { freeFails: number; maxBlockMs: number }
> = {
  register: { freeFails: 8, maxBlockMs: 60 * 60 * 1000 },
  join: { freeFails: 10, maxBlockMs: 30 * 60 * 1000 },
  reset: { freeFails: 8, maxBlockMs: 30 * 60 * 1000 },
  "discord-login": { freeFails: 15, maxBlockMs: 15 * 60 * 1000 },
};

/** Returns a 429 Response when throttled, otherwise null. */
export function enforceAuthRateLimit(
  req: Request,
  scope: AuthRateScope,
  id?: string,
): Response | null {
  const ip = getRequestIpFromRequest(req);
  const waitMs = rateLimitBlockedForMs(
    scope,
    rateLimitKeys(ip, id),
    OPTIONS[scope],
  );
  if (waitMs > 0) return rateLimitResponse(waitMs);
  return null;
}

export function recordAuthRateFailure(
  req: Request,
  scope: AuthRateScope,
  id?: string,
) {
  const ip = getRequestIpFromRequest(req);
  recordRateLimitFailure(scope, rateLimitKeys(ip, id), OPTIONS[scope]);
}

export function recordAuthRateSuccess(
  req: Request,
  scope: AuthRateScope,
  id?: string,
) {
  const ip = getRequestIpFromRequest(req);
  recordRateLimitSuccess(scope, rateLimitKeys(ip, id));
}
