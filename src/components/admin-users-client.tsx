"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { MoreHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { roleLabel, type UserRole } from "@/lib/roles";
import { cn } from "@/lib/utils";

type UserRow = {
  publicId: string;
  username: string;
  isAdmin: boolean;
  role: UserRole;
  createdAt: string;
  avatarUrl?: string | null;
  accessRevokedAt?: string | null;
};

type UserApiUser = UserRow & {
  email: string | null;
  lastIp: string | null;
  lastHwid: string | null;
  accessRevokedAt: string | null;
  invite: {
    id: string;
    code: string;
    emailedTo: string | null;
    usedAt: string | null;
    createdAt: string;
  } | null;
};

type UserDetailPayload = {
  user: UserApiUser;
  requestsTotal: number;
  requestsByStatus: Record<string, number>;
  downloads: {
    total: number;
    completed: number;
    active: number;
  };
  albumsListed: number;
  libraryTracks: number;
  listensMinutes: number;
  plays: number;
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all font-medium text-foreground">{value}</dd>
    </div>
  );
}

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

function roleBadgeVariant(role: UserRole): "default" | "outline" | "secondary" {
  if (role === "owner" || role === "admin") return "default";
  if (role === "moderator") return "secondary";
  return "outline";
}

async function fetchUserPayload(publicId: string): Promise<UserDetailPayload> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(publicId)}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to load user");
  return body as UserDetailPayload;
}

export function AdminUsersClient() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [mePublicId, setMePublicId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Click row → activity
  const [activityUser, setActivityUser] = useState<UserRow | null>(null);
  const [activity, setActivity] = useState<UserDetailPayload | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  // ⋯ User details → account + role only
  const [detailsUser, setDetailsUser] = useState<UserRow | null>(null);
  const [details, setDetails] = useState<UserApiUser | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<UserRow | null>(null);
  const [transferTarget, setTransferTarget] = useState<UserRow | null>(null);

  async function refresh() {
    const res = await fetch("/api/admin/users");
    if (res.status === 403 || res.status === 401) {
      setForbidden(true);
      return;
    }
    setForbidden(false);
    const data = await res.json();
    const list = (data.users || []).map((u: UserRow) => ({
      ...u,
      role: u.role || (u.isAdmin ? "admin" : "member"),
    }));
    setUsers(list);
    setMePublicId(data.mePublicId ?? null);
    setCanManage(Boolean(data.canManage));
    setIsOwner(Boolean(data.isOwner));

    setDetailsUser((prev) => {
      if (!prev) return prev;
      return list.find((u: UserRow) => u.publicId === prev.publicId) ?? prev;
    });
    setActivityUser((prev) => {
      if (!prev) return prev;
      return list.find((u: UserRow) => u.publicId === prev.publicId) ?? prev;
    });
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!activityUser) {
      setActivity(null);
      setActivityError(null);
      return;
    }
    let cancelled = false;
    setActivityLoading(true);
    setActivityError(null);
    void fetchUserPayload(activityUser.publicId)
      .then((data) => {
        if (!cancelled) setActivity(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setActivity(null);
          setActivityError(
            err instanceof Error ? err.message : "Failed to load",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activityUser?.publicId]);

  useEffect(() => {
    if (!detailsUser) {
      setDetails(null);
      setDetailsError(null);
      return;
    }
    let cancelled = false;
    setDetailsLoading(true);
    setDetailsError(null);
    void fetchUserPayload(detailsUser.publicId)
      .then((data) => {
        if (!cancelled) setDetails(data.user);
      })
      .catch((err) => {
        if (!cancelled) {
          setDetails(null);
          setDetailsError(
            err instanceof Error ? err.message : "Failed to load",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailsUser?.publicId]);

  useEffect(() => {
    if (!activityUser) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setActivityUser(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activityUser]);

  async function setRole(user: UserRow, role: UserRole) {
    if (!canManage) {
      toast.error("Only admins can change roles");
      return;
    }
    if (user.publicId === mePublicId) {
      toast.error("You cannot change your own role here");
      return;
    }
    if (role === "owner") {
      setTransferTarget(user);
      return;
    }
    if (user.role === "owner") {
      toast.error("Cannot change the Server Owner role");
      return;
    }
    if (role === user.role) return;

    setBusy(user.publicId);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.publicId, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          typeof data.error === "string" ? data.error : "Could not update role",
        );
        return;
      }
      toast.success(`${user.username} is now ${roleLabel(role)}`);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function confirmTransfer() {
    if (!transferTarget) return;
    setBusy(transferTarget.publicId);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: transferTarget.publicId,
          role: "owner",
          confirmTransfer: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          typeof data.error === "string"
            ? data.error
            : "Could not transfer ownership",
        );
        return;
      }
      toast.success(
        `${transferTarget.username} is now the Server Owner. You are a member.`,
      );
      setTransferTarget(null);
      setDetailsUser(null);
      setActivityUser(null);
      setCanManage(false);
      setIsOwner(false);
      await refresh();
      if (typeof window !== "undefined") {
        window.location.href = "/";
      }
    } finally {
      setBusy(null);
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setBusy(revokeTarget.publicId);
    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: revokeTarget.publicId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          typeof data.error === "string"
            ? data.error
            : "Could not revoke access",
        );
        return;
      }
      toast.success(`Access revoked for ${revokeTarget.username}`);
      if (detailsUser?.publicId === revokeTarget.publicId) {
        setDetailsUser(null);
      }
      if (activityUser?.publicId === revokeTarget.publicId) {
        setActivityUser(null);
      }
      setRevokeTarget(null);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  function roleSelectDisabled(u: UserRow): boolean {
    if (!canManage) return true;
    if (u.publicId === mePublicId) return true;
    if (u.accessRevokedAt) return true;
    if (u.role === "owner") return true;
    if (busy === u.publicId) return true;
    return false;
  }

  if (forbidden) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          Staff only. Sign in with an admin or moderator account.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  const detailsRole =
    details?.role ||
    detailsUser?.role ||
    (detailsUser?.isAdmin ? "admin" : "member");

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          Click a member for activity. Use the menu for account details and
          roles, or to revoke access.
        </p>
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
              const role = u.role || (u.isAdmin ? "admin" : "member");
              const isSelf = u.publicId === mePublicId;

              return (
                <li
                  key={u.publicId}
                  className="flex items-center gap-3 rounded-xl border border-border px-4 py-4 transition-colors hover:border-foreground/25"
                >
                  <button
                    type="button"
                    onClick={() => setActivityUser(u)}
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
                        {isSelf ? <Badge variant="secondary">you</Badge> : null}
                        <Badge
                          variant={roleBadgeVariant(role)}
                          className={
                            role === "owner" || role === "admin"
                              ? "border-transparent bg-foreground text-background"
                              : undefined
                          }
                        >
                          {roleLabel(role)}
                        </Badge>
                        {u.accessRevokedAt ? (
                          <Badge variant="warn">Revoked</Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Joined {new Date(u.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-9 shrink-0"
                        disabled={busy === u.publicId}
                        aria-label={`Actions for ${u.username}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onSelect={() => setDetailsUser(u)}>
                        User details
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        disabled={
                          !canManage ||
                          isSelf ||
                          role === "owner" ||
                          Boolean(u.accessRevokedAt) ||
                          busy === u.publicId
                        }
                        onSelect={() => setRevokeTarget(u)}
                      >
                        Revoke
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Activity card — row click */}
      {activityUser ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="presentation"
          onClick={() => setActivityUser(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-activity-title"
            className="max-h-[min(90vh,40rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-background p-5 shadow-xl sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div
                className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/60 bg-muted text-lg font-semibold uppercase"
                aria-hidden
              >
                {(activity?.user.avatarUrl || activityUser.avatarUrl) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={
                      activity?.user.avatarUrl || activityUser.avatarUrl || ""
                    }
                    alt=""
                    className="absolute inset-0 size-full object-cover"
                  />
                ) : (
                  activityUser.username.trim()[0]?.toUpperCase() || "?"
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2
                  id="user-activity-title"
                  className="truncate text-xl font-semibold tracking-tight"
                >
                  {activityUser.username}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Joined{" "}
                  {new Date(
                    activity?.user.createdAt || activityUser.createdAt,
                  ).toLocaleString()}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 shrink-0"
                onClick={() => setActivityUser(null)}
                aria-label="Close"
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="mt-5 space-y-5">
              {activityLoading ? (
                <p className="text-sm text-muted-foreground">Loading stats…</p>
              ) : activityError ? (
                <p className="text-sm text-destructive">{activityError}</p>
              ) : activity ? (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <StatTile
                      label="Requests"
                      value={activity.requestsTotal}
                    />
                    <StatTile
                      label="Downloads"
                      value={activity.downloads.total}
                    />
                    <StatTile label="Albums" value={activity.albumsListed} />
                    <StatTile
                      label="Completed"
                      value={activity.downloads.completed}
                    />
                    <StatTile
                      label="Active"
                      value={activity.downloads.active}
                    />
                    <StatTile
                      label="Library tracks"
                      value={activity.libraryTracks}
                    />
                  </div>

                  {Object.keys(activity.requestsByStatus).some(
                    (s) => s !== "failed",
                  ) ? (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(activity.requestsByStatus)
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
                    {activity.recentRequests.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No requests from this user yet.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {activity.recentRequests.slice(0, 3).map((r) => (
                          <li
                            key={r.id}
                            className="rounded-lg border border-border/70 px-3 py-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {r.title}
                                </p>
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

      {/* User details — ⋯ menu: account + role only */}
      <Dialog
        open={Boolean(detailsUser)}
        onOpenChange={(open) => {
          if (!open) setDetailsUser(null);
        }}
      >
        <DialogContent className="max-h-[min(90vh,36rem)] max-w-md overflow-y-auto">
          {detailsLoading ? (
            <>
              <DialogHeader>
                <DialogTitle>User details</DialogTitle>
                <DialogDescription>Loading account…</DialogDescription>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">Loading…</p>
            </>
          ) : detailsError ? (
            <>
              <DialogHeader>
                <DialogTitle>User details</DialogTitle>
                <DialogDescription>
                  Could not load this account.
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm text-destructive">{detailsError}</p>
            </>
          ) : details && detailsUser ? (
            <>
              <DialogHeader className="space-y-0 text-left">
                <div className="flex items-start gap-3 pr-6">
                  <div
                    className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/60 bg-muted text-base font-semibold uppercase"
                    aria-hidden
                  >
                    {details.avatarUrl || detailsUser.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={details.avatarUrl || detailsUser.avatarUrl || ""}
                        alt=""
                        className="absolute inset-0 size-full object-cover"
                      />
                    ) : (
                      details.username.trim()[0]?.toUpperCase() || "?"
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <DialogTitle className="truncate leading-tight">
                      {details.username}
                    </DialogTitle>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={roleBadgeVariant(detailsRole)}
                        className={
                          detailsRole === "owner" || detailsRole === "admin"
                            ? "border-transparent bg-foreground text-background"
                            : undefined
                        }
                      >
                        {roleLabel(detailsRole)}
                      </Badge>
                      {details.accessRevokedAt ? (
                        <Badge variant="warn">Revoked</Badge>
                      ) : null}
                    </div>
                    <DialogDescription className="text-left">
                      Joined{" "}
                      {new Date(details.createdAt).toLocaleDateString(
                        undefined,
                        {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        },
                      )}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-5">
                <dl className="divide-y divide-border/70 border-t border-border/70">
                  <DetailRow label="Email" value={details.email || "—"} />
                  <DetailRow
                    label="Invite code"
                    value={details.invite?.code || "—"}
                  />
                  {details.invite?.emailedTo ? (
                    <DetailRow
                      label="Invite email"
                      value={details.invite.emailedTo}
                    />
                  ) : null}
                  <DetailRow label="Last IP" value={details.lastIp || "—"} />
                  <DetailRow
                    label="Device ID"
                    value={details.lastHwid || "—"}
                  />
                  {details.accessRevokedAt ? (
                    <DetailRow
                      label="Revoked"
                      value={new Date(
                        details.accessRevokedAt,
                      ).toLocaleString()}
                    />
                  ) : null}
                </dl>

                {detailsRole === "owner" &&
                detailsUser.publicId === mePublicId ? null : (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Role
                  </p>
                  {detailsRole === "owner" ? (
                    <p className="text-sm text-muted-foreground">
                      {isOwner
                        ? "Server Owner can’t be reassigned here. Open another member and choose Server Owner to transfer."
                        : "Only the Server Owner can transfer this role."}
                    </p>
                  ) : (
                    <>
                      <div
                        className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/40 p-1"
                        role="group"
                        aria-label="Assign role"
                      >
                        {(
                          [
                            { value: "admin", label: "Admin" },
                            { value: "moderator", label: "Mod" },
                            { value: "member", label: "Member" },
                          ] as const
                        ).map((opt) => {
                          const active = detailsRole === opt.value;
                          const disabled = roleSelectDisabled(detailsUser);
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              disabled={disabled || busy === detailsUser.publicId}
                              onClick={() => {
                                if (!active) void setRole(detailsUser, opt.value);
                              }}
                              className={cn(
                                "rounded-md px-2 py-2 text-center text-sm transition-colors",
                                active
                                  ? "bg-background font-medium text-foreground shadow-sm"
                                  : "text-muted-foreground hover:text-foreground",
                                "disabled:pointer-events-none disabled:opacity-50",
                              )}
                              aria-pressed={active}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                      {isOwner && detailsUser.publicId !== mePublicId ? (
                        <button
                          type="button"
                          disabled={
                            Boolean(detailsUser.accessRevokedAt) ||
                            busy === detailsUser.publicId
                          }
                          onClick={() => void setRole(detailsUser, "owner")}
                          className={cn(
                            "w-full rounded-md border border-border px-3 py-2 text-left text-sm transition-colors",
                            "hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50",
                          )}
                        >
                          <span className="font-medium">Transfer ownership</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            Make this person the Server Owner. You become a
                            member.
                          </span>
                        </button>
                      ) : null}
                      {detailsUser.publicId === mePublicId && canManage ? (
                        <p className="text-xs text-muted-foreground">
                          You can’t change your own role.
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
                )}
              </div>
            </>
          ) : (
            <DialogHeader>
              <DialogTitle>User details</DialogTitle>
              <DialogDescription>Loading account…</DialogDescription>
            </DialogHeader>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(transferTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setTransferTarget(null);
            void refresh();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer Server Owner?</DialogTitle>
            <DialogDescription>
              There can only be one Server Owner. Continuing makes{" "}
              {transferTarget?.username} the Server Owner, and you become a
              regular member with no admin or moderator access. Admins cannot
              remove the Server Owner afterward.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setTransferTarget(null);
                void refresh();
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy === transferTarget?.publicId}
              onClick={() => void confirmTransfer()}
            >
              {busy === transferTarget?.publicId
                ? "Transferring…"
                : "Transfer ownership"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke access?</DialogTitle>
            <DialogDescription>
              This signs {revokeTarget?.username} out of Polarr, ends their
              sessions, and blocks them from logging in again. Their invite
              code stays on file for audit. Create a new invite if they should
              rejoin later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRevokeTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy === revokeTarget?.publicId}
              onClick={() => void confirmRevoke()}
            >
              {busy === revokeTarget?.publicId ? "Revoking…" : "Revoke access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
