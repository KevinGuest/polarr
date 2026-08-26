import type { LyricLine } from "./types";
import { extractFeaturedArtists } from "@/lib/utils";
import { normalizeArtistName, primaryArtistName } from "@/lib/track-match";

export type LyricSide = "left" | "right" | "center";

export type SidedLyricLine = LyricLine & {
  side: LyricSide;
  /** Display text with speaker/section chrome stripped when applicable. */
  displayText: string;
};

function splitGuestChunk(raw: string): string[] {
  return raw
    .split(/,|&|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Primary + first featured guest when the credit is a clear duo. */
export function duoArtists(
  artist: string,
  title: string,
): { left: string; right: string } | null {
  const credited = (artist || "").trim();
  if (!credited && !(title || "").trim()) return null;

  let primary = primaryArtistName(credited) || credited;
  const guests: string[] = [];

  const featInArtist = credited.match(
    /^(.+?)\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/i,
  );
  if (featInArtist) {
    primary = featInArtist[1]!.trim() || primary;
    guests.push(...splitGuestChunk(featInArtist[2]!));
  } else if (credited) {
    // "A & B" / "A x B" / "A, B" / "A with B" as equal partners
    const pair = credited.match(
      /^(.+?)\s+(?:&|and|x|with|,)\s+(.+)$/i,
    );
    if (pair && !/\bfeat/i.test(credited)) {
      const a = pair[1]!.trim();
      const b = splitGuestChunk(pair[2]!)[0] || "";
      if (a && b && normalizeArtistName(a) !== normalizeArtistName(b)) {
        return { left: a, right: b };
      }
    }
  }

  guests.push(...extractFeaturedArtists(title || ""));
  // Title patterns: "Song - Artist1 & Artist2" already handled via artist field;
  // also "ft. X" without parens mid-title
  const titleFt = (title || "").match(
    /(?:feat\.?|ft\.?|featuring)\s+([^([\]\n]+)/i,
  );
  if (titleFt?.[1]) guests.push(...splitGuestChunk(titleFt[1]));

  const right = guests.find(
    (g) =>
      g.trim() &&
      normalizeArtistName(g) !== normalizeArtistName(primary || ""),
  )?.trim();
  if (!primary || !right) return null;
  return { left: primary, right };
}

function matchesArtist(label: string, artist: string): boolean {
  const a = normalizeArtistName(label);
  const b = normalizeArtistName(artist);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  // First token (e.g. "Drake" from "Drake & Future")
  const a0 = a.split(" ")[0] || "";
  const b0 = b.split(" ")[0] || "";
  if (a0.length >= 3 && b0.length >= 3 && a0 === b0) return true;
  // Numeric stage names: "21" from "21 savage"
  if (/^\d/.test(a0) && a0 === b0) return true;
  return false;
}

/** `[Verse 1: Drake]` / `[Chorus: Lil Baby & Friends]` */
function sectionSpeaker(text: string): string | null {
  const m = text.match(/^\[[^\]]*:\s*([^\]]+)\]\s*$/);
  if (!m?.[1]) return null;
  return m[1].split(/,|&|\band\b|\//i)[0]?.trim() || null;
}

/** `[Verse 2]` / `[Chorus]` without a name — structural cue for duets. */
function sectionIndex(text: string): number | null {
  const m = text.match(
    /^\[\s*(?:verse|hook)\s*(\d+)\s*\]\s*$/i,
  );
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Leading `Drake:` or `Lil Baby -` credit on a lyric line. */
function leadingSpeaker(
  text: string,
  duo: { left: string; right: string },
): string | null {
  const m = text.match(/^([^:\-]{1,40})\s*[:\-]\s+(.+)$/);
  if (!m?.[1] || !m[2]) return null;
  const label = m[1].trim();
  if (/^v?1$/i.test(label) || /^a$/i.test(label)) return duo.left;
  if (/^v?2$/i.test(label) || /^b$/i.test(label)) return duo.right;
  if (matchesArtist(label, duo.left) || matchesArtist(label, duo.right)) {
    return label;
  }
  return null;
}

/** Bare `[Drake]` / `(Lil Baby)` cue lines. */
function bareArtistCue(
  text: string,
  duo: { left: string; right: string },
): string | null {
  const m = text.match(/^[\[(]\s*([^\]\)]+)\s*[\])]?\s*$/);
  if (!m?.[1]) return null;
  const label = m[1].split(/,|&|\band\b|\//i)[0]?.trim() || "";
  if (
    !label ||
    /^(verse|chorus|bridge|intro|outro|hook|refrain|pre[- ]?chorus)\b/i.test(
      label,
    )
  ) {
    return null;
  }
  if (matchesArtist(label, duo.left) || matchesArtist(label, duo.right)) {
    return label;
  }
  return null;
}

/** Artist name appears as its own short line inside the lyric. */
function inlineArtistOnlyLine(
  text: string,
  duo: { left: string; right: string },
): string | null {
  const t = text.trim();
  if (t.length > 48) return null;
  if (matchesArtist(t, duo.left)) return duo.left;
  if (matchesArtist(t, duo.right)) return duo.right;
  return null;
}

function sideForSpeaker(
  speaker: string,
  duo: { left: string; right: string },
): LyricSide {
  if (matchesArtist(speaker, duo.left)) return "left";
  if (matchesArtist(speaker, duo.right)) return "right";
  return "center";
}

function flip(side: LyricSide): LyricSide {
  return side === "left" ? "right" : side === "right" ? "left" : "left";
}

/**
 * When the track is a clear duo, map lines to left (primary) / right (guest).
 * Uses Genius-style section headers, sticky speaker, verse index, and
 * silence / ♪ gaps so unmarked LRC still splits across the two artists.
 */
export function assignLyricSides(
  lines: LyricLine[],
  artist: string,
  title: string,
): SidedLyricLine[] {
  const duo = duoArtists(artist, title);
  if (!duo) {
    return lines.map((line) => ({
      ...line,
      side: "center" as const,
      displayText: line.text,
    }));
  }

  let sticky: LyricSide = "left";
  let sawSpeaker = false;
  let prevTime = Number.NEGATIVE_INFINITY;
  /** Lines since last side flip — avoid flipping every tiny gap. */
  let sinceFlip = 0;

  return lines.map((line) => {
    const raw = line.text.trim();
    const t = Number(line.time) || 0;
    const gapSec = t - prevTime;
    const isGap = raw === "♪" || raw === "♫";
    prevTime = t;

    if (isGap) {
      // Instrumental break → next verse often flips artist on duets
      if (sawSpeaker || sinceFlip >= 2) {
        sticky = flip(sticky);
        sinceFlip = 0;
      }
      return { ...line, side: "center" as const, displayText: raw };
    }

    const section = sectionSpeaker(raw);
    if (section) {
      sticky = sideForSpeaker(section, duo);
      sawSpeaker = true;
      sinceFlip = 0;
      return { ...line, side: "center" as const, displayText: raw };
    }

    const verseN = sectionIndex(raw);
    if (verseN != null) {
      // Odd verses → primary (left), even → guest (right) — common duet form
      sticky = verseN % 2 === 1 ? "left" : "right";
      sawSpeaker = true;
      sinceFlip = 0;
      return { ...line, side: "center" as const, displayText: raw };
    }

    const cue = bareArtistCue(raw, duo);
    if (cue) {
      sticky = sideForSpeaker(cue, duo);
      sawSpeaker = true;
      sinceFlip = 0;
      return { ...line, side: "center" as const, displayText: raw };
    }

    const only = inlineArtistOnlyLine(raw, duo);
    if (only) {
      sticky = sideForSpeaker(only, duo);
      sawSpeaker = true;
      sinceFlip = 0;
      return { ...line, side: "center" as const, displayText: raw };
    }

    const lead = leadingSpeaker(raw, duo);
    if (lead) {
      sticky = sideForSpeaker(lead, duo);
      sawSpeaker = true;
      sinceFlip = 0;
      const stripped = raw.replace(/^[^:\-]{1,40}\s*[:\-]\s+/, "").trim();
      return {
        ...line,
        side: sticky,
        displayText: stripped || raw,
      };
    }

    // Long silence between sung lines → treat as a verse break and flip
    if (gapSec >= 7 && sinceFlip >= 3) {
      sticky = flip(sticky);
      sinceFlip = 0;
      sawSpeaker = true;
    }

    sinceFlip += 1;
    return { ...line, side: sticky, displayText: raw };
  });
}

/** True when a duo credit exists (layout columns), not only when both sides appear. */
export function isDualLyricLayout(
  lines: SidedLyricLine[],
  duo: { left: string; right: string } | null,
): boolean {
  if (!duo) return false;
  if (lines.length === 0) return false;
  // Prefer evidence of both sides, but still dual-column for known duos
  // so unmarked LRC at least starts primary-left under both names.
  return true;
}
