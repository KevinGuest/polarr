import { Suspense } from "react";
import { LibraryClient } from "@/components/library-client";
import { LibrarySidebar } from "@/components/library-sidebar";

export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <LibrarySidebar variant="page" />
      </div>
      <div className="hidden lg:block">
        <LibraryClient />
      </div>
    </Suspense>
  );
}
