"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ListeningCover } from "@/components/listening-cover";
import { TrackContextMenu } from "@/components/track-context-menu";
import {
  MediaShelfGrid,
  MediaTileShell,
  ShelfHeader,
} from "@/components/media-shelf";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlayer, type PlayerTrack } from "@/components/player-provider";
import { setDragTrack } from "@/lib/drag-track";
import { LISTEN_CREDITED_EVENT } from "@/lib/ui-events";

type OthersItem = PlayerTrack & {
  playedAt: string;
  listenedBy: string;
  listenedByAvatarUrl?: string | null;
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
      setItems(Array.isArray(data.items) ? data.items : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => {
      void load();
    }, 15_000);
    const onListen = () => {
      void load();
    };
    window.addEventListener(LISTEN_CREDITED_EVENT, onListen);
    return () => {
      window.clearInterval(t);
      window.removeEventListener(LISTEN_CREDITED_EVENT, onListen);
    };
  }, [load]);

  function playItem(item: OthersItem) {
    play(
      item,
      items.map((r) => ({
        id: r.id,
        title: r.title,
        artist: r.artist,
        album: r.album,
        coverPath: r.coverPath,
      })),
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          aria-label="Back to home"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <ShelfHeader title="What others are listening to" titleAs="h1" />
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div
          className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
          aria-busy="true"
        >
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="space-y-2.5">
              <Skeleton className="aspect-square w-full rounded-md" />
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Tracks show up here after anyone on this server listens for 15+
          seconds.
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
                  onOpen={() => playItem(item)}
                  cover={
                    <ListeningCover
                      title={item.title}
                      coverPath={item.coverPath}
                      listenedBy={item.listenedBy}
                      avatarUrl={item.listenedByAvatarUrl}
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
