"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Folder, Heart, Music2, PanelLeftClose, PanelLeftOpen, Pin } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { LibraryCreateMenu } from "@/components/library-create-menu";
import {
  LibraryItemContextMenu,
  libraryAlbumHref,
} from "@/components/library-item-context-menu";
import { encodeAlbumId } from "@/lib/album-ref";
import {
  LIBRARY_CHANGED_EVENT,
  LIBRARY_PINS_CHANGED_EVENT,
  LIKES_CHANGED_EVENT,
} from "@/lib/ui-events";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePlayer } from "@/components/player-provider";

type NavItem = {
  type: "album" | "playlist" | "folder";
  key: string;
  title: string;
  artist: string;
  tracks: number;
  image?: string | null;
  pinKey?: string;
  pinned?: boolean;
  href?: string;
};

function LikedCover({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center bg-gradient-to-br from-[#450af5] via-[#8e2de2] to-[#c44cff]",
        className,
      )}
      aria-hidden
    >
      <Heart className="size-3.5 fill-white text-white" strokeWidth={0} />
    </div>
  );
}

function FolderCover({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center bg-[#282828] text-[#b3b3b3]",
        className,
      )}
      aria-hidden
    >
      <Folder className="size-4" strokeWidth={1.75} />
    </div>
  );
}

function PlaylistPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center bg-[#282828] text-[#7f7f7f]",
        className,
      )}
      aria-hidden
    >
      <Music2 className="size-4" strokeWidth={1.75} />
    </div>
  );
}

function HeaderButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function LibrarySidebar({
  expanded = false,
  onExpandedChange,
}: {
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const pathname = usePathname();
  const { setPanel } = usePlayer();
  const [likedTracks, setLikedTracks] = useState(0);
  const [likedPinned, setLikedPinned] = useState(false);
  const [items, setItems] = useState<NavItem[]>([]);
  const dismissOverlays = () => setPanel("none");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/library/nav", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (!data) return;
      setLikedTracks(Number(data.liked?.tracks) || 0);
      setLikedPinned(Boolean(data.liked?.pinned));
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();

    const onLikesChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ count?: number }>).detail;
      if (typeof detail?.count === "number") {
        setLikedTracks(detail.count);
        return;
      }
      void refresh();
    };

    const onRefresh = () => {
      void refresh();
    };

    window.addEventListener(LIKES_CHANGED_EVENT, onLikesChanged);
    window.addEventListener(LIBRARY_CHANGED_EVENT, onRefresh);
    window.addEventListener(LIBRARY_PINS_CHANGED_EVENT, onRefresh);
    return () => {
      window.removeEventListener(LIKES_CHANGED_EVENT, onLikesChanged);
      window.removeEventListener(LIBRARY_CHANGED_EVENT, onRefresh);
      window.removeEventListener(LIBRARY_PINS_CHANGED_EVENT, onRefresh);
    };
  }, [pathname, refresh]);

  const likedActive = pathname.startsWith("/library/liked");
  const coverSize = expanded ? "size-14" : "size-11";

  const likedBlock = (
    <LibraryItemContextMenu
      item={{
        kind: "liked",
        title: "Liked Songs",
        artist: "You",
        pinKey: "liked",
        pinned: likedPinned,
        href: "/library/liked",
      }}
      onPinnedChange={setLikedPinned}
    >
      <Link
        href="/library/liked"
        aria-current={likedActive ? "page" : undefined}
        onClick={dismissOverlays}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-3 py-2 transition-colors",
          likedActive ? "bg-muted/60" : "hover:bg-muted/40",
        )}
      >
        <LikedCover className={cn("shrink-0 rounded-sm", coverSize)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="truncate text-sm font-medium text-foreground">
              Liked Songs
            </div>
            {likedPinned ? (
              <Pin
                className="size-3 shrink-0 fill-current text-muted-foreground"
                aria-label="Pinned"
              />
            ) : null}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            Playlist · {likedTracks} song{likedTracks === 1 ? "" : "s"}
          </div>
        </div>
      </Link>
    </LibraryItemContextMenu>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TooltipProvider delayDuration={300}>
        <div className="mb-1 flex items-center gap-1 px-1.5">
          <p className="min-w-0 flex-1 px-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Library
          </p>
          <LibraryCreateMenu />
          <HeaderButton
            label={expanded ? "Collapse library" : "Expand library"}
            onClick={() => onExpandedChange?.(!expanded)}
          >
            {expanded ? (
              <PanelLeftClose className="size-3.5" strokeWidth={2} />
            ) : (
              <PanelLeftOpen className="size-3.5" strokeWidth={2} />
            )}
          </HeaderButton>
        </div>
      </TooltipProvider>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5">
          {likedBlock}

          {items.map((item) => {
            const href =
              item.href ||
              (item.type === "album"
                ? libraryAlbumHref(item.artist, item.title)
                : "#");
            const albumId =
              item.type === "album"
                ? encodeAlbumId({
                    title: item.title,
                    artist: item.artist,
                  })
                : "";
            const active =
              pathname === href ||
              (item.type === "album" && pathname === `/album/${albumId}`);
            const pinKey =
              item.pinKey ||
              (item.type === "album"
                ? `album:${item.artist.trim().toLowerCase()}::${item.title.trim().toLowerCase()}`
                : item.key);
            const kind =
              item.type === "playlist"
                ? "playlist"
                : item.type === "folder"
                  ? "folder"
                  : "album";
            const subtitle =
              item.type === "album"
                ? `Album · ${item.artist}`
                : item.type === "folder"
                  ? `Folder · ${item.tracks} playlist${item.tracks === 1 ? "" : "s"}`
                  : `Playlist · ${item.artist}`;

            return (
              <LibraryItemContextMenu
                key={item.key}
                item={{
                  kind,
                  title: item.title,
                  artist: item.artist,
                  pinKey,
                  pinned: Boolean(item.pinned),
                  href,
                  image: item.image,
                  playlistId:
                    item.type === "playlist"
                      ? item.key.replace(/^playlist:/, "")
                      : undefined,
                  folderId:
                    item.type === "folder"
                      ? item.key.replace(/^folder:/, "")
                      : undefined,
                }}
              >
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  onClick={dismissOverlays}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 transition-colors",
                    active ? "bg-muted/60" : "hover:bg-muted/40",
                  )}
                >
                  {item.type === "folder" ? (
                    <FolderCover className={cn("shrink-0 rounded-sm", coverSize)} />
                  ) : item.image ? (
                    <CoverArt
                      seed={`${item.artist}-${item.title}`}
                      image={item.image}
                      className={cn("shrink-0 rounded-sm", coverSize)}
                    />
                  ) : item.type === "playlist" ? (
                    <PlaylistPlaceholder
                      className={cn("shrink-0 rounded-sm", coverSize)}
                    />
                  ) : (
                    <CoverArt
                      seed={`${item.artist}-${item.title}`}
                      image={item.image}
                      className={cn("shrink-0 rounded-sm", coverSize)}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <div className="truncate text-sm font-medium text-foreground">
                        {item.title}
                      </div>
                      {item.pinned ? (
                        <Pin
                          className="size-3 shrink-0 fill-current text-muted-foreground"
                          aria-label="Pinned"
                        />
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {subtitle}
                    </div>
                  </div>
                </Link>
              </LibraryItemContextMenu>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
