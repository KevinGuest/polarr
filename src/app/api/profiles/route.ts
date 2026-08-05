import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api";
import {
  getPublicProfile,
  libraryStats,
  listPublicProfiles,
  publicAlbumsFromLibrary,
  topTracksFromLibrary,
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
  return fromDb || covers.get(albumCoverKey(artist, album)) || null;
}

function trackPayload(
  t: TrackRow,
  covers: Map<string, string>,
) {
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
    const stats = libraryStats();
    const covers = await getAlbumCoverMap();
    const topTracks = topTracksFromLibrary(limit).map((t) =>
      trackPayload(t, covers),
    );
    const albums = publicAlbumsFromLibrary(14).map((p) => ({
      key: `${p.artist}::${p.title}`.toLowerCase(),
      title: p.title,
      artist: p.artist,
      tracks: p.tracks,
      href: albumHref({ title: p.title, artist: p.artist }),
      coverPath: resolveCover(covers, p.artist, p.title),
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
      albums,
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
