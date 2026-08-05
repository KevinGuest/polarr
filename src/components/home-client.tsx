"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Download, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CoverArt } from "@/components/cover-art";
import { usePlayer, type PlayerTrack } from "@/components/player-provider";

type Track = PlayerTrack & { source?: string };

type StreamAlbum = {
  key: string;
  title: string;
  artist: string;
  tracks: Track[];
  source?: string;
};

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
};

async function pollTrack(
  artist: string,
  title: string,
  attempts = 40,
): Promise<Track | null> {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(
      `/api/search?q=${encodeURIComponent(`${artist} ${title}`)}`,
    );
    const data = await res.json();
    const hit = (data.local as Track[] | undefined)?.find(
      (t) =>
        t.artist.toLowerCase().includes(artist.toLowerCase().slice(0, 12)) ||
        t.title.toLowerCase().includes(title.toLowerCase().slice(0, 12)),
    );
    if (hit) return hit;
  }
  return null;
}

export function HomeClient() {
  const { play } = usePlayer();
  const [albums, setAlbums] = useState<StreamAlbum[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [lidarrError, setLidarrError] = useState<string | null>(null);
  const [fallbackReady, setFallbackReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/discover");
      const data = await res.json();
      setAlbums(data.streamableAlbums || []);
      setTracks(data.tracks || []);
      setReleases(data.releases || []);
      setLidarrError(data.lidarrError || null);
      setFallbackReady(Boolean(data.fallbackReady));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  function playAlbum(a: StreamAlbum) {
    if (!a.tracks[0]) return;
    play(a.tracks[0], a.tracks);
  }

  function playTrack(t: Track) {
    play(t, tracks);
  }

  async function requestRelease(r: Release, stream = false) {
    setBusy(r.id);
    setMsg(null);
    // Prefer downtify for stream path when ready
    const prefer =
      stream && fallbackReady ? "fallback" : "auto";
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: r.title,
          artist: r.artist,
          album: r.title,
          foreignId: r.foreignArtistId || r.foreignAlbumId,
          type: stream ? "track" : "album",
          prefer,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "Request failed");
        return;
      }
      if (data.track?.id) {
        play(data.track as Track, [data.track as Track, ...tracks]);
        setMsg(
          data.alreadyAvailable
            ? "Playing from library"
            : "Ready — streaming",
        );
        void load();
        return;
      }
      if (data.streamWhenReady || data.path === "fallback") {
        setMsg(`Acquiring via downtify — will stream when ready…`);
        const track = await pollTrack(r.artist, r.title);
        if (track) {
          play(track, [track, ...tracks]);
          setMsg("Streaming downtify acquire");
          void load();
        } else {
          setMsg("Download still running — check Library shortly");
        }
        return;
      }
      setMsg(
        data.alreadyAvailable
          ? "Already in library — scan if not listed above"
          : `Queued ${r.artist} — ${r.title}`,
      );
      void load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  const toGet = releases.filter((r) => !r.hasFile).slice(0, 16);
  const newlyOnDisk = releases.filter((r) => r.hasFile).slice(0, 8);

  return (
    <div className="space-y-10 px-6 py-6 md:px-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Home
          </h1>
          <p className="text-sm text-muted-foreground">
            Library + downtify streams
            {fallbackReady ? " · fallback ready" : ""}
            {" · "}
            Lidarr latest every 60s.
          </p>
          {msg && <p className="text-sm text-foreground">{msg}</p>}
          {lidarrError && (
            <p className="text-sm text-destructive">Lidarr: {lidarrError}</p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            Ready to stream
          </h2>
          <Link
            href="/library"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Open library
          </Link>
        </div>
        {albums.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No local files yet. Scan in Library, or stream a release below
            {fallbackReady ? " with downtify" : ""}.
          </p>
        ) : (
          <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-1">
            {albums.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => playAlbum(a)}
                className="w-36 shrink-0 space-y-2 text-left transition-opacity hover:opacity-90"
              >
                <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                  <CoverArt seed={a.title} className="size-full" />
                  <span className="absolute bottom-2 right-2 flex size-8 items-center justify-center rounded-full border border-border bg-background/90">
                    <Play className="size-3.5" fill="currentColor" />
                  </span>
                </div>
                <div>
                  <div className="truncate text-sm font-medium">{a.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {a.artist}
                    {a.source === "fallback" ? " · downtify" : ""}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            Latest releases
          </h2>
          <Link
            href="/search"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Search more
          </Link>
        </div>
        {toGet.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading Lidarr…"
              : "No missing recent albums. Connect Lidarr in Admin or wait for calendar activity."}
          </p>
        ) : (
          <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-1">
            {toGet.map((r) => (
              <div key={r.id} className="w-36 shrink-0 space-y-2">
                <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                  <CoverArt
                    seed={r.title}
                    image={r.image}
                    className="size-full"
                  />
                  <span className="absolute left-2 top-2 rounded-md border border-border bg-background/90 px-1.5 py-0.5 text-[10px] font-medium">
                    {r.releaseDate?.slice(0, 10) || r.year || "Get"}
                  </span>
                </div>
                <div>
                  <div className="truncate text-sm font-medium">{r.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.artist}
                    {r.year ? ` · ${r.year}` : ""}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  {fallbackReady && (
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={busy === r.id}
                      onClick={() => void requestRelease(r, true)}
                    >
                      <Play className="size-3.5" />
                      {busy === r.id ? "…" : "Stream"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={busy === r.id}
                    onClick={() => void requestRelease(r, false)}
                  >
                    <Download className="size-3.5" />
                    {busy === r.id ? "…" : "Download"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {newlyOnDisk.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {newlyOnDisk.length} calendar albums report files in Lidarr — scan
            Library to stream after import.
          </p>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground">Tracks</h2>
        {tracks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No streamable tracks.</p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-lg border border-border">
            {tracks.slice(0, 12).map((t, i) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => playTrack(t)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/30"
                >
                  <span className="w-5 text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <CoverArt
                    seed={t.title}
                    className="size-10 shrink-0 rounded-md"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{t.title}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t.artist} · {t.album}
                      {t.source === "fallback" ? " · downtify" : ""}
                    </div>
                  </div>
                  <Play className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
