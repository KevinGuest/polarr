import { getAuthUser, json } from "@/lib/api";
import { getTrack } from "@/lib/db";
import { buildTasteAutoplay } from "@/lib/made-for";
import { coverFromMap, getAlbumCoverMap } from "@/lib/lidarr";

export const dynamic = "force-dynamic";

/**
 * Taste radio / autoplay filler.
 * - ?trackId=… → seed from library track (song radio)
 * - ?artist=&album= → seed continuity for live/catalog plays
 * - ?exclude=id1,id2 → skip already-queued ids
 * - ?limit=24
 */
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const trackId = url.searchParams.get("trackId") || "";
  const artist = (url.searchParams.get("artist") || "").trim();
  const album = (url.searchParams.get("album") || "").trim();
  const excludeRaw = url.searchParams.get("exclude") || "";
  const excludeIds = excludeRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 120);
  const limitRaw = Number.parseInt(url.searchParams.get("limit") || "24", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(limitRaw, 60))
    : 24;

  const covers = await getAlbumCoverMap();
  const withCovers = <
    T extends {
      artist: string;
      album?: string | null;
      title?: string;
      coverPath?: string | null;
    },
  >(
    tracks: T[],
  ) =>
    tracks.map((t) => ({
      ...t,
      coverPath: coverFromMap(covers, t.artist, t.album, t.title, t.coverPath),
    }));

  if (trackId) {
    const seed = getTrack(trackId);
    if (!seed) return json({ error: "Track not found" }, { status: 404 });
    const tracks = withCovers(
      buildTasteAutoplay(user.id, {
        seed,
        excludeIds: [seed.id, ...excludeIds],
        limit,
      }),
    );
    return json({
      mode: "seed",
      seed: {
        id: seed.id,
        title: seed.title,
        artist: seed.artist,
        album: seed.album,
      },
      tracks,
    });
  }

  const tracks = withCovers(
    buildTasteAutoplay(user.id, {
      seedArtist: artist || undefined,
      seedAlbum: album || undefined,
      excludeIds,
      limit,
    }),
  );

  return json({
    mode: "taste",
    seed: artist ? { artist, album } : null,
    tracks,
  });
}
