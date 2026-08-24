"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LyricLine, LyricQuality } from "@/lib/lyrics/types";

export type KaraokeSessionState = {
  status: "idle" | "loading" | "ready" | "empty" | "error";
  quality: LyricQuality;
  lines: LyricLine[];
  synced: boolean;
  instrumental: boolean;
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
  cacheKey: null,
  source: null,
  error: null,
};

/**
 * Lyrics session: shared player clock using provider timestamps as-is.
 * Plain quality never seeks / never highlights by time.
 */
export function useKaraokeSession(input: {
  open: boolean;
  artist?: string;
  title?: string;
  album?: string;
  mediaDurationSec?: number;
  progressSec: number;
}) {
  const [session, setSession] = useState<KaraokeSessionState>(IDLE);

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
          cacheKey: string;
          source: string;
        }>;
      })
      .then((data) => {
        if (cancelled) return;
        if (data.instrumental || data.quality === "instrumental") {
          setSession({
            status: "empty",
            quality: "instrumental",
            lines: [],
            synced: false,
            instrumental: true,
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
    input.mediaDurationSec
      ? Math.round(input.mediaDurationSec)
      : 0,
  ]);

  const clockSec = input.progressSec;

  const seekSecForLine = useCallback((line: LyricLine) => {
    return Math.max(0, line.time || 0);
  }, []);

  const activeIndex = useMemo(() => {
    if (!session.synced || !session.lines.length) return -1;
    let idx = 0;
    for (let i = 0; i < session.lines.length; i++) {
      if (session.lines[i]!.time <= clockSec) idx = i;
      else break;
    }
    return idx;
  }, [session.lines, session.synced, clockSec]);

  return {
    ...session,
    clockSec,
    activeIndex,
    seekSecForLine,
  };
}
