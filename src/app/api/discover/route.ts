import { json } from "@/lib/api";
import { getSettings } from "@/lib/db";
import { pickMoreFromArtists } from "@/lib/artist-catalog";
import { LidarrClient } from "@/lib/lidarr";
import { ytDlpAvailable } from "@/lib/fallback-download";

export const dynamic = "force-dynamic";

/**
 * Home feed: Lidarr latest releases (≤6 months) + “More from …” artist shelves.
 */
export async function GET() {
  const settings = getSettings();

  let releases: Awaited<ReturnType<LidarrClient["latestReleases"]>> = [];
  let lidarrError: string | null = null;

  try {
    const client = LidarrClient.fromSettings();
    if (client) releases = await client.latestReleases(28);
  } catch (err) {
    lidarrError = err instanceof Error ? err.message : "Lidarr discover failed";
  }

  const moreFrom = (await pickMoreFromArtists(3)).map((cat) => ({
    artist: cat.artist,
    image: cat.image,
    items: cat.tiles.slice(0, 16).map((tile) => {
      if (tile.kind === "album") {
        return {
          kind: "album" as const,
          id: tile.id,
          title: tile.title,
          subtitle: tile.subtitle,
          artist: tile.artist,
          album: tile.album,
          image: tile.image,
          trackCount: tile.trackCount,
          foreignAlbumId: tile.foreignAlbumId,
          lidarrAlbumId: tile.lidarrAlbumId,
        };
      }
      return {
        kind: tile.kind,
        id: tile.id,
        title: tile.title,
        subtitle: tile.subtitle,
        artist: tile.artist,
        album: tile.album,
        image: tile.image,
        trackId: tile.trackId,
        duration: tile.duration,
        coverPath: tile.coverPath,
      };
    }),
  }));

  const fallbackReady =
    settings.fallbackEnabled && (await ytDlpAvailable());

  return json({
    releases,
    moreFrom,
    /** @deprecated prefer moreFrom — kept empty for older clients */
    tracks: [],
    lidarrError,
    fallbackReady,
    streamDefault: fallbackReady ? "fallback" : "library",
  });
}
