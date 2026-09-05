"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import {
  InsetGroup,
  ShelfHeader,
  useFitCount,
} from "@/components/media-shelf";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  extractBannerColors,
  extractBannerColorsFromUrl,
} from "@/lib/banner-colors";
import { AVATAR_UPDATED_EVENT, MEDIA_TICKET_UPDATED_EVENT } from "@/lib/ui-events";
import { nativeAssetUrl } from "@/lib/native-client";
import { toastError, toastSaved } from "@/lib/toast";

type Profile = {
  publicId: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
  avatarUrl: string | null;
  bannerColors: string[] | null;
};

type PublicAlbum = {
  key: string;
  title: string;
  artist: string;
  tracks: number;
  href: string;
  coverPath: string | null;
};

type PublicPlaylist = {
  id: string;
  name: string;
  trackCount: number;
  href: string;
  coverPath: string | null;
};

type Payload = {
  user: Profile;
  isSelf: boolean;
  stats: {
    playlists: number;
    playsThisMonth: number;
    uniqueTracksThisMonth: number;
  };
  playlists: PublicPlaylist[];
  albums: PublicAlbum[];
  albumsKind?: "pinned" | "recent";
};

function ProfileAlbumTile({ album }: { album: PublicAlbum }) {
  return (
    <Link
      href={album.href}
      className="min-w-0 space-y-2 rounded-lg p-2 transition-colors hover:bg-muted/40"
    >
      <CoverArt
        seed={`${album.artist}-${album.title}`}
        image={album.coverPath}
        className="aspect-square w-full rounded-2xl shadow-md shadow-black/30"
      />
      <div className="min-w-0 px-0.5">
        <p className="truncate text-sm font-semibold">{album.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {album.artist || "Unknown artist"}
        </p>
      </div>
    </Link>
  );
}

function ProfileAlbums({
  albums,
  albumsKind,
  isSelf,
}: {
  albums: PublicAlbum[];
  albumsKind: "pinned" | "recent";
  isSelf: boolean;
}) {
  const { ref, count } = useFitCount(152, 16);
  const [expanded, setExpanded] = useState(false);
  const title =
    albumsKind === "pinned" ? "Saved albums" : "Recently played albums";
  const canExpand = albums.length > count;
  const visibleAlbums = expanded ? albums : albums.slice(0, count);

  return (
    <section className="space-y-4">
      <div className="lg:hidden">
        <h2 className="text-[1.375rem] font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="hidden lg:block">
        <ShelfHeader
          title={title}
          showSeeAll={canExpand || expanded}
          onSeeAll={() => setExpanded((value) => !value)}
          actionLabel={expanded ? "Show less" : "Show all"}
        />
      </div>
      {albums.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isSelf
            ? "No saved or recently played albums yet."
            : "No albums to show."}
        </p>
      ) : (
        <>
          <InsetGroup className="lg:hidden">
            {albums.map((album) => (
              <Link
                key={album.key}
                href={album.href}
                className="flex min-h-14 items-center gap-3 px-3"
              >
                <CoverArt
                  seed={`${album.artist}-${album.title}`}
                  image={album.coverPath}
                  className="size-10 shrink-0 rounded-xl"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[17px]">
                    {album.title}
                  </span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    {album.artist || "Unknown artist"}
                  </span>
                </span>
              </Link>
            ))}
          </InsetGroup>
          <div
            ref={ref}
            className="hidden w-full gap-4 lg:grid"
            style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
          >
            {visibleAlbums.map((album) => (
              <ProfileAlbumTile key={album.key} album={album} />
            ))}
          </div>
        </>
      )}
    </section>
  );
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
  const resolved = nativeAssetUrl(url) || url;
  const sep = resolved.includes("?") ? "&" : "?";
  return `${resolved}${sep}v=${v}`;
}

export function ProfileClient({
  username,
}: {
  /** When set, load that public profile; otherwise current user */
  username?: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [avatarVer, setAvatarVer] = useState(0);
  const [liveBanner, setLiveBanner] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    // Keep the previous profile painted while refreshing to avoid a full-page skeleton flash.
    if (!data) setLoading(true);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reload when the target profile changes
  }, [username, router]);

  // Prefer stored banner colors; only replace when a fresh sample succeeds.
  useEffect(() => {
    const url = data?.user?.avatarUrl;
    if (!url) return;
    let cancelled = false;
    const src = cacheBust(url, avatarVer) ?? url;
    void extractBannerColorsFromUrl(src)
      .then((colors) => {
        if (!cancelled && colors?.length) setLiveBanner(colors);
      })
      .catch(() => {
        /* keep stored bannerColors */
      });
    return () => {
      cancelled = true;
    };
  }, [data?.user?.publicId, data?.user?.avatarUrl, avatarVer]);

  useEffect(() => {
    function onMediaTicket() {
      setAvatarVer(Date.now());
    }
    window.addEventListener(MEDIA_TICKET_UPDATED_EVENT, onMediaTicket);
    return () => window.removeEventListener(MEDIA_TICKET_UPDATED_EVENT, onMediaTicket);
  }, []);

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
      <div className="-mx-4 space-y-10 pb-8 md:-mx-8 md:-mt-4 lg:-mx-10">
        <div
          className="flex min-h-[16rem] flex-col justify-center border-b border-border px-4 pb-12 pt-10 max-lg:min-h-[18rem] max-lg:pb-14 max-lg:pt-[max(6.75rem,calc(var(--safe-top)+5.25rem))] md:min-h-[20rem] md:px-8 md:pb-14 md:pt-14 lg:px-10"
          style={bannerStyle(null)}
        >
          <div className="flex flex-row items-end gap-4 sm:gap-6">
            <Skeleton className="size-28 shrink-0 rounded-full sm:size-36 md:size-44" />
            <div className="min-w-0 flex-1 space-y-2 pb-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-40 sm:h-10" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
        </div>
        <div className="space-y-3 px-5 md:px-8 lg:px-10">
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

  const {
    user: profile,
    stats,
    playlists = [],
    albums,
    albumsKind = "recent",
    isSelf,
  } = data;
  const avatarSrc = cacheBust(profile.avatarUrl, avatarVer);
  const bannerColors = liveBanner ?? profile.bannerColors;

  return (
    <div className="-mx-4 space-y-10 pb-8 md:-mx-8 md:-mt-4 lg:-mx-10">
      <section
        className="relative flex min-h-[16rem] flex-col justify-center overflow-hidden border-b border-border px-4 pb-12 pt-10 max-lg:min-h-[18rem] max-lg:pb-14 max-lg:pt-[max(6.75rem,calc(var(--safe-top)+5.25rem))] md:min-h-[20rem] md:px-8 md:pb-14 md:pt-14 lg:px-10"
        style={bannerStyle(bannerColors)}
      >
        <div className="relative flex flex-row items-end gap-4 sm:gap-6">
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
                  className="group relative flex size-28 items-center justify-center overflow-hidden rounded-full border border-border/60 bg-muted text-4xl font-semibold uppercase shadow-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70 sm:size-36 sm:text-5xl md:size-44 md:text-6xl"
                  aria-label={
                    profile.avatarUrl
                      ? "Change profile photo"
                      : "Upload profile photo"
                  }
                >
                  <UserAvatar
                    username={profile.username}
                    avatarUrl={avatarSrc}
                    textClassName="text-4xl sm:text-5xl md:text-6xl"
                    className="bg-transparent"
                  />
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
                className="relative size-28 overflow-hidden rounded-full border border-border/60 bg-muted shadow-lg sm:size-36 md:size-44"
                aria-hidden
              >
                <UserAvatar
                  username={profile.username}
                  avatarUrl={avatarSrc}
                  textClassName="text-4xl sm:text-5xl md:text-6xl"
                />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1.5 pb-0.5 sm:space-y-2 sm:pb-1">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Profile
              {profile.isAdmin ? " · Admin" : ""}
            </p>
            <h1 className="break-all text-[2rem] font-semibold tracking-tight sm:text-4xl md:text-5xl">
              {profile.username}
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span>
                {stats.playsThisMonth} play
                {stats.playsThisMonth === 1 ? "" : "s"} this month
              </span>
              <span className="text-muted-foreground/40" aria-hidden>
                ·
              </span>
              <span>
                {stats.playlists} playlist
                {stats.playlists === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="space-y-10 px-5 md:px-8 lg:px-10">
        <section className="space-y-4">
          <h2 className="text-[1.375rem] font-semibold tracking-tight">Playlists</h2>
          {playlists.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {isSelf ? "No playlists yet." : "No playlists."}
            </p>
          ) : (
            <>
              <InsetGroup className="lg:hidden">
                {playlists.map((p) => (
                  <Link
                    key={p.id}
                    href={p.href}
                    className="flex min-h-14 items-center gap-3 px-3"
                  >
                    <CoverArt
                      seed={p.name}
                      image={p.coverPath}
                      className="size-10 shrink-0 rounded-xl"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[17px]">
                        {p.name}
                      </span>
                      <span className="block truncate text-[13px] text-muted-foreground">
                        {p.trackCount} track{p.trackCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </Link>
                ))}
              </InsetGroup>
              <div className="-mx-1 hidden gap-4 overflow-x-auto px-1 pb-2 lg:flex">
              {playlists.map((p) => (
                <Link
                  key={p.id}
                  href={p.href}
                  className="w-[9.5rem] shrink-0 space-y-2 rounded-lg p-2 transition-colors hover:bg-muted/40 sm:w-40"
                >
                  <CoverArt
                    seed={p.name}
                    image={p.coverPath}
                    className="aspect-square w-full rounded-2xl shadow-md shadow-black/30"
                  />
                  <div className="min-w-0 px-0.5">
                    <p className="truncate text-sm font-semibold">{p.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.trackCount} track{p.trackCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </Link>
              ))}
              </div>
            </>
          )}
        </section>

        <ProfileAlbums
          albums={albums}
          albumsKind={albumsKind}
          isSelf={isSelf}
        />
      </div>
    </div>
  );
}
