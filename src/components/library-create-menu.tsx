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
    <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
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
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/10"
    >
      {children}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-bold text-white">{title}</div>
        <div className="truncate text-[13px] text-[#b3b3b3]">{description}</div>
      </div>
    </button>
  );
}

function CreateOptions({
  busy,
  onCreatePlaylist,
  onCreateFolder,
  onJam,
}: {
  busy: boolean;
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
      {busy ? (
        <p className="px-2 py-1 text-xs text-[#b3b3b3]">Creating…</p>
      ) : null}
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
            "fixed inset-x-0 bottom-0 z-[60] rounded-t-2xl border-t border-white/10 bg-[#282828] px-3 pb-[max(1rem,var(--safe-bottom))] pt-2 text-white shadow-2xl outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
            "duration-300",
          )}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div
            className="mx-auto mb-3 mt-1 h-1 w-10 shrink-0 rounded-full bg-white/25"
            aria-hidden
          />
          <CreateOptions
            busy={busy}
            onCreatePlaylist={onCreatePlaylist}
            onCreateFolder={onCreateFolder}
            onJam={onJam}
          />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

type LibraryCreateMenuProps = {
  /** Sidebar icon, mobile library header, or bottom dock tab */
  variant?: "sidebar" | "header" | "dock";
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
              "flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[10px] font-medium transition-colors",
              open
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Plus className="size-5" strokeWidth={open ? 2.25 : 1.75} />
            Create
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

  return (
    <DropdownMenu open={open} onOpenChange={setMenuOpen}>
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
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        className={cn(
          "w-[22rem] rounded-xl border-0 bg-[#282828] p-2 text-white shadow-2xl",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
        )}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="mb-1 flex items-center gap-1 px-1 pb-1 pt-0.5">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setMenuOpen(false)}
            className="rounded-full p-1.5 text-[#b3b3b3] transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
          <div className="px-1 text-[15px] font-bold text-white">Create</div>
        </div>
        <CreateOptions {...optionHandlers} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
