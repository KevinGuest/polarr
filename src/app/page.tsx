import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { HomeClient } from "@/components/home-client";
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

  return <HomeClient />;
}
