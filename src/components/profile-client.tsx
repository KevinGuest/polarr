"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { TrackContextMenu } from "@/components/track-context-menu";
import { TrackRowActions } from "@/components/track-row-actions";
import { usePlayer } from "@/components/player-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  extractBannerColors,
  extractBannerColorsFromUrl,
} from "@/lib/banner-colors";
import { AVATAR_UPDATED_EVENT } from "@/lib/ui-events";
import { toastError, toastSaved } from "@/lib/toast";

type Profile = {
  publicId: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
  avatarUrl: string | null;
  bannerColors: string[] | null;
};

type TopTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number | null;
  coverPath: string | null;
  streamUrl: string;
};

type PublicAlbum = {
  key: string;
  title: string;
  artist: string;
  tracks: number;
  href: string;
  coverPath: string | null;
};

type Payload = {
  user: Profile;
  isSelf: boolean;
  stats: { tracks: number; albums: number; artists: number };
  topTracks: TopTrack[];
  albums: PublicAlbum[];
};

function formatDuration(sec: number | null | undefined) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function bannerStyle(colors: string[] | null | undefined): CSSProperties {
  if (colors && colors.length >= 2) {
    return {
      background: `linear-gradient(180deg, ${colors.join(", ")})`,
    };
  }
  return {
    background:
      "linear-gradient(180deg, hsl(0 0% 22%) 0%, hsl(var(--background)) 100%)",
  };
}

function cacheBust(url: string | null, v: number) {
  if (!url) return null;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${v}`;
}

export function ProfileClient({
  username,
}: {
  /** When set, load that public profile; otherwise current user */
  username?: string;
}) {
  const router = useRouter();
  const { play, track: playing } = usePlayer();
  const fileRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [avatarVer, setAvatarVer] = useState(0);
  const [liveBanner, setLiveBanner] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        let res: Response;
        if (username) {
          res = await fetch(
            `/api/profiles?u=${encodeURIComponent(username)}&limit=5`,
          );
        } else {
          const meRes = await fetch("/api/profiles");
          if (meRes.status === 401) {
            router.replace("/login");
            return;
          }
          if (!meRes.ok) throw new Error("Could not load profile");
          const meJson = (await meRes.json()) as {
            me: { username: string };
          };
          res = await fetch(
            `/api/profiles?u=${encodeURIComponent(meJson.me.username)}&limit=5`,
          );
        }
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load profile");
        if (!cancelled) setData(body as Payload);
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

  // Re-sample banner from the visible avatar so gradient always matches the photo
  useEffect(() => {
    const url = data?.user?.avatarUrl;
    if (!url) {
      setLiveBanner(null);
      return;
    }
    setLiveBanner(null); // fall back to stored colors until resample finishes
    let cancelled = false;
    const src = cacheBust(url, avatarVer) ?? url;
    void extractBannerColorsFromUrl(src)
      .then((colors) => {
        if (!cancelled) setLiveBanner(colors);
      })
      .catch(() => {
        if (!cancelled) setLiveBanner(null);
      });
    return () => {
      cancelled = true;
    };
  }, [data?.user?.publicId, data?.user?.avatarUrl, avatarVer]);

  async function onPickAvatar(file: File | null) {
    if (!file || !data?.isSelf) return;
    setUploading(true);
    try {
      const colors = await extractBannerColors(file);
      const form = new FormData();
      form.append("avatar", file);
      form.append("bannerColors", JSON.stringify(colors));
      const res = await fetch("/api/profiles/avatar", {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as { error?: string }).error || "Upload failed",
        );
      }
      const user = (body as { user: Profile }).user;
      setData((prev) => (prev ? { ...prev, user } : prev));
      setLiveBanner(colors);
      setAvatarVer(Date.now());
      window.dispatchEvent(new Event(AVATAR_UPDATED_EVENT));
      toastSaved("Avatar updated");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (loading) {
    return (
      <div className="-mx-6 -mt-6 space-y-10 md:-mx-8 lg:-mx-10" aria-busy="true">
        <div className="border-b border-border px-6 pb-8 pt-10 md:px-8 md:pb-10 md:pt-14 lg:px-10">
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-end">
            <Skeleton className="size-28 shrink-0 rounded-full sm:size-36" />
            <div className="min-w-0 flex-1 space-y-3">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
        </div>
        <div className="space-y-3 px-6 md:px-8 lg:px-10">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
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

  if (error || !data?.user) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="text-sm text-muted-foreground">
          {error || "Profile not found"}
        </p>
        <Button variant="outline" onClick={() => router.push("/home")}>
          Home
        </Button>
      </div>
    );
  }

  const { user: profile, stats, topTracks, albums, isSelf } = data;
  const letter = profile.username.trim()[0]?.toUpperCase() || "?";
  const avatarSrc = cacheBust(profile.avatarUrl, avatarVer);
  const bannerColors = liveBanner ?? profile.bannerColors;

  return (
    <div className="-mx-6 -mt-6 space-y-10 pb-8 md:-mx-8 lg:-mx-10">
      <section
        className="relative overflow-hidden border-b border-border px-6 pb-8 pt-10 md:px-8 md:pb-10 md:pt-14 lg:px-10"
        style={bannerStyle(bannerColors)}
      >
        <div className="relative flex flex-col items-start gap-6 sm:flex-row sm:items-end">
          <div className="relative shrink-0">
            {isSelf ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="sr-only"
                  onChange={(e) =>
                    void onPickAvatar(e.target.files?.[0] ?? null)
                  }
                />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  className="group relative flex size-36 items-center justify-center overflow-hidden rounded-full border border-border/60 bg-muted text-5xl font-semibold uppercase shadow-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70 sm:size-44 sm:text-6xl"
                  aria-label={
                    profile.avatarUrl
                      ? "Change profile photo"
                      : "Upload profile photo"
                  }
                >
                  {avatarSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarSrc}
                      alt=""
                      className="absolute inset-0 size-full object-cover"
                    />
                  ) : (
                    <span aria-hidden>{letter}</span>
                  )}
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <Camera className="size-7" strokeWidth={1.75} />
                    <span className="text-[11px] font-medium tracking-wide">
                      {uploading ? "Uploading…" : "Upload photo"}
                    </span>
                  </span>
                </button>
              </>
            ) : (
              <div
                className="relative flex size-36 items-center justify-center overflow-hidden rounded-full border border-border/60 bg-muted text-5xl font-semibold uppercase shadow-lg sm:size-44 sm:text-6xl"
                aria-hidden
              >
                {avatarSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarSrc}
                    alt=""
                    className="absolute inset-0 size-full object-cover"
                  />
                ) : (
                  letter
                )}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2 pb-1">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Profile
              {profile.isAdmin ? " · Admin" : ""}
            </p>
            <h1 className="break-all text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
              {profile.username}
            </h1>
            <p className="text-sm text-muted-foreground">
              {stats.tracks} track{stats.tracks === 1 ? "" : "s"}
              {" · "}
              {stats.albums} album{stats.albums === 1 ? "" : "s"}
              {" · "}
              {stats.artists} artist{stats.artists === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </section>

      <div className="space-y-10 px-6 md:px-8 lg:px-10">
        <section className="space-y-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                Top tracks this month
              </h2>
            </div>
            {topTracks.length > 0 ? (
              <Link
                href={
                  username
                    ? `/u/${encodeURIComponent(profile.username)}/top-tracks`
                    : "/profile/top-tracks"
                }
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Show all
              </Link>
            ) : null}
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
            <div>
              <table className="w-full border-separate border-spacing-y-0.5 text-left text-sm">
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
                    return (
                      <TrackContextMenu key={t.id} track={playerTrack}>
                      <tr
                        className="group/row transition-colors"
                      >
                        <td
                          className={`w-12 rounded-l-md py-2 pl-2 pr-1 text-center align-middle ${rowBg}`}
                        >
                          <button
                            type="button"
                            onClick={() => play(playerTrack)}
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
                        <td className={`w-12 py-2 pr-3 align-middle ${rowBg}`}>
                          <CoverArt
                            seed={`${t.artist}-${t.title}`}
                            image={t.coverPath}
                            className="size-10 rounded-sm"
                          />
                        </td>
                        <td className={`min-w-0 py-2 pr-4 align-middle ${rowBg}`}>
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
                        </td>
                        <td
                          className={`hidden max-w-[12rem] py-2 pr-4 align-middle text-muted-foreground md:table-cell ${rowBg}`}
                        >
                          <span className="block truncate">
                            {t.album || "—"}
                          </span>
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
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold tracking-tight">Albums</h2>
          {albums.length === 0 ? (
            <p className="text-sm text-muted-foreground">No albums yet.</p>
          ) : (
            <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
              {albums.map((a) => (
                <Link
                  key={a.key}
                  href={a.href}
                  className="w-[9.5rem] shrink-0 space-y-2 rounded-lg p-2 transition-colors hover:bg-muted/40 sm:w-40"
                >
                  <CoverArt
                    seed={`${a.artist}-${a.title}`}
                    image={a.coverPath}
                    className="aspect-square w-full rounded-md shadow-md shadow-black/30"
                  />
                  <div className="min-w-0 px-0.5">
                    <p className="truncate text-sm font-semibold">
                      {a.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {a.artist || "Unknown artist"}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
