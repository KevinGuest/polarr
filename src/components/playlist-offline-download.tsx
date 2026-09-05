"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownCircle, CheckCircle2, CircleStop, Loader2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuthOptional } from "@/components/auth-provider";
import {
  cancelOfflineBatch,
  downloadTracksOfflineBatch,
  isOfflineBatchActive,
  isPolarrDesktop,
  isTrackOfflineCached,
  refreshOfflineIds,
  removeTracksOfflineBatch,
  subscribeOfflineProgress,
  type DesktopOfflineTrack,
  type OfflineProgressDetail,
} from "@/lib/desktop-offline";
import { cn } from "@/lib/utils";
import { toastError, toastSuccess } from "@/lib/toast";

const GREEN = "#1db954";

export function useDesktopOfflineReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok = await isPolarrDesktop();
      if (!cancelled) setReady(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return ready;
}

export function useOfflineProgress() {
  const [detail, setDetail] = useState<OfflineProgressDetail>(() => ({
    active: false,
    done: 0,
    total: 0,
    collectionId: null,
    statuses: {},
  }));
  useEffect(() => subscribeOfflineProgress(setDetail), []);
  return detail;
}

/** Spotify-style playlist/album download control for native apps. */
export function PlaylistOfflineDownloadButton({
  collectionId,
  tracks,
  className,
  iconClassName,
}: {
  collectionId: string;
  tracks: DesktopOfflineTrack[];
  className?: string;
  iconClassName?: string;
}) {
  const auth = useAuthOptional();
  const desktop = useDesktopOfflineReady();
  const progress = useOfflineProgress();
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    await refreshOfflineIds();
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!desktop) return;
    void refresh();
  }, [desktop, collectionId, tracks.length, refresh]);

  useEffect(() => {
    if (!progress.active) void refresh();
  }, [progress.active, progress.done, refresh]);

  const downloadable = useMemo(
    () =>
      tracks.filter(
        (t) =>
          t.trackId &&
          !t.trackId.startsWith("live:") &&
          !t.trackId.startsWith("stream:") &&
          !t.trackId.startsWith("catalog:"),
      ),
    // tick forces recompute after cache changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracks, tick],
  );

  const cachedCount = useMemo(
    () => downloadable.filter((t) => isTrackOfflineCached(t.trackId)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [downloadable, tick, progress.statuses],
  );

  const allCached =
    downloadable.length > 0 && cachedCount >= downloadable.length;
  const thisBatchActive =
    progress.active && progress.collectionId === collectionId;
  const anyBatchActive = progress.active || isOfflineBatchActive();

  if (!desktop || !auth?.user?.publicId || downloadable.length === 0) {
    return null;
  }

  const label = thisBatchActive
    ? "Stop"
    : allCached
      ? "Remove download"
      : "Download";

  async function onClick() {
    if (!auth?.user?.publicId) return;
    if (thisBatchActive) {
      cancelOfflineBatch();
      return;
    }
    if (anyBatchActive) {
      toastError("Wait for the current download to finish");
      return;
    }
    setBusy(true);
    try {
      if (allCached) {
        await removeTracksOfflineBatch(downloadable.map((t) => t.trackId));
        await refresh();
        toastSuccess("Removed offline downloads");
        return;
      }
      const withUser = downloadable.map((t) => ({
        ...t,
        userId: auth.user!.publicId!,
      }));
      const result = await downloadTracksOfflineBatch({
        collectionId,
        tracks: withUser,
      });
      await refresh();
      if (result.cancelled) {
        toastSuccess("Download stopped", {
          description: `${result.done} of ${result.total} saved`,
        });
      } else if (result.done >= result.total) {
        toastSuccess("Downloaded for offline");
      } else {
        toastError("Some tracks couldn’t download", {
          description: `${result.done} of ${result.total} saved`,
        });
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Offline download failed");
    } finally {
      setBusy(false);
    }
  }

  const iconSize = iconClassName || "size-7";

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => void onClick()}
            disabled={busy && !thisBatchActive}
            className={cn(
              "flex size-10 items-center justify-center rounded-full transition-colors disabled:opacity-40",
              thisBatchActive || allCached
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
              className,
            )}
            aria-label={label}
            style={
              allCached && !thisBatchActive ? { color: GREEN } : undefined
            }
          >
            {busy && !thisBatchActive ? (
              <Loader2 className={cn(iconSize, "animate-spin")} />
            ) : thisBatchActive ? (
              <CircleStop className={iconSize} strokeWidth={1.75} />
            ) : allCached ? (
              <ArrowDownCircle
                className={iconSize}
                strokeWidth={1.75}
                fill="currentColor"
                stroke="currentColor"
              />
            ) : (
              <ArrowDownCircle className={iconSize} strokeWidth={1.75} />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Compact per-track offline indicator for native apps. */
export function TrackOfflineIndicator({
  trackId,
  collectionId,
}: {
  trackId: string;
  collectionId?: string;
}) {
  const desktop = useDesktopOfflineReady();
  const progress = useOfflineProgress();
  const [cached, setCached] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    void refreshOfflineIds().then(() => {
      setCached(isTrackOfflineCached(trackId));
    });
  }, [desktop, trackId, progress.done, progress.active]);

  if (!desktop) return null;

  const status = progress.statuses[trackId];
  const inThisBatch =
    progress.active &&
    (!collectionId || progress.collectionId === collectionId) &&
    (status === "queued" || status === "downloading");

  if (inThisBatch) {
    return (
      <ArrowDownCircle
        className="size-3.5 shrink-0"
        style={{ color: GREEN }}
        strokeWidth={2}
        aria-label="Downloading"
      />
    );
  }

  if (cached || status === "done") {
    return (
      <CheckCircle2
        className="size-3.5 shrink-0"
        style={{ color: GREEN }}
        strokeWidth={2}
        aria-label="Downloaded"
      />
    );
  }

  return null;
}

/** Left-sidebar “Downloading N of M” strip (Spotify-style). */
export function LibraryOfflineDownloadProgress() {
  const desktop = useDesktopOfflineReady();
  const progress = useOfflineProgress();

  if (!desktop || !progress.active || progress.total <= 0) return null;

  const pct = Math.min(
    100,
    Math.round((progress.done / Math.max(1, progress.total)) * 100),
  );

  return (
    <div className="mb-3 space-y-1.5 px-3" aria-live="polite">
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-foreground">
        <span>Downloading</span>
        <span className="tabular-nums text-muted-foreground">
          {progress.done} of {progress.total}
        </span>
      </div>
      <div className="h-0.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${pct}%`, background: GREEN }}
        />
      </div>
    </div>
  );
}
