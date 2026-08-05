import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Human album length, e.g. "1 hr 8 min" or "42 min". */
export function formatAlbumLength(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 min";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} hr ${m} min`;
  return `${Math.max(m, 1)} min`;
}

/** Title heuristics when metadata has no explicit flag. */
export function titleLooksExplicit(title: string): boolean {
  return /\bexplicit\b/i.test(title) || /\[e\]/i.test(title);
}

/** Guest artists embedded in a track title (feat. / ft. / featuring). */
export function extractFeaturedArtists(title: string): string[] {
  const t = title.trim();
  if (!t) return [];
  const m =
    t.match(/\((?:feat\.?|ft\.?|featuring)\s+([^)]+)\)/i) ||
    t.match(/\[(?:feat\.?|ft\.?|featuring)\s+([^\]]+)\]/i) ||
    t.match(/\s(?:feat\.?|ft\.?|featuring)\s+(.+)$/i);
  if (!m?.[1]) return [];
  return splitArtistList(m[1]);
}

function splitArtistList(raw: string): string[] {
  return raw
    .split(/,|&|\band\b/i)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Artist line for a track: primary + featured guests from the artist field
 * and/or title, unless `creditedArtists` already has the full credit string.
 */
export function formatTrackArtistLine(
  primaryArtist: string,
  title: string,
  creditedArtists?: string | null,
): string {
  const credited = (creditedArtists || "").trim();
  if (credited) return credited;

  let primary = primaryArtist.trim() || "Unknown Artist";
  const extras: string[] = [];

  const artistFeat = primary.match(
    /^(.+?)\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/i,
  );
  if (artistFeat) {
    primary = artistFeat[1].trim() || primary;
    extras.push(...splitArtistList(artistFeat[2] || ""));
  }

  extras.push(...extractFeaturedArtists(title));

  const primaryLower = primary.toLowerCase();
  const seen = new Set<string>([primaryLower]);
  const unique = extras.filter((f) => {
    const key = f.toLowerCase();
    if (!key || seen.has(key) || primaryLower.includes(key)) return false;
    seen.add(key);
    return true;
  });
  if (!unique.length) return primary;
  return [primary, ...unique].join(", ");
}

/** Join MusicBrainz-style artist-credit entries into one display string. */
export function formatArtistCredit(
  credit?:
    | {
        name?: string;
        joinphrase?: string;
        artist?: { name?: string };
      }[]
    | null,
): string {
  if (!credit?.length) return "";
  return credit
    .map(
      (c) =>
        `${(c.name || c.artist?.name || "").trim()}${c.joinphrase || ""}`,
    )
    .join("")
    .trim();
}
