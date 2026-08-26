"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Check, Circle, HardDrive, Plus, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PromptDialog } from "@/components/confirm-dialog";
import { Input } from "@/components/ui/input";
import { LikedSongsCover } from "@/components/liked-songs-cover";
import { emitLikesChanged, emitLibraryChanged } from "@/lib/ui-events";
import { cn } from "@/lib/utils";
import { toastError, toastInfo, toastSuccess } from "@/lib/toast";

type PlaylistRow = {
  id: string;
  name: string;
  trackCount: number;
  contains: boolean;
};

function MembershipMark({ saved }: { saved: boolean }) {
  if (saved) {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }
  return (
    <Circle
      className="size-5 shrink-0 text-muted-foreground/80"
      strokeWidth={1.5}
    />
  );
}

/**
 * Anchored “Add to playlist” menu (context-menu style, not a modal).
 */
export function AddToPlaylistMenu({
  trackId,
  artist,
  title,
  album,
  coverPath,
  duration,
  inLibrary,
  onPolarr,
  onDownload,
  children,
}: {
  trackId: string;
  artist: string;
  title: string;
  album?: string;
  coverPath?: string | null;
  duration?: number;
  inLibrary?: boolean;
  /** Already playable from this Polarr server — don’t treat as “save to library”. */
  onPolarr?: boolean;
  /** Acquire / download into the library when the track isn’t local yet. */
  onDownload?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [liked, setLiked] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [namePromptOpen, setNamePromptOpen] = useState(false);

  const libraryTrack =
    (Boolean(inLibrary) || Boolean(onPolarr)) &&
    Boolean(trackId) &&
    !trackId.startsWith("stream:") &&
    !trackId.startsWith("live:") &&
    !trackId.startsWith("catalog:");


  const load = useCallback(async () => {
    if (!trackId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/playlists?forTrack=${encodeURIComponent(trackId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = await res.json();
      setPlaylists(
        Array.isArray(data.playlists)
          ? data.playlists.map(
              (p: {
                id: string;
                name: string;
                trackCount: number;
                contains?: boolean;
              }) => ({
                id: p.id,
                name: p.name,
                trackCount: Number(p.trackCount) || 0,
                contains: Boolean(p.contains),
              }),
            )
          : [],
      );
      setLiked(Boolean(data.liked));
    } finally {
      setLoading(false);
    }
  }, [trackId]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    void load();
  }, [open, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return playlists;
    return playlists.filter((p) => p.name.toLowerCase().includes(q));
  }, [playlists, query]);

  const saved = filtered.filter((p) => p.contains);
  const recent = filtered.filter((p) => !p.contains);

  const likedQueryOk =
    !query.trim() || "liked songs".includes(query.trim().toLowerCase());
  const showLikedInSaved = liked && likedQueryOk;
  const showLikedInRecent = !liked && likedQueryOk;

  async function togglePlaylist(p: PlaylistRow) {
    if (!libraryTrack) {
      if (onDownload) {
        onDownload();
        toastInfo("Saving to your library first…");
        setOpen(false);
      } else {
        toastError("Save this track to your library first");
      }
      return;
    }
    setBusyId(p.id);
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          p.contains
            ? { action: "remove", playlistId: p.id, trackId }
            : { playlistId: p.id, trackId },
        ),
      });
      if (!res.ok) {
        toastError(
          p.contains
            ? "Couldn’t remove from playlist"
            : "Couldn’t add to playlist",
        );
        return;
      }
      setPlaylists((prev) =>
        prev.map((row) =>
          row.id === p.id
            ? {
                ...row,
                contains: !p.contains,
                trackCount: Math.max(
                  0,
                  row.trackCount + (p.contains ? -1 : 1),
                ),
              }
            : row,
        ),
      );
      toastSuccess(p.contains ? `Removed from ${p.name}` : `Added to ${p.name}`);
      emitLibraryChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function toggleLiked() {
    setBusyId("liked");
    const next = !liked;
    setLiked(next);
    try {
      const res = await fetch("/api/likes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackId,
          liked: next,
          artist,
          title,
          album,
          coverPath,
          duration,
        }),
      });
      const data = await res.json().catch(() => null);
      const persisted = Boolean(data?.liked);
      if (!res.ok) {
        setLiked(!next);
        toastError("Couldn’t update Liked Songs");
        return;
      }
      setLiked(persisted);
      emitLikesChanged({
        liked: persisted,
        count: typeof data?.count === "number" ? data.count : undefined,
      });
    } catch {
      setLiked(!next);
      toastError("Couldn’t update Liked Songs");
    } finally {
      setBusyId(null);
    }
  }

  async function createPlaylist() {
    if (!libraryTrack) {
      if (onDownload) {
        onDownload();
        toastInfo("Saving to your library first…");
        setOpen(false);
      } else {
        toastError("Save this track to your library first");
      }
      return;
    }
    setOpen(false);
    setNamePromptOpen(true);
  }

  async function submitNewPlaylist(name: string) {
    setBusyId("new");
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, trackId }),
      });
      if (!res.ok) {
        toastError("Couldn’t create playlist");
        return;
      }
      setNamePromptOpen(false);
      toastSuccess(`Added to ${name}`);
      emitLibraryChanged();
      void load();
    } finally {
      setBusyId(null);
    }
  }

  function toggleLibrary() {
    if (inLibrary) return;
    if (!onDownload) {
      toastError("Can’t save this track to the library");
      return;
    }
    onDownload();
    setOpen(false);
  }

  const libraryQueryOk =
    !query.trim() || "your library".includes(query.trim().toLowerCase());
  const showLibraryRow =
    !onPolarr && Boolean(onDownload || inLibrary) && libraryQueryOk;

  return (
    <>
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        className="flex w-[20.5rem] flex-col gap-0 overflow-hidden rounded-lg border-border bg-background p-0 text-foreground shadow-md"
        onCloseAutoFocus={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2 px-3 pt-3">
          <p className="text-xs font-medium text-muted-foreground">
            Add to playlist
          </p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a playlist"
              className="h-8 rounded-md border-0 bg-muted/60 pl-8 text-sm shadow-none focus-visible:ring-1"
              autoComplete="off"
              onKeyDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <button
            type="button"
            disabled={busyId === "new"}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void createPlaylist();
            }}
            className="flex w-full items-center gap-3 rounded-md px-1 py-1.5 text-left text-sm font-medium transition-colors hover:bg-muted/60"
          >
            <Plus className="size-4 shrink-0" />
            New playlist
          </button>
        </div>

        <DropdownMenuSeparator className="my-2" />

        <div className="max-h-64 min-h-0 overflow-y-auto px-1 pb-1">
          {loading && playlists.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              Loading…
            </p>
          ) : (
            <>
              {showLibraryRow ? (
                <section className="mb-2">
                  {!inLibrary ? (
                    <p className="px-2 pb-1 text-xs text-muted-foreground">
                      Add to
                    </p>
                  ) : null}
                  <ul>
                    <li>
                      <PlaylistRowButton
                        name="Your Library"
                        meta={inLibrary ? "In library" : "Download & keep"}
                        saved={Boolean(inLibrary)}
                        disabled={busyId === "library"}
                        onClick={() => toggleLibrary()}
                        leading={
                          <span className="flex size-8 items-center justify-center rounded bg-muted">
                            <HardDrive className="size-3.5 text-muted-foreground" />
                          </span>
                        }
                      />
                    </li>
                  </ul>
                </section>
              ) : null}

              {(saved.length > 0 || showLikedInSaved) && (
                <section className="mb-2">
                  <p className="px-2 pb-1 text-xs text-muted-foreground">
                    Saved in
                  </p>
                  <ul>
                    {showLikedInSaved ? (
                      <li>
                        <PlaylistRowButton
                          name="Liked Songs"
                          meta="Liked Songs"
                          saved
                          disabled={busyId === "liked"}
                          onClick={() => void toggleLiked()}
                          leading={
                            <LikedSongsCover
                              className="size-8 shrink-0 rounded"
                              heartClassName="size-3.5"
                            />
                          }
                        />
                      </li>
                    ) : null}
                    {saved.map((p) => (
                      <li key={p.id}>
                        <PlaylistRowButton
                          name={p.name}
                          meta={`${p.trackCount} song${p.trackCount === 1 ? "" : "s"}`}
                          saved
                          disabled={busyId === p.id}
                          onClick={() => void togglePlaylist(p)}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {(recent.length > 0 || showLikedInRecent) && (
                <section>
                  <p className="px-2 pb-1 text-xs text-muted-foreground">
                    Recently updated
                  </p>
                  <ul>
                    {showLikedInRecent ? (
                      <li>
                        <PlaylistRowButton
                          name="Liked Songs"
                          meta="Liked Songs"
                          saved={false}
                          disabled={busyId === "liked"}
                          onClick={() => void toggleLiked()}
                          leading={
                            <LikedSongsCover
                              className="size-8 shrink-0 rounded"
                              heartClassName="size-3.5"
                            />
                          }
                        />
                      </li>
                    ) : null}
                    {recent.map((p) => (
                      <li key={p.id}>
                        <PlaylistRowButton
                          name={p.name}
                          meta={`${p.trackCount} song${p.trackCount === 1 ? "" : "s"}`}
                          saved={false}
                          disabled={busyId === p.id}
                          onClick={() => void togglePlaylist(p)}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {!loading &&
              filtered.length === 0 &&
              !showLikedInSaved &&
              !showLikedInRecent &&
              !showLibraryRow ? (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                  {query.trim()
                    ? "No playlists match."
                    : "No playlists yet — create one above."}
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm font-semibold transition-colors hover:bg-muted/60"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }}
          >
            Cancel
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
    <PromptDialog
      open={namePromptOpen}
      onOpenChange={setNamePromptOpen}
      title="Playlist name"
      defaultValue="My Playlist"
      placeholder="My Playlist"
      confirmLabel="Create"
      busy={busyId === "new"}
      onSubmit={(name) => void submitNewPlaylist(name)}
    />
    </>
  );
}

function PlaylistRowButton({
  name,
  meta,
  saved,
  disabled,
  onClick,
  leading,
}: {
  name: string;
  meta: string;
  saved: boolean;
  disabled?: boolean;
  onClick: () => void;
  leading?: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-50",
        saved && "bg-muted/40",
      )}
    >
      {leading ?? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded bg-muted text-[11px] font-semibold text-muted-foreground">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-tight">
          {name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {meta}
        </span>
      </span>
      <MembershipMark saved={saved} />
    </button>
  );
}
