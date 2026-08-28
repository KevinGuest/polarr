/**
 * In-memory rate limits — per-namespace keys, exponential backoff on failures.
 * Resets on process restart; sufficient for self-hosted + Cloudflare edge limits.
 */

type Bucket = {
  fails: number;
  blockedUntil: number;
  lastFailAt: number;
};

const buckets = new Map<string, Bucket>();

export type RateLimitOptions = {
  /** Clear bucket after this long without failures. */
  decayMs?: number;
  /** Failures allowed before backoff starts. */
  freeFails?: number;
  /** Max block duration. */
  maxBlockMs?: number;
};

const DEFAULTS: Required<RateLimitOptions> = {
  decayMs: 15 * 60 * 1000,
  freeFails: 5,
  maxBlockMs: 15 * 60 * 1000,
};

function bucketKey(namespace: string, key: string): string {
  return `${namespace}:${key}`;
}

function bucketFor(fullKey: string, decayMs: number): Bucket {
  let b = buckets.get(fullKey);
  const now = Date.now();
  if (b && now - b.lastFailAt > decayMs) {
    buckets.delete(fullKey);
    b = undefined;
  }
  if (!b) {
    b = { fails: 0, blockedUntil: 0, lastFailAt: 0 };
    buckets.set(fullKey, b);
  }
  return b;
}

/** Milliseconds until all keys in this namespace are unblocked, or 0. */
export function rateLimitBlockedForMs(
  namespace: string,
  keys: string[],
  opts?: RateLimitOptions,
): number {
  const o = { ...DEFAULTS, ...opts };
  const now = Date.now();
  let wait = 0;
  for (const key of keys) {
    if (!key) continue;
    const b = buckets.get(bucketKey(namespace, key));
    if (b && b.blockedUntil > now) {
      wait = Math.max(wait, b.blockedUntil - now);
    }
  }
  return wait;
}

export function recordRateLimitFailure(
  namespace: string,
  keys: string[],
  opts?: RateLimitOptions,
) {
  const o = { ...DEFAULTS, ...opts };
  const now = Date.now();
  for (const key of keys) {
    if (!key) continue;
    const fk = bucketKey(namespace, key);
    const b = bucketFor(fk, o.decayMs);
    b.fails += 1;
    b.lastFailAt = now;
    if (b.fails > o.freeFails) {
      const blockMs = Math.min(
        o.maxBlockMs,
        1000 * 2 ** (b.fails - o.freeFails),
      );
      b.blockedUntil = now + blockMs;
    }
  }
  if (buckets.size > 10_000) {
    for (const [key, b] of buckets) {
      if (now - b.lastFailAt > o.decayMs) buckets.delete(key);
    }
  }
}

export function recordRateLimitSuccess(namespace: string, keys: string[]) {
  for (const key of keys) {
    if (!key) continue;
    buckets.delete(bucketKey(namespace, key));
  }
}

export function rateLimitKeys(ip: string | null, id?: string): string[] {
  const keys: string[] = [];
  if (id) keys.push(`id:${id.trim().toLowerCase()}`);
  if (ip) keys.push(`ip:${ip}`);
  return keys;
}

export function rateLimitResponse(waitMs: number) {
  const seconds = Math.ceil(waitMs / 1000);
  return Response.json(
    { error: `Too many attempts. Try again in ${seconds}s.` },
    {
      status: 429,
      headers: { "Retry-After": String(seconds) },
    },
  );
}
