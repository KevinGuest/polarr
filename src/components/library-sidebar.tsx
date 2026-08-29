"use client";

import { useMemo, useState, type ReactNode } from "react";
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
import { cn } from "@/lib/utils";
import { InsetGroup } from "@/components/media-shelf";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePlayer } from "@/components/player-provider";
import { LibraryOfflineDownloadProgress } from "@/components/playlist-offline-download";
import {
  ArrowDownUp,
  Folder,
  Library,
  Maximize2,
  Music2,
  Pin,
  UserRound,
} from "lucide-react";

import {
  filterLibraryNavItems,
  useLibraryNav,
  type LibraryFilter,
  type LibraryNavItem,
  type LibrarySort,
} from "@/lib/use-library-nav";

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
        "flex items-center justify-center bg-white/10 text-muted-foreground",
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
        "flex items-center justify-center bg-white/10 text-muted-foreground",
        className,
      )}
      aria-hidden
    >
      <UserRound className="size-4" strokeWidth={1.75} />
    </div>
  );
}

function PlaylistPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center bg-white/10 text-muted-foreground",
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
  collapsed = false,
  onCollapsedChange,
  variant = "sidebar",
}: {
  /** Full “Your Library” overlay covering the main pane */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Narrow cover-only rail */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  variant?: "sidebar" | "page";
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const artistName = searchParams.get("name") || "";
  const { setPanel } = usePlayer();
  const { likedTracks, likedPinned, setLikedPinned, items, artists } =
    useLibraryNav();
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<LibrarySort>("recents");
  const dismissOverlays = () => setPanel("none");

  const likedActive = pathname.startsWith("/library/liked");
  const isPage = variant === "page";
  const isRail = !isPage && collapsed;
  const coverSize = isPage
    ? "size-12"
    : isRail
      ? "size-12"
      : "size-11";
  const rowPad = isPage ? "px-2 py-2.5" : isRail ? "justify-center p-1.5" : "px-3 py-2";

  const { showLiked, visibleItems } = useMemo(() => {
    if (!isPage) {
      return { showLiked: true, visibleItems: items };
    }
    return filterLibraryNavItems(items, artists, filter, sort);
  }, [artists, filter, isPage, items, sort]);

  function renderNavItem(item: LibraryNavItem) {
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
      item.type === "artist" ? "rounded-full" : "rounded-xl",
    );

    const row = (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        aria-label={isRail ? item.title : undefined}
        title={isRail ? item.title : undefined}
        onClick={dismissOverlays}
        className={cn(
          "flex w-full items-center gap-3 transition-colors",
          rowPad,
          isPage
            ? active
              ? "bg-white/[0.06]"
              : ""
            : active
              ? "rounded-xl bg-muted/60"
              : "rounded-xl hover:bg-muted/40",
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
        {!isRail ? (
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  "truncate text-foreground",
                  isPage ? "text-[17px]" : "text-sm font-medium",
                )}
              >
                {item.title}
              </div>
              {item.pinned ? (
                <Pin
                  className="size-3 shrink-0 fill-current text-muted-foreground"
                  aria-label="Pinned"
                />
              ) : null}
            </div>
            <div className={cn(
              "truncate text-muted-foreground",
              isPage ? "text-[13px]" : "text-xs",
            )}>{subtitle}</div>
          </div>
        ) : null}
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
        aria-label={isRail ? "Liked Songs" : undefined}
        title={isRail ? "Liked Songs" : undefined}
        onClick={dismissOverlays}
        className={cn(
          "flex w-full items-center gap-3 transition-colors",
          rowPad,
          isPage
            ? likedActive
              ? "bg-white/[0.06]"
              : ""
            : likedActive
              ? "rounded-xl bg-muted/60"
              : "rounded-xl hover:bg-muted/40",
        )}
      >
        <LikedSongsCover
          className={cn(
            "shrink-0",
            coverSize,
            "rounded-xl",
          )}
        />
        {!isRail ? (
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  "truncate text-foreground",
                  isPage ? "text-[17px]" : "text-sm font-medium",
                )}
              >
                Liked Songs
              </div>
              {likedPinned ? (
                <Pin
                  className="size-3 shrink-0 fill-current text-muted-foreground"
                  aria-label="Pinned"
                />
              ) : null}
            </div>
            <div
              className={cn(
                "truncate text-muted-foreground",
                isPage ? "text-[13px]" : "text-xs",
              )}
            >
              Playlist · {likedTracks} song{likedTracks === 1 ? "" : "s"}
            </div>
          </div>
        ) : null}
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
    <div className="shrink-0 bg-background px-1 pb-3 pt-[max(0.75rem,var(--safe-top))]">
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
          {isRail ? (
            <div className="mb-2 flex flex-col items-center gap-1">
              <HeaderButton
                label="Widen Your Library"
                onClick={() => onCollapsedChange?.(false)}
              >
                <Library className="size-4" strokeWidth={2} />
              </HeaderButton>
              <LibraryCreateMenu />
            </div>
          ) : (
            <div className="mb-2 flex items-center gap-1 px-1">
              <HeaderButton
                label="Shrink Your Library"
                onClick={() => {
                  onExpandedChange?.(false);
                  onCollapsedChange?.(true);
                }}
              >
                <Library className="size-4" strokeWidth={2} />
              </HeaderButton>
              <p className="min-w-0 flex-1 truncate px-1 text-[15px] font-semibold tracking-tight text-foreground">
                Your Library
              </p>
              <LibraryCreateMenu variant="pill" />
              <HeaderButton
                label={expanded ? "Collapse Your Library" : "Expand Your Library"}
                onClick={() => {
                  onCollapsedChange?.(false);
                  onExpandedChange?.(!expanded);
                }}
              >
                <Maximize2 className="size-3.5" strokeWidth={2} />
              </HeaderButton>
            </div>
          )}
        </TooltipProvider>
      ) : null}

      {!isRail ? <LibraryOfflineDownloadProgress /> : null}

      {isPage ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 pb-4">
          <InsetGroup>{list}</InsetGroup>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-0.5">{list}</div>
        </ScrollArea>
      )}
    </div>
  );
}
