/**
 * Polarr YTM audio resolver.
 *
 * Prefer Official Audio / Topic hits that actually match the requested artist.
 * Title-only Topic collisions (same song name, different artist) are rejected.
 */
import { spawn } from "node:child_process";
import { getDb } from "./db";
import {
  namesMatch,
  normalizeArtistName,
  primaryArtistName,
  titlesMatch,
} from "./track-match";
import { ensureYtDlp } from "./tools";

const SEARCH_LIMIT = 5;

/** Minimum artist token overlap (or namesMatch) to accept a hit. */
const MIN_ARTIST_AGREE = 0.4;

/** Persist videoId matches so cold plays don't re-run the search ladder. */
const YTM_MATCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const YTM_NEG_TTL_MS = 6 * 60 * 60 * 1000;

const JUNK_IN_TITLE =
  /\b(official\s*(music\s*)?video|music\s*video|\bm\/?v\b|lyric\s*video|\blyrics?\b|\blive\b|concert|performance|visualizer|vevo\s*visual|react(ion)?s?|cover|karaoke|instrumental|slowed|reverb|8d\s*audio|sped\s*up|nightcore|bass\s*boost|1\s*hour|hour\s*loop|full\s*album|mashup|bootleg)\b/i;

const OFFICIAL_AUDIO_TITLE =
  /\b(official\s*audio|audio\s*only|full\s*audio|provided\s*to\s*youtube)\b/i;

const TOPIC_CHANNEL = /\s-\s*topic$/i;

export const YTM_AUDIO_FORMAT =
  "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best";

/** Cap concurrent yt-dlp children so multi-user cold resolves don't melt the host. */
const YTDLP_MAX_CONCURRENT = 4;
let ytdlpActive = 0;
const ytdlpWait: Array<() => void> = [];

async function withYtDlpSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (ytdlpActive >= YTDLP_MAX_CONCURRENT) {
    await new Promise<void>((resolve) => {
      ytdlpWait.push(resolve);
    });
  }
  ytdlpActive += 1;
  try {
    return await fn();
  } finally {
    ytdlpActive -= 1;
    const next = ytdlpWait.shift();
    if (next) next();
  }
}

export type YtmCandidate = {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number | null;
  url: string;
  score: number;
  /** Official Audio / Topic — preferred default surface */
  isOfficialAudio: boolean;
  /** 0..1 how well channel/title agrees with requested artist */
  artistAgree: number;
};

type FlatEntry = {
  id?: string;
  title?: string;
  fulltitle?: string;
  channel?: string;
  uploader?: string;
  duration?: number;
  webpage_url?: string;
  url?: string;
};

function runYtDlp(
  ytDlp: string,
  args: string[],
  timeoutMs = 12_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return withYtDlpSlot(
    () =>
      new Promise((resolve) => {
        const child = spawn(ytDlp, args, {
          shell: false,
          env: process.env,
          windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          try {
            child.kill("SIGTERM");
          } catch {
            /* ignore */
          }
          resolve({ code: 1, stdout, stderr: stderr || "yt-dlp timed out" });
        }, timeoutMs);
        if (typeof timer === "object" && "unref" in timer) timer.unref();

        child.stdout?.on("data", (buf: Buffer) => {
          stdout += buf.toString();
        });
        child.stderr?.on("data", (buf: Buffer) => {
          stderr += buf.toString();
        });
        child.on("error", (err) => {
          clearTimeout(timer);
          resolve({ code: 1, stdout, stderr: err.message });
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ code: code ?? 1, stdout, stderr });
        });
      }),
  );
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function tokenOverlap(needles: string, haystack: string): number {
  const need = tokens(needles);
  if (!need.length) return 0;
  const hay = new Set(tokens(haystack));
  let hit = 0;
  for (const t of need) if (hay.has(t)) hit += 1;
  return hit / need.length;
}

function bareTitle(s: string): string {
  return s
    .toLowerCase()
    .split("(")[0]!
    .split("[")[0]!
    .replace(/\s*-\s*(official|audio|video).*$/i, "")
    .trim();
}

function isTopic(ch: string): boolean {
  return TOPIC_CHANNEL.test(ch) || /\btopic\b/i.test(ch);
}

function topicArtistName(channel: string): string {
  return channel.replace(/\s-\s*topic$/i, "").trim();
}

function isOfficialAudioHit(title: string, channel: string): boolean {
  if (JUNK_IN_TITLE.test(title)) return false;
  if (OFFICIAL_AUDIO_TITLE.test(title)) return true;
  if (isTopic(channel)) return true;
  if (/provided\s*to\s*youtube/i.test(title)) return true;
  return false;
}

/**
 * How well this hit’s *channel* matches the catalog artist (0..1).
 * Topic identity is the channel (“Artist - Topic”), never a title mention
 * like “feat. Drake” on another artist’s Official Audio.
 */
export function artistAgreement(
  artist: string,
  channel: string,
  videoTitle: string,
): number {
  const want = primaryArtistName(artist) || artist.trim();
  if (!want) return 0;
  const chBare = topicArtistName(channel);

  if (isTopic(channel)) {
    if (namesMatch(want, chBare) || namesMatch(artist, chBare)) return 1;
    return tokenOverlap(want, chBare);
  }

  if (namesMatch(want, chBare) || namesMatch(artist, chBare)) return 1;

  const nWant = normalizeArtistName(want).replace(/\s+/g, "");
  const nCh = normalizeArtistName(chBare).replace(/\s+/g, "");
  if (nWant.length >= 3 && nCh.includes(nWant)) return 0.85;
  if (
    nCh.length >= 3 &&
    nWant.includes(nCh) &&
    nCh.length / Math.max(nWant.length, 1) >= 0.5
  ) {
    return 0.85;
  }

  const byChannel = tokenOverlap(want, chBare);
  if (byChannel >= MIN_ARTIST_AGREE) return byChannel;

  // Title mention is not identity — cap below the artist gate.
  const byTitle = tokenOverlap(want, videoTitle);
  return Math.min(byTitle * 0.45, MIN_ARTIST_AGREE - 0.05);
}

/** Requested catalog title vs YouTube title — fail closed on different songs. */
export function ytmTitlesAgree(wantTitle: string, videoTitle: string): boolean {
  const want = (wantTitle || "").trim();
  const got = (videoTitle || "").trim();
  if (!want || !got) return false;
  if (titlesMatch(want, got)) return true;
  const w = bareTitle(want);
  const v = bareTitle(got);
  if (w && v && titlesMatch(w, v)) return true;
  const afterDash = v.replace(/^.+?\s[-–—]\s+/, "").trim();
  if (afterDash && titlesMatch(w, afterDash)) return true;
  return false;
}

/**
 * Score a hit. Official Audio / Topic preferred only when artist agrees.
 */
export function scoreYtmCandidate(
  entry: {
    title: string;
    channel: string;
    durationSec: number | null;
  },
  artist: string,
  title: string,
  expectedDurationSec?: number | null,
): number {
  const t = entry.title.trim();
  const ch = entry.channel.trim();
  const agree = artistAgreement(artist, ch, t);
  let score = 0;

  // Default surface: official audio + Topic — gated by artist
  if (agree >= MIN_ARTIST_AGREE) {
    if (isTopic(ch)) score += 70;
    if (OFFICIAL_AUDIO_TITLE.test(t)) score += 75;
    if (/provided\s*to\s*youtube/i.test(t)) score += 35;
  } else {
    // Same-title Topic from another artist must not win
    if (isTopic(ch) || OFFICIAL_AUDIO_TITLE.test(t)) score -= 40;
  }

  // Music videos / live / junk — strongly deprioritize
  if (JUNK_IN_TITLE.test(t)) score -= 100;
  if (/vevo/i.test(ch) && !OFFICIAL_AUDIO_TITLE.test(t) && !isTopic(ch)) {
    score -= 40;
  }

  score += Math.round(agree * 90);
  score += Math.round(tokenOverlap(title, t) * 50);

  const titleLc = title.trim().toLowerCase();
  const tLc = t.toLowerCase();
  if (titleLc && bareTitle(tLc) === bareTitle(titleLc)) score += 14;
  else if (titleLc && tLc.includes(titleLc)) score += 10;

  // Hard reject: essentially no artist signal
  if (agree < 0.2) score -= 120;

  const expected = expectedDurationSec;
  const dur = entry.durationSec;
  if (typeof expected === "number" && expected > 25 && dur && dur > 0) {
    const diff = Math.abs(dur - expected);
    const over = dur - expected;
    if (diff <= 5) score += 28;
    else if (diff <= 12) score += 16;
    else if (diff <= 25) score += 6;
    if (over >= 30) score -= 28;
    if (over >= 60) score -= 40;
    if (diff > 90) score -= 35;
  } else if (dur) {
    if (dur > 12 * 60) score -= 22;
    if (dur > 0 && dur < 40) score -= 14;
  }

  return score;
}

function normalizeEntries(raw: unknown): FlatEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as { entries?: FlatEntry[]; id?: string; title?: string };
  if (Array.isArray(obj.entries)) return obj.entries.filter(Boolean);
  if (obj.id || obj.title) return [obj as FlatEntry];
  return [];
}

function toCandidate(
  e: FlatEntry,
  artist: string,
  title: string,
  expectedDurationSec?: number | null,
): YtmCandidate | null {
  const id = (e.id || "").trim();
  if (!id || id.startsWith("ytsearch") || id.length < 6) return null;
  if (!/^[\w-]{6,}$/.test(id)) return null;

  const name = (e.title || e.fulltitle || "").trim();
  const channel = (e.channel || e.uploader || "").trim();
  const durationSec =
    typeof e.duration === "number" && Number.isFinite(e.duration)
      ? e.duration
      : null;
  const artistAgree = artistAgreement(artist, channel, name);
  const score = scoreYtmCandidate(
    { title: name, channel, durationSec },
    artist,
    title,
    expectedDurationSec,
  );

  return {
    videoId: id,
    title: name || title,
    channel,
    durationSec,
    url: `https://music.youtube.com/watch?v=${id}`,
    score,
    isOfficialAudio: isOfficialAudioHit(name, channel),
    artistAgree,
  };
}

async function dumpSearchList(
  ytDlp: string,
  querySpec: string,
): Promise<FlatEntry[]> {
  const result = await runYtDlp(
    ytDlp,
    [
      querySpec,
      "--flat-playlist",
      "-J",
      "--no-warnings",
      "--skip-download",
      "--socket-timeout",
      "6",
      "--playlist-end",
      String(SEARCH_LIMIT),
    ],
    7_000,
  );
  if (!result.stdout.trim()) return [];
  try {
    return normalizeEntries(JSON.parse(result.stdout));
  } catch {
    return [];
  }
}

/**
 * One yt-dlp process: ytsearch1 + format pick + stream URL.
 * Typical cold path ~2–5s instead of search-then-resolve.
 */
async function singleShotStream(
  ytDlp: string,
  searchQuery: string,
  artist: string,
  title: string,
  expectedDurationSec?: number | null,
): Promise<{ candidate: YtmCandidate; mediaUrl: string } | null> {
  const result = await runYtDlp(
    ytDlp,
    [
      `ytsearch1:${searchQuery}`,
      "-f",
      YTM_AUDIO_FORMAT,
      "--print",
      "%(id)s\t%(title)s\t%(channel)s\t%(duration)s\t%(url)s",
      "--no-playlist",
      "--no-warnings",
      "--socket-timeout",
      "6",
      "--extractor-args",
      "youtube:player_client=android,web",
    ],
    9_000,
  );
  if (result.code !== 0 || !result.stdout.trim()) return null;

  const line = result.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.includes("\t") && /https?:\/\//i.test(l));
  if (!line) return null;

  const [id = "", name = "", channel = "", durationRaw = "", mediaUrl = ""] =
    line.split("\t");
  if (!id || !/^https?:\/\//i.test(mediaUrl)) return null;

  const durationSec = Number(durationRaw);
  const candidate = toCandidate(
    {
      id,
      title: name,
      channel,
      duration: Number.isFinite(durationSec) ? durationSec : undefined,
    },
    artist,
    title,
    expectedDurationSec,
  );
  if (!candidate) return null;
  if (candidate.artistAgree < MIN_ARTIST_AGREE) return null;
  if (!ytmTitlesAgree(title, candidate.title)) return null;
  if (JUNK_IN_TITLE.test(candidate.title) && !candidate.isOfficialAudio) {
    return null;
  }
  // Reject obviously weak picks from ytsearch1
  if (candidate.score < 25) return null;

  return { candidate, mediaUrl };
}

function strongEnough(hit: YtmCandidate): boolean {
  return (
    hit.artistAgree >= 0.55 &&
    hit.score >= 70 &&
    (hit.isOfficialAudio || hit.artistAgree >= 0.75)
  );
}

function ytmMatchKey(artist: string, title: string): string {
  return `v1|${normalizeArtistName(primaryArtistName(artist))}|${title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")}`;
}

function ensureYtmMatchTable() {
  try {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS ytm_match_cache (
        query_key TEXT PRIMARY KEY,
        video_id TEXT,
        page_url TEXT,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ytm_match_expires ON ytm_match_cache(expires_at);
    `);
  } catch {
    /* best-effort */
  }
}

function readYtmMatchCache(key: string): { videoId: string; pageUrl: string } | null | undefined {
  // undefined = miss; null = negative cached
  try {
    ensureYtmMatchTable();
    const row = getDb()
      .prepare(
        `SELECT video_id as videoId, page_url as pageUrl, expires_at as expiresAt
         FROM ytm_match_cache WHERE query_key = ?`,
      )
      .get(key) as
      | { videoId: string | null; pageUrl: string | null; expiresAt: number }
      | undefined;
    if (!row) return undefined;
    if (row.expiresAt <= Date.now()) {
      getDb().prepare(`DELETE FROM ytm_match_cache WHERE query_key = ?`).run(key);
      return undefined;
    }
    if (!row.videoId) return null;
    return { videoId: row.videoId, pageUrl: row.pageUrl || `https://www.youtube.com/watch?v=${row.videoId}` };
  } catch {
    return undefined;
  }
}

function writeYtmMatchCache(
  key: string,
  hit: { videoId: string; pageUrl: string } | null,
) {
  try {
    ensureYtmMatchTable();
    getDb()
      .prepare(
        `INSERT INTO ytm_match_cache(query_key, video_id, page_url, expires_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(query_key) DO UPDATE SET
           video_id = excluded.video_id,
           page_url = excluded.page_url,
           expires_at = excluded.expires_at`,
      )
      .run(
        key,
        hit?.videoId ?? null,
        hit?.pageUrl ?? null,
        Date.now() + (hit ? YTM_MATCH_TTL_MS : YTM_NEG_TTL_MS),
      );
  } catch {
    /* ignore */
  }
}

function pickBest(
  hits: YtmCandidate[],
  wantTitle: string,
): YtmCandidate | null {
  if (!hits.length) return null;

  // Artist gate — never return another artist’s Official Audio / Topic
  const agreed = hits.filter((h) => h.artistAgree >= MIN_ARTIST_AGREE);
  if (!agreed.length) return null;

  // Title gate — never return a different song from the same artist
  const titled = agreed.filter((h) => ytmTitlesAgree(wantTitle, h.title));
  if (!titled.length) return null;

  let pool = titled;
  const noJunk = pool.filter((h) => !JUNK_IN_TITLE.test(h.title));
  pool = noJunk.length ? noJunk : pool;

  const official = pool.filter((h) => h.isOfficialAudio && h.score >= 10);
  if (official.length) pool = official;

  const ranked = pool.slice().sort((a, b) => {
    if (b.artistAgree !== a.artistAgree) return b.artistAgree - a.artistAgree;
    return b.score - a.score;
  });
  const best = ranked[0]!;
  if (best.score < -35) return null;
  return (
    ranked.find((h) => h.score >= 15 && h.artistAgree >= MIN_ARTIST_AGREE) ||
    ranked.find((h) => h.score >= 0 && h.artistAgree >= 0.55) ||
    null
  );
}

/**
 * Find a ranked YouTube Music / Official Audio match (watch URL).
 * Downloads use this; live play prefers {@link resolveYtmStreamRemote}.
 */
export async function matchYtmAudio(input: {
  artist: string;
  title: string;
  query?: string;
  expectedDurationSec?: number | null;
}): Promise<YtmCandidate | null> {
  const ytDlp = await ensureYtDlp();
  if (!ytDlp) return null;

  const artist = primaryArtistName(input.artist || "") || (input.artist || "").trim();
  const title = (input.title || "").trim();
  const base =
    `${artist} ${title}`.trim() ||
    (input.query || "").trim() ||
    `${artist} ${title}`.trim();
  if (!base || !artist || !title) return null;

  const cacheKey = ytmMatchKey(artist, title);
  const cached = readYtmMatchCache(cacheKey);
  if (cached === null) return null;
  if (cached) {
    return {
      videoId: cached.videoId,
      title,
      channel: "",
      durationSec: null,
      url: cached.pageUrl,
      score: 100,
      isOfficialAudio: true,
      artistAgree: 1,
    };
  }

  // One-shot metadata (same process as stream resolve, keeps caches warm)
  for (const q of [`"${artist}" "${title}" official audio`, base]) {
    const shot = await singleShotStream(
      ytDlp,
      q,
      artist,
      title,
      input.expectedDurationSec,
    );
    if (!shot) continue;
    writeYtmMatchCache(cacheKey, {
      videoId: shot.candidate.videoId,
      pageUrl:
        shot.candidate.url ||
        `https://www.youtube.com/watch?v=${shot.candidate.videoId}`,
    });
    return shot.candidate;
  }

  const best = await flatSearchBest(
    ytDlp,
    artist,
    title,
    base,
    input.expectedDurationSec,
  );
  if (best) {
    writeYtmMatchCache(cacheKey, {
      videoId: best.videoId,
      pageUrl: best.url || `https://www.youtube.com/watch?v=${best.videoId}`,
    });
  } else {
    writeYtmMatchCache(cacheKey, null);
  }
  return best;
}

async function flatSearchBest(
  ytDlp: string,
  artist: string,
  title: string,
  base: string,
  expectedDurationSec?: number | null,
): Promise<YtmCandidate | null> {
  const tiers = [
    {
      kind: "official" as const,
      spec: `ytsearch${SEARCH_LIMIT}:"${artist}" "${title}" official audio`,
      boost: 35,
    },
    {
      kind: "plain" as const,
      spec: `ytsearch${SEARCH_LIMIT}:${base}`,
      boost: 0,
    },
  ];

  const hits: YtmCandidate[] = [];
  const seen = new Set<string>();
  let early: YtmCandidate | null = null;

  await Promise.all(
    tiers.map(async (tier) => {
      if (early) return;
      const entries = await dumpSearchList(ytDlp, tier.spec);
      if (early) return;
      for (const e of entries) {
        const c = toCandidate(e, artist, title, expectedDurationSec);
        if (!c || seen.has(c.videoId)) continue;
        c.score += tier.boost;
        if (tier.kind === "official" && c.isOfficialAudio) c.score += 15;
        seen.add(c.videoId);
        hits.push(c);
        if (strongEnough(c)) {
          early = c;
          break;
        }
      }
    }),
  );

  return early || pickBest(hits, title);
}

/** Progressive media URL for live streaming (may expire). */
export async function resolveYtmMediaUrl(
  pageOrIdUrl: string,
): Promise<string | null> {
  const ytDlp = await ensureYtDlp();
  if (!ytDlp) return null;

  const result = await runYtDlp(
    ytDlp,
    [
      pageOrIdUrl,
      "-g",
      "-f",
      YTM_AUDIO_FORMAT,
      "--no-playlist",
      "--no-warnings",
      "--socket-timeout",
      "6",
      "--extractor-args",
      "youtube:player_client=android,web",
    ],
    12_000,
  );
  if (result.code !== 0) return null;
  return (
    result.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /^https?:\/\//i.test(l)) || null
  );
}

/**
 * Match → streamable media URL.
 * Fast path: one yt-dlp process (search + URL). Fallback: flat race + -g.
 */
export async function resolveYtmStreamRemote(input: {
  artist: string;
  title: string;
  query?: string;
  expectedDurationSec?: number | null;
}): Promise<string | null> {
  const ytDlp = await ensureYtDlp();
  if (!ytDlp) return null;

  const artist = primaryArtistName(input.artist || "") || (input.artist || "").trim();
  const title = (input.title || "").trim();
  const base =
    `${artist} ${title}`.trim() ||
    (input.query || "").trim() ||
    `${artist} ${title}`.trim();
  if (!base || !artist || !title) return null;

  const cacheKey = ytmMatchKey(artist, title);
  const cached = readYtmMatchCache(cacheKey);
  if (cached === null) return null;
  if (cached) {
    return resolveYtmMediaUrl(cached.pageUrl);
  }

  // 1) One-shot official audio (search + stream URL in a single process)
  const officialShot = await singleShotStream(
    ytDlp,
    `"${artist}" "${title}" official audio`,
    artist,
    title,
    input.expectedDurationSec,
  );
  if (officialShot) {
    writeYtmMatchCache(cacheKey, {
      videoId: officialShot.candidate.videoId,
      pageUrl:
        officialShot.candidate.url ||
        `https://www.youtube.com/watch?v=${officialShot.candidate.videoId}`,
    });
    return officialShot.mediaUrl;
  }

  // 2) One-shot plain query
  const plainShot = await singleShotStream(
    ytDlp,
    base,
    artist,
    title,
    input.expectedDurationSec,
  );
  if (plainShot) {
    writeYtmMatchCache(cacheKey, {
      videoId: plainShot.candidate.videoId,
      pageUrl:
        plainShot.candidate.url ||
        `https://www.youtube.com/watch?v=${plainShot.candidate.videoId}`,
    });
    return plainShot.mediaUrl;
  }

  // 3) Flat-search race, then one -g (no second one-shot pass)
  const best = await flatSearchBest(
    ytDlp,
    artist,
    title,
    base,
    input.expectedDurationSec,
  );
  if (!best) {
    writeYtmMatchCache(cacheKey, null);
    return null;
  }

  writeYtmMatchCache(cacheKey, {
    videoId: best.videoId,
    pageUrl: best.url || `https://www.youtube.com/watch?v=${best.videoId}`,
  });
  return resolveYtmMediaUrl(best.url);
}

/** Safe filesystem segment for known artist/title output names. */
export function safeFilenamePart(s: string, fallback = "track"): string {
  const cleaned = s
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\.\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  return cleaned;
}
