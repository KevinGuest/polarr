"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toastError, toastSaved } from "@/lib/toast";

export function AdminImportClient() {
  const [spotifyClientId, setSpotifyClientId] = useState("");
  const [spotifyClientSecret, setSpotifyClientSecret] = useState("");
  const [spotifyConfigured, setSpotifyConfigured] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/settings");
      if (cancelled) return;
      if (res.status === 403 || res.status === 401) {
        setForbidden(true);
        setLoading(false);
        return;
      }
      const settings = await res.json();
      setSpotifyClientId(settings.spotifyClientId || "");
      setSpotifyClientSecret(settings.spotifyClientSecret || "");
      setSpotifyConfigured(Boolean(settings.spotifyConfigured));
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveSpotify() {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spotifyClientId,
        spotifyClientSecret,
      }),
    });
    if (res.status === 403 || res.status === 401) {
      setForbidden(true);
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      toastError(typeof data.error === "string" ? data.error : "Save failed");
      return;
    }
    setSpotifyConfigured(Boolean(data.settings?.spotifyConfigured));
    if (data.settings?.spotifyClientSecret) {
      setSpotifyClientSecret(data.settings.spotifyClientSecret);
    }
    toastSaved();
  }

  if (forbidden) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold tracking-tight">Import</h1>
        <p className="text-sm text-muted-foreground">
          Admin only. Sign in with an admin account to configure import sources.
        </p>
        <Link
          href="/login"
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Import</h1>
        <p className="text-sm text-muted-foreground">
          Connect external services so users can pull playlists into Polarr by
          link (Account → Playlists).
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Spotify</CardTitle>
              <CardDescription>
                Create a free app at{" "}
                <a
                  href="https://developer.spotify.com/dashboard"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  developer.spotify.com
                </a>{" "}
                and paste the Client ID & Secret. Public playlist import from
                Account uses the Client Credentials flow.
                {spotifyConfigured ? " · Configured" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Client ID</Label>
                <Input
                  value={spotifyClientId}
                  onChange={(e) => setSpotifyClientId(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label>Client secret</Label>
                <Input
                  type="password"
                  value={spotifyClientSecret}
                  onChange={(e) => setSpotifyClientSecret(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="off"
                />
              </div>
              <Button onClick={() => void saveSpotify()}>Save Spotify</Button>
            </CardContent>
          </Card>

          <div className="rounded-xl border border-border px-4 py-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">YouTube Music & Deezer</p>
            <p className="mt-1.5 leading-relaxed">
              Playlist import by URL works without extra credentials. Users
              import from Account → Playlists.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
