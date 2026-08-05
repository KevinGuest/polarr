import { Suspense } from "react";
import { SearchClient } from "@/components/search-client";

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <p className="text-sm text-muted-foreground">Loading search…</p>
      }
    >
      <SearchClient />
    </Suspense>
  );
}
