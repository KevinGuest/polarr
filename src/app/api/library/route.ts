import { getAuthUser, json } from "@/lib/api";
import { listOfflineTrackIds, listTracks, type TrackRow } from "@/lib/db";
import { scanMusicLibrary } from "@/lib/library";
import { albumCoverKey, getAlbumCoverMap } from "@/lib/lidarr";

export const dynamic = "force-dynamic";

async function tracksWithCovers(): Promise<TrackRow[]> {
  const covers = await getAlbumCoverMap();
  return listTracks(200).map((t) => {
    const fromDb =
      t.coverPath && /^https?:\/\//i.test(t.coverPath) ? t.coverPath : null;
    const album = (t.album || t.title || "").trim();
    const fromLidarr = album
      ? covers.get(albumCoverKey(t.artist, album)) || null
      : null;
    return {
      ...t,
      coverPath: fromDb || fromLidarr || t.coverPath,
    };
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const user = await getAuthUser();
  const offlineIds = user ? listOfflineTrackIds(user.id) : [];
  if (searchParams.get("scan") === "1") {
    const result = scanMusicLibrary();
    return json({
      ...result,
      tracks: await tracksWithCovers(),
      offlineIds,
    });
  }
  return json({ tracks: await tracksWithCovers(), offlineIds });
}

export async function POST() {
  const user = await getAuthUser();
  const result = scanMusicLibrary();
  return json({
    ...result,
    tracks: await tracksWithCovers(),
    offlineIds: user ? listOfflineTrackIds(user.id) : [],
  });
}
