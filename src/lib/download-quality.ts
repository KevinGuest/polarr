/**
 * Download quality presets for the fallback (yt-dlp) pipeline.
 * Admin picks one under Admin → Quality; downloads convert with ffmpeg.
 */
export type DownloadQuality = "lossless" | "high" | "standard" | "compact";

export const DEFAULT_DOWNLOAD_QUALITY: DownloadQuality = "high";

export const DOWNLOAD_QUALITIES: {
  id: DownloadQuality;
  label: string;
  detail: string;
}[] = [
  {
    id: "lossless",
    label: "Lossless",
    detail: "FLAC — largest files, audio kept exactly as downloaded",
  },
  {
    id: "high",
    label: "High",
    detail: "MP3 ~320 kbps — near-transparent, sensible default",
  },
  {
    id: "standard",
    label: "Standard",
    detail: "MP3 ~190 kbps — good quality, smaller files",
  },
  {
    id: "compact",
    label: "Compact",
    detail: "MP3 ~128 kbps — smallest files",
  },
];

export function isDownloadQuality(v: string): v is DownloadQuality {
  return DOWNLOAD_QUALITIES.some((q) => q.id === v);
}

/** yt-dlp audio extraction args for a preset. */
export function ytDlpAudioArgs(quality: DownloadQuality): string[] {
  switch (quality) {
    case "lossless":
      return ["--audio-format", "flac", "--audio-quality", "0"];
    case "standard":
      return ["--audio-format", "mp3", "--audio-quality", "2"];
    case "compact":
      return ["--audio-format", "mp3", "--audio-quality", "5"];
    case "high":
    default:
      return ["--audio-format", "mp3", "--audio-quality", "0"];
  }
}
