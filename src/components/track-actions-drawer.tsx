"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Ban,
  CirclePlus,
  Disc3,
  ListEnd,
  ListMusic,
  MoreHorizontal,
  Share2,
  Trash2,
  UserRound,
} from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { ExplicitBadge } from "@/components/explicit-badge";
import { SavedInDrawer } from "@/components/saved-in-drawer";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { usePlayer, type PlayerTrack } from "@/components/player-provider";
import { albumHref } from "@/lib/album-ref";
import { toastError, toastInfo, toastSuccess } from "@/lib/toast";
import { cn, formatTrackArtistLine } from "@/lib/utils";

type TrackActionsDrawerProps = {
  track: PlayerTrack;
  /** Optional trigger; defaults to a ⋯ button. */
  children?: ReactNode;
  className?: string;
  onPolarr?: boolean;
  inLibrary?: boolean;
  onDownload?: () => void;
  onChanged?: () => void;
  /** When set, shows “Remove from this playlist”. */
  playlistId?: string;
  onRemovedFromPlaylist?: () => void;
};

function ActionRow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Share2;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-4 rounded-lg px-1 py-3.5 text-left transition-colors hover:bg-muted/50"
    >
      <Icon className="size-6 shrink-0 text-foreground" strokeWidth={1.75} />
      <span className="text-[15px] font-medium text-foreground">{label}</span>
    </button>
  );
}

/** Mobile bottom sheet for track ⋯ — Share, playlist, queue, album/artist. No radio/jam. */
export function TrackActionsDrawer({
  track,
  children,
  className,
  onPolarr,
  inLibrary,
  onDownload,
  onChanged,
  playlistId,
  onRemovedFromPlaylist,
}: TrackActionsDrawerProps) {
  const router = useRouter();
  const { addToQueue, setPanel, closePanel } = usePlayer();
  const [open, setOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);

  const cover =
    track.coverPath && /^https?:\/\//i.test(track.coverPath)
      ? track.coverPath
      : undefined;
  const albumTitle = (track.album || track.title).trim() || track.title;
  const artistName = track.resolveArtist || track.artist;

  async function share() {
    const path = albumHref({ title: albumTitle, artist: artistName });
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}${path}`
        : path;
    const text = `${track.title} — ${formatTrackArtistLine(artistName, track.title)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: track.title, text, url });
      } else {
        await navigator.clipboard.writeText(url);
        toastSuccess("Link copied");
      }
    } catch {
      try {
        await navigator.clipboard.writeText(url);
        toastSuccess("Link copied");
      } catch {
        toastError("Couldn’t share");
      }
    }
    setOpen(false);
  }

  async function excludeFromTaste() {
    try {
      const res = await fetch("/api/taste/exclude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: track.id }),
      });
      if (!res.ok) {
        toastError("Couldn’t update taste profile");
        return;
      }
      toastSuccess("Excluded from your taste profile");
    } catch {
      toastError("Couldn’t update taste profile");
    }
    setOpen(false);
  }

  function openSavedIn() {
    setOpen(false);
    setTimeout(() => setSavedOpen(true), 180);
  }

  function goToQueue() {
    setOpen(false);
    closePanel("lyrics");
    closePanel("devices");
    setPanel("nowPlaying");
    // Queue is toggled inside the mobile sheet via local state; open now-playing then queue.
    // Fire a custom event the sheet listens for.
    window.dispatchEvent(new CustomEvent("polarr:open-queue"));
  }

  return (
    <>
      {children ? (
        <span
          className={cn("inline-flex", className)}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
        >
          {children}
        </span>
      ) : (
        <button
          type="button"
          aria-label="More"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
          className={cn(
            "flex size-9 shrink-0 items-center justify-center text-muted-foreground",
            className,
          )}
        >
          <MoreHorizontal className="size-5" />
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPortal>
          <DialogOverlay className="z-[70] bg-black/55" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className={cn(
              "fixed inset-x-0 bottom-0 z-[70] flex max-h-[min(88vh,640px)] flex-col rounded-t-2xl border-t border-border bg-background text-foreground shadow-2xl outline-none",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
              "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
              "duration-300",
            )}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div
              className="mx-auto mb-1 mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/35"
              aria-hidden
            />

            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <CoverArt
                seed={albumTitle}
                image={cover}
                className="size-12 shrink-0 rounded-md"
              />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[15px] font-semibold">
                    {track.title}
                  </span>
                  {track.explicit ? <ExplicitBadge /> : null}
                </div>
                <div className="truncate text-sm text-muted-foreground">
                  {formatTrackArtistLine(artistName, track.title)}
                  {track.album ? ` · ${track.album}` : ""}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,var(--safe-bottom))] pt-1">
              <ActionRow icon={Share2} label="Share" onClick={() => void share()} />
              <ActionRow
                icon={CirclePlus}
                label="Add to playlist"
                onClick={openSavedIn}
              />
              {playlistId && onRemovedFromPlaylist ? (
                <ActionRow
                  icon={Trash2}
                  label="Remove from this playlist"
                  onClick={() => {
                    onRemovedFromPlaylist();
                    setOpen(false);
                  }}
                />
              ) : null}
              <ActionRow
                icon={Ban}
                label="Exclude track from your taste profile"
                onClick={() => void excludeFromTaste()}
              />
              <ActionRow
                icon={ListEnd}
                label="Add to Queue"
                onClick={() => {
                  addToQueue(track);
                  toastInfo("Added to queue");
                  setOpen(false);
                }}
              />
              <ActionRow
                icon={ListMusic}
                label="Go to Queue"
                onClick={goToQueue}
              />
              <ActionRow
                icon={Disc3}
                label="Go to album"
                onClick={() => {
                  setOpen(false);
                  router.push(
                    albumHref({ title: albumTitle, artist: artistName }),
                  );
                }}
              />
              <ActionRow
                icon={UserRound}
                label="Go to artist"
                onClick={() => {
                  setOpen(false);
                  router.push(
                    `/artist?name=${encodeURIComponent(artistName)}`,
                  );
                }}
              />
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>

      <SavedInDrawer
        open={savedOpen}
        onOpenChange={setSavedOpen}
        trackId={track.id}
        artist={artistName}
        title={track.title}
        album={track.album}
        coverPath={track.coverPath}
        duration={track.duration ?? undefined}
        inLibrary={Boolean(inLibrary || onPolarr)}
        onPolarr={Boolean(onPolarr)}
        onDownload={onDownload}
        onChanged={onChanged}
      />
    </>
  );
}
