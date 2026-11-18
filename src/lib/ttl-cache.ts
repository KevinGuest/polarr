/**
 * Process-local TTL cache with in-flight dedupe (stampede protection).
 * Fits Docker single-process Polarr — warm after first visitor.
 */

type Entry<T> = { at: number; value: T };

/**
 * Process-wide singleton keyed by name.
 *
 * Next bundles pages, route handlers and instrumentation into separate module
 * graphs, so a plain module-level `new Map()` exists once per graph: the home
 * page, `/api/discover` and the boot warmer each kept their own cold copy and
 * rebuilt the same feed. Anything that must be shared lives on globalThis.
 */
export function globalSingleton<T>(name: string, init: () => T): T {
  const g = globalThis as typeof globalThis & {
    __polarrShared?: Map<string, unknown>;
  };
  if (!g.__polarrShared) g.__polarrShared = new Map();
  if (!g.__polarrShared.has(name)) g.__polarrShared.set(name, init());
  return g.__polarrShared.get(name) as T;
}

export class TtlCache<T> {
  private store = new Map<string, Entry<T>>();
  private inflight = new Map<string, Promise<T>>();

  constructor(
    private ttlMs: number,
    private maxEntries = 64,
    /** Expired entries stay servable via getStale()/getOrRevalidate() this long. */
    private staleMs = 0,
  ) {}

  /** Fresh value only. */
  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    const age = Date.now() - hit.at;
    if (age >= this.ttlMs) {
      if (age >= this.ttlMs + this.staleMs) this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  /** Fresh or expired-but-still-servable value. Never triggers a load. */
  getStale(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at >= this.ttlMs + this.staleMs) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  /**
   * `ttlMs` overrides how long this entry counts as fresh (e.g. a partial
   * result that should be retried soon but is still worth serving stale).
   */
  set(key: string, value: T, ttlMs?: number) {
    const at =
      ttlMs == null ? Date.now() : Date.now() - Math.max(0, this.ttlMs - ttlMs);
    this.store.set(key, { at, value });
    if (this.store.size > this.maxEntries) {
      const oldest = [...this.store.entries()].sort(
        (a, b) => a[1].at - b[1].at,
      );
      for (const [k] of oldest.slice(0, Math.ceil(this.maxEntries / 4))) {
        this.store.delete(k);
      }
    }
  }

  /** Run `factory` once per key (deduped) and store the result. */
  refresh(key: string, factory: () => Promise<T>): Promise<T> {
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const run = (async () => {
      try {
        const value = await factory();
        this.set(key, value);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, run);
    return run;
  }

  /** Return cached value or run `factory` once per key while loading. */
  async getOrSet(key: string, factory: () => Promise<T>): Promise<T> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    return this.refresh(key, factory);
  }

  /**
   * Stale-while-revalidate: a fresh hit returns as-is; an expired hit returns
   * immediately while `factory` refreshes it in the background; only a true
   * miss waits for `factory`.
   */
  async getOrRevalidate(key: string, factory: () => Promise<T>): Promise<T> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const stale = this.getStale(key);
    if (stale !== undefined) {
      void this.refresh(key, factory).catch(() => {});
      return stale;
    }
    return this.refresh(key, factory);
  }

  invalidate(key?: string) {
    if (key == null) {
      this.store.clear();
      return;
    }
    this.store.delete(key);
  }
}
