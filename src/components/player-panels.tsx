"use client";

import { toastInfo } from "@/lib/toast";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import {
  Check,
  Laptop,
  Mic2,
  MonitorSpeaker,
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Wifi,
  X,
} from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { ExplicitBadge } from "@/components/explicit-badge";
import { TrackContextMenu } from "@/components/track-context-menu";
import { TrackLikeButton } from "@/components/track-like-button";
import { usePlayer, type PlayerTrack } from "@/components/player-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { albumHref } from "@/lib/album-ref";
import { getDragTrack, POLARR_TRACK_MIME } from "@/lib/drag-track";
import { LISTEN_CREDITED_EVENT } from "@/lib/ui-events";
import { cn, formatDuration } from "@/lib/utils";

type LyricLine = { time: number; text: string };

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
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [synced, setSynced] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">(
    "loading",
  );
  const [instrumental, setInstrumental] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const lyricsOpen = isPanelOpen("lyrics");

  useEffect(() => {
    if (!lyricsOpen || !track) return;
    let cancelled = false;
    setStatus("loading");
    setLines([]);
    setSynced(false);
    setInstrumental(false);
    void fetch(
      `/api/lyrics?artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(track.title)}`,
    )
      .then(async (res) => {
        if (!res.ok) throw new Error("fail");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data.instrumental) {
          setInstrumental(true);
          setStatus("empty");
          return;
        }
        const next = Array.isArray(data.lines) ? data.lines : [];
        setLines(next);
        setSynced(Boolean(data.synced));
        setStatus(next.length ? "ready" : "empty");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [lyricsOpen, track?.id, track?.artist, track?.title]);

  const activeIndex = useMemo(() => {
    if (!lines.length) return -1;
    let idx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= progress + 0.15) idx = i;
      else break;
    }
    return idx;
  }, [lines, progress]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const active = activeRef.current;
    if (!scroller || !active) return;
    const offset =
      active.offsetTop -
      scroller.clientHeight / 2 +
      active.clientHeight / 2;
    scroller.scrollTo({
      top: Math.max(0, offset),
      behavior: "smooth",
    });
  }, [activeIndex]);

  if (!lyricsOpen || !track) return null;

  const bg = lyricsBackdrop(`${track.id}:${track.artist}:${track.title}`);

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
        className="min-h-0 flex-1 overflow-y-auto px-8 py-[28vh] md:px-16 lg:px-24 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {status === "loading" && (
          <p className="text-lg font-bold text-white/50">Loading lyrics…</p>
        )}
        {status === "error" && (
          <p className="text-lg font-bold text-white/50">
            Couldn’t load lyrics right now.
          </p>
        )}
        {status === "empty" && (
          <p className="text-lg font-bold text-white/50">
            {instrumental
              ? "This track is instrumental."
              : "No lyrics found for this track."}
          </p>
        )}
        {status === "ready" &&
          lines.map((line, i) => {
            const active = i === activeIndex;
            const near = Math.abs(i - activeIndex) <= 1;
            const canSeek = synced && duration > 0;
            return (
              <button
                key={`${line.time}-${i}`}
                type="button"
                ref={active ? activeRef : undefined}
                disabled={!canSeek}
                onClick={() => {
                  if (!canSeek) return;
                  seek(Math.min(1, Math.max(0, line.time / duration)));
                }}
                className={cn(
                  "block max-w-3xl py-3 text-left text-2xl font-semibold leading-snug tracking-tight transition-all duration-300 md:text-3xl md:leading-snug",
                  canSeek && "cursor-pointer hover:text-white",
                  !canSeek && "cursor-default",
                  active
                    ? "scale-[1.01] text-white"
                    : near
                      ? "text-white/40"
                      : "text-white/22",
                )}
              >
                {line.text}
              </button>
            );
          })}
      </div>

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
              {!track.id.startsWith("live:") ? (
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background"
                  title="In library"
                  aria-label="In library"
                >
                  <Check className="size-3" strokeWidth={3} />
                </span>
              ) : null}
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
