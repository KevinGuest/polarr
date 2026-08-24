import { Suspense } from "react";
import { PlaylistClient } from "@/components/playlist-client";

export default async function PlaylistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <PlaylistClient playlistId={decodeURIComponent(id)} />
    </Suspense>
  );
}
