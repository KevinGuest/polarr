"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
import { toastError, toastSaved } from "@/lib/toast";

const SCAN_PRESETS = [0, 15, 30, 60] as const;
type ScanMinutes = (typeof SCAN_PRESETS)[number];

type DetectedRoot = {
  path: string;
  label: string;
  source: string;
  exists: boolean;
};

const CUSTOM_ROOT = "__custom__";

const SCAN_PRESETS = [0, 15, 30, 60] as const;
type ScanMinutes = (typeof SCAN_PRESETS)[number];

export function AdminLidarrClient() {
  const [lidarrUrl, setLidarrUrl] = useState("");
  const [lidarrApiKey, setLidarrApiKey] = useState("");
  const [musicRoot, setMusicRoot] = useState("");
  const [musicRoots, setMusicRoots] = useState<DetectedRoot[]>([]);
  const [customMusicRoot, setCustomMusicRoot] = useState(false);
  const [saveOnPlay, setSaveOnPlay] = useState(true);
  const [libraryScanMinutes, setLibraryScanMinutes] =
    useState<ScanMinutes>(30);
  const [status, setStatus] = useState("…");
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  function applySettings(settings: {
    lidarrUrl?: string;
    lidarrApiKey?: string;
    musicRoot?: string;
    detectedMusicRoots?: DetectedRoot[];
    saveOnPlay?: boolean;
    libraryScanMinutes?: number;
  }) {
    setLidarrUrl(settings.lidarrUrl || "");
    setLidarrApiKey(settings.lidarrApiKey || "");
    const root = settings.musicRoot || "";
    const detected: DetectedRoot[] = Array.isArray(settings.detectedMusicRoots)
      ? settings.detectedMusicRoots
      : [];
    setMusicRoots(detected);
    setMusicRoot(root);
    setCustomMusicRoot(
      Boolean(root) && !detected.some((d) => d.path === root),
    );
    setSaveOnPlay(settings.saveOnPlay !== false);
    const scan = Number(settings.libraryScanMinutes);
    setLibraryScanMinutes(
      SCAN_PRESETS.includes(scan as ScanMinutes) ? (scan as ScanMinutes) : 30,
    );
  }

  async function loadSettings() {
    const res = await fetch("/api/settings");
    if (res.status === 403 || res.status === 401) {
      setForbidden(true);
      return null;
    }
    return res.json();
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const settings = await loadSettings();
      if (cancelled) return;
      if (!settings) {
        setLoading(false);
        return;
      }
      applySettings(settings);

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

  async function saveLidarr(test = false) {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        test
          ? { testLidarr: true, lidarrUrl, lidarrApiKey }
          : {
              lidarrUrl,
              lidarrApiKey,
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
      if (data.ok) {
        const v = data.status?.version;
        setStatus(v ? `Connected · v${v}` : "Connected");
        toastSaved("Lidarr connection OK");
        const next = await loadSettings();
        if (next) applySettings(next);
      } else {
        setStatus("Offline");
        toastError(
          typeof data.error === "string" ? data.error : "Connection failed",
        );
      }
      return;
    }
    if (!res.ok) {
      toastError(typeof data.error === "string" ? data.error : "Save failed");
      return;
    }
    toastSaved();
    const next = await loadSettings();
    if (next) applySettings(next);
  }

  async function saveMusicRoot() {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ musicRoot: musicRoot.trim() }),
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
    toastSaved("Music location saved — scanning library…");
    void fetch("/api/library", { method: "POST" }).catch(() => null);
  }

  async function saveSaveOnPlay() {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saveOnPlay }),
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
    toastSaved();
  }

  async function saveLibraryScan() {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ libraryScanMinutes }),
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
    toastSaved();
  }

  if (forbidden) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold tracking-tight">Sources</h1>
        <p className="text-sm text-muted-foreground">
          Admin only. Sign in with an admin account to configure download
          sources.
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
        <h1 className="text-xl font-semibold tracking-tight">Sources</h1>
        <p className="text-sm text-muted-foreground">
          Optional Lidarr catalog connection. Lidarr is not required.
        </p>
      </div>

      <div className="rounded-xl border border-border px-4 py-4">
        <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Lidarr
        </div>
        <div className="mt-2 text-sm font-semibold">{status}</div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Lidarr</CardTitle>
              <CardDescription>
                Optional catalog and request connection. After connecting,
                pick your music folder below from folders Lidarr reports.
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
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void saveLidarr(false)}>Save</Button>
                <Button
                  variant="secondary"
                  onClick={() => void saveLidarr(true)}
                >
                  Test connection
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Music location</CardTitle>
              <CardDescription>
                Folder Polarr scans and streams from. Detected from Lidarr root
                folders and this container’s music mount — choose the one that
                actually has your files.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="music-root-select">Library folder</Label>
                <select
                  id="music-root-select"
                  value={customMusicRoot ? CUSTOM_ROOT : musicRoot}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === CUSTOM_ROOT) {
                      setCustomMusicRoot(true);
                      return;
                    }
                    setCustomMusicRoot(false);
                    setMusicRoot(v);
                  }}
                  className="flex h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  <option value="">Select a folder…</option>
                  {musicRoots.map((r) => (
                    <option key={`${r.source}:${r.path}`} value={r.path}>
                      {r.label}
                      {r.exists ? "" : " (not visible here)"}
                    </option>
                  ))}
                  <option value={CUSTOM_ROOT}>Custom path…</option>
                </select>
              </div>
              {customMusicRoot ? (
                <div className="space-y-2">
                  <Label htmlFor="music-root-custom">Custom path</Label>
                  <Input
                    id="music-root-custom"
                    value={musicRoot}
                    onChange={(e) => setMusicRoot(e.target.value)}
                    placeholder="/music"
                  />
                </div>
              ) : null}
              {musicRoot &&
              musicRoots.some((r) => r.path === musicRoot && !r.exists) ? (
                <p className="text-sm text-muted-foreground">
                  This path isn’t visible inside Polarr’s container. If Lidarr
                  uses a different mount, pick the mapped folder (often{" "}
                  <code className="text-xs">/music</code>) instead.
                </p>
              ) : null}
              <Button onClick={() => void saveMusicRoot()}>Save location</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Library scan</CardTitle>
              <CardDescription>
                Automatically index new files under the music root (and Polarr
                downloads). First scan runs shortly after startup.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="library-scan-interval">Scan every</Label>
                <select
                  id="library-scan-interval"
                  value={libraryScanMinutes}
                  onChange={(e) =>
                    setLibraryScanMinutes(
                      Number(e.target.value) as ScanMinutes,
                    )
                  }
                  className="flex h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={0}>Off (manual only)</option>
                </select>
              </div>
              <Button onClick={() => void saveLibraryScan()}>Save</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Save on play</CardTitle>
              <CardDescription>
                When you play a catalog track that is not already in the library
                (and Lidarr doesn’t already have the file), Polarr starts the
                live stream and saves a copy in the background. Tracks that are
                already local are left alone.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex h-10 items-center justify-between gap-3 rounded-md border border-border bg-background px-3">
                <Label htmlFor="save-on-play" className="cursor-pointer">
                  Save played tracks to library
                </Label>
                <Switch
                  id="save-on-play"
                  checked={saveOnPlay}
                  onCheckedChange={setSaveOnPlay}
                />
              </div>
              <Button onClick={() => void saveSaveOnPlay()}>Save</Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
