import { HardDrive, Radio } from "lucide-react";
import {
  playbackQuality,
  type PlaybackQuality,
  type PlayerTrack,
} from "@/components/player-provider";
import { cn } from "@/lib/utils";

const LABELS: Record<PlaybackQuality, string> = {
  local: "Polarr",
  youtube: "YouTube",
};

const DESCRIPTIONS: Record<PlaybackQuality, string> = {
  local: "Playing from Polarr library",
  youtube: "Playing via YouTube fallback",
};

/** Compact Polarr / YouTube source chip for the player and track rows. */
export function StreamQualityBadge({
  track,
  quality: qualityProp,
  className,
  compact = false,
  available = false,
}: {
  track?: PlayerTrack | null;
  quality?: PlaybackQuality | null;
  className?: string;
  /** Icon-only — longer name for screen readers only (no native title tip). */
  compact?: boolean;
  /** File is on Polarr but not necessarily playing. */
  available?: boolean;
}) {
  const quality =
    qualityProp ?? (track ? playbackQuality(track) : null);
  if (!quality) return null;

  const description =
    available && quality === "local"
      ? "Available on Polarr"
      : DESCRIPTIONS[quality];

  // lucide dropped brand icons — Radio = live/remote stream
  const Icon = quality === "local" ? HardDrive : Radio;
  const label = LABELS[quality];

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
      // No `title` / default aria-label — stacks on BarTooltip. Icon-only keeps aria.
      {...(compact || available ? { "aria-label": description } : {})}
    >
      <Icon className="size-2.5 shrink-0" strokeWidth={2.5} aria-hidden />
      {compact ? null : <span>{label}</span>}
    </span>
  );
}
