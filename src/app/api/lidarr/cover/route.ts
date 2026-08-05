import { getAuthUser, json } from "@/lib/api";
import { getSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Map Lidarr UI MediaCover paths → authenticated /api/v1/mediacover routes. */
function toLidarrApiPath(src: string): string | null {
  const clean = src.split("?")[0];
  const album = clean.match(/^\/MediaCover\/Albums\/(\d+)\/([^/]+)$/i);
  if (album) return `/api/v1/mediacover/album/${album[1]}/${album[2]}`;
  const artist = clean.match(/^\/MediaCover\/(\d+)\/([^/]+)$/i);
  if (artist) return `/api/v1/mediacover/artist/${artist[1]}/${artist[2]}`;
  return null;
}

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const src = (new URL(req.url).searchParams.get("src") || "").trim();
  if (
    !src.startsWith("/MediaCover/") ||
    src.includes("..") ||
    src.includes("://")
  ) {
    return json({ error: "Invalid src" }, { status: 400 });
  }

  const apiPath = toLidarrApiPath(src);
  if (!apiPath) {
    return json({ error: "Unsupported cover path" }, { status: 400 });
  }

  const settings = getSettings();
  if (!settings.lidarrUrl || !settings.lidarrApiKey) {
    return json({ error: "Lidarr not configured" }, { status: 400 });
  }

  const base = settings.lidarrUrl.replace(/\/+$/, "");
  const upstream = await fetch(`${base}${apiPath}`, {
    headers: { "X-Api-Key": settings.lidarrApiKey },
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    return json(
      { error: `Lidarr cover ${upstream.status}` },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  const contentType = upstream.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) {
    return json({ error: "Lidarr did not return an image" }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=86400",
    },
  });
}
