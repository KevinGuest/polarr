"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownUp,
  Camera,
  ChevronLeft,
  Clock,
  Ellipsis,
  ListFilter,
  Music2,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Shuffle,
} from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CoverArt } from "@/components/cover-art";
import { MobileSaveButton } from "@/components/saved-in-drawer";
import { NowPlayingBars } from "@/components/now-playing-bars";
import { PlaylistActionsDrawer } from "@/components/playlist-actions-drawer";
import { PlaylistEditDrawer } from "@/components/playlist-edit-drawer";
import { PlaylistNameDetailsDrawer } from "@/components/playlist-name-details-drawer";
import { PolarrAvailabilityBadge } from "@/components/stream-quality-badge";
import { ExplicitBadge } from "@/components/explicit-badge";
import { TrackActionsDrawer } from "@/components/track-actions-drawer";
import { TrackContextMenu } from "@/components/track-context-menu";
import { TrackRowActions } from "@/components/track-row-actions";
import { TrackRowIndex } from "@/components/track-row-index";
import { UserAvatar } from "@/components/user-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePlayer, type PlayerTrack } from "@/components/player-provider";
import { albumHref } from "@/lib/album-ref";
import { setDragTrack } from "@/lib/drag-track";
import {
  isPlayerRowCurrent,
  trackRowEndCell,
  trackRowMidCell,
  trackRowStartCell,
} from "@/lib/player-row";
import { emitLibraryChanged, LIBRARY_CHANGED_EVENT } from "@/lib/ui-events";
import {
  cn,
  formatAlbumLength,
  formatDuration,
  titleLooksExplicit,
} from "@/lib/utils";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  PlaylistOfflineDownloadButton,
  TrackOfflineIndicator,
} from "@/components/playlist-offline-download";
import type { DesktopOfflineTrack } from "@/lib/desktop-offline";
import { useAuthOptional } from "@/components/auth-provider";

type PlaylistMeta = {
  id: string;
  name: string;
  description?: string;
  ownerUsername: string;
  ownerAvatarUrl?: string | null;
  trackCount: number;
  coverUrl: string | null;
  isPrivate?: boolean;
};

type PlaylistTrack = {
  id: string;
  localTrackId?: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverPath: string | null;
  path: string;
  source: string;
  explicit?: boolean;
  addedAt?: string;
};

type AddCandidate = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverPath: string | null;
};

type RecommendHit = AddCandidate & {
  score?: number;
  reason?: string;
};

type SortMode = "custom" | "title" | "artist" | "album" | "recent";

const SORT_LABELS: Record<SortMode, string> = {
  custom: "Custom order",
  title: "Title",
  artist: "Artist",
  album: "Album",
  recent: "Date added",
};

function shuffleCopy<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

function formatDateAdded(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const day = 86_400_000;
  if (diff < day && diff >= 0) return "Today";
  if (diff < 2 * day && diff >= 0) return "Yesterday";
  if (diff < 7 * day && diff >= 0) {
    const n = Math.floor(diff / day);
    return `${n} day${n === 1 ? "" : "s"} ago`;
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function playlistTrackOnPolarr(t: {
  path?: string | null;
  source?: string | null;
}): boolean {
  const p = (t.path || "").trim();
  if (!p) return false;
  if (t.source === "stream") return false;
  if (
    p.startsWith("stream:") ||
    p.startsWith("stream://") ||
    p.startsWith("live://")
  ) {
    return false;
  }
  return true;
}

function toPlayerTrack(
  t: PlaylistTrack,
  _playlistName: string,
  playlistCover: string | null,
): PlayerTrack {
  const onPolarr = playlistTrackOnPolarr(t);
  const id = t.localTrackId || t.id;
  return {
    id,
    title: t.title,
    artist: t.artist,
    resolveArtist: t.artist,
    // Keep the real album for library match — never the playlist name.
    album: t.album || "",
    coverPath: t.coverPath || playlistCover,
    explicit: t.explicit ?? titleLooksExplicit(t.title),
    duration: t.duration || undefined,
    quality: onPolarr ? "local" : "youtube",
  };
}

function AddTracksDialog({
  open,
  onOpenChange,
  playlistId,
  existingIds,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlistId: string;
  existingIds: Set<string>;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AddCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setAddedIds(new Set());
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const term = query.trim();
    setLoading(true);
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          if (!term) {
            const res = await fetch("/api/library", { cache: "no-store" });
            const data = await res.json().catch(() => null);
            if (cancelled) return;
            const list = Array.isArray(data?.tracks) ? data.tracks : [];
            setHits(
              list.map((t: AddCandidate) => ({
                id: t.id,
                title: t.title,
                artist: t.artist,
                album: t.album || "",
                duration: t.duration || 0,
                coverPath: t.coverPath || null,
              })),
            );
            return;
          }
          const res = await fetch(
            `/api/search?q=${encodeURIComponent(term)}`,
            { cache: "no-store" },
          );
          const data = await res.json().catch(() => null);
          if (cancelled) return;
          const local = Array.isArray(data?.local) ? data.local : [];
          setHits(
            local.map((t: AddCandidate) => ({
              id: t.id,
              title: t.title,
              artist: t.artist,
              album: t.album || "",
              duration: t.duration || 0,
              coverPath: t.coverPath || null,
            })),
          );
        } catch {
          if (!cancelled) setHits([]);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, term ? 200 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, query]);

  const visible = useMemo(
    () => hits.filter((h) => !existingIds.has(h.id) && !addedIds.has(h.id)),
    [hits, existingIds, addedIds],
  );

  async function addTrack(hit: AddCandidate) {
    setAddingId(hit.id);
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId, trackId: hit.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toastError(data?.error || "Couldn’t add to playlist");
        return;
      }
      setAddedIds((prev) => new Set(prev).add(hit.id));
      onAdded();
      toastSuccess(`Added “${hit.title}”`);
    } catch {
      toastError("Couldn’t add to playlist");
    } finally {
      setAddingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-3 p-5 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add songs</DialogTitle>
          <DialogDescription>
            Search your library and add tracks to this playlist.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search songs"
            className="pl-9"
            aria-label="Search songs to add"
          />
        </div>
        <div className="max-h-[min(24rem,50vh)] overflow-y-auto pr-1">
          {loading ? (
            <div className="space-y-2 py-2" aria-busy="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-1 py-1.5">
                  <Skeleton className="size-10 shrink-0 rounded-sm" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/5" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            <p className="px-1 py-8 text-center text-sm text-muted-foreground">
              {query.trim()
                ? "No library matches. Try another search, or find it in Search first."
                : "Your library is empty — search the catalog to add songs."}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {visible.map((hit) => (
                <li key={hit.id}>
                  <div className="flex items-center gap-3 rounded-md px-1 py-1.5 hover:bg-muted/40">
                    <CoverArt
                      seed={`${hit.artist}-${hit.title}`}
                      image={hit.coverPath}
                      className="size-10 shrink-0 rounded-sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{hit.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {hit.artist}
                        {hit.album ? ` · ${hit.album}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void addTrack(hit)}
                      disabled={addingId === hit.id}
                      className="shrink-0 rounded-full border border-border px-3 py-1 text-xs font-semibold hover:border-foreground disabled:opacity-50"
                    >
                      {addingId === hit.id ? "Adding…" : "Add"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PlaylistClient({ playlistId }: { playlistId: string }) {
  const auth = useAuthOptional();
  const { play, toggle, track, queue: playerQueue, playing, shuffle, toggleShuffle } =
    usePlayer();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [playlist, setPlaylist] = useState<PlaylistMeta | null>(null);
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(true);
  const [coverBusy, setCoverBusy] = useState(false);
  const [localCover, setLocalCover] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("custom");
  const [showStickyTitle, setShowStickyTitle] = useState(false);
  const [recommended, setRecommended] = useState<RecommendHit[]>([]);
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [addingRecId, setAddingRecId] = useState<string | null>(null);
  const [recommendNonce, setRecommendNonce] = useState(0);
  const heroSentinelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/playlists?id=${encodeURIComponent(playlistId)}`,
        { credentials: "same-origin" },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.playlist) {
        setError(data?.error || "Failed to load playlist");
        setPlaylist(null);
        setTracks([]);
        setLoading(false);
        return;
      }
      setPlaylist(data.playlist);
      setTracks(Array.isArray(data.tracks) ? data.tracks : []);
      setCanEdit(data.canEdit !== false);
      setError(null);
      setLoading(false);
    } catch {
      setError("Failed to load playlist");
      setPlaylist(null);
      setTracks([]);
      setLoading(false);
    }
  }, [playlistId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    const onChanged = () => {
      void load();
    };
    window.addEventListener(LIBRARY_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, onChanged);
  }, [load]);

  useEffect(() => {
    return () => {
      if (localCover) URL.revokeObjectURL(localCover);
    };
  }, [localCover]);

  const totalSeconds = useMemo(
    () => tracks.reduce((s, t) => s + (t.duration || 0), 0),
    [tracks],
  );

  const existingIds = useMemo(
    () => new Set(tracks.map((t) => t.localTrackId || t.id)),
    [tracks],
  );

  const existingIdsKey = useMemo(
    () => [...existingIds].sort().join("|"),
    [existingIds],
  );

  const sortedTracks = useMemo(() => {
    if (sortMode === "custom") return tracks;
    const copy = [...tracks];
    const cmp = (a: string, b: string) =>
      a.localeCompare(b, undefined, { sensitivity: "base" });
    copy.sort((a, b) => {
      if (sortMode === "title") return cmp(a.title, b.title);
      if (sortMode === "artist") {
        const c = cmp(a.artist, b.artist);
        return c !== 0 ? c : cmp(a.title, b.title);
      }
      if (sortMode === "album") {
        const c = cmp(a.album || "", b.album || "");
        return c !== 0 ? c : cmp(a.title, b.title);
      }
      // recent
      return (b.addedAt || "").localeCompare(a.addedAt || "");
    });
    return copy;
  }, [tracks, sortMode]);

  useEffect(() => {
    const el = heroSentinelRef.current;
    if (!el || loading) return;
    const obs = new IntersectionObserver(
      ([entry]) => setShowStickyTitle(!entry?.isIntersecting),
      { threshold: 0, rootMargin: "-56px 0px 0px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading, playlist?.id, playlist?.name]);

  useEffect(() => {
    if (!playlistId || tracks.length === 0) {
      setRecommended([]);
      setRecommendLoading(false);
      return;
    }
    let cancelled = false;
    setRecommendLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/playlists/${encodeURIComponent(playlistId)}/recommend?limit=12`,
          { cache: "no-store", credentials: "same-origin" },
        );
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !Array.isArray(data?.tracks)) {
          setRecommended([]);
          return;
        }
        setRecommended(
          data.tracks.map((t: RecommendHit) => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            album: t.album || "",
            duration: t.duration || 0,
            coverPath: t.coverPath || null,
            score: t.score,
            reason: t.reason,
          })),
        );
      } catch {
        if (!cancelled) setRecommended([]);
      } finally {
        if (!cancelled) setRecommendLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playlistId, tracks.length, recommendNonce, existingIdsKey]);

  const queue: PlayerTrack[] = useMemo(
    () =>
      sortedTracks.map((t) =>
        toPlayerTrack(t, playlist?.name || "", playlist?.coverUrl || null),
      ),
    [sortedTracks, playlist],
  );

  const offlineTracks: DesktopOfflineTrack[] = useMemo(
    () =>
      tracks
        .filter((t) => playlistTrackOnPolarr(t))
        .map((t) => ({
          trackId: t.localTrackId || t.id,
          title: t.title,
          artist: t.artist,
          album: t.album,
          coverUrl: t.coverPath,
          duration: t.duration || null,
          userId: auth?.user?.publicId || "",
        })),
    [tracks, auth?.user?.publicId],
  );

  const inThisPlaylist = Boolean(
    track && tracks.some((t) => (t.localTrackId || t.id) === track.id),
  );

  function openDetails() {
    setDetailsOpen(true);
  }

  function playTrack(row: PlaylistTrack) {
    const pt = toPlayerTrack(
      row,
      playlist?.name || "",
      playlist?.coverUrl || null,
    );
    if (shuffle) {
      const rest = shuffleCopy(queue.filter((q) => q.id !== pt.id));
      play(pt, [pt, ...rest]);
      return;
    }
    play(pt, queue);
  }

  function playAll() {
    if (!queue[0]) return;
    if (shuffle) {
      const shuffled = shuffleCopy(queue);
      const first = shuffled[0];
      if (!first) return;
      play(first, shuffled);
      return;
    }
    play(queue[0], queue);
  }

  function onPlayClick() {
    if (inThisPlaylist) {
      toggle();
      return;
    }
    playAll();
  }

  async function onCoverFile(file: File | undefined) {
    if (!file) return;
    const preview = URL.createObjectURL(file);
    if (localCover) URL.revokeObjectURL(localCover);
    setLocalCover(preview);
    setCoverBusy(true);
    try {
      const form = new FormData();
      form.set("cover", file);
      const res = await fetch(
        `/api/playlists/${encodeURIComponent(playlistId)}/cover`,
        { method: "POST", body: form },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.playlist) {
        toastError(data?.error || "Couldn’t update cover");
        setLocalCover(null);
        URL.revokeObjectURL(preview);
        return;
      }
      setPlaylist((p) =>
        p
          ? {
              ...p,
              coverUrl: data.playlist.coverUrl || p.coverUrl,
            }
          : p,
      );
      emitLibraryChanged();
      toastSuccess("Cover updated");
    } catch {
      toastError("Couldn’t update cover");
      setLocalCover(null);
      URL.revokeObjectURL(preview);
    } finally {
      setCoverBusy(false);
    }
  }

  async function removeFromPlaylist(trackId: string) {
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove",
          playlistId,
          trackId,
        }),
      });
      if (!res.ok) {
        toastError("Couldn’t remove from playlist");
        return;
      }
      setTracks((prev) =>
        prev.filter((t) => (t.localTrackId || t.id) !== trackId),
      );
      setPlaylist((p) =>
        p ? { ...p, trackCount: Math.max(0, p.trackCount - 1) } : p,
      );
      emitLibraryChanged();
    } catch {
      toastError("Couldn’t remove from playlist");
    }
  }

  async function addRecommended(hit: RecommendHit) {
    setAddingRecId(hit.id);
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId, trackId: hit.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toastError(data?.error || "Couldn’t add to playlist");
        return;
      }
      setRecommended((prev) => prev.filter((t) => t.id !== hit.id));
      await load();
      toastSuccess(`Added “${hit.title}”`);
    } catch {
      toastError("Couldn’t add to playlist");
    } finally {
      setAddingRecId(null);
    }
  }

  async function deleteThisPlaylist() {
    if (!playlist) return;
    setDeleteBusy(true);
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          playlistId,
        }),
      });
      if (!res.ok) {
        toastError("Couldn’t delete playlist");
        return;
      }
      setDeleteOpen(false);
      emitLibraryChanged();
      toastSuccess("Playlist deleted");
      router.push("/");
    } catch {
      toastError("Couldn’t delete playlist");
    } finally {
      setDeleteBusy(false);
    }
  }

  if (loading && !playlist) {
    return (
      <div className="flex min-h-full flex-col">
        <section className="relative -mx-4 -mt-4 border-b border-border px-4 pb-10 pt-8 md:-mx-8 md:px-8 lg:-mx-10 lg:px-10">
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end">
            <Skeleton className="size-44 shrink-0 rounded-lg sm:size-52 md:size-56" />
            <div className="min-w-0 flex-1 space-y-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-12 w-2/3 max-w-md" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
        </section>
        <div className="flex items-center gap-4 px-1 py-6">
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="size-8 rounded-full" />
        </div>
      </div>
    );
  }

  if (error && !playlist) {
    return (
      <p className="text-sm text-muted-foreground">
        {error}{" "}
        <button
          type="button"
          className="underline"
          onClick={() => router.push("/")}
        >
          Go home
        </button>
      </p>
    );
  }

  const displayTitle = playlist?.name || "Playlist";
  const coverImage = localCover || playlist?.coverUrl || undefined;
  const empty = tracks.length === 0;
  const ownerName = playlist?.ownerUsername || "You";
  const playLabel = inThisPlaylist && playing ? "Pause" : "Play";
  const metaLine = [
    `${tracks.length} song${tracks.length === 1 ? "" : "s"}`,
    tracks.length > 0 ? formatAlbumLength(totalSeconds) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const pillClass =
    "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/30 px-3.5 py-2 text-sm font-medium text-foreground";

  function SortPill() {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={pillClass} aria-label="Sort playlist">
            <ArrowDownUp className="size-4" />
            Sort
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
            <DropdownMenuCheckboxItem
              key={mode}
              checked={sortMode === mode}
              onCheckedChange={() => setSortMode(mode)}
            >
              {SORT_LABELS[mode]}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function RecommendedSection() {
    if (tracks.length === 0) return null;
    return (
      <section className="mt-10 pb-8">
        <h2 className="px-4 text-2xl font-bold tracking-tight lg:px-0">
          Recommended songs
        </h2>
        <p className="mt-1 px-4 text-sm text-muted-foreground lg:px-0">
          Based on the songs in this playlist
        </p>
        {recommendLoading && recommended.length === 0 ? (
          <div className="mt-4 space-y-2 px-4 lg:px-0" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-md" />
            ))}
          </div>
        ) : recommended.length === 0 ? (
          <p className="mt-6 px-4 text-sm text-muted-foreground lg:px-0">
            No library matches yet — add more songs or grow your library.
          </p>
        ) : (
          <ul className="mt-4">
            {recommended.map((hit) => {
              const explicit = titleLooksExplicit(hit.title);
              const busy = addingRecId === hit.id;
              return (
                <li key={hit.id}>
                  <div className="flex w-full items-center gap-3 px-4 py-2.5 lg:px-0">
                    <CoverArt
                      seed={`${hit.artist}-${hit.title}`}
                      image={hit.coverPath}
                      className="size-12 shrink-0 rounded-md"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium">
                        {hit.title}
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                        {explicit ? <ExplicitBadge /> : null}
                        <span className="truncate">{hit.artist}</span>
                      </div>
                    </div>
                    {canEdit ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void addRecommended(hit)}
                        className="flex size-9 shrink-0 items-center justify-center rounded-full border border-foreground/70 text-foreground disabled:opacity-40"
                        aria-label={`Add ${hit.title}`}
                      >
                        <Plus className="size-5" />
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {recommended.length > 0 || recommendLoading ? (
          <div className="mt-6 flex justify-center px-4 lg:px-0">
            <button
              type="button"
              disabled={recommendLoading}
              onClick={() => setRecommendNonce((n) => n + 1)}
              className="rounded-full bg-foreground px-6 py-2.5 text-sm font-semibold text-background disabled:opacity-50"
            >
              {recommendLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void onCoverFile(file);
        }}
      />

      {/* Mobile — Spotify-style playlist */}
      <div className="lg:hidden">
        <div
          className={cn(
            "fixed inset-x-0 top-0 z-30 transition-colors duration-200",
            showStickyTitle
              ? "border-b border-border/40 bg-background/75 backdrop-blur-md"
              : "bg-transparent",
          )}
        >
          <div className="flex items-center gap-2 px-3 pb-2 pt-[max(0.5rem,var(--safe-top))]">
            <button
              type="button"
              onClick={() => router.back()}
              className={cn(
                "rounded-full p-1.5",
                showStickyTitle
                  ? "text-foreground"
                  : "bg-black/35 text-white backdrop-blur-sm",
              )}
              aria-label="Go back"
            >
              <ChevronLeft className="size-6" />
            </button>
            <h1
              className={cn(
                "min-w-0 flex-1 truncate text-center text-base font-semibold transition-opacity duration-200",
                showStickyTitle ? "opacity-100" : "opacity-0",
              )}
            >
              {displayTitle}
            </h1>
            <div className="size-9" aria-hidden />
          </div>
          {showStickyTitle ? (
          <div className="flex items-center gap-2 overflow-x-auto px-3 pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {canEdit ? (
              <>
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className={pillClass}
                >
                  <Plus className="size-4" />
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className={pillClass}
                >
                  <ListFilter className="size-4" />
                  Edit
                </button>
                <SortPill />
                <button
                  type="button"
                  onClick={() => openDetails()}
                  className={pillClass}
                >
                  <Pencil className="size-4" />
                  Name & details
                </button>
              </>
            ) : null}
            <div className="min-w-0 flex-1" />
            <button
              type="button"
              onClick={() => onPlayClick()}
              disabled={empty}
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-foreground text-background shadow-lg disabled:opacity-40"
              aria-label={playLabel}
            >
              {inThisPlaylist && playing ? (
                <Pause className="size-5" fill="currentColor" />
              ) : (
                <Play className="size-5 translate-x-0.5" fill="currentColor" />
              )}
            </button>
          </div>
          ) : null}
        </div>

        <div className="relative pb-1 pt-[max(3.25rem,calc(var(--safe-top)+2.75rem))]">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, hsl(20 22% 34%) 0%, hsl(20 16% 20%) 55%, hsl(var(--background)) 100%)",
            }}
            aria-hidden
          />
          <div className="relative mx-auto aspect-square w-[calc(100%-3rem)] max-w-[18rem] overflow-hidden rounded-md shadow-2xl">
            {coverImage ? (
              <CoverArt
                seed={playlist?.id || displayTitle}
                image={coverImage}
                className="size-full"
              />
            ) : (
              <div
                className="flex size-full items-center justify-center bg-[#282828] text-[#7f7f7f]"
                aria-hidden
              >
                <Music2 className="size-16" strokeWidth={1.25} />
              </div>
            )}
          </div>
          <div ref={heroSentinelRef} className="relative h-px" aria-hidden />

          <div className="relative space-y-2 px-4 pb-2 pt-4">
            <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight">
              {displayTitle}
            </h1>
            {playlist?.description ? (
              <p className="text-sm text-muted-foreground line-clamp-2">
                {playlist.description}
              </p>
            ) : null}
            <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <UserAvatar
                username={ownerName}
                avatarUrl={playlist?.ownerAvatarUrl}
                className="size-6 shrink-0 rounded-full"
                textClassName="text-[10px]"
              />
              <span className="truncate font-semibold text-foreground">
                {ownerName}
              </span>
            </div>
            {metaLine ? (
              <p className="text-sm text-muted-foreground">{metaLine}</p>
            ) : null}
          </div>

          <div className="relative flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => toggleShuffle()}
            className={cn(
              "rounded-full p-2",
              shuffle
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-label="Shuffle"
            aria-pressed={shuffle}
          >
            <Shuffle className="size-6" />
          </button>
          <PlaylistOfflineDownloadButton
            collectionId={`playlist:${playlistId}`}
            tracks={offlineTracks}
            iconClassName="size-6"
          />
          <PlaylistActionsDrawer
            playlistId={playlistId}
            title={displayTitle}
            subtitle={metaLine || undefined}
            coverUrl={coverImage}
            canEdit={canEdit}
            onAddSongs={() => setAddOpen(true)}
            onEditPlaylist={() => setEditOpen(true)}
            onEditDetails={() => openDetails()}
            onDelete={() => setDeleteOpen(true)}
          >
            <button
              type="button"
              className="rounded-full p-2 text-muted-foreground hover:text-foreground"
              aria-label="More options"
            >
              <Ellipsis className="size-6" />
            </button>
          </PlaylistActionsDrawer>
          <div className="min-w-0 flex-1" />
          <button
            type="button"
            onClick={() => onPlayClick()}
            disabled={empty}
            className="flex size-14 items-center justify-center rounded-full bg-foreground text-background shadow-lg disabled:opacity-40"
            aria-label={playLabel}
          >
            {inThisPlaylist && playing ? (
              <Pause className="size-6" fill="currentColor" />
            ) : (
              <Play className="size-6 translate-x-0.5" fill="currentColor" />
            )}
          </button>
        </div>
        </div>

        {canEdit ? (
          <div className="flex gap-2 overflow-x-auto px-4 pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className={pillClass}
            >
              <Plus className="size-4" />
              Add
            </button>
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className={pillClass}
            >
              <ListFilter className="size-4" />
              Edit
            </button>
            <SortPill />
            <button
              type="button"
              onClick={() => openDetails()}
              className={pillClass}
            >
              <Pencil className="size-4" />
              Name & details
            </button>
          </div>
        ) : null}

        <section className="pt-1">
          {empty ? (
            <div className="px-4 py-10">
              <h2 className="text-2xl font-bold tracking-tight">
                {canEdit
                  ? "Let's find something for your playlist"
                  : "This playlist is empty"}
              </h2>
              {canEdit ? (
                <>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Search your library and add songs.
                  </p>
                  <button
                    type="button"
                    onClick={() => setAddOpen(true)}
                    className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background"
                  >
                    Add songs
                  </button>
                </>
              ) : null}
            </div>
          ) : (
            <ul>
              {sortedTracks.map((t) => {
                const playerTrack = toPlayerTrack(
                  t,
                  playlist?.name || "",
                  playlist?.coverUrl || null,
                );
                const trackId = t.localTrackId || t.id;
                const isCurrent = isPlayerRowCurrent(
                  track,
                  {
                    id: playerTrack.id,
                    localTrackId: t.localTrackId,
                    streamId: t.id.startsWith("stream:") ? t.id : null,
                    title: t.title,
                    artist: t.artist,
                  },
                  playerQueue,
                );
                const explicit = t.explicit ?? titleLooksExplicit(t.title);
                return (
                  <li key={trackId}>
                    <div className="flex w-full items-center gap-3 px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => playTrack(t)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <CoverArt
                          seed={`${t.artist}-${t.title}`}
                          image={t.coverPath || playlist?.coverUrl}
                          className="size-12 shrink-0 rounded-md"
                        />
                        <div className="min-w-0 flex-1">
                          <div
                            className={cn(
                              "flex min-w-0 items-center gap-2",
                              isCurrent ? "text-primary" : "text-foreground",
                            )}
                          >
                            {isCurrent ? (
                              <NowPlayingBars playing={playing} />
                            ) : null}
                            <span className="truncate text-[15px] font-medium">
                              {t.title}
                            </span>
                            <TrackOfflineIndicator
                              trackId={trackId}
                              collectionId={`playlist:${playlistId}`}
                            />
                          </div>
                          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                            {explicit ? <ExplicitBadge /> : null}
                            <span className="min-w-0 truncate">{t.artist}</span>
                          </div>
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <PolarrAvailabilityBadge
                          available={playlistTrackOnPolarr(t)}
                        />
                        <MobileSaveButton
                          trackId={trackId}
                          artist={t.artist}
                          title={t.title}
                          album={t.album}
                          coverPath={t.coverPath}
                          duration={t.duration}
                          onPolarr={playlistTrackOnPolarr(t)}
                          alreadyInLibrary={playlistTrackOnPolarr(t)}
                          size="sm"
                        />
                      </div>
                      <TrackActionsDrawer
                        track={playerTrack}
                        onPolarr={playlistTrackOnPolarr(t)}
                        inLibrary={playlistTrackOnPolarr(t)}
                        playlistId={canEdit ? playlistId : undefined}
                        onRemovedFromPlaylist={
                          canEdit
                            ? () => void removeFromPlaylist(trackId)
                            : undefined
                        }
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <RecommendedSection />
      </div>

      {/* Desktop */}
      <div className="hidden min-h-full flex-col lg:flex">
      <section className="relative -mx-4 -mt-4 border-b border-border px-4 pb-10 pt-8 md:-mx-8 md:px-8 lg:-mx-10 lg:px-10">
        <div
          className="pointer-events-none absolute inset-0 opacity-35"
          style={{
            background:
              "linear-gradient(180deg, hsl(20 18% 22%) 0%, hsl(var(--background)) 100%)",
          }}
          aria-hidden
        />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end">
          {canEdit ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={coverBusy}
            aria-label="Change playlist cover"
            className="group relative size-44 shrink-0 overflow-hidden rounded-lg shadow-lg sm:size-52 md:size-56"
          >
            {coverImage ? (
              <CoverArt
                seed={playlist?.id || displayTitle}
                image={coverImage}
                className="size-full"
              />
            ) : (
              <div
                className="flex size-full items-center justify-center bg-[#282828] text-[#7f7f7f]"
                aria-hidden
              >
                <Music2 className="size-16 sm:size-20" strokeWidth={1.25} />
              </div>
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
              <Camera className="size-8 text-white" strokeWidth={1.5} />
              <span className="text-sm font-medium text-white">
                Choose photo
              </span>
            </div>
          </button>
          ) : (
            <div className="relative size-44 shrink-0 overflow-hidden rounded-lg shadow-lg sm:size-52 md:size-56">
              {coverImage ? (
                <CoverArt
                  seed={playlist?.id || displayTitle}
                  image={coverImage}
                  className="size-full"
                />
              ) : (
                <div
                  className="flex size-full items-center justify-center bg-[#282828] text-[#7f7f7f]"
                  aria-hidden
                >
                  <Music2 className="size-16 sm:size-20" strokeWidth={1.25} />
                </div>
              )}
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Playlist
            </p>
            <h1 className="max-w-full truncate text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
              {displayTitle}
            </h1>
            {playlist?.description ? (
              <p className="max-w-2xl text-sm text-muted-foreground line-clamp-3">
                {playlist.description}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted-foreground">
              <span className="inline-flex min-w-0 items-center gap-2">
                <UserAvatar
                  username={ownerName}
                  avatarUrl={playlist?.ownerAvatarUrl}
                  className="size-6 shrink-0 rounded-full"
                  textClassName="text-[10px]"
                />
                <span className="truncate font-semibold text-foreground">
                  {ownerName}
                </span>
              </span>
              <span>
                · {tracks.length} song{tracks.length === 1 ? "" : "s"}
                {tracks.length > 0 ? `, ${formatAlbumLength(totalSeconds)}` : ""}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => onPlayClick()}
            disabled={empty}
            className="flex size-14 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            aria-label={playLabel}
          >
            {inThisPlaylist && playing ? (
              <Pause className="size-6" fill="currentColor" />
            ) : (
              <Play className="size-6 translate-x-0.5" fill="currentColor" />
            )}
          </button>
          <button
            type="button"
            onClick={() => toggleShuffle()}
            className={cn(
              "flex size-10 items-center justify-center rounded-full transition-colors",
              shuffle
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-label="Shuffle"
            aria-pressed={shuffle}
          >
            <Shuffle className="size-5" />
          </button>
          <PlaylistOfflineDownloadButton
            collectionId={`playlist:${playlistId}`}
            tracks={offlineTracks}
          />
          <PlaylistActionsDrawer
            variant="menu"
            playlistId={playlistId}
            title={displayTitle}
            subtitle={metaLine || undefined}
            coverUrl={coverImage}
            canEdit={canEdit}
            onAddSongs={() => setAddOpen(true)}
            onEditPlaylist={() => setEditOpen(true)}
            onEditDetails={() => openDetails()}
            onDelete={() => setDeleteOpen(true)}
          >
            <button
              type="button"
              className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
              aria-label="More options"
            >
              <Ellipsis className="size-6" />
            </button>
          </PlaylistActionsDrawer>
        </div>

        {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
          >
            <Plus className="size-4" />
            Add
          </button>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
          >
            <ListFilter className="size-4" />
            Edit
          </button>
          <SortPill />
          <button
            type="button"
            onClick={() => openDetails()}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
          >
            <Pencil className="size-4" />
            Name & details
          </button>
        </div>
        ) : null}
      </section>

      <section className="pt-4">
        {empty ? (
          <div className="px-1 py-12">
            <h2 className="text-2xl font-bold tracking-tight">
              {canEdit
                ? "Let's find something for your playlist"
                : "This playlist is empty"}
            </h2>
            {canEdit ? (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  Search your library and add songs, or right-click a track anywhere
                  in Polarr.
                </p>
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background hover:opacity-90"
                >
                  Add songs
                </button>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                Nothing here yet.
              </p>
            )}
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-y-1 text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="w-10 pb-3 pl-3 font-medium">#</th>
                  <th className="pb-3 pr-4 font-medium">Title</th>
                  <th className="hidden pb-3 pr-4 font-medium sm:table-cell">
                    Album
                  </th>
                  <th className="hidden pb-3 pr-4 font-medium lg:table-cell">
                    Date added
                  </th>
                  <th className="w-[5.5rem] pb-3 font-medium" aria-label="Actions" />
                  <th className="w-16 pb-3 pr-3 text-right font-medium">
                    <Clock className="ml-auto size-3.5" aria-label="Duration" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedTracks.map((t, i) => {
                  const playerTrack = toPlayerTrack(
                    t,
                    playlist?.name || "",
                    playlist?.coverUrl || null,
                  );
                  const trackId = t.localTrackId || t.id;
                  const isCurrent = isPlayerRowCurrent(
                    track,
                    {
                      id: playerTrack.id,
                      localTrackId: t.localTrackId,
                      streamId: t.id.startsWith("stream:") ? t.id : null,
                      title: t.title,
                      artist: t.artist,
                    },
                    playerQueue,
                  );
                  const explicit =
                    t.explicit ?? titleLooksExplicit(t.title);
                  const albumPath =
                    t.album && t.artist
                      ? albumHref({ title: t.album, artist: t.artist })
                      : null;
                  const row = (
                    <tr
                      draggable
                      onDragStart={(e) => setDragTrack(e, playerTrack)}
                      className="group/row cursor-grab transition-colors active:cursor-grabbing"
                      onClick={() => playTrack(t)}
                    >
                      <td
                        className={trackRowStartCell(
                          isCurrent,
                          "py-2.5 pl-3 tabular-nums text-muted-foreground",
                        )}
                      >
                        <TrackRowIndex n={i + 1} isCurrent={isCurrent} playing={playing} />
                      </td>
                      <td className={trackRowMidCell(isCurrent, "py-2.5 pr-4")}>
                        <div className="flex min-w-0 items-center gap-3">
                          <CoverArt
                            seed={`${t.artist}-${t.title}`}
                            image={t.coverPath || playlist?.coverUrl}
                            className="size-10 shrink-0 rounded-sm"
                          />
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="truncate font-medium text-foreground">
                                {t.title}
                              </div>
                              <TrackOfflineIndicator
                                trackId={trackId}
                                collectionId={`playlist:${playlistId}`}
                              />
                            </div>
                            <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                              {explicit ? <ExplicitBadge /> : null}
                              <span className="min-w-0 truncate">{t.artist}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td
                        className={trackRowMidCell(
                          isCurrent,
                          "hidden max-w-[14rem] py-2.5 pr-4 sm:table-cell",
                        )}
                      >
                        {albumPath && t.album ? (
                          <Link
                            href={albumPath}
                            onClick={(e) => e.stopPropagation()}
                            className="block truncate text-muted-foreground hover:underline"
                          >
                            {t.album}
                          </Link>
                        ) : (
                          <span className="block truncate text-muted-foreground">
                            {t.album || "—"}
                          </span>
                        )}
                      </td>
                      <td
                        className={trackRowMidCell(
                          isCurrent,
                          "hidden py-2.5 pr-4 tabular-nums text-muted-foreground lg:table-cell",
                        )}
                      >
                        {formatDateAdded(t.addedAt)}
                      </td>
                      <td
                        className={trackRowMidCell(isCurrent, "py-2.5")}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <TrackRowActions
                          trackId={trackId}
                          artist={t.artist}
                          title={t.title}
                          album={t.album}
                          coverPath={t.coverPath}
                          duration={t.duration}
                          onPolarr={playlistTrackOnPolarr(t)}
                        />
                      </td>
                      <td
                        className={trackRowEndCell(
                          isCurrent,
                          "py-2.5 pr-3 text-right tabular-nums text-muted-foreground",
                        )}
                      >
                        {t.duration ? formatDuration(t.duration) : "—"}
                      </td>
                    </tr>
                  );

                  return (
                    <TrackContextMenu
                      key={trackId}
                      track={playerTrack}
                      inLibrary={playlistTrackOnPolarr(t)}
                      playlistId={canEdit ? playlistId : undefined}
                      onRemovedFromPlaylist={
                        canEdit
                          ? () => void removeFromPlaylist(trackId)
                          : undefined
                      }
                    >
                      {row}
                    </TrackContextMenu>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <RecommendedSection />
      </div>

      <AddTracksDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        playlistId={playlistId}
        existingIds={existingIds}
        onAdded={() => void load()}
      />
      <PlaylistEditDrawer
        open={editOpen}
        onOpenChange={setEditOpen}
        playlistId={playlistId}
        tracks={tracks.map((t) => ({
          id: t.localTrackId || t.id,
          title: t.title,
          artist: t.artist,
          coverPath: t.coverPath,
        }))}
        onSaved={(next) => {
          setTracks((prev) => {
            const byId = new Map(
              prev.map((t) => [t.localTrackId || t.id, t] as const),
            );
            return next
              .map((n) => byId.get(n.id))
              .filter((t): t is PlaylistTrack => Boolean(t));
          });
          setPlaylist((p) =>
            p ? { ...p, trackCount: next.length } : p,
          );
          setSortMode("custom");
        }}
      />
      {playlist ? (
        <PlaylistNameDetailsDrawer
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          playlist={playlist}
          coverImage={coverImage}
          coverBusy={coverBusy}
          onPickCover={() => fileRef.current?.click()}
          onSaved={({ name, description, isPrivate }) => {
            setPlaylist((p) =>
              p ? { ...p, name, description, isPrivate } : p,
            );
          }}
          onDelete={() => setDeleteOpen(true)}
        />
      ) : null}
      {playlist ? (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Delete playlist?"
          description={`“${playlist.name}” will be removed from Your Library. Songs on disk are not deleted.`}
          confirmLabel="Delete playlist"
          destructive
          busy={deleteBusy}
          onConfirm={() => void deleteThisPlaylist()}
        />
      ) : null}
    </>
  );
}
