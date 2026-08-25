"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CoverArt } from "@/components/cover-art";
import { Button } from "@/components/ui/button";
import { toastError, toastSuccess } from "@/lib/toast";

type AdminPlaylist = {
  id: string;
  name: string;
  description: string;
  trackCount: number;
  ownerUsername: string;
  userId: string;
  updatedAt: string;
  createdAt: string;
  coverUrl: string | null;
};

export function AdminPlaylistsClient() {
  const [playlists, setPlaylists] = useState<AdminPlaylist[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminPlaylist | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/playlists", { cache: "no-store" });
    if (res.status === 403 || res.status === 401) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    setForbidden(false);
    const data = await res.json().catch(() => null);
    setPlaylists(Array.isArray(data?.playlists) ? data.playlists : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function removePlaylist(pl: AdminPlaylist) {
    setBusyId(pl.id);
    const res = await fetch("/api/admin/playlists", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: pl.id }),
    });
    const data = await res.json().catch(() => null);
    setBusyId(null);
    if (!res.ok) {
      toastError(data?.error || "Delete failed");
      return;
    }
    setPendingDelete(null);
    setPlaylists((prev) => prev.filter((p) => p.id !== pl.id));
    toastSuccess(`Deleted “${pl.name}”`);
  }

  if (forbidden) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Playlists</h1>
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
          <h1 className="text-2xl font-semibold tracking-tight">Playlists</h1>
          <p className="text-sm text-muted-foreground">
            Playlists created by users on this server.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading && playlists.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : playlists.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No user playlists yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {playlists.map((pl) => (
            <li
              key={pl.id}
              className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5"
            >
              <Link
                href={`/playlist/${encodeURIComponent(pl.id)}`}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                <CoverArt
                  seed={pl.name}
                  image={pl.coverUrl}
                  className="size-12 shrink-0 rounded-md"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{pl.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {pl.ownerUsername}
                    {" · "}
                    {pl.trackCount} track{pl.trackCount === 1 ? "" : "s"}
                  </p>
                </div>
              </Link>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 shrink-0"
                disabled={busyId === pl.id}
                onClick={() => setPendingDelete(pl)}
                aria-label={`Delete ${pl.name}`}
              >
                <Trash2 className="size-3.5 text-muted-foreground" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete playlist?"
        description={
          pendingDelete
            ? `This removes “${pendingDelete.name}” by ${pendingDelete.ownerUsername}. Tracks stay in the library.`
            : ""
        }
        confirmLabel="Delete playlist"
        destructive
        busy={Boolean(busyId)}
        onConfirm={() => {
          if (pendingDelete) void removePlaylist(pendingDelete);
        }}
      />
    </div>
  );
}
