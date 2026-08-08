import { HardDrive, Radio } from "lucide-react";
import {
  playbackQuality,
  type PlaybackQuality,
  type PlayerTrack,
} from "@/components/player-provider";
import { cn } from "@/lib/utils";

const LABELS: Record<PlaybackQuality, string> = {
  local: "Local",
  youtube: "YouTube",
};

const TITLES: Record<PlaybackQuality, string> = {
  local: "Playing from local library",
  youtube: "Playing via YouTube fallback",
};

/** Compact Local / YouTube source chip for the player. */
export function StreamQualityBadge({
  track,
  quality: qualityProp,
  className,
  compact = false,
}: {
  track?: PlayerTrack | null;
  quality?: PlaybackQuality | null;
  className?: string;
  /** Icon-only (tooltip via title/aria). */
  compact?: boolean;
}) {
  const quality =
    qualityProp ?? (track ? playbackQuality(track) : null);
  if (!quality) return null;

  // lucide dropped brand icons — Radio = live/remote stream
  const Icon = quality === "local" ? HardDrive : Radio;
  const label = LABELS[quality];
  const title = TITLES[quality];

  return (
    <span
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[3px] px-1.5 text-[10px] font-semibold leading-none tracking-tight",
        quality === "local"
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
          : "bg-red-500/12 text-red-700 dark:text-red-400",
        compact && "px-1",
        className,
      )}
      title={title}
      aria-label={title}
    >
      <Icon className="size-2.5 shrink-0" strokeWidth={2.5} aria-hidden />
      {compact ? null : <span>{label}</span>}
    </span>
  );
}
