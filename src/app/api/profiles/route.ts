import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api";
import {
  getPublicProfile,
  listPinnedAlbumNavItems,
  listPublicProfiles,
  listUserPlaylists,
  recentAlbumsForUser,
  topTracksForUser,
  userProfileStats,
  type PublicProfile,
  type TrackRow,
} from "@/lib/db";
import { albumHref } from "@/lib/album-ref";
import { albumCoverKey, getAlbumCoverMap } from "@/lib/lidarr";
import { scrambleUserId } from "@/lib/user-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicUser(u: PublicProfile) {
  return {
    publicId: u.publicId,
    username: u.username,
    isAdmin: u.isAdmin,
    createdAt: u.createdAt,
    avatarUrl: u.avatarUrl,
    bannerColors: u.bannerColors,
  };
}

function resolveCover(
  covers: Map<string, string>,
  artist: string,
  album: string,
  coverPath?: string | null,
) {
  const fromDb =
    coverPath && /^https?:\/\//i.test(coverPath) ? coverPath : null;
  return fromDb || covers.get(albumCoverKey(artist, album)) || coverPath || null;
}

function trackPayload(t: TrackRow, covers: Map<string, string>) {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    coverPath: resolveCover(covers, t.artist, t.album, t.coverPath),
    streamUrl: `/api/stream/${t.id}`,
  };
}

export async function GET(req: NextRequest) {
  const me = await getAuthUser();
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const username = req.nextUrl.searchParams.get("u")?.trim() ?? "";
  if (username) {
    const user = getPublicProfile(username);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    // Number(null) === 0 (finite) — treat missing/empty as default, not 1
    const limitParam = req.nextUrl.searchParams.get("limit");
    const rawLimit =
      limitParam == null || limitParam.trim() === ""
        ? NaN
        : Number(limitParam);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(100, Math.max(1, Math.floor(rawLimit)))
      : 10;
    const stats = userProfileStats(user.id);
    const covers = await getAlbumCoverMap();
    const topTracks = topTracksForUser(user.id, limit).map((t) =>
      trackPayload(t, covers),
    );

    const playlists = listUserPlaylists(user.id)
      .slice(0, 24)
      .map((p) => ({
        id: p.id,
        name: p.name,
        trackCount: p.trackCount,
        href: `/playlist/${encodeURIComponent(p.id)}`,
        coverPath: p.coverUrl,
      }));

    const pinned = listPinnedAlbumNavItems(user.id).slice(0, 14);
    const albumsKind = pinned.length > 0 ? "pinned" : "recent";
    const albumsSource =
      pinned.length > 0
        ? pinned.map((p) => ({
            key: p.key,
            title: p.title,
            artist: p.artist,
            tracks: p.tracks,
            href: albumHref({ title: p.title, artist: p.artist }),
            coverPath: resolveCover(covers, p.artist, p.title, p.image),
          }))
        : recentAlbumsForUser(user.id, 14).map((p) => ({
            key: `${p.artist}::${p.title}`.toLowerCase(),
            title: p.title,
            artist: p.artist,
            tracks: p.tracks,
            href: albumHref({ title: p.title, artist: p.artist }),
            coverPath: resolveCover(covers, p.artist, p.title, p.coverPath),
          }));

    return NextResponse.json({
      user: publicUser(user),
      me: {
        publicId: scrambleUserId(me.id),
        username: me.username,
        isAdmin: me.isAdmin,
      },
      isSelf: user.id === me.id,
      stats,
      topTracks,
      playlists,
      albums: albumsSource,
      albumsKind,
    });
  }

  return NextResponse.json({
    me: {
      publicId: scrambleUserId(me.id),
      username: me.username,
      isAdmin: me.isAdmin,
    },
    profiles: listPublicProfiles().map(publicUser),
  });
}
