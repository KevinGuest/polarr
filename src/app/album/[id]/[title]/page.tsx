import { Suspense } from "react";
import { AlbumClient } from "@/components/album-client";

/** Clean album link: /album/{artist-slug}/{title-slug}. */
export default async function AlbumSlugPage({
  params,
}: {
  params: Promise<{ id: string; title: string }>;
}) {
  const { id, title } = await params;
  return (
    <Suspense fallback={null}>
      <AlbumClient albumId={`${id}/${title}`} slug={{ artist: id, title }} />
    </Suspense>
  );
}
