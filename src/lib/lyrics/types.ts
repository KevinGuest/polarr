/** Karaoke / lyrics session domain types. */

export type LyricQuality = "synced" | "plain" | "instrumental" | "none";

/** Word timestamp from enhanced LRC (`[mm:ss.xx]word` or `<mm:ss.xx>word`). */
export type LyricWord = {
  time: number;
  text: string;
};

export type LyricLine = {
  /** Seconds from the lyrics source (LRCLIB LRC stamps). 0 for plain lines. */
  time: number;
  text: string;
  /** Present only when the source had real per-word timestamps. */
  words?: LyricWord[];
};

/** Genius section with optional named vocalist (from `[Verse 1: Drake]`). */
export type GeniusSection = {
  speaker: string | null;
  label: string;
  lines: string[];
};

export type LyricDocument = {
  quality: LyricQuality;
  lines: LyricLine[];
  /** Provider id e.g. lrclib */
  source: string;
  /** Remote provider record duration when known */
  sourceDurationSec: number | null;
  /** Provider raw id if any */
  externalId: string | null;
  instrumental: boolean;
  found: boolean;
  /** Genius structure for duet left/right when available. */
  geniusSections?: GeniusSection[] | null;
};

export type LyricSession = LyricDocument & {
  /** Cache key used for storage */
  cacheKey: string;
  /** Media duration used for matching (client pass-through). */
  mediaDurationSec: number | null;
};

export type ResolveLyricsInput = {
  artist: string;
  title: string;
  album?: string;
  /** Playback length so we prefer LRC timed for this master */
  durationSec?: number | null;
  trackId?: string | null;
};
