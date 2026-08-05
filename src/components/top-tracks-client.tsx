"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CoverArt } from "@/components/cover-art";
import { TrackContextMenu } from "@/components/track-context-menu";
import { TrackRowActions } from "@/components/track-row-actions";
import { usePlayer } from "@/components/player-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type TopTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number | null;
  coverPath: string | null;
  streamUrl: string;
};

type Payload = {
  user: { id: string; username: string };
  topTracks: TopTrack[];
};

function formatDuration(sec: number | null | undefined) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function TopTracksClient({
  username,
}: {
  /** When set, load that user's top tracks; otherwise current user */
  username?: string;
}) {
  const router = useRouter();
  const { play, track: playing } = usePlayer();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        let u = username;
        if (!u) {
          const meRes = await fetch("/api/profiles");
          if (meRes.status === 401) {
            router.replace("/login");
            return;
          }
          if (!meRes.ok) throw new Error("Could not load profile");
          const meJson = (await meRes.json()) as {
            me: { username: string };
          };
          u = meJson.me.username;
        }
        const res = await fetch(
          `/api/profiles?u=${encodeURIComponent(u)}&limit=50`,
        );
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load tracks");
        if (!cancelled) {
          setData({
            user: body.user,
            topTracks: body.topTracks ?? [],
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [username, router]);

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2">
              <Skeleton className="h-4 w-6" />
              <Skeleton className="size-11 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Top tracks this month</h1>
        <p className="text-sm text-muted-foreground">
          {error || "Could not load tracks"}
        </p>
        <Button variant="outline" onClick={() => router.back()}>
          Back
        </Button>
      </div>
    );
  }

  const { topTracks, user } = data;
  const backHref = username
    ? `/u/${encodeURIComponent(user.username)}`
    : "/profile";

  return (
    <div className="space-y-6 pb-8">
      <div>
        <Link
          href={backHref}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Back to profile
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          Top tracks this month
        </h1>
      </div>

      {topTracks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No tracks in the library yet.{" "}
          <Link
            href="/search"
            className="text-foreground underline-offset-4 hover:underline"
          >
            Search
          </Link>{" "}
          to start collecting.
        </p>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[520px] border-separate border-spacing-y-0.5 text-left text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="w-12 pb-3 pl-2 font-medium">#</th>
                <th className="pb-3 pr-4 font-medium">Title</th>
                <th className="hidden pb-3 pr-4 font-medium md:table-cell">
                  Album
                </th>
                <th className="w-10 pb-3 font-medium" aria-label="Like" />
                <th className="w-16 pb-3 pr-3 text-right font-medium">
                  <span className="sr-only">Duration</span>
                  <svg
                    viewBox="0 0 16 16"
                    className="ml-auto size-4 fill-current opacity-70"
                    aria-hidden
                  >
                    <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm8.75-3.5a.75.75 0 0 0-1.5 0v3.5c0 .192.168.1.5.75H11a.75.75 0 0 0 0-1.5H8.75V4.5z" />
                  </svg>
                </th>
              </tr>
            </thead>
            <tbody>
              {topTracks.map((t, i) => {
                const isPlaying = playing?.id === t.id;
                const rowBg = isPlaying
                  ? "bg-muted/50"
                  : "group-hover/row:bg-muted/40";
                const playerTrack = {
                  id: t.id,
                  title: t.title,
                  artist: t.artist,
                  album: t.album,
                  coverPath: t.coverPath,
                };
                const queue = topTracks.map((x) => ({
                  id: x.id,
                  title: x.title,
                  artist: x.artist,
                  album: x.album,
                  coverPath: x.coverPath,
                }));
                return (
                  <TrackContextMenu key={t.id} track={playerTrack}>
                  <tr className="group/row transition-colors">
                    <td
                      className={`w-12 rounded-l-md py-2 pl-2 pr-1 text-center align-middle ${rowBg}`}
                    >
                      <button
                        type="button"
                        onClick={() => play(playerTrack, queue)}
                        className="relative mx-auto flex h-8 w-8 items-center justify-center text-muted-foreground"
                        aria-label={`Play ${t.title}`}
                      >
                        <span
                          className={`tabular-nums text-sm group-hover/row:opacity-0 ${
                            isPlaying ? "opacity-0" : ""
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span
                          className={`absolute inset-0 flex items-center justify-center text-foreground ${
                            isPlaying
                              ? "opacity-100"
                              : "opacity-0 group-hover/row:opacity-100"
                          }`}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className="h-4 w-4 fill-current"
                            aria-hidden
                          >
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </span>
                      </button>
                    </td>
                    <td className={`py-2 pr-4 align-middle ${rowBg}`}>
                      <div className="flex min-w-0 items-center gap-3">
                        <CoverArt
                          seed={`${t.artist}-${t.title}`}
                          image={t.coverPath}
                          className="size-10 shrink-0 rounded-sm"
                        />
                        <div className="min-w-0">
                          <p
                            className={`truncate font-medium ${
                              isPlaying
                                ? "text-[var(--primary)]"
                                : "text-foreground"
                            }`}
                          >
                            {t.title}
                          </p>
                          <p className="truncate text-[13px] text-muted-foreground">
                            {t.artist || "Unknown artist"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td
                      className={`hidden max-w-[14rem] py-2 pr-4 align-middle text-muted-foreground md:table-cell ${rowBg}`}
                    >
                      <span className="block truncate">{t.album || "—"}</span>
                    </td>
                    <td className={`py-2 align-middle ${rowBg}`}>
                      <TrackRowActions
                        trackId={t.id}
                        artist={t.artist}
                        title={t.title}
                        album={t.album}
                        coverPath={t.coverPath}
                        duration={t.duration ?? undefined}
                        inLibrary
                      />
                    </td>
                    <td
                      className={`w-16 rounded-r-md py-2 pr-3 text-right align-middle tabular-nums text-muted-foreground ${rowBg}`}
                    >
                      {formatDuration(t.duration)}
                    </td>
                  </tr>
                  </TrackContextMenu>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
