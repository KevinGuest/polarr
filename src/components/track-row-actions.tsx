"use client";

import { MobileSaveButton } from "@/components/saved-in-drawer";
import { StreamQualityBadge } from "@/components/stream-quality-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  LOCAL_SOURCE_AVAILABLE,
  type LocalSourceBadge,
} from "@/lib/track-source-badge";
import { cn } from "@/lib/utils";

/**
 * Row save control: plus opens the Saved-in drawer; check means the track is
 * in Liked Songs or any user playlist.
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
  localSource = "lidarr",
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
  /** Indexed on this server — show Lidarr or Polarr source badge. */
  onPolarr?: boolean;
  /** When onPolarr — Lidarr library vs Polarr fallback download. */
  localSource?: LocalSourceBadge;
  downloading?: boolean;
  onDownload?: () => void;
  onLikedChange?: (liked: boolean) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-end gap-1",
        className,
      )}
    >
      {onPolarr ? (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex shrink-0">
                <StreamQualityBadge
                  quality="local"
                  localSource={localSource}
                  available
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {LOCAL_SOURCE_AVAILABLE[localSource]}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
