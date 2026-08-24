"use client";

import {
  toastError,
  toastInfo,
  toastSuccess,
} from "@/lib/toast";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Check,
  CirclePlus,
  Copy,
  Download,
  Folder,
  FolderInput,
  Link2,
  ListEnd,
  ListMusic,
  Pin,
  PinOff,
  Plus,
  Share2,
  Trash2,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { usePlayer, type PlayerTrack } from "@/components/player-provider";
import { albumHref } from "@/lib/album-ref";
import {
  emitLibraryChanged,
  emitLibraryPinsChanged,
} from "@/lib/ui-events";

type PlaylistRow = {
  id: string;
  name: string;
  trackCount: number;
};

type FolderRow = {
  id: string;
  name: string;
  playlistCount: number;
};

export type LibrarySidebarItem = {
  kind: "album" | "liked" | "playlist" | "folder";
  title: string;
  artist: string;
  pinKey: string;
  pinned?: boolean;
  href: string;
  image?: string | null;
  playlistId?: string;
  folderId?: string;
};

async function loadAlbumPlayerTracks(
  artist: string,
  album: string,
): Promise<PlayerTrack[]> {
  const qs = new URLSearchParams({ title: album, artist });
  const res = await fetch(`/api/album?${qs.toString()}`, { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok) return [];
  const list = Array.isArray(data?.tracks) ? data.tracks : [];
  const cover = data?.album?.image || null;
  return list
    .filter((t: { title?: string }) => Boolean(t.title))
    .map(
      (t: {
        title: string;
        artists?: string;
        localTrackId?: string | null;
        streamUrl?: string | null;
        explicit?: boolean;
      }) =>
        ({
          id:
            t.localTrackId ||
            `stream:${artist.trim().toLowerCase()}|${t.title.trim().toLowerCase()}`,
          title: t.title,
          artist: t.artists || artist,
          resolveArtist: artist,
          album,
          coverPath: cover,
          streamUrl: t.streamUrl || null,
          explicit: t.explicit,
        }) satisfies PlayerTrack,
    );
}

async function loadPlaylistPlayerTracks(
  playlistId: string,
): Promise<PlayerTrack[]> {
  const res = await fetch(
    `/api/playlists?id=${encodeURIComponent(playlistId)}`,
    { cache: "no-store" },
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) return [];
  const list = Array.isArray(data?.tracks) ? data.tracks : [];
  const cover = data?.playlist?.coverUrl || null;
  return list.map(
    (t: {
      id: string;
      title: string;
      artist: string;
      album?: string;
      coverPath?: string | null;
    }) =>
      ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        resolveArtist: t.artist,
        album: t.album || "",
        coverPath: t.coverPath || cover,
      }) satisfies PlayerTrack,
  );
}

async function loadLikedPlayerTracks(): Promise<PlayerTrack[]> {
  const res = await fetch("/api/likes", { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok) return [];
  const list = Array.isArray(data?.items) ? data.items : [];
  return list.map(
    (t: {
      id: string;
      title: string;
      artist: string;
      album?: string;
      coverPath?: string | null;
    }) =>
      ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        resolveArtist: t.artist,
        album: t.album || "",
        coverPath: t.coverPath || null,
      }) satisfies PlayerTrack,
  );
}

/** Spotify-style right-click menu for library sidebar albums / Liked Songs. */
export function LibraryItemContextMenu({
  item,
  children,
  onPinnedChange,
}: {
  item: LibrarySidebarItem;
  children: ReactNode;
  onPinnedChange?: (pinned: boolean) => void;
}) {
  const { addToQueue } = usePlayer();
  const router = useRouter();
  const pathname = usePathname();
  const [pinned, setPinned] = useState(Boolean(item.pinned));
  const [isAdmin, setIsAdmin] = useState(false);
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [folders, setFolders] = useState<FolderRow[]>([]);

  useEffect(() => {
    setPinned(Boolean(item.pinned));
  }, [item.pinned, item.pinKey]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setIsAdmin(Boolean(data.user?.isAdmin));
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  const loadPlaylists = useCallback(async () => {
    try {
      const res = await fetch("/api/playlists", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setPlaylists(Array.isArray(data.playlists) ? data.playlists : []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadFolders = useCallback(async () => {
    try {
      const res = await fetch("/api/playlist-folders", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setFolders(Array.isArray(data.folders) ? data.folders : []);
    } catch {
      /* ignore */
    }
  }, []);

  async function resolveTracks(): Promise<PlayerTrack[]> {
    if (item.kind === "liked") return loadLikedPlayerTracks();
    if (item.kind === "playlist" && item.playlistId) {
      return loadPlaylistPlayerTracks(item.playlistId);
    }
    if (item.kind === "folder") return [];
    return loadAlbumPlayerTracks(item.artist, item.title);
  }

  async function queueAll() {
    try {
      const tracks = await resolveTracks();
      if (!tracks.length) {
        toastInfo("Nothing to queue");
        return;
      }
      for (const t of tracks) addToQueue(t);
      toastSuccess(
        `Added ${tracks.length} song${tracks.length === 1 ? "" : "s"} to queue`,
      );
    } catch {
      toastError("Couldn’t add to queue");
    }
  }

  async function togglePin() {
    const next = !pinned;
    setPinned(next);
    onPinnedChange?.(next);
    try {
      const res = await fetch("/api/library/pins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemKey: item.pinKey, pinned: next }),
      });
      if (!res.ok) {
        setPinned(!next);
        onPinnedChange?.(!next);
        toastError("Couldn’t update pin");
        return;
      }
      emitLibraryPinsChanged();
      toastSuccess(
        item.kind === "album"
          ? next
            ? "Added to Your Library"
            : "Removed from Your Library"
          : next
            ? "Pinned to Library"
            : "Unpinned",
      );
    } catch {
      setPinned(!next);
      onPinnedChange?.(!next);
      toastError("Couldn’t update pin");
    }
  }

  async function addTracksToPlaylist(playlistId: string, name: string) {
    try {
      const tracks = await resolveTracks();
      const withIds = tracks.filter((t) => t.id && !t.id.startsWith("stream:"));
      if (!withIds.length) {
        toastInfo("No library tracks to add yet");
        return;
      }
      let ok = 0;
      for (const t of withIds) {
        const res = await fetch("/api/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playlistId, trackId: t.id }),
        });
        if (res.ok) ok += 1;
      }
      toastSuccess(
        ok
          ? `Added ${ok} song${ok === 1 ? "" : "s"} to “${name}”`
          : `Couldn’t add to “${name}”`,
      );
    } catch {
      toastError("Couldn’t add to playlist");
    }
  }

  async function createPlaylistAndAdd() {
    const name =
      typeof window !== "undefined"
        ? window.prompt("Playlist name", item.title)
        : null;
    if (!name?.trim()) return;
    const res = await fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.playlist?.id) {
      toastError("Couldn’t create playlist");
      return;
    }
    await addTracksToPlaylist(data.playlist.id, name.trim());
    void loadPlaylists();
    emitLibraryChanged();
  }

  async function downloadAll() {
    try {
      const tracks = await resolveTracks();
      const local = tracks.filter((t) => t.id && !t.id.startsWith("stream:"));
      if (!local.length) {
        if (item.kind === "album") {
          const res = await fetch("/api/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: item.title,
              artist: item.artist,
              album: item.title,
              type: "album",
              prefer: "fallback",
            }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok) {
            toastError(data?.error || "Download failed");
            return;
          }
          toastSuccess("Download started — check Requests");
          return;
        }
        toastInfo("No songs to download");
        return;
      }
      let ok = 0;
      for (const t of local) {
        const res = await fetch(`/api/tracks/${encodeURIComponent(t.id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId: "web" }),
        });
        if (res.ok) ok += 1;
      }
      toastSuccess(
        ok
          ? `Marked ${ok} song${ok === 1 ? "" : "s"} for offline`
          : "Couldn’t mark for download",
      );
    } catch {
      toastError("Download failed");
    }
  }

  async function removeFromLibrary() {
    if (item.kind !== "album") return;
    if (!isAdmin) {
      toastInfo("Only admins can remove albums from the shared library");
      return;
    }
    if (
      !confirm(
        `Remove “${item.title}” by ${item.artist} from the library and delete files on disk?`,
      )
    ) {
      return;
    }
    try {
      const qs = new URLSearchParams({
        artist: item.artist,
        album: item.title,
      });
      const res = await fetch(`/api/library/album?${qs.toString()}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toastError(data?.error || "Couldn’t remove album");
        return;
      }
      emitLibraryChanged();
      toastSuccess(
        `Removed ${typeof data?.removed === "number" ? data.removed : ""} tracks`.trim(),
      );
    } catch {
      toastError("Couldn’t remove album");
    }
  }

  async function deleteThisPlaylist() {
    if (item.kind !== "playlist" || !item.playlistId) return;
    if (!confirm(`Delete playlist “${item.title}”? This can’t be undone.`)) {
      return;
    }
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          playlistId: item.playlistId,
        }),
      });
      if (!res.ok) {
        toastError("Couldn’t delete playlist");
        return;
      }
      emitLibraryChanged();
      toastSuccess("Playlist deleted");
      if (pathname.startsWith(`/playlist/${item.playlistId}`)) {
        router.push("/");
      }
    } catch {
      toastError("Couldn’t delete playlist");
    }
  }

  async function deleteThisFolder() {
    if (item.kind !== "folder" || !item.folderId) return;
    if (
      !confirm(
        `Delete folder “${item.title}”? Playlists inside will stay in your library.`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch("/api/playlist-folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          folderId: item.folderId,
        }),
      });
      if (!res.ok) {
        toastError("Couldn’t delete folder");
        return;
      }
      emitLibraryChanged();
      toastSuccess("Folder deleted");
      if (pathname.startsWith(`/folder/${item.folderId}`)) {
        router.push("/");
      }
    } catch {
      toastError("Couldn’t delete folder");
    }
  }

  async function moveToFolder(folderId: string | null, name?: string) {
    if (item.kind !== "playlist" || !item.playlistId) return;
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "move",
          playlistId: item.playlistId,
          folderId,
        }),
      });
      if (!res.ok) {
        toastError("Couldn’t move playlist");
        return;
      }
      emitLibraryChanged();
      toastSuccess(
        folderId && name ? `Moved to “${name}”` : "Removed from folder",
      );
    } catch {
      toastError("Couldn’t move playlist");
    }
  }

  function pinLabel() {
    if (item.kind === "liked") {
      return pinned ? "Unpin Liked Songs" : "Pin Liked Songs";
    }
    if (item.kind === "playlist") {
      return pinned ? "Unpin playlist" : "Pin playlist";
    }
    if (item.kind === "folder") {
      return pinned ? "Unpin folder" : "Pin folder";
    }
    return pinned ? "Remove from Your Library" : "Add to Your Library";
  }

  function shareUrl() {
    if (typeof window === "undefined") return item.href;
    return `${window.location.origin}${item.href}`;
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl());
      toastSuccess("Link copied");
    } catch {
      toastError("Couldn’t copy link");
    }
  }

  async function nativeShare() {
    const url = shareUrl();
    if (!navigator.share) {
      await copyLink();
      return;
    }
    try {
      await navigator.share({
        title: item.title,
        text: item.kind === "liked" ? "Liked Songs" : `${item.title} — ${item.artist}`,
        url,
      });
    } catch {
      /* cancelled */
    }
  }

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) {
          void loadPlaylists();
          void loadFolders();
        }
      }}
    >
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        {item.kind === "album" ? (
          <ContextMenuItem
            onSelect={() => void removeFromLibrary()}
            className={
              isAdmin
                ? "text-destructive focus:bg-destructive/10 focus:text-destructive"
                : undefined
            }
          >
            <Trash2 className="size-4 shrink-0 text-muted-foreground" />
            Delete album files
          </ContextMenuItem>
        ) : null}

        {item.kind === "playlist" ? (
          <ContextMenuItem
            onSelect={() => void deleteThisPlaylist()}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <Trash2 className="size-4 shrink-0" />
            Delete playlist
          </ContextMenuItem>
        ) : null}

        {item.kind === "folder" ? (
          <ContextMenuItem
            onSelect={() => void deleteThisFolder()}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <Trash2 className="size-4 shrink-0" />
            Delete folder
          </ContextMenuItem>
        ) : null}

        {item.kind !== "folder" ? (
          <ContextMenuItem onSelect={() => void queueAll()}>
            <ListEnd className="size-4 shrink-0 text-muted-foreground" />
            Add to queue
          </ContextMenuItem>
        ) : null}

        <ContextMenuItem onSelect={() => void togglePin()}>
          {item.kind === "album" ? (
            pinned ? (
              <Check className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <CirclePlus className="size-4 shrink-0 text-muted-foreground" />
            )
          ) : pinned ? (
            <PinOff className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <Pin className="size-4 shrink-0 text-muted-foreground" />
          )}
          {pinLabel()}
        </ContextMenuItem>

        {item.kind === "playlist" ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <FolderInput className="size-4 shrink-0 text-muted-foreground" />
              Move to folder
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-52">
              <ContextMenuItem onSelect={() => void moveToFolder(null)}>
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                Library (no folder)
              </ContextMenuItem>
              {folders.length > 0 ? <ContextMenuSeparator /> : null}
              {folders.map((f) => (
                <ContextMenuItem
                  key={f.id}
                  onSelect={() => void moveToFolder(f.id, f.name)}
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  {f.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : null}

        {item.kind !== "folder" ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Plus className="size-4 shrink-0 text-muted-foreground" />
              Add to playlist
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-52">
              <ContextMenuItem onSelect={() => void createPlaylistAndAdd()}>
                <CirclePlus className="size-4 shrink-0 text-muted-foreground" />
                New playlist
              </ContextMenuItem>
              {playlists.length > 0 ? <ContextMenuSeparator /> : null}
              {playlists.map((p) => (
                <ContextMenuItem
                  key={p.id}
                  onSelect={() => void addTracksToPlaylist(p.id, p.name)}
                >
                  <ListMusic className="size-4 shrink-0 text-muted-foreground" />
                  {p.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : null}

        {item.kind !== "folder" ? (
          <ContextMenuItem onSelect={() => void downloadAll()}>
            <Download className="size-4 shrink-0 text-muted-foreground" />
            Download
          </ContextMenuItem>
        ) : null}

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Share2 className="size-4 shrink-0 text-muted-foreground" />
            Share
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <ContextMenuItem onSelect={() => void copyLink()}>
              <Link2 className="size-4 shrink-0 text-muted-foreground" />
              Copy link
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                void navigator.clipboard
                  .writeText(
                    item.kind === "liked"
                      ? "Liked Songs"
                      : `${item.title} — ${item.artist}`,
                  )
                  .then(() => toastSuccess("Copied"))
                  .catch(() => toastError("Couldn’t copy"));
              }}
            >
              <Copy className="size-4 shrink-0 text-muted-foreground" />
              Copy info
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void nativeShare()}>
              <Share2 className="size-4 shrink-0 text-muted-foreground" />
              Share…
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Helper for album href used by sidebar menus. */
export function libraryAlbumHref(artist: string, title: string) {
  return albumHref({ title, artist });
}
