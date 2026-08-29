"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Home,
  Library,
  Pause,
  Play,
  Search,
  SkipForward,
} from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { LibraryCreateMenu } from "@/components/library-create-menu";
import { usePlayer } from "@/components/player-provider";
import { cn, formatTrackArtistLine } from "@/lib/utils";

const navTabs = [
  { href: "/", label: "Home", icon: Home, match: (p: string) => p === "/" },
  {
    href: "/search",
    label: "Search",
    icon: Search,
    match: (p: string) => p === "/search",
  },
  {
    href: "/library",
    label: "Your Library",
    icon: Library,
    match: (p: string) =>
      p === "/library" ||
      p.startsWith("/library/") ||
      p.startsWith("/playlist/") ||
      p.startsWith("/folder/"),
  },
] as const;

export function MobileBottomDock() {
  const pathname = usePathname();
  const {
    track,
    playing,
    progress,
    duration,
    isPanelOpen,
    setPanel,
    toggle,
    next,
    togglePanel,
  } = usePlayer();
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  const overlay =
    isPanelOpen("nowPlaying") ||
    isPanelOpen("lyrics") ||
    isPanelOpen("devices");

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
      .then(async (res) => (res.ok ? res.json() : null))
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

  const pct = duration ? (progress / duration) * 100 : 0;
  const playLabel = playing ? "Pause" : "Play";

  const dismiss = useCallback(() => setPanel("none"), [setPanel]);

  if (overlay) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 lg:hidden">
      <div className="pointer-events-auto bg-gradient-to-t from-background from-[32%] to-transparent px-3 pb-[max(0.2rem,var(--safe-bottom))] pt-4">
        {track ? (
          <div className="relative mb-2 overflow-hidden rounded-2xl bg-white/[0.1] backdrop-blur-xl backdrop-saturate-150">
            <div className="absolute inset-x-0 top-0 h-[2px] bg-foreground/15">
              <div
                className="h-full bg-foreground transition-[width] duration-150"
                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
              />
            </div>
            <div className="flex items-center gap-2 px-2.5 py-2">
              <button
                type="button"
                onClick={() => togglePanel("nowPlaying")}
                className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2.5 text-left"
                aria-label="Open now playing"
              >
                <CoverArt
                  seed={track.album || track.title}
                  image={coverUrl || undefined}
                  className="size-10 shrink-0 rounded-lg"
                />
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-medium text-foreground">
                    {track.title}
                  </div>
                  <div className="truncate text-[13px] text-muted-foreground">
                    {formatTrackArtistLine(track.artist, track.title)}
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={toggle}
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-foreground"
                aria-label={playLabel}
              >
                {playing ? (
                  <Pause className="size-[1.15rem]" fill="currentColor" />
                ) : (
                  <Play
                    className="size-[1.15rem] translate-x-px"
                    fill="currentColor"
                  />
                )}
              </button>
              <button
                type="button"
                onClick={next}
                className="flex size-10 shrink-0 items-center justify-center text-foreground"
                aria-label="Next"
              >
                <SkipForward className="size-[1.15rem]" fill="currentColor" />
              </button>
            </div>
          </div>
        ) : null}

        <nav
          aria-label="Primary"
          className="flex items-stretch justify-around px-1 pt-0.5"
        >
          {navTabs.map((tab) => {
            const active = tab.match(pathname);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                onClick={dismiss}
                className={cn(
                  "flex min-h-[44px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 py-1 text-[11px] font-medium transition-colors",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon
                  className="size-5"
                  strokeWidth={active ? 2.25 : 1.75}
                />
                <span className="max-w-full truncate">{tab.label}</span>
              </Link>
            );
          })}
          <div className="flex min-w-0 flex-1">
            <LibraryCreateMenu variant="dock" />
          </div>
        </nav>
      </div>
    </div>
  );
}
