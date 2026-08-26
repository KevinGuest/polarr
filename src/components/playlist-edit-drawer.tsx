"use client";

import { useEffect, useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, GripVertical, Minus, Play, X } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { emitLibraryChanged } from "@/lib/ui-events";
import { toastError, toastSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

export type PlaylistEditTrack = {
  id: string;
  title: string;
  artist: string;
  coverPath: string | null;
};

type TargetPlaylist = {
  id: string;
  name: string;
};

type PlaylistEditDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlistId: string;
  tracks: PlaylistEditTrack[];
  onSaved: (next: PlaylistEditTrack[]) => void;
};

function trackKey(t: PlaylistEditTrack) {
  return t.id;
}

function sameOrder(a: PlaylistEditTrack[], b: PlaylistEditTrack[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (trackKey(a[i]) !== trackKey(b[i])) return false;
  }
  return true;
}

export function PlaylistEditDrawer({
  open,
  onOpenChange,
  playlistId,
  tracks,
  onSaved,
}: PlaylistEditDrawerProps) {
  const [draft, setDraft] = useState<PlaylistEditTrack[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [targets, setTargets] = useState<TargetPlaylist[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(tracks.map((t) => ({ ...t })));
    setSelectMode(false);
    setSelected(new Set());
    setBusy(false);
    setDragId(null);
    setMoveOpen(false);
  }, [open, tracks]);

  const dirty = useMemo(
    () => !sameOrder(draft, tracks),
    [draft, tracks],
  );

  function close() {
    if (busy) return;
    onOpenChange(false);
  }

  function removeOne(id: string) {
    setDraft((prev) => prev.filter((t) => trackKey(t) !== id));
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function reorder(fromId: string, toId: string) {
    if (fromId === toId) return;
    setDraft((prev) => {
      const from = prev.findIndex((t) => trackKey(t) === fromId);
      const to = prev.findIndex((t) => trackKey(t) === toId);
      if (from < 0 || to < 0) return prev;
      const next = prev.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  async function save() {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      const trackIds = draft.map((t) => trackKey(t));
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reorder",
          playlistId,
          trackIds,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toastError(data?.error || "Couldn’t save playlist");
        return;
      }
      onSaved(draft);
      emitLibraryChanged();
      toastSuccess("Playlist updated");
      onOpenChange(false);
    } catch {
      toastError("Couldn’t save playlist");
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (selected.size === 0) return;
    setDraft((prev) => prev.filter((t) => !selected.has(trackKey(t))));
    setSelected(new Set());
    setSelectMode(false);
  }

  async function openMove() {
    if (selected.size === 0) return;
    setMoveOpen(true);
    setTargetsLoading(true);
    try {
      const res = await fetch("/api/playlists", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toastError("Couldn’t load playlists");
        setMoveOpen(false);
        return;
      }
      const list = ((data?.playlists || []) as TargetPlaylist[]).filter(
        (p) => p.id !== playlistId,
      );
      setTargets(list);
    } catch {
      toastError("Couldn’t load playlists");
      setMoveOpen(false);
    } finally {
      setTargetsLoading(false);
    }
  }

  async function moveTo(toPlaylistId: string, name: string) {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    try {
      const trackIds = [...selected];
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "moveTracks",
          fromPlaylistId: playlistId,
          toPlaylistId,
          trackIds,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toastError(data?.error || "Couldn’t move tracks");
        return;
      }
      const next = draft.filter((t) => !selected.has(trackKey(t)));
      // Persist remaining order so local reorders aren’t lost after the move.
      await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reorder",
          playlistId,
          trackIds: next.map((t) => trackKey(t)),
        }),
      });
      setDraft(next);
      onSaved(next);
      emitLibraryChanged();
      toastSuccess(`Moved ${trackIds.length} to “${name}”`);
      setSelected(new Set());
      setSelectMode(false);
      setMoveOpen(false);
    } catch {
      toastError("Couldn’t move tracks");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
          else onOpenChange(true);
        }}
      >
        <DialogPortal>
          <DialogOverlay className="z-[75] bg-black/70" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className={cn(
              "fixed inset-x-0 bottom-0 z-[75] flex h-[min(96vh,920px)] flex-col rounded-t-2xl border-t border-border bg-background text-foreground shadow-2xl outline-none",
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
              {selectMode ? (
                <>
                  <span className="text-sm text-muted-foreground" />
                  <h2 className="text-center text-base font-bold">
                    {selected.size} selected
                  </h2>
                  <span />
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={close}
                    disabled={busy}
                    className="justify-self-start text-sm font-medium text-foreground"
                  >
                    Cancel
                  </button>
                  <h2 className="text-center text-base font-bold">
                    Edit playlist
                  </h2>
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={!dirty || busy}
                    className={cn(
                      "justify-self-end text-sm font-semibold",
                      dirty && !busy
                        ? "text-emerald-400"
                        : "text-muted-foreground/50",
                    )}
                  >
                    Save
                  </button>
                </>
              )}
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-28">
              {draft.length === 0 ? (
                <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No songs in this playlist.
                </p>
              ) : (
                <ul>
                  {draft.map((t) => {
                    const id = trackKey(t);
                    const isSelected = selected.has(id);
                    const cover =
                      t.coverPath && /^https?:\/\//i.test(t.coverPath)
                        ? t.coverPath
                        : undefined;
                    return (
                      <li
                        key={id}
                        draggable={!selectMode}
                        onDragStart={(e) => {
                          if (selectMode) {
                            e.preventDefault();
                            return;
                          }
                          setDragId(id);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", id);
                        }}
                        onDragEnd={() => setDragId(null)}
                        onDragOver={(e) => {
                          if (selectMode || !dragId) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from =
                            e.dataTransfer.getData("text/plain") || dragId;
                          if (from) reorder(from, id);
                          setDragId(null);
                        }}
                        className={cn(
                          "flex items-center gap-2 rounded-lg px-1 py-2",
                          dragId === id && "opacity-50",
                        )}
                      >
                        {selectMode ? (
                          <button
                            type="button"
                            onClick={() => toggleSelect(id)}
                            className="flex size-8 shrink-0 items-center justify-center"
                            aria-label={
                              isSelected ? "Deselect track" : "Select track"
                            }
                            aria-pressed={isSelected}
                          >
                            <span
                              className={cn(
                                "flex size-6 items-center justify-center rounded-full border-2",
                                isSelected
                                  ? "border-emerald-500 bg-emerald-500 text-black"
                                  : "border-muted-foreground/50",
                              )}
                            >
                              {isSelected ? (
                                <Check className="size-3.5" strokeWidth={3} />
                              ) : null}
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => removeOne(id)}
                            className="flex size-8 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                            aria-label={`Remove ${t.title}`}
                          >
                            <span className="flex size-6 items-center justify-center rounded-full border border-muted-foreground/60">
                              <Minus className="size-3.5" strokeWidth={2.5} />
                            </span>
                          </button>
                        )}

                        <div className="relative size-12 shrink-0 overflow-hidden rounded-md">
                          <CoverArt
                            seed={`${t.artist}-${t.title}`}
                            image={cover}
                            className="size-12 rounded-md"
                          />
                          <span
                            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25"
                            aria-hidden
                          >
                            <Play
                              className="size-4 text-white"
                              fill="currentColor"
                            />
                          </span>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-medium">
                            {t.title}
                          </div>
                          <div className="truncate text-sm text-muted-foreground">
                            {t.artist}
                          </div>
                        </div>

                        <span
                          className={cn(
                            "flex size-9 shrink-0 items-center justify-center text-muted-foreground",
                            !selectMode && "cursor-grab active:cursor-grabbing",
                          )}
                          aria-hidden
                        >
                          <GripVertical className="size-5" />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pb-[max(1rem,var(--safe-bottom))] pt-10">
              {selectMode ? (
                <div className="pointer-events-auto flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectMode(false);
                      setSelected(new Set());
                    }}
                    className="flex size-12 items-center justify-center rounded-full bg-muted text-foreground"
                    aria-label="Exit select"
                  >
                    <X className="size-5" />
                  </button>
                  <button
                    type="button"
                    disabled={selected.size === 0 || busy}
                    onClick={() => void openMove()}
                    className="rounded-full bg-muted px-8 py-3 text-sm font-semibold disabled:opacity-40"
                  >
                    Move
                  </button>
                  <button
                    type="button"
                    disabled={selected.size === 0 || busy}
                    onClick={() => void removeSelected()}
                    className="rounded-full bg-muted px-8 py-3 text-sm font-semibold disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setSelectMode(true);
                    setSelected(new Set());
                  }}
                  className="pointer-events-auto mx-auto flex w-full max-w-sm items-center justify-center rounded-full bg-muted py-3.5 text-sm font-semibold"
                >
                  Select
                </button>
              )}
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogPortal>
          <DialogOverlay className="z-[80] bg-black/60" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className={cn(
              "fixed inset-x-0 bottom-0 z-[80] max-h-[min(70vh,28rem)] overflow-y-auto rounded-t-2xl border-t border-border bg-background p-4 pb-[max(1rem,var(--safe-bottom))] shadow-2xl outline-none",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
              "duration-250",
            )}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div
              className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/35"
              aria-hidden
            />
            <h3 className="mb-3 text-base font-semibold">Move to playlist</h3>
            {targetsLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : targets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No other playlists yet.
              </p>
            ) : (
              <ul className="space-y-1">
                {targets.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void moveTo(p.id, p.name)}
                      className="w-full rounded-lg px-3 py-3 text-left text-sm font-medium hover:bg-muted/60"
                    >
                      {p.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    </>
  );
}
