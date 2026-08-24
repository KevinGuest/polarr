/** Karaoke / lyrics session domain types. */

export type LyricQuality = "synced" | "plain" | "instrumental" | "none";

/** Word timestamp from enhanced LRC (`[mm:ss.xx]word` or `<mm:ss.xx>word`). */
export type LyricWord = {
  time: number;
  text: string;
};

export type LyricLine = {
  /**
   * Seconds from start of the timed document (0 for plain lines).
   * On a karaoke session: warped (LRC × scale) or DTW media timestamps
   * when the local aligner ran. Clock is `progress + offsetSec`.
   */
  time: number;
  text: string;
  /** Present only when the source had real per-word timestamps. */
  words?: LyricWord[];
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
  /**
   * Linear LRC→media scale already applied to `lines` times (1 = identity).
   * When `alignSource` is `dtw`, line times are media timestamps instead
   * (offset is only the user nudge).
   * Clock is still `progress + offsetSec`.
   */
  warpScale: number;
  /** Content onset used when computing the warp (informational). */
  warpOnsetSec: number;
  /**
   * `dtw` = local envelope aligner wrote per-line media times.
   * `warp` = linear LRC×scale fallback. `none` = unsynced / no map.
   */
  alignSource: "dtw" | "warp" | "none";
};

export type ResolveLyricsInput = {
  artist: string;
  title: string;
  album?: string;
  /** Playback length so we prefer LRC timed for this master */
  durationSec?: number | null;
  /** Library / stream track id — enables local vocal alignment */
  trackId?: string | null;
};
