"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Maximize2,
  ListMusic,
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
import { MiniplayerClient } from "@/components/miniplayer-client";
import { PlayerSlider } from "@/components/player-slider";
import { ConnectPlaybackBar } from "@/components/connect-playback-bar";
import { MobileSaveButton } from "@/components/saved-in-drawer";
import { StreamQualityBadge } from "@/components/stream-quality-badge";
import { TrackContextMenu } from "@/components/track-context-menu";
import { playbackQuality, usePlayer } from "@/components/player-provider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { albumHref } from "@/lib/album-ref";
import {
  copyDocumentStyles,
  ensurePipMount,
  getDocumentPipWindow,
  openDocumentPip,
  type DocumentPipWindow,
} from "@/lib/document-pip";
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
    shuffle,
    isPanelOpen,
    isRemotePlayback,
    toggle,
    seek,
    next,
    prev,
    setVolume,
    toggleShuffle,
    togglePanel,
  } = usePlayer();
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [pipMount, setPipMount] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Reattach if a PiP window was already open (HMR / remount).
    const existing = getDocumentPipWindow();
    if (!existing) return;
    const mount = ensurePipMount(existing);
    setPipMount(mount);
    const onClose = () => setPipMount(null);
    existing.addEventListener("pagehide", onClose);
    return () => existing.removeEventListener("pagehide", onClose);
  }, []);

  const openMiniplayer = useCallback(async () => {
    const w = 360;
    const h = 560;

    const attachToWindow = (pip: Window) => {
      if (!pip.document.getElementById("polarr-miniplayer-root")) {
        copyDocumentStyles(document, pip.document);
      }
      const mount = ensurePipMount(pip as DocumentPipWindow);
      setPipMount(mount);
      const onClose = () => setPipMount(null);
      pip.addEventListener("pagehide", onClose, { once: true });
      try {
        pip.focus();
      } catch {
        /* ignore */
      }
    };

    // Prefer Document PiP (always-on-top). Same React tree → audio uninterrupted.
    try {
      const pip = await openDocumentPip({ width: w, height: h });
      if (pip) {
        attachToWindow(pip);
        return;
      }
    } catch {
      /* fall through */
    }

    // Same-document popup (about:blank + styles), not /miniplayer — still one
    // player instance. Avoids the pause/reload handoff of a second Next.js tab.
    const left = Math.max(0, window.screenX + window.outerWidth - w - 24);
    const top = Math.max(0, window.screenY + 48);
    const features = [
      "popup=yes",
      `width=${w}`,
      `height=${h}`,
      `left=${left}`,
      `top=${top}`,
      "resizable=yes",
      "scrollbars=no",
    ].join(",");
    const win = window.open("about:blank", "polarr-miniplayer", features);
    if (win) {
      attachToWindow(win);
    }
  }, []);

  useEffect(() => {
    if (!track?.id) {
      setCoverUrl(null);
      return;
    }

    const fromTrack =
      track.coverPath && /^https?:\/\//i.test(track.coverPath)
        ? track.coverPath
        : null;
    setCoverUrl(fromTrack);

    if (track.id.startsWith("live:") || track.id.startsWith("stream:")) {
      return;
    }

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

  if (!track) {
    return pipMount
      ? createPortal(<MiniplayerClient sameDocument />, pipMount)
      : null;
  }

  const VolumeIcon =
    volume === 0 ? VolumeX : volume < 0.45 ? Volume1 : Volume2;
  const muteLabel = volume === 0 ? "Unmute" : "Mute";
  const playLabel = playing ? "Pause" : "Play";
  const albumPath = albumHref({
    title: (track.album || track.title).trim() || track.title,
    artist: track.artist,
  });

  return (
    <>
    <TooltipProvider delayDuration={300}>
      <div className="hidden shrink-0 border-t border-border bg-background lg:block">
        {/* Desktop bar */}
        <div className="px-3 py-2.5 md:px-4">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,42%)_minmax(0,1fr)] items-center gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <TrackContextMenu track={track}>
              <Link
                href={albumPath}
                className="flex min-w-0 items-center gap-3 text-left transition-opacity hover:opacity-90"
                aria-label={`Open album ${track.album || track.title}`}
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
              </Link>
            </TrackContextMenu>
            <BarTooltip
              label={
                playbackQuality(track) === "youtube"
                  ? "Playing via Youtube"
                  : "Playing from Polarr library"
              }
            >
              <span className="shrink-0">
                <StreamQualityBadge track={track} />
              </span>
            </BarTooltip>
          </div>

          <div className="flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-4">
              <BarTooltip label="Shuffle">
                <button
                  type="button"
                  onClick={toggleShuffle}
                  className={cn(
                    "transition-colors",
                    shuffle
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-label="Shuffle"
                  aria-pressed={shuffle}
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
              <PlayerSlider
                value={duration ? progress / duration : 0}
                onChange={seek}
                aria-label="Seek"
                variant="progress"
                tone="default"
                className="-my-3 flex-1"
              />
              <span className="w-9 text-[11px] tabular-nums text-muted-foreground">
                {formatDuration(duration)}
              </span>
            </div>
          </div>

          <div className="hidden items-center justify-end gap-1 lg:flex">
            <BarTooltip label="Add to playlist">
              <span className="inline-flex">
                <MobileSaveButton
                  trackId={track.id}
                  artist={track.artist}
                  title={track.title}
                  album={track.album}
                  coverPath={track.coverPath}
                  duration={track.duration ?? undefined}
                  size="sm"
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
                  isRemotePlayback || isPanelOpen("devices")
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-label="Connect to a device"
                aria-pressed={isPanelOpen("devices")}
              >
                <MonitorSpeaker className="size-3.5" />
              </button>
            </BarTooltip>
            <BarTooltip
              label={
                isPanelOpen("queue")
                  ? "Hide queue and recently played"
                  : "Show queue and recently played"
              }
            >
              <button
                type="button"
                onClick={() => togglePanel("queue")}
                className={cn(
                  "rounded p-1.5 transition-colors",
                  isPanelOpen("queue")
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-label={
                  isPanelOpen("queue")
                    ? "Hide queue and recently played"
                    : "Show queue and recently played"
                }
                aria-pressed={isPanelOpen("queue")}
              >
                <ListMusic className="size-3.5" />
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
              <PlayerSlider
                value={volume}
                onChange={setVolume}
                aria-label="Volume"
                variant="volume"
                tone="default"
                className="-my-2 w-[93px]"
              />
            </div>
            <BarTooltip label="Open Miniplayer">
              <button
                type="button"
                onClick={() => {
                  void openMiniplayer();
                }}
                className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Open miniplayer window"
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
        <ConnectPlaybackBar />
      </div>
    </TooltipProvider>
    {pipMount
      ? createPortal(<MiniplayerClient sameDocument />, pipMount)
      : null}
    </>
  );
}
