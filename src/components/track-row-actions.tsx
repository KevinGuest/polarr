"use client";

import { Check, CirclePlus, Loader2 } from "lucide-react";
import { AddToPlaylistMenu } from "@/components/add-to-playlist-menu";
import { StreamQualityBadge } from "@/components/stream-quality-badge";
import { TrackLikeButton } from "@/components/track-like-button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Like + add-to-playlist controls for a track row.
 * Polarr badge (left of heart) = file is on this server.
 * Plus opens playlists; check is only for tracks saved to Your Library.
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
  /** Indexed on this Polarr server (Lidarr or Polarr download). */
  onPolarr?: boolean;
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
                <StreamQualityBadge quality="local" available />
              </span>
            </TooltipTrigger>
            <TooltipContent>Available on Polarr</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
      <TrackLikeButton
        trackId={trackId}
        artist={artist}
        title={title}
        album={album}
        coverPath={coverPath}
        duration={duration}
        initialLiked={liked}
        onLikedChange={onLikedChange}
        className="text-muted-foreground opacity-80 transition-opacity hover:text-foreground hover:opacity-100 group-hover/row:opacity-100"
      />
      <AddToPlaylistMenu
        trackId={trackId}
        artist={artist}
        title={title}
        album={album}
        coverPath={coverPath}
        duration={duration}
        inLibrary={Boolean(inLibrary)}
        onPolarr={Boolean(onPolarr)}
        onDownload={onDownload}
      >
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground opacity-80 transition-opacity hover:text-foreground hover:opacity-100 group-hover/row:opacity-100 disabled:opacity-50"
          aria-label={inLibrary ? "Saved — manage playlists" : "Add to playlist"}
          disabled={downloading}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {downloading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : inLibrary ? (
            <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-background">
              <Check className="size-3" strokeWidth={3} />
            </span>
          ) : (
            <CirclePlus className="size-[1.15rem]" strokeWidth={1.75} />
          )}
        </button>
      </AddToPlaylistMenu>
    </div>
  );
}
