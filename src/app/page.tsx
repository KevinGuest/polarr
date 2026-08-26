import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { HomeClient } from "@/components/home-client";
import { getDiscoverFeed } from "@/lib/discover";
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

  const initialDiscover = await getDiscoverFeed(user.id).catch(() => null);

  return <HomeClient initialDiscover={initialDiscover} />;
}
