"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, CirclePlus, Plus, Search } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { PromptDialog } from "@/components/confirm-dialog";
import { Input } from "@/components/ui/input";
import { LikedSongsCover } from "@/components/liked-songs-cover";
import { emitLikesChanged, emitLibraryChanged } from "@/lib/ui-events";
import { cn } from "@/lib/utils";
import { toastError, toastHeart, toastInfo, toastSuccess } from "@/lib/toast";

type PlaylistRow = {
  id: string;
  name: string;
  trackCount: number;
  contains: boolean;
};

function MembershipMark({ saved }: { saved: boolean }) {
  if (saved) {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    );
  }
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-muted-foreground/70 text-muted-foreground">
      <Plus className="size-3.5" strokeWidth={2} />
    </span>
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
      className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
    >
      {leading ?? (
        <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold text-muted-foreground">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold leading-tight text-foreground">
          {name}
        </span>
        <span className="block truncate text-[13px] text-muted-foreground">
          {meta}
        </span>
      </span>
      <MembershipMark saved={saved} />
    </button>
  );
}

export function useTrackSavedStatus(
  trackId: string | undefined,
  opts?: { onPolarr?: boolean; alreadyInLibrary?: boolean },
) {
  const [liked, setLiked] = useState(false);
  const [inPlaylist, setInPlaylist] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!trackId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/playlists?forTrack=${encodeURIComponent(trackId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = await res.json();
      setLiked(Boolean(data.liked));
      const rows = Array.isArray(data.playlists) ? data.playlists : [];
      setInPlaylist(rows.some((p: { contains?: boolean }) => p.contains));
    } finally {
      setLoading(false);
    }
  }, [trackId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saved =
    Boolean(opts?.alreadyInLibrary) ||
    Boolean(opts?.onPolarr) ||
    liked ||
    inPlaylist;

  return { saved, liked, inPlaylist, loading, refresh };
}

export function MobileSaveButton({
  trackId,
  artist,
  title,
  album,
  coverPath,
  duration,
  onPolarr,
  alreadyInLibrary,
  onDownload,
  onSavedChange,
}: {
  trackId: string;
  artist: string;
  title: string;
  album?: string;
  coverPath?: string | null;
  duration?: number;
  onPolarr?: boolean;
  alreadyInLibrary?: boolean;
  onDownload?: () => void;
  onSavedChange?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [optimisticLiked, setOptimisticLiked] = useState(false);
  const { saved, liked, refresh } = useTrackSavedStatus(trackId, {
    onPolarr,
    alreadyInLibrary,
  });

  useEffect(() => {
    setOptimisticLiked(false);
  }, [trackId]);

  const showCheck = saved || liked || optimisticLiked;

  async function ensureLiked() {
    if (liked || optimisticLiked) return true;
    setOptimisticLiked(true);
    setBusy(true);
    try {
      const res = await fetch("/api/likes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackId,
          liked: true,
          artist,
          title,
          album,
          coverPath,
          duration,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setOptimisticLiked(false);
        toastError("Couldn’t update Liked Songs");
        return false;
      }
      emitLikesChanged({
        liked: true,
        count: typeof data?.count === "number" ? data.count : undefined,
      });
      toastHeart("Saved to Liked Songs");
      await refresh();
      onSavedChange?.();
      return true;
    } catch {
      setOptimisticLiked(false);
      toastError("Couldn’t update Liked Songs");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={showCheck ? "Saved — manage playlists" : "Add to Liked Songs"}
        disabled={busy}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void (async () => {
            if (!liked && !optimisticLiked) await ensureLiked();
            setOpen(true);
          })();
        }}
        className="flex size-9 shrink-0 items-center justify-center disabled:opacity-50"
      >
        {showCheck ? (
          <span className="flex size-6 items-center justify-center rounded-full bg-foreground text-background">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        ) : (
          <CirclePlus
            className="size-6 text-muted-foreground"
            strokeWidth={1.5}
          />
        )}
      </button>
      <SavedInDrawer
        open={open}
        onOpenChange={setOpen}
        trackId={trackId}
        artist={artist}
        title={title}
        album={album}
        coverPath={coverPath}
        duration={duration}
        inLibrary={Boolean(alreadyInLibrary || onPolarr)}
        onPolarr={Boolean(onPolarr)}
        onDownload={onDownload}
        onChanged={() => {
          void refresh();
          onSavedChange?.();
        }}
      />
    </>
  );
}

export function SavedInDrawer({
  open,
  onOpenChange,
  trackId,
  artist,
  title,
  album,
  coverPath,
  duration,
  inLibrary,
  onPolarr,
  onDownload,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trackId: string;
  artist: string;
  title: string;
  album?: string;
  coverPath?: string | null;
  duration?: number;
  inLibrary?: boolean;
  onPolarr?: boolean;
  onDownload?: () => void;
  onChanged?: () => void;
}) {
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [liked, setLiked] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [namePromptOpen, setNamePromptOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

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
      setExpanded(false);
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
        onOpenChange(false);
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
      onChanged?.();
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
      toastHeart(
        persisted ? "Saved to Liked Songs" : "Removed from Liked Songs",
      );
      onChanged?.();
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
        onOpenChange(false);
      } else {
        toastError("Save this track to your library first");
      }
      return;
    }
    onOpenChange(false);
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
      onChanged?.();
      void load();
    } finally {
      setBusyId(null);
    }
  }

  const compact = !expanded;
  const visibleSaved = compact ? saved.slice(0, 3) : saved;
  const visibleRecent = compact ? recent.slice(0, Math.max(0, 4 - visibleSaved.length)) : recent;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogPortal>
          <DialogOverlay className="z-[60] bg-black/55" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className={cn(
              "fixed inset-x-0 bottom-0 z-[60] flex max-h-[min(88vh,720px)] flex-col rounded-t-2xl border-t border-border bg-background text-foreground shadow-2xl outline-none",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
              "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
              "duration-300",
              expanded && "max-h-[92vh]",
            )}
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <div
              className="mx-auto mb-2 mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/35"
              aria-hidden
            />

            <div className="flex items-center justify-between px-4 pb-2">
              <button
                type="button"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </button>
              {expanded ? (
                <button
                  type="button"
                  className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => onOpenChange(false)}
                >
                  Done
                </button>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 px-4 pb-3">
              <h2 className="text-2xl font-bold tracking-tight">Saved in</h2>
              <button
                type="button"
                disabled={busyId === "new"}
                onClick={() => void createPlaylist()}
                className="text-sm font-semibold text-foreground transition-opacity hover:opacity-80 disabled:opacity-50"
              >
                New playlist
              </button>
            </div>

            {expanded ? (
              <div className="space-y-2 px-4 pb-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find playlist"
                    className="h-11 rounded-lg border-border bg-muted/60 pl-10 text-sm shadow-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-foreground/20"
                    autoComplete="off"
                  />
                </div>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {loading && playlists.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  Loading…
                </p>
              ) : (
                <>
                  {showLikedInSaved ? (
                    <PlaylistRowButton
                      name="Liked Songs"
                      meta="Playlist · You"
                      saved
                      disabled={busyId === "liked"}
                      onClick={() => void toggleLiked()}
                      leading={
                        <LikedSongsCover className="size-12 shrink-0 rounded-md" heartClassName="size-4" />
                      }
                    />
                  ) : null}

                  {visibleSaved.map((p) => (
                    <PlaylistRowButton
                      key={p.id}
                      name={p.name}
                      meta={`Playlist · ${p.trackCount} song${p.trackCount === 1 ? "" : "s"}`}
                      saved
                      disabled={busyId === p.id}
                      onClick={() => void togglePlaylist(p)}
                    />
                  ))}

                  {showLikedInRecent ? (
                    <PlaylistRowButton
                      name="Liked Songs"
                      meta="Playlist · You"
                      saved={false}
                      disabled={busyId === "liked"}
                      onClick={() => void toggleLiked()}
                      leading={
                        <LikedSongsCover className="size-12 shrink-0 rounded-md" heartClassName="size-4" />
                      }
                    />
                  ) : null}

                  {visibleRecent.map((p) => (
                    <PlaylistRowButton
                      key={p.id}
                      name={p.name}
                      meta={`Playlist · ${p.trackCount} song${p.trackCount === 1 ? "" : "s"}`}
                      saved={false}
                      disabled={busyId === p.id}
                      onClick={() => void togglePlaylist(p)}
                    />
                  ))}

                  {!loading &&
                  filtered.length === 0 &&
                  !showLikedInSaved &&
                  !showLikedInRecent ? (
                    <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                      {query.trim()
                        ? "No playlists match."
                        : "No playlists yet — create one above."}
                    </p>
                  ) : null}
                </>
              )}
            </div>

            {!expanded ? (
              <div className="border-t border-border px-4 py-3 pb-[max(0.75rem,var(--safe-bottom))]">
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="flex w-full items-center justify-center rounded-full border border-border bg-muted/40 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
                >
                  Find playlist
                </button>
              </div>
            ) : (
              <div className="border-t border-border px-4 py-3 pb-[max(0.75rem,var(--safe-bottom))]">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="flex w-full items-center justify-center rounded-full bg-foreground px-4 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-90"
                >
                  Done
                </button>
              </div>
            )}
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>

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
