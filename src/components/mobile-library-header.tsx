"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { LibraryCreateMenu } from "@/components/library-create-menu";

export function MobileLibraryHeader() {
  return (
    <div className="flex items-center gap-3">
      <h1 className="min-w-0 flex-1 text-2xl font-bold leading-tight tracking-tight text-foreground">
        Your Library
      </h1>
      <Link
        href="/search?scope=library"
        aria-label="Search library"
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        <Search className="size-5" strokeWidth={2} />
      </Link>
      <LibraryCreateMenu variant="header" />
    </div>
  );
}
