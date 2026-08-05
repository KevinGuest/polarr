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

export function AdminLidarrClient() {
  const [lidarrUrl, setLidarrUrl] = useState("");
  const [lidarrApiKey, setLidarrApiKey] = useState("");
  const [musicRoot, setMusicRoot] = useState("");
  const [status, setStatus] = useState("…");
  const [message, setMessage] = useState<string | null>(null);
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
      setLidarrUrl(settings.lidarrUrl || "");
      setLidarrApiKey(settings.lidarrApiKey || "");
      setMusicRoot(settings.musicRoot || "");

      const st = await fetch("/api/admin/stats")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!cancelled && st?.lidarr) setStatus(st.lidarr);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(test = false) {
    setMessage(null);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        test
          ? { testLidarr: true, lidarrUrl, lidarrApiKey }
          : {
              lidarrUrl,
              lidarrApiKey,
              musicRoot,
              fallbackEnabled: true,
            },
      ),
    });
    if (res.status === 403 || res.status === 401) {
      setForbidden(true);
      return;
    }
    const data = await res.json();
    if (test) {
      setMessage(data.ok ? "Lidarr connection OK" : data.error || "Failed");
      if (data.ok) {
        const v = data.status?.version;
        setStatus(v ? `Connected · v${v}` : "Connected");
      } else {
        setStatus("Offline");
      }
      return;
    }
    setMessage(res.ok ? "Saved" : data.error || "Save failed");
  }

  if (forbidden) {
    return (
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Lidarr</h1>
        <p className="text-sm text-muted-foreground">
          Admin only. Sign in with an admin account to configure Lidarr.
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
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          Lidarr
        </h1>
        <p className="text-sm text-muted-foreground">
          Catalog and request connection for this homeserver.
        </p>
      </div>

      <div className="rounded-xl border border-border px-4 py-4">
        <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Status
        </div>
        <div className="mt-2 text-sm font-semibold">{status}</div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Connection</CardTitle>
            <CardDescription>
              Point Polarr at your Lidarr instance. Music is scanned from the
              root path below when files land.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Lidarr URL</Label>
              <Input
                value={lidarrUrl}
                onChange={(e) => setLidarrUrl(e.target.value)}
                placeholder="http://localhost:8686"
              />
            </div>
            <div className="space-y-2">
              <Label>Lidarr API key</Label>
              <Input
                value={lidarrApiKey}
                onChange={(e) => setLidarrApiKey(e.target.value)}
                placeholder="••••••••"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label>Music root path</Label>
              <Input
                value={musicRoot}
                onChange={(e) => setMusicRoot(e.target.value)}
                placeholder="./music"
              />
            </div>
            {message ? (
              <p className="text-sm text-foreground">{message}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save(false)}>Save</Button>
              <Button variant="secondary" onClick={() => void save(true)}>
                Test connection
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
