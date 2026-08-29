import { json } from "@/lib/api";
import {
  countTracks,
  getSettings,
  hasUsers,
  requestStats,
} from "@/lib/db";
import { LidarrClient } from "@/lib/lidarr";
import { ytDlpAvailable } from "@/lib/fallback-download";

export const dynamic = "force-dynamic";

/** Umbrel health endpoint — no secrets */
export async function GET() {
  const settings = getSettings();
  let lidarrOk = false;
  try {
    const client = LidarrClient.fromSettings();
    if (client) {
      await client.status();
      lidarrOk = true;
    }
  } catch {
    lidarrOk = false;
  }

  const stats = requestStats();

  return json({
    app: "polarr",
    status: "ok",
    version: "0.1.0",
    setupComplete: settings.setupComplete,
    hasUsers: hasUsers(),
    libraryCount: countTracks(),
    requests: stats,
    lidarrConnected: lidarrOk,
    fallbackReady: settings.fallbackEnabled && (await ytDlpAvailable()),
  });
}
