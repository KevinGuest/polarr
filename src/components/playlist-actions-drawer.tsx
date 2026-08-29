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
import { InsetGroup } from "@/components/media-shelf";
import { SHEET_PANEL, SheetHandle } from "@/components/sheet-chrome";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  /** Bottom sheet on mobile; compact menu on desktop/web. */
  variant?: "sheet" | "menu";
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
        "flex h-14 w-full items-center gap-3 px-4 text-left",
        destructive && "text-destructive",
      )}
    >
      <Icon
        className={cn(
          "size-5 shrink-0",
          destructive ? "text-destructive" : "text-muted-foreground",
        )}
        strokeWidth={1.75}
      />
      <span
        className={cn(
          "text-[17px]",
          destructive ? "text-destructive" : "text-foreground",
        )}
      >
        {label}
      </span>
    </button>
  );
}

async function sharePlaylist(playlistId: string, title: string) {
  const path = `/playlist/${encodeURIComponent(playlistId)}`;
  const url =
    typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
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
}

/**
 * Playlist ⋯ — mobile bottom sheet, desktop compact menu (same items as
 * the library right-click menu).
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
  variant = "sheet",
}: PlaylistActionsDrawerProps) {
  const [open, setOpen] = useState(false);

  const cover =
    coverUrl && /^https?:\/\//i.test(coverUrl) ? coverUrl : undefined;

  async function share() {
    await sharePlaylist(playlistId, title);
    setOpen(false);
  }

  function run(action: () => void) {
    setOpen(false);
    // Let the sheet close before opening another dialog.
    setTimeout(action, variant === "menu" ? 0 : 180);
  }

  if (variant === "menu") {
    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem
            className="gap-2.5 font-medium"
            onSelect={() => void share()}
          >
            <Share2 className="size-4 shrink-0 text-muted-foreground" />
            Share
          </DropdownMenuItem>
          {canEdit ? (
            <>
              <DropdownMenuItem
                className="gap-2.5 font-medium"
                onSelect={() => run(onAddSongs)}
              >
                <CirclePlus className="size-4 shrink-0 text-muted-foreground" />
                Add to this playlist
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2.5 font-medium"
                onSelect={() => run(onEditPlaylist)}
              >
                <ListFilter className="size-4 shrink-0 text-muted-foreground" />
                Edit playlist
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2.5 font-medium"
                onSelect={() => run(onEditDetails)}
              >
                <Pencil className="size-4 shrink-0 text-muted-foreground" />
                Name & details
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2.5 font-medium text-destructive focus:bg-destructive/10 focus:text-destructive"
                onSelect={() => run(onDelete)}
              >
                <Trash2 className="size-4 shrink-0" />
                Delete playlist
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
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
            className={cn(SHEET_PANEL, "z-[70] max-h-[min(88vh,640px)]")}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <SheetHandle />

            <div className="flex items-center gap-3 px-5 pb-4 pt-1">
              <CoverArt
                seed={title}
                image={cover}
                className="size-12 shrink-0 rounded-xl"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[17px] font-semibold">{title}</div>
                {subtitle ? (
                  <div className="truncate text-[13px] text-muted-foreground">
                    {subtitle}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-[max(1rem,var(--safe-bottom))]">
              <InsetGroup>
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
                </>
              ) : null}
              </InsetGroup>
              {canEdit ? (
                <InsetGroup>
                  <ActionRow
                    icon={Trash2}
                    label="Delete playlist"
                    destructive
                    onClick={() => run(onDelete)}
                  />
                </InsetGroup>
              ) : null}
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    </>
  );
}
