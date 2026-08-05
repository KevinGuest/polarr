"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Play, Search as SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { usePlayer, type PlayerTrack } from "@/components/player-provider";

type LocalTrack = PlayerTrack & {
  duration: number;
  source: string;
};

type LidarrHit = {
  type: "artist" | "album";
  title: string;
  artist: string;
  overview?: string;
  image?: string;
  foreignId?: string;
  alreadyInLibrary: boolean;
};

export function SearchClient() {
  const { play } = usePlayer();
  const [q, setQ] = useState("");
  const [local, setLocal] = useState<LocalTrack[]>([]);
  const [lidarr, setLidarr] = useState<LidarrHit[]>([]);
  const [lidarrError, setLidarrError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setLocal([]);
      setLidarr([]);
      return;
    }
    const handle = setTimeout(() => {
      void fetch(`/api/search?q=${encodeURIComponent(term)}`)
        .then((r) => r.json())
        .then((data) => {
          setLocal(data.local || []);
          setLidarr(data.lidarr || []);
          setLidarrError(data.lidarrError || null);
        });
    }, 250);
    return () => clearTimeout(handle);
  }, [q]);

  const canPlay = useMemo(() => local.length > 0, [local.length]);

  async function requestItem(
    hit: LidarrHit,
    prefer: "auto" | "fallback",
    stream = false,
  ) {
    setBusy(`${hit.type}:${hit.title}:${prefer}`);
    setMessage(null);
    const res = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: hit.title,
        artist: hit.artist,
        album: hit.type === "album" ? hit.title : hit.title,
        foreignId: hit.foreignId,
        type: stream ? "track" : hit.type,
        prefer,
      }),
    });
    const data = await res.json();
    setBusy(null);
    if (res.ok && data.track?.id) {
      play(data.track as LocalTrack, [data.track as LocalTrack, ...local]);
      setMessage("Playing");
      return;
    }
    setMessage(
      res.ok
        ? data.alreadyAvailable
          ? "Already in your library"
          : data.deduped
            ? `Already queued (${data.request?.status || "active"})`
            : data.streamWhenReady
              ? `Acquiring for stream via ${data.path}…`
              : `Queued via ${data.path}${data.job ? ` (job ${String(data.job.id).slice(0, 6)})` : ""}`
        : data.error || "Request failed",
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="max-w-2xl text-muted-foreground">
          Find music already on this server, request missing albums through
          Lidarr, or fall back to the Downtify-style acquirer.
        </p>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-12 pl-10"
            placeholder="Artist, album, or track"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>
        {message && (
          <p className="text-sm text-foreground">{message}</p>
        )}
        {lidarrError && (
          <p className="text-sm text-destructive">Lidarr: {lidarrError}</p>
        )}
      </section>

      {canPlay && (
        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
            On this server
          </h2>
          <ul className="divide-y divide-border/60 rounded-xl border border-border ">
            {local.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{t.title}</div>
                  <div className="truncate text-sm text-muted-foreground">
                    {t.artist} · {t.album}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => play(t, local)}
                >
                  <Play className="size-4" /> Play
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
          Lidarr catalog
        </h2>
        {lidarr.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {q.trim()
              ? "No Lidarr results yet. Configure Lidarr in Settings if this stays empty."
              : "Type a query to search Lidarr."}
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {lidarr.map((hit) => (
              <li
                key={`${hit.type}-${hit.foreignId || hit.title}`}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm"
              >
                <div className="flex gap-3">
                  <div
                    className="size-16 shrink-0 rounded-md bg-cover bg-center"
                    style={{
                      backgroundImage: hit.image
                        ? `url(${hit.image})`
                        : undefined,
                      backgroundColor: "var(--muted)",
                    }}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{hit.type}</Badge>
                      {hit.alreadyInLibrary && (
                        <Badge variant="success">in Lidarr</Badge>
                      )}
                    </div>
                    <div className="mt-1 truncate font-medium">{hit.title}</div>
                    <div className="truncate text-sm text-muted-foreground">
                      {hit.artist}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() => requestItem(hit, "fallback", true)}
                  >
                    <Play className="size-4" /> Stream
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={Boolean(busy)}
                    onClick={() => requestItem(hit, "auto")}
                  >
                    <Download className="size-4" /> Request
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={Boolean(busy)}
                    onClick={() => requestItem(hit, "fallback")}
                  >
                    Fallback acquire
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
