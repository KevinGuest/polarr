"use client";

import { toastInfo } from "@/lib/toast";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { PlayerGlassBackdrop } from "@/components/player-glass-backdrop";
import { PlayerSlider } from "@/components/player-slider";
import { TrackActionsDrawer } from "@/components/track-actions-drawer";
import {
  Laptop,
  ListMusic,
  MessageSquareQuote,
  Mic2,
  MonitorSpeaker,
  Music2,
  Pause,
  Play,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  Wifi,
  X,
} from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { ExplicitBadge } from "@/components/explicit-badge";
import { StreamQualityBadge } from "@/components/stream-quality-badge";
import { TrackContextMenu } from "@/components/track-context-menu";
import { TrackLikeButton } from "@/components/track-like-button";
import { usePlayer, type PlayerTrack } from "@/components/player-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { albumHref } from "@/lib/album-ref";
import { getDragTrack, POLARR_TRACK_MIME } from "@/lib/drag-track";
import {
  assignLyricSides,
  duoArtists,
  isDualLyricLayout,
} from "@/lib/lyrics/lyric-sides";
import { LISTEN_CREDITED_EVENT } from "@/lib/ui-events";
import { cn, formatDuration } from "@/lib/utils";
import { KaraokeLyricLine } from "@/components/karaoke-lyric-line";
import { useKaraokeSession } from "@/components/use-karaoke-session";

function formatRemaining(progress: number, duration: number): string {
  const rem = Math.max(0, duration - progress);
  return `-${formatDuration(rem)}`;
}

function subscribeLg(onChange: () => void) {
  const mq = window.matchMedia("(min-width: 1024px)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function getLgSnapshot() {
  return window.matchMedia("(min-width: 1024px)").matches;
}
function getLgServerSnapshot() {
  return true;
}
function useIsLg() {
  return useSyncExternalStore(subscribeLg, getLgSnapshot, getLgServerSnapshot);
}

function LyricsBody({
  open,
  compact,
}: {
  open: boolean;
  compact?: boolean;
}) {
  const {
    track,
    playing,
    progress,
    duration,
    seek,
    vocalLevel,
    setVocalLevel,
    karaokeStatus,
    karaokeProgress,
    karaokeError,
    karaokeEligible,
  } = usePlayer();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  const session = useKaraokeSession({
    open,
    artist: track?.artist,
    title: track?.title,
    album: track?.album,
    mediaDurationSec: duration > 0 ? duration : undefined,
    progressSec: progress,
  });

  useEffect(() => {
    const scroller = scrollerRef.current;
    const active = activeRef.current;
    if (!scroller || !active || !session.synced) return;
    const topPin = compact ? 48 : 80;
    scroller.scrollTo({
      top: Math.max(0, active.offsetTop - topPin),
      behavior: "smooth",
    });
  }, [session.activeIndex, session.synced, compact]);

  const sidedLines = useMemo(
    () =>
      assignLyricSides(
        session.lines,
        track?.artist || "",
        track?.title || "",
      ),
    [session.lines, track?.artist, track?.title],
  );
  const dual = isDualLyricLayout(sidedLines);
  const duo = useMemo(
    () => (track ? duoArtists(track.artist, track.title) : null),
    [track],
  );

  if (!open || !track) return null;

  const canSeek = session.synced && duration > 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollerRef}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
          compact
            ? "px-5 pb-8 pt-2"
            : "px-8 pb-[70vh] pt-20 md:px-16 lg:px-24",
        )}
      >
        {session.status === "loading" && (
          <p className="text-lg font-bold text-white/50">Loading lyrics…</p>
        )}
        {session.status === "error" && (
          <p className="text-lg font-bold text-white/50">
            {session.error || "Couldn’t load lyrics right now."}
          </p>
        )}
        {session.status === "empty" && (
          <p className="text-lg font-bold text-white/50">
            {session.instrumental
              ? "This track is instrumental."
              : "No lyrics found for this track."}
          </p>
        )}
        {session.status === "ready" && dual && duo ? (
          <div className="mb-4 flex items-baseline justify-between gap-4 px-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
            <span className="min-w-0 truncate">{duo.left}</span>
            <span className="min-w-0 truncate text-right">{duo.right}</span>
          </div>
        ) : null}
        {session.status === "ready" &&
          sidedLines.map((line, i) => {
            const active = session.synced && i === session.activeIndex;
            const near =
              session.synced && Math.abs(i - session.activeIndex) <= 1;
            const isGap = line.text === "♪" || line.text === "♫";
            const renderLine = { ...line, text: line.displayText };

            return (
              <button
                key={`${line.time}-${i}-${line.text.slice(0, 12)}`}
                type="button"
                ref={active ? activeRef : undefined}
                disabled={!canSeek}
                onClick={() => {
                  if (!canSeek) return;
                  const t = session.seekSecForLine(line);
                  seek(Math.min(1, Math.max(0, t / duration)));
                }}
                className={cn(
                  "block w-full max-w-3xl py-3 leading-snug tracking-tight transition-[color,filter,font-size,opacity] duration-300",
                  dual && line.side === "left" && "mr-auto text-left",
                  dual && line.side === "right" && "ml-auto text-right",
                  dual && line.side === "center" && "mx-auto text-center",
                  !dual && "text-left",
                  canSeek && "cursor-pointer hover:text-white hover:blur-none",
                  !canSeek && "cursor-default",
                  !session.synced &&
                    "text-2xl font-semibold text-white/75 md:text-3xl",
                  session.synced &&
                    active &&
                    "relative z-[1] text-3xl font-bold text-white blur-none md:text-4xl",
                  session.synced &&
                    !active &&
                    i < session.activeIndex &&
                    "text-2xl font-semibold text-white/32 blur-[2px] md:text-3xl",
                  session.synced &&
                    near &&
                    !active &&
                    i > session.activeIndex &&
                    "text-2xl font-semibold text-white/42 blur-[1.5px] md:text-3xl",
                  session.synced &&
                    !near &&
                    !active &&
                    i > session.activeIndex &&
                    "text-2xl font-semibold text-white/20 blur-[2.5px] md:text-3xl",
                  isGap && "tracking-widest",
                  dual && line.side !== "center" && "max-w-[88%]",
                )}
              >
                {active ? (
                  <KaraokeLyricLine
                    line={renderLine}
                    lines={session.lines}
                    index={i}
                    clockSec={session.clockSec}
                    playing={playing}
                  />
                ) : (
                  line.displayText
                )}
              </button>
            );
          })}
        {session.status === "ready" && session.quality === "plain" && (
          <p className="mt-10 max-w-md text-sm font-medium text-white/35">
            Unsynced lyrics — timing isn’t mapped to this audio.
          </p>
        )}
      </div>

      {karaokeEligible ? (
      <div
        className={cn(
          "absolute right-5 z-20 flex flex-col items-center gap-2 rounded-full bg-black/45 px-2.5 py-3.5 ring-1 ring-white/12 backdrop-blur-md",
          compact ? "bottom-3" : "bottom-8",
        )}
      >
        <button
          type="button"
          aria-label="Full original mix"
          onClick={() => setVocalLevel(1)}
          className={cn(
            "shrink-0 transition-colors",
            vocalLevel > 0.85
              ? "text-white"
              : "text-white/40 hover:text-white/75",
          )}
        >
          <Mic2 className="size-4" />
        </button>
        <SliderPrimitive.Root
          orientation="vertical"
          value={[Math.round(vocalLevel * 100)]}
          onValueChange={(vals) => {
            const next = vals[0];
            if (typeof next === "number") setVocalLevel(next / 100);
          }}
          max={100}
          step={1}
          aria-label="Vocals vs instrumental"
          className="relative flex h-36 w-6 touch-none select-none flex-col items-center data-[orientation=vertical]:h-36"
        >
          <SliderPrimitive.Track className="relative w-1 grow overflow-hidden rounded-full bg-white/25 data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1">
            <SliderPrimitive.Range className="absolute bg-white data-[orientation=vertical]:w-full" />
          </SliderPrimitive.Track>
          <SliderPrimitive.Thumb className="block size-3.5 rounded-full bg-white shadow-md ring-0 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 active:scale-105" />
        </SliderPrimitive.Root>
        <button
          type="button"
          aria-label="Instrumental only"
          onClick={() => setVocalLevel(0)}
          className={cn(
            "shrink-0 transition-colors",
            vocalLevel < 0.15
              ? "text-white"
              : "text-white/40 hover:text-white/75",
            karaokeStatus === "processing" || karaokeStatus === "queued"
              ? "animate-pulse"
              : "",
          )}
        >
          <Music2 className="size-4" />
        </button>
        {(karaokeStatus === "processing" || karaokeStatus === "queued") && (
          <span className="mt-0.5 max-w-[4.5rem] text-center text-[9px] leading-tight text-white/50">
            {Math.round((karaokeProgress || 0) * 100)}%
          </span>
        )}
        {karaokeStatus === "error" && karaokeError && (
          <span
            className="mt-0.5 max-w-[4.5rem] text-center text-[9px] leading-tight text-red-300/80"
            title={karaokeError}
          >
            fail
          </span>
        )}
        {karaokeStatus === "unavailable" && (
          <span
            className="mt-0.5 max-w-[4.5rem] text-center text-[9px] leading-tight text-white/40"
            title={karaokeError ?? "Unavailable"}
          >
            n/a
          </span>
        )}
      </div>
      ) : null}
    </div>
  );
}

function LyricsPanel() {
  const { track, isPanelOpen, closePanel } = usePlayer();
  const lyricsOpen = isPanelOpen("lyrics");
  if (!lyricsOpen || !track) return null;

  const cover =
    track.coverPath && /^https?:\/\//i.test(track.coverPath)
      ? track.coverPath
      : undefined;

  return (
    <div className="pointer-events-auto absolute inset-0 z-20 flex flex-col overflow-hidden">
      <PlayerGlassBackdrop
        image={cover}
        seed={`${track.id}:${track.artist}:${track.title}`}
      />
      <button
        type="button"
        aria-label="Close lyrics"
        onClick={() => closePanel("lyrics")}
        className="absolute right-5 top-5 z-10 rounded-md p-2 text-white/55 transition-colors hover:text-white"
      >
        <X className="size-5" />
      </button>
      <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
        <LyricsBody open={lyricsOpen} />
      </div>
    </div>
  );
}

function ConnectBody() {
  return (
    <div className="px-4 pb-6">
      <div className="flex items-center gap-3 rounded-xl bg-muted/50 px-4 py-3.5">
        <Laptop className="size-5 shrink-0 text-foreground" />
        <div className="min-w-0 text-sm font-semibold text-foreground">
          This web browser
        </div>
      </div>

      <h3 className="mt-6 text-sm font-semibold">No other devices found</h3>

      <ul className="mt-4 space-y-4">
        <li className="flex gap-3">
          <Wifi className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">Check your WiFi</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Connect the devices you’re using to the same WiFi.
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <MonitorSpeaker className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">Play from another device</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Open Polarr in another browser on this network — it’ll show up
              here.
            </p>
          </div>
        </li>
      </ul>
    </div>
  );
}

function DevicesPanel() {
  const { isPanelOpen, closePanel } = usePlayer();
  if (!isPanelOpen("devices")) return null;

  return (
    <div className="pointer-events-auto absolute inset-y-0 right-0 z-30 flex w-full max-w-sm flex-col border-l border-border bg-background shadow-xl md:w-96 md:max-w-none">
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <h2 className="text-base font-semibold tracking-tight">Connect</h2>
        <button
          type="button"
          aria-label="Close connect"
          onClick={() => closePanel("devices")}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <ConnectBody />
      </ScrollArea>
    </div>
  );
}

function NowPlayingPopup() {
  const {
    track,
    playing,
    progress,
    duration,
    isPanelOpen,
    closePanel,
    toggle,
    seek,
    next,
    prev,
    togglePanel,
  } = usePlayer();

  if (!isPanelOpen("nowPlaying") || !track) return null;

  const albumPath = albumHref({
    title: (track.album || track.title).trim() || track.title,
    artist: track.artist,
  });

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex flex-col bg-background">
      <div className="flex items-center justify-between px-6 py-4">
        <button
          type="button"
          aria-label="Close now playing"
          onClick={() => closePanel("nowPlaying")}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-5" />
        </button>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Now playing
        </p>
        <span className="size-9" aria-hidden />
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-8 pb-10">
        <TrackContextMenu track={track}>
          <Link
            href={albumPath}
            onClick={() => closePanel("nowPlaying")}
            className="flex w-full max-w-sm flex-col items-center gap-8 transition-opacity hover:opacity-90 md:max-w-md"
            aria-label={`Open album ${track.album || track.title}`}
          >
            <CoverArt
              seed={track.album || track.title}
              image={
                track.coverPath && /^https?:\/\//i.test(track.coverPath)
                  ? track.coverPath
                  : undefined
              }
              className="aspect-square w-full max-w-[min(100%,24rem)] rounded-lg shadow-lg"
            />
            <div className="flex w-full items-center justify-center gap-2 text-center">
              <div className="min-w-0 space-y-1">
                <div className="truncate text-2xl font-bold">{track.title}</div>
                <div className="flex min-w-0 items-center justify-center gap-1.5 text-sm text-muted-foreground">
                  {track.explicit ? <ExplicitBadge /> : null}
                  <span className="truncate">
                    {track.artist}
                    {track.album ? ` · ${track.album}` : ""}
                  </span>
                </div>
              </div>
              <StreamQualityBadge track={track} />
            </div>
          </Link>
        </TrackContextMenu>
        <div className="w-full max-w-md space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
              {formatDuration(progress)}
            </span>
            <PlayerSlider
              value={duration ? progress / duration : 0}
              onChange={(ratio) => seek(ratio)}
              aria-label="Seek"
              variant="progress"
              tone="default"
              className="-my-3 flex-1"
            />
            <span className="w-10 text-[11px] tabular-nums text-muted-foreground">
              {formatDuration(duration)}
            </span>
          </div>
          <div className="flex items-center justify-center gap-8">
            <button
              type="button"
              onClick={prev}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Previous"
            >
              <SkipBack className="size-7" fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={toggle}
              className="flex size-14 items-center justify-center rounded-full bg-foreground text-background"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <Pause className="size-6" fill="currentColor" />
              ) : (
                <Play className="size-6 translate-x-px" fill="currentColor" />
              )}
            </button>
            <button
              type="button"
              onClick={next}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Next"
            >
              <SkipForward className="size-7" fill="currentColor" />
            </button>
          </div>
          <div className="flex items-center justify-between px-2">
            <TrackLikeButton
              key={track.id}
              trackId={track.id}
              artist={track.artist}
              title={track.title}
              album={track.album}
              coverPath={track.coverPath}
            />
            <button
              type="button"
              onClick={() => togglePanel("lyrics")}
              className={cn(
                "rounded-md p-2 transition-colors",
                isPanelOpen("lyrics")
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-label="Lyrics"
              aria-pressed={isPanelOpen("lyrics")}
            >
              <Mic2 className="size-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function QueuePanel({ variant = "rail" }: { variant?: "rail" | "sheet" }) {
  const {
    track,
    queue,
    play,
    playQueueIndex,
    removeFromQueue,
    addToQueue,
    queueTab,
    setQueueTab,
    shuffle,
    toggleShuffle,
  } = usePlayer();
  const [recent, setRecent] = useState<
    (PlayerTrack & { playedAt: string; liked?: boolean })[]
  >([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (queueTab !== "recent") return;
    let cancelled = false;

    async function loadRecent() {
      setRecentLoading(true);
      try {
        const res = await fetch("/api/recent?limit=100", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setRecent(Array.isArray(data.items) ? data.items : []);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    }

    void loadRecent();
    const onListen = () => {
      void loadRecent();
    };
    window.addEventListener(LISTEN_CREDITED_EVENT, onListen);
    return () => {
      cancelled = true;
      window.removeEventListener(LISTEN_CREDITED_EVENT, onListen);
    };
  }, [queueTab, track?.id]);

  const currentIdx = track ? queue.findIndex((t) => t.id === track.id) : -1;
  const upcoming = queue
    .map((t, i) => ({ t, i }))
    .filter(({ i }) => i > currentIdx);
  // Only label "Next from: Album" when every upcoming track shares that album
  const nextFrom = (() => {
    if (upcoming.length === 0) return null;
    const albums = upcoming
      .map(({ t }) => t.album?.trim())
      .filter((a): a is string => Boolean(a));
    if (albums.length === 0 || albums.length !== upcoming.length) return null;
    const first = albums[0];
    return albums.every((a) => a === first) ? first : null;
  })();

  function playRecentItem(
    item: PlayerTrack & { playedAt: string; liked?: boolean },
  ) {
    play(
      item,
      recent.map((r) => ({
        id: r.id,
        title: r.title,
        artist: r.artist,
        album: r.album,
        coverPath: r.coverPath,
        explicit: r.explicit,
      })),
    );
  }

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col",
        variant === "rail" &&
          "w-80 shrink-0 border-l border-border bg-background lg:w-96",
        variant === "sheet" && "w-full bg-transparent",
        dragOver && "ring-2 ring-inset ring-foreground/30",
      )}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes(POLARR_TRACK_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const dropped = getDragTrack(e);
        if (!dropped) return;
        addToQueue(dropped);
        toastInfo("Queue updated", { description: "Cleared upcoming tracks" });
      }}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 px-4 py-3",
          variant === "sheet" && "flex-wrap gap-2 px-3 py-2",
        )}
      >
        {variant === "sheet" ? (
          <button
            type="button"
            onClick={toggleShuffle}
            aria-label="Shuffle"
            aria-pressed={shuffle}
            className={cn(
              "flex size-11 items-center justify-center rounded-full transition-colors",
              shuffle
                ? "bg-foreground/15 text-foreground"
                : "bg-muted/60 text-muted-foreground",
            )}
          >
            <Shuffle className="size-4" />
          </button>
        ) : null}
        <div
          className="flex min-w-0 items-center gap-1"
          role="tablist"
          aria-label="Queue views"
        >
          {(
            [
              { id: "queue", label: "Queue" },
              { id: "recent", label: "Recently played" },
            ] as const
          ).map((tab) => {
            const active = queueTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setQueueTab(tab.id)}
                className={cn(
                  "rounded-full px-3 py-1 text-sm transition-colors",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-4">
        {queueTab === "queue" ? (
          <>
            {track && variant === "rail" ? (
              <section className="space-y-2 px-2 pb-4">
                <p className="text-[11px] font-medium text-muted-foreground">
                  Now playing
                </p>
                <TrackContextMenu track={track}>
                  <div className="flex items-center gap-3 rounded-lg px-1 py-1">
                    <CoverArt
                      seed={track.title}
                      image={track.coverPath || undefined}
                      className="size-12 shrink-0 rounded-md"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {track.title}
                      </div>
                      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        {track.explicit ? <ExplicitBadge /> : null}
                        <span className="truncate">
                          {track.artist}
                          {track.album ? ` · ${track.album}` : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                </TrackContextMenu>
              </section>
            ) : !track ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                Nothing playing yet.
              </p>
            ) : null}

            <section className="space-y-1 px-2">
              <p
                className={cn(
                  "px-1 font-medium text-muted-foreground",
                  variant === "sheet"
                    ? "text-base font-bold text-foreground"
                    : "text-[11px]",
                )}
              >
                {variant === "sheet"
                  ? "Continue Playing"
                  : nextFrom
                    ? `Next from: ${nextFrom}`
                    : "Next up"}
              </p>
              {variant === "sheet" && nextFrom ? (
                <p className="px-1 text-xs text-muted-foreground">
                  From {nextFrom}
                </p>
              ) : null}
              {upcoming.length === 0 ? (
                <p className="px-1 py-2 text-sm text-muted-foreground">
                  Queue is empty. Right-click a track to add more.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {upcoming.map(({ t, i }) => (
                    <li key={`${t.id}-${i}`}>
                      <TrackContextMenu track={t}>
                        <div className="group flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-muted/40">
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            onClick={() => playQueueIndex(i)}
                          >
                            <CoverArt
                              seed={t.title}
                              image={t.coverPath || undefined}
                              className="size-11 shrink-0 rounded-md"
                            />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">
                                {t.title}
                              </div>
                              <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                                {t.explicit ? <ExplicitBadge /> : null}
                                <span className="truncate">{t.artist}</span>
                              </div>
                            </div>
                          </button>
                          <button
                            type="button"
                            aria-label="Remove from queue"
                            className={cn(
                              "rounded p-1 text-muted-foreground transition-opacity hover:text-foreground",
                              variant === "sheet"
                                ? "opacity-100"
                                : "opacity-0 group-hover:opacity-100",
                            )}
                            onClick={() => removeFromQueue(t.id)}
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      </TrackContextMenu>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : recentLoading && recent.length === 0 ? (
          <div className="space-y-2 px-2" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-1 py-1.5">
                <Skeleton className="size-11 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
              </div>
            ))}
          </div>
        ) : recent.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            Tracks you listen to for 15+ seconds show up here across sessions.
          </p>
        ) : (
          <ul className="space-y-0.5 px-1">
            {recent.map((item) => {
              const active = track?.id === item.id;
              return (
                <li key={`${item.id}-${item.playedAt}`}>
                  <TrackContextMenu
                    track={item}
                    initialLiked={Boolean(item.liked)}
                  >
                    <div
                      className={cn(
                        "group flex w-full items-center gap-3 rounded-md px-1 py-1.5 transition-colors",
                        active ? "bg-muted/40" : "hover:bg-muted/40",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => playRecentItem(item)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <CoverArt
                          seed={item.title}
                          image={item.coverPath || undefined}
                          className="size-11 shrink-0 rounded-md"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {item.title}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {item.artist}
                            {item.album ? ` · ${item.album}` : ""}
                          </div>
                        </div>
                      </button>
                      <TrackLikeButton
                        trackId={item.id}
                        initialLiked={Boolean(item.liked)}
                        revealOnHover
                        onLikedChange={(liked) => {
                          setRecent((prev) =>
                            prev.map((r) =>
                              r.id === item.id ? { ...r, liked } : r,
                            ),
                          );
                        }}
                      />
                    </div>
                  </TrackContextMenu>
                </li>
              );
            })}
          </ul>
        )}
        </div>
      </ScrollArea>
    </aside>
  );
}

type MobileSheetView = "player" | "lyrics" | "queue" | "devices";

function SheetMoreButton({ track }: { track: PlayerTrack }) {
  return <TrackActionsDrawer track={track} />;
}

function MobileSheetHeader({ track }: { track: PlayerTrack }) {
  const cover =
    track.coverPath && /^https?:\/\//i.test(track.coverPath)
      ? track.coverPath
      : undefined;
  return (
    <div className="flex shrink-0 items-center gap-3 px-4 py-2">
      <CoverArt
        seed={track.album || track.title}
        image={cover}
        className="size-12 shrink-0 rounded-lg shadow-md ring-1 ring-white/15"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-white">
          {track.title}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-sm text-white/65">
          {track.explicit ? <ExplicitBadge /> : null}
          <span className="truncate">{track.artist}</span>
        </div>
      </div>
      <TrackLikeButton
        key={track.id}
        trackId={track.id}
        artist={track.artist}
        title={track.title}
        album={track.album}
        coverPath={track.coverPath}
        size="md"
        className="size-11 text-white"
      />
      <SheetMoreButton track={track} />
    </div>
  );
}

function MobileTransport({
  track,
  playing,
  progress,
  duration,
  volume,
  onSeek,
  onToggle,
  onPrev,
  onNext,
  onVolume,
}: {
  track: PlayerTrack;
  playing: boolean;
  progress: number;
  duration: number;
  volume: number;
  onSeek: (ratio: number) => void;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onVolume: (v: number) => void;
}) {
  return (
    <div className="shrink-0 px-6 pt-2">
          <PlayerSlider
            value={duration ? progress / duration : 0}
            onChange={onSeek}
            aria-label="Seek"
            variant="progress"
            tone="on-dark"
            className="-my-3"
          />
      <div className="mt-1.5 flex items-center justify-between text-[11px] tabular-nums text-white/55">
        <span>{formatDuration(progress)}</span>
        <StreamQualityBadge track={track} className="bg-white/12 text-white/80" />
        <span>{formatRemaining(progress, duration)}</span>
      </div>
      <div className="flex items-center justify-center gap-10 py-3">
        <button
          type="button"
          onClick={onPrev}
          className="flex size-11 items-center justify-center text-white"
          aria-label="Previous"
        >
          <SkipBack className="size-8" fill="currentColor" />
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="flex size-14 items-center justify-center text-white"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? (
            <Pause className="size-10" fill="currentColor" />
          ) : (
            <Play className="size-10 translate-x-0.5" fill="currentColor" />
          )}
        </button>
        <button
          type="button"
          onClick={onNext}
          className="flex size-11 items-center justify-center text-white"
          aria-label="Next"
        >
          <SkipForward className="size-8" fill="currentColor" />
        </button>
      </div>
      <div className="flex min-h-[44px] items-center gap-3 px-1">
        <Volume1 className="size-4 shrink-0 text-white/50" aria-hidden />
        <PlayerSlider
          value={volume}
          onChange={onVolume}
          aria-label="Volume"
          variant="volume"
          tone="on-dark"
          className="-my-2 flex-1"
        />
        <Volume2 className="size-5 shrink-0 text-white/50" aria-hidden />
      </div>
    </div>
  );
}

function MobileTrio({
  view,
  onLyrics,
  onDevices,
  onQueue,
}: {
  view: MobileSheetView;
  onLyrics: () => void;
  onDevices: () => void;
  onQueue: () => void;
}) {
  const items = [
    {
      id: "lyrics" as const,
      label: "Lyrics",
      icon: MessageSquareQuote,
      onClick: onLyrics,
    },
    {
      id: "devices" as const,
      label: "Connect",
      icon: MonitorSpeaker,
      onClick: onDevices,
    },
    {
      id: "queue" as const,
      label: "Queue",
      icon: ListMusic,
      onClick: onQueue,
    },
  ];
  return (
    <div className="flex shrink-0 items-center justify-around px-8 pb-[max(0.75rem,var(--safe-bottom))] pt-1">
      {items.map((item) => {
        const active = view === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={item.onClick}
            aria-label={item.label}
            aria-pressed={active}
            className={cn(
              "flex size-11 items-center justify-center rounded-full transition-colors",
              active
                ? "bg-white/15 text-white"
                : "text-white/50 hover:text-white",
            )}
          >
            <Icon className="size-5" strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}

function MobilePlayerSheet() {
  const {
    track,
    playing,
    progress,
    duration,
    volume,
    isPanelOpen,
    setPanel,
    closePanel,
    toggle,
    seek,
    next,
    prev,
    setVolume,
  } = usePlayer();
  const [queueView, setQueueView] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [lyricsControlsVisible, setLyricsControlsVisible] = useState(true);
  const [mounted, setMounted] = useState(false);
  const startY = useRef<number | null>(null);
  const skipHandleClick = useRef(false);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function onOpenQueue() {
      setQueueView(true);
      closePanel("lyrics");
      closePanel("devices");
      setPanel("nowPlaying");
    }
    window.addEventListener("polarr:open-queue", onOpenQueue);
    return () => window.removeEventListener("polarr:open-queue", onOpenQueue);
  }, [closePanel, setPanel]);

  const lyricsOpen = isPanelOpen("lyrics");
  const devicesOpen = isPanelOpen("devices");
  const nowPlayingOpen = isPanelOpen("nowPlaying");
  const open = nowPlayingOpen || lyricsOpen || devicesOpen;
  const lyricsImmersive = lyricsOpen && !queueView;

  const bumpLyricsControls = () => {
    setLyricsControlsVisible(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => {
      setLyricsControlsVisible(false);
    }, 3000);
  };

  useEffect(() => {
    if (!lyricsImmersive) {
      setLyricsControlsVisible(true);
      if (hideControlsTimer.current) {
        clearTimeout(hideControlsTimer.current);
        hideControlsTimer.current = null;
      }
      return;
    }
    bumpLyricsControls();
    return () => {
      if (hideControlsTimer.current) {
        clearTimeout(hideControlsTimer.current);
        hideControlsTimer.current = null;
      }
    };
  }, [lyricsImmersive]);

  if (!open || !track || !mounted) return null;

  const view: MobileSheetView = queueView
    ? "queue"
    : lyricsOpen
      ? "lyrics"
      : devicesOpen
        ? "devices"
        : "player";

  const cover =
    track.coverPath && /^https?:\/\//i.test(track.coverPath)
      ? track.coverPath
      : undefined;
  const showTransport = view !== "lyrics" || lyricsControlsVisible;

  function dismiss() {
    setQueueView(false);
    setDragY(0);
    setPanel("none");
  }

  function showPlayer() {
    setQueueView(false);
    closePanel("lyrics");
    closePanel("devices");
  }

  function showLyrics() {
    if (view === "lyrics") {
      showPlayer();
      return;
    }
    setQueueView(false);
    closePanel("devices");
    setPanel("lyrics");
  }

  function showQueue() {
    if (view === "queue") {
      showPlayer();
      return;
    }
    closePanel("lyrics");
    closePanel("devices");
    setQueueView(true);
  }

  function showDevices() {
    if (view === "devices") {
      showPlayer();
      return;
    }
    setQueueView(false);
    closePanel("lyrics");
    setPanel("devices");
  }

  const sheet = (
    <div
      className="pointer-events-auto fixed inset-0 z-[100] flex h-dvh min-h-dvh w-full flex-col overflow-hidden text-white"
      style={{
        transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
        transition: startY.current == null ? "transform 0.2s ease-out" : undefined,
      }}
      onPointerDown={() => {
        if (view === "lyrics") bumpLyricsControls();
      }}
      onTouchMove={(e) => {
        if (startY.current == null) return;
        const y = e.touches[0]?.clientY ?? startY.current;
        const delta = y - startY.current;
        if (delta > 0) setDragY(delta);
      }}
      onTouchEnd={() => {
        if (startY.current == null) return;
        const y = dragY;
        startY.current = null;
        if (y > 24) skipHandleClick.current = true;
        if (y > 110) {
          dismiss();
          return;
        }
        setDragY(0);
      }}
    >
      {/* Opaque base — no app chrome peeks through glass edges */}
      <div className="absolute inset-0 bg-black" aria-hidden />
      <PlayerGlassBackdrop
        image={cover}
        seed={`${track.id}:${track.artist}:${track.title}`}
      />

      <button
        type="button"
        aria-label="Close now playing"
        onClick={() => {
          if (skipHandleClick.current) {
            skipHandleClick.current = false;
            return;
          }
          dismiss();
        }}
        onTouchStart={(e) => {
          startY.current = e.touches[0]?.clientY ?? null;
        }}
        className="relative z-[1] flex w-full shrink-0 justify-center pt-[max(0.65rem,var(--safe-top))] pb-2"
      >
        <span className="h-1 w-10 rounded-full bg-white/35" />
      </button>

      <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
        {view === "player" ? (
          <div className="flex min-h-0 flex-1 flex-col px-6">
            <div className="flex min-h-0 flex-1 items-center justify-center py-2">
              <CoverArt
                seed={track.album || track.title}
                image={cover}
                className="aspect-square w-full max-w-[min(100%,22rem)] rounded-2xl shadow-2xl"
              />
            </div>
            <div className="flex shrink-0 items-center gap-3 pb-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-2xl font-bold tracking-tight text-white">
                  {track.title}
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[15px] text-white/70">
                  {track.explicit ? <ExplicitBadge /> : null}
                  <span className="truncate">{track.artist}</span>
                </div>
              </div>
              <TrackLikeButton
                key={track.id}
                trackId={track.id}
                artist={track.artist}
                title={track.title}
                album={track.album}
                coverPath={track.coverPath}
                size="md"
                className="size-11 text-white"
              />
              <SheetMoreButton track={track} />
            </div>
          </div>
        ) : (
          <>
            <MobileSheetHeader track={track} />
            {view === "lyrics" ? (
              <LyricsBody open compact />
            ) : view === "queue" ? (
              <div className="min-h-0 flex-1">
                <QueuePanel variant="sheet" />
              </div>
            ) : (
              <ScrollArea className="min-h-0 flex-1">
                <ConnectBody />
              </ScrollArea>
            )}
          </>
        )}

        <div
          className={cn(
            "shrink-0 transition-[opacity,transform,max-height] duration-300 ease-out",
            showTransport
              ? "pointer-events-auto max-h-[28rem] translate-y-0 opacity-100"
              : "pointer-events-none max-h-0 translate-y-4 overflow-hidden opacity-0",
          )}
        >
          <div>
            <MobileTransport
              track={track}
              playing={playing}
              progress={progress}
              duration={duration}
              volume={volume}
              onSeek={seek}
              onToggle={toggle}
              onPrev={prev}
              onNext={next}
              onVolume={setVolume}
            />
            <MobileTrio
              view={view}
              onLyrics={showLyrics}
              onDevices={showDevices}
              onQueue={showQueue}
            />
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(sheet, document.body);
}

/** Permanent queue / recently-played rail (desktop). */
export function PlayerQueueRail() {
  return (
    <div className="hidden h-full lg:flex">
      <QueuePanel />
    </div>
  );
}

/** Overlays for lyrics, devices, and now-playing popup. */
export function PlayerPanels() {
  const { isPanelOpen } = usePlayer();
  const isLg = useIsLg();
  const anyOpen =
    isPanelOpen("lyrics") ||
    isPanelOpen("devices") ||
    isPanelOpen("nowPlaying");
  if (!anyOpen) return null;

  if (!isLg) {
    return <MobilePlayerSheet />;
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <LyricsPanel />
      <DevicesPanel />
      <NowPlayingPopup />
    </div>
  );
}
