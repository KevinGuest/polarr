"use client";

import { useEffect, useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Lock, LockOpen, Music2, Pencil, Trash2 } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { emitLibraryChanged } from "@/lib/ui-events";
import { toastError, toastSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

const PLAYLIST_DESCRIPTION_MAX = 1000;

type PlaylistNameDetails = {
  id: string;
  name: string;
  description?: string;
  isPrivate?: boolean;
};

type PlaylistNameDetailsDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlist: PlaylistNameDetails;
  coverImage?: string;
  coverBusy: boolean;
  onPickCover: () => void;
  onSaved: (next: {
    name: string;
    description: string;
    isPrivate: boolean;
  }) => void;
  onDelete: () => void;
};

export function PlaylistNameDetailsDrawer({
  open,
  onOpenChange,
  playlist,
  coverImage,
  coverBusy,
  onPickCover,
  onSaved,
  onDelete,
}: PlaylistNameDetailsDrawerProps) {
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description || "");
  const [isPrivate, setIsPrivate] = useState(Boolean(playlist.isPrivate));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(playlist.name);
    setDescription(playlist.description || "");
    setIsPrivate(Boolean(playlist.isPrivate));
    setSaving(false);
  }, [open, playlist.id, playlist.name, playlist.description, playlist.isPrivate]);

  const dirty = useMemo(() => {
    const nextName = name.trim();
    const nextDesc = description.trim().slice(0, PLAYLIST_DESCRIPTION_MAX);
    return (
      nextName !== playlist.name.trim() ||
      nextDesc !== (playlist.description || "").trim() ||
      isPrivate !== Boolean(playlist.isPrivate)
    );
  }, [name, description, isPrivate, playlist.name, playlist.description, playlist.isPrivate]);

  async function save() {
    const nextName = name.trim();
    if (!nextName) {
      toastError("Give this playlist a name");
      return;
    }
    if (!dirty || saving) return;
    const nextDescription = description
      .trim()
      .slice(0, PLAYLIST_DESCRIPTION_MAX);
    setSaving(true);
    try {
      const res = await fetch("/api/playlists", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          playlistId: playlist.id,
          name: nextName,
          description: nextDescription,
          isPrivate,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.playlist) {
        toastError(data?.error || "Couldn’t save playlist details");
        return;
      }
      onSaved({
        name: data.playlist.name,
        description: String(data.playlist.description || ""),
        isPrivate: Boolean(data.playlist.isPrivate),
      });
      emitLibraryChanged();
      toastSuccess("Playlist details saved");
      onOpenChange(false);
    } catch {
      toastError("Couldn’t save playlist details");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="z-[75] bg-black/60" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-x-0 bottom-0 z-[75] flex max-h-[min(92vh,40rem)] flex-col rounded-t-2xl border-t border-border bg-background text-foreground shadow-2xl outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
            "duration-300",
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div
            className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/35"
            aria-hidden
          />

          <header className="grid shrink-0 grid-cols-[4.5rem_1fr_4.5rem] items-center px-3 py-3">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="justify-self-start text-sm font-medium"
            >
              Cancel
            </button>
            <h2 className="text-center text-base font-bold">Name & details</h2>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving || !name.trim() || coverBusy}
              className={cn(
                "justify-self-end text-sm font-semibold",
                dirty && !saving && name.trim()
                  ? "text-emerald-400"
                  : "text-muted-foreground/50",
              )}
            >
              Save
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1.25rem,var(--safe-bottom))]">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => onPickCover()}
                disabled={coverBusy || saving}
                aria-label="Change playlist cover"
                className="relative size-[5.5rem] shrink-0 overflow-hidden rounded-md shadow-md"
              >
                {coverImage ? (
                  <CoverArt
                    seed={playlist.id || playlist.name}
                    image={coverImage}
                    className="size-full"
                  />
                ) : (
                  <div
                    className="flex size-full items-center justify-center bg-muted text-muted-foreground"
                    aria-hidden
                  >
                    <Music2 className="size-8" strokeWidth={1.25} />
                  </div>
                )}
                <span className="absolute bottom-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-black/70 text-white">
                  <Pencil className="size-3" strokeWidth={2.25} />
                </span>
              </button>

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void save();
                    }
                  }}
                  maxLength={80}
                  placeholder="Add a name"
                  aria-label="Playlist name"
                  className="h-11 w-full rounded-md border-0 bg-muted/70 px-3 text-sm font-medium outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={PLAYLIST_DESCRIPTION_MAX}
                  placeholder="Add an optional description"
                  aria-label="Playlist description"
                  rows={3}
                  className="min-h-[4.5rem] w-full resize-none rounded-md border-0 bg-muted/70 px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <div className="mt-5 divide-y divide-border/70 border-t border-border/70">
              <button
                type="button"
                disabled={saving}
                onClick={() => setIsPrivate((v) => !v)}
                className="flex w-full items-center gap-4 py-4 text-left"
              >
                {isPrivate ? (
                  <LockOpen className="size-6 shrink-0" strokeWidth={1.75} />
                ) : (
                  <Lock className="size-6 shrink-0" strokeWidth={1.75} />
                )}
                <span className="text-[15px] font-medium">
                  {isPrivate ? "Make public" : "Make private"}
                </span>
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  onOpenChange(false);
                  setTimeout(() => onDelete(), 180);
                }}
                className="flex w-full items-center gap-4 py-4 text-left text-destructive"
              >
                <Trash2 className="size-6 shrink-0" strokeWidth={1.75} />
                <span className="text-[15px] font-medium">Delete playlist</span>
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
