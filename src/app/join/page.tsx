import { redirect } from "next/navigation";
import { JoinForm } from "@/components/join-form";
import { hasUsers, getSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  if (!hasUsers() || !getSettings().setupComplete) {
    redirect("/setup");
  }
  const params = await searchParams;
  return <JoinForm initialCode={(params.code || "").toUpperCase()} />;
}
