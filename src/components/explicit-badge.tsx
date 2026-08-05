import { cn } from "@/lib/utils";

/** Spotify-style explicit marker shown before the artist on track rows. */
export function ExplicitBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[15px] min-w-[15px] shrink-0 items-center justify-center rounded-[2px] bg-muted-foreground/75 px-[3px] text-[9px] font-bold leading-none tracking-tight text-background",
        className,
      )}
      title="Explicit"
      aria-label="Explicit"
    >
      E
    </span>
  );
}
