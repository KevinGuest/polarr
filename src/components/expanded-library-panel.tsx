"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  Folder,
  LayoutGrid,
  Maximize2,
  Music2,
  Pin,
  Search,
  UserRound,
} from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { LikedSongsCover } from "@/components/liked-songs-cover";
import { LibraryCreateMenu } from "@/components/library-create-menu";
import {
  LibraryItemContextMenu,
  libraryAlbumHref,
} from "@/components/library-item-context-menu";
import { LibraryOfflineDownloadProgress } from "@/components/playlist-offline-download";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePlayer } from "@/components/player-provider";
import { encodeAlbumId } from "@/lib/album-ref";
import {
  filterLibraryNavItems,
  useLibraryNav,
  type LibraryFilter,
  type LibraryNavItem,
  type LibrarySort,
} from "@/lib/use-library-nav";
import { cn } from "@/lib/utils";

const FILTER_TABS: { id: LibraryFilter; label: string }[] = [
  { id: "playlists", label: "Playlists" },
  { id: "albums", label: "Albums" },
  { id: "artists", label: "Artists" },
];

function FolderCover({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex aspect-square w-full items-center justify-center bg-[#282828] text-[#b3b3b3]",
        className,
      )}
      aria-hidden
    >
      <Folder className="size-10" strokeWidth={1.5} />
    </div>
  );
}

function ArtistPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex aspect-square w-full items-center justify-center bg-[#282828] text-[#7f7f7f]",
        className,
      )}
      aria-hidden
    >
      <UserRound className="size-10" strokeWidth={1.5} />
    </div>
  );
}

function PlaylistPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex aspect-square w-full items-center justify-center bg-[#282828] text-[#7f7f7f]",
        className,
      )}
      aria-hidden
    >
      <Music2 className="size-10" strokeWidth={1.5} />
    </div>
  );
}

function itemSubtitle(item: LibraryNavItem): string {
  if (item.type === "artist") {
    return `Artist · ${item.tracks} song${item.tracks === 1 ? "" : "s"}`;
  }
  if (item.type === "album") {
    return `Album · ${item.artist}`;
  }
  if (item.type === "folder") {
    return `Folder · ${item.tracks} playlist${item.tracks === 1 ? "" : "s"}`;
  }
  return `Playlist · ${item.artist}`;
}

function LibraryGridTile({
  item,
  active,
  onNavigate,
}: {
  item: LibraryNavItem;
  active: boolean;
  onNavigate: () => void;
}) {
  const href =
    item.href ||
    (item.type === "album" ? libraryAlbumHref(item.artist, item.title) : "#");
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
  const rounded = item.type === "artist" ? "rounded-full" : "rounded-sm";

  const cover =
    item.type === "folder" ? (
      <FolderCover className={rounded} />
    ) : item.type === "artist" ? (
      item.image ? (
        <CoverArt
          seed={item.title}
          image={item.image}
          className={cn("aspect-square w-full", rounded)}
        />
      ) : (
        <ArtistPlaceholder className={rounded} />
      )
    ) : item.image ? (
      <CoverArt
        seed={`${item.artist}-${item.title}`}
        image={item.image}
        className={cn("aspect-square w-full", rounded)}
      />
    ) : item.type === "playlist" ? (
      <PlaylistPlaceholder className={rounded} />
    ) : (
      <CoverArt
        seed={`${item.artist}-${item.title}`}
        image={item.image}
        className={cn("aspect-square w-full", rounded)}
      />
    );

  const tile = (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className="group block rounded-md p-2 transition-colors hover:bg-muted/40"
    >
      <div className="mb-3 overflow-hidden shadow-sm">{cover}</div>
      <div className="space-y-1 px-0.5">
        <div className="flex items-start gap-1">
          <p className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-tight text-foreground">
            {item.title}
          </p>
          {item.pinned ? (
            <Pin
              className="mt-0.5 size-3 shrink-0 fill-current text-muted-foreground"
              aria-label="Pinned"
            />
          ) : null}
        </div>
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {itemSubtitle(item)}
        </p>
      </div>
    </Link>
  );

  if (item.type === "artist") {
    return tile;
  }

  return (
    <LibraryItemContextMenu
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
          item.type === "folder" ? item.key.replace(/^folder:/, "") : undefined,
      }}
    >
      {tile}
    </LibraryItemContextMenu>
  );
}

export function ExpandedLibraryPanel({
  onClose,
}: {
  onClose: () => void;
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

  const { showLiked, visibleItems } = useMemo(
    () => filterLibraryNavItems(items, artists, filter, sort),
    [artists, filter, items, sort],
  );

  const likedActive = pathname.startsWith("/library/liked");

  function isItemActive(item: LibraryNavItem): boolean {
    const href =
      item.href ||
      (item.type === "album" ? libraryAlbumHref(item.artist, item.title) : "#");
    const albumId =
      item.type === "album"
        ? encodeAlbumId({ title: item.title, artist: item.artist })
        : "";
    return (
      pathname === href ||
      (item.type === "album" && pathname === `/album/${albumId}`) ||
      (item.type === "artist" &&
        pathname === "/artist" &&
        artistName === item.title)
    );
  }

  function handleNavigate() {
    dismissOverlays();
    onClose();
  }

  return (
    <div className="absolute inset-0 z-30 flex min-h-0 flex-col border-r border-border bg-background">
      <div className="shrink-0 px-6 pb-4 pt-6 lg:px-8">
        <div className="mb-5 flex items-center gap-3">
          <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight text-foreground">
            Your Library
          </h1>
          <LibraryCreateMenu variant="header" />
          <button
            type="button"
            aria-label="Collapse library"
            onClick={onClose}
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <Maximize2 className="size-5 rotate-45" strokeWidth={2} />
          </button>
        </div>

        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {FILTER_TABS.map((tab) => {
              const active = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() =>
                    setFilter((current) =>
                      current === tab.id ? "all" : tab.id,
                    )
                  }
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
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

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <Link
              href="/search?scope=library"
              onClick={handleNavigate}
              className="inline-flex h-9 min-w-[12rem] flex-1 items-center gap-2 rounded-full bg-muted/60 px-4 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground xl:max-w-xs xl:flex-none"
            >
              <Search className="size-4 shrink-0" strokeWidth={2} />
              <span>Search in Your Library</span>
            </Link>
            <button
              type="button"
              onClick={() =>
                setSort((current) =>
                  current === "recents" ? "alpha" : "recents",
                )
              }
              className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              {sort === "recents" ? "Recents" : "A–Z"}
              <ChevronDown className="size-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label="Grid view"
              className="inline-flex size-9 items-center justify-center rounded-full bg-muted/60 text-foreground"
            >
              <LayoutGrid className="size-4" strokeWidth={2} />
            </button>
          </div>
        </div>

        <LibraryOfflineDownloadProgress />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-6 pb-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 lg:px-8">
          {showLiked ? (
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
                onClick={handleNavigate}
                className="group block rounded-md p-2 transition-colors hover:bg-muted/40"
              >
                <div className="mb-3 overflow-hidden rounded-sm shadow-sm">
                  <LikedSongsCover className="aspect-square w-full rounded-sm" />
                </div>
                <div className="space-y-1 px-0.5">
                  <div className="flex items-start gap-1">
                    <p className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-tight text-foreground">
                      Liked Songs
                    </p>
                    {likedPinned ? (
                      <Pin
                        className="mt-0.5 size-3 shrink-0 fill-current text-muted-foreground"
                        aria-label="Pinned"
                      />
                    ) : null}
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    Playlist · {likedTracks} song
                    {likedTracks === 1 ? "" : "s"}
                  </p>
                </div>
              </Link>
            </LibraryItemContextMenu>
          ) : null}

          {visibleItems.map((item) => (
            <LibraryGridTile
              key={item.key}
              item={item}
              active={isItemActive(item)}
              onNavigate={handleNavigate}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
