import type { LyricLine } from "./types";

/** Parse standard LRC `[mm:ss.xx] text` lines. Skips empty timestamps. */
export function parseLrc(raw: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const row of raw.split(/\r?\n/)) {
    // Support multi-tag lines: [00:12.00][00:45.00] chorus
    const tags = [...row.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    if (!tags.length) continue;
    const text = row.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, "").trim();
    if (!text) continue;
    for (const match of tags) {
      const min = Number(match[1]);
      const sec = Number(match[2]);
      const fracRaw = match[3] || "0";
      // .xx → centiseconds, .xxx → ms
      const frac =
        fracRaw.length <= 2
          ? Number(fracRaw.padEnd(2, "0")) / 100
          : Number(fracRaw.padEnd(3, "0")) / 1000;
      lines.push({ time: min * 60 + sec + frac, text });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

/** Un-timed lines — no invented timestamps (was i*4s). */
export function plainLines(raw: string): LyricLine[] {
  return raw
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => ({ time: 0, text }));
}

/** Span of timed lyrics (last − first), or null. */
export function lyricSpanSec(lines: LyricLine[]): number | null {
  if (lines.length < 2) return null;
  const times = lines.map((l) => l.time).filter((t) => Number.isFinite(t));
  if (times.length < 2) return null;
  const first = Math.min(...times);
  const last = Math.max(...times);
  if (last <= first) return null;
  return last - first;
}
