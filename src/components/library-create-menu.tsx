"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Folder, Music2, Plus, Users, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

export function LibraryCreateMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

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
      setOpen(false);
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
      setOpen(false);
      router.push(`/folder/${encodeURIComponent(data.folder.id)}`);
    } catch {
      toastError("Couldn’t create folder");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
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
        side="bottom"
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
            onClick={() => setOpen(false)}
            className="rounded-full p-1.5 text-[#b3b3b3] transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
          <div className="px-1 text-[15px] font-bold text-white">Create</div>
        </div>
        <CreateItem
          title="Playlist"
          description="Create a playlist with songs"
          onSelect={() => void createPlaylist()}
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
          onSelect={() => void createFolder()}
        >
          <CreateIcon>
            <Folder className="size-5" strokeWidth={1.75} />
          </CreateIcon>
        </CreateItem>
        <CreateItem
          title="Jam"
          description="Listen together from anywhere"
          onSelect={() => {
            setOpen(false);
            router.push("/jam");
          }}
        >
          <CreateIcon>
            <Users className="size-5" strokeWidth={1.75} />
          </CreateIcon>
        </CreateItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
