"use client";

import { Check, X } from "lucide-react";
import { useAuthOptional, type BanStatus } from "@/components/auth-provider";
import { cn } from "@/lib/utils";

export type { BanStatus };

/** Compact sidebar footer for active non–user-only bans. */
export function BanStatusBox({ className }: { className?: string }) {
  const auth = useAuthOptional();
  const ban = auth?.ban ?? null;

  if (!ban) return null;
  // User-only bans block login — still hide if only user and no stream/download
  if (!ban.stream && !ban.download) return null;

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
        <Check className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
      ) : (
        <X className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
      )}
      <span>{label}</span>
    </li>
  );
}
