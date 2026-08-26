"use client";

import { useCallback, useEffect, useState } from "react";
import { toastApiError, toastError } from "@/lib/toast";
import { emitLikesChanged } from "@/lib/ui-events";

/** Optimistic per-track like toggle. */
export function useLikeToggle(
  trackId: string,
  initialLiked: boolean,
  meta?: {
    artist?: string;
    title?: string;
    album?: string;
    coverPath?: string | null;
    duration?: number;
  },
) {
  const [liked, setLiked] = useState(initialLiked);

  useEffect(() => {
    setLiked(initialLiked);
  }, [initialLiked, trackId]);

  const toggle = useCallback(async () => {
    if (!trackId) return;
    const prev = liked;
    const next = !prev;
    setLiked(next);
    try {
      const res = await fetch("/api/likes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackId,
          liked: next,
          artist: meta?.artist,
          title: meta?.title,
          album: meta?.album,
          coverPath: meta?.coverPath,
          duration: meta?.duration,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setLiked(prev);
        toastApiError(data, "Couldn’t update Liked Songs");
        return;
      }
      if (typeof data?.liked === "boolean") setLiked(data.liked);
      emitLikesChanged({
        liked: typeof data?.liked === "boolean" ? data.liked : next,
        count: typeof data?.count === "number" ? data.count : undefined,
      });
    } catch {
      setLiked(prev);
      toastError("Couldn’t update Liked Songs");
    }
  }, [liked, trackId, meta?.artist, meta?.title, meta?.album, meta?.coverPath, meta?.duration]);

  return { liked, setLiked, toggle };
}
