/**
 * Browser-side discover cache so soft navigations / remounts paint instantly
 * while a background refresh keeps shelves fresh.
 */

import type { DiscoverPayload } from "@/lib/discover-types";

const CLIENT_TTL_MS = 5 * 60 * 1000;

let cached: { at: number; data: DiscoverPayload } | null = null;
let inflight: Promise<DiscoverPayload> | null = null;

export function peekDiscoverCache(): DiscoverPayload | null {
  if (!cached) return null;
  if (Date.now() - cached.at >= CLIENT_TTL_MS) return null;
  return cached.data;
}

export function seedDiscoverCache(data: DiscoverPayload) {
  cached = { at: Date.now(), data };
}

export async function fetchDiscoverFeed(opts?: {
  /** Force network even if client cache is warm */
  force?: boolean;
}): Promise<DiscoverPayload> {
  if (!opts?.force) {
    const hit = peekDiscoverCache();
    if (hit) return hit;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch("/api/discover", {
        headers: opts?.force
          ? { "x-polarr-cache": "bypass" }
          : undefined,
      });
      if (!res.ok) {
        throw new Error(`discover ${res.status}`);
      }
      const data = (await res.json()) as DiscoverPayload;
      cached = { at: Date.now(), data };
      return data;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
