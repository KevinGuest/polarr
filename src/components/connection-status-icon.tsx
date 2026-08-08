"use client";

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Check / X like request rows — hover title for detail. */
export function ConnectionStatusIcon({
  ok,
  okLabel,
  badLabel,
}: {
  ok: boolean;
  okLabel: string;
  badLabel: string;
}) {
  const label = ok ? okLabel : badLabel;
  return (
    <span
      title={label}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center",
        ok ? "text-emerald-400" : "text-destructive",
      )}
      aria-label={label}
    >
      {ok ? (
        <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
      ) : (
        <X className="size-3.5" strokeWidth={2.5} aria-hidden />
      )}
    </span>
  );
}
