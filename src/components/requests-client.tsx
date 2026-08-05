"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

type RequestRow = {
  id: string;
  mediaType?: string;
  title: string;
  artist: string;
  album: string;
  status: string;
  source: string;
  error?: string | null;
  createdAt: string;
  availableAt?: string | null;
};

type DownloadRow = {
  id: string;
  title: string;
  artist: string;
  status: string;
  progress: number;
  error?: string | null;
};

type Stats = {
  total: number;
  byStatus: Record<string, number>;
  tracks: number;
};

export function RequestsClient() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [downloads, setDownloads] = useState<DownloadRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  async function refresh() {
    const [r, d] = await Promise.all([
      fetch("/api/requests").then((x) => x.json()),
      fetch("/api/downloads").then((x) => x.json()),
    ]);
    setRequests(r.requests || []);
    setStats(r.stats || null);
    setDownloads(d.downloads || []);
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Lidarr queues and fallback download jobs.
        </p>
        {stats && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{stats.tracks} tracks in library</span>
            <span>·</span>
            <span>{stats.total} requests</span>
            {Object.entries(stats.byStatus).map(([status, n]) => (
              <Badge key={status} variant="outline">
                {status}: {n}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Request history
        </h2>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests yet.</p>
        ) : (
          <ul className="space-y-2">
            {requests.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm"
              >
                <div>
                  <div className="font-medium">
                    {r.artist} — {r.title}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.mediaType || "album"} ·{" "}
                    {new Date(r.createdAt).toLocaleString()}
                    {r.availableAt
                      ? ` · available ${new Date(r.availableAt).toLocaleString()}`
                      : ""}
                    {r.error ? ` · ${r.error}` : ""}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline">{r.source}</Badge>
                  <Badge
                    variant={
                      r.status === "failed"
                        ? "warn"
                        : r.status === "available"
                          ? "success"
                          : "secondary"
                    }
                  >
                    {r.status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Fallback downloads
        </h2>
        {downloads.length === 0 ? (
          <p className="text-sm text-muted-foreground">No fallback jobs.</p>
        ) : (
          <ul className="space-y-3">
            {downloads.map((d) => (
              <li
                key={d.id}
                className="rounded-lg border border-border bg-card px-4 py-3 shadow-sm"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">
                    {d.artist} — {d.title}
                  </div>
                  <Badge variant="outline">{d.status}</Badge>
                </div>
                <Progress value={d.progress} />
                {d.error && (
                  <p className="mt-2 text-xs text-destructive">{d.error}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
