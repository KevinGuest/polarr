"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CoverArt } from "@/components/cover-art";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDuration, cn } from "@/lib/utils";
import { emitLibraryChanged } from "@/lib/ui-events";
import { toastError, toastSuccess } from "@/lib/toast";
import { roleIsAdmin } from "@/lib/roles";

type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration?: number;
  source?: string;
  sourceLabel?: string;
  sourceKind?: "lidarr" | "polarr";
  path?: string;
  coverPath?: string | null;
  addedAt?: string;
  available?: boolean;
};

type AlbumRow = {
  artist: string;
  title: string;
  trackCount: number;
  presentCount: number;
  complete: boolean;
  coverPath: string | null;
  addedAt?: string;
};

type Mode = "tracks" | "albums";

const PAGE_SIZE = 10;

const COPY: Record<
  Mode,
  { title: string; blurb: string; empty: string }
> = {
  tracks: {
    title: "Tracks",
    blurb:
      "Every indexed track. Available means the audio file is on disk after scan.",
    empty: "No tracks yet. Run Scan library under Requests.",
  },
  albums: {
    title: "Albums",
    blurb: "Albums from the library. Open one to see which tracks are present.",
    empty: "No albums yet. Run Scan library under Requests.",
  },
};

function SourceBadge({ track }: { track: Track }) {
  if (!track.source || track.source === "stream") return null;
  const lidarr = track.sourceKind === "lidarr";
  return (
    <Badge
      variant="outline"
      className={
        lidarr
          ? "border-sky-500/30 text-sky-700 dark:text-sky-400"
          : "border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
      }
    >
      {track.sourceLabel || (lidarr ? "Lidarr" : "Polarr")}
    </Badge>
  );
}

function AvailableBadge({ available }: { available: boolean }) {
  return available ? (
    <Badge
      variant="outline"
      className="gap-1 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
    >
      <Check className="size-3" />
      Available
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className="gap-1 border-destructive/30 text-destructive"
    >
      <X className="size-3" />
      Missing
    </Badge>
  );
}

function Pagination({
  page,
  pageCount,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (p: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
      <p className="text-xs text-muted-foreground">
        Page {page} of {pageCount} · {total} total
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export function AdminMediaClient({ mode }: { mode: Mode }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<AlbumRow[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: "track"; track: Track }
    | { kind: "album"; artist: string; title: string }
    | null
  >(null);
  const [canDeleteFiles, setCanDeleteFiles] = useState(false);
  const [albumOpen, setAlbumOpen] = useState<AlbumRow | null>(null);
  const [albumTracks, setAlbumTracks] = useState<Track[]>([]);
  const [albumLoading, setAlbumLoading] = useState(false);

  const load = useCallback(
    async (nextPage = page) => {
      setLoading(true);
      const gate = await fetch("/api/admin/stats");
      if (gate.status === 403 || gate.status === 401) {
        setForbidden(true);
        setLoading(false);
        return;
      }
      setForbidden(false);
      const qs = new URLSearchParams({
        mode,
        page: String(nextPage),
        limit: String(PAGE_SIZE),
      });
      const res = await fetch(`/api/admin/media?${qs}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toastError(data?.error || "Failed to load media");
        setLoading(false);
        return;
      }
      if (mode === "tracks") {
        setTracks(Array.isArray(data.tracks) ? data.tracks : []);
      } else {
        setAlbums(Array.isArray(data.albums) ? data.albums : []);
      }
      setPage(Number(data.page) || nextPage);
      setPageCount(Number(data.pageCount) || 1);
      setTotal(Number(data.total) || 0);
      setLoading(false);
    },
    [mode, page],
  );

  useEffect(() => {
    setPage(1);
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when mode changes
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) {
          setCanDeleteFiles(roleIsAdmin(data.user?.role));
        }
      } catch {
        if (!cancelled) setCanDeleteFiles(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function openAlbum(a: AlbumRow) {
    setAlbumOpen(a);
    setAlbumLoading(true);
    setAlbumTracks([]);
    const qs = new URLSearchParams({
      mode: "album",
      artist: a.artist,
      album: a.title,
    });
    const res = await fetch(`/api/admin/media?${qs}`, { cache: "no-store" });
    const data = await res.json().catch(() => null);
    setAlbumLoading(false);
    if (!res.ok) {
      toastError(data?.error || "Couldn’t load album");
      return;
    }
    setAlbumTracks(Array.isArray(data.tracks) ? data.tracks : []);
    if (data.album) {
      setAlbumOpen({
        ...a,
        trackCount: data.album.trackCount,
        presentCount: data.album.presentCount,
        complete: data.album.complete,
        coverPath: data.album.coverPath || a.coverPath,
      });
    }
  }

  async function removeTrack(t: Track) {
    if (!canDeleteFiles) return;
    setBusyKey(t.id);
    const res = await fetch(`/api/tracks/${encodeURIComponent(t.id)}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => null);
    setBusyKey(null);
    if (!res.ok) {
      toastError(data?.error || "Delete failed");
      return;
    }
    setPendingDelete(null);
    setAlbumTracks((prev) => prev.filter((x) => x.id !== t.id));
    toastSuccess(`Deleted “${t.title}” from disk`);
    emitLibraryChanged({ trackId: t.id });
    void load(page);
  }

  async function removeAlbum(artist: string, title: string) {
    if (!canDeleteFiles) return;
    const key = `${artist}::${title}`;
    setBusyKey(key);
    const qs = new URLSearchParams({ artist, album: title });
    const res = await fetch(`/api/library/album?${qs.toString()}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => null);
    setBusyKey(null);
    if (!res.ok) {
      toastError(data?.error || "Delete failed");
      return;
    }
    setPendingDelete(null);
    setAlbumOpen(null);
    toastSuccess(`Deleted ${data?.removed ?? 0} file(s) from “${title}”`);
    void load(page);
  }

  const copy = COPY[mode];

  if (forbidden) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="text-sm text-muted-foreground">
          Admin only. Sign in with an admin account.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.blurb}</p>
        <p className="text-xs text-muted-foreground">
          Scan from{" "}
          <Link href="/admin/requests" className="underline underline-offset-2">
            Requests
          </Link>{" "}
          to index new files.
        </p>
      </div>

      {mode === "tracks" ? (
        loading && tracks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : tracks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.empty}</p>
        ) : (
          <ul className="space-y-2">
            {tracks.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5"
              >
                <CoverArt
                  seed={`${t.artist}-${t.title}`}
                  image={t.coverPath}
                  className="size-10 shrink-0 rounded-sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.artist}
                    {t.album ? ` · ${t.album}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  <AvailableBadge available={Boolean(t.available)} />
                  <SourceBadge track={t} />
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {formatDuration(t.duration || 0)}
                  </span>
                  {canDeleteFiles ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      disabled={busyKey === t.id}
                      onClick={() =>
                        setPendingDelete({ kind: "track", track: t })
                      }
                      aria-label={`Delete ${t.title}`}
                    >
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : loading && albums.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : albums.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {albums.map((a) => (
            <li key={`${a.artist}::${a.title}`}>
              <button
                type="button"
                onClick={() => void openAlbum(a)}
                className={cn(
                  "flex w-full gap-3 rounded-xl border border-border px-3 py-3 text-left transition-colors hover:bg-muted/40",
                )}
              >
                <CoverArt
                  seed={`${a.artist}-${a.title}`}
                  image={a.coverPath}
                  className="size-14 shrink-0 rounded-md"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm font-medium">{a.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.artist}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                      {a.presentCount}/{a.trackCount} on disk
                    </p>
                    {a.complete ? (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/30 text-[10px] text-emerald-700 dark:text-emerald-400"
                      >
                        Complete
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-amber-500/30 text-[10px] text-amber-700 dark:text-amber-400"
                      >
                        Incomplete
                      </Badge>
                    )}
                  </div>
                </div>
                {canDeleteFiles ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 shrink-0 self-start"
                    disabled={busyKey === `${a.artist}::${a.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDelete({
                        kind: "album",
                        artist: a.artist,
                        title: a.title,
                      });
                    }}
                    aria-label={`Delete ${a.title}`}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </Button>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={page}
        pageCount={pageCount}
        total={total}
        onPage={(p) => {
          setPage(p);
          void load(p);
        }}
      />

      <Dialog
        open={Boolean(albumOpen)}
        onOpenChange={(open) => {
          if (!open) {
            setAlbumOpen(null);
            setAlbumTracks([]);
          }
        }}
      >
        <DialogContent className="flex max-h-[min(85vh,640px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-4 py-3 text-left">
            <DialogTitle className="pr-8 text-base font-semibold">
              {albumOpen?.title || "Album"}
            </DialogTitle>
            {albumOpen ? (
              <p className="text-sm text-muted-foreground">
                {albumOpen.artist}
                {" · "}
                {albumOpen.presentCount}/{albumOpen.trackCount} available
                {albumOpen.complete ? " · Complete" : " · Incomplete"}
              </p>
            ) : null}
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {albumLoading ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                Loading tracks…
              </p>
            ) : albumTracks.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                No tracks in this album.
              </p>
            ) : (
              <ul className="space-y-1">
                {albumTracks.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-2 rounded-lg px-2 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{t.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDuration(t.duration || 0)}
                      </p>
                    </div>
                    <AvailableBadge available={Boolean(t.available)} />
                    <SourceBadge track={t} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={
          pendingDelete?.kind === "album"
            ? "Delete album files?"
            : "Delete track file?"
        }
        description={
          pendingDelete?.kind === "album"
            ? `This permanently deletes “${pendingDelete.title}” by ${pendingDelete.artist} from disk. Lidarr may download it again later.`
            : pendingDelete
              ? `This permanently deletes “${pendingDelete.track.title}” from disk. Lidarr may download it again later.`
              : ""
        }
        confirmLabel="Delete from disk"
        destructive
        busy={Boolean(busyKey)}
        onConfirm={() => {
          if (!canDeleteFiles) return;
          if (pendingDelete?.kind === "track") {
            void removeTrack(pendingDelete.track);
          } else if (pendingDelete?.kind === "album") {
            void removeAlbum(pendingDelete.artist, pendingDelete.title);
          }
        }}
      />
    </div>
  );
}
