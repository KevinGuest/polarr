import { TopTracksClient } from "@/components/top-tracks-client";

export default async function PublicTopTracksPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  return <TopTracksClient username={decodeURIComponent(username)} />;
}
