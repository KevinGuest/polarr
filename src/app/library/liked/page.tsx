import { Suspense } from "react";
import { LibraryClient } from "@/components/library-client";

export default function LikedSongsPage() {
  return (
    <Suspense fallback={null}>
      <LibraryClient mode="liked" />
    </Suspense>
  );
}
