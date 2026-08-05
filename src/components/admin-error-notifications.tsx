"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NotifItem = {
  id: string;
  kind: string;
  actorLabel: string;
  message: string;
  href: string | null;
  imageSeed: string | null;
  createdAt: string;
  readAt: string | null;
  unread: boolean;
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 60) return "now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d`;
  if (sec < 86400 * 30) return `${Math.floor(sec / (86400 * 7))}w`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function CoverRing({ seed, unread }: { seed: string; unread: boolean }) {
  return (
    <span
      className={cn(
        "relative flex size-11 shrink-0 items-center justify-center rounded-md p-[2px]",
        unread
          ? "bg-[linear-gradient(135deg,#f09433_0%,#e6683c_25%,#dc2743_50%,#cc2366_75%,#bc1888_100%)]"
          : "bg-transparent",
      )}
      aria-hidden
    >
      <CoverArt seed={seed} className="size-full rounded-[5px]" />
    </span>
  );
}

export function NotificationsBell({
  align = "end",
  side = "bottom",
}: {
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
}) {
  const router = useRouter();
  const [items, setItems] = useState<NotifItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      setUnread(Number(data.unread) || 0);
    } catch {
      /* keep last */
    }
  }, []);

  const markAllRead = useCallback(async () => {
    setUnread(0);
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_read" }),
      });
    } catch {
      void refresh();
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 12_000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          void markAllRead();
        } else {
          setItems((prev) =>
            prev.map((n) => ({
              ...n,
              unread: false,
              readAt: n.readAt || new Date().toISOString(),
            })),
          );
          void refresh();
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
            "hover:bg-muted/50 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          aria-label={
            unread > 0
              ? `Notifications, ${unread} unread`
              : "Notifications"
          }
        >
          <Bell className="size-[1.15rem]" strokeWidth={1.75} />
          {unread > 0 ? (
            <span className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold leading-none text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        side={side}
        className="w-[min(100vw-2rem,22rem)] p-0"
      >
        <DropdownMenuLabel className="px-3.5 py-2.5 text-sm font-semibold normal-case tracking-normal">
          Notifications
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="m-0" />
        {items.length === 0 ? (
          <div className="px-3.5 py-8 text-center text-sm text-muted-foreground">
            No notifications yet
          </div>
        ) : (
          <ul className="max-h-[min(70vh,28rem)] overflow-y-auto py-1">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors",
                    "hover:bg-muted/40",
                    n.unread && "bg-muted/20",
                  )}
                  onClick={() => {
                    setOpen(false);
                    if (n.href) router.push(n.href);
                  }}
                >
                  <CoverRing
                    seed={n.imageSeed || n.actorLabel || n.message}
                    unread={n.unread}
                  />
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-sm leading-snug text-foreground">
                      <span className="font-semibold">{n.actorLabel}</span>{" "}
                      <span className="font-normal text-foreground/90">
                        {n.message}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {relativeTime(n.createdAt)}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** @deprecated use NotificationsBell */
export const AdminErrorNotifications = NotificationsBell;
