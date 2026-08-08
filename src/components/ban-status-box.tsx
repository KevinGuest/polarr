"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type BanStatus = {
  stream: boolean;
  download: boolean;
  user: boolean;
  expiresAt: string | null;
  permanent: boolean;
  label: string;
  rickroll?: boolean;
} | null;

/** Compact sidebar footer for active non–user-only bans. */
export function BanStatusBox({ className }: { className?: string }) {
  const [ban, setBan] = useState<BanStatus>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { ban?: BanStatus } | null) => {
        if (cancelled) return;
        const b = data?.ban;
        if (!b) {
          setBan(null);
          return;
        }
        // User-only bans block login — still hide if only user and no stream/download
        if (!b.stream && !b.download) {
          setBan(null);
          return;
        }
        setBan(b);
      })
      .catch(() => {
        if (!cancelled) setBan(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ban) return null;

  return (
    <div
      className={cn(
        // Bleed past sidebar px-3 so the rule meets the side walls
        "-mx-3 border-t border-border px-3 pt-3 text-xs",
        className,
      )}
      role="status"
      aria-label="Account restrictions"
    >
      <p className="font-medium text-foreground">Restricted</p>
      <p className="mt-0.5 text-muted-foreground">{ban.label}</p>
      <ul className="mt-2 space-y-1">
        <BanLine on={ban.stream} label="Streaming" />
        <BanLine on={ban.download} label="Downloads" />
        {ban.user ? <BanLine on label="Account" /> : null}
      </ul>
    </div>
  );
}

/** Same plain check / X as admin ban type chips (no filled checkbox). */
function BanLine({ on, label }: { on: boolean; label: string }) {
  return (
    <li
      className={cn(
        "flex items-center gap-1.5 text-[11px]",
        on ? "text-foreground" : "text-muted-foreground/50",
      )}
    >
      {on ? (
        <Check
          className="size-3 shrink-0 text-emerald-400"
          strokeWidth={2.5}
          aria-hidden
        />
      ) : (
        <X
          className="size-3 shrink-0 text-destructive"
          strokeWidth={2.5}
          aria-hidden
        />
      )}
      <span>{label}</span>
    </li>
  );
}
