import { HardDrive, Radio, Server, Cloud } from "lucide-react";
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
  youtube: "Playing via Youtube",
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
      {...(compact || available ? { "aria-label": description } : {})}
    >
      <Icon className="size-2.5 shrink-0" strokeWidth={2.5} aria-hidden />
      {compact ? null : <span>{label}</span>}
    </span>
  );
}

/**
 * Album / playlist row: on-server (green server) vs stream-only (red cloud).
 * Sit left of the + / check row actions.
 */
export function PolarrAvailabilityBadge({
  available,
  className,
}: {
  available: boolean;
  className?: string;
}) {
  const Icon = available ? Server : Cloud;
  const label = available ? "Available on Polarr" : "Streaming";
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
        available
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
          : "bg-red-500/12 text-red-700 dark:text-red-400",
        className,
      )}
      title={label}
      aria-label={label}
    >
      <Icon className="size-3.5" strokeWidth={2.25} aria-hidden />
    </span>
  );
}
