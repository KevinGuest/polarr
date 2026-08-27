import { json } from "@/lib/api";
import { getSettings, hasUsers } from "@/lib/db";
import { LidarrClient } from "@/lib/lidarr";
import { ffmpegAvailable, ytDlpAvailable } from "@/lib/tools";
import { TtlCache } from "@/lib/ttl-cache";

export const dynamic = "force-dynamic";

type StatusPayload = {
  app: string;
  version: string;
  setupComplete: boolean;
  hasUsers: boolean;
  serverName: string;
  lidarr: { ok: boolean; version?: string; error?: string };
  fallback: { enabled: boolean; ytDlp: boolean; ffmpeg: boolean };
};

const statusCache = new TtlCache<StatusPayload>(30_000, 4);

export async function GET() {
  const payload = await statusCache.getOrSet("status", async () => {
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

    return {
      app: "polarr",
      version: process.env.POLARR_APP_VERSION || "0.6.15",
      setupComplete: settings.setupComplete,
      hasUsers: hasUsers(),
      serverName: settings.serverName,
      lidarr,
      fallback: {
        enabled: settings.fallbackEnabled,
        ytDlp: await ytDlpAvailable(),
        ffmpeg: await ffmpegAvailable(),
      },
    };
  });

  return json(payload);
}
