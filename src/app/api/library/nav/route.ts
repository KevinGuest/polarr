import { json, getAuthUser } from "@/lib/api";
import { countLikedTracks, listLibraryNavItems } from "@/lib/db";
import { albumCoverKey, getAlbumCoverMap } from "@/lib/lidarr";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const covers = await getAlbumCoverMap();
  const items = listLibraryNavItems(48).map((item) => {
    const fromDb =
      item.image && /^https?:\/\//i.test(item.image) ? item.image : null;
    const fromLidarr =
      covers.get(albumCoverKey(item.artist, item.title)) || null;
    return {
      ...item,
      image: fromDb || fromLidarr,
    };
  });

  return json({
    liked: {
      title: "Liked Songs",
      tracks: countLikedTracks(user.id),
    },
    items,
  });
}
