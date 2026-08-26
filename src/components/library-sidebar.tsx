"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LikedSongsCover } from "@/components/liked-songs-cover";
import { CoverArt } from "@/components/cover-art";
import { LibraryCreateMenu } from "@/components/library-create-menu";
import { MobileLibraryHeader } from "@/components/mobile-library-header";
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
import {
  ArrowDownUp,
  Folder,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  UserRound,
} from "lucide-react";

type NavItem = {
  type: "album" | "playlist" | "folder" | "artist";
  key: string;
  title: string;
  artist: string;
  tracks: number;
  image?: string | null;
  pinKey?: string;
  pinned?: boolean;
  href?: string;
  updatedAt?: number;
};

type LibraryFilter = "all" | "playlists" | "albums" | "artists";
type LibrarySort = "recents" | "alpha";

const FILTER_TABS: { id: LibraryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "playlists", label: "Playlists" },
  { id: "albums", label: "Albums" },
  { id: "artists", label: "Artists" },
];

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

function ArtistPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center bg-[#282828] text-[#7f7f7f]",
        className,
      )}
      aria-hidden
    >
      <UserRound className="size-4" strokeWidth={1.75} />
    </div>
  );
}

function sortNavItems(items: NavItem[], sort: LibrarySort): NavItem[] {
  if (sort === "alpha") {
    return items.slice().sort((a, b) => a.title.localeCompare(b.title));
  }
  return items.slice().sort((a, b) => {
    const aPinned = a.pinned ? 0 : 1;
    const bPinned = b.pinned ? 0 : 1;
    if (aPinned !== bPinned) return aPinned - bPinned;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

function mergeAlbumItems(primary: NavItem[], allAlbums: NavItem[]): NavItem[] {
  const seen = new Set<string>();
  const merged: NavItem[] = [];
  for (const item of [...primary, ...allAlbums]) {
    if (item.type !== "album" || seen.has(item.key)) continue;
    seen.add(item.key);
    merged.push(item);
  }
  return merged;
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
  variant = "sidebar",
}: {
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  variant?: "sidebar" | "page";
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const artistName = searchParams.get("name") || "";
  const { setPanel } = usePlayer();
  const [likedTracks, setLikedTracks] = useState(0);
  const [likedPinned, setLikedPinned] = useState(false);
  const [items, setItems] = useState<NavItem[]>([]);
  const [albums, setAlbums] = useState<NavItem[]>([]);
  const [artists, setArtists] = useState<NavItem[]>([]);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<LibrarySort>("recents");
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
      setAlbums(Array.isArray(data.albums) ? data.albums : []);
      setArtists(Array.isArray(data.artists) ? data.artists : []);
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
  }, [refresh]);

  const likedActive = pathname.startsWith("/library/liked");
  const isPage = variant === "page";
  const coverSize = isPage ? "size-12" : expanded ? "size-14" : "size-11";
  const rowPad = isPage ? "px-2 py-2.5" : "px-3 py-2";

  const { showLiked, visibleItems } = useMemo(() => {
    if (!isPage) {
      return { showLiked: true, visibleItems: items };
    }

    if (filter === "playlists") {
      return {
        showLiked: true,
        visibleItems: sortNavItems(
          items.filter((item) => item.type !== "album"),
          sort,
        ),
      };
    }

    if (filter === "albums") {
      const albumRows = albums.length
        ? albums
        : items.filter((item) => item.type === "album");
      return {
        showLiked: false,
        visibleItems: sortNavItems(albumRows, sort),
      };
    }

    if (filter === "artists") {
      return {
        showLiked: false,
        visibleItems: sortNavItems(artists, sort),
      };
    }

    const nonAlbum = items.filter((item) => item.type !== "album");
    const allAlbums = mergeAlbumItems(
      items.filter((item) => item.type === "album"),
      albums,
    );
    return {
      showLiked: true,
      visibleItems: sortNavItems([...nonAlbum, ...allAlbums], sort),
    };
  }, [albums, artists, filter, isPage, items, sort]);

  function renderNavItem(item: NavItem) {
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
      (item.type === "album" && pathname === `/album/${albumId}`) ||
      (item.type === "artist" &&
        pathname === "/artist" &&
        artistName === item.title);
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
      item.type === "artist"
        ? `Artist · ${item.tracks} song${item.tracks === 1 ? "" : "s"}`
        : item.type === "album"
          ? `Album · ${item.artist}`
          : item.type === "folder"
            ? `Folder · ${item.tracks} playlist${item.tracks === 1 ? "" : "s"}`
            : `Playlist · ${item.artist}`;
    const coverClass = cn(
      "shrink-0",
      coverSize,
      item.type === "artist" ? "rounded-full" : "rounded-sm",
    );

    const row = (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        onClick={dismissOverlays}
        className={cn(
          "flex w-full items-center gap-3 rounded-md transition-colors",
          rowPad,
          active ? "bg-muted/60" : "hover:bg-muted/40",
        )}
      >
        {item.type === "folder" ? (
          <FolderCover className={coverClass} />
        ) : item.type === "artist" ? (
          item.image ? (
            <CoverArt
              seed={item.title}
              image={item.image}
              className={coverClass}
            />
          ) : (
            <ArtistPlaceholder className={coverClass} />
          )
        ) : item.image ? (
          <CoverArt
            seed={`${item.artist}-${item.title}`}
            image={item.image}
            className={coverClass}
          />
        ) : item.type === "playlist" ? (
          <PlaylistPlaceholder className={coverClass} />
        ) : (
          <CoverArt
            seed={`${item.artist}-${item.title}`}
            image={item.image}
            className={coverClass}
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
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        </div>
      </Link>
    );

    if (item.type === "artist") {
      return (
        <div key={item.key}>{row}</div>
      );
    }

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
        {row}
      </LibraryItemContextMenu>
    );
  }

  const likedBlock = showLiked ? (
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
          "flex w-full items-center gap-3 rounded-md transition-colors",
          rowPad,
          likedActive ? "bg-muted/60" : "hover:bg-muted/40",
        )}
      >
        <LikedSongsCover className={cn("shrink-0 rounded-sm", coverSize)} />
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
  ) : null;

  const list = (
    <>
      {likedBlock}
      {visibleItems.map((item) => renderNavItem(item))}
    </>
  );

  const mobileChrome = isPage ? (
    <div className="shrink-0 border-b border-border/60 bg-background px-1 pb-4 pt-[max(0.75rem,var(--safe-top))]">
      <div className="flex flex-col gap-3">
        <MobileLibraryHeader />
        <div className="-mx-1 px-1">
          <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {FILTER_TABS.map((tab) => {
              const active = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-full px-3.5 py-2 text-sm font-medium leading-normal transition-colors",
                    active
                      ? "bg-foreground text-background"
                      : "bg-muted/60 text-foreground hover:bg-muted",
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex min-h-9 items-center px-1">
          <button
            type="button"
            onClick={() =>
              setSort((current) => (current === "recents" ? "alpha" : "recents"))
            }
            className="inline-flex min-h-9 items-center gap-1.5 py-1 text-sm font-medium leading-normal text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowDownUp className="size-4 shrink-0" strokeWidth={2} />
            {sort === "recents" ? "Recents" : "A–Z"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        isPage ? "min-h-0 flex-1" : "flex-1",
      )}
    >
      {mobileChrome}

      {!isPage ? (
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
      ) : null}

      {isPage ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
          <div className="space-y-0.5 pt-1">{list}</div>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-0.5">{list}</div>
        </ScrollArea>
      )}
    </div>
  );
}
