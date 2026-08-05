"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  Maximize2,
  Mic2,
  MonitorSpeaker,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { ExplicitBadge } from "@/components/explicit-badge";
import { TrackLikeButton } from "@/components/track-like-button";
import { TrackContextMenu } from "@/components/track-context-menu";
import { usePlayer } from "@/components/player-provider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, formatDuration, formatTrackArtistLine } from "@/lib/utils";

function BarTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export function NowPlayingBar() {
  const {
    track,
    playing,
    progress,
    duration,
    volume,
    isPanelOpen,
    toggle,
    seek,
    next,
    prev,
    setVolume,
    togglePanel,
  } = usePlayer();
  const [downloaded, setDownloaded] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!track?.id) {
      setDownloaded(false);
      setCoverUrl(null);
      return;
    }

    const fromTrack =
      track.coverPath && /^https?:\/\//i.test(track.coverPath)
        ? track.coverPath
        : null;
    setCoverUrl(fromTrack);

    if (track.id.startsWith("live:")) {
      setDownloaded(false);
      return;
    }

    // Local/server tracks are in the library; live streams are not
    setDownloaded(true);

    let cancelled = false;
    void fetch(`/api/tracks/${encodeURIComponent(track.id)}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (cancelled || !data?.track) return;
        const cover = data.track.coverUrl || data.track.coverPath;
        if (cover && /^https?:\/\//i.test(cover)) {
          setCoverUrl(cover);
        }
      })
      .catch(() => null);

    return () => {
      cancelled = true;
    };
  }, [track?.id, track?.coverPath]);

  if (!track) return null;

  const pct = duration ? (progress / duration) * 100 : 0;
  const VolumeIcon =
    volume === 0 ? VolumeX : volume < 0.45 ? Volume1 : Volume2;
  const muteLabel = volume === 0 ? "Unmute" : "Mute";
  const playLabel = playing ? "Pause" : "Play";

  return (
    <TooltipProvider delayDuration={300}>
      <div className="shrink-0 border-t border-border bg-background px-3 py-2.5 md:px-4">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,42%)_minmax(0,1fr)] items-center gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <TrackContextMenu track={track}>
              <button
                type="button"
                onClick={() => togglePanel("nowPlaying")}
                className="flex min-w-0 items-center gap-3 text-left"
                aria-label="Open now playing"
              >
                <CoverArt
                  seed={track.album || track.title}
                  image={coverUrl || undefined}
                  className="size-12 shrink-0 rounded-md"
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {track.title}
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    {track.explicit ? <ExplicitBadge /> : null}
                    <span className="truncate">
                      {formatTrackArtistLine(track.artist, track.title)}
                    </span>
                  </div>
                </div>
              </button>
            </TrackContextMenu>
            {downloaded ? (
              <BarTooltip label="In library">
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background"
                  aria-label="In library"
                >
                  <Check className="size-3" strokeWidth={3} />
                </span>
              </BarTooltip>
            ) : null}
          </div>

          <div className="flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-4">
              <BarTooltip label="Shuffle">
                <button
                  type="button"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Shuffle"
                >
                  <Shuffle className="size-3.5" />
                </button>
              </BarTooltip>
              <BarTooltip label="Previous">
                <button
                  type="button"
                  onClick={prev}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Previous"
                >
                  <SkipBack className="size-4" fill="currentColor" />
                </button>
              </BarTooltip>
              <BarTooltip label={playLabel}>
                <button
                  type="button"
                  onClick={toggle}
                  className="flex size-8 items-center justify-center rounded-full bg-foreground text-background transition-transform hover:scale-105"
                  aria-label={playLabel}
                >
                  {playing ? (
                    <Pause className="size-3.5" fill="currentColor" />
                  ) : (
                    <Play
                      className="size-3.5 translate-x-px"
                      fill="currentColor"
                    />
                  )}
                </button>
              </BarTooltip>
              <BarTooltip label="Next">
                <button
                  type="button"
                  onClick={next}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Next"
                >
                  <SkipForward className="size-4" fill="currentColor" />
                </button>
              </BarTooltip>
              <BarTooltip label="Repeat">
                <button
                  type="button"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Repeat"
                >
                  <Repeat className="size-3.5" />
                </button>
              </BarTooltip>
            </div>
            <div className="flex w-full items-center gap-2">
              <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
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
                className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-foreground"
              />
              <span className="w-9 text-[11px] tabular-nums text-muted-foreground">
                {formatDuration(duration)}
              </span>
            </div>
          </div>

          <div className="hidden items-center justify-end gap-1 sm:flex">
            <BarTooltip label="Save to Liked Songs">
              <span className="inline-flex">
                <TrackLikeButton
                  key={track.id}
                  trackId={track.id}
                  artist={track.artist}
                  title={track.title}
                  album={track.album}
                  coverPath={track.coverPath}
                />
              </span>
            </BarTooltip>
            <BarTooltip label="Lyrics">
              <button
                type="button"
                onClick={() => togglePanel("lyrics")}
                className={cn(
                  "rounded p-1.5 transition-colors",
                  isPanelOpen("lyrics")
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-label="Lyrics"
                aria-pressed={isPanelOpen("lyrics")}
              >
                <Mic2 className="size-3.5" />
              </button>
            </BarTooltip>
            <BarTooltip label="Connect to a device">
              <button
                type="button"
                onClick={() => togglePanel("devices")}
                className={cn(
                  "rounded p-1.5 transition-colors",
                  isPanelOpen("devices")
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-label="Connect to a device"
                aria-pressed={isPanelOpen("devices")}
              >
                <MonitorSpeaker className="size-3.5" />
              </button>
            </BarTooltip>
            <div className="flex items-center gap-2 pl-0.5">
              <BarTooltip label={muteLabel}>
                <button
                  type="button"
                  aria-label={muteLabel}
                  onClick={() => setVolume(volume === 0 ? 0.8 : 0)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <VolumeIcon className="size-3.5" />
                </button>
              </BarTooltip>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(volume * 100)}
                onChange={(e) => setVolume(Number(e.target.value) / 100)}
                aria-label="Volume"
                className="h-1 w-[93px] cursor-pointer appearance-none rounded-full bg-muted accent-foreground"
              />
            </div>
            <BarTooltip label="Open Miniplayer">
              <button
                type="button"
                onClick={() => togglePanel("nowPlaying")}
                className={cn(
                  "rounded p-1.5 transition-colors",
                  isPanelOpen("nowPlaying")
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-label="Open now playing"
                aria-pressed={isPanelOpen("nowPlaying")}
              >
                <PictureInPicture2 className="size-3.5" />
              </button>
            </BarTooltip>
            <BarTooltip label="Fullscreen">
              <button
                type="button"
                onClick={() => togglePanel("nowPlaying")}
                className={cn(
                  "rounded p-1.5 transition-colors",
                  isPanelOpen("nowPlaying")
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-label="Fullscreen now playing"
              >
                <Maximize2 className="size-3.5" />
              </button>
            </BarTooltip>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
