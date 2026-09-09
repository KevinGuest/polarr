"use client";

import Link from "next/link";

/** Import by URL lives on the user Account page — not an admin integration. */
export function AdminImportClient() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Import</h1>
        <p className="text-sm text-muted-foreground">
          Playlist and album import is a user feature. Anyone signed in can
          paste a Spotify, YouTube Music, or Deezer link under Account →
          Playlists — no admin credentials.
        </p>
      </div>
      <Link
        href="/settings?tab=playlists"
        className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
      >
        Open Account → Playlists
      </Link>
    </div>
  );
}
