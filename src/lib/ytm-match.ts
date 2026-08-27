/**
 * Polarr YTM audio resolver.
 *
 * Prefer Official Audio / Topic hits that actually match the requested artist.
 * Title-only Topic collisions (same song name, different artist) are rejected.
 */
import { spawn } from "node:child_process";
import {
  namesMatch,
  normalizeArtistName,
  primaryArtistName,
  titlesMatch,
} from "./track-match";
import { ensureYtDlp } from "./tools";

const SEARCH_LIMIT = 10;

/** Minimum artist token overlap (or namesMatch) to accept a hit. */
const MIN_ARTIST_AGREE = 0.4;

const JUNK_IN_TITLE =
  /\b(official\s*(music\s*)?video|music\s*video|\bm\/?v\b|lyric\s*video|\blyrics?\b|\blive\b|concert|performance|visualizer|vevo\s*visual|react(ion)?s?|cover|karaoke|instrumental|slowed|reverb|8d\s*audio|sped\s*up|nightcore|bass\s*boost|1\s*hour|hour\s*loop|full\s*album|mashup|bootleg)\b/i;

const OFFICIAL_AUDIO_TITLE =
  /\b(official\s*audio|audio\s*only|full\s*audio|provided\s*to\s*youtube)\b/i;

const TOPIC_CHANNEL = /\s-\s*topic$/i;

export const YTM_AUDIO_FORMAT =
  "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best";

/** Cap concurrent yt-dlp children so multi-user cold resolves don't melt the host. */
const YTDLP_MAX_CONCURRENT = 2;
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
  timeoutMs = 28_000,
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
  const result = await runYtDlp(ytDlp, [
    querySpec,
    "--flat-playlist",
    "-J",
    "--no-warnings",
    "--skip-download",
    "--playlist-end",
    String(SEARCH_LIMIT),
  ]);
  if (!result.stdout.trim()) return [];
  try {
    return normalizeEntries(JSON.parse(result.stdout));
  } catch {
    return [];
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
 * Match Official Audio first, then YT Music, then plain YT.
 * Returns null when no hit clears the artist gate (no wrong-artist fallback).
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

  const musicQ = encodeURIComponent(base);

  const tiers: {
    kind: "official" | "music" | "plain";
    spec: string;
    boost: number;
  }[] = [
    {
      kind: "official",
      spec: `ytsearch${SEARCH_LIMIT}:${base} official audio`,
      boost: 35,
    },
    {
      kind: "official",
      spec: `ytsearch${SEARCH_LIMIT}:"${artist}" "${title}" official audio`,
      boost: 32,
    },
    {
      kind: "official",
      spec: `ytsearch${SEARCH_LIMIT}:${artist} - ${title} (Official Audio)`,
      boost: 28,
    },
    {
      kind: "music",
      spec: `https://music.youtube.com/search?q=${encodeURIComponent(`${base} official audio`)}`,
      boost: 18,
    },
    {
      kind: "music",
      spec: `https://music.youtube.com/search?q=${musicQ}`,
      boost: 12,
    },
    {
      kind: "plain",
      spec: `ytsearch${SEARCH_LIMIT}:${base}`,
      boost: 0,
    },
  ];

  const seen = new Set<string>();
  const hits: YtmCandidate[] = [];

  for (const tier of tiers) {
    if (
      tier.kind === "plain" &&
      hits.some(
        (h) =>
          h.isOfficialAudio &&
          h.artistAgree >= MIN_ARTIST_AGREE &&
          h.score >= 40,
      )
    ) {
      break;
    }

    const entries = await dumpSearchList(ytDlp, tier.spec);
    for (const e of entries) {
      const c = toCandidate(e, artist, title, input.expectedDurationSec);
      if (!c || seen.has(c.videoId)) continue;
      c.score += tier.boost;
      if (tier.kind === "official" && c.isOfficialAudio) c.score += 15;
      seen.add(c.videoId);
      hits.push(c);
    }

    // Strong Official Audio that also matches the artist
    if (
      hits.some(
        (h) =>
          h.isOfficialAudio &&
          h.artistAgree >= 0.55 &&
          h.score >= 85,
      )
    ) {
      break;
    }
  }

  return pickBest(hits, title);
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
      "10",
      "--extractor-args",
      "youtube:player_client=android,web",
    ],
    20_000,
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
 * No blind ytsearch1 fallback — that was a common wrong-artist source.
 */
export async function resolveYtmStreamRemote(input: {
  artist: string;
  title: string;
  query?: string;
  expectedDurationSec?: number | null;
}): Promise<string | null> {
  const match = await matchYtmAudio(input);
  if (!match) return null;
  return resolveYtmMediaUrl(match.url);
}

/** Safe filesystem segment for known artist/title output names. */
export function safeFilenamePart(s: string, fallback = "track"): string {
  const cleaned = s
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}
