"use client";

import { Check, CirclePlus, Loader2 } from "lucide-react";
import { AddToPlaylistMenu } from "@/components/add-to-playlist-menu";
import { TrackLikeButton } from "@/components/track-like-button";
import { cn } from "@/lib/utils";

/**
 * Like + add-to-playlist controls for a track row.
 * Plus (not in library) or check (in library) opens the same menu — no tooltips.
 * Parent row should use `group/row` for hover emphasis.
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
  /** Already saved / available in the library. */
  inLibrary?: boolean;
  downloading?: boolean;
  onDownload?: () => void;
  onLikedChange?: (liked: boolean) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-end gap-0.5",
        className,
      )}
    >
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
