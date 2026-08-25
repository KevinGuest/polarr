/**
 * Background library scan — picks up Lidarr / download drops without a manual refresh.
 * Interval is checked every minute against Settings.libraryScanMinutes (or env).
 */

import { getSettings } from "@/lib/db";
import { scanMusicLibrary } from "@/lib/library";

const CHECK_MS = 60_000;
const BOOT_DELAY_MS = 20_000;

/** Allowed presets (minutes). 0 = disabled. */
export const LIBRARY_SCAN_PRESETS = [0, 15, 30, 60] as const;
export type LibraryScanMinutes = (typeof LIBRARY_SCAN_PRESETS)[number];

const g = globalThis as typeof globalThis & {
  __polarrLibraryScan?: {
    started: boolean;
    running: boolean;
    lastScanAt: number;
    lastError: string | null;
  };
};

function state() {
  if (!g.__polarrLibraryScan) {
    g.__polarrLibraryScan = {
      started: false,
      running: false,
      lastScanAt: 0,
      lastError: null,
    };
  }
  return g.__polarrLibraryScan;
}

export function normalizeLibraryScanMinutes(raw: unknown): LibraryScanMinutes {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n <= 15) return 15;
  if (n <= 30) return 30;
  return 60;
}

/** Effective interval: env override wins when set. */
export function resolveLibraryScanMinutes(): LibraryScanMinutes {
  const env = process.env.POLARR_LIBRARY_SCAN_MINUTES?.trim();
  if (env != null && env !== "") {
    return normalizeLibraryScanMinutes(env);
  }
  try {
    return normalizeLibraryScanMinutes(getSettings().libraryScanMinutes);
  } catch {
    return 30;
  }
}

export function getLibraryScanStatus() {
  const s = state();
  return {
    intervalMinutes: resolveLibraryScanMinutes(),
    running: s.running,
    lastScanAt: s.lastScanAt || null,
    lastError: s.lastError,
  };
}

async function tick() {
  const s = state();
  if (s.running) return;

  const minutes = resolveLibraryScanMinutes();
  if (minutes <= 0) return;

  const due = Date.now() - s.lastScanAt >= minutes * 60_000;
  if (!due) return;

  s.running = true;
  try {
    const result = await scanMusicLibrary();
    s.lastScanAt = Date.now();
    s.lastError = null;
    console.info(
      `[polarr] library scan ok · ${result.scanned} files · ${result.probed} probed · next ≤${minutes}m`,
    );
  } catch (err) {
    s.lastScanAt = Date.now();
    s.lastError = err instanceof Error ? err.message : "scan failed";
    console.error("[polarr] library scan failed:", s.lastError);
  } finally {
    s.running = false;
  }
}

/** Idempotent — safe across Next hot reloads via globalThis. */
export function startLibraryScanScheduler() {
  const s = state();
  if (s.started) return;
  s.started = true;

  console.info(
    `[polarr] library scan scheduler started · interval ${resolveLibraryScanMinutes()}m (0=off)`,
  );

  setTimeout(() => {
    void tick();
  }, BOOT_DELAY_MS);

  setInterval(() => {
    void tick();
  }, CHECK_MS);
}
