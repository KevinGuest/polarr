import { Suspense } from "react";
import { SettingsClient } from "@/components/settings-client";

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-2xl space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <SettingsClient />
    </Suspense>
  );
}
