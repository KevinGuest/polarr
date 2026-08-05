import fs from "node:fs";
import { json } from "@/lib/api";
import { getSettings, listTracks } from "@/lib/db";
import { LidarrClient } from "@/lib/lidarr";
import { ytDlpAvailable } from "@/lib/fallback-download";

export const dynamic = "force-dynamic";

/**
 * Home feed: streamable files (library + downtify fallback) + Lidarr releases.
 * Downtify-acquired tracks are first-class stream sources by default.
 */
export async function GET() {
  const settings = getSettings();
  const all = listTracks(200).filter((t) => {
    try {
      return Boolean(t.path && fs.existsSync(t.path));
    } catch {
      return false;
    }
  });
  // Prefer recently added / fallback acquisitions for the ready-to-stream strip
  const tracks = [...all].sort((a, b) => {
    const score = (t: (typeof all)[0]) =>
      (t.source === "fallback" ? 2 : 0) + (t.mtimeMs || 0) / 1e13;
    return score(b) - score(a);
  });

  let releases: Awaited<ReturnType<LidarrClient["latestReleases"]>> = [];
  let lidarrError: string | null = null;

  try {
    const client = LidarrClient.fromSettings();
    if (client) releases = await client.latestReleases(28);
  } catch (err) {
    lidarrError = err instanceof Error ? err.message : "Lidarr discover failed";
  }

  const albumMap = new Map<
    string,
    {
      key: string;
      title: string;
      artist: string;
      trackIds: string[];
      tracks: typeof tracks;
      source: string;
    }
  >();
  for (const t of tracks) {
    const key = `${t.artist}::${t.album}`;
    const cur = albumMap.get(key);
    if (cur) {
      cur.tracks.push(t);
      cur.trackIds.push(t.id);
    } else {
      albumMap.set(key, {
        key,
        title: t.album || t.title,
        artist: t.artist,
        trackIds: [t.id],
        tracks: [t],
        source: t.source,
      });
    }
  }

  const fallbackReady =
    settings.fallbackEnabled && (await ytDlpAvailable());

  return json({
    streamableAlbums: [...albumMap.values()].slice(0, 16),
    tracks: tracks.slice(0, 24),
    releases,
    lidarrError,
    fallbackReady,
    streamDefault: fallbackReady ? "fallback" : "library",
  });
}
