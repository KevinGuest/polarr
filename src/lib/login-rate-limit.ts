/**
 * In-memory login throttle — per-IP and per-username exponential backoff.
 * Survives only the process lifetime, which is fine: it exists to make
 * online password guessing impractical, not to be perfect bookkeeping.
 */

type Bucket = {
  fails: number;
  /** Epoch ms until which attempts are refused. */
  blockedUntil: number;
  lastFailAt: number;
};

const buckets = new Map<string, Bucket>();

/** Reset counters after this long without failures. */
const DECAY_MS = 15 * 60 * 1000;
/** Free failures before delays kick in. */
const FREE_FAILS = 5;
/** Backoff: 2^(fails - FREE_FAILS) seconds, capped. */
const MAX_BLOCK_MS = 15 * 60 * 1000;

function bucketFor(key: string): Bucket {
  let b = buckets.get(key);
  const now = Date.now();
  if (b && now - b.lastFailAt > DECAY_MS) {
    buckets.delete(key);
    b = undefined;
  }
  if (!b) {
    b = { fails: 0, blockedUntil: 0, lastFailAt: 0 };
    buckets.set(key, b);
  }
  return b;
}

/** Milliseconds the caller must still wait, or 0 when allowed. */
export function loginBlockedForMs(ip: string | null, username: string): number {
  const now = Date.now();
  let wait = 0;
  for (const key of keysFor(ip, username)) {
    const b = buckets.get(key);
    if (b && b.blockedUntil > now) wait = Math.max(wait, b.blockedUntil - now);
  }
  return wait;
}

export function recordLoginFailure(ip: string | null, username: string) {
  const now = Date.now();
  for (const key of keysFor(ip, username)) {
    const b = bucketFor(key);
    b.fails += 1;
    b.lastFailAt = now;
    if (b.fails > FREE_FAILS) {
      const blockMs = Math.min(
        MAX_BLOCK_MS,
        1000 * 2 ** (b.fails - FREE_FAILS),
      );
      b.blockedUntil = now + blockMs;
    }
  }
  // Opportunistic cleanup so the map can't grow unbounded
  if (buckets.size > 10_000) {
    for (const [key, b] of buckets) {
      if (now - b.lastFailAt > DECAY_MS) buckets.delete(key);
    }
  }
}

export function recordLoginSuccess(ip: string | null, username: string) {
  for (const key of keysFor(ip, username)) buckets.delete(key);
}

function keysFor(ip: string | null, username: string): string[] {
  const keys = [`u:${username.trim().toLowerCase()}`];
  if (ip) keys.push(`ip:${ip}`);
  return keys;
}
