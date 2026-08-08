"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Heart, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { albumHref, encodeAlbumId } from "@/lib/album-ref";
import { LIKES_CHANGED_EVENT } from "@/lib/ui-events";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePlayer } from "@/components/player-provider";
import { toastError, toastSuccess } from "@/lib/toast";

type NavItem = {
  type: "album" | "playlist";
  key: string;
  title: string;
  artist: string;
  tracks: number;
  image?: string | null;
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
  const [items, setItems] = useState<NavItem[]>([]);
  const dismissOverlays = () => setPanel("none");

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const res = await fetch("/api/library/nav");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data) return;
        setLikedTracks(Number(data.liked?.tracks) || 0);
        setItems(Array.isArray(data.items) ? data.items : []);
      } catch {
        /* ignore */
      }
    }

    void refresh();

    const onLikesChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ count?: number }>).detail;
      if (typeof detail?.count === "number") {
        setLikedTracks(detail.count);
        return;
      }
      void refresh();
    };

    window.addEventListener(LIKES_CHANGED_EVENT, onLikesChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(LIKES_CHANGED_EVENT, onLikesChanged);
    };
  }, [pathname]);

  const likedActive = pathname.startsWith("/library/liked");

  async function createPlaylist() {
    const name =
      typeof window !== "undefined"
        ? window.prompt("Playlist name", "My Playlist")
        : null;
    if (!name?.trim()) return;
    const res = await fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) {
      toastError("Couldn’t create playlist");
      return;
    }
    toastSuccess(`Created “${name.trim()}”`);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TooltipProvider delayDuration={300}>
        <div className="mb-1 flex items-center gap-1 px-1.5">
          <p className="min-w-0 flex-1 px-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Library
          </p>
          <HeaderButton label="Create playlist" onClick={() => void createPlaylist()}>
            <Plus className="size-3.5" strokeWidth={2} />
          </HeaderButton>
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
          <Link
            href="/library/liked"
            aria-current={likedActive ? "page" : undefined}
            onClick={dismissOverlays}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-3 py-2 transition-colors",
              likedActive ? "bg-muted/60" : "hover:bg-muted/40",
            )}
          >
            <LikedCover
              className={cn(
                "shrink-0 rounded-sm",
                expanded ? "size-14" : "size-11",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                Liked Songs
              </div>
              <div className="truncate text-xs text-muted-foreground">
                Playlist · {likedTracks} song{likedTracks === 1 ? "" : "s"}
              </div>
            </div>
          </Link>

          {items.map((item) => {
            const href = albumHref({
              title: item.title,
              artist: item.artist,
            });
            const id = encodeAlbumId({
              title: item.title,
              artist: item.artist,
            });
            const active = pathname === `/album/${id}`;
            return (
              <Link
                key={item.key}
                href={href}
                aria-current={active ? "page" : undefined}
                onClick={dismissOverlays}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 transition-colors",
                  active ? "bg-muted/60" : "hover:bg-muted/40",
                )}
              >
                <CoverArt
                  seed={`${item.artist}-${item.title}`}
                  image={item.image}
                  className={cn(
                    "shrink-0 rounded-sm",
                    expanded ? "size-14" : "size-11",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    {item.title}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {item.type === "album" ? "Album" : "Playlist"} ·{" "}
                    {item.artist}
                  </div>
                </div>
              </Link>
            );
          })}

          {items.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              Albums appear here after you add music.
            </p>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
