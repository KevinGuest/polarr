"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ban, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toastError, toastSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

type BanRow = {
  id: string;
  userId: string;
  publicUserId: string;
  username: string;
  stream: boolean;
  download: boolean;
  user: boolean;
  expiresAt: string | null;
  reason: string | null;
  createdByUsername: string | null;
  createdAt: string;
  liftedAt: string | null;
  active: boolean;
};

type UserOpt = {
  publicId: string;
  username: string;
  role: string;
  revoked: boolean;
};

const DURATIONS = [
  { id: "1h", label: "1 hour" },
  { id: "24h", label: "24 hours" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "permanent", label: "Permanent" },
  { id: "custom", label: "Custom end" },
] as const;

const JAMESON_GIF = "/memes/jameson-laugh.gif";

export function AdminBansClient() {
  const [bans, setBans] = useState<BanRow[]>([]);
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [liftTarget, setLiftTarget] = useState<BanRow | null>(null);
  /** Feeling lucky lost — morph dialog into Jameson gif, then kill the tab. */
  const [luckyFail, setLuckyFail] = useState(false);
  const [luckyBusy, setLuckyBusy] = useState(false);

  const [userId, setUserId] = useState("");
  const [stream, setStream] = useState(true);
  const [download, setDownload] = useState(false);
  const [userBan, setUserBan] = useState(false);
  const [duration, setDuration] =
    useState<(typeof DURATIONS)[number]["id"]>("24h");
  const [customEndsAt, setCustomEndsAt] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/bans", { cache: "no-store" });
    if (res.status === 403 || res.status === 401) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    setForbidden(false);
    const data = await res.json();
    setBans(data.bans || []);
    setUsers(data.users || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openLift(ban: BanRow) {
    setLiftTarget(ban);
    setLuckyFail(false);
    setLuckyBusy(false);
    // Warm the gif so the lose reveal is instant
    if (typeof window !== "undefined") {
      const img = new window.Image();
      img.src = JAMESON_GIF;
    }
  }

  function closeLift(nextOpen: boolean) {
    // Lock the dialog while the lose animation runs — no X / escape bail.
    if (luckyFail || luckyBusy) return;
    if (!nextOpen) {
      setLiftTarget(null);
      setLuckyFail(false);
      setLuckyBusy(false);
    }
  }

  async function createBan() {
    if (!userId) {
      toastError("Select a user");
      return;
    }
    if (!stream && !download && !userBan) {
      toastError("Pick at least one ban type");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/bans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          stream,
          download,
          user: userBan,
          duration,
          customEndsAt:
            duration === "custom" && customEndsAt
              ? new Date(customEndsAt).toISOString()
              : null,
          reason: reason.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(
          typeof data.error === "string" ? data.error : "Could not create ban",
        );
        return;
      }
      toastSuccess("Ban applied");
      setOpen(false);
      setReason("");
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function liftBan(id: string, how: "lift" | "lucky") {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/bans", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ banId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(
          typeof data.error === "string" ? data.error : "Could not lift ban",
        );
        return false;
      }
      toastSuccess(how === "lucky" ? "Lucky — ban lifted" : "Ban lifted");
      setLiftTarget(null);
      void load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  function closeThisTab() {
    // No about:blank fallback — if the browser refuses, the tab just stays.
    try {
      window.open("", "_self");
    } catch {
      /* ignore */
    }
    try {
      window.close();
    } catch {
      /* ignore */
    }
  }

  async function feelingLucky() {
    if (!liftTarget || luckyBusy || busy) return;
    setLuckyBusy(true);

    await new Promise((r) => window.setTimeout(r, 280));

    const win = Math.random() < 0.5;
    if (win) {
      await liftBan(liftTarget.id, "lucky");
      setLuckyBusy(false);
      return;
    }

    // Lose: show Jameson laughing for 5s, then close the tab
    setLuckyFail(true);
    await new Promise((r) => window.setTimeout(r, 5000));
    closeThisTab();
  }

  if (forbidden) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Bans</h1>
        <p className="text-sm text-muted-foreground">
          Admin only. Sign in with an admin account.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  const active = bans.filter((b) => b.active);
  const past = bans.filter((b) => !b.active);

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Bans</h1>
          <p className="text-sm text-muted-foreground">
            Restrict streaming, downloads, or sign-in.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Ban className="size-3.5" />
          New ban
        </Button>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Active {loading ? "" : `· ${active.length}`}
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active bans.</p>
        ) : (
          <ul className="divide-y divide-border/70 rounded-xl border border-border">
            {active.map((b) => (
              <BanListItem
                key={b.id}
                ban={b}
                onLift={() => openLift(b)}
                busy={busy || luckyBusy}
              />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            History
          </h2>
          <ul className="divide-y divide-border/70 rounded-xl border border-border opacity-80">
            {past.slice(0, 40).map((b) => (
              <BanListItem key={b.id} ban={b} />
            ))}
          </ul>
        </section>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New ban</DialogTitle>
            <DialogDescription>
              Choose types and how long the ban lasts.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ban-user">User</Label>
              <select
                id="ban-user"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="">Select…</option>
                {users.map((u) => (
                  <option key={u.publicId} value={u.publicId}>
                    {u.username}
                    {u.revoked ? " · revoked" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Types</Label>
              <div className="flex flex-col gap-2">
                <TypeCheck
                  label="Streaming"
                  hint="No playback"
                  checked={stream}
                  onChange={setStream}
                />
                <TypeCheck
                  label="Downloads"
                  hint="No downloads"
                  checked={download}
                  onChange={setDownload}
                />
                <TypeCheck
                  label="User"
                  hint="No sign-in"
                  checked={userBan}
                  onChange={setUserBan}
                />
              </div>
              {stream && download ? (
                <p className="text-xs text-muted-foreground">
                  Together these limit playback to the rickroll.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ban-duration">Duration</Label>
              <select
                id="ban-duration"
                value={duration}
                onChange={(e) =>
                  setDuration(e.target.value as typeof duration)
                }
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                {DURATIONS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>

            {duration === "custom" ? (
              <div className="space-y-2">
                <Label htmlFor="ban-ends">Ends at</Label>
                <Input
                  id="ban-ends"
                  type="datetime-local"
                  value={customEndsAt}
                  onChange={(e) => setCustomEndsAt(e.target.value)}
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="ban-reason">Reason (optional)</Label>
              <Input
                id="ban-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder="Shared with staff only"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void createBan()}
            >
              Apply ban
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(liftTarget)}
        onOpenChange={(next) => closeLift(next)}
      >
        <DialogContent
          className={cn(
            "max-w-md overflow-hidden",
            luckyFail &&
              "gap-0 border-0 p-0 sm:max-w-lg sm:rounded-xl [&>button]:hidden",
          )}
          onPointerDownOutside={(e) => {
            if (luckyFail || luckyBusy) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (luckyFail || luckyBusy) e.preventDefault();
          }}
        >
          {luckyFail ? (
            <div className="relative bg-black">
              <DialogHeader className="sr-only">
                <DialogTitle>Unlucky</DialogTitle>
                <DialogDescription>
                  Feeling lucky did not work out.
                </DialogDescription>
              </DialogHeader>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={JAMESON_GIF}
                alt=""
                className="block w-full object-contain"
              />
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Lift ban?</DialogTitle>
                <DialogDescription>
                  {liftTarget
                    ? `Remove the ban on ${liftTarget.username}.`
                    : null}
                </DialogDescription>
              </DialogHeader>

              <DialogFooter className="flex-row items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={busy || luckyBusy}
                  onClick={() => void feelingLucky()}
                  className={cn(
                    "ban-holo-btn inline-flex h-9 min-w-[8.5rem] shrink-0 items-center justify-center rounded-md px-3 text-sm disabled:opacity-60",
                  )}
                >
                  <span>{luckyBusy ? "…" : "Feeling lucky"}</span>
                </button>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || luckyBusy}
                  className="h-9 border-border bg-transparent text-foreground shadow-none hover:bg-transparent hover:text-foreground"
                  onClick={() => {
                    if (liftTarget) void liftBan(liftTarget.id, "lift");
                  }}
                >
                  Lift
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TypeCheck({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        checked ? "border-foreground/40 bg-muted/40" : "border-border",
      )}
    >
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

function BanListItem({
  ban,
  onLift,
  busy,
}: {
  ban: BanRow;
  onLift?: () => void;
  busy?: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-3 sm:px-4">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{ban.username}</span>
          {ban.active ? (
            <Badge variant="warn">active</Badge>
          ) : ban.liftedAt ? (
            <Badge variant="outline">lifted</Badge>
          ) : (
            <Badge variant="outline">expired</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <TypeChip on={ban.stream} label="Streaming" />
          <TypeChip on={ban.download} label="Downloads" />
          <TypeChip on={ban.user} label="User" />
          <span>·</span>
          <span>
            {ban.expiresAt
              ? `Until ${new Date(ban.expiresAt).toLocaleString()}`
              : "Permanent"}
          </span>
          {ban.createdByUsername ? (
            <>
              <span>·</span>
              <span>by {ban.createdByUsername}</span>
            </>
          ) : null}
        </div>
        {ban.reason ? (
          <p className="text-xs text-muted-foreground">{ban.reason}</p>
        ) : null}
      </div>
      {ban.active && onLift ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={onLift}
        >
          Lift
        </Button>
      ) : null}
    </li>
  );
}

function TypeChip({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5",
        on ? "text-foreground" : "text-muted-foreground/50",
      )}
    >
      {on ? (
        <Check className="size-3 text-emerald-400" strokeWidth={2.5} />
      ) : null}
      {label}
    </span>
  );
}
