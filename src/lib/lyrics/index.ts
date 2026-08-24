export type {
  LyricLine,
  LyricWord,
  LyricDocument,
  LyricSession,
  LyricQuality,
  ResolveLyricsInput,
} from "./types";
export {
  parseLrc,
  plainLines,
  lyricSpanSec,
  lyricLineEndSec,
  lyricLineFill01,
  lyricWordFill01,
} from "./parse-lrc";
export { resolveLyrics, lyricsCacheKey } from "./resolve";
export {
  suggestLyricsOffsetSec,
  clampLyricsOffset,
  fuseLyricsOffsetSuggestions,
  offsetFromMediaOnsetSec,
  computeLyricsWarp,
  warpLyricLines,
  warpLrcTime,
  lyricLineSeekSec,
  clampWarpScale,
  WARP_SCALE_MIN,
  WARP_SCALE_MAX,
} from "./align";
export type { LyricsWarp } from "./align";
export {
  detectMediaOnsetSec,
  detectMediaContentBounds,
  parseLeadingOnsetSec,
  parseTrailingSilenceSec,
} from "./onset";
export {
  alignLinesToEnvelope,
  forceAlignLyricLines,
  resolveAlignAudio,
} from "./force-align";
export type { ForceAlignResult } from "./force-align";
