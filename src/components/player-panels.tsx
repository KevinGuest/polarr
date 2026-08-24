"use client";

import { toastInfo } from "@/lib/toast";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import {
  Laptop,
  Mic2,
  Minus,
  MonitorSpeaker,
  Music2,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
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
import { LISTEN_CREDITED_EVENT } from "@/lib/ui-events";
import { cn, formatDuration } from "@/lib/utils";
import { KaraokeLyricLine } from "@/components/karaoke-lyric-line";
import { useKaraokeSession } from "@/components/use-karaoke-session";

/** Dark saturated backdrop from track seed — always readable with white text. */
function lyricsBackdrop(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = Math.abs(h) % 360;
  // Low lightness + medium-high saturation so white/bold lyrics stay crisp
  return `hsl(${hue} 42% 18%)`;
}

function LyricsPanel() {
  const {
    track,
    playing,
    progress,
    duration,
    seek,
    isPanelOpen,
    closePanel,
    vocalLevel,
    setVocalLevel,
    karaokeStatus,
    karaokeProgress,
    karaokeError,
  } = usePlayer();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const lyricsOpen = isPanelOpen("lyrics");

  const session = useKaraokeSession({
    open: lyricsOpen,
    artist: track?.artist,
    title: track?.title,
    album: track?.album,
    trackId: track?.id,
    mediaDurationSec: duration > 0 ? duration : undefined,
    progressSec: progress,
  });

  useEffect(() => {
    const scroller = scrollerRef.current;
    const active = activeRef.current;
    if (!scroller || !active || !session.synced) return;
    // Pin the singing line near the top (Apple Music karaoke), not centered.
    const topPin = 80;
    scroller.scrollTo({
      top: Math.max(0, active.offsetTop - topPin),
      behavior: "smooth",
    });
  }, [session.activeIndex, session.synced]);

  if (!lyricsOpen || !track) return null;

  const bg = lyricsBackdrop(`${track.id}:${track.artist}:${track.title}`);
  const canSeek = session.synced && duration > 0;

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-20 flex flex-col"
      style={{ backgroundColor: bg }}
    >
      <button
        type="button"
        aria-label="Close lyrics"
        onClick={() => closePanel("lyrics")}
        className="absolute right-5 top-5 z-10 rounded-md p-2 text-white/55 transition-colors hover:text-white"
      >
        <X className="size-5" />
      </button>

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto px-8 pb-[70vh] pt-20 md:px-16 lg:px-24 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
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
        {session.status === "ready" &&
          session.lines.map((line, i) => {
            const active = session.synced && i === session.activeIndex;
            const near =
              session.synced && Math.abs(i - session.activeIndex) <= 1;
            const isGap = line.text === "♪" || line.text === "♫";

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
                  "block max-w-3xl py-3 text-left leading-snug tracking-tight transition-[color,filter,font-size,opacity] duration-300",
                  canSeek && "cursor-pointer hover:text-white hover:blur-none",
                  !canSeek && "cursor-default",
                  // Plain session: all lines readable, equal weight (no fake sync)
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
                )}
              >
                {active ? (
                  <KaraokeLyricLine
                    line={line}
                    lines={session.lines}
                    index={i}
                    clockSec={session.clockSec}
                    playing={playing}
                  />
                ) : (
                  line.text
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

      {/* Offset controls — only when line-timed lyrics exist */}
      {session.synced && session.status === "ready" ? (
        <div className="absolute bottom-8 left-6 z-20 flex items-center gap-1.5 rounded-full bg-black/45 px-2 py-1.5 ring-1 ring-white/12 backdrop-blur-md">
          <button
            type="button"
            aria-label="Delay lyrics"
            title="Lyrics later (−0.5s) — wait for the vocal"
            onClick={() => session.nudgeOffset(-0.5)}
            className="rounded-full p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Minus className="size-3.5" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            title={
              session.alignSource === "dtw"
                ? session.offsetUserSet
                  ? "Back to vocal-aligned timing (0s)"
                  : "Aligned to this vocal — click to re-apply"
                : session.offsetUserSet
                ? session.offsetSuggested !== 0
                  ? `Back to auto (${session.offsetSuggested > 0 ? "+" : ""}${session.offsetSuggested.toFixed(1)}s${session.offsetSource === "audio" ? ", from track" : ""})`
                  : "Back to auto (0s)"
                : session.offsetSource === "audio"
                  ? "Auto-aligned to this track — click to keep / re-apply"
                  : session.offsetSource === "duration"
                    ? "Auto from duration match — click to re-apply"
                    : "Auto offset (0s)"
            }
            onClick={() => session.resetOffsetToSuggested()}
            className="min-w-[3.25rem] px-1 text-center text-[11px] font-semibold tabular-nums text-white/80"
          >
            {!session.offsetUserSet &&
            (session.alignSource === "dtw" || session.offsetSource === "audio") ? (
              <span className="text-white/55">
                {session.alignSource === "dtw" ? "aligned " : "auto "}
              </span>
            ) : null}
            {session.offsetSec > 0 ? "+" : ""}
            {session.offsetSec.toFixed(1)}s
          </button>
          <button
            type="button"
            aria-label="Advance lyrics"
            title="Lyrics earlier (+0.5s) — fire before the vocal"
            onClick={() => session.nudgeOffset(0.5)}
            className="rounded-full p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Plus className="size-3.5" strokeWidth={2.5} />
          </button>
        </div>
      ) : null}

      {/* Bottom-right: full mix ↔ Demucs instrumental */}
      <div className="absolute bottom-8 right-6 z-20 flex flex-col items-center gap-2 rounded-full bg-black/45 px-2.5 py-3.5 ring-1 ring-white/12 backdrop-blur-md">
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
  } = usePlayer();

  if (!isPanelOpen("nowPlaying") || !track) return null;

  const pct = duration ? (progress / duration) * 100 : 0;
  const albumPath = albumHref({
    title: (track.album || track.title).trim() || track.title,
    artist: track.artist,
  });

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex flex-col bg-background">
      <div className="flex items-center justify-between px-6 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Now playing
        </p>
        <button
          type="button"
          aria-label="Close now playing"
          onClick={() => closePanel("nowPlaying")}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-5" />
        </button>
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
              className="aspect-square w-full rounded-lg shadow-lg"
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
            <span className="w-10 text-[11px] tabular-nums text-muted-foreground">
              {formatDuration(duration)}
            </span>
          </div>
          <div className="flex items-center justify-center gap-6">
            <button
              type="button"
              onClick={prev}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Previous"
            >
              <SkipBack className="size-5" />
            </button>
            <button
              type="button"
              onClick={toggle}
              className="flex size-12 items-center justify-center rounded-full border border-border transition-colors hover:bg-foreground hover:text-background"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <Pause className="size-5" fill="currentColor" />
              ) : (
                <Play className="size-5" fill="currentColor" />
              )}
            </button>
            <button
              type="button"
              onClick={next}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Next"
            >
              <SkipForward className="size-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function QueuePanel() {
  const {
    track,
    queue,
    play,
    playQueueIndex,
    removeFromQueue,
    addToQueue,
    queueTab,
    setQueueTab,
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
        "flex h-full w-80 shrink-0 flex-col border-l border-border bg-background lg:w-96",
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
      <div className="flex shrink-0 items-center gap-2 px-4 py-3">
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
            {track ? (
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
            ) : (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                Nothing playing yet.
              </p>
            )}

            <section className="space-y-1 px-2">
              <p className="px-1 text-[11px] font-medium text-muted-foreground">
                {nextFrom ? `Next from: ${nextFrom}` : "Next up"}
              </p>
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
                            className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
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

/** Permanent queue / recently-played rail. */
export function PlayerQueueRail() {
  return <QueuePanel />;
}

/** Overlays for lyrics, devices, and now-playing popup. */
export function PlayerPanels() {
  const { isPanelOpen } = usePlayer();
  const anyOpen =
    isPanelOpen("lyrics") ||
    isPanelOpen("devices") ||
    isPanelOpen("nowPlaying");
  if (!anyOpen) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <LyricsPanel />
      <DevicesPanel />
      <NowPlayingPopup />
    </div>
  );
}
