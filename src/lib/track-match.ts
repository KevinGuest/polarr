/**
 * Soft track matching — strip fluff, compare bones.
 * Used so local library wins before yt-dlp live fallback.
 */

/** Primary credit only — drop “feat.” / comma lists / & pairs. */
export function primaryArtistName(credit: string): string {
  let s = credit.trim();
  if (!s) return "";
  s = s.split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0] || s;
  s = s.split(/\s*,\s*/)[0] || s;
  s = s.split(/\s+(?:&|and|x|with)\s+/i)[0] || s;
  return s.trim();
}

/** Compare artist names ignoring case, accents, and light punctuation. */
export function normalizeArtistName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[‘’´`]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function namesMatch(a: string, b: string): boolean {
  const na = normalizeArtistName(a);
  const nb = normalizeArtistName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.startsWith("the ") && na.slice(4) === nb) return true;
  if (nb.startsWith("the ") && nb.slice(4) === na) return true;
  // Primary credit only (feat. / multi-artist)
  const pa = normalizeArtistName(primaryArtistName(a));
  const pb = normalizeArtistName(primaryArtistName(b));
  if (pa && pb && pa === pb) return true;
  if (pa.startsWith("the ") && pa.slice(4) === pb) return true;
  if (pb.startsWith("the ") && pb.slice(4) === pa) return true;
  return false;
}

/** Strip remasters, feats, track numbers — keep the song name meat. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[‘’´`]/g, "'")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.+$/i, " ")
    .replace(/^\d{1,3}(\s*[-.]\s*|\s+)/, " ")
    .replace(
      /\s*[-–—]\s*(remaster(?:ed)?|radio edit|live|mono|stereo|edit|version|mix).*$/i,
      " ",
    )
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titlesMatch(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.startsWith(nb) || nb.startsWith(na)) {
    const longer = na.length >= nb.length ? na : nb;
    const shorter = na.length < nb.length ? na : nb;
    return longer.length - shorter.length <= 12;
  }
  return false;
}

export type TrackMatchHit = {
  title: string;
  artist: string;
};

/** Score a candidate vs wanted artist/title. ≥70 is a solid hit. */
export function scoreTrackMatch(
  hit: TrackMatchHit,
  wantArtist: string,
  wantTitle: string,
): number {
  let score = 0;
  if (titlesMatch(hit.title, wantTitle)) score += 50;
  else if (normalizeTitle(hit.title).includes(normalizeTitle(wantTitle)))
    score += 20;
  else if (normalizeTitle(wantTitle).includes(normalizeTitle(hit.title)))
    score += 20;
  else return 0;

  const hitArtist = hit.artist;
  if (namesMatch(hitArtist, wantArtist)) score += 40;
  else {
    const ha = normalizeArtistName(primaryArtistName(hitArtist));
    const wa = normalizeArtistName(primaryArtistName(wantArtist));
    if (ha && wa && (ha.includes(wa) || wa.includes(ha))) score += 15;
    else score -= 10;
  }
  return score;
}

export const TRACK_MATCH_MIN_SCORE = 70;

/**
 * Stable library index key: primary artist + soft title.
 * Written at scan time; findTrack looks this up before yt-dlp.
 */
export function trackMatchKey(artist: string, title: string): string {
  const a = normalizeArtistName(primaryArtistName(artist) || artist);
  const t = normalizeTitle(title);
  if (!a || !t) return "";
  return `${a}|${t}`;
}

/** Search tokens that still find files when catalog names have extra fluff. */
export function matchSearchQueries(artist: string, title: string): string[] {
  const primary = primaryArtistName(artist) || artist.trim();
  const softTitle = normalizeTitle(title);
  const softArtist = normalizeArtistName(primary);
  const titleToken =
    softTitle
      .split(" ")
      .filter((w) => w.length > 1)
      .slice(0, 4)
      .join(" ") || softTitle;
  const artistToken = softArtist.split(" ")[0] || softArtist;

  const out: string[] = [];
  const push = (q: string) => {
    const t = q.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  push(`${primary} ${titleToken}`);
  push(`${artistToken} ${titleToken}`);
  push(titleToken);
  push(title.trim());
  push(softTitle);
  return out;
}
