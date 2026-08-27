"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LIBRARY_CHANGED_EVENT,
  LIBRARY_PINS_CHANGED_EVENT,
  LIKES_CHANGED_EVENT,
} from "@/lib/ui-events";

export type LibraryNavItem = {
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

export type LibraryFilter = "all" | "playlists" | "albums" | "artists";
export type LibrarySort = "recents" | "alpha";

export function sortLibraryNavItems(
  items: LibraryNavItem[],
  sort: LibrarySort,
): LibraryNavItem[] {
  if (sort === "alpha") {
    return items.slice().sort((a, b) => a.title.localeCompare(b.title));
  }
  return items.slice().sort((a, b) => {
    const aPinned = a.pinned ? 0 : 1;
    const bPinned = b.pinned ? 0 : 1;
    if (aPinned !== bPinned) return aPinned - bPinned;
    return (b.updatedAt || 0) - (b.updatedAt || 0);
  });
}

export function filterLibraryNavItems(
  items: LibraryNavItem[],
  artists: LibraryNavItem[],
  filter: LibraryFilter,
  sort: LibrarySort,
): { showLiked: boolean; visibleItems: LibraryNavItem[] } {
  if (filter === "playlists") {
    return {
      showLiked: true,
      visibleItems: sortLibraryNavItems(
        items.filter((item) => item.type !== "album" && item.type !== "artist"),
        sort,
      ),
    };
  }

  if (filter === "albums") {
    return {
      showLiked: false,
      visibleItems: sortLibraryNavItems(
        items.filter((item) => item.type === "album"),
        sort,
      ),
    };
  }

  if (filter === "artists") {
    return {
      showLiked: false,
      visibleItems: sortLibraryNavItems(artists, sort),
    };
  }

  return {
    showLiked: true,
    visibleItems: sortLibraryNavItems(items, sort),
  };
}

export function useLibraryNav() {
  const [likedTracks, setLikedTracks] = useState(0);
  const [likedPinned, setLikedPinned] = useState(false);
  const [items, setItems] = useState<LibraryNavItem[]>([]);
  const [artists, setArtists] = useState<LibraryNavItem[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/library/nav", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (!data) return;
      setLikedTracks(Number(data.liked?.tracks) || 0);
      setLikedPinned(Boolean(data.liked?.pinned));
      setItems(Array.isArray(data.items) ? data.items : []);
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

  return {
    likedTracks,
    likedPinned,
    setLikedPinned,
    items,
    artists,
    refresh,
  };
}
