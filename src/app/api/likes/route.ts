import { z } from "zod";
import { getAuthUser, json } from "@/lib/api";
import {
  countLikedTracks,
  isTrackLiked,
  listLikedTracks,
  resolveLikeTrackId,
  setTrackLiked,
  toggleTrackLiked,
  type LikeMeta,
} from "@/lib/db";
import { getLiveSession } from "@/lib/live-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  trackId: z.string().min(1),
  liked: z.boolean().optional(),
  artist: z.string().optional(),
  title: z.string().optional(),
  album: z.string().optional(),
  coverPath: z.string().nullable().optional(),
  duration: z.number().optional(),
});

function metaFromBody(input: {
  artist?: string;
  title?: string;
  album?: string;
  coverPath?: string | null;
  duration?: number;
  trackId: string;
}): LikeMeta {
  const meta: LikeMeta = {
    artist: input.artist,
    title: input.title,
    album: input.album,
    coverPath: input.coverPath,
    duration: input.duration,
  };

  if (input.trackId.startsWith("live:")) {
    const session = getLiveSession(input.trackId.slice(5));
    if (session) {
      meta.artist = meta.artist || session.artist;
      meta.title = meta.title || session.title;
      meta.album = meta.album || session.album;
    }
  }

  return meta;
}

/** List current user's liked tracks. */
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const trackId = url.searchParams.get("trackId");
  if (trackId) {
    const artist = url.searchParams.get("artist") || undefined;
    const title = url.searchParams.get("title") || undefined;
    const meta = metaFromBody({ trackId, artist, title });
    const resolved = resolveLikeTrackId(trackId, meta);
    return json({
      liked: isTrackLiked(user.id, trackId, meta),
      trackId: resolved?.id || trackId,
    });
  }

  const items = listLikedTracks(user.id, 500).map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    path: t.path,
    coverPath: t.coverPath,
    source: t.source,
    likedAt: t.likedAt,
    streamOnly: !t.path || t.source === "stream" || t.id.startsWith("stream:"),
  }));

  return json({
    count: countLikedTracks(user.id),
    tracks: items,
  });
}

/** Like, unlike, or toggle a track for the current user. */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  const { trackId, liked, artist, title, album, coverPath, duration } =
    parsed.data;
  const meta = metaFromBody({
    trackId,
    artist,
    title,
    album,
    coverPath,
    duration,
  });

  const resolved = resolveLikeTrackId(trackId, meta);
  if (!resolved) {
    return json(
      {
        error: "Need a track title and artist to save to Liked Songs",
        liked: false,
      },
      { status: 400 },
    );
  }

  if (typeof liked === "boolean") {
    setTrackLiked(user.id, trackId, liked, meta);
  } else {
    toggleTrackLiked(user.id, trackId, meta);
  }

  const persisted = isTrackLiked(user.id, resolved.id, resolved.meta);
  if (typeof liked === "boolean" && persisted !== liked) {
    return json(
      { error: "Couldn’t update Liked Songs", liked: persisted },
      { status: 500 },
    );
  }

  return json({
    liked: persisted,
    trackId: resolved.id,
    count: countLikedTracks(user.id),
  });
}
