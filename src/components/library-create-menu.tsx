"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Folder, Music2, Plus, Users, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { InsetGroup } from "@/components/media-shelf";
import { SHEET_PANEL, SheetHandle } from "@/components/sheet-chrome";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { emitLibraryChanged } from "@/lib/ui-events";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

function CreateIcon({ children }: { children: ReactNode }) {
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-foreground">
      {children}
    </div>
  );
}

function CreateItem({
  title,
  description,
  onSelect,
  children,
}: {
  title: string;
  description: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex min-h-14 w-full items-center gap-3 px-3 text-left"
    >
      {children}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px] text-foreground">{title}</div>
        <div className="truncate text-[13px] text-muted-foreground">
          {description}
        </div>
      </div>
    </button>
  );
}

function CreateOptions({
  onCreatePlaylist,
  onCreateFolder,
  onJam,
}: {
  busy?: boolean;
  onCreatePlaylist: () => void;
  onCreateFolder: () => void;
  onJam: () => void;
}) {
  return (
    <>
      <CreateItem
        title="Playlist"
        description="Create a playlist with songs"
        onSelect={onCreatePlaylist}
      >
        <CreateIcon>
          <span className="relative inline-flex">
            <Music2 className="size-5" strokeWidth={1.75} />
            <Plus
              className="absolute -bottom-1 -right-1.5 size-3"
              strokeWidth={2.5}
            />
          </span>
        </CreateIcon>
      </CreateItem>
      <CreateItem
        title="Folder"
        description="Organize your playlists"
        onSelect={onCreateFolder}
      >
        <CreateIcon>
          <Folder className="size-5" strokeWidth={1.75} />
        </CreateIcon>
      </CreateItem>
      <CreateItem
        title="Jam"
        description="Listen together from anywhere"
        onSelect={onJam}
      >
        <CreateIcon>
          <Users className="size-5" strokeWidth={1.75} />
        </CreateIcon>
      </CreateItem>
    </>
  );
}

function MobileCreateDrawer({
  open,
  onOpenChange,
  busy,
  onCreatePlaylist,
  onCreateFolder,
  onJam,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onCreatePlaylist: () => void;
  onCreateFolder: () => void;
  onJam: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="z-[60] bg-black/60" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            SHEET_PANEL,
            "z-[60] px-4 pb-[max(1rem,var(--safe-bottom))] pt-1",
          )}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <SheetHandle />
          <h2 className="mb-4 px-1 text-[1.375rem] font-semibold tracking-tight">
            Create
          </h2>
          <InsetGroup>
            <CreateOptions
              busy={busy}
              onCreatePlaylist={onCreatePlaylist}
              onCreateFolder={onCreateFolder}
              onJam={onJam}
            />
          </InsetGroup>
          {busy ? (
            <p className="px-1 pt-3 text-[13px] text-muted-foreground">
              Creating…
            </p>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

type LibraryCreateMenuProps = {
  /** Sidebar icon, Create pill, mobile library header, or bottom dock tab */
  variant?: "sidebar" | "pill" | "header" | "dock";
  onOpenChange?: (open: boolean) => void;
};

export function LibraryCreateMenu({
  variant = "sidebar",
  onOpenChange,
}: LibraryCreateMenuProps = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const useDrawer = variant === "header" || variant === "dock";

  function setMenuOpen(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
  }

  async function createPlaylist() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.playlist?.id) {
        toastError("Couldn’t create playlist");
        return;
      }
      emitLibraryChanged();
      setMenuOpen(false);
      router.push(`/playlist/${encodeURIComponent(data.playlist.id)}`);
    } catch {
      toastError("Couldn’t create playlist");
    } finally {
      setBusy(false);
    }
  }

  async function createFolder() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/playlist-folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.folder?.id) {
        toastError("Couldn’t create folder");
        return;
      }
      emitLibraryChanged();
      setMenuOpen(false);
      router.push(`/folder/${encodeURIComponent(data.folder.id)}`);
    } catch {
      toastError("Couldn’t create folder");
    } finally {
      setBusy(false);
    }
  }

  function openJam() {
    setMenuOpen(false);
    router.push("/jam");
  }

  const optionHandlers = {
    busy,
    onCreatePlaylist: () => void createPlaylist(),
    onCreateFolder: () => void createFolder(),
    onJam: openJam,
  };

  if (useDrawer) {
    return (
      <>
        {variant === "header" ? (
          <button
            type="button"
            aria-label="Create"
            aria-expanded={open}
            onClick={() => setMenuOpen(true)}
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <Plus className="size-5" strokeWidth={2} />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Create"
            aria-expanded={open}
            onClick={() => setMenuOpen(true)}
            className={cn(
              "flex min-h-[44px] min-w-[44px] flex-1 items-center justify-center py-1 transition-colors",
              open
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Plus className="size-5" strokeWidth={open ? 2.25 : 1.75} />
          </button>
        )}
        <MobileCreateDrawer
          open={open}
          onOpenChange={setMenuOpen}
          {...optionHandlers}
        />
      </>
    );
  }

  const trigger =
    variant === "pill" ? (
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Create"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-muted/60 px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Plus className="size-4" strokeWidth={2.25} />
          Create
        </button>
      </DropdownMenuTrigger>
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Create"
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <Plus className="size-3.5" strokeWidth={2} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Create</TooltipContent>
      </Tooltip>
    );

  return (
    <DropdownMenu open={open} onOpenChange={setMenuOpen}>
      {trigger}
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={8}
        className={cn(
          "w-[22rem] rounded-2xl border-border bg-background p-3 text-foreground shadow-2xl",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
        )}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="mb-3 flex items-center gap-1 px-0.5">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setMenuOpen(false)}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
          <div className="px-1 text-[1.375rem] font-semibold tracking-tight">
            Create
          </div>
        </div>
        <InsetGroup>
          <CreateOptions {...optionHandlers} />
        </InsetGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
