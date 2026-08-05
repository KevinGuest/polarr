import { Suspense } from "react";
import { LibraryClient } from "@/components/library-client";

export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
      <LibraryClient />
    </Suspense>
  );
}
