import { cn } from "@/lib/utils";

/**
 * Spotify-style “media flow” bars for the currently playing row.
 * Static stub when paused on that track; animates while audio is playing.
 */
export function NowPlayingBars({
  playing = true,
  className,
}: {
  playing?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-3.5 w-3.5 shrink-0 items-end justify-center gap-[2px]",
        className,
      )}
      aria-hidden
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            "w-[3px] rounded-full bg-current",
            playing ? "now-playing-bar" : "h-1",
          )}
          style={
            playing
              ? { animationDelay: `${i * 0.18}s` }
              : undefined
          }
        />
      ))}
    </span>
  );
}
