/**
 * Soft track matching — strip fluff, compare bones.
 * Used so local library wins before yt-dlp live fallback.
 */

import { extractFeaturedArtists } from "@/lib/utils";

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

/** Extra tokens allowed after a shared title stem (not a different song). */
const TITLE_VERSION_TOKEN =
  /^(remix|remaster(?:ed)?|reprise|edit|version|mix|instrumental|acoustic|deluxe|extended|radio|mono|stereo|live|demo|bonus|interlude|intro|outro|official|audio|lyric|lyrics|video|visualizer|hq|hd|4k|topic)$/i;

export function titlesMatch(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Prefix only at a word boundary, and only when the remainder is a
  // version/qualifier — never "Love" ≈ "Love Story".
  const [longer, shorter] = na.length >= nb.length ? [na, nb] : [nb, na];
  if (!longer.startsWith(`${shorter} `)) return false;
  const extra = longer
    .slice(shorter.length)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return extra.length > 0 && extra.every((t) => TITLE_VERSION_TOKEN.test(t));
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

export type SearchHitFields = {
  title: string;
  artist: string;
  album?: string;
};

/**
 * Title-first ranking so “Love me drake” beats popular Drake songs that
 * don’t match the title. Artist/feat tokens still help break ties.
 */
export function scoreSearchHit(query: string, hit: SearchHitFields): number {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return 0;

  const title = hit.title.trim().toLowerCase();
  const titleCore = title
    .replace(/\s*[\(\[][^)\]]*feat[^)\]]*[\)\]]/gi, "")
    .replace(/\s*[\(\[][^)\]]*ft\.?[^)\]]*[\)\]]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const artist = hit.artist.trim().toLowerCase();
  const album = (hit.album || "").trim().toLowerCase();
  const hay = `${title} ${artist} ${album}`;

  if (titleCore === q || title === q) return 10_000;
  if (`${artist} - ${titleCore}` === q || `${titleCore} - ${artist}` === q) {
    return 9_800;
  }

  const tokens = q.split(" ").filter((t) => t.length > 0);
  if (tokens.length === 0) return 0;

  let phraseBonus = 0;
  for (let n = tokens.length; n >= 1; n--) {
    const phrase = tokens.slice(0, n).join(" ");
    if (titleCore === phrase || title === phrase) {
      phraseBonus = 5_000 + n * 200;
      break;
    }
    if (titleCore.startsWith(phrase) || title.includes(phrase)) {
      phraseBonus = Math.max(phraseBonus, 2_500 + n * 150);
    }
  }

  let titleHits = 0;
  let artistHits = 0;
  let otherHits = 0;
  let missing = 0;
  for (const tok of tokens) {
    if (titleCore.includes(tok) || title.includes(tok)) titleHits += 1;
    else if (artist.includes(tok)) artistHits += 1;
    else if (album.includes(tok) || hay.includes(tok)) otherHits += 1;
    else missing += 1;
  }

  if (titleHits === 0 && phraseBonus === 0) {
    return artistHits * 25 + otherHits * 5 - missing * 40;
  }

  return (
    phraseBonus +
    titleHits * 400 +
    artistHits * 120 +
    otherHits * 20 -
    missing * 30 +
    (titleHits === tokens.length ? 800 : 0)
  );
}

/** On-disk copies beat an equal stream/catalog hit. */
export function scoreLibrarySearchHit(
  query: string,
  hit: SearchHitFields,
  onPolarr = false,
): number {
  return scoreSearchHit(query, hit) + (onPolarr ? 2_500 : 0);
}

/**
 * Query tokens for library search. Drops punctuation so “don't” still
 * hits match_key rows stored as “dont”.
 */
export function tokenizeSearchQuery(q: string): string[] {
  const s = q
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[‘’´`]/g, "'");
  const tokens = s
    .split(/[^a-z0-9']+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 8) break;
  }
  return out;
}

function creditParts(credit: string): string[] {
  return credit
    .split(/\s*[,&]\s*|\s+(?:feat\.?|ft\.?|featuring|and|x|with)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when this name is the lead (primary) credit. */
export function isPrimaryArtistCredit(
  artistCredit: string,
  target: string,
): boolean {
  return namesMatch(primaryArtistName(artistCredit) || artistCredit, target);
}

/**
 * True when the artist is on the track as lead or a featured / collab credit.
 */
export function creditIncludesArtist(
  artistCredit: string,
  title: string,
  target: string,
): boolean {
  if (!target.trim()) return false;
  if (isPrimaryArtistCredit(artistCredit, target)) return true;
  if (creditParts(artistCredit).some((p) => namesMatch(p, target))) return true;
  return extractFeaturedArtists(title).some((f) => namesMatch(f, target));
}

/**
 * 1–3 word queries that look like an artist name (e.g. “KILLY”), not a lyric line.
 */
export function isArtistNameQuery(query: string): boolean {
  const term = query.trim();
  if (!term) return false;
  const words = term.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 3 && term.length >= 2;
}

export function artistNameMatchesQuery(
  artistName: string,
  query: string,
): boolean {
  if (!isArtistNameQuery(query)) return false;
  if (namesMatch(artistName, query)) return true;
  const a = normalizeArtistName(artistName);
  const q = normalizeArtistName(query);
  return Boolean(a && q && a === q);
}

/**
 * Rank tracks for an artist-name search: their songs first, then features.
 */
export function scoreArtistSearchHit(
  artistName: string,
  hit: SearchHitFields,
  onPolarr = false,
): number {
  let score = 0;
  if (isPrimaryArtistCredit(hit.artist, artistName)) score += 8_000;
  else if (creditIncludesArtist(hit.artist, hit.title, artistName))
    score += 5_500;
  else return scoreSearchHit(artistName, hit) + (onPolarr ? 250 : 0);

  if (onPolarr) score += 400;
  return score;
}
