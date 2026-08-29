"use client";

import { useCallback, useEffect, useState } from "react";
import { ListeningCover } from "@/components/listening-cover";
import { TrackContextMenu } from "@/components/track-context-menu";
import {
  BrowsePageHeader,
  MediaShelfGrid,
  MediaTileShell,
} from "@/components/media-shelf";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlayer, type PlayerTrack } from "@/components/player-provider";
import { setDragTrack } from "@/lib/drag-track";
import { LISTEN_CREDITED_EVENT } from "@/lib/ui-events";
import { OTHERS_LISTENING_POLL_MS } from "@/lib/listen";

type OthersItem = PlayerTrack & {
  playedAt: string;
  listenedBy: string;
  listenedByAvatarUrl?: string | null;
  listeners?: { username: string; avatarUrl?: string | null }[];
};

export function BrowseListeningClient() {
  const { play } = usePlayer();
  const [items, setItems] = useState<OthersItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/listening?limit=48", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const next = Array.isArray(data.items) ? data.items : [];
      setItems((prev) => (next.length === 0 && prev.length > 0 ? prev : next));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => {
      void load();
    }, OTHERS_LISTENING_POLL_MS);
    const onListen = () => {
      void load();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener(LISTEN_CREDITED_EVENT, onListen);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(t);
      window.removeEventListener(LISTEN_CREDITED_EVENT, onListen);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  function playTrack(item: OthersItem) {
    const pt: PlayerTrack = {
      id: item.id,
      title: item.title,
      artist: item.artist,
      resolveArtist: item.artist,
      album: item.album || item.title,
      coverPath: item.coverPath || null,
    };
    play(pt, [pt]);
  }

  return (
    <div className="space-y-8">
      <BrowsePageHeader title="What others are listening to" />

      {loading && items.length === 0 ? (
        <div
          className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
          aria-busy="true"
        >
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="space-y-2.5">
              <Skeleton className="aspect-square w-full rounded-2xl" />
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Tracks other people on this server play for 30+ seconds show up
          here. Your own plays stay in Recently played.
        </p>
      ) : (
        <MediaShelfGrid>
          {items.map((item, i) => (
            <TrackContextMenu key={item.id} track={item}>
              <div
                className="min-w-0 cursor-grab active:cursor-grabbing"
                draggable
                onDragStart={(e) => setDragTrack(e, item)}
              >
                <MediaTileShell
                  title={item.title}
                  subtitle={item.artist}
                  ariaLabel={`Play ${item.title}`}
                  onOpen={() => playTrack(item)}
                  cover={
                    <ListeningCover
                      title={item.title}
                      coverPath={item.coverPath}
                      listenedBy={item.listenedBy}
                      avatarUrl={item.listenedByAvatarUrl}
                      listeners={item.listeners}
                      delayMs={(i % 5) * 700}
                    />
                  }
                />
              </div>
            </TrackContextMenu>
          ))}
        </MediaShelfGrid>
      )}
    </div>
  );
}
