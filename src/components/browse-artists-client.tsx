"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import {
  MediaShelfGrid,
  MediaTileShell,
  ShelfHeader,
} from "@/components/media-shelf";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchDiscoverFeed } from "@/lib/discover-client";

type CatalogArtist = {
  name: string;
  image?: string;
  foreignArtistId?: string;
};

export function BrowseArtistsClient() {
  const router = useRouter();
  const [artists, setArtists] = useState<CatalogArtist[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDiscoverFeed();
      setArtists(Array.isArray(data.artists) ? data.artists : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openArtist(a: CatalogArtist) {
    const qs = new URLSearchParams({ name: a.name });
    if (a.foreignArtistId) qs.set("foreignArtistId", a.foreignArtistId);
    if (a.image) qs.set("image", a.image);
    router.push(`/artist?${qs.toString()}`);
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
          <ShelfHeader title="Artists" titleAs="h1" />
        </div>
      </div>

      {loading && artists.length === 0 ? (
        <div
          className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7"
          aria-busy="true"
        >
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="space-y-2.5">
              <Skeleton className="aspect-square w-full rounded-full" />
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          ))}
        </div>
      ) : artists.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Artists you play, like, or keep in the library show up here — plus
          what’s charting.
        </p>
      ) : (
        <MediaShelfGrid>
          {artists.map((a) => (
            <MediaTileShell
              key={a.foreignArtistId || a.name}
              title={a.name}
              subtitle="Artist"
              ariaLabel={`Open ${a.name}`}
              onOpen={() => openArtist(a)}
              coverShape="circle"
              cover={
                <CoverArt
                  seed={a.name}
                  image={a.image}
                  className="size-full rounded-full"
                />
              }
            />
          ))}
        </MediaShelfGrid>
      )}
    </div>
  );
}
