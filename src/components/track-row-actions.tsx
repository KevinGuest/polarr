"use client";

import { MobileSaveButton } from "@/components/saved-in-drawer";
import { PolarrAvailabilityBadge } from "@/components/stream-quality-badge";
import { cn } from "@/lib/utils";

/**
 * Row actions: availability badge, then plus/check (Saved-in drawer).
 */
export function TrackRowActions({
  trackId,
  artist,
  title,
  album,
  coverPath,
  duration,
  liked,
  inLibrary,
  onPolarr,
  showPolarrBadge = true,
  downloading,
  onDownload,
  onLikedChange,
  className,
}: {
  trackId: string;
  artist: string;
  title: string;
  album?: string;
  coverPath?: string | null;
  duration?: number;
  liked?: boolean;
  /** Saved to a user playlist / Your Library — not “file exists on disk”. */
  inLibrary?: boolean;
  /** Indexed on this Polarr server (library file). */
  onPolarr?: boolean;
  /** Show server/cloud badge left of the save control. */
  showPolarrBadge?: boolean;
  downloading?: boolean;
  onDownload?: () => void;
  onLikedChange?: (liked: boolean) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-end gap-1.5",
        className,
      )}
    >
      {showPolarrBadge ? (
        <PolarrAvailabilityBadge available={Boolean(onPolarr)} />
      ) : null}
      <MobileSaveButton
        trackId={trackId}
        artist={artist}
        title={title}
        album={album}
        coverPath={coverPath}
        duration={duration}
        onPolarr={Boolean(onPolarr)}
        alreadyInLibrary={Boolean(inLibrary || onPolarr)}
        onDownload={downloading ? undefined : onDownload}
        seedLiked={liked}
        size="sm"
        onSavedChange={() => onLikedChange?.(true)}
        className="text-muted-foreground opacity-80 transition-opacity hover:text-foreground hover:opacity-100 group-hover/row:opacity-100 disabled:opacity-50"
      />
    </div>
  );
}
