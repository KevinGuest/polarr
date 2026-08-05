"use client";

import { useEffect, useMemo, useState } from "react";
import { DownloadCloud, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CoverArt } from "@/components/cover-art";
import { usePlayer, type PlayerTrack } from "@/components/player-provider";
import { formatDuration } from "@/lib/utils";

type Track = PlayerTrack & {
  source: string;
  path: string;
  album?: string;
  duration?: number;
};

export function LibraryClient() {
  const { play } = usePlayer();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [scanning, setScanning] = useState(false);
  const [root, setRoot] = useState<string | null>(null);

  async function load(scan = false) {
    setScanning(scan);
    const res = await fetch(scan ? "/api/library?scan=1" : "/api/library");
    const data = await res.json();
    setTracks(data.tracks || []);
    if (data.root) setRoot(data.root);
    setScanning(false);
  }

  useEffect(() => {
    void load(false);
  }, []);

  const albums = useMemo(() => {
    const map = new Map<string, { title: string; artist: string; tracks: Track[] }>();
    for (const t of tracks) {
      const key = `${t.artist}::${t.album || t.title}`;
      const cur = map.get(key);
      if (cur) cur.tracks.push(t);
      else
        map.set(key, {
          title: t.album || t.title,
          artist: t.artist,
          tracks: [t],
        });
    }
    return [...map.values()];
  }, [tracks]);

  const featured = albums[0];

  async function markOffline(id: string) {
    await fetch(`/api/tracks/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "web" }),
    });
  }

  return (
    <div className="flex min-h-full flex-col">
      <section className="relative border-b border-border px-6 pb-8 pt-6 md:px-10">
        <div
          className="pointer-events-none absolute inset-0 opacity-35"
          style={{
            background:
              "linear-gradient(180deg, hsl(0 0% 18%) 0%, hsl(var(--background)) 100%)",
          }}
          aria-hidden
        />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end">
          <CoverArt
            seed={featured?.title || "Library"}
            className="size-40 shrink-0 rounded-lg sm:size-44"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Collection
            </p>
            <h1 className="text-4xl font-semibold tracking-tight">Library</h1>
            <p className="text-sm text-muted-foreground">
              {tracks.length} tracks · {albums.length} albums
              {root ? ` · ${root}` : ""}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {featured?.tracks[0] && (
                <Button
                  type="button"
                  onClick={() =>
                    play(featured.tracks[0], featured.tracks)
                  }
                >
                  <Play className="size-4" fill="currentColor" /> Play
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => load(true)}
                disabled={scanning}
              >
                <RefreshCw
                  className={`size-4 ${scanning ? "animate-spin" : ""}`}
                />
                Scan
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-6 md:px-10">
        {tracks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-16 text-center text-muted-foreground">
            Empty library. Scan music, or acquire via Search / downtify fallback.
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="w-10 pb-3 font-medium">#</th>
                  <th className="pb-3 pr-4 font-medium">Title</th>
                  <th className="pb-3 pr-4 font-medium">Artist</th>
                  <th className="hidden pb-3 pr-4 font-medium md:table-cell">
                    Album
                  </th>
                  <th className="hidden pb-3 pr-4 font-medium sm:table-cell">
                    Source
                  </th>
                  <th className="pb-3 text-right font-medium">Duration</th>
                  <th className="w-10 pb-3" />
                </tr>
              </thead>
              <tbody>
                {tracks.map((t, i) => (
                  <tr
                    key={t.id}
                    className="group cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/30"
                    onClick={() => play(t, tracks)}
                  >
                    <td className="py-3 tabular-nums text-muted-foreground">
                      <span className="group-hover:hidden">{i + 1}</span>
                      <Play className="hidden size-3.5 group-hover:inline" />
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-3">
                        <CoverArt
                          seed={t.title}
                          className="size-9 shrink-0 rounded-md"
                        />
                        <span className="font-medium">{t.title}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {t.artist}
                    </td>
                    <td className="hidden py-3 pr-4 text-muted-foreground md:table-cell">
                      {t.album}
                    </td>
                    <td className="hidden py-3 pr-4 text-xs text-muted-foreground sm:table-cell">
                      {t.source === "fallback" ? "downtify" : t.source}
                    </td>
                    <td className="py-3 text-right tabular-nums text-muted-foreground">
                      {formatDuration(t.duration || 0)}
                    </td>
                    <td className="py-3 text-right">
                      <button
                        type="button"
                        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                        aria-label="Mark offline"
                        onClick={(e) => {
                          e.stopPropagation();
                          void markOffline(t.id);
                        }}
                      >
                        <DownloadCloud className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
