import { Loader2, Play } from "lucide-react";
import { NowPlayingBars } from "@/components/now-playing-bars";
import { cn } from "@/lib/utils";

/** Track # that swaps to playing bars / play triangle on the current row. */
export function TrackRowIndex({
  n,
  isCurrent,
  playing,
  busy,
}: {
  n: number;
  isCurrent: boolean;
  /** When current + playing, show animated bars instead of a static play icon. */
  playing?: boolean;
  busy?: boolean;
}) {
  if (busy) {
    return <Loader2 className="size-3.5 animate-spin" />;
  }
  if (isCurrent) {
    return (
      <span
        className={cn(
          "relative flex size-4 items-center justify-center",
          playing ? "text-primary" : "text-primary/80",
        )}
      >
        <NowPlayingBars playing={Boolean(playing)} />
      </span>
    );
  }
  return (
    <span className="relative flex size-4 items-center justify-center">
      <span className="tabular-nums group-hover/row:opacity-0">{n}</span>
      <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/row:opacity-100">
        <Play className="size-3.5" fill="currentColor" />
      </span>
    </span>
  );
}
