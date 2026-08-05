import { Suspense } from "react";
import { ArtistClient } from "@/components/artist-client";

export default function ArtistPage() {
  return (
    <Suspense fallback={null}>
      <ArtistClient />
    </Suspense>
  );
}
