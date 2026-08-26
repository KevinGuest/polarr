"use client";

import { useEffect, useState } from "react";
import { LikeButton } from "@/components/like-button";
import { useLikeToggle } from "@/hooks/use-like-toggle";
import { LIKES_CHANGED_EVENT } from "@/lib/ui-events";

/** Heart wired to /api/likes — loads current liked state for the track. */
export function TrackLikeButton({
  trackId,
  initialLiked,
  size = "sm",
  className,
  revealOnHover = false,
  tone = "default",
  artist,
  title,
  album,
  coverPath,
  duration,
  onLikedChange,
}: {
  trackId: string;
  /** If omitted, fetched from the server once. */
  initialLiked?: boolean;
  size?: "sm" | "md";
  className?: string;
  /** Hide until row hover; stays visible when liked. Needs a `group` ancestor. */
  revealOnHover?: boolean;
  tone?: "default" | "on-dark";
  /** Identity for streamed tracks that aren't in the library yet. */
  artist?: string;
  title?: string;
  album?: string;
  coverPath?: string | null;
  duration?: number;
  onLikedChange?: (liked: boolean) => void;
}) {
  const [fetched, setFetched] = useState(initialLiked ?? false);
  const [ready, setReady] = useState(initialLiked !== undefined);
  const [fetchNonce, setFetchNonce] = useState(0);

  useEffect(() => {
    setFetchNonce(0);
    if (initialLiked !== undefined) {
      setFetched(initialLiked);
      setReady(true);
    } else {
      setReady(false);
    }
  }, [trackId, initialLiked]);

  useEffect(() => {
    if (initialLiked !== undefined && fetchNonce === 0) return;
    let cancelled = false;
    void fetch(
      `/api/likes?trackId=${encodeURIComponent(trackId)}${
        artist ? `&artist=${encodeURIComponent(artist)}` : ""
      }${title ? `&title=${encodeURIComponent(title)}` : ""}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setFetched(Boolean(data.liked));
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [trackId, initialLiked, artist, title, fetchNonce]);

  useEffect(() => {
    function onLikesChanged() {
      setFetchNonce((n) => n + 1);
    }
    window.addEventListener(LIKES_CHANGED_EVENT, onLikesChanged);
    return () =>
      window.removeEventListener(LIKES_CHANGED_EVENT, onLikesChanged);
  }, []);

  const { liked, toggle } = useLikeToggle(trackId, fetched, {
    artist,
    title,
    album,
    coverPath,
    duration,
  });

  if (!ready && initialLiked === undefined) {
    return (
      <LikeButton
        liked={false}
        size={size}
        className={className}
        revealOnHover={revealOnHover}
        tone={tone}
        onToggle={() => undefined}
      />
    );
  }

  return (
    <LikeButton
      liked={liked}
      size={size}
      className={className}
      revealOnHover={revealOnHover}
      tone={tone}
      onToggle={() => {
        onLikedChange?.(!liked);
        void toggle();
      }}
    />
  );
}
