import { Loader2, Play } from "lucide-react";
import { cn } from "@/lib/utils";

/** Track # that swaps to a play triangle on the current row (and on hover). */
export function TrackRowIndex({
  n,
  isCurrent,
  busy,
}: {
  n: number;
  isCurrent: boolean;
  busy?: boolean;
}) {
  if (busy) {
    return <Loader2 className="size-3.5 animate-spin" />;
  }
  return (
    <span className="relative flex size-4 items-center justify-center">
      <span
        className={cn(
          "tabular-nums group-hover/row:opacity-0",
          isCurrent && "opacity-0",
        )}
      >
        {n}
      </span>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center",
          isCurrent
            ? "opacity-100"
            : "opacity-0 group-hover/row:opacity-100",
        )}
      >
        <Play className="size-3.5" fill="currentColor" />
      </span>
    </span>
  );
}
