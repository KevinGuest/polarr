"use client";

import { MonitorSpeaker } from "lucide-react";
import { usePlayer } from "@/components/player-provider";
import { cn } from "@/lib/utils";

export function ConnectPlaybackBar({
  className,
  compact = false,
  edge = false,
}: {
  className?: string;
  compact?: boolean;
  /** Extend the status surface into the home-indicator inset. */
  edge?: boolean;
}) {
  const { isRemotePlayback, activeConnectDevice, togglePanel } = usePlayer();
  if (!isRemotePlayback || !activeConnectDevice) return null;

  return (
    <button
      type="button"
      onClick={() => togglePanel("devices")}
      className={cn(
        "flex w-full items-center justify-center gap-2 border-t border-border/60 bg-muted text-foreground",
        compact ? "min-h-7 py-1.5 text-[11px]" : "min-h-8 py-2 text-xs",
        edge && "pb-[max(0.5rem,var(--safe-bottom))]",
        className,
      )}
    >
      <MonitorSpeaker className={compact ? "size-3.5" : "size-4"} />
      <span className="font-semibold tracking-tight">
        Playing on {activeConnectDevice.name}
      </span>
    </button>
  );
}
