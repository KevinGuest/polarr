import type { LyricLine, LyricWord } from "./types";

function bracketTs(): RegExp {
  return /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
}

function angleTs(): RegExp {
  return /<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>/g;
}

function parseStamp(min: string, sec: string, fracRaw?: string): number {
  const frac = fracRaw || "0";
  const f =
    frac.length <= 2
      ? Number(frac.padEnd(2, "0")) / 100
      : Number(frac.padEnd(3, "0")) / 1000;
  return Number(min) * 60 + Number(sec) + f;
}

function stampFromMatch(match: RegExpMatchArray): number {
  return parseStamp(match[1]!, match[2]!, match[3]);
}

function displayText(row: string): string {
  return row
    .replace(bracketTs(), "")
    .replace(angleTs(), "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when every `[mm:ss]` tag sits in a leading cluster (standard multi-tag). */
function tagsAreLeadingCluster(
  row: string,
  tags: RegExpMatchArray[],
): boolean {
  let pos = 0;
  for (const tag of tags) {
    const idx = tag.index ?? 0;
    if (row.slice(pos, idx).trim() !== "") return false;
    pos = idx + tag[0].length;
  }
  return true;
}

function wordsFromSegments(
  segments: { time: number; raw: string }[],
): LyricWord[] {
  const words: LyricWord[] = [];
  for (const seg of segments) {
    const text = seg.raw.replace(/\s+/g, " ").trim();
    if (!text) continue;
    words.push({ time: seg.time, text });
  }
  return words;
}

function lineFromWords(lineTime: number, text: string, words: LyricWord[]): LyricLine {
  if (words.length >= 2) {
    return { time: lineTime, text, words };
  }
  return { time: lineTime, text };
}

/** Enhanced LRC: `[00:12.00]Hello <00:12.50>world` */
function parseAngleEnhanced(
  row: string,
  brackets: RegExpMatchArray[],
): LyricLine | null {
  const lineTime = stampFromMatch(brackets[0]!);
  const body = row.replace(bracketTs(), "");
  const angles = [...body.matchAll(angleTs())];
  if (!angles.length) return null;

  const segments: { time: number; raw: string }[] = [];
  const firstIdx = angles[0]!.index ?? 0;
  const prefix = body.slice(0, firstIdx);
  if (prefix.trim()) {
    segments.push({ time: lineTime, raw: prefix });
  }
  for (let i = 0; i < angles.length; i++) {
    const match = angles[i]!;
    const start = (match.index ?? 0) + match[0].length;
    const end =
      i + 1 < angles.length
        ? (angles[i + 1]!.index ?? body.length)
        : body.length;
    segments.push({
      time: stampFromMatch(match),
      raw: body.slice(start, end),
    });
  }

  const text = displayText(row);
  if (!text) return null;
  return lineFromWords(lineTime, text, wordsFromSegments(segments));
}

/** Inline word tags: `[00:12.00]Hello [00:12.50]world` */
function parseInlineWords(
  row: string,
  brackets: RegExpMatchArray[],
): LyricLine | null {
  const segments: { time: number; raw: string }[] = [];
  for (let i = 0; i < brackets.length; i++) {
    const match = brackets[i]!;
    const start = (match.index ?? 0) + match[0].length;
    const end =
      i + 1 < brackets.length
        ? (brackets[i + 1]!.index ?? row.length)
        : row.length;
    segments.push({
      time: stampFromMatch(match),
      raw: row.slice(start, end),
    });
  }
  const text = displayText(row);
  if (!text) return null;
  const words = wordsFromSegments(segments);
  const lineTime = words[0]?.time ?? stampFromMatch(brackets[0]!);
  return lineFromWords(lineTime, text, words);
}

function parseRow(row: string): LyricLine[] {
  const brackets = [...row.matchAll(bracketTs())];
  if (!brackets.length) return [];

  if (angleTs().test(row)) {
    const enhanced = parseAngleEnhanced(row, brackets);
    return enhanced ? [enhanced] : [];
  }

  if (brackets.length >= 2 && !tagsAreLeadingCluster(row, brackets)) {
    const inline = parseInlineWords(row, brackets);
    return inline ? [inline] : [];
  }

  const text = displayText(row);
  if (!text) return [];
  return brackets.map((match) => ({
    time: stampFromMatch(match),
    text,
  }));
}

/** Parse standard LRC `[mm:ss.xx] text` and enhanced word-timed variants. */
export function parseLrc(raw: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const row of raw.split(/\r?\n/)) {
    lines.push(...parseRow(row));
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

/** Next line whose stamp is actually later (skip duplicate/near-identical tags). */
function nextDistinctLine(
  lines: LyricLine[],
  index: number,
): LyricLine | undefined {
  const line = lines[index];
  if (!line) return undefined;
  for (let i = index + 1; i < lines.length; i++) {
    const next = lines[i]!;
    if (next.time > line.time + 0.08) return next;
  }
  return undefined;
}

/**
 * End of a timed line for fill: the next distinct stamp, not last-word time.
 * Last-word time is a start stamp — using it as the wipe end finishes the
 * line as the last word begins (feels too fast).
 */
export function lyricLineEndSec(
  lines: LyricLine[],
  index: number,
): number {
  const line = lines[index];
  if (!line) return 0;
  const next = nextDistinctLine(lines, index);
  if (next && next.time > line.time) return next.time;
  const lastWord = line.words?.[line.words.length - 1];
  if (lastWord && lastWord.time > line.time) {
    return lastWord.time + 1.6;
  }
  return line.time + 4;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * 0–1 fill through a timed line using (clock − start) / (end − start).
 * Completes at the next line stamp. A compressed span (next line too close)
 * is expanded slightly so the wipe doesn’t flash complete.
 * Does not invent per-word times — callers use `line.words` when present.
 */
export function lyricLineFill01(
  clockSec: number,
  lineStart: number,
  lineEnd: number,
): number {
  const dur = lineEnd - lineStart;
  if (dur <= 0) return clockSec >= lineStart ? 1 : 0;
  const fillDur = dur < 0.55 ? Math.max(dur, 0.75) : dur;
  return clamp01((clockSec - lineStart) / fillDur);
}

/**
 * 0–1 fill through one enhanced-LRC word (start → next word start).
 * Last word should pass the next *line* time so it holds instead of flashing.
 */
export function lyricWordFill01(
  clockSec: number,
  wordTime: number,
  nextTime: number,
): number {
  const dur = nextTime - wordTime;
  if (dur <= 0.05) return clockSec >= wordTime ? 1 : 0;
  return clamp01((clockSec - wordTime) / dur);
}
