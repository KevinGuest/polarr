import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BrowseArtistsClient } from "@/components/browse-artists-client";
import { getSettings, getUserByToken, hasUsers } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function BrowseArtistsPage() {
  const settings = getSettings();
  if (!settings.setupComplete || !hasUsers()) redirect("/setup");

  const cookieStore = await cookies();
  const token = cookieStore.get("polarr_token")?.value;
  const user = getUserByToken(token);
  if (!user) redirect("/login");

  return <BrowseArtistsClient />;
}
