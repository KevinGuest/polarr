import { Suspense } from "react";
import { AlbumClient } from "@/components/album-client";

export default async function AlbumPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <AlbumClient albumId={id} />
    </Suspense>
  );
}
