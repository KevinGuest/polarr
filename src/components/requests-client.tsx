"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Square } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  downloadJobId?: string | null;
  coverPath?: string | null;
};

type DownloadRow = {
  id: string;
  title: string;
  artist: string;
  status: string;
  progress: number;
  error?: string | null;
  coverPath?: string | null;
};

type Stats = {
  total: number;
  byStatus: Record<string, number>;
  tracks: number;
};

function sourceLabel(source: string) {
  if (source === "fallback") return "acquire";
  if (source === "lidarr") return "catalog";
  return source;
}

function isStoppableStatus(status: string) {
  return (
    status === "pending" ||
    status === "queued" ||
    status === "downloading" ||
    status === "running"
  );
}

export function RequestsClient() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [downloads, setDownloads] = useState<DownloadRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [stopping, setStopping] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    const [r, d] = await Promise.all([
      fetch("/api/requests"),
      fetch("/api/downloads"),
    ]);
    if (r.status === 403) {
      setForbidden(true);
      return;
    }
    setForbidden(false);
    const rj = await r.json();
    const dj = await d.json();
    setRequests(rj.requests || []);
    setStats(rj.stats || null);
    setDownloads(dj.downloads || []);
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, []);

  async function stop(payload: { requestId?: string; jobId?: string }) {
    const key = payload.requestId || payload.jobId || "";
    setStopping(key);
    setMsg(null);
    const res = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop", ...payload }),
    });
    const data = await res.json();
    setStopping(null);
    if (!res.ok) {
      setMsg(data.error || "Stop failed");
      return;
    }
    setMsg("Stop signal sent");
    void refresh();
  }

  const downloadById = new Map(downloads.map((d) => [d.id, d]));
  const activeJobs = downloads.filter(
    (d) =>
      !requests.some((r) => r.downloadJobId === d.id) &&
      isStoppableStatus(d.status),
  );

  if (forbidden) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
        <p className="text-sm text-muted-foreground">
          This activity log is for admins only. Sign in as admin to view and
          stop jobs.
        </p>
        <Button asChild variant="outline">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Requests
        </h1>
        <p className="text-sm text-muted-foreground">
          Acquisition log, failures, and admin stop controls.
        </p>
        {stats && (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
            <span>{stats.tracks} tracks</span>
            <span>·</span>
            <span>{stats.total} requests</span>
            {Object.entries(stats.byStatus).map(([status, n]) => (
              <Badge key={status} variant="outline">
                {status}: {n}
              </Badge>
            ))}
          </div>
        )}
        {msg && <p className="text-sm text-foreground">{msg}</p>}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Activity</h2>
        {requests.length === 0 && activeJobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing logged yet.</p>
        ) : (
          <ul className="space-y-3">
            {requests.map((r) => {
              const job = r.downloadJobId
                ? downloadById.get(r.downloadJobId)
                : undefined;
              const progress =
                job && isStoppableStatus(job.status)
                  ? job.progress
                  : r.status === "available"
                    ? 100
                    : undefined;
              const canStop =
                isStoppableStatus(r.status) ||
                (job ? isStoppableStatus(job.status) : false);
              const coverSeed = `${r.artist}-${r.album || r.title}`;
              const isArtist = (r.mediaType || "album") === "artist";
              return (
                <li
                  key={r.id}
                  className="rounded-xl border border-border px-4 py-4"
                >
                  <div className="flex items-start gap-3">
                    <CoverArt
                      seed={coverSeed}
                      image={r.coverPath}
                      className={`size-12 shrink-0 ${isArtist ? "rounded-full" : "rounded-md"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="font-medium">
                            {r.artist} — {r.title}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {r.mediaType || "album"} ·{" "}
                            {new Date(r.createdAt).toLocaleString()}
                            {r.availableAt
                              ? ` · ready ${new Date(r.availableAt).toLocaleString()}`
                              : ""}
                          </div>
                          {(r.error || job?.error) && (
                            <p className="text-xs text-destructive">
                              {r.error || job?.error}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <Badge variant="outline">
                            {sourceLabel(r.source)}
                          </Badge>
                          <Badge
                            variant={
                              r.status === "failed"
                                ? "warn"
                                : r.status === "available"
                                  ? "success"
                                  : r.status === "cancelled"
                                    ? "outline"
                                    : "secondary"
                            }
                          >
                            {r.status}
                          </Badge>
                          {canStop && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={stopping === r.id}
                              onClick={() =>
                                void stop({
                                  requestId: r.id,
                                  jobId: r.downloadJobId || undefined,
                                })
                              }
                            >
                              <Square className="size-3.5 fill-current" />
                              {stopping === r.id ? "…" : "Stop"}
                            </Button>
                          )}
                        </div>
                      </div>
                      {progress != null &&
                        r.status !== "available" &&
                        r.status !== "cancelled" && (
                          <Progress className="mt-3" value={progress} />
                        )}
                    </div>
                  </div>
                </li>
              );
            })}
            {activeJobs.map((d) => (
              <li
                key={d.id}
                className="rounded-xl border border-border px-4 py-4"
              >
                <div className="flex items-start gap-3">
                  <CoverArt
                    seed={`${d.artist}-${d.title}`}
                    image={d.coverPath}
                    className="size-12 shrink-0 rounded-md"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">
                        {d.artist} — {d.title}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{d.status}</Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={stopping === d.id}
                          onClick={() => void stop({ jobId: d.id })}
                        >
                          <Square className="size-3.5 fill-current" />
                          {stopping === d.id ? "…" : "Stop"}
                        </Button>
                      </div>
                    </div>
                    <Progress value={d.progress} />
                    {d.error && (
                      <p className="mt-2 text-xs text-destructive">{d.error}</p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
