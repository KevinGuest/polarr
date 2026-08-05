import { json } from "@/lib/api";
import { searchTracksLocal } from "@/lib/db";
import { LidarrClient } from "@/lib/lidarr";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  if (!q) return json({ local: [], lidarr: [] });

  const local = searchTracksLocal(q, 40);
  let lidarr: Awaited<ReturnType<LidarrClient["lookup"]>> = [];
  let lidarrError: string | null = null;

  try {
    const client = LidarrClient.fromSettings();
    if (client) lidarr = await client.lookup(q);
  } catch (err) {
    lidarrError = err instanceof Error ? err.message : "Lidarr search failed";
  }

  return json({ query: q, local, lidarr, lidarrError });
}
