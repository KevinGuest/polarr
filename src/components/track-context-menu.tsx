"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CirclePlus,
  Copy,
  Heart,
  Info,
  Link2,
  ListEnd,
  ListMusic,
  ListPlus,
  Plus,
  Share2,
  Ban,
  FileText,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  usePlayer,
  type PlayerTrack,
} from "@/components/player-provider";
import { formatDuration } from "@/lib/utils";
import { albumHref } from "@/lib/album-ref";
import { emitLibraryChanged, emitLikesChanged } from "@/lib/ui-events";

type PlaylistRow = {
  id: string;
  name: string;
  trackCount: number;
};

function trackShareUrl(track: PlayerTrack) {
  const path = albumHref({
    title: track.album || track.title,
    artist: track.artist,
  });
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

function isLibraryTrackId(id: string) {
  return Boolean(id) && !id.startsWith("stream:");
}

/** Right-click track menu with playlist, like, queue, share, etc. */
export function TrackContextMenu({
  track,
  children,
  initialLiked,
  inLibrary,
}: {
  track: PlayerTrack;
  children: React.ReactNode;
  initialLiked?: boolean;
  /** When true, show admin hard-delete for indexed library tracks. */
  inLibrary?: boolean;
}) {
  const { addToQueue } = usePlayer();
  const [liked, setLiked] = useState(Boolean(initialLiked));
  const [isAdmin, setIsAdmin] = useState(false);
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [credits, setCredits] = useState<{
    duration?: number;
    album?: string;
  } | null>(null);

  useEffect(() => {
    setLiked(Boolean(initialLiked));
  }, [initialLiked, track.id]);

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

  const loadAdmin = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) {
        setIsAdmin(false);
        return;
      }
      const data = await res.json();
      setIsAdmin(Boolean(data.user?.isAdmin));
    } catch {
      setIsAdmin(false);
    }
  }, []);

  const canHardDelete =
    isAdmin &&
    inLibrary !== false &&
    isLibraryTrackId(track.id);

  async function saveLiked() {
    const next = !liked;
    setLiked(next);
    try {
      const res = await fetch("/api/likes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackId: track.id,
          liked: next,
          artist: track.artist,
          title: track.title,
          album: track.album,
          coverPath: track.coverPath,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setLiked(!next);
        toast.error(
          typeof data?.error === "string"
            ? data.error
            : "Couldn’t update Liked Songs",
        );
        return;
      }
      const persisted =
        typeof data?.liked === "boolean" ? data.liked : next;
      setLiked(persisted);
      emitLikesChanged({
        liked: persisted,
        count: typeof data?.count === "number" ? data.count : undefined,
      });
      toast(persisted ? "Saved to Liked Songs" : "Removed from Liked Songs", {
        icon: <Heart className="size-4 fill-current" />,
        style: {
          background: "#000",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.12)",
        },
      });
    } catch {
      setLiked(!next);
      toast.error("Couldn’t update Liked Songs");
    }
  }

  async function addToPlaylist(playlistId: string, name: string) {
    const res = await fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playlistId, trackId: track.id }),
    });
    if (!res.ok) {
      toast.error("Couldn’t add to playlist");
      return;
    }
    toast.success(`Added to ${name}`);
    void loadPlaylists();
  }

  async function createPlaylistAndAdd() {
    const name =
      typeof window !== "undefined"
        ? window.prompt("Playlist name", "My Playlist")
        : null;
    if (!name?.trim()) return;
    const res = await fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), trackId: track.id }),
    });
    if (!res.ok) {
      toast.error("Couldn’t create playlist");
      return;
    }
    toast.success(`Added to ${name.trim()}`);
    void loadPlaylists();
  }

  async function excludeFromTaste() {
    const res = await fetch("/api/taste/exclude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId: track.id }),
    });
    if (!res.ok) {
      toast.error("Couldn’t update taste profile");
      return;
    }
    toast.success("Excluded from your taste profile");
  }

  async function removeFromLibrary() {
    if (
      !confirm(
        `Remove “${track.title}” from the library and delete the file on disk? It will need to be re-downloaded to play again.`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/tracks/${encodeURIComponent(track.id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(
          typeof data?.error === "string"
            ? data.error
            : "Couldn’t remove from library",
        );
        return;
      }
      emitLibraryChanged({ trackId: track.id });
      toast.success("Removed from library");
    } catch {
      toast.error("Couldn’t remove from library");
    }
  }

  async function openCredits() {
    setCreditsOpen(true);
    setCredits(null);
    try {
      const res = await fetch(`/api/tracks/${encodeURIComponent(track.id)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setCredits({ album: track.album, duration: undefined });
        return;
      }
      const data = await res.json();
      setCredits({
        album: data.track?.album || track.album,
        duration: data.track?.duration,
      });
    } catch {
      setCredits({ album: track.album });
    }
  }

  async function copyLink() {
    const url = trackShareUrl(track);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn’t copy link");
    }
  }

  async function copySongInfo() {
    const text = `${track.title} — ${track.artist}${track.album ? ` · ${track.album}` : ""}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Couldn’t copy");
    }
  }

  async function nativeShare() {
    const url = trackShareUrl(track);
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({
          title: track.title,
          text: `${track.title} by ${track.artist}`,
          url,
        });
        return;
      } catch {
        /* fall through to copy */
      }
    }
    await copyLink();
  }

  return (
    <>
      <ContextMenu
        onOpenChange={(open) => {
          if (open) {
            void loadPlaylists();
            void loadAdmin();
          }
        }}
      >
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-64">
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ListPlus className="size-4 shrink-0 text-muted-foreground" />
              Add to playlist
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-52">
              <ContextMenuItem onSelect={() => void createPlaylistAndAdd()}>
                <Plus className="size-4 shrink-0 text-muted-foreground" />
                Create playlist
              </ContextMenuItem>
              {playlists.length > 0 ? <ContextMenuSeparator /> : null}
              {playlists.map((p) => (
                <ContextMenuItem
                  key={p.id}
                  onSelect={() => void addToPlaylist(p.id, p.name)}
                >
                  <ListMusic className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{p.name}</span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>

          <ContextMenuItem onSelect={() => void saveLiked()}>
            <CirclePlus className="size-4 shrink-0 text-muted-foreground" />
            {liked ? "Remove from Liked Songs" : "Save to your Liked Songs"}
          </ContextMenuItem>

          {canHardDelete ? (
            <ContextMenuItem
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              onSelect={() => void removeFromLibrary()}
            >
              <Trash2 className="size-4 shrink-0" />
              Remove from library
            </ContextMenuItem>
          ) : null}

          <ContextMenuItem
            onSelect={() => {
              addToQueue(track);
              toast("Queue updated", {
                description: "Cleared upcoming tracks",
                icon: <Info className="size-4" />,
                style: {
                  background: "#000",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.12)",
                },
              });
            }}
          >
            <ListEnd className="size-4 shrink-0 text-muted-foreground" />
            Add to queue
          </ContextMenuItem>

          <ContextMenuItem onSelect={() => void excludeFromTaste()}>
            <Ban className="size-4 shrink-0 text-muted-foreground" />
            Exclude from your taste profile
          </ContextMenuItem>

          <ContextMenuSeparator />

          <ContextMenuItem onSelect={() => void openCredits()}>
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            View credits
          </ContextMenuItem>

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
              <ContextMenuItem onSelect={() => void copySongInfo()}>
                <Copy className="size-4 shrink-0 text-muted-foreground" />
                Copy song info
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => void nativeShare()}>
                <Share2 className="size-4 shrink-0 text-muted-foreground" />
                Share…
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={creditsOpen} onOpenChange={setCreditsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Credits</DialogTitle>
          </DialogHeader>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Title</dt>
              <dd className="font-medium">{track.title}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Artist</dt>
              <dd className="font-medium">{track.artist}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Album</dt>
              <dd className="font-medium">
                {credits?.album || track.album || "—"}
              </dd>
            </div>
            {credits?.duration != null && credits.duration > 0 ? (
              <div>
                <dt className="text-muted-foreground">Duration</dt>
                <dd className="font-medium">
                  {formatDuration(credits.duration)}
                </dd>
              </div>
            ) : null}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
