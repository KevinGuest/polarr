import { getAuthUser, json } from "@/lib/api";
import { listOfflineTrackIds, listTracks, type TrackRow } from "@/lib/db";
import { scanMusicLibrary } from "@/lib/library";
import { coverFromMap, getAlbumCoverMap } from "@/lib/lidarr";

export const dynamic = "force-dynamic";

async function tracksWithCovers(): Promise<TrackRow[]> {
  const covers = await getAlbumCoverMap();
  return listTracks(200).map((t) => {
    return {
      ...t,
      coverPath: coverFromMap(covers, t.artist, t.album, t.title, t.coverPath),
    };
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const user = await getAuthUser();
  const offlineIds = user ? listOfflineTrackIds(user.id) : [];
  if (searchParams.get("scan") === "1") {
    const result = await scanMusicLibrary();
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
  const result = await scanMusicLibrary();
  return json({
    ...result,
    tracks: await tracksWithCovers(),
    offlineIds: user ? listOfflineTrackIds(user.id) : [],
  });
}
