"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ListenHoursChart,
  type ListenDashboard,
} from "@/components/listen-hours-chart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toastError, toastSaved } from "@/lib/toast";

type Snapshot = {
  version: string;
  uptimeSec: number;
  users: number;
  tracks: number;
  albums: number;
  artists: number;
  requestsTotal: number;
  openInvites: number;
  lidarr: string;
  email: string;
  ytDlp: string;
  ffmpeg: string;
  listening?: ListenDashboard;
};

function formatUptime(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function formatMinutes(mins: number) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function AdminInfoClient() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [serverName, setServerName] = useState("Polarr");
  const [publicUrl, setPublicUrl] = useState("");
  const [savingServer, setSavingServer] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [statsRes, settingsRes] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/settings"),
      ]);
      if (cancelled) return;
      if (statsRes.status === 403 || statsRes.status === 401) {
        setForbidden(true);
        return;
      }
      const json = await statsRes.json();
      setData(json);
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        setServerName(settings.serverName || "Polarr");
        setPublicUrl(settings.publicUrl || "");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveServer() {
    setSavingServer(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverName, publicUrl }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(
          typeof json.error === "string" ? json.error : "Save failed",
        );
        return;
      }
      if (json.settings) {
        setServerName(json.settings.serverName || serverName);
        setPublicUrl(json.settings.publicUrl || publicUrl);
      }
      toastSaved();
    } finally {
      setSavingServer(false);
    }
  }

  if (forbidden) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Info</h1>
        <p className="text-sm text-muted-foreground">
          Admin only. Sign in with an admin account to view server stats.
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
    <div className="mx-auto max-w-3xl space-y-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Info
        </h1>
        <p className="text-sm text-muted-foreground">
          Overview of this Polarr homeserver.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Homeserver
        </h2>
        <div className="space-y-4 rounded-xl border border-border px-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="server-name">Server name</Label>
            <Input
              id="server-name"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="public-url">Public URL (for mobile clients)</Label>
            <Input
              id="public-url"
              value={publicUrl}
              onChange={(e) => setPublicUrl(e.target.value)}
              placeholder="http://localhost:3000"
            />
          </div>
          <Button
            type="button"
            disabled={savingServer}
            onClick={() => void saveServer()}
          >
            {savingServer ? "Saving…" : "Save"}
          </Button>
        </div>
      </section>

      {!data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Server
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["Uptime", formatUptime(data.uptimeSec)],
                  ["Version", data.version],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl border border-border px-4 py-4"
                >
                  <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                    {label}
                  </div>
                  <div className="mt-2 truncate text-sm font-semibold">
                    {value}
                  </div>
                </div>
              ))}
              {(
                [
                  ["Users", String(data.users), "/admin/users"],
                  [
                    "Open invites",
                    String(data.openInvites),
                    "/admin/invites",
                  ],
                ] as const
              ).map(([label, value, href]) => (
                <Link
                  key={label}
                  href={href}
                  className="rounded-xl border border-border px-4 py-4 transition-colors hover:border-foreground/30"
                >
                  <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                    {label}
                  </div>
                  <div className="mt-2 text-sm font-semibold">{value}</div>
                </Link>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Library & activity
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  [
                    "Total minutes listened",
                    formatMinutes(data.listening?.totalMinutes ?? 0),
                  ],
                  [
                    "Top listener",
                    data.listening?.topListener?.username ?? "—",
                  ],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl border border-border px-4 py-4"
                >
                  <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                    {label}
                  </div>
                  <div className="mt-2 truncate text-sm font-semibold">
                    {value}
                  </div>
                </div>
              ))}
              {(
                [
                  ["Tracks", String(data.tracks), "/library"],
                  ["Albums", String(data.albums), "/library"],
                  ["Artists", String(data.artists), "/library"],
                  [
                    "Requests",
                    `${data.requestsTotal} total`,
                    "/admin/requests",
                  ],
                ] as const
              ).map(([label, value, href]) => (
                <Link
                  key={label}
                  href={href}
                  className="rounded-xl border border-border px-4 py-4 transition-colors hover:border-foreground/30"
                >
                  <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                    {label}
                  </div>
                  <div className="mt-2 text-sm font-semibold">{value}</div>
                </Link>
              ))}
            </div>
            {data.listening ? <ListenHoursChart data={data.listening} /> : null}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Integrations
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Link
                href="/admin/lidarr"
                className="rounded-xl border border-border px-4 py-4 transition-colors hover:border-foreground/30"
              >
                <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  Lidarr
                </div>
                <div className="mt-2 text-sm font-semibold">{data.lidarr}</div>
              </Link>
              <Link
                href="/admin/import"
                className="rounded-xl border border-border px-4 py-4 transition-colors hover:border-foreground/30"
              >
                <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  Import
                </div>
                <div className="mt-2 text-sm font-semibold">
                  Spotify playlists
                </div>
              </Link>
              <Link
                href="/admin/email"
                className="rounded-xl border border-border px-4 py-4 transition-colors hover:border-foreground/30"
              >
                <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  SMTP
                </div>
                <div className="mt-2 text-sm font-semibold">{data.email}</div>
              </Link>
              <div className="rounded-xl border border-border px-4 py-4">
                <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  yt-dlp
                </div>
                <div className="mt-2 text-sm font-semibold">{data.ytDlp}</div>
              </div>
              <div className="rounded-xl border border-border px-4 py-4">
                <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  ffmpeg
                </div>
                <div className="mt-2 text-sm font-semibold">{data.ffmpeg}</div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
