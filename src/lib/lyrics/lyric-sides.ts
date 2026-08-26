import type { LyricLine } from "./types";
import { extractFeaturedArtists } from "@/lib/utils";
import { normalizeArtistName, primaryArtistName } from "@/lib/track-match";

export type LyricSide = "left" | "right" | "center";

export type SidedLyricLine = LyricLine & {
  side: LyricSide;
  /** Display text with speaker/section chrome stripped when applicable. */
  displayText: string;
};

/** Primary + first featured guest when the credit is a clear duo. */
export function duoArtists(
  artist: string,
  title: string,
): { left: string; right: string } | null {
  const credited = (artist || "").trim();
  if (!credited) return null;

  let primary = primaryArtistName(credited) || credited;
  const guests: string[] = [];

  const featInArtist = credited.match(
    /^(.+?)\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/i,
  );
  if (featInArtist) {
    primary = featInArtist[1]!.trim() || primary;
    guests.push(
      ...featInArtist[2]!
        .split(/,|&|\band\b/i)
        .map((s) => s.trim())
        .filter(Boolean),
    );
  } else {
    // "A & B" / "A x B" / "A, B" as equal partners
    const pair = credited.match(
      /^(.+?)\s+(?:&|and|x|,)\s+(.+)$/i,
    );
    if (pair && !/\bfeat/i.test(credited)) {
      const a = pair[1]!.trim();
      const b = pair[2]!.split(/,|&|\band\b/i)[0]?.trim() || "";
      if (a && b) return { left: a, right: b };
    }
  }

  guests.push(...extractFeaturedArtists(title || ""));
  const right = guests[0]?.trim();
  if (!primary || !right) return null;
  if (normalizeArtistName(primary) === normalizeArtistName(right)) return null;
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
  return a0.length >= 3 && b0.length >= 3 && a0 === b0;
}

/** `[Verse 1: Drake]` / `[Chorus: Lil Baby & Friends]` */
function sectionSpeaker(text: string): string | null {
  const m = text.match(/^\[[^\]]*:\s*([^\]]+)\]\s*$/);
  if (!m?.[1]) return null;
  // Take first named credit in the bracket
  return m[1].split(/,|&|\band\b|\//i)[0]?.trim() || null;
}

/** Leading `Drake:` or `Lil Baby -` credit on a lyric line. */
function leadingSpeaker(text: string, duo: { left: string; right: string }): string | null {
  const m = text.match(/^([^:\-]{1,40})\s*[:\-]\s+(.+)$/);
  if (!m?.[1] || !m[2]) return null;
  const label = m[1].trim();
  // Karaoke voice tags: v1 / v2 / A / B
  if (/^v?1$/i.test(label) || /^a$/i.test(label)) return duo.left;
  if (/^v?2$/i.test(label) || /^b$/i.test(label)) return duo.right;
  if (matchesArtist(label, duo.left) || matchesArtist(label, duo.right)) {
    return label;
  }
  return null;
}

/** Bare `[Drake]` / `(Lil Baby)` cue lines. */
function bareArtistCue(text: string, duo: { left: string; right: string }): string | null {
  const m = text.match(/^[\[(]\s*([^\]\)]+)\s*[\])]?\s*$/);
  if (!m?.[1]) return null;
  const label = m[1].split(/,|&|\band\b|\//i)[0]?.trim() || "";
  if (!label || /^(verse|chorus|bridge|intro|outro|hook|refrain|pre[- ]?chorus)\b/i.test(label)) {
    return null;
  }
  if (matchesArtist(label, duo.left) || matchesArtist(label, duo.right)) {
    return label;
  }
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

/**
 * When the track is a clear duo, map lines to left (primary) / right (guest).
 * Uses Genius-style section headers and sticky speaker; otherwise stays centered.
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

  return lines.map((line) => {
    const raw = line.text.trim();
    const isGap = raw === "♪" || raw === "♫";
    if (isGap) {
      return { ...line, side: "center" as const, displayText: raw };
    }

    const section = sectionSpeaker(raw);
    if (section) {
      sticky = sideForSpeaker(section, duo);
      sawSpeaker = true;
      // Keep section markers as centered dim labels
      return { ...line, side: "center" as const, displayText: raw };
    }

    const cue = bareArtistCue(raw, duo);
    if (cue) {
      sticky = sideForSpeaker(cue, duo);
      sawSpeaker = true;
      return { ...line, side: "center" as const, displayText: raw };
    }

    const lead = leadingSpeaker(raw, duo);
    if (lead) {
      sticky = sideForSpeaker(lead, duo);
      sawSpeaker = true;
      const stripped = raw.replace(/^[^:\-]{1,40}\s*[:\-]\s+/, "").trim();
      return {
        ...line,
        side: sticky,
        displayText: stripped || raw,
      };
    }

    // Without explicit markers, still split once we know it's a duo:
    // sticky starts left; alternate on blank-ish gaps is too noisy —
    // keep sticky side so consecutive lines from one verse stay together.
    if (!sawSpeaker) {
      // Before any speaker cue, keep primary-left so the page still reads as a duo.
      return { ...line, side: "left" as const, displayText: raw };
    }

    return { ...line, side: sticky, displayText: raw };
  });
}

export function isDualLyricLayout(lines: SidedLyricLine[]): boolean {
  let left = false;
  let right = false;
  for (const line of lines) {
    if (line.side === "left") left = true;
    if (line.side === "right") right = true;
    if (left && right) return true;
  }
  return false;
}
