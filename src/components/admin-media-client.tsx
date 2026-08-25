"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CoverArt } from "@/components/cover-art";
import { formatDuration } from "@/lib/utils";
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
  path?: string;
  coverPath?: string | null;
  addedAt?: string;
};

type Mode = "tracks" | "albums";

const COPY: Record<
  Mode,
  { title: string; blurb: string; empty: string }
> = {
  tracks: {
    title: "Tracks",
    blurb: "All audio files indexed in the Polarr library.",
    empty: "No tracks yet. Scan the music root or request media.",
  },
  albums: {
    title: "Albums",
    blurb: "Albums grouped from library tracks.",
    empty: "No albums yet.",
  },
};

export function AdminMediaClient({ mode }: { mode: Mode }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: "track"; track: Track }
    | { kind: "album"; artist: string; title: string }
    | null
  >(null);
  const [canDeleteFiles, setCanDeleteFiles] = useState(false);

  async function load(scan = false) {
    setScanning(scan);
    const gate = await fetch("/api/admin/stats");
    if (gate.status === 403 || gate.status === 401) {
      setForbidden(true);
      setScanning(false);
      return;
    }
    setForbidden(false);
    const res = await fetch(scan ? "/api/library?scan=1" : "/api/library");
    const data = await res.json();
    setTracks(data.tracks || []);
    if (scan) {
      toastSuccess(
        typeof data.added === "number"
          ? `Scan complete · ${data.added} added · ${(data.tracks || []).length} total`
          : "Scan complete",
      );
    }
    setScanning(false);
  }

  useEffect(() => {
    void load(false);
  }, []);

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
    setTracks((prev) => prev.filter((x) => x.id !== t.id));
    toastSuccess(`Deleted “${t.title}” from disk`);
    emitLibraryChanged({ trackId: t.id });
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
    setTracks((prev) =>
      prev.filter(
        (t) =>
          !(
            t.artist.trim().toLowerCase() === artist.trim().toLowerCase() &&
            (t.album || t.title).trim().toLowerCase() ===
              title.trim().toLowerCase()
          ),
      ),
    );
    toastSuccess(`Deleted ${data?.removed ?? 0} file(s) from “${title}”`);
  }

  const albums = useMemo(() => {
    const map = new Map<
      string,
      {
        title: string;
        artist: string;
        tracks: Track[];
        key: string;
        coverPath: string | null;
      }
    >();
    for (const t of tracks) {
      const title = (t.album || t.title || "Unknown").trim();
      const artist = (t.artist || "Unknown").trim();
      const key = `${artist.toLowerCase()}::${title.toLowerCase()}`;
      const cur = map.get(key);
      if (cur) {
        cur.tracks.push(t);
        if (!cur.coverPath && t.coverPath) cur.coverPath = t.coverPath;
      } else {
        map.set(key, {
          title,
          artist,
          tracks: [t],
          key,
          coverPath: t.coverPath || null,
        });
      }
    }
    return [...map.values()].sort(
      (a, b) =>
        b.tracks.length - a.tracks.length || a.title.localeCompare(b.title),
    );
  }, [tracks]);

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {copy.title}
          </h1>
          <p className="text-sm text-muted-foreground">{copy.blurb}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={scanning}
          onClick={() => void load(true)}
        >
          <RefreshCw className={`size-3.5 ${scanning ? "animate-spin" : ""}`} />
          {scanning ? "Scanning…" : "Scan library"}
        </Button>
      </div>

      {mode === "tracks" ? (
        tracks.length === 0 ? (
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
                <div className="flex shrink-0 items-center gap-2">
                  {t.source ? (
                    <Badge variant="outline">{t.source}</Badge>
                  ) : null}
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {formatDuration(t.duration || 0)}
                  </span>
                  {canDeleteFiles ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      disabled={busyKey === t.id}
                      onClick={() => setPendingDelete({ kind: "track", track: t })}
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
      ) : albums.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {albums.map((a) => (
            <li
              key={a.key}
              className="flex gap-3 rounded-xl border border-border px-3 py-3"
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
                <p className="text-xs text-muted-foreground">
                  {a.tracks.length} track{a.tracks.length === 1 ? "" : "s"}
                </p>
              </div>
              {canDeleteFiles ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0 self-start"
                  disabled={busyKey === `${a.artist}::${a.title}`}
                  onClick={() =>
                    setPendingDelete({
                      kind: "album",
                      artist: a.artist,
                      title: a.title,
                    })
                  }
                  aria-label={`Delete ${a.title}`}
                >
                  <Trash2 className="size-3.5 text-muted-foreground" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
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
