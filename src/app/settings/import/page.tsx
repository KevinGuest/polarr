import { Suspense } from "react";
import { PlaylistImportClient } from "@/components/playlist-import-client";

export default function SettingsImportPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-2xl space-y-2">
          <h1 className="text-[2rem] font-semibold tracking-tight">Import</h1>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <PlaylistImportClient />
    </Suspense>
  );
}
