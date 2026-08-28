import { json, requireAuth } from "@/lib/api";
import { getDiscoverFeed } from "@/lib/discover";

export const dynamic = "force-dynamic";

/**
 * Home feed: Latest → Explore → artists.
 * Response is process-cached ~10m per user (see getDiscoverFeed).
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  const payload = await getDiscoverFeed(auth.user.id);
  return json(payload, {
    headers: {
      // Browser may reuse briefly; server TTL is the real warm path.
      "Cache-Control": "private, max-age=60, stale-while-revalidate=540",
    },
  });
}
