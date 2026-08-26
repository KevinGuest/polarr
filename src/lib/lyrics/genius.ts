/**
 * Genius: official API search (access token) + page scrape for section headers.
 * Used to map duet vocalists onto LRCLIB-timed lines — not as a timing source.
 */
import { getSettings } from "../db";
import { scoreTrackMatch } from "../track-match";
import type { GeniusSection } from "./types";

const UA =
  "Mozilla/5.0 (compatible; Polarr/0.6; +https://github.com/KevinGuest/polarr)";

type GeniusHit = {
  id: number;
  title: string;
  url: string;
  primaryArtist: string;
  fullTitle: string;
};

function accessToken(): string {
  return getSettings().geniusAccessToken.trim();
}

async function searchOfficial(q: string, token: string): Promise<GeniusHit[]> {
  const res = await fetch(
    `https://api.genius.com/search?q=${encodeURIComponent(q)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": UA,
      },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!res.ok) throw new Error(`genius search ${res.status}`);
  const data = (await res.json()) as {
    response?: {
      hits?: Array<{
        type?: string;
        result?: {
          id?: number;
          title?: string;
          url?: string;
          primary_artist?: { name?: string };
          full_title?: string;
        };
      }>;
    };
  };
  const hits: GeniusHit[] = [];
  for (const h of data.response?.hits || []) {
    if (h.type && h.type !== "song") continue;
    const r = h.result;
    if (!r?.id || !r.url || !r.title) continue;
    hits.push({
      id: r.id,
      title: r.title,
      url: r.url,
      primaryArtist: r.primary_artist?.name || "",
      fullTitle: r.full_title || r.title,
    });
  }
  return hits;
}

/** Site search widget — no token required (fallback). */
async function searchPublic(q: string): Promise<GeniusHit[]> {
  const res = await fetch(
    `https://genius.com/api/search/multi?per_page=5&q=${encodeURIComponent(q)}`,
    {
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": UA,
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://genius.com/search/embed",
      },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!res.ok) throw new Error(`genius public search ${res.status}`);
  const data = (await res.json()) as {
    response?: {
      sections?: Array<{
        type?: string;
        hits?: Array<{
          type?: string;
          result?: {
            id?: number;
            title?: string;
            url?: string;
            primary_artist?: { name?: string };
            full_title?: string;
          };
        }>;
      }>;
    };
  };
  const hits: GeniusHit[] = [];
  for (const section of data.response?.sections || []) {
    if (section.type !== "song" && section.type !== "top_hit") continue;
    for (const h of section.hits || []) {
      if (h.type && h.type !== "song") continue;
      const r = h.result;
      if (!r?.id || !r.url || !r.title) continue;
      if (hits.some((x) => x.id === r.id)) continue;
      hits.push({
        id: r.id,
        title: r.title,
        url: r.url,
        primaryArtist: r.primary_artist?.name || "",
        fullTitle: r.full_title || r.title,
      });
    }
  }
  return hits;
}

function pickHit(
  hits: GeniusHit[],
  artist: string,
  title: string,
): GeniusHit | null {
  let best: GeniusHit | null = null;
  let bestScore = 0;
  for (const hit of hits) {
    const score = scoreTrackMatch(
      { artist: hit.primaryArtist || hit.fullTitle, title: hit.title },
      artist,
      title,
    );
    if (score > bestScore) {
      bestScore = score;
      best = hit;
    }
  }
  return bestScore >= 50 ? best : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    });
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(p|div)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\r/g, ""),
  );
}

/** Pull plain lyrics (with [Verse: Artist] headers) from a Genius song page. */
export function extractGeniusLyricsHtml(html: string): string | null {
  const chunks: string[] = [];
  const marker = 'data-lyrics-container="true"';
  let from = 0;
  while (from < html.length) {
    const startAttr = html.indexOf(marker, from);
    if (startAttr < 0) break;
    const openEnd = html.indexOf(">", startAttr);
    if (openEnd < 0) break;
    let i = openEnd + 1;
    let depth = 1;
    while (i < html.length && depth > 0) {
      const nextOpen = html.indexOf("<div", i);
      const nextClose = html.indexOf("</div>", i);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        i = nextOpen + 4;
      } else {
        depth -= 1;
        if (depth === 0) {
          chunks.push(html.slice(openEnd + 1, nextClose));
          from = nextClose + 6;
          break;
        }
        i = nextClose + 6;
      }
    }
    if (depth !== 0) break;
  }
  if (!chunks.length) return null;
  const text = stripTags(chunks.join("\n"))
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

/**
 * Parse Genius plain lyrics into sections.
 * Headers like `[Verse 1: Drake]` / `[Chorus: SZA & Drake]` set speaker.
 */
export function parseGeniusSections(plain: string): GeniusSection[] {
  const sections: GeniusSection[] = [];
  let current: GeniusSection = { speaker: null, label: "", lines: [] };

  const push = () => {
    if (current.label || current.lines.length) sections.push(current);
  };

  for (const raw of plain.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // Skip Genius chrome leftovers
    if (/^(contributors|embed|you might also like)$/i.test(line)) continue;
    if (/\d+\s*contributors$/i.test(line)) continue;

    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      push();
      const label = header[1]!.trim();
      const named = label.match(/:\s*(.+)$/);
      let speaker: string | null = null;
      if (named?.[1]) {
        speaker =
          named[1]
            .split(/,|&|\band\b|\//i)
            .map((s) => s.trim())
            .find(Boolean) || null;
      }
      current = { speaker, label, lines: [] };
      continue;
    }

    // Inline leftover like "Verse 1: Drake" without brackets — rare
    current.lines.push(line);
  }
  push();
  return sections.filter((s) => s.lines.length > 0 || Boolean(s.speaker));
}

async function scrapeLyrics(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`genius page ${res.status}`);
  const html = await res.text();
  return extractGeniusLyricsHtml(html);
}

export async function fetchGeniusSections(input: {
  artist: string;
  title: string;
}): Promise<GeniusSection[] | null> {
  const artist = input.artist.trim();
  const title = input.title.trim();
  if (!artist || !title) return null;

  const q = `${artist} ${title}`;
  const token = accessToken();
  let hits: GeniusHit[] = [];
  try {
    hits = token ? await searchOfficial(q, token) : await searchPublic(q);
  } catch {
    if (token) {
      try {
        hits = await searchPublic(q);
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  const hit = pickHit(hits, artist, title);
  if (!hit) return null;

  try {
    const plain = await scrapeLyrics(hit.url);
    if (!plain) return null;
    const sections = parseGeniusSections(plain);
    const hasSpeaker = sections.some((s) => s.speaker);
    return hasSpeaker ? sections : null;
  } catch {
    return null;
  }
}

/** Admin test: search + optional scrape for one known hit. */
export async function probeGenius(input?: {
  artist?: string;
  title?: string;
}): Promise<{
  ok: boolean;
  mode: "token" | "public";
  hit?: { title: string; url: string; artist: string };
  sections?: number;
  speakers?: string[];
  error?: string;
}> {
  const artist = (input?.artist || "Drake").trim();
  const title = (input?.title || "Slime You Out").trim();
  const token = accessToken();
  const mode = token ? "token" : "public";
  try {
    const hits = token
      ? await searchOfficial(`${artist} ${title}`, token)
      : await searchPublic(`${artist} ${title}`);
    const hit = pickHit(hits, artist, title) || hits[0];
    if (!hit) {
      return { ok: false, mode, error: "No search hits" };
    }
    const plain = await scrapeLyrics(hit.url);
    const sections = plain ? parseGeniusSections(plain) : [];
    const speakers = [
      ...new Set(
        sections.map((s) => s.speaker).filter((s): s is string => Boolean(s)),
      ),
    ];
    return {
      ok: Boolean(plain && sections.length),
      mode,
      hit: {
        title: hit.title,
        url: hit.url,
        artist: hit.primaryArtist,
      },
      sections: sections.length,
      speakers,
      error: plain ? undefined : "Could not scrape lyrics HTML",
    };
  } catch (err) {
    return {
      ok: false,
      mode,
      error: err instanceof Error ? err.message : "Genius probe failed",
    };
  }
}
