"use client";

import {
  MoreHorizontal,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
} from "lucide-react";
import { usePlayer } from "@/components/player-provider";
import { formatDuration } from "@/lib/utils";

export function NowPlayingBar() {
  const {
    track,
    playing,
    progress,
    duration,
    toggle,
    seek,
    next,
    prev,
  } = usePlayer();

  if (!track) return null;

  const pct = duration ? (progress / duration) * 100 : 0;

  return (
    <div className="shrink-0 border-t border-border bg-background/95 px-5 py-3 backdrop-blur">
      <div className="flex items-center gap-4">
        <div className="hidden min-w-0 flex-1 sm:block">
          <div className="truncate text-sm font-medium text-foreground">
            {track.title}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {track.artist}
          </div>
        </div>

        <div className="flex flex-[1.4] flex-col items-center gap-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={prev}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Previous"
            >
              <SkipBack className="size-4" />
            </button>
            <button
              type="button"
              onClick={toggle}
              className="flex size-9 items-center justify-center rounded-full border border-border bg-transparent text-foreground transition-colors hover:bg-foreground hover:text-background"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <Pause className="size-4" fill="currentColor" />
              ) : (
                <Play className="size-4" fill="currentColor" />
              )}
            </button>
            <button
              type="button"
              onClick={next}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Next"
            >
              <SkipForward className="size-4" />
            </button>
          </div>
          <div className="flex w-full max-w-xl items-center gap-2">
            <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">
              {formatDuration(progress)}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={pct}
              onChange={(e) => seek(Number(e.target.value) / 100)}
              aria-label="Seek"
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-foreground"
            />
            <span className="w-8 text-[11px] tabular-nums text-muted-foreground">
              {formatDuration(duration)}
            </span>
          </div>
        </div>

        <div className="hidden flex-1 items-center justify-end gap-3 md:flex">
          <Shuffle className="size-3.5 text-muted-foreground" />
          <Repeat className="size-3.5 text-muted-foreground" />
          <div className="flex items-center gap-2">
            <Volume2 className="size-3.5 text-muted-foreground" />
            <div className="h-1 w-20 overflow-hidden rounded-full bg-border">
              <div className="h-full w-2/3 rounded-full bg-foreground" />
            </div>
          </div>
          <MoreHorizontal className="size-4 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}
