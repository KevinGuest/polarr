"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LyricLine,
  LyricQuality,
  OffsetSuggestSource,
} from "@/lib/lyrics/types";
import { lyricLineSeekSec } from "@/lib/lyrics/align";

export type KaraokeSessionState = {
  status: "idle" | "loading" | "ready" | "empty" | "error";
  quality: LyricQuality;
  lines: LyricLine[];
  synced: boolean;
  instrumental: boolean;
  offsetSec: number;
  offsetSuggested: number;
  offsetUserSet: boolean;
  offsetSource: OffsetSuggestSource;
  warpScale: number;
  warpOnsetSec: number;
  alignSource: "dtw" | "warp" | "none";
  cacheKey: string | null;
  source: string | null;
  error: string | null;
};

const IDLE: KaraokeSessionState = {
  status: "idle",
  quality: "none",
  lines: [],
  synced: false,
  instrumental: false,
  offsetSec: 0,
  offsetSuggested: 0,
  offsetUserSet: false,
  offsetSource: "none",
  warpScale: 1,
  warpOnsetSec: 0,
  alignSource: "none",
  cacheKey: null,
  source: null,
  error: null,
};

/**
 * Lyrics session: shared player clock + optional persistent offset.
 * Plain quality never seeks / never highlights by time.
 */
export function useKaraokeSession(input: {
  open: boolean;
  artist?: string;
  title?: string;
  album?: string;
  trackId?: string;
  mediaDurationSec?: number;
  progressSec: number;
}) {
  const [session, setSession] = useState<KaraokeSessionState>(IDLE);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!input.open || !input.artist?.trim() || !input.title?.trim()) {
      setSession(IDLE);
      return;
    }

    let cancelled = false;
    setSession((s) => ({
      ...s,
      status: "loading",
      error: null,
      lines: [],
    }));

    const params = new URLSearchParams({
      artist: input.artist.trim(),
      title: input.title.trim(),
    });
    if (input.album?.trim()) params.set("album", input.album.trim());
    if (input.trackId?.trim()) params.set("trackId", input.trackId.trim());
    if (input.mediaDurationSec && input.mediaDurationSec > 5) {
      params.set("duration", String(Math.round(input.mediaDurationSec)));
    }

    void fetch(`/api/lyrics/session?${params}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("fail");
        return res.json() as Promise<{
          quality: LyricQuality;
          lines: LyricLine[];
          instrumental: boolean;
          found: boolean;
          synced: boolean;
          offsetSec: number;
          offsetSuggested: number;
          offsetUserSet: boolean;
          offsetSource?: OffsetSuggestSource;
          warpScale?: number;
          warpOnsetSec?: number;
          alignSource?: "dtw" | "warp" | "none";
          cacheKey: string;
          source: string;
        }>;
      })
      .then((data) => {
        if (cancelled) return;
        const offsetSource: OffsetSuggestSource =
          data.offsetSource === "audio" || data.offsetSource === "duration"
            ? data.offsetSource
            : "none";
        const warpScale =
          typeof data.warpScale === "number" && Number.isFinite(data.warpScale)
            ? data.warpScale
            : 1;
        const warpOnsetSec =
          typeof data.warpOnsetSec === "number" &&
          Number.isFinite(data.warpOnsetSec)
            ? data.warpOnsetSec
            : 0;
        const alignSource =
          data.alignSource === "dtw" || data.alignSource === "warp"
            ? data.alignSource
            : "none";
        if (data.instrumental || data.quality === "instrumental") {
          setSession({
            status: "empty",
            quality: "instrumental",
            lines: [],
            synced: false,
            instrumental: true,
            offsetSec: data.offsetSec || 0,
            offsetSuggested: data.offsetSuggested || 0,
            offsetUserSet: Boolean(data.offsetUserSet),
            offsetSource,
            warpScale,
            warpOnsetSec,
            alignSource,
            cacheKey: data.cacheKey || null,
            source: data.source || null,
            error: null,
          });
          return;
        }
        const lines = Array.isArray(data.lines) ? data.lines : [];
        if (!lines.length || data.quality === "none") {
          setSession({
            status: "empty",
            quality: "none",
            lines: [],
            synced: false,
            instrumental: false,
            offsetSec: 0,
            offsetSuggested: 0,
            offsetUserSet: false,
            offsetSource: "none",
            warpScale: 1,
            warpOnsetSec: 0,
            alignSource: "none",
            cacheKey: data.cacheKey || null,
            source: data.source || null,
            error: null,
          });
          return;
        }
        setSession({
          status: "ready",
          quality: data.quality,
          lines,
          synced: data.quality === "synced" && Boolean(data.synced),
          instrumental: false,
          offsetSec: typeof data.offsetSec === "number" ? data.offsetSec : 0,
          offsetSuggested:
            typeof data.offsetSuggested === "number"
              ? data.offsetSuggested
              : 0,
          offsetUserSet: Boolean(data.offsetUserSet),
          offsetSource,
          warpScale,
          warpOnsetSec,
          alignSource,
          cacheKey: data.cacheKey || null,
          source: data.source || null,
          error: null,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setSession({
            ...IDLE,
            status: "error",
            error: "Couldn’t load lyrics right now.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    input.open,
    input.artist,
    input.title,
    input.album,
    input.trackId,
    input.mediaDurationSec
      ? Math.round(input.mediaDurationSec)
      : 0,
  ]);

  // Line times are warped (LRC × scale) or DTW media timestamps.
  // Offset is auto −onset (warp only) plus the user’s ±0.5s nudge.
  const clockSec = input.progressSec + (session.offsetSec || 0);

  const seekSecForLine = useCallback(
    (line: LyricLine) => lyricLineSeekSec(line.time, session.offsetSec || 0),
    [session.offsetSec],
  );

  const activeIndex = useMemo(() => {
    if (!session.synced || !session.lines.length) return -1;
    let idx = 0;
    for (let i = 0; i < session.lines.length; i++) {
      // No lookahead — +0.12 made lines switch before the singer finished.
      if (session.lines[i]!.time <= clockSec) idx = i;
      else break;
    }
    return idx;
  }, [session.lines, session.synced, clockSec]);

  const persistOffset = useCallback(
    (offsetSec: number, cacheKey: string | null, userSet = true) => {
      if (!cacheKey) return;
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        void fetch("/api/lyrics/session", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cacheKey, offsetSec, userSet }),
        }).catch(() => null);
      }, 400);
    },
    [],
  );

  const setOffsetSec = useCallback(
    (next: number) => {
      setSession((s) => {
        const offsetSec = Math.max(-120, Math.min(120, Math.round(next * 10) / 10));
        persistOffset(offsetSec, s.cacheKey, true);
        return { ...s, offsetSec, offsetUserSet: true };
      });
    },
    [persistOffset],
  );

  const nudgeOffset = useCallback(
    (delta: number) => {
      setSession((s) => {
        const offsetSec = Math.max(
          -120,
          Math.min(120, Math.round((s.offsetSec + delta) * 10) / 10),
        );
        persistOffset(offsetSec, s.cacheKey, true);
        return { ...s, offsetSec, offsetUserSet: true };
      });
    },
    [persistOffset],
  );

  const resetOffsetToSuggested = useCallback(() => {
    setSession((s) => {
      const offsetSec = s.offsetSuggested;
      // Stay in auto mode so the next open can re-measure the track
      persistOffset(offsetSec, s.cacheKey, false);
      return { ...s, offsetSec, offsetUserSet: false };
    });
  }, [persistOffset]);

  useEffect(() => {
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, []);

  return {
    ...session,
    clockSec,
    activeIndex,
    seekSecForLine,
    setOffsetSec,
    nudgeOffset,
    resetOffsetToSuggested,
  };
}
