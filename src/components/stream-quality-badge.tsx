import { HardDrive, Radio } from "lucide-react";
import {
  playbackQuality,
  type PlaybackQuality,
  type PlayerTrack,
} from "@/components/player-provider";
import {
  LOCAL_SOURCE_AVAILABLE,
  LOCAL_SOURCE_LABELS,
  LOCAL_SOURCE_PLAYING,
  type LocalSourceBadge,
} from "@/lib/track-source-badge";
import { cn } from "@/lib/utils";

const LABELS: Record<PlaybackQuality, string> = {
  local: "Polarr",
  youtube: "YouTube",
};

const DESCRIPTIONS: Record<PlaybackQuality, string> = {
  local: "Playing from Polarr library",
  youtube: "Playing via Youtube",
};

/** Compact Lidarr / Polarr / YouTube source chip for the player and track rows. */
export function StreamQualityBadge({
  track,
  quality: qualityProp,
  localSource: localSourceProp,
  className,
  compact = false,
  available = false,
}: {
  track?: PlayerTrack | null;
  quality?: PlaybackQuality | null;
  /** Lidarr library file vs Polarr fallback download — defaults to Lidarr for local. */
  localSource?: LocalSourceBadge | null;
  className?: string;
  /** Icon-only — longer name for screen readers only (no native title tip). */
  compact?: boolean;
  /** File is on the server but not necessarily playing. */
  available?: boolean;
}) {
  const quality =
    qualityProp ?? (track ? playbackQuality(track) : null);
  if (!quality) return null;

  const localSource: LocalSourceBadge | null =
    quality === "local" ? (localSourceProp ?? "lidarr") : null;

  const description =
    available && quality === "local" && localSource
      ? LOCAL_SOURCE_AVAILABLE[localSource]
      : quality === "local" && localSource
        ? LOCAL_SOURCE_PLAYING[localSource]
        : DESCRIPTIONS[quality];

  const Icon = quality === "local" ? HardDrive : Radio;
  const label =
    quality === "local" && localSource
      ? LOCAL_SOURCE_LABELS[localSource]
      : LABELS[quality];

  const isLidarr = quality === "local" && localSource === "lidarr";

  return (
    <span
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[3px] px-1.5 text-[10px] font-semibold leading-none tracking-tight",
        quality === "local"
          ? isLidarr
            ? "bg-sky-500/15 text-sky-700 dark:text-sky-400"
            : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
          : "bg-red-500/12 text-red-700 dark:text-red-400",
        compact && "px-1",
        className,
      )}
      {...(compact || available ? { "aria-label": description } : {})}
    >
      <Icon className="size-2.5 shrink-0" strokeWidth={2.5} aria-hidden />
      {compact ? null : <span>{label}</span>}
    </span>
  );
}
