"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ListenSeries = {
  userId: string;
  username: string;
  hours: number[];
};

export type ListenDashboard = {
  totalMinutes: number;
  topListener: { username: string; minutes: number } | null;
  allTime: { buckets: string[]; hours: number[] };
  byUser: { buckets: string[]; series: ListenSeries[] };
};

const PALETTE = [
  "#f4f4f5",
  "#a1a1aa",
  "#d4d4d8",
  "#71717a",
  "#e4e4e7",
  "#52525b",
  "#c4c4cc",
  "#3f3f46",
];

function colorFor(seed: string, index: number) {
  if (index < PALETTE.length) return PALETTE[index];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 55%)`;
}

function shortLabel(bucket: string) {
  // 2026-08-05T09 → 8/5 09h
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/.exec(bucket);
  if (!m) return bucket;
  return `${Number(m[2])}/${Number(m[3])} ${m[4]}h`;
}

/** Round up to a clean axis max (1 / 2 / 5 × 10^n). */
function niceMax(raw: number): number {
  if (raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const mag = 10 ** exp;
  const frac = raw / mag;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * mag;
}

function formatY(n: number): string {
  if (n === 0) return "0";
  if (Number.isInteger(n) || n >= 10) return String(Math.round(n));
  if (n >= 1) return n.toFixed(1).replace(/\.0$/, "");
  return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function LineChart({
  labels,
  series,
  ariaLabel,
}: {
  labels: string[];
  series: { key: string; label: string; color: string; values: number[] }[];
  ariaLabel: string;
}) {
  const { paths, maxY, hasData } = useMemo(() => {
    const flat = series.flatMap((s) => s.values);
    const hasData = flat.some((v) => v > 0);
    const maxY = niceMax(Math.max(...flat, 0));
    const W = 100;
    const H = 48;
    const padT = 4;
    const innerH = H - padT - 2;
    const n = Math.max(1, labels.length - 1);
    const paths = series.map((s) => {
      const pts = s.values.map((h, i) => {
        const x = (i / n) * W;
        const y = padT + innerH - (h / maxY) * innerH;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      });
      return {
        ...s,
        d: pts.length ? `M ${pts.join(" L ")}` : "",
      };
    });
    return { paths, maxY, hasData };
  }, [labels, series]);

  if (labels.length === 0 || !hasData) {
    return (
      <div
        className="flex h-44 items-center justify-center rounded-lg border border-dashed border-border"
        role="img"
        aria-label={ariaLabel}
      >
        <p className="px-4 text-center text-sm text-muted-foreground">
          No plays yet — chart fills as people stream
        </p>
      </div>
    );
  }

  const tickIdx = [
    0,
    Math.floor(labels.length / 2),
    labels.length - 1,
  ].filter((v, i, a) => a.indexOf(v) === i && labels[v]);

  return (
    <div>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex w-8 flex-col justify-between pb-5 pt-1 text-[10px] tabular-nums text-muted-foreground">
          <span>{formatY(maxY)}</span>
          <span>{formatY(maxY / 2)}</span>
          <span>0</span>
        </div>
        <div className="ml-8">
          <svg
            viewBox="0 0 100 48"
            className="h-44 w-full overflow-visible"
            role="img"
            aria-label={ariaLabel}
          >
            {[0, 0.5, 1].map((t) => {
              const y = 4 + 42 * (1 - t);
              return (
                <line
                  key={t}
                  x1="0"
                  x2="100"
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity={0.12}
                  strokeWidth={0.3}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {paths.map((s) =>
              s.d ? (
                <path
                  key={s.key}
                  d={s.d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={1.4}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null,
            )}
          </svg>
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
            {tickIdx.map((i) => (
              <span key={`${labels[i]}-${i}`}>{shortLabel(labels[i]!)}</span>
            ))}
          </div>
        </div>
      </div>
      {series.length > 1 ? (
        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
          {series.map((s) => {
            const total = s.values.reduce((a, b) => a + b, 0);
            return (
              <li
                key={s.key}
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: s.color }}
                  aria-hidden
                />
                <span className="font-medium text-foreground">{s.label}</span>
                <span className="tabular-nums">
                  {total.toFixed(total >= 10 ? 0 : 1)}h
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function ListenHoursChart({ data }: { data: ListenDashboard }) {
  const [page, setPage] = useState(0); // 0 all-time, 1 by user
  const pageCount = 2;

  const allTimeSeries = useMemo(
    () => [
      {
        key: "all",
        label: "Everyone",
        color: "#f4f4f5",
        values: data.allTime.hours,
      },
    ],
    [data.allTime.hours],
  );

  const byUserSeries = useMemo(
    () =>
      data.byUser.series.map((s, i) => ({
        key: s.userId,
        label: s.username,
        color: colorFor(s.username, i),
        values: s.hours,
      })),
    [data.byUser.series],
  );

  return (
    <div className="rounded-xl border border-border px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
            {page === 0 ? "All-time listening" : "Listening by user"}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {page === 0
              ? "Total hours · 3-hour buckets"
              : "Last 14 days · one line per user"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            disabled={page <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            aria-label="Previous chart"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-[3rem] text-center text-xs tabular-nums text-muted-foreground">
            {page + 1} / {pageCount}
          </span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            aria-label="Next chart"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="mt-4">
        {page === 0 ? (
          <LineChart
            labels={data.allTime.buckets}
            series={allTimeSeries}
            ariaLabel="All-time hours listened in 3 hour buckets"
          />
        ) : (
          <LineChart
            labels={data.byUser.buckets}
            series={byUserSeries}
            ariaLabel="Hours listened by user"
          />
        )}
      </div>

      <div className="mt-3 flex justify-center gap-1.5">
        {Array.from({ length: pageCount }).map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setPage(i)}
            className={`h-1.5 rounded-full transition-all ${
              i === page
                ? "w-4 bg-foreground"
                : "w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground/70"
            }`}
            aria-label={`Chart page ${i + 1}`}
            aria-current={i === page ? "true" : undefined}
          />
        ))}
      </div>
    </div>
  );
}
