"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { ExplicitBadge } from "@/components/explicit-badge";
import { StreamQualityBadge } from "@/components/stream-quality-badge";
import { PlayerSlider } from "@/components/player-slider";
import { MobileSaveButton } from "@/components/saved-in-drawer";
import { usePlayer } from "@/components/player-provider";
import { albumHref } from "@/lib/album-ref";
import { cn, formatDuration, formatTrackArtistLine } from "@/lib/utils";

/**
 * Compact controls.
 * When `sameDocument` (Document PiP), shares the main tab’s PlayerProvider —
 * audio never restarts. Popup route sets sameDocument=false and opens albums
 * in a full Polarr tab.
 */
export function MiniplayerClient({
  sameDocument = false,
}: {
  sameDocument?: boolean;
}) {
  const router = useRouter();
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

  if (!track) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background px-6 text-center text-foreground">
        <p className="text-sm font-medium">Nothing playing</p>
        <p className="text-xs text-muted-foreground">
          Start a track in Polarr — this window stays in sync.
        </p>
      </div>
    );
  }

  const albumPath = albumHref({
    title: (track.album || track.title).trim() || track.title,
    artist: track.artist,
  });
  const cover =
    track.coverPath && /^https?:\/\//i.test(track.coverPath)
      ? track.coverPath
      : undefined;

  function openAlbum() {
    if (sameDocument) {
      router.push(albumPath);
      try {
        window.focus();
      } catch {
        /* ignore */
      }
      return;
    }
    window.open(albumPath, "_blank", "noopener,noreferrer");
  }

  function openHome() {
    if (sameDocument) {
      router.push("/");
      try {
        window.focus();
      } catch {
        /* ignore */
      }
      return;
    }
    window.open("/", "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Miniplayer
        </span>
        {sameDocument ? (
          <button
            type="button"
            onClick={openHome}
            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Open Polarr
          </button>
        ) : (
          <Link
            href="/"
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Open Polarr
          </Link>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-5 pb-6 pt-4">
        <button
          type="button"
          onClick={openAlbum}
          className="w-full max-w-[260px] transition-opacity hover:opacity-90"
          aria-label={`Open album ${track.album || track.title}`}
        >
          <CoverArt
            seed={track.album || track.title}
            image={cover}
            className="aspect-square w-full rounded-lg shadow-md"
          />
        </button>

        <div className="w-full max-w-[280px] space-y-1 text-center">
          <div className="truncate text-base font-semibold">{track.title}</div>
          <div className="flex min-w-0 items-center justify-center gap-1.5 text-xs text-muted-foreground">
            {track.explicit ? <ExplicitBadge /> : null}
            <span className="truncate">
              {formatTrackArtistLine(track.artist, track.title)}
            </span>
          </div>
          <div className="flex justify-center pt-1">
            <StreamQualityBadge track={track} />
          </div>
          {track.album ? (
            <div className="truncate text-[11px] text-muted-foreground">
              {track.album}
            </div>
          ) : null}
        </div>

        <div className="w-full max-w-[280px] space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-9 text-right text-[10px] tabular-nums text-muted-foreground">
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
            <span className="w-9 text-[10px] tabular-nums text-muted-foreground">
              {formatDuration(duration)}
            </span>
          </div>

          <div className="flex items-center justify-center gap-5">
            <button
              type="button"
              onClick={prev}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Previous"
            >
              <SkipBack className="size-5" fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={toggle}
              className={cn(
                "flex size-12 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90",
              )}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <Pause className="size-5" fill="currentColor" />
              ) : (
                <Play className="size-5 translate-x-0.5" fill="currentColor" />
              )}
            </button>
            <button
              type="button"
              onClick={next}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Next"
            >
              <SkipForward className="size-5" fill="currentColor" />
            </button>
          </div>

          <div className="flex justify-center pt-1">
            <MobileSaveButton
              trackId={track.id}
              artist={track.artist}
              title={track.title}
              album={track.album}
              coverPath={track.coverPath}
              size="sm"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
