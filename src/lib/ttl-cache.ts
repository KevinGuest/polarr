/**
 * Process-local TTL cache with in-flight dedupe (stampede protection).
 * Fits Docker single-process Polarr — warm after first visitor.
 */

type Entry<T> = { at: number; value: T };

export class TtlCache<T> {
  private store = new Map<string, Entry<T>>();
  private inflight = new Map<string, Promise<T>>();

  constructor(
    private ttlMs: number,
    private maxEntries = 64,
  ) {}

  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at >= this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T) {
    this.store.set(key, { at: Date.now(), value });
    if (this.store.size > this.maxEntries) {
      const oldest = [...this.store.entries()].sort(
        (a, b) => a[1].at - b[1].at,
      );
      for (const [k] of oldest.slice(0, Math.ceil(this.maxEntries / 4))) {
        this.store.delete(k);
      }
    }
  }

  /** Return cached value or run `factory` once per key while loading. */
  async getOrSet(key: string, factory: () => Promise<T>): Promise<T> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;

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

  invalidate(key?: string) {
    if (key == null) {
      this.store.clear();
      return;
    }
    this.store.delete(key);
  }
}
