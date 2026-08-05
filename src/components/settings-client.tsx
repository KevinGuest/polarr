"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function SettingsClient() {
  const [serverName, setServerName] = useState("Polarr");
  const [lidarrUrl, setLidarrUrl] = useState("");
  const [lidarrApiKey, setLidarrApiKey] = useState("");
  const [musicRoot, setMusicRoot] = useState("");
  const [fallbackEnabled, setFallbackEnabled] = useState(true);
  const [publicUrl, setPublicUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState("");
  const [admin, setAdmin] = useState({
    lidarr: "…",
    tracks: "…",
    requests: "…",
    fallback: "…",
  });

  useEffect(() => {
    void Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/status").then((r) => r.json()),
      fetch("/api/library").then((r) => r.json()).catch(() => ({ tracks: [] })),
      fetch("/api/requests")
        .then((r) => r.json())
        .catch(() => ({ requests: [], stats: null })),
    ]).then(([settings, st, lib, req]) => {
      setServerName(settings.serverName || "Polarr");
      setLidarrUrl(settings.lidarrUrl || "");
      setLidarrApiKey(settings.lidarrApiKey || "");
      setMusicRoot(settings.musicRoot || "");
      setFallbackEnabled(Boolean(settings.fallbackEnabled));
      setPublicUrl(settings.publicUrl || "");
      setStatusLine(
        `Lidarr ${st.lidarr?.ok ? `ok (${st.lidarr.version || "connected"})` : "offline"} · yt-dlp ${st.fallback?.ytDlp ? "ready" : "not found"}`,
      );
      setAdmin({
        lidarr: st.lidarr?.ok
          ? `Connected${st.lidarr.version ? ` · v${st.lidarr.version}` : ""}`
          : "Offline",
        tracks: `${(lib.tracks || []).length} tracks`,
        requests: `${req.stats?.total ?? (req.requests || []).length} total`,
        fallback: st.fallback?.enabled
          ? st.fallback.ytDlp
            ? "yt-dlp ready"
            : "Enabled"
          : "Disabled",
      });
    });
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
              serverName,
              lidarrUrl,
              lidarrApiKey,
              musicRoot,
              fallbackEnabled,
              publicUrl,
            },
      ),
    });
    const data = await res.json();
    if (test) {
      setMessage(data.ok ? "Lidarr connection OK" : data.error || "Failed");
      return;
    }
    setMessage(res.ok ? "Saved" : data.error || "Save failed");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-6 md:px-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Admin
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">{statusLine}</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Admin dashboard
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["Lidarr", admin.lidarr],
              ["Library", admin.tracks],
              ["Requests", admin.requests],
              ["Fallback", admin.fallback],
            ] as const
          ).map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg border border-border px-4 py-4"
            >
              <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                {label}
              </div>
              <div className="mt-2 text-sm font-semibold">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>
            Configure Lidarr the same way Seerr points at Sonarr/Radarr.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Server name</Label>
            <Input
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Public URL (for mobile clients)</Label>
            <Input
              value={publicUrl}
              onChange={(e) => setPublicUrl(e.target.value)}
              placeholder="http://umbrel.local:3647"
            />
          </div>
          <div className="space-y-2">
            <Label>Lidarr URL</Label>
            <Input
              value={lidarrUrl}
              onChange={(e) => setLidarrUrl(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Lidarr API key</Label>
            <Input
              value={lidarrApiKey}
              onChange={(e) => setLidarrApiKey(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Music root path (inside container/server)</Label>
            <Input
              value={musicRoot}
              onChange={(e) => setMusicRoot(e.target.value)}
              placeholder="/music"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-3">
            <div>
              <div className="text-sm font-medium">Fallback acquisition</div>
              <div className="text-xs text-muted-foreground">
                Uses yt-dlp when Lidarr cannot fulfill a request
              </div>
            </div>
            <Switch
              checked={fallbackEnabled}
              onCheckedChange={setFallbackEnabled}
            />
          </div>
          {message && <p className="text-sm text-foreground">{message}</p>}
          <div className="flex gap-2">
            <Button onClick={() => void save(false)}>Save</Button>
            <Button variant="secondary" onClick={() => void save(true)}>
              Test Lidarr
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
