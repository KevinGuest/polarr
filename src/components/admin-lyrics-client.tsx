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

export function AdminLyricsClient() {
  const [geniusClientId, setGeniusClientId] = useState("");
  const [geniusClientSecret, setGeniusClientSecret] = useState("");
  const [geniusAccessToken, setGeniusAccessToken] = useState("");
  const [geniusConfigured, setGeniusConfigured] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);

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
      setGeniusClientId(settings.geniusClientId || "");
      setGeniusClientSecret(settings.geniusClientSecret || "");
      setGeniusAccessToken(settings.geniusAccessToken || "");
      setGeniusConfigured(Boolean(settings.geniusConfigured));
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveGenius() {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        geniusClientId,
        geniusClientSecret,
        geniusAccessToken,
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
    setGeniusConfigured(Boolean(data.settings?.geniusConfigured));
    if (data.settings?.geniusClientSecret) {
      setGeniusClientSecret(data.settings.geniusClientSecret);
    }
    if (data.settings?.geniusAccessToken) {
      setGeniusAccessToken(data.settings.geniusAccessToken);
    }
    toastSaved();
  }

  async function testGenius() {
    setTesting(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testGenius: true,
          geniusClientId,
          geniusClientSecret,
          geniusAccessToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toastError(
          typeof data.error === "string" ? data.error : "Genius test failed",
        );
        return;
      }
      const speakers = Array.isArray(data.result?.speakers)
        ? data.result.speakers.join(", ")
        : "";
      toastSaved(
        speakers
          ? `Genius OK · ${speakers}`
          : `Genius OK · ${data.result?.hit?.title || "connected"}`,
      );
      setGeniusConfigured(true);
    } finally {
      setTesting(false);
    }
  }

  if (forbidden) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold tracking-tight">Lyrics</h1>
        <p className="text-sm text-muted-foreground">
          Admin only. Sign in with an admin account to configure lyrics.
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
        <h1 className="text-xl font-semibold tracking-tight">Lyrics</h1>
        <p className="text-sm text-muted-foreground">
          Synced times come from LRCLIB. Genius adds who sings which section on
          duets (left / right karaoke layout).
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Genius</CardTitle>
              <CardDescription>
                Create an API client at{" "}
                <a
                  href="https://genius.com/api-clients"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  genius.com/api-clients
                </a>{" "}
                and paste the Client ID, Client Secret, and Access Token. The
                access token is used for song search; section headers are read
                from the public song page.
                {geniusConfigured ? " · Configured" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Client ID</Label>
                <Input
                  value={geniusClientId}
                  onChange={(e) => setGeniusClientId(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label>Client secret</Label>
                <Input
                  type="password"
                  value={geniusClientSecret}
                  onChange={(e) => setGeniusClientSecret(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label>Access token</Label>
                <Input
                  type="password"
                  value={geniusAccessToken}
                  onChange={(e) => setGeniusAccessToken(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void saveGenius()}>Save Genius</Button>
                <Button
                  variant="outline"
                  disabled={testing}
                  onClick={() => void testGenius()}
                >
                  {testing ? "Testing…" : "Test connection"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="rounded-xl border border-border px-4 py-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">How it works</p>
            <p className="mt-1.5 leading-relaxed">
              On featured / duo tracks, Polarr matches Genius{" "}
              <span className="text-foreground">[Verse: Artist]</span> headers
              onto timed lines. Without Genius, layout falls back to weaker
              heuristics. Client ID / secret are stored for your records; search
              uses the access token (public search is used if the token is
              empty).
            </p>
          </div>
        </>
      )}
    </div>
  );
}
