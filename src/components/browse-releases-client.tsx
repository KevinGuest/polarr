"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CoverArt } from "@/components/cover-art";
import { albumHref } from "@/lib/album-ref";
import {
  BrowsePageHeader,
  MediaShelfGrid,
  MediaTileShell,
} from "@/components/media-shelf";
import { Skeleton } from "@/components/ui/skeleton";

function catalogAlbumHref(r: {
  title: string;
  artist: string;
  foreignAlbumId?: string;
  lidarrAlbumId?: number;
}) {
  return albumHref({
    title: r.title,
    artist: r.artist,
    foreignAlbumId: r.foreignAlbumId,
    lidarrAlbumId: r.lidarrAlbumId,
  });
}

type Release = {
  id: string;
  title: string;
  artist: string;
  year?: number;
  image?: string;
  foreignAlbumId?: string;
  foreignArtistId?: string;
  releaseDate?: string;
  hasFile: boolean;
  monitored: boolean;
  lidarrAlbumId?: number;
};

export function BrowseReleasesClient() {
  const router = useRouter();
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/discover");
      const data = await res.json();
      setReleases(Array.isArray(data.releases) ? data.releases : []);
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
      <BrowsePageHeader title="Latest releases" />

      {error ? (
        <p className="text-sm text-destructive">Lidarr: {error}</p>
      ) : null}

      {loading && releases.length === 0 ? (
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
      ) : releases.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No albums yet. Connect Lidarr or wait for MusicBrainz catalog.
        </p>
      ) : (
        <MediaShelfGrid>
          {releases.map((r) => {
            const href = catalogAlbumHref(r);
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
