import { cn } from "@/lib/utils";

/** Spotify-style mini equalizer — no play counts shown. */
export function PopularityIndicator({
  score,
  className,
}: {
  /** 0–100 relative popularity */
  score: number;
  className?: string;
}) {
  const level = Math.min(4, Math.max(1, Math.ceil((score / 100) * 4)));
  const heights = ["h-[3px]", "h-[5px]", "h-[7px]", "h-[9px]"];

  return (
    <div
      className={cn("flex items-end gap-[2px]", className)}
      aria-label={`Popularity ${level} of 4`}
      title="Popularity"
    >
      {heights.map((h, i) => (
        <span
          key={i}
          className={cn(
            "w-[3px] rounded-full",
            h,
            i < level ? "bg-foreground/75" : "bg-muted-foreground/25",
          )}
        />
      ))}
    </div>
  );
}
