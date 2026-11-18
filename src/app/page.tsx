import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { HomeClient } from "@/components/home-client";
import { peekDiscoverFeed } from "@/lib/discover";
import { getSettings, getUserByToken, hasUsers } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const settings = getSettings();
  if (!settings.setupComplete || !hasUsers()) {
    redirect("/setup");
  }

  const cookieStore = await cookies();
  const token = cookieStore.get("polarr_token")?.value;
  const user = getUserByToken(token);
  if (!user) {
    redirect("/login");
  }

  // Never hold the page behind the feed build (10+ s cold: Lidarr,
  // MusicBrainz, Deezer). Paint whatever is cached now; HomeClient fetches
  // /api/discover and swaps in the personal feed when it lands.
  const initialDiscover = peekDiscoverFeed(user.id);

  return <HomeClient initialDiscover={initialDiscover} />;
}
