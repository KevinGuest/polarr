"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type UserRow = {
  publicId: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
  avatarUrl?: string | null;
};

type UserStats = {
  user: UserRow;
  requestsTotal: number;
  requestsByStatus: Record<string, number>;
  downloads: {
    total: number;
    completed: number;
    active: number;
  };
  albumsListed: number;
  libraryTracks: number;
  recentRequests: {
    id: string;
    title: string;
    artist: string;
    album: string;
    status: string;
    source: string;
    mediaType: string;
    createdAt: string;
  }[];
};

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function AdminUsersClient() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [mePublicId, setMePublicId] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/admin/users");
    if (res.status === 403 || res.status === 401) {
      setForbidden(true);
      return;
    }
    setForbidden(false);
    const data = await res.json();
    setUsers(data.users || []);
    setMePublicId(data.mePublicId ?? null);
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!selected) {
      setStats(null);
      setStatsError(null);
      return;
    }
    let cancelled = false;
    setStatsLoading(true);
    setStatsError(null);
    void fetch(
      `/api/admin/users/${encodeURIComponent(selected.publicId)}`,
    )
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load stats");
        return body as UserStats;
      })
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setStats(null);
          setStatsError(err instanceof Error ? err.message : "Failed to load");
        }
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  async function toggleAdmin(user: UserRow) {
    setBusy(user.publicId);
    setMsg(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: user.publicId,
        isAdmin: !user.isAdmin,
      }),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) {
      setMsg(data.error || "Update failed");
      return;
    }
    void refresh();
    if (selected?.publicId === user.publicId) {
      setSelected((prev) =>
        prev ? { ...prev, isAdmin: !prev.isAdmin } : prev,
      );
    }
  }

  if (forbidden) {
    return (
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          Admin only. Sign in with an admin account to manage users.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          Users
        </h1>
        <p className="text-sm text-muted-foreground">
          Accounts on this Polarr server. Click a member for activity details.
        </p>
        {msg && <p className="text-sm text-destructive">{msg}</p>}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          {users.length} member{users.length === 1 ? "" : "s"}
        </h2>
        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users yet.</p>
        ) : (
          <ul className="space-y-3">
            {users.map((u) => {
              const letter = u.username.trim()[0]?.toUpperCase() || "?";
              return (
                <li
                  key={u.publicId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-4 transition-colors hover:border-foreground/25"
                >
                  <button
                    type="button"
                    onClick={() => setSelected(u)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <div
                      className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/60 bg-muted text-sm font-semibold uppercase"
                      aria-hidden
                    >
                      {u.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={u.avatarUrl}
                          alt=""
                          className="absolute inset-0 size-full object-cover"
                        />
                      ) : (
                        letter
                      )}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{u.username}</span>
                        {u.publicId === mePublicId && (
                          <Badge variant="secondary">you</Badge>
                        )}
                        <Badge
                          variant={u.isAdmin ? "default" : "outline"}
                          className={
                            u.isAdmin
                              ? "border-transparent bg-foreground text-background"
                              : undefined
                          }
                        >
                          {u.isAdmin ? "Admin" : "Member"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Joined {new Date(u.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === u.publicId || u.publicId === mePublicId}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleAdmin(u);
                    }}
                  >
                    {busy === u.publicId
                      ? "…"
                      : u.isAdmin
                        ? "Remove admin"
                        : "Make admin"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {selected ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="presentation"
          onClick={() => setSelected(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-stats-title"
            className="max-h-[min(90vh,40rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-background p-5 shadow-xl sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div
                className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/60 bg-muted text-lg font-semibold uppercase"
                aria-hidden
              >
                {selected.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selected.avatarUrl}
                    alt=""
                    className="absolute inset-0 size-full object-cover"
                  />
                ) : (
                  selected.username.trim()[0]?.toUpperCase() || "?"
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2
                  id="user-stats-title"
                  className="truncate text-xl font-semibold tracking-tight"
                >
                  {selected.username}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Joined {new Date(selected.createdAt).toLocaleString()}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 shrink-0"
                onClick={() => setSelected(null)}
                aria-label="Close"
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="mt-5 space-y-5">
              {statsLoading ? (
                <p className="text-sm text-muted-foreground">Loading stats…</p>
              ) : statsError ? (
                <p className="text-sm text-destructive">{statsError}</p>
              ) : stats ? (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <StatTile label="Requests" value={stats.requestsTotal} />
                    <StatTile
                      label="Downloads"
                      value={stats.downloads.total}
                    />
                    <StatTile
                      label="Albums"
                      value={stats.albumsListed}
                    />
                    <StatTile
                      label="Completed"
                      value={stats.downloads.completed}
                    />
                    <StatTile label="Active" value={stats.downloads.active} />
                    <StatTile
                      label="Library tracks"
                      value={stats.libraryTracks}
                    />
                  </div>

                  {Object.keys(stats.requestsByStatus).some(
                    (s) => s !== "failed",
                  ) ? (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(stats.requestsByStatus)
                        .filter(([status]) => status !== "failed")
                        .map(([status, n]) => (
                          <Badge key={status} variant="outline">
                            {status}: {n}
                          </Badge>
                        ))}
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-muted-foreground">
                      Recent requests
                    </h3>
                    {stats.recentRequests.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No requests from this user yet.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {stats.recentRequests.map((r) => (
                          <li
                            key={r.id}
                            className="rounded-lg border border-border/70 px-3 py-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <p className="truncate text-sm font-medium">
                                    {r.title}
                                  </p>
                                  {r.status === "failed" ? (
                                    <Badge
                                      variant="outline"
                                      className="shrink-0 capitalize"
                                    >
                                      {r.mediaType === "track"
                                        ? "Track"
                                        : r.mediaType === "artist"
                                          ? "Artist"
                                          : "Album"}
                                    </Badge>
                                  ) : null}
                                </div>
                                <p className="truncate text-xs text-muted-foreground">
                                  {r.artist}
                                  {r.album ? ` · ${r.album}` : ""}
                                </p>
                              </div>
                              <Badge variant="outline" className="shrink-0">
                                {r.status}
                              </Badge>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Albums count is from the shared library shown on their
                    public profile. Requests and downloads are tracked per
                    account.
                  </p>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
