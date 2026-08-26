"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Folder, Music2 } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { emitLibraryChanged, LIBRARY_CHANGED_EVENT } from "@/lib/ui-events";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

type FolderMeta = {
  id: string;
  name: string;
  playlistCount: number;
};

type FolderPlaylist = {
  id: string;
  name: string;
  trackCount: number;
  coverUrl: string | null;
};

export function FolderClient({ folderId }: { folderId: string }) {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const [folder, setFolder] = useState<FolderMeta | null>(null);
  const [playlists, setPlaylists] = useState<FolderPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/playlist-folders?id=${encodeURIComponent(folderId)}`,
      { cache: "no-store" },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error || "Failed to load folder");
      setFolder(null);
      setPlaylists([]);
      setLoading(false);
      return;
    }
    setFolder(data.folder);
    setPlaylists(Array.isArray(data.playlists) ? data.playlists : []);
    setDraftName(data.folder?.name || "");
    setError(null);
    setLoading(false);
  }, [folderId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    const onChanged = () => {
      void load();
    };
    window.addEventListener(LIBRARY_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, onChanged);
  }, [load]);

  useEffect(() => {
    if (editing) nameRef.current?.select();
  }, [editing]);

  async function saveName(next: string) {
    const name = next.trim();
    setEditing(false);
    if (!name || !folder || name === folder.name) {
      setDraftName(folder?.name || "");
      return;
    }
    const prev = folder.name;
    setFolder({ ...folder, name });
    try {
      const res = await fetch("/api/playlist-folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rename",
          folderId,
          name,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.folder) {
        setFolder({ ...folder, name: prev });
        setDraftName(prev);
        toastError("Couldn’t rename folder");
        return;
      }
      setFolder(data.folder);
      setDraftName(data.folder.name);
      emitLibraryChanged();
    } catch {
      setFolder({ ...folder, name: prev });
      setDraftName(prev);
      toastError("Couldn’t rename folder");
    }
  }

  if (loading && !folder) {
    return <p className="text-sm text-muted-foreground">Loading folder…</p>;
  }

  if (error && !folder) {
    return (
      <p className="text-sm text-muted-foreground">
        {error}{" "}
        <button
          type="button"
          className="underline"
          onClick={() => router.push("/")}
        >
          Go home
        </button>
      </p>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <section className="relative -mx-4 -mt-4 border-b border-border px-4 pb-10 pt-8 md:-mx-8 md:px-8 lg:-mx-10 lg:px-10">
        <div
          className="pointer-events-none absolute inset-0 opacity-35"
          style={{
            background:
              "linear-gradient(180deg, hsl(32 12% 22%) 0%, hsl(var(--background)) 100%)",
          }}
          aria-hidden
        />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end">
          <div
            className="flex size-44 shrink-0 items-center justify-center rounded-lg bg-[#282828] text-[#b3b3b3] shadow-lg sm:size-52 md:size-56"
            aria-hidden
          >
            <Folder className="size-16 sm:size-20" strokeWidth={1.25} />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Folder
            </p>
            {editing ? (
              <input
                ref={nameRef}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => void saveName(draftName)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    setDraftName(folder?.name || "");
                    setEditing(false);
                  }
                }}
                className="w-full bg-transparent text-3xl font-semibold tracking-tight text-foreground outline-none sm:text-4xl md:text-5xl"
                maxLength={80}
                aria-label="Folder name"
              />
            ) : (
              <h1>
                <button
                  type="button"
                  onClick={() => {
                    setDraftName(folder?.name || "");
                    setEditing(true);
                  }}
                  className="max-w-full truncate text-left text-3xl font-semibold tracking-tight hover:underline sm:text-4xl md:text-5xl"
                >
                  {folder?.name || "Folder"}
                </button>
              </h1>
            )}
            <p className="text-sm text-muted-foreground">
              {playlists.length} playlist{playlists.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </section>

      <section className="pt-6">
        {playlists.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-16 text-center text-muted-foreground">
            <p>This folder is empty.</p>
            <p className="mt-2 text-sm text-muted-foreground/80">
              Right-click a playlist in the library and choose Move to folder.
            </p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {playlists.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/playlist/${encodeURIComponent(p.id)}`}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-muted/40",
                  )}
                >
                  {p.coverUrl ? (
                    <CoverArt
                      seed={p.id}
                      image={p.coverUrl}
                      className="size-12 shrink-0 rounded-sm"
                    />
                  ) : (
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-[#282828] text-[#7f7f7f]">
                      <Music2 className="size-5" strokeWidth={1.5} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      Playlist · {p.trackCount} song
                      {p.trackCount === 1 ? "" : "s"}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
