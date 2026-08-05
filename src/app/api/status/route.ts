import { json } from "@/lib/api";
import { getSettings, hasUsers } from "@/lib/db";
import { LidarrClient } from "@/lib/lidarr";
import { ytDlpAvailable } from "@/lib/fallback-download";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = getSettings();
  let lidarr: { ok: boolean; version?: string; error?: string } = {
    ok: false,
  };
  try {
    const client = LidarrClient.fromSettings();
    if (client) {
      const status = await client.status();
      lidarr = { ok: true, version: status.version };
    }
  } catch (err) {
    lidarr = {
      ok: false,
      error: err instanceof Error ? err.message : "Lidarr unreachable",
    };
  }

  return json({
    app: "polarr",
    version: "0.1.0",
    setupComplete: settings.setupComplete,
    hasUsers: hasUsers(),
    serverName: settings.serverName,
    lidarr,
    fallback: {
      enabled: settings.fallbackEnabled,
      ytDlp: await ytDlpAvailable(),
    },
  });
}
