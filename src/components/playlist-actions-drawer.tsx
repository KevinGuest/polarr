"use client";

import { useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  CirclePlus,
  ListFilter,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { toastError, toastSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

type PlaylistActionsDrawerProps = {
  playlistId: string;
  title: string;
  subtitle?: string;
  coverUrl?: string | null;
  canEdit: boolean;
  children: ReactNode;
  onAddSongs: () => void;
  onEditPlaylist: () => void;
  onEditDetails: () => void;
  onDelete: () => void;
};

function ActionRow({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: typeof Share2;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-4 rounded-lg px-1 py-3.5 text-left transition-colors hover:bg-muted/50",
        destructive && "text-destructive hover:bg-destructive/10",
      )}
    >
      <Icon
        className={cn(
          "size-6 shrink-0",
          destructive ? "text-destructive" : "text-foreground",
        )}
        strokeWidth={1.75}
      />
      <span
        className={cn(
          "text-[15px] font-medium",
          destructive ? "text-destructive" : "text-foreground",
        )}
      >
        {label}
      </span>
    </button>
  );
}

/**
 * Mobile/desktop playlist ⋯ sheet. Intentionally omits Spotify-only actions
 * (device downloads, cover art AI, video, Jam).
 */
export function PlaylistActionsDrawer({
  playlistId,
  title,
  subtitle,
  coverUrl,
  canEdit,
  children,
  onAddSongs,
  onEditPlaylist,
  onEditDetails,
  onDelete,
}: PlaylistActionsDrawerProps) {
  const [open, setOpen] = useState(false);

  const cover =
    coverUrl && /^https?:\/\//i.test(coverUrl) ? coverUrl : undefined;

  async function share() {
    const path = `/playlist/${encodeURIComponent(playlistId)}`;
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}${path}`
        : path;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
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

  function run(action: () => void) {
    setOpen(false);
    // Let the sheet close before opening another dialog.
    setTimeout(action, 180);
  }

  return (
    <>
      <span
        className="inline-flex"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {children}
      </span>

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
                seed={title}
                image={cover}
                className="size-12 shrink-0 rounded-md"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{title}</div>
                {subtitle ? (
                  <div className="truncate text-sm text-muted-foreground">
                    {subtitle}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,var(--safe-bottom))] pt-1">
              <ActionRow
                icon={Share2}
                label="Share"
                onClick={() => void share()}
              />
              {canEdit ? (
                <>
                  <ActionRow
                    icon={CirclePlus}
                    label="Add to this playlist"
                    onClick={() => run(onAddSongs)}
                  />
                  <ActionRow
                    icon={ListFilter}
                    label="Edit playlist"
                    onClick={() => run(onEditPlaylist)}
                  />
                  <ActionRow
                    icon={Pencil}
                    label="Name & details"
                    onClick={() => run(onEditDetails)}
                  />
                  <ActionRow
                    icon={Trash2}
                    label="Delete playlist"
                    destructive
                    onClick={() => run(onDelete)}
                  />
                </>
              ) : null}
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    </>
  );
}
