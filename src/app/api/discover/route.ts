import { json, getAuthUser } from "@/lib/api";
import { getDiscoverFeed } from "@/lib/discover";

export const dynamic = "force-dynamic";

/**
 * Home feed: Latest → Explore → artists.
 * Response is process-cached ~10m per user (see getDiscoverFeed).
 */
export async function GET() {
  const user = await getAuthUser();
  const payload = await getDiscoverFeed(user?.id ?? null);
  return json(payload, {
    headers: {
      // Browser may reuse briefly; server TTL is the real warm path.
      "Cache-Control": "private, max-age=60, stale-while-revalidate=540",
    },
  });
}
