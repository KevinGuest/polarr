"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { albumHref } from "@/lib/album-ref";
import {
  MediaShelfGrid,
  MediaTileShell,
  ShelfHeader,
} from "@/components/media-shelf";
import { Skeleton } from "@/components/ui/skeleton";

type Release = {
  id: string;
  title: string;
  artist: string;
  image?: string;
  foreignAlbumId?: string;
  lidarrAlbumId?: number;
};

export function BrowseExploreClient() {
  const router = useRouter();
  const [items, setItems] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/discover", { cache: "no-store" });
      const data = await res.json();
      setItems(Array.isArray(data.catalog) ? data.catalog : []);
      setError(data.lidarrError || null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
          <ShelfHeader title="Explore" titleAs="h1" />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive">Lidarr: {error}</p>
      ) : null}

      {loading && items.length === 0 ? (
        <div
          className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7"
          aria-busy="true"
        >
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="space-y-2.5">
              <Skeleton className="aspect-square w-full rounded-md" />
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          What’s trending, nudged by what you play and like.
        </p>
      ) : (
        <MediaShelfGrid>
          {items.map((r) => {
            const href = albumHref({
              title: r.title,
              artist: r.artist,
              foreignAlbumId: r.foreignAlbumId,
              lidarrAlbumId: r.lidarrAlbumId,
            });
            return (
              <MediaTileShell
                key={r.id}
                title={r.title}
                subtitle={r.artist}
                ariaLabel={`Open ${r.title}`}
                onOpen={() => router.push(href)}
                cover={
                  <CoverArt
                    seed={r.title}
                    image={r.image}
                    className="size-full"
                  />
                }
              />
            );
          })}
        </MediaShelfGrid>
      )}
    </div>
  );
}
