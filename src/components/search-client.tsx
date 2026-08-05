"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CoverArt } from "@/components/cover-art";
import { albumHref } from "@/lib/album-ref";
import { TrackContextMenu } from "@/components/track-context-menu";
import { TrackRowActions } from "@/components/track-row-actions";
import { usePlayer, type PlayerTrack } from "@/components/player-provider";
import { formatTrackArtistLine } from "@/lib/utils";

type LocalTrack = PlayerTrack & {
  duration: number;
  source: string;
};

type CatalogHit = {
  type: "artist" | "album";
  title: string;
  artist: string;
  overview?: string;
  image?: string;
  foreignId?: string;
  lidarrId?: number;
  alreadyInLibrary: boolean;
};

function albumPageHref(hit: CatalogHit) {
  return albumHref({
    title: hit.title,
    artist: hit.artist,
    foreignAlbumId: hit.foreignId,
    lidarrAlbumId: hit.lidarrId,
  });
}

export function SearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { play } = usePlayer();
  const q = searchParams.get("q") || "";
  const [local, setLocal] = useState<LocalTrack[]>([]);
  const [catalog, setCatalog] = useState<CatalogHit[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setLocal([]);
      setCatalog([]);
      setCatalogError(null);
      return;
    }
    const handle = setTimeout(() => {
      void fetch(`/api/search?q=${encodeURIComponent(term)}`)
        .then((r) => r.json())
        .then((data) => {
          setLocal(data.local || []);
          setCatalog(data.lidarr || []);
          setCatalogError(data.lidarrError || null);
        });
    }, 250);
    return () => clearTimeout(handle);
  }, [q]);

  const canPlay = useMemo(() => local.length > 0, [local.length]);

  async function getArtist(hit: CatalogHit) {
    setBusy(`artist:${hit.title}`);
    setMessage(null);
    const res = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: hit.title,
        artist: hit.artist,
        foreignId: hit.foreignId,
        type: "artist",
        prefer: "auto",
      }),
    });
    const data = await res.json();
    setBusy(null);
    setMessage(
      res.ok
        ? data.alreadyAvailable
          ? "Already in your library"
          : data.deduped
            ? `Already in queue (${data.request?.status || "active"})`
            : "Queued in Lidarr"
        : data.error || "Request failed",
    );
  }

  return (
    <div className="space-y-10">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          Search
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {q.trim()
            ? `Results for “${q.trim()}”`
            : "Type in the search bar above to find albums and tracks."}
        </p>
        {message && <p className="text-sm text-foreground">{message}</p>}
        {catalogError && (
          <p className="text-sm text-destructive">{catalogError}</p>
        )}
      </section>

      {canPlay && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            On this server
          </h2>
          <ul className="divide-y divide-border/60 rounded-xl border border-border">
            {local.map((t) => (
              <TrackContextMenu key={t.id} track={t}>
                <li className="group/row flex items-center justify-between gap-3 px-4 py-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <CoverArt
                      seed={t.title}
                      className="size-10 shrink-0 rounded-md"
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{t.title}</div>
                      <div className="truncate text-sm text-muted-foreground">
                        {formatTrackArtistLine(t.artist, t.title)} · {t.album}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <TrackRowActions
                      trackId={t.id}
                      artist={t.artist}
                      title={t.title}
                      album={t.album}
                      duration={t.duration}
                      inLibrary
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => play(t, local)}
                    >
                      <Play className="size-4" /> Play
                    </Button>
                  </div>
                </li>
              </TrackContextMenu>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Catalog</h2>
        {catalog.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {q.trim()
              ? "No close matches with cover art. Try a different query or connect Lidarr in Admin."
              : "Start typing in the header search bar."}
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {catalog.map((hit) => {
              const isAlbum = hit.type === "album";
              const href = isAlbum ? albumPageHref(hit) : null;
              return (
                <li
                  key={`${hit.type}-${hit.foreignId || hit.title}`}
                  className="flex flex-col gap-4 rounded-xl border border-border p-4"
                >
                  <button
                    type="button"
                    className="flex gap-3 text-left"
                    onClick={() => {
                      if (href) router.push(href);
                    }}
                    disabled={!href}
                  >
                    <CoverArt
                      seed={hit.title}
                      image={hit.image}
                      className="size-16 shrink-0 rounded-md"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{hit.type}</Badge>
                        {hit.alreadyInLibrary && (
                          <Badge variant="success">in library</Badge>
                        )}
                      </div>
                      <div className="mt-1 truncate font-medium hover:underline">
                        {hit.title}
                      </div>
                      <div className="truncate text-sm text-muted-foreground">
                        {hit.artist}
                      </div>
                    </div>
                  </button>
                  <div className="flex flex-wrap gap-2">
                    {isAlbum && href ? (
                      <Button size="sm" onClick={() => router.push(href)}>
                        <Play className="size-4" /> Open
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={Boolean(busy)}
                        onClick={() => void getArtist(hit)}
                      >
                        <Download className="size-4" /> Get artist
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
