/** Karaoke / lyrics session domain types. */

export type LyricQuality = "synced" | "plain" | "instrumental" | "none";

export type LyricLine = {
  /** Seconds from start of the timed document (0 for plain lines). */
  time: number;
  text: string;
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
};

/** How the auto offset was chosen (before user override). */
export type OffsetSuggestSource = "audio" | "duration" | "none";

export type LyricSession = LyricDocument & {
  /** Effective offset applied to player progress for line mapping */
  offsetSec: number;
  /** Auto suggestion from track analysis / duration (for UI) */
  offsetSuggested: number;
  /** True when the user explicitly set/saved an offset */
  offsetUserSet: boolean;
  /** What produced offsetSuggested */
  offsetSource: OffsetSuggestSource;
  /** Cache key used for storage / per-track prefs */
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
  /** Library / stream track id — enables ffmpeg onset alignment */
  trackId?: string | null;
};
