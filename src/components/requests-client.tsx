"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, Loader2, RefreshCw, X } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

type ActivityUser = {
  username: string;
  avatarUrl: string | null;
};

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
  normalizedKey?: string;
  requestedBy?: string | null;
  streamers?: ActivityUser[];
};

type StreamRow = {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverPath?: string | null;
  createdAt: string;
  streamers: ActivityUser[];
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

type FilterId =
  | "all"
  | "streamed"
  | "downloading"
  | "downloaded"
  | "failed";

type ActivityKind =
  | "downloaded"
  | "downloading"
  | "streamed"
  | "catalog"
  | "failed"
  | "cancelled";

function isActiveDownloadStatus(status: string) {
  return (
    status === "pending" ||
    status === "queued" ||
    status === "downloading" ||
    status === "running"
  );
}

function requestKind(r: RequestRow, job?: DownloadRow): ActivityKind {
  if (r.status === "failed" || job?.status === "failed") return "failed";
  if (r.status === "cancelled" || job?.status === "cancelled") return "cancelled";
  if (
    isActiveDownloadStatus(r.status) ||
    (job && isActiveDownloadStatus(job.status))
  ) {
    return "downloading";
  }
  if (r.status === "available") {
    return r.source === "lidarr" ? "catalog" : "downloaded";
  }
  if (r.source === "lidarr") return "catalog";
  return "downloading";
}

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "downloading", label: "In Progress" },
  { id: "streamed", label: "Streamed" },
  { id: "downloaded", label: "Downloaded" },
  { id: "failed", label: "Failed" },
];

const PAGE_SIZE = 10;

export function RequestsClient() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [streams, setStreams] = useState<StreamRow[]>([]);
  const [downloads, setDownloads] = useState<DownloadRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState<FilterId>("all");
  const [page, setPage] = useState(1);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
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
    setStreams(rj.streams || []);
    setStats(rj.stats || null);
    setDownloads(dj.downloads || []);
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 2500);
    return () => clearInterval(t);
  }, []);

  async function stop(payload: { requestId?: string; jobId?: string }) {
    const key = payload.requestId || payload.jobId || "";
    setBusy(key);
    const res = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop", ...payload }),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) {
      toastError(data.error || "Stop failed");
      return;
    }
    void refresh();
  }

  async function retry(r: RequestRow) {
    setBusy(r.id);
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: r.title,
          artist: r.artist,
          album: r.album || r.title,
          type: r.mediaType || "track",
          prefer: r.source === "lidarr" ? "lidarr" : "fallback",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(
          typeof data.error === "string" ? data.error : "Retry failed",
        );
        return;
      }
      void refresh();
    } finally {
      setBusy(null);
    }
  }

  type ActivityItem =
    | {
        key: string;
        sortAt: string;
        kind: ActivityKind;
        type: "request";
        request: RequestRow;
        job?: DownloadRow;
        progress?: number;
      }
    | {
        key: string;
        sortAt: string;
        kind: "streamed";
        type: "stream";
        stream: StreamRow;
      }
    | {
        key: string;
        sortAt: string;
        kind: "downloading";
        type: "job";
        job: DownloadRow;
        progress: number;
      };

  const items = useMemo(() => {
    const byDownloadId = new Map(downloads.map((d) => [d.id, d]));
    const linkedJobs = new Set(
      requests.map((r) => r.downloadJobId).filter(Boolean) as string[],
    );
    const out: ActivityItem[] = [];

    for (const r of requests) {
      const job = r.downloadJobId
        ? byDownloadId.get(r.downloadJobId)
        : undefined;
      const kind = requestKind(r, job);
      const active =
        kind === "downloading" ||
        isActiveDownloadStatus(r.status) ||
        (job ? isActiveDownloadStatus(job.status) : false);
      const progress = active
        ? Math.round(
            job?.progress != null && job.progress > 0
              ? job.progress
              : r.status === "queued" || r.status === "pending"
                ? 0
                : 5,
          )
        : undefined;
      out.push({
        key: `req:${r.id}`,
        sortAt: r.createdAt,
        kind,
        type: "request",
        request: r,
        job,
        progress,
      });
    }

    for (const s of streams) {
      out.push({
        key: s.id,
        sortAt: s.createdAt,
        kind: "streamed",
        type: "stream",
        stream: s,
      });
    }

    for (const d of downloads) {
      if (linkedJobs.has(d.id) || !isActiveDownloadStatus(d.status)) continue;
      out.push({
        key: `job:${d.id}`,
        sortAt: new Date().toISOString(),
        kind: "downloading",
        type: "job",
        job: d,
        progress: Math.round(d.progress || 0),
      });
    }

    // Active downloads pin to the top; everything else newest-first.
    out.sort((a, b) => {
      const aActive = a.kind === "downloading" ? 1 : 0;
      const bActive = b.kind === "downloading" ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return Date.parse(b.sortAt) - Date.parse(a.sortAt);
    });
    return out;
  }, [requests, streams, downloads]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (filter === "all") return true;
      if (filter === "streamed") return item.kind === "streamed";
      if (filter === "downloading") return item.kind === "downloading";
      if (filter === "downloaded") {
        return item.kind === "downloaded" || item.kind === "catalog";
      }
      if (filter === "failed") return item.kind === "failed";
      return true;
    });
  }, [items, filter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  useEffect(() => {
    // Filter switch or shrinking list — snap back into range
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

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
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
        <p className="text-sm text-muted-foreground">
          Downloads, streams, and failures.
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
      </div>

      <div
        className="flex flex-wrap gap-1 border-b border-border pb-px"
        role="tablist"
        aria-label="Filter activity"
      >
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => {
              setFilter(f.id);
              setPage(1);
            }}
            className={cn(
              "-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors",
              filter === f.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <section className="space-y-2">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {filter === "all"
              ? "Nothing logged yet."
              : `No ${filter} activity.`}
          </p>
        ) : (
          <ul className="divide-y divide-border/70 rounded-xl border border-border">
            {pageItems.map((item) => {
              if (item.type === "stream") {
                const s = item.stream;
                return (
                  <li key={item.key} className="px-3 py-2.5 sm:px-4">
                    <div className="flex items-center gap-3">
                      <CoverArt
                        seed={`${s.artist}-${s.album || s.title}`}
                        image={s.coverPath}
                        className="size-10 shrink-0 rounded-md"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {s.artist} — {s.title}
                          </span>
                          <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-400">
                            streamed
                          </span>
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          track · {new Date(s.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <AvatarStack users={s.streamers} />
                    </div>
                  </li>
                );
              }

              if (item.type === "job") {
                const d = item.job;
                const busyHere = busy === d.id;
                return (
                  <li key={item.key} className="px-3 py-2.5 sm:px-4">
                    <div className="flex items-center gap-3">
                      <CoverArt
                        seed={`${d.artist}-${d.title}`}
                        image={d.coverPath}
                        className="size-10 shrink-0 rounded-md"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {d.artist} — {d.title}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          download
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <CircleProgress value={item.progress} />
                        <GhostBtn
                          label="Stop"
                          disabled={busyHere}
                          onClick={() => void stop({ jobId: d.id })}
                        >
                          <X className="size-3.5" strokeWidth={2.25} />
                        </GhostBtn>
                      </div>
                    </div>
                  </li>
                );
              }

              const r = item.request;
              const kind = item.kind;
              const canStop =
                isActiveDownloadStatus(r.status) ||
                (item.job
                  ? isActiveDownloadStatus(item.job.status)
                  : false);
              const coverSeed = `${r.artist}-${r.album || r.title}`;
              const isArtist = (r.mediaType || "album") === "artist";
              const busyHere = busy === r.id;

              return (
                <li key={item.key} className="px-3 py-2.5 sm:px-4">
                  <div className="flex items-center gap-3">
                    <CoverArt
                      seed={coverSeed}
                      image={r.coverPath}
                      className={cn(
                        "size-10 shrink-0",
                        isArtist ? "rounded-full" : "rounded-md",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {r.artist} — {r.title}
                        </span>
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {r.mediaType || "album"} ·{" "}
                        {new Date(r.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {kind === "downloading" && item.progress != null ? (
                        <CircleProgress value={item.progress} />
                      ) : null}
                      {kind === "downloaded" || kind === "catalog" ? (
                        <StatusIcon
                          label="Downloaded"
                          className="text-emerald-400"
                        >
                          <Check className="size-3.5" strokeWidth={2.5} />
                        </StatusIcon>
                      ) : null}
                      {kind === "failed" ? (
                        <>
                          <StatusIcon
                            label={
                              r.error ||
                              item.job?.error ||
                              "Request failed"
                            }
                            className="text-destructive"
                          >
                            <X className="size-3.5" strokeWidth={2.5} />
                          </StatusIcon>
                          <GhostBtn
                            label="Retry"
                            disabled={busyHere}
                            onClick={() => void retry(r)}
                          >
                            <RefreshCw
                              className={cn(
                                "size-3.5",
                                busyHere && "animate-spin",
                              )}
                            />
                          </GhostBtn>
                        </>
                      ) : null}
                      {canStop ? (
                        <GhostBtn
                          label="Stop"
                          disabled={busyHere}
                          onClick={() =>
                            void stop({
                              requestId: r.id,
                              jobId: r.downloadJobId || undefined,
                            })
                          }
                        >
                          <X className="size-3.5" strokeWidth={2.25} />
                        </GhostBtn>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {pageCount > 1 ? (
          <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
            <span>
              {(safePage - 1) * PAGE_SIZE + 1}–
              {Math.min(safePage * PAGE_SIZE, filtered.length)} of{" "}
              {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="px-2 tabular-nums">
                {safePage} / {pageCount}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={safePage >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function CircleProgress({ value }: { value: number }) {
  const size = 22;
  const stroke = 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const offset = c - (pct / 100) * c;
  const label = `${pct}%`;

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 text-muted-foreground"
      title={label}
      aria-label={`Downloading ${label}`}
    >
      <span className="relative inline-flex size-[22px] items-center justify-center">
        <Loader2
          className="absolute size-2.5 animate-spin opacity-60"
          aria-hidden
        />
        <svg
          width={size}
          height={size}
          className="absolute inset-0 -rotate-90"
          aria-hidden
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            className="text-muted/35"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            className="text-foreground transition-[stroke-dashoffset] duration-300"
          />
        </svg>
      </span>
      <span className="min-w-[2ch] text-[11px] tabular-nums text-muted-foreground">
        {pct}%
      </span>
    </span>
  );
}

function AvatarStack({ users }: { users: ActivityUser[] }) {
  if (!users.length) return null;
  const show = users.slice(0, 4);
  const rest = users.length - show.length;

  return (
    <div
      className="flex shrink-0 items-center pl-1"
      title={users.map((u) => u.username).join(", ")}
    >
      <div className="flex -space-x-1.5">
        {show.map((u) => {
          const initial = (u.username.trim()[0] || "?").toUpperCase();
          return (
            <span
              key={u.username}
              title={u.username}
              className="relative inline-flex size-6 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-muted text-[9px] font-semibold uppercase text-muted-foreground"
            >
              {u.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={u.avatarUrl}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                initial
              )}
            </span>
          );
        })}
        {rest > 0 ? (
          <span className="relative inline-flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[9px] font-medium text-muted-foreground">
            +{rest}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function StatusIcon({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-6 items-center justify-center",
        className,
      )}
      title={label}
      aria-label={label}
    >
      {children}
    </span>
  );
}

/** Borderless icon control — stop / retry. */
function GhostBtn({
  children,
  label,
  disabled,
  onClick,
}: {
  children: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors",
        "hover:bg-muted/60 hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {children}
    </button>
  );
}
